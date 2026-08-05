/* ============================================================
   binary-halftone engine — shared primitives
   No framework, no DOM assumptions beyond <canvas>.
   Import this from the React app AND from your build script so
   both produce byte-identical output.
   ============================================================ */

/* ---------- named character sets ----------
   Ordering here is irrelevant — the ramp measures and sorts. What
   matters is tonal spread: a set needs light glyphs (. , -) and
   heavy ones ($ % 8) or the gradient collapses. */
export const CHARSETS: Record<"binary" | "digits" | "pnl", readonly string[]> = {
  binary: ["0", "1"],
  digits: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  pnl: ["$", "%", "(", ")", "+", "-", ".", ",",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};

export type CharMode = "binary" | "custom" | "digits" | "pnl";

export function resolveCharset(mode: string, custom?: string): readonly string[] {
  if (mode === "custom") {
    const chars = Array.from(new Set(String(custom || "").split(""))).filter(c => c.trim().length);
    return chars.length ? chars : CHARSETS.binary;
  }
  return CHARSETS[mode as keyof typeof CHARSETS] || CHARSETS.binary;
}

export type Tokens = {
  alphas: readonly number[];
  bg: string;
  bgCutoff: number;
  black: number;
  cellAspect: number;
  cellW: number;
  charMode: string;
  charSize: number;
  charset: readonly string[];
  dither: number;
  edgeLift: number;
  font: string;
  gamma: number;
  ink: string;
  invert: boolean;
  lightDir: readonly [number, number, number];
  overlap: number;
  rim: number;
  scale: number;
  sizeSteps: number;
  sizeVariation: number;
  steps: number;
  variety: number;
  weight: number;
  white: number;
};

export const DEFAULT_TOKENS: Tokens = {
  charMode: "binary",
  charset: ["0", "1"],
  variety: 0.6,          // 0 = one glyph per tone, 1 = full pool within tolerance
  font: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  weight: 400,
  ink: "#e8e8e6",
  bg: "#0a0a0a",
  invert: false,         // mirrors the final ramp-index lookup (see drawHalftone)
                         // so a bright source pixel resolves to the sparse/
                         // sentinel end instead of the dense end; buildRamp's
                         // coverage measurement and sort are untouched.

  cellW: 8,
  cellAspect: 1.35,

  // --- character size axis ---
  charSize: 0.82,        // fraction of the cell a full-size glyph fills
  overlap: 0,            // extra size PAST the cell; the only way to collide
  scale: 1,              // global multiplier on charSize; 1 = no change. Composes
                         // on top of charSize (both clamp the *same* [0.05, 1]
                         // cell-filling fraction, so the product can never
                         // overflow) and on top of sizeVariation's per-cell
                         // falloff (applied afterward, unchanged, at draw time).
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
  rim: 0.55,
};

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

/* Any drawable source the engine samples from: an uploaded image, a video
   frame, or an offscreen canvas. Intersected with the intrinsic-size hints
   each element type actually exposes, since only some of them share names. */
export type HalftoneSourceMedia = CanvasImageSource & {
  height?: number;
  naturalHeight?: number;
  naturalWidth?: number;
  videoHeight?: number;
  videoWidth?: number;
  width?: number;
};

/* ---------- character size axis ----------
   Spread is asymmetric on purpose: shrinking reads as "less ink"
   far more cleanly than growing reads as "more ink", because a
   glyph larger than its cell starts colliding with its neighbours. */
/* ---------- font fit ----------
   A monospace glyph's advance is roughly 0.6em, so a font-size equal
   to the cell width only fills ~60% of the cell. Multiplying font-size
   by the cell width directly means collisions start the moment that
   multiplier passes ~1.67 — which is a property of the font, not a
   number anyone can guess. Measure it instead, once per font/weight,
   and express charSize as a fraction of the largest size that fits. */
type FontFit = { advance: number; ink: number };

const fitCache = new Map<string, FontFit>();
export function fontFit(font: string, weight: number, makeCanvas: CanvasFactory): FontFit {
  const key = font + "|" + weight;
  if (fitCache.has(key)) return fitCache.get(key)!;
  const REF = 100;
  let advance = 0.6, ink = 0.72;               // sane fallbacks
  try {
    const c = makeCanvas(8, 8);
    const x = c.getContext("2d")!;
    x.font = weight + " " + REF + "px " + font;
    const m = x.measureText("0");
    if (m.width > 0) advance = m.width / REF;
    const a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
    if (isFinite(a) && isFinite(d) && a + d > 0) ink = (a + d) / REF;
  } catch (e) { /* keep fallbacks */ }
  const out: FontFit = { advance, ink };
  fitCache.set(key, out);
  return out;
}

export function buildScaleAxis(variation: number, steps: number): number[] {
  const n = Math.max(1, Math.round(steps));
  if (variation <= 0.001 || n === 1) return [1];
  // Variation only ever shrinks. If it could also grow, the darkest
  // tones would overflow the cell that charSize was fitted to.
  const lo = 1 - 0.85 * variation;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + (1 - lo) * (i / (n - 1)));
  return out;
}

/* ---------- glyph ink coverage ----------
   Measured at a size proportional to `sizeFraction` (the same [0.05, 1]
   cell-filling fraction charSize/scale produce), not a fixed reference
   size, so the measured coverage reflects how the glyph actually looks at
   the size it will really be drawn at. Anti-aliasing/hinting don't scale
   perfectly with area, especially for thin glyphs at small sizes, so
   measuring at a fixed size regardless of the real render size could rank
   glyphs in an order that no longer matches how they actually look once a
   global scale control pushes the real size far from that fixed
   reference -- silently shifting the tone ramp or inverting the gradient. */
const covCache = new Map<string, number>();
export function inkCoverage(
  ch: string,
  font: string,
  weight: number,
  makeCanvas: CanvasFactory,
  sizeFraction = 1,
): number {
  const fraction = clamp(sizeFraction, 0.05, 1);
  const key = ch + "|" + font + "|" + weight + "|" + fraction.toFixed(2);
  if (covCache.has(key)) return covCache.get(key)!;
  const N = 64;
  const c = makeCanvas(N, N);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.clearRect(0, 0, N, N);
  x.fillStyle = "#fff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `${weight} ${N * 0.8 * fraction}px ${font}`;
  x.fillText(ch, N / 2, N / 2);
  const d = x.getImageData(0, 0, N, N).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i];
  const cov = sum / (255 * N * N) || 0.15;
  covCache.set(key, cov);
  return cov;
}

export function fitFontSize(cellW: number, cellH: number, font: string, weight: number, makeCanvas: CanvasFactory): number {
  const f = fontFit(font, weight, makeCanvas);
  return Math.min(cellW / f.advance, cellH / f.ink);
}

/* The single [0.05, 1] "fraction of the cell-filling size" every glyph is
   actually drawn at, before the ramp's per-cell sizeVariation scale (`s`,
   applied afterward at draw time, unchanged) multiplies in further. Global
   scale composes by multiplying INTO charSize before this same clamp --
   not as a separate later multiplier -- so the product can never push a
   glyph past "exactly fills the cell" no matter how large `scale` is. */
export function getHalftoneEffectiveFill(charSize: number, scale: number): number {
  return clamp(charSize * scale, 0.05, 1);
}

/* fontFit/inkCoverage cache real glyph metrics keyed by font+weight(+size),
   measured via canvas text APIs that silently fall back to a substitute
   font until the real one finishes loading -- so a measurement taken too
   early can cache permanently-wrong metrics. Clearing on fonts.ready and
   notifying listeners lets the renderer force one corrective redraw once
   the real font is actually available, which matters most here because
   the new global scale control depends on freshly-measured coverage at
   whatever size it currently renders at. */
const fontsReadyListeners = new Set<() => void>();

export function onHalftoneFontsReady(listener: () => void): () => void {
  fontsReadyListeners.add(listener);
  return () => {
    fontsReadyListeners.delete(listener);
  };
}

if (typeof document !== "undefined" && document.fonts?.ready) {
  void document.fonts.ready.then(() => {
    fitCache.clear();
    covCache.clear();
    for (const listener of fontsReadyListeners) listener();
  });
}

/* ---------- tone ramp ----------
   Two glyphs is not two tones. Every (glyph, alpha, size) combo is
   scored by perceived ink, sorted, and sampled at even intervals.
   Sorting matters: "1" at full opacity is dimmer than "0" at half. */
const MAX_POOL = 6;

export type RampCombo = { alpha: number; char: string; scale: number; v: number };
export type RampPool = RampCombo[];
export type Ramp = (RampPool | null)[];

export function buildRamp(t: Tokens, makeCanvas: CanvasFactory): Ramp {
  const scales = buildScaleAxis(t.sizeVariation, t.sizeSteps);
  const chars = (t.charset && t.charset.length) ? t.charset : CHARSETS.binary;
  const fill = getHalftoneEffectiveFill(t.charSize, t.scale);
  const combos: RampCombo[] = [];
  for (const ch of chars) {
    const cov = inkCoverage(ch, t.font, t.weight, makeCanvas, fill);
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

  const ramp: Ramp = [null];                  // index 0 draws nothing
  for (let i = 0; i < n; i++) {
    const target = lo + (hi - lo) * (n > 1 ? i / (n - 1) : 1);
    const scored = combos
      .map(c => ({ c, d: Math.abs(c.v - target) }))
      .sort((a, b) => a.d - b.d);
    const seen = new Set<string>();
    const pool: RampCombo[] = [];
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
export function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ---------- ordered dither ---------- */
export function bayer(n: number): number[][] {
  let m: number[][] = [[0]];
  for (let s = 1; s < n; s *= 2) {
    const r: number[][] = Array.from({ length: s * 2 }, () => new Array<number>(s * 2));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = m[y][x] * 4;
      r[y][x] = v; r[y][x + s] = v + 2; r[y + s][x] = v + 3; r[y + s][x + s] = v + 1;
    }
    m = r;
  }
  const k = n * n;
  return m.map(row => row.map(v => v / k - 0.5));
}
export const BAYER: number[][] = bayer(8);

/* ---------- shared lighting rig ----------
   Every source mode routes through this. Change it once and every
   asset on the site changes together. */
export function shade(
  Nx: number,
  Ny: number,
  Nz: number,
  ao: number,
  rim: number,
  lightDir: readonly [number, number, number],
): number {
  const l = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
  const diff = Math.max(Nx * lightDir[0] / l + Ny * lightDir[1] / l + Nz * lightDir[2] / l, 0);
  const sky = 0.5 + 0.5 * Ny;
  const rimT = Math.pow(1 - clamp(Nz, 0, 1), 3);
  return clamp((0.80 * diff + 0.20 * sky + rim * rimT) * (0.35 + 0.65 * ao), 0, 1);
}

/* ============================================================
   Field — the shared per-cell sample grid every source produces
   and drawHalftone consumes.
   ============================================================ */
export type Field = {
  alive: Uint8Array;
  coverage?: number;
  dep: Float32Array | null;
  H: number;
  hasAlpha?: boolean;
  lum: Float32Array;
  W: number;
};
