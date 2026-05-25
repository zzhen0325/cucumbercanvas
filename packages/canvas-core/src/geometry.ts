import type { PenDocument, PenNode } from '@cucumber/pen-types';
import type { CanvasBounds } from './types.js';
import { findNode, flattenNodes, getNodeBounds } from './document.js';

export interface OrderedCanvasNode {
  node: PenNode;
  depth: number;
}

export function normalizeBounds(bounds: CanvasBounds): CanvasBounds {
  const x = Math.min(bounds.x, bounds.x + bounds.width);
  const y = Math.min(bounds.y, bounds.y + bounds.height);
  return { ...bounds, x, y, width: Math.abs(bounds.width), height: Math.abs(bounds.height) };
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

export function getSelectionBounds(doc: PenDocument, nodeIds: string[]): CanvasBounds | null {
  const boundsList = nodeIds
    .map((id) => findNode(doc, id))
    .filter(Boolean)
    .map((n) => getNodeBounds(n!));
  if (boundsList.length === 0) return null;
  return getBoundsUnion(boundsList);
}

export function getOrderedCanvasNodes(doc: PenDocument): OrderedCanvasNode[] {
  const result: OrderedCanvasNode[] = [];
  const walk = (nodes: PenNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children as PenNode[], depth + 1);
      }
    }
  };
  // Get children from active page
  const children = doc.pages?.[0]?.children ?? doc.children;
  walk(children, 0);
  return result;
}

export function getVisibleCanvasNodesInBounds(
  doc: PenDocument,
  bounds: CanvasBounds,
): PenNode[] {
  return getOrderedCanvasNodes(doc)
    .map((e) => e.node)
    .filter((node) => node.visible !== false && boundsIntersect(getNodeBounds(node), bounds));
}
