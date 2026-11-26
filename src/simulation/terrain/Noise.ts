import { SeededRandom } from '@core/SeededRandom';

const GRAD_X = new Int8Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Int8Array([1, 1, -1, -1, 0, 0, 1, -1]);

/**
 * Deterministic 2D Perlin-style gradient noise + FBM utilities for
 * sculpting forest valleys, riverbeds, clearings, and soil fertility.
 */
export class Noise2D {
  private readonly perm: Uint8Array;
  private readonly permGradX: Int8Array;
  private readonly permGradY: Int8Array;

  constructor(seed: number) {
    const rng = new SeededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permGradX = new Int8Array(512);
    this.permGradY = new Int8Array(512);
    for (let i = 0; i < 512; i++) {
      const v = p[i & 255];
      this.perm[i] = v;
      const g = v & 7;
      this.permGradX[i] = GRAD_X[g];
      this.permGradY[i] = GRAD_Y[g];
    }
  }

  /** Smooth 2D gradient noise in approximately [-1, 1]. */
  sample(x: number, y: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const xi = fx & 255;
    const yi = fy & 255;
    const xf = x - fx;
    const yf = y - fy;

    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

    const perm = this.perm;
    const gx = this.permGradX;
    const gy = this.permGradY;
    const p0 = perm[xi] + yi;
    const p1 = perm[xi + 1] + yi;

    const xf1 = xf - 1;
    const yf1 = yf - 1;

    const gAA = gx[p0] * xf + gy[p0] * yf;
    const gBA = gx[p1] * xf1 + gy[p1] * yf;
    const gAB = gx[p0 + 1] * xf + gy[p0 + 1] * yf1;
    const gBB = gx[p1 + 1] * xf1 + gy[p1 + 1] * yf1;

    const x1 = gAA + u * (gBA - gAA);
    const x2 = gAB + u * (gBB - gAB);

    return x1 + v * (x2 - x1);
  }

  /** Fractal Brownian Motion in approximately [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.sample(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value / norm;
  }

  /** Ridged multifractal for rocky hills and woodland ridges in [0, 1]. */
  ridged(x: number, y: number, octaves = 3): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * frequency, y * frequency));
      value += amplitude * n * n;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return value / norm;
  }
}
