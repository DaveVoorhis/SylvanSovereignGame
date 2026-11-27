import * as THREE from 'three';
import type { ActiveWar, BuildingType, VillageAdaptationId } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, type BuildingInstance, type Settlement } from '@simulation/settlements/Settlement';
import { sampleBridgeDeckY, type BridgeInstance } from '@simulation/terrain/Bridge';
import type { WorldState } from '@simulation/WorldState';
import type { PbrTextureSet, TextureLibrary } from './ProceduralTextures';
import type { SkyLightingState } from './WaterShader';
import {
  HearthFire,
  createChimneySmokeGeometry,
  createChimneySmokeMaterial,
  createOvenFireMaterial,
  createSharedFlameGeometry,
} from './FireEffect';
import { FountainWaterSystem } from './FountainWaterEffect';

interface ArchWeatheringUniforms {
  readonly uRainWetness: { value: number };
  readonly uWinter: { value: number };
}

function makeNormalOrBump(
  tex: PbrTextureSet | undefined,
  fallbackBump: THREE.Texture | null,
  normalScale: number,
  bumpScale: number,
): Partial<THREE.MeshStandardMaterialParameters> {
  if (tex?.normalMap) {
    return {
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(normalScale, normalScale),
    };
  }
  return {
    bumpMap: tex?.bumpMap ?? fallbackBump,
    bumpScale,
  };
}

/**
 * Injects world-space architectural weathering onto cottage/stone/roof materials:
 * macro surface mottling (breaking uniform surfaces), upward-facing moss/lichen patina,
 * eave underside shadow depth, rain wetness darkening + specular sheen, and winter roof snow.
 */
function applyArchitecturalWeathering(
  mat: THREE.MeshStandardMaterial,
  uniforms: ArchWeatheringUniforms,
  opts: { moss?: number; snow?: number; mottle?: number; rainDarken?: number } = {},
): void {
  const mossAmt = opts.moss ?? 0.18;
  const snowAmt = opts.snow ?? 0.45;
  const mottleAmt = opts.mottle ?? 0.15;
  const rainDarken = opts.rainDarken ?? 0.24;
  const cacheKey = `arch_weather_${mossAmt.toFixed(2)}_${snowAmt.toFixed(2)}_${mottleAmt.toFixed(2)}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRainWetness = uniforms.uRainWetness;
    shader.uniforms.uWinter = uniforms.uWinter;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vArchWorldPos;
        varying vec3 vArchWorldNormal;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 archWp = modelMatrix * vec4(transformed, 1.0);
        vArchWorldPos = archWp.xyz;
        vArchWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uRainWetness;
        uniform float uWinter;
        varying vec3 vArchWorldPos;
        varying vec3 vArchWorldNormal;
        float archHash2(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float archNoise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(archHash2(i), archHash2(i + vec2(1.0, 0.0)), f.x),
            mix(archHash2(i + vec2(0.0, 1.0)), archHash2(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float archN1 = archNoise2(vArchWorldPos.xz * 0.42 + vec2(vArchWorldPos.y * 0.55));
        float archN2 = archNoise2(vArchWorldPos.xz * 1.45 - vec2(vArchWorldPos.y * 0.95));
        float archFbm = archN1 * 0.65 + archN2 * 0.35;
        float archUp = vArchWorldNormal.y;
        float archEaveShade = mix(1.0, 0.80, smoothstep(0.15, -0.55, archUp));
        diffuseColor.rgb *= (1.0 - ${(mottleAmt * 0.5).toFixed(3)} + archFbm * ${mottleAmt.toFixed(3)}) * archEaveShade;
        float archMossMask = smoothstep(0.42, 0.88, archUp) * smoothstep(0.42, 0.82, archFbm) * ${mossAmt.toFixed(3)} * (1.0 - uWinter * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.24, 0.11), archMossMask);
        float archWet = uRainWetness * smoothstep(-0.25, 0.55, archUp);
        diffuseColor.rgb *= (1.0 - archWet * ${rainDarken.toFixed(3)});
        float archSnowMask = uWinter * smoothstep(0.46, 0.86, archUp) * smoothstep(0.28, 0.72, archFbm + 0.18) * ${snowAmt.toFixed(3)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), archSnowMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        float archWetR = uRainWetness * smoothstep(-0.25, 0.55, vArchWorldNormal.y);
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.24), archWetR * 0.78);`,
      );
  };
}

interface StagedPart {
  readonly obj: THREE.Object3D;
  readonly revealAt: number;
}

interface RenderedBuilding {
  readonly group: THREE.Group;
  readonly clearingGroup: THREE.Group;
  readonly levelingPad: THREE.Object3D;
  readonly levelingExtras: THREE.Group;
  readonly foundationGroup: THREE.Group;
  readonly framingParts: StagedPart[];
  readonly scaffoldingGroup: THREE.Group;
  readonly finishedParts: StagedPart[];
  readonly ownedMaterials: THREE.Material[];
  readonly crystalMesh?: THREE.Mesh;
  readonly runeRingA?: THREE.Mesh;
  readonly runeRingB?: THREE.Mesh;
  readonly wheelMesh?: THREE.Object3D;
  readonly rotorMesh?: THREE.Object3D;
  readonly fountainJet?: THREE.Object3D;
  readonly fountainMist?: THREE.Object3D;
  readonly fountainSpray?: THREE.Points;
  readonly swayPart?: THREE.Object3D;
  readonly floatGroup?: THREE.Object3D;
  readonly chimneySmokes?: THREE.Points[];
  lastAppliedProgress: number;
  lastAppliedCompleted: boolean;
  lastAppliedDisassembling: boolean;
}

/** Fixed count of scene PointLights dedicated to nearby village hearths (keeps NUM_POINT_LIGHTS constant). */
const HEARTH_LIGHT_POOL_SIZE = 6;

interface RenderedHearth {
  readonly settlementId: string;
  readonly fire: HearthFire;
  readonly position: THREE.Vector3;
  readonly banner: THREE.Mesh;
  readonly seed: number;
  readonly festivalDecor: THREE.Group;
  readonly festivalCrown: THREE.Object3D;
  readonly festivalPrimaryMat: THREE.MeshStandardMaterial;
  readonly festivalSecondaryMat: THREE.MeshStandardMaterial;
  readonly festivalLanternMat: THREE.ShaderMaterial;
}

/** Creates GPU-animated rising festive paper sky lanterns & glowing celebration sparkles above a plaza. */
function createFestivalLanternsGeometry(seed: number, count = 42): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const h1 = Math.abs(Math.sin(seed * 13.7 + i * 12.9898) * 43758.5453) % 1;
    const h2 = Math.abs(Math.sin(seed * 27.3 + i * 78.233) * 24634.6345) % 1;
    const h3 = Math.abs(Math.sin(seed * 53.1 + i * 39.425) * 19384.2134) % 1;
    const ang = h1 * Math.PI * 2;
    const r = 1.6 + h2 * 3.8;
    positions[i * 3] = Math.cos(ang) * r;
    positions[i * 3 + 1] = 2.6 + h3 * 1.4;
    positions[i * 3 + 2] = Math.sin(ang) * r;
    seeds[i * 3] = h1; // phase offset
    seeds[i * 3 + 1] = 0.55 + h2 * 0.65; // rise speed
    seeds[i * 3 + 2] = h3; // color mix & size seed
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  return geo;
}

function createFestivalLanternMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0xffc857) },
      uColorB: { value: new THREE.Color(0xff6b9d) },
      uHeightScale: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime;
      uniform float uHeightScale;
      varying float vAlpha;
      varying float vMix;
      void main() {
        float cycle = fract(aSeed.x + uTime * aSeed.y * 0.14);
        float swayX = sin(uTime * 1.3 + aSeed.x * 19.0 + cycle * 6.0) * 0.55;
        float swayZ = cos(uTime * 1.1 + aSeed.z * 23.0 + cycle * 5.0) * 0.55;
        vec3 p = position + vec3(swayX, cycle * 8.5 * uHeightScale, swayZ);
        vAlpha = sin(cycle * 3.14159265) * 0.92;
        vMix = aSeed.z;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float baseSize = mix(10.0, 20.0, aSeed.z) * (0.85 + 0.15 * uHeightScale);
        gl_PointSize = clamp(baseSize * (56.0 / max(6.0, -mvPosition.z)), 2.5, 22.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vAlpha;
      varying float vMix;
      void main() {
        vec2 q = gl_PointCoord - vec2(0.5);
        float d = length(q);
        if (d > 0.5) discard;
        float core = exp(-d * d * 20.0);
        float halo = smoothstep(0.5, 0.08, d) * 0.55;
        vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.85, vMix));
        col = mix(col, vec3(1.0, 0.97, 0.88), core * 0.65);
        gl_FragColor = vec4(col, clamp((core + halo) * vAlpha, 0.0, 0.92));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface RenderedBridge {
  readonly group: THREE.Group;
  readonly stages: { readonly t: number; readonly obj: THREE.Object3D }[];
  readonly lanterns: THREE.Object3D[];
  lastAppliedProgress: number;
  lastAppliedCompleted: boolean;
}

interface RenderedWarBanner {
  readonly group: THREE.Group;
  readonly flagA: THREE.Object3D;
  readonly flagB: THREE.Object3D;
  readonly ring: THREE.Mesh;
  readonly ringMat: THREE.MeshBasicMaterial;
  readonly ownedMaterials: THREE.Material[];
  readonly ownedGeometries: THREE.BufferGeometry[];
}

/**
 * Renders whimsical, high-resolution storybook woodland architecture across all 14 building types
 * and settlement centerpieces: bell-roofed burrow cottages, half-timbered fairytale houses,
 * barrel-bellied acorn granaries, bountiful market stalls, hearth bakeries, lantern taverns,
 * turning-wheel workshops, canvas-sailed meadow windmills, glass canopy conservatories,
 * spire watchtowers, mystical sylvan shrines, starlight fountains, verdigris-domed owl libraries,
 * and monumental bell-tower guildhalls.
 */
export class SettlementRenderer {
  readonly rootGroup = new THREE.Group();

  private readonly timberMat: THREE.MeshStandardMaterial;
  private readonly darkTimberMat: THREE.MeshStandardMaterial;
  private readonly plasterMat: THREE.MeshStandardMaterial;
  private readonly warmPlasterMat: THREE.MeshStandardMaterial;
  private readonly thatchMat: THREE.MeshStandardMaterial;
  private readonly slateRoofMat: THREE.MeshStandardMaterial;
  private readonly verdigrisMat: THREE.MeshStandardMaterial;
  private readonly brickMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;
  private readonly fountainWaterMat: THREE.MeshStandardMaterial;
  private readonly fountainWater: FountainWaterSystem;
  private readonly canvasSailMat: THREE.MeshStandardMaterial;
  private readonly stoneMat: THREE.MeshStandardMaterial;
  private readonly windowMat: THREE.MeshStandardMaterial;
  private readonly shrineCrystalMat: THREE.MeshStandardMaterial;
  private readonly brassMat: THREE.MeshStandardMaterial;
  private readonly doorMat: THREE.MeshStandardMaterial;
  private readonly mossLeafMat: THREE.MeshStandardMaterial;
  private readonly flowerPinkMat: THREE.MeshStandardMaterial;
  private readonly flowerGoldMat: THREE.MeshStandardMaterial;
  private readonly flowerBlueMat: THREE.MeshStandardMaterial;
  private readonly charredLogMat: THREE.MeshStandardMaterial;
  private readonly ovenFireMat: THREE.ShaderMaterial;
  private readonly chimneySmokeMat: THREE.ShaderMaterial;
  private readonly potteryMat: THREE.MeshStandardMaterial;
  private readonly earthPadMat: THREE.MeshStandardMaterial;
  private readonly ropeMat: THREE.MeshStandardMaterial;
  private readonly driftwoodMat: THREE.MeshStandardMaterial;
  private readonly tealTrimMat: THREE.MeshStandardMaterial;
  private readonly mossRoofMat: THREE.MeshStandardMaterial;
  private readonly terracottaPlasterMat: THREE.MeshStandardMaterial;
  private readonly terracottaRoofMat: THREE.MeshStandardMaterial;
  private readonly ochreCanvasMat: THREE.MeshStandardMaterial;
  private readonly goldenThatchMat: THREE.MeshStandardMaterial;
  private readonly graniteMat: THREE.MeshStandardMaterial;
  private readonly waterLilyMat: THREE.MeshStandardMaterial;
  private readonly lotusPinkMat: THREE.MeshStandardMaterial;
  private readonly coralMat: THREE.MeshStandardMaterial;
  private readonly pearlGlowMat: THREE.MeshStandardMaterial;
  private readonly bambooMat: THREE.MeshStandardMaterial;
  private readonly beaverBranchMat: THREE.MeshStandardMaterial;

  // Shared sculpted architectural geometries
  private readonly bellRoofGeo: THREE.BufferGeometry;
  private readonly acornSiloGeo: THREE.BufferGeometry;
  private readonly gableRoofGeo: THREE.BufferGeometry;
  private readonly fountainBowlGeo: THREE.BufferGeometry;
  private readonly sharedFlameGeo: THREE.BufferGeometry;
  private readonly sharedGeos: Set<THREE.BufferGeometry>;

  private readonly buildingMeshes = new Map<string, RenderedBuilding>();
  private readonly bridgeMeshes = new Map<string, RenderedBridge>();
  private readonly warBanners = new Map<string, RenderedWarBanner>();
  private readonly hearths: RenderedHearth[] = [];
  private readonly hearthLightPool: THREE.PointLight[] = [];
  private readonly hearthSortScratch: { hearth: RenderedHearth; distSq: number }[] = [];
  private readonly settlementFlags = new Set<string>();
  private readonly extraDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly archUniforms: ArchWeatheringUniforms = {
    uRainWetness: { value: 0 },
    uWinter: { value: 0 },
  };
  private readonly windowDayColor = new THREE.Color(0x32404a);
  private readonly windowNightColor = new THREE.Color(0xffe094);
  private readonly liveBuildingIdsScratch = new Set<string>();
  private lastSyncedStructureRevision = -1;
  private lastSyncedSettlementCount = -1;
  private lastSyncedBuildingCount = -1;
  private lastSyncedBridgeCount = -1;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    textures: TextureLibrary,
  ) {
    const plasterTex = textures.plaster;
    const slateTex = textures.slateRoof ?? textures.stone;
    const rockTex = textures.rock ?? textures.stone;
    const fabricNormalProps: Partial<THREE.MeshStandardMaterialParameters> = textures.fabricNormal
      ? { normalMap: textures.fabricNormal, normalScale: new THREE.Vector2(0.45, 0.45) }
      : { bumpMap: textures.fabricBump, bumpScale: 0.04 };

    this.timberMat = new THREE.MeshStandardMaterial({
      color: 0xe6dccb,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.72, 0.14),
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.86,
    });
    this.darkTimberMat = new THREE.MeshStandardMaterial({
      color: 0x4a3423,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.68, 0.12),
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.9,
    });
    this.plasterMat = new THREE.MeshStandardMaterial({
      color: plasterTex ? 0xf2ece0 : 0xece2cf,
      map: plasterTex?.map ?? null,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.45, 0.035),
      roughnessMap: plasterTex?.roughnessMap ?? null,
      roughness: 0.92,
    });
    this.warmPlasterMat = new THREE.MeshStandardMaterial({
      color: plasterTex ? 0xe5d2b2 : 0xe0c8a4,
      map: plasterTex?.map ?? null,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.48, 0.04),
      roughnessMap: plasterTex?.roughnessMap ?? null,
      roughness: 0.92,
    });
    this.thatchMat = new THREE.MeshStandardMaterial({
      color: 0xdfd5be,
      map: textures.thatch.map,
      ...makeNormalOrBump(textures.thatch, null, 0.88, 0.2),
      roughnessMap: textures.thatch.roughnessMap,
      roughness: 0.94,
    });
    this.slateRoofMat = new THREE.MeshStandardMaterial({
      color: textures.slateRoof ? 0xc2cbd2 : 0x52606c,
      map: slateTex.map,
      ...makeNormalOrBump(slateTex, null, 0.82, 0.16),
      roughnessMap: slateTex.roughnessMap,
      roughness: 0.74,
      metalness: 0.06,
    });
    this.verdigrisMat = new THREE.MeshStandardMaterial({
      color: 0x558378,
      roughness: 0.52,
      metalness: 0.38,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.35, 0.04),
    });
    this.brickMat = new THREE.MeshStandardMaterial({
      color: 0x944d39,
      map: textures.stone.map,
      ...makeNormalOrBump(textures.stone, null, 0.74, 0.16),
      roughnessMap: textures.stone.roughnessMap,
      roughness: 0.9,
    });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0xcfe2e8,
      emissive: 0x0e1d22,
      emissiveIntensity: 0.04,
      roughness: 0.08,
      metalness: 0.24,
      transparent: true,
      opacity: 0.42,
    });
    this.fountainWaterMat = new THREE.MeshStandardMaterial({
      color: 0x2b6d78,
      emissive: 0x071a20,
      emissiveIntensity: 0.04,
      roughness: 0.05,
      metalness: 0.18,
      transparent: true,
      opacity: 0.76,
    });
    this.fountainWater = new FountainWaterSystem();
    this.canvasSailMat = new THREE.MeshStandardMaterial({
      color: 0xe8decb,
      roughness: 0.9,
      ...fabricNormalProps,
      side: THREE.DoubleSide,
    });
    this.stoneMat = new THREE.MeshStandardMaterial({
      color: 0xdcd7cd,
      map: textures.stone.map,
      ...makeNormalOrBump(textures.stone, null, 0.84, 0.18),
      roughnessMap: textures.stone.roughnessMap,
      roughness: 0.9,
    });
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0x32404a,
      emissive: 0xff9b32,
      emissiveIntensity: 0.08,
      roughness: 0.14,
      metalness: 0.28,
    });
    this.shrineCrystalMat = new THREE.MeshStandardMaterial({
      color: 0x8de0cf,
      emissive: 0x38b89b,
      emissiveIntensity: 0.92,
      roughness: 0.14,
      metalness: 0.18,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xcfa755,
      roughness: 0.32,
      metalness: 0.82,
    });
    this.doorMat = new THREE.MeshStandardMaterial({
      color: 0x623b22,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.65, 0.12),
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.82,
    });
    this.mossLeafMat = new THREE.MeshStandardMaterial({
      color: 0x466b32,
      roughness: 0.86,
    });
    this.flowerPinkMat = new THREE.MeshStandardMaterial({ color: 0xd47d96, roughness: 0.68 });
    this.flowerGoldMat = new THREE.MeshStandardMaterial({ color: 0xdbb44a, roughness: 0.68 });
    this.flowerBlueMat = new THREE.MeshStandardMaterial({ color: 0x6e90c9, roughness: 0.68 });
    this.charredLogMat = new THREE.MeshStandardMaterial({
      color: 0x261a14,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.78, 0.18),
      emissive: 0x3b0e02,
      emissiveIntensity: 0.35,
      roughness: 0.94,
    });
    this.ovenFireMat = createOvenFireMaterial();
    this.chimneySmokeMat = createChimneySmokeMaterial();
    this.potteryMat = new THREE.MeshStandardMaterial({
      color: 0xb05f3c,
      roughness: 0.52,
    });
    this.earthPadMat = new THREE.MeshStandardMaterial({
      color: 0x644b34,
      map: textures.forestFloor.map,
      ...makeNormalOrBump(textures.forestFloor, textures.stone.bumpMap, 0.65, 0.14),
      roughness: 0.96,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: 0xbca782,
      roughness: 0.94,
    });
    this.driftwoodMat = new THREE.MeshStandardMaterial({
      color: 0x6c6054,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.72, 0.16),
      roughness: 0.92,
    });
    this.tealTrimMat = new THREE.MeshStandardMaterial({
      color: 0x32696f,
      roughness: 0.76,
      ...fabricNormalProps,
    });
    this.mossRoofMat = new THREE.MeshStandardMaterial({
      color: 0x496537,
      map: textures.thatch.map,
      ...makeNormalOrBump(textures.thatch, null, 0.85, 0.22),
      roughness: 0.94,
    });
    this.terracottaPlasterMat = new THREE.MeshStandardMaterial({
      color: plasterTex ? 0xe0b886 : 0xdcb27e,
      map: plasterTex?.map ?? null,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.48, 0.04),
      roughnessMap: plasterTex?.roughnessMap ?? null,
      roughness: 0.9,
    });
    this.terracottaRoofMat = new THREE.MeshStandardMaterial({
      color: textures.slateRoof ? 0xc86b48 : 0xb25434,
      map: slateTex.map,
      ...makeNormalOrBump(slateTex, null, 0.8, 0.18),
      roughnessMap: slateTex.roughnessMap,
      roughness: 0.82,
    });
    this.ochreCanvasMat = new THREE.MeshStandardMaterial({
      color: 0xddb76a,
      roughness: 0.88,
      ...fabricNormalProps,
      side: THREE.DoubleSide,
    });
    this.goldenThatchMat = new THREE.MeshStandardMaterial({
      color: 0xd6b56d,
      map: textures.thatch.map,
      ...makeNormalOrBump(textures.thatch, null, 0.85, 0.2),
      roughnessMap: textures.thatch.roughnessMap,
      roughness: 0.92,
    });
    this.graniteMat = new THREE.MeshStandardMaterial({
      color: textures.rock ? 0xc0c4c2 : 0x7a8184,
      map: rockTex.map,
      ...makeNormalOrBump(rockTex, null, 0.88, 0.22),
      roughnessMap: rockTex.roughnessMap,
      roughness: 0.92,
    });

    // Apply shared procedural weathering (mottling, moss patina, rain sheen, winter roof snow)
    applyArchitecturalWeathering(this.timberMat, this.archUniforms, { moss: 0.14, snow: 0.35, mottle: 0.14 });
    applyArchitecturalWeathering(this.darkTimberMat, this.archUniforms, { moss: 0.12, snow: 0.35, mottle: 0.12 });
    applyArchitecturalWeathering(this.plasterMat, this.archUniforms, { moss: 0.16, snow: 0.22, mottle: 0.18 });
    applyArchitecturalWeathering(this.warmPlasterMat, this.archUniforms, { moss: 0.15, snow: 0.22, mottle: 0.18 });
    applyArchitecturalWeathering(this.thatchMat, this.archUniforms, { moss: 0.28, snow: 0.68, mottle: 0.16 });
    applyArchitecturalWeathering(this.slateRoofMat, this.archUniforms, { moss: 0.22, snow: 0.72, mottle: 0.14 });
    applyArchitecturalWeathering(this.verdigrisMat, this.archUniforms, { moss: 0.1, snow: 0.55, mottle: 0.16 });
    applyArchitecturalWeathering(this.brickMat, this.archUniforms, { moss: 0.2, snow: 0.4, mottle: 0.16 });
    applyArchitecturalWeathering(this.stoneMat, this.archUniforms, { moss: 0.26, snow: 0.52, mottle: 0.16 });
    applyArchitecturalWeathering(this.driftwoodMat, this.archUniforms, { moss: 0.18, snow: 0.35, mottle: 0.14 });
    applyArchitecturalWeathering(this.mossRoofMat, this.archUniforms, { moss: 0.32, snow: 0.68, mottle: 0.16 });
    applyArchitecturalWeathering(this.terracottaPlasterMat, this.archUniforms, { moss: 0.14, snow: 0.22, mottle: 0.18 });
    applyArchitecturalWeathering(this.terracottaRoofMat, this.archUniforms, { moss: 0.18, snow: 0.68, mottle: 0.14 });
    applyArchitecturalWeathering(this.goldenThatchMat, this.archUniforms, { moss: 0.24, snow: 0.68, mottle: 0.16 });
    this.waterLilyMat = new THREE.MeshStandardMaterial({
      color: 0x2f8f4e,
      roughness: 0.44,
      metalness: 0.04,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.26, 0.04),
    });
    this.lotusPinkMat = new THREE.MeshStandardMaterial({
      color: 0xf684ac,
      emissive: 0x401222,
      emissiveIntensity: 0.16,
      roughness: 0.42,
    });
    this.coralMat = new THREE.MeshStandardMaterial({
      color: 0xe46f56,
      roughness: 0.56,
      ...makeNormalOrBump(plasterTex, textures.fabricBump, 0.34, 0.05),
    });
    this.pearlGlowMat = new THREE.MeshStandardMaterial({
      color: 0xbaf6ff,
      emissive: 0x38c9e0,
      emissiveIntensity: 0.9,
      roughness: 0.16,
      metalness: 0.22,
    });
    this.bambooMat = new THREE.MeshStandardMaterial({
      color: 0xc2a86b,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.58, 0.12),
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.72,
    });
    this.beaverBranchMat = new THREE.MeshStandardMaterial({
      color: 0x765338,
      map: textures.timber.map,
      ...makeNormalOrBump(textures.timber, null, 0.84, 0.2),
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.88,
    });

    applyArchitecturalWeathering(this.graniteMat, this.archUniforms, { moss: 0.26, snow: 0.55, mottle: 0.16 });
    applyArchitecturalWeathering(this.beaverBranchMat, this.archUniforms, { moss: 0.28, snow: 0.52, mottle: 0.16 });
    applyArchitecturalWeathering(this.bambooMat, this.archUniforms, { moss: 0.14, snow: 0.35, mottle: 0.12 });

    // Bell-curved fairytale thatch cottage roof (LatheGeometry wound bottom-to-top for outward normals)
    const bellPts = [
      new THREE.Vector2(1.42, 0.04),
      new THREE.Vector2(1.92, -0.08),
      new THREE.Vector2(2.14, -0.02),
      new THREE.Vector2(1.96, 0.14),
      new THREE.Vector2(1.42, 0.65),
      new THREE.Vector2(0.82, 1.25),
      new THREE.Vector2(0.32, 1.68),
      new THREE.Vector2(0.0, 1.82),
    ];
    this.bellRoofGeo = new THREE.LatheGeometry(bellPts, 24);

    // Barrel-bellied acorn granary silo (LatheGeometry)
    const siloPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(1.12, 0.04),
      new THREE.Vector2(1.42, 0.55),
      new THREE.Vector2(1.52, 1.18),
      new THREE.Vector2(1.44, 1.78),
      new THREE.Vector2(1.22, 2.24),
      new THREE.Vector2(0.0, 2.28),
    ];
    this.acornSiloGeo = new THREE.LatheGeometry(siloPts, 22);

    // Steep storybook gabled roof prism (ExtrudeGeometry)
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-1.72, 0);
    gableShape.quadraticCurveTo(-0.82, 0.72, 0, 1.72);
    gableShape.quadraticCurveTo(0.82, 0.72, 1.72, 0);
    gableShape.closePath();
    this.gableRoofGeo = new THREE.ExtrudeGeometry(gableShape, {
      depth: 2.9,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      bevelSegments: 2,
    });
    this.gableRoofGeo.translate(0, 0, -1.45);

    // Classical carved overhanging stone upper basin for village fountains (LatheGeometry)
    const bowlPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.28, 0.02),
      new THREE.Vector2(0.46, 0.1),
      new THREE.Vector2(0.72, 0.24),
      new THREE.Vector2(0.84, 0.34),
      new THREE.Vector2(0.82, 0.41),
      new THREE.Vector2(0.72, 0.41),
      new THREE.Vector2(0.68, 0.3),
      new THREE.Vector2(0.32, 0.22),
      new THREE.Vector2(0.0, 0.22),
    ];
    this.fountainBowlGeo = new THREE.LatheGeometry(bowlPts, 24);

    this.sharedFlameGeo = createSharedFlameGeometry();
    this.sharedGeos = new Set<THREE.BufferGeometry>([
      this.bellRoofGeo,
      this.acornSiloGeo,
      this.gableRoofGeo,
      this.fountainBowlGeo,
      this.sharedFlameGeo,
      ...this.fountainWater.sharedGeometries,
    ]);

    // Pre-allocate a fixed pool of hearth PointLights permanently in the scene so founding new
    // settlements never alters NUM_POINT_LIGHTS or triggers multi-second PBR shader recompilations.
    for (let i = 0; i < HEARTH_LIGHT_POOL_SIZE; i++) {
      const pooledLight = new THREE.PointLight(0xff8c2b, 0, 22, 1.55);
      this.hearthLightPool.push(pooledLight);
      this.rootGroup.add(pooledLight);
    }

    scene.add(this.rootGroup);
    this.syncAll();
  }

  update(dt: number, sky?: SkyLightingState, focusTarget?: THREE.Vector3): void {
    this.syncAll();

    const t = this.world.elapsedSeconds;

    // Warm evening window & hearth glow intensity
    const sunAngle = (this.world.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 0.85;
    const daylight = THREE.MathUtils.clamp((sunY + 0.16) / 0.55, 0, 1);
    const nightGlow = THREE.MathUtils.clamp(1 - (sunY + 0.1) * 2.2, 0.0, 2.2);
    const windowWarmth = THREE.MathUtils.clamp(1 - daylight * 1.15, 0, 1);
    this.windowMat.color.copy(this.windowDayColor).lerp(this.windowNightColor, windowWarmth);
    this.windowMat.emissiveIntensity = 0.04 + windowWarmth * (0.45 + nightGlow * 0.85);
    this.fountainWaterMat.emissiveIntensity = 0.015 * daylight;

    this.archUniforms.uRainWetness.value =
      sky?.rainWetness ??
      (this.world.weather === 'storm' ? 1.0 : this.world.weather === 'rain' ? 0.78 : 0.0);
    this.archUniforms.uWinter.value = (sky?.isWinter ?? this.world.season === 'winter') ? 1 : 0;
    this.ovenFireMat.uniforms.uTime.value = t;

    const windStrength =
      this.world.weather === 'storm'
        ? 0.92
        : this.world.weather === 'blossom'
          ? 0.56
          : this.world.weather === 'rain'
            ? 0.48
            : this.world.weather === 'snow'
              ? 0.42
            : 0.24;

    // Update shared volumetric chimney woodsmoke uniforms (world-aligned wind & solar lighting)
    const breezeAngle = Math.sin(t * 0.18) * 0.45 + 0.55;
    const breezeSpeed = 0.22 + windStrength * 0.72;
    const windX = Math.cos(breezeAngle) * breezeSpeed;
    const windZ = Math.sin(breezeAngle) * breezeSpeed;
    this.chimneySmokeMat.uniforms.uTime.value = t;
    (this.chimneySmokeMat.uniforms.uWind.value as THREE.Vector2).set(windX, windZ);
    this.chimneySmokeMat.uniforms.uDaylight.value = daylight;
    (this.chimneySmokeMat.uniforms.uSunDir.value as THREE.Vector3)
      .set(sunX, Math.max(0.25, Math.abs(sunY)), 0.42)
      .normalize();

    // Synchronize physically-based fountain water shaders (caustics, waves, jets, volumetric mist, particles)
    this.fountainWater.update(t, daylight, nightGlow, windX, windZ, sunX, sunY, sky);

    for (const hearth of this.hearths) {
      hearth.fire.update(t, nightGlow, windStrength);
      hearth.banner.rotation.y = Math.sin(t * (2.2 + windStrength * 1.4) + hearth.seed) * (0.14 + windStrength * 0.12);

      // Reveal vibrant plaza bunting, paper lanterns & floating sky lanterns during festivals/events/holidays
      const cel = this.world.festivals.getVenueCelebration(hearth.settlementId);
      hearth.festivalDecor.visible = cel !== undefined;
      if (cel) {
        hearth.festivalPrimaryMat.color.setHex(cel.colorHex);
        hearth.festivalPrimaryMat.emissive.setHex(cel.colorHex);
        hearth.festivalPrimaryMat.emissiveIntensity = 0.22 + nightGlow * 0.18;
        hearth.festivalSecondaryMat.color.setHex(cel.secondaryColorHex);
        hearth.festivalSecondaryMat.emissive.setHex(cel.secondaryColorHex);
        hearth.festivalSecondaryMat.emissiveIntensity = 0.22 + nightGlow * 0.18;

        hearth.festivalLanternMat.uniforms.uTime.value = t;
        (hearth.festivalLanternMat.uniforms.uColorA.value as THREE.Color).setHex(cel.colorHex);
        (hearth.festivalLanternMat.uniforms.uColorB.value as THREE.Color).setHex(cel.secondaryColorHex);
        hearth.festivalLanternMat.uniforms.uHeightScale.value =
          cel.scope === 'national' ? 1.55 : cel.scope === 'regional' ? 1.25 : 0.95;

        const showCrown = cel.scope === 'regional' || cel.scope === 'national';
        hearth.festivalCrown.visible = showCrown;
        if (showCrown) {
          hearth.festivalCrown.rotation.y = t * (cel.scope === 'national' ? 0.9 : 0.55);
          hearth.festivalCrown.position.y =
            (cel.scope === 'national' ? 5.6 : 4.9) + Math.sin(t * 2.1 + hearth.seed) * 0.22;
        }
      }
    }

    // Assign the fixed pool of hearth PointLights to the closest settlements to the camera focus
    const hearthCount = this.hearths.length;
    if (hearthCount > 0) {
      const candidates = this.hearthSortScratch;
      candidates.length = hearthCount;
      const fx = focusTarget?.x ?? 0;
      const fz = focusTarget?.z ?? 0;
      for (let i = 0; i < hearthCount; i++) {
        const h = this.hearths[i];
        const dx = h.position.x - fx;
        const dz = h.position.z - fz;
        const distSq = focusTarget ? dx * dx + dz * dz : i;
        if (candidates[i]) {
          candidates[i].hearth = h;
          candidates[i].distSq = distSq;
        } else {
          candidates[i] = { hearth: h, distSq };
        }
      }
      if (focusTarget && hearthCount > HEARTH_LIGHT_POOL_SIZE) {
        candidates.sort((a, b) => a.distSq - b.distSq);
      }
      const activeSlots = Math.min(HEARTH_LIGHT_POOL_SIZE, hearthCount);
      for (let i = 0; i < HEARTH_LIGHT_POOL_SIZE; i++) {
        const poolLight = this.hearthLightPool[i];
        if (i < activeSlots) {
          const entry = candidates[i];
          const src = entry.hearth.fire.light;
          const edgeFade = focusTarget
            ? 1 - THREE.MathUtils.smoothstep(Math.sqrt(entry.distSq), 95, 140)
            : 1;
          poolLight.position.copy(entry.hearth.position).add(src.position);
          poolLight.color.copy(src.color);
          poolLight.intensity = src.intensity * edgeFade;
        } else {
          poolLight.intensity = 0;
        }
      }
    }

    // Animate shrine crystals, rune rings, workshop wheels, windmill rotors, fountain jets, swaying signs & smoke
    for (const settlement of this.world.settlements) {
      for (const b of settlement.buildings) {
        const entry = this.buildingMeshes.get(b.id);
        if (!entry) continue;

        this.applyConstructionStageVisuals(entry, b);

        if (entry.crystalMesh) {
          entry.crystalMesh.rotation.y += dt * 1.1;
          entry.crystalMesh.position.y = 2.65 + Math.sin(t * 2.3) * 0.16;
        }
        if (entry.runeRingA) {
          entry.runeRingA.rotation.z += dt * 0.9;
          entry.runeRingA.rotation.x = Math.PI / 3 + Math.sin(t * 1.1) * 0.2;
        }
        if (entry.runeRingB) {
          entry.runeRingB.rotation.z -= dt * 0.7;
          entry.runeRingB.rotation.y = Math.cos(t * 0.9) * 0.4;
        }
        if (entry.wheelMesh && b.completed) {
          entry.wheelMesh.rotation.x += dt * 0.85;
        }
        if (entry.floatGroup && b.completed) {
          entry.floatGroup.position.y = Math.sin(t * 1.45 + b.position.x * 0.37) * 0.055;
          entry.floatGroup.rotation.z = Math.sin(t * 1.05 + b.position.z * 0.29) * 0.025;
        }
        if (entry.rotorMesh && b.completed) {
          entry.rotorMesh.rotation.z -= dt * 0.62;
        }
        if (entry.fountainJet && b.completed) {
          // Subtle natural hydraulic pressure breathing (fine surface turbulence is driven on GPU)
          const shimmerY = 0.992 + Math.sin(t * 5.8 + b.position.x) * 0.016;
          const shimmerR = 0.996 + Math.cos(t * 4.6 + b.position.z) * 0.01;
          entry.fountainJet.scale.set(shimmerR, shimmerY, shimmerR);
        }
        if (entry.fountainMist) {
          entry.fountainMist.visible = b.completed;
        }
        if (entry.fountainSpray) {
          entry.fountainSpray.visible = b.completed;
        }
        if (entry.swayPart) {
          entry.swayPart.rotation.z = Math.sin(t * 2.1 + b.position.x) * 0.11;
        }
        if (entry.chimneySmokes) {
          for (const plume of entry.chimneySmokes) {
            plume.visible = b.completed;
          }
        }
      }
    }

    // Reveal creature-constructed bridges progressively from home bank across the stream
    for (const bridge of this.world.bridges) {
      const entry = this.bridgeMeshes.get(bridge.id);
      if (!entry) continue;
      if (entry.lastAppliedProgress === bridge.progress && entry.lastAppliedCompleted === bridge.completed) continue;
      entry.lastAppliedProgress = bridge.progress;
      entry.lastAppliedCompleted = bridge.completed;
      const frac = bridge.completed ? 1.05 : Math.max(0.08, bridge.progress / 100);
      for (const stage of entry.stages) {
        stage.obj.visible = stage.t <= frac;
      }
      for (const lantern of entry.lanterns) {
        lantern.visible = bridge.completed;
      }
    }

    this.syncWarBanners(t, windStrength);
  }

  private syncWarBanners(t: number, windStrength: number): void {
    const activeIds = new Set<string>();
    for (const war of this.world.wars.activeWars) {
      activeIds.add(war.id);
      let marker = this.warBanners.get(war.id);
      if (!marker) {
        marker = this.createWarBannerMarker(war);
        this.warBanners.set(war.id, marker);
        this.rootGroup.add(marker.group);
      }
      const flutter = 0.22 + windStrength * 0.16;
      const speed = 3.6 + windStrength * 2.1;
      marker.flagA.rotation.y = Math.sin(t * speed) * flutter;
      marker.flagB.rotation.y = Math.sin(t * speed + 1.9) * flutter;
      const engaged = war.phase === 'engaged';
      marker.ringMat.opacity = engaged
        ? 0.24 + 0.14 * Math.sin(t * 4.2)
        : 0.12 + 0.04 * Math.sin(t * 2.0);
    }

    for (const [warId, marker] of this.warBanners.entries()) {
      if (activeIds.has(warId)) continue;
      this.disposeWarBannerMarker(marker);
      this.warBanners.delete(warId);
    }
  }

  private createWarBannerMarker(war: ActiveWar): RenderedWarBanner {
    const group = new THREE.Group();
    group.name = `war_battlefield_${war.id}`;
    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];

    const sA = this.world.getSettlement(war.settlementAId);
    const sB = this.world.getSettlement(war.settlementBId);
    const colorA = sA?.bannerColor ?? 0xc83e3e;
    const colorB = sB?.bannerColor ?? 0x3b6ea5;

    const poleGeo = new THREE.CylinderGeometry(0.06, 0.085, 4.2, 8);
    const crossGeo = new THREE.CylinderGeometry(0.036, 0.036, 1.35, 6);
    const finialGeo = new THREE.ConeGeometry(0.11, 0.36, 6);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.55, 0.14);
    flagShape.lineTo(1.22, 0.44);
    flagShape.lineTo(1.55, 0.74);
    flagShape.lineTo(0, 0.88);
    flagShape.closePath();
    const flagGeo = new THREE.ShapeGeometry(flagShape);
    ownedGeometries.push(poleGeo, crossGeo, finialGeo, flagGeo);

    const buildStandard = (
      pos: { x: number; z: number },
      yaw: number,
      bannerColor: number,
      name: string,
    ): THREE.Object3D => {
      const stand = new THREE.Group();
      stand.name = name;
      const y = this.world.terrain.getHeightAt(pos.x, pos.z);
      stand.position.set(pos.x, y, pos.z);
      stand.rotation.y = yaw;

      const pole = new THREE.Mesh(poleGeo, this.darkTimberMat);
      pole.position.y = 2.05;
      pole.castShadow = true;
      stand.add(pole);

      const cross = new THREE.Mesh(crossGeo, this.darkTimberMat);
      cross.rotation.z = Math.PI / 2;
      cross.position.set(0.42, 3.85, 0);
      stand.add(cross);

      const finial = new THREE.Mesh(finialGeo, this.brassMat);
      finial.position.y = 4.32;
      stand.add(finial);

      const flagMat = new THREE.MeshStandardMaterial({
        color: bannerColor,
        emissive: bannerColor,
        emissiveIntensity: 0.18,
        roughness: 0.68,
        side: THREE.DoubleSide,
      });
      ownedMaterials.push(flagMat);
      const flagPivot = new THREE.Group();
      flagPivot.position.set(0.06, 2.98, 0);
      const flagMesh = new THREE.Mesh(flagGeo, flagMat);
      flagMesh.castShadow = true;
      flagPivot.add(flagMesh);
      stand.add(flagPivot);
      group.add(stand);
      return flagPivot;
    };

    const axisYaw = Math.atan2(war.frontB.x - war.frontA.x, war.frontB.z - war.frontA.z);
    const flagA = buildStandard(war.frontA, axisYaw, colorA, 'war_standard_a');
    const flagB = buildStandard(war.frontB, axisYaw + Math.PI, colorB, 'war_standard_b');

    const ringGeo = new THREE.RingGeometry(5.6, 6.25, 36);
    ringGeo.rotateX(-Math.PI / 2);
    ownedGeometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd94b38,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    ownedMaterials.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const bfY = this.world.terrain.getHeightAt(war.battlefield.x, war.battlefield.z);
    ring.position.set(war.battlefield.x, bfY + 0.12, war.battlefield.z);
    group.add(ring);

    return { group, flagA, flagB, ring, ringMat, ownedMaterials, ownedGeometries };
  }

  private disposeWarBannerMarker(marker: RenderedWarBanner): void {
    this.rootGroup.remove(marker.group);
    for (const g of marker.ownedGeometries) g.dispose();
    for (const m of marker.ownedMaterials) m.dispose();
  }

  /**
   * Updates a building's 5-stage visual state:
   * 0-18% clearing (staked clearing & felled brush) ->
   * 18-36% leveling (leveled earthen terrace pad & grading stakes) ->
   * 36-56% foundation (rising stone/brick plinth & material stacks) ->
   * 56-80% framing (timber frame/rafters OR rising masonry courses + scaffolding) ->
   * 80-100% finishing (enclosed walls, roof, windows, doors, lanterns, sails) ->
   * 100% completed (scaffolding removed). Disassembling steps backward from 100 -> 0.
   */
  private applyConstructionStageVisuals(entry: RenderedBuilding, b: BuildingInstance): void {
    const disassembling = Boolean(b.disassembling);
    const p = b.completed && !disassembling ? 100 : THREE.MathUtils.clamp(b.progress, 0, 100);
    if (
      entry.lastAppliedProgress === p &&
      entry.lastAppliedCompleted === b.completed &&
      entry.lastAppliedDisassembling === disassembling
    ) {
      return;
    }
    entry.lastAppliedProgress = p;
    entry.lastAppliedCompleted = b.completed;
    entry.lastAppliedDisassembling = disassembling;
    const stage = getBuildingStage(b);

    // Stage 1: Clearing land (0-18%, and kept lightly visible at low leveling)
    entry.clearingGroup.visible = !b.completed && p < 24;
    if (entry.clearingGroup.visible) {
      const clearFrac = p < 18 ? 1.0 : Math.max(0.25, 1.0 - (p - 18) / 6);
      entry.clearingGroup.scale.set(1, clearFrac, 1);
    }

    // Stage 2: Leveled earthen terrace pad (rises 18-36%, remains grounded underneath completed building)
    const showPad = b.completed || p >= 16;
    entry.levelingPad.visible = showPad;
    if (showPad) {
      const padLift = b.completed ? 1.0 : THREE.MathUtils.clamp((p - 16) / 18, 0.2, 1.0);
      entry.levelingPad.scale.set(1, padLift, 1);
    }
    entry.levelingExtras.visible = !b.completed && p >= 18 && p < 38;

    // Stage 3: Foundation plinth & staged masonry/timber piles (36-80%, subsumed once finished shell appears)
    const showFoundation = !b.completed && p >= 35 && p < 84;
    entry.foundationGroup.visible = showFoundation;
    if (showFoundation) {
      const fScale = THREE.MathUtils.clamp((p - 35) / 20, 0.16, 1.0);
      entry.foundationGroup.scale.set(1, fScale, 1);
    }

    // Stage 4: Rising timber frame OR stone/brick masonry wall courses (56-84%)
    const showFraming = !b.completed && p >= 55 && p < 88;
    for (const part of entry.framingParts) {
      part.obj.visible = showFraming && p >= part.revealAt;
    }

    // Builders' wooden scaffolding & ladder during framing, finishing, and disassembly
    entry.scaffoldingGroup.visible =
      !b.completed && (p >= 54 || (stage === 'disassembling' && p >= 36));

    // Stage 5: Finished structural shell (78-86%), roofs (86-92%), and exterior features (92-99%)
    const normP = p / 100;
    for (const part of entry.finishedParts) {
      part.obj.visible = (b.completed && !b.disassembling) || normP >= part.revealAt;
    }
  }

  private syncAll(): void {
    let totalBuildings = 0;
    for (let i = 0; i < this.world.settlements.length; i++) {
      totalBuildings += this.world.settlements[i].buildings.length;
    }
    if (
      this.world.structureRevision === this.lastSyncedStructureRevision &&
      this.world.settlements.length === this.lastSyncedSettlementCount &&
      totalBuildings === this.lastSyncedBuildingCount &&
      this.world.bridges.length === this.lastSyncedBridgeCount
    ) {
      return;
    }
    this.lastSyncedStructureRevision = this.world.structureRevision;
    this.lastSyncedSettlementCount = this.world.settlements.length;
    this.lastSyncedBuildingCount = totalBuildings;
    this.lastSyncedBridgeCount = this.world.bridges.length;

    const liveBuildingIds = this.liveBuildingIdsScratch;
    liveBuildingIds.clear();
    for (const settlement of this.world.settlements) {
      if (!this.settlementFlags.has(settlement.id)) {
        this.settlementFlags.add(settlement.id);
        this.createSettlementCenterpiece(settlement);
      }

      for (const b of settlement.buildings) {
        liveBuildingIds.add(b.id);
        if (!this.buildingMeshes.has(b.id)) {
          const built = this.createBuildingMesh(b, settlement.bannerColor, settlement.adaptation);
          this.buildingMeshes.set(b.id, built);
          this.rootGroup.add(built.group);
          this.applyConstructionStageVisuals(built, b);
        }
      }
    }

    // Cleanly remove & dispose meshes for disassembled buildings
    const sharedGeos = this.sharedGeos;
    for (const [id, entry] of this.buildingMeshes) {
      if (!liveBuildingIds.has(id)) {
        this.rootGroup.remove(entry.group);
        entry.group.traverse((obj) => {
          if ((obj instanceof THREE.Mesh || obj instanceof THREE.Points) && obj.geometry && !sharedGeos.has(obj.geometry)) {
            obj.geometry.dispose();
          }
        });
        for (const mat of entry.ownedMaterials) {
          mat.dispose();
        }
        this.buildingMeshes.delete(id);
      }
    }

    for (const bridge of this.world.bridges) {
      if (!this.bridgeMeshes.has(bridge.id)) {
        const built = this.createBridgeMesh(bridge);
        this.bridgeMeshes.set(bridge.id, built);
        this.rootGroup.add(built.group);
      }
    }
  }

  private createSettlementCenterpiece(settlement: Settlement): void {
    const group = new THREE.Group();
    group.position.set(settlement.center.x, settlement.groundY, settlement.center.z);
    group.userData.selectionTarget = { kind: 'settlement', id: settlement.id };

    const add = <T extends THREE.Object3D>(obj: T): T => {
      obj.userData.selectionTarget = { kind: 'settlement', id: settlement.id };
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      group.add(obj);
      return obj;
    };

    const adaptation = settlement.adaptation;
    const plazaMat =
      adaptation === 'riverside_stilts' ||
      adaptation === 'coastal_harbor' ||
      adaptation === 'waterway_haven'
        ? this.driftwoodMat
        : adaptation === 'mountain_stone'
          ? this.graniteMat
          : adaptation === 'desert_oasis'
            ? this.terracottaPlasterMat
            : this.stoneMat;
    const plazaY =
      adaptation === 'riverside_stilts' ||
      adaptation === 'coastal_harbor' ||
      adaptation === 'waterway_haven'
        ? 0.26
        : 0.06;

    // Regional hearth plaza deck / terrace + curb stones
    const plaza = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(2.8, 3.05, adaptation === 'mountain_stone' ? 0.85 : 0.22, 24),
        plazaMat,
      ),
    );
    plaza.position.y = adaptation === 'mountain_stone' ? -0.25 : plazaY;

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const curb = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.28), plazaMat));
      curb.position.set(Math.cos(a) * 2.7, plazaY + 0.09, Math.sin(a) * 2.7);
      curb.rotation.y = -a + Math.PI / 2;
    }

    // Chunky cobblestone firepit ring cradling the glowing ember bed
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rock = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 1), this.stoneMat));
      rock.scale.set(1.16, 0.72, 1.02);
      rock.position.set(Math.cos(a) * 0.66, 0.24, Math.sin(a) * 0.66);
    }

    // Naturally stacked charred split-timber firewood arranged in a teepee/star campfire lay
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + 0.25;
      const radiusTop = 0.055 + (i % 2) * 0.014;
      const radiusBot = 0.082 + (i % 3) * 0.01;
      const length = 0.76 + (i % 2) * 0.12;
      const log = add(new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBot, length, 8), this.charredLogMat));
      log.position.set(Math.cos(angle) * 0.24, 0.29 + (i % 2) * 0.025, Math.sin(angle) * 0.24);
      log.rotation.order = 'YXZ';
      log.rotation.y = -angle + Math.PI / 2 + (i % 2 === 0 ? 0.15 : -0.13);
      log.rotation.x = -(0.98 + (i % 3) * 0.09);
    }

    // Volumetric procedural campfire: glowing coal bed, multi-layered turbulent blackbody flames,
    // spiraling rising sparks, wispy smoke plume, and dynamic dancing firelight
    const seed = settlement.center.x * 0.3 + settlement.center.z * 0.7;
    const fire = new HearthFire(seed, this.sharedFlameGeo, false);
    fire.group.userData.selectionTarget = { kind: 'settlement', id: settlement.id };
    group.add(fire.group);

    // Carved woodland banner post with arm, dangling glowing fairy lantern & swallowtail banner
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 4.6, 10), this.timberMat));
    pole.position.set(1.25, 2.3, 0.8);

    const finial = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.brassMat));
    finial.position.set(1.25, 4.65, 0.8);

    const crossArm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), this.timberMat));
    crossArm.rotation.z = Math.PI / 2;
    crossArm.position.set(1.82, 4.15, 0.8);

    const bannerMat = new THREE.MeshStandardMaterial({
      color: settlement.bannerColor,
      roughness: 0.76,
      side: THREE.DoubleSide,
    });
    this.extraDisposables.push(bannerMat);

    const bShape = new THREE.Shape();
    bShape.moveTo(0, 0);
    bShape.lineTo(1.15, 0);
    bShape.lineTo(1.15, -1.65);
    bShape.lineTo(0.58, -1.25);
    bShape.lineTo(0, -1.65);
    bShape.closePath();
    const bannerGeo = new THREE.ShapeGeometry(bShape);
    this.extraDisposables.push(bannerGeo);

    const banner = add(new THREE.Mesh(bannerGeo, bannerMat));
    banner.position.set(1.36, 4.12, 0.8);

    // Warm dangling lantern on opposite side of post
    const lanternArm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 6), this.darkTimberMat));
    lanternArm.rotation.z = Math.PI / 2;
    lanternArm.position.set(0.95, 3.25, 0.8);
    const lanternGlass = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.28, 8), this.windowMat));
    lanternGlass.position.set(0.66, 2.98, 0.8);
    const lanternCap = add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 8), this.brassMat));
    lanternCap.position.set(0.66, 3.16, 0.8);

    // Cozy timber bench beside the hearth
    const benchSeat = add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 0.42), this.timberMat));
    benchSeat.position.set(-1.35, 0.42, 0.95);
    benchSeat.rotation.y = 0.65;
    for (const lx of [-0.45, 0.45]) {
      const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.34), this.darkTimberMat));
      leg.position.set(-1.35 + lx * Math.cos(0.65), 0.22, 0.95 - lx * Math.sin(0.65));
      leg.rotation.y = 0.65;
    }

    // Unmistakable biome-adapted village centerpiece landmarks!
    if (adaptation === 'riverside_stilts') {
      // Heavy cedar stilt pilings & rope-wrapped mooring bollards beneath the riverside boardwalk plaza
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const piling = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 1.35, 8), this.driftwoodMat));
        piling.position.set(Math.cos(a) * 2.55, -0.35, Math.sin(a) * 2.55);
        if (i % 2 === 0) {
          const bollard = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.78, 8), this.tealTrimMat));
          bollard.position.set(Math.cos(a) * 2.78, 0.62, Math.sin(a) * 2.78);
        }
      }
      // Moored wooden reed-skiff boat docked beside the village boardwalk
      const skiff = new THREE.Group();
      skiff.position.set(-3.35, 0.18, -1.25);
      skiff.rotation.y = 0.55;
      const hull = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.35, 6, 10), this.driftwoodMat));
      hull.rotation.x = Math.PI / 2;
      hull.scale.set(1.15, 1.0, 0.45);
      skiff.add(hull);
      const thwart = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.24), this.tealTrimMat));
      thwart.position.set(0, 0.14, 0);
      skiff.add(thwart);
      const oar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 1.45, 6), this.timberMat));
      oar.rotation.x = Math.PI / 2;
      oar.rotation.z = 0.25;
      oar.position.set(0.14, 0.2, 0.1);
      skiff.add(oar);
      group.add(skiff);
    } else if (adaptation === 'coastal_harbor') {
      // Driftwood wharf pilings, harbor beacon lighthouse tower, and moored coastal sailboat!
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const piling = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.4, 8), this.driftwoodMat));
        piling.position.set(Math.cos(a) * 2.55, -0.35, Math.sin(a) * 2.55);
      }
      // Whitewashed coastal beacon lantern tower
      const beaconBase = add(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.64, 2.9, 12), this.plasterMat));
      beaconBase.position.set(2.35, 1.48, -1.35);
      const beaconBand = add(new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.56, 0.45, 12), this.tealTrimMat));
      beaconBand.position.set(2.35, 1.85, -1.35);
      const beaconGlow = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.55, 10), this.windowMat));
      beaconGlow.position.set(2.35, 3.18, -1.35);
      const beaconCap = add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.55, 10), this.slateRoofMat));
      beaconCap.position.set(2.35, 3.72, -1.35);

      // Moored coastal sailboat with cream canvas sail
      const boat = new THREE.Group();
      boat.position.set(-3.35, 0.22, -1.2);
      boat.rotation.y = 0.48;
      const hull = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.55, 6, 10), this.driftwoodMat));
      hull.rotation.x = Math.PI / 2;
      hull.scale.set(1.2, 1.0, 0.46);
      boat.add(hull);
      const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.3, 8), this.timberMat));
      mast.position.set(0, 1.15, 0.05);
      boat.add(mast);
      const sail = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, 1.15), this.ochreCanvasMat));
      sail.position.set(0.08, 1.28, -0.36);
      sail.rotation.y = 0.14;
      boat.add(sail);
      group.add(boat);
    } else if (adaptation === 'mountain_stone') {
      // Curved granite windbreak half-wall sheltering the alpine hearth from mountain gales
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.78 + (i / 5) * Math.PI * 0.78;
        const wallSeg = add(new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.28, 0.36), this.graniteMat));
        wallSeg.position.set(Math.cos(a) * 2.52, 0.66, Math.sin(a) * 2.52);
        wallSeg.rotation.y = -a + Math.PI / 2;
        const coping = add(new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.14, 0.44), this.slateRoofMat));
        coping.position.set(Math.cos(a) * 2.52, 1.34, Math.sin(a) * 2.52);
        coping.rotation.y = -a + Math.PI / 2;
      }
      // Dressed quarry granite blocks stacked beside the hearth
      for (let i = 0; i < 3; i++) {
        const blk = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.42), this.graniteMat));
        blk.position.set(2.15 - i * 0.22, 0.24 + (i === 2 ? 0.36 : 0), -1.55 + (i % 2) * 0.38);
        blk.rotation.y = i * 0.28;
      }
    } else if (adaptation === 'prairie_pastoral') {
      // Festive prairie-green bunting posts & raised wildflower/berry planter troughs
      const buntingColors = [this.flowerPinkMat, this.flowerGoldMat, this.flowerBlueMat];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.35;
        const px = Math.cos(a) * 2.78;
        const pz = Math.sin(a) * 2.78;
        const bPost = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.75, 8), this.timberMat));
        bPost.position.set(px, 1.38, pz);

        const nextA = ((i + 1) / 4) * Math.PI * 2 + 0.35;
        const nx = Math.cos(nextA) * 2.78;
        const nz = Math.sin(nextA) * 2.78;
        for (let k = 1; k <= 3; k++) {
          const f = k / 4;
          const flag = add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 3), buntingColors[(i + k) % 3]));
          flag.rotation.x = Math.PI;
          flag.position.set(
            THREE.MathUtils.lerp(px, nx, f),
            2.42 - Math.sin(f * Math.PI) * 0.28,
            THREE.MathUtils.lerp(pz, nz, f),
          );
        }
      }
      for (const side of [-1, 1]) {
        const planter = add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.38, 0.48), this.timberMat));
        planter.position.set(side * 2.15, 0.26, -1.65);
        planter.rotation.y = side * -0.45;
        const foliage = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), this.mossLeafMat));
        foliage.scale.set(1.75, 0.65, 0.85);
        foliage.position.set(side * 2.15, 0.52, -1.65);
      }
    } else if (adaptation === 'forest_canopy') {
      // Twin carved woodland spirit-totem posts with glowing fairy lanterns + toadstool fairy ring
      for (const side of [-1, 1]) {
        const tx = side * 2.25;
        const tz = -1.35;
        const totem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 3.1, 8), this.darkTimberMat));
        totem.position.set(tx, 1.55, tz);
        const mossCap = add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), this.mossRoofMat));
        mossCap.scale.set(1.1, 0.72, 1.1);
        mossCap.position.set(tx, 3.16, tz);
        const lantern = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.24, 8), this.windowMat));
        lantern.position.set(tx - side * 0.34, 2.48, tz + 0.15);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const cap = add(new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.14, 8), this.potteryMat));
        cap.position.set(Math.cos(a) * 2.95, 0.26, Math.sin(a) * 2.95);
      }
    } else if (adaptation === 'desert_oasis') {
      // Woven ochre canvas shade-pergola canopy, tiled oasis water cistern & clustered terracotta amphorae!
      const pergX = -1.65;
      const pergZ = -1.45;
      for (const [ox, oz] of [[-0.95, -0.75], [0.95, -0.75], [-0.95, 0.75], [0.95, 0.75]]) {
        const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 2.55, 8), this.timberMat));
        post.position.set(pergX + ox, 1.28, pergZ + oz);
      }
      const canopy = add(new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.08, 1.72), this.ochreCanvasMat));
      canopy.position.set(pergX, 2.58, pergZ);
      canopy.rotation.z = 0.08;
      // Striped terracotta trim along the canopy edge
      const trim = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.12), this.terracottaRoofMat));
      trim.position.set(pergX, 2.5, pergZ + 0.85);

      // Tiled desert oasis water cistern glistening beside the shade pergola
      const cisternRim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.38, 12), this.terracottaPlasterMat));
      cisternRim.position.set(2.35, 0.2, 1.15);
      const cisternWater = add(new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.32, 12), this.fountainWaterMat));
      cisternWater.position.set(2.35, 0.25, 1.15);

      // Clustered terracotta water amphorae conserving cool spring water
      for (let i = 0; i < 4; i++) {
        const ax = 1.95 + (i % 2) * 0.42;
        const az = -1.25 - Math.floor(i / 2) * 0.45;
        const amphora = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.terracottaRoofMat));
        amphora.scale.set(0.92, 1.38, 0.92);
        amphora.position.set(ax, 0.34, az);
        const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.2, 8), this.terracottaRoofMat));
        neck.position.set(ax, 0.65, az);
      }
    } else if (adaptation === 'waterway_haven') {
      // Aquatic Waterway Haven centerpiece: deep river pilings, beaver-dam lashed log raft,
      // giant floating lily pads & pink lotus blooms, glowing river-pearl lantern post & moored reed skiff!
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const piling = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.4, 8), this.beaverBranchMat));
        piling.position.set(Math.cos(a) * 2.75, -0.82, Math.sin(a) * 2.75);
      }
      // Interwoven beaver-dam perimeter logs hugging the raft deck
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const damLog = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.45, 7), this.beaverBranchMat));
        damLog.rotation.z = Math.PI / 2;
        damLog.rotation.y = -a + 0.25;
        damLog.position.set(Math.cos(a) * 2.85, 0.16 + (i % 2) * 0.09, Math.sin(a) * 2.85);
      }
      // Surrounding giant floating water-lily pads & pink lotus flowers
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        const dist = 3.55 + (i % 2) * 0.45;
        const padR = 0.62 + (i % 3) * 0.14;
        const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(padR, padR * 0.96, 0.06, 14), this.waterLilyMat));
        pad.position.set(Math.cos(a) * dist, 0.02, Math.sin(a) * dist);
        if (i % 2 === 0) {
          const lotus = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), this.lotusPinkMat));
          lotus.scale.set(1.15, 0.72, 1.15);
          lotus.position.set(Math.cos(a) * dist, 0.14, Math.sin(a) * dist);
        }
      }
      // Curved river-pearl lantern post illuminating the waterway plaza
      const lanternPost = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 3.15, 8), this.tealTrimMat));
      lanternPost.position.set(2.25, 1.58, 1.35);
      const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.08), this.driftwoodMat));
      arm.position.set(1.94, 2.96, 1.35);
      const pearlOrb = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), this.pearlGlowMat));
      pearlOrb.position.set(1.66, 2.74, 1.35);
      // Moored otter reed skiff tethered beside the plaza deck
      const skiff = new THREE.Group();
      skiff.position.set(-2.95, 0.08, 1.65);
      skiff.rotation.y = 0.72;
      const hull = add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), this.bambooMat));
      hull.scale.set(1.45, 0.72, 0.54);
      hull.position.y = 0.24;
      skiff.add(hull);
      const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.68), this.tealTrimMat));
      seat.position.set(0, 0.2, 0);
      skiff.add(seat);
      group.add(skiff);
    }

    // Toggleable festival decoration kit: 6 lantern posts, draped multi-colored bunting pennants,
    // floating sky lanterns, and a rotating ceremonial crown garland for regional/national occasions.
    const festivalDecor = new THREE.Group();
    festivalDecor.name = 'festival_decor';
    const festivalPrimaryMat = new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xffc857,
      emissiveIntensity: 0.25,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const festivalSecondaryMat = new THREE.MeshStandardMaterial({
      color: 0xff6b9d,
      emissive: 0xff6b9d,
      emissiveIntensity: 0.25,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const festivalLanternMat = createFestivalLanternMaterial();
    this.extraDisposables.push(festivalPrimaryMat, festivalSecondaryMat, festivalLanternMat);

    const postCount = 6;
    const postRadius = 3.55;
    const postHeight = 3.65;
    const postTops: THREE.Vector3[] = [];
    for (let i = 0; i < postCount; i++) {
      const ang = (i / postCount) * Math.PI * 2 + 0.22;
      const px = Math.cos(ang) * postRadius;
      const pz = Math.sin(ang) * postRadius;
      const fPost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, postHeight, 7),
        this.timberMat,
      );
      fPost.position.set(px, postHeight * 0.5 + plazaY, pz);
      fPost.castShadow = true;
      festivalDecor.add(fPost);

      // Glowing paper festival lantern perched atop each timber post
      const paperLantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 8),
        i % 2 === 0 ? festivalPrimaryMat : festivalSecondaryMat,
      );
      paperLantern.scale.set(1.0, 1.22, 1.0);
      paperLantern.position.set(px, postHeight + plazaY + 0.14, pz);
      festivalDecor.add(paperLantern);

      postTops.push(new THREE.Vector3(px, postHeight + plazaY - 0.18, pz));
    }

    // Draped bunting ropes + triangular colored pennants hanging between every pair of posts
    const pennantShape = new THREE.Shape();
    pennantShape.moveTo(-0.14, 0);
    pennantShape.lineTo(0.14, 0);
    pennantShape.lineTo(0, -0.32);
    pennantShape.closePath();
    const pennantGeo = new THREE.ShapeGeometry(pennantShape);
    this.extraDisposables.push(pennantGeo);

    for (let i = 0; i < postCount; i++) {
      const a = postTops[i];
      const b = postTops[(i + 1) % postCount];
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      mid.y -= 0.52;
      const curve = new THREE.CatmullRomCurve3([a, mid, b]);
      const ropeMesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 10, 0.018, 5, false),
        this.ropeMat,
      );
      festivalDecor.add(ropeMesh);

      const spanYaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      for (let p = 1; p <= 5; p++) {
        const pt = curve.getPoint(p / 6);
        const pennant = new THREE.Mesh(
          pennantGeo,
          (i + p) % 2 === 0 ? festivalPrimaryMat : festivalSecondaryMat,
        );
        pennant.position.copy(pt);
        pennant.rotation.y = spanYaw;
        festivalDecor.add(pennant);
      }
    }

    // Rotating ceremonial garland ring high above the square for Regional Events & National Holidays
    const festivalCrown = new THREE.Group();
    festivalCrown.name = 'festival_crown';
    const crownTorus = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.06, 8, 28),
      this.brassMat,
    );
    crownTorus.rotation.x = Math.PI / 2;
    festivalCrown.add(crownTorus);
    for (let k = 0; k < 8; k++) {
      const ka = (k / 8) * Math.PI * 2;
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        k % 2 === 0 ? festivalPrimaryMat : festivalSecondaryMat,
      );
      orb.position.set(Math.cos(ka) * 1.75, -0.18, Math.sin(ka) * 1.75);
      festivalCrown.add(orb);
    }
    festivalCrown.position.y = 5.1;
    festivalCrown.visible = false;
    festivalDecor.add(festivalCrown);

    // Floating glowing sky lanterns rising above the celebrating plaza
    const lanternsGeo = createFestivalLanternsGeometry(seed);
    const lanternsPoints = new THREE.Points(lanternsGeo, festivalLanternMat);
    lanternsPoints.renderOrder = 3;
    festivalDecor.add(lanternsPoints);

    festivalDecor.visible = false;
    group.add(festivalDecor);

    this.hearths.push({
      settlementId: settlement.id,
      fire,
      position: new THREE.Vector3(settlement.center.x, settlement.groundY, settlement.center.z),
      banner,
      seed,
      festivalDecor,
      festivalCrown,
      festivalPrimaryMat,
      festivalSecondaryMat,
      festivalLanternMat,
    });

    this.rootGroup.add(group);
  }

  /** Returns architectural materials whose shader programs should be pre-compiled behind the splash screen. */
  getWarmupMaterials(): THREE.Material[] {
    return [
      this.timberMat,
      this.darkTimberMat,
      this.plasterMat,
      this.warmPlasterMat,
      this.thatchMat,
      this.slateRoofMat,
      this.verdigrisMat,
      this.brickMat,
      this.glassMat,
      this.fountainWaterMat,
      ...this.fountainWater.getWarmupMaterials(),
      this.canvasSailMat,
      this.stoneMat,
      this.windowMat,
      this.shrineCrystalMat,
      this.brassMat,
      this.doorMat,
      this.mossLeafMat,
      this.flowerPinkMat,
      this.flowerGoldMat,
      this.flowerBlueMat,
      this.charredLogMat,
      this.ovenFireMat,
      this.potteryMat,
      this.earthPadMat,
      this.ropeMat,
      this.driftwoodMat,
      this.tealTrimMat,
      this.mossRoofMat,
      this.terracottaPlasterMat,
      this.terracottaRoofMat,
      this.ochreCanvasMat,
      this.goldenThatchMat,
      this.graniteMat,
      this.waterLilyMat,
      this.lotusPinkMat,
      this.coralMat,
      this.pearlGlowMat,
      this.bambooMat,
      this.beaverBranchMat,
    ];
  }

  private createBuildingMesh(
    b: BuildingInstance,
    bannerColor: number,
    adaptation: VillageAdaptationId = 'forest_canopy',
  ): RenderedBuilding {
    const group = new THREE.Group();
    group.position.set(b.position.x, b.groundY - 0.05, b.position.z);
    group.rotation.y = b.rotation;
    // Subtle organic architectural scale variety so neighborhoods feel hand-crafted
    const variantHash = Math.abs(Math.sin(b.position.x * 12.9898 + b.position.z * 78.233));
    const widthScale = 0.94 + variantHash * 0.14;
    group.scale.set(widthScale, 1.0, widthScale);
    group.userData.selectionTarget = { kind: 'building', id: b.id };

    const blueprint = BUILDING_CATALOG[b.type];
    const bannerMat = new THREE.MeshStandardMaterial({
      color: bannerColor,
      roughness: 0.74,
      side: THREE.DoubleSide,
    });
    const ownedMaterials: THREE.Material[] = [bannerMat];

    // Dedicated group holding the final finished architecture so we can cleanly separate construction kit & exterior stages
    const finishedGroup = new THREE.Group();
    finishedGroup.userData.selectionTarget = { kind: 'building', id: b.id };
    group.add(finishedGroup);

    const isStiltRaised =
      (adaptation === 'riverside_stilts' || adaptation === 'coastal_harbor') &&
      b.type !== 'fountain_plaza' &&
      b.type !== 'shrine';
    const stiltLift = isStiltRaised ? 0.68 : 0;
    if (isStiltRaised) {
      // Lift the finished structure onto pilings while keeping local building part coordinates intact!
      finishedGroup.position.y = stiltLift;
    }

    // Select biome-adapted wall plaster, stonework, and roofing palettes so each village is unmistakable
    const wallPlaster =
      adaptation === 'desert_oasis'
        ? this.terracottaPlasterMat
        : adaptation === 'prairie_pastoral' || adaptation === 'coastal_harbor'
          ? this.plasterMat
          : adaptation === 'mountain_stone'
            ? variantHash > 0.55
              ? this.plasterMat
              : this.warmPlasterMat
            : variantHash > 0.5
              ? this.warmPlasterMat
              : this.plasterMat;
    const primaryRoofMat =
      adaptation === 'mountain_stone' || adaptation === 'coastal_harbor'
        ? this.slateRoofMat
        : adaptation === 'desert_oasis'
          ? this.terracottaRoofMat
          : adaptation === 'forest_canopy'
            ? this.mossRoofMat
            : adaptation === 'prairie_pastoral'
              ? this.goldenThatchMat
              : variantHash > 0.45
                ? this.mossRoofMat
                : this.thatchMat;
    const altRoofMat =
      adaptation === 'riverside_stilts'
        ? this.mossRoofMat
        : primaryRoofMat;

    let crystalMesh: THREE.Mesh | undefined;
    let runeRingA: THREE.Mesh | undefined;
    let runeRingB: THREE.Mesh | undefined;
    let wheelMesh: THREE.Object3D | undefined;
    let rotorMesh: THREE.Object3D | undefined;
    let fountainJet: THREE.Object3D | undefined;
    let fountainMist: THREE.Object3D | undefined;
    let fountainSpray: THREE.Points | undefined;
    let swayPart: THREE.Object3D | undefined;
    let floatGroup: THREE.Object3D | undefined;
    const chimneySmokes: THREE.Points[] = [];

    const tag = <T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = finishedGroup): T => {
      obj.userData.selectionTarget = { kind: 'building', id: b.id };
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      parent.add(obj);
      return obj;
    };

    const addMullionedWindow = (x: number, y: number, z: number, rotY = 0, w = 0.52, h = 0.58) => {
      const holder = new THREE.Group();
      holder.position.set(x, y, z);
      holder.rotation.y = rotY;
      holder.userData.buildPhase = 'exterior';

      const glass = tag(new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.windowMat), holder);
      glass.position.z = 0.02;

      const frameH = tag(new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.07, 0.07), this.darkTimberMat), holder);
      frameH.position.set(0, h * 0.5 + 0.02, 0.03);
      const sill = tag(new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.09, 0.14), this.timberMat), holder);
      sill.position.set(0, -h * 0.5 - 0.03, 0.05);
      const mullV = tag(new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.06), this.darkTimberMat), holder);
      mullV.position.z = 0.03;
      const mullH = tag(new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.06), this.darkTimberMat), holder);
      mullH.position.z = 0.03;

      for (const sx of [-1, 1]) {
        const shutter = tag(new THREE.Mesh(new THREE.BoxGeometry(0.18, h, 0.05), bannerMat), holder);
        shutter.position.set(sx * (w * 0.5 + 0.12), 0, 0.03);
      }

      const box = tag(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.14, 0.18), this.timberMat), holder);
      box.position.set(0, -h * 0.5 - 0.12, 0.12);
      const fMats = [this.flowerPinkMat, this.flowerGoldMat, this.flowerBlueMat];
      for (let i = -1; i <= 1; i++) {
        const bush = tag(new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 6), this.mossLeafMat), holder);
        bush.position.set(i * 0.16, -h * 0.5 - 0.02, 0.13);
        const blossom = tag(new THREE.Mesh(new THREE.SphereGeometry(0.048, 6, 6), fMats[(i + 2) % 3]), holder);
        blossom.position.set(i * 0.16, -h * 0.5 + 0.03, 0.16);
      }

      finishedGroup.add(holder);
    };

    const addHangingLantern = (x: number, y: number, z: number) => {
      const glass = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.22, 8), this.windowMat));
      glass.position.set(x, y, z);
      glass.userData.buildPhase = 'exterior';
      const cap = tag(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 8), this.brassMat));
      cap.position.set(x, y + 0.15, z);
      cap.userData.buildPhase = 'exterior';
    };

    const addChimneySmoke = (x: number, y: number, z: number) => {
      const seed = b.position.x * 0.37 + b.position.z * 0.53 + chimneySmokes.length * 3.17;
      const smokeGeo = createChimneySmokeGeometry(seed, 16);
      const plume = new THREE.Points(smokeGeo, this.chimneySmokeMat);
      plume.position.set(x, y + stiltLift - 0.06, z);
      // Counter-rotate so local XZ matches world wind direction across all buildings
      plume.rotation.y = -b.rotation;
      plume.renderOrder = 3;
      plume.visible = b.completed;
      group.add(plume);
      chimneySmokes.push(plume);
    };

    const type: BuildingType = b.type;
    if (type === 'burrow_cottage') {
      const plinth = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.59, 1.72, 0.4, 20), this.stoneMat));
      plinth.position.y = 0.2;

      const body = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.58, 1.45, 20), wallPlaster));
      body.position.y = 1.05;

      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.48, 8), this.darkTimberMat));
        post.position.set(Math.cos(a) * 1.52, 1.05, Math.sin(a) * 1.52);
      }

      const roof = tag(new THREE.Mesh(this.bellRoofGeo, primaryRoofMat));
      roof.position.y = 1.74;

      const knob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), this.timberMat));
      knob.position.y = 3.58;

      const chimney = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 1.55, 8), this.stoneMat));
      chimney.position.set(0.82, 2.55, -0.38);
      chimney.rotation.z = -0.1;
      const pot = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.28, 10), this.potteryMat));
      pot.position.set(0.89, 3.38, -0.38);
      addChimneySmoke(0.9, 3.55, -0.38);

      const doorFrame = tag(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.085, 10, 20), this.darkTimberMat));
      doorFrame.position.set(0, 0.94, 1.58);
      const door = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.1, 20), bannerMat));
      door.rotation.x = Math.PI / 2;
      door.position.set(0, 0.94, 1.56);
      const doorknob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.brassMat));
      doorknob.position.set(0.18, 0.94, 1.64);
      // Front stone threshold step raised cleanly above the earthen leveling pad (y=0.10) to prevent z-fighting
      const doorstep = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.76, 0.22, 14), this.stoneMat));
      doorstep.position.set(0, 0.12, 1.84);

      addMullionedWindow(1.36, 1.12, 0.72, Math.PI / 3, 0.44, 0.44);
      addMullionedWindow(-1.36, 1.12, 0.72, -Math.PI / 3, 0.44, 0.44);
      addHangingLantern(0.68, 1.48, 1.64);
    } else if (type === 'timber_house') {
      const base = tag(new THREE.Mesh(new THREE.BoxGeometry(2.55, 1.4, 2.15), this.stoneMat));
      base.position.y = 0.7;

      const upper = tag(new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.5, 2.45), wallPlaster));
      upper.position.y = 2.12;

      for (const sx of [-1.42, 0, 1.42]) {
        for (const sz of [-1.22, 1.22]) {
          const beam = tag(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.55, 0.14), this.darkTimberMat));
          beam.position.set(sx, 2.12, sz);
        }
      }
      for (const sy of [1.4, 2.86]) {
        const horizF = tag(new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.14, 0.14), this.darkTimberMat));
        horizF.position.set(0, sy, 1.24);
        const horizB = tag(new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.14, 0.14), this.darkTimberMat));
        horizB.position.set(0, sy, -1.24);
      }

      const roof = tag(new THREE.Mesh(this.gableRoofGeo, altRoofMat));
      roof.position.y = 2.84;
      const ridge = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.25, 8), this.darkTimberMat));
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = 4.56;

      const chimney = tag(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.6, 0.45), this.stoneMat));
      chimney.position.set(0.85, 4.1, -0.55);
      addChimneySmoke(0.85, 4.98, -0.55);

      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.12, 0.12), this.doorMat));
      door.position.set(0, 0.58, 1.08);
      const knob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), this.brassMat));
      knob.position.set(0.22, 0.56, 1.16);
      const awning = tag(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.58), this.timberMat));
      awning.position.set(0, 1.28, 1.32);
      awning.rotation.x = 0.25;

      addMullionedWindow(-0.74, 2.16, 1.24, 0, 0.52, 0.58);
      addMullionedWindow(0.74, 2.16, 1.24, 0, 0.52, 0.58);
      addHangingLantern(0.66, 1.12, 1.48);
    } else if (type === 'granary') {
      for (const [sx, sz] of [[-0.86, -0.86], [0.86, -0.86], [-0.86, 0.86], [0.86, 0.86]]) {
        const footing = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.24, 8), this.stoneMat));
        footing.position.set(sx, 0.12, sz);
        const stilt = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.92, 10), this.darkTimberMat));
        stilt.position.set(sx, 0.62, sz);
      }

      for (let i = 0; i < 3; i++) {
        const sack = tag(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), this.plasterMat));
        sack.scale.set(1.1, 0.78, 0.92);
        sack.position.set(-0.25 + i * 0.3, 0.22, 0.15 - (i % 2) * 0.28);
      }

      const silo = tag(new THREE.Mesh(this.acornSiloGeo, this.timberMat));
      silo.position.y = 0.98;

      for (const hy of [1.55, 2.25, 2.85]) {
        const hoop = tag(new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.045, 8, 24), this.darkTimberMat));
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = hy;
      }

      const cap = tag(new THREE.Mesh(this.bellRoofGeo, primaryRoofMat));
      cap.scale.set(0.92, 0.88, 0.92);
      cap.position.y = 3.16;

      const stem = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.45, 8), this.darkTimberMat));
      stem.position.set(0.04, 4.88, 0);
      stem.rotation.z = -0.18;

      for (const lx of [-0.22, 0.22]) {
        const rail = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 6), this.darkTimberMat));
        rail.position.set(lx, 0.78, 1.52);
        rail.rotation.x = -0.22;
      }
      for (let r = 0; r < 5; r++) {
        const rung = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 6), this.timberMat));
        rung.rotation.z = Math.PI / 2;
        rung.position.set(0, 0.28 + r * 0.26, 1.62 - r * 0.055);
      }
      addHangingLantern(0, 2.7, 1.52);
    } else if (type === 'market_stall') {
      const counter = tag(new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.9, 1.32), this.timberMat));
      counter.position.y = 0.45;
      const counterTop = tag(new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.12, 1.48), this.darkTimberMat));
      counterTop.position.y = 0.94;

      for (const [sx, sz] of [[-1.18, -0.52], [1.18, -0.52], [-1.18, 0.52], [1.18, 0.52]]) {
        const h = sz < 0 ? 2.4 : 2.15;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, h, 8), this.darkTimberMat));
        post.position.set(sx, h * 0.5, sz);
      }

      for (let i = 0; i < 5; i++) {
        const stripeMat = i % 2 === 0 ? bannerMat : this.plasterMat;
        const panel = tag(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 1.88), stripeMat));
        panel.position.set(-1.16 + i * 0.58, 2.34, 0.05);
        panel.rotation.x = 0.2;

        const scallop = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12), stripeMat));
        scallop.rotation.x = Math.PI / 2;
        scallop.position.set(-1.16 + i * 0.58, 2.04, 0.96);
      }

      const basketColors = [this.flowerPinkMat, this.flowerGoldMat, this.flowerBlueMat];
      for (let i = 0; i < 3; i++) {
        const bx = -0.82 + i * 0.62;
        const basket = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.28, 12), this.thatchMat));
        basket.position.set(bx, 1.14, 0.1);
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * Math.PI * 2;
          const fruit = tag(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), basketColors[i]));
          fruit.position.set(bx + Math.cos(a) * 0.09, 1.3, 0.1 + Math.sin(a) * 0.09);
        }
      }
      const jar = tag(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), this.potteryMat));
      jar.scale.set(1, 1.35, 1);
      jar.position.set(0.95, 1.18, -0.1);
      addHangingLantern(1.18, 1.85, 0.72);
    } else if (type === 'bakery') {
      // Hearth Bakery — warm stone & plaster shop, protruding rounded brick bread oven dome, puffing chimney & loaf stall!
      const plinth = tag(new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.38, 2.35), this.stoneMat));
      plinth.position.y = 0.19;

      const body = tag(new THREE.Mesh(new THREE.BoxGeometry(2.55, 1.82, 2.15), this.warmPlasterMat));
      body.position.y = 1.25;

      for (const sx of [-1.26, 1.26]) {
        for (const sz of [-1.06, 1.06]) {
          const beam = tag(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.86, 0.14), this.darkTimberMat));
          beam.position.set(sx, 1.25, sz);
        }
      }

      const roof = tag(new THREE.Mesh(this.gableRoofGeo, this.brickMat));
      roof.scale.set(0.96, 0.88, 0.92);
      roof.position.y = 2.12;

      // Protruding domed clay-brick bread oven on the right flank with glowing firebox!
      const ovenBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.98, 0.72, 14), this.stoneMat));
      ovenBase.position.set(1.55, 0.42, -0.08);
      const ovenDome = tag(new THREE.Mesh(new THREE.SphereGeometry(0.86, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), this.brickMat));
      ovenDome.position.set(1.55, 0.76, -0.08);
      const ovenArch = tag(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 16, Math.PI), this.stoneMat));
      ovenArch.position.set(1.55, 0.96, 0.78);
      const ovenGlow = tag(new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), this.ovenFireMat));
      ovenGlow.position.set(1.55, 0.98, 0.79);
      ovenGlow.castShadow = false;
      const ovenChimney = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.9, 10), this.brickMat));
      ovenChimney.position.set(1.55, 2.35, -0.08);
      addChimneySmoke(1.55, 3.38, -0.08);

      // Front bakery counter with fresh golden loaves & berry tarts under a striped awning!
      const shelf = tag(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.68, 0.55), this.timberMat));
      shelf.position.set(-0.35, 0.52, 1.32);
      for (let i = 0; i < 3; i++) {
        const loaf = tag(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.potteryMat));
        loaf.scale.set(1.35, 0.72, 0.92);
        loaf.position.set(-0.82 + i * 0.44, 0.94, 1.32);
      }
      const tart = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.09, 12), this.flowerPinkMat));
      tart.position.set(0.35, 0.92, 1.32);

      const awning = tag(new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.09, 0.78), bannerMat));
      awning.position.set(-0.35, 1.72, 1.38);
      awning.rotation.x = 0.28;

      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.15, 0.12), this.doorMat));
      door.position.set(0.82, 0.92, 1.08);
      addMullionedWindow(-0.42, 1.36, 1.08, 0, 0.72, 0.52);
      addHangingLantern(0.95, 1.56, 1.34);
    } else if (type === 'tavern') {
      const plinth = tag(new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.45, 2.9), this.stoneMat));
      plinth.position.y = 0.22;

      const hall = tag(new THREE.Mesh(new THREE.BoxGeometry(3.55, 1.95, 2.75), this.timberMat));
      hall.position.y = 1.4;

      const upper = tag(new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.35, 2.95), wallPlaster));
      upper.position.y = 2.48;

      const roof = tag(new THREE.Mesh(this.gableRoofGeo, altRoofMat));
      roof.scale.set(1.25, 1.18, 1.35);
      roof.rotation.y = Math.PI / 2;
      roof.position.y = 2.6;

      const chimney = tag(new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, 0.6), this.stoneMat));
      chimney.position.set(-1.2, 4.1, -0.7);
      addChimneySmoke(-1.2, 5.18, -0.7);

      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.25, 0.14), this.doorMat));
      door.position.set(0, 0.85, 1.38);
      for (const bx of [-1.42, -1.04]) {
        const barrel = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.56, 12), this.darkTimberMat));
        barrel.position.set(bx, 0.5, 1.72);
      }

      addMullionedWindow(-1.12, 1.45, 1.38, 0, 0.58, 0.65);
      addMullionedWindow(1.12, 1.45, 1.38, 0, 0.58, 0.65);

      const arm = tag(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.08), this.darkTimberMat));
      arm.position.set(2.1, 2.18, 1.25);

      const signPivot = new THREE.Group();
      signPivot.position.set(2.35, 2.12, 1.25);
      const signBoard = tag(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.08), bannerMat), signPivot);
      signBoard.position.y = -0.35;
      const emblem = tag(new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.brassMat), signPivot);
      emblem.position.set(0, -0.35, 0.06);
      signPivot.userData.buildPhase = 'exterior';
      finishedGroup.add(signPivot);
      swayPart = signPivot;

      addHangingLantern(-0.58, 1.55, 1.55);
      addHangingLantern(0.58, 1.55, 1.55);
    } else if (type === 'workshop') {
      const main = tag(new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.9, 2.3), this.stoneMat));
      main.position.y = 0.95;

      const roof = tag(new THREE.Mesh(this.gableRoofGeo, this.timberMat));
      roof.scale.set(0.96, 0.85, 0.95);
      roof.position.y = 1.86;

      const stack = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 2.6, 10), this.stoneMat));
      stack.position.set(0.95, 2.65, -0.65);
      addChimneySmoke(0.95, 4.02, -0.65);

      const arch = tag(new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.1, 8, 16, Math.PI), this.stoneMat));
      arch.position.set(0, 0.65, 1.18);
      const forge = tag(new THREE.Mesh(new THREE.CircleGeometry(0.42, 14), this.windowMat));
      forge.position.set(0, 0.82, 1.17);

      for (let i = 0; i < 3; i++) {
        const log = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8), this.timberMat));
        log.rotation.z = Math.PI / 2;
        log.position.set(-0.85, 0.14 + (i === 2 ? 0.19 : 0), 1.48 + (i === 1 ? 0.24 : i === 2 ? 0.12 : 0));
      }

      const wheelPivot = new THREE.Group();
      wheelPivot.position.set(-1.46, 1.05, 0);
      const rim = tag(new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 18), this.darkTimberMat), wheelPivot);
      rim.rotation.y = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const spoke = tag(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), this.timberMat), wheelPivot);
        spoke.rotation.x = (i / 4) * Math.PI;
      }
      const hub = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10), this.brassMat), wheelPivot);
      hub.rotation.z = Math.PI / 2;
      wheelPivot.userData.buildPhase = 'exterior';
      finishedGroup.add(wheelPivot);
      wheelMesh = wheelPivot;
    } else if (type === 'windmill') {
      // Meadow Windmill — tall tapered stone-and-timber mill tower with sweeping 4-sail rotating canvas rotor!
      const stoneBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.78, 1.75, 14), this.stoneMat));
      stoneBase.position.y = 0.88;

      const upperTower = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.42, 3.1, 14), wallPlaster));
      upperTower.position.y = 3.25;

      // Exposed timber collar bands around the mill
      for (const bandY of [1.75, 3.35, 4.75]) {
        const r = bandY < 2 ? 1.46 : bandY < 4 ? 1.26 : 1.08;
        const band = tag(new THREE.Mesh(new THREE.TorusGeometry(r, 0.065, 8, 20), this.darkTimberMat));
        band.rotation.x = Math.PI / 2;
        band.position.y = bandY;
      }

      // Conical timber/slate windmill cap + brass finial
      const cap = tag(new THREE.Mesh(this.bellRoofGeo, this.slateRoofMat));
      cap.scale.set(0.76, 1.02, 0.76);
      cap.position.y = 4.72;
      const finial = tag(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), this.brassMat));
      finial.position.y = 6.62;

      // Arched mill doorway & stacked flour sacks
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.12, 0.24), this.doorMat));
      door.position.set(0, 0.68, 1.66);
      const millStep = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.68, 0.22, 12), this.stoneMat));
      millStep.position.set(0, 0.12, 1.9);
      for (let i = 0; i < 3; i++) {
        const sack = tag(new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), this.canvasSailMat));
        sack.scale.set(1.1, 0.78, 0.9);
        sack.position.set(-1.12 + i * 0.26, 0.22, 1.46 + (i % 2) * 0.2);
      }

      // Glowing loft windows
      addMullionedWindow(1.18, 3.1, 0.56, Math.PI / 3, 0.42, 0.5);
      addMullionedWindow(-1.18, 3.1, 0.56, -Math.PI / 3, 0.42, 0.5);
      addHangingLantern(0.62, 1.32, 1.72);

      // Sweeping 4-blade timber-and-canvas rotating windmill sails!
      const axle = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.75, 10), this.darkTimberMat));
      axle.rotation.x = Math.PI / 2;
      axle.position.set(0, 4.55, 1.32);

      const rotorPivot = new THREE.Group();
      rotorPivot.position.set(0, 4.55, 1.68);
      const hubCap = tag(new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), this.brassMat), rotorPivot);
      hubCap.position.z = 0.05;

      for (let i = 0; i < 4; i++) {
        const armGroup = new THREE.Group();
        armGroup.rotation.z = (i / 4) * Math.PI * 2;
        const spar = tag(new THREE.Mesh(new THREE.BoxGeometry(0.11, 3.15, 0.09), this.darkTimberMat), armGroup);
        spar.position.y = 1.62;

        const sail = tag(new THREE.Mesh(new THREE.BoxGeometry(0.76, 2.38, 0.04), this.canvasSailMat), armGroup);
        sail.position.set(0.42, 1.85, -0.02);
        sail.rotation.y = 0.14;

        // Cross-battens & banner trim along each sail
        const trim = tag(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.06), bannerMat), armGroup);
        trim.position.set(0.42, 2.98, 0.01);
        rotorPivot.add(armGroup);
      }
      rotorPivot.userData.buildPhase = 'exterior';
      finishedGroup.add(rotorPivot);
      rotorMesh = rotorPivot;
    } else if (type === 'greenhouse') {
      // Canopy Conservatory — stone dwarf wall, curved brass ribs, sunlit translucent glass dome & lush glowing interior herbs!
      const dwarfWall = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.88, 2.02, 0.68, 8), this.stoneMat));
      dwarfWall.position.y = 0.34;

      const glassWalls = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.82, 1.38, 8), this.glassMat));
      glassWalls.position.y = 1.35;
      glassWalls.castShadow = false;

      const glassDome = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.78, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
          this.glassMat,
        ),
      );
      glassDome.position.y = 2.02;
      glassDome.castShadow = false;

      // Ornate brass structural ribs & cornice ring
      const cornice = tag(new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.06, 8, 24), this.brassMat));
      cornice.rotation.x = Math.PI / 2;
      cornice.position.y = 2.04;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.45, 6), this.brassMat));
        post.position.set(Math.cos(a) * 1.8, 1.35, Math.sin(a) * 1.8);
      }
      for (let i = 0; i < 4; i++) {
        const archRib = tag(
          new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.045, 6, 20, Math.PI), this.brassMat),
        );
        archRib.rotation.y = (i / 4) * Math.PI;
        archRib.position.y = 2.02;
      }
      const cupola = tag(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.65, 8), this.brassMat));
      cupola.position.y = 4.02;

      // Lush glowing herbs & flowering trees thriving inside the glass dome!
      const planter = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.34, 0.34, 12), this.potteryMat));
      planter.position.y = 0.25;
      const flowerMats = [this.flowerPinkMat, this.flowerGoldMat, this.flowerBlueMat, this.shrineCrystalMat];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = i === 0 ? 0 : 0.72;
        const bush = tag(new THREE.Mesh(new THREE.DodecahedronGeometry(i === 0 ? 0.52 : 0.34, 1), this.mossLeafMat));
        bush.position.set(Math.cos(a) * r, i === 0 ? 1.15 : 0.75, Math.sin(a) * r);
        const bloom = tag(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), flowerMats[i % flowerMats.length]));
        bloom.position.set(Math.cos(a) * r, i === 0 ? 1.62 : 1.08, Math.sin(a) * r);
      }

      // Cozy timber doorway vestibule
      const porch = tag(new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.45, 0.55), this.timberMat));
      porch.position.set(0, 0.76, 1.88);
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.12, 0.1), this.doorMat));
      door.position.set(0, 0.62, 2.15);
      addHangingLantern(0, 1.62, 2.12);
    } else if (type === 'library') {
      // Owl Archive — grand octagonal scholar's tower with arched glowing windows, verdigris copper dome & gilded astrolabe!
      const dais = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.38, 0.42, 8), this.stoneMat));
      dais.position.y = 0.21;

      const lowerRotunda = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.88, 1.98, 2.1, 8), this.stoneMat));
      lowerRotunda.position.y = 1.45;

      const upperGallery = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.78, 1.55, 8), wallPlaster));
      upperGallery.position.y = 3.25;

      // Stone buttress columns framing the octagonal walls
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const col = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.65, 8), this.stoneMat));
        col.position.set(Math.cos(a) * 1.92, 2.05, Math.sin(a) * 1.92);
      }

      // Gleaming verdigris copper dome + brass lantern pinnacle + orbiting scholar astrolabe!
      const dome = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.74, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
          this.verdigrisMat,
        ),
      );
      dome.scale.set(1, 1.18, 1);
      dome.position.y = 3.98;

      const domeRim = tag(new THREE.Mesh(new THREE.TorusGeometry(1.74, 0.09, 8, 24), this.brassMat));
      domeRim.rotation.x = Math.PI / 2;
      domeRim.position.y = 4.02;

      const pinnacle = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.1, 8), this.brassMat));
      pinnacle.position.y = 6.35;
      const astrolabe = tag(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 20), this.brassMat));
      astrolabe.position.y = 6.68;
      runeRingA = astrolabe;

      // Tall arched scholar portico & glowing upper gallery windows
      const portico = tag(new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.85, 0.65), this.timberMat));
      portico.position.set(0, 1.28, 1.98);
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.38, 0.12), bannerMat));
      door.position.set(0, 1.05, 2.3);
      addMullionedWindow(0, 3.25, 1.74, 0, 0.62, 0.82);
      addMullionedWindow(1.52, 3.25, 0.88, Math.PI / 3, 0.56, 0.78);
      addMullionedWindow(-1.52, 3.25, 0.88, -Math.PI / 3, 0.56, 0.78);
      addHangingLantern(-0.72, 1.85, 2.34);
      addHangingLantern(0.72, 1.85, 2.34);
    } else if (type === 'fountain_plaza') {
      // Carved Two-Tier Stone Plaza Fountain — recessed wet-stone basin, lathe-turned overhanging
      // upper bowl, bronze finial nozzle, refracted caustics, dynamic capillary surface waves,
      // flowing aerated parabolic arcs, ray-marched volumetric mist & 4-class GPU particle spray!
      const patio = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.62, 0.2, 8), this.stoneMat));
      patio.position.y = 0.14;

      // Recessed lower stone basin wall, coping lip & stone floor beneath the caustic-lit water
      const basinOuter = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.65, 0.36, 24, 1, true), this.stoneMat));
      basinOuter.position.y = 0.38;
      const basinCoping = tag(new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.13, 12, 28), this.stoneMat));
      basinCoping.rotation.x = Math.PI / 2;
      basinCoping.position.y = 0.54;
      const basinFloor = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.08, 24), this.graniteMat));
      basinFloor.position.y = 0.26;

      // Molded central stone pedestal, carved lathe-turned upper basin & bronze finial spout
      const pedBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.56, 0.28, 16), this.stoneMat));
      pedBase.position.y = 0.4;
      const stem = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 0.96, 14), this.stoneMat));
      stem.position.y = 0.96;
      const stemCollar = tag(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 18), this.stoneMat));
      stemCollar.rotation.x = Math.PI / 2;
      stemCollar.position.y = 1.26;
      const upperBowl = tag(new THREE.Mesh(this.fountainBowlGeo, this.stoneMat));
      upperBowl.position.y = 1.32;

      // Sculpted bronze finial nozzle rising from the upper bowl
      const nozzleBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.36, 10), this.brassMat));
      nozzleBase.position.y = 1.8;
      const nozzleBulb = tag(new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), this.brassMat));
      nozzleBulb.position.y = 1.98;

      // Physically-based multi-layer fountain water assembly (caustics, dynamic capillary surface,
      // 14 flowing parabolic streams, aerated splash-boil foam, ray-marched volumetric mist & 4-class particles)
      const spraySeed = b.position.x * 0.71 + b.position.z * 0.43;
      const waterAssembly = this.fountainWater.createFountainAssembly(spraySeed, {
        kind: 'building',
        id: b.id,
      });
      finishedGroup.add(waterAssembly.waterGroup);
      fountainJet = waterAssembly.jetsGroup;
      waterAssembly.volumetricMist.visible = b.completed;
      fountainMist = waterAssembly.volumetricMist;

      waterAssembly.particles.position.y = stiltLift;
      waterAssembly.particles.visible = b.completed;
      group.add(waterAssembly.particles);
      fountainSpray = waterAssembly.particles;

      // Four warm corner garden lamp posts + cozy curved benches
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const lx = Math.cos(a) * 2.15;
        const lz = Math.sin(a) * 2.15;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.65, 6), this.darkTimberMat));
        post.position.set(lx, 0.92, lz);
        addHangingLantern(lx, 1.78, lz);
      }
      for (const side of [-1, 1]) {
        const bench = tag(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.38), this.timberMat));
        bench.position.set(side * 1.98, 0.44, 0);
        bench.rotation.y = Math.PI / 2;
      }
    } else if (type === 'guildhall') {
      // Grand Civic Guildhall — monumental two-story city hall with colonnade portico, double gables & brass bell cupola!
      const plinth = tag(new THREE.Mesh(new THREE.BoxGeometry(4.45, 0.52, 3.45), this.stoneMat));
      plinth.position.y = 0.26;

      // Grand front stone steps
      const step = tag(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.26, 0.65), this.stoneMat));
      step.position.set(0, 0.14, 1.98);

      const lowerHall = tag(new THREE.Mesh(new THREE.BoxGeometry(4.15, 1.85, 3.15), this.stoneMat));
      lowerHall.position.y = 1.42;

      const upperHall = tag(new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.65, 3.35), wallPlaster));
      upperHall.position.y = 3.12;

      // Exposed dark timber framing beams across upper civic hall
      for (const sx of [-2.18, -1.08, 0, 1.08, 2.18]) {
        for (const sz of [-1.66, 1.66]) {
          const post = tag(new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.7, 0.15), this.darkTimberMat));
          post.position.set(sx, 3.12, sz);
        }
      }

      // Main slate gabled roof + cross-wing gable
      const guildRoofMat = adaptation === 'desert_oasis' ? this.terracottaRoofMat : this.slateRoofMat;
      const mainRoof = tag(new THREE.Mesh(this.gableRoofGeo, guildRoofMat));
      mainRoof.scale.set(1.24, 1.18, 1.56);
      mainRoof.rotation.y = Math.PI / 2;
      mainRoof.position.y = 3.92;

      const crossRoof = tag(new THREE.Mesh(this.gableRoofGeo, guildRoofMat));
      crossRoof.scale.set(0.95, 1.05, 1.24);
      crossRoof.position.y = 3.92;

      // Central octagonal clock & brass bell cupola soaring above the city skyline!
      const cupolaBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.02, 1.25, 8), this.timberMat));
      cupolaBase.position.y = 5.62;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 6), this.darkTimberMat));
        p.position.set(Math.cos(a) * 0.72, 6.65, Math.sin(a) * 0.72);
      }
      const bell = tag(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.52, 12), this.brassMat));
      bell.position.y = 6.62;
      const cupolaRoof = tag(new THREE.Mesh(new THREE.ConeGeometry(1.02, 1.55, 8), this.verdigrisMat));
      cupolaRoof.position.y = 7.82;
      const spireOrb = tag(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.brassMat));
      spireOrb.position.y = 8.68;

      // Gilded civic clock medallion on the front gable
      const clock = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 16), this.brassMat));
      clock.rotation.x = Math.PI / 2;
      clock.position.set(0, 4.72, 1.85);
      const clockFace = tag(new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), this.windowMat));
      clockFace.position.set(0, 4.72, 1.91);

      // Double civic entrance doors + flanking faction banners
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(1.22, 1.48, 0.16), this.doorMat));
      door.position.set(0, 1.22, 1.58);
      for (const side of [-1, 1]) {
        const col = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.92, 8), this.timberMat));
        col.position.set(side * 1.02, 1.44, 1.92);
        const banner = tag(new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.25, 0.05), bannerMat));
        banner.position.set(side * 1.55, 2.95, 1.72);
        addHangingLantern(side * 0.95, 1.85, 2.02);
      }

      addMullionedWindow(-1.32, 3.15, 1.68, 0, 0.62, 0.68);
      addMullionedWindow(0, 3.15, 1.68, 0, 0.68, 0.72);
      addMullionedWindow(1.32, 3.15, 1.68, 0, 0.62, 0.68);
    } else if (type === 'watchtower') {
      const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.24, 1.8, 12), this.stoneMat));
      base.position.y = 0.9;

      const shaft = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.98, 2.9, 12), this.timberMat));
      shaft.position.y = 3.15;

      const deck = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.12, 0.36, 12), this.darkTimberMat));
      deck.position.y = 4.6;

      const railTop = tag(new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.055, 8, 18), this.timberMat));
      railTop.rotation.x = Math.PI / 2;
      railTop.position.y = 5.25;

      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.32, 6), this.darkTimberMat));
        post.position.set(Math.cos(a) * 1.26, 5.4, Math.sin(a) * 1.26);
      }

      addHangingLantern(0, 5.55, 0);

      const spire = tag(new THREE.Mesh(this.bellRoofGeo, altRoofMat));
      spire.scale.set(0.82, 1.15, 0.82);
      spire.position.y = 5.95;

      const flagPivot = new THREE.Group();
      flagPivot.position.set(0, 8.05, 0);
      const staff = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 6), this.brassMat), flagPivot);
      staff.position.y = 0.2;
      const pennant = tag(new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.48), bannerMat), flagPivot);
      pennant.position.set(0.55, 0.35, 0);
      flagPivot.userData.buildPhase = 'exterior';
      finishedGroup.add(flagPivot);
      swayPart = flagPivot;
    } else if (b.type === 'beaver_lodge') {
      // Beaver Timber Lodge — woven river-branch & driftwood dome rising from submerged crib pilings,
      // mossy crown, water-entry tunnel, glowing porthole window & puffing river-stone chimney!
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.1, 7), this.beaverBranchMat));
        piling.position.set(Math.cos(a) * 1.48, -0.78, Math.sin(a) * 1.48);
      }
      // Submerged base raft ring
      const baseCrib = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.96, 0.42, 16), this.beaverBranchMat));
      baseCrib.position.y = 0.06;
      // Cozy dome of packed river mud and interwoven logs
      const dome = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.66, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
          this.beaverBranchMat,
        ),
      );
      dome.scale.set(1.04, 1.08, 1.04);
      dome.position.y = 0.12;
      // Crisscrossed gnawed timber sticks jutting organically around the lodge shell
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.12;
        const stick = tag(
          new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.09, 1.55 + (i % 3) * 0.22, 6), i % 2 === 0 ? this.driftwoodMat : this.timberMat),
        );
        stick.position.set(Math.cos(a) * 1.24, 0.82 + (i % 2) * 0.18, Math.sin(a) * 1.24);
        stick.rotation.z = Math.cos(a) * 0.54;
        stick.rotation.x = -Math.sin(a) * 0.54;
        stick.rotation.y = a * 0.4;
      }
      // Lush emerald mossy crown
      const mossCrown = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
          this.mossRoofMat,
        ),
      );
      mossCrown.scale.set(1.06, 0.72, 1.06);
      mossCrown.position.y = 1.42;
      // Water-level arched beaver entry porch
      const entryArch = tag(new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.13, 8, 14, Math.PI), this.driftwoodMat));
      entryArch.position.set(0, 0.16, 1.54);
      const entryTunnel = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.5, 12), this.doorMat));
      entryTunnel.rotation.x = Math.PI / 2;
      entryTunnel.position.set(0, 0.22, 1.38);
      // Warm glowing round porthole window
      const portRing = tag(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 16), this.brassMat));
      portRing.position.set(0.88, 1.06, 1.08);
      portRing.rotation.y = 0.66;
      const portGlass = tag(new THREE.Mesh(new THREE.CircleGeometry(0.24, 14), this.windowMat));
      portGlass.position.set(0.89, 1.06, 1.09);
      portGlass.rotation.y = 0.66;
      // Stone chimney puffing cozy smoke
      const lodgeChimney = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.05, 8), this.stoneMat));
      lodgeChimney.position.set(-0.56, 1.92, -0.42);
      lodgeChimney.rotation.z = 0.08;
      addChimneySmoke(-0.56, 2.56, -0.42);
      // Floating gnawed log bundle tethered at side
      for (let i = 0; i < 3; i++) {
        const log = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 1.18, 7), this.timberMat));
        log.rotation.x = Math.PI / 2;
        log.position.set(-1.95 - i * 0.17, 0.05, 0.35 + (i % 2) * 0.12);
        log.userData.buildPhase = 'exterior';
      }
    } else if (b.type === 'otter_boathouse') {
      // Otter Floating Boathouse — 4 moored river pilings cradling a gently bobbing curved boat hull,
      // teal-trimmed cozy cabin, brass portholes, hanging river lantern & steering oar!
      for (const [px, pz] of [[-1.55, -1.35], [1.55, -1.35], [-1.55, 1.35], [1.55, 1.35]]) {
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.45, 8), this.driftwoodMat));
        piling.position.set(px, 0.08, pz);
        const ropeCoil = tag(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.036, 6, 12), this.ropeMat));
        ropeCoil.rotation.x = Math.PI / 2;
        ropeCoil.position.set(px, 0.62, pz);
        ropeCoil.userData.buildPhase = 'exterior';
      }
      const boatGroup = new THREE.Group();
      boatGroup.userData.selectionTarget = { kind: 'building', id: b.id };
      finishedGroup.add(boatGroup);
      floatGroup = boatGroup;

      // Buoyant curved hull + teal gunwale trim
      const hull = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.52, 18, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
          this.timberMat,
        ),
        boatGroup,
      );
      hull.scale.set(0.95, 0.62, 1.38);
      hull.position.y = 0.42;
      const deck = tag(new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.14, 3.35), this.driftwoodMat), boatGroup);
      deck.position.y = 0.4;
      const gunwale = tag(new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.085, 8, 20), this.tealTrimMat), boatGroup);
      gunwale.rotation.x = Math.PI / 2;
      gunwale.scale.set(0.92, 1.34, 1.0);
      gunwale.position.y = 0.48;
      // Cozy cabin walls + pitched roof
      const cabin = tag(new THREE.Mesh(new THREE.BoxGeometry(1.86, 1.32, 2.18), this.warmPlasterMat), boatGroup);
      cabin.position.set(0, 1.12, -0.1);
      const cabinRoof = tag(new THREE.Mesh(this.gableRoofGeo, this.tealTrimMat), boatGroup);
      cabinRoof.scale.set(0.72, 0.58, 0.88);
      cabinRoof.position.set(0, 1.74, -0.1);
      // Warm arched bow door + brass portholes on port & starboard
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.92, 0.08), this.doorMat), boatGroup);
      door.position.set(0, 0.94, 1.0);
      for (const side of [-1, 1]) {
        for (const pz of [-0.55, 0.35]) {
          const rim = tag(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.04, 8, 14), this.brassMat), boatGroup);
          rim.rotation.y = Math.PI / 2;
          rim.position.set(side * 0.95, 1.2, pz);
          const pane = tag(new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), this.windowMat), boatGroup);
          pane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          pane.position.set(side * 0.96, 1.2, pz);
        }
      }
      // Bow river-lantern & stern steering oar
      const bowPost = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.15, 6), this.darkTimberMat), boatGroup);
      bowPost.position.set(0.68, 0.96, 1.48);
      const bowOrb = tag(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), this.pearlGlowMat), boatGroup);
      bowOrb.position.set(0.68, 1.56, 1.48);
      const oar = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1.65, 6), this.bambooMat), boatGroup);
      oar.position.set(0, 0.45, -1.78);
      oar.rotation.x = -0.68;
      // Banner pennant on cabin ridge
      const flagPole = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.2, 6), this.darkTimberMat), boatGroup);
      flagPole.position.set(0, 2.75, 0.85);
      const pennant = tag(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.62), bannerMat), boatGroup);
      pennant.position.set(0, 3.12, 0.56);
    } else if (b.type === 'waterwheel_mill') {
      // River Waterwheel Mill — cedar millhouse on river pilings with gabled mossy roof,
      // glowing loft windows & undershot paddle waterwheel driven directly by the river current!
      for (const [px, pz] of [[-1.62, -1.35], [1.02, -1.35], [-1.62, 1.35], [1.02, 1.35], [-0.34, -1.5], [-0.34, 1.5]]) {
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 2.4, 8), this.driftwoodMat));
        piling.position.set(px, -0.78, pz);
      }
      const pierDeck = tag(new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.22, 3.2), this.driftwoodMat));
      pierDeck.position.set(-0.34, 0.38, 0);
      // Lower millstone chamber + upper timber-framed loft
      const lowerWall = tag(new THREE.Mesh(new THREE.BoxGeometry(2.55, 1.42, 2.45), this.stoneMat));
      lowerWall.position.set(-0.28, 1.18, 0);
      const upperWall = tag(new THREE.Mesh(new THREE.BoxGeometry(2.72, 1.28, 2.62), this.warmPlasterMat));
      upperWall.position.set(-0.28, 2.5, 0);
      const roof = tag(new THREE.Mesh(this.gableRoofGeo, this.mossRoofMat));
      roof.scale.set(1.02, 0.92, 1.06);
      roof.position.set(-0.28, 3.06, 0);
      addMullionedWindow(-0.28, 2.48, 1.33, 0, 0.62, 0.62);
      addMullionedWindow(-0.28, 2.48, -1.33, Math.PI, 0.62, 0.62);
      const millDoor = tag(new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.08, 0.1), this.doorMat));
      millDoor.position.set(-0.28, 1.02, 1.24);
      // Outer river-piling trestle & pillow block supporting the outboard end of the wheel axle
      for (const tz of [-0.46, 0.46]) {
        const trestlePiling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.45, 8), this.driftwoodMat));
        trestlePiling.position.set(2.04, -0.35, tz);
      }
      const trestleBeam = tag(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 1.18), this.darkTimberMat));
      trestleBeam.position.set(2.04, 0.88, 0);
      const bearingBlock = tag(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.3), this.darkTimberMat));
      bearingBlock.position.set(2.04, 0.98, 0);
      // Large animated undershot wooden paddle waterwheel dipping into the river current
      const wheelPivot = new THREE.Group();
      wheelPivot.name = 'waterwheel_rotor';
      wheelPivot.position.set(1.56, 0.96, 0);
      wheelPivot.userData.selectionTarget = { kind: 'building', id: b.id };
      const axle = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.16, 10), this.darkTimberMat), wheelPivot);
      axle.position.x = -0.04;
      axle.rotation.z = Math.PI / 2;
      for (const rimX of [-0.23, 0.23]) {
        const rim = tag(new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.075, 8, 24), this.timberMat), wheelPivot);
        rim.rotation.y = Math.PI / 2;
        rim.position.x = rimX;
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const spoke = tag(new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.12, 0.09), this.darkTimberMat), wheelPivot);
        spoke.rotation.x = a;
        const paddle = tag(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.08), this.driftwoodMat), wheelPivot);
        paddle.position.set(0, Math.cos(a) * 1.14, Math.sin(a) * 1.14);
        paddle.rotation.x = a;
      }
      finishedGroup.add(wheelPivot);
      wheelMesh = wheelPivot;
      // Faction banner & hanging lantern
      const bannerPole = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6), this.darkTimberMat));
      bannerPole.position.set(-0.28, 4.95, 1.15);
      const millBanner = tag(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.85), bannerMat));
      millBanner.position.set(-0.28, 5.3, 0.78);
      addHangingLantern(0.62, 1.65, 1.38);
    } else if (b.type === 'lily_market') {
      // Lily-Pad Floating Market — buoyant bazaar atop 3 giant floating lily pads & bamboo pontoons,
      // striped coral-and-cream canopy, pearl & kelp display crates, pink lotus blossoms & hanging lanterns!
      const marketFloat = new THREE.Group();
      marketFloat.userData.selectionTarget = { kind: 'building', id: b.id };
      finishedGroup.add(marketFloat);
      floatGroup = marketFloat;

      // 3 overlapping giant floating lily pads
      const padSpecs: [number, number, number][] = [
        [0, 0, 1.82],
        [-1.35, 0.95, 1.05],
        [1.38, -0.82, 1.12],
      ];
      for (const [px, pz, pr] of padSpecs) {
        const pad = tag(new THREE.Mesh(new THREE.CylinderGeometry(pr, pr * 0.96, 0.12, 18), this.waterLilyMat), marketFloat);
        pad.position.set(px, 0.08, pz);
      }
      // Lashed bamboo pontoon platform
      for (let i = -3; i <= 3; i++) {
        const pole = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.75, 7), this.bambooMat), marketFloat);
        pole.rotation.x = Math.PI / 2;
        pole.position.set(i * 0.34, 0.18, 0);
      }
      // 4 bamboo canopy poles & vibrant coral-and-cream market awning
      for (const [cx, cz] of [[-1.12, -0.95], [1.12, -0.95], [-1.12, 0.95], [1.12, 0.95]]) {
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.068, 2.25, 7), this.bambooMat), marketFloat);
        post.position.set(cx, 1.28, cz);
      }
      for (let s = 0; s < 5; s++) {
        const strip = tag(
          new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 2.38), s % 2 === 0 ? this.coralMat : this.canvasSailMat),
          marketFloat,
        );
        strip.position.set(-1.12 + s * 0.56, 2.38 - Math.abs(s - 2) * 0.04, 0);
        strip.rotation.x = 0.08;
      }
      // Market counter stocked with glowing river pearls, lotus blooms & berry baskets
      const counter = tag(new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.72, 0.72), this.driftwoodMat), marketFloat);
      counter.position.set(0, 0.56, -0.22);
      for (let i = 0; i < 4; i++) {
        const pearl = tag(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), this.pearlGlowMat), marketFloat);
        pearl.position.set(-0.62 + i * 0.42, 1.0, -0.22);
      }
      // Blooming lotus flowers perched on the side lily pads
      for (const [lx, lz] of [[-1.42, 1.04], [1.44, -0.88]]) {
        const lotus = tag(new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), this.lotusPinkMat), marketFloat);
        lotus.scale.set(1.2, 0.74, 1.2);
        lotus.position.set(lx, 0.28, lz);
      }
      // Hanging river lanterns on front canopy corners
      for (const lx of [-1.12, 1.12]) {
        const glow = tag(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), this.windowMat), marketFloat);
        glow.position.set(lx, 2.02, 0.98);
      }
    } else if (b.type === 'aquatic_sanctuary') {
      // Aquatic Pearl Sanctuary — half-submerged carved river-stone rotunda on deep pilings,
      // translucent glass-and-verdigris conservatory dome, levitating aqua crystal pearl & rotating rune ring!
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.3, 8), this.stoneMat));
        piling.position.set(Math.cos(a) * 2.35, -0.78, Math.sin(a) * 2.35);
      }
      const rotundaBase = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.75, 0.55, 20), this.stoneMat));
      rotundaBase.position.y = 0.2;
      const poolRing = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.14, 18), this.fountainWaterMat));
      poolRing.position.y = 0.48;
      // 6 carved stone columns with verdigris capitals supporting the vaulted glass dome
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const col = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.25, 10), this.stoneMat));
        col.position.set(Math.cos(a) * 2.15, 1.56, Math.sin(a) * 2.15);
        const cap = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.22, 10), this.verdigrisMat));
        cap.position.set(Math.cos(a) * 2.15, 2.74, Math.sin(a) * 2.15);
      }
      const ringBeam = tag(new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.16, 10, 24), this.verdigrisMat));
      ringBeam.rotation.x = Math.PI / 2;
      ringBeam.position.y = 2.84;
      // Translucent ribbed glass dome & finial spire
      const glassDome = tag(
        new THREE.Mesh(
          new THREE.SphereGeometry(2.08, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
          this.glassMat,
        ),
      );
      glassDome.position.y = 2.86;
      const finial = tag(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.85, 8), this.verdigrisMat));
      finial.position.y = 5.22;
      // Levitating glowing river-pearl crystal & rotating water-rune ring inside the rotunda
      const pearl = tag(new THREE.Mesh(new THREE.OctahedronGeometry(0.54, 1), this.pearlGlowMat));
      pearl.position.y = 2.65;
      crystalMesh = pearl;
      const ringA = tag(new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.045, 8, 28), this.brassMat));
      ringA.position.y = 2.65;
      runeRingA = ringA;
      // Floating coral planters & lotus pads around the sanctuary perimeter
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.35;
        const pad = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.52, 0.08, 12), this.waterLilyMat));
        pad.position.set(Math.cos(a) * 3.05, 0.06, Math.sin(a) * 3.05);
        pad.userData.buildPhase = 'exterior';
        const bloom = tag(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), i % 2 === 0 ? this.lotusPinkMat : this.coralMat));
        bloom.position.set(Math.cos(a) * 3.05, 0.22, Math.sin(a) * 3.05);
        bloom.userData.buildPhase = 'exterior';
      }
    } else if (b.type === 'tide_shrine') {
      // Tide Pearl Shrine — tiered river-stone & driftwood water altar on pilings,
      // 4 coral-trimmed stone arches, levitating iridescent river pearl & counter-rotating rings!
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.2, 8), this.driftwoodMat));
        piling.position.set(Math.cos(a) * 1.72, -0.78, Math.sin(a) * 1.72);
      }
      const tier1 = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.88, 2.08, 0.42, 16), this.stoneMat));
      tier1.position.y = 0.18;
      const tier2 = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.54, 0.36, 14), this.graniteMat));
      tier2.position.y = 0.56;
      const altarPedestal = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.92, 10), this.stoneMat));
      altarPedestal.position.y = 1.18;
      // 4 coral-accented tide arches framing the floating pearl
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const pillar = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.25, 8), this.stoneMat));
        pillar.position.set(Math.cos(a) * 1.24, 1.78, Math.sin(a) * 1.24);
        const coralTip = tag(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), this.coralMat));
        coralTip.position.set(Math.cos(a) * 1.24, 2.98, Math.sin(a) * 1.24);
      }
      const crownRing = tag(new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.12, 8, 24), this.tealTrimMat));
      crownRing.rotation.x = Math.PI / 2;
      crownRing.position.y = 2.94;
      // Levitating river pearl + counter-rotating glowing rings
      const orb = tag(new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 14), this.pearlGlowMat));
      orb.position.y = 2.65;
      crystalMesh = orb;
      const ringA = tag(new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.036, 8, 26), this.brassMat));
      ringA.position.y = 2.65;
      runeRingA = ringA;
      const ringB = tag(new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.028, 8, 26), this.pearlGlowMat));
      ringB.position.y = 2.65;
      ringB.rotation.x = -Math.PI / 3;
      runeRingB = ringB;
      // 4 floating lotus lanterns around the water shrine
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const pad = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.46, 0.07, 12), this.waterLilyMat));
        pad.position.set(Math.cos(a) * 2.48, 0.06, Math.sin(a) * 2.48);
        pad.userData.buildPhase = 'exterior';
        const lantern = tag(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), this.lotusPinkMat));
        lantern.position.set(Math.cos(a) * 2.48, 0.22, Math.sin(a) * 2.48);
        lantern.userData.buildPhase = 'exterior';
      }
    } else {
      // Mystical Sylvan Shrine
      const dais1 = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.3, 0.28, 16), this.stoneMat));
      dais1.position.y = 0.14;
      const dais2 = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.75, 0.28, 16), this.stoneMat));
      dais2.position.y = 0.42;

      const pedestal = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.85, 10), this.stoneMat));
      pedestal.position.y = 0.92;

      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const px = Math.cos(a) * 1.25;
        const pz = Math.sin(a) * 1.25;
        const pillar = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 2.75, 10), this.stoneMat));
        pillar.position.set(px, 1.85, pz);
        const garland = tag(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 6, 12), this.mossLeafMat));
        garland.rotation.x = Math.PI / 2 + 0.35;
        garland.position.set(px, 2.4, pz);
        const blossom = tag(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this.flowerGoldMat));
        blossom.position.set(px * 0.88, 2.52, pz * 0.88);
      }

      const crown = tag(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.15, 10, 24), this.stoneMat));
      crown.rotation.x = Math.PI / 2;
      crown.position.y = 3.25;

      const crystal = tag(new THREE.Mesh(new THREE.OctahedronGeometry(0.54, 0), this.shrineCrystalMat));
      crystal.scale.set(0.85, 1.38, 0.85);
      crystal.position.y = 2.65;
      crystalMesh = crystal;

      const ringA = tag(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.032, 8, 28), this.brassMat));
      ringA.position.y = 2.65;
      runeRingA = ringA;

      const ringB = tag(new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.025, 8, 28), this.shrineCrystalMat));
      ringB.position.y = 2.65;
      ringB.rotation.x = -Math.PI / 3;
      runeRingB = ringB;
    }

    // Add unmistakable structural environmental adaptations to each completed building!
    const fpR = Math.max(1.45, blueprint.footprintRadius * 0.78);
    if (isStiltRaised) {
      // Wetland stilt pilings, elevated boardwalk deck, teal rail posts & front boarding steps
      const deck = tag(new THREE.Mesh(new THREE.CylinderGeometry(fpR * 1.12, fpR * 1.16, 0.16, 16), this.driftwoodMat));
      deck.position.y = -0.06;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.35;
        const piling = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.55, 8), this.driftwoodMat));
        piling.position.set(Math.cos(a) * fpR * 0.95, -0.78, Math.sin(a) * fpR * 0.95);
      }
      for (const sx of [-0.55, 0.55]) {
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.72, 6), this.tealTrimMat));
        post.position.set(sx, 0.32, fpR * 1.05);
        post.userData.buildPhase = 'exterior';
      }
      for (let s = 0; s < 3; s++) {
        const step = tag(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.28), this.driftwoodMat));
        step.position.set(0, -0.22 * (s + 1), fpR * 1.12 + s * 0.24);
        step.userData.buildPhase = 'exterior';
      }
      if (adaptation === 'coastal_harbor') {
        addHangingLantern(0.55, 0.78, fpR * 1.05);
      }
    } else if (adaptation === 'mountain_stone') {
      // Deep buttressed granite retaining terrace so hillside stone-holds never float on mountain slopes
      // Positioned with top at y = 0.03 so it never z-fights with levelingPad (y = 0.10) or front steps (y = 0.23)
      const retaining = tag(new THREE.Mesh(new THREE.CylinderGeometry(fpR * 1.15, fpR * 1.32, 1.38, 12), this.graniteMat));
      retaining.position.y = -0.66;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const buttress = tag(new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.15, 0.55), this.graniteMat));
        buttress.position.set(Math.cos(a) * fpR * 0.98, 0.28, Math.sin(a) * fpR * 0.98);
        buttress.rotation.y = -a;
        buttress.rotation.x = 0.14;
      }
    } else if (adaptation === 'prairie_pastoral' && b.type !== 'fountain_plaza') {
      // Sunlit raised prairie garden flower-and-berry planter trough beside the cottage
      const trough = tag(new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.34, 0.44), this.timberMat));
      trough.position.set(fpR * 0.98, 0.18, 0.22);
      trough.rotation.y = Math.PI / 2;
      trough.userData.buildPhase = 'exterior';
      const foliage = tag(new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), this.mossLeafMat));
      foliage.scale.set(0.85, 0.62, 1.85);
      foliage.position.set(fpR * 0.98, 0.42, 0.22);
      foliage.userData.buildPhase = 'exterior';
      const bloom = tag(new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), this.flowerGoldMat));
      bloom.position.set(fpR * 0.98, 0.55, 0.34);
      bloom.userData.buildPhase = 'exterior';
    } else if (adaptation === 'forest_canopy' && b.type !== 'fountain_plaza') {
      // Mossy root-curb cluster & dangling woodland fairy-lantern on an oak bracket
      for (let i = 0; i < 3; i++) {
        const a = -0.7 + i * 0.7;
        const moss = tag(new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), this.mossRoofMat));
        moss.scale.set(1.3, 0.55, 1.1);
        moss.position.set(Math.cos(a) * fpR * 1.02, 0.12, Math.sin(a) * fpR * 1.02);
        moss.userData.buildPhase = 'exterior';
      }
      const lPost = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 2.05, 6), this.darkTimberMat));
      lPost.position.set(-fpR * 0.95, 1.02, fpR * 0.62);
      lPost.userData.buildPhase = 'exterior';
      addHangingLantern(-fpR * 0.95, 1.88, fpR * 0.78);
    } else if (adaptation === 'desert_oasis' && b.type !== 'fountain_plaza' && b.type !== 'shrine') {
      // Woven ochre desert sun-shade canopy awning & paired terracotta water amphorae by the entrance
      const shade = tag(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.07, 0.95), this.ochreCanvasMat));
      shade.position.set(0, 1.62, fpR * 1.02);
      shade.rotation.x = 0.24;
      shade.userData.buildPhase = 'exterior';
      for (const sx of [-0.68, 0.68]) {
        const pole = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 1.55, 6), this.timberMat));
        pole.position.set(sx, 0.76, fpR * 1.38);
        pole.userData.buildPhase = 'exterior';
      }
      for (let i = 0; i < 2; i++) {
        const jar = tag(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), this.terracottaRoofMat));
        jar.scale.set(0.9, 1.35, 0.9);
        jar.position.set(0.88 + i * 0.34, 0.25, fpR * 0.96);
        jar.userData.buildPhase = 'exterior';
      }
    }

    // Classify every finished architectural component into progressive reveal order:
    // 0.78-0.86 structural shell -> 0.86-0.92 roofs/domes -> 0.92-0.99 exterior features & trim
    const roofMaterials = new Set<THREE.Material>([
      this.thatchMat,
      this.slateRoofMat,
      this.verdigrisMat,
      this.glassMat,
      this.mossRoofMat,
      this.terracottaRoofMat,
      this.goldenThatchMat,
    ]);
    const exteriorMaterials = new Set<THREE.Material>([
      this.doorMat,
      this.windowMat,
      this.brassMat,
      this.flowerPinkMat,
      this.flowerGoldMat,
      this.flowerBlueMat,
      this.mossLeafMat,
      this.potteryMat,
      this.canvasSailMat,
      this.shrineCrystalMat,
      this.fountainWaterMat,
      ...this.fountainWater.getWarmupMaterials(),
      this.ovenFireMat,
      this.ochreCanvasMat,
      this.tealTrimMat,
      this.waterLilyMat,
      this.lotusPinkMat,
      this.coralMat,
      this.pearlGlowMat,
      bannerMat,
    ]);

    const shellObjs: THREE.Object3D[] = [];
    const roofObjs: THREE.Object3D[] = [];
    const exteriorObjs: THREE.Object3D[] = [];

    for (const child of finishedGroup.children) {
      if (child.userData.buildPhase === 'exterior') {
        exteriorObjs.push(child);
      } else if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.Material;
        if (child.geometry === this.bellRoofGeo || child.geometry === this.gableRoofGeo || roofMaterials.has(mat)) {
          roofObjs.push(child);
        } else if (exteriorMaterials.has(mat)) {
          exteriorObjs.push(child);
        } else {
          shellObjs.push(child);
        }
      } else {
        exteriorObjs.push(child);
      }
    }

    shellObjs.sort((a, bObj) => a.position.y - bObj.position.y);
    roofObjs.sort((a, bObj) => a.position.y - bObj.position.y);
    exteriorObjs.sort((a, bObj) => a.position.y - bObj.position.y);

    const finishedParts: StagedPart[] = [];
    const pushRange = (list: THREE.Object3D[], start: number, end: number) => {
      const n = Math.max(1, list.length - 1);
      list.forEach((obj, idx) => {
        finishedParts.push({ obj, revealAt: start + (idx / n) * (end - start) });
      });
    };
    pushRange(shellObjs, 0.78, 0.855);
    pushRange(roofObjs, 0.86, 0.915);
    pushRange(exteriorObjs, 0.92, 0.985);

    // Build dedicated 5-stage construction site kit (clearing, leveling, foundation, timber/masonry frame, scaffolding)
    const isWaterwaySite = Boolean(blueprint.waterwayOnly) || adaptation === 'waterway_haven';
    const kit = this.buildConstructionKit(b, blueprint.footprintRadius, blueprint.frameStyle, isWaterwaySite);
    group.add(kit.clearingGroup, kit.levelingPad, kit.levelingExtras, kit.foundationGroup, kit.framingGroup, kit.scaffoldingGroup);

    return {
      group,
      clearingGroup: kit.clearingGroup,
      levelingPad: kit.levelingPad,
      levelingExtras: kit.levelingExtras,
      foundationGroup: kit.foundationGroup,
      framingParts: kit.framingParts,
      scaffoldingGroup: kit.scaffoldingGroup,
      finishedParts,
      ownedMaterials,
      crystalMesh,
      runeRingA,
      runeRingB,
      wheelMesh,
      rotorMesh,
      fountainJet,
      fountainMist,
      fountainSpray,
      swayPart,
      floatGroup,
      chimneySmokes: chimneySmokes.length > 0 ? chimneySmokes : undefined,
      lastAppliedProgress: -1,
      lastAppliedCompleted: false,
      lastAppliedDisassembling: false,
    };
  }

  /**
   * Builds the authentic multi-stage construction kit for a building plot:
   * 1. Clearing land: corner wooden survey stakes, taut boundary twine, felled brush logs & stumps
   * 2. Leveling land: beveled graded earthen terrace pad + grading pegs & loam heaps
   * 3. Foundation: dressed stone/brick footing plinth + stacked masonry & timber supply piles
   * 4. Framing: either post-and-beam timber frame + pitched rafters OR rising multi-course brick/stone walls
   * 5. Scaffolding: wooden builders' scaffold poles, plank catwalks, diagonal braces & leaning ladder
   */
  private buildConstructionKit(
    b: BuildingInstance,
    footprintRadius: number,
    frameStyle: 'timber' | 'masonry',
    isWaterwaySite = false,
  ): {
    clearingGroup: THREE.Group;
    levelingPad: THREE.Object3D;
    levelingExtras: THREE.Group;
    foundationGroup: THREE.Group;
    framingGroup: THREE.Group;
    framingParts: StagedPart[];
    scaffoldingGroup: THREE.Group;
  } {
    const r = Math.max(1.35, footprintRadius * 0.78);
    const halfW = r * 0.88;
    const halfD = r * 0.76;
    const wallH = footprintRadius >= 2.9 ? 2.55 : footprintRadius >= 2.2 ? 2.05 : 1.65;

    const addKit = <T extends THREE.Object3D>(obj: T, parent: THREE.Object3D): T => {
      obj.userData.selectionTarget = { kind: 'building', id: b.id };
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      parent.add(obj);
      return obj;
    };

    // 1. Clearing Land (0-18%): survey stakes, perimeter twine, felled brush logs & stump
    const clearingGroup = new THREE.Group();
    const corners: [number, number][] = [
      [-halfW * 1.08, -halfD * 1.08],
      [halfW * 1.08, -halfD * 1.08],
      [halfW * 1.08, halfD * 1.08],
      [-halfW * 1.08, halfD * 1.08],
    ];
    for (let i = 0; i < corners.length; i++) {
      const [cx, cz] = corners[i];
      const stake = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.75, 6), this.darkTimberMat), clearingGroup);
      stake.position.set(cx, 0.34, cz);

      const [nx, nz] = corners[(i + 1) % corners.length];
      const span = Math.hypot(nx - cx, nz - cz);
      const twine = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, span, 5), this.ropeMat), clearingGroup);
      twine.position.set((cx + nx) * 0.5, 0.54, (cz + nz) * 0.5);
      twine.rotation.z = Math.PI / 2;
      twine.rotation.y = -Math.atan2(nz - cz, nx - cx);
    }
    // Felled timber logs & freshly cut tree stump being cleared off the plot
    const stump = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.32, 8), this.darkTimberMat), clearingGroup);
    stump.position.set(-halfW * 0.28, 0.14, halfD * 0.18);
    for (let i = 0; i < 3; i++) {
      const log = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, r * 0.95, 7), this.timberMat), clearingGroup);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = 0.35 + i * 0.55;
      log.position.set(halfW * 0.18 + (i - 1) * 0.25, 0.11 + (i === 2 ? 0.15 : 0), -halfD * 0.12 + i * 0.22);
    }
    // Cleared leafy brush tufts
    for (let i = 0; i < 3; i++) {
      const brush = addKit(new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), this.mossLeafMat), clearingGroup);
      brush.scale.set(1.3, 0.55, 1.1);
      brush.position.set(-halfW * 0.52 + i * 0.48, 0.12, -halfD * 0.46 + (i % 2) * 0.28);
    }

    // 2. Leveling Land (18-36%): graded earthen terrace pad OR lashed waterway timber raft crib & pilings!
    const levelingPad = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.12, r * 1.24, 0.24, 16),
      isWaterwaySite ? this.driftwoodMat : this.earthPadMat,
    );
    levelingPad.position.y = isWaterwaySite ? 0.02 : -0.02;
    levelingPad.receiveShadow = true;
    levelingPad.userData.selectionTarget = { kind: 'building', id: b.id };

    const levelingExtras = new THREE.Group();
    for (const [cx, cz] of corners) {
      if (isWaterwaySite) {
        const piling = addKit(
          new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.0, 8), this.beaverBranchMat),
          levelingExtras,
        );
        piling.position.set(cx * 0.96, -0.58, cz * 0.96);
      } else {
        const peg = addKit(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), this.timberMat), levelingExtras);
        peg.position.set(cx * 0.96, 0.26, cz * 0.96);
      }
    }
    if (!isWaterwaySite) {
      const mound = addKit(new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.earthPadMat), levelingExtras);
      mound.scale.set(1.4, 0.52, 1.15);
      mound.position.set(halfW * 0.72, 0.18, halfD * 0.65);
    }

    // 3. Foundation (36-56%): stone/brick plinth & footing + staged supply stack
    const foundationGroup = new THREE.Group();
    const plinthMat = frameStyle === 'masonry' ? this.stoneMat : this.stoneMat;
    const plinth = addKit(
      new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.02, 0.44, halfD * 2.02), plinthMat),
      foundationGroup,
    );
    plinth.position.y = 0.26;
    // Corner dressed footing piers
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pier = addKit(
          new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.54, 0.36), frameStyle === 'masonry' ? this.brickMat : this.stoneMat),
          foundationGroup,
        );
        pier.position.set(sx * halfW, 0.31, sz * halfD);
      }
    }
    // Staged building materials stack beside the foundation
    for (let i = 0; i < 3; i++) {
      const matPiece = addKit(
        new THREE.Mesh(
          frameStyle === 'masonry'
            ? new THREE.BoxGeometry(0.42, 0.2, 0.26)
            : new THREE.CylinderGeometry(0.08, 0.08, 1.05, 7),
          frameStyle === 'masonry' ? this.brickMat : this.timberMat,
        ),
        foundationGroup,
      );
      if (frameStyle === 'timber') {
        matPiece.rotation.z = Math.PI / 2;
        matPiece.position.set(halfW + 0.42, 0.16 + (i === 2 ? 0.14 : 0), -0.18 + (i % 2) * 0.2);
      } else {
        matPiece.position.set(halfW + 0.44, 0.2 + (i === 2 ? 0.21 : 0), -0.18 + (i % 2) * 0.28);
      }
    }

    // 4. Framing (56-80%): timber frame skeleton + rafters OR rising brick/stone wall courses
    const framingGroup = new THREE.Group();
    const framingParts: StagedPart[] = [];
    const addFrame = (obj: THREE.Object3D, revealAt: number) => {
      addKit(obj, framingGroup);
      framingParts.push({ obj, revealAt });
    };

    if (frameStyle === 'timber') {
      // Corner & mid timber posts (56-64%)
      const xPosts = [-halfW * 0.94, 0, halfW * 0.94];
      const zPosts = [-halfD * 0.94, halfD * 0.94];
      for (const px of xPosts) {
        for (const pz of zPosts) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, wallH, 0.14), this.darkTimberMat);
          post.position.set(px, 0.46 + wallH * 0.5, pz);
          addFrame(post, 56 + (px === 0 ? 4 : 0));
        }
      }
      // Horizontal wall plates & cross-beams (64-70%)
      for (const pz of zPosts) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.02, 0.14, 0.15), this.timberMat);
        plate.position.set(0, 0.46 + wallH, pz);
        addFrame(plate, 64);
      }
      for (const px of [-halfW * 0.94, halfW * 0.94]) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, halfD * 2.02), this.timberMat);
        tie.position.set(px, 0.46 + wallH, 0);
        addFrame(tie, 66);
        // Diagonal wind braces
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, wallH * 0.85, 0.1), this.darkTimberMat);
        brace.position.set(px, 0.46 + wallH * 0.5, 0);
        brace.rotation.x = 0.58;
        addFrame(brace, 68);
      }
      // Pitched triangular roof rafters + ridge pole (71-78%)
      const roofRise = Math.max(0.85, halfD * 0.95);
      const rafterLen = Math.hypot(halfD * 1.06, roofRise);
      const rafterTilt = Math.atan2(halfD * 1.06, roofRise);
      for (const rx of [-halfW * 0.86, 0, halfW * 0.86]) {
        for (const side of [-1, 1] as const) {
          const rafter = new THREE.Mesh(new THREE.BoxGeometry(0.1, rafterLen, 0.1), this.timberMat);
          rafter.position.set(rx, 0.46 + wallH + roofRise * 0.5, side * halfD * 0.5);
          rafter.rotation.x = side * rafterTilt;
          addFrame(rafter, 71 + (rx === 0 ? 3 : 0));
        }
      }
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.08, 0.12, 0.12), this.darkTimberMat);
      ridge.position.set(0, 0.46 + wallH + roofRise, 0);
      addFrame(ridge, 75);
    } else {
      // Masonry construction: 4 staggered courses of dressed stone & brick walls rising course-by-course
      const courseCount = 4;
      const courseH = wallH / courseCount;
      for (let cIdx = 0; cIdx < courseCount; cIdx++) {
        const y = 0.48 + (cIdx + 0.5) * courseH;
        const revealAt = 56 + cIdx * 5.2;
        const wallMat = cIdx % 2 === 0 ? this.stoneMat : this.brickMat;

        // Back & side masonry walls
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.94, courseH * 0.94, 0.24), wallMat);
        backWall.position.set(0, y, -halfD * 0.9);
        addFrame(backWall, revealAt);

        for (const side of [-1, 1] as const) {
          const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.24, courseH * 0.94, halfD * 1.84), wallMat);
          sideWall.position.set(side * halfW * 0.9, y, 0);
          addFrame(sideWall, revealAt + 0.6);

          // Front wall segments leaving a central doorway opening in the lower courses
          const frontSegW = cIdx < 2 ? halfW * 0.66 : halfW * 0.97;
          const frontSegX = cIdx < 2 ? side * (halfW * 0.62) : side * (halfW * 0.48);
          const frontWall = new THREE.Mesh(new THREE.BoxGeometry(frontSegW, courseH * 0.94, 0.24), wallMat);
          frontWall.position.set(frontSegX, y, halfD * 0.9);
          addFrame(frontWall, revealAt + 1.2);
        }
      }
      // Timber doorway lintel & upper cornice beam
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(halfW * 0.9, 0.14, 0.3), this.darkTimberMat);
      lintel.position.set(0, 0.48 + courseH * 2.02, halfD * 0.9);
      addFrame(lintel, 68);
    }

    // 5. Builders' wooden scaffolding poles, plank catwalks & leaning ladder (visible 54-99%)
    const scaffoldingGroup = new THREE.Group();
    const scafH = wallH + 0.7;
    const scafZ = halfD + 0.46;
    for (const sx of [-halfW * 0.92, halfW * 0.92]) {
      const pole = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, scafH, 6), this.darkTimberMat), scaffoldingGroup);
      pole.position.set(sx, scafH * 0.5, scafZ);
    }
    for (const catY of [1.18, Math.min(scafH - 0.35, 2.22)]) {
      const plank = addKit(new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.1, 0.08, 0.36), this.timberMat), scaffoldingGroup);
      plank.position.set(0, catY, scafZ - 0.12);
    }
    // Diagonal scaffold cross-brace
    const xBrace = addKit(new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.0, 0.06, 0.06), this.darkTimberMat), scaffoldingGroup);
    xBrace.position.set(0, 1.5, scafZ + 0.04);
    xBrace.rotation.z = 0.42;
    // Leaning wooden builders' ladder on the right flank
    const ladX = halfW + 0.4;
    for (const lz of [-0.18, 0.18]) {
      const rail = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, scafH * 0.95, 6), this.darkTimberMat), scaffoldingGroup);
      rail.position.set(ladX, scafH * 0.46, lz);
      rail.rotation.z = 0.24;
    }
    for (let rIdx = 0; rIdx < 5; rIdx++) {
      const rung = addKit(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 5), this.timberMat), scaffoldingGroup);
      rung.rotation.x = Math.PI / 2;
      const ry = 0.4 + rIdx * 0.38;
      rung.position.set(ladX + 0.22 - ry * 0.24, ry, 0);
    }

    return {
      clearingGroup,
      levelingPad,
      levelingExtras,
      foundationGroup,
      framingGroup,
      framingParts,
      scaffoldingGroup,
    };
  }

  /**
   * Builds a handcrafted arched woodland bridge (either warm timber or mossy dressed stone)
   * whose deck planks match `sampleBridgeDeckY` exactly and animate plank-by-plank while under construction.
   */
  private createBridgeMesh(bridge: BridgeInstance): RenderedBridge {
    const group = new THREE.Group();
    group.position.set(bridge.centerX, 0, bridge.centerZ);
    group.rotation.y = bridge.yaw;

    const stages: { t: number; obj: THREE.Object3D }[] = [];
    const lanterns: THREE.Object3D[] = [];

    const addStage = <T extends THREE.Object3D>(obj: T, t: number): T => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      group.add(obj);
      stages.push({ t, obj });
      return obj;
    };

    const halfLen = bridge.length * 0.5;
    const halfW = bridge.width * 0.5;
    const isStone = bridge.style === 'stone_arch';

    // 1. Sturdy riverbank stone abutments anchored deep into each shore
    for (const endIdx of [0, 1] as const) {
      const tEnd = endIdx === 0 ? 0.0 : 1.0;
      const zPos = endIdx === 0 ? -halfLen : halfLen;
      const deckY = sampleBridgeDeckY(bridge, tEnd);
      const pierH = 2.4;
      const pier = addStage(
        new THREE.Mesh(
          new THREE.BoxGeometry(bridge.width + 0.55, pierH, 1.35),
          this.stoneMat,
        ),
        endIdx === 0 ? 0.02 : 0.88,
      );
      pier.position.set(0, deckY - pierH * 0.5 - 0.06, zPos);
    }

    // 2. Arched deck planks / dressed stone roadway following sampleBridgeDeckY exactly
    const plankCount = Math.max(12, Math.round(bridge.length * 1.9));
    const segLen = bridge.length / plankCount;
    const plankDepth = isStone ? segLen * 1.04 : segLen * 0.84;
    const plankThick = isStone ? 0.24 : 0.14;

    for (let i = 0; i < plankCount; i++) {
      const t = (i + 0.5) / plankCount;
      const tPrev = Math.max(0, t - 0.5 / plankCount);
      const tNext = Math.min(1, t + 0.5 / plankCount);
      const y = sampleBridgeDeckY(bridge, t);
      const dy = sampleBridgeDeckY(bridge, tNext) - sampleBridgeDeckY(bridge, tPrev);
      const dz = (tNext - tPrev) * bridge.length;
      const pitch = -Math.atan2(dy, dz);
      const z = (t - 0.5) * bridge.length;

      const mat = isStone
        ? this.stoneMat
        : i % 3 === 0
          ? this.darkTimberMat
          : this.timberMat;
      const plank = addStage(
        new THREE.Mesh(
          new THREE.BoxGeometry(bridge.width + (isStone ? 0.12 : 0.04), plankThick, plankDepth),
          mat,
        ),
        t * 0.92,
      );
      plank.position.set(0, y - plankThick * 0.5, z);
      plank.rotation.x = pitch;
    }

    // 3. Structural arch ribs / stone vault segments + bank pilings
    const ribSegs = Math.max(8, Math.round(bridge.length * 0.9));
    for (let i = 0; i < ribSegs; i++) {
      const t0 = i / ribSegs;
      const t1 = (i + 1) / ribSegs;
      const tm = (t0 + t1) * 0.5;
      const z0 = (t0 - 0.5) * bridge.length;
      const z1 = (t1 - 0.5) * bridge.length;
      const y0 = sampleBridgeDeckY(bridge, t0) - (isStone ? 0.34 : 0.24);
      const y1 = sampleBridgeDeckY(bridge, t1) - (isStone ? 0.34 : 0.24);
      const span = Math.hypot(z1 - z0, y1 - y0) + 0.08;
      const pitch = -Math.atan2(y1 - y0, z1 - z0);
      const ym = (y0 + y1) * 0.5;
      const zm = (z0 + z1) * 0.5;

      for (const side of [-1, 1] as const) {
        const rib = addStage(
          new THREE.Mesh(
            new THREE.BoxGeometry(isStone ? 0.34 : 0.2, isStone ? 0.48 : 0.26, span),
            isStone ? this.stoneMat : this.darkTimberMat,
          ),
          tm * 0.9,
        );
        rib.position.set(side * (halfW - 0.14), ym, zm);
        rib.rotation.x = pitch;
      }

      // Stone bridge mossy accents near the lower haunches
      if (isStone && (i === 1 || i === ribSegs - 2)) {
        for (const side of [-1, 1] as const) {
          const moss = addStage(
            new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), this.mossLeafMat),
            tm * 0.94,
          );
          moss.position.set(side * (halfW + 0.04), ym - 0.1, zm);
          moss.scale.set(0.7, 0.55, 1.35);
        }
      }
    }

    // 4. Balustrade posts, curved handrails / low stone parapets, and entrance lanterns
    const postCount = Math.max(4, Math.round(bridge.length * 0.45)) + 1;
    const postHeight = isStone ? 0.72 : 0.92;
    for (let i = 0; i < postCount; i++) {
      const t = i / (postCount - 1);
      const z = (t - 0.5) * bridge.length;
      const y = sampleBridgeDeckY(bridge, t);
      const isEntrance = i === 0 || i === postCount - 1;

      for (const side of [-1, 1] as const) {
        const x = side * (halfW + 0.04);
        const h = isEntrance ? postHeight + 0.24 : postHeight;
        const post = addStage(
          new THREE.Mesh(
            new THREE.BoxGeometry(isStone ? 0.26 : 0.16, h, isStone ? 0.26 : 0.16),
            isStone ? this.stoneMat : this.darkTimberMat,
          ),
          t * 0.94,
        );
        post.position.set(x, y + h * 0.5 - 0.08, z);

        if (isEntrance) {
          const lanternGroup = new THREE.Group();
          lanternGroup.position.set(x, y + h + 0.06, z);
          const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.2, 8), this.windowMat);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.1, 8), this.brassMat);
          cap.position.y = 0.14;
          lanternGroup.add(glass, cap);
          group.add(lanternGroup);
          lanterns.push(lanternGroup);
        }
      }

      // Connect consecutive posts with curved timber handrail or stone parapet wall
      if (i < postCount - 1) {
        const tNext = (i + 1) / (postCount - 1);
        const zNext = (tNext - 0.5) * bridge.length;
        const yNext = sampleBridgeDeckY(bridge, tNext);
        const railSpan = Math.hypot(zNext - z, yNext - y) + 0.06;
        const railPitch = -Math.atan2(yNext - y, zNext - z);
        const railY = (y + yNext) * 0.5 + (isStone ? 0.34 : 0.8);
        const railZ = (z + zNext) * 0.5;

        for (const side of [-1, 1] as const) {
          const rail = addStage(
            new THREE.Mesh(
              new THREE.BoxGeometry(isStone ? 0.22 : 0.11, isStone ? 0.56 : 0.1, railSpan),
              isStone ? this.stoneMat : this.timberMat,
            ),
            ((t + tNext) * 0.5) * 0.95,
          );
          rail.position.set(side * (halfW + 0.04), railY, railZ);
          rail.rotation.x = railPitch;
        }
      }
    }

    return { group, stages, lanterns, lastAppliedProgress: -1, lastAppliedCompleted: false };
  }

  dispose(): void {
    const sharedGeos = new Set<THREE.BufferGeometry>([
      this.bellRoofGeo,
      this.acornSiloGeo,
      this.gableRoofGeo,
      this.fountainBowlGeo,
      this.sharedFlameGeo,
      ...this.fountainWater.sharedGeometries,
    ]);
    const fireGroups = new Set<THREE.Object3D>(this.hearths.map((h) => h.fire.group));
    this.rootGroup.traverse((obj) => {
      if (obj.parent && fireGroups.has(obj.parent)) return;
      if (
        (obj instanceof THREE.Mesh || obj instanceof THREE.Points) &&
        obj.geometry &&
        !sharedGeos.has(obj.geometry)
      ) {
        obj.geometry.dispose();
      }
    });
    for (const g of sharedGeos) g.dispose();
    this.fountainWater.dispose();
    for (const d of this.extraDisposables) d.dispose();
    this.extraDisposables.length = 0;
    for (const entry of this.buildingMeshes.values()) {
      for (const mat of entry.ownedMaterials) {
        mat.dispose();
      }
    }
    this.buildingMeshes.clear();
    for (const marker of this.warBanners.values()) {
      this.disposeWarBannerMarker(marker);
    }
    this.warBanners.clear();
    for (const h of this.hearths) {
      h.fire.dispose();
    }
    this.hearths.length = 0;

    this.timberMat.dispose();
    this.darkTimberMat.dispose();
    this.plasterMat.dispose();
    this.warmPlasterMat.dispose();
    this.thatchMat.dispose();
    this.slateRoofMat.dispose();
    this.verdigrisMat.dispose();
    this.brickMat.dispose();
    this.glassMat.dispose();
    this.fountainWaterMat.dispose();
    this.canvasSailMat.dispose();
    this.stoneMat.dispose();
    this.windowMat.dispose();
    this.shrineCrystalMat.dispose();
    this.brassMat.dispose();
    this.doorMat.dispose();
    this.mossLeafMat.dispose();
    this.flowerPinkMat.dispose();
    this.flowerGoldMat.dispose();
    this.flowerBlueMat.dispose();
    this.charredLogMat.dispose();
    this.ovenFireMat.dispose();
    this.chimneySmokeMat.dispose();
    this.potteryMat.dispose();
    this.earthPadMat.dispose();
    this.ropeMat.dispose();
    this.driftwoodMat.dispose();
    this.tealTrimMat.dispose();
    this.mossRoofMat.dispose();
    this.terracottaPlasterMat.dispose();
    this.terracottaRoofMat.dispose();
    this.ochreCanvasMat.dispose();
    this.goldenThatchMat.dispose();
    this.graniteMat.dispose();
    this.waterLilyMat.dispose();
    this.lotusPinkMat.dispose();
    this.coralMat.dispose();
    this.pearlGlowMat.dispose();
    this.bambooMat.dispose();
    this.beaverBranchMat.dispose();
  }
}
