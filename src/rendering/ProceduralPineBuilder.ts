import * as THREE from 'three';
import type { BiomeType } from '@core/Types';
import type { TreeSpot } from '@simulation/terrain/TerrainMap';
import { mergePartGeometries } from './GeometryHelpers';

export const PINE_FROND_TYPE_COUNT = 3;

export type PineBotanicalHabit =
  | 'spruce'
  | 'scots'
  | 'alpine_fir'
  | 'old_growth'
  | 'wind_ridge'
  | 'sapling';

export interface ProceduralPineSpec {
  readonly seed: number;
  readonly habit: PineBotanicalHabit;
  readonly height: number;
  readonly crownStart: number;
  readonly crownEnd: number;
  readonly baseRadius: number;
  readonly leanX: number;
  readonly leanZ: number;
  readonly midBendX: number;
  readonly midBendZ: number;
  readonly upperBendX: number;
  readonly upperBendZ: number;
  readonly rootLobes: number;
  readonly rootPhase: number;
  readonly hasFork: boolean;
  readonly forkStartFrac: number;
  readonly forkAngle: number;
  readonly forkSpread: number;
  readonly forkHeightFrac: number;
  readonly whorlCount: number;
  readonly whorlSpacingPow: number;
  readonly baseBoughLen: number;
  readonly topBoughLen: number;
  readonly boughWidthRatio: number;
  readonly taperPow: number;
  readonly umbrellaFlatness: number;
  readonly pitchBase: number;
  readonly pitchTop: number;
  readonly windFlagAngle: number;
  readonly windFlagStrength: number;
  readonly gapChance: number;
  readonly stormGapAngle: number;
  readonly stormGapStrength: number;
  readonly deadStubCount: number;
  readonly spireHeight: number;
  readonly tintR: number;
  readonly tintG: number;
  readonly tintB: number;
}

export interface PineTrunkRange {
  readonly start: number;
  readonly count: number;
}

export interface PineBoughRange {
  readonly meshIndex: number;
  readonly start: number;
  readonly count: number;
}

export interface ProceduralPineForestResult {
  readonly trunksMesh: THREE.Mesh;
  readonly frondMeshes: readonly THREE.InstancedMesh[];
  readonly disposables: THREE.BufferGeometry[];
  readonly spots: readonly TreeSpot[];
  readonly clearTree: (index: number) => void;
  readonly flushCleared: () => void;
  readonly totalBoughInstances: number;
}

export interface HorizonPinePlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly biome: BiomeType;
  readonly seed: number;
}

export interface ProceduralHorizonPinesResult {
  readonly foliageMeshes: readonly THREE.InstancedMesh[];
  readonly trunkMesh: THREE.InstancedMesh;
  readonly disposables: THREE.BufferGeometry[];
}

/** Fast deterministic per-tree PRNG (Mulberry32). */
function createTreeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashPineSeed(x: number, z: number, index: number): number {
  const xi = Math.imul(Math.round(x * 13.7), 374761393);
  const zi = Math.imul(Math.round(z * 17.3), 668265263);
  const ii = Math.imul(index + 1, 2147483647);
  let h = (xi ^ zi ^ ii ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Generates a unique continuous botanical profile for an individual pine/conifer
 * based on its exact world coordinates, biome, elevation, and coastal exposure.
 * No two trees share the same height, trunk curve, whorl layout, gaps, fork, or tint.
 */
export function generateProceduralPineSpec(
  spot: Pick<TreeSpot, 'x' | 'y' | 'z' | 'scale' | 'rotation'>,
  index: number,
  biome: BiomeType,
  coastDist: number,
): ProceduralPineSpec {
  const seed = hashPineSeed(spot.x, spot.z, index);
  const rng = createTreeRng(seed);
  const range = (lo: number, hi: number): number => lo + rng() * (hi - lo);

  // Biome-informed botanical habit selection (with natural ecological overlap)
  const hRoll = rng();
  let habit: PineBotanicalHabit;
  if (biome === 'seashore' || (coastDist < 42 && spot.y < 4.5)) {
    habit = hRoll < 0.56 ? 'wind_ridge' : hRoll < 0.84 ? 'scots' : 'spruce';
  } else if (biome === 'rocky_ridge' || biome === 'alpine_crag' || spot.y > 10.5) {
    habit =
      hRoll < 0.36
        ? 'alpine_fir'
        : hRoll < 0.66
          ? 'wind_ridge'
          : hRoll < 0.84
            ? 'spruce'
            : hRoll < 0.94
              ? 'scots'
              : 'sapling';
  } else if (biome === 'deep_woods' || biome === 'moss_hollow') {
    habit =
      hRoll < 0.30
        ? 'old_growth'
        : hRoll < 0.56
          ? 'scots'
          : hRoll < 0.80
            ? 'spruce'
            : hRoll < 0.91
              ? 'alpine_fir'
              : 'wind_ridge';
  } else {
    habit =
      hRoll < 0.25
        ? 'spruce'
        : hRoll < 0.46
          ? 'scots'
          : hRoll < 0.65
            ? 'alpine_fir'
            : hRoll < 0.80
              ? 'old_growth'
              : hRoll < 0.91
                ? 'wind_ridge'
                : 'sapling';
  }

  // Continuous morphological ranges tailored to each botanical habit
  let height: number;
  let crownStartFrac: number;
  let crownEndFrac: number;
  let baseRadius: number;
  let leanMag: number;
  let whorlCount: number;
  let whorlSpacingPow: number;
  let baseBoughLen: number;
  let topBoughLen: number;
  let boughWidthRatio: number;
  let taperPow: number;
  let umbrellaFlatness: number;
  let pitchBase: number;
  let pitchTop: number;
  let windFlagStrength: number;
  let gapChance: number;
  let deadStubCount: number;
  let spireHeight: number;
  let forkProb: number;

  if (habit === 'scots') {
    // Tall mature Scots / Ponderosa pine: long bare lower trunk, dead snags, broad sunlit umbrella crown
    height = range(8.4, 11.8);
    crownStartFrac = range(0.45, 0.63);
    crownEndFrac = range(0.92, 0.99);
    baseRadius = range(0.32, 0.46);
    leanMag = range(0.16, 0.72);
    whorlCount = Math.round(range(5, 8));
    whorlSpacingPow = range(0.74, 1.02);
    baseBoughLen = range(2.35, 3.65);
    topBoughLen = range(1.35, 2.25);
    boughWidthRatio = range(0.58, 0.76);
    taperPow = range(0.48, 0.74);
    umbrellaFlatness = range(0.68, 1.0);
    pitchBase = range(-0.08, 0.16);
    pitchTop = range(-0.34, -0.14);
    windFlagStrength = range(0.06, 0.26);
    gapChance = range(0.10, 0.24);
    deadStubCount = Math.round(range(2, 5));
    spireHeight = 0;
    forkProb = 0.28;
  } else if (habit === 'alpine_fir') {
    // Slender high-altitude subalpine fir: narrow columnar spire, low snow-shedding skirts
    height = range(8.2, 12.2);
    crownStartFrac = range(0.11, 0.23);
    crownEndFrac = range(0.92, 0.98);
    baseRadius = range(0.24, 0.36);
    leanMag = range(0.04, 0.26);
    whorlCount = Math.round(range(9, 13));
    whorlSpacingPow = range(0.86, 1.12);
    baseBoughLen = range(1.35, 2.05);
    topBoughLen = range(0.36, 0.64);
    boughWidthRatio = range(0.56, 0.74);
    taperPow = range(0.82, 1.18);
    umbrellaFlatness = range(0.0, 0.12);
    pitchBase = range(0.32, 0.58);
    pitchTop = range(-0.30, -0.06);
    windFlagStrength = range(0.03, 0.14);
    gapChance = range(0.08, 0.20);
    deadStubCount = rng() < 0.35 ? 1 : 0;
    spireHeight = range(1.25, 2.05);
    forkProb = 0.08;
  } else if (habit === 'old_growth') {
    // Towering old-growth Douglas fir / cedar: massive irregular sweeping boughs & thick buttressed trunk
    height = range(9.4, 12.8);
    crownStartFrac = range(0.17, 0.34);
    crownEndFrac = range(0.90, 0.97);
    baseRadius = range(0.44, 0.60);
    leanMag = range(0.08, 0.42);
    whorlCount = Math.round(range(8, 12));
    whorlSpacingPow = range(0.82, 1.08);
    baseBoughLen = range(2.85, 3.95);
    topBoughLen = range(0.92, 1.55);
    boughWidthRatio = range(0.54, 0.72);
    taperPow = range(0.68, 1.04);
    umbrellaFlatness = range(0.22, 0.56);
    pitchBase = range(0.16, 0.38);
    pitchTop = range(-0.28, -0.08);
    windFlagStrength = range(0.05, 0.22);
    gapChance = range(0.14, 0.28);
    deadStubCount = Math.round(range(1, 4));
    spireHeight = rng() < 0.55 ? range(0.55, 1.15) : 0;
    forkProb = 0.24;
  } else if (habit === 'wind_ridge') {
    // Wind-sculpted coastal / ridge pine: crooked leaning trunk, downwind-flagged boughs, open storm gaps
    height = range(6.6, 9.8);
    crownStartFrac = range(0.28, 0.48);
    crownEndFrac = range(0.88, 0.97);
    baseRadius = range(0.30, 0.46);
    leanMag = range(0.48, 1.38);
    whorlCount = Math.round(range(5, 9));
    whorlSpacingPow = range(0.72, 1.06);
    baseBoughLen = range(2.15, 3.25);
    topBoughLen = range(0.88, 1.65);
    boughWidthRatio = range(0.58, 0.76);
    taperPow = range(0.56, 0.92);
    umbrellaFlatness = range(0.32, 0.82);
    pitchBase = range(0.02, 0.28);
    pitchTop = range(-0.28, -0.04);
    windFlagStrength = range(0.30, 0.56);
    gapChance = range(0.18, 0.34);
    deadStubCount = Math.round(range(2, 5));
    spireHeight = rng() < 0.42 ? range(0.45, 0.95) : 0;
    forkProb = 0.22;
  } else if (habit === 'sapling') {
    // Young / mid-growth irregular conifer
    height = range(5.8, 8.2);
    crownStartFrac = range(0.14, 0.28);
    crownEndFrac = range(0.90, 0.97);
    baseRadius = range(0.20, 0.30);
    leanMag = range(0.05, 0.32);
    whorlCount = Math.round(range(6, 9));
    whorlSpacingPow = range(0.85, 1.15);
    baseBoughLen = range(1.55, 2.45);
    topBoughLen = range(0.42, 0.76);
    boughWidthRatio = range(0.58, 0.76);
    taperPow = range(0.78, 1.16);
    umbrellaFlatness = range(0.0, 0.14);
    pitchBase = range(0.14, 0.36);
    pitchTop = range(-0.34, -0.14);
    windFlagStrength = range(0.04, 0.18);
    gapChance = range(0.10, 0.22);
    deadStubCount = rng() < 0.25 ? 1 : 0;
    spireHeight = range(0.95, 1.55);
    forkProb = 0.06;
  } else {
    // Classic irregular woodland Norway spruce: drooping feathered boughs, varied natural gaps
    height = range(7.8, 11.2);
    crownStartFrac = range(0.17, 0.32);
    crownEndFrac = range(0.91, 0.97);
    baseRadius = range(0.30, 0.44);
    leanMag = range(0.06, 0.38);
    whorlCount = Math.round(range(7, 11));
    whorlSpacingPow = range(0.84, 1.10);
    baseBoughLen = range(2.25, 3.25);
    topBoughLen = range(0.55, 0.98);
    boughWidthRatio = range(0.56, 0.74);
    taperPow = range(0.76, 1.12);
    umbrellaFlatness = range(0.04, 0.24);
    pitchBase = range(0.20, 0.44);
    pitchTop = range(-0.28, -0.06);
    windFlagStrength = range(0.05, 0.20);
    gapChance = range(0.12, 0.26);
    deadStubCount = rng() < 0.55 ? Math.round(range(1, 3)) : 0;
    spireHeight = range(0.95, 1.65);
    forkProb = 0.14;
  }

  // Coherent prevailing breeze direction on ridges/coast with organic local swirl
  const leanAngle =
    habit === 'wind_ridge' ? range(-0.65, 0.85) : range(0, Math.PI * 2);
  const leanX = Math.cos(leanAngle) * leanMag;
  const leanZ = Math.sin(leanAngle) * leanMag;
  const midBendX = leanX * range(0.22, 0.55) + range(-0.24, 0.24);
  const midBendZ = leanZ * range(0.22, 0.55) + range(-0.24, 0.24);
  const upperBendX = leanX * range(0.62, 0.94) + range(-0.22, 0.22);
  const upperBendZ = leanZ * range(0.62, 0.94) + range(-0.22, 0.22);

  const hasFork = rng() < forkProb;
  const forkStartFrac = range(0.54, 0.74);
  const forkAngle = range(0, Math.PI * 2);
  const forkSpread = range(0.75, 1.65);
  const forkHeightFrac = range(0.84, 0.99);

  // Continuous natural conifer chlorophyll color spectrum (blue-spruce -> hemlock -> olive Scots pine)
  const speciesTemp =
    habit === 'alpine_fir'
      ? range(-0.14, 0.04) // cooler silvery blue-green
      : habit === 'scots'
        ? range(0.02, 0.18) // warmer olive-pine green
        : habit === 'old_growth'
          ? range(-0.08, 0.05) // deep Pacific hemlock/fir green
          : range(-0.10, 0.12);
  const valueShift = range(0.84, 1.14);
  const tintR = clamp((0.96 + speciesTemp * 0.95) * valueShift, 0.72, 1.24);
  const tintG = clamp((1.01 + speciesTemp * 0.25) * valueShift, 0.78, 1.22);
  const tintB = clamp((0.93 - speciesTemp * 0.85) * valueShift, 0.72, 1.22);

  return {
    seed,
    habit,
    height,
    crownStart: height * crownStartFrac,
    crownEnd: height * crownEndFrac,
    baseRadius,
    leanX,
    leanZ,
    midBendX,
    midBendZ,
    upperBendX,
    upperBendZ,
    rootLobes: Math.round(range(3, 6)),
    rootPhase: range(0, Math.PI * 2),
    hasFork,
    forkStartFrac,
    forkAngle,
    forkSpread,
    forkHeightFrac,
    whorlCount,
    whorlSpacingPow,
    baseBoughLen,
    topBoughLen,
    boughWidthRatio,
    taperPow,
    umbrellaFlatness,
    pitchBase,
    pitchTop,
    windFlagAngle: leanAngle + range(-0.45, 0.45),
    windFlagStrength,
    gapChance,
    stormGapAngle: range(0, Math.PI * 2),
    stormGapStrength: rng() < 0.42 ? range(0.28, 0.65) : 0,
    deadStubCount,
    spireHeight,
    tintR,
    tintG,
    tintB,
  };
}

/**
 * Creates a gently arched/cupped leaf-spray card oriented with stem at (0,0,0),
 * tip at +Z (z = 0..length), and edges gently drooping in -Y.
 */
function createOrientedBoughCard(
  width: number,
  length: number,
  widthSegs: number,
  lengthSegs: number,
  cupY: number,
  archDroop: number,
  tipLift: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, length, widthSegs, lengthSegs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const innerCol = new THREE.Color(0x46523e);
  const midCol = new THREE.Color(0xbac6ac);
  const tipCol = new THREE.Color(0xf8faf4);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i); // -length/2 (stem) .. +length/2 (tip)
    const t = clamp((py + length * 0.5) / Math.max(0.001, length), 0, 1);
    const u = px / Math.max(0.001, width * 0.5); // -1..+1 across width

    // Map plane Y -> +Z (outward along bough), droop gracefully along length, lift slightly at tip
    const zOut = t * length;
    const crossCup = -(u * u) * cupY * (0.35 + 0.65 * Math.sin(t * Math.PI));
    const spineCurve = -Math.sin(t * Math.PI * 0.82) * archDroop + t * t * tipLift;
    const yOut = crossCup + spineCurve;

    pos.setXYZ(i, px, yOut, zOut);
    uv.setXY(i, u * 0.5 + 0.5, t);

    // Rich inner-stem-to-sunlit-tip AO baked into vertex color
    const ao = clamp(0.18 + t * 0.72 + (1 - Math.abs(u)) * 0.14, 0, 1);
    if (ao < 0.5) {
      c.copy(innerCol).lerp(midCol, ao * 2);
    } else {
      c.copy(midCol).lerp(tipCol, (ao - 0.5) * 2);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.computeVertexNormals();
  // Blend normals smoothly outward (+Z) & skyward (+Y) so boughs catch volumetric crown sunlight
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  const softDir = new THREE.Vector3();
  for (let i = 0; i < norm.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = clamp(z / Math.max(0.001, length), 0, 1);
    n.fromBufferAttribute(norm, i);
    softDir.set((x / Math.max(0.001, width)) * 0.45, 0.78 - t * 0.12, 0.58 + t * 0.35).normalize();
    n.lerp(softDir, 0.72).normalize();
    norm.setXYZ(i, n.x, n.y, n.z);
  }
  norm.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Builds one of 3 reusable unit-scale botanical pine frond-spray geometries:
 *   0 — Feathered drooping spruce/fir bough spray (main arched card + 2 angled 3D cross-vanes)
 *   1 — Tufted Scots/Ponderosa pine sunlit umbrella pad (4 layered rosette cards)
 *   2 — Feathered vertical evergreen leader spire (3 crossed upright needle plumes along +Y)
 */
export function createPineFrondGeo(type: 0 | 1 | 2): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  if (type === 0) {
    // Main horizontal-draping feathered pine spray (unit width & length, 8 tris)
    parts.push(createOrientedBoughCard(1.0, 1.0, 2, 2, 0.14, 0.10, 0.09));
    // Two angled 3D cross-vanes (4 tris each) for rich depth from ground POV & overhead
    for (const roll of [0.62, -0.62]) {
      const vane = createOrientedBoughCard(0.78, 0.95, 2, 1, 0.07, 0.07, 0.06);
      vane.rotateZ(roll);
      vane.translate(0, 0.02, 0.04);
      parts.push(vane);
    }
  } else if (type === 1) {
    // Broad layered Scots / Ponderosa pine needle-pad cushion (4 fanned cupped sprays)
    const angles = [0, 0.52, -0.52, Math.PI * 0.96];
    const lengths = [1.0, 0.86, 0.86, 0.62];
    const lifts = [0.14, 0.10, 0.10, 0.08];
    for (let i = 0; i < angles.length; i++) {
      const card = createOrientedBoughCard(1.08, lengths[i], 2, 1, 0.12, 0.05, lifts[i]);
      card.rotateY(angles[i]);
      card.translate(0, i === 0 ? 0.06 : 0.0, 0.08);
      parts.push(card);
    }
  } else {
    // Feathered upright vertical leader spire extending along +Y (0..1)
    for (let i = 0; i < 3; i++) {
      const spire = createOrientedBoughCard(0.92, 1.0, 1, 2, 0.07, 0.0, 0.0);
      spire.rotateX(-Math.PI / 2); // map +Z -> +Y (pointing skyward)
      spire.rotateY((i / 3) * Math.PI);
      parts.push(spire);
    }
  }

  return mergePartGeometries(parts, true);
}

/**
 * Creates 2 ultra-lightweight distant horizon conifer tier geometries:
 *   0 — Crossed drooping conifer whorl tier (12 tris)
 *   1 — Flat-topped Scots-pine crown pad (8 tris)
 */
function createHorizonConiferTierGeo(type: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (type === 0) {
    // 3 steeply draped crossed skirt cards + 1 upright cross-card for full horizon skyline volume
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const card = createOrientedBoughCard(1.25, 1.15, 1, 1, 0.12, 0.10, 0.02);
      card.translate(0, 0, -0.55);
      card.rotateX(0.52);
      card.rotateY(a);
      parts.push(card);
    }
    const core = createOrientedBoughCard(1.1, 0.85, 1, 1, 0.05, 0.0, 0.0);
    core.rotateX(-Math.PI / 2);
    core.translate(0, -0.35, 0);
    parts.push(core);
  } else {
    // Broad layered Scots-pine umbrella crown pad (both top volume and side depth)
    for (let i = 0; i < 2; i++) {
      const card = createOrientedBoughCard(1.45, 1.35, 1, 1, 0.16, 0.04, 0.08);
      card.translate(0, i * 0.12, -0.675);
      card.rotateX(i === 0 ? 0.18 : -0.14);
      card.rotateY(i * (Math.PI * 0.5) + 0.35);
      parts.push(card);
    }
  }
  return mergePartGeometries(parts, true);
}

/** Lightweight growable typed-array geometry writer for zero-GC direct trunk meshing. */
class DirectMeshWriter {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertCount = 0;
  indexCount = 0;

  constructor(initialVerts: number, initialIndices: number) {
    this.positions = new Float32Array(initialVerts * 3);
    this.normals = new Float32Array(initialVerts * 3);
    this.uvs = new Float32Array(initialVerts * 2);
    this.indices = new Uint32Array(initialIndices);
  }

  private ensureVertCapacity(extra: number): void {
    const needed = this.vertCount + extra;
    if (needed * 3 <= this.positions.length) return;
    let nextVerts = Math.max(needed, Math.floor((this.positions.length / 3) * 1.6));
    const p = new Float32Array(nextVerts * 3);
    p.set(this.positions);
    this.positions = p;
    const n = new Float32Array(nextVerts * 3);
    n.set(this.normals);
    this.normals = n;
    const u = new Float32Array(nextVerts * 2);
    u.set(this.uvs);
    this.uvs = u;
  }

  private ensureIndexCapacity(extra: number): void {
    const needed = this.indexCount + extra;
    if (needed <= this.indices.length) return;
    const nextLen = Math.max(needed, Math.floor(this.indices.length * 1.6));
    const idx = new Uint32Array(nextLen);
    idx.set(this.indices);
    this.indices = idx;
  }

  /**
   * Appends a smooth curved tapered tube directly into world space without intermediate allocations.
   */
  appendTube(
    pts: readonly THREE.Vector3[],
    radialSegs: number,
    radiusAt: (t: number, angle: number) => number,
    vScale = 1.0,
  ): void {
    const rings = pts.length;
    if (rings < 2) return;
    const stride = radialSegs + 1;
    const addedVerts = rings * stride;
    const addedIndices = (rings - 1) * radialSegs * 6;
    this.ensureVertCapacity(addedVerts);
    this.ensureIndexCapacity(addedIndices);

    const baseVert = this.vertCount;
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const upRef = new THREE.Vector3();

    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const p = pts[i];
      if (i === 0) {
        tangent.subVectors(pts[1], pts[0]);
      } else if (i === rings - 1) {
        tangent.subVectors(pts[i], pts[i - 1]);
      } else {
        tangent.subVectors(pts[i + 1], pts[i - 1]);
      }
      if (tangent.lengthSq() < 1e-8) {
        tangent.set(0, 1, 0);
      } else {
        tangent.normalize();
      }

      if (Math.abs(tangent.y) < 0.92) {
        upRef.set(0, 1, 0);
      } else {
        upRef.set(1, 0, 0);
      }
      right.crossVectors(upRef, tangent).normalize();
      forward.crossVectors(tangent, right).normalize();

      for (let j = 0; j <= radialSegs; j++) {
        const u = j / radialSegs;
        const angle = u * Math.PI * 2;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const nx = ca * right.x + sa * forward.x;
        const ny = ca * right.y + sa * forward.y;
        const nz = ca * right.z + sa * forward.z;
        const r = Math.max(0.008, radiusAt(t, angle));

        const vi = this.vertCount;
        const v3 = vi * 3;
        const v2 = vi * 2;
        this.positions[v3] = p.x + nx * r;
        this.positions[v3 + 1] = p.y + ny * r;
        this.positions[v3 + 2] = p.z + nz * r;
        this.normals[v3] = nx;
        this.normals[v3 + 1] = ny;
        this.normals[v3 + 2] = nz;
        this.uvs[v2] = u;
        this.uvs[v2 + 1] = t * vScale;
        this.vertCount++;
      }
    }

    for (let i = 0; i < rings - 1; i++) {
      const rowA = baseVert + i * stride;
      const rowB = baseVert + (i + 1) * stride;
      for (let j = 0; j < radialSegs; j++) {
        const a = rowA + j;
        const b = rowB + j;
        const c = rowB + j + 1;
        const d = rowA + j + 1;
        this.indices[this.indexCount++] = a;
        this.indices[this.indexCount++] = b;
        this.indices[this.indexCount++] = d;
        this.indices[this.indexCount++] = b;
        this.indices[this.indexCount++] = c;
        this.indices[this.indexCount++] = d;
      }
    }
  }

  toBufferGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions.subarray(0, this.vertCount * 3), 3),
    );
    geo.setAttribute(
      'normal',
      new THREE.BufferAttribute(this.normals.subarray(0, this.vertCount * 3), 3),
    );
    geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.uvs.subarray(0, this.vertCount * 2), 2),
    );
    geo.setIndex(new THREE.BufferAttribute(this.indices.subarray(0, this.indexCount), 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

class BoughBucket {
  matrices: Float32Array;
  colors: Float32Array;
  wind: Float32Array;
  count = 0;
  private cap: number;

  constructor(initialCap: number) {
    this.cap = Math.max(64, initialCap);
    this.matrices = new Float32Array(this.cap * 16);
    this.colors = new Float32Array(this.cap * 3);
    this.wind = new Float32Array(this.cap * 3);
  }

  push(
    matElements: ArrayLike<number>,
    r: number,
    g: number,
    b: number,
    wx: number,
    wz: number,
    sway: number,
  ): void {
    if (this.count >= this.cap) {
      const nextCap = this.cap * 2;
      const nextMat = new Float32Array(nextCap * 16);
      nextMat.set(this.matrices);
      this.matrices = nextMat;
      const nextCol = new Float32Array(nextCap * 3);
      nextCol.set(this.colors);
      this.colors = nextCol;
      const nextWind = new Float32Array(nextCap * 3);
      nextWind.set(this.wind);
      this.wind = nextWind;
      this.cap = nextCap;
    }
    const idx = this.count++;
    const mOff = idx * 16;
    for (let k = 0; k < 16; k++) {
      this.matrices[mOff + k] = matElements[k];
    }
    const cOff = idx * 3;
    this.colors[cOff] = r;
    this.colors[cOff + 1] = g;
    this.colors[cOff + 2] = b;
    this.wind[cOff] = wx;
    this.wind[cOff + 1] = wz;
    this.wind[cOff + 2] = sway;
  }
}

/**
 * Evaluates a cubic Bezier / organic 4-point spline directly in world space for a pine trunk.
 */
function sampleTrunkPoint(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  const b0 = u2 * u;
  const b1 = 3 * u2 * t;
  const b2 = 3 * u * t2;
  const b3 = t2 * t;
  out.set(
    b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
  );
  return out;
}

/**
 * Builds an entire forest of 100% procedurally unique playable pine/conifer trees.
 * Every single pine gets its own unique curved trunk, buttress roots, optional twin-leader fork,
 * bare lower stubs, woody branches, whorl spacing, bough asymmetry, storm gaps, and botanical hue —
 * rendered in just 1 trunk draw call + 3 per-bough instanced foliage draw calls.
 */
export function buildProceduralPineForest(
  spots: readonly TreeSpot[],
  getBiomeAt: (x: number, z: number, y?: number) => BiomeType,
  getCoastSignedDistance: (x: number, z: number) => number,
  barkMat: THREE.Material,
  foliageMat: THREE.Material,
  depthMat: THREE.Material,
): ProceduralPineForestResult {
  const count = spots.length;
  const writer = new DirectMeshWriter(Math.max(256, count * 170), Math.max(512, count * 640));

  const trunkRanges: PineTrunkRange[] = new Array(count);
  const boughRangesPerTree: PineBoughRange[][] = new Array(count);
  const buckets: [BoughBucket, BoughBucket, BoughBucket] = [
    new BoughBucket(count * 26),
    new BoughBucket(count * 12),
    new BoughBucket(count * 2),
  ];

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const fp0 = new THREE.Vector3();
  const fp1 = new THREE.Vector3();
  const fp2 = new THREE.Vector3();
  const fp3 = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const bMid = new THREE.Vector3();
  const bEnd = new THREE.Vector3();
  const trunkPts = Array.from({ length: 7 }, () => new THREE.Vector3());
  const forkPts = Array.from({ length: 5 }, () => new THREE.Vector3());
  const branchPts = [pt, bMid, bEnd];

  for (let i = 0; i < count; i++) {
    const spot = spots[i];
    const biome = getBiomeAt(spot.x, spot.z, spot.y);
    const coastDist = getCoastSignedDistance(spot.x, spot.z);
    const spec = generateProceduralPineSpec(spot, i, biome, coastDist);
    const rng = createTreeRng(spec.seed ^ 0x51f15e);

    const cosR = Math.cos(spot.rotation);
    const sinR = Math.sin(spot.rotation);
    const sY = spot.scale * (0.90 + rng() * 0.22);
    const sXZ = spot.scale * (0.88 + rng() * 0.24);
    const baseX = spot.x;
    const baseY = spot.y - 0.18;
    const baseZ = spot.z;

    const toWorld = (out: THREE.Vector3, lx: number, ly: number, lz: number): THREE.Vector3 => {
      const rx = (lx * cosR - lz * sinR) * sXZ;
      const rz = (lx * sinR + lz * cosR) * sXZ;
      return out.set(baseX + rx, baseY + ly * sY, baseZ + rz);
    };

    toWorld(p0, 0, -0.25, 0);
    toWorld(p1, spec.midBendX, spec.height * 0.34, spec.midBendZ);
    toWorld(p2, spec.upperBendX, spec.height * 0.70, spec.upperBendZ);
    toWorld(p3, spec.leanX, spec.height, spec.leanZ);

    const trunkStartVert = writer.vertCount;
    const bucketStarts: [number, number, number] = [
      buckets[0].count,
      buckets[1].count,
      buckets[2].count,
    ];

    // 1. Unique curved tapered trunk with natural flared buttress roots
    const trunkRingCount = 7;
    for (let r = 0; r < trunkRingCount; r++) {
      sampleTrunkPoint(trunkPts[r], p0, p1, p2, p3, r / (trunkRingCount - 1));
    }
    const baseRadWorld = spec.baseRadius * sXZ;
    writer.appendTube(
      trunkPts,
      6,
      (t, angle) => {
        const taper = lerp(baseRadWorld, 0.055 * sXZ, Math.pow(t, 0.84));
        const flare =
          Math.pow(Math.max(0, 1 - t * 3.8), 2.1) *
          (baseRadWorld * 0.46 + 0.065 * sXZ * Math.sin(angle * spec.rootLobes + spec.rootPhase));
        return taper + flare;
      },
      spec.height * sY * 0.28,
    );

    // 2. Optional twin-leader upper fork (~18% of tall/old-growth/Scots pines)
    let hasValidFork = false;
    if (spec.hasFork) {
      hasValidFork = true;
      sampleTrunkPoint(fp0, p0, p1, p2, p3, spec.forkStartFrac);
      const fa = spec.forkAngle + spot.rotation;
      const fCos = Math.cos(fa);
      const fSin = Math.sin(fa);
      const fSpread = spec.forkSpread * sXZ;
      const fTopY = baseY + spec.height * spec.forkHeightFrac * sY;
      fp1.set(
        fp0.x + fCos * fSpread * 0.48,
        lerp(fp0.y, fTopY, 0.36),
        fp0.z + fSin * fSpread * 0.48,
      );
      fp2.set(
        fp0.x + fCos * fSpread * 0.86,
        lerp(fp0.y, fTopY, 0.72),
        fp0.z + fSin * fSpread * 0.86,
      );
      fp3.set(fp0.x + fCos * fSpread, fTopY, fp0.z + fSin * fSpread);

      for (let r = 0; r < 5; r++) {
        sampleTrunkPoint(forkPts[r], fp0, fp1, fp2, fp3, r / 4);
      }
      const forkBaseRad = baseRadWorld * lerp(0.55, 0.30, spec.forkStartFrac);
      writer.appendTube(forkPts, 5, (t) => lerp(forkBaseRad, 0.042 * sXZ, t), 1.4);
    }

    // 3. Weathered bare lower branch stubs below the living crown
    for (let sIdx = 0; sIdx < spec.deadStubCount; sIdx++) {
      const st = lerp(0.18, Math.max(0.24, (spec.crownStart / spec.height) * 0.92), (sIdx + 0.3) / (spec.deadStubCount + 0.4));
      sampleTrunkPoint(pt, p0, p1, p2, p3, clamp(st, 0.12, 0.78));
      const a = rng() * Math.PI * 2;
      const stubLen = (0.42 + rng() * 0.62) * sXZ;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      bMid.set(pt.x + ca * stubLen * 0.52, pt.y - 0.10 * sY, pt.z + sa * stubLen * 0.52);
      bEnd.set(pt.x + ca * stubLen, pt.y - (0.18 + rng() * 0.16) * sY, pt.z + sa * stubLen);
      writer.appendTube(branchPts, 4, (t) => lerp(0.058 * sXZ, 0.014 * sXZ, t), 0.5);
    }

    // Helper to emit one unique procedural bough instance
    const emitBough = (
      meshIndex: 0 | 1 | 2,
      ox: number,
      oy: number,
      oz: number,
      yaw: number,
      pitch: number,
      roll: number,
      sx: number,
      sy: number,
      sz: number,
      heightNorm: number,
      sunBoost: number,
    ): void => {
      dummy.position.set(ox, oy, oz);
      dummy.rotation.set(pitch, yaw, roll);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();

      // Natural canopy vertical sunlight gradient + subtle branch-to-branch organic variation
      const shade = lerp(0.74, 1.12, clamp(heightNorm * 0.78 + sunBoost * 0.22, 0, 1)) * (0.93 + rng() * 0.14);
      const warm = heightNorm * 0.06;
      const r = clamp((spec.tintR + warm) * shade, 0.45, 1.32);
      const g = clamp((spec.tintG + warm * 0.5) * shade, 0.48, 1.32);
      const b = clamp((spec.tintB - warm * 0.6) * shade, 0.45, 1.28);
      const sway = clamp(0.14 + heightNorm * 0.86, 0.12, 1.0);

      buckets[meshIndex].push(dummy.matrix.elements, r, g, b, baseX, baseZ, sway);
    };

    // 4. Procedurally grow whorls & individual boughs along this tree's unique trunk curve
    const worldWindAngle = spec.windFlagAngle + spot.rotation;
    const worldStormAngle = spec.stormGapAngle + spot.rotation;
    let azimCursor = rng() * Math.PI * 2;

    for (let w = 0; w < spec.whorlCount; w++) {
      const wt = spec.whorlCount > 1 ? w / (spec.whorlCount - 1) : 0.5;
      const wJitter = (rng() - 0.5) * 0.065;
      const yLocal = lerp(
        spec.crownStart,
        spec.crownEnd,
        Math.pow(clamp(wt + wJitter, 0, 1), spec.whorlSpacingPow),
      );
      const curveT = clamp((yLocal + 0.25) / (spec.height + 0.25), 0.05, 0.98);
      sampleTrunkPoint(pt, p0, p1, p2, p3, curveT);

      // Continuous blend between pointed conical taper and Scots-pine upper umbrella bulge
      const coneProfile = 1 - Math.pow(wt, spec.taperPow);
      const umbrellaProfile = Math.sin(wt * Math.PI * 0.76 + 0.34);
      const profile = lerp(coneProfile, umbrellaProfile, spec.umbrellaFlatness);
      const whorlLen = lerp(spec.topBoughLen, spec.baseBoughLen, clamp(profile, 0.06, 1.15));

      const boughsInWhorl = Math.max(
        3,
        Math.round(lerp(6.4, spec.umbrellaFlatness > 0.5 ? 5.0 : 3.4, wt) + (rng() - 0.5) * 1.4),
      );
      azimCursor += 0.85 + rng() * 0.62;

      for (let b = 0; b < boughsInWhorl; b++) {
        const a = azimCursor + (b / boughsInWhorl) * Math.PI * 2 + (rng() - 0.5) * 0.44;

        // Localized storm-gap void (creates realistic uneven wild forest silhouettes)
        const stormAlign = Math.cos(a - worldStormAngle);
        const localGapChance =
          spec.gapChance + (stormAlign > 0.45 && wt > 0.15 && wt < 0.85 ? spec.stormGapStrength * (stormAlign - 0.45) : 0);
        if (w < spec.whorlCount - 1 && rng() < localGapChance) {
          continue;
        }

        const windMult = clamp(1 + Math.cos(a - worldWindAngle) * spec.windFlagStrength, 0.42, 1.58);
        const bLen = whorlLen * (0.64 + rng() * 0.62) * windMult * sXZ;
        const bWidth = bLen * spec.boughWidthRatio * (0.82 + rng() * 0.36);
        const pitch = lerp(spec.pitchBase, spec.pitchTop, wt) + (rng() - 0.5) * 0.26;
        const roll = (rng() - 0.5) * 0.34;

        // Visible primary woody branch inside lower/mid whorls of large & open-crowned trees
        if (wt < 0.72 && b % 2 === 0 && bLen > 1.35 * sXZ) {
          const sinA = Math.sin(a);
          const cosA = Math.cos(a);
          const woodLen = bLen * 0.62;
          const droopY = -Math.sin(pitch) * woodLen * 0.55;
          bMid.set(pt.x + sinA * woodLen * 0.55, pt.y + droopY * 0.65, pt.z + cosA * woodLen * 0.55);
          bEnd.set(pt.x + sinA * woodLen, pt.y + droopY + 0.08 * sY, pt.z + cosA * woodLen);
          const brRad = Math.max(0.025, baseRadWorld * 0.18 * (1 - wt * 0.5));
          writer.appendTube(branchPts, 4, (t) => lerp(brRad, 0.015 * sXZ, t), 0.7);
        }

        // Choose between feathered spruce/fir spray (type 0) and tufted Scots/umbrella pad (type 1)
        const usePad =
          (spec.umbrellaFlatness > 0.45 && wt > 0.35 && rng() < spec.umbrellaFlatness) ||
          (spec.habit === 'old_growth' && wt > 0.68 && rng() < 0.45);
        const frondType: 0 | 1 = usePad ? 1 : 0;

        emitBough(
          frondType,
          pt.x + Math.sin(a) * 0.12 * sXZ,
          pt.y + (rng() - 0.5) * 0.28 * sY,
          pt.z + Math.cos(a) * 0.12 * sXZ,
          a,
          pitch,
          roll,
          bWidth,
          bWidth * (0.82 + rng() * 0.32),
          bLen,
          wt,
          clamp((windMult - 0.5) * 0.8 + (usePad ? 0.35 : 0.1), 0, 1),
        );
      }
    }

    // 5. Crown top: either feathered vertical leader spire OR sunlit irregular umbrella crown pads
    sampleTrunkPoint(pt, p0, p1, p2, p3, 1.0);
    if (spec.spireHeight > 0.15) {
      const spH = spec.spireHeight * sY;
      const spW = (0.82 + rng() * 0.42) * sXZ;
      emitBough(
        2,
        pt.x,
        pt.y - spH * 0.24,
        pt.z,
        rng() * Math.PI * 2,
        (rng() - 0.5) * 0.10,
        (rng() - 0.5) * 0.10,
        spW,
        spH,
        spW,
        1.0,
        1.0,
      );
    } else {
      const padCount = Math.round(3 + rng() * 3);
      for (let pIdx = 0; pIdx < padCount; pIdx++) {
        const a = (pIdx / padCount) * Math.PI * 2 + rng() * 0.55;
        const rad = (0.28 + rng() * 0.85) * sXZ;
        const padLen = (1.35 + rng() * 0.95) * sXZ;
        emitBough(
          1,
          pt.x + Math.sin(a) * rad,
          pt.y - (0.05 + rng() * 0.32) * sY,
          pt.z + Math.cos(a) * rad,
          a,
          -0.16 + (rng() - 0.5) * 0.22,
          (rng() - 0.5) * 0.24,
          padLen * 1.08,
          padLen * 0.72,
          padLen,
          0.98,
          1.0,
        );
      }
    }

    // 6. Foliage crown on the secondary twin-leader fork (when present)
    if (hasValidFork) {
      const forkWhorls = 3;
      for (let fw = 0; fw < forkWhorls; fw++) {
        const fwt = fw / (forkWhorls - 1);
        sampleTrunkPoint(pt, fp0, fp1, fp2, fp3, lerp(0.32, 0.96, fwt));
        const fCount = fw === forkWhorls - 1 ? 3 : 4;
        for (let fb = 0; fb < fCount; fb++) {
          const a = (fb / fCount) * Math.PI * 2 + fw * 1.1 + rng() * 0.5;
          const fLen = lerp(spec.baseBoughLen * 0.56, spec.topBoughLen * 0.72, fwt) * (0.78 + rng() * 0.42) * sXZ;
          const usePad = spec.umbrellaFlatness > 0.42;
          emitBough(
            usePad ? 1 : 0,
            pt.x,
            pt.y,
            pt.z,
            a,
            lerp(0.12, -0.22, fwt) + (rng() - 0.5) * 0.22,
            (rng() - 0.5) * 0.28,
            fLen * 0.68,
            fLen * 0.58,
            fLen,
            lerp(0.68, 0.98, fwt),
            0.85,
          );
        }
      }
      if (spec.spireHeight > 0.25) {
        sampleTrunkPoint(pt, fp0, fp1, fp2, fp3, 1.0);
        const spH = spec.spireHeight * 0.68 * sY;
        const spW = 0.68 * sXZ;
        emitBough(2, pt.x, pt.y - spH * 0.22, pt.z, rng() * Math.PI * 2, 0, 0, spW, spH, spW, 0.98, 0.95);
      }
    }

    trunkRanges[i] = { start: trunkStartVert, count: writer.vertCount - trunkStartVert };
    const ranges: PineBoughRange[] = [];
    for (let m = 0; m < PINE_FROND_TYPE_COUNT; m++) {
      const added = buckets[m].count - bucketStarts[m];
      if (added > 0) {
        ranges.push({ meshIndex: m, start: bucketStarts[m], count: added });
      }
    }
    boughRangesPerTree[i] = ranges;
  }

  // Finalize single merged procedural trunk mesh
  const trunksGeo = writer.toBufferGeometry();
  const trunksMesh = new THREE.Mesh(trunksGeo, barkMat);
  trunksMesh.name = 'procedural_pine_trunks';
  trunksMesh.castShadow = true;
  trunksMesh.receiveShadow = true;

  const disposables: THREE.BufferGeometry[] = [trunksGeo];
  const frondMeshes: THREE.InstancedMesh[] = [];
  let totalBoughInstances = 0;

  for (let m = 0; m < PINE_FROND_TYPE_COUNT; m++) {
    const bucket = buckets[m];
    const n = bucket.count;
    const baseGeo = createPineFrondGeo(m as 0 | 1 | 2);
    const windData = n > 0 ? bucket.wind.subarray(0, n * 3) : new Float32Array(3);
    baseGeo.setAttribute('aWindData', new THREE.InstancedBufferAttribute(windData, 3));
    disposables.push(baseGeo);

    const instMesh = new THREE.InstancedMesh(baseGeo, foliageMat, Math.max(1, n));
    instMesh.name = `procedural_pine_fronds_${m}`;
    instMesh.count = n;
    instMesh.customDepthMaterial = depthMat;
    instMesh.castShadow = true;
    instMesh.receiveShadow = true;
    instMesh.frustumCulled = false;

    if (n > 0) {
      (instMesh.instanceMatrix.array as Float32Array).set(bucket.matrices.subarray(0, n * 16));
      const colAttr = new THREE.InstancedBufferAttribute(bucket.colors.subarray(0, n * 3), 3);
      instMesh.instanceColor = colAttr;
      instMesh.instanceColor.needsUpdate = true;
    }
    instMesh.instanceMatrix.needsUpdate = true;

    frondMeshes.push(instMesh);
    totalBoughInstances += n;
  }

  // Support instant settlement/bridge tree clearing for individual procedural pines
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const cleared = new Uint8Array(count);
  let trunksDirty = false;
  const frondsDirty = [false, false, false];

  const clearTree = (index: number): void => {
    if (index < 0 || index >= count || cleared[index]) return;
    cleared[index] = 1;

    const tr = trunkRanges[index];
    if (tr && tr.count > 0) {
      const posAttr = trunksGeo.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const end = (tr.start + tr.count) * 3;
      for (let p = tr.start * 3; p < end; p += 3) {
        arr[p] = 0;
        arr[p + 1] = -999;
        arr[p + 2] = 0;
      }
      trunksDirty = true;
    }

    const ranges = boughRangesPerTree[index];
    if (ranges) {
      for (const r of ranges) {
        const mesh = frondMeshes[r.meshIndex];
        for (let k = r.start; k < r.start + r.count; k++) {
          mesh.setMatrixAt(k, zeroMatrix);
        }
        frondsDirty[r.meshIndex] = true;
      }
    }
  };

  const flushCleared = (): void => {
    if (trunksDirty) {
      (trunksGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      trunksDirty = false;
    }
    for (let m = 0; m < PINE_FROND_TYPE_COUNT; m++) {
      if (frondsDirty[m]) {
        frondMeshes[m].instanceMatrix.needsUpdate = true;
        frondsDirty[m] = false;
      }
    }
  };

  return {
    trunksMesh,
    frondMeshes,
    disposables,
    spots,
    clearTree,
    flushCleared,
    totalBoughInstances,
  };
}

/**
 * Builds ~1,400 procedurally unique distant horizon pines from tiered foliage instances
 * (only 2 foliage draw calls + 1 trunk draw call) so even hillside & mountain skylines
 * never show cloned silhouettes.
 */
export function buildProceduralHorizonPines(
  placements: readonly HorizonPinePlacement[],
  foliageMat: THREE.Material,
  trunkMat: THREE.Material,
): ProceduralHorizonPinesResult {
  const tierGeo0 = createHorizonConiferTierGeo(0);
  const tierGeo1 = createHorizonConiferTierGeo(1);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.48, 3.4, 5);
  trunkGeo.translate(0, 1.55, 0);

  const tierBuckets: [
    Array<{ mat: Float32Array; r: number; g: number; b: number }>,
    Array<{ mat: Float32Array; r: number; g: number; b: number }>,
  ] = [[], []];

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, placements.length));
  trunkMesh.count = placements.length;
  trunkMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const rng = createTreeRng(p.seed >>> 0);
    const s = p.scale;

    // Continuous distant conifer silhouette variety: alpine spire, woodland spruce, broad Douglas, tall Scots pine
    const style = rng();
    const isScots = style > 0.72;
    const isAlpine = !isScots && (style < 0.30 || p.biome === 'rocky_ridge');
    const totalH = (isAlpine ? 10.0 + rng() * 4.2 : isScots ? 8.8 + rng() * 3.4 : 8.5 + rng() * 4.4) * s;
    const crownStart = totalH * (isScots ? 0.48 + rng() * 0.16 : isAlpine ? 0.14 + rng() * 0.10 : 0.18 + rng() * 0.16);
    const baseRadius = (isAlpine ? 1.55 + rng() * 0.65 : isScots ? 2.6 + rng() * 1.15 : 2.25 + rng() * 1.35) * s;
    const leanX = (rng() - 0.5) * 0.14;
    const leanZ = (rng() - 0.5) * 0.14;

    // Tapered trunk reaching into the crown
    const trunkHScale = (crownStart + (totalH - crownStart) * 0.42) / 3.4;
    dummy.position.set(p.x, p.y - 0.35, p.z);
    dummy.rotation.set(leanX, rng() * Math.PI * 2, leanZ);
    dummy.scale.set(s * (0.85 + rng() * 0.35), Math.max(0.6, trunkHScale), s * (0.85 + rng() * 0.35));
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    // Per-tree continuous conifer tint
    const temp = isAlpine ? -0.10 + rng() * 0.08 : isScots ? 0.02 + rng() * 0.14 : -0.08 + rng() * 0.16;
    const val = 0.84 + rng() * 0.30;
    const baseR = clamp((0.96 + temp * 0.9) * val, 0.70, 1.24);
    const baseG = clamp((1.01 + temp * 0.25) * val, 0.74, 1.22);
    const baseB = clamp((0.94 - temp * 0.8) * val, 0.70, 1.22);

    const tiers = isScots ? 3 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 4);
    for (let tIdx = 0; tIdx < tiers; tIdx++) {
      const wt = tiers > 1 ? tIdx / (tiers - 1) : 0.5;
      const y = p.y - 0.2 + lerp(crownStart, totalH, wt) + (rng() - 0.5) * 0.45 * s;
      const driftX = -leanZ * (y - p.y) * 0.75 + (rng() - 0.5) * 0.42 * s;
      const driftZ = leanX * (y - p.y) * 0.75 + (rng() - 0.5) * 0.42 * s;

      const radProfile = isScots
        ? 0.75 + Math.sin(wt * Math.PI * 0.82 + 0.3) * 0.42
        : 1 - Math.pow(wt, 0.78 + rng() * 0.26) * 0.82;
      const tierRad = baseRadius * radProfile * (0.82 + rng() * 0.36);
      const tierH = ((totalH - crownStart) / tiers) * (1.28 + rng() * 0.48);

      dummy.position.set(p.x + driftX, y, p.z + driftZ);
      dummy.rotation.set((rng() - 0.5) * 0.18, rng() * Math.PI * 2, (rng() - 0.5) * 0.18);
      dummy.scale.set(tierRad, tierH, tierRad * (0.86 + rng() * 0.28));
      dummy.updateMatrix();

      const shade = lerp(0.76, 1.12, wt);
      const bucketIdx: 0 | 1 = isScots ? 1 : 0;
      tierBuckets[bucketIdx].push({
        mat: new Float32Array(dummy.matrix.elements),
        r: baseR * shade,
        g: baseG * shade,
        b: baseB * shade,
      });
    }
  }
  trunkMesh.instanceMatrix.needsUpdate = true;

  const foliageMeshes: THREE.InstancedMesh[] = [];
  const geos = [tierGeo0, tierGeo1];
  const mat4 = new THREE.Matrix4();
  const color = new THREE.Color();

  for (let b = 0; b < 2; b++) {
    const list = tierBuckets[b];
    const mesh = new THREE.InstancedMesh(geos[b], foliageMat, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    for (let k = 0; k < list.length; k++) {
      const item = list[k];
      mat4.fromArray(item.mat);
      mesh.setMatrixAt(k, mat4);
      color.setRGB(item.r, item.g, item.b);
      mesh.setColorAt(k, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    foliageMeshes.push(mesh);
  }

  return {
    foliageMeshes,
    trunkMesh,
    disposables: [tierGeo0, tierGeo1, trunkGeo],
  };
}
