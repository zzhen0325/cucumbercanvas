import { TypedEventEmitter } from '@cucumber/engine';
import type { IOPort } from '../types.js';
import type { ContainerManager } from '../container-manager.js';
import type { DataFlowEdge, PortPayload, NodeExecutor, ResolvedContext } from './types.js';
import { isPortCompatible } from './types.js';

export interface DataFlowEngineEvents {
  'edge:add': (edge: DataFlowEdge) => void;
  'edge:remove': (id: string) => void;
  'edge:status': (id: string, status: DataFlowEdge['status']) => void;
  'node:execute:start': (nodeId: string) => void;
  'node:execute:complete': (nodeId: string) => void;
  'node:execute:error': (nodeId: string, error: Error) => void;
  'cycle:detected': (nodeIds: string[]) => void;
}

export class DataFlowEngine extends TypedEventEmitter<DataFlowEngineEvents> {
  private edges = new Map<string, DataFlowEdge>();
  private executors = new Map<string, NodeExecutor>();
  private cache = new Map<string, Map<string, PortPayload>>();
  private executing = new Set<string>();
  private containerManager: ContainerManager;

  constructor(containerManager: ContainerManager) {
    super();
    this.containerManager = containerManager;
  }

  addEdge(edge: Omit<DataFlowEdge, 'status'>): DataFlowEdge | null {
    const sourceNode = this.containerManager.getContainer(edge.source.nodeId);
    const targetNode = this.containerManager.getContainer(edge.target.nodeId);
    if (!sourceNode || !targetNode) return null;

    const sourcePort = sourceNode.ioPorts.find(p => p.id === edge.source.portId);
    const targetPort = targetNode.ioPorts.find(p => p.id === edge.target.portId);
    if (!sourcePort || !targetPort) return null;
    if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') return null;
    if (!isPortCompatible(sourcePort.dataType, targetPort.dataType)) return null;

    const fullEdge: DataFlowEdge = { ...edge, status: 'idle' };

    if (this.wouldCreateCycle(fullEdge)) {
      const cycle = this.detectCyclePath(fullEdge);
      this.emit('cycle:detected', cycle);
      return null;
    }

    this.edges.set(fullEdge.id, fullEdge);
    this.invalidateDownstream(edge.target.nodeId);
    this.emit('edge:add', fullEdge);
    return fullEdge;
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.edges.delete(id);
    this.invalidateDownstream(edge.target.nodeId);
    this.emit('edge:remove', id);
    return true;
  }

  getEdge(id: string): DataFlowEdge | undefined {
    return this.edges.get(id);
  }

  getAllEdges(): DataFlowEdge[] {
    return [...this.edges.values()];
  }

  getEdgesForNode(nodeId: string): { inputs: DataFlowEdge[]; outputs: DataFlowEdge[] } {
    const inputs: DataFlowEdge[] = [];
    const outputs: DataFlowEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.target.nodeId === nodeId) inputs.push(edge);
      if (edge.source.nodeId === nodeId) outputs.push(edge);
    }
    return { inputs, outputs };
  }

  register(nodeId: string, executor: NodeExecutor): void {
    this.executors.set(nodeId, executor);
  }

  unregister(nodeId: string): void {
    this.executors.delete(nodeId);
  }

  async pull(nodeId: string): Promise<Record<string, PortPayload>> {
    if (this.executing.has(nodeId)) {
      throw new Error(`Circular execution detected at node: ${nodeId}`);
    }

    const cached = this.cache.get(nodeId);
    if (cached) return Object.fromEntries(cached);

    this.executing.add(nodeId);
    this.emit('node:execute:start', nodeId);

    try {
      const { inputs: inEdges } = this.getEdgesForNode(nodeId);
      const inputPayloads: Record<string, PortPayload> = {};

      for (const edge of inEdges) {
        this.setEdgeStatus(edge.id, 'flowing');
        const upstreamOutputs = await this.pull(edge.source.nodeId);
        const payload = upstreamOutputs[edge.source.portId];
        if (payload) {
          inputPayloads[edge.target.portId] = payload;
        }
        this.setEdgeStatus(edge.id, 'idle');
      }

      const executor = this.executors.get(nodeId);
      const outputPayloads = new Map<string, PortPayload>();

      if (executor) {
        const ctx = this.buildResolvedContext(nodeId);
        await executor(
          inputPayloads,
          ctx,
          (portId, payload) => outputPayloads.set(portId, payload)
        );
      } else {
        for (const [portId, payload] of Object.entries(inputPayloads)) {
          outputPayloads.set(portId, payload);
        }
      }

      this.cache.set(nodeId, outputPayloads);
      this.emit('node:execute:complete', nodeId);
      return Object.fromEntries(outputPayloads);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('node:execute:error', nodeId, error);

      for (const edge of this.getEdgesForNode(nodeId).inputs) {
        this.setEdgeStatus(edge.id, 'error');
      }
      throw error;
    } finally {
      this.executing.delete(nodeId);
    }
  }

  async run(nodeId: string): Promise<void> {
    this.invalidateDownstream(nodeId);
    await this.pull(nodeId);
  }

  topoSort(rootId?: string): string[] {
    const visited = new Set<string>();
    const sorted: string[] = [];
    const visiting = new Set<string>();

    const nodeIds = rootId
      ? this.getReachableNodes(rootId)
      : this.getAllNodeIds();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cycle detected involving node: ${id}`);
      }

      visiting.add(id);
      const { inputs } = this.getEdgesForNode(id);
      for (const edge of inputs) {
        visit(edge.source.nodeId);
      }
      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const id of nodeIds) {
      visit(id);
    }

    return sorted;
  }

  invalidateCache(nodeId: string): void {
    this.cache.delete(nodeId);
    this.invalidateDownstream(nodeId);
  }

  clearAllCaches(): void {
    this.cache.clear();
  }

  loadEdges(edges: DataFlowEdge[]): void {
    this.edges.clear();
    for (const edge of edges) {
      this.edges.set(edge.id, edge);
    }
  }

  serialize(): DataFlowEdge[] {
    return [...this.edges.values()];
  }

  private setEdgeStatus(edgeId: string, status: DataFlowEdge['status']): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    edge.status = status;
    this.emit('edge:status', edgeId, status);
  }

  private invalidateDownstream(nodeId: string): void {
    this.cache.delete(nodeId);
    const { outputs } = this.getEdgesForNode(nodeId);
    for (const edge of outputs) {
      this.invalidateDownstream(edge.target.nodeId);
    }
  }

  private wouldCreateCycle(newEdge: DataFlowEdge): boolean {
    const visited = new Set<string>();
    const queue = [newEdge.source.nodeId];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (current === newEdge.target.nodeId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.edges.values()) {
        if (edge.target.nodeId === current) {
          queue.push(edge.source.nodeId);
        }
      }
    }
    return false;
  }

  private detectCyclePath(newEdge: DataFlowEdge): string[] {
    const path: string[] = [newEdge.target.nodeId];
    const visited = new Set<string>();
    let current = newEdge.source.nodeId;

    while (current && !visited.has(current)) {
      path.push(current);
      visited.add(current);
      if (current === newEdge.target.nodeId) break;

      const inEdges = [...this.edges.values()].filter(e => e.target.nodeId === current);
      current = inEdges[0]?.source.nodeId ?? '';
    }

    return path;
  }

  private getReachableNodes(rootId: string): string[] {
    const reachable = new Set<string>();
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      for (const edge of this.edges.values()) {
        if (edge.source.nodeId === current) queue.push(edge.target.nodeId);
        if (edge.target.nodeId === current) queue.push(edge.source.nodeId);
      }
    }

    return [...reachable];
  }

  private getAllNodeIds(): string[] {
    const ids = new Set<string>();
    for (const edge of this.edges.values()) {
      ids.add(edge.source.nodeId);
      ids.add(edge.target.nodeId);
    }
    return [...ids];
  }

  private buildResolvedContext(nodeId: string): ResolvedContext {
    const container = this.containerManager.getContainer(nodeId);
    if (!container) {
      return { containerId: nodeId, containerPath: [nodeId] };
    }

    const resolvedSlots = this.containerManager.resolveContext(nodeId);
    const containerPath = this.containerManager.getContainerPath(nodeId);

    return {
      ...resolvedSlots,
      containerId: nodeId,
      containerPath,
    };
  }
}
