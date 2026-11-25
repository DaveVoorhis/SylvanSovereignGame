import * as THREE from 'three';
import type { DivineEffectVisual } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { SkyLightingState } from './WaterShader';

export const DIVINE_BEAM_HEIGHT = 2200;

export interface DivineBeamVisual {
  readonly group: THREE.Group;
  readonly outerMat: THREE.ShaderMaterial;
  readonly coreMat: THREE.ShaderMaterial;
  readonly ringMat: THREE.MeshBasicMaterial;
  readonly ringMesh: THREE.Mesh;
}

/** Builds the tall dual-layer volumetric heavenly light beam & ground sacred ring. */
export function createDivineBeamVisual(
  effect: DivineEffectVisual,
  groundY: number,
  outerGeo: THREE.CylinderGeometry,
  innerGeo: THREE.CylinderGeometry,
  ringGeo: THREE.RingGeometry,
): DivineBeamVisual {
  const group = new THREE.Group();
  group.position.set(effect.position.x, groundY, effect.position.z);

  const beamColor = new THREE.Color(effect.colorHex);
  const outerMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_BEAM_VERTEX_SHADER,
    fragmentShader: DIVINE_BEAM_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uCoreWeight: { value: 0.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const outerBeam = new THREE.Mesh(outerGeo, outerMat);
  outerBeam.position.y = DIVINE_BEAM_HEIGHT * 0.5 - 2.0;
  outerBeam.frustumCulled = false;
  outerBeam.renderOrder = 3;
  group.add(outerBeam);

  const coreMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_BEAM_VERTEX_SHADER,
    fragmentShader: DIVINE_BEAM_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uCoreWeight: { value: 1.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const coreBeam = new THREE.Mesh(innerGeo, coreMat);
  coreBeam.position.y = DIVINE_BEAM_HEIGHT * 0.5 - 2.0;
  coreBeam.frustumCulled = false;
  coreBeam.renderOrder = 3;
  group.add(coreBeam);

  const ringMat = new THREE.MeshBasicMaterial({
    color: effect.colorHex,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.65;
  ringMesh.renderOrder = 3;
  group.add(ringMesh);

  return { group, outerMat, coreMat, ringMat, ringMesh };
}

interface ActiveBeamMesh {
  readonly id: number;
  readonly group: THREE.Group;
  readonly outerMat: THREE.ShaderMaterial;
  readonly coreMat: THREE.ShaderMaterial;
  readonly ringMat: THREE.MeshBasicMaterial;
  readonly ringMesh: THREE.Mesh;
  readonly createdAt: number;
  readonly duration: number;
  readonly maxRadius: number;
}

const DIVINE_BEAM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const DIVINE_BEAM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uCoreWeight;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Soft cylindrical edge falloff so the heavenly beam feels volumetric, never hard-edged
    float facing = abs(dot(normalize(vWorldNormal), viewDir));
    float edgeSoft = pow(facing, mix(2.35, 1.35, uCoreWeight));

    // Ethereal vertical light curtains & gentle supernatural shimmer descending from above
    float ribbon = 0.84 + 0.16 * sin(vUv.x * 25.1327 + uTime * 1.15) * sin(vUv.y * 28.0 - uTime * 2.8);
    float shimmer = 0.90 + 0.10 * sin(vUv.y * 65.0 + uTime * 4.2);

    // Seamless atmospheric dissolve very high in the sky + radiant bloom where beam meets earth
    float topFade = 1.0 - smoothstep(0.72, 1.0, vUv.y);
    float groundBloom = 1.0 + smoothstep(0.06, 0.0, vUv.y) * 0.85;
    float bottomSoft = smoothstep(0.0, 0.004, vUv.y);

    float alpha = uOpacity * edgeSoft * ribbon * shimmer * topFade * bottomSoft * groundBloom;
    vec3 col = mix(uColor, vec3(1.0, 0.99, 0.95), uCoreWeight * 0.45 * pow(facing, 2.2));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uStarIntensity;
  varying vec3 vWorldDirection;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float h = clamp(dir.y, 0.0, 1.0);
    // Soft luminous atmospheric horizon band fading cleanly into the zenith
    vec3 sky = mix(uHorizonColor, uTopColor, pow(h, 0.58));

    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float sunGlow = pow(sunDot, 12.0) * 0.42 + pow(sunDot, 220.0) * 1.45;
    sky += uSunColor * sunGlow;

    if (uStarIntensity > 0.01 && dir.y > 0.08) {
      vec3 starCell = floor(dir * 210.0);
      float starVal = hash(starCell);
      if (starVal > 0.994) {
        sky += vec3(0.85, 0.92, 1.0) * uStarIntensity * smoothstep(0.08, 0.45, dir.y);
      }
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * Manages photorealistic-storybook atmospheric lighting, infinite-horizon sky dome,
 * seasonal & day/night transitions, volumetric horizon haze, softly glowing fireflies,
 * dreamy blossom/pollen/snow weather particles, and divine intervention light beams.
 */
export class AtmosphereSystem {
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly fog: THREE.FogExp2;

  private readonly skyMesh: THREE.Mesh;
  private readonly skyUniforms: {
    uTopColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uSunDirection: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uStarIntensity: { value: number };
  };

  private readonly weatherPoints: THREE.Points;
  private readonly weatherPositions: Float32Array;
  private readonly weatherMat: THREE.PointsMaterial;

  private readonly fireflyPoints: THREE.Points;
  private readonly fireflyBase: Float32Array;
  private readonly fireflyMat: THREE.PointsMaterial;

  private readonly divineGroup = new THREE.Group();
  private readonly activeBeams: ActiveBeamMesh[] = [];
  private readonly beamOuterGeo: THREE.CylinderGeometry;
  private readonly beamInnerGeo: THREE.CylinderGeometry;
  private readonly beamRingGeo: THREE.RingGeometry;
  private readonly pmremGenerator: THREE.PMREMGenerator;
  private envScene: THREE.Scene;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private envRefreshTimer = 0;
  private readonly lightDirState = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
  private currentDaylight = 1.0;
  private currentWindStrength = 0.25;
  private currentIsWinter = false;
  private readonly shadowTexelStep: number;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadowMapSize: number,
    softParticleTex?: THREE.Texture,
  ) {
    this.fog = new THREE.FogExp2(0xc4dac9, 0.00068);
    this.scene.fog = this.fog;

    // Infinite-horizon Procedural Sky Dome (tracks camera XZ each frame)
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x2e64a3) },
      uHorizonColor: { value: new THREE.Color(0xc7dccb) },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1cf) },
      uStarIntensity: { value: 0 },
    };

    const skyGeo = new THREE.SphereGeometry(5800, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    // PMREM environment generator for realistic PBR reflections
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      skyMat,
    );
    this.envScene.add(envDome);

    // Key Sun / Moon Directional Light with crisp soft shadows
    this.sunLight = new THREE.DirectionalLight(0xfff3d8, 2.8);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 880;
    const d = 175;
    this.shadowTexelStep = (d * 2) / Math.max(256, shadowMapSize);
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Canopy bounce hemisphere light
    this.hemiLight = new THREE.HemisphereLight(0xaad1f0, 0x3a522c, 0.9);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0x2c3b32, 0.28);
    this.scene.add(this.ambientLight);

    // Weather particles distributed in a wide circular canopy
    const weatherCount = 1500;
    this.weatherPositions = new Float32Array(weatherCount * 3);
    for (let i = 0; i < weatherCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 128;
      this.weatherPositions[i * 3] = Math.cos(a) * r;
      this.weatherPositions[i * 3 + 1] = Math.random() * 68;
      this.weatherPositions[i * 3 + 2] = Math.sin(a) * r;
    }
    const weatherGeo = new THREE.BufferGeometry();
    weatherGeo.setAttribute('position', new THREE.BufferAttribute(this.weatherPositions, 3));
    this.weatherMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.45,
      map: softParticleTex ?? null,
      transparent: true,
      opacity: 0.65,
      alphaTest: 0.01,
      depthWrite: false,
    });
    this.weatherPoints = new THREE.Points(weatherGeo, this.weatherMat);
    this.weatherPoints.frustumCulled = false;
    this.scene.add(this.weatherPoints);

    // Soft glowing golden fireflies hovering above moss and water
    const fireflyCount = 260;
    this.fireflyBase = new Float32Array(fireflyCount * 3);
    const fireflyPos = new Float32Array(fireflyCount * 3);
    for (let i = 0; i < fireflyCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 96;
      const fx = Math.cos(a) * r;
      const fy = 1.4 + Math.random() * 6.8;
      const fz = Math.sin(a) * r;
      this.fireflyBase[i * 3] = fx;
      this.fireflyBase[i * 3 + 1] = fy;
      this.fireflyBase[i * 3 + 2] = fz;
      fireflyPos[i * 3] = fx;
      fireflyPos[i * 3 + 1] = fy;
      fireflyPos[i * 3 + 2] = fz;
    }
    const fireflyGeo = new THREE.BufferGeometry();
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xffe885,
      size: 0.72,
      map: softParticleTex ?? null,
      transparent: true,
      opacity: 0.0,
      alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fireflyPoints = new THREE.Points(fireflyGeo, this.fireflyMat);
    this.fireflyPoints.frustumCulled = false;
    this.scene.add(this.fireflyPoints);

    // Shared supernatural divine beam geometries stretching high into the heavens
    this.beamOuterGeo = new THREE.CylinderGeometry(3.8, 5.4, DIVINE_BEAM_HEIGHT, 28, 1, true);
    this.beamInnerGeo = new THREE.CylinderGeometry(1.5, 2.1, DIVINE_BEAM_HEIGHT, 24, 1, true);
    this.beamRingGeo = new THREE.RingGeometry(0.85, 1.0, 48);
    this.beamRingGeo.rotateX(-Math.PI / 2);

    this.scene.add(this.divineGroup);
    this.refreshEnvironmentMap();
  }

  spawnDivineVisual(effect: DivineEffectVisual, groundY: number): void {
    const visual = createDivineBeamVisual(
      effect,
      groundY,
      this.beamOuterGeo,
      this.beamInnerGeo,
      this.beamRingGeo,
    );
    this.divineGroup.add(visual.group);
    this.activeBeams.push({
      id: effect.id,
      group: visual.group,
      outerMat: visual.outerMat,
      coreMat: visual.coreMat,
      ringMat: visual.ringMat,
      ringMesh: visual.ringMesh,
      createdAt: effect.createdAt,
      duration: effect.duration,
      maxRadius: effect.radius,
    });
  }

  update(world: WorldState, dt: number, camera?: THREE.Camera, focusTarget?: THREE.Vector3): void {
    let focusX = 0;
    let focusZ = 0;
    if (camera) {
      // Keep the sky dome centered on the viewer so the sky sits mathematically at infinity
      this.skyMesh.position.set(camera.position.x, 0, camera.position.z);
      focusX = focusTarget ? focusTarget.x : camera.position.x;
      focusZ = focusTarget ? focusTarget.z : camera.position.z;
    }
    // Keep ambient weather particles & fireflies centered on the observer's region across the larger world
    this.weatherPoints.position.set(focusX, 0, focusZ);
    this.fireflyPoints.position.set(focusX, 0, focusZ);

    // 1. Sun & Moon orbit
    const angle = (world.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle) * 0.85;
    const sunZ = 0.42;

    const daylight = THREE.MathUtils.clamp((sunY + 0.16) / 0.55, 0, 1);
    const goldenHour = THREE.MathUtils.clamp(1 - Math.abs(sunY - 0.1) * 4.5, 0, 1);

    const lightDir = new THREE.Vector3(sunX, Math.max(0.18, Math.abs(sunY)), sunZ).normalize();
    // Anchor shadow frustum to camera focus snapped to shadow texel increments (crisp shadows everywhere!)
    const snap = this.shadowTexelStep * 4;
    const shadowFocusX = Math.round(focusX / snap) * snap;
    const shadowFocusZ = Math.round(focusZ / snap) * snap;
    this.sunLight.target.position.set(shadowFocusX, 0, shadowFocusZ);
    this.sunLight.position.set(shadowFocusX, 0, shadowFocusZ).addScaledVector(lightDir, 280);
    this.lightDirState.copy(lightDir);
    this.currentDaylight = daylight;
    this.currentIsWinter = world.season === 'winter';
    const targetWind =
      world.weather === 'storm'
        ? 1.0
        : world.weather === 'rain' || world.weather === 'blossom'
          ? 0.58
          : 0.24;
    this.currentWindStrength += (targetWind - this.currentWindStrength) * Math.min(1, dt * 2.0);
    this.skyUniforms.uSunDirection.value.set(sunX, sunY, sunZ).normalize();

    // Sky & fog colors across day, dusk, night, and weather
    const topDay = new THREE.Color(world.season === 'winter' ? 0x5c7c9c : 0x2a619e);
    const topNight = new THREE.Color(0x070d1a);
    const horizDay = new THREE.Color(
      world.weather === 'storm'
        ? 0x56626a
        : world.season === 'autumn'
          ? 0xd8cdb8
          : 0xc8dece,
    );
    const horizGold = new THREE.Color(0xf09c59);
    const horizNight = new THREE.Color(0x132033);

    this.skyUniforms.uTopColor.value.copy(topNight).lerp(topDay, daylight);
    this.skyUniforms.uHorizonColor.value
      .copy(horizNight)
      .lerp(horizDay, daylight)
      .lerp(horizGold, goldenHour * 0.72);
    this.skyUniforms.uSunColor.value
      .setHex(0xfff4d6)
      .lerp(new THREE.Color(0xff944d), goldenHour * 0.85);
    this.skyUniforms.uStarIntensity.value = THREE.MathUtils.clamp(1 - daylight * 1.6, 0, 1);

    // Directional light intensity & color
    const stormDim = world.weather === 'storm' ? 0.52 : world.weather === 'rain' ? 0.72 : 1.0;
    const moonTint = new THREE.Color(0x6d92c4);
    const sunTint = new THREE.Color(0xfff1d2).lerp(new THREE.Color(0xffa057), goldenHour * 0.78);
    this.sunLight.color.copy(moonTint).lerp(sunTint, daylight);
    this.sunLight.intensity = (0.48 + daylight * 2.75) * stormDim;

    this.hemiLight.intensity = (0.3 + daylight * 0.74) * stormDim;
    this.hemiLight.color.copy(this.skyUniforms.uHorizonColor.value);
    this.hemiLight.groundColor.setHex(world.season === 'winter' ? 0x62707a : 0x384d2a);

    this.fog.color.copy(this.skyUniforms.uHorizonColor.value);
    const baseFog =
      world.weather === 'mist'
        ? 0.0056
        : world.weather === 'storm'
          ? 0.0042
          : world.weather === 'rain'
            ? 0.0028
            : 0.00068;
    // Relax atmospheric haze smoothly when zoomed high out to the country-map Overview
    const camY = camera ? camera.position.y : 30;
    const altitudeClear = 1 - THREE.MathUtils.smoothstep(camY, 120, 620) * 0.74;
    const targetFog = baseFog * altitudeClear;
    this.fog.density += (targetFog - this.fog.density) * Math.min(1, dt * 1.8);

    // Periodically refresh PMREM environment map for accurate sky reflections on water/stone
    this.envRefreshTimer -= dt;
    if (this.envRefreshTimer <= 0) {
      this.envRefreshTimer = 3.0;
      this.refreshEnvironmentMap();
    }

    // 2. Weather particles
    this.updateWeatherParticles(world, dt);

    // 3. Soft glowing fireflies (present softly at dusk/golden hour and radiant at night!)
    const nightAmt = Math.max(1 - daylight, goldenHour * 0.35);
    const twinkle = 0.82 + Math.sin(world.elapsedSeconds * 3.1) * 0.18;
    this.fireflyMat.opacity = Math.max(0, nightAmt * 0.92 * twinkle - (world.weather === 'storm' ? 0.5 : 0));
    if (this.fireflyMat.opacity > 0.02) {
      const posAttr = this.fireflyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = world.elapsedSeconds;
      for (let i = 0; i < posAttr.count; i++) {
        const bx = this.fireflyBase[i * 3];
        const by = this.fireflyBase[i * 3 + 1];
        const bz = this.fireflyBase[i * 3 + 2];
        posAttr.setXYZ(
          i,
          bx + Math.sin(t * 0.7 + i) * 1.8,
          by + Math.sin(t * 1.3 + i * 1.7) * 0.65,
          bz + Math.cos(t * 0.6 + i * 1.3) * 1.8,
        );
      }
      posAttr.needsUpdate = true;
    }

    // 4. Divine beams & sacred rings
    for (let i = this.activeBeams.length - 1; i >= 0; i--) {
      const beam = this.activeBeams[i];
      const age = world.elapsedSeconds - beam.createdAt;
      const pct = age / beam.duration;
      if (pct >= 1) {
        this.divineGroup.remove(beam.group);
        beam.outerMat.dispose();
        beam.coreMat.dispose();
        beam.ringMat.dispose();
        this.activeBeams.splice(i, 1);
        continue;
      }
      const fade = Math.sin(pct * Math.PI);
      beam.outerMat.uniforms.uOpacity.value = fade * 0.34;
      beam.outerMat.uniforms.uTime.value = world.elapsedSeconds;
      beam.coreMat.uniforms.uOpacity.value = fade * 0.52;
      beam.coreMat.uniforms.uTime.value = world.elapsedSeconds;
      beam.ringMat.opacity = (1 - pct) * 0.7;
      const scale = 2 + pct * beam.maxRadius;
      beam.ringMesh.scale.set(scale, 1, scale);
    }
  }

  private updateWeatherParticles(world: WorldState, dt: number): void {
    const posAttr = this.weatherPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    let fallSpeed = 1.2;
    let windX = 0.6;
    let targetOpacity = 0.28;

    if (world.weather === 'rain' || world.weather === 'storm') {
      fallSpeed = world.weather === 'storm' ? 28 : 18;
      windX = world.weather === 'storm' ? 7 : 2.5;
      this.weatherMat.color.setHex(0xbcd3e6);
      this.weatherMat.size = 0.28;
      targetOpacity = 0.65;
    } else if (world.weather === 'snow') {
      fallSpeed = 3.2;
      windX = 1.4;
      this.weatherMat.color.setHex(0xf4f9ff);
      this.weatherMat.size = 0.52;
      targetOpacity = 0.82;
    } else if (world.weather === 'blossom') {
      fallSpeed = 1.8;
      windX = 1.8;
      this.weatherMat.color.setHex(0xffc9dc);
      this.weatherMat.size = 0.54;
      targetOpacity = 0.8;
    } else {
      fallSpeed = 0.42;
      windX = 0.5;
      this.weatherMat.color.setHex(0xfff2c2);
      this.weatherMat.size = 0.38;
      targetOpacity = world.weather === 'sunbeams' ? 0.55 : 0.24;
    }

    this.weatherMat.opacity += (targetOpacity - this.weatherMat.opacity) * Math.min(1, dt * 2.5);

    const wrapRadius = 128;
    for (let i = 0; i < posAttr.count; i++) {
      let x = this.weatherPositions[i * 3] + windX * dt;
      let y = this.weatherPositions[i * 3 + 1] - fallSpeed * dt;
      let z = this.weatherPositions[i * 3 + 2] + Math.sin(world.elapsedSeconds + i) * 0.28 * dt;

      if (y < 0) y = 68;
      const rSq = x * x + z * z;
      if (rSq > wrapRadius * wrapRadius) {
        const inv = wrapRadius / Math.sqrt(rSq);
        x = -x * inv * 0.94;
        z = -z * inv * 0.94;
      }

      this.weatherPositions[i * 3] = x;
      this.weatherPositions[i * 3 + 1] = y;
      this.weatherPositions[i * 3 + 2] = z;
    }
    posAttr.needsUpdate = true;
  }

  private refreshEnvironmentMap(): void {
    const next = this.pmremGenerator.fromScene(this.envScene, 0.04);
    if (this.envRenderTarget) {
      this.envRenderTarget.dispose();
    }
    this.envRenderTarget = next;
    this.scene.environment = next.texture;
  }

  getSkyLightingState(): SkyLightingState {
    return {
      sunDirection: this.lightDirState,
      sunColor: this.skyUniforms.uSunColor.value,
      skyTopColor: this.skyUniforms.uTopColor.value,
      skyHorizonColor: this.skyUniforms.uHorizonColor.value,
      fogColor: this.fog.color,
      fogDensity: this.fog.density,
      daylight: this.currentDaylight,
      windStrength: this.currentWindStrength,
      isWinter: this.currentIsWinter,
    };
  }

  dispose(): void {
    this.skyMesh.geometry.dispose();
    (this.skyMesh.material as THREE.Material).dispose();
    this.weatherPoints.geometry.dispose();
    this.weatherMat.dispose();
    this.fireflyPoints.geometry.dispose();
    this.fireflyMat.dispose();
    for (const beam of this.activeBeams) {
      this.divineGroup.remove(beam.group);
      beam.outerMat.dispose();
      beam.coreMat.dispose();
      beam.ringMat.dispose();
    }
    this.activeBeams.length = 0;
    this.beamOuterGeo.dispose();
    this.beamInnerGeo.dispose();
    this.beamRingGeo.dispose();
    this.envRenderTarget?.dispose();
    this.pmremGenerator.dispose();
  }
}
