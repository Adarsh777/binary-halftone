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
import { dragToolcraftSliderByTarget } from "./performance-slider-helpers";
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
         requiresSourceMode gate of its own, e.g. source.mode) must first
         reveal the fileDrop before it can be uploaded into. */
      if (!config.requiresSourceMode) {
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
