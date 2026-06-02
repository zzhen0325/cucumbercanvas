import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  connectorPointForBounds,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  findParent,
} from "@cucumber/canvas-core";
import type {
  PenConnectorSide,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";

export const STICKY_NOTE_DEFAULT_WIDTH = 220;
export const STICKY_NOTE_DEFAULT_HEIGHT = 200;
export const STICKY_NOTE_MIN_WIDTH = 160;
export const STICKY_NOTE_MIN_HEIGHT = 140;
export const STICKY_NOTE_LINK_GAP = 96;
export const STICKY_NOTE_PLACEHOLDER_TEXT = "Type anything";
export const STICKY_NOTE_DEFAULT_BACKGROUND = "#FFE59A";

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
  return sticky;
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

export function deriveStickyStrokeColor(backgroundColor: string): string {
  const rgb = parseCssColor(backgroundColor);
  if (!rgb) {
    throw new Error(
      `Sticky background color "${backgroundColor}" cannot be parsed for stroke derivation.`,
    );
  }
  const darkened = {
    r: Math.max(0, Math.round(rgb.r * 0.56)),
    g: Math.max(0, Math.round(rgb.g * 0.56)),
    b: Math.max(0, Math.round(rgb.b * 0.56)),
  };
  return `rgba(${darkened.r},${darkened.g},${darkened.b},0.24)`;
}

export function normalizeStickyNotesInDocument(doc: PenDocument): PenDocument {
  let changed = false;
  const normalizeNode = (node: PenNode): PenNode => {
    let next = node;
    const rawChildren =
      "children" in node && Array.isArray(node.children)
        ? (node.children as PenNode[])
        : null;

    if (isStickyNoteNode(node) && rawChildren) {
      const normalizedChildren = rawChildren.map((child) => {
        if (
          child.type !== "text" ||
          (child.meta?.stickyRole !== "body" &&
            child.name?.toLowerCase() !== "sticky text")
        ) {
          return normalizeNode(child);
        }
        const content =
          typeof (child as { content?: unknown }).content === "string"
            ? (child as { content: string }).content
            : "";
        const normalizedContent =
          content === STICKY_NOTE_PLACEHOLDER_TEXT ? "" : content;
        const needsMetaUpdate =
          child.meta?.stickyRole !== "body" ||
          child.meta?.selectable !== false ||
          child.meta?.placeholder !== STICKY_NOTE_PLACEHOLDER_TEXT;
        if (normalizedContent !== content || needsMetaUpdate) {
          changed = true;
          return {
            ...child,
            content: normalizedContent,
            meta: {
              ...(child.meta ?? {}),
              stickyRole: "body",
              selectable: false,
              placeholder: STICKY_NOTE_PLACEHOLDER_TEXT,
            },
          } as PenNode;
        }
        return child;
      });
      if (normalizedChildren !== rawChildren) {
        next = { ...next, children: normalizedChildren } as PenNode;
      }
    } else if (rawChildren) {
      const normalizedChildren = rawChildren.map(normalizeNode);
      if (
        normalizedChildren.some((child, index) => child !== rawChildren[index])
      ) {
        changed = true;
        next = { ...next, children: normalizedChildren } as PenNode;
      }
    }
    return next;
  };

  const normalizeNodes = (nodes: PenNode[]) => nodes.map(normalizeNode);
  const pages = Array.isArray(doc.pages)
    ? doc.pages.map((page) => {
        const children = Array.isArray(page.children) ? page.children : [];
        const normalizedChildren = normalizeNodes(children);
        if (
          normalizedChildren.some((child, index) => child !== children[index])
        ) {
          changed = true;
          return { ...page, children: normalizedChildren };
        }
        return page;
      })
    : undefined;
  const children = Array.isArray(doc.children) ? doc.children : [];
  const normalizedRootChildren = normalizeNodes(children);
  if (
    normalizedRootChildren.some((child, index) => child !== children[index])
  ) {
    changed = true;
  }

  if (!changed) return doc;
  return {
    ...doc,
    ...(pages ? { pages } : {}),
    children: normalizedRootChildren,
  };
}

export function createStickyNoteNode(bounds: CanvasBounds, text = ""): PenNode {
  const id = createNodeId("sticky");
  const width = Math.max(bounds.width, STICKY_NOTE_MIN_WIDTH);
  const height = Math.max(bounds.height, STICKY_NOTE_MIN_HEIGHT);
  const backgroundColor = STICKY_NOTE_DEFAULT_BACKGROUND;
  const content = text === STICKY_NOTE_PLACEHOLDER_TEXT ? "" : text;
  return {
    id,
    type: "frame",
    name: "Sticky",
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    clipContent: false,
    fill: [{ type: "solid", color: backgroundColor }],
    stroke: {
      thickness: 1,
      fill: [
        { type: "solid", color: deriveStickyStrokeColor(backgroundColor) },
      ],
    },
    cornerRadius: 4,
    effects: [
      // {
      //   type: "shadow",
      //   color: "rgba(0,0,0,0.02)",
      //   offsetX: 0,
      //   offsetY: 8,
      //   blur: 18,
      //   spread: 0,
      // },
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
        content,
        fontFamily: STICKY_NOTE_FONT_FAMILY,
        fontSize: 24,
        lineHeight: 1.35,
        textGrowth: "fixed-width",
        fill: [{ type: "solid", color: "rgba(91,72,27,0.72)" }],
        meta: {
          stickyRole: "body",
          selectable: false,
          placeholder: STICKY_NOTE_PLACEHOLDER_TEXT,
        },
      } as PenNode,
    ],
  } as PenNode;
}

function parseCssColor(
  color: string,
): { r: number; g: number; b: number } | null {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const raw = hex[1];
    const expanded =
      raw.length === 3
        ? raw
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
        : raw;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i,
  );
  if (!rgba) return null;
  const r = Number.parseInt(rgba[1] ?? "", 10);
  const g = Number.parseInt(rgba[2] ?? "", 10);
  const b = Number.parseInt(rgba[3] ?? "", 10);
  if (
    [r, g, b].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 255,
    )
  ) {
    return null;
  }
  return { r, g, b };
}
