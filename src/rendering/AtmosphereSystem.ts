import * as THREE from 'three';
import type { DivineEffectVisual } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { SkyLightingState } from './WaterShader';

export const DIVINE_BEAM_HEIGHT = 2200;

export interface StainedGlassPalette {
  readonly primary: THREE.Color;
  readonly jewelB: THREE.Color;
  readonly jewelC: THREE.Color;
  readonly jewelD: THREE.Color;
}

/**
 * Derives a luminous four-jewel cathedral stained-glass palette anchored to the divine event's
 * signature hue, pairing it with harmonious sapphire/emerald, rose/amethyst, and sunlit gold
 * companion tones so every manifestation radiates translucent polychromatic light.
 */
export function deriveStainedGlassPalette(primaryHex: number): StainedGlassPalette {
  const primary = new THREE.Color(primaryHex);
  const hsl = { h: 0, s: 0, l: 0 };
  primary.getHSL(hsl);

  const sat = Math.max(0.76, Math.min(0.94, hsl.s + 0.14));
  const jewelB = new THREE.Color().setHSL((hsl.h + 0.29) % 1, sat, 0.58);
  const jewelC = new THREE.Color().setHSL((hsl.h + 0.58) % 1, Math.min(0.95, sat + 0.04), 0.56);
  const jewelD = new THREE.Color().setHSL((hsl.h + 0.78) % 1, sat, 0.62);

  return { primary, jewelB, jewelC, jewelD };
}

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
  readonly palette: StainedGlassPalette;
  readonly dispose: () => void;
}

export interface DivineDepthUniforms {
  uSceneDepth: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uHasSceneDepth: { value: number };
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
  sharedDepthUniforms?: DivineDepthUniforms,
): DivineBeamVisual {
  const group = new THREE.Group();
  group.position.set(effect.position.x, groundY, effect.position.z);

  const palette = deriveStainedGlassPalette(effect.colorHex);
  const ownedGeos: THREE.BufferGeometry[] = [];
  const depthUniforms: DivineDepthUniforms = sharedDepthUniforms ?? {
    uSceneDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uHasSceneDepth: { value: 0.0 },
  };

  const outerMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_BEAM_VERTEX_SHADER,
    fragmentShader: DIVINE_BEAM_FRAGMENT_SHADER,
    uniforms: {
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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

  // 1. Ground Stained-Glass Rose-Window Light Projection & Polychromatic Shockwave Disc
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: DIVINE_RING_VERTEX_SHADER,
    fragmentShader: DIVINE_RING_FRAGMENT_SHADER,
    uniforms: {
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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

  // 2. Rising Translucent Stained-Glass Clerestory Aurora Curtain riding the expanding perimeter
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
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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

  // 3. Twin Counter-Rotating Prismatic Armillary Halo Rings orbiting the lower light column
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
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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
      ...depthUniforms,
      uColor: { value: palette.primary.clone() },
      uGlassB: { value: palette.jewelB.clone() },
      uGlassC: { value: palette.jewelC.clone() },
      uGlassD: { value: palette.jewelD.clone() },
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
    palette,
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
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uHasSceneDepth;
  uniform vec3 uColor;
  uniform vec3 uGlassB;
  uniform vec3 uGlassC;
  uniform vec3 uGlassD;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uCoreWeight;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  vec3 sampleCathedralGlass(float phase, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    float p = fract(phase) * 4.0;
    if (p < 1.0) return mix(c0, c1, smoothstep(0.08, 0.92, p));
    if (p < 2.0) return mix(c1, c2, smoothstep(0.08, 0.92, p - 1.0));
    if (p < 3.0) return mix(c2, c3, smoothstep(0.08, 0.92, p - 2.0));
    return mix(c3, c0, smoothstep(0.08, 0.92, p - 3.0));
  }

  void main() {
    if (uHasSceneDepth > 0.5) {
      float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).x;
      if (gl_FragCoord.z > sceneDepth) discard;
    }
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Soft cylindrical edge falloff so the heavenly beam feels volumetric, never hard-edged
    float facing = abs(dot(normalize(vWorldNormal), viewDir));
    float edgeSoft = pow(facing, mix(2.35, 1.35, uCoreWeight));

    // Ethereal vertical light curtains & gentle supernatural shimmer descending from above
    float ribbon = 0.84 + 0.16 * sin(vUv.x * 25.1327 + uTime * 1.15) * sin(vUv.y * 28.0 - uTime * 2.8);
    float shimmer = 0.90 + 0.10 * sin(vUv.y * 65.0 + uTime * 4.2);

    // Seamless atmospheric dissolve very high in the sky + radiant bloom where beam meets earth
    float topFade = 1.0 - smoothstep(0.72, 1.0, vUv.y);
    float groundBloom = 1.0 + smoothstep(0.06, 0.0, vUv.y) * 0.65;
    float bottomSoft = smoothstep(0.0, 0.004, vUv.y);

    // Translucent stained-glass chromatic light shafts drifting down the outer heavenly veil
    float glassPhase = vUv.x * 2.0 + vUv.y * 0.45 - uTime * 0.06;
    vec3 glassRibbon = sampleCathedralGlass(glassPhase, uColor, uGlassD, uGlassB, uGlassC);
    vec3 outerTint = mix(uColor, glassRibbon, 0.58 * (1.0 - uCoreWeight));

    float alpha = uOpacity * edgeSoft * ribbon * shimmer * topFade * bottomSoft * groundBloom;
    vec3 col = mix(outerTint, vec3(1.0, 0.98, 0.92), uCoreWeight * 0.42 * pow(facing, 2.2));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.78));
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
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uHasSceneDepth;
  uniform vec3 uColor;
  uniform vec3 uGlassB;
  uniform vec3 uGlassC;
  uniform vec3 uGlassD;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vLocalPos;

  vec3 sampleRoseGlass(float phase, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    float p = fract(phase) * 4.0;
    if (p < 1.0) return mix(c0, c1, smoothstep(0.14, 0.86, p));
    if (p < 2.0) return mix(c1, c2, smoothstep(0.14, 0.86, p - 1.0));
    if (p < 3.0) return mix(c2, c3, smoothstep(0.14, 0.86, p - 2.0));
    return mix(c3, c0, smoothstep(0.14, 0.86, p - 3.0));
  }

  void main() {
    if (uHasSceneDepth > 0.5) {
      float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).x;
      if (gl_FragCoord.z > sceneDepth + 0.000015) discard;
    }
    float r = length(vLocalPos);
    if (r > 1.0) discard;

    float ang = atan(vLocalPos.y, vLocalPos.x);
    float normAng = ang * 0.15915494 + 0.5;
    float waveR = mix(0.08, 0.94, uProgress);

    // Organic swirling plasma turbulence distorting the shockwave edge
    float swirl =
      sin(ang * 6.0 + uTime * 1.45 - r * 9.5) * 0.012 +
      cos(ang * 11.0 - uTime * 2.15 + r * 14.5) * 0.007;
    float rw = r + swirl;

    // 1. Primary prismatic shockwave crest + sheer chromatic trailing wake
    float dWave = rw - waveR;
    float crest = exp(-dWave * dWave * 520.0) * 0.95;
    float leadPrism = exp(-pow(dWave - 0.022, 2.0) * 900.0) * 0.45;
    float trailPrism = exp(-pow(dWave + 0.028, 2.0) * 720.0) * 0.48;
    float wake = smoothstep(waveR - 0.34, waveR, rw) * (1.0 - smoothstep(waveR, waveR + 0.035, rw));
    float wakeFilaments = 0.58 + 0.42 * sin(ang * 16.0 - uTime * 3.4 + r * 28.0);
    float wakeEnergy = wake * wakeFilaments * 0.32;

    // 2. Resonant secondary & tertiary harmonic echoes in complementary jewel hues
    float p2 = fract(uProgress * 1.9 + 0.36);
    float r2 = mix(0.06, 0.92, 1.0 - pow(1.0 - p2, 1.8));
    float echo2 = exp(-pow(rw - r2, 2.0) * 880.0) * sin(p2 * 3.14159265) * 0.58;

    float p3 = fract(uProgress * 1.9 + 0.72);
    float r3 = mix(0.06, 0.92, 1.0 - pow(1.0 - p3, 1.8));
    float echo3 = exp(-pow(rw - r3, 2.0) * 1100.0) * sin(p3 * 3.14159265) * 0.46;

    // 3. Translucent Gothic cathedral rose-window light projection inside the expanding wave
    float insideWave = 1.0 - smoothstep(waveR - 0.045, waveR + 0.025, r);
    float a1 = ang + uTime * 0.24;
    float a2 = ang - uTime * 0.18;
    float n1 = fract(a1 * 0.15915494 + 0.5);
    float n2 = fract(a2 * 0.15915494 + 0.5);

    // Concentric rose-window tracery rings
    float ringA = exp(-pow(r - 0.31, 2.0) * 2600.0);
    float ringB = exp(-pow(r - 0.58, 2.0) * 2600.0);
    float ringC = exp(-pow(r - 0.84, 2.0) * 2400.0);

    // Pointed Gothic trefoil rosette (inner 12 petals) & outer 24-lancet cathedral arcade
    float innerArchR = 0.27 + 0.065 * pow(abs(cos(a1 * 6.0)), 0.72);
    float innerArchLine = exp(-pow(r - innerArchR, 2.0) * 2100.0) * 0.54;

    float midArchR = 0.46 + 0.105 * (1.0 - abs(sin(a2 * 6.0)));
    float midArchLine = exp(-pow(r - midArchR, 2.0) * 1950.0) * 0.52;

    float outerOgiveR = 0.71 + 0.125 * pow(abs(cos(a1 * 12.0)), 0.68);
    float outerOgiveLine = exp(-pow(r - outerOgiveR, 2.0) * 2050.0) * 0.48;

    // Gossamer radial mullions framing the stained-glass lancet panes
    float spoke12 = pow(abs(cos(a1 * 6.0)), 48.0) * smoothstep(0.09, 0.14, r) * (1.0 - smoothstep(0.57, 0.61, r));
    float spoke24 = pow(abs(cos(a1 * 12.0)), 56.0) * smoothstep(0.56, 0.60, r) * (1.0 - smoothstep(0.83, 0.87, r));

    // Subtle stained-glass quatrefoil jewel medallions in the middle gallery
    float quatrefoil =
      smoothstep(0.34, 0.38, r) * (1.0 - smoothstep(0.52, 0.56, r)) *
      smoothstep(0.32, 0.76, cos(a2 * 12.0)) *
      smoothstep(0.15, 0.72, sin(r * 42.0 - a2 * 6.0));

    // Translucent coloured stained-glass pane light (airy & misty so terrain shows clearly beneath)
    float paneShimmer = 0.68 + 0.32 * sin(ang * 9.0 - uTime * 1.8 + r * 16.0);
    float innerBand = smoothstep(0.09, 0.13, r) * (1.0 - smoothstep(0.28, 0.32, r));
    float midBand = smoothstep(0.32, 0.36, r) * (1.0 - smoothstep(0.55, 0.59, r));
    float outerBand = smoothstep(0.59, 0.63, r) * (1.0 - smoothstep(0.81, 0.85, r));

    // Soft mullion margin attenuation gives each glass pane its cathedral leaded-window definition
    float mullionGapInner = smoothstep(0.06, 0.28, abs(sin(a1 * 6.0)));
    float mullionGapMid = smoothstep(0.06, 0.28, abs(sin(a2 * 6.0)));
    float mullionGapOuter = smoothstep(0.06, 0.30, abs(sin(a1 * 12.0)));

    // Distinct jewel hues per cathedral pane sector, gently rotating like sunlit refracted glass
    float innerSector = floor(n1 * 12.0) / 12.0;
    float midSector = floor(n2 * 12.0) / 12.0;
    float outerSector = floor(n1 * 24.0) / 24.0;

    vec3 innerGlassCol = sampleRoseGlass(innerSector * 3.0 + 0.05, uColor, uGlassD, uGlassB, uGlassC);
    vec3 midGlassCol = sampleRoseGlass(midSector * 3.0 + 0.38, uGlassB, uGlassC, uGlassD, uColor);
    vec3 outerGlassCol = sampleRoseGlass(outerSector * 6.0 + 0.66, uGlassC, uColor, uGlassB, uGlassD);

    float innerPaneAlpha = innerBand * mullionGapInner * 0.22 * paneShimmer;
    float midPaneAlpha = (midBand * mullionGapMid * 0.19 + quatrefoil * 0.14) * paneShimmer;
    float outerPaneAlpha = outerBand * mullionGapOuter * 0.17 * paneShimmer;

    float tracery =
      (ringA * 0.44 + ringB * 0.42 + ringC * 0.36 +
       innerArchLine + midArchLine + outerOgiveLine +
       spoke12 * 0.34 + spoke24 * 0.30) * insideWave;

    // 4. Airy luminous halo where the heavenly light column meets the earth
    float coreHalo = exp(-r * r * 22.0) * 0.62;
    float outerFade = 1.0 - smoothstep(0.88, 1.0, r);

    // Accumulate polychromatic stained-glass light layers without washing out into opaque white
    vec3 warmGold = mix(uGlassD, vec3(1.0, 0.96, 0.84), 0.52);
    vec3 shockCol = sampleRoseGlass(normAng * 2.0 - uTime * 0.14, uColor, uGlassD, uGlassB, uGlassC);
    vec3 wakeCol = sampleRoseGlass(normAng * 3.0 + r * 0.8 + uTime * 0.1, uGlassC, uGlassB, uColor, uGlassD);

    vec3 rgb = vec3(0.0);
    float alpha = 0.0;

    // Translucent stained-glass panes
    rgb += innerGlassCol * innerPaneAlpha * insideWave;
    alpha += innerPaneAlpha * insideWave;
    rgb += midGlassCol * midPaneAlpha * insideWave;
    alpha += midPaneAlpha * insideWave;
    rgb += outerGlassCol * outerPaneAlpha * insideWave;
    alpha += outerPaneAlpha * insideWave;

    // Gossamer cathedral filigree tracery
    rgb += warmGold * tracery * 0.88;
    alpha += tracery * 0.68;

    // Multi-hue expanding shockwave & harmonic echoes
    rgb += mix(shockCol, vec3(1.0, 0.98, 0.92), 0.36) * crest;
    rgb += uGlassB * leadPrism;
    rgb += uGlassC * trailPrism;
    rgb += wakeCol * wakeEnergy;
    rgb += mix(uGlassB, uGlassD, 0.25) * echo2;
    rgb += mix(uGlassC, uColor, 0.25) * echo3;
    rgb += mix(uColor, warmGold, 0.45) * coreHalo;

    alpha += crest * 0.72 + leadPrism * 0.42 + trailPrism * 0.44 + wakeEnergy * 0.68 + echo2 * 0.58 + echo3 * 0.48 + coreHalo * 0.62;

    vec3 finalCol = rgb / max(alpha, 0.001);
    float finalAlpha = clamp(alpha * outerFade * uOpacity, 0.0, 0.74);
    gl_FragColor = vec4(finalCol, finalAlpha);
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
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uHasSceneDepth;
  uniform vec3 uColor;
  uniform vec3 uGlassB;
  uniform vec3 uGlassC;
  uniform vec3 uGlassD;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  vec3 sampleCurtainGlass(float phase, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    float p = fract(phase) * 4.0;
    if (p < 1.0) return mix(c0, c1, smoothstep(0.12, 0.88, p));
    if (p < 2.0) return mix(c1, c2, smoothstep(0.12, 0.88, p - 1.0));
    if (p < 3.0) return mix(c2, c3, smoothstep(0.12, 0.88, p - 2.0));
    return mix(c3, c0, smoothstep(0.12, 0.88, p - 3.0));
  }

  void main() {
    if (uHasSceneDepth > 0.5) {
      float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).x;
      if (gl_FragCoord.z > sceneDepth) discard;
    }
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float grazing = 1.0 - abs(dot(normalize(vWorldNormal), viewDir));
    // Sheer through the center, softly gleaming along grazing atmospheric edges
    float rimBoost = 0.24 + pow(grazing, 1.45) * 0.96;

    // Translucent Gothic clerestory stained-glass lancet light shafts rising into thin air
    float sway = sin(vUv.y * 4.5 - uTime * 1.8) * 0.014;
    float panelU = fract(vUv.x + sway);
    float lancetArch = 0.70 + 0.22 * pow(abs(sin(panelU * 50.2655)), 0.7);
    float topDissolve = 1.0 - smoothstep(lancetArch * 0.45, lancetArch, vUv.y);
    float vFade = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - vUv.y, 1.65) * topDissolve;
    float baseFlame = exp(-vUv.y * 9.0) * 0.85;
    float lancetPane = smoothstep(0.06, 0.24, abs(sin(panelU * 50.2655)));
    float mullionGlint = pow(abs(cos(panelU * 50.2655)), 32.0) * 0.35;

    float curtainA = 0.5 + 0.5 * sin(vUv.x * 37.6991 + uTime * 1.4 + sin(vUv.y * 5.0 - uTime * 2.1) * 1.2);
    float curtainB = 0.5 + 0.5 * cos(vUv.x * 62.8318 - uTime * 2.0 + vUv.y * 8.5);
    float riseWave = 0.65 + 0.35 * sin(vUv.y * 18.0 - uTime * 5.8 + vUv.x * 12.5663);

    float panelSector = floor(panelU * 16.0) / 16.0;
    vec3 lowerJewel = sampleCurtainGlass(panelSector * 4.0 + uTime * 0.03, uColor, uGlassD, uGlassB, uGlassC);
    vec3 upperJewel = sampleCurtainGlass(panelSector * 4.0 + 0.35 - uTime * 0.02, uGlassB, uGlassC, uColor, uGlassD);
    vec3 glassCol = mix(lowerJewel, upperJewel, smoothstep(0.05, 0.78, vUv.y));
    vec3 warmFiligree = mix(uGlassD, vec3(1.0, 0.96, 0.86), 0.55);

    float veilEnergy = vFade * (0.34 + 0.72 * curtainA * (0.55 + 0.45 * curtainB)) * riseWave * (0.45 + 0.55 * lancetPane);
    float seamEnergy = vFade * mullionGlint;
    float energy = (veilEnergy + seamEnergy + baseFlame * 0.72) * rimBoost;

    vec3 col = mix(glassCol, warmFiligree, clamp(seamEnergy * 1.8 + baseFlame * 0.45, 0.0, 0.72));
    gl_FragColor = vec4(col, clamp(energy * uOpacity, 0.0, 0.64));
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
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uHasSceneDepth;
  uniform vec3 uColor;
  uniform vec3 uGlassB;
  uniform vec3 uGlassC;
  uniform vec3 uGlassD;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;

  vec3 sampleHaloGlass(float phase, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    float p = fract(phase) * 4.0;
    if (p < 1.0) return mix(c0, c1, smoothstep(0.1, 0.9, p));
    if (p < 2.0) return mix(c1, c2, smoothstep(0.1, 0.9, p - 1.0));
    if (p < 3.0) return mix(c2, c3, smoothstep(0.1, 0.9, p - 2.0));
    return mix(c3, c0, smoothstep(0.1, 0.9, p - 3.0));
  }

  void main() {
    if (uHasSceneDepth > 0.5) {
      float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).x;
      if (gl_FragCoord.z > sceneDepth) discard;
    }
    // Orbiting polychromatic cathedral jewels & delicate gilded beads along the armillary halo
    float beads = pow(0.5 + 0.5 * sin(vUv.x * 75.3982 - uTime * 4.2), 2.2);
    float pulse = 0.62 + 0.38 * sin(vUv.x * 18.8495 + uTime * 2.6);
    float glow = (0.36 + 0.58 * beads) * pulse;
    vec3 jewel = sampleHaloGlass(vUv.x * 3.0 + uTime * 0.08, uColor, uGlassB, uGlassC, uGlassD);
    vec3 col = mix(jewel, vec3(1.0, 0.97, 0.88), 0.22 + beads * 0.45);
    gl_FragColor = vec4(col, clamp(glow * uOpacity, 0.0, 0.72));
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
  varying float vColorPhase;

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
    vColorPhase = fract(aSeed * 3.7 + aAngle * 0.15915494);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float baseSize = mix(11.0, 22.0, aSeed) * (0.65 + 0.35 * vTwinkle);
    gl_PointSize = clamp(baseSize * (62.0 / max(8.0, -mvPos.z)), 2.5, 28.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const DIVINE_MOTES_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uHasSceneDepth;
  uniform vec3 uColor;
  uniform vec3 uGlassB;
  uniform vec3 uGlassC;
  uniform vec3 uGlassD;
  varying float vAlpha;
  varying float vTwinkle;
  varying float vColorPhase;

  vec3 sampleMoteJewel(float phase, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    float p = fract(phase) * 4.0;
    if (p < 1.0) return mix(c0, c1, smoothstep(0.15, 0.85, p));
    if (p < 2.0) return mix(c1, c2, smoothstep(0.15, 0.85, p - 1.0));
    if (p < 3.0) return mix(c2, c3, smoothstep(0.15, 0.85, p - 2.0));
    return mix(c3, c0, smoothstep(0.15, 0.85, p - 3.0));
  }

  void main() {
    if (uHasSceneDepth > 0.5) {
      float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).x;
      if (gl_FragCoord.z > sceneDepth) discard;
    }
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) discard;

    // Soft luminous orb + delicate 4-point celestial star glint
    float core = exp(-d * d * 28.0);
    float glintX = exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 6.5);
    float glintY = exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 6.5);
    float star = core + (glintX + glintY) * 0.48 * vTwinkle;

    vec3 jewel = sampleMoteJewel(vColorPhase, uColor, uGlassD, uGlassB, uGlassC);
    vec3 col = mix(jewel, vec3(1.0, 0.98, 0.93), clamp(core * 0.65, 0.0, 1.0));
    gl_FragColor = vec4(col, clamp(star * vAlpha, 0.0, 0.78));
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
  uniform vec3 uGroundColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uStarIntensity;
  uniform float uCloudTime;
  uniform float uCloudCoverage;
  uniform float uDaylight;
  uniform float uGroundHemisphere;
  varying vec3 vWorldDirection;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.53);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm5(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      v += a * noise2(p);
      p = rot * p * 2.03 + vec2(13.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);
    vec3 sunDir = normalize(uSunDirection);

    // Below-horizon matte ground hemisphere for PMREM IBL bounce only;
    // on the visible sky dome, extend exact uHorizonColor downward so far misty seas
    // viewed from high mountain elevation merge invisibly with zero gray band.
    if (dir.y < 0.0) {
      if (uGroundHemisphere > 0.5) {
        float gT = smoothstep(0.0, -0.35, dir.y);
        vec3 belowCol = mix(uHorizonColor, uGroundColor, gT);
        gl_FragColor = vec4(belowCol, 1.0);
      } else {
        gl_FragColor = vec4(uHorizonColor, 1.0);
      }
      return;
    }

    float h = clamp(dir.y, 0.0, 1.0);

    // 1. Rayleigh-like zenith-to-horizon gradient with subtle horizon airglow
    vec3 sky = mix(uHorizonColor, uTopColor, pow(h, 0.52));
    float horizonBand = exp(-h * 7.5) * smoothstep(0.0, 0.04, h);
    sky = mix(sky, uHorizonColor * 1.05, horizonBand * 0.35);

    // 2. Physically-inspired Mie forward scattering & crisp solar disc
    float sunCos = dot(dir, sunDir);
    float sunDot = max(sunCos, 0.0);
    float sunElev = clamp(sunDir.y * 2.2 + 0.2, 0.0, 1.0);
    float mieWide = pow(sunDot, 5.0) * 0.20 * (0.4 + 0.6 * (1.0 - h));
    float mieTight = pow(sunDot, 36.0) * 0.32;
    float sunDisc = smoothstep(0.99945, 0.99982, sunCos) * 2.6 * smoothstep(-0.04, 0.06, sunDir.y);
    float sunAtten = mix(1.0, 0.22, smoothstep(0.55, 0.92, uCloudCoverage));
    float horizonClear = smoothstep(0.0, 0.035, h);
    sky += uSunColor * (mieWide + mieTight) * sunElev * sunAtten * horizonClear;
    sky += uSunColor * sunDisc * sunAtten * smoothstep(0.0, 0.012, h);

    // 3. Night stars & subtle Milky Way dust band
    if (uStarIntensity > 0.01 && dir.y > 0.05) {
      vec3 starCell = floor(dir * 260.0);
      float starVal = hash31(starCell);
      if (starVal > 0.9955) {
        float twinkle = 0.72 + 0.28 * sin(uCloudTime * 2.4 + starVal * 900.0);
        vec3 starTint = mix(vec3(0.84, 0.90, 1.0), vec3(1.0, 0.93, 0.80), fract(starVal * 47.0));
        sky += starTint * uStarIntensity * twinkle * smoothstep(0.05, 0.38, dir.y) * (1.0 - uCloudCoverage * 0.85);
      }
      // Subtle galactic band
      float mwBand = exp(-pow(dot(dir, normalize(vec3(0.35, 0.55, -0.75))), 2.0) * 14.0);
      float mwNoise = fbm5(dir.xz * 4.2 + vec2(dir.y * 2.5));
      sky += vec3(0.06, 0.075, 0.11) * mwBand * mwNoise * uStarIntensity * smoothstep(0.08, 0.4, dir.y) * (1.0 - uCloudCoverage * 0.8);
    }

    // 4. Multi-layer drifting volumetric-lit clouds (high wispy cirrus + sculpted cumulus deck)
    if (dir.y > 0.015) {
      float cloudFade = smoothstep(0.015, 0.20, dir.y);
      vec2 windOffset = vec2(uCloudTime * 0.011, uCloudTime * 0.0045);

      // Layer A: High-altitude wispy cirrus streaks
      vec2 cirrusUv = (dir.xz / (dir.y + 0.24)) * vec2(0.55, 1.35) + windOffset * 0.65;
      float cirrus = fbm5(cirrusUv + vec2(fbm5(cirrusUv * 1.6) * 0.45));
      float cirrusAlpha = smoothstep(0.58, 0.84, cirrus) * 0.26 * cloudFade;
      vec3 cirrusCol = mix(uHorizonColor * 0.92, mix(vec3(0.95, 0.96, 0.98), uSunColor, 0.35), uDaylight);
      sky = mix(sky, cirrusCol, cirrusAlpha);

      // Layer B: Sculpted fair-weather cumulus & storm cloud deck with directional sun lighting
      vec2 cloudUv = (dir.xz / (dir.y + 0.18)) * 0.42 + windOffset;
      float warp = fbm5(cloudUv * 1.45 + vec2(3.1, -1.7));
      float densRaw = fbm5(cloudUv + vec2(warp * 0.32, -warp * 0.22));
      float threshold = mix(0.64, 0.32, clamp(uCloudCoverage, 0.0, 1.0));
      float density = smoothstep(threshold, threshold + 0.26, densRaw);

      if (density > 0.005) {
        // Directional offset sample toward sun for bright tops & cool shaded bottoms
        vec2 sunStep = normalize(sunDir.xz + vec2(0.0001)) * 0.095;
        float densSun = fbm5(cloudUv + sunStep + vec2(warp * 0.32, -warp * 0.22));
        float litTop = clamp((densRaw - densSun) * 3.4 + 0.56, 0.0, 1.0);
        float thickness = clamp(density * (0.55 + uCloudCoverage * 0.55), 0.0, 1.0);

        vec3 dayLit = mix(vec3(0.92, 0.93, 0.95), uSunColor * 1.08, 0.34);
        vec3 dayShade = mix(uTopColor * 0.52 + vec3(0.18, 0.21, 0.25), vec3(0.24, 0.28, 0.33), uCloudCoverage * 0.65);
        vec3 nightLit = vec3(0.13, 0.16, 0.22);
        vec3 nightShade = vec3(0.04, 0.055, 0.085);

        vec3 litCol = mix(nightLit, dayLit, uDaylight);
        vec3 shadeCol = mix(nightShade, dayShade, uDaylight);
        vec3 cloudCol = mix(shadeCol, litCol, litTop * (1.0 - thickness * 0.32));

        // Silver-lining Mie forward scattering through thin cloud edges near the sun
        float silverLining = pow(sunDot, 10.0) * (1.0 - thickness * 0.7) * uDaylight * 0.55;
        cloudCol += uSunColor * silverLining;

        // Atmospheric perspective blends distant clouds softly toward the horizon haze
        float horizBlend = smoothstep(0.24, 0.02, dir.y);
        cloudCol = mix(cloudCol, uHorizonColor, horizBlend * 0.72);

        float finalCloudAlpha = clamp(density * (0.76 + uCloudCoverage * 0.20) * cloudFade, 0.0, 0.94);
        sky = mix(sky, cloudCol, finalCloudAlpha);
      }
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * Manages naturalistic photographic atmospheric lighting, infinite-horizon sky dome
 * with drifting clouds, camera-adaptive shadow frustum, seasonal & day/night transitions,
 * weather particles, fireflies, and divine intervention light beams.
 */
const DIVINE_LIGHT_POOL_SIZE = 2;

export class AtmosphereSystem {
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly fog: THREE.FogExp2;
  readonly divineOverlayScene = new THREE.Scene();

  private readonly skyMesh: THREE.Mesh;
  private readonly skyUniforms: {
    uTopColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uGroundColor: { value: THREE.Color };
    uSunDirection: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uStarIntensity: { value: number };
    uCloudTime: { value: number };
    uCloudCoverage: { value: number };
    uDaylight: { value: number };
    uGroundHemisphere: { value: number };
  };

  private readonly weatherPoints: THREE.Points;
  private readonly weatherPositions: Float32Array;
  private readonly weatherMat: THREE.PointsMaterial;
  private readonly weatherSinPhase: Float32Array;
  private readonly weatherCosPhase: Float32Array;

  private readonly fireflyPoints: THREE.Points;
  private readonly fireflyBase: Float32Array;
  private readonly fireflyPositions: Float32Array;
  private readonly fireflyTrig: Float32Array;
  private readonly fireflyMat: THREE.PointsMaterial;

  private readonly divineGroup = new THREE.Group();
  private readonly divineLightGroup = new THREE.Group();
  private readonly divineLightPool: THREE.PointLight[] = [];
  private readonly divineDepthUniforms: DivineDepthUniforms = {
    uSceneDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uHasSceneDepth: { value: 0.0 },
  };
  private readonly activeBeams: ActiveBeamMesh[] = [];
  private readonly beamOuterGeo: THREE.CylinderGeometry;
  private readonly beamInnerGeo: THREE.CylinderGeometry;
  private readonly beamRingGeo: THREE.CircleGeometry;
  private readonly beamWallGeo: THREE.CylinderGeometry;
  private readonly beamHaloGeo: THREE.TorusGeometry;
  private readonly pmremGenerator: THREE.PMREMGenerator;
  private readonly envScene: THREE.Scene;
  private readonly envDomeGeo: THREE.SphereGeometry;
  private readonly envSkyMat: THREE.ShaderMaterial;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private envRefreshTimer = 0;
  private lastEnvSunY = Number.NaN;
  private lastEnvDaylight = Number.NaN;
  private lastEnvCloudCoverage = Number.NaN;
  private lastEnvCloudTime = Number.NaN;
  private lastEnvWeather = '';
  private lastEnvSeason = '';

  private readonly lightDirState = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
  private currentDaylight = 1.0;
  private currentWindStrength = 0.25;
  private currentIsWinter = false;
  private currentCloudTime = 0;
  private currentCloudCoverage = 0.38;
  private currentRainWetness = 0.0;
  private currentFloodSurge = 0.0;
  private currentClimateHeat = 0.0;
  private currentClimateFreeze = 0.0;
  private currentMiasma = 0.0;
  private readonly shadowMapSize: number;
  private currentShadowExtent = 120;
  private lastAppliedShadowExtent = 120;
  // Reusable per-frame scratch math objects (zero GC pressure in update())
  private readonly tmpLightDir = new THREE.Vector3();
  private readonly tmpTopDay = new THREE.Color();
  private readonly tmpTopNight = new THREE.Color(0x060b16);
  private readonly tmpHorizDay = new THREE.Color();
  private readonly tmpHorizGold = new THREE.Color(0xe2955c);
  private readonly tmpHorizNight = new THREE.Color(0x111c2c);
  private readonly tmpSunGold = new THREE.Color(0xf5924d);
  private readonly tmpMoonTint = new THREE.Color(0x6486b8);
  private readonly tmpSunTint = new THREE.Color();
  private readonly tmpSunTintGold = new THREE.Color(0xf79954);
  private readonly tmpHeatTop = new THREE.Color(0x9b5a2e);
  private readonly tmpHeatHoriz = new THREE.Color(0xe6b478);
  private readonly tmpHeatSun = new THREE.Color(0xffc97a);
  private readonly tmpMiasmaTop = new THREE.Color(0x52524c);
  private readonly tmpMiasmaHoriz = new THREE.Color(0x9b9682);
  private readonly tmpFreezeTop = new THREE.Color(0x4b6c8c);
  private readonly tmpFreezeHoriz = new THREE.Color(0xd2e1ee);

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadowMapSize: number,
    softParticleTex?: THREE.Texture,
  ) {
    this.shadowMapSize = Math.max(256, shadowMapSize);
    this.fog = new THREE.FogExp2(0xc4d3cc, 0.00062);
    this.scene.fog = this.fog;

    // Infinite-horizon Procedural Sky Dome with drifting clouds & ground bounce
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x285a94) },
      uHorizonColor: { value: new THREE.Color(0xc4d3cc) },
      uGroundColor: { value: new THREE.Color(0x2c3624) },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d8) },
      uStarIntensity: { value: 0 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.38 },
      uDaylight: { value: 1.0 },
      uGroundHemisphere: { value: 0.0 },
    };

    const skyGeo = new THREE.SphereGeometry(12500, 36, 22);
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

    // PMREM environment generator with true sky + clouds above and earthy matte ground below
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envDomeGeo = new THREE.SphereGeometry(40, 20, 14);
    this.envSkyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: {
        ...this.skyUniforms,
        uGroundHemisphere: { value: 1.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const envDome = new THREE.Mesh(this.envDomeGeo, this.envSkyMat);
    this.envScene.add(envDome);

    // Key Sun / Moon Directional Light with camera-distance-adaptive crisp soft shadows
    this.sunLight = new THREE.DirectionalLight(0xfff3de, 3.15);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 880;
    const d = this.currentShadowExtent;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00028;
    this.sunLight.shadow.normalBias = 0.024;
    this.sunLight.shadow.radius = 2.4;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Physically grounded sky-to-earth hemisphere bounce light
    this.hemiLight = new THREE.HemisphereLight(0xaac8e6, 0x323d28, 0.72);
    this.scene.add(this.hemiLight);

    // Minimal fill ambient so cast shadows retain real natural depth
    this.ambientLight = new THREE.AmbientLight(0x28322c, 0.07);
    this.scene.add(this.ambientLight);

    // Weather particles distributed in a wide circular canopy
    const weatherCount = 1500;
    this.weatherPositions = new Float32Array(weatherCount * 3);
    this.weatherSinPhase = new Float32Array(weatherCount);
    this.weatherCosPhase = new Float32Array(weatherCount);
    for (let i = 0; i < weatherCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 128;
      this.weatherPositions[i * 3] = Math.cos(a) * r;
      this.weatherPositions[i * 3 + 1] = Math.random() * 68;
      this.weatherPositions[i * 3 + 2] = Math.sin(a) * r;
      this.weatherSinPhase[i] = Math.sin(i);
      this.weatherCosPhase[i] = Math.cos(i);
    }
    const weatherGeo = new THREE.BufferGeometry();
    weatherGeo.setAttribute('position', new THREE.BufferAttribute(this.weatherPositions, 3));
    this.weatherMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.42,
      map: softParticleTex ?? null,
      transparent: true,
      opacity: 0.6,
      alphaTest: 0.01,
      depthWrite: false,
    });
    this.weatherPoints = new THREE.Points(weatherGeo, this.weatherMat);
    this.weatherPoints.frustumCulled = false;
    this.scene.add(this.weatherPoints);

    // Soft glowing golden fireflies hovering above moss and water at dusk/night
    const fireflyCount = 260;
    this.fireflyBase = new Float32Array(fireflyCount * 3);
    const fireflyPos = new Float32Array(fireflyCount * 3);
    this.fireflyPositions = fireflyPos;
    this.fireflyTrig = new Float32Array(fireflyCount * 6);
    for (let i = 0; i < fireflyCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 96;
      const fx = Math.cos(a) * r;
      const fy = 1.2 + Math.random() * 6.2;
      const fz = Math.sin(a) * r;
      this.fireflyBase[i * 3] = fx;
      this.fireflyBase[i * 3 + 1] = fy;
      this.fireflyBase[i * 3 + 2] = fz;
      fireflyPos[i * 3] = fx;
      fireflyPos[i * 3 + 1] = fy;
      fireflyPos[i * 3 + 2] = fz;
      const k = i * 6;
      this.fireflyTrig[k] = Math.cos(i);
      this.fireflyTrig[k + 1] = Math.sin(i);
      this.fireflyTrig[k + 2] = Math.cos(i * 1.7);
      this.fireflyTrig[k + 3] = Math.sin(i * 1.7);
      this.fireflyTrig[k + 4] = Math.cos(i * 1.3);
      this.fireflyTrig[k + 5] = Math.sin(i * 1.3);
    }
    const fireflyGeo = new THREE.BufferGeometry();
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xffdf7a,
      size: 0.54,
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

    this.divineOverlayScene.add(this.divineGroup);
    // Pre-allocate a fixed pool of divine PointLights so casting/expiring miracles never
    // changes NUM_POINT_LIGHTS in the main scene and never triggers PBR shader recompiles.
    for (let i = 0; i < DIVINE_LIGHT_POOL_SIZE; i++) {
      const pooled = new THREE.PointLight(0xffffff, 0, 32, 1.5);
      this.divineLightPool.push(pooled);
      this.divineLightGroup.add(pooled);
    }
    this.scene.add(this.divineLightGroup);
    this.refreshEnvironmentMap();
  }

  syncDivineDepthUniforms(depthTex: THREE.Texture | null, width: number, height: number): boolean {
    this.divineDepthUniforms.uSceneDepth.value = depthTex;
    this.divineDepthUniforms.uResolution.value.set(Math.max(1, width), Math.max(1, height));
    this.divineDepthUniforms.uHasSceneDepth.value = depthTex ? 1.0 : 0.0;
    return this.activeBeams.length > 0;
  }

  /** Pre-compiles divine beam overlay ShaderMaterials once behind the splash screen. */
  prewarmDivineShaders(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const dummy: DivineEffectVisual = {
      id: -1,
      type: 'sunlit_blessing',
      position: { x: 0, z: 0 },
      radius: 14,
      colorHex: 0xffd56b,
      createdAt: 0,
      duration: 1,
    };
    const visual = createDivineBeamVisual(
      dummy,
      0,
      this.beamOuterGeo,
      this.beamInnerGeo,
      this.beamRingGeo,
      this.beamWallGeo,
      this.beamHaloGeo,
      this.divineDepthUniforms,
    );
    this.divineGroup.add(visual.group);
    renderer.compile(this.divineOverlayScene, camera);
    this.divineGroup.remove(visual.group);
    visual.dispose();
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
      this.divineDepthUniforms,
    );
    // Keep local supernatural illumination inside the main scene while rendering additive beam
    // visuals in the post-fog overlay pass so distant horizon mist never splits foreground beams.
    visual.group.remove(visual.glowLight);
    visual.glowLight.position.set(effect.position.x, groundY + 6.8, effect.position.z);
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
    let focusDist = 75;
    if (camera) {
      // Keep the sky dome centered on the viewer so the sky sits mathematically at infinity
      this.skyMesh.position.set(camera.position.x, 0, camera.position.z);
      focusX = focusTarget ? focusTarget.x : camera.position.x;
      focusZ = focusTarget ? focusTarget.z : camera.position.z;
      if (focusTarget) {
        focusDist = camera.position.distanceTo(focusTarget);
      } else {
        focusDist = Math.max(25, camera.position.y * 1.4);
      }
    }
    // Keep ambient weather particles & fireflies centered on the observer's region across the larger world
    this.weatherPoints.position.set(focusX, 0, focusZ);
    this.fireflyPoints.position.set(focusX, 0, focusZ);

    // 1. Sun & Moon orbit
    const angle = (world.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle) * 0.85;
    const sunZ = 0.42;

    const daylight = THREE.MathUtils.clamp((sunY + 0.14) / 0.52, 0, 1);
    const goldenHour = THREE.MathUtils.clamp(1 - Math.abs(sunY - 0.1) * 4.4, 0, 1);

    const lightDir = this.tmpLightDir.set(sunX, Math.max(0.18, Math.abs(sunY)), sunZ).normalize();

    // Camera-distance-adaptive shadow frustum: crisp ~2–4 cm/texel shadows close-up, wide coverage at overview
    const targetExtent = THREE.MathUtils.clamp(focusDist * 1.15 + 16, 42, 205);
    this.currentShadowExtent += (targetExtent - this.currentShadowExtent) * Math.min(1, dt * 4.5);
    if (Math.abs(this.currentShadowExtent - this.lastAppliedShadowExtent) > 0.6) {
      const d = this.currentShadowExtent;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.updateProjectionMatrix();
      const extentScale = d / 120;
      this.sunLight.shadow.bias = -0.00024 * Math.max(0.65, extentScale);
      this.sunLight.shadow.normalBias = 0.022 * Math.max(0.65, extentScale);
      this.lastAppliedShadowExtent = d;
    }

    // Anchor shadow frustum to camera focus snapped to shadow texel increments (eliminates shadow shimmer)
    const texelStep = (this.lastAppliedShadowExtent * 2) / this.shadowMapSize;
    const snap = texelStep * 4;
    const shadowFocusX = Math.round(focusX / snap) * snap;
    const shadowFocusZ = Math.round(focusZ / snap) * snap;
    this.sunLight.target.position.set(shadowFocusX, 0, shadowFocusZ);
    this.sunLight.position.set(shadowFocusX, 0, shadowFocusZ).addScaledVector(lightDir, 280);
    this.lightDirState.copy(lightDir);
    this.currentDaylight = daylight;
    this.currentFloodSurge = world.floodSurge;
    this.currentClimateHeat = world.climateHeat;
    this.currentClimateFreeze = world.climateFreeze;
    this.currentMiasma = world.miasmaIntensity;
    this.currentIsWinter = world.season === 'winter' || world.climateFreeze > 0.45;

    const baseWind =
      world.weather === 'storm'
        ? 1.0
        : world.weather === 'rain' || world.weather === 'blossom'
          ? 0.58
          : 0.24;
    const targetWind = Math.min(1.35, baseWind + world.floodSurge * 0.32 + world.climateFreeze * 0.24);
    this.currentWindStrength += (targetWind - this.currentWindStrength) * Math.min(1, dt * 2.0);
    this.currentCloudTime += dt * (0.65 + this.currentWindStrength * 1.15);

    const targetCoverage =
      world.weather === 'storm'
        ? 0.90
        : world.weather === 'rain'
          ? 0.78
          : world.weather === 'snow'
            ? 0.74
            : world.weather === 'mist'
              ? 0.58
              : world.weather === 'sunbeams'
                ? 0.40
                : 0.36;
    this.currentCloudCoverage += (targetCoverage - this.currentCloudCoverage) * Math.min(1, dt * 0.45);

    const rawWetness =
      world.weather === 'storm'
        ? 1.0
        : world.weather === 'rain'
          ? 0.85
          : world.floodSurge > 0.08
            ? Math.min(0.85, world.floodSurge * 0.72)
            : 0.0;
    const targetWetness = rawWetness * (1 - world.climateHeat * 0.85);
    const wetRate = targetWetness > this.currentRainWetness ? 0.16 : 0.04;
    this.currentRainWetness += (targetWetness - this.currentRainWetness) * Math.min(1, dt * wetRate);

    this.skyUniforms.uSunDirection.value.set(sunX, sunY, sunZ).normalize();
    this.skyUniforms.uCloudTime.value = this.currentCloudTime;
    this.skyUniforms.uCloudCoverage.value = this.currentCloudCoverage;
    this.skyUniforms.uDaylight.value = daylight;

    // Naturalistic photographic sky & fog colors across day, golden hour, night, and weather
    const topDay = this.tmpTopDay.setHex(
      world.weather === 'storm'
        ? 0x3b4854
        : world.weather === 'rain'
          ? 0x4f6170
          : world.season === 'winter'
            ? 0x526e8a
            : 0x265890,
    );
    const topNight = this.tmpTopNight;
    const horizDay = this.tmpHorizDay.setHex(
      world.weather === 'storm'
        ? 0x505b63
        : world.weather === 'rain'
          ? 0x86949c
          : world.season === 'autumn'
            ? 0xcfc4b0
            : world.season === 'winter'
              ? 0xc8d2da
              : 0xc2d2cb,
    );
    const horizGold = this.tmpHorizGold;
    const horizNight = this.tmpHorizNight;

    this.skyUniforms.uTopColor.value.copy(topNight).lerp(topDay, daylight);
    this.skyUniforms.uHorizonColor.value
      .copy(horizNight)
      .lerp(horizDay, daylight)
      .lerp(horizGold, goldenHour * 0.65);
    this.skyUniforms.uGroundColor.value
      .setHex(world.season === 'winter' ? 0x545d64 : world.season === 'autumn' ? 0x383222 : 0x283320)
      .multiplyScalar(0.25 + daylight * 0.75);
    this.skyUniforms.uSunColor.value
      .setHex(0xfff3dc)
      .lerp(this.tmpSunGold, goldenHour * 0.82);
    this.skyUniforms.uStarIntensity.value = THREE.MathUtils.clamp(1 - daylight * 1.65, 0, 1);

    // Ecological sky & sun modulation during sustained Deity climate epochs
    if (world.climateHeat > 0.02) {
      const hAmt = Math.min(1, world.climateHeat);
      this.skyUniforms.uTopColor.value.lerp(this.tmpHeatTop, hAmt * 0.42 * daylight);
      this.skyUniforms.uHorizonColor.value.lerp(this.tmpHeatHoriz, hAmt * 0.62 * Math.max(0.25, daylight));
      this.skyUniforms.uSunColor.value.lerp(this.tmpHeatSun, hAmt * 0.55);
    }
    if (world.climateFreeze > 0.02) {
      const fAmt = Math.min(1, world.climateFreeze);
      this.skyUniforms.uTopColor.value.lerp(this.tmpFreezeTop, fAmt * 0.48 * daylight);
      this.skyUniforms.uHorizonColor.value.lerp(this.tmpFreezeHoriz, fAmt * 0.52 * Math.max(0.25, daylight));
    }
    if (world.miasmaIntensity > 0.02) {
      const mAmt = Math.min(1, world.miasmaIntensity);
      this.skyUniforms.uTopColor.value.lerp(this.tmpMiasmaTop, mAmt * 0.65);
      this.skyUniforms.uHorizonColor.value.lerp(this.tmpMiasmaHoriz, mAmt * 0.72);
    }

    // Directional light intensity & color (crisp sunlit vs cool shaded contrast)
    const stormDim =
      (world.weather === 'storm' ? 0.45 : world.weather === 'rain' ? 0.66 : 1.0) *
      (1 - world.miasmaIntensity * 0.34);
    const moonTint = this.tmpMoonTint;
    const sunTint = this.tmpSunTint.setHex(0xfff1d6).lerp(this.tmpSunTintGold, goldenHour * 0.78);
    if (world.climateHeat > 0.05) {
      sunTint.lerp(this.tmpHeatSun, Math.min(1, world.climateHeat) * 0.48);
    }
    this.sunLight.color.copy(moonTint).lerp(sunTint, daylight);
    const heatGlare = 1 + world.climateHeat * 0.24;
    this.sunLight.intensity = (0.38 + daylight * 3.15) * stormDim * heatGlare;

    this.hemiLight.intensity = (0.22 + daylight * 0.62) * (0.68 + stormDim * 0.32);
    this.hemiLight.color.copy(this.skyUniforms.uHorizonColor.value);
    this.hemiLight.groundColor.setHex(
      world.season === 'winter' ? 0x58626b : world.season === 'autumn' ? 0x3d3625 : 0x2e3b24,
    );
    this.ambientLight.intensity = 0.05 + daylight * 0.04;

    this.fog.color.copy(this.skyUniforms.uHorizonColor.value);
    const baseFog =
      world.weather === 'mist'
        ? 0.0046
        : world.weather === 'storm'
          ? 0.0038
          : world.weather === 'rain'
            ? 0.0024
            : 0.00058;
    const ecologicalFogBoost = world.miasmaIntensity * 0.0034 + world.climateHeat * 0.0008 + world.climateFreeze * 0.0006;
    // Relax atmospheric haze smoothly when zoomed high out to the country-map Overview
    const camY = camera ? camera.position.y : 30;
    const altitudeClear = 1 - THREE.MathUtils.smoothstep(camY, 120, 620) * 0.74;
    const targetFog = (baseFog + ecologicalFogBoost) * altitudeClear;
    this.fog.density += (targetFog - this.fog.density) * Math.min(1, dt * 1.8);

    // Periodically refresh PMREM environment map for accurate sky/cloud/ground reflections
    this.envRefreshTimer -= dt;
    if (this.envRefreshTimer <= 0) {
      this.envRefreshTimer = 6.0;
      const needsEnvRefresh =
        !this.envRenderTarget ||
        Math.abs(sunY - this.lastEnvSunY) > 0.03 ||
        Math.abs(daylight - this.lastEnvDaylight) > 0.03 ||
        Math.abs(this.currentCloudCoverage - this.lastEnvCloudCoverage) > 0.05 ||
        Math.abs(this.currentCloudTime - this.lastEnvCloudTime) > 20.0 ||
        world.weather !== this.lastEnvWeather ||
        world.season !== this.lastEnvSeason;
      if (needsEnvRefresh) {
        this.refreshEnvironmentMap();
        this.lastEnvSunY = sunY;
        this.lastEnvDaylight = daylight;
        this.lastEnvCloudCoverage = this.currentCloudCoverage;
        this.lastEnvCloudTime = this.currentCloudTime;
        this.lastEnvWeather = world.weather;
        this.lastEnvSeason = world.season;
      }
    }

    // 2. Weather particles
    this.updateWeatherParticles(world, dt);

    // 3. Soft glowing fireflies (present softly at dusk/golden hour and radiant at night)
    const nightAmt = Math.max(1 - daylight, goldenHour * 0.25);
    const twinkle = 0.80 + Math.sin(world.elapsedSeconds * 3.1) * 0.20;
    this.fireflyMat.opacity = Math.max(0, nightAmt * 0.82 * twinkle - (world.weather === 'storm' ? 0.5 : 0));
    if (this.fireflyMat.opacity > 0.02) {
      const posAttr = this.fireflyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = world.elapsedSeconds;
      const sin07 = Math.sin(t * 0.7);
      const cos07 = Math.cos(t * 0.7);
      const sin13 = Math.sin(t * 1.3);
      const cos13 = Math.cos(t * 1.3);
      const sin06 = Math.sin(t * 0.6);
      const cos06 = Math.cos(t * 0.6);
      const base = this.fireflyBase;
      const pos = this.fireflyPositions;
      const trig = this.fireflyTrig;
      const count = posAttr.count;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        const k = i * 6;
        // Angle-addition identities match sin(t*0.7+i), sin(t*1.3+i*1.7), cos(t*0.6+i*1.3) with zero per-particle trig
        pos[j] = base[j] + (sin07 * trig[k] + cos07 * trig[k + 1]) * 1.8;
        pos[j + 1] = base[j + 1] + (sin13 * trig[k + 2] + cos13 * trig[k + 3]) * 0.65;
        pos[j + 2] = base[j + 2] + (cos06 * trig[k + 4] - sin06 * trig[k + 5]) * 1.8;
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

      v.outerMat.uniforms.uOpacity.value = fade * 0.30;
      v.outerMat.uniforms.uTime.value = t;
      v.coreMat.uniforms.uOpacity.value = fade * 0.46;
      v.coreMat.uniforms.uTime.value = t;

      // Stationary full-influence ground disc with translucent stained-glass rose-window light & polychromatic waves
      const discRadius = Math.max(8, beam.maxRadius * 1.35);
      v.ringMesh.scale.set(discRadius, 1, discRadius);
      v.ringMat.uniforms.uOpacity.value = burstFade * 0.72;
      v.ringMat.uniforms.uTime.value = t;
      v.ringMat.uniforms.uProgress.value = ease;

      // Sheer stained-glass clerestory aurora curtain locked to the expanding shockwave crest
      const waveWorldRadius = discRadius * (0.08 + 0.86 * ease);
      const wallHeight = 4.2 + 5.8 * fade;
      v.wallMesh.scale.set(waveWorldRadius, wallHeight, waveWorldRadius);
      v.wallMat.uniforms.uOpacity.value = burstFade * 0.46;
      v.wallMat.uniforms.uTime.value = t;

      // Twin counter-rotating prismatic armillary halos hovering & precessing around the lower shaft
      v.haloMat.uniforms.uOpacity.value = fade * 0.66;
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

      // GPU-driven polychromatic stained-glass stardust & ascending helical embers
      v.motesMat.uniforms.uOpacity.value = burstFade * 0.85;
      v.motesMat.uniforms.uTime.value = t;
      v.motesMat.uniforms.uWaveRadius.value = waveWorldRadius;

      // Subtle polychromatic supernatural illumination bathing nearby trees, terrain, and cottages
      v.glowLight.intensity = fade * 20.0;
      const tintCycle = 0.5 + 0.5 * Math.sin(t * 1.35);
      v.glowLight.color.copy(v.palette.primary).lerp(v.palette.jewelD, tintCycle * 0.25);
    }

    // Sync up to DIVINE_LIGHT_POOL_SIZE most recent active beams into the permanently mounted PointLight pool
    const beamCount = this.activeBeams.length;
    for (let i = 0; i < DIVINE_LIGHT_POOL_SIZE; i++) {
      const poolLight = this.divineLightPool[i];
      const beamIdx = beamCount - 1 - i;
      if (beamIdx >= 0) {
        const src = this.activeBeams[beamIdx].visual.glowLight;
        poolLight.position.copy(src.position);
        poolLight.color.copy(src.color);
        poolLight.intensity = src.intensity;
        poolLight.distance = src.distance;
      } else {
        poolLight.intensity = 0;
      }
    }
  }

  private updateWeatherParticles(world: WorldState, dt: number): void {
    const posAttr = this.weatherPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    let fallSpeed = 1.2;
    let windX = 0.6;
    let targetOpacity = 0.22;

    if (world.miasmaIntensity > 0.35 && world.weather !== 'storm' && world.weather !== 'snow') {
      fallSpeed = 0.75;
      windX = 1.9;
      this.weatherMat.color.setHex(0x9a9484);
      this.weatherMat.size = 0.38;
      targetOpacity = 0.45 + world.miasmaIntensity * 0.32;
    } else if (world.weather === 'rain' || world.weather === 'storm') {
      fallSpeed = world.weather === 'storm' ? 28 : 18;
      windX = world.weather === 'storm' ? 7 : 2.5;
      this.weatherMat.color.setHex(0xb8cad8);
      this.weatherMat.size = 0.24;
      targetOpacity = 0.56;
    } else if (world.weather === 'snow') {
      fallSpeed = 3.0;
      windX = 1.4;
      this.weatherMat.color.setHex(0xedf2f7);
      this.weatherMat.size = 0.44;
      targetOpacity = 0.78;
    } else if (world.weather === 'blossom') {
      fallSpeed = 1.6;
      windX = 1.8;
      this.weatherMat.color.setHex(0xf2cad4);
      this.weatherMat.size = 0.42;
      targetOpacity = 0.72;
    } else {
      fallSpeed = 0.36;
      windX = 0.45;
      this.weatherMat.color.setHex(0xf5e8be);
      this.weatherMat.size = 0.28;
      targetOpacity = world.weather === 'sunbeams' ? 0.38 : 0.14;
    }

    this.weatherMat.opacity += (targetOpacity - this.weatherMat.opacity) * Math.min(1, dt * 2.5);

    const wrapRadius = 128;
    const wrapRadiusSq = wrapRadius * wrapRadius;
    const dx = windX * dt;
    const dy = fallSpeed * dt;
    const swayScale = 0.28 * dt;
    const sinT = Math.sin(world.elapsedSeconds);
    const cosT = Math.cos(world.elapsedSeconds);
    const wPos = this.weatherPositions;
    const wSin = this.weatherSinPhase;
    const wCos = this.weatherCosPhase;
    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      let x = wPos[j] + dx;
      let y = wPos[j + 1] - dy;
      let z = wPos[j + 2] + (sinT * wCos[i] + cosT * wSin[i]) * swayScale;

      if (y < 0) y = 68;
      const rSq = x * x + z * z;
      if (rSq > wrapRadiusSq) {
        const inv = wrapRadius / Math.sqrt(rSq);
        x = -x * inv * 0.94;
        z = -z * inv * 0.94;
      }

      wPos[j] = x;
      wPos[j + 1] = y;
      wPos[j + 2] = z;
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
      cloudTime: this.currentCloudTime,
      cloudCoverage: this.currentCloudCoverage,
      rainWetness: this.currentRainWetness,
      floodSurge: this.currentFloodSurge,
      climateHeat: this.currentClimateHeat,
      climateFreeze: this.currentClimateFreeze,
      miasmaIntensity: this.currentMiasma,
    };
  }

  dispose(): void {
    this.skyMesh.geometry.dispose();
    (this.skyMesh.material as THREE.Material).dispose();
    this.envDomeGeo.dispose();
    this.envSkyMat.dispose();
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
