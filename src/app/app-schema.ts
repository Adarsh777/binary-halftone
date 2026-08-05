import { defineToolcraft } from "@/toolcraft/runtime";

export const appSchema = defineToolcraft({
  canvas: {
    enabled: true,
    renderScale: true,
    upload: true,
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            /* fileDrop defaults to a standalone section layout (its own
               dedicated block) unless it's gated by a same-section
               control's visibleWhen -- source.image is unconditionally
               visible now (both remaining modes need it), so it always
               splits into its own titled "Image" section. Listing it first
               keeps that split to a clean two-section pair (Image, then
               Source for mode/width/height) instead of a three-way
               Source/Image/Source split from putting it in the middle. */
            image: {
              accept: "image/*",
              assetKind: "image",
              label: "Image",
              performanceReason:
                "Uploaded image resolution and decode cost drive the per-cell sampling pass for both remaining source modes.",
              performanceRole: "workload",
              target: "source.image",
              type: "fileDrop",
            },
            mode: {
              defaultValue: "bitmap",
              description:
                "Image reads the uploaded image's luminance directly; Silhouette inflates it into a lit 3D form.",
              label: "Mode",
              options: [
                { label: "Image", value: "bitmap" },
                { label: "Silhouette", value: "inflate" },
              ],
              performanceReason:
                "Switching source mode changes which per-cell field pipeline (silhouette inflate or image luminance) runs every redraw.",
              performanceRole: "workload",
              target: "source.mode",
              type: "select",
            },
            imageWidth: {
              description:
                "Overrides the uploaded image's real width before placement; leave blank to use its natural size.",
              label: "Custom Width",
              performanceReason:
                "A larger custom source size increases per-cell sampling cost the same way a larger uploaded image would.",
              performanceRole: "responsiveness",
              target: "source.image.width",
              textValueKind: "single-line",
              type: "text",
            },
            imageHeight: {
              description:
                "Overrides the uploaded image's real height before placement; leave blank to use its natural size.",
              label: "Custom Height",
              performanceReason:
                "A larger custom source size increases per-cell sampling cost the same way a larger uploaded image would.",
              performanceRole: "responsiveness",
              target: "source.image.height",
              textValueKind: "single-line",
              type: "text",
            },
          },
          title: "Source",
        },
        {
          controls: {
            fit: {
              defaultValue: "contain",
              label: "Fit",
              options: [
                { label: "Contain", value: "contain" },
                { label: "Cover", value: "cover" },
                { label: "Stretch", value: "stretch" },
              ],
              performanceReason:
                "Fit mode only changes how the source image is sampled into the same fixed-size grid; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              target: "placement.fit",
              type: "select",
            },
            zoom: {
              defaultValue: 0.95,
              label: "Zoom",
              max: 3,
              min: 0.2,
              performanceReason:
                "Zoom only changes sample placement inside the same fixed-size grid; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "placement.zoom",
              type: "slider",
            },
            panX: {
              defaultValue: 0,
              label: "Pan X",
              max: 0.5,
              min: -0.5,
              performanceReason:
                "Pan only changes sample placement inside the same fixed-size grid; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.005,
              target: "placement.panX",
              type: "slider",
            },
            panY: {
              defaultValue: 0,
              label: "Pan Y",
              max: 0.5,
              min: -0.5,
              performanceReason:
                "Pan only changes sample placement inside the same fixed-size grid; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.005,
              target: "placement.panY",
              type: "slider",
            },
          },
          title: "Placement",
          visibleWhen: { oneOf: ["inflate", "bitmap"], target: "source.mode" },
        },
        {
          controls: {
            threshold: {
              defaultValue: 0.5,
              label: "Threshold",
              max: 0.98,
              min: 0.02,
              performanceReason:
                "Threshold only reclassifies the already-computed key field into mask/background; it does not add per-cell work.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "silhouette.threshold",
              type: "slider",
            },
            invert: {
              defaultValue: false,
              label: "Invert",
              performanceReason:
                "Invert only flips the mask classification; it does not add per-cell work.",
              performanceRole: "responsiveness",
              target: "silhouette.invert",
              type: "switch",
            },
            showMask: {
              defaultValue: false,
              label: "Mask Preview",
              performanceReason:
                "Mask preview swaps the shading branch for a flat fill at the same per-cell cost.",
              performanceRole: "responsiveness",
              target: "silhouette.showMask",
              type: "switch",
            },
            domeRadius: {
              defaultValue: 14,
              label: "Dome Radius",
              max: 40,
              min: 2,
              performanceReason:
                "Dome radius changes the box-blur kernel radius applied across the full key-field resolution.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 1,
              target: "silhouette.domeRadius",
              type: "slider",
            },
            relief: {
              defaultValue: 2.2,
              label: "Relief",
              max: 6,
              min: 0.2,
              performanceReason:
                "Relief only rescales the already-computed height field; it does not change field resolution or blur kernel size.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.1,
              target: "silhouette.relief",
              type: "slider",
            },
            occlusion: {
              defaultValue: 0.6,
              label: "Occlusion",
              max: 1.5,
              min: 0,
              performanceReason:
                "Occlusion only rescales the already-computed ambient-occlusion term; it does not change field resolution.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.02,
              target: "silhouette.occlusion",
              type: "slider",
            },
          },
          title: "Silhouette",
          visibleWhen: { equals: "inflate", target: "source.mode" },
        },
        {
          controls: {
            mode: {
              defaultValue: "binary",
              label: "Character Set",
              options: [
                { label: "Binary (0-1)", value: "binary" },
                { label: "Digits (0-9)", value: "digits" },
                { label: "P&L Figures", value: "pnl" },
                { label: "Custom", value: "custom" },
              ],
              performanceReason:
                "Character set size changes how many (glyph, alpha, size) combinations the tone ramp measures every redraw.",
              performanceRole: "workload",
              semanticGroup: "charset",
              target: "character.mode",
              type: "select",
            },
            customChars: {
              commitMode: "content",
              defaultValue: "01",
              label: "Custom Characters",
              performanceReason:
                "The typed character list changes how many combinations the tone ramp measures every redraw.",
              performanceRole: "workload",
              semanticGroup: "charset",
              target: "character.customChars",
              textValueKind: "single-line",
              type: "text",
              visibleWhen: { equals: "custom", target: "character.mode" },
            },
            variety: {
              defaultValue: 0.6,
              label: "Variety",
              max: 1,
              min: 0,
              performanceReason:
                "Variety only widens the tolerance used to pick among already-built ramp combinations; it does not rebuild the combination set.",
              performanceRole: "responsiveness",
              semanticGroup: "ramp",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "character.variety",
              type: "slider",
            },
            size: {
              defaultValue: 1.05,
              label: "Size",
              max: 2.5,
              min: 0.3,
              performanceReason:
                "Size changes the rasterized font size for every drawn glyph, changing how many pixels each fillText call covers, even though it does not change how many combinations the ramp measures.",
              performanceRole: "workload",
              semanticGroup: "size",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "character.size",
              type: "slider",
            },
            scale: {
              defaultValue: 1,
              label: "Scale",
              max: 1,
              min: 0.1,
              performanceReason:
                "Scale multiplies into charSize before the same cell-filling clamp, so it changes the rasterized font size for every drawn glyph and forces the ramp's coverage measurement (and its sort) to re-run at the new effective size.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "character.scale",
              type: "slider",
            },
            sizeVariation: {
              defaultValue: 0.35,
              label: "Size Variation",
              max: 1,
              min: 0,
              performanceReason:
                "Size variation feeds the ramp's scale axis directly, so it changes the (glyph, alpha, size) combinations the tone ramp measures and re-sorts every redraw.",
              performanceRole: "workload",
              semanticGroup: "size",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "character.sizeVariation",
              type: "slider",
            },
            sizeSteps: {
              defaultValue: 3,
              label: "Size Steps",
              max: 6,
              min: 1,
              performanceReason:
                "Size steps multiplies the number of (glyph, alpha, size) combinations the tone ramp measures every redraw.",
              performanceRole: "workload",
              semanticGroup: "size",
              sliderValueKind: "discrete",
              step: 1,
              target: "character.sizeSteps",
              type: "slider",
              variant: "discrete",
            },
            weight: {
              defaultValue: "400",
              label: "Weight",
              options: [
                { label: "Light", value: "300" },
                { label: "Regular", value: "400" },
                { label: "Medium", value: "500" },
                { label: "Bold", value: "700" },
              ],
              performanceReason:
                "Font weight changes require re-measuring glyph ink coverage for every character in the active set.",
              performanceRole: "workload",
              semanticGroup: "charset",
              target: "character.weight",
              type: "select",
            },
          },
          title: "Character",
        },
        {
          controls: {
            cellAspect: {
              defaultValue: 1.35,
              label: "Cell Aspect",
              max: 2.2,
              min: 0.8,
              performanceReason:
                "Cell aspect changes the derived row count for the current canvas size, directly changing per-cell draw cost.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "grid.cellAspect",
              type: "slider",
            },
            cellWidth: {
              defaultValue: 8,
              label: "Cell Width",
              max: 24,
              min: 3,
              performanceReason:
                "Cell width directly sets the derived column and row count, the single largest driver of per-cell draw cost.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 0.5,
              target: "grid.cellWidth",
              type: "slider",
              unit: "px",
            },
          },
          title: "Grid",
        },
        {
          controls: {
            backgroundCutoff: {
              defaultValue: 0.045,
              label: "Background Cutoff",
              max: 0.4,
              min: 0,
              performanceReason:
                "Background cutoff only changes which already-computed samples are gated as alive; it does not add per-cell work.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.005,
              target: "tone.backgroundCutoff",
              type: "slider",
            },
            levels: {
              defaultValue: 8,
              label: "Levels",
              max: 12,
              min: 2,
              performanceReason:
                "Tone level count changes how many ramp levels (and fillText buckets) are built and drawn every redraw.",
              performanceRole: "workload",
              sliderValueKind: "discrete",
              step: 1,
              target: "tone.steps",
              type: "slider",
              variant: "discrete",
            },
            black: {
              defaultValue: 0.05,
              label: "Black Point",
              max: 0.6,
              min: 0,
              performanceReason:
                "Black point only remaps the already-computed luminance value per cell; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "tone.blackPoint",
              type: "slider",
            },
            white: {
              defaultValue: 0.95,
              label: "White Point",
              max: 1,
              min: 0.4,
              performanceReason:
                "White point only remaps the already-computed luminance value per cell; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "tone.whitePoint",
              type: "slider",
            },
            gamma: {
              defaultValue: 1,
              label: "Gamma",
              max: 2.4,
              min: 0.4,
              performanceReason:
                "Gamma only remaps the already-computed luminance value per cell; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "tone.gamma",
              type: "slider",
            },
            dither: {
              defaultValue: 0.55,
              label: "Dither",
              max: 1,
              min: 0,
              performanceReason:
                "Dither only adds a per-cell threshold offset; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.02,
              target: "tone.dither",
              type: "slider",
            },
            edgeLift: {
              defaultValue: 0.55,
              label: "Edge Lift",
              max: 1.5,
              min: 0,
              performanceReason:
                "Edge lift only adds the already-computed edge sample into the tone value; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.02,
              target: "tone.edgeLift",
              type: "slider",
            },
          },
          title: "Tone",
        },
        {
          controls: {
            rim: {
              defaultValue: 0.55,
              label: "Rim",
              max: 1.2,
              min: 0,
              performanceReason:
                "Rim only rescales the existing per-cell shading term; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.02,
              target: "light.rim",
              type: "slider",
            },
            dirX: {
              defaultValue: -0.45,
              label: "Direction X",
              max: 1,
              min: -1,
              performanceReason:
                "Light direction only rescales the existing per-cell shading term; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "light.dirX",
              type: "slider",
            },
            dirY: {
              defaultValue: 0.78,
              label: "Direction Y",
              max: 1,
              min: -1,
              performanceReason:
                "Light direction only rescales the existing per-cell shading term; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "light.dirY",
              type: "slider",
            },
            dirZ: {
              defaultValue: 0.44,
              label: "Direction Z",
              max: 1,
              min: -1,
              performanceReason:
                "Light direction only rescales the existing per-cell shading term; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "light.dirZ",
              type: "slider",
            },
          },
          title: "Light",
          visibleWhen: { equals: "inflate", target: "source.mode" },
        },
        {
          controls: {
            ink: {
              defaultValue: "#e8e8e6",
              label: false,
              performanceReason:
                "Ink color only changes canvas fillStyle; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              target: "appearance.ink",
              type: "color",
            },
          },
          title: "Ink",
        },
        {
          controls: {
            background: {
              defaultValue: "#0a0a0a",
              label: false,
              performanceReason:
                "Background color only changes canvas fillStyle; it does not change per-cell iteration cost.",
              performanceRole: "responsiveness",
              target: "appearance.background",
              type: "color",
            },
            includeBackground: {
              defaultValue: true,
              description:
                "Controls preview and PNG background visibility; video export keeps the background.",
              label: "Include",
              performanceReason:
                "Toggling background inclusion only swaps the fill color used for the same fillRect call.",
              performanceRole: "responsiveness",
              target: "export.includeBackground",
              type: "switch",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["includeBackground", "background"],
              layout: "inline",
            },
          ],
          title: "Background",
        },
        {
          controls: {
            imageFormat: {
              defaultValue: "png",
              label: "Format",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              performanceReason:
                "Export format only changes the encoder used on the already-rendered export canvas.",
              performanceRole: "responsiveness",
              target: "export.image.format",
              type: "select",
            },
            imageResolution: {
              defaultValue: "4k",
              label: "Resolution",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              performanceReason:
                "Export resolution changes the pixel ratio the export pass renders at, directly changing export cost.",
              performanceRole: "workload",
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["imageFormat", "imageResolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
          actionGroup: "secondary",
          controls: {
            outputActions: {
              actions: [
                {
                  icon: "upload-simple",
                  label: "Export PNG",
                  role: "export-image",
                  value: "export.png",
                },
                {
                  icon: "copy",
                  label: "Copy Tokens",
                  role: "copy-output",
                  value: "copy.tokens",
                },
              ],
              target: "actions.output",
              type: "panelActions",
            },
          },
          title: "Export",
        },
      ],
      title: "Controls",
    },
  },
  persistence: {
    include: ["values", "canvas", "panels"],
    key: "toolcraft:binary-halftone:state:v1",
    storage: "localStorage",
    version: 1,
  },
  toolbar: {
    history: true,
    radar: true,
    zoom: true,
  },
});
