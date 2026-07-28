import { resolveCharset, type Tokens } from "./halftone";

export type HalftoneRuntimeValues = Record<string, unknown>;

const FONT_STACK =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

function num(values: HalftoneRuntimeValues, target: string, fallback: number): number {
  const value = values[target];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(values: HalftoneRuntimeValues, target: string, fallback: string): string {
  const value = values[target];
  return typeof value === "string" ? value : fallback;
}

function bool(values: HalftoneRuntimeValues, target: string, fallback: boolean): boolean {
  const value = values[target];
  return typeof value === "boolean" ? value : fallback;
}

/* Mirrors the old app's tokensFrom(): maps flat runtime control values onto
   the engine's Tokens shape. Grid columns/rows are derived elsewhere from
   the runtime canvas size, not carried on Tokens. */
export function getHalftoneTokens(values: HalftoneRuntimeValues): Tokens {
  const charMode = str(values, "character.mode", "binary");
  const customChars = str(values, "character.customChars", "01");
  const weight = Number.parseInt(str(values, "character.weight", "400"), 10) || 400;

  return {
    alphas: [0.22, 0.36, 0.52, 0.7, 0.86, 1.0],
    bg: str(values, "appearance.background", "#0a0a0a"),
    bgCutoff: num(values, "tone.backgroundCutoff", 0.045),
    black: num(values, "tone.blackPoint", 0.05),
    cellAspect: num(values, "grid.cellAspect", 1.35),
    cellW: num(values, "grid.cellWidth", 8),
    charMode,
    charSize: num(values, "character.size", 1.05),
    charset: resolveCharset(charMode, customChars),
    dither: num(values, "tone.dither", 0.55),
    edgeLift: num(values, "tone.edgeLift", 0.55),
    font: FONT_STACK,
    gamma: num(values, "tone.gamma", 1),
    ink: str(values, "appearance.ink", "#e8e8e6"),
    lightDir: [
      num(values, "light.dirX", -0.45),
      num(values, "light.dirY", 0.78),
      num(values, "light.dirZ", 0.44),
    ],
    overlap: 0,
    rim: num(values, "light.rim", 0.55),
    sizeSteps: num(values, "character.sizeSteps", 3),
    sizeVariation: num(values, "character.sizeVariation", 0.35),
    steps: num(values, "tone.steps", 8),
    variety: num(values, "character.variety", 0.6),
    weight,
    white: num(values, "tone.whitePoint", 0.95),
  };
}

export function shouldIncludeHalftoneBackground(
  values: HalftoneRuntimeValues,
  fallback: boolean,
): boolean {
  return bool(values, "export.includeBackground", fallback);
}

export function getHalftonePlacement(values: HalftoneRuntimeValues): {
  fit: "contain" | "cover" | "stretch";
  panX: number;
  panY: number;
  zoom: number;
} {
  const fit = str(values, "placement.fit", "contain");
  return {
    fit: fit === "cover" || fit === "stretch" ? fit : "contain",
    panX: num(values, "placement.panX", 0),
    panY: num(values, "placement.panY", 0),
    zoom: num(values, "placement.zoom", 0.95),
  };
}

export function getHalftoneSourceMode(values: HalftoneRuntimeValues): "bitmap" | "inflate" | "scene" {
  const mode = str(values, "source.mode", "scene");
  return mode === "inflate" || mode === "bitmap" ? mode : "scene";
}

export function getHalftoneSceneOptions(values: HalftoneRuntimeValues): {
  pitch: number;
  scene: string;
  yaw: number;
} {
  return {
    pitch: num(values, "source.pitch", 7),
    scene: str(values, "source.scene", "stack"),
    yaw: num(values, "source.yaw", 20),
  };
}

export function getHalftoneInflateOptions(values: HalftoneRuntimeValues): {
  domeRadius: number;
  invert: boolean;
  occlusion: number;
  relief: number;
  showMask: boolean;
  threshold: number;
} {
  return {
    domeRadius: num(values, "silhouette.domeRadius", 14),
    invert: bool(values, "silhouette.invert", false),
    occlusion: num(values, "silhouette.occlusion", 0.6),
    relief: num(values, "silhouette.relief", 2.2),
    showMask: bool(values, "silhouette.showMask", false),
    threshold: num(values, "silhouette.threshold", 0.5),
  };
}
