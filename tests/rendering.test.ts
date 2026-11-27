import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import type { BiomeType, ConstructionStage, CreatureRole } from '@core/Types';
import { createDivineBeamVisual, DIVINE_BEAM_HEIGHT } from '@rendering/AtmosphereSystem';
import { AmbientCritterRenderer } from '@rendering/AmbientCritterRenderer';
import { CreatureRenderer } from '@rendering/CreatureRenderer';
import { CREATURE_LEG_LENGTH } from '@simulation/creatures/StrideKinematics';
import { CameraController } from '@rendering/CameraController';
import { DistanceFocusBlurPass } from '@rendering/DistanceFocusBlurPass';
import { FloraRenderer } from '@rendering/FloraRenderer';
import {
  HearthFire,
  createChimneySmokeGeometry,
  createChimneySmokeMaterial,
  createOvenFireMaterial,
  createSharedFlameGeometry,
} from '@rendering/FireEffect';
import {
  HORIZON_PINE_VARIANT_COUNT,
  PINE_VARIANT_COUNT,
  createBerryBushGeo,
  createBirchCanopyGeo,
  createCragSpireGeo,
  createCurvedBirchTrunkGeo,
  createCurvedGrassTuftGeo,
  createFernRosetteGeo,
  createGnarledOakTrunkGeo,
  createHorizonPineGeo,
  createLilyPadGeo,
  createLotusBloomGeo,
  createMossyBoulderGeo,
  createOakCanopyGeo,
  createOrganicPuffGeo,
  createPineCanopyGeo,
  createPineTrunkGeo,
  createScallopedPineTierGeo,
  createToadstoolClusterGeo,
  createWildflowerClusterGeo,
} from '@rendering/GeometryHelpers';
import {
  PINE_FROND_TYPE_COUNT,
  buildProceduralHorizonPines,
  buildProceduralPineForest,
  createPineFrondGeo,
  generateProceduralPineSpec,
} from '@rendering/ProceduralPineBuilder';
import { nextPaintFrame, SplashScreen, WHIMSICAL_HINTS } from '@ui/SplashScreen';
import type { PbrTextureSet, TextureLibrary } from '@rendering/ProceduralTextures';
import { SettlementRenderer } from '@rendering/SettlementRenderer';
import { TerrainRenderer } from '@rendering/TerrainRenderer';
import { createRealisticWaterSurface } from '@rendering/WaterShader';
import { Creature } from '@simulation/creatures/Creature';
import { Settlement } from '@simulation/settlements/Settlement';
import { ALL_VILLAGE_ADAPTATIONS } from '@simulation/settlements/VillageAdaptation';
import { ALL_SPECIES_IDS } from '@simulation/creatures/SpeciesCatalog';
import { ALL_BUILDING_TYPES } from '@simulation/settlements/BuildingCatalog';
import { WorldState } from '@simulation/WorldState';

function assertValidGeometry(geo: THREE.BufferGeometry, requireColor = false): void {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  const norm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  expect(pos).toBeDefined();
  expect(norm).toBeDefined();
  expect(pos!.count).toBeGreaterThan(12);
  for (let i = 0; i < pos!.array.length; i++) {
    expect(Number.isFinite(pos!.array[i])).toBe(true);
  }
  for (let i = 0; i < norm!.array.length; i++) {
    expect(Number.isFinite(norm!.array[i])).toBe(true);
  }
  if (requireColor) {
    const col = geo.attributes.color as THREE.BufferAttribute | undefined;
    expect(col).toBeDefined();
    expect(col!.count).toBe(pos!.count);
  }
}

function createStubTextureLibrary(): TextureLibrary {
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) as unknown as THREE.CanvasTexture;
  const pbr = (): PbrTextureSet => ({ map: dummyTex, bumpMap: dummyTex, roughnessMap: dummyTex });
  return {
    forestFloor: pbr(),
    oakBark: pbr(),
    pineBark: pbr(),
    birchBark: pbr(),
    timber: pbr(),
    thatch: pbr(),
    stone: pbr(),
    waterNormal: dummyTex,
    furBump: dummyTex,
    fabricBump: dummyTex,
    toadstoolCap: dummyTex,
    softParticle: dummyTex,
    oakLeafCluster: dummyTex,
    birchLeafCluster: dummyTex,
    pineNeedleSpray: dummyTex,
    dispose() {
      dummyTex.dispose();
    },
  };
}

describe('High-Resolution Whimsical Procedural Models', () => {
  it('generates valid, finite, high-resolution flora and environment geometries', () => {
    const oakTrunk = createGnarledOakTrunkGeo();
    assertValidGeometry(oakTrunk);
    oakTrunk.dispose();

    const oakCanopy = createOakCanopyGeo();
    assertValidGeometry(oakCanopy, true);
    oakCanopy.dispose();

    const pineTrunk = createPineTrunkGeo();
    assertValidGeometry(pineTrunk);
    pineTrunk.dispose();

    const pineCanopy = createPineCanopyGeo();
    assertValidGeometry(pineCanopy, true);
    pineCanopy.dispose();

    const birchTrunk = createCurvedBirchTrunkGeo();
    assertValidGeometry(birchTrunk);
    birchTrunk.dispose();

    const birchCanopy = createBirchCanopyGeo();
    assertValidGeometry(birchCanopy, true);
    birchCanopy.dispose();

    const pineTier = createScallopedPineTierGeo(2.2, 2.8, 7);
    assertValidGeometry(pineTier, true);
    pineTier.dispose();

    const puff = createOrganicPuffGeo(2.1, 3, 0.16, 1.5, 0x8da682, 0xffffff);
    assertValidGeometry(puff, true);
    puff.dispose();

    const boulder = createMossyBoulderGeo();
    assertValidGeometry(boulder, true);
    boulder.dispose();

    const crag = createCragSpireGeo();
    assertValidGeometry(crag, true);
    crag.dispose();

    const fern = createFernRosetteGeo();
    assertValidGeometry(fern, true);
    fern.dispose();

    const bush = createBerryBushGeo();
    assertValidGeometry(bush.foliage, true);
    assertValidGeometry(bush.berries);
    bush.foliage.dispose();
    bush.berries.dispose();

    const toadstools = createToadstoolClusterGeo();
    assertValidGeometry(toadstools.stems);
    assertValidGeometry(toadstools.caps);
    // Verify toadstool caps have upward/outward normals (not inverted inside-out)
    const capNorms = toadstools.caps.attributes.normal as THREE.BufferAttribute;
    const capPos = toadstools.caps.attributes.position as THREE.BufferAttribute;
    let capUpSum = 0;
    for (let i = 0; i < capPos.count; i++) {
      if (capPos.getY(i) > 0.35) {
        capUpSum += capNorms.getY(i);
      }
    }
    expect(capUpSum).toBeGreaterThan(0);
    toadstools.stems.dispose();
    toadstools.caps.dispose();

    const wildflowers = createWildflowerClusterGeo();
    assertValidGeometry(wildflowers.stems);
    assertValidGeometry(wildflowers.petals);
    assertValidGeometry(wildflowers.centers);
    wildflowers.stems.dispose();
    wildflowers.petals.dispose();
    wildflowers.centers.dispose();

    const lily = createLilyPadGeo();
    assertValidGeometry(lily);
    lily.dispose();

    const lotus = createLotusBloomGeo();
    assertValidGeometry(lotus, true);
    lotus.dispose();

    const grass = createCurvedGrassTuftGeo();
    assertValidGeometry(grass, true);
    grass.dispose();
  });

  it('builds a terrain-aware realistic water surface extending smoothly toward the horizon', () => {
    const world = new WorldState(new EventBus(), { seed: 20261123 });
    const water = createRealisticWaterSurface(world.terrain, world.config.worldSize, 96, 2.4);

    const geo = water.mesh.geometry;
    assertValidGeometry(geo);

    const depthAttr = geo.attributes.aDepth as THREE.BufferAttribute | undefined;
    const flowAttr = geo.attributes.aFlow as THREE.BufferAttribute | undefined;
    expect(depthAttr).toBeDefined();
    expect(flowAttr).toBeDefined();
    expect(depthAttr!.count).toBe(geo.attributes.position.count);
    expect(flowAttr!.count).toBe(geo.attributes.position.count);

    // Verify water updates cleanly with live sky lighting state
    water.update(0.016, {
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
      sunColor: new THREE.Color(0xfff1cf),
      skyTopColor: new THREE.Color(0x2a619e),
      skyHorizonColor: new THREE.Color(0xc8dece),
      fogColor: new THREE.Color(0xc8dece),
      fogDensity: 0.0056,
      daylight: 0.95,
      windStrength: 0.3,
      isWinter: false,
    });

    water.dispose();
  });

  it('configures DistanceFocusBlurPass with dynamic focal plane and horizon mist uniforms', () => {
    const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.22, 880);
    const pass = new DistanceFocusBlurPass(camera, 16);

    pass.updateParams({
      focusDistance: 42,
      focusRange: 34,
      maxBlur: 0.012,
      horizonFadeStart: 195,
      horizonFadeEnd: 455,
      horizonColor: new THREE.Color(0xc8dece),
      isPov: false,
    });

    expect(pass.material.uniforms.uFocusDistance.value).toBe(42);
    expect(pass.material.uniforms.uHorizonFadeEnd.value).toBe(455);
    expect(pass.material.uniforms.uTaps.value).toBe(16);
    pass.setSize(1920, 1080);
    expect(pass.material.uniforms.uAspect.value).toBeCloseTo(16 / 9, 4);
    // Reconstructed view normals must scale finite differences before crossing to prevent HiDPI close-up underflow
    expect(pass.material.fragmentShader).toContain('float invScale = 1.0 / max(-centerPos.z * uTexelSize.y, 1e-5);');

    pass.dispose();
  });

  it('builds volumetric HearthFire with ember bed, shader flames, sparks, smoke, and flickering light', () => {
    const sharedFlameGeo = createSharedFlameGeometry();
    assertValidGeometry(sharedFlameGeo);
    expect(sharedFlameGeo.attributes.aPhase).toBeDefined();
    expect(sharedFlameGeo.attributes.aLayer).toBeDefined();

    const fire = new HearthFire(1.7, sharedFlameGeo);
    fire.update(1.25, 1.4, 0.35);
    const lightPosA = fire.light.position.clone();
    const intensityA = fire.light.intensity;

    fire.update(2.85, 1.4, 0.85);
    expect(fire.flameMaterial.uniforms.uTime.value).toBeGreaterThan(2.0);
    expect(fire.light.intensity).toBeGreaterThan(1.0);
    expect(
      fire.light.position.distanceTo(lightPosA) > 0 || Math.abs(fire.light.intensity - intensityA) > 0,
    ).toBe(true);

    let meshCount = 0;
    let pointsCount = 0;
    fire.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshCount++;
      if (obj instanceof THREE.Points) pointsCount++;
    });
    // Ember bed + volumetric flame mesh, plus rising sparks + rising smoke wisps
    expect(meshCount).toBe(2);
    expect(pointsCount).toBe(2);

    const ovenMat = createOvenFireMaterial();
    ovenMat.uniforms.uTime.value = 3.5;
    expect(ovenMat.uniforms.uTime.value).toBe(3.5);
    ovenMat.dispose();

    const chimneyGeo = createChimneySmokeGeometry(2.3, 26);
    expect(chimneyGeo.attributes.position.count).toBe(26);
    expect(chimneyGeo.attributes.aSeed).toBeDefined();
    expect(chimneyGeo.attributes.aSpeed).toBeDefined();
    expect(chimneyGeo.attributes.aRadius).toBeDefined();
    expect(chimneyGeo.attributes.aHeight).toBeDefined();
    expect(chimneyGeo.attributes.aSize).toBeDefined();
    chimneyGeo.dispose();

    const chimneyMat = createChimneySmokeMaterial();
    expect(chimneyMat.uniforms.uWind.value).toBeInstanceOf(THREE.Vector2);
    expect(chimneyMat.uniforms.uSunDir.value).toBeInstanceOf(THREE.Vector3);
    expect(chimneyMat.transparent).toBe(true);
    expect(chimneyMat.depthWrite).toBe(false);
    chimneyMat.dispose();

    fire.dispose();
    sharedFlameGeo.dispose();
  });

  it('renders and animates all 14 diverse storybook city building types cleanly', () => {
    const world = new WorldState(new EventBus(), { seed: 55555 });
    const settlement = world.settlements[0];
    expect(settlement).toBeDefined();

    // Add one instance of every single building type to verify geometry, animation, and disposal
    ALL_BUILDING_TYPES.forEach((type, idx) => {
      settlement.buildings.push({
        id: `test_bld_${type}`,
        settlementId: settlement.id,
        type,
        position: { x: settlement.center.x + idx * 5, z: settlement.center.z + 6 },
        groundY: 2,
        rotation: idx * 0.4,
        progress: 100,
        completed: true,
      });
    });

    // Also verify both timber & stone arched bridges render progressively and complete cleanly
    world.bridges.push(
      {
        id: 'test_bridge_timber',
        settlementId: settlement.id,
        style: 'timber_arch',
        startX: -6,
        startZ: 0,
        startY: 0.4,
        endX: 6,
        endZ: 0,
        endY: 0.5,
        centerX: 0,
        centerZ: 0,
        archHeight: 1.4,
        length: 12,
        width: 2.6,
        dirX: 1,
        dirZ: 0,
        yaw: Math.PI / 2,
        progress: 45,
        completed: false,
      },
      {
        id: 'test_bridge_stone',
        settlementId: settlement.id,
        style: 'stone_arch',
        startX: -7,
        startZ: 14,
        startY: 0.5,
        endX: 7,
        endZ: 14,
        endY: 0.6,
        centerX: 0,
        centerZ: 14,
        archHeight: 1.5,
        length: 14,
        width: 2.6,
        dirX: 1,
        dirZ: 0,
        yaw: Math.PI / 2,
        progress: 100,
        completed: true,
      },
    );

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const renderer = new SettlementRenderer(scene, world, textures);
    renderer.update(0.05);
    world.bridges[0].progress = 100;
    world.bridges[0].completed = true;
    renderer.update(0.05);

    let meshCount = 0;
    let bellRoofChecked = false;
    renderer.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        if (obj.geometry instanceof THREE.LatheGeometry && obj.position.y > 1.7 && obj.position.y < 1.8) {
          // Burrow cottage bell roof: outer slope vertices must face outward & upward, never inside-out
          const pos = obj.geometry.attributes.position as THREE.BufferAttribute;
          const norm = obj.geometry.attributes.normal as THREE.BufferAttribute;
          let outwardDotSum = 0;
          for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) > 0.3 && pos.getY(i) < 1.5) {
              outwardDotSum += pos.getX(i) * norm.getX(i) + pos.getZ(i) * norm.getZ(i);
            }
          }
          expect(outwardDotSum).toBeGreaterThan(0);
          bellRoofChecked = true;
        }
      }
    });
    expect(bellRoofChecked).toBe(true);
    expect(meshCount).toBeGreaterThan(ALL_BUILDING_TYPES.length * 10 + 40);

    renderer.dispose();
    textures.dispose();
  });

  it('builds and animates articulated high-resolution rigs for all 21 species and all 6 roles', () => {
    const world = new WorldState(new EventBus(), { seed: 98765 });
    const roles: CreatureRole[] = ['forager', 'builder', 'merchant', 'guard', 'artisan', 'mystic'];

    // Ensure every species + every role is explicitly represented
    ALL_SPECIES_IDS.forEach((species, idx) => {
      world.creatures.push(
        new Creature({
          id: `test_species_${species}`,
          name: `Test ${species}`,
          species,
          settlementId: world.settlements[0]?.id ?? 's0',
          role: roles[idx % roles.length],
          x: idx * 2,
          y: 1,
          z: 0,
          personality: {
            friendliness: 0.7,
            ambition: 0.6,
            bravery: 0.5,
            piety: 0.6,
            curiosity: 0.8,
          },
          animPhase: idx * 0.5,
        }),
      );
    });

    const scene = new THREE.Scene();
    const renderer = new CreatureRenderer(scene, world);

    // Step animation frames across varied activities
    world.creatures[0].activity = 'socialising';
    world.creatures[1].activity = 'praying';
    world.creatures[2].activity = 'building';
    world.creatures[3].activity = 'resting';
    renderer.update(0.016, { kind: 'creature', id: world.creatures[0].id });
    renderer.update(0.016, null);

    let meshCount = 0;
    renderer.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        const pos = obj.geometry.getAttribute('position');
        expect(pos).toBeDefined();
        for (let i = 0; i < Math.min(pos.count, 16); i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true);
          expect(Number.isFinite(pos.getY(i))).toBe(true);
          expect(Number.isFinite(pos.getZ(i))).toBe(true);
        }
      }
    });

    // High-resolution articulated creatures have many sculpted sub-meshes per creature
    expect(ALL_SPECIES_IDS).toHaveLength(24);
    expect(meshCount).toBeGreaterThan(world.creatures.length * 10);

    renderer.dispose();
  });

  it('renders 5-stage timber and masonry construction kits, disposes disassembled buildings, and animates creature stage tools', () => {
    const world = new WorldState(new EventBus(), { seed: 444555 });
    const settlement = world.settlements[0];

    // Add one timber-frame and one masonry building at stage 0 (clearing land)
    const timberPlot = {
      id: 'stage_test_timber',
      settlementId: settlement.id,
      type: 'timber_house' as const,
      position: { x: settlement.center.x + 8, z: settlement.center.z + 2 },
      groundY: 2,
      rotation: 0.3,
      progress: 5,
      completed: false,
    };
    const masonryPlot = {
      id: 'stage_test_masonry',
      settlementId: settlement.id,
      type: 'library' as const,
      position: { x: settlement.center.x - 8, z: settlement.center.z + 2 },
      groundY: 2,
      rotation: 0.8,
      progress: 5,
      completed: false,
    };
    settlement.buildings.push(timberPlot, masonryPlot);

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const settlementRenderer = new SettlementRenderer(scene, world, textures);
    const creatureRenderer = new CreatureRenderer(scene, world, textures);

    // Step across all 5 construction stages + completion + disassembly
    const progressSteps = [5, 25, 45, 68, 90, 100];
    const stages: ConstructionStage[] = [
      'clearing',
      'leveling',
      'foundation',
      'framing',
      'finishing',
      'disassembling',
    ];
    for (let i = 0; i < progressSteps.length; i++) {
      timberPlot.progress = progressSteps[i];
      timberPlot.completed = progressSteps[i] >= 100;
      masonryPlot.progress = progressSteps[i];
      masonryPlot.completed = progressSteps[i] >= 100;

      world.creatures[0].activity = 'building';
      world.creatures[0].isActivelyWorking = true;
      world.creatures[0].activeConstructionStage = stages[i];
      world.creatures[1].activity = 'emigrating';

      world.elapsedSeconds += 0.2;
      settlementRenderer.update(0.05);
      creatureRenderer.update(0.2, null);
    }

    // Verify sculpted multi-part stage tools (no raw flat BoxGeometry tool blades)
    const toolNames = ['tool_axe', 'tool_spade', 'tool_trowel', 'tool_hammer'];
    for (const toolName of toolNames) {
      const toolGroup = creatureRenderer.rootGroup.getObjectByName(toolName);
      expect(toolGroup).toBeDefined();
      let parts = 0;
      let boxParts = 0;
      toolGroup!.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          parts++;
          if (obj.geometry instanceof THREE.BoxGeometry) {
            boxParts++;
          }
        }
      });
      expect(parts).toBeGreaterThanOrEqual(3);
      expect(boxParts).toBe(0);
    }

    // Advance one more frame so active work chips are at mid-flight peak scale and inspect them
    world.elapsedSeconds += 0.14;
    creatureRenderer.update(0.14, null);
    creatureRenderer.rootGroup.updateMatrixWorld(true);
    const workChips: THREE.Mesh[] = [];
    creatureRenderer.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name === 'work_chip') {
        workChips.push(obj);
      }
    });
    expect(workChips.length).toBeGreaterThan(0);
    const chipBox = new THREE.Box3();
    const chipSize = new THREE.Vector3();
    for (const chip of workChips) {
      expect(chip.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      chipBox.setFromObject(chip);
      chipBox.getSize(chipSize);
      expect(Math.max(chipSize.x, chipSize.y, chipSize.z)).toBeLessThan(0.22);
    }

    const childrenBeforeRemove = settlementRenderer.rootGroup.children.length;
    // Remove the disassembled building and verify SettlementRenderer cleanly removes its 3D group
    const rmIdx = settlement.buildings.findIndex((b) => b.id === timberPlot.id);
    if (rmIdx !== -1) settlement.buildings.splice(rmIdx, 1);
    settlementRenderer.update(0.05);
    expect(settlementRenderer.rootGroup.children.length).toBe(childrenBeforeRemove - 1);

    creatureRenderer.dispose();
    settlementRenderer.dispose();
    textures.dispose();
  });

  it('renders all six environmental village adaptations, adapted creature attire, and expanded terrain/flora cleanly', () => {
    const world = new WorldState(new EventBus(), { seed: 314159, initialSettlements: 1 });
    const adaptationBiomes: Record<(typeof ALL_VILLAGE_ADAPTATIONS)[number], BiomeType> = {
      forest_canopy: 'deep_woods',
      coastal_harbor: 'seashore',
      desert_oasis: 'desert',
      prairie_pastoral: 'prairie',
      mountain_stone: 'rocky_ridge',
      riverside_stilts: 'riverbank',
      waterway_haven: 'water',
    };

    // Ensure all 6 environmental adaptations are represented with buildings and inhabitants
    world.settlements.length = 0;
    world.creatures.length = 0;
    ALL_VILLAGE_ADAPTATIONS.forEach((adaptation, idx) => {
      const cx = -100 + idx * 40;
      const cz = 10 * ((idx % 2) * 2 - 1);
      const gy = world.terrain.getHeightAt(cx, cz);
      const settlement = new Settlement({
        id: `adapt_test_${adaptation}`,
        name: `Test ${adaptation}`,
        bannerColor: 0x8a6d4b + idx * 0x101010,
        center: { x: cx, z: cz },
        groundY: gy,
        biome: adaptationBiomes[adaptation],
        adaptation,
        foundingSpecies: ['fox', 'frog', 'rabbit'],
      });
      settlement.buildings.push(
        {
          id: `${settlement.id}_cottage`,
          settlementId: settlement.id,
          type: 'burrow_cottage',
          position: { x: cx + 6, z: cz },
          groundY: gy,
          rotation: 0.2,
          progress: 100,
          completed: true,
        },
        {
          id: `${settlement.id}_hall`,
          settlementId: settlement.id,
          type: 'timber_house',
          position: { x: cx - 6, z: cz + 2 },
          groundY: gy,
          rotation: 1.1,
          progress: 100,
          completed: true,
        },
      );
      world.settlements.push(settlement);

      const villager = new Creature({
        id: `villager_${adaptation}`,
        name: `Villager ${idx}`,
        species: idx % 2 === 0 ? 'fox' : 'frog',
        role: 'builder',
        settlementId: settlement.id,
        x: cx + 2,
        y: gy,
        z: cz + 2,
        personality: {
          friendliness: 0.6,
          ambition: 0.7,
          bravery: 0.5,
          piety: 0.5,
          curiosity: 0.6,
        },
        animPhase: idx * 0.5,
      });
      world.creatures.push(villager);
    });

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const terrainRenderer = new TerrainRenderer(scene, world, textures);
    const floraRenderer = new FloraRenderer(scene, world, textures);
    const settlementRenderer = new SettlementRenderer(scene, world, textures);
    const creatureRenderer = new CreatureRenderer(scene, world, textures);

    terrainRenderer.update(0.05);
    floraRenderer.update(0.05);
    settlementRenderer.update(0.05);
    creatureRenderer.update(0.05, null);

    // Verify live attire adaptation when an emigrant transfers to a village with a different adaptation
    world.creatures[0].settlementId = world.settlements[1].id;
    creatureRenderer.update(0.05, null);

    let totalMeshes = 0;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        totalMeshes++;
        const pos = obj.geometry.getAttribute('position');
        expect(pos).toBeDefined();
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < Math.min(pos.count, 16); i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true);
          expect(Number.isFinite(pos.getY(i))).toBe(true);
          expect(Number.isFinite(pos.getZ(i))).toBe(true);
        }
      }
    });

    expect(totalMeshes).toBeGreaterThan(150);

    creatureRenderer.dispose();
    settlementRenderer.dispose();
    floraRenderer.dispose();
    terrainRenderer.dispose();
    textures.dispose();
  }, 15_000);

  it('builds a tall supernatural deity beam extending well above the player view', () => {
    const outerGeo = new THREE.CylinderGeometry(3.8, 5.4, DIVINE_BEAM_HEIGHT, 28, 1, true);
    const innerGeo = new THREE.CylinderGeometry(1.5, 2.1, DIVINE_BEAM_HEIGHT, 24, 1, true);
    const ringGeo = new THREE.CircleGeometry(1.0, 72);
    ringGeo.rotateX(-Math.PI / 2);

    const beam = createDivineBeamVisual(
      {
        id: 1,
        type: 'sunlit_blessing',
        position: { x: 12, z: -8 },
        radius: 18,
        colorHex: 0xffe07d,
        createdAt: 0,
        duration: 6,
      },
      4.5,
      outerGeo,
      innerGeo,
      ringGeo,
    );

    expect(DIVINE_BEAM_HEIGHT).toBeGreaterThanOrEqual(800);
    // Outer aura + inner core + sacred mandala shockwave disc + volumetric aurora curtain
    // + twin celestial armillary halos + GPU stardust/ember motes + local divine PointLight
    expect(beam.group.children.length).toBe(8);

    const outerMesh = beam.group.children[0] as THREE.Mesh;
    const coreMesh = beam.group.children[1] as THREE.Mesh;
    expect(outerMesh.frustumCulled).toBe(false);
    expect(coreMesh.frustumCulled).toBe(false);
    expect(beam.ringMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(beam.ringMat.uniforms.uProgress).toBeDefined();
    expect(beam.wallMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(beam.haloMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(beam.motesPoints).toBeInstanceOf(THREE.Points);

    // Polychromatic cathedral stained-glass jewel uniforms & transparent atmospheric blending
    const glassMats = [beam.outerMat, beam.coreMat, beam.ringMat, beam.wallMat, beam.haloMat, beam.motesMat];
    for (const mat of glassMats) {
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.uniforms.uGlassB?.value).toBeInstanceOf(THREE.Color);
      expect(mat.uniforms.uGlassC?.value).toBeInstanceOf(THREE.Color);
      expect(mat.uniforms.uGlassD?.value).toBeInstanceOf(THREE.Color);
      // Post-fog overlay depth occlusion against untouched scene depth buffer
      expect(mat.uniforms.uSceneDepth).toBeDefined();
      expect(mat.uniforms.uResolution?.value).toBeInstanceOf(THREE.Vector2);
      expect(mat.uniforms.uHasSceneDepth?.value).toBe(0.0);
      expect(mat.fragmentShader).toContain('uSceneDepth');
      expect(mat.fragmentShader).toContain('gl_FragCoord.z > sceneDepth');
    }
    // Verify the 4 stained-glass jewel tones are genuinely distinct polychromatic hues
    const paletteHexes = new Set([
      beam.palette.primary.getHex(),
      beam.palette.jewelB.getHex(),
      beam.palette.jewelC.getHex(),
      beam.palette.jewelD.getHex(),
    ]);
    expect(paletteHexes.size).toBe(4);

    expect(beam.motesPoints.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(100);
    expect(beam.motesPoints.geometry.getAttribute('aKind')).toBeDefined();
    expect(beam.glowLight).toBeInstanceOf(THREE.PointLight);

    // Beam top reaches far above even maximum overview camera altitude
    outerGeo.computeBoundingBox();
    const topWorldY = beam.group.position.y + outerMesh.position.y + outerGeo.boundingBox!.max.y;
    expect(topWorldY).toBeGreaterThan(850);

    // Nearly vertical supernatural column rather than a narrow pointed cone
    expect(outerGeo.parameters.radiusTop / outerGeo.parameters.radiusBottom).toBeGreaterThan(0.65);
    expect(innerGeo.parameters.radiusTop / innerGeo.parameters.radiusBottom).toBeGreaterThan(0.65);

    beam.dispose();
    outerGeo.dispose();
    innerGeo.dispose();
    ringGeo.dispose();
  });

  it('scales newborn young smaller with youthful proportions and grows them smoothly to adult size', () => {
    const world = new WorldState(new EventBus(), { seed: 551122 });
    const village = world.settlements[0];
    const youngKit = world.spawnCreature(village, 'fox', 'forager', { ageDays: 0 });
    const adultFox = world.spawnCreature(village, 'fox', 'forager', { ageDays: 4 });

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const creatureRenderer = new CreatureRenderer(scene, world, textures);
    creatureRenderer.update(0.05, null);

    const findRigGroup = (id: string) =>
      creatureRenderer.rootGroup.children.find(
        (child) => child.userData.selectionTarget?.id === id,
      );
    const youngGroup = findRigGroup(youngKit.id);
    const adultGroup = findRigGroup(adultFox.id);
    expect(youngGroup).toBeDefined();
    expect(adultGroup).toBeDefined();

    const youngBody = youngGroup!.children[0];
    const adultBody = adultGroup!.children[0];
    expect(youngBody.scale.y).toBeLessThan(adultBody.scale.y * 0.6);

    // Age the kit into adulthood and verify its rendered mesh grows to full adult size
    youngKit.ageDays = 3.0;
    youngKit.lifeStage = 'adult';
    creatureRenderer.update(0.05, null);
    expect(youngBody.scale.y).toBeGreaterThan(adultBody.scale.y * 0.85);

    creatureRenderer.dispose();
    textures.dispose();
  });

  it('renders realistic multi-tiered water fountains (parabolic jets + droplet spray) and z-fighting-free cylindrical cottage steps', () => {
    const world = new WorldState(new EventBus(), { seed: 774411, initialSettlements: 1 });
    const settlement = world.settlements[0];
    settlement.buildings.length = 0;
    settlement.buildings.push(
      {
        id: 'test_realistic_fountain',
        settlementId: settlement.id,
        type: 'fountain_plaza',
        position: { x: settlement.center.x + 8, z: settlement.center.z },
        groundY: settlement.groundY,
        rotation: 0,
        progress: 100,
        completed: true,
      },
      {
        id: 'test_cylindrical_cottage',
        settlementId: settlement.id,
        type: 'burrow_cottage',
        position: { x: settlement.center.x - 8, z: settlement.center.z },
        groundY: settlement.groundY,
        rotation: 0,
        progress: 100,
        completed: true,
      },
    );

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const settlementRenderer = new SettlementRenderer(scene, world, textures);
    settlementRenderer.update(0.05);

    const fountainGroup = settlementRenderer.rootGroup.children.find(
      (c) => c.userData.selectionTarget?.id === 'test_realistic_fountain',
    );
    expect(fountainGroup).toBeDefined();

    let parabolicStreams = 0;
    let dropletSprayCount = 0;
    let solidWaterConeCount = 0;
    fountainGroup!.traverse((obj) => {
      if (obj instanceof THREE.Points) {
        dropletSprayCount += obj.geometry.getAttribute('position').count;
      } else if (obj instanceof THREE.Mesh) {
        if (obj.geometry instanceof THREE.TubeGeometry) {
          parabolicStreams++;
        } else if (obj.geometry instanceof THREE.ConeGeometry) {
          // Only tiny brass lantern caps are cones; water jets must never be solid blue cones
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat.transparent || (mat.color && mat.color.b > mat.color.r * 1.2)) {
            solidWaterConeCount++;
          }
        }
      }
    });
    expect(parabolicStreams).toBe(14);
    expect(dropletSprayCount).toBeGreaterThanOrEqual(80);
    expect(solidWaterConeCount).toBe(0);

    // Verify cylindrical house front doorstep sits strictly above the earthen leveling pad (no coplanar z-fighting)
    const cottageGroup = settlementRenderer.rootGroup.children.find(
      (c) => c.userData.selectionTarget?.id === 'test_cylindrical_cottage',
    );
    expect(cottageGroup).toBeDefined();
    cottageGroup!.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let padTopY = -Infinity;
    let doorstepTopY = -Infinity;
    cottageGroup!.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.visible) return;
      if (!(obj.geometry instanceof THREE.CylinderGeometry)) return;
      const params = obj.geometry.parameters;
      box.setFromObject(obj);
      const localTop = box.max.y - cottageGroup!.position.y;
      if (params.radiusTop > 1.7 && localTop < 0.2) {
        padTopY = Math.max(padTopY, localTop);
      } else if (obj.position.z > 1.5 && params.radiusTop < 1.0) {
        doorstepTopY = Math.max(doorstepTopY, localTop);
      }
    });
    expect(padTopY).toBeGreaterThan(-1);
    expect(doorstepTopY).toBeGreaterThan(-1);
    expect(doorstepTopY - padTopY).toBeGreaterThanOrEqual(0.08);

    settlementRenderer.dispose();
    textures.dispose();
  });

  it('toggles plaza festival bunting, floating sky lanterns, ceremonial crowns, and dancing confetti for festivals, regional events, and national holidays', () => {
    const world = new WorldState(new EventBus(), {
      seed: 919293,
      initialSettlements: 2,
      initialCreaturesPerSettlement: 8,
    });
    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const settlementRenderer = new SettlementRenderer(scene, world, textures);
    const creatureRenderer = new CreatureRenderer(scene, world, textures);

    settlementRenderer.update(0.05);
    const getDecorGroups = (): THREE.Object3D[] => {
      const found: THREE.Object3D[] = [];
      settlementRenderer.rootGroup.traverse((obj) => {
        if (obj.name === 'festival_decor') found.push(obj);
      });
      return found;
    };

    // Initially hidden when no celebration is active
    expect(getDecorGroups().length).toBe(2);
    expect(getDecorGroups().every((g) => !g.visible)).toBe(true);

    // Local festival decorates only the host settlement (without ceremonial crown)
    const local = world.festivals.startLocalFestival(world, world.settlements[0]);
    expect(local).not.toBeNull();
    settlementRenderer.update(0.1);
    const visibleAfterLocal = getDecorGroups().filter((g) => g.visible);
    expect(visibleAfterLocal.length).toBe(1);
    expect(visibleAfterLocal[0].getObjectByName('festival_crown')?.visible).toBe(false);

    // National holiday decorates EVERY settlement with bunting, sky lanterns, and ceremonial crown
    const national = world.festivals.startNationalHoliday(world);
    expect(national).not.toBeNull();
    settlementRenderer.update(0.1);
    const visibleAfterNational = getDecorGroups().filter((g) => g.visible);
    expect(visibleAfterNational.length).toBe(2);
    for (const g of visibleAfterNational) {
      expect(g.getObjectByName('festival_crown')?.visible).toBe(true);
    }

    // Dancing celebrants animate cleanly and emit tiny festive confetti
    world.creatures[0].isDancingAtCelebration = true;
    world.elapsedSeconds += 0.9;
    creatureRenderer.update(0.9, null);
    const confetti = creatureRenderer.rootGroup.getObjectByName('festival_confetti');
    expect(confetti).toBeDefined();

    creatureRenderer.dispose();
    settlementRenderer.dispose();
    textures.dispose();
  });

  it('uses photographic PBR fur sheen, wet clearcoat eyes, and contact AO + valley mist post-processing', () => {
    const world = new WorldState(new EventBus(), {
      seed: 314159,
      initialSettlements: 1,
      initialCreaturesPerSettlement: 6,
    });
    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const creatureRenderer = new CreatureRenderer(scene, world, textures);
    creatureRenderer.update(0.016, null);

    let physicalFurCount = 0;
    let wetEyeCount = 0;
    let whiteCatchlightStickerCount = 0;
    creatureRenderer.rootGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material;
      if (mat instanceof THREE.MeshPhysicalMaterial) {
        if (mat.sheen > 0.5) physicalFurCount++;
        if (mat.clearcoat >= 0.95 && mat.roughness < 0.06) wetEyeCount++;
      } else if (mat instanceof THREE.MeshBasicMaterial && mat.color.getHex() === 0xffffff) {
        whiteCatchlightStickerCount++;
      }
    });

    expect(physicalFurCount).toBeGreaterThan(0);
    expect(wetEyeCount).toBeGreaterThanOrEqual(world.creatures.length * 2);
    expect(whiteCatchlightStickerCount).toBe(0);

    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.2, 4200);
    const pass = new DistanceFocusBlurPass(camera, 16);
    pass.updateParams({
      focusDistance: 45,
      focusRange: 50,
      maxBlur: 0.0018,
      horizonFadeStart: 760,
      horizonFadeEnd: 2100,
      worldHorizonStart: 1800,
      worldHorizonEnd: 2520,
      horizonColor: new THREE.Color(0xc4d3cc),
      isPov: false,
      sunDirection: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
      sunColor: new THREE.Color(0xfff1d8),
      daylight: 0.95,
      waterLevel: -0.65,
      fogDensity: 0.0005,
      aoStrength: 0.88,
      mistStrength: 0.42,
    });
    expect(pass.material.uniforms.uAoStrength.value).toBeCloseTo(0.88, 5);
    expect(pass.material.uniforms.uMistStrength.value).toBeCloseTo(0.42, 5);
    expect(pass.material.uniforms.uWaterLevel.value).toBeCloseTo(-0.65, 5);
    expect(pass.material.uniforms.uWorldHorizonStart.value).toBeCloseTo(1800, 5);
    expect(pass.material.uniforms.uWorldHorizonEnd.value).toBeCloseTo(2520, 5);
    expect(pass.material.uniforms.uInvProjectionMatrix.value).toBeInstanceOf(THREE.Matrix4);
    expect(pass.material.uniforms.uCameraWorldMatrix.value).toBeInstanceOf(THREE.Matrix4);
    expect(pass.material.fragmentShader).toContain('isSkyPixel');
    expect(pass.material.fragmentShader).toContain('radialDist');
    expect(pass.material.fragmentShader).toContain('smoothstep(uHorizonFadeStart, uHorizonFadeEnd, centerDist)');
    expect(pass.material.fragmentShader).toContain('worldEdgeMist');
    expect(pass.material.fragmentShader).toContain('horizonTint');
    expect(pass.material.fragmentShader).not.toContain('0.99985');

    pass.dispose();
    creatureRenderer.dispose();
    textures.dispose();
  });

  it('builds distinct conifer pine archetypes and non-tiling simplex water ripples', () => {
    expect(PINE_VARIANT_COUNT).toBe(5);
    expect(HORIZON_PINE_VARIANT_COUNT).toBe(3);

    const canopyBoxes: THREE.Box3[] = [];
    for (let v = 0; v < PINE_VARIANT_COUNT; v++) {
      const trunk = createPineTrunkGeo(v);
      const canopy = createPineCanopyGeo(v);
      assertValidGeometry(trunk);
      assertValidGeometry(canopy, true);
      canopy.computeBoundingBox();
      expect(canopy.boundingBox).not.toBeNull();
      canopyBoxes.push(canopy.boundingBox!.clone());
      trunk.dispose();
      canopy.dispose();
    }

    // Mature Scots pine (variant 1) has a tall bare lower trunk compared to low-skirted alpine fir (variant 2)
    expect(canopyBoxes[1].min.y).toBeGreaterThan(canopyBoxes[2].min.y + 2.0);
    // Broad old-growth Douglas fir (variant 3) is wider than slender alpine fir (variant 2)
    const firWidth = canopyBoxes[2].max.x - canopyBoxes[2].min.x;
    const douglasWidth = canopyBoxes[3].max.x - canopyBoxes[3].min.x;
    expect(douglasWidth).toBeGreaterThan(firWidth * 1.35);

    for (let v = 0; v < HORIZON_PINE_VARIANT_COUNT; v++) {
      const horizonPine = createHorizonPineGeo(v);
      assertValidGeometry(horizonPine, true);
      horizonPine.dispose();
    }

    const world = new WorldState(new EventBus(), {
      seed: 424242,
      initialSettlements: 0,
      initialCreaturesPerSettlement: 0,
    });
    const water = createRealisticWaterSurface(world.terrain, world.terrain.size, 24, 1.0);
    const mat = water.mesh.material as THREE.ShaderMaterial;
    const frag = mat.fragmentShader;
    expect(frag).toContain('float snoise(vec2 v)');
    expect(frag).toContain('vec3 snoiseD(vec2 v)');
    expect(frag).toContain('flowBlend');
    expect(frag).not.toContain('vFlow * uTime');
    expect(frag).not.toContain('flow * t');
    expect(frag).toContain('windPatch');
    expect(frag).not.toContain('const mat2');
    expect(frag).not.toMatch(/,\s*\)/);
    water.dispose();
  });

  it('generates every pine tree procedurally with unique trunks, boughs, forks, and clearable instances', () => {
    for (let f = 0; f < PINE_FROND_TYPE_COUNT; f++) {
      const frond = createPineFrondGeo(f as 0 | 1 | 2);
      assertValidGeometry(frond, true);
      frond.dispose();
    }

    const sampleSpots = Array.from({ length: 48 }, (_, i) => ({
      x: (i % 8) * 18 - 64 + Math.sin(i * 1.7) * 4,
      z: Math.floor(i / 8) * 18 - 54 + Math.cos(i * 2.3) * 4,
      y: i % 3 === 0 ? 12.2 : 3.4,
      scale: 0.9 + (i % 5) * 0.12,
      rotation: (i * 1.618) % (Math.PI * 2),
      kind: 'pine' as const,
    }));

    const signatures = new Set<string>();
    const habits = new Set<string>();
    let forkedCount = 0;
    for (let i = 0; i < sampleSpots.length; i++) {
      const biome: BiomeType = i % 3 === 0 ? 'rocky_ridge' : i % 2 === 0 ? 'deep_woods' : 'meadow';
      const spec = generateProceduralPineSpec(sampleSpots[i], i, biome, 90);
      signatures.add(
        `${spec.height.toFixed(3)}:${spec.crownStart.toFixed(3)}:${spec.leanX.toFixed(3)}:${spec.baseBoughLen.toFixed(3)}`,
      );
      habits.add(spec.habit);
      if (spec.hasFork) forkedCount++;
    }
    expect(signatures.size).toBe(sampleSpots.length);
    expect(habits.size).toBeGreaterThanOrEqual(4);
    expect(forkedCount).toBeGreaterThan(0);

    const barkMat = new THREE.MeshStandardMaterial();
    const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const depthMat = new THREE.MeshDepthMaterial();
    const forest = buildProceduralPineForest(
      sampleSpots,
      (x) => (x > 0 ? 'deep_woods' : 'rocky_ridge'),
      () => 85,
      barkMat,
      foliageMat,
      depthMat,
    );
    assertValidGeometry(forest.trunksMesh.geometry, false);
    expect(forest.frondMeshes).toHaveLength(PINE_FROND_TYPE_COUNT);
    expect(forest.totalBoughInstances).toBeGreaterThan(sampleSpots.length * 18);
    for (const fm of forest.frondMeshes) {
      expect(fm.geometry.getAttribute('aWindData')).toBeDefined();
    }
    forest.clearTree(0);
    forest.flushCleared();
    const posArr = forest.trunksMesh.geometry.attributes.position.array as Float32Array;
    expect(posArr[1]).toBe(-999);

    const horizon = buildProceduralHorizonPines(
      sampleSpots.slice(0, 16).map((s, i) => ({ x: s.x, y: s.y, z: s.z, scale: s.scale, biome: 'deep_woods', seed: 100 + i })),
      foliageMat,
      barkMat,
    );
    expect(horizon.foliageMeshes).toHaveLength(2);
    expect(horizon.trunkMesh.count).toBe(16);
    for (const d of [...forest.disposables, ...horizon.disposables, barkMat, foliageMat, depthMat]) {
      d.dispose();
    }
  });

  it('tracks monotonic loading progress, whimsical hints, and dismissal on SplashScreen', async () => {
    expect(WHIMSICAL_HINTS.length).toBeGreaterThanOrEqual(4);
    await expect(nextPaintFrame()).resolves.toBeUndefined();

    const attrs = new Map<string, string>();
    const classes = new Set<string>();
    const makeNode = () => ({
      style: { width: '' },
      textContent: '',
      setAttribute: (k: string, v: string) => attrs.set(k, v),
    });
    const fillNode = makeNode();
    const trackNode = makeNode();
    const pctNode = makeNode();
    const stageNode = makeNode();
    const hintNode = makeNode();
    const subtitleNode = makeNode();

    const fakeRoot = {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      querySelector: (sel: string) => {
        if (sel === '[data-splash-fill]') return fillNode;
        if (sel === '[data-splash-track]') return trackNode;
        if (sel === '[data-splash-pct]') return pctNode;
        if (sel === '[data-splash-stage]') return stageNode;
        if (sel === '[data-splash-hint]') return hintNode;
        if (sel === '[data-splash-subtitle]') return subtitleNode;
        return null;
      },
    } as unknown as HTMLElement;

    const splash = new SplashScreen(fakeRoot);
    expect(hintNode.textContent.length).toBeGreaterThan(20);

    splash.setProgress(32, 'Mixing moss, granite, bark & timber pigments…');
    expect(splash.getPercent()).toBe(32);
    expect(fillNode.style.width).toBe('32%');
    expect(pctNode.textContent).toBe('32%');
    expect(attrs.get('aria-valuenow')).toBe('32');
    expect(stageNode.textContent).toContain('pigments');

    // Progress should never regress mid-load
    splash.setProgress(15, 'Should clamp monotonically');
    expect(splash.getPercent()).toBe(32);

    splash.setProgress(100, 'The realm awaits.');
    expect(splash.getPercent()).toBe(100);
    await splash.dismiss(0);
    expect(classes.has('splash-hidden')).toBe(true);
    expect(attrs.get('aria-hidden')).toBe('true');

    // Re-showing resets progress cleanly for New World / quality transitions
    splash.show('Dreaming up a brand-new valley…');
    expect(classes.has('splash-hidden')).toBe(false);
    expect(subtitleNode.textContent).toBe('Dreaming up a brand-new valley…');
    expect(splash.getPercent()).toBe(2);
  });

  it('shares cached primitive BufferGeometries across many creature rigs without losing mesh fidelity', () => {
    const world = new WorldState(new EventBus(), { seed: 314159, initialSettlements: 1 });
    const home = world.settlements[0];
    const roles = ['builder', 'forager', 'guard', 'merchant', 'mystic', 'artisan'] as const;

    // Populate 63 creatures (3 per species across all 21 species and all 6 roles)
    for (let i = 0; i < ALL_SPECIES_IDS.length * 3; i++) {
      world.spawnCreature(home, ALL_SPECIES_IDS[i % ALL_SPECIES_IDS.length], roles[i % roles.length]);
    }

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const creatureRenderer = new CreatureRenderer(scene, world, textures);
    creatureRenderer.update(0.05, null);

    let meshCount = 0;
    const uniqueGeos = new Set<THREE.BufferGeometry>();
    creatureRenderer.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        uniqueGeos.add(obj.geometry);
      }
    });

    // 70+ creatures generate thousands of articulated part meshes while sharing ~150 cached BufferGeometries
    expect(meshCount).toBeGreaterThan(3000);
    expect(uniqueGeos.size).toBeLessThan(200);

    creatureRenderer.dispose();
    textures.dispose();
  });

  it('keeps scene PointLight count strictly constant as settlements multiply (zero runtime shader recompiles)', () => {
    const world = new WorldState(new EventBus(), {
      seed: 654321,
      initialSettlements: 1,
      initialCreaturesPerSettlement: 4,
    });
    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const settlementRenderer = new SettlementRenderer(scene, world, textures);

    const countPointLights = (): number => {
      let count = 0;
      scene.traverse((obj) => {
        if (obj instanceof THREE.PointLight) count++;
      });
      return count;
    };

    const initialLights = countPointLights();
    expect(initialLights).toBe(6);

    // Add 9 more settlements dynamically (10 total) — scene PointLight count MUST remain constant!
    for (let i = 0; i < 9; i++) {
      const s = new Settlement({
        id: `extra_settlement_${i}`,
        name: `Outpost ${i}`,
        bannerColor: 0xcc6633,
        center: { x: 40 + i * 24, z: -30 + (i % 3) * 28 },
        groundY: 4,
        biome: 'meadow',
        adaptation: ALL_VILLAGE_ADAPTATIONS[i % ALL_VILLAGE_ADAPTATIONS.length],
        foundingSpecies: ['fox', 'owl'],
      });
      world.settlements.push(s);
    }
    world.structureRevision++;
    settlementRenderer.update(0.05, undefined, new THREE.Vector3(40, 4, -30));

    expect(countPointLights()).toBe(initialLights);
    expect(settlementRenderer.getWarmupMaterials().length).toBeGreaterThan(20);

    settlementRenderer.dispose();
    textures.dispose();
  });

  it('removes and disposes 3D rigs of deceased creatures while preserving lineage records', () => {
    const world = new WorldState(new EventBus(), { seed: 246810, initialSettlements: 1 });
    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const creatureRenderer = new CreatureRenderer(scene, world, textures);
    creatureRenderer.update(0.05, null);

    const initialRigCount = creatureRenderer.rootGroup.children.length;
    expect(initialRigCount).toBeGreaterThan(0);
    expect(creatureRenderer.getWarmupMaterials().length).toBeGreaterThan(20);

    const elder = world.creatures[0];
    elder.alive = false;
    creatureRenderer.update(0.05, null);

    expect(creatureRenderer.rootGroup.children.length).toBe(initialRigCount - 1);
    expect(world.creatures).toContain(elder);

    creatureRenderer.dispose();
    textures.dispose();
  });

  it('anchors CameraController focus target ahead of the creature during Eye View instead of stale world target', () => {
    const hadWindow = 'window' in globalThis;
    const prevWindow = (globalThis as { window?: unknown }).window;
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    if (!hadWindow) {
      (globalThis as { window?: unknown }).window = fakeWindow;
    }
    const fakeDom = {
      style: { touchAction: '' },
      clientWidth: 1280,
      clientHeight: 720,
      ownerDocument: {
        addEventListener: () => {},
        removeEventListener: () => {},
        pointerLockElement: null,
      },
      getRootNode: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    } as unknown as HTMLElement;

    try {
      const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.22, 1000);
      const controller = new CameraController(camera, fakeDom);
      controller.controls.target.set(-220, 4, 180);

      const worldFocus = controller.getFocusTarget();
      expect(worldFocus.x).toBeCloseTo(-220, 3);
      expect(worldFocus.z).toBeCloseTo(180, 3);

      controller.enterCreaturePov(() => ({
        x: 85,
        y: 6,
        z: -40,
        heading: Math.PI / 2, // facing +X
        eyeHeight: 0.72,
        bobOffset: 0,
        alive: true,
      }));
      controller.update(0.016);

      const povFocus = controller.getFocusTarget();
      // Focus target should sit ~16m ahead of the creature (+X), far from the stale world target (-220, 180)
      expect(povFocus.x).toBeGreaterThan(98);
      expect(povFocus.x).toBeLessThan(104);
      expect(povFocus.z).toBeCloseTo(-40, 1);
      expect(camera.position.distanceTo(povFocus)).toBeCloseTo(16, 1);

      controller.exitCreaturePov(false);
      expect(controller.isInCreaturePov()).toBe(false);
      controller.dispose();
    } finally {
      if (!hadWindow) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prevWindow;
      }
    }
  });

  it('keeps dry terrain matte with attenuated grazing Fresnel glare and non-black grass roots', () => {
    const world = new WorldState(new EventBus(), { seed: 314159 });
    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const terrain = new TerrainRenderer(scene, world, textures);
    const mat = terrain.terrainMesh.material as THREE.MeshStandardMaterial;
    expect(mat.roughness).toBeGreaterThanOrEqual(0.95);
    expect(mat.metalness).toBe(0);

    const fakeShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader:
        '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <lights_physical_fragment>\n#include <opaque_fragment>',
    };
    mat.onBeforeCompile(fakeShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(fakeShader.fragmentShader).toContain('material.specularF90');
    expect(fakeShader.fragmentShader).toContain('terrainSpecScale');

    // Grass blade vertex colors should supply gentle root-to-tip shading without crushing bases to black
    const grass = createCurvedGrassTuftGeo();
    const col = grass.attributes.color as THREE.BufferAttribute;
    let minGreen = Infinity;
    for (let i = 0; i < col.count; i++) {
      minGreen = Math.min(minGreen, col.getY(i));
    }
    expect(minGreen).toBeGreaterThan(0.25);
    grass.dispose();
    terrain.dispose();
    textures.dispose();
  });

  it('renders aquatic waterway villages, all six watery buildings, and swimming beavers, otters & river koi cleanly', () => {
    const world = new WorldState(new EventBus(), {
      seed: 202609,
      initialSettlements: 0,
      initialWaterwaySettlements: 1,
      initialCreaturesPerSettlement: 6,
    });
    const ws = world.settlements.find((s) => s.adaptation === 'waterway_haven')!;
    expect(ws).toBeDefined();

    // Place all 6 bespoke watery buildings in the waterway village
    const wateryTypes = [
      'beaver_lodge',
      'otter_boathouse',
      'waterwheel_mill',
      'lily_market',
      'aquatic_sanctuary',
      'tide_shrine',
    ] as const;
    ws.buildings.length = 0;
    wateryTypes.forEach((type, idx) => {
      const ang = (idx / wateryTypes.length) * Math.PI * 2;
      ws.buildings.push({
        id: `water_bld_${idx}`,
        settlementId: ws.id,
        type,
        position: { x: ws.center.x + Math.cos(ang) * 7, z: ws.center.z + Math.sin(ang) * 7 },
        groundY: world.terrain.waterLevel,
        rotation: ang,
        progress: 100,
        completed: true,
      });
    });

    const scene = new THREE.Scene();
    const textures = createStubTextureLibrary();
    const settlementRenderer = new SettlementRenderer(scene, world, textures);
    const creatureRenderer = new CreatureRenderer(scene, world, textures);

    // Advance several frames to verify waterwheel spin, floating bob, and swim animation
    for (let i = 0; i < 6; i++) {
      world.elapsedSeconds += 0.1;
      settlementRenderer.update(0.1);
      creatureRenderer.update(0.1, null);
    }

    let finiteMeshes = 0;
    let pointLights = 0;
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight) pointLights++;
      if (obj instanceof THREE.Mesh) {
        const pos = obj.geometry.attributes.position;
        if (pos && pos.count > 0) {
          expect(Number.isFinite(pos.getX(0))).toBe(true);
          expect(Number.isFinite(pos.getY(0))).toBe(true);
          expect(Number.isFinite(pos.getZ(0))).toBe(true);
          finiteMeshes++;
        }
      }
    });

    expect(finiteMeshes).toBeGreaterThan(80);
    expect(pointLights).toBe(6);

    // Verify waterwheel_mill has an unobstructed undershot river-current wheel with no floating sluice
    const millBuilding = ws.buildings.find((b) => b.type === 'waterwheel_mill')!;
    const millGroup = settlementRenderer.rootGroup.children.find(
      (c) => c.userData.selectionTarget?.id === millBuilding.id,
    );
    expect(millGroup).toBeDefined();
    const rotor = millGroup!.getObjectByName('waterwheel_rotor');
    expect(rotor).toBeDefined();
    expect(rotor!.rotation.x).toBeGreaterThan(0.2);
    millGroup!.updateMatrixWorld(true);
    const rotorBox = new THREE.Box3().setFromObject(rotor!);
    // Bottom paddles dip cleanly below the water surface to catch the stream current
    expect(rotorBox.min.y).toBeLessThan(world.terrain.waterLevel - 0.15);
    // No floating transparent sluice water chute above/through the wheel
    let transparentMillMeshes = 0;
    millGroup!.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible && (obj.material as THREE.Material).transparent) {
        transparentMillMeshes++;
      }
    });
    expect(transparentMillMeshes).toBe(0);

    // Verify rendered koi fish sit submerged inside the water (center below waterLevel, not floating on top)
    scene.updateMatrixWorld(true);
    const fishIds = new Set(world.creatures.filter((c) => c.species === 'fish').map((c) => c.id));
    expect(fishIds.size).toBeGreaterThan(0);
    let checkedFish = 0;
    for (const child of creatureRenderer.rootGroup.children) {
      const target = child.userData.selectionTarget as { kind: string; id: string } | undefined;
      if (target?.kind === 'creature' && fishIds.has(target.id)) {
        const box = new THREE.Box3();
        child.traverse((node) => {
          if (node instanceof THREE.Mesh && node.visible && node.parent?.visible !== false && node.geometry !== (creatureRenderer as unknown as { geo: { swimRipple: THREE.BufferGeometry } }).geo.swimRipple) {
            // Skip meshes inside hidden ancestor groups (e.g. inactive tools / selection halo)
            let p: THREE.Object3D | null = node;
            let allVisible = true;
            while (p) {
              if (!p.visible) { allVisible = false; break; }
              p = p.parent;
            }
            if (allVisible) box.expandByObject(node);
          }
        });
        const centerY = (box.min.y + box.max.y) * 0.5;
        expect(centerY).toBeLessThan(world.terrain.waterLevel - 0.1);
        expect(box.min.y).toBeLessThan(world.terrain.waterLevel - 0.25);
        checkedFish++;
      }
    }
    expect(checkedFish).toBe(fishIds.size);

    // Water surface supports DoubleSide underwater underside viewing (Snell's window) for Koi Eye View
    const waterSurf = createRealisticWaterSurface(world.terrain, world.config.worldSize);
    const waterMat = waterSurf.mesh.material as THREE.ShaderMaterial;
    expect(waterMat.side).toBe(THREE.DoubleSide);
    expect(waterMat.fragmentShader).toContain("!gl_FrontFacing");
    waterSurf.dispose();

    creatureRenderer.dispose();
    settlementRenderer.dispose();
    textures.dispose();
  });

  it('renders decorative butterflies, bees, dragonflies, ladybugs, and dusk/night fireflies with seasonal transitions', () => {
    const world = new WorldState(new EventBus(), {
      seed: 888444,
      initialSettlements: 1,
      initialWaterwaySettlements: 1,
      initialCreaturesPerSettlement: 4,
    });
    const scene = new THREE.Scene();
    const critters = new AmbientCritterRenderer(scene, world, 1.0);

    expect(critters.counts.butterflies).toBeGreaterThan(20);
    expect(critters.counts.bees).toBeGreaterThan(20);
    expect(critters.counts.dragonflies).toBeGreaterThan(20);
    expect(critters.counts.ladybugs).toBeGreaterThan(20);
    expect(critters.counts.fireflies).toBeGreaterThan(20);
    expect(critters.getWarmupMaterials().length).toBe(5);

    const makeSky = (daylight: number, isWinter = false) => ({
      daylight,
      nightFactor: 1 - daylight,
      sunElevation: daylight,
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.4).normalize(),
      sunColor: new THREE.Color(0xfff4d6),
      skyTopColor: new THREE.Color(0x4a8be0),
      skyHorizonColor: new THREE.Color(0xbce0ff),
      fogColor: new THREE.Color(0xcce4f5),
      fogDensity: 0.0005,
      windStrength: 0.2,
      isWinter,
    });

    // Bright summer day: butterflies/bees/dragonflies/ladybugs visible, fireflies hidden
    world.season = 'summer';
    critters.update(0.1, makeSky(0.95));
    expect(critters.rootGroup.getObjectByName('ambient_butterflies')?.visible).toBe(true);
    expect(critters.rootGroup.getObjectByName('ambient_bees')?.visible).toBe(true);
    expect(critters.rootGroup.getObjectByName('ambient_dragonflies')?.visible).toBe(true);
    expect(critters.rootGroup.getObjectByName('ambient_ladybugs')?.visible).toBe(true);
    expect(critters.rootGroup.getObjectByName('ambient_fireflies')?.visible).toBe(false);

    // Summer night: fireflies glow while daylight insects rest
    critters.update(0.1, makeSky(0.05));
    expect(critters.rootGroup.getObjectByName('ambient_butterflies')?.visible).toBe(false);
    expect(critters.rootGroup.getObjectByName('ambient_fireflies')?.visible).toBe(true);

    // Winter dormancy: insects tucked away cleanly
    world.season = 'winter';
    critters.update(0.1, makeSky(0.95, true));
    expect(critters.rootGroup.getObjectByName('ambient_butterflies')?.visible).toBe(false);
    expect(critters.rootGroup.getObjectByName('ambient_fireflies')?.visible).toBe(false);

    // Butterflies must fly nose-first (+Z): wider forewing span sits in +Z, narrower hindwing span in -Z
    const butterflyMesh = critters.rootGroup.getObjectByName('ambient_butterflies') as THREE.InstancedMesh;
    const bPos = butterflyMesh.geometry.attributes.position;
    let maxFrontSpan = 0;
    let maxRearSpan = 0;
    for (let i = 0; i < bPos.count; i++) {
      const x = Math.abs(bPos.getX(i));
      const z = bPos.getZ(i);
      if (z > 0.04) maxFrontSpan = Math.max(maxFrontSpan, x);
      if (z < -0.04) maxRearSpan = Math.max(maxRearSpan, x);
    }
    expect(maxFrontSpan).toBeGreaterThan(maxRearSpan + 0.04);

    // Every instanced geometry has finite vertices
    critters.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        const pos = obj.geometry.attributes.position;
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true);
          expect(Number.isFinite(pos.getY(i))).toBe(true);
          expect(Number.isFinite(pos.getZ(i))).toBe(true);
        }
      }
    });

    critters.dispose();
    expect(scene.children.includes(critters.rootGroup)).toBe(false);
  });

  it('supports reversible pine clearing/restoration for habitat scars and dynamic flood surge water elevation', () => {
    const world = new WorldState(new EventBus(), {
      seed: 778899,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 4,
    });

    // 1. Procedural pine forest supports reversible clearTree -> restoreTree when habitat scars heal
    const pines = world.terrain.trees.filter((t) => t.kind === 'pine').slice(0, 8);
    expect(pines.length).toBeGreaterThanOrEqual(3);
    const barkMat = new THREE.MeshStandardMaterial();
    const foliageMat = new THREE.MeshStandardMaterial();
    const depthMat = new THREE.MeshDepthMaterial();
    const forest = buildProceduralPineForest(
      pines,
      (x, z, y) => world.terrain.getBiomeAtKnownHeight(x, z, y ?? world.terrain.getHeightAt(x, z)),
      (x, z) => world.terrain.getCoastSignedDistance(x, z),
      barkMat,
      foliageMat,
      depthMat,
    );

    const trunkPos = forest.trunksMesh.geometry.attributes.position as THREE.BufferAttribute;
    const originalTrunkY0 = trunkPos.getY(0);
    expect(originalTrunkY0).toBeGreaterThan(-50);

    forest.clearTree(0);
    forest.flushCleared();
    expect(trunkPos.getY(0)).toBe(-999);

    forest.restoreTree(0);
    forest.flushCleared();
    expect(trunkPos.getY(0)).toBeCloseTo(originalTrunkY0, 5);

    for (const d of forest.disposables) d.dispose();
    barkMat.dispose();
    foliageMat.dispose();
    depthMat.dispose();

    // 2. Realistic water shader exposes dynamic uFloodOffset synchronized with sky.floodSurge
    const water = createRealisticWaterSurface(world.terrain, world.config.worldSize, 64, 1.0);
    const mat = water.mesh.material as THREE.ShaderMaterial;
    expect(mat.vertexShader).toContain('uFloodOffset');
    expect(mat.uniforms.uFloodOffset.value).toBe(0);
    water.update(0.1, {
      sunDirection: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
      sunColor: new THREE.Color(0xfff1cf),
      skyTopColor: new THREE.Color(0x2a619e),
      skyHorizonColor: new THREE.Color(0xc8dece),
      fogColor: new THREE.Color(0xc8dece),
      fogDensity: 0.0006,
      daylight: 0.9,
      windStrength: 0.5,
      isWinter: false,
      floodSurge: 0.95,
    });
    expect(mat.uniforms.uFloodOffset.value).toBeCloseTo(0.95, 5);
    water.dispose();
  });

  it('filters noisy Eye View heading/bob inputs smoothly and settles stationary creature rigs to ground level', () => {
    // 1. CameraController Eye View critically damped spring rejects high-frequency heading & bob flicker
    const hadWindow = 'window' in globalThis;
    const prevWindow = (globalThis as { window?: unknown }).window;
    const fakeWindow = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    if (!hadWindow) {
      (globalThis as { window?: unknown }).window = fakeWindow;
    }
    const fakeDom = {
      style: { touchAction: '' },
      clientWidth: 1280,
      clientHeight: 720,
      ownerDocument: {
        addEventListener: () => {},
        removeEventListener: () => {},
        pointerLockElement: null,
      },
      getRootNode: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    } as unknown as HTMLElement;

    try {
      const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.22, 1000);
      const controller = new CameraController(camera, fakeDom);
      let frame = 0;
      let mode: 'jitter' | 'turn' = 'jitter';
      controller.enterCreaturePov(() => ({
        x: 20,
        y: 3,
        z: 10,
        heading: mode === 'jitter' ? (frame === 0 ? 0 : frame % 2 === 0 ? 0.45 : -0.45) : Math.PI * 0.5,
        eyeHeight: 0.72,
        bobOffset: mode === 'jitter' ? (frame % 2 === 0 ? 0.14 : -0.14) : 0,
        alive: true,
      }));

      controller.update(1 / 60);
      const prevDir = new THREE.Vector3();
      camera.getWorldDirection(prevDir);
      let prevYaw = Math.atan2(prevDir.x, prevDir.z);
      let prevY = camera.position.y;
      let maxYawStep = 0;
      let maxYStep = 0;

      for (frame = 1; frame <= 60; frame++) {
        controller.update(1 / 60);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const yaw = Math.atan2(dir.x, dir.z);
        let dYaw = yaw - prevYaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        maxYawStep = Math.max(maxYawStep, Math.abs(dYaw));
        maxYStep = Math.max(maxYStep, Math.abs(camera.position.y - prevY));
        prevYaw = yaw;
        prevY = camera.position.y;
      }

      // High-frequency +-0.45 rad heading & +-0.14m vertical chatter is heavily attenuated
      expect(maxYawStep).toBeLessThan(0.05);
      expect(maxYStep).toBeLessThan(0.03);

      // Sustained 90-degree turn converges smoothly without overshoot
      mode = 'turn';
      let maxTurnYaw = 0;
      for (let i = 0; i < 120; i++) {
        controller.update(1 / 60);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const yaw = Math.atan2(dir.x, dir.z);
        maxTurnYaw = Math.max(maxTurnYaw, yaw);
      }
      const finalDir = new THREE.Vector3();
      camera.getWorldDirection(finalDir);
      expect(Math.atan2(finalDir.x, finalDir.z)).toBeCloseTo(Math.PI * 0.5, 1);
      expect(maxTurnYaw).toBeLessThan(Math.PI * 0.5 + 0.04);
      controller.dispose();
    } finally {
      if (!hadWindow) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prevWindow;
      }
    }

    // 2. Stationary hopping creature settles smoothly to ground level instead of freezing mid-air
    const world = new WorldState(new EventBus(), {
      seed: 90125,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 0,
    });
    const home = world.settlements[0];
    const rabbit = world.spawnCreature(home, 'rabbit', 'forager');
    rabbit.animPhase = Math.PI * 0.5; // Peak of hop wave
    rabbit.moveIntensity = 0;
    rabbit.activity = 'idle';

    const scene = new THREE.Scene();
    const renderer = new CreatureRenderer(scene, world);
    for (let i = 0; i < 45; i++) {
      renderer.update(1 / 60, null);
    }
    const rigRoot = renderer.rootGroup.children.find(
      (obj) => obj.userData?.selectionTarget?.id === rabbit.id,
    );
    expect(rigRoot).toBeDefined();
    const bodyGroup = rigRoot!.children[0];
    expect(Math.abs(bodyGroup.position.y)).toBeLessThan(0.02);
    renderer.dispose();
  });

  it('equips non-snake creatures with sculpted grounded feet and animates distinct stroll/walk/run strides', () => {
    const world = new WorldState(new EventBus(), {
      seed: 551122,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 0,
    });
    const home = world.settlements[0];
    const fox = world.spawnCreature(home, 'fox', 'forager');
    const rabbit = world.spawnCreature(home, 'rabbit', 'forager');
    const frog = world.spawnCreature(home, 'frog', 'forager');
    const crow = world.spawnCreature(home, 'crow', 'forager');
    const snake = world.spawnCreature(home, 'snake', 'forager');

    const scene = new THREE.Scene();
    const renderer = new CreatureRenderer(scene, world);

    const findRigFeet = (id: string) => {
      const root = renderer.rootGroup.children.find(
        (obj) => obj.userData?.selectionTarget?.id === id,
      )!;
      const bodyGroup = root.children[0];
      // Foot pivots are named 'left_foot' and 'right_foot' children of bodyGroup
      const feet = bodyGroup.children.filter(
        (ch) => ch instanceof THREE.Group && (ch.name === 'left_foot' || ch.name === 'right_foot'),
      );
      return { root, bodyGroup, feet };
    };

    // All legged creatures (mammal, rabbit, webbed amphibian, bird) have two sculpted forward-projecting feet reaching ground
    for (const c of [fox, rabbit, frog, crow]) {
      const { feet } = findRigFeet(c.id);
      expect(feet.length).toBe(2);
      for (const fPivot of feet) {
        const footMesh = fPivot.children[0] as THREE.Mesh;
        expect(footMesh).toBeInstanceOf(THREE.Mesh);
        footMesh.geometry.computeBoundingBox();
        const box = footMesh.geometry.boundingBox!;
        // Leg descends from hip down to ground (~-0.27) and foot projects distinctly forward along +Z
        expect(box.min.y).toBeLessThan(-0.24);
        expect(box.max.z).toBeGreaterThan(0.14);
      }
    }

    // Snakes must NOT have feet
    const snakeRig = findRigFeet(snake.id);
    expect(snakeRig.feet.length).toBe(0);

    // Compare stroll vs run animation on the fox: running yields larger leg stride & stronger forward torso lean
    fox.activity = 'socialising';
    fox.animPhase = Math.PI * 0.5;
    fox.moveIntensity = 0.65;
    fox.gaitEffort = 0.55;
    for (let i = 0; i < 40; i++) renderer.update(1 / 60, null);
    const foxStroll = findRigFeet(fox.id);
    const strollLegSwing = Math.abs(foxStroll.feet[0].rotation.x);
    const strollLean = foxStroll.bodyGroup.rotation.x;

    fox.activity = 'fleeing';
    fox.animPhase = Math.PI * 0.5;
    fox.moveIntensity = 1.0;
    fox.gaitEffort = 1.38;
    for (let i = 0; i < 40; i++) renderer.update(1 / 60, null);
    const foxRun = findRigFeet(fox.id);
    const runLegSwing = Math.abs(foxRun.feet[0].rotation.x);
    const runLean = foxRun.bodyGroup.rotation.x;

    expect(runLegSwing).toBeGreaterThan(strollLegSwing * 1.6);
    expect(runLean).toBeGreaterThan(strollLean + 0.08);
    // Contralateral legs oppose each other (one forward, one back)
    expect(foxRun.feet[0].rotation.x * foxRun.feet[1].rotation.x).toBeLessThan(0);

    // At swing phase (phase = 0 -> cos(0) = +1), left foot lifts smoothly off the ground
    fox.animPhase = 0;
    for (let i = 0; i < 30; i++) renderer.update(1 / 60, null);
    expect(foxRun.feet[0].position.y).toBeGreaterThan(0.31);

    renderer.dispose();
  });

  it('locks planted feet 1:1 to ground displacement across stroll, walk, run, and hop with zero skating', () => {
    const world = new WorldState(new EventBus(), {
      seed: 882244,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 0,
    });
    const home = world.settlements[0];
    const fox = world.spawnCreature(home, 'fox', 'forager');
    const rabbit = world.spawnCreature(home, 'rabbit', 'forager');
    fox.heading = 0; // Facing +Z
    fox.animPhase = Math.PI * 0.5; // Left foot heel-strike (u_L = 0)
    rabbit.heading = 0;
    rabbit.animPhase = Math.PI * 0.5; // Ground push-off start

    const scene = new THREE.Scene();
    const renderer = new CreatureRenderer(scene, world);

    const findRig = (id: string) => {
      const root = renderer.rootGroup.children.find(
        (obj) => obj.userData?.selectionTarget?.id === id,
      )!;
      const bodyGroup = root.children[0];
      const feet = bodyGroup.children.filter(
        (ch) => ch instanceof THREE.Group && (ch.name === 'left_foot' || ch.name === 'right_foot'),
      );
      // Sort by X so feet[0] is left (-x) and feet[1] is right (+x)
      feet.sort((a, b) => a.position.x - b.position.x);
      return { root, bodyGroup, leftFoot: feet[0], rightFoot: feet[1] };
    };

    const foxRig = findRig(fox.id);
    const rabbitRig = findRig(rabbit.id);
    const soleLocal = new THREE.Vector3(0, -CREATURE_LEG_LENGTH, 0);
    const worldPt = new THREE.Vector3();

    // Test stroll, steady walk, and brisk run speeds on the fox
    const cases = [
      { name: 'stroll', speed: 2.1, effort: 0.52, intensity: 0.62 },
      { name: 'walk', speed: 4.1, effort: 0.94, intensity: 1.0 },
      { name: 'run', speed: 5.8, effort: 1.32, intensity: 1.0 },
    ];

    for (const tc of cases) {
      fox.activity = tc.name === 'stroll' ? 'socialising' : tc.name === 'walk' ? 'foraging' : 'fleeing';
      fox.gaitEffort = tc.effort;
      fox.moveIntensity = tc.intensity;
      fox.animPhase = 0;
      fox.heading = 0;
      fox.x = 0;
      fox.y = 0;
      fox.z = 0;
      foxRig.root.position.set(0, 0, 0);
      foxRig.root.rotation.y = 0;

      // Warm up body posture & position interpolation at steady forward speed
      const dt = 1 / 60;
      for (let i = 0; i < 45; i++) {
        fox.z += tc.speed * dt;
        renderer.update(dt, null);
      }

      // Align rig to left heel-strike (u_L = 0) while preserving steady interpolation lag
      fox.animPhase = Math.PI * 0.5;
      foxRig.root.position.set(fox.x, fox.y, fox.z);
      renderer.update(0, null);

      scene.updateMatrixWorld(true);
      const startRootZ = foxRig.root.position.z;
      const startFootWorldZ = foxRig.leftFoot.localToWorld(worldPt.copy(soleLocal)).z;

      // Advance across left-foot stance phase (stroll takes more frames than run for the same distance)
      const stanceSteps = tc.name === 'stroll' ? 10 : tc.name === 'walk' ? 8 : 6;
      let maxWorldSlipZ = 0;
      let maxGroundErrY = 0;
      let bodyMovedZ = 0;
      for (let step = 0; step < stanceSteps; step++) {
        fox.z += tc.speed * dt;
        renderer.update(dt, null);
        scene.updateMatrixWorld(true);
        const footWorld = foxRig.leftFoot.localToWorld(worldPt.copy(soleLocal));
        bodyMovedZ = foxRig.root.position.z - startRootZ;
        maxWorldSlipZ = Math.max(maxWorldSlipZ, Math.abs(footWorld.z - startFootWorldZ));
        maxGroundErrY = Math.max(maxGroundErrY, Math.abs(footWorld.y - foxRig.root.position.y));
      }

      // Body moved forward meaningfully, while the planted foot stayed locked to the ground (< 1.2cm slip)
      expect(bodyMovedZ).toBeGreaterThan(0.12);
      expect(maxWorldSlipZ).toBeLessThan(0.012);
      expect(maxGroundErrY).toBeLessThan(0.045);
    }

    // Verify rabbit hind feet lock 1:1 to ground during push-off stance and lift cleanly during airborne hop
    rabbit.activity = 'foraging';
    rabbit.gaitEffort = 0.92;
    rabbit.moveIntensity = 1.0;
    rabbit.animPhase = 0;
    rabbit.heading = 0;
    rabbit.x = 4;
    rabbit.y = 0;
    rabbit.z = 0;
    rabbitRig.root.position.set(4, 0, 0);
    rabbitRig.root.rotation.y = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 45; i++) {
      rabbit.z += 4.0 * dt;
      renderer.update(dt, null);
    }
    rabbit.animPhase = Math.PI * 0.5;
    rabbitRig.root.position.set(rabbit.x, rabbit.y, rabbit.z);
    renderer.update(0, null);
    scene.updateMatrixWorld(true);
    const startHopRootZ = rabbitRig.root.position.z;
    const startHopFootZ = rabbitRig.leftFoot.localToWorld(worldPt.copy(soleLocal)).z;

    let hopStanceSlip = 0;
    for (let step = 0; step < 7; step++) {
      rabbit.z += 4.0 * dt;
      renderer.update(dt, null);
      scene.updateMatrixWorld(true);
      const footW = rabbitRig.leftFoot.localToWorld(worldPt.copy(soleLocal));
      hopStanceSlip = Math.max(hopStanceSlip, Math.abs(footW.z - startHopFootZ));
    }
    expect(rabbitRig.root.position.z - startHopRootZ).toBeGreaterThan(0.15);
    expect(hopStanceSlip).toBeLessThan(0.012);

    // Continue into the airborne hop arc and verify the hind feet lift well off the ground
    let peakAirFootY = 0;
    for (let step = 0; step < 18; step++) {
      rabbit.z += 4.0 * dt;
      renderer.update(dt, null);
      scene.updateMatrixWorld(true);
      const footW = rabbitRig.leftFoot.localToWorld(worldPt.copy(soleLocal));
      peakAirFootY = Math.max(peakAirFootY, footW.y - rabbitRig.root.position.y);
    }
    expect(peakAirFootY).toBeGreaterThan(0.12);

    renderer.dispose();
  });
});
