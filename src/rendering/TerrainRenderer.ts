import * as THREE from 'three';
import type { BiomeType, Season } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { TextureLibrary } from './ProceduralTextures';
import {
  createRealisticWaterSurface,
  type RealisticWaterSurface,
  type SkyLightingState,
} from './WaterShader';

interface TerrainShaderUniforms {
  uWaterLevel: { value: number };
  uRainWetness: { value: number };
  uCloudTime: { value: number };
  uCloudCoverage: { value: number };
  uDaylight: { value: number };
  uWinter: { value: number };
  uRockMap: { value: THREE.Texture | null };
  uHasRockMap: { value: number };
}

/**
 * C1-smooth non-uniform coordinate warp: preserves high vertex density across the
 * central playable continent (|u| <= coreFrac) and smoothly expands outward to horizonExtent
 * so there are zero seams, T-junctions, or visible terrain edges.
 */
function warpTerrainCoord(u: number, halfCore: number, horizonExtent: number): number {
  const coreFrac = 0.68;
  const sign = u < 0 ? -1 : 1;
  const a = Math.abs(u);
  if (a <= coreFrac) {
    return sign * (a / coreFrac) * halfCore;
  }
  const t = (a - coreFrac) / (1 - coreFrac);
  const linearSlope = (halfCore / coreFrac) * (1 - coreFrac);
  const extraSpan = Math.max(0, horizonExtent - halfCore - linearSlope);
  return sign * (halfCore + linearSlope * t + extraSpan * Math.pow(t, 3.2));
}

function enhanceTerrainMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: TerrainShaderUniforms,
): void {
  mat.customProgramCacheKey = () => 'forest-realistic-terrain-v2';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterLevel = uniforms.uWaterLevel;
    shader.uniforms.uRainWetness = uniforms.uRainWetness;
    shader.uniforms.uCloudTime = uniforms.uCloudTime;
    shader.uniforms.uCloudCoverage = uniforms.uCloudCoverage;
    shader.uniforms.uDaylight = uniforms.uDaylight;
    shader.uniforms.uWinter = uniforms.uWinter;
    shader.uniforms.uRockMap = uniforms.uRockMap;
    shader.uniforms.uHasRockMap = uniforms.uHasRockMap;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 tWorldPos = modelMatrix * vec4(transformed, 1.0);
        vTerrainWorldPos = tWorldPos.xyz;
        vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterLevel;
        uniform float uRainWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uDaylight;
        uniform float uWinter;
        uniform sampler2D uRockMap;
        uniform float uHasRockMap;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;

        float tHash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.53);
          return fract(p.x * p.y);
        }

        float tNoise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = tHash21(i);
          float b = tHash21(i + vec2(1.0, 0.0));
          float c = tHash21(i + vec2(0.0, 1.0));
          float d = tHash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float tFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * tNoise2(p);
            p = rot * p * 2.03 + vec2(13.1, 7.9);
            a *= 0.5;
          }
          return v;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 tN = normalize(vTerrainWorldNormal);
        float tSlope = clamp(1.0 - tN.y, 0.0, 1.0);

        // 1. Multi-scale macro organic soil/foliage variation (breaks any visible tiling)
        float macroA = tFbm(vTerrainWorldPos.xz * 0.022);
        float macroB = tNoise2(vTerrainWorldPos.xz * 0.11);
        float macroVar = mix(0.86, 1.13, macroA * 0.68 + macroB * 0.32);
        diffuseColor.rgb *= macroVar;

        // 2. Triplanar cliff rock strata detail on steep slopes (eliminates stretched cliff UVs)
        float cliffFactor = smoothstep(0.14, 0.38, tSlope);
        if (cliffFactor > 0.01) {
          vec3 blendW = pow(abs(tN), vec3(4.0));
          blendW /= max(blendW.x + blendW.y + blendW.z, 0.0001);
          float rockScale = 0.14;
          vec3 triRock;
          if (uHasRockMap > 0.5) {
            vec3 rx = texture2D(uRockMap, vTerrainWorldPos.zy * rockScale).rgb;
            vec3 ry = texture2D(uRockMap, vTerrainWorldPos.xz * rockScale).rgb;
            vec3 rz = texture2D(uRockMap, vTerrainWorldPos.xy * rockScale).rgb;
            triRock = rx * blendW.x + ry * blendW.y + rz * blendW.z;
          } else {
            float strata = sin(vTerrainWorldPos.y * 2.4 + macroB * 3.5) * 0.12 + 0.52;
            triRock = vec3(strata);
          }
          float strataBand = 0.86 + 0.24 * tNoise2(vec2(vTerrainWorldPos.y * 1.15, macroA * 4.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.48 + triRock * 0.92) * strataBand, cliffFactor * 0.85);
        }

        // 3. Shoreline capillary wetness + rain darkening (porous earth darkens when wet)
        float aboveWater = vTerrainWorldPos.y - uWaterLevel;
        float shoreWet = (1.0 - smoothstep(-0.05, 0.48, aboveWater)) * smoothstep(-1.4, -0.1, aboveWater);
        float totalWet = clamp(max(shoreWet, uRainWetness * (1.0 - uWinter * 0.85) * 0.72), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, 0.64, totalWet);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float rAboveWater = vTerrainWorldPos.y - uWaterLevel;
        float rShoreWet = (1.0 - smoothstep(-0.05, 0.45, rAboveWater)) * smoothstep(-1.2, -0.05, rAboveWater);
        float rTotalWet = clamp(max(rShoreWet, uRainWetness * (1.0 - uWinter * 0.85) * 0.72), 0.0, 1.0);
        // Wet earth/shoreline reflects sky; dry rock/soil stays naturally matte
        roughnessFactor = mix(roughnessFactor, 0.20, rTotalWet * 0.82);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// 4. Drifting cumulus cloud shadows synchronized with AtmosphereSystem sky dome (linear HDR space)
        vec2 cShadowUv = vTerrainWorldPos.xz * 0.0046 + vec2(uCloudTime * 0.011, uCloudTime * 0.0045);
        float cNoise = tFbm(cShadowUv);
        float cThresh = mix(0.64, 0.34, clamp(uCloudCoverage, 0.0, 1.0));
        float cloudShadow = smoothstep(cThresh, cThresh + 0.22, cNoise);
        float shadowDim = mix(1.0, 0.72, cloudShadow * uDaylight * (1.0 - uCloudCoverage * 0.35));
        outgoingLight *= shadowDim;
        #include <opaque_fragment>`,
      );
  };
}

/**
 * Renders the continuous endless continental terrain extending smoothly to the horizon,
 * with triplanar rock strata, shoreline/rain wetness, drifting cloud shadows, and
 * physically-based depth-aware flowing forest stream/pond/ocean water.
 */
export class TerrainRenderer {
  readonly terrainMesh: THREE.Mesh;
  readonly waterMesh: THREE.Mesh;
  private readonly waterSurface: RealisticWaterSurface;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private readonly terrainUniforms: TerrainShaderUniforms;
  private lastSeason: Season | null = null;
  private readonly vertexBiomes: BiomeType[];
  private readonly vertexCoastDist: Float32Array;
  private vertexCacheBuilt = false;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    textures: TextureLibrary,
  ) {
    const { worldSize, terrainSegments } = world.config;
    const totalSegments = Math.max(300, terrainSegments + 52);
    const halfCore = worldSize * 0.56;
    const horizonExtent = worldSize * 6.5; // ~7.3km radius -> ~14.6km flat oceanic horizon!

    const geo = new THREE.PlaneGeometry(2, 2, totalSegments, totalSegments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.vertexBiomes = new Array<BiomeType>(pos.count);
    this.vertexCoastDist = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const ux = pos.getX(i); // -1..1
      const uz = pos.getZ(i); // -1..1
      const x = warpTerrainCoord(ux, halfCore, horizonExtent);
      const z = warpTerrainCoord(uz, halfCore, horizonExtent);
      const y = world.terrain.getHeightAt(x, z);
      pos.setXYZ(i, x, y, z);
      // Constant meters-per-tile world-space UVs so PBR surface micro-detail stays crisp across vast worlds
      uv.setXY(i, x / 145 + 0.5, z / 145 + 0.5);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terrainUniforms = {
      uWaterLevel: { value: world.terrain.waterLevel },
      uRainWetness: { value: 0.0 },
      uCloudTime: { value: 0.0 },
      uCloudCoverage: { value: 0.38 },
      uDaylight: { value: 1.0 },
      uWinter: { value: world.season === 'winter' ? 1.0 : 0.0 },
      uRockMap: { value: textures.rock?.map ?? null },
      uHasRockMap: { value: textures.rock?.map ? 1.0 : 0.0 },
    };

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      map: textures.forestFloor.map,
      ...(textures.forestFloor.normalMap
        ? {
            normalMap: textures.forestFloor.normalMap,
            normalScale: new THREE.Vector2(0.85, 0.85),
          }
        : {
            bumpMap: textures.forestFloor.bumpMap,
            bumpScale: 0.24,
          }),
      roughnessMap: textures.forestFloor.roughnessMap,
      roughness: 0.94,
      metalness: 0.01,
      vertexColors: true,
    });
    enhanceTerrainMaterial(this.terrainMaterial, this.terrainUniforms);

    this.terrainMesh = new THREE.Mesh(geo, this.terrainMaterial);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'forest-terrain';
    scene.add(this.terrainMesh);

    // Physically-based depth-aware flowing water surface extending smoothly into distant horizons
    this.waterSurface = createRealisticWaterSurface(
      world.terrain,
      worldSize,
      Math.max(260, terrainSegments + 24),
      6.5,
    );
    this.waterMesh = this.waterSurface.mesh;
    scene.add(this.waterMesh);

    this.applySeasonalColors(world.season);
  }

  update(dt: number, sky?: SkyLightingState): void {
    if (sky) {
      this.waterSurface.update(dt, sky);
      this.terrainUniforms.uRainWetness.value = sky.rainWetness ?? 0.0;
      this.terrainUniforms.uCloudTime.value = sky.cloudTime ?? 0.0;
      this.terrainUniforms.uCloudCoverage.value = sky.cloudCoverage ?? 0.38;
      this.terrainUniforms.uDaylight.value = sky.daylight;
      this.terrainUniforms.uWinter.value = sky.isWinter ? 1.0 : 0.0;
    }

    if (this.lastSeason !== this.world.season) {
      this.applySeasonalColors(this.world.season);
    }
  }

  private applySeasonalColors(season: Season): void {
    this.lastSeason = season;
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const norm = geo.attributes.normal as THREE.BufferAttribute;
    const colAttr = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();

    const wetTint = new THREE.Color(0x3a3629);
    const deepBedTint = new THREE.Color(0x1f261e);
    const deepOceanBedTint = new THREE.Color(0x132635);
    const shallowOceanBedTint = new THREE.Color(0xc2b28a);
    const shallowRiverBedTint = new THREE.Color(0x6b614b);
    const bedDeepTmp = new THREE.Color();
    const wetSandTint = new THREE.Color(0x9b865f);

    const cliffGranite = new THREE.Color(0x52565a);
    const darkCragFace = new THREE.Color(0x3b4046);
    const cliffSandstone = new THREE.Color(0xa66945);
    const desertCrestTint = new THREE.Color(season === 'winter' ? 0xd4c7ad : 0xdcc796);
    const desertShadowTint = new THREE.Color(season === 'winter' ? 0xae9c7f : 0xb88b57);
    const snowCapColor = new THREE.Color(0xe5ecf0);
    const alpineRockColor = new THREE.Color(season === 'winter' ? 0xa3b0b8 : 0x61676d);
    const deepMossPatch = new THREE.Color(season === 'winter' ? 0x8696a1 : 0x264724);

    const distantForestTint = new THREE.Color(
      season === 'winter'
        ? 0x90a1ad
        : season === 'autumn'
          ? 0x624f34
          : 0x284525,
    );
    const distantPrairieTint = new THREE.Color(
      season === 'winter'
        ? 0xbcc6cd
        : season === 'autumn'
          ? 0x9e8448
          : 0x688241,
    );
    const distantDesertTint = new THREE.Color(season === 'winter' ? 0xc2b296 : 0xc7a66d);

    const waterLevel = this.world.terrain.waterLevel;
    const halfSize = this.world.terrain.halfSize;

    // Calibrated naturalistic photographic earth & botanical palettes (no neon saturation)
    const meadowHex =
      season === 'spring'
        ? 0x527a39
        : season === 'summer'
          ? 0x456b32
          : season === 'autumn'
            ? 0x846f3d
            : 0xc5cfd6;
    const prairieHex =
      season === 'spring'
        ? 0x6c8a42
        : season === 'summer'
          ? 0x768941
          : season === 'autumn'
            ? 0xa88a46
            : 0xcad2d8;
    const woodsHex =
      season === 'spring'
        ? 0x325229
        : season === 'summer'
          ? 0x294623
          : season === 'autumn'
            ? 0x5e492e
            : 0x9caab3;
    const mossHex = season === 'winter' ? 0x84959e : 0x2a5430;
    const desertHex =
      season === 'spring'
        ? 0xcfb27c
        : season === 'summer'
          ? 0xd6b77b
          : season === 'autumn'
            ? 0xc79f68
            : 0xc2b091;
    const seashoreHex = season === 'winter' ? 0xc8c5bc : 0xd6c8a2;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = norm.getY(i);
      const slope = Math.max(0, 1 - ny);

      let biome: BiomeType;
      let coastDist: number;
      if (this.vertexCacheBuilt) {
        biome = this.vertexBiomes[i];
        coastDist = this.vertexCoastDist[i];
      } else {
        biome = this.world.terrain.getBiomeAtSample(x, z, y, slope);
        coastDist = this.world.terrain.getCoastSignedDistance(x, z);
        this.vertexBiomes[i] = biome;
        this.vertexCoastDist[i] = coastDist;
      }

      if (biome === 'water') {
        const bedDepth = THREE.MathUtils.clamp((waterLevel - y) / 1.8, 0, 1);
        const riverBedMix = THREE.MathUtils.smoothstep(coastDist, -4, 16);
        c.copy(shallowOceanBedTint).lerp(shallowRiverBedTint, riverBedMix);
        bedDeepTmp.copy(deepOceanBedTint).lerp(deepBedTint, riverBedMix);
        c.lerp(bedDeepTmp, bedDepth);
      } else if (biome === 'seashore') {
        c.setHex(seashoreHex);
      } else if (biome === 'riverbank') {
        c.setHex(season === 'winter' ? 0x848b8f : 0x696148);
      } else if (biome === 'alpine_crag') {
        c.copy(alpineRockColor);
        const snowLine = season === 'winter' ? 16.0 : season === 'autumn' ? 25.0 : 32.0;
        const altSnow = THREE.MathUtils.smoothstep(y, snowLine, snowLine + 16.0);
        const sheerRockExpose = THREE.MathUtils.smoothstep(slope, 0.24, 0.48);
        const snowRetention = 1.0 - sheerRockExpose * 0.82;
        if (sheerRockExpose > 0) {
          c.lerp(darkCragFace, sheerRockExpose * 0.65);
        }
        const snowMix = altSnow * snowRetention;
        if (snowMix > 0) {
          c.lerp(snowCapColor, snowMix * (season === 'winter' ? 0.96 : 0.92));
        }
      } else if (biome === 'rocky_ridge') {
        c.setHex(season === 'winter' ? 0xb4bfc6 : 0x656b65);
        if (season !== 'winter') {
          const benchMoss =
            (1 - THREE.MathUtils.smoothstep(slope, 0.08, 0.24)) *
            (1 - THREE.MathUtils.smoothstep(y, 8.0, 14.0));
          if (benchMoss > 0) {
            c.lerp(deepMossPatch, benchMoss * 0.42);
          }
        }
      } else if (biome === 'desert') {
        c.setHex(desertHex);
        const ripple = 0.5 + 0.5 * Math.sin(x * 0.095 + z * 0.082 + y * 1.45);
        const crestMix = THREE.MathUtils.smoothstep(y, 2.8, 6.2) * 0.48 + ripple * 0.16;
        c.lerp(desertCrestTint, THREE.MathUtils.clamp(crestMix, 0, 0.52));
        const slipMix = THREE.MathUtils.smoothstep(slope, 0.03, 0.14);
        if (slipMix > 0) {
          c.lerp(desertShadowTint, slipMix * 0.36);
        }
      } else if (biome === 'prairie') {
        c.setHex(prairieHex);
        const wave = 0.5 + 0.5 * Math.sin(x * 0.032 + z * 0.024) * Math.cos(x * 0.017 - z * 0.029);
        if (season !== 'winter') {
          c.multiplyScalar(0.92 + wave * 0.16);
        }
      } else if (biome === 'moss_hollow') {
        c.setHex(mossHex);
      } else if (biome === 'meadow') {
        c.setHex(meadowHex);
      } else {
        c.setHex(woodsHex);
        if (season !== 'winter') {
          const dapple = 0.5 + 0.5 * Math.sin(x * 0.065 + z * 0.052) * Math.cos(x * 0.041 - z * 0.071);
          c.lerp(deepMossPatch, dapple * 0.40);
        }
      }

      // Expose sculpted cliff stone on steep hillsides, crag walls & desert mesa rims
      if (biome !== 'water') {
        const cliffMix = THREE.MathUtils.smoothstep(slope, 0.15, 0.35);
        if (cliffMix > 0) {
          c.lerp(
            biome === 'desert' ? cliffSandstone : biome === 'alpine_crag' ? darkCragFace : cliffGranite,
            cliffMix * (biome === 'desert' ? 0.78 : 0.72),
          );
        }
      }

      // Damp darkened wet-earth fringe hugging the waterline
      const aboveWater = y - waterLevel;
      if (aboveWater > -0.15 && aboveWater < 0.38) {
        const wetness = 1.0 - THREE.MathUtils.smoothstep(aboveWater, 0.02, 0.38);
        c.lerp(biome === 'seashore' || biome === 'desert' ? wetSandTint : wetTint, wetness * 0.44);
      }

      // Harmonize distant terrain beyond the playable continent
      const radialDist = Math.sqrt(x * x + z * z);
      const distantMix = THREE.MathUtils.smoothstep(radialDist, halfSize * 1.02, halfSize * 2.5);
      if (distantMix > 0 && y < 28.0 && coastDist > 8) {
        const distTint =
          biome === 'desert'
            ? distantDesertTint
            : biome === 'prairie'
              ? distantPrairieTint
              : distantForestTint;
        c.lerp(distTint, distantMix * 0.52);
      } else if (y >= 34.0 && biome !== 'alpine_crag') {
        const peakSnow =
          THREE.MathUtils.smoothstep(y, 34.0, 52.0) * (1 - THREE.MathUtils.smoothstep(slope, 0.28, 0.5));
        c.lerp(snowCapColor, peakSnow * 0.88);
      }

      const shade = THREE.MathUtils.clamp(0.9 + Math.min(y, 35) * 0.0042, 0.82, 1.06);
      c.multiplyScalar(shade);
      colAttr.setXYZ(i, c.r, c.g, c.b);
    }
    this.vertexCacheBuilt = true;
    colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.terrainMesh.geometry.dispose();
    this.terrainMaterial.dispose();
    this.waterSurface.dispose();
  }
}
