import * as THREE from 'three';
import type { TerrainMap } from '@simulation/terrain/TerrainMap';

export interface SkyLightingState {
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly skyTopColor: THREE.Color;
  readonly skyHorizonColor: THREE.Color;
  readonly fogColor: THREE.Color;
  readonly fogDensity: number;
  readonly daylight: number;
  readonly windStrength: number;
  readonly isWinter: boolean;
  readonly cloudTime?: number;
  readonly cloudCoverage?: number;
  readonly rainWetness?: number;
}

const WATER_VERTEX_SHADER = /* glsl */ `
  attribute float aDepth;
  attribute vec2 aFlow;

  uniform float uTime;
  uniform float uWindStrength;

  varying vec3 vWorldPos;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vViewDist;

  void main() {
    vDepth = aDepth;
    vFlow = aFlow;

    vec3 pos = position;
    // Gentle physical surface swell attenuated smoothly to 0 along the shoreline
    float shoreMask = smoothstep(0.0, 0.55, aDepth);
    vec4 wp0 = modelMatrix * vec4(pos, 1.0);
    float d1 = dot(wp0.xz, vec2(0.83, 0.55));
    float d2 = dot(wp0.xz, vec2(-0.42, 0.91));
    float d3 = dot(wp0.xz, vec2(0.29, -0.96));
    float w1 = sin(d1 * 0.34 + uTime * 1.25) * 0.014;
    float w2 = cos(d2 * 0.67 + uTime * 1.72) * 0.008;
    float w3 = sin(d3 * 0.14 + uTime * 0.78) * 0.026 * smoothstep(0.6, 2.6, aDepth);
    float farCalm = 1.0 - smoothstep(900.0, 2600.0, length(wp0.xz));
    pos.y += (w1 + w2 + w3) * shoreMask * farCalm * (0.7 + uWindStrength * 0.65);

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;

    vec4 mvPos = viewMatrix * worldPos;
    vViewDist = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDaylight;
  uniform float uWindStrength;
  uniform float uWinter;
  uniform float uMaxExtent;
  uniform float uCloudTime;
  uniform float uCloudCoverage;

  varying vec3 vWorldPos;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vViewDist;

  // Isotropic 2D Simplex Gradient Noise (triangular lattice: zero axis-aligned grid artifacts)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187,
      0.366025403784439,
     -0.577350269189626,
      0.024390243902439
    );
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float snoise01(vec2 p) {
    return snoise(p) * 0.5 + 0.5;
  }

  // Exact 2D Simplex Noise + analytical world-space gradient: vec3(value, dVal/dx, dVal/dy)
  vec3 snoiseD(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187,
      0.366025403784439,
     -0.577350269189626,
      0.024390243902439
    );
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 x1 = x0 + C.xx - i1;
    vec2 x2 = x0 + C.zz;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec3 m2 = m * m;
    vec3 m3 = m2 * m;
    vec3 m4 = m2 * m2;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    vec3 norm = 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec2 g0 = vec2(a0.x, h.x) * norm.x;
    vec2 g1 = vec2(a0.y, h.y) * norm.y;
    vec2 g2 = vec2(a0.z, h.z) * norm.z;
    vec3 dotG = vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2));
    float val = 130.0 * dot(m4, dotG);
    vec2 grad = 130.0 * (
      m4.x * g0 - 8.0 * m3.x * dotG.x * x0 +
      m4.y * g1 - 8.0 * m3.y * dotG.y * x1 +
      m4.z * g2 - 8.0 * m3.z * dotG.z * x2
    );
    return vec3(val, grad);
  }

  float fbmCloud(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      v += a * snoise01(p);
      p = rot * p * 2.04 + vec2(11.3, 7.7);
      a *= 0.5;
    }
    return v;
  }

  // Aperiodic 5-band analytical-gradient simplex wave spectrum with bounded dual-phase flow advection
  // (eliminates chevron/herringbone shear across river currents, square tiling, and zoom repetition)
  vec2 waveGrad(vec2 p, vec2 adv0, vec2 adv1, float flowBlend, float t, float viewDist, float depth) {
    // Gentle low-frequency eddy domain warp bends wave fronts organically across bays & rivers
    vec2 warp = vec2(
      snoise(p * 0.018 + vec2(t * 0.020, -t * 0.014)),
      snoise(p * 0.018 + vec2(37.4, -23.1) + vec2(-t * 0.016, t * 0.022))
    );
    vec2 wp = p + warp * 2.2;

    // Irrational non-aligned rotations so wave fronts never align with world axes or each other
    mat2 R1 = mat2( 0.809,  0.588, -0.588,  0.809); // ~36 deg
    mat2 R2 = mat2(-0.375,  0.927, -0.927, -0.375); // ~112 deg
    mat2 R3 = mat2(-0.956, -0.292,  0.292, -0.956); // ~197 deg
    mat2 R4 = mat2( 0.017, -0.999,  0.999,  0.017); // ~271 deg

    float openMask = smoothstep(0.35, 2.2, depth);
    float a1 = 1.0 / (1.0 + viewDist * 0.00055);
    float a2 = 1.0 / (1.0 + viewDist * 0.0024);
    float a3 = 1.0 / (1.0 + viewDist * 0.0085);
    float a4 = 1.0 / (1.0 + viewDist * 0.028);

    // Band 0: Broad open-water rolling swells (~40m wavelength, purely wind-driven)
    float amp0 = 1.35 * openMask + 0.18;
    vec2 grad = snoiseD(wp * 0.025 + vec2(t * 0.050, -t * 0.034)).yz * (0.025 * amp0);

    // Band 1: Medium cross-swells (~14m wavelength, purely wind-driven)
    float amp1 = 0.68 * (0.35 + 0.65 * openMask) * a1;
    vec2 g1 = snoiseD((R1 * wp) * 0.072 + vec2(-t * 0.088, t * 0.064)).yz;
    grad += (g1 * R1) * (0.072 * amp1);

    // Band 2: Mid-zoom wind chop (~4.6m wavelength, dual-phase current-advected)
    if (a2 > 0.04) {
      float w2 = a2 * smoothstep(0.04, 0.14, a2);
      vec2 wind2 = vec2(t * 0.14, t * 0.10);
      vec2 g2a = snoiseD((R2 * (wp + adv0 * 0.65)) * 0.215 + wind2).yz;
      vec2 g2b = snoiseD((R2 * (wp + adv1 * 0.65)) * 0.215 + wind2).yz;
      grad += (mix(g2a, g2b, flowBlend) * R2) * (0.215 * 0.28 * w2);
    }

    // Band 3: River & pond ripples (~1.55m wavelength, dual-phase current-advected)
    if (a3 > 0.04) {
      float w3 = a3 * smoothstep(0.04, 0.14, a3);
      vec2 wp3 = p + warp * 0.75;
      vec2 wind3 = vec2(-t * 0.22, t * 0.18);
      vec2 g3a = snoiseD((R3 * (wp3 + adv0)) * 0.64 + wind3).yz;
      vec2 g3b = snoiseD((R3 * (wp3 + adv1)) * 0.64 + wind3).yz;
      grad += (mix(g3a, g3b, flowBlend) * R3) * (0.64 * 0.125 * w3);
    }

    // Band 4: Close-up capillary sparkle wavelets (~0.58m wavelength, dual-phase current-advected)
    if (a4 > 0.04) {
      float w4 = a4 * smoothstep(0.04, 0.14, a4);
      vec2 wind4 = vec2(t * 0.34, -t * 0.27);
      vec2 g4a = snoiseD((R4 * (p + adv0 * 1.15)) * 1.72 + wind4).yz;
      vec2 g4b = snoiseD((R4 * (p + adv1 * 1.15)) * 1.72 + wind4).yz;
      grad += (mix(g4a, g4b, flowBlend) * R4) * (1.72 * 0.048 * w4);
    }

    return grad;
  }

  // Dual-layer refracted sunlit riverbed caustic web (simplex-based, zero grid lines)
  float causticsSample(vec2 p, float t) {
    mat2 RC = mat2(0.766, 0.643, -0.643, 0.766);
    vec2 uv1 = p * 0.72 + vec2(t * 0.12, -t * 0.09);
    vec2 uv2 = (RC * p) * 1.03 + vec2(-t * 0.10, t * 0.14);
    float n1 = abs(snoise(uv1));
    float n2 = abs(snoise(uv2));
    float ridge1 = pow(max(0.0, 1.0 - n1), 4.5);
    float ridge2 = pow(max(0.0, 1.0 - n2), 4.5);
    return clamp((ridge1 + ridge2) * 0.68, 0.0, 1.20);
  }

  float causticsPattern(vec2 p, vec2 adv0, vec2 adv1, float flowBlend, float t) {
    return mix(causticsSample(p + adv0, t), causticsSample(p + adv1, t), flowBlend);
  }

  void main() {
    if (vDepth < -0.02) discard;

    float depth = max(vDepth, 0.0);
    float shoreFade = smoothstep(-0.015, 0.12, vDepth);
    float detailAtten = 1.0 / (1.0 + vViewDist * 0.012);

    // Dual-phase cyclic flow advection: keeps UV displacement strictly bounded (<= half-cycle)
    // so spatially varying river currents glide smoothly without shearing into chevron stripes.
    float flowCycle = 3.6;
    float phase0 = fract(uTime / flowCycle);
    float phase1 = fract(uTime / flowCycle + 0.5);
    float flowBlend = abs(2.0 * phase0 - 1.0);
    vec2 adv0 = -vFlow * ((phase0 - 0.5) * flowCycle * 0.78);
    vec2 adv1 = -vFlow * ((phase1 - 0.5) * flowCycle * 0.78);

    // Organic drifting wind-gust patches ("cat's paws") break uniformity across wide lakes & sea
    float windPatch = smoothstep(
      -0.38,
      0.54,
      snoise(vWorldPos.xz * 0.0088 + vec2(uTime * 0.015, -uTime * 0.011)) * 0.65 +
      snoise(vWorldPos.xz * 0.024 + vec2(-uTime * 0.021, uTime * 0.014) + vec2(19.2, 41.7)) * 0.35
    );

    // 1. Exact analytical gradient normal from aperiodic 5-band simplex wave spectrum
    vec2 waveD = waveGrad(vWorldPos.xz, adv0, adv1, flowBlend, uTime, vViewDist, depth);

    float rippleStrength =
      (0.24 + uWindStrength * 0.22) *
      (0.40 + 0.60 * smoothstep(0.0, 0.42, depth)) *
      mix(0.48, 1.24, windPatch);
    vec3 N = normalize(vec3(-waveD.x * rippleStrength, 1.0, -waveD.y * rippleStrength));
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDirection);

    // 2. Natural Beer-Lambert optical water absorption (realistic river tannins & deep marine slate)
    float lightLevel = mix(0.20, 1.0, uDaylight);
    vec3 shallowCol = mix(vec3(0.23, 0.26, 0.17), vec3(0.21, 0.27, 0.30), uWinter);
    vec3 midCol = mix(vec3(0.062, 0.165, 0.155), vec3(0.072, 0.150, 0.195), uWinter);
    vec3 deepCol = mix(vec3(0.018, 0.066, 0.095), vec3(0.024, 0.062, 0.108), uWinter);

    float midFactor = 1.0 - exp(-depth * 2.25);
    float deepFactor = 1.0 - exp(-depth * 0.78);
    vec3 bodyColor = mix(shallowCol, midCol, midFactor);
    bodyColor = mix(bodyColor, deepCol, deepFactor);
    bodyColor *= lightLevel;

    // 3. Refracted sunlit underwater caustics in clear shallows
    float clearSkySun = mix(1.0, 0.35, clamp(uCloudCoverage, 0.0, 1.0));
    float causticVis = exp(-depth * 2.15) * smoothstep(0.02, 0.22, depth) * uDaylight * clearSkySun;
    if (causticVis > 0.005) {
      float caustics = causticsPattern(vWorldPos.xz + N.xz * 0.42, adv0, adv1, flowBlend, uTime);
      bodyColor += uSunColor * caustics * causticVis * 0.24;
    }

    // 4. Physically-based Schlick Fresnel (water IOR 1.333 => F0 = 0.02)
    float NdotV = max(dot(N, V), 0.001);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

    vec3 R = reflect(-V, N);
    float refH = clamp(R.y, 0.0, 1.0);
    vec3 skyRef = mix(uSkyHorizonColor, uSkyTopColor, pow(refH, 0.52));

    // Reflected drifting clouds synchronized with AtmosphereSystem sky dome
    if (refH > 0.03) {
      vec2 cloudUv = (R.xz / (refH + 0.18)) * 0.42 + vec2(uCloudTime * 0.011, uCloudTime * 0.0045);
      float cn = fbmCloud(cloudUv);
      float cThresh = mix(0.64, 0.34, clamp(uCloudCoverage, 0.0, 1.0));
      float cMask = smoothstep(cThresh, cThresh + 0.24, cn) * smoothstep(0.03, 0.22, refH);
      vec3 cLit = mix(vec3(0.24, 0.28, 0.35), mix(vec3(0.86, 0.88, 0.90), uSunColor, 0.28), uDaylight);
      skyRef = mix(skyRef, cLit, cMask * 0.62);
    }

    // Woodland canopy & bank reflection darkening at low reflection angles near shore
    vec3 canopyTint = mix(vec3(0.055, 0.105, 0.058), vec3(0.14, 0.17, 0.20), uWinter) * lightLevel;
    float canopyBand = smoothstep(0.36, 0.015, refH) * (0.48 + 0.42 * exp(-depth * 0.85));
    vec3 envReflection = mix(skyRef, canopyTint, canopyBand * 0.62);

    vec3 color = mix(bodyColor, envReflection, clamp(fresnel * 0.94, 0.04, 0.94));

    // 5. Distance-filtered specular sun / moon glitter across capillary ripples
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float sunHeightFade = smoothstep(-0.08, 0.22, L.y);
    float specPower = mix(85.0, 360.0, detailAtten) * mix(1.35, 0.78, windPatch);
    float specScale = mix(0.62, 2.25, detailAtten);
    float glitter = pow(NdotH, specPower) * specScale + pow(NdotH, 32.0) * 0.18;
    vec3 specTint = mix(vec3(0.48, 0.64, 0.88), uSunColor, uDaylight);
    color += specTint * glitter * (0.30 + 0.80 * sunHeightFade) * clearSkySun;

    // 6. Delicate natural shore meniscus & subtle shallow-riffle crest froth (no polka-dot noise)
    float foamA =
      snoise01((vWorldPos.xz + adv0) * 1.45) * 0.62 +
      snoise01((vWorldPos.xz + adv0) * 3.7 + vec2(17.3, -9.1)) * 0.38;
    float foamB =
      snoise01((vWorldPos.xz + adv1) * 1.45) * 0.62 +
      snoise01((vWorldPos.xz + adv1) * 3.7 + vec2(17.3, -9.1)) * 0.38;
    float foamNoise = mix(foamA, foamB, flowBlend);
    float lapWave = 0.5 + 0.5 * sin(depth * 18.0 - uTime * 1.85 + foamNoise * 3.6);
    float shoreBand = (1.0 - smoothstep(0.01, 0.14, depth)) * smoothstep(0.0, 0.03, depth);
    float shoreFoam = shoreBand * smoothstep(0.62, 0.90, lapWave * 0.48 + foamNoise * 0.52) * detailAtten;

    float flowSpeed = length(vFlow);
    float slopeMag = length(waveD);
    float riffleMask =
      smoothstep(0.45, 0.95, flowSpeed) *
      smoothstep(0.06, 0.28, depth) *
      (1.0 - smoothstep(0.30, 0.72, depth));
    float riffleFoam = riffleMask * smoothstep(0.30, 0.62, slopeMag + (foamNoise - 0.5) * 0.25) * 0.20 * detailAtten;

    vec3 foamColor = mix(vec3(0.42, 0.48, 0.54), mix(vec3(0.84, 0.87, 0.86), uSunColor, 0.15), uDaylight);
    float totalFoam = clamp(shoreFoam * 0.34 + riffleFoam, 0.0, 0.48);
    color = mix(color, foamColor, totalFoam);

    // 7. Depth-aware optical clarity alpha + smooth far-horizon dissolve
    float waterAlpha = clamp(
      mix(0.18, 0.92, 1.0 - exp(-depth * 1.18)) + fresnel * 0.34 + totalFoam * 0.36,
      0.0,
      0.98
    );
    float worldRad = length(vWorldPos.xz);
    float rimMist = smoothstep(uMaxExtent * 0.86, uMaxExtent * 0.97, worldRad);
    float edgeFade = 1.0 - smoothstep(uMaxExtent * 0.94, uMaxExtent * 0.996, worldRad);
    waterAlpha *= shoreFade * edgeFade;

    // 8. Exact Three.js FogExp2 integration + seamless outer ocean horizon dissolve
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
    color = mix(color, uFogColor, clamp(max(fogFactor, rimMist), 0.0, 1.0));

    gl_FragColor = vec4(color, waterAlpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface RealisticWaterSurface {
  readonly mesh: THREE.Mesh;
  update(dt: number, sky: SkyLightingState): void;
  dispose(): void;
}

/**
 * Matches TerrainRenderer's C1-smooth non-uniform coordinate warp so rivers,
 * tributaries, ponds, and coastal estuaries stay high-resolution inside the playable
 * world while the open ocean stretches seamlessly to the distant horizon.
 */
function warpWaterCoord(u: number, halfCore: number, horizonExtent: number): number {
  const coreFrac = 0.68;
  const sign = u < 0 ? -1 : 1;
  const a = Math.abs(u);
  if (a <= coreFrac) {
    return sign * (a / coreFrac) * halfCore;
  }
  const t = (a - coreFrac) / (1 - coreFrac);
  const linearSlope = (halfCore / coreFrac) * (1 - coreFrac);
  const extraSpan = Math.max(0, horizonExtent - halfCore - linearSlope);
  return sign * (halfCore + linearSlope * t + extraSpan * Math.pow(t, 3.2));
}

/**
 * Builds a terrain-aware high-resolution water surface mesh with per-vertex water depth
 * and river-aligned flow vectors, extending seamlessly beyond the playable valley into
 * the distant misty hills.
 */
export function createRealisticWaterSurface(
  terrain: TerrainMap,
  worldSize: number,
  segments = 160,
  extentMultiplier = 1.0,
): RealisticWaterSurface {
  const halfCore = worldSize * 0.56;
  const half = Math.max(halfCore, worldSize * extentMultiplier);
  const waterLevel = terrain.waterLevel;

  const coords = new Float32Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const u = -1 + (i / segments) * 2;
    coords[i] = extentMultiplier > 1.05 ? warpWaterCoord(u, halfCore, half) : u * half;
  }

  // Precompute grid heights to prune dry tiles far from water
  const cols = segments + 1;
  const heights = new Float32Array(cols * cols);
  for (let iz = 0; iz <= segments; iz++) {
    const z = coords[iz];
    for (let ix = 0; ix <= segments; ix++) {
      const x = coords[ix];
      heights[iz * cols + ix] = terrain.getHeightAt(x, z);
    }
  }

  const positions: number[] = [];
  const depths: number[] = [];
  const flows: number[] = [];
  const indices: number[] = [];
  const vertIndexMap = new Int32Array(cols * cols).fill(-1);

  const getOrAddVertex = (ix: number, iz: number): number => {
    const key = iz * cols + ix;
    if (vertIndexMap[key] !== -1) return vertIndexMap[key];

    const x = coords[ix];
    const z = coords[iz];
    const h = heights[key];
    const depth = waterLevel - h;

    // Downstream river flow vector, gracefully calmed inside procedural glade pond(s)
    const flow = terrain.getWaterFlowAt(x, z);

    const idx = positions.length / 3;
    positions.push(x, waterLevel, z);
    depths.push(depth);
    flows.push(flow.x, flow.z);
    vertIndexMap[key] = idx;
    return idx;
  };

  // Emit only quads near or under waterLevel (huge vertex savings with zero visual loss)
  const shoreMargin = 0.75;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const h00 = heights[iz * cols + ix];
      const h10 = heights[iz * cols + (ix + 1)];
      const h01 = heights[(iz + 1) * cols + ix];
      const h11 = heights[(iz + 1) * cols + (ix + 1)];
      if (
        h00 > waterLevel + shoreMargin &&
        h10 > waterLevel + shoreMargin &&
        h01 > waterLevel + shoreMargin &&
        h11 > waterLevel + shoreMargin
      ) {
        continue;
      }

      const v00 = getOrAddVertex(ix, iz);
      const v10 = getOrAddVertex(ix + 1, iz);
      const v01 = getOrAddVertex(ix, iz + 1);
      const v11 = getOrAddVertex(ix + 1, iz + 1);
      indices.push(v00, v01, v10);
      indices.push(v10, v01, v11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1cf) },
    uSkyTopColor: { value: new THREE.Color(0x2a619e) },
    uSkyHorizonColor: { value: new THREE.Color(0xc8dece) },
    uFogColor: { value: new THREE.Color(0xc8dece) },
    uFogDensity: { value: 0.0048 },
    uDaylight: { value: 1.0 },
    uWindStrength: { value: 0.25 },
    uWinter: { value: 0.0 },
    uMaxExtent: { value: half },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.42 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'realistic-woodland-water';
  mesh.renderOrder = 2;

  return {
    mesh,
    update(dt: number, sky: SkyLightingState): void {
      uniforms.uTime.value += dt;
      uniforms.uSunDirection.value.copy(sky.sunDirection);
      uniforms.uSunColor.value.copy(sky.sunColor);
      uniforms.uSkyTopColor.value.copy(sky.skyTopColor);
      uniforms.uSkyHorizonColor.value.copy(sky.skyHorizonColor);
      uniforms.uFogColor.value.copy(sky.fogColor);
      uniforms.uFogDensity.value = sky.fogDensity;
      uniforms.uDaylight.value = sky.daylight;
      uniforms.uWindStrength.value = sky.windStrength;
      uniforms.uWinter.value = sky.isWinter ? 1.0 : 0.0;
      uniforms.uCloudTime.value = sky.cloudTime ?? uniforms.uTime.value;
      uniforms.uCloudCoverage.value = sky.cloudCoverage ?? 0.42;
    },
    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}
