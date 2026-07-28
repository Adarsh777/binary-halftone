/* ============================================================
   binary-halftone engine — public barrel
   The reference engine (originally src/halftone.js, copied in as-is and
   typed without changing its algorithm) is split across halftone-core.ts,
   halftone-scene.ts, halftone-image.ts, and halftone-draw.ts to stay under
   the per-file line budget. Every consumer imports from "./halftone" so
   the split is purely organizational.
   ============================================================ */
export * from "./halftone-core";
export * from "./halftone-scene";
export * from "./halftone-image";
export * from "./halftone-draw";
