import * as THREE from 'three';
import type { Season } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { isPointNearBridge } from '@simulation/terrain/Bridge';
import type { TreeSpot } from '@simulation/terrain/TerrainMap';
import type { WorldState } from '@simulation/WorldState';
import {
  createBerryBushGeo,
  createBirchCanopyGeo,
  createCurvedBirchTrunkGeo,
  createCurvedGrassTuftGeo,
  createFernRosetteGeo,
  createGnarledOakTrunkGeo,
  createLilyPadGeo,
  createLotusBloomGeo,
  createMossyBoulderGeo,
  createOakCanopyGeo,
  createPineCanopyGeo,
  createPineTrunkGeo,
  createToadstoolClusterGeo,
  createWildflowerClusterGeo,
  mergePartGeometries,
} from './GeometryHelpers';
import type { TextureLibrary } from './ProceduralTextures';
import type { SkyLightingState } from './WaterShader';

interface FoliageUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uDaylight: { value: number };
}

interface ClearableTreeGroup {
  readonly spots: TreeSpot[];
  readonly trunks: THREE.InstancedMesh;
  readonly crowns: THREE.InstancedMesh;
  readonly cleared: Uint8Array;
}

/**
 * Enhances a standard foliage material with gentle GPU breeze flutter and warm
 * backlit sunlit leaf translucency while preserving PBR lighting, shadows, and fog.
 */
function enhanceBotanicalFoliageMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: FoliageUniforms,
  windAmp: number,
  translucency: number,
): void {
  mat.customProgramCacheKey = () => `forest-foliage-${windAmp.toFixed(2)}-${translucency.toFixed(2)}`;
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
        varying vec3 vFoliageWorldPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 instOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float canopyMask = smoothstep(2.0, 6.8, position.y);
        float phase = uTime * (1.55 + uWindStrength * 1.1) + instOrigin.x * 0.27 + instOrigin.z * 0.21;
        float gust = sin(phase + position.y * 0.45) * 0.65 + cos(phase * 1.8 + position.x * 1.3 + position.z * 1.1) * 0.35;
        float flutter = sin(uTime * 4.2 + position.x * 3.1 + position.z * 2.7 + instOrigin.x) * 0.22;
        float sway = (gust + flutter) * ${windAmp.toFixed(3)} * (0.65 + uWindStrength * 0.95) * canopyMask;
        transformed.x += sway;
        transformed.z += sway * 0.68;
        transformed.y += flutter * 0.045 * canopyMask;`,
      )
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
        varying vec3 vFoliageWorldPos;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 fViewDir = normalize(cameraPosition - vFoliageWorldPos);
        float backLit = pow(clamp(dot(fViewDir, -normalize(uSunDir)), 0.0, 1.0), 3.0);
        float rimLit = 0.25 + 0.75 * backLit;
        outgoingLight += diffuseColor.rgb * uSunColor * rimLit * uDaylight * ${translucency.toFixed(3)};
        #include <opaque_fragment>`,
      );
  };
}

/**
 * High-resolution instanced woodland flora renderer:
 * realistic multi-branch ancient oaks, towering conifers, and graceful silver birches
 * clothed in volumetric alpha-cutout 3D botanical leaf/needle canopies with dappled shadows,
 * GPU wind sway, backlit sun translucency, dynamic city-expansion tree clearing,
 * and an endless outer horizon forest canopy fading softly into distance blur.
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
      uSunColor: { value: new THREE.Color(0xfff1cf) },
      uDaylight: { value: 1.0 },
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
      bumpMap: textures.oakBark.bumpMap,
      bumpScale: 0.22,
      roughnessMap: textures.oakBark.roughnessMap,
      roughness: 0.94,
    });
    const pineBarkMat = new THREE.MeshStandardMaterial({
      map: textures.pineBark.map,
      bumpMap: textures.pineBark.bumpMap,
      bumpScale: 0.22,
      roughnessMap: textures.pineBark.roughnessMap,
      roughness: 0.92,
    });
    const birchBarkMat = new THREE.MeshStandardMaterial({
      map: textures.birchBark.map,
      bumpMap: textures.birchBark.bumpMap,
      bumpScale: 0.14,
      roughnessMap: textures.birchBark.roughnessMap,
      roughness: 0.86,
    });

    // Botanical alpha-cutout PBR foliage materials with dappled shadow depth materials
    this.oakFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.oakLeafCluster,
      color: 0x5c8f42,
      roughness: 0.78,
      metalness: 0.01,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceBotanicalFoliageMaterial(this.oakFoliageMat, this.foliageUniforms, 0.11, 0.34);

    this.pineFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.pineNeedleSpray,
      color: 0x356947,
      roughness: 0.84,
      metalness: 0.01,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceBotanicalFoliageMaterial(this.pineFoliageMat, this.foliageUniforms, 0.08, 0.22);

    this.birchFoliageMat = new THREE.MeshStandardMaterial({
      map: textures.birchLeafCluster,
      color: 0x8cc256,
      roughness: 0.72,
      metalness: 0.01,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    enhanceBotanicalFoliageMaterial(this.birchFoliageMat, this.foliageUniforms, 0.15, 0.44);

    // Lightweight atmospheric materials for the endless distant horizon woodland
    this.distantPineMat = new THREE.MeshStandardMaterial({
      color: 0x315b40,
      roughness: 0.92,
      metalness: 0.0,
    });
    this.distantBroadleafMat = new THREE.MeshStandardMaterial({
      color: 0x4b743a,
      roughness: 0.9,
      metalness: 0.0,
    });

    const oakDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.oakLeafCluster,
      alphaTest: 0.42,
    });
    const pineDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.pineNeedleSpray,
      alphaTest: 0.38,
    });
    const birchDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: textures.birchLeafCluster,
      alphaTest: 0.4,
    });

    this.grassMat = new THREE.MeshStandardMaterial({
      color: 0x628c3e,
      roughness: 0.88,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.fernMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.bushMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      vertexColors: true,
    });
    this.toadstoolCapMat = new THREE.MeshStandardMaterial({
      map: textures.toadstoolCap,
      emissive: 0x3b0f0a,
      emissiveIntensity: 0.28,
      roughness: 0.42,
    });
    this.fairyLanternMat = new THREE.MeshStandardMaterial({
      color: 0xfff0b3,
      emissive: 0xffb84d,
      emissiveIntensity: 1.5,
      roughness: 0.25,
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
      const lanternGeo = new THREE.SphereGeometry(0.15, 10, 8);
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
        tint.setRGB(1 + v * 0.14, 1 + v * 0.08, 1 - v * 0.1);
        crowns.setColorAt(i, tint);

        if (i % 5 === 0) {
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

    // 2. Realistic Towering Pines
    if (pines.length > 0) {
      const trunkGeo = createPineTrunkGeo();
      const crownGeo = createPineCanopyGeo();
      this.disposables.push(trunkGeo, crownGeo);

      const trunks = new THREE.InstancedMesh(trunkGeo, pineBarkMat, pines.length);
      const crowns = new THREE.InstancedMesh(crownGeo, this.pineFoliageMat, pines.length);
      crowns.customDepthMaterial = pineDepthMat;
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;

      pines.forEach((t, i) => {
        const tiltX = ((i * 23) % 9 - 4) * 0.007;
        const tiltZ = ((i * 29) % 9 - 4) * 0.007;
        const tallVar = 0.94 + ((i * 11) % 7) * 0.032;

        dummy.position.set(t.x, t.y - 0.14, t.z);
        dummy.rotation.set(tiltX, t.rotation, tiltZ);
        dummy.scale.set(t.scale, t.scale * tallVar, t.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        crowns.setMatrixAt(i, dummy.matrix);

        const v = ((i * 19) % 11) / 10 - 0.5;
        tint.setRGB(1 + v * 0.08, 1 + v * 0.12, 1 + v * 0.06);
        crowns.setColorAt(i, tint);
      });
      this.group.add(trunks, crowns);
      this.clearableTreeGroups.push({
        spots: pines,
        trunks,
        crowns,
        cleared: new Uint8Array(pines.length),
      });
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

    // 3b. Endless Horizon Woodland Ring — lush low-poly distant forest stretching across outer hills (76m..340m)
    const rng = world.rng.fork();
    this.buildHorizonForestRing(rng, dummy, tint);

    // 4. Sculpted Mossy Boulders + Companion Pebbles
    if (world.terrain.rocks.length > 0) {
      const rockGeo = createMossyBoulderGeo();
      const rockMat = new THREE.MeshStandardMaterial({
        map: textures.stone.map,
        bumpMap: textures.stone.bumpMap,
        bumpScale: 0.16,
        roughness: 0.88,
        vertexColors: true,
      });
      this.disposables.push(rockGeo, rockMat);

      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, world.terrain.rocks.length * 2);
      rocks.castShadow = true;
      rocks.receiveShadow = true;

      world.terrain.rocks.forEach((r, i) => {
        dummy.position.set(r.x, r.y + 0.14 * r.scale, r.z);
        dummy.rotation.set(r.variant * 0.25, r.rotation, r.variant * 0.18);
        dummy.scale.set(r.scale * 1.24, r.scale * 0.72, r.scale * 1.08);
        dummy.updateMatrix();
        rocks.setMatrixAt(i * 2, dummy.matrix);

        const rockBiome = world.terrain.getBiomeAt(r.x, r.z);
        if (rockBiome === 'desert') {
          tint.setHex(0xd48e58);
        } else if (rockBiome === 'seashore') {
          tint.setHex(0xc9c4b6);
        } else if (rockBiome === 'alpine_crag') {
          tint.setHex(0xd6dfe3);
        } else if (rockBiome === 'rocky_ridge') {
          tint.setHex(0xb1b8b4);
        } else if (rockBiome === 'moss_hollow' || rockBiome === 'deep_woods') {
          tint.setHex(0x8fa387);
        } else {
          tint.setHex(0xc4c7be);
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

    // 5. Arching Ferns (variant 0), Plump Berry Bushes (variant 1), Polka-Dot Toadstool Clusters (variant 2)
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
        dummy.scale.setScalar(f.scale * 1.15);
        dummy.updateMatrix();
        fernMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(fernMesh);
    }

    if (bushes.length > 0) {
      const { foliage, berries } = createBerryBushGeo();
      const berryMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0.05,
      });
      this.disposables.push(foliage, berries, berryMat);

      const bushMesh = new THREE.InstancedMesh(foliage, this.bushMat, bushes.length);
      const berryMesh = new THREE.InstancedMesh(berries, berryMat, bushes.length);
      bushMesh.castShadow = true;
      bushMesh.receiveShadow = true;

      const berryPalette = [0xe03a3e, 0x4b5ec7, 0xf29f29, 0xd6487e];
      bushes.forEach((b, i) => {
        dummy.position.set(b.x, b.y - 0.04, b.z);
        dummy.rotation.set(0, b.rotation, 0);
        dummy.scale.setScalar(b.scale * 1.12);
        dummy.updateMatrix();
        bushMesh.setMatrixAt(i, dummy.matrix);
        berryMesh.setMatrixAt(i, dummy.matrix);
        tint.setHex(berryPalette[i % berryPalette.length]);
        berryMesh.setColorAt(i, tint);
      });
      this.group.add(bushMesh, berryMesh);
    }

    if (shrooms.length > 0) {
      const { stems, caps } = createToadstoolClusterGeo();
      const stemMat = new THREE.MeshStandardMaterial({
        color: 0xf4ead8,
        roughness: 0.78,
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
        dummy.scale.setScalar(m.scale * 1.15);
        dummy.updateMatrix();
        stemMesh.setMatrixAt(i, dummy.matrix);
        capMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(stemMesh, capMesh);
    }

    // 6. Whimsical Meadow Wildflower Clusters (circular valley spread)
    const circularRadius = world.terrain.halfSize + 4;
    {
      const flowerCount = 560;
      const { stems, petals, centers } = createWildflowerClusterGeo();
      const fStemMat = new THREE.MeshStandardMaterial({ color: 0x4b7d34, roughness: 0.85 });
      const fPetalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const fCenterMat = new THREE.MeshStandardMaterial({
        color: 0xffd24d,
        emissive: 0x382504,
        roughness: 0.5,
      });
      this.disposables.push(stems, petals, centers, fStemMat, fPetalMat, fCenterMat);

      const stemInst = new THREE.InstancedMesh(stems, fStemMat, flowerCount);
      const petalInst = new THREE.InstancedMesh(petals, fPetalMat, flowerCount);
      const centerInst = new THREE.InstancedMesh(centers, fCenterMat, flowerCount);

      const petalColors = [0xfff8eb, 0xffe066, 0xff9ec4, 0x9ec5ff, 0xd8a8ff, 0xffb385];
      let placed = 0;
      for (let tries = 0; tries < flowerCount * 5 && placed < flowerCount; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const fx = Math.cos(a) * r;
        const fz = Math.sin(a) * r;
        const fy = world.terrain.getHeightAt(fx, fz);
        if (fy < world.terrain.waterLevel + 0.35 || fy > 5.4) continue;
        const biome = world.terrain.getBiomeAt(fx, fz);
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
        const s = rng.range(0.85, 1.55);
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

    // 7. Pond Lily Pads, Pastel Lotus Blooms & Riverside Cattails
    {
      const padGeo = createLilyPadGeo();
      const lotusGeo = createLotusBloomGeo();
      const padMat = new THREE.MeshStandardMaterial({ color: 0x3b7838, roughness: 0.48 });
      const lotusMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.45,
        vertexColors: true,
      });
      this.disposables.push(padGeo, lotusGeo, padMat, lotusMat);

      const maxPads = 110;
      const padInst = new THREE.InstancedMesh(padGeo, padMat, maxPads);
      const lotusInst = new THREE.InstancedMesh(lotusGeo, lotusMat, maxPads);
      padInst.receiveShadow = true;

      let padsPlaced = 0;
      let lotusesPlaced = 0;
      for (let tries = 0; tries < 1800 && padsPlaced < maxPads; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * (circularRadius * 0.85);
        const lx = Math.cos(a) * r;
        const lz = Math.sin(a) * r;
        const ly = world.terrain.getHeightAt(lx, lz);
        if (ly > world.terrain.waterLevel - 0.22) continue;
        // Keep lily pads in calm freshwater ponds & rivers, never in ocean surf
        if (world.terrain.getCoastSignedDistance(lx, lz) < 12) continue;

        const rot = rng.range(0, Math.PI * 2);
        const scale = rng.range(0.68, 1.38);
        dummy.position.set(lx, world.terrain.waterLevel + 0.035, lz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        padInst.setMatrixAt(padsPlaced++, dummy.matrix);

        if (rng.chance(0.45)) {
          dummy.position.set(lx, world.terrain.waterLevel + 0.055, lz);
          dummy.scale.setScalar(scale * 1.15);
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
      const reedMat = new THREE.MeshStandardMaterial({ color: 0x4f7c3c, roughness: 0.85 });
      const cattailMat = new THREE.MeshStandardMaterial({ color: 0x5c361e, roughness: 0.92 });
      this.disposables.push(reedGeo, headGeo, reedMat, cattailMat);

      const maxReeds = 175;
      const reedInst = new THREE.InstancedMesh(reedGeo, reedMat, maxReeds);
      const cattailInst = new THREE.InstancedMesh(headGeo, cattailMat, maxReeds);
      let reedsPlaced = 0;
      for (let tries = 0; tries < 2600 && reedsPlaced < maxReeds; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const rx = Math.cos(a) * r;
        const rz = Math.sin(a) * r;
        const ry = world.terrain.getHeightAt(rx, rz);
        if (ry < world.terrain.waterLevel - 0.12 || ry > world.terrain.waterLevel + 0.36) continue;
        // Keep cattails along freshwater riverbanks & ponds rather than salty ocean beach
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

    // 8. Dense Curved Multi-Blade Woodland Grass Tufts (circular spread)
    const grassCount = Math.floor(world.config.grassBladeCount * grassMultiplier * 0.65);
    if (grassCount > 0) {
      const tuftGeo = createCurvedGrassTuftGeo();
      this.disposables.push(tuftGeo);

      const grass = new THREE.InstancedMesh(tuftGeo, this.grassMat, grassCount);
      grass.receiveShadow = true;

      let placed = 0;
      for (let i = 0; i < grassCount * 2 && placed < grassCount; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * circularRadius;
        const gx = Math.cos(a) * r;
        const gz = Math.sin(a) * r;
        const gy = world.terrain.getHeightAt(gx, gz);
        if (gy < world.terrain.waterLevel + 0.25 || gy > 8.4) continue;
        const gBiome = world.terrain.getBiomeAt(gx, gz);
        if (gBiome === 'alpine_crag' || gBiome === 'water') continue;
        if (gBiome === 'desert' && rng.chance(0.95)) continue;
        if (gBiome === 'seashore' && rng.chance(0.84)) continue;
        dummy.position.set(gx, gy - 0.04, gz);
        dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
        const s = rng.range(0.72, 1.5);
        dummy.scale.set(s, s * rng.range(0.85, 1.35), s);
        dummy.updateMatrix();
        grass.setMatrixAt(placed, dummy.matrix);

        if (gBiome === 'prairie') {
          tint.setHex(0xdcc86b);
        } else if (gBiome === 'desert' || gBiome === 'seashore') {
          tint.setHex(0xd9bf7c);
        } else if (gBiome === 'moss_hollow') {
          tint.setHex(0x74b56a);
        } else if (gBiome === 'meadow') {
          tint.setHex(0xc2de7c);
        } else if (gBiome === 'rocky_ridge') {
          tint.setHex(0x9eab88);
        } else {
          tint.setHex(0x9bc27c);
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
    // Low-poly silhouette conifers & broadleaf woodland canopies encircling the valley out to 345m
    const pineParts: THREE.BufferGeometry[] = [];
    const tier1 = new THREE.ConeGeometry(2.6, 5.4, 7);
    tier1.translate(0, 3.6, 0);
    const tier2 = new THREE.ConeGeometry(2.0, 4.6, 7);
    tier2.translate(0, 6.2, 0);
    const tier3 = new THREE.ConeGeometry(1.3, 3.6, 6);
    tier3.translate(0, 8.6, 0);
    pineParts.push(tier1, tier2, tier3);
    const distantPineGeo = mergePartGeometries(pineParts, false);

    const oakParts: THREE.BufferGeometry[] = [];
    const domeMain = new THREE.DodecahedronGeometry(2.9, 1);
    domeMain.scale(1.15, 0.88, 1.15);
    domeMain.translate(0, 5.2, 0);
    const domeSide = new THREE.DodecahedronGeometry(2.1, 1);
    domeSide.translate(1.4, 4.4, 0.7);
    const domeSide2 = new THREE.DodecahedronGeometry(1.9, 1);
    domeSide2.translate(-1.3, 4.5, -0.8);
    oakParts.push(domeMain, domeSide, domeSide2);
    const distantOakGeo = mergePartGeometries(oakParts, false);

    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.55, 3.2, 5);
    trunkGeo.translate(0, 1.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3829, roughness: 0.95 });

    this.disposables.push(distantPineGeo, distantOakGeo, trunkGeo, trunkMat);

    const innerR = this.world.terrain.halfSize + 4;
    const outerR = this.world.terrain.halfSize * 3.3; // ~528m
    const pineTarget = 680;
    const oakTarget = 460;

    const pineMesh = new THREE.InstancedMesh(distantPineGeo, this.distantPineMat, pineTarget);
    const oakMesh = new THREE.InstancedMesh(distantOakGeo, this.distantBroadleafMat, oakTarget);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, pineTarget + oakTarget);
    pineMesh.frustumCulled = false;
    oakMesh.frustumCulled = false;
    trunkMesh.frustumCulled = false;

    let pineCount = 0;
    let oakCount = 0;
    let trunkCount = 0;

    for (let tries = 0; tries < 3600 && (pineCount < pineTarget || oakCount < oakTarget); tries++) {
      const a = rng.range(0, Math.PI * 2);
      // Area-weighted distribution with extra density in the mid-distance transition band
      const u = Math.pow(rng.next(), 0.78);
      const r = innerR + u * (outerR - innerR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.world.terrain.getHeightAt(x, z);
      if (y < this.world.terrain.waterLevel + 0.45 || y > 18.5) continue;
      // Keep open ocean sea and distant desert dunes free of horizon forests
      if (this.world.terrain.getCoastSignedDistance(x, z) < 18) continue;
      if (this.world.terrain.getBiomeAt(x, z) === 'desert') continue;

      const isPine = pineCount < pineTarget && (oakCount >= oakTarget || rng.chance(0.6));
      const distScale = 1.0 + u * 0.85;
      const s = rng.range(0.88, 1.55) * distScale;

      dummy.position.set(x, y - 0.35, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(s, s * rng.range(0.92, 1.25), s);
      dummy.updateMatrix();

      if (isPine) {
        pineMesh.setMatrixAt(pineCount, dummy.matrix);
        const v = rng.range(-0.14, 0.14);
        tint.setRGB(1 + v * 0.7, 1 + v, 1 + v * 0.6);
        pineMesh.setColorAt(pineCount, tint);
        pineCount++;
      } else {
        oakMesh.setMatrixAt(oakCount, dummy.matrix);
        const v = rng.range(-0.16, 0.16);
        tint.setRGB(1 + v, 1 + v * 0.8, 1 - v * 0.5);
        oakMesh.setColorAt(oakCount, tint);
        oakCount++;
      }

      trunkMesh.setMatrixAt(trunkCount++, dummy.matrix);
    }

    pineMesh.count = pineCount;
    oakMesh.count = oakCount;
    trunkMesh.count = trunkCount;
    this.group.add(trunkMesh, pineMesh, oakMesh);
  }

  update(dt = 0, sky?: SkyLightingState): void {
    if (this.lastSeason !== this.world.season) {
      this.updateSeasonPalette(this.world.season);
    }

    // Dynamically clear trees wherever growing cities raise new buildings or waterway bridges
    if (this.world.structureRevision !== this.lastStructureRevision) {
      this.lastStructureRevision = this.world.structureRevision;
      this.clearTreesNearBuildings();
    }

    // Drive organic wind flutter & sunlit backlit leaf translucency
    this.foliageUniforms.uTime.value += dt;
    if (sky) {
      this.foliageUniforms.uWindStrength.value = sky.windStrength;
      this.foliageUniforms.uSunDir.value.copy(sky.sunDirection);
      this.foliageUniforms.uSunColor.value.copy(sky.sunColor);
      this.foliageUniforms.uDaylight.value = sky.daylight;
    }

    // Gentle lily pad bobbing & evening fairy lantern / toadstool shimmer
    const t = this.world.elapsedSeconds;
    this.lilyGroup.position.y = Math.sin(t * 1.45) * 0.022;

    const sunY = Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2);
    const nightAmt = THREE.MathUtils.clamp(1 - (sunY + 0.1) * 2.1, 0.15, 1.6);
    this.fairyLanternMat.emissiveIntensity = nightAmt * (1.35 + Math.sin(t * 3.8) * 0.2);
    this.toadstoolCapMat.emissiveIntensity = 0.12 + nightAmt * 0.32;
  }

  private clearTreesNearBuildings(): void {
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    for (const group of this.clearableTreeGroups) {
      let dirty = false;
      for (let i = 0; i < group.spots.length; i++) {
        if (group.cleared[i]) continue;
        const tree = group.spots[i];

        let blocked = false;
        for (const settlement of this.world.settlements) {
          if (Math.hypot(tree.x - settlement.center.x, tree.z - settlement.center.z) < 7.5) {
            blocked = true;
            break;
          }
          for (const b of settlement.buildings) {
            const clearDist = BUILDING_CATALOG[b.type].footprintRadius + 1.45;
            if (Math.hypot(tree.x - b.position.x, tree.z - b.position.z) < clearDist) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) {
          for (const br of this.world.bridges) {
            if (isPointNearBridge(br, tree.x, tree.z, 1.8)) {
              blocked = true;
              break;
            }
          }
        }

        if (blocked) {
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
  }

  private updateSeasonPalette(season: Season): void {
    this.lastSeason = season;
    this.wildflowerGroup.visible = season !== 'winter';

    if (season === 'spring') {
      this.oakFoliageMat.color.setHex(0x639945);
      this.pineFoliageMat.color.setHex(0x3a6e4c);
      this.birchFoliageMat.color.setHex(0x95cc5c);
      this.distantPineMat.color.setHex(0x2f5e42);
      this.distantBroadleafMat.color.setHex(0x52823d);
      this.grassMat.color.setHex(0x6c9c42);
      this.fernMat.color.setHex(0xffffff);
      this.bushMat.color.setHex(0xffffff);
    } else if (season === 'summer') {
      this.oakFoliageMat.color.setHex(0x4b7d39);
      this.pineFoliageMat.color.setHex(0x2e5c3e);
      this.birchFoliageMat.color.setHex(0x73ab4b);
      this.distantPineMat.color.setHex(0x274e36);
      this.distantBroadleafMat.color.setHex(0x416c32);
      this.grassMat.color.setHex(0x598539);
      this.fernMat.color.setHex(0xebfae6);
      this.bushMat.color.setHex(0xe8f5e1);
    } else if (season === 'autumn') {
      this.oakFoliageMat.color.setHex(0xd9752b);
      this.pineFoliageMat.color.setHex(0x345e42);
      this.birchFoliageMat.color.setHex(0xf2c244);
      this.distantPineMat.color.setHex(0x2e523a);
      this.distantBroadleafMat.color.setHex(0xb4692c);
      this.grassMat.color.setHex(0x9a7d3e);
      this.fernMat.color.setHex(0xd9b36c);
      this.bushMat.color.setHex(0xd69658);
    } else {
      this.oakFoliageMat.color.setHex(0xb8c8d4);
      this.pineFoliageMat.color.setHex(0x5d827a);
      this.birchFoliageMat.color.setHex(0xd2dde6);
      this.distantPineMat.color.setHex(0x547470);
      this.distantBroadleafMat.color.setHex(0xa8b8c4);
      this.grassMat.color.setHex(0xb8c6cf);
      this.fernMat.color.setHex(0x9ab0b8);
      this.bushMat.color.setHex(0xb0c2cc);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
