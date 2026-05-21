import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { IOPortManager } from '../io-port-manager.js';
import { AgentOrchestrator } from '../collaboration/agent-orchestrator.js';
import { AgentCollabSession } from '../collaboration/agent-collab-session.js';
import type { AgentCollabMessage } from '../collaboration/types.js';

describe('AgentOrchestrator', () => {
  let containerManager: ContainerManager;
  let dataFlowEngine: DataFlowEngine;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    containerManager = new ContainerManager();
    dataFlowEngine = new DataFlowEngine(containerManager);
    orchestrator = new AgentOrchestrator(containerManager, dataFlowEngine, {
      maxConcurrentAgents: 3,
    });
  });

  it('should start an agent and acquire lock', async () => {
    const container = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    containerManager.bindAgent(container.id, { agentId: 'agent-1', status: 'idle' });

    const result = await orchestrator.startAgent('agent-1', container.id);
    expect(result).toBe(true);
    expect(orchestrator.runningCount).toBe(1);
    expect(orchestrator.isAgentActive('agent-1')).toBe(true);
  });

  it('should throttle agents beyond max concurrent', async () => {
    const containers = Array.from({ length: 4 }, (_, i) =>
      containerManager.createContainer({ bounds: { x: i * 100, y: 0, width: 100, height: 100 } })
    );

    for (let i = 0; i < 4; i++) {
      containerManager.bindAgent(containers[i]!.id, { agentId: `agent-${i}`, status: 'idle' });
    }

    await orchestrator.startAgent('agent-0', containers[0]!.id);
    await orchestrator.startAgent('agent-1', containers[1]!.id);
    await orchestrator.startAgent('agent-2', containers[2]!.id);

    const throttledFn = vi.fn();
    orchestrator.on('agent:throttled', throttledFn);

    const startPromise = orchestrator.startAgent('agent-3', containers[3]!.id);
    expect(throttledFn).toHaveBeenCalledWith('agent-3');

    orchestrator.completeAgent('agent-0');
    const result = await startPromise;
    expect(result).toBe(true);
    expect(orchestrator.runningCount).toBe(3);
  });

  it('should complete an agent and release lock', async () => {
    const container = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    containerManager.bindAgent(container.id, { agentId: 'agent-1', status: 'idle' });

    await orchestrator.startAgent('agent-1', container.id);
    const result = orchestrator.completeAgent('agent-1');
    expect(result).toBe(true);
    expect(orchestrator.runningCount).toBe(0);
    expect(orchestrator.getLock(container.id)).toBeUndefined();
  });

  it('should detect lock conflicts on submit operation', async () => {
    const container = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    containerManager.bindAgent(container.id, { agentId: 'agent-1', status: 'idle' });
    await orchestrator.startAgent('agent-1', container.id);

    const conflictFn = vi.fn();
    orchestrator.on('lock:conflict', conflictFn);

    const op = orchestrator.submitOperation('agent-2', container.id, 'update', 'node-x', {});
    expect(op).toBeNull();
    expect(conflictFn).toHaveBeenCalledWith(container.id, 'agent-2', 'agent-1');
  });

  it('should allow valid operations and track version', async () => {
    const container = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    containerManager.bindAgent(container.id, { agentId: 'agent-1', status: 'idle' });
    await orchestrator.startAgent('agent-1', container.id);

    const op = orchestrator.submitOperation('agent-1', container.id, 'update', 'node-1', { color: 'red' });
    expect(op).not.toBeNull();
    expect(op!.version).toBe(1);

    const op2 = orchestrator.submitOperation('agent-1', container.id, 'add', 'node-2', {});
    expect(op2!.version).toBe(2);

    const log = orchestrator.getOperationLog(container.id);
    expect(log).toHaveLength(2);
  });

  it('should broadcast output to downstream agents', async () => {
    const c1 = containerManager.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    const c2 = containerManager.createContainer({ bounds: { x: 300, y: 0, width: 200, height: 200 } });

    const ioPortManager = new IOPortManager(containerManager);
    const outPort = ioPortManager.addPort({ containerId: c1.id, direction: 'output', dataType: 'text' })!;
    const inPort = ioPortManager.addPort({ containerId: c2.id, direction: 'input', dataType: 'text' })!;

    dataFlowEngine.addEdge({
      id: 'edge-1',
      source: { nodeId: c1.id, portId: outPort.id },
      target: { nodeId: c2.id, portId: inPort.id },
    });

    containerManager.bindAgent(c1.id, { agentId: 'agent-a', status: 'idle' });
    containerManager.bindAgent(c2.id, { agentId: 'agent-b', status: 'idle' });

    const broadcastFn = vi.fn();
    orchestrator.on('broadcast:output', broadcastFn);

    orchestrator.broadcastOutput('agent-a', outPort.id, { text: 'hello' });

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(broadcastFn).toHaveBeenCalledWith('agent-a', ['agent-b'], outPort.id);
  });
});

describe('AgentCollabSession', () => {
  let containerManager: ContainerManager;
  let session: AgentCollabSession;

  beforeEach(() => {
    containerManager = new ContainerManager();
    session = new AgentCollabSession(containerManager, ['agent-1', 'agent-2']);
  });

  it('should manage participants', () => {
    expect(session.participants).toEqual(['agent-1', 'agent-2']);
    session.join('agent-3');
    expect(session.participants).toContain('agent-3');
    session.leave('agent-1');
    expect(session.participants).not.toContain('agent-1');
  });

  it('should send and receive messages', () => {
    const receivedFn = vi.fn();
    session.onMessage('agent-2', receivedFn);

    const msg = session.sendMessage('agent-1', 'agent-2', 'task:assign', { task: 'generate' });
    expect(msg.type).toBe('request');
    expect(msg.from).toBe('agent-1');
    expect(msg.to).toBe('agent-2');
    expect(receivedFn).toHaveBeenCalledWith(expect.objectContaining({ topic: 'task:assign' }));
  });

  it('should broadcast messages to all except sender', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    session.join('agent-3');
    session.onMessage('agent-1', handler1);
    session.onMessage('agent-2', handler2);
    session.onMessage('agent-3', handler3);

    session.broadcast('agent-1', 'status:update', { status: 'completed' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
    expect(handler3).toHaveBeenCalled();
  });

  it('should track conflict records', () => {
    const conflict = session.recordConflict('container-1', 'agent-1', {
      id: 'op-1',
      agentId: 'agent-1',
      containerId: 'container-1',
      type: 'update',
      target: 'node-1',
      payload: {},
      timestamp: Date.now(),
      version: 1,
    });

    expect(session.getUnresolvedConflicts()).toHaveLength(1);
    session.resolveConflict(conflict.id, 'accept');
    expect(session.getUnresolvedConflicts()).toHaveLength(0);
  });

  it('should respond with correlation id', () => {
    const msg = session.sendMessage('agent-1', 'agent-2', 'review:request', { content: 'text' });
    const resp = session.respond('agent-2', 'agent-1', 'review:response', { approved: true }, msg.id);
    expect(resp.type).toBe('response');
    expect(resp.correlationId).toBe(msg.id);
  });
});
