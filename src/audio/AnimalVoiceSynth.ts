import type {
  CombatEffectKind,
  CreatureInteractionKind,
  DivineEventType,
  LifeStage,
  SpeciesId,
} from '@core/Types';
import { clamp, createPannedOutput } from './AudioUtils';

export type VocalMood =
  | 'friendly'
  | 'playful'
  | 'affectionate'
  | 'excited'
  | 'aggressive'
  | 'alarmed'
  | 'solemn';

export interface AnimalVoiceOptions {
  readonly species: SpeciesId;
  readonly mood: VocalMood;
  readonly lifeStage?: LifeStage;
  readonly gain: number;
  readonly pan: number;
  /** Optional delay in seconds before starting (useful for duet call-and-response). */
  readonly delaySec?: number;
}

interface SynthContext {
  readonly ctx: AudioContext;
  readonly out: AudioNode;
  readonly whiteNoise: AudioBuffer;
  readonly pinkNoise: AudioBuffer;
  readonly startTime: number;
  readonly pitchScale: number;
  readonly mood: VocalMood;
  readonly rand: () => number;
}

export function interactionKindToMood(kind: CreatureInteractionKind): VocalMood {
  switch (kind) {
    case 'greet':
    case 'trade':
    case 'build':
      return 'friendly';
    case 'play':
      return 'playful';
    case 'court':
    case 'birth':
      return 'affectionate';
    case 'celebrate':
      return 'excited';
    case 'argue':
    case 'combat_call':
      return 'aggressive';
    case 'alarm':
      return 'alarmed';
    case 'pray':
      return 'solemn';
  }
}

export function getLifeStagePitchMultiplier(stage: LifeStage = 'adult'): number {
  switch (stage) {
    case 'young':
      return 1.32;
    case 'juvenile':
      return 1.15;
    case 'elder':
      return 0.91;
    case 'adult':
    default:
      return 1.0;
  }
}

function randRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

/** Schedules a shaped noise burst through a bandpass filter. */
function scheduleNoiseBurst(
  sc: SynthContext,
  buffer: AudioBuffer,
  offsetSec: number,
  dur: number,
  freqStart: number,
  freqEnd: number,
  q: number,
  amp: number,
  attackFrac = 0.16,
): void {
  const { ctx, out, startTime } = sc;
  const t0 = startTime + offsetSec;
  const t1 = t0 + Math.max(0.025, dur);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(clamp(freqStart, 80, 12000), t0);
  filter.frequency.exponentialRampToValueAtTime(clamp(freqEnd, 80, 12000), t1);

  const env = ctx.createGain();
  const atk = Math.max(0.005, dur * attackFrac);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(amp, t0 + atk);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);

  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(t0, sc.rand() * Math.max(0.1, buffer.duration - 0.1));
  src.stop(t1 + 0.02);
}

/** Schedules a vocal-tract formant voice (oscillator through 1-2 resonant bandpass formants + optional AM roughness). */
function scheduleFormantVoice(
  sc: SynthContext,
  opts: {
    offsetSec: number;
    dur: number;
    wave: OscillatorType;
    f0Start: number;
    f0Mid?: number;
    f0End: number;
    formant1Start: number;
    formant1End: number;
    q1?: number;
    formant2Start?: number;
    formant2End?: number;
    q2?: number;
    amp: number;
    attackFrac?: number;
    amRateHz?: number;
    amDepth?: number;
    vibRateHz?: number;
    vibDepthHz?: number;
  },
): void {
  const { ctx, out, startTime, pitchScale } = sc;
  const t0 = startTime + opts.offsetSec;
  const dur = Math.max(0.03, opts.dur);
  const tMid = t0 + dur * 0.42;
  const t1 = t0 + dur;

  const osc = ctx.createOscillator();
  osc.type = opts.wave;
  osc.frequency.setValueAtTime(clamp(opts.f0Start * pitchScale, 42, 9000), t0);
  if (opts.f0Mid !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(clamp(opts.f0Mid * pitchScale, 42, 9000), tMid);
  }
  osc.frequency.exponentialRampToValueAtTime(clamp(opts.f0End * pitchScale, 42, 9000), t1);

  // Optional vibrato / syrinx FM
  if (opts.vibRateHz && opts.vibDepthHz) {
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.type = 'sine';
    vib.frequency.value = opts.vibRateHz;
    vibGain.gain.value = opts.vibDepthHz * pitchScale;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vib.start(t0);
    vib.stop(t1 + 0.02);
  }

  const bp1 = ctx.createBiquadFilter();
  bp1.type = 'bandpass';
  bp1.Q.value = opts.q1 ?? 3.2;
  bp1.frequency.setValueAtTime(clamp(opts.formant1Start * Math.sqrt(pitchScale), 90, 9500), t0);
  bp1.frequency.exponentialRampToValueAtTime(
    clamp(opts.formant1End * Math.sqrt(pitchScale), 90, 9500),
    t1,
  );

  const env = ctx.createGain();
  const atk = Math.max(0.006, dur * (opts.attackFrac ?? 0.14));
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(opts.amp, t0 + atk);
  env.gain.setValueAtTime(opts.amp * 0.88, t0 + dur * 0.72);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(bp1);
  bp1.connect(env);

  if (opts.formant2Start !== undefined && opts.formant2End !== undefined) {
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = opts.q2 ?? 4.0;
    bp2.frequency.setValueAtTime(clamp(opts.formant2Start * Math.sqrt(pitchScale), 140, 10000), t0);
    bp2.frequency.exponentialRampToValueAtTime(
      clamp(opts.formant2End * Math.sqrt(pitchScale), 140, 10000),
      t1,
    );
    const bp2Gain = ctx.createGain();
    bp2Gain.gain.value = 0.62;
    osc.connect(bp2);
    bp2.connect(bp2Gain);
    bp2Gain.connect(env);
  }

  // Optional amplitude modulation for throaty rasp, frog trill, pigeon coo roll, growl flutter
  if (opts.amRateHz && opts.amDepth) {
    const amGate = ctx.createGain();
    amGate.gain.value = 1 - opts.amDepth * 0.5;
    const amOsc = ctx.createOscillator();
    const amGain = ctx.createGain();
    amOsc.type = 'sine';
    amOsc.frequency.value = opts.amRateHz;
    amGain.gain.value = opts.amDepth * 0.5;
    amOsc.connect(amGain);
    amGain.connect(amGate.gain);
    env.connect(amGate);
    amGate.connect(out);
    amOsc.start(t0);
    amOsc.stop(t1 + 0.02);
  } else {
    env.connect(out);
  }

  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Schedules a pure melodic syrinx chirp/whistle note (for songbirds, otters, owls, mice). */
function scheduleSyrinxNote(
  sc: SynthContext,
  opts: {
    offsetSec: number;
    dur: number;
    fStart: number;
    fMid?: number;
    fEnd: number;
    amp: number;
    harmonic2?: number;
    fmRateHz?: number;
    fmDepthHz?: number;
    attackFrac?: number;
  },
): void {
  const { ctx, out, startTime, pitchScale } = sc;
  const t0 = startTime + opts.offsetSec;
  const dur = Math.max(0.028, opts.dur);
  const tMid = t0 + dur * 0.45;
  const t1 = t0 + dur;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(clamp(opts.fStart * pitchScale, 120, 7600), t0);
  if (opts.fMid !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(clamp(opts.fMid * pitchScale, 120, 7600), tMid);
  }
  osc.frequency.exponentialRampToValueAtTime(clamp(opts.fEnd * pitchScale, 120, 7600), t1);

  if (opts.fmRateHz && opts.fmDepthHz) {
    const fm = ctx.createOscillator();
    const fmGain = ctx.createGain();
    fm.type = 'sine';
    fm.frequency.value = opts.fmRateHz;
    fmGain.gain.value = opts.fmDepthHz;
    fm.connect(fmGain);
    fmGain.connect(osc.frequency);
    fm.start(t0);
    fm.stop(t1 + 0.02);
  }

  const env = ctx.createGain();
  const atk = Math.max(0.004, dur * (opts.attackFrac ?? 0.16));
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(opts.amp, t0 + atk);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(env);
  env.connect(out);
  osc.start(t0);
  osc.stop(t1 + 0.02);

  if (opts.harmonic2 && opts.harmonic2 > 0) {
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(clamp(opts.fStart * 2 * pitchScale, 200, 8800), t0);
    if (opts.fMid !== undefined) {
      osc2.frequency.exponentialRampToValueAtTime(clamp(opts.fMid * 2 * pitchScale, 200, 8800), tMid);
    }
    osc2.frequency.exponentialRampToValueAtTime(clamp(opts.fEnd * 2 * pitchScale, 200, 8800), t1);
    const h2Gain = ctx.createGain();
    h2Gain.gain.value = opts.harmonic2;
    osc2.connect(h2Gain);
    h2Gain.connect(env);
    osc2.start(t0);
    osc2.stop(t1 + 0.02);
  }
}

type SpeciesSynthFn = (sc: SynthContext) => void;

/**
 * Exhaustive bioacoustic synthesis library for all 24 woodland species.
 * Every vocalization uses formant/syrinx/turbulent modeling shaped by emotional mood.
 */
const SPECIES_SYNTHS: Record<SpeciesId, SpeciesSynthFn> = {
  // 1. Crow: harsh nasal raspy "caw-caw"
  crow(sc) {
    const aggressive = sc.mood === 'aggressive' || sc.mood === 'alarmed';
    const count = aggressive ? (sc.rand() < 0.5 ? 3 : 2) : sc.rand() < 0.65 ? 2 : 1;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = aggressive ? randRange(sc.rand, 0.18, 0.25) : randRange(sc.rand, 0.24, 0.34);
      const base = aggressive ? randRange(sc.rand, 310, 380) : randRange(sc.rand, 255, 315);
      scheduleFormantVoice(sc, {
        offsetSec: offset,
        dur,
        wave: 'sawtooth',
        f0Start: base * 1.06,
        f0Mid: base,
        f0End: base * 0.82,
        formant1Start: 920,
        formant1End: 760,
        q1: 3.4,
        formant2Start: 1850,
        formant2End: 1520,
        q2: 3.8,
        amp: 0.42,
        amRateHz: randRange(sc.rand, 38, 54),
        amDepth: 0.48,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, offset, dur * 0.85, 1650, 1250, 2.2, 0.12);
      offset += dur + randRange(sc.rand, 0.1, 0.17);
    }
  },

  // 2. Sparrow: bright cheerful melodic "cheep-cheep-chirrup"
  sparrow(sc) {
    const excited = sc.mood === 'excited' || sc.mood === 'playful';
    const count = excited ? 4 : sc.mood === 'alarmed' ? 3 : 2 + (sc.rand() < 0.5 ? 1 : 0);
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = randRange(sc.rand, 0.055, 0.095);
      const hi = randRange(sc.rand, 3400, 4600);
      const lo = hi * randRange(sc.rand, 0.68, 0.82);
      const rising = i % 2 === 0;
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: rising ? lo : hi,
        fMid: rising ? hi * 1.06 : lo * 1.12,
        fEnd: rising ? hi * 0.92 : lo * 0.88,
        amp: 0.22,
        harmonic2: 0.12,
        fmRateHz: 32,
        fmDepthHz: 110,
      });
      offset += dur + randRange(sc.rand, 0.05, 0.11);
    }
  },

  // 3. Robin: liquid flute-like dawn warble ("cheerily-cheer-up")
  robin(sc) {
    const notes = sc.mood === 'alarmed' ? 2 : 3 + (sc.rand() < 0.55 ? 1 : 0);
    const palette = [2250, 2680, 3120, 2480, 2940, 2100];
    let offset = 0;
    for (let i = 0; i < notes; i++) {
      const fA = palette[(i + Math.floor(sc.rand() * 3)) % palette.length] * randRange(sc.rand, 0.94, 1.06);
      const fB = fA * (i % 2 === 0 ? 1.18 : 0.84);
      const dur = randRange(sc.rand, 0.11, 0.17);
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: fA,
        fMid: (fA + fB) * 0.54,
        fEnd: fB,
        amp: 0.24,
        harmonic2: 0.1,
        fmRateHz: 15,
        fmDepthHz: 55,
        attackFrac: 0.22,
      });
      offset += dur + randRange(sc.rand, 0.04, 0.085);
    }
  },

  // 4. Owl: hollow resonant woodland hoot ("hoo, hoo-hoo, hoooo")
  owl(sc) {
    const base = randRange(sc.rand, 320, 395);
    const pattern: Array<{ delay: number; dur: number; mul: number }> =
      sc.mood === 'aggressive' || sc.mood === 'alarmed'
        ? [
            { delay: 0, dur: 0.22, mul: 1.12 },
            { delay: 0.28, dur: 0.34, mul: 0.96 },
          ]
        : [
            { delay: 0, dur: 0.26, mul: 1.0 },
            { delay: 0.42, dur: 0.16, mul: 1.04 },
            { delay: 0.64, dur: 0.52, mul: 0.94 },
          ];
    for (const p of pattern) {
      const f = base * p.mul;
      scheduleSyrinxNote(sc, {
        offsetSec: p.delay,
        dur: p.dur,
        fStart: f * 0.91,
        fMid: f * 1.01,
        fEnd: f * 0.95,
        amp: 0.34,
        harmonic2: 0.09,
        fmRateHz: 5.5,
        fmDepthHz: 6,
        attackFrac: 0.25,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, p.delay, p.dur * 0.75, 580, 480, 2.5, 0.045, 0.3);
    }
  },

  // 5. Pigeon: soft warm throat-rolled dove coo ("coo-roo-c'too-coo")
  pigeon(sc) {
    const base = randRange(sc.rand, 410, 495);
    const syllables = [
      { delay: 0, dur: 0.24, f0: base * 0.94, f1: base * 1.08, roll: 30 },
      { delay: 0.28, dur: 0.34, f0: base * 1.08, f1: base * 0.88, roll: 28 },
      { delay: 0.66, dur: 0.22, f0: base * 0.96, f1: base * 0.82, roll: 24 },
    ];
    for (const s of syllables) {
      scheduleFormantVoice(sc, {
        offsetSec: s.delay,
        dur: s.dur,
        wave: 'triangle',
        f0Start: s.f0,
        f0Mid: (s.f0 + s.f1) * 0.53,
        f0End: s.f1,
        formant1Start: 540,
        formant1End: 460,
        q1: 2.2,
        amp: 0.36,
        attackFrac: 0.22,
        amRateHz: s.roll,
        amDepth: 0.55,
      });
    }
  },

  // 6. Magpie: rapid rattling dry chatter + quirky melodic chortle
  magpie(sc) {
    const rattles = 4 + Math.floor(sc.rand() * 3);
    let offset = 0;
    for (let i = 0; i < rattles; i++) {
      const dur = randRange(sc.rand, 0.042, 0.062);
      scheduleFormantVoice(sc, {
        offsetSec: offset,
        dur,
        wave: 'sawtooth',
        f0Start: randRange(sc.rand, 420, 560),
        f0End: randRange(sc.rand, 320, 410),
        formant1Start: 1450,
        formant1End: 1100,
        q1: 4.5,
        amp: 0.34,
        attackFrac: 0.1,
      });
      scheduleNoiseBurst(sc, sc.whiteNoise, offset, dur * 0.8, 2200, 1500, 3.0, 0.14, 0.08);
      offset += dur + randRange(sc.rand, 0.028, 0.048);
    }
    if (sc.mood === 'friendly' || sc.mood === 'excited' || sc.mood === 'affectionate') {
      scheduleSyrinxNote(sc, {
        offsetSec: offset + 0.03,
        dur: 0.16,
        fStart: 1950,
        fMid: 2480,
        fEnd: 1620,
        amp: 0.2,
        harmonic2: 0.15,
      });
    }
  },

  // 7. Frog: resonant vocal-sac "rib-bit" / deep croak
  frog(sc) {
    const doubleCroak = sc.rand() < 0.72;
    const base = randRange(sc.rand, 98, 140);
    const playCroak = (delay: number, rising: boolean) => {
      const dur = rising ? 0.14 : 0.21;
      scheduleFormantVoice(sc, {
        offsetSec: delay,
        dur,
        wave: 'sawtooth',
        f0Start: rising ? base : base * 1.15,
        f0Mid: rising ? base * 1.28 : base * 1.04,
        f0End: rising ? base * 1.42 : base * 0.88,
        formant1Start: rising ? 380 : 480,
        formant1End: rising ? 620 : 390,
        q1: 5.0,
        formant2Start: 1050,
        formant2End: rising ? 1420 : 960,
        q2: 4.8,
        amp: 0.52,
        amRateHz: randRange(sc.rand, 26, 36),
        amDepth: 0.65,
      });
    };
    playCroak(0, true);
    if (doubleCroak) {
      playCroak(0.22, false);
    }
  },

  // 8. Fox: crisp yip-bark or playful gekkering chatter
  fox(sc) {
    if (sc.mood === 'playful' || sc.mood === 'affectionate' || sc.mood === 'excited') {
      // Playful fox "gekkering" laugh-chatter
      const count = 4;
      let offset = 0;
      for (let i = 0; i < count; i++) {
        const dur = randRange(sc.rand, 0.075, 0.11);
        const f0 = randRange(sc.rand, 640, 880) * (1 - i * 0.05);
        scheduleFormantVoice(sc, {
          offsetSec: offset,
          dur,
          wave: 'sawtooth',
          f0Start: f0 * 0.88,
          f0Mid: f0 * 1.18,
          f0End: f0 * 0.76,
          formant1Start: 1350,
          formant1End: 980,
          q1: 3.4,
          amp: 0.34,
          amRateHz: 42,
          amDepth: 0.35,
        });
        offset += dur + 0.045;
      }
      return;
    }

    // Crisp yip / bark
    const barks = sc.mood === 'aggressive' || sc.mood === 'alarmed' ? 2 : 1;
    for (let i = 0; i < barks; i++) {
      const t = i * 0.26;
      scheduleFormantVoice(sc, {
        offsetSec: t,
        dur: 0.16,
        wave: 'sawtooth',
        f0Start: 560,
        f0Mid: sc.mood === 'alarmed' ? 1120 : 920,
        f0End: 460,
        formant1Start: 1200,
        formant1End: 1650,
        q1: 3.2,
        formant2Start: 2200,
        formant2End: 1700,
        q2: 3.5,
        amp: 0.42,
        attackFrac: 0.12,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, t, 0.12, 1900, 1300, 2.2, 0.1);
    }
  },

  // 9. Wolf: resonant woodland howl, warm woof, or guttural growl
  wolf(sc) {
    if (sc.mood === 'aggressive') {
      // Deep snarl-growl + short bark
      scheduleFormantVoice(sc, {
        offsetSec: 0,
        dur: 0.48,
        wave: 'sawtooth',
        f0Start: 118,
        f0Mid: 102,
        f0End: 84,
        formant1Start: 360,
        formant1End: 280,
        q1: 2.8,
        formant2Start: 780,
        formant2End: 620,
        q2: 3.2,
        amp: 0.54,
        amRateHz: 24,
        amDepth: 0.62,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, 0.04, 0.38, 650, 420, 1.8, 0.14);
      return;
    }

    if (sc.mood === 'solemn' || sc.mood === 'excited' || (sc.mood === 'affectionate' && sc.rand() < 0.55)) {
      // Expressive wolf howl
      const fBase = randRange(sc.rand, 250, 325);
      const dur = randRange(sc.rand, 1.15, 1.65);
      scheduleFormantVoice(sc, {
        offsetSec: 0,
        dur,
        wave: 'sawtooth',
        f0Start: fBase * 0.85,
        f0Mid: fBase * 1.42,
        f0End: fBase * 1.04,
        formant1Start: 540,
        formant1End: 660,
        q1: 3.8,
        formant2Start: 1180,
        formant2End: 980,
        q2: 4.2,
        amp: 0.38,
        attackFrac: 0.24,
        vibRateHz: 4.8,
        vibDepthHz: 7,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, 0.08, dur * 0.85, 820, 620, 2.5, 0.05, 0.3);
      return;
    }

    // Friendly warm woof / playful yip
    const count = sc.mood === 'playful' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      scheduleFormantVoice(sc, {
        offsetSec: i * 0.24,
        dur: 0.16,
        wave: 'sawtooth',
        f0Start: 220,
        f0Mid: 310,
        f0End: 155,
        formant1Start: 580,
        formant1End: 420,
        q1: 2.6,
        amp: 0.44,
        attackFrac: 0.12,
      });
    }
  },

  // 10. Bear: deep warm chest grunt / huff or rolling roar
  bear(sc) {
    if (sc.mood === 'aggressive' || sc.mood === 'alarmed') {
      scheduleFormantVoice(sc, {
        offsetSec: 0,
        dur: 0.62,
        wave: 'sawtooth',
        f0Start: 128,
        f0Mid: 105,
        f0End: 74,
        formant1Start: 320,
        formant1End: 230,
        q1: 2.4,
        formant2Start: 690,
        formant2End: 460,
        q2: 2.8,
        amp: 0.62,
        amRateHz: 19,
        amDepth: 0.52,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, 0.03, 0.52, 520, 310, 1.5, 0.2);
      return;
    }

    // Gentle friendly bear double-grunt / warm huff
    for (let i = 0; i < 2; i++) {
      const t = i * 0.24;
      scheduleFormantVoice(sc, {
        offsetSec: t,
        dur: 0.19,
        wave: 'sawtooth',
        f0Start: 98 + i * 10,
        f0Mid: 112,
        f0End: 82,
        formant1Start: 270,
        formant1End: 210,
        q1: 2.3,
        amp: 0.46,
        attackFrac: 0.2,
        amRateHz: 16,
        amDepth: 0.3,
      });
      scheduleNoiseBurst(sc, sc.pinkNoise, t, 0.15, 420, 290, 1.6, 0.09);
    }
  },

  // 11. Cat: expressive vowel-morphing meow, bubbly "mrrp!" trill, or sibilant hiss
  cat(sc) {
    if (sc.mood === 'aggressive' || sc.mood === 'alarmed') {
      // Classic feline hiss + short sharp yowl
      scheduleNoiseBurst(sc, sc.whiteNoise, 0, 0.34, 4800, 3600, 1.6, 0.26, 0.08);
      scheduleFormantVoice(sc, {
        offsetSec: 0.06,
        dur: 0.28,
        wave: 'sawtooth',
        f0Start: 520,
        f0Mid: 780,
        f0End: 440,
        formant1Start: 1400,
        formant1End: 950,
        q1: 4.0,
        amp: 0.34,
      });
      return;
    }

    if (sc.mood === 'playful' || (sc.mood === 'friendly' && sc.rand() < 0.45)) {
      // Affectionate feline greeting trill ("mrrrp!")
      scheduleFormantVoice(sc, {
        offsetSec: 0,
        dur: 0.24,
        wave: 'triangle',
        f0Start: 390,
        f0Mid: 610,
        f0End: 740,
        formant1Start: 780,
        formant1End: 1450,
        q1: 3.4,
        amp: 0.4,
        amRateHz: 32,
        amDepth: 0.45,
      });
      return;
    }

    // Classic vowel-swept "me-ow"
    const base = randRange(sc.rand, 460, 580);
    scheduleFormantVoice(sc, {
      offsetSec: 0,
      dur: 0.44,
      wave: 'sawtooth',
      f0Start: base * 0.92,
      f0Mid: base * 1.38,
      f0End: base * 0.88,
      formant1Start: 860,
      formant1End: 1480,
      q1: 3.8,
      formant2Start: 1950,
      formant2End: 1120,
      q2: 4.2,
      amp: 0.38,
      attackFrac: 0.18,
      vibRateHz: 7,
      vibDepthHz: 11,
    });
  },

  // 12. Squirrel: crisp staccato chattering bark ("chuk-chuk-chuk-chrr!")
  squirrel(sc) {
    const count = sc.mood === 'alarmed' || sc.mood === 'aggressive' ? 5 : 3;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = i === count - 1 ? 0.12 : randRange(sc.rand, 0.048, 0.068);
      const f0 = randRange(sc.rand, 1350, 1950);
      scheduleFormantVoice(sc, {
        offsetSec: offset,
        dur,
        wave: 'sawtooth',
        f0Start: f0 * 1.18,
        f0End: f0 * 0.62,
        formant1Start: 2450,
        formant1End: 1650,
        q1: 4.2,
        amp: 0.3,
        attackFrac: 0.08,
        amRateHz: i === count - 1 ? 45 : 0,
        amDepth: i === count - 1 ? 0.55 : 0,
      });
      offset += dur + randRange(sc.rand, 0.045, 0.075);
    }
  },

  // 13. Mouse: delicate high airy squeaks ("peep-squeak")
  mouse(sc) {
    const count = sc.mood === 'playful' || sc.mood === 'excited' ? 3 : 2;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = randRange(sc.rand, 0.045, 0.072);
      const peak = randRange(sc.rand, 4300, 5800);
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: peak * 0.82,
        fMid: peak,
        fEnd: peak * 0.78,
        amp: 0.15,
        fmRateHz: 42,
        fmDepthHz: 95,
      });
      offset += dur + randRange(sc.rand, 0.045, 0.085);
    }
  },

  // 14. Rat: expressive mid-high squeak & lively chitter
  rat(sc) {
    const count = sc.mood === 'aggressive' ? 3 : 2;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = randRange(sc.rand, 0.065, 0.105);
      const f = randRange(sc.rand, 2350, 3250);
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: f * 0.85,
        fMid: f * 1.12,
        fEnd: f * 0.76,
        amp: 0.18,
        harmonic2: 0.16,
        fmRateHz: 36,
        fmDepthHz: 120,
      });
      offset += dur + randRange(sc.rand, 0.055, 0.09);
    }
  },

  // 15. Rabbit: soft affectionate nasal honk-grunt or warning foot-thump
  rabbit(sc) {
    if (sc.mood === 'alarmed' || sc.mood === 'aggressive') {
      // Signature rabbit warning foot-thump (damped low impact)
      for (let i = 0; i < 2; i++) {
        const t = sc.startTime + i * 0.22;
        const osc = sc.ctx.createOscillator();
        const env = sc.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
        env.gain.setValueAtTime(0.001, t);
        env.gain.linearRampToValueAtTime(0.42, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        osc.connect(env);
        env.connect(sc.out);
        osc.start(t);
        osc.stop(t + 0.15);
      }
      return;
    }

    // Soft cozy bunny nasal honk-grunt ("hnk-hnk")
    for (let i = 0; i < 2; i++) {
      scheduleFormantVoice(sc, {
        offsetSec: i * 0.15,
        dur: 0.1,
        wave: 'triangle',
        f0Start: 275,
        f0Mid: 340,
        f0End: 240,
        formant1Start: 560,
        formant1End: 480,
        q1: 3.0,
        amp: 0.34,
      });
    }
  },

  // 16. Hedgehog: cozy rhythmic snuffle-puffs & tiny nasal snort
  hedgehog(sc) {
    const puffs = sc.mood === 'alarmed' ? 2 : 3;
    let offset = 0;
    for (let i = 0; i < puffs; i++) {
      const dur = randRange(sc.rand, 0.07, 0.11);
      scheduleNoiseBurst(sc, sc.pinkNoise, offset, dur, 1150, 820, 2.4, 0.22, 0.18);
      if (i === 0 || sc.mood === 'friendly') {
        scheduleFormantVoice(sc, {
          offsetSec: offset,
          dur: dur * 0.9,
          wave: 'triangle',
          f0Start: 310,
          f0End: 245,
          formant1Start: 620,
          formant1End: 510,
          q1: 2.8,
          amp: 0.2,
        });
      }
      offset += dur + randRange(sc.rand, 0.06, 0.1);
    }
  },

  // 17. Badger: warm earthy churr-grunt or stout gravelly growl
  badger(sc) {
    const aggressive = sc.mood === 'aggressive' || sc.mood === 'alarmed';
    scheduleFormantVoice(sc, {
      offsetSec: 0,
      dur: aggressive ? 0.42 : 0.32,
      wave: 'sawtooth',
      f0Start: aggressive ? 165 : 142,
      f0Mid: aggressive ? 140 : 162,
      f0End: aggressive ? 96 : 124,
      formant1Start: aggressive ? 460 : 390,
      formant1End: 310,
      q1: 2.8,
      formant2Start: 880,
      formant2End: 640,
      q2: 3.0,
      amp: 0.48,
      amRateHz: aggressive ? 26 : 19,
      amDepth: 0.58,
    });
    scheduleNoiseBurst(sc, sc.pinkNoise, 0.02, 0.22, 760, 520, 2.0, 0.13);
  },

  // 18. Raccoon: charming bubbling melodic chitter-trill ("trrr-chrr-chrr")
  raccoon(sc) {
    const notes = sc.mood === 'playful' || sc.mood === 'excited' ? 4 : 3;
    let offset = 0;
    for (let i = 0; i < notes; i++) {
      const dur = randRange(sc.rand, 0.085, 0.13);
      const f0 = randRange(sc.rand, 580, 920);
      scheduleFormantVoice(sc, {
        offsetSec: offset,
        dur,
        wave: 'triangle',
        f0Start: f0 * 0.85,
        f0Mid: f0 * 1.24,
        f0End: f0 * 0.96,
        formant1Start: 1050,
        formant1End: 1480,
        q1: 3.2,
        amp: 0.36,
        amRateHz: randRange(sc.rand, 34, 46),
        amDepth: 0.56,
      });
      offset += dur + randRange(sc.rand, 0.035, 0.06);
    }
  },

  // 19. Weasel: lively playful "dook-dook" clucks or sharp battle chirp
  weasel(sc) {
    if (sc.mood === 'aggressive' || sc.mood === 'alarmed') {
      scheduleFormantVoice(sc, {
        offsetSec: 0,
        dur: 0.19,
        wave: 'sawtooth',
        f0Start: 1250,
        f0Mid: 1580,
        f0End: 920,
        formant1Start: 2200,
        formant1End: 1550,
        q1: 3.6,
        amp: 0.34,
        amRateHz: 48,
        amDepth: 0.45,
      });
      return;
    }

    // Playful ferret/weasel "dooking" chuckle
    const count = 4;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = 0.062;
      const f0 = randRange(sc.rand, 520, 740);
      scheduleFormantVoice(sc, {
        offsetSec: offset,
        dur,
        wave: 'triangle',
        f0Start: f0 * 0.82,
        f0Mid: f0 * 1.18,
        f0End: f0 * 0.72,
        formant1Start: 1150,
        formant1End: 880,
        q1: 3.2,
        amp: 0.32,
      });
      offset += dur + 0.045;
    }
  },

  // 20. Snake: realistic contoured sibilant hiss (+ dry tail-shimmer when alarmed)
  snake(sc) {
    const intense = sc.mood === 'aggressive' || sc.mood === 'alarmed';
    const dur = intense ? 0.54 : 0.38;
    scheduleNoiseBurst(sc, sc.whiteNoise, 0, dur, 3200, intense ? 5200 : 4100, 2.6, intense ? 0.24 : 0.16, 0.22);
    scheduleNoiseBurst(sc, sc.whiteNoise, 0.03, dur * 0.85, 5800, 4400, 3.2, intense ? 0.14 : 0.09, 0.25);
    if (intense) {
      // Subtle rapid dry rattle shimmer
      for (let i = 0; i < 6; i++) {
        scheduleNoiseBurst(sc, sc.whiteNoise, i * 0.045, 0.03, 6200, 5200, 4.5, 0.1, 0.1);
      }
    }
  },

  // 21. Turtle: calm warm breathy sigh & gentle low woody croak
  turtle(sc) {
    scheduleNoiseBurst(sc, sc.pinkNoise, 0, 0.34, 720, 460, 2.2, 0.12, 0.32);
    scheduleFormantVoice(sc, {
      offsetSec: 0.04,
      dur: 0.26,
      wave: 'triangle',
      f0Start: 225,
      f0Mid: 248,
      f0End: 175,
      formant1Start: 440,
      formant1End: 330,
      q1: 2.8,
      amp: 0.28,
      attackFrac: 0.28,
    });
  },

  // 22. Beaver: warm nasal chatter or iconic water tail-slap splash
  beaver(sc) {
    if (sc.mood === 'alarmed' || sc.mood === 'aggressive') {
      // Iconic beaver tail-slap splash!
      const t = sc.startTime;
      const thump = sc.ctx.createOscillator();
      const thumpEnv = sc.ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(160, t);
      thump.frequency.exponentialRampToValueAtTime(48, t + 0.16);
      thumpEnv.gain.setValueAtTime(0.001, t);
      thumpEnv.gain.linearRampToValueAtTime(0.5, t + 0.006);
      thumpEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      thump.connect(thumpEnv);
      thumpEnv.connect(sc.out);
      thump.start(t);
      thump.stop(t + 0.2);

      scheduleNoiseBurst(sc, sc.pinkNoise, 0.01, 0.36, 1850, 720, 1.3, 0.34, 0.06);
      return;
    }

    // Friendly nasal beaver whine-chatter
    for (let i = 0; i < 2; i++) {
      scheduleFormantVoice(sc, {
        offsetSec: i * 0.22,
        dur: 0.19,
        wave: 'triangle',
        f0Start: 430 + i * 35,
        f0Mid: 560,
        f0End: 390,
        formant1Start: 880,
        formant1End: 740,
        q1: 3.6,
        amp: 0.32,
        vibRateHz: 16,
        vibDepthHz: 18,
      });
    }
  },

  // 23. Otter: joyful bright chirpy whistle-chuckle
  otter(sc) {
    const count = sc.mood === 'playful' || sc.mood === 'excited' ? 3 : 2;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const dur = randRange(sc.rand, 0.075, 0.115);
      const base = randRange(sc.rand, 1450, 2150);
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: base * 0.78,
        fMid: base * 1.18,
        fEnd: base * 0.94,
        amp: 0.24,
        harmonic2: 0.18,
        fmRateHz: 24,
        fmDepthHz: 65,
      });
      offset += dur + randRange(sc.rand, 0.055, 0.09);
    }
    if (sc.mood === 'playful' || sc.mood === 'excited') {
      // Soft wet splash accent
      scheduleNoiseBurst(sc, sc.pinkNoise, offset * 0.5, 0.14, 2100, 1100, 1.8, 0.09, 0.12);
    }
  },

  // 24. Fish (River Koi): musical Minnaert bubble bloops & gentle water-surface ripple
  fish(sc) {
    const bubbles = sc.mood === 'playful' || sc.mood === 'excited' ? 3 : 2;
    let offset = 0;
    for (let i = 0; i < bubbles; i++) {
      const dur = randRange(sc.rand, 0.055, 0.088);
      const f0 = randRange(sc.rand, 290, 480);
      // Real water bubbles sweep sharply UP in pitch as they pinch off
      scheduleSyrinxNote(sc, {
        offsetSec: offset,
        dur,
        fStart: f0,
        fMid: f0 * 1.65,
        fEnd: f0 * 2.35,
        amp: 0.28,
        attackFrac: 0.14,
      });
      offset += dur + randRange(sc.rand, 0.05, 0.11);
    }
    scheduleNoiseBurst(sc, sc.pinkNoise, 0.02, 0.18, 1600, 880, 1.6, 0.09, 0.15);
  },
};

export function hasSpeciesVoiceSynth(species: SpeciesId): boolean {
  return typeof SPECIES_SYNTHS[species] === 'function';
}

export class AnimalVoiceSynth {
  constructor(
    private readonly ctx: AudioContext,
    private readonly voiceBus: AudioNode,
    private readonly fxBus: AudioNode,
    private readonly whiteNoise: AudioBuffer,
    private readonly pinkNoise: AudioBuffer,
  ) {}

  /** Plays a realistic species-specific animal vocalization. */
  playVoice(opts: AnimalVoiceOptions): void {
    if (opts.gain <= 0.01) return;
    const synthFn = SPECIES_SYNTHS[opts.species];
    if (!synthFn) return;

    const out = createPannedOutput(this.ctx, this.voiceBus, opts.pan, opts.gain);
    const stageMul = getLifeStagePitchMultiplier(opts.lifeStage);
    const moodMul =
      opts.mood === 'excited' || opts.mood === 'alarmed'
        ? 1.07
        : opts.mood === 'solemn'
          ? 0.94
          : 1.0;
    const naturalVar = 0.94 + Math.random() * 0.12;

    synthFn({
      ctx: this.ctx,
      out,
      whiteNoise: this.whiteNoise,
      pinkNoise: this.pinkNoise,
      startTime: this.ctx.currentTime + (opts.delaySec ?? 0),
      pitchScale: stageMul * moodMul * naturalVar,
      mood: opts.mood,
      rand: Math.random,
    });
  }

  /** Plays tactile non-vocal interaction Foley (hammering, trade coins, shrine bell, birth chime). */
  playInteractionFoley(kind: CreatureInteractionKind, gain: number, pan: number): void {
    if (gain <= 0.015) return;
    const out = createPannedOutput(this.ctx, this.fxBus, pan, gain);
    const now = this.ctx.currentTime;

    if (kind === 'build') {
      // Two crisp wooden mallet / carpenter hammer taps
      const taps = [0, 0.17 + Math.random() * 0.05];
      for (const dt of taps) {
        const t = now + dt;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = 'triangle';
        const base = 360 + Math.random() * 140;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.exponentialRampToValueAtTime(base * 0.42, t + 0.055);
        env.gain.setValueAtTime(0.001, t);
        env.gain.linearRampToValueAtTime(0.32, t + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
        osc.connect(env);
        env.connect(out);
        osc.start(t);
        osc.stop(t + 0.08);
      }
      return;
    }

    if (kind === 'trade') {
      // Warm cheerful caravan coin / craft clink (two gentle metallic harmonics)
      const freqs = [2420, 3180];
      freqs.forEach((f, idx) => {
        const t = now + idx * 0.065;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f * (0.97 + Math.random() * 0.06);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.14, t + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(env);
        env.connect(out);
        osc.start(t);
        osc.stop(t + 0.25);
      });
      return;
    }

    if (kind === 'pray') {
      // Soft wooden/bronze woodland shrine chime
      const partials = [528, 1056, 1588];
      partials.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.11 / (idx + 1), now + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.95 / (idx * 0.6 + 1));
        osc.connect(env);
        env.connect(out);
        osc.start(now);
        osc.stop(now + 1.05);
      });
      return;
    }

    if (kind === 'birth' || kind === 'court') {
      // Warm pastoral harp/bell arpeggio welcoming a bonded pair or newborn litter
      const notes = kind === 'birth' ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25];
      notes.forEach((f, idx) => {
        const t = now + idx * 0.09;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.12, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
        osc.connect(env);
        env.connect(out);
        osc.start(t);
        osc.stop(t + 0.52);
      });
    }
  }

  /** Plays weapon clash, arrow twang, melee impact, or solemn battle fall. */
  playCombatSound(kind: CombatEffectKind, gain: number, pan: number): void {
    if (gain <= 0.015) return;
    const out = createPannedOutput(this.ctx, this.fxBus, pan, gain);
    const now = this.ctx.currentTime;

    if (kind === 'clash') {
      // Crisp steel-on-shield metallic parry ring
      const partials = [1680, 2590, 3920];
      for (let i = 0; i < partials.length; i++) {
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = partials[i] * (0.94 + Math.random() * 0.12);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.18 / (i + 1), now + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.22 / (i * 0.4 + 1));
        osc.connect(env);
        env.connect(out);
        osc.start(now);
        osc.stop(now + 0.25);
      }
      return;
    }

    if (kind === 'arrow') {
      // Bowstring twang + airy whistle
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(115, now + 0.12);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.24, now + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(env);
      env.connect(out);
      osc.start(now);
      osc.stop(now + 0.16);

      const src = this.ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3.5;
      bp.frequency.setValueAtTime(2600, now + 0.02);
      bp.frequency.exponentialRampToValueAtTime(1250, now + 0.2);
      const nEnv = this.ctx.createGain();
      nEnv.gain.setValueAtTime(0.0001, now + 0.02);
      nEnv.gain.linearRampToValueAtTime(0.14, now + 0.06);
      nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      src.connect(bp);
      bp.connect(nEnv);
      nEnv.connect(out);
      src.start(now + 0.02);
      src.stop(now + 0.24);
      return;
    }

    // hit / heavy_hit / fatal: damped physical impact thud
    const isHeavy = kind === 'heavy_hit' || kind === 'fatal';
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isHeavy ? 155 : 195, now);
    osc.frequency.exponentialRampToValueAtTime(isHeavy ? 42 : 58, now + (isHeavy ? 0.22 : 0.13));
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(isHeavy ? 0.44 : 0.3, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + (isHeavy ? 0.26 : 0.15));
    osc.connect(env);
    env.connect(out);
    osc.start(now);
    osc.stop(now + 0.28);

    const src = this.ctx.createBufferSource();
    src.buffer = this.pinkNoise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = isHeavy ? 900 : 1200;
    const nEnv = this.ctx.createGain();
    nEnv.gain.setValueAtTime(0.0001, now);
    nEnv.gain.linearRampToValueAtTime(isHeavy ? 0.22 : 0.14, now + 0.005);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    src.connect(lp);
    lp.connect(nEnv);
    nEnv.connect(out);
    src.start(now);
    src.stop(now + 0.15);
  }

  /** Plays an awe-inspiring cathedral/nature swell when the Forest Deity manifests an effect. */
  playDivineEffect(type: DivineEventType, gain: number, pan: number): void {
    if (gain <= 0.02) return;
    const out = createPannedOutput(this.ctx, this.fxBus, pan, gain);
    const now = this.ctx.currentTime;
    const isRestorative =
      type === 'sunlit_blessing' ||
      type === 'sanctuary_rewilding' ||
      type === 'migration_corridor';

    if (isRestorative) {
      // Shimmering major-9th sunlit cathedral harmonic chord
      const chord = [293.66, 440, 554.37, 659.25, 880];
      chord.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = idx < 2 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        const delay = idx * 0.08;
        env.gain.setValueAtTime(0.0001, now + delay);
        env.gain.linearRampToValueAtTime(0.1 / (1 + idx * 0.25), now + delay + 0.35);
        env.gain.exponentialRampToValueAtTime(0.0001, now + delay + 2.6);
        osc.connect(env);
        env.connect(out);
        osc.start(now + delay);
        osc.stop(now + delay + 2.7);
      });
    } else {
      // Deep tectonic thunder & ominous wind swell
      const sub = this.ctx.createOscillator();
      const subEnv = this.ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(78, now);
      sub.frequency.exponentialRampToValueAtTime(38, now + 2.2);
      subEnv.gain.setValueAtTime(0.0001, now);
      subEnv.gain.linearRampToValueAtTime(0.36, now + 0.3);
      subEnv.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      sub.connect(subEnv);
      subEnv.connect(out);
      sub.start(now);
      sub.stop(now + 2.5);

      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkNoise;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(620, now);
      lp.frequency.exponentialRampToValueAtTime(160, now + 2.3);
      const nEnv = this.ctx.createGain();
      nEnv.gain.setValueAtTime(0.0001, now);
      nEnv.gain.linearRampToValueAtTime(0.32, now + 0.25);
      nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      src.connect(lp);
      lp.connect(nEnv);
      nEnv.connect(out);
      src.start(now);
      src.stop(now + 2.5);
    }
  }
}
