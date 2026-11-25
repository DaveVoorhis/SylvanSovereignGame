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
 * central playable valley (|u| <= coreFrac) and smoothly expands outward to horizonExtent
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
 * Renders the continuous endless woodland terrain extending smoothly to the horizon,
 * and physically-based depth-aware flowing forest stream/pond water.
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
    const totalSegments = Math.max(196, terrainSegments + 52);
    const halfCore = worldSize * 0.56;
    const horizonExtent = worldSize * 3.35; // ~536m radius -> 1072m seamless landscape!

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
      // Uniform world-space UVs so PBR forest floor never stretches in outer hills
      uv.setXY(i, x / worldSize + 0.5, z / worldSize + 0.5);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      map: textures.forestFloor.map,
      bumpMap: textures.forestFloor.bumpMap,
      bumpScale: 0.22,
      roughnessMap: textures.forestFloor.roughnessMap,
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true,
    });

    this.terrainMesh = new THREE.Mesh(geo, this.terrainMaterial);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'forest-terrain';
    scene.add(this.terrainMesh);

    // Physically-based depth-aware flowing water surface extending smoothly into distant hills
    this.waterSurface = createRealisticWaterSurface(
      world.terrain,
      worldSize,
      Math.max(210, terrainSegments + 64),
      2.6,
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
    const colAttr = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    const wetTint = new THREE.Color(0x4a4332);
    const distantForestTint = new THREE.Color(
      season === 'winter'
        ? 0x9eb2bf
        : season === 'autumn'
          ? 0x6b5838
          : 0x3b5934,
    );
    const waterLevel = this.world.terrain.waterLevel;
    const halfSize = this.world.terrain.halfSize;

    const meadowHex =
      season === 'spring'
        ? 0x7da64e
        : season === 'summer'
          ? 0x679142
          : season === 'autumn'
            ? 0xa38246
            : 0xcbd5dc;
    const woodsHex =
      season === 'spring'
        ? 0x56753b
        : season === 'summer'
          ? 0x486632
          : season === 'autumn'
            ? 0x7a5f36
            : 0xb0bec8;
    const mossHex = season === 'winter' ? 0x8ea1a8 : 0x42733f;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const biome = this.world.terrain.getBiomeAt(x, z);

      if (biome === 'water') {
        const bedDepth = THREE.MathUtils.clamp((waterLevel - y) / 1.4, 0, 1);
        c.setHex(0x7c6f52).lerp(new THREE.Color(0x2d3326), bedDepth);
      } else if (biome === 'riverbank') {
        c.setHex(season === 'winter' ? 0x8d9599 : 0x887556);
      } else if (biome === 'rocky_ridge') {
        c.setHex(season === 'winter' ? 0xc2ccd4 : 0x656c64);
      } else if (biome === 'moss_hollow') {
        c.setHex(mossHex);
      } else if (biome === 'meadow') {
        c.setHex(meadowHex);
      } else {
        c.setHex(woodsHex);
      }

      // Damp darkened wet-earth fringe hugging the waterline for photorealistic shore transition
      const aboveWater = y - waterLevel;
      if (aboveWater > -0.15 && aboveWater < 0.38) {
        const wetness = 1.0 - THREE.MathUtils.smoothstep(aboveWater, 0.02, 0.38);
        c.lerp(wetTint, wetness * 0.42);
      }

      // Gently harmonize distant hills beyond the valley into deep wooded alpine tones
      const radialDist = Math.hypot(x, z);
      const distantMix = THREE.MathUtils.smoothstep(radialDist, halfSize * 0.95, halfSize * 2.5);
      if (distantMix > 0) {
        c.lerp(distantForestTint, distantMix * 0.62);
      }

      const shade = THREE.MathUtils.clamp(0.84 + y * 0.018, 0.72, 1.12);
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
