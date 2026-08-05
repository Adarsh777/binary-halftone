import {
  BAYER,
  buildRamp,
  clamp,
  fitFontSize,
  getHalftoneEffectiveFill,
  hash2,
  smoothstep,
  type CanvasFactory,
  type Field,
  type Ramp,
  type Tokens,
} from "./halftone-core";
import { edgeField } from "./halftone-image";

/* ============================================================
   RENDERER
   - `alive` gates every cell, so background is never drawn.
   - dither tapers to zero within one tone step of pure black and
     pure white, so it can't lift an empty cell into tone 1.
   - draws are bucketed by tone: one font/alpha change per level.
   ============================================================ */
export type DrawHalftoneOptions = {
  dpr?: number;
  makeCanvas?: CanvasFactory;
  setStyleSize?: boolean;
};

export type DrawHalftoneResult = { cols: number; ramp: Ramp; rows: number };

export function drawHalftone(
  canvas: HTMLCanvasElement,
  field: Field,
  t: Tokens,
  opts: DrawHalftoneOptions = {},
): DrawHalftoneResult {
  const makeCanvas: CanvasFactory = opts.makeCanvas || ((w, h) => {
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

  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, cols * cellW, rows * cellH);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const ramp = buildRamp(t, makeCanvas);
  // Font size is derived from measured glyph metrics, so charSize (and the
  // global scale multiplied into it) is a fraction of the cell rather than
  // an unbounded multiplier. Overlap is the only way to exceed the cell,
  // and it defaults to zero.
  const fitSize = fitFontSize(cellW, cellH, t.font, t.weight, makeCanvas);
  const fill = getHalftoneEffectiveFill(t.charSize, t.scale) + Math.max(t.overlap || 0, 0);
  const edge = edgeField(field);
  // one bucket per (tone level, pool slot) so font/alpha is set once each
  const buckets: number[][][] = ramp.map(pool => (pool ? pool.map(() => []) : []));
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
    const idxRaw = clamp(Math.round(L * levels), 0, levels);
    // Presentational theme reversal: mirror which real, measured-coverage
    // ramp pool this true (uninverted) source tone resolves to, so a bright
    // source pixel lands on the sparse/sentinel end instead of the dense
    // end -- gamma/edgeLift/dither above still shape the true L unchanged,
    // and buildRamp's coverage measurement/sort never sees this flag.
    const idx = t.invert ? clamp(levels - idxRaw, 0, levels) : idxRaw;
    if (idx > 0) {
      const pool = ramp[idx]!;
      const slot = pool.length === 1 ? 0 : hash2(i, j) % pool.length;
      buckets[idx][slot].push(i, j);
    }
  }

  for (let idx = 1; idx < ramp.length; idx++) {
    const pool = ramp[idx]!;
    for (let s = 0; s < pool.length; s++) {
      const g = pool[s], pts = buckets[idx][s];
      if (!pts.length) continue;
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = t.ink;
      ctx.font = `${t.weight} ${(fitSize * fill * g.scale).toFixed(2)}px ${t.font}`;
      for (let p = 0; p < pts.length; p += 2)
        ctx.fillText(g.char, pts[p] * cellW + cellW / 2, pts[p + 1] * cellH + cellH / 2);
    }
  }
  ctx.globalAlpha = 1;
  return { cols, rows, ramp };
}
