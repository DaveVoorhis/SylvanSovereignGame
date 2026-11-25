import * as THREE from 'three';
import type {
  CombatSparkVisual,
  ConstructionStage,
  SelectionTarget,
  SpeciesId,
  VillageAdaptationId,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import { VILLAGE_ADAPTATION_CATALOG } from '@simulation/settlements/VillageAdaptation';
import type { WorldState } from '@simulation/WorldState';
import {
  createOrganicPuffGeo,
  createTaperedTubeGeo,
  mergePartGeometries,
} from './GeometryHelpers';
import type { TextureLibrary } from './ProceduralTextures';

interface WorkToolKit {
  readonly axe: THREE.Group;
  readonly spade: THREE.Group;
  readonly trowel: THREE.Group;
  readonly hammer: THREE.Group;
}

interface CreatureRig {
  readonly root: THREE.Group;
  readonly bodyGroup: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly leftArm?: THREE.Object3D;
  readonly rightArm?: THREE.Object3D;
  readonly leftFoot?: THREE.Object3D;
  readonly rightFoot?: THREE.Object3D;
  readonly leftEar?: THREE.Object3D;
  readonly rightEar?: THREE.Object3D;
  readonly tail?: THREE.Object3D;
  readonly selectionGroup: THREE.Group;
  readonly workTools: WorkToolKit;
  readonly idleBuilderMallet?: THREE.Group;
  readonly pioneerPack: THREE.Group;
  readonly seedPhase: number;
  readonly baseLeftEarZ: number;
  readonly baseRightEarZ: number;
  readonly baseTailX: number;
  workChipCooldown: number;
  readonly adaptation: VillageAdaptationId;
}

interface SparkVisual {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  readonly createdAt: number;
  readonly duration: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
}

interface SpeciesMaterialSet {
  readonly primary: THREE.MeshStandardMaterial;
  readonly secondary: THREE.MeshStandardMaterial;
  readonly accent: THREE.MeshStandardMaterial;
  readonly cloak: THREE.MeshStandardMaterial;
  readonly scarf: THREE.MeshStandardMaterial;
}

interface SharedGeometries {
  readonly tunic: THREE.BufferGeometry;
  readonly mantle: THREE.BufferGeometry;
  readonly belt: THREE.BufferGeometry;
  readonly buckle: THREE.BufferGeometry;
  readonly head: THREE.BufferGeometry;
  readonly eye: THREE.BufferGeometry;
  readonly catchlightBig: THREE.BufferGeometry;
  readonly catchlightSmall: THREE.BufferGeometry;
  readonly blush: THREE.BufferGeometry;
  readonly nose: THREE.BufferGeometry;
  readonly whisker: THREE.BufferGeometry;
  readonly arm: THREE.BufferGeometry;
  readonly paw: THREE.BufferGeometry;
  readonly boot: THREE.BufferGeometry;
  readonly webbedFoot: THREE.BufferGeometry;
  readonly birdFoot: THREE.BufferGeometry;
  readonly wingLeft: THREE.BufferGeometry;
  readonly wingRight: THREE.BufferGeometry;
  readonly birdTail: THREE.BufferGeometry;
  readonly squirrelTail: THREE.BufferGeometry;
  readonly foxTailMain: THREE.BufferGeometry;
  readonly foxTailTip: THREE.BufferGeometry;
  readonly rodentTail: THREE.BufferGeometry;
  readonly bunnyTail: THREE.BufferGeometry;
  readonly hedgehogQuills: THREE.BufferGeometry;
  readonly wizardHat: THREE.BufferGeometry;
  readonly acornHat: THREE.BufferGeometry;
  readonly selectionRing: THREE.BufferGeometry;
  readonly sparkStar: THREE.BufferGeometry;
  readonly reedHat: THREE.BufferGeometry;
  readonly strawHat: THREE.BufferGeometry;
  readonly furCollar: THREE.BufferGeometry;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function buildLayeredWingGeo(side: -1 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Plump feathered wing shoulder covert
  const shoulder = new THREE.SphereGeometry(0.14, 12, 10);
  shoulder.scale(1.4, 0.45, 0.92);
  shoulder.translate(side * 0.14, 0.01, -0.01);
  parts.push(shoulder);

  // 5 layered fanned primary & secondary flight feathers
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const len = THREE.MathUtils.lerp(0.36, 0.22, t);
    const feather = new THREE.CapsuleGeometry(0.036 - t * 0.004, len, 5, 8);
    feather.rotateZ(Math.PI / 2);
    feather.scale(1.0, 0.36, 1.15);
    const fanAngle = side * (0.08 - t * 0.48);
    feather.rotateY(fanAngle);
    feather.translate(side * (0.22 + (1 - t) * 0.12), -t * 0.012, -0.02 - t * 0.085);
    parts.push(feather);
  }

  return mergePartGeometries(parts, false);
}

function buildBirdTailGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) {
    const feather = new THREE.CapsuleGeometry(0.032, 0.24 - Math.abs(i) * 0.02, 5, 8);
    feather.rotateX(Math.PI / 2);
    feather.scale(1.0, 0.32, 1.0);
    feather.rotateY(i * 0.18);
    feather.translate(i * 0.045, 0, -0.14);
    parts.push(feather);
  }
  return mergePartGeometries(parts, false);
}

function buildHedgehogQuillsGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Plump inner quill-dome cushion
  const base = createOrganicPuffGeo(0.34, 2, 0.08, 3.1);
  base.scale(1.05, 1.08, 1.12);
  parts.push(base);

  // 34 sculpted tapered quills radiating neatly backward & upward
  const rings: { elev: number; count: number; len: number; r: number }[] = [
    { elev: 0.72, count: 6, len: 0.2, r: 0.032 },
    { elev: 0.38, count: 10, len: 0.24, r: 0.034 },
    { elev: 0.04, count: 10, len: 0.24, r: 0.034 },
    { elev: -0.28, count: 8, len: 0.2, r: 0.03 },
  ];

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      // Arrange across the back hemisphere (-120 deg to +120 deg around -Z)
      const frac = ring.count > 1 ? i / (ring.count - 1) : 0.5;
      const azim = Math.PI + (frac - 0.5) * Math.PI * 1.45;
      const cosE = Math.cos(ring.elev);
      dir.set(Math.sin(azim) * cosE, Math.sin(ring.elev) + 0.18, Math.cos(azim) * cosE).normalize();

      const quill = new THREE.ConeGeometry(ring.r, ring.len, 7);
      quill.translate(0, ring.len * 0.5, 0);
      quat.setFromUnitVectors(up, dir);
      quill.applyQuaternion(quat);
      quill.translate(dir.x * 0.25, dir.y * 0.27, dir.z * 0.28);
      parts.push(quill);
    }
  }
  return mergePartGeometries(parts, false);
}

function buildWizardHatGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Soft undulating wide brim
  const brimPts = [
    new THREE.Vector2(0.14, 0.02),
    new THREE.Vector2(0.26, 0.0),
    new THREE.Vector2(0.36, -0.02),
    new THREE.Vector2(0.38, 0.0),
    new THREE.Vector2(0.34, 0.03),
    new THREE.Vector2(0.18, 0.06),
  ];
  parts.push(new THREE.LatheGeometry(brimPts, 20));

  // Whimsical crooked curving hat spire
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.03, 0),
    new THREE.Vector3(0.03, 0.22, -0.02),
    new THREE.Vector3(0.11, 0.4, -0.06),
    new THREE.Vector3(0.24, 0.46, -0.09),
  ]);
  parts.push(
    createTaperedTubeGeo(curve, 14, 14, (t) => THREE.MathUtils.lerp(0.2, 0.015, Math.pow(t, 0.85)), true),
  );
  return mergePartGeometries(parts, false);
}

function buildAcornHatGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const capPts = [
    new THREE.Vector2(0.26, 0.0),
    new THREE.Vector2(0.27, 0.05),
    new THREE.Vector2(0.23, 0.13),
    new THREE.Vector2(0.13, 0.19),
    new THREE.Vector2(0.0, 0.21),
  ];
  parts.push(new THREE.LatheGeometry(capPts, 18));

  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.19, 0),
    new THREE.Vector3(0.02, 0.27, -0.01),
    new THREE.Vector3(0.06, 0.31, -0.02),
  ]);
  parts.push(createTaperedTubeGeo(stemCurve, 6, 6, (t) => THREE.MathUtils.lerp(0.032, 0.022, t), true));
  return mergePartGeometries(parts, false);
}

function buildReedHatGeo(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.42, -0.02),
    new THREE.Vector2(0.32, 0.05),
    new THREE.Vector2(0.18, 0.14),
    new THREE.Vector2(0.06, 0.2),
    new THREE.Vector2(0.0, 0.22),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

function buildStrawHatGeo(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.4, 0.0),
    new THREE.Vector2(0.27, 0.03),
    new THREE.Vector2(0.24, 0.14),
    new THREE.Vector2(0.16, 0.17),
    new THREE.Vector2(0.0, 0.175),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

function buildWebbedFootGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.09, 0.16);
  shape.quadraticCurveTo(-0.04, 0.12, 0, 0.18);
  shape.quadraticCurveTo(0.04, 0.12, 0.09, 0.16);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelSize: 0.01,
    bevelThickness: 0.01,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.03, -0.04);
  return geo;
}

function buildBirdFootGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const ang of [-0.45, 0, 0.45]) {
    const toe = new THREE.CapsuleGeometry(0.016, 0.11, 4, 6);
    toe.rotateX(Math.PI / 2);
    toe.rotateY(ang);
    toe.translate(Math.sin(ang) * 0.05, 0.02, Math.cos(ang) * 0.06);
    parts.push(toe);
  }
  const ankle = new THREE.CylinderGeometry(0.02, 0.024, 0.14, 8);
  ankle.translate(0, 0.09, 0);
  parts.push(ankle);
  return mergePartGeometries(parts, false);
}

function createSharedGeometries(): SharedGeometries {
  // Pear-shaped cozy pleated woodland tunic
  const tunicPts = [
    new THREE.Vector2(0.0, 0.11),
    new THREE.Vector2(0.32, 0.11),
    new THREE.Vector2(0.37, 0.15),
    new THREE.Vector2(0.34, 0.34),
    new THREE.Vector2(0.26, 0.54),
    new THREE.Vector2(0.24, 0.68),
    new THREE.Vector2(0.18, 0.78),
    new THREE.Vector2(0.0, 0.8),
  ];
  const tunic = new THREE.LatheGeometry(tunicPts, 24);

  // Soft shoulder capelet / mantle
  const mantlePts = [
    new THREE.Vector2(0.34, 0.56),
    new THREE.Vector2(0.31, 0.65),
    new THREE.Vector2(0.24, 0.75),
    new THREE.Vector2(0.15, 0.8),
  ];
  const mantle = new THREE.LatheGeometry(mantlePts, 22);

  const belt = new THREE.TorusGeometry(0.275, 0.032, 10, 22);
  belt.rotateX(Math.PI / 2);

  const buckle = new THREE.BoxGeometry(0.09, 0.085, 0.05);

  // Plush squirrel S-curved bushy plume
  const sqCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.06, -0.22),
    new THREE.Vector3(0, 0.34, -0.34),
    new THREE.Vector3(0, 0.68, -0.26),
    new THREE.Vector3(0, 0.84, -0.38),
  ]);
  const squirrelTail = createTaperedTubeGeo(
    sqCurve,
    18,
    14,
    (t) => 0.07 + Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.145,
    true,
  );

  // Sweeping fox brush tail (main + fluffy tip)
  const foxCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.04, -0.22),
    new THREE.Vector3(0, 0.04, -0.48),
    new THREE.Vector3(0, 0.18, -0.68),
  ]);
  const foxTailMain = createTaperedTubeGeo(
    foxCurve,
    14,
    12,
    (t) => 0.065 + Math.sin(t * Math.PI * 0.92) * 0.095,
    true,
  );
  const foxTailTip = createOrganicPuffGeo(0.115, 2, 0.12, 2.2);
  foxTailTip.scale(0.92, 0.95, 1.38);
  foxTailTip.translate(0, 0.21, -0.74);

  // Graceful curled mouse/rat tail
  const rodentCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.04, -0.06, -0.24),
    new THREE.Vector3(0.16, -0.02, -0.46),
    new THREE.Vector3(0.24, 0.14, -0.58),
  ]);
  const rodentTail = createTaperedTubeGeo(
    rodentCurve,
    14,
    8,
    (t) => THREE.MathUtils.lerp(0.038, 0.012, t),
    true,
  );

  const bunnyTail = createOrganicPuffGeo(0.155, 2, 0.14, 5.5);

  const boot = new THREE.CapsuleGeometry(0.068, 0.09, 6, 10);
  boot.rotateX(Math.PI / 2);
  boot.translate(0, 0.065, 0.03);

  const arm = new THREE.CapsuleGeometry(0.056, 0.19, 6, 10);
  arm.translate(0, -0.11, 0);

  const selectionRing = new THREE.RingGeometry(0.56, 0.72, 36);
  selectionRing.rotateX(-Math.PI / 2);

  const furCollar = new THREE.TorusGeometry(0.235, 0.078, 10, 22);
  furCollar.rotateX(Math.PI / 2);

  return {
    tunic,
    mantle,
    belt,
    buckle,
    head: new THREE.SphereGeometry(0.265, 24, 18),
    eye: new THREE.SphereGeometry(0.054, 14, 12),
    catchlightBig: new THREE.SphereGeometry(0.018, 8, 8),
    catchlightSmall: new THREE.SphereGeometry(0.01, 6, 6),
    blush: new THREE.SphereGeometry(0.055, 10, 8),
    nose: new THREE.SphereGeometry(0.036, 10, 8),
    whisker: new THREE.CylinderGeometry(0.004, 0.002, 0.22, 4),
    arm,
    paw: new THREE.SphereGeometry(0.06, 10, 8),
    boot,
    webbedFoot: buildWebbedFootGeo(),
    birdFoot: buildBirdFootGeo(),
    wingLeft: buildLayeredWingGeo(-1),
    wingRight: buildLayeredWingGeo(1),
    birdTail: buildBirdTailGeo(),
    squirrelTail,
    foxTailMain,
    foxTailTip,
    rodentTail,
    bunnyTail,
    hedgehogQuills: buildHedgehogQuillsGeo(),
    wizardHat: buildWizardHatGeo(),
    acornHat: buildAcornHatGeo(),
    selectionRing,
    sparkStar: new THREE.OctahedronGeometry(0.24, 0),
    reedHat: buildReedHatGeo(),
    strawHat: buildStrawHatGeo(),
    furCollar,
  };
}

/**
 * Renders high-resolution, whimsical, articulated 3D woodland creatures across all 12 species
 * and all 6 settlement roles, featuring plush fur/fabric shading, glossy catchlight eyes,
 * rosy cheeks, layered bird wings, lush curved tails, charming role props, and lively animation.
 */
export class CreatureRenderer {
  readonly rootGroup = new THREE.Group();

  private readonly rigs = new Map<string, CreatureRig>();
  private readonly sparks: SparkVisual[] = [];
  private readonly geo: SharedGeometries;
  private readonly speciesMats = new Map<SpeciesId, SpeciesMaterialSet>();
  private readonly adaptationMats = new Map<
    VillageAdaptationId,
    { readonly mantle: THREE.MeshStandardMaterial; readonly accent: THREE.MeshStandardMaterial }
  >();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // Shared detail materials
  private readonly eyeMat: THREE.MeshStandardMaterial;
  private readonly catchlightMat: THREE.MeshBasicMaterial;
  private readonly blushMat: THREE.MeshStandardMaterial;
  private readonly pinkInnerMat: THREE.MeshStandardMaterial;
  private readonly noseBlackMat: THREE.MeshStandardMaterial;
  private readonly nosePinkMat: THREE.MeshStandardMaterial;
  private readonly whiskerMat: THREE.MeshStandardMaterial;
  private readonly leatherMat: THREE.MeshStandardMaterial;
  private readonly brassMat: THREE.MeshStandardMaterial;
  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly leafMat: THREE.MeshStandardMaterial;
  private readonly berryRedMat: THREE.MeshStandardMaterial;
  private readonly berryBlueMat: THREE.MeshStandardMaterial;
  private readonly crystalGlowMat: THREE.MeshStandardMaterial;
  private readonly lanternGlowMat: THREE.MeshStandardMaterial;
  private readonly owlIrisMat: THREE.MeshStandardMaterial;
  private readonly frogIrisMat: THREE.MeshStandardMaterial;
  private readonly selectionMat: THREE.MeshBasicMaterial;
  private readonly steelMat: THREE.MeshStandardMaterial;
  private readonly reedWeaveMat: THREE.MeshStandardMaterial;
  private readonly strawWeaveMat: THREE.MeshStandardMaterial;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    private readonly textures?: TextureLibrary,
  ) {
    this.geo = createSharedGeometries();
    this.disposables.push(...Object.values(this.geo));

    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0x0e1015,
      roughness: 0.08,
      metalness: 0.12,
    });
    this.catchlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.blushMat = new THREE.MeshStandardMaterial({
      color: 0xf497a0,
      roughness: 0.9,
      transparent: true,
      opacity: 0.62,
    });
    this.pinkInnerMat = new THREE.MeshStandardMaterial({
      color: 0xebaba9,
      roughness: 0.88,
    });
    this.noseBlackMat = new THREE.MeshStandardMaterial({
      color: 0x181517,
      roughness: 0.18,
      metalness: 0.1,
    });
    this.nosePinkMat = new THREE.MeshStandardMaterial({
      color: 0xe88a92,
      roughness: 0.35,
    });
    this.whiskerMat = new THREE.MeshStandardMaterial({
      color: 0xf0ebe2,
      roughness: 0.7,
    });
    this.leatherMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.78,
      bumpMap: textures?.fabricBump ?? null,
      bumpScale: 0.04,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xe6be5c,
      roughness: 0.28,
      metalness: 0.78,
    });
    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x875c38,
      roughness: 0.84,
    });
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x5d9c3f,
      roughness: 0.74,
    });
    this.berryRedMat = new THREE.MeshStandardMaterial({
      color: 0xd9383a,
      roughness: 0.35,
    });
    this.berryBlueMat = new THREE.MeshStandardMaterial({
      color: 0x4558a8,
      roughness: 0.38,
    });
    this.crystalGlowMat = new THREE.MeshStandardMaterial({
      color: 0x99ffe6,
      emissive: 0x4de0bc,
      emissiveIntensity: 1.5,
      roughness: 0.18,
    });
    this.lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0xffa63d,
      emissiveIntensity: 1.65,
      roughness: 0.25,
    });
    this.owlIrisMat = new THREE.MeshStandardMaterial({
      color: 0xf4b632,
      emissive: 0x5c3605,
      emissiveIntensity: 0.28,
      roughness: 0.22,
    });
    this.frogIrisMat = new THREE.MeshStandardMaterial({
      color: 0xf0c948,
      roughness: 0.22,
    });
    this.selectionMat = new THREE.MeshBasicMaterial({
      color: 0xffe57f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    this.steelMat = new THREE.MeshStandardMaterial({
      color: 0xc2ccd6,
      roughness: 0.32,
      metalness: 0.78,
    });
    this.reedWeaveMat = new THREE.MeshStandardMaterial({
      color: 0xa99e6d,
      roughness: 0.9,
      bumpMap: textures?.fabricBump ?? null,
      bumpScale: 0.06,
    });
    this.strawWeaveMat = new THREE.MeshStandardMaterial({
      color: 0xe6c465,
      roughness: 0.88,
      bumpMap: textures?.fabricBump ?? null,
      bumpScale: 0.06,
    });

    this.disposables.push(
      this.eyeMat,
      this.catchlightMat,
      this.blushMat,
      this.pinkInnerMat,
      this.noseBlackMat,
      this.nosePinkMat,
      this.whiskerMat,
      this.leatherMat,
      this.brassMat,
      this.woodMat,
      this.leafMat,
      this.berryRedMat,
      this.berryBlueMat,
      this.crystalGlowMat,
      this.lanternGlowMat,
      this.owlIrisMat,
      this.frogIrisMat,
      this.selectionMat,
      this.steelMat,
      this.reedWeaveMat,
      this.strawWeaveMat,
    );

    scene.add(this.rootGroup);
    this.syncCreatures(null);
  }

  spawnCombatSpark(spark: CombatSparkVisual): void {
    const colors = [0xffcf5c, 0xff8b47, 0xfff3a8];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo.sparkStar, mat);
      mesh.position.set(
        spark.position.x + (Math.random() - 0.5) * 0.25,
        spark.position.y + 0.15,
        spark.position.z + (Math.random() - 0.5) * 0.25,
      );
      mesh.scale.setScalar(0.55 + Math.random() * 0.45);
      this.rootGroup.add(mesh);
      this.sparks.push({
        mesh,
        mat,
        createdAt: spark.createdAt,
        duration: spark.duration,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 0.8 + Math.random() * 1.1,
        vz: (Math.random() - 0.5) * 1.4,
      });
    }
  }

  /** Spawns stage-colored wood chips, earthen clods, stone dust, or hammer sparks when actively constructing. */
  private spawnWorkChip(c: Creature, stage: ConstructionStage): void {
    const palette =
      stage === 'clearing'
        ? [0xc99a5b, 0x8b5a2b, 0x6ea645]
        : stage === 'leveling'
          ? [0x7a5738, 0x5c4028, 0x9c7b55]
          : stage === 'foundation'
            ? [0xc7c3b8, 0xa89f91, 0xe3dfd5]
            : stage === 'disassembling'
              ? [0xd99b52, 0xb87642, 0xc7bfb2]
              : [0xf7d88b, 0xd4a362, 0xfff1c2];

    const fx = c.x + Math.sin(c.heading) * 0.42;
    const fz = c.z + Math.cos(c.heading) * 0.42;
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: palette[Math.floor(Math.random() * palette.length)],
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(this.geo.sparkStar, mat);
      mesh.position.set(fx + (Math.random() - 0.5) * 0.22, c.y + 0.52 + Math.random() * 0.28, fz + (Math.random() - 0.5) * 0.22);
      mesh.scale.setScalar(0.32 + Math.random() * 0.26);
      this.rootGroup.add(mesh);
      this.sparks.push({
        mesh,
        mat,
        createdAt: this.world.elapsedSeconds,
        duration: 0.42 + Math.random() * 0.18,
        vx: (Math.random() - 0.5) * 1.15,
        vy: 0.75 + Math.random() * 0.85,
        vz: (Math.random() - 0.5) * 1.15,
      });
    }
  }

  update(dt: number, selection: SelectionTarget, povCreatureId: string | null = null): void {
    this.syncCreatures(selection);
    const t = this.world.elapsedSeconds;

    for (const c of this.world.creatures) {
      const rig = this.rigs.get(c.id);
      if (!rig) continue;

      if (!c.alive || c.id === povCreatureId) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;

      // Silky position interpolation
      const posLerp = Math.min(1, dt * 12);
      rig.root.position.x += (c.x - rig.root.position.x) * posLerp;
      rig.root.position.y += (c.y - rig.root.position.y) * posLerp;
      rig.root.position.z += (c.z - rig.root.position.z) * posLerp;

      // Smooth yaw rotation with playful banking lean
      let diff = c.heading - rig.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      rig.root.rotation.y += diff * Math.min(1, dt * 10);

      const phase = c.animPhase;
      const seed = rig.seedPhase;
      let bobY = 0;
      let tiltZ = THREE.MathUtils.clamp(-diff * 0.22, -0.18, 0.18);
      let tiltX = 0;
      let squashY = 1.0;
      let headPitch = Math.sin(t * 2.1 + seed) * 0.05;
      let headRoll = Math.sin(t * 1.4 + seed * 2.1) * 0.07;

      const isBird = c.def.locomotion === 'fly';
      const isAirborne = isBird && c.flightAltitude > 0.3;

      if (c.def.locomotion === 'hop') {
        const hopWave = Math.abs(Math.sin(phase));
        bobY = hopWave * 0.38;
        tiltX = Math.sin(phase) * 0.16;
        // Charming cartoon squash-and-stretch on hop launch/landing
        squashY = 0.92 + hopWave * 0.15;
      } else if (isBird) {
        bobY = isAirborne ? Math.sin(phase * 1.5) * 0.18 : Math.abs(Math.sin(phase)) * 0.1;
        tiltX = isAirborne ? 0.24 : Math.sin(phase) * 0.06;
        const flap = isAirborne ? Math.sin(phase * 4.2) * 0.92 : Math.sin(phase * 1.2) * 0.14;
        if (rig.leftArm) {
          rig.leftArm.rotation.z = isAirborne ? flap : 0.65 + flap * 0.5;
          rig.leftArm.rotation.y = isAirborne ? Math.cos(phase * 4.2) * 0.16 : 0.28;
        }
        if (rig.rightArm) {
          rig.rightArm.rotation.z = isAirborne ? -flap : -0.65 - flap * 0.5;
          rig.rightArm.rotation.y = isAirborne ? -Math.cos(phase * 4.2) * 0.16 : -0.28;
        }
      } else if (c.def.locomotion === 'scurry') {
        bobY = Math.abs(Math.sin(phase * 1.6)) * 0.11;
        tiltZ += Math.sin(phase * 1.6) * 0.11;
      } else {
        bobY = Math.abs(Math.sin(phase)) * 0.13;
        tiltZ += Math.sin(phase) * 0.07;
      }

      // Arm & foot stride animation for ground-walking/hopping creatures
      if (!isBird) {
        const stride = c.activity === 'resting' ? 0 : Math.sin(phase * (c.def.locomotion === 'scurry' ? 1.6 : 1.0));
        if (rig.leftArm) {
          rig.leftArm.rotation.x = stride * 0.52;
          rig.leftArm.rotation.z = 0.16;
        }
        if (rig.rightArm) {
          rig.rightArm.rotation.x = -stride * 0.52;
          rig.rightArm.rotation.z = -0.16;
        }
        if (rig.leftFoot && rig.rightFoot) {
          if (c.def.locomotion === 'hop') {
            const tuck = Math.abs(Math.sin(phase)) * 0.45;
            rig.leftFoot.rotation.x = tuck;
            rig.rightFoot.rotation.x = tuck;
          } else {
            rig.leftFoot.rotation.x = -stride * 0.55;
            rig.rightFoot.rotation.x = stride * 0.55;
          }
        }
      } else if (rig.leftFoot && rig.rightFoot) {
        const stride = isAirborne ? 0.65 : Math.sin(phase) * 0.4;
        rig.leftFoot.rotation.x = isAirborne ? stride : -stride;
        rig.rightFoot.rotation.x = isAirborne ? stride : stride;
      }

      // Stage-specific handheld construction tools & pioneer emigration pack
      const activeStage = c.isActivelyWorking ? c.activeConstructionStage : null;
      const showAxe = activeStage === 'clearing';
      const showSpade = activeStage === 'leveling';
      const showTrowel = activeStage === 'foundation';
      const showHammer =
        activeStage === 'framing' ||
        activeStage === 'finishing' ||
        activeStage === 'disassembling';
      const anyWorkTool = showAxe || showSpade || showTrowel || showHammer;

      rig.workTools.axe.visible = showAxe;
      rig.workTools.spade.visible = showSpade;
      rig.workTools.trowel.visible = showTrowel;
      rig.workTools.hammer.visible = showHammer;
      if (rig.idleBuilderMallet) {
        rig.idleBuilderMallet.visible = !anyWorkTool && !c.isYoung();
      }
      rig.pioneerPack.visible = c.activity === 'emigrating';

      // Expressive activity overrides
      if (activeStage) {
        if (activeStage === 'clearing') {
          // Bold overhead woodcutter / land-clearing axe swing
          const chop = Math.sin(t * 9.2 + seed);
          tiltX = 0.16 + chop * 0.24;
          if (!isBird && rig.rightArm && rig.leftArm) {
            rig.rightArm.rotation.x = -1.42 + chop * 0.96;
            rig.rightArm.rotation.z = -0.32 + chop * 0.22;
            rig.leftArm.rotation.x = -0.65 + chop * 0.45;
          } else if (isBird) {
            headPitch = 0.22 + chop * 0.34;
            if (rig.leftArm && rig.rightArm) {
              rig.leftArm.rotation.z = 0.48 + Math.sin(t * 14 + seed) * 0.32;
              rig.rightArm.rotation.z = -0.48 - Math.sin(t * 14 + seed) * 0.32;
            }
          }
        } else if (activeStage === 'leveling') {
          // Two-handed spading & earth-leveling scoop
          const scoop = Math.sin(t * 6.8 + seed);
          tiltX = 0.3 + scoop * 0.2;
          bobY -= Math.max(0, scoop) * 0.08;
          if (!isBird && rig.rightArm && rig.leftArm) {
            rig.rightArm.rotation.x = -0.92 + scoop * 0.68;
            rig.leftArm.rotation.x = -0.82 + scoop * 0.62;
            rig.rightArm.rotation.z = 0.14;
            rig.leftArm.rotation.z = -0.14;
          } else if (isBird) {
            headPitch = 0.38 + scoop * 0.24;
          }
        } else if (activeStage === 'foundation') {
          // Crouched stone-laying & mortar troweling
          const sweep = Math.sin(t * 8.5 + seed);
          squashY = 0.89 + Math.abs(sweep) * 0.04;
          tiltX = 0.34;
          headPitch = 0.28;
          if (!isBird && rig.rightArm && rig.leftArm) {
            rig.rightArm.rotation.x = -0.85 + Math.sin(t * 12 + seed) * 0.28;
            rig.rightArm.rotation.z = -0.25 + sweep * 0.36;
            rig.leftArm.rotation.x = -0.62;
          } else if (isBird) {
            headPitch = 0.36 + sweep * 0.22;
          }
        } else {
          // Framing, finishing, or disassembling: crisp double-tap hammering with bracing arm
          const rawHit = Math.sin(t * 11.5 + seed);
          const snap = Math.sign(rawHit) * Math.pow(Math.abs(rawHit), 0.65);
          tiltX = 0.14 + snap * 0.18;
          if (!isBird && rig.rightArm && rig.leftArm) {
            rig.rightArm.rotation.x = -1.25 + snap * 0.82;
            rig.leftArm.rotation.x = -0.78 + Math.sin(t * 5.75 + seed) * 0.16;
          } else if (isBird) {
            headPitch = 0.18 + snap * 0.32;
            if (rig.leftArm && rig.rightArm) {
              rig.leftArm.rotation.z = 0.42 + Math.sin(t * 16 + seed) * 0.38;
              rig.rightArm.rotation.z = -0.42 - Math.sin(t * 16 + seed) * 0.38;
            }
          }
        }
        rig.workChipCooldown -= dt;
        if (rig.workChipCooldown <= 0) {
          rig.workChipCooldown = 0.28 + (seed % 0.14);
          this.spawnWorkChip(c, activeStage);
        }
      } else if (c.activity === 'building' || c.activity === 'gathering_timber') {
        const chop = Math.sin(t * 11 + seed);
        tiltX = 0.14 + chop * 0.18;
        if (!isBird && rig.rightArm) {
          rig.rightArm.rotation.x = -1.15 + chop * 0.78;
        }
      } else if (c.activity === 'emigrating') {
        tiltX = 0.12;
        bobY += Math.abs(Math.sin(phase * 1.2)) * 0.05;
      } else if (c.activity === 'playing') {
        // Joyful bouncy hops and playful ear/head wiggles for frolicking litters of young!
        const hop = Math.abs(Math.sin(t * 7.2 + seed));
        bobY += hop * 0.16;
        squashY = 0.92 + hop * 0.14;
        headRoll = Math.sin(t * 6.5 + seed) * 0.24;
        headPitch = -0.08 + Math.sin(t * 5.0 + seed) * 0.14;
      } else if (c.activity === 'courting' || c.activity === 'nesting') {
        // Warm affectionate head tilt & gentle cozy sway
        headRoll = Math.sin(t * 2.6 + seed) * 0.22;
        headPitch = 0.12 + Math.sin(t * 3.1 + seed) * 0.08;
        if (c.activity === 'nesting') {
          bobY = -0.06;
          squashY = 0.92 + Math.sin(t * 2.8 + seed) * 0.03;
        }
      } else if (c.activity === 'fighting') {
        const lunge = Math.sin(t * 15 + seed);
        tiltX = 0.2 + lunge * 0.24;
        if (!isBird && rig.rightArm) {
          rig.rightArm.rotation.x = -1.2 + lunge * 0.85;
        }
      } else if (c.activity === 'foraging') {
        headPitch = 0.26 + Math.sin(t * 6.5 + seed) * 0.16;
      } else if (c.activity === 'socialising') {
        headRoll = Math.sin(t * 3.8 + seed) * 0.2;
        headPitch = Math.sin(t * 5.2 + seed) * 0.1;
        if (!isBird && rig.leftArm) {
          rig.leftArm.rotation.x = -0.55 + Math.sin(t * 6 + seed) * 0.25;
        }
      } else if (c.activity === 'praying') {
        headPitch = 0.28 + Math.sin(t * 2.2 + seed) * 0.08;
        if (!isBird && rig.leftArm && rig.rightArm) {
          rig.leftArm.rotation.x = -0.75;
          rig.rightArm.rotation.x = -0.75;
        }
      } else if (c.activity === 'resting') {
        bobY = -0.11;
        tiltX = 0.2;
        squashY = 0.88 + Math.sin(t * 2.4 + seed) * 0.035;
        headPitch = 0.25;
      }

      const effectiveScale = c.getSizeScale();
      const scaleXZ = effectiveScale / Math.sqrt(squashY);
      rig.bodyGroup.scale.set(scaleXZ, effectiveScale * squashY, scaleXZ);
      rig.bodyGroup.position.y = bobY;
      rig.bodyGroup.rotation.z = tiltZ;
      rig.bodyGroup.rotation.x = tiltX;

      // Adorable youthful proportions: slightly larger head on newborn young & juveniles
      const headScale = c.lifeStage === 'young' ? 1.22 : c.lifeStage === 'juvenile' ? 1.1 : 1.0;
      rig.headGroup.scale.setScalar(headScale);
      rig.headGroup.rotation.x = headPitch;
      rig.headGroup.rotation.z = headRoll;

      // Playful lively ear twitches!
      if (rig.leftEar && rig.rightEar) {
        const twitch = Math.pow(Math.max(0, Math.sin(t * 2.6 + seed * 5.3)), 10) * 0.26;
        const bounce = c.def.locomotion === 'hop' ? Math.sin(phase) * 0.14 : 0;
        rig.leftEar.rotation.z = rig.baseLeftEarZ + twitch + bounce;
        rig.rightEar.rotation.z = rig.baseRightEarZ - twitch * 0.5 - bounce;
      }

      // Expressive wagging / bobbing tails
      if (rig.tail) {
        rig.tail.rotation.y = Math.sin(phase * 1.15 + seed) * 0.34;
        rig.tail.rotation.x = rig.baseTailX + Math.sin(phase * 2.1 + seed) * 0.12;
      }

      // Twinkling golden fairy-ring selection halo
      const isSelected = selection?.kind === 'creature' && selection.id === c.id;
      rig.selectionGroup.visible = isSelected;
      if (isSelected) {
        rig.selectionGroup.rotation.y += dt * 1.8;
        rig.selectionGroup.position.y = 0.08 + Math.sin(t * 4) * 0.03;
      }
    }

    // Update twinkling combat spark bursts
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      const pct = (t - sp.createdAt) / sp.duration;
      if (pct >= 1) {
        this.rootGroup.remove(sp.mesh);
        sp.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      sp.mesh.position.x += sp.vx * dt;
      sp.mesh.position.y += sp.vy * dt;
      sp.mesh.position.z += sp.vz * dt;
      sp.mesh.scale.setScalar(Math.sin(pct * Math.PI) * 1.65);
      sp.mesh.rotation.y += dt * 12;
      sp.mesh.rotation.x += dt * 8;
      sp.mat.opacity = 1 - pct;
    }
  }

  private getSpeciesMaterials(c: Creature): SpeciesMaterialSet {
    const existing = this.speciesMats.get(c.species);
    if (existing) return existing;

    const def = c.def;
    const isGlossy = c.species === 'frog' || c.species === 'crow';
    const furBump = isGlossy ? null : (this.textures?.furBump ?? null);
    const fabricBump = this.textures?.fabricBump ?? null;

    const primary = new THREE.MeshStandardMaterial({
      color: def.primaryColor,
      roughness: c.species === 'frog' ? 0.34 : c.species === 'crow' ? 0.42 : 0.84,
      metalness: c.species === 'crow' ? 0.18 : 0.02,
      bumpMap: furBump,
      bumpScale: 0.035,
    });
    const secondary = new THREE.MeshStandardMaterial({
      color: def.secondaryColor,
      roughness: c.species === 'frog' ? 0.42 : 0.82,
      bumpMap: furBump,
      bumpScale: 0.025,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: def.accentColor,
      roughness: 0.65,
    });
    const cloak = new THREE.MeshStandardMaterial({
      color: def.cloakColor,
      roughness: 0.88,
      bumpMap: fabricBump,
      bumpScale: 0.045,
    });

    // Cheerful complementary scarf/trim color harmonized with cloak
    const scarfCol = new THREE.Color(def.cloakColor).offsetHSL(0.08, 0.14, 0.16);
    const scarf = new THREE.MeshStandardMaterial({
      color: scarfCol,
      roughness: 0.84,
      bumpMap: fabricBump,
      bumpScale: 0.04,
    });

    this.disposables.push(primary, secondary, accent, cloak, scarf);
    const set: SpeciesMaterialSet = { primary, secondary, accent, cloak, scarf };
    this.speciesMats.set(c.species, set);
    return set;
  }

  private getAdaptationMaterials(
    adaptation: VillageAdaptationId,
  ): { readonly mantle: THREE.MeshStandardMaterial; readonly accent: THREE.MeshStandardMaterial } {
    const existing = this.adaptationMats.get(adaptation);
    if (existing) return existing;

    const palette = VILLAGE_ADAPTATION_CATALOG[adaptation].attirePalette;
    const fabricBump = this.textures?.fabricBump ?? null;
    const mantle = new THREE.MeshStandardMaterial({
      color: palette.mantleColor,
      roughness: 0.86,
      bumpMap: fabricBump,
      bumpScale: 0.05,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: palette.accentColor,
      roughness: 0.82,
      bumpMap: fabricBump,
      bumpScale: 0.045,
    });
    this.disposables.push(mantle, accent);
    const pair = { mantle, accent };
    this.adaptationMats.set(adaptation, pair);
    return pair;
  }

  private syncCreatures(_selection: SelectionTarget): void {
    for (const c of this.world.creatures) {
      const currentAdaptation: VillageAdaptationId =
        this.world.getSettlement(c.settlementId)?.adaptation ?? 'forest_canopy';
      const existing = this.rigs.get(c.id);
      if (!existing) {
        const rig = this.buildRig(c);
        this.rigs.set(c.id, rig);
        this.rootGroup.add(rig.root);
      } else if (existing.adaptation !== currentAdaptation) {
        // Pioneer settled into a new biome — refresh attire to match the new village's adaptation!
        const shared = new Set<THREE.BufferGeometry | THREE.Material>(this.disposables);
        existing.root.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.geometry && !shared.has(obj.geometry)) {
            obj.geometry.dispose();
          }
        });
        this.rootGroup.remove(existing.root);
        const rig = this.buildRig(c);
        this.rigs.set(c.id, rig);
        this.rootGroup.add(rig.root);
      }
    }
  }

  private buildRig(c: Creature): CreatureRig {
    const def = c.def;
    const mats = this.getSpeciesMaterials(c);
    const seed = hashString(c.id);

    const root = new THREE.Group();
    root.position.set(c.x, c.y, c.z);
    root.userData.selectionTarget = { kind: 'creature', id: c.id };

    const bodyGroup = new THREE.Group();
    bodyGroup.scale.setScalar(def.bodyScale);
    root.add(bodyGroup);

    const addPart = <T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = bodyGroup): T => {
      obj.userData.selectionTarget = { kind: 'creature', id: c.id };
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      parent.add(obj);
      return obj;
    };

    const isBird = def.silhouette === 'bird' || def.silhouette === 'owl';
    const isFrog = c.species === 'frog';
    const isStout = c.species === 'badger' || c.species === 'hedgehog' || c.species === 'owl';
    const homeSettlement = this.world.getSettlement(c.settlementId);
    const adaptation: VillageAdaptationId = homeSettlement?.adaptation ?? 'forest_canopy';
    const adaptMats = this.getAdaptationMaterials(adaptation);

    // 1. Cozy pear-shaped woodland tunic + regional biome-adapted shoulder capelet + belt & buckle
    const tunic = addPart(new THREE.Mesh(this.geo.tunic, mats.cloak));
    if (isStout) tunic.scale.set(1.16, 0.96, 1.12);
    else if (isBird) tunic.scale.set(0.96, 0.94, 1.04);

    // Regional biome-adapted shoulder mantle
    const mantleMat = adaptMats.mantle;
    const mantle = addPart(new THREE.Mesh(this.geo.mantle, mantleMat));
    if (isStout) mantle.scale.set(1.16, 0.96, 1.12);
    if (isFrog) mantle.scale.set(1.14, 0.85, 1.14);

    // Cozy leather belt & shiny brass clasp
    const belt = addPart(new THREE.Mesh(this.geo.belt, this.leatherMat));
    belt.position.y = 0.44;
    if (isStout) belt.scale.set(1.15, 1, 1.12);
    const buckle = addPart(new THREE.Mesh(this.geo.buckle, this.brassMat));
    buckle.position.set(0, 0.44, isStout ? 0.32 : 0.285);

    // Soft plush chest/belly bib showing above the tunic collar
    const chestBib = addPart(
      new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), mats.secondary),
    );
    chestBib.scale.set(0.95, 1.02, 0.85);
    chestBib.position.set(0, 0.57, isBird ? 0.14 : 0.11);

    // 2. Articulated Head Group (for cute tilts, bobs, and expressions)
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.95, 0.04);
    bodyGroup.add(headGroup);

    const headMesh = addPart(new THREE.Mesh(this.geo.head, mats.primary), headGroup);
    if (isFrog) {
      headMesh.scale.set(1.22, 0.82, 1.06);
    } else if (c.species === 'owl') {
      headMesh.scale.set(1.12, 1.02, 1.04);
    } else if (c.species === 'badger') {
      headMesh.scale.set(1.08, 0.98, 1.06);
    } else if (c.species === 'mouse' || c.species === 'squirrel') {
      headMesh.scale.set(1.04, 0.96, 0.98);
    }

    // Helper for adorable glossy eyes with double specular catchlights!
    const buildCuteEye = (
      x: number,
      y: number,
      z: number,
      scale = 1.0,
      irisRingMat?: THREE.MeshStandardMaterial,
    ) => {
      const eyeHolder = new THREE.Group();
      eyeHolder.position.set(x, y, z);
      eyeHolder.scale.setScalar(scale);

      if (irisRingMat) {
        const ring = addPart(new THREE.Mesh(this.geo.eye, irisRingMat), eyeHolder);
        ring.scale.set(1.42, 1.42, 0.88);
        ring.position.z = -0.012;
      }

      addPart(new THREE.Mesh(this.geo.eye, this.eyeMat), eyeHolder);

      const shine1 = new THREE.Mesh(this.geo.catchlightBig, this.catchlightMat);
      shine1.position.set(x < 0 ? 0.018 : -0.014, 0.022, 0.044);
      eyeHolder.add(shine1);

      const shine2 = new THREE.Mesh(this.geo.catchlightSmall, this.catchlightMat);
      shine2.position.set(x < 0 ? -0.016 : 0.016, -0.018, 0.046);
      eyeHolder.add(shine2);

      headGroup.add(eyeHolder);
      return eyeHolder;
    };

    const addRosyCheeks = (spreadX: number, y: number, z: number, scale = 1.0) => {
      for (const sx of [-spreadX, spreadX]) {
        const blush = addPart(new THREE.Mesh(this.geo.blush, this.blushMat), headGroup);
        blush.scale.set(1.2 * scale, 0.72 * scale, 0.45 * scale);
        blush.position.set(sx, y, z);
      }
    };

    const addWhiskers = (y: number, z: number, spread = 0.09) => {
      for (const side of [-1, 1]) {
        for (const angleOffset of [-0.18, 0.04, 0.24]) {
          const w = new THREE.Mesh(this.geo.whisker, this.whiskerMat);
          w.rotation.z = Math.PI / 2 + side * angleOffset;
          w.rotation.y = -side * 0.26;
          w.position.set(side * (spread + 0.09), y + angleOffset * 0.04, z);
          headGroup.add(w);
        }
      }
    };

    // 3. Articulated Feet
    let leftFoot: THREE.Object3D | undefined;
    let rightFoot: THREE.Object3D | undefined;
    const footGeo = isBird
      ? this.geo.birdFoot
      : isFrog
        ? this.geo.webbedFoot
        : this.geo.boot;
    const footMat = isBird
      ? mats.accent
      : isFrog
        ? mats.primary
        : this.leatherMat;

    for (const side of [-1, 1] as const) {
      const fPivot = new THREE.Group();
      fPivot.position.set(side * 0.13, 0.08, 0.02);
      const footMesh = addPart(new THREE.Mesh(footGeo, footMat), fPivot);
      footMesh.position.y = -0.06;
      bodyGroup.add(fPivot);
      if (side === -1) leftFoot = fPivot;
      else rightFoot = fPivot;
    }

    // 4. Articulated Arms OR Layered Bird Wings
    let leftArm: THREE.Object3D | undefined;
    let rightArm: THREE.Object3D | undefined;
    let leftEar: THREE.Object3D | undefined;
    let rightEar: THREE.Object3D | undefined;
    let tail: THREE.Object3D | undefined;
    let baseLeftEarZ = 0;
    let baseRightEarZ = 0;
    let baseTailX = 0;

    if (isBird) {
      const lPivot = new THREE.Group();
      lPivot.position.set(-0.24, 0.65, -0.02);
      addPart(new THREE.Mesh(this.geo.wingLeft, mats.primary), lPivot);
      bodyGroup.add(lPivot);
      leftArm = lPivot;

      const rPivot = new THREE.Group();
      rPivot.position.set(0.24, 0.65, -0.02);
      addPart(new THREE.Mesh(this.geo.wingRight, mats.primary), rPivot);
      bodyGroup.add(rPivot);
      rightArm = rPivot;
    } else {
      const armOffset = isStout ? 0.3 : 0.26;
      for (const side of [-1, 1] as const) {
        const aPivot = new THREE.Group();
        aPivot.position.set(side * armOffset, 0.65, 0.02);
        addPart(new THREE.Mesh(this.geo.arm, mats.cloak), aPivot);
        const paw = addPart(
          new THREE.Mesh(this.geo.paw, c.species === 'badger' ? mats.accent : mats.secondary),
          aPivot,
        );
        paw.position.set(0, -0.23, 0.02);
        bodyGroup.add(aPivot);
        if (side === -1) leftArm = aPivot;
        else rightArm = aPivot;
      }
    }

    // 5. Species-Specific High-Resolution Whimsical Sculpting (ALL 12 species!)
    if (c.species === 'owl') {
      // Heart-shaped cream facial disc
      for (const sx of [-0.095, 0.095]) {
        const disc = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), mats.secondary), headGroup);
        disc.scale.set(1.05, 1.12, 0.55);
        disc.position.set(sx, 0.01, 0.21);
      }
      // Huge wise golden amber eyes + catchlights
      buildCuteEye(-0.1, 0.03, 0.27, 1.18, this.owlIrisMat);
      buildCuteEye(0.1, 0.03, 0.27, 1.18, this.owlIrisMat);

      // Curved ivory scholar beak
      const beak = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.14, 8), mats.accent), headGroup);
      beak.rotation.x = Math.PI * 0.62;
      beak.position.set(0, -0.03, 0.31);

      // Tiny whimsical round brass spectacles!
      for (const sx of [-0.1, 0.1]) {
        const frame = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.01, 8, 18), this.brassMat), headGroup);
        frame.position.set(sx, 0.03, 0.31);
      }
      const bridge = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), this.brassMat), headGroup);
      bridge.position.set(0, 0.04, 0.31);

      // Feathered ear tufts (articulated!)
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.16, 0.2, 0.04);
        const tuft = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.2, 8), mats.primary), ePivot);
        tuft.position.y = 0.08;
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.38;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.38;
        }
      }

      // Fanned owl tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.26, -0.26);
      addPart(new THREE.Mesh(this.geo.birdTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
      baseTailX = -0.25;
    } else if (c.species === 'crow' || c.species === 'sparrow' || c.species === 'robin') {
      const isCrow = c.species === 'crow';
      const isRobin = c.species === 'robin';

      buildCuteEye(-0.125, 0.04, 0.22, isCrow ? 0.96 : 1.06);
      buildCuteEye(0.125, 0.04, 0.22, isCrow ? 0.96 : 1.06);
      if (!isCrow) addRosyCheeks(0.16, -0.02, 0.19, 0.85);

      // Sculpted beak (longer curved corvid beak for crow, cute perky songbird beak for sparrow/robin)
      const beakLen = isCrow ? 0.24 : 0.15;
      const beakUpper = addPart(
        new THREE.Mesh(new THREE.ConeGeometry(isCrow ? 0.068 : 0.058, beakLen, 10), isCrow ? this.noseBlackMat : mats.accent),
        headGroup,
      );
      beakUpper.rotation.x = Math.PI * 0.53;
      beakUpper.position.set(0, -0.01, 0.25 + beakLen * 0.35);

      // Cute feather crown tuft
      for (let i = 0; i < 2; i++) {
        const crest = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.12, 7), mats.primary), headGroup);
        crest.position.set((i - 0.5) * 0.04, 0.26, 0.02 - i * 0.05);
        crest.rotation.x = -0.45 - i * 0.2;
      }

      // Robin's iconic puffy terracotta breast / Crow's dapper brass monocle
      if (isRobin) {
        chestBib.scale.set(1.18, 1.12, 1.05);
        chestBib.position.set(0, 0.56, 0.16);
      } else if (isCrow) {
        const monocle = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.01, 8, 16), this.brassMat), headGroup);
        monocle.position.set(0.125, 0.04, 0.265);
      }

      // Fanned tail feathers
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.28, -0.25);
      addPart(new THREE.Mesh(this.geo.birdTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
      baseTailX = 0.22;
    } else if (c.species === 'rabbit') {
      // Fluffy cream cheek puffs & snout
      for (const sx of [-0.11, 0.11]) {
        const cheek = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mats.secondary), headGroup);
        cheek.scale.set(1.05, 0.85, 0.9);
        cheek.position.set(sx, -0.06, 0.19);
      }
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(1.15, 0.85, 0.9);
      nose.position.set(0, -0.02, 0.29);

      buildCuteEye(-0.12, 0.05, 0.225, 1.06);
      buildCuteEye(0.12, 0.05, 0.225, 1.06);
      addRosyCheeks(0.165, -0.02, 0.195, 0.95);
      addWhiskers(-0.04, 0.25, 0.08);

      // Tall sculpted velvety ears with recessed pink inner-ear groove (one playfully bent!)
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.1, 0.22, -0.01);

        const outer = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.34, 8, 12), mats.primary), ePivot);
        outer.scale.set(1.0, 1.0, 0.58);
        outer.position.y = 0.2;

        const inner = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.26, 6, 10), this.pinkInnerMat), ePivot);
        inner.scale.set(1.0, 1.0, 0.4);
        inner.position.set(0, 0.19, 0.03);

        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.16;
        } else {
          rightEar = ePivot;
          // Playful signature ear-tilt variation per rabbit!
          baseRightEarZ = seed > 0.45 ? -0.42 : -0.16;
        }
      }

      // Adorable fluffy cotton-puff tail!
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.27, -0.33);
      addPart(new THREE.Mesh(this.geo.bunnyTail, mats.secondary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'fox') {
      // Sculpted tapered fox snout + cream lower cheeks
      const snout = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.3, 14), mats.primary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.03, 0.3);
      const jaw = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), mats.secondary), headGroup);
      jaw.scale.set(1.25, 0.65, 1.18);
      jaw.position.set(0, -0.09, 0.21);

      // Fluffy white fox cheek ruffs
      for (const sx of [-0.17, 0.17]) {
        const ruff = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.17, 8), mats.secondary), headGroup);
        ruff.rotation.z = sx > 0 ? -1.25 : 1.25;
        ruff.position.set(sx, -0.06, 0.11);
      }

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.position.set(0, -0.02, 0.44);

      buildCuteEye(-0.12, 0.055, 0.225, 1.0);
      buildCuteEye(0.12, 0.055, 0.225, 1.0);
      addRosyCheeks(0.16, -0.03, 0.19, 0.8);
      addWhiskers(-0.04, 0.31, 0.08);

      // Tall black-tipped fox ears with cream inner fluff
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.15, 0.2, 0.0);

        const earBase = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 10), mats.primary), ePivot);
        earBase.scale.set(1.0, 1.0, 0.65);
        earBase.position.y = 0.11;

        const earTip = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 10), mats.accent), ePivot);
        earTip.scale.set(1.0, 1.0, 0.65);
        earTip.position.y = 0.19;

        const earInner = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.16, 8), mats.secondary), ePivot);
        earInner.scale.set(1.0, 1.0, 0.4);
        earInner.position.set(0, 0.09, 0.035);

        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.24;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.24;
        }
      }

      // Lush sweeping fox brush tail with cream-white tip
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.28, -0.26);
      addPart(new THREE.Mesh(this.geo.foxTailMain, mats.primary), tailGroup);
      addPart(new THREE.Mesh(this.geo.foxTailTip, mats.secondary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'badger') {
      // Iconic bold black-and-white badger striped head!
      const blaze = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.26, 8, 10), mats.secondary), headGroup);
      blaze.rotation.x = Math.PI * 0.38;
      blaze.position.set(0, 0.08, 0.18);

      for (const sx of [-0.145, 0.145]) {
        // Cream cheek stripe
        const cheekStripe = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), mats.secondary), headGroup);
        cheekStripe.scale.set(0.95, 0.8, 1.12);
        cheekStripe.position.set(sx, -0.05, 0.15);

        // Bold charcoal eye-mask band
        const mask = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 6, 8), mats.accent), headGroup);
        mask.rotation.x = Math.PI * 0.42;
        mask.position.set(sx * 0.72, 0.06, 0.18);
      }

      const snout = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.125, 0.22, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.04, 0.28);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.25, 0.9, 1.0);
      nose.position.set(0, -0.02, 0.39);

      buildCuteEye(-0.115, 0.045, 0.24, 0.96);
      buildCuteEye(0.115, 0.045, 0.24, 0.96);

      // Rounded dark ears with crisp white rims
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.19, 0.18, 0.02);
        const rim = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), mats.secondary), ePivot);
        rim.scale.set(1.0, 1.0, 0.55);
        const core = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), mats.accent), ePivot);
        core.scale.set(1.0, 1.0, 0.65);
        core.position.set(0, -0.012, 0.01);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Stout cuddly badger tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.24, -0.32);
      const stub = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 6, 10), mats.primary), tailGroup);
      stub.rotation.x = -0.9;
      stub.position.set(0, 0.02, -0.08);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'squirrel') {
      // Extra-chubby adorable nut cheeks!
      for (const sx of [-0.12, 0.12]) {
        const cheek = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.108, 12, 10), mats.secondary), headGroup);
        cheek.position.set(sx, -0.06, 0.18);
      }
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(0.95, 0.8, 0.9);
      nose.position.set(0, -0.015, 0.275);

      buildCuteEye(-0.12, 0.055, 0.22, 1.08);
      buildCuteEye(0.12, 0.055, 0.22, 1.08);
      addRosyCheeks(0.17, -0.03, 0.18, 1.0);
      addWhiskers(-0.04, 0.24, 0.08);

      // Cute tufted squirrel ears
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.15, 0.2, 0.01);
        const ear = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), mats.primary), ePivot);
        ear.scale.set(0.85, 1.15, 0.55);
        ear.position.y = 0.04;
        const inner = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 8), this.pinkInnerMat), ePivot);
        inner.scale.set(0.8, 1.0, 0.4);
        inner.position.set(0, 0.035, 0.028);
        const tuft = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 6), mats.accent), ePivot);
        tuft.position.y = 0.14;
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.22;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.22;
        }
      }

      // Huge lush S-curved bushy squirrel tail!
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.26, -0.24);
      addPart(new THREE.Mesh(this.geo.squirrelTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'hedgehog') {
      // Soft cream cuddly face mask & perky snout
      const face = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), mats.secondary), headGroup);
      face.scale.set(0.95, 0.92, 0.92);
      face.position.set(0, -0.02, 0.09);

      const snout = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.088, 0.2, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.04, 0.3);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(0.95, 0.85, 0.95);
      nose.position.set(0, -0.03, 0.4);

      buildCuteEye(-0.115, 0.04, 0.24, 1.04);
      buildCuteEye(0.115, 0.04, 0.24, 1.04);
      addRosyCheeks(0.16, -0.04, 0.2, 1.05);

      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.18, 0.14, 0.06);
        const ear = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), mats.secondary), ePivot);
        ear.scale.set(1.0, 1.0, 0.5);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Lush sculpted dome of 34 tapered quills on back & crown!
      const quills = addPart(new THREE.Mesh(this.geo.hedgehogQuills, mats.accent));
      quills.position.set(0, 0.72, -0.14);

      // Whimsical tiny leaf tucked in the hedgehog's quills!
      const leaf = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.leafMat));
      leaf.scale.set(1.3, 0.28, 0.85);
      leaf.rotation.set(0.4, 0.6, 0.3);
      leaf.position.set(0.18, 0.96, -0.34);
    } else if (c.species === 'frog') {
      // Wide cute cream frog chin & smiling cheek puffs
      const chin = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), mats.secondary), headGroup);
      chin.scale.set(1.18, 0.56, 1.02);
      chin.position.set(0, -0.1, 0.06);

      // Iconic perched frog eye domes on top of the head!
      for (const side of [-1, 1] as const) {
        const dome = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), mats.primary), headGroup);
        dome.position.set(side * 0.155, 0.17, 0.08);
        buildCuteEye(side * 0.165, 0.185, 0.155, 1.08, this.frogIrisMat);
      }
      addRosyCheeks(0.22, -0.02, 0.17, 1.05);
    } else {
      // Mouse & Rat — charming oversized cupped pink-lined saucer ears, cute tapered snout, whiskers & curled tail!
      const isMouse = c.species === 'mouse';
      const snoutLen = isMouse ? 0.2 : 0.28;
      const snout = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.095, snoutLen, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.035, 0.24 + snoutLen * 0.3);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(0.9, 0.85, 0.9);
      nose.position.set(0, -0.03, 0.25 + snoutLen * 0.78);

      buildCuteEye(-0.115, 0.05, 0.22, isMouse ? 1.12 : 1.0);
      buildCuteEye(0.115, 0.05, 0.22, isMouse ? 1.12 : 1.0);
      addRosyCheeks(0.16, -0.03, 0.19, isMouse ? 1.05 : 0.85);
      addWhiskers(-0.04, 0.28, 0.075);

      const earRadius = isMouse ? 0.145 : 0.125;
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.18, 0.18, 0.0);

        const outer = addPart(new THREE.Mesh(new THREE.SphereGeometry(earRadius, 14, 12), mats.primary), ePivot);
        outer.scale.set(1.0, 1.05, 0.36);

        const inner = addPart(
          new THREE.Mesh(new THREE.SphereGeometry(earRadius * 0.74, 12, 10), this.pinkInnerMat),
          ePivot,
        );
        inner.scale.set(1.0, 1.05, 0.3);
        inner.position.z = 0.025;

        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.2;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.2;
        }
      }

      // Long graceful curled tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.22, -0.26);
      addPart(new THREE.Mesh(this.geo.rodentTail, this.pinkInnerMat), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    }

    // 6. Whimsical Role Accessories (ALL 6 roles!)
    if (c.role === 'mystic') {
      // Crooked star-trimmed wizard hat + golden band
      const hat = addPart(new THREE.Mesh(this.geo.wizardHat, mats.cloak), headGroup);
      hat.position.set(0, 0.2, 0.0);
      const hatBand = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 8, 18), this.brassMat), headGroup);
      hatBand.rotation.x = Math.PI / 2;
      hatBand.position.set(0, 0.24, 0.0);

      // Gnarled crystal-topped mystic staff
      if (!isBird && rightArm) {
        const staff = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.05, 8), this.woodMat), rightArm);
        staff.position.set(0.04, 0.05, 0.14);
        staff.rotation.x = 0.18;
        const orb = addPart(new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 1), this.crystalGlowMat), rightArm);
        orb.position.set(0.04, 0.62, 0.24);
      }
    } else if (c.role === 'merchant') {
      // Traveler's leather backpack + cozy rolled bedroll + tiny glowing brass lantern!
      const pack = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.22), this.leatherMat));
      pack.position.set(0, 0.56, -0.29);
      const roll = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 12), mats.scarf));
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, 0.77, -0.29);
      const lantern = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8), this.lanternGlowMat));
      lantern.position.set(0.2, 0.44, -0.34);
      const cap = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.06, 8), this.brassMat));
      cap.position.set(0.2, 0.52, -0.34);
    } else if (c.role === 'forager') {
      // Wicker foraging basket on the back brimming with woodland berries!
      const basket = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.24, 12), this.woodMat));
      basket.position.set(0, 0.52, -0.3);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const berry = addPart(
          new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), i % 2 === 0 ? this.berryRedMat : this.berryBlueMat),
        );
        berry.position.set(Math.cos(a) * 0.065, 0.65, -0.3 + Math.sin(a) * 0.065);
      }
    } else if (c.role === 'builder') {
      // Cute acorn-cap builder hat + wooden mallet in paw
      if (c.species !== 'frog' && c.species !== 'rabbit') {
        const hat = addPart(new THREE.Mesh(this.geo.acornHat, this.woodMat), headGroup);
        hat.position.set(0, 0.16, 0);
        hat.scale.setScalar(0.95);
      }
    } else if (c.role === 'guard') {
      // Brass-rimmed acorn helm + leaf-crest buckler shield + wooden spear!
      if (c.species !== 'frog') {
        const helm = addPart(new THREE.Mesh(this.geo.acornHat, this.brassMat), headGroup);
        helm.position.set(0, 0.16, 0);
        helm.scale.setScalar(0.92);
      }
      if (!isBird && leftArm) {
        const shield = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), this.woodMat), leftArm);
        shield.rotation.z = Math.PI / 2;
        shield.position.set(-0.08, -0.18, 0.08);
        const boss = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), this.brassMat), leftArm);
        boss.position.set(-0.11, -0.18, 0.08);
      }
      if (!isBird && rightArm) {
        const spear = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.95, 8), this.woodMat), rightArm);
        spear.position.set(0.04, 0.02, 0.12);
        spear.rotation.x = 0.22;
        const tip = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.15, 6), this.brassMat), rightArm);
        tip.position.set(0.04, 0.54, 0.24);
        tip.rotation.x = 0.22;
      }
    } else if (c.role === 'artisan') {
      // Jaunty tilted woodland artist beret + colorful berry-dye pouch!
      const beret = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mats.scarf), headGroup);
      beret.scale.set(1.18, 0.42, 1.12);
      beret.rotation.z = -0.26;
      beret.position.set(0.05, 0.24, -0.02);
      const pom = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), this.brassMat), headGroup);
      pom.position.set(0.08, 0.32, -0.02);
    }

    // Builder's idle wooden mallet (hidden whenever an active construction stage tool is equipped)
    let idleBuilderMallet: THREE.Group | undefined;
    if (c.role === 'builder' && !isBird && rightArm) {
      idleBuilderMallet = new THREE.Group();
      const handle = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.32, 8), this.woodMat), idleBuilderMallet);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, -0.23, 0.16);
      const malletHead = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), this.leatherMat), idleBuilderMallet);
      malletHead.rotation.z = Math.PI / 2;
      malletHead.position.set(0, -0.23, 0.3);
      rightArm.add(idleBuilderMallet);
    }

    // 6b. Stage-specific handheld construction tools (axe, spade, mason's trowel, carpenter's hammer)
    const toolMount: THREE.Object3D = !isBird && rightArm ? rightArm : headGroup;
    const toolHolder = new THREE.Group();
    if (isBird) {
      toolHolder.position.set(0, -0.04, 0.32);
      toolHolder.scale.setScalar(0.65);
    } else {
      toolHolder.position.set(0, -0.24, 0.06);
    }
    toolMount.add(toolHolder);

    const axe = new THREE.Group();
    const axeHaft = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.52, 7), this.woodMat), axe);
    axeHaft.rotation.x = Math.PI / 2;
    axeHaft.position.set(0, 0, 0.22);
    const axeBlade = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.12), this.steelMat), axe);
    axeBlade.position.set(0, -0.055, 0.42);
    axe.visible = false;
    toolHolder.add(axe);

    const spade = new THREE.Group();
    const spadeShaft = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.58, 7), this.woodMat), spade);
    spadeShaft.rotation.x = Math.PI / 2;
    spadeShaft.position.set(0, 0, 0.24);
    const spadeBlade = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.18), this.steelMat), spade);
    spadeBlade.position.set(0, 0, 0.56);
    spade.visible = false;
    toolHolder.add(spade);

    const trowel = new THREE.Group();
    const trowelHandle = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.18, 6), this.woodMat), trowel);
    trowelHandle.rotation.x = Math.PI / 2;
    trowelHandle.position.set(0, 0, 0.09);
    const trowelBlade = addPart(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 4), this.steelMat), trowel);
    trowelBlade.rotation.x = Math.PI / 2;
    trowelBlade.scale.set(1.0, 1.0, 0.22);
    trowelBlade.position.set(0, 0, 0.25);
    trowel.visible = false;
    toolHolder.add(trowel);

    const hammer = new THREE.Group();
    const hamHandle = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.36, 7), this.woodMat), hammer);
    hamHandle.rotation.x = Math.PI / 2;
    hamHandle.position.set(0, 0, 0.17);
    const hamHead = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.075, 0.085), this.steelMat), hammer);
    hamHead.position.set(0, 0, 0.33);
    hammer.visible = false;
    toolHolder.add(hammer);

    const workTools: WorkToolKit = { axe, spade, trowel, hammer };

    // 6c. Emigrating pioneer pack (leather satchel + rolled cloak bedroll, shown during village-founding treks)
    const pioneerPack = new THREE.Group();
    const pBag = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.2), this.leatherMat), pioneerPack);
    pBag.position.set(0, 0.56, -0.29);
    const pRoll = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), mats.scarf), pioneerPack);
    pRoll.rotation.z = Math.PI / 2;
    pRoll.position.set(0, 0.76, -0.29);
    const pLantern = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.11, 8), this.lanternGlowMat), pioneerPack);
    pLantern.position.set(-0.18, 0.44, -0.34);
    pioneerPack.visible = false;
    bodyGroup.add(pioneerPack);

    // 6d. Environmental biome-adaptation attire (rain hats, fur collars, straw hats, trail lanterns, sun-scarves!)
    const hasRoleHat =
      c.role === 'mystic' || c.role === 'guard' || c.role === 'artisan' || c.role === 'builder';
    if (adaptation === 'riverside_stilts') {
      if (!hasRoleHat && !isFrog) {
        const rainHat = addPart(new THREE.Mesh(this.geo.reedHat, this.reedWeaveMat), headGroup);
        rainHat.position.set(0, 0.17, -0.01);
        const tie = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 6, 16), adaptMats.mantle), headGroup);
        tie.rotation.x = Math.PI / 2;
        tie.position.set(0, 0.21, -0.01);
      }
    } else if (adaptation === 'coastal_harbor') {
      // Waxed sea-teal mariner storm-hat & brass harbor medallion clasp
      const clasp = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.brassMat));
      clasp.position.set(0, 0.72, 0.27);
      if (!hasRoleHat && !isFrog) {
        const marinerHat = addPart(new THREE.Mesh(this.geo.strawHat, adaptMats.mantle), headGroup);
        marinerHat.position.set(0, 0.18, -0.01);
        const band = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.024, 6, 18), adaptMats.accent), headGroup);
        band.rotation.x = Math.PI / 2;
        band.position.set(0, 0.23, -0.01);
      }
    } else if (adaptation === 'mountain_stone') {
      // Plush thermal cream fur collar around the shoulders against mountain wind
      const collar = addPart(new THREE.Mesh(this.geo.furCollar, adaptMats.accent));
      collar.position.set(0, 0.77, 0.01);
      if (isStout) collar.scale.set(1.15, 1.0, 1.12);
    } else if (adaptation === 'prairie_pastoral') {
      if (!hasRoleHat && !isFrog && c.species !== 'rabbit') {
        const sunHat = addPart(new THREE.Mesh(this.geo.strawHat, this.strawWeaveMat), headGroup);
        sunHat.position.set(0, 0.18, -0.01);
        const ribbon = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.022, 6, 18), adaptMats.mantle), headGroup);
        ribbon.rotation.x = Math.PI / 2;
        ribbon.position.set(0, 0.23, -0.01);
      }
    } else if (adaptation === 'forest_canopy') {
      // Glowing woodland fairy-lantern charm clipped to the belt for deep-canopy trails
      const charm = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), this.lanternGlowMat));
      charm.position.set(0.26, 0.43, 0.14);
      if (!hasRoleHat && !isFrog) {
        const leafCrest = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), adaptMats.accent), headGroup);
        leafCrest.scale.set(1.25, 0.32, 1.35);
        leafCrest.position.set(0, 0.26, -0.04);
        leafCrest.rotation.x = -0.18;
      }
    } else if (adaptation === 'desert_oasis') {
      // Breezy saffron linen sun-scarf collar + desert headwrap band
      const scarf = addPart(new THREE.Mesh(this.geo.furCollar, adaptMats.accent));
      scarf.scale.set(0.95, 0.65, 0.95);
      scarf.position.set(0, 0.78, 0.02);
      if (!hasRoleHat && !isFrog) {
        const wrap = addPart(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.036, 8, 18), adaptMats.accent), headGroup);
        wrap.rotation.x = Math.PI / 2 + 0.12;
        wrap.position.set(0, 0.16, 0);
      }
    }

    // Extra whimsical individual touch: some creatures wear a tiny daisy/leaf tucked behind an ear!
    if (seed > 0.72 && c.role !== 'mystic' && c.role !== 'guard') {
      const flower = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), this.lanternGlowMat), headGroup);
      flower.position.set(-0.18, 0.18, 0.12);
    }

    // 7. Magical golden fairy-ring selection halo with 4 orbiting sparkle beads
    const selectionGroup = new THREE.Group();
    selectionGroup.position.y = 0.08;
    const ringMesh = new THREE.Mesh(this.geo.selectionRing, this.selectionMat);
    selectionGroup.add(ringMesh);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const bead = new THREE.Mesh(this.geo.catchlightBig, this.selectionMat);
      bead.scale.setScalar(2.6);
      bead.position.set(Math.cos(a) * 0.65, 0.12, Math.sin(a) * 0.65);
      selectionGroup.add(bead);
    }
    selectionGroup.visible = false;
    root.add(selectionGroup);

    return {
      root,
      bodyGroup,
      headGroup,
      leftArm,
      rightArm,
      leftFoot,
      rightFoot,
      leftEar,
      rightEar,
      tail,
      selectionGroup,
      workTools,
      idleBuilderMallet,
      pioneerPack,
      seedPhase: seed * Math.PI * 2,
      baseLeftEarZ,
      baseRightEarZ,
      baseTailX,
      workChipCooldown: 0.15,
      adaptation,
    };
  }

  dispose(): void {
    const shared = new Set<THREE.BufferGeometry | THREE.Material>(this.disposables);
    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry && !shared.has(obj.geometry)) {
        obj.geometry.dispose();
      }
    });
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.speciesMats.clear();
    this.adaptationMats.clear();
  }
}
