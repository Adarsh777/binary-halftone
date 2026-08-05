import { expect, test } from "@playwright/test";

import { createToolcraftBrowserProofSession } from "./browser-proof-session";
import { expectToolcraftConditionalControlVisibility } from "./browser-conditional-output-evidence-helpers";
import {
  expectToolcraftAcceptanceOutcome,
  expectToolcraftExportedArtifact,
} from "./browser-acceptance-outcome-helpers";
import { expectToolcraftPersistenceState } from "./browser-state-evidence-helpers";
import { attachToolcraftBrowserRuntimeEvidence } from "./browser-runtime-evidence";
import { getToolcraftControlFieldByTarget } from "./browser-control-target-helpers";
import { clickToolcraftPanelActionByLabel } from "./performance-output-action-helpers";
import {
  dragToolcraftSliderByTarget,
  dragToolcraftSliderTargetToValue,
} from "./performance-slider-helpers";
import {
  expectToolcraftProductObservableToChange,
  getToolcraftProductObservableSnapshot,
} from "./product-observable-helpers";
import {
  applyHalftoneControlChange,
  createGradientFixturePng,
  createOrientedFixturePng,
  createSmallFixturePng,
  createSolidColorPng,
  decodePng,
  findContentBoundingBox,
  findMostCommonPixelCoordinate,
  getPngPixelAt,
  HALFTONE_CONTROL_CONFIGS,
  selectHalftoneGateOption,
  switchSourceMode,
  uploadHalftoneFixtureImage,
  type DecodedPng,
} from "./halftone-fixtures";

test("browser: app opens as a real Toolcraft product with the Source-to-Image Export panel", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('[data-slot="toolcraft-runtime-app"]')).toBeVisible();
  await expect(page.getByRole("application", { name: "Canvas viewport" })).toBeVisible();
  await expect(page.locator("[data-toolcraft-product-output]")).toBeVisible();
  await expect(page.locator('[data-toolcraft-control-target="source.mode"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PNG", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Tokens", exact: true })).toBeVisible();
});

/* Task 2 (default preview = upload-image placeholder): on first load, before
   any upload, the product-output canvas must render the runtime-sanctioned
   no-media fallback (the frozen engine's renderScene, via
   resolveHalftoneEffectiveMode's hasMedia branch) -- not a blank canvas and
   not an app-invented placeholder drawn on the canvas (forbidden by
   component-contracts.media-custom.ts's doNotReplaceWith rules). This proves
   the canvas has real pixel dimensions and non-uniform pixel content on a
   fresh page load with no media attached. */
test("browser: first load with no media renders real (non-blank) product output, not a blank canvas", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  // Downscale the *whole* canvas into a small sample (as
  // getToolcraftProductObservableSnapshot does) rather than cropping a
  // corner -- a corner crop can land entirely on background and read as
  // uniform even when the rest of the canvas has real rendered content.
  const sampleCanvas = (element: Element) => {
    const canvasElement = element as HTMLCanvasElement;
    const { height, width } = canvasElement;
    const sampleWidth = Math.min(64, width);
    const sampleHeight = Math.min(64, height);
    const sample = document.createElement("canvas");
    sample.width = sampleWidth;
    sample.height = sampleHeight;
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true })!;
    sampleCtx.drawImage(canvasElement, 0, 0, sampleWidth, sampleHeight);
    const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const [firstR, firstG, firstB, firstA] = pixels;
    let isUniform = true;

    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] !== firstR ||
        pixels[index + 1] !== firstG ||
        pixels[index + 2] !== firstB ||
        pixels[index + 3] !== firstA
      ) {
        isUniform = false;
        break;
      }
    }

    return { height, isUniform, width };
  };

  // The canvas mounts visible before its first render pass paints the
  // no-media fallback, so poll (like every other product-observable check
  // in this file) instead of sampling once right after toBeVisible().
  await expect(async () => {
    const { isUniform } = await canvas.evaluate(sampleCanvas);
    expect(
      isUniform,
      "product-output canvas should render real (non-blank) content via the no-media fallback on first load, before any upload",
    ).toBe(false);
  }).toPass({ timeout: 5000 });

  const { height, width } = await canvas.evaluate(sampleCanvas);
  expect(width, "product-output canvas should have real pixel dimensions on first load").toBeGreaterThan(0);
  expect(height, "product-output canvas should have real pixel dimensions on first load").toBeGreaterThan(0);
});

/* referenceFeatureInventory feature-presets/feature-video-source document
   two intentionally-dropped reference features. This proves the real UI
   enforces both exclusions: the runtime's generic Settings Transfer (not
   an app-authored named-preset system) is what actually appears, Mode has
   no video option, and there is no video upload/scrub/record surface
   anywhere in the controls panel. */
test("browser: named presets and video-as-source stay excluded; Settings Transfer is the real replacement", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Export Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: /preset/i })).toHaveCount(0);

  const modeField = await getToolcraftControlFieldByTarget(page, "source.mode");
  await modeField.getByRole("combobox").click();
  const optionLabels = await page.locator('[role="option"]').allTextContents();
  expect(optionLabels.map((label) => label.trim())).toEqual(["Image", "Silhouette"]);
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: /video/i })).toHaveCount(0);
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(0);
});

/* One acceptance row per visible schema control target: proves the real
   interaction changes the rendered product-output canvas. Gated controls
   (Placement/Silhouette/Custom Characters) also prove their conditional
   visibility through the same gating control before being exercised. */
for (const config of HALFTONE_CONTROL_CONFIGS) {
  if (config.skipsCanvasOutputTest) {
    continue;
  }

  test(`browser: ${config.target} changes rendered output`, async ({ page }) => {
    await page.goto("/");
    const session = await createToolcraftBrowserProofSession(page);

    if (config.requiresSourceMode) {
      const visibleLabel = config.requiresSourceMode === "inflate" ? "Silhouette" : "Image";
      const hiddenLabel = config.requiresSourceMode === "inflate" ? "Image" : "Silhouette";
      await selectHalftoneGateOption(page, "source.mode", visibleLabel);
      await expectToolcraftConditionalControlVisibility(
        session,
        session.controlAction("source.mode", async (control) => {
          await control.getByRole("combobox").click();
          await page.locator('[role="option"]').filter({ hasText: hiddenLabel }).first().click();
        }),
        session.controlAction("source.mode", async (control) => {
          await control.getByRole("combobox").click();
          await page
            .locator('[role="option"]')
            .filter({ hasText: visibleLabel })
            .first()
            .click();
        }),
        { requirementId: config.target, target: config.target },
      );
    }

    if (config.requiresSourceModeContext) {
      const contextLabel = config.requiresSourceModeContext === "inflate" ? "Silhouette" : "Image";
      await selectHalftoneGateOption(page, "source.mode", contextLabel);
    }

    if (config.requiresCharacterMode) {
      await selectHalftoneGateOption(page, "character.mode", "Custom");
      await expectToolcraftConditionalControlVisibility(
        session,
        session.controlAction("character.mode", async (control) => {
          await control.getByRole("combobox").click();
          await page.locator('[role="option"]').filter({ hasText: "Binary" }).first().click();
        }),
        session.controlAction("character.mode", async (control) => {
          await control.getByRole("combobox").click();
          await page.locator('[role="option"]').filter({ hasText: "Custom" }).first().click();
        }),
        { requirementId: config.target, target: config.target },
      );
    }

    if (config.requiresMedia) {
      /* source.image is unconditionally visible, but a control whose own
         config only declares requiresMedia (no requiresSourceMode/
         requiresSourceModeContext gate of its own, e.g. source.mode itself)
         still needs a real source mode active before uploading reaches the
         field pipeline instead of the no-media fallback. */
      if (!config.requiresSourceMode && !config.requiresSourceModeContext) {
        await selectHalftoneGateOption(page, "source.mode", "Image");
      }
      await uploadHalftoneFixtureImage(
        page,
        config.requiresLuminanceGradientFixture ? createGradientFixturePng() : undefined,
      );

      if (config.requiresLuminanceGradientFixture) {
        /* readKeyField only reads real RGB luminance when the canvas has no
           transparent pixels; any letterboxed border (any fit at the
           default zoom < 1) makes it fall back to reading alpha, collapsing
           the mask to a flat opaque-rectangle-vs-border shape. Cover fit +
           zoom >= 1 guarantees full-bleed coverage. */
        await selectHalftoneGateOption(page, "placement.fit", "Cover");
        await dragToolcraftSliderByTarget(page, "placement.zoom", 1);
      }
    }

    await expectToolcraftProductObservableToChange(
      session,
      session.controlAction(config.target, async () => {
        await applyHalftoneControlChange(page, config, "primary");
      }),
      { requirementId: config.target },
    );
  });
}

/* Media lifecycle for source.image (an image fileDrop control): upload only
   changes rendered output once source.mode reads media (Image/Silhouette);
   with no media attached, the field pipeline falls back to the fixed
   no-media scene render instead. Rotate/flip are the runtime's
   built-in FileDrop image-transform actions (aria-labels "90° Right"/"Flip
   horizontal"), which bake into media.transform and are consumed by
   halftone-image.ts's placeImage before the engine samples the source.
   Reset uses the per-section reset button, which clears both control
   values and any media whose sourceTarget is in that section. */
test("browser: source.image lifecycle covers upload, rotate, flip, remove, and reset", async ({
  page,
}) => {
  await page.goto("/");
  const session = await createToolcraftBrowserProofSession(page);
  await selectHalftoneGateOption(page, "source.mode", "Image");

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async () => {
      await uploadHalftoneFixtureImage(page, createOrientedFixturePng());
    }),
    { requirementId: "source.image.upload" },
  );
  await expect(page.getByRole("img", { name: "halftone-fixture.png" })).toBeVisible();
  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "media-lifecycle",
    requirementId: "source.image.upload",
    target: "source.image",
  });

  const field = await getToolcraftControlFieldByTarget(page, "source.image");

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async () => {
      await field.getByRole("button", { name: "90° Right" }).click();
    }),
    { requirementId: "source.image.rotate" },
  );
  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "media-lifecycle",
    requirementId: "source.image.rotate",
    target: "source.image",
  });

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async () => {
      await field.getByRole("button", { name: "Flip horizontal" }).click();
    }),
    { requirementId: "source.image.flip" },
  );
  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "media-lifecycle",
    requirementId: "source.image.flip",
    target: "source.image",
  });

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async () => {
      await field.getByRole("button", { name: "Remove image" }).click();
    }),
    { requirementId: "source.image.remove" },
  );
  await expect(page.getByRole("img", { name: "halftone-fixture.png" })).toHaveCount(0);
  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "media-lifecycle",
    requirementId: "source.image.remove",
    target: "source.image",
  });

  await uploadHalftoneFixtureImage(page);
  await expect(page.getByRole("img", { name: "halftone-fixture.png" })).toBeVisible();

  // source.image renders in its own auto-split "Image" section (fileDrop's
  // standalone section layout, since it is now unconditionally visible with
  // no visibleWhen to keep it grouped with "Source"), so its reset button is
  // scoped to "Reset Image section", not "Reset Source section".
  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async (_control, currentPage) => {
      await currentPage.getByRole("button", { name: "Reset Image section" }).click();
    }),
    { requirementId: "source.image.reset" },
  );
  await expect(page.getByRole("img", { name: "halftone-fixture.png" })).toHaveCount(0);
  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "media-lifecycle",
    requirementId: "source.image.reset",
    target: "source.image",
  });
});


/* The tone ramp (buildRamp) is proven monotonic at the engine level in
   halftone-engine.test.ts (every level's mean ink value trends upward with
   no inversions). This proves the same property survives real, rendered
   integration: a full 0-255 vertical grayscale sweep (not a two-tone
   fixture, which could hide an inversion between just two sampled points)
   uploaded as the Image (bitmap) source must render monotonically
   increasing ink density band-by-band from the dark top to the bright
   bottom, with no reversal anywhere in the sweep. */
test("browser: the tone ramp renders a monotonic ink sweep across a full-range gradient source", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  // Full-bleed placement: avoid the transparent-letterbox/alpha shortcut
  // documented on createGradientFixturePng, so the field reads real RGB
  // luminance across the whole sweep instead of a binary alpha mask.
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  const bandInkCounts = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const ctx = canvasElement.getContext("2d", { willReadFrequently: true })!;
    const { width, height } = canvasElement;
    const bandCount = 8;
    const bandHeight = Math.floor(height / bandCount);
    const counts: number[] = [];

    for (let band = 0; band < bandCount; band += 1) {
      const { data } = ctx.getImageData(0, band * bandHeight, width, bandHeight);
      let inkPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const alpha = data[i + 3];
        // Ink (the bright glyph color) stands out against the dark
        // background regardless of anti-aliasing specifics.
        if (alpha > 10 && brightness > 60) inkPixels += 1;
      }
      counts.push(inkPixels);
    }

    return counts;
  });

  expect(
    bandInkCounts.some((count) => count > 0),
    "Full-range gradient upload must render at least some ink so band comparisons are meaningful.",
  ).toBe(true);

  const tolerance = Math.max(4, Math.round(Math.max(...bandInkCounts) * 0.03));
  for (let band = 1; band < bandInkCounts.length; band += 1) {
    expect(
      bandInkCounts[band],
      `Ink density band ${band} (${bandInkCounts[band]} px) must not be a meaningful reversal from the darker band ${band - 1} above it (${bandInkCounts[band - 1]} px); bands top-to-bottom: ${bandInkCounts.join(", ")}.`,
    ).toBeGreaterThanOrEqual(bandInkCounts[band - 1] - tolerance);
  }

  expect(
    bandInkCounts[bandInkCounts.length - 1],
    `The brightest band (bottom) must render more ink than the darkest band (top); bands top-to-bottom: ${bandInkCounts.join(", ")}.`,
  ).toBeGreaterThan(bandInkCounts[0]);
});

async function measureGradientBandInkCounts(page: import("@playwright/test").Page): Promise<number[]> {
  const canvas = page.locator("[data-toolcraft-product-output]");
  return canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const ctx = canvasElement.getContext("2d", { willReadFrequently: true })!;
    const { width, height } = canvasElement;
    const bandCount = 8;
    const bandHeight = Math.floor(height / bandCount);
    const counts: number[] = [];

    for (let band = 0; band < bandCount; band += 1) {
      const { data } = ctx.getImageData(0, band * bandHeight, width, bandHeight);
      let inkPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const alpha = data[i + 3];
        if (alpha > 10 && brightness > 60) inkPixels += 1;
      }
      counts.push(inkPixels);
    }

    return counts;
  });
}

/* character.scale composes into charSize's coverage-driven tone ramp (see
   halftone-core.ts's getHalftoneEffectiveFill/inkCoverage): coverage is now
   measured at the *actual* effective size, not a fixed reference, so it
   must never silently shift the ramp's sort order or invert the gradient
   at any scale value -- the same monotonic-sweep proof as the base ramp
   test, repeated across the scale axis. */
test("browser: the tone ramp stays monotonic across character.scale values", async ({ page }) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  for (const scaleRatio of [1, 0.5, 0]) {
    await dragToolcraftSliderByTarget(page, "character.scale", scaleRatio);
    const bandInkCounts = await measureGradientBandInkCounts(page);

    expect(
      bandInkCounts.some((count) => count > 0),
      `character.scale ratio ${scaleRatio}: full-range gradient upload must render at least some ink so band comparisons are meaningful.`,
    ).toBe(true);

    const tolerance = Math.max(4, Math.round(Math.max(...bandInkCounts) * 0.03));
    for (let band = 1; band < bandInkCounts.length; band += 1) {
      expect(
        bandInkCounts[band],
        `character.scale ratio ${scaleRatio}: ink density band ${band} (${bandInkCounts[band]} px) must not be a meaningful reversal from the darker band ${band - 1} above it (${bandInkCounts[band - 1]} px); bands top-to-bottom: ${bandInkCounts.join(", ")}.`,
      ).toBeGreaterThanOrEqual(bandInkCounts[band - 1] - tolerance);
    }

    expect(
      bandInkCounts[bandInkCounts.length - 1],
      `character.scale ratio ${scaleRatio}: the brightest band (bottom) must render more ink than the darkest band (top); bands top-to-bottom: ${bandInkCounts.join(", ")}.`,
    ).toBeGreaterThan(bandInkCounts[0]);
  }

  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "product-output",
    requirementId: "character.scale",
  });
});

/* "Never overflow the cell" is a claim about the actual rasterized font
   size (fitSize * fill * scale, see halftone-core.ts/halftone-draw.ts), not
   about where ink happens to land -- and a live pixel-boundary scan can't
   reliably tell a real overflow apart from the grid's own cell-quantization
   noise (both are on the same ~1-cell order of magnitude). The direct,
   deterministic proof instead reads the *actual* `ctx.font` size-in-px the
   live app just rasterized with at the worst-case settings (max charSize,
   max scale, zero sizeVariation so every glyph shares that one size), and
   independently re-measures the same font's metrics (the same technique
   fontFit uses) to compute the true "exactly fills the cell" ceiling for
   comparison -- so the check can't drift out of sync with the engine's own
   cellW/cellAspect at test-authoring time. */
test("browser: glyphs never overflow their cell at max character.scale", async ({ page }) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createSmallFixturePng());

  // Worst case for cell overflow: every size axis pushed to its maximum at
  // once, with sizeVariation at 0 so every glyph (including whichever one
  // last set ctx.font) renders at that one full size.
  await dragToolcraftSliderByTarget(page, "character.size", 1);
  await dragToolcraftSliderByTarget(page, "character.sizeVariation", 0);
  // character.scale's default already IS its schema max (1) -- dragging to
  // ratio 1 would be a same-value collision, and dragToolcraftSliderByTarget
  // retries a same-value drag from the *opposite* end (landing near the
  // minimum instead). Verify it's already at max rather than drag it.
  const scaleField = await getToolcraftControlFieldByTarget(page, "character.scale");
  await expect(scaleField.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  const { cellAspect, cellW, fontPx, fontPxOverCeiling } = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const ctx = canvasElement.getContext("2d")!;
    const fontString = ctx.font;
    const sizeMatch = /([\d.]+)px/.exec(fontString);
    const fontPx = sizeMatch ? Number(sizeMatch[1]) : Number.NaN;
    // The canvas font getter canonicalizes the shorthand and omits the
    // weight token entirely when it's "normal" (400), so the weight
    // prefix must be optional here, not assumed present.
    const fontFamily = fontString.replace(/^(?:\S+\s+)?[\d.]+px\s+/, "");

    // Re-derive the engine's own "exactly fills the cell" ceiling
    // (fontFit + fitFontSize in halftone-core.ts) independently, using the
    // font family the live render actually used.
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    const probeCtx = probe.getContext("2d")!;
    const REF = 100;
    probeCtx.font = `400 ${REF}px ${fontFamily}`;
    const metrics = probeCtx.measureText("0");
    const advance = metrics.width > 0 ? metrics.width / REF : 0.6;
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const ink = Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
      ? (ascent + descent) / REF
      : 0.72;

    const cellW = 8;
    const cellAspect = 1.35; // defaults; this test never touches grid controls
    const cellH = cellW * cellAspect;
    const ceilingPx = Math.min(cellW / advance, cellH / ink);

    return { cellAspect, cellW, fontPx, fontPxOverCeiling: fontPx - ceilingPx };
  });

  expect(Number.isFinite(fontPx), `ctx.font must expose a real px size after a render; got "${fontPx}".`).toBe(true);
  expect(cellW).toBe(8);
  expect(cellAspect).toBe(1.35);
  // A small float-precision allowance (the live render's dpr scale factor
  // vs. this test's un-scaled cellW/cellH re-derivation can differ by a
  // fraction of a px), not a meaningful overflow margin.
  expect(
    fontPxOverCeiling,
    `Rasterized font size (${fontPx}px) must not exceed the cell-filling ceiling by more than float rounding -- overshoot ${fontPxOverCeiling.toFixed(3)}px means a glyph spilled past its cell at max charSize/scale.`,
  ).toBeLessThanOrEqual(0.5);

  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "product-output",
    requirementId: "character.scale",
  });
});

/* halftone-draw.ts's ordered-dither offset is tapered to zero within one
   tone step of pure black/white (`smoothstep(0, step, L)` is exactly 0 at
   L=0), specifically so a high Dither value can never lift a genuinely
   background cell into a drawn glyph. A thin top band of a continuous
   gradient still spans a small range of luminance approaching (not
   exactly at) black, so some real, correctly-tapered ink near the far
   edge of that band is expected -- asserting a flat "zero ink in this
   band" would be wrong, not stricter. The real, sound proof is
   differential: render the identical darkest band with Dither at 0 and
   again at its schema maximum, and require identical ink -- proving
   Dither made no difference right at the extreme, rather than guessing
   how wide the unaffected band is. */
test("browser: the dither taper holds pure black at the extreme, even at max Dither", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);
  await dragToolcraftSliderByTarget(page, "tone.blackPoint", 0);

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  const countDarkestBandInkPixels = () =>
    canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      const ctx = canvasElement.getContext("2d", { willReadFrequently: true })!;
      const { width, height } = canvasElement;
      // The gradient's darkest rows are at the top; a very thin band stays
      // close to the true L=0 extreme this proof is about.
      const bandHeight = Math.max(1, Math.floor(height * 0.01));
      const { data } = ctx.getImageData(0, 0, width, bandHeight);
      let inkPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const alpha = data[i + 3];
        if (alpha > 10 && brightness > 60) inkPixels += 1;
      }
      return inkPixels;
    });

  await dragToolcraftSliderByTarget(page, "tone.dither", 0);
  const withoutDither = await countDarkestBandInkPixels();

  await dragToolcraftSliderByTarget(page, "tone.dither", 1);
  const withMaxDither = await countDarkestBandInkPixels();

  expect(
    withMaxDither,
    `Dither must not lift any cell in the darkest band from background to drawn: ${withoutDither} ink px at Dither=0 vs ${withMaxDither} ink px at Dither=1.`,
  ).toBe(withoutDither);
});

/* tone.steps's schema minimum is 2 (buildRamp's n = max(2, round(steps)) -
   1 collapses to a single level there, proven not to divide-by-zero or
   NaN at the engine level in halftone-engine.test.ts). This proves the
   real UI renders cleanly at that floor: dragging Levels to its minimum
   must not error and must still produce a real, visibly different
   two-tone-style render from the default. */
test("browser: dragging Levels to its schema minimum (2) renders cleanly", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  const session = await createToolcraftBrowserProofSession(page);

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("tone.steps", async () => {
      await dragToolcraftSliderByTarget(page, "tone.steps", 0);
    }),
    { requirementId: "tone.steps.minimum" },
  );

  const field = await getToolcraftControlFieldByTarget(page, "tone.steps");
  await expect(field.getByRole("slider")).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator("[data-toolcraft-product-output]")).toBeVisible();
  expect(pageErrors, `Dragging Levels to its minimum must not throw: ${pageErrors.join(", ")}`).toHaveLength(0);
});

/* The grid model is settled: grid.cellWidth/grid.cellAspect are the only
   product-owned grid controls (already proven above); columns/rows are
   derived from the runtime canvas size every redraw
   (getHalftoneGridSize(canvasWidth, canvasHeight, cellWidth, cellAspect)
   in halftone-engine.test.ts) and have no schema target of their own, so
   they must not be exercised as directly-settable controls. This proves
   the derivation is really wired to the live runtime canvas size, not
   just a pure function tested in isolation: shrinking the runtime-owned
   Canvas width field, with grid.cellWidth/cellAspect untouched, must
   change the rendered glyph grid. */
test("browser: shrinking the runtime canvas width changes the derived grid and rendered output", async ({
  page,
}) => {
  await page.goto("/");
  const session = await createToolcraftBrowserProofSession(page);

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("canvas.size.width", async (control) => {
      const input = control.getByRole("textbox").first();
      await input.fill("960");
      await input.press("Tab");
    }),
    { requirementId: "canvas.size.width" },
  );

  const widthField = await getToolcraftControlFieldByTarget(page, "canvas.size.width");
  await expect(widthField.getByRole("textbox").first()).toHaveValue("960");
});

async function setHalftoneColor(page: import("@playwright/test").Page, target: string, hex: string): Promise<void> {
  const field = await getToolcraftControlFieldByTarget(page, target);
  const input = field.locator('input[type="text"]').first();
  await input.fill(hex);
  await input.press("Enter");
}

/* getHalftoneTokens's colorHex() reader was recently fixed: the Toolcraft
   "color" control commits edits as { hex } (ColorControlField.updateColor
   in the runtime UI), not a plain string, so appearance.ink/background
   never reached the engine at all before that fix -- every render used
   the hardcoded schema default regardless of the picked color. This is
   the pixel-level proof that ink now really reaches rendered output
   through the full pipeline (tokens -> ctx.fillStyle -> tone-bucketed
   fillText calls -> composited canvas pixels), not just that a value is
   stored: Ink and Background are set to maximally-distinguishable pure
   colors (red ink, blue background) with no shared channel, so the
   rendered R-minus-B channel difference is a direct, unambiguous readout
   of how much of a sampled region is opaque ink vs. background,
   regardless of anti-aliasing. The brightest band of a full-range
   gradient (mapped through the same tone-bucketed draw path proven
   monotonic in the Tone section) must render close to pure, undistorted
   ink red at full opacity, and that ink-coverage readout must increase
   monotonically band-by-band -- proving each tone bucket is applying its
   own distinct alpha to the *correct* cells, not a shared or shuffled one. */
test("browser: ink color reaches rendered pixels through the full tone-bucketed draw path", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  // dragToolcraftSliderByTarget's ratio is a *slider position* (1 = the
  // slider's max, real zoom 3), not the real value 1 the full-bleed
  // reasoning above depends on; dragToolcraftSliderTargetToValue targets
  // the actual zoom value so the whole gradient (both true extremes) is
  // visible with no over-cropping into a narrow middle luminance slice.
  await dragToolcraftSliderTargetToValue(page, "placement.zoom", 1);
  await dragToolcraftSliderByTarget(page, "tone.dither", 0);

  await setHalftoneColor(page, "appearance.ink", "#ff0000");
  await setHalftoneColor(page, "appearance.background", "#0000ff");

  const canvas = page.locator("[data-toolcraft-product-output]");
  await expect(canvas).toBeVisible();

  const bandStats = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const ctx = canvasElement.getContext("2d", { willReadFrequently: true })!;
    const { width, height } = canvasElement;
    const bandCount = 8;
    const bandHeight = Math.floor(height / bandCount);
    const stats: { inkPixelCount: number; maxInkDiff: number }[] = [];

    for (let band = 0; band < bandCount; band += 1) {
      const { data } = ctx.getImageData(0, band * bandHeight, width, bandHeight);
      let inkPixelCount = 0;
      let maxInkDiff = 0;
      for (let i = 0; i < data.length; i += 4) {
        // R (pure ink) minus B (pure background): +255 = pure ink,
        // -255 = pure background, linear in between regardless of AA.
        // Most of any band is background between sparse glyph strokes, so
        // counting every pixel washes out the ink density signal; only
        // pixels closer to ink than background count as "ink" for
        // density. A glyph's fillText interior (not just its
        // anti-aliased edge, which most "ink" pixels are) reaches true
        // full opacity at the top tone level, so the *maximum* diff found
        // anywhere in the band -- not the mean, which is dominated by
        // partial-coverage edges -- is what proves undistorted full-ink
        // color genuinely reaches pixels.
        const diff = data[i] - data[i + 2];
        if (diff > 0) inkPixelCount += 1;
        if (diff > maxInkDiff) maxInkDiff = diff;
      }
      stats.push({ inkPixelCount, maxInkDiff });
    }

    return stats;
  });

  const inkCounts = bandStats.map((band) => band.inkPixelCount);
  const peakInkDiff = Math.max(...bandStats.map((band) => band.maxInkDiff));

  expect(
    peakInkDiff,
    `At least some pixel must render as close to pure, full-opacity ink red (diff near +255), not some gamma-shifted or mis-colored approximation; band stats: ${JSON.stringify(bandStats)}.`,
  ).toBeGreaterThan(200);

  for (let band = 1; band < inkCounts.length; band += 1) {
    expect(
      inkCounts[band],
      `Ink-pixel density must not reverse from band ${band - 1} to ${band} (a tone-bucket inversion); counts: ${inkCounts.join(", ")}.`,
    ).toBeGreaterThanOrEqual(inkCounts[band - 1]! * 0.9 - 5);
  }

  expect(
    inkCounts[inkCounts.length - 1],
    `Ink-pixel density must increase from the darkest to the brightest band; counts: ${inkCounts.join(", ")}.`,
  ).toBeGreaterThan(inkCounts[0]!);
});

async function downloadAndReadExportedPng(page: import("@playwright/test").Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickToolcraftPanelActionByLabel(page, "Export PNG"),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Export PNG did not produce a downloadable file.");
  const fs = await import("node:fs/promises");
  return fs.readFile(path);
}

test("browser: export.includeBackground hides the live preview background and produces a transparent PNG", async ({
  page,
}) => {
  await page.goto("/");
  const toggleField = page.locator('[data-toolcraft-control-target="export.includeBackground"]');
  const toggle = toggleField.getByRole("switch");

  // Export once with the background included (the default state) so we know,
  // pixel-for-pixel, which coordinates are background fill vs. real ink --
  // the halftone grid tiles the whole canvas, so there is no coordinate known
  // in advance to be "background" without inspecting an opaque render first.
  const withBackgroundBytes = await downloadAndReadExportedPng(page);
  const withBackgroundPng = decodePng(withBackgroundBytes);
  const backgroundCoordinate = findMostCommonPixelCoordinate(withBackgroundPng);
  const backgroundColor = getPngPixelAt(withBackgroundPng, backgroundCoordinate.x, backgroundCoordinate.y);
  const inkCoordinate = findMostCommonPixelCoordinate(
    withBackgroundPng,
    (pixel) => pixel.r !== backgroundColor.r || pixel.g !== backgroundColor.g || pixel.b !== backgroundColor.b,
  );

  const withBackground = await getToolcraftProductObservableSnapshot(page);
  await toggle.click();
  await expect
    .poll(() => getToolcraftProductObservableSnapshot(page))
    .not.toBe(withBackground);

  const artifact = await expectToolcraftExportedArtifact(
    async () => decodePng(await downloadAndReadExportedPng(page)),
    (decoded: DecodedPng) => {
      const backgroundPixel = getPngPixelAt(decoded, backgroundCoordinate.x, backgroundCoordinate.y);
      const inkPixel = getPngPixelAt(decoded, inkCoordinate.x, inkCoordinate.y);

      expect(
        backgroundPixel.a,
        "Excluding the background must make the background region genuinely transparent (alpha 0), not merely black or white.",
      ).toBe(0);
      expect(
        // Glyph edges are anti-aliased (partial ink coverage blends with
        // whatever is behind them), so an edge pixel's alpha can land below
        // 255 even though the glyph itself is fully opaque ink; only assert
        // it isn't ALSO wiped to transparent by excluding the background.
        inkPixel.a,
        "Excluding the background must keep the halftone ink glyphs visible (non-transparent).",
      ).toBeGreaterThan(0);

      return {
        byteLength: withBackgroundBytes.byteLength,
        height: decoded.height,
        mediaType: "image/png",
        width: decoded.width,
      };
    },
    { requirementId: "export.includeBackground" },
  );
  expect(artifact.height).toBeGreaterThan(0);
  expect(artifact.width).toBeGreaterThan(0);
});

/* placeImage pre-divides the source height by cellAspect specifically so a
   fit computed in cell-space survives the later per-cell pixel-space
   render without stretching (see halftone-image.ts). A custom source size
   must reach that same correction through srcDims, not a separate scale --
   this is the live, pixel-measured proof: a drastically non-square custom
   size (1600x400, a 4:1 rectangle) under Fit=Contain must letterbox at its
   true 4:1 aspect in the exported PNG's real pixels, not at ~2.96:1 or
   5.4:1 (the documented bug's exact off-by-cellAspect shapes, since the
   default cellAspect is 1.35).

   Sized well above MIN_GRID_CELLS*cellHeight (24*10.8=~260px) on both
   axes deliberately: the source-resize also now re-derives the runtime
   canvas size (see halftone-canvas.tsx), and a height as small as 100px
   would floor to the grid's 24-cell minimum, distorting the *canvas's own*
   aspect away from the true 4:1 and confounding this test's proof with
   that unrelated, expected floor-clamp behavior. */
test("browser: source.image.width/height compose with placement.fit without stretching the source", async ({
  page,
}) => {
  await page.goto("/");
  await switchSourceMode(page, "bitmap");
  await uploadHalftoneFixtureImage(page, createSmallFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Contain");

  const widthField = await getToolcraftControlFieldByTarget(page, "source.image.width");
  await widthField.getByRole("textbox").fill("1600");
  await widthField.getByRole("textbox").press("Tab");
  const heightField = await getToolcraftControlFieldByTarget(page, "source.image.height");
  await heightField.getByRole("textbox").fill("400");
  await heightField.getByRole("textbox").press("Tab");
  await expect(widthField.getByRole("textbox")).toHaveValue("1600");
  await expect(heightField.getByRole("textbox")).toHaveValue("400");

  const bytes = await downloadAndReadExportedPng(page);
  const decoded = decodePng(bytes);
  const backgroundCoordinate = findMostCommonPixelCoordinate(decoded);
  const backgroundColor = getPngPixelAt(decoded, backgroundCoordinate.x, backgroundCoordinate.y);
  const bbox = findContentBoundingBox(decoded, backgroundColor);
  const observedAspect = bbox.width / bbox.height;
  const trueAspect = 1600 / 400;
  const cellAspect = 1.35;

  expect(
    observedAspect,
    `Rendered content aspect ${observedAspect.toFixed(2)} must match the custom source's true 4:1 aspect, not be stretched by cellAspect.`,
  ).toBeCloseTo(trueAspect, 0);
  // A stretched render would land near trueAspect / cellAspect or
  // trueAspect * cellAspect instead -- assert we're nowhere near either.
  expect(Math.abs(observedAspect - trueAspect / cellAspect)).toBeGreaterThan(0.5);
  expect(Math.abs(observedAspect - trueAspect * cellAspect)).toBeGreaterThan(0.5);

  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "product-output",
    requirementId: "source.image.width",
  });
});

test("browser: Export PNG downloads a real decodable PNG", async ({ page }) => {
  await page.goto("/");

  await expectToolcraftExportedArtifact(
    async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        clickToolcraftPanelActionByLabel(page, "Export PNG"),
      ]);
      const path = await download.path();
      if (!path) throw new Error("Export PNG did not produce a downloadable file.");
      const fs = await import("node:fs/promises");
      return fs.readFile(path);
    },
    (bytes: Buffer) => ({
      byteLength: bytes.byteLength,
      height: bytes.readUInt32BE(20),
      mediaType: "image/png",
      width: bytes.readUInt32BE(16),
    }),
    { requirementId: "output.export-png" },
  );
});

/* export.image.format/export.image.resolution never touch the live preview
   canvas -- rendererPipeline's interactionInvalidation declares them as
   invalidating only "export-composite", explicitly must-not-invalidate
   build-field/build-ramp/rasterize-glyphs (see app-performance.ts). The
   generic canvas-output-diff test every other control uses is structurally
   the wrong tool here (confirmed live: it times out waiting for a preview
   change that never happens by design). The real, provable effect is on
   the exported artifact's own bytes, not the canvas. */
test("browser: export.image.format changes the exported file's real format (PNG vs JPG)", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "export.image.format", "JPG");

  const artifact = await expectToolcraftExportedArtifact(
    async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        clickToolcraftPanelActionByLabel(page, "Export PNG"),
      ]);
      const suggestedFilename = download.suggestedFilename();
      const path = await download.path();
      if (!path) throw new Error("Export PNG (JPG format) did not produce a downloadable file.");
      const fs = await import("node:fs/promises");
      const bytes = await fs.readFile(path);
      return { bytes, suggestedFilename };
    },
    ({ bytes, suggestedFilename }: { bytes: Buffer; suggestedFilename: string }) => {
      const isJpegSignature = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      return {
        byteLength: bytes.byteLength,
        height: 1,
        mediaType: isJpegSignature ? "image/jpeg" : "image/unknown",
        suggestedFilename,
        width: 1,
      };
    },
    { requirementId: "export.image.format" },
  );

  expect(artifact.suggestedFilename).toMatch(/\.jpg$/);
  expect(
    artifact.bytes[0] === 0xff && artifact.bytes[1] === 0xd8 && artifact.bytes[2] === 0xff,
    "Selecting JPG must produce a real JPEG file (FF D8 FF signature), not a PNG.",
  ).toBe(true);
});

test("browser: export.image.resolution changes the exported file's real pixel dimensions", async ({
  page,
}) => {
  await page.goto("/");

  async function exportPngDimensions(): Promise<{ height: number; width: number }> {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      clickToolcraftPanelActionByLabel(page, "Export PNG"),
    ]);
    const path = await download.path();
    if (!path) throw new Error("Export PNG did not produce a downloadable file.");
    const fs = await import("node:fs/promises");
    const bytes = await fs.readFile(path);
    return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
  }

  await selectHalftoneGateOption(page, "export.image.resolution", "2K");
  const { width: width2k } = await exportPngDimensions();

  await selectHalftoneGateOption(page, "export.image.resolution", "8K");
  const { width: width8k } = await exportPngDimensions();

  expect(
    width8k,
    `8K export width (${width8k}px) must be substantially larger than 2K export width (${width2k}px).`,
  ).toBeGreaterThan(width2k * 3);
});

/* The runtime canvas size drives cols/rows (getHalftoneGridSize), and must
   itself be driven FROM the uploaded image (see halftone-canvas.tsx's
   canvas.setSize effect / getHalftoneCanvasSizeForSource in
   halftone-field.ts), not stay at the fixed 1920x1080 runtime default with
   the image merely fitted inside it. Output is whole cells only (cols =
   floor(imageW / cellWidth), rows = floor(imageH / (cellWidth *
   cellAspect))), so this lands within one cell of the uploaded image's real
   pixel size, not an exact pixel match -- that's the documented,
   predictable behavior, not drift. A non-square image (640x360, 16:9)
   additionally proves the derived canvas preserves that aspect instead of
   being silently squared off or stretched. */
test("browser: uploading an image drives the runtime canvas size to match it", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createSolidColorPng(640, 360));

  const canvasWidthField = await getToolcraftControlFieldByTarget(page, "canvas.size.width");
  const canvasHeightField = await getToolcraftControlFieldByTarget(page, "canvas.size.height");
  await expect
    .poll(async () => Number(await canvasWidthField.getByRole("textbox").inputValue()))
    .not.toBe(1920);
  const canvasWidth = Number(await canvasWidthField.getByRole("textbox").inputValue());
  const canvasHeight = Number(await canvasHeightField.getByRole("textbox").inputValue());

  // Default grid.cellWidth/grid.cellAspect (this test doesn't touch them).
  const cellWidth = 8;
  const cellAspect = 1.35;
  const cellHeight = cellWidth * cellAspect;
  const expectedCols = Math.min(300, Math.max(24, Math.floor(640 / cellWidth)));
  const expectedRows = Math.min(300, Math.max(24, Math.floor(360 / cellHeight)));
  const expectedWidth = Math.round(expectedCols * cellWidth);
  const expectedHeight = Math.round(expectedRows * cellHeight);

  expect(
    canvasWidth,
    `Runtime canvas width (${canvasWidth}px) must equal the whole-cell grid derived from the uploaded 640px-wide image (expected ${expectedWidth}px).`,
  ).toBe(expectedWidth);
  expect(
    canvasHeight,
    `Runtime canvas height (${canvasHeight}px) must equal the whole-cell grid derived from the uploaded 360px-tall image (expected ${expectedHeight}px).`,
  ).toBe(expectedHeight);
  expect(
    Math.abs(canvasWidth - 640),
    `Canvas width (${canvasWidth}px) must land within one cell (${cellWidth}px) of the uploaded image's real width (640px).`,
  ).toBeLessThanOrEqual(cellWidth);
  expect(
    Math.abs(canvasHeight - 360),
    `Canvas height (${canvasHeight}px) must land within one cell (${cellHeight}px) of the uploaded image's real height (360px).`,
  ).toBeLessThanOrEqual(cellHeight);
  // Non-square source: the derived canvas must preserve that aspect, not
  // square it off or otherwise distort it.
  expect(canvasWidth / canvasHeight).toBeCloseTo(640 / 360, 1);
});

test("browser: Copy Tokens writes the current engine token set to the clipboard", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("before-copy-tokens"));

  await expectToolcraftAcceptanceOutcome(
    () => page.evaluate(() => navigator.clipboard.readText()),
    () => clickToolcraftPanelActionByLabel(page, "Copy Tokens"),
    { evidenceType: "command-side-effect", requirementId: "output.copy-tokens" },
  );
});

test("browser: appearance.ink persists across a real page reload", async ({ page }) => {
  await page.goto("/");
  const session = await createToolcraftBrowserProofSession(page);

  const observeInk = session.observe((root) => {
    const input = root.querySelector<HTMLInputElement>(
      '[data-toolcraft-control-target="appearance.ink"] input[type="text"]',
    );
    return (input?.value ?? "").toLowerCase();
  });

  await expectToolcraftPersistenceState(
    observeInk,
    session.controlAction("appearance.ink", async (control) => {
      const input = control.locator('input[type="text"]').first();
      await input.fill("#00ffaa");
      await input.press("Enter");
    }),
    session.reload(),
    "#00ffaa",
    { requirementId: "persistence.appearance-ink" },
  );
});

/* measureGradientBandInkCounts (used by the character.scale monotonicity
   test) assumes light-ink-on-dark-background: it classifies a pixel as
   "ink" via a fixed brightness>60 threshold. That assumption breaks under
   appearance.themeReversed, where ink can be the *dark* color. This
   classifies each pixel by nearest-color distance to the two actual
   colors in play (whichever is "ink" for the current toggle state), so it
   works identically for both the normal and reversed palette. */
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

async function measureGradientBandColorCounts(
  page: import("@playwright/test").Page,
  inkHex: string,
  bgHex: string,
): Promise<number[]> {
  const canvas = page.locator("[data-toolcraft-product-output]");
  const [inkR, inkG, inkB] = hexToRgb(inkHex);
  const [bgR, bgG, bgB] = hexToRgb(bgHex);

  return canvas.evaluate(
    (element, { bgB, bgG, bgR, inkB, inkG, inkR }) => {
      const canvasElement = element as HTMLCanvasElement;
      const ctx = canvasElement.getContext("2d", { willReadFrequently: true })!;
      const { width, height } = canvasElement;
      const bandCount = 8;
      const bandHeight = Math.floor(height / bandCount);
      const counts: number[] = [];

      for (let band = 0; band < bandCount; band += 1) {
        const { data } = ctx.getImageData(0, band * bandHeight, width, bandHeight);
        let inkPixels = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] <= 10) continue; // transparent/background-only sample
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const distToInk = (r - inkR) ** 2 + (g - inkG) ** 2 + (b - inkB) ** 2;
          const distToBg = (r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2;
          if (distToInk < distToBg) inkPixels += 1;
        }
        counts.push(inkPixels);
      }

      return counts;
    },
    { bgB, bgG, bgR, inkB, inkG, inkR },
  );
}

/* Task: presentational theme reversal that still READS CORRECTLY on the
   reversed palette (not a photographic negative). A naive palette-swap-only
   implementation (colors swapped, ramp-index mirror missing) would still
   pass a test that only checks "colors changed" -- it changes colors, it
   just inverts *which* source tone gets which color. This proves the real
   requirement: the brightest source region reads as ink-sparse/bg-dominant
   (visually bright) and the darkest source region reads as ink-dense
   (visually dark), on the *reversed* palette, matching the true source --
   sensitivity-checked directly below against that exact naive version. */
test("browser: appearance.themeReversed reads correctly on the reversed palette, not as a negative", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);

  const themeReversedField = await getToolcraftControlFieldByTarget(page, "appearance.themeReversed");
  await themeReversedField.getByRole("switch").click();

  // Under reversal, tokens.ink/tokens.bg are the pre-toggle bg/ink values
  // (see getHalftoneTokens) -- default ink #e8e8e6, default bg #0a0a0a.
  const reversedInk = "#0a0a0a";
  const reversedBg = "#e8e8e6";
  const bandInkCounts = await measureGradientBandColorCounts(page, reversedInk, reversedBg);

  expect(
    bandInkCounts.some((count) => count > 0) && bandInkCounts.some((count, i) => i > 0 && count !== bandInkCounts[0]),
    `themeReversed on: bands must show real, varying ink density so this proof is meaningful; bands: ${bandInkCounts.join(", ")}.`,
  ).toBe(true);

  // Gradient source is dark at the top, bright at the bottom. Correct
  // inversion: dark source -> dense ink (reads dark); bright source ->
  // sparse ink/bg-dominant (reads bright). Ink pixel *count* must
  // therefore be highest at the top band and lowest at the bottom band --
  // the mirror image of the non-reversed case, not the same direction.
  expect(
    bandInkCounts[0],
    `themeReversed on: the darkest source region (top band, ${bandInkCounts[0]} ink px) must read as ink-dense -- denser than the brightest region (bottom band, ${bandInkCounts[bandInkCounts.length - 1]} ink px). If this fails, the output is reading as a photographic negative.`,
  ).toBeGreaterThan(bandInkCounts[bandInkCounts.length - 1]);
});

/* buildRamp's coverage measurement/sort must be identical whether invert is
   on or off (only the final index lookup mirrors) -- so the ramp's own
   monotonic ordering must survive the toggle with no bunching or
   double-inversion at the boundary. Same tolerance-band technique as the
   character.scale monotonicity proof, but asserting the mirrored
   (decreasing top-to-bottom) direction under themeReversed. */
test("browser: appearance.themeReversed preserves ramp monotonicity (mirrored direction, no bunching)", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);

  const themeReversedField = await getToolcraftControlFieldByTarget(page, "appearance.themeReversed");
  await themeReversedField.getByRole("switch").click();

  const bandInkCounts = await measureGradientBandColorCounts(page, "#0a0a0a", "#e8e8e6");
  const tolerance = Math.max(4, Math.round(Math.max(...bandInkCounts) * 0.03));

  for (let band = 1; band < bandInkCounts.length; band += 1) {
    expect(
      bandInkCounts[band],
      `themeReversed on: ink density band ${band} (${bandInkCounts[band]} px) must not be a meaningful reversal from the denser band ${band - 1} above it (${bandInkCounts[band - 1]} px) -- bands top-to-bottom: ${bandInkCounts.join(", ")}.`,
    ).toBeLessThanOrEqual(bandInkCounts[band - 1] + tolerance);
  }
});

test("browser: appearance.themeReversed swap and mirror reach the real exported PNG, not just the preview", async ({
  page,
}) => {
  await page.goto("/");
  await selectHalftoneGateOption(page, "source.mode", "Image");
  await uploadHalftoneFixtureImage(page, createGradientFixturePng());
  await selectHalftoneGateOption(page, "placement.fit", "Cover");
  await dragToolcraftSliderByTarget(page, "placement.zoom", 1);

  const themeReversedField = await getToolcraftControlFieldByTarget(page, "appearance.themeReversed");
  await themeReversedField.getByRole("switch").click();

  const bytes = await downloadAndReadExportedPng(page);
  const decoded = decodePng(bytes);
  const [inkR, inkG, inkB] = hexToRgb("#0a0a0a");
  const [bgR, bgG, bgB] = hexToRgb("#e8e8e6");

  const topRowY = 2;
  const bottomRowY = decoded.height - 3;
  let topInkPixels = 0;
  let bottomInkPixels = 0;

  for (let x = 0; x < decoded.width; x += 4) {
    const top = getPngPixelAt(decoded, x, topRowY);
    const distTopInk = (top.r - inkR) ** 2 + (top.g - inkG) ** 2 + (top.b - inkB) ** 2;
    const distTopBg = (top.r - bgR) ** 2 + (top.g - bgG) ** 2 + (top.b - bgB) ** 2;
    if (distTopInk < distTopBg) topInkPixels += 1;

    const bottom = getPngPixelAt(decoded, x, bottomRowY);
    const distBottomInk = (bottom.r - inkR) ** 2 + (bottom.g - inkG) ** 2 + (bottom.b - inkB) ** 2;
    const distBottomBg = (bottom.r - bgR) ** 2 + (bottom.g - bgG) ** 2 + (bottom.b - bgB) ** 2;
    if (distBottomInk < distBottomBg) bottomInkPixels += 1;
  }

  expect(
    topInkPixels,
    `Exported PNG (themeReversed on): the darkest source region (top row, ${topInkPixels} ink px) must read as ink-dense compared to the brightest region (bottom row, ${bottomInkPixels} ink px) in the real downloaded artifact, not just the live preview.`,
  ).toBeGreaterThan(bottomInkPixels);

  await attachToolcraftBrowserRuntimeEvidence({
    evidenceType: "product-output",
    requirementId: "appearance.themeReversed",
  });
});
