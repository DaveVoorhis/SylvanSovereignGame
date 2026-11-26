import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface DistanceFocusParams {
  focusDistance: number;
  focusRange: number;
  maxBlur: number;
  horizonFadeStart: number;
  horizonFadeEnd: number;
  worldHorizonStart?: number;
  worldHorizonEnd?: number;
  horizonColor: THREE.Color;
  isPov: boolean;
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color;
  daylight?: number;
  waterLevel?: number;
  fogDensity?: number;
  aoStrength?: number;
  mistStrength?: number;
  time?: number;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <packing>

  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uAspect;
  uniform vec2 uTexelSize;
  uniform mat4 uInvProjectionMatrix;
  uniform mat4 uCameraWorldMatrix;
  uniform float uFocusDistance;
  uniform float uFocusRange;
  uniform float uMaxBlur;
  uniform float uHorizonFadeStart;
  uniform float uHorizonFadeEnd;
  uniform float uWorldHorizonStart;
  uniform float uWorldHorizonEnd;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uDaylight;
  uniform float uWaterLevel;
  uniform float uFogDensity;
  uniform float uAoStrength;
  uniform float uMistStrength;
  uniform float uIsPov;
  uniform int uTaps;

  varying vec2 vUv;

  float getViewDist(float rawDepth) {
    float viewZ = perspectiveDepthToViewZ(rawDepth, uNear, uFar);
    return -viewZ;
  }

  // Sky dome has depthWrite = false, so true sky pixels sit at the cleared depth (1.0 / uFar).
  // Tight threshold avoids falsely classifying mid-distance ocean & mountain geometry as sky.
  bool isSkyPixel(float rawDepth, float viewDist) {
    return rawDepth >= 0.999998 || viewDist >= uFar * 0.985;
  }

  vec3 getViewPos(vec2 uv, float rawDepth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProjectionMatrix * ndc;
    return vp.xyz / max(vp.w, 0.00001);
  }

  // Edge-preserving view-space normal reconstruction from hardware depth buffer
  vec3 reconstructViewNormal(vec2 uv, vec3 centerPos) {
    vec2 dx = vec2(uTexelSize.x, 0.0);
    vec2 dy = vec2(0.0, uTexelSize.y);

    vec2 uvR = clamp(uv + dx, 0.001, 0.999);
    vec2 uvL = clamp(uv - dx, 0.001, 0.999);
    vec2 uvU = clamp(uv + dy, 0.001, 0.999);
    vec2 uvD = clamp(uv - dy, 0.001, 0.999);
    vec3 posR = getViewPos(uvR, texture2D(tDepth, uvR).x);
    vec3 posL = getViewPos(uvL, texture2D(tDepth, uvL).x);
    vec3 posU = getViewPos(uvU, texture2D(tDepth, uvU).x);
    vec3 posD = getViewPos(uvD, texture2D(tDepth, uvD).x);

    vec3 dPx = abs(posR.z - centerPos.z) < abs(centerPos.z - posL.z) ? (posR - centerPos) : (centerPos - posL);
    vec3 dPy = abs(posU.z - centerPos.z) < abs(centerPos.z - posD.z) ? (posU - centerPos) : (centerPos - posD);

    vec3 n = cross(dPx, dPy);
    float lenSq = dot(n, n);
    if (lenSq < 1e-10) return vec3(0.0, 0.0, 1.0);
    return n * inversesqrt(lenSq);
  }

  // Interleaved gradient noise for smooth, artifact-free per-pixel spiral rotation & dithering
  float interleavedGradientNoise(vec2 pixelCoord) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(pixelCoord, magic.xy)));
  }

  // Depth-reconstructed Screen-Space Contact Ambient Occlusion (zero extra draw calls)
  float computeContactAO(vec2 uv, vec3 centerPos, float centerDist, float ign) {
    float distFade = 1.0 - smoothstep(85.0, 185.0, centerDist);
    if (distFade <= 0.001 || uAoStrength <= 0.001) return 1.0;

    vec3 viewN = reconstructViewNormal(uv, centerPos);
    float worldRadius = clamp(centerDist * 0.028, 0.28, 1.85);
    // Approximate screen-space UV radius from projected world radius
    float screenRadius = clamp((worldRadius / max(centerDist, 0.5)) * 0.62, 0.0035, 0.028);
    vec2 aspectScale = vec2(1.0 / max(0.5, uAspect), 1.0);

    float occ = 0.0;
    // Incremental 2D rotation matrix for GOLDEN_ANGLE = 2.39996323 rad (avoids per-tap cos/sin)
    const mat2 GOLDEN_ROT = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);
    float baseAngle = ign * 6.2831853;
    vec2 rotDir = vec2(cos(baseAngle), sin(baseAngle));

    for (int i = 0; i < 8; i++) {
      float fi = (float(i) + 0.5) / 8.0;
      vec2 curDir = rotDir;
      rotDir = GOLDEN_ROT * rotDir;
      vec2 offset = curDir * (sqrt(fi) * screenRadius) * aspectScale;
      vec2 sUv = uv + offset;
      if (sUv.x <= 0.002 || sUv.x >= 0.998 || sUv.y <= 0.002 || sUv.y >= 0.998) continue;

      float sDepth = texture2D(tDepth, sUv).x;
      if (isSkyPixel(sDepth, getViewDist(sDepth))) continue;

      vec3 sPos = getViewPos(sUv, sDepth);
      vec3 diff = sPos - centerPos;
      float dLenSq = dot(diff, diff);
      if (dLenSq < 1e-6) continue;
      float invLen = inversesqrt(dLenSq);
      float dLen = dLenSq * invLen;
      vec3 dir = diff * invLen;

      float ndotd = max(0.0, dot(viewN, dir) - 0.06);
      float rangeAtten = smoothstep(worldRadius * 2.2, worldRadius * 0.25, dLen);
      occ += ndotd * rangeAtten;
    }

    float ao = 1.0 - clamp((occ / 8.0) * 1.95 * uAoStrength * distFade, 0.0, 0.58);
    return ao;
  }

  // Natural optical Depth-of-Field (no miniature tilt-shift blur in orbit mode)
  float computeCoC(float viewDist, float rawDepth) {
    if (isSkyPixel(rawDepth, viewDist)) {
      return mix(0.28, 0.72, uIsPov);
    }
    float farStart = uFocusDistance + uFocusRange * 0.55;
    float farEnd = uFocusDistance + uFocusRange * 3.1;
    float farCoc = smoothstep(farStart, farEnd, viewDist);

    // Subtle foreground lens blur in creature POV only
    float nearCoc = uIsPov * smoothstep(2.2, 0.35, viewDist) * 0.45;
    return clamp(max(farCoc, nearCoc), 0.0, 1.0);
  }

  void main() {
    vec4 centerColor = texture2D(tDiffuse, vUv);
    float centerDepth = texture2D(tDepth, vUv).x;
    float centerDist = getViewDist(centerDepth);
    float centerCoc = computeCoC(centerDist, centerDepth);
    float ign = interleavedGradientNoise(gl_FragCoord.xy);

    vec3 accum = centerColor.rgb;
    float totalWeight = 1.0;

    if (centerCoc > 0.02 && uMaxBlur > 0.00015) {
      float blurRadius = centerCoc * uMaxBlur;
      vec2 aspectScale = vec2(1.0 / max(0.5, uAspect), 1.0);
      const float GOLDEN_ANGLE = 2.39996323;
      const mat2 GOLDEN_ROT = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);
      float tapCountF = float(max(uTaps, 6));
      float startTheta = 0.5 * GOLDEN_ANGLE + ign * 6.2831853;
      vec2 rotDir = vec2(cos(startTheta), sin(startTheta));

      for (int i = 0; i < 20; i++) {
        if (i >= uTaps) break;
        float fi = float(i) + 0.5;
        float r = sqrt(fi / tapCountF);
        vec2 offset = rotDir * (r * blurRadius) * aspectScale;
        rotDir = GOLDEN_ROT * rotDir;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));

        float sampleDepth = texture2D(tDepth, sampleUv).x;
        float sampleDist = getViewDist(sampleDepth);
        float sampleCoc = computeCoC(sampleDist, sampleDepth);

        // Prevent crisp foreground silhouettes from bleeding onto soft distant landscapes
        float behindOrSame = smoothstep(-2.0, 4.0, sampleDist - centerDist);
        float weight = mix(sampleCoc, 1.0, behindOrSame) * (0.35 + 0.65 * (1.0 - r * 0.45));

        vec3 sampleRgb = texture2D(tDiffuse, sampleUv).rgb;
        accum += sampleRgb * weight;
        totalWeight += weight;
      }
    }

    vec3 color = accum / totalWeight;

    // Contact Ambient Occlusion + Height Valley Mist + Mie Atmospheric In-Scattering
    if (!isSkyPixel(centerDepth, centerDist)) {
      vec3 viewPos = getViewPos(vUv, centerDepth);
      float radialDist = length(viewPos);

      // 1. Grounded crevice/contact AO around roots, paws, boulders, foundations, and eaves
      float ao = computeContactAO(vUv, viewPos, radialDist, ign);
      // Tint occluded crevices subtly toward cool ambient sky rather than muddy black
      vec3 aoTint = mix(vec3(0.76, 0.80, 0.86), vec3(1.0), ao);
      color *= mix(vec3(ao), aoTint, 0.25);

      // 2. World-space height-based river valley mist & warm Mie sun forward-scattering
      vec3 worldPos = (uCameraWorldMatrix * vec4(viewPos, 1.0)).xyz;
      vec3 camPos = uCameraWorldMatrix[3].xyz;
      vec3 rayDir = normalize(worldPos - camPos);

      float heightAboveWater = max(0.0, worldPos.y - (uWaterLevel + 0.5));
      float valleyHeightFactor = exp(-heightAboveWater * 0.085);
      float valleyDistFactor = 1.0 - exp(-max(0.0, centerDist - 18.0) * (0.0022 + uMistStrength * 0.0055));
      float valleyMist = clamp(valleyHeightFactor * valleyDistFactor * uMistStrength, 0.0, 0.68);

      vec3 sunDir = normalize(uSunDirection);
      float sunDot = max(dot(rayDir, sunDir), 0.0);
      float mieScatter = pow(sunDot, 7.0) * uDaylight * 0.48;
      vec3 mistColor = mix(uHorizonColor, uSunColor * 1.15, clamp(mieScatter, 0.0, 0.65));

      color = mix(color, mistColor, valleyMist);

      // Subtle aerial sun haze across mid-to-far woodland ridges looking toward the sun
      float aerialFactor = smoothstep(55.0, 420.0, radialDist);
      color += uSunColor * pow(sunDot, 10.0) * aerialFactor * uDaylight * (0.045 + uFogDensity * 8.0);

      // Flat planar oceanic horizon dissolve (view-Z matches FogExp2 and stays level across the FOV)
      // plus a far inscribed perimeter safety fade; converges to exact uHorizonColor at full mist.
      float camHorizonMist = smoothstep(uHorizonFadeStart, uHorizonFadeEnd, centerDist);
      float worldEdgeMist = smoothstep(uWorldHorizonStart, uWorldHorizonEnd, length(worldPos.xz));
      float horizonMist = clamp(max(camHorizonMist, worldEdgeMist), 0.0, 1.0);
      vec3 horizonTint = mix(mistColor, uHorizonColor, smoothstep(0.20, 0.90, horizonMist));
      color = mix(color, horizonTint, horizonMist);
    }

    // Gentle natural optical lens vignette (very restrained, never heavy cartoon border)
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv, vigUv) * 0.055;
    color *= clamp(vig, 0.88, 1.0);

    // Subtle filmic micro-dither to prevent 8-bit sky & valley-fog color banding
    color += (ign - 0.5) * 0.0028;

    gl_FragColor = vec4(max(color, vec3(0.0)), centerColor.a);
  }
`;

/**
 * Hardware-depth-driven Natural Realism Post-Processing Pass:
 * - Depth-reconstructed Screen-Space Contact AO (zero extra scene draw calls)
 * - Exponential world-height valley mist & Mie sun forward-scattering
 * - Physically motivated optical Depth-of-Field (without miniature tilt-shift)
 * - Seamless infinite horizon dissolve & anti-banding filmic micro-dither
 */
export class DistanceFocusBlurPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly fsQuad: FullScreenQuad;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    taps = 16,
  ) {
    super();
    this.needsSwap = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uAspect: { value: camera.aspect },
        uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uInvProjectionMatrix: { value: new THREE.Matrix4() },
        uCameraWorldMatrix: { value: new THREE.Matrix4() },
        uFocusDistance: { value: 55.0 },
        uFocusRange: { value: 44.0 },
        uMaxBlur: { value: 0.0035 },
        uHorizonFadeStart: { value: 2400.0 },
        uHorizonFadeEnd: { value: 5800.0 },
        uWorldHorizonStart: { value: 6260.0 },
        uWorldHorizonEnd: { value: 7060.0 },
        uHorizonColor: { value: new THREE.Color(0xc4d3cc) },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xfff1d8) },
        uDaylight: { value: 1.0 },
        uWaterLevel: { value: 1.5 },
        uFogDensity: { value: 0.0006 },
        uAoStrength: { value: 0.85 },
        uMistStrength: { value: 0.45 },
        uIsPov: { value: 0.0 },
        uTaps: { value: Math.max(6, Math.min(20, taps)) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  setTaps(taps: number): void {
    this.material.uniforms.uTaps.value = Math.max(6, Math.min(20, taps));
  }

  updateParams(params: DistanceFocusParams): void {
    const u = this.material.uniforms;
    u.uFocusDistance.value = params.focusDistance;
    u.uFocusRange.value = params.focusRange;
    u.uMaxBlur.value = params.maxBlur;
    u.uHorizonFadeStart.value = params.horizonFadeStart;
    u.uHorizonFadeEnd.value = params.horizonFadeEnd;
    if (params.worldHorizonStart !== undefined) {
      u.uWorldHorizonStart.value = params.worldHorizonStart;
    }
    if (params.worldHorizonEnd !== undefined) {
      u.uWorldHorizonEnd.value = params.worldHorizonEnd;
    }
    (u.uHorizonColor.value as THREE.Color).copy(params.horizonColor);
    u.uIsPov.value = params.isPov ? 1.0 : 0.0;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uAspect.value = this.camera.aspect;

    if (params.sunDirection) {
      (u.uSunDirection.value as THREE.Vector3).copy(params.sunDirection);
    }
    if (params.sunColor) {
      (u.uSunColor.value as THREE.Color).copy(params.sunColor);
    }
    if (params.daylight !== undefined) {
      u.uDaylight.value = params.daylight;
    }
    if (params.waterLevel !== undefined) {
      u.uWaterLevel.value = params.waterLevel;
    }
    if (params.fogDensity !== undefined) {
      u.uFogDensity.value = params.fogDensity;
    }
    if (params.aoStrength !== undefined) {
      u.uAoStrength.value = params.aoStrength;
    }
    if (params.mistStrength !== undefined) {
      u.uMistStrength.value = params.mistStrength;
    }
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uAspect.value = this.camera.aspect;
    (u.uInvProjectionMatrix.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.uCameraWorldMatrix.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    if (readBuffer.width > 0 && readBuffer.height > 0) {
      (u.uTexelSize.value as THREE.Vector2).set(1 / readBuffer.width, 1 / readBuffer.height);
    }

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  override setSize(width: number, height: number): void {
    if (height > 0 && width > 0) {
      this.material.uniforms.uAspect.value = width / height;
      (this.material.uniforms.uTexelSize.value as THREE.Vector2).set(1 / width, 1 / height);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
