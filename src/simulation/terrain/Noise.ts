import { SeededRandom } from '@core/SeededRandom';

/**
 * Deterministic 2D Perlin-style gradient noise + FBM utilities for
 * sculpting forest valleys, riverbeds, clearings, and soil fertility.
 */
export class Noise2D {
  private readonly perm: Uint8Array;

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
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private static grad(hash: number, x: number, y: number): number {
    switch (hash & 7) {
      case 0:
        return x + y;
      case 1:
        return -x + y;
      case 2:
        return x - y;
      case 3:
        return -x - y;
      case 4:
        return x;
      case 5:
        return -x;
      case 6:
        return y;
      default:
        return -y;
    }
  }

  /** Smooth 2D gradient noise in approximately [-1, 1]. */
  sample(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = Noise2D.fade(xf);
    const v = Noise2D.fade(yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = Noise2D.lerp(Noise2D.grad(aa, xf, yf), Noise2D.grad(ba, xf - 1, yf), u);
    const x2 = Noise2D.lerp(
      Noise2D.grad(ab, xf, yf - 1),
      Noise2D.grad(bb, xf - 1, yf - 1),
      u,
    );

    return Noise2D.lerp(x1, x2, v);
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
