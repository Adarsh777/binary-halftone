import {
  createToolcraftPngExportCanvas,
  shouldIncludeToolcraftPreviewBackground,
} from "@/toolcraft/runtime";
import type { ToolcraftPanelActionContext } from "@/toolcraft/runtime/react";

import { drawHalftone, type HalftoneSourceMedia } from "./halftone";
import { applyHalftoneMediaTransform } from "./halftone-field";
import { decodeHalftoneImage } from "./halftone-media";
import { computeHalftoneRenderPlan } from "./halftone-render";
import { applyHalftoneBackgroundOverride } from "./halftone-tokens";

const SOURCE_IMAGE_TARGET = "source.image";

function makeOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeBlankCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

function downloadCanvasImage(canvas: HTMLCanvasElement, format: string | undefined): void {
  const isJpg = format === "jpg";
  const anchor = document.createElement("a");
  anchor.href = isJpg ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");
  anchor.download = isJpg ? "halftone.jpg" : "halftone.png";
  anchor.click();
}

async function resolveExportMedia(
  state: ToolcraftPanelActionContext["state"],
): Promise<HalftoneSourceMedia | null> {
  const mediaAsset = state.mediaAssets.find(
    (asset) => asset.sourceTarget === SOURCE_IMAGE_TARGET,
  );

  if (!mediaAsset) {
    return null;
  }

  const image = await decodeHalftoneImage(mediaAsset.dataUrl);
  return applyHalftoneMediaTransform(image, mediaAsset.transform, makeOffscreenCanvas);
}

/* Renders the same unmodified engine output the live preview shows, then
   composites it through the standard Toolcraft PNG export helper so
   resolution/background stay runtime-owned. */
export async function exportHalftonePng({
  state,
}: ToolcraftPanelActionContext): Promise<void> {
  const media = await resolveExportMedia(state);
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
  const { field, tokens } = computeHalftoneRenderPlan(state, media, makeOffscreenCanvas);

  const exportCanvas = createToolcraftPngExportCanvas({
    background: tokens.bg,
    canvasFactory: makeBlankCanvas,
    includeBackground,
    render: ({ context, cssHeight, cssWidth, pixelRatio }) => {
      const off = makeOffscreenCanvas(1, 1);
      drawHalftone(
        off,
        field,
        applyHalftoneBackgroundOverride(tokens, includeBackground),
        { dpr: pixelRatio, makeCanvas: makeOffscreenCanvas, setStyleSize: false },
      );
      context.drawImage(off, 0, 0, cssWidth, cssHeight);
    },
    resolution: state.values["export.image.resolution"] as string | undefined,
    state,
  });

  downloadCanvasImage(exportCanvas, state.values["export.image.format"] as string | undefined);
}

export function copyHalftoneTokens({ state }: ToolcraftPanelActionContext): Promise<void> {
  const { cols, rows, tokens } = computeHalftoneRenderPlan(state, null, makeOffscreenCanvas);
  const json = JSON.stringify({ ...tokens, columns: cols, rows }, null, 2);

  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(json);
  }

  return Promise.resolve();
}
