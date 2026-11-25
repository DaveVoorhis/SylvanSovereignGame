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
 * physically-based depth-aware flowing forest stream/pond water, and charming
 * cobblestone stepping-stone caravan trails dotted with warm trailside lanterns.
 */
export class TerrainRenderer {
  readonly terrainMesh: THREE.Mesh;
  readonly waterMesh: THREE.Mesh;
  private readonly waterSurface: RealisticWaterSurface;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private readonly routesGroup = new THREE.Group();
  private readonly steppingStoneGeo: THREE.BufferGeometry;
  private readonly steppingStoneMat: THREE.MeshStandardMaterial;
  private readonly lanternPostGeo: THREE.BufferGeometry;
  private readonly lanternGlowGeo: THREE.BufferGeometry;
  private readonly lanternPostMat: THREE.MeshStandardMaterial;
  private readonly lanternGlowMat: THREE.MeshStandardMaterial;
  private lastSeason: Season | null = null;
  private lastRouteSignature = '';

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

    // Cobblestone stepping-stone & miniature milepost lantern resources for trade paths
    this.steppingStoneGeo = new THREE.CylinderGeometry(0.34, 0.4, 0.1, 10);
    this.steppingStoneMat = new THREE.MeshStandardMaterial({
      color: 0xd9cdb2,
      map: textures.stone.map,
      roughness: 0.86,
    });
    this.lanternPostGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.72, 6);
    this.lanternPostGeo.translate(0, 0.36, 0);
    this.lanternGlowGeo = new THREE.SphereGeometry(0.11, 8, 6);
    this.lanternGlowGeo.translate(0, 0.76, 0);
    this.lanternPostMat = new THREE.MeshStandardMaterial({ color: 0x5c3e26, roughness: 0.88 });
    this.lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffe494,
      emissive: 0xffb347,
      emissiveIntensity: 1.3,
      roughness: 0.25,
    });

    scene.add(this.routesGroup);
    this.applySeasonalColors(world.season);
  }

  update(dt: number, sky?: SkyLightingState): void {
    if (sky) {
      this.waterSurface.update(dt, sky);
    }

    // Evening lantern glow on trade trails
    const sunY = Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2);
    const nightAmt = THREE.MathUtils.clamp(1 - (sunY + 0.1) * 2.1, 0.2, 1.8);
    this.lanternGlowMat.emissiveIntensity = nightAmt * 1.45;

    if (this.lastSeason !== this.world.season) {
      this.applySeasonalColors(this.world.season);
    }

    this.syncTradePaths();
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

  private syncTradePaths(): void {
    const routes = this.world.economy.activeRoutes;
    const sig = routes
      .map((r) => `${r.fromSettlementId}-${r.toSettlementId}:${r.activeCount}`)
      .join('|');
    if (sig === this.lastRouteSignature) return;
    this.lastRouteSignature = sig;

    while (this.routesGroup.children.length > 0) {
      this.routesGroup.remove(this.routesGroup.children[0]);
    }
    if (routes.length === 0) return;

    const stoneTransforms: THREE.Matrix4[] = [];
    const lanternTransforms: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const route of routes) {
      const dist = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z);
      const stoneCount = Math.max(8, Math.floor(dist / 1.45));
      for (let i = 1; i < stoneCount; i++) {
        const t = i / stoneCount;
        const wiggle = Math.sin(t * Math.PI * 3) * 0.65;
        const dx = route.to.x - route.from.x;
        const dz = route.to.z - route.from.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len;
        const pz = dx / len;

        const x = THREE.MathUtils.lerp(route.from.x, route.to.x, t) + px * wiggle;
        const z = THREE.MathUtils.lerp(route.from.z, route.to.z, t) + pz * wiggle;
        const groundY = this.world.terrain.getHeightAt(x, z);
        const y = Math.max(groundY, this.world.terrain.waterLevel) + 0.02;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, i * 1.1, 0);
        const sx = 0.8 + ((i * 7) % 5) * 0.1;
        const sz = 0.72 + ((i * 3) % 5) * 0.1;
        dummy.scale.set(sx, 1, sz);
        dummy.updateMatrix();
        stoneTransforms.push(dummy.matrix.clone());

        if (i % 7 === 0 && groundY > this.world.terrain.waterLevel + 0.25) {
          const side = i % 14 === 0 ? 1 : -1;
          const lx = x + px * side * 0.85;
          const lz = z + pz * side * 0.85;
          const ly = this.world.terrain.getHeightAt(lx, lz);
          dummy.position.set(lx, ly - 0.04, lz);
          dummy.rotation.set(0, i, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          lanternTransforms.push(dummy.matrix.clone());
        }
      }
    }

    if (stoneTransforms.length > 0) {
      const stones = new THREE.InstancedMesh(
        this.steppingStoneGeo,
        this.steppingStoneMat,
        stoneTransforms.length,
      );
      stones.receiveShadow = true;
      stoneTransforms.forEach((m, i) => stones.setMatrixAt(i, m));
      this.routesGroup.add(stones);
    }

    if (lanternTransforms.length > 0) {
      const posts = new THREE.InstancedMesh(
        this.lanternPostGeo,
        this.lanternPostMat,
        lanternTransforms.length,
      );
      const globes = new THREE.InstancedMesh(
        this.lanternGlowGeo,
        this.lanternGlowMat,
        lanternTransforms.length,
      );
      posts.castShadow = true;
      lanternTransforms.forEach((m, i) => {
        posts.setMatrixAt(i, m);
        globes.setMatrixAt(i, m);
      });
      this.routesGroup.add(posts, globes);
    }
  }

  dispose(): void {
    this.terrainMesh.geometry.dispose();
    this.terrainMaterial.dispose();
    this.waterSurface.dispose();
    this.steppingStoneGeo.dispose();
    this.steppingStoneMat.dispose();
    this.lanternPostGeo.dispose();
    this.lanternGlowGeo.dispose();
    this.lanternPostMat.dispose();
    this.lanternGlowMat.dispose();
  }
}
