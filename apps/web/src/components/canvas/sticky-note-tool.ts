import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  STICKY_NOTE_DEFAULT_BACKGROUND,
  STICKY_NOTE_DEFAULT_HEIGHT,
  STICKY_NOTE_DEFAULT_WIDTH,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  STICKY_NOTE_PLACEHOLDER_TEXT,
  connectorPointForBounds,
  connectorPointForNodeBounds,
  createStickyNoteNode,
  deriveStickyStrokeColor,
  findNode,
  findParent,
} from "@cucumber/canvas-core";
import type {
  PenConnectorSide,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";

export const STICKY_NOTE_LINK_GAP = 96;
export {
  createStickyNoteNode,
  deriveStickyStrokeColor,
  STICKY_NOTE_DEFAULT_BACKGROUND,
  STICKY_NOTE_DEFAULT_HEIGHT,
  STICKY_NOTE_DEFAULT_WIDTH,
  STICKY_NOTE_MIN_HEIGHT,
  STICKY_NOTE_MIN_WIDTH,
  STICKY_NOTE_PLACEHOLDER_TEXT,
};

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
