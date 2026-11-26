import * as THREE from 'three';

export interface PbrTextureSet {
  readonly map: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap?: THREE.CanvasTexture;
  readonly roughnessMap: THREE.CanvasTexture;
}

export interface TextureLibrary {
  readonly forestFloor: PbrTextureSet;
  readonly rock?: PbrTextureSet;
  readonly plaster?: PbrTextureSet;
  readonly slateRoof?: PbrTextureSet;
  readonly oakBark: PbrTextureSet;
  readonly pineBark: PbrTextureSet;
  readonly birchBark: PbrTextureSet;
  readonly timber: PbrTextureSet;
  readonly thatch: PbrTextureSet;
  readonly stone: PbrTextureSet;
  readonly waterNormal: THREE.CanvasTexture;
  readonly furBump: THREE.CanvasTexture;
  readonly furMap?: THREE.CanvasTexture;
  readonly furNormal?: THREE.CanvasTexture;
  readonly fabricBump: THREE.CanvasTexture;
  readonly fabricNormal?: THREE.CanvasTexture;
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

/**
 * Tileable periodic 2D value noise in [0, 1] with smooth Hermite interpolation.
 * Period must be a positive integer so textures wrap seamlessly without edge seams.
 */
function tileNoise(u: number, v: number, periodX: number, periodY: number, seed: number): number {
  const px = u * periodX;
  const py = v * periodY;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % periodX) + periodX) % periodX;
  const ix1 = (ix0 + 1) % periodX;
  const iy0 = ((y0 % periodY) + periodY) % periodY;
  const iy1 = (iy0 + 1) % periodY;

  const a = hash2(ix0, iy0, seed);
  const b = hash2(ix1, iy0, seed);
  const c = hash2(ix0, iy1, seed);
  const d = hash2(ix1, iy1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tileFbm(
  u: number,
  v: number,
  basePeriodX: number,
  basePeriodY: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = basePeriodX;
  let py = basePeriodY;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise(u, v, px, py, seed + o * 37) * amp;
    norm += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / norm;
}

/**
 * Converts a tileable grayscale bump/height canvas into a true tangent-space RGB normal map
 * using a 3x3 Sobel gradient filter for crisp directional micro-surface PBR lighting.
 */
function createNormalCanvasFromBump(bumpCanvas: HTMLCanvasElement, strength = 2.6): HTMLCanvasElement {
  const size = bumpCanvas.width;
  const srcCtx = bumpCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, size, size).data;

  const [outCanvas, outCtx] = createCanvas(size);
  const outImg = outCtx.createImageData(size, size);
  const out = outImg.data;

  const sampleH = (x: number, y: number): number => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return srcData[(wy * size + wx) * 4] / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sampleH(x - 1, y - 1);
      const t = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const l = sampleH(x - 1, y);
      const r = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const b = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;
      out[idx] = Math.max(0, Math.min(255, Math.round((nx * invLen * 0.5 + 0.5) * 255)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round((ny * invLen * 0.5 + 0.5) * 255)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round((nz * invLen * 0.5 + 0.5) * 255)));
      out[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

/**
 * Tileable photographic-grain organic ground micro-surface (soil clods, moss fibers,
 * fine mineral grit, and tiny scattered leaf-litter & twigs). Hue-neutral so biome vertex
 * colors and the terrain splatting shader can modulate it cleanly.
 */
function createForestFloor(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const warpX = (tileFbm(u, v, 4, 4, 2, 13) - 0.5) * 0.08;
      const warpY = (tileFbm(u, v, 4, 4, 2, 29) - 0.5) * 0.08;
      const macro = tileFbm(u + warpX, v + warpY, 6, 6, 4, 41);
      const fine = tileFbm(u, v, 24, 24, 3, 71);
      const grit = hash2(x, y, 103);

      // Rich organic micro-relief (humus pockets, grassy root tufts, mineral speckles)
      const h = Math.max(0, Math.min(1, macro * 0.58 + fine * 0.32 + grit * 0.1));
      // Subtle cavity darkening in micro-recesses while preserving neutral albedo average (~210)
      const cavity = 0.78 + h * 0.34;
      const warmShift = (macro - 0.5) * 14;
      const r = Math.max(0, Math.min(255, Math.round((204 + warmShift) * cavity)));
      const g = Math.max(0, Math.min(255, Math.round((205 + warmShift * 0.4) * cavity)));
      const b = Math.max(0, Math.min(255, Math.round((196 - warmShift * 0.5) * cavity)));

      const bumpVal = Math.max(0, Math.min(255, Math.round(h * 255)));
      // Damp crevices slightly less rough, raised soil/litter matte
      const roughVal = Math.max(150, Math.min(248, Math.round(182 + (1 - macro) * 32 + fine * 34)));

      const idx = (y * size + x) * 4;
      dMap[idx] = r;
      dMap[idx + 1] = g;
      dMap[idx + 2] = b;
      dMap[idx + 3] = 255;

      dBump[idx] = bumpVal;
      dBump[idx + 1] = bumpVal;
      dBump[idx + 2] = bumpVal;
      dBump[idx + 3] = 255;

      dRough[idx] = roughVal;
      dRough[idx + 1] = roughVal;
      dRough[idx + 2] = roughVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  // Subtle scattered organic fibers, twigs, and tiny pebbles wrapped across edges
  ctxMap.lineCap = 'round';
  ctxBump.lineCap = 'round';
  for (let i = 0; i < size * 2.2; i++) {
    const x = hash2(i, 1, 131) * size;
    const y = hash2(i, 2, 131) * size;
    const len = 3 + hash2(i, 3, 131) * (size * 0.028);
    const ang = hash2(i, 4, 131) * Math.PI * 2;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const tone = hash2(i, 5, 131);

    ctxMap.strokeStyle =
      tone < 0.45 ? 'rgba(138, 128, 114, 0.28)' : 'rgba(226, 222, 208, 0.24)';
    ctxMap.lineWidth = 1.1 + hash2(i, 6, 131) * 1.1;
    ctxBump.strokeStyle = tone < 0.45 ? 'rgba(195,195,195,0.35)' : 'rgba(225,225,225,0.35)';
    ctxBump.lineWidth = ctxMap.lineWidth;

    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const px = x + ox;
        const py = y + oy;
        if (px + len < 0 || px - len > size || py + len < 0 || py - len > size) continue;
        ctxMap.beginPath();
        ctxMap.moveTo(px, py);
        ctxMap.lineTo(px + dx, py + dy);
        ctxMap.stroke();
        ctxBump.beginPath();
        ctxBump.moveTo(px, py);
        ctxBump.lineTo(px + dx, py + dy);
        ctxBump.stroke();
      }
    }
  }

  const cNormal = createNormalCanvasFromBump(cBump, 2.2);
  return {
    map: finalizeTexture(cMap, 26, true),
    bumpMap: finalizeTexture(cBump, 26, false),
    normalMap: finalizeTexture(cNormal, 26, false),
    roughnessMap: finalizeTexture(cRough, 26, false),
  };
}

/**
 * Stratified, fissured natural rock/granite surface for cliffs, alpine crags, and boulders.
 */
function createRock(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const warpX = (tileFbm(u, v, 4, 4, 3, 211) - 0.5) * 0.12;
      const warpY = (tileFbm(u, v, 4, 4, 3, 223) - 0.5) * 0.1;

      // Sedimentary / gneiss strata bands + sharp fractured crevices
      const strata = tileFbm(u + warpX * 0.6, v * 2.0 + warpY, 4, 8, 4, 227);
      const ridgeRaw = tileFbm(u + warpX, v + warpY, 6, 6, 4, 229);
      const crack = Math.pow(1 - Math.abs(ridgeRaw * 2 - 1), 3.6);
      const grain = tileFbm(u, v, 24, 24, 3, 233);
      const mica = hash2(x, y, 239) > 0.94 ? 1 : 0;

      const h = Math.max(0, Math.min(1, strata * 0.54 + grain * 0.28 + (1 - crack) * 0.24 - 0.08));
      const shade = 0.62 + h * 0.52 - crack * 0.34;
      const baseR = (138 + (strata - 0.5) * 26 + mica * 28) * shade;
      const baseG = (139 + (strata - 0.5) * 20 + mica * 28) * shade;
      const baseB = (136 + (strata - 0.5) * 14 + mica * 30) * shade;

      const idx = (y * size + x) * 4;
      dMap[idx] = Math.max(0, Math.min(255, Math.round(baseR)));
      dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
      dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
      dMap[idx + 3] = 255;

      const bVal = Math.max(0, Math.min(255, Math.round(h * 255)));
      dBump[idx] = bVal;
      dBump[idx + 1] = bVal;
      dBump[idx + 2] = bVal;
      dBump[idx + 3] = 255;

      const rVal = Math.max(135, Math.min(248, Math.round(218 - mica * 68 + crack * 26 - grain * 18)));
      dRough[idx] = rVal;
      dRough[idx + 1] = rVal;
      dRough[idx + 2] = rVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, 3.2);
  return {
    map: finalizeTexture(cMap, 4, true),
    bumpMap: finalizeTexture(cBump, 4, false),
    normalMap: finalizeTexture(cNormal, 4, false),
    roughnessMap: finalizeTexture(cRough, 4, false),
  };
}

/**
 * Hand-troweled aged limewash & clay plaster with subtle hairline cracks and mineral patina.
 */
function createPlaster(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const trowel = tileFbm(u, v, 5, 5, 4, 311);
      const grit = tileFbm(u, v, 28, 28, 2, 313);
      const stain = tileFbm(u, v, 3, 3, 3, 317);
      const crackNoise = tileFbm(u + trowel * 0.04, v, 8, 8, 3, 331);
      const crack = Math.pow(1 - Math.abs(crackNoise * 2 - 1), 16.0);

      const h = Math.max(0, Math.min(1, 0.56 + (trowel - 0.5) * 0.36 + (grit - 0.5) * 0.16 - crack * 0.38));
      const patina = 0.88 + stain * 0.16 - crack * 0.22;
      const warm = (trowel - 0.5) * 10;

      const idx = (y * size + x) * 4;
      dMap[idx] = Math.max(0, Math.min(255, Math.round((226 + warm) * patina)));
      dMap[idx + 1] = Math.max(0, Math.min(255, Math.round((219 + warm * 0.7) * patina)));
      dMap[idx + 2] = Math.max(0, Math.min(255, Math.round((204 + warm * 0.3) * patina)));
      dMap[idx + 3] = 255;

      const bVal = Math.max(0, Math.min(255, Math.round(h * 255)));
      dBump[idx] = bVal;
      dBump[idx + 1] = bVal;
      dBump[idx + 2] = bVal;
      dBump[idx + 3] = 255;

      const rVal = Math.max(185, Math.min(248, Math.round(218 + grit * 24 - stain * 14)));
      dRough[idx] = rVal;
      dRough[idx + 1] = rVal;
      dRough[idx + 2] = rVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, 1.8);
  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    normalMap: finalizeTexture(cNormal, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * Overlapping hand-split weathered roof slate/shingles with subtle mineral cleavage and moss in joints.
 */
function createSlateRoof(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  const rows = 10;
  const cols = 8;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rowF = v * rows;
    const row = Math.floor(rowF);
    const localY = rowF - row;

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const stagger = (row % 2) * 0.5;
      const colF = u * cols + stagger;
      const col = Math.floor(colF);
      const localX = colF - col;

      const cWrapped = ((col % cols) + cols) % cols;
      const tileSeed = hash2(cWrapped, row, 401);
      const chip = (tileFbm(u, v, 16, 16, 2, 409) - 0.5) * 0.09;
      const grain = tileFbm(u, v, 24, 12, 3, 419);

      // Overlap shadow along bottom lip of each shingle course + vertical gap between tiles
      const botLip = Math.min(1, Math.max(0, (1 - localY + chip) * 9.0));
      const sideGap = Math.min(1, Math.min(localX, 1 - localX) * 18.0);
      const seam = Math.min(botLip, sideGap);

      // Sloping height: lower edge overlaps the course beneath it
      const tileHeight = (0.35 + localY * 0.52 + (grain - 0.5) * 0.14) * (0.25 + 0.75 * seam);
      const shade = 0.72 + tileSeed * 0.34 + (grain - 0.5) * 0.16;
      const seamAO = 0.42 + 0.58 * seam;
      const moss = seam < 0.75 && hash2(cWrapped, row, 421) > 0.58 ? (1 - seam) * 0.45 : 0;

      const r = (158 * shade * seamAO) * (1 - moss) + 74 * moss;
      const g = (164 * shade * seamAO) * (1 - moss) + 96 * moss;
      const b = (172 * shade * seamAO) * (1 - moss) + 62 * moss;

      const idx = (y * size + x) * 4;
      dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
      dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      dMap[idx + 3] = 255;

      const bVal = Math.max(0, Math.min(255, Math.round(tileHeight * 255)));
      dBump[idx] = bVal;
      dBump[idx + 1] = bVal;
      dBump[idx + 2] = bVal;
      dBump[idx + 3] = 255;

      const rVal = Math.max(135, Math.min(248, Math.round(175 + (1 - tileSeed) * 35 + moss * 55)));
      dRough[idx] = rVal;
      dRough[idx + 1] = rVal;
      dRough[idx + 2] = rVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, 2.8);
  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    normalMap: finalizeTexture(cNormal, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * Domain-warped organic tree bark heightfield & PBR set (deeply fissured oak, flaky pine,
 * papery silver birch with horizontal dark lenticels and mossy crevices).
 */
function createBark(size: number, kind: 'oak' | 'pine' | 'birch'): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      if (kind === 'birch') {
        const paper = tileFbm(u, v, 4, 16, 4, 503);
        const peel = tileFbm(u, v, 8, 24, 3, 509);
        const lenticelMask = tileFbm(u, v, 6, 36, 3, 521);
        const isLenticel = Math.max(0, Math.min(1, (lenticelMask - 0.68) * 7.5));
        const darkPatch = Math.max(0, Math.min(1, (tileFbm(u, v, 4, 6, 3, 523) - 0.72) * 5.2));
        const moss = Math.max(0, Math.min(1, (tileFbm(u, v, 5, 5, 3, 541) - 0.74) * 4.5));

        let r = 216 + (paper - 0.5) * 32;
        let g = 208 + (paper - 0.5) * 28;
        let b = 194 + (paper - 0.5) * 26;

        // Horizontal papery dark lenticels & gnarled dark bark knots
        const dark = Math.max(isLenticel * 0.85, darkPatch * 0.92);
        r = r * (1 - dark) + 42 * dark;
        g = g * (1 - dark) + 36 * dark;
        b = b * (1 - dark) + 32 * dark;

        // Subtle pale olive-grey lichen/moss
        r = r * (1 - moss * 0.45) + 92 * moss * 0.45;
        g = g * (1 - moss * 0.45) + 108 * moss * 0.45;
        b = b * (1 - moss * 0.45) + 74 * moss * 0.45;

        const h = Math.max(0, Math.min(1, 0.58 + (peel - 0.5) * 0.3 - dark * 0.36));
        dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
        dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        dMap[idx + 3] = 255;

        const bVal = Math.round(h * 255);
        dBump[idx] = bVal;
        dBump[idx + 1] = bVal;
        dBump[idx + 2] = bVal;
        dBump[idx + 3] = 255;

        const rVal = Math.round(186 + dark * 52 + (1 - paper) * 18);
        dRough[idx] = rVal;
        dRough[idx + 1] = rVal;
        dRough[idx + 2] = rVal;
        dRough[idx + 3] = 255;
      } else if (kind === 'pine') {
        // Organic irregular flaky reddish-brown conifer bark plates separated by deep dark fissures
        const warpU = (tileFbm(u, v, 5, 5, 3, 557) - 0.5) * 0.09;
        const warpV = (tileFbm(u, v, 5, 5, 3, 563) - 0.5) * 0.06;
        const plates = tileFbm(u + warpU, v + warpV, 12, 7, 4, 569);
        const ridge = Math.abs(tileFbm(u + warpU, v + warpV, 10, 6, 3, 571) * 2 - 1);
        const fissure = Math.pow(1 - Math.min(1, ridge * 1.45), 2.4);
        const grain = tileFbm(u, v, 32, 16, 2, 577);

        const h = Math.max(0, Math.min(1, 0.25 + plates * 0.62 + grain * 0.18 - fissure * 0.58));
        const plateWarm = tileFbm(u, v, 6, 4, 2, 587);
        const shade = 0.34 + h * 0.82;
        const r = (94 + plateWarm * 38) * shade;
        const g = (64 + plateWarm * 22) * shade;
        const b = (44 + plateWarm * 14) * shade;

        dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
        dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        dMap[idx + 3] = 255;

        const bVal = Math.round(h * 255);
        dBump[idx] = bVal;
        dBump[idx + 1] = bVal;
        dBump[idx + 2] = bVal;
        dBump[idx + 3] = 255;

        const rVal = Math.min(250, Math.round(208 + fissure * 38 + (1 - grain) * 14));
        dRough[idx] = rVal;
        dRough[idx + 1] = rVal;
        dRough[idx + 2] = rVal;
        dRough[idx + 3] = 255;
      } else {
        // Deep braided vertical oak bark furrows, silvery lichen flecks, and mossy fissures
        const warpU = (tileFbm(u, v, 4, 4, 3, 601) - 0.5) * 0.11;
        const furrowNoise = tileFbm(u + warpU, v, 16, 4, 4, 607);
        const ridge = Math.abs(furrowNoise * 2 - 1);
        const furrow = Math.pow(1 - Math.min(1, ridge * 1.3), 2.1);
        const detail = tileFbm(u, v, 36, 12, 3, 613);
        const lichen = Math.max(0, Math.min(1, (tileFbm(u, v, 6, 6, 3, 617) - 0.69) * 5.0));
        const moss = Math.max(0, Math.min(1, (tileFbm(u, v, 5, 5, 3, 619) - 0.7) * 4.5)) * (0.35 + furrow * 0.65);

        const h = Math.max(0, Math.min(1, 0.42 + detail * 0.32 + (1 - furrow) * 0.42 - 0.16));
        const shade = 0.36 + h * 0.78;
        let r = 84 * shade;
        let g = 68 * shade;
        let b = 52 * shade;

        // Silvery woodland lichen on raised ridges
        r = r * (1 - lichen * 0.38) + 148 * lichen * 0.38;
        g = g * (1 - lichen * 0.38) + 148 * lichen * 0.38;
        b = b * (1 - lichen * 0.38) + 134 * lichen * 0.38;

        // Deep muted woodland moss nestled in damp bark furrows
        r = r * (1 - moss * 0.58) + 56 * moss * 0.58;
        g = g * (1 - moss * 0.58) + 78 * moss * 0.58;
        b = b * (1 - moss * 0.58) + 42 * moss * 0.58;

        dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
        dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        dMap[idx + 3] = 255;

        const bVal = Math.round(h * 255);
        dBump[idx] = bVal;
        dBump[idx + 1] = bVal;
        dBump[idx + 2] = bVal;
        dBump[idx + 3] = 255;

        const rVal = Math.min(252, Math.round(212 + furrow * 34 + moss * 14));
        dRough[idx] = rVal;
        dRough[idx + 1] = rVal;
        dRough[idx + 2] = rVal;
        dRough[idx + 3] = 255;
      }
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, kind === 'birch' ? 1.8 : 3.2);
  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    normalMap: finalizeTexture(cNormal, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * High-resolution alpha-cutout botanical oak leaf spray on fine dark woody twigs.
 * Zero cartoon outline strokes — relies on natural chlorophyll tonal variation,
 * subtle backlit veins, and layered overlapping leaf depth.
 */
function createOakLeafCluster(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.5;

  // Fine branching woody twigs radiating organically from center
  ctx.strokeStyle = '#3f2e1f';
  ctx.lineCap = 'round';
  const branchAngles = [-2.55, -1.75, -0.92, -0.18, 0.56, 1.38, 2.22];
  for (let i = 0; i < branchAngles.length; i++) {
    const a = branchAngles[i];
    const len = size * (0.28 + hash2(i, 1, 81) * 0.14);
    ctx.lineWidth = size * 0.01;
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

  const drawOakLeaf = (
    x: number,
    y: number,
    angle: number,
    len: number,
    width: number,
    shade: number,
    hueShift: number,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Subtle botanical chlorophyll variation (muted olive-sage to warm sunlit foliage, no outline)
    const r = Math.min(255, Math.round(152 + shade * 68 + hueShift * 24));
    const g = Math.min(255, Math.round(176 + shade * 62 + hueShift * 8));
    const b = Math.min(255, Math.round(134 + shade * 46 - hueShift * 14));

    const grad = ctx.createLinearGradient(0, -width * 0.6, len, width * 0.6);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.68)}, ${Math.round(g * 0.72)}, ${Math.round(b * 0.66)})`);
    grad.addColorStop(0.5, `rgb(${r}, ${g}, ${b})`);
    grad.addColorStop(
      1,
      `rgb(${Math.min(255, Math.round(r * 1.12))}, ${Math.min(255, Math.round(g * 1.09))}, ${Math.min(255, Math.round(b * 1.02))})`,
    );

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.15, -width * 0.34, len * 0.28, -width * 0.86, len * 0.38, -width * 0.64);
    ctx.bezierCurveTo(len * 0.45, -width * 0.42, len * 0.54, -width * 1.06, len * 0.68, -width * 0.8);
    ctx.bezierCurveTo(len * 0.78, -width * 0.5, len * 0.88, -width * 0.6, len, 0);
    ctx.bezierCurveTo(len * 0.88, width * 0.6, len * 0.78, width * 0.5, len * 0.68, width * 0.8);
    ctx.bezierCurveTo(len * 0.54, width * 1.06, len * 0.45, width * 0.42, len * 0.38, width * 0.64);
    ctx.bezierCurveTo(len * 0.28, width * 0.86, len * 0.15, width * 0.34, 0, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle botanical midrib & lateral veins (translucent pale sap-green, no cartoon border)
    ctx.strokeStyle = 'rgba(225, 232, 194, 0.28)';
    ctx.lineWidth = Math.max(0.8, size * 0.0024);
    ctx.beginPath();
    ctx.moveTo(len * 0.04, 0);
    ctx.lineTo(len * 0.88, 0);
    for (const t of [0.28, 0.52, 0.74]) {
      ctx.moveTo(len * t, 0);
      ctx.lineTo(len * (t + 0.12), -width * 0.45);
      ctx.moveTo(len * t, 0);
      ctx.lineTo(len * (t + 0.12), width * 0.45);
    }
    ctx.stroke();

    ctx.restore();
  };

  // Layer 52 naturalistic oak leaves with varied depth, subtle hue shifts & airy sky gaps
  const leafCount = 52;
  for (let i = 0; i < leafCount; i++) {
    const ring = i < 18 ? 0.16 : i < 36 ? 0.28 : 0.38;
    const angle = (i / leafCount) * Math.PI * 2 * 3.1 + hash2(i, 2, 82) * 0.48;
    const dist = size * (ring * (0.58 + hash2(i, 3, 82) * 0.62));
    const lx = cx + Math.cos(angle) * dist * 0.72;
    const ly = cy + Math.sin(angle) * dist * 0.72;
    const leafAngle = angle + (hash2(i, 4, 82) - 0.5) * 0.9;
    const len = size * (0.12 + hash2(i, 5, 82) * 0.085);
    const width = len * (0.33 + hash2(i, 6, 82) * 0.1);
    const shade = (i / leafCount) * 0.72 + hash2(i, 7, 82) * 0.32;
    const hueShift = (hash2(i, 8, 82) - 0.45) * 1.1;
    drawOakLeaf(lx, ly, leafAngle, len, width, shade, hueShift);
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

  ctx.strokeStyle = '#4e3f32';
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const len = size * (0.32 + hash2(i, 1, 91) * 0.12);
    ctx.lineWidth = size * 0.006;
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

  const leafCount = 72;
  for (let i = 0; i < leafCount; i++) {
    const a = hash2(i, 1, 92) * Math.PI * 2;
    const dist = Math.sqrt(hash2(i, 2, 92)) * size * 0.4;
    const x = cx + Math.cos(a) * dist;
    const y = cy + Math.sin(a) * dist;
    const rot = a + (hash2(i, 3, 92) - 0.5) * 1.15;
    const len = size * (0.075 + hash2(i, 4, 92) * 0.05);
    const w = len * 0.42;
    const shade = 0.22 + (i / leafCount) * 0.72;
    const warm = (hash2(i, 5, 92) - 0.5) * 20;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    const r = Math.min(255, Math.round(166 + shade * 58 + warm));
    const g = Math.min(255, Math.round(188 + shade * 52 + warm * 0.4));
    const b = Math.min(255, Math.round(132 + shade * 42 - warm * 0.5));
    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgb(${Math.round(r * 0.78)},${Math.round(g * 0.8)},${Math.round(b * 0.74)})`);
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.34, -w, len, 0);
    ctx.quadraticCurveTo(len * 0.34, w, 0, 0);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(235, 242, 204, 0.26)';
    ctx.lineWidth = Math.max(0.8, size * 0.002);
    ctx.beginPath();
    ctx.moveTo(len * 0.08, 0);
    ctx.lineTo(len * 0.86, 0);
    ctx.stroke();

    ctx.restore();
  }

  return finalizeTexture(canvas, 1, true, THREE.ClampToEdgeWrapping);
}

/**
 * High-resolution alpha-cutout realistic conifer pine-needle bough spray.
 */
function createPineNeedleSpray(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const baseY = size * 0.94;
  const tipY = size * 0.08;

  const shoots: { x0: number; y0: number; x1: number; y1: number; needles: number }[] = [
    { x0: cx, y0: baseY, x1: cx, y1: tipY, needles: 108 },
    { x0: cx, y0: size * 0.78, x1: size * 0.14, y1: size * 0.46, needles: 62 },
    { x0: cx, y0: size * 0.78, x1: size * 0.86, y1: size * 0.46, needles: 62 },
    { x0: cx, y0: size * 0.58, x1: size * 0.18, y1: size * 0.28, needles: 52 },
    { x0: cx, y0: size * 0.58, x1: size * 0.82, y1: size * 0.28, needles: 52 },
    { x0: cx, y0: size * 0.38, x1: size * 0.28, y1: size * 0.15, needles: 40 },
    { x0: cx, y0: size * 0.38, x1: size * 0.72, y1: size * 0.15, needles: 40 },
  ];

  ctx.strokeStyle = '#4c321e';
  ctx.lineCap = 'round';
  for (let s = 0; s < shoots.length; s++) {
    const sh = shoots[s];
    ctx.lineWidth = s === 0 ? size * 0.022 : size * 0.013;
    ctx.beginPath();
    ctx.moveTo(sh.x0, sh.y0);
    ctx.lineTo(sh.x1, sh.y1);
    ctx.stroke();
  }

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
      const spread = side * (0.38 + hash2(s * 100 + i, 1, 77) * 0.72);
      const needleAngle = baseAngle + spread;
      const needleLen = size * (0.09 + hash2(s * 100 + i, 2, 77) * 0.065) * (1.12 - t * 0.42);
      const bright = 0.56 + t * 0.38 + hash2(s * 100 + i, 3, 77) * 0.24;

      const r = Math.min(255, Math.round(134 * bright));
      const g = Math.min(255, Math.round(176 * bright));
      const b = Math.min(255, Math.round(138 * bright));

      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = Math.max(1.2, size * 0.0072);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(needleAngle) * needleLen, sy + Math.sin(needleAngle) * needleLen);
      ctx.stroke();
    }
  }

  return finalizeTexture(canvas, 1, true, THREE.ClampToEdgeWrapping);
}

/**
 * Hand-hewn weathered timber planks with curved wood grain, knots, bevel seams, and normal map.
 */
function createTimber(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  const planks = 8;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const pF = v * planks;
    const pIdx = Math.floor(pF);
    const localY = pF - pIdx;
    const plankTone = 0.8 + hash2(pIdx, 1, 41) * 0.34;
    const plankShift = hash2(pIdx, 2, 41) * 0.7;

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const seamDist = Math.min(localY, 1 - localY);
      const seam = Math.min(1, seamDist * 20);

      // Organic warped wood grain rings + fine cellulose fiber streaks
      const ringWarp = tileFbm(u + plankShift, v, 3, 12, 3, 47 + pIdx * 7);
      const ring = 0.5 + 0.5 * Math.sin((localY * 14 + ringWarp * 5.5) * Math.PI);
      const fiber = tileFbm(u, v, 8, 64, 2, 53);
      const weather = tileFbm(u, v, 6, 6, 3, 59);

      const grain = ring * 0.45 + fiber * 0.55;
      const h = Math.max(0, Math.min(1, (0.45 + grain * 0.42) * (0.15 + 0.85 * seam)));
      const shade = plankTone * (0.68 + grain * 0.38) * (0.28 + 0.72 * seam);

      // Slight silvered-weathering variation along exposed fibers
      const silver = Math.max(0, (weather - 0.62) * 0.55);
      const r = (128 * shade) * (1 - silver) + 124 * silver * seam;
      const g = (94 * shade) * (1 - silver) + 112 * silver * seam;
      const b = (64 * shade) * (1 - silver) + 96 * silver * seam;

      const idx = (y * size + x) * 4;
      dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
      dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      dMap[idx + 3] = 255;

      const bVal = Math.round(h * 255);
      dBump[idx] = bVal;
      dBump[idx + 1] = bVal;
      dBump[idx + 2] = bVal;
      dBump[idx + 3] = 255;

      const rVal = Math.min(250, Math.round(188 + (1 - grain) * 44 + (1 - seam) * 28));
      dRough[idx] = rVal;
      dRough[idx + 1] = rVal;
      dRough[idx + 2] = rVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, 2.4);
  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    normalMap: finalizeTexture(cNormal, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * Weathered layered reed/straw thatch with deep overlapping shadow courses, moss flecks & normal map.
 */
function createThatch(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  ctxMap.fillStyle = '#5d5234';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#5c5c5c';
  ctxBump.fillRect(0, 0, size, size);
  ctxRough.fillStyle = '#e6e6e6';
  ctxRough.fillRect(0, 0, size, size);

  const rows = 9;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH;
    const grad = ctxMap.createLinearGradient(0, y0, 0, y0 + rowH);
    grad.addColorStop(0, 'rgba(34, 28, 16, 0.34)');
    grad.addColorStop(0.35, 'rgba(116, 100, 62, 0.14)');
    grad.addColorStop(0.88, 'rgba(138, 118, 72, 0.2)');
    grad.addColorStop(1, 'rgba(24, 20, 12, 0.48)');
    ctxMap.fillStyle = grad;
    ctxMap.fillRect(0, y0, size, rowH);

    ctxBump.fillStyle = 'rgba(24,24,24,0.58)';
    ctxBump.fillRect(0, y0 + rowH - 3, size, 3);
  }

  for (let i = 0; i < size * 14; i++) {
    const x = hash2(i, 1, 73) * size;
    const y = hash2(i, 2, 73) * size;
    const len = 8 + hash2(i, 3, 73) * (size * 0.065);
    const v = hash2(i, 4, 73);
    const lean = (hash2(i, 5, 73) - 0.5) * 5.2;

    ctxMap.strokeStyle =
      v < 0.36
        ? 'rgba(136, 114, 68, 0.56)'
        : v < 0.62
          ? 'rgba(92, 82, 52, 0.52)'
          : v < 0.78
            ? 'rgba(72, 92, 48, 0.44)'
            : 'rgba(168, 144, 92, 0.48)';
    ctxMap.lineWidth = 1.4 + hash2(i, 6, 73) * 1.2;

    const b = Math.floor(72 + v * 155);
    ctxBump.strokeStyle = `rgba(${b},${b},${b},0.6)`;
    ctxBump.lineWidth = ctxMap.lineWidth;

    for (const oy of [-size, 0, size]) {
      const py = y + oy;
      if (py + len < 0 || py > size) continue;
      ctxMap.beginPath();
      ctxMap.moveTo(x, py);
      ctxMap.lineTo(x + lean, py + len);
      ctxMap.stroke();

      ctxBump.beginPath();
      ctxBump.moveTo(x, py);
      ctxBump.lineTo(x + lean, py + len);
      ctxBump.stroke();
    }
  }

  const cNormal = createNormalCanvasFromBump(cBump, 2.8);
  return {
    map: finalizeTexture(cMap, 3, true),
    bumpMap: finalizeTexture(cBump, 3, false),
    normalMap: finalizeTexture(cNormal, 3, false),
    roughnessMap: finalizeTexture(cRough, 3, false),
  };
}

/**
 * Irregular hand-laid fieldstone masonry with recessed earthen mortar, stone micro-grain,
 * subtle damp moss in joints, and a crisp tangent-space normal map.
 */
function createStone(size: number): PbrTextureSet {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);
  const [cRough, ctxRough] = createCanvas(size);

  const imgMap = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const imgRough = ctxRough.createImageData(size, size);
  const dMap = imgMap.data;
  const dBump = imgBump.data;
  const dRough = imgRough.data;

  const rows = 7;
  const cols = 5;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Domain warp breaks geometric block edges into organic fieldstone silhouettes
      const wu = u + (tileFbm(u, v, 8, 8, 3, 701) - 0.5) * 0.048;
      const wv = v + (tileFbm(u, v, 8, 8, 3, 709) - 0.5) * 0.048;

      const rF = ((wv % 1) + 1) % 1 * rows;
      const rIdx = Math.floor(rF);
      const ly = rF - rIdx;

      const stagger = (rIdx % 2) * 0.48 + (hash2(rIdx, 3, 719) - 0.5) * 0.22;
      const cF = (((wu % 1) + 1) % 1 * cols + stagger + cols) % cols;
      const cIdx = Math.floor(cF);
      const lx = cF - cIdx;

      // Soft rounded-edge distance inside each stone
      const dx = Math.abs(lx - 0.5) * 2;
      const dy = Math.abs(ly - 0.5) * 2;
      const cornerDist = Math.pow(Math.pow(dx, 3.2) + Math.pow(dy, 3.2), 1 / 3.2);
      const stoneMask = Math.max(0, Math.min(1, (0.93 - cornerDist) * 7.5));

      const stoneSeed = hash2(cIdx, rIdx, 727);
      const warmSeed = hash2(cIdx, rIdx, 733);
      const grain = tileFbm(u, v, 20, 20, 3, 739);
      const mossMask =
        (1 - stoneMask) * Math.max(0, Math.min(1, (tileFbm(u, v, 6, 6, 3, 743) - 0.44) * 2.4));

      const stoneTone = 0.72 + stoneSeed * 0.44 + (grain - 0.5) * 0.22;
      const bevel = Math.min(1, Math.max(0, (0.94 - cornerDist) * 3.4));
      const stoneR = (118 + warmSeed * 24) * stoneTone * (0.76 + 0.24 * bevel);
      const stoneG = (117 + warmSeed * 18) * stoneTone * (0.76 + 0.24 * bevel);
      const stoneB = (112 + warmSeed * 10) * stoneTone * (0.76 + 0.24 * bevel);

      const mortarR = 72 + grain * 18;
      const mortarG = 70 + grain * 18;
      const mortarB = 62 + grain * 14;

      let r = mortarR * (1 - stoneMask) + stoneR * stoneMask;
      let g = mortarG * (1 - stoneMask) + stoneG * stoneMask;
      let b = mortarB * (1 - stoneMask) + stoneB * stoneMask;

      // Subtle damp moss nestled into recessed mortar joints
      r = r * (1 - mossMask * 0.65) + 58 * mossMask * 0.65;
      g = g * (1 - mossMask * 0.65) + 84 * mossMask * 0.65;
      b = b * (1 - mossMask * 0.65) + 46 * mossMask * 0.65;

      const h = Math.max(
        0,
        Math.min(1, 0.14 + stoneMask * (0.48 + bevel * 0.24 + (grain - 0.5) * 0.16)),
      );

      const idx = (y * size + x) * 4;
      dMap[idx] = Math.max(0, Math.min(255, Math.round(r)));
      dMap[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      dMap[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      dMap[idx + 3] = 255;

      const bVal = Math.round(h * 255);
      dBump[idx] = bVal;
      dBump[idx + 1] = bVal;
      dBump[idx + 2] = bVal;
      dBump[idx + 3] = 255;

      const rVal = Math.min(252, Math.round(196 + (1 - stoneMask) * 42 + (1 - grain) * 18));
      dRough[idx] = rVal;
      dRough[idx + 1] = rVal;
      dRough[idx + 2] = rVal;
      dRough[idx + 3] = 255;
    }
  }

  ctxMap.putImageData(imgMap, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  ctxRough.putImageData(imgRough, 0, 0);

  const cNormal = createNormalCanvasFromBump(cBump, 3.0);
  return {
    map: finalizeTexture(cMap, 2, true),
    bumpMap: finalizeTexture(cBump, 2, false),
    normalMap: finalizeTexture(cNormal, 2, false),
    roughnessMap: finalizeTexture(cRough, 2, false),
  };
}

/**
 * Tactile directional multi-strand fur texture (albedo micro-variation, bump, and normal map)
 * so woodland creatures read as plush real pelts rather than smooth untextured clay.
 */
function createFurTextures(size: number): {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
} {
  const [cMap, ctxMap] = createCanvas(size);
  const [cBump, ctxBump] = createCanvas(size);

  ctxMap.fillStyle = '#dcdad4';
  ctxMap.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#7c7c7c';
  ctxBump.fillRect(0, 0, size, size);

  ctxMap.lineCap = 'round';
  ctxBump.lineCap = 'round';
  for (let i = 0; i < size * 28; i++) {
    const x = hash2(i, 1, 211) * size;
    const y = hash2(i, 2, 211) * size;
    const len = 3.5 + hash2(i, 3, 211) * (size * 0.048);
    const lum = Math.floor(64 + hash2(i, 4, 211) * 155);
    const tilt = (hash2(i, 5, 211) - 0.5) * 3.6;
    const colorTone = Math.floor(178 + hash2(i, 6, 211) * 74);

    ctxMap.strokeStyle = `rgba(${colorTone},${Math.max(0, colorTone - 2)},${Math.max(0, colorTone - 6)},0.34)`;
    ctxMap.lineWidth = 1.1;
    ctxBump.strokeStyle = `rgba(${lum},${lum},${lum},0.48)`;
    ctxBump.lineWidth = 1.25;

    for (const oy of [-size, 0, size]) {
      const py = y + oy;
      if (py + len < 0 || py > size) continue;
      ctxMap.beginPath();
      ctxMap.moveTo(x, py);
      ctxMap.lineTo(x + tilt, py + len);
      ctxMap.stroke();

      ctxBump.beginPath();
      ctxBump.moveTo(x, py);
      ctxBump.lineTo(x + tilt, py + len);
      ctxBump.stroke();
    }
  }

  const cNormal = createNormalCanvasFromBump(cBump, 2.2);
  return {
    map: finalizeTexture(cMap, 3, true),
    bump: finalizeTexture(cBump, 3, false),
    normal: finalizeTexture(cNormal, 3, false),
  };
}

function createFabricTextures(size: number): {
  bump: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
} {
  const [canvas, ctx] = createCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const step = Math.max(3, Math.floor(size / 56));
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const weave =
        ((Math.floor(x / step) + Math.floor(y / step)) % 2 === 0 ? 162 : 102) +
        Math.floor((hash2(x, y, 307) - 0.5) * 26);
      ctx.fillStyle = `rgb(${weave},${weave},${weave})`;
      ctx.fillRect(x, y, step - 1, step - 1);
    }
  }
  const cNormal = createNormalCanvasFromBump(canvas, 1.9);
  return {
    bump: finalizeTexture(canvas, 4, false),
    normal: finalizeTexture(cNormal, 4, false),
  };
}

/**
 * Naturalistic mottled Amanita woodland mushroom cap with irregular organic veil flakes
 * (replaces cartoon polka dots).
 */
function createToadstoolCap(size: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#781e18');
  grad.addColorStop(0.55, '#9d2d1f');
  grad.addColorStop(1, '#ba542c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle radial cap striations
  for (let i = 0; i < size * 2; i++) {
    const x = hash2(i, 1, 519) * size;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(65, 16, 10, 0.14)' : 'rgba(218, 128, 72, 0.1)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (hash2(i, 2, 519) - 0.5) * 8, size);
    ctx.stroke();
  }

  // Irregular creamy-ochre veil flecks
  const spots = 36;
  for (let i = 0; i < spots; i++) {
    const x = hash2(i, 1, 521) * size;
    const y = (0.16 + hash2(i, 2, 521) * 0.68) * size;
    const rx = size * (0.016 + hash2(i, 3, 521) * 0.024);
    const ry = rx * (0.62 + hash2(i, 4, 521) * 0.55);
    ctx.fillStyle = 'rgba(232, 220, 194, 0.84)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, hash2(i, 5, 521) * Math.PI, 0, Math.PI * 2);
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
  const pbrRes = Math.min(resolution, 384);
  const forestFloor = createForestFloor(pbrRes);
  const rock = createRock(pbrRes);
  const plaster = createPlaster(Math.min(256, pbrRes));
  const slateRoof = createSlateRoof(pbrRes);
  const oakBark = createBark(pbrRes, 'oak');
  const pineBark = createBark(pbrRes, 'pine');
  const birchBark = createBark(pbrRes, 'birch');
  const timber = createTimber(pbrRes);
  const thatch = createThatch(pbrRes);
  const stone = createStone(pbrRes);
  const waterNormal = createWaterNormal(Math.min(256, resolution));
  const fur = createFurTextures(Math.min(256, resolution));
  const fabric = createFabricTextures(Math.min(256, resolution));
  const toadstoolCap = createToadstoolCap(Math.min(256, resolution));
  const softParticle = createSoftParticle(64);
  const foliageRes = Math.max(256, resolution);
  const oakLeafCluster = createOakLeafCluster(foliageRes);
  const birchLeafCluster = createBirchLeafCluster(foliageRes);
  const pineNeedleSpray = createPineNeedleSpray(foliageRes);

  const disposeSet = (set: PbrTextureSet) => {
    set.map.dispose();
    set.bumpMap.dispose();
    set.normalMap?.dispose();
    set.roughnessMap.dispose();
  };

  return {
    forestFloor,
    rock,
    plaster,
    slateRoof,
    oakBark,
    pineBark,
    birchBark,
    timber,
    thatch,
    stone,
    waterNormal,
    furBump: fur.bump,
    furMap: fur.map,
    furNormal: fur.normal,
    fabricBump: fabric.bump,
    fabricNormal: fabric.normal,
    toadstoolCap,
    softParticle,
    oakLeafCluster,
    birchLeafCluster,
    pineNeedleSpray,
    dispose() {
      disposeSet(forestFloor);
      disposeSet(rock);
      disposeSet(plaster);
      disposeSet(slateRoof);
      disposeSet(oakBark);
      disposeSet(pineBark);
      disposeSet(birchBark);
      disposeSet(timber);
      disposeSet(thatch);
      disposeSet(stone);
      waterNormal.dispose();
      fur.map.dispose();
      fur.bump.dispose();
      fur.normal.dispose();
      fabric.bump.dispose();
      fabric.normal.dispose();
      toadstoolCap.dispose();
      softParticle.dispose();
      oakLeafCluster.dispose();
      birchLeafCluster.dispose();
      pineNeedleSpray.dispose();
    },
  };
}
