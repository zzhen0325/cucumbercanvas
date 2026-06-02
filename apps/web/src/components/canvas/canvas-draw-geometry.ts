import { type CanvasBounds, createNodeId } from "@cucumber/canvas-core";
import type { EditorOverlayState } from "@cucumber/pen-renderer";
import type { ContainerRole, LineNode, PenNode } from "@cucumber/pen-types";

import type { CanvasTool } from "./canvas-api";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  measureTextLayout,
} from "./canvas-text-measure";
import { createStickyNoteNode } from "./sticky-note-tool";

export type DrawableShapeTool = "rect" | "ellipse" | "polygon";
export type DrawableCanvasTool =
  | DrawableShapeTool
  | "container"
  | "section"
  | "sticky"
  | "connector"
  | "line"
  | "arrow";
export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const DEFAULT_RECT_FILL = "#d3f256";
export const DEFAULT_SHAPE_FILL = "#f8fafc";

export function isDrawableShapeTool(
  tool: CanvasTool,
): tool is DrawableShapeTool {
  return tool === "rect" || tool === "ellipse" || tool === "polygon";
}

export function isDragDrawableTool(
  tool: CanvasTool,
): tool is DrawableCanvasTool {
  return (
    isDrawableShapeTool(tool) ||
    tool === "container" ||
    tool === "section" ||
    tool === "sticky" ||
    tool === "connector" ||
    tool === "line" ||
    tool === "arrow"
  );
}

export function isLineDrawableTool(
  tool: CanvasTool | DrawableCanvasTool,
): tool is "line" | "arrow" | "connector" {
  return tool === "line" || tool === "arrow" || tool === "connector";
}

export function shouldAttachConnectorForTool(
  tool: CanvasTool | DrawableCanvasTool,
) {
  return tool === "connector" || tool === "arrow";
}

export function getDrawableToolPreview(
  tool: DrawableCanvasTool,
  bounds: CanvasBounds,
): EditorOverlayState["shapePreview"] {
  if (tool === "line" || tool === "arrow" || tool === "connector") return null;
  return {
    type:
      tool === "container" || tool === "section" || tool === "sticky"
        ? "rect"
        : tool,
    bounds,
    fillColor:
      tool === "rect"
        ? DEFAULT_RECT_FILL
        : tool === "sticky"
          ? "#FFE59A"
          : tool === "section"
            ? "rgba(255,242,235,0.72)"
            : DEFAULT_SHAPE_FILL,
  };
}

export function normalizeDrawBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  forceSquare: boolean,
): CanvasBounds {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (forceSquare) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: Math.min(start.x, start.x + width),
    y: Math.min(start.y, start.y + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

export function getLineDrawDraft(
  startPoint: { x: number; y: number },
  pointerPoint: { x: number; y: number },
  opts: { constrain: boolean; fromCenter: boolean },
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const vector = opts.constrain
    ? constrainVectorTo45Degrees({
        x: pointerPoint.x - startPoint.x,
        y: pointerPoint.y - startPoint.y,
      })
    : { x: pointerPoint.x - startPoint.x, y: pointerPoint.y - startPoint.y };

  if (opts.fromCenter) {
    return {
      start: { x: startPoint.x - vector.x, y: startPoint.y - vector.y },
      end: { x: startPoint.x + vector.x, y: startPoint.y + vector.y },
    };
  }

  return {
    start: startPoint,
    end: { x: startPoint.x + vector.x, y: startPoint.y + vector.y },
  };
}

export function getLineEndpointDragDraft(
  drag: {
    endpoint: "start" | "end";
    originStart: { x: number; y: number };
    originEnd: { x: number; y: number };
  },
  pointerPoint: { x: number; y: number },
  constrain: boolean,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const fixed = drag.endpoint === "start" ? drag.originEnd : drag.originStart;
  const vector = constrain
    ? constrainVectorTo45Degrees({
        x: pointerPoint.x - fixed.x,
        y: pointerPoint.y - fixed.y,
      })
    : { x: pointerPoint.x - fixed.x, y: pointerPoint.y - fixed.y };
  const moved = { x: fixed.x + vector.x, y: fixed.y + vector.y };
  return drag.endpoint === "start"
    ? { start: moved, end: drag.originEnd }
    : { start: drag.originStart, end: moved };
}

function constrainVectorTo45Degrees(vector: {
  x: number;
  y: number;
}): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0) return vector;
  const angle = Math.atan2(vector.y, vector.x);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.cos(snapped) * length,
    y: Math.sin(snapped) * length,
  };
}

export function boundsToNodeUpdates(bounds: CanvasBounds): Partial<PenNode> {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
  } as Partial<PenNode>;
}

export function pointToAngle(
  center: { x: number; y: number },
  point: { x: number; y: number },
): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function calculateResizeBounds(
  origin: CanvasBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  preserveAspectRatio: boolean,
): CanvasBounds {
  let { x, y, width, height } = origin;
  const minSize = 8;
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }

  if (preserveAspectRatio) {
    const ratio =
      Math.max(origin.width, minSize) / Math.max(origin.height, minSize);
    if (Math.abs(dx) > Math.abs(dy)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (handle.includes("w")) x = origin.x + origin.width - width;
    if (handle.includes("n")) y = origin.y + origin.height - height;
  }

  if (width < minSize) {
    if (handle.includes("w")) x = origin.x + origin.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes("n")) y = origin.y + origin.height - minSize;
    height = minSize;
  }

  return { x, y, width, height, rotation: origin.rotation };
}

export function createTextCanvasNode(
  bounds: CanvasBounds,
  textGrowth: "auto" | "fixed-width",
): PenNode {
  const layout = measureTextLayout({
    content: "",
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontWeight: "400",
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    textGrowth,
    width: bounds.width,
    height: bounds.height,
  });
  return {
    id: createNodeId("text"),
    type: "text",
    name: "Text",
    x: bounds.x,
    y: bounds.y,
    width: textGrowth === "auto" ? layout.width : Math.max(bounds.width, 1),
    height:
      textGrowth === "auto"
        ? layout.height
        : Math.max(bounds.height, layout.height),
    content: "",
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    textGrowth,
    fill: [{ type: "solid", color: "#111827" }],
  } as PenNode;
}

export function createDrawableCanvasNode(
  type: DrawableCanvasTool,
  bounds: CanvasBounds,
  start: { x: number; y: number },
  end: { x: number; y: number },
  connector?: LineNode["connector"],
): PenNode {
  if (type === "container") {
    return createFrameNode(createNodeId("container"), bounds, "New container");
  }
  if (type === "section") {
    return createSectionFrameNode(createNodeId("section"), bounds, "Section");
  }
  if (type === "sticky") {
    return createStickyNoteNode(bounds);
  }
  if (isLineDrawableTool(type)) {
    return createLineNode(
      type === "arrow" ? "arrow" : "line",
      start,
      end,
      connector,
    );
  }

  const id = createNodeId(type === "rect" ? "rectangle" : type);
  const shared = {
    id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fill: [
      {
        type: "solid" as const,
        color: type === "rect" ? DEFAULT_RECT_FILL : DEFAULT_SHAPE_FILL,
      },
    ],
  };

  if (type === "rect") {
    return {
      ...shared,
      type: "rectangle",
      name: "Rectangle",
      cornerRadius: 8,
    } as PenNode;
  }
  if (type === "ellipse") {
    return {
      ...shared,
      type: "ellipse",
      name: "Ellipse",
    } as PenNode;
  }
  return {
    ...shared,
    type: "polygon",
    name: "Polygon",
    polygonCount: 3,
  } as PenNode;
}

export function createFrameNode(
  id: string,
  bounds: CanvasBounds,
  name: string,
): PenNode {
  return {
    id,
    type: "frame",
    name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    clipContent: true,
    fill: [{ type: "solid", color: "rgba(255,255,255,0.78)" }],
    stroke: {
      thickness: 2,
      fill: [{ type: "solid", color: "#6c5ce7" }],
    },
    opacity: 1,
    children: [],
    containerRole: ["visual", "task", "context"] as ContainerRole[],
    contextSlots: {},
    inheritPolicy: "merge",
    permissions: {
      owner: "user",
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
    },
  } as PenNode;
}

export function createSectionFrameNode(
  id: string,
  bounds: CanvasBounds,
  name: string,
): PenNode {
  return {
    ...createFrameNode(id, bounds, name),
    fill: [{ type: "solid", color: "rgba(255,242,235,0.72)" }],
    stroke: {
      thickness: 1,
      fill: [{ type: "solid", color: "rgba(255,128,96,0.45)" }],
    },
    meta: {
      boardKind: "section",
      showTitlePill: true,
      lockMode: "background",
    },
  } as PenNode;
}

export function createLineNode(
  type: "line" | "arrow",
  start: { x: number; y: number },
  end: { x: number; y: number },
  connector?: LineNode["connector"],
): PenNode {
  const id = createNodeId(type);
  return {
    id,
    type: "line",
    name: type === "arrow" ? "Arrow" : "Line",
    x: start.x,
    y: start.y,
    width: Math.max(Math.abs(end.x - start.x), 1),
    height: Math.max(Math.abs(end.y - start.y), 1),
    x2: end.x,
    y2: end.y,
    ...(connector
      ? {
          connector: {
            ...connector,
            arrow: type === "arrow" || connector.arrow,
            routing: connector.routing ?? "smooth",
          },
        }
      : null),
    stroke: {
      thickness: 3,
      cap: "round",
      ...(type === "arrow" ? { endTip: "line-arrow" as const } : null),
      fill: [{ type: "solid", color: "#111827" }],
    },
  } as unknown as PenNode;
}
