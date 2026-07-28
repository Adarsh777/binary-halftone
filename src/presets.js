/* ============================================================
   Presets
   Three layers, in order of how strongly they enforce consistency:

   1. BUILT_IN  — committed to the repo. Everyone on the team gets
                  the same values with no setup. This is the layer
                  that actually keeps a site coherent.
   2. Saved     — localStorage. Personal scratch presets.
   3. Share URL — encodes the live values into the address bar so a
                  link reproduces an exact look.

   Presets store STYLE by default (character, grid, tone, light,
   colors) and leave FRAMING (source, placement, inflate) alone,
   because framing is per-asset while style must not be.
   ============================================================ */

export const STYLE_KEYS = ["character", "grid", "tone", "light", "colors", "output"];
export const FRAME_KEYS = ["source", "placement", "inflate"];

// Action controls hold no value — never round-trip them.
const ACTION_KEYS = new Set(["exportPng", "copyTokens", "clearImage", "fitGridToMedia"]);

const isObj = v => v && typeof v === "object" && !Array.isArray(v);

export function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = isObj(over[k]) && isObj(base?.[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

export function pick(values, keys) {
  const out = {};
  for (const k of keys) {
    if (!values || !(k in values)) continue;
    if (isObj(values[k])) {
      const inner = {};
      for (const kk of Object.keys(values[k])) {
        if (ACTION_KEYS.has(kk)) continue;
        inner[kk] = values[k][kk];
      }
      out[k] = inner;
    } else if (!ACTION_KEYS.has(k)) {
      out[k] = values[k];
    }
  }
  return out;
}

/* ---------- the shared baseline ---------- */
export const BASE = {
  character: {
    charMode: "binary", customChars: "01", variety: 0.6,
    charSize: 0.82, overlap: 0, sizeVariation: 0.35, sizeSteps: 3, weight: "400",
  },
  grid: { autoFit: false, columns: 160, rows: 120, cellWidth: 8, cellAspect: 1.35 },
  tone: {
    backgroundCutoff: 0.045, steps: 8, blackPoint: 0.05,
    whitePoint: 0.95, gamma: 1, dither: 0.55, edgeLift: 0.55,
  },
  light: { rim: 0.55, dirX: -0.45, dirY: 0.78, dirZ: 0.44 },
  colors: { ink: "#e8e8e6", background: "#0a0a0a" },
  output: { exportScale: "2" },
};

/* ---------- built-in library ----------
   Every entry inherits BASE, so the light rig and colour stay
   identical across all of them. Only the things that should differ
   between a hero and an icon are overridden. */
export const BUILT_IN = {
  "Hero — binary": deepMerge(BASE, {
    grid: { columns: 200, rows: 140, cellWidth: 8 },
  }),
  "Section — dense dots": deepMerge(BASE, {
    grid: { columns: 240, rows: 160, cellWidth: 5 },
    character: { sizeVariation: 0.8, sizeSteps: 4, charSize: 1.0 },
    tone: { steps: 10, dither: 0.7 },
  }),
  "Icon — coarse": deepMerge(BASE, {
    grid: { columns: 64, rows: 64, cellWidth: 14 },
    character: { charSize: 1.0, sizeVariation: 0.2, sizeSteps: 2 },
    tone: { steps: 5, edgeLift: 0.9, gamma: 0.9 },
  }),
  "P&L figures": deepMerge(BASE, {
    character: { charMode: "pnl", variety: 0.9, sizeVariation: 0.15, sizeSteps: 2 },
    tone: { steps: 9, dither: 0.4 },
  }),
  "Flat ASCII — digits": deepMerge(BASE, {
    character: { charMode: "digits", variety: 1, sizeVariation: 0, sizeSteps: 1 },
    tone: { dither: 0.35, steps: 9 },
  }),
  "High contrast": deepMerge(BASE, {
    tone: { steps: 4, blackPoint: 0.18, whitePoint: 0.82, gamma: 0.8, dither: 0.25, edgeLift: 0.9 },
    character: { sizeVariation: 0.6 },
  }),
};

/* ---------- localStorage ---------- */
const LS_KEY = "binary-halftone.presets.v2";
export const PRESET_VERSION = 2;

/* charSize used to mean "font-size as a multiple of cell width". It now
   means "fraction of the largest glyph that fits the cell", and that
   fitting size is ~1/0.6 of the cell width. Old presets are rescaled on
   read rather than discarded. */
const LEGACY_CHAR_SIZE = 0.6;
function migrate(preset) {
  if (!isObj(preset) || preset._v === PRESET_VERSION) return preset;
  const out = deepMerge(preset, {});
  if (isObj(out.character) && typeof out.character.charSize === "number") {
    out.character = { ...out.character,
      charSize: Math.min(1, Math.max(0.2, out.character.charSize * LEGACY_CHAR_SIZE)) };
  }
  out._v = PRESET_VERSION;
  return out;
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    const out = {};
    for (const k of Object.keys(map)) out[k] = migrate(map[k]);
    return out;
  } catch { return {}; }
}
export function writeSaved(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); return true; }
  catch { return false; }
}
export function savePreset(name, values, includeFraming) {
  const keys = includeFraming ? [...STYLE_KEYS, ...FRAME_KEYS] : STYLE_KEYS;
  const map = loadSaved();
  map[name] = { ...pick(values, keys), _v: PRESET_VERSION };
  writeSaved(map);
  return map;
}
export function deletePreset(name) {
  const map = loadSaved();
  delete map[name];
  writeSaved(map);
  return map;
}

/* ---------- JSON round-trip ----------
   Export this file, commit it next to the source, and every machine
   builds from the same numbers. */
export function exportJSON(saved) {
  return JSON.stringify({
    format: "binary-halftone.presets",
    version: 1,
    exportedAt: new Date().toISOString(),
    presets: saved,
  }, null, 2);
}
export function importJSON(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed?.presets ?? parsed;
  if (!isObj(incoming)) throw new Error("No preset object found in that file.");
  const merged = { ...loadSaved(), ...incoming };
  writeSaved(merged);
  return merged;
}

/* ---------- share links ---------- */
export function encodeToHash(values) {
  const payload = pick(values, [...STYLE_KEYS, ...FRAME_KEYS]);
  return "#s=" + encodeURIComponent(JSON.stringify(payload));
}
export function decodeFromHash(hash) {
  if (!hash) return null;
  const m = /[#&]s=([^&]+)/.exec(hash);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); }
  catch { return null; }
}
