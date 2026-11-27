import { describe, expect, it } from 'vitest';
import { computeAmbientMix } from '@audio/AmbientSoundscape';
import {
  AnimalVoiceSynth,
  hasSpeciesVoiceSynth,
  interactionKindToMood,
  type VocalMood,
} from '@audio/AnimalVoiceSynth';
import { AudioEngine } from '@audio/AudioEngine';
import { computeSpatialParams, createSeamlessNoiseBuffer } from '@audio/AudioUtils';
import { selectActiveFestivalMusic } from '@audio/FestivalMusicPlayer';
import { EventBus } from '@core/EventBus';
import type { AudioListenerFrame, CreatureInteractionEvent, LifeStage } from '@core/Types';
import { ALL_SPECIES_IDS } from '@simulation/creatures/SpeciesCatalog';
import { WorldState } from '@simulation/WorldState';

interface MockAudioStats {
  oscillatorsStarted: number;
  buffersStarted: number;
  lastMasterTarget: number | null;
  closed: boolean;
}

/** Lightweight spec-compatible Web Audio mock for headless Node/Vitest verification. */
function createMockAudioContext(): { ctx: AudioContext; stats: MockAudioStats } {
  const stats: MockAudioStats = {
    oscillatorsStarted: 0,
    buffersStarted: 0,
    lastMasterTarget: null,
    closed: false,
  };

  let masterGainCreated = false;

  const makeParam = (initial = 0, onTarget?: (v: number) => void): AudioParam => {
    const param = {
      value: initial,
      setValueAtTime(v: number) {
        if (!Number.isFinite(v)) throw new Error(`Non-finite AudioParam value: ${v}`);
        param.value = v;
        return param;
      },
      linearRampToValueAtTime(v: number) {
        if (!Number.isFinite(v)) throw new Error(`Non-finite AudioParam ramp: ${v}`);
        param.value = v;
        return param;
      },
      exponentialRampToValueAtTime(v: number) {
        if (!Number.isFinite(v) || v <= 0) {
          throw new Error(`Invalid exponentialRamp target: ${v}`);
        }
        param.value = v;
        return param;
      },
      setTargetAtTime(v: number) {
        if (!Number.isFinite(v)) throw new Error(`Non-finite setTargetAtTime: ${v}`);
        param.value = v;
        onTarget?.(v);
        return param;
      },
      cancelScheduledValues() {
        return param;
      },
    };
    return param as unknown as AudioParam;
  };

  const makeNode = () => ({
    connect(dest: unknown) {
      return dest;
    },
    disconnect() {},
  });

  const ctx = {
    sampleRate: 44100,
    currentTime: 1.0,
    state: 'running' as AudioContextState,
    destination: makeNode(),
    createGain() {
      const isMaster = !masterGainCreated;
      masterGainCreated = true;
      const node = {
        ...makeNode(),
        gain: makeParam(1, (v) => {
          if (isMaster) stats.lastMasterTarget = v;
        }),
      };
      return node;
    },
    createStereoPanner() {
      return {
        ...makeNode(),
        pan: makeParam(0),
      };
    },
    createBiquadFilter() {
      return {
        ...makeNode(),
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
        gain: makeParam(0),
      };
    },
    createDynamicsCompressor() {
      return {
        ...makeNode(),
        threshold: makeParam(-12),
        knee: makeParam(12),
        ratio: makeParam(4),
        attack: makeParam(0.01),
        release: makeParam(0.2),
      };
    },
    createConvolver() {
      return {
        ...makeNode(),
        buffer: null as AudioBuffer | null,
      };
    },
    createOscillator() {
      return {
        ...makeNode(),
        type: 'sine',
        frequency: makeParam(440),
        start() {
          stats.oscillatorsStarted++;
        },
        stop() {},
      };
    },
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData(ch: number) {
          return data[ch];
        },
      };
    },
    createBufferSource() {
      return {
        ...makeNode(),
        buffer: null as AudioBuffer | null,
        loop: false,
        start() {
          stats.buffersStarted++;
        },
        stop() {},
      };
    },
    resume() {
      ctx.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      stats.closed = true;
      ctx.state = 'closed';
      return Promise.resolve();
    },
  };

  return { ctx: ctx as unknown as AudioContext, stats };
}

function makeListener(overrides?: Partial<AudioListenerFrame>): AudioListenerFrame {
  return {
    cameraPos: { x: 0, y: 18, z: 24 },
    focusPos: { x: 0, y: 2, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    focusDistance: 30,
    isPov: false,
    isUnderwater: false,
    ...overrides,
  };
}

describe('Woodland Procedural Audio System', () => {
  it('synthesizes realistic animal vocalizations cleanly for all 24 species across moods and life stages', () => {
    const { ctx, stats } = createMockAudioContext();
    const white = createSeamlessNoiseBuffer(ctx, 1.0, 'white', 11);
    const pink = createSeamlessNoiseBuffer(ctx, 1.0, 'pink', 22);
    const bus = ctx.createGain();
    const synth = new AnimalVoiceSynth(ctx, bus, bus, white, pink);

    const moods: VocalMood[] = ['friendly', 'playful', 'affectionate', 'excited', 'aggressive', 'alarmed', 'solemn'];
    const stages: LifeStage[] = ['young', 'juvenile', 'adult', 'elder'];

    expect(ALL_SPECIES_IDS.length).toBe(24);
    for (let i = 0; i < ALL_SPECIES_IDS.length; i++) {
      const species = ALL_SPECIES_IDS[i];
      expect(hasSpeciesVoiceSynth(species)).toBe(true);
      const beforeTotal = stats.oscillatorsStarted + stats.buffersStarted;
      for (const mood of moods) {
        synth.playVoice({
          species,
          mood,
          lifeStage: stages[i % stages.length],
          gain: 0.6,
          pan: 0,
        });
      }
      expect(stats.oscillatorsStarted + stats.buffersStarted).toBeGreaterThan(beforeTotal);
    }

    // Exercise interaction foley, combat effects, and divine swells
    const beforeFx = stats.oscillatorsStarted + stats.buffersStarted;
    synth.playInteractionFoley('build', 0.6, 0.2);
    synth.playInteractionFoley('trade', 0.6, -0.2);
    synth.playInteractionFoley('pray', 0.6, 0);
    synth.playInteractionFoley('birth', 0.6, 0);
    synth.playCombatSound('clash', 0.7, 0.3);
    synth.playCombatSound('arrow', 0.7, -0.3);
    synth.playCombatSound('heavy_hit', 0.7, 0);
    synth.playDivineEffect('sunlit_blessing', 0.8, 0);
    synth.playDivineEffect('great_deluge', 0.8, 0);
    expect(stats.oscillatorsStarted + stats.buffersStarted).toBeGreaterThan(beforeFx + 10);
    expect(interactionKindToMood('argue')).toBe('aggressive');
    expect(interactionKindToMood('celebrate')).toBe('excited');
  });

  it('computes accurate 3D spatial attenuation, stereo panning, and overview zoom rolloff', () => {
    const closeWorldListener = makeListener({ focusDistance: 24 });
    const nearLeft = computeSpatialParams({ x: -12, y: 2, z: 0 }, closeWorldListener);
    const nearRight = computeSpatialParams({ x: 12, y: 2, z: 0 }, closeWorldListener);
    const veryFar = computeSpatialParams({ x: 220, y: 2, z: 0 }, closeWorldListener);

    expect(nearLeft.isAudible).toBe(true);
    expect(nearLeft.pan).toBeLessThan(-0.15);
    expect(nearRight.pan).toBeGreaterThan(0.15);
    expect(veryFar.isAudible).toBe(false);
    expect(veryFar.gain).toBe(0);

    // Zoomed-out overview gently fades small creature chatter compared to close-up view
    const overviewListener = makeListener({ focusDistance: 260 });
    const inOverview = computeSpatialParams({ x: 4, y: 2, z: 0 }, overviewListener);
    const closeUp = computeSpatialParams({ x: 4, y: 2, z: 0 }, closeWorldListener);
    expect(inOverview.gain).toBeLessThan(closeUp.gain * 0.25);

    // POV anchors directly on cameraPos
    const povListener = makeListener({
      isPov: true,
      cameraPos: { x: 100, y: 3, z: 50 },
      focusPos: { x: 100, y: 3, z: 66 },
    });
    const besidePov = computeSpatialParams({ x: 103, y: 3, z: 50 }, povListener);
    expect(besidePov.isAudible).toBe(true);
    expect(besidePov.gain).toBeGreaterThan(0.75);
    expect(besidePov.pan).toBeGreaterThan(0.5);
  });

  it('dynamically adapts ambient wind, rustling trees, rain, water, and hearth levels to world conditions', () => {
    const world = new WorldState(new EventBus(), {
      seed: 424242,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 4,
    });
    const settlement = world.settlements[0];

    // Village hearth proximity + clear weather vs storm
    const villageListener = makeListener({
      focusPos: { x: settlement.center.x, y: settlement.groundY, z: settlement.center.z },
      cameraPos: { x: settlement.center.x, y: settlement.groundY + 14, z: settlement.center.z + 18 },
      focusDistance: 22,
    });

    world.setWeather('clear', 60);
    const clearMix = computeAmbientMix(world, villageListener);
    expect(clearMix.rainGain).toBe(0);
    expect(clearMix.hearthGain).toBeGreaterThan(0.05);

    world.setWeather('storm', 60);
    const stormMix = computeAmbientMix(world, villageListener);
    expect(stormMix.rainGain).toBeGreaterThan(0.12);
    expect(stormMix.windGain).toBeGreaterThan(clearMix.windGain);
    expect(stormMix.highWindGain).toBeGreaterThan(clearMix.highWindGain);

    // Tree rustling near dense woodland trees
    if (world.terrain.trees.length > 0) {
      const t = world.terrain.trees[0];
      const forestListener = makeListener({
        focusPos: { x: t.x, y: t.y, z: t.z },
        cameraPos: { x: t.x, y: t.y + 12, z: t.z + 14 },
        focusDistance: 18,
      });
      const forestMix = computeAmbientMix(world, forestListener);
      expect(forestMix.treeRustleGain).toBeGreaterThan(0.04);
    }

    // Underwater Koi Eye View muffles wind/trees and activates underwater factor
    const underwaterMix = computeAmbientMix(world, makeListener({ isPov: true, isUnderwater: true }));
    expect(underwaterMix.underwaterFactor).toBe(1);
    expect(underwaterMix.treeRustleGain).toBeLessThan(0.02);
  });

  it('selects biome-adapted village festival music for local festivals and realm-wide national holidays', () => {
    const world = new WorldState(new EventBus(), {
      seed: 777123,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 6,
    });
    const host = world.settlements[0];
    const nearHost = makeListener({
      focusPos: { x: host.center.x, y: host.groundY, z: host.center.z },
      cameraPos: { x: host.center.x, y: host.groundY + 16, z: host.center.z + 20 },
      focusDistance: 25,
    });

    // No active celebrations -> no festival music
    expect(selectActiveFestivalMusic(world, nearHost)).toBeNull();

    // Local festival plays host settlement's cultural style nearby, silent far away
    const localCel = world.festivals.startLocalFestival(world, host);
    expect(localCel).not.toBeNull();
    const localTarget = selectActiveFestivalMusic(world, nearHost);
    expect(localTarget).not.toBeNull();
    expect(localTarget!.scope).toBe('local');
    expect(localTarget!.style).toBe(host.adaptation);
    expect(localTarget!.gain).toBeGreaterThan(0.7);

    const farAway = makeListener({
      focusPos: { x: host.center.x + 260, y: 2, z: host.center.z + 260 },
      cameraPos: { x: host.center.x + 260, y: 20, z: host.center.z + 280 },
      focusDistance: 28,
    });
    expect(selectActiveFestivalMusic(world, farAway)).toBeNull();

    // National holiday fills the realm even from zoomed-out overview
    const nat = world.festivals.startNationalHoliday(world);
    expect(nat).not.toBeNull();
    const overviewTarget = selectActiveFestivalMusic(world, makeListener({ focusDistance: 320 }));
    expect(overviewTarget).not.toBeNull();
    expect(overviewTarget!.scope).toBe('national');
    expect(overviewTarget!.gain).toBeGreaterThan(0.05);
  });

  it('manages AudioEngine mute toggling, interaction playback, and headless simulation event emission', () => {
    const bus = new EventBus();
    const { ctx, stats } = createMockAudioContext();
    const engine = new AudioEngine(bus, {
      initialMuted: true,
      persistMute: false,
      audioContextFactory: () => ctx,
    });

    const world = new WorldState(bus, {
      seed: 90909,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 8,
    });
    const s = world.settlements[0];
    const listener = makeListener({
      focusPos: { x: s.center.x, y: s.groundY, z: s.center.z },
      cameraPos: { x: s.center.x, y: s.groundY + 14, z: s.center.z + 18 },
      focusDistance: 22,
    });

    // While muted, interactions do not trigger audio nodes
    expect(engine.isMuted()).toBe(true);
    engine.update(0.05, world, listener, 1);
    const mutedStart = stats.oscillatorsStarted + stats.buffersStarted;
    bus.emit('creature:interaction', {
      kind: 'greet',
      species: 'fox',
      partnerSpecies: 'robin',
      position: { x: s.center.x, y: s.groundY, z: s.center.z },
      lifeStage: 'adult',
    });
    expect(stats.oscillatorsStarted + stats.buffersStarted).toBe(mutedStart);

    // Unmuting initializes the Web Audio graph and plays creature interactions & festival music
    expect(engine.toggleMuted()).toBe(false);
    expect(engine.isMuted()).toBe(false);
    expect(stats.lastMasterTarget).toBeGreaterThan(0.5);

    engine.update(0.05, world, listener, 1);
    const beforeCall = stats.oscillatorsStarted + stats.buffersStarted;
    bus.emit('creature:interaction', {
      kind: 'greet',
      species: 'fox',
      partnerSpecies: 'robin',
      position: { x: s.center.x, y: s.groundY, z: s.center.z },
      lifeStage: 'adult',
    });
    expect(stats.oscillatorsStarted + stats.buffersStarted).toBeGreaterThan(beforeCall);

    // Muting again ramps master gain down cleanly to 0
    expect(engine.toggleMuted()).toBe(true);
    expect(stats.lastMasterTarget).toBe(0);

    // Verify simulation actually emits creature:interaction events as creatures live & interact
    const observed: CreatureInteractionEvent[] = [];
    bus.on('creature:interaction', (ev) => observed.push(ev));
    world.festivals.startLocalFestival(world, s);
    for (let i = 0; i < 240; i++) {
      world.step(0.1);
    }
    expect(observed.length).toBeGreaterThan(0);

    engine.dispose();
    expect(stats.closed).toBe(true);
  });
});
