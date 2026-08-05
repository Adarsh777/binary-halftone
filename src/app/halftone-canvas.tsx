"use client";

import * as React from "react";
import { shouldIncludeToolcraftPreviewBackground, type ToolcraftMediaAsset } from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import { drawHalftone, onHalftoneFontsReady, type HalftoneSourceMedia } from "./halftone";
import { applyHalftoneMediaTransform, getHalftoneCanvasSizeForSource } from "./halftone-field";
import { decodeHalftoneImage } from "./halftone-media";
import { computeHalftoneRenderPlan } from "./halftone-render";
import {
  applyHalftoneBackgroundOverride,
  getHalftoneSourceSize,
  getHalftoneTokens,
} from "./halftone-tokens";

const SOURCE_IMAGE_TARGET = "source.image";
const RENDER_SCALE_TARGET = "canvas.renderScale";

function makeOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function mediaTransformCacheKey(mediaAsset: ToolcraftMediaAsset): string {
  const transform = mediaAsset.transform;
  return [
    mediaAsset.dataUrl,
    transform?.rotationDeg ?? 0,
    transform?.flipHorizontal ? "1" : "0",
    transform?.flipVertical ? "1" : "0",
  ].join("|");
}

/* The rotated + resized (post source.image.width/height override) pixel
   dimensions the engine will actually place -- the same effective size
   applyHalftoneSourceResize would produce, computed directly from the
   decoded image + transform + resize values instead of allocating an
   offscreen canvas just to read srcDims() back off it. */
function getEffectiveHalftoneSourceSize(
  decodedImage: HTMLImageElement,
  mediaAsset: ToolcraftMediaAsset,
  values: Record<string, unknown>,
): { height: number; width: number } {
  const rotationDeg = mediaAsset.transform?.rotationDeg ?? 0;
  const swapDimensions = rotationDeg === 90 || rotationDeg === 270;
  const naturalWidth = decodedImage.naturalWidth || 1;
  const naturalHeight = decodedImage.naturalHeight || 1;
  const rotatedWidth = swapDimensions ? naturalHeight : naturalWidth;
  const rotatedHeight = swapDimensions ? naturalWidth : naturalHeight;
  const customSize = getHalftoneSourceSize(values);

  return {
    height: customSize.height && customSize.height > 0 ? customSize.height : rotatedHeight,
    width: customSize.width && customSize.width > 0 ? customSize.width : rotatedWidth,
  };
}

/* Decodes the attached source image once per dataUrl and caches it across
   renders/redraws, matching the performance rule of not re-decoding media on
   every control change. */
function useDecodedHalftoneImage(dataUrl: string | undefined): HTMLImageElement | null {
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);
  const cacheRef = React.useRef(new Map<string, HTMLImageElement>());

  React.useEffect(() => {
    if (!dataUrl) {
      setImage(null);
      return;
    }

    const cached = cacheRef.current.get(dataUrl);
    if (cached) {
      setImage(cached);
      return;
    }

    let cancelled = false;
    void decodeHalftoneImage(dataUrl).then(
      (decoded) => {
        if (cancelled) {
          return;
        }
        cacheRef.current.set(dataUrl, decoded);
        setImage(decoded);
      },
      () => {
        if (!cancelled) {
          setImage(null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  return image;
}

/* fontFit/inkCoverage measure real glyph metrics via canvas text APIs,
   which silently fall back to a substitute font until the real one
   finishes loading -- a redraw that runs before then caches wrong metrics
   for the rest of the session (see halftone-core.ts). This forces one
   corrective re-render once document.fonts.ready resolves, so a redraw
   that already happened with fallback-font metrics doesn't stay stale on
   screen after the real font becomes available. */
function useHalftoneFontsReadyTick(): number {
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => onHalftoneFontsReady(() => setTick((value) => value + 1)), []);

  return tick;
}

export function HalftoneCanvas(): React.JSX.Element {
  const { dispatch, state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const transformedMediaCache = React.useRef(new Map<string, HTMLCanvasElement>());
  const pendingFrameRef = React.useRef<number | null>(null);
  const lastSourceSizedKeyRef = React.useRef<string | null>(null);
  useHalftoneFontsReadyTick();

  const mediaAsset = state.mediaAssets.find(
    (asset) => asset.sourceTarget === SOURCE_IMAGE_TARGET,
  );
  const decodedImage = useDecodedHalftoneImage(mediaAsset?.dataUrl);

  /* Canvas size stays runtime-owned (no app-authored canvas-size control):
     this only *dispatches* the existing canvas.setSize command, once per
     distinct effective source (a new upload, a rotate/flip, or a
     source.image.width/height resize), so 1x export always equals what's
     actually shown in the preview. Deliberately keyed on source identity
     only, not on grid.cellWidth/cellAspect -- tweaking the grid after an
     upload reflows the existing canvas rather than silently resizing it
     again on every cell-density change. */
  React.useEffect(() => {
    if (!decodedImage || !mediaAsset) {
      return;
    }

    const effectiveSize = getEffectiveHalftoneSourceSize(decodedImage, mediaAsset, state.values);
    const sizedKey = `${mediaAsset.dataUrl}|${mediaAsset.transform?.rotationDeg ?? 0}|${effectiveSize.width}|${effectiveSize.height}`;

    if (lastSourceSizedKeyRef.current === sizedKey) {
      return;
    }
    lastSourceSizedKeyRef.current = sizedKey;

    const tokens = getHalftoneTokens(state.values);
    const targetSize = getHalftoneCanvasSizeForSource(
      effectiveSize.width,
      effectiveSize.height,
      tokens.cellW,
      tokens.cellAspect,
    );

    if (targetSize.width === state.canvas.size.width && targetSize.height === state.canvas.size.height) {
      return;
    }

    dispatch({
      size: { height: targetSize.height, unit: "px", width: targetSize.width },
      type: "canvas.setSize",
    });
  }, [decodedImage, mediaAsset, state.values, state.canvas.size, dispatch]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    /* Coalesce redraws to one per animation frame: a rapid burst of control
       updates (e.g. every intermediate pointermove during a slider drag)
       otherwise triggers one full synchronous drawHalftone per React commit.
       Cancelling any not-yet-fired frame and scheduling the latest one keeps
       the drawn output identical (the same state always converges to the
       same pixels) while dropping intermediate renders that would be
       overwritten before the browser ever paints them. */
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
    }

    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;

      let media: HalftoneSourceMedia | null = null;
      if (decodedImage && mediaAsset) {
        const cacheKey = mediaTransformCacheKey(mediaAsset);
        let transformed = transformedMediaCache.current.get(cacheKey);
        if (!transformed) {
          transformed = applyHalftoneMediaTransform(
            decodedImage,
            mediaAsset.transform,
            makeOffscreenCanvas,
          );
          transformedMediaCache.current.set(cacheKey, transformed);
        }
        media = transformed;
      }

      const { field, tokens } = computeHalftoneRenderPlan(state, media, makeOffscreenCanvas);
      const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
      const renderScaleValue = state.values[RENDER_SCALE_TARGET];
      const dpr =
        typeof renderScaleValue === "number" && Number.isFinite(renderScaleValue)
          ? renderScaleValue
          : state.schema.canvas.renderScale.defaultValue;

      drawHalftone(
        canvas,
        field,
        applyHalftoneBackgroundOverride(tokens, includeBackground),
        { dpr, makeCanvas: makeOffscreenCanvas },
      );
    });

    return () => {
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    };
  });

  return (
    <canvas
      data-toolcraft-product-output=""
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
    />
  );
}
