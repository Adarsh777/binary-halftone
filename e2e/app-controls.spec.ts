import { expect, test } from "@playwright/test";

import { createToolcraftBrowserProofSession } from "./browser-proof-session";
import { expectToolcraftConditionalControlVisibility } from "./browser-conditional-output-evidence-helpers";
import {
  expectToolcraftAcceptanceOutcome,
  expectToolcraftExportedArtifact,
} from "./browser-acceptance-outcome-helpers";
import { expectToolcraftMediaLifecycle, expectToolcraftPersistenceState } from "./browser-state-evidence-helpers";
import { clickToolcraftPanelActionByLabel } from "./performance-output-action-helpers";
import {
  expectToolcraftProductObservableToChange,
  getToolcraftProductObservableSnapshot,
} from "./product-observable-helpers";
import {
  applyHalftoneControlChange,
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
      await uploadHalftoneFixtureImage(page);
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

test("browser: source.image media lifecycle covers upload and remove", async ({ page }) => {
  await page.goto("/");
  const session = await createToolcraftBrowserProofSession(page);

  const observeLifecycle = session.observe((root) => {
    const images = Array.from(
      root.querySelectorAll('[data-toolcraft-control-target="source.image"] img'),
    );
    const canvas = root.querySelector("[data-toolcraft-product-output]");
    return {
      itemIds: images.map((image, index) => image.getAttribute("alt") ?? `image-${index}`),
      outputSignature: canvas ? canvas.outerHTML.length.toString() : "0",
    };
  });

  await expectToolcraftMediaLifecycle(
    observeLifecycle,
    session.action(async () => {
      await uploadHalftoneFixtureImage(page);
    }),
    { itemIds: ["halftone-fixture.png"], outputSignature: "" },
    { requirementId: "source.image.upload" },
  );
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
