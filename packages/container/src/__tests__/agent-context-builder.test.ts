import { describe, it, expect } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import { AgentContextBuilder } from '../agent-context-builder.js';

describe('AgentContextBuilder', () => {
  it('should build agent context for a bound container', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);

    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 500, height: 500 } });
    const child = mgr.createContainer({ bounds: { x: 20, y: 20, width: 200, height: 200 }, parentId: parent.id });

    mgr.bindAgent(child.id, {
      agentId: 'agent-1',
      name: 'Kiki',
      color: '#FF6B6B',
      permissions: ['read', 'write'],
      status: 'running',
    });

    mgr.updateContextSlots(parent.id, { style: { color: 'brand-purple' } });
    mgr.updateContextSlots(child.id, { rules: ['只用品牌紫'] });

    const ctx = builder.build('agent-1', child.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.agentId).toBe('agent-1');
    expect(ctx!.containerId).toBe(child.id);
    expect(ctx!.containerPath).toEqual([parent.id, child.id]);
    expect(ctx!.parent?.id).toBe(parent.id);
    expect(ctx!.effectiveContext.style).toEqual({ color: 'brand-purple' });
    expect(ctx!.effectiveContext.rules).toEqual(['只用品牌紫']);
    expect(ctx!.permissions).toEqual(['read', 'write']);
  });

  it('should list siblings', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);

    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 600, height: 400 } });
    const c1 = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 }, parentId: parent.id });
    const c2 = mgr.createContainer({ bounds: { x: 220, y: 0, width: 200, height: 200 }, parentId: parent.id });

    mgr.bindAgent(c1.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B' });
    mgr.bindAgent(c2.id, { agentId: 'agent-2', name: 'Mochi', color: '#4ECDC4' });

    const ctx = builder.build('agent-1', c1.id);
    expect(ctx!.siblings).toHaveLength(1);
    expect(ctx!.siblings[0]!.agentId).toBe('agent-2');
  });

  it('should enforce canOperate based on permissions', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.bindAgent(c.id, {
      agentId: 'agent-1',
      name: 'Kiki',
      color: '#FF6B6B',
      permissions: ['read', 'write'],
    });

    const ctx = builder.build('agent-1', c.id);
    expect(ctx!.canOperate('node-1')).toBe(true);
  });

  it('should deny canOperate for unauthorized agent', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.bindAgent(c.id, {
      agentId: 'agent-1',
      name: 'Kiki',
      color: '#FF6B6B',
      permissions: ['read', 'write'],
    });

    mgr.updateContainer(c.id, {
      permissions: {
        owner: 'agent-1',
        canRead: ['agent-1'],
        canWrite: ['agent-1'],
        isolationLevel: 'strict',
      },
    });

    const ctx = builder.build('agent-2', c.id);
    expect(ctx!.canOperate('node-1')).toBe(false);
  });

  it('should return null for non-existent container', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);
    const ctx = builder.build('agent-1', 'non-existent');
    expect(ctx).toBeNull();
  });

  it('should find visible nodes within container bounds', () => {
    const mgr = new ContainerManager();
    const builder = new AgentContextBuilder(mgr);

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 300, height: 300 } });
    mgr.bindAgent(c.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B', permissions: ['read'] });

    builder.updateNodeIndex([
      { id: 'n1', type: 'rect', bounds: { x: 10, y: 10, width: 50, height: 50 } },
      { id: 'n2', type: 'text', bounds: { x: 500, y: 500, width: 50, height: 50 } },
    ]);

    const ctx = builder.build('agent-1', c.id);
    expect(ctx!.visibleNodes).toHaveLength(1);
    expect(ctx!.visibleNodes[0]!.id).toBe('n1');
  });
});
