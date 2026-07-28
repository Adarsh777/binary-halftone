import {
  clamp,
  shade,
  type CanvasFactory,
  type Field,
  type HalftoneSourceMedia,
} from "./halftone-core";

/* ============================================================
   Image placement — fit / zoom / pan
   ============================================================ */
/* Media elements report their intrinsic size differently: images use
   naturalWidth, video uses videoWidth, and .width is an HTML attribute
   that is usually 0. Getting this wrong silently draws nothing. */
export function srcDims(el: HalftoneSourceMedia): { h: number; w: number } {
  return {
    w: el.videoWidth || el.naturalWidth || el.width || 1,
    h: el.videoHeight || el.naturalHeight || el.height || 1,
  };
}

export type PlaceOptions = {
  cellAspect?: number;
  fit: "contain" | "cover" | "stretch";
  panX: number;
  panY: number;
  zoom: number;
};

/* Media is placed into the sampling grid (cols x rows), but each sample
   is later drawn as a cell of cellW x (cellW * cellAspect). That map is
   anisotropic, so fitting in cell space and rendering in pixel space
   stretches the picture vertically by exactly cellAspect. Pre-divide the
   source height by it and the aspect survives the trip. */
export function placeImage(
  x: CanvasRenderingContext2D,
  img: HalftoneSourceMedia,
  W: number,
  H: number,
  p: PlaceOptions,
): void {
  const d = srcDims(img);
  const iw = d.w;
  const ih = d.h / (p.cellAspect || 1);
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

/* Rows that make the rendered output match the media's real aspect. */
export function rowsForAspect(cols: number, mediaW: number, mediaH: number, cellAspect: number): number {
  return Math.round(cols * mediaH / (mediaW * (cellAspect || 1)));
}

/* ============================================================
   SOURCE B — inflate a silhouette into a lit 3D form
   mask -> distance transform -> dome height -> normals -> shade
   ============================================================ */
export function otsu(vals: ArrayLike<number>): number {
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

function distanceTransform(mask: Uint8Array, W: number, H: number): Float32Array {
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

function boxBlur(src: Float32Array, W: number, H: number, r: number, passes: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(W * H);
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

export type KeyField = { h: number; hasAlpha: boolean; key: Float32Array; w: number };

export function readKeyField(
  img: HalftoneSourceMedia,
  w: number,
  h: number,
  place: PlaceOptions,
  makeCanvas: CanvasFactory,
): KeyField {
  const c = makeCanvas(w, h);
  const x = c.getContext("2d", { willReadFrequently: true })!;
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

function averageSupersampledCells(
  lumF: Float32Array,
  depF: Float32Array,
  aliveF: Uint8Array,
  w: number,
  h: number,
  W: number,
  H: number,
  SS: number,
): Field {
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

export type InflateOptions = {
  domeRadius: number;
  invert: boolean;
  lightDir: readonly [number, number, number];
  occlusion: number;
  relief: number;
  rim: number;
  showMask: boolean;
  threshold: number;
};

export function inflate(kf: KeyField, W: number, H: number, o: InflateOptions): Field {
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
  const field = averageSupersampledCells(lumF, depF, aliveF, w, h, W, H, SS);
  field.coverage = inside / (w * h);
  return field;
}

/* ============================================================
   SOURCE C — bitmap luminance
   Alpha, when present, defines the subject and kills the background.
   ============================================================ */
export function fieldFromImage(
  img: HalftoneSourceMedia,
  W: number,
  H: number,
  place: PlaceOptions,
  bgCutoff: number,
  makeCanvas: CanvasFactory,
): Field {
  const c = makeCanvas(W, H);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.clearRect(0, 0, W, H);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  placeImage(x, img, W, H, place);
  const d = x.getImageData(0, 0, W, H).data;

  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { hasAlpha = true; break; } }

  const lum = new Float32Array(W * H);
  const alive = new Uint8Array(W * H);
  const f = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const a = d[i + 3] / 255;
    const L = 0.2126 * f(d[i] / 255) + 0.7152 * f(d[i + 1] / 255) + 0.0722 * f(d[i + 2] / 255);
    lum[k] = L * (hasAlpha ? a : 1);
    alive[k] = hasAlpha ? (a > 0.5 ? 1 : 0) : (L >= bgCutoff ? 1 : 0);
  }
  return { W, H, lum, dep: null, alive, hasAlpha };
}

/* ---------- edge pass: depth breaks beat luminance Sobel ---------- */
export function edgeField(f: Field): Float32Array {
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
