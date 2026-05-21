import { describe, it, expect } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import type { AgentBinding } from '../types.js';

describe('ContainerManager - Agent Binding', () => {
  it('should bind an agent to a container', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });

    const binding: AgentBinding = {
      agentId: 'agent-1',
      name: 'Kiki',
      color: '#FF6B6B',
      role: 'designer',
      status: 'idle',
      permissions: ['read', 'write'],
    };

    const result = mgr.bindAgent(c.id, binding);
    expect(result).toBe(true);

    const updated = mgr.getContainer(c.id);
    expect(updated?.agentBinding?.agentId).toBe('agent-1');
    expect(updated?.agentBinding?.name).toBe('Kiki');
    expect(updated?.agentBinding?.color).toBe('#FF6B6B');
    expect(updated?.agentBinding?.assignedAt).toBeDefined();
  });

  it('should unbind an agent', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.bindAgent(c.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B' });

    const result = mgr.unbindAgent(c.id);
    expect(result).toBe(true);
    expect(mgr.getContainer(c.id)?.agentBinding).toBeUndefined();
  });

  it('should update agent status', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.bindAgent(c.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B', status: 'idle' });

    mgr.updateAgentStatus(c.id, 'running');
    expect(mgr.getContainer(c.id)?.agentBinding?.status).toBe('running');
  });

  it('should emit agent events', () => {
    const mgr = new ContainerManager();
    const events: string[] = [];
    mgr.on('agent:bound', () => events.push('bound'));
    mgr.on('agent:unbound', () => events.push('unbound'));
    mgr.on('agent:status', () => events.push('status'));

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.bindAgent(c.id, { agentId: 'a1', name: 'Kiki', color: '#FF6B6B' });
    mgr.updateAgentStatus(c.id, 'running');
    mgr.unbindAgent(c.id);

    expect(events).toEqual(['bound', 'status', 'unbound']);
  });

  it('should find containers by agent', () => {
    const mgr = new ContainerManager();
    const c1 = mgr.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const c2 = mgr.createContainer({ bounds: { x: 200, y: 0, width: 100, height: 100 } });
    mgr.bindAgent(c1.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B' });
    mgr.bindAgent(c2.id, { agentId: 'agent-1', name: 'Kiki', color: '#FF6B6B' });

    const containers = mgr.getContainersByAgent('agent-1');
    expect(containers).toHaveLength(2);
  });
});

describe('ContainerManager - Context Slots', () => {
  it('should update context slots', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });

    mgr.updateContextSlots(c.id, {
      style: { colorPalette: 'brand-purple' },
      rules: ['只用品牌紫'],
    });

    const updated = mgr.getContainer(c.id);
    expect(updated?.contextSlots.style).toEqual({ colorPalette: 'brand-purple' });
    expect(updated?.contextSlots.rules).toEqual(['只用品牌紫']);
  });

  it('should merge context slots (not replace)', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });

    mgr.updateContextSlots(c.id, { style: { color: 'red' } });
    mgr.updateContextSlots(c.id, { style: { fontSize: '14px' } });

    const updated = mgr.getContainer(c.id);
    expect(updated?.contextSlots.style).toEqual({ color: 'red', fontSize: '14px' });
  });

  it('should set inherit policy', () => {
    const mgr = new ContainerManager();
    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    expect(c.inheritPolicy).toBe('merge');

    mgr.setInheritPolicy(c.id, 'override');
    expect(mgr.getContainer(c.id)?.inheritPolicy).toBe('override');
  });

  it('should emit context:change event', () => {
    const mgr = new ContainerManager();
    let emitted = false;
    mgr.on('context:change', () => { emitted = true; });

    const c = mgr.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    mgr.updateContextSlots(c.id, { rules: ['test rule'] });
    expect(emitted).toBe(true);
  });

  it('should invalidate cache on context slot update', () => {
    const mgr = new ContainerManager();
    const parent = mgr.createContainer({ bounds: { x: 0, y: 0, width: 400, height: 400 } });
    const child = mgr.createContainer({ bounds: { x: 20, y: 20, width: 100, height: 100 }, parentId: parent.id });

    mgr.updateContextSlots(parent.id, { style: { color: 'blue' } });
    const childCtx = mgr.resolveContext(child.id);
    expect(childCtx.style).toEqual({ color: 'blue' });

    mgr.updateContextSlots(parent.id, { style: { color: 'red' } });
    const childCtx2 = mgr.resolveContext(child.id);
    expect(childCtx2.style).toEqual({ color: 'red' });
  });
});
