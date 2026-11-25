import * as THREE from 'three';

export interface PbrTextureSet {
  readonly map: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.CanvasTexture;
}

export interface TextureLibrary {
  readonly forestFloor: PbrTextureSet;
  readonly oakBark: PbrTextureSet;
  readonly pineBark: PbrTextureSet;
  readonly birchBark: PbrTextureSet;
  readonly timber: PbrTextureSet;
  readonly thatch: PbrTextureSet;
  readonly stone: PbrTextureSet;
  readonly waterNormal: THREE.CanvasTexture;
  readonly furBump: THREE.CanvasTexture;
  readonly fabricBump: THREE.CanvasTexture;
  readonly toadstoolCap: THREE.CanvasTexture;
  readonly softParticle: THREE.CanvasTexture;
  readonly oakLeafCluster: THREE.CanvasTexture;
  readonly birchLeafCluster: THREE.CanvasTexture;
  readonly pineNeedleSpray: THREE.CanvasTexture;
  dispose(): void;
}

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable for procedural PBR texture generation');
  }
  return [canvas, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  repeat: number,
  isColor: boolean,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function createForestFloor(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  // Hue-neutral light organic micro-grain albedo so terrain vertex colors faithfully express
  // verdant emerald forests, sunlit grassy prairies, arid golden sand dunes, and snowy alpine crags.
  ctxMap.fillStyle = '#dfdfda';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#7f7f7f';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = '#dcdcdc';
  ctxRough.fillRect(0, 0, size, size);

  for (let i = 0; i < size * 2.6; i++) {
    const x = hash2(i, 1, 7) * size;
    const y = hash2(i, 2, 7) * size;
    const r = size * (0.025 + hash2(i, 3, 7) * 0.055);
    const v = hash2(i, 4, 7);
    ctxMap.fillStyle =
      v < 0.38
        ? 'rgba(186, 188, 182, 0.22)'
        : v < 0.76
          ? 'rgba(244, 244, 238, 0.2)'
          : 'rgba(202, 198, 188, 0.18)';
    ctxMap.beginPath();
    ctxMap.arc(x, y, r, 0, Math.PI * 2);
    ctxMap.fill();
  }

  for (let i = 0; i < size * 26; i++) {
    const x = hash2(i, 1, 11) * size;
    const y = hash2(i, 2, 11) * size;
    const r = 0.9 + hash2(i, 3, 11) * (size * 0.015);
    const tone = hash2(i, 4, 11);

    if (tone < 0.34) {
      ctxMap.fillStyle = `rgba(174, 176, 170, ${0.18 + tone * 0.28})`;
    } else if (tone < 0.7) {
      ctxMap.fillStyle = `rgba(222, 224, 218, ${0.18 + tone * 0.24})`;
    } else if (tone < 0.87) {
      ctxMap.fillStyle = 'rgba(196, 192, 184, 0.22)';
    } else if (tone < 0.96) {
      ctxMap.fillStyle = 'rgba(248, 248, 244, 0.26)';
    } else {
      ctxMap.fillStyle =
        hash2(i, 5, 11) > 0.5 ? 'rgba(255, 255, 250, 0.28)' : 'rgba(164, 162, 156, 0.24)';
    }

    ctxMap.beginPath();
    ctxMap.arc(x, y, r, 0, Math.PI * 2);
    ctxMap.fill();

    const lum = Math.floor(86 + tone * 128);
    ctxBump.fillStyle = `rgba(${lum},${lum},${lum},0.42)`;
    ctxBump.beginPath();
    ctxBump.arc(x, y, r, 0, Math.PI * 2);
    ctxBump.fill();

    const rough = Math.floor(182 + (1 - tone) * 62);
    ctxRough.fillStyle = `rgba(${rough},${rough},${rough},0.34)`;
    ctxRough.beginPath();
    ctxRough.arc(x, y, r, 0, Math.PI * 2);
    ctxRough.fill();
  }

  return {
    map: finalizeTexture(cMap, 26, true),
    bumpMap: finalizeTexture(cBump, 26, false),
    roughnessMap: finalizeTexture(cRough, 26, false),
  };
}

function createBark(size: number, kind: 'oak' | 'pine' | 'birch'): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  ctxMap.fillStyle = kind === 'birch' ? '#ede5d8' : kind === 'pine' ? '#5a3a27' : '#4f3a2a';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#808080';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = kind === 'birch' ? '#c8c8c8' : '#e2e2e2';
  ctxRough.fillRect(0, 0, size, size);

  if (kind === 'birch') {
    for (let i = 0; i < size * 2.4; i++) {
      const y = hash2(i, 2, 28) * size;
      ctxMap.fillStyle =
        hash2(i, 3, 28) > 0.5 ? 'rgba(218, 206, 188, 0.36)' : 'rgba(255, 252, 244, 0.3)';
      ctxMap.fillRect(0, y, size, 1.5);
    }
    for (let i = 0; i < size * 3.4; i++) {
      const x = hash2(i, 1, 29) * size;
      const y = hash2(i, 2, 29) * size;
      const w = 10 + hash2(i, 3, 29) * (size * 0.17);
      const h = 1.4 + hash2(i, 4, 29) * 3.6;
      const v = hash2(i, 5, 29);
      ctxMap.fillStyle =
        v > 0.24
          ? 'rgba(46, 38, 34, 0.74)'
          : v > 0.1
            ? 'rgba(92, 118, 66, 0.52)'
            : 'rgba(138, 122, 92, 0.46)';
      ctxMap.beginPath();
      ctxMap.ellipse(x, y, w * 0.5, h * 0.55, 0, 0, Math.PI * 2);
      ctxMap.fill();
      ctxBump.fillStyle = 'rgba(38,38,38,0.64)';
      ctxBump.fillRect(x - w * 0.5, y - h * 0.5, w, h);
    }
  } else if (kind === 'pine') {
    // Realistic scaly reddish-brown pine bark plates & deep charcoal crevices
    const rows = 16;
    const cols = 10;
    const rh = size / rows;
    const cw = size / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * cw * 0.45;
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + off + hash2(r, c, 61) * 4;
        const y = r * rh + hash2(r, c, 62) * 3;
        const w = cw * (0.72 + hash2(r, c, 63) * 0.22);
        const h = rh * (0.75 + hash2(r, c, 64) * 0.35);
        const v = hash2(r, c, 65);
        const red = Math.round(78 + v * 52);
        const grn = Math.round(48 + v * 34);
        const blu = Math.round(32 + v * 22);
        ctxMap.fillStyle = `rgb(${red},${grn},${blu})`;
        ctxMap.beginPath();
        ctxMap.roundRect(x, y, w, h, 4);
        ctxMap.fill();

        // Dark bark plate crevice
        ctxMap.strokeStyle = 'rgba(26, 15, 10, 0.72)';
        ctxMap.lineWidth = 2.4;
        ctxMap.stroke();

        const b = Math.round(135 + v * 95);
        ctxBump.fillStyle = `rgb(${b},${b},${b})`;
        ctxBump.beginPath();
        ctxBump.roundRect(x, y, w, h, 4);
        ctxBump.fill();
        ctxBump.strokeStyle = 'rgba(22,22,22,0.85)';
        ctxBump.lineWidth = 2.6;
        ctxBump.stroke();
      }
    }
  } else {
    // Deep organic braided oak bark ridges, dark furrows, silvery lichen & soft green moss
    for (let i = 0; i < size * 4.5; i++) {
      const x = hash2(i, 1, 17) * size;
      const y = hash2(i, 2, 17) * size;
      const w = 1.8 + hash2(i, 3, 17) * 6.5;
      const h = 22 + hash2(i, 4, 17) * (size * 0.28);
      const v = hash2(i, 5, 17);
      const sway = (hash2(i, 6, 17) - 0.5) * 10;
      ctxMap.strokeStyle =
        v < 0.4
          ? 'rgba(28, 18, 12, 0.65)'
          : v < 0.76
            ? 'rgba(112, 88, 64, 0.5)'
            : v < 0.9
              ? 'rgba(136, 126, 108, 0.36)'
              : 'rgba(72, 106, 46, 0.44)';
      ctxMap.lineWidth = w;
      ctxMap.beginPath();
      ctxMap.moveTo(x, y);
      ctxMap.quadraticCurveTo(x + sway, y + h * 0.5, x - sway * 0.5, y + h);
      ctxMap.stroke();

      const bVal = v < 0.4 ? 26 : 210;
      ctxBump.strokeStyle = `rgba(${bVal},${bVal},${bVal},0.62)`;
      ctxBump.lineWidth = w;
      ctxBump.beginPath();
      ctxBump.moveTo(x, y);
      ctxBump.quadraticCurveTo(x + sway, y + h * 0.5, x - sway * 0.5, y + h);
      ctxBump.stroke();
    }
  }

  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * High-resolution alpha-cutout botanical oak leaf spray on fine dark twigs.
 * Neutral warm-white/pale-sage base allows seasonal tinting & sunlit depth shading.
 */
function createOakLeafCluster(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.5;

  // Fine branching woody twigs radiating from center
  ctx.strokeStyle = '#473322';
  ctx.lineCap = 'round';
  const branchAngles = [-2.5, -1.7, -0.9, -0.2, 0.55, 1.35, 2.2];
  for (let i = 0; i < branchAngles.length; i++) {
    const a = branchAngles[i];
    const len = size * (0.28 + hash2(i, 1, 81) * 0.14);
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.08);
    ctx.quadraticCurveTo(
      cx + Math.cos(a) * len * 0.5,
      cy + Math.sin(a) * len * 0.5,
      cx + Math.cos(a) * len,
      cy + Math.sin(a) * len,
    );
    ctx.stroke();
  }

  // Draw a crisp lobed oak leaf
  const drawOakLeaf = (x: number, y: number, angle: number, len: number, width: number, shade: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const r = Math.round(168 + shade * 62);
    const g = Math.round(192 + shade * 55);
    const b = Math.round(146 + shade * 46);

    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.72)}, ${Math.round(g * 0.76)}, ${Math.round(b * 0.72)})`);
    grad.addColorStop(0.55, `rgb(${r}, ${g}, ${b})`);
    grad.addColorStop(1, `rgb(${Math.min(255, Math.round(r * 1.12))}, ${Math.min(255, Math.round(g * 1.1))}, ${Math.min(255, Math.round(b * 1.04))})`);

    // Lobed oak leaf silhouette (3 rounded lobes on each side + tip)
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.15, -width * 0.35, len * 0.28, -width * 0.85, len * 0.38, -width * 0.65);
    ctx.bezierCurveTo(len * 0.45, -width * 0.42, len * 0.54, -width * 1.05, len * 0.68, -width * 0.82);
    ctx.bezierCurveTo(len * 0.78, -width * 0.52, len * 0.88, -width * 0.62, len, 0);
    ctx.bezierCurveTo(len * 0.88, width * 0.62, len * 0.78, width * 0.52, len * 0.68, width * 0.82);
    ctx.bezierCurveTo(len * 0.54, width * 1.05, len * 0.45, width * 0.42, len * 0.38, width * 0.65);
    ctx.bezierCurveTo(len * 0.28, width * 0.85, len * 0.15, width * 0.35, 0, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle dark edge definition & botanical midrib/veins
    ctx.strokeStyle = 'rgba(42, 56, 30, 0.34)';
    ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(235, 245, 205, 0.45)';
    ctx.lineWidth = Math.max(1, size * 0.0035);
    ctx.beginPath();
    ctx.moveTo(len * 0.04, 0);
    ctx.lineTo(len * 0.9, 0);
    for (const t of [0.3, 0.55, 0.76]) {
      ctx.moveTo(len * t, 0);
      ctx.lineTo(len * (t + 0.12), -width * 0.46);
      ctx.moveTo(len * t, 0);
      ctx.lineTo(len * (t + 0.12), width * 0.46);
    }
    ctx.stroke();

    ctx.restore();
  };

  // Layer 42 oak leaves in an airy, natural organic bouquet with crisp transparent gaps
  const leafCount = 44;
  for (let i = 0; i < leafCount; i++) {
    const ring = i < 16 ? 0.16 : i < 32 ? 0.28 : 0.37;
    const angle = (i / leafCount) * Math.PI * 2 * 3.1 + hash2(i, 2, 82) * 0.45;
    const dist = size * (ring * (0.62 + hash2(i, 3, 82) * 0.58));
    const lx = cx + Math.cos(angle) * dist * 0.72;
    const ly = cy + Math.sin(angle) * dist * 0.72;
    const leafAngle = angle + (hash2(i, 4, 82) - 0.5) * 0.85;
    const len = size * (0.14 + hash2(i, 5, 82) * 0.09);
    const width = len * (0.34 + hash2(i, 6, 82) * 0.1);
    const shade = (i / leafCount) * 0.75 + hash2(i, 7, 82) * 0.35;
    drawOakLeaf(lx, ly, leafAngle, len, width, shade);
  }

  return finalizeTexture(canvas, 1, true, THREE.ClampToEdgeWrapping);
}

/**
 * High-resolution alpha-cutout feathery birch leaf spray on slender drooping twigs.
 */
function createBirchLeafCluster(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.5;

  // Slender drooping birch twigs
  ctx.strokeStyle = '#5c4b3c';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = size * (0.32 + hash2(i, 1, 91) * 0.12);
    ctx.lineWidth = size * 0.007;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + Math.cos(a) * len * 0.55,
      cy + Math.sin(a) * len * 0.4 + size * 0.04,
      cx + Math.cos(a) * len,
      cy + Math.sin(a) * len + size * 0.08,
    );
    ctx.stroke();
  }

  // Delicate diamond-pointed birch leaves
  const leafCount = 62;
  for (let i = 0; i < leafCount; i++) {
    const a = hash2(i, 1, 92) * Math.PI * 2;
    const dist = Math.sqrt(hash2(i, 2, 92)) * size * 0.39;
    const x = cx + Math.cos(a) * dist;
    const y = cy + Math.sin(a) * dist;
    const rot = a + (hash2(i, 3, 92) - 0.5) * 1.1;
    const len = size * (0.085 + hash2(i, 4, 92) * 0.055);
    const w = len * 0.44;
    const shade = 0.25 + (i / leafCount) * 0.75;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    const r = Math.round(182 + shade * 55);
    const g = Math.round(206 + shade * 45);
    const b = Math.round(144 + shade * 42);
    ctx.fillStyle = `rgb(${r},${g},${b})`;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.34, -w, len, 0);
    ctx.quadraticCurveTo(len * 0.34, w, 0, 0);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 255, 218, 0.42)';
    ctx.lineWidth = Math.max(1, size * 0.0025);
    ctx.beginPath();
    ctx.moveTo(len * 0.06, 0);
    ctx.lineTo(len * 0.88, 0);
    ctx.stroke();

    ctx.restore();
  }

  return finalizeTexture(canvas, 1, true, THREE.ClampToEdgeWrapping);
}

/**
 * High-resolution alpha-cutout realistic conifer pine-needle bough spray.
 * Woody branchlet down the center with hundreds of crisp fanning evergreen needles.
 */
function createPineNeedleSpray(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const baseY = size * 0.94;
  const tipY = size * 0.08;

  // Sub-branchlets fanning off the central bough shoot
  const shoots: { x0: number; y0: number; x1: number; y1: number; needles: number }[] = [
    { x0: cx, y0: baseY, x1: cx, y1: tipY, needles: 96 },
    { x0: cx, y0: size * 0.78, x1: size * 0.14, y1: size * 0.46, needles: 56 },
    { x0: cx, y0: size * 0.78, x1: size * 0.86, y1: size * 0.46, needles: 56 },
    { x0: cx, y0: size * 0.58, x1: size * 0.18, y1: size * 0.28, needles: 48 },
    { x0: cx, y0: size * 0.58, x1: size * 0.82, y1: size * 0.28, needles: 48 },
    { x0: cx, y0: size * 0.38, x1: size * 0.28, y1: size * 0.15, needles: 36 },
    { x0: cx, y0: size * 0.38, x1: size * 0.72, y1: size * 0.15, needles: 36 },
  ];

  // Draw woody twigs first
  ctx.strokeStyle = '#5c3c24';
  ctx.lineCap = 'round';
  for (let s = 0; s < shoots.length; s++) {
    const sh = shoots[s];
    ctx.lineWidth = s === 0 ? size * 0.024 : size * 0.015;
    ctx.beginPath();
    ctx.moveTo(sh.x0, sh.y0);
    ctx.lineTo(sh.x1, sh.y1);
    ctx.stroke();
  }

  // Draw dense clusters of crisp individual pine needles radiating off every shoot
  ctx.lineCap = 'round';
  for (let s = 0; s < shoots.length; s++) {
    const sh = shoots[s];
    const dx = sh.x1 - sh.x0;
    const dy = sh.y1 - sh.y0;
    const baseAngle = Math.atan2(dy, dx);

    for (let i = 0; i < sh.needles; i++) {
      const t = 0.08 + (i / sh.needles) * 0.9;
      const sx = sh.x0 + dx * t;
      const sy = sh.y0 + dy * t;
      const side = i % 2 === 0 ? 1 : -1;
      const spread = side * (0.42 + hash2(s * 100 + i, 1, 77) * 0.68);
      const needleAngle = baseAngle + spread;
      const needleLen = size * (0.095 + hash2(s * 100 + i, 2, 77) * 0.065) * (1.12 - t * 0.42);
      const bright = 0.62 + t * 0.38 + hash2(s * 100 + i, 3, 77) * 0.2;

      const r = Math.min(255, Math.round(138 * bright));
      const g = Math.min(255, Math.round(192 * bright));
      const b = Math.min(255, Math.round(152 * bright));

      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = Math.max(1.4, size * 0.0085);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(needleAngle) * needleLen, sy + Math.sin(needleAngle) * needleLen);
      ctx.stroke();
    }
  }

  return finalizeTexture(canvas, 1, true, THREE.ClampToEdgeWrapping);
}

function createTimber(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  ctxMap.fillStyle = '#855d3b';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#909090';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = '#c8c8c8';
  ctxRough.fillRect(0, 0, size, size);

  const planks = 8;
  const plankH = size / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * plankH;
    const shade = 0.86 + hash2(p, 1, 41) * 0.28;
    ctxMap.fillStyle = `rgb(${Math.round(134 * shade)}, ${Math.round(92 * shade)}, ${Math.round(56 * shade)})`;
    ctxMap.fillRect(0, y0, size, plankH - 2);

    for (let g = 0; g < 26; g++) {
      const gy = y0 + hash2(p, g, 42) * (plankH - 3);
      ctxMap.fillStyle =
        g % 3 === 0 ? 'rgba(170, 124, 78, 0.2)' : 'rgba(54, 34, 20, 0.22)';
      ctxMap.fillRect(0, gy, size, 1.5);
    }

    const pegX = (0.15 + hash2(p, 9, 43) * 0.7) * size;
    ctxMap.fillStyle = '#3b2414';
    ctxMap.beginPath();
    ctxMap.arc(pegX, y0 + plankH * 0.5, 2.8, 0, Math.PI * 2);
    ctxMap.fill();

    ctxMap.fillStyle = '#2d1c10';
    ctxMap.fillRect(0, y0 + plankH - 2, size, 2);
    ctxBump.fillStyle = '#181818';
    ctxBump.fillRect(0, y0 + plankH - 2, size, 2);
  }

  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

function createThatch(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  ctxMap.fillStyle = '#756838';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#808080';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = '#e4e4e4';
  ctxRough.fillRect(0, 0, size, size);

  const rows = 10;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH;
    ctxMap.fillStyle = 'rgba(42, 34, 16, 0.28)';
    ctxMap.fillRect(0, y0 + rowH - 3, size, 3);
    ctxBump.fillStyle = 'rgba(32, 32, 32, 0.5)';
    ctxBump.fillRect(0, y0 + rowH - 3, size, 3);
  }

  for (let i = 0; i < size * 10; i++) {
    const x = hash2(i, 1, 73) * size;
    const y = hash2(i, 2, 73) * size;
    const len = 10 + hash2(i, 3, 73) * 26;
    const v = hash2(i, 4, 73);
    ctxMap.strokeStyle =
      v < 0.42
        ? 'rgba(164, 132, 68, 0.58)'
        : v < 0.72
          ? 'rgba(84, 114, 48, 0.48)'
          : 'rgba(202, 168, 92, 0.5)';
    ctxMap.lineWidth = 2;
    ctxMap.beginPath();
    ctxMap.moveTo(x, y);
    ctxMap.lineTo(x + (v - 0.5) * 6, y + len);
    ctxMap.stroke();

    const b = Math.floor(70 + v * 150);
    ctxBump.strokeStyle = `rgba(${b},${b},${b},0.55)`;
    ctxBump.beginPath();
    ctxBump.moveTo(x, y);
    ctxBump.lineTo(x + (v - 0.5) * 6, y + len);
    ctxBump.stroke();
  }

  return {
    map: finalizeTexture(cMap, 3, true),
    bumpMap: finalizeTexture(cBump, 3, false),
    roughnessMap: finalizeTexture(cRough, 3, false),
  };
}

function createStone(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  ctxMap.fillStyle = '#4e564a';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#363636';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = '#d4d4d4';
  ctxRough.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 6;
  const rh = size / rows;
  const cw = size / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const shade = 104 + Math.floor(hash2(r, c + 5, 99) * 58);
      const warm = Math.floor(hash2(r, c + 5, 102) * 14);
      const moss = hash2(r, c + 5, 101) > 0.65 ? 22 : 0;
      const x = c * cw + offset + 3;
      const y = r * rh + 3;
      const w = cw - 6;
      const h = rh - 6;
      const rad = Math.min(w, h) * 0.24;

      ctxMap.fillStyle = `rgb(${shade + warm - moss * 0.4}, ${shade + moss + warm * 0.5}, ${shade - 4})`;
      ctxMap.beginPath();
      ctxMap.roundRect(x, y, w, h, rad);
      ctxMap.fill();

      const b = 158 + (shade % 75);
      ctxBump.fillStyle = `rgb(${b},${b},${b})`;
      ctxBump.beginPath();
      ctxBump.roundRect(x, y, w, h, rad);
      ctxBump.fill();
    }
  }

  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

function createFurBump(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < size * 18; i++) {
    const x = hash2(i, 1, 211) * size;
    const y = hash2(i, 2, 211) * size;
    const len = 4 + hash2(i, 3, 211) * 11;
    const lum = Math.floor(72 + hash2(i, 4, 211) * 135);
    const tilt = (hash2(i, 5, 211) - 0.5) * 3.2;
    ctx.strokeStyle = `rgba(${lum},${lum},${lum},0.48)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + tilt, y + len);
    ctx.stroke();
  }
  return finalizeTexture(canvas, 3, false);
}

function createFabricBump(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const step = Math.max(4, Math.floor(size / 48));
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const weave = ((x / step + y / step) % 2 === 0 ? 158 : 106) + Math.floor((hash2(x, y, 307) - 0.5) * 20);
      ctx.fillStyle = `rgb(${weave},${weave},${weave})`;
      ctx.fillRect(x, y, step - 1, step - 1);
    }
  }
  return finalizeTexture(canvas, 4, false);
}

function createToadstoolCap(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#a8221e');
  grad.addColorStop(0.5, '#d6372b');
  grad.addColorStop(1, '#ef5838');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const spots = 42;
  for (let i = 0; i < spots; i++) {
    const x = hash2(i, 1, 521) * size;
    const y = (0.14 + hash2(i, 2, 521) * 0.72) * size;
    const rx = size * (0.025 + hash2(i, 3, 521) * 0.036);
    const ry = rx * (0.72 + hash2(i, 4, 521) * 0.4);
    ctx.fillStyle = 'rgba(255, 248, 232, 0.94)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(canvas, 1, true);
}

function createSoftParticle(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.32, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createWaterNormal(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const dx =
        Math.cos(u * 4 + v * 2) * 0.35 +
        Math.cos(u * 9 - v * 5) * 0.2 +
        Math.sin(u * 14 + v * 11) * 0.12;
      const dy =
        Math.sin(u * 3 + v * 5) * 0.35 +
        Math.sin(u * 7 - v * 10) * 0.2 +
        Math.cos(u * 12 - v * 13) * 0.12;

      const idx = (y * size + x) * 4;
      data[idx] = Math.floor((dx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((dy * 0.5 + 0.5) * 255);
      data[idx + 2] = 240;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finalizeTexture(canvas, 14, false);
}

export function createTextureLibrary(resolution = 512): TextureLibrary {
  const forestFloor = createForestFloor(resolution);
  const oakBark = createBark(resolution, 'oak');
  const pineBark = createBark(resolution, 'pine');
  const birchBark = createBark(resolution, 'birch');
  const timber = createTimber(resolution);
  const thatch = createThatch(resolution);
  const stone = createStone(resolution);
  const waterNormal = createWaterNormal(Math.min(256, resolution));
  const furBump = createFurBump(Math.min(256, resolution));
  const fabricBump = createFabricBump(Math.min(256, resolution));
  const toadstoolCap = createToadstoolCap(Math.min(256, resolution));
  const softParticle = createSoftParticle(64);
  const foliageRes = Math.max(256, resolution);
  const oakLeafCluster = createOakLeafCluster(foliageRes);
  const birchLeafCluster = createBirchLeafCluster(foliageRes);
  const pineNeedleSpray = createPineNeedleSpray(foliageRes);

  const disposeSet = (set: PbrTextureSet) => {
    set.map.dispose();
    set.bumpMap.dispose();
    set.roughnessMap.dispose();
  };

  return {
    forestFloor,
    oakBark,
    pineBark,
    birchBark,
    timber,
    thatch,
    stone,
    waterNormal,
    furBump,
    fabricBump,
    toadstoolCap,
    softParticle,
    oakLeafCluster,
    birchLeafCluster,
    pineNeedleSpray,
    dispose() {
      disposeSet(forestFloor);
      disposeSet(oakBark);
      disposeSet(pineBark);
      disposeSet(birchBark);
      disposeSet(timber);
      disposeSet(thatch);
      disposeSet(stone);
      waterNormal.dispose();
      furBump.dispose();
      fabricBump.dispose();
      toadstoolCap.dispose();
      softParticle.dispose();
      oakLeafCluster.dispose();
      birchLeafCluster.dispose();
      pineNeedleSpray.dispose();
    },
  };
}
