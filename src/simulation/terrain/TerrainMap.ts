import type { WorldConfig } from '@core/Config';
import { SeededRandom } from '@core/SeededRandom';
import type { BiomeType, ResourceType, Vec2, Vec3 } from '@core/Types';
import { Noise2D } from './Noise';

export interface ResourceNode {
  readonly id: string;
  readonly type: ResourceType;
  readonly position: Vec2;
  amount: number;
  readonly maxAmount: number;
  readonly regenRate: number;
}

export interface TreeSpot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly kind: 'oak' | 'pine' | 'birch';
}

export interface PropSpot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly variant: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Headless continuous terrain heightfield, river carving, biome classification,
 * ecological resource nodes, and deterministic prop placement.
 * Extends continuously beyond the circular invisible playable boundary into
 * endless rolling woodland hills and distant misty ridges.
 */
export class TerrainMap {
  readonly size: number;
  readonly halfSize: number;
  readonly playableRadius: number;
  readonly waterLevel: number;
  readonly resourceNodes: ResourceNode[] = [];
  readonly trees: TreeSpot[] = [];
  readonly undergrowth: PropSpot[] = [];
  readonly rocks: PropSpot[] = [];

  private readonly elevationNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly fertilityNoise: Noise2D;
  private readonly riverCurvePhase: number;
  private readonly riverCurveFreq: number;
  private readonly walkGridHalf: number;
  private readonly walkGridSize: number;
  private readonly walkCache: Uint8Array;

  constructor(config: WorldConfig) {
    this.size = config.worldSize;
    this.halfSize = config.worldSize / 2;
    this.playableRadius = this.halfSize - 5;
    this.waterLevel = config.waterLevel;
    this.walkGridHalf = Math.ceil(this.playableRadius * 2) + 2;
    this.walkGridSize = this.walkGridHalf * 2;
    this.walkCache = new Uint8Array(this.walkGridSize * this.walkGridSize);

    const rng = new SeededRandom(config.seed ^ 0x4f524553);
    this.elevationNoise = new Noise2D(rng.int(1, 1_000_000));
    this.moistureNoise = new Noise2D(rng.int(1, 1_000_000));
    this.fertilityNoise = new Noise2D(rng.int(1, 1_000_000));
    this.riverCurvePhase = rng.range(0, Math.PI * 2);
    this.riverCurveFreq = rng.range(0.025, 0.04);

    this.generateResourceNodes(rng.fork());
    this.generateFloraAndRocks(config, rng.fork());
  }

  /** Centerline X position of the meandering woodland stream for a given Z. */
  getRiverCenterX(z: number): number {
    return (
      Math.sin(z * this.riverCurveFreq + this.riverCurvePhase) * 18 +
      Math.cos(z * 0.015 - this.riverCurvePhase * 0.5) * 9
    );
  }

  /** Signed distance from the winding river / central pond. */
  getWaterDistance(x: number, z: number): number {
    const riverX = this.getRiverCenterX(z);
    const riverDist = Math.abs(x - riverX) - 5.2;
    const pondDist = Math.hypot(x - 4, z + 6) - 12.5;
    return Math.min(riverDist, pondDist);
  }

  /** Continuous world height in meters at any (x, z) coordinate out to infinity. */
  getHeightAt(x: number, z: number): number {
    const radialDist = Math.hypot(x, z) / this.halfSize;

    // Smoothly transition from gentle central valley into endless rolling woodland hills & misty ridges
    const outerBlend = radialDist > 0.68 ? smoothstep(0.68, 1.5, radialDist) : 0;
    const farBlend = radialDist > 1.3 ? smoothstep(1.3, 2.8, radialDist) : 0;

    const hills = this.elevationNoise.fbm(x * 0.017, z * 0.017, 4, 2.05, 0.5) * 6.0;
    const broadHills =
      outerBlend > 0
        ? this.elevationNoise.fbm(x * 0.0062 + 4.3, z * 0.0062 - 2.9, 3, 2.0, 0.52) * 11.5
        : 0;
    const ridgeWeight = Math.min(1.45, Math.max(0, radialDist - 0.16));
    const ridge =
      ridgeWeight > 0
        ? this.elevationNoise.ridged(x * 0.011 + 11.4, z * 0.011 - 7.1, 2) * 3.6 * ridgeWeight
        : 0;
    const micro = this.elevationNoise.sample(x * 0.09, z * 0.09) * 0.35;

    let h =
      1.65 +
      hills * (1.0 - farBlend * 0.28) +
      broadHills * outerBlend * 0.65 +
      ridge +
      outerBlend * 4.8 +
      micro * (1.0 - farBlend * 0.65);

    // Carve the meandering woodland stream and central glade pond continuously into the distance
    const waterDist = this.getWaterDistance(x, z);
    if (waterDist < 10) {
      const t = Math.max(0, Math.min(1, (waterDist + 5.5) / 15.5));
      const smooth = t * t * (3 - 2 * t);
      const riverbedHeight = this.waterLevel - 1.35 + micro * 0.25;
      h = riverbedHeight + (h - riverbedHeight) * smooth;
    }

    return h;
  }

  /** Approximates the surface unit normal via central differences. */
  getNormalAt(x: number, z: number): Vec3 {
    const eps = 0.6;
    const hL = this.getHeightAt(x - eps, z);
    const hR = this.getHeightAt(x + eps, z);
    const hD = this.getHeightAt(x, z - eps);
    const hU = this.getHeightAt(x, z + eps);

    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  getSlopeAt(x: number, z: number): number {
    const n = this.getNormalAt(x, z);
    return 1 - n.y;
  }

  getMoistureAt(x: number, z: number): number {
    const waterDist = Math.max(0, this.getWaterDistance(x, z));
    const riverBoost = Math.exp(-waterDist * 0.08) * 0.55;
    const noiseVal = (this.moistureNoise.fbm(x * 0.025, z * 0.025, 3) + 1) * 0.5;
    return Math.max(0, Math.min(1, noiseVal * 0.65 + riverBoost));
  }

  getFertilityAt(x: number, z: number): number {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel) return 0;
    const moisture = this.getMoistureAt(x, z);
    const n = (this.fertilityNoise.fbm(x * 0.03, z * 0.03, 3) + 1) * 0.5;
    const altitudePenalty = Math.max(0, (h - 6.5) * 0.09);
    return Math.max(0, Math.min(1, n * 0.5 + moisture * 0.55 - altitudePenalty));
  }

  getBiomeAt(x: number, z: number): BiomeType {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel + 0.05) return 'water';
    if (h <= this.waterLevel + 0.75) return 'riverbank';
    const slope = this.getSlopeAt(x, z);
    if (h > 7.4 || slope > 0.25) return 'rocky_ridge';
    const moisture = this.getMoistureAt(x, z);
    const fertility = this.getFertilityAt(x, z);
    if (moisture > 0.68 && h < 3.2) return 'moss_hollow';
    if (fertility > 0.55 && h < 4.6) return 'meadow';
    return 'deep_woods';
  }

  /** Circular invisible playable boundary so creatures never encounter square walls. */
  isWithinPlayableArea(x: number, z: number, margin = 0): boolean {
    const limit = Math.max(10, this.playableRadius - margin);
    return x * x + z * z <= limit * limit;
  }

  isWalkable(x: number, z: number, amphibious = false): boolean {
    if (!this.isWithinPlayableArea(x, z)) return false;
    const gx = Math.floor(x * 2) + this.walkGridHalf;
    const gz = Math.floor(z * 2) + this.walkGridHalf;
    if (gx >= 0 && gx < this.walkGridSize && gz >= 0 && gz < this.walkGridSize) {
      const idx = gx * this.walkGridSize + gz;
      let val = this.walkCache[idx];
      if (val === 0) {
        const cx = (gx - this.walkGridHalf + 0.5) * 0.5;
        const cz = (gz - this.walkGridHalf + 0.5) * 0.5;
        const h = this.getHeightAt(cx, cz);
        if (h < this.waterLevel - 0.65 || this.getSlopeAt(cx, cz) >= 0.34) {
          val = 1;
        } else if (h < this.waterLevel + 0.12) {
          val = 2;
        } else {
          val = 3;
        }
        this.walkCache[idx] = val;
      }
      return amphibious ? val >= 2 : val === 3;
    }
    const h = this.getHeightAt(x, z);
    if (!amphibious && h < this.waterLevel + 0.12) return false;
    if (amphibious && h < this.waterLevel - 0.65) return false;
    return this.getSlopeAt(x, z) < 0.34;
  }

  /** Finds well-spaced, gently sloped clearings suitable for founding growing cities. */
  findSettlementSites(count: number, rng: SeededRandom): Vec2[] {
    const chosen: Vec2[] = [];
    const minSpacing = this.size * 0.24;
    const maxRadius = this.playableRadius - 18;

    for (let attempt = 0; attempt < 1100 && chosen.length < count; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * maxRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      const slope = this.getSlopeAt(x, z);
      if (h < this.waterLevel + 0.7 || h > 5.4 || slope > 0.13) continue;

      let tooClose = false;
      for (const site of chosen) {
        if (Math.hypot(site.x - x, site.z - z) < minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        chosen.push({ x, z });
      }
    }

    return chosen;
  }

  /** Regenerates ecological resource nodes over time (scaled by season/divine blessings). */
  tickResources(dt: number, growthMultiplier: number): void {
    for (const node of this.resourceNodes) {
      if (node.amount < node.maxAmount) {
        node.amount = Math.min(node.maxAmount, node.amount + node.regenRate * growthMultiplier * dt);
      }
    }
  }

  findNearestResource(
    origin: Vec2,
    types: readonly ResourceType[],
    minAmount = 1,
  ): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.resourceNodes) {
      if (node.amount < minAmount) continue;
      if (!types.includes(node.type)) continue;
      const dx = node.position.x - origin.x;
      const dz = node.position.z - origin.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = node;
      }
    }
    return best;
  }

  private generateResourceNodes(rng: SeededRandom): void {
    const types: { type: ResourceType; count: number; max: number; regen: number }[] = [
      { type: 'timber', count: 32, max: 72, regen: 0.58 },
      { type: 'berries', count: 24, max: 54, regen: 0.52 },
      { type: 'acorns', count: 22, max: 54, regen: 0.48 },
      { type: 'stone', count: 24, max: 68, regen: 0.38 },
      { type: 'herbs', count: 20, max: 46, regen: 0.46 },
    ];

    let idx = 0;
    const maxRadius = this.playableRadius - 6;
    for (const spec of types) {
      let placed = 0;
      for (let tries = 0; tries < 520 && placed < spec.count; tries++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const h = this.getHeightAt(x, z);
        if (h < this.waterLevel + 0.35) continue;
        const biome = this.getBiomeAt(x, z);
        if (spec.type === 'stone' && biome !== 'rocky_ridge' && rng.chance(0.55)) continue;
        if (spec.type === 'herbs' && biome !== 'moss_hollow' && biome !== 'riverbank' && rng.chance(0.55))
          continue;

        this.resourceNodes.push({
          id: `res_${idx++}`,
          type: spec.type,
          position: { x, z },
          amount: spec.max * rng.range(0.7, 1.0),
          maxAmount: spec.max,
          regenRate: spec.regen,
        });
        placed++;
      }
    }
  }

  private generateFloraAndRocks(config: WorldConfig, rng: SeededRandom): void {
    const treeRadius = this.halfSize + 14;
    const propRadius = this.halfSize + 6;

    // Trees
    let attempts = 0;
    while (this.trees.length < config.treeCount && attempts < config.treeCount * 14) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * treeRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + 0.45) continue;
      if (this.getSlopeAt(x, z) > 0.28) continue;

      const biome = this.getBiomeAt(x, z);
      if (biome === 'meadow' && rng.chance(0.72)) continue;

      let crowded = false;
      for (const existing of this.trees) {
        if (Math.hypot(existing.x - x, existing.z - z) < 3.4) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const kind: TreeSpot['kind'] =
        biome === 'rocky_ridge'
          ? rng.chance(0.72)
            ? 'pine'
            : 'oak'
          : biome === 'riverbank' || biome === 'moss_hollow'
            ? rng.chance(0.45)
              ? 'birch'
              : 'oak'
            : rng.pick(['oak', 'oak', 'pine', 'birch']);

      this.trees.push({
        x,
        z,
        y: h,
        scale: rng.range(0.78, 1.48),
        rotation: rng.range(0, Math.PI * 2),
        kind,
      });
    }

    // Ferns, bushes, mushrooms
    attempts = 0;
    while (
      this.undergrowth.length < config.undergrowthCount &&
      attempts < config.undergrowthCount * 8
    ) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + 0.2) continue;
      this.undergrowth.push({
        x,
        z,
        y: h,
        scale: rng.range(0.55, 1.35),
        rotation: rng.range(0, Math.PI * 2),
        variant: rng.int(0, 2),
      });
    }

    // Mossy boulders & forest rocks
    attempts = 0;
    while (this.rocks.length < config.rockCount && attempts < config.rockCount * 10) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      const biome = this.getBiomeAt(x, z);
      if (h < this.waterLevel - 0.1) continue;
      if (biome !== 'rocky_ridge' && biome !== 'riverbank' && rng.chance(0.7)) continue;
      this.rocks.push({
        x,
        z,
        y: h,
        scale: rng.range(0.55, 2.05),
        rotation: rng.range(0, Math.PI * 2),
        variant: rng.int(0, 2),
      });
    }
  }
}
