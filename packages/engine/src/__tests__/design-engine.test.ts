import { describe, it, expect } from 'vitest';
import { DesignEngine } from '../core/design-engine.js';
import type { PenDocument, PenNode } from '@cucumber/pen-types';

function makeDoc(): PenDocument {
  return { version: '1.0', children: [] };
}

function makeRect(id: string): PenNode {
  return { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 50 } as any;
}

describe('DesignEngine', () => {
  it('should initialize with a document', () => {
    const doc = makeDoc();
    const engine = new DesignEngine(doc);
    expect(engine.getDocument()).toEqual(doc);
  });

  it('should add nodes and emit document:change', () => {
    const engine = new DesignEngine(makeDoc());
    let changed = false;
    engine.on('document:change', () => { changed = true; });
    engine.addNode(makeRect('r1'));
    expect(changed).toBe(true);
    expect(engine.getDocument().children).toHaveLength(1);
  });

  it('should support undo/redo', async () => {
    const engine = new DesignEngine(makeDoc());
    engine.addNode(makeRect('r1'));
    await new Promise(r => setTimeout(r, 350));
    engine.addNode(makeRect('r2'));
    expect(engine.getDocument().children).toHaveLength(2);

    engine.undo();
    expect(engine.getDocument().children).toHaveLength(1);

    engine.redo();
    expect(engine.getDocument().children).toHaveLength(2);
  });

  it('should manage tool state', () => {
    const engine = new DesignEngine(makeDoc());
    let tool = '';
    engine.on('tool:change', (t) => { tool = t; });
    engine.setActiveTool('rectangle');
    expect(tool).toBe('rectangle');
    expect(engine.getActiveTool()).toBe('rectangle');
  });

  it('should manage viewport state', () => {
    const engine = new DesignEngine(makeDoc());
    engine.viewport.setViewport(2, 100, 200);
    const state = engine.viewport.getState();
    expect(state.zoom).toBe(2);
    expect(state.panX).toBe(100);
    expect(state.panY).toBe(200);
  });

  it('should manage selection', () => {
    const engine = new DesignEngine(makeDoc());
    engine.addNode(makeRect('r1'));
    engine.selection.select(['r1']);
    expect(engine.selection.getSelection()).toEqual(['r1']);
    engine.selection.clearSelection();
    expect(engine.selection.getSelection()).toEqual([]);
  });
});
