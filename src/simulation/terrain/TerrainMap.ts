import type { WorldConfig } from '@core/Config';
import { SeededRandom } from '@core/SeededRandom';
import type { BiomeType, ResourceType, Vec2, Vec3 } from '@core/Types';
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

/** Polynomial smooth minimum so rivers and lakes merge with organic coves. */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
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
  readonly ponds: readonly PondFeature[];
  readonly riverAngle: number;
  readonly resourceNodes: ResourceNode[] = [];
  readonly trees: TreeSpot[] = [];
  readonly undergrowth: PropSpot[] = [];
  readonly rocks: PropSpot[] = [];

  private readonly elevationNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly fertilityNoise: Noise2D;

  // Seeded river geometry (arbitrary heading, lateral offset, width, and dual-harmonic meander)
  private readonly riverCos: number;
  private readonly riverSin: number;
  private readonly riverOffset: number;
  private readonly riverHalfWidth: number;
  private readonly riverCurvePhase: number;
  private readonly riverCurveFreq: number;
  private readonly riverCurveAmp1: number;
  private readonly riverCurveFreq2: number;
  private readonly riverCurveAmp2: number;

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
    this.playableRadius = this.halfSize - 5;
    this.waterLevel = config.waterLevel;
    this.walkGridHalf = Math.ceil(this.playableRadius * 2) + 2;
    this.walkGridSize = this.walkGridHalf * 2;
    this.walkCache = new Uint8Array(this.walkGridSize * this.walkGridSize);

    const rng = new SeededRandom(config.seed ^ 0x4f524553);
    this.elevationNoise = new Noise2D(rng.int(1, 1_000_000));
    this.moistureNoise = new Noise2D(rng.int(1, 1_000_000));
    this.fertilityNoise = new Noise2D(rng.int(1, 1_000_000));

    // Procedural river axis, meander harmonics, and channel width
    this.riverAngle = rng.range(0, Math.PI * 2);
    this.riverCos = Math.cos(this.riverAngle);
    this.riverSin = Math.sin(this.riverAngle);
    this.riverOffset = rng.range(-18, 18);
    this.riverHalfWidth = rng.range(3.9, 6.2);
    this.riverCurvePhase = rng.range(0, Math.PI * 2);
    this.riverCurveFreq = rng.range(0.02, 0.042);
    this.riverCurveAmp1 = rng.range(10, 22);
    this.riverCurveFreq2 = rng.range(0.011, 0.021);
    this.riverCurveAmp2 = rng.range(4.5, 11);

    // Procedural elevation orientation, domain warp, relief scale, and gentle valley tilt
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
    this.hillScale = rng.range(0.0135, 0.0215);
    this.hillAmplitude = rng.range(4.8, 7.2);
    this.ridgeScale = rng.range(0.0085, 0.0135);
    this.ridgeAmplitude = rng.range(2.6, 4.4);
    this.warpStrength = rng.range(4.5, 11.5);
    this.valleyBaseHeight = rng.range(1.4, 2.0);
    const tiltAngle = rng.range(0, Math.PI * 2);
    this.tiltCos = Math.cos(tiltAngle);
    this.tiltSin = Math.sin(tiltAngle);
    this.tiltStrength = rng.range(0.25, 1.15);

    this.ponds = this.generatePonds(rng.fork());
    this.generateResourceNodes(rng.fork());
    this.generateFloraAndRocks(config, rng.fork());
  }

  private generatePonds(rng: SeededRandom): PondFeature[] {
    const ponds: PondFeature[] = [];

    // Primary glade lake: either widened along a bend of the river or nestled in a separate hollow
    let px: number;
    let pz: number;
    if (rng.chance(0.55)) {
      const along = rng.range(-28, 28);
      const across = this.getRiverCenterAcross(along) + rng.range(-5.5, 5.5);
      px = along * this.riverCos - across * this.riverSin;
      pz = along * this.riverSin + across * this.riverCos;
    } else {
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(10, 34);
      px = Math.cos(angle) * dist;
      pz = Math.sin(angle) * dist;
    }

    const pAngle = rng.range(0, Math.PI * 2);
    const pScaleX = rng.range(0.82, 1.24);
    ponds.push({
      x: px,
      z: pz,
      radius: rng.range(8.0, 13.8),
      cos: Math.cos(pAngle),
      sin: Math.sin(pAngle),
      scaleX: pScaleX,
      scaleZ: 1 / pScaleX,
    });

    // Optional second smaller woodland tarn for extra layout variety
    if (rng.chance(0.5)) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const dist = rng.range(20, 44);
        const sx = Math.cos(angle) * dist;
        const sz = Math.sin(angle) * dist;
        if (Math.hypot(sx - px, sz - pz) < 30) continue;

        const sAngle = rng.range(0, Math.PI * 2);
        const sScaleX = rng.range(0.85, 1.18);
        ponds.push({
          x: sx,
          z: sz,
          radius: rng.range(5.2, 8.6),
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

  /** Centerline perpendicular offset of the meandering river at a given distance along its axis. */
  private getRiverCenterAcross(along: number): number {
    return (
      this.riverOffset +
      Math.sin(along * this.riverCurveFreq + this.riverCurvePhase) * this.riverCurveAmp1 +
      Math.cos(along * this.riverCurveFreq2 - this.riverCurvePhase * 0.6) * this.riverCurveAmp2
    );
  }

  /** Signed elliptical distance to a specific pond shoreline (negative inside water). */
  private getPondSignedDistance(x: number, z: number, pond: PondFeature): number {
    const dx = x - pond.x;
    const dz = z - pond.z;
    const lx = (dx * pond.cos + dz * pond.sin) / pond.scaleX;
    const lz = (-dx * pond.sin + dz * pond.cos) / pond.scaleZ;
    return Math.hypot(lx, lz) - pond.radius;
  }

  /** Signed distance from the winding river and procedural woodland pond(s). */
  getWaterDistance(x: number, z: number): number {
    const along = x * this.riverCos + z * this.riverSin;
    const across = -x * this.riverSin + z * this.riverCos;
    const riverAcross = this.getRiverCenterAcross(along);
    const riverDist = Math.abs(across - riverAcross) - this.riverHalfWidth;

    let waterDist = riverDist;
    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      waterDist = smoothMin(waterDist, pondDist, 3.2);
    }
    return waterDist;
  }

  /**
   * Downstream surface flow vector (world XZ) for realistic flowing water shaders.
   * Follows the seeded river orientation and meander, and calms smoothly inside ponds.
   */
  getWaterFlowAt(x: number, z: number): Vec2 {
    const along = x * this.riverCos + z * this.riverSin;
    const eps = 0.6;
    const dAcross =
      (this.getRiverCenterAcross(along + eps) - this.getRiverCenterAcross(along - eps)) /
      (2 * eps);

    // Rotate tangent (1, dAcross) from river frame back into world XZ coordinates
    let fx = this.riverCos - dAcross * this.riverSin;
    let fz = this.riverSin + dAcross * this.riverCos;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;

    // Calm the flow gracefully inside every procedural pond/lake
    let pondCalm = 1.0;
    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      const calm = smoothstep(-3.0, 6.0, pondDist);
      if (calm < pondCalm) pondCalm = calm;
    }
    const speed = 0.22 + 0.78 * pondCalm;
    return { x: fx * speed, z: fz * speed };
  }

  /** Continuous world height in meters at any (x, z) coordinate out to infinity. */
  getHeightAt(x: number, z: number): number {
    const radialDist = Math.hypot(x, z) / this.halfSize;

    // Smoothly transition from gentle central valley into endless rolling woodland hills & distant ridges
    const outerBlend = radialDist > 0.68 ? smoothstep(0.68, 1.5, radialDist) : 0;
    const farBlend = radialDist > 1.3 ? smoothstep(1.3, 2.8, radialDist) : 0;

    // Seeded coordinate rotation + gentle organic domain warp for distinct hill/valley shapes per seed
    const rx = x * this.elevCos - z * this.elevSin;
    const rz = x * this.elevSin + z * this.elevCos;
    const warpX =
      this.elevationNoise.sample(rx * 0.008 + this.elevOffsetX, rz * 0.008 + this.elevOffsetZ) *
      this.warpStrength;
    const warpZ =
      this.elevationNoise.sample(
        rx * 0.008 - this.elevOffsetZ + 17.3,
        rz * 0.008 + this.elevOffsetX - 11.7,
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
            rx * 0.0062 + this.elevOffsetX * 0.35 + 4.3,
            rz * 0.0062 + this.elevOffsetZ * 0.35 - 2.9,
            3,
            2.0,
            0.52,
          ) * 11.2
        : 0;
    const ridgeWeight = Math.min(1.42, Math.max(0, radialDist - 0.16));
    const ridge =
      ridgeWeight > 0
        ? this.elevationNoise.ridged(
            wx * this.ridgeScale + this.ridgeOffsetX,
            wz * this.ridgeScale + this.ridgeOffsetZ,
            2,
          ) *
          this.ridgeAmplitude *
          ridgeWeight
        : 0;
    const micro =
      this.elevationNoise.sample(rx * 0.09 + this.elevOffsetX, rz * 0.09 + this.elevOffsetZ) * 0.35;
    const valleyTilt =
      Math.tanh((x * this.tiltCos + z * this.tiltSin) / this.halfSize) * this.tiltStrength;

    let h =
      this.valleyBaseHeight +
      valleyTilt +
      hills * (1.0 - farBlend * 0.28) +
      broadHills * outerBlend * 0.65 +
      ridge +
      outerBlend * 4.8 +
      micro * (1.0 - farBlend * 0.65);

    // Carve the meandering woodland stream and procedural glade pond(s) continuously into the distance
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
    const noiseVal =
      (this.moistureNoise.fbm(
        x * 0.025 + this.moistOffsetX,
        z * 0.025 + this.moistOffsetZ,
        3,
      ) +
        1) *
      0.5;
    return Math.max(0, Math.min(1, noiseVal * 0.65 + riverBoost));
  }

  getFertilityAt(x: number, z: number): number {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel) return 0;
    const moisture = this.getMoistureAt(x, z);
    const n =
      (this.fertilityNoise.fbm(
        x * 0.03 + this.fertOffsetX,
        z * 0.03 + this.fertOffsetZ,
        3,
      ) +
        1) *
      0.5;
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
        if (this.getBridgeDeckY(cx, cz) !== null) {
          val = 3;
        } else {
          const h = this.getHeightAt(cx, cz);
          if (h < this.waterLevel - 0.65 || this.getSlopeAt(cx, cz) >= 0.34) {
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
    const h = this.getHeightAt(x, z);
    if (!amphibious && h < this.waterLevel + 0.12) return false;
    if (amphibious && h < this.waterLevel - 0.65) return false;
    return this.getSlopeAt(x, z) < 0.34;
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
   * Probes the procedural river near (originX, originZ) for a sturdy, well-spaced bridge crossing
   * spanning from dry home bank to dry opposite bank without clipping buildings or wide pond basins.
   */
  findRiverCrossingNear(
    originX: number,
    originZ: number,
    rng: SeededRandom,
    existingBridges: readonly BridgeInstance[],
    avoidPoints: readonly { x: number; z: number; radius: number }[],
    maxSearchDist = 56,
  ): Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> | null {
    const originAlong = originX * this.riverCos + originZ * this.riverSin;
    const maxPlayable = this.playableRadius - 6;
    const deckWidth = 2.6;

    let bestCandidate:
      | (Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> & {
          score: number;
        })
      | null = null;

    for (let attempt = 0; attempt < 26; attempt++) {
      const along = originAlong + rng.range(-38, 38);
      const across = this.getRiverCenterAcross(along);
      const cx = along * this.riverCos - across * this.riverSin;
      const cz = along * this.riverSin + across * this.riverCos;

      const distFromOrigin = Math.hypot(cx - originX, cz - originZ);
      if (distFromOrigin > maxSearchDist || Math.hypot(cx, cz) > maxPlayable - 5) continue;
      if (this.getHeightAt(cx, cz) >= this.waterLevel - 0.15) continue;

      let tooCloseToBridge = false;
      for (const b of existingBridges) {
        if (Math.hypot(b.centerX - cx, b.centerZ - cz) < 18) {
          tooCloseToBridge = true;
          break;
        }
      }
      if (tooCloseToBridge) continue;

      const eps = 0.8;
      const dAcross =
        (this.getRiverCenterAcross(along + eps) - this.getRiverCenterAcross(along - eps)) /
        (2 * eps);
      let tx = this.riverCos - dAcross * this.riverSin;
      let tz = this.riverSin + dAcross * this.riverCos;
      const tLen = Math.hypot(tx, tz) || 1;
      tx /= tLen;
      tz /= tLen;
      const nx = -tz;
      const nz = tx;

      const findBank = (sign: 1 | -1): { x: number; z: number; y: number } | null => {
        for (let d = 2.5; d <= 13.5; d += 0.5) {
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
      if (!bankA || !bankB) continue;

      const length = Math.hypot(bankB.x - bankA.x, bankB.z - bankA.z);
      if (length < 7.5 || length > 23.0) continue;

      const distA = Math.hypot(bankA.x - originX, bankA.z - originZ);
      const distB = Math.hypot(bankB.x - originX, bankB.z - originZ);
      const start = distA <= distB ? bankA : bankB;
      const end = distA <= distB ? bankB : bankA;

      const centerX = (start.x + end.x) * 0.5;
      const centerZ = (start.z + end.z) * 0.5;
      const dirX = (end.x - start.x) / length;
      const dirZ = (end.z - start.z) / length;

      let blocked = false;
      for (const ap of avoidPoints) {
        const rx = ap.x - centerX;
        const rz = ap.z - centerZ;
        const proj = rx * dirX + rz * dirZ;
        const perp = Math.abs(-rx * dirZ + rz * dirX);
        if (
          Math.abs(proj) < length * 0.5 + ap.radius + 1.4 &&
          perp < deckWidth * 0.5 + ap.radius + 1.0
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

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
    }

    if (!bestCandidate) return null;
    const { score: _ignored, ...result } = bestCandidate;
    return result;
  }

  /** Finds well-spaced, gently sloped clearings suitable for founding growing cities. */
  findSettlementSites(count: number, rng: SeededRandom): Vec2[] {
    const chosen: Vec2[] = [];
    const maxRadius = this.playableRadius - 18;
    const passes = [
      {
        attempts: 1100,
        minSpacing: this.size * 0.24,
        minH: 0.7,
        maxH: 5.4,
        maxSlope: 0.13,
        minWaterDist: 6.5,
      },
      {
        attempts: 900,
        minSpacing: this.size * 0.18,
        minH: 0.55,
        maxH: 6.4,
        maxSlope: 0.19,
        minWaterDist: 3.5,
      },
    ];

    for (const pass of passes) {
      for (let attempt = 0; attempt < pass.attempts && chosen.length < count; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
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
