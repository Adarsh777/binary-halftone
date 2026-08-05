import { describe, expect, it } from "vitest";
import type { ToolcraftActionSchema } from "@/toolcraft/runtime";

import { appSchema } from "./app-schema";
import { applyHalftoneSourceResize, buildHalftoneField } from "./halftone-field";
import {
  getHalftoneEffectiveFill,
  inkCoverage,
  placeImage,
  srcDims,
  type CanvasFactory,
  type HalftoneSourceMedia,
} from "./halftone";

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    getContext: () => ({ drawImage: () => {} }),
    height,
    width,
  } as unknown as HTMLCanvasElement;
}

function getControl(target: string) {
  for (const section of appSchema.panels.controls?.sections ?? []) {
    for (const control of Object.values(section.controls)) {
      if (control.target === target) return control;
    }
  }
  return undefined;
}

describe("engine: export settings are wired to real schema controls", () => {
  it("engine: source.image is a real fileDrop upload control", () => {
    const control = getControl("source.image");
    expect(control?.type).toBe("fileDrop");
    expect(control?.assetKind).toBe("image");
  });

  it("engine: export.image.format maps to a real PNG/JPG export choice", () => {
    const control = getControl("export.image.format");
    expect(control?.type).toBe("select");
    expect(control?.defaultValue).toBe("png");
    expect(control?.options?.map((option) => option.value)).toEqual(
      expect.arrayContaining(["png", "jpg"]),
    );
  });

  it("engine: export.image.resolution maps to a real 2K/4K/8K export choice", () => {
    const control = getControl("export.image.resolution");
    expect(control?.type).toBe("select");
    expect(control?.defaultValue).toBe("4k");
    expect(control?.options?.map((option) => option.value)).toEqual(
      expect.arrayContaining(["2k", "4k", "8k"]),
    );
  });

  it("engine: the sticky Export section exposes Export PNG and Copy Tokens actions", () => {
    const control = getControl("actions.output");
    expect(control?.type).toBe("panelActions");
    const actions = (control?.actions ?? []).filter(
      (action): action is ToolcraftActionSchema => typeof action !== "string",
    );
    expect(actions.some((action) => action.role === "export-image" && action.value === "export.png")).toBe(
      true,
    );
    expect(actions.some((action) => action.role === "copy-output" && action.value === "copy.tokens")).toBe(
      true,
    );
  });
});

describe("engine: the render pipeline is deterministic for repeated calls", () => {
  it("engine: rendererPipeline recomputes deterministically for the same runtime state", () => {
    const makeCanvas = (w: number, h: number) => {
      throw new Error(`unexpected canvas request ${w}x${h} for the no-media empty-field pipeline`);
    };
    const input = {
      bgCutoff: 0.045,
      cols: 32,
      inflateOptions: {
        domeRadius: 14,
        invert: false,
        occlusion: 0.6,
        relief: 2.2,
        showMask: false,
        threshold: 0.5,
      },
      lightDir: [-0.45, 0.78, 0.44] as const,
      makeCanvas,
      media: null,
      mode: "scene" as const,
      pitch: 7,
      place: { cellAspect: 1.35, fit: "contain" as const, panX: 0, panY: 0, zoom: 0.95 },
      rim: 0.55,
      rows: 24,
      scene: "stack",
      yaw: 20,
    };

    const first = buildHalftoneField(input);
    const second = buildHalftoneField(input);
    expect(Array.from(second.lum)).toEqual(Array.from(first.lum));
    expect(Array.from(second.alive)).toEqual(Array.from(first.alive));
  });
});

describe("engine: no media attached renders a genuinely blank field, not a procedural fallback", () => {
  /* docs/toolcraft/core/media-upload.md's Empty Source State rule: "the
     empty product canvas stays neutral" -- no invented placeholder, and
     (per this session's follow-up) no procedural default either, since
     that reference-defined exception was deliberately given up in favor
     of a blank canvas. This proves buildHalftoneField's no-media branch
     returns a field with every cell dead (alive=0) and zero luminance,
     for both mode values -- not renderScene's raymarched output, which
     would have non-zero alive cells and varied lum. A makeCanvas that
     throws proves no image-sampling canvas work happens either. */
  function throwingCanvas(w: number, h: number): never {
    throw new Error(`unexpected canvas request ${w}x${h} for a no-media build`);
  }

  function noMediaInput(mode: "bitmap" | "inflate") {
    return {
      bgCutoff: 0.045,
      cols: 16,
      inflateOptions: {
        domeRadius: 14,
        invert: false,
        occlusion: 0.6,
        relief: 2.2,
        showMask: false,
        threshold: 0.5,
      },
      lightDir: [-0.45, 0.78, 0.44] as const,
      makeCanvas: throwingCanvas,
      media: null,
      mode,
      pitch: 7,
      place: { cellAspect: 1.35, fit: "contain" as const, panX: 0, panY: 0, zoom: 0.95 },
      rim: 0.55,
      rows: 16,
      scene: "stack",
      yaw: 20,
    };
  }

  it.each(["bitmap", "inflate"] as const)(
    "engine: buildHalftoneField(media: null, mode: %s) returns an all-dead, zero-luminance field",
    (mode) => {
      const field = buildHalftoneField(noMediaInput(mode));

      expect(field.W).toBe(16);
      expect(field.H).toBe(16);
      expect(Array.from(field.alive).every((value) => value === 0)).toBe(true);
      expect(Array.from(field.lum).every((value) => value === 0)).toBe(true);
    },
  );
});

describe("engine: source.image.width/height reach placeImage without stretching the source", () => {
  it("applyHalftoneSourceResize makes srcDims report the custom size, not the media's natural size", () => {
    const media = { naturalHeight: 100, naturalWidth: 100 } as unknown as HalftoneSourceMedia;
    const resized = applyHalftoneSourceResize(media, { height: 100, width: 400 }, fakeCanvas);
    expect(srcDims(resized)).toEqual({ h: 100, w: 400 });
  });

  it("leaves the media untouched when no custom size is set", () => {
    const media = { naturalHeight: 100, naturalWidth: 100 } as unknown as HalftoneSourceMedia;
    expect(applyHalftoneSourceResize(media, undefined, fakeCanvas)).toBe(media);
    expect(applyHalftoneSourceResize(media, {}, fakeCanvas)).toBe(media);
  });

  it("a non-square custom size survives placeImage's cellAspect correction without stretching", () => {
    const media = { naturalHeight: 100, naturalWidth: 100 } as unknown as HalftoneSourceMedia;
    // A 4:1 custom size on an originally-square (1:1) source: if the resize
    // bypassed srcDims (the documented vertical-stretch bug's shape), this
    // would still measure as 1:1 here instead of 4:1.
    const resized = applyHalftoneSourceResize(media, { height: 100, width: 400 }, fakeCanvas);

    const drawImageCalls: unknown[][] = [];
    const ctx = {
      drawImage: (...args: unknown[]) => drawImageCalls.push(args),
    } as unknown as CanvasRenderingContext2D;

    const cellAspect = 1.35;
    placeImage(ctx, resized, 200, 200, { cellAspect, fit: "contain", panX: 0, panY: 0, zoom: 1 });

    const [, , , dw, dh] = drawImageCalls[0] as [unknown, number, number, number, number];
    // dw/dh here are in *cell-space* (the WxH canvas is cols x rows, not
    // real pixels); the final render later stretches each cell's row by
    // cellAspect (cellW x cellW*cellAspect pixels), which is exactly what
    // recovers the true image aspect -- so the real-pixel aspect ratio is
    // dw / (dh * cellAspect), not the raw dw/dh.
    expect(dw / (dh * cellAspect)).toBeCloseTo(400 / 100, 5);
  });
});

/* A fake canvas whose measured "coverage" is deterministically derived from
   whichever font-size string inkCoverage actually requested, so these tests
   can prove the *wiring* (does inkCoverage ask for a size proportional to
   the effective fill?) without needing real font rasterization. */
function fakeMeasuringCanvas(): CanvasFactory {
  let lastFont = "";
  return (w: number, h: number) =>
    ({
      getContext: () => ({
        clearRect: () => {},
        fillText: () => {},
        get font() {
          return lastFont;
        },
        set font(value: string) {
          lastFont = value;
        },
        getImageData: () => {
          const match = /(\d+(?:\.\d+)?)px/.exec(lastFont);
          const size = match ? Number(match[1]) : 0;
          const alpha = Math.max(0, Math.min(255, Math.round(size * 3)));
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 3; i < data.length; i += 4) data[i] = alpha;
          return { data };
        },
      }),
      height: h,
      width: w,
    }) as unknown as HTMLCanvasElement;
}

describe("engine: character.scale composes with charSize without overflowing the cell and re-measures ink coverage", () => {
  it("getHalftoneEffectiveFill never exceeds 1 no matter how large scale is (composes with charSize, not past it)", () => {
    expect(getHalftoneEffectiveFill(1, 1)).toBe(1);
    expect(getHalftoneEffectiveFill(1, 100)).toBe(1);
    expect(getHalftoneEffectiveFill(0.8, 1.5)).toBe(1);
    expect(getHalftoneEffectiveFill(0.5, 0.5)).toBeCloseTo(0.25, 5);
    expect(getHalftoneEffectiveFill(0.05, 0.01)).toBe(0.05);
  });

  it("inkCoverage measures at a size proportional to the effective fill, so scale changes the ramp's real coverage value", () => {
    const canvas = fakeMeasuringCanvas();
    const covFull = inkCoverage("1", "monospace", 400, canvas, 1);
    const covSmall = inkCoverage("1", "monospace", 400, canvas, 0.1);
    expect(covSmall).toBeLessThan(covFull);
  });

  it("caches coverage independently per size fraction, instead of reusing a stale measurement from a different scale", () => {
    const canvas = fakeMeasuringCanvas();
    const covA = inkCoverage("1", "monospace", 400, canvas, 1);
    const covB = inkCoverage("1", "monospace", 400, canvas, 0.5);
    const covARepeat = inkCoverage("1", "monospace", 400, canvas, 1);
    expect(covARepeat).toBe(covA);
    expect(covB).not.toBe(covA);
  });
});
