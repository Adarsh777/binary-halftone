import { getHalftoneEngineTestName } from "./halftone-control-catalog";
import type {
  ToolcraftComponentAcceptance,
  ToolcraftControlSectionInventoryEntry,
  ToolcraftProductReadiness,
  ToolcraftTransferMode,
} from "./acceptance/types";

/* Reference: repo root (pre-migration DialKit build), inspected directly
   rather than run, since its UI depends on the `dialkit` package which is
   out of scope for this Toolcraft port:
   - App.jsx (DialKit controller wiring, tokensFrom, drawNow, media loading, presets)
   - halftone.js / now typed as src/app/halftone.ts (the engine, unchanged algorithm)
   - video.js (video-as-source transport + MediaRecorder capture)
   - README.md (documented behavior for character mode, size axis, video path) */
export const appTransferMode: ToolcraftTransferMode = {
  animationIntent: { mode: "none" },
  behaviorCoverage: ["control-mapping", "canvas-sizing", "export-copy", "media-lifecycle"],
  mode: "reference-runtime-clone",
  referenceFeatureInventory: [
    {
      acceptanceId: "source-scene",
      behaviorEvidence:
        "renderScene(W,H,{scene,yaw,pitch,rim,lightDir}) in src/app/halftone.ts is unchanged from src/halftone.js; only type annotations were added.",
      featureName: "Procedural scene source (raymarched sphere/torus/blob/stack)",
      id: "feature-source-scene",
      referenceBehavior:
        "App.jsx source.scene/yaw/pitch dials drove HT.renderScene() when source.mode === 'scene' or no media was loaded.",
      sourceEvidence: "App.jsx lines ~90-96, 229-236; src/halftone.js renderScene()/makeMap().",
      status: "ported",
      toolcraftMapping:
        "schema controls source.scene/source.yaw/source.pitch (visibleWhen source.mode='scene'), consumed by buildHalftoneField() -> renderScene().",
    },
    {
      acceptanceId: "source-silhouette",
      behaviorEvidence: "inflate()/readKeyField() unchanged; only type annotations were added.",
      featureName: "Silhouette inflate source (mask -> distance transform -> dome -> normals -> shade)",
      id: "feature-source-inflate",
      referenceBehavior:
        "App.jsx source.mode='inflate' branch built a key field from the uploaded media, then called HT.inflate() with threshold/domeRadius/relief/occlusion.",
      sourceEvidence: "App.jsx lines ~237-253; src/halftone.js inflate()/readKeyField()/distanceTransform()/boxBlur().",
      status: "ported",
      toolcraftMapping:
        "schema section Silhouette (silhouette.threshold/invert/showMask/domeRadius/relief/occlusion), visibleWhen source.mode='inflate'.",
    },
    {
      acceptanceId: "source-bitmap",
      behaviorEvidence: "fieldFromImage() unchanged; only type annotations were added.",
      featureName: "Bitmap luminance source",
      id: "feature-source-bitmap",
      referenceBehavior:
        "App.jsx source.mode='bitmap' branch called HT.fieldFromImage(media.el, cols, rows, place, tokens.bgCutoff, makeCanvas).",
      sourceEvidence: "App.jsx line ~255; src/halftone.js fieldFromImage().",
      status: "ported",
      toolcraftMapping: "schema mode option 'bitmap' ('Image'), consumed by buildHalftoneField().",
    },
    {
      acceptanceId: "character-ramp",
      behaviorEvidence: "buildRamp()/inkCoverage()/buildScaleAxis() unchanged; only type annotations were added.",
      featureName: "Tone-pooled character ramp (glyph/alpha/size combinations sampled by perceived ink)",
      id: "feature-character-ramp",
      referenceBehavior:
        "character.charMode/customChars/variety/charSize/sizeVariation/sizeSteps/weight drove tokensFrom() -> HT.buildRamp().",
      sourceEvidence: "App.jsx tokensFrom(); src/halftone.js buildRamp()/CHARSETS/resolveCharset().",
      status: "ported",
      toolcraftMapping:
        "schema section Character (character.mode/customChars/variety/size/sizeVariation/sizeSteps/weight) -> getHalftoneTokens() -> buildRamp().",
    },
    {
      acceptanceId: "grid-derived",
      behaviorEvidence:
        "User-directed model change: cellWidth/cellAspect stay product controls; columns/rows are derived from the runtime canvas size instead of being separate controls or an autoFit toggle.",
      featureName: "Grid sizing (autoFit toggle + explicit columns/rows sliders)",
      id: "feature-grid",
      referenceBehavior:
        "App.jsx grid.autoFit clamped columns/rows from the DialKit stage size minus a 40px margin, or used explicit grid.columns/grid.rows sliders when autoFit was off.",
      sourceEvidence: "App.jsx lines ~137-143, 201-207.",
      status: "intentionally-changed",
      toolcraftMapping:
        "getHalftoneGridSize() derives cols/rows from state.canvas.size and grid.cellWidth/cellAspect every redraw. autoFit and fitGridToMedia do not exist in this model.",
      userApprovedChangeReason:
        "Explicit user instruction for this migration: 'Grid model is already decided — do not re-derive it: keep cellWidth and cellAspect as product controls, and derive columns and rows from the runtime canvas size. Drop autoFit and fitGridToMedia; they no longer exist in this model.'",
    },
    {
      acceptanceId: "media-upload",
      behaviorEvidence:
        "fileDrop control (source.image) plus canvas.upload replace the custom <input type=file> + window dragover/drop listeners.",
      featureName: "Media upload (file input + window drag/drop)",
      id: "feature-media-upload",
      referenceBehavior:
        "App.jsx rendered a custom file input and window-level dragover/drop handlers that read the file via FileReader/Image or a <video> element.",
      sourceEvidence: "App.jsx lines ~324-395, 565-572.",
      status: "toolcraft-native",
      toolcraftMapping:
        "schema fileDrop control target source.image (assetKind: image) plus canvas.upload:true; runtime owns upload UI, drag/drop routing, and mediaAssets state.",
    },
    {
      acceptanceId: "export-png",
      behaviorEvidence:
        "createToolcraftPngExportCanvas + shouldIncludeToolcraftPreviewBackground replace the custom canvas.toDataURL/anchor-download modal.",
      featureName: "PNG export with a scale selector (1x-4x)",
      id: "feature-export-png",
      referenceBehavior:
        "App.jsx doExport() drew to a fresh canvas via HT.drawHalftone(..., {dpr: exportScale}) and showed a modal with a Download PNG link.",
      sourceEvidence: "App.jsx lines ~161-165, 526-539, 653-664.",
      status: "toolcraft-native",
      toolcraftMapping:
        "Required runtime Image Export section (export.image.format/resolution: 2K/4K/8K) plus sticky Export PNG action; halftone-export.ts composites the unmodified engine output through createToolcraftPngExportCanvas.",
    },
    {
      acceptanceId: "copy-tokens",
      behaviorEvidence: "copyHalftoneTokens() reuses the same tokens object shape as tokensFrom(), plus computed columns/rows.",
      featureName: "Copy tokens JSON to clipboard (for the offline asset-generation script)",
      id: "feature-copy-tokens",
      referenceBehavior: "App.jsx doCopy() wrote JSON.stringify(tokensFrom(cur)) plus columns/rows to the clipboard.",
      sourceEvidence: "App.jsx lines ~541-553; README.md 'Generating production assets'.",
      status: "ported",
      toolcraftMapping: "sticky panelActions 'Copy Tokens' (value copy.tokens, role copy-output) -> copyHalftoneTokens().",
    },
    {
      acceptanceId: "presets",
      behaviorEvidence:
        "User-directed model change: 'preset transfer' is runtime-owned, i.e. Toolcraft's settingsTransfer (Export Settings/Import Settings) and localStorage persistence, not an app-authored named-preset system.",
      featureName: "Named presets (built-in + saved + share-link hash + import/export JSON)",
      id: "feature-presets",
      referenceBehavior:
        "App.jsx/presets.js maintained built-in named presets, browser-saved presets, a location.hash share-link encoder/decoder, and JSON import/export of the whole saved-preset map.",
      sourceEvidence: "App.jsx lines ~447-524, 603-646 (presets.js was already removed from the repo before this pass).",
      status: "intentionally-changed",
      toolcraftMapping:
        "Runtime auto-injected Setup Export Settings/Import Settings plus schema persistence (localStorage) replace the custom preset system. There is no Toolcraft equivalent for named built-in presets or a shareable hash link; this is a real UX reduction, not a like-for-like port.",
      userApprovedChangeReason:
        "Explicit user instruction for this migration listed 'preset transfer' among the app code that 'must move to Toolcraft runtime surfaces, not be reimplemented.'",
    },
    {
      acceptanceId: "video-source",
      behaviorEvidence: "Not implemented this pass; scoping question answered explicitly during this migration.",
      featureName: "Video-as-source (upload/scrub/record a video into the halftone renderer)",
      id: "feature-video-source",
      referenceBehavior:
        "video.js + App.jsx supported uploading an .mp4/.webm/.mov, scrubbing/playing it, rebuilding the field every decoded frame, and recording the canvas via MediaRecorder.",
      sourceEvidence: "video.js (whole file); App.jsx lines ~271-353, 397-445, 575-601.",
      status: "intentionally-changed",
      toolcraftMapping:
        "Deferred. Requires its own Animation Intent Inventory, a referenceTimeline.mode ('custom-reference-timeline') decision, and a distinct renderer path (field rebuilt every frame instead of cached).",
      userApprovedChangeReason:
        "User was asked directly during this session whether to include video-as-source now or scope it to a follow-up, and chose to ship scene + image sources first.",
    },
  ],
  referenceName: "binary-halftone (root DialKit app: App.jsx / halftone.js / video.js / presets.js)",
  referenceStudy: {
    behaviorEvidence:
      "Traced every control in App.jsx's useDialKitController tree to its effect in tokensFrom()/drawNow(), and every exported halftone.js function to its call site, to confirm the ported engine's inputs/outputs match one-to-one.",
    referenceLocation: "Repository root: App.jsx, src/halftone.js (now src/app/halftone.ts), video.js, styles.css, README.md.",
    reproductionSteps:
      "Not run: the reference UI renders through the `dialkit` package (root package.json dependency), which is outside this Toolcraft port's scope. Source of every control, state ref, and draw path was read directly instead.",
    sourceEvidence:
      "Full read of App.jsx (681 lines), src/app/halftone.ts (592 lines, the unmodified engine), video.js (100 lines), and README.md's documented behavior sections (Video, Character mode, size axis, asset generation).",
    sourceOnlyReason:
      "The reference app's controls panel is rendered by the `dialkit` package, a UI library outside this migration's scope; restoring it would exercise DialKit's own rendering, not the halftone behavior being ported.",
    status: "source-inspection-only",
  },
  referenceTimeline: {
    behaviorCoverage: [],
    mode: "none",
  },
  sourceOfTruth: "reference-runtime",
};

export const appProductReadiness: ToolcraftProductReadiness = {
  mode: "product",
  productName: "Binary Halftone",
  productSummary:
    "Renders a procedural 3D scene or an uploaded image as a grid of glyphs, with tone carried by glyph choice, opacity, and character size.",
  requestedBehavior:
    "Port the existing framework-free binary-halftone engine into Toolcraft: type the engine as-is, then drive it entirely from Toolcraft schema controls, canvasContent, and runtime-owned upload/export/persistence/canvas-sizing surfaces.",
};

export const appControlSectionInventory: readonly ToolcraftControlSectionInventoryEntry[] = [
  {
    entity: "Source",
    groupingReason:
      "Mode selects which field pipeline runs; the fileDrop upload and the scene-only shape/yaw/pitch dials are the same source entity's dependent controls.",
    targets: ["source.mode", "source.image", "source.scene", "source.yaw", "source.pitch"],
    title: "Source",
    workflowStage: "source selection",
  },
  {
    entity: "Placement",
    groupingReason:
      "Fit/zoom/pan all describe how the uploaded image is sampled into the fixed-size grid; visible only when a media-driven source mode is active.",
    targets: ["placement.fit", "placement.zoom", "placement.panX", "placement.panY"],
    title: "Placement",
    workflowStage: "media placement",
  },
  {
    entity: "Silhouette",
    groupingReason:
      "Every control here tunes the single inflate() call (mask threshold, dome shape, relief, occlusion); visible only in Silhouette mode.",
    targets: [
      "silhouette.threshold",
      "silhouette.invert",
      "silhouette.showMask",
      "silhouette.domeRadius",
      "silhouette.relief",
      "silhouette.occlusion",
    ],
    title: "Silhouette",
    workflowStage: "silhouette shaping",
  },
  {
    entity: "Character",
    groupingReason:
      "Character set, variety, and the three size-axis controls together determine the tone ramp's glyph/alpha/size combinations.",
    targets: [
      "character.mode",
      "character.customChars",
      "character.variety",
      "character.size",
      "character.sizeVariation",
      "character.sizeSteps",
      "character.weight",
    ],
    title: "Character",
    workflowStage: "glyph ramp",
  },
  {
    entity: "Grid",
    groupingReason:
      "Cell width and cell aspect are the only product-owned grid controls; columns/rows are derived from the runtime canvas size.",
    targets: ["grid.cellWidth", "grid.cellAspect"],
    title: "Grid",
    workflowStage: "grid sizing",
  },
  {
    entity: "Tone",
    groupingReason:
      "All seven controls remap the same per-cell luminance value produced by the active source (cutoff, level count, black/white points, gamma, dither, edge lift).",
    targets: [
      "tone.backgroundCutoff",
      "tone.steps",
      "tone.blackPoint",
      "tone.whitePoint",
      "tone.gamma",
      "tone.dither",
      "tone.edgeLift",
    ],
    title: "Tone",
    workflowStage: "tone mapping",
  },
  {
    entity: "Light",
    groupingReason:
      "Rim and the XYZ light direction feed the same shade() call used by both the procedural scene and the silhouette dome; hidden for the bitmap source, which has no normals.",
    targets: ["light.rim", "light.dirX", "light.dirY", "light.dirZ"],
    title: "Light",
    workflowStage: "lighting",
  },
  {
    entity: "Ink",
    groupingReason: "Foreground glyph color is the entire semantic content of this section.",
    targets: ["appearance.ink"],
    title: "Ink",
    workflowStage: "color",
  },
  {
    entity: "Background",
    groupingReason:
      "Required runtime Background section: the Include switch and the product's own background color control for preview/export.",
    targets: ["export.includeBackground", "appearance.background"],
    title: "Background",
    workflowStage: "output background",
  },
  {
    entity: "Image Export",
    groupingReason: "Required runtime Image Export section: PNG/JPG format and 2K/4K/8K resolution.",
    targets: ["export.image.format", "export.image.resolution"],
    title: "Image Export",
    workflowStage: "output export settings",
  },
] as const;

export const appAcceptance: readonly ToolcraftComponentAcceptance[] = [
  // ---------- Source ----------
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("source.mode"),
    browser: true,
    browserTestName: "browser: source.mode changes rendered output",
    componentType: "select",
    evidence: "product-output",
    expectedObservable:
      "Switching Mode between Scene, Silhouette, and Image swaps which per-cell field pipeline (raymarch, silhouette inflate, or bitmap luminance) drives the rendered glyph grid.",
    fixture:
      "Default product state with a small uploaded source image attached; select each Mode option from the combobox.",
    id: "source.mode",
    kind: "control",
    optionCoverage: ["scene", "inflate", "bitmap"],
    target: "source.mode",
    userAction: "Open the Mode select and choose Scene, Silhouette, or Image.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("source.image"),
    browser: true,
    browserTestName: "browser: source.image lifecycle covers upload, rotate, flip, remove, and reset",
    componentType: "fileDrop",
    evidence: "media-lifecycle",
    expectedObservable:
      "Uploading an image attaches it as the Silhouette/Image source and changes the rendered glyph grid; rotate/flip update the baked media transform and visibly change the render; removing the image or resetting the Source section clears it and reverts output.",
    fixture:
      "Upload a real, decodable oriented PNG fixture (distinct quadrant colors so rotation/flip are observable) while Mode is Image; use the runtime's built-in rotate (\"90° Right\"), flip (\"Flip horizontal\"), remove (\"Remove image\"), and per-section Reset (\"Reset Source section\") actions.",
    id: "source.image",
    kind: "control",
    mediaLifecycleCoverage: ["upload", "remove", "reset", "rotate", "flip", "transform-output"],
    target: "source.image",
    userAction:
      "Drop or browse an image file into the Image control, then use its rotate/flip actions, its Remove action, or the Source section's Reset action.",
    visibilityCoverage: "all-conditional-visibility",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("source.scene"),
    browser: true,
    browserTestName: "browser: source.scene changes rendered output",
    componentType: "select",
    evidence: "product-output",
    expectedObservable:
      "Selecting a different Shape (Stack/Sphere/Torus/Blob) changes the raymarched distance field and the rendered glyph grid.",
    fixture: "Default product state (Scene mode); select each Shape option from the combobox.",
    id: "source.scene",
    kind: "control",
    optionCoverage: ["stack", "sphere", "torus", "blob"],
    target: "source.scene",
    userAction: "Open the Shape select and choose a different shape.",
    visibilityCoverage: "all-conditional-visibility",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("source.yaw"),
    browser: true,
    browserTestName: "browser: source.yaw changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Yaw rotates the camera around the procedural scene, changing the rendered glyph grid.",
    fixture: "Default product state (Scene mode); drag the Yaw slider.",
    id: "source.yaw",
    kind: "control",
    target: "source.yaw",
    userAction: "Drag the Yaw slider.",
    visibilityCoverage: "all-conditional-visibility",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("source.pitch"),
    browser: true,
    browserTestName: "browser: source.pitch changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Pitch tilts the camera over the procedural scene, changing the rendered glyph grid.",
    fixture: "Default product state (Scene mode); drag the Pitch slider.",
    id: "source.pitch",
    kind: "control",
    target: "source.pitch",
    userAction: "Drag the Pitch slider.",
    visibilityCoverage: "all-conditional-visibility",
  },

  // ---------- Placement ----------
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("placement.fit"),
    browser: true,
    browserTestName: "browser: placement.fit changes rendered output",
    componentType: "select",
    evidence: "product-output",
    expectedObservable:
      "Selecting a different Fit (Contain/Cover/Stretch) changes how the uploaded image is sampled into the fixed-size grid, changing the rendered glyph grid.",
    fixture:
      "Silhouette mode with a small uploaded source image attached; select each Fit option from the combobox.",
    id: "placement.fit",
    kind: "control",
    optionCoverage: ["contain", "cover", "stretch"],
    target: "placement.fit",
    userAction: "Open the Fit select and choose a different fit mode.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("placement.zoom"),
    browser: true,
    browserTestName: "browser: placement.zoom changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Zoom rescales how the uploaded image is sampled into the grid, changing the rendered glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Zoom slider.",
    id: "placement.zoom",
    kind: "control",
    target: "placement.zoom",
    userAction: "Drag the Zoom slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("placement.panX"),
    browser: true,
    browserTestName: "browser: placement.panX changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Pan X shifts the sampled image horizontally within the grid, changing the rendered glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Pan X slider.",
    id: "placement.panX",
    kind: "control",
    target: "placement.panX",
    userAction: "Drag the Pan X slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("placement.panY"),
    browser: true,
    browserTestName: "browser: placement.panY changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Pan Y shifts the sampled image vertically within the grid, changing the rendered glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Pan Y slider.",
    id: "placement.panY",
    kind: "control",
    target: "placement.panY",
    userAction: "Drag the Pan Y slider.",
  },

  // ---------- Silhouette ----------
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.threshold"),
    browser: true,
    browserTestName: "browser: silhouette.threshold changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Threshold moves the mask boundary through the key field, changing which cells classify as inside/outside the silhouette and changing the rendered glyph grid.",
    fixture:
      "Silhouette mode with an uploaded vertical grayscale gradient image at Cover fit and zoom >= 1 (full-bleed, no transparent letterbox, so the mask reads real RGB luminance instead of collapsing to alpha); drag the Threshold slider.",
    id: "silhouette.threshold",
    kind: "control",
    target: "silhouette.threshold",
    userAction: "Drag the Threshold slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.invert"),
    browser: true,
    browserTestName: "browser: silhouette.invert changes rendered output",
    componentType: "switch",
    evidence: "product-output",
    expectedObservable:
      "Toggling Invert swaps which side of the mask boundary is treated as the silhouette subject, changing the rendered glyph grid.",
    fixture:
      "Silhouette mode with an uploaded vertical grayscale gradient image at Cover fit and zoom >= 1 (full-bleed, so the flip is a real partial-mask swap rather than a full-frame flood that inflate()'s border heuristic auto-corrects back to the original); toggle the Invert switch.",
    id: "silhouette.invert",
    kind: "control",
    target: "silhouette.invert",
    userAction: "Toggle the Invert switch.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.showMask"),
    browser: true,
    browserTestName: "browser: silhouette.showMask changes rendered output",
    componentType: "switch",
    evidence: "product-output",
    expectedObservable:
      "Toggling Mask Preview swaps the shaded dome render for a flat mask fill, changing the rendered glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; toggle the Mask Preview switch.",
    id: "silhouette.showMask",
    kind: "control",
    target: "silhouette.showMask",
    userAction: "Toggle the Mask Preview switch.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.domeRadius"),
    browser: true,
    browserTestName: "browser: silhouette.domeRadius changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Dome Radius changes the box-blur kernel radius used to build the dome height field, changing the rendered glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Dome Radius slider.",
    id: "silhouette.domeRadius",
    kind: "control",
    target: "silhouette.domeRadius",
    userAction: "Drag the Dome Radius slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.relief"),
    browser: true,
    browserTestName: "browser: silhouette.relief changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Relief rescales the dome's normal steepness, changing the rendered shading and glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Relief slider.",
    id: "silhouette.relief",
    kind: "control",
    target: "silhouette.relief",
    userAction: "Drag the Relief slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("silhouette.occlusion"),
    browser: true,
    browserTestName: "browser: silhouette.occlusion changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Occlusion rescales the ambient-occlusion term, changing the rendered shading and glyph grid.",
    fixture: "Silhouette mode with a small uploaded source image attached; drag the Occlusion slider.",
    id: "silhouette.occlusion",
    kind: "control",
    target: "silhouette.occlusion",
    userAction: "Drag the Occlusion slider.",
  },

  // ---------- Character ----------
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.mode"),
    browser: true,
    browserTestName: "browser: character.mode changes rendered output",
    componentType: "select",
    evidence: "product-output",
    expectedObservable:
      "Selecting a different Character Set changes which glyphs the tone ramp draws from, changing the rendered glyph grid.",
    fixture: "Default product state; select each Character Set option from the combobox.",
    id: "character.mode",
    kind: "control",
    optionCoverage: ["binary", "digits", "pnl", "custom"],
    target: "character.mode",
    userAction: "Open the Character Set select and choose a different set.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.customChars"),
    browser: true,
    browserTestName: "browser: character.customChars changes rendered output",
    componentType: "text",
    evidence: "product-output",
    expectedObservable:
      "Typing a different Custom Characters list changes which glyphs the tone ramp draws from, changing the rendered glyph grid.",
    fixture: "Character Set switched to Custom; type a different character list into the text field.",
    id: "character.customChars",
    kind: "control",
    target: "character.customChars",
    userAction: "Type into the Custom Characters field.",
    visibilityCoverage: "all-conditional-visibility",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.variety"),
    browser: true,
    browserTestName: "browser: character.variety changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Variety widens or narrows the tolerance used to vary glyphs within a tone step, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Variety slider.",
    id: "character.variety",
    kind: "control",
    target: "character.variety",
    userAction: "Drag the Variety slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.size"),
    browser: true,
    browserTestName: "browser: character.size changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Size changes the rasterized glyph fill fraction, changing the rendered glyph grid.",
    fixture:
      "Default product state; drag the Size slider to a value below the engine's fill clamp ceiling of 1 (the schema's 0.3-2.5 range, ported as-is from the reference dial config, clamps identically above 1 in halftone-draw.ts, so only the sub-1 sub-range is visibly distinct from the 1.05 default).",
    id: "character.size",
    kind: "control",
    target: "character.size",
    userAction: "Drag the Size slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.sizeVariation"),
    browser: true,
    browserTestName: "browser: character.sizeVariation changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Size Variation changes the ramp's scale axis, changing the (glyph, alpha, size) combinations drawn and the rendered glyph grid.",
    fixture: "Default product state; drag the Size Variation slider.",
    id: "character.sizeVariation",
    kind: "control",
    target: "character.sizeVariation",
    userAction: "Drag the Size Variation slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.sizeSteps"),
    browser: true,
    browserTestName: "browser: character.sizeSteps changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Size Steps changes how many scale steps the ramp measures, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Size Steps slider.",
    id: "character.sizeSteps",
    kind: "control",
    target: "character.sizeSteps",
    userAction: "Drag the Size Steps slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("character.weight"),
    browser: true,
    browserTestName: "browser: character.weight changes rendered output",
    componentType: "select",
    evidence: "product-output",
    expectedObservable:
      "Selecting a different Weight changes glyph ink-coverage measurement and the rasterized font weight, changing the rendered glyph grid.",
    fixture:
      "Default product state; select each Weight option from the combobox (the loaded monospace font stack only has true Regular/Bold faces, so Light/Regular/Medium render identically and Bold is the only visually-distinct non-default choice; see halftone-control-catalog.ts).",
    id: "character.weight",
    kind: "control",
    optionCoverage: ["300", "400", "500", "700"],
    target: "character.weight",
    userAction: "Open the Weight select and choose a different weight.",
  },

  // ---------- Grid ----------
  // Columns/rows are derived from the runtime canvas size (grid model
  // settled in Decision Trail Iteration 1) and have no schema control of
  // their own; only cellAspect/cellWidth are real product controls. See
  // "browser: shrinking the runtime canvas width changes the derived grid
  // and rendered output" and the accompanying engine test for the
  // canvas-size-reactivity proof.
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("grid.cellAspect"),
    browser: true,
    browserTestName: "browser: grid.cellAspect changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Cell Aspect changes the derived row count for the current canvas size, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Cell Aspect slider.",
    id: "grid.cellAspect",
    kind: "control",
    target: "grid.cellAspect",
    userAction: "Drag the Cell Aspect slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("grid.cellWidth"),
    browser: true,
    browserTestName: "browser: grid.cellWidth changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Cell Width changes the derived column count for the current canvas size, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Cell Width slider.",
    id: "grid.cellWidth",
    kind: "control",
    target: "grid.cellWidth",
    userAction: "Drag the Cell Width slider.",
  },

  // ---------- Tone ----------
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.backgroundCutoff"),
    browser: true,
    browserTestName: "browser: tone.backgroundCutoff changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Background Cutoff changes which bitmap-source cells classify as background, changing the rendered glyph grid.",
    fixture:
      "Image (bitmap) mode with an uploaded full-range gradient at Cover fit and zoom >= 1 (drawHalftone only applies backgroundCutoff when the field has no depth, so Scene/Silhouette modes never show an effect and a uniform fixture has no luminance range for the cutoff to gate); drag the Background Cutoff slider.",
    id: "tone.backgroundCutoff",
    kind: "control",
    target: "tone.backgroundCutoff",
    userAction: "Drag the Background Cutoff slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.steps"),
    browser: true,
    browserTestName: "browser: tone.steps changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Levels changes how many tone-ramp levels are built and drawn, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Levels slider.",
    id: "tone.steps",
    kind: "control",
    target: "tone.steps",
    userAction: "Drag the Levels slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.blackPoint"),
    browser: true,
    browserTestName: "browser: tone.blackPoint changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Black Point remaps the tone curve's black end, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Black Point slider.",
    id: "tone.blackPoint",
    kind: "control",
    target: "tone.blackPoint",
    userAction: "Drag the Black Point slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.whitePoint"),
    browser: true,
    browserTestName: "browser: tone.whitePoint changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging White Point remaps the tone curve's white end, changing the rendered glyph grid.",
    fixture: "Default product state; drag the White Point slider.",
    id: "tone.whitePoint",
    kind: "control",
    target: "tone.whitePoint",
    userAction: "Drag the White Point slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.gamma"),
    browser: true,
    browserTestName: "browser: tone.gamma changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable: "Dragging Gamma remaps the tone curve, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Gamma slider.",
    id: "tone.gamma",
    kind: "control",
    target: "tone.gamma",
    userAction: "Drag the Gamma slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.dither"),
    browser: true,
    browserTestName: "browser: tone.dither changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Dither changes the per-cell ordered-dither offset, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Dither slider.",
    id: "tone.dither",
    kind: "control",
    target: "tone.dither",
    userAction: "Drag the Dither slider.",
  },
  {
    automated: true,
    automatedTestName: getHalftoneEngineTestName("tone.edgeLift"),
    browser: true,
    browserTestName: "browser: tone.edgeLift changes rendered output",
    componentType: "slider",
    evidence: "product-output",
    expectedObservable:
      "Dragging Edge Lift changes how much the edge sample lifts the tone value, changing the rendered glyph grid.",
    fixture: "Default product state; drag the Edge Lift slider.",
    id: "tone.edgeLift",
    kind: "control",
    target: "tone.edgeLift",
    userAction: "Drag the Edge Lift slider.",
  },
];
