import * as THREE from 'three';
import type { Season } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { isPointNearBridge } from '@simulation/terrain/Bridge';
import type { TreeSpot } from '@simulation/terrain/TerrainMap';
import type { WorldState } from '@simulation/WorldState';
import {
  createBerryBushGeo,
  createBirchCanopyGeo,
  createCragSpireGeo,
  createCurvedBirchTrunkGeo,
  createCurvedGrassTuftGeo,
  createFernRosetteGeo,
  createGnarledOakTrunkGeo,
  createHorizonBroadleafGeo,
  createLilyPadGeo,
  createLotusBloomGeo,
  createMossyBoulderGeo,
  createOakCanopyGeo,
  createToadstoolClusterGeo,
  createWildflowerClusterGeo,
  mergePartGeometries,
} from './GeometryHelpers';
import {
  buildProceduralHorizonPines,
  buildProceduralPineForest,
  type HorizonPinePlacement,
  type ProceduralPineForestResult,
} from './ProceduralPineBuilder';
import type { PbrTextureSet, TextureLibrary } from './ProceduralTextures';
import type { SkyLightingState } from './WaterShader';

interface FoliageUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uDaylight: { value: number };
  uCloudTime: { value: number };
  uCloudCoverage: { value: number };
}

interface ClearableTreeGroup {
  readonly spots: TreeSpot[];
  readonly trunks: THREE.InstancedMesh;
  readonly crowns: THREE.InstancedMesh;
  readonly cleared: Uint8Array;
}

function makeNormalOrBumpProps(
  tex: PbrTextureSet,
  normalStrength: number,
  bumpFallback: number,
): Partial<THREE.MeshStandardMaterialParameters> {
  if (tex.normalMap) {
    return {
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(normalStrength, normalStrength),
    };
  }
  return {
    bumpMap: tex.bumpMap,
    bumpScale: bumpFallback,
  };
}

/**
 * Shared vertex wind displacement chunk used by both color and shadow-depth foliage passes
 * so dappled leaf shadows sway organically in perfect sync with the canopy.
 */
function buildCanopyWindVertexChunk(windAmp: number): string {
  return `#include <begin_vertex>
    vec3 instOrigin = vec3(0.0);
    #ifdef USE_INSTANCING
      instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    #endif
    float canopyMask = smoothstep(2.0, 6.8, position.y);
    float phase = uTime * (1.45 + uWindStrength * 1.15) + instOrigin.x * 0.27 + instOrigin.z * 0.21;
    float gust = sin(phase + position.y * 0.45) * 0.65 + cos(phase * 1.8 + position.x * 1.3 + position.z * 1.1) * 0.35;
    float flutter = sin(uTime * 4.2 + position.x * 3.1 + position.z * 2.7 + instOrigin.x) * 0.22;
    float sway = (gust + flutter) * ${windAmp.toFixed(3)} * (0.65 + uWindStrength * 0.95) * canopyMask;
    transformed.x += sway;
    transformed.z += sway * 0.68;
    transformed.y += flutter * 0.042 * canopyMask;`;
}

function enhanceFoliageDepthMaterial(
  mat: THREE.MeshDepthMaterial,
  uniforms: FoliageUniforms,
  windAmp: number,
): void {
  mat.customProgramCacheKey = () => `forest-foliage-depth-${windAmp.toFixed(3)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;`,
      )
      .replace('#include <begin_vertex>', buildCanopyWindVertexChunk(windAmp));
  };
}

/**
 * Enhances a standard foliage material with gentle GPU breeze flutter, natural backlit
 * chlorophyll translucency, and synchronized drifting cloud shadows.
 */
function enhanceBotanicalFoliageMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: FoliageUniforms,
  windAmp: number,
  translucency: number,
): void {
  mat.customProgramCacheKey = () => `forest-foliage-v2-${windAmp.toFixed(2)}-${translucency.toFixed(2)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uSunColor = uniforms.uSunColor;
    shader.uniforms.uDaylight = uniforms.uDaylight;
    shader.uniforms.uCloudTime = uniforms.uCloudTime;
    shader.uniforms.uCloudCoverage = uniforms.uCloudCoverage;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        varying vec3 vFoliageWorldPos;`,
      )
      .replace('#include <begin_vertex>', buildCanopyWindVertexChunk(windAmp))
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fWorldPos = instanceMatrix * fWorldPos;
        #endif
        fWorldPos = modelMatrix * fWorldPos;
        vFoliageWorldPos = fWorldPos.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDaylight;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        varying vec3 vFoliageWorldPos;

        float fHash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.53);
          return fract(p.x * p.y);
        }
        float fNoise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(fHash21(i), fHash21(i + vec2(1.0, 0.0)), f.x),
            mix(fHash21(i + vec2(0.0, 1.0)), fHash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 fViewDir = normalize(cameraPosition - vFoliageWorldPos);
        float backLit = pow(clamp(dot(fViewDir, -normalize(uSunDir)), 0.0, 1.0), 3.2);
        // Natural chlorophyll warmth when sunlit from behind
        vec3 sssTint = diffuseColor.rgb * vec3(1.12, 1.18, 0.72);
        vec2 fCloudUv = vFoliageWorldPos.xz * 0.0046 + vec2(uCloudTime * 0.011, uCloudTime * 0.0045);
        float fCloudN = fNoise2(fCloudUv) * 0.65 + fNoise2(fCloudUv * 2.1 + 4.3) * 0.35;
        float fCloudThresh = mix(0.64, 0.34, clamp(uCloudCoverage, 0.0, 1.0));
        float fCloudShadow = smoothstep(fCloudThresh, fCloudThresh + 0.22, fCloudN);
        float fSunVis = mix(1.0, 0.72, fCloudShadow * uDaylight * (1.0 - uCloudCoverage * 0.35));
        outgoingLight *= fSunVis;
        outgoingLight += sssTint * uSunColor * (0.14 + 0.86 * backLit) * uDaylight * fSunVis * ${translucency.toFixed(3)};
        #include <opaque_fragment>`,
      );
  };
}

/**
 * World-aligned coherent tree wind sway + local bough flutter for per-bough instanced
 * procedural pines, driven by per-instance `aWindData = vec3(treeOriginX, treeOriginZ, swayWeight)`.
 */
function buildPineBoughProjectVertexChunk(windAmp: number, writeWorldPos: boolean): string {
  return `vec4 mvPosition = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif
    float pTip = clamp(length(position.xyz), 0.15, 1.45);
    float pMask = aWindData.z * (0.52 + 0.48 * pTip);
    float pPhase = uTime * (1.42 + uWindStrength * 1.15) + aWindData.x * 0.27 + aWindData.y * 0.21;
    float pGust = sin(pPhase + mvPosition.y * 0.35) * 0.65 + cos(pPhase * 1.75 + mvPosition.x * 0.75 + mvPosition.z * 0.65) * 0.35;
    float pFlutter = sin(uTime * 4.1 + mvPosition.x * 2.9 + mvPosition.z * 2.5) * 0.20;
    float pSway = (pGust + pFlutter) * ${windAmp.toFixed(3)} * (0.65 + uWindStrength * 0.95) * pMask;
    mvPosition.x += pSway;
    mvPosition.z += pSway * 0.68;
    mvPosition.y += pFlutter * 0.036 * pMask;
    ${writeWorldPos ? 'vec4 fWorldPos = modelMatrix * mvPosition;\n    vFoliageWorldPos = fWorldPos.xyz;' : ''}
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`;
}

function enhancePineBoughDepthMaterial(
  mat: THREE.MeshDepthMaterial,
  uniforms: FoliageUniforms,
  windAmp: number,
): void {
  mat.customProgramCacheKey = () => `forest-pine-bough-depth-${windAmp.toFixed(3)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aWindData;
        uniform float uTime;
        uniform float uWindStrength;`,
      )
      .replace('#include <project_vertex>', buildPineBoughProjectVertexChunk(windAmp, false));
  };
}

function enhancePineBoughFoliageMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: FoliageUniforms,
  windAmp: number,
  translucency: number,
): void {
  mat.customProgramCacheKey = () => `forest-pine-bough-v1-${windAmp.toFixed(2)}-${translucency.toFixed(2)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uSunColor = uniforms.uSunColor;
    shader.uniforms.uDaylight = uniforms.uDaylight;
    shader.uniforms.uCloudTime = uniforms.uCloudTime;
    shader.uniforms.uCloudCoverage = uniforms.uCloudCoverage;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aWindData;
        uniform float uTime;
        uniform float uWindStrength;
        varying vec3 vFoliageWorldPos;`,
      )
      .replace('#include <project_vertex>', buildPineBoughProjectVertexChunk(windAmp, true));

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDaylight;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        varying vec3 vFoliageWorldPos;

        float fHash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.53);
          return fract(p.x * p.y);
        }
        float fNoise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(fHash21(i), fHash21(i + vec2(1.0, 0.0)), f.x),
            mix(fHash21(i + vec2(0.0, 1.0)), fHash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 fViewDir = normalize(cameraPosition - vFoliageWorldPos);
        float backLit = pow(clamp(dot(fViewDir, -normalize(uSunDir)), 0.0, 1.0), 3.2);
        vec3 sssTint = diffuseColor.rgb * vec3(1.10, 1.16, 0.74);
        vec2 fCloudUv = vFoliageWorldPos.xz * 0.0046 + vec2(uCloudTime * 0.011, uCloudTime * 0.0045);
        float fCloudN = fNoise2(fCloudUv) * 0.65 + fNoise2(fCloudUv * 2.1 + 4.3) * 0.35;
        float fCloudThresh = mix(0.64, 0.34, clamp(uCloudCoverage, 0.0, 1.0));
        float fCloudShadow = smoothstep(fCloudThresh, fCloudThresh + 0.22, fCloudN);
        float fSunVis = mix(1.0, 0.72, fCloudShadow * uDaylight * (1.0 - uCloudCoverage * 0.35));
        outgoingLight *= fSunVis;
        outgoingLight += sssTint * uSunColor * (0.14 + 0.86 * backLit) * uDaylight * fSunVis * ${translucency.toFixed(3)};
        #include <opaque_fragment>`,
      );
  };
}

/**
 * Enhances instanced grass tufts with rolling GPU wind waves and subtle backlit translucency.
 */
function enhanceGrassWindMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: FoliageUniforms,
): void {
  mat.customProgramCacheKey = () => 'forest-prairie-grass-wind-v3';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uSunColor = uniforms.uSunColor;
    shader.uniforms.uDaylight = uniforms.uDaylight;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        varying vec3 vGrassWorldPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 gOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          gOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float tipMask = smoothstep(0.06, 0.72, position.y);
        float wavePhase = uTime * (1.75 + uWindStrength * 1.55) + gOrigin.x * 0.11 + gOrigin.z * 0.085;
        float gust = sin(wavePhase) * 0.62 + cos(wavePhase * 1.7 + gOrigin.z * 0.17) * 0.38;
        float sway = gust * (0.085 + uWindStrength * 0.14) * tipMask;
        transformed.x += sway;
        transformed.z += sway * 0.58;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 gWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gWorldPos = instanceMatrix * gWorldPos;
        #endif
        gWorldPos = modelMatrix * gWorldPos;
        vGrassWorldPos = gWorldPos.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDaylight;
        varying vec3 vGrassWorldPos;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 gViewDir = normalize(cameraPosition - vGrassWorldPos);
        float gBackLit = pow(clamp(dot(gViewDir, -normalize(uSunDir)), 0.0, 1.0), 3.5);
        outgoingLight += diffuseColor.rgb * uSunColor * (0.08 + 0.92 * gBackLit) * uDaylight * 0.28;
        #include <opaque_fragment>`,
      );
  };
}

/**
 * High-resolution naturalistic instanced woodland flora renderer:
 * normal-mapped ancient oaks, conifers, and silver birches with wind-synced dappled shadows,
 * backlit leaf translucency, leafy alpha-cutout woodland shrubs, feathery alpha-cutout
 * distant horizon tree lines, and seasonal botanical color calibration.
 */
export class FloraRenderer {
  private readonly group = new THREE.Group();
  private readonly oakFoliageMat: THREE.MeshStandardMaterial;
  private readonly pineFoliageMat: THREE.MeshStandardMaterial;
  private readonly birchFoliageMat: THREE.MeshStandardMaterial;
  private readonly distantPineMat: THREE.MeshStandardMaterial;
  private readonly distantBroadleafMat: THREE.MeshStandardMaterial;
  private readonly grassMat: THREE.MeshStandardMaterial;
  private readonly fernMat: THREE.MeshStandardMaterial;
  private readonly bushMat: THREE.MeshStandardMaterial;
  private readonly toadstoolCapMat: THREE.MeshStandardMaterial;
  private readonly fairyLanternMat: THREE.MeshStandardMaterial;
  private readonly wildflowerGroup = new THREE.Group();
  private readonly lilyGroup = new THREE.Group();
  private readonly clearableTreeGroups: ClearableTreeGroup[] = [];
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private proceduralPines: ProceduralPineForestResult | null = null;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly foliageUniforms: FoliageUniforms;
  private lastSeason: Season | null = null;
  private lastStructureRevision = -1;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    textures: TextureLibrary,
    grassMultiplier = 1.0,
  ) {
    this.foliageUniforms = {
      uTime: { value: 0 },
      uWindStrength: { value: 0.25 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d8) },
      uDaylight: { value: 1.0 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.38 },
    };

    // Filter out trees sitting directly inside initial settlement clearings
    const validTrees = world.terrain.trees.filter((tree) => {
      for (const s of world.settlements) {
        if (Math.hypot(tree.x - s.center.x, tree.z - s.center.z) < 11.5) {
          return false;
        }
      }
      return true;
    });

    const oaks = validTrees.filter((t) => t.kind === 'oak');
    const pines = validTrees.filter((t) => t.kind === 'pine');
    const birches = validTrees.filter((t) => t.kind === 'birch');

    const oakBarkMat = new THREE.MeshStandardMaterial({
      map: textures.oakBark.map,
      ...makeNormalOrBumpProps(textures.oakBark, 1.1, 0.22),
      roughnessMap: textures.oakBark.roughnessMap,
      roughness: 0.94,
    });
    const pineBarkMat = new THREE.MeshStandardMaterial({
      map: textures.pineBark.map,
      ...makeNormalOrBumpProps(textures.pineBark, 1.05, 0.22),
      roughnessMap: textures.pineBark.roughnessMap,
      roughness: 0.92,
    });
    const birchBarkMat = new THREE.MeshStandardMaterial({
      map: textures.birchBark.map,
      ...makeNormalOrBumpProps(textures.birchBark, 0.75, 0.14),
      roughnessMap: textures.birchBark.roughnessMap,
      roughness: 0.85,
    });

    // Botanical alpha-cutout PBR foliage materials with wind-synced dappled shadow depth materials
    this.oakFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.oakLeafCluster,
      color: 0x4b7438,
      roughness: 0.76,
      metalness: 0.01,
      alphaTest: 0.40,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceBotanicalFoliageMaterial(this.oakFoliageMat, this.foliageUniforms, 0.11, 0.32);

    this.pineFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.pineNeedleSpray,
      color: 0x2c563a,
      roughness: 0.82,
      metalness: 0.01,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhancePineBoughFoliageMaterial(this.pineFoliageMat, this.foliageUniforms, 0.095, 0.22);

    this.birchFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.birchLeafCluster,
      color: 0x6f9446,
      roughness: 0.70,
      metalness: 0.01,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceBotanicalFoliageMaterial(this.birchFoliageMat, this.foliageUniforms, 0.15, 0.40);

    // Feathery alpha-cutout materials for the endless distant horizon woodland
    this.distantPineMat = new THREE.MeshStandardMaterial({
      map: textures.pineNeedleSpray,
      color: 0x294d35,
      roughness: 0.92,
      metalness: 0.0,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.distantBroadleafMat = new THREE.MeshStandardMaterial({
      map: textures.oakLeafCluster,
      color: 0x416834,
      roughness: 0.90,
      metalness: 0.0,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    const oakDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.oakLeafCluster,
      alphaTest: 0.40,
    });
    enhanceFoliageDepthMaterial(oakDepthMat, this.foliageUniforms, 0.11);

    const pineDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.pineNeedleSpray,
      alphaTest: 0.36,
    });
    enhancePineBoughDepthMaterial(pineDepthMat, this.foliageUniforms, 0.095);

    const birchDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.birchLeafCluster,
      alphaTest: 0.38,
    });
    enhanceFoliageDepthMaterial(birchDepthMat, this.foliageUniforms, 0.15);

    this.grassMat = new THREE.MeshStandardMaterial({
      color: 0x9bb572,
      roughness: 0.86,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceGrassWindMaterial(this.grassMat, this.foliageUniforms);

    this.fernMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.80,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    // Leafy alpha-cutout woodland shrub material (replaces smooth sphere-puff bushes)
    this.bushMat = new THREE.MeshStandardMaterial({
      map: textures.oakLeafCluster,
      color: 0x456b34,
      roughness: 0.82,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    // Natural waxy woodland toadstool cap (zero daytime neon emissive)
    this.toadstoolCapMat = new THREE.MeshStandardMaterial({
      map: textures.toadstoolCap,
      roughness: 0.36,
      metalness: 0.02,
    });

    this.fairyLanternMat = new THREE.MeshStandardMaterial({
      color: 0xecdcb6,
      emissive: 0xffaa42,
      emissiveIntensity: 0.1,
      roughness: 0.28,
    });

    this.disposables.push(
      oakBarkMat,
      pineBarkMat,
      birchBarkMat,
      this.oakFoliageMat,
      this.pineFoliageMat,
      this.birchFoliageMat,
      this.distantPineMat,
      this.distantBroadleafMat,
      oakDepthMat,
      pineDepthMat,
      birchDepthMat,
      this.grassMat,
      this.fernMat,
      this.bushMat,
      this.toadstoolCapMat,
      this.fairyLanternMat,
    );

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    // 1. Realistic Ancient Oaks
    if (oaks.length > 0) {
      const trunkGeo = createGnarledOakTrunkGeo();
      const crownGeo = createOakCanopyGeo();
      const lanternGeo = new THREE.SphereGeometry(0.12, 10, 8);
      this.disposables.push(trunkGeo, crownGeo, lanternGeo);

      const trunks = new THREE.InstancedMesh(trunkGeo, oakBarkMat, oaks.length);
      const crowns = new THREE.InstancedMesh(crownGeo, this.oakFoliageMat, oaks.length);
      crowns.customDepthMaterial = oakDepthMat;
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;

      const lanternPositions: THREE.Vector3[] = [];

      oaks.forEach((t, i) => {
        const tiltX = ((i * 19) % 11 - 5) * 0.008;
        const tiltZ = ((i * 31) % 11 - 5) * 0.008;
        const widthVar = 0.92 + ((i * 13) % 7) * 0.03;

        dummy.position.set(t.x, t.y - 0.14, t.z);
        dummy.rotation.set(tiltX, t.rotation, tiltZ);
        dummy.scale.set(t.scale * widthVar, t.scale, t.scale * widthVar);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        crowns.setMatrixAt(i, dummy.matrix);

        const v = ((i * 17) % 13) / 12 - 0.5;
        tint.setRGB(1 + v * 0.16, 1 + v * 0.10, 1 - v * 0.10);
        crowns.setColorAt(i, tint);

        if (i % 7 === 0) {
          const cosR = Math.cos(t.rotation);
          const sinR = Math.sin(t.rotation);
          const lx = 1.45 * cosR - 0.65 * sinR;
          const lz = 1.45 * sinR + 0.65 * cosR;
          lanternPositions.push(
            new THREE.Vector3(t.x + lx * t.scale, t.y + 3.45 * t.scale, t.z + lz * t.scale),
          );
        }
      });

      this.group.add(trunks, crowns);
      this.clearableTreeGroups.push({
        spots: oaks,
        trunks,
        crowns,
        cleared: new Uint8Array(oaks.length),
      });

      if (lanternPositions.length > 0) {
        const lanterns = new THREE.InstancedMesh(lanternGeo, this.fairyLanternMat, lanternPositions.length);
        lanternPositions.forEach((p, idx) => {
          dummy.position.copy(p);
          dummy.rotation.set(0, idx, 0);
          dummy.scale.set(1, 1.25, 1);
          dummy.updateMatrix();
          lanterns.setMatrixAt(idx, dummy.matrix);
        });
        this.group.add(lanterns);
      }
    }

    // 2. Per-Tree Unique Procedural Conifer & Pine Forest:
    //    Every single pine tree is generated individually with its own curved trunk,
    //    optional twin-leader fork, weathered stubs, whorl spacing, storm gaps, and foliage hue.
    if (pines.length > 0) {
      this.proceduralPines = buildProceduralPineForest(
        pines,
        (x, z, y) =>
          y !== undefined
            ? world.terrain.getBiomeAtKnownHeight(x, z, y)
            : world.terrain.getBiomeAt(x, z),
        (x, z) => world.terrain.getCoastSignedDistance(x, z),
        pineBarkMat,
        this.pineFoliageMat,
        pineDepthMat,
      );
      this.disposables.push(...this.proceduralPines.disposables);
      this.group.add(this.proceduralPines.trunksMesh, ...this.proceduralPines.frondMeshes);
    }

    // 3. Realistic Silver Birches
    if (birches.length > 0) {
      const trunkGeo = createCurvedBirchTrunkGeo();
      const crownGeo = createBirchCanopyGeo();
      this.disposables.push(trunkGeo, crownGeo);

      const trunks = new THREE.InstancedMesh(trunkGeo, birchBarkMat, birches.length);
      const crowns = new THREE.InstancedMesh(crownGeo, this.birchFoliageMat, birches.length);
      crowns.customDepthMaterial = birchDepthMat;
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;

      birches.forEach((t, i) => {
        const lean = ((i * 13) % 9 - 4) * 0.012;
        dummy.position.set(t.x, t.y - 0.14, t.z);
        dummy.rotation.set(lean, t.rotation, -lean * 0.8);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        crowns.setMatrixAt(i, dummy.matrix);

        const v = ((i * 23) % 11) / 10 - 0.5;
        tint.setRGB(1 + v * 0.14, 1 + v * 0.1, 1 - v * 0.08);
        crowns.setColorAt(i, tint);
      });
      this.group.add(trunks, crowns);
      this.clearableTreeGroups.push({
        spots: birches,
        trunks,
        crowns,
        cleared: new Uint8Array(birches.length),
      });
    }

    // 3b. Endless Horizon Woodland Ring — feathery botanical card canopies across distant hills
    const rng = world.rng.fork();
    this.buildHorizonForestRing(rng, dummy, tint);

    // 4. Sculpted Mossy Woodland Boulders vs. Sharp Alpine Crags & Desert Outcrops
    if (world.terrain.rocks.length > 0) {
      const mossyRockSpots: Array<{ spot: (typeof world.terrain.rocks)[number]; biome: string }> = [];
      const cragRockSpots: Array<{ spot: (typeof world.terrain.rocks)[number]; biome: string }> = [];

      for (const r of world.terrain.rocks) {
        const rockBiome = world.terrain.getBiomeAtKnownHeight(r.x, r.z, r.y);
        if (rockBiome === 'alpine_crag' || rockBiome === 'rocky_ridge' || rockBiome === 'desert') {
          cragRockSpots.push({ spot: r, biome: rockBiome });
        } else {
          mossyRockSpots.push({ spot: r, biome: rockBiome });
        }
      }

      const rockTex = textures.rock ?? textures.stone;

      if (mossyRockSpots.length > 0) {
        const rockGeo = createMossyBoulderGeo();
        const rockMat = new THREE.MeshStandardMaterial({
          map: rockTex.map,
          ...makeNormalOrBumpProps(rockTex, 1.0, 0.18),
          roughnessMap: rockTex.roughnessMap,
          roughness: 0.90,
          vertexColors: true,
        });
        this.disposables.push(rockGeo, rockMat);

        const rocks = new THREE.InstancedMesh(rockGeo, rockMat, mossyRockSpots.length * 2);
        rocks.castShadow = true;
        rocks.receiveShadow = true;

        mossyRockSpots.forEach(({ spot: r, biome }, i) => {
          dummy.position.set(r.x, r.y + 0.14 * r.scale, r.z);
          dummy.rotation.set(r.variant * 0.25, r.rotation, r.variant * 0.18);
          dummy.scale.set(r.scale * 1.24, r.scale * 0.72, r.scale * 1.08);
          dummy.updateMatrix();
          rocks.setMatrixAt(i * 2, dummy.matrix);

          if (biome === 'seashore') {
            tint.setHex(0xbcb7aa);
          } else if (biome === 'moss_hollow' || biome === 'deep_woods') {
            tint.setHex(0x88997c);
          } else {
            tint.setHex(0xb2b6ac);
          }
          rocks.setColorAt(i * 2, tint);

          const px = r.x + Math.cos(r.rotation) * r.scale * 0.95;
          const pz = r.z + Math.sin(r.rotation) * r.scale * 0.95;
          const py = world.terrain.getHeightAt(px, pz);
          dummy.position.set(px, py + 0.08 * r.scale, pz);
          dummy.rotation.set(0.15, r.rotation + 1.4, 0.1);
          dummy.scale.set(r.scale * 0.48, r.scale * 0.34, r.scale * 0.44);
          dummy.updateMatrix();
          rocks.setMatrixAt(i * 2 + 1, dummy.matrix);
          rocks.setColorAt(i * 2 + 1, tint);
        });
        this.group.add(rocks);
      }

      if (cragRockSpots.length > 0) {
        const cragGeo = createCragSpireGeo();
        const cragMat = new THREE.MeshStandardMaterial({
          map: rockTex.map,
          ...makeNormalOrBumpProps(rockTex, 1.25, 0.26),
          roughnessMap: rockTex.roughnessMap,
          roughness: 0.93,
          vertexColors: true,
        });
        this.disposables.push(cragGeo, cragMat);

        const crags = new THREE.InstancedMesh(cragGeo, cragMat, cragRockSpots.length * 2);
        crags.castShadow = true;
        crags.receiveShadow = true;

        cragRockSpots.forEach(({ spot: r, biome }, i) => {
          if (biome === 'alpine_crag') {
            const hMult = 1.65 + (r.variant % 3) * 0.45;
            dummy.position.set(r.x, r.y - 0.18 * r.scale, r.z);
            dummy.rotation.set((r.variant - 1) * 0.14, r.rotation, ((i % 3) - 1) * 0.12);
            dummy.scale.set(r.scale * 1.18, r.scale * hMult, r.scale * 1.05);
            tint.setHex(r.y > 42 ? 0xbec7ce : 0x6c737b);
          } else if (biome === 'desert') {
            const hMult = 0.82 + (r.variant % 3) * 0.26;
            dummy.position.set(r.x, r.y - 0.12 * r.scale, r.z);
            dummy.rotation.set(0.06, r.rotation, -0.05);
            dummy.scale.set(r.scale * 1.42, r.scale * hMult, r.scale * 1.24);
            tint.setHex(i % 2 === 0 ? 0xc29265 : 0xad764e);
          } else {
            const hMult = 1.15 + (r.variant % 3) * 0.3;
            dummy.position.set(r.x, r.y - 0.14 * r.scale, r.z);
            dummy.rotation.set(r.variant * 0.18, r.rotation, r.variant * 0.12);
            dummy.scale.set(r.scale * 1.22, r.scale * hMult, r.scale * 1.08);
            tint.setHex(0x838b8f);
          }
          dummy.updateMatrix();
          crags.setMatrixAt(i * 2, dummy.matrix);
          crags.setColorAt(i * 2, tint);

          const px = r.x + Math.cos(r.rotation + 0.9) * r.scale * 1.15;
          const pz = r.z + Math.sin(r.rotation + 0.9) * r.scale * 1.15;
          const py = world.terrain.getHeightAt(px, pz);
          dummy.position.set(px, py - 0.08 * r.scale, pz);
          dummy.rotation.set(0.22, r.rotation + 1.6, -0.18);
          dummy.scale.set(
            r.scale * 0.62,
            r.scale * (biome === 'alpine_crag' ? 0.92 : 0.46),
            r.scale * 0.56,
          );
          dummy.updateMatrix();
          crags.setMatrixAt(i * 2 + 1, dummy.matrix);
          crags.setColorAt(i * 2 + 1, tint);
        });
        this.group.add(crags);
      }
    }

    // 5. Arching Ferns (variant 0), Leafy Berry Shrubs (variant 1), Woodland Toadstools (variant 2)
    const ferns = world.terrain.undergrowth.filter((u) => u.variant === 0);
    const bushes = world.terrain.undergrowth.filter((u) => u.variant === 1);
    const shrooms = world.terrain.undergrowth.filter((u) => u.variant === 2);

    if (ferns.length > 0) {
      const fernGeo = createFernRosetteGeo();
      this.disposables.push(fernGeo);
      const fernMesh = new THREE.InstancedMesh(fernGeo, this.fernMat, ferns.length);
      fernMesh.castShadow = true;
      fernMesh.receiveShadow = true;
      ferns.forEach((f, i) => {
        dummy.position.set(f.x, f.y - 0.02, f.z);
        dummy.rotation.set(0, f.rotation, 0);
        dummy.scale.setScalar(f.scale * 1.34);
        dummy.updateMatrix();
        fernMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(fernMesh);
    }

    if (bushes.length > 0) {
      const { foliage, berries } = createBerryBushGeo();
      const berryMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.28,
        metalness: 0.04,
      });
      this.disposables.push(foliage, berries, berryMat);

      const bushMesh = new THREE.InstancedMesh(foliage, this.bushMat, bushes.length);
      const berryMesh = new THREE.InstancedMesh(berries, berryMat, bushes.length);
      bushMesh.castShadow = true;
      bushMesh.receiveShadow = true;
      bushMesh.customDepthMaterial = oakDepthMat;

      const berryPalette = [0xa8282b, 0x2f3b6b, 0xc77c26, 0x8f2c4e];
      bushes.forEach((b, i) => {
        dummy.position.set(b.x, b.y - 0.04, b.z);
        dummy.rotation.set(0, b.rotation, 0);
        dummy.scale.setScalar(b.scale * 1.24);
        dummy.updateMatrix();
        bushMesh.setMatrixAt(i, dummy.matrix);
        berryMesh.setMatrixAt(i, dummy.matrix);
        const v = ((i * 13) % 9) / 8 - 0.5;
        tint.setRGB(1 + v * 0.14, 1 + v * 0.10, 1 - v * 0.08);
        bushMesh.setColorAt(i, tint);
        tint.setHex(berryPalette[i % berryPalette.length]);
        berryMesh.setColorAt(i, tint);
      });
      this.group.add(bushMesh, berryMesh);
    }

    if (shrooms.length > 0) {
      const { stems, caps } = createToadstoolClusterGeo();
      const stemMat = new THREE.MeshStandardMaterial({
        color: 0xe6dcc8,
        roughness: 0.80,
      });
      this.disposables.push(stems, caps, stemMat);

      const stemMesh = new THREE.InstancedMesh(stems, stemMat, shrooms.length);
      const capMesh = new THREE.InstancedMesh(caps, this.toadstoolCapMat, shrooms.length);
      stemMesh.castShadow = true;
      capMesh.castShadow = true;
      capMesh.receiveShadow = true;

      shrooms.forEach((m, i) => {
        dummy.position.set(m.x, m.y - 0.02, m.z);
        dummy.rotation.set(0, m.rotation, 0);
        dummy.scale.setScalar(m.scale * 1.12);
        dummy.updateMatrix();
        stemMesh.setMatrixAt(i, dummy.matrix);
        capMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(stemMesh, capMesh);
    }

    // 6. Natural Meadow Wildflower Clusters
    const circularRadius = world.terrain.halfSize + 8;
    {
      const flowerCount = 1350;
      const { stems, petals, centers } = createWildflowerClusterGeo();
      const fStemMat = new THREE.MeshStandardMaterial({ color: 0x456332, roughness: 0.86 });
      const fPetalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 });
      const fCenterMat = new THREE.MeshStandardMaterial({
        color: 0xd8aa3e,
        roughness: 0.65,
      });
      this.disposables.push(stems, petals, centers, fStemMat, fPetalMat, fCenterMat);

      const stemInst = new THREE.InstancedMesh(stems, fStemMat, flowerCount);
      const petalInst = new THREE.InstancedMesh(petals, fPetalMat, flowerCount);
      const centerInst = new THREE.InstancedMesh(centers, fCenterMat, flowerCount);

      // Authentic wildflower colors (oxeye daisy, buttercup, red clover, cornflower, wild violet, yarrow)
      const petalColors = [0xefeae0, 0xe6c453, 0xd89aa8, 0x8ba8d6, 0xb89ac9, 0xe4b289];
      let placed = 0;
      for (let tries = 0; tries < flowerCount * 6 && placed < flowerCount; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const fx = Math.cos(a) * r;
        const fz = Math.sin(a) * r;
        const fy = world.terrain.getHeightAt(fx, fz);
        if (fy < world.terrain.waterLevel + 0.35 || fy > 7.2) continue;
        const biome = world.terrain.getBiomeAtKnownHeight(fx, fz, fy);
        if (
          biome === 'water' ||
          biome === 'desert' ||
          biome === 'seashore' ||
          biome === 'rocky_ridge' ||
          biome === 'alpine_crag'
        ) {
          continue;
        }

        dummy.position.set(fx, fy - 0.02, fz);
        dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
        const s = rng.range(0.82, 1.48);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        stemInst.setMatrixAt(placed, dummy.matrix);
        petalInst.setMatrixAt(placed, dummy.matrix);
        centerInst.setMatrixAt(placed, dummy.matrix);

        tint.setHex(petalColors[placed % petalColors.length]);
        petalInst.setColorAt(placed, tint);
        placed++;
      }
      stemInst.count = placed;
      petalInst.count = placed;
      centerInst.count = placed;
      this.wildflowerGroup.add(stemInst, petalInst, centerInst);
      this.group.add(this.wildflowerGroup);
    }

    // 7. Pond Lily Pads, Natural Water-Lily Blooms & Riverside Cattails
    {
      const padGeo = createLilyPadGeo();
      const lotusGeo = createLotusBloomGeo();
      const padMat = new THREE.MeshStandardMaterial({ color: 0x355b31, roughness: 0.44 });
      const lotusMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.48,
        vertexColors: true,
      });
      this.disposables.push(padGeo, lotusGeo, padMat, lotusMat);

      const maxPads = 240;
      const padInst = new THREE.InstancedMesh(padGeo, padMat, maxPads);
      const lotusInst = new THREE.InstancedMesh(lotusGeo, lotusMat, maxPads);
      padInst.receiveShadow = true;

      let padsPlaced = 0;
      let lotusesPlaced = 0;
      for (let tries = 0; tries < 4200 && padsPlaced < maxPads; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * (circularRadius * 0.85);
        const lx = Math.cos(a) * r;
        const lz = Math.sin(a) * r;
        const ly = world.terrain.getHeightAt(lx, lz);
        if (ly > world.terrain.waterLevel - 0.22) continue;
        if (world.terrain.getCoastSignedDistance(lx, lz) < 12) continue;

        const rot = rng.range(0, Math.PI * 2);
        const scale = rng.range(0.68, 1.38);
        dummy.position.set(lx, world.terrain.waterLevel + 0.035, lz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        padInst.setMatrixAt(padsPlaced++, dummy.matrix);

        if (rng.chance(0.42)) {
          dummy.position.set(lx, world.terrain.waterLevel + 0.055, lz);
          dummy.scale.setScalar(scale * 1.12);
          dummy.updateMatrix();
          lotusInst.setMatrixAt(lotusesPlaced++, dummy.matrix);
        }
      }
      padInst.count = padsPlaced;
      lotusInst.count = lotusesPlaced;
      this.lilyGroup.add(padInst, lotusInst);
      this.group.add(this.lilyGroup);

      // Riverside cattail reed clusters
      const reedParts: THREE.BufferGeometry[] = [];
      const headParts: THREE.BufferGeometry[] = [];
      for (let r = 0; r < 5; r++) {
        const a = (r / 5) * Math.PI * 2;
        const ox = Math.cos(a) * 0.14;
        const oz = Math.sin(a) * 0.14;
        const h = 0.95 + (r % 3) * 0.25;
        const stalk = new THREE.CylinderGeometry(0.015, 0.026, h, 6);
        stalk.translate(ox, h * 0.5, oz);
        stalk.rotateZ((r - 2) * 0.06);
        reedParts.push(stalk);
        if (r < 2) {
          const head = new THREE.CapsuleGeometry(0.042, 0.18, 5, 8);
          head.translate(ox, h - 0.12, oz);
          head.rotateZ((r - 2) * 0.06);
          headParts.push(head);
        }
      }
      const reedGeo = mergePartGeometries(reedParts, false);
      const headGeo = mergePartGeometries(headParts, false);
      const reedMat = new THREE.MeshStandardMaterial({ color: 0x4b6838, roughness: 0.86 });
      const cattailMat = new THREE.MeshStandardMaterial({ color: 0x4f301b, roughness: 0.94 });
      this.disposables.push(reedGeo, headGeo, reedMat, cattailMat);

      const maxReeds = 360;
      const reedInst = new THREE.InstancedMesh(reedGeo, reedMat, maxReeds);
      const cattailInst = new THREE.InstancedMesh(headGeo, cattailMat, maxReeds);
      let reedsPlaced = 0;
      for (let tries = 0; tries < 5200 && reedsPlaced < maxReeds; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const rx = Math.cos(a) * r;
        const rz = Math.sin(a) * r;
        const ry = world.terrain.getHeightAt(rx, rz);
        if (ry < world.terrain.waterLevel - 0.12 || ry > world.terrain.waterLevel + 0.36) continue;
        if (world.terrain.getCoastSignedDistance(rx, rz) < 12) continue;
        dummy.position.set(rx, ry - 0.04, rz);
        dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
        dummy.scale.setScalar(rng.range(0.75, 1.35));
        dummy.updateMatrix();
        reedInst.setMatrixAt(reedsPlaced, dummy.matrix);
        cattailInst.setMatrixAt(reedsPlaced, dummy.matrix);
        reedsPlaced++;
      }
      reedInst.count = reedsPlaced;
      cattailInst.count = reedsPlaced;
      this.group.add(reedInst, cattailInst);
    }

    // 8. Dense Curved Multi-Blade Prairie & Woodland Grass Tufts
    const grassCount = Math.floor(world.config.grassBladeCount * grassMultiplier * 0.85);
    if (grassCount > 0) {
      const tuftGeo = createCurvedGrassTuftGeo();
      this.disposables.push(tuftGeo);

      const grass = new THREE.InstancedMesh(tuftGeo, this.grassMat, grassCount);
      grass.receiveShadow = true;

      let placed = 0;
      const prairieTarget = Math.floor(grassCount * 0.48);

      // Pass A: Open prairies and meadows
      for (let i = 0; i < prairieTarget * 9 && placed < prairieTarget; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const gx = Math.cos(a) * r;
        const gz = Math.sin(a) * r;
        const gy = world.terrain.getHeightAt(gx, gz);
        if (gy < world.terrain.waterLevel + 0.28 || gy > 9.5) continue;
        const gBiome = world.terrain.getBiomeAtKnownHeight(gx, gz, gy);
        if (gBiome !== 'prairie' && gBiome !== 'meadow') continue;

        dummy.position.set(gx, gy - 0.04, gz);
        dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
        const s = rng.range(0.88, 1.52);
        const tallY = gBiome === 'prairie' ? rng.range(1.28, 1.98) : rng.range(1.0, 1.45);
        dummy.scale.set(s, s * tallY, s);
        dummy.updateMatrix();
        grass.setMatrixAt(placed, dummy.matrix);

        if (gBiome === 'prairie') {
          tint.setHex(placed % 3 === 0 ? 0xc2b669 : 0xa6b564);
        } else {
          tint.setHex(0x8eaa62);
        }
        grass.setColorAt(placed, tint);
        placed++;
      }

      // Pass B: Forest floor, mossy hollows, and grassy riverbanks
      for (let i = 0; i < grassCount * 4 && placed < grassCount; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const gx = Math.cos(a) * r;
        const gz = Math.sin(a) * r;
        const gy = world.terrain.getHeightAt(gx, gz);
        if (gy < world.terrain.waterLevel + 0.25 || gy > 11.5) continue;
        const gBiome = world.terrain.getBiomeAtKnownHeight(gx, gz, gy);
        if (gBiome === 'alpine_crag' || gBiome === 'water' || gBiome === 'desert') continue;
        if (gBiome === 'seashore' && rng.chance(0.92)) continue;
        if (gBiome === 'rocky_ridge' && rng.chance(0.75)) continue;

        dummy.position.set(gx, gy - 0.04, gz);
        dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
        const s = rng.range(0.78, 1.54);
        const tallY = gBiome === 'prairie' ? rng.range(1.25, 1.92) : rng.range(0.92, 1.48);
        dummy.scale.set(s, s * tallY, s);
        dummy.updateMatrix();
        grass.setMatrixAt(placed, dummy.matrix);

        if (gBiome === 'prairie') {
          tint.setHex(0xb4b664);
        } else if (gBiome === 'seashore') {
          tint.setHex(0xbdae7c);
        } else if (gBiome === 'moss_hollow') {
          tint.setHex(0x528258);
        } else if (gBiome === 'deep_woods') {
          tint.setHex(0x5a854c);
        } else if (gBiome === 'riverbank') {
          tint.setHex(0x6e9454);
        } else if (gBiome === 'meadow') {
          tint.setHex(0x8eaa62);
        } else if (gBiome === 'rocky_ridge') {
          tint.setHex(0x7c8c6e);
        } else {
          tint.setHex(0x739655);
        }
        grass.setColorAt(placed, tint);
        placed++;
      }
      grass.count = placed;
      this.group.add(grass);
    }

    scene.add(this.group);
    this.updateSeasonPalette(world.season);
    this.clearTreesNearBuildings();
  }

  private buildHorizonForestRing(
    rng: WorldState['rng'],
    dummy: THREE.Object3D,
    tint: THREE.Color,
  ): void {
    // Procedurally unique multi-tier distant conifers + broadleaves across distant hills
    const distantOakGeo = createHorizonBroadleafGeo();

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.50, 3.2, 5);
    trunkGeo.translate(0, 1.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x453629, roughness: 0.96 });

    this.disposables.push(distantOakGeo, trunkGeo, trunkMat);

    const innerR = this.world.terrain.halfSize + 6;
    const outerR = this.world.terrain.halfSize * 3.0;
    const pineTarget = 1400;
    const oakTarget = 1000;

    const oakMesh = new THREE.InstancedMesh(distantOakGeo, this.distantBroadleafMat, oakTarget);
    const oakTrunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, oakTarget);
    oakMesh.frustumCulled = false;
    oakTrunkMesh.frustumCulled = false;

    const pinePlacements: HorizonPinePlacement[] = [];
    let oakCount = 0;

    for (let tries = 0; tries < 9600 && (pinePlacements.length < pineTarget || oakCount < oakTarget); tries++) {
      const a = rng.range(0, Math.PI * 2);
      const u = Math.pow(rng.next(), 0.78);
      const r = innerR + u * (outerR - innerR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.world.terrain.getHeightAt(x, z);
      if (y < this.world.terrain.waterLevel + 0.45 || y > 24.0) continue;
      const coastDist = this.world.terrain.getCoastSignedDistance(x, z);
      if (coastDist < 18) continue;
      const { biome: hBiome, aridity, prairie } = this.world.terrain.getHorizonBiomeAndClimate(
        x,
        z,
        y,
        coastDist,
      );
      if (
        hBiome === 'desert' ||
        hBiome === 'prairie' ||
        hBiome === 'alpine_crag' ||
        hBiome === 'water' ||
        aridity > 0.44 ||
        prairie > 0.44
      ) {
        continue;
      }

      const isPine = pinePlacements.length < pineTarget && (oakCount >= oakTarget || rng.chance(0.6));
      const distScale = 1.0 + u * 0.85;
      const s = rng.range(0.88, 1.55) * distScale;

      if (isPine) {
        pinePlacements.push({
          x,
          y,
          z,
          scale: s,
          biome: hBiome,
          seed: Math.floor(rng.next() * 0x7fffffff),
        });
      } else {
        dummy.position.set(x, y - 0.35, z);
        dummy.rotation.set(rng.range(-0.04, 0.04), rng.range(0, Math.PI * 2), rng.range(-0.04, 0.04));
        dummy.scale.set(s * rng.range(0.88, 1.14), s * rng.range(0.86, 1.32), s * rng.range(0.88, 1.14));
        dummy.updateMatrix();
        oakMesh.setMatrixAt(oakCount, dummy.matrix);
        const v = rng.range(-0.16, 0.16);
        tint.setRGB(1 + v, 1 + v * 0.8, 1 - v * 0.5);
        oakMesh.setColorAt(oakCount, tint);
        oakTrunkMesh.setMatrixAt(oakCount, dummy.matrix);
        oakCount++;
      }
    }

    if (pinePlacements.length > 0) {
      const horizonPines = buildProceduralHorizonPines(pinePlacements, this.distantPineMat, trunkMat);
      this.disposables.push(...horizonPines.disposables);
      this.group.add(horizonPines.trunkMesh, ...horizonPines.foliageMeshes);
    }

    oakMesh.count = oakCount;
    oakTrunkMesh.count = oakCount;
    this.group.add(oakTrunkMesh, oakMesh);
  }

  update(dt = 0, sky?: SkyLightingState): void {
    if (this.lastSeason !== this.world.season) {
      this.updateSeasonPalette(this.world.season);
    }

    if (this.world.structureRevision !== this.lastStructureRevision) {
      this.lastStructureRevision = this.world.structureRevision;
      this.clearTreesNearBuildings();
    }

    // Drive organic wind flutter, backlit translucency & cloud shadow drift
    this.foliageUniforms.uTime.value += dt;
    if (sky) {
      this.foliageUniforms.uWindStrength.value = sky.windStrength;
      this.foliageUniforms.uSunDir.value.copy(sky.sunDirection);
      this.foliageUniforms.uSunColor.value.copy(sky.sunColor);
      this.foliageUniforms.uDaylight.value = sky.daylight;
      this.foliageUniforms.uCloudTime.value = sky.cloudTime ?? 0;
      this.foliageUniforms.uCloudCoverage.value = sky.cloudCoverage ?? 0.38;
    }

    const t = this.world.elapsedSeconds;
    this.lilyGroup.position.y = Math.sin(t * 1.45) * 0.018;

    // Lanterns only glow warmly at dusk/night, never glowing neon bulbs in noon sunlight
    const sunY = Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2);
    const nightAmt = THREE.MathUtils.clamp(1 - (sunY + 0.08) * 2.6, 0.0, 1.35);
    this.fairyLanternMat.emissiveIntensity = nightAmt * (1.25 + Math.sin(t * 3.8) * 0.16);
  }

  private clearTreesNearBuildings(): void {
    const zeroMatrix = this.zeroMatrix;
    const settlements = this.world.settlements;
    const bridges = this.world.bridges;
    // Precompute exact per-settlement bounding-circle clearance so distant trees skip building loops in O(1)
    const settleMaxDistSq = new Float64Array(settlements.length);
    for (let s = 0; s < settlements.length; s++) {
      const settlement = settlements[s];
      let maxReach = 7.5;
      for (let j = 0; j < settlement.buildings.length; j++) {
        const b = settlement.buildings[j];
        const dx = b.position.x - settlement.center.x;
        const dz = b.position.z - settlement.center.z;
        const reach = Math.sqrt(dx * dx + dz * dz) + BUILDING_CATALOG[b.type].footprintRadius + 1.45;
        if (reach > maxReach) maxReach = reach;
      }
      settleMaxDistSq[s] = maxReach * maxReach;
    }

    const isTreeBlocked = (tree: TreeSpot): boolean => {
      for (let s = 0; s < settlements.length; s++) {
        const settlement = settlements[s];
        const sdx = tree.x - settlement.center.x;
        const sdz = tree.z - settlement.center.z;
        const sDistSq = sdx * sdx + sdz * sdz;
        if (sDistSq > settleMaxDistSq[s]) continue;
        if (sDistSq < 56.25) return true; // 7.5 * 7.5
        for (let j = 0; j < settlement.buildings.length; j++) {
          const b = settlement.buildings[j];
          const clearDist = BUILDING_CATALOG[b.type].footprintRadius + 1.45;
          const bdx = tree.x - b.position.x;
          const bdz = tree.z - b.position.z;
          if (bdx * bdx + bdz * bdz < clearDist * clearDist) return true;
        }
      }
      for (let i = 0; i < bridges.length; i++) {
        if (isPointNearBridge(bridges[i], tree.x, tree.z, 1.8)) return true;
      }
      return false;
    };

    for (const group of this.clearableTreeGroups) {
      let dirty = false;
      for (let i = 0; i < group.spots.length; i++) {
        if (group.cleared[i]) continue;
        if (isTreeBlocked(group.spots[i])) {
          group.cleared[i] = 1;
          group.trunks.setMatrixAt(i, zeroMatrix);
          group.crowns.setMatrixAt(i, zeroMatrix);
          dirty = true;
        }
      }

      if (dirty) {
        group.trunks.instanceMatrix.needsUpdate = true;
        group.crowns.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.proceduralPines) {
      for (let i = 0; i < this.proceduralPines.spots.length; i++) {
        if (isTreeBlocked(this.proceduralPines.spots[i])) {
          this.proceduralPines.clearTree(i);
        }
      }
      this.proceduralPines.flushCleared();
    }
  }

  private updateSeasonPalette(season: Season): void {
    this.lastSeason = season;
    this.wildflowerGroup.visible = season !== 'winter';

    // Calibrated naturalistic chlorophyll & seasonal pigments (photographic, non-neon)
    if (season === 'spring') {
      this.oakFoliageMat.color.setHex(0x4f783b);
      this.pineFoliageMat.color.setHex(0x2d583c);
      this.birchFoliageMat.color.setHex(0x74994a);
      this.distantPineMat.color.setHex(0x284d35);
      this.distantBroadleafMat.color.setHex(0x456b36);
      this.grassMat.color.setHex(0xa8c27e);
      this.fernMat.color.setHex(0xf2f5ee);
      this.bushMat.color.setHex(0x486e36);
    } else if (season === 'summer') {
      this.oakFoliageMat.color.setHex(0x3e6631);
      this.pineFoliageMat.color.setHex(0x254c34);
      this.birchFoliageMat.color.setHex(0x5e8542);
      this.distantPineMat.color.setHex(0x21442f);
      this.distantBroadleafMat.color.setHex(0x385c2d);
      this.grassMat.color.setHex(0x96b36e);
      this.fernMat.color.setHex(0xe2ebd9);
      this.bushMat.color.setHex(0x3c5f2f);
    } else if (season === 'autumn') {
      this.oakFoliageMat.color.setHex(0xb86631);
      this.pineFoliageMat.color.setHex(0x314f3d);
      this.birchFoliageMat.color.setHex(0xcfa544);
      this.distantPineMat.color.setHex(0x2b4535);
      this.distantBroadleafMat.color.setHex(0x9a5c30);
      this.grassMat.color.setHex(0xbda068);
      this.fernMat.color.setHex(0xb8965d);
      this.bushMat.color.setHex(0x9e6e42);
    } else {
      this.oakFoliageMat.color.setHex(0xa8b5bf);
      this.pineFoliageMat.color.setHex(0x4f6d67);
      this.birchFoliageMat.color.setHex(0xbec8d0);
      this.distantPineMat.color.setHex(0x48625e);
      this.distantBroadleafMat.color.setHex(0x99a6b0);
      this.grassMat.color.setHex(0xc2ccd2);
      this.fernMat.color.setHex(0x8b9ea6);
      this.bushMat.color.setHex(0x98a8b2);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
