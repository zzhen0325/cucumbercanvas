import { type StreamEvent, streamEventSchema } from "@cucumber/shared";

type BufferedEvent = {
  event: StreamEvent;
  timestamp: number;
  seq: number;
};

type CanvasSubscriber = (entry: BufferedEvent) => void;

/**
 * Per-canvas stream buffer for recent StreamEvents.
 *
 * Transport-agnostic: used by SSE replay/reconnect today, and can support any
 * future streaming transport that needs cursor-based resumption.
 */
export class CanvasEventBuffer {
  private buffers = new Map<string, BufferedEvent[]>();
  private seqCounters = new Map<string, number>();
  private subscribers = new Map<string, Set<CanvasSubscriber>>();
  private activeRuns = new Map<string, { runId: string; startedAt: number }>();
  private readonly maxPerCanvas: number;
  private readonly ttlMs: number;
  private lastWrite = new Map<string, number>();

  constructor(options?: { maxPerCanvas?: number; ttlMs?: number }) {
    this.maxPerCanvas = options?.maxPerCanvas ?? 5000;
    this.ttlMs = options?.ttlMs ?? 10 * 60 * 1000;
  }

  publish(canvasId: string, event: StreamEvent): BufferedEvent {
    const parsedEvent = streamEventSchema.parse(event);
    let buf = this.buffers.get(canvasId);
    if (!buf) {
      buf = [];
      this.buffers.set(canvasId, buf);
      this.seqCounters.set(canvasId, 0);
    }

    const seq = (this.seqCounters.get(canvasId) ?? 0) + 1;
    this.seqCounters.set(canvasId, seq);

    const entry: BufferedEvent = {
      event: parsedEvent,
      timestamp: Date.now(),
      seq,
    };

    buf.push(entry);
    if (buf.length > this.maxPerCanvas) {
      buf.splice(0, buf.length - this.maxPerCanvas);
    }

    this.lastWrite.set(canvasId, entry.timestamp);

    const subscribers = this.subscribers.get(canvasId);
    if (subscribers) {
      for (const subscriber of subscribers) {
        subscriber(entry);
      }
    }

    return entry;
  }

  push(canvasId: string, event: StreamEvent): void {
    this.publish(canvasId, event);
  }

  subscribe(canvasId: string, subscriber: CanvasSubscriber): () => void {
    let subscribers = this.subscribers.get(canvasId);
    if (!subscribers) {
      subscribers = new Set();
      this.subscribers.set(canvasId, subscribers);
    }
    subscribers.add(subscriber);

    return () => {
      const current = this.subscribers.get(canvasId);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(canvasId);
      }
    };
  }

  getAfter(canvasId: string, afterSeq?: number): BufferedEvent[] {
    const buf = this.buffers.get(canvasId);
    if (!buf || buf.length === 0) return [];
    if (!afterSeq) return [...buf];
    return buf.filter((e) => e.seq > afterSeq);
  }

  getLatestSeq(canvasId: string): number {
    return this.seqCounters.get(canvasId) ?? 0;
  }

  setActiveRun(canvasId: string, runId: string): void {
    this.activeRuns.set(canvasId, { runId, startedAt: Date.now() });
  }

  clearActiveRun(canvasId: string): void {
    this.activeRuns.delete(canvasId);
  }

  getActiveRun(canvasId: string): { runId: string; startedAt: number } | null {
    return this.activeRuns.get(canvasId) ?? null;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [canvasId, lastTime] of this.lastWrite) {
      if (now - lastTime > this.ttlMs) {
        this.buffers.delete(canvasId);
        this.seqCounters.delete(canvasId);
        this.lastWrite.delete(canvasId);
        this.activeRuns.delete(canvasId);
        this.subscribers.delete(canvasId);
      }
    }
  }

  dispose(): void {
    this.buffers.clear();
    this.seqCounters.clear();
    this.subscribers.clear();
    this.lastWrite.clear();
    this.activeRuns.clear();
  }
}
