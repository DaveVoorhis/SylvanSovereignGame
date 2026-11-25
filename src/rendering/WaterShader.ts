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
    float shoreMask = smoothstep(0.0, 0.45, aDepth);
    vec4 wp0 = modelMatrix * vec4(pos, 1.0);
    float w1 = sin(wp0.x * 0.65 + wp0.z * 0.48 + uTime * 1.65) * 0.018;
    float w2 = cos(wp0.x * 1.15 - wp0.z * 0.92 + uTime * 2.25) * 0.011;
    pos.y += (w1 + w2) * shoreMask * (0.75 + uWindStrength * 0.65);

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

  varying vec3 vWorldPos;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vViewDist;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Multi-octave flowing water ripple height for analytical normals
  float waveHeight(vec2 p, vec2 flow, float t) {
    vec2 p1 = p * 0.42 - flow * t * 0.55 + vec2(t * 0.12, -t * 0.08);
    vec2 p2 = p * 0.96 - flow * t * 0.92 + vec2(-t * 0.18, t * 0.22);
    vec2 p3 = p * 2.15 - flow * t * 1.45 + vec2(t * 0.34, t * 0.28);
    vec2 p4 = p * 4.40 + vec2(-t * 0.45, t * 0.36);

    float h = 0.0;
    h += valueNoise(p1) * 0.52;
    h += valueNoise(p2) * 0.28;
    h += valueNoise(p3) * 0.13;
    h += valueNoise(p4) * 0.07;
    return h;
  }

  // Dual-layer sunlit caustic web pattern
  float causticsPattern(vec2 p, vec2 flow, float t) {
    vec2 uv1 = p * 0.85 - flow * t * 0.42 + vec2(t * 0.16, -t * 0.11);
    vec2 uv2 = p * 1.18 - flow * t * 0.55 + vec2(-t * 0.14, t * 0.19);
    float n1 = abs(valueNoise(uv1) * 2.0 - 1.0);
    float n2 = abs(valueNoise(uv2) * 2.0 - 1.0);
    float ridge1 = pow(1.0 - n1, 4.5);
    float ridge2 = pow(1.0 - n2, 4.5);
    return clamp((ridge1 + ridge2) * 0.85, 0.0, 1.4);
  }

  void main() {
    if (vDepth < -0.02) discard;

    float depth = max(vDepth, 0.0);
    float shoreFade = smoothstep(-0.015, 0.13, vDepth);

    // 1. Analytical capillary wave normal from 4-octave flowing height field
    float eps = 0.08;
    float hC = waveHeight(vWorldPos.xz, vFlow, uTime);
    float hX = waveHeight(vWorldPos.xz + vec2(eps, 0.0), vFlow, uTime);
    float hZ = waveHeight(vWorldPos.xz + vec2(0.0, eps), vFlow, uTime);

    float rippleStrength = (0.28 + uWindStrength * 0.24) * (0.55 + 0.45 * smoothstep(0.0, 0.35, depth));
    vec3 N = normalize(vec3((hC - hX) / eps * rippleStrength, 1.0, (hC - hZ) / eps * rippleStrength));
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDirection);

    // 2. Beer-Lambert depth-based optical water absorption
    float lightLevel = mix(0.24, 1.0, uDaylight);
    vec3 shallowCol = mix(vec3(0.36, 0.42, 0.28), vec3(0.34, 0.44, 0.48), uWinter);
    vec3 midCol = mix(vec3(0.11, 0.34, 0.31), vec3(0.14, 0.29, 0.36), uWinter);
    vec3 deepCol = mix(vec3(0.035, 0.14, 0.17), vec3(0.05, 0.12, 0.19), uWinter);

    float midFactor = 1.0 - exp(-depth * 2.1);
    float deepFactor = 1.0 - exp(-depth * 0.85);
    vec3 bodyColor = mix(shallowCol, midCol, midFactor);
    bodyColor = mix(bodyColor, deepCol, deepFactor);
    bodyColor *= lightLevel;

    // 3. Refracted sunlit underwater caustics visible in shallows & mid-stream
    float causticVis = exp(-depth * 1.9) * smoothstep(0.02, 0.18, depth) * uDaylight;
    float caustics = causticsPattern(vWorldPos.xz + N.xz * 0.45, vFlow, uTime);
    bodyColor += uSunColor * caustics * causticVis * 0.28;

    // 4. Physically-based Schlick Fresnel reflection of sky dome + surrounding forest canopy
    float NdotV = max(dot(N, V), 0.001);
    float fresnel = 0.035 + 0.965 * pow(1.0 - NdotV, 4.6);

    vec3 R = reflect(-V, N);
    float refH = clamp(R.y, 0.0, 1.0);
    vec3 skyRef = mix(uSkyHorizonColor, uSkyTopColor, pow(refH, 0.55));

    // Woodland canopy reflection silhouette near low reflection angles & closer to banks
    vec3 canopyTint = mix(vec3(0.08, 0.16, 0.08), vec3(0.18, 0.22, 0.26), uWinter) * lightLevel;
    float canopyBand = smoothstep(0.34, 0.02, refH) * (0.42 + 0.38 * exp(-depth * 0.9));
    vec3 envReflection = mix(skyRef, canopyTint, canopyBand * 0.55);

    vec3 color = mix(bodyColor, envReflection, clamp(fresnel * 0.92, 0.06, 0.92));

    // 5. Crisp GGX-like sun / moon specular glitter across capillary ripples
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float sunHeightFade = smoothstep(-0.08, 0.2, L.y);
    float glitter = pow(NdotH, 320.0) * 2.8 + pow(NdotH, 36.0) * 0.28;
    vec3 specTint = mix(vec3(0.55, 0.72, 0.98), uSunColor, uDaylight);
    color += specTint * glitter * (0.35 + 0.85 * sunHeightFade);

    // 6. Subtle organic lapping shoreline foam & stream current froth
    float foamNoise = valueNoise(vWorldPos.xz * 2.6 - vFlow * uTime * 1.1);
    float lapWave = 0.5 + 0.5 * sin(depth * 26.0 - uTime * 2.6 + foamNoise * 4.5);
    float shoreBand = (1.0 - smoothstep(0.02, 0.24, depth)) * smoothstep(0.0, 0.05, depth);
    float shoreFoam = shoreBand * smoothstep(0.42, 0.82, lapWave * 0.65 + foamNoise * 0.55);

    // Gentle mid-stream current ripples where flow is faster
    float flowSpeed = length(vFlow);
    float currentNoise = valueNoise(vWorldPos.xz * 3.8 - vFlow * uTime * 2.2);
    float currentFoam = smoothstep(0.74, 0.95, currentNoise) * smoothstep(0.35, 0.95, flowSpeed) * smoothstep(0.15, 0.5, depth) * 0.24;

    vec3 foamColor = mix(vec3(0.52, 0.6, 0.68), vec3(0.94, 0.97, 0.96), uDaylight);
    float totalFoam = clamp(shoreFoam * 0.62 + currentFoam, 0.0, 0.85);
    color = mix(color, foamColor, totalFoam);

    // 7. Depth-aware water clarity alpha + smooth far-horizon dissolve
    float waterAlpha = clamp(mix(0.34, 0.94, 1.0 - exp(-depth * 2.4)) + fresnel * 0.35 + totalFoam * 0.5, 0.0, 0.98);
    float edgeFade = 1.0 - smoothstep(uMaxExtent * 0.74, uMaxExtent * 0.98, length(vWorldPos.xz));
    waterAlpha *= shoreFade * edgeFade;

    // 8. Exact Three.js FogExp2 integration
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

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
  const half = worldSize * 0.49 * extentMultiplier;
  const step = (half * 2) / segments;
  const waterLevel = terrain.waterLevel;

  // Precompute grid heights to prune dry tiles far from water
  const cols = segments + 1;
  const heights = new Float32Array(cols * cols);
  for (let iz = 0; iz <= segments; iz++) {
    const z = -half + iz * step;
    for (let ix = 0; ix <= segments; ix++) {
      const x = -half + ix * step;
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

    const x = -half + ix * step;
    const z = -half + iz * step;
    const h = heights[key];
    const depth = waterLevel - h;

    // Compute downstream tangent along the winding river centerline
    const cxPrev = terrain.getRiverCenterX(z - 0.6);
    const cxNext = terrain.getRiverCenterX(z + 0.6);
    let fx = (cxNext - cxPrev) / 1.2;
    let fz = 1.0;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;

    // Calm the flow gracefully inside the wide central pond
    const pondDist = Math.hypot(x - 4, z + 6);
    const pondCalm = THREE.MathUtils.smoothstep(pondDist, 7.5, 16.0);
    const speed = 0.25 + 0.75 * pondCalm;

    const idx = positions.length / 3;
    positions.push(x, waterLevel, z);
    depths.push(depth);
    flows.push(fx * speed, fz * speed);
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
    },
    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}
