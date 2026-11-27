import * as THREE from 'three';
import type { Season } from '@core/Types';
import type { TreeSpot } from '@simulation/terrain/TerrainMap';
import { mergePartGeometries } from './GeometryHelpers';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface DeciduousPhenologyState {
  /** 0..1 continuous progress within the current season (0 = start, 1 = end). */
  readonly seasonProgress: number;
  /**
   * 0..1 fraction of foliage present on deciduous trees (oak, birch, distant broadleaf).
   * - Spring: smoothly sprouts from 0 -> 1
   * - Summer: 1 (full canopy)
   * - Autumn: sheds from 1 -> 0 as leaves turn brown and fall off
   * - Winter: 0 (completely bare branches)
   */
  readonly leafCoverage: number;
  /**
   * 0..1 autumn browning / senescence factor (0 = healthy green, 1 = withered autumn brown).
   */
  readonly brownAmount: number;
  /**
   * 0..1 tender spring bud / sprouting factor (1 = newly sprouting shoots, 0 = mature foliage).
   */
  readonly springSprout: number;
  /**
   * 0..1 intensity of actively falling brown/autumn leaves drifting from deciduous canopies.
   */
  readonly leafFallIntensity: number;
  /**
   * 0..1 visibility of fallen brown leaf litter carpeted beneath deciduous trees.
   */
  readonly groundLitterAmount: number;
  /** Whether deciduous leaf-canopy meshes should be rendered at all (false when fully bare). */
  readonly crownsVisible: boolean;
}

/**
 * Computes continuous deciduous phenology (spring sprouting, summer canopy, autumn browning
 * and progressive leaf drop, bare winter branches) from the live simulation clock.
 * Falls back cleanly to representative mid-season progress if `season` was manually overridden.
 */
export function computeDeciduousPhenology(
  season: Season,
  day: number,
  timeOfDay: number,
  daysPerSeason: number,
): DeciduousPhenologyState {
  const dps = Math.max(1, Math.floor(daysPerSeason));
  const dayIdx = Math.max(0, Math.floor(day) - 1);
  const derivedSeason = SEASONS[Math.floor(dayIdx / dps) % SEASONS.length];
  const clampedTod = THREE.MathUtils.clamp(Number.isFinite(timeOfDay) ? timeOfDay : 0.5, 0, 0.9999);
  const seasonProgress =
    derivedSeason === season ? ((dayIdx % dps) + clampedTod) / dps : 0.5;

  if (season === 'spring') {
    const growT = THREE.MathUtils.clamp(seasonProgress / 0.72, 0, 1);
    const leafCoverage = 1 - Math.pow(1 - growT, 2.2);
    const springSprout = 1 - THREE.MathUtils.smoothstep(seasonProgress, 0.12, 0.78);
    return {
      seasonProgress,
      leafCoverage,
      brownAmount: 0,
      springSprout,
      leafFallIntensity: 0,
      groundLitterAmount: 0,
      crownsVisible: leafCoverage > 0.001,
    };
  }

  if (season === 'summer') {
    return {
      seasonProgress,
      leafCoverage: 1,
      brownAmount: 0,
      springSprout: 0,
      leafFallIntensity: 0,
      groundLitterAmount: 0,
      crownsVisible: true,
    };
  }

  if (season === 'autumn') {
    const brownAmount = THREE.MathUtils.smoothstep(seasonProgress, 0.0, 0.56);
    const shedProgress = THREE.MathUtils.smoothstep(seasonProgress, 0.10, 0.96);
    const leafCoverage = Math.max(0, 1 - shedProgress);
    const leafFallIntensity =
      THREE.MathUtils.smoothstep(seasonProgress, 0.06, 0.28) *
      (1 - THREE.MathUtils.smoothstep(seasonProgress, 0.74, 0.98));
    const groundLitterAmount = THREE.MathUtils.smoothstep(seasonProgress, 0.12, 0.82);
    return {
      seasonProgress,
      leafCoverage,
      brownAmount,
      springSprout: 0,
      leafFallIntensity,
      groundLitterAmount,
      crownsVisible: leafCoverage > 0.001,
    };
  }

  // Winter: all deciduous leaves have fallen off, leaving bare branches until spring
  const groundLitterAmount = (1 - THREE.MathUtils.smoothstep(seasonProgress, 0.0, 0.24)) * 0.65;
  return {
    seasonProgress,
    leafCoverage: 0,
    brownAmount: 1,
    springSprout: 0,
    leafFallIntensity: 0,
    groundLitterAmount,
    crownsVisible: false,
  };
}

/**
 * Sculpted, gently cupped 3D deciduous leaf blade with slight midrib V-fold so falling
 * autumn leaves catch directional sunlight as they glide, rock, and tumble through the air.
 */
export function createFallingLeafGeo(): THREE.BufferGeometry {
  // Pointed leaf silhouette along Z (-0.52 stem to +0.58 tip), cupped across X
  const positions = new Float32Array([
    0.0, 0.02, -0.52, // 0: petiole base
    -0.30, 0.06, -0.14, // 1: lower-left lobe
    0.0, -0.02, -0.06, // 2: lower midrib
    0.30, 0.06, -0.14, // 3: lower-right lobe
    -0.26, 0.05, 0.24, // 4: upper-left lobe
    0.0, -0.015, 0.28, // 5: upper midrib
    0.26, 0.05, 0.24, // 6: upper-right lobe
    0.0, 0.04, 0.58, // 7: leaf tip
  ]);
  const uvs = new Float32Array([
    0.5, 0.0,
    0.0, 0.35,
    0.5, 0.42,
    1.0, 0.35,
    0.08, 0.72,
    0.5, 0.75,
    0.92, 0.72,
    0.5, 1.0,
  ]);
  const indices = [
    0, 1, 2,
    0, 2, 3,
    1, 4, 5,
    1, 5, 2,
    2, 5, 6,
    2, 6, 3,
    4, 7, 5,
    5, 7, 6,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Ground-hugging scatter cluster of 5 curled fallen autumn leaves lying flat around a
 * local origin so forest-floor leaf litter conforms cleanly to hills without z-fighting.
 */
export function createFallenLeafPatchGeo(): THREE.BufferGeometry {
  const specs: readonly [number, number, number, number, number][] = [
    [0.0, 0.0, 0.22, 0.26, 0.02],
    [0.24, 0.14, 1.48, 0.22, 0.025],
    [-0.22, 0.18, 2.75, 0.24, 0.02],
    [-0.18, -0.22, 4.15, 0.21, 0.028],
    [0.20, -0.18, 5.25, 0.25, 0.022],
  ];

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < specs.length; i++) {
    const [ox, oz, rotY, scale, liftY] = specs[i];
    const leaf = createFallingLeafGeo();
    leaf.scale(scale, scale * 0.75, scale * 1.15);
    leaf.rotateX((i % 2 === 0 ? 1 : -1) * 0.08);
    leaf.rotateZ((i % 3 - 1) * 0.07);
    leaf.rotateY(rotY);
    leaf.translate(ox, liftY, oz);
    parts.push(leaf);
  }
  return mergePartGeometries(parts, false);
}

export interface DeciduousTreeAnchor {
  readonly spot: TreeSpot;
  readonly isCleared: () => boolean;
}

const OAK_AUTUMN_LEAF_PALETTE = [
  0x8b4c22, // russet chestnut
  0x733f1d, // deep oak brown
  0x9e5e28, // warm amber-brown
  0x61381c, // dry withered umber
  0x804b24, // weathered russet
];

const BIRCH_AUTUMN_LEAF_PALETTE = [
  0xa4742d, // golden-brown birch
  0x8a5f27, // warm tan-brown
  0x765024, // dry autumn brown
  0x966b2c, // ochre brown
  0x6b4922, // withered birch umber
];

const LATE_BROWN_TINT = new THREE.Color(0x57381f);

/**
 * GPU-instanced 3D falling autumn leaf particle system anchored to nearby non-cleared
 * deciduous oak and birch canopies. Leaves detach inside tree crowns, glide and rock
 * organically on the breeze, settle briefly onto the forest floor, and recycle while
 * autumn shedding is underway.
 */
export class FallingLeafSystem {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;

  private readonly maxLeaves: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly fallSpeed: Float32Array;
  private readonly driftX: Float32Array;
  private readonly driftZ: Float32Array;
  private readonly rotX: Float32Array;
  private readonly rotY: Float32Array;
  private readonly rotZ: Float32Array;
  private readonly spin: Float32Array;
  private readonly phase: Float32Array;
  private readonly leafScale: Float32Array;
  private readonly restTimer: Float32Array;
  private readonly groundY: Float32Array;
  private readonly state: Uint8Array; // 0 = inactive, 1 = falling, 2 = resting on ground

  private readonly nearbyAnchors: DeciduousTreeAnchor[] = [];
  private lastAnchorFocusX = Number.NaN;
  private lastAnchorFocusZ = Number.NaN;
  private lastStructureRevision = -1;
  private rngState = 0x51a7c3d1;
  private activeCount = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly anchors: readonly DeciduousTreeAnchor[],
    private readonly getTerrainHeight: (x: number, z: number) => number,
    maxLeaves = 520,
  ) {
    this.maxLeaves = Math.max(32, Math.floor(maxLeaves));
    this.geometry = createFallingLeafGeo();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxLeaves);
    this.mesh.name = 'deciduous-falling-leaves';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    const n = this.maxLeaves;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.fallSpeed = new Float32Array(n);
    this.driftX = new Float32Array(n);
    this.driftZ = new Float32Array(n);
    this.rotX = new Float32Array(n);
    this.rotY = new Float32Array(n);
    this.rotZ = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.leafScale = new Float32Array(n);
    this.restTimer = new Float32Array(n);
    this.groundY = new Float32Array(n);
    this.state = new Uint8Array(n);

    this.tmpColor.setHex(OAK_AUTUMN_LEAF_PALETTE[0]);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.zeroMatrix);
      this.mesh.setColorAt(i, this.tmpColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  get activeLeafCount(): number {
    return this.activeCount;
  }

  private nextRand(): number {
    // Fast deterministic xorshift32
    let x = this.rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x;
    return ((x >>> 0) % 100000) / 100000;
  }

  private refreshNearbyAnchors(focusX: number, focusZ: number, structureRevision: number): void {
    const movedSq =
      (focusX - this.lastAnchorFocusX) * (focusX - this.lastAnchorFocusX) +
      (focusZ - this.lastAnchorFocusZ) * (focusZ - this.lastAnchorFocusZ);
    if (
      this.lastStructureRevision === structureRevision &&
      Number.isFinite(movedSq) &&
      movedSq < 144 // 12m hysteresis
    ) {
      return;
    }

    this.lastAnchorFocusX = focusX;
    this.lastAnchorFocusZ = focusZ;
    this.lastStructureRevision = structureRevision;
    this.nearbyAnchors.length = 0;

    const radiusSq = 105 * 105;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (a.isCleared()) continue;
      const dx = a.spot.x - focusX;
      const dz = a.spot.z - focusZ;
      if (dx * dx + dz * dz <= radiusSq) {
        this.nearbyAnchors.push(a);
      }
    }

    // Fallback when camera is far from any woodland (e.g. over desert/sea): include nearest sample
    if (this.nearbyAnchors.length === 0 && this.anchors.length > 0) {
      const step = Math.max(1, Math.floor(this.anchors.length / 48));
      for (let i = 0; i < this.anchors.length; i += step) {
        if (!this.anchors[i].isCleared()) {
          this.nearbyAnchors.push(this.anchors[i]);
        }
      }
    }
  }

  private spawnLeaf(idx: number, brownAmount: number, preseedMidFall: boolean): boolean {
    const count = this.nearbyAnchors.length;
    if (count === 0) return false;
    const anchor = this.nearbyAnchors[Math.floor(this.nextRand() * count)];
    const t = anchor.spot;
    const isBirch = t.kind === 'birch';

    const angle = this.nextRand() * Math.PI * 2;
    const crownRadius = (isBirch ? 1.85 : 2.85) * t.scale;
    const radial = Math.sqrt(this.nextRand()) * crownRadius;
    const ox = Math.cos(angle) * radial;
    const oz = Math.sin(angle) * radial;
    const crownBase = (isBirch ? 4.2 : 3.9) * t.scale;
    const crownSpan = (isBirch ? 2.9 : 3.0) * t.scale;

    const x = t.x + ox;
    const z = t.z + oz;
    const gy = this.getTerrainHeight(x, z);
    const startY = t.y + crownBase + this.nextRand() * crownSpan;
    const y = preseedMidFall
      ? THREE.MathUtils.lerp(gy + 0.15, startY, this.nextRand())
      : startY;

    this.px[idx] = x;
    this.py[idx] = y;
    this.pz[idx] = z;
    this.groundY[idx] = gy;
    this.fallSpeed[idx] = 0.72 + this.nextRand() * 0.68;
    this.driftX[idx] = (this.nextRand() - 0.5) * 0.75;
    this.driftZ[idx] = (this.nextRand() - 0.5) * 0.75;
    this.rotX[idx] = this.nextRand() * Math.PI * 2;
    this.rotY[idx] = this.nextRand() * Math.PI * 2;
    this.rotZ[idx] = this.nextRand() * Math.PI * 2;
    this.spin[idx] = (this.nextRand() > 0.5 ? 1 : -1) * (1.2 + this.nextRand() * 1.9);
    this.phase[idx] = this.nextRand() * Math.PI * 2;
    this.leafScale[idx] = (isBirch ? 0.14 : 0.19) + this.nextRand() * 0.10;
    this.restTimer[idx] = 0;
    this.state[idx] = 1;

    const palette = isBirch ? BIRCH_AUTUMN_LEAF_PALETTE : OAK_AUTUMN_LEAF_PALETTE;
    const baseHex = palette[Math.floor(this.nextRand() * palette.length)];
    this.tmpColor.setHex(baseHex);
    // Deepen leaf hues to dry umber-brown as late autumn progresses
    if (brownAmount > 0.45) {
      const dryMix = THREE.MathUtils.clamp((brownAmount - 0.45) / 0.55, 0, 1) * 0.52;
      this.tmpColor.lerp(LATE_BROWN_TINT, dryMix);
    }
    this.mesh.setColorAt(idx, this.tmpColor);
    return true;
  }

  update(
    dt: number,
    elapsedSeconds: number,
    windStrength: number,
    phenology: DeciduousPhenologyState,
    focusX: number,
    focusZ: number,
    structureRevision: number,
  ): void {
    const targetCount = Math.round(this.maxLeaves * phenology.leafFallIntensity);

    // If inactive and no leaves are currently in flight, skip all work
    if (targetCount === 0 && this.activeCount === 0) {
      this.mesh.visible = false;
      return;
    }

    // Immediate reset when jumping directly out of autumn (e.g. winter/spring/summer with dt=0 or fully bare)
    if (targetCount === 0 && (dt <= 0 || phenology.leafCoverage <= 0.001 || phenology.brownAmount < 0.05)) {
      for (let i = 0; i < this.maxLeaves; i++) {
        if (this.state[i] !== 0) {
          this.state[i] = 0;
          this.mesh.setMatrixAt(i, this.zeroMatrix);
        }
      }
      this.activeCount = 0;
      this.mesh.visible = false;
      this.mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    this.refreshNearbyAnchors(focusX, focusZ, structureRevision);
    if (this.nearbyAnchors.length === 0) {
      this.mesh.visible = false;
      return;
    }

    const stepDt = Math.min(0.1, Math.max(0, dt));
    const wasEmpty = this.activeCount === 0;
    const windX = 0.55 + windStrength * 1.95;
    const windZ = 0.24 + windStrength * 0.85;
    const dummy = this.dummy;
    let colorDirty = false;
    let live = 0;

    for (let i = 0; i < this.maxLeaves; i++) {
      const st = this.state[i];

      if (st === 0) {
        if (i < targetCount) {
          if (this.spawnLeaf(i, phenology.brownAmount, wasEmpty || stepDt <= 0)) {
            colorDirty = true;
          } else {
            continue;
          }
        } else {
          continue;
        }
      }

      if (this.state[i] === 1) {
        // Falling leaf: sinusoidal gliding flutter + wind drift + 3D tumble
        const p = this.phase[i] + elapsedSeconds * (2.2 + Math.abs(this.spin[i]) * 0.55);
        const flutterX = Math.sin(p) * 0.65;
        const flutterZ = Math.cos(p * 0.87) * 0.65;

        this.px[i] += (windX + this.driftX[i] + flutterX) * stepDt;
        this.pz[i] += (windZ + this.driftZ[i] + flutterZ) * stepDt;
        this.py[i] -= this.fallSpeed[i] * (0.86 + 0.14 * Math.cos(p * 1.4)) * stepDt;

        this.rotX[i] += this.spin[i] * 0.85 * stepDt;
        this.rotY[i] += this.spin[i] * 0.55 * stepDt;
        this.rotZ[i] = Math.sin(p) * 0.68;

        const floorY = this.groundY[i] + 0.03;
        if (this.py[i] <= floorY) {
          // Sample exact terrain height at landing point so leaves settle flush on slopes
          const exactY = this.getTerrainHeight(this.px[i], this.pz[i]) + 0.03;
          this.groundY[i] = exactY - 0.03;
          if (this.py[i] <= exactY) {
            this.py[i] = exactY;
            this.rotX[i] = 0.05;
            this.rotZ[i] = 0.04;
            this.restTimer[i] = 1.4 + this.nextRand() * 1.4;
            this.state[i] = 2;
          }
        }

        dummy.position.set(this.px[i], this.py[i], this.pz[i]);
        dummy.rotation.set(this.rotX[i], this.rotY[i], this.rotZ[i]);
        dummy.scale.setScalar(this.leafScale[i]);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        live++;
      } else if (this.state[i] === 2) {
        // Resting briefly on the ground before smoothly shrinking away & recycling
        this.restTimer[i] -= stepDt;
        if (this.restTimer[i] <= 0) {
          if (i < targetCount && this.spawnLeaf(i, phenology.brownAmount, false)) {
            colorDirty = true;
            dummy.position.set(this.px[i], this.py[i], this.pz[i]);
            dummy.rotation.set(this.rotX[i], this.rotY[i], this.rotZ[i]);
            dummy.scale.setScalar(this.leafScale[i]);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);
            live++;
          } else {
            this.state[i] = 0;
            this.mesh.setMatrixAt(i, this.zeroMatrix);
          }
        } else {
          const fadeOut = THREE.MathUtils.clamp(this.restTimer[i] / 0.45, 0, 1);
          dummy.position.set(this.px[i], this.py[i], this.pz[i]);
          dummy.rotation.set(this.rotX[i], this.rotY[i], this.rotZ[i]);
          dummy.scale.setScalar(this.leafScale[i] * fadeOut);
          dummy.updateMatrix();
          this.mesh.setMatrixAt(i, dummy.matrix);
          live++;
        }
      }
    }

    this.activeCount = live;
    this.mesh.visible = live > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
