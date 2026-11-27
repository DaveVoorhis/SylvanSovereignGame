import type { AudioListenerFrame, Vec3 } from '@core/Types';

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface SpatialAudioParams {
  /** Attenuation factor in [0, 1]. */
  readonly gain: number;
  /** Stereo pan in [-1, 1] (-1 left, +1 right). */
  readonly pan: number;
  /** Effective listening distance in meters. */
  readonly distance: number;
  /** True when the sound is loud enough to warrant synthesis. */
  readonly isAudible: boolean;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Deterministic fast PRNG for reproducible procedural noise/reverb buffers. */
function makeBufferRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a seamless looping stereo noise buffer (white, pink, or brown)
 * with an overlap crossfade at the loop seam so continuous wind/rain/water
 * loops never click or pop.
 */
export function createSeamlessNoiseBuffer(
  ctx: BaseAudioContext,
  durationSec: number,
  color: NoiseColor,
  seed = 1337,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const length = Math.max(1024, Math.floor(sampleRate * durationSec));
  const xfade = Math.min(Math.floor(sampleRate * 0.25), Math.floor(length * 0.15));
  const rawLen = length + xfade;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const rand = makeBufferRng(seed);

  const raw = new Float32Array(rawLen);
  for (let ch = 0; ch < 2; ch++) {
    if (color === 'white') {
      for (let i = 0; i < rawLen; i++) {
        raw[i] = rand() * 2 - 1;
      }
    } else if (color === 'pink') {
      // Paul Kellet's refined pink-noise filter
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < rawLen; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      // Soft leaky-integrated brown noise (warm low-frequency rumble)
      let last = 0;
      for (let i = 0; i < rawLen; i++) {
        const w = rand() * 2 - 1;
        last = (last + 0.025 * w) / 1.025;
        raw[i] = last * 3.1;
      }
    }

    const out = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      if (i < xfade) {
        const t = i / xfade;
        const fadeIn = Math.sin(t * Math.PI * 0.5);
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        out[i] = clamp(raw[i] * fadeIn + raw[length + i] * fadeOut, -1, 1);
      } else {
        out[i] = clamp(raw[i], -1, 1);
      }
    }
  }

  return buffer;
}

/**
 * Synthesizes a warm, airy outdoor woodland impulse response (~1.1s) with gentle
 * canopy early reflections and low-passed valley decay so animal calls and
 * village festival music sit naturally in open space.
 */
export function createWoodlandReverbBuffer(
  ctx: BaseAudioContext,
  durationSec = 1.15,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const length = Math.max(1024, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const rand = makeBufferRng(90421);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Soft pre-delay and smooth exponential outdoor air decay
      const preDelay = smoothstep(0.0, 0.025, t);
      const inv = 1 - t;
      const s = Math.sqrt(inv);
      const decay = inv * inv * s * Math.sqrt(s) * preDelay;
      const white = rand() * 2 - 1;
      // Progressive high-frequency air absorption
      const alpha = 0.24 * (1 - t * 0.72) + 0.04;
      lp += (white - lp) * alpha;
      data[i] = lp * decay * 0.65;
    }

    // Subtle discrete early canopy/cottage reflections (18ms - 78ms)
    const reflections = ch === 0 ? [0.019, 0.037, 0.061] : [0.023, 0.044, 0.072];
    for (let r = 0; r < reflections.length; r++) {
      const idx = Math.floor(reflections[r] * sampleRate);
      if (idx > 0 && idx < length) {
        data[idx] += (0.22 - r * 0.05) * (r % 2 === 0 ? 1 : -1);
      }
    }
  }

  return buffer;
}

/**
 * Computes camera-aware 3D spatial attenuation and stereo panning for a world sound source.
 *
 * - In Creature Eye View (POV): measures directly from the creature's eyes (`cameraPos`)
 *   for intimate first-person immersion.
 * - In World Orbit View: anchors horizontally near the viewed focal point (`focusPos`) while
 *   applying smooth zoom/altitude attenuation from `focusDistance`, so watching a village from
 *   25-60m lets you clearly hear its creatures, while zooming out to country Overview fades
 *   small voices into high-altitude wind.
 */
export function computeSpatialParams(
  sourcePos: Vec3,
  listener: AudioListenerFrame,
  options?: {
    /** Reference distance for full volume (m). */
    refDistance?: number;
    /** Maximum audible horizontal range from listening anchor (m). */
    maxDistance?: number;
    /** Maximum camera zoom distance before world-view intimacy attenuates to zero (m). */
    maxZoomDistance?: number;
  },
): SpatialAudioParams {
  const refDistance = options?.refDistance ?? (listener.isPov ? 5.5 : 14);
  const maxDistance = options?.maxDistance ?? (listener.isPov ? 52 : 76);
  const maxZoomDistance = options?.maxZoomDistance ?? 175;

  const anchor = listener.isPov ? listener.cameraPos : listener.focusPos;
  const dx = sourcePos.x - anchor.x;
  const dy = sourcePos.y - anchor.y;
  const dz = sourcePos.z - anchor.z;
  const horizDist = Math.hypot(dx, dz);
  const fullDist = Math.hypot(dx, dy * 0.6, dz);

  // Smooth inverse-distance + outer rolloff curve
  const norm = Math.max(0, (fullDist - refDistance) / Math.max(1, maxDistance - refDistance));
  const distGain = fullDist >= maxDistance ? 0 : Math.pow(1 - clamp(norm, 0, 1), 1.75);

  // In World View, gently scale intimacy with camera zoom distance so zoomed-out overview stays calm
  const zoomGain = listener.isPov
    ? 1.0
    : 1 - smoothstep(26, maxZoomDistance, listener.focusDistance) * 0.94;

  // Underwater muffle slightly reduces airborne sounds when submerged in Koi Eye View
  const underwaterScale = listener.isUnderwater ? 0.55 : 1.0;

  const gain = clamp(distGain * zoomGain * underwaterScale, 0, 1);

  // Stereo pan via projection onto camera right vector
  const camDx = sourcePos.x - listener.cameraPos.x;
  const camDy = sourcePos.y - listener.cameraPos.y;
  const camDz = sourcePos.z - listener.cameraPos.z;
  const camLen = Math.max(0.5, Math.hypot(camDx, camDy, camDz));
  const dotRight =
    (camDx * listener.right.x + camDy * listener.right.y + camDz * listener.right.z) / camLen;
  const panStrength = listener.isPov ? 0.88 : 0.72 * smoothstep(2, 18, horizDist);
  const pan = clamp(dotRight * panStrength, -0.92, 0.92);

  return {
    gain,
    pan,
    distance: fullDist,
    isAudible: gain > 0.025,
  };
}

/** Creates a stereo panning node or a plain gain passthrough if StereoPannerNode is unavailable. */
export function createPannedOutput(
  ctx: AudioContext,
  destination: AudioNode,
  pan: number,
  gainValue: number,
): GainNode {
  const gainNode = ctx.createGain();
  gainNode.gain.value = clamp(gainValue, 0, 1.5);
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    gainNode.connect(panner);
    panner.connect(destination);
  } else {
    gainNode.connect(destination);
  }
  return gainNode;
}
