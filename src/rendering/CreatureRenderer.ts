import * as THREE from 'three';
import type {
  CombatSparkVisual,
  ConstructionStage,
  SelectionTarget,
  SpeciesId,
  VillageAdaptationId,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import { SPECIES_CATALOG } from '@simulation/creatures/SpeciesCatalog';
import {
  computeStrideMetrics,
  sampleFootTrajectory,
  sampleHopCycle,
  solveGroundedFootTransform,
} from '@simulation/creatures/StrideKinematics';
import { VILLAGE_ADAPTATION_CATALOG } from '@simulation/settlements/VillageAdaptation';
import { getWeaponStats } from '@simulation/society/WarSystem';
import type { WorldState } from '@simulation/WorldState';
import {
  createOrganicPuffGeo,
  createTaperedTubeGeo,
  mergePartGeometries,
} from './GeometryHelpers';
import { CombatGoreSystem } from './CombatGoreSystem';
import type { TextureLibrary } from './ProceduralTextures';

interface WorkToolKit {
  readonly axe: THREE.Group;
  readonly spade: THREE.Group;
  readonly trowel: THREE.Group;
  readonly hammer: THREE.Group;
}

interface WarGearKit {
  readonly sword: THREE.Group;
  readonly spear: THREE.Group;
  readonly battleAxe: THREE.Group;
  readonly warClub: THREE.Group;
  readonly bow: THREE.Group;
  readonly shield?: THREE.Group;
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
  readonly warGear: WarGearKit;
  readonly guardStaticGear: THREE.Object3D[];
  readonly idleBuilderMallet?: THREE.Group;
  readonly pioneerPack: THREE.Group;
  readonly seedPhase: number;
  readonly baseLeftEarZ: number;
  readonly baseRightEarZ: number;
  readonly baseTailX: number;
  workChipCooldown: number;
  bleedCooldown: number;
  readonly adaptation: VillageAdaptationId;
  readonly swimRipple?: THREE.Mesh;
  readonly baseFootY: number;
  readonly baseFootZ: number;
  moveBlend: number;
  gaitBlend: number;
  stridePhase: number;
  lastSimAnimPhase: number;
  footGroundBlend: number;
  bobY: number;
  tiltX: number;
  tiltZ: number;
  headPitch: number;
  headRoll: number;
  squashY: number;
  bodyYaw: number;
}

interface SparkVisual {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.Material;
  readonly createdAt: number;
  readonly duration: number;
  readonly vx: number;
  vy: number;
  readonly vz: number;
  readonly baseScale: number;
  readonly gravity: number;
  readonly spinRate?: number;
}

interface ArrowVisual {
  readonly mesh: THREE.Mesh;
  readonly createdAt: number;
  readonly duration: number;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly arcHeight: number;
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
  readonly eyeRim: THREE.BufferGeometry;
  readonly selectionBead: THREE.BufferGeometry;
  readonly nose: THREE.BufferGeometry;
  readonly whisker: THREE.BufferGeometry;
  readonly arm: THREE.BufferGeometry;
  readonly paw: THREE.BufferGeometry;
  readonly boot: THREE.BufferGeometry;
  readonly rabbitFoot: THREE.BufferGeometry;
  readonly webbedFoot: THREE.BufferGeometry;
  readonly birdFoot: THREE.BufferGeometry;
  readonly wingLeft: THREE.BufferGeometry;
  readonly wingRight: THREE.BufferGeometry;
  readonly birdTail: THREE.BufferGeometry;
  readonly magpieTail: THREE.BufferGeometry;
  readonly squirrelTail: THREE.BufferGeometry;
  readonly foxTailMain: THREE.BufferGeometry;
  readonly foxTailTip: THREE.BufferGeometry;
  readonly wolfTailMain: THREE.BufferGeometry;
  readonly wolfTailTip: THREE.BufferGeometry;
  readonly catTail: THREE.BufferGeometry;
  readonly raccoonTail: THREE.BufferGeometry;
  readonly raccoonTailRings: THREE.BufferGeometry;
  readonly weaselTail: THREE.BufferGeometry;
  readonly weaselTailTip: THREE.BufferGeometry;
  readonly snakeCoil: THREE.BufferGeometry;
  readonly snakeTail: THREE.BufferGeometry;
  readonly turtleShell: THREE.BufferGeometry;
  readonly turtleShellRim: THREE.BufferGeometry;
  readonly rodentTail: THREE.BufferGeometry;
  readonly bunnyTail: THREE.BufferGeometry;
  readonly hedgehogQuills: THREE.BufferGeometry;
  readonly wizardHat: THREE.BufferGeometry;
  readonly acornHat: THREE.BufferGeometry;
  readonly selectionRing: THREE.BufferGeometry;
  readonly workChip: THREE.BufferGeometry;
  readonly axeHead: THREE.BufferGeometry;
  readonly spadeBlade: THREE.BufferGeometry;
  readonly trowelBlade: THREE.BufferGeometry;
  readonly hammerHead: THREE.BufferGeometry;
  readonly reedHat: THREE.BufferGeometry;
  readonly strawHat: THREE.BufferGeometry;
  readonly furCollar: THREE.BufferGeometry;
  readonly beaverTail: THREE.BufferGeometry;
  readonly otterTail: THREE.BufferGeometry;
  readonly fishBody: THREE.BufferGeometry;
  readonly fishTailFin: THREE.BufferGeometry;
  readonly fishDorsalFin: THREE.BufferGeometry;
  readonly fishPectoralFinL: THREE.BufferGeometry;
  readonly fishPectoralFinR: THREE.BufferGeometry;
  readonly lilyHat: THREE.BufferGeometry;
  readonly swimRipple: THREE.BufferGeometry;
  readonly swordBlade: THREE.BufferGeometry;
  readonly spearTip: THREE.BufferGeometry;
  readonly battleAxeHead: THREE.BufferGeometry;
  readonly warClubHead: THREE.BufferGeometry;
  readonly bowStave: THREE.BufferGeometry;
  readonly arrowMesh: THREE.BufferGeometry;
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

function buildMagpieTailGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Long graduated iridescent magpie tail (central rectrices significantly longer)
  for (let i = -2; i <= 2; i++) {
    const dist = Math.abs(i);
    const len = 0.44 - dist * 0.065;
    const feather = new THREE.CapsuleGeometry(0.025, len, 5, 8);
    feather.rotateX(Math.PI / 2);
    feather.scale(1.0, 0.28, 1.0);
    feather.rotateY(i * 0.08);
    feather.translate(i * 0.026, 0, -0.08 - len * 0.48);
    parts.push(feather);
  }
  return mergePartGeometries(parts, false);
}

function buildRaccoonTailRingsGeo(curve: THREE.CatmullRomCurve3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  for (const t of [0.22, 0.44, 0.66, 0.88]) {
    const pt = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();
    const r = 0.064 + Math.sin(t * Math.PI * 0.92) * 0.062;
    const ring = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.065, 12);
    quat.setFromUnitVectors(up, tan);
    ring.applyQuaternion(quat);
    ring.translate(pt.x, pt.y, pt.z);
    parts.push(ring);
  }
  return mergePartGeometries(parts, false);
}

function buildTurtleShellGeo(): { dome: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const domeParts: THREE.BufferGeometry[] = [];
  // Sculpted high-domed carapace oriented along the creature's back (-Z)
  const mainDome = new THREE.SphereGeometry(0.36, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
  mainDome.rotateX(-Math.PI / 2);
  mainDome.scale(0.98, 1.18, 0.86);
  domeParts.push(mainDome);

  // Subtle raised central vertebral scute plates along the ridge
  for (const yOff of [-0.18, 0.0, 0.18]) {
    const scute = new THREE.CylinderGeometry(0.082, 0.105, 0.055, 6);
    scute.rotateX(-Math.PI / 2);
    const zOff = -Math.sqrt(Math.max(0.02, 1 - (yOff / 0.42) ** 2)) * 0.29;
    scute.translate(0, yOff, zOff);
    domeParts.push(scute);
  }
  // Flank costal scutes on both sides of the dome
  for (const side of [-1, 1] as const) {
    for (const yOff of [-0.1, 0.1]) {
      const scute = new THREE.CylinderGeometry(0.072, 0.092, 0.048, 6);
      scute.rotateX(-Math.PI / 2);
      scute.rotateY(side * 0.42);
      scute.translate(side * 0.175, yOff, -0.22);
      domeParts.push(scute);
    }
  }

  // Flared marginal carapace rim framing the dome
  const rimParts: THREE.BufferGeometry[] = [];
  const rimRing = new THREE.TorusGeometry(0.34, 0.052, 10, 22);
  rimRing.scale(0.98, 1.18, 0.72);
  rimRing.translate(0, 0, -0.02);
  rimParts.push(rimRing);

  return {
    dome: mergePartGeometries(domeParts, false),
    rim: mergePartGeometries(rimParts, false),
  };
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

function buildBeaverTailGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.07, -0.08, -0.15, -0.26, -0.13, -0.46);
  shape.quadraticCurveTo(0, -0.62, 0.13, -0.46);
  shape.bezierCurveTo(0.15, -0.26, 0.07, -0.08, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.02, 0);
  return geo;
}

function buildFishBodyGeo(): THREE.BufferGeometry {
  // Streamlined hydrofoil koi profile revolved around Y, then oriented along +Z (nose forward)
  const pts = [
    new THREE.Vector2(0.0, -0.36),
    new THREE.Vector2(0.045, -0.32),
    new THREE.Vector2(0.115, -0.18),
    new THREE.Vector2(0.19, 0.0),
    new THREE.Vector2(0.215, 0.16),
    new THREE.Vector2(0.175, 0.3),
    new THREE.Vector2(0.095, 0.4),
    new THREE.Vector2(0.0, 0.45),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.rotateX(Math.PI / 2);
  geo.scale(0.84, 1.04, 1.0);
  return geo;
}

function buildFishTailFinGeo(): THREE.BufferGeometry {
  // Flowing forked koi caudal fin in the Y-Z plane extending toward -Z
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.045);
  shape.quadraticCurveTo(-0.18, 0.19, -0.36, 0.25);
  shape.quadraticCurveTo(-0.26, 0.08, -0.18, 0.0);
  shape.quadraticCurveTo(-0.26, -0.08, -0.36, -0.25);
  shape.quadraticCurveTo(-0.18, -0.19, 0, -0.045);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -0.011);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function buildFishDorsalFinGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.16, 0.0);
  shape.quadraticCurveTo(0.04, 0.2, -0.16, 0.17);
  shape.quadraticCurveTo(-0.24, 0.09, -0.2, 0.0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -0.009);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function buildFishPectoralFinGeo(side: -1 | 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(side * 0.14, 0.05, side * 0.23, -0.08);
  shape.quadraticCurveTo(side * 0.12, -0.16, 0, -0.06);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  geo.rotateX(Math.PI * 0.42);
  return geo;
}

function buildLilyHatGeo(): THREE.BufferGeometry {
  // Notched floating water-lily pad cap
  const shape = new THREE.Shape();
  const r = 0.36;
  const notch = 0.26;
  shape.moveTo(0, 0);
  for (let i = 0; i <= 22; i++) {
    const a = notch + (i / 22) * (Math.PI * 2 - notch * 2);
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.02, 0);
  return geo;
}

function buildMammalLegFootGeo(longRabbitFoot = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Upper thigh continuation tucked cleanly inside the tunic skirt so full strides never show a gap
  const thigh = new THREE.CylinderGeometry(0.064, 0.058, 0.16, 10);
  thigh.translate(0, 0.075, -0.005);
  parts.push(thigh);

  // Tapered lower leg / shin descending cleanly from the hip pivot (y = 0) down to the ankle
  const shin = new THREE.CylinderGeometry(0.058, 0.044, 0.215, 10);
  shin.translate(0, -0.11, -0.005);
  parts.push(shin);

  // Rounded ankle & heel joint
  const heel = new THREE.SphereGeometry(0.048, 10, 8);
  heel.scale(1.0, 0.88, 1.12);
  heel.translate(0, -0.228, -0.018);
  parts.push(heel);

  // Sculpted forward-projecting foot / paw pad resting squarely at y = -0.27
  const footMidLen = longRabbitFoot ? 0.145 : 0.088;
  const footZ = longRabbitFoot ? 0.095 : 0.068;
  const sole = new THREE.CapsuleGeometry(0.046, footMidLen, 6, 10);
  sole.rotateX(Math.PI / 2);
  sole.scale(longRabbitFoot ? 1.06 : 1.14, 0.68, 1.0);
  sole.translate(0, -0.239, footZ);
  parts.push(sole);

  // Three distinct sculpted forward toes fanned subtly across the front of the foot
  const toeAngles = [-0.28, 0, 0.28];
  const toeBaseZ = longRabbitFoot ? 0.175 : 0.122;
  const toeLen = longRabbitFoot ? 0.056 : 0.036;
  for (const ang of toeAngles) {
    const isCenter = ang === 0;
    const toe = new THREE.CapsuleGeometry(isCenter ? 0.024 : 0.021, toeLen, 5, 8);
    toe.rotateX(Math.PI / 2);
    toe.scale(1.0, 0.78, 1.0);
    toe.rotateY(ang);
    toe.translate(
      Math.sin(ang) * (longRabbitFoot ? 0.095 : 0.078),
      -0.248,
      toeBaseZ + (isCenter ? 0.016 : 0.002),
    );
    parts.push(toe);
  }

  return mergePartGeometries(parts, false);
}

function buildWebbedFootGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Upper thigh continuation tucked inside the tunic skirt across full strides
  const thigh = new THREE.CylinderGeometry(0.058, 0.052, 0.15, 10);
  thigh.translate(0, 0.07, -0.006);
  parts.push(thigh);

  // Articulated lower leg + ankle down to the webbed foot
  const shin = new THREE.CylinderGeometry(0.052, 0.039, 0.22, 10);
  shin.translate(0, -0.115, -0.006);
  parts.push(shin);

  const ankle = new THREE.SphereGeometry(0.043, 8, 8);
  ankle.scale(1.0, 0.82, 1.08);
  ankle.translate(0, -0.232, -0.012);
  parts.push(ankle);

  // Thin scalloped webbing membrane between the splayed digits
  const webShape = new THREE.Shape();
  webShape.moveTo(-0.028, -0.01);
  webShape.lineTo(-0.11, 0.17);
  webShape.quadraticCurveTo(-0.052, 0.132, 0, 0.195);
  webShape.quadraticCurveTo(0.052, 0.132, 0.11, 0.17);
  webShape.lineTo(0.028, -0.01);
  webShape.closePath();
  const web = new THREE.ExtrudeGeometry(webShape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelSize: 0.007,
    bevelThickness: 0.007,
    bevelSegments: 2,
  });
  web.rotateX(Math.PI / 2);
  web.translate(0, -0.244, 0.0);
  parts.push(web);

  // Three prominent splayed webbed toes extending smoothly forward
  for (const ang of [-0.46, 0, 0.46]) {
    const len = ang === 0 ? 0.15 : 0.13;
    const toe = new THREE.CapsuleGeometry(0.019, len, 5, 8);
    toe.rotateX(Math.PI / 2);
    toe.scale(1.0, 0.72, 1.0);
    toe.rotateY(ang);
    toe.translate(Math.sin(ang) * (len * 0.62), -0.25, Math.cos(ang) * (len * 0.62) + 0.015);
    parts.push(toe);
  }

  return mergePartGeometries(parts, false);
}

function buildBirdFootGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Feathered upper drumstick extending cleanly into the tunic skirt and tapering to slender avian tarsus
  const thigh = new THREE.CylinderGeometry(0.052, 0.024, 0.21, 8);
  thigh.translate(0, 0.025, 0);
  parts.push(thigh);

  const tarsus = new THREE.CylinderGeometry(0.021, 0.018, 0.185, 8);
  tarsus.rotateX(0.08);
  tarsus.translate(0, -0.16, 0.006);
  parts.push(tarsus);

  const ankle = new THREE.SphereGeometry(0.024, 8, 6);
  ankle.translate(0, -0.248, 0.014);
  parts.push(ankle);

  // Three forward-splayed articulated bird toes + rear hallux toe resting cleanly at y = -0.27
  for (const ang of [-0.44, 0, 0.44]) {
    const len = ang === 0 ? 0.125 : 0.105;
    const toe = new THREE.CapsuleGeometry(0.015, len, 4, 7);
    toe.rotateX(Math.PI / 2);
    toe.rotateY(ang);
    toe.translate(Math.sin(ang) * (len * 0.56), -0.255, 0.02 + Math.cos(ang) * (len * 0.56));
    parts.push(toe);
  }
  const rearToe = new THREE.CapsuleGeometry(0.014, 0.062, 4, 6);
  rearToe.rotateX(Math.PI / 2);
  rearToe.translate(0, -0.255, -0.032);
  parts.push(rearToe);

  return mergePartGeometries(parts, false);
}

function buildAxeHeadGeo(): THREE.BufferGeometry {
  // Bearded woodcutter's axe head in the Y-Z plane:
  // flat poll at +Y, haft eye at origin, flared crescent cutting bit at -Y
  const shape = new THREE.Shape();
  shape.moveTo(-0.044, 0.048);
  shape.lineTo(0.044, 0.048);
  shape.lineTo(0.048, -0.015);
  shape.quadraticCurveTo(0.068, -0.095, 0.098, -0.155);
  shape.quadraticCurveTo(0.0, -0.225, -0.106, -0.165);
  shape.quadraticCurveTo(-0.066, -0.088, -0.048, -0.015);
  shape.closePath();

  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.038,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.007,
    bevelSegments: 2,
  });
  blade.translate(0, 0, -0.019);
  blade.rotateY(-Math.PI / 2);

  // Forge-taper the cutting bit along X as y approaches the sharp crescent edge
  const pos = blade.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.03) {
      const t = Math.min(1, (-0.03 - y) / 0.19);
      const scaleX = THREE.MathUtils.lerp(1.0, 0.24, t * t);
      pos.setX(i, pos.getX(i) * scaleX);
    }
  }
  pos.needsUpdate = true;
  blade.computeVertexNormals();
  return blade;
}

function buildSpadeBladeGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Pointed shield-shaped shovel scoop extending along +Z
  const shape = new THREE.Shape();
  shape.moveTo(-0.094, 0.0);
  shape.lineTo(0.094, 0.0);
  shape.lineTo(0.102, 0.13);
  shape.quadraticCurveTo(0.072, 0.21, 0.0, 0.255);
  shape.quadraticCurveTo(-0.072, 0.21, -0.102, 0.13);
  shape.closePath();

  const scoop = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  scoop.translate(0, 0, -0.007);
  scoop.rotateX(Math.PI / 2);

  // Subtle upward dish curvature along the side edges so the blade reads as a 3D scoop
  const pos = scoop.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dish = x * x * 1.45 - Math.max(0, z - 0.12) * 0.06;
    pos.setY(i, pos.getY(i) + dish);
  }
  pos.needsUpdate = true;
  scoop.computeVertexNormals();
  parts.push(scoop);

  // Upturned foot-tread shoulders along the rear edge of the scoop
  const tread = new THREE.BoxGeometry(0.186, 0.024, 0.02);
  tread.translate(0, 0.014, 0.008);
  parts.push(tread);

  // Forged steel socket hosel joining the ash shaft to the blade
  const socket = new THREE.CylinderGeometry(0.032, 0.038, 0.1, 10);
  socket.rotateX(Math.PI / 2);
  socket.translate(0, 0.008, -0.025);
  parts.push(socket);

  return mergePartGeometries(parts, false);
}

function buildTrowelBladeGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Pointed leaf-shaped mason's trowel blade lying in the X-Z plane
  const shape = new THREE.Shape();
  shape.moveTo(0.0, 0.0);
  shape.quadraticCurveTo(0.072, 0.008, 0.084, 0.065);
  shape.quadraticCurveTo(0.074, 0.145, 0.0, 0.225);
  shape.quadraticCurveTo(-0.074, 0.145, -0.084, 0.065);
  shape.quadraticCurveTo(-0.072, 0.008, 0.0, 0.0);
  shape.closePath();

  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.009,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
  });
  blade.translate(0, 0, -0.0045);
  blade.rotateX(Math.PI / 2);
  parts.push(blade);

  // Stepped S-crank mason's steel tang linking blade heel up to the handle ferrule
  const riser = new THREE.CylinderGeometry(0.012, 0.014, 0.052, 8);
  riser.rotateX(-0.48);
  riser.translate(0, 0.021, 0.0);
  parts.push(riser);

  const stem = new THREE.CylinderGeometry(0.012, 0.013, 0.056, 8);
  stem.rotateX(Math.PI / 2);
  stem.translate(0, 0.042, -0.032);
  parts.push(stem);

  return mergePartGeometries(parts, false);
}

function buildHammerHeadGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Central forged cheek & eye block centered on the handle eye
  const cheek = new THREE.CylinderGeometry(0.044, 0.044, 0.088, 10);
  cheek.scale(0.86, 1.0, 1.06);
  parts.push(cheek);

  // Turned neck leading to the striking bell (-Y is downward strike direction)
  const neck = new THREE.CylinderGeometry(0.032, 0.038, 0.046, 10);
  neck.translate(0, -0.064, 0);
  parts.push(neck);

  // Flared round striking face / bell
  const bell = new THREE.CylinderGeometry(0.046, 0.042, 0.03, 12);
  bell.translate(0, -0.096, 0);
  parts.push(bell);

  // Twin curved split carpenter's claws curving back toward (+Y, -Z) with nail-puller slot
  const clawShape = new THREE.Shape();
  clawShape.moveTo(-0.026, 0.032);
  clawShape.lineTo(0.026, 0.032);
  clawShape.quadraticCurveTo(0.022, 0.086, -0.022, 0.118);
  clawShape.quadraticCurveTo(-0.052, 0.128, -0.072, 0.114);
  clawShape.quadraticCurveTo(-0.042, 0.092, -0.026, 0.032);
  clawShape.closePath();

  for (const side of [-1, 1] as const) {
    const prong = new THREE.ExtrudeGeometry(clawShape, {
      depth: 0.015,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 1,
    });
    prong.translate(0, 0, -0.0075);
    prong.rotateY(-Math.PI / 2);
    prong.translate(side * 0.017, 0, 0);
    parts.push(prong);
  }

  return mergePartGeometries(parts, false);
}

/** Tapered double-edged broadsword blade extending along +Z from crossguard (0) to tip (0.64). */
function buildSwordBladeGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.044, 0.0);
  shape.lineTo(0.044, 0.0);
  shape.lineTo(0.036, 0.48);
  shape.lineTo(0.0, 0.64);
  shape.lineTo(-0.036, 0.48);
  shape.closePath();

  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  blade.translate(0, 0, -0.006);
  blade.rotateX(Math.PI / 2);
  blade.computeVertexNormals();
  return blade;
}

/** Leaf-shaped forged war spearhead extending along +Z. */
function buildSpearTipGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shape = new THREE.Shape();
  shape.moveTo(0.0, 0.0);
  shape.quadraticCurveTo(0.062, 0.06, 0.042, 0.16);
  shape.lineTo(0.0, 0.34);
  shape.lineTo(-0.042, 0.16);
  shape.quadraticCurveTo(-0.062, 0.06, 0.0, 0.0);
  shape.closePath();

  const tip = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  tip.translate(0, 0, -0.006);
  tip.rotateX(Math.PI / 2);
  parts.push(tip);

  const socket = new THREE.CylinderGeometry(0.025, 0.029, 0.09, 8);
  socket.rotateX(Math.PI / 2);
  socket.translate(0, 0, -0.025);
  parts.push(socket);
  return mergePartGeometries(parts, false);
}

/** Heavy bearded war-axe head sweeping downward (-Y) with a curved chopping bit. */
function buildBattleAxeHeadGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shape = new THREE.Shape();
  shape.moveTo(-0.03, 0.05);
  shape.lineTo(0.06, 0.08);
  shape.quadraticCurveTo(0.16, 0.02, 0.19, -0.14);
  shape.quadraticCurveTo(0.08, -0.24, -0.07, -0.22);
  shape.quadraticCurveTo(-0.1, -0.1, -0.05, -0.04);
  shape.lineTo(-0.05, 0.05);
  shape.closePath();

  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.007,
    bevelSize: 0.006,
    bevelSegments: 1,
  });
  blade.translate(0, 0, -0.011);
  blade.rotateY(Math.PI / 2);
  parts.push(blade);

  // Back spike / counterweight poll
  const spike = new THREE.ConeGeometry(0.028, 0.12, 6);
  spike.translate(0, 0.09, 0);
  parts.push(spike);
  return mergePartGeometries(parts, false);
}

/** Flared heavy oak war-club head extending along +Z. */
function buildWarClubHeadGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const club = new THREE.CylinderGeometry(0.078, 0.03, 0.52, 10);
  club.rotateX(Math.PI / 2);
  club.translate(0, 0, 0.34);
  parts.push(club);

  const cap = new THREE.SphereGeometry(0.078, 10, 8);
  cap.translate(0, 0, 0.59);
  parts.push(cap);
  return mergePartGeometries(parts, false);
}

/** Curved recurve wooden bow stave centered in the Y-Z plane. */
function buildBowStaveGeo(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.42, -0.06),
    new THREE.Vector3(0, -0.24, 0.08),
    new THREE.Vector3(0, 0.0, 0.13),
    new THREE.Vector3(0, 0.24, 0.08),
    new THREE.Vector3(0, 0.42, -0.06),
  ]);
  return createTaperedTubeGeo(
    curve,
    16,
    8,
    (t) => 0.016 + Math.sin(t * Math.PI) * 0.014,
    true,
  );
}

/** Complete war arrow pointing along +Z (fletching at -0.24, steel tip at +0.28). */
function buildArrowGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shaft = new THREE.CylinderGeometry(0.011, 0.011, 0.48, 6);
  shaft.rotateX(Math.PI / 2);
  parts.push(shaft);

  const head = new THREE.ConeGeometry(0.028, 0.1, 4);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, 0.26);
  parts.push(head);

  // Crossed fletching fins at the tail
  const finA = new THREE.BoxGeometry(0.075, 0.006, 0.1);
  finA.translate(0, 0, -0.2);
  parts.push(finA);
  const finB = new THREE.BoxGeometry(0.006, 0.075, 0.1);
  finB.translate(0, 0, -0.2);
  parts.push(finB);
  return mergePartGeometries(parts, false);
}

function createSharedGeometries(): SharedGeometries {
  // Pear-shaped cozy pleated woodland tunic (knee/shin hem at y = 0.24 so legs & feet show cleanly)
  const tunicPts = [
    new THREE.Vector2(0.0, 0.24),
    new THREE.Vector2(0.29, 0.24),
    new THREE.Vector2(0.35, 0.28),
    new THREE.Vector2(0.33, 0.42),
    new THREE.Vector2(0.26, 0.57),
    new THREE.Vector2(0.24, 0.7),
    new THREE.Vector2(0.18, 0.79),
    new THREE.Vector2(0.0, 0.81),
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

  // Thick downward-sweeping timber wolf tail + dark tip
  const wolfCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.06, -0.22),
    new THREE.Vector3(0, -0.14, -0.46),
    new THREE.Vector3(0, -0.08, -0.66),
  ]);
  const wolfTailMain = createTaperedTubeGeo(
    wolfCurve,
    14,
    12,
    (t) => 0.072 + Math.sin(t * Math.PI * 0.9) * 0.078,
    true,
  );
  const wolfTailTip = createOrganicPuffGeo(0.095, 2, 0.1, 3.1);
  wolfTailTip.scale(0.88, 0.92, 1.45);
  wolfTailTip.translate(0, -0.06, -0.72);

  // Graceful upright S-curved feline tail
  const catCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.04, -0.22),
    new THREE.Vector3(0, 0.28, -0.34),
    new THREE.Vector3(0, 0.56, -0.32),
    new THREE.Vector3(0.04, 0.72, -0.24),
  ]);
  const catTail = createTaperedTubeGeo(
    catCurve,
    18,
    10,
    (t) => THREE.MathUtils.lerp(0.052, 0.036, Math.pow(t, 0.85)),
    true,
  );

  // Plush ringed raccoon tail
  const raccoonCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.03, -0.22),
    new THREE.Vector3(0, 0.04, -0.45),
    new THREE.Vector3(0, 0.14, -0.62),
  ]);
  const raccoonTail = createTaperedTubeGeo(
    raccoonCurve,
    16,
    12,
    (t) => 0.064 + Math.sin(t * Math.PI * 0.92) * 0.062,
    true,
  );
  const raccoonTailRings = buildRaccoonTailRingsGeo(raccoonCurve);

  // Sleek slender weasel tail + dark espresso tip
  const weaselCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.04, -0.2),
    new THREE.Vector3(0, 0.01, -0.42),
    new THREE.Vector3(0, 0.08, -0.58),
  ]);
  const weaselTail = createTaperedTubeGeo(
    weaselCurve,
    14,
    10,
    (t) => THREE.MathUtils.lerp(0.048, 0.026, t),
    true,
  );
  const weaselTailTip = new THREE.SphereGeometry(0.036, 10, 8);
  weaselTailTip.scale(0.85, 0.85, 1.55);
  weaselTailTip.translate(0, 0.09, -0.61);

  // Coiled serpentine lower body + sweeping articulated snake tail
  const snakeCoilCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.02, 0.085, -0.22),
    new THREE.Vector3(0.24, 0.085, 0.02),
    new THREE.Vector3(0.0, 0.1, 0.22),
    new THREE.Vector3(-0.2, 0.14, -0.02),
    new THREE.Vector3(-0.04, 0.34, -0.04),
    new THREE.Vector3(0.0, 0.58, 0.01),
  ]);
  const snakeCoil = createTaperedTubeGeo(
    snakeCoilCurve,
    24,
    12,
    (t) => 0.092 + Math.sin(t * Math.PI * 0.7) * 0.038,
    true,
  );
  const snakeTailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.09, 0),
    new THREE.Vector3(-0.14, 0.078, -0.24),
    new THREE.Vector3(0.12, 0.064, -0.5),
    new THREE.Vector3(-0.08, 0.048, -0.76),
    new THREE.Vector3(0.02, 0.03, -0.96),
  ]);
  const snakeTail = createTaperedTubeGeo(
    snakeTailCurve,
    18,
    10,
    (t) => THREE.MathUtils.lerp(0.088, 0.014, Math.pow(t, 0.82)),
    true,
  );

  const turtleShellParts = buildTurtleShellGeo();

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

  const boot = buildMammalLegFootGeo(false);
  const rabbitFoot = buildMammalLegFootGeo(true);

  const arm = new THREE.CapsuleGeometry(0.056, 0.19, 6, 10);
  arm.translate(0, -0.11, 0);

  const selectionRing = new THREE.RingGeometry(0.56, 0.72, 36);
  selectionRing.rotateX(-Math.PI / 2);

  const furCollar = new THREE.TorusGeometry(0.235, 0.078, 10, 22);
  furCollar.rotateX(Math.PI / 2);

  // Tiny faceted wood splinter / earth clod / stone pebble for active construction debris
  const workChip = new THREE.DodecahedronGeometry(0.038, 0);
  workChip.scale(1.4, 0.52, 0.85);
  workChip.computeVertexNormals();

  const otterCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.05, -0.22),
    new THREE.Vector3(0, -0.07, -0.48),
    new THREE.Vector3(0, -0.04, -0.72),
  ]);
  const otterTail = createTaperedTubeGeo(
    otterCurve,
    14,
    12,
    (t) => THREE.MathUtils.lerp(0.088, 0.022, Math.pow(t, 0.82)),
    true,
  );

  const swimRipple = new THREE.RingGeometry(0.42, 0.54, 24);
  swimRipple.rotateX(-Math.PI / 2);

  return {
    tunic,
    mantle,
    belt,
    buckle,
    head: new THREE.SphereGeometry(0.265, 24, 18),
    eye: new THREE.SphereGeometry(0.054, 16, 14),
    eyeRim: new THREE.TorusGeometry(0.055, 0.011, 8, 18),
    selectionBead: new THREE.SphereGeometry(0.018, 8, 8),
    nose: new THREE.SphereGeometry(0.036, 10, 8),
    whisker: new THREE.CylinderGeometry(0.004, 0.002, 0.22, 4),
    arm,
    paw: new THREE.SphereGeometry(0.06, 10, 8),
    boot,
    rabbitFoot,
    webbedFoot: buildWebbedFootGeo(),
    birdFoot: buildBirdFootGeo(),
    wingLeft: buildLayeredWingGeo(-1),
    wingRight: buildLayeredWingGeo(1),
    birdTail: buildBirdTailGeo(),
    magpieTail: buildMagpieTailGeo(),
    squirrelTail,
    foxTailMain,
    foxTailTip,
    wolfTailMain,
    wolfTailTip,
    catTail,
    raccoonTail,
    raccoonTailRings,
    weaselTail,
    weaselTailTip,
    snakeCoil,
    snakeTail,
    turtleShell: turtleShellParts.dome,
    turtleShellRim: turtleShellParts.rim,
    rodentTail,
    bunnyTail,
    hedgehogQuills: buildHedgehogQuillsGeo(),
    wizardHat: buildWizardHatGeo(),
    acornHat: buildAcornHatGeo(),
    selectionRing,
    workChip,
    axeHead: buildAxeHeadGeo(),
    spadeBlade: buildSpadeBladeGeo(),
    trowelBlade: buildTrowelBladeGeo(),
    hammerHead: buildHammerHeadGeo(),
    reedHat: buildReedHatGeo(),
    strawHat: buildStrawHatGeo(),
    furCollar,
    beaverTail: buildBeaverTailGeo(),
    otterTail,
    fishBody: buildFishBodyGeo(),
    fishTailFin: buildFishTailFinGeo(),
    fishDorsalFin: buildFishDorsalFinGeo(),
    fishPectoralFinL: buildFishPectoralFinGeo(-1),
    fishPectoralFinR: buildFishPectoralFinGeo(1),
    lilyHat: buildLilyHatGeo(),
    swimRipple,
    swordBlade: buildSwordBladeGeo(),
    spearTip: buildSpearTipGeo(),
    battleAxeHead: buildBattleAxeHeadGeo(),
    warClubHead: buildWarClubHeadGeo(),
    bowStave: buildBowStaveGeo(),
    arrowMesh: buildArrowGeo(),
  };
}

/**
 * Renders high-resolution, whimsical, articulated 3D woodland creatures across all 21 species
 * and all 6 settlement roles, featuring plush fur/fabric shading, glossy catchlight eyes,
 * rosy cheeks, layered bird wings, lush curved tails, charming role props, and lively animation.
 */
export class CreatureRenderer {
  readonly rootGroup = new THREE.Group();

  private readonly rigs = new Map<string, CreatureRig>();
  private readonly sparks: SparkVisual[] = [];
  private readonly arrows: ArrowVisual[] = [];
  private readonly gore: CombatGoreSystem;
  private readonly geo: SharedGeometries;
  private readonly speciesMats = new Map<SpeciesId, SpeciesMaterialSet>();
  private readonly adaptationMats = new Map<
    VillageAdaptationId,
    { readonly mantle: THREE.MeshStandardMaterial; readonly accent: THREE.MeshStandardMaterial }
  >();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly sharedDisposableSet = new Set<THREE.BufferGeometry | THREE.Material>();
  private readonly primGeoCache = new Map<string, THREE.BufferGeometry>();

  // Shared detail materials
  private readonly eyeMat: THREE.MeshPhysicalMaterial;
  private readonly eyelidRimMat: THREE.MeshStandardMaterial;
  private readonly warmIrisMat: THREE.MeshPhysicalMaterial;
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
  private readonly catIrisMat: THREE.MeshStandardMaterial;
  private readonly snakeIrisMat: THREE.MeshStandardMaterial;
  private readonly tongueMat: THREE.MeshStandardMaterial;
  private readonly pigeonIridescentMat: THREE.MeshStandardMaterial;
  private readonly turtleShellRimMat: THREE.MeshStandardMaterial;
  private readonly selectionMat: THREE.MeshBasicMaterial;
  private readonly steelMat: THREE.MeshStandardMaterial;
  private readonly reedWeaveMat: THREE.MeshStandardMaterial;
  private readonly strawWeaveMat: THREE.MeshStandardMaterial;
  private readonly beaverToothMat: THREE.MeshPhysicalMaterial;
  private readonly fishFinMat: THREE.MeshPhysicalMaterial;
  private readonly lilyPadHatMat: THREE.MeshPhysicalMaterial;
  private readonly lotusPinkMat: THREE.MeshPhysicalMaterial;
  private readonly swimRippleMat: THREE.MeshBasicMaterial;
  private readonly ironMat: THREE.MeshStandardMaterial;
  private readonly crimsonMat: THREE.MeshStandardMaterial;
  private readonly bowstringMat: THREE.MeshStandardMaterial;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    private readonly textures?: TextureLibrary,
  ) {
    this.geo = createSharedGeometries();
    this.trackDisposables(...Object.values(this.geo));

    const fabricDetail: Partial<THREE.MeshStandardMaterialParameters> = textures?.fabricNormal
      ? { normalMap: textures.fabricNormal, normalScale: new THREE.Vector2(0.48, 0.48) }
      : { bumpMap: textures?.fabricBump ?? null, bumpScale: 0.045 };

    // Wet clearcoated animal cornea/pupil that catches real PMREM sky & sun reflections
    this.eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x08090c,
      roughness: 0.035,
      metalness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 1.0,
      envMapIntensity: 2.35,
    });
    this.eyelidRimMat = new THREE.MeshStandardMaterial({
      color: 0x1d1715,
      roughness: 0.78,
    });
    this.warmIrisMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a2213,
      roughness: 0.08,
      clearcoat: 0.95,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.85,
    });
    this.pinkInnerMat = new THREE.MeshPhysicalMaterial({
      color: 0xcfa09c,
      roughness: 0.88,
      sheen: 0.45,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color(0xe6c8c4),
    });
    this.noseBlackMat = new THREE.MeshPhysicalMaterial({
      color: 0x161314,
      roughness: 0.22,
      metalness: 0.04,
      clearcoat: 0.65,
      clearcoatRoughness: 0.16,
    });
    this.nosePinkMat = new THREE.MeshPhysicalMaterial({
      color: 0xc97b80,
      roughness: 0.34,
      clearcoat: 0.52,
      clearcoatRoughness: 0.22,
    });
    this.whiskerMat = new THREE.MeshStandardMaterial({
      color: 0xe6dfd3,
      roughness: 0.68,
    });
    this.leatherMat = new THREE.MeshStandardMaterial({
      color: 0x523520,
      roughness: 0.72,
      ...fabricDetail,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xcfa652,
      roughness: 0.3,
      metalness: 0.82,
    });
    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x7d5737,
      roughness: 0.86,
      bumpMap: textures?.fabricBump ?? null,
      bumpScale: 0.025,
    });
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x4b7834,
      roughness: 0.78,
    });
    this.berryRedMat = new THREE.MeshPhysicalMaterial({
      color: 0xa82e30,
      roughness: 0.34,
      clearcoat: 0.38,
      clearcoatRoughness: 0.24,
    });
    this.berryBlueMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a4a82,
      roughness: 0.38,
      clearcoat: 0.32,
      clearcoatRoughness: 0.28,
    });
    this.crystalGlowMat = new THREE.MeshStandardMaterial({
      color: 0x8de0cf,
      emissive: 0x38b89b,
      emissiveIntensity: 0.92,
      roughness: 0.16,
    });
    this.lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xf7d88a,
      emissive: 0xee962e,
      emissiveIntensity: 0.95,
      roughness: 0.24,
    });
    this.owlIrisMat = new THREE.MeshPhysicalMaterial({
      color: 0xd99b24,
      emissive: 0x3d2204,
      emissiveIntensity: 0.14,
      roughness: 0.09,
      clearcoat: 0.95,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.8,
    });
    this.frogIrisMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8a436,
      roughness: 0.09,
      clearcoat: 0.95,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.8,
    });
    this.catIrisMat = new THREE.MeshPhysicalMaterial({
      color: 0x5c9e47,
      roughness: 0.08,
      clearcoat: 0.96,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.85,
    });
    this.snakeIrisMat = new THREE.MeshPhysicalMaterial({
      color: 0xd48f24,
      roughness: 0.08,
      clearcoat: 0.96,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.85,
    });
    this.tongueMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8363c,
      roughness: 0.34,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
    });
    this.pigeonIridescentMat = new THREE.MeshPhysicalMaterial({
      color: 0x2f685a,
      roughness: 0.34,
      metalness: 0.16,
      iridescence: 0.88,
      iridescenceIOR: 1.42,
      sheen: 0.55,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(0x8c5cc4),
    });
    this.turtleShellRimMat = new THREE.MeshPhysicalMaterial({
      color: 0x7d6b42,
      roughness: 0.5,
      clearcoat: 0.28,
      clearcoatRoughness: 0.34,
      bumpMap: textures?.fabricBump ?? null,
      bumpScale: 0.02,
    });
    this.selectionMat = new THREE.MeshBasicMaterial({
      color: 0xffe57f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    this.steelMat = new THREE.MeshStandardMaterial({
      color: 0xb6c0ca,
      roughness: 0.3,
      metalness: 0.82,
    });
    this.reedWeaveMat = new THREE.MeshPhysicalMaterial({
      color: 0x9c9264,
      roughness: 0.92,
      sheen: 0.25,
      sheenRoughness: 0.82,
      ...fabricDetail,
    });
    this.strawWeaveMat = new THREE.MeshPhysicalMaterial({
      color: 0xcfb260,
      roughness: 0.9,
      sheen: 0.28,
      sheenRoughness: 0.8,
      ...fabricDetail,
    });
    this.beaverToothMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4ead2,
      roughness: 0.22,
      clearcoat: 0.45,
      clearcoatRoughness: 0.2,
    });
    this.fishFinMat = new THREE.MeshPhysicalMaterial({
      color: 0xffb36b,
      roughness: 0.22,
      clearcoat: 0.65,
      clearcoatRoughness: 0.14,
      iridescence: 0.55,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide,
    });
    this.lilyPadHatMat = new THREE.MeshPhysicalMaterial({
      color: 0x3b9652,
      roughness: 0.42,
      clearcoat: 0.35,
      clearcoatRoughness: 0.28,
      sheen: 0.28,
      sheenColor: new THREE.Color(0x9be29c),
    });
    this.lotusPinkMat = new THREE.MeshPhysicalMaterial({
      color: 0xf68db3,
      roughness: 0.36,
      sheen: 0.48,
      sheenColor: new THREE.Color(0xffd6e6),
    });
    this.swimRippleMat = new THREE.MeshBasicMaterial({
      color: 0xc8f4ff,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ironMat = new THREE.MeshStandardMaterial({
      color: 0x4b535e,
      roughness: 0.38,
      metalness: 0.82,
    });
    this.crimsonMat = new THREE.MeshStandardMaterial({
      color: 0xa62626,
      roughness: 0.62,
      metalness: 0.08,
    });
    this.bowstringMat = new THREE.MeshStandardMaterial({
      color: 0xe6dcc7,
      roughness: 0.85,
      metalness: 0.0,
    });

    this.trackDisposables(
      this.eyeMat,
      this.eyelidRimMat,
      this.warmIrisMat,
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
      this.catIrisMat,
      this.snakeIrisMat,
      this.tongueMat,
      this.pigeonIridescentMat,
      this.turtleShellRimMat,
      this.selectionMat,
      this.steelMat,
      this.reedWeaveMat,
      this.strawWeaveMat,
      this.beaverToothMat,
      this.fishFinMat,
      this.lilyPadHatMat,
      this.lotusPinkMat,
      this.swimRippleMat,
      this.ironMat,
      this.crimsonMat,
      this.bowstringMat,
    );

    this.gore = new CombatGoreSystem(world);
    this.rootGroup.add(this.gore.group);

    scene.add(this.rootGroup);
    this.syncCreatures(null);
  }

  private trackDisposables(...items: (THREE.BufferGeometry | THREE.Material)[]): void {
    for (const item of items) {
      this.disposables.push(item);
      this.sharedDisposableSet.add(item);
    }
  }

  spawnCombatSpark(spark: CombatSparkVisual): void {
    const kind = spark.kind ?? 'clash';

    // 3D parabolic arrow flight from archer to target
    if (kind === 'arrow' && spark.targetPosition) {
      const start = new THREE.Vector3(spark.position.x, spark.position.y, spark.position.z);
      const end = new THREE.Vector3(spark.targetPosition.x, spark.targetPosition.y, spark.targetPosition.z);
      const dist = start.distanceTo(end);
      const mesh = new THREE.Mesh(this.geo.arrowMesh, this.ironMat);
      mesh.name = 'war_arrow';
      mesh.position.copy(start);
      mesh.scale.setScalar(1.35);
      mesh.lookAt(end);
      this.rootGroup.add(mesh);
      this.arrows.push({
        mesh,
        createdAt: spark.createdAt,
        duration: Math.max(0.18, spark.duration),
        start,
        end,
        arcHeight: Math.min(2.6, 0.45 + dist * 0.14),
      });
      return;
    }

    // Physically grounded arterial blood spray, bouncing 3D gibs, blood pools, and carrion flies
    this.gore.spawnImpact(spark);
  }

  /** Spawns tiny lit 3D wood splinters, earthen clods, stone chips, or hammer sparks when actively constructing. */
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
              : [0xf7d88b, 0xd4a362, 0xffe49e];

    const isSparkStage = stage === 'framing' || stage === 'finishing';
    const fx = c.x + Math.sin(c.heading) * 0.48;
    const fz = c.z + Math.cos(c.heading) * 0.48;
    for (let i = 0; i < 2; i++) {
      const color = palette[Math.floor(Math.random() * palette.length)];
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: isSparkStage ? 0.36 : 0.86,
        metalness: isSparkStage ? 0.24 : 0.02,
        emissive: isSparkStage ? color : 0x000000,
        emissiveIntensity: isSparkStage ? 0.42 : 0,
        transparent: true,
        opacity: 0.95,
      });
      const baseScale = 0.72 + Math.random() * 0.5;
      const mesh = new THREE.Mesh(this.geo.workChip, mat);
      mesh.name = 'work_chip';
      mesh.position.set(
        fx + (Math.random() - 0.5) * 0.24,
        c.y + 0.52 + Math.random() * 0.26,
        fz + (Math.random() - 0.5) * 0.24,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.scale.setScalar(baseScale);
      this.rootGroup.add(mesh);
      this.sparks.push({
        mesh,
        mat,
        createdAt: this.world.elapsedSeconds,
        duration: 0.42 + Math.random() * 0.18,
        vx: (Math.random() - 0.5) * 1.25,
        vy: 1.15 + Math.random() * 0.75,
        vz: (Math.random() - 0.5) * 1.25,
        baseScale,
        gravity: 4.8,
      });
    }
  }

  /** Spawns tiny colorful fluttering petals / confetti sparkles above creatures dancing at a celebration. */
  private spawnFestivalConfetti(c: Creature): void {
    const cel = c.activeCelebrationId
      ? this.world.festivals.getCelebrationById(c.activeCelebrationId)
      : undefined;
    const palette = cel
      ? [cel.colorHex, cel.secondaryColorHex, 0xffe57f]
      : [0xffc857, 0xff6b9d, 0x4cc9f0];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      roughness: 0.42,
      transparent: true,
      opacity: 0.92,
    });
    const baseScale = 0.44 + Math.random() * 0.24;
    const mesh = new THREE.Mesh(this.geo.workChip, mat);
    mesh.name = 'festival_confetti';
    mesh.position.set(
      c.x + (Math.random() - 0.5) * 0.36,
      c.y + 0.95 + Math.random() * 0.35,
      c.z + (Math.random() - 0.5) * 0.36,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.scale.setScalar(baseScale);
    this.rootGroup.add(mesh);
    this.sparks.push({
      mesh,
      mat,
      createdAt: this.world.elapsedSeconds,
      duration: 0.72 + Math.random() * 0.28,
      vx: (Math.random() - 0.5) * 0.85,
      vy: 1.05 + Math.random() * 0.55,
      vz: (Math.random() - 0.5) * 0.85,
      baseScale,
      gravity: 1.7,
    });
  }

  update(dt: number, selection: SelectionTarget, povCreatureId: string | null = null): void {
    this.syncCreatures(selection);
    const t = this.world.elapsedSeconds;
    const safeDt = Math.max(0, Math.min(dt, 0.1));
    const posLerp = 1 - Math.exp(-13 * safeDt);
    const rotLerp = 1 - Math.exp(-11 * safeDt);
    const moveLerp = 1 - Math.exp(-9 * safeDt);
    const poseLerp = 1 - Math.exp(-10 * safeDt);
    const limbLerp = 1 - Math.exp(-12 * safeDt);

    for (const c of this.world.creatures) {
      const rig = this.rigs.get(c.id);
      if (!rig) continue;

      if (!c.alive || c.id === povCreatureId) {
        rig.root.visible = false;
        // Keep rig synced quietly while hidden in Eye View so exiting POV never snaps
        rig.root.position.set(c.x, c.y, c.z);
        rig.root.rotation.y = c.heading;
        rig.stridePhase = c.animPhase;
        rig.lastSimAnimPhase = c.animPhase;
        continue;
      }
      rig.root.visible = true;

      const prevRootX = rig.root.position.x;
      const prevRootZ = rig.root.position.z;

      // Frame-rate independent exponential position interpolation
      rig.root.position.x += (c.x - rig.root.position.x) * posLerp;
      rig.root.position.y += (c.y - rig.root.position.y) * posLerp;
      rig.root.position.z += (c.z - rig.root.position.z) * posLerp;

      // Smooth yaw rotation with playful banking lean
      let diff = c.heading - rig.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      rig.root.rotation.y += diff * rotLerp;

      // Exact horizontal displacement actually traversed by the rendered rig this frame
      const dxR = rig.root.position.x - prevRootX;
      const dzR = rig.root.position.z - prevRootZ;
      const renderDist = Math.hypot(dxR, dzR);
      const renderFwdDist = Math.max(
        0,
        dxR * Math.sin(rig.root.rotation.y) + dzR * Math.cos(rig.root.rotation.y),
      );

      // Smooth locomotion blend (0 at rest, 1 at full stride) so stationary creatures settle gently
      const targetMove = c.activity === 'resting' ? 0 : c.moveIntensity;
      rig.moveBlend += (targetMove - rig.moveBlend) * moveLerp;
      const move = rig.moveBlend;
      const targetGait = c.activity === 'resting' ? 0 : c.gaitEffort;
      rig.gaitBlend += (targetGait - rig.gaitBlend) * moveLerp;

      const seed = rig.seedPhase;
      let bobY = 0;
      let tiltZ = THREE.MathUtils.clamp(-diff * 0.2, -0.15, 0.15) * (0.25 + 0.75 * move);
      let tiltX = 0;
      let squashY = 1.0;
      let headPitch = Math.sin(t * 1.6 + seed) * 0.04;
      let headRoll = Math.sin(t * 1.15 + seed * 2.1) * 0.055;

      const isBird = c.def.locomotion === 'fly';
      const isSnake = c.def.locomotion === 'slither';
      const isFish = c.species === 'fish';
      const isAirborne = isBird && c.flightAltitude > 0.3;
      const isSwimmingInWater =
        Boolean(c.def.aquatic) &&
        this.world.terrain.getHeightAt(c.x, c.z) < this.world.terrain.waterLevel - 0.02;

      const effectiveScale = c.getSizeScale();
      const preScaleXZ = effectiveScale / Math.sqrt(Math.max(0.5, rig.squashY));
      const strideMetrics = computeStrideMetrics(c.def.locomotion, rig.gaitBlend, preScaleXZ);
      const { pace, runFactor } = strideMetrics;

      // Advance visual stride phase in exact 1:1 lockstep with rendered forward ground displacement
      // so planted feet sweep backward at the exact speed the body moves forward (zero skating!)
      if (isAirborne || isFish || isSwimmingInWater || renderDist >= 2.5) {
        rig.stridePhase = c.animPhase;
      } else if (renderDist > 1e-5) {
        rig.stridePhase += (renderFwdDist / strideMetrics.cycleLengthWorld) * Math.PI * 2;
      } else if (c.animPhase !== rig.lastSimAnimPhase) {
        rig.stridePhase = c.animPhase;
      }
      rig.lastSimAnimPhase = c.animPhase;
      const phase = rig.stridePhase;

      let leftArmX = 0;
      let leftArmY = 0;
      let leftArmZ = 0.16;
      let rightArmX = 0;
      let rightArmY = 0;
      let rightArmZ = -0.16;
      let leftFootX = 0;
      let rightFootX = 0;
      let leftFootY = rig.baseFootY;
      let rightFootY = rig.baseFootY;
      let leftFootZ = rig.baseFootZ;
      let rightFootZ = rig.baseFootZ;

      // Walking rises over the planted vertical leg at mid-stance; running springs up into flight between steps
      const walkBounce = 0.5 + 0.5 * Math.cos(phase * 2);
      const runBounce = 0.5 - 0.5 * Math.cos(phase * 2);
      const strideBounce = THREE.MathUtils.lerp(walkBounce, runBounce, runFactor);
      const hopSample =
        c.def.locomotion === 'hop' && !isSwimmingInWater
          ? sampleHopCycle(
              phase,
              strideMetrics.halfStrideLocal,
              strideMetrics.dutyFactor,
              strideMetrics.liftHeightLocal,
              0.14 + pace * 0.2,
            )
          : null;

      if (hopSample) {
        bobY = hopSample.bodyHopLocalY * effectiveScale * move;
        tiltX =
          (0.04 + pace * 0.12 + (hopSample.inStance ? 0.08 * hopSample.crouch : -0.05)) * move;
        squashY = 1.0 + (hopSample.inStance ? -0.06 * hopSample.crouch : 0.035) * move;
      } else if (isBird) {
        bobY = isAirborne
          ? Math.sin(phase * 1.3 + seed) * 0.13
          : strideBounce * (0.022 + pace * 0.046) * effectiveScale * move;
        tiltX = isAirborne ? 0.2 : (0.03 + pace * 0.09) * move;
        if (!isAirborne) {
          // Characteristic gentle avian walking head-bob
          headPitch += (strideBounce - 0.5) * (0.09 + pace * 0.11) * move;
        }
        const flap = isAirborne
          ? Math.sin(phase * 2.4 + seed) * 0.78
          : Math.sin(phase * 1.1) * (0.06 + pace * 0.08) * move;
        leftArmZ = isAirborne ? flap : 0.65 + flap * 0.5;
        leftArmY = isAirborne ? Math.cos(phase * 2.4 + seed) * 0.14 : 0.28;
        rightArmZ = isAirborne ? -flap : -0.65 - flap * 0.5;
        rightArmY = isAirborne ? -Math.cos(phase * 2.4 + seed) * 0.14 : -0.28;
      } else if (c.def.locomotion === 'scurry') {
        bobY = strideBounce * (0.022 + pace * 0.052) * effectiveScale * move;
        tiltX = (0.04 + pace * 0.1 + runFactor * 0.1) * move;
        tiltZ += Math.sin(phase) * (0.042 + pace * 0.042) * move;
      } else if (isFish) {
        const swimAmp = 0.32 + 0.68 * move;
        bobY = Math.sin(phase * 1.2 + t * 0.8 + seed) * 0.042 * swimAmp;
        tiltZ += Math.sin(phase * 1.6 + seed) * 0.075 * swimAmp;
        tiltX = Math.sin(phase * 1.0 + seed) * 0.045 * swimAmp;
        leftArmY = 0.18 + Math.sin(phase * 2.1 + t * 1.2 + seed) * 0.34 * swimAmp;
        leftArmZ = Math.cos(phase * 2.1 + t * 1.2 + seed) * 0.14 * swimAmp;
        rightArmY = -0.18 - Math.sin(phase * 2.1 + t * 1.2 + seed) * 0.34 * swimAmp;
        rightArmZ = -Math.cos(phase * 2.1 + t * 1.2 + seed) * 0.14 * swimAmp;
      } else if (isSnake) {
        const slitherAmp = 0.18 + 0.82 * move;
        bobY = Math.sin(phase * 1.2) * 0.024 * slitherAmp;
        tiltZ += Math.sin(phase * 1.45) * (0.09 + pace * 0.06) * slitherAmp;
        tiltX = (0.04 + pace * 0.06) * slitherAmp;
      } else if (isSwimmingInWater) {
        bobY = Math.sin(t * 1.7 + seed) * 0.022 + Math.sin(phase * 1.25 + seed) * 0.022 * move;
        tiltX = 0.2 + 0.1 * move;
        tiltZ += Math.sin(phase * 1.25 + seed) * 0.06 * (0.3 + 0.7 * move);
      } else {
        // Natural stroll -> steady walk -> athletic run body mechanics
        bobY = strideBounce * (0.022 + pace * 0.058) * effectiveScale * move;
        tiltX = (0.015 + pace * 0.08 + runFactor * 0.12) * move;
        tiltZ += Math.sin(phase) * (0.03 + pace * 0.042) * move;
      }

      // Calm idle breathing when standing still on land
      if (!isAirborne && !isFish && !isSwimmingInWater) {
        squashY += Math.sin(t * 1.8 + seed) * 0.012 * (1 - move);
      }

      // Contralateral arm stride animation (grounded feet are solved right after posture damping below)
      if (!isBird && !isSnake && !isFish) {
        if (isSwimmingInWater) {
          const pL = phase;
          const pR = phase + Math.PI;
          leftFootX = 0.52 + Math.sin(pL * 1.25) * 0.42 * (0.35 + 0.65 * move);
          rightFootX = 0.52 + Math.sin(pR * 1.25) * 0.42 * (0.35 + 0.65 * move);
          leftFootY = rig.baseFootY + 0.03;
          rightFootY = rig.baseFootY + 0.03;
          leftArmX = -0.35 + Math.sin(pR * 1.25) * 0.32 * (0.3 + 0.7 * move);
          rightArmX = -0.35 + Math.sin(pL * 1.25) * 0.32 * (0.3 + 0.7 * move);
        } else if (hopSample) {
          const airborneArm = hopSample.inStance ? 0 : Math.min(1, hopSample.bodyHopLocalY / 0.16);
          leftArmX = (-0.2 - airborneArm * (0.32 + pace * 0.24)) * move;
          rightArmX = leftArmX;
        } else {
          const armSwing = (0.22 + pace * 0.56) * move;
          // Opposite arm swings forward with each step; running adds athletic forward arm pump
          leftArmX = Math.sin(phase) * armSwing - runFactor * 0.22 * move;
          rightArmX = Math.sin(phase + Math.PI) * armSwing - runFactor * 0.22 * move;
        }
      } else if (rig.leftFoot && rig.rightFoot && isAirborne) {
        // Tuck bird feet neatly rearward while flying
        leftFootX = 0.78;
        rightFootX = 0.78;
        leftFootY = rig.baseFootY + 0.04;
        rightFootY = rig.baseFootY + 0.04;
      }

      // Stage-specific handheld construction tools & pioneer emigration pack
      const showWarGear =
        c.warWeapon !== null &&
        (c.activity === 'marching' || c.activity === 'fighting') &&
        !c.isYoung();
      const warStats = showWarGear && c.warWeapon ? getWeaponStats(c.warWeapon) : null;
      rig.warGear.sword.visible = showWarGear && c.warWeapon === 'sword';
      rig.warGear.spear.visible = showWarGear && c.warWeapon === 'spear';
      rig.warGear.battleAxe.visible = showWarGear && c.warWeapon === 'battle_axe';
      rig.warGear.warClub.visible = showWarGear && c.warWeapon === 'war_club';
      rig.warGear.bow.visible = showWarGear && c.warWeapon === 'bow';
      if (rig.warGear.shield) {
        rig.warGear.shield.visible = Boolean(showWarGear && warStats?.hasShield);
      }
      if (rig.guardStaticGear.length > 0) {
        for (const item of rig.guardStaticGear) {
          item.visible = !showWarGear;
        }
      }

      const activeStage = c.isActivelyWorking ? c.activeConstructionStage : null;
      const showAxe = !showWarGear && activeStage === 'clearing';
      const showSpade = !showWarGear && activeStage === 'leveling';
      const showTrowel = !showWarGear && activeStage === 'foundation';
      const showHammer =
        !showWarGear &&
        (activeStage === 'framing' ||
          activeStage === 'finishing' ||
          activeStage === 'disassembling');
      const anyWorkTool = showAxe || showSpade || showTrowel || showHammer;

      rig.workTools.axe.visible = showAxe;
      rig.workTools.spade.visible = showSpade;
      rig.workTools.trowel.visible = showTrowel;
      rig.workTools.hammer.visible = showHammer;
      if (rig.idleBuilderMallet) {
        rig.idleBuilderMallet.visible = !showWarGear && !anyWorkTool && !c.isYoung();
      }
      rig.pioneerPack.visible = c.activity === 'emigrating';

      // Expressive activity overrides
      let bodyYaw = isFish ? Math.sin(phase * 1.9 + seed) * 0.095 * (0.35 + 0.65 * move) : 0;

      if (activeStage) {
        if (activeStage === 'clearing') {
          // Bold overhead woodcutter / land-clearing axe swing
          const chop = Math.sin(t * 6.5 + seed);
          tiltX = 0.15 + chop * 0.2;
          if (!isBird && !isSnake && rig.rightArm && rig.leftArm) {
            rightArmX = -1.36 + chop * 0.86;
            rightArmZ = -0.3 + chop * 0.2;
            leftArmX = -0.62 + chop * 0.42;
          } else if (isBird || isSnake) {
            headPitch = 0.2 + chop * 0.28;
            if (rig.leftArm && rig.rightArm) {
              leftArmZ = 0.48 + Math.sin(t * 7.8 + seed) * 0.26;
              rightArmZ = -0.48 - Math.sin(t * 7.8 + seed) * 0.26;
            }
          }
        } else if (activeStage === 'leveling') {
          // Two-handed spading & earth-leveling scoop
          const scoop = Math.sin(t * 5.2 + seed);
          tiltX = 0.26 + scoop * 0.17;
          bobY -= Math.max(0, scoop) * 0.06;
          if (!isBird && !isSnake && rig.rightArm && rig.leftArm) {
            rightArmX = -0.88 + scoop * 0.62;
            leftArmX = -0.78 + scoop * 0.56;
            rightArmZ = 0.14;
            leftArmZ = -0.14;
          } else if (isBird || isSnake) {
            headPitch = 0.34 + scoop * 0.2;
          }
        } else if (activeStage === 'foundation') {
          // Crouched stone-laying & mortar troweling
          const sweep = Math.sin(t * 5.8 + seed);
          squashY = 0.94 + Math.abs(sweep) * 0.025;
          tiltX = 0.3;
          headPitch = 0.26;
          if (!isBird && !isSnake && rig.rightArm && rig.leftArm) {
            rightArmX = -0.84 + Math.sin(t * 7.2 + seed) * 0.24;
            rightArmZ = -0.24 + sweep * 0.32;
            leftArmX = -0.6;
          } else if (isBird || isSnake) {
            headPitch = 0.32 + sweep * 0.18;
          }
        } else {
          // Framing, finishing, or disassembling: crisp double-tap hammering with bracing arm
          const rawHit = Math.sin(t * 7.6 + seed);
          const snap = Math.sign(rawHit) * Math.pow(Math.abs(rawHit), 0.72);
          tiltX = 0.14 + snap * 0.15;
          if (!isBird && !isSnake && rig.rightArm && rig.leftArm) {
            rightArmX = -1.2 + snap * 0.74;
            leftArmX = -0.74 + Math.sin(t * 4.2 + seed) * 0.14;
          } else if (isBird || isSnake) {
            headPitch = 0.16 + snap * 0.26;
            if (rig.leftArm && rig.rightArm) {
              leftArmZ = 0.42 + Math.sin(t * 8.4 + seed) * 0.3;
              rightArmZ = -0.42 - Math.sin(t * 8.4 + seed) * 0.3;
            }
          }
        }
        rig.workChipCooldown -= dt;
        if (rig.workChipCooldown <= 0) {
          rig.workChipCooldown = 0.28 + (seed % 0.14);
          this.spawnWorkChip(c, activeStage);
        }
      } else if (c.activity === 'building' || c.activity === 'gathering_timber') {
        if (move < 0.35) {
          const chop = Math.sin(t * 6.8 + seed);
          tiltX = 0.12 + chop * 0.15;
          if (!isBird && rig.rightArm) {
            rightArmX = -1.1 + chop * 0.68;
          }
        }
      } else if (c.activity === 'emigrating') {
        tiltX = 0.1 * move;
        bobY += (0.5 - 0.5 * Math.cos(phase * 2.2)) * 0.035 * move;
      } else if (c.activity === 'playing') {
        // Joyful bouncy hops and playful ear/head wiggles for frolicking litters of young!
        const hop = 0.5 - 0.5 * Math.cos((t * 4.4 + seed) * 2);
        bobY += hop * 0.12;
        squashY = 0.97 + hop * 0.05;
        headRoll = Math.sin(t * 3.8 + seed) * 0.18;
        headPitch = -0.06 + Math.sin(t * 3.1 + seed) * 0.1;
      } else if (c.activity === 'celebrating' && c.isDancingAtCelebration) {
        // Festive village dance: rhythmic bounce, joyful sway, waving paws/wings & music sparkles!
        const beat = 0.5 - 0.5 * Math.cos((t * 4.6 + seed) * 2);
        const sway = Math.sin(t * 2.6 + seed);
        bobY += beat * 0.14;
        squashY = 0.97 + beat * 0.05;
        tiltZ += sway * 0.14;
        headRoll = sway * 0.2;
        headPitch = -0.08 + beat * 0.11;
        if (!isBird && rig.leftArm && rig.rightArm) {
          leftArmX = -1.3 + Math.sin(t * 4.6 + seed) * 0.38;
          rightArmX = -1.3 - Math.sin(t * 4.6 + seed) * 0.38;
          leftArmZ = 0.4 + sway * 0.18;
          rightArmZ = -0.4 + sway * 0.18;
        } else if (isBird && rig.leftArm && rig.rightArm) {
          const flutter = Math.sin(t * 7.8 + seed) * 0.34;
          leftArmZ = 0.56 + flutter;
          rightArmZ = -0.56 - flutter;
        }
        rig.workChipCooldown -= dt;
        if (rig.workChipCooldown <= 0) {
          rig.workChipCooldown = 0.72 + (seed % 0.45);
          this.spawnFestivalConfetti(c);
        }
      } else if (c.activity === 'courting' || c.activity === 'nesting') {
        // Warm affectionate head tilt & gentle cozy sway
        headRoll = Math.sin(t * 2.1 + seed) * 0.18;
        headPitch = 0.1 + Math.sin(t * 2.4 + seed) * 0.06;
        if (c.activity === 'nesting') {
          bobY = -0.06;
          squashY = 0.96 + Math.sin(t * 2.2 + seed) * 0.018;
        }
      } else if (c.activity === 'marching') {
        // Determined war march: weapons held at ready, shield raised, crisp cadence
        const cadence = Math.sin(phase * 2.0);
        tiltX = 0.13 * move + 0.03;
        headPitch = -0.04;
        headRoll *= 0.35;
        if (!isBird && !isSnake && !isFish && rig.rightArm && rig.leftArm) {
          if (c.warWeapon === 'bow') {
            rightArmX = -0.58 + cadence * 0.08 * move;
            rightArmZ = -0.18;
            leftArmX = -0.45 - cadence * 0.1 * move;
          } else if (c.warWeapon === 'spear') {
            rightArmX = -0.78 + cadence * 0.09 * move;
            rightArmZ = -0.08;
            leftArmX = -0.62;
            leftArmZ = 0.2;
          } else {
            rightArmX = -1.02 + cadence * 0.12 * move;
            rightArmZ = -0.14;
            leftArmX = warStats?.hasShield ? -0.68 : -0.45 + cadence * 0.16 * move;
            leftArmZ = warStats?.hasShield ? 0.24 : 0.05;
          }
        }
      } else if (c.activity === 'fighting') {
        // Visceral weapon-driven combat choreography: wind-up, violent strike lunge, shield brace & footwork
        const strikeDur = Math.max(0.16, c.combatStrikeDuration || 0.34);
        const isStriking = c.combatStrikeTimer > 0;
        const strikeT = isStriking ? 1 - Math.max(0, Math.min(1, c.combatStrikeTimer / strikeDur)) : 0;
        const combatBounce = Math.sin(t * 7.8 + seed);

        if (c.warWeapon === 'bow') {
          // Archer stance: body angled sideways, drawing string back and loosing arrows
          bodyYaw = -0.46;
          tiltX = 0.08;
          headPitch = -0.04;
          if (!isBird && !isSnake && !isFish && rig.leftArm && rig.rightArm) {
            if (isStriking) {
              const draw = strikeT < 0.55 ? strikeT / 0.55 : Math.max(0, 1 - (strikeT - 0.55) / 0.45);
              rightArmX = -1.45;
              rightArmZ = -0.15;
              leftArmX = -1.35 + draw * 0.75;
              leftArmZ = 0.35 + draw * 0.22;
              tiltX = 0.05 - draw * 0.09;
            } else {
              rightArmX = -1.18 + combatBounce * 0.06;
              leftArmX = -0.92 + combatBounce * 0.08;
            }
          }
        } else if (isStriking) {
          // Three-phase melee strike: coil wind-up (0..0.3) -> explosive impact (0.3..0.68) -> follow-through (0.68..1)
          if (c.warWeapon === 'spear') {
            const thrust =
              strikeT < 0.28
                ? -strikeT / 0.28
                : strikeT < 0.65
                  ? THREE.MathUtils.lerp(-1, 1, (strikeT - 0.28) / 0.37)
                  : THREE.MathUtils.lerp(1, 0, (strikeT - 0.65) / 0.35);
            tiltX = 0.2 + thrust * 0.26;
            bodyYaw = thrust * 0.46;
            bobY += Math.max(0, thrust) * 0.04;
            if (!isBird && !isSnake && !isFish && rig.rightArm && rig.leftArm) {
              rightArmX = -1.1 + thrust * 0.55;
              rightArmZ = -0.06;
              leftArmX = -0.82;
              leftArmZ = 0.34;
            } else if (isBird || isSnake) {
              headPitch = 0.18 + thrust * 0.3;
            }
          } else if (c.warWeapon === 'battle_axe' || c.warWeapon === 'war_club') {
            const cleave =
              strikeT < 0.34
                ? -strikeT / 0.34
                : strikeT < 0.7
                  ? THREE.MathUtils.lerp(-1, 1, (strikeT - 0.34) / 0.36)
                  : THREE.MathUtils.lerp(1, 0, (strikeT - 0.7) / 0.3);
            tiltX = 0.16 + cleave * 0.34;
            bodyYaw = cleave * 0.56;
            squashY = cleave > 0.35 ? 0.92 : 1.02;
            if (!isBird && !isSnake && !isFish && rig.rightArm && rig.leftArm) {
              rightArmX = -1.05 + cleave * 1.38;
              rightArmZ = -0.26 + cleave * 0.38;
              leftArmX = -0.95 + cleave * 0.85;
              leftArmZ = 0.24 - cleave * 0.18;
            } else if (isBird || isSnake) {
              headPitch = 0.12 + cleave * 0.36;
            }
          } else {
            // Crisp sword slash or unarmed brawl lunge
            const slashDir = Math.floor(t * 2.2 + seed) % 2 === 0 ? 1 : -1;
            const swing =
              strikeT < 0.26
                ? -strikeT / 0.26
                : strikeT < 0.64
                  ? THREE.MathUtils.lerp(-1, 1, (strikeT - 0.26) / 0.38)
                  : THREE.MathUtils.lerp(1, 0, (strikeT - 0.64) / 0.36);
            tiltX = 0.22 + Math.max(0, swing) * 0.24;
            bodyYaw = swing * 0.54 * slashDir;
            if (!isBird && !isSnake && !isFish && rig.rightArm && rig.leftArm) {
              rightArmX = -1.08 + swing * 1.12;
              rightArmZ = (-0.28 + swing * 0.52) * slashDir;
              leftArmX = -0.86;
              leftArmZ = 0.36;
            } else if (isBird || isSnake) {
              headPitch = 0.16 + swing * 0.28;
            }
          }
        } else {
          // Active guard stance between strikes: crouched, weaving, shield braced, weapon poised
          tiltX = 0.2 + combatBounce * 0.06;
          bodyYaw = Math.sin(t * 3.8 + seed) * 0.22;
          bobY += Math.abs(combatBounce) * 0.03;
          if (!isBird && !isSnake && !isFish && rig.rightArm && rig.leftArm) {
            rightArmX = -1.16 + combatBounce * 0.16;
            rightArmZ = -0.22;
            leftArmX = warStats?.hasShield ? -0.92 : -0.78 - combatBounce * 0.14;
            leftArmZ = warStats?.hasShield ? 0.34 : 0.14;
          } else if (isBird && rig.leftArm && rig.rightArm) {
            leftArmZ = 0.68 + combatBounce * 0.22;
            rightArmZ = -0.68 - combatBounce * 0.22;
          }
        }
      } else if (c.activity === 'foraging') {
        headPitch = 0.22 + Math.sin(t * 3.6 + seed) * 0.12;
      } else if (c.activity === 'socialising') {
        headRoll = Math.sin(t * 2.4 + seed) * 0.16;
        headPitch = Math.sin(t * 3.0 + seed) * 0.08;
        if (!isBird && rig.leftArm) {
          leftArmX = -0.5 + Math.sin(t * 3.6 + seed) * 0.2;
        }
      } else if (c.activity === 'praying') {
        headPitch = 0.26 + Math.sin(t * 1.9 + seed) * 0.06;
        if (!isBird && rig.leftArm && rig.rightArm) {
          leftArmX = -0.72;
          rightArmX = -0.72;
        }
      } else if (c.activity === 'resting') {
        if (isFish) {
          bobY = -0.04 + Math.sin(t * 1.5 + seed) * 0.018;
          tiltX = 0.04;
          headPitch = 0.05;
        } else {
          bobY = -0.11;
          tiltX = 0.2;
          squashY = 0.94 + Math.sin(t * 1.9 + seed) * 0.018;
          headPitch = 0.25;
        }
      }

      // Visceral hit flinch / stagger recoil when struck by a weapon or arrow
      if (c.combatHitTimer > 0 && !isFish) {
        const hitFrac = Math.min(1, c.combatHitTimer / 0.28);
        const shudder = Math.sin(hitFrac * Math.PI * 3.5) * hitFrac;
        tiltX -= hitFrac * 0.44;
        tiltZ += shudder * 0.3;
        headPitch -= hitFrac * 0.36;
        squashY *= 1 - hitFrac * 0.09;
      }

      // Wounded & routed creatures bleed steadily onto the grass, leaving an unsettling trail
      const healthFrac = c.health / Math.max(1, c.maxHealth);
      const isBleeding =
        !isFish &&
        healthFrac < 0.72 &&
        (c.activity === 'fighting' || c.activity === 'fleeing' || c.combatHitTimer > 0);
      if (isBleeding) {
        rig.bleedCooldown -= safeDt;
        if (rig.bleedCooldown <= 0) {
          this.gore.spawnWoundDrip(
            rig.root.position.x,
            rig.root.position.y,
            rig.root.position.z,
            t,
            effectiveScale,
          );
          rig.bleedCooldown = THREE.MathUtils.lerp(0.24, 0.78, Math.max(0, healthFrac / 0.72));
        }
      }

      // Smoothly blend posture and limbs so activity transitions never pop in a single frame
      const bobLerp = hopSample ? 1 - Math.exp(-20 * safeDt) : poseLerp;
      rig.bobY += (bobY - rig.bobY) * bobLerp;
      rig.tiltX += (tiltX - rig.tiltX) * poseLerp;
      rig.tiltZ += (tiltZ - rig.tiltZ) * poseLerp;
      rig.headPitch += (headPitch - rig.headPitch) * poseLerp;
      rig.headRoll += (headRoll - rig.headRoll) * poseLerp;
      rig.squashY += (squashY - rig.squashY) * poseLerp;
      const yawLerp = c.activity === 'fighting' ? 1 - Math.exp(-22 * safeDt) : poseLerp;
      rig.bodyYaw += (bodyYaw - rig.bodyYaw) * yawLerp;

      const scaleY = effectiveScale * rig.squashY;
      const scaleXZ = effectiveScale / Math.sqrt(Math.max(0.5, rig.squashY));

      // Exact ground-locked inverse kinematics for grounded feet using the frame's final bodyGroup transform
      const isGroundedLegged = Boolean(
        rig.leftFoot && rig.rightFoot && !isAirborne && !isSwimmingInWater && c.activity !== 'resting',
      );
      if (isGroundedLegged) {
        // Full unattenuated stride at all walking/strolling/running speeds; ease feet neatly together only when stopping
        const settleT = THREE.MathUtils.clamp(move / 0.25, 0, 1);
        const strideWeight = settleT * settleT * (3 - 2 * settleT);
        const groundMetrics = computeStrideMetrics(c.def.locomotion, rig.gaitBlend, scaleXZ);
        // Keep joyful dance/play jumps able to lift feet off the floor while locking walking bob to the ground
        const isJumpingEmote =
          c.activity === 'playing' || (c.activity === 'celebrating' && c.isDancingAtCelebration);
        const compBobY =
          isJumpingEmote && !hopSample
            ? Math.min(rig.bobY, 0.075 * effectiveScale)
            : rig.bobY;

        if (hopSample) {
          const pose = solveGroundedFootTransform({
            zRel: hopSample.zRel * strideWeight,
            yLift: hopSample.yLift * strideWeight,
            pace: groundMetrics.pace,
            baseFootZ: rig.baseFootZ,
            bobY: compBobY,
            tiltX: rig.tiltX,
            scaleY,
            scaleXZ,
          });
          leftFootX = pose.rotX;
          rightFootX = pose.rotX;
          leftFootY = pose.hipY;
          rightFootY = pose.hipY;
          leftFootZ = pose.hipZ;
          rightFootZ = pose.hipZ;
        } else {
          const sampleL = sampleFootTrajectory(
            phase,
            groundMetrics.halfStrideLocal,
            groundMetrics.dutyFactor,
            groundMetrics.liftHeightLocal,
          );
          const sampleR = sampleFootTrajectory(
            phase + Math.PI,
            groundMetrics.halfStrideLocal,
            groundMetrics.dutyFactor,
            groundMetrics.liftHeightLocal,
          );
          const poseL = solveGroundedFootTransform({
            zRel: sampleL.zRel * strideWeight,
            yLift: sampleL.yLift * strideWeight,
            pace: groundMetrics.pace,
            baseFootZ: rig.baseFootZ,
            bobY: compBobY,
            tiltX: rig.tiltX,
            scaleY,
            scaleXZ,
          });
          const poseR = solveGroundedFootTransform({
            zRel: sampleR.zRel * strideWeight,
            yLift: sampleR.yLift * strideWeight,
            pace: groundMetrics.pace,
            baseFootZ: rig.baseFootZ,
            bobY: compBobY,
            tiltX: rig.tiltX,
            scaleY,
            scaleXZ,
          });
          leftFootX = poseL.rotX;
          rightFootX = poseR.rotX;
          leftFootY = poseL.hipY;
          rightFootY = poseR.hipY;
          leftFootZ = poseL.hipZ;
          rightFootZ = poseR.hipZ;
        }
      }

      if (rig.leftArm) {
        rig.leftArm.rotation.x += (leftArmX - rig.leftArm.rotation.x) * limbLerp;
        rig.leftArm.rotation.y += (leftArmY - rig.leftArm.rotation.y) * limbLerp;
        rig.leftArm.rotation.z += (leftArmZ - rig.leftArm.rotation.z) * limbLerp;
      }
      if (rig.rightArm) {
        rig.rightArm.rotation.x += (rightArmX - rig.rightArm.rotation.x) * limbLerp;
        rig.rightArm.rotation.y += (rightArmY - rig.rightArm.rotation.y) * limbLerp;
        rig.rightArm.rotation.z += (rightArmZ - rig.rightArm.rotation.z) * limbLerp;
      }
      if (rig.leftFoot && rig.rightFoot) {
        const targetGroundBlend = isGroundedLegged ? 1 : 0;
        rig.footGroundBlend += (targetGroundBlend - rig.footGroundBlend) * (1 - Math.exp(-14 * safeDt));
        if (isGroundedLegged && rig.footGroundBlend > 0.95) {
          // Apply exact ground-locked IK foot pose with zero lag or filter attenuation
          rig.leftFoot.rotation.x = leftFootX;
          rig.rightFoot.rotation.x = rightFootX;
          rig.leftFoot.position.y = leftFootY;
          rig.rightFoot.position.y = rightFootY;
          rig.leftFoot.position.z = leftFootZ;
          rig.rightFoot.position.z = rightFootZ;
        } else {
          const footLerp = isGroundedLegged ? Math.max(limbLerp, rig.footGroundBlend) : limbLerp;
          rig.leftFoot.rotation.x += (leftFootX - rig.leftFoot.rotation.x) * footLerp;
          rig.rightFoot.rotation.x += (rightFootX - rig.rightFoot.rotation.x) * footLerp;
          rig.leftFoot.position.y += (leftFootY - rig.leftFoot.position.y) * footLerp;
          rig.rightFoot.position.y += (rightFootY - rig.rightFoot.position.y) * footLerp;
          rig.leftFoot.position.z += (leftFootZ - rig.leftFoot.position.z) * footLerp;
          rig.rightFoot.position.z += (rightFootZ - rig.rightFoot.position.z) * footLerp;
        }
      }

      rig.bodyGroup.scale.set(scaleXZ, scaleY, scaleXZ);
      rig.bodyGroup.position.y = rig.bobY;
      rig.bodyGroup.rotation.z = rig.tiltZ;
      rig.bodyGroup.rotation.x = rig.tiltX;
      rig.bodyGroup.rotation.y = rig.bodyYaw;

      // Adorable youthful proportions: slightly larger head on newborn young & juveniles
      const headScale = c.lifeStage === 'young' ? 1.18 : c.lifeStage === 'juvenile' ? 1.08 : 1.0;
      rig.headGroup.scale.setScalar(headScale);
      rig.headGroup.rotation.x = rig.headPitch;
      rig.headGroup.rotation.z = rig.headRoll;

      // Playful lively ear twitches!
      if (rig.leftEar && rig.rightEar) {
        const twitch = Math.pow(Math.max(0, Math.sin(t * 2.0 + seed * 5.3)), 10) * 0.22;
        const bounce = c.def.locomotion === 'hop' ? Math.sin(phase) * 0.11 * move : 0;
        rig.leftEar.rotation.z = rig.baseLeftEarZ + twitch + bounce;
        rig.rightEar.rotation.z = rig.baseRightEarZ - twitch * 0.5 - bounce;
      }

      // Expressive wagging / bobbing / swimming tails
      if (rig.tail) {
        if (isFish) {
          const tailAmp = 0.35 + 0.65 * move;
          rig.tail.rotation.y = Math.sin(phase * 2.5 + t * 1.2 + seed) * 0.44 * tailAmp;
          rig.tail.rotation.x = Math.sin(phase * 1.4 + seed) * 0.05 * tailAmp;
        } else if (isSwimmingInWater) {
          const tailAmp = 0.3 + 0.7 * move;
          rig.tail.rotation.y = Math.sin(phase * 1.9 + t * 1.0 + seed) * 0.36 * tailAmp;
          rig.tail.rotation.x = rig.baseTailX + Math.sin(phase * 1.9 + seed) * 0.1 * tailAmp;
        } else if (isSnake) {
          rig.tail.rotation.y = Math.sin(phase * 1.7 + seed) * 0.38 * (0.2 + 0.8 * move);
          rig.tail.rotation.x = rig.baseTailX;
        } else if (c.species === 'cat') {
          rig.tail.rotation.y = Math.sin(t * 1.8 + phase * 0.5 + seed) * 0.32;
          rig.tail.rotation.x = rig.baseTailX + Math.sin(t * 1.3 + seed) * 0.06;
        } else {
          rig.tail.rotation.y = Math.sin(phase * 1.05 + t * 0.9 + seed) * (0.14 + 0.16 * move);
          rig.tail.rotation.x = rig.baseTailX + Math.sin(phase * 1.6 + seed) * 0.09 * move;
        }
      }

      if (rig.swimRipple) {
        rig.swimRipple.visible = isSwimmingInWater;
        if (isSwimmingInWater) {
          const pulse = (t * 0.85 + seed * 0.25) % 1;
          rig.swimRipple.scale.setScalar(0.84 + pulse * 0.42);
          rig.swimRipple.position.y = this.world.terrain.waterLevel - rig.root.position.y + 0.025;
        }
      }

      // Twinkling golden fairy-ring selection halo
      const isSelected = selection?.kind === 'creature' && selection.id === c.id;
      rig.selectionGroup.visible = isSelected;
      if (isSelected) {
        rig.selectionGroup.rotation.y += dt * 1.8;
        rig.selectionGroup.position.y = isFish
          ? this.world.terrain.waterLevel - rig.root.position.y + 0.06 + Math.sin(t * 4) * 0.025
          : 0.08 + Math.sin(t * 4) * 0.03;
      }
    }

    // Update ballistic construction chips and festival confetti
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      const pct = (t - sp.createdAt) / sp.duration;
      if (pct >= 1) {
        this.rootGroup.remove(sp.mesh);
        sp.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      sp.vy -= sp.gravity * dt;
      sp.mesh.position.x += sp.vx * dt;
      sp.mesh.position.y += sp.vy * dt;
      sp.mesh.position.z += sp.vz * dt;
      const pulse = Math.sin(Math.min(1, pct * 0.85 + 0.15) * Math.PI);
      sp.mesh.scale.setScalar(Math.max(0.01, pulse * sp.baseScale));
      const spin = sp.spinRate ?? 10;
      sp.mesh.rotation.y += dt * spin;
      sp.mesh.rotation.x += dt * (spin * 0.68);
      sp.mat.opacity = 1 - pct;
    }

    // Update parabolic flying war arrows
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const ar = this.arrows[i];
      const pct = (t - ar.createdAt) / ar.duration;
      if (pct >= 1) {
        this.rootGroup.remove(ar.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      const clamped = Math.max(0, Math.min(1, pct));
      const next = Math.min(1, clamped + 0.04);
      const px = THREE.MathUtils.lerp(ar.start.x, ar.end.x, clamped);
      const py = THREE.MathUtils.lerp(ar.start.y, ar.end.y, clamped) + Math.sin(clamped * Math.PI) * ar.arcHeight;
      const pz = THREE.MathUtils.lerp(ar.start.z, ar.end.z, clamped);
      const nx = THREE.MathUtils.lerp(ar.start.x, ar.end.x, next);
      const ny = THREE.MathUtils.lerp(ar.start.y, ar.end.y, next) + Math.sin(next * Math.PI) * ar.arcHeight;
      const nz = THREE.MathUtils.lerp(ar.start.z, ar.end.z, next);
      ar.mesh.position.set(px, py, pz);
      if (Math.hypot(nx - px, ny - py, nz - pz) > 1e-4) {
        ar.mesh.lookAt(nx, ny, nz);
      }
    }

    // Update blood sprays, bouncing 3D gibs, spreading/coagulating blood pools & carrion flies
    this.gore.update(safeDt, t);
  }

  private getSpeciesMaterials(c: Creature): SpeciesMaterialSet {
    return this.getSpeciesMaterialsById(c.species);
  }

  private getSpeciesMaterialsById(species: SpeciesId): SpeciesMaterialSet {
    const existing = this.speciesMats.get(species);
    if (existing) return existing;

    const def = SPECIES_CATALOG[species];
    const isFrog = species === 'frog';
    const isCrow = species === 'crow';
    const isMagpie = species === 'magpie';
    const isGlossyBird = isCrow || isMagpie;
    const isSnake = species === 'snake';
    const isTurtle = species === 'turtle';
    const isFish = species === 'fish';
    const isAquaticMammal = species === 'beaver' || species === 'otter';
    const isBird = def.silhouette === 'bird' || def.silhouette === 'owl';
    const furMap = isFrog || isSnake || isTurtle || isFish ? null : (this.textures?.furMap ?? null);
    const furNormal = isFrog || isSnake || isFish ? null : (this.textures?.furNormal ?? null);
    const furBump = isFrog || isGlossyBird || isFish ? null : (this.textures?.furBump ?? null);
    const fabricBump = this.textures?.fabricBump ?? null;
    const fabricNormal = this.textures?.fabricNormal ?? null;

    const furDetailPrimary: Partial<THREE.MeshPhysicalMaterialParameters> = furNormal
      ? { normalMap: furNormal, normalScale: new THREE.Vector2(isGlossyBird ? 0.4 : isTurtle ? 0.35 : 0.56, isGlossyBird ? 0.4 : isTurtle ? 0.35 : 0.56) }
      : { bumpMap: furBump, bumpScale: isSnake ? 0.028 : 0.035 };
    const furDetailSecondary: Partial<THREE.MeshPhysicalMaterialParameters> = furNormal
      ? { normalMap: furNormal, normalScale: new THREE.Vector2(0.44, 0.44) }
      : { bumpMap: furBump, bumpScale: 0.025 };
    const fabricDetail: Partial<THREE.MeshPhysicalMaterialParameters> = fabricNormal
      ? { normalMap: fabricNormal, normalScale: new THREE.Vector2(0.52, 0.52) }
      : { bumpMap: fabricBump, bumpScale: 0.045 };

    const primarySheen = new THREE.Color(def.primaryColor).lerp(
      new THREE.Color(isMagpie ? 0x2d7a78 : isCrow ? 0x45588a : 0xf7eee0),
      isGlossyBird ? 0.48 : 0.36,
    );
    const secondarySheen = new THREE.Color(def.secondaryColor).lerp(new THREE.Color(0xfff6e8), 0.34);

    const primary = new THREE.MeshPhysicalMaterial({
      color: def.primaryColor,
      map: isGlossyBird || isFish ? null : furMap,
      ...furDetailPrimary,
      roughness: isFish ? 0.18 : isFrog ? 0.28 : isSnake ? 0.36 : isGlossyBird ? 0.32 : isAquaticMammal ? 0.54 : isTurtle ? 0.66 : isBird ? 0.74 : 0.88,
      metalness: isFish ? 0.14 : isGlossyBird ? 0.15 : 0.0,
      clearcoat: isFish ? 0.92 : isFrog ? 0.68 : isSnake ? 0.52 : isAquaticMammal ? 0.34 : isTurtle ? 0.12 : 0.0,
      clearcoatRoughness: isFish ? 0.08 : isFrog ? 0.2 : isSnake ? 0.24 : isAquaticMammal ? 0.28 : isTurtle ? 0.45 : 0.0,
      iridescence: isFish ? 0.92 : isMagpie ? 0.72 : isCrow ? 0.58 : 0.0,
      iridescenceIOR: isFish ? 1.42 : 1.36,
      sheen: isFrog ? 0.0 : isFish ? 0.22 : isSnake ? 0.14 : isTurtle ? 0.18 : isGlossyBird ? 0.38 : isAquaticMammal ? 0.72 : isBird ? 0.65 : 0.85,
      sheenRoughness: isGlossyBird ? 0.4 : isBird ? 0.48 : 0.62,
      sheenColor: primarySheen,
    });
    const secondary = new THREE.MeshPhysicalMaterial({
      color: def.secondaryColor,
      map: furMap,
      ...furDetailSecondary,
      roughness: isFrog ? 0.34 : isSnake ? 0.42 : isTurtle ? 0.58 : isBird ? 0.74 : 0.86,
      metalness: 0.0,
      clearcoat: isFrog ? 0.45 : isSnake ? 0.35 : isTurtle ? 0.18 : 0.0,
      clearcoatRoughness: isFrog ? 0.26 : isSnake ? 0.3 : 0.0,
      sheen: isFrog ? 0.0 : isSnake ? 0.1 : isTurtle ? 0.14 : isBird ? 0.6 : 0.82,
      sheenRoughness: isBird ? 0.5 : 0.65,
      sheenColor: secondarySheen,
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: def.accentColor,
      roughness: isTurtle ? 0.42 : isMagpie ? 0.3 : 0.68,
      metalness: isMagpie ? 0.16 : 0.0,
      clearcoat: isTurtle ? 0.46 : isSnake ? 0.42 : 0.0,
      clearcoatRoughness: isTurtle ? 0.28 : 0.26,
      iridescence: isMagpie ? 0.82 : 0.0,
      iridescenceIOR: 1.38,
      sheen: isTurtle ? 0.12 : isBird ? 0.25 : 0.32,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(def.accentColor).lerp(new THREE.Color(isMagpie ? 0x45c4b0 : 0xe6dcc8), 0.28),
    });

    const cloakSheen = new THREE.Color(def.cloakColor).lerp(new THREE.Color(0xf4ead8), 0.32);
    const cloak = new THREE.MeshPhysicalMaterial({
      color: def.cloakColor,
      roughness: 0.9,
      sheen: 0.48,
      sheenRoughness: 0.78,
      sheenColor: cloakSheen,
      ...fabricDetail,
    });

    // Natural complementary woven scarf/trim harmonized with cloak
    const scarfCol = new THREE.Color(def.cloakColor).offsetHSL(0.06, -0.04, 0.09);
    const scarf = new THREE.MeshPhysicalMaterial({
      color: scarfCol,
      roughness: 0.88,
      sheen: 0.52,
      sheenRoughness: 0.76,
      sheenColor: scarfCol.clone().lerp(new THREE.Color(0xf7efe0), 0.32),
      ...fabricDetail,
    });

    this.trackDisposables(primary, secondary, accent, cloak, scarf);
    const set: SpeciesMaterialSet = { primary, secondary, accent, cloak, scarf };
    this.speciesMats.set(species, set);
    return set;
  }

  /**
   * Returns representative species, adaptation, and detail PBR materials covering every distinct
   * MeshPhysicalMaterial shader permutation (fur sheen, clearcoat amphibians/reptiles, iridescent
   * corvids/pigeons) so shaders compile once behind the splash screen rather than stalling mid-game.
   */
  getWarmupMaterials(): THREE.Material[] {
    const mats: THREE.Material[] = [
      this.eyeMat,
      this.eyelidRimMat,
      this.warmIrisMat,
      this.pinkInnerMat,
      this.noseBlackMat,
      this.leatherMat,
      this.brassMat,
      this.woodMat,
      this.crystalGlowMat,
      this.lanternGlowMat,
      this.pigeonIridescentMat,
      this.turtleShellRimMat,
      this.reedWeaveMat,
      this.strawWeaveMat,
      this.beaverToothMat,
      this.fishFinMat,
      this.lilyPadHatMat,
      this.lotusPinkMat,
      this.swimRippleMat,
      this.ironMat,
      this.crimsonMat,
      this.bowstringMat,
      ...this.gore.getWarmupMaterials(),
    ];
    const archetypes: SpeciesId[] = ['fox', 'owl', 'frog', 'crow', 'magpie', 'snake', 'turtle', 'beaver', 'otter', 'fish'];
    for (const sp of archetypes) {
      const set = this.getSpeciesMaterialsById(sp);
      mats.push(set.primary, set.secondary, set.accent, set.cloak);
    }
    const adapt = this.getAdaptationMaterials('forest_canopy');
    mats.push(adapt.mantle, adapt.accent);
    return mats;
  }

  private getAdaptationMaterials(
    adaptation: VillageAdaptationId,
  ): { readonly mantle: THREE.MeshStandardMaterial; readonly accent: THREE.MeshStandardMaterial } {
    const existing = this.adaptationMats.get(adaptation);
    if (existing) return existing;

    const palette = VILLAGE_ADAPTATION_CATALOG[adaptation].attirePalette;
    const fabricDetail: Partial<THREE.MeshPhysicalMaterialParameters> = this.textures?.fabricNormal
      ? { normalMap: this.textures.fabricNormal, normalScale: new THREE.Vector2(0.5, 0.5) }
      : { bumpMap: this.textures?.fabricBump ?? null, bumpScale: 0.05 };
    const mantle = new THREE.MeshPhysicalMaterial({
      color: palette.mantleColor,
      roughness: 0.89,
      sheen: 0.45,
      sheenRoughness: 0.78,
      sheenColor: new THREE.Color(palette.mantleColor).lerp(new THREE.Color(0xf4ead8), 0.3),
      ...fabricDetail,
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: palette.accentColor,
      roughness: 0.86,
      sheen: 0.52,
      sheenRoughness: 0.74,
      sheenColor: new THREE.Color(palette.accentColor).lerp(new THREE.Color(0xf4ead8), 0.32),
      ...fabricDetail,
    });
    this.trackDisposables(mantle, accent);
    const pair = { mantle, accent };
    this.adaptationMats.set(adaptation, pair);
    return pair;
  }

  private cachedGeo<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    const hit = this.primGeoCache.get(key);
    if (hit) return hit as T;
    const geo = create();
    this.primGeoCache.set(key, geo);
    this.trackDisposables(geo);
    return geo;
  }

  private sphereGeo(r: number, ws: number, hs: number): THREE.SphereGeometry {
    return this.cachedGeo(`S:${r}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  }

  private cylGeo(rt: number, rb: number, h: number, rs: number): THREE.CylinderGeometry {
    return this.cachedGeo(`Cy:${rt}:${rb}:${h}:${rs}`, () => new THREE.CylinderGeometry(rt, rb, h, rs));
  }

  private coneGeo(r: number, h: number, rs: number): THREE.ConeGeometry {
    return this.cachedGeo(`Co:${r}:${h}:${rs}`, () => new THREE.ConeGeometry(r, h, rs));
  }

  private boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.cachedGeo(`B:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
  }

  private torusGeo(r: number, t: number, rs: number, ts: number): THREE.TorusGeometry {
    return this.cachedGeo(`T:${r}:${t}:${rs}:${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
  }

  private capsuleGeo(r: number, l: number, cs: number, rs: number): THREE.CapsuleGeometry {
    return this.cachedGeo(`Ca:${r}:${l}:${cs}:${rs}`, () => new THREE.CapsuleGeometry(r, l, cs, rs));
  }

  private octaGeo(r: number, d: number): THREE.OctahedronGeometry {
    return this.cachedGeo(`O:${r}:${d}`, () => new THREE.OctahedronGeometry(r, d));
  }

  private disposeRig(rig: CreatureRig): void {
    const shared = this.sharedDisposableSet;
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry && !shared.has(obj.geometry)) {
        obj.geometry.dispose();
      }
    });
    this.rootGroup.remove(rig.root);
  }

  private syncCreatures(_selection: SelectionTarget): void {
    for (const c of this.world.creatures) {
      const existing = this.rigs.get(c.id);
      if (!c.alive) {
        if (existing) {
          this.disposeRig(existing);
          this.rigs.delete(c.id);
        }
        continue;
      }
      const currentAdaptation: VillageAdaptationId =
        this.world.getSettlement(c.settlementId)?.adaptation ?? 'forest_canopy';
      if (!existing) {
        const rig = this.buildRig(c);
        this.rigs.set(c.id, rig);
        this.rootGroup.add(rig.root);
      } else if (existing.adaptation !== currentAdaptation) {
        // Pioneer settled into a new biome — refresh attire to match the new village's adaptation!
        this.disposeRig(existing);
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
    root.rotation.y = c.heading;
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
    const isSnake = c.species === 'snake';
    const isTurtle = c.species === 'turtle';
    const isBeaver = c.species === 'beaver';
    const isOtter = c.species === 'otter';
    const isFish = c.species === 'fish';
    const isBear = c.species === 'bear';
    const isSlender = c.species === 'weasel' || isSnake || isOtter;
    const isStout =
      c.species === 'badger' ||
      c.species === 'hedgehog' ||
      c.species === 'owl' ||
      isBear ||
      isBeaver ||
      c.species === 'raccoon';
    const homeSettlement = this.world.getSettlement(c.settlementId);
    const adaptation: VillageAdaptationId = homeSettlement?.adaptation ?? 'forest_canopy';
    const adaptMats = this.getAdaptationMaterials(adaptation);

    // 1. Cozy pear-shaped woodland tunic + regional biome-adapted shoulder capelet + belt & buckle (skipped for swimming koi fish)
    let chestBib!: THREE.Mesh;
    if (!isFish) {
      const tunic = addPart(new THREE.Mesh(this.geo.tunic, mats.cloak));
      if (isBear) tunic.scale.set(1.22, 0.98, 1.18);
      else if (isStout) tunic.scale.set(1.16, 0.96, 1.12);
      else if (isSnake) {
        tunic.scale.set(0.68, 0.8, 0.72);
        tunic.position.y = 0.12;
      } else if (isSlender) tunic.scale.set(0.84, 1.06, 0.86);
      else if (isBird) tunic.scale.set(0.96, 0.94, 1.04);

      // Regional biome-adapted shoulder mantle
      const mantleMat = adaptMats.mantle;
      const mantle = addPart(new THREE.Mesh(this.geo.mantle, mantleMat));
      if (isBear) mantle.scale.set(1.22, 0.98, 1.18);
      else if (isStout) mantle.scale.set(1.16, 0.96, 1.12);
      else if (isSnake) {
        mantle.scale.set(0.76, 0.86, 0.78);
        mantle.position.y = 0.14;
      } else if (isSlender) mantle.scale.set(0.86, 1.04, 0.88);
      if (isFrog) mantle.scale.set(1.14, 0.85, 1.14);

      // Cozy leather belt & shiny brass clasp
      const belt = addPart(new THREE.Mesh(this.geo.belt, this.leatherMat));
      belt.position.y = isSnake ? 0.56 : 0.44;
      if (isBear) belt.scale.set(1.2, 1, 1.18);
      else if (isStout) belt.scale.set(1.15, 1, 1.12);
      else if (isSnake) belt.scale.set(0.68, 0.88, 0.7);
      else if (isSlender) belt.scale.set(0.84, 1, 0.86);
      const buckle = addPart(new THREE.Mesh(this.geo.buckle, this.brassMat));
      buckle.position.set(0, isSnake ? 0.56 : 0.44, isBear ? 0.34 : isStout ? 0.32 : isSnake ? 0.2 : isSlender ? 0.24 : 0.285);

      // Soft plush chest/belly bib showing above the tunic collar
      chestBib = addPart(
        new THREE.Mesh(this.sphereGeo(0.21, 14, 12), mats.secondary),
      );
      if (isSnake) {
        chestBib.scale.set(0.62, 0.92, 0.65);
        chestBib.position.set(0, 0.66, 0.08);
      } else if (isTurtle) {
        // Warm ochre turtle plastron front shield
        chestBib.scale.set(1.14, 1.24, 0.62);
        chestBib.position.set(0, 0.49, 0.19);
      } else {
        chestBib.scale.set(isSlender ? 0.82 : 0.95, 1.02, 0.85);
        chestBib.position.set(0, 0.57, isBird ? 0.14 : 0.11);
      }
    }

    // 2. Articulated Head Group (for cute tilts, bobs, and expressions)
    const headGroup = new THREE.Group();
    headGroup.position.set(
      0,
      isFish ? 0.0 : isSnake ? 0.98 : isTurtle ? 0.98 : 0.95,
      isFish ? 0.24 : isTurtle ? 0.12 : 0.04,
    );
    bodyGroup.add(headGroup);

    const headMesh = isFish
      ? new THREE.Object3D()
      : addPart(new THREE.Mesh(this.geo.head, mats.primary), headGroup);
    if (isFrog) {
      headMesh.scale.set(1.22, 0.82, 1.06);
    } else if (c.species === 'owl') {
      headMesh.scale.set(1.12, 1.02, 1.04);
    } else if (isBear) {
      headMesh.scale.set(1.16, 1.04, 1.08);
    } else if (c.species === 'wolf') {
      headMesh.scale.set(1.04, 0.96, 1.08);
    } else if (c.species === 'cat') {
      headMesh.scale.set(1.04, 0.94, 0.96);
    } else if (c.species === 'raccoon') {
      headMesh.scale.set(1.12, 0.94, 1.02);
    } else if (c.species === 'weasel') {
      headMesh.scale.set(0.9, 0.88, 1.12);
    } else if (isSnake) {
      headMesh.scale.set(0.94, 0.72, 1.24);
    } else if (isTurtle) {
      headMesh.scale.set(0.9, 0.86, 1.12);
    } else if (c.species === 'badger') {
      headMesh.scale.set(1.08, 0.98, 1.06);
    } else if (c.species === 'mouse' || c.species === 'squirrel') {
      headMesh.scale.set(1.04, 0.96, 0.98);
    }

    // Photographic wet clearcoated animal eyes recessed inside a subtle dark eyelid rim
    // (real sky & sun reflections come naturally from the PMREM environment map, no painted dots)
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

      const rim = addPart(new THREE.Mesh(this.geo.eyeRim, this.eyelidRimMat), eyeHolder);
      rim.scale.set(irisRingMat ? 1.32 : 1.08, irisRingMat ? 1.32 : 1.08, 0.9);
      rim.position.z = -0.006;

      const iris = addPart(
        new THREE.Mesh(this.geo.eye, irisRingMat ?? this.warmIrisMat),
        eyeHolder,
      );
      iris.scale.set(irisRingMat ? 1.38 : 1.06, irisRingMat ? 1.38 : 1.06, 0.86);
      iris.position.z = -0.008;

      const pupil = addPart(new THREE.Mesh(this.geo.eye, this.eyeMat), eyeHolder);
      pupil.scale.set(0.86, 0.86, 1.02);
      pupil.position.z = 0.006;

      headGroup.add(eyeHolder);
      return eyeHolder;
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

    // 3. Articulated Legs & Species-Appropriate Feet (coiled lower body for snakes; fins for fish)
    let leftFoot: THREE.Object3D | undefined;
    let rightFoot: THREE.Object3D | undefined;
    const baseFootY = 0.27;
    const baseFootZ = 0.01;
    if (isFish) {
      // Fish glide with pectoral & caudal fins
    } else if (isSnake) {
      addPart(new THREE.Mesh(this.geo.snakeCoil, mats.primary));
    } else {
      const isRabbit = c.species === 'rabbit';
      const footGeo = isBird
        ? this.geo.birdFoot
        : isFrog || isTurtle || isBeaver || isOtter
          ? this.geo.webbedFoot
          : isRabbit
            ? this.geo.rabbitFoot
            : this.geo.boot;
      const footMat =
        c.species === 'pigeon'
          ? this.nosePinkMat
          : isFrog || isTurtle
            ? mats.primary
            : c.species === 'rabbit' || c.species === 'cat' || c.species === 'mouse'
              ? mats.secondary
              : c.species === 'squirrel' || c.species === 'hedgehog' || c.species === 'rat'
                ? mats.primary
                : mats.accent;

      const footSpread = isBear ? 0.16 : isStout ? 0.145 : isBird ? 0.115 : 0.125;
      for (const side of [-1, 1] as const) {
        const fPivot = new THREE.Group();
        fPivot.name = side === -1 ? 'left_foot' : 'right_foot';
        fPivot.position.set(side * footSpread, baseFootY, baseFootZ);
        const footMesh = addPart(new THREE.Mesh(footGeo, footMat), fPivot);
        if (isBear) {
          footMesh.scale.set(1.18, 1.0, 1.16);
        } else if (isTurtle) {
          footMesh.scale.set(1.12, 0.96, 1.05);
        } else if (isFrog) {
          footMesh.scale.set(1.06, 1.0, 1.15);
        }
        bodyGroup.add(fPivot);
        if (side === -1) leftFoot = fPivot;
        else rightFoot = fPivot;
      }
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
      if (c.species === 'magpie') {
        const scapL = addPart(new THREE.Mesh(this.sphereGeo(0.115, 10, 8), mats.secondary), lPivot);
        scapL.scale.set(1.25, 0.48, 0.92);
        scapL.position.set(-0.13, 0.028, -0.01);
      } else if (c.species === 'pigeon') {
        for (const zOff of [-0.04, -0.1]) {
          const bar = addPart(new THREE.Mesh(this.capsuleGeo(0.018, 0.18, 4, 6), mats.accent), lPivot);
          bar.rotation.z = Math.PI / 2;
          bar.position.set(-0.22, 0.018, zOff);
        }
      }
      bodyGroup.add(lPivot);
      leftArm = lPivot;

      const rPivot = new THREE.Group();
      rPivot.position.set(0.24, 0.65, -0.02);
      addPart(new THREE.Mesh(this.geo.wingRight, mats.primary), rPivot);
      if (c.species === 'magpie') {
        const scapR = addPart(new THREE.Mesh(this.sphereGeo(0.115, 10, 8), mats.secondary), rPivot);
        scapR.scale.set(1.25, 0.48, 0.92);
        scapR.position.set(0.13, 0.028, -0.01);
      } else if (c.species === 'pigeon') {
        for (const zOff of [-0.04, -0.1]) {
          const bar = addPart(new THREE.Mesh(this.capsuleGeo(0.018, 0.18, 4, 6), mats.accent), rPivot);
          bar.rotation.z = Math.PI / 2;
          bar.position.set(0.22, 0.018, zOff);
        }
      }
      bodyGroup.add(rPivot);
      rightArm = rPivot;
    } else if (!isSnake && !isFish) {
      const armOffset = isBear ? 0.33 : isStout ? 0.3 : isSlender ? 0.22 : 0.26;
      const pawMat =
        c.species === 'badger' || isBear || c.species === 'raccoon'
          ? mats.accent
          : isTurtle || isFrog
            ? mats.primary
            : mats.secondary;
      for (const side of [-1, 1] as const) {
        const aPivot = new THREE.Group();
        aPivot.position.set(side * armOffset, 0.65, 0.02);
        addPart(new THREE.Mesh(this.geo.arm, mats.cloak), aPivot);
        const paw = addPart(new THREE.Mesh(this.geo.paw, pawMat), aPivot);
        paw.position.set(0, -0.23, 0.02);
        bodyGroup.add(aPivot);
        if (side === -1) leftArm = aPivot;
        else rightArm = aPivot;
      }
    }

    // 5. Species-Specific High-Resolution Whimsical Sculpting (ALL 21 species!)
    if (c.species === 'owl') {
      // Heart-shaped cream facial disc
      for (const sx of [-0.095, 0.095]) {
        const disc = addPart(new THREE.Mesh(this.sphereGeo(0.145, 14, 12), mats.secondary), headGroup);
        disc.scale.set(1.05, 1.12, 0.55);
        disc.position.set(sx, 0.01, 0.21);
      }
      // Huge wise golden amber eyes + catchlights
      buildCuteEye(-0.1, 0.03, 0.27, 1.18, this.owlIrisMat);
      buildCuteEye(0.1, 0.03, 0.27, 1.18, this.owlIrisMat);

      // Curved ivory scholar beak
      const beak = addPart(new THREE.Mesh(this.coneGeo(0.058, 0.14, 8), mats.accent), headGroup);
      beak.rotation.x = Math.PI * 0.62;
      beak.position.set(0, -0.03, 0.31);

      // Tiny whimsical round brass spectacles!
      for (const sx of [-0.1, 0.1]) {
        const frame = addPart(new THREE.Mesh(this.torusGeo(0.088, 0.01, 8, 18), this.brassMat), headGroup);
        frame.position.set(sx, 0.03, 0.31);
      }
      const bridge = addPart(new THREE.Mesh(this.boxGeo(0.05, 0.012, 0.012), this.brassMat), headGroup);
      bridge.position.set(0, 0.04, 0.31);

      // Feathered ear tufts (articulated!)
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.16, 0.2, 0.04);
        const tuft = addPart(new THREE.Mesh(this.coneGeo(0.062, 0.2, 8), mats.primary), ePivot);
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
    } else if (
      c.species === 'crow' ||
      c.species === 'sparrow' ||
      c.species === 'robin' ||
      c.species === 'pigeon' ||
      c.species === 'magpie'
    ) {
      const isCrow = c.species === 'crow';
      const isRobin = c.species === 'robin';
      const isPigeon = c.species === 'pigeon';
      const isMagpie = c.species === 'magpie';
      const isCorvid = isCrow || isMagpie;

      buildCuteEye(-0.125, 0.04, 0.22, isCorvid ? 0.96 : 1.06, isPigeon ? this.owlIrisMat : undefined);
      buildCuteEye(0.125, 0.04, 0.22, isCorvid ? 0.96 : 1.06, isPigeon ? this.owlIrisMat : undefined);

      // Sculpted beak (longer corvid beak for crow/magpie, delicate cere-topped beak for pigeon, perky songbird beak for sparrow/robin)
      const beakLen = isCorvid ? 0.24 : isPigeon ? 0.17 : 0.15;
      const beakUpper = addPart(
        new THREE.Mesh(this.coneGeo(isCorvid ? 0.066 : isPigeon ? 0.052 : 0.058, beakLen, 10), isCorvid || isPigeon ? this.noseBlackMat : mats.accent),
        headGroup,
      );
      beakUpper.rotation.x = Math.PI * 0.53;
      beakUpper.position.set(0, -0.01, 0.25 + beakLen * 0.35);

      // Cute feather crown tuft
      for (let i = 0; i < 2; i++) {
        const crest = addPart(new THREE.Mesh(this.coneGeo(0.032, 0.12, 7), mats.primary), headGroup);
        crest.position.set((i - 0.5) * 0.04, 0.26, 0.02 - i * 0.05);
        crest.rotation.x = -0.45 - i * 0.2;
      }

      // Species-signature plumage accents
      if (isRobin) {
        chestBib.scale.set(1.18, 1.12, 1.05);
        chestBib.position.set(0, 0.56, 0.16);
      } else if (isCrow) {
        const monocle = addPart(new THREE.Mesh(this.torusGeo(0.068, 0.01, 8, 16), this.brassMat), headGroup);
        monocle.position.set(0.125, 0.04, 0.265);
      } else if (isPigeon) {
        // Plump dove chest + shimmering iridescent emerald-violet neck ring + pale pigeon cere
        chestBib.scale.set(1.18, 1.06, 1.08);
        chestBib.position.set(0, 0.57, 0.16);
        const neckRing = addPart(
          new THREE.Mesh(this.torusGeo(0.17, 0.052, 10, 20), this.pigeonIridescentMat),
        );
        neckRing.rotation.x = Math.PI / 2;
        neckRing.position.set(0, 0.77, 0.04);
        const cere = addPart(new THREE.Mesh(this.sphereGeo(0.036, 8, 6), mats.secondary), headGroup);
        cere.scale.set(1.25, 0.75, 0.85);
        cere.position.set(0, 0.025, 0.27);
      } else if (isMagpie) {
        // Crisp snow-white magpie belly tuxedo contrast
        chestBib.scale.set(1.15, 1.18, 1.02);
        chestBib.position.set(0, 0.53, 0.15);
      }

      // Fanned tail feathers (extra-long graduated iridescent tail for magpie)
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.28, -0.25);
      if (isMagpie) {
        addPart(new THREE.Mesh(this.geo.magpieTail, mats.accent), tailGroup);
      } else {
        addPart(new THREE.Mesh(this.geo.birdTail, mats.primary), tailGroup);
        if (isPigeon) {
          // Dark rock-dove terminal tail bar
          const tailBand = addPart(new THREE.Mesh(this.boxGeo(0.24, 0.03, 0.07), mats.accent), tailGroup);
          tailBand.position.set(0, 0.0, -0.24);
        }
      }
      bodyGroup.add(tailGroup);
      tail = tailGroup;
      baseTailX = isMagpie ? 0.14 : 0.22;
    } else if (c.species === 'rabbit') {
      // Fluffy cream cheek puffs & snout
      for (const sx of [-0.11, 0.11]) {
        const cheek = addPart(new THREE.Mesh(this.sphereGeo(0.11, 12, 10), mats.secondary), headGroup);
        cheek.scale.set(1.05, 0.85, 0.9);
        cheek.position.set(sx, -0.06, 0.19);
      }
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(1.15, 0.85, 0.9);
      nose.position.set(0, -0.02, 0.29);

      buildCuteEye(-0.12, 0.05, 0.225, 1.06);
      buildCuteEye(0.12, 0.05, 0.225, 1.06);
      addWhiskers(-0.04, 0.25, 0.08);

      // Tall sculpted velvety ears with recessed pink inner-ear groove (one playfully bent!)
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.1, 0.22, -0.01);

        const outer = addPart(new THREE.Mesh(this.capsuleGeo(0.068, 0.34, 8, 12), mats.primary), ePivot);
        outer.scale.set(1.0, 1.0, 0.58);
        outer.position.y = 0.2;

        const inner = addPart(new THREE.Mesh(this.capsuleGeo(0.042, 0.26, 6, 10), this.pinkInnerMat), ePivot);
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
      const snout = addPart(new THREE.Mesh(this.coneGeo(0.125, 0.3, 14), mats.primary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.03, 0.3);
      const jaw = addPart(new THREE.Mesh(this.sphereGeo(0.115, 12, 10), mats.secondary), headGroup);
      jaw.scale.set(1.25, 0.65, 1.18);
      jaw.position.set(0, -0.09, 0.21);

      // Fluffy white fox cheek ruffs
      for (const sx of [-0.17, 0.17]) {
        const ruff = addPart(new THREE.Mesh(this.coneGeo(0.085, 0.17, 8), mats.secondary), headGroup);
        ruff.rotation.z = sx > 0 ? -1.25 : 1.25;
        ruff.position.set(sx, -0.06, 0.11);
      }

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.position.set(0, -0.02, 0.44);

      buildCuteEye(-0.12, 0.055, 0.225, 1.0);
      buildCuteEye(0.12, 0.055, 0.225, 1.0);
      addWhiskers(-0.04, 0.31, 0.08);

      // Tall black-tipped fox ears with cream inner fluff
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.15, 0.2, 0.0);

        const earBase = addPart(new THREE.Mesh(this.coneGeo(0.09, 0.25, 10), mats.primary), ePivot);
        earBase.scale.set(1.0, 1.0, 0.65);
        earBase.position.y = 0.11;

        const earTip = addPart(new THREE.Mesh(this.coneGeo(0.052, 0.11, 10), mats.accent), ePivot);
        earTip.scale.set(1.0, 1.0, 0.65);
        earTip.position.y = 0.19;

        const earInner = addPart(new THREE.Mesh(this.coneGeo(0.052, 0.16, 8), mats.secondary), ePivot);
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
      const blaze = addPart(new THREE.Mesh(this.capsuleGeo(0.068, 0.26, 8, 10), mats.secondary), headGroup);
      blaze.rotation.x = Math.PI * 0.38;
      blaze.position.set(0, 0.08, 0.18);

      for (const sx of [-0.145, 0.145]) {
        // Cream cheek stripe
        const cheekStripe = addPart(new THREE.Mesh(this.sphereGeo(0.115, 12, 10), mats.secondary), headGroup);
        cheekStripe.scale.set(0.95, 0.8, 1.12);
        cheekStripe.position.set(sx, -0.05, 0.15);

        // Bold charcoal eye-mask band
        const mask = addPart(new THREE.Mesh(this.capsuleGeo(0.055, 0.16, 6, 8), mats.accent), headGroup);
        mask.rotation.x = Math.PI * 0.42;
        mask.position.set(sx * 0.72, 0.06, 0.18);
      }

      const snout = addPart(new THREE.Mesh(this.cylGeo(0.078, 0.125, 0.22, 12), mats.secondary), headGroup);
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
        const rim = addPart(new THREE.Mesh(this.sphereGeo(0.082, 10, 8), mats.secondary), ePivot);
        rim.scale.set(1.0, 1.0, 0.55);
        const core = addPart(new THREE.Mesh(this.sphereGeo(0.065, 10, 8), mats.accent), ePivot);
        core.scale.set(1.0, 1.0, 0.65);
        core.position.set(0, -0.012, 0.01);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Stout cuddly badger tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.24, -0.32);
      const stub = addPart(new THREE.Mesh(this.capsuleGeo(0.085, 0.16, 6, 10), mats.primary), tailGroup);
      stub.rotation.x = -0.9;
      stub.position.set(0, 0.02, -0.08);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'squirrel') {
      // Extra-chubby adorable nut cheeks!
      for (const sx of [-0.12, 0.12]) {
        const cheek = addPart(new THREE.Mesh(this.sphereGeo(0.108, 12, 10), mats.secondary), headGroup);
        cheek.position.set(sx, -0.06, 0.18);
      }
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(0.95, 0.8, 0.9);
      nose.position.set(0, -0.015, 0.275);

      buildCuteEye(-0.12, 0.055, 0.22, 1.08);
      buildCuteEye(0.12, 0.055, 0.22, 1.08);
      addWhiskers(-0.04, 0.24, 0.08);

      // Cute tufted squirrel ears
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.15, 0.2, 0.01);
        const ear = addPart(new THREE.Mesh(this.sphereGeo(0.082, 12, 10), mats.primary), ePivot);
        ear.scale.set(0.85, 1.15, 0.55);
        ear.position.y = 0.04;
        const inner = addPart(new THREE.Mesh(this.sphereGeo(0.052, 8, 8), this.pinkInnerMat), ePivot);
        inner.scale.set(0.8, 1.0, 0.4);
        inner.position.set(0, 0.035, 0.028);
        const tuft = addPart(new THREE.Mesh(this.coneGeo(0.03, 0.09, 6), mats.accent), ePivot);
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
      const face = addPart(new THREE.Mesh(this.sphereGeo(0.22, 16, 14), mats.secondary), headGroup);
      face.scale.set(0.95, 0.92, 0.92);
      face.position.set(0, -0.02, 0.09);

      const snout = addPart(new THREE.Mesh(this.coneGeo(0.088, 0.2, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.04, 0.3);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(0.95, 0.85, 0.95);
      nose.position.set(0, -0.03, 0.4);

      buildCuteEye(-0.115, 0.04, 0.24, 1.04);
      buildCuteEye(0.115, 0.04, 0.24, 1.04);

      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.18, 0.14, 0.06);
        const ear = addPart(new THREE.Mesh(this.sphereGeo(0.062, 10, 8), mats.secondary), ePivot);
        ear.scale.set(1.0, 1.0, 0.5);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Lush sculpted dome of 34 tapered quills on back & crown!
      const quills = addPart(new THREE.Mesh(this.geo.hedgehogQuills, mats.accent));
      quills.position.set(0, 0.72, -0.14);

      // Whimsical tiny leaf tucked in the hedgehog's quills!
      const leaf = addPart(new THREE.Mesh(this.sphereGeo(0.07, 8, 6), this.leafMat));
      leaf.scale.set(1.3, 0.28, 0.85);
      leaf.rotation.set(0.4, 0.6, 0.3);
      leaf.position.set(0.18, 0.96, -0.34);
    } else if (c.species === 'frog') {
      // Wide cute cream frog chin & smiling cheek puffs
      const chin = addPart(new THREE.Mesh(this.sphereGeo(0.25, 16, 12), mats.secondary), headGroup);
      chin.scale.set(1.18, 0.56, 1.02);
      chin.position.set(0, -0.1, 0.06);

      // Iconic perched frog eye domes on top of the head!
      for (const side of [-1, 1] as const) {
        const dome = addPart(new THREE.Mesh(this.sphereGeo(0.115, 14, 12), mats.primary), headGroup);
        dome.position.set(side * 0.155, 0.17, 0.08);
        buildCuteEye(side * 0.165, 0.185, 0.155, 1.08, this.frogIrisMat);
      }
    } else if (c.species === 'bear') {
      // Broad honey-tan bear muzzle & friendly rounded jowls
      const muzzle = addPart(new THREE.Mesh(this.cylGeo(0.115, 0.145, 0.2, 14), mats.secondary), headGroup);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, -0.055, 0.27);
      const muzzleTip = addPart(new THREE.Mesh(this.sphereGeo(0.116, 12, 10), mats.secondary), headGroup);
      muzzleTip.scale.set(1.05, 0.86, 0.82);
      muzzleTip.position.set(0, -0.055, 0.35);

      // Big glossy dark bear nose
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.55, 1.1, 1.12);
      nose.position.set(0, -0.015, 0.42);

      buildCuteEye(-0.135, 0.06, 0.245, 0.95);
      buildCuteEye(0.135, 0.06, 0.245, 0.95);

      // Iconic high-set small rounded bear ears with warm inner cup
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.22, 0.21, -0.01);
        const outer = addPart(new THREE.Mesh(this.sphereGeo(0.095, 12, 10), mats.primary), ePivot);
        outer.scale.set(1.0, 1.0, 0.56);
        const inner = addPart(new THREE.Mesh(this.sphereGeo(0.06, 10, 8), mats.secondary), ePivot);
        inner.scale.set(1.0, 1.0, 0.42);
        inner.position.set(0, -0.005, 0.032);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Cozy stubby round bear tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.26, -0.36);
      addPart(new THREE.Mesh(this.geo.bunnyTail, mats.primary), tailGroup).scale.setScalar(0.75);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'wolf') {
      // Noble sculpted timber-wolf snout, charcoal nose bridge & frost-cream cheek ruffs
      const snout = addPart(new THREE.Mesh(this.cylGeo(0.082, 0.135, 0.3, 14), mats.primary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.035, 0.31);
      const bridge = addPart(new THREE.Mesh(this.capsuleGeo(0.042, 0.18, 6, 8), mats.accent), headGroup);
      bridge.rotation.x = Math.PI / 2;
      bridge.position.set(0, 0.025, 0.31);
      const jaw = addPart(new THREE.Mesh(this.sphereGeo(0.118, 12, 10), mats.secondary), headGroup);
      jaw.scale.set(1.18, 0.64, 1.32);
      jaw.position.set(0, -0.095, 0.25);

      for (const sx of [-0.185, 0.185]) {
        const ruff = addPart(new THREE.Mesh(this.coneGeo(0.095, 0.19, 8), mats.secondary), headGroup);
        ruff.rotation.z = sx > 0 ? -1.32 : 1.32;
        ruff.position.set(sx, -0.055, 0.1);
      }

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.3, 1.0, 1.05);
      nose.position.set(0, -0.02, 0.46);

      // Piercing golden-amber wolf eyes
      buildCuteEye(-0.125, 0.06, 0.24, 1.02, this.owlIrisMat);
      buildCuteEye(0.125, 0.06, 0.24, 1.02, this.owlIrisMat);

      // Tall upright wolf ears with dark tips and frost-cream inner fluff
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.155, 0.21, -0.01);
        const earBase = addPart(new THREE.Mesh(this.coneGeo(0.088, 0.24, 10), mats.primary), ePivot);
        earBase.scale.set(1.0, 1.0, 0.64);
        earBase.position.y = 0.11;
        const earTip = addPart(new THREE.Mesh(this.coneGeo(0.048, 0.1, 10), mats.accent), ePivot);
        earTip.scale.set(1.0, 1.0, 0.64);
        earTip.position.y = 0.19;
        const earInner = addPart(new THREE.Mesh(this.coneGeo(0.052, 0.15, 8), mats.secondary), ePivot);
        earInner.scale.set(1.0, 1.0, 0.42);
        earInner.position.set(0, 0.09, 0.034);
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.18;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.18;
        }
      }

      // Thick downward-sweeping wolf tail with dark tip
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.28, -0.27);
      addPart(new THREE.Mesh(this.geo.wolfTailMain, mats.primary), tailGroup);
      addPart(new THREE.Mesh(this.geo.wolfTailTip, mats.accent), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'cat') {
      // Soft cream feline whisker pads & dainty triangular pink nose
      for (const sx of [-0.078, 0.078]) {
        const pad = addPart(new THREE.Mesh(this.sphereGeo(0.086, 12, 10), mats.secondary), headGroup);
        pad.scale.set(1.08, 0.85, 0.95);
        pad.position.set(sx, -0.055, 0.22);
      }
      const chin = addPart(new THREE.Mesh(this.sphereGeo(0.072, 10, 8), mats.secondary), headGroup);
      chin.scale.set(1.1, 0.72, 0.9);
      chin.position.set(0, -0.1, 0.21);

      // Three subtle chestnut forehead tabby stripes
      for (const sx of [-0.058, 0, 0.058]) {
        const stripe = addPart(new THREE.Mesh(this.capsuleGeo(0.014, 0.09, 4, 6), mats.accent), headGroup);
        stripe.rotation.x = Math.PI * 0.34;
        stripe.position.set(sx, 0.155, 0.18 - Math.abs(sx) * 0.25);
      }

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(0.95, 0.78, 0.88);
      nose.position.set(0, -0.025, 0.295);

      // Luminous emerald-green feline eyes + delicate whiskers
      buildCuteEye(-0.118, 0.05, 0.23, 1.08, this.catIrisMat);
      buildCuteEye(0.118, 0.05, 0.23, 1.08, this.catIrisMat);
      addWhiskers(-0.045, 0.27, 0.085);

      // Tall alert triangular feline ears with soft pink inner ear
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.155, 0.19, 0.01);
        const outer = addPart(new THREE.Mesh(this.coneGeo(0.088, 0.21, 10), mats.primary), ePivot);
        outer.scale.set(1.0, 1.0, 0.56);
        outer.position.y = 0.095;
        const inner = addPart(new THREE.Mesh(this.coneGeo(0.056, 0.15, 8), this.pinkInnerMat), ePivot);
        inner.scale.set(1.0, 1.0, 0.38);
        inner.position.set(0, 0.082, 0.032);
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.26;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.26;
        }
      }

      // Graceful upright S-curved cat tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.27, -0.25);
      addPart(new THREE.Mesh(this.geo.catTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'raccoon') {
      // Pointed pale muzzle + iconic charcoal bandit mask + crisp cream brow/cheek trim
      const snout = addPart(new THREE.Mesh(this.coneGeo(0.11, 0.24, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.045, 0.28);
      const noseBridge = addPart(new THREE.Mesh(this.capsuleGeo(0.026, 0.14, 5, 8), mats.accent), headGroup);
      noseBridge.rotation.x = Math.PI * 0.44;
      noseBridge.position.set(0, 0.035, 0.26);

      for (const sx of [-0.125, 0.125]) {
        // Bold dark bandit eye patch
        const mask = addPart(new THREE.Mesh(this.sphereGeo(0.105, 12, 10), mats.accent), headGroup);
        mask.scale.set(1.18, 0.78, 0.72);
        mask.position.set(sx, 0.045, 0.21);
        // Crisp cream cheek & brow border
        const cheek = addPart(new THREE.Mesh(this.sphereGeo(0.115, 12, 10), mats.secondary), headGroup);
        cheek.scale.set(1.05, 0.75, 0.92);
        cheek.position.set(sx * 1.12, -0.065, 0.16);
        const brow = addPart(new THREE.Mesh(this.capsuleGeo(0.022, 0.09, 4, 6), mats.secondary), headGroup);
        brow.rotation.z = sx > 0 ? -1.35 : 1.35;
        brow.position.set(sx * 0.85, 0.125, 0.21);
      }

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.05, 0.88, 0.95);
      nose.position.set(0, -0.03, 0.4);

      buildCuteEye(-0.12, 0.05, 0.255, 1.02);
      buildCuteEye(0.12, 0.05, 0.255, 1.02);
      addWhiskers(-0.045, 0.29, 0.08);

      // Rounded white-rimmed raccoon ears
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.185, 0.19, 0.01);
        const rim = addPart(new THREE.Mesh(this.sphereGeo(0.084, 10, 8), mats.secondary), ePivot);
        rim.scale.set(0.95, 1.05, 0.52);
        const core = addPart(new THREE.Mesh(this.sphereGeo(0.065, 10, 8), mats.accent), ePivot);
        core.scale.set(0.92, 1.0, 0.6);
        core.position.set(0, -0.01, 0.012);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Unmistakable plush alternating ringed raccoon tail!
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.26, -0.29);
      addPart(new THREE.Mesh(this.geo.raccoonTail, mats.primary), tailGroup);
      addPart(new THREE.Mesh(this.geo.raccoonTailRings, mats.accent), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'weasel') {
      // Sleek agile mustelid muzzle, ivory chin & throat, fine whiskers
      const snout = addPart(new THREE.Mesh(this.coneGeo(0.095, 0.22, 12), mats.primary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.025, 0.29);
      const chin = addPart(new THREE.Mesh(this.sphereGeo(0.1, 12, 10), mats.secondary), headGroup);
      chin.scale.set(1.05, 0.68, 1.25);
      chin.position.set(0, -0.085, 0.21);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(0.92, 0.82, 0.92);
      nose.position.set(0, -0.02, 0.4);

      buildCuteEye(-0.11, 0.05, 0.24, 1.05);
      buildCuteEye(0.11, 0.05, 0.24, 1.05);
      addWhiskers(-0.04, 0.29, 0.072);

      // Small rounded low-set weasel ears with ivory rim
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.16, 0.16, 0.01);
        const outer = addPart(new THREE.Mesh(this.sphereGeo(0.068, 10, 8), mats.primary), ePivot);
        outer.scale.set(0.95, 0.95, 0.48);
        const inner = addPart(new THREE.Mesh(this.sphereGeo(0.044, 8, 8), mats.secondary), ePivot);
        inner.scale.set(0.9, 0.9, 0.38);
        inner.position.set(0, -0.004, 0.02);
        headGroup.add(ePivot);
        if (side === -1) leftEar = ePivot;
        else rightEar = ePivot;
      }

      // Lithe sleek weasel tail with dark espresso tip
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.25, -0.23);
      addPart(new THREE.Mesh(this.geo.weaselTail, mats.primary), tailGroup);
      addPart(new THREE.Mesh(this.geo.weaselTailTip, mats.accent), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'snake') {
      // Diamond-contoured tapered reptilian snout, subtle dorsal diamond markings, amber eyes & forked crimson tongue
      const snout = addPart(new THREE.Mesh(this.coneGeo(0.145, 0.26, 12), mats.primary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.scale.set(1.08, 1.0, 0.66);
      snout.position.set(0, -0.02, 0.31);

      const lowerJaw = addPart(new THREE.Mesh(this.sphereGeo(0.15, 12, 10), mats.secondary), headGroup);
      lowerJaw.scale.set(1.02, 0.42, 1.38);
      lowerJaw.position.set(0, -0.085, 0.16);

      // Subtle dark dorsal scale diamonds along the crown
      for (const zOff of [-0.08, 0.06, 0.19]) {
        const diamond = addPart(new THREE.Mesh(this.octaGeo(0.044, 0), mats.accent), headGroup);
        diamond.scale.set(0.95, 0.25, 1.25);
        diamond.position.set(0, 0.185 - Math.abs(zOff) * 0.12, zOff);
      }

      // Amber reptilian eyes set beneath subtle brow ridges
      buildCuteEye(-0.125, 0.04, 0.23, 0.98, this.snakeIrisMat);
      buildCuteEye(0.125, 0.04, 0.23, 0.98, this.snakeIrisMat);

      // Delicate forked crimson tongue peeking from the snout tip
      const tongueStem = addPart(new THREE.Mesh(this.cylGeo(0.008, 0.01, 0.12, 6), this.tongueMat), headGroup);
      tongueStem.rotation.x = Math.PI / 2 + 0.12;
      tongueStem.position.set(0, -0.055, 0.44);
      for (const side of [-1, 1] as const) {
        const fork = addPart(new THREE.Mesh(this.cylGeo(0.005, 0.007, 0.07, 5), this.tongueMat), headGroup);
        fork.rotation.x = Math.PI / 2 + 0.18;
        fork.rotation.y = side * 0.42;
        fork.position.set(side * 0.018, -0.066, 0.52);
      }

      // Sweeping articulated serpentine tail undulating behind the coiled base
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0.02, 0.02, -0.2);
      addPart(new THREE.Mesh(this.geo.snakeTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (c.species === 'turtle') {
      // Sculpted domed hexagonal-scute carapace backpack + warm flared rim!
      const shellDome = addPart(new THREE.Mesh(this.geo.turtleShell, mats.accent));
      shellDome.position.set(0, 0.54, -0.14);
      const shellRim = addPart(new THREE.Mesh(this.geo.turtleShellRim, this.turtleShellRimMat));
      shellRim.position.set(0, 0.54, -0.14);

      // Gentle extending turtle neck + calm rounded reptilian muzzle
      const neck = addPart(new THREE.Mesh(this.cylGeo(0.115, 0.135, 0.22, 12), mats.primary));
      neck.rotation.x = 0.22;
      neck.position.set(0, 0.81, 0.08);

      const snout = addPart(new THREE.Mesh(this.sphereGeo(0.155, 14, 12), mats.primary), headGroup);
      snout.scale.set(0.95, 0.78, 1.15);
      snout.position.set(0, -0.025, 0.2);
      const jaw = addPart(new THREE.Mesh(this.sphereGeo(0.135, 12, 10), mats.secondary), headGroup);
      jaw.scale.set(0.96, 0.52, 1.08);
      jaw.position.set(0, -0.095, 0.18);

      buildCuteEye(-0.12, 0.045, 0.23, 1.02);
      buildCuteEye(0.12, 0.045, 0.23, 1.02);

      // Tiny stubby turtle tail peeking beneath the carapace rim
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.18, -0.3);
      const stub = addPart(new THREE.Mesh(this.coneGeo(0.045, 0.16, 8), mats.primary), tailGroup);
      stub.rotation.x = -Math.PI * 0.58;
      stub.position.set(0, 0, -0.06);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
    } else if (isBeaver) {
      // Plump woodland beaver — rosy rounded cheeks, iconic ivory buck teeth, small ears & broad paddle tail!
      headMesh.scale.set(1.14, 0.96, 1.06);
      for (const sx of [-0.115, 0.115]) {
        const cheek = addPart(new THREE.Mesh(this.sphereGeo(0.115, 12, 10), mats.secondary), headGroup);
        cheek.scale.set(1.08, 0.88, 0.94);
        cheek.position.set(sx, -0.06, 0.19);
      }
      const snout = addPart(new THREE.Mesh(this.sphereGeo(0.11, 12, 10), mats.secondary), headGroup);
      snout.scale.set(1.08, 0.78, 1.02);
      snout.position.set(0, -0.045, 0.24);
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.35, 0.95, 0.92);
      nose.position.set(0, -0.005, 0.32);

      // Two prominent glossy ivory beaver incisors!
      for (const sx of [-0.028, 0.028]) {
        const tooth = addPart(new THREE.Mesh(this.boxGeo(0.044, 0.088, 0.028), this.beaverToothMat), headGroup);
        tooth.position.set(sx, -0.105, 0.305);
      }

      buildCuteEye(-0.12, 0.055, 0.23, 1.02);
      buildCuteEye(0.12, 0.055, 0.23, 1.02);
      addWhiskers(-0.04, 0.27, 0.09);

      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.19, 0.18, -0.02);
        const ear = addPart(new THREE.Mesh(this.sphereGeo(0.068, 10, 8), mats.primary), ePivot);
        ear.scale.set(0.92, 0.95, 0.56);
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.22;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.22;
        }
      }

      // Broad flat leathery paddle tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.2, -0.27);
      addPart(new THREE.Mesh(this.geo.beaverTail, mats.accent), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
      baseTailX = 0.16;
    } else if (isOtter) {
      // Playful sleek river otter — cream throat & muzzle, wide whiskers, tiny rounded ears & streamlined rudder tail!
      headMesh.scale.set(1.04, 0.9, 1.12);
      const muzzle = addPart(new THREE.Mesh(this.sphereGeo(0.135, 12, 10), mats.secondary), headGroup);
      muzzle.scale.set(1.16, 0.78, 0.96);
      muzzle.position.set(0, -0.055, 0.22);
      const nose = addPart(new THREE.Mesh(this.geo.nose, this.noseBlackMat), headGroup);
      nose.scale.set(1.38, 0.9, 0.95);
      nose.position.set(0, -0.015, 0.315);

      buildCuteEye(-0.115, 0.055, 0.23, 1.08);
      buildCuteEye(0.115, 0.055, 0.23, 1.08);
      addWhiskers(-0.045, 0.27, 0.105);

      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.195, 0.15, -0.01);
        const ear = addPart(new THREE.Mesh(this.sphereGeo(0.056, 10, 8), mats.primary), ePivot);
        ear.scale.set(0.88, 0.92, 0.52);
        headGroup.add(ePivot);
        if (side === -1) {
          leftEar = ePivot;
          baseLeftEarZ = 0.26;
        } else {
          rightEar = ePivot;
          baseRightEarZ = -0.26;
        }
      }

      // Strong tapered rudder tail
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.22, -0.25);
      addPart(new THREE.Mesh(this.geo.otterTail, mats.primary), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;
      baseTailX = 0.08;
    } else if (isFish) {
      // Shimmering River Koi — centered at local y=0 so world c.y submerges the body cleanly inside the water!
      const koiBody = addPart(new THREE.Mesh(this.geo.fishBody, mats.primary));
      koiBody.position.set(0, 0.0, 0);

      // Calico white & ruby koi markings hugging the dorsal back
      const patchA = addPart(new THREE.Mesh(this.sphereGeo(0.145, 12, 10), mats.secondary));
      patchA.scale.set(0.95, 0.72, 1.25);
      patchA.position.set(0, 0.07, 0.12);
      const patchB = addPart(new THREE.Mesh(this.sphereGeo(0.11, 10, 8), mats.accent));
      patchB.scale.set(0.88, 0.65, 1.15);
      patchB.position.set(0.02, 0.06, -0.1);

      // Flowing translucent dorsal crest
      const dorsal = addPart(new THREE.Mesh(this.geo.fishDorsalFin, this.fishFinMat));
      dorsal.position.set(0, 0.18, 0.02);

      // Articulated side pectoral fins (stored as leftArm/rightArm for sculling swim motion)
      const lFinPivot = new THREE.Group();
      lFinPivot.position.set(-0.15, -0.05, 0.1);
      addPart(new THREE.Mesh(this.geo.fishPectoralFinL, this.fishFinMat), lFinPivot);
      bodyGroup.add(lFinPivot);
      leftArm = lFinPivot;

      const rFinPivot = new THREE.Group();
      rFinPivot.position.set(0.15, -0.05, 0.1);
      addPart(new THREE.Mesh(this.geo.fishPectoralFinR, this.fishFinMat), rFinPivot);
      bodyGroup.add(rFinPivot);
      rightArm = rFinPivot;

      // Articulated forked flowing koi tail fin
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.0, -0.34);
      addPart(new THREE.Mesh(this.geo.fishTailFin, this.fishFinMat), tailGroup);
      bodyGroup.add(tailGroup);
      tail = tailGroup;

      // Expressive clearcoated eyes + dainty koi mouth & golden barbels on headGroup
      buildCuteEye(-0.125, 0.04, 0.06, 1.02, this.owlIrisMat);
      buildCuteEye(0.125, 0.04, 0.06, 1.02, this.owlIrisMat);
      const lips = addPart(new THREE.Mesh(this.sphereGeo(0.046, 8, 6), this.nosePinkMat), headGroup);
      lips.scale.set(1.2, 0.68, 0.72);
      lips.position.set(0, -0.03, 0.21);
      for (const side of [-1, 1] as const) {
        const barbel = addPart(new THREE.Mesh(this.cylGeo(0.008, 0.004, 0.14, 6), this.brassMat), headGroup);
        barbel.rotation.z = side * 0.78;
        barbel.rotation.x = 0.35;
        barbel.position.set(side * 0.08, -0.055, 0.17);
      }
    } else {
      // Mouse & Rat — charming oversized cupped pink-lined saucer ears, cute tapered snout, whiskers & curled tail!
      const isMouse = c.species === 'mouse';
      const snoutLen = isMouse ? 0.2 : 0.28;
      const snout = addPart(new THREE.Mesh(this.coneGeo(0.095, snoutLen, 12), mats.secondary), headGroup);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.035, 0.24 + snoutLen * 0.3);

      const nose = addPart(new THREE.Mesh(this.geo.nose, this.nosePinkMat), headGroup);
      nose.scale.set(0.9, 0.85, 0.9);
      nose.position.set(0, -0.03, 0.25 + snoutLen * 0.78);

      buildCuteEye(-0.115, 0.05, 0.22, isMouse ? 1.12 : 1.0);
      buildCuteEye(0.115, 0.05, 0.22, isMouse ? 1.12 : 1.0);
      addWhiskers(-0.04, 0.28, 0.075);

      const earRadius = isMouse ? 0.145 : 0.125;
      for (const side of [-1, 1] as const) {
        const ePivot = new THREE.Group();
        ePivot.position.set(side * 0.18, 0.18, 0.0);

        const outer = addPart(new THREE.Mesh(this.sphereGeo(earRadius, 14, 12), mats.primary), ePivot);
        outer.scale.set(1.0, 1.05, 0.36);

        const inner = addPart(
          new THREE.Mesh(this.sphereGeo(earRadius * 0.74, 12, 10), this.pinkInnerMat),
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
    const guardStaticGear: THREE.Object3D[] = [];
    if (isFish) {
      if (c.role === 'mystic') {
        const pearl = addPart(new THREE.Mesh(this.octaGeo(0.075, 1), this.crystalGlowMat), headGroup);
        pearl.position.set(0, 0.24, -0.02);
      } else if (c.role === 'guard') {
        const crest = addPart(new THREE.Mesh(this.torusGeo(0.11, 0.018, 6, 14), this.brassMat), headGroup);
        crest.rotation.x = Math.PI / 2;
        crest.position.set(0, 0.15, -0.02);
      } else if (c.role === 'artisan' || c.role === 'merchant') {
        const lantern = addPart(new THREE.Mesh(this.sphereGeo(0.052, 8, 6), this.lanternGlowMat), headGroup);
        lantern.position.set(0, 0.2, 0.04);
      }
    } else if (c.role === 'mystic') {
      // Crooked star-trimmed wizard hat + golden band
      const hat = addPart(new THREE.Mesh(this.geo.wizardHat, mats.cloak), headGroup);
      hat.position.set(0, 0.2, 0.0);
      const hatBand = addPart(new THREE.Mesh(this.torusGeo(0.18, 0.022, 8, 18), this.brassMat), headGroup);
      hatBand.rotation.x = Math.PI / 2;
      hatBand.position.set(0, 0.24, 0.0);

      // Gnarled crystal-topped mystic staff
      if (!isBird && !isSnake && rightArm) {
        const staff = addPart(new THREE.Mesh(this.cylGeo(0.022, 0.028, 1.05, 8), this.woodMat), rightArm);
        staff.position.set(0.04, 0.05, 0.14);
        staff.rotation.x = 0.18;
        const orb = addPart(new THREE.Mesh(this.octaGeo(0.085, 1), this.crystalGlowMat), rightArm);
        orb.position.set(0.04, 0.62, 0.24);
      }
    } else if (c.role === 'merchant') {
      // Traveler's leather backpack + cozy rolled bedroll + tiny glowing brass lantern!
      const backZ = isTurtle ? -0.45 : isBear ? -0.34 : -0.29;
      const pack = addPart(new THREE.Mesh(this.boxGeo(0.32, 0.36, 0.22), this.leatherMat));
      pack.position.set(0, isTurtle ? 0.62 : 0.56, backZ);
      const roll = addPart(new THREE.Mesh(this.cylGeo(0.075, 0.075, 0.36, 12), mats.scarf));
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, isTurtle ? 0.83 : 0.77, backZ);
      const lantern = addPart(new THREE.Mesh(this.cylGeo(0.05, 0.04, 0.12, 8), this.lanternGlowMat));
      lantern.position.set(0.2, isTurtle ? 0.5 : 0.44, backZ - 0.05);
      const cap = addPart(new THREE.Mesh(this.coneGeo(0.068, 0.06, 8), this.brassMat));
      cap.position.set(0.2, isTurtle ? 0.58 : 0.52, backZ - 0.05);
    } else if (c.role === 'forager') {
      // Wicker foraging basket on the back brimming with woodland berries!
      const backZ = isTurtle ? -0.46 : isBear ? -0.35 : -0.3;
      const basket = addPart(new THREE.Mesh(this.cylGeo(0.16, 0.12, 0.24, 12), this.woodMat));
      basket.position.set(0, isTurtle ? 0.58 : 0.52, backZ);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const berry = addPart(
          new THREE.Mesh(this.sphereGeo(0.055, 8, 6), i % 2 === 0 ? this.berryRedMat : this.berryBlueMat),
        );
        berry.position.set(Math.cos(a) * 0.065, isTurtle ? 0.71 : 0.65, backZ + Math.sin(a) * 0.065);
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
      if (!isBird && !isSnake && leftArm) {
        const shield = addPart(new THREE.Mesh(this.cylGeo(0.18, 0.18, 0.04, 16), this.woodMat), leftArm);
        shield.rotation.z = Math.PI / 2;
        shield.position.set(-0.08, -0.18, 0.08);
        const boss = addPart(new THREE.Mesh(this.sphereGeo(0.06, 10, 8), this.brassMat), leftArm);
        boss.position.set(-0.11, -0.18, 0.08);
        guardStaticGear.push(shield, boss);
      }
      if (!isBird && !isSnake && rightArm) {
        const spear = addPart(new THREE.Mesh(this.cylGeo(0.018, 0.02, 0.95, 8), this.woodMat), rightArm);
        spear.position.set(0.04, 0.02, 0.12);
        spear.rotation.x = 0.22;
        const tip = addPart(new THREE.Mesh(this.coneGeo(0.042, 0.15, 6), this.brassMat), rightArm);
        tip.position.set(0.04, 0.54, 0.24);
        tip.rotation.x = 0.22;
        guardStaticGear.push(spear, tip);
      }
    } else if (c.role === 'artisan') {
      // Jaunty tilted woodland artist beret + colorful berry-dye pouch!
      const beret = addPart(new THREE.Mesh(this.sphereGeo(0.2, 14, 10), mats.scarf), headGroup);
      beret.scale.set(1.18, 0.42, 1.12);
      beret.rotation.z = -0.26;
      beret.position.set(0.05, 0.24, -0.02);
      const pom = addPart(new THREE.Mesh(this.sphereGeo(0.036, 8, 6), this.brassMat), headGroup);
      pom.position.set(0.08, 0.32, -0.02);
    }

    // Builder's idle wooden mallet (hidden whenever an active construction stage tool is equipped)
    let idleBuilderMallet: THREE.Group | undefined;
    if (c.role === 'builder' && !isBird && !isSnake && !isFish && rightArm) {
      idleBuilderMallet = new THREE.Group();
      idleBuilderMallet.name = 'idle_builder_mallet';
      const handle = addPart(new THREE.Mesh(this.cylGeo(0.022, 0.026, 0.36, 8), this.woodMat), idleBuilderMallet);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, -0.23, 0.17);
      const collar = addPart(new THREE.Mesh(this.cylGeo(0.028, 0.028, 0.04, 8), this.brassMat), idleBuilderMallet);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, -0.23, 0.28);
      const malletHead = addPart(new THREE.Mesh(this.cylGeo(0.06, 0.06, 0.18, 12), this.leatherMat), idleBuilderMallet);
      malletHead.position.set(0, -0.23, 0.32);
      for (const endY of [-0.072, 0.072]) {
        const band = addPart(new THREE.Mesh(this.cylGeo(0.063, 0.063, 0.018, 12), this.brassMat), idleBuilderMallet);
        band.position.set(0, -0.23 + endY, 0.32);
      }
      rightArm.add(idleBuilderMallet);
    }

    // 6b. Stage-specific handheld construction tools (axe, spade, mason's trowel, carpenter's hammer)
    const toolMount: THREE.Object3D = !isBird && !isSnake && !isFish && rightArm ? rightArm : headGroup;
    const toolHolder = new THREE.Group();
    toolHolder.name = 'work_tool_holder';
    if (isBird || isSnake || isFish) {
      toolHolder.position.set(0, -0.04, 0.32);
      toolHolder.scale.setScalar(0.65);
    } else {
      toolHolder.position.set(0, -0.24, 0.06);
    }
    toolMount.add(toolHolder);

    const axe = new THREE.Group();
    axe.name = 'tool_axe';
    const axeHaft = addPart(new THREE.Mesh(this.cylGeo(0.024, 0.029, 0.58, 8), this.woodMat), axe);
    axeHaft.rotation.x = Math.PI / 2;
    axeHaft.position.set(0, 0, 0.24);
    const axeGrip = addPart(new THREE.Mesh(this.cylGeo(0.031, 0.031, 0.14, 8), this.leatherMat), axe);
    axeGrip.rotation.x = Math.PI / 2;
    axeGrip.position.set(0, 0, 0.04);
    const axeCollar = addPart(new THREE.Mesh(this.cylGeo(0.03, 0.03, 0.045, 8), this.brassMat), axe);
    axeCollar.rotation.x = Math.PI / 2;
    axeCollar.position.set(0, 0, 0.38);
    const axeBlade = addPart(new THREE.Mesh(this.geo.axeHead, this.steelMat), axe);
    axeBlade.position.set(0, 0, 0.45);
    axe.visible = false;
    toolHolder.add(axe);

    const spade = new THREE.Group();
    spade.name = 'tool_spade';
    const spadeShaft = addPart(new THREE.Mesh(this.cylGeo(0.024, 0.026, 0.56, 8), this.woodMat), spade);
    spadeShaft.rotation.x = Math.PI / 2;
    spadeShaft.position.set(0, 0, 0.23);
    const spadeCollar = addPart(new THREE.Mesh(this.cylGeo(0.031, 0.031, 0.04, 8), this.brassMat), spade);
    spadeCollar.rotation.x = Math.PI / 2;
    spadeCollar.position.set(0, 0, 0.45);
    // D-grip handle at the butt end of the spade shaft
    const dGripBar = addPart(new THREE.Mesh(this.cylGeo(0.016, 0.016, 0.12, 8), this.leatherMat), spade);
    dGripBar.rotation.z = Math.PI / 2;
    dGripBar.position.set(0, 0, -0.09);
    for (const side of [-1, 1] as const) {
      const strut = addPart(new THREE.Mesh(this.cylGeo(0.012, 0.013, 0.075, 6), this.woodMat), spade);
      strut.rotation.x = Math.PI / 2;
      strut.rotation.y = side * 0.42;
      strut.position.set(side * 0.035, 0, -0.06);
    }
    const spadeBlade = addPart(new THREE.Mesh(this.geo.spadeBlade, this.steelMat), spade);
    spadeBlade.position.set(0, 0, 0.52);
    spade.visible = false;
    toolHolder.add(spade);

    const trowel = new THREE.Group();
    trowel.name = 'tool_trowel';
    const trowelHandle = addPart(new THREE.Mesh(this.cylGeo(0.024, 0.028, 0.2, 8), this.woodMat), trowel);
    trowelHandle.rotation.x = Math.PI / 2;
    trowelHandle.position.set(0, 0, 0.07);
    const trowelFerrule = addPart(new THREE.Mesh(this.cylGeo(0.027, 0.025, 0.035, 8), this.brassMat), trowel);
    trowelFerrule.rotation.x = Math.PI / 2;
    trowelFerrule.position.set(0, 0, 0.17);
    const trowelBlade = addPart(new THREE.Mesh(this.geo.trowelBlade, this.steelMat), trowel);
    trowelBlade.position.set(0, -0.042, 0.22);
    trowel.visible = false;
    toolHolder.add(trowel);

    const hammer = new THREE.Group();
    hammer.name = 'tool_hammer';
    const hamHandle = addPart(new THREE.Mesh(this.cylGeo(0.023, 0.028, 0.42, 8), this.woodMat), hammer);
    hamHandle.rotation.x = Math.PI / 2;
    hamHandle.position.set(0, 0, 0.17);
    const hamGrip = addPart(new THREE.Mesh(this.cylGeo(0.03, 0.03, 0.12, 8), this.leatherMat), hammer);
    hamGrip.rotation.x = Math.PI / 2;
    hamGrip.position.set(0, 0, 0.03);
    const hamCollar = addPart(new THREE.Mesh(this.cylGeo(0.028, 0.028, 0.036, 8), this.brassMat), hammer);
    hamCollar.rotation.x = Math.PI / 2;
    hamCollar.position.set(0, 0, 0.31);
    const hamHead = addPart(new THREE.Mesh(this.geo.hammerHead, this.steelMat), hammer);
    hamHead.position.set(0, 0, 0.35);
    hammer.visible = false;
    toolHolder.add(hammer);

    const workTools: WorkToolKit = { axe, spade, trowel, hammer };

    // 6b-war. Dynamic war weapons (sword, spear, battle-axe, war-club, bow) & round war-shield
    const warSword = new THREE.Group();
    warSword.name = 'war_sword';
    const swGrip = addPart(new THREE.Mesh(this.cylGeo(0.024, 0.026, 0.18, 8), this.leatherMat), warSword);
    swGrip.rotation.x = Math.PI / 2;
    swGrip.position.set(0, 0, 0.04);
    const swPommel = addPart(new THREE.Mesh(this.sphereGeo(0.036, 8, 6), this.brassMat), warSword);
    swPommel.position.set(0, 0, -0.06);
    const swGuard = addPart(new THREE.Mesh(this.boxGeo(0.22, 0.032, 0.036), this.brassMat), warSword);
    swGuard.position.set(0, 0, 0.14);
    const swBlade = addPart(new THREE.Mesh(this.geo.swordBlade, this.steelMat), warSword);
    swBlade.position.set(0, 0, 0.15);
    warSword.visible = false;
    toolHolder.add(warSword);

    const warSpear = new THREE.Group();
    warSpear.name = 'war_spear';
    const spShaft = addPart(new THREE.Mesh(this.cylGeo(0.02, 0.023, 1.12, 8), this.woodMat), warSpear);
    spShaft.rotation.x = Math.PI / 2;
    spShaft.position.set(0, 0, 0.38);
    const spCollar = addPart(new THREE.Mesh(this.cylGeo(0.027, 0.027, 0.045, 8), this.brassMat), warSpear);
    spCollar.rotation.x = Math.PI / 2;
    spCollar.position.set(0, 0, 0.91);
    const spTassel = addPart(new THREE.Mesh(this.boxGeo(0.014, 0.11, 0.075), this.crimsonMat), warSpear);
    spTassel.position.set(0, -0.06, 0.87);
    const spTip = addPart(new THREE.Mesh(this.geo.spearTip, this.steelMat), warSpear);
    spTip.position.set(0, 0, 0.95);
    warSpear.visible = false;
    toolHolder.add(warSpear);

    const warBattleAxe = new THREE.Group();
    warBattleAxe.name = 'war_battle_axe';
    const baShaft = addPart(new THREE.Mesh(this.cylGeo(0.025, 0.029, 0.78, 8), this.woodMat), warBattleAxe);
    baShaft.rotation.x = Math.PI / 2;
    baShaft.position.set(0, 0, 0.3);
    const baGrip = addPart(new THREE.Mesh(this.cylGeo(0.032, 0.032, 0.16, 8), this.crimsonMat), warBattleAxe);
    baGrip.rotation.x = Math.PI / 2;
    baGrip.position.set(0, 0, 0.04);
    const baHead = addPart(new THREE.Mesh(this.geo.battleAxeHead, this.ironMat), warBattleAxe);
    baHead.position.set(0, 0, 0.59);
    warBattleAxe.visible = false;
    toolHolder.add(warBattleAxe);

    const warClub = new THREE.Group();
    warClub.name = 'war_club';
    const clGrip = addPart(new THREE.Mesh(this.cylGeo(0.03, 0.032, 0.18, 8), this.leatherMat), warClub);
    clGrip.rotation.x = Math.PI / 2;
    clGrip.position.set(0, 0, 0.04);
    addPart(new THREE.Mesh(this.geo.warClubHead, this.woodMat), warClub);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const stud = addPart(new THREE.Mesh(this.sphereGeo(0.022, 6, 5), this.ironMat), warClub);
      stud.position.set(Math.cos(a) * 0.074, Math.sin(a) * 0.074, 0.48);
    }
    warClub.visible = false;
    toolHolder.add(warClub);

    const warBow = new THREE.Group();
    warBow.name = 'war_bow';
    const bowStave = addPart(new THREE.Mesh(this.geo.bowStave, this.woodMat), warBow);
    bowStave.position.set(0, 0, 0.08);
    const bowString = addPart(new THREE.Mesh(this.cylGeo(0.005, 0.005, 0.84, 5), this.bowstringMat), warBow);
    bowString.position.set(0, 0, 0.02);
    const nockedArrow = addPart(new THREE.Mesh(this.geo.arrowMesh, this.ironMat), warBow);
    nockedArrow.position.set(0.02, 0, 0.24);
    warBow.visible = false;
    toolHolder.add(warBow);

    let warShield: THREE.Group | undefined;
    if (!isBird && !isSnake && !isFish && leftArm) {
      warShield = new THREE.Group();
      warShield.name = 'war_shield';
      const disk = addPart(new THREE.Mesh(this.cylGeo(0.24, 0.24, 0.04, 16), this.woodMat), warShield);
      disk.rotation.z = Math.PI / 2;
      const rim = addPart(new THREE.Mesh(this.torusGeo(0.24, 0.022, 6, 18), this.ironMat), warShield);
      rim.rotation.y = Math.PI / 2;
      addPart(new THREE.Mesh(this.boxGeo(0.045, 0.42, 0.11), this.crimsonMat), warShield);
      const boss = addPart(new THREE.Mesh(this.sphereGeo(0.068, 10, 8), this.brassMat), warShield);
      boss.position.set(-0.03, 0, 0);
      warShield.position.set(-0.1, -0.18, 0.1);
      warShield.visible = false;
      leftArm.add(warShield);
    }
    const warGear: WarGearKit = {
      sword: warSword,
      spear: warSpear,
      battleAxe: warBattleAxe,
      warClub,
      bow: warBow,
      shield: warShield,
    };

    // 6c. Emigrating pioneer pack (leather satchel + rolled cloak bedroll, shown during village-founding treks)
    const pioneerPack = new THREE.Group();
    if (!isFish) {
      const pBackZ = isTurtle ? -0.45 : isBear ? -0.34 : -0.29;
      const pBag = addPart(new THREE.Mesh(this.boxGeo(0.3, 0.34, 0.2), this.leatherMat), pioneerPack);
      pBag.position.set(0, isTurtle ? 0.62 : 0.56, pBackZ);
      const pRoll = addPart(new THREE.Mesh(this.cylGeo(0.07, 0.07, 0.34, 10), mats.scarf), pioneerPack);
      pRoll.rotation.z = Math.PI / 2;
      pRoll.position.set(0, isTurtle ? 0.82 : 0.76, pBackZ);
      const pLantern = addPart(new THREE.Mesh(this.cylGeo(0.045, 0.038, 0.11, 8), this.lanternGlowMat), pioneerPack);
      pLantern.position.set(-0.18, isTurtle ? 0.5 : 0.44, pBackZ - 0.05);
    }
    pioneerPack.visible = false;
    bodyGroup.add(pioneerPack);

    // 6d. Environmental biome-adaptation attire (rain hats, fur collars, straw hats, trail lanterns, sun-scarves!)
    const hasRoleHat =
      c.role === 'mystic' || c.role === 'guard' || c.role === 'artisan' || c.role === 'builder';
    if (adaptation === 'riverside_stilts') {
      if (!hasRoleHat && !isFrog) {
        const rainHat = addPart(new THREE.Mesh(this.geo.reedHat, this.reedWeaveMat), headGroup);
        rainHat.position.set(0, 0.17, -0.01);
        const tie = addPart(new THREE.Mesh(this.torusGeo(0.19, 0.02, 6, 16), adaptMats.mantle), headGroup);
        tie.rotation.x = Math.PI / 2;
        tie.position.set(0, 0.21, -0.01);
      }
    } else if (adaptation === 'coastal_harbor') {
      // Waxed sea-teal mariner storm-hat & brass harbor medallion clasp
      const clasp = addPart(new THREE.Mesh(this.sphereGeo(0.055, 8, 6), this.brassMat));
      clasp.position.set(0, 0.72, 0.27);
      if (!hasRoleHat && !isFrog) {
        const marinerHat = addPart(new THREE.Mesh(this.geo.strawHat, adaptMats.mantle), headGroup);
        marinerHat.position.set(0, 0.18, -0.01);
        const band = addPart(new THREE.Mesh(this.torusGeo(0.24, 0.024, 6, 18), adaptMats.accent), headGroup);
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
        const ribbon = addPart(new THREE.Mesh(this.torusGeo(0.245, 0.022, 6, 18), adaptMats.mantle), headGroup);
        ribbon.rotation.x = Math.PI / 2;
        ribbon.position.set(0, 0.23, -0.01);
      }
    } else if (adaptation === 'forest_canopy') {
      // Glowing woodland fairy-lantern charm clipped to the belt for deep-canopy trails
      const charm = addPart(new THREE.Mesh(this.sphereGeo(0.052, 8, 6), this.lanternGlowMat));
      charm.position.set(0.26, 0.43, 0.14);
      if (!hasRoleHat && !isFrog) {
        const leafCrest = addPart(new THREE.Mesh(this.sphereGeo(0.13, 8, 6), adaptMats.accent), headGroup);
        leafCrest.scale.set(1.25, 0.32, 1.35);
        leafCrest.position.set(0, 0.26, -0.04);
        leafCrest.rotation.x = -0.18;
      }
    } else if (adaptation === 'desert_oasis') {
      // Breezy saffron linen sun-scarf collar + desert headwrap band
      if (!isFish) {
        const scarf = addPart(new THREE.Mesh(this.geo.furCollar, adaptMats.accent));
        scarf.scale.set(0.95, 0.65, 0.95);
        scarf.position.set(0, 0.78, 0.02);
      }
      if (!hasRoleHat && !isFrog && !isFish) {
        const wrap = addPart(new THREE.Mesh(this.torusGeo(0.24, 0.036, 8, 18), adaptMats.accent), headGroup);
        wrap.rotation.x = Math.PI / 2 + 0.12;
        wrap.position.set(0, 0.16, 0);
      }
    } else if (adaptation === 'waterway_haven') {
      // Floating water-lily pad cap topped with a dainty pink lotus bud!
      if (isFish) {
        const lotus = addPart(new THREE.Mesh(this.sphereGeo(0.055, 8, 6), this.lotusPinkMat), headGroup);
        lotus.scale.set(1.15, 0.72, 1.15);
        lotus.position.set(0, 0.14, 0.02);
      } else if (!hasRoleHat && !isFrog) {
        const lilyCap = addPart(new THREE.Mesh(this.geo.lilyHat, this.lilyPadHatMat), headGroup);
        lilyCap.position.set(0, 0.21, -0.01);
        const lotusBud = addPart(new THREE.Mesh(this.sphereGeo(0.068, 10, 8), this.lotusPinkMat), headGroup);
        lotusBud.scale.set(1.15, 0.78, 1.15);
        lotusBud.position.set(0.08, 0.28, 0.04);
      }
    }

    // Subtle natural individual touch: some creatures tuck a tiny woodland leaf sprig behind an ear
    if (seed > 0.72 && c.role !== 'mystic' && c.role !== 'guard' && !isFish) {
      const sprig = addPart(new THREE.Mesh(this.sphereGeo(0.042, 8, 6), this.leafMat), headGroup);
      sprig.scale.set(1.25, 0.38, 0.85);
      sprig.rotation.set(0.3, 0.4, 0.5);
      sprig.position.set(-0.18, 0.18, 0.12);
    }

    // 7. Magical golden fairy-ring selection halo with 4 orbiting sparkle beads
    const selectionGroup = new THREE.Group();
    selectionGroup.position.y = 0.08;
    const ringMesh = new THREE.Mesh(this.geo.selectionRing, this.selectionMat);
    selectionGroup.add(ringMesh);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const bead = new THREE.Mesh(this.geo.selectionBead, this.selectionMat);
      bead.scale.setScalar(2.6);
      bead.position.set(Math.cos(a) * 0.65, 0.12, Math.sin(a) * 0.65);
      selectionGroup.add(bead);
    }
    selectionGroup.visible = false;
    root.add(selectionGroup);

    let swimRipple: THREE.Mesh | undefined;
    if (def.aquatic) {
      swimRipple = new THREE.Mesh(this.geo.swimRipple, this.swimRippleMat);
      swimRipple.position.y = 0.06;
      swimRipple.visible = false;
      root.add(swimRipple);
    }

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
      warGear,
      guardStaticGear,
      idleBuilderMallet,
      pioneerPack,
      seedPhase: seed * Math.PI * 2,
      baseLeftEarZ,
      baseRightEarZ,
      baseTailX,
      workChipCooldown: 0.15,
      bleedCooldown: 0.25 + seed * 0.4,
      adaptation,
      swimRipple,
      baseFootY,
      baseFootZ,
      moveBlend: c.moveIntensity,
      gaitBlend: c.gaitEffort,
      stridePhase: c.animPhase,
      lastSimAnimPhase: c.animPhase,
      footGroundBlend: isBird && c.flightAltitude > 0.3 ? 0 : 1,
      bobY: 0,
      tiltX: 0,
      tiltZ: 0,
      headPitch: 0,
      headRoll: 0,
      squashY: 1.0,
      bodyYaw: 0,
    };
  }

  dispose(): void {
    for (const sp of this.sparks) {
      this.rootGroup.remove(sp.mesh);
      sp.mat.dispose();
    }
    this.sparks.length = 0;
    for (const ar of this.arrows) {
      this.rootGroup.remove(ar.mesh);
    }
    this.arrows.length = 0;
    this.rootGroup.remove(this.gore.group);
    this.gore.dispose();
    const shared = this.sharedDisposableSet;
    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry && !shared.has(obj.geometry)) {
        obj.geometry.dispose();
      }
    });
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.sharedDisposableSet.clear();
    this.primGeoCache.clear();
    this.speciesMats.clear();
    this.adaptationMats.clear();
  }
}
