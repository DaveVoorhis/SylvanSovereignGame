import * as THREE from 'three';
import type { SkyLightingState } from './WaterShader';

/**
 * Shared uniforms driving all physically-based plaza fountain water shaders
 * (submerged caustics, dynamic capillary water surface, flowing refractive jets,
 * volumetric ray-marched mist, aerated splash foam, and 4-class GPU particles).
 */
export interface FountainWaterUniforms {
  readonly uTime: { value: number };
  readonly uSunDirection: { value: THREE.Vector3 };
  readonly uSunColor: { value: THREE.Color };
  readonly uSkyTopColor: { value: THREE.Color };
  readonly uSkyHorizonColor: { value: THREE.Color };
  readonly uFogColor: { value: THREE.Color };
  readonly uFogDensity: { value: number };
  readonly uDaylight: { value: number };
  readonly uNightGlow: { value: number };
  readonly uWind: { value: THREE.Vector2 };
}

export interface FountainWaterAssembly {
  /** Group holding all finished-stage water meshes (caustics, surfaces, jets, foam, volumetric mist). */
  readonly waterGroup: THREE.Group;
  /** Arcing streams sub-group for gentle organic pressure shimmer. */
  readonly jetsGroup: THREE.Group;
  /** 4-class GPU particle system (ballistic droplets, fine mist, splash bursts, surface foam). */
  readonly particles: THREE.Points;
  /** Volumetric ray-marched mist enclosure mesh. */
  readonly volumetricMist: THREE.Mesh;
}

const SHARED_FOUNTAIN_NOISE_GLSL = /* glsl */ `
  float fHash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  vec2 fHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float fNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fHash21(i);
    float b = fHash21(i + vec2(1.0, 0.0));
    float c = fHash21(i + vec2(0.0, 1.0));
    float d = fHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = fHash21(i.xy + vec2(i.z * 19.1, i.z * 47.3));
    float n100 = fHash21(i.xy + vec2(1.0, 0.0) + vec2(i.z * 19.1, i.z * 47.3));
    float n010 = fHash21(i.xy + vec2(0.0, 1.0) + vec2(i.z * 19.1, i.z * 47.3));
    float n110 = fHash21(i.xy + vec2(1.0, 1.0) + vec2(i.z * 19.1, i.z * 47.3));
    float n001 = fHash21(i.xy + vec2((i.z + 1.0) * 19.1, (i.z + 1.0) * 47.3));
    float n101 = fHash21(i.xy + vec2(1.0, 0.0) + vec2((i.z + 1.0) * 19.1, (i.z + 1.0) * 47.3));
    float n011 = fHash21(i.xy + vec2(0.0, 1.0) + vec2((i.z + 1.0) * 19.1, (i.z + 1.0) * 47.3));
    float n111 = fHash21(i.xy + vec2(1.0, 1.0) + vec2((i.z + 1.0) * 19.1, (i.z + 1.0) * 47.3));
    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
  }

  float fFbm2(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 3; i++) {
      v += a * fNoise2(p);
      p = rot * p * 2.07 + vec2(11.3, 17.9);
      a *= 0.48;
    }
    return v;
  }

  // Animated Voronoi ridge caustics: sharp luminous web where refracted wavefronts converge
  float voronoiCaustic(vec2 p, float t) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = fHash22(n + g);
        o = 0.5 + 0.42 * sin(t * 1.65 + 6.28318 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    float edge = sqrt(d2) - sqrt(d1);
    float ridge = exp(-edge * 6.8);
    float cellFocus = pow(max(1e-4, clamp(sqrt(d1), 0.0, 1.0)), 2.6);
    return clamp(ridge * 0.82 + cellFocus * 0.32, 0.0, 1.0);
  }

  float dualLayerCaustic(vec2 p, float t) {
    mat2 r1 = mat2(0.866, 0.5, -0.5, 0.866);
    float cA = voronoiCaustic(p * 3.1 + vec2(t * 0.28, -t * 0.21), t);
    float cB = voronoiCaustic(r1 * p * 4.4 + vec2(-t * 0.24, t * 0.31), t * 1.18 + 2.3);
    return clamp(pow(max(1e-4, cA * cB), 0.62) * 1.65 + (cA + cB) * 0.28, 0.0, 1.8);
  }

  float expFogFactor(float dist, float density) {
    float f = density * dist;
    return clamp(1.0 - exp(-f * f), 0.0, 1.0);
  }
`;

// ── 1. Submerged Caustics Basin Floor & Inner Wet Wall Shader ────────────────
const CAUSTICS_FLOOR_VERT = /* glsl */ `
  attribute float aTier;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vTier;
  varying float vViewDist;

  void main() {
    vLocalPos = position;
    vTier = aTier;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CAUSTICS_FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTopColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uNightGlow;

  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vTier;
  varying float vViewDist;

  ${SHARED_FOUNTAIN_NOISE_GLSL}

  void main() {
    vec2 p = vLocalPos.xz;
    float r = length(p);
    float ang = atan(p.y, p.x);

    // Subtle carved wet stone radial pavers & natural granite grain
    float stoneGrain = fFbm2(p * 7.5 + vec2(3.1, 1.7));
    float radialSeam = abs(fract(ang * (vTier > 0.5 ? 6.0 : 12.0) / 6.28318) - 0.5);
    float ringSeam = abs(fract(r * 2.2) - 0.5);
    float mortar = smoothstep(0.015, 0.055, radialSeam) * smoothstep(0.02, 0.06, ringSeam);
    vec3 wetStone = mix(vec3(0.065, 0.095, 0.105), vec3(0.18, 0.23, 0.21), stoneGrain);
    wetStone *= mix(0.76, 1.0, mortar);

    // Subtle mineral moss tint near outer basin perimeter
    float maxR = vTier > 0.5 ? 0.70 : 1.43;
    float edgeDist = clamp((maxR - r) / maxR, 0.0, 1.0);
    float mossMask = smoothstep(0.24, 0.02, edgeDist) * smoothstep(0.35, 0.75, stoneGrain);
    wetStone = mix(wetStone, vec3(0.045, 0.095, 0.065), mossMask * 0.45);

    // Pedestal & rim ambient occlusion so the basin reads with genuine sculpted depth
    float innerR = vTier > 0.5 ? 0.14 : 0.46;
    float pedAO = smoothstep(innerR * 0.85, innerR + 0.26, r);
    float wallAO = smoothstep(maxR + 0.04, maxR - 0.24, r);
    float ao = mix(0.46, 1.0, pedAO * wallAO);

    // Refracted sunlight caustics with RGB chromatic dispersion fringes
    vec2 sunShift = uSunDirection.xz * (vTier > 0.5 ? 0.06 : 0.14);
    vec2 cp = p + sunShift + vec2(0.0, vLocalPos.y * 0.35);
    vec2 disp = normalize(uSunDirection.xz + vec2(0.001, 0.001)) * 0.022;
    float cR = dualLayerCaustic(cp + disp, uTime);
    float cG = dualLayerCaustic(cp, uTime);
    float cB = dualLayerCaustic(cp - disp, uTime);
    vec3 chromaticCaustic = vec3(cR, cG, cB);

    // Focused concentric ripple caustics directly under the waterfall impact ring
    float impactR = vTier > 0.5 ? 0.54 : 1.14;
    float lobeCount = vTier > 0.5 ? 6.0 : 8.0;
    float lobePhase = vTier > 0.5 ? 0.0 : 0.3927;
    float distRing = abs(r - impactR);
    float rippleLens = 0.5 + 0.5 * sin(distRing * 34.0 - uTime * 8.2);
    float impactFocus = exp(-distRing * 4.4) * (0.65 + 0.35 * cos(ang * lobeCount - lobePhase * lobeCount));
    float ringCaustic = (rippleLens * rippleLens * rippleLens) * impactFocus * 1.05;

    // Beer-Lambert underwater tint: crystal pale aqua shallow, richer teal in deep center
    float waterDepth = vTier > 0.5 ? (0.10 + 0.05 * edgeDist) : (0.16 + 0.14 * pedAO * wallAO);
    vec3 absorption = exp(-vec3(0.46, 0.15, 0.11) * waterDepth * 4.2);

    float daylight = clamp(uDaylight, 0.0, 1.0);
    float sunVis = smoothstep(-0.02, 0.22, uSunDirection.y) * daylight;
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);

    float sunElev = clamp(uSunDirection.y * 1.45, 0.08, 1.0);
    vec3 baseLit = wetStone * ao * absorption * (0.028 + 0.94 * daylight * sunElev);
    baseLit += wetStone * ao * uSkyTopColor * 0.26;

    // Dancing solar caustics projected across floor & inner rim (strictly gated by daylight & sun elevation)
    vec3 causticLight = (chromaticCaustic * 0.78 + vec3(ringCaustic * 0.85, ringCaustic * 0.98, ringCaustic * 1.05))
      * uSunColor * sunVis * 1.15 * ao;

    // Subtle localized warm lantern caustics from the 4 corner plaza posts at dusk/night
    float lanternGlow = 0.0;
    for (int i = 0; i < 4; i++) {
      float la = (float(i) * 1.5707963) + 0.785398;
      vec2 lPos = vec2(cos(la), sin(la)) * 2.15;
      float ld = length(p - lPos);
      lanternGlow += 1.0 / (1.0 + ld * ld * 1.35);
    }
    vec3 nightCaustics = vec3(1.0, 0.62, 0.24) * lanternGlow * lanternFactor * (0.016 + cG * 0.045) * ao;

    vec3 col = baseLit + causticLight * 0.72 + nightCaustics;

    float fogAmt = expFogFactor(vViewDist, uFogDensity);
    col = mix(col, uFogColor, fogAmt);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── 2. Physically-Based Dynamic Basin Water Surface Shader ───────────────────
const FOUNTAIN_SURFACE_VERT = /* glsl */ `
  attribute float aTier;
  attribute float aEdgeMask;

  uniform float uTime;

  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying float vTier;
  varying float vEdgeMask;
  varying float vWaveH;
  varying float vViewDist;

  float evalImpactWaves(vec2 p, float tier, float t) {
    float h = 0.0;
    if (tier > 0.5) {
      // 6 upper finial jet impact sources at r = 0.54
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.04719755;
        vec2 src = vec2(cos(a), sin(a)) * 0.54;
        float d = length(p - src);
        h += sin(d * 30.0 - t * 10.5 + float(i) * 0.7) * exp(-d * 3.8) * 0.0042;
      }
    } else {
      // 8 upper-bowl cascade impact sources at r = 1.14
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.78539816 + 0.39269908;
        vec2 src = vec2(cos(a), sin(a)) * 1.14;
        float d = length(p - src);
        h += sin(d * 22.0 - t * 8.6 + float(i) * 0.9) * exp(-d * 2.5) * 0.0052;
      }
    }
    return h;
  }

  void main() {
    vTier = aTier;
    vEdgeMask = aEdgeMask;

    vec3 pos = position;
    float wave = evalImpactWaves(pos.xz, aTier, uTime);
    pos.y += wave * aEdgeMask;
    vWaveH = wave;
    vLocalPos = pos;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FOUNTAIN_SURFACE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uNightGlow;

  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying float vTier;
  varying float vEdgeMask;
  varying float vWaveH;
  varying float vViewDist;

  ${SHARED_FOUNTAIN_NOISE_GLSL}

  float surfaceHeightField(vec2 p, float tier, float t) {
    float h = 0.0;
    if (tier > 0.5) {
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.04719755;
        vec2 src = vec2(cos(a), sin(a)) * 0.54;
        float d = length(p - src);
        h += sin(d * 34.0 - t * 11.2 + float(i) * 0.7) * exp(-d * 3.4) * 0.014;
      }
    } else {
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.78539816 + 0.39269908;
        vec2 src = vec2(cos(a), sin(a)) * 1.14;
        float d = length(p - src);
        h += sin(d * 25.0 - t * 9.0 + float(i) * 0.9) * exp(-d * 2.3) * 0.016;
      }
    }
    // Fine multi-directional capillary ripples
    float cap1 = fNoise2(p * 9.5 + vec2(t * 1.35, -t * 0.95));
    float cap2 = fNoise2(p * 17.0 + vec2(-t * 1.65, t * 1.25));
    h += (cap1 - 0.5) * 0.011 + (cap2 - 0.5) * 0.0055;
    return h;
  }

  float impactSplashMask(vec2 p, float tier) {
    float m = 0.0;
    if (tier > 0.5) {
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.04719755;
        vec2 src = vec2(cos(a), sin(a)) * 0.54;
        float d = length(p - src);
        m = max(m, exp(-d * d * 42.0));
      }
    } else {
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.78539816 + 0.39269908;
        vec2 src = vec2(cos(a), sin(a)) * 1.14;
        float d = length(p - src);
        m = max(m, exp(-d * d * 22.0));
      }
    }
    return m;
  }

  void main() {
    vec2 p = vLocalPos.xz;
    float eps = 0.018;
    float hC = surfaceHeightField(p, vTier, uTime);
    float hX = surfaceHeightField(p + vec2(eps, 0.0), vTier, uTime);
    float hZ = surfaceHeightField(p + vec2(0.0, eps), vTier, uTime);

    vec3 localN = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
    vec3 N = normalize(mat3(modelMatrix) * localN);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDirection);

    float NdotV = clamp(dot(N, V), 0.001, 1.0);
    // Physically accurate water Schlick Fresnel (IOR 1.333 => F0 = 0.02)
    float fresnel = 0.022 + 0.978 * pow(max(1e-4, 1.0 - NdotV), 5.0);

    float daylight = clamp(uDaylight, 0.0, 1.0);
    float lightLevel = mix(0.035, 1.0, daylight);
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);

    // Sky reflection gradient
    vec3 R = reflect(-V, N);
    float skyT = pow(max(1e-4, clamp(R.y * 1.15, 0.0, 1.0)), 0.52);
    vec3 skyRefl = mix(uSkyHorizonColor, uSkyTopColor, skyT) * mix(0.55, 0.95, daylight);

    // Crisp GGX-like sun specular sheen + sparkling wave-crest micro-glints
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 1e-4);
    float sunVis = smoothstep(-0.02, 0.20, L.y) * daylight;
    float specBroad = pow(NdotH, 64.0) * 0.55;
    float specSharp = pow(NdotH, 420.0) * 3.4;
    vec3 sunSpec = uSunColor * (specBroad + specSharp) * sunVis;

    // Crisp, distance-attenuated warm reflections from the 4 corner plaza lanterns at dusk/night
    vec3 lanternSpec = vec3(0.0);
    if (lanternFactor > 0.02) {
      for (int i = 0; i < 4; i++) {
        float la = float(i) * 1.5707963 + 0.785398;
        vec3 lLocal = vec3(cos(la) * 2.15, 1.78, sin(la) * 2.15);
        vec3 lWorld = (modelMatrix * vec4(lLocal, 1.0)).xyz;
        vec3 toLVec = lWorld - vWorldPos;
        float lDist2 = dot(toLVec, toLVec);
        vec3 toL = normalize(toLVec);
        vec3 lh = normalize(toL + V);
        float atten = 1.0 / (1.0 + lDist2 * 0.38);
        float s = pow(max(dot(N, lh), 1e-4), 76.0);
        lanternSpec += vec3(1.0, 0.64, 0.26) * s * atten * 0.34 * lanternFactor;
      }
    }

    // Subtle refracted subsurface aqua tint (clear enough to showcase dancing floor caustics!)
    float r = length(p);
    float maxR = vTier > 0.5 ? 0.702 : 1.40;
    float shallow = smoothstep(maxR * 0.45, maxR, r);
    vec3 bodyTint = mix(vec3(0.024, 0.125, 0.155), vec3(0.068, 0.24, 0.26), shallow) * lightLevel;

    // Aerated cellular whitewater foam at each waterfall impact point + subtle rim meniscus
    float splash = impactSplashMask(p, vTier);
    float foamNoise = fFbm2(p * 11.5 - vec2(uTime * 1.4, uTime * 1.1));
    float rippleFoam = smoothstep(0.18, 0.78, splash * (0.72 + foamNoise * 0.75));
    float meniscus = (1.0 - smoothstep(0.0, 0.16, vEdgeMask)) * (0.28 + 0.32 * foamNoise);
    float foam = clamp(rippleFoam * 0.92 + meniscus * 0.25, 0.0, 0.96);

    vec3 foamColor = mix(vec3(0.42, 0.58, 0.66), vec3(0.86, 0.92, 0.96), 0.65) * lightLevel
      + uSkyHorizonColor * 0.18
      + uSunColor * 0.18 * sunVis
      + vec3(1.0, 0.66, 0.28) * 0.028 * lanternFactor;

    vec3 waterColor = mix(bodyTint, skyRefl, clamp(fresnel * 0.92 + 0.08, 0.0, 0.96))
      + sunSpec
      + lanternSpec;
    vec3 finalCol = mix(waterColor, foamColor, foam);

    // Clear refractive window looking straight down (alpha ~0.34), glossy reflective at grazing angles
    float baseAlpha = mix(0.32, 0.88, clamp(fresnel * 1.05, 0.0, 1.0));
    float alpha = clamp(max(baseAlpha, foam * 0.94) + clamp(specSharp * 0.25, 0.0, 0.4), 0.28, 0.96);

    float fogAmt = expFogFactor(vViewDist, uFogDensity);
    finalCol = mix(finalCol, uFogColor, fogAmt);

    gl_FragColor = vec4(finalCol, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── 3. Flowing, Refractive & Aerated Parabolic Water Streams Shader ──────────
const FOUNTAIN_STREAM_VERT = /* glsl */ `
  attribute float aStreamPhase;

  uniform float uTime;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vPhase;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vViewDist;

  void main() {
    vUv = uv;
    vPhase = aStreamPhase;

    // uv.x runs 0 (spout exit) -> 1 (water impact)
    float s = clamp(uv.x, 0.0, 1.0);
    // Tight laminar jet near nozzle -> naturally widening aerated cascade toward splashdown
    float pulse = sin(s * 24.0 - uTime * 19.5 + aStreamPhase * 2.13) * 0.14
                + sin(s * 41.0 - uTime * 29.0 + aStreamPhase * 4.7) * 0.07;
    float radialExpand = mix(-0.004, 0.011, pow(max(1e-4, s), 1.35)) + pulse * 0.008 * (0.35 + s * 0.85);

    vec3 pos = position + normal * radialExpand;
    // Gentle breeze sway growing quadratically along the falling arc
    float windBend = s * s * 0.055;
    pos.x += uWind.x * windBend;
    pos.z += uWind.y * windBend;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FOUNTAIN_STREAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uNightGlow;

  varying vec2 vUv;
  varying float vPhase;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vViewDist;

  ${SHARED_FOUNTAIN_NOISE_GLSL}

  void main() {
    float s = clamp(vUv.x, 0.0, 1.0);
    float around = vUv.y;

    // Fast scrolling longitudinal water filaments & entrained micro-bubbles
    float flow1 = fNoise2(vec2(s * 5.2 - uTime * 4.6 + vPhase, around * 5.0 + s * 1.4));
    float flow2 = fNoise2(vec2(s * 11.5 - uTime * 7.8 - vPhase * 1.7, around * 9.0 - s * 2.2));
    float streak = clamp(flow1 * 0.62 + flow2 * 0.55, 0.0, 1.0);

    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDirection);
    float NdotV = clamp(abs(dot(N, V)), 0.001, 1.0);
    float fresnel = 0.06 + 0.94 * pow(max(1e-4, 1.0 - NdotV), 3.2);

    float daylight = clamp(uDaylight, 0.0, 1.0);
    float lightLevel = mix(0.032, 1.0, daylight);
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);

    // Sky reflection + sparkling sunlight glint on rushing stream crests
    vec3 R = reflect(-V, N);
    vec3 skyRefl = mix(uSkyHorizonColor, uSkyTopColor, clamp(R.y * 0.8 + 0.2, 0.0, 1.0))
      * mix(0.55, 0.95, daylight);

    vec3 H = normalize(L + V);
    float sunVis = smoothstep(-0.02, 0.20, L.y) * daylight;
    float glint = pow(max(dot(N, H), 1e-4), 90.0) * (0.65 + streak * 1.4) * sunVis;
    // Forward subsurface scattering through backlit water arcs
    float backScatter = pow(max(1e-4, clamp(dot(-V, L), 0.0, 1.0)), 3.0) * (0.45 + 0.55 * streak) * sunVis;

    // Laminar glass core near nozzle -> aerated whitewater froth toward impact
    float aeration = smoothstep(0.18, 0.92, s) * 0.62 + smoothstep(0.45, 0.92, streak) * 0.48;
    vec3 clearGlass = mix(vec3(0.12, 0.32, 0.40) * lightLevel, skyRefl, 0.58 + fresnel * 0.32);
    vec3 frothWhite = vec3(0.76, 0.86, 0.92) * lightLevel + uSkyHorizonColor * 0.16;

    vec3 col = mix(clearGlass, frothWhite, clamp(aeration, 0.0, 0.90));
    col += uSunColor * (glint * 1.35 + backScatter * 0.45);
    col += vec3(1.0, 0.66, 0.28) * lanternFactor * (0.014 + 0.042 * fresnel);

    // Soft end taper + dynamic filament transparency so arcs look liquid, never solid plastic
    float endFade = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.93, s);
    float alpha = clamp((0.36 + fresnel * 0.36 + aeration * 0.34) * (0.72 + streak * 0.38) * endFade * mix(0.76, 1.0, daylight), 0.0, 0.92);

    float fogAmt = expFogFactor(vViewDist, uFogDensity);
    col = mix(col, uFogColor, fogAmt);

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── 4. Volumetric Ray-Marched Fountain Mist & Splash Vapor Shader ────────────
const VOLUMETRIC_MIST_VERT = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vLocalCamPos;
  varying vec3 vWorldPos;
  varying float vViewDist;

  void main() {
    vLocalPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;

    // Pure GLSL ES 1.00 local-space camera position (exact for translation + rotation + uniform scale)
    vec3 c0 = modelMatrix[0].xyz;
    vec3 c1 = modelMatrix[1].xyz;
    vec3 c2 = modelMatrix[2].xyz;
    vec3 diff = cameraPosition - modelMatrix[3].xyz;
    vLocalCamPos = vec3(
      dot(diff, c0) / max(1e-5, dot(c0, c0)),
      dot(diff, c1) / max(1e-5, dot(c1, c1)),
      dot(diff, c2) / max(1e-5, dot(c2, c2))
    );

    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const VOLUMETRIC_MIST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uNightGlow;
  uniform vec2 uWind;

  varying vec3 vLocalPos;
  varying vec3 vLocalCamPos;
  varying vec3 vWorldPos;
  varying float vViewDist;

  ${SHARED_FOUNTAIN_NOISE_GLSL}

  // Analytical ray-cylinder intersection (axis = Y, radius = R, y in [yMin, yMax])
  vec2 intersectCylinder(vec3 ro, vec3 rd, float R, float yMin, float yMax) {
    float a = dot(rd.xz, rd.xz);
    float t0;
    float t1;
    if (a < 1e-6) {
      if (dot(ro.xz, ro.xz) > R * R) return vec2(1e6, -1e6);
      t0 = -1e6;
      t1 = 1e6;
    } else {
      float b = dot(ro.xz, rd.xz);
      float c = dot(ro.xz, ro.xz) - R * R;
      float disc = b * b - a * c;
      if (disc < 0.0) return vec2(1e6, -1e6);
      float s = sqrt(disc);
      t0 = (-b - s) / a;
      t1 = (-b + s) / a;
    }
    if (abs(rd.y) > 1e-5) {
      float ty0 = (yMin - ro.y) / rd.y;
      float ty1 = (yMax - ro.y) / rd.y;
      float tMinY = min(ty0, ty1);
      float tMaxY = max(ty0, ty1);
      t0 = max(t0, tMinY);
      t1 = min(t1, tMaxY);
    } else if (ro.y < yMin || ro.y > yMax) {
      return vec2(1e6, -1e6);
    }
    return vec2(t0, t1);
  }

  // Evaluates ultra-fine 3D splash-spray sheen tightly hugging the lower & upper impact rings
  float sampleMistDensity(vec3 p, float t) {
    float r = length(p.xz);
    float ang = atan(p.z, p.x);
    vec3 drift = vec3(uWind.x * t * 0.75, -t * 1.15, uWind.y * t * 0.75);
    float n1 = fNoise3(p * 4.8 + drift);
    float n2 = fNoise3(p * 9.6 + drift * 1.45 + vec3(4.1, 1.7, 2.9));
    float turb = clamp(n1 * 0.60 + n2 * 0.40, 0.0, 1.0);

    // 1. Tight low-lying splash spray right above the 8 lower cascade plunge points (r = 1.13, y = 0.46..0.72)
    float lowerLobe = 0.55 + 0.45 * cos((ang - 0.3927) * 8.0);
    float dLowerR = (r - 1.13) / 0.17;
    float dLowerY = (p.y - 0.55) / 0.14;
    float lowerSpray = exp(-(dLowerR * dLowerR + dLowerY * dLowerY)) * lowerLobe;

    // 2. Delicate fine spray directly above the 6 upper bowl plunge points (r = 0.54, y = 1.66..1.84)
    float upperLobe = 0.55 + 0.45 * cos(ang * 6.0);
    float dUpperR = (r - 0.54) / 0.12;
    float dUpperY = (p.y - 1.71) / 0.10;
    float upperSpray = exp(-(dUpperR * dUpperR + dUpperY * dUpperY)) * upperLobe * 0.65;

    // Keep volume clear inside central solid stone pedestal & bowl
    float stoneMask = 1.0;
    if (p.y < 1.32) {
      stoneMask *= smoothstep(0.36, 0.52, r);
    }
    if (p.y > 1.24 && p.y < 1.66) {
      stoneMask *= smoothstep(0.68, 0.82, r);
    }

    float baseField = (lowerSpray + upperSpray) * stoneMask;
    float wisp = smoothstep(0.36, 0.86, turb);
    return baseField * wisp * 0.24;
  }

  // Henyey-Greenstein phase function for backlit solar silver-lining in mist
  float hgPhase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = max(0.05, 1.0 + g2 - 2.0 * g * cosTheta);
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
  }

  void main() {
    vec3 ro = vLocalCamPos;
    vec3 rd = normalize(vLocalPos - vLocalCamPos);

    // Outer mist bounding cylinder (y in [0.41, 2.67], R = 1.50)
    vec2 outerHit = intersectCylinder(ro, rd, 1.50, 0.41, 2.67);
    if (outerHit.y <= max(0.0, outerHit.x)) discard;

    float tNear = max(0.0, outerHit.x);
    float tFar = outerHit.y;

    // Early ray termination against central stone pedestal & upper stone bowl so mist behind stone never bleeds over it
    vec2 pedHit = intersectCylinder(ro, rd, 0.35, 0.41, 1.32);
    if (pedHit.x > tNear && pedHit.x < tFar) {
      tFar = pedHit.x;
    }
    vec2 bowlHit = intersectCylinder(ro, rd, 0.72, 1.32, 1.64);
    if (bowlHit.x > tNear && bowlHit.x < tFar) {
      tFar = bowlHit.x;
    }

    float marchDist = tFar - tNear;
    if (marchDist <= 0.01) discard;

    const int STEPS = 12;
    float stepLen = marchDist / float(STEPS);

    // Screen-space interleaved gradient jitter eliminates volumetric slicing bands
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    vec3 worldRd = normalize(vWorldPos - cameraPosition);
    vec3 sunDir = normalize(uSunDirection);
    float cosTheta = dot(worldRd, sunDir);
    float forwardScatter = clamp(hgPhase(cosTheta, 0.56) * 1.45, 0.0, 2.2);
    float daylight = clamp(uDaylight, 0.0, 1.0);
    float lightLevel = mix(0.032, 1.0, daylight);
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);
    float sunVis = smoothstep(-0.02, 0.22, sunDir.y) * daylight;

    vec3 ambientMist = mix(uSkyHorizonColor, vec3(0.55, 0.68, 0.76) * lightLevel, 0.45) * mix(0.35, 0.85, daylight);
    vec3 sunLitMist = uSunColor * (0.18 + forwardScatter * 0.65) * sunVis;
    vec3 nightLitMist = vec3(1.0, 0.68, 0.30) * 0.026 * lanternFactor;
    vec3 scatterCol = ambientMist + sunLitMist + nightLitMist;

    vec3 accumColor = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < STEPS; i++) {
      float t = tNear + (float(i) + jitter) * stepLen;
      vec3 samplePos = ro + rd * t;
      float density = sampleMistDensity(samplePos, uTime);
      if (density > 0.002) {
        // Subtle vertical height brightening (top catches sky light, lower splashes are denser)
        float hShade = 0.82 + 0.28 * clamp((samplePos.y - 0.45) / 2.0, 0.0, 1.0);
        float stepAlpha = 1.0 - exp(-density * stepLen * 1.55);
        accumColor += transmittance * scatterCol * hShade * stepAlpha;
        transmittance *= (1.0 - stepAlpha);
        if (transmittance < 0.08) break;
      }
    }

    float maxSprayAlpha = mix(0.032, 0.16, daylight);
    float alpha = clamp(1.0 - transmittance, 0.0, maxSprayAlpha);
    // Fade gracefully at medium/long distances so fountains stay crisp and never hazy
    alpha *= (1.0 - smoothstep(24.0, 68.0, vViewDist));
    if (alpha < 0.006) discard;

    vec3 finalCol = accumColor / max(alpha, 0.001);
    float fogAmt = expFogFactor(vViewDist, uFogDensity);
    finalCol = mix(finalCol, uFogColor, fogAmt);

    gl_FragColor = vec4(finalCol, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── 5. Aerated Splash-Boil Foam Collar Shader ────────────────────────────────
const FOAM_BOIL_VERT = /* glsl */ `
  attribute float aTier;
  uniform float uTime;

  varying vec3 vLocalPos;
  varying float vTier;
  varying float vViewDist;

  void main() {
    vTier = aTier;
    vec3 pos = position;
    float ang = atan(pos.z, pos.x);
    float lobes = aTier > 0.5 ? 6.0 : 8.0;
    float phaseOff = aTier > 0.5 ? 0.0 : 0.3927;
    float impactLobe = 0.5 + 0.5 * cos((ang - phaseOff) * lobes);
    float churn = sin(ang * lobes * 2.0 - uTime * 11.0) * 0.008 + sin(uTime * 15.0 + ang * 7.0) * 0.005;
    pos.y += (impactLobe * 0.022 + churn);
    vLocalPos = pos;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FOAM_BOIL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uNightGlow;

  varying vec3 vLocalPos;
  varying float vTier;
  varying float vViewDist;

  ${SHARED_FOUNTAIN_NOISE_GLSL}

  void main() {
    vec2 p = vLocalPos.xz;
    float ang = atan(p.y, p.x);
    float lobes = vTier > 0.5 ? 6.0 : 8.0;
    float phaseOff = vTier > 0.5 ? 0.0 : 0.3927;
    // Concentrate bubbling froth right where the 6 / 8 jets plunge into the water
    float lobe = pow(max(1e-4, clamp(0.5 + 0.5 * cos((ang - phaseOff) * lobes), 0.0, 1.0)), 1.65);

    float bubbles = fFbm2(p * 14.0 + vec2(uTime * 1.9, -uTime * 1.5));
    float alpha = smoothstep(0.22, 0.74, lobe * 0.85 + bubbles * 0.45) * (0.28 + 0.62 * lobe);
    if (alpha < 0.02) discard;

    float daylight = clamp(uDaylight, 0.0, 1.0);
    float lightLevel = mix(0.035, 1.0, daylight);
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);
    float sunVis = smoothstep(-0.02, 0.20, uSunDirection.y) * daylight;

    vec3 foamCol = mix(vec3(0.45, 0.60, 0.68), vec3(0.88, 0.94, 0.98), bubbles) * lightLevel
      + uSkyHorizonColor * 0.16
      + uSunColor * 0.16 * sunVis
      + vec3(1.0, 0.66, 0.28) * 0.032 * lanternFactor;

    float fogAmt = expFogFactor(vViewDist, uFogDensity);
    foamCol = mix(foamCol, uFogColor, fogAmt);

    gl_FragColor = vec4(foamCol, alpha * 0.86);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── 6. 4-Class GPU Fountain Particle System (Droplets, Mist, Splashes, Foam) ─
const FOUNTAIN_PARTICLES_VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aSeed;   // x: phase offset, y: lifetime, z: size
  attribute float aKind;  // 0: jet droplet, 1: fine mist, 2: splash burst, 3: surface foam bubble

  uniform float uTime;
  uniform vec2 uWind;

  varying float vAlpha;
  varying float vSparkle;
  varying float vKind;
  varying vec2 vScreenVelDir;
  varying float vSpeedStretch;
  varying float vViewDist;

  void main() {
    float life = aSeed.y;
    float age = mod(uTime + aSeed.x * life, life);
    float t = clamp(age / life, 0.0, 1.0);
    vKind = aKind;

    vec3 p = position;
    vec3 instVel = aVel;

    if (aKind < 0.5) {
      // Class 0: Ballistic water droplets shedding from upper jets & rim cascades
      vec3 acc = vec3(uWind.x * 0.45, -9.7, uWind.y * 0.45);
      p = position + aVel * age + 0.5 * acc * age * age;
      instVel = aVel + acc * age;
      p.y = max(0.455, p.y);
      vAlpha = sin(t * 3.14159265) * 0.92;
      vSparkle = 0.72 + 0.38 * sin(uTime * 14.5 + aSeed.x * 53.0);
    } else if (aKind < 1.5) {
      // Class 1: Crisp atomized micro-spray droplets ejected from plunge rings (short ballistic arcs)
      vec3 acc = vec3(uWind.x * 0.85, -3.6, uWind.y * 0.85);
      p = position + aVel * age + 0.5 * acc * age * age;
      instVel = aVel + acc * age;
      p.y = max(position.y - 0.02, p.y);
      vAlpha = sin(t * 3.14159265) * 0.68;
      vSparkle = 0.78 + 0.32 * sin(uTime * 15.0 + aSeed.x * 31.0);
    } else if (aKind < 2.5) {
      // Class 2: Energetic upward splash bursts where cascades strike pools
      vec3 acc = vec3(uWind.x * 0.35, -9.2, uWind.y * 0.35);
      p = position + aVel * age + 0.5 * acc * age * age;
      instVel = aVel + acc * age;
      p.y = max(position.y, p.y);
      vAlpha = pow(max(1e-4, sin(t * 3.14159265)), 0.75) * 0.88;
      vSparkle = 0.78 + 0.34 * sin(uTime * 16.0 + aSeed.x * 41.0);
    } else {
      // Class 3: Effervescent surface foam bubbles drifting radially across the pool
      float easeOut = 1.0 - (1.0 - t) * (1.0 - t);
      p = position + aVel * (easeOut * life);
      p.y = position.y + sin(uTime * 6.0 + aSeed.x * 37.0) * 0.005;
      instVel = aVel * (1.0 - t);
      vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t)) * 0.72;
      vSparkle = 0.92;
    }

    // Project instantaneous velocity into screen space to stretch falling droplets along flight path
    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    vec4 clip0 = projectionMatrix * mvPos;
    vec4 clip1 = projectionMatrix * (modelViewMatrix * vec4(p + instVel * 0.045, 1.0));
    vec2 ndcVel = (clip1.xy / max(0.001, clip1.w)) - (clip0.xy / max(0.001, clip0.w));
    float velLen = length(ndcVel);
    vScreenVelDir = velLen > 1e-4 ? (ndcVel / velLen) : vec2(0.0, -1.0);
    vSpeedStretch = clamp(velLen * 18.0, 0.0, 1.0);

    vViewDist = -mvPos.z;
    float sizeMul = (aKind > 0.5 && aKind < 1.5) ? 95.0 : (aKind > 2.5 ? 165.0 : 170.0);
    float maxPx = (aKind > 0.5 && aKind < 1.5) ? 3.8 : (aKind > 2.5 ? 7.5 : 8.5);
    gl_PointSize = clamp(aSeed.z * (sizeMul / max(1.0, vViewDist)), 1.25, maxPx);
    gl_Position = clip0;
  }
`;

const FOUNTAIN_PARTICLES_FRAG = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uDaylight;
  uniform float uNightGlow;
  uniform vec3 uSunColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying float vAlpha;
  varying float vSparkle;
  varying float vKind;
  varying vec2 vScreenVelDir;
  varying float vSpeedStretch;
  varying float vViewDist;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    // Flip Y so screen-space velocity aligns with gl_PointCoord (top-down)
    vec2 vel = vec2(vScreenVelDir.x, -vScreenVelDir.y);
    vec2 perp = vec2(-vel.y, vel.x);

    vec3 col;
    float alpha;
    float daylight = clamp(uDaylight, 0.0, 1.0);
    float lightLevel = mix(0.032, 1.0, daylight);
    float lanternFactor = clamp(uNightGlow, 0.0, 1.0);
    float sunVis = smoothstep(-0.02, 0.20, uSunDirection.y) * daylight;

    if (vKind < 0.5 || (vKind > 1.5 && vKind < 2.5)) {
      // Motion-stretched glistening water droplets & splash beads
      float along = dot(d, vel);
      float across = dot(d, perp);
      float stretch = mix(1.0, 0.48, vSpeedStretch);
      vec2 sd = vec2(along * stretch, across * mix(1.0, 1.45, vSpeedStretch));
      float r2 = dot(sd, sd);
      if (r2 > 0.25) discard;
      float core = exp(-r2 * 22.0);
      float halo = smoothstep(0.25, 0.03, r2);
      // Tiny bright refractive highlight offset inside the bead
      float glint = exp(-dot(d + vec2(0.08, 0.08), d + vec2(0.08, 0.08)) * 42.0);
      vec3 aqua = mix(vec3(0.28, 0.56, 0.68), vec3(0.88, 0.94, 0.98), clamp(core * 0.8 + glint * 0.65, 0.0, 1.0));
      col = aqua * lightLevel * vSparkle
        + uSkyHorizonColor * 0.16
        + uSunColor * glint * 0.48 * sunVis
        + vec3(1.0, 0.66, 0.28) * 0.032 * lanternFactor;
      alpha = halo * vAlpha * mix(0.55, 1.0, daylight);
    } else if (vKind < 1.5) {
      // Crisp atomized micro-spray water beads (never oversized smoke puffs)
      float r2 = dot(d, d);
      if (r2 > 0.22) discard;
      float bead = exp(-r2 * 30.0) * smoothstep(0.22, 0.01, r2);
      col = vec3(0.82, 0.91, 0.96) * lightLevel * vSparkle
        + uSkyHorizonColor * 0.14
        + uSunColor * 0.34 * sunVis
        + vec3(1.0, 0.68, 0.30) * 0.022 * lanternFactor;
      alpha = bead * vAlpha * mix(0.30, 0.72, daylight);
    } else {
      // Effervescent ring-like surface foam bubbles
      float r = length(d);
      if (r > 0.5) discard;
      float rim = smoothstep(0.5, 0.30, r) * (0.55 + 0.45 * smoothstep(0.10, 0.30, r));
      col = vec3(0.76, 0.86, 0.92) * lightLevel
        + uSkyHorizonColor * 0.14
        + vec3(1.0, 0.66, 0.28) * 0.028 * lanternFactor;
      alpha = rim * vAlpha * mix(0.50, 1.0, daylight);
    }

    float fogAmt = 1.0 - exp(-(uFogDensity * vViewDist) * (uFogDensity * vViewDist));
    col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Builds a high-tessellation horizontal annular disc (`y = 0`) with radial rings,
 * `aTier` (0 = lower pool, 1 = upper bowl), and `aEdgeMask` (0 along inner/outer stone rim, 1 in open water).
 */
function buildPolarWaterDiscGeometry(
  innerRadius: number,
  outerRadius: number,
  radialRings: number,
  angularSegs: number,
  tier: number,
  concaveRimRise = 0,
): THREE.BufferGeometry {
  const vertsPerRing = angularSegs + 1;
  const vertCount = (radialRings + 1) * vertsPerRing;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const tiers = new Float32Array(vertCount);
  const edgeMasks = new Float32Array(vertCount);

  let vi = 0;
  for (let r = 0; r <= radialRings; r++) {
    const rf = r / radialRings;
    const radius = innerRadius + (outerRadius - innerRadius) * rf;
    const edgeMask = Math.min(1, Math.min(rf, 1 - rf) * 4.5);
    const yOffset = concaveRimRise > 0 ? Math.max(0, (rf - 0.38) / 0.62) * concaveRimRise : 0;
    for (let s = 0; s <= angularSegs; s++) {
      const af = s / angularSegs;
      const angle = af * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      positions[vi * 3] = x;
      positions[vi * 3 + 1] = yOffset;
      positions[vi * 3 + 2] = z;

      normals[vi * 3] = 0;
      normals[vi * 3 + 1] = 1;
      normals[vi * 3 + 2] = 0;

      uvs[vi * 2] = x / (outerRadius * 2) + 0.5;
      uvs[vi * 2 + 1] = z / (outerRadius * 2) + 0.5;

      tiers[vi] = tier;
      edgeMasks[vi] = edgeMask;
      vi++;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < radialRings; r++) {
    for (let s = 0; s < angularSegs; s++) {
      const a = r * vertsPerRing + s;
      const b = a + vertsPerRing;
      const c = b + 1;
      const d = a + 1;
      // Counter-clockwise winding viewed from +Y
      indices.push(a, d, b, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aTier', new THREE.BufferAttribute(tiers, 1));
  geo.setAttribute('aEdgeMask', new THREE.BufferAttribute(edgeMasks, 1));
  geo.setIndex(indices);
  return geo;
}

/** Adds a constant float vertex attribute to a BufferGeometry. */
function attachConstantAttr(geo: THREE.BufferGeometry, name: string, value: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count);
  arr.fill(value);
  geo.setAttribute(name, new THREE.BufferAttribute(arr, 1));
}

/**
 * Builds the 4-class GPU fountain particle geometry (420 particles):
 * - 132 ballistic jet & cascade droplets
 * - 92 fine drifting sunlit mist puffs
 * - 116 upward splash-crown impact bursts (upper bowl & lower pool)
 * - 80 effervescent surface foam bubbles drifting outward across the pools
 */
export function createFountainParticleGeometry(seed: number): THREE.BufferGeometry {
  const count = 420;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  const kinds = new Float32Array(count);

  const hash = (n: number): number => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  for (let i = 0; i < count; i++) {
    const h1 = hash(i * 6 + 1);
    const h2 = hash(i * 6 + 2);
    const h3 = hash(i * 6 + 3);
    const h4 = hash(i * 6 + 4);
    const h5 = hash(i * 6 + 5);

    if (i < 54) {
      // Class 0a: Upper finial crown jet droplets arcing into upper bowl
      const jetIdx = i % 6;
      const ang = (jetIdx / 6) * Math.PI * 2 + (h1 - 0.5) * 0.14;
      const speedR = 0.72 + h2 * 0.2;
      positions[i * 3] = Math.cos(ang) * 0.045;
      positions[i * 3 + 1] = 1.98;
      positions[i * 3 + 2] = Math.sin(ang) * 0.045;
      velocities[i * 3] = Math.cos(ang) * speedR;
      velocities[i * 3 + 1] = 2.68 + h3 * 0.42;
      velocities[i * 3 + 2] = Math.sin(ang) * speedR;
      seeds[i * 3] = h4;
      seeds[i * 3 + 1] = 0.64 + h5 * 0.12;
      seeds[i * 3 + 2] = 0.16 + h2 * 0.10;
      kinds[i] = 0;
    } else if (i < 132) {
      // Class 0b: Upper-rim cascade droplets plunging into lower pool
      const spoutIdx = (i - 54) % 8;
      const ang = (spoutIdx / 8) * Math.PI * 2 + Math.PI / 8 + (h1 - 0.5) * 0.13;
      const speedR = 0.62 + h2 * 0.22;
      positions[i * 3] = Math.cos(ang) * 0.78;
      positions[i * 3 + 1] = 1.65;
      positions[i * 3 + 2] = Math.sin(ang) * 0.78;
      velocities[i * 3] = Math.cos(ang) * speedR;
      velocities[i * 3 + 1] = 0.28 + h3 * 0.26;
      velocities[i * 3 + 2] = Math.sin(ang) * speedR;
      seeds[i * 3] = h4;
      seeds[i * 3 + 1] = 0.54 + h5 * 0.12;
      seeds[i * 3 + 2] = 0.18 + h2 * 0.11;
      kinds[i] = 0;
    } else if (i < 224) {
      // Class 1: Crisp atomized micro-spray droplets ejected right around the splash impact rings
      const isLower = (i - 132) < 62;
      if (isLower) {
        const spoutIdx = i % 8;
        const ang = (spoutIdx / 8) * Math.PI * 2 + Math.PI / 8 + (h1 - 0.5) * 0.32;
        const scatterAng = ang + (h3 - 0.5) * 1.9;
        const r = 1.07 + h2 * 0.13;
        const spd = 0.20 + h4 * 0.34;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 0.48 + h3 * 0.06;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(scatterAng) * spd;
        velocities[i * 3 + 1] = 0.62 + h5 * 0.52;
        velocities[i * 3 + 2] = Math.sin(scatterAng) * spd;
      } else {
        const jetIdx = i % 6;
        const ang = (jetIdx / 6) * Math.PI * 2 + (h1 - 0.5) * 0.28;
        const scatterAng = ang + (h3 - 0.5) * 1.8;
        const r = 0.49 + h2 * 0.09;
        const spd = 0.16 + h4 * 0.26;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 1.67 + h3 * 0.05;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(scatterAng) * spd;
        velocities[i * 3 + 1] = 0.48 + h5 * 0.44;
        velocities[i * 3 + 2] = Math.sin(scatterAng) * spd;
      }
      seeds[i * 3] = h4;
      seeds[i * 3 + 1] = 0.42 + h5 * 0.30;
      seeds[i * 3 + 2] = 0.09 + h2 * 0.08;
      kinds[i] = 1;
    } else if (i < 340) {
      // Class 2: Energetic splash bursts erupting at the 6 upper & 8 lower plunge points
      const isUpper = i < 264;
      if (isUpper) {
        const jetIdx = (i - 224) % 6;
        const ang = (jetIdx / 6) * Math.PI * 2 + (h1 - 0.5) * 0.22;
        const r = 0.51 + h2 * 0.07;
        const scatterAng = ang + (h3 - 0.5) * 2.2;
        const spd = 0.18 + h4 * 0.26;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 1.665;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(scatterAng) * spd;
        velocities[i * 3 + 1] = 0.95 + h5 * 0.65;
        velocities[i * 3 + 2] = Math.sin(scatterAng) * spd;
        seeds[i * 3] = h4;
        seeds[i * 3 + 1] = 0.30 + h2 * 0.14;
        seeds[i * 3 + 2] = 0.12 + h1 * 0.08;
      } else {
        const spoutIdx = (i - 264) % 8;
        const ang = (spoutIdx / 8) * Math.PI * 2 + Math.PI / 8 + (h1 - 0.5) * 0.20;
        const r = 1.10 + h2 * 0.10;
        const scatterAng = ang + (h3 - 0.5) * 2.4;
        const spd = 0.24 + h4 * 0.34;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 0.47;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(scatterAng) * spd;
        velocities[i * 3 + 1] = 1.15 + h5 * 0.85;
        velocities[i * 3 + 2] = Math.sin(scatterAng) * spd;
        seeds[i * 3] = h4;
        seeds[i * 3 + 1] = 0.36 + h2 * 0.16;
        seeds[i * 3 + 2] = 0.14 + h1 * 0.09;
      }
      kinds[i] = 2;
    } else {
      // Class 3: Effervescent foam bubbles gliding radially across the pools from splash sites
      const isUpper = i < 366;
      if (isUpper) {
        const jetIdx = (i - 340) % 6;
        const ang = (jetIdx / 6) * Math.PI * 2 + (h1 - 0.5) * 0.35;
        const driftDir = h2 > 0.5 ? 1 : -1;
        const r = 0.53 + (h3 - 0.5) * 0.06;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 1.668;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(ang + (h4 - 0.5) * 0.9) * (0.08 * driftDir);
        velocities[i * 3 + 1] = 0;
        velocities[i * 3 + 2] = Math.sin(ang + (h4 - 0.5) * 0.9) * (0.08 * driftDir);
      } else {
        const spoutIdx = (i - 366) % 8;
        const ang = (spoutIdx / 8) * Math.PI * 2 + Math.PI / 8 + (h1 - 0.5) * 0.34;
        const driftDir = h2 > 0.32 ? -1 : 1; // most bubbles drift inward toward the deep pool
        const r = 1.12 + (h3 - 0.5) * 0.08;
        positions[i * 3] = Math.cos(ang) * r;
        positions[i * 3 + 1] = 0.476;
        positions[i * 3 + 2] = Math.sin(ang) * r;
        velocities[i * 3] = Math.cos(ang + (h4 - 0.5) * 1.1) * (0.16 * driftDir);
        velocities[i * 3 + 1] = 0;
        velocities[i * 3 + 2] = Math.sin(ang + (h4 - 0.5) * 1.1) * (0.16 * driftDir);
      }
      seeds[i * 3] = h4;
      seeds[i * 3 + 1] = 1.2 + h5 * 0.95;
      seeds[i * 3 + 2] = 0.14 + h2 * 0.09;
      kinds[i] = 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(velocities, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  return geo;
}

/**
 * Owns the shared GPU shaders & geometries for all plaza fountains so every
 * village fountain exhibits real-time refracted caustics, multi-source dynamic
 * capillary waves, Fresnel reflections, flowing aerated jets, ray-marched
 * volumetric mist, and a 4-class ballistic/splash/foam particle system.
 */
export class FountainWaterSystem {
  readonly uniforms: FountainWaterUniforms;

  readonly causticsFloorMat: THREE.ShaderMaterial;
  readonly causticsWallMat: THREE.ShaderMaterial;
  readonly surfaceMat: THREE.ShaderMaterial;
  readonly streamMat: THREE.ShaderMaterial;
  readonly volumetricMistMat: THREE.ShaderMaterial;
  readonly foamBoilMat: THREE.ShaderMaterial;
  readonly particleMat: THREE.ShaderMaterial;

  // Shared reusable geometries (disposed cleanly with the system)
  readonly sharedGeometries: readonly THREE.BufferGeometry[];
  private readonly lowerCausticsGeo: THREE.BufferGeometry;
  private readonly lowerInnerWallGeo: THREE.BufferGeometry;
  private readonly upperCausticsGeo: THREE.BufferGeometry;
  private readonly lowerSurfaceGeo: THREE.BufferGeometry;
  private readonly upperSurfaceGeo: THREE.BufferGeometry;
  private readonly lowerFoamGeo: THREE.BufferGeometry;
  private readonly upperFoamGeo: THREE.BufferGeometry;
  private readonly mistVolumeGeo: THREE.BufferGeometry;

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uSkyTopColor: { value: new THREE.Color(0x4b87c6) },
      uSkyHorizonColor: { value: new THREE.Color(0xcde2ec) },
      uFogColor: { value: new THREE.Color(0xb8d1d9) },
      uFogDensity: { value: 0.0012 },
      uDaylight: { value: 1 },
      uNightGlow: { value: 0 },
      uWind: { value: new THREE.Vector2(0.18, 0.1) },
    };

    const sharedUniformMap = {
      uTime: this.uniforms.uTime,
      uSunDirection: this.uniforms.uSunDirection,
      uSunColor: this.uniforms.uSunColor,
      uSkyTopColor: this.uniforms.uSkyTopColor,
      uSkyHorizonColor: this.uniforms.uSkyHorizonColor,
      uFogColor: this.uniforms.uFogColor,
      uFogDensity: this.uniforms.uFogDensity,
      uDaylight: this.uniforms.uDaylight,
      uNightGlow: this.uniforms.uNightGlow,
      uWind: this.uniforms.uWind,
    };

    this.causticsFloorMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: CAUSTICS_FLOOR_VERT,
      fragmentShader: CAUSTICS_FLOOR_FRAG,
    });

    this.causticsWallMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: CAUSTICS_FLOOR_VERT,
      fragmentShader: CAUSTICS_FLOOR_FRAG,
      side: THREE.BackSide,
    });

    this.surfaceMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: FOUNTAIN_SURFACE_VERT,
      fragmentShader: FOUNTAIN_SURFACE_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.streamMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: FOUNTAIN_STREAM_VERT,
      fragmentShader: FOUNTAIN_STREAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.volumetricMistMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: VOLUMETRIC_MIST_VERT,
      fragmentShader: VOLUMETRIC_MIST_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.foamBoilMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: FOAM_BOIL_VERT,
      fragmentShader: FOAM_BOIL_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.particleMat = new THREE.ShaderMaterial({
      uniforms: sharedUniformMap,
      vertexShader: FOUNTAIN_PARTICLES_VERT,
      fragmentShader: FOUNTAIN_PARTICLES_FRAG,
      transparent: true,
      depthWrite: false,
    });

    // Shared submerged caustics basin floors & inner wet basin wall
    this.lowerCausticsGeo = buildPolarWaterDiscGeometry(0.40, 1.42, 6, 36, 0);
    this.lowerInnerWallGeo = new THREE.CylinderGeometry(1.43, 1.43, 0.18, 32, 1, true);
    attachConstantAttr(this.lowerInnerWallGeo, 'aTier', 0);
    this.upperCausticsGeo = buildPolarWaterDiscGeometry(0.08, 0.665, 5, 24, 1, 0.072);

    // High-tessellation dynamic capillary water surfaces
    this.lowerSurfaceGeo = buildPolarWaterDiscGeometry(0.41, 1.40, 16, 48, 0);
    this.upperSurfaceGeo = buildPolarWaterDiscGeometry(0.09, 0.702, 10, 32, 1);

    // Bubbling aerated splash-boil collars at the plunge rings
    this.lowerFoamGeo = new THREE.TorusGeometry(1.14, 0.042, 8, 40);
    this.lowerFoamGeo.rotateX(Math.PI / 2);
    attachConstantAttr(this.lowerFoamGeo, 'aTier', 0);

    this.upperFoamGeo = new THREE.TorusGeometry(0.54, 0.030, 8, 30);
    this.upperFoamGeo.rotateX(Math.PI / 2);
    attachConstantAttr(this.upperFoamGeo, 'aTier', 1);

    // Enclosing volumetric ray-march cylinder spanning lower splash -> top finial plume
    this.mistVolumeGeo = new THREE.CylinderGeometry(1.50, 1.50, 2.26, 28, 1, false);
    this.mistVolumeGeo.translate(0, 1.54, 0);

    this.sharedGeometries = [
      this.lowerCausticsGeo,
      this.lowerInnerWallGeo,
      this.upperCausticsGeo,
      this.lowerSurfaceGeo,
      this.upperSurfaceGeo,
      this.lowerFoamGeo,
      this.upperFoamGeo,
      this.mistVolumeGeo,
    ];
  }

  /** Materials to pre-compile during startup splash screen warmup. */
  getWarmupMaterials(): THREE.Material[] {
    return [
      this.causticsFloorMat,
      this.causticsWallMat,
      this.surfaceMat,
      this.streamMat,
      this.volumetricMistMat,
      this.foamBoilMat,
      this.particleMat,
    ];
  }

  /** Synchronizes shared fountain water shader uniforms with live world atmosphere & wind. */
  update(
    elapsedSec: number,
    daylight: number,
    nightGlow: number,
    windX: number,
    windZ: number,
    sunX: number,
    sunY: number,
    sky?: SkyLightingState,
  ): void {
    this.uniforms.uTime.value = elapsedSec;
    this.uniforms.uDaylight.value = sky?.daylight ?? daylight;
    this.uniforms.uNightGlow.value = nightGlow;
    this.uniforms.uWind.value.set(windX, windZ);

    if (sky) {
      this.uniforms.uSunDirection.value.copy(sky.sunDirection).normalize();
      this.uniforms.uSunColor.value.copy(sky.sunColor);
      this.uniforms.uSkyTopColor.value.copy(sky.skyTopColor);
      this.uniforms.uSkyHorizonColor.value.copy(sky.skyHorizonColor);
      this.uniforms.uFogColor.value.copy(sky.fogColor);
      this.uniforms.uFogDensity.value = sky.fogDensity;
    } else {
      this.uniforms.uSunDirection.value.set(sunX, sunY, 0.42).normalize();
    }
  }

  /**
   * Builds all water layers for a single carved two-tier plaza fountain:
   * submerged caustics floors + inner wall, dynamic capillary water surfaces,
   * 14 flowing refractive parabolic TubeGeometry arcs, animated aerated splash-boil
   * collars, ray-marched volumetric mist enclosure, and 420-particle 4-class GPU spray.
   */
  createFountainAssembly(
    seed: number,
    selectionTarget: { kind: 'building'; id: string },
  ): FountainWaterAssembly {
    const waterGroup = new THREE.Group();
    waterGroup.userData.buildPhase = 'exterior';
    waterGroup.userData.selectionTarget = selectionTarget;

    const tagMesh = (mesh: THREE.Mesh, layer: string, renderOrder: number): THREE.Mesh => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = renderOrder;
      mesh.userData.buildPhase = 'exterior';
      mesh.userData.selectionTarget = selectionTarget;
      mesh.userData.fountainLayer = layer;
      return mesh;
    };

    // 1. Submerged caustics basin floors & inner wet basin wall
    const lowerFloor = tagMesh(
      new THREE.Mesh(this.lowerCausticsGeo, this.causticsFloorMat),
      'caustics_floor',
      0,
    );
    lowerFloor.position.y = 0.305;
    waterGroup.add(lowerFloor);

    const lowerInnerWall = tagMesh(
      new THREE.Mesh(this.lowerInnerWallGeo, this.causticsWallMat),
      'caustics_wall',
      0,
    );
    lowerInnerWall.position.y = 0.39;
    waterGroup.add(lowerInnerWall);

    const upperFloor = tagMesh(
      new THREE.Mesh(this.upperCausticsGeo, this.causticsFloorMat),
      'caustics_floor',
      0,
    );
    upperFloor.position.y = 1.548;
    waterGroup.add(upperFloor);

    // 2. Dynamic capillary-wave basin surfaces (with Fresnel reflection & impact foam)
    const lowerSurface = tagMesh(
      new THREE.Mesh(this.lowerSurfaceGeo, this.surfaceMat),
      'water_surface',
      1,
    );
    lowerSurface.position.y = 0.468;
    waterGroup.add(lowerSurface);

    const upperSurface = tagMesh(
      new THREE.Mesh(this.upperSurfaceGeo, this.surfaceMat),
      'water_surface',
      1,
    );
    upperSurface.position.y = 1.662;
    waterGroup.add(upperSurface);

    // 3. 14 Flowing, refractive & aerated parabolic water streams (6 upper jets + 8 rim cascades)
    const jetsGroup = new THREE.Group();
    jetsGroup.userData.buildPhase = 'exterior';
    jetsGroup.userData.selectionTarget = selectionTarget;

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(ca * 0.04, 1.98, sa * 0.04),
        new THREE.Vector3(ca * 0.28, 2.54, sa * 0.28),
        new THREE.Vector3(ca * 0.54, 1.65, sa * 0.54),
      );
      const tubeGeo = new THREE.TubeGeometry(curve, 22, 0.022, 10, false);
      attachConstantAttr(tubeGeo, 'aStreamPhase', i * 1.13 + seed * 0.17);
      const jetMesh = tagMesh(new THREE.Mesh(tubeGeo, this.streamMat), 'parabolic_stream', 2);
      jetsGroup.add(jetMesh);
    }

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(ca * 0.78, 1.66, sa * 0.78),
        new THREE.Vector3(ca * 1.06, 1.38, sa * 1.06),
        new THREE.Vector3(ca * 1.14, 0.46, sa * 1.14),
      );
      const tubeGeo = new THREE.TubeGeometry(curve, 22, 0.028, 10, false);
      attachConstantAttr(tubeGeo, 'aStreamPhase', (i + 6) * 1.37 + seed * 0.23);
      const cascadeMesh = tagMesh(new THREE.Mesh(tubeGeo, this.streamMat), 'parabolic_stream', 2);
      jetsGroup.add(cascadeMesh);
    }

    // 4. Bubbling aerated splash-boil collars at the plunge zones
    const upperFoam = tagMesh(
      new THREE.Mesh(this.upperFoamGeo, this.foamBoilMat),
      'splash_foam',
      2,
    );
    upperFoam.position.y = 1.668;
    jetsGroup.add(upperFoam);

    const lowerFoam = tagMesh(
      new THREE.Mesh(this.lowerFoamGeo, this.foamBoilMat),
      'splash_foam',
      2,
    );
    lowerFoam.position.y = 0.474;
    jetsGroup.add(lowerFoam);

    waterGroup.add(jetsGroup);

    // 5. Ray-marched volumetric splash mist & sunlit vapor enclosure
    const volumetricMist = tagMesh(
      new THREE.Mesh(this.mistVolumeGeo, this.volumetricMistMat),
      'volumetric_mist',
      3,
    );
    waterGroup.add(volumetricMist);

    // 6. 4-class GPU particle system (ballistic droplets, airborne mist, splash bursts, surface foam)
    const particles = new THREE.Points(
      createFountainParticleGeometry(seed),
      this.particleMat,
    );
    particles.renderOrder = 4;
    particles.userData.fountainLayer = 'particle_spray';
    particles.userData.selectionTarget = selectionTarget;

    return {
      waterGroup,
      jetsGroup,
      particles,
      volumetricMist,
    };
  }

  dispose(): void {
    for (const geo of this.sharedGeometries) {
      geo.dispose();
    }
    this.causticsFloorMat.dispose();
    this.causticsWallMat.dispose();
    this.surfaceMat.dispose();
    this.streamMat.dispose();
    this.volumetricMistMat.dispose();
    this.foamBoilMat.dispose();
    this.particleMat.dispose();
  }
}
