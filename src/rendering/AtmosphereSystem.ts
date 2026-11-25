import * as THREE from 'three';
import type { DivineEffectVisual } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { SkyLightingState } from './WaterShader';

export const DIVINE_BEAM_HEIGHT = 2200;

export interface DivineBeamVisual {
  readonly group: THREE.Group;
  readonly outerMat: THREE.ShaderMaterial;
  readonly coreMat: THREE.ShaderMaterial;
  readonly ringMat: THREE.ShaderMaterial;
  readonly ringMesh: THREE.Mesh;
  readonly wallMat: THREE.ShaderMaterial;
  readonly wallMesh: THREE.Mesh;
  readonly haloMat: THREE.ShaderMaterial;
  readonly haloMeshA: THREE.Mesh;
  readonly haloMeshB: THREE.Mesh;
  readonly motesMat: THREE.ShaderMaterial;
  readonly motesPoints: THREE.Points;
  readonly glowLight: THREE.PointLight;
  readonly dispose: () => void;
}

/**
 * Creates GPU-animated particle attributes for ascending column embers and shockwave stardust
 * erupting outward along the expanding supernatural influence wave.
 */
function createDivineMotesGeometry(seed: number, count = 144): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const angles = new Float32Array(count);
  const phases = new Float32Array(count);
  const kinds = new Float32Array(count);
  const seeds = new Float32Array(count);

  let s = Math.floor(Math.abs(seed * 9301 + 49297)) % 233280;
  const next = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    angles[i] = next() * Math.PI * 2;
    phases[i] = next();
    // ~55% shockwave rim stardust sweeping across the land, ~45% helical embers soaring up the pillar
    kinds[i] = i < Math.floor(count * 0.55) ? 0 : 1;
    seeds[i] = next();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geo;
}

/**
 * Builds the awe-inspiring supernatural deity manifestation:
 * - Tall dual-layer volumetric heavenly light column extending far above camera overview
 * - Custom-shader celestial mandala & multi-pulse incandescent shockwave disc on the ground
 * - Rising volumetric aurora curtain wall riding the expanding shockwave perimeter
 * - Twin counter-rotating celestial armillary halo rings orbiting the pillar shaft
 * - GPU-animated spiral of ascending starlight embers & shockwave stardust
 * - Local supernatural illumination bathing nearby trees, terrain, and villages
 */
export function createDivineBeamVisual(
  effect: DivineEffectVisual,
  groundY: number,
  outerGeo: THREE.CylinderGeometry,
  innerGeo: THREE.CylinderGeometry,
  ringGeo: THREE.BufferGeometry,
  sharedWallGeo?: THREE.CylinderGeometry,
  sharedHaloGeo?: THREE.TorusGeometry,
): DivineBeamVisual {
  const group = new THREE.Group();
  group.position.set(effect.position.x, groundY, effect.position.z);

  const beamColor = new THREE.Color(effect.colorHex);
  const ownedGeos: THREE.BufferGeometry[] = [];

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

  // 1. Ground Celestial Mandala & Multi-Pulse Expanding Shockwave Disc
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_RING_VERTEX_SHADER,
    fragmentShader: DIVINE_RING_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uProgress: { value: 0.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.58;
  ringMesh.frustumCulled = false;
  ringMesh.renderOrder = 3;
  group.add(ringMesh);

  // 2. Rising Volumetric Aurora Shockwave Curtain riding the expanding perimeter
  let wallGeo = sharedWallGeo;
  if (!wallGeo) {
    wallGeo = new THREE.CylinderGeometry(1.08, 0.96, 1.0, 64, 1, true);
    wallGeo.translate(0, 0.5, 0);
    ownedGeos.push(wallGeo);
  }
  const wallMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_WALL_VERTEX_SHADER,
    fragmentShader: DIVINE_WALL_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.position.y = 0.35;
  wallMesh.frustumCulled = false;
  wallMesh.renderOrder = 3;
  group.add(wallMesh);

  // 3. Twin Counter-Rotating Celestial Armillary Halo Rings orbiting the lower light column
  let haloGeo = sharedHaloGeo;
  if (!haloGeo) {
    haloGeo = new THREE.TorusGeometry(1.0, 0.036, 10, 64);
    haloGeo.rotateX(Math.PI / 2);
    ownedGeos.push(haloGeo);
  }
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_HALO_VERTEX_SHADER,
    fragmentShader: DIVINE_HALO_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const haloMeshA = new THREE.Mesh(haloGeo, haloMat);
  haloMeshA.position.y = 4.2;
  haloMeshA.rotation.set(0.32, 0, 0.18);
  haloMeshA.scale.set(4.8, 4.8, 4.8);
  haloMeshA.frustumCulled = false;
  haloMeshA.renderOrder = 4;
  group.add(haloMeshA);

  const haloMeshB = new THREE.Mesh(haloGeo, haloMat);
  haloMeshB.position.y = 8.4;
  haloMeshB.rotation.set(-0.28, Math.PI * 0.5, -0.22);
  haloMeshB.scale.set(3.5, 3.5, 3.5);
  haloMeshB.frustumCulled = false;
  haloMeshB.renderOrder = 4;
  group.add(haloMeshB);

  // 4. GPU-Animated Ascending Divine Embers & Expanding Shockwave Stardust
  const motesGeo = createDivineMotesGeometry(effect.id * 17.3 + effect.position.x * 0.41 + effect.position.z * 0.29);
  ownedGeos.push(motesGeo);
  const motesMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_MOTES_VERTEX_SHADER,
    fragmentShader: DIVINE_MOTES_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: beamColor.clone() },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uWaveRadius: { value: 2.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motesPoints = new THREE.Points(motesGeo, motesMat);
  motesPoints.frustumCulled = false;
  motesPoints.renderOrder = 4;
  group.add(motesPoints);

  // 5. Dynamic Supernatural Ground & Canopy Illumination
  const glowLight = new THREE.PointLight(effect.colorHex, 0.0, Math.max(24, effect.radius * 2.4), 1.5);
  glowLight.position.set(0, 6.8, 0);
  group.add(glowLight);

  const dispose = (): void => {
    outerMat.dispose();
    coreMat.dispose();
    ringMat.dispose();
    wallMat.dispose();
    haloMat.dispose();
    motesMat.dispose();
    for (const g of ownedGeos) {
      g.dispose();
    }
  };

  return {
    group,
    outerMat,
    coreMat,
    ringMat,
    ringMesh,
    wallMat,
    wallMesh,
    haloMat,
    haloMeshA,
    haloMeshB,
    motesMat,
    motesPoints,
    glowLight,
    dispose,
  };
}

interface ActiveBeamMesh {
  readonly id: number;
  readonly visual: DivineBeamVisual;
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

const DIVINE_RING_VERTEX_SHADER = /* glsl */ `
  varying vec2 vLocalPos;
  void main() {
    vLocalPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DIVINE_RING_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vLocalPos;

  void main() {
    float r = length(vLocalPos);
    if (r > 1.0) discard;

    float ang = atan(vLocalPos.y, vLocalPos.x);
    float waveR = mix(0.08, 0.94, uProgress);

    // Organic swirling plasma turbulence distorting the shockwave edge
    float swirl =
      sin(ang * 6.0 + uTime * 1.45 - r * 9.5) * 0.012 +
      cos(ang * 11.0 - uTime * 2.15 + r * 14.5) * 0.007;
    float rw = r + swirl;

    // 1. Primary incandescent shockwave crest + luminous filamentous trailing wake
    float dWave = rw - waveR;
    float crest = exp(-dWave * dWave * 520.0) * 1.45;
    float wake = smoothstep(waveR - 0.32, waveR, rw) * (1.0 - smoothstep(waveR, waveR + 0.04, rw));
    float wakeFilaments = 0.58 + 0.42 * sin(ang * 16.0 - uTime * 3.4 + r * 28.0);
    float shockwave = crest + wake * wakeFilaments * 0.56;

    // 2. Resonant secondary & tertiary harmonic echo shockwaves pulsing outward
    float p2 = fract(uProgress * 1.9 + 0.36);
    float r2 = mix(0.06, 0.92, 1.0 - pow(1.0 - p2, 1.8));
    float echo2 = exp(-pow(rw - r2, 2.0) * 860.0) * sin(p2 * 3.14159265) * 0.78;

    float p3 = fract(uProgress * 1.9 + 0.72);
    float r3 = mix(0.06, 0.92, 1.0 - pow(1.0 - p3, 1.8));
    float echo3 = exp(-pow(rw - r3, 2.0) * 1080.0) * sin(p3 * 3.14159265) * 0.52;

    // 3. Counter-rotating celestial sacred mandala, astrolabe arcs & arcane rune band
    float insideWave = 1.0 - smoothstep(waveR - 0.045, waveR + 0.025, r);
    float ringA = exp(-pow(r - 0.27, 2.0) * 2400.0);
    float ringB = exp(-pow(r - 0.53, 2.0) * 2400.0);
    float ringC = exp(-pow(r - 0.78, 2.0) * 2200.0);

    float a1 = ang + uTime * 0.38;
    float a2 = ang - uTime * 0.29;
    float lotusR = 0.38 + 0.145 * cos(a1 * 6.0);
    float lotusArc = exp(-pow(r - lotusR, 2.0) * 1650.0) * 0.68;
    float starR = 0.64 + 0.12 * cos(a2 * 12.0);
    float starArc = exp(-pow(r - starR, 2.0) * 1850.0) * 0.58;

    float runeBand = smoothstep(0.29, 0.33, r) * (1.0 - smoothstep(0.47, 0.51, r));
    float runeGlyph =
      smoothstep(0.30, 0.72, sin(a2 * 24.0)) *
      smoothstep(0.10, 0.62, cos(a2 * 12.0 + r * 44.0));
    float outerTicks =
      smoothstep(0.75, 0.77, r) * (1.0 - smoothstep(0.82, 0.85, r)) *
      smoothstep(0.55, 0.85, sin(a1 * 36.0));
    float rays =
      pow(max(0.0, cos(a1 * 6.0)), 18.0) *
      smoothstep(0.08, 0.22, r) *
      (1.0 - smoothstep(0.74, 0.94, r));

    float mandala =
      (ringA * 0.55 + ringB * 0.52 + ringC * 0.42 + lotusArc + starArc +
       runeBand * runeGlyph * 0.58 + outerTicks * 0.45 + rays * 0.46) *
      insideWave;

    // 4. Radiant impact core halo where the heavenly column strikes the earth
    float coreHalo = exp(-r * r * 24.0) * 0.95;

    float outerFade = 1.0 - smoothstep(0.88, 1.0, r);
    float intensity = (shockwave + echo2 + echo3 + mandala + coreHalo) * outerFade;

    // Prismatic celestial tint: warm-white incandescent crest + iridescent spectral filigree
    vec3 spectral = mix(uColor * 0.65 + uColor.gbr * 0.35, vec3(0.88, 0.96, 1.0), 0.34);
    vec3 baseCol = mix(uColor, spectral, clamp((mandala + echo2 + echo3) * 0.75, 0.0, 0.72));
    float hotCore = clamp(crest * 0.72 + coreHalo * 0.65 + mandala * 0.28, 0.0, 1.0);
    vec3 finalCol = mix(baseCol, vec3(1.0, 0.99, 0.93), hotCore * 0.72);

    gl_FragColor = vec4(finalCol * 1.25, clamp(intensity * uOpacity, 0.0, 1.0));
  }
`;

const DIVINE_WALL_VERTEX_SHADER = /* glsl */ `
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

const DIVINE_WALL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float grazing = 1.0 - abs(dot(normalize(vWorldNormal), viewDir));
    float rimBoost = 0.42 + pow(grazing, 1.35) * 0.95;

    // Rising translucent aurora ribbons streaming skyward along the expanding perimeter
    float vFade = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.55);
    float baseFlame = exp(-vUv.y * 8.5) * 1.15;
    float curtainA = 0.5 + 0.5 * sin(vUv.x * 37.6991 + uTime * 1.6 + sin(vUv.y * 5.0 - uTime * 2.4) * 1.4);
    float curtainB = 0.5 + 0.5 * cos(vUv.x * 62.8318 - uTime * 2.3 + vUv.y * 9.0);
    float riseWave = 0.65 + 0.35 * sin(vUv.y * 18.0 - uTime * 5.8 + vUv.x * 12.5663);

    float energy = (vFade * (0.45 + 0.85 * curtainA * (0.55 + 0.45 * curtainB)) * riseWave + baseFlame) * rimBoost;
    vec3 spectral = mix(uColor, uColor.gbr * 0.4 + vec3(0.75, 0.92, 1.0) * 0.6, vUv.y * 0.48);
    vec3 col = mix(spectral, vec3(1.0, 0.99, 0.94), clamp(baseFlame * 0.72, 0.0, 0.85));
    gl_FragColor = vec4(col * 1.15, clamp(energy * uOpacity, 0.0, 1.0));
  }
`;

const DIVINE_HALO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DIVINE_HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    // Orbiting celestial beads & harmonic shimmer along the armillary halo
    float beads = pow(0.5 + 0.5 * sin(vUv.x * 75.3982 - uTime * 4.2), 2.2);
    float pulse = 0.62 + 0.38 * sin(vUv.x * 18.8495 + uTime * 2.6);
    float glow = (0.48 + 0.72 * beads) * pulse;
    vec3 col = mix(uColor, vec3(1.0, 0.99, 0.94), 0.35 + beads * 0.55);
    gl_FragColor = vec4(col * 1.35, clamp(glow * uOpacity, 0.0, 1.0));
  }
`;

const DIVINE_MOTES_VERTEX_SHADER = /* glsl */ `
  attribute float aAngle;
  attribute float aPhase;
  attribute float aKind;
  attribute float aSeed;

  uniform float uTime;
  uniform float uWaveRadius;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vTwinkle;

  void main() {
    float cycle = fract(aPhase + uTime * mix(0.28, 0.44, aSeed));
    vec3 pos;
    if (aKind < 0.5) {
      // Shockwave rim stardust lifting softly from the earth along the expanding perimeter
      float ang = aAngle + uTime * (0.22 + aSeed * 0.25) * (aSeed > 0.5 ? 1.0 : -1.0);
      float rad = uWaveRadius * (0.82 + aSeed * 0.24);
      float y = 0.45 + pow(cycle, 0.85) * (4.2 + aSeed * 6.5);
      pos = vec3(cos(ang) * rad, y, sin(ang) * rad);
    } else {
      // Helical celestial embers spiraling heavenward around the divine column
      float ang = aAngle + uTime * (0.85 + aSeed * 0.65) + cycle * 4.5;
      float rad = mix(2.2, 5.8, aSeed) * (1.0 - cycle * 0.22);
      float y = 0.6 + cycle * (28.0 + aSeed * 36.0);
      pos = vec3(cos(ang) * rad, y, sin(ang) * rad);
    }

    vAlpha = sin(cycle * 3.14159265) * uOpacity;
    vTwinkle = 0.6 + 0.4 * sin(uTime * (6.0 + aSeed * 6.0) + aAngle * 3.0);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float baseSize = mix(11.0, 22.0, aSeed) * (0.65 + 0.35 * vTwinkle);
    gl_PointSize = clamp(baseSize * (62.0 / max(8.0, -mvPos.z)), 2.5, 28.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const DIVINE_MOTES_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vTwinkle;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) discard;

    // Soft luminous orb + delicate 4-point celestial star glint
    float core = exp(-d * d * 28.0);
    float glintX = exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 6.5);
    float glintY = exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 6.5);
    float star = core + (glintX + glintY) * 0.48 * vTwinkle;

    vec3 col = mix(uColor, vec3(1.0, 0.99, 0.95), clamp(core * 0.85, 0.0, 1.0));
    gl_FragColor = vec4(col * 1.3, clamp(star * vAlpha, 0.0, 1.0));
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
  private readonly beamRingGeo: THREE.CircleGeometry;
  private readonly beamWallGeo: THREE.CylinderGeometry;
  private readonly beamHaloGeo: THREE.TorusGeometry;
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
    this.beamRingGeo = new THREE.CircleGeometry(1.0, 72);
    this.beamRingGeo.rotateX(-Math.PI / 2);
    this.beamWallGeo = new THREE.CylinderGeometry(1.08, 0.96, 1.0, 64, 1, true);
    this.beamWallGeo.translate(0, 0.5, 0);
    this.beamHaloGeo = new THREE.TorusGeometry(1.0, 0.036, 10, 64);
    this.beamHaloGeo.rotateX(Math.PI / 2);

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
      this.beamWallGeo,
      this.beamHaloGeo,
    );
    this.divineGroup.add(visual.group);
    this.activeBeams.push({
      id: effect.id,
      visual,
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

    // 4. Divine beams, celestial mandala shockwaves, aurora curtains, halos & stardust motes
    for (let i = this.activeBeams.length - 1; i >= 0; i--) {
      const beam = this.activeBeams[i];
      const v = beam.visual;
      const age = world.elapsedSeconds - beam.createdAt;
      const pct = age / beam.duration;
      if (pct >= 1) {
        this.divineGroup.remove(v.group);
        v.dispose();
        this.activeBeams.splice(i, 1);
        continue;
      }
      const t = world.elapsedSeconds;
      const fade = Math.sin(pct * Math.PI);
      const burstFade = Math.sin(Math.pow(pct, 0.72) * Math.PI);
      const ease = 1 - Math.pow(1 - pct, 2.15);

      v.outerMat.uniforms.uOpacity.value = fade * 0.36;
      v.outerMat.uniforms.uTime.value = t;
      v.coreMat.uniforms.uOpacity.value = fade * 0.56;
      v.coreMat.uniforms.uTime.value = t;

      // Stationary full-influence ground disc with GPU-driven expanding shockwaves & sharp sacred mandala
      const discRadius = Math.max(8, beam.maxRadius * 1.35);
      v.ringMesh.scale.set(discRadius, 1, discRadius);
      v.ringMat.uniforms.uOpacity.value = burstFade * 0.92;
      v.ringMat.uniforms.uTime.value = t;
      v.ringMat.uniforms.uProgress.value = ease;

      // Volumetric aurora shockwave wall locked to the exact expanding shockwave crest on the ground
      const waveWorldRadius = discRadius * (0.08 + 0.86 * ease);
      const wallHeight = 4.2 + 5.8 * fade;
      v.wallMesh.scale.set(waveWorldRadius, wallHeight, waveWorldRadius);
      v.wallMat.uniforms.uOpacity.value = burstFade * 0.62;
      v.wallMat.uniforms.uTime.value = t;

      // Twin counter-rotating celestial armillary halos hovering & precessing around the lower shaft
      v.haloMat.uniforms.uOpacity.value = fade * 0.88;
      v.haloMat.uniforms.uTime.value = t;
      const haloScaleA = 4.2 + ease * 4.4;
      v.haloMeshA.scale.set(haloScaleA, haloScaleA, haloScaleA);
      v.haloMeshA.position.y = 3.8 + Math.sin(t * 1.4) * 0.55;
      v.haloMeshA.rotation.y = t * 0.65;
      v.haloMeshA.rotation.x = 0.32 + Math.sin(t * 0.8) * 0.14;

      const haloScaleB = 3.0 + ease * 3.4;
      v.haloMeshB.scale.set(haloScaleB, haloScaleB, haloScaleB);
      v.haloMeshB.position.y = 8.2 + Math.cos(t * 1.2) * 0.65;
      v.haloMeshB.rotation.y = -t * 0.82;
      v.haloMeshB.rotation.z = -0.24 + Math.cos(t * 0.9) * 0.16;

      // GPU-driven shockwave stardust & ascending helical embers
      v.motesMat.uniforms.uOpacity.value = burstFade * 0.95;
      v.motesMat.uniforms.uTime.value = t;
      v.motesMat.uniforms.uWaveRadius.value = waveWorldRadius;

      // Supernatural local illumination bathing terrain, trees, and villages in divine light
      v.glowLight.intensity = fade * 22.0;
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
      this.divineGroup.remove(beam.visual.group);
      beam.visual.dispose();
    }
    this.activeBeams.length = 0;
    this.beamOuterGeo.dispose();
    this.beamInnerGeo.dispose();
    this.beamRingGeo.dispose();
    this.beamWallGeo.dispose();
    this.beamHaloGeo.dispose();
    this.envRenderTarget?.dispose();
    this.pmremGenerator.dispose();
  }
}
