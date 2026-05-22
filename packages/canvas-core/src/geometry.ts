import type {
  CanvasBounds,
  CanvasNode,
  CucumberCanvasDocument,
} from "./types.js";

export interface OrderedCanvasNode {
  node: CanvasNode;
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
  if (boundsList.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const normalized = boundsList.map(normalizeBounds);
  const minX = Math.min(...normalized.map((bounds) => bounds.x));
  const minY = Math.min(...normalized.map((bounds) => bounds.y));
  const maxX = Math.max(...normalized.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(
    ...normalized.map((bounds) => bounds.y + bounds.height),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getSelectionBounds(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
): CanvasBounds | null {
  const boundsList = nodeIds
    .map((nodeId) => doc.nodes[nodeId]?.bounds)
    .filter((bounds): bounds is CanvasBounds => Boolean(bounds));
  if (boundsList.length === 0) return null;
  return getBoundsUnion(boundsList);
}

export function getOrderedCanvasNodes(
  doc: CucumberCanvasDocument,
): OrderedCanvasNode[] {
  const result: OrderedCanvasNode[] = [];
  const visit = (nodeId: string, depth: number) => {
    const node = doc.nodes[nodeId];
    if (!node) return;
    result.push({ node, depth });
    if ("childrenOrder" in node) {
      for (const childId of node.childrenOrder) {
        visit(childId, depth + 1);
      }
    }
  };

  for (const nodeId of doc.rootNodeIds) {
    visit(nodeId, 0);
  }
  return result;
}

export function getVisibleCanvasNodesInBounds(
  doc: CucumberCanvasDocument,
  bounds: CanvasBounds,
): CanvasNode[] {
  return getOrderedCanvasNodes(doc)
    .map((entry) => entry.node)
    .filter(
      (node) => node.visible !== false && boundsIntersect(node.bounds, bounds),
    );
}
