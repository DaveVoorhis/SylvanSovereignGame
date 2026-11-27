import type { AudioListenerFrame, BiomeType, Season, WeatherType } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { clamp, smoothstep } from './AudioUtils';

export interface AmbientMixTargets {
  readonly windGain: number;
  readonly windCutoffHz: number;
  readonly highWindGain: number;
  readonly treeRustleGain: number;
  readonly treeRustleCutoffHz: number;
  readonly riverGain: number;
  readonly oceanGain: number;
  readonly rainGain: number;
  readonly hearthGain: number;
  readonly underwaterFactor: number;
  readonly daylight: number;
  readonly treeDensity: number;
  readonly biome: BiomeType;
  readonly weather: WeatherType;
  readonly season: Season;
}

function getWeatherWindStrength(weather: WeatherType): number {
  switch (weather) {
    case 'storm':
      return 1.0;
    case 'rain':
      return 0.72;
    case 'snow':
      return 0.68;
    case 'blossom':
      return 0.52;
    case 'clear':
      return 0.42;
    case 'sunbeams':
      return 0.36;
    case 'mist':
      return 0.22;
  }
}

function getBiomeTreeWeight(biome: BiomeType): number {
  switch (biome) {
    case 'deep_woods':
    case 'moss_hollow':
      return 1.0;
    case 'riverbank':
      return 0.65;
    case 'meadow':
      return 0.45;
    case 'rocky_ridge':
    case 'alpine_crag':
      return 0.3;
    case 'prairie':
      return 0.22;
    case 'seashore':
    case 'desert':
    case 'water':
      return 0.08;
  }
}

/**
 * Computes continuous ambient soundscape target levels from the current world state
 * and camera listening frame (exported pure function for unit testing).
 */
export function computeAmbientMix(
  world: WorldState,
  listener: AudioListenerFrame,
): AmbientMixTargets {
  const anchor = listener.isPov ? listener.cameraPos : listener.focusPos;
  const biome = world.terrain.getBiomeAt(anchor.x, anchor.z);
  const weather = world.weather;
  const season = world.season;

  // Daylight in [0, 1]: 0 at midnight, 1 in full day
  const sunY = Math.sin((world.timeOfDay - 0.25) * Math.PI * 2);
  const daylight = smoothstep(-0.14, 0.22, sunY);

  const overviewFactor = listener.isPov ? 0 : smoothstep(70, 260, listener.focusDistance);
  const closenessFactor = listener.isPov ? 1.0 : 1 - smoothstep(25, 145, listener.focusDistance);
  const underwaterFactor = listener.isUnderwater ? 1.0 : 0.0;

  // Sample nearby tree density cheaply (strided scan if tree list is huge)
  const trees = world.terrain.trees;
  const stride = trees.length > 900 ? Math.ceil(trees.length / 650) : 1;
  const sampleRadiusSq = 38 * 38;
  let nearbyTreeHits = 0;
  for (let i = 0; i < trees.length; i += stride) {
    const t = trees[i];
    const dx = t.x - anchor.x;
    const dz = t.z - anchor.z;
    if (dx * dx + dz * dz <= sampleRadiusSq) {
      nearbyTreeHits += stride;
    }
  }
  const treeCountDensity = clamp(nearbyTreeHits / 18, 0, 1);
  const treeDensity = clamp(
    Math.max(treeCountDensity, getBiomeTreeWeight(biome) * 0.55),
    0,
    1,
  );

  // Wind intensity: weather + alpine exposure + high-altitude overview breeze
  const alpineDepth = world.terrain.getAlpineDepthAt(anchor.x, anchor.z);
  const alpineFactor = smoothstep(-10, 65, alpineDepth);
  const weatherWind = getWeatherWindStrength(weather);
  const baseWind = clamp(weatherWind * 0.72 + alpineFactor * 0.28 + overviewFactor * 0.26, 0.14, 1.0);

  const windGain = (0.095 + baseWind * 0.19) * (1 - underwaterFactor * 0.85);
  const windCutoffHz = 210 + baseWind * 360 + overviewFactor * 160;
  const highWindGain =
    clamp(
      (weather === 'storm' ? 0.11 : 0) + alpineFactor * 0.075 + overviewFactor * 0.07,
      0,
      0.16,
    ) *
    (1 - underwaterFactor * 0.9);

  // Trees & leaves rustling: strongest in forests & meadows when zoomed into the valley
  const seasonLeafFactor =
    season === 'spring'
      ? 0.95
      : season === 'summer'
        ? 1.0
        : season === 'autumn'
          ? 1.06
          : 0.42;
  const rustleWind = clamp(0.28 + weatherWind * 0.82, 0.25, 1.0);
  const treeRustleGain =
    treeDensity *
    seasonLeafFactor *
    rustleWind *
    (0.06 + 0.15 * closenessFactor) *
    (1 - underwaterFactor * 0.95);
  const treeRustleCutoffHz =
    season === 'autumn' ? 2350 : season === 'winter' ? 1450 : 1900 + weatherWind * 550;

  // River / stream / pond & plaza fountain babble
  const freshDist = world.terrain.getFreshwaterDistance(anchor.x, anchor.z);
  let riverProx = 1 - smoothstep(1.5, 42, Math.max(0, freshDist));

  // Check proximity to settlement hearth fires & fountains
  let nearestHearthDist = Infinity;
  let nearestFountainDist = Infinity;
  for (let i = 0; i < world.settlements.length; i++) {
    const s = world.settlements[i];
    const dCenter = Math.hypot(s.center.x - anchor.x, s.center.z - anchor.z);
    if (dCenter < nearestHearthDist) {
      nearestHearthDist = dCenter;
    }
    if (dCenter < 50) {
      for (let j = 0; j < s.buildings.length; j++) {
        const b = s.buildings[j];
        if (b.completed && b.type === 'fountain_plaza') {
          const df = Math.hypot(b.position.x - anchor.x, b.position.z - anchor.z);
          if (df < nearestFountainDist) nearestFountainDist = df;
        }
      }
    }
  }
  const fountainProx = 1 - smoothstep(2, 26, nearestFountainDist);
  riverProx = Math.max(riverProx, fountainProx * 0.85);
  const riverGain =
    riverProx * (0.045 + 0.145 * closenessFactor) * (1 - underwaterFactor * 0.55);

  // Ocean waves near the front seashore
  const coastDist = world.terrain.getCoastSignedDistance(anchor.x, anchor.z);
  const oceanProx = coastDist <= 0 ? 1.0 : 1 - smoothstep(0, 88, coastDist);
  const oceanGain =
    oceanProx *
    (0.06 + 0.17 * (0.35 + 0.65 * closenessFactor)) *
    (1 - underwaterFactor * 0.72);

  // Rain & storm patter
  const rainGain =
    (weather === 'storm' ? 0.21 : weather === 'rain' ? 0.145 : 0) *
    (0.55 + 0.45 * closenessFactor) *
    (1 - underwaterFactor * 0.82);

  // Cozy village hearth warmth when near a settlement center (dampened in rain/underwater)
  const hearthProx = 1 - smoothstep(3.5, 24, nearestHearthDist);
  const hearthGain =
    hearthProx *
    closenessFactor *
    0.095 *
    (weather === 'storm' ? 0.35 : weather === 'rain' ? 0.6 : 1.0) *
    (1 - underwaterFactor);

  return {
    windGain,
    windCutoffHz,
    highWindGain,
    treeRustleGain,
    treeRustleCutoffHz,
    riverGain,
    oceanGain,
    rainGain,
    hearthGain,
    underwaterFactor,
    daylight,
    treeDensity,
    biome,
    weather,
    season,
  };
}

/**
 * Continuous procedural outdoor soundscape:
 * - Organic gusting wind & high alpine breeze
 * - Dynamic tree/leaf rustling responding to forest density, wind gusts, and season
 * - Spatialized freshwater rivers/fountains & rolling coastal ocean surf
 * - Rain patter & occasional distant storm thunder
 * - Cozy village hearth crackle
 * - Subtle day woodland ambience & night meadow cricket chorus
 * - Underwater lowpass immersion in River Koi Eye View
 */
export class AmbientSoundscape {
  private readonly masterFilter: BiquadFilterNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly highWindFilter: BiquadFilterNode;
  private readonly highWindGain: GainNode;
  private readonly rustleFilter1: BiquadFilterNode;
  private readonly rustleFilter2: BiquadFilterNode;
  private readonly rustleGain: GainNode;
  private readonly riverFilter: BiquadFilterNode;
  private readonly riverGain: GainNode;
  private readonly oceanFilter: BiquadFilterNode;
  private readonly oceanGain: GainNode;
  private readonly rainGain: GainNode;
  private readonly hearthGain: GainNode;
  private readonly underwaterGain: GainNode;

  private readonly runningSources: AudioScheduledSourceNode[] = [];
  private gustPhaseA = 0.4;
  private gustPhaseB = 1.9;
  private wavePhase = 0.0;
  private thunderTimer = 9.0;
  private cricketTimer = 1.8;
  private crackleTimer = 0.6;
  private wildBirdTimer = 4.2;
  private lastMix: AmbientMixTargets | null = null;
  private sampleAccum = 0.25;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly whiteNoise: AudioBuffer,
    pinkNoise: AudioBuffer,
    private readonly brownNoise: AudioBuffer,
  ) {
    // Master ambient filter (normally wide open at 16 kHz, smoothly sweeps down underwater)
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 16000;
    this.masterFilter.Q.value = 0.7;
    this.masterFilter.connect(destination);

    // 1. Primary airy woodland wind bed (brown + pink blend via resonant lowpass)
    const windSrc = this.startLoop(brownNoise);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 280;
    this.windFilter.Q.value = 0.85;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0001;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterFilter);

    // 2. High alpine / storm wind whistle
    const highWindSrc = this.startLoop(pinkNoise);
    this.highWindFilter = ctx.createBiquadFilter();
    this.highWindFilter.type = 'bandpass';
    this.highWindFilter.frequency.value = 780;
    this.highWindFilter.Q.value = 3.2;
    this.highWindGain = ctx.createGain();
    this.highWindGain.gain.value = 0.0001;
    highWindSrc.connect(this.highWindFilter);
    this.highWindFilter.connect(this.highWindGain);
    this.highWindGain.connect(this.masterFilter);

    // 3. Trees & leaves rustling (dual-band canopy shimmer)
    const rustleSrc = this.startLoop(pinkNoise);
    this.rustleFilter1 = ctx.createBiquadFilter();
    this.rustleFilter1.type = 'bandpass';
    this.rustleFilter1.frequency.value = 1850;
    this.rustleFilter1.Q.value = 1.1;
    this.rustleFilter2 = ctx.createBiquadFilter();
    this.rustleFilter2.type = 'bandpass';
    this.rustleFilter2.frequency.value = 3350;
    this.rustleFilter2.Q.value = 1.4;
    this.rustleGain = ctx.createGain();
    this.rustleGain.gain.value = 0.0001;
    rustleSrc.connect(this.rustleFilter1);
    rustleSrc.connect(this.rustleFilter2);
    this.rustleFilter1.connect(this.rustleGain);
    const rustleHiGain = ctx.createGain();
    rustleHiGain.gain.value = 0.55;
    this.rustleFilter2.connect(rustleHiGain);
    rustleHiGain.connect(this.rustleGain);
    this.rustleGain.connect(this.masterFilter);

    // 4. Freshwater river / brook / fountain babble
    const riverSrc = this.startLoop(pinkNoise);
    this.riverFilter = ctx.createBiquadFilter();
    this.riverFilter.type = 'bandpass';
    this.riverFilter.frequency.value = 1050;
    this.riverFilter.Q.value = 0.9;
    this.riverGain = ctx.createGain();
    this.riverGain.gain.value = 0.0001;
    riverSrc.connect(this.riverFilter);
    this.riverFilter.connect(this.riverGain);
    this.riverGain.connect(this.masterFilter);

    // 5. Rolling ocean surf waves
    const oceanSrc = this.startLoop(brownNoise);
    this.oceanFilter = ctx.createBiquadFilter();
    this.oceanFilter.type = 'lowpass';
    this.oceanFilter.frequency.value = 320;
    this.oceanFilter.Q.value = 0.9;
    this.oceanGain = ctx.createGain();
    this.oceanGain.gain.value = 0.0001;
    oceanSrc.connect(this.oceanFilter);
    this.oceanFilter.connect(this.oceanGain);
    this.oceanGain.connect(this.masterFilter);

    // 6. Rain patter
    const rainSrc = this.startLoop(whiteNoise);
    const rainBp = ctx.createBiquadFilter();
    rainBp.type = 'bandpass';
    rainBp.frequency.value = 2900;
    rainBp.Q.value = 0.65;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 6200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.0001;
    rainSrc.connect(rainBp);
    rainBp.connect(rainLp);
    rainLp.connect(this.rainGain);
    this.rainGain.connect(this.masterFilter);

    // 7. Cozy hearth warm ember bed
    const hearthSrc = this.startLoop(brownNoise);
    const hearthLp = ctx.createBiquadFilter();
    hearthLp.type = 'lowpass';
    hearthLp.frequency.value = 240;
    this.hearthGain = ctx.createGain();
    this.hearthGain.gain.value = 0.0001;
    hearthSrc.connect(hearthLp);
    hearthLp.connect(this.hearthGain);
    this.hearthGain.connect(this.masterFilter);

    // 8. Calm deep underwater current (for River Koi POV)
    const uwSrc = this.startLoop(brownNoise);
    const uwLp = ctx.createBiquadFilter();
    uwLp.type = 'lowpass';
    uwLp.frequency.value = 185;
    this.underwaterGain = ctx.createGain();
    this.underwaterGain.gain.value = 0.0001;
    uwSrc.connect(uwLp);
    uwLp.connect(this.underwaterGain);
    this.underwaterGain.connect(destination);
  }

  private startLoop(buffer: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(this.ctx.currentTime, Math.random() * Math.max(0.1, buffer.duration - 0.1));
    this.runningSources.push(src);
    return src;
  }

  update(
    dt: number,
    world: WorldState,
    listener: AudioListenerFrame,
    paused: boolean,
  ): void {
    // Recompute spatial environment mix ~4 times/second
    this.sampleAccum += dt;
    if (!this.lastMix || this.sampleAccum >= 0.24) {
      this.sampleAccum = 0;
      this.lastMix = computeAmbientMix(world, listener);
    }
    const mix = this.lastMix;

    // Advance organic wind gusts and ocean wave roll
    const timeScale = paused ? 0.35 : 1.0;
    this.gustPhaseA += dt * 0.44 * timeScale;
    this.gustPhaseB += dt * 0.73 * timeScale;
    this.wavePhase += dt * 0.72 * timeScale;

    const gustRaw =
      0.5 + 0.32 * Math.sin(this.gustPhaseA) + 0.18 * Math.sin(this.gustPhaseB + 1.1);
    // Foliage rustle swells slightly behind wind gusts for lifelike canopy motion
    const leafGust =
      0.45 +
      0.35 * Math.sin(this.gustPhaseA - 0.55) +
      0.2 * Math.sin(this.gustPhaseB - 0.4 + 0.8);
    const waveSwell = 0.48 + 0.52 * Math.pow(0.5 + 0.5 * Math.sin(this.wavePhase), 1.6);
    const babbleMod = 0.84 + 0.16 * Math.sin(this.gustPhaseB * 3.1);

    const now = this.ctx.currentTime;
    const tc = 0.28;
    const pauseDuck = paused ? 0.45 : 1.0;

    this.masterFilter.frequency.setTargetAtTime(
      mix.underwaterFactor > 0.5 ? 460 : 15500,
      now,
      0.18,
    );

    this.windGain.gain.setTargetAtTime(
      mix.windGain * (0.68 + 0.62 * gustRaw) * pauseDuck,
      now,
      tc,
    );
    this.windFilter.frequency.setTargetAtTime(
      mix.windCutoffHz * (0.78 + 0.48 * gustRaw),
      now,
      tc,
    );

    this.highWindGain.gain.setTargetAtTime(
      mix.highWindGain * (0.45 + 0.85 * gustRaw) * pauseDuck,
      now,
      tc,
    );
    this.highWindFilter.frequency.setTargetAtTime(640 + gustRaw * 460, now, tc);

    this.rustleGain.gain.setTargetAtTime(
      mix.treeRustleGain * (0.52 + 0.88 * leafGust) * pauseDuck,
      now,
      tc,
    );
    this.rustleFilter1.frequency.setTargetAtTime(
      mix.treeRustleCutoffHz * (0.82 + 0.36 * leafGust),
      now,
      tc,
    );
    this.rustleFilter2.frequency.setTargetAtTime(
      (mix.treeRustleCutoffHz + 1250) * (0.85 + 0.3 * leafGust),
      now,
      tc,
    );

    this.riverGain.gain.setTargetAtTime(mix.riverGain * babbleMod * pauseDuck, now, tc);
    this.riverFilter.frequency.setTargetAtTime(880 + 360 * babbleMod, now, tc);

    this.oceanGain.gain.setTargetAtTime(mix.oceanGain * waveSwell * pauseDuck, now, 0.35);
    this.oceanFilter.frequency.setTargetAtTime(170 + 390 * waveSwell, now, 0.35);

    this.rainGain.gain.setTargetAtTime(mix.rainGain * pauseDuck, now, tc);
    this.hearthGain.gain.setTargetAtTime(mix.hearthGain * pauseDuck, now, tc);
    this.underwaterGain.gain.setTargetAtTime(
      mix.underwaterFactor * 0.24 * pauseDuck,
      now,
      0.22,
    );

    if (paused || mix.underwaterFactor > 0.5) return;

    // Occasional distant storm thunder rumble
    if (mix.weather === 'storm') {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = 9 + Math.random() * 14;
        this.playDistantThunder(0.14 + Math.random() * 0.1);
      }
    }

    // Subtle hearth fire crackle pops when close to a settlement fire
    if (mix.hearthGain > 0.025) {
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.28 + Math.random() * 0.85;
        this.playHearthCrackle(mix.hearthGain * 1.45);
      }
    }

    // Soft nighttime meadow crickets in warm seasons (spring/summer/autumn, non-storm)
    if (
      mix.daylight < 0.35 &&
      mix.season !== 'winter' &&
      mix.weather !== 'storm' &&
      mix.biome !== 'water' &&
      mix.biome !== 'alpine_crag' &&
      listener.focusDistance < 130
    ) {
      this.cricketTimer -= dt;
      if (this.cricketTimer <= 0) {
        this.cricketTimer = 1.4 + Math.random() * 2.4;
        const nightAmp = (1 - mix.daylight / 0.35) * (1 - smoothstep(35, 130, listener.focusDistance));
        this.playCricketChirp(0.032 * nightAmp);
      }
    }

    // Subtle distant woodland canopy songbirds in bright daylight forests/meadows
    if (
      mix.daylight > 0.55 &&
      mix.treeDensity > 0.3 &&
      mix.weather !== 'storm' &&
      mix.weather !== 'snow' &&
      listener.focusDistance < 140
    ) {
      this.wildBirdTimer -= dt;
      if (this.wildBirdTimer <= 0) {
        this.wildBirdTimer = 3.8 + Math.random() * 5.2;
        const prox = 1 - smoothstep(40, 140, listener.focusDistance);
        this.playDistantCanopyBird(0.055 * mix.treeDensity * prox);
      }
    }
  }

  private playDistantThunder(amp: number): void {
    const now = this.ctx.currentTime;
    const dur = 2.6 + Math.random() * 1.8;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownNoise;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(160, now);
    lp.frequency.exponentialRampToValueAtTime(52, now + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(amp, now + 0.22);
    env.gain.exponentialRampToValueAtTime(amp * 0.45, now + dur * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(lp);
    lp.connect(env);
    env.connect(this.masterFilter);
    src.start(now, Math.random() * 1.5);
    src.stop(now + dur + 0.05);
  }

  private playHearthCrackle(amp: number): void {
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.whiteNoise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 2600;
    bp.Q.value = 4.2;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(amp, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.masterFilter);
    src.start(now, Math.random() * 1.5);
    src.stop(now + 0.032);
  }

  private playCricketChirp(amp: number): void {
    if (amp <= 0.003) return;
    const now = this.ctx.currentTime;
    const pulses = 3 + (Math.random() < 0.5 ? 1 : 0);
    const freq = 4050 + Math.random() * 380;
    for (let i = 0; i < pulses; i++) {
      const t = now + i * 0.068;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.044);
      osc.connect(env);
      env.connect(this.masterFilter);
      osc.start(t);
      osc.stop(t + 0.052);
    }
  }

  private playDistantCanopyBird(amp: number): void {
    if (amp <= 0.005) return;
    const now = this.ctx.currentTime;
    const notes = 2 + (Math.random() < 0.5 ? 1 : 0);
    const base = 2400 + Math.random() * 1500;
    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.13;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      const f0 = base * (i % 2 === 0 ? 1.0 : 1.18);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (i % 2 === 0 ? 1.24 : 0.86), t + 0.085);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);
      osc.connect(env);
      env.connect(this.masterFilter);
      osc.start(t);
      osc.stop(t + 0.11);
    }
  }

  dispose(): void {
    for (const src of this.runningSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    this.runningSources.length = 0;
  }
}
