import { CanvasOperationError, isContainerNode } from "./context.js";
import { cloneCanvasDocument, isBoundsInside } from "./document.js";
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
