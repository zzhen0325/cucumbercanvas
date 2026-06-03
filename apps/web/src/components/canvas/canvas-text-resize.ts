import type { CanvasBounds } from "@cucumber/canvas-core";
import { getNodeBounds } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";

import { type ResizeHandle, boundsToNodeUpdates } from "./canvas-draw-geometry";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  getTextContent,
  measureTextLayout,
} from "./canvas-text-measure";

export function getResizeNodeUpdates(
  node: PenNode | undefined,
  bounds: CanvasBounds,
  handle: ResizeHandle,
): Partial<PenNode> {
  let updates = boundsToNodeUpdates(bounds);
  if (node?.type !== "text") return updates as Partial<PenNode>;

  const textNode = node as PenNode & {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string | number;
    lineHeight?: number | string;
    textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
  };
  let nextTextGrowth = textNode.textGrowth ?? "fixed-width-height";
  const horizontalResize = handle.includes("e") || handle.includes("w");
  const verticalResize = handle.includes("n") || handle.includes("s");
  if (nextTextGrowth === "auto" && horizontalResize) {
    nextTextGrowth = "fixed-width";
  } else if (nextTextGrowth === "fixed-width" && verticalResize) {
    nextTextGrowth = "fixed-width-height";
  }
  const measured = measureTextLayout({
    content: getTextContent(node),
    fontSize: textNode.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    fontFamily: textNode.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    fontWeight: String(textNode.fontWeight ?? 400),
    lineHeight: textNode.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
    textGrowth: nextTextGrowth,
    width: nextTextGrowth === "auto" ? getNodeBounds(node).width : bounds.width,
    height: bounds.height,
  });
  updates = {
    ...updates,
    width: measured.width,
    height: measured.height,
    textGrowth: nextTextGrowth,
  };
  return updates as Partial<PenNode>;
}
