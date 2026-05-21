import { describe, it, expect } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import type { ContainerNode } from '../types.js';

describe('ContainerManager', () => {
  it('should create a container', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 150 },
      label: 'Test Container',
    });
    expect(c.id).toBeDefined();
    expect(c.type).toBe('container');
    expect(c.bounds.width).toBe(200);
    expect(c.style?.label).toBe('Test Container');
  });

  it('should get and list containers', () => {
    const mgr = new ContainerManager();
    const c1 = mgr.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const c2 = mgr.createContainer({ bounds: { x: 200, y: 0, width: 100, height: 100 } });
    expect(mgr.getAllContainers()).toHaveLength(2);
    expect(mgr.getContainer(c1.id)).toBeDefined();
    expect(mgr.getContainer(c2.id)).toBeDefined();
  });

  it('should support nesting (one level)', () => {
    const mgr = new ContainerManager();
    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 400, height: 400 }, label: 'Parent' });
    const child = mgr.createContainer({
      bounds: { x: 20, y: 40, width: 100, height: 100 },
      parentId: parent.id,
      label: 'Child',
    });
    expect(child.parentId).toBe(parent.id);
    expect(mgr.getChildren(parent.id)).toHaveLength(1);
    expect(mgr.getRootContainers()).toHaveLength(1);
  });

  it('should move containers', () => {
    const mgr = new ContainerManager();
    const p1 = mgr.createContainer({ bounds: { x: 0, y: 0, width: 300, height: 300 } });
    const p2 = mgr.createContainer({ bounds: { x: 400, y: 0, width: 300, height: 300 } });
    const child = mgr.createContainer({ bounds: { x: 10, y: 10, width: 50, height: 50 }, parentId: p1.id });

    mgr.moveContainer(child.id, p2.id);
    expect(mgr.getChildren(p1.id)).toHaveLength(0);
    expect(mgr.getChildren(p2.id)).toHaveLength(1);
  });

  it('should prevent moving to descendant (cycle prevention)', () => {
    const mgr = new ContainerManager();
    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 400, height: 400 } });
    const child = mgr.createContainer({ bounds: { x: 20, y: 20, width: 100, height: 100 }, parentId: parent.id });
    const result = mgr.moveContainer(parent.id, child.id);
    expect(result).toBe(false);
  });

  it('should remove container and reparent children', () => {
    const mgr = new ContainerManager();
    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 400, height: 400 } });
    const child = mgr.createContainer({ bounds: { x: 20, y: 20, width: 100, height: 100 }, parentId: parent.id });
    mgr.removeContainer(parent.id);
    const updatedChild = mgr.getContainer(child.id);
    expect(updatedChild?.parentId).toBeNull();
    expect(mgr.getRootContainers()).toHaveLength(1);
  });

  it('should update bounds', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    mgr.updateBounds(c.id, { x: 50, y: 50, width: 200 });
    const updated = mgr.getContainer(c.id);
    expect(updated?.bounds.x).toBe(50);
    expect(updated?.bounds.width).toBe(200);
    expect(updated?.bounds.height).toBe(100);
  });

  it('should emit events', () => {
    const mgr = new ContainerManager();
    const events: string[] = [];
    mgr.on('container:add', () => events.push('add'));
    mgr.on('container:update', () => events.push('update'));
    mgr.on('container:remove', () => events.push('remove'));

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    mgr.updateBounds(c.id, { x: 10 });
    mgr.removeContainer(c.id);
    expect(events).toEqual(['add', 'update', 'remove']);
  });

  it('should serialize and load containers', () => {
    const mgr = new ContainerManager();
    mgr.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 }, label: 'A' });
    mgr.createContainer({ bounds: { x: 200, y: 0, width: 150, height: 150 }, label: 'B' });
    const serialized = mgr.serialize();
    expect(serialized).toHaveLength(2);

    const mgr2 = new ContainerManager();
    mgr2.loadContainers(serialized);
    expect(mgr2.getAllContainers()).toHaveLength(2);
  });
});
