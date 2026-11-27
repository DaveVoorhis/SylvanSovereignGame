import { SeededRandom } from '@core/SeededRandom';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import type { WorldState } from '@simulation/WorldState';
import { isPointNearBridge } from './Bridge';
import type { TerrainMap, TreeSpot } from './TerrainMap';

export type MushroomStage = 'sprouting' | 'growing' | 'mature' | 'rotting';

/** Minimum lifespan of a woodland mushroom cluster in simulation days (1 day). */
export const MUSHROOM_MIN_LIFESPAN_DAYS = 1.0;
/** Maximum lifespan of a woodland mushroom cluster in simulation days (2 days). */
export const MUSHROOM_MAX_LIFESPAN_DAYS = 2.0;
/** Distance threshold (meters) considered "near a tree" for mycorrhizal mushroom affinity. */
export const MUSHROOM_NEAR_TREE_RADIUS = 6.5;
/** Coastal distance (meters) over which salt-spray suppression fades out moving inland. */
export const MUSHROOM_COAST_SUPPRESSION_DISTANCE = 95.0;
/** Default maximum concurrent mushroom patches supported by simulation & renderer buffers. */
export const DEFAULT_MAX_MUSHROOMS = 680;
/** Baseline steady-state mushroom patch count across the continent. */
const BASE_TARGET_MUSHROOMS = 520;

export interface MushroomPatch {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation: number;
  readonly maxScale: number;
  /** Current age in simulation days; removed once ageDays >= lifespanDays. */
  ageDays: number;
  /** Total lifespan in simulation days (always within 1-2 days). */
  readonly lifespanDays: number;
  /** Deterministic lean direction (radians) as the cluster wilts and rots. */
  readonly rotLeanAngle: number;
  /** Distance (m) to nearest tree trunk at spawn time (Infinity if none within search radius). */
  readonly nearestTreeDist: number;
  /** Signed distance (m) from the ocean shoreline (> 0 inland). */
  readonly coastDistance: number;
}

export interface MushroomVisualState {
  readonly stage: MushroomStage;
  /** Normalized 0..1 progress through the mushroom's short 1-2 day lifespan. */
  readonly lifeProgress: number;
  /** Horizontal scale multiplier relative to maxScale. */
  readonly scaleXZ: number;
  /** Vertical scale multiplier relative to maxScale. */
  readonly scaleY: number;
  /** Local vertical offset in meters (rises during sprouting, sinks as it rots). */
  readonly yOffset: number;
  /** Slump tilt angle in radians during decay. */
  readonly rotTilt: number;
  /** 0..1 rot intensity (0 = fresh, 1 = fully decayed dark humus). */
  readonly rotAmount: number;
}

export interface MushroomSystemSnapshot {
  readonly rngState: number;
  readonly nextId: number;
  readonly spawnAccumulator: number;
  readonly totalSproutedCount: number;
  readonly totalRottedCount: number;
  readonly patches: readonly MushroomPatch[];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Resolves the discrete lifecycle stage for a mushroom given its age and lifespan in days. */
export function resolveMushroomStage(ageDays: number, lifespanDays: number): MushroomStage {
  const u = clamp(ageDays / Math.max(0.01, lifespanDays), 0, 1);
  if (u < 0.18) return 'sprouting';
  if (u < 0.48) return 'growing';
  if (u < 0.72) return 'mature';
  return 'rotting';
}

/**
 * Computes continuous sprouting, growth, maturation, and rotting transform & color cues
 * across a mushroom patch's 1-2 day lifespan. All curves are C0-continuous across stage boundaries.
 */
export function evaluateMushroomVisualState(
  ageDays: number,
  lifespanDays: number,
): MushroomVisualState {
  const u = clamp(ageDays / Math.max(0.01, lifespanDays), 0, 1);

  if (u < 0.18) {
    const t = u / 0.18;
    const ease = smoothstep(0, 1, t);
    return {
      stage: 'sprouting',
      lifeProgress: u,
      scaleXZ: 0.08 + 0.34 * ease,
      scaleY: 0.10 + 0.38 * ease,
      yOffset: -0.07 + 0.05 * ease,
      rotTilt: 0,
      rotAmount: 0,
    };
  }

  if (u < 0.48) {
    const t = (u - 0.18) / 0.30;
    const ease = 1 - Math.pow(1 - t, 2.0);
    return {
      stage: 'growing',
      lifeProgress: u,
      scaleXZ: 0.42 + 0.58 * ease,
      scaleY: 0.48 + 0.52 * ease,
      yOffset: -0.02,
      rotTilt: 0,
      rotAmount: 0,
    };
  }

  if (u < 0.72) {
    const t = (u - 0.48) / 0.24;
    return {
      stage: 'mature',
      lifeProgress: u,
      scaleXZ: 1.0 + 0.04 * Math.sin(t * Math.PI),
      scaleY: 1.0 - 0.04 * t,
      yOffset: -0.02,
      rotTilt: 0.04 * t * t,
      rotAmount: smoothstep(0.65, 1.0, t) * 0.12,
    };
  }

  const t = (u - 0.72) / 0.28;
  const decay = smoothstep(0, 1, t);
  return {
    stage: 'rotting',
    lifeProgress: u,
    scaleXZ: 1.0 * (1 - 0.68 * Math.pow(t, 1.5)),
    scaleY: 0.96 * (1 - 0.82 * decay),
    yOffset: -0.02 - 0.10 * Math.pow(t, 1.4),
    rotTilt: 0.04 + 0.58 * Math.pow(t, 1.15),
    rotAmount: 0.12 + 0.88 * Math.pow(t, 0.75),
  };
}

/**
 * Spatial affinity multiplier based on distance to the nearest tree trunk:
 * highest right around shaded tree roots & drip lines, much lower in open ground.
 */
export function computeTreeProximityFactor(nearestTreeDist: number): number {
  if (nearestTreeDist < 0.72) return 0; // avoid clipping inside the trunk itself
  const proximity = 1 - smoothstep(1.4, 7.5, nearestTreeDist);
  return 0.12 + 0.88 * proximity;
}

/**
 * Spatial suppression multiplier based on signed distance from the ocean coastline:
 * mushrooms are least likely near the salty, wind-scoured sea and thrive further inland.
 */
export function computeSeaProximityFactor(coastDist: number): number {
  if (coastDist <= 1.5) return 0;
  const clearance = smoothstep(1.5, MUSHROOM_COAST_SUPPRESSION_DISTANCE, coastDist);
  return 0.012 + 0.988 * clearance * clearance;
}

const TREE_GRID_CELL = 8.0;
const TREE_GRID_OFFSET = 1024;
const TREE_GRID_STRIDE = 2048;

function treeGridKey(cx: number, cz: number): number {
  return (cx + TREE_GRID_OFFSET) * TREE_GRID_STRIDE + (cz + TREE_GRID_OFFSET);
}

/**
 * Headless dynamic woodland mushroom ecology:
 * - Mushrooms are ephemeral: each patch sprouts, grows, matures, and rots away within 1-2 days.
 * - Spatially weighted so mushrooms appear most readily near trees and least readily near the sea.
 */
export class MushroomSystem {
  readonly patches: MushroomPatch[] = [];
  readonly maxPatches: number;

  private readonly rng: SeededRandom;
  private readonly treeGrid = new Map<number, TreeSpot[]>();
  private nextId = 1;
  private spawnAccumulator = 0;
  private lastStructureRevision = -1;
  private _revision = 0;
  private _totalSproutedCount = 0;
  private _totalRottedCount = 0;

  constructor(
    private readonly terrain: TerrainMap,
    seed: number,
    maxPatches = DEFAULT_MAX_MUSHROOMS,
  ) {
    this.maxPatches = Math.max(32, Math.floor(maxPatches));
    this.rng = new SeededRandom(((seed ^ 0x5f3759df) + 0x9e3779b9) >>> 0);
    this.buildTreeSpatialIndex(terrain.trees);
  }

  get revision(): number {
    return this._revision;
  }

  get totalSproutedCount(): number {
    return this._totalSproutedCount;
  }

  get totalRottedCount(): number {
    return this._totalRottedCount;
  }

  private buildTreeSpatialIndex(trees: readonly TreeSpot[]): void {
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      const cx = Math.floor(tree.x / TREE_GRID_CELL);
      const cz = Math.floor(tree.z / TREE_GRID_CELL);
      const key = treeGridKey(cx, cz);
      let bucket = this.treeGrid.get(key);
      if (!bucket) {
        bucket = [];
        this.treeGrid.set(key, bucket);
      }
      bucket.push(tree);
    }
  }

  /**
   * Returns the distance in meters to the nearest living tree trunk within `maxRadius`,
   * or `Infinity` if no tree lies within `maxRadius`.
   */
  getNearestTreeDistance(
    x: number,
    z: number,
    maxRadius = 16.0,
    isTreeBlocked?: (tree: TreeSpot) => boolean,
  ): number {
    const cellRadius = Math.ceil(maxRadius / TREE_GRID_CELL);
    const cx = Math.floor(x / TREE_GRID_CELL);
    const cz = Math.floor(z / TREE_GRID_CELL);
    let minSq = maxRadius * maxRadius;
    let found = false;

    for (let gx = cx - cellRadius; gx <= cx + cellRadius; gx++) {
      for (let gz = cz - cellRadius; gz <= cz + cellRadius; gz++) {
        const bucket = this.treeGrid.get(treeGridKey(gx, gz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const tree = bucket[i];
          const dx = tree.x - x;
          const dz = tree.z - z;
          const dSq = dx * dx + dz * dz;
          if (dSq < minSq) {
            if (isTreeBlocked && isTreeBlocked(tree)) continue;
            minSq = dSq;
            found = true;
          }
        }
      }
    }

    return found ? Math.sqrt(minSq) : Infinity;
  }

  /**
   * Evaluates the continuous 0..1 habitat suitability weight for a mushroom at (x, z).
   * Highest near shaded woodland trees inland; lowest near the salty seashore; zero in water/desert.
   */
  evaluateHabitatWeight(
    x: number,
    z: number,
    effectiveWaterLevel = this.terrain.waterLevel,
    isTreeBlocked?: (tree: TreeSpot) => boolean,
  ): { weight: number; y: number; nearestTreeDist: number; coastDist: number } {
    const y = this.terrain.getHeightAt(x, z);
    if (y < effectiveWaterLevel + 0.22 || y > 16.5) {
      return { weight: 0, y, nearestTreeDist: Infinity, coastDist: -1 };
    }

    const coastDist = this.terrain.getCoastSignedDistance(x, z);
    const seaFactor = computeSeaProximityFactor(coastDist);
    if (seaFactor <= 0) {
      return { weight: 0, y, nearestTreeDist: Infinity, coastDist };
    }

    const slope = this.terrain.getSlopeAt(x, z);
    if (slope > 0.30) {
      return { weight: 0, y, nearestTreeDist: Infinity, coastDist };
    }

    const biome = this.terrain.getBiomeAtKnownHeight(x, z, y);
    let biomeFactor: number;
    switch (biome) {
      case 'moss_hollow':
        biomeFactor = 1.0;
        break;
      case 'deep_woods':
        biomeFactor = 0.95;
        break;
      case 'riverbank':
        biomeFactor = 0.85;
        break;
      case 'meadow':
        biomeFactor = 0.55;
        break;
      case 'rocky_ridge':
        biomeFactor = 0.32;
        break;
      case 'prairie':
        biomeFactor = 0.24;
        break;
      case 'alpine_crag':
        biomeFactor = 0.12;
        break;
      case 'seashore':
        biomeFactor = 0.22;
        break;
      case 'desert':
      case 'water':
      default:
        return { weight: 0, y, nearestTreeDist: Infinity, coastDist };
    }

    const nearestTreeDist = this.getNearestTreeDistance(x, z, 16.0, isTreeBlocked);
    const treeFactor = computeTreeProximityFactor(nearestTreeDist);
    if (treeFactor <= 0) {
      return { weight: 0, y, nearestTreeDist, coastDist };
    }

    return {
      weight: clamp(treeFactor * seaFactor * biomeFactor, 0, 1),
      y,
      nearestTreeDist,
      coastDist,
    };
  }

  /** Seeds a natural initial population staggered across sprouting, growing, mature, and rotting phases. */
  seedInitialPatches(world: WorldState): void {
    this.patches.length = 0;
    this.lastStructureRevision = world.structureRevision;
    const target = Math.min(this.maxPatches, Math.round(this.computeTargetCount(world) * 0.92));

    for (let i = 0; i < target; i++) {
      this.trySpawnPatch(world, this.rng.range(0, 0.92));
    }
    this._revision++;
  }

  /** Advances mushroom lifecycles by `dayFraction` in-game days, rotting expired patches and sprouting new ones. */
  tick(world: WorldState, dayFraction: number): void {
    if (dayFraction <= 0) return;

    const effectiveWater = world.getEffectiveWaterLevel();

    // Clear mushrooms swallowed by newly constructed buildings, bridges, or habitat scars
    if (world.structureRevision !== this.lastStructureRevision) {
      this.lastStructureRevision = world.structureRevision;
      for (let i = this.patches.length - 1; i >= 0; i--) {
        const m = this.patches[i];
        if (this.isBlockedByWorldStructures(world, m.x, m.z)) {
          this.patches.splice(i, 1);
          this._totalRottedCount++;
        }
      }
    }

    // Age every mushroom patch and remove those that have fully rotted away
    const droughtAccel = world.climateHeat > 0.45 ? 1 + (world.climateHeat - 0.45) * 1.6 : 1;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const m = this.patches[i];
      const submergedAccel = m.y < effectiveWater + 0.05 ? 3.5 : 1;
      m.ageDays += dayFraction * droughtAccel * submergedAccel;
      if (m.ageDays >= m.lifespanDays) {
        this.patches.splice(i, 1);
        this._totalRottedCount++;
      }
    }

    // Continuously sprout fresh mushrooms to sustain a cycling woodland fungal population
    const target = this.computeTargetCount(world);
    const avgLifespan = (MUSHROOM_MIN_LIFESPAN_DAYS + MUSHROOM_MAX_LIFESPAN_DAYS) * 0.5;
    const baseRatePerDay = target / avgLifespan;
    const shortfall = Math.max(0, target - this.patches.length);
    const spawnRatePerDay = baseRatePerDay + shortfall * 1.4;

    if (this.patches.length < this.maxPatches) {
      this.spawnAccumulator += dayFraction * spawnRatePerDay;
      // Keep per-frame spawns bounded while honoring coarse simulation steps accurately
      const maxSpawnsThisTick = Math.max(12, Math.ceil(dayFraction * this.maxPatches));
      let spawned = 0;
      while (
        this.spawnAccumulator >= 1 &&
        this.patches.length < this.maxPatches &&
        spawned < maxSpawnsThisTick
      ) {
        this.spawnAccumulator -= 1;
        this.trySpawnPatch(world, 0);
        spawned++;
      }
      if (this.spawnAccumulator > maxSpawnsThisTick) {
        this.spawnAccumulator = maxSpawnsThisTick;
      }
    } else {
      this.spawnAccumulator = 0;
    }

    this._revision++;
  }

  /**
   * Attempts to sprout a single mushroom patch using uniform-area rejection sampling weighted
   * by exact habitat probability (high near trees, lowest near the sea).
   */
  trySpawnPatch(world: WorldState, initialAgeRatio = 0): MushroomPatch | null {
    if (this.patches.length >= this.maxPatches) return null;

    const propRadius = this.terrain.halfSize + 10;
    const effectiveWater = world.getEffectiveWaterLevel();
    const hasScars = world.habitatScars.length > 0;
    const isTreeBlocked = hasScars
      ? (tree: TreeSpot) => world.isPointInHabitatScar(tree.x, tree.z)
      : undefined;

    for (let attempt = 0; attempt < 28; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const habitat = this.evaluateHabitatWeight(x, z, effectiveWater, isTreeBlocked);
      if (habitat.weight <= 0) continue;
      if (this.rng.next() > habitat.weight) continue;

      if (this.isBlockedByWorldStructures(world, x, z)) continue;
      if (this.isCrowdedByExistingMushroom(x, z, 1.25)) continue;

      const lifespanDays = this.rng.range(
        MUSHROOM_MIN_LIFESPAN_DAYS,
        MUSHROOM_MAX_LIFESPAN_DAYS,
      );
      const nearTreeBoost = habitat.nearestTreeDist <= MUSHROOM_NEAR_TREE_RADIUS ? 1.12 : 0.92;
      const patch: MushroomPatch = {
        id: this.nextId++,
        x,
        y: habitat.y,
        z,
        rotation: this.rng.range(0, Math.PI * 2),
        maxScale: this.rng.range(0.76, 1.48) * nearTreeBoost,
        ageDays: clamp(initialAgeRatio, 0, 0.95) * lifespanDays,
        lifespanDays,
        rotLeanAngle: this.rng.range(0, Math.PI * 2),
        nearestTreeDist: habitat.nearestTreeDist,
        coastDistance: habitat.coastDist,
      };
      this.patches.push(patch);
      this._totalSproutedCount++;
      return patch;
    }

    return null;
  }

  private computeTargetCount(world: WorldState): number {
    const scaleFactor = clamp(world.config.undergrowthCount / 3200, 0.25, 1.5);
    const seasonMult =
      world.season === 'autumn'
        ? 1.2
        : world.season === 'spring'
          ? 1.1
          : world.season === 'summer'
            ? 0.95
            : 0.65;
    const weatherMult =
      world.weather === 'rain' || world.weather === 'storm' || world.weather === 'mist'
        ? 1.15
        : world.weather === 'snow'
          ? 0.85
          : 1.0;
    const climateMult =
      (1 - clamp(world.climateHeat, 0, 1) * 0.62) *
      (1 - clamp(world.climateFreeze, 0, 1) * 0.62) *
      (1 + clamp(world.rewildingBoost, 0, 1) * 0.25);

    const raw = BASE_TARGET_MUSHROOMS * scaleFactor * seasonMult * weatherMult * climateMult;
    return clamp(Math.round(raw), Math.min(80, this.maxPatches), this.maxPatches);
  }

  private isBlockedByWorldStructures(world: WorldState, x: number, z: number): boolean {
    if (world.isPointInHabitatScar(x, z)) return true;

    const settlements = world.settlements;
    for (let s = 0; s < settlements.length; s++) {
      const settlement = settlements[s];
      const sdx = x - settlement.center.x;
      const sdz = z - settlement.center.z;
      const sDistSq = sdx * sdx + sdz * sdz;
      // Avoid sprouting inside the central hearth plaza
      if (sDistSq < 20.25) return true; // 4.5m radius
      // Broad-phase skip for distant settlements
      const maxCheckR = settlement.radius + 12;
      if (sDistSq > maxCheckR * maxCheckR) continue;
      for (let j = 0; j < settlement.buildings.length; j++) {
        const b = settlement.buildings[j];
        const clearR = BUILDING_CATALOG[b.type].footprintRadius + 0.85;
        const bdx = x - b.position.x;
        const bdz = z - b.position.z;
        if (bdx * bdx + bdz * bdz < clearR * clearR) return true;
      }
    }

    const bridges = world.bridges;
    for (let i = 0; i < bridges.length; i++) {
      if (isPointNearBridge(bridges[i], x, z, 1.4)) return true;
    }

    return false;
  }

  private isCrowdedByExistingMushroom(x: number, z: number, minDist: number): boolean {
    const minDistSq = minDist * minDist;
    for (let i = 0; i < this.patches.length; i++) {
      const m = this.patches[i];
      const dx = m.x - x;
      const dz = m.z - z;
      if (dx * dx + dz * dz < minDistSq) return true;
    }
    return false;
  }

  exportSnapshot(): MushroomSystemSnapshot {
    return {
      rngState: this.rng.getState(),
      nextId: this.nextId,
      spawnAccumulator: this.spawnAccumulator,
      totalSproutedCount: this._totalSproutedCount,
      totalRottedCount: this._totalRottedCount,
      patches: this.patches.map((m) => ({
        id: m.id,
        x: Math.round(m.x * 100) / 100,
        y: Math.round(m.y * 100) / 100,
        z: Math.round(m.z * 100) / 100,
        rotation: Math.round(m.rotation * 1000) / 1000,
        maxScale: Math.round(m.maxScale * 1000) / 1000,
        ageDays: Math.round(m.ageDays * 10000) / 10000,
        lifespanDays: Math.round(m.lifespanDays * 10000) / 10000,
        rotLeanAngle: Math.round(m.rotLeanAngle * 1000) / 1000,
        nearestTreeDist: Number.isFinite(m.nearestTreeDist)
          ? Math.round(m.nearestTreeDist * 100) / 100
          : 999,
        coastDistance: Math.round(m.coastDistance * 100) / 100,
      })),
    };
  }

  importSnapshot(snapshot: MushroomSystemSnapshot | undefined, world: WorldState): void {
    this.patches.length = 0;
    this.lastStructureRevision = world.structureRevision;

    if (!snapshot) {
      this.seedInitialPatches(world);
      return;
    }

    this.rng.setState(snapshot.rngState);
    this.nextId = snapshot.nextId;
    this.spawnAccumulator = snapshot.spawnAccumulator;
    this._totalSproutedCount = snapshot.totalSproutedCount;
    this._totalRottedCount = snapshot.totalRottedCount;

    const count = Math.min(this.maxPatches, snapshot.patches.length);
    for (let i = 0; i < count; i++) {
      const m = snapshot.patches[i];
      this.patches.push({
        ...m,
        nearestTreeDist: m.nearestTreeDist >= 998 ? Infinity : m.nearestTreeDist,
      });
    }
    this._revision++;
  }
}
