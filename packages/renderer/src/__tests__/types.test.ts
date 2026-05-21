import { describe, it, expect } from 'vitest';
import { containerNodeToRenderNode } from '../types.js';
import type { ContainerNode } from '@cucumber/container';

describe('PixiRenderer types', () => {
  it('should convert ContainerNode to RenderNode', () => {
    const container: ContainerNode = {
      id: 'test-1',
      type: 'container',
      parentId: null,
      role: ['visual'],
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      contextSlots: {},
      inheritPolicy: 'merge',
      ioPorts: [],
      style: { fill: '#ff0000', stroke: '#00ff00', opacity: 0.8, label: 'Test' },
    };

    const renderNode = containerNodeToRenderNode(container);
    expect(renderNode.id).toBe('test-1');
    expect(renderNode.type).toBe('container');
    expect(renderNode.absX).toBe(10);
    expect(renderNode.absY).toBe(20);
    expect(renderNode.absW).toBe(300);
    expect(renderNode.absH).toBe(200);
    expect(renderNode.fill).toBe('#ff0000');
    expect(renderNode.stroke).toBe('#00ff00');
    expect(renderNode.opacity).toBe(0.8);
    expect(renderNode.label).toBe('Test');
  });

  it('should use defaults when style is missing', () => {
    const container: ContainerNode = {
      id: 'test-2',
      type: 'container',
      parentId: null,
      role: ['task'],
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      contextSlots: {},
      inheritPolicy: 'merge',
      ioPorts: [],
    };

    const renderNode = containerNodeToRenderNode(container);
    expect(renderNode.fill).toBe('#ffffff0d');
    expect(renderNode.stroke).toBe('#666666');
    expect(renderNode.opacity).toBe(1);
    expect(renderNode.label).toBe('Container');
  });
});
