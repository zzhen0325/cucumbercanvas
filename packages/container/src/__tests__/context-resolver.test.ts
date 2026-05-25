import { describe, it, expect } from 'vitest';
import { resolveContext } from '../context-resolver.js';
import type { PenNode as ContainerNode } from '../types.js';

function makeContainer(id: string, parentId: string | null, opts?: Partial<ContainerNode>): ContainerNode {
  return {
    id,
    type: 'container',
    parentId,
    role: ['visual'],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    contextSlots: {},
    inheritPolicy: 'merge',
    ioPorts: [],
    ...opts,
  };
}

describe('resolveContext', () => {
  it('should return empty-ish for single container with no slots', () => {
    const tree = new Map<string, ContainerNode>();
    tree.set('c1', makeContainer('c1', null));
    const ctx = resolveContext('c1', tree);
    expect(ctx.style).toEqual({});
    expect(ctx.tokens).toEqual({});
    expect(ctx.rules).toEqual([]);
    expect(ctx.constraints).toEqual({});
  });

  it('should return local context slots for single container', () => {
    const tree = new Map<string, ContainerNode>();
    tree.set('c1', makeContainer('c1', null, {
      contextSlots: { style: { color: 'red' }, rules: ['only brand purple'] },
    }));
    const ctx = resolveContext('c1', tree);
    expect(ctx.style).toEqual({ color: 'red' });
    expect(ctx.rules).toEqual(['only brand purple']);
  });

  it('should merge parent and child contexts', () => {
    const tree = new Map<string, ContainerNode>();
    tree.set('root', makeContainer('root', null, {
      contextSlots: { style: { font: 'Inter' }, tokens: { spacing: 8 } },
    }));
    tree.set('child', makeContainer('child', 'root', {
      contextSlots: { style: { color: 'blue' } },
      inheritPolicy: 'merge',
    }));
    const ctx = resolveContext('child', tree);
    expect(ctx.style).toEqual({ font: 'Inter', color: 'blue' });
    expect(ctx.tokens).toEqual({ spacing: 8 });
  });

  it('should override parent context with override policy', () => {
    const tree = new Map<string, ContainerNode>();
    tree.set('root', makeContainer('root', null, {
      contextSlots: { style: { font: 'Inter', color: 'red' } },
    }));
    tree.set('child', makeContainer('child', 'root', {
      contextSlots: { style: { color: 'green' } },
      inheritPolicy: 'override',
    }));
    const ctx = resolveContext('child', tree);
    expect(ctx.style).toEqual({ color: 'green' });
  });

  it('should block parent context with block policy', () => {
    const tree = new Map<string, ContainerNode>();
    tree.set('root', makeContainer('root', null, {
      contextSlots: { style: { font: 'Arial' }, rules: ['use serif'] },
    }));
    tree.set('child', makeContainer('child', 'root', {
      contextSlots: { rules: ['use sans-serif'] },
      inheritPolicy: 'block',
    }));
    const ctx = resolveContext('child', tree);
    expect(ctx.rules).toEqual(['use sans-serif']);
    expect(ctx.style).toEqual({ font: 'Arial' });
  });
});
