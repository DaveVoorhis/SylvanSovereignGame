import type { WorldConfig } from '@core/Config';
import { SeededRandom } from '@core/SeededRandom';
import type { BiomeType, ResourceType, Vec2, Vec3, VillageAdaptationId } from '@core/Types';
import {
  ALL_VILLAGE_ADAPTATIONS,
  resolveVillageAdaptation,
} from '@simulation/settlements/VillageAdaptation';
import { getBridgeDeckHeightAt, type BridgeInstance } from './Bridge';
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

export interface PondFeature {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly cos: number;
  readonly sin: number;
  readonly scaleX: number;
  readonly scaleZ: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Polynomial smooth minimum so rivers, tributaries, lakes, and estuaries merge organically. */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Headless continuous continental terrain heightfield featuring sweeping biome diversity:
 * sandy seashore & ocean bay, golden sand-dune desert & mesas, wide sunlit prairie plains,
 * towering snow-capped mountains & granite foothills, deep old-growth forests, meandering
 * rivers & branching tributaries flowing to the sea, and misty mossy fens.
 * Extends continuously beyond the circular invisible playable boundary into endless sea & hills.
 */
export class TerrainMap {
  readonly size: number;
  readonly halfSize: number;
  readonly playableRadius: number;
  readonly waterLevel: number;
  readonly ponds: readonly PondFeature[];
  readonly coastAngle: number;
  readonly riverAngle: number;
  readonly tributaryAngle: number;
  readonly resourceNodes: ResourceNode[] = [];
  readonly trees: TreeSpot[] = [];
  readonly undergrowth: PropSpot[] = [];
  readonly rocks: PropSpot[] = [];

  private readonly elevationNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly fertilityNoise: Noise2D;
  private readonly climateNoise: Noise2D;

  // Seeded seashore & open ocean coastline on one side of the landmass
  private readonly coastCos: number;
  private readonly coastSin: number;
  private readonly coastBaseDist: number;
  private readonly coastPhase: number;

  // Seeded main river geometry flowing from mountain foothills toward the seashore bay
  private readonly riverCos: number;
  private readonly riverSin: number;
  private readonly riverOffset: number;
  private readonly riverHalfWidth: number;
  private readonly riverCurvePhase: number;
  private readonly riverCurveFreq: number;
  private readonly riverCurveAmp1: number;
  private readonly riverCurveFreq2: number;
  private readonly riverCurveAmp2: number;

  // Seeded branching tributary stream joining the main river
  private readonly tribOriginX: number;
  private readonly tribOriginZ: number;
  private readonly tribCos: number;
  private readonly tribSin: number;
  private readonly tribHalfWidth: number;
  private readonly tribCurvePhase: number;
  private readonly tribCurveFreq: number;
  private readonly tribCurveAmp: number;

  // Seeded macro-region centers (mountain range, golden desert, windswept prairie, misty fen)
  private readonly mountainCenterX: number;
  private readonly mountainCenterZ: number;
  private readonly mountainRadius: number;
  private readonly mountainPeakBoost: number;
  private readonly secondaryPeakX: number;
  private readonly secondaryPeakZ: number;

  private readonly desertCenterX: number;
  private readonly desertCenterZ: number;
  private readonly desertRadius: number;
  private readonly duneCos: number;
  private readonly duneSin: number;

  private readonly prairieCenterX: number;
  private readonly prairieCenterZ: number;
  private readonly prairieRadius: number;

  private readonly fenCenterX: number;
  private readonly fenCenterZ: number;
  private readonly fenRadius: number;

  // Seeded topographic character (rotated/warped relief, ridge profile, gentle valley slope)
  private readonly elevCos: number;
  private readonly elevSin: number;
  private readonly elevOffsetX: number;
  private readonly elevOffsetZ: number;
  private readonly ridgeOffsetX: number;
  private readonly ridgeOffsetZ: number;
  private readonly moistOffsetX: number;
  private readonly moistOffsetZ: number;
  private readonly fertOffsetX: number;
  private readonly fertOffsetZ: number;
  private readonly climOffsetX: number;
  private readonly climOffsetZ: number;
  private readonly hillScale: number;
  private readonly hillAmplitude: number;
  private readonly ridgeScale: number;
  private readonly ridgeAmplitude: number;
  private readonly warpStrength: number;
  private readonly valleyBaseHeight: number;
  private readonly tiltCos: number;
  private readonly tiltSin: number;
  private readonly tiltStrength: number;

  private readonly walkGridHalf: number;
  private readonly walkGridSize: number;
  private readonly walkCache: Uint8Array;
  private readonly completedBridges: BridgeInstance[] = [];

  constructor(config: WorldConfig) {
    this.size = config.worldSize;
    this.halfSize = config.worldSize / 2;
    this.playableRadius = this.halfSize - Math.max(5, Math.round(this.size * 0.028));
    this.waterLevel = config.waterLevel;
    this.walkGridHalf = Math.ceil(this.playableRadius * 2) + 2;
    this.walkGridSize = this.walkGridHalf * 2;
    this.walkCache = new Uint8Array(this.walkGridSize * this.walkGridSize);

    const rng = new SeededRandom(config.seed ^ 0x4f524553);
    this.elevationNoise = new Noise2D(rng.int(1, 1_000_000));
    this.moistureNoise = new Noise2D(rng.int(1, 1_000_000));
    this.fertilityNoise = new Noise2D(rng.int(1, 1_000_000));
    this.climateNoise = new Noise2D(rng.int(1, 1_000_000));

    const worldScale = this.size / 160;

    // 1. Seashore & Ocean Coastline along one edge of the region
    this.coastAngle = rng.range(0, Math.PI * 2);
    this.coastCos = Math.cos(this.coastAngle);
    this.coastSin = Math.sin(this.coastAngle);
    this.coastBaseDist = this.halfSize * rng.range(0.6, 0.68);
    this.coastPhase = rng.range(0, Math.PI * 2);

    // 2. Main River flowing from the mountain interior toward the seashore bay
    this.riverAngle = this.coastAngle + rng.range(-0.42, 0.42);
    this.riverCos = Math.cos(this.riverAngle);
    this.riverSin = Math.sin(this.riverAngle);
    this.riverOffset = rng.range(-18, 18) * Math.sqrt(worldScale);
    this.riverHalfWidth = rng.range(4.2, 6.4);
    this.riverCurvePhase = rng.range(0, Math.PI * 2);
    this.riverCurveFreq = rng.range(0.014, 0.026);
    this.riverCurveAmp1 = rng.range(12, 24) * Math.min(1.5, worldScale * 0.82);
    this.riverCurveFreq2 = rng.range(0.008, 0.015);
    this.riverCurveAmp2 = rng.range(5.0, 11.0) * Math.min(1.4, worldScale * 0.82);

    // 3. Branching tributary stream meeting the main river in the central valley
    const confluenceAlong = rng.range(-this.halfSize * 0.34, this.halfSize * 0.16);
    const confluenceAcross = this.getRiverCenterAcross(confluenceAlong);
    this.tribOriginX = confluenceAlong * this.riverCos - confluenceAcross * this.riverSin;
    this.tribOriginZ = confluenceAlong * this.riverSin + confluenceAcross * this.riverCos;
    const tribSide = rng.chance(0.5) ? 1 : -1;
    // Branch upstream toward the inland valley rather than straight into the sea
    this.tributaryAngle = this.riverAngle + Math.PI - tribSide * rng.range(0.75, 1.28);
    this.tribCos = Math.cos(this.tributaryAngle);
    this.tribSin = Math.sin(this.tributaryAngle);
    this.tribHalfWidth = rng.range(2.6, 3.9);
    this.tribCurvePhase = rng.range(0, Math.PI * 2);
    this.tribCurveFreq = rng.range(0.024, 0.042);
    this.tribCurveAmp = rng.range(6.5, 13.0);

    // 4. Mountain Range opposite the seashore (terraced granite slopes + alpine crags)
    const mountainAngle = this.coastAngle + Math.PI + rng.range(-0.28, 0.28);
    const mountainDist = this.halfSize * rng.range(0.56, 0.72);
    this.mountainCenterX = Math.cos(mountainAngle) * mountainDist;
    this.mountainCenterZ = Math.sin(mountainAngle) * mountainDist;
    this.mountainRadius = this.halfSize * rng.range(0.5, 0.62);
    this.mountainPeakBoost = rng.range(10.8, 14.2);

    const secPeakAngle = mountainAngle + rng.range(0.52, 0.92) * (rng.chance(0.5) ? 1 : -1);
    const secPeakDist = this.halfSize * rng.range(0.64, 0.84);
    this.secondaryPeakX = Math.cos(secPeakAngle) * secPeakDist;
    this.secondaryPeakZ = Math.sin(secPeakAngle) * secPeakDist;

    // 5. Golden Desert in the warm dry leeward flank between mountains and coast
    const desertSide = -tribSide; // Place desert away from the wet tributary!
    const desertAngle = mountainAngle + desertSide * rng.range(1.12, 1.48);
    const desertDist = this.halfSize * rng.range(0.46, 0.62);
    this.desertCenterX = Math.cos(desertAngle) * desertDist;
    this.desertCenterZ = Math.sin(desertAngle) * desertDist;
    this.desertRadius = this.halfSize * rng.range(0.44, 0.56);
    const duneAngle = desertAngle + rng.range(-0.6, 0.6);
    this.duneCos = Math.cos(duneAngle);
    this.duneSin = Math.sin(duneAngle);

    // 6. Sunlit Windswept Prairie across the opposite sunny flank
    const prairieAngle = mountainAngle - desertSide * rng.range(1.08, 1.44);
    const prairieDist = this.halfSize * rng.range(0.44, 0.6);
    this.prairieCenterX = Math.cos(prairieAngle) * prairieDist;
    this.prairieCenterZ = Math.sin(prairieAngle) * prairieDist;
    this.prairieRadius = this.halfSize * rng.range(0.45, 0.57);

    // 7. Lowland Misty Moss Fen tucked along a river bend inland from the estuary
    const fenAlong = rng.range(-this.halfSize * 0.25, this.halfSize * 0.28);
    const fenAcross = this.getRiverCenterAcross(fenAlong) + tribSide * rng.range(10, 22);
    this.fenCenterX = fenAlong * this.riverCos - fenAcross * this.riverSin;
    this.fenCenterZ = fenAlong * this.riverSin + fenAcross * this.riverCos;
    this.fenRadius = this.halfSize * rng.range(0.24, 0.34);

    // Procedural elevation orientation, domain warp, relief scale, and gentle continental tilt
    const elevAngle = rng.range(0, Math.PI * 2);
    this.elevCos = Math.cos(elevAngle);
    this.elevSin = Math.sin(elevAngle);
    this.elevOffsetX = rng.range(-120, 120);
    this.elevOffsetZ = rng.range(-120, 120);
    this.ridgeOffsetX = rng.range(-120, 120);
    this.ridgeOffsetZ = rng.range(-120, 120);
    this.moistOffsetX = rng.range(-100, 100);
    this.moistOffsetZ = rng.range(-100, 100);
    this.fertOffsetX = rng.range(-100, 100);
    this.fertOffsetZ = rng.range(-100, 100);
    this.climOffsetX = rng.range(-100, 100);
    this.climOffsetZ = rng.range(-100, 100);
    this.hillScale = rng.range(0.01, 0.0155);
    this.hillAmplitude = rng.range(4.2, 6.2);
    this.ridgeScale = rng.range(0.0075, 0.012);
    this.ridgeAmplitude = rng.range(2.8, 4.4);
    this.warpStrength = rng.range(6.0, 13.0);
    this.valleyBaseHeight = rng.range(1.6, 2.25);
    // Gentle continental slope downhill toward the sea
    this.tiltCos = -this.coastCos;
    this.tiltSin = -this.coastSin;
    this.tiltStrength = rng.range(0.65, 1.35);

    this.ponds = this.generatePonds(rng.fork());
    this.generateResourceNodes(rng.fork());
    this.generateFloraAndRocks(config, rng.fork());
  }

  private generatePonds(rng: SeededRandom): PondFeature[] {
    const ponds: PondFeature[] = [];
    const worldScale = this.size / 160;

    // 1. Primary woodland lagoon nestled near the mossy fen bend
    let px = this.fenCenterX + rng.range(-8, 8);
    let pz = this.fenCenterZ + rng.range(-8, 8);
    if (this.getCoastSignedDistance(px, pz) < 28) {
      const along = rng.range(-this.halfSize * 0.35, this.halfSize * 0.15);
      const across = this.getRiverCenterAcross(along) + rng.range(-8, 8);
      px = along * this.riverCos - across * this.riverSin;
      pz = along * this.riverSin + across * this.riverCos;
    }

    const pAngle = rng.range(0, Math.PI * 2);
    const pScaleX = rng.range(0.82, 1.26);
    ponds.push({
      x: px,
      z: pz,
      radius: rng.range(8.5, 13.5) * Math.min(1.3, Math.sqrt(worldScale)),
      cos: Math.cos(pAngle),
      sin: Math.sin(pAngle),
      scaleX: pScaleX,
      scaleZ: 1 / pScaleX,
    });

    // 2. Small sparkling desert oasis pool near the inner edge of the desert!
    if (worldScale >= 1.4) {
      const oasisX = this.desertCenterX * 0.82 + rng.range(-10, 10);
      const oasisZ = this.desertCenterZ * 0.82 + rng.range(-10, 10);
      if (this.getCoastSignedDistance(oasisX, oasisZ) > 26) {
        const oAngle = rng.range(0, Math.PI * 2);
        ponds.push({
          x: oasisX,
          z: oasisZ,
          radius: rng.range(5.4, 7.6),
          cos: Math.cos(oAngle),
          sin: Math.sin(oAngle),
          scaleX: 1.15,
          scaleZ: 0.87,
        });
      }
    }

    // 3. Additional inland tarns & lakes (1-2 more depending on worldSize)
    const extraCount = worldScale >= 1.5 ? 2 : rng.chance(0.6) ? 1 : 0;
    for (let k = 0; k < extraCount; k++) {
      for (let attempt = 0; attempt < 28; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const dist = rng.range(this.halfSize * 0.22, this.halfSize * 0.68);
        const sx = Math.cos(angle) * dist;
        const sz = Math.sin(angle) * dist;
        if (this.getCoastSignedDistance(sx, sz) < 28) continue;
        if (Math.hypot(sx - this.mountainCenterX, sz - this.mountainCenterZ) < this.mountainRadius * 0.48) {
          continue;
        }
        if (Math.hypot(sx - this.desertCenterX, sz - this.desertCenterZ) < this.desertRadius * 0.68) {
          continue;
        }
        let tooClose = false;
        for (const existing of ponds) {
          if (Math.hypot(sx - existing.x, sz - existing.z) < 38 * Math.sqrt(worldScale)) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const sAngle = rng.range(0, Math.PI * 2);
        const sScaleX = rng.range(0.82, 1.24);
        ponds.push({
          x: sx,
          z: sz,
          radius: rng.range(6.2, 10.4),
          cos: Math.cos(sAngle),
          sin: Math.sin(sAngle),
          scaleX: sScaleX,
          scaleZ: 1 / sScaleX,
        });
        break;
      }
    }

    return ponds;
  }

  /**
   * Signed distance from the meandering ocean seashore:
   * > 0 inland, 0 at shoreline, < 0 open ocean sea.
   */
  getCoastSignedDistance(x: number, z: number): number {
    const seaProj = x * this.coastCos + z * this.coastSin;
    const alongCoast = -x * this.coastSin + z * this.coastCos;
    const coveWave =
      Math.sin(alongCoast * 0.022 + this.coastPhase) * 14.5 +
      Math.cos(alongCoast * 0.047 - this.coastPhase * 0.7) * 6.5;
    const fineNoise =
      this.elevationNoise.sample(alongCoast * 0.015 + this.elevOffsetX, this.coastPhase) * 11.0;
    const shorelinePos = this.coastBaseDist + coveWave + fineNoise;
    return shorelinePos - seaProj;
  }

  /** True out in the open ocean beyond shallow beach wading surf. */
  isDeepSeaAt(x: number, z: number): boolean {
    return this.getCoastSignedDistance(x, z) < -3.0;
  }

  /**
   * Far-wandering pioneer parties can ford inland rivers & streams (rafting/wading across)
   * when no bridge exists yet, while staying strictly out of the open ocean and sheer cliffs.
   */
  canEmigrantTraverse(x: number, z: number): boolean {
    if (!this.isWithinPlayableArea(x, z)) return false;
    if (this.getBridgeDeckY(x, z) !== null) return true;
    if (this.isDeepSeaAt(x, z)) return false;
    return this.getSlopeAt(x, z) < 0.38;
  }

  /** Centerline perpendicular offset of the meandering main river at a given distance along its axis. */
  private getRiverCenterAcross(along: number): number {
    return (
      this.riverOffset +
      Math.sin(along * this.riverCurveFreq + this.riverCurvePhase) * this.riverCurveAmp1 +
      Math.cos(along * this.riverCurveFreq2 - this.riverCurvePhase * 0.6) * this.riverCurveAmp2
    );
  }

  /** Centerline perpendicular offset of the branching tributary stream for along >= 0. */
  private getTributaryCenterAcross(along: number): number {
    const taper = smoothstep(0, 22, along);
    return Math.sin(along * this.tribCurveFreq + this.tribCurvePhase) * this.tribCurveAmp * taper;
  }

  /** Signed distance to the branching tributary stream (negative inside water). */
  private getTributarySignedDistance(x: number, z: number): number {
    const rx = x - this.tribOriginX;
    const rz = z - this.tribOriginZ;
    const along = rx * this.tribCos + rz * this.tribSin;
    const across = -rx * this.tribSin + rz * this.tribCos;
    if (along < -this.tribHalfWidth) {
      return Math.hypot(rx, rz) - this.tribHalfWidth;
    }
    const clampedAlong = Math.max(0, along);
    const centerAcross = this.getTributaryCenterAcross(clampedAlong);
    const perpDist = Math.abs(across - centerAcross);
    if (along < 0) {
      return Math.hypot(along, perpDist) - this.tribHalfWidth;
    }
    return perpDist - this.tribHalfWidth;
  }

  /** Signed elliptical distance to a specific pond shoreline (negative inside water). */
  private getPondSignedDistance(x: number, z: number, pond: PondFeature): number {
    const dx = x - pond.x;
    const dz = z - pond.z;
    const lx = (dx * pond.cos + dz * pond.sin) / pond.scaleX;
    const lz = (-dx * pond.sin + dz * pond.cos) / pond.scaleZ;
    return Math.hypot(lx, lz) - pond.radius;
  }

  /** Signed distance from freshwater rivers, tributary, and lakes (negative inside water). */
  getFreshwaterDistance(x: number, z: number): number {
    const along = x * this.riverCos + z * this.riverSin;
    const across = -x * this.riverSin + z * this.riverCos;
    const riverAcross = this.getRiverCenterAcross(along);
    // Naturally widen river slightly into an estuary as it nears the sea
    const coastDist = this.getCoastSignedDistance(x, z);
    const estuaryBoost = (1 - smoothstep(-4, 28, coastDist)) * 5.2;
    const riverDist = Math.abs(across - riverAcross) - (this.riverHalfWidth + estuaryBoost);

    const tribDist = this.getTributarySignedDistance(x, z);
    let waterDist = smoothMin(riverDist, tribDist, 3.0);

    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      waterDist = smoothMin(waterDist, pondDist, 3.4);
    }
    return waterDist;
  }

  /** Signed distance from ALL water: rivers, tributary, lakes, and the ocean seashore. */
  getWaterDistance(x: number, z: number): number {
    const fresh = this.getFreshwaterDistance(x, z);
    const coast = this.getCoastSignedDistance(x, z);
    return smoothMin(fresh, coast, 4.5);
  }

  /**
   * Downstream surface flow vector (world XZ) for realistic flowing water shaders.
   * Follows the river & tributary toward the sea, calms in ponds, and rolls gently as surf along the coast.
   */
  getWaterFlowAt(x: number, z: number): Vec2 {
    const coastDist = this.getCoastSignedDistance(x, z);
    if (coastDist < 2.0) {
      // Gentle onshore coastal wave drift
      const surf = 0.24 + (1 - smoothstep(-24, 2, coastDist)) * 0.14;
      return { x: -this.coastCos * surf, z: -this.coastSin * surf };
    }

    const along = x * this.riverCos + z * this.riverSin;
    const across = -x * this.riverSin + z * this.riverCos;
    const riverDist = Math.abs(across - this.getRiverCenterAcross(along)) - this.riverHalfWidth;
    const tribDist = this.getTributarySignedDistance(x, z);

    let fx: number;
    let fz: number;
    if (tribDist < riverDist - 0.5) {
      const rx = x - this.tribOriginX;
      const rz = z - this.tribOriginZ;
      const tAlong = Math.max(0, rx * this.tribCos + rz * this.tribSin);
      const eps = 0.6;
      const dAcross =
        (this.getTributaryCenterAcross(tAlong + eps) - this.getTributaryCenterAcross(Math.max(0, tAlong - eps))) /
        (2 * eps);
      fx = -(this.tribCos - dAcross * this.tribSin);
      fz = -(this.tribSin + dAcross * this.tribCos);
    } else {
      const eps = 0.6;
      const dAcross =
        (this.getRiverCenterAcross(along + eps) - this.getRiverCenterAcross(along - eps)) /
        (2 * eps);
      fx = this.riverCos - dAcross * this.riverSin;
      fz = this.riverSin + dAcross * this.riverCos;
    }

    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;

    let pondCalm = 1.0;
    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      const calm = smoothstep(-3.0, 6.0, pondDist);
      if (calm < pondCalm) pondCalm = calm;
    }
    const speed = 0.22 + 0.78 * pondCalm;
    return { x: fx * speed, z: fz * speed };
  }

  /** Warmth / aridity index in [0, 1] creating a coherent golden sand-dune desert region. */
  getAridityAt(x: number, z: number): number {
    const dx = x - this.desertCenterX;
    const dz = z - this.desertCenterZ;
    const sectorDist = Math.hypot(dx, dz) / this.desertRadius;
    const sectorMask = 1 - smoothstep(0.45, 1.18, sectorDist);
    const n =
      (this.climateNoise.fbm(x * 0.011 + this.climOffsetX, z * 0.011 + this.climOffsetZ, 3) + 1) *
      0.5;
    const freshDist = Math.max(0, this.getFreshwaterDistance(x, z));
    const waterCool = Math.exp(-freshDist * 0.09) * 0.48;
    const coastCool = (1 - smoothstep(4, 24, this.getCoastSignedDistance(x, z))) * 0.45;
    return Math.max(0, Math.min(1, sectorMask * 0.88 + n * 0.32 - waterCool - coastCool));
  }

  /** Broad sunlit grassland openness index in [0, 1] defining the windswept prairie plains. */
  getPrairieWeightAt(x: number, z: number): number {
    const dx = x - this.prairieCenterX;
    const dz = z - this.prairieCenterZ;
    const sectorDist = Math.hypot(dx, dz) / this.prairieRadius;
    const sectorMask = 1 - smoothstep(0.46, 1.16, sectorDist);
    const n =
      (this.fertilityNoise.fbm(x * 0.012 - this.fertOffsetX, z * 0.012 + this.fertOffsetZ, 2) + 1) *
      0.5;
    return Math.max(0, Math.min(1, sectorMask * 0.85 + n * 0.24 - this.getAridityAt(x, z) * 0.4));
  }

  /** Continuous world height in meters at any (x, z) coordinate out to infinity. */
  getHeightAt(x: number, z: number): number {
    const radialDist = Math.hypot(x, z) / this.halfSize;
    const coastDist = this.getCoastSignedDistance(x, z);
    const landMask = smoothstep(-6, 30, coastDist);

    // Smoothly transition inland outer terrain into distant hills & peaks, while keeping the ocean open
    const outerBlend = (radialDist > 0.78 ? smoothstep(0.78, 1.65, radialDist) : 0) * landMask;
    const farBlend = radialDist > 1.35 ? smoothstep(1.35, 2.75, radialDist) : 0;

    // Seeded coordinate rotation + organic domain warp
    const rx = x * this.elevCos - z * this.elevSin;
    const rz = x * this.elevSin + z * this.elevCos;
    const warpX =
      this.elevationNoise.sample(rx * 0.0065 + this.elevOffsetX, rz * 0.0065 + this.elevOffsetZ) *
      this.warpStrength;
    const warpZ =
      this.elevationNoise.sample(
        rx * 0.0065 - this.elevOffsetZ + 17.3,
        rz * 0.0065 + this.elevOffsetX - 11.7,
      ) * this.warpStrength;
    const wx = rx + warpX;
    const wz = rz + warpZ;

    const hills =
      this.elevationNoise.fbm(
        wx * this.hillScale + this.elevOffsetX,
        wz * this.hillScale + this.elevOffsetZ,
        4,
        2.05,
        0.5,
      ) * this.hillAmplitude;
    const broadHills =
      outerBlend > 0
        ? this.elevationNoise.fbm(
            rx * 0.005 + this.elevOffsetX * 0.35 + 4.3,
            rz * 0.005 + this.elevOffsetZ * 0.35 - 2.9,
            3,
            2.0,
            0.52,
          ) * 9.6
        : 0;

    const ridgeWeight = Math.min(1.5, Math.max(0, radialDist - 0.16)) * landMask;
    const ridgeNoise = this.elevationNoise.ridged(
      wx * this.ridgeScale + this.ridgeOffsetX,
      wz * this.ridgeScale + this.ridgeOffsetZ,
      2,
    );
    const ridge = ridgeWeight > 0 ? ridgeNoise * this.ridgeAmplitude * ridgeWeight : 0;

    // 1. Towering Mountain Range & Terraced Granite Benches
    const hiDist = Math.hypot(x - this.mountainCenterX, z - this.mountainCenterZ) / this.mountainRadius;
    const hiMask = (1 - smoothstep(0.16, 1.12, hiDist)) * landMask;
    const secDist =
      Math.hypot(x - this.secondaryPeakX, z - this.secondaryPeakZ) / (this.mountainRadius * 0.72);
    const secMask = (1 - smoothstep(0.14, 1.05, secDist)) * landMask;
    const rawMassif =
      (hiMask * this.mountainPeakBoost + secMask * (this.mountainPeakBoost * 0.68)) *
      (0.56 + ridgeNoise * 0.58);
    const terraceStep = 3.5;
    const terracedMassif =
      rawMassif > 0.5
        ? rawMassif - Math.sin((rawMassif / terraceStep) * Math.PI * 2) * 0.44
        : rawMassif;

    // 2. Desert Sand Dunes & Flat-Topped Sandstone Mesas
    const desDist = Math.hypot(x - this.desertCenterX, z - this.desertCenterZ) / this.desertRadius;
    const desMask = (1 - smoothstep(0.32, 1.12, desDist)) * landMask;
    let desertSculpt = 0;
    if (desMask > 0.001) {
      const duneU = x * this.duneCos + z * this.duneSin;
      const duneV = -x * this.duneSin + z * this.duneCos;
      const duneWarp = this.climateNoise.sample(duneU * 0.015, duneV * 0.015) * 3.2;
      const dunes = (1 - Math.abs(Math.sin(duneU * 0.125 + duneWarp))) * 1.55;
      const mesaRaw =
        (this.elevationNoise.fbm(x * 0.018 + 31.4, z * 0.018 - 19.2, 2) + 1) * 0.5;
      const mesa = smoothstep(0.68, 0.79, mesaRaw) * 3.6;
      desertSculpt = desMask * (1.2 + dunes + mesa);
    }

    // 3. Broad Gently Rolling Prairie Plains
    const praDist = Math.hypot(x - this.prairieCenterX, z - this.prairieCenterZ) / this.prairieRadius;
    const praMask = (1 - smoothstep(0.28, 1.08, praDist)) * landMask;

    // 4. Lowland Misty Fen Depression
    const fenDist = Math.hypot(x - this.fenCenterX, z - this.fenCenterZ) / this.fenRadius;
    const fenMask = (1 - smoothstep(0.2, 1.05, fenDist)) * landMask;

    const micro =
      this.elevationNoise.sample(rx * 0.085 + this.elevOffsetX, rz * 0.085 + this.elevOffsetZ) * 0.34;
    const valleyTilt =
      Math.tanh((x * this.tiltCos + z * this.tiltSin) / this.halfSize) * this.tiltStrength;

    const hillDamping = 1.0 - fenMask * 0.45 - praMask * 0.52 - desMask * 0.42;
    let h =
      this.valleyBaseHeight +
      valleyTilt +
      hills * (1.0 - farBlend * 0.28) * Math.max(0.25, hillDamping) +
      broadHills * outerBlend * 0.64 +
      ridge * (1.0 - praMask * 0.65) +
      terracedMassif +
      desertSculpt +
      outerBlend * 5.2 +
      micro * (1.0 - farBlend * 0.65);

    // Smooth prairie floor into inviting sunlit rolling grasslands (~1.9m..3.4m)
    if (praMask > 0) {
      const gentlePrairie = 2.25 + hills * 0.2 + micro * 0.4;
      h = h + (gentlePrairie - h) * praMask * 0.46;
    }

    // Flatten fenlands into gentle low mossy marshes slightly above waterLevel
    if (fenMask > 0) {
      const fenFloor = this.waterLevel + 0.68 + micro * 0.35;
      h = h + (fenFloor - h) * fenMask * 0.52;
    }

    // Carve freshwater river, tributary, and lakes
    const freshDist = this.getFreshwaterDistance(x, z);
    if (freshDist < 12) {
      const t = Math.max(0, Math.min(1, (freshDist + 5.5) / 17.5));
      const smooth = t * t * (3 - 2 * t);
      const riverbedHeight = this.waterLevel - 1.4 + micro * 0.24;
      h = riverbedHeight + (h - riverbedHeight) * smooth;
    }

    // Sculpt sweeping sandy seashore sloping cleanly into the open ocean bay!
    if (coastDist < 34) {
      if (coastDist <= 0) {
        const seaT = smoothstep(0, -28, coastDist);
        const seaFloor = this.waterLevel - 0.08 - seaT * 2.35 + micro * 0.16;
        h = Math.min(h, seaFloor);
      } else {
        // Gentle golden beach incline from shoreline (coastDist = 0) up to coastal dunes (coastDist = 34)
        const beachT = smoothstep(0, 34, coastDist);
        const beachProfile = this.waterLevel - 0.04 + Math.pow(beachT, 0.88) * 2.6 + micro * 0.25;
        const blend = 1 - smoothstep(10, 34, coastDist);
        h = h + (beachProfile - h) * blend;
      }
    }

    return Math.max(this.waterLevel - 2.6, Math.min(33.5, h));
  }

  /** Approximates the surface unit normal via central differences. */
  getNormalAt(x: number, z: number): Vec3 {
    const eps = 0.65;
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
    const freshDist = Math.max(0, this.getFreshwaterDistance(x, z));
    const riverBoost = Math.exp(-freshDist * 0.068) * 0.56;
    const fenDist = Math.hypot(x - this.fenCenterX, z - this.fenCenterZ) / this.fenRadius;
    const fenBoost = (1 - smoothstep(0.2, 1.1, fenDist)) * 0.34;
    const noiseVal =
      (this.moistureNoise.fbm(
        x * 0.018 + this.moistOffsetX,
        z * 0.018 + this.moistOffsetZ,
        3,
      ) +
        1) *
      0.5;
    const aridity = this.getAridityAt(x, z);
    return Math.max(0, Math.min(1, noiseVal * 0.54 + riverBoost + fenBoost - aridity * 0.48));
  }

  getFertilityAt(x: number, z: number): number {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel) return 0;
    const moisture = this.getMoistureAt(x, z);
    const aridity = this.getAridityAt(x, z);
    const n =
      (this.fertilityNoise.fbm(
        x * 0.022 + this.fertOffsetX,
        z * 0.022 + this.fertOffsetZ,
        3,
      ) +
        1) *
      0.5;
    const altitudePenalty = Math.max(0, (h - 6.8) * 0.085);
    return Math.max(0, Math.min(1, n * 0.5 + moisture * 0.52 - altitudePenalty - aridity * 0.34));
  }

  getBiomeAt(x: number, z: number): BiomeType {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel + 0.05) return 'water';

    const coastDist = this.getCoastSignedDistance(x, z);
    if (coastDist < 19.5 && h < this.waterLevel + 2.55) return 'seashore';

    const slope = this.getSlopeAt(x, z);
    if (h > 10.0 || (h > 8.4 && slope > 0.22)) return 'alpine_crag';
    if (h > 6.6 || slope > 0.24) return 'rocky_ridge';

    const freshDist = this.getFreshwaterDistance(x, z);
    if (freshDist < 5.5 && h <= this.waterLevel + 1.05) return 'riverbank';

    const aridity = this.getAridityAt(x, z);
    const moisture = this.getMoistureAt(x, z);
    if (aridity > 0.54 && moisture < 0.44 && freshDist > 4.2) return 'desert';

    if (moisture > 0.65 && h < 3.4) return 'moss_hollow';

    const prairie = this.getPrairieWeightAt(x, z);
    if (prairie > 0.56 && h < 5.2) return 'prairie';

    const fertility = this.getFertilityAt(x, z);
    if (fertility > 0.54 && h < 4.8) return 'meadow';
    return 'deep_woods';
  }

  /** Classifies the natural environmental village adaptation at (x, z). */
  getSiteAdaptation(x: number, z: number): VillageAdaptationId {
    const biome = this.getBiomeAt(x, z);
    const elevation = this.getHeightAt(x, z);
    const freshDist = this.getFreshwaterDistance(x, z);
    const moisture = this.getMoistureAt(x, z);
    const coastDist = this.getCoastSignedDistance(x, z);
    return resolveVillageAdaptation(biome, elevation, freshDist, moisture, coastDist);
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
        if (this.getBridgeDeckY(cx, cz) !== null) {
          val = 3;
        } else if (this.isDeepSeaAt(cx, cz)) {
          val = 1;
        } else {
          const h = this.getHeightAt(cx, cz);
          if (h < this.waterLevel - 0.65 || this.getSlopeAt(cx, cz) >= 0.36) {
            val = 1;
          } else if (h < this.waterLevel + 0.12) {
            val = 2;
          } else {
            val = 3;
          }
        }
        this.walkCache[idx] = val;
      }
      return amphibious ? val >= 2 : val === 3;
    }
    if (this.getBridgeDeckY(x, z) !== null) return true;
    if (this.isDeepSeaAt(x, z)) return false;
    const h = this.getHeightAt(x, z);
    if (!amphibious && h < this.waterLevel + 0.12) return false;
    if (amphibious && h < this.waterLevel - 0.65) return false;
    return this.getSlopeAt(x, z) < 0.36;
  }

  /** Registers a finished creature-built bridge so terrain walkability & elevation include its deck. */
  registerCompletedBridge(bridge: BridgeInstance): void {
    if (!this.completedBridges.some((b) => b.id === bridge.id)) {
      this.completedBridges.push(bridge);
    }
    const pad = bridge.width * 0.5 + 2.2;
    const minX = Math.min(bridge.startX, bridge.endX) - pad;
    const maxX = Math.max(bridge.startX, bridge.endX) + pad;
    const minZ = Math.min(bridge.startZ, bridge.endZ) - pad;
    const maxZ = Math.max(bridge.startZ, bridge.endZ) + pad;
    const minGx = Math.max(0, Math.floor(minX * 2) + this.walkGridHalf);
    const maxGx = Math.min(this.walkGridSize - 1, Math.ceil(maxX * 2) + this.walkGridHalf);
    const minGz = Math.max(0, Math.floor(minZ * 2) + this.walkGridHalf);
    const maxGz = Math.min(this.walkGridSize - 1, Math.ceil(maxZ * 2) + this.walkGridHalf);
    for (let gx = minGx; gx <= maxGx; gx++) {
      const row = gx * this.walkGridSize;
      for (let gz = minGz; gz <= maxGz; gz++) {
        this.walkCache[row + gz] = 0;
      }
    }
  }

  /** Returns the elevated bridge deck height if (x, z) sits on any completed bridge, else null. */
  getBridgeDeckY(x: number, z: number): number | null {
    if (this.completedBridges.length === 0) return null;
    let best: number | null = null;
    for (let i = 0; i < this.completedBridges.length; i++) {
      const y = getBridgeDeckHeightAt(this.completedBridges[i], x, z, 0.12, 0.7);
      if (y !== null && (best === null || y > best)) {
        best = y;
      }
    }
    return best;
  }

  /**
   * Probes inland rivers and tributaries near (originX, originZ) for a sturdy, well-spaced
   * bridge crossing spanning from dry home bank to dry opposite bank (never across open sea).
   */
  findRiverCrossingNear(
    originX: number,
    originZ: number,
    rng: SeededRandom,
    existingBridges: readonly BridgeInstance[],
    avoidPoints: readonly { x: number; z: number; radius: number }[],
    maxSearchDist = 72,
  ): Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> | null {
    const originAlong = originX * this.riverCos + originZ * this.riverSin;
    const originTribAlong =
      (originX - this.tribOriginX) * this.tribCos + (originZ - this.tribOriginZ) * this.tribSin;
    const maxPlayable = this.playableRadius - 6;
    const deckWidth = 2.6;

    let bestCandidate:
      | (Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> & {
          score: number;
        })
      | null = null;

    const evaluateCandidate = (cx: number, cz: number, tx: number, tz: number): void => {
      const distFromOrigin = Math.hypot(cx - originX, cz - originZ);
      if (distFromOrigin > maxSearchDist || Math.hypot(cx, cz) > maxPlayable - 5) return;
      if (this.getCoastSignedDistance(cx, cz) < 12) return;
      if (this.getHeightAt(cx, cz) >= this.waterLevel - 0.15) return;

      for (const b of existingBridges) {
        if (Math.hypot(b.centerX - cx, b.centerZ - cz) < 20) return;
      }

      const nx = -tz;
      const nz = tx;

      const findBank = (sign: 1 | -1): { x: number; z: number; y: number } | null => {
        for (let d = 2.4; d <= 14.0; d += 0.5) {
          const bx = cx + nx * sign * d;
          const bz = cz + nz * sign * d;
          const h = this.getHeightAt(bx, bz);
          if (h >= this.waterLevel + 0.34 && this.getSlopeAt(bx, bz) < 0.28) {
            const ax = cx + nx * sign * (d + 1.5);
            const az = cz + nz * sign * (d + 1.5);
            const ay = this.getHeightAt(ax, az);
            if (
              Math.hypot(ax, az) <= maxPlayable &&
              ay >= this.waterLevel + 0.32 &&
              this.getSlopeAt(ax, az) < 0.3
            ) {
              return { x: ax, z: az, y: ay };
            }
          }
        }
        return null;
      };

      const bankA = findBank(1);
      const bankB = findBank(-1);
      if (!bankA || !bankB) return;

      const length = Math.hypot(bankB.x - bankA.x, bankB.z - bankA.z);
      if (length < 7.2 || length > 23.5) return;

      const distA = Math.hypot(bankA.x - originX, bankA.z - originZ);
      const distB = Math.hypot(bankB.x - originX, bankB.z - originZ);
      const start = distA <= distB ? bankA : bankB;
      const end = distA <= distB ? bankB : bankA;

      const centerX = (start.x + end.x) * 0.5;
      const centerZ = (start.z + end.z) * 0.5;
      const dirX = (end.x - start.x) / length;
      const dirZ = (end.z - start.z) / length;

      for (const ap of avoidPoints) {
        const rx = ap.x - centerX;
        const rz = ap.z - centerZ;
        const proj = rx * dirX + rz * dirZ;
        const perp = Math.abs(-rx * dirZ + rz * dirX);
        if (
          Math.abs(proj) < length * 0.5 + ap.radius + 1.4 &&
          perp < deckWidth * 0.5 + ap.radius + 1.0
        ) {
          return;
        }
      }

      const chordMidY = (start.y + end.y) * 0.5;
      const minClearCrown = this.waterLevel + 1.35;
      const archHeight = Math.max(
        Math.min(2.15, 0.9 + length * 0.055),
        minClearCrown - chordMidY,
      );
      const score = -distFromOrigin - length * 0.45 - Math.abs(start.y - end.y) * 3.0;
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          startX: start.x,
          startZ: start.z,
          startY: start.y,
          endX: end.x,
          endZ: end.z,
          endY: end.y,
          centerX,
          centerZ,
          archHeight,
          length,
          width: deckWidth,
          dirX,
          dirZ,
          yaw: Math.atan2(dirX, dirZ),
          score,
        };
      }
    };

    for (let attempt = 0; attempt < 26; attempt++) {
      const along = originAlong + rng.range(-52, 52);
      const across = this.getRiverCenterAcross(along);
      const cx = along * this.riverCos - across * this.riverSin;
      const cz = along * this.riverSin + across * this.riverCos;
      const eps = 0.8;
      const dAcross =
        (this.getRiverCenterAcross(along + eps) - this.getRiverCenterAcross(along - eps)) /
        (2 * eps);
      let tx = this.riverCos - dAcross * this.riverSin;
      let tz = this.riverSin + dAcross * this.riverCos;
      const tLen = Math.hypot(tx, tz) || 1;
      evaluateCandidate(cx, cz, tx / tLen, tz / tLen);
    }

    for (let attempt = 0; attempt < 18; attempt++) {
      const along = Math.max(8, originTribAlong + rng.range(-44, 44));
      const across = this.getTributaryCenterAcross(along);
      const cx = this.tribOriginX + along * this.tribCos - across * this.tribSin;
      const cz = this.tribOriginZ + along * this.tribSin + across * this.tribCos;
      const eps = 0.8;
      const dAcross =
        (this.getTributaryCenterAcross(along + eps) -
          this.getTributaryCenterAcross(Math.max(0, along - eps))) /
        (2 * eps);
      let tx = this.tribCos - dAcross * this.tribSin;
      let tz = this.tribSin + dAcross * this.tribCos;
      const tLen = Math.hypot(tx, tz) || 1;
      evaluateCandidate(cx, cz, tx / tLen, tz / tLen);
    }

    if (!bestCandidate) return null;
    const { score: _ignored, ...result } = bestCandidate as Omit<
      BridgeInstance,
      'id' | 'settlementId' | 'style' | 'progress' | 'completed'
    > & { score: number };
    return result;
  }

  /**
   * Finds well-spaced settlement clearings. For a single founding village (default), selects a
   * welcoming scenic homeland inland so emigrants can radiate far outward into all 6 environments.
   */
  findSettlementSites(count: number, rng: SeededRandom): Vec2[] {
    const chosen: Vec2[] = [];
    const maxRadius =
      count === 1
        ? Math.min(this.playableRadius - 24, this.halfSize * 0.44)
        : this.playableRadius - 20;

    if (count > 1) {
      const targetOrder: VillageAdaptationId[] = [
        'forest_canopy',
        'coastal_harbor',
        'desert_oasis',
        'prairie_pastoral',
        'mountain_stone',
        'riverside_stilts',
      ];
      const minSpacing = Math.max(38, this.size * 0.21);
      for (const targetAdaptation of targetOrder) {
        if (chosen.length >= count) break;
        const found = this.findSiteForAdaptation(
          targetAdaptation,
          chosen,
          minSpacing,
          maxRadius,
          rng,
          950,
        );
        if (found) {
          chosen.push(found);
        }
      }
    }

    const passes = [
      {
        attempts: 1100,
        minSpacing: Math.max(36, this.size * 0.21),
        minH: 0.65,
        maxH: 10.5,
        maxSlope: 0.16,
        minWaterDist: 5.0,
        radiusLimit: maxRadius,
      },
      {
        attempts: 900,
        minSpacing: Math.max(28, this.size * 0.16),
        minH: 0.45,
        maxH: 13.5,
        maxSlope: 0.21,
        minWaterDist: 3.0,
        radiusLimit: this.playableRadius - 18,
      },
    ];

    for (const pass of passes) {
      for (let attempt = 0; attempt < pass.attempts && chosen.length < count; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * pass.radiusLimit;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (this.getCoastSignedDistance(x, z) < (count === 1 ? 18 : 6)) continue;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        if (h < this.waterLevel + pass.minH || h > pass.maxH || slope > pass.maxSlope) continue;
        if (this.getWaterDistance(x, z) < pass.minWaterDist) continue;

        let tooClose = false;
        for (const site of chosen) {
          if (Math.hypot(site.x - x, site.z - z) < pass.minSpacing) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          chosen.push({ x, z });
        }
      }
      if (chosen.length >= count) break;
    }

    return chosen;
  }

  private findSiteForAdaptation(
    target: VillageAdaptationId,
    existing: readonly Vec2[],
    minSpacing: number,
    maxRadius: number,
    rng: SeededRandom,
    attempts: number,
    origin?: Vec2,
  ): Vec2 | null {
    const maxSlope = target === 'mountain_stone' ? 0.22 : 0.16;
    const minWaterDist =
      target === 'riverside_stilts' || target === 'coastal_harbor' ? 3.2 : 5.2;
    const minH =
      target === 'riverside_stilts' || target === 'coastal_harbor' ? 0.46 : 0.65;
    const maxH = target === 'mountain_stone' ? 14.5 : 8.4;

    let best: { x: number; z: number; score: number } | null = null;
    for (let i = 0; i < attempts; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * maxRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      const slope = this.getSlopeAt(x, z);
      const waterDist = this.getWaterDistance(x, z);
      if (h < this.waterLevel + minH || h > maxH || slope > maxSlope || waterDist < minWaterDist) {
        continue;
      }

      const adaptation = this.getSiteAdaptation(x, z);
      if (adaptation !== target) continue;

      let tooClose = false;
      for (const site of existing) {
        if (Math.hypot(site.x - x, site.z - z) < minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      let score = -slope * 18;
      if (target === 'coastal_harbor') {
        const cd = this.getCoastSignedDistance(x, z);
        score += Math.max(0, 18 - Math.abs(cd - 8.5)) * 0.7;
      } else if (target === 'riverside_stilts') {
        score += Math.max(0, 14 - waterDist) * 0.65;
      } else if (target === 'mountain_stone') {
        score += Math.min(12.0, h) * 0.78;
      } else if (target === 'desert_oasis') {
        score += this.getAridityAt(x, z) * 6.5;
      } else if (target === 'prairie_pastoral') {
        score += this.getPrairieWeightAt(x, z) * 5.5 + this.getFertilityAt(x, z) * 2.5;
      }

      // Encourage emigrating pioneers to wander far across the realm into distant lands!
      if (origin) {
        const trekDist = Math.hypot(x - origin.x, z - origin.z);
        score += Math.min(160, trekDist) * 0.055;
      }

      if (!best || score > best.score) {
        best = { x, z, score };
        if (i > 260 && score > 3.5) break;
      }
    }

    return best ? { x: best.x, z: best.z } : null;
  }

  /**
   * Finds a fresh dry, buildable clearing for far-wandering emigrating pioneers, actively seeking
   * unrepresented biomes and distant frontiers across the landmass (seashore, desert, prairie,
   * mountains, riverside, deep forest).
   */
  findNewSettlementSite(
    existingCenters: readonly Vec2[],
    rng: SeededRandom,
    existingAdaptations?: readonly VillageAdaptationId[],
    origin?: Vec2,
  ): Vec2 | null {
    const maxRadius = this.playableRadius - 18;
    const minSpacing = Math.max(40, this.size * 0.2);

    if (existingAdaptations) {
      const present = new Set(existingAdaptations);
      const missing = ALL_VILLAGE_ADAPTATIONS.filter((a) => !present.has(a));
      if (missing.length > 0) {
        // Shuffle missing adaptations so pioneers explore diverse distant environments
        const candidates = [...missing];
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const tmp = candidates[i];
          candidates[i] = candidates[j];
          candidates[j] = tmp;
        }
        for (const desired of candidates) {
          const specialized = this.findSiteForAdaptation(
            desired,
            existingCenters,
            minSpacing,
            maxRadius,
            rng,
            520,
            origin,
          );
          if (specialized) return specialized;
        }
      }
    }

    const passes = [
      {
        attempts: 520,
        minSpacing,
        minH: 0.55,
        maxH: 13.5,
        maxSlope: 0.18,
        minWaterDist: 4.5,
      },
      {
        attempts: 400,
        minSpacing: Math.max(28, this.size * 0.15),
        minH: 0.42,
        maxH: 14.5,
        maxSlope: 0.22,
        minWaterDist: 3.0,
      },
    ];

    let bestFallback: { x: number; z: number; score: number } | null = null;
    for (const pass of passes) {
      for (let attempt = 0; attempt < pass.attempts; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (this.getCoastSignedDistance(x, z) < 5.0) continue;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        if (h < this.waterLevel + pass.minH || h > pass.maxH || slope > pass.maxSlope) continue;
        if (this.getWaterDistance(x, z) < pass.minWaterDist) continue;

        let tooClose = false;
        for (const site of existingCenters) {
          if (Math.hypot(site.x - x, site.z - z) < pass.minSpacing) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const trekDist = origin ? Math.hypot(x - origin.x, z - origin.z) : 80;
        const score = Math.min(180, trekDist) * 0.08 - slope * 15;
        if (!bestFallback || score > bestFallback.score) {
          bestFallback = { x, z, score };
        }
      }
      if (bestFallback) return { x: bestFallback.x, z: bestFallback.z };
    }
    return null;
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
    const areaScale = Math.pow(this.size / 160, 1.45);
    const types: { type: ResourceType; count: number; max: number; regen: number }[] = [
      { type: 'timber', count: Math.round(32 * areaScale), max: 76, regen: 0.6 },
      { type: 'berries', count: Math.round(25 * areaScale), max: 58, regen: 0.54 },
      { type: 'acorns', count: Math.round(24 * areaScale), max: 58, regen: 0.5 },
      { type: 'stone', count: Math.round(28 * areaScale), max: 74, regen: 0.42 },
      { type: 'herbs', count: Math.round(24 * areaScale), max: 50, regen: 0.48 },
    ];

    let idx = 0;
    const maxRadius = this.playableRadius - 6;
    for (const spec of types) {
      let placed = 0;
      const maxTries = spec.count * 20;
      for (let tries = 0; tries < maxTries && placed < spec.count; tries++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const h = this.getHeightAt(x, z);
        if (h < this.waterLevel + 0.35 || this.getSlopeAt(x, z) > 0.33) continue;
        const biome = this.getBiomeAt(x, z);
        if (biome === 'water') continue;

        if (
          spec.type === 'stone' &&
          biome !== 'rocky_ridge' &&
          biome !== 'alpine_crag' &&
          biome !== 'desert' &&
          rng.chance(0.68)
        ) {
          continue;
        }
        if (
          spec.type === 'herbs' &&
          biome !== 'moss_hollow' &&
          biome !== 'riverbank' &&
          biome !== 'seashore' &&
          biome !== 'desert' &&
          rng.chance(0.6)
        ) {
          continue;
        }
        if (
          spec.type === 'timber' &&
          biome !== 'deep_woods' &&
          biome !== 'rocky_ridge' &&
          rng.chance(0.62)
        ) {
          continue;
        }
        if (
          spec.type === 'berries' &&
          biome !== 'prairie' &&
          biome !== 'meadow' &&
          biome !== 'moss_hollow' &&
          biome !== 'seashore' &&
          rng.chance(0.45)
        ) {
          continue;
        }

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
    const treeRadius = this.halfSize + 18;
    const propRadius = this.halfSize + 8;

    // Trees with strong biome ecology: dense old-growth deep forest, mountain pines,
    // silver birch riverbanks, wide open prairie, sparse coastal pines, and arid desert!
    let attempts = 0;
    while (this.trees.length < config.treeCount && attempts < config.treeCount * 22) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * treeRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + 0.45 || h > 15.2) continue;
      if (this.getSlopeAt(x, z) > 0.28) continue;

      const biome = this.getBiomeAt(x, z);
      if (biome === 'water') continue;
      if (biome === 'desert' && rng.chance(0.96)) continue;
      if (biome === 'seashore' && rng.chance(0.86)) continue;
      if (biome === 'prairie' && rng.chance(0.88)) continue;
      if (biome === 'meadow' && rng.chance(0.74)) continue;
      if (biome === 'alpine_crag' && rng.chance(0.74)) continue;

      let crowded = false;
      for (const existing of this.trees) {
        const dx = existing.x - x;
        const dz = existing.z - z;
        if (dx * dx + dz * dz < 12.25) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const kind: TreeSpot['kind'] =
        biome === 'rocky_ridge' || biome === 'alpine_crag' || biome === 'seashore'
          ? rng.chance(0.85)
            ? 'pine'
            : 'oak'
          : biome === 'riverbank' || biome === 'moss_hollow'
            ? rng.chance(0.55)
              ? 'birch'
              : 'oak'
            : biome === 'prairie' || biome === 'meadow'
              ? rng.chance(0.58)
                ? 'birch'
                : 'oak'
              : biome === 'desert'
                ? 'pine'
                : rng.pick(['oak', 'oak', 'oak', 'pine', 'birch']);

      const scale =
        biome === 'alpine_crag' || biome === 'desert'
          ? rng.range(0.6, 0.98)
          : biome === 'seashore'
            ? rng.range(0.7, 1.12)
            : rng.range(0.82, 1.54);

      this.trees.push({
        x,
        z,
        y: h,
        scale,
        rotation: rng.range(0, Math.PI * 2),
        kind,
      });
    }

    // Ferns (0), berry bushes (1), mushrooms/toadstools (2) distributed by biome ecology
    attempts = 0;
    while (
      this.undergrowth.length < config.undergrowthCount &&
      attempts < config.undergrowthCount * 12
    ) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + 0.25 || h > 13.5) continue;

      const biome = this.getBiomeAt(x, z);
      if (biome === 'water') continue;
      if (biome === 'desert' && rng.chance(0.88)) continue;
      if (biome === 'seashore' && rng.chance(0.82)) continue;
      if (biome === 'alpine_crag' && rng.chance(0.78)) continue;

      let variant: number;
      if (biome === 'moss_hollow') {
        variant = rng.chance(0.54) ? 2 : 0;
      } else if (biome === 'prairie' || biome === 'meadow' || biome === 'desert') {
        variant = rng.chance(0.72) ? 1 : 0;
      } else if (biome === 'rocky_ridge' || biome === 'alpine_crag' || biome === 'seashore') {
        variant = rng.chance(0.65) ? 1 : 0;
      } else {
        variant = rng.int(0, 2);
      }

      this.undergrowth.push({
        x,
        z,
        y: h,
        scale: rng.range(0.55, 1.38),
        rotation: rng.range(0, Math.PI * 2),
        variant,
      });
    }

    // Granite crag boulders, desert sandstone mesas/rocks, coastal sea-stacks, & mossy forest stones
    attempts = 0;
    while (this.rocks.length < config.rockCount && attempts < config.rockCount * 14) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      const biome = this.getBiomeAt(x, z);
      if (h < this.waterLevel - 0.1 || biome === 'water') continue;
      if (
        biome !== 'rocky_ridge' &&
        biome !== 'alpine_crag' &&
        biome !== 'desert' &&
        biome !== 'seashore' &&
        biome !== 'riverbank' &&
        rng.chance(0.8)
      ) {
        continue;
      }
      const scale =
        biome === 'alpine_crag' || biome === 'rocky_ridge' || biome === 'desert'
          ? rng.range(0.78, 2.45)
          : rng.range(0.55, 1.85);

      this.rocks.push({
        x,
        z,
        y: h,
        scale,
        rotation: rng.range(0, Math.PI * 2),
        variant: rng.int(0, 2),
      });
    }
  }
}
