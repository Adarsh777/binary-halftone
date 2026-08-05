import {
  clamp,
  fieldFromImage,
  inflate,
  readKeyField,
  renderScene,
  srcDims,
  type CanvasFactory,
  type Field,
  type HalftoneSourceMedia,
  type PlaceOptions,
} from "./halftone";

export type HalftoneMediaTransform = {
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  rotationDeg?: 0 | 90 | 180 | 270;
};

/* Derived-grid model: cols/rows come from the runtime canvas size and the
   product's cellWidth/cellAspect controls -- canvas size stays runtime-owned
   (no app-authored canvas-size control). getHalftoneCanvasSizeForSource lets
   the app *set* that runtime canvas size from an uploaded source's pixel
   dimensions (once, on upload -- see halftone-canvas.tsx), so this same
   rounding formula ends up deriving the identical cols/rows back out of it. */
const MIN_GRID_CELLS = 24;
const MAX_GRID_CELLS = 300;

export function getHalftoneGridSize(
  canvasWidth: number,
  canvasHeight: number,
  cellWidth: number,
  cellAspect: number,
): { cols: number; rows: number } {
  const safeCellWidth = Math.max(cellWidth, 0.001);
  const cellHeight = Math.max(safeCellWidth * cellAspect, 0.001);

  return {
    cols: clamp(Math.round(canvasWidth / safeCellWidth), MIN_GRID_CELLS, MAX_GRID_CELLS),
    rows: clamp(Math.round(canvasHeight / cellHeight), MIN_GRID_CELLS, MAX_GRID_CELLS),
  };
}

/* Whole-cell canvas size for a source of sourceWidth x sourceHeight: floor
   (not round) so the derived canvas is never LARGER than the source, and
   clamped to the same [MIN_GRID_CELLS, MAX_GRID_CELLS] bounds
   getHalftoneGridSize already enforces everywhere else, so the canvas size
   this produces always round-trips back through getHalftoneGridSize to the
   exact same cols/rows -- no separate silent cap, no drift between "the
   canvas size the app set" and "the grid the engine actually renders at".
   Lands within one cell of sourceWidth x sourceHeight; that's expected
   (whole cells only), not a bug. */
export function getHalftoneCanvasSizeForSource(
  sourceWidth: number,
  sourceHeight: number,
  cellWidth: number,
  cellAspect: number,
): { height: number; width: number } {
  const safeCellWidth = Math.max(cellWidth, 0.001);
  const cellHeight = Math.max(safeCellWidth * cellAspect, 0.001);
  const cols = clamp(Math.floor(sourceWidth / safeCellWidth), MIN_GRID_CELLS, MAX_GRID_CELLS);
  const rows = clamp(Math.floor(sourceHeight / cellHeight), MIN_GRID_CELLS, MAX_GRID_CELLS);

  return {
    height: Math.round(rows * cellHeight),
    width: Math.round(cols * safeCellWidth),
  };
}

/* Toolcraft owns rotate/flip as mediaAssets[].transform; the reference engine
   has no notion of it. Bake the transform into an offscreen bitmap before
   handing the source to the unmodified engine functions. */
export function applyHalftoneMediaTransform(
  image: HalftoneSourceMedia & { naturalHeight?: number; naturalWidth?: number },
  transform: HalftoneMediaTransform | undefined,
  makeCanvas: CanvasFactory,
): HTMLCanvasElement {
  const rotationDeg = transform?.rotationDeg ?? 0;
  const swapDimensions = rotationDeg === 90 || rotationDeg === 270;
  const sourceWidth = image.naturalWidth || 1;
  const sourceHeight = image.naturalHeight || 1;
  const canvas = makeCanvas(
    swapDimensions ? sourceHeight : sourceWidth,
    swapDimensions ? sourceWidth : sourceHeight,
  );
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return canvas;
  }

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(transform?.flipHorizontal ? -1 : 1, transform?.flipVertical ? -1 : 1);
  ctx.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  ctx.restore();

  return canvas;
}

export type HalftoneSourceSize = { height?: number; width?: number };

/* A user-set custom source size must reach placeImage/srcDims as the
   media's own reported dimensions, not as a separate scale applied
   alongside fit/zoom/pan -- otherwise it would bypass placeImage's
   cellAspect pre-division (see halftone-image.ts) and reintroduce the
   vertical-stretch bug. Baking the resize onto an offscreen canvas before
   the engine ever sees the source means srcDims() reports the custom size
   naturally (canvas elements report .width/.height), so the existing
   fit/zoom/pan and cellAspect correction apply completely unmodified. */
export function applyHalftoneSourceResize(
  media: HalftoneSourceMedia,
  size: HalftoneSourceSize | undefined,
  makeCanvas: CanvasFactory,
): HalftoneSourceMedia {
  const current = srcDims(media);
  const width =
    size?.width && Number.isFinite(size.width) && size.width > 0
      ? Math.round(size.width)
      : current.w;
  const height =
    size?.height && Number.isFinite(size.height) && size.height > 0
      ? Math.round(size.height)
      : current.h;

  if (width === current.w && height === current.h) {
    return media;
  }

  const targetWidth = Math.max(1, width);
  const targetHeight = Math.max(1, height);
  const canvas = makeCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return media;
  }

  ctx.drawImage(media, 0, 0, targetWidth, targetHeight);
  return canvas;
}

export type HalftoneSourceMode = "bitmap" | "inflate" | "scene";

export type HalftoneFieldInput = {
  bgCutoff: number;
  cols: number;
  inflateOptions: {
    domeRadius: number;
    invert: boolean;
    occlusion: number;
    relief: number;
    showMask: boolean;
    threshold: number;
  };
  lightDir: readonly [number, number, number];
  makeCanvas: CanvasFactory;
  media: HalftoneSourceMedia | null;
  mode: HalftoneSourceMode;
  place: PlaceOptions;
  rim: number;
  rows: number;
  scene: string;
  yaw: number;
  pitch: number;
};

/* No stable media source falls back to the procedural scene, matching the
   reference app's `const mode = media ? p.source.mode : "scene"`. */
export function resolveHalftoneEffectiveMode(
  mode: HalftoneSourceMode,
  hasMedia: boolean,
): HalftoneSourceMode {
  return hasMedia ? mode : "scene";
}

export function buildHalftoneField(input: HalftoneFieldInput): Field {
  const effectiveMode = resolveHalftoneEffectiveMode(input.mode, input.media !== null);

  if (effectiveMode === "scene") {
    return renderScene(input.cols, input.rows, {
      lightDir: input.lightDir,
      pitch: (input.pitch * Math.PI) / 180,
      rim: input.rim,
      scene: input.scene,
      yaw: (input.yaw * Math.PI) / 180,
    });
  }

  const media = input.media;
  if (!media) {
    return renderScene(input.cols, input.rows, {
      lightDir: input.lightDir,
      pitch: (input.pitch * Math.PI) / 180,
      rim: input.rim,
      scene: input.scene,
      yaw: (input.yaw * Math.PI) / 180,
    });
  }

  if (effectiveMode === "inflate") {
    const keyWidth = input.cols * 2;
    const keyHeight = input.rows * 2;
    const keyField = readKeyField(media, keyWidth, keyHeight, input.place, input.makeCanvas);

    return inflate(keyField, input.cols, input.rows, {
      domeRadius: input.inflateOptions.domeRadius,
      invert: input.inflateOptions.invert,
      lightDir: input.lightDir,
      occlusion: input.inflateOptions.occlusion,
      relief: input.inflateOptions.relief,
      rim: input.rim,
      showMask: input.inflateOptions.showMask,
      threshold: input.inflateOptions.threshold,
    });
  }

  return fieldFromImage(media, input.cols, input.rows, input.place, input.bgCutoff, input.makeCanvas);
}
