import type { PenDocument, PenNode, FrameNode, GroupNode } from '@cucumber/pen-types';
import type { CanvasOperation } from './types.js';
import { CanvasOperationError, isContainerNode, isAgentContainer } from './context.js';
import {
  cloneDocument,
  findNode,
  findNodeInList,
  findParent,
  getActiveChildren,
  getNodeBounds,
  setActiveChildren,
} from './document.js';
import { getSelectionBounds } from './geometry.js';

export function applyCanvasOperation(
  doc: PenDocument,
  operation: CanvasOperation,
): PenDocument {
  const next = cloneDocument(doc);

  switch (operation.type) {
    case 'insertNode': {
      const node = structuredClone(operation.node);
      const parentId = operation.parentId ?? operation.containerId ?? null;
      assertAgentCanWrite(next, operation.agentId, parentId);
      insertNodeInDoc(next, node, parentId, operation.index);
      break;
    }
    case 'updateNode': {
      const existing = findNode(next, operation.nodeId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      const candidate = { ...existing, ...operation.updates, id: existing.id, type: existing.type } as PenNode;
      assertAgentCanWrite(next, operation.agentId, null);
      updateNodeInDoc(next, operation.nodeId, candidate);
      break;
    }
    case 'deleteNode': {
      const existing = findNode(next, operation.nodeId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      assertAgentCanWrite(next, operation.agentId, null);
      removeNodeFromDoc(next, operation.nodeId);
      break;
    }
    case 'setSelection': {
      break;
    }
    case 'moveNode': {
      const existing = findNode(next, operation.nodeId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      moveNodeInDoc(next, operation.nodeId, operation.newParentId ?? null, operation.index);
      break;
    }
    case 'groupNodes': {
      groupNodesInDoc(next, operation.groupId, operation.nodeIds, operation.title);
      break;
    }
    case 'ungroupNode': {
      ungroupNodeInDoc(next, operation.groupId);
      break;
    }
    case 'alignNodes': {
      alignNodesInDoc(next, operation.nodeIds, operation.alignment);
      break;
    }
    case 'bindAgent': {
      const targetNodeId = operation.nodeId ?? operation.containerId;
      if (!targetNodeId) throw new CanvasOperationError('invalid_operation', 'bindAgent requires nodeId.');
      const node = findNode(next, targetNodeId);
      if (!isContainerNode(node)) {
        throw new CanvasOperationError('container_not_found', `Node ${targetNodeId} is not a container.`);
      }
      updateNodeInDoc(next, targetNodeId, {
        ...node,
        agentBinding: { ...operation.binding, assignedAt: operation.binding.assignedAt ?? Date.now() },
      } as PenNode);
      break;
    }
    case 'reorderNode': {
      // No-op for backward compat — tree ordering managed by parent children array
      break;
    }
    case 'createDataFlowEdge':
    case 'removeDataFlowEdge': {
      // DataFlow edges are managed by DataFlowEngine, persisted separately
      break;
    }
    default: {
      const _exhaustive: never = operation;
      throw new CanvasOperationError('invalid_operation', `Unsupported operation: ${JSON.stringify(_exhaustive)}`);
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Tree mutation helpers
// ---------------------------------------------------------------------------

function insertNodeInDoc(doc: PenDocument, node: PenNode, parentId: string | null, index?: number): void {
  if (parentId === null) {
    const children = getActiveChildren(doc);
    const newChildren = [...children];
    if (index !== undefined && index >= 0 && index <= newChildren.length) {
      newChildren.splice(index, 0, node);
    } else {
      newChildren.push(node);
    }
    const updated = setActiveChildren(doc, newChildren);
    doc.pages = updated.pages;
    doc.children = updated.children;
    return;
  }
  const parent = findNode(doc, parentId);
  if (!parent || !('children' in parent)) {
    throw new CanvasOperationError('container_not_found', `Parent ${parentId} not found or not a container.`);
  }
  const children = [...(parent.children as PenNode[] ?? [])];
  if (index !== undefined && index >= 0 && index <= children.length) {
    children.splice(index, 0, node);
  } else {
    children.push(node);
  }
  updateNodeInDoc(doc, parentId, { ...parent, children } as PenNode);
}

function updateNodeInDoc(doc: PenDocument, nodeId: string, updated: PenNode): void {
  const children = getActiveChildren(doc);
  const newChildren = replaceNodeInList(children, nodeId, updated);
  const updatedDoc = setActiveChildren(doc, newChildren);
  doc.pages = updatedDoc.pages;
  doc.children = updatedDoc.children;
}

function replaceNodeInList(nodes: PenNode[], nodeId: string, updated: PenNode): PenNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) return updated;
    if ('children' in node && Array.isArray(node.children)) {
      return {
        ...node,
        children: replaceNodeInList(node.children as PenNode[], nodeId, updated),
      } as PenNode;
    }
    return node;
  });
}

function removeNodeFromDoc(doc: PenDocument, nodeId: string): void {
  const children = getActiveChildren(doc);
  const removed = removeNodeFromList(children, nodeId);
  if (!removed.removed) {
    throw new CanvasOperationError('node_not_found', `Node ${nodeId} not found in tree.`);
  }
  const updated = setActiveChildren(doc, removed.nodes);
  doc.pages = updated.pages;
  doc.children = updated.children;
}

function removeNodeFromList(nodes: PenNode[], nodeId: string): { nodes: PenNode[]; removed: boolean } {
  const filtered = nodes.filter((n) => n.id !== nodeId);
  if (filtered.length < nodes.length) {
    return { nodes: filtered, removed: true };
  }
  let removed = false;
  const mapped = nodes.map((node) => {
    if ('children' in node && Array.isArray(node.children)) {
      const result = removeNodeFromList(node.children as PenNode[], nodeId);
      if (result.removed) {
        removed = true;
        return { ...node, children: result.nodes } as PenNode;
      }
    }
    return node;
  });
  return { nodes: mapped, removed };
}

function moveNodeInDoc(doc: PenDocument, nodeId: string, newParentId: string | null, index?: number): void {
  const node = findNode(doc, nodeId);
  if (!node) throw new CanvasOperationError('node_not_found', `Node ${nodeId} does not exist.`);

  // Check for cycles
  if (newParentId) {
    let current = findNode(doc, newParentId);
    while (current) {
      if (current.id === nodeId) {
        throw new CanvasOperationError('invalid_operation', `Cannot move node into itself.`);
      }
      current = findParent(doc, current.id);
    }
  }

  removeNodeFromDoc(doc, nodeId);
  insertNodeInDoc(doc, node, newParentId, index);
}

export function groupNodesInDoc(doc: PenDocument, groupId: string, nodeIds: string[], title?: string): void {
  const existing = findNode(doc, groupId);
  if (existing) throw new CanvasOperationError('invalid_operation', `Node ${groupId} already exists.`);

  const nodes = nodeIds.map((id) => findNode(doc, id)).filter(Boolean) as PenNode[];
  if (nodes.length < 2) throw new CanvasOperationError('invalid_operation', 'Grouping requires at least two existing nodes.');

  // Ensure all nodes share the same parent
  const parents = nodes.map((n) => findParent(doc, n.id)?.id ?? null);
  if (new Set(parents).size > 1) {
    throw new CanvasOperationError('invalid_operation', 'Grouped nodes must share the same parent.');
  }

  const bounds = getSelectionBoundsFromNodes(nodes);
  const group: GroupNode = {
    id: groupId,
    type: 'group',
    name: title ?? 'Group',
    x: bounds?.x ?? 0,
    y: bounds?.y ?? 0,
    width: bounds?.width ?? 100,
    height: bounds?.height ?? 100,
    children: nodes.map((n) => ({ ...n })),
  };

  // Remove nodes from their current positions and add group
  for (const n of nodes) {
    removeNodeFromDoc(doc, n.id);
  }
  insertNodeInDoc(doc, group, parents[0]!, undefined);
}

export function ungroupNodeInDoc(doc: PenDocument, groupId: string): void {
  const group = findNode(doc, groupId);
  if (!group || group.type !== 'group') {
    throw new CanvasOperationError('node_not_found', `Group ${groupId} does not exist.`);
  }

  const parent = findParent(doc, groupId);
  const parentId = parent?.id ?? null;
  const children = (group as GroupNode).children ?? [];

  removeNodeFromDoc(doc, groupId);
  for (const child of children) {
    insertNodeInDoc(doc, child, parentId, undefined);
  }
}

function alignNodesInDoc(
  doc: PenDocument,
  nodeIds: string[],
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
): void {
  const nodes = nodeIds.map((id) => findNode(doc, id)).filter(Boolean) as PenNode[];
  if (nodes.length < 2) throw new CanvasOperationError('invalid_operation', 'Alignment requires at least two nodes.');

  const bounds = getSelectionBoundsFromNodes(nodes);
  if (!bounds) return;

  for (const node of nodes) {
    if (node.locked) continue;
    const updates: Partial<PenNode> = {};
    if (alignment === 'left') updates.x = bounds.x;
    if (alignment === 'center') updates.x = bounds.x + (bounds.width - (getNodeBounds(node).width)) / 2;
    if (alignment === 'right') updates.x = bounds.x + bounds.width - getNodeBounds(node).width;
    if (alignment === 'top') updates.y = bounds.y;
    if (alignment === 'middle') updates.y = bounds.y + (bounds.height - getNodeBounds(node).height) / 2;
    if (alignment === 'bottom') updates.y = bounds.y + bounds.height - getNodeBounds(node).height;
    updateNodeInDoc(doc, node.id, { ...node, ...updates } as PenNode);
  }
}

function getSelectionBoundsFromNodes(nodes: PenNode[]) {
  const boundsList = nodes.map(getNodeBounds);
  if (boundsList.length === 0) return null;
  const minX = Math.min(...boundsList.map((b) => b.x));
  const minY = Math.min(...boundsList.map((b) => b.y));
  const maxX = Math.max(...boundsList.map((b) => b.x + b.width));
  const maxY = Math.max(...boundsList.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

export function assertAgentCanWrite(
  doc: PenDocument,
  agentId: string | undefined,
  containerId: string | null,
): void {
  if (!agentId) return;
  if (!containerId) {
    throw new CanvasOperationError(
      'permission_denied',
      `Agent ${agentId} must be bound to a container before writing to the canvas.`,
    );
  }
  const container = findNode(doc, containerId);
  if (!isAgentContainer(container)) {
    throw new CanvasOperationError(
      'container_not_found',
      `Container ${containerId} does not exist or has no agent binding.`,
    );
  }
  if (!canWriteContainer(container, agentId)) {
    throw new CanvasOperationError(
      'permission_denied',
      `Agent ${agentId} does not have write permission in container ${containerId}.`,
    );
  }
}

function canWriteContainer(container: PenNode, agentId: string): boolean {
  const binding = container.agentBinding;
  if (binding?.agentId === agentId && binding.permissions?.includes('write')) return true;
  const permissions = container.permissions;
  if (!permissions) return false;
  if (permissions.isolationLevel === 'open') return true;
  return permissions.owner === agentId || permissions.canWrite.includes(agentId);
}
