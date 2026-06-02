import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  connectorPointForBounds,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  findParent,
} from "@cucumber/canvas-core";
import type { PenConnectorSide, PenNode } from "@cucumber/pen-types";

export const STICKY_NOTE_DEFAULT_WIDTH = 220;
export const STICKY_NOTE_DEFAULT_HEIGHT = 200;
export const STICKY_NOTE_MIN_WIDTH = 160;
export const STICKY_NOTE_MIN_HEIGHT = 140;
export const STICKY_NOTE_LINK_GAP = 96;

const STICKY_NOTE_FONT_FAMILY =
  'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';

export function isStickyNoteNode(node: PenNode | undefined): boolean {
  return node?.meta?.boardKind === "sticky";
}

export function getStickyNoteContainerForNode(
  doc: CucumberCanvasDocument,
  nodeId: string,
  activePageId?: string | null,
): PenNode | null {
  let current = findNode(doc, nodeId, activePageId);
  while (current) {
    if (isStickyNoteNode(current)) return current;
    current = findParent(doc, current.id, activePageId);
  }
  return null;
}

export function getSelectableStickyHitNode(
  doc: CucumberCanvasDocument,
  hit: PenNode | null,
  activePageId?: string | null,
): PenNode | null {
  if (!hit) return null;
  const sticky = getStickyNoteContainerForNode(doc, hit.id, activePageId);
  if (!sticky) return hit;
  if (hit.id === sticky.id) return sticky;
  const bodyText = findStickyNoteTextNode(sticky);
  if (bodyText?.id === hit.id) return sticky;
  return hit;
}

export function findStickyNoteTextNode(sticky: PenNode): PenNode | null {
  if (!isStickyNoteNode(sticky)) return null;
  const children =
    "children" in sticky && Array.isArray(sticky.children)
      ? (sticky.children as PenNode[])
      : [];
  return (
    children.find(
      (child) =>
        child.type === "text" &&
        (child.meta?.stickyRole === "body" ||
          child.name?.toLowerCase() === "sticky text"),
    ) ?? null
  );
}

export function getStickyConnectorPoint(
  bounds: CanvasBounds,
  side: PenConnectorSide,
  node?: PenNode,
) {
  if (node) {
    return connectorPointForNodeBounds(node, bounds, side, 0.5);
  }
  return connectorPointForBounds(bounds, side, 0.5);
}

export function getOppositeStickyConnectorSide(
  side: PenConnectorSide,
): PenConnectorSide {
  switch (side) {
    case "top":
      return "bottom";
    case "right":
      return "left";
    case "bottom":
      return "top";
    case "left":
      return "right";
    default: {
      const _exhaustive: never = side;
      throw new Error(`Unsupported sticky connector side: ${_exhaustive}`);
    }
  }
}

export function getLinkedStickyBounds(
  sourceBounds: CanvasBounds,
  side: PenConnectorSide,
  pointer: { x: number; y: number },
): CanvasBounds {
  const width = STICKY_NOTE_DEFAULT_WIDTH;
  const height = STICKY_NOTE_DEFAULT_HEIGHT;
  switch (side) {
    case "top":
      return {
        x: pointer.x - width / 2,
        y: pointer.y - height - STICKY_NOTE_LINK_GAP / 2,
        width,
        height,
      };
    case "right":
      return {
        x: Math.max(pointer.x, sourceBounds.x + sourceBounds.width + 1),
        y: pointer.y - height / 2,
        width,
        height,
      };
    case "bottom":
      return {
        x: pointer.x - width / 2,
        y: Math.max(pointer.y, sourceBounds.y + sourceBounds.height + 1),
        width,
        height,
      };
    case "left":
      return {
        x: pointer.x - width,
        y: pointer.y - height / 2,
        width,
        height,
      };
    default: {
      const _exhaustive: never = side;
      throw new Error(`Unsupported sticky connector side: ${_exhaustive}`);
    }
  }
}

export function createStickyNoteNode(
  bounds: CanvasBounds,
  text = "Type anything",
): PenNode {
  const id = createNodeId("sticky");
  const width = Math.max(bounds.width, STICKY_NOTE_MIN_WIDTH);
  const height = Math.max(bounds.height, STICKY_NOTE_MIN_HEIGHT);
  return {
    id,
    type: "frame",
    name: "Sticky",
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    clipContent: false,
    fill: [{ type: "solid", color: "#FFE59A" }],
    stroke: {
      thickness: 1,
      fill: [{ type: "solid", color: "rgba(143,112,35,0.18)" }],
    },
    cornerRadius: 4,
    effects: [
      {
        type: "shadow",
        color: "rgba(0,0,0,0.12)",
        offsetX: 0,
        offsetY: 8,
        blur: 18,
        spread: 0,
      },
    ],
    meta: {
      boardKind: "sticky",
      containerType: "sticky_note",
      selectionMode: "container",
    },
    containerRole: ["context"],
    contextSlots: {},
    inheritPolicy: "merge",
    permissions: {
      owner: "user",
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
    },
    children: [
      {
        id: createNodeId("sticky_text"),
        type: "text",
        name: "Sticky text",
        x: 20,
        y: 20,
        width: width - 40,
        height: height - 40,
        content: text,
        fontFamily: STICKY_NOTE_FONT_FAMILY,
        fontSize: 24,
        lineHeight: 1.35,
        textGrowth: "fixed-width",
        fill: [{ type: "solid", color: "rgba(91,72,27,0.72)" }],
        meta: {
          stickyRole: "body",
          selectable: false,
        },
      } as PenNode,
    ],
  } as PenNode;
}
