import type { ToolcraftState } from "@/toolcraft/runtime";

import { type CanvasFactory, type Field, type HalftoneSourceMedia, type Tokens } from "./halftone";
import { applyHalftoneSourceResize, buildHalftoneField, getHalftoneGridSize } from "./halftone-field";
import {
  getHalftoneInflateOptions,
  getHalftonePlacement,
  getHalftoneSceneOptions,
  getHalftoneSourceMode,
  getHalftoneSourceSize,
  getHalftoneTokens,
} from "./halftone-tokens";

export type HalftoneRenderPlan = {
  cols: number;
  field: Field;
  rows: number;
  tokens: Tokens;
};

/* Shared by the live canvasContent preview and the PNG export path so both
   derive the same grid, tokens, and field from the same runtime state. */
export function computeHalftoneRenderPlan(
  state: ToolcraftState,
  media: HalftoneSourceMedia | null,
  makeCanvas: CanvasFactory,
): HalftoneRenderPlan {
  const tokens = getHalftoneTokens(state.values);
  const mode = getHalftoneSourceMode(state.values);
  const placement = getHalftonePlacement(state.values);
  const scene = getHalftoneSceneOptions(state.values);
  const inflateOptions = getHalftoneInflateOptions(state.values);
  const { cols, rows } = getHalftoneGridSize(
    state.canvas.size.width,
    state.canvas.size.height,
    tokens.cellW,
    tokens.cellAspect,
  );
  const resizedMedia = media
    ? applyHalftoneSourceResize(media, getHalftoneSourceSize(state.values), makeCanvas)
    : media;

  const field = buildHalftoneField({
    bgCutoff: tokens.bgCutoff,
    cols,
    inflateOptions,
    lightDir: tokens.lightDir,
    makeCanvas,
    media: resizedMedia,
    mode,
    pitch: scene.pitch,
    place: { ...placement, cellAspect: tokens.cellAspect },
    rim: tokens.rim,
    rows,
    scene: scene.scene,
    yaw: scene.yaw,
  });

  return { cols, field, rows, tokens };
}
