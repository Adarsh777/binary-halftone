import {
  defineToolcraftPerformance,
  type ToolcraftPerformanceConfig,
  type ToolcraftPerformanceLoadMetric,
  type ToolcraftPerformanceScenario,
} from "@/toolcraft/runtime";

import {
  getHalftoneEngineTestName,
  HALFTONE_CONTROL_CONFIGS,
  type HalftoneControlConfig,
} from "./halftone-control-catalog";

/* Every workload control-change/control-drag scenario needs an independent
   heavy-baseline workloadFixture (performance.md: "workloadFixture is the
   app baseline; stressFixture is the action under test"). A large uploaded
   image is the app's real heaviest starting state regardless of which other
   control is under test. */
const HEAVY_BASELINE_MEDIA = { height: 2160, width: 3840 };
const SMALL_BASELINE_MEDIA = { height: 64, width: 64 };

function buildHeavyBaselineWorkloadFixture(target: string) {
  return {
    kind: "media" as const,
    loadProfile: fullyGuaranteedLoadProfile(target, "media-area", HEAVY_BASELINE_MEDIA),
    reason:
      "A 4K-equivalent uploaded source is the app's heaviest realistic starting state and raises decode + per-cell sampling cost independently of any single control under test.",
    value: HEAVY_BASELINE_MEDIA,
  };
}

type SliderHardLimit = { direction: "max" | "min"; value: number };

const SLIDER_WORKLOAD_HARD_LIMITS: Record<string, SliderHardLimit> = {
  "character.scale": { direction: "min", value: 0.1 },
  "character.size": { direction: "max", value: 2.5 },
  "character.sizeSteps": { direction: "max", value: 6 },
  "character.sizeVariation": { direction: "max", value: 1 },
  "grid.cellAspect": { direction: "min", value: 0.8 },
  "grid.cellWidth": { direction: "min", value: 3 },
  "silhouette.domeRadius": { direction: "max", value: 40 },
  "tone.steps": { direction: "max", value: 12 },
};

function fullyGuaranteedLoadProfile(
  target: string,
  metric: ToolcraftPerformanceLoadMetric,
  value: unknown,
) {
  return {
    hardLimit: value,
    metric,
    smoothTarget: value,
    smoothTargetRatio: 1,
    target,
    userFacingRange: "fully-guaranteed" as const,
  };
}

function buildControlScenario(config: HalftoneControlConfig): ToolcraftPerformanceScenario {
  const isDrag = config.kind === "slider";
  const isMediaImport = config.kind === "fileDrop";
  const interaction: ToolcraftPerformanceScenario["interaction"] = isMediaImport
    ? "media-import"
    : isDrag
      ? "control-drag"
      : "control-change";
  const budget = isMediaImport
    ? { maxFrameGapMs: 33, maxInteractionMs: 800 }
    : { maxFrameGapMs: 33, maxInteractionMs: 180 };

  const base = {
    automated: true,
    automatedTestName: getHalftoneEngineTestName(config.target),
    browser: true,
    browserTestName: `browser perf: ${config.target} control performance`,
    budget,
    controlLabel: config.label,
    expectedObservable: `Product output canvas changes after ${config.label} is changed.`,
    fixture: `Real ${config.kind} interaction on the ${config.label} control.`,
    id: config.target,
    interaction,
    target: config.target,
    workload: config.workload,
  } satisfies Omit<ToolcraftPerformanceScenario, "stressFixture" | "workloadFixture">;

  if (!config.workload) {
    return base as ToolcraftPerformanceScenario;
  }

  if (isMediaImport) {
    return {
      ...base,
      stressFixture: {
        kind: "media",
        loadProfile: fullyGuaranteedLoadProfile(config.target, "media-area", HEAVY_BASELINE_MEDIA),
        reason: "A 4K-equivalent uploaded source is the heaviest realistic media size for Silhouette/Image modes.",
        value: HEAVY_BASELINE_MEDIA,
      },
    } as ToolcraftPerformanceScenario;
  }

  const sliderLimit = SLIDER_WORKLOAD_HARD_LIMITS[config.target];
  if (sliderLimit) {
    return {
      ...base,
      stressFixture: {
        kind: "max-value",
        loadProfile: fullyGuaranteedLoadProfile(
          config.target,
          sliderLimit.direction === "max" ? "numeric-max" : "numeric-min",
          sliderLimit.value,
        ),
        reason: `${sliderLimit.value} is the schema-declared ${sliderLimit.direction === "max" ? "maximum" : "minimum"} for ${config.label}, the heaviest useful value.`,
        value: sliderLimit.value,
      },
      workloadFixture: buildHeavyBaselineWorkloadFixture(config.target),
    } as ToolcraftPerformanceScenario;
  }

  if (config.kind === "text") {
    const heaviest = "$%()+-.,0123456789";
    return {
      ...base,
      stressFixture: {
        kind: "max-value",
        loadProfile: fullyGuaranteedLoadProfile(config.target, "custom", heaviest),
        reason: "The P&L character set has the most distinct glyphs (18), maximizing ink-coverage measurement and ramp combinations.",
        value: heaviest,
      },
      values: { default: "01", max: heaviest, min: "0" },
      workloadFixture: buildHeavyBaselineWorkloadFixture(config.target),
    } as ToolcraftPerformanceScenario;
  }

  // select-type workload controls (source.mode, character.mode, character.weight, export.image.resolution)
  const heaviestOption = config.selectHeaviestOptionLabel ?? config.selectOptionLabel!;
  const optionValue = SELECT_STRESS_VALUE_BY_TARGET[config.target]!;
  return {
    ...base,
    stressFixture: {
      kind: "max-value",
      loadProfile: fullyGuaranteedLoadProfile(config.target, "custom", optionValue),
      reason: `"${heaviestOption}" is the heaviest realistic ${config.label} choice for this product.`,
      value: optionValue,
    },
    workloadFixture: buildHeavyBaselineWorkloadFixture(config.target),
  } as ToolcraftPerformanceScenario;
}

const ENGINE_TEST_NAME_BY_TARGET: Record<string, string> = {
  "appearance.background": "engine: appearance.background maps into engine tokens",
  "appearance.ink": "engine: appearance.ink maps into engine tokens",
  "character.customChars": "engine: character.customChars parses the custom charset",
  "character.mode": "engine: character.mode selects the correct charset",
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
  "source.mode": "engine: source.mode selects the effective render pipeline",
  "tone.backgroundCutoff": "engine: tone.backgroundCutoff maps into engine tokens",
  "tone.blackPoint": "engine: tone.blackPoint maps into engine tokens",
  "tone.dither": "engine: tone.dither maps into engine tokens",
  "tone.edgeLift": "engine: tone.edgeLift maps into engine tokens",
  "tone.gamma": "engine: tone.gamma maps into engine tokens",
  "tone.steps": "engine: tone.steps maps into engine tokens",
  "tone.whitePoint": "engine: tone.whitePoint maps into engine tokens",
};

const SELECT_STRESS_VALUE_BY_TARGET: Record<string, string> = {
  "character.mode": "pnl",
  "character.weight": "700",
  "export.image.resolution": "8k",
  "source.mode": "inflate",
};

/* getHalftoneControlConfig("source.image") already gets a media-import scenario
   above (the real upload gesture). The performance framework's generic
   per-target workload check only recognizes control-change/control-drag/
   export-copy interactions, so this second scenario proves the same
   target's min/default/max size range independently of the upload gesture
   itself (e.g. comparing a small vs. large already-uploaded source). */
const SOURCE_IMAGE_RANGE_SCENARIO: ToolcraftPerformanceScenario = {
  automated: true,
  automatedTestName: getHalftoneEngineTestName("source.image"),
  browser: true,
  browserTestName: "browser perf: source.image size range stays within budget",
  budget: { maxFrameGapMs: 33, maxInteractionMs: 180 },
  controlLabel: "Image",
  expectedObservable:
    "Product output canvas stays within budget across small and large already-uploaded source sizes.",
  fixture: "Compare a 64x64 uploaded source against a 3840x2160 uploaded source at the same control state.",
  id: "source.image.range",
  interaction: "control-change",
  stressFixture: {
    kind: "media",
    loadProfile: fullyGuaranteedLoadProfile("source.image", "media-area", HEAVY_BASELINE_MEDIA),
    reason: "A 4K-equivalent uploaded source is the heaviest realistic media size for Silhouette/Image modes.",
    value: HEAVY_BASELINE_MEDIA,
  },
  target: "source.image",
  values: { default: SMALL_BASELINE_MEDIA, max: HEAVY_BASELINE_MEDIA, min: SMALL_BASELINE_MEDIA },
  workload: true,
  workloadFixture: buildHeavyBaselineWorkloadFixture("source.image"),
} as ToolcraftPerformanceScenario;

const CONTROL_SCENARIOS: readonly ToolcraftPerformanceScenario[] = [
  ...HALFTONE_CONTROL_CONFIGS.map(buildControlScenario),
  SOURCE_IMAGE_RANGE_SCENARIO,
];

const RENDERER_LEVEL_SCENARIOS: readonly ToolcraftPerformanceScenario[] = [
  {
    automated: true,
    automatedTestName:
      "engine: rendererPipeline recomputes deterministically for the same runtime state",
    browser: true,
    browserTestName: "browser perf: full redraw stays within budget at the heaviest combined state",
    budget: { maxLongTaskMs: 150, maxRenderMs: 500 },
    expectedObservable:
      "A full redraw (build-field + build-ramp + rasterize-glyphs) completes within budget at the heaviest combined product state.",
    fixture:
      "Largest useful grid (min cellWidth/cellAspect), P&L character set, max sizeSteps, 4K uploaded image, Silhouette mode.",
    id: "renderer.preview-stress",
    interaction: "preview-render",
    stress: true,
    stressFixture: {
      kind: "custom",
      loadProfile: fullyGuaranteedLoadProfile("renderer.preview-stress", "custom", {
        cellAspect: 0.8,
        cellWidth: 3,
        characterSet: "pnl",
        sizeSteps: 6,
        sourceMedia: HEAVY_BASELINE_MEDIA,
        sourceMode: "inflate",
      }),
      reason:
        "Combines every independent heavy state at once: max grid density, largest character set, most size steps, largest uploaded image, and Silhouette mode (which adds a distance-transform + blur pass on top of the sampling pass).",
      value: {
        cellAspect: 0.8,
        cellWidth: 3,
        characterSet: "pnl",
        sizeSteps: 6,
        sourceMedia: HEAVY_BASELINE_MEDIA,
        sourceMode: "inflate",
      },
    },
    values: {
      default: { cellAspect: 1.35, cellWidth: 16, characterSet: "binary", sizeSteps: 3, sourceMode: "bitmap" },
      max: {
        cellAspect: 0.8,
        cellWidth: 3,
        characterSet: "pnl",
        sizeSteps: 6,
        sourceMedia: HEAVY_BASELINE_MEDIA,
        sourceMode: "inflate",
      },
      min: { cellAspect: 2.2, cellWidth: 40, characterSet: "binary", sizeSteps: 1, sourceMode: "bitmap" },
    },
    workload: true,
  },
  {
    automated: true,
    automatedTestName:
      "engine: rendererPipeline recomputes deterministically for the same runtime state",
    browser: true,
    browserTestName: "browser perf: canvas viewport pan/zoom stays stable",
    budget: { maxFrameGapMs: 33 },
    expectedObservable:
      "Canvas viewport offset/zoom remain stable while the user pans the canvas; no recompute of build-field/build-ramp/rasterize-glyphs is required.",
    fixture: "Default product state; drag the canvas viewport.",
    id: "renderer.viewport-stability",
    interaction: "viewport-stability",
    workload: false,
  },
  {
    automated: true,
    automatedTestName:
      "engine: rendererPipeline recomputes deterministically for the same runtime state",
    browser: true,
    browserTestName: "browser perf: canvas zoom stays responsive at the heaviest combined state",
    budget: { maxFrameGapMs: 33, maxInteractionMs: 200, maxLongTaskMs: 150 },
    expectedObservable:
      "Toolbar zoom in/out stays responsive while the heaviest combined product state is displayed.",
    fixture: "Largest grid density, P&L character set, max sizeSteps, 4K uploaded image, Silhouette mode; use the real toolbar zoom controls.",
    id: "renderer.viewport-zoom-stress",
    interaction: "viewport-zoom-stress",
    stress: true,
    stressFixture: {
      kind: "custom",
      loadProfile: fullyGuaranteedLoadProfile("renderer.viewport-zoom-stress", "custom", {
        cellWidth: 3,
        sizeSteps: 6,
        sourceMedia: HEAVY_BASELINE_MEDIA,
      }),
      reason: "Detail-heavy custom renderer: zoom must stay responsive at the largest realistic combined workload.",
      value: {
        cellWidth: 3,
        sizeSteps: 6,
        sourceMedia: HEAVY_BASELINE_MEDIA,
      },
    },
    values: {
      default: { cellWidth: 16, sizeSteps: 3 },
      max: { cellWidth: 3, sizeSteps: 6, sourceMedia: HEAVY_BASELINE_MEDIA },
      min: { cellWidth: 40, sizeSteps: 1 },
    },
    workload: true,
  },
  {
    actionValue: "export.png",
    automated: true,
    automatedTestName:
      "engine: the sticky Export section exposes Export PNG and Copy Tokens actions",
    browser: true,
    browserTestName: "browser perf: Export PNG completes within budget",
    budget: { maxExportMs: 3000 },
    completionEvidence: "download",
    controlLabel: "Export PNG",
    expectedObservable: "Export PNG produces a downloaded PNG file within budget.",
    fixture: "Default product state; click Export PNG.",
    id: "output.export-png",
    interaction: "export-copy",
    workload: false,
  },
  {
    actionValue: "copy.tokens",
    automated: true,
    automatedTestName:
      "engine: the sticky Export section exposes Export PNG and Copy Tokens actions",
    browser: true,
    browserTestName: "browser perf: Copy Tokens completes within budget",
    budget: { maxExportMs: 1500 },
    completionEvidence: "clipboard",
    controlLabel: "Copy Tokens",
    expectedObservable: "Copy Tokens writes the current engine token JSON to the clipboard within budget.",
    fixture: "Default product state; click Copy Tokens.",
    id: "output.copy-tokens",
    interaction: "export-copy",
    workload: false,
  },
];

/* Render Pipeline Inventory
   ---------------------------------------------------------------
   The reference engine (src/app/halftone.ts) exposes four addressable
   stages. Nothing below changes its algorithm; this only names the
   existing stages so control-to-pass invalidation is machine-checkable.

   decode-media      -> new Image() from the uploaded dataUrl (cached by dataUrl)
   transform-media    -> bake mediaAssets[].transform (rotate/flip) onto an
                          offscreen canvas (cached by dataUrl+transform)
   build-field        -> renderScene / readKeyField+inflate / fieldFromImage
                          (produces the per-cell lum/dep/alive Field)
   build-ramp         -> buildRamp: per-cell glyph/alpha/size tone ramp
   rasterize-glyphs   -> drawHalftone: buckets cells by tone and fillText
                          draws each bucket once per (level, pool slot)
   export-composite   -> createToolcraftPngExportCanvas render callback */
export const appPerformance: ToolcraftPerformanceConfig = defineToolcraftPerformance({
  browserCheckPolicy: {
    fallbackRunner: "playwright",
    fallbackWhen: ["agent-browser-unavailable", "ci"],
    preferredRunner: "agent-browser",
  },
  rendererPipeline: {
    interactionInvalidation: [
      {
        interaction: "media-import",
        invalidates: ["decode-media", "transform-media", "build-field", "rasterize-glyphs"],
        mustNotInvalidate: ["build-ramp"],
        targets: ["source.image"],
      },
      {
        interaction: "control-drag",
        invalidates: ["build-field", "rasterize-glyphs"],
        mustNotInvalidate: ["build-ramp", "decode-media", "transform-media"],
        targets: [
          "placement.zoom",
          "placement.panX",
          "placement.panY",
          "silhouette.threshold",
          "silhouette.relief",
          "silhouette.occlusion",
          "silhouette.domeRadius",
          "light.rim",
          "light.dirX",
          "light.dirY",
          "light.dirZ",
          "tone.backgroundCutoff",
          "grid.cellWidth",
          "grid.cellAspect",
        ],
      },
      {
        interaction: "control-drag",
        invalidates: ["rasterize-glyphs"],
        mustNotInvalidate: ["build-field", "build-ramp", "decode-media", "transform-media"],
        targets: [
          "tone.blackPoint",
          "tone.whitePoint",
          "tone.gamma",
          "tone.dither",
          "tone.edgeLift",
          "character.size",
        ],
      },
      {
        interaction: "control-drag",
        invalidates: ["build-ramp", "rasterize-glyphs"],
        mustNotInvalidate: ["build-field", "decode-media", "transform-media"],
        targets: [
          "character.variety",
          "character.scale",
          "character.sizeVariation",
          "character.sizeSteps",
          "tone.steps",
        ],
      },
      {
        interaction: "control-change",
        invalidates: ["build-field", "rasterize-glyphs"],
        mustNotInvalidate: ["build-ramp", "decode-media", "transform-media"],
        targets: ["source.mode", "placement.fit", "silhouette.invert", "silhouette.showMask"],
      },
      {
        interaction: "control-change",
        invalidates: ["build-ramp", "rasterize-glyphs"],
        mustNotInvalidate: ["build-field", "decode-media", "transform-media"],
        targets: ["character.mode", "character.customChars", "character.weight"],
      },
      {
        interaction: "control-change",
        invalidates: ["rasterize-glyphs"],
        mustNotInvalidate: ["build-field", "build-ramp"],
        targets: ["appearance.ink", "appearance.background", "export.includeBackground"],
      },
      {
        interaction: "control-change",
        invalidates: ["export-composite"],
        mustNotInvalidate: ["build-field", "build-ramp", "rasterize-glyphs"],
        targets: ["export.image.format", "export.image.resolution"],
      },
      {
        interaction: "export",
        invalidates: ["export-composite"],
        mustNotInvalidate: [],
        targets: ["actions.output"],
      },
      {
        interaction: "viewport-drag",
        invalidates: [],
        mustNotInvalidate: ["decode-media", "transform-media", "build-field", "build-ramp", "rasterize-glyphs"],
        targets: ["canvas.viewport"],
      },
      {
        interaction: "viewport-zoom",
        invalidates: [],
        mustNotInvalidate: ["decode-media", "transform-media", "build-field", "build-ramp", "rasterize-glyphs"],
        targets: ["canvas.viewport"],
      },
    ],
    passes: [
      {
        cacheKey: ["mediaAssets[].dataUrl"],
        id: "decode-media",
        inputs: ["source.image"],
        invalidatedBy: ["source.image"],
        kind: "decode",
        output: "source",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: ["mediaAssets[].dataUrl", "mediaAssets[].transform"],
        id: "transform-media",
        inputs: ["decode-media"],
        invalidatedBy: ["source.image", "media.transform"],
        kind: "preprocess",
        output: "intermediate",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: [
          "source.mode",
          "grid.cellWidth",
          "grid.cellAspect",
          "canvas.size.width",
          "canvas.size.height",
        ],
        id: "build-field",
        inputs: [
          "transform-media",
          "source.mode",
          "placement.fit",
          "placement.zoom",
          "placement.panX",
          "placement.panY",
          "silhouette.threshold",
          "silhouette.invert",
          "silhouette.showMask",
          "silhouette.domeRadius",
          "silhouette.relief",
          "silhouette.occlusion",
          "tone.backgroundCutoff",
          "light.rim",
          "light.dirX",
          "light.dirY",
          "light.dirZ",
          "grid.cellWidth",
          "grid.cellAspect",
        ],
        invalidatedBy: [
          "source.mode",
          "placement.fit",
          "placement.zoom",
          "placement.panX",
          "placement.panY",
          "silhouette.threshold",
          "silhouette.invert",
          "silhouette.showMask",
          "silhouette.domeRadius",
          "silhouette.relief",
          "silhouette.occlusion",
          "tone.backgroundCutoff",
          "light.rim",
          "light.dirX",
          "light.dirY",
          "light.dirZ",
          "grid.cellWidth",
          "grid.cellAspect",
          "source.image",
          "media.transform",
          "canvas.size",
        ],
        kind: "pixel-transform",
        output: "intermediate",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: [
          "character.mode",
          "character.customChars",
          "character.weight",
          "character.sizeVariation",
          "character.sizeSteps",
          "character.variety",
          "tone.steps",
        ],
        id: "build-ramp",
        inputs: [
          "character.mode",
          "character.customChars",
          "character.weight",
          "character.sizeVariation",
          "character.sizeSteps",
          "character.variety",
          "tone.steps",
        ],
        invalidatedBy: [
          "character.mode",
          "character.customChars",
          "character.weight",
          "character.sizeVariation",
          "character.sizeSteps",
          "character.variety",
          "tone.steps",
        ],
        kind: "text-layout",
        output: "intermediate",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: ["build-field", "build-ramp", "grid.cellWidth", "grid.cellAspect", "canvas.renderScale"],
        id: "rasterize-glyphs",
        inputs: [
          "build-field",
          "build-ramp",
          "character.size",
          "appearance.ink",
          "appearance.background",
          "export.includeBackground",
          "canvas.renderScale",
          "tone.backgroundCutoff",
          "tone.blackPoint",
          "tone.whitePoint",
          "tone.gamma",
          "tone.dither",
          "tone.edgeLift",
          "grid.cellWidth",
          "grid.cellAspect",
        ],
        invalidatedBy: [
          "build-field",
          "build-ramp",
          "character.size",
          "appearance.ink",
          "appearance.background",
          "export.includeBackground",
          "canvas.renderScale",
          "tone.backgroundCutoff",
          "tone.blackPoint",
          "tone.whitePoint",
          "tone.gamma",
          "tone.dither",
          "tone.edgeLift",
          "grid.cellWidth",
          "grid.cellAspect",
        ],
        kind: "rasterize",
        output: "preview",
        quality: "preview",
        runsOn: "main",
      },
      {
        cacheKey: ["export.image.resolution", "export.includeBackground"],
        id: "export-composite",
        inputs: ["rasterize-glyphs", "export.image.format", "export.image.resolution", "export.includeBackground"],
        invalidatedBy: ["export.image.format", "export.image.resolution", "export.includeBackground", "export"],
        kind: "export",
        output: "export",
        quality: "export",
        runsOn: "export-only",
      },
    ],
  },
  rendererStrategy: "canvas-2d",
  rendererTechnique: {
    exportRenderer: "canvas-2d",
    fidelityRisks: [
      "Canvas fillText anti-aliasing differs slightly across browser/OS font-rendering stacks, so glyph edges are not byte-identical across machines even though the tone math is deterministic.",
    ],
    layers: [
      {
        content: ["text"],
        exportMode: "included",
        id: "halftone-glyphs",
        kind: "product-foreground",
        primitiveCount: "high",
        renderer: "canvas-2d",
        uiSelector: '[data-toolcraft-product-output]',
      },
    ],
    performanceRisks: [
      "Large grids near the 300x300 cell cap combined with a large character set and high sizeSteps increase both the tone-ramp combination count (build-ramp) and the number of buffered fillText calls per redraw (rasterize-glyphs).",
    ],
    previewRenderer: "canvas-2d",
    productRepresentation: "text",
    rendererStrategy: "canvas-2d",
    rendererWorkload: "text-output",
    sourceRepresentation: "mixed",
    whyNotAlternativeStrategies: [
      "This is a reference-runtime clone: the user directed that src/app/halftone.ts be typed as-is and not rewritten. Its output technique is Canvas 2D ctx.font/ctx.fillText glyph drawing, not a per-pixel shader/filter, so moving to WebGL/WebGPU would replace the reference algorithm rather than preserve it.",
      "DOM/SVG text would need one node per grid cell (up to 300x300 = 90,000 nodes) and would lose the single shared canvas + font/alpha bucketing the reference engine relies on to minimize context state changes.",
    ],
  },
  rendererWorkload: "text-output",
  scenarios: [...CONTROL_SCENARIOS, ...RENDERER_LEVEL_SCENARIOS],
  usesCustomRenderer: true,
  workloadTargets: [
    "source.mode",
    "source.image",
    "character.mode",
    "character.customChars",
    "character.size",
    "character.scale",
    "character.sizeVariation",
    "character.sizeSteps",
    "character.weight",
    "silhouette.domeRadius",
    "grid.cellWidth",
    "grid.cellAspect",
    "tone.steps",
    "export.image.resolution",
  ],
});
