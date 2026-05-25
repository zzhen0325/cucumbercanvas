import type { ContainerManager } from './container-manager.js';
import type { PenNode as ContainerNode } from '@cucumber/pen-types';
import type { AgentContext, AgentMessage, ContainerEvents, NodeSummary, PeerRequest, PeerResponse } from './agent-context.js';
import { TypedEventEmitter } from '@cucumber/pen-engine';

export class AgentContextBuilder {
  private containerManager: ContainerManager;
  private eventBus: TypedEventEmitter<ContainerEvents>;
  private nodeIndex: Map<string, NodeSummary>;

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;
    this.eventBus = new TypedEventEmitter();
    this.nodeIndex = new Map();
  }

  registerNode(summary: NodeSummary): void {
    this.nodeIndex.set(summary.id, summary);
  }

  unregisterNode(id: string): void {
    this.nodeIndex.delete(id);
  }

  updateNodeIndex(nodes: NodeSummary[]): void {
    this.nodeIndex.clear();
    for (const n of nodes) {
      this.nodeIndex.set(n.id, n);
    }
  }

  build(agentId: string, containerId: string): AgentContext | null {
    const container = this.containerManager.getContainer(containerId);
    if (!container) return null;

    const containerPath = this.containerManager.getContainerPath(containerId);
    const parent = container.parentId
      ? this.containerManager.getContainer(container.parentId) ?? null
      : null;

    const siblings = this.getSiblings(container);
    const effectiveContext = this.containerManager.resolveContext(containerId);
    const visibleNodes = this.getVisibleNodes(container);
    const permissions = container.agentBinding?.permissions ?? ['read'];

    const canOperate = (nodeId: string): boolean => {
      return this.checkPermission(agentId, containerId, nodeId);
    };

    const subscribe = <K extends keyof ContainerEvents>(
      event: K,
      cb: ContainerEvents[K]
    ): (() => void) => {
      return this.eventBus.on(event, cb);
    };

    const broadcast = (message: AgentMessage): void => {
      this.eventBus.emit('content:change', visibleNodes);
    };

    const requestFromPeer = async (targetAgentId: string, req: PeerRequest): Promise<PeerResponse> => {
      return { ok: false, payload: { error: 'P2P not yet implemented (P2 scope)' } };
    };

    return {
      agentId,
      containerId,
      containerPath,
      parent,
      siblings,
      effectiveContext,
      visibleNodes,
      ioPorts: container.ioPorts,
      permissions,
      canOperate,
      subscribe,
      broadcast,
      requestFromPeer,
    };
  }

  private getSiblings(container: ContainerNode): { containerId: string; agentId?: string; status?: string }[] {
    if (!container.parentId) {
      return this.containerManager.getRootContainers()
        .filter(c => c.id !== container.id)
        .map(c => ({
          containerId: c.id,
          agentId: c.agentBinding?.agentId,
          status: c.agentBinding?.status,
        }));
    }

    return this.containerManager.getChildren(container.parentId)
      .filter(c => c.id !== container.id)
      .map(c => ({
        containerId: c.id,
        agentId: c.agentBinding?.agentId,
        status: c.agentBinding?.status,
      }));
  }

  private getVisibleNodes(container: ContainerNode): NodeSummary[] {
    const results: NodeSummary[] = [];
    const bounds = container.bounds;

    for (const node of this.nodeIndex.values()) {
      if (!node.bounds) {
        results.push(node);
        continue;
      }
      if (
        node.bounds.x >= bounds.x &&
        node.bounds.y >= bounds.y &&
        node.bounds.x + node.bounds.width <= bounds.x + bounds.width &&
        node.bounds.y + node.bounds.height <= bounds.y + bounds.height
      ) {
        results.push(node);
      }
    }
    return results;
  }

  private checkPermission(agentId: string, containerId: string, nodeId: string): boolean {
    const container = this.containerManager.getContainer(containerId);
    if (!container) return false;

    if (container.permissions) {
      if (container.permissions.isolationLevel === 'strict') {
        return container.permissions.canWrite.includes(agentId) ||
               container.permissions.owner === agentId;
      }
      if (container.permissions.isolationLevel === 'collaborative') {
        return container.permissions.canWrite.includes(agentId) ||
               container.permissions.owner === agentId;
      }
    }

    if (container.agentBinding?.agentId === agentId) {
      const perms = container.agentBinding.permissions ?? ['read'];
      return perms.includes('write');
    }

    return container.permissions?.isolationLevel === 'open';
  }

  emitContainerEvent<K extends keyof ContainerEvents>(event: K, ...args: Parameters<ContainerEvents[K]>): void {
    this.eventBus.emit(event, ...args);
  }
}
