import { TypedEventEmitter } from '@cucumber/pen-engine';
import type { DataFlowEngine } from '../dataflow/dataflow-engine.js';

export interface BatchExecutorEvents {
  'batch:start': (nodeIds: string[]) => void;
  'batch:complete': (nodeIds: string[], duration: number) => void;
  'batch:error': (nodeIds: string[], error: Error) => void;
}

export interface BatchExecutorConfig {
  batchWindow: number;
  maxBatchSize: number;
}

export class DataFlowBatchExecutor extends TypedEventEmitter<BatchExecutorEvents> {
  private dataFlowEngine: DataFlowEngine;
  private config: BatchExecutorConfig;
  private pendingNodes = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private executing = false;

  constructor(dataFlowEngine: DataFlowEngine, config?: Partial<BatchExecutorConfig>) {
    super();
    this.dataFlowEngine = dataFlowEngine;
    this.config = {
      batchWindow: config?.batchWindow ?? 16,
      maxBatchSize: config?.maxBatchSize ?? 20,
    };
  }

  schedule(nodeId: string): void {
    this.pendingNodes.add(nodeId);

    if (this.pendingNodes.size >= this.config.maxBatchSize) {
      this.executeBatch();
      return;
    }

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.executeBatch();
      }, this.config.batchWindow);
    }
  }

  scheduleMultiple(nodeIds: string[]): void {
    for (const id of nodeIds) {
      this.pendingNodes.add(id);
    }
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.executeBatch();
      }, this.config.batchWindow);
    }
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.executeBatch();
  }

  get pendingCount(): number {
    return this.pendingNodes.size;
  }

  get isExecuting(): boolean {
    return this.executing;
  }

  dispose(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingNodes.clear();
    super.dispose();
  }

  private async executeBatch(): Promise<void> {
    if (this.executing || this.pendingNodes.size === 0) return;

    this.executing = true;
    const nodeIds = [...this.pendingNodes];
    this.pendingNodes.clear();

    const startTime = performance.now();
    this.emit('batch:start', nodeIds);

    try {
      const sorted = this.topologicalOrder(nodeIds);
      for (const nodeId of sorted) {
        this.dataFlowEngine.invalidateCache(nodeId);
      }
      for (const nodeId of sorted) {
        await this.dataFlowEngine.pull(nodeId);
      }
      const duration = performance.now() - startTime;
      this.emit('batch:complete', nodeIds, duration);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('batch:error', nodeIds, error);
    } finally {
      this.executing = false;
      if (this.pendingNodes.size > 0) {
        this.executeBatch();
      }
    }
  }

  private topologicalOrder(nodeIds: string[]): string[] {
    try {
      const fullOrder = this.dataFlowEngine.topoSort();
      const set = new Set(nodeIds);
      const ordered = fullOrder.filter(id => set.has(id));
      for (const id of nodeIds) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      return ordered;
    } catch {
      return nodeIds;
    }
  }
}
