import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Applies uniform or position/normal-driven vertex colors to a BufferGeometry.
 */
export function paintVertexColors(
  geo: THREE.BufferGeometry,
  colorOrFn:
    | number
    | THREE.Color
    | ((x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void),
): THREE.BufferGeometry {
  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  if (typeof colorOrFn === 'number') {
    c.setHex(colorOrFn);
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  } else if (colorOrFn instanceof THREE.Color) {
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = colorOrFn.r;
      colors[i * 3 + 1] = colorOrFn.g;
      colors[i * 3 + 2] = colorOrFn.b;
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      colorOrFn(
        pos.getX(i),
        pos.getY(i),
        pos.getZ(i),
        norm.getX(i),
        norm.getY(i),
        norm.getZ(i),
        c,
      );
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Normalizes attributes (non-indexed, position, normal, uv, optional color) and
 * merges an array of geometries into one clean BufferGeometry, disposing sources.
 */
export function mergePartGeometries(
  parts: THREE.BufferGeometry[],
  withColors = false,
): THREE.BufferGeometry {
  const normalized: THREE.BufferGeometry[] = [];

  for (const src of parts) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    const count = g.attributes.position.count;
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (withColors && !g.attributes.color) {
      const ones = new Float32Array(count * 3);
      ones.fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(ones, 3));
    }
    // Strip any stray attributes so mergeGeometries never fails
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv' && (!withColors || key !== 'color')) {
        g.deleteAttribute(key);
      }
    }
    normalized.push(g);
    src.dispose();
  }

  const merged = mergeGeometries(normalized, false);
  for (const g of normalized) {
    g.dispose();
  }
  if (!merged) {
    throw new Error('Failed to merge procedural geometries');
  }
  return merged;
}

/**
 * Generates a smooth variable-radius organic tube along any 3D curve.
 * Ideal for fluffy curled tails, gnarled branches, fern stems, and whimsical hats.
 */
export function createTaperedTubeGeo(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radialSegments: number,
  radiusAtT: (t: number, angle: number) => number,
  capEnds = true,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pt = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, pt);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let j = 0; j <= radialSegments; j++) {
      const u = j / radialSegments;
      const angle = u * Math.PI * 2;
      const r = Math.max(0.001, radiusAtT(t, angle));
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      vertex.x = pt.x + r * (cos * N.x + sin * B.x);
      vertex.y = pt.y + r * (cos * N.y + sin * B.y);
      vertex.z = pt.z + r * (cos * N.z + sin * B.z);

      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(u, t);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  if (capEnds) {
    // Start cap
    const startPt = curve.getPointAt(0);
    const startCenter = positions.length / 3;
    positions.push(startPt.x, startPt.y, startPt.z);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegments; j++) {
      indices.push(startCenter, j + 1, j);
    }

    // End cap
    const endPt = curve.getPointAt(1);
    const endCenter = positions.length / 3;
    positions.push(endPt.x, endPt.y, endPt.z);
    uvs.push(0.5, 1);
    const ringOffset = tubularSegments * stride;
    for (let j = 0; j < radialSegments; j++) {
      indices.push(endCenter, ringOffset + j, ringOffset + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a smooth, organically sculpted puff / canopy / rock volume with soft
 * multi-frequency bumps and optional sunlit-to-shaded vertical vertex colors.
 */
export function createOrganicPuffGeo(
  radius: number,
  detail = 3,
  wobbleAmp = 0.14,
  seed = 1.0,
  bottomColorHex?: number,
  topColorHex?: number,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    const n1 = Math.sin(dir.x * 3.1 + seed) * Math.cos(dir.y * 2.7 - seed * 0.7) * Math.sin(dir.z * 3.3 + seed * 1.3);
    const n2 = Math.sin(dir.x * 6.4 - dir.z * 5.2 + seed * 2.1) * Math.cos(dir.y * 5.8 + seed);
    const disp = 1 + n1 * wobbleAmp + n2 * (wobbleAmp * 0.38);
    v.multiplyScalar(disp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();

  if (bottomColorHex !== undefined && topColorHex !== undefined) {
    const bot = new THREE.Color(bottomColorHex);
    const top = new THREE.Color(topColorHex);
    paintVertexColors(geo, (_x, y, _z, _nx, ny, _nz, out) => {
      const h = THREE.MathUtils.clamp((y / radius) * 0.5 + 0.5, 0, 1);
      const lift = THREE.MathUtils.clamp(h * 0.65 + (ny * 0.5 + 0.5) * 0.35, 0, 1);
      out.copy(bot).lerp(top, lift);
    });
  }

  return geo;
}

/**
 * Deterministic pseudo-random helper for organic botanical branch & leaf placement.
 */
function detRand(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Creates a gently cupped 2x2 subdivided leaf-spray quad so foliage cards never
 * read as flat cardboard planes from oblique or ground-level POV angles.
 */
function createCuppedLeafCard(width: number, height: number, cupDepth = 0.24): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 2, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r2 = (x / (width * 0.5)) ** 2 + (y / (height * 0.5)) ** 2;
    pos.setZ(i, -r2 * cupDepth);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Blends vertex normals on a multi-card foliage canopy toward the outward radial
 * crown direction + upward sky lift, and applies deep inner-to-sunlit outer AO colors.
 */
function shadeBotanicalCanopy(
  geo: THREE.BufferGeometry,
  centerY: number,
  crownRadius: number,
  crownHeight: number,
  radialBlend = 0.78,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const innerCol = new THREE.Color(0x414e3a);
  const midCol = new THREE.Color(0xb8c4aa);
  const tipCol = new THREE.Color(0xf6f8f2);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(norm, i);

    radial.set(
      v.x / Math.max(0.2, crownRadius),
      (v.y - centerY) / Math.max(0.2, crownHeight) + 0.24,
      v.z / Math.max(0.2, crownRadius),
    );
    const distNorm = THREE.MathUtils.clamp(radial.length(), 0, 1.35);
    radial.normalize();

    n.lerp(radial, radialBlend).normalize();
    norm.setXYZ(i, n.x, n.y, n.z);

    const heightFactor = THREE.MathUtils.clamp((v.y - (centerY - crownHeight)) / (crownHeight * 2), 0, 1);
    const ao = THREE.MathUtils.clamp(distNorm * 0.58 + heightFactor * 0.48, 0, 1);
    if (ao < 0.5) {
      c.copy(innerCol).lerp(midCol, ao * 2);
    } else {
      c.copy(midCol).lerp(tipCol, (ao - 0.5) * 2);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  norm.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Realistic sculpted ancient oak trunk with flared buttress roots, organic furrowed
 * stem, 5 primary limbs, and 10 forked secondary boughs extending into the leaf canopy.
 */
export function createGnarledOakTrunkGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Gently curving main trunk with strong natural buttress root flare
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.3, 0),
    new THREE.Vector3(0.08, 1.25, -0.06),
    new THREE.Vector3(-0.09, 2.8, 0.09),
    new THREE.Vector3(0.04, 4.35, -0.04),
    new THREE.Vector3(0.0, 5.4, 0.02),
  ]);
  const mainTrunk = createTaperedTubeGeo(
    trunkCurve,
    16,
    12,
    (t, angle) => {
      const baseRadius = THREE.MathUtils.lerp(0.6, 0.18, Math.pow(t, 0.75));
      const rootFlare = Math.pow(Math.max(0, 1 - t * 3.3), 2.2) * (0.38 + 0.18 * Math.sin(angle * 5));
      const barkRib = Math.sin(angle * 7 + t * 5) * 0.024;
      return baseRadius + rootFlare + barkRib;
    },
    true,
  );
  parts.push(mainTrunk);

  // 5 organic buttress roots gripping the forest floor
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rootCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ca * 0.34, 0.72, sa * 0.34),
      new THREE.Vector3(ca * 0.95, 0.2, sa * 0.95),
      new THREE.Vector3(ca * 1.62, -0.22, sa * 1.62),
    ]);
    parts.push(
      createTaperedTubeGeo(rootCurve, 7, 7, (t) => THREE.MathUtils.lerp(0.24, 0.055, t), true),
    );
  }

  // 5 spreading primary limbs + forked secondary boughs visible inside the airy crown
  const limbs: { startY: number; angle: number; reach: number; endY: number; r0: number }[] = [
    { startY: 3.1, angle: 0.4, reach: 2.35, endY: 5.05, r0: 0.22 },
    { startY: 3.35, angle: 1.72, reach: 2.15, endY: 5.35, r0: 0.21 },
    { startY: 3.5, angle: 2.95, reach: 2.45, endY: 5.15, r0: 0.22 },
    { startY: 3.75, angle: 4.2, reach: 2.05, endY: 5.65, r0: 0.19 },
    { startY: 4.1, angle: 5.45, reach: 1.85, endY: 6.05, r0: 0.18 },
  ];

  for (let i = 0; i < limbs.length; i++) {
    const l = limbs[i];
    const ca = Math.cos(l.angle);
    const sa = Math.sin(l.angle);
    const midX = ca * l.reach * 0.54;
    const midY = THREE.MathUtils.lerp(l.startY, l.endY, 0.56) + 0.15;
    const midZ = sa * l.reach * 0.54;
    const endX = ca * l.reach;
    const endZ = sa * l.reach;

    const bCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, l.startY, 0),
      new THREE.Vector3(midX, midY, midZ),
      new THREE.Vector3(endX, l.endY, endZ),
    ]);
    parts.push(createTaperedTubeGeo(bCurve, 8, 7, (t) => THREE.MathUtils.lerp(l.r0, 0.055, t), true));

    // Forked secondary boughs splitting upward & outward
    for (const side of [-1, 1]) {
      const subA = l.angle + side * 0.58;
      const subLen = l.reach * 0.55;
      const subCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(midX, midY, midZ),
        new THREE.Vector3(
          midX + Math.cos(subA) * subLen * 0.55,
          midY + 0.55,
          midZ + Math.sin(subA) * subLen * 0.55,
        ),
        new THREE.Vector3(
          midX + Math.cos(subA) * subLen,
          l.endY + 0.58 + (side > 0 ? 0.25 : -0.15),
          midZ + Math.sin(subA) * subLen,
        ),
      ]);
      parts.push(
        createTaperedTubeGeo(subCurve, 5, 5, (t) => THREE.MathUtils.lerp(l.r0 * 0.52, 0.03, t), true),
      );
    }
  }

  return mergePartGeometries(parts, false);
}

/**
 * Volumetric botanical ancient oak canopy built from layered, cupped 3D leaf-spray cards
 * clustered around the branching limb lobes with radial canopy normals & AO shading.
 */
export function createOakCanopyGeo(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];

  // Organic crown lobe centers aligned with oak limbs + summit dome
  const lobes: [number, number, number, number][] = [
    [0, 6.25, 0, 1.55],
    [1.85, 5.15, 0.78, 1.38],
    [-0.35, 5.45, 1.75, 1.32],
    [-1.95, 5.25, 0.35, 1.4],
    [-0.95, 5.65, -1.65, 1.32],
    [1.15, 5.9, -1.35, 1.28],
    [0.15, 4.95, 0.1, 1.15],
  ];

  let idx = 0;
  for (let l = 0; l < lobes.length; l++) {
    const [lx, ly, lz, lr] = lobes[l];
    const cardsInLobe = l === 0 ? 12 : 9;

    for (let j = 0; j < cardsInLobe; j++) {
      idx++;
      const phi = Math.acos(1 - 2 * ((j + 0.5) / cardsInLobe));
      const theta = Math.PI * (1 + Math.sqrt(5)) * j + l * 1.7;
      const rad = lr * (0.42 + detRand(idx, 1) * 0.62);

      const cx = lx + Math.sin(phi) * Math.cos(theta) * rad;
      const cy = ly + Math.cos(phi) * rad * 0.76;
      const cz = lz + Math.sin(phi) * Math.sin(theta) * rad;

      const cardSize = 1.65 + detRand(idx, 2) * 0.72;
      const card = createCuppedLeafCard(cardSize, cardSize * (0.88 + detRand(idx, 3) * 0.22), 0.28);

      // Orient card outward with organic tumble so branches have rich 3D volume from every angle
      const outDir = new THREE.Vector3(cx, (cy - 5.2) * 1.2 + 0.4, cz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outDir);
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (detRand(idx, 4) - 0.5) * 0.9,
          (detRand(idx, 5) - 0.5) * 0.9,
          detRand(idx, 6) * Math.PI * 2,
        ),
      );
      quat.multiply(spin);
      card.applyQuaternion(quat);
      card.translate(cx, cy, cz);
      cards.push(card);
    }
  }

  const merged = mergePartGeometries(cards, false);
  return shadeBotanicalCanopy(merged, 5.55, 3.25, 2.25, 0.8);
}

export const PINE_VARIANT_COUNT = 5;
export const HORIZON_PINE_VARIANT_COUNT = 3;

interface PineArchetype {
  readonly seed: number;
  readonly height: number;
  readonly crownStart: number;
  readonly crownEnd: number;
  readonly baseRadius: number;
  readonly leanX: number;
  readonly leanZ: number;
  readonly trunkWhorls: number;
  readonly canopyWhorls: number;
  readonly baseBoughLen: number;
  readonly topBoughLen: number;
  readonly baseBoughWidth: number;
  readonly topBoughWidth: number;
  readonly boughCurvePow: number;
  readonly pitchBase: number;
  readonly pitchTop: number;
  readonly skipRate: number;
  readonly windBias: number; // >0 stretches boughs toward +X (flagged ridge pine)
  readonly spireHeight: number; // 0 = broad flat/rounded Scots pine crown
  readonly bareStubs: boolean; // dead lower stubs on tall bare-trunk mature pines
}

const PINE_ARCHETYPES: readonly PineArchetype[] = [
  // 0: Irregular Woodland Norway Spruce (asymmetric gaps, organic drooping boughs)
  {
    seed: 11,
    height: 9.0,
    crownStart: 2.35,
    crownEnd: 8.55,
    baseRadius: 0.42,
    leanX: 0.08,
    leanZ: -0.05,
    trunkWhorls: 6,
    canopyWhorls: 8,
    baseBoughLen: 2.65,
    topBoughLen: 0.65,
    baseBoughWidth: 1.72,
    topBoughWidth: 0.68,
    boughCurvePow: 0.88,
    pitchBase: 0.34,
    pitchTop: -0.34,
    skipRate: 0.16,
    windBias: 0.06,
    spireHeight: 1.35,
    bareStubs: false,
  },
  // 1: Tall Mature Scots / Ponderosa Pine (high bare reddish trunk + broad irregular umbrella crown)
  {
    seed: 29,
    height: 10.4,
    crownStart: 5.05,
    crownEnd: 9.95,
    baseRadius: 0.46,
    leanX: -0.24,
    leanZ: 0.15,
    trunkWhorls: 5,
    canopyWhorls: 6,
    baseBoughLen: 3.15,
    topBoughLen: 1.65,
    baseBoughWidth: 1.95,
    topBoughWidth: 1.35,
    boughCurvePow: 0.55,
    pitchBase: 0.04,
    pitchTop: -0.26,
    skipRate: 0.14,
    windBias: 0.12,
    spireHeight: 0.0,
    bareStubs: true,
  },
  // 2: Slender Alpine Subalpine Fir / Young Spire (tall, narrow, low feathered skirts)
  {
    seed: 47,
    height: 9.8,
    crownStart: 1.55,
    crownEnd: 9.35,
    baseRadius: 0.31,
    leanX: 0.05,
    leanZ: 0.06,
    trunkWhorls: 7,
    canopyWhorls: 10,
    baseBoughLen: 1.62,
    topBoughLen: 0.44,
    baseBoughWidth: 1.24,
    topBoughWidth: 0.52,
    boughCurvePow: 0.92,
    pitchBase: 0.48,
    pitchTop: -0.28,
    skipRate: 0.12,
    windBias: 0.04,
    spireHeight: 1.65,
    bareStubs: false,
  },
  // 3: Broad Old-Growth Douglas Fir / Cedar (massive wide irregular bough pads, blunted summit)
  {
    seed: 73,
    height: 10.1,
    crownStart: 1.95,
    crownEnd: 9.45,
    baseRadius: 0.54,
    leanX: 0.14,
    leanZ: 0.10,
    trunkWhorls: 7,
    canopyWhorls: 9,
    baseBoughLen: 3.35,
    topBoughLen: 1.12,
    baseBoughWidth: 2.05,
    topBoughWidth: 0.98,
    boughCurvePow: 0.78,
    pitchBase: 0.28,
    pitchTop: -0.22,
    skipRate: 0.18,
    windBias: 0.09,
    spireHeight: 0.75,
    bareStubs: false,
  },
  // 4: Wind-Sculpted / Leaning Ridge Pine (sweeping bent trunk & asymmetric flagged boughs)
  {
    seed: 97,
    height: 8.3,
    crownStart: 2.95,
    crownEnd: 7.85,
    baseRadius: 0.40,
    leanX: 0.68,
    leanZ: -0.24,
    trunkWhorls: 6,
    canopyWhorls: 7,
    baseBoughLen: 2.55,
    topBoughLen: 1.05,
    baseBoughWidth: 1.68,
    topBoughWidth: 0.92,
    boughCurvePow: 0.68,
    pitchBase: 0.16,
    pitchTop: -0.20,
    skipRate: 0.24,
    windBias: 0.46,
    spireHeight: 0.55,
    bareStubs: true,
  },
];

function buildPineTrunkCurve(arch: PineArchetype): THREE.CatmullRomCurve3 {
  const s = arch.seed;
  const midBendX = arch.leanX * 0.38 + (detRand(s, 11) - 0.5) * 0.26;
  const midBendZ = arch.leanZ * 0.38 + (detRand(s, 12) - 0.5) * 0.26;
  const upperBendX = arch.leanX * 0.78 + (detRand(s, 13) - 0.5) * 0.22;
  const upperBendZ = arch.leanZ * 0.78 + (detRand(s, 14) - 0.5) * 0.22;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.25, 0),
    new THREE.Vector3(midBendX, arch.height * 0.30, midBendZ),
    new THREE.Vector3(upperBendX, arch.height * 0.65, upperBendZ),
    new THREE.Vector3(arch.leanX, arch.height, arch.leanZ),
  ]);
}

/**
 * Realistic conifer trunk with flared buttress roots and visible woody branch whorls
 * tailored to each of the 5 distinct woodland/alpine pine archetypes.
 */
export function createPineTrunkGeo(variant = 0): THREE.BufferGeometry {
  const arch = PINE_ARCHETYPES[((variant % PINE_ARCHETYPES.length) + PINE_ARCHETYPES.length) % PINE_ARCHETYPES.length];
  const parts: THREE.BufferGeometry[] = [];

  const trunkCurve = buildPineTrunkCurve(arch);
  parts.push(
    createTaperedTubeGeo(
      trunkCurve,
      14,
      10,
      (t, angle) => {
        const base = THREE.MathUtils.lerp(arch.baseRadius, 0.065, Math.pow(t, 0.84));
        const flare =
          Math.pow(Math.max(0, 1 - t * 4.0), 2.1) *
          (arch.baseRadius * 0.48 + 0.07 * Math.sin(angle * 4 + arch.seed));
        return base + flare;
      },
      true,
    ),
  );

  // Optional weathered bare lower branch stubs on mature Scots/ridge pines
  if (arch.bareStubs) {
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const st = THREE.MathUtils.lerp(0.24, 0.46, sIdx / 2);
      const origin = trunkCurve.getPointAt(st);
      const a = detRand(arch.seed + sIdx * 7, 21) * Math.PI * 2;
      const stubLen = 0.45 + detRand(arch.seed + sIdx * 7, 22) * 0.42;
      const sCurve = new THREE.CatmullRomCurve3([
        origin.clone(),
        new THREE.Vector3(
          origin.x + Math.cos(a) * stubLen * 0.55,
          origin.y - 0.12,
          origin.z + Math.sin(a) * stubLen * 0.55,
        ),
        new THREE.Vector3(
          origin.x + Math.cos(a) * stubLen,
          origin.y - 0.22,
          origin.z + Math.sin(a) * stubLen,
        ),
      ]);
      parts.push(createTaperedTubeGeo(sCurve, 4, 5, (t) => THREE.MathUtils.lerp(0.065, 0.018, t), true));
    }
  }

  // Visible woody bough whorls extending out into the pine needle sprays
  const whorlCount = arch.trunkWhorls;
  for (let w = 0; w < whorlCount; w++) {
    const wt = whorlCount > 1 ? w / (whorlCount - 1) : 0;
    const y = THREE.MathUtils.lerp(arch.crownStart, arch.crownEnd * 0.88, wt);
    const curveT = THREE.MathUtils.clamp((y + 0.25) / (arch.height + 0.25), 0.05, 0.95);
    const origin = trunkCurve.getPointAt(curveT);
    const len = THREE.MathUtils.lerp(arch.baseBoughLen * 0.78, arch.topBoughLen * 0.82, Math.pow(wt, arch.boughCurvePow));
    const branches = w < 3 ? 5 : 4;
    for (let b = 0; b < branches; b++) {
      const bId = arch.seed * 31 + w * 13 + b;
      if (detRand(bId, 3) < arch.skipRate * 0.75) continue;
      const a = (b / branches) * Math.PI * 2 + w * 0.83 + (detRand(bId, 1) - 0.5) * 0.35;
      const windMult = 1 + Math.cos(a) * arch.windBias;
      const localLen = len * (0.78 + detRand(bId, 2) * 0.42) * windMult;
      const droop = THREE.MathUtils.lerp(-arch.pitchBase * 1.15, -arch.pitchTop * 0.35, wt);
      const bCurve = new THREE.CatmullRomCurve3([
        origin.clone(),
        new THREE.Vector3(
          origin.x + Math.cos(a) * localLen * 0.55,
          origin.y + droop * 0.62,
          origin.z + Math.sin(a) * localLen * 0.55,
        ),
        new THREE.Vector3(
          origin.x + Math.cos(a) * localLen,
          origin.y + droop * 0.78 + 0.16,
          origin.z + Math.sin(a) * localLen,
        ),
      ]);
      parts.push(
        createTaperedTubeGeo(
          bCurve,
          5,
          5,
          (t) => THREE.MathUtils.lerp(0.08 * (1 - wt * 0.45), 0.02, t),
          true,
        ),
      );
    }
  }

  return mergePartGeometries(parts, false);
}

/**
 * Realistic evergreen conifer canopy across 5 distinct botanical archetypes
 * (woodland spruce, bare-trunk Scots pine, narrow alpine fir, old-growth Douglas fir,
 * and wind-sculpted ridge pine) with irregular gaps, organic asymmetry, and radial AO.
 */
export function createPineCanopyGeo(variant = 0): THREE.BufferGeometry {
  const arch = PINE_ARCHETYPES[((variant % PINE_ARCHETYPES.length) + PINE_ARCHETYPES.length) % PINE_ARCHETYPES.length];
  const trunkCurve = buildPineTrunkCurve(arch);
  const fronds: THREE.BufferGeometry[] = [];

  const whorls = arch.canopyWhorls;
  let idx = arch.seed * 100;
  for (let w = 0; w < whorls; w++) {
    const wt = whorls > 1 ? w / (whorls - 1) : 0; // 0 = lowest boughs, 1 = upper crown
    const jitterW = (detRand(arch.seed + w * 5, 7) - 0.5) * 0.06;
    const y = THREE.MathUtils.lerp(arch.crownStart, arch.crownEnd, Math.pow(THREE.MathUtils.clamp(wt + jitterW, 0, 1), 0.94));
    const curveT = THREE.MathUtils.clamp((y + 0.25) / (arch.height + 0.25), 0.05, 0.98);
    const center = trunkCurve.getPointAt(curveT);

    // Scots/umbrella pine flares mid-upper crown wider before gently rounding off at the top
    const profile =
      arch.spireHeight <= 0.01
        ? Math.sin(wt * Math.PI * 0.72 + 0.35)
        : 1 - Math.pow(wt, arch.boughCurvePow);
    const boughLen = THREE.MathUtils.lerp(arch.topBoughLen, arch.baseBoughLen, profile);
    const boughWidth = THREE.MathUtils.lerp(arch.baseBoughWidth, arch.topBoughWidth, wt);
    const count = Math.round(THREE.MathUtils.lerp(7, arch.spireHeight <= 0.01 ? 5 : 4, wt));

    for (let b = 0; b < count; b++) {
      idx++;
      // Occasional organic missing bough creates real natural gaps instead of machine-uniform cones
      if (w < whorls - 1 && detRand(idx, 9) < arch.skipRate) continue;

      const a = (b / count) * Math.PI * 2 + w * 0.91 + (detRand(idx, 1) - 0.5) * 0.42;
      const windMult = Math.max(0.45, 1 + Math.cos(a) * arch.windBias);
      const pitchDown = THREE.MathUtils.lerp(arch.pitchBase, arch.pitchTop, wt) + (detRand(idx, 2) - 0.5) * 0.22;
      const localLen = boughLen * (0.74 + detRand(idx, 3) * 0.48) * windMult;
      const localWidth = boughWidth * (0.82 + detRand(idx, 8) * 0.34);

      // Main horizontal-draping curved pine needle frond + angled cross-vane for full 3D depth
      for (const roll of [0, 0.62, -0.62]) {
        if (roll !== 0 && wt > 0.76 && arch.spireHeight > 0.1) continue;
        const card = createCuppedLeafCard(
          localWidth * (roll === 0 ? 1.0 : 0.74),
          localLen,
          roll === 0 ? 0.22 : 0.12,
        );
        // Pivot so UV bottom (base of pine spray) attaches near the trunk and tip points outward (+Z)
        card.translate(0, localLen * 0.44, 0);
        card.rotateX(-Math.PI / 2 + pitchDown);
        if (roll !== 0) {
          card.rotateZ(roll);
        }
        card.rotateY(-a + Math.PI / 2);
        card.translate(
          center.x + Math.cos(a) * 0.18,
          center.y + (detRand(idx, 4) - 0.5) * 0.32,
          center.z + Math.sin(a) * 0.18,
        );
        fronds.push(card);
      }
    }
  }

  const topPt = trunkCurve.getPointAt(1);
  if (arch.spireHeight > 0.1) {
    // Feathered vertical evergreen leader spire
    for (let i = 0; i < 3; i++) {
      const spire = createCuppedLeafCard(0.68 + detRand(arch.seed + i, 5) * 0.22, arch.spireHeight, 0.08);
      spire.rotateY((i / 3) * Math.PI + arch.seed * 0.3);
      spire.translate(topPt.x, topPt.y + arch.spireHeight * 0.24, topPt.z);
      fronds.push(spire);
    }
  } else {
    // Broad, sunlit, flat-topped Scots/Ponderosa pine crown dome pads
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + arch.seed * 0.4;
      const r = 0.55 + detRand(arch.seed + i, 6) * 0.85;
      const pad = createCuppedLeafCard(1.75, 1.65, 0.26);
      pad.rotateX(-Math.PI / 2 + 0.14);
      pad.rotateY(a);
      pad.translate(
        topPt.x + Math.cos(a) * r,
        topPt.y - 0.1 + (detRand(arch.seed + i, 7) - 0.5) * 0.35,
        topPt.z + Math.sin(a) * r,
      );
      fronds.push(pad);
    }
  }

  const merged = mergePartGeometries(fronds, false);
  const centerY = (arch.crownStart + arch.crownEnd) * 0.5;
  const crownH = Math.max(1.8, (arch.crownEnd - arch.crownStart) * 0.55);
  return shadeBotanicalCanopy(merged, centerY, arch.baseBoughLen, crownH, 0.74);
}

/**
 * Gracefully curved slender silver birch trunk with forked upper branches & fine twigs.
 */
export function createCurvedBirchTrunkGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.14, 1.9, 0.06),
    new THREE.Vector3(0.02, 4.0, -0.08),
    new THREE.Vector3(-0.16, 6.25, 0.08),
  ]);
  parts.push(
    createTaperedTubeGeo(
      curve,
      14,
      10,
      (t, angle) => {
        const base = THREE.MathUtils.lerp(0.28, 0.075, t);
        const flare = Math.pow(Math.max(0, 1 - t * 4), 2) * (0.12 + 0.04 * Math.sin(angle * 4));
        return base + flare;
      },
      true,
    ),
  );

  // 5 delicate ascending birch branches reaching into the lacy crown
  const branches: [number, number, number, number][] = [
    [3.3, 0.3, 1.35, 4.85],
    [3.75, 1.8, 1.25, 5.3],
    [4.1, 3.25, 1.35, 5.65],
    [4.55, 4.75, 1.15, 6.15],
    [5.05, 5.8, 0.95, 6.6],
  ];
  for (const [sy, a, reach, ey] of branches) {
    const bCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, sy, 0),
      new THREE.Vector3(Math.cos(a) * reach * 0.52, THREE.MathUtils.lerp(sy, ey, 0.6), Math.sin(a) * reach * 0.52),
      new THREE.Vector3(Math.cos(a) * reach, ey, Math.sin(a) * reach),
    ]);
    parts.push(createTaperedTubeGeo(bCurve, 6, 6, (t) => THREE.MathUtils.lerp(0.085, 0.022, t), true));
  }

  return mergePartGeometries(parts, false);
}

/**
 * Airy, delicate cascading silver birch canopy made of curved feathery leaf-spray cards.
 */
export function createBirchCanopyGeo(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];

  const lobes: [number, number, number, number][] = [
    [0.0, 6.55, 0.0, 1.25],
    [1.05, 5.05, 0.35, 1.1],
    [-0.3, 5.45, 1.05, 1.08],
    [-1.08, 5.75, -0.2, 1.12],
    [0.2, 6.05, -0.95, 1.02],
  ];

  let idx = 0;
  for (let l = 0; l < lobes.length; l++) {
    const [lx, ly, lz, lr] = lobes[l];
    const count = l === 0 ? 12 : 9;
    for (let j = 0; j < count; j++) {
      idx++;
      const phi = Math.acos(1 - 2 * ((j + 0.5) / count));
      const theta = Math.PI * (1 + Math.sqrt(5)) * j + l * 2.1;
      const rad = lr * (0.35 + detRand(idx, 1) * 0.72);

      const cx = lx + Math.sin(phi) * Math.cos(theta) * rad;
      const cy = ly + Math.cos(phi) * rad * 0.92;
      const cz = lz + Math.sin(phi) * Math.sin(theta) * rad;

      const cardW = 1.28 + detRand(idx, 2) * 0.52;
      const cardH = cardW * 1.15;
      const card = createCuppedLeafCard(cardW, cardH, 0.22);

      const outDir = new THREE.Vector3(cx, (cy - 5.5) * 0.9, cz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outDir);
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          0.18 + (detRand(idx, 3) - 0.5) * 0.7,
          (detRand(idx, 4) - 0.5) * 0.85,
          detRand(idx, 5) * Math.PI * 2,
        ),
      );
      quat.multiply(spin);
      card.applyQuaternion(quat);
      card.translate(cx, cy, cz);
      cards.push(card);
    }
  }

  const merged = mergePartGeometries(cards, false);
  return shadeBotanicalCanopy(merged, 5.75, 2.25, 2.1, 0.8);
}

/**
 * Lightweight alpha-cutout cross-card botanical broadleaf tree for distant horizon ridges
 * (replaces low-poly dodecahedron blobs with airy feathery silhouettes).
 */
export function createHorizonBroadleafGeo(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number, number, number][] = [
    [0, 5.2, 0, 4.8, 4.4, 0],
    [0, 5.2, 0, 4.8, 4.4, Math.PI / 3],
    [0, 5.2, 0, 4.8, 4.4, (2 * Math.PI) / 3],
    [1.3, 4.4, 0.6, 3.6, 3.2, 0.5],
    [-1.2, 4.6, -0.7, 3.5, 3.2, 2.1],
    [0, 6.2, 0, 4.2, 3.8, 0.3],
  ];
  for (let i = 0; i < specs.length; i++) {
    const [cx, cy, cz, w, h, rotY] = specs[i];
    const card = new THREE.PlaneGeometry(w, h, 1, 1);
    if (i === 5) {
      card.rotateX(-Math.PI / 2 + 0.15);
    }
    card.rotateY(rotY);
    card.translate(cx, cy, cz);
    cards.push(card);
  }
  const merged = mergePartGeometries(cards, false);
  return shadeBotanicalCanopy(merged, 5.1, 3.2, 2.4, 0.85);
}

/**
 * Lightweight alpha-cutout tiered bough-card conifer for distant horizon mountain ridges
 * across 3 distinct silhouettes (spruce, high-crowned Scots pine, slender alpine fir).
 */
export function createHorizonPineGeo(variant = 0): THREE.BufferGeometry {
  const v = ((variant % HORIZON_PINE_VARIANT_COUNT) + HORIZON_PINE_VARIANT_COUNT) % HORIZON_PINE_VARIANT_COUNT;
  const cards: THREE.BufferGeometry[] = [];

  const tiers: [number, number, number, number][] =
    v === 1
      ? [
          // High-crowned Scots/Ponderosa pine
          [5.4, 3.4, 3.3, 4],
          [7.4, 3.2, 3.0, 4],
          [9.0, 2.5, 2.3, 3],
        ]
      : v === 2
        ? [
            // Narrow tall alpine fir spire
            [2.4, 2.0, 2.1, 4],
            [4.9, 1.7, 1.8, 4],
            [7.3, 1.4, 1.5, 3],
            [9.1, 1.0, 1.2, 3],
          ]
        : [
            // Classic irregular woodland spruce
            [3.0, 3.4, 3.1, 4],
            [5.3, 2.7, 2.6, 4],
            [7.4, 1.9, 2.0, 3],
          ];

  for (let t = 0; t < tiers.length; t++) {
    const [y, w, len, count] = tiers[t];
    for (let i = 0; i < count; i++) {
      const seedIdx = v * 40 + t * 10 + i;
      const a = (i / count) * Math.PI * 2 + t * 0.72 + (detRand(seedIdx, 1) - 0.5) * 0.4;
      const localLen = len * (0.82 + detRand(seedIdx, 2) * 0.36);
      const card = new THREE.PlaneGeometry(w, localLen, 1, 1);
      card.translate(0, localLen * 0.4, 0);
      card.rotateX(-Math.PI / 2 + (v === 1 ? 0.08 : 0.34) - t * 0.12);
      card.rotateY(-a + Math.PI / 2);
      card.translate(Math.cos(a) * 0.15, y + (detRand(seedIdx, 3) - 0.5) * 0.35, Math.sin(a) * 0.15);
      cards.push(card);
    }
  }
  if (v !== 1) {
    const spireW = v === 2 ? 1.4 : 2.0;
    const spireH = v === 2 ? 3.6 : 3.1;
    const spireY = v === 2 ? 10.1 : 8.6;
    for (let i = 0; i < 2; i++) {
      const spire = new THREE.PlaneGeometry(spireW, spireH, 1, 1);
      spire.rotateY(i * (Math.PI / 2) + v * 0.5);
      spire.translate(0, spireY, 0);
      cards.push(spire);
    }
  }
  const merged = mergePartGeometries(cards, false);
  return shadeBotanicalCanopy(merged, v === 1 ? 7.2 : 5.6, v === 2 ? 1.8 : 2.9, 3.9, 0.78);
}

/**
 * Fluted, scalloped storybook pine bough tier with drooping branches and sunlit tip shading.
 */
export function createScallopedPineTierGeo(
  radius: number,
  height: number,
  lobes = 7,
): THREE.BufferGeometry {
  const radialSegs = lobes * 4;
  const heightSegs = 6;
  const geo = new THREE.ConeGeometry(radius, height, radialSegs, heightSegs, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.001) {
      const angle = Math.atan2(z, x);
      const t = THREE.MathUtils.clamp((height * 0.5 - y) / height, 0, 1); // 0 at tip, 1 at skirt
      const scallop = 1 + Math.sin(angle * lobes) * 0.2 * Math.pow(t, 0.9);
      const droop = -Math.pow(t, 2.2) * (0.28 + Math.sin(angle * lobes) * 0.16);
      const flare = 1 + Math.pow(t, 1.8) * 0.14;
      pos.setXYZ(i, x * scallop * flare, y + droop, z * scallop * flare);
    }
  }
  geo.computeVertexNormals();

  const inner = new THREE.Color(0x7c8f83);
  const outer = new THREE.Color(0xf2f5f0);
  paintVertexColors(geo, (x, y, z, _nx, ny, _nz, out) => {
    const dist = THREE.MathUtils.clamp(Math.hypot(x, z) / radius, 0, 1);
    const h = THREE.MathUtils.clamp((y + height * 0.5) / height, 0, 1);
    const bright = THREE.MathUtils.clamp(0.45 + h * 0.35 + dist * 0.25 + ny * 0.15, 0.45, 1.1);
    out.copy(inner).lerp(outer, THREE.MathUtils.clamp(bright, 0, 1));
  });

  return geo;
}

/**
 * Sculpted naturalistic mossy woodland boulder with organic stone faces and muted moss cap.
 */
export function createMossyBoulderGeo(): THREE.BufferGeometry {
  const geo = createOrganicPuffGeo(0.9, 3, 0.18, 4.2);
  const rockCol = new THREE.Color(0xb2b5ad);
  const mossCol = new THREE.Color(0x5b7646);

  paintVertexColors(geo, (_x, y, _z, _nx, ny, _nz, out) => {
    const mossMask = THREE.MathUtils.smoothstep(ny * 0.75 + (y / 0.9) * 0.25, 0.38, 0.80);
    out.copy(rockCol).lerp(mossCol, mossMask);
  });
  return geo;
}

/**
 * Sharp, faceted bare-rock crag spire / sandstone outcrop for towering alpine peaks
 * and arid desert formations (zero green moss tinting).
 */
export function createCragSpireGeo(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.95, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    // Angular ridged rock fractures & chiseled cliff facets
    const ridge1 = 1 - Math.abs(Math.sin(dir.x * 4.2 + dir.z * 3.1 + 1.3));
    const ridge2 = 1 - Math.abs(Math.cos(dir.y * 5.0 - dir.x * 3.7 + 2.6));
    const taper = dir.y > 0 ? 1 - dir.y * 0.34 : 1 + Math.abs(dir.y) * 0.16;
    const yStretch = dir.y > 0 ? 1.55 : 0.72;
    const disp = 0.78 + ridge1 * 0.3 + ridge2 * 0.18;
    v.x *= disp * taper;
    v.z *= disp * taper;
    v.y *= disp * yStretch;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  if (nonIndexed !== geo) geo.dispose();
  nonIndexed.computeVertexNormals();

  const creviceCol = new THREE.Color(0x585e64);
  const faceCol = new THREE.Color(0xb8bdc1);
  const crestCol = new THREE.Color(0xe5e8eb);
  paintVertexColors(nonIndexed, (_x, y, _z, _nx, ny, _nz, out) => {
    const lift = THREE.MathUtils.clamp((y + 0.6) * 0.42 + (ny * 0.5 + 0.5) * 0.45, 0, 1);
    if (lift < 0.55) {
      out.copy(creviceCol).lerp(faceCol, lift / 0.55);
    } else {
      out.copy(faceCol).lerp(crestCol, (lift - 0.55) / 0.45);
    }
  });
  return nonIndexed;
}

/**
 * Lush multi-frond arching woodland fern rosette with naturalistic deep-to-olive gradient.
 */
export function createFernRosetteGeo(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const count = 8;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.22;
    const len = 0.78 + (i % 3) * 0.14;
    const archH = 0.34 + (i % 2) * 0.12;
    const segs = 6;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const dist = t * len;
      const y = Math.sin(t * Math.PI * 0.78) * archH + 0.04;
      const halfW = Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.2 * (1 - t * 0.25);

      const cx = Math.cos(angle) * dist;
      const cz = Math.sin(angle) * dist;
      const px = -Math.sin(angle) * halfW;
      const pz = Math.cos(angle) * halfW;

      // Left edge, midrib (slightly raised V-fold), right edge
      positions.push(cx - px, y - 0.015 * halfW * 4, cz - pz);
      positions.push(cx, y + 0.025, cz);
      positions.push(cx + px, y - 0.015 * halfW * 4, cz + pz);

      uvs.push(0, t, 0.5, t, 1, t);

      if (s < segs) {
        const row = s * 3;
        const next = (s + 1) * 3;
        indices.push(row, next, row + 1, row + 1, next, next + 1);
        indices.push(row + 1, next + 1, row + 2, row + 2, next + 1, next + 2);
      }
    }

    const frond = new THREE.BufferGeometry();
    frond.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    frond.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    frond.setIndex(indices);
    frond.computeVertexNormals();

    const baseCol = new THREE.Color(0x243b1f);
    const tipCol = new THREE.Color(0x668443);
    paintVertexColors(frond, (x, y, z, _nx, _ny, _nz, out) => {
      const dist = THREE.MathUtils.clamp(Math.hypot(x, z) / len, 0, 1);
      out.copy(baseCol).lerp(tipCol, THREE.MathUtils.clamp(dist * 0.75 + y * 0.55, 0, 1));
    });

    fronds.push(frond);
  }

  return mergePartGeometries(fronds, true);
}

/**
 * Naturalistic leafy woodland berry shrub built from cupped alpha-cutout leaf-spray cards
 * (eliminating sphere-puff blobs) + realistic clustered wild berries.
 */
export function createBerryBushGeo(): {
  foliage: THREE.BufferGeometry;
  berries: THREE.BufferGeometry;
} {
  const cards: THREE.BufferGeometry[] = [];
  const lobes: [number, number, number, number][] = [
    [0, 0.42, 0, 0.42],
    [0.32, 0.30, 0.16, 0.32],
    [-0.30, 0.32, -0.18, 0.34],
    [-0.14, 0.28, 0.32, 0.30],
    [0.18, 0.48, -0.18, 0.28],
  ];

  let idx = 0;
  for (let l = 0; l < lobes.length; l++) {
    const [lx, ly, lz, lr] = lobes[l];
    const count = l === 0 ? 7 : 5;
    for (let j = 0; j < count; j++) {
      idx++;
      const phi = Math.acos(1 - 1.5 * ((j + 0.5) / count));
      const theta = Math.PI * (1 + Math.sqrt(5)) * j + l * 1.9;
      const rad = lr * (0.35 + detRand(idx, 1) * 0.65);

      const cx = lx + Math.sin(phi) * Math.cos(theta) * rad;
      const cy = Math.max(0.14, ly + Math.cos(phi) * rad * 0.72);
      const cz = lz + Math.sin(phi) * Math.sin(theta) * rad;

      const cardSize = 0.48 + detRand(idx, 2) * 0.24;
      const card = createCuppedLeafCard(cardSize, cardSize * 0.92, 0.09);

      const outDir = new THREE.Vector3(cx, (cy - 0.18) * 1.15 + 0.2, cz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outDir);
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (detRand(idx, 3) - 0.5) * 0.8,
          (detRand(idx, 4) - 0.5) * 0.8,
          detRand(idx, 5) * Math.PI * 2,
        ),
      );
      quat.multiply(spin);
      card.applyQuaternion(quat);
      card.translate(cx, cy, cz);
      cards.push(card);
    }
  }

  const foliage = shadeBotanicalCanopy(mergePartGeometries(cards, false), 0.38, 0.68, 0.45, 0.78);

  const berryParts: THREE.BufferGeometry[] = [];
  const berryClusters: [number, number, number][] = [
    [0.38, 0.42, 0.24],
    [0.48, 0.33, 0.06],
    [-0.40, 0.38, -0.20],
    [-0.22, 0.46, 0.34],
    [0.12, 0.62, 0.15],
    [0.20, 0.54, -0.32],
    [-0.08, 0.34, 0.46],
    [-0.36, 0.34, 0.16],
    [0.05, 0.64, -0.14],
    [0.32, 0.28, -0.26],
  ];
  for (let c = 0; c < berryClusters.length; c++) {
    const [bx, by, bz] = berryClusters[c];
    for (let k = 0; k < 2; k++) {
      const b = new THREE.SphereGeometry(0.036, 7, 5);
      const off = k === 0 ? 0 : 0.044;
      b.translate(bx + off * Math.cos(c * 2.1), by + (k === 1 ? -0.024 : 0), bz + off * Math.sin(c * 2.1));
      berryParts.push(b);
    }
  }

  return {
    foliage,
    berries: mergePartGeometries(berryParts, false),
  };
}

/**
 * Naturalistic cluster of 3 woodland toadstools with curved stems, ruffled gill undersides,
 * and organic domed caps.
 */
export function createToadstoolClusterGeo(): {
  stems: THREE.BufferGeometry;
  caps: THREE.BufferGeometry;
} {
  const stems: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];

  const specs: { x: number; z: number; h: number; capR: number; tiltX: number; tiltZ: number }[] = [
    { x: 0, z: 0, h: 0.42, capR: 0.34, tiltX: 0.06, tiltZ: -0.05 },
    { x: 0.28, z: 0.14, h: 0.27, capR: 0.22, tiltX: 0.18, tiltZ: 0.24 },
    { x: -0.24, z: 0.18, h: 0.22, capR: 0.18, tiltX: -0.15, tiltZ: -0.22 },
  ];

  // Lathe profile for a natural mushroom stem with ring skirt
  const stemPts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.11, 0.02),
    new THREE.Vector2(0.13, 0.14),
    new THREE.Vector2(0.085, 0.55),
    new THREE.Vector2(0.095, 0.78),
    new THREE.Vector2(0.14, 0.84),
    new THREE.Vector2(0.08, 0.92),
    new THREE.Vector2(0.06, 1.0),
  ];

  // Lathe profile for a rounded dome cap (wound bottom-to-top for outward normals)
  const capPts = [
    new THREE.Vector2(0.0, 0.04),
    new THREE.Vector2(0.28, 0.02),
    new THREE.Vector2(0.86, -0.03),
    new THREE.Vector2(1.02, 0.03),
    new THREE.Vector2(0.95, 0.16),
    new THREE.Vector2(0.68, 0.36),
    new THREE.Vector2(0.32, 0.48),
    new THREE.Vector2(0.0, 0.52),
  ];

  for (const s of specs) {
    const stem = new THREE.LatheGeometry(stemPts, 14);
    stem.scale(s.capR * 2.1, s.h, s.capR * 2.1);
    stem.rotateX(s.tiltX);
    stem.rotateZ(s.tiltZ);
    stem.translate(s.x, 0, s.z);
    stems.push(stem);

    const cap = new THREE.LatheGeometry(capPts, 18);
    cap.scale(s.capR, s.capR * 0.95, s.capR);
    cap.rotateX(s.tiltX);
    cap.rotateZ(s.tiltZ);
    const topX = s.x - Math.sin(s.tiltZ) * s.h * 0.9;
    const topY = Math.cos(s.tiltX) * Math.cos(s.tiltZ) * s.h * 0.92;
    const topZ = s.z + Math.sin(s.tiltX) * s.h * 0.9;
    cap.translate(topX, topY, topZ);
    caps.push(cap);
  }

  return {
    stems: mergePartGeometries(stems, false),
    caps: mergePartGeometries(caps, false),
  };
}

/**
 * Meadow wildflower cluster (curved stems, multi-petal heads & pollen centers).
 */
export function createWildflowerClusterGeo(): {
  stems: THREE.BufferGeometry;
  petals: THREE.BufferGeometry;
  centers: THREE.BufferGeometry;
} {
  const stems: THREE.BufferGeometry[] = [];
  const petals: THREE.BufferGeometry[] = [];
  const centers: THREE.BufferGeometry[] = [];

  const flowers: [number, number, number, number][] = [
    [0, 0, 0.44, 0.13],
    [0.18, 0.12, 0.34, 0.11],
    [-0.16, 0.14, 0.38, 0.12],
    [0.05, -0.18, 0.3, 0.1],
  ];

  for (const [fx, fz, h, headR] of flowers) {
    const leanX = fx * 0.45;
    const leanZ = fz * 0.45;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(fx * 0.4, 0, fz * 0.4),
      new THREE.Vector3(fx * 0.75 + leanX * 0.3, h * 0.55, fz * 0.75 + leanZ * 0.3),
      new THREE.Vector3(fx + leanX, h, fz + leanZ),
    ]);
    stems.push(createTaperedTubeGeo(curve, 5, 5, () => 0.015, false));

    const hx = fx + leanX;
    const hy = h;
    const hz = fz + leanZ;

    const petalCount = 6;
    for (let p = 0; p < petalCount; p++) {
      const a = (p / petalCount) * Math.PI * 2;
      const pet = new THREE.SphereGeometry(headR * 0.48, 7, 5);
      pet.scale(1.18, 0.28, 0.68);
      pet.translate(headR * 0.58, 0.014, 0);
      pet.rotateZ(0.22);
      pet.rotateY(a);
      pet.translate(hx, hy, hz);
      petals.push(pet);
    }

    const center = new THREE.SphereGeometry(headR * 0.40, 8, 6);
    center.scale(1, 0.58, 1);
    center.translate(hx, hy + 0.018, hz);
    centers.push(center);
  }

  return {
    stems: mergePartGeometries(stems, false),
    petals: mergePartGeometries(petals, false),
    centers: mergePartGeometries(centers, false),
  };
}

/**
 * Floating notched natural water-lily pad.
 */
export function createLilyPadGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const radius = 0.52;
  const startA = 0.24;
  const endA = Math.PI * 2 - 0.24;
  shape.moveTo(0, 0);
  const segs = 22;
  for (let i = 0; i <= segs; i++) {
    const a = THREE.MathUtils.lerp(startA, endA, i / segs);
    const wave = 1 + Math.sin(a * 5) * 0.035;
    shape.lineTo(Math.cos(a) * radius * wave, Math.sin(a) * radius * wave);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.032,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-layered natural water-lily / lotus bloom resting atop a lily pad.
 */
export function createLotusBloomGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const layers: [number, number, number, number][] = [
    [7, 0.16, 0.42, 0xf2e7e9],
    [6, 0.12, 0.78, 0xe8c8d2],
    [5, 0.08, 1.12, 0xe2bf69],
  ];

  for (const [count, len, tilt, hex] of layers) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + tilt;
      const pet = new THREE.SphereGeometry(len * 0.55, 7, 5);
      pet.scale(1.35, 0.32, 0.68);
      pet.translate(len * 0.52, 0, 0);
      pet.rotateZ(tilt);
      pet.rotateY(a);
      pet.translate(0, 0.05, 0);
      paintVertexColors(pet, hex);
      parts.push(pet);
    }
  }
  return mergePartGeometries(parts, true);
}

/**
 * Multi-blade gracefully arched woodland grass tuft with naturalistic root-to-tip shading.
 */
export function createCurvedGrassTuftGeo(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number, number][] = [
    [0, 0, 0.64, 0.24, 0.0],
    [0.07, 0.04, 0.54, 0.2, 1.25],
    [-0.06, 0.06, 0.58, 0.22, 2.5],
    [0.05, -0.07, 0.52, 0.19, 3.8],
    [-0.07, -0.04, 0.6, 0.23, 5.05],
  ];

  for (const [ox, oz, h, curveAmt, rotY] of specs) {
    const segs = 4;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const ca = Math.cos(rotY);
    const sa = Math.sin(rotY);

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = t * t * curveAmt;
      const y = t * h * (1 - t * 0.12);
      const halfW = (1 - t * 0.92) * 0.052;

      const cx = ox + ca * bend;
      const cz = oz + sa * bend;
      const px = -sa * halfW;
      const pz = ca * halfW;

      positions.push(cx - px, y, cz - pz);
      positions.push(cx + px, y, cz + pz);
      uvs.push(0, t, 1, t);

      if (s < segs) {
        const r = s * 2;
        indices.push(r, r + 2, r + 1, r + 1, r + 2, r + 3);
      }
    }

    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    blade.setIndex(indices);
    blade.computeVertexNormals();

    // Neutral root-to-tip shading (biome instance colors & seasonal material tint supply chlorophyll hue)
    const base = new THREE.Color(0x9ea892);
    const tip = new THREE.Color(0xf4f7e4);
    paintVertexColors(blade, (_x, y, _z, _nx, _ny, _nz, out) => {
      out.copy(base).lerp(tip, THREE.MathUtils.clamp(y / h, 0, 1));
    });
    blades.push(blade);
  }

  return mergePartGeometries(blades, true);
}
