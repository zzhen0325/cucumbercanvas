import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { ContainerManager } from '../container-manager.js';
import type { DataFlowEdge, PortPayload } from '../dataflow/types.js';

describe('DataFlowEngine', () => {
  let containerManager: ContainerManager;
  let engine: DataFlowEngine;

  beforeEach(() => {
    containerManager = new ContainerManager();
    engine = new DataFlowEngine(containerManager);

    containerManager.createContainer({
      id: 'node-a',
      bounds: { x: 0, y: 0, width: 200, height: 100 },
    });
    containerManager.updateContainer('node-a', {
      ioPorts: [
        { id: 'a-out-img', direction: 'output', dataType: 'image', label: 'Image Out' },
        { id: 'a-out-text', direction: 'output', dataType: 'text', label: 'Text Out' },
      ],
    });

    containerManager.createContainer({
      id: 'node-b',
      bounds: { x: 400, y: 0, width: 200, height: 100 },
    });
    containerManager.updateContainer('node-b', {
      ioPorts: [
        { id: 'b-in-img', direction: 'input', dataType: 'image', label: 'Image In' },
        { id: 'b-out-text', direction: 'output', dataType: 'text', label: 'Text Out' },
      ],
    });

    containerManager.createContainer({
      id: 'node-c',
      bounds: { x: 800, y: 0, width: 200, height: 100 },
    });
    containerManager.updateContainer('node-c', {
      ioPorts: [
        { id: 'c-in-text', direction: 'input', dataType: 'text', label: 'Text In' },
        { id: 'c-in-prompt', direction: 'input', dataType: 'prompt', label: 'Prompt In' },
      ],
    });
  });

  describe('addEdge', () => {
    it('should add valid edge between compatible ports', () => {
      const edge = engine.addEdge({
        id: 'edge-1',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      expect(edge).not.toBeNull();
      expect(edge!.id).toBe('edge-1');
      expect(edge!.status).toBe('idle');
    });

    it('should reject edge between incompatible ports', () => {
      const edge = engine.addEdge({
        id: 'edge-bad',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-c', portId: 'c-in-text' },
      });

      expect(edge).toBeNull();
    });

    it('should allow text output to prompt input', () => {
      const edge = engine.addEdge({
        id: 'edge-text-prompt',
        source: { nodeId: 'node-b', portId: 'b-out-text' },
        target: { nodeId: 'node-c', portId: 'c-in-prompt' },
      });

      expect(edge).not.toBeNull();
    });

    it('should reject output-to-output connection', () => {
      const edge = engine.addEdge({
        id: 'edge-bad',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-out-text' },
      });

      expect(edge).toBeNull();
    });

    it('should reject connection to nonexistent node', () => {
      const edge = engine.addEdge({
        id: 'edge-bad',
        source: { nodeId: 'node-x', portId: 'x-out' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      expect(edge).toBeNull();
    });

    it('should emit edge:add event', () => {
      const handler = vi.fn();
      engine.on('edge:add', handler);

      engine.addEdge({
        id: 'edge-1',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'edge-1' })
      );
    });
  });

  describe('removeEdge', () => {
    it('should remove existing edge', () => {
      engine.addEdge({
        id: 'edge-1',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      expect(engine.removeEdge('edge-1')).toBe(true);
      expect(engine.getEdge('edge-1')).toBeUndefined();
    });

    it('should return false for nonexistent edge', () => {
      expect(engine.removeEdge('nonexistent')).toBe(false);
    });
  });

  describe('cycle detection', () => {
    it('should prevent direct cycle', () => {
      containerManager.updateContainer('node-a', {
        ioPorts: [
          { id: 'a-out-img', direction: 'output', dataType: 'image', label: 'Image Out' },
          { id: 'a-in-img', direction: 'input', dataType: 'image', label: 'Image In' },
        ],
      });
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in-img', direction: 'input', dataType: 'image', label: 'Image In' },
          { id: 'b-out-img', direction: 'output', dataType: 'image', label: 'Image Out' },
        ],
      });

      engine.addEdge({
        id: 'edge-ab',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      const cycleEdge = engine.addEdge({
        id: 'edge-ba',
        source: { nodeId: 'node-b', portId: 'b-out-img' },
        target: { nodeId: 'node-a', portId: 'a-in-img' },
      });

      expect(cycleEdge).toBeNull();
    });

    it('should emit cycle:detected event', () => {
      containerManager.updateContainer('node-a', {
        ioPorts: [
          { id: 'a-out-img', direction: 'output', dataType: 'image' },
          { id: 'a-in-img', direction: 'input', dataType: 'image' },
        ],
      });
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in-img', direction: 'input', dataType: 'image' },
          { id: 'b-out-img', direction: 'output', dataType: 'image' },
        ],
      });

      engine.addEdge({
        id: 'edge-ab',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      const handler = vi.fn();
      engine.on('cycle:detected', handler);

      engine.addEdge({
        id: 'edge-ba',
        source: { nodeId: 'node-b', portId: 'b-out-img' },
        target: { nodeId: 'node-a', portId: 'a-in-img' },
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('topoSort', () => {
    it('should return topological order', () => {
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in-img', direction: 'input', dataType: 'image' },
          { id: 'b-out-text', direction: 'output', dataType: 'text' },
        ],
      });

      engine.addEdge({
        id: 'edge-ab',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      engine.addEdge({
        id: 'edge-bc',
        source: { nodeId: 'node-b', portId: 'b-out-text' },
        target: { nodeId: 'node-c', portId: 'c-in-text' },
      });

      const sorted = engine.topoSort();
      const idxA = sorted.indexOf('node-a');
      const idxB = sorted.indexOf('node-b');
      const idxC = sorted.indexOf('node-c');

      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('should throw on cycle', () => {
      containerManager.updateContainer('node-a', {
        ioPorts: [
          { id: 'a-out', direction: 'output', dataType: 'text' },
          { id: 'a-in', direction: 'input', dataType: 'text' },
        ],
      });
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in', direction: 'input', dataType: 'text' },
          { id: 'b-out', direction: 'output', dataType: 'text' },
        ],
      });

      engine.loadEdges([
        { id: 'e1', source: { nodeId: 'node-a', portId: 'a-out' }, target: { nodeId: 'node-b', portId: 'b-in' }, status: 'idle' },
        { id: 'e2', source: { nodeId: 'node-b', portId: 'b-out' }, target: { nodeId: 'node-a', portId: 'a-in' }, status: 'idle' },
      ]);

      expect(() => engine.topoSort()).toThrow(/[Cc]ycle/);
    });
  });

  describe('pull execution', () => {
    it('should execute node and cache results', async () => {
      const executor = vi.fn(async (_inputs, _ctx, emit) => {
        emit('a-out-img', { type: 'image', url: 'https://example.com/img.png' });
      });

      engine.register('node-a', executor);

      const result = await engine.pull('node-a');
      expect(result['a-out-img']).toEqual({ type: 'image', url: 'https://example.com/img.png' });
      expect(executor).toHaveBeenCalledTimes(1);

      const cachedResult = await engine.pull('node-a');
      expect(cachedResult['a-out-img']).toEqual({ type: 'image', url: 'https://example.com/img.png' });
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it('should pull upstream data for connected nodes', async () => {
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in-img', direction: 'input', dataType: 'image' },
          { id: 'b-out-text', direction: 'output', dataType: 'text' },
        ],
      });

      engine.addEdge({
        id: 'edge-ab',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      engine.register('node-a', async (_inputs, _ctx, emit) => {
        emit('a-out-img', { type: 'image', url: 'generated.png' });
      });

      engine.register('node-b', async (inputs, _ctx, emit) => {
        const img = inputs['b-in-img'] as any;
        emit('b-out-text', { type: 'text', content: `Processed: ${img.url}` });
      });

      const result = await engine.pull('node-b');
      expect(result['b-out-text']).toEqual({ type: 'text', content: 'Processed: generated.png' });
    });

    it('should invalidate cache when upstream changes', async () => {
      containerManager.updateContainer('node-b', {
        ioPorts: [
          { id: 'b-in-img', direction: 'input', dataType: 'image' },
          { id: 'b-out-text', direction: 'output', dataType: 'text' },
        ],
      });

      engine.addEdge({
        id: 'edge-ab',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      let version = 1;
      engine.register('node-a', async (_inputs, _ctx, emit) => {
        emit('a-out-img', { type: 'image', url: `v${version}.png` });
      });
      engine.register('node-b', async (inputs, _ctx, emit) => {
        const img = inputs['b-in-img'] as any;
        emit('b-out-text', { type: 'text', content: img.url });
      });

      await engine.pull('node-b');
      version = 2;
      engine.invalidateCache('node-a');
      const result = await engine.pull('node-b');
      expect(result['b-out-text']).toEqual({ type: 'text', content: 'v2.png' });
    });
  });

  describe('serialization', () => {
    it('should serialize and load edges', () => {
      engine.addEdge({
        id: 'edge-1',
        source: { nodeId: 'node-a', portId: 'a-out-img' },
        target: { nodeId: 'node-b', portId: 'b-in-img' },
      });

      const serialized = engine.serialize();
      expect(serialized).toHaveLength(1);
      expect(serialized[0]!.id).toBe('edge-1');

      const engine2 = new DataFlowEngine(containerManager);
      engine2.loadEdges(serialized);
      expect(engine2.getAllEdges()).toHaveLength(1);
    });
  });
});
