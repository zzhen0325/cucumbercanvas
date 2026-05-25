import type {
  PenDocument,
  PenNode,
  FrameNode,
  GroupNode,
  ContainerRole,
  ContextSlots,
  AgentBinding,
  InheritPolicy,
} from '@cucumber/pen-types';
import { TypedEventEmitter } from '@cucumber/pen-engine';
import {
  findNodeInTree,
  findParentInTree,
  insertNodeInTree,
  removeNodeFromTree,
  flattenNodes,
  generateId,
} from '@cucumber/pen-core';
import { resolveContext, getContainerPath } from './context-resolver.js';

export interface ContainerManagerEvents {
  'container:add': (node: PenNode) => void;
  'container:remove': (id: string) => void;
  'container:update': (node: PenNode) => void;
  'container:move': (id: string, newParentId: string | null) => void;
  'agent:bound': (containerId: string, binding: AgentBinding) => void;
  'agent:unbound': (containerId: string, agentId: string) => void;
  'agent:status': (containerId: string, agentId: string, status: AgentBinding['status']) => void;
  'context:change': (containerId: string, slots: ContextSlots) => void;
}

export interface CreateContainerOptions {
  id?: string;
  parentId?: string | null;
  role?: ContainerRole[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  fill?: string;
  fills?: PenNode extends { fills?: infer F } ? F : never;
  stroke?: PenNode extends { stroke?: infer S } ? S : never;
  opacity?: number;
}

export type DocAccessor = () => PenDocument;

export class ContainerManager extends TypedEventEmitter<ContainerManagerEvents> {
  private getDoc: DocAccessor;
  private contextCache = new Map<string, ContextSlots>();

  constructor(getDoc: DocAccessor) {
    super();
    this.getDoc = getDoc;
  }

  /** Find a node by ID in the current document */
  getContainer(id: string): PenNode | undefined {
    const doc = this.getDoc();
    return findNodeInTree(doc.pages?.[0]?.children ?? doc.children, id);
  }

  getAllContainers(): PenNode[] {
    const doc = this.getDoc();
    return flattenNodes(doc.pages?.[0]?.children ?? doc.children).filter(
      (n) => n.type === 'frame' || n.type === 'group',
    );
  }

  getRootContainers(): PenNode[] {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    return children.filter((n) => n.type === 'frame' || n.type === 'group');
  }

  getChildren(parentId: string): PenNode[] {
    const parent = this.getContainer(parentId);
    if (!parent || !('children' in parent) || !Array.isArray(parent.children)) return [];
    return (parent.children as PenNode[]).filter(
      (n) => n.type === 'frame' || n.type === 'group',
    );
  }

  createContainer(options: CreateContainerOptions): PenNode {
    const doc = this.getDoc();
    const node: FrameNode = {
      id: options.id ?? generateId(),
      type: 'frame',
      name: options.label ?? 'Container',
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 400,
      height: options.height ?? 300,
      containerRole: options.role ?? ['visual'],
      contextSlots: {},
      inheritPolicy: 'merge',
      ioPorts: [],
      fill: options.fills ?? (options.fill ? [{ type: 'solid', color: options.fill }] : [{ type: 'solid', color: '#ffffff0d' }]),
      stroke: (options.stroke as FrameNode['stroke']) ?? { thickness: 2, fill: [{ type: 'solid', color: '#666666' }] },
      opacity: options.opacity ?? 1,
    };

    const parentId = options.parentId ?? null;
    const children = doc.pages?.[0]?.children ?? doc.children;
    const newChildren = parentId
      ? insertNodeInTree(children, parentId, node)
      : [...children, node];

    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(node.id);
    this.emit('container:add', node);
    return node;
  }

  removeContainer(id: string): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const node = findNodeInTree(children, id);
    if (!node) return false;

    const newChildren = removeNodeFromTree(children, id);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(id);
    this.emit('container:remove', id);
    return true;
  }

  updateContainer(id: string, updates: Partial<PenNode>): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, id);
    if (!existing) return false;

    const updated = { ...existing, ...updates, id: existing.id, type: existing.type } as PenNode;
    // updateNodeInTree from pen-core handles immutable tree updates
    const newChildren = updateNodeInList(children, id, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(id);
    this.emit('container:update', updated);
    return true;
  }

  moveContainer(id: string, newParentId: string | null): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const node = findNodeInTree(children, id);
    if (!node || newParentId === id) return false;

    if (newParentId) {
      const isDesc = isDescendantOf(children, newParentId, id);
      if (isDesc) return false;
    }

    const without = removeNodeFromTree(children, id);
    const newChildren = newParentId
      ? insertNodeInTree(without, newParentId, node)
      : [...without, node];

    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(id);
    this.emit('container:move', id, newParentId);
    return true;
  }

  resolveContext(containerId: string): ContextSlots {
    const cached = this.contextCache.get(containerId);
    if (cached) return cached;

    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const result = resolveContext(containerId, children);
    this.contextCache.set(containerId, result);
    return result;
  }

  getContainerPath(containerId: string): string[] {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    return getContainerPath(containerId, children);
  }

  bindAgent(containerId: string, binding: AgentBinding): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, containerId);
    if (!existing) return false;

    const updated = {
      ...existing,
      agentBinding: { ...binding, assignedAt: binding.assignedAt ?? Date.now() },
    } as PenNode;
    const newChildren = updateNodeInList(children, containerId, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.emit('agent:bound', containerId, updated.agentBinding!);
    this.emit('container:update', updated);
    return true;
  }

  unbindAgent(containerId: string): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, containerId);
    if (!existing || !existing.agentBinding?.agentId) return false;

    const agentId = existing.agentBinding.agentId;
    const updated = { ...existing, agentBinding: undefined } as PenNode;
    const newChildren = updateNodeInList(children, containerId, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.emit('agent:unbound', containerId, agentId);
    this.emit('container:update', updated);
    return true;
  }

  updateAgentStatus(containerId: string, status: AgentBinding['status']): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, containerId);
    if (!existing || !existing.agentBinding) return false;

    const updated = {
      ...existing,
      agentBinding: { ...existing.agentBinding, status },
    } as PenNode;
    const newChildren = updateNodeInList(children, containerId, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.emit('agent:status', containerId, existing.agentBinding.agentId!, status);
    this.emit('container:update', updated);
    return true;
  }

  updateContextSlots(containerId: string, slots: Partial<ContextSlots>): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, containerId);
    if (!existing) return false;

    const currentSlots = existing.contextSlots ?? {};
    const mergedSlots: ContextSlots = {
      style: { ...(currentSlots.style ?? {}), ...(slots.style ?? {}) },
      tokens: { ...(currentSlots.tokens ?? {}), ...(slots.tokens ?? {}) },
      rules: slots.rules !== undefined ? slots.rules : currentSlots.rules,
      constraints: { ...(currentSlots.constraints ?? {}), ...(slots.constraints ?? {}) },
    };

    const updated = { ...existing, contextSlots: mergedSlots } as PenNode;
    const newChildren = updateNodeInList(children, containerId, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(containerId);
    this.emit('context:change', containerId, mergedSlots);
    this.emit('container:update', updated);
    return true;
  }

  setInheritPolicy(containerId: string, policy: InheritPolicy): boolean {
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    const existing = findNodeInTree(children, containerId);
    if (!existing) return false;

    const updated = { ...existing, inheritPolicy: policy } as PenNode;
    const newChildren = updateNodeInList(children, containerId, updated);
    if (doc.pages?.[0]) {
      doc.pages[0].children = newChildren;
    } else {
      doc.children = newChildren;
    }

    this.invalidateContextCache(containerId);
    this.emit('container:update', updated);
    return true;
  }

  getContainersByAgent(agentId: string): PenNode[] {
    const doc = this.getDoc();
    return flattenNodes(doc.pages?.[0]?.children ?? doc.children).filter(
      (n) => n.agentBinding?.agentId === agentId,
    );
  }

  private invalidateContextCache(containerId: string): void {
    this.contextCache.delete(containerId);
    // Invalidate all descendants too
    const doc = this.getDoc();
    const children = doc.pages?.[0]?.children ?? doc.children;
    for (const [id] of this.contextCache) {
      if (isDescendantOf(children, id, containerId)) {
        this.contextCache.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tree mutation helpers (mutable for in-place doc updates)
// ---------------------------------------------------------------------------

function updateNodeInList(nodes: PenNode[], nodeId: string, updated: PenNode): PenNode[] {
  return nodes.map((n) => {
    if (n.id === nodeId) return updated;
    if ('children' in n && Array.isArray(n.children)) {
      return { ...n, children: updateNodeInList(n.children as PenNode[], nodeId, updated) } as PenNode;
    }
    return n;
  });
}

function isDescendantOf(nodes: PenNode[], nodeId: string, ancestorId: string): boolean {
  const parent = findParentInTree(nodes, nodeId);
  if (!parent) return false;
  if (parent.id === ancestorId) return true;
  return isDescendantOf(nodes, parent.id, ancestorId);
}
