import { describe, expect, it } from "vitest";

import {
  buildRamp,
  buildScaleAxis,
  hash2,
  renderScene,
  resolveCharset,
  type CanvasFactory,
  type SceneOptions,
} from "./halftone";
import { getHalftoneGridSize } from "./halftone-field";
import {
  applyHalftoneBackgroundOverride,
  getHalftoneInflateOptions,
  getHalftonePlacement,
  getHalftoneSceneOptions,
  getHalftoneSourceMode,
  getHalftoneTokens,
} from "./halftone-tokens";
import { resolveHalftoneEffectiveMode } from "./halftone-field";

/* buildRamp measures real glyph ink coverage/metrics through the supplied
   CanvasFactory (2D fillText + getImageData), which the Node/Vitest
   environment has no real rasterizer for. This fake stands in for that
   canvas only -- it does not need to look like real font rendering, only
   to give different glyphs deterministically different simulated ink so
   buildRamp's own sort/pool/selection logic (the code under test) has
   real, non-degenerate multi-glyph pools to operate on. */
function createFakeCanvasFactory(): CanvasFactory {
  return ((_w: number, _h: number) => {
    let lastChar = "0";
    const context = {
      clearRect() {},
      fillRect() {},
      fillText(ch: string) {
        lastChar = ch;
      },
      fillStyle: "",
      font: "",
      getImageData(_x: number, _y: number, width: number, height: number) {
        const alpha = 40 + (lastChar.codePointAt(0)! % 10) * 20;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = alpha;
        return { data };
      },
      measureText(text: string) {
        return {
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          width: text.length * 60,
        };
      },
      textAlign: "center",
      textBaseline: "middle",
    };
    return { getContext: () => context } as unknown as HTMLCanvasElement;
  }) as CanvasFactory;
}

/* These are the automated (non-browser) evidence for appAcceptance rows and
   appPerformance.scenarios. Each test proves that a schema control's value
   really reaches the unmodified engine (or, for light.*, that it changes
   real raymarched output), matching the automatedTestName referenced from
   app-acceptance-data.ts/app-performance.ts.

   source.scene/yaw/pitch no longer have their own tests here: the Scene
   mode and its dials were removed as a user-selectable option (they were
   confirmed scene-only -- inflate() never receives pitch/yaw), so there is
   no schema control left for these to prove reaches the engine. renderScene
   itself is unchanged and stays referenced as buildHalftoneField's no-media
   fallback at its fixed default scene/yaw/pitch values; that fallback's
   determinism is covered by "engine: rendererPipeline recomputes
   deterministically for the same runtime state" in halftone-render.test.ts. */

const baseSceneOptions: SceneOptions = {
  lightDir: [-0.45, 0.78, 0.44],
  pitch: 0,
  rim: 0.55,
  scene: "stack",
  yaw: 0,
};

/* "stack" (three offset boxes) is used for light-direction proofs instead
   of "sphere"/"torus" because those two are rotationally symmetric around
   their own raymarch axes, so mirroring the light direction can legitimately
   reproduce the exact same field. Comparing full arrays (not a summed
   aggregate) avoids a separate false-negative: an aggregate sum can
   coincidentally match under mirror symmetry even when individual cells
   differ. */
function fieldsDiffer(a: { lum: Float32Array }, b: { lum: Float32Array }): boolean {
  return Array.from(a.lum).some((value, index) => value !== b.lum[index]);
}

describe("engine: source and light controls change the raymarched field", () => {
  it("engine: light.rim changes the raymarched field", () => {
    const a = renderScene(24, 24, { ...baseSceneOptions, rim: 0 });
    const b = renderScene(24, 24, { ...baseSceneOptions, rim: 1.2 });
    expect(fieldsDiffer(a, b)).toBe(true);
  });

  it("engine: light.dirX changes the raymarched field", () => {
    const a = renderScene(24, 24, { ...baseSceneOptions, lightDir: [-1, 0.78, 0.44] });
    const b = renderScene(24, 24, { ...baseSceneOptions, lightDir: [1, 0.78, 0.44] });
    expect(fieldsDiffer(a, b)).toBe(true);
  });

  it("engine: light.dirY changes the raymarched field", () => {
    const a = renderScene(24, 24, { ...baseSceneOptions, lightDir: [-0.45, -1, 0.44] });
    const b = renderScene(24, 24, { ...baseSceneOptions, lightDir: [-0.45, 1, 0.44] });
    expect(fieldsDiffer(a, b)).toBe(true);
  });

  it("engine: light.dirZ changes the raymarched field", () => {
    const a = renderScene(24, 24, { ...baseSceneOptions, lightDir: [-0.45, 0.78, -1] });
    const b = renderScene(24, 24, { ...baseSceneOptions, lightDir: [-0.45, 0.78, 1] });
    expect(fieldsDiffer(a, b)).toBe(true);
  });
});

describe("engine: grid controls derive the sampling grid from canvas size", () => {
  it("engine: grid.cellWidth changes the derived grid size", () => {
    const wide = getHalftoneGridSize(1920, 1080, 16, 1.35);
    const narrow = getHalftoneGridSize(1920, 1080, 4, 1.35);
    expect(narrow.cols).toBeGreaterThan(wide.cols);
  });

  it("engine: grid.cellAspect changes the derived grid size", () => {
    const tall = getHalftoneGridSize(1920, 1080, 8, 2.2);
    const flat = getHalftoneGridSize(1920, 1080, 8, 0.8);
    expect(flat.rows).toBeGreaterThan(tall.rows);
  });

  it("engine: columns and rows are derived from the runtime canvas size, not settable controls", () => {
    /* The grid model is settled: cellWidth/cellAspect are the only product
       controls; columns/rows have no schema target and must react purely
       to state.canvas.size at a fixed cellWidth/cellAspect. */
    const full = getHalftoneGridSize(1920, 1080, 8, 1.35);
    const halfWidth = getHalftoneGridSize(960, 1080, 8, 1.35);
    const halfHeight = getHalftoneGridSize(1920, 540, 8, 1.35);
    const quarterCanvas = getHalftoneGridSize(960, 540, 8, 1.35);

    expect(halfWidth.cols).toBeLessThan(full.cols);
    expect(halfWidth.rows).toBe(full.rows);
    expect(halfHeight.rows).toBeLessThan(full.rows);
    expect(halfHeight.cols).toBe(full.cols);
    expect(quarterCanvas.cols).toBeLessThan(full.cols);
    expect(quarterCanvas.rows).toBeLessThan(full.rows);

    // Roughly proportional, not just "smaller": halving one canvas
    // dimension should roughly halve the corresponding cell count.
    expect(Math.abs(halfWidth.cols - full.cols / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(halfHeight.rows - full.rows / 2)).toBeLessThanOrEqual(2);
  });
});

describe("engine: character controls change the tone-ramp inputs", () => {
  it("engine: character.mode selects the correct charset", () => {
    expect(resolveCharset("binary")).toEqual(["0", "1"]);
    expect(resolveCharset("digits")).toHaveLength(10);
    expect(resolveCharset("pnl")).toHaveLength(18);
  });

  it("engine: character.customChars parses the custom charset", () => {
    expect(resolveCharset("custom", "XYZ")).toEqual(["X", "Y", "Z"]);
    expect(resolveCharset("custom", "")).toEqual(["0", "1"]);
  });

  it("engine: character.variety maps into engine tokens", () => {
    const low = getHalftoneTokens({ "character.variety": 0 });
    const high = getHalftoneTokens({ "character.variety": 1 });
    expect(low.variety).not.toBe(high.variety);
  });

  it("engine: character.size maps into engine tokens", () => {
    const tokens = getHalftoneTokens({ "character.size": 1.8 });
    expect(tokens.charSize).toBe(1.8);
  });

  it("engine: character.sizeVariation changes the ramp scale axis", () => {
    const flat = buildScaleAxis(0, 3);
    const varied = buildScaleAxis(1, 3);
    expect(varied).not.toEqual(flat);
  });

  it("engine: character.sizeSteps changes the ramp scale axis length", () => {
    const few = buildScaleAxis(0.5, 2);
    const many = buildScaleAxis(0.5, 6);
    expect(many.length).toBeGreaterThan(few.length);
  });

  it("engine: character.weight maps into engine tokens", () => {
    expect(getHalftoneTokens({ "character.weight": "300" }).weight).toBe(300);
    expect(getHalftoneTokens({ "character.weight": "400" }).weight).toBe(400);
    expect(getHalftoneTokens({ "character.weight": "500" }).weight).toBe(500);
    expect(getHalftoneTokens({ "character.weight": "700" }).weight).toBe(700);
  });
});

describe("engine: glyph pool selection is deterministic", () => {
  it("engine: hash2 is a pure function of grid position", () => {
    /* Same (x, y) called repeatedly, and from unrelated call sites, must
       always return the same value -- the guarantee drawHalftone relies on
       (hash2(i, j) % pool.length) to reproduce output across runs. */
    expect(hash2(7, 13)).toBe(hash2(7, 13));
    expect(hash2(7, 13)).toBe(hash2(7, 13));
    expect(hash2(0, 0)).toBe(hash2(0, 0));
    expect(hash2(400, -12)).toBe(hash2(400, -12));
  });

  it("engine: the same grid position always selects the same glyph from its ramp pool across independently rebuilt ramps", () => {
    const tokens = getHalftoneTokens({
      "character.mode": "digits",
      "character.sizeSteps": 3,
      "character.sizeVariation": 0.35,
      "character.variety": 1,
      "tone.steps": 8,
    });
    const makeCanvas = createFakeCanvasFactory();

    const rampRunA = buildRamp(tokens, makeCanvas);
    const rampRunB = buildRamp(tokens, makeCanvas);

    // The ramp itself (the sorted/sampled pool structure) must reproduce
    // byte-for-byte across independent builds of the same tokens.
    expect(rampRunB).toEqual(rampRunA);

    const levelWithChoice = rampRunA.findIndex((pool) => pool && pool.length > 1);
    expect(
      levelWithChoice,
      "fixture tokens must produce at least one multi-glyph pool to prove selection, not just construction.",
    ).toBeGreaterThan(0);

    const pool = rampRunA[levelWithChoice]!;
    const positions: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [5, 3],
      [12, 9],
      [40, 7],
    ];

    for (const [i, j] of positions) {
      const slotA = hash2(i, j) % pool.length;
      const slotB = hash2(i, j) % rampRunB[levelWithChoice]!.length;
      // Same grid position + same input tokens -> same slot -> same glyph,
      // across two independently rebuilt ramps ("across runs").
      expect(slotB).toBe(slotA);
      expect(rampRunB[levelWithChoice]![slotB]).toEqual(pool[slotA]);
    }

    // The selection must be real, not degenerate: across a handful of grid
    // positions, more than one distinct slot in the pool should get chosen.
    const distinctSlots = new Set(positions.map(([i, j]) => hash2(i, j) % pool.length));
    expect(distinctSlots.size).toBeGreaterThan(1);
  });
});

function expectRampLevelsMonotonic(ramp: ReturnType<typeof buildRamp>): void {
  const levels = ramp.slice(1) as readonly (readonly { v: number }[])[];

  // Adjacent levels' pools are allowed to overlap at their tails (combos
  // within half a tone step are treated as perceptually interchangeable
  // by design), so the meaningful non-inversion check is each level's
  // mean ink value trending upward across the *entire* sweep, not a
  // strict per-level min/max boundary.
  const levelMeanV = levels.map(
    (pool) => pool.reduce((sum, combo) => sum + combo.v, 0) / pool.length,
  );

  for (let level = 1; level < levelMeanV.length; level += 1) {
    expect(
      levelMeanV[level],
      `ramp level ${level}'s mean ink value must not fall below level ${level - 1}'s (a tonal inversion).`,
    ).toBeGreaterThanOrEqual(levelMeanV[level - 1]);
  }
}

describe("engine: the tone ramp is monotonic across the full tonal range", () => {
  it.each([2, 3, 5, 8, 12])(
    "engine: buildRamp's levels are ordered by non-decreasing ink value for tone.steps=%i",
    (steps) => {
      /* buildRamp sorts every (glyph, alpha, size) combination by
         perceived ink `v` and samples evenly across that sorted range into
         `steps` levels. Sweeping steps values (not just one fixed count)
         makes sure the ordering holds regardless of how finely the range
         is sampled -- a single inverted pair anywhere, at any step count,
         would fail this. */
      const tokens = getHalftoneTokens({
        "character.mode": "pnl",
        "character.sizeSteps": 4,
        "character.sizeVariation": 0.6,
        "character.variety": 0.6,
        "tone.steps": steps,
      });
      const ramp = buildRamp(tokens, createFakeCanvasFactory());
      const levels = ramp.slice(1);

      expect(levels.length).toBe(Math.max(2, steps) - 1);
      expectRampLevelsMonotonic(ramp);

      const levelMeanV = levels.map(
        (pool) => pool!.reduce((sum, combo) => sum + combo.v, 0) / pool!.length,
      );
      if (levelMeanV.length > 1) {
        expect(levelMeanV[levelMeanV.length - 1]).toBeGreaterThan(levelMeanV[0]);
      }
    },
  );

  it("engine: tone.steps at its schema minimum (2) builds a valid single-level ramp with no divide-by-zero or NaN", () => {
    /* n = max(2, round(steps)) - 1 collapses to 1 at steps=2, so buildRamp's
       spacing calculation takes its "just one level" branch ((hi - lo),
       not divided by (n - 1) = 0) and drawHalftone's `1 / levels` also
       sees levels = ramp.length - 1 = 1, never 0. This proves the
       schema-declared floor renders a real, finite, valid ramp rather than
       hitting either divide-by-zero path. */
    const tokens = getHalftoneTokens({ "tone.steps": 2 });
    const ramp = buildRamp(tokens, createFakeCanvasFactory());

    expect(ramp).toHaveLength(2);
    expect(ramp[0]).toBeNull();
    const onlyLevel = ramp[1]!;
    expect(onlyLevel.length).toBeGreaterThan(0);

    for (const combo of onlyLevel) {
      expect(Number.isFinite(combo.v)).toBe(true);
      expect(Number.isFinite(combo.alpha)).toBe(true);
      expect(Number.isFinite(combo.scale)).toBe(true);
      expect(combo.char.length).toBeGreaterThan(0);
    }
  });
});

describe("engine: tone controls map into engine tokens", () => {
  it("engine: tone.backgroundCutoff maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.backgroundCutoff": 0.2 }).bgCutoff).toBe(0.2);
  });

  it("engine: tone.steps maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.steps": 11 }).steps).toBe(11);
  });

  it("engine: tone.blackPoint maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.blackPoint": 0.3 }).black).toBe(0.3);
  });

  it("engine: tone.whitePoint maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.whitePoint": 0.6 }).white).toBe(0.6);
  });

  it("engine: tone.gamma maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.gamma": 2 }).gamma).toBe(2);
  });

  it("engine: tone.dither maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.dither": 0.9 }).dither).toBe(0.9);
  });

  it("engine: tone.edgeLift maps into engine tokens", () => {
    expect(getHalftoneTokens({ "tone.edgeLift": 1.1 }).edgeLift).toBe(1.1);
  });
});

describe("engine: appearance and background controls map into engine tokens", () => {
  it("engine: appearance.ink maps into engine tokens", () => {
    /* The Toolcraft "color" control commits edits as { hex } (see
       ColorControlField.updateColor in the runtime UI), not a bare string,
       even though the schema's defaultValue is a plain hex string. A test
       that only ever passes a plain string would never have caught the
       real bug: state.values["appearance.ink"] is { hex: "#ff00ff" } once
       a user actually edits the field, not "#ff00ff". */
    expect(getHalftoneTokens({ "appearance.ink": "#ff00ff" }).ink).toBe("#ff00ff");
    expect(getHalftoneTokens({ "appearance.ink": { hex: "#ff00ff" } }).ink).toBe("#ff00ff");
  });

  it("engine: appearance.background maps into engine tokens", () => {
    expect(getHalftoneTokens({ "appearance.background": "#123456" }).bg).toBe("#123456");
    expect(getHalftoneTokens({ "appearance.background": { hex: "#123456" } }).bg).toBe("#123456");
  });

  it("engine: export.includeBackground toggles the preview/export background token", () => {
    const tokens = getHalftoneTokens({ "appearance.background": "#123456" });
    expect(applyHalftoneBackgroundOverride(tokens, true).bg).toBe("#123456");
    expect(applyHalftoneBackgroundOverride(tokens, false).bg).toBe("transparent");
  });
});

describe("engine: placement controls map into the sampling options", () => {
  it("engine: placement.fit maps into placement options", () => {
    expect(getHalftonePlacement({ "placement.fit": "contain" }).fit).toBe("contain");
    expect(getHalftonePlacement({ "placement.fit": "cover" }).fit).toBe("cover");
    expect(getHalftonePlacement({ "placement.fit": "stretch" }).fit).toBe("stretch");
  });

  it("engine: placement.zoom maps into placement options", () => {
    expect(getHalftonePlacement({ "placement.zoom": 2.4 }).zoom).toBe(2.4);
  });

  it("engine: placement.panX maps into placement options", () => {
    expect(getHalftonePlacement({ "placement.panX": 0.3 }).panX).toBe(0.3);
  });

  it("engine: placement.panY maps into placement options", () => {
    expect(getHalftonePlacement({ "placement.panY": -0.3 }).panY).toBe(-0.3);
  });
});

describe("engine: silhouette controls map into the inflate options", () => {
  it("engine: silhouette.threshold maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.threshold": 0.75 }).threshold).toBe(0.75);
  });

  it("engine: silhouette.invert maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.invert": true }).invert).toBe(true);
  });

  it("engine: silhouette.showMask maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.showMask": true }).showMask).toBe(true);
  });

  it("engine: silhouette.domeRadius maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.domeRadius": 30 }).domeRadius).toBe(30);
  });

  it("engine: silhouette.relief maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.relief": 4 }).relief).toBe(4);
  });

  it("engine: silhouette.occlusion maps into inflate options", () => {
    expect(getHalftoneInflateOptions({ "silhouette.occlusion": 1.1 }).occlusion).toBe(1.1);
  });
});

describe("engine: source mode selects the effective render pipeline", () => {
  it("engine: source.mode selects the effective render pipeline", () => {
    expect(getHalftoneSourceMode({ "source.mode": "inflate" })).toBe("inflate");
    expect(getHalftoneSourceMode({ "source.mode": "bitmap" })).toBe("bitmap");
    // "scene" is no longer a selectable option, but the reader still
    // resolves it safely (as it would any other invalid/stale stored
    // value) to the internal no-media effective mode.
    expect(getHalftoneSourceMode({ "source.mode": "scene" })).toBe("scene");
    // With no stored value at all, the reader falls back to the schema's
    // real default (bitmap), not the removed Scene mode.
    expect(getHalftoneSourceMode({})).toBe("bitmap");
  });

  it("engine: source.image without an attached image falls back to the procedural scene", () => {
    expect(resolveHalftoneEffectiveMode("inflate", false)).toBe("scene");
    expect(resolveHalftoneEffectiveMode("bitmap", false)).toBe("scene");
    expect(resolveHalftoneEffectiveMode("inflate", true)).toBe("inflate");
  });

  it("engine: the no-media fallback scene uses fixed default scene/yaw/pitch values", () => {
    /* source.scene/yaw/pitch no longer exist as controls, so state.values
       can never carry these keys -- getHalftoneSceneOptions always falls
       back to the reference's original defaults (stack/20/7) for the
       no-media scene render. */
    expect(getHalftoneSceneOptions({})).toEqual({ pitch: 7, scene: "stack", yaw: 20 });
    expect(getHalftoneSceneOptions({ "character.mode": "pnl" })).toEqual({
      pitch: 7,
      scene: "stack",
      yaw: 20,
    });
  });
});
