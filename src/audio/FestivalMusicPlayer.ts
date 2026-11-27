import type {
  ActiveCelebration,
  AudioListenerFrame,
  CelebrationScope,
  VillageAdaptationId,
} from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { clamp, createPannedOutput, midiToFreq, smoothstep } from './AudioUtils';

export interface ActiveFestivalAudioTarget {
  readonly celebrationId: string;
  readonly scope: CelebrationScope;
  readonly style: VillageAdaptationId;
  readonly gain: number;
  readonly pan: number;
}

interface FolkStyleSpec {
  /** Tempo in beats per minute (eighth-note step grid). */
  readonly bpm: number;
  /** Steps per bar (8 for 4/4 reel/shanty, 6 for 6/8 jig/waltz). */
  readonly stepsPerBar: number;
  /** Scale MIDI pitches (melody register). */
  readonly scale: readonly number[];
  /** Root MIDI pitches for 4-bar harmonic progression (bass register). */
  readonly bassRoots: readonly number[];
  /** 2 sections (A and B) of melody step indices into `scale` (-1 = rest). */
  readonly melodyA: readonly number[];
  readonly melodyB: readonly number[];
  /** Primary melody instrument timbre. */
  readonly leadTimbre: 'flute' | 'fiddle' | 'pipe' | 'oud' | 'marimba';
  /** Accompaniment instrument timbre. */
  readonly accompTimbre: 'lute' | 'harp' | 'oud' | 'drone';
  /** Percussion flavor. */
  readonly percussion: 'bodhran' | 'tambourine' | 'shanty' | 'water_drum';
}

const FOLK_STYLES: Record<VillageAdaptationId, FolkStyleSpec> = {
  // Woodland Celtic reel in D Major (D5..A6)
  forest_canopy: {
    bpm: 122,
    stepsPerBar: 8,
    scale: [62, 64, 66, 67, 69, 71, 73, 74, 76, 78],
    bassRoots: [50, 55, 57, 50], // D, G, A, D
    melodyA: [
      0, 2, 4, 5, 4, 2, 1, -1,
      3, 4, 5, 7, 5, 4, 2, -1,
      4, 5, 7, 8, 7, 5, 4, 2,
      1, 2, 4, 2, 0, -1, 0, -1,
    ],
    melodyB: [
      7, 7, 8, 7, 5, 4, 5, -1,
      5, 5, 7, 5, 4, 2, 4, -1,
      4, 5, 7, 8, 9, 8, 7, 5,
      4, 2, 1, 2, 0, -1, -1, -1,
    ],
    leadTimbre: 'flute',
    accompTimbre: 'lute',
    percussion: 'bodhran',
  },

  // Coastal harbor sea shanty / hornpipe in C Major
  coastal_harbor: {
    bpm: 118,
    stepsPerBar: 8,
    scale: [60, 62, 64, 65, 67, 69, 71, 72, 74, 76],
    bassRoots: [48, 53, 55, 48], // C, F, G, C
    melodyA: [
      4, -1, 4, 5, 7, 5, 4, 2,
      3, -1, 3, 4, 5, 4, 2, 0,
      4, 5, 7, 8, 7, 5, 4, 2,
      4, 2, 0, -1, 0, -1, -1, -1,
    ],
    melodyB: [
      7, -1, 8, 7, 5, 4, 5, 7,
      5, -1, 7, 5, 4, 2, 4, -1,
      2, 4, 5, 7, 8, 7, 5, 4,
      2, 4, 2, 0, 0, -1, -1, -1,
    ],
    leadTimbre: 'fiddle',
    accompTimbre: 'lute',
    percussion: 'shanty',
  },

  // Desert oasis starlight bazaar dance in D Hijaz / Phrygian Dominant
  desert_oasis: {
    bpm: 112,
    stepsPerBar: 8,
    scale: [62, 63, 66, 67, 69, 70, 72, 74, 75, 78],
    bassRoots: [50, 51, 50, 57], // D, Eb, D, A
    melodyA: [
      0, 2, 3, 4, 5, 4, 3, 2,
      1, 2, 3, 2, 0, -1, 2, 3,
      4, 5, 7, 5, 4, 3, 2, 1,
      2, 1, 0, -1, 0, -1, -1, -1,
    ],
    melodyB: [
      7, -1, 7, 8, 7, 5, 4, 5,
      4, 3, 4, 5, 4, 3, 2, -1,
      3, 4, 5, 7, 5, 4, 3, 2,
      1, 2, 0, -1, 0, -1, -1, -1,
    ],
    leadTimbre: 'oud',
    accompTimbre: 'oud',
    percussion: 'tambourine',
  },

  // Prairie pastoral harvest ceilidh / barn dance in G Major
  prairie_pastoral: {
    bpm: 128,
    stepsPerBar: 8,
    scale: [67, 69, 71, 72, 74, 76, 78, 79, 81, 83],
    bassRoots: [55, 48, 50, 55], // G, C, D, G
    melodyA: [
      0, 2, 4, 2, 4, 5, 4, -1,
      3, 5, 7, 5, 4, 2, 0, -1,
      2, 4, 5, 4, 2, 1, 2, 4,
      2, 1, 0, -1, 0, -1, -1, -1,
    ],
    melodyB: [
      7, 5, 4, 5, 7, 8, 7, -1,
      5, 4, 2, 4, 5, 7, 5, -1,
      4, 5, 7, 5, 4, 2, 1, 2,
      4, 2, 0, -1, 0, -1, -1, -1,
    ],
    leadTimbre: 'fiddle',
    accompTimbre: 'lute',
    percussion: 'bodhran',
  },

  // Mountain highland hearth reel in A Mixolydian
  mountain_stone: {
    bpm: 116,
    stepsPerBar: 8,
    scale: [69, 71, 73, 74, 76, 78, 79, 81, 83, 85],
    bassRoots: [57, 55, 50, 57], // A, G, D, A
    melodyA: [
      0, -1, 2, 4, 4, 6, 4, 2,
      3, 4, 6, 4, 2, 0, -1, -1,
      4, 6, 7, 6, 4, 2, 3, 2,
      0, 2, 0, -1, 0, -1, -1, -1,
    ],
    melodyB: [
      7, 7, 6, 4, 6, 7, 8, -1,
      6, 4, 3, 4, 6, 4, 2, -1,
      4, 6, 7, 6, 4, 3, 2, 0,
      2, 4, 0, -1, 0, -1, -1, -1,
    ],
    leadTimbre: 'pipe',
    accompTimbre: 'drone',
    percussion: 'bodhran',
  },

  // Riverside stilts lilting 6/8 lantern jig in F Major
  riverside_stilts: {
    bpm: 108,
    stepsPerBar: 6,
    scale: [65, 67, 69, 70, 72, 74, 76, 77, 79, 81],
    bassRoots: [53, 58, 48, 53], // F, Bb, C, F
    melodyA: [
      0, 2, 4, 5, 4, 2,
      3, 5, 7, 5, 4, -1,
      4, 5, 7, 8, 7, 5,
      4, 2, 0, -1, 0, -1,
    ],
    melodyB: [
      7, 5, 4, 7, 5, 4,
      5, 4, 2, 5, 4, -1,
      2, 4, 5, 7, 5, 4,
      2, 0, 0, -1, -1, -1,
    ],
    leadTimbre: 'flute',
    accompTimbre: 'harp',
    percussion: 'water_drum',
  },

  // Waterway haven playful 6/8 pentatonic water-harp carnival in F Pentatonic
  waterway_haven: {
    bpm: 112,
    stepsPerBar: 6,
    scale: [65, 67, 69, 72, 74, 77, 79, 81, 84, 86],
    bassRoots: [53, 57, 55, 53], // F, A, G, F
    melodyA: [
      0, 2, 3, 5, 3, 2,
      3, 4, 5, 6, 5, -1,
      5, 6, 7, 6, 5, 3,
      2, 3, 0, -1, 0, -1,
    ],
    melodyB: [
      7, 5, 3, 7, 5, 3,
      6, 5, 4, 6, 5, -1,
      3, 4, 5, 7, 6, 5,
      3, 2, 0, -1, -1, -1,
    ],
    leadTimbre: 'marimba',
    accompTimbre: 'harp',
    percussion: 'water_drum',
  },
};

/**
 * Selects the strongest audible festival/celebration relative to the listening anchor
 * and computes its cultural musical style, gain, and stereo pan.
 */
export function selectActiveFestivalMusic(
  world: WorldState,
  listener: AudioListenerFrame,
): ActiveFestivalAudioTarget | null {
  const active = world.festivals.activeCelebrations;
  if (active.length === 0) return null;

  const anchor = listener.isPov ? listener.cameraPos : listener.focusPos;
  let best: ActiveFestivalAudioTarget | null = null;

  const evalVenue = (
    cel: ActiveCelebration,
    venueX: number,
    venueZ: number,
    style: VillageAdaptationId,
  ) => {
    const dist = Math.hypot(venueX - anchor.x, venueZ - anchor.z);
    const maxDist = cel.scope === 'national' ? 160 : cel.scope === 'regional' ? 115 : 88;
    const prox = 1 - smoothstep(10, maxDist, dist);
    const zoomFloor = cel.scope === 'national' ? 0.3 : 0.0;
    const zoomScale = listener.isPov
      ? 1.0
      : Math.max(zoomFloor, 1 - smoothstep(42, 210, listener.focusDistance));
    const baseGain = cel.scope === 'national' ? Math.max(0.28, prox) : prox;
    const underwaterDuck = listener.isUnderwater ? 0.42 : 1.0;
    const gain = clamp(baseGain * zoomScale * underwaterDuck, 0, 1);

    if (gain <= 0.02) return;
    if (!best || gain > best.gain) {
      const dx = venueX - listener.cameraPos.x;
      const dz = venueZ - listener.cameraPos.z;
      const len = Math.max(1, Math.hypot(dx, dz));
      const dotR = (dx * listener.right.x + dz * listener.right.z) / len;
      const pan = cel.scope === 'national' ? clamp(dotR * 0.25, -0.35, 0.35) : clamp(dotR * 0.55, -0.65, 0.65);
      best = {
        celebrationId: cel.id,
        scope: cel.scope,
        style,
        gain,
        pan,
      };
    }
  };

  for (let i = 0; i < active.length; i++) {
    const cel = active[i];
    if (cel.scope === 'national') {
      // National holidays fill EVERY settlement across the realm with celebratory music
      for (let j = 0; j < world.settlements.length; j++) {
        const s = world.settlements[j];
        evalVenue(cel, s.center.x, s.center.z, s.adaptation);
      }
    } else {
      const host = world.getSettlement(cel.hostSettlementId);
      const style: VillageAdaptationId = host?.adaptation ?? 'forest_canopy';
      evalVenue(cel, cel.position.x, cel.position.z, style);
    }
  }

  return best;
}

/**
 * Procedural folk music ensemble for local village festivals, regional jamborees,
 * and realm-wide national holidays. Uses lookahead Web Audio scheduling and
 * biome-adapted rustic instruments (flute, fiddle, lute, harp, oud, marimba,
 * bodhrán, tambourine, and celebratory village bells).
 */
export class FestivalMusicPlayer {
  private readonly busGain: GainNode;
  private currentTarget: ActiveFestivalAudioTarget | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private activeCelebrationId: string | null = null;
  private isPlaying = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly whiteNoise: AudioBuffer,
    private readonly pinkNoise: AudioBuffer,
  ) {
    this.busGain = ctx.createGain();
    this.busGain.gain.value = 0.0001;
    this.busGain.connect(destination);
  }

  getCurrentTarget(): ActiveFestivalAudioTarget | null {
    return this.currentTarget;
  }

  update(
    world: WorldState,
    listener: AudioListenerFrame,
    paused: boolean,
  ): void {
    const target = selectActiveFestivalMusic(world, listener);
    this.currentTarget = target;
    const now = this.ctx.currentTime;

    if (!target || paused) {
      this.busGain.gain.setTargetAtTime(0.0001, now, 0.35);
      if (!target) {
        this.isPlaying = false;
        this.activeCelebrationId = null;
      }
      return;
    }

    // Smoothly ramp master festival volume based on spatial proximity
    const masterLevel = 0.34 * target.gain;
    this.busGain.gain.setTargetAtTime(masterLevel, now, 0.38);

    if (!this.isPlaying || this.activeCelebrationId !== target.celebrationId) {
      this.isPlaying = true;
      this.activeCelebrationId = target.celebrationId;
      this.stepIndex = 0;
      this.nextStepTime = now + 0.08;
    }

    // Catch up cleanly if the tab was backgrounded
    if (this.nextStepTime < now - 0.35) {
      this.nextStepTime = now + 0.05;
    }

    const spec = FOLK_STYLES[target.style];
    const stepDur = 60 / spec.bpm / 2; // eighth-note grid
    const scheduleAhead = 0.18;

    while (this.nextStepTime < now + scheduleAhead) {
      this.scheduleStep(spec, target.scope, target.pan, this.stepIndex, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex++;
    }
  }

  private scheduleStep(
    spec: FolkStyleSpec,
    scope: CelebrationScope,
    basePan: number,
    step: number,
    time: number,
    stepDur: number,
  ): void {
    const phraseLen = spec.melodyA.length;
    const cyclePos = step % (phraseLen * 4);
    // Classic folk A-A-B-A form
    const section = Math.floor(cyclePos / phraseLen);
    const localStep = cyclePos % phraseLen;
    const melodyArr = section === 2 ? spec.melodyB : spec.melodyA;
    const barIndex = Math.floor(localStep / spec.stepsPerBar) % spec.bassRoots.length;
    const beatInBar = localStep % spec.stepsPerBar;
    const bassMidi = spec.bassRoots[barIndex];

    // 1. Melody instrument (slightly left of center for warm stereo spread)
    const melDegree = melodyArr[localStep];
    if (melDegree >= 0 && melDegree < spec.scale.length) {
      const freq = midiToFreq(spec.scale[melDegree]);
      const accent = beatInBar === 0 ? 1.0 : beatInBar % 2 === 0 ? 0.88 : 0.76;
      const pan = clamp(basePan - 0.16, -0.85, 0.85);
      this.playLeadNote(spec.leadTimbre, freq, time, stepDur * 1.15, 0.22 * accent, pan);
    }

    // 2. Plucked accompaniment / chord arpeggio (slightly right of center)
    const accompPan = clamp(basePan + 0.18, -0.85, 0.85);
    if (spec.accompTimbre === 'drone') {
      if (beatInBar === 0) {
        this.playDroneChord(midiToFreq(bassMidi), midiToFreq(bassMidi + 7), time, stepDur * spec.stepsPerBar, 0.12, accompPan);
      }
    } else if (beatInBar === 0) {
      this.playPluck(spec.accompTimbre, midiToFreq(bassMidi), time, stepDur * 2.4, 0.24, accompPan);
    } else if (beatInBar === 2 || beatInBar === 4 || (spec.stepsPerBar === 8 && beatInBar === 6)) {
      const chordInterval = beatInBar === 2 ? 7 : beatInBar === 4 ? 12 : 4;
      this.playPluck(
        spec.accompTimbre,
        midiToFreq(bassMidi + chordInterval),
        time,
        stepDur * 1.6,
        0.14,
        accompPan,
      );
    }

    // 3. Rustic percussion pulse
    this.schedulePercussion(spec.percussion, beatInBar, spec.stepsPerBar, time, basePan);

    // 4. Celebratory village bells / harmonic glockenspiel on Regional & National Holidays!
    if (scope !== 'local' && beatInBar === 0) {
      const bellProb = scope === 'national' ? 1.0 : 0.5;
      if (barIndex % (bellProb >= 1 ? 1 : 2) === 0) {
        const bellMidi = spec.scale[Math.min(spec.scale.length - 1, (barIndex * 2) % 5)] + 12;
        this.playFestiveBell(
          midiToFreq(bellMidi),
          time,
          scope === 'national' ? 0.13 : 0.08,
          clamp(basePan + (barIndex % 2 === 0 ? -0.24 : 0.24), -0.8, 0.8),
        );
      }
    }
  }

  private playLeadNote(
    timbre: FolkStyleSpec['leadTimbre'],
    freq: number,
    time: number,
    dur: number,
    amp: number,
    pan: number,
  ): void {
    const out = createPannedOutput(this.ctx, this.busGain, pan, 1.0);

    if (timbre === 'flute' || timbre === 'pipe') {
      const osc = this.ctx.createOscillator();
      osc.type = timbre === 'flute' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      // Gentle warm vibrato
      const vib = this.ctx.createOscillator();
      const vibG = this.ctx.createGain();
      vib.frequency.value = 5.4;
      vibG.gain.value = freq * 0.008;
      vib.connect(vibG);
      vibG.connect(osc.frequency);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp, time + 0.025);
      env.gain.setValueAtTime(amp * 0.82, time + dur * 0.65);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.04);

      osc.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + dur + 0.06);
      vib.start(time);
      vib.stop(time + dur + 0.06);

      // Subtle breath chiff on attack
      const breath = this.ctx.createBufferSource();
      breath.buffer = this.pinkNoise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = clamp(freq * 1.5, 500, 4200);
      bp.Q.value = 2.6;
      const bEnv = this.ctx.createGain();
      bEnv.gain.setValueAtTime(0.0001, time);
      bEnv.gain.linearRampToValueAtTime(amp * 0.14, time + 0.014);
      bEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.075);
      breath.connect(bp);
      bp.connect(bEnv);
      bEnv.connect(out);
      breath.start(time, Math.random());
      breath.stop(time + 0.09);
      return;
    }

    if (timbre === 'fiddle') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);
      const body = this.ctx.createBiquadFilter();
      body.type = 'bandpass';
      body.frequency.value = clamp(freq * 1.4, 480, 2600);
      body.Q.value = 1.6;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp * 0.85, time + 0.032);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.05);

      osc.connect(body);
      body.connect(lp);
      lp.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + dur + 0.07);
      return;
    }

    if (timbre === 'marimba') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const over = this.ctx.createOscillator();
      over.type = 'sine';
      over.frequency.value = freq * 4;
      const overG = this.ctx.createGain();
      overG.gain.setValueAtTime(amp * 0.18, time);
      overG.gain.exponentialRampToValueAtTime(0.0001, time + 0.065);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp * 1.05, time + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur * 1.25);

      osc.connect(env);
      over.connect(overG);
      overG.connect(out);
      env.connect(out);
      osc.start(time);
      osc.stop(time + dur * 1.3 + 0.05);
      over.start(time);
      over.stop(time + 0.08);
      return;
    }

    // Plucked oud lead
    this.playPluck('oud', freq, time, dur * 1.45, amp * 1.05, pan);
  }

  private playPluck(
    timbre: 'lute' | 'harp' | 'oud',
    freq: number,
    time: number,
    dur: number,
    amp: number,
    pan: number,
  ): void {
    const out = createPannedOutput(this.ctx, this.busGain, pan, 1.0);
    const osc = this.ctx.createOscillator();
    osc.type = timbre === 'harp' ? 'triangle' : 'sawtooth';
    osc.frequency.value = freq;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const startCut = timbre === 'oud' ? freq * 5.2 : timbre === 'lute' ? freq * 4.4 : freq * 3.6;
    lp.frequency.setValueAtTime(clamp(startCut, 380, 4800), time);
    lp.frequency.exponentialRampToValueAtTime(clamp(freq * 1.35, 220, 1600), time + dur);
    lp.Q.value = 1.1;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(amp * 0.72, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(lp);
    lp.connect(env);
    env.connect(out);
    osc.start(time);
    osc.stop(time + dur + 0.04);
  }

  private playDroneChord(
    rootFreq: number,
    fifthFreq: number,
    time: number,
    dur: number,
    amp: number,
    pan: number,
  ): void {
    const out = createPannedOutput(this.ctx, this.busGain, pan, 1.0);
    for (const f of [rootFreq, fifthFreq]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 680;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp, time + 0.08);
      env.gain.setValueAtTime(amp * 0.85, time + dur * 0.78);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.06);
      osc.connect(lp);
      lp.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + dur + 0.08);
    }
  }

  private schedulePercussion(
    kind: FolkStyleSpec['percussion'],
    beatInBar: number,
    stepsPerBar: number,
    time: number,
    pan: number,
  ): void {
    const out = createPannedOutput(this.ctx, this.busGain, pan * 0.5, 1.0);

    // Warm hand-drum downbeat / secondary pulse
    const isDownbeat = beatInBar === 0;
    const isMidPulse =
      (stepsPerBar === 8 && (beatInBar === 4 || beatInBar === 6)) ||
      (stepsPerBar === 6 && beatInBar === 3);

    if (isDownbeat || isMidPulse) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      const startF = kind === 'water_drum' ? 148 : isDownbeat ? 112 : 142;
      const endF = kind === 'water_drum' ? 78 : 54;
      osc.frequency.setValueAtTime(startF, time);
      osc.frequency.exponentialRampToValueAtTime(endF, time + 0.11);
      const amp = isDownbeat ? 0.25 : 0.14;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp, time + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
      osc.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + 0.17);
    }

    // Crisp tambourine / shaker off-beats
    const isShaker =
      kind === 'tambourine'
        ? beatInBar % 2 === 1
        : beatInBar === 2 || (stepsPerBar === 8 && beatInBar === 6);
    if (isShaker) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = kind === 'tambourine' ? 6200 : 4100;
      hp.Q.value = kind === 'tambourine' ? 2.4 : 1.8;
      const env = this.ctx.createGain();
      const amp = kind === 'tambourine' ? 0.095 : 0.045;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp, time + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      src.connect(hp);
      hp.connect(env);
      env.connect(out);
      src.start(time, Math.random());
      src.stop(time + 0.065);
    }
  }

  private playFestiveBell(freq: number, time: number, amp: number, pan: number): void {
    const out = createPannedOutput(this.ctx, this.busGain, pan, 1.0);
    const ratios = [1, 2.0, 2.98];
    ratios.forEach((r, idx) => {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * r;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(amp / (idx + 1), time + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 1.15 / (idx * 0.7 + 1));
      osc.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + 1.25);
    });
  }

  dispose(): void {
    this.isPlaying = false;
    this.activeCelebrationId = null;
    try {
      this.busGain.disconnect();
    } catch {
      // Ignore already disconnected node
    }
  }
}
