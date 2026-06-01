import type { LineNode, PenNode } from "@cucumber/pen-types";
import type { CanvasBounds } from "./types.js";

export type CanvasLineEndpoint = "start" | "end";

export type CanvasLineEndpoints = {
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export function isLineNode(node: PenNode | undefined): node is LineNode {
  return node?.type === "line";
}

export function getLineEndpoints(node: LineNode): CanvasLineEndpoints {
  const start = { x: node.x ?? 0, y: node.y ?? 0 };
  return {
    start,
    end: {
      x: typeof node.x2 === "number" ? node.x2 : start.x + 100,
      y: typeof node.y2 === "number" ? node.y2 : start.y,
    },
  };
}

export function getLineBounds(node: LineNode): CanvasBounds {
  const { start, end } = getLineEndpoints(node);
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    rotation: node.rotation,
  };
}
