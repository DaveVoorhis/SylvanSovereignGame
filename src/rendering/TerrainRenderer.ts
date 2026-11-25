import * as THREE from 'three';
import type { Season } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { TextureLibrary } from './ProceduralTextures';
import {
  createRealisticWaterSurface,
  type RealisticWaterSurface,
  type SkyLightingState,
} from './WaterShader';

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
  return sign * (halfCore + linearSlope * t + extraSpan * Math.pow(t, 2.35));
}

/**
 * Renders the continuous endless continental terrain extending smoothly to the horizon,
 * and physically-based depth-aware flowing forest stream/pond/ocean water.
 */
export class TerrainRenderer {
  readonly terrainMesh: THREE.Mesh;
  readonly waterMesh: THREE.Mesh;
  private readonly waterSurface: RealisticWaterSurface;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private lastSeason: Season | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    textures: TextureLibrary,
  ) {
    const { worldSize, terrainSegments } = world.config;
    const totalSegments = Math.max(300, terrainSegments + 52);
    const halfCore = worldSize * 0.56;
    const horizonExtent = worldSize * 2.65; // ~2.97km radius -> ~5.9km seamless horizon!

    const geo = new THREE.PlaneGeometry(2, 2, totalSegments, totalSegments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ux = pos.getX(i); // -1..1
      const uz = pos.getZ(i); // -1..1
      const x = warpTerrainCoord(ux, halfCore, horizonExtent);
      const z = warpTerrainCoord(uz, halfCore, horizonExtent);
      const y = world.terrain.getHeightAt(x, z);
      pos.setXYZ(i, x, y, z);
      // Constant meters-per-tile world-space UVs so PBR surface micro-detail stays crisp across vast worlds
      uv.setXY(i, x / 160 + 0.5, z / 160 + 0.5);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      map: textures.forestFloor.map,
      bumpMap: textures.forestFloor.bumpMap,
      bumpScale: 0.26,
      roughnessMap: textures.forestFloor.roughnessMap,
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true,
    });

    this.terrainMesh = new THREE.Mesh(geo, this.terrainMaterial);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'forest-terrain';
    scene.add(this.terrainMesh);

    // Physically-based depth-aware flowing water surface extending smoothly into distant horizons
    this.waterSurface = createRealisticWaterSurface(
      world.terrain,
      worldSize,
      Math.max(260, terrainSegments + 24),
      2.65,
    );
    this.waterMesh = this.waterSurface.mesh;
    scene.add(this.waterMesh);

    this.applySeasonalColors(world.season);
  }

  update(dt: number, sky?: SkyLightingState): void {
    if (sky) {
      this.waterSurface.update(dt, sky);
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

    const wetTint = new THREE.Color(0x3f3c2d);
    const deepBedTint = new THREE.Color(0x222d22);
    const deepOceanBedTint = new THREE.Color(0x142e42);
    const shallowOceanBedTint = new THREE.Color(0xdcc994);
    const shallowRiverBedTint = new THREE.Color(0x7c7055);
    const bedDeepTmp = new THREE.Color();
    const wetSandTint = new THREE.Color(0xb89c68);

    const cliffGranite = new THREE.Color(0x525a61);
    const darkCragFace = new THREE.Color(0x3d444b);
    const cliffSandstone = new THREE.Color(0xc97340);
    const desertCrestTint = new THREE.Color(season === 'winter' ? 0xe6d6b5 : 0xf7df9c);
    const desertShadowTint = new THREE.Color(season === 'winter' ? 0xbfa986 : 0xd49b52);
    const snowCapColor = new THREE.Color(0xf2f7fb);
    const alpineRockColor = new THREE.Color(season === 'winter' ? 0xb4c2cc : 0x677078);
    const deepMossPatch = new THREE.Color(season === 'winter' ? 0x8ea2b0 : 0x1d5924);

    const distantForestTint = new THREE.Color(
      season === 'winter'
        ? 0x9cb1bf
        : season === 'autumn'
          ? 0x6f5732
          : 0x265425,
    );
    const distantPrairieTint = new THREE.Color(
      season === 'winter'
        ? 0xc6d1d9
        : season === 'autumn'
          ? 0xbe9a44
          : 0x73a83d,
    );
    const distantDesertTint = new THREE.Color(season === 'winter' ? 0xd2bf9d : 0xe0b768);

    const waterLevel = this.world.terrain.waterLevel;
    const halfSize = this.world.terrain.halfSize;

    // Rich calibrated palettes (paired with neutral terrain micro-grain albedo)
    const meadowHex =
      season === 'spring'
        ? 0x5ca838
        : season === 'summer'
          ? 0x4b9430
          : season === 'autumn'
            ? 0x9e823e
            : 0xcbd5dc;
    const prairieHex =
      season === 'spring'
        ? 0x7cbd44
        : season === 'summer'
          ? 0x88b83e
          : season === 'autumn'
            ? 0xcca342
            : 0xd0d8de;
    const woodsHex =
      season === 'spring'
        ? 0x2f6e29
        : season === 'summer'
          ? 0x245e23
          : season === 'autumn'
            ? 0x6e542e
            : 0xa3b3be;
    const mossHex = season === 'winter' ? 0x889fa8 : 0x227036;
    const desertHex =
      season === 'spring'
        ? 0xe8c77a
        : season === 'summer'
          ? 0xf0cc78
          : season === 'autumn'
            ? 0xe2b363
            : 0xd8c39b;
    const seashoreHex = season === 'winter' ? 0xd8d4c8 : 0xf0dfa8;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = norm.getY(i);
      const slope = Math.max(0, 1 - ny);

      const biome = this.world.terrain.getBiomeAtSample(x, z, y, slope);
      const coastDist = this.world.terrain.getCoastSignedDistance(x, z);

      if (biome === 'water') {
        const bedDepth = THREE.MathUtils.clamp((waterLevel - y) / 1.8, 0, 1);
        const riverBedMix = THREE.MathUtils.smoothstep(coastDist, -4, 16);
        c.copy(shallowOceanBedTint).lerp(shallowRiverBedTint, riverBedMix);
        bedDeepTmp.copy(deepOceanBedTint).lerp(deepBedTint, riverBedMix);
        c.lerp(bedDeepTmp, bedDepth);
      } else if (biome === 'seashore') {
        c.setHex(seashoreHex);
      } else if (biome === 'riverbank') {
        c.setHex(season === 'winter' ? 0x8d9599 : 0x7c7450);
      } else if (biome === 'alpine_crag') {
        c.copy(alpineRockColor);
        // Sheer vertical crags expose stark dark charcoal granite even at high altitude;
        // crisp snow blankets ridges, ledges, and soaring alpine summits!
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
        c.setHex(season === 'winter' ? 0xbecad2 : 0x6f7771);
        if (season !== 'winter') {
          // Verdant highland pine-moss clinging to gentle foothill benches
          const benchMoss = (1 - THREE.MathUtils.smoothstep(slope, 0.08, 0.24)) *
            (1 - THREE.MathUtils.smoothstep(y, 8.0, 14.0));
          if (benchMoss > 0) {
            c.lerp(deepMossPatch, benchMoss * 0.42);
          }
        }
      } else if (biome === 'desert') {
        c.setHex(desertHex);
        // Sun-bleached dune crests and warm wind-rippled ochre slip-faces
        const ripple = 0.5 + 0.5 * Math.sin(x * 0.095 + z * 0.082 + y * 1.45);
        const crestMix = THREE.MathUtils.smoothstep(y, 2.8, 6.2) * 0.52 + ripple * 0.18;
        c.lerp(desertCrestTint, THREE.MathUtils.clamp(crestMix, 0, 0.55));
        const slipMix = THREE.MathUtils.smoothstep(slope, 0.03, 0.14);
        if (slipMix > 0) {
          c.lerp(desertShadowTint, slipMix * 0.36);
        }
      } else if (biome === 'prairie') {
        c.setHex(prairieHex);
        // Subtle sunlit wind-swept grass tonal waves across the vast flat plain
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
        // Rich dappled emerald mossy patches across the deep woodland floor
        if (season !== 'winter') {
          const dapple = 0.5 + 0.5 * Math.sin(x * 0.065 + z * 0.052) * Math.cos(x * 0.041 - z * 0.071);
          c.lerp(deepMossPatch, dapple * 0.42);
        }
      }

      // Expose sculpted cliff stone on steep hillsides, crag walls & desert mesa rims
      if (biome !== 'water') {
        const cliffMix = THREE.MathUtils.smoothstep(slope, 0.15, 0.35);
        if (cliffMix > 0) {
          c.lerp(
            biome === 'desert' ? cliffSandstone : biome === 'alpine_crag' ? darkCragFace : cliffGranite,
            cliffMix * (biome === 'desert' ? 0.78 : 0.68),
          );
        }
      }

      // Damp darkened wet-earth fringe hugging the waterline for photorealistic shore transition
      const aboveWater = y - waterLevel;
      if (aboveWater > -0.15 && aboveWater < 0.38) {
        const wetness = 1.0 - THREE.MathUtils.smoothstep(aboveWater, 0.02, 0.38);
        c.lerp(biome === 'seashore' || biome === 'desert' ? wetSandTint : wetTint, wetness * 0.42);
      }

      // Harmonize distant terrain beyond the playable continent while preserving biome character & soaring snowy peaks
      const radialDist = Math.hypot(x, z);
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
        const peakSnow = THREE.MathUtils.smoothstep(y, 34.0, 52.0) * (1 - THREE.MathUtils.smoothstep(slope, 0.28, 0.5));
        c.lerp(snowCapColor, peakSnow * 0.88);
      }

      const shade = THREE.MathUtils.clamp(0.9 + Math.min(y, 35) * 0.0045, 0.8, 1.08);
      c.multiplyScalar(shade);
      colAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.terrainMesh.geometry.dispose();
    this.terrainMaterial.dispose();
    this.waterSurface.dispose();
  }
}
