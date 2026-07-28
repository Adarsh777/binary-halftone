"use client";

import * as React from "react";
import { shouldIncludeToolcraftPreviewBackground, type ToolcraftMediaAsset } from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import { drawHalftone, type HalftoneSourceMedia } from "./halftone";
import { applyHalftoneMediaTransform } from "./halftone-field";
import { decodeHalftoneImage } from "./halftone-media";
import { computeHalftoneRenderPlan } from "./halftone-render";

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

export function HalftoneCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const transformedMediaCache = React.useRef(new Map<string, HTMLCanvasElement>());

  const mediaAsset = state.mediaAssets.find(
    (asset) => asset.sourceTarget === SOURCE_IMAGE_TARGET,
  );
  const decodedImage = useDecodedHalftoneImage(mediaAsset?.dataUrl);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

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
      includeBackground ? tokens : { ...tokens, bg: "transparent" },
      { dpr, makeCanvas: makeOffscreenCanvas },
    );
  });

  return (
    <canvas
      data-toolcraft-product-output=""
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
    />
  );
}
