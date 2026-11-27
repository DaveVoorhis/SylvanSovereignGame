import type { EventBus } from '@core/EventBus';
import type {
  AudioListenerFrame,
  CombatSparkVisual,
  CreatureInteractionEvent,
  DivineEffectVisual,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { WorldState } from '@simulation/WorldState';
import { AmbientSoundscape } from './AmbientSoundscape';
import {
  AnimalVoiceSynth,
  interactionKindToMood,
  type VocalMood,
} from './AnimalVoiceSynth';
import {
  clamp,
  computeSpatialParams,
  createSeamlessNoiseBuffer,
  createWoodlandReverbBuffer,
} from './AudioUtils';
import { FestivalMusicPlayer } from './FestivalMusicPlayer';

const MUTE_STORAGE_KEY = 'sylvan-sovereign:soundMuted';

function readStoredMuted(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Ignore storage quota / private browsing errors
  }
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export interface AudioEngineOptions {
  readonly initialMuted?: boolean;
  readonly audioContextFactory?: () => AudioContext | null;
  readonly persistMute?: boolean;
}

/**
 * Top-level procedural Web Audio coordinator for Sylvan Sovereign:
 * - Synthesizes realistic animal vocalizations for all 24 woodland species on interactions
 * - Runs a camera-aware outdoor ambient soundscape (wind, rustling trees, rivers, ocean, rain, hearth)
 * - Plays biome-adapted village festival & national holiday folk music
 * - Handles browser autoplay unlocking, smooth mute/unmute ramping, polyphony limiting, and tab visibility
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambient: AmbientSoundscape | null = null;
  private voices: AnimalVoiceSynth | null = null;
  private music: FestivalMusicPlayer | null = null;

  private muted: boolean;
  private pageHidden = false;
  private disposed = false;
  private readonly persistMute: boolean;
  private readonly audioContextFactory: () => AudioContext | null;

  private lastListener: AudioListenerFrame = {
    cameraPos: { x: 0, y: 20, z: 30 },
    focusPos: { x: 0, y: 2, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    focusDistance: 36,
    isPov: false,
    isUnderwater: false,
  };

  // Rate limiting & proximity chatter scheduling
  private lastVoiceMs = 0;
  private lastCombatMs = 0;
  private lastBuildMs = 0;
  private proximityChatterTimer = 1.6;
  private proximityHammerTimer = 1.1;
  private readonly creatureCooldowns = new Map<string, number>();

  private readonly unsubscribes: (() => void)[] = [];
  private interactionUnsub: (() => void) | null = null;
  private readonly onUserGestureBound: () => void;
  private muteSuspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bus: EventBus,
    options?: AudioEngineOptions,
  ) {
    this.persistMute = options?.persistMute ?? true;
    this.muted = options?.initialMuted ?? (this.persistMute ? readStoredMuted() : false);
    this.audioContextFactory =
      options?.audioContextFactory ??
      (() => {
        const Ctor = getAudioContextCtor();
        if (!Ctor) return null;
        try {
          return new Ctor();
        } catch {
          return null;
        }
      });

    this.unsubscribes.push(
      this.bus.on('combat:spark', (sp) => this.handleCombatSpark(sp)),
      this.bus.on('divine:effect', (fx) => this.handleDivineEffect(fx)),
      this.bus.on('world:reset', () => {
        this.creatureCooldowns.clear();
      }),
    );
    this.syncInteractionSubscription();

    this.onUserGestureBound = () => {
      if (this.disposed || this.muted) return;
      this.ensureInitialized();
      this.resumeContextIfNeeded();
      if (this.ctx && this.ctx.state === 'running') {
        this.detachGestureUnlockers();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.onUserGestureBound, { passive: true });
      window.addEventListener('keydown', this.onUserGestureBound, { passive: true });
      window.addEventListener('touchstart', this.onUserGestureBound, { passive: true });
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** True when the audio engine is active and ready to process frames. */
  isRunning(): boolean {
    return (
      !this.disposed &&
      !this.muted &&
      !this.pageHidden &&
      this.ctx !== null &&
      this.ctx.state === 'running'
    );
  }

  /** Toggles sound on/off and returns the new muted state (`true` = muted). */
  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Explicitly sets sound mute state with smooth gain ramping. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.persistMute) {
      writeStoredMuted(muted);
    }

    this.syncInteractionSubscription();
    this.clearMuteSuspendTimer();

    if (!muted) {
      this.ensureInitialized();
      this.resumeContextIfNeeded();
    }

    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(muted ? 0.0 : 0.88, now, 0.045);

      if (muted && this.ctx.state === 'running' && typeof this.ctx.suspend === 'function') {
        // Allow the smooth fade-out ramp to finish before suspending the audio thread
        this.muteSuspendTimer = setTimeout(() => {
          this.muteSuspendTimer = null;
          if (!this.disposed && this.muted && this.ctx && this.ctx.state === 'running') {
            if (typeof this.ctx.suspend === 'function') {
              void this.ctx.suspend().catch(() => {});
            }
          }
        }, 180);
      }
    }
  }

  /** Suspends/resumes audio cleanly when the browser tab goes to background/foreground. */
  setPageHidden(hidden: boolean): void {
    this.pageHidden = hidden;
    if (!this.ctx) return;
    if (hidden) {
      if (this.ctx.state === 'running' && typeof this.ctx.suspend === 'function') {
        void this.ctx.suspend().catch(() => {});
      }
    } else if (!this.muted) {
      this.resumeContextIfNeeded();
    }
  }

  /** Advances continuous ambient soundscape, village festival music, and nearby creature ambience. */
  update(
    dt: number,
    world: WorldState,
    listener: AudioListenerFrame,
    simSpeed: number,
  ): void {
    this.lastListener = listener;
    if (this.disposed || this.muted || this.pageHidden) return;
    if (!this.ctx || !this.ambient || !this.music || !this.voices) return;
    if (this.ctx.state !== 'running') return;

    const paused = simSpeed <= 0;
    this.ambient.update(dt, world, listener, paused);
    this.music.update(world, listener, paused, dt);

    if (paused) return;

    // Proximity wildlife & village creature chatter (so viewing any bustling village or POV feels alive)
    this.proximityChatterTimer -= dt;
    if (this.proximityChatterTimer <= 0) {
      this.proximityChatterTimer = 1.35 + Math.random() * 1.45;
      this.sampleNearbyCreatureVoice(world, listener);
    }

    // Proximity construction hammering when builders are actively raising frames nearby
    this.proximityHammerTimer -= dt;
    if (this.proximityHammerTimer <= 0) {
      this.proximityHammerTimer = 0.85 + Math.random() * 1.05;
      this.sampleNearbyBuilderWork(world, listener);
    }
  }

  private ensureInitialized(): boolean {
    if (this.ctx) return true;
    if (this.disposed) return false;

    const ctx = this.audioContextFactory();
    if (!ctx) return false;
    this.ctx = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0.0 : 0.88;
    this.masterGain = masterGain;

    // Gentle mastering dynamics compressor prevents clipping during big battles or festivals
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.008;
      comp.release.value = 0.18;
      masterGain.connect(comp);
      comp.connect(ctx.destination);
    } else {
      masterGain.connect(ctx.destination);
    }

    // Shared seamless noise buffers (generated once per AudioContext)
    const whiteNoise = createSeamlessNoiseBuffer(ctx, 3.0, 'white', 101);
    const pinkNoise = createSeamlessNoiseBuffer(ctx, 4.0, 'pink', 202);
    const brownNoise = createSeamlessNoiseBuffer(ctx, 4.5, 'brown', 303);

    // Subtle open-air woodland reverb send for natural spatial cohesion
    let reverbInput: AudioNode | null = null;
    if (typeof ctx.createConvolver === 'function') {
      try {
        const convolver = ctx.createConvolver();
        convolver.buffer = createWoodlandReverbBuffer(ctx, 1.15);
        const reverbReturn = ctx.createGain();
        reverbReturn.gain.value = 0.24;
        convolver.connect(reverbReturn);
        reverbReturn.connect(masterGain);
        reverbInput = convolver;
      } catch {
        reverbInput = null;
      }
    }

    const ambientBus = ctx.createGain();
    ambientBus.gain.value = 0.92;
    ambientBus.connect(masterGain);

    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.82;
    voiceBus.connect(masterGain);
    if (reverbInput) {
      const voiceVerb = ctx.createGain();
      voiceVerb.gain.value = 0.22;
      voiceBus.connect(voiceVerb);
      voiceVerb.connect(reverbInput);
    }

    const musicBus = ctx.createGain();
    musicBus.gain.value = 0.78;
    musicBus.connect(masterGain);
    if (reverbInput) {
      const musicVerb = ctx.createGain();
      musicVerb.gain.value = 0.3;
      musicBus.connect(musicVerb);
      musicVerb.connect(reverbInput);
    }

    const fxBus = ctx.createGain();
    fxBus.gain.value = 0.74;
    fxBus.connect(masterGain);
    if (reverbInput) {
      const fxVerb = ctx.createGain();
      fxVerb.gain.value = 0.18;
      fxBus.connect(fxVerb);
      fxVerb.connect(reverbInput);
    }

    this.ambient = new AmbientSoundscape(ctx, ambientBus, whiteNoise, pinkNoise, brownNoise);
    this.voices = new AnimalVoiceSynth(ctx, voiceBus, fxBus, whiteNoise, pinkNoise);
    this.music = new FestivalMusicPlayer(ctx, musicBus, whiteNoise, pinkNoise);

    return true;
  }

  private resumeContextIfNeeded(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      void this.ctx.resume().catch(() => {});
    }
  }

  private detachGestureUnlockers(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this.onUserGestureBound);
    window.removeEventListener('keydown', this.onUserGestureBound);
    window.removeEventListener('touchstart', this.onUserGestureBound);
  }

  private syncInteractionSubscription(): void {
    if (!this.disposed && !this.muted) {
      if (!this.interactionUnsub) {
        this.interactionUnsub = this.bus.on('creature:interaction', (ev) =>
          this.handleCreatureInteraction(ev),
        );
      }
    } else if (this.interactionUnsub) {
      this.interactionUnsub();
      this.interactionUnsub = null;
    }
  }

  private clearMuteSuspendTimer(): void {
    if (this.muteSuspendTimer !== null) {
      clearTimeout(this.muteSuspendTimer);
      this.muteSuspendTimer = null;
    }
  }

  private handleCreatureInteraction(ev: CreatureInteractionEvent): void {
    if (this.disposed || this.muted || this.pageHidden || !this.voices || !this.ctx) return;
    if (this.ctx.state !== 'running') return;

    const nowMs = performance.now();
    const isMilestone =
      ev.kind === 'birth' || ev.kind === 'court' || ev.kind === 'build' || ev.kind === 'trade';
    const minSpacingMs = isMilestone ? 220 : 380;
    if (nowMs - this.lastVoiceMs < minSpacingMs) return;

    const spatial = computeSpatialParams(ev.position, this.lastListener, {
      refDistance: this.lastListener.isPov ? 5.5 : 14,
      maxDistance: this.lastListener.isPov ? 54 : 78,
      maxZoomDistance: 165,
    });
    if (!spatial.isAudible) return;

    this.lastVoiceMs = nowMs;

    const intensity = clamp(ev.intensity ?? 0.85, 0.3, 1.0);
    const mood = interactionKindToMood(ev.kind);
    const voiceGain = spatial.gain * (0.48 + 0.38 * intensity);

    this.voices.playVoice({
      species: ev.species,
      mood,
      lifeStage: ev.lifeStage,
      gain: voiceGain,
      pan: spatial.pan,
    });

    // Call-and-response duet when two creatures are interacting socially!
    if (
      ev.partnerSpecies &&
      (ev.kind === 'greet' ||
        ev.kind === 'argue' ||
        ev.kind === 'court' ||
        ev.kind === 'play' ||
        ev.kind === 'celebrate')
    ) {
      const responsePan = clamp(spatial.pan + (spatial.pan > 0 ? -0.14 : 0.14), -0.9, 0.9);
      this.voices.playVoice({
        species: ev.partnerSpecies,
        mood,
        lifeStage: ev.kind === 'play' ? 'young' : 'adult',
        gain: voiceGain * 0.82,
        pan: responsePan,
        delaySec: 0.34 + Math.random() * 0.22,
      });
    }

    // Accompanying tactile Foley for births, bonding, building, trading, praying
    if (
      ev.kind === 'build' ||
      ev.kind === 'trade' ||
      ev.kind === 'pray' ||
      ev.kind === 'birth' ||
      ev.kind === 'court'
    ) {
      this.voices.playInteractionFoley(ev.kind, spatial.gain * 0.65, spatial.pan);
    }
  }

  private handleCombatSpark(sp: CombatSparkVisual): void {
    if (this.disposed || this.muted || this.pageHidden || !this.voices || !this.ctx) return;
    if (this.ctx.state !== 'running') return;

    const nowMs = performance.now();
    if (nowMs - this.lastCombatMs < 170) return;

    const spatial = computeSpatialParams(sp.position, this.lastListener, {
      refDistance: 12,
      maxDistance: 92,
      maxZoomDistance: 210,
    });
    if (!spatial.isAudible) return;

    this.lastCombatMs = nowMs;
    this.voices.playCombatSound(sp.kind ?? 'hit', spatial.gain * 0.72, spatial.pan);
  }

  private handleDivineEffect(fx: DivineEffectVisual): void {
    if (this.disposed || this.muted || this.pageHidden || !this.voices || !this.ctx) return;
    if (this.ctx.state !== 'running') return;

    const spatial = computeSpatialParams(
      { x: fx.position.x, y: 12, z: fx.position.z },
      this.lastListener,
      {
        refDistance: 40,
        maxDistance: 280,
        maxZoomDistance: 680,
      },
    );
    const gain = Math.max(0.18, spatial.gain * 0.9);
    this.voices.playDivineEffect(fx.type, gain, spatial.pan);
  }

  private sampleNearbyCreatureVoice(world: WorldState, listener: AudioListenerFrame): void {
    if (!this.voices) return;
    if (!listener.isPov && listener.focusDistance > 125) return;

    const nowMs = performance.now();
    if (nowMs - this.lastVoiceMs < 750) return;

    // Lazily prune expired per-creature vocalization cooldowns
    if (this.creatureCooldowns.size > 0) {
      for (const [id, expiryMs] of this.creatureCooldowns) {
        if (expiryMs <= nowMs) {
          this.creatureCooldowns.delete(id);
        }
      }
    }

    const anchor = listener.isPov ? listener.cameraPos : listener.focusPos;
    const maxR = listener.isPov ? 34 : 52;
    const maxRSq = maxR * maxR;
    const sunY = Math.sin((world.timeOfDay - 0.25) * Math.PI * 2);
    const isNight = sunY < -0.05;

    let best: Creature | null = null;
    let bestScore = -1;

    const alive = world.aliveCreatures;
    for (let i = 0; i < alive.length; i++) {
      const c = alive[i];
      if (c.activity === 'resting') continue;
      if (this.creatureCooldowns.has(c.id)) continue;

      const dx = c.x - anchor.x;
      const dz = c.z - anchor.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > maxRSq) continue;

      // Weight active/expressive creatures and time-appropriate species (owls/frogs/wolves at night, songbirds by day)
      let weight = 0.35 + Math.random() * 0.65;
      if (c.activity === 'celebrating' || c.activity === 'socialising' || c.activity === 'courting') {
        weight += 0.9;
      } else if (c.activity === 'playing' || c.activity === 'fighting') {
        weight += 0.75;
      } else if (c.activity === 'praying' || c.activity === 'trading') {
        weight += 0.45;
      }
      if (isNight && (c.species === 'owl' || c.species === 'frog' || c.species === 'wolf')) {
        weight += 0.85;
      } else if (
        !isNight &&
        (c.species === 'robin' || c.species === 'sparrow' || c.species === 'crow' || c.species === 'pigeon' || c.species === 'magpie')
      ) {
        weight += 0.55;
      }

      const distFactor = 1 - Math.sqrt(dSq) / maxR;
      const score = weight * (0.45 + 0.55 * distFactor);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) return;
    const spatial = computeSpatialParams({ x: best.x, y: best.y, z: best.z }, listener);
    if (!spatial.isAudible) return;

    const mood: VocalMood =
      best.activity === 'fighting'
        ? 'aggressive'
        : best.activity === 'fleeing'
          ? 'alarmed'
          : best.activity === 'celebrating'
            ? 'excited'
            : best.activity === 'playing'
              ? 'playful'
              : best.activity === 'courting'
                ? 'affectionate'
                : best.activity === 'praying'
                  ? 'solemn'
                  : 'friendly';

    this.lastVoiceMs = nowMs;
    this.creatureCooldowns.set(best.id, nowMs + (6.5 + Math.random() * 5.0) * 1000);
    this.voices.playVoice({
      species: best.species,
      mood,
      lifeStage: best.lifeStage,
      gain: spatial.gain * 0.54,
      pan: spatial.pan,
    });
  }

  private sampleNearbyBuilderWork(world: WorldState, listener: AudioListenerFrame): void {
    if (!this.voices) return;
    if (!listener.isPov && listener.focusDistance > 95) return;

    const nowMs = performance.now();
    if (nowMs - this.lastBuildMs < 700) return;

    const anchor = listener.isPov ? listener.cameraPos : listener.focusPos;
    const maxRSq = 44 * 44;

    const alive = world.aliveCreatures;
    for (let i = 0; i < alive.length; i++) {
      const c = alive[i];
      if (!c.isActivelyWorking || c.activity !== 'building') continue;
      const dx = c.x - anchor.x;
      const dz = c.z - anchor.z;
      if (dx * dx + dz * dz > maxRSq) continue;

      const spatial = computeSpatialParams({ x: c.x, y: c.y, z: c.z }, listener, {
        refDistance: 10,
        maxDistance: 46,
        maxZoomDistance: 95,
      });
      if (!spatial.isAudible) continue;

      this.lastBuildMs = nowMs;
      this.voices.playInteractionFoley('build', spatial.gain * 0.44, spatial.pan);
      return;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearMuteSuspendTimer();
    this.detachGestureUnlockers();
    this.syncInteractionSubscription();
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;
    this.creatureCooldowns.clear();

    this.ambient?.dispose();
    this.music?.dispose();
    this.ambient = null;
    this.music = null;
    this.voices = null;
    this.masterGain = null;

    if (this.ctx) {
      const toClose = this.ctx;
      this.ctx = null;
      if (typeof toClose.close === 'function') {
        void toClose.close().catch(() => {});
      }
    }
  }
}
