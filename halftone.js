/* ============================================================
   binary-halftone engine
   No framework, no DOM assumptions beyond <canvas>.
   Import this from the React app AND from your build script so
   both produce byte-identical output.
   ============================================================ */

/* ---------- named character sets ----------
   Ordering here is irrelevant — the ramp measures and sorts. What
   matters is tonal spread: a set needs light glyphs (. , -) and
   heavy ones ($ % 8) or the gradient collapses. */
export const CHARSETS = {
  binary: ["0", "1"],
  digits: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  pnl: ["$", "%", "(", ")", "+", "-", ".", ",",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};

export function resolveCharset(mode, custom) {
  if (mode === "custom") {
    const chars = Array.from(new Set(String(custom || "").split(""))).filter(c => c.trim().length);
    return chars.length ? chars : CHARSETS.binary;
  }
  return CHARSETS[mode] || CHARSETS.binary;
}

export const DEFAULT_TOKENS = {
  charMode: "binary",
  charset: ["0", "1"],
  variety: 0.6,          // 0 = one glyph per tone, 1 = full pool within tolerance
  font: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  weight: 400,
  ink: "#e8e8e6",
  bg: "#0a0a0a",

  cellW: 8,
  cellAspect: 1.35,

  // --- character size axis ---
  charSize: 1.05,        // base glyph size as a multiple of cell width
  sizeVariation: 0.35,   // 0 = every glyph identical, 1 = strong size falloff
  sizeSteps: 3,          // how many discrete sizes the ramp may use

  steps: 8,
  alphas: [0.22, 0.36, 0.52, 0.70, 0.86, 1.0],

  bgCutoff: 0.045,
  black: 0.05,
  white: 0.95,
  gamma: 1.0,
  dither: 0.55,
  edgeLift: 0.55,

  lightDir: [-0.45, 0.78, 0.44],
  rim: 0.55
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ---------- character size axis ----------
   Spread is asymmetric on purpose: shrinking reads as "less ink"
   far more cleanly than growing reads as "more ink", because a
   glyph larger than its cell starts colliding with its neighbours. */
export function buildScaleAxis(variation, steps) {
  const n = Math.max(1, Math.round(steps));
  if (variation <= 0.001 || n === 1) return [1];
  const lo = 1 - 0.80 * variation;
  const hi = 1 + 0.35 * variation;
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * (i / (n - 1)));
  return out;
}

/* ---------- glyph ink coverage ---------- */
const covCache = new Map();
export function inkCoverage(ch, font, weight, makeCanvas) {
  const key = ch + "|" + font + "|" + weight;
  if (covCache.has(key)) return covCache.get(key);
  const N = 64;
  const c = makeCanvas(N, N);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `${weight} ${N * 0.8}px ${font}`;
  x.fillText(ch, N / 2, N / 2);
  const d = x.getImageData(0, 0, N, N).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i];
  const cov = sum / (255 * N * N) || 0.15;
  covCache.set(key, cov);
  return cov;
}

/* ---------- tone ramp ----------
   Two glyphs is not two tones. Every (glyph, alpha, size) combo is
   scored by perceived ink, sorted, and sampled at even intervals.
   Sorting matters: "1" at full opacity is dimmer than "0" at half. */
const MAX_POOL = 6;

export function buildRamp(t, makeCanvas) {
  const scales = buildScaleAxis(t.sizeVariation, t.sizeSteps);
  const chars = (t.charset && t.charset.length) ? t.charset : CHARSETS.binary;
  const combos = [];
  for (const ch of chars) {
    const cov = inkCoverage(ch, t.font, t.weight, makeCanvas);
    for (const a of t.alphas)
      for (const s of scales)
        combos.push({ char: ch, alpha: a, scale: s, v: cov * a * s * s });
  }
  combos.sort((p, q) => p.v - q.v);
  const lo = combos[0].v;
  const hi = combos[combos.length - 1].v;

  const n = Math.max(2, Math.round(t.steps)) - 1;
  const spacing = n > 1 ? (hi - lo) / (n - 1) : (hi - lo);
  // Combos within half a tone step of the target are perceptually
  // interchangeable, so we can vary the glyph for free. With a two-glyph
  // set the pool stays tiny; with 18 glyphs it fills up and the output
  // gets the mixed-character texture of real ASCII art.
  const tol = spacing * 0.5 * clamp(t.variety == null ? 0 : t.variety, 0, 1);

  const ramp = [null];                        // index 0 draws nothing
  for (let i = 0; i < n; i++) {
    const target = lo + (hi - lo) * (n > 1 ? i / (n - 1) : 1);
    const scored = combos
      .map(c => ({ c, d: Math.abs(c.v - target) }))
      .sort((a, b) => a.d - b.d);
    const seen = new Set();
    const pool = [];
    for (const s of scored) {
      if (pool.length >= MAX_POOL) break;
      if (pool.length > 0 && s.d > tol) break;
      if (seen.has(s.c.char)) continue;       // prefer distinct characters
      seen.add(s.c.char);
      pool.push(s.c);
    }
    if (!pool.length) pool.push(scored[0].c);
    ramp.push(pool);
  }
  return ramp;
}

/* Deterministic per-cell hash. Same grid position always picks the same
   glyph from its pool, so output is reproducible across runs and machines. */
export function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ---------- ordered dither ---------- */
export function bayer(n) {
  let m = [[0]];
  for (let s = 1; s < n; s *= 2) {
    const r = Array.from({ length: s * 2 }, () => new Array(s * 2));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = m[y][x] * 4;
      r[y][x] = v; r[y][x + s] = v + 2; r[y + s][x] = v + 3; r[y + s][x + s] = v + 1;
    }
    m = r;
  }
  const k = n * n;
  return m.map(row => row.map(v => v / k - 0.5));
}
export const BAYER = bayer(8);

/* ---------- shared lighting rig ----------
   Every source mode routes through this. Change it once and every
   asset on the site changes together. */
export function shade(Nx, Ny, Nz, ao, rim, lightDir) {
  const l = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
  const diff = Math.max(Nx * lightDir[0] / l + Ny * lightDir[1] / l + Nz * lightDir[2] / l, 0);
  const sky = 0.5 + 0.5 * Ny;
  const rimT = Math.pow(1 - clamp(Nz, 0, 1), 3);
  return clamp((0.80 * diff + 0.20 * sky + rim * rimT) * (0.35 + 0.65 * ao), 0, 1);
}

/* ============================================================
   SOURCE A — procedural 3D by sphere tracing
   ============================================================ */
const sdSphere = (x, y, z, r) => Math.hypot(x, y, z) - r;
const sdTorus = (x, y, z, R, r) => Math.hypot(Math.hypot(x, z) - R, y) - r;
function sdRBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
       + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function makeMap(scene, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return function (X, Y, Z) {
    let x = X * cy - Z * sy, z = X * sy + Z * cy;
    const y = Y * cp - z * sp; z = Y * sp + z * cp;
    if (scene === "sphere") return sdSphere(x, y, z, 1.05);
    if (scene === "torus")  return sdTorus(x, y, z, 0.78, 0.34);
    if (scene === "blob")   return smin(sdSphere(x, y - 0.35, z, 0.72),
                                        sdRBox(x, y + 0.5, z, 0.62, 0.34, 0.5, 0.14), 0.45);
    return Math.min(sdRBox(x - 0.42, y - 0.86, z, 0.42, 0.30, 0.42, 0.10),
           Math.min(sdRBox(x,        y,        z, 0.62, 0.30, 0.48, 0.10),
                    sdRBox(x + 0.46, y + 0.86, z, 0.82, 0.30, 0.54, 0.10)));
  };
}
export function renderScene(W, H, o) {
  const map = makeMap(o.scene, o.yaw, o.pitch);
  const lum = new Float32Array(W * H);
  const alive = new Uint8Array(W * H);
  const dep = new Float32Array(W * H).fill(1e3);
  const aspect = W / H, eps = 0.0015;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = ((i + 0.5) / W * 2 - 1) * aspect * 1.5;
    const v = (1 - (j + 0.5) / H * 2) * 1.5;
    let t = 0, hit = false;                    // orthographic, ray dir (0,0,-1)
    for (let s = 0; s < 72; s++) {
      const d = map(u, v, 3 - t);
      if (d < 0.0012) { hit = true; break; }
      t += d;
      if (t > 6.5) break;
    }
    if (!hit) continue;
    const k = j * W + i, hx = u, hy = v, hz = 3 - t;
    const nx = map(hx + eps, hy, hz) - map(hx - eps, hy, hz);
    const ny = map(hx, hy + eps, hz) - map(hx, hy - eps, hz);
    const nz = map(hx, hy, hz + eps) - map(hx, hy, hz - eps);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const Nx = nx / nl, Ny = ny / nl, Nz = nz / nl;
    let occ = 0;
    for (let s = 1; s <= 4; s++) {
      const hh = s * 0.06;
      occ += (hh - map(hx + Nx * hh, hy + Ny * hh, hz + Nz * hh)) / Math.pow(2, s);
    }
    lum[k] = shade(Nx, Ny, Nz, clamp(1 - 2.2 * occ, 0, 1), o.rim, o.lightDir);
    dep[k] = t;
    alive[k] = 1;
  }
  return { W, H, lum, dep, alive };
}

/* ============================================================
   Image placement — fit / zoom / pan
   ============================================================ */
/* Media elements report their intrinsic size differently: images use
   naturalWidth, video uses videoWidth, and .width is an HTML attribute
   that is usually 0. Getting this wrong silently draws nothing. */
export function srcDims(el) {
  return {
    w: el.videoWidth || el.naturalWidth || el.width || 1,
    h: el.videoHeight || el.naturalHeight || el.height || 1,
  };
}

export function placeImage(x, img, W, H, p) {
  const { w: iw, h: ih } = srcDims(img);
  if (p.fit === "stretch") {
    const dw = W * p.zoom, dh = H * p.zoom;
    x.drawImage(img, (W - dw) / 2 + p.panX * W, (H - dh) / 2 + p.panY * H, dw, dh);
    return;
  }
  const base = p.fit === "cover"
    ? Math.max(W / iw, H / ih)
    : Math.min(W / iw, H / ih);
  const s = base * p.zoom, dw = iw * s, dh = ih * s;
  x.drawImage(img, (W - dw) / 2 + p.panX * W, (H - dh) / 2 + p.panY * H, dw, dh);
}

/* ============================================================
   SOURCE B — inflate a silhouette into a lit 3D form
   mask -> distance transform -> dome height -> normals -> shade
   ============================================================ */
export function otsu(vals) {
  const hist = new Float64Array(256);
  for (let i = 0; i < vals.length; i++) hist[clamp(Math.round(vals[i] * 255), 0, 255)]++;
  const total = vals.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = -1, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thr = i; }
  }
  return thr / 255;
}

function distanceTransform(mask, W, H) {
  const INF = 1e9, SQ = Math.SQRT2;
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!mask[k]) { d[k] = 0; continue; }
    d[k] = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 1 : INF;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x; if (d[k] === 0) continue;
    let m = d[k];
    if (x > 0) m = Math.min(m, d[k - 1] + 1);
    if (y > 0) m = Math.min(m, d[k - W] + 1);
    if (x > 0 && y > 0) m = Math.min(m, d[k - W - 1] + SQ);
    if (x < W - 1 && y > 0) m = Math.min(m, d[k - W + 1] + SQ);
    d[k] = m;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x; if (d[k] === 0) continue;
    let m = d[k];
    if (x < W - 1) m = Math.min(m, d[k + 1] + 1);
    if (y < H - 1) m = Math.min(m, d[k + W] + 1);
    if (x < W - 1 && y < H - 1) m = Math.min(m, d[k + W + 1] + SQ);
    if (x > 0 && y < H - 1) m = Math.min(m, d[k + W - 1] + SQ);
    d[k] = m;
  }
  return d;
}

function boxBlur(src, W, H, r, passes) {
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += a[y * W + xx]; n++; } }
      b[y * W + x] = s / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += b[yy * W + x]; n++; } }
      a[y * W + x] = s / n;
    }
  }
  return a;
}

export function readKeyField(img, w, h, place, makeCanvas) {
  const c = makeCanvas(w, h);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, w, h);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  placeImage(x, img, w, h, place);
  const px = x.getImageData(0, 0, w, h).data;
  let hasAlpha = false;
  for (let i = 3; i < px.length; i += 4) { if (px[i] < 250) { hasAlpha = true; break; } }
  const key = new Float32Array(w * h);
  for (let i = 0, k = 0; i < px.length; i += 4, k++) {
    key[k] = hasAlpha ? px[i + 3] / 255
                      : (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
  }
  return { key, hasAlpha, w, h };
}

function downsample(lumF, depF, aliveF, w, h, W, H, SS) {
  const lum = new Float32Array(W * H);
  const alive = new Uint8Array(W * H);
  const dep = new Float32Array(W * H).fill(1e3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sl = 0, n = 0, md = 1e3, al = 0;
    for (let b = 0; b < SS; b++) for (let a = 0; a < SS; a++) {
      const k = (j * SS + b) * w + (i * SS + a);
      sl += lumF[k]; n++; al += aliveF[k];
      if (depF[k] < md) md = depF[k];
    }
    const o = j * W + i;
    lum[o] = sl / n; dep[o] = md;
    alive[o] = al >= n * 0.35 ? 1 : 0;
  }
  return { W, H, lum, dep, alive };
}

export function inflate(kf, W, H, o) {
  const SS = 2, w = kf.w, h = kf.h;
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) mask[k] = ((kf.key[k] > o.threshold) !== o.invert) ? 1 : 0;

  // The subject shouldn't be flooding the frame border — flip if it is.
  let border = 0, borderIn = 0;
  for (let x = 0; x < w; x++) { border += 2; borderIn += mask[x] + mask[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { border += 2; borderIn += mask[y * w] + mask[y * w + w - 1]; }
  if (borderIn / border > 0.6) for (let k = 0; k < w * h; k++) mask[k] = mask[k] ? 0 : 1;

  let inside = 0;
  for (let k = 0; k < w * h; k++) inside += mask[k];

  const dist = distanceTransform(mask, w, h);
  const R = Math.max(o.domeRadius * SS, 1);
  const height = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (!mask[k]) continue;
    const t = Math.min(dist[k] / R, 1);
    height[k] = Math.sqrt(Math.max(2 * t - t * t, 0));      // circular dome profile
  }
  const hgt = boxBlur(height, w, h, 1, 2);
  const wide = boxBlur(hgt, w, h, clamp(Math.round(R * 0.6), 2, 12), 1);

  const lumF = new Float32Array(w * h);
  const aliveF = new Uint8Array(w * h);
  const depF = new Float32Array(w * h).fill(1e3);
  const zs = o.relief * SS;
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = j * w + i;
    if (!mask[k]) continue;
    aliveF[k] = 1;
    if (o.showMask) { lumF[k] = 0.85; depF[k] = 0.5; continue; }
    const nx = -(hgt[k + 1] - hgt[k - 1]) * zs;
    const ny =  (hgt[k - w] - hgt[k + w]) * zs;
    const nl = Math.hypot(nx, ny, 1);
    const ao = clamp(1 - (wide[k] - hgt[k]) * o.occlusion * 3, 0, 1);
    lumF[k] = shade(nx / nl, ny / nl, 1 / nl, ao, o.rim, o.lightDir);
    depF[k] = 1 - hgt[k];
  }
  const field = downsample(lumF, depF, aliveF, w, h, W, H, SS);
  field.coverage = inside / (w * h);
  return field;
}

/* ============================================================
   SOURCE C — bitmap luminance
   Alpha, when present, defines the subject and kills the background.
   ============================================================ */
export function fieldFromImage(img, W, H, place, bgCutoff, makeCanvas) {
  const c = makeCanvas(W, H);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, W, H);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  placeImage(x, img, W, H, place);
  const d = x.getImageData(0, 0, W, H).data;

  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { hasAlpha = true; break; } }

  const lum = new Float32Array(W * H);
  const alive = new Uint8Array(W * H);
  const f = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const a = d[i + 3] / 255;
    const L = 0.2126 * f(d[i] / 255) + 0.7152 * f(d[i + 1] / 255) + 0.0722 * f(d[i + 2] / 255);
    lum[k] = L * (hasAlpha ? a : 1);
    alive[k] = hasAlpha ? (a > 0.5 ? 1 : 0) : (L >= bgCutoff ? 1 : 0);
  }
  return { W, H, lum, dep: null, alive, hasAlpha };
}

/* ---------- edge pass: depth breaks beat luminance Sobel ---------- */
export function edgeField(f) {
  const { W, H, alive } = f;
  const src = f.dep || f.lum, isDepth = !!f.dep;
  const out = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (alive && !alive[k]) continue;
    if (isDepth && src[k] > 1e2) continue;
    const gx = src[k - 1] - src[k + 1], gy = src[k - W] - src[k + W];
    const m = Math.hypot(gx, gy);
    out[k] = isDepth ? Math.min(m / 0.25, 1) : Math.min(m * 3, 1);
  }
  return out;
}

/* ============================================================
   RENDERER
   - `alive` gates every cell, so background is never drawn.
   - dither tapers to zero within one tone step of pure black and
     pure white, so it can't lift an empty cell into tone 1.
   - draws are bucketed by tone: one font/alpha change per level.
   ============================================================ */
export function drawHalftone(canvas, field, t, opts = {}) {
  const makeCanvas = opts.makeCanvas || ((w, h) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  });
  const cellW = t.cellW, cellH = t.cellW * t.cellAspect;
  const cols = field.W, rows = field.H;
  const dpr = opts.dpr || Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);

  canvas.width = Math.round(cols * cellW * dpr);
  canvas.height = Math.round(rows * cellH * dpr);
  if (opts.setStyleSize !== false && canvas.style) {
    canvas.style.width = cols * cellW + "px";
    canvas.style.height = rows * cellH + "px";
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, cols * cellW, rows * cellH);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const ramp = buildRamp(t, makeCanvas);
  const edge = edgeField(field);
  // one bucket per (tone level, pool slot) so font/alpha is set once each
  const buckets = ramp.map(pool => (pool ? pool.map(() => []) : null));
  const span = Math.max(t.white - t.black, 0.001);
  const levels = ramp.length - 1;
  const step = 1 / levels;
  const alive = field.alive;

  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (alive && !alive[k]) continue;
    const raw = field.lum[k];
    if (!field.dep && raw < t.bgCutoff) continue;

    let L = clamp((raw - t.black) / span, 0, 1);
    L = Math.pow(L, t.gamma);
    L = Math.min(L + edge[k] * t.edgeLift, 1);
    const taper = smoothstep(0, step, L) * smoothstep(0, step, 1 - L);
    L += BAYER[j & 7][i & 7] * t.dither * taper * step * 2;
    const idx = clamp(Math.round(L * levels), 0, levels);
    if (idx > 0) {
      const pool = ramp[idx];
      const slot = pool.length === 1 ? 0 : hash2(i, j) % pool.length;
      buckets[idx][slot].push(i, j);
    }
  }

  for (let idx = 1; idx < ramp.length; idx++) {
    const pool = ramp[idx];
    for (let s = 0; s < pool.length; s++) {
      const g = pool[s], pts = buckets[idx][s];
      if (!pts.length) continue;
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = t.ink;
      ctx.font = `${t.weight} ${(cellW * t.charSize * g.scale).toFixed(2)}px ${t.font}`;
      for (let p = 0; p < pts.length; p += 2)
        ctx.fillText(g.char, pts[p] * cellW + cellW / 2, pts[p + 1] * cellH + cellH / 2);
    }
  }
  ctx.globalAlpha = 1;
  return { cols, rows, ramp };
}
