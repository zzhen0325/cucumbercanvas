import { TypedEventEmitter } from '@cucumber/pen-engine';
import type { ContainerManager } from '../container-manager.js';
import type { AgentBinding } from '../types.js';
import type { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { AgentCollabSession } from './agent-collab-session.js';
import type {
  AgentCollabMessage,
  AgentStatus,
  ContainerLock,
  OperationEntry,
  OrchestratorConfig,
} from './types.js';

let opIdCounter = 0;
function generateOpId(): string {
  return `op_${Date.now()}_${++opIdCounter}`;
}

export interface AgentOrchestratorEvents {
  'agent:start': (agentId: string, containerId: string) => void;
  'agent:complete': (agentId: string, containerId: string) => void;
  'agent:error': (agentId: string, containerId: string, error: Error) => void;
  'agent:throttled': (agentId: string) => void;
  'lock:acquired': (lock: ContainerLock) => void;
  'lock:released': (containerId: string, agentId: string) => void;
  'lock:conflict': (containerId: string, agentId: string, holderId: string) => void;
  'broadcast:output': (fromAgentId: string, toAgentIds: string[], portId: string) => void;
  'execution:batch': (nodeIds: string[]) => void;
}

export class AgentOrchestrator extends TypedEventEmitter<AgentOrchestratorEvents> {
  private containerManager: ContainerManager;
  private dataFlowEngine: DataFlowEngine;
  private config: OrchestratorConfig;
  private activeAgents = new Map<string, { containerId: string; startedAt: number }>();
  private waitQueue: Array<{ agentId: string; containerId: string; resolve: () => void }> = [];
  private locks = new Map<string, ContainerLock>();
  private operationLogs = new Map<string, OperationEntry[]>();
  private collabSession: AgentCollabSession;
  private versionMap = new Map<string, number>();
  private pendingBroadcasts: Array<{ fromAgentId: string; portId: string; payload: unknown }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    containerManager: ContainerManager,
    dataFlowEngine: DataFlowEngine,
    config?: Partial<OrchestratorConfig>
  ) {
    super();
    this.containerManager = containerManager;
    this.dataFlowEngine = dataFlowEngine;
    this.config = {
      maxConcurrentAgents: config?.maxConcurrentAgents ?? 5,
      executionTimeout: config?.executionTimeout ?? 30000,
      conflictStrategy: config?.conflictStrategy ?? 'optimistic-lock',
    };
    this.collabSession = new AgentCollabSession(containerManager);
  }

  get session(): AgentCollabSession {
    return this.collabSession;
  }

  get runningCount(): number {
    return this.activeAgents.size;
  }

  get maxConcurrent(): number {
    return this.config.maxConcurrentAgents;
  }

  setMaxConcurrent(n: number): void {
    this.config.maxConcurrentAgents = Math.max(1, n);
    this.processQueue();
  }

  async startAgent(agentId: string, containerId: string): Promise<boolean> {
    if (this.activeAgents.has(agentId)) return false;

    if (this.activeAgents.size >= this.config.maxConcurrentAgents) {
      this.emit('agent:throttled', agentId);
      await new Promise<void>(resolve => {
        this.waitQueue.push({ agentId, containerId, resolve });
      });
    }

    const lockAcquired = this.acquireLock(containerId, agentId);
    if (!lockAcquired) return false;

    this.activeAgents.set(agentId, { containerId, startedAt: Date.now() });
    this.containerManager.updateAgentStatus(containerId, 'running');
    this.collabSession.join(agentId);
    this.emit('agent:start', agentId, containerId);
    return true;
  }

  completeAgent(agentId: string): boolean {
    const entry = this.activeAgents.get(agentId);
    if (!entry) return false;

    this.activeAgents.delete(agentId);
    this.releaseLock(entry.containerId, agentId);
    this.containerManager.updateAgentStatus(entry.containerId, 'completed');
    this.emit('agent:complete', agentId, entry.containerId);
    this.processQueue();
    return true;
  }

  errorAgent(agentId: string, error: Error): boolean {
    const entry = this.activeAgents.get(agentId);
    if (!entry) return false;

    this.activeAgents.delete(agentId);
    this.releaseLock(entry.containerId, agentId);
    this.containerManager.updateAgentStatus(entry.containerId, 'error' as AgentBinding['status']);
    this.emit('agent:error', agentId, entry.containerId, error);
    this.processQueue();
    return true;
  }

  submitOperation(agentId: string, containerId: string, type: OperationEntry['type'], target: string, payload: unknown): OperationEntry | null {
    const lock = this.locks.get(containerId);
    if (!lock || lock.agentId !== agentId) {
      const holderId = lock?.agentId ?? 'none';
      this.emit('lock:conflict', containerId, agentId, holderId);
      if (lock) {
        this.collabSession.recordConflict(containerId, agentId, {
          id: generateOpId(),
          agentId,
          containerId,
          type,
          target,
          payload,
          timestamp: Date.now(),
          version: this.getVersion(containerId),
        });
      }
      return null;
    }

    const version = this.incrementVersion(containerId);
    const op: OperationEntry = {
      id: generateOpId(),
      agentId,
      containerId,
      type,
      target,
      payload,
      timestamp: Date.now(),
      version,
    };

    const log = this.operationLogs.get(containerId) ?? [];
    log.push(op);
    this.operationLogs.set(containerId, log);
    return op;
  }

  broadcastOutput(fromAgentId: string, portId: string, payload: unknown): void {
    this.pendingBroadcasts.push({ fromAgentId, portId, payload });
    this.scheduleBatchBroadcast();
  }

  getOperationLog(containerId: string): OperationEntry[] {
    return [...(this.operationLogs.get(containerId) ?? [])];
  }

  getActiveAgents(): Array<{ agentId: string; containerId: string; startedAt: number }> {
    return [...this.activeAgents.entries()].map(([agentId, info]) => ({
      agentId,
      ...info,
    }));
  }

  isAgentActive(agentId: string): boolean {
    return this.activeAgents.has(agentId);
  }

  getLock(containerId: string): ContainerLock | undefined {
    return this.locks.get(containerId);
  }

  dispose(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.activeAgents.clear();
    this.waitQueue = [];
    this.locks.clear();
    this.collabSession.complete();
    super.dispose();
  }

  private acquireLock(containerId: string, agentId: string): boolean {
    const existing = this.locks.get(containerId);
    if (existing && existing.agentId !== agentId) {
      this.emit('lock:conflict', containerId, agentId, existing.agentId);
      return false;
    }

    const lock: ContainerLock = {
      containerId,
      agentId,
      version: this.getVersion(containerId),
      acquiredAt: Date.now(),
    };
    this.locks.set(containerId, lock);
    this.emit('lock:acquired', lock);
    return true;
  }

  private releaseLock(containerId: string, agentId: string): void {
    const lock = this.locks.get(containerId);
    if (lock && lock.agentId === agentId) {
      this.locks.delete(containerId);
      this.emit('lock:released', containerId, agentId);
    }
  }

  private getVersion(containerId: string): number {
    return this.versionMap.get(containerId) ?? 0;
  }

  private incrementVersion(containerId: string): number {
    const v = this.getVersion(containerId) + 1;
    this.versionMap.set(containerId, v);
    return v;
  }

  private processQueue(): void {
    while (this.waitQueue.length > 0 && this.activeAgents.size < this.config.maxConcurrentAgents) {
      const next = this.waitQueue.shift();
      if (next) next.resolve();
    }
  }

  private scheduleBatchBroadcast(): void {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.flushBroadcasts();
      this.batchTimer = null;
    }, 16);
  }

  private flushBroadcasts(): void {
    const batched = [...this.pendingBroadcasts];
    this.pendingBroadcasts = [];

    for (const { fromAgentId, portId, payload } of batched) {
      const fromContainer = this.containerManager.getContainersByAgent(fromAgentId)[0];
      if (!fromContainer) continue;

      const edges = this.dataFlowEngine.getAllEdges().filter(
        e => e.source.nodeId === fromContainer.id && e.source.portId === portId
      );

      const targetAgentIds: string[] = [];
      for (const edge of edges) {
        const targetContainer = this.containerManager.getContainer(edge.target.nodeId);
        if (targetContainer?.agentBinding?.agentId) {
          targetAgentIds.push(targetContainer.agentBinding.agentId);
          this.collabSession.broadcast(fromAgentId, `output:${portId}`, payload);
        }
      }

      if (targetAgentIds.length > 0) {
        this.emit('broadcast:output', fromAgentId, targetAgentIds, portId);
      }
    }
  }
}
