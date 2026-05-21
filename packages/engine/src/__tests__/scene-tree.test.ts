import { describe, it, expect } from 'vitest';
import { SceneTree } from '../core/scene-tree.js';
import type { PenNode, PenDocument } from '@cucumber/pen-types';

function makeRect(id: string, x = 0, y = 0): PenNode {
  return { id, type: 'rectangle', x, y, width: 100, height: 100 } as any;
}

describe('SceneTree', () => {
  it('should load from document', () => {
    const tree = new SceneTree();
    const doc: PenDocument = { version: '1.0', children: [makeRect('r1'), makeRect('r2')] };
    tree.loadFromDocument(doc);
    expect(tree.getRoot()).toHaveLength(2);
    expect(tree.getNode('r1')).toBeDefined();
    expect(tree.getNode('r2')).toBeDefined();
  });

  it('should add and remove nodes', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [] });
    tree.addNode(makeRect('n1'));
    expect(tree.getNode('n1')).toBeDefined();
    expect(tree.getRoot()).toHaveLength(1);

    tree.removeNode('n1');
    expect(tree.getNode('n1')).toBeUndefined();
    expect(tree.getRoot()).toHaveLength(0);
  });

  it('should update node properties', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [makeRect('n1', 10, 20)] });
    tree.updateNode('n1', { x: 50, y: 60 });
    const node = tree.getNode('n1');
    expect(node?.node.x).toBe(50);
    expect(node?.node.y).toBe(60);
  });

  it('should support parent-child relationships', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [] });
    tree.addNode({ id: 'parent', type: 'frame', children: [] } as any);
    tree.addNode(makeRect('child'), 'parent');

    const parent = tree.getNode('parent');
    expect(parent?.children).toHaveLength(1);
    expect(parent?.children[0]?.id).toBe('child');
  });

  it('should move nodes between parents', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [] });
    tree.addNode({ id: 'p1', type: 'frame', children: [] } as any);
    tree.addNode({ id: 'p2', type: 'frame', children: [] } as any);
    tree.addNode(makeRect('child'), 'p1');

    tree.moveNode('child', 'p2');
    expect(tree.getNode('p1')?.children).toHaveLength(0);
    expect(tree.getNode('p2')?.children).toHaveLength(1);
  });

  it('should track dirty state', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [makeRect('n1')] });
    expect(tree.getDirtyNodes()).toHaveLength(0);

    tree.updateNode('n1', { x: 99 });
    expect(tree.getDirtyNodes()).toHaveLength(1);

    tree.clearAllDirty();
    expect(tree.getDirtyNodes()).toHaveLength(0);
  });

  it('should serialize back to document', () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: '1.0', children: [makeRect('r1')] });
    tree.addNode(makeRect('r2'));
    const doc = tree.toDocument('2.0');
    expect(doc.version).toBe('2.0');
    expect(doc.children).toHaveLength(2);
  });
});
