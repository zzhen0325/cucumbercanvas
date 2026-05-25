import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { IOPortManager } from '../io-port-manager.js';
import { AgentOrchestrator } from '../collaboration/agent-orchestrator.js';
import { TemplateRegistry } from '../templates/template-registry.js';
import { IncrementalRenderer } from '../performance/incremental-renderer.js';
import { AgentThrottler } from '../performance/agent-throttler.js';
import { DataFlowBatchExecutor } from '../performance/dataflow-batch-executor.js';

describe('P3 E2E: Multi-Agent Collaboration Pipeline', () => {
  let containerManager: ContainerManager;
  let dataFlowEngine: DataFlowEngine;
  let ioPortManager: IOPortManager;
  let orchestrator: AgentOrchestrator;
  let templateRegistry: TemplateRegistry;

  beforeEach(() => {
    containerManager = new ContainerManager();
    dataFlowEngine = new DataFlowEngine(containerManager);
    ioPortManager = new IOPortManager(containerManager);
    orchestrator = new AgentOrchestrator(containerManager, dataFlowEngine, {
      maxConcurrentAgents: 5,
    });
    templateRegistry = new TemplateRegistry(containerManager, ioPortManager, dataFlowEngine);
  });

  it('should instantiate multi-agent-review template and run collaboration', async () => {
    const instance = templateRegistry.instantiate('preset_multi-agent-review', 0, 0);
    expect(instance).not.toBeNull();
    expect(instance!.containerIds).toHaveLength(5);

    const containers = containerManager.getAllContainers();
    const reviewers = containers.filter(c => c.title?.includes('Reviewer'));
    expect(reviewers).toHaveLength(3);

    for (const reviewer of reviewers) {
      const agentId = reviewer.agentBinding!.agentId!;
      await orchestrator.startAgent(agentId, reviewer.id);
    }
    expect(orchestrator.runningCount).toBe(3);

    const session = orchestrator.session;
    session.broadcast(reviewers[0]!.agentBinding!.agentId!, 'review:start', { content: 'Sample text' });
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.type).toBe('broadcast');

    for (const reviewer of reviewers) {
      const agentId = reviewer.agentBinding!.agentId!;
      orchestrator.completeAgent(agentId);
    }
    expect(orchestrator.runningCount).toBe(0);
  });

  it('should handle image-generation pipeline end-to-end', async () => {
    const instance = templateRegistry.instantiate('preset_image-generation-pipeline', 100, 100);
    expect(instance).not.toBeNull();

    const containers = containerManager.getAllContainers();
    const promptGen = containers.find(c => c.title === 'Prompt Generator')!;
    const imgRenderer = containers.find(c => c.title === 'Image Renderer')!;

    dataFlowEngine.register(promptGen.id, async (inputs, ctx, emit) => {
      emit(promptGen.ioPorts.find(p => p.direction === 'output')!.id, {
        type: 'prompt',
        template: 'A beautiful sunset over mountains',
        vars: { style: 'photorealistic' },
      });
    });

    dataFlowEngine.register(imgRenderer.id, async (inputs, ctx, emit) => {
      emit(imgRenderer.ioPorts.find(p => p.direction === 'output')!.id, {
        type: 'image',
        url: 'https://cdn.example.com/generated.png',
        width: 1024,
        height: 1024,
      });
    });

    await orchestrator.startAgent('prompt-agent', promptGen.id);
    await orchestrator.startAgent('render-agent', imgRenderer.id);

    const result = await dataFlowEngine.pull(imgRenderer.id);
    const outputPort = imgRenderer.ioPorts.find(p => p.direction === 'output')!;
    expect(result[outputPort.id]).toBeDefined();
    expect((result[outputPort.id] as any).type).toBe('image');

    orchestrator.completeAgent('prompt-agent');
    orchestrator.completeAgent('render-agent');
  });

  it('should enforce throttling with multiple agents', async () => {
    const throttler = new AgentThrottler({ maxConcurrent: 2, timeout: 5000 });

    await throttler.acquire('agent-1');
    await throttler.acquire('agent-2');
    expect(throttler.activeCount).toBe(2);

    let agent3Released = false;
    const p3 = throttler.acquire('agent-3').then(() => { agent3Released = true; });
    expect(throttler.queueLength).toBe(1);

    throttler.release('agent-1');
    await p3;
    expect(agent3Released).toBe(true);
    expect(throttler.activeCount).toBe(2);

    throttler.dispose();
  });

  it('should batch dataflow executions', async () => {
    const c1 = containerManager.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const c2 = containerManager.createContainer({ bounds: { x: 200, y: 0, width: 100, height: 100 } });

    const outPort1 = ioPortManager.addPort({ containerId: c1.id, direction: 'output', dataType: 'text' })!;
    const outPort2 = ioPortManager.addPort({ containerId: c2.id, direction: 'output', dataType: 'text' })!;

    let execCount = 0;
    dataFlowEngine.register(c1.id, async (inputs, ctx, emit) => {
      execCount++;
      emit(outPort1.id, { type: 'text', content: 'c1-output' });
    });
    dataFlowEngine.register(c2.id, async (inputs, ctx, emit) => {
      execCount++;
      emit(outPort2.id, { type: 'text', content: 'c2-output' });
    });

    const batchExecutor = new DataFlowBatchExecutor(dataFlowEngine, { batchWindow: 5 });
    batchExecutor.scheduleMultiple([c1.id, c2.id]);
    await batchExecutor.flush();

    expect(execCount).toBe(2);
    batchExecutor.dispose();
  });

  it('should track incremental rendering with dirty flags', () => {
    const renderer = new IncrementalRenderer(containerManager);

    const c1 = containerManager.createContainer({ bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const c2 = containerManager.createContainer({ bounds: { x: 200, y: 0, width: 100, height: 100 } });

    expect(renderer.isDirty(c1.id)).toBe(true);
    expect(renderer.isDirty(c2.id)).toBe(true);

    renderer.flush();
    expect(renderer.getDirtyIds()).toHaveLength(0);

    containerManager.updateBounds(c1.id, { x: 50 });
    expect(renderer.isDirty(c1.id)).toBe(true);
    expect(renderer.isDirty(c2.id)).toBe(false);

    renderer.dispose();
  });

  it('should handle conflict resolution in collaboration session', async () => {
    const c1 = containerManager.createContainer({ bounds: { x: 0, y: 0, width: 200, height: 200 } });
    containerManager.bindAgent(c1.id, { agentId: 'agent-1', status: 'idle' });

    await orchestrator.startAgent('agent-1', c1.id);
    const op = orchestrator.submitOperation('agent-2', c1.id, 'update', 'node-1', { color: 'blue' });
    expect(op).toBeNull();

    const conflicts = orchestrator.session.getUnresolvedConflicts();
    expect(conflicts).toHaveLength(1);

    orchestrator.session.resolveConflict(conflicts[0]!.id, 'reject');
    expect(orchestrator.session.getUnresolvedConflicts()).toHaveLength(0);
  });

  it('should save and re-instantiate custom template', () => {
    const c1 = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 200, height: 150 },
      label: 'Step 1',
      role: ['task', 'dataflow'],
    });
    ioPortManager.addPort({ containerId: c1.id, direction: 'output', dataType: 'text' });

    const c2 = containerManager.createContainer({
      bounds: { x: 300, y: 0, width: 200, height: 150 },
      label: 'Step 2',
      role: ['task', 'dataflow'],
    });
    ioPortManager.addPort({ containerId: c2.id, direction: 'input', dataType: 'text' });
    ioPortManager.addPort({ containerId: c2.id, direction: 'output', dataType: 'json' });

    const saved = templateRegistry.saveFromContainers([c1.id, c2.id], 'My Pipeline', 'Custom 2-step', 'custom');
    expect(saved).not.toBeNull();
    expect(saved!.nodes).toHaveLength(2);

    containerManager.removeContainer(c1.id);
    containerManager.removeContainer(c2.id);
    expect(containerManager.getAllContainers()).toHaveLength(0);

    const instance = templateRegistry.instantiate(saved!.id, 500, 500);
    expect(instance).not.toBeNull();
    expect(containerManager.getAllContainers()).toHaveLength(2);

    const newContainers = containerManager.getAllContainers();
    expect(newContainers[0]!.bounds.x).toBe(500);
    expect(newContainers[1]!.bounds.x).toBe(800);
  });
});
