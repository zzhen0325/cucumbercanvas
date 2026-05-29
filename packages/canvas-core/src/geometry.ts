import type { PenDocument, PenNode } from "@cucumber/pen-types";
import {
  findNode,
  findParent,
  getActiveChildren,
  getNodeBounds,
} from "./document.js";
import type { CanvasBounds } from "./types.js";

export interface OrderedCanvasNode {
  node: PenNode;
  depth: number;
}

export function normalizeBounds(bounds: CanvasBounds): CanvasBounds {
  const x = Math.min(bounds.x, bounds.x + bounds.width);
  const y = Math.min(bounds.y, bounds.y + bounds.height);
  return {
    ...bounds,
    x,
    y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

export function boundsIntersect(a: CanvasBounds, b: CanvasBounds): boolean {
  const left = normalizeBounds(a);
  const right = normalizeBounds(b);
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function getBoundsUnion(boundsList: CanvasBounds[]): CanvasBounds {
  if (boundsList.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const normalized = boundsList.map(normalizeBounds);
  const minX = Math.min(...normalized.map((b) => b.x));
  const minY = Math.min(...normalized.map((b) => b.y));
  const maxX = Math.max(...normalized.map((b) => b.x + b.width));
  const maxY = Math.max(...normalized.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getSelectionBounds(
  doc: PenDocument,
  nodeIds: string[],
  activePageId?: string | null,
): CanvasBounds | null {
  const boundsList = nodeIds
    .map((id) => getNodeSceneBounds(doc, id, activePageId))
    .filter((bounds): bounds is CanvasBounds => Boolean(bounds));
  if (boundsList.length === 0) return null;
  return getBoundsUnion(boundsList);
}

export function getNodeSceneOrigin(
  doc: PenDocument,
  nodeId: string,
  activePageId?: string | null,
): { x: number; y: number } | null {
  const node = findNode(doc, nodeId, activePageId);
  if (!node) return null;

  let x = node.x ?? 0;
  let y = node.y ?? 0;
  let parent = findParent(doc, nodeId, activePageId);
  while (parent) {
    x += parent.x ?? 0;
    y += parent.y ?? 0;
    parent = findParent(doc, parent.id, activePageId);
  }
  return { x, y };
}

export function getNodeSceneBounds(
  doc: PenDocument,
  nodeId: string,
  activePageId?: string | null,
): CanvasBounds | null {
  const node = findNode(doc, nodeId, activePageId);
  const origin = getNodeSceneOrigin(doc, nodeId, activePageId);
  if (!node || !origin) return null;

  const bounds = getNodeBounds(node);
  return {
    ...bounds,
    x: origin.x,
    y: origin.y,
  };
}

export function getOrderedCanvasNodes(
  doc: PenDocument,
  activePageId?: string | null,
): OrderedCanvasNode[] {
  const result: OrderedCanvasNode[] = [];
  const walk = (nodes: PenNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if ("children" in node && Array.isArray(node.children)) {
        walk(node.children as PenNode[], depth + 1);
      }
    }
  };
  walk(getActiveChildren(doc, activePageId), 0);
  return result;
}

export function getVisibleCanvasNodesInBounds(
  doc: PenDocument,
  bounds: CanvasBounds,
  activePageId?: string | null,
): PenNode[] {
  return getOrderedCanvasNodes(doc, activePageId)
    .map((e) => e.node)
    .filter(
      (node) =>
        node.visible !== false &&
        boundsIntersect(
          getNodeSceneBounds(doc, node.id, activePageId) ?? getNodeBounds(node),
          bounds,
        ),
    );
}
