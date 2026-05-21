import { TypedEventEmitter } from '@cucumber/engine';
import type { ContainerNode, ContainerBounds, ContainerRole, ContextSlots } from './types.js';
import { resolveContext } from './context-resolver.js';

let containerIdCounter = 0;
function generateContainerId(): string {
  return `container_${Date.now()}_${++containerIdCounter}`;
}

export interface ContainerManagerEvents {
  'container:add': (node: ContainerNode) => void;
  'container:remove': (id: string) => void;
  'container:update': (node: ContainerNode) => void;
  'container:move': (id: string, newParentId: string | null) => void;
}

export interface CreateContainerOptions {
  id?: string;
  parentId?: string | null;
  role?: ContainerRole[];
  bounds: ContainerBounds;
  label?: string;
  fill?: string;
  stroke?: string;
}

export class ContainerManager extends TypedEventEmitter<ContainerManagerEvents> {
  private containers = new Map<string, ContainerNode>();
  private contextCache = new Map<string, ContextSlots>();

  getContainer(id: string): ContainerNode | undefined {
    return this.containers.get(id);
  }

  getAllContainers(): ContainerNode[] {
    return [...this.containers.values()];
  }

  getRootContainers(): ContainerNode[] {
    return [...this.containers.values()].filter(c => c.parentId === null);
  }

  getChildren(parentId: string): ContainerNode[] {
    return [...this.containers.values()].filter(c => c.parentId === parentId);
  }

  createContainer(options: CreateContainerOptions): ContainerNode {
    const node: ContainerNode = {
      id: options.id ?? generateContainerId(),
      type: 'container',
      parentId: options.parentId ?? null,
      role: options.role ?? ['visual'],
      bounds: options.bounds,
      contextSlots: {},
      inheritPolicy: 'merge',
      ioPorts: [],
      style: {
        fill: options.fill ?? '#ffffff0d',
        stroke: options.stroke ?? '#666666',
        opacity: 1,
        label: options.label ?? 'Container',
      },
    };

    this.containers.set(node.id, node);
    this.invalidateContextCache(node.id);
    this.emit('container:add', node);
    return node;
  }

  removeContainer(id: string): boolean {
    const container = this.containers.get(id);
    if (!container) return false;

    const children = this.getChildren(id);
    for (const child of children) {
      child.parentId = container.parentId;
      this.containers.set(child.id, child);
    }

    this.containers.delete(id);
    this.invalidateContextCache(id);
    this.emit('container:remove', id);
    return true;
  }

  updateContainer(id: string, updates: Partial<ContainerNode>): boolean {
    const container = this.containers.get(id);
    if (!container) return false;

    const updated = { ...container, ...updates, id: container.id, type: 'container' as const };
    this.containers.set(id, updated);
    this.invalidateContextCache(id);
    this.emit('container:update', updated);
    return true;
  }

  moveContainer(id: string, newParentId: string | null): boolean {
    const container = this.containers.get(id);
    if (!container) return false;
    if (newParentId === id) return false;

    if (newParentId && this.isDescendant(newParentId, id)) {
      return false;
    }

    container.parentId = newParentId;
    this.containers.set(id, container);
    this.invalidateContextCache(id);
    this.emit('container:move', id, newParentId);
    return true;
  }

  updateBounds(id: string, bounds: Partial<ContainerBounds>): boolean {
    const container = this.containers.get(id);
    if (!container) return false;
    container.bounds = { ...container.bounds, ...bounds };
    this.containers.set(id, container);
    this.emit('container:update', container);
    return true;
  }

  resolveContext(containerId: string): ContextSlots {
    const cached = this.contextCache.get(containerId);
    if (cached) return cached;

    const result = resolveContext(containerId, this.containers);
    this.contextCache.set(containerId, result);
    return result;
  }

  getContainerPath(containerId: string): string[] {
    const path: string[] = [];
    let cur = this.containers.get(containerId);
    while (cur) {
      path.unshift(cur.id);
      cur = cur.parentId ? this.containers.get(cur.parentId) : undefined;
    }
    return path;
  }

  loadContainers(containers: ContainerNode[]): void {
    this.containers.clear();
    this.contextCache.clear();
    for (const c of containers) {
      this.containers.set(c.id, c);
    }
  }

  serialize(): ContainerNode[] {
    return [...this.containers.values()];
  }

  private isDescendant(potentialDescendant: string, ancestorId: string): boolean {
    let cur = this.containers.get(potentialDescendant);
    while (cur) {
      if (cur.parentId === ancestorId) return true;
      cur = cur.parentId ? this.containers.get(cur.parentId) : undefined;
    }
    return false;
  }

  private invalidateContextCache(containerId: string): void {
    this.contextCache.delete(containerId);
    for (const container of this.containers.values()) {
      if (this.isDescendant(container.id, containerId)) {
        this.contextCache.delete(container.id);
      }
    }
  }
}
