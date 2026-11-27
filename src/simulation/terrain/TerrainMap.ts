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

export interface RiverBranchFeature {
  readonly id: string;
  /** Null when this tributary joins the main river trunk directly; otherwise the parent tributary id. */
  readonly parentId: string | null;
  /** Dendritic stream order: 2 = primary tributary (main bough), 1 = secondary stream (upland twig). */
  readonly order: 1 | 2;
  readonly originX: number;
  readonly originZ: number;
  readonly endX: number;
  readonly endZ: number;
  /** Upstream heading (radians) from the confluence toward the headwaters. */
  readonly angle: number;
  readonly length: number;
  readonly startHalfWidth: number;
  readonly endHalfWidth: number;
}

interface RiverPolylinePoint {
  readonly x: number;
  readonly z: number;
  readonly s: number;
  readonly halfW: number;
}

interface RiverSegment {
  readonly channelId: number;
  readonly order: 1 | 2 | 3;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly dx: number;
  readonly dz: number;
  readonly invLenSq: number;
  readonly flowX: number;
  readonly flowZ: number;
  readonly halfW0: number;
  readonly halfW1: number;
}

interface RiverBranch extends RiverBranchFeature {
  readonly points: readonly RiverPolylinePoint[];
}

interface AlpinePeakFeature {
  readonly along: number;
  readonly depth: number;
  readonly radius: number;
  readonly heightScale: number;
}

interface BiomeLobe {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly strength: number;
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

/** Signed shortest angular difference (angle - reference) wrapped to [-PI, PI]. */
function wrapAngleDiff(angle: number, reference: number): number {
  let d = angle - reference;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Headless continuous continental terrain heightfield framed by two natural world bounds:
 * - Back (-Z): a continuous soaring, craggy snow-capped alpine cordillera with climbable
 *   foothill edges & slopes for highland settlements, rising into an impassable mountain wall.
 * - Front (+Z): a sweeping sandy seashore & coves for coastal harbors, deepening into an
 *   impassable open ocean sea.
 * - Heartland (in between): strongly domain-warped amorphous regions of verdant old-growth
 *   forests, flat treeless grassy prairies, and arid sandy deserts, drained by a dendritic
 *   tree-shaped watershed (upland streams -> primary tributaries -> widening main trunk -> sea)
 *   and dotted with lakes.
 */
export class TerrainMap {
  readonly size: number;
  readonly halfSize: number;
  readonly playableRadius: number;
  readonly waterLevel: number;
  readonly ponds: readonly PondFeature[];
  readonly riverBranches: readonly RiverBranchFeature[];
  readonly coastAngle: number;
  readonly riverAngle: number;
  readonly tributaryAngle: number;
  readonly resourceNodes: ResourceNode[] = [];
  private readonly resourceNodeById = new Map<string, ResourceNode>();
  readonly trees: TreeSpot[] = [];
  readonly undergrowth: PropSpot[] = [];
  readonly rocks: PropSpot[] = [];

  private readonly elevationNoise: Noise2D;
  private readonly moistureNoise: Noise2D;
  private readonly fertilityNoise: Noise2D;
  private readonly climateNoise: Noise2D;

  // Front (+Z) seashore & open ocean coastline serving as the natural front world bound
  private readonly coastCos: number;
  private readonly coastSin: number;
  private readonly coastBaseDist: number;
  private readonly coastPhase: number;

  // Back (-Z) craggy alpine cordillera serving as the natural back world bound
  private readonly alpineBaseDist: number;
  private readonly alpinePhase: number;
  private readonly mountainPeakBoost: number;
  private readonly alpinePeaks: readonly AlpinePeakFeature[];

  // Primary main river flowing from back alpine foothills down to the front sea
  private readonly riverCos: number;
  private readonly riverSin: number;
  private readonly riverOffset: number;
  private readonly riverHalfWidth: number;
  private readonly trunkPoints: readonly RiverPolylinePoint[];

  // Dendritic watershed branches (Order-2 primary tributaries + Order-1 upland streams) & O(1) spatial grid
  private readonly branches: readonly RiverBranch[];
  private readonly riverSegments: readonly RiverSegment[];
  private readonly riverGridHalf: number;
  private readonly riverGridCellSize: number;
  private readonly riverGridDim: number;
  private readonly riverGridCells: (Int16Array | null)[];

  // Domain-warped amorphous interior biome attractors (forests, prairies, deserts) + fen
  private readonly desertLobes: readonly BiomeLobe[];
  private readonly prairieLobes: readonly BiomeLobe[];
  private readonly forestLobes: readonly BiomeLobe[];
  private readonly duneCos: number;
  private readonly duneSin: number;

  private readonly fenCenterX: number;
  private readonly fenCenterZ: number;
  private readonly fenRadius: number;

  // Seeded topographic character (rotated/warped relief, ridge profile, gentle continental slope)
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
  private tmpAridity = 0;
  private tmpPrairie = 0;

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
    const freqScale = 1 / Math.sqrt(Math.max(1, worldScale * 0.45));

    // 1. Front (+Z) Seashore & Open Ocean Coastline (natural front bound of the world)
    this.coastAngle = Math.PI * 0.5 + rng.range(-0.15, 0.15);
    this.coastCos = Math.cos(this.coastAngle);
    this.coastSin = Math.sin(this.coastAngle);
    this.coastBaseDist = this.halfSize * rng.range(0.45, 0.53);
    this.coastPhase = rng.range(0, Math.PI * 2);

    // 2. Back (-Z) Continuous Craggy Alpine Mountain Cordillera (natural back bound of the world)
    this.alpineBaseDist = this.halfSize * rng.range(0.42, 0.48);
    this.alpinePhase = rng.range(0, Math.PI * 2);
    this.mountainPeakBoost = rng.range(50.0, 64.0) * Math.min(1.48, 0.72 + worldScale * 0.108);

    // 7 jagged hero summit massifs spanning the entire back range from left flank to right flank
    const peaks: AlpinePeakFeature[] = [];
    const peakCount = 7;
    const rangeSpan = this.halfSize * 2.35;
    for (let i = 0; i < peakCount; i++) {
      const u = (i + 0.5) / peakCount - 0.5;
      const along = u * rangeSpan + rng.range(-this.halfSize * 0.12, this.halfSize * 0.12);
      const depth = rng.range(68, 152);
      const radius = this.halfSize * rng.range(0.24, 0.36);
      const centralBoost = 1.0 - Math.abs(u) * 0.18;
      const heightScale = rng.range(0.76, 1.18) * centralBoost;
      peaks.push({ along, depth, radius, heightScale });
    }
    this.alpinePeaks = peaks;

    // 3. Procedural elevation orientation, noise offsets, relief scale, and downhill sea tilt
    //    (initialized before dendritic rivers so coastline & alpine queries are exact during branching)
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
    this.hillScale = rng.range(0.0052, 0.0084);
    this.hillAmplitude = rng.range(5.4, 7.8);
    this.ridgeScale = rng.range(0.0046, 0.0076);
    this.ridgeAmplitude = rng.range(4.4, 7.0);
    this.warpStrength = rng.range(12.0, 22.0);
    this.valleyBaseHeight = rng.range(1.75, 2.35);
    // Gentle continental slope downhill from back alpine foothills toward front sea
    this.tiltCos = -this.coastCos;
    this.tiltSin = -this.coastSin;
    this.tiltStrength = rng.range(1.4, 2.3);

    // 4. Dendritic Tree-Shaped River Watershed:
    //    Deeply meandering, curvature-integrated central main trunk widening downstream into
    //    the front sea, fed by meandering Order-2 primary tributaries (boughs) and Order-1
    //    upland streams (twigs), indexed in an O(1) spatial grid for fast queries.
    this.riverAngle = this.coastAngle + rng.range(-0.22, 0.22);
    this.riverCos = Math.cos(this.riverAngle);
    this.riverSin = Math.sin(this.riverAngle);
    const firstSide: 1 | -1 = rng.chance(0.5) ? 1 : -1;
    this.riverOffset = rng.range(-32, 32) * Math.min(1.3, Math.sqrt(worldScale) * 0.5);
    this.riverHalfWidth = rng.range(5.4, 6.7) * Math.min(1.24, 0.8 + worldScale * 0.062);

    this.trunkPoints = this.buildMeanderingTrunkPolyline(rng, freqScale);
    this.branches = this.buildDendriticRiverBranches(rng, worldScale, freqScale, firstSide);
    this.riverBranches = this.branches;
    this.tributaryAngle = this.branches[0]?.angle ?? this.riverAngle + Math.PI + firstSide * 0.65;

    this.riverGridHalf = Math.ceil(this.halfSize * 1.55);
    this.riverGridCellSize = 32;
    this.riverGridDim = Math.ceil((this.riverGridHalf * 2) / this.riverGridCellSize);
    const { segments, cells } = this.buildRiverSpatialIndex();
    this.riverSegments = segments;
    this.riverGridCells = cells;

    // 5. Amorphous Interior Regions (Forests, Prairies, Deserts) woven between Mountains and Sea
    //    Evaluated in heavily domain-warped coordinates so every biome forms irregular organic patches.
    //    Deserts are placed in the driest inland rain-shadow basins farthest from the sea and all rivers.
    const bandPoint = (alongFrac: number, depthFrac: number): Vec2 => {
      // alongFrac in [-0.75, 0.75] runs left-to-right across the continent;
      // depthFrac in [-0.36, 0.36] runs from back foothills (-0.36) to front coast (+0.36)
      const along = alongFrac * this.halfSize;
      const forward = depthFrac * this.halfSize;
      return {
        x: forward * this.coastCos - along * this.coastSin,
        z: forward * this.coastSin + along * this.coastCos,
      };
    };

    // Search the walkable interior for the driest basins farthest from BOTH the sea and every river/stream
    const minDesertCoast = Math.min(130, this.halfSize * 0.28);
    const dryCandidates: { x: number; z: number; alongFrac: number; riverDist: number; coastDist: number; score: number }[] = [];
    for (let af = -0.74; af <= 0.741; af += 0.07) {
      for (let df = -0.34; df <= 0.161; df += 0.06) {
        const pt = bandPoint(af, df);
        if (!this.isWithinPlayableArea(pt.x, pt.z, Math.min(34, this.halfSize * 0.12))) continue;
        const coastDist = this.getCoastSignedDistance(pt.x, pt.z);
        if (coastDist < minDesertCoast) continue;
        const alpineDepth = this.getAlpineDepthAt(pt.x, pt.z);
        if (alpineDepth > 8) continue;
        const riverDist = this.getExactRiverDistance(pt.x, pt.z);
        // Score maximizes simultaneous distance from ALL rivers/tributaries AND the front ocean
        const score =
          Math.min(riverDist * 1.65, coastDist * 0.92) +
          riverDist * 0.45 +
          coastDist * 0.14;
        dryCandidates.push({ x: pt.x, z: pt.z, alongFrac: af, riverDist, coastDist, score });
      }
    }
    dryCandidates.sort((a, b) => b.score - a.score);

    const fallbackDry = bandPoint(rng.chance(0.5) ? -0.58 : 0.58, -0.14);
    const mainPick =
      dryCandidates.length > 0
        ? dryCandidates[rng.int(0, Math.min(2, dryCandidates.length - 1))]
        : { x: fallbackDry.x, z: fallbackDry.z, alongFrac: 0.58, riverDist: 80, coastDist: 160, score: 100 };

    const minSecondSep = this.halfSize * 0.46;
    const minSecondRiver = Math.min(54, this.halfSize * 0.14);
    const pocketPick = dryCandidates.find(
      (c) =>
        Math.hypot(c.x - mainPick.x, c.z - mainPick.z) >= minSecondSep &&
        c.riverDist >= minSecondRiver,
    );

    const desertLobes: BiomeLobe[] = [
      {
        x: mainPick.x,
        z: mainPick.z,
        radius: this.halfSize * rng.range(0.36, 0.46),
        strength: 0.98,
      },
    ];
    if (pocketPick) {
      desertLobes.push({
        x: pocketPick.x,
        z: pocketPick.z,
        radius: this.halfSize * rng.range(0.24, 0.34),
        strength: 0.86,
      });
    }
    this.desertLobes = desertLobes;

    // Place verdant forests and grassy prairies across the moister river-fed & coastal-breeze interior,
    // well separated from the driest desert core
    const desertSide = mainPick.alongFrac >= 0 ? 1 : -1;
    const wetSlots = [-desertSide * 0.48, -desertSide * 0.04, desertSide * 0.24];
    if (rng.chance(0.5)) {
      const tmp = wetSlots[0];
      wetSlots[0] = wetSlots[1];
      wetSlots[1] = tmp;
    }
    const awayFromDesert = (pt: Vec2, fallbackAlong: number, fallbackDepth: number): Vec2 => {
      if (Math.hypot(pt.x - mainPick.x, pt.z - mainPick.z) < this.halfSize * 0.32) {
        return bandPoint(fallbackAlong, fallbackDepth);
      }
      return pt;
    };

    const prairieMain = awayFromDesert(
      bandPoint(wetSlots[0] + rng.range(-0.12, 0.12), rng.range(-0.12, 0.26)),
      -desertSide * 0.42,
      0.14,
    );
    const prairiePocket = awayFromDesert(
      bandPoint(wetSlots[2] + rng.range(-0.14, 0.14), rng.range(0.06, 0.3)),
      0,
      0.22,
    );
    this.prairieLobes = [
      { x: prairieMain.x, z: prairieMain.z, radius: this.halfSize * rng.range(0.38, 0.48), strength: 0.94 },
      { x: prairiePocket.x, z: prairiePocket.z, radius: this.halfSize * rng.range(0.25, 0.34), strength: 0.76 },
    ];

    const forestMain = awayFromDesert(
      bandPoint(wetSlots[1] + rng.range(-0.14, 0.14), rng.range(-0.24, 0.2)),
      -desertSide * 0.22,
      -0.08,
    );
    const forestHeart = awayFromDesert(
      bandPoint(rng.range(-0.22, 0.22), rng.range(-0.2, 0.18)),
      -desertSide * 0.12,
      0.06,
    );
    this.forestLobes = [
      { x: forestMain.x, z: forestMain.z, radius: this.halfSize * rng.range(0.38, 0.48), strength: 0.96 },
      { x: forestHeart.x, z: forestHeart.z, radius: this.halfSize * rng.range(0.28, 0.38), strength: 0.84 },
    ];

    const duneAngle = rng.range(0, Math.PI * 2);
    this.duneCos = Math.cos(duneAngle);
    this.duneSin = Math.sin(duneAngle);

    // 6. Lowland Misty Moss Fen tucked along a river bend in the central heartland
    const fenAlong = rng.range(-this.halfSize * 0.2, this.halfSize * 0.18);
    const fenPt = this.getRiverCenterPoint(fenAlong);
    const fenShift = -firstSide * rng.range(14, 28);
    this.fenCenterX = fenPt.x - fenShift * this.riverSin;
    this.fenCenterZ = fenPt.z + fenShift * this.riverCos;
    this.fenRadius = this.halfSize * rng.range(0.2, 0.3);

    this.ponds = this.generatePonds(rng.fork());
    this.generateResourceNodes(rng.fork());
    this.generateFloraAndRocks(config, rng.fork());
  }

  private generatePonds(rng: SeededRandom): PondFeature[] {
    const ponds: PondFeature[] = [];
    const worldScale = this.size / 160;

    // 1. Primary woodland lagoon nestled near the mossy fen bend
    let px = this.fenCenterX + rng.range(-10, 10);
    let pz = this.fenCenterZ + rng.range(-10, 10);
    if (this.getCoastSignedDistance(px, pz) < 34 || this.getAlpineDepthAt(px, pz) > 10) {
      const along = rng.range(-this.halfSize * 0.18, this.halfSize * 0.14);
      const pt = this.getRiverCenterPoint(along);
      const shift = rng.range(-12, 12);
      px = pt.x - shift * this.riverSin;
      pz = pt.z + shift * this.riverCos;
    }

    const pAngle = rng.range(0, Math.PI * 2);
    const pScaleX = rng.range(0.8, 1.32);
    ponds.push({
      x: px,
      z: pz,
      radius: rng.range(10.5, 16.5) * Math.min(1.5, Math.sqrt(worldScale) * 0.74),
      cos: Math.cos(pAngle),
      sin: Math.sin(pAngle),
      scaleX: pScaleX,
      scaleZ: 1 / pScaleX,
    });

    // 2. Scenic inland lakes & foothill tarns dotted across fertile forests, prairies, and foothills
    //    (kept out of arid desert basins so deserts remain genuinely dry and water-scarce)
    const extraCount =
      worldScale >= 5.5
        ? rng.int(4, 6)
        : worldScale >= 3.0
          ? rng.int(3, 5)
          : worldScale >= 1.5
            ? 3
            : rng.chance(0.6)
              ? 1
              : 0;
    for (let k = 0; k < extraCount; k++) {
      for (let attempt = 0; attempt < 44; attempt++) {
        const along = rng.range(-this.halfSize * 0.72, this.halfSize * 0.72);
        const forward = rng.range(-this.halfSize * 0.36, this.halfSize * 0.3);
        const sx = forward * this.coastCos - along * this.coastSin;
        const sz = forward * this.coastSin + along * this.coastCos;
        if (!this.isWithinPlayableArea(sx, sz, 24)) continue;
        const sCoast = this.getCoastSignedDistance(sx, sz);
        if (sCoast < 36) continue;
        const sAlpine = this.getAlpineDepthAt(sx, sz);
        if (sAlpine > 14) continue;
        const sRiver = this.getExactRiverDistance(sx, sz);
        if (sRiver < 16) continue;
        this.sampleAmorphousBiomesToScratch(sx, sz, sCoast, sAlpine, sRiver);
        if (this.tmpAridity > 0.34) continue;
        let tooClose = false;
        for (const existing of ponds) {
          if (Math.hypot(sx - existing.x, sz - existing.z) < 48 * Math.sqrt(worldScale)) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const sAngle = rng.range(0, Math.PI * 2);
        const sScaleX = rng.range(0.78, 1.34);
        ponds.push({
          x: sx,
          z: sz,
          radius: rng.range(8.5, 16.8),
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
   * Signed distance from the meandering front (+Z) ocean seashore:
   * > 0 inland, 0 at shoreline, < 0 open ocean sea.
   */
  getCoastSignedDistance(x: number, z: number): number {
    const seaProj = x * this.coastCos + z * this.coastSin;
    const alongCoast = -x * this.coastSin + z * this.coastCos;
    const bayScale = Math.min(2.65, Math.max(1.0, this.size / 340));
    const coveWave =
      Math.sin(alongCoast * (0.016 / Math.sqrt(bayScale)) + this.coastPhase) * (17.5 * bayScale) +
      Math.cos(alongCoast * (0.036 / Math.sqrt(bayScale)) - this.coastPhase * 0.7) * (8.2 * bayScale);
    const fineNoise =
      this.elevationNoise.sample(alongCoast * 0.01 + this.elevOffsetX, this.coastPhase) *
      (13.5 * Math.sqrt(bayScale));
    const shorelinePos = this.coastBaseDist + coveWave + fineNoise;
    return shorelinePos - seaProj;
  }

  /**
   * Signed depth into the back (-Z) craggy alpine mountain cordillera:
   * < 0 in the central lowlands (forests/prairies/deserts),
   * ~ 0..55 along the climbable mountain edge & foothill slopes,
   * >= 82 deep inside the impassable high alpine massif wall.
   */
  getAlpineDepthAt(x: number, z: number): number {
    const backProj = -(x * this.coastCos + z * this.coastSin);
    const alongBack = -x * this.coastSin + z * this.coastCos;
    const spurScale = Math.min(2.65, Math.max(1.0, this.size / 340));
    const spurWave =
      Math.sin(alongBack * (0.015 / Math.sqrt(spurScale)) + this.alpinePhase) * (18.5 * spurScale) +
      Math.cos(alongBack * (0.034 / Math.sqrt(spurScale)) - this.alpinePhase * 0.65) * (9.5 * spurScale);
    const fineNoise =
      this.elevationNoise.sample(alongBack * 0.011 - this.ridgeOffsetX, this.alpinePhase + 9.3) *
      (14.5 * Math.sqrt(spurScale));
    // Gentle amphitheater bow on far outer left/right flanks without encroaching on the front sea
    const flankWrap = Math.max(0, Math.abs(alongBack) - this.halfSize * 0.7) * 0.14;
    const foothillEdge = this.alpineBaseDist + spurWave + fineNoise - flankWrap;
    return backProj - foothillEdge;
  }

  /** True out in the open front ocean beyond shallow beach wading surf (impassable front bound). */
  isDeepSeaAt(x: number, z: number): boolean {
    return this.getCoastSignedDistance(x, z) < -3.0;
  }

  /**
   * True inside the high, sheer craggy alpine mountain wall at the back of the map.
   * Foothill edges and lower/mid mountain slopes remain passable and settleable, while
   * the towering alpine peaks and sheer cliffs form an impassable natural back bound.
   */
  isImpassableMountainAt(x: number, z: number, knownH?: number, knownSlope?: number): boolean {
    if (this.getAlpineDepthAt(x, z) >= 82.0) return true;
    const h = knownH ?? this.getHeightAt(x, z);
    if (h >= 29.0) return true;
    const slope = knownSlope ?? this.getSlopeAt(x, z);
    return slope >= 0.36;
  }

  /** True when (x, z) lies past either natural world bound: the open front sea or high back mountains. */
  isNaturalBoundBlocked(x: number, z: number): boolean {
    return this.isDeepSeaAt(x, z) || this.isImpassableMountainAt(x, z);
  }

  /**
   * Far-wandering pioneer parties can ford inland rivers & streams (rafting/wading across)
   * when no bridge exists yet, while strictly respecting both natural world bounds
   * (impassable open sea in front and impassable high alpine mountains in back).
   */
  canEmigrantTraverse(x: number, z: number): boolean {
    if (!this.isWithinPlayableArea(x, z)) return false;
    if (this.getBridgeDeckY(x, z) !== null) return true;
    if (this.isDeepSeaAt(x, z)) return false;
    if (this.isImpassableMountainAt(x, z)) return false;
    return true;
  }

  /** Interpolates a world XZ point & width along an arc-length-parameterized river polyline. */
  private samplePolyline(points: readonly RiverPolylinePoint[], s: number): RiverPolylinePoint {
    const n = points.length;
    if (n === 0) return { x: 0, z: 0, s: 0, halfW: this.riverHalfWidth };
    if (s <= points[0].s) return points[0];
    if (s >= points[n - 1].s) return points[n - 1];

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    const span = b.s - a.s || 1;
    const t = (s - a.s) / span;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      s,
      halfW: a.halfW + (b.halfW - a.halfW) * t,
    };
  }

  /** Local unit tangent angle along a river polyline at arc-length `s` (in direction of increasing `s`). */
  private samplePolylineHeading(points: readonly RiverPolylinePoint[], s: number): number {
    const a = this.samplePolyline(points, s - 6);
    const b = this.samplePolyline(points, s + 6);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz < 1e-6) return this.riverAngle;
    return Math.atan2(dz, dx);
  }

  /** World XZ coordinate along the meandering main river trunk centerline (`along` in arc-length meters). */
  getRiverCenterPoint(along: number): Vec2 {
    const pt = this.samplePolyline(this.trunkPoints, along);
    return { x: pt.x, z: pt.z };
  }

  /** World XZ coordinate along a dendritic river branch centerline (`along` in [0, branch.length] upstream). */
  getRiverBranchPoint(branchId: string, along: number): Vec2 | null {
    const branch = this.branches.find((b) => b.id === branchId);
    if (!branch) return null;
    const pt = this.samplePolyline(branch.points, Math.max(0, Math.min(branch.length, along)));
    return { x: pt.x, z: pt.z };
  }

  /**
   * Generates a deeply meandering, geological main river trunk polyline via multi-harmonic +
   * noise-driven heading integration from back alpine foothills down through sweeping S-bends
   * and out through the coastal beach into the front sea.
   */
  private buildMeanderingTrunkPolyline(rng: SeededRandom, freqScale: number): RiverPolylinePoint[] {
    const stepLen = 12.0;
    const anchorX = -this.riverOffset * this.riverSin;
    const anchorZ = this.riverOffset * this.riverCos;

    const p1 = rng.range(0, Math.PI * 2);
    const p2 = rng.range(0, Math.PI * 2);
    const wPhase = rng.range(0, Math.PI * 2);
    const f1 = rng.range(0.011, 0.017) * freqScale;
    const f2 = rng.range(0.025, 0.039) * freqScale;
    const a1 = rng.range(0.58, 0.82);
    const a2 = rng.range(0.26, 0.42);
    const noiseSeedX = rng.range(-80, 80);
    const noiseSeedZ = rng.range(-80, 80);
    const noiseAmp = rng.range(0.44, 0.6);

    const headingAt = (s: number, px: number, pz: number, coastDist: number): number => {
      const wave =
        Math.sin(s * f1 + p1) * a1 +
        Math.cos(s * f2 + p2) * a2 +
        this.elevationNoise.sample(px * 0.0046 + noiseSeedX, pz * 0.0046 + noiseSeedZ) * noiseAmp;
      // Gently straighten toward open sea as the estuary crosses the coastal plain & beach
      const seaGuide = 1 - smoothstep(-10, 56, coastDist);
      const clampedWave = Math.max(-1.12, Math.min(1.12, wave)) * (1 - seaGuide * 0.72);
      const base = this.riverAngle + wrapAngleDiff(this.coastAngle, this.riverAngle) * seaGuide;
      return base + clampedWave;
    };

    const widthAt = (s: number): number => {
      const downstreamT = smoothstep(-this.halfSize * 0.42, this.halfSize * 0.34, s);
      const swell = 1.0 + Math.sin(s * 0.024 + wPhase) * 0.11 + Math.cos(s * 0.051 - wPhase) * 0.05;
      return this.riverHalfWidth * (0.56 + 0.5 * downstreamT) * swell;
    };

    // March downstream from central anchor (s = 0) all the way past the front beach into deep sea
    const downPts: RiverPolylinePoint[] = [{ x: anchorX, z: anchorZ, s: 0, halfW: widthAt(0) }];
    let px = anchorX;
    let pz = anchorZ;
    let s = 0;
    const maxDownS = this.halfSize * 1.62;
    for (let step = 0; step < 120; step++) {
      const coastDist = this.getCoastSignedDistance(px, pz);
      if (coastDist < -98 && s >= this.halfSize * 1.48) break;
      if (s >= maxDownS) break;
      const ang = headingAt(s, px, pz, coastDist);
      // Keep trunk from drifting far outside lateral map bounds while meandering broadly
      const lat = -px * this.coastSin + pz * this.coastCos;
      const latPull = Math.abs(lat) > this.halfSize * 0.38 ? -Math.sign(lat) * 0.28 : 0;
      const finalAng = ang + latPull * (1 - (1 - smoothstep(-10, 56, coastDist)) * 0.7);
      px += Math.cos(finalAng) * stepLen;
      pz += Math.sin(finalAng) * stepLen;
      s += stepLen;
      downPts.push({ x: px, z: pz, s, halfW: widthAt(s) });
    }

    // March upstream from central anchor (s < 0) back into the alpine foothills
    const upPts: RiverPolylinePoint[] = [];
    px = anchorX;
    pz = anchorZ;
    s = 0;
    const maxUpS = this.halfSize * 0.74;
    for (let step = 0; step < 64; step++) {
      const coastDist = this.getCoastSignedDistance(px, pz);
      const ang = headingAt(s, px, pz, coastDist) + Math.PI;
      const lat = -px * this.coastSin + pz * this.coastCos;
      const latPull = Math.abs(lat) > this.halfSize * 0.42 ? Math.sign(lat) * 0.24 : 0;
      const finalAng = ang + latPull;
      const nx = px + Math.cos(finalAng) * stepLen;
      const nz = pz + Math.sin(finalAng) * stepLen;
      s -= stepLen;
      if (
        Math.abs(s) > maxUpS ||
        !this.isWithinPlayableArea(nx, nz, 22) ||
        this.getAlpineDepthAt(nx, nz) >= 34
      ) {
        break;
      }
      px = nx;
      pz = nz;
      upPts.push({ x: px, z: pz, s, halfW: widthAt(s) });
    }
    upPts.reverse();
    return [...upPts, ...downPts];
  }

  /**
   * Constructs a deeply meandering, geologically coherent dendritic (tree-shaped) watershed:
   * - Order 2 (Primary Tributaries / Main Boughs): 4–5 alternating serpentine branches joining
   *   exact trunk vertices at acute upstream V-angles and winding across both flanks.
   * - Order 1 (Secondary Streams / Upland Twigs): 1–2 narrower meandering creeks branching off
   *   each primary tributary at acute upstream V-angles, tapering cleanly to foothill springs
   *   without crossing the trunk or leaking into the front sea.
   */
  private buildDendriticRiverBranches(
    rng: SeededRandom,
    worldScale: number,
    freqScale: number,
    firstSide: 1 | -1,
  ): RiverBranch[] {
    const upstreamAngle = this.riverAngle + Math.PI;
    const primaries: { branch: RiverBranch; side: 1 | -1 }[] = [];
    const allBranches: RiverBranch[] = [];

    const minDistToPolyline = (
      pts: readonly RiverPolylinePoint[],
      x: number,
      z: number,
      excludeOriginX?: number,
      excludeOriginZ?: number,
      excludeRadiusSq = 0,
    ): number => {
      let minSq = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        if (excludeOriginX !== undefined && excludeOriginZ !== undefined && excludeRadiusSq > 0) {
          const ox = pt.x - excludeOriginX;
          const oz = pt.z - excludeOriginZ;
          if (ox * ox + oz * oz < excludeRadiusSq) continue;
        }
        const dx = x - pt.x;
        const dz = z - pt.z;
        const sq = dx * dx + dz * dz;
        if (sq < minSq) minSq = sq;
      }
      return Math.sqrt(minSq);
    };

    const marchMeanderingBranch = (
      id: string,
      parentId: string | null,
      order: 1 | 2,
      originX: number,
      originZ: number,
      baseAngle: number,
      startHalfWidth: number,
      endHalfWidth: number,
      targetLength: number,
      maxAlpineDepth: number,
      minCoastDist: number,
      avoidTrunk: boolean,
    ): RiverBranch | null => {
      const stepLen = order === 2 ? 11.0 : 9.5;
      const p1 = rng.range(0, Math.PI * 2);
      const p2 = rng.range(0, Math.PI * 2);
      const wPhase = rng.range(0, Math.PI * 2);
      const f1 = rng.range(order === 2 ? 0.017 : 0.024, order === 2 ? 0.028 : 0.038) * freqScale;
      const f2 = rng.range(order === 2 ? 0.036 : 0.048, order === 2 ? 0.056 : 0.072) * freqScale;
      const a1 = rng.range(order === 2 ? 0.5 : 0.46, order === 2 ? 0.72 : 0.68);
      const a2 = rng.range(0.22, 0.36);
      const noiseSeedX = rng.range(-90, 90);
      const noiseSeedZ = rng.range(-90, 90);
      const noiseAmp = rng.range(0.36, 0.54);

      const pts: RiverPolylinePoint[] = [{ x: originX, z: originZ, s: 0, halfW: startHalfWidth }];
      let px = originX;
      let pz = originZ;
      let s = 0;
      const maxSteps = Math.ceil(targetLength / stepLen);

      for (let step = 1; step <= maxSteps; step++) {
        const taperIn = smoothstep(0, 26, s + stepLen);
        const wave =
          (Math.sin((s + stepLen) * f1 + p1) * a1 +
            Math.cos((s + stepLen) * f2 + p2) * a2 +
            this.elevationNoise.sample(px * 0.0062 + noiseSeedX, pz * 0.0062 + noiseSeedZ) *
              noiseAmp) *
          taperIn;
        // Meander boldly around baseAngle while always draining upstream away from the front sea
        const rawAng = baseAngle + Math.max(-0.98, Math.min(0.98, wave));
        const clampedFromUpstream = Math.max(
          -1.26,
          Math.min(1.26, wrapAngleDiff(rawAng, upstreamAngle)),
        );
        const ang = upstreamAngle + clampedFromUpstream;
        const nx = px + Math.cos(ang) * stepLen;
        const nz = pz + Math.sin(ang) * stepLen;

        if (!this.isWithinPlayableArea(nx, nz, 22)) break;
        if (this.getCoastSignedDistance(nx, nz) <= minCoastDist) break;
        if (this.getAlpineDepthAt(nx, nz) >= maxAlpineDepth) break;
        if (
          s >= 42 &&
          avoidTrunk &&
          minDistToPolyline(this.trunkPoints, nx, nz, originX, originZ, 38 * 38) < 18
        ) {
          break;
        }
        if (s >= 40) {
          let hitsOther = false;
          for (const existing of allBranches) {
            if (existing.id === parentId) continue;
            if (minDistToPolyline(existing.points, nx, nz, originX, originZ, 32 * 32) < 16) {
              hitsOther = true;
              break;
            }
          }
          if (hitsOther) break;
        }

        px = nx;
        pz = nz;
        s += stepLen;
        pts.push({ x: px, z: pz, s, halfW: startHalfWidth });
      }

      const minValidLength =
        order === 2 ? Math.max(54, this.halfSize * 0.11) : Math.max(40, this.halfSize * 0.08);
      if (s < minValidLength || pts.length < 4) return null;

      // Apply smooth natural width taper + subtle organic pool/riffle swell along the final length
      const finalPts: RiverPolylinePoint[] = pts.map((pt) => {
        const t = pt.s / s;
        const baseW = startHalfWidth + (endHalfWidth - startHalfWidth) * t;
        const swell = 1.0 + Math.sin(pt.s * 0.045 + wPhase) * 0.09 * Math.sin(t * Math.PI);
        return { x: pt.x, z: pt.z, s: pt.s, halfW: baseW * swell };
      });
      const endPt = finalPts[finalPts.length - 1];
      return {
        id,
        parentId,
        order,
        originX,
        originZ,
        endX: endPt.x,
        endZ: endPt.z,
        angle: baseAngle,
        length: s,
        startHalfWidth,
        endHalfWidth,
        points: finalPts,
      };
    };

    // Order 2: Primary Tributaries (main boughs alternating left & right up the meandering trunk)
    const boughSpecs =
      worldScale >= 3.0
        ? [
            { alongFrac: 0.22, spreadMin: 0.62, spreadMax: 0.92, lenMin: 0.46, lenMax: 0.66, widthMult: 1.04 },
            { alongFrac: 0.09, spreadMin: 0.56, spreadMax: 0.86, lenMin: 0.46, lenMax: 0.66, widthMult: 1.0 },
            { alongFrac: -0.04, spreadMin: 0.48, spreadMax: 0.76, lenMin: 0.4, lenMax: 0.58, widthMult: 0.94 },
            { alongFrac: -0.16, spreadMin: 0.4, spreadMax: 0.66, lenMin: 0.34, lenMax: 0.5, widthMult: 0.88 },
            { alongFrac: -0.27, spreadMin: 0.32, spreadMax: 0.56, lenMin: 0.28, lenMax: 0.44, widthMult: 0.82 },
          ]
        : [
            { alongFrac: 0.18, spreadMin: 0.58, spreadMax: 0.88, lenMin: 0.42, lenMax: 0.6, widthMult: 1.0 },
            { alongFrac: 0.03, spreadMin: 0.52, spreadMax: 0.82, lenMin: 0.4, lenMax: 0.56, widthMult: 0.94 },
            { alongFrac: -0.11, spreadMin: 0.44, spreadMax: 0.72, lenMin: 0.34, lenMax: 0.5, widthMult: 0.88 },
            { alongFrac: -0.23, spreadMin: 0.34, spreadMax: 0.6, lenMin: 0.28, lenMax: 0.44, widthMult: 0.82 },
          ];

    for (let i = 0; i < boughSpecs.length; i++) {
      const spec = boughSpecs[i];
      const side: 1 | -1 = i % 2 === 0 ? firstSide : (firstSide === 1 ? -1 : 1);
      let along = (spec.alongFrac + rng.range(-0.025, 0.025)) * this.halfSize;
      let origin = this.samplePolyline(this.trunkPoints, along);

      // Keep every trunk confluence comfortably inland between front seashore and back alpine foothills
      for (let guard = 0; guard < 14; guard++) {
        if (this.getCoastSignedDistance(origin.x, origin.z) < 62) {
          along -= 14;
          origin = this.samplePolyline(this.trunkPoints, along);
        } else if (this.getAlpineDepthAt(origin.x, origin.z) > 8) {
          along += 14;
          origin = this.samplePolyline(this.trunkPoints, along);
        } else {
          break;
        }
      }

      const startHalfWidth = Math.min(origin.halfW * 0.78, rng.range(3.6, 4.6) * spec.widthMult);
      const endHalfWidth = Math.max(1.9, startHalfWidth * rng.range(0.48, 0.58));
      const angle = upstreamAngle + side * rng.range(spec.spreadMin, spec.spreadMax);
      const targetLen = this.halfSize * rng.range(spec.lenMin, spec.lenMax);

      let built = marchMeanderingBranch(
        `trib_${i}`,
        null,
        2,
        origin.x,
        origin.z,
        angle,
        startHalfWidth,
        endHalfWidth,
        targetLen,
        24,
        46,
        true,
      );
      if (!built) {
        const fallbacks: [number, number][] = [
          [0, rng.range(0.72, 1.0)],
          [-24, rng.range(0.54, 0.86)],
          [24, rng.range(0.54, 0.86)],
          [-42, rng.range(0.66, 0.96)],
        ];
        for (const [shift, spread] of fallbacks) {
          const candOrigin = this.samplePolyline(this.trunkPoints, along + shift);
          if (this.getCoastSignedDistance(candOrigin.x, candOrigin.z) < 50) continue;
          if (this.getAlpineDepthAt(candOrigin.x, candOrigin.z) > 12) continue;
          built = marchMeanderingBranch(
            `trib_${i}`,
            null,
            2,
            candOrigin.x,
            candOrigin.z,
            upstreamAngle + side * spread,
            startHalfWidth,
            endHalfWidth,
            targetLen,
            24,
            46,
            true,
          );
          if (built) break;
        }
      }
      if (built) {
        primaries.push({ branch: built, side });
        allBranches.push(built);
      }
    }

    // Order 1: Secondary Streams / Creeks (twigs branching off each primary tributary)
    let streamCounter = 0;
    for (const { branch: parent, side: parentSide } of primaries) {
      const twigSpecs =
        parent.length >= 115
          ? [
              { joinMin: 0.28, joinMax: 0.44, subSide: parentSide },
              { joinMin: 0.54, joinMax: 0.72, subSide: (parentSide === 1 ? -1 : 1) as 1 | -1 },
            ]
          : [{ joinMin: 0.34, joinMax: 0.56, subSide: parentSide }];

      for (const twig of twigSpecs) {
        const joinFrac = rng.range(twig.joinMin, twig.joinMax);
        const joinAlong = parent.length * joinFrac;
        const origin = this.samplePolyline(parent.points, joinAlong);
        const localParentHeading = this.samplePolylineHeading(parent.points, joinAlong);
        const startHalfWidth = Math.min(origin.halfW * 0.74, rng.range(2.3, 3.0));
        const endHalfWidth = Math.max(1.4, startHalfWidth * rng.range(0.56, 0.68));

        // Fork at an acute upstream V-angle relative to parent's local curve, heading away from sea
        const rawAngle = localParentHeading + twig.subSide * rng.range(0.48, 0.78);
        const clampedOffset = Math.max(-1.12, Math.min(1.12, wrapAngleDiff(rawAngle, upstreamAngle)));
        let angle = upstreamAngle + clampedOffset;
        if (Math.abs(wrapAngleDiff(angle, localParentHeading)) < 0.34) {
          const altOffset = Math.max(
            -1.12,
            Math.min(1.12, wrapAngleDiff(localParentHeading - twig.subSide * 0.52, upstreamAngle)),
          );
          angle = upstreamAngle + altOffset;
        }

        const targetLen = this.halfSize * rng.range(0.2, 0.38);

        const built = marchMeanderingBranch(
          `stream_${streamCounter}`,
          parent.id,
          1,
          origin.x,
          origin.z,
          angle,
          startHalfWidth,
          endHalfWidth,
          targetLen,
          26,
          50,
          true,
        );
        if (built) {
          streamCounter++;
          allBranches.push(built);
        }
      }
    }

    return allBranches;
  }

  /** Builds the flat polyline segment array & uniform spatial hash grid for O(1) river queries. */
  private buildRiverSpatialIndex(): {
    segments: RiverSegment[];
    cells: (Int16Array | null)[];
  } {
    const segments: RiverSegment[] = [];
    const buckets: number[][] = new Array(this.riverGridDim * this.riverGridDim);
    const half = this.riverGridHalf;
    const invCell = 1 / this.riverGridCellSize;
    const dim = this.riverGridDim;

    const pushPolyline = (
      pts: readonly RiverPolylinePoint[],
      channelId: number,
      order: 1 | 2 | 3,
      flowSign: 1 | -1,
    ): void => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-4) continue;
        const invLen = 1 / Math.sqrt(lenSq);
        const segIdx = segments.length;
        segments.push({
          channelId,
          order,
          ax: a.x,
          az: a.z,
          bx: b.x,
          bz: b.z,
          dx,
          dz,
          invLenSq: 1 / lenSq,
          flowX: dx * invLen * flowSign,
          flowZ: dz * invLen * flowSign,
          halfW0: a.halfW,
          halfW1: b.halfW,
        });

        // Pad cell insertion generously so a single cell lookup covers carve width, estuary & moisture
        const pad = Math.max(a.halfW, b.halfW) + (order === 3 ? 52 : 42);
        const minX = Math.min(a.x, b.x) - pad;
        const maxX = Math.max(a.x, b.x) + pad;
        const minZ = Math.min(a.z, b.z) - pad;
        const maxZ = Math.max(a.z, b.z) + pad;
        const gx0 = Math.max(0, Math.floor((minX + half) * invCell));
        const gx1 = Math.min(dim - 1, Math.floor((maxX + half) * invCell));
        const gz0 = Math.max(0, Math.floor((minZ + half) * invCell));
        const gz1 = Math.min(dim - 1, Math.floor((maxZ + half) * invCell));
        for (let gx = gx0; gx <= gx1; gx++) {
          const row = gx * dim;
          for (let gz = gz0; gz <= gz1; gz++) {
            const cellIdx = row + gz;
            let list = buckets[cellIdx];
            if (!list) {
              list = [];
              buckets[cellIdx] = list;
            }
            list.push(segIdx);
          }
        }
      }
    };

    // Channel 0: Main trunk (marched downstream, so flowSign = +1)
    pushPolyline(this.trunkPoints, 0, 3, 1);
    // Channels 1..N: Branches (marched upstream from confluence, so downstream flowSign = -1)
    for (let i = 0; i < this.branches.length; i++) {
      const b = this.branches[i];
      pushPolyline(b.points, i + 1, b.order, -1);
    }

    const cells: (Int16Array | null)[] = new Array(buckets.length);
    for (let i = 0; i < buckets.length; i++) {
      cells[i] = buckets[i] ? Int16Array.from(buckets[i]) : null;
    }
    return { segments, cells };
  }

  /** Signed elliptical distance to a specific lake/pond shoreline (negative inside water). */
  private getPondSignedDistance(x: number, z: number, pond: PondFeature): number {
    const dx = x - pond.x;
    const dz = z - pond.z;
    const lx = (dx * pond.cos + dz * pond.sin) / pond.scaleX;
    const lz = (-dx * pond.sin + dz * pond.cos) / pond.scaleZ;
    return Math.sqrt(lx * lx + lz * lz) - pond.radius;
  }

  /** Exact signed distance from (x, z) to the nearest river/tributary/stream bank (no grid cap). */
  private getExactRiverDistance(x: number, z: number): number {
    let minDist = Infinity;
    const segs = this.riverSegments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const vx = x - seg.ax;
      const vz = z - seg.az;
      let t = (vx * seg.dx + vz * seg.dz) * seg.invLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = vx - seg.dx * t;
      const pz = vz - seg.dz * t;
      const halfW = seg.halfW0 + (seg.halfW1 - seg.halfW0) * t;
      const d = Math.sqrt(px * px + pz * pz) - halfW;
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  /** Signed distance from freshwater rivers, tributaries, and lakes (negative inside water). */
  getFreshwaterDistance(x: number, z: number): number {
    const coastDist = this.getCoastSignedDistance(x, z);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    return this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, Infinity);
  }

  /**
   * O(1) spatial-grid freshwater signed-distance query combining exact per-channel polyline
   * distances (zero segment-joint bulges) with smooth organic Y-confluence & lake blending.
   */
  private getFreshwaterDistanceFast(
    x: number,
    z: number,
    coastDist: number,
    alpineDepth: number,
    maxRelevantDist: number,
  ): number {
    const estuaryBoost = (1 - smoothstep(-8, 48, coastDist)) * 10.5;

    // Taper rivers cleanly at alpine headwaters so they never slice through the impassable mountain wall
    const headwaterPush = smoothstep(22, 68, alpineDepth) * 44.0;

    let waterDist = Math.min(maxRelevantDist, 56);
    const gx = Math.floor((x + this.riverGridHalf) / this.riverGridCellSize);
    const gz = Math.floor((z + this.riverGridHalf) / this.riverGridCellSize);
    if (
      headwaterPush < 40 &&
      gx >= 0 &&
      gx < this.riverGridDim &&
      gz >= 0 &&
      gz < this.riverGridDim
    ) {
      const cell = this.riverGridCells[gx * this.riverGridDim + gz];
      if (cell) {
        // Track exact min distance for up to 3 distinct channels in this cell (zero allocations)
        let c0Id = -1;
        let c0Dist = Infinity;
        let c1Id = -1;
        let c1Dist = Infinity;
        let c2Id = -1;
        let c2Dist = Infinity;
        const segs = this.riverSegments;

        for (let i = 0; i < cell.length; i++) {
          const seg = segs[cell[i]];
          const vx = x - seg.ax;
          const vz = z - seg.az;
          let t = (vx * seg.dx + vz * seg.dz) * seg.invLenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const px = vx - seg.dx * t;
          const pz = vz - seg.dz * t;
          let halfW = seg.halfW0 + (seg.halfW1 - seg.halfW0) * t;
          if (seg.order === 3 && estuaryBoost > 0) halfW += estuaryBoost;
          const d = Math.sqrt(px * px + pz * pz) - halfW + headwaterPush;
          const cid = seg.channelId;

          if (cid === c0Id) {
            if (d < c0Dist) c0Dist = d;
          } else if (cid === c1Id) {
            if (d < c1Dist) c1Dist = d;
          } else if (cid === c2Id) {
            if (d < c2Dist) c2Dist = d;
          } else if (c0Id === -1) {
            c0Id = cid;
            c0Dist = d;
          } else if (c1Id === -1) {
            c1Id = cid;
            c1Dist = d;
          } else if (c2Id === -1) {
            c2Id = cid;
            c2Dist = d;
          } else if (d < c2Dist) {
            c2Id = cid;
            c2Dist = d;
          }
        }

        if (c0Id !== -1) {
          waterDist = c0Dist;
          if (c1Id !== -1) waterDist = smoothMin(waterDist, c1Dist, 3.2);
          if (c2Id !== -1) waterDist = smoothMin(waterDist, c2Dist, 2.8);
        }
      }
    }

    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      waterDist = smoothMin(waterDist, pondDist, 3.8);
    }
    return waterDist;
  }

  /** Signed distance from ALL water: rivers, tributaries, lakes, and the front ocean seashore. */
  getWaterDistance(x: number, z: number): number {
    const fresh = this.getFreshwaterDistance(x, z);
    const coast = this.getCoastSignedDistance(x, z);
    return smoothMin(fresh, coast, 4.5);
  }

  /**
   * Downstream surface flow vector (world XZ) for realistic flowing water shaders.
   * Flows down every upland stream into its primary tributary, down each tributary into the
   * widening main trunk, and out through the coastal estuary into the front sea.
   */
  getWaterFlowAt(x: number, z: number): Vec2 {
    const coastDist = this.getCoastSignedDistance(x, z);
    const estuaryBoost = (1 - smoothstep(-6, 38, coastDist)) * 7.0;

    const surf = 0.24 + (1 - smoothstep(-24, 2, coastDist)) * 0.14;
    const surfX = -this.coastCos * surf;
    const surfZ = -this.coastSin * surf;

    let minChannelDist = Infinity;
    let fx = this.riverCos;
    let fz = this.riverSin;

    const gx = Math.floor((x + this.riverGridHalf) / this.riverGridCellSize);
    const gz = Math.floor((z + this.riverGridHalf) / this.riverGridCellSize);
    if (gx >= 0 && gx < this.riverGridDim && gz >= 0 && gz < this.riverGridDim) {
      const cell = this.riverGridCells[gx * this.riverGridDim + gz];
      if (cell) {
        const segs = this.riverSegments;
        let bestSeg: RiverSegment | null = null;
        for (let i = 0; i < cell.length; i++) {
          const seg = segs[cell[i]];
          const vx = x - seg.ax;
          const vz = z - seg.az;
          let t = (vx * seg.dx + vz * seg.dz) * seg.invLenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const px = vx - seg.dx * t;
          const pz = vz - seg.dz * t;
          let halfW = seg.halfW0 + (seg.halfW1 - seg.halfW0) * t;
          if (seg.order === 3 && estuaryBoost > 0) halfW += estuaryBoost;
          const d = Math.sqrt(px * px + pz * pz) - halfW;
          if (d < minChannelDist) {
            minChannelDist = d;
            bestSeg = seg;
          }
        }
        if (bestSeg) {
          fx = bestSeg.flowX;
          fz = bestSeg.flowZ;
        }
      }
    }

    if (coastDist < -14 && minChannelDist > 4) {
      return { x: surfX, z: surfZ };
    }

    const len = Math.sqrt(fx * fx + fz * fz) || 1;
    fx /= len;
    fz /= len;

    let pondCalm = 1.0;
    for (const pond of this.ponds) {
      const pondDist = this.getPondSignedDistance(x, z, pond);
      const calm = smoothstep(-3.0, 6.0, pondDist);
      if (calm < pondCalm) pondCalm = calm;
    }
    const speed = 0.22 + 0.78 * pondCalm;
    const riverFlowX = fx * speed;
    const riverFlowZ = fz * speed;

    // Blend smoothly from river outflow into ocean surf outside/beyond estuary mouths
    if (coastDist < 6.0) {
      const inMouth = 1 - smoothstep(-2.0, 6.0, minChannelDist);
      const mouthBlend = smoothstep(-14.0, 2.0, coastDist) * inMouth;
      const riverWeight = Math.max(smoothstep(0.0, 6.0, coastDist), mouthBlend);
      return {
        x: surfX + (riverFlowX - surfX) * riverWeight,
        z: surfZ + (riverFlowZ - surfZ) * riverWeight,
      };
    }
    return { x: riverFlowX, z: riverFlowZ };
  }

  /**
   * Computes strongly domain-warped amorphous interior biome weights (desert aridity &
   * prairie openness) in a single pass so forests, prairies, and deserts weave organically
   * across the central landmass between the back mountains and front sea.
   */
  private sampleAmorphousBiomesToScratch(
    x: number,
    z: number,
    coastDist: number,
    alpineDepth: number,
    freshDist: number,
  ): void {
    // Two-scale organic domain warp completely dissolves geometric boundaries into amorphous regions
    const w1x =
      this.climateNoise.fbm(x * 0.0024 + this.climOffsetX, z * 0.0024 + this.climOffsetZ, 2) *
      148.0;
    const w1z =
      this.climateNoise.fbm(
        x * 0.0024 - this.climOffsetZ + 41.7,
        z * 0.0024 + this.climOffsetX - 27.3,
        2,
      ) * 148.0;
    const w2x =
      this.fertilityNoise.sample(x * 0.0068 + this.fertOffsetX, z * 0.0068 + this.fertOffsetZ) *
      42.0;
    const w2z =
      this.fertilityNoise.sample(
        x * 0.0068 - this.fertOffsetZ + 13.1,
        z * 0.0068 + this.fertOffsetX - 19.4,
      ) * 42.0;
    const wx = x + w1x + w2x;
    const wz = z + w1z + w2z;

    const dryWave =
      (this.climateNoise.fbm(
        wx * 0.0028 + this.climOffsetX * 0.65,
        wz * 0.0028 + this.climOffsetZ * 0.65,
        2,
      ) +
        1) *
      0.5;
    const openWave =
      (this.fertilityNoise.fbm(
        wx * 0.0031 - this.fertOffsetX * 0.65 + 19.5,
        wz * 0.0031 + this.fertOffsetZ * 0.65 - 11.2,
        2,
      ) +
        1) *
      0.5;

    let desertLobe = 0;
    for (let i = 0; i < this.desertLobes.length; i++) {
      const l = this.desertLobes[i];
      const dx = wx - l.x;
      const dz = wz - l.z;
      const dSq = dx * dx + dz * dz;
      const maxR = l.radius * 1.08;
      if (dSq >= maxR * maxR) continue;
      const d = Math.sqrt(dSq) / l.radius;
      const m = (1 - smoothstep(0.28, 1.08, d)) * l.strength;
      if (m > desertLobe) desertLobe = m;
    }

    let prairieLobe = 0;
    for (let i = 0; i < this.prairieLobes.length; i++) {
      const l = this.prairieLobes[i];
      const dx = wx - l.x;
      const dz = wz - l.z;
      const dSq = dx * dx + dz * dz;
      const maxR = l.radius * 1.08;
      if (dSq >= maxR * maxR) continue;
      const d = Math.sqrt(dSq) / l.radius;
      const m = (1 - smoothstep(0.28, 1.08, d)) * l.strength;
      if (m > prairieLobe) prairieLobe = m;
    }

    let forestLobe = 0;
    for (let i = 0; i < this.forestLobes.length; i++) {
      const l = this.forestLobes[i];
      const dx = wx - l.x;
      const dz = wz - l.z;
      const dSq = dx * dx + dz * dz;
      const maxR = l.radius * 1.06;
      if (dSq >= maxR * maxR) continue;
      const d = Math.sqrt(dSq) / l.radius;
      const m = (1 - smoothstep(0.26, 1.06, d)) * l.strength;
      if (m > forestLobe) forestLobe = m;
    }

    // Maritime humidity near the front sea and riparian moisture near rivers/lakes keep deserts
    // strictly in the driest inland basins farthest away from water
    const coastFadeStart = Math.min(48, this.halfSize * 0.14);
    const coastFadeEnd = Math.min(140, this.halfSize * 0.34);
    const desertCoastCool = (1 - smoothstep(coastFadeStart, coastFadeEnd, coastDist)) * 0.96;
    const prairieCoastCool = (1 - smoothstep(4, 24, coastDist)) * 0.32;
    const alpineCool = smoothstep(0, 36, alpineDepth) * 0.76;
    const riverFadeStart = Math.min(14, this.halfSize * 0.08);
    const riverFadeEnd = Math.min(44, this.halfSize * 0.2);
    const desertWaterCool = (1 - smoothstep(riverFadeStart, riverFadeEnd, freshDist)) * 0.96;

    const rawDesert =
      desertLobe * (0.76 + dryWave * 0.44) -
      forestLobe * 0.32 -
      prairieLobe * 0.22;
    const aridity = Math.max(
      0,
      Math.min(1, rawDesert - desertWaterCool - desertCoastCool - alpineCool),
    );

    const rawPrairie =
      Math.max(prairieLobe * 0.78 + openWave * 0.38, openWave * 0.86 - 0.14) -
      forestLobe * 0.34 -
      aridity * 0.65;
    const prairie = Math.max(0, Math.min(1, rawPrairie - prairieCoastCool - alpineCool * 0.85));

    this.tmpAridity = aridity;
    this.tmpPrairie = prairie;
  }

  /** Warmth / aridity index in [0, 1] defining amorphous sandy dune-sea desert regions. */
  getAridityAt(x: number, z: number): number {
    const coastDist = this.getCoastSignedDistance(x, z);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, freshDist);
    return this.tmpAridity;
  }

  /** Openness index in [0, 1] defining amorphous flat treeless grassy prairie regions. */
  getPrairieWeightAt(x: number, z: number): number {
    const coastDist = this.getCoastSignedDistance(x, z);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, freshDist);
    return this.tmpPrairie;
  }

  /** Continuous alpine massif envelope weight in [0, 1.65] across the back (-Z) mountain wall. */
  getMountainWeightAt(x: number, z: number): number {
    const alpineDepth = this.getAlpineDepthAt(x, z);
    if (alpineDepth <= -52) return 0;
    const baseWall = smoothstep(-52, 95, alpineDepth);
    const alongBack = -x * this.coastSin + z * this.coastCos;
    let peakBoost = 0;
    for (let i = 0; i < this.alpinePeaks.length; i++) {
      const p = this.alpinePeaks[i];
      const da = alongBack - p.along;
      const dd = alpineDepth - p.depth;
      const dSq = da * da + dd * dd;
      const maxR = p.radius * 1.05;
      if (dSq >= maxR * maxR) continue;
      const d = Math.sqrt(dSq) / p.radius;
      const m = 1 - smoothstep(0.05, 1.05, d);
      if (m > peakBoost) peakBoost = m;
    }
    return Math.min(1.65, baseWall * 1.1 + peakBoost * 0.65);
  }

  /** Continuous world height in meters at any (x, z) coordinate out to infinity. */
  getHeightAt(x: number, z: number): number {
    const radialDist = Math.sqrt(x * x + z * z) / this.halfSize;
    const coastDist = this.getCoastSignedDistance(x, z);
    const landMask = smoothstep(-6, 30, coastDist);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);

    // Smoothly transition inland outer terrain into distant hills/peaks while keeping the front ocean open
    const outerBlend = (radialDist > 0.8 ? smoothstep(0.8, 1.65, radialDist) : 0) * landMask;
    const farBlend = radialDist > 1.35 ? smoothstep(1.35, 2.75, radialDist) : 0;

    // Seeded coordinate rotation + organic domain warp
    const rx = x * this.elevCos - z * this.elevSin;
    const rz = x * this.elevSin + z * this.elevCos;
    const warpX =
      this.elevationNoise.sample(rx * 0.0055 + this.elevOffsetX, rz * 0.0055 + this.elevOffsetZ) *
      this.warpStrength;
    const warpZ =
      this.elevationNoise.sample(
        rx * 0.0055 - this.elevOffsetZ + 17.3,
        rz * 0.0055 + this.elevOffsetX - 11.7,
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
            rx * 0.004 + this.elevOffsetX * 0.35 + 4.3,
            rz * 0.004 + this.elevOffsetZ * 0.35 - 2.9,
            3,
            2.0,
            0.52,
          ) * 13.0
        : 0;

    const ridgeWeight = Math.min(1.35, Math.max(0, radialDist - 0.22)) * landMask;
    const ridgeNoise = this.elevationNoise.ridged(
      wx * this.ridgeScale + this.ridgeOffsetX,
      wz * this.ridgeScale + this.ridgeOffsetZ,
      2,
    );
    const ridge = ridgeWeight > 0 ? ridgeNoise * this.ridgeAmplitude * ridgeWeight : 0;

    // 1. Back (-Z) Continuous Craggy Alpine Mountain Cordillera
    //    Foothills & climbable slopes (alpineDepth -48..+55) rise into an impassable towering wall (+60..infinity)
    let craggyMassif = 0;
    const mountainEnvelope =
      alpineDepth > -52 ? smoothstep(-52, 86, alpineDepth) * landMask : 0;
    if (mountainEnvelope > 0.001) {
      const alongBack = -x * this.coastSin + z * this.coastCos;
      const alpineRidge = this.elevationNoise.ridged(
        wx * 0.0085 + this.ridgeOffsetX * 1.15,
        wz * 0.0085 + this.ridgeOffsetZ * 1.15,
        4,
      );
      const sharpArete = Math.pow(alpineRidge, 1.62);
      const cragFracture = Math.pow(
        this.elevationNoise.ridged(
          rx * 0.023 - this.elevOffsetZ * 0.7 + 29.4,
          rz * 0.023 + this.elevOffsetX * 0.7 - 17.8,
          3,
        ),
        1.88,
      );

      // Gentle walkable foothill apron & terraced slopes on the mountain edge
      const foothillT = smoothstep(-50, 34, alpineDepth) * landMask;
      const foothillApron = foothillT * (10.5 + ridgeNoise * 5.2);

      // Continuous towering high-alpine cordillera backbone behind the foothills
      const wallT = smoothstep(14, 125, alpineDepth) * landMask;
      const deepRangeT = smoothstep(95, 290, alpineDepth) * landMask;
      const backboneHeight =
        Math.pow(wallT, 1.48) * this.mountainPeakBoost * (0.48 + sharpArete * 0.72) +
        deepRangeT * this.mountainPeakBoost * (0.34 + sharpArete * 0.56);

      // 7 sculpted hero alpine peak spires spaced across the entire back range
      let spireProfile = 0;
      for (let i = 0; i < this.alpinePeaks.length; i++) {
        const p = this.alpinePeaks[i];
        const da = alongBack - p.along;
        const dd = alpineDepth - p.depth;
        const dSq = da * da + dd * dd;
        const maxR = p.radius * 1.04;
        if (dSq < maxR * maxR) {
          const d = Math.sqrt(dSq) / p.radius;
          const m = (1 - smoothstep(0.04, 1.04, d)) * landMask;
          spireProfile += Math.pow(m, 1.38) * this.mountainPeakBoost * 0.72 * p.heightScale;
        }
      }

      // Secondary endless horizon peaks stretching far behind the main wall
      const farBackPeaks =
        alpineDepth > 140
          ? smoothstep(140, 260, alpineDepth) *
            Math.pow(
              this.elevationNoise.ridged(
                alongBack * 0.0042 + this.alpinePhase,
                alpineDepth * 0.0042 - this.alpinePhase,
                3,
              ),
              1.45,
            ) *
            this.mountainPeakBoost *
            0.78 *
            landMask
          : 0;

      const rawMassif =
        foothillApron +
        backboneHeight +
        spireProfile * (0.46 + sharpArete * 0.84) +
        farBackPeaks +
        Math.pow(wallT, 1.15) * cragFracture * (this.mountainPeakBoost * 0.24);

      // Chiseled granite strata & cliff breaks: subtle terraces on slopes, jagged crags aloft
      const stratumStep = 6.4;
      const cragBreak =
        rawMassif > 4.0
          ? Math.sin((rawMassif / stratumStep) * Math.PI * 2 + cragFracture * 2.1) *
            Math.min(1.9, 0.42 + rawMassif * 0.015)
          : 0;
      craggyMassif = Math.max(0, rawMassif - cragBreak);
    }

    // 2. Amorphous Interior Biomes: Arid Sand Dunes/Mesas & Flat Sunlit Prairies
    this.sampleAmorphousBiomesToScratch(
      x,
      z,
      coastDist,
      alpineDepth,
      freshDist,
    );
    const aridity = this.tmpAridity;
    const prairie = this.tmpPrairie;
    const alpineSuppress = 1 - smoothstep(-10, 26, alpineDepth);

    const desMask = smoothstep(0.45, 0.72, aridity) * landMask * alpineSuppress;
    let desertSculpt = 0;
    if (desMask > 0.001) {
      const duneU = x * this.duneCos + z * this.duneSin;
      const duneV = -x * this.duneSin + z * this.duneCos;
      const duneWarp = this.climateNoise.sample(duneU * 0.008, duneV * 0.008) * 5.2;
      const primaryDune = Math.pow(1 - Math.abs(Math.sin(duneU * 0.052 + duneWarp)), 1.35) * 3.4;
      const crossDune =
        (1 - Math.abs(Math.sin(duneU * 0.115 - duneV * 0.032 + duneWarp * 0.6))) * 0.85;
      const mesaRaw =
        (this.elevationNoise.fbm(x * 0.01 + 31.4, z * 0.01 - 19.2, 2) + 1) * 0.5;
      const mesa = smoothstep(0.69, 0.78, mesaRaw) * 8.2;
      desertSculpt = desMask * (1.2 + primaryDune + crossDune + mesa);
    }

    const praFlat = smoothstep(0.46, 0.72, prairie) * landMask * alpineSuppress;

    // 3. Lowland Misty Fen Depression
    const fdx = x - this.fenCenterX;
    const fdz = z - this.fenCenterZ;
    const fenDist = Math.sqrt(fdx * fdx + fdz * fdz) / this.fenRadius;
    const fenMask = (1 - smoothstep(0.2, 1.05, fenDist)) * landMask * alpineSuppress;

    const micro =
      this.elevationNoise.sample(rx * 0.085 + this.elevOffsetX, rz * 0.085 + this.elevOffsetZ) *
      0.34;
    const valleyTilt =
      Math.tanh((x * this.tiltCos + z * this.tiltSin) / this.halfSize) *
      this.tiltStrength *
      (1.0 - praFlat * 0.78);

    const hillDamping = 1.0 - fenMask * 0.45 - praFlat * 0.88 - desMask * 0.58;
    const outerLift = outerBlend * (1.0 - praFlat * 0.88 - desMask * 0.52);
    let h =
      this.valleyBaseHeight +
      valleyTilt +
      hills * (1.0 - farBlend * 0.28) * Math.max(0.12, hillDamping) +
      broadHills * outerLift * 0.65 +
      ridge * (1.0 - praFlat * 0.96 - desMask * 0.48) +
      craggyMassif +
      desertSculpt +
      outerLift * 6.4 +
      micro * (1.0 - farBlend * 0.65) * (1.0 - praFlat * 0.68);

    // Strongly flatten every amorphous prairie region into a smooth, level grassland plain
    if (praFlat > 0) {
      const flatPrairie = 2.08 + hills * 0.025 + micro * 0.1;
      h = h + (flatPrairie - h) * praFlat * 0.94;
    }

    // Flatten fenlands into gentle low mossy marshes slightly above waterLevel
    if (fenMask > 0) {
      const fenFloor = this.waterLevel + 0.68 + micro * 0.35;
      h = h + (fenFloor - h) * fenMask * 0.52;
    }

    // Sculpt sweeping front sandy seashore incline first so rivers carve right through the beach into the sea
    if (coastDist > 0 && coastDist < 34) {
      const beachT = smoothstep(0, 34, coastDist);
      const beachProfile = this.waterLevel - 0.06 + Math.pow(beachT, 0.88) * 2.62 + micro * 0.18;
      const blend = 1 - smoothstep(10, 34, coastDist);
      h = h + (beachProfile - h) * blend;
    }

    // Carve freshwater rivers, tributaries, and lakes cleanly through inland valleys & coastal beaches
    if (freshDist < 12) {
      const t = Math.max(0, Math.min(1, (freshDist + 3.4) / 15.4));
      const smooth = t * t * (3 - 2 * t);
      const riverbedHeight = this.waterLevel - 1.45 + micro * 0.22;
      h = riverbedHeight + (h - riverbedHeight) * smooth;
    }

    // Merge seamlessly into the deepening open ocean seabed beyond the front shoreline
    if (coastDist <= 0) {
      const seaT = smoothstep(0, -44, coastDist);
      const seaFloor = this.waterLevel - 0.06 - seaT * 3.65 + micro * 0.16;
      h = Math.min(h, seaFloor);
    }

    return Math.max(this.waterLevel - 3.9, Math.min(138.0, h));
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
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  getSlopeAt(x: number, z: number): number {
    const n = this.getNormalAt(x, z);
    return 1 - n.y;
  }

  private computeMoisture(x: number, z: number, freshDist: number, aridity: number): number {
    const riverBoost = Math.exp(-Math.max(0, freshDist) * 0.068) * 0.56;
    const fdx = x - this.fenCenterX;
    const fdz = z - this.fenCenterZ;
    const fenDist = Math.sqrt(fdx * fdx + fdz * fdz) / this.fenRadius;
    const fenBoost = (1 - smoothstep(0.2, 1.1, fenDist)) * 0.34;
    const noiseVal =
      (this.moistureNoise.fbm(
        x * 0.015 + this.moistOffsetX,
        z * 0.015 + this.moistOffsetZ,
        3,
      ) +
        1) *
      0.5;
    return Math.max(0, Math.min(1, noiseVal * 0.56 + riverBoost + fenBoost - aridity * 0.54));
  }

  private computeFertility(
    x: number,
    z: number,
    h: number,
    moisture: number,
    aridity: number,
  ): number {
    if (h <= this.waterLevel) return 0;
    const n =
      (this.fertilityNoise.fbm(
        x * 0.018 + this.fertOffsetX,
        z * 0.018 + this.fertOffsetZ,
        3,
      ) +
        1) *
      0.5;
    const altitudePenalty = Math.max(0, (h - 7.8) * 0.072);
    return Math.max(0, Math.min(1, n * 0.5 + moisture * 0.54 - altitudePenalty - aridity * 0.42));
  }

  getMoistureAt(x: number, z: number): number {
    const coastDist = this.getCoastSignedDistance(x, z);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 68);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, Math.min(freshDist, 56));
    return this.computeMoisture(x, z, freshDist, this.tmpAridity);
  }

  getFertilityAt(x: number, z: number): number {
    const h = this.getHeightAt(x, z);
    if (h <= this.waterLevel) return 0;
    const coastDist = this.getCoastSignedDistance(x, z);
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 68);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, Math.min(freshDist, 56));
    const aridity = this.tmpAridity;
    const moisture = this.computeMoisture(x, z, freshDist, aridity);
    return this.computeFertility(x, z, h, moisture, aridity);
  }

  /** Fast biome classification using a precomputed elevation and slope sample. */
  getBiomeAtSample(x: number, z: number, h: number, slope: number): BiomeType {
    if (h <= this.waterLevel + 0.05) return 'water';

    const coastDist = this.getCoastSignedDistance(x, z);
    if (coastDist < 20.0 && h < this.waterLevel + 2.6) return 'seashore';

    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);
    this.sampleAmorphousBiomesToScratch(
      x,
      z,
      coastDist,
      alpineDepth,
      freshDist,
    );
    const aridity = this.tmpAridity;
    const prairie = this.tmpPrairie;

    // Keep arid desert sand dunes & sandstone mesas distinctly sandy rather than turning into gray alpine rock
    if (aridity > 0.48 && freshDist > 3.4 && h < 19.0 && alpineDepth < 20) {
      return 'desert';
    }

    if (h > 13.5 || (h > 9.5 && slope > 0.23) || alpineDepth > 58) return 'alpine_crag';
    if (h > 7.4 || slope > 0.25 || (alpineDepth > 12 && h > 5.8)) return 'rocky_ridge';

    if (freshDist < 5.5 && h <= this.waterLevel + 1.05) return 'riverbank';

    const moisture = this.computeMoisture(x, z, freshDist, aridity);
    if (moisture > 0.65 && h < 3.6 && prairie < 0.46) return 'moss_hollow';

    if (prairie > 0.5 && h < 5.0 && slope < 0.14) return 'prairie';

    const fertility = this.computeFertility(x, z, h, moisture, aridity);
    if (fertility > 0.58 && h < 4.6 && prairie > 0.3) return 'meadow';
    return 'deep_woods';
  }

  /**
   * Exact biome classification given a precomputed elevation `h`, evaluating slope lazily
   * only when elevation/climate alone cannot determine the biome (avoids 4x getHeightAt calls).
   */
  getBiomeAtKnownHeight(x: number, z: number, h: number): BiomeType {
    if (h <= this.waterLevel + 0.05) return 'water';

    const coastDist = this.getCoastSignedDistance(x, z);
    if (coastDist < 20.0 && h < this.waterLevel + 2.6) return 'seashore';

    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, freshDist);
    const aridity = this.tmpAridity;
    const prairie = this.tmpPrairie;

    if (aridity > 0.48 && freshDist > 3.4 && h < 19.0 && alpineDepth < 20) {
      return 'desert';
    }

    if (h > 13.5 || alpineDepth > 58) return 'alpine_crag';
    if (h > 9.5) {
      const slope = this.getSlopeAt(x, z);
      return slope > 0.23 ? 'alpine_crag' : 'rocky_ridge';
    }
    if (h > 7.4 || (alpineDepth > 12 && h > 5.8)) return 'rocky_ridge';

    const slope = this.getSlopeAt(x, z);
    if (slope > 0.25) return 'rocky_ridge';

    if (freshDist < 5.5 && h <= this.waterLevel + 1.05) return 'riverbank';

    const moisture = this.computeMoisture(x, z, freshDist, aridity);
    if (moisture > 0.65 && h < 3.6 && prairie < 0.46) return 'moss_hollow';

    if (prairie > 0.5 && h < 5.0 && slope < 0.14) return 'prairie';

    const fertility = this.computeFertility(x, z, h, moisture, aridity);
    if (fertility > 0.58 && h < 4.6 && prairie > 0.3) return 'meadow';
    return 'deep_woods';
  }

  /**
   * Single-pass biome + climate query for horizon forest placement, reusing precomputed `h`
   * and `coastDist` without repeating amorphous climate evaluation.
   */
  getHorizonBiomeAndClimate(
    x: number,
    z: number,
    h: number,
    coastDist: number,
  ): { biome: BiomeType; aridity: number; prairie: number } {
    const alpineDepth = this.getAlpineDepthAt(x, z);
    const freshDist = this.getFreshwaterDistanceFast(x, z, coastDist, alpineDepth, 56);
    this.sampleAmorphousBiomesToScratch(x, z, coastDist, alpineDepth, freshDist);
    const aridity = this.tmpAridity;
    const prairie = this.tmpPrairie;

    if (aridity > 0.48 && freshDist > 3.4 && h < 19.0 && alpineDepth < 20) {
      return { biome: 'desert', aridity, prairie };
    }
    if (h > 13.5 || alpineDepth > 58) {
      return { biome: 'alpine_crag', aridity, prairie };
    }
    if (aridity > 0.44 || prairie > 0.44) {
      // Callers reject sites with aridity > 0.44 || prairie > 0.44, so no slope query needed
      return { biome: prairie > 0.5 ? 'prairie' : 'deep_woods', aridity, prairie };
    }
    if (h > 9.5) {
      const slope = this.getSlopeAt(x, z);
      return { biome: slope > 0.23 ? 'alpine_crag' : 'rocky_ridge', aridity, prairie };
    }
    if (h > 7.4 || (alpineDepth > 12 && h > 5.8)) {
      return { biome: 'rocky_ridge', aridity, prairie };
    }
    const slope = this.getSlopeAt(x, z);
    if (slope > 0.25) return { biome: 'rocky_ridge', aridity, prairie };
    if (freshDist < 5.5 && h <= this.waterLevel + 1.05) {
      return { biome: 'riverbank', aridity, prairie };
    }
    const moisture = this.computeMoisture(x, z, freshDist, aridity);
    if (moisture > 0.65 && h < 3.6 && prairie < 0.46) {
      return { biome: 'moss_hollow', aridity, prairie };
    }
    const fertility = this.computeFertility(x, z, h, moisture, aridity);
    if (fertility > 0.58 && h < 4.6 && prairie > 0.3) {
      return { biome: 'meadow', aridity, prairie };
    }
    return { biome: 'deep_woods', aridity, prairie };
  }

  getBiomeAt(x: number, z: number): BiomeType {
    const h = this.getHeightAt(x, z);
    return this.getBiomeAtKnownHeight(x, z, h);
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

  /** Circular outer playable safety boundary complementing the front sea & back mountain bounds. */
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
          const slope = this.getSlopeAt(cx, cz);
          if (h < this.waterLevel - 0.65 || this.isImpassableMountainAt(cx, cz, h, slope)) {
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
    const slope = this.getSlopeAt(x, z);
    return !this.isImpassableMountainAt(x, z, h, slope);
  }

  /** Returns true if (x, z) lies inside a playable inland river, tributary, or pond (never deep sea). */
  isSwimmable(x: number, z: number): boolean {
    if (!this.isWithinPlayableArea(x, z)) return false;
    if (this.isDeepSeaAt(x, z)) return false;
    if (this.getCoastSignedDistance(x, z) <= 8) return false;
    return this.getHeightAt(x, z) <= this.waterLevel - 0.28;
  }

  /** Unified terrain traversability check respecting aerial, strictlyAquatic, aquatic, and amphibious traits. */
  canCreatureTraverse(
    x: number,
    z: number,
    def: { aerial: boolean; amphibious: boolean; aquatic?: boolean; strictlyAquatic?: boolean },
  ): boolean {
    if (def.aerial) return !this.isNaturalBoundBlocked(x, z);
    if (def.strictlyAquatic) return this.isSwimmable(x, z);
    if (def.aquatic) return this.isWalkable(x, z, true) || this.isSwimmable(x, z);
    return this.isWalkable(x, z, def.amphibious);
  }

  /** Picks a deterministic swimmable point inside an inland pond or river segment for waterway life. */
  getWaterwaySpot(rng: SeededRandom): Vec2 | null {
    const usePond = this.ponds.length > 0 && rng.chance(0.45);
    if (usePond) {
      for (let i = 0; i < 6; i++) {
        const pond = this.ponds[rng.int(0, this.ponds.length - 1)];
        const ang = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * pond.radius * 0.72;
        const x = pond.x + Math.cos(ang) * r * pond.scaleX;
        const z = pond.z + Math.sin(ang) * r * pond.scaleZ;
        if (this.isSwimmable(x, z)) return { x, z };
      }
    }
    if (this.riverSegments.length > 0) {
      for (let i = 0; i < 12; i++) {
        const seg = this.riverSegments[rng.int(0, this.riverSegments.length - 1)];
        const t = rng.range(0.15, 0.85);
        const x = seg.ax + seg.dx * t;
        const z = seg.az + seg.dz * t;
        if (this.isSwimmable(x, z)) return { x, z };
      }
    }
    return null;
  }

  /**
   * Finds a scenic, spacious inland river bend or woodland pond suitable for founding an aquatic
   * waterway village (beavers, otters, river koi), ensuring ample surrounding swimmable water
   * for lodges, boathouses, waterwheel mills, and floating lily-pad markets.
   */
  findWaterwaySettlementSite(
    existing: readonly Vec2[],
    minSpacing: number,
    maxRadius: number,
    rng: SeededRandom,
    origin?: Vec2,
  ): Vec2 | null {
    const evaluate = (spacing: number): Vec2 | null => {
      const minSpacingSq = spacing * spacing;
      let bestX = 0;
      let bestZ = 0;
      let bestScore = -Infinity;

      const scoreCandidate = (x: number, z: number, baseBonus: number): void => {
        if (Math.hypot(x, z) > maxRadius) return;
        for (const site of existing) {
          const dx = site.x - x;
          const dz = site.z - z;
          if (dx * dx + dz * dz < minSpacingSq) return;
        }
        if (this.getCoastSignedDistance(x, z) < 18) return;
        if (this.getAlpineDepthAt(x, z) > 16) return;
        if (!this.isSwimmable(x, z)) return;

        // Measure surrounding swimmable water area so watery homes & landmarks have plenty of room
        let waterRoom = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI * 2) / 8;
          if (this.isSwimmable(x + Math.cos(a) * 6.0, z + Math.sin(a) * 6.0)) waterRoom += 1.5;
          if (this.isSwimmable(x + Math.cos(a) * 10.5, z + Math.sin(a) * 10.5)) waterRoom += 1.0;
        }
        if (waterRoom < 4.5) return;

        let score = baseBonus + waterRoom * 1.4 + rng.range(-0.4, 0.4);
        if (origin) {
          const d = Math.hypot(x - origin.x, z - origin.z);
          // Favor a scenic, reachable distance from the heartland village (55-185m)
          score += Math.max(0, 14 - Math.abs(d - 105) * 0.11);
        }
        if (score > bestScore) {
          bestScore = score;
          bestX = x;
          bestZ = z;
        }
      };

      // 1. Evaluate woodland lakes & ponds (spacious still-water basins)
      for (const pond of this.ponds) {
        scoreCandidate(pond.x, pond.z, 8.0 + pond.radius * 0.35);
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + 0.35;
          const offR = pond.radius * 0.35;
          scoreCandidate(
            pond.x + Math.cos(a) * offR * pond.scaleX,
            pond.z + Math.sin(a) * offR * pond.scaleZ,
            6.5 + pond.radius * 0.25,
          );
        }
      }

      // 2. Evaluate wide inland river reaches & confluences
      const step = Math.max(1, Math.floor(this.riverSegments.length / 80));
      for (let i = 0; i < this.riverSegments.length; i += step) {
        const seg = this.riverSegments[i];
        const halfW = (seg.halfW0 + seg.halfW1) * 0.5;
        if (halfW < 3.0) continue;
        const cx = seg.ax + seg.dx * 0.5;
        const cz = seg.az + seg.dz * 0.5;
        scoreCandidate(cx, cz, 4.0 + halfW * 1.1 + seg.order * 1.2);
      }

      return bestScore > -Infinity ? { x: bestX, z: bestZ } : null;
    };

    return evaluate(minSpacing) ?? evaluate(minSpacing * 0.6);
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
    maxSearchDist = 96,
  ): Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> | null {
    const maxPlayable = this.playableRadius - 6;
    const deckWidth = 2.6;

    let bestCandidate:
      | (Omit<BridgeInstance, 'id' | 'settlementId' | 'style' | 'progress' | 'completed'> & {
          score: number;
        })
      | null = null;
    let bestScore = -Infinity;

    const evaluateCandidate = (cx: number, cz: number, tx: number, tz: number): void => {
      const distFromOrigin = Math.hypot(cx - originX, cz - originZ);
      if (distFromOrigin > maxSearchDist || Math.hypot(cx, cz) > maxPlayable - 5) return;
      if (this.getCoastSignedDistance(cx, cz) < 12) return;
      if (this.getAlpineDepthAt(cx, cz) > 20) return;
      if (this.getHeightAt(cx, cz) >= this.waterLevel - 0.15) return;

      for (const b of existingBridges) {
        if (Math.hypot(b.centerX - cx, b.centerZ - cz) < 20) return;
      }

      const nx = -tz;
      const nz = tx;

      const findBank = (sign: 1 | -1): { x: number; z: number; y: number } | null => {
        for (let d = 2.4; d <= 22.0; d += 0.8) {
          const bx = cx + nx * sign * d;
          const bz = cz + nz * sign * d;
          const h = this.getHeightAt(bx, bz);
          if (h >= this.waterLevel + 0.34 && this.getSlopeAt(bx, bz) < 0.28) {
            const ax = cx + nx * sign * (d + 1.5);
            const az = cz + nz * sign * (d + 1.5);
            if (Math.hypot(ax, az) > maxPlayable) continue;
            const ay = this.getHeightAt(ax, az);
            if (
              ay >= this.waterLevel + 0.32 &&
              this.getSlopeAt(ax, az) < 0.3 &&
              !this.isImpassableMountainAt(ax, az, ay)
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
      if (length < 7.2 || length > 28.0) return;

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
        Math.min(2.85, 0.9 + length * 0.055),
        minClearCrown - chordMidY,
      );
      const score = -distFromOrigin - length * 0.85 - Math.abs(start.y - end.y) * 3.0;
      if (score > bestScore) {
        bestScore = score;
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

    // Collect in-range meandering river segments, sort closest-first, and cap evaluations so wide
    // searches never perform hundreds of thousands of terrain queries in a single simulation frame.
    const maxDistSq = (maxSearchDist + 14) * (maxSearchDist + 14);
    const candidates: { idx: number; distSq: number }[] = [];
    for (let i = 0; i < this.riverSegments.length; i++) {
      const seg = this.riverSegments[i];
      const mx = seg.ax + seg.dx * 0.5;
      const mz = seg.az + seg.dz * 0.5;
      const ddx = mx - originX;
      const ddz = mz - originZ;
      const distSq = ddx * ddx + ddz * ddz;
      if (distSq > maxDistSq) continue;
      candidates.push({ idx: i, distSq });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distSq - b.distSq);

    const maxEval = 48;
    const step = candidates.length > maxEval ? candidates.length / maxEval : 1;
    for (let k = 0; k < Math.min(candidates.length, maxEval); k++) {
      const entry = candidates[Math.floor(k * step)];
      // Early exit once we already have a strong nearby crossing and remaining segments are far away
      if (k >= 12 && entry.distSq > 55 * 55 && bestScore > -75) {
        break;
      }
      const seg = this.riverSegments[entry.idx];
      const jitterT = rng.range(0.2, 0.8);
      const cx = seg.ax + seg.dx * jitterT;
      const cz = seg.az + seg.dz * jitterT;
      evaluateCandidate(cx, cz, seg.flowX, seg.flowZ);
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
   * welcoming scenic homeland in the central heartland between the back mountains and front sea
   * so emigrants can radiate outward into all 6 environments.
   */
  findSettlementSites(count: number, rng: SeededRandom): Vec2[] {
    const chosen: Vec2[] = [];
    const maxRadius =
      count === 1
        ? Math.min(this.playableRadius - 24, this.halfSize * 0.3)
        : this.playableRadius - 20;

    if (count > 1) {
      const targetOrder: VillageAdaptationId[] = [
        'forest_canopy',
        'coastal_harbor',
        'desert_oasis',
        'prairie_pastoral',
        'mountain_stone',
        'riverside_stilts',
        'waterway_haven',
      ];
      const minSpacing = Math.max(48, this.size * 0.19);
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
        minSpacing: Math.max(44, this.size * 0.19),
        minH: 0.65,
        maxH: 12.0,
        maxSlope: 0.16,
        minWaterDist: 5.0,
        radiusLimit: maxRadius,
      },
      {
        attempts: 900,
        minSpacing: Math.max(32, this.size * 0.15),
        minH: 0.45,
        maxH: 16.0,
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
        if (this.getCoastSignedDistance(x, z) < (count === 1 ? 26 : 6)) continue;
        if (this.getAlpineDepthAt(x, z) > (count === 1 ? 5 : 58)) continue;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        if (h < this.waterLevel + pass.minH || h > pass.maxH || slope > pass.maxSlope) continue;
        if (this.isImpassableMountainAt(x, z, h, slope)) continue;
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
    if (target === 'waterway_haven') {
      return this.findWaterwaySettlementSite(existing, minSpacing, maxRadius, rng, origin);
    }
    const maxSlope = target === 'mountain_stone' ? 0.24 : 0.16;
    const minWaterDist =
      target === 'riverside_stilts' || target === 'coastal_harbor' ? 3.2 : 5.2;
    const minH =
      target === 'riverside_stilts' || target === 'coastal_harbor' ? 0.46 : 0.65;
    // Mountain settlements sit on the mountain edge and climbable foothill slopes, never on impassable peaks
    const maxH = target === 'mountain_stone' ? 25.5 : 12.0;

    const minSpacingSq = minSpacing * minSpacing;
    let best: { x: number; z: number; score: number } | null = null;
    for (let i = 0; i < attempts; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * maxRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // Reject points too close to existing settlements first (O(N) arithmetic, zero noise queries)
      let tooClose = false;
      for (const site of existing) {
        const dx = site.x - x;
        const dz = site.z - z;
        if (dx * dx + dz * dz < minSpacingSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      if (this.isDeepSeaAt(x, z)) continue;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + minH || h > maxH) continue;
      const slope = this.getSlopeAt(x, z);
      if (slope > maxSlope) continue;
      if (this.isImpassableMountainAt(x, z, h, slope)) continue;
      const waterDist = this.getWaterDistance(x, z);
      if (waterDist < minWaterDist) continue;

      const adaptation = this.getSiteAdaptation(x, z);
      if (adaptation !== target) continue;

      let score = -slope * 18;
      if (target === 'coastal_harbor') {
        const cd = this.getCoastSignedDistance(x, z);
        score += Math.max(0, 18 - Math.abs(cd - 8.5)) * 0.7;
      } else if (target === 'riverside_stilts') {
        score += Math.max(0, 14 - waterDist) * 0.65;
      } else if (target === 'mountain_stone') {
        const alpineDepth = this.getAlpineDepthAt(x, z);
        const slopeBand = Math.max(0, 36 - Math.abs(alpineDepth - 22)) * 0.16;
        score += Math.min(18.0, h) * 0.52 + slopeBand;
      } else if (target === 'desert_oasis') {
        score += this.getAridityAt(x, z) * 6.5;
      } else if (target === 'prairie_pastoral') {
        score += this.getPrairieWeightAt(x, z) * 5.5 + this.getFertilityAt(x, z) * 2.5;
      }

      if (origin) {
        const trekDist = Math.hypot(x - origin.x, z - origin.z);
        const frontierBonus = Math.min(240, trekDist) * 0.042 - Math.max(0, trekDist - 360) * 0.025;
        score += frontierBonus;
      }

      if (!best || score > best.score) {
        best = { x, z, score };
        if (i > 280 && score > 3.5) break;
      }
    }

    return best ? { x: best.x, z: best.z } : null;
  }

  /**
   * Finds a fresh dry, buildable clearing for far-wandering emigrating pioneers, actively seeking
   * unrepresented biomes across the continent (front seashore, amorphous deserts/prairies/forests,
   * riversides, and back mountain edges & climbable slopes).
   */
  findNewSettlementSite(
    existingCenters: readonly Vec2[],
    rng: SeededRandom,
    existingAdaptations?: readonly VillageAdaptationId[],
    origin?: Vec2,
  ): Vec2 | null {
    const maxRadius = this.playableRadius - 18;
    const minSpacing = Math.max(52, this.size * 0.14);

    if (existingAdaptations) {
      const present = new Set(existingAdaptations);
      const missing = ALL_VILLAGE_ADAPTATIONS.filter((a) => !present.has(a));
      if (missing.length > 0) {
        const candidates = [...missing];
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const tmp = candidates[i];
          candidates[i] = candidates[j];
          candidates[j] = tmp;
        }
        const maxAdaptChecks = Math.min(3, candidates.length);
        for (let idx = 0; idx < maxAdaptChecks; idx++) {
          const desired = candidates[idx];
          const specialized = this.findSiteForAdaptation(
            desired,
            existingCenters,
            minSpacing,
            maxRadius,
            rng,
            320,
            origin,
          );
          if (specialized) return specialized;
        }
      }
    }

    const passes = [
      {
        attempts: 300,
        minSpacing,
        minH: 0.55,
        maxH: 15.5,
        maxSlope: 0.18,
        minWaterDist: 4.5,
      },
      {
        attempts: 240,
        minSpacing: Math.max(36, this.size * 0.12),
        minH: 0.42,
        maxH: 18.0,
        maxSlope: 0.22,
        minWaterDist: 3.0,
      },
    ];

    let bestFallback: { x: number; z: number; score: number } | null = null;
    for (const pass of passes) {
      const passSpacingSq = pass.minSpacing * pass.minSpacing;
      for (let attempt = 0; attempt < pass.attempts; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;

        let tooClose = false;
        for (const site of existingCenters) {
          const dx = site.x - x;
          const dz = site.z - z;
          if (dx * dx + dz * dz < passSpacingSq) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        if (this.getCoastSignedDistance(x, z) < 5.0) continue;
        const h = this.getHeightAt(x, z);
        if (h < this.waterLevel + pass.minH || h > pass.maxH) continue;
        const slope = this.getSlopeAt(x, z);
        if (slope > pass.maxSlope) continue;
        if (this.isImpassableMountainAt(x, z, h, slope)) continue;
        if (this.getWaterDistance(x, z) < pass.minWaterDist) continue;

        const trekDist = origin ? Math.hypot(x - origin.x, z - origin.z) : 110;
        const score =
          Math.min(220, trekDist) * 0.06 - Math.max(0, trekDist - 360) * 0.025 - slope * 15;
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

  /** O(1) lookup for a resource node by id (falls back to scan if mutated externally). */
  getResourceNode(id: string | null): ResourceNode | undefined {
    if (!id) return undefined;
    const hit = this.resourceNodeById.get(id);
    return hit ?? this.resourceNodes.find((n) => n.id === id);
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
    const areaScale = Math.pow(this.size / 160, 1.38);
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
      const maxTries = spec.count * 24;
      for (let tries = 0; tries < maxTries && placed < spec.count; tries++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxRadius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (this.isDeepSeaAt(x, z)) continue;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        if (h < this.waterLevel + 0.35 || slope > 0.32 || this.isImpassableMountainAt(x, z, h, slope)) {
          continue;
        }
        const biome = this.getBiomeAtSample(x, z, h, slope);
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
          rng.chance(0.68)
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

        const node: ResourceNode = {
          id: `res_${idx++}`,
          type: spec.type,
          position: { x, z },
          amount: spec.max * rng.range(0.7, 1.0),
          maxAmount: spec.max,
          regenRate: spec.regen,
        };
        this.resourceNodes.push(node);
        this.resourceNodeById.set(node.id, node);
        placed++;
      }
    }
  }

  private generateFloraAndRocks(config: WorldConfig, rng: SeededRandom): void {
    const treeRadius = this.halfSize + 24;
    const propRadius = this.halfSize + 10;

    // Spatial hash grid for O(1) tree spacing checks across vast dense woodlands
    const cellSize = 4.0;
    const treeGrid = new Map<number, TreeSpot[]>();
    const gridKey = (cx: number, cz: number) => (cx + 1024) * 2048 + (cz + 1024);

    // 1. Trees: dense, lush old-growth forests, timberline mountain pines, riverside birches;
    //    strictly treeless prairies and arid sandy deserts!
    let attempts = 0;
    while (this.trees.length < config.treeCount && attempts < config.treeCount * 30) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * treeRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      // Bare snow-crowned alpine peaks above treeline (24m)
      if (h < this.waterLevel + 0.45 || h > 24.0) continue;
      const slope = this.getSlopeAt(x, z);
      if (slope > 0.28) continue;

      const biome = this.getBiomeAtSample(x, z, h, slope);
      if (biome === 'water' || biome === 'prairie' || biome === 'desert') continue;
      if (biome === 'seashore' && rng.chance(0.88)) continue;
      if (biome === 'meadow' && rng.chance(0.76)) continue;
      if (biome === 'rocky_ridge' && rng.chance(0.38)) continue;
      if (biome === 'alpine_crag' && rng.chance(0.86)) continue;

      // Interlocking lush canopy spacing in deep_woods & moss_hollow, airier elsewhere
      const minSpacing = biome === 'deep_woods' || biome === 'moss_hollow' ? 2.85 : 3.55;
      const minSpacingSq = minSpacing * minSpacing;
      const cx = Math.floor(x / cellSize);
      const cz = Math.floor(z / cellSize);

      let crowded = false;
      for (let gx = cx - 1; gx <= cx + 1 && !crowded; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const bucket = treeGrid.get(gridKey(gx, gz));
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const existing = bucket[k];
            const dx = existing.x - x;
            const dz = existing.z - z;
            if (dx * dx + dz * dz < minSpacingSq) {
              crowded = true;
              break;
            }
          }
          if (crowded) break;
        }
      }
      if (crowded) continue;

      const kind: TreeSpot['kind'] =
        biome === 'rocky_ridge' || biome === 'alpine_crag' || biome === 'seashore'
          ? rng.chance(0.88)
            ? 'pine'
            : 'oak'
          : biome === 'riverbank' || biome === 'moss_hollow'
            ? rng.chance(0.52)
              ? 'birch'
              : 'oak'
            : biome === 'meadow'
              ? rng.chance(0.56)
                ? 'birch'
                : 'oak'
              : rng.pick(['oak', 'oak', 'oak', 'pine', 'pine', 'birch']);

      const scale =
        biome === 'alpine_crag'
          ? rng.range(0.58, 0.94)
          : biome === 'seashore'
            ? rng.range(0.7, 1.1)
            : biome === 'deep_woods' || biome === 'moss_hollow'
              ? rng.range(0.96, 1.72)
              : rng.range(0.85, 1.48);

      const spot: TreeSpot = {
        x,
        z,
        y: h,
        scale,
        rotation: rng.range(0, Math.PI * 2),
        kind,
      };
      this.trees.push(spot);
      const key = gridKey(cx, cz);
      let bucket = treeGrid.get(key);
      if (!bucket) {
        bucket = [];
        treeGrid.set(key, bucket);
      }
      bucket.push(spot);
    }

    // 2. Lush woodland undergrowth: arching ferns (0), plump berry bushes (1), toadstools (2)
    //    Strictly absent from arid deserts and kept out of open treeless flat prairies!
    attempts = 0;
    while (
      this.undergrowth.length < config.undergrowthCount &&
      attempts < config.undergrowthCount * 18
    ) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel + 0.25 || h > 16.5) continue;
      const slope = this.getSlopeAt(x, z);
      if (slope > 0.3) continue;

      const biome = this.getBiomeAtSample(x, z, h, slope);
      if (biome === 'water' || biome === 'desert') continue;
      if (biome === 'prairie' && rng.chance(0.97)) continue;
      if (biome === 'seashore' && rng.chance(0.9)) continue;
      if (biome === 'alpine_crag' && rng.chance(0.92)) continue;
      if (biome === 'rocky_ridge' && rng.chance(0.62)) continue;

      let variant: number;
      if (biome === 'moss_hollow') {
        variant = rng.chance(0.5) ? 0 : rng.chance(0.65) ? 2 : 1;
      } else if (biome === 'deep_woods') {
        variant = rng.chance(0.48) ? 0 : rng.chance(0.62) ? 1 : 2;
      } else if (biome === 'meadow' || biome === 'prairie') {
        variant = rng.chance(0.76) ? 1 : 0;
      } else if (biome === 'rocky_ridge' || biome === 'alpine_crag' || biome === 'seashore') {
        variant = rng.chance(0.65) ? 1 : 0;
      } else {
        variant = rng.int(0, 2);
      }

      const scale =
        biome === 'deep_woods' || biome === 'moss_hollow'
          ? rng.range(0.72, 1.56)
          : rng.range(0.55, 1.28);

      this.undergrowth.push({
        x,
        z,
        y: h,
        scale,
        rotation: rng.range(0, Math.PI * 2),
        variant,
      });
    }

    // 3. Craggy alpine granite outcrops, desert sandstone spires, coastal stacks & mossy forest stones
    attempts = 0;
    while (this.rocks.length < config.rockCount && attempts < config.rockCount * 16) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * propRadius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = this.getHeightAt(x, z);
      if (h < this.waterLevel - 0.1) continue;
      const slope = this.getSlopeAt(x, z);
      const biome = this.getBiomeAtSample(x, z, h, slope);
      if (biome === 'water') continue;
      if (biome === 'prairie' && rng.chance(0.96)) continue;
      if (
        biome !== 'rocky_ridge' &&
        biome !== 'alpine_crag' &&
        biome !== 'desert' &&
        biome !== 'seashore' &&
        biome !== 'riverbank' &&
        rng.chance(0.84)
      ) {
        continue;
      }
      const scale =
        biome === 'alpine_crag'
          ? rng.range(1.15, 3.4)
          : biome === 'rocky_ridge' || biome === 'desert'
            ? rng.range(0.88, 2.75)
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
