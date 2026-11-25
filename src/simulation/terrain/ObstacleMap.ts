import type { BuildingType } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import type { Settlement } from '@simulation/settlements/Settlement';
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
const GRID_OFFSET = 512;
const GRID_STRIDE = 1024;

function cellKey(cx: number, cz: number): number {
  return (cx + GRID_OFFSET) * GRID_STRIDE + (cz + GRID_OFFSET);
}

/**
 * Headless uniform spatial-hash obstacle map covering all solid world features:
 * buildings, tree trunks (excluding cleared settlement/building trees), mossy boulders,
 * plump berry bushes, settlement hearth firepits, and town benches.
 */
export class ObstacleMap {
  private readonly cells = new Map<number, SolidObstacle[]>();
  private readonly allObstacles: SolidObstacle[] = [];
  private readonly scratch: SolidObstacle[] = [];

  private lastSettlementCount = -1;
  private lastBuildingCount = -1;
  private queryStamp = 0;

  /** Rebuilds the spatial grid whenever settlements or buildings change. */
  sync(terrain: TerrainMap, settlements: readonly Settlement[]): void {
    let totalBuildings = 0;
    for (const s of settlements) {
      totalBuildings += s.buildings.length;
    }
    if (
      settlements.length === this.lastSettlementCount &&
      totalBuildings === this.lastBuildingCount
    ) {
      return;
    }

    this.lastSettlementCount = settlements.length;
    this.lastBuildingCount = totalBuildings;
    this.cells.clear();
    this.allObstacles.length = 0;

    let nextId = 1;
    const addObstacle = (
      x: number,
      z: number,
      radius: number,
      height: number,
      kind: ObstacleKind,
      minTotalRadius = 0,
    ): void => {
      const obs: SolidObstacle = {
        id: nextId++,
        x,
        z,
        radius,
        minTotalRadius,
        height,
        kind,
        _stamp: 0,
      };
      this.allObstacles.push(obs);

      const span = Math.max(radius, minTotalRadius);
      const minCx = Math.floor((x - span) * INV_CELL_SIZE);
      const maxCx = Math.floor((x + span) * INV_CELL_SIZE);
      const minCz = Math.floor((z - span) * INV_CELL_SIZE);
      const maxCz = Math.floor((z + span) * INV_CELL_SIZE);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = cellKey(cx, cz);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(obs);
        }
      }
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

    // 3. Standing forest trees (skip trees cleared from settlement clearings & building footprints)
    for (const tree of terrain.trees) {
      let cleared = false;
      for (const s of settlements) {
        const dx = tree.x - s.center.x;
        const dz = tree.z - s.center.z;
        if (dx * dx + dz * dz < INITIAL_CLEARING_TREE_RADIUS * INITIAL_CLEARING_TREE_RADIUS) {
          cleared = true;
          break;
        }
        for (const b of s.buildings) {
          const clearDist = BUILDING_CATALOG[b.type].footprintRadius + 1.45;
          const bdx = tree.x - b.position.x;
          const bdz = tree.z - b.position.z;
          if (bdx * bdx + bdz * bdz < clearDist * clearDist) {
            cleared = true;
            break;
          }
        }
        if (cleared) break;
      }
      if (cleared) continue;

      addObstacle(tree.x, tree.z, getTreeTrunkRadius(tree), 6.5 * tree.scale, 'tree');
    }

    // 4. Mossy boulders & forest rocks
    for (const rock of terrain.rocks) {
      addObstacle(rock.x, rock.z, getRockCollisionRadius(rock), 0.95 * rock.scale, 'rock');
    }

    // 5. Plump berry bushes (undergrowth variant === 1; low ferns & toadstools remain walkable)
    for (const prop of terrain.undergrowth) {
      if (prop.variant !== 1) continue;
      addObstacle(prop.x, prop.z, getBushCollisionRadius(prop), 0.9 * prop.scale, 'bush');
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
    const stamp = ++this.queryStamp;

    const minCx = Math.floor((x - searchRadius) * INV_CELL_SIZE);
    const maxCx = Math.floor((x + searchRadius) * INV_CELL_SIZE);
    const minCz = Math.floor((z - searchRadius) * INV_CELL_SIZE);
    const maxCz = Math.floor((z + searchRadius) * INV_CELL_SIZE);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
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
   */
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
            const rd = Math.hypot(rx, rz);
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

    return { x: px, z: pz };
  }

  /**
   * Resolves physical overlaps against nearby solid obstacles (multi-pass circle separation)
   * so creatures can never clip through buildings, tree trunks, boulders, bushes, benches, or fires.
   */
  resolveCollisions(
    x: number,
    z: number,
    creatureRadius: number,
    altitude: number,
    fallbackHeading: number,
  ): { x: number; z: number; collided: boolean } {
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

    return { x: px, z: pz, collided };
  }
}
