import zlib from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  HALFTONE_CONTROL_CONFIGS,
  getHalftoneControlConfig,
  type HalftoneControlConfig,
} from "../src/app/halftone-control-catalog";
import { getToolcraftControlFieldByTarget } from "./browser-control-target-helpers";
import { dragToolcraftSliderByTarget } from "./performance-slider-helpers";

export { HALFTONE_CONTROL_CONFIGS, getHalftoneControlConfig, type HalftoneControlConfig };

/* ---------- minimal solid-color PNG encoder ----------
   Used only to produce real, decodable image fixtures for fileDrop upload
   tests (setInputFiles needs real bytes, not a data URL). No dependency on
   an npm image library; a solid-color 24-bit RGB PNG is a handful of
   well-known chunks. */
const crcTable: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export function createSolidColorPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number] = [120, 120, 120],
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* Small fixture for tests that only need media *attached* so a media-driven
   source.mode stops falling back to "scene". Large fixture matches the
   1920x1080-equivalent minimum performance.md requires for media workload
   scenarios. */
export function createSmallFixturePng(): Buffer {
  return createSolidColorPng(64, 64, [110, 130, 150]);
}

/* A solid-color fixture is invariant under rotation/flip (every sampled
   pixel has the same luminance), so it can never prove a rotate/flip
   transform actually changes rendered output. This fixture instead paints
   four different-luminance quadrants (bright top-left, dark elsewhere) so
   any 90-degree rotation or axis flip measurably changes which grid cells
   read as "alive"/bright once source.mode reads the uploaded image. */
export function createOrientedFixturePng(): Buffer {
  const width = 64;
  const height = 64;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const quadrants: readonly [number, number, number][] = [
    [245, 245, 245],
    [40, 40, 40],
    [40, 40, 40],
    [40, 40, 40],
  ];
  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0; // no filter
    const quadrantRow = y < height / 2 ? 0 : 1;
    for (let x = 0; x < width; x += 1) {
      const quadrantCol = x < width / 2 ? 0 : 1;
      const rgb = quadrants[quadrantRow * 2 + quadrantCol]!;
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createLargeFixturePng(): Buffer {
  return createSolidColorPng(1920, 1080, [110, 130, 150]);
}

/* readKeyField (used by the Silhouette/inflate source) samples luminance
   from the placed image, but only when the canvas has no transparent
   pixels: if any letterboxed/cleared border shows through (any fit at the
   default zoom < 1, or "contain" against a mismatched aspect), the whole
   key field silently switches to reading alpha instead of RGB luminance,
   collapsing to a flat opaque-rectangle-vs-transparent-border mask. That
   mask is binary (fully in vs fully out), so both silhouette.threshold
   (any value strictly between 0 and 1 yields the identical mask) and
   silhouette.invert (inverting a small centered blob floods the border,
   which inflate()'s own "subject shouldn't flood the frame" heuristic
   auto-flips right back to the original mask) become unprovable with a
   solid or quadrant fixture. A real vertical luminance gradient, combined
   with a full-bleed placement (Cover fit + zoom >= 1, see
   requiresLuminanceGradientFixture), keeps hasAlpha false and gives every
   threshold value a genuinely different boundary row and gives invert a
   real (non-self-canceling) foreground/background swap.

   The fixture is generated at the default canvas's 16:9 aspect (not a
   square), so Cover fit at zoom = 1 shows the *entire* gradient with no
   cropping and no letterbox: at any other aspect, Cover overflows and
   crops the taller axis to fill the shorter one, silently hiding the
   gradient's actual extreme rows (e.g. pure black at y=0) behind the
   canvas edge even though hasAlpha still reads false. */
export function createGradientFixturePng(): Buffer {
  const width = 320;
  const height = 180;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0; // no filter
    const shade = Math.round((y / (height - 1)) * 255);
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = shade;
      raw[offset + 1] = shade;
      raw[offset + 2] = shade;
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- minimal PNG pixel decoder ----------
   Decodes a real PNG (as produced by canvas.toDataURL/toBlob, not just the
   solid-color fixtures encoded above) into raw per-pixel RGBA bytes, so
   export-artifact tests can assert genuine per-pixel alpha values instead of
   only the IHDR color-type byte (which proves the format *can* carry alpha,
   not that any given pixel actually is transparent). Handles the adaptive
   per-scanline filtering (None/Sub/Up/Average/Paeth) real PNG encoders use,
   not just the always-filter-0 output of the encoder above. */
export type DecodedPng = {
  bitDepth: number;
  colorType: number;
  height: number;
  pixels: Uint8Array;
  width: number;
};

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Not a PNG file (bad signature).");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buffer.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (bitDepth !== 8) {
    throw new Error(`decodePng only supports 8-bit PNGs, got bitDepth ${bitDepth}.`);
  }

  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!channels) {
    throw new Error(`decodePng does not support color type ${colorType}.`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = channels; // bytes per complete pixel at 8-bit depth
  const rowBytes = width * bpp;
  const pixels = new Uint8Array(width * height * bpp);
  let rawOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * rowBytes;
    const priorRowStart = rowStart - rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const filtByte = raw[rawOffset + x]!;
      const a = x >= bpp ? pixels[rowStart + x - bpp]! : 0;
      const b = y > 0 ? pixels[priorRowStart + x]! : 0;
      const c = y > 0 && x >= bpp ? pixels[priorRowStart + x - bpp]! : 0;
      let value: number;

      switch (filterType) {
        case 0:
          value = filtByte;
          break;
        case 1:
          value = filtByte + a;
          break;
        case 2:
          value = filtByte + b;
          break;
        case 3:
          value = filtByte + Math.floor((a + b) / 2);
          break;
        case 4:
          value = filtByte + paethPredictor(a, b, c);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filterType}.`);
      }

      pixels[rowStart + x] = value & 0xff;
    }

    rawOffset += rowBytes;
  }

  return { bitDepth, colorType, height, pixels, width };
}

export function getPngPixelAt(
  decoded: DecodedPng,
  x: number,
  y: number,
): { a: number; b: number; g: number; r: number } {
  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[decoded.colorType]!;
  const index = (y * decoded.width + x) * channels;

  if (decoded.colorType === 6) {
    return {
      a: decoded.pixels[index + 3]!,
      b: decoded.pixels[index + 2]!,
      g: decoded.pixels[index + 1]!,
      r: decoded.pixels[index]!,
    };
  }
  if (decoded.colorType === 2) {
    return {
      a: 255,
      b: decoded.pixels[index + 2]!,
      g: decoded.pixels[index + 1]!,
      r: decoded.pixels[index]!,
    };
  }
  throw new Error(`getPngPixelAt does not support color type ${decoded.colorType}.`);
}

/* The halftone grid tiles the whole canvas, so there is no coordinate known
   in advance to be a pure "background" pixel -- but the background fill is
   overwhelmingly the most common color (glyphs are sparse ink on a large
   fill), so sampling for the modal color reliably finds one. Coordinates are
   returned so a second, differently-composited export (e.g. with the
   background excluded) can be inspected at the exact same pixel. */
export function findMostCommonPixelCoordinate(
  decoded: DecodedPng,
  predicate: (pixel: { a: number; b: number; g: number; r: number }) => boolean = () => true,
  sampleStride = 4,
): { x: number; y: number } {
  const counts = new Map<string, { count: number; x: number; y: number }>();

  for (let y = 0; y < decoded.height; y += sampleStride) {
    for (let x = 0; x < decoded.width; x += sampleStride) {
      const pixel = getPngPixelAt(decoded, x, y);
      if (!predicate(pixel)) continue;
      const key = `${pixel.r},${pixel.g},${pixel.b}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { count: 1, x, y });
      }
    }
  }

  let best: { count: number; x: number; y: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  if (!best) {
    throw new Error("No pixel matched the given predicate.");
  }
  return { x: best.x, y: best.y };
}

/* Finds the rendered footprint of the placed source: the bounding box of
   every sampled pixel that differs from the background fill. Used to prove
   a custom source size's real-pixel aspect ratio (bbox width / bbox height)
   matches the source's true aspect ratio -- the same measurement the
   cellAspect vertical-stretch bug (see halftone-image.ts placeImage) would
   visibly violate. */
export function findContentBoundingBox(
  decoded: DecodedPng,
  backgroundColor: { b: number; g: number; r: number },
  colorTolerance = 24,
  sampleStride = 2,
): { height: number; width: number; x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;

  for (let y = 0; y < decoded.height; y += sampleStride) {
    for (let x = 0; x < decoded.width; x += sampleStride) {
      const pixel = getPngPixelAt(decoded, x, y);
      const isBackground =
        Math.abs(pixel.r - backgroundColor.r) <= colorTolerance &&
        Math.abs(pixel.g - backgroundColor.g) <= colorTolerance &&
        Math.abs(pixel.b - backgroundColor.b) <= colorTolerance;
      if (isBackground) continue;

      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  if (!Number.isFinite(x0)) {
    throw new Error("No non-background content found to bound.");
  }

  return { height: y1 - y0, width: x1 - x0, x0, x1, y0, y1 };
}

export async function uploadHalftoneFixtureImage(
  page: Page,
  buffer: Buffer = createSmallFixturePng(),
): Promise<void> {
  const field = await getToolcraftControlFieldByTarget(page, "source.image");
  const input = field.locator('input[type="file"]');
  await input.setInputFiles({
    buffer,
    mimeType: "image/png",
    name: "halftone-fixture.png",
  });
  await expect(
    page.getByRole("img", { name: "halftone-fixture.png" }),
    "Uploaded fixture image should appear in the source.image fileDrop preview.",
  ).toBeVisible({ timeout: 10_000 });
}

async function chooseSelectOption(page: Page, target: string, optionLabel: string): Promise<void> {
  const field = await getToolcraftControlFieldByTarget(page, target);
  await field.getByRole("combobox").click();
  await page.locator('[role="option"]').filter({ hasText: optionLabel }).first().click();
}

export async function switchSourceMode(
  page: Page,
  mode: "bitmap" | "inflate",
): Promise<void> {
  const optionLabel = mode === "inflate" ? "Silhouette" : "Image";
  await chooseSelectOption(page, "source.mode", optionLabel);
}

export async function switchCharacterMode(
  page: Page,
  mode: "binary" | "custom" | "digits" | "pnl",
): Promise<void> {
  const optionLabel =
    mode === "custom"
      ? "Custom"
      : mode === "digits"
        ? "Digits"
        : mode === "pnl"
          ? "P&L"
          : "Binary";
  await chooseSelectOption(page, "character.mode", optionLabel);
}

async function selectOptionInField(field: Locator, page: Page, optionLabel: string): Promise<void> {
  await field.getByRole("combobox").click();
  await page.locator('[role="option"]').filter({ hasText: optionLabel }).first().click();
}

/* Puts the panel into the state where `config`'s control is visible and,
   for media-driven sources, where its effect actually reaches the renderer
   (source.mode/character.mode alone only control panel visibility; an
   attached image is what makes the mode's field pipeline run instead of
   silently falling back to the procedural scene). */
export async function prepareHalftoneControlVisibility(
  page: Page,
  config: HalftoneControlConfig,
): Promise<void> {
  if (config.requiresMedia) {
    /* source.image is unconditionally visible now (both remaining modes
       need it), but its effect on the render still depends on being in a
       real source mode with media attached -- reveal/attach that first
       (falling back to "bitmap" for controls, like source.mode itself,
       that don't otherwise require a specific source mode) so the upload
       actually reaches the field pipeline instead of the no-media fallback. */
    await switchSourceMode(page, config.requiresSourceMode ?? config.requiresSourceModeContext ?? "bitmap");
    await uploadHalftoneFixtureImage(page);
  }
  if (config.requiresSourceMode) {
    await switchSourceMode(page, config.requiresSourceMode);
  } else if (config.requiresSourceModeContext) {
    await switchSourceMode(page, config.requiresSourceModeContext);
  }
  if (config.requiresCharacterMode) {
    await switchCharacterMode(page, config.requiresCharacterMode);
  }
}

/* Applies a real user interaction to `config`'s control. `variant: "stress"`
   drives toward the heaviest declared value/option for performance scenarios;
   "primary" is an ordinary mid-range change for acceptance rows. */
export async function applyHalftoneControlChange(
  page: Page,
  config: HalftoneControlConfig,
  variant: "primary" | "stress",
): Promise<void> {
  switch (config.kind) {
    case "slider": {
      const ratio =
        variant === "stress"
          ? (config.sliderStressRatio ?? 0.9)
          : (config.primarySliderRatio ?? 0.6);
      await dragToolcraftSliderByTarget(page, config.target, ratio);
      return;
    }
    case "select": {
      const label =
        variant === "stress" && config.selectHeaviestOptionLabel
          ? config.selectHeaviestOptionLabel
          : config.selectOptionLabel!;
      const field = await getToolcraftControlFieldByTarget(page, config.target);
      await selectOptionInField(field, page, label);
      return;
    }
    case "switch": {
      const field = await getToolcraftControlFieldByTarget(page, config.target);
      await field.getByRole("switch").click();
      return;
    }
    case "color": {
      const field = await getToolcraftControlFieldByTarget(page, config.target);
      const input = field.locator('input[type="text"]').first();
      await input.fill(variant === "stress" ? "#ff8800" : "#3366ff");
      await input.press("Enter");
      return;
    }
    case "text": {
      const field = await getToolcraftControlFieldByTarget(page, config.target);
      const input = field.getByRole("textbox");
      const stressValue = config.textStressValue ?? "$%()+-.,0123456789";
      const primaryValue = config.textPrimaryValue ?? "01XY";
      await input.fill(variant === "stress" ? stressValue : primaryValue);
      await input.press("Tab");
      return;
    }
    case "fileDrop": {
      await uploadHalftoneFixtureImage(
        page,
        variant === "stress" ? createLargeFixturePng() : createSmallFixturePng(),
      );
      return;
    }
  }
}

export async function selectHalftoneGateOption(
  page: Page,
  gateTarget: string,
  optionLabel: string,
): Promise<void> {
  const field = await getToolcraftControlFieldByTarget(page, gateTarget);
  await selectOptionInField(field, page, optionLabel);
}
