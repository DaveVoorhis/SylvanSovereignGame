import * as THREE from 'three';
import type { BuildingType } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, type BuildingInstance, type Settlement } from '@simulation/settlements/Settlement';
import { sampleBridgeDeckY, type BridgeInstance } from '@simulation/terrain/Bridge';
import type { WorldState } from '@simulation/WorldState';
import type { TextureLibrary } from './ProceduralTextures';
import {
  HearthFire,
  createChimneySmokeGeometry,
  createChimneySmokeMaterial,
  createOvenFireMaterial,
  createSharedFlameGeometry,
} from './FireEffect';

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
  readonly swayPart?: THREE.Object3D;
  readonly chimneySmokes?: THREE.Points[];
}

interface RenderedHearth {
  readonly fire: HearthFire;
  readonly banner: THREE.Mesh;
  readonly seed: number;
}

interface RenderedBridge {
  readonly group: THREE.Group;
  readonly stages: { readonly t: number; readonly obj: THREE.Object3D }[];
  readonly lanterns: THREE.Object3D[];
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

  // Shared sculpted architectural geometries
  private readonly bellRoofGeo: THREE.BufferGeometry;
  private readonly acornSiloGeo: THREE.BufferGeometry;
  private readonly gableRoofGeo: THREE.BufferGeometry;
  private readonly sharedFlameGeo: THREE.BufferGeometry;

  private readonly buildingMeshes = new Map<string, RenderedBuilding>();
  private readonly bridgeMeshes = new Map<string, RenderedBridge>();
  private readonly hearths: RenderedHearth[] = [];
  private readonly settlementFlags = new Set<string>();
  private readonly extraDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    textures: TextureLibrary,
  ) {
    this.timberMat = new THREE.MeshStandardMaterial({
      map: textures.timber.map,
      bumpMap: textures.timber.bumpMap,
      bumpScale: 0.14,
      roughnessMap: textures.timber.roughnessMap,
      roughness: 0.84,
    });
    this.darkTimberMat = new THREE.MeshStandardMaterial({
      color: 0x4b321e,
      map: textures.timber.map,
      bumpMap: textures.timber.bumpMap,
      bumpScale: 0.12,
      roughness: 0.88,
    });
    this.plasterMat = new THREE.MeshStandardMaterial({
      color: 0xf0e6d2,
      roughness: 0.9,
      bumpMap: textures.fabricBump,
      bumpScale: 0.03,
    });
    this.warmPlasterMat = new THREE.MeshStandardMaterial({
      color: 0xe9d3b0,
      roughness: 0.9,
      bumpMap: textures.fabricBump,
      bumpScale: 0.035,
    });
    this.thatchMat = new THREE.MeshStandardMaterial({
      map: textures.thatch.map,
      bumpMap: textures.thatch.bumpMap,
      bumpScale: 0.2,
      roughnessMap: textures.thatch.roughnessMap,
      roughness: 0.92,
    });
    this.slateRoofMat = new THREE.MeshStandardMaterial({
      color: 0x4c5d6d,
      map: textures.stone.map,
      bumpMap: textures.stone.bumpMap,
      bumpScale: 0.16,
      roughness: 0.78,
      metalness: 0.08,
    });
    this.verdigrisMat = new THREE.MeshStandardMaterial({
      color: 0x4e9185,
      roughness: 0.46,
      metalness: 0.35,
      bumpMap: textures.fabricBump,
      bumpScale: 0.04,
    });
    this.brickMat = new THREE.MeshStandardMaterial({
      color: 0xa6523a,
      map: textures.stone.map,
      bumpMap: textures.stone.bumpMap,
      bumpScale: 0.16,
      roughness: 0.88,
    });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0xdff6ff,
      emissive: 0x26544f,
      emissiveIntensity: 0.22,
      roughness: 0.12,
      metalness: 0.18,
      transparent: true,
      opacity: 0.44,
    });
    this.fountainWaterMat = new THREE.MeshStandardMaterial({
      color: 0x62d9e8,
      emissive: 0x1e6b7c,
      emissiveIntensity: 0.45,
      roughness: 0.14,
      metalness: 0.15,
      transparent: true,
      opacity: 0.82,
    });
    this.canvasSailMat = new THREE.MeshStandardMaterial({
      color: 0xf7efe0,
      roughness: 0.86,
      bumpMap: textures.fabricBump,
      bumpScale: 0.04,
      side: THREE.DoubleSide,
    });
    this.stoneMat = new THREE.MeshStandardMaterial({
      map: textures.stone.map,
      bumpMap: textures.stone.bumpMap,
      bumpScale: 0.18,
      roughnessMap: textures.stone.roughnessMap,
      roughness: 0.88,
    });
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0xffe094,
      emissive: 0xffa036,
      emissiveIntensity: 1.35,
      roughness: 0.3,
    });
    this.shrineCrystalMat = new THREE.MeshStandardMaterial({
      color: 0x98ffe5,
      emissive: 0x4de0bc,
      emissiveIntensity: 1.65,
      roughness: 0.16,
      metalness: 0.22,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xe6bf5e,
      roughness: 0.3,
      metalness: 0.78,
    });
    this.doorMat = new THREE.MeshStandardMaterial({
      color: 0x6b3e22,
      map: textures.timber.map,
      roughness: 0.8,
    });
    this.mossLeafMat = new THREE.MeshStandardMaterial({
      color: 0x4e8538,
      roughness: 0.82,
    });
    this.flowerPinkMat = new THREE.MeshStandardMaterial({ color: 0xf48fb1, roughness: 0.55 });
    this.flowerGoldMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, roughness: 0.55 });
    this.flowerBlueMat = new THREE.MeshStandardMaterial({ color: 0x82b1ff, roughness: 0.55 });
    this.charredLogMat = new THREE.MeshStandardMaterial({
      color: 0x261a14,
      map: textures.timber.map,
      bumpMap: textures.timber.bumpMap,
      bumpScale: 0.18,
      emissive: 0x3b0e02,
      emissiveIntensity: 0.35,
      roughness: 0.94,
    });
    this.ovenFireMat = createOvenFireMaterial();
    this.chimneySmokeMat = createChimneySmokeMaterial();
    this.potteryMat = new THREE.MeshStandardMaterial({
      color: 0xc26942,
      roughness: 0.48,
    });
    this.earthPadMat = new THREE.MeshStandardMaterial({
      color: 0x6b4f35,
      map: textures.stone.map,
      bumpMap: textures.stone.bumpMap,
      bumpScale: 0.14,
      roughness: 0.96,
    });
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: 0xcab48c,
      roughness: 0.92,
    });

    // Bell-curved fairytale thatch cottage roof (LatheGeometry)
    const bellPts = [
      new THREE.Vector2(0.0, 1.82),
      new THREE.Vector2(0.32, 1.68),
      new THREE.Vector2(0.82, 1.25),
      new THREE.Vector2(1.42, 0.65),
      new THREE.Vector2(1.96, 0.14),
      new THREE.Vector2(2.14, -0.02),
      new THREE.Vector2(1.92, -0.08),
      new THREE.Vector2(1.42, 0.04),
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

    this.sharedFlameGeo = createSharedFlameGeometry();

    scene.add(this.rootGroup);
    this.syncAll();
  }

  update(dt: number): void {
    this.syncAll();

    const t = this.world.elapsedSeconds;

    // Warm evening window & hearth glow intensity
    const sunAngle = (this.world.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 0.85;
    const daylight = THREE.MathUtils.clamp((sunY + 0.16) / 0.55, 0, 1);
    const nightGlow = THREE.MathUtils.clamp(1 - (sunY + 0.1) * 2.2, 0.24, 2.35);
    this.windowMat.emissiveIntensity = nightGlow * 1.45;
    this.fountainWaterMat.emissiveIntensity = 0.25 + nightGlow * 0.35;
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
    this.chimneySmokeMat.uniforms.uTime.value = t;
    (this.chimneySmokeMat.uniforms.uWind.value as THREE.Vector2).set(
      Math.cos(breezeAngle) * breezeSpeed,
      Math.sin(breezeAngle) * breezeSpeed,
    );
    this.chimneySmokeMat.uniforms.uDaylight.value = daylight;
    (this.chimneySmokeMat.uniforms.uSunDir.value as THREE.Vector3)
      .set(sunX, Math.max(0.25, Math.abs(sunY)), 0.42)
      .normalize();

    for (const hearth of this.hearths) {
      hearth.fire.update(t, nightGlow, windStrength);
      hearth.banner.rotation.y = Math.sin(t * (2.2 + windStrength * 1.4) + hearth.seed) * (0.14 + windStrength * 0.12);
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
        if (entry.rotorMesh && b.completed) {
          entry.rotorMesh.rotation.z -= dt * 0.62;
        }
        if (entry.fountainJet && b.completed) {
          const pulse = 1.0 + Math.sin(t * 4.2 + b.position.x) * 0.12;
          entry.fountainJet.scale.set(pulse, 0.92 + Math.sin(t * 5.6) * 0.14, pulse);
          entry.fountainJet.rotation.y += dt * 1.3;
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
      const frac = bridge.completed ? 1.05 : Math.max(0.08, bridge.progress / 100);
      for (const stage of entry.stages) {
        stage.obj.visible = stage.t <= frac;
      }
      for (const lantern of entry.lanterns) {
        lantern.visible = bridge.completed;
      }
    }
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
    const p = b.completed && !b.disassembling ? 100 : THREE.MathUtils.clamp(b.progress, 0, 100);
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
    const liveBuildingIds = new Set<string>();
    for (const settlement of this.world.settlements) {
      if (!this.settlementFlags.has(settlement.id)) {
        this.settlementFlags.add(settlement.id);
        this.createSettlementCenterpiece(settlement);
      }

      for (const b of settlement.buildings) {
        liveBuildingIds.add(b.id);
        if (!this.buildingMeshes.has(b.id)) {
          const built = this.createBuildingMesh(b, settlement.bannerColor);
          this.buildingMeshes.set(b.id, built);
          this.rootGroup.add(built.group);
          this.applyConstructionStageVisuals(built, b);
        }
      }
    }

    // Cleanly remove & dispose meshes for disassembled buildings
    const sharedGeos = new Set<THREE.BufferGeometry>([
      this.bellRoofGeo,
      this.acornSiloGeo,
      this.gableRoofGeo,
      this.sharedFlameGeo,
    ]);
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

    // Cobblestone hearth plaza + decorative mossy curb stones
    const plaza = add(new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.95, 0.2, 24), this.stoneMat));
    plaza.position.y = 0.06;

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const curb = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.28), this.stoneMat));
      curb.position.set(Math.cos(a) * 2.65, 0.15, Math.sin(a) * 2.65);
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
    const fire = new HearthFire(seed, this.sharedFlameGeo);
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

    this.hearths.push({
      fire,
      banner,
      seed,
    });

    this.rootGroup.add(group);
  }

  private createBuildingMesh(b: BuildingInstance, bannerColor: number): RenderedBuilding {
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

    // Pick slight material variations per building instance for richer city silhouettes
    const wallPlaster = variantHash > 0.5 ? this.warmPlasterMat : this.plasterMat;
    const altRoofMat = variantHash > 0.62 ? this.slateRoofMat : this.thatchMat;

    let crystalMesh: THREE.Mesh | undefined;
    let runeRingA: THREE.Mesh | undefined;
    let runeRingB: THREE.Mesh | undefined;
    let wheelMesh: THREE.Object3D | undefined;
    let rotorMesh: THREE.Object3D | undefined;
    let fountainJet: THREE.Object3D | undefined;
    let swayPart: THREE.Object3D | undefined;
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
      plume.position.set(x, y - 0.06, z);
      // Counter-rotate so local XZ matches world wind direction across all buildings
      plume.rotation.y = -b.rotation;
      plume.renderOrder = 3;
      plume.visible = b.completed;
      group.add(plume);
      chimneySmokes.push(plume);
    };

    const type: BuildingType = b.type;
    if (type === 'burrow_cottage') {
      const plinth = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.78, 0.4, 20), this.stoneMat));
      plinth.position.y = 0.2;

      const body = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.58, 1.45, 20), wallPlaster));
      body.position.y = 1.05;

      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.48, 8), this.darkTimberMat));
        post.position.set(Math.cos(a) * 1.52, 1.05, Math.sin(a) * 1.52);
      }

      const roof = tag(new THREE.Mesh(this.bellRoofGeo, this.thatchMat));
      roof.position.y = 1.74;

      const knob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), this.timberMat));
      knob.position.y = 3.58;

      const chimney = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 1.55, 8), this.stoneMat));
      chimney.position.set(0.82, 2.55, -0.38);
      chimney.rotation.z = -0.1;
      const pot = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.28, 10), this.potteryMat));
      pot.position.set(0.89, 3.38, -0.38);
      addChimneySmoke(0.9, 3.55, -0.38);

      const doorFrame = tag(new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.09, 10, 20), this.darkTimberMat));
      doorFrame.position.set(0, 0.85, 1.54);
      const door = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20), bannerMat));
      door.rotation.x = Math.PI / 2;
      door.position.set(0, 0.85, 1.52);
      const doorknob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.brassMat));
      doorknob.position.set(0.18, 0.85, 1.6);
      const doorstep = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 0.16, 12), this.stoneMat));
      doorstep.position.set(0, 0.08, 1.78);

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

      const cap = tag(new THREE.Mesh(this.bellRoofGeo, this.thatchMat));
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
      const door = tag(new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.12, 0.18), this.doorMat));
      door.position.set(0, 0.62, 1.62);
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
      // Starlight Fountain — octagonal cobblestone patio, two-tier carved stone fountain with animated shimmering water jet & garden lamps!
      const patio = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.62, 0.18, 8), this.stoneMat));
      patio.position.y = 0.09;

      // Outer stone basin rim + luminous turquoise pool
      const basinWall = tag(new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.24, 10, 24), this.stoneMat));
      basinWall.rotation.x = Math.PI / 2;
      basinWall.position.y = 0.42;
      const lowerWater = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.36, 0.24, 24), this.fountainWaterMat));
      lowerWater.position.y = 0.4;
      lowerWater.castShadow = false;

      // Central tiered pedestal + upper bowl
      const stem = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 1.35, 12), this.stoneMat));
      stem.position.y = 0.88;
      const upperBowl = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.34, 0.36, 16), this.stoneMat));
      upperBowl.position.y = 1.56;
      const upperWater = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.12, 16), this.fountainWaterMat));
      upperWater.position.y = 1.72;
      upperWater.castShadow = false;

      // Animated shimmering turquoise water spout & starlight splash crown!
      const jetPivot = new THREE.Group();
      jetPivot.position.y = 1.78;
      const spireJet = tag(new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.15, 12), this.fountainWaterMat), jetPivot);
      spireJet.position.y = 0.56;
      spireJet.castShadow = false;
      const crownRing = tag(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 8, 18), this.shrineCrystalMat), jetPivot);
      crownRing.rotation.x = Math.PI / 2;
      crownRing.position.y = 0.12;
      crownRing.castShadow = false;
      jetPivot.userData.buildPhase = 'exterior';
      finishedGroup.add(jetPivot);
      fountainJet = jetPivot;

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
      const mainRoof = tag(new THREE.Mesh(this.gableRoofGeo, this.slateRoofMat));
      mainRoof.scale.set(1.24, 1.18, 1.56);
      mainRoof.rotation.y = Math.PI / 2;
      mainRoof.position.y = 3.92;

      const crossRoof = tag(new THREE.Mesh(this.gableRoofGeo, this.slateRoofMat));
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

    // Classify every finished architectural component into progressive reveal order:
    // 0.78-0.86 structural shell -> 0.86-0.92 roofs/domes -> 0.92-0.99 exterior features & trim
    const roofMaterials = new Set<THREE.Material>([
      this.thatchMat,
      this.slateRoofMat,
      this.verdigrisMat,
      this.glassMat,
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
      this.ovenFireMat,
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
    const kit = this.buildConstructionKit(b, blueprint.footprintRadius, blueprint.frameStyle);
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
      swayPart,
      chimneySmokes: chimneySmokes.length > 0 ? chimneySmokes : undefined,
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

    // 2. Leveling Land (18-36%): graded earthen terrace pad + leveling pegs & soil mounds
    const levelingPad = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.12, r * 1.24, 0.24, 16),
      this.earthPadMat,
    );
    levelingPad.position.y = 0.04;
    levelingPad.receiveShadow = true;
    levelingPad.userData.selectionTarget = { kind: 'building', id: b.id };

    const levelingExtras = new THREE.Group();
    for (const [cx, cz] of corners) {
      const peg = addKit(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), this.timberMat), levelingExtras);
      peg.position.set(cx * 0.96, 0.26, cz * 0.96);
    }
    const mound = addKit(new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.earthPadMat), levelingExtras);
    mound.scale.set(1.4, 0.52, 1.15);
    mound.position.set(halfW * 0.72, 0.18, halfD * 0.65);

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

    return { group, stages, lanterns };
  }

  dispose(): void {
    const sharedGeos = new Set<THREE.BufferGeometry>([
      this.bellRoofGeo,
      this.acornSiloGeo,
      this.gableRoofGeo,
      this.sharedFlameGeo,
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
    for (const d of this.extraDisposables) d.dispose();
    this.extraDisposables.length = 0;
    for (const entry of this.buildingMeshes.values()) {
      for (const mat of entry.ownedMaterials) {
        mat.dispose();
      }
    }
    this.buildingMeshes.clear();
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
  }
}
