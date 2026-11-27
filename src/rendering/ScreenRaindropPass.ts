import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { WeatherType } from '@core/Types';

export const MAX_SCREEN_RAINDROPS = 6;
export const MAX_SCREEN_TRAIL_BEADS = 40;

export interface ScreenRaindropUpdateParams {
  readonly dt: number;
  readonly weather: WeatherType;
  readonly daylight: number;
  readonly skyColor: THREE.Color;
  readonly sunColor: THREE.Color;
  readonly sunDirection?: THREE.Vector3;
  readonly windStrength?: number;
  readonly isUnderwater?: boolean;
}

export interface ScreenRaindropState {
  readonly id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  alpha: number;
  age: number;
  maxAge: number;
  stickTimer: number;
  slipTimer: number;
  isSlipping: boolean;
  stretch: number;
  leanAngle: number;
  wobblePhase: number;
  wobbleAmp: number;
  trailStrength: number;
  distSinceBead: number;
  nextBeadDist: number;
  meanderPhase: number;
  meanderFreq: number;
  seed: number;
}

export interface ScreenTrailBeadState {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  age: number;
  lifetime: number;
  alpha: number;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #define MAX_DROPS ${MAX_SCREEN_RAINDROPS}
  #define MAX_BEADS ${MAX_SCREEN_TRAIL_BEADS}

  uniform sampler2D tDiffuse;
  uniform float uAspect;
  uniform vec2 uTexelSize;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec2 uSunScreenDir;
  uniform float uDaylight;
  uniform int uActiveDrops;
  uniform int uActiveBeads;

  // Main drops:
  // posRad = (uv.x, uv.y, radiusInScreenHeight, alpha)
  // shape  = (stretch, leanAngle, wobbleOffset, impactSplash)
  // tail   = (prevUv.x, prevUv.y, trailStrength, seed)
  uniform vec4 uDropPosRad[MAX_DROPS];
  uniform vec4 uDropShape[MAX_DROPS];
  uniform vec4 uDropTail[MAX_DROPS];

  // Pinched-off trailing micro-beads along each drop's meandering path:
  // (uv.x, uv.y, radiusInScreenHeight, alpha)
  uniform vec4 uBeads[MAX_BEADS];

  varying vec2 vUv;

  // Polynomial smooth-maximum for organic liquid surface-tension merging
  float sMax(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / max(k, 1e-5);
    return max(a, b) + h * h * k * 0.25;
  }

  // Distance from point p to line segment a-b, plus segment parameter t in [0, 1]
  vec2 distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float baLenSq = dot(ba, ba);
    float t = baLenSq > 1e-7 ? clamp(dot(pa, ba) / baLenSq, 0.0, 1.0) : 0.0;
    return vec2(length(pa - ba * t), t);
  }

  // Evaluates physical 3D liquid dome height z(p) (in isotropic screen-height units)
  // for a single gravity-weighted sessile teardrop on vertical glass.
  float evalMainDropHeight(vec2 p, vec4 posRad, vec4 shape, vec4 tail) {
    float R = posRad.z;
    float alpha = posRad.w;
    if (R <= 1e-5 || alpha <= 0.001) return 0.0;

    vec2 c = vec2(posRad.x * uAspect, posRad.y);
    vec2 d = p - c;
    if (abs(d.x) > R * 2.5 || d.y < -R * 1.65 || d.y > R * 3.8) return 0.0;

    float stretch = shape.x;
    float lean = shape.y;
    float wobble = shape.z;
    float splash = shape.w;
    float seed = tail.w;

    // Align teardrop tail with instantaneous drizzle heading
    float ca = cos(lean);
    float sa = sin(lean);
    vec2 ld = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);

    // Subtle irregular meniscus contour from glass micro-roughness + capillary wobble
    float ang = dot(ld, ld) > 1e-10 ? atan(ld.y, ld.x) : 0.0;
    float organic = 1.0
      + 0.032 * sin(ang * 2.0 + seed * 6.28318)
      + 0.022 * cos(ang * 3.0 - seed * 11.42)
      + wobble * 0.055 * cos(ang * 2.0);
    float effR = R * organic * (1.0 + splash * 0.16);

    vec2 q = ld / max(effR, 1e-5);
    float yPos = max(q.y, 0.0);
    float tailLen = 1.0 + stretch * 0.88;
    float qy = q.y >= 0.0 ? (q.y / tailLen) : (q.y / (1.0 + stretch * 0.10));
    float upFrac = clamp(yPos / tailLen, 0.0, 1.0);
    float downFrac = clamp(-q.y, 0.0, 1.0);

    // Taper receding upper tail; slightly plump gravity-pooled bottom lobe
    float qx = q.x * (1.0 + upFrac * upFrac * (0.26 + stretch * 0.56)) * (1.0 - downFrac * 0.05);
    float r2 = qx * qx + qy * qy;

    float h = 0.0;
    if (r2 < 1.0) {
      // Steep-meniscus sessile spherical cap (contact angle ~75 deg, fuller lower belly)
      float cap = pow(max(1e-5, 1.0 - r2), 0.36);
      float splashRipple = 1.0 - splash * 0.22 * cos(sqrt(r2) * 5.2);
      h = R * 0.56 * cap * splashRipple * (1.0 + downFrac * 0.12);
    }

    // Glossy tapered wet wake immediately trailing the sliding drop
    float trailStr = tail.z;
    if (trailStr > 0.01) {
      vec2 prevC = vec2(tail.x * uAspect, tail.y);
      vec2 seg = distToSegment(p, c, prevC);
      float wakeR = mix(R * 0.44, R * 0.11, seg.y);
      if (seg.x < wakeR) {
        float w = seg.x / max(wakeR, 1e-5);
        float wakeH = wakeR * 0.38 * pow(max(1e-5, 1.0 - w * w), 0.42) * trailStr * (1.0 - seg.y * 0.65);
        h = sMax(h, wakeH, R * 0.14);
      }
    }

    return h * alpha;
  }

  // Evaluates physical 3D dome height for a tiny pinned trailing micro-bead
  float evalBeadHeight(vec2 p, vec4 bead) {
    float R = bead.z;
    float alpha = bead.w;
    if (R <= 1e-5 || alpha <= 0.001) return 0.0;
    vec2 c = vec2(bead.x * uAspect, bead.y);
    vec2 d = p - c;
    if (abs(d.x) > R * 1.35 || abs(d.y) > R * 1.45) return 0.0;

    // Slight natural gravity sag on clinging satellite beads
    vec2 q = vec2(d.x / R, d.y / (R * 1.08));
    float r2 = dot(q, q);
    if (r2 >= 1.0) return 0.0;
    return R * 0.50 * pow(max(1e-5, 1.0 - r2), 0.38) * alpha;
  }

  // Unified heightfield across all active main drops and trailing beads
  float sampleWaterHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < MAX_DROPS; i++) {
      if (i >= uActiveDrops) break;
      float dh = evalMainDropHeight(p, uDropPosRad[i], uDropShape[i], uDropTail[i]);
      if (dh > 0.0) {
        h = h > 0.0 ? sMax(h, dh, min(h, dh) * 0.65 + 0.0008) : dh;
      }
    }
    for (int j = 0; j < MAX_BEADS; j++) {
      if (j >= uActiveBeads) break;
      float bh = evalBeadHeight(p, uBeads[j]);
      if (bh > 0.0) {
        h = h > 0.0 ? sMax(h, bh, min(h, bh) * 0.55 + 0.0005) : bh;
      }
    }
    return h;
  }

  void main() {
    vec4 baseSample = texture2D(tDiffuse, vUv);
    vec2 p = vec2(vUv.x * uAspect, vUv.y);

    // Super-fast broad-phase reject: 97%+ of pixels outside drops do zero extra texture taps
    bool nearLiquid = false;
    float contactShadow = 0.0;
    vec2 shadowShift = -normalize(uSunScreenDir + vec2(0.0, 0.001)) * 0.24;

    for (int i = 0; i < MAX_DROPS; i++) {
      if (i >= uActiveDrops) break;
      vec4 pr = uDropPosRad[i];
      float R = pr.z;
      if (R <= 1e-5 || pr.w <= 0.001) continue;
      vec2 c = vec2(pr.x * uAspect, pr.y);
      vec2 d = p - c;
      if (abs(d.x) <= R * 2.55 && d.y >= -R * 1.85 && d.y <= R * 3.85) {
        nearLiquid = true;
        // Soft translucent contact shadow projected just beneath the bottom meniscus
        vec2 sd = (d - shadowShift * R) / vec2(R * 1.06, R * (1.08 + uDropShape[i].x * 0.22));
        float sr = length(sd);
        float sMask = (1.0 - smoothstep(0.72, 1.18, sr)) * pr.w;
        contactShadow = max(contactShadow, sMask);
      }
    }

    if (!nearLiquid) {
      for (int j = 0; j < MAX_BEADS; j++) {
        if (j >= uActiveBeads) break;
        vec4 b = uBeads[j];
        float R = b.z;
        if (R <= 1e-5 || b.w <= 0.001) continue;
        vec2 c = vec2(b.x * uAspect, b.y);
        vec2 d = p - c;
        if (abs(d.x) <= R * 1.45 && abs(d.y) <= R * 1.55) {
          nearLiquid = true;
          vec2 sd = (d - shadowShift * R * 0.8) / (R * 1.12);
          float sMask = (1.0 - smoothstep(0.65, 1.15, length(sd))) * b.w * 0.65;
          contactShadow = max(contactShadow, sMask);
        }
      }
    }

    if (!nearLiquid) {
      gl_FragColor = baseSample;
      return;
    }

    float zC = sampleWaterHeight(p);
    float edgeSoftness = max(uTexelSize.y * 0.58, 0.00038);
    float edgeMask = smoothstep(0.0, edgeSoftness, zC);

    vec3 baseWithShadow = baseSample.rgb * (1.0 - contactShadow * (0.09 + 0.07 * uDaylight));
    if (edgeMask <= 0.001) {
      gl_FragColor = vec4(baseWithShadow, baseSample.a);
      return;
    }

    // Scale-invariant surface normal from unified 3D liquid heightfield
    float eps = max(uTexelSize.y * 0.85, 0.00042);
    float zR = sampleWaterHeight(p + vec2(eps, 0.0));
    float zL = sampleWaterHeight(p - vec2(eps, 0.0));
    float zU = sampleWaterHeight(p + vec2(0.0, eps));
    float zD = sampleWaterHeight(p - vec2(0.0, eps));
    float dzdx = (zR - zL) / (2.0 * eps);
    float dzdy = (zU - zD) / (2.0 * eps);
    // Clamp grazing slope cleanly so ultra-steep meniscus rims stay smooth & alias-free
    vec2 slope = vec2(dzdx, dzdy);
    float slopeLen = length(slope);
    if (slopeLen > 2.6) {
      slope *= (2.6 / slopeLen);
    }
    vec3 N = normalize(vec3(-slope.x, -slope.y, 1.0));

    // 1. Snell's Law Convex-Lens Refraction (n_air / n_water = 1 / 1.333) + Chromatic Dispersion
    vec3 refr = refract(vec3(0.0, 0.0, -1.0), N, 0.75);
    float lensDepth = 0.052 + zC * 4.4;
    vec2 refrOffset = vec2(refr.x / max(uAspect, 0.25), refr.y) * lensDepth;

    vec2 uvR = clamp(vUv + refrOffset * 0.955, vec2(0.002), vec2(0.998));
    vec2 uvG = clamp(vUv + refrOffset,         vec2(0.002), vec2(0.998));
    vec2 uvB = clamp(vUv + refrOffset * 1.048, vec2(0.002), vec2(0.998));
    vec3 refracted = vec3(
      texture2D(tDiffuse, uvR).r,
      texture2D(tDiffuse, uvG).g,
      texture2D(tDiffuse, uvB).b
    );

    // 2. Dark Total-Internal-Reflection Meniscus Ring (defines liquid boundary on bright & dark scenes)
    float grazing = 1.0 - max(N.z, 0.0);
    float darkRim = smoothstep(0.28, 0.86, grazing) * (0.34 + 0.16 * clamp(-N.y, 0.0, 1.0));
    vec3 dropCol = refracted * (1.0 - darkRim);

    // 3. Lower Meniscus Caustic Focusing Glow (overhead light focused through convex water dome)
    vec3 L = normalize(vec3(uSunScreenDir.x, max(0.42, uSunScreenDir.y), 0.78));
    vec2 lDir2 = normalize(L.xy + vec2(0.0, 0.001));
    float nxyLen = length(N.xy);
    vec2 nDir2 = nxyLen > 1e-4 ? (N.xy / nxyLen) : vec2(0.0);
    float lowerDot = max(0.0, dot(nDir2, -lDir2));
    float lowerFocus = lowerDot > 1e-4 ? pow(lowerDot, 2.3) : 0.0;
    float causticBand = smoothstep(0.16, 0.62, grazing) * (1.0 - smoothstep(0.75, 0.96, grazing));
    float causticAmt = lowerFocus * causticBand * (0.26 + 0.40 * uDaylight);
    dropCol += (refracted * 0.62 + uSkyColor * 0.45) * causticAmt;

    // 4. Physical Schlick Fresnel Sky Reflection (F0 = 0.02 for water)
    float g2 = grazing * grazing;
    float fresnel = 0.02 + 0.98 * g2 * g2;
    float skyFacing = 0.42 + 0.58 * smoothstep(-0.25, 0.72, N.y);
    vec3 envRefl = mix(uSkyColor * 0.65, uSkyColor * 1.25 + uSunColor * 0.22, skyFacing) * (0.30 + 0.70 * uDaylight);
    dropCol = mix(dropCol, envRefl, clamp(fresnel * 0.56, 0.0, 0.60));

    // 5. Crisp Specular Sky/Sun Glint + Soft Upper Sheen + Opposite Internal Bounce Glint
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H1 = normalize(L + V);
    float ndh1 = max(0.0, dot(N, H1));
    float specPrimary = (ndh1 > 1e-4 ? pow(ndh1, 128.0) : 0.0) * (0.48 + 0.95 * uDaylight);
    float specBroad = (ndh1 > 1e-4 ? pow(ndh1, 18.0) : 0.0) * (0.05 + 0.09 * uDaylight);
    vec3 L2 = normalize(vec3(-L.x * 0.7, -L.y * 0.85, 0.65));
    vec3 H2 = normalize(L2 + V);
    float ndh2 = max(0.0, dot(N, H2));
    float specBounce = (ndh2 > 1e-4 ? pow(ndh2, 72.0) : 0.0) * (0.12 + 0.22 * uDaylight);

    vec3 specTint = mix(uSkyColor * 1.15 + vec3(0.18), uSunColor * 1.15 + vec3(0.24), 0.52);
    dropCol += specTint * (specPrimary + specBroad) + (uSkyColor + vec3(0.18)) * specBounce;

    vec3 finalCol = mix(baseWithShadow, dropCol, edgeMask);
    gl_FragColor = vec4(max(finalCol, vec3(0.0)), baseSample.a);
  }
`;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Physically motivated waterdrop-on-glass post-processing pass.
 * During rain & storms, occasional raindrops strike the screen glass at random spots,
 * momentarily cling via surface tension, and drizzle organically down the glass with
 * stick-slip motion, meandering paths, pinched-off micro-beads, Snell convex-lens
 * refraction with chromatic dispersion, lower-meniscus caustics, Fresnel reflection,
 * and specular highlights. Automatically disables itself (zero GPU cost) when dry.
 */
export class ScreenRaindropPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly fsQuad: FullScreenQuad;
  private readonly drops: ScreenRaindropState[] = [];
  private readonly beads: ScreenTrailBeadState[] = [];
  private readonly dropPosRadUniforms: THREE.Vector4[];
  private readonly dropShapeUniforms: THREE.Vector4[];
  private readonly dropTailUniforms: THREE.Vector4[];
  private readonly beadUniforms: THREE.Vector4[];

  private rngState: number;
  private nextDropId = 1;
  private spawnCooldown = 0.8;
  private wasRaining = false;

  constructor(seed = 20261127) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.rngState = seed >>> 0 || 1;

    this.dropPosRadUniforms = Array.from({ length: MAX_SCREEN_RAINDROPS }, () => new THREE.Vector4());
    this.dropShapeUniforms = Array.from({ length: MAX_SCREEN_RAINDROPS }, () => new THREE.Vector4());
    this.dropTailUniforms = Array.from({ length: MAX_SCREEN_RAINDROPS }, () => new THREE.Vector4());
    this.beadUniforms = Array.from({ length: MAX_SCREEN_TRAIL_BEADS }, () => new THREE.Vector4());

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uAspect: { value: 16 / 9 },
        uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uSkyColor: { value: new THREE.Color(0x8899a6) },
        uSunColor: { value: new THREE.Color(0xdce6f0) },
        uSunScreenDir: { value: new THREE.Vector2(-0.32, 0.78) },
        uDaylight: { value: 0.75 },
        uActiveDrops: { value: 0 },
        uActiveBeads: { value: 0 },
        uDropPosRad: { value: this.dropPosRadUniforms },
        uDropShape: { value: this.dropShapeUniforms },
        uDropTail: { value: this.dropTailUniforms },
        uBeads: { value: this.beadUniforms },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  getActiveDropCount(): number {
    return this.drops.length;
  }

  getActiveBeadCount(): number {
    return this.beads.length;
  }

  getActiveDrops(): readonly ScreenRaindropState[] {
    return this.drops;
  }

  /** Clears all droplets immediately (e.g., when switching worlds or resetting view). */
  reset(): void {
    this.drops.length = 0;
    this.beads.length = 0;
    this.wasRaining = false;
    this.spawnCooldown = 0.8;
    this.syncUniforms();
    this.enabled = false;
  }

  /**
   * Advances raindrop impacts, stick-slip gravity drizzling, coalescence, trailing micro-bead
   * shedding, evaporation, and GPU uniform uploads.
   */
  update(params: ScreenRaindropUpdateParams): void {
    const dt = Math.min(0.1, Math.max(0, params.dt));
    const isStorm = params.weather === 'storm';
    const isRaining = !params.isUnderwater && (params.weather === 'rain' || isStorm);

    // Sync live lighting & sky colors so specular highlights and Fresnel tint match time of day
    const u = this.material.uniforms;
    (u.uSkyColor.value as THREE.Color).copy(params.skyColor);
    (u.uSunColor.value as THREE.Color).copy(params.sunColor);
    u.uDaylight.value = clamp(params.daylight, 0.08, 1.0);
    if (params.sunDirection) {
      const sx = clamp(params.sunDirection.x * 0.55 - 0.18, -0.58, 0.58);
      const sy = clamp(0.55 + params.sunDirection.y * 0.35, 0.42, 0.92);
      (u.uSunScreenDir.value as THREE.Vector2).set(sx, sy);
    }

    if (dt <= 0) {
      this.syncUniforms();
      this.enabled = this.drops.length > 0 || this.beads.length > 0;
      return;
    }

    // When rain begins, prime the first occasional drop to strike within ~0.5-1.5s
    if (isRaining && !this.wasRaining) {
      this.spawnCooldown = isStorm ? this.randRange(0.25, 0.85) : this.randRange(0.55, 1.65);
    }
    this.wasRaining = isRaining;

    // 1. Occasional random screen impacts during rain/storm
    if (isRaining) {
      const targetCap = isStorm ? 4 : 2;
      const hardCap = Math.min(MAX_SCREEN_RAINDROPS, isStorm ? 5 : 3);
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0) {
        if (this.drops.length < hardCap) {
          this.spawnDrop(isStorm);
        }
        // Keep it truly occasional: 1-2 drops most of the time in rain, 2-4 in storms
        const crowdedMult = this.drops.length >= targetCap ? 1.75 : 1.0;
        this.spawnCooldown =
          (isStorm ? this.randRange(1.15, 2.75) : this.randRange(2.3, 5.2)) * crowdedMult;
      }
    }

    const windDrift = (params.windStrength ?? 0.25) * (isStorm ? 0.012 : 0.004);
    const aspect = Math.max(0.35, u.uAspect.value as number);

    // 2. Step main drops: impact wobble, stick-slip surface tension, meandering drizzle, bead shedding
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.wobblePhase += dt * 18.0;
      d.wobbleAmp *= Math.exp(-dt * 4.5);

      if (params.isUnderwater) {
        d.alpha -= dt * 2.8;
      } else if (!isRaining && !d.isSlipping) {
        // Dry weather gently evaporates stationary lingering drops
        d.alpha -= dt * 0.22;
      } else if (d.age > d.maxAge) {
        d.alpha -= dt * 0.35;
      }

      if (d.alpha <= 0.01) {
        this.drops.splice(i, 1);
        continue;
      }

      // Stick-slip surface tension cycle: cling -> break loose & drizzle -> occasional pause -> repeat
      const massGravity = clamp((d.radius - 0.0075) / 0.009, 0.15, 1.35);
      if (!d.isSlipping) {
        d.stickTimer -= dt;
        // Subtle gravity creep / sag while clinging
        const creep = 0.0022 * massGravity;
        d.vy += (-creep - d.vy) * Math.min(1, dt * 8.0);
        d.vx *= Math.exp(-dt * 9.0);
        if (d.stickTimer <= 0 && (isRaining || d.radius > 0.0115)) {
          d.isSlipping = true;
          d.slipTimer = this.randRange(0.75, 2.1) * (0.75 + massGravity * 0.5);
          d.wobbleAmp = Math.max(d.wobbleAmp, 0.28);
        }
      } else {
        d.slipTimer -= dt;
        // Organic meandering path driven by dual-frequency surface-imperfection drift
        const meander =
          Math.sin(d.age * d.meanderFreq + d.meanderPhase) * 0.012 +
          Math.cos(d.age * (d.meanderFreq * 1.73) - d.meanderPhase * 0.6) * 0.007;
        const targetVy = -(0.042 + 0.088 * massGravity) * (0.78 + 0.22 * Math.sin(d.age * 2.4 + d.seed * 6.28));
        const targetVx = (meander + windDrift) / aspect;

        d.vy += (targetVy - d.vy) * Math.min(1, dt * 3.4);
        d.vx += (targetVx - d.vx) * Math.min(1, dt * 4.5);

        if (d.slipTimer <= 0) {
          // Larger heavy drops keep rolling with brief hesitations; lighter drops stick longer
          d.isSlipping = false;
          d.stickTimer = this.randRange(0.22, 0.85) / (0.65 + massGravity * 0.65);
        }
      }

      const oldX = d.x;
      const oldY = d.y;
      d.x = clamp(d.x + d.vx * dt, 0.02, 0.98);
      d.y += d.vy * dt;

      // Smoothly lag the wet wake anchor behind the moving drop
      const wakeLag = Math.exp(-dt * (d.isSlipping ? 7.5 : 13.0));
      d.prevX = d.x + (d.prevX - d.x) * wakeLag;
      d.prevY = d.y + (d.prevY - d.y) * wakeLag;
      // Keep wake length bounded nicely to ~2.5x drop radius
      const wakeDx = (d.prevX - d.x) * aspect;
      const wakeDy = d.prevY - d.y;
      const wakeLen = Math.hypot(wakeDx, wakeDy);
      const maxWakeLen = d.radius * 2.6;
      if (wakeLen > maxWakeLen && wakeLen > 1e-5) {
        const s = maxWakeLen / wakeLen;
        d.prevX = d.x + (wakeDx * s) / aspect;
        d.prevY = d.y + wakeDy * s;
      }

      // Speed-driven teardrop elongation & path-aligned lean
      const speed = Math.hypot((d.x - oldX) * aspect, d.y - oldY) / Math.max(dt, 1e-4);
      const targetStretch = clamp(speed * 7.8, 0.0, 1.0);
      d.stretch += (targetStretch - d.stretch) * Math.min(1, dt * 8.0);
      const targetTrail = clamp(speed * 10.5, 0.0, 1.0);
      d.trailStrength += (targetTrail - d.trailStrength) * Math.min(1, dt * 6.5);
      if (speed > 0.008) {
        const desiredLean = clamp(Math.atan2((d.x - oldX) * aspect, -(d.y - oldY)), -0.45, 0.45);
        d.leanAngle += (desiredLean - d.leanAngle) * Math.min(1, dt * 7.0);
      } else {
        d.leanAngle *= Math.exp(-dt * 4.0);
      }

      // Shed tiny clinging micro-beads along the wet path behind moving drops
      const stepDist = Math.hypot((d.x - oldX) * aspect, d.y - oldY);
      d.distSinceBead += stepDist;
      if (d.distSinceBead >= d.nextBeadDist && speed > 0.018 && d.radius > 0.0072) {
        d.distSinceBead = 0;
        d.nextBeadDist = this.randRange(0.015, 0.032);
        this.spawnTrailBead(d, aspect);
        // Shedding a micro-bead gently trims drop mass
        d.mass *= 0.982;
        d.radius = Math.max(0.0068, Math.cbrt(d.mass));
      }

      // Coalesce with any trailing bead the drop drizzles through (grows slightly & gains momentum)
      for (let j = this.beads.length - 1; j >= 0; j--) {
        const b = this.beads[j];
        // Don't immediately re-absorb a bead just shed in the last 0.22s
        if (b.age < 0.22) continue;
        const bDist = Math.hypot((d.x - b.x) * aspect, d.y - b.y);
        if (bDist < (d.radius + b.radius) * 1.08) {
          d.mass += b.radius * b.radius * b.radius * 0.9;
          d.radius = Math.min(0.021, Math.cbrt(d.mass));
          d.vy -= 0.012;
          d.wobbleAmp = Math.min(0.75, d.wobbleAmp + 0.32);
          d.isSlipping = true;
          d.slipTimer = Math.max(d.slipTimer, 0.55);
          this.beads.splice(j, 1);
        }
      }

      // Exited off the bottom edge of the screen
      if (d.y < -d.radius * 3.2 - 0.02) {
        this.drops.splice(i, 1);
      }
    }

    // 3. Coalesce overlapping main drops into a single larger plump drop
    for (let i = 0; i < this.drops.length; i++) {
      const a = this.drops[i];
      for (let j = this.drops.length - 1; j > i; j--) {
        const b = this.drops[j];
        const dist = Math.hypot((a.x - b.x) * aspect, a.y - b.y);
        if (dist < (a.radius + b.radius) * 0.85) {
          const totalMass = a.mass + b.mass;
          a.x = (a.x * a.mass + b.x * b.mass) / totalMass;
          a.y = Math.min(a.y, b.y);
          a.mass = totalMass;
          a.radius = Math.min(0.022, Math.cbrt(totalMass));
          a.vy = Math.min(a.vy, b.vy) - 0.018;
          a.wobbleAmp = 0.72;
          a.isSlipping = true;
          a.slipTimer = Math.max(a.slipTimer, 0.9);
          this.drops.splice(j, 1);
        }
      }
    }

    // 4. Step pinned trailing micro-beads (slowly evaporate and shrink away cleanly)
    const dryMult = params.isUnderwater ? 6.0 : isRaining ? 1.0 : 1.85;
    for (let j = this.beads.length - 1; j >= 0; j--) {
      const b = this.beads[j];
      b.age += dt * dryMult;
      if (b.age >= b.lifetime) {
        this.beads.splice(j, 1);
        continue;
      }
      const lifeT = b.age / b.lifetime;
      // Hold full bead size briefly, then smoothly shrink & fade out as it evaporates
      const fade = 1 - Math.pow(clamp((lifeT - 0.35) / 0.65, 0, 1), 1.6);
      b.alpha = fade;
      b.radius = b.initialRadius * (0.45 + 0.55 * fade);
    }

    this.syncUniforms();
    this.enabled = this.drops.length > 0 || this.beads.length > 0;
  }

  /** Spawns a single drop striking the screen at a random position (also callable directly in tests). */
  spawnDrop(isStorm = false): ScreenRaindropState | null {
    if (this.drops.length >= MAX_SCREEN_RAINDROPS) return null;

    // Avoid spawning right on top of an existing drop
    const aspect = Math.max(0.35, this.material.uniforms.uAspect.value as number);
    let x = this.randRange(0.07, 0.93);
    let y = this.randRange(0.28, 0.93);
    for (let attempt = 0; attempt < 6; attempt++) {
      let overlaps = false;
      for (let i = 0; i < this.drops.length; i++) {
        const other = this.drops[i];
        if (Math.hypot((x - other.x) * aspect, y - other.y) < 0.09) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) break;
      x = this.randRange(0.07, 0.93);
      y = this.randRange(0.28, 0.93);
    }

    const radius = isStorm ? this.randRange(0.0095, 0.017) : this.randRange(0.0085, 0.0155);
    const drop: ScreenRaindropState = {
      id: this.nextDropId++,
      x,
      y,
      prevX: x,
      prevY: y,
      vx: 0,
      vy: -this.randRange(0.002, 0.008),
      radius,
      mass: radius * radius * radius,
      alpha: 1.0,
      age: 0,
      maxAge: this.randRange(14.0, 22.0),
      // Clings momentarily on impact before breaking loose and drizzling down
      stickTimer: this.randRange(0.25, 0.9),
      slipTimer: 0,
      isSlipping: false,
      stretch: 0,
      leanAngle: 0,
      wobblePhase: 0,
      wobbleAmp: 0.9,
      trailStrength: 0,
      distSinceBead: 0,
      nextBeadDist: this.randRange(0.014, 0.026),
      meanderPhase: this.randRange(0, Math.PI * 2),
      meanderFreq: this.randRange(2.1, 4.4),
      seed: this.rand(),
    };
    this.drops.push(drop);
    this.syncUniforms();
    this.enabled = true;
    return drop;
  }

  private spawnTrailBead(drop: ScreenRaindropState, aspect: number): void {
    // Keep ring-like cap by replacing the oldest bead if full
    if (this.beads.length >= MAX_SCREEN_TRAIL_BEADS) {
      this.beads.shift();
    }
    const jitterX = (this.randRange(-0.22, 0.22) * drop.radius) / aspect;
    const beadR = drop.radius * this.randRange(0.18, 0.34);
    this.beads.push({
      x: clamp(drop.x + jitterX, 0.01, 0.99),
      y: clamp(drop.y + drop.radius * 0.95, 0.01, 0.99),
      radius: beadR,
      initialRadius: beadR,
      age: 0,
      lifetime: this.randRange(3.6, 8.2),
      alpha: 1.0,
    });
  }

  private syncUniforms(): void {
    const u = this.material.uniforms;
    const dropCount = Math.min(this.drops.length, MAX_SCREEN_RAINDROPS);
    u.uActiveDrops.value = dropCount;
    for (let i = 0; i < dropCount; i++) {
      const d = this.drops[i];
      // Fast fade-in over first 35ms for natural impact appearance
      const fadeIn = Math.min(1, d.age / 0.035 + 0.35);
      const impactSplash = Math.exp(-d.age * 16.0);
      const wobbleOffset = Math.sin(d.wobblePhase) * d.wobbleAmp;

      this.dropPosRadUniforms[i].set(d.x, d.y, d.radius, clamp(d.alpha * fadeIn, 0, 1));
      this.dropShapeUniforms[i].set(d.stretch, d.leanAngle, wobbleOffset, impactSplash);
      this.dropTailUniforms[i].set(d.prevX, d.prevY, d.trailStrength, d.seed);
    }

    const beadCount = Math.min(this.beads.length, MAX_SCREEN_TRAIL_BEADS);
    u.uActiveBeads.value = beadCount;
    for (let j = 0; j < beadCount; j++) {
      const b = this.beads[j];
      this.beadUniforms[j].set(b.x, b.y, b.radius, clamp(b.alpha, 0, 1));
    }
  }

  private rand(): number {
    // Fast Mulberry32 deterministic PRNG
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private randRange(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    if (readBuffer.width > 0 && readBuffer.height > 0) {
      u.uAspect.value = readBuffer.width / readBuffer.height;
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
    if (width > 0 && height > 0) {
      this.material.uniforms.uAspect.value = width / height;
      (this.material.uniforms.uTexelSize.value as THREE.Vector2).set(1 / width, 1 / height);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
