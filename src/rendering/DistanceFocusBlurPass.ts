import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface DistanceFocusParams {
  focusDistance: number;
  focusRange: number;
  maxBlur: number;
  horizonFadeStart: number;
  horizonFadeEnd: number;
  horizonColor: THREE.Color;
  isPov: boolean;
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
  uniform float uFocusDistance;
  uniform float uFocusRange;
  uniform float uMaxBlur;
  uniform float uHorizonFadeStart;
  uniform float uHorizonFadeEnd;
  uniform vec3 uHorizonColor;
  uniform float uIsPov;
  uniform int uTaps;

  varying vec2 vUv;

  float getViewDist(float rawDepth) {
    float viewZ = perspectiveDepthToViewZ(rawDepth, uNear, uFar);
    return -viewZ;
  }

  float computeCoC(float viewDist, float rawDepth) {
    if (rawDepth >= 0.99985) {
      return 0.85;
    }
    float farStart = uFocusDistance + uFocusRange * 0.42;
    float farEnd = uFocusDistance + uFocusRange * 2.75;
    float farCoc = smoothstep(farStart, farEnd, viewDist);

    // Subtle near-edge tilt-shift softness in world orbit view only
    float nearEdge = min(uFocusDistance * 0.36, 14.0);
    float nearCoc = (1.0 - uIsPov) * smoothstep(nearEdge, 1.8, viewDist) * 0.28;

    return clamp(max(farCoc, nearCoc), 0.0, 1.0);
  }

  void main() {
    vec4 centerColor = texture2D(tDiffuse, vUv);
    float centerDepth = texture2D(tDepth, vUv).x;
    float centerDist = getViewDist(centerDepth);
    float centerCoc = computeCoC(centerDist, centerDepth);

    vec3 accum = centerColor.rgb;
    float totalWeight = 1.0;

    if (centerCoc > 0.015 && uMaxBlur > 0.0001) {
      float blurRadius = centerCoc * uMaxBlur;
      vec2 aspectScale = vec2(1.0 / max(0.5, uAspect), 1.0);
      const float GOLDEN_ANGLE = 2.39996323;
      float tapCountF = float(max(uTaps, 6));

      for (int i = 0; i < 20; i++) {
        if (i >= uTaps) break;
        float fi = float(i) + 0.5;
        float r = sqrt(fi / tapCountF);
        float theta = fi * GOLDEN_ANGLE;
        vec2 offset = vec2(cos(theta), sin(theta)) * (r * blurRadius) * aspectScale;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));

        float sampleDepth = texture2D(tDepth, sampleUv).x;
        float sampleDist = getViewDist(sampleDepth);
        float sampleCoc = computeCoC(sampleDist, sampleDepth);

        // Prevent crisp foreground silhouettes from smearing across soft distant landscapes
        float behindOrSame = smoothstep(-2.5, 4.5, sampleDist - centerDist);
        float weight = mix(sampleCoc, 1.0, behindOrSame) * (0.35 + 0.65 * (1.0 - r * 0.45));

        vec3 sampleRgb = texture2D(tDiffuse, sampleUv).rgb;
        accum += sampleRgb * weight;
        totalWeight += weight;
      }
    }

    vec3 blurred = accum / totalWeight;

    // Seamless infinite horizon mist dissolve for ultra-distant landscape geometry
    if (centerDepth < 0.99985) {
      float horizonMist = smoothstep(uHorizonFadeStart, uHorizonFadeEnd, centerDist);
      blurred = mix(blurred, uHorizonColor, horizonMist * 0.92);
    }

    gl_FragColor = vec4(blurred, centerColor.a);
  }
`;

/**
 * Hardware-depth-driven Distance Focus Blur (Depth-of-Field) and infinite horizon veil pass.
 * Consumes the EffectComposer's WebGL2 DepthTexture directly with zero extra scene renders,
 * keeping the focal valley sharp while distant forests and hills soften into dreamy bokeh mist.
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
        uFocusDistance: { value: 55.0 },
        uFocusRange: { value: 44.0 },
        uMaxBlur: { value: 0.0115 },
        uHorizonFadeStart: { value: 185.0 },
        uHorizonFadeEnd: { value: 420.0 },
        uHorizonColor: { value: new THREE.Color(0xc8dece) },
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
    (u.uHorizonColor.value as THREE.Color).copy(params.horizonColor);
    u.uIsPov.value = params.isPov ? 1.0 : 0.0;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uAspect.value = this.camera.aspect;
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
    if (height > 0) {
      this.material.uniforms.uAspect.value = width / height;
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
