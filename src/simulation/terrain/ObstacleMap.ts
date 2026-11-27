import type { BuildingType, HabitatScar } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import type { Settlement } from '@simulation/settlements/Settlement';
import { isPointNearBridge, type BridgeInstance } from './Bridge';
import type { PropSpot, TerrainMap, TreeSpot } from './TerrainMap';

/** Minimum horizontal clearance from every settlement's central hearth firepit (stone ring outer edge ≈ 0.90m). */
export const HEARTH_FIRE_KEEP_OUT_RADIUS = 1.65;

/** Radius cleared of trees around initial settlement centers (matches FloraRenderer). */
export const INITIAL_CLEARING_TREE_RADIUS = 11.5;

export type ObstacleKind = 'hearth' | 'bench' | 'building' | 'tree' | 'rock' | 'bush';

export interface SolidObstacle {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Physical obstacle radius in meters (creature body radius is added during steering/separation). */
  readonly radius: number;
  /** Minimum total center-to-center distance enforced regardless of creature size (e.g. hearth firepit). */
  readonly minTotalRadius: number;
  /** Approximate obstacle height in meters; soaring aerial creatures above this height may fly over. */
  readonly height: number;
  readonly kind: ObstacleKind;
  /** Internal stamp used for zero-allocation spatial-grid deduplication. */
  _stamp: number;
}

/** Tight physical wall/plinth collision radius for each building type. */
export function getBuildingCollisionRadius(type: BuildingType): number {
  return BUILDING_CATALOG[type].footprintRadius * 0.88;
}

/** Solid trunk + root-flare collision radius for woodland trees. */
export function getTreeTrunkRadius(tree: TreeSpot): number {
  const base = tree.kind === 'oak' ? 0.62 : tree.kind === 'pine' ? 0.46 : 0.36;
  return base * tree.scale;
}

/** Solid boulder collision radius matching FloraRenderer's mossy boulders. */
export function getRockCollisionRadius(rock: PropSpot): number {
  return 1.02 * rock.scale;
}

/** Solid berry-bush collision radius matching FloraRenderer's plump berry bushes. */
export function getBushCollisionRadius(bush: PropSpot): number {
  return 0.68 * bush.scale;
}

const CELL_SIZE = 6.0;
const INV_CELL_SIZE = 1 / CELL_SIZE;

/**
 * Headless uniform spatial-hash obstacle map covering all solid world features:
 * buildings, tree trunks (excluding cleared settlement/building/scarred trees), mossy boulders,
 * plump berry bushes, settlement hearth firepits, and town benches.
 */
export class ObstacleMap {
  private grid: (SolidObstacle[] | null)[] = [];
  private readonly activeCellIndices: number[] = [];
  private gridHalf = 0;
  private gridDim = 0;
  private readonly allObstacles: SolidObstacle[] = [];
  private readonly scratch: SolidObstacle[] = [];

  // Cached static flora obstacle objects per TerrainMap to avoid reallocating ~4k objects on every build
  private cachedTerrain: TerrainMap | null = null;
  private cachedTreeObs: SolidObstacle[] = [];
  private cachedRockObs: SolidObstacle[] = [];
  private cachedBushObs: SolidObstacle[] = [];

  /** Zero-allocation scratch output populated by resolveCollisionsInto / pushPointOutsideObstaclesInto. */
  resX = 0;
  resZ = 0;
  resCollided = false;

  private lastSettlementCount = -1;
  private lastBuildingCount = -1;
  private lastBridgeCount = -1;
  private lastStructureRevision = -1;
  private queryStamp = 0;
  private _version = 0;

  /** Monotonic version incremented whenever settlements, buildings, or habitat scars change and the grid rebuilds. */
  get version(): number {
    return this._version;
  }

  /** Rebuilds the spatial grid whenever settlements, buildings, bridges, or cleared habitat scars change. */
  sync(
    terrain: TerrainMap,
    settlements: readonly Settlement[],
    bridges: readonly BridgeInstance[] = [],
    structureRevision = 0,
    habitatScars: readonly HabitatScar[] = [],
  ): void {
    let totalBuildings = 0;
    for (const s of settlements) {
      totalBuildings += s.buildings.length;
    }
    if (
      settlements.length === this.lastSettlementCount &&
      totalBuildings === this.lastBuildingCount &&
      bridges.length === this.lastBridgeCount &&
      structureRevision === this.lastStructureRevision
    ) {
      return;
    }

    this.lastSettlementCount = settlements.length;
    this.lastBuildingCount = totalBuildings;
    this.lastBridgeCount = bridges.length;
    this.lastStructureRevision = structureRevision;
    this._version++;

    const neededHalf = Math.ceil((terrain.halfSize + 48) * INV_CELL_SIZE) + 2;
    if (neededHalf !== this.gridHalf) {
      this.gridHalf = neededHalf;
      this.gridDim = neededHalf * 2;
      this.grid = new Array<SolidObstacle[] | null>(this.gridDim * this.gridDim).fill(null);
      this.activeCellIndices.length = 0;
    } else {
      for (let i = 0; i < this.activeCellIndices.length; i++) {
        const bucket = this.grid[this.activeCellIndices[i]];
        if (bucket) bucket.length = 0;
      }
      this.activeCellIndices.length = 0;
    }
    this.allObstacles.length = 0;

    if (this.cachedTerrain !== terrain) {
      this.cachedTerrain = terrain;
      let staticId = 1_000_000;
      this.cachedTreeObs = terrain.trees.map((tree) => ({
        id: staticId++,
        x: tree.x,
        z: tree.z,
        radius: getTreeTrunkRadius(tree),
        minTotalRadius: 0,
        height: 6.5 * tree.scale,
        kind: 'tree' as const,
        _stamp: 0,
      }));
      this.cachedRockObs = terrain.rocks.map((rock) => ({
        id: staticId++,
        x: rock.x,
        z: rock.z,
        radius: getRockCollisionRadius(rock),
        minTotalRadius: 0,
        height: 0.95 * rock.scale,
        kind: 'rock' as const,
        _stamp: 0,
      }));
      this.cachedBushObs = [];
      for (let i = 0; i < terrain.undergrowth.length; i++) {
        const prop = terrain.undergrowth[i];
        if (prop.variant !== 1) continue;
        this.cachedBushObs.push({
          id: staticId++,
          x: prop.x,
          z: prop.z,
          radius: getBushCollisionRadius(prop),
          minTotalRadius: 0,
          height: 0.9 * prop.scale,
          kind: 'bush' as const,
          _stamp: 0,
        });
      }
    }

    let nextId = 1;
    const grid = this.grid;
    const gridHalf = this.gridHalf;
    const gridDim = this.gridDim;
    const activeCellIndices = this.activeCellIndices;

    const insertObstacle = (obs: SolidObstacle): void => {
      obs._stamp = 0;
      this.allObstacles.push(obs);
      const span = obs.radius > obs.minTotalRadius ? obs.radius : obs.minTotalRadius;
      let minCx = Math.floor((obs.x - span) * INV_CELL_SIZE) + gridHalf;
      let maxCx = Math.floor((obs.x + span) * INV_CELL_SIZE) + gridHalf;
      let minCz = Math.floor((obs.z - span) * INV_CELL_SIZE) + gridHalf;
      let maxCz = Math.floor((obs.z + span) * INV_CELL_SIZE) + gridHalf;
      if (minCx < 0) minCx = 0;
      if (minCz < 0) minCz = 0;
      if (maxCx >= gridDim) maxCx = gridDim - 1;
      if (maxCz >= gridDim) maxCz = gridDim - 1;

      for (let cx = minCx; cx <= maxCx; cx++) {
        const rowOffset = cx * gridDim;
        for (let cz = minCz; cz <= maxCz; cz++) {
          const idx = rowOffset + cz;
          let bucket = grid[idx];
          if (!bucket) {
            bucket = [];
            grid[idx] = bucket;
          }
          if (bucket.length === 0) {
            activeCellIndices.push(idx);
          }
          bucket.push(obs);
        }
      }
    };

    const addObstacle = (
      x: number,
      z: number,
      radius: number,
      height: number,
      kind: ObstacleKind,
      minTotalRadius = 0,
    ): void => {
      insertObstacle({
        id: nextId++,
        x,
        z,
        radius,
        minTotalRadius,
        height,
        kind,
        _stamp: 0,
      });
    };

    // 1. Settlement centerpieces (hearth firepit + cozy bench; banner pole sits inside hearth radius)
    for (const s of settlements) {
      addObstacle(s.center.x, s.center.z, 1.32, 3.0, 'hearth', HEARTH_FIRE_KEEP_OUT_RADIUS);
      addObstacle(s.center.x - 1.35, s.center.z + 0.95, 0.56, 0.85, 'bench');

      // 2. All placed & under-construction buildings
      for (const b of s.buildings) {
        addObstacle(
          b.position.x,
          b.position.z,
          getBuildingCollisionRadius(b.type),
          4.2,
          'building',
        );
      }
    }

    const overlapsBridge = (x: number, z: number, margin: number): boolean => {
      for (let i = 0; i < bridges.length; i++) {
        if (isPointNearBridge(bridges[i], x, z, margin)) return true;
      }
      return false;
    };

    const overlapsScar = (x: number, z: number): boolean => {
      for (let i = 0; i < habitatScars.length; i++) {
        const sc = habitatScars[i];
        const dx = x - sc.x;
        const dz = z - sc.z;
        if (dx * dx + dz * dz < sc.radius * sc.radius) return true;
      }
      return false;
    };

    // 3. Standing forest trees (skip trees cleared from settlement clearings, building footprints, bridges & habitat scars)
    const clearingRadSq = INITIAL_CLEARING_TREE_RADIUS * INITIAL_CLEARING_TREE_RADIUS;
    const settleMaxDistSq = new Float64Array(settlements.length);
    for (let sIdx = 0; sIdx < settlements.length; sIdx++) {
      const s = settlements[sIdx];
      let maxExtent = INITIAL_CLEARING_TREE_RADIUS;
      for (let bIdx = 0; bIdx < s.buildings.length; bIdx++) {
        const b = s.buildings[bIdx];
        const bdx = b.position.x - s.center.x;
        const bdz = b.position.z - s.center.z;
        const reach = Math.sqrt(bdx * bdx + bdz * bdz) + BUILDING_CATALOG[b.type].footprintRadius + 1.45;
        if (reach > maxExtent) maxExtent = reach;
      }
      settleMaxDistSq[sIdx] = maxExtent * maxExtent;
    }

    for (let tIdx = 0; tIdx < this.cachedTreeObs.length; tIdx++) {
      const treeObs = this.cachedTreeObs[tIdx];
      if (overlapsScar(treeObs.x, treeObs.z)) continue;
      let cleared = false;
      for (let sIdx = 0; sIdx < settlements.length; sIdx++) {
        const s = settlements[sIdx];
        const dx = treeObs.x - s.center.x;
        const dz = treeObs.z - s.center.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < clearingRadSq) {
          cleared = true;
          break;
        }
        if (distSq > settleMaxDistSq[sIdx]) continue;
        for (const b of s.buildings) {
          const clearDist = BUILDING_CATALOG[b.type].footprintRadius + 1.45;
          const bdx = treeObs.x - b.position.x;
          const bdz = treeObs.z - b.position.z;
          if (bdx * bdx + bdz * bdz < clearDist * clearDist) {
            cleared = true;
            break;
          }
        }
        if (cleared) break;
      }
      if (cleared || overlapsBridge(treeObs.x, treeObs.z, 1.8)) continue;

      insertObstacle(treeObs);
    }

    // 4. Mossy boulders & forest rocks
    for (let rIdx = 0; rIdx < this.cachedRockObs.length; rIdx++) {
      const rockObs = this.cachedRockObs[rIdx];
      if (bridges.length > 0 && overlapsBridge(rockObs.x, rockObs.z, 1.3)) continue;
      insertObstacle(rockObs);
    }

    // 5. Plump berry bushes (undergrowth variant === 1; low ferns & toadstools remain walkable)
    for (let bIdx = 0; bIdx < this.cachedBushObs.length; bIdx++) {
      const bushObs = this.cachedBushObs[bIdx];
      if (bridges.length > 0 && overlapsBridge(bushObs.x, bushObs.z, 1.2)) continue;
      insertObstacle(bushObs);
    }
  }

  /** Returns a read-only view of all active solid obstacles (useful for tests & diagnostics). */
  getObstacles(): readonly SolidObstacle[] {
    return this.allObstacles;
  }

  /** Effective exclusion radius for a given obstacle and creature body radius. */
  getEffectiveRadius(obs: SolidObstacle, creatureRadius: number): number {
    return Math.max(obs.radius + creatureRadius, obs.minTotalRadius);
  }

  /** Populates `out` with all unique solid obstacles overlapping the search square around (x, z). */
  queryNearby(x: number, z: number, searchRadius: number, out: SolidObstacle[]): void {
    out.length = 0;
    const gridDim = this.gridDim;
    if (gridDim === 0) return;
    const stamp = ++this.queryStamp;
    const gridHalf = this.gridHalf;
    const grid = this.grid;

    let minCx = Math.floor((x - searchRadius) * INV_CELL_SIZE) + gridHalf;
    let maxCx = Math.floor((x + searchRadius) * INV_CELL_SIZE) + gridHalf;
    let minCz = Math.floor((z - searchRadius) * INV_CELL_SIZE) + gridHalf;
    let maxCz = Math.floor((z + searchRadius) * INV_CELL_SIZE) + gridHalf;
    if (minCx < 0) minCx = 0;
    if (minCz < 0) minCz = 0;
    if (maxCx >= gridDim) maxCx = gridDim - 1;
    if (maxCz >= gridDim) maxCz = gridDim - 1;

    for (let cx = minCx; cx <= maxCx; cx++) {
      const rowOffset = cx * gridDim;
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = grid[rowOffset + cz];
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const obs = bucket[i];
          if (obs._stamp === stamp) continue;
          obs._stamp = stamp;
          out.push(obs);
        }
      }
    }
  }

  /**
   * Pushes a candidate destination or spawn point smoothly outside all nearby solid obstacles
   * using up to 3 separation passes so it never settles inside a building, tree, rock, or fire.
   * Zero-allocation variant writes coordinates to `this.resX` and `this.resZ`.
   */
  pushPointOutsideObstaclesInto(
    x: number,
    z: number,
    refX: number,
    refZ: number,
    creatureRadius: number,
    altitude: number,
    extraMargin: number,
    fallbackAngle: number,
  ): void {
    let px = x;
    let pz = z;

    for (let pass = 0; pass < 3; pass++) {
      this.queryNearby(px, pz, 4.8 + extraMargin, this.scratch);
      let moved = false;

      for (let i = 0; i < this.scratch.length; i++) {
        const obs = this.scratch[i];
        if (altitude > obs.height) continue;
        const minR = this.getEffectiveRadius(obs, creatureRadius) + extraMargin;
        const dx = px - obs.x;
        const dz = pz - obs.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minR * minR) {
          let ux: number;
          let uz: number;
          if (dSq > 0.0025) {
            const d = Math.sqrt(dSq);
            ux = dx / d;
            uz = dz / d;
          } else {
            const rx = refX - obs.x;
            const rz = refZ - obs.z;
            const rd = Math.sqrt(rx * rx + rz * rz);
            if (rd > 0.05) {
              ux = rx / rd;
              uz = rz / rd;
            } else {
              ux = Math.cos(fallbackAngle);
              uz = Math.sin(fallbackAngle);
            }
          }
          px = obs.x + ux * (minR + 0.02);
          pz = obs.z + uz * (minR + 0.02);
          moved = true;
        }
      }

      if (!moved) break;
    }

    this.resX = px;
    this.resZ = pz;
  }

  pushPointOutsideObstacles(
    x: number,
    z: number,
    refX: number,
    refZ: number,
    creatureRadius: number,
    altitude: number,
    extraMargin: number,
    fallbackAngle: number,
  ): { x: number; z: number } {
    this.pushPointOutsideObstaclesInto(
      x,
      z,
      refX,
      refZ,
      creatureRadius,
      altitude,
      extraMargin,
      fallbackAngle,
    );
    return { x: this.resX, z: this.resZ };
  }

  /**
   * Resolves physical overlaps against nearby solid obstacles (multi-pass circle separation)
   * so creatures can never clip through buildings, tree trunks, boulders, bushes, benches, or fires.
   * Zero-allocation variant writes results to `this.resX`, `this.resZ`, and `this.resCollided`.
   */
  resolveCollisionsInto(
    x: number,
    z: number,
    creatureRadius: number,
    altitude: number,
    fallbackHeading: number,
  ): void {
    let px = x;
    let pz = z;
    let collided = false;

    for (let pass = 0; pass < 3; pass++) {
      this.queryNearby(px, pz, 4.5, this.scratch);
      let moved = false;

      for (let i = 0; i < this.scratch.length; i++) {
        const obs = this.scratch[i];
        if (altitude > obs.height) continue;
        const minR = this.getEffectiveRadius(obs, creatureRadius);
        const dx = px - obs.x;
        const dz = pz - obs.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minR * minR) {
          let ux: number;
          let uz: number;
          if (dSq > 0.0001) {
            const d = Math.sqrt(dSq);
            ux = dx / d;
            uz = dz / d;
          } else {
            ux = Math.cos(fallbackHeading);
            uz = Math.sin(fallbackHeading);
          }
          px = obs.x + ux * (minR + 0.006);
          pz = obs.z + uz * (minR + 0.006);
          moved = true;
          collided = true;
        }
      }

      if (!moved) break;
    }

    this.resX = px;
    this.resZ = pz;
    this.resCollided = collided;
  }

  resolveCollisions(
    x: number,
    z: number,
    creatureRadius: number,
    altitude: number,
    fallbackHeading: number,
  ): { x: number; z: number; collided: boolean } {
    this.resolveCollisionsInto(x, z, creatureRadius, altitude, fallbackHeading);
    return { x: this.resX, z: this.resZ, collided: this.resCollided };
  }
}
