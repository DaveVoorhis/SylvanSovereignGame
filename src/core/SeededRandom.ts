/**
 * Deterministic Mulberry32 PRNG for reproducible forest worlds,
 * procedural god personalities, and testable simulation runs.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Returns true with probability p in [0, 1]. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks an element according to non-negative weights. */
  weightedPick<T>(items: readonly { item: T; weight: number }[]): T {
    let total = 0;
    for (const entry of items) {
      total += Math.max(0, entry.weight);
    }
    if (total <= 0) {
      return items[0].item;
    }
    let roll = this.next() * total;
    for (const entry of items) {
      roll -= Math.max(0, entry.weight);
      if (roll <= 0) {
        return entry.item;
      }
    }
    return items[items.length - 1].item;
  }

  /** Approximate standard normal via Box-Muller transform. */
  gaussian(mean = 0, stdDev = 1): number {
    const u1 = Math.max(1e-7, this.next());
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /** Creates a child PRNG derived deterministically from this stream. */
  fork(): SeededRandom {
    return new SeededRandom(Math.floor(this.next() * 0xffffffff));
  }
}
