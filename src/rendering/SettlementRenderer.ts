import * as THREE from 'three';
import type { BuildingType } from '@core/Types';
import type { BuildingInstance, Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';
import type { TextureLibrary } from './ProceduralTextures';

interface SmokePuff {
  readonly mesh: THREE.Mesh;
  readonly basePos: THREE.Vector3;
  readonly phase: number;
}

interface RenderedBuilding {
  readonly group: THREE.Group;
  readonly crystalMesh?: THREE.Mesh;
  readonly runeRingA?: THREE.Mesh;
  readonly runeRingB?: THREE.Mesh;
  readonly wheelMesh?: THREE.Object3D;
  readonly rotorMesh?: THREE.Object3D;
  readonly fountainJet?: THREE.Object3D;
  readonly swayPart?: THREE.Object3D;
  readonly smokePuffs?: SmokePuff[];
}

interface RenderedHearth {
  readonly flameOuter: THREE.Mesh;
  readonly flameInner: THREE.Mesh;
  readonly banner: THREE.Mesh;
  readonly light: THREE.PointLight;
  readonly seed: number;
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
  private readonly flameOuterMat: THREE.MeshStandardMaterial;
  private readonly flameInnerMat: THREE.MeshStandardMaterial;
  private readonly smokeMat: THREE.MeshStandardMaterial;
  private readonly potteryMat: THREE.MeshStandardMaterial;

  // Shared sculpted architectural geometries
  private readonly bellRoofGeo: THREE.BufferGeometry;
  private readonly acornSiloGeo: THREE.BufferGeometry;
  private readonly gableRoofGeo: THREE.BufferGeometry;
  private readonly smokeGeo: THREE.BufferGeometry;

  private readonly buildingMeshes = new Map<string, RenderedBuilding>();
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
    this.flameOuterMat = new THREE.MeshStandardMaterial({
      color: 0xff7b29,
      emissive: 0xff5a14,
      emissiveIntensity: 1.9,
      roughness: 0.4,
    });
    this.flameInnerMat = new THREE.MeshStandardMaterial({
      color: 0xfff099,
      emissive: 0xffd24d,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    this.smokeMat = new THREE.MeshStandardMaterial({
      color: 0xeae6df,
      transparent: true,
      opacity: 0.38,
      roughness: 1.0,
      depthWrite: false,
    });
    this.potteryMat = new THREE.MeshStandardMaterial({
      color: 0xc26942,
      roughness: 0.48,
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

    this.smokeGeo = new THREE.SphereGeometry(0.18, 10, 8);

    scene.add(this.rootGroup);
    this.syncAll();
  }

  update(dt: number): void {
    this.syncAll();

    const t = this.world.elapsedSeconds;

    // Warm evening window & hearth glow intensity
    const sunY = Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2);
    const nightGlow = THREE.MathUtils.clamp(1 - (sunY + 0.1) * 2.2, 0.24, 2.35);
    this.windowMat.emissiveIntensity = nightGlow * 1.45;
    this.fountainWaterMat.emissiveIntensity = 0.25 + nightGlow * 0.35;

    for (const hearth of this.hearths) {
      const flicker =
        Math.sin(t * 7.5 + hearth.seed) * 0.14 + Math.sin(t * 13.2 + hearth.seed * 2) * 0.08;
      hearth.light.intensity = nightGlow * 6.8 + flicker * 3.2;
      hearth.flameOuter.scale.set(1 - flicker * 0.35, 1 + flicker * 0.85, 1 - flicker * 0.35);
      hearth.flameOuter.rotation.y = t * 1.4 + hearth.seed;
      hearth.flameInner.scale.set(1 + flicker * 0.3, 1 + flicker * 1.0, 1 + flicker * 0.3);
      hearth.banner.rotation.y = Math.sin(t * 2.4 + hearth.seed) * 0.16;
    }

    // Animate shrine crystals, rune rings, workshop wheels, windmill rotors, fountain jets, swaying signs & smoke
    for (const settlement of this.world.settlements) {
      for (const b of settlement.buildings) {
        const entry = this.buildingMeshes.get(b.id);
        if (!entry) continue;

        const targetScale = b.completed ? 1.0 : 0.32 + (b.progress / 100) * 0.68;
        entry.group.scale.y += (targetScale - entry.group.scale.y) * Math.min(1, dt * 6);

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
        if (entry.smokePuffs && b.completed) {
          for (const puff of entry.smokePuffs) {
            const cycle = (t * 0.38 + puff.phase) % 1;
            puff.mesh.position.set(
              puff.basePos.x + Math.sin(cycle * Math.PI * 2 + puff.phase) * 0.18 + cycle * 0.22,
              puff.basePos.y + cycle * 1.65,
              puff.basePos.z + Math.cos(cycle * Math.PI * 2) * 0.1,
            );
            const s = 0.45 + cycle * 1.45;
            puff.mesh.scale.setScalar(s);
            puff.mesh.visible = cycle > 0.04 && cycle < 0.96;
          }
        }
      }
    }
  }

  private syncAll(): void {
    for (const settlement of this.world.settlements) {
      if (!this.settlementFlags.has(settlement.id)) {
        this.settlementFlags.add(settlement.id);
        this.createSettlementCenterpiece(settlement);
      }

      for (const b of settlement.buildings) {
        if (!this.buildingMeshes.has(b.id)) {
          const built = this.createBuildingMesh(b, settlement.bannerColor);
          this.buildingMeshes.set(b.id, built);
          this.rootGroup.add(built.group);
        }
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

    // Chunky cobblestone firepit ring + crossed firewood logs
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rock = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 1), this.stoneMat));
      rock.scale.set(1.15, 0.72, 1.0);
      rock.position.set(Math.cos(a) * 0.68, 0.24, Math.sin(a) * 0.68);
    }

    for (let i = 0; i < 3; i++) {
      const log = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.85, 8), this.darkTimberMat));
      log.rotation.z = Math.PI / 2 - 0.22;
      log.rotation.y = (i / 3) * Math.PI;
      log.position.y = 0.26;
    }

    // Layered dancing hearth flames
    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.82, 10), this.flameOuterMat);
    flameOuter.position.y = 0.58;
    group.add(flameOuter);

    const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.56, 8), this.flameInnerMat);
    flameInner.position.y = 0.48;
    group.add(flameInner);

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

    const light = new THREE.PointLight(0xffa74f, 4.8, 20, 1.55);
    light.position.set(0, 1.9, 0);
    group.add(light);

    this.hearths.push({
      flameOuter,
      flameInner,
      banner,
      light,
      seed: settlement.center.x * 0.3 + settlement.center.z * 0.7,
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
    group.scale.set(widthScale, b.completed ? 1.0 : 0.35, widthScale);
    group.userData.selectionTarget = { kind: 'building', id: b.id };

    const bannerMat = new THREE.MeshStandardMaterial({
      color: bannerColor,
      roughness: 0.74,
      side: THREE.DoubleSide,
    });
    this.extraDisposables.push(bannerMat);

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
    const smokePuffs: SmokePuff[] = [];

    const tag = <T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = group): T => {
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

      group.add(holder);
    };

    const addHangingLantern = (x: number, y: number, z: number) => {
      const glass = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.22, 8), this.windowMat));
      glass.position.set(x, y, z);
      const cap = tag(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 8), this.brassMat));
      cap.position.set(x, y + 0.15, z);
    };

    const addChimneySmoke = (x: number, y: number, z: number) => {
      for (let i = 0; i < 3; i++) {
        const mesh = new THREE.Mesh(this.smokeGeo, this.smokeMat);
        mesh.position.set(x, y, z);
        group.add(mesh);
        smokePuffs.push({
          mesh,
          basePos: new THREE.Vector3(x, y, z),
          phase: i / 3 + ((b.position.x * 0.13) % 1),
        });
      }
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
      const ovenGlow = tag(new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), this.flameOuterMat));
      ovenGlow.position.set(1.55, 0.98, 0.79);
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
      group.add(signPivot);
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
      group.add(wheelPivot);
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
      group.add(rotorPivot);
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
      group.add(jetPivot);
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
      group.add(flagPivot);
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

    return {
      group,
      crystalMesh,
      runeRingA,
      runeRingB,
      wheelMesh,
      rotorMesh,
      fountainJet,
      swayPart,
      smokePuffs: smokePuffs.length > 0 ? smokePuffs : undefined,
    };
  }

  dispose(): void {
    const sharedGeos = new Set<THREE.BufferGeometry>([
      this.bellRoofGeo,
      this.acornSiloGeo,
      this.gableRoofGeo,
      this.smokeGeo,
    ]);
    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry && !sharedGeos.has(obj.geometry)) {
        obj.geometry.dispose();
      }
    });
    for (const g of sharedGeos) g.dispose();
    for (const d of this.extraDisposables) d.dispose();
    this.extraDisposables.length = 0;

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
    this.flameOuterMat.dispose();
    this.flameInnerMat.dispose();
    this.smokeMat.dispose();
    this.potteryMat.dispose();
  }
}
