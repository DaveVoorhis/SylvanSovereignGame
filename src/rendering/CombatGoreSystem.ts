import * as THREE from 'three';
import type { CombatSparkVisual } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import {
  createTaperedTubeGeo,
  mergePartGeometries,
  paintVertexColors,
} from './GeometryHelpers';

interface BloodDropletVisual {
  readonly mesh: THREE.Mesh;
  readonly createdAt: number;
  readonly duration: number;
  vx: number;
  vy: number;
  vz: number;
  readonly gravity: number;
  readonly baseScale: number;
  readonly stainChance: number;
  readonly stainRadius: number;
}

interface BloodMistVisual {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  readonly createdAt: number;
  readonly duration: number;
  vx: number;
  vy: number;
  vz: number;
  readonly startScale: number;
  readonly endScale: number;
  readonly baseOpacity: number;
  readonly spinRate: number;
}

interface SteelGlintVisual {
  readonly mesh: THREE.Mesh;
  readonly createdAt: number;
  readonly duration: number;
  vx: number;
  vy: number;
  vz: number;
  readonly baseScale: number;
}

interface GoreGibVisual {
  readonly object: THREE.Object3D;
  readonly createdAt: number;
  readonly duration: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  readonly baseScale: number;
  readonly restHeight: number;
  settled: boolean;
  bounces: number;
  groundY: number;
}

interface BloodStainVisual {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshPhysicalMaterial;
  readonly createdAt: number;
  readonly duration: number;
  readonly spreadDuration: number;
  readonly startRadius: number;
  readonly targetRadius: number;
  readonly maxOpacity: number;
  readonly isWaterSlick: boolean;
  readonly freshColor: THREE.Color;
  readonly dryColor: THREE.Color;
}

interface CarrionFlyData {
  readonly mesh: THREE.Mesh;
  readonly orbitRadius: number;
  readonly orbitSpeed: number;
  readonly heightOffset: number;
  readonly phase: number;
  readonly figureEight: number;
}

interface CarrionSwarmVisual {
  readonly group: THREE.Group;
  readonly flies: CarrionFlyData[];
  readonly createdAt: number;
  readonly duration: number;
}

interface GoreGeometries {
  readonly bloodDrop: THREE.BufferGeometry;
  readonly bloodMist: THREE.BufferGeometry;
  readonly steelSliver: THREE.BufferGeometry;
  readonly gibFlesh: THREE.BufferGeometry;
  readonly gibMeatChunk: THREE.BufferGeometry;
  readonly gibViscera: THREE.BufferGeometry;
  readonly gibBone: THREE.BufferGeometry;
  readonly gibPelt: THREE.BufferGeometry;
  readonly carrionFly: THREE.BufferGeometry;
  readonly bloodSplatters: readonly THREE.BufferGeometry[];
}

const UP_VEC = new THREE.Vector3(0, 1, 0);
const MAX_DROPLETS = 180;
const MAX_MIST = 52;
const MAX_GLINTS = 32;
const MAX_GIBS = 140;
const MAX_STAINS = 160;
const MAX_SWARMS = 16;

function buildBloodDropletGeo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.052, 8, 7);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nz = z / 0.052;
    // Rounded glossy liquid head at +Z, tapered wet streak tail toward -Z
    const radialTaper = nz < 0 ? Math.max(0.18, 1 + nz * 0.72) : 1 + nz * 0.08;
    const zStretch = nz < 0 ? 2.55 : 1.15;
    pos.setXYZ(i, x * radialTaper, y * radialTaper, z * zStretch);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildBloodSplatterGeo(seed: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const segments = 48;
  const p1 = seed * 1.73 + 0.4;
  const p2 = seed * 2.91 + 1.2;
  const p3 = seed * 4.37 + 2.5;
  const p4 = seed * 6.13 + 0.8;

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    // Irregular organic pooling lobes + sharp spatter fingers
    const lobe =
      0.56 +
      0.16 * Math.sin(a * 3 + p1) +
      0.11 * Math.cos(a * 5 - p2) +
      0.08 * Math.sin(a * 8 + p3);
    const fingerWave = Math.max(0, Math.sin(a * 7 + p4));
    const tendril = Math.pow(fingerWave, 5) * 0.34;
    const r = Math.max(0.24, lobe + tendril);
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildGibFleshGeo(variant: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(variant === 0 ? 0.115 : 0.095, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const s = variant * 3.1 + 1.4;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n1 = Math.sin(x * 26 + s) * Math.cos(y * 23 - s * 0.7) * Math.sin(z * 21 + s * 1.3);
    const n2 = Math.cos(x * 41 - z * 34 + s) * 0.5;
    const disp = 1 + n1 * 0.28 + n2 * 0.14;
    let nx = x * disp * (variant === 0 ? 1.28 : 1.55);
    let ny = y * disp * (variant === 0 ? 0.72 : 0.56);
    let nz = z * disp * (variant === 0 ? 0.94 : 0.84);
    // Flatten underside slightly like a torn shear surface
    if (ny < -0.045) ny = -0.045 + (ny + 0.045) * 0.28;
    pos.setXYZ(i, nx, ny, nz);
  }
  geo.computeVertexNormals();
  paintVertexColors(geo, (x, y, z, _nx, ny, _nz, out) => {
    const crease = Math.sin(x * 32 + z * 28 + variant) * 0.5 + 0.5;
    // Deep raw dark crimson muscle with livid pale-pink tendon streaks and clotted underside
    if (ny < -0.25) {
      out.setHex(0x47070a);
    } else if (crease > 0.82 && y > 0) {
      out.setHex(0xb87679);
    } else {
      out.setHex(0x7c151a).lerp(new THREE.Color(0x4a090d), crease * 0.55);
    }
  });
  return geo;
}

function buildGibVisceraGeo(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.14, 0.01, -0.08),
    new THREE.Vector3(-0.07, 0.055, 0.07),
    new THREE.Vector3(0.02, 0.02, -0.06),
    new THREE.Vector3(0.1, 0.065, 0.05),
    new THREE.Vector3(0.15, 0.015, -0.03),
    new THREE.Vector3(0.06, -0.015, -0.11),
  ]);
  const geo = createTaperedTubeGeo(
    curve,
    20,
    8,
    (t, angle) => {
      const pinch = 0.82 + 0.22 * Math.sin(t * Math.PI * 5 + angle * 0.5);
      const endTaper = Math.sin(Math.min(1, Math.max(0.08, t)) * Math.PI);
      return (0.022 + 0.018 * endTaper) * pinch;
    },
    true,
  );
  paintVertexColors(geo, (x, _y, z, _nx, ny, _nz, out) => {
    const vein = Math.sin(x * 38 - z * 42) * 0.5 + 0.5;
    out
      .setHex(0x963a45)
      .lerp(new THREE.Color(0x520b12), vein * 0.62 + (ny < 0 ? 0.22 : 0));
  });
  return geo;
}

function buildGibBoneGeo(): THREE.BufferGeometry {
  const shaftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.14, 0.0, 0.0),
    new THREE.Vector3(-0.04, 0.022, 0.012),
    new THREE.Vector3(0.06, 0.018, -0.008),
    new THREE.Vector3(0.15, -0.012, 0.004),
  ]);
  const shaft = createTaperedTubeGeo(
    shaftCurve,
    12,
    7,
    (t) => THREE.MathUtils.lerp(0.024, 0.007, Math.pow(t, 1.35)),
    true,
  );
  const condyleA = new THREE.SphereGeometry(0.028, 7, 6);
  condyleA.scale(0.9, 1.15, 0.85);
  condyleA.translate(-0.145, 0.012, 0.012);

  const condyleB = new THREE.SphereGeometry(0.026, 7, 6);
  condyleB.scale(0.85, 1.05, 0.85);
  condyleB.translate(-0.145, -0.01, -0.012);

  const merged = mergePartGeometries([shaft, condyleA, condyleB]);
  paintVertexColors(merged, (x, _y, _z, _nx, _ny, _nz, out) => {
    // Chalky ivory at intact joint end (-X), drenched in dark arterial crimson at jagged break (+X)
    const bloodFrac = THREE.MathUtils.smoothstep(x, 0.02, 0.13);
    out.setHex(0xdfd3be).lerp(new THREE.Color(0x6e090c), bloodFrac * 0.92);
  });
  return merged;
}

function buildGibPeltGeo(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.125, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const tuft =
      1 +
      0.24 * Math.sin(x * 34 + y * 29) * Math.cos(z * 31) +
      0.12 * Math.sin(y * 50 - z * 42);
    pos.setXYZ(i, x * tuft * 1.18, y * tuft * 0.78, z * tuft * 1.02);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildBloodMistGeo(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.19, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const puff = 1 + 0.18 * Math.sin(x * 19 + z * 17) * Math.cos(y * 21);
    pos.setXYZ(i, x * puff, y * puff, z * puff);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildSteelSliverGeo(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.011, 0.22, 5);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildCarrionFlyGeo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.017, 6, 4);
  geo.scale(0.75, 0.7, 1.95);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Renders visceral, wet, physically grounded blood spray, tumbling 3D gibs (flesh, viscera,
 * splintered bones, and blood-matted species pelt chunks), spreading & coagulating terrain blood
 * pools, wounded blood trails, and circling carrion flies so woodland warfare feels stark,
 * unpleasant, and unsettling rather than bright or celebratory.
 */
export class CombatGoreSystem {
  readonly group = new THREE.Group();

  private readonly geo: GoreGeometries;
  private readonly droplets: BloodDropletVisual[] = [];
  private readonly mists: BloodMistVisual[] = [];
  private readonly glints: SteelGlintVisual[] = [];
  private readonly gibs: GoreGibVisual[] = [];
  private readonly stains: BloodStainVisual[] = [];
  private readonly swarms: CarrionSwarmVisual[] = [];

  private readonly bloodFreshMat: THREE.MeshPhysicalMaterial;
  private readonly bloodDarkMat: THREE.MeshPhysicalMaterial;
  private readonly bloodClotMat: THREE.MeshPhysicalMaterial;
  private readonly fleshMat: THREE.MeshPhysicalMaterial;
  private readonly visceraMat: THREE.MeshPhysicalMaterial;
  private readonly boneMat: THREE.MeshPhysicalMaterial;
  private readonly carrionFlyMat: THREE.MeshStandardMaterial;
  private readonly steelGlintMat: THREE.MeshStandardMaterial;
  private readonly peltGibMats = new Map<number, THREE.MeshPhysicalMaterial>();

  private readonly scratchLook = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchYawQuat = new THREE.Quaternion();
  private stainLayerCounter = 0;

  constructor(private readonly world: WorldState) {
    this.group.name = 'combat_gore_system';
    this.geo = {
      bloodDrop: buildBloodDropletGeo(),
      bloodMist: buildBloodMistGeo(),
      steelSliver: buildSteelSliverGeo(),
      gibFlesh: buildGibFleshGeo(0),
      gibMeatChunk: buildGibFleshGeo(1),
      gibViscera: buildGibVisceraGeo(),
      gibBone: buildGibBoneGeo(),
      gibPelt: buildGibPeltGeo(),
      carrionFly: buildCarrionFlyGeo(),
      bloodSplatters: [
        buildBloodSplatterGeo(1),
        buildBloodSplatterGeo(2),
        buildBloodSplatterGeo(3),
      ],
    };

    this.bloodFreshMat = new THREE.MeshPhysicalMaterial({
      color: 0x7b060a,
      roughness: 0.11,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    this.bloodDarkMat = new THREE.MeshPhysicalMaterial({
      color: 0x430306,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 0.96,
      clearcoatRoughness: 0.07,
    });
    this.bloodClotMat = new THREE.MeshPhysicalMaterial({
      color: 0x240204,
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 0.74,
      clearcoatRoughness: 0.16,
    });
    this.fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.24,
      metalness: 0.0,
      clearcoat: 0.92,
      clearcoatRoughness: 0.11,
    });
    this.visceraMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.18,
      metalness: 0.0,
      clearcoat: 0.98,
      clearcoatRoughness: 0.08,
    });
    this.boneMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.56,
      metalness: 0.0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.34,
    });
    this.carrionFlyMat = new THREE.MeshStandardMaterial({
      color: 0x111318,
      roughness: 0.32,
      metalness: 0.36,
    });
    this.steelGlintMat = new THREE.MeshStandardMaterial({
      color: 0xd5dce3,
      emissive: 0x8a6d45,
      emissiveIntensity: 0.45,
      roughness: 0.24,
      metalness: 0.88,
    });
  }

  getWarmupMaterials(): THREE.Material[] {
    return [
      this.bloodFreshMat,
      this.bloodDarkMat,
      this.bloodClotMat,
      this.fleshMat,
      this.visceraMat,
      this.boneMat,
      this.carrionFlyMat,
      this.steelGlintMat,
    ];
  }

  /** Spawns directional blood spray, tumbling 3D gibs, blood pools, and carrion flies for a combat hit. */
  spawnImpact(spark: CombatSparkVisual): void {
    const kind = spark.kind ?? 'clash';
    const px = spark.position.x;
    const py = spark.position.y;
    const pz = spark.position.z;
    const now = spark.createdAt;
    const scale = Math.max(0.55, Math.min(1.65, spark.victimScale ?? 1.0));
    const hasDir =
      spark.impactDir !== undefined &&
      Math.hypot(spark.impactDir.x, spark.impactDir.z) > 0.01;
    const dirX = hasDir ? spark.impactDir!.x : Math.cos(now * 17.3);
    const dirZ = hasDir ? spark.impactDir!.z : Math.sin(now * 17.3);
    const peltHex = spark.victimColorHex ?? 0x6b4b38;
    const secondaryHex = spark.victimSecondaryColorHex ?? peltHex;

    if (kind === 'clash') {
      // Weapon-on-shield parry: restrained metallic steel slivers + small grazing blood drops
      this.spawnSteelGlints(px, py, pz, dirX, dirZ, now, 5);
      this.spawnBloodSpray(px, py, pz, dirX, dirZ, now, 4, 2.2, 0.72 * scale, 0.35, 0.24);
      return;
    }

    if (kind === 'hit') {
      this.spawnBloodSpray(px, py, pz, dirX, dirZ, now, 12, 3.3, 0.9 * scale, 0.48, 0.34);
      this.spawnBloodMist(px, py, pz, dirX, dirZ, now, 3, 0.42 * scale, 0.36);
      this.spawnGibBurst(px, py, pz, dirX, dirZ, now, {
        flesh: 1,
        viscera: 0,
        bone: 0,
        pelt: 2,
        scale: scale * 0.72,
        speed: 2.4,
        duration: 30,
        peltHex,
        secondaryHex,
      });
      this.spawnGroundBloodStain(
        px + dirX * 0.32,
        pz + dirZ * 0.32,
        now,
        0.2,
        (0.45 + Math.random() * 0.25) * scale,
        0.9,
        58,
        0.86,
      );
      return;
    }

    if (kind === 'heavy_hit') {
      this.spawnBloodSpray(px, py, pz, dirX, dirZ, now, 20, 4.4, 1.12 * scale, 0.55, 0.44);
      this.spawnBloodMist(px, py, pz, dirX, dirZ, now, 5, 0.62 * scale, 0.46);
      this.spawnGibBurst(px, py, pz, dirX, dirZ, now, {
        flesh: 3,
        viscera: 1,
        bone: 1,
        pelt: 2,
        scale: scale * 0.92,
        speed: 3.4,
        duration: 50,
        peltHex,
        secondaryHex,
      });
      this.spawnGroundBloodStain(
        px + dirX * 0.42,
        pz + dirZ * 0.42,
        now,
        0.28,
        (0.78 + Math.random() * 0.34) * scale,
        1.45,
        78,
        0.9,
      );
      return;
    }

    // Fatal blow: violent gibbing rupture, heavy arterial eruption, spreading blood pool & carrion flies
    this.spawnBloodSpray(px, py, pz, dirX, dirZ, now, 30, 5.4, 1.28 * scale, 0.64, 0.56);
    this.spawnBloodMist(px, py, pz, dirX, dirZ, now, 7, 0.88 * scale, 0.58);
    this.spawnGibBurst(px, py, pz, dirX, dirZ, now, {
      flesh: 4,
      viscera: 3,
      bone: 3,
      pelt: 4,
      scale: scale * 1.1,
      speed: 4.3,
      duration: 92,
      peltHex,
      secondaryHex,
    });

    // Primary expanding pool beneath the slain creature + satellite pools along the blow
    const mainRadius = (1.35 + Math.random() * 0.55) * scale;
    this.spawnGroundBloodStain(px, pz, now, 0.32, mainRadius, 2.5, 112, 0.94);
    for (let i = 0; i < 3; i++) {
      const ang = Math.atan2(dirZ, dirX) + (Math.random() - 0.5) * 2.4;
      const dist = (0.55 + Math.random() * 1.25) * scale;
      this.spawnGroundBloodStain(
        px + Math.cos(ang) * dist,
        pz + Math.sin(ang) * dist,
        now,
        0.16,
        (0.42 + Math.random() * 0.42) * scale,
        1.2 + Math.random() * 0.8,
        88 + Math.random() * 24,
        0.88,
      );
    }

    this.spawnCarrionSwarm(px, pz, now, 78);
  }

  /** Spawns dripping blood droplets from a wounded or routed creature, leaving a grim blood trail. */
  spawnWoundDrip(x: number, y: number, z: number, now: number, scale = 1.0): void {
    const count = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      this.pushDroplet({
        x: x + (Math.random() - 0.5) * 0.24 * scale,
        y: y + (0.28 + Math.random() * 0.28) * scale,
        z: z + (Math.random() - 0.5) * 0.24 * scale,
        vx: (Math.random() - 0.5) * 0.55,
        vy: 0.15 + Math.random() * 0.35,
        vz: (Math.random() - 0.5) * 0.55,
        gravity: 11.5,
        baseScale: (0.72 + Math.random() * 0.45) * Math.max(0.6, scale),
        createdAt: now,
        duration: 1.1,
        stainChance: 0.72,
        stainRadius: (0.2 + Math.random() * 0.16) * Math.max(0.65, scale),
        dark: Math.random() < 0.5,
      });
    }
  }

  update(dt: number, now: number): void {
    const safeDt = Math.max(0, Math.min(dt, 0.1));

    // 1. Ballistic wet arterial blood droplets
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      const age = now - d.createdAt;
      if (age >= d.duration) {
        this.group.remove(d.mesh);
        this.droplets.splice(i, 1);
        continue;
      }

      d.vy -= d.gravity * safeDt;
      d.mesh.position.x += d.vx * safeDt;
      d.mesh.position.y += d.vy * safeDt;
      d.mesh.position.z += d.vz * safeDt;

      const groundY = Math.max(
        this.world.terrain.getHeightAt(d.mesh.position.x, d.mesh.position.z),
        this.world.getEffectiveWaterLevel(),
      );
      if (d.mesh.position.y <= groundY + 0.03) {
        if (Math.random() < d.stainChance) {
          this.spawnGroundBloodStain(
            d.mesh.position.x,
            d.mesh.position.z,
            now,
            d.stainRadius * 0.45,
            d.stainRadius,
            0.35,
            44 + Math.random() * 24,
            0.82,
          );
        }
        this.group.remove(d.mesh);
        this.droplets.splice(i, 1);
        continue;
      }

      const speed = Math.hypot(d.vx, d.vy, d.vz);
      if (speed > 0.08) {
        this.scratchLook.set(
          d.mesh.position.x + d.vx,
          d.mesh.position.y + d.vy,
          d.mesh.position.z + d.vz,
        );
        d.mesh.lookAt(this.scratchLook);
        const stretch = Math.min(2.15, 0.85 + speed * 0.22);
        d.mesh.scale.set(d.baseScale, d.baseScale, d.baseScale * stretch);
      }
    }

    // 2. Brief non-additive dark crimson blood aerosol mist
    for (let i = this.mists.length - 1; i >= 0; i--) {
      const m = this.mists[i];
      const pct = (now - m.createdAt) / m.duration;
      if (pct >= 1) {
        this.group.remove(m.mesh);
        m.mat.dispose();
        this.mists.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-3.4 * safeDt);
      m.vx *= drag;
      m.vz *= drag;
      m.vy -= 1.8 * safeDt;
      m.mesh.position.x += m.vx * safeDt;
      m.mesh.position.y += m.vy * safeDt;
      m.mesh.position.z += m.vz * safeDt;
      const sc = THREE.MathUtils.lerp(m.startScale, m.endScale, 1 - Math.pow(1 - pct, 2));
      m.mesh.scale.setScalar(sc);
      m.mesh.rotation.y += safeDt * m.spinRate;
      m.mesh.rotation.x += safeDt * m.spinRate * 0.6;
      m.mat.opacity = m.baseOpacity * (1 - pct) * (1 - pct);
    }

    // 3. Restrained metallic weapon-parry slivers
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i];
      const pct = (now - g.createdAt) / g.duration;
      if (pct >= 1) {
        this.group.remove(g.mesh);
        this.glints.splice(i, 1);
        continue;
      }
      g.vy -= 9.5 * safeDt;
      g.mesh.position.x += g.vx * safeDt;
      g.mesh.position.y += g.vy * safeDt;
      g.mesh.position.z += g.vz * safeDt;
      const speed = Math.hypot(g.vx, g.vy, g.vz);
      if (speed > 0.05) {
        this.scratchLook.set(
          g.mesh.position.x + g.vx,
          g.mesh.position.y + g.vy,
          g.mesh.position.z + g.vz,
        );
        g.mesh.lookAt(this.scratchLook);
      }
      const fade = Math.max(0.01, (1 - pct) * g.baseScale);
      g.mesh.scale.set(fade, fade, fade * (1.2 + speed * 0.14));
    }

    // 4. Physical bouncing, tumbling, and lingering 3D gibs (flesh, viscera, bones, torn fur chunks)
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const gib = this.gibs[i];
      const pct = (now - gib.createdAt) / gib.duration;
      if (pct >= 1) {
        this.group.remove(gib.object);
        this.gibs.splice(i, 1);
        continue;
      }

      if (!gib.settled) {
        gib.vy -= 13.8 * safeDt;
        gib.object.position.x += gib.vx * safeDt;
        gib.object.position.y += gib.vy * safeDt;
        gib.object.position.z += gib.vz * safeDt;
        gib.object.rotation.x += gib.rx * safeDt;
        gib.object.rotation.y += gib.ry * safeDt;
        gib.object.rotation.z += gib.rz * safeDt;

        const terrainY = this.world.terrain.getHeightAt(
          gib.object.position.x,
          gib.object.position.z,
        );
        const floorY = terrainY + gib.restHeight;
        if (gib.object.position.y <= floorY) {
          gib.object.position.y = floorY;
          gib.groundY = terrainY;
          if (gib.bounces === 0 && Math.random() < 0.78) {
            this.spawnGroundBloodStain(
              gib.object.position.x,
              gib.object.position.z,
              now,
              0.16,
              (0.28 + Math.random() * 0.24) * gib.baseScale,
              0.65,
              64,
              0.84,
            );
          }
          gib.bounces++;
          if (Math.abs(gib.vy) > 1.25 && gib.bounces <= 2) {
            // Wet heavy dampened bounce
            gib.vy = Math.abs(gib.vy) * (0.24 + Math.random() * 0.1);
            gib.vx *= 0.44;
            gib.vz *= 0.44;
            gib.rx *= 0.45;
            gib.ry *= 0.45;
            gib.rz *= 0.45;
          } else {
            gib.vx = 0;
            gib.vy = 0;
            gib.vz = 0;
            gib.rx = 0;
            gib.ry = 0;
            gib.rz = 0;
            gib.settled = true;
          }
        }
      } else if (pct > 0.86) {
        // Slowly sink into soil & shrink away near the end of its long lingering lifetime
        const sinkFrac = (pct - 0.86) / 0.14;
        gib.object.position.y = gib.groundY + gib.restHeight * (1 - sinkFrac * 1.4);
        gib.object.scale.setScalar(Math.max(0.01, gib.baseScale * (1 - sinkFrac * 0.92)));
      }
    }

    // 5. Spreading, coagulating, darkening ground blood pools & splatters
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const st = this.stains[i];
      const age = now - st.createdAt;
      const pct = age / st.duration;
      if (pct >= 1) {
        this.group.remove(st.mesh);
        st.mat.dispose();
        this.stains.splice(i, 1);
        continue;
      }

      const spreadT = st.spreadDuration > 0 ? Math.min(1, age / st.spreadDuration) : 1;
      const easeSpread = 1 - Math.pow(1 - spreadT, 2.4);
      const radius = THREE.MathUtils.lerp(st.startRadius, st.targetRadius, easeSpread);
      st.mesh.scale.set(radius, 1, radius);

      // Coagulate from glossy arterial crimson into darker dried rust-black blood over time
      const dryT = Math.min(1, pct * 1.45);
      st.mat.color.copy(st.freshColor).lerp(st.dryColor, dryT);
      st.mat.clearcoat = st.isWaterSlick ? 0.5 : THREE.MathUtils.lerp(0.98, 0.22, dryT);
      st.mat.roughness = st.isWaterSlick ? 0.22 : THREE.MathUtils.lerp(0.14, 0.72, dryT);

      const fadeIn = Math.min(1, age / 0.14);
      const fadeOut = pct > 0.75 ? 1 - (pct - 0.75) / 0.25 : 1;
      st.mat.opacity = st.maxOpacity * fadeIn * fadeOut;
    }

    // 6. Twitching carrion flies hovering over fatal gore sites
    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const sw = this.swarms[i];
      const pct = (now - sw.createdAt) / sw.duration;
      if (pct >= 1) {
        this.group.remove(sw.group);
        this.swarms.splice(i, 1);
        continue;
      }
      const appear = Math.min(1, Math.max(0, (now - sw.createdAt - 1.2) / 1.5));
      const vanish = pct > 0.85 ? 1 - (pct - 0.85) / 0.15 : 1;
      const visScale = appear * vanish;
      sw.group.visible = visScale > 0.02;
      if (!sw.group.visible) continue;

      for (let j = 0; j < sw.flies.length; j++) {
        const f = sw.flies[j];
        const ang = now * f.orbitSpeed + f.phase;
        const jitter = Math.sin(now * 19 + f.phase * 3.1) * 0.045;
        const fx = Math.cos(ang) * f.orbitRadius + jitter;
        const fz = Math.sin(ang * f.figureEight) * f.orbitRadius * 0.82 - jitter;
        const fy = f.heightOffset + Math.sin(now * 5.2 + f.phase * 2) * 0.11;
        f.mesh.position.set(fx, fy, fz);
        f.mesh.rotation.y = -ang;
        f.mesh.scale.setScalar(visScale);
      }
    }
  }

  private getSpeciesPeltGibMat(colorHex: number): THREE.MeshPhysicalMaterial {
    const existing = this.peltGibMats.get(colorHex);
    if (existing) return existing;

    // Soak the victim's fur/feathers in dark blood so the torn chunk is grimly recognizable
    const soaked = new THREE.Color(colorHex).lerp(new THREE.Color(0x4a0508), 0.42);
    const mat = new THREE.MeshPhysicalMaterial({
      color: soaked,
      roughness: 0.72,
      metalness: 0.0,
      clearcoat: 0.36,
      clearcoatRoughness: 0.28,
    });
    this.peltGibMats.set(colorHex, mat);
    return mat;
  }

  private spawnBloodSpray(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    now: number,
    count: number,
    speed: number,
    scale: number,
    stainChance: number,
    stainRadius: number,
  ): void {
    const baseAngle = Math.atan2(dirZ, dirX);
    for (let i = 0; i < count; i++) {
      // 70% spray violently forward along the weapon blow; 30% burst radially in back-spatter
      const directional = i < count * 0.7;
      const spreadAng = directional
        ? baseAngle + (Math.random() - 0.5) * 1.25
        : Math.random() * Math.PI * 2;
      const spd = speed * (directional ? 0.55 + Math.random() * 0.95 : 0.28 + Math.random() * 0.65);
      this.pushDroplet({
        x: x + (Math.random() - 0.5) * 0.24,
        y: y + (Math.random() - 0.35) * 0.28,
        z: z + (Math.random() - 0.5) * 0.24,
        vx: Math.cos(spreadAng) * spd,
        vy: 1.2 + Math.random() * (speed * 0.72),
        vz: Math.sin(spreadAng) * spd,
        gravity: 12.8 + Math.random() * 2.4,
        baseScale: (0.68 + Math.random() * 0.85) * scale,
        createdAt: now,
        duration: 1.45,
        stainChance,
        stainRadius: stainRadius * (0.65 + Math.random() * 0.7),
        dark: i % 3 === 0,
      });
    }
  }

  private pushDroplet(params: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    gravity: number;
    baseScale: number;
    createdAt: number;
    duration: number;
    stainChance: number;
    stainRadius: number;
    dark: boolean;
  }): void {
    if (this.droplets.length >= MAX_DROPLETS) {
      const oldest = this.droplets.shift();
      if (oldest) this.group.remove(oldest.mesh);
    }
    const mesh = new THREE.Mesh(
      this.geo.bloodDrop,
      params.dark ? this.bloodDarkMat : this.bloodFreshMat,
    );
    mesh.name = 'blood_droplet';
    mesh.position.set(params.x, params.y, params.z);
    mesh.scale.setScalar(params.baseScale);
    this.group.add(mesh);
    this.droplets.push({
      mesh,
      createdAt: params.createdAt,
      duration: params.duration,
      vx: params.vx,
      vy: params.vy,
      vz: params.vz,
      gravity: params.gravity,
      baseScale: params.baseScale,
      stainChance: params.stainChance,
      stainRadius: params.stainRadius,
    });
  }

  private spawnBloodMist(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    now: number,
    count: number,
    scale: number,
    duration: number,
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.mists.length >= MAX_MIST) {
        const oldest = this.mists.shift();
        if (oldest) {
          this.group.remove(oldest.mesh);
          oldest.mat.dispose();
        }
      }
      const shade = i % 2 === 0 ? 0x5c0508 : 0x380305;
      const baseOpacity = 0.42 + Math.random() * 0.16;
      const mat = new THREE.MeshBasicMaterial({
        color: shade,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geo.bloodMist, mat);
      mesh.name = 'blood_mist';
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.25,
        y + (Math.random() - 0.3) * 0.24,
        z + (Math.random() - 0.5) * 0.25,
      );
      const startScale = (0.45 + Math.random() * 0.35) * scale;
      mesh.scale.setScalar(startScale);
      this.group.add(mesh);
      this.mists.push({
        mesh,
        mat,
        createdAt: now,
        duration: duration * (0.8 + Math.random() * 0.4),
        vx: dirX * (0.9 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.1,
        vy: 0.45 + Math.random() * 0.9,
        vz: dirZ * (0.9 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.1,
        startScale,
        endScale: startScale * (2.2 + Math.random() * 0.8),
        baseOpacity,
        spinRate: (Math.random() - 0.5) * 3.5,
      });
    }
  }

  private spawnSteelGlints(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    now: number,
    count: number,
  ): void {
    const perpX = -dirZ;
    const perpZ = dirX;
    for (let i = 0; i < count; i++) {
      if (this.glints.length >= MAX_GLINTS) {
        const oldest = this.glints.shift();
        if (oldest) this.group.remove(oldest.mesh);
      }
      const mesh = new THREE.Mesh(this.geo.steelSliver, this.steelGlintMat);
      mesh.name = 'steel_glint';
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.14,
        y + (Math.random() - 0.5) * 0.14,
        z + (Math.random() - 0.5) * 0.14,
      );
      const side = (Math.random() - 0.5) * 4.8;
      const fwd = (Math.random() - 0.5) * 2.2;
      const baseScale = 0.72 + Math.random() * 0.45;
      mesh.scale.setScalar(baseScale);
      this.group.add(mesh);
      this.glints.push({
        mesh,
        createdAt: now,
        duration: 0.2 + Math.random() * 0.14,
        vx: perpX * side + dirX * fwd,
        vy: 1.4 + Math.random() * 2.2,
        vz: perpZ * side + dirZ * fwd,
        baseScale,
      });
    }
  }

  private spawnGibBurst(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    now: number,
    cfg: {
      flesh: number;
      viscera: number;
      bone: number;
      pelt: number;
      scale: number;
      speed: number;
      duration: number;
      peltHex: number;
      secondaryHex: number;
    },
  ): void {
    const launch = (object: THREE.Object3D, baseScale: number, restHeight: number) => {
      if (this.gibs.length >= MAX_GIBS) {
        const oldest = this.gibs.shift();
        if (oldest) this.group.remove(oldest.object);
      }
      const baseAng = Math.atan2(dirZ, dirX);
      const ang =
        Math.random() < 0.65
          ? baseAng + (Math.random() - 0.5) * 1.65
          : Math.random() * Math.PI * 2;
      const spd = cfg.speed * (0.35 + Math.random() * 0.85);
      object.position.set(
        x + (Math.random() - 0.5) * 0.28,
        y + (Math.random() - 0.25) * 0.28,
        z + (Math.random() - 0.5) * 0.28,
      );
      object.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );
      object.scale.setScalar(baseScale);
      this.group.add(object);
      this.gibs.push({
        object,
        createdAt: now,
        duration: cfg.duration * (0.82 + Math.random() * 0.36),
        vx: Math.cos(ang) * spd,
        vy: 1.9 + Math.random() * (cfg.speed * 0.72),
        vz: Math.sin(ang) * spd,
        rx: (Math.random() - 0.5) * 14,
        ry: (Math.random() - 0.5) * 14,
        rz: (Math.random() - 0.5) * 14,
        baseScale,
        restHeight: restHeight * baseScale,
        settled: false,
        bounces: 0,
        groundY: this.world.terrain.getHeightAt(x, z),
      });
    };

    for (let i = 0; i < cfg.flesh; i++) {
      const geo = i % 2 === 0 ? this.geo.gibFlesh : this.geo.gibMeatChunk;
      const mesh = new THREE.Mesh(geo, i % 3 === 0 ? this.bloodClotMat : this.fleshMat);
      mesh.name = 'gib_flesh';
      mesh.castShadow = true;
      launch(mesh, cfg.scale * (0.76 + Math.random() * 0.52), 0.055);
    }

    for (let i = 0; i < cfg.viscera; i++) {
      const mesh = new THREE.Mesh(this.geo.gibViscera, this.visceraMat);
      mesh.name = 'gib_viscera';
      mesh.castShadow = true;
      launch(mesh, cfg.scale * (0.85 + Math.random() * 0.45), 0.042);
    }

    for (let i = 0; i < cfg.bone; i++) {
      const mesh = new THREE.Mesh(this.geo.gibBone, this.boneMat);
      mesh.name = 'gib_bone';
      mesh.castShadow = true;
      launch(mesh, cfg.scale * (0.82 + Math.random() * 0.48), 0.032);
    }

    for (let i = 0; i < cfg.pelt; i++) {
      const chunkGroup = new THREE.Group();
      chunkGroup.name = 'gib_pelt_chunk';
      const hex = i % 2 === 0 ? cfg.peltHex : cfg.secondaryHex;
      const peltMesh = new THREE.Mesh(this.geo.gibPelt, this.getSpeciesPeltGibMat(hex));
      peltMesh.castShadow = true;
      chunkGroup.add(peltMesh);

      // Torn wet crimson flesh exposed on the ripped underside of the pelt chunk
      const rawCore = new THREE.Mesh(this.geo.gibMeatChunk, this.fleshMat);
      rawCore.position.set(0.045, -0.025, 0.02);
      rawCore.scale.setScalar(0.82);
      chunkGroup.add(rawCore);

      launch(chunkGroup, cfg.scale * (0.78 + Math.random() * 0.52), 0.068);
    }
  }

  private spawnGroundBloodStain(
    x: number,
    z: number,
    now: number,
    startRadius: number,
    targetRadius: number,
    spreadDuration: number,
    duration: number,
    maxOpacity: number,
  ): void {
    if (this.stains.length >= MAX_STAINS) {
      const oldest = this.stains.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        oldest.mat.dispose();
      }
    }

    const terrainY = this.world.terrain.getHeightAt(x, z);
    const waterY = this.world.getEffectiveWaterLevel();
    const isWaterSlick = terrainY < waterY + 0.03;

    const freshColor = new THREE.Color(isWaterSlick ? 0x6b070c : 0x7a0509);
    const dryColor = new THREE.Color(isWaterSlick ? 0x3d080c : 0x220405);
    const mat = new THREE.MeshPhysicalMaterial({
      color: freshColor.clone(),
      roughness: isWaterSlick ? 0.22 : 0.14,
      metalness: 0.02,
      clearcoat: isWaterSlick ? 0.5 : 0.98,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: maxOpacity * 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const variantGeo =
      this.geo.bloodSplatters[this.stainLayerCounter % this.geo.bloodSplatters.length];
    const layerJitter = (this.stainLayerCounter % 16) * 0.0012;
    this.stainLayerCounter++;

    const mesh = new THREE.Mesh(variantGeo, mat);
    mesh.name = targetRadius >= 0.9 ? 'blood_pool' : 'blood_stain';
    mesh.renderOrder = 1;

    if (isWaterSlick) {
      mesh.position.set(x, waterY + 0.022 + layerJitter, z);
      mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    } else {
      const eps = 0.45;
      const hL = this.world.terrain.getHeightAt(x - eps, z);
      const hR = this.world.terrain.getHeightAt(x + eps, z);
      const hD = this.world.terrain.getHeightAt(x, z - eps);
      const hU = this.world.terrain.getHeightAt(x, z + eps);
      this.scratchNormal.set(hL - hR, 2 * eps, hD - hU).normalize();
      this.scratchQuat.setFromUnitVectors(UP_VEC, this.scratchNormal);
      this.scratchYawQuat.setFromAxisAngle(UP_VEC, Math.random() * Math.PI * 2);
      mesh.quaternion.copy(this.scratchQuat).multiply(this.scratchYawQuat);
      mesh.position.set(x, terrainY + 0.032 + layerJitter, z);
    }

    mesh.scale.set(startRadius, 1, startRadius);
    this.group.add(mesh);

    this.stains.push({
      mesh,
      mat,
      createdAt: now,
      duration: isWaterSlick ? Math.min(duration, 26) : duration,
      spreadDuration,
      startRadius,
      targetRadius,
      maxOpacity: isWaterSlick ? maxOpacity * 0.65 : maxOpacity,
      isWaterSlick,
      freshColor,
      dryColor,
    });
  }

  private spawnCarrionSwarm(x: number, z: number, now: number, duration: number): void {
    const terrainY = this.world.terrain.getHeightAt(x, z);
    if (terrainY < this.world.getEffectiveWaterLevel() + 0.05) return;

    if (this.swarms.length >= MAX_SWARMS) {
      const oldest = this.swarms.shift();
      if (oldest) this.group.remove(oldest.group);
    }

    const group = new THREE.Group();
    group.name = 'carrion_swarm';
    group.position.set(x, terrainY + 0.05, z);
    const flies: CarrionFlyData[] = [];
    const flyCount = 6;
    for (let i = 0; i < flyCount; i++) {
      const mesh = new THREE.Mesh(this.geo.carrionFly, this.carrionFlyMat);
      mesh.name = 'carrion_fly';
      group.add(mesh);
      flies.push({
        mesh,
        orbitRadius: 0.26 + Math.random() * 0.48,
        orbitSpeed: (2.6 + Math.random() * 2.4) * (i % 2 === 0 ? 1 : -1),
        heightOffset: 0.22 + Math.random() * 0.44,
        phase: Math.random() * Math.PI * 2,
        figureEight: i % 2 === 0 ? 2 : 1,
      });
    }
    this.group.add(group);
    this.swarms.push({
      group,
      flies,
      createdAt: now,
      duration,
    });
  }

  dispose(): void {
    for (const d of this.droplets) this.group.remove(d.mesh);
    this.droplets.length = 0;

    for (const m of this.mists) {
      this.group.remove(m.mesh);
      m.mat.dispose();
    }
    this.mists.length = 0;

    for (const g of this.glints) this.group.remove(g.mesh);
    this.glints.length = 0;

    for (const gib of this.gibs) this.group.remove(gib.object);
    this.gibs.length = 0;

    for (const st of this.stains) {
      this.group.remove(st.mesh);
      st.mat.dispose();
    }
    this.stains.length = 0;

    for (const sw of this.swarms) this.group.remove(sw.group);
    this.swarms.length = 0;

    this.geo.bloodDrop.dispose();
    this.geo.bloodMist.dispose();
    this.geo.steelSliver.dispose();
    this.geo.gibFlesh.dispose();
    this.geo.gibMeatChunk.dispose();
    this.geo.gibViscera.dispose();
    this.geo.gibBone.dispose();
    this.geo.gibPelt.dispose();
    this.geo.carrionFly.dispose();
    for (const sp of this.geo.bloodSplatters) sp.dispose();

    this.bloodFreshMat.dispose();
    this.bloodDarkMat.dispose();
    this.bloodClotMat.dispose();
    this.fleshMat.dispose();
    this.visceraMat.dispose();
    this.boneMat.dispose();
    this.carrionFlyMat.dispose();
    this.steelGlintMat.dispose();
    for (const mat of this.peltGibMats.values()) {
      mat.dispose();
    }
    this.peltGibMats.clear();
  }
}
