import { CanvasOperationError } from "./context.js";
import { cloneCanvasDocument } from "./document.js";
import { createCanvasNodeId } from "./document.js";
import type {
  CanvasAsset,
  CanvasNode,
  CucumberCanvasDocument,
} from "./types.js";

export interface CanvasClipboardData {
  nodes: Record<string, CanvasNode>;
  rootNodeIds: string[];
  assets: Record<string, CanvasAsset>;
}

export interface PasteCanvasClipboardResult {
  doc: CucumberCanvasDocument;
  pastedIds: string[];
}

export function copyCanvasSelection(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
): CanvasClipboardData {
  const selected = getTopLevelSelectedNodeIds(doc, nodeIds);
  const nodes: Record<string, CanvasNode> = {};
  const assets: Record<string, CanvasAsset> = {};

  const collect = (nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (!node) {
      throw new CanvasOperationError(
        "node_not_found",
        `Node ${nodeId} does not exist.`,
      );
    }
    nodes[nodeId] = structuredClone(node);
    if (node.type === "image") {
      const asset = doc.assets[node.assetId];
      if (asset) assets[asset.id] = structuredClone(asset);
    }
    if ("childrenOrder" in node) {
      for (const childId of node.childrenOrder) collect(childId);
    }
  };

  for (const nodeId of selected) collect(nodeId);
  return { nodes, rootNodeIds: selected, assets };
}

export function duplicateCanvasNodes(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
  offset = 16,
): PasteCanvasClipboardResult {
  return pasteCanvasClipboard(doc, copyCanvasSelection(doc, nodeIds), {
    offset,
    preserveParent: true,
  });
}

export function pasteCanvasClipboard(
  doc: CucumberCanvasDocument,
  clipboard: CanvasClipboardData,
  options?: {
    offset?: number;
    parentId?: string | null;
    preserveParent?: boolean;
  },
): PasteCanvasClipboardResult {
  const next = cloneCanvasDocument(doc);
  const offset = options?.offset ?? 16;
  const idMap = new Map<string, string>();
  const pastedIds: string[] = [];

  for (const asset of Object.values(clipboard.assets)) {
    next.assets[asset.id] = structuredClone(asset);
  }

  const cloneNode = (oldId: string, parentId: string | null): string => {
    const original = clipboard.nodes[oldId];
    if (!original) {
      throw new CanvasOperationError(
        "node_not_found",
        `Clipboard node ${oldId} does not exist.`,
      );
    }

    const newId = idMap.get(oldId) ?? createCanvasNodeId(original.type);
    idMap.set(oldId, newId);

    const clone: CanvasNode = {
      ...structuredClone(original),
      id: newId,
      parentId,
      bounds: {
        ...original.bounds,
        x: original.bounds.x + offset,
        y: original.bounds.y + offset,
      },
      title: original.title ? `${original.title} copy` : original.title,
    };

    if ("childrenOrder" in clone) {
      clone.childrenOrder = [];
    }

    next.nodes[newId] = clone;
    addChildRef(next, parentId, newId);

    if ("childrenOrder" in original) {
      const containerClone = next.nodes[newId];
      if (!containerClone || !("childrenOrder" in containerClone)) return newId;
      for (const childId of original.childrenOrder) {
        const childCloneId = cloneNode(childId, newId);
        if (!containerClone.childrenOrder.includes(childCloneId)) {
          containerClone.childrenOrder.push(childCloneId);
        }
      }
    }

    return newId;
  };

  for (const rootId of clipboard.rootNodeIds) {
    const original = clipboard.nodes[rootId];
    const parentId =
      options && "parentId" in options
        ? (options.parentId ?? null)
        : options?.preserveParent
          ? (original?.parentId ?? null)
          : null;
    const cloneId = cloneNode(rootId, parentId);
    pastedIds.push(cloneId);
  }

  next.selection = pastedIds;
  next.updatedAt = new Date().toISOString();
  return { doc: next, pastedIds };
}

function getTopLevelSelectedNodeIds(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
): string[] {
  const selected = new Set(nodeIds.filter((id) => Boolean(doc.nodes[id])));
  return nodeIds.filter((nodeId) => {
    if (!selected.has(nodeId)) return false;
    let current = doc.nodes[nodeId]?.parentId ?? null;
    while (current) {
      if (selected.has(current)) return false;
      current = doc.nodes[current]?.parentId ?? null;
    }
    return true;
  });
}

function addChildRef(
  doc: CucumberCanvasDocument,
  parentId: string | null,
  nodeId: string,
): void {
  if (parentId === null) {
    if (!doc.rootNodeIds.includes(nodeId)) doc.rootNodeIds.push(nodeId);
    return;
  }
  const parent = doc.nodes[parentId];
  if (
    parent &&
    "childrenOrder" in parent &&
    !parent.childrenOrder.includes(nodeId)
  ) {
    parent.childrenOrder.push(nodeId);
  }
}
