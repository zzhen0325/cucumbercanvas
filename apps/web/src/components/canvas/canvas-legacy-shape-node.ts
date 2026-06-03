import { createNodeId } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";

import { DEFAULT_RECT_FILL, DEFAULT_SHAPE_FILL } from "./canvas-draw-geometry";

export function createLegacyShapeNode(
  shapeType: string,
  cx: number,
  cy: number,
): PenNode {
  const id = createNodeId(shapeType);
  const shared = { id, x: cx - 80, y: cy - 60, width: 160, height: 120 };

  switch (shapeType) {
    case "rect":
      return {
        ...shared,
        type: "rectangle",
        name: "Rectangle",
        cornerRadius: 12,
        fill: [{ type: "solid", color: DEFAULT_RECT_FILL }],
      } as unknown as PenNode;
    case "ellipse":
      return {
        ...shared,
        type: "ellipse",
        name: "Ellipse",
        fill: [{ type: "solid", color: DEFAULT_SHAPE_FILL }],
      } as unknown as PenNode;
    case "text":
      return {
        ...shared,
        type: "text",
        name: "Text",
        content: "Double click to edit",
        fontSize: 28,
        fill: [{ type: "solid", color: "#111827" }],
      } as unknown as PenNode;
    case "line":
    case "arrow":
      return {
        id,
        type: "line",
        name: shapeType === "arrow" ? "Arrow" : "Line",
        x: cx - 80,
        y: cy,
        width: 160,
        height: 1,
        x2: cx + 80,
        y2: cy,
        stroke: {
          thickness: 3,
          cap: "round",
          ...(shapeType === "arrow" ? { endTip: "line-arrow" } : null),
          fill: [{ type: "solid", color: "#111827" }],
        },
      } as unknown as PenNode;
    default:
      return {
        ...shared,
        type: "rectangle",
        name: shapeType,
        fill: [{ type: "solid", color: DEFAULT_RECT_FILL }],
      } as unknown as PenNode;
  }
}
