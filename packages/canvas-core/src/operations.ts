import { CanvasOperationError, isContainerNode } from "./context.js";
import { cloneCanvasDocument, isBoundsInside } from "./document.js";
import { getSelectionBounds } from "./geometry.js";
import type {
  CanvasNode,
  CanvasOperation,
  ContainerNode,
  CucumberCanvasDocument,
} from "./types.js";

export function applyCanvasOperation(
  doc: CucumberCanvasDocument,
  operation: CanvasOperation,
): CucumberCanvasDocument {
  const next = cloneCanvasDocument(doc);

  switch (operation.type) {
    case "insertNode": {
      const parentId = operation.containerId ?? operation.node.parentId ?? null;
      const node: CanvasNode = { ...operation.node, parentId };
      assertAgentCanWrite(next, operation.agentId, parentId, node);
      next.nodes[node.id] = node;
      addChildRef(next, parentId, node.id);
      break;
    }
    case "updateNode": {
      const existing = next.nodes[operation.nodeId];
      if (!existing) {
        throw new CanvasOperationError(
          "node_not_found",
          `Node ${operation.nodeId} does not exist.`,
        );
      }
      const candidate = {
        ...existing,
        ...operation.updates,
        id: existing.id,
        type: existing.type,
      } as CanvasNode;
      assertAgentCanWrite(
        next,
        operation.agentId,
        operation.containerId ?? candidate.parentId,
        candidate,
      );
      next.nodes[operation.nodeId] = candidate;
      break;
    }
    case "deleteNode": {
      const existing = next.nodes[operation.nodeId];
      if (!existing) {
        throw new CanvasOperationError(
          "node_not_found",
          `Node ${operation.nodeId} does not exist.`,
        );
      }
      assertAgentCanWrite(
        next,
        operation.agentId,
        operation.containerId ?? existing.parentId,
        existing,
      );
      deleteNodeRecursive(next, operation.nodeId);
      break;
    }
    case "setSelection": {
      next.selection = operation.nodeIds.filter((id) =>
        Boolean(next.nodes[id]),
      );
      break;
    }
    case "reorderNode": {
      if (typeof operation.targetIndex === "number") {
        moveNodeToParentIndex(
          next,
          operation.nodeId,
          operation.targetParentId,
          operation.targetIndex,
        );
      } else if (operation.direction) {
        reorderNode(next, operation.nodeId, operation.direction);
      } else {
        throw new CanvasOperationError(
          "invalid_operation",
          `Reorder operation for ${operation.nodeId} must include direction or targetIndex.`,
        );
      }
      break;
    }
    case "groupNodes": {
      groupNodes(next, operation.groupId, operation.nodeIds, operation.title);
      break;
    }
    case "ungroupNode": {
      ungroupNode(next, operation.groupId);
      break;
    }
    case "alignNodes": {
      alignNodes(next, operation.nodeIds, operation.alignment);
      break;
    }
    case "bindAgent": {
      const container = next.nodes[operation.containerId];
      if (!isContainerNode(container)) {
        throw new CanvasOperationError(
          "container_not_found",
          `Container ${operation.containerId} does not exist.`,
        );
      }
      next.nodes[operation.containerId] = {
        ...container,
        agentBinding: {
          ...operation.binding,
          assignedAt: operation.binding.assignedAt ?? Date.now(),
        },
      };
      break;
    }
    default: {
      const exhaustive: never = operation;
      throw new CanvasOperationError(
        "invalid_operation",
        `Unsupported canvas operation: ${JSON.stringify(exhaustive)}`,
      );
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function groupNodes(
  doc: CucumberCanvasDocument,
  groupId: string,
  nodeIds: string[],
  title?: string,
): void {
  if (doc.nodes[groupId]) {
    throw new CanvasOperationError(
      "invalid_operation",
      `Node ${groupId} already exists.`,
    );
  }

  const selectedIds = getTopLevelExistingNodeIds(doc, nodeIds);
  if (selectedIds.length < 2) {
    throw new CanvasOperationError(
      "invalid_operation",
      "Grouping requires at least two existing top-level nodes.",
    );
  }

  const firstSelectedId = selectedIds[0] as string;
  const parentId = doc.nodes[firstSelectedId]?.parentId ?? null;
  if (selectedIds.some((nodeId) => doc.nodes[nodeId]?.parentId !== parentId)) {
    throw new CanvasOperationError(
      "invalid_operation",
      "Grouped nodes must share the same parent.",
    );
  }

  const bounds = getSelectionBounds(doc, selectedIds);
  if (!bounds) {
    throw new CanvasOperationError(
      "invalid_operation",
      "Cannot group nodes without bounds.",
    );
  }

  const siblings = getSiblingOrder(doc, parentId);
  const insertionIndex = Math.min(
    ...selectedIds.map((nodeId) => siblings.indexOf(nodeId)),
  );
  siblings.splice(
    0,
    siblings.length,
    ...siblings.filter((nodeId) => !selectedIds.includes(nodeId)),
  );
  siblings.splice(Math.max(0, insertionIndex), 0, groupId);

  doc.nodes[groupId] = {
    id: groupId,
    type: "group",
    parentId,
    title: title ?? "Group",
    bounds,
    childrenOrder: selectedIds,
  };
  for (const nodeId of selectedIds) {
    const node = doc.nodes[nodeId];
    if (node) doc.nodes[nodeId] = { ...node, parentId: groupId } as CanvasNode;
  }
  doc.selection = [groupId];
}

function ungroupNode(doc: CucumberCanvasDocument, groupId: string): void {
  const group = doc.nodes[groupId];
  if (!group || group.type !== "group") {
    throw new CanvasOperationError(
      "node_not_found",
      `Group ${groupId} does not exist.`,
    );
  }

  const parentId = group.parentId;
  const siblings = getSiblingOrder(doc, parentId);
  const index = siblings.indexOf(groupId);
  const childIds = group.childrenOrder.filter((nodeId) =>
    Boolean(doc.nodes[nodeId]),
  );
  siblings.splice(
    index < 0 ? siblings.length : index,
    index < 0 ? 0 : 1,
    ...childIds,
  );
  for (const childId of childIds) {
    const child = doc.nodes[childId];
    if (child) doc.nodes[childId] = { ...child, parentId } as CanvasNode;
  }
  delete doc.nodes[groupId];
  doc.selection = childIds;
}

function alignNodes(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
  alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
): void {
  const targetIds = getTopLevelExistingNodeIds(doc, nodeIds).filter(
    (nodeId) => doc.nodes[nodeId]?.locked !== true,
  );
  if (targetIds.length < 2) {
    throw new CanvasOperationError(
      "invalid_operation",
      "Alignment requires at least two unlocked nodes.",
    );
  }

  const selectionBounds = getSelectionBounds(doc, targetIds);
  if (!selectionBounds) return;

  for (const nodeId of targetIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const bounds = node.bounds;
    const nextBounds = { ...bounds };
    if (alignment === "left") nextBounds.x = selectionBounds.x;
    if (alignment === "center") {
      nextBounds.x =
        selectionBounds.x + (selectionBounds.width - bounds.width) / 2;
    }
    if (alignment === "right") {
      nextBounds.x = selectionBounds.x + selectionBounds.width - bounds.width;
    }
    if (alignment === "top") nextBounds.y = selectionBounds.y;
    if (alignment === "middle") {
      nextBounds.y =
        selectionBounds.y + (selectionBounds.height - bounds.height) / 2;
    }
    if (alignment === "bottom") {
      nextBounds.y = selectionBounds.y + selectionBounds.height - bounds.height;
    }
    doc.nodes[nodeId] = { ...node, bounds: nextBounds } as CanvasNode;
  }
}

function reorderNode(
  doc: CucumberCanvasDocument,
  nodeId: string,
  direction: "forward" | "backward" | "front" | "back",
): void {
  const node = doc.nodes[nodeId];
  if (!node) {
    throw new CanvasOperationError(
      "node_not_found",
      `Node ${nodeId} does not exist.`,
    );
  }

  const siblings =
    node.parentId === null
      ? doc.rootNodeIds
      : getContainerChildrenOrder(doc, node.parentId);
  const index = siblings.indexOf(nodeId);
  if (index < 0) return;

  const nextIndex =
    direction === "front"
      ? siblings.length - 1
      : direction === "back"
        ? 0
        : direction === "forward"
          ? Math.min(siblings.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (nextIndex === index) return;

  siblings.splice(index, 1);
  siblings.splice(nextIndex, 0, nodeId);
}

function moveNodeToParentIndex(
  doc: CucumberCanvasDocument,
  nodeId: string,
  targetParentId: string | null | undefined,
  targetIndex: number,
): void {
  const node = doc.nodes[nodeId];
  if (!node) {
    throw new CanvasOperationError(
      "node_not_found",
      `Node ${nodeId} does not exist.`,
    );
  }

  const nextParentId = targetParentId ?? null;
  let current: string | null = nextParentId;
  while (current) {
    if (current === nodeId) {
      throw new CanvasOperationError(
        "invalid_operation",
        `Node ${nodeId} cannot become a child of itself.`,
      );
    }
    current = doc.nodes[current]?.parentId ?? null;
  }

  const sourceSiblings = getSiblingOrder(doc, node.parentId);
  const sourceIndex = sourceSiblings.indexOf(nodeId);
  if (sourceIndex >= 0) {
    sourceSiblings.splice(sourceIndex, 1);
  }

  const targetSiblings = getSiblingOrder(doc, nextParentId);
  const clampedIndex = Math.max(0, Math.min(targetIndex, targetSiblings.length));
  targetSiblings.splice(clampedIndex, 0, nodeId);

  if (node.parentId !== nextParentId) {
    doc.nodes[nodeId] = { ...node, parentId: nextParentId } as CanvasNode;
  }
}

function getSiblingOrder(
  doc: CucumberCanvasDocument,
  parentId: string | null,
): string[] {
  return parentId === null
    ? doc.rootNodeIds
    : getContainerChildrenOrder(doc, parentId);
}

function getContainerChildrenOrder(
  doc: CucumberCanvasDocument,
  parentId: string,
): string[] {
  const parent = doc.nodes[parentId];
  if (!parent || !("childrenOrder" in parent)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${parentId} does not exist.`,
    );
  }
  return parent.childrenOrder;
}

function getTopLevelExistingNodeIds(
  doc: CucumberCanvasDocument,
  nodeIds: string[],
): string[] {
  const selected = new Set(nodeIds);
  return nodeIds.filter((nodeId, index) => {
    if (nodeIds.indexOf(nodeId) !== index || !doc.nodes[nodeId]) return false;
    let parentId = doc.nodes[nodeId]?.parentId ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = doc.nodes[parentId]?.parentId ?? null;
    }
    return true;
  });
}

export function assertAgentCanWrite(
  doc: CucumberCanvasDocument,
  agentId: string | undefined,
  containerId: string | null,
  targetNode: CanvasNode,
): void {
  if (!agentId) return;
  if (!containerId) {
    throw new CanvasOperationError(
      "permission_denied",
      `Agent ${agentId} must be bound to a container before writing to the canvas.`,
    );
  }

  const container = doc.nodes[containerId];
  if (!isContainerNode(container)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${containerId} does not exist.`,
    );
  }

  if (!canWriteContainer(container, agentId)) {
    throw new CanvasOperationError(
      "permission_denied",
      `Agent ${agentId} does not have write permission in container ${containerId}.`,
    );
  }

  if (
    targetNode.id !== container.id &&
    !isBoundsInside(targetNode.bounds, container.bounds)
  ) {
    throw new CanvasOperationError(
      "bounds_violation",
      `Agent ${agentId} cannot write outside container ${containerId}.`,
    );
  }
}

function canWriteContainer(container: ContainerNode, agentId: string): boolean {
  const binding = container.agentBinding;
  if (binding?.agentId === agentId && binding.permissions?.includes("write")) {
    return true;
  }
  const permissions = container.permissions;
  if (!permissions) return false;
  if (permissions.isolationLevel === "open") return true;
  return (
    permissions.owner === agentId || permissions.canWrite.includes(agentId)
  );
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

function deleteNodeRecursive(
  doc: CucumberCanvasDocument,
  nodeId: string,
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if ("childrenOrder" in node) {
    for (const childId of [...node.childrenOrder]) {
      deleteNodeRecursive(doc, childId);
    }
  }
  if (node.parentId === null) {
    doc.rootNodeIds = doc.rootNodeIds.filter((id) => id !== nodeId);
  } else {
    const parent = doc.nodes[node.parentId];
    if (parent && "childrenOrder" in parent) {
      parent.childrenOrder = parent.childrenOrder.filter((id) => id !== nodeId);
    }
  }
  delete doc.nodes[nodeId];
}
