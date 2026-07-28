# binary-halftone

Renders images and procedural 3D forms as a grid of `0` and `1` glyphs, with tone
carried by glyph choice, opacity, and character size. Controls are provided by
[DialKit](https://github.com/joshpuckett/dialkit).

## Run

```bash
npm install
npm run dev
```

## Files

| File | Role |
|---|---|
| `src/halftone.js` | The engine. No framework, no React. Import it from the app **and** from your build script. |
| `src/App.jsx` | Canvas + DialKit panel. |
| `src/styles.css` | App shell only — DialKit ships its own panel styles. |

The split matters: `halftone.js` is the thing that guarantees consistency. The app
is a way to find good parameter values; the build script is what ships.


## Video

Choose or drop an `.mp4` / `.webm` / `.mov` and the transport bar appears:
play/pause, scrub, and **Record WebM**. The `video` folder in the panel holds
loop, playback rate, target FPS, and record bitrate.

Video takes a different render path from stills. A still image builds its
luminance field once and caches it, so moving a tone dial only repaints. Video
has no stable source, so the field is rebuilt every frame — which makes grid
size the thing that governs whether playback is smooth.

The panel shows **ms/frame** next to the record button and turns amber past
33 ms (below 30 fps). If it goes amber, lower `grid.columns` or raise
`grid.cellWidth` before touching anything else.

**Use bitmap mode for video.** Inflate runs a distance transform plus two blur
passes per frame; it works, but expect single-digit FPS at any useful grid size.
It is not blocked — the ms/frame readout will tell you what it costs.

Frames are driven by `requestVideoFrameCallback` where available, which fires
once per *decoded* frame. The `requestAnimationFrame` fallback fires at display
rate and will redraw the same frame repeatedly on 24/30fps footage. The status
line says which one you got.

### Recording

`MediaRecorder` captures the canvas live via `captureStream`, so recording is
real-time — a 30-second clip takes 30 seconds and a slow grid records at its
slow rate rather than dropping frames. Codec preference is VP9, then VP8, then
MP4/H.264, since VP9 handles flat blacks and hard glyph edges better than VP8
at the same bitrate.

For frame-exact output, seek and export PNGs per frame instead, then encode
offline with ffmpeg.

## Character mode

`character.charMode` picks the glyph set:

| Mode | Glyphs |
|---|---|
| Binary digits (0–1) | `01` |
| Digits (0–9) | `0123456789` |
| P&L figures | `$%()+-.,0123456789` |
| Custom… | whatever you type in `customChars` |

Character settings are draw-time only, so switching sets repaints instantly
without re-running the raymarch or the inflate pass.

### Why more glyphs needs pooled selection

With two glyphs the ramp can pick one winner per tone. With eighteen, picking a
single winner means every cell in a tone band is the same character — mechanical,
and it wastes the set.

So each tone level gets a **pool**: every combo whose perceived ink lands within
half a tone step of the target is interchangeable by definition, so the glyph can
vary for free. `character.variety` scales that tolerance (0 = one glyph per tone,
1 = full pool, capped at 6 distinct characters).

Which cell gets which pool member is chosen by a deterministic hash of the grid
position, so output stays reproducible across runs and machines — important if
assets are generated in CI.

Sample pools for P&L figures at 8 steps:

```
tone 1: [. , - ( ) +]      lightest
tone 4: [% 2 8 6 9 $]
tone 7: [$ %]              heaviest
```

## The character size axis

Three controls under **character**:

- **charSize** — base glyph size as a multiple of cell width. Above ~1.3 glyphs
  begin to collide with their neighbours, which is sometimes the effect you want.
- **sizeVariation** — how far the ramp is allowed to shrink glyphs for darker
  tones. `0` gives a uniform ASCII look; `1` gives the dot-matrix look where
  size does most of the tonal work.
- **sizeSteps** — how many discrete sizes exist. Keep this low. Discrete steps
  read as a system; continuous scaling reads as a blur.

Size enters the tone ramp as `coverage × alpha × scale²` — area, not linear
scale — and the whole combo set is sorted by that score before even steps are
sampled out of it. So raising `sizeVariation` doesn't just make glyphs smaller,
it changes which glyph/opacity pairs get selected at each tone.

## Generating production assets

```js
// scripts/build-assets.mjs
import { createCanvas, loadImage } from "canvas";
import { writeFileSync } from "node:fs";
import * as HT from "../src/halftone.js";

const makeCanvas = (w, h) => createCanvas(w, h);
const tokens = JSON.parse(readFileSync("./tokens.json", "utf8"));

const img = await loadImage("./sources/hero.png");
const place = { fit: "contain", zoom: 0.95, panX: 0, panY: 0 };
const field = HT.fieldFromImage(img, tokens.columns, tokens.rows, place, tokens.bgCutoff, makeCanvas);

const out = createCanvas(1, 1);
HT.drawHalftone(out, field, tokens, { dpr: 2, setStyleSize: false, makeCanvas });
writeFileSync("./public/hero.png", out.toBuffer("image/png"));
```

Use **Copy tokens JSON** in the panel to produce `tokens.json`. Fix `columns` and
`rows` (turn off `autoFit`) before you export, or assets generated on different
screens won't match.

## Keyboard shortcuts

| Keys | Control |
|---|---|
| `C` + drag | character size (fine) |
| `V` + drag | size variation |
| `G` + drag | cell width |
| `D` + scroll | dither |
| `Y` + scroll | gamma |
