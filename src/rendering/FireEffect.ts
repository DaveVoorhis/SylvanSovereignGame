import * as THREE from 'three';

const SHARED_NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  const mat2 FBM_ROT = mat2(0.80, 0.60, -0.60, 0.80);

  float fbm4(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = FBM_ROT * p * 2.04 + vec2(17.1, 31.7);
      a *= 0.49;
    }
    return v;
  }

  // Physically-inspired blackbody fire color ramp (HDR values > 1.0 trigger natural bloom)
  vec3 fireBlackbody(float temp) {
    vec3 cDarkRed = vec3(0.45, 0.025, 0.0);
    vec3 cOrange  = vec3(1.18, 0.27, 0.015);
    vec3 cGold    = vec3(1.48, 0.78, 0.12);
    vec3 cCore    = vec3(1.78, 1.58, 1.14);

    vec3 col = mix(cDarkRed, cOrange, smoothstep(0.04, 0.34, temp));
    col = mix(col, cGold, smoothstep(0.32, 0.66, temp));
    col = mix(col, cCore, smoothstep(0.64, 0.96, temp));
    return col;
  }
`;

// ── 1. Volumetric Multi-Ribbon + Seamless Core Flame Shader ──────────────────
const FLAME_RIBBON_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aLayer;

  uniform float uTime;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vPhase;
  varying float vLayer;
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vPhase = aPhase;
    vLayer = aLayer;
    vLocalPos = position;

    vec3 pos = position;
    float h = clamp(uv.y, 0.0, 1.0);
    float swayAmt = pow(h, 1.5);

    // Organic buoyant flame whipping & wind lean (anchored steadily at the logs)
    float t = uTime;
    float gustX = sin(t * 4.8 + aPhase * 6.283 + h * 3.8) * 0.075
                + sin(t * 9.3 - aPhase * 4.1 + h * 6.4) * 0.032;
    float gustZ = cos(t * 4.3 + aPhase * 5.17 + h * 3.4) * 0.075
                + cos(t * 8.7 + aPhase * 3.3 + h * 5.9) * 0.032;
    float breath = 1.0 + sin(t * 6.4 + aPhase * 4.7) * 0.08 * h;

    pos.x *= 1.0 + sin(t * 5.2 + aPhase * 3.0 + h * 2.5) * 0.06;
    pos.z *= 1.0 + cos(t * 4.9 + aPhase * 2.7 + h * 2.2) * 0.06;
    pos.y *= breath;
    pos.x += (gustX + uWind.x * 0.32) * swayAmt;
    pos.z += (gustZ + uWind.y * 0.32) * swayAmt;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FLAME_RIBBON_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacityScale;

  varying vec2 vUv;
  varying float vPhase;
  varying float vLayer;
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  ${SHARED_NOISE_GLSL}

  void main() {
    float y = clamp(vUv.y, 0.0, 1.0);
    float ndotv = abs(dot(normalize(vWorldNormal), normalize(vViewDir)));
    float t = uTime * (1.05 + fract(vPhase * 0.37) * 0.22);
    float seed = vPhase * 19.73;

    // Branch B: Seamless 3D volumetric teardrop core (ensures lush volume even from top-down view)
    if (vLayer > 0.5) {
      float fresnelSoft = smoothstep(0.08, 0.72, ndotv);
      float vMask = smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.62, 1.0, y));
      if (fresnelSoft * vMask <= 0.004) discard;
      vec2 cylCoord = vec2(vLocalPos.x * 4.8 - vLocalPos.z * 3.6 + seed, y * 2.9 - t * 2.65);
      float w1 = fbm4(cylCoord);
      float w2 = fbm4(vec2(vLocalPos.z * 5.6 + vLocalPos.x * 3.1 + w1 * 1.4, y * 5.1 - t * 4.2));

      float density = fresnelSoft * vMask * (0.62 + w1 * 0.45 + w2 * 0.32 - y * 0.35);
      float flame = smoothstep(0.14, 0.78, density);
      if (flame <= 0.004) discard;

      float temp = clamp(0.28 + flame * 0.62 + (1.0 - y) * 0.26 + (w2 - 0.5) * 0.24, 0.0, 1.0);
      vec3 col = fireBlackbody(temp);
      // Faint oxygen-rich blue-violet shimmer right at the coal base
      float blueBase = (1.0 - smoothstep(0.02, 0.22, y)) * smoothstep(0.3, 0.8, fresnelSoft);
      col = mix(col, vec3(0.30, 0.52, 1.28), blueBase * 0.28);

      float alpha = flame * (uOpacityScale * 0.82) * uIntensity;
      gl_FragColor = vec4(col * alpha, alpha);
      return;
    }

    // Branch A: Curved vertical flame ribbons with view-angle fade & licking turbulent tongues
    float cx = (vUv.x - 0.5) * 2.0; // -1..1 across ribbon
    float viewFade = smoothstep(0.06, 0.58, ndotv);
    // Soft quad-boundary fade guarantees zero straight edges can ever appear
    float edgeMask = (1.0 - smoothstep(0.66, 0.98, abs(cx)))
                   * smoothstep(0.0, 0.11, y)
                   * (1.0 - smoothstep(0.76, 1.0, y));
    if (edgeMask <= 0.004 || viewFade <= 0.001) discard;

    vec2 warpUv = vec2(cx * 1.55 + seed, y * 2.15 - t * 2.2);
    float warp = fbm4(warpUv) - 0.5;
    float fine = fbm4(vec2(cx * 3.2 + warp * 1.5 - seed * 0.5, y * 4.4 - t * 3.85));
    float wisps = vnoise(vec2(cx * 5.8 + warp * 2.1 + seed, y * 6.9 - t * 5.6));

    // Lateral curl grows smoothly toward the upper licking tips
    float curledX = cx + warp * (0.28 + pow(y, 1.15) * 1.08);

    // Organic teardrop profile (cradles logs at bottom, narrows organically into dancing tips)
    float widthProfile = sin(clamp(y * 0.86 + 0.18, 0.0, 1.0) * 3.14159);
    widthProfile *= mix(1.0, 0.36, smoothstep(0.42, 0.98, y));
    float radial = abs(curledX) / max(0.14, widthProfile);

    float baseShape = 1.0 - radial * radial;
    float verticalDecay = 1.0 - pow(y, 1.28);
    float tongueNoise = (fine * 0.72 + wisps * 0.28) * (0.58 + y * 0.82);
    float density = baseShape * (0.48 + verticalDecay * 0.65) + (tongueNoise - 0.44) * (0.72 + y * 0.55);

    float flame = smoothstep(0.08, 0.78, density) * edgeMask;
    if (flame <= 0.004) discard;

    float coreHeat = (1.0 - smoothstep(0.0, 0.72, radial)) * (1.0 - smoothstep(0.08, 0.74, y));
    float temp = clamp(flame * 0.60 + coreHeat * 0.58 + (fine - 0.45) * 0.30, 0.0, 1.0);
    vec3 col = fireBlackbody(temp);

    float blueBase = (1.0 - smoothstep(0.02, 0.20, y))
                   * (1.0 - smoothstep(0.0, 0.48, abs(cx)))
                   * smoothstep(0.25, 0.7, flame);
    col = mix(col, vec3(0.32, 0.52, 1.25), blueBase * 0.24);

    float alpha = flame * viewFade * uOpacityScale * uIntensity;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ── 2. Glowing Charcoal & Ash Bed Shader ─────────────────────────────────────
const EMBER_BED_VERT = /* glsl */ `
  varying vec2 vLocalXZ;
  varying float vRadial;

  void main() {
    vLocalXZ = position.xz;
    vRadial = length(position.xz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EMBER_BED_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uGlowBoost;

  varying vec2 vLocalXZ;
  varying float vRadial;

  ${SHARED_NOISE_GLSL}

  void main() {
    float rNorm = clamp(vRadial / max(0.01, uRadius), 0.0, 1.0);
    vec2 p = vLocalXZ * 5.4 + vec2(uSeed * 3.1, uSeed * 1.9);

    // Cracked charred wood chunks & glowing ember fissures
    float nChunk = fbm4(p);
    float nFine = fbm4(p * 2.35 + vec2(4.2, -2.7));
    float crack = 1.0 - abs(nFine * 2.0 - 1.0);
    crack = pow(clamp(crack, 0.0, 1.0), 2.35);

    // Breathing draft waves drifting across the glowing coals
    float draft = fbm4(vLocalXZ * 1.9 - vec2(uTime * 0.38, uTime * 0.24) + uSeed);
    float pulse = 0.68 + 0.56 * draft + 0.14 * sin(uTime * 3.2 + uSeed * 5.0 + nChunk * 4.0);

    float centerHeat = 1.0 - smoothstep(0.16, 0.96, rNorm);
    float emberHeat = clamp((crack * 0.78 + (1.0 - nChunk) * 0.40) * centerHeat * pulse * uGlowBoost, 0.0, 1.0);

    vec3 ashColor = mix(vec3(0.08, 0.065, 0.06), vec3(0.24, 0.21, 0.19), smoothstep(0.54, 0.98, rNorm) * nChunk);
    vec3 emberCol = fireBlackbody(emberHeat * 0.92);

    vec3 finalCol = mix(ashColor, emberCol, smoothstep(0.08, 0.56, emberHeat));
    finalCol *= mix(1.0, 0.60, smoothstep(0.72, 1.0, rNorm));

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

// ── 3. GPU-Driven Rising Ember Sparks Shader ─────────────────────────────────
const SPARK_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSpeed;
  attribute float aRadius;
  attribute float aHeight;
  attribute float aSize;

  uniform float uTime;
  uniform vec2 uWind;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vTwinkle;

  void main() {
    float life = fract(uTime * aSpeed + aSeed);
    vLife = life;

    float angle = aSeed * 6.28318 + life * (3.2 + fract(aSeed * 7.3) * 3.8) + sin(uTime * 2.4 + aSeed * 12.0) * 0.45;
    float spread = aRadius * (0.32 + life * 1.48);
    float lift = pow(life, 0.85) * aHeight;

    vec3 pos = vec3(
      cos(angle) * spread + uWind.x * life * life * 0.95,
      0.18 + lift,
      sin(angle) * spread + uWind.y * life * life * 0.95
    );

    pos.x += sin(uTime * 5.2 + aSeed * 41.0 + life * 8.0) * 0.08 * life;
    pos.z += cos(uTime * 4.7 + aSeed * 29.0 + life * 7.0) * 0.08 * life;

    vTwinkle = 0.56 + 0.44 * sin(uTime * 19.0 + aSeed * 113.0);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float lifeScale = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life));
    gl_PointSize = clamp(aSize * uPixelRatio * lifeScale * (155.0 / max(1.0, -mvPos.z)), 1.5, 16.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying float vLife;
  varying float vTwinkle;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float distSq = dot(d, d);
    if (distSq > 0.25) discard;

    float glow = exp(-distSq * 18.0);
    float core = smoothstep(0.11, 0.0, distSq);

    vec3 hotCol = vec3(1.88, 1.48, 0.74);
    vec3 midCol = vec3(1.45, 0.44, 0.04);
    vec3 coolCol = vec3(0.65, 0.07, 0.01);
    vec3 col = mix(hotCol, midCol, smoothstep(0.05, 0.48, vLife));
    col = mix(col, coolCol, smoothstep(0.45, 0.92, vLife));
    col += vec3(0.5, 0.35, 0.15) * core * (1.0 - vLife);

    float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.65, 1.0, vLife));
    float alpha = (glow * 0.85 + core * 0.5) * fade * vTwinkle;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ── 4. GPU-Driven Rising Hearth Smoke Plume Shader ───────────────────────────
const SMOKE_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSpeed;
  attribute float aRadius;
  attribute float aSize;

  uniform float uTime;
  uniform vec2 uWind;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vSeed;

  void main() {
    float life = fract(uTime * aSpeed + aSeed);
    vLife = life;
    vSeed = aSeed;

    float swirl = aSeed * 6.28318 + life * 2.1;
    float spread = aRadius * (0.24 + life * 1.78);

    vec3 pos = vec3(
      cos(swirl) * spread + uWind.x * pow(life, 1.35) * 1.48,
      0.90 + life * 2.55,
      sin(swirl) * spread + uWind.y * pow(life, 1.35) * 1.48
    );

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float grow = 0.55 + life * 1.85;
    gl_PointSize = clamp(aSize * uPixelRatio * grow * (185.0 / max(1.2, -mvPos.z)), 5.0, 72.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform float uTime;

  varying float vLife;
  varying float vSeed;

  ${SHARED_NOISE_GLSL}

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;

    float ang = vSeed * 6.28318 + vLife * 1.6;
    float cs = cos(ang);
    float sn = sin(ang);
    vec2 rotUv = mat2(cs, -sn, sn, cs) * uv;
    float wisp = fbm4(rotUv * 4.5 + vec2(vSeed * 13.7, -uTime * 0.25));

    float radial = smoothstep(0.5, 0.08, r);
    float shape = radial * smoothstep(0.24, 0.78, wisp + radial * 0.42);

    float fade = smoothstep(0.0, 0.18, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
    float alpha = shape * fade * 0.22;
    if (alpha <= 0.004) discard;

    vec3 warmLit = vec3(0.58, 0.34, 0.20);
    vec3 coolSmoke = vec3(0.36, 0.35, 0.38);
    vec3 col = mix(warmLit, coolSmoke, smoothstep(0.06, 0.52, vLife));

    gl_FragColor = vec4(col, alpha);
  }
`;

// ── 5. Wood-Fired Bakery Oven Firebox Shader ─────────────────────────────────
const OVEN_FIRE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OVEN_FIRE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  ${SHARED_NOISE_GLSL}

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float y = clamp(vUv.y, 0.0, 1.0);
    float n = fbm4(vec2(p.x * 2.8, y * 3.4 - uTime * 2.9));
    float coal = fbm4(vec2(p.x * 5.5, y * 5.5 + uTime * 0.4));

    float coalBand = (1.0 - smoothstep(0.12, 0.44, y)) * (0.65 + coal * 0.5);
    float tongues = smoothstep(0.26, 0.84, n + (1.0 - y) * 0.42 - abs(p.x) * 0.48);
    float heat = clamp(max(coalBand * 0.92, tongues * 0.95), 0.0, 1.0);

    vec3 darkOven = vec3(0.10, 0.03, 0.01);
    vec3 col = mix(darkOven, fireBlackbody(heat), smoothstep(0.08, 0.65, heat));
    col *= 1.0 - smoothstep(0.72, 1.0, r) * 0.68;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── 6. Volumetric Cottage Chimney Woodsmoke Plume Shader ─────────────────────
const CHIMNEY_SMOKE_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSpeed;
  attribute float aRadius;
  attribute float aHeight;
  attribute float aSize;

  uniform float uTime;
  uniform vec2 uWind;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vSeed;

  void main() {
    float life = fract(uTime * aSpeed + aSeed);
    vLife = life;
    vSeed = aSeed;

    // Buoyant rise: exits chimney pot briskly, then slows and spreads aloft as it cools
    float y = pow(life, 0.84) * aHeight;

    // Gentle vortex curl & ambient turbulence widening smoothly with altitude
    float swirlAngle = aSeed * 6.28318 + life * 4.4 + uTime * 0.45;
    float spread = aRadius * (0.24 + pow(life, 1.18) * 4.25);
    float gust = sin(uTime * 0.65 + life * 3.4 + aSeed * 11.3) * 0.17 * life;

    // Progressive quadratic wind bend: rises vertically from flue, then leans gracefully downwind
    float windCurve = pow(life, 1.7) * 3.6;
    vec3 pos = vec3(
      cos(swirlAngle) * spread + uWind.x * windCurve + gust,
      y,
      sin(swirlAngle) * spread + uWind.y * windCurve - gust * 0.6
    );

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float grow = 0.28 + pow(life, 0.86) * 2.25;
    gl_PointSize = clamp(aSize * uPixelRatio * grow * (175.0 / max(1.4, -mvPos.z)), 3.0, 74.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CHIMNEY_SMOKE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDaylight;
  uniform vec3 uSunDir;

  varying float vLife;
  varying float vSeed;

  ${SHARED_NOISE_GLSL}

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;

    // Slowly tumbling wispy domain-warped FBM so puffs read as tattered woodsmoke, never spheres
    float spinDir = vSeed > 0.5 ? 1.0 : -1.0;
    float ang = vSeed * 6.28318 + vLife * 1.9 * spinDir;
    float cs = cos(ang);
    float sn = sin(ang);
    vec2 rotUv = mat2(cs, -sn, sn, cs) * uv;

    vec2 flow = vec2(vSeed * 17.3, -uTime * 0.22 - vLife * 0.85);
    float warpX = fbm4(rotUv * 3.2 + flow) - 0.5;
    float warpY = fbm4(rotUv * 3.2 + flow + vec2(4.7, 2.3)) - 0.5;
    vec2 warpedUv = rotUv + vec2(warpX, warpY) * (0.28 + vLife * 0.2);

    float density = fbm4(warpedUv * 4.8 + flow * 1.15);

    // Delicate, airy gossamer filaments that curl and dissolve smoothly aloft
    float radial = smoothstep(0.5, 0.08, r);
    float cutLow = mix(0.36, 0.56, vLife);
    float wisp = smoothstep(cutLow, 0.90, density + radial * 0.28);
    wisp = pow(wisp, 1.25);
    float shape = radial * radial * wisp;

    // Smooth emergence at the chimney lip and delicate dissipation into the sky
    float fadeIn = smoothstep(0.0, 0.09, vLife);
    float fadeOut = 1.0 - smoothstep(0.18, 0.96, vLife);
    float alpha = shape * fadeIn * fadeOut * 0.145;
    if (alpha <= 0.003) discard;

    float densityShift = fbm4((warpedUv + vec2(0.06, -0.06)) * 4.8 + flow * 1.15);
    // Volumetric directional lighting: warm sunlit crests & soft cool shadowed undersides
    vec2 lobeGrad = vec2(densityShift - density, density - densityShift) * 2.4;
    vec3 pseudoNormal = normalize(vec3(uv.x * 1.7 + lobeGrad.x, -uv.y * 1.7 + lobeGrad.y + 0.35, 0.72));
    float sunWrap = clamp(dot(pseudoNormal, normalize(uSunDir)) * 0.5 + 0.55, 0.0, 1.0);
    float rimSoft = smoothstep(0.45, 0.12, r) * 0.15;

    vec3 dayShadow = vec3(0.69, 0.73, 0.79);
    vec3 dayLit = vec3(0.96, 0.95, 0.93);
    vec3 dayCol = mix(dayShadow, dayLit, clamp(sunWrap + rimSoft, 0.0, 1.0));

    vec3 nightShadow = vec3(0.16, 0.20, 0.27);
    vec3 nightLit = vec3(0.36, 0.42, 0.52);
    vec3 nightCol = mix(nightShadow, nightLit, sunWrap);

    vec3 col = mix(nightCol, dayCol, uDaylight);

    // Subtle warm hearth-flue glow tinting the lowest emerging smoke right at the chimney pot
    float flueWarmth = (1.0 - smoothstep(0.0, 0.18, vLife)) * (0.28 + (1.0 - uDaylight) * 0.42);
    col = mix(col, vec3(0.84, 0.58, 0.34), flueWarmth * 0.55);

    gl_FragColor = vec4(col, alpha);
  }
`;

function getDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * Builds a single merged BufferGeometry containing:
 *  - 6 radially arranged, gently curved vertical flame ribbons with staggered heights & offsets
 *  - 1 sculpted organic inner teardrop core so top-down camera views show lush 3D volume
 * All parts share one draw call and carry per-part `aPhase` and `aLayer` vertex attributes.
 */
function buildVolumetricFlameGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const phases: number[] = [];
  const layers: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;

  const appendSubGeo = (
    geo: THREE.BufferGeometry,
    phase: number,
    layer: number,
  ): void => {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const idx = geo.getIndex();

    for (let i = 0; i < posAttr.count; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));
      phases.push(phase);
      layers.push(layer);
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i + vertexOffset);
      }
    }
    vertexOffset += posAttr.count;
    geo.dispose();
  };

  // 6 radially arrayed, gently curved flame sheets around the hearth center
  const ribbonCount = 6;
  for (let i = 0; i < ribbonCount; i++) {
    const angle = (i / ribbonCount) * Math.PI + (i % 2) * 0.14;
    const width = 0.88 + (i % 3) * 0.11;
    const height = 1.24 + ((i * 37) % 10) * 0.038;
    const plane = new THREE.PlaneGeometry(width, height, 6, 14);
    const pAttr = plane.getAttribute('position') as THREE.BufferAttribute;

    const archCurve = (i % 2 === 0 ? 1 : -1) * 0.12;
    for (let v = 0; v < pAttr.count; v++) {
      const px = pAttr.getX(v);
      const py = pAttr.getY(v) + height * 0.5;
      const yn = py / height;
      const taper = 1.0 - yn * 0.22;
      const bendZ = Math.cos((px / (width * 0.5)) * 1.2) * archCurve * (1.0 - yn * 0.4);
      pAttr.setXYZ(v, px * taper, py, bendZ);
    }
    plane.computeVertexNormals();

    const radialOffset = 0.05 + (i % 2) * 0.06;
    const mat = new THREE.Matrix4()
      .makeRotationY(angle)
      .multiply(new THREE.Matrix4().makeTranslation(radialOffset, 0, 0));
    plane.applyMatrix4(mat);

    appendSubGeo(plane, (i + 0.37) / ribbonCount, 0.0);
  }

  // Sculpted volumetric inner teardrop core (visible cleanly from high overhead angles)
  const corePts: THREE.Vector2[] = [
    new THREE.Vector2(0.02, 0.0),
    new THREE.Vector2(0.24, 0.06),
    new THREE.Vector2(0.32, 0.22),
    new THREE.Vector2(0.29, 0.42),
    new THREE.Vector2(0.21, 0.64),
    new THREE.Vector2(0.11, 0.86),
    new THREE.Vector2(0.015, 1.04),
  ];
  const coreLathe = new THREE.LatheGeometry(corePts, 16);
  appendSubGeo(coreLathe, 0.83, 1.0);

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  merged.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
  merged.setIndex(indices);
  return merged;
}

/**
 * Builds an organically mounded charcoal & ash bed disc for the firepit center.
 */
function buildEmberBedGeometry(radius: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius * 0.86, radius, 0.14, 22, 3);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 0) {
      const r = Math.hypot(x, z) / radius;
      const dome = Math.max(0, 1 - r * r) * 0.11;
      const lumps = Math.sin(x * 16.3 + z * 11.7) * Math.cos(z * 14.1 - x * 9.2) * 0.022;
      pos.setY(i, y + dome + lumps);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds deterministic GPU-animated ember spark point cloud geometry.
 */
function buildSparkGeometry(count: number, seed: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const radii = new Float32Array(count);
  const heights = new Float32Array(count);
  const sizes = new Float32Array(count);

  const rand = (k: number) => {
    const x = Math.sin((seed + 1.37) * 91.7 + k * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };

  for (let i = 0; i < count; i++) {
    seeds[i] = rand(i * 5 + 1);
    speeds[i] = 0.24 + rand(i * 5 + 2) * 0.34;
    radii[i] = 0.14 + rand(i * 5 + 3) * 0.34;
    heights[i] = 1.65 + rand(i * 5 + 4) * 1.75;
    sizes[i] = 2.6 + rand(i * 5 + 5) * 3.8;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 2.8);
  return geo;
}

/**
 * Builds deterministic GPU-animated hearth smoke plume point cloud geometry.
 */
function buildSmokePlumeGeometry(count: number, seed: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const radii = new Float32Array(count);
  const sizes = new Float32Array(count);

  const rand = (k: number) => {
    const x = Math.sin((seed + 4.19) * 73.1 + k * 211.7) * 43758.5453;
    return x - Math.floor(x);
  };

  for (let i = 0; i < count; i++) {
    seeds[i] = (i + rand(i * 4 + 1) * 0.65) / count;
    speeds[i] = 0.16 + rand(i * 4 + 2) * 0.1;
    radii[i] = 0.12 + rand(i * 4 + 3) * 0.24;
    sizes[i] = 10.0 + rand(i * 4 + 4) * 9.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.2, 0), 3.4);
  return geo;
}

/**
 * Complete volumetric hearth campfire effect:
 *  - Glowing cracked charcoal & ash ember bed
 *  - Multi-layered turbulent blackbody shader flames (6 curved ribbons + inner volumetric core)
 *  - Rising spiraling glowing sparks/embers
 *  - Soft rising firelit smoke wisps
 *  - Dynamic position-, color-, and intensity-flickering warm PointLight
 */
export class HearthFire {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;

  private readonly emberBedMat: THREE.ShaderMaterial;
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly sparkMat: THREE.ShaderMaterial;
  private readonly smokeMat: THREE.ShaderMaterial;

  private readonly emberBedMesh: THREE.Mesh;
  private readonly flameMesh: THREE.Mesh;
  private readonly sparkPoints: THREE.Points;
  private readonly smokePoints: THREE.Points;

  private readonly baseLightPos = new THREE.Vector3(0, 1.45, 0);
  private readonly lightColorWarm = new THREE.Color(0xff9b38);
  private readonly lightColorDeep = new THREE.Color(0xff5e16);
  private readonly lightColorCurr = new THREE.Color(0xff8c2b);

  constructor(
    private readonly seed: number,
    sharedFlameGeo: THREE.BufferGeometry,
    attachLightToGroup = true,
  ) {
    const pixelRatio = getDevicePixelRatio();

    // 1. Mounded glowing ember & ash bed
    const emberRadius = 0.56;
    const emberGeo = buildEmberBedGeometry(emberRadius);
    this.emberBedMat = new THREE.ShaderMaterial({
      vertexShader: EMBER_BED_VERT,
      fragmentShader: EMBER_BED_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uRadius: { value: emberRadius },
        uGlowBoost: { value: 1.15 },
      },
    });
    this.emberBedMesh = new THREE.Mesh(emberGeo, this.emberBedMat);
    this.emberBedMesh.position.y = 0.16;
    this.emberBedMesh.receiveShadow = true;
    this.group.add(this.emberBedMesh);

    // 2. Volumetric multi-layered turbulent flame shader
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_RIBBON_VERT,
      fragmentShader: FLAME_RIBBON_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0.18, 0.08) },
        uIntensity: { value: 1.0 },
        uOpacityScale: { value: 0.44 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.flameMesh = new THREE.Mesh(sharedFlameGeo, this.flameMat);
    this.flameMesh.position.y = 0.22;
    this.flameMesh.renderOrder = 4;
    this.group.add(this.flameMesh);

    // 3. Rising glowing ember sparks
    const sparkGeo = buildSparkGeometry(30, seed);
    this.sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0.18, 0.08) },
        uPixelRatio: { value: pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkPoints = new THREE.Points(sparkGeo, this.sparkMat);
    this.sparkPoints.position.y = 0.08;
    this.sparkPoints.renderOrder = 5;
    this.group.add(this.sparkPoints);

    // 4. Soft rising smoke wisps above the flames
    const smokeGeo = buildSmokePlumeGeometry(14, seed);
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0.18, 0.08) },
        uPixelRatio: { value: pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.smokePoints = new THREE.Points(smokeGeo, this.smokeMat);
    this.smokePoints.renderOrder = 3;
    this.group.add(this.smokePoints);

    // 5. Dynamic warm flickering firelight (optionally detached when driven by a fixed scene PointLight pool
    //    so adding settlements never changes NUM_POINT_LIGHTS and triggers scene-wide PBR shader recompiles)
    this.light = new THREE.PointLight(0xff8c2b, 5.2, 22, 1.55);
    this.light.position.copy(this.baseLightPos);
    if (attachLightToGroup) {
      this.group.add(this.light);
    }
  }

  /** Updates shader uniforms, wind bend, and organic multi-frequency firelight flicker. */
  update(elapsedSeconds: number, nightGlow: number, windStrength: number): void {
    const t = elapsedSeconds;
    const s = this.seed;

    const windAngle = Math.sin(t * 0.28 + s * 0.7) * 0.65 + 0.4;
    const wx = Math.cos(windAngle) * windStrength;
    const wz = Math.sin(windAngle) * windStrength;

    this.emberBedMat.uniforms.uTime.value = t;
    this.emberBedMat.uniforms.uGlowBoost.value = 1.0 + nightGlow * 0.22;

    this.flameMat.uniforms.uTime.value = t + s * 3.1;
    (this.flameMat.uniforms.uWind.value as THREE.Vector2).set(wx, wz);
    this.flameMat.uniforms.uIntensity.value = 0.88 + Math.min(0.45, nightGlow * 0.18);

    this.sparkMat.uniforms.uTime.value = t;
    (this.sparkMat.uniforms.uWind.value as THREE.Vector2).set(wx, wz);

    this.smokeMat.uniforms.uTime.value = t;
    (this.smokeMat.uniforms.uWind.value as THREE.Vector2).set(wx, wz);

    // Multi-harmonic natural firelight flicker (intensity + subtle spatial dance + color shift)
    const f1 = Math.sin(t * 6.8 + s * 2.3);
    const f2 = Math.sin(t * 14.3 + s * 5.7) * 0.55;
    const f3 = Math.sin(t * 23.1 - s * 3.1) * 0.25;
    const flicker = (f1 + f2 + f3) / 1.8;

    this.light.intensity = Math.max(1.2, nightGlow * 6.8 + flicker * 2.15 + 1.1);
    this.light.position.set(
      this.baseLightPos.x + Math.sin(t * 9.4 + s) * 0.07 + wx * 0.08,
      this.baseLightPos.y + flicker * 0.08,
      this.baseLightPos.z + Math.cos(t * 8.6 + s * 1.4) * 0.07 + wz * 0.08,
    );

    const warmth = THREE.MathUtils.clamp(0.5 + flicker * 0.42, 0, 1);
    this.lightColorCurr.lerpColors(this.lightColorDeep, this.lightColorWarm, warmth);
    this.light.color.copy(this.lightColorCurr);
  }

  /** Exposes flame shader material for tests and inspection. */
  get flameMaterial(): THREE.ShaderMaterial {
    return this.flameMat;
  }

  /** Disposes per-instance geometries and shader materials (sharedFlameGeo is disposed by owner). */
  dispose(): void {
    this.emberBedMesh.geometry.dispose();
    this.emberBedMat.dispose();
    this.flameMat.dispose();
    this.sparkPoints.geometry.dispose();
    this.sparkMat.dispose();
    this.smokePoints.geometry.dispose();
    this.smokeMat.dispose();
  }
}

/** Creates the shared multi-ribbon + core geometry used by all HearthFire instances. */
export function createSharedFlameGeometry(): THREE.BufferGeometry {
  return buildVolumetricFlameGeometry();
}

/** Creates a flickering wood-fired oven firebox shader material for hearth bakeries. */
export function createOvenFireMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: OVEN_FIRE_VERT,
    fragmentShader: OVEN_FIRE_FRAG,
    uniforms: {
      uTime: { value: 0 },
    },
  });
}

/**
 * Builds deterministic GPU-animated volumetric cottage chimney woodsmoke geometry
 * (16 staggered rising wispy tendrils per flue).
 */
export function createChimneySmokeGeometry(seed: number, puffCount = 16): THREE.BufferGeometry {
  const positions = new Float32Array(puffCount * 3);
  const seeds = new Float32Array(puffCount);
  const speeds = new Float32Array(puffCount);
  const radii = new Float32Array(puffCount);
  const heights = new Float32Array(puffCount);
  const sizes = new Float32Array(puffCount);

  const rand = (k: number) => {
    const x = Math.sin((seed + 2.71) * 89.3 + k * 197.3) * 43758.5453;
    return x - Math.floor(x);
  };

  for (let i = 0; i < puffCount; i++) {
    seeds[i] = (i + rand(i * 5 + 1) * 0.55) / puffCount;
    speeds[i] = 0.15 + rand(i * 5 + 2) * 0.065;
    radii[i] = 0.12 + rand(i * 5 + 3) * 0.16;
    heights[i] = 3.3 + rand(i * 5 + 4) * 1.65;
    sizes[i] = 5.4 + rand(i * 5 + 5) * 4.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.4, 0), 4.8);
  return geo;
}

/** Creates the shared volumetric woodsmoke shader material used by all building chimneys. */
export function createChimneySmokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CHIMNEY_SMOKE_VERT,
    fragmentShader: CHIMNEY_SMOKE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0.28, 0.12) },
      uDaylight: { value: 0.9 },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
      uPixelRatio: { value: getDevicePixelRatio() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}
