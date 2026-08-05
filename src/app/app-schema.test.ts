import { describe, expect, it } from "vitest";

import { appPerformance } from "./app-performance";
import { appSchema } from "./app-schema";

describe("appSchema", () => {
  it("publishes the product Toolcraft app contract", () => {
    expect(appSchema.canvas.draggable).toBe(true);
    expect(appSchema.canvas.enabled).toBe(true);
    expect(appSchema.canvas.sizing).toEqual({ mode: "editable-output" });
    expect(appSchema.canvas.upload).toBe(true);
    expect(appSchema.canvas.renderScale.enabled).toBe(true);
    expect(appSchema.panels.controls?.sections[0]?.title).toBe("Setup");
    expect(appSchema.panels.controls?.sections[0]?.controls.settingsTransfer).toMatchObject({
      target: "runtime.settingsTransfer",
      type: "settingsTransfer",
    });
    expect(appSchema.panels.controls?.sections[0]?.controls.canvasAspectRatio).toMatchObject({
      target: "canvas.aspectRatio",
      type: "aspectRatio",
    });
    expect(appSchema.panels.controls?.sections[0]?.controls.canvasWidth).toMatchObject({
      target: "canvas.size.width",
      type: "text",
    });
    expect(appSchema.panels.controls?.sections[0]?.controls.canvasHeight).toMatchObject({
      target: "canvas.size.height",
      type: "text",
    });
    expect(appSchema.panels.layers).toBeUndefined();
    expect(appSchema.panels.timeline).toBeUndefined();
    expect(appSchema.assembly.components).toEqual(["canvas", "controlsPanel", "toolbar"]);
    expect(appSchema.assembly.capabilities).toEqual(
      expect.arrayContaining([
        "canvas.draggable",
        "canvas.editableSize",
        "canvas.renderScale",
        "canvas.upload",
        "controls.defaults",
        "controls.panel",
        "toolbar.history",
        "toolbar.radar",
        "toolbar.zoom",
      ]),
    );
    expect(appSchema.assembly.capabilities).not.toContain("timeline.playback");
    expect(appSchema.assembly.capabilities).not.toContain("timeline.keyframes");
    expect(appSchema.assembly.commands).toEqual(
      expect.arrayContaining([
        "canvas.center",
        "canvas.setSize",
        "canvas.setViewport",
        "canvas.zoomIn",
        "controls.reset",
        "controls.setValue",
        "history.undo",
        "media.delete",
        "media.import",
      ]),
    );
    expect(appSchema.assembly.commands).not.toContain("timeline.setCurrentTime");
  });

  it("groups product controls into the Image/Source/Placement/Silhouette/Character/Grid/Tone/Light/Ink/Background/Image Export sections", () => {
    const productSectionTitles =
      appSchema.panels.controls?.sections
        .filter((section) => section.title !== "Setup")
        .map((section) => section.title) ?? [];

    expect(productSectionTitles).toEqual([
      "Image",
      "Source",
      "Placement",
      "Silhouette",
      "Character",
      "Grid",
      "Tone",
      "Light",
      "Ink",
      "Background",
      "Image Export",
      "Export",
    ]);
    expect(appSchema.panels.layers).toBeUndefined();
    expect(appSchema.panels.timeline).toBeUndefined();
  });

  it("does not imply timeline behavior for this still-image product", () => {
    expect(appSchema.assembly.capabilities).not.toContain("timeline.playback");
    expect(appSchema.assembly.capabilities).not.toContain("timeline.keyframes");
    expect(appSchema.assembly.commands).not.toContain("timeline.toggleControlKeyframes");
    expect(appSchema.assembly.commands).not.toContain("timeline.moveKeyframe");
  });

  it("declares the reference-clone renderer technique and pipeline ahead of the per-control performance scenario matrix", () => {
    expect(appPerformance.usesCustomRenderer).toBe(true);
    expect(appPerformance.rendererStrategy).toBe("canvas-2d");
    expect(appPerformance.rendererWorkload).toBe("text-output");
    expect(appPerformance.rendererTechnique).toBeDefined();
    expect(appPerformance.rendererPipeline?.passes.length).toBeGreaterThan(0);
    expect(appPerformance.rendererPipeline?.interactionInvalidation.length).toBeGreaterThan(0);
  });

  it("enforces the two intentionally-dropped reference features (referenceFeatureInventory feature-presets/feature-video-source)", () => {
    // Video-as-source was scoped out: source.mode has exactly the two
    // remaining media-driven modes (Scene was later dropped as a
    // user-selectable option too), never a video option.
    const modeControl = appSchema.panels.controls?.sections
      .flatMap((section) => Object.values(section.controls))
      .find((control) => control.target === "source.mode");
    expect(modeControl?.options?.map((option) => option.value)).toEqual(["bitmap", "inflate"]);
    // Default preview is the upload-image placeholder path, not Silhouette.
    expect(modeControl?.defaultValue).toBe("bitmap");

    // Named presets were replaced by the runtime's generic Settings
    // Transfer, not an app-authored preset system: no control target
    // implements its own preset store, and the replacement control is real.
    const allTargets = appSchema.panels.controls?.sections.flatMap((section) =>
      Object.values(section.controls).map((control) => control.target),
    );
    expect(allTargets?.some((target) => /preset/i.test(target))).toBe(false);
    const settingsTransferControl = appSchema.panels.controls?.sections[0]?.controls.settingsTransfer;
    expect(settingsTransferControl).toMatchObject({
      target: "runtime.settingsTransfer",
      type: "settingsTransfer",
    });
  });

  it("persists user-edited control values, canvas size, and panel state to localStorage", () => {
    expect(appSchema.persistence.storage).toBe("localStorage");
    if (appSchema.persistence.storage !== "localStorage") throw new Error("unreachable");
    expect(appSchema.persistence.include).toEqual(expect.arrayContaining(["values", "canvas", "panels"]));
    expect(appSchema.persistence.key.length).toBeGreaterThan(0);
  });
});
