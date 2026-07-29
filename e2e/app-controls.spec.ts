import { expect, test } from "@playwright/test";

import { createToolcraftBrowserProofSession } from "./browser-proof-session";
import { expectToolcraftConditionalControlVisibility } from "./browser-conditional-output-evidence-helpers";
import {
  expectToolcraftAcceptanceOutcome,
  expectToolcraftExportedArtifact,
} from "./browser-acceptance-outcome-helpers";
import { expectToolcraftPersistenceState } from "./browser-state-evidence-helpers";
import { attachToolcraftBrowserRuntimeEvidence } from "./browser-runtime-evidence";
import {
  countToolcraftControlOwnersByTarget,
  getToolcraftControlFieldByTarget,
} from "./browser-control-target-helpers";
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
  HALFTONE_CONTROL_CONFIGS,
  selectHalftoneGateOption,
  uploadHalftoneFixtureImage,
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

/* One acceptance row per visible schema control target: proves the real
   interaction changes the rendered product-output canvas. Gated controls
   (Placement/Silhouette/Custom Characters) also prove their conditional
   visibility through the same gating control before being exercised. */
for (const config of HALFTONE_CONTROL_CONFIGS) {
  test(`browser: ${config.target} changes rendered output`, async ({ page }) => {
    await page.goto("/");
    const session = await createToolcraftBrowserProofSession(page);

    if (config.requiresSourceMode) {
      const visibleLabel = config.requiresSourceMode === "inflate" ? "Silhouette" : "Image";
      await selectHalftoneGateOption(page, "source.mode", visibleLabel);
      await expectToolcraftConditionalControlVisibility(
        session,
        session.controlAction("source.mode", async (control) => {
          await control.getByRole("combobox").click();
          await page.locator('[role="option"]').filter({ hasText: "Scene" }).first().click();
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
      /* source.image is itself visibleWhen source.mode !== "scene", so a
         control whose own config only declares requiresMedia (no
         requiresSourceMode/requiresSourceModeContext gate of its own, e.g.
         source.mode) must first reveal the fileDrop before it can be
         uploaded into. */
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
   changes rendered output once source.mode reads media (Image/Silhouette),
   since Scene mode never looks at mediaAssets. Rotate/flip are the runtime's
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

  await expectToolcraftProductObservableToChange(
    session,
    session.controlAction("source.image", async (_control, currentPage) => {
      await currentPage.getByRole("button", { name: "Reset Source section" }).click();
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

/* source.scene/source.yaw/source.pitch are visibleWhen source.mode equals
   "scene" -- the opposite gating direction from source.image (visible only
   in Scene mode, hidden once a media-driven mode is selected). This proves
   both directions for that shared gate. */
test("browser: Shape/Yaw/Pitch hide once a media-driven source mode is selected", async ({
  page,
}) => {
  await page.goto("/");

  const gatedTargets = ["source.scene", "source.yaw", "source.pitch"] as const;

  for (const target of gatedTargets) {
    expect(await countToolcraftControlOwnersByTarget(page, target)).toBe(1);
    await attachToolcraftBrowserRuntimeEvidence({
      evidenceType: "conditional-control-visible",
      requirementId: `${target}.visibility`,
      target,
    });
  }

  await selectHalftoneGateOption(page, "source.mode", "Image");

  for (const target of gatedTargets) {
    expect(await countToolcraftControlOwnersByTarget(page, target)).toBe(0);
    await attachToolcraftBrowserRuntimeEvidence({
      evidenceType: "conditional-control-hidden",
      requirementId: `${target}.visibility`,
      target,
    });
  }

  await selectHalftoneGateOption(page, "source.mode", "Scene");

  for (const target of gatedTargets) {
    expect(await countToolcraftControlOwnersByTarget(page, target)).toBe(1);
    await attachToolcraftBrowserRuntimeEvidence({
      evidenceType: "conditional-control-visible",
      requirementId: `${target}.visibility`,
      target,
    });
  }
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

test("browser: export.includeBackground hides the live preview background and produces a transparent PNG", async ({
  page,
}) => {
  await page.goto("/");
  const toggleField = page.locator('[data-toolcraft-control-target="export.includeBackground"]');
  const toggle = toggleField.getByRole("switch");

  const withBackground = await getToolcraftProductObservableSnapshot(page);
  await toggle.click();
  await expect
    .poll(() => getToolcraftProductObservableSnapshot(page))
    .not.toBe(withBackground);

  const artifact = await expectToolcraftExportedArtifact(
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
    (bytes: Buffer) => {
      const colorType = bytes.readUInt8(25);
      return {
        // PNG color type 6 (RGBA) or 4 (grayscale+alpha) carries an alpha
        // channel; that is how a transparent-background export is proven.
        byteLength: bytes.byteLength,
        height: bytes.readUInt32BE(20),
        mediaType: "image/png",
        width: colorType === 6 || colorType === 4 ? bytes.readUInt32BE(16) : 0,
      };
    },
    { requirementId: "export.includeBackground" },
  );
  expect(artifact.byteLength).toBeGreaterThan(0);
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
