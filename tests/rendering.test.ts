import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import type { CreatureRole } from '@core/Types';
import { CreatureRenderer } from '@rendering/CreatureRenderer';
import { DistanceFocusBlurPass } from '@rendering/DistanceFocusBlurPass';
import {
  HearthFire,
  createChimneySmokeGeometry,
  createChimneySmokeMaterial,
  createOvenFireMaterial,
  createSharedFlameGeometry,
} from '@rendering/FireEffect';
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
  createOrganicPuffGeo,
  createPineCanopyGeo,
  createPineTrunkGeo,
  createScallopedPineTierGeo,
  createToadstoolClusterGeo,
  createWildflowerClusterGeo,
} from '@rendering/GeometryHelpers';
import type { PbrTextureSet, TextureLibrary } from '@rendering/ProceduralTextures';
import { SettlementRenderer } from '@rendering/SettlementRenderer';
import { createRealisticWaterSurface } from '@rendering/WaterShader';
import { Creature } from '@simulation/creatures/Creature';
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
    renderer.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshCount++;
    });
    expect(meshCount).toBeGreaterThan(ALL_BUILDING_TYPES.length * 10 + 40);

    renderer.dispose();
    textures.dispose();
  });

  it('builds and animates articulated high-resolution rigs for all 12 species and all 6 roles', () => {
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
      }
    });

    // High-resolution articulated creatures have many sculpted sub-meshes per creature
    expect(meshCount).toBeGreaterThan(world.creatures.length * 10);

    renderer.dispose();
  });
});
