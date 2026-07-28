import {
  clamp,
  fieldFromImage,
  inflate,
  readKeyField,
  renderScene,
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
   product's cellWidth/cellAspect controls. There is no autoFit or
   fitGridToMedia — the grid never re-derives itself from uploaded media. */
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
