import type { ToolcraftAppComposition, ToolcraftPanelActionHandler } from "@/toolcraft/runtime/react";

import { appSchema } from "./app-schema";
import { HalftoneCanvas } from "./halftone-canvas";
import { copyHalftoneTokens, exportHalftonePng } from "./halftone-export";

const handlePanelAction: ToolcraftPanelActionHandler = (context) => {
  if (context.action.value === "export.png") {
    return exportHalftonePng(context);
  }

  if (context.action.value === "copy.tokens") {
    return copyHalftoneTokens(context);
  }

  return undefined;
};

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <HalftoneCanvas />,
  onPanelAction: handlePanelAction,
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
