import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { IncrementalRenderer } from '../performance/incremental-renderer.js';
import { AgentThrottler } from '../performance/agent-throttler.js';
import { DataFlowBatchExecutor } from '../performance/dataflow-batch-executor.js';

describe('IncrementalRenderer', () => {
  let containerManager: ContainerManager;
  let renderer: IncrementalRenderer;

  beforeEach(() => {
    containerManager = new ContainerManager();
    renderer = new IncrementalRenderer(containerManager);
  });

  it('should mark containers as dirty on update', () => {
    const container = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(renderer.isDirty(container.id)).toBe(true);
  });

  it('should track dirty state manually', () => {
    renderer.markDirty('c1');
    expect(renderer.isDirty('c1')).toBe(true);
    renderer.markClean('c1');
    expect(renderer.isDirty('c1')).toBe(false);
  });

  it('should collect all dirty IDs', () => {
    renderer.markDirty('c1');
    renderer.markDirty('c2');
    renderer.markDirty('c3');
    const ids = renderer.getDirtyIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(ids).toContain('c3');
  });

  it('should flush dirty set and invoke callback', () => {
    const flushCb = vi.fn();
    renderer.onFlush(flushCb);
    renderer.markDirty('c1');
    renderer.markDirty('c2');
    renderer.flush();
    expect(flushCb).toHaveBeenCalledWith(expect.arrayContaining(['c1', 'c2']));
    expect(renderer.getDirtyIds()).toHaveLength(0);
  });

  it('should emit flush event', () => {
    const flushFn = vi.fn();
    renderer.on('dirty:flush', flushFn);
    renderer.markDirty('c1');
    renderer.flush();
    expect(flushFn).toHaveBeenCalledWith(['c1']);
  });
});

describe('AgentThrottler', () => {
  let throttler: AgentThrottler;

  beforeEach(() => {
    throttler = new AgentThrottler({ maxConcurrent: 2, timeout: 1000 });
  });

  it('should allow agents up to max concurrent', async () => {
    await throttler.acquire('a1');
    await throttler.acquire('a2');
    expect(throttler.activeCount).toBe(2);
  });

  it('should queue agents beyond limit', async () => {
    await throttler.acquire('a1');
    await throttler.acquire('a2');

    let resolved = false;
    const promise = throttler.acquire('a3').then(() => { resolved = true; });
    expect(throttler.queueLength).toBe(1);
    expect(resolved).toBe(false);

    throttler.release('a1');
    await promise;
    expect(resolved).toBe(true);
    expect(throttler.activeCount).toBe(2);
  });

  it('should timeout queued agents', async () => {
    const shortThrottler = new AgentThrottler({ maxConcurrent: 1, timeout: 50 });
    await shortThrottler.acquire('a1');

    await expect(shortThrottler.acquire('a2')).rejects.toThrow('timed out');
    shortThrottler.dispose();
  });

  it('should cancel queued agents', async () => {
    await throttler.acquire('a1');
    await throttler.acquire('a2');

    const promise = throttler.acquire('a3').catch(() => 'cancelled');
    expect(throttler.cancel('a3')).toBe(true);
    expect(await promise).toBe('cancelled');
  });

  it('should update max concurrent dynamically', async () => {
    await throttler.acquire('a1');
    await throttler.acquire('a2');

    let resolved = false;
    throttler.acquire('a3').then(() => { resolved = true; });

    throttler.setMaxConcurrent(3);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(resolved).toBe(true);
  });
});

describe('DataFlowBatchExecutor', () => {
  let containerManager: ContainerManager;
  let dataFlowEngine: DataFlowEngine;
  let batchExecutor: DataFlowBatchExecutor;

  beforeEach(() => {
    containerManager = new ContainerManager();
    dataFlowEngine = new DataFlowEngine(containerManager);
    batchExecutor = new DataFlowBatchExecutor(dataFlowEngine, {
      batchWindow: 10,
      maxBatchSize: 5,
    });
  });

  it('should accumulate pending nodes', () => {
    batchExecutor.schedule('n1');
    batchExecutor.schedule('n2');
    expect(batchExecutor.pendingCount).toBe(2);
  });

  it('should deduplicate pending nodes', () => {
    batchExecutor.schedule('n1');
    batchExecutor.schedule('n1');
    batchExecutor.schedule('n1');
    expect(batchExecutor.pendingCount).toBe(1);
  });

  it('should schedule multiple nodes at once', () => {
    batchExecutor.scheduleMultiple(['n1', 'n2', 'n3']);
    expect(batchExecutor.pendingCount).toBe(3);
  });

  it('should flush and execute batch', async () => {
    const c1 = containerManager.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    dataFlowEngine.register(c1.id, async (inputs, ctx, emit) => {
      emit('out', { type: 'text', content: 'result' });
    });

    batchExecutor.schedule(c1.id);

    const batchStartFn = vi.fn();
    batchExecutor.on('batch:start', batchStartFn);

    await batchExecutor.flush();
    expect(batchStartFn).toHaveBeenCalledWith([c1.id]);
    expect(batchExecutor.pendingCount).toBe(0);
  });

  it('should auto-flush when reaching max batch size', async () => {
    const containers = Array.from({ length: 5 }, (_, i) =>
      containerManager.createContainer({ bounds: { x: i * 100, y: 0, width: 80, height: 80 } })
    );

    const batchStartFn = vi.fn();
    batchExecutor.on('batch:start', batchStartFn);

    for (const c of containers) {
      batchExecutor.schedule(c.id);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(batchStartFn).toHaveBeenCalled();
  });
});
