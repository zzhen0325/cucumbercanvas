import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../agent-registry.js';

describe('AgentRegistry', () => {
  it('should register an agent with auto-assigned color and name', () => {
    const registry = new AgentRegistry();
    const identity = registry.register('agent-1');
    expect(identity.agentId).toBe('agent-1');
    expect(identity.color).toBeDefined();
    expect(identity.name).toBeDefined();
  });

  it('should register with explicit color and name', () => {
    const registry = new AgentRegistry();
    const identity = registry.register('agent-1', { color: '#FF0000', name: 'TestBot' });
    expect(identity.color).toBe('#FF0000');
    expect(identity.name).toBe('TestBot');
  });

  it('should return existing identity on duplicate registration', () => {
    const registry = new AgentRegistry();
    const first = registry.register('agent-1', { name: 'First' });
    const second = registry.register('agent-1', { name: 'Second' });
    expect(second.name).toBe('First');
  });

  it('should unregister an agent', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1');
    expect(registry.getAllAgents()).toHaveLength(1);
    registry.unregister('agent-1');
    expect(registry.getAllAgents()).toHaveLength(0);
  });

  it('should cycle colors for multiple agents', () => {
    const registry = new AgentRegistry();
    const a1 = registry.register('a1');
    const a2 = registry.register('a2');
    const a3 = registry.register('a3');
    expect(a1.color).not.toBe(a2.color);
    expect(a2.color).not.toBe(a3.color);
  });

  it('should assign unique names', () => {
    const registry = new AgentRegistry();
    const a1 = registry.register('a1');
    const a2 = registry.register('a2');
    expect(a1.name).not.toBe(a2.name);
  });

  it('should update agent identity', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', { name: 'Kiki', role: 'designer' });
    registry.updateAgent('agent-1', { role: 'reviewer' });
    const updated = registry.getAgent('agent-1');
    expect(updated?.role).toBe('reviewer');
    expect(updated?.name).toBe('Kiki');
  });

  it('should emit events on register/unregister', () => {
    const registry = new AgentRegistry();
    const events: string[] = [];
    registry.on('agent:registered', () => events.push('registered'));
    registry.on('agent:unregistered', () => events.push('unregistered'));
    registry.register('a1');
    registry.unregister('a1');
    expect(events).toEqual(['registered', 'unregistered']);
  });

  it('should assign batch identities', () => {
    const registry = new AgentRegistry();
    const identities = registry.assignIdentities(3);
    expect(identities).toHaveLength(3);
    expect(identities[0]!.agentId).toBeDefined();
    expect(identities[1]!.agentId).toBeDefined();
    expect(identities[2]!.agentId).toBeDefined();
  });

  it('should recycle names after unregister', () => {
    const registry = new AgentRegistry();
    const a1 = registry.register('a1');
    const originalName = a1.name;
    registry.unregister('a1');
    const a2 = registry.register('a2');
    expect(a2.name).toBe(originalName);
  });
});
