import { TypedEventEmitter } from '@cucumber/pen-engine';

export interface ThrottlerConfig {
  maxConcurrent: number;
  timeout: number;
}

export interface AgentThrottlerEvents {
  'throttle:queued': (agentId: string, queuePosition: number) => void;
  'throttle:released': (agentId: string) => void;
  'throttle:timeout': (agentId: string) => void;
  'throttle:config': (config: ThrottlerConfig) => void;
}

interface QueueEntry {
  agentId: string;
  resolve: () => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentThrottler extends TypedEventEmitter<AgentThrottlerEvents> {
  private config: ThrottlerConfig;
  private running = new Set<string>();
  private queue: QueueEntry[] = [];

  constructor(config?: Partial<ThrottlerConfig>) {
    super();
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? 5,
      timeout: config?.timeout ?? 30000,
    };
  }

  get activeCount(): number {
    return this.running.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get maxConcurrent(): number {
    return this.config.maxConcurrent;
  }

  setMaxConcurrent(n: number): void {
    this.config.maxConcurrent = Math.max(1, n);
    this.emit('throttle:config', { ...this.config });
    this.processQueue();
  }

  async acquire(agentId: string): Promise<void> {
    if (this.running.has(agentId)) return;

    if (this.running.size < this.config.maxConcurrent) {
      this.running.add(agentId);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.agentId === agentId);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.emit('throttle:timeout', agentId);
        reject(new Error(`Agent ${agentId} timed out waiting for execution slot`));
      }, this.config.timeout);

      this.queue.push({ agentId, resolve, reject, timer });
      this.emit('throttle:queued', agentId, this.queue.length);
    });
  }

  release(agentId: string): void {
    if (!this.running.has(agentId)) return;
    this.running.delete(agentId);
    this.emit('throttle:released', agentId);
    this.processQueue();
  }

  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }

  isQueued(agentId: string): boolean {
    return this.queue.some(e => e.agentId === agentId);
  }

  cancel(agentId: string): boolean {
    const idx = this.queue.findIndex(e => e.agentId === agentId);
    if (idx === -1) return false;
    const entry = this.queue[idx]!;
    clearTimeout(entry.timer);
    entry.reject(new Error('Cancelled'));
    this.queue.splice(idx, 1);
    return true;
  }

  dispose(): void {
    for (const entry of this.queue) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Throttler disposed'));
    }
    this.queue = [];
    this.running.clear();
    super.dispose();
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.running.size < this.config.maxConcurrent) {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      this.running.add(next.agentId);
      next.resolve();
    }
  }
}
