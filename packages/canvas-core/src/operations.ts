import type { GroupNode, PenDocument, PenNode } from '@cucumber/pen-types';
import { CanvasOperationError, isAgentContainer, isContainerNode } from './context.js';
import {
  cloneDocument,
  findNode,
  findNodeInList,
  findParent,
  getActiveChildren,
  getNodeBounds,
  isBoundsInside,
  setActiveChildren,
} from './document.js';
import type { CanvasOperation } from './types.js';

export function applyCanvasOperation(
  doc: PenDocument,
  operation: CanvasOperation,
): PenDocument {
  const next = cloneDocument(doc);
  const activePageId = 'activePageId' in operation ? operation.activePageId : undefined;
  validateOperationActivePage(next, operation, activePageId);

  switch (operation.type) {
    case 'insertNode': {
      const node = structuredClone(operation.node);
      const parentId = operation.parentId ?? operation.containerId ?? null;
      assertAgentCanWrite(next, operation.agentId, parentId, activePageId, node);
      insertNodeInDoc(next, node, parentId, operation.index, activePageId);
      break;
    }
    case 'updateNode': {
      const existing = findNode(next, operation.nodeId, activePageId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      const candidate = { ...existing, ...operation.updates, id: existing.id, type: existing.type } as PenNode;
      const legacyContainerId = (operation as { containerId?: string | null }).containerId ?? null;
      assertAgentCanWrite(next, operation.agentId, legacyContainerId, activePageId, candidate);
      updateNodeInDoc(next, operation.nodeId, candidate, activePageId);
      break;
    }
    case 'deleteNode': {
      const existing = findNode(next, operation.nodeId, activePageId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      assertAgentCanWrite(next, operation.agentId, null, activePageId);
      removeNodeFromDoc(next, operation.nodeId, activePageId);
      break;
    }
    case 'setSelection': {
      getActiveChildren(next, activePageId);
      break;
    }
    case 'moveNode': {
      const existing = findNode(next, operation.nodeId, activePageId);
      if (!existing) {
        throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
      }
      moveNodeInDoc(next, operation.nodeId, operation.newParentId ?? null, operation.index, activePageId);
      break;
    }
    case 'groupNodes': {
      groupNodesInDoc(next, operation.groupId, operation.nodeIds, operation.title, activePageId);
      break;
    }
    case 'ungroupNode': {
      ungroupNodeInDoc(next, operation.groupId, activePageId);
      break;
    }
    case 'alignNodes': {
      alignNodesInDoc(next, operation.nodeIds, operation.alignment, activePageId);
      break;
    }
    case 'bindAgent': {
      const targetNodeId = operation.nodeId ?? operation.containerId;
      if (!targetNodeId) throw new CanvasOperationError('invalid_operation', 'bindAgent requires nodeId.');
      const node = findNode(next, targetNodeId, activePageId);
      if (!isContainerNode(node)) {
        throw new CanvasOperationError('container_not_found', `Node ${targetNodeId} is not a container.`);
      }
      updateNodeInDoc(next, targetNodeId, {
        ...node,
        agentBinding: { ...operation.binding, assignedAt: operation.binding.assignedAt ?? Date.now() },
      } as PenNode, activePageId);
      break;
    }
    case 'reorderNode': {
      reorderNodeInDoc(next, operation, activePageId);
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

export function detachNodesOutsideParentBounds(
  doc: PenDocument,
  nodeIds: string[],
  activePageId?: string | null,
): { doc: PenDocument; detachedIds: string[] } {
  const next = cloneDocument(doc);
  const requested = new Set(nodeIds);
  const detachedIds: string[] = [];

  for (const nodeId of nodeIds) {
    if (hasRequestedAncestor(next, nodeId, requested, activePageId)) {
      continue;
    }

    const node = findNode(next, nodeId, activePageId);
    const parent = findParent(next, nodeId, activePageId);
    if (!node || !parent || !isReparentableCanvasParent(parent)) {
      continue;
    }

    const nodeBounds = getNodeBounds(node);
    const parentBounds = getNodeBounds(parent);
    const nodeCenter = {
      x: nodeBounds.x + nodeBounds.width / 2,
      y: nodeBounds.y + nodeBounds.height / 2,
    };

    if (
      nodeCenter.x >= 0 &&
      nodeCenter.y >= 0 &&
      nodeCenter.x <= parentBounds.width &&
      nodeCenter.y <= parentBounds.height
    ) {
      continue;
    }

    const parentOrigin = getSceneOrigin(next, parent.id, activePageId);
    const newParent = findParent(next, parent.id, activePageId);
    const newParentId = newParent?.id ?? null;
    const newParentOrigin = newParent
      ? getSceneOrigin(next, newParent.id, activePageId)
      : { x: 0, y: 0 };
    const updates = buildScenePreservingUpdates(
      node,
      parentOrigin,
      newParentOrigin,
    );

    updateNodeInDoc(
      next,
      nodeId,
      { ...node, ...updates } as PenNode,
      activePageId,
    );
    moveNodeInDoc(next, nodeId, newParentId, undefined, activePageId);
    detachedIds.push(nodeId);
  }

  return { doc: next, detachedIds };
}

function hasRequestedAncestor(
  doc: PenDocument,
  nodeId: string,
  requested: Set<string>,
  activePageId?: string | null,
): boolean {
  let parent = findParent(doc, nodeId, activePageId);
  while (parent) {
    if (requested.has(parent.id)) return true;
    parent = findParent(doc, parent.id, activePageId);
  }
  return false;
}

function isReparentableCanvasParent(node: PenNode): boolean {
  return node.type === 'frame' || node.type === 'group';
}

function getSceneOrigin(
  doc: PenDocument,
  nodeId: string,
  activePageId?: string | null,
): { x: number; y: number } {
  const node = findNode(doc, nodeId, activePageId);
  if (!node) {
    throw new CanvasOperationError(
      'node_not_found',
      `Node ${nodeId} does not exist.`,
    );
  }

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

function buildScenePreservingUpdates(
  node: PenNode,
  oldParentOrigin: { x: number; y: number },
  newParentOrigin: { x: number; y: number },
): Partial<PenNode> {
  const updates: Record<string, unknown> = {
    x: oldParentOrigin.x + (node.x ?? 0) - newParentOrigin.x,
    y: oldParentOrigin.y + (node.y ?? 0) - newParentOrigin.y,
  };
  const line = node as PenNode & { x2?: number; y2?: number };
  if (typeof line.x2 === 'number') {
    updates.x2 = oldParentOrigin.x + line.x2 - newParentOrigin.x;
  }
  if (typeof line.y2 === 'number') {
    updates.y2 = oldParentOrigin.y + line.y2 - newParentOrigin.y;
  }
  return updates as Partial<PenNode>;
}

function validateOperationActivePage(
  doc: PenDocument,
  operation: CanvasOperation,
  activePageId?: string | null,
): void {
  if (operation.type === 'createDataFlowEdge' || operation.type === 'removeDataFlowEdge') {
    return;
  }
  getActiveChildren(doc, activePageId);
}

// ---------------------------------------------------------------------------
// Tree mutation helpers
// ---------------------------------------------------------------------------

function insertNodeInDoc(
  doc: PenDocument,
  node: PenNode,
  parentId: string | null,
  index?: number,
  activePageId?: string | null,
): void {
  if (parentId === null) {
    const children = getActiveChildren(doc, activePageId);
    const newChildren = [...children];
    if (index !== undefined && index >= 0 && index <= newChildren.length) {
      newChildren.splice(index, 0, node);
    } else {
      newChildren.push(node);
    }
    const updated = setActiveChildren(doc, newChildren, activePageId);
    doc.activePageId = updated.activePageId;
    doc.pages = updated.pages;
    doc.children = updated.children;
    return;
  }
  const parent = findNode(doc, parentId, activePageId);
  if (!parent || !('children' in parent)) {
    throw new CanvasOperationError('container_not_found', `Parent ${parentId} not found or not a container.`);
  }
  const children = [...(parent.children as PenNode[] ?? [])];
  if (index !== undefined && index >= 0 && index <= children.length) {
    children.splice(index, 0, node);
  } else {
    children.push(node);
  }
  updateNodeInDoc(doc, parentId, { ...parent, children } as PenNode, activePageId);
}

function updateNodeInDoc(
  doc: PenDocument,
  nodeId: string,
  updated: PenNode,
  activePageId?: string | null,
): void {
  const children = getActiveChildren(doc, activePageId);
  const newChildren = replaceNodeInList(children, nodeId, updated);
  const updatedDoc = setActiveChildren(doc, newChildren, activePageId);
  doc.activePageId = updatedDoc.activePageId;
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

function removeNodeFromDoc(doc: PenDocument, nodeId: string, activePageId?: string | null): void {
  const children = getActiveChildren(doc, activePageId);
  const removed = removeNodeFromList(children, nodeId);
  if (!removed.removed) {
    throw new CanvasOperationError('node_not_found', `Node ${nodeId} not found in tree.`);
  }
  const updated = setActiveChildren(doc, removed.nodes, activePageId);
  doc.activePageId = updated.activePageId;
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

function moveNodeInDoc(
  doc: PenDocument,
  nodeId: string,
  newParentId: string | null,
  index?: number,
  activePageId?: string | null,
): void {
  const node = findNode(doc, nodeId, activePageId);
  if (!node) throw new CanvasOperationError('node_not_found', `Node ${nodeId} does not exist.`);

  // Check for cycles
  if (newParentId) {
    let current = findNode(doc, newParentId, activePageId);
    while (current) {
      if (current.id === nodeId) {
        throw new CanvasOperationError('invalid_operation', `Cannot move node into itself.`);
      }
      current = findParent(doc, current.id, activePageId);
    }
  }

  removeNodeFromDoc(doc, nodeId, activePageId);
  insertNodeInDoc(doc, node, newParentId, index, activePageId);
}

export function groupNodesInDoc(
  doc: PenDocument,
  groupId: string,
  nodeIds: string[],
  title?: string,
  activePageId?: string | null,
): void {
  const existing = findNode(doc, groupId, activePageId);
  if (existing) throw new CanvasOperationError('invalid_operation', `Node ${groupId} already exists.`);

  const nodes = nodeIds.map((id) => findNode(doc, id, activePageId)).filter(Boolean) as PenNode[];
  if (nodes.length < 2) throw new CanvasOperationError('invalid_operation', 'Grouping requires at least two existing nodes.');

  // Ensure all nodes share the same parent
  const parents = nodes.map((n) => findParent(doc, n.id, activePageId)?.id ?? null);
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
    removeNodeFromDoc(doc, n.id, activePageId);
  }
  insertNodeInDoc(doc, group, parents[0] ?? null, undefined, activePageId);
}

export function ungroupNodeInDoc(
  doc: PenDocument,
  groupId: string,
  activePageId?: string | null,
): void {
  const group = findNode(doc, groupId, activePageId);
  if (!group || group.type !== 'group') {
    throw new CanvasOperationError('node_not_found', `Group ${groupId} does not exist.`);
  }

  const parent = findParent(doc, groupId, activePageId);
  const parentId = parent?.id ?? null;
  const children = (group as GroupNode).children ?? [];

  removeNodeFromDoc(doc, groupId, activePageId);
  for (const child of children) {
    insertNodeInDoc(doc, child, parentId, undefined, activePageId);
  }
}

function alignNodesInDoc(
  doc: PenDocument,
  nodeIds: string[],
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
  activePageId?: string | null,
): void {
  const nodes = nodeIds.map((id) => findNode(doc, id, activePageId)).filter(Boolean) as PenNode[];
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
    updateNodeInDoc(doc, node.id, { ...node, ...updates } as PenNode, activePageId);
  }
}

function reorderNodeInDoc(
  doc: PenDocument,
  operation: Extract<CanvasOperation, { type: 'reorderNode' }>,
  activePageId?: string | null,
): void {
  const node = findNode(doc, operation.nodeId, activePageId);
  if (!node) {
    throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} does not exist.`);
  }

  const currentParent = findParent(doc, operation.nodeId, activePageId);
  const targetParentId =
    operation.targetParentId !== undefined ? operation.targetParentId : currentParent?.id ?? null;
  const currentSiblings = getActiveSiblingList(doc, currentParent?.id ?? null, activePageId);
  const currentIndex = currentSiblings.findIndex((candidate) => candidate.id === operation.nodeId);
  if (currentIndex === -1) {
    throw new CanvasOperationError('node_not_found', `Node ${operation.nodeId} not found in tree.`);
  }

  let targetIndex = operation.targetIndex;
  if (targetIndex === undefined) {
    if (operation.direction === 'back') targetIndex = 0;
    if (operation.direction === 'backward') targetIndex = Math.max(0, currentIndex - 1);
    if (operation.direction === 'forward') targetIndex = Math.min(currentSiblings.length - 1, currentIndex + 1);
    if (operation.direction === 'front' || operation.direction === undefined) {
      targetIndex = currentSiblings.length - 1;
    }
  }

  removeNodeFromDoc(doc, operation.nodeId, activePageId);
  const targetSiblings = getActiveSiblingList(doc, targetParentId, activePageId);
  const insertIndex = Math.max(0, Math.min(targetIndex ?? targetSiblings.length, targetSiblings.length));
  insertNodeInDoc(doc, node, targetParentId, insertIndex, activePageId);
}

function getActiveSiblingList(
  doc: PenDocument,
  parentId: string | null,
  activePageId?: string | null,
): PenNode[] {
  if (parentId === null) return getActiveChildren(doc, activePageId);
  const parent = findNode(doc, parentId, activePageId);
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) {
    throw new CanvasOperationError('container_not_found', `Parent ${parentId} not found or not a container.`);
  }
  return parent.children as PenNode[];
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
  activePageId?: string | null,
  candidate?: PenNode,
): void {
  if (!agentId) return;
  if (!containerId) {
    throw new CanvasOperationError(
      'permission_denied',
      `Agent ${agentId} must be bound to a container before writing to the canvas.`,
    );
  }
  const container = findNode(doc, containerId, activePageId);
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
  if (candidate && !isBoundsInside(getNodeBounds(candidate), getNodeBounds(container))) {
    throw new CanvasOperationError(
      'bounds_violation',
      `Agent ${agentId} cannot write outside container ${containerId}.`,
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
