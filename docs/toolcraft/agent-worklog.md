# Implementation Worklog

This file records product decisions and the evidence behind them. Keep it short, factual, and current. Update it after schema, renderer, timeline, layer, export, performance, or acceptance decisions.

## Status

Mode: product

Binary Halftone renders a procedural 3D scene or an uploaded image as a grid of glyphs. This is a reference-runtime-clone migration of the pre-existing framework-free `binary-halftone` engine (repo root) into this Toolcraft app.

## Decision Trail

### Iteration 1 - Type the engine, build schema/canvasContent/rendererPipeline

- Request: Migrate the existing ASCII-halftone renderer into Toolcraft. Type `src/app/halftone.ts` (the framework-free engine, copied in as-is) without changing its algorithm, then build the schema, canvasContent renderer, and a typed rendererPipeline around it. Move all app code that was previously hand-rolled (media upload, image/video export, persistence, preset transfer, canvas sizing/background/render scale) onto Toolcraft runtime surfaces instead of reimplementing it. Keep cellWidth/cellAspect as product controls and derive columns/rows from the runtime canvas size; drop autoFit/fitGridToMedia. Video-as-source was explicitly scoped out of this pass (user decision) in favor of scene + image sources.
- Task type: Reference-app port; schema, renderer, and performance authoring.
- User-visible result: The app shows a procedural raymarched scene by default, switches to a silhouette-inflate or bitmap-luminance render when an image is uploaded, and exposes Source/Placement/Silhouette/Character/Grid/Tone/Light/Ink/Background/Image Export controls plus sticky Export PNG and Copy Tokens actions.
- Source/reference checked: Repo root `App.jsx`, `src/halftone.js` (now `src/app/halftone.ts`), `video.js`, `README.md`.
- Reference inputs: The pre-migration DialKit build at the repository root (App.jsx / halftone.js / video.js / presets.js / README.md), used purely as source code to read, not as a moving-image/design reference; no Figma file was supplied for this pass. presets.js had already been removed before this pass began.
- Docs/contracts read: workflow.md, core/runtime-boundary.md, assembly-workflow.md, core/reference-study.md, core/control-selection.md, core/layout.md, core/performance.md, core/setup-export.md, core/media-upload.md, decision-contract.md, schema-reference.md, component-rules.md, renderer-technique.md, docs/toolcraft/performance.md, acceptance-testing.md.
- Contract rules applied: runtime-shell-required, canvas-no-app-ui, controls-section-inventory-required, controls-component-layout-invariants, output-export-required, renderer-technique-inventory, reference-clone-source-of-truth, persistence-policy-explicit, performance-coverage-levels.
- Decision: Keep `src/app/halftone.ts` byte-for-byte algorithmically identical to the reference engine, only adding TypeScript types (`Field`, `Tokens`, `Ramp`/`RampPool`/`RampCombo`, `PlaceOptions`, `SceneOptions`, `InflateOptions`, `KeyField`, `HalftoneSourceMedia`, `CanvasFactory`). Product code (`halftone-tokens.ts`, `halftone-field.ts`, `halftone-render.ts`, `halftone-canvas.tsx`, `halftone-export.ts`, `halftone-media.ts`) wraps the engine to read runtime state instead of DialKit dial values, without touching engine internals. `canvasContent` is a single React component (`HalftoneCanvas`) that reads `useToolcraft()` state and redraws on every state change; PNG export renders the same unmodified engine output into an offscreen canvas at `pixelRatio` and composites it into `createToolcraftPngExportCanvas`'s prepared context.
- Alternatives rejected: Rewriting the renderer to update `drawHalftone` in place to accept an externally-owned context (rejected: would touch the reference engine's function signature/side effects for no behavioral gain, and the offscreen-canvas + `drawImage` composite achieves the same result with zero engine changes). Rewriting the halftone technique in WebGL/WebGPU (rejected: the reference algorithm is Canvas 2D `ctx.font`/`ctx.fillText` glyph drawing, not a per-pixel filter; the user explicitly asked to keep the algorithm as-is).
- State/output mapping: Schema controls write to `state.values` under dot-namespaced targets (`source.*`, `placement.*`, `silhouette.*`, `character.*`, `grid.*`, `tone.*`, `light.*`, `appearance.*`); `getHalftoneTokens`/`getHalftoneSourceMode`/`getHalftonePlacement`/`getHalftoneSceneOptions`/`getHalftoneInflateOptions` map those values onto the engine's `Tokens`/options shapes. `computeHalftoneRenderPlan` derives `cols`/`rows` from `state.canvas.size` + `grid.cellWidth`/`grid.cellAspect`, builds the `Field` via `buildHalftoneField`, and both the live preview and PNG export call this same function so they render identically. Uploaded media comes from `state.mediaAssets` (target `source.image`); rotate/flip transforms are baked into an offscreen canvas before being handed to the unmodified engine functions.
- Files changed: `src/app/halftone.ts` (typed), `src/app/halftone-tokens.ts`, `src/app/halftone-field.ts`, `src/app/halftone-render.ts`, `src/app/halftone-media.ts`, `src/app/halftone-canvas.tsx`, `src/app/halftone-export.ts`, `src/app/app-schema.ts`, `src/app/app-composition.tsx`, `src/app/app-performance.ts`, `src/app/app-acceptance-data.ts`, `src/app/app-schema.test.ts`.
- Verification: `npx tsc -p tsconfig.json --noEmit` passes with zero errors. `npx vitest run src` passes except for the framework meta-tests that dynamically validate acceptance-row and performance-scenario coverage (expected: `appAcceptance`/`appPerformance.scenarios` are not yet populated — see Risks) and one pre-existing, unrelated Windows path-separator failure in `app-acceptance.framework-boundary.test.ts` that reproduces on a clean checkout before any of this pass's changes.
- Skipped checks: `npm run verify:ui` / `npm run verify:perf` / `npm run verify:final` were not run this pass; they require the acceptance rows and performance scenarios (with real backing Vitest/Playwright tests) described in Risks below, and `npm run test`'s `node --test scripts/*.test.mjs` step fails on this Windows environment for a pre-existing, unrelated reason (symlink `EPERM`; several framework test fixtures create symlinks, which requires Developer Mode or elevated privileges on Windows).
- Risks:
  - Risk: `appAcceptance` and `appPerformance.scenarios` are intentionally left empty in this pass. The schema has 40 visible product control targets; the contract requires one acceptance row and one performance scenario per target (each with real, passing, uniquely-named Vitest/Playwright evidence), plus renderer-level scenarios (preview-render stress, viewport-stability, viewport-zoom-stress, media-import, export-copy). `rendererPipeline`/`rendererTechnique` in `app-performance.ts` are fully specified so this remaining work has an exact, verified shape to fill in.
  - Risk: Two reference features were intentionally dropped rather than ported, both flagged in `appTransferMode.referenceFeatureInventory`: named built-in/saved presets with a share-link hash (replaced by Toolcraft's generic Settings Transfer + localStorage persistence — a real UX reduction, not a like-for-like port) and per-control keyboard shortcuts (no schema-level extension point exists in this Toolcraft runtime for product keyboard shortcuts).
  - Risk: `npm run verify:perf` has not produced a current-source receipt, so this is not yet a complete "first working product version" per the contract; `verify:final` will reject the missing/stale receipt until that checkpoint runs.

## Decisions

### Renderer

- Decision: Canvas 2D, reusing the reference engine's `drawHalftone` (glyph `fillText` drawing) unchanged; product code only supplies the field/tokens and composes the result into Toolcraft's canvas/export surfaces.
- Reason: The reference algorithm draws real monospace glyphs via `ctx.font`/`ctx.fillText`, not a per-pixel shader/filter; `productRepresentation: "text"` matches `rendererWorkload: "text-output"`, so no GPU-alternative evidence is structurally required. Rewriting to WebGL/WebGPU would replace the reference technique the user asked to keep as-is.
- Evidence: `src/app/halftone.ts` (unchanged engine), `src/app/halftone-canvas.tsx`, `src/app/halftone-export.ts`, `src/app/app-performance.ts` `rendererTechnique`/`rendererPipeline`.
- Known limitation: `app-performance.renderer-source.test.ts`'s `sourceUsesCpuPixelLoop()` check does a source-wide regex for `getImageData`/`putImageData`/`createImageData` and, if found anywhere, requires `rendererWorkload: "pixel-output"` and a WebGL/WebGPU strategy. The reference engine's `readKeyField`/`fieldFromImage` legitimately call `getImageData` once per source change to sample an uploaded image into the per-cell field (bounded to at most a ~600x600 supersampled key field); that is not the per-frame rendering technique, which remains Canvas 2D `fillText` glyph drawing. This is a known false-positive in that generated test's heuristic, not a reclassification of the app's real renderer; reclassifying to `pixel-output`/WebGL to satisfy the regex would misrepresent the actual architecture.

### Timeline

- Decision: No timeline (`panels.timeline` omitted); `animationIntent.mode: "none"`.
- Reason: This pass ships static scene/image sources only. Video-as-source (the one feature that would need transport) was explicitly deferred to a follow-up pass per an explicit scoping decision during this migration.
- Evidence: `src/app/app-schema.ts` (`panels.timeline` absent), `src/app/app-acceptance-data.ts` `appTransferMode.animationIntent`/`referenceTimeline`.

### Layers

- Decision: No layers (`panels.layers` omitted).
- Reason: The app edits one output surface (a single uploaded image feeding one renderer); there is no multi-object, multi-layer workflow.
- Evidence: `src/app/app-schema.ts` (`panels.layers` absent).

### Controls

- Decision: Group controls into Source, Placement, Silhouette, Character, Grid, Tone, Light, and Ink sections, plus the required Background and Image Export sections.
- Reason: Each section maps to one product/workflow entity from the reference app (source selection, media placement, silhouette shading, glyph ramp, grid sizing, tone mapping, lighting, ink color); dependent controls (e.g. Placement, Silhouette, Light) use `visibleWhen` against `source.mode` instead of always-visible dead controls.
- Evidence: `src/app/app-schema.ts`; `src/app/app-acceptance-data.ts` `appControlSectionInventory`.

### Export

- Decision: Still-image product; sticky `panelActions` expose Export PNG (`role: "export-image"`) and Copy Tokens (`role: "copy-output"`); no video export since there is no timeline.
- Reason: No animated output exists in this pass, so `Export Video` does not apply; Copy Tokens ports the reference app's "Copy tokens JSON" feature used to generate production assets offline.
- Evidence: `src/app/app-schema.ts` (Export section), `src/app/halftone-export.ts` (`exportHalftonePng`, `copyHalftoneTokens`), `src/app/app-composition.tsx` (`onPanelAction`).

### Performance

- Decision: Fully specify `rendererTechnique` and `rendererPipeline` (render passes `decode-media`/`transform-media`/`build-field`/`build-ramp`/`rasterize-glyphs`/`export-composite`, plus `interactionInvalidation`) this pass; defer populating the 40 per-control performance scenarios plus renderer-level scenarios (and their backing Vitest/Playwright tests) to a follow-up pass.
- Reason: The pipeline inventory only depends on the (now-typed, unchanged) engine's real call graph, which is stable and fully understood. The scenario matrix additionally requires ~40 real, uniquely-named, passing automated/browser tests (one per visible control) plus a real `npm run verify:perf` run; that is a large, separate, bounded piece of follow-up work.
- Evidence: `src/app/app-performance.ts`.

## Evidence

- Source reviewed: `App.jsx`, `src/halftone.js`/`src/app/halftone.ts`, `video.js`, `README.md` (repo root); `src/toolcraft/runtime` schema/state/export/testing modules (read directly to confirm control, canvas, media, export, and performance contract shapes).
- Contract applied: reference-clone-source-of-truth, runtime-shell-required, controls-section-inventory-required, output-export-required, renderer-technique-inventory, performance-coverage-levels, persistence-policy-explicit.

## Verification

- Run: `npx tsc -p tsconfig.json --noEmit` (passed, zero errors).
- Run: `npx vitest run src` (passed except the coverage meta-tests described in Risks, and one pre-existing unrelated Windows symlink failure).
- Not run: `npm run verify:ui`, `npm run verify:perf`, `npm run verify:final` (blocked on the acceptance/performance scenario matrix in Risks, and on this Windows environment's `node --test` symlink `EPERM` failures in unrelated framework fixtures).

## Risks

- Risk: `appAcceptance` and `appPerformance.scenarios` are empty; ~40 acceptance rows and ~40+ performance scenarios (each needing real passing Vitest/Playwright evidence) remain before `npm run verify:final` can pass. See Decision Trail Iteration 1 for the exact remaining shape.
- Risk: Named built-in/saved presets with a share-link and per-control keyboard shortcuts were intentionally dropped rather than ported (see `appTransferMode.referenceFeatureInventory` items `feature-presets`/no shortcut equivalent).
- Risk: `npm run verify:perf` has not been run, so no current-source performance receipt exists yet.
- Risk: `app-performance.renderer-source.test.ts`'s CPU-pixel-loop heuristic still fails because it flags any `getImageData` call in product source, including the reference engine's legitimate one-time image-sampling calls; see the Renderer decision's "Known limitation" note.
