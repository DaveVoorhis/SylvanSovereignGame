import * as THREE from 'three';
import { SeededRandom } from '@core/SeededRandom';
import type { WorldState } from '@simulation/WorldState';
import type { SkyLightingState } from './WaterShader';
import { mergePartGeometries } from './GeometryHelpers';

interface CritterOrbit {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly anchorZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly bobAmp: number;
  readonly speed: number;
  readonly phase: number;
  readonly scale: number;
  readonly figureEight: boolean;
}

export interface AmbientCritterCounts {
  readonly butterflies: number;
  readonly bees: number;
  readonly dragonflies: number;
  readonly ladybugs: number;
  readonly fireflies: number;
}

interface WingShaderUniforms {
  readonly uTime: { value: number };
}

/**
 * Adds a lightweight per-vertex wing-flapping deformation driven by `abs(position.x)`
 * so instanced butterflies, bees, and dragonflies flap organically on the GPU with zero
 * geometry updates and a single draw call per critter family.
 */
function applyWingFlapShader(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  uniforms: WingShaderUniforms,
  flapSpeed: number,
  flapAmp: number,
  cacheKey: string,
): void {
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCritterTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCritterTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float wingSeed = instanceMatrix[3][0] * 0.73 + instanceMatrix[3][2] * 1.19;
        #else
          float wingSeed = 0.0;
        #endif
        float wingSpan = abs(transformed.x);
        if (wingSpan > 0.025) {
          float flap = sin(uCritterTime * ${flapSpeed.toFixed(2)} + wingSeed) * ${flapAmp.toFixed(3)};
          transformed.y += wingSpan * flap;
          transformed.x *= 1.0 - abs(flap) * 0.22;
        }`,
      );
  };
}

function buildButterflyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Slender dark thorax & abdomen facing +Z
  const body = new THREE.CapsuleGeometry(0.022, 0.12, 4, 6);
  body.rotateX(Math.PI / 2);
  parts.push(body);

  const head = new THREE.SphereGeometry(0.026, 6, 5);
  head.translate(0, 0.006, 0.082);
  parts.push(head);

  // Sculpted 4-wing silhouette (broader forewings forward toward +Z, tapered hindwings trailing toward -Z)
  for (const side of [-1, 1] as const) {
    const foreShape = new THREE.Shape();
    foreShape.moveTo(0, 0.02);
    foreShape.bezierCurveTo(side * 0.14, 0.15, side * 0.28, 0.12, side * 0.24, -0.02);
    foreShape.quadraticCurveTo(side * 0.14, -0.06, 0, -0.01);
    foreShape.closePath();
    const fore = new THREE.ShapeGeometry(foreShape, 5);
    // rotateX(-PI/2) maps +Y -> -Z; rotateY(PI) flips -Z -> +Z so forewings lead forward while keeping +Y normals
    fore.rotateX(-Math.PI / 2);
    fore.rotateY(Math.PI);
    fore.translate(0, 0.012, 0.02);
    parts.push(fore);

    const hindShape = new THREE.Shape();
    hindShape.moveTo(0, -0.01);
    hindShape.bezierCurveTo(side * 0.16, -0.02, side * 0.19, -0.15, side * 0.07, -0.18);
    hindShape.quadraticCurveTo(side * 0.02, -0.12, 0, -0.05);
    hindShape.closePath();
    const hind = new THREE.ShapeGeometry(hindShape, 5);
    hind.rotateX(-Math.PI / 2);
    hind.rotateY(Math.PI);
    hind.translate(0, 0.008, -0.01);
    parts.push(hind);
  }

  return mergePartGeometries(parts, false);
}

function buildBeeGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Fuzzy plump striped bee body
  const body = new THREE.SphereGeometry(0.068, 8, 6);
  body.scale(0.84, 0.82, 1.38);
  parts.push(body);

  // Tiny head bead
  const head = new THREE.SphereGeometry(0.044, 6, 6);
  head.translate(0, 0.005, 0.095);
  parts.push(head);

  // Paired oval buzzing wings
  for (const side of [-1, 1] as const) {
    const wing = new THREE.CircleGeometry(0.078, 8);
    wing.scale(1.45, 0.62, 1.0);
    wing.rotateX(-Math.PI / 2);
    wing.translate(side * 0.095, 0.045, 0.01);
    parts.push(wing);
  }

  return mergePartGeometries(parts, false);
}

function buildDragonflyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Elongated jewel-like abdomen + thorax
  const tail = new THREE.CylinderGeometry(0.012, 0.02, 0.34, 6);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.11);
  parts.push(tail);

  const thorax = new THREE.SphereGeometry(0.036, 7, 6);
  thorax.scale(0.95, 0.9, 1.3);
  thorax.translate(0, 0.004, 0.07);
  parts.push(thorax);

  const head = new THREE.SphereGeometry(0.032, 6, 6);
  head.scale(1.25, 0.95, 0.85);
  head.translate(0, 0.006, 0.13);
  parts.push(head);

  // Four slender outstretched dragonfly wings
  for (const side of [-1, 1] as const) {
    for (const zOff of [0.09, 0.035]) {
      const wing = new THREE.PlaneGeometry(0.24, 0.052);
      wing.rotateX(-Math.PI / 2);
      wing.rotateY(side * (zOff > 0.06 ? -0.1 : 0.14));
      wing.translate(side * 0.14, 0.026, zOff);
      parts.push(wing);
    }
  }

  return mergePartGeometries(parts, false);
}

function buildLadybugGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Glossy domed beetle shell
  const shell = new THREE.SphereGeometry(0.078, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
  shell.scale(0.95, 0.78, 1.18);
  parts.push(shell);

  // Cute tucked head bead
  const head = new THREE.SphereGeometry(0.038, 7, 6);
  head.translate(0, 0.018, 0.082);
  parts.push(head);

  return mergePartGeometries(parts, false);
}

/**
 * Renders decorative tiny woodland & waterway creatures for colour, vibrancy, and atmosphere:
 * - **Butterflies**: vibrant multi-hue swarms fluttering in figure-8 arcs over meadows & villages
 * - **Bees**: golden-amber pollinators hovering around wildflowers & village gardens
 * - **Dragonflies**: iridescent jewel-winged skimmers darting over rivers, ponds & waterway villages
 * - **Ladybugs**: glossy crimson & amber beetles meandering across sunlit meadows
 * - **Fireflies**: warm bioluminescent motes drifting and pulsing softly at dusk & night
 */
export class AmbientCritterRenderer {
  readonly rootGroup = new THREE.Group();

  private readonly butterflyMesh: THREE.InstancedMesh;
  private readonly beeMesh: THREE.InstancedMesh;
  private readonly dragonflyMesh: THREE.InstancedMesh;
  private readonly ladybugMesh: THREE.InstancedMesh;
  private readonly fireflyMesh: THREE.InstancedMesh;

  private readonly butterflyOrbits: CritterOrbit[] = [];
  private readonly beeOrbits: CritterOrbit[] = [];
  private readonly dragonflyOrbits: CritterOrbit[] = [];
  private readonly ladybugOrbits: CritterOrbit[] = [];
  private readonly fireflyOrbits: CritterOrbit[] = [];

  private readonly butterflyMat: THREE.MeshStandardMaterial;
  private readonly beeMat: THREE.MeshStandardMaterial;
  private readonly dragonflyMat: THREE.MeshPhysicalMaterial;
  private readonly ladybugMat: THREE.MeshPhysicalMaterial;
  private readonly fireflyMat: THREE.MeshBasicMaterial;

  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly shaderUniforms: WingShaderUniforms = { uTime: { value: 0 } };
  private readonly dummy = new THREE.Object3D();
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    private readonly world: WorldState,
    densityMultiplier = 1.0,
  ) {
    this.rootGroup.name = 'ambient_critters';
    const rng = new SeededRandom(world.config.seed ^ 0x43524954);
    const scaleCount = (base: number) => Math.max(8, Math.round(base * THREE.MathUtils.clamp(densityMultiplier, 0.45, 1.35)));

    const butterflyCount = scaleCount(110);
    const beeCount = scaleCount(90);
    const dragonflyCount = scaleCount(75);
    const ladybugCount = scaleCount(65);
    const fireflyCount = scaleCount(120);

    // 1. Shared sculpted geometries
    const butterflyGeo = buildButterflyGeo();
    const beeGeo = buildBeeGeo();
    const dragonflyGeo = buildDragonflyGeo();
    const ladybugGeo = buildLadybugGeo();
    const fireflyGeo = new THREE.SphereGeometry(0.062, 7, 6);
    this.disposables.push(butterflyGeo, beeGeo, dragonflyGeo, ladybugGeo, fireflyGeo);

    // 2. Crisp vibrant materials with GPU wing-flap shaders
    this.butterflyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    applyWingFlapShader(this.butterflyMat, this.shaderUniforms, 11.5, 0.88, 'critter-butterfly-v1');

    this.beeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.56,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    applyWingFlapShader(this.beeMat, this.shaderUniforms, 32.0, 0.55, 'critter-bee-v1');

    this.dragonflyMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.24,
      clearcoat: 0.88,
      clearcoatRoughness: 0.12,
      iridescence: 0.92,
      iridescenceIOR: 1.4,
      side: THREE.DoubleSide,
    });
    applyWingFlapShader(this.dragonflyMat, this.shaderUniforms, 26.0, 0.42, 'critter-dragonfly-v1');

    this.ladybugMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.22,
      clearcoat: 0.92,
      clearcoatRoughness: 0.1,
    });

    this.fireflyMat = new THREE.MeshBasicMaterial({
      color: 0xe6ff7a,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.disposables.push(
      this.butterflyMat,
      this.beeMat,
      this.dragonflyMat,
      this.ladybugMat,
      this.fireflyMat,
    );

    // 3. Populate deterministic habitat orbits & vibrant colour palettes
    const terrain = world.terrain;
    const playableR = terrain.playableRadius - 12;
    const waterLevel = terrain.waterLevel;
    const settlements = world.settlements;

    const pickMeadowSpot = (): { x: number; y: number; z: number } => {
      // Cluster ~45% near settlements so players immediately notice colourful tiny life in villages!
      if (settlements.length > 0 && rng.chance(0.45)) {
        const s = settlements[rng.int(0, settlements.length - 1)];
        for (let attempt = 0; attempt < 8; attempt++) {
          const ang = rng.range(0, Math.PI * 2);
          const r = rng.range(3.5, Math.max(16, s.radius + 14));
          const x = s.center.x + Math.cos(ang) * r;
          const z = s.center.z + Math.sin(ang) * r;
          const h = terrain.getHeightAt(x, z);
          if (terrain.isWithinPlayableArea(x, z) && h > waterLevel + 0.15) {
            return { x, y: h, z };
          }
        }
      }
      for (let attempt = 0; attempt < 18; attempt++) {
        const ang = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * playableR * 0.82;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const h = terrain.getHeightAt(x, z);
        if (
          h > waterLevel + 0.25 &&
          h < 18 &&
          !terrain.isDeepSeaAt(x, z) &&
          terrain.getCoastSignedDistance(x, z) > 6
        ) {
          return { x, y: h, z };
        }
      }
      return { x: 0, y: Math.max(terrain.getHeightAt(0, 0), waterLevel + 0.5), z: 0 };
    };

    const pickWaterSpot = (): { x: number; y: number; z: number } => {
      const waterwaySettlements = settlements.filter((s) => s.adaptation === 'waterway_haven');
      if (waterwaySettlements.length > 0 && rng.chance(0.45)) {
        const ws = waterwaySettlements[rng.int(0, waterwaySettlements.length - 1)];
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(2.5, Math.max(14, ws.radius + 8));
        return {
          x: ws.center.x + Math.cos(ang) * r,
          y: waterLevel,
          z: ws.center.z + Math.sin(ang) * r,
        };
      }
      const spot = terrain.getWaterwaySpot(rng);
      if (spot) {
        return { x: spot.x, y: waterLevel, z: spot.z };
      }
      const fallback = pickMeadowSpot();
      return { x: fallback.x, y: Math.max(fallback.y, waterLevel), z: fallback.z };
    };

    // Butterflies
    const butterflyPalette = [
      0xff7b1c, // Monarch tangerine
      0x28a9ff, // Morpho electric blue
      0xffe140, // Sulphur sunny yellow
      0xff6aa8, // Painted Lady rose pink
      0xba6cff, // Peacock royal violet
      0x68f0a4, // Brimstone mint
    ];
    this.butterflyMesh = new THREE.InstancedMesh(butterflyGeo, this.butterflyMat, butterflyCount);
    this.butterflyMesh.name = 'ambient_butterflies';
    this.butterflyMesh.frustumCulled = false;
    const colorScratch = new THREE.Color();
    for (let i = 0; i < butterflyCount; i++) {
      const spot = pickMeadowSpot();
      this.butterflyOrbits.push({
        anchorX: spot.x,
        anchorY: spot.y + rng.range(0.65, 2.35),
        anchorZ: spot.z,
        radiusX: rng.range(1.6, 4.4),
        radiusZ: rng.range(1.4, 3.8),
        bobAmp: rng.range(0.24, 0.58),
        speed: rng.range(0.48, 0.92),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.85, 1.38),
        figureEight: true,
      });
      colorScratch.setHex(butterflyPalette[i % butterflyPalette.length]);
      colorScratch.offsetHSL(rng.range(-0.025, 0.025), 0.04, rng.range(-0.05, 0.06));
      this.butterflyMesh.setColorAt(i, colorScratch);
    }
    if (this.butterflyMesh.instanceColor) this.butterflyMesh.instanceColor.needsUpdate = true;

    // Bees
    const beePalette = [0xf5be28, 0xe8a41e, 0xffd247, 0xd99616];
    this.beeMesh = new THREE.InstancedMesh(beeGeo, this.beeMat, beeCount);
    this.beeMesh.name = 'ambient_bees';
    this.beeMesh.frustumCulled = false;
    for (let i = 0; i < beeCount; i++) {
      const spot = pickMeadowSpot();
      this.beeOrbits.push({
        anchorX: spot.x,
        anchorY: spot.y + rng.range(0.45, 1.55),
        anchorZ: spot.z,
        radiusX: rng.range(0.75, 2.2),
        radiusZ: rng.range(0.75, 2.2),
        bobAmp: rng.range(0.14, 0.34),
        speed: rng.range(1.15, 2.05),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.78, 1.15),
        figureEight: i % 2 === 0,
      });
      colorScratch.setHex(beePalette[i % beePalette.length]);
      this.beeMesh.setColorAt(i, colorScratch);
    }
    if (this.beeMesh.instanceColor) this.beeMesh.instanceColor.needsUpdate = true;

    // Dragonflies (skimming waterways, ponds & aquatic villages!)
    const dragonflyPalette = [
      0x22b8ff, // Sapphire darner
      0x24e09b, // Emerald skimmer
      0xff5282, // Ruby meadowhawk
      0xb876ff, // Amethyst jewelwing
    ];
    this.dragonflyMesh = new THREE.InstancedMesh(dragonflyGeo, this.dragonflyMat, dragonflyCount);
    this.dragonflyMesh.name = 'ambient_dragonflies';
    this.dragonflyMesh.frustumCulled = false;
    for (let i = 0; i < dragonflyCount; i++) {
      const spot = pickWaterSpot();
      this.dragonflyOrbits.push({
        anchorX: spot.x,
        anchorY: spot.y + rng.range(0.32, 1.15),
        anchorZ: spot.z,
        radiusX: rng.range(2.2, 5.6),
        radiusZ: rng.range(2.0, 4.8),
        bobAmp: rng.range(0.08, 0.22),
        speed: rng.range(0.85, 1.55),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.9, 1.35),
        figureEight: true,
      });
      colorScratch.setHex(dragonflyPalette[i % dragonflyPalette.length]);
      this.dragonflyMesh.setColorAt(i, colorScratch);
    }
    if (this.dragonflyMesh.instanceColor) this.dragonflyMesh.instanceColor.needsUpdate = true;

    // Ladybugs (glossy crimson & sunlit amber beetles across meadows & gardens)
    const ladybugPalette = [0xe8262e, 0xf24a24, 0xd91c2b, 0xf59e22];
    this.ladybugMesh = new THREE.InstancedMesh(ladybugGeo, this.ladybugMat, ladybugCount);
    this.ladybugMesh.name = 'ambient_ladybugs';
    this.ladybugMesh.frustumCulled = false;
    for (let i = 0; i < ladybugCount; i++) {
      const spot = pickMeadowSpot();
      this.ladybugOrbits.push({
        anchorX: spot.x,
        anchorY: spot.y + 0.08,
        anchorZ: spot.z,
        radiusX: rng.range(0.55, 1.85),
        radiusZ: rng.range(0.55, 1.85),
        bobAmp: rng.range(0.03, 0.09),
        speed: rng.range(0.32, 0.68),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.85, 1.25),
        figureEight: false,
      });
      colorScratch.setHex(ladybugPalette[i % ladybugPalette.length]);
      this.ladybugMesh.setColorAt(i, colorScratch);
    }
    if (this.ladybugMesh.instanceColor) this.ladybugMesh.instanceColor.needsUpdate = true;

    // Fireflies (warm chartreuse & amber dusk/night lanterns over woods & waterways)
    const fireflyPalette = [0xd8ff66, 0xffe46b, 0xb8ff70, 0xffd054];
    this.fireflyMesh = new THREE.InstancedMesh(fireflyGeo, this.fireflyMat, fireflyCount);
    this.fireflyMesh.name = 'ambient_fireflies';
    this.fireflyMesh.frustumCulled = false;
    for (let i = 0; i < fireflyCount; i++) {
      const spot = i % 3 === 0 ? pickWaterSpot() : pickMeadowSpot();
      this.fireflyOrbits.push({
        anchorX: spot.x,
        anchorY: spot.y + rng.range(0.55, 2.6),
        anchorZ: spot.z,
        radiusX: rng.range(1.2, 3.6),
        radiusZ: rng.range(1.2, 3.6),
        bobAmp: rng.range(0.28, 0.68),
        speed: rng.range(0.28, 0.58),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.75, 1.35),
        figureEight: true,
      });
      colorScratch.setHex(fireflyPalette[i % fireflyPalette.length]);
      this.fireflyMesh.setColorAt(i, colorScratch);
    }
    if (this.fireflyMesh.instanceColor) this.fireflyMesh.instanceColor.needsUpdate = true;

    this.rootGroup.add(
      this.butterflyMesh,
      this.beeMesh,
      this.dragonflyMesh,
      this.ladybugMesh,
      this.fireflyMesh,
    );
    scene.add(this.rootGroup);
    this.update(0.016);
  }

  get counts(): AmbientCritterCounts {
    return {
      butterflies: this.butterflyOrbits.length,
      bees: this.beeOrbits.length,
      dragonflies: this.dragonflyOrbits.length,
      ladybugs: this.ladybugOrbits.length,
      fireflies: this.fireflyOrbits.length,
    };
  }

  getWarmupMaterials(): THREE.Material[] {
    return [
      this.butterflyMat,
      this.beeMat,
      this.dragonflyMat,
      this.ladybugMat,
      this.fireflyMat,
    ];
  }

  update(dt: number, sky?: SkyLightingState): void {
    this.elapsed += dt;
    const t = this.elapsed;
    this.shaderUniforms.uTime.value = t;

    const daylight = sky?.daylight ?? 0.85;
    const isWinter = this.world.season === 'winter';
    const isRainy = this.world.weather === 'storm' || this.world.weather === 'rain';

    // Daylight critters flourish in spring/summer/autumn daylight and rest at night or winter
    const seasonScale = isWinter ? 0 : this.world.season === 'autumn' ? 0.78 : 1.0;
    const dayActivity = THREE.MathUtils.smoothstep(daylight, 0.18, 0.42) * seasonScale * (isRainy ? 0.45 : 1.0);
    const showDayCritters = dayActivity > 0.04;

    this.butterflyMesh.visible = showDayCritters;
    this.beeMesh.visible = showDayCritters;
    this.dragonflyMesh.visible = showDayCritters;
    this.ladybugMesh.visible = showDayCritters;

    if (showDayCritters) {
      this.updateOrbitSwarm(this.butterflyMesh, this.butterflyOrbits, t, dayActivity, false, false);
      this.updateOrbitSwarm(this.beeMesh, this.beeOrbits, t, dayActivity, false, false);
      this.updateOrbitSwarm(this.dragonflyMesh, this.dragonflyOrbits, t, dayActivity, false, false);
      this.updateOrbitSwarm(this.ladybugMesh, this.ladybugOrbits, t, dayActivity, true, false);
    }

    // Fireflies awaken softly during twilight and night (dormant in winter & midday sun)
    const nightActivity = THREE.MathUtils.smoothstep(0.62 - daylight, 0.0, 0.42) * (isWinter ? 0 : 1.0);
    const showFireflies = nightActivity > 0.04;
    this.fireflyMesh.visible = showFireflies;
    this.fireflyMat.opacity = nightActivity * 0.92;
    if (showFireflies) {
      this.updateOrbitSwarm(this.fireflyMesh, this.fireflyOrbits, t, nightActivity, false, true);
    }
  }

  private updateOrbitSwarm(
    mesh: THREE.InstancedMesh,
    orbits: readonly CritterOrbit[],
    t: number,
    activityScale: number,
    groundHugging: boolean,
    pulseScale: boolean,
  ): void {
    const dummy = this.dummy;
    const terrain = this.world.terrain;

    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i];
      const ang = t * o.speed + o.phase;
      const sinA = Math.sin(ang);
      const cosA = Math.cos(ang);

      let x: number;
      let z: number;
      let vx: number;
      let vz: number;
      if (o.figureEight) {
        const sin2A = Math.sin(ang * 2);
        const cos2A = Math.cos(ang * 2);
        x = o.anchorX + sinA * o.radiusX;
        z = o.anchorZ + sin2A * o.radiusZ * 0.55;
        vx = cosA * o.radiusX;
        vz = cos2A * o.radiusZ * 1.1;
      } else {
        x = o.anchorX + cosA * o.radiusX;
        z = o.anchorZ + sinA * o.radiusZ;
        vx = -sinA * o.radiusX;
        vz = cosA * o.radiusZ;
      }

      let y: number;
      if (groundHugging) {
        const h = terrain.getHeightAt(x, z);
        y = Math.max(h, terrain.waterLevel) + 0.07 + Math.abs(Math.sin(ang * 3.0)) * o.bobAmp;
      } else {
        y = o.anchorY + Math.sin(ang * 1.7 + o.phase) * o.bobAmp;
      }

      dummy.position.set(x, y, z);
      dummy.rotation.set(
        groundHugging ? 0 : -Math.cos(ang * 1.7 + o.phase) * 0.14,
        Math.atan2(vx, vz),
        groundHugging ? 0 : Math.sin(ang * 2.3) * 0.12,
      );

      let sc = o.scale * (0.4 + 0.6 * activityScale);
      if (pulseScale) {
        const twinkle = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.4 + o.phase * 3.1), 2);
        sc *= twinkle;
      }
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.rootGroup.parent?.remove(this.rootGroup);
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
