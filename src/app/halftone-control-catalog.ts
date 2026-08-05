/* Shared per-control metadata for every visible schema control target. Both
   app-performance.ts (scenario budgets/fixtures) and the Playwright specs
   under e2e/ (real interactions) read this single table so the schema, the
   performance matrix, and the browser tests can never drift out of sync. */
export type HalftoneControlKind = "color" | "fileDrop" | "select" | "slider" | "switch" | "text";

export type HalftoneControlConfig = {
  kind: HalftoneControlKind;
  label: string;
  primarySliderRatio?: number;
  requiresCharacterMode?: "custom";
  requiresLuminanceGradientFixture?: boolean;
  requiresMedia?: boolean;
  requiresSourceMode?: "bitmap" | "inflate";
  /* Switches source.mode (and, combined with requiresMedia, uploads media)
     the same way requiresSourceMode does, but without asserting that the
     control's own visibility is gated by source.mode. Use this for
     always-visible controls (e.g. tone.backgroundCutoff) whose *effect*
     -- not presence -- depends on the active source mode. */
  requiresSourceModeContext?: "bitmap" | "inflate";
  selectHeaviestOptionLabel?: string;
  selectOptionLabel?: string;
  /* export.image.format/export.image.resolution only affect the
     export-composite pass (rendererPipeline interactionInvalidation:
     mustNotInvalidate build-field/build-ramp/rasterize-glyphs), never the
     live preview canvas. The generic "changes rendered output" canvas-diff
     test is structurally the wrong proof for these -- it can never pass,
     by design, not by bug -- so they skip it in favor of a dedicated
     export-artifact test (decoded PNG/JPEG bytes, real dimensions). */
  skipsCanvasOutputTest?: boolean;
  sliderStressRatio?: number;
  target: string;
  /* Overrides the generic binary-charset text fixture ("01XY"/heaviest
     charset) for "text" controls that aren't a character list -- e.g. a
     numeric custom-size field, where that fixture would be invalid input. */
  textPrimaryValue?: string;
  textStressValue?: string;
  workload: boolean;
};

export const HALFTONE_CONTROL_CONFIGS: readonly HalftoneControlConfig[] = [
  {
    kind: "fileDrop",
    label: "Image",
    target: "source.image",
    workload: true,
  },
  {
    kind: "text",
    label: "Custom Width",
    requiresMedia: true,
    target: "source.image.width",
    textPrimaryValue: "320",
    textStressValue: "640",
    workload: false,
  },
  {
    kind: "text",
    label: "Custom Height",
    requiresMedia: true,
    target: "source.image.height",
    textPrimaryValue: "180",
    textStressValue: "90",
    workload: false,
  },
  {
    kind: "select",
    label: "Mode",
    requiresMedia: true,
    selectOptionLabel: "Silhouette",
    target: "source.mode",
    workload: true,
  },
  {
    kind: "select",
    label: "Fit",
    requiresMedia: true,
    /* Placement's schema section is visibleWhen oneOf ["inflate","bitmap"]
       -- it places the uploaded image for BOTH remaining source modes, not
       just Silhouette, so it never hides once media is attached (there is
       no third mode left to hide it from now that Scene is gone).
       requiresSourceModeContext (not requiresSourceMode) switches to a real
       mode for setup without asserting a now-impossible hide/show toggle. */
    requiresSourceModeContext: "inflate",
    selectOptionLabel: "Cover",
    target: "placement.fit",
    workload: false,
  },
  {
    kind: "slider",
    label: "Zoom",
    requiresMedia: true,
    /* Placement's schema section is visibleWhen oneOf ["inflate","bitmap"]
       -- it places the uploaded image for BOTH remaining source modes, not
       just Silhouette, so it never hides once media is attached (there is
       no third mode left to hide it from now that Scene is gone).
       requiresSourceModeContext (not requiresSourceMode) switches to a real
       mode for setup without asserting a now-impossible hide/show toggle. */
    requiresSourceModeContext: "inflate",
    sliderStressRatio: 0.9,
    target: "placement.zoom",
    workload: false,
  },
  {
    kind: "slider",
    label: "Pan X",
    requiresMedia: true,
    /* Placement's schema section is visibleWhen oneOf ["inflate","bitmap"]
       -- it places the uploaded image for BOTH remaining source modes, not
       just Silhouette, so it never hides once media is attached (there is
       no third mode left to hide it from now that Scene is gone).
       requiresSourceModeContext (not requiresSourceMode) switches to a real
       mode for setup without asserting a now-impossible hide/show toggle. */
    requiresSourceModeContext: "inflate",
    sliderStressRatio: 0.9,
    target: "placement.panX",
    workload: false,
  },
  {
    kind: "slider",
    label: "Pan Y",
    requiresMedia: true,
    /* Placement's schema section is visibleWhen oneOf ["inflate","bitmap"]
       -- it places the uploaded image for BOTH remaining source modes, not
       just Silhouette, so it never hides once media is attached (there is
       no third mode left to hide it from now that Scene is gone).
       requiresSourceModeContext (not requiresSourceMode) switches to a real
       mode for setup without asserting a now-impossible hide/show toggle. */
    requiresSourceModeContext: "inflate",
    sliderStressRatio: 0.9,
    target: "placement.panY",
    workload: false,
  },

  {
    kind: "slider",
    label: "Threshold",
    requiresLuminanceGradientFixture: true,
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "silhouette.threshold",
    workload: false,
  },
  {
    kind: "switch",
    label: "Invert",
    requiresLuminanceGradientFixture: true,
    requiresMedia: true,
    requiresSourceMode: "inflate",
    target: "silhouette.invert",
    workload: false,
  },
  {
    kind: "switch",
    label: "Mask Preview",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    target: "silhouette.showMask",
    workload: false,
  },
  {
    kind: "slider",
    label: "Dome Radius",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.95,
    target: "silhouette.domeRadius",
    workload: true,
  },
  {
    kind: "slider",
    label: "Relief",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "silhouette.relief",
    workload: false,
  },
  {
    kind: "slider",
    label: "Occlusion",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "silhouette.occlusion",
    workload: false,
  },

  {
    kind: "select",
    label: "Character Set",
    selectHeaviestOptionLabel: "P&L",
    selectOptionLabel: "Digits",
    target: "character.mode",
    workload: true,
  },
  {
    kind: "text",
    label: "Custom Characters",
    requiresCharacterMode: "custom",
    target: "character.customChars",
    workload: true,
  },
  { kind: "slider", label: "Variety", sliderStressRatio: 0.9, target: "character.variety", workload: false },
  {
    kind: "slider",
    label: "Size",
    /* halftone-draw.ts clamps charSize to [0.05, 1] (matching the
       reference engine byte-for-byte); the schema's dial range (0.3-2.5,
       ported as-is from the reference App.jsx dial config) means every
       value from 1 upward -- including the 1.05 default -- renders
       identically at the clamp ceiling. A ratio below the clamp boundary
       ((1-0.3)/2.2 ~= 0.318) is required to prove a real, visible change. */
    primarySliderRatio: 0.1,
    sliderStressRatio: 0.95,
    target: "character.size",
    workload: true,
  },
  {
    kind: "slider",
    label: "Scale",
    /* character.scale defaults to 1 (its own max) -- a global multiplier
       into charSize's [0.05, 1] cell-filling clamp, so it can only ever
       shrink from there, never grow past the clamp ceiling. The schema's
       declared minimum (0.1) is both the most visually-distinct value and
       the one most likely to force a fresh coverage-cache measurement at a
       not-yet-seen size fraction, making it the real "heaviest" workload
       case for this control (not the largest number). */
    primarySliderRatio: 0.4,
    sliderStressRatio: 0.05,
    target: "character.scale",
    workload: true,
  },
  {
    kind: "slider",
    label: "Size Variation",
    sliderStressRatio: 0.95,
    target: "character.sizeVariation",
    workload: true,
  },
  { kind: "slider", label: "Size Steps", sliderStressRatio: 0.95, target: "character.sizeSteps", workload: true },
  {
    kind: "select",
    label: "Weight",
    /* The loaded monospace font stack has no true intermediate weight
       faces: Light/Regular/Medium (300/400/500) all render byte-identical
       glyphs in Chromium, and only Bold (700) is a genuinely distinct
       face. "Medium" (the reference's mid-range default choice) cannot
       prove a real rendered-output change; Bold is both the heaviest and
       the only visually-provable non-default weight. */
    selectHeaviestOptionLabel: "Bold",
    selectOptionLabel: "Bold",
    target: "character.weight",
    workload: true,
  },

  { kind: "slider", label: "Cell Aspect", sliderStressRatio: 0.05, target: "grid.cellAspect", workload: true },
  { kind: "slider", label: "Cell Width", sliderStressRatio: 0.05, target: "grid.cellWidth", workload: true },

  {
    kind: "slider",
    label: "Background Cutoff",
    /* drawHalftone only applies tone.backgroundCutoff when the field has
       no depth (`!field.dep`): renderScene (Scene) and inflate
       (Silhouette) both produce a real depth field, so backgroundCutoff
       has no effect at all in either mode. It is only observable in
       fieldFromImage's bitmap-luminance source (dep: null), and only with
       real luminance gradation across the cutoff's own range -- see
       requiresLuminanceGradientFixture. */
    requiresLuminanceGradientFixture: true,
    requiresMedia: true,
    requiresSourceModeContext: "bitmap",
    sliderStressRatio: 0.9,
    target: "tone.backgroundCutoff",
    workload: false,
  },
  { kind: "slider", label: "Levels", sliderStressRatio: 0.95, target: "tone.steps", workload: true },
  { kind: "slider", label: "Black Point", sliderStressRatio: 0.9, target: "tone.blackPoint", workload: false },
  { kind: "slider", label: "White Point", sliderStressRatio: 0.9, target: "tone.whitePoint", workload: false },
  { kind: "slider", label: "Gamma", sliderStressRatio: 0.9, target: "tone.gamma", workload: false },
  { kind: "slider", label: "Dither", sliderStressRatio: 0.9, target: "tone.dither", workload: false },
  { kind: "slider", label: "Edge Lift", sliderStressRatio: 0.9, target: "tone.edgeLift", workload: false },

  {
    kind: "slider",
    label: "Rim",
    /* rim*rimT (rimT = (1-Nz)^3, shade() in halftone-core.ts) only shows up
       where the dome's surface normal points away from the viewer -- on a
       flat solid-color fixture the inflate() dome is a single uniform bump
       with almost no edge silhouette running through the visible canvas, so
       rimT stays near zero everywhere sampled. A luminance-gradient fixture
       gives it a real threshold boundary to catch instead. Even then, rim's
       term is weighted far below diff/sky (0.80*diff + 0.20*sky + rim*rimT),
       so a mid-range 0.6-ratio drag (0.55 -> 0.72) doesn't reliably cross a
       tone-bucket boundary within the sampled canvas region; confirmed by a
       direct test that a near-max drag (ratio 0.98, 0.55 -> ~1.18) does. */
    primarySliderRatio: 0.98,
    requiresLuminanceGradientFixture: true,
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "light.rim",
    workload: false,
  },
  {
    kind: "slider",
    label: "Direction X",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "light.dirX",
    workload: false,
  },
  {
    kind: "slider",
    label: "Direction Y",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "light.dirY",
    workload: false,
  },
  {
    kind: "slider",
    label: "Direction Z",
    requiresMedia: true,
    requiresSourceMode: "inflate",
    sliderStressRatio: 0.9,
    target: "light.dirZ",
    workload: false,
  },

  { kind: "color", label: "Ink", target: "appearance.ink", workload: false },
  { kind: "color", label: "Background", target: "appearance.background", workload: false },
  { kind: "switch", label: "Include", target: "export.includeBackground", workload: false },
  { kind: "switch", label: "Reverse theme", target: "appearance.themeReversed", workload: false },

  {
    kind: "select",
    label: "Format",
    selectOptionLabel: "JPG",
    skipsCanvasOutputTest: true,
    target: "export.image.format",
    workload: false,
  },
  {
    kind: "select",
    label: "Resolution",
    selectHeaviestOptionLabel: "8K",
    selectOptionLabel: "2K",
    skipsCanvasOutputTest: true,
    target: "export.image.resolution",
    workload: true,
  },
] as const;

export function getHalftoneControlConfig(target: string): HalftoneControlConfig {
  const config = HALFTONE_CONTROL_CONFIGS.find((entry) => entry.target === target);
  if (!config) {
    throw new Error(`No HalftoneControlConfig registered for target "${target}".`);
  }
  return config;
}

/* The one real Vitest test (in halftone-engine.test.ts / halftone-render.test.ts)
   that proves each control target's value really reaches the engine. Shared
   by app-performance.ts and app-acceptance-data.ts so both point at the same
   passing test instead of maintaining separate copies of this mapping. */
export const HALFTONE_ENGINE_TEST_NAME_BY_TARGET: Readonly<Record<string, string>> = {
  "appearance.background": "engine: appearance.background maps into engine tokens",
  "appearance.ink": "engine: appearance.ink maps into engine tokens",
  "appearance.themeReversed": "engine: appearance.themeReversed swaps ink/bg and mirrors the ramp index without touching buildRamp",
  "character.customChars": "engine: character.customChars parses the custom charset",
  "character.mode": "engine: character.mode selects the correct charset",
  "character.scale": "engine: character.scale composes with charSize without overflowing the cell and re-measures ink coverage",
  "character.size": "engine: character.size maps into engine tokens",
  "character.sizeSteps": "engine: character.sizeSteps changes the ramp scale axis length",
  "character.sizeVariation": "engine: character.sizeVariation changes the ramp scale axis",
  "character.variety": "engine: character.variety maps into engine tokens",
  "character.weight": "engine: character.weight maps into engine tokens",
  "export.image.format": "engine: export.image.format maps to a real PNG/JPG export choice",
  "export.image.resolution": "engine: export.image.resolution maps to a real 2K/4K/8K export choice",
  "export.includeBackground": "engine: export.includeBackground toggles the preview/export background token",
  "grid.cellAspect": "engine: grid.cellAspect changes the derived grid size",
  "grid.cellWidth": "engine: grid.cellWidth changes the derived grid size",
  "light.dirX": "engine: light.dirX changes the raymarched field",
  "light.dirY": "engine: light.dirY changes the raymarched field",
  "light.dirZ": "engine: light.dirZ changes the raymarched field",
  "light.rim": "engine: light.rim changes the raymarched field",
  "placement.fit": "engine: placement.fit maps into placement options",
  "placement.panX": "engine: placement.panX maps into placement options",
  "placement.panY": "engine: placement.panY maps into placement options",
  "placement.zoom": "engine: placement.zoom maps into placement options",
  "silhouette.domeRadius": "engine: silhouette.domeRadius maps into inflate options",
  "silhouette.invert": "engine: silhouette.invert maps into inflate options",
  "silhouette.occlusion": "engine: silhouette.occlusion maps into inflate options",
  "silhouette.relief": "engine: silhouette.relief maps into inflate options",
  "silhouette.showMask": "engine: silhouette.showMask maps into inflate options",
  "silhouette.threshold": "engine: silhouette.threshold maps into inflate options",
  "source.image": "engine: source.image without an attached image falls back to the procedural scene",
  "source.image.height": "engine: source.image.width/height reach placeImage without stretching the source",
  "source.image.width": "engine: source.image.width/height reach placeImage without stretching the source",
  "source.mode": "engine: source.mode selects the effective render pipeline",
  "tone.backgroundCutoff": "engine: tone.backgroundCutoff maps into engine tokens",
  "tone.blackPoint": "engine: tone.blackPoint maps into engine tokens",
  "tone.dither": "engine: tone.dither maps into engine tokens",
  "tone.edgeLift": "engine: tone.edgeLift maps into engine tokens",
  "tone.gamma": "engine: tone.gamma maps into engine tokens",
  "tone.steps": "engine: tone.steps maps into engine tokens",
  "tone.whitePoint": "engine: tone.whitePoint maps into engine tokens",
};

export function getHalftoneEngineTestName(target: string): string {
  const testName = HALFTONE_ENGINE_TEST_NAME_BY_TARGET[target];
  if (!testName) {
    throw new Error(`No automated engine test registered for target "${target}".`);
  }
  return testName;
}
