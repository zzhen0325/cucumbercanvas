import type {
  LineNode,
  PenConnectorEndpointBinding,
  PenConnectorEndpointKey,
  PenConnectorSide,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";
import {
  findNode,
  findParent,
  flattenNodes,
  getActiveChildren,
} from "./document.js";
import { getNodeSceneBounds } from "./geometry.js";
import { isLineNode } from "./line-geometry.js";
import type { CanvasBounds } from "./types.js";

export const CONNECTOR_SNAP_DISTANCE = 24;
export const STICKY_CONNECTOR_HANDLE_OFFSET = 18;

export type ConnectorEndpointPoint = { x: number; y: number };

export type ConnectorSnapTarget = PenConnectorEndpointBinding & {
  distance: number;
  point: ConnectorEndpointPoint;
};

export function isConnectorLineNode(
  node: PenNode | undefined,
): node is LineNode & { connector: NonNullable<LineNode["connector"]> } {
  return isLineNode(node) && Boolean(node.connector);
}

export function connectorPointForBounds(
  bounds: CanvasBounds,
  side: PenConnectorSide,
  ratio: number,
): ConnectorEndpointPoint {
  const t = clamp01(ratio);
  switch (side) {
    case "top":
      return { x: bounds.x + bounds.width * t, y: bounds.y };
    case "right":
      return { x: bounds.x + bounds.width, y: bounds.y + bounds.height * t };
    case "bottom":
      return {
        x: bounds.x + bounds.width * t,
        y: bounds.y + bounds.height,
      };
    case "left":
      return { x: bounds.x, y: bounds.y + bounds.height * t };
    default: {
      const _exhaustive: never = side;
      throw new Error(`Unsupported connector side: ${String(_exhaustive)}`);
    }
  }
}

export function connectorPointForNodeBounds(
  node: PenNode,
  bounds: CanvasBounds,
  side: PenConnectorSide,
  ratio: number,
): ConnectorEndpointPoint {
  const point = connectorPointForBounds(bounds, side, ratio);
  if (!isStickyConnectorTargetNode(node)) return point;
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - STICKY_CONNECTOR_HANDLE_OFFSET };
    case "right":
      return { x: point.x + STICKY_CONNECTOR_HANDLE_OFFSET, y: point.y };
    case "bottom":
      return { x: point.x, y: point.y + STICKY_CONNECTOR_HANDLE_OFFSET };
    case "left":
      return { x: point.x - STICKY_CONNECTOR_HANDLE_OFFSET, y: point.y };
    default: {
      const _exhaustive: never = side;
      throw new Error(`Unsupported connector side: ${String(_exhaustive)}`);
    }
  }
}

export function resolveConnectorEndpointPoint(
  doc: PenDocument,
  endpoint: PenConnectorEndpointBinding,
  activePageId?: string | null,
): ConnectorEndpointPoint | null {
  const target = findNode(doc, endpoint.nodeId, activePageId);
  if (!isConnectorTargetNode(target)) return null;
  const bounds = getNodeSceneBounds(doc, target.id, activePageId);
  if (!bounds) return null;
  return connectorPointForNodeBounds(
    target,
    bounds,
    endpoint.side,
    endpoint.ratio,
  );
}

export function findConnectorSnapTarget(
  doc: PenDocument,
  point: ConnectorEndpointPoint,
  options: {
    activePageId?: string | null;
    excludeNodeIds?: Iterable<string>;
    threshold?: number;
  } = {},
): ConnectorSnapTarget | null {
  const excluded = new Set(options.excludeNodeIds ?? []);
  const threshold = options.threshold ?? CONNECTOR_SNAP_DISTANCE;
  let best: ConnectorSnapTarget | null = null;

  for (const node of flattenNodes(doc, options.activePageId)) {
    if (!isConnectorTargetNode(node) || excluded.has(node.id)) continue;
    const bounds = getNodeSceneBounds(doc, node.id, options.activePageId);
    if (!bounds) continue;
    const snap = snapPointToBounds(node, bounds, point);
    if (!snap || snap.distance > threshold) continue;
    if (!best || snap.distance < best.distance) best = snap;
  }

  return best;
}

export function detachConnectorEndpoint(
  node: LineNode,
  endpoint: PenConnectorEndpointKey,
): LineNode {
  if (!node.connector) return node;
  const nextConnector = { ...node.connector, [endpoint]: undefined };
  if (!nextConnector.start && !nextConnector.end) {
    const { connector: _connector, ...rest } = node;
    return rest as LineNode;
  }
  return { ...node, connector: nextConnector };
}

export function reconcileCanvasConnectors(
  doc: PenDocument,
  options: {
    activePageId?: string | null;
    deletedNodeIds?: Iterable<string>;
    pruneDeleted?: boolean;
  } = {},
): PenDocument {
  const deleted = new Set(options.deletedNodeIds ?? []);
  const rootChildren = getActiveChildren(doc, options.activePageId);
  const removeConnectorIds = new Set<string>();
  const updates = new Map<string, PenNode>();

  for (const node of flattenNodes(doc, options.activePageId)) {
    if (!isConnectorLineNode(node)) continue;
    const invalidEndpoint = getInvalidConnectorEndpoint(
      doc,
      node,
      deleted,
      options.activePageId,
    );
    if (invalidEndpoint) {
      if (options.pruneDeleted) {
        removeConnectorIds.add(node.id);
        continue;
      }
      throw new Error(
        `Connector ${node.id} references missing ${invalidEndpoint} target. Remove or repair the connector before editing the canvas.`,
      );
    }
    updates.set(
      node.id,
      updateConnectorLineEndpoints(doc, node, options.activePageId),
    );
  }

  if (removeConnectorIds.size === 0 && updates.size === 0) return doc;

  const nextChildren = updateConnectorNodesInList(
    rootChildren,
    updates,
    removeConnectorIds,
  );
  const pages = doc.pages?.map((page) =>
    page.id === (options.activePageId ?? doc.activePageId)
      ? { ...page, children: nextChildren }
      : page,
  );
  return {
    ...doc,
    ...(pages ? { pages, children: [] } : { children: nextChildren }),
  };
}

function updateConnectorLineEndpoints(
  doc: PenDocument,
  node: LineNode,
  activePageId?: string | null,
): LineNode {
  const parentOrigin = getParentSceneOrigin(doc, node.id, activePageId);
  const start = node.connector?.start
    ? resolveConnectorEndpointPoint(doc, node.connector.start, activePageId)
    : null;
  const end = node.connector?.end
    ? resolveConnectorEndpointPoint(doc, node.connector.end, activePageId)
    : null;

  const next: LineNode = { ...node };
  if (start) {
    next.x = start.x - parentOrigin.x;
    next.y = start.y - parentOrigin.y;
  }
  if (end) {
    next.x2 = end.x - parentOrigin.x;
    next.y2 = end.y - parentOrigin.y;
  }
  if (node.connector?.arrow) {
    const baseStroke = next.stroke ?? {
      thickness: 3,
      fill: [{ type: "solid" as const, color: "#111827" }],
    };
    next.stroke = {
      ...baseStroke,
      thickness: baseStroke.thickness ?? 3,
      fill: baseStroke.fill ?? [{ type: "solid" as const, color: "#111827" }],
      endTip: baseStroke.endTip ?? "line-arrow",
    };
  }
  return next;
}

function updateConnectorNodesInList(
  nodes: PenNode[],
  updates: Map<string, PenNode>,
  removeConnectorIds: Set<string>,
): PenNode[] {
  return nodes
    .filter((node) => !removeConnectorIds.has(node.id))
    .map((node) => {
      const updated = updates.get(node.id) ?? node;
      if ("children" in updated && Array.isArray(updated.children)) {
        return {
          ...updated,
          children: updateConnectorNodesInList(
            updated.children as PenNode[],
            updates,
            removeConnectorIds,
          ),
        } as PenNode;
      }
      return updated;
    });
}

function getInvalidConnectorEndpoint(
  doc: PenDocument,
  node: LineNode,
  deleted: Set<string>,
  activePageId?: string | null,
): PenConnectorEndpointKey | null {
  for (const key of ["start", "end"] as const) {
    const endpoint = node.connector?.[key];
    if (!endpoint) continue;
    if (deleted.has(endpoint.nodeId)) return key;
    if (!isConnectorTargetNode(findNode(doc, endpoint.nodeId, activePageId))) {
      return key;
    }
  }
  return null;
}

function snapPointToBounds(
  node: PenNode,
  bounds: CanvasBounds,
  point: ConnectorEndpointPoint,
): ConnectorSnapTarget | null {
  const candidates: ConnectorSnapTarget[] = [
    sideCandidate(node, bounds, point, "top"),
    sideCandidate(node, bounds, point, "right"),
    sideCandidate(node, bounds, point, "bottom"),
    sideCandidate(node, bounds, point, "left"),
  ];
  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function sideCandidate(
  node: PenNode,
  bounds: CanvasBounds,
  point: ConnectorEndpointPoint,
  side: PenConnectorSide,
): ConnectorSnapTarget {
  const horizontal = side === "top" || side === "bottom";
  const rawRatio = horizontal
    ? (point.x - bounds.x) / Math.max(bounds.width, 1)
    : (point.y - bounds.y) / Math.max(bounds.height, 1);
  const ratio = clamp01(rawRatio);
  const snapPoint = connectorPointForNodeBounds(node, bounds, side, ratio);
  return {
    nodeId: node.id,
    side,
    ratio,
    distance: Math.hypot(point.x - snapPoint.x, point.y - snapPoint.y),
    point: snapPoint,
  };
}

function isStickyConnectorTargetNode(node: PenNode): boolean {
  return node.meta?.boardKind === "sticky";
}

function isConnectorTargetNode(node: PenNode | undefined): node is PenNode {
  return Boolean(
    node &&
      node.visible !== false &&
      (node.type === "frame" ||
        node.type === "group" ||
        node.type === "rectangle"),
  );
}

function getParentSceneOrigin(
  doc: PenDocument,
  nodeId: string,
  activePageId?: string | null,
) {
  let x = 0;
  let y = 0;
  let parent = findParent(doc, nodeId, activePageId);
  while (parent) {
    x += parent.x ?? 0;
    y += parent.y ?? 0;
    parent = findParent(doc, parent.id, activePageId);
  }
  return { x, y };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
