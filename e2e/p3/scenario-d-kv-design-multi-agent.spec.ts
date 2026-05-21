import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerManager } from '../../packages/container/src/container-manager.js';
import { DataFlowEngine } from '../../packages/container/src/dataflow/dataflow-engine.js';
import { IOPortManager } from '../../packages/container/src/io-port-manager.js';
import { AgentOrchestrator } from '../../packages/container/src/collaboration/agent-orchestrator.js';
import { TemplateRegistry } from '../../packages/container/src/templates/template-registry.js';
import { AgentThrottler } from '../../packages/container/src/performance/agent-throttler.js';
import { DataFlowBatchExecutor } from '../../packages/container/src/performance/dataflow-batch-executor.js';
import type { DataFlowEdge } from '../../packages/container/src/dataflow/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots/p3/scenario-d');

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function saveScreenshot(name: string, data: Record<string, unknown>) {
  ensureScreenshotDir();
  const filePath = path.join(SCREENSHOT_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('P3 E2E Scenario D: 活动KV视觉设计多Agent协作生成', () => {
  let containerManager: ContainerManager;
  let dataFlowEngine: DataFlowEngine;
  let ioPortManager: IOPortManager;
  let orchestrator: AgentOrchestrator;
  let templateRegistry: TemplateRegistry;

  const AGENT_ROLES = {
    style: { id: 'style-agent', label: '风格定义Agent', role: 'designer' as const },
    layout: { id: 'layout-agent', label: '排版布局Agent', role: 'designer' as const },
    typography: { id: 'typography-agent', label: '字体设计Agent', role: 'designer' as const },
    color: { id: 'color-agent', label: '色彩搭配Agent', role: 'designer' as const },
    director: { id: 'director-agent', label: '总监审核Agent', role: 'reviewer' as const },
  };

  beforeEach(() => {
    containerManager = new ContainerManager();
    dataFlowEngine = new DataFlowEngine(containerManager);
    ioPortManager = new IOPortManager(containerManager);
    orchestrator = new AgentOrchestrator(containerManager, dataFlowEngine, {
      maxConcurrentAgents: 5,
    });
    templateRegistry = new TemplateRegistry(containerManager, ioPortManager, dataFlowEngine);
  });

  it('D1: 创建5个ContainerNode，分别对应5个Agent角色', () => {
    const styleContainer = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 280, height: 180 },
      label: AGENT_ROLES.style.label,
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(styleContainer.id, {
      agentId: AGENT_ROLES.style.id,
      agentType: 'designer',
      role: 'designer',
      status: 'idle',
      permissions: ['read', 'write'],
    });

    const layoutContainer = containerManager.createContainer({
      bounds: { x: 0, y: 220, width: 280, height: 180 },
      label: AGENT_ROLES.layout.label,
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(layoutContainer.id, {
      agentId: AGENT_ROLES.layout.id,
      agentType: 'designer',
      role: 'designer',
      status: 'idle',
      permissions: ['read', 'write'],
    });

    const typographyContainer = containerManager.createContainer({
      bounds: { x: 0, y: 440, width: 280, height: 180 },
      label: AGENT_ROLES.typography.label,
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(typographyContainer.id, {
      agentId: AGENT_ROLES.typography.id,
      agentType: 'designer',
      role: 'designer',
      status: 'idle',
      permissions: ['read', 'write'],
    });

    const colorContainer = containerManager.createContainer({
      bounds: { x: 0, y: 660, width: 280, height: 180 },
      label: AGENT_ROLES.color.label,
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(colorContainer.id, {
      agentId: AGENT_ROLES.color.id,
      agentType: 'designer',
      role: 'designer',
      status: 'idle',
      permissions: ['read', 'write'],
    });

    const directorContainer = containerManager.createContainer({
      bounds: { x: 400, y: 300, width: 320, height: 240 },
      label: AGENT_ROLES.director.label,
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorContainer.id, {
      agentId: AGENT_ROLES.director.id,
      agentType: 'critic',
      role: 'reviewer',
      status: 'idle',
      permissions: ['read', 'write'],
    });

    const allContainers = containerManager.getAllContainers();
    expect(allContainers).toHaveLength(5);

    const agentBindings = allContainers.map(c => c.agentBinding);
    expect(agentBindings.every(b => b !== undefined)).toBe(true);
    expect(agentBindings.map(b => b!.agentId)).toEqual(
      expect.arrayContaining([
        'style-agent', 'layout-agent', 'typography-agent', 'color-agent', 'director-agent',
      ])
    );

    const designerAgents = allContainers.filter(c => c.agentBinding?.role === 'designer');
    expect(designerAgents).toHaveLength(4);

    const reviewerAgents = allContainers.filter(c => c.agentBinding?.role === 'reviewer');
    expect(reviewerAgents).toHaveLength(1);

    saveScreenshot('d1-five-agent-containers-created', {
      step: 'D1',
      description: '5个Agent容器创建完成',
      containers: allContainers.map(c => ({
        id: c.id,
        label: c.style?.label,
        agentId: c.agentBinding?.agentId,
        role: c.agentBinding?.role,
        bounds: c.bounds,
      })),
    });
  });

  it('D2: 风格/排版/字体/色彩4个Agent并行运行，验证并发调度（限流≤5）', async () => {
    const containers = Object.values(AGENT_ROLES).map((agent, idx) => {
      const c = containerManager.createContainer({
        bounds: { x: idx * 300, y: 0, width: 280, height: 180 },
        label: agent.label,
        role: ['task', 'dataflow'],
      });
      containerManager.bindAgent(c.id, {
        agentId: agent.id,
        agentType: agent.role === 'reviewer' ? 'critic' : 'designer',
        role: agent.role,
        status: 'idle',
        permissions: ['read', 'write'],
      });
      return c;
    });

    const specialistContainers = containers.slice(0, 4);
    const specialistAgentIds = Object.values(AGENT_ROLES).slice(0, 4).map(a => a.id);

    const startResults = await Promise.all(
      specialistAgentIds.map((agentId, idx) =>
        orchestrator.startAgent(agentId, specialistContainers[idx]!.id)
      )
    );

    expect(startResults.every(r => r === true)).toBe(true);
    expect(orchestrator.runningCount).toBe(4);
    expect(orchestrator.runningCount).toBeLessThanOrEqual(orchestrator.maxConcurrent);

    const throttler = new AgentThrottler({ maxConcurrent: 5, timeout: 5000 });
    const acquireResults = await Promise.all(
      specialistAgentIds.map(id => throttler.acquire(id).then(() => true))
    );
    expect(acquireResults.every(r => r === true)).toBe(true);
    expect(throttler.activeCount).toBe(4);
    expect(throttler.activeCount).toBeLessThanOrEqual(5);

    saveScreenshot('d2-parallel-agents-running', {
      step: 'D2',
      description: '4个专项Agent并行运行，限流≤5',
      runningCount: orchestrator.runningCount,
      maxConcurrent: orchestrator.maxConcurrent,
      activeAgents: orchestrator.getActiveAgents(),
      throttlerActive: throttler.activeCount,
    });

    throttler.dispose();
  });

  it('D3: 4个专项Agent的输出端口全部连线到总监Agent的输入端口，验证广播汇聚机制', () => {
    const styleC = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 280, height: 180 },
      label: '风格定义Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(styleC.id, { agentId: 'style-agent', status: 'idle' });
    const styleOut = ioPortManager.addPort({ containerId: styleC.id, direction: 'output', dataType: 'json', label: 'Style Output' })!;

    const layoutC = containerManager.createContainer({
      bounds: { x: 0, y: 220, width: 280, height: 180 },
      label: '排版布局Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(layoutC.id, { agentId: 'layout-agent', status: 'idle' });
    const layoutOut = ioPortManager.addPort({ containerId: layoutC.id, direction: 'output', dataType: 'json', label: 'Layout Output' })!;

    const typoC = containerManager.createContainer({
      bounds: { x: 0, y: 440, width: 280, height: 180 },
      label: '字体设计Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(typoC.id, { agentId: 'typography-agent', status: 'idle' });
    const typoOut = ioPortManager.addPort({ containerId: typoC.id, direction: 'output', dataType: 'json', label: 'Typography Output' })!;

    const colorC = containerManager.createContainer({
      bounds: { x: 0, y: 660, width: 280, height: 180 },
      label: '色彩搭配Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(colorC.id, { agentId: 'color-agent', status: 'idle' });
    const colorOut = ioPortManager.addPort({ containerId: colorC.id, direction: 'output', dataType: 'json', label: 'Color Output' })!;

    const directorC = containerManager.createContainer({
      bounds: { x: 400, y: 300, width: 320, height: 240 },
      label: '总监审核Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorC.id, { agentId: 'director-agent', status: 'idle' });
    const dirIn1 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Style Input' })!;
    const dirIn2 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Layout Input' })!;
    const dirIn3 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Typography Input' })!;
    const dirIn4 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Color Input' })!;

    const edge1 = dataFlowEngine.addEdge({
      id: 'edge-style-to-director',
      source: { nodeId: styleC.id, portId: styleOut.id },
      target: { nodeId: directorC.id, portId: dirIn1.id },
    });
    const edge2 = dataFlowEngine.addEdge({
      id: 'edge-layout-to-director',
      source: { nodeId: layoutC.id, portId: layoutOut.id },
      target: { nodeId: directorC.id, portId: dirIn2.id },
    });
    const edge3 = dataFlowEngine.addEdge({
      id: 'edge-typo-to-director',
      source: { nodeId: typoC.id, portId: typoOut.id },
      target: { nodeId: directorC.id, portId: dirIn3.id },
    });
    const edge4 = dataFlowEngine.addEdge({
      id: 'edge-color-to-director',
      source: { nodeId: colorC.id, portId: colorOut.id },
      target: { nodeId: directorC.id, portId: dirIn4.id },
    });

    expect(edge1).not.toBeNull();
    expect(edge2).not.toBeNull();
    expect(edge3).not.toBeNull();
    expect(edge4).not.toBeNull();

    const allEdges = dataFlowEngine.getAllEdges();
    expect(allEdges).toHaveLength(4);

    const directorInputEdges = dataFlowEngine.getEdgesForNode(directorC.id);
    expect(directorInputEdges.inputs).toHaveLength(4);

    const sourceNodes = directorInputEdges.inputs.map(e => e.source.nodeId);
    expect(sourceNodes).toEqual(
      expect.arrayContaining([styleC.id, layoutC.id, typoC.id, colorC.id])
    );

    saveScreenshot('d3-broadcast-convergence-edges', {
      step: 'D3',
      description: '4个专项Agent输出端口全部连线到总监Agent输入端口',
      edges: allEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        status: e.status,
      })),
      directorInputCount: directorInputEdges.inputs.length,
    });
  });

  it('D4: 总监Agent通过AgentCollabSession发起整合，验证消息流（request→response链路）', async () => {
    const styleC = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 280, height: 180 },
      label: '风格定义Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(styleC.id, { agentId: 'style-agent', status: 'idle' });

    const layoutC = containerManager.createContainer({
      bounds: { x: 0, y: 220, width: 280, height: 180 },
      label: '排版布局Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(layoutC.id, { agentId: 'layout-agent', status: 'idle' });

    const typoC = containerManager.createContainer({
      bounds: { x: 0, y: 440, width: 280, height: 180 },
      label: '字体设计Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(typoC.id, { agentId: 'typography-agent', status: 'idle' });

    const colorC = containerManager.createContainer({
      bounds: { x: 0, y: 660, width: 280, height: 180 },
      label: '色彩搭配Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(colorC.id, { agentId: 'color-agent', status: 'idle' });

    const directorC = containerManager.createContainer({
      bounds: { x: 400, y: 300, width: 320, height: 240 },
      label: '总监审核Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorC.id, { agentId: 'director-agent', status: 'idle' });

    await orchestrator.startAgent('style-agent', styleC.id);
    await orchestrator.startAgent('layout-agent', layoutC.id);
    await orchestrator.startAgent('typography-agent', typoC.id);
    await orchestrator.startAgent('color-agent', colorC.id);
    await orchestrator.startAgent('director-agent', directorC.id);

    expect(orchestrator.runningCount).toBe(5);

    const session = orchestrator.session;

    const requestMsg = session.sendMessage(
      'director-agent',
      '*',
      'integration:request',
      { action: 'submit-design-outputs', theme: '春日活动KV' }
    );
    expect(requestMsg.type).toBe('broadcast');
    expect(requestMsg.from).toBe('director-agent');

    const styleResponse = session.respond(
      'style-agent',
      'director-agent',
      'integration:response',
      { style: '治愈风', palette: 'warm-pastel', mood: '温馨舒适' },
      requestMsg.id
    );
    expect(styleResponse.type).toBe('response');
    expect(styleResponse.correlationId).toBe(requestMsg.id);

    const layoutResponse = session.respond(
      'layout-agent',
      'director-agent',
      'integration:response',
      { layout: 'center-focus', whitespace: '30%', hierarchy: ['title', 'visual', 'cta'] },
      requestMsg.id
    );

    const typoResponse = session.respond(
      'typography-agent',
      'director-agent',
      'integration:response',
      { mainFont: 'PingFang SC', titleSize: 72, bodySize: 14, weight: 'bold' },
      requestMsg.id
    );

    const colorResponse = session.respond(
      'color-agent',
      'director-agent',
      'integration:response',
      { primary: '#FF6B9D', secondary: '#C084FC', accent: '#FCD34D', background: '#FFF7ED' },
      requestMsg.id
    );

    const allMessages = session.messages;
    expect(allMessages).toHaveLength(5);

    const responses = allMessages.filter(m => m.type === 'response');
    expect(responses).toHaveLength(4);
    expect(responses.every(r => r.correlationId === requestMsg.id)).toBe(true);
    expect(responses.every(r => r.to === 'director-agent')).toBe(true);

    const directorMessages = session.getMessagesForAgent('director-agent');
    expect(directorMessages.length).toBeGreaterThanOrEqual(5);

    saveScreenshot('d4-collab-session-messages', {
      step: 'D4',
      description: '总监Agent通过AgentCollabSession发起整合，request→response链路验证',
      sessionId: session.id,
      totalMessages: allMessages.length,
      requestMessage: { id: requestMsg.id, type: requestMsg.type, topic: requestMsg.topic },
      responses: responses.map(r => ({
        from: r.from,
        topic: r.topic,
        correlationId: r.correlationId,
      })),
    });
  });

  it('D5: 整合结果触发AI生图节点，DataFlowEdge状态机 idle→flowing→completed', async () => {
    const directorC = containerManager.createContainer({
      bounds: { x: 400, y: 300, width: 320, height: 240 },
      label: '总监审核Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorC.id, { agentId: 'director-agent', status: 'idle' });
    const directorOut = ioPortManager.addPort({
      containerId: directorC.id,
      direction: 'output',
      dataType: 'json',
      label: 'Integrated Design Spec',
    })!;

    const imageGenC = containerManager.createContainer({
      bounds: { x: 800, y: 300, width: 320, height: 240 },
      label: 'AI生图节点',
      role: ['visual', 'task', 'dataflow'],
    });
    containerManager.bindAgent(imageGenC.id, { agentId: 'imagegen-agent', status: 'idle' });
    const imageGenIn = ioPortManager.addPort({
      containerId: imageGenC.id,
      direction: 'input',
      dataType: 'json',
      label: 'Design Spec Input',
    })!;
    const imageGenOut = ioPortManager.addPort({
      containerId: imageGenC.id,
      direction: 'output',
      dataType: 'image',
      label: 'Generated KV Image',
    })!;

    const edge = dataFlowEngine.addEdge({
      id: 'edge-director-to-imagegen',
      source: { nodeId: directorC.id, portId: directorOut.id },
      target: { nodeId: imageGenC.id, portId: imageGenIn.id },
    })!;
    expect(edge).not.toBeNull();
    expect(edge.status).toBe('idle');

    const edgeStatusTransitions: Array<{ id: string; status: string; timestamp: number }> = [];
    dataFlowEngine.on('edge:status', (id, status) => {
      edgeStatusTransitions.push({ id, status, timestamp: Date.now() });
    });

    dataFlowEngine.register(directorC.id, async (_inputs, _ctx, emit) => {
      emit(directorOut.id, {
        type: 'json',
        value: {
          theme: '春日活动KV',
          style: '治愈风',
          layout: 'center-focus',
          typography: { font: 'PingFang SC', size: 72 },
          colors: { primary: '#FF6B9D', secondary: '#C084FC' },
        },
      });
    });

    dataFlowEngine.register(imageGenC.id, async (inputs, _ctx, emit) => {
      const designSpec = inputs[imageGenIn.id];
      expect(designSpec).toBeDefined();
      expect(designSpec!.type).toBe('json');

      emit(imageGenOut.id, {
        type: 'image',
        url: 'https://cdn.example.com/kv-spring-event-final.png',
        width: 1920,
        height: 1080,
      });
    });

    const result = await dataFlowEngine.pull(imageGenC.id);
    expect(result[imageGenOut.id]).toBeDefined();
    expect((result[imageGenOut.id] as any).type).toBe('image');
    expect((result[imageGenOut.id] as any).url).toContain('kv-spring-event-final');

    expect(edgeStatusTransitions.length).toBeGreaterThanOrEqual(2);
    const flowingTransition = edgeStatusTransitions.find(t => t.status === 'flowing');
    const idleTransition = edgeStatusTransitions.filter(t => t.status === 'idle');
    expect(flowingTransition).toBeDefined();
    expect(idleTransition.length).toBeGreaterThanOrEqual(1);

    const currentEdge = dataFlowEngine.getEdge('edge-director-to-imagegen')!;
    expect(currentEdge.status).toBe('idle');

    saveScreenshot('d5-dataflow-edge-state-machine', {
      step: 'D5',
      description: 'DataFlowEdge状态机 idle→flowing→completed(idle)',
      edgeId: edge.id,
      stateTransitions: edgeStatusTransitions,
      finalImageResult: result[imageGenOut.id],
    });
  });

  it('D6: 打分节点验证：多维度评分，合格标记completed，不合格触发feedback回流', async () => {
    const imageGenC = containerManager.createContainer({
      bounds: { x: 800, y: 300, width: 320, height: 240 },
      label: 'AI生图节点',
      role: ['visual', 'task', 'dataflow'],
    });
    containerManager.bindAgent(imageGenC.id, { agentId: 'imagegen-agent', status: 'idle' });
    const imageOut = ioPortManager.addPort({
      containerId: imageGenC.id,
      direction: 'output',
      dataType: 'json',
      label: 'Generated Result',
    })!;

    const scoringC = containerManager.createContainer({
      bounds: { x: 1200, y: 300, width: 320, height: 240 },
      label: '评分容器',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(scoringC.id, { agentId: 'scoring-agent', status: 'idle' });
    const scoringIn = ioPortManager.addPort({
      containerId: scoringC.id,
      direction: 'input',
      dataType: 'json',
      label: 'Image to Score',
    })!;
    const scoringOut = ioPortManager.addPort({
      containerId: scoringC.id,
      direction: 'output',
      dataType: 'json',
      label: 'Score Result',
    })!;

    dataFlowEngine.addEdge({
      id: 'edge-imagegen-to-scoring',
      source: { nodeId: imageGenC.id, portId: imageOut.id },
      target: { nodeId: scoringC.id, portId: scoringIn.id },
    });

    const PASS_THRESHOLD = 70;

    const scoringDimensions = ['styleMatch', 'visualUnity', 'themeRelevance', 'detailCompleteness'] as const;

    dataFlowEngine.register(imageGenC.id, async (_inputs, _ctx, emit) => {
      emit(imageOut.id, {
        type: 'json',
        value: {
          imageUrl: 'https://cdn.example.com/kv-v1.png',
          metadata: { theme: '春日活动', style: '治愈风' },
        },
      });
    });

    let scoringResult: Record<string, number> = {};
    let overallScore = 0;
    let passed = false;

    dataFlowEngine.register(scoringC.id, async (inputs, _ctx, emit) => {
      const imageData = inputs[scoringIn.id];
      expect(imageData).toBeDefined();

      scoringResult = {
        styleMatch: 85,
        visualUnity: 78,
        themeRelevance: 92,
        detailCompleteness: 80,
      };
      overallScore = Object.values(scoringResult).reduce((a, b) => a + b, 0) / scoringDimensions.length;
      passed = overallScore >= PASS_THRESHOLD;

      emit(scoringOut.id, {
        type: 'json',
        value: {
          scores: scoringResult,
          overallScore,
          passed,
          status: passed ? 'completed' : 'feedback',
        },
      });
    });

    const result = await dataFlowEngine.pull(scoringC.id);
    const scoreOutput = result[scoringOut.id] as any;
    expect(scoreOutput.type).toBe('json');
    expect(scoreOutput.value.passed).toBe(true);
    expect(scoreOutput.value.overallScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(scoreOutput.value.status).toBe('completed');

    for (const dim of scoringDimensions) {
      expect(scoreOutput.value.scores[dim]).toBeGreaterThanOrEqual(0);
      expect(scoreOutput.value.scores[dim]).toBeLessThanOrEqual(100);
    }

    await orchestrator.startAgent('scoring-agent', scoringC.id);
    containerManager.updateAgentStatus(scoringC.id, 'completed');
    const scoringContainer = containerManager.getContainer(scoringC.id)!;
    expect(scoringContainer.agentBinding!.status).toBe('completed');

    dataFlowEngine.clearAllCaches();

    let failedScoringResult: Record<string, number> = {};
    let failedOverall = 0;
    dataFlowEngine.register(scoringC.id, async (inputs, _ctx, emit) => {
      failedScoringResult = {
        styleMatch: 45,
        visualUnity: 50,
        themeRelevance: 60,
        detailCompleteness: 40,
      };
      failedOverall = Object.values(failedScoringResult).reduce((a, b) => a + b, 0) / scoringDimensions.length;
      const failPassed = failedOverall >= PASS_THRESHOLD;

      emit(scoringOut.id, {
        type: 'json',
        value: {
          scores: failedScoringResult,
          overallScore: failedOverall,
          passed: failPassed,
          status: failPassed ? 'completed' : 'feedback',
          feedbackTarget: !failPassed ? 'style-agent' : undefined,
        },
      });
    });

    const failResult = await dataFlowEngine.pull(scoringC.id);
    const failOutput = failResult[scoringOut.id] as any;
    expect(failOutput.value.passed).toBe(false);
    expect(failOutput.value.status).toBe('feedback');
    expect(failOutput.value.feedbackTarget).toBe('style-agent');

    saveScreenshot('d6-scoring-pass-and-fail', {
      step: 'D6',
      description: '打分节点多维度评分验证，合格→completed，不合格→feedback回流',
      passCase: {
        scores: scoringResult,
        overallScore,
        passed: true,
        status: 'completed',
      },
      failCase: {
        scores: failedScoringResult,
        overallScore: failedOverall,
        passed: false,
        status: 'feedback',
        feedbackTarget: 'style-agent',
      },
      threshold: PASS_THRESHOLD,
    });
  });

  it('D7: 不合格时回流路径：评分容器→对应专项Agent容器，形成重新优化循环', async () => {
    const styleC = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 280, height: 180 },
      label: '风格定义Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(styleC.id, { agentId: 'style-agent', status: 'idle' });
    const styleIn = ioPortManager.addPort({ containerId: styleC.id, direction: 'input', dataType: 'json', label: 'Feedback Input' })!;
    const styleOut = ioPortManager.addPort({ containerId: styleC.id, direction: 'output', dataType: 'json', label: 'Style Output' })!;

    const directorC = containerManager.createContainer({
      bounds: { x: 400, y: 0, width: 320, height: 240 },
      label: '总监审核Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorC.id, { agentId: 'director-agent', status: 'idle' });
    const directorIn = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Style Input' })!;
    const directorOut = ioPortManager.addPort({ containerId: directorC.id, direction: 'output', dataType: 'json', label: 'Integrated Output' })!;

    const imageGenC = containerManager.createContainer({
      bounds: { x: 800, y: 0, width: 320, height: 240 },
      label: 'AI生图节点',
      role: ['visual', 'task', 'dataflow'],
    });
    containerManager.bindAgent(imageGenC.id, { agentId: 'imagegen-agent', status: 'idle' });
    const imageGenIn = ioPortManager.addPort({ containerId: imageGenC.id, direction: 'input', dataType: 'json', label: 'Design Input' })!;
    const imageGenOut = ioPortManager.addPort({ containerId: imageGenC.id, direction: 'output', dataType: 'json', label: 'Image Output' })!;

    const scoringC = containerManager.createContainer({
      bounds: { x: 1200, y: 0, width: 320, height: 240 },
      label: '评分容器',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(scoringC.id, { agentId: 'scoring-agent', status: 'idle' });
    const scoringIn = ioPortManager.addPort({ containerId: scoringC.id, direction: 'input', dataType: 'json', label: 'Image Input' })!;
    const scoringOut = ioPortManager.addPort({ containerId: scoringC.id, direction: 'output', dataType: 'json', label: 'Score Output' })!;

    dataFlowEngine.addEdge({
      id: 'edge-style-to-director',
      source: { nodeId: styleC.id, portId: styleOut.id },
      target: { nodeId: directorC.id, portId: directorIn.id },
    });
    dataFlowEngine.addEdge({
      id: 'edge-director-to-imagegen',
      source: { nodeId: directorC.id, portId: directorOut.id },
      target: { nodeId: imageGenC.id, portId: imageGenIn.id },
    });
    dataFlowEngine.addEdge({
      id: 'edge-imagegen-to-scoring',
      source: { nodeId: imageGenC.id, portId: imageGenOut.id },
      target: { nodeId: scoringC.id, portId: scoringIn.id },
    });

    let iterationCount = 0;
    const MAX_ITERATIONS = 3;
    const iterationLog: Array<{ iteration: number; score: number; passed: boolean }> = [];

    dataFlowEngine.register(styleC.id, async (_inputs, _ctx, emit) => {
      const styleVariants = ['治愈风-V1', '治愈风-V2-优化色温', '治愈风-V3-强化主题'];
      emit(styleOut.id, {
        type: 'json',
        value: {
          style: styleVariants[Math.min(iterationCount, styleVariants.length - 1)],
          iteration: iterationCount,
        },
      });
    });

    dataFlowEngine.register(directorC.id, async (inputs, _ctx, emit) => {
      const styleData = inputs[directorIn.id];
      emit(directorOut.id, {
        type: 'json',
        value: { integrated: true, styleSpec: (styleData as any)?.value, iteration: iterationCount },
      });
    });

    dataFlowEngine.register(imageGenC.id, async (inputs, _ctx, emit) => {
      emit(imageGenOut.id, {
        type: 'json',
        value: {
          imageUrl: `https://cdn.example.com/kv-iter-${iterationCount}.png`,
          iteration: iterationCount,
        },
      });
    });

    dataFlowEngine.register(scoringC.id, async (inputs, _ctx, emit) => {
      const baseScore = 50 + iterationCount * 15;
      const score = Math.min(baseScore, 90);
      const passed = score >= 70;

      iterationLog.push({ iteration: iterationCount, score, passed });

      emit(scoringOut.id, {
        type: 'json',
        value: {
          overallScore: score,
          passed,
          status: passed ? 'completed' : 'feedback',
          iteration: iterationCount,
        },
      });
    });

    let finalPassed = false;
    while (!finalPassed && iterationCount < MAX_ITERATIONS) {
      dataFlowEngine.clearAllCaches();
      const result = await dataFlowEngine.pull(scoringC.id);
      const scoreOutput = result[scoringOut.id] as any;

      if (scoreOutput.value.passed) {
        finalPassed = true;
        containerManager.updateAgentStatus(scoringC.id, 'completed');
      } else {
        containerManager.updateAgentStatus(styleC.id, 'running');
        iterationCount++;
        containerManager.updateAgentStatus(styleC.id, 'completed');
      }
    }

    expect(finalPassed).toBe(true);
    expect(iterationCount).toBeLessThan(MAX_ITERATIONS);
    expect(iterationLog.length).toBeGreaterThan(1);

    const lastLog = iterationLog[iterationLog.length - 1]!;
    expect(lastLog.passed).toBe(true);
    expect(lastLog.score).toBeGreaterThanOrEqual(70);

    const scoringContainer = containerManager.getContainer(scoringC.id)!;
    expect(scoringContainer.agentBinding!.status).toBe('completed');

    saveScreenshot('d7-feedback-loop-iterations', {
      step: 'D7',
      description: '不合格时回流路径验证，评分容器→专项Agent重新优化循环',
      iterations: iterationLog,
      totalIterations: iterationCount + 1,
      maxAllowed: MAX_ITERATIONS,
      finalStatus: 'completed',
      noDeadLoop: true,
    });
  });

  it('D8: 全流程端到端集成测试 + 截图', { timeout: 15000 }, async () => {
    orchestrator = new AgentOrchestrator(containerManager, dataFlowEngine, {
      maxConcurrentAgents: 7,
    });
    const styleC = containerManager.createContainer({
      bounds: { x: 0, y: 0, width: 280, height: 180 },
      label: '风格定义Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(styleC.id, { agentId: 'style-agent', agentType: 'designer', role: 'designer', status: 'idle', permissions: ['read', 'write'] });
    const styleOut = ioPortManager.addPort({ containerId: styleC.id, direction: 'output', dataType: 'json', label: 'Style Output' })!;

    const layoutC = containerManager.createContainer({
      bounds: { x: 0, y: 220, width: 280, height: 180 },
      label: '排版布局Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(layoutC.id, { agentId: 'layout-agent', agentType: 'designer', role: 'designer', status: 'idle', permissions: ['read', 'write'] });
    const layoutOut = ioPortManager.addPort({ containerId: layoutC.id, direction: 'output', dataType: 'json', label: 'Layout Output' })!;

    const typoC = containerManager.createContainer({
      bounds: { x: 0, y: 440, width: 280, height: 180 },
      label: '字体设计Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(typoC.id, { agentId: 'typography-agent', agentType: 'designer', role: 'designer', status: 'idle', permissions: ['read', 'write'] });
    const typoOut = ioPortManager.addPort({ containerId: typoC.id, direction: 'output', dataType: 'json', label: 'Typography Output' })!;

    const colorC = containerManager.createContainer({
      bounds: { x: 0, y: 660, width: 280, height: 180 },
      label: '色彩搭配Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(colorC.id, { agentId: 'color-agent', agentType: 'designer', role: 'designer', status: 'idle', permissions: ['read', 'write'] });
    const colorOut = ioPortManager.addPort({ containerId: colorC.id, direction: 'output', dataType: 'json', label: 'Color Output' })!;

    const directorC = containerManager.createContainer({
      bounds: { x: 400, y: 300, width: 320, height: 240 },
      label: '总监审核Agent',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(directorC.id, { agentId: 'director-agent', agentType: 'critic', role: 'reviewer', status: 'idle', permissions: ['read', 'write'] });
    const dirIn1 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Style In' })!;
    const dirIn2 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Layout In' })!;
    const dirIn3 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Typography In' })!;
    const dirIn4 = ioPortManager.addPort({ containerId: directorC.id, direction: 'input', dataType: 'json', label: 'Color In' })!;
    const directorOut = ioPortManager.addPort({ containerId: directorC.id, direction: 'output', dataType: 'json', label: 'Integrated Spec' })!;

    const imageGenC = containerManager.createContainer({
      bounds: { x: 800, y: 300, width: 320, height: 240 },
      label: 'AI生图节点',
      role: ['visual', 'task', 'dataflow'],
    });
    containerManager.bindAgent(imageGenC.id, { agentId: 'imagegen-agent', agentType: 'designer', role: 'designer', status: 'idle', permissions: ['read', 'write'] });
    const imageGenIn = ioPortManager.addPort({ containerId: imageGenC.id, direction: 'input', dataType: 'json', label: 'Design Spec' })!;
    const imageGenOut = ioPortManager.addPort({ containerId: imageGenC.id, direction: 'output', dataType: 'json', label: 'KV Image' })!;

    const scoringC = containerManager.createContainer({
      bounds: { x: 1200, y: 300, width: 320, height: 240 },
      label: '评分容器',
      role: ['task', 'dataflow'],
    });
    containerManager.bindAgent(scoringC.id, { agentId: 'scoring-agent', agentType: 'critic', role: 'reviewer', status: 'idle', permissions: ['read', 'write'] });
    const scoringIn = ioPortManager.addPort({ containerId: scoringC.id, direction: 'input', dataType: 'json', label: 'Image Input' })!;
    const scoringOut = ioPortManager.addPort({ containerId: scoringC.id, direction: 'output', dataType: 'json', label: 'Final Score' })!;

    dataFlowEngine.addEdge({ id: 'e-style-dir', source: { nodeId: styleC.id, portId: styleOut.id }, target: { nodeId: directorC.id, portId: dirIn1.id } });
    dataFlowEngine.addEdge({ id: 'e-layout-dir', source: { nodeId: layoutC.id, portId: layoutOut.id }, target: { nodeId: directorC.id, portId: dirIn2.id } });
    dataFlowEngine.addEdge({ id: 'e-typo-dir', source: { nodeId: typoC.id, portId: typoOut.id }, target: { nodeId: directorC.id, portId: dirIn3.id } });
    dataFlowEngine.addEdge({ id: 'e-color-dir', source: { nodeId: colorC.id, portId: colorOut.id }, target: { nodeId: directorC.id, portId: dirIn4.id } });
    dataFlowEngine.addEdge({ id: 'e-dir-gen', source: { nodeId: directorC.id, portId: directorOut.id }, target: { nodeId: imageGenC.id, portId: imageGenIn.id } });
    dataFlowEngine.addEdge({ id: 'e-gen-score', source: { nodeId: imageGenC.id, portId: imageGenOut.id }, target: { nodeId: scoringC.id, portId: scoringIn.id } });

    expect(dataFlowEngine.getAllEdges()).toHaveLength(6);

    saveScreenshot('d8-step1-graph-topology', {
      step: 'D8-1',
      description: '全流程图拓扑构建完成',
      containers: containerManager.getAllContainers().map(c => ({ id: c.id, label: c.style?.label, agent: c.agentBinding?.agentId })),
      edges: dataFlowEngine.getAllEdges().map(e => ({ id: e.id, from: e.source, to: e.target })),
    });

    const specialistAgents = ['style-agent', 'layout-agent', 'typography-agent', 'color-agent'];
    const specialistContainers = [styleC, layoutC, typoC, colorC];
    await Promise.all(
      specialistAgents.map((agentId, idx) => orchestrator.startAgent(agentId, specialistContainers[idx]!.id))
    );
    await orchestrator.startAgent('director-agent', directorC.id);
    await orchestrator.startAgent('imagegen-agent', imageGenC.id);
    await orchestrator.startAgent('scoring-agent', scoringC.id);

    expect(orchestrator.runningCount).toBe(7);

    saveScreenshot('d8-step2-all-agents-started', {
      step: 'D8-2',
      description: '全部Agent启动运行',
      runningCount: orchestrator.runningCount,
      agents: orchestrator.getActiveAgents(),
    });

    dataFlowEngine.register(styleC.id, async (_inputs, _ctx, emit) => {
      emit(styleOut.id, { type: 'json', value: { style: '科技风', colorTone: 'cool-blue', mood: '未来感' } });
    });
    dataFlowEngine.register(layoutC.id, async (_inputs, _ctx, emit) => {
      emit(layoutOut.id, { type: 'json', value: { layout: 'asymmetric-dynamic', mainFocus: 'center-left', gridType: '12-col' } });
    });
    dataFlowEngine.register(typoC.id, async (_inputs, _ctx, emit) => {
      emit(typoOut.id, { type: 'json', value: { titleFont: 'Noto Sans SC', titleWeight: 900, titleSize: 86, bodyFont: 'Inter' } });
    });
    dataFlowEngine.register(colorC.id, async (_inputs, _ctx, emit) => {
      emit(colorOut.id, { type: 'json', value: { primary: '#0EA5E9', secondary: '#6366F1', accent: '#F59E0B', bg: '#0F172A' } });
    });

    dataFlowEngine.register(directorC.id, async (inputs, _ctx, emit) => {
      const styleData = inputs[dirIn1.id] as any;
      const layoutData = inputs[dirIn2.id] as any;
      const typoData = inputs[dirIn3.id] as any;
      const colorData = inputs[dirIn4.id] as any;

      expect(styleData).toBeDefined();
      expect(layoutData).toBeDefined();
      expect(typoData).toBeDefined();
      expect(colorData).toBeDefined();

      emit(directorOut.id, {
        type: 'json',
        value: {
          integratedSpec: {
            theme: 'Tech Summit 2026 KV',
            style: styleData.value,
            layout: layoutData.value,
            typography: typoData.value,
            colors: colorData.value,
            approved: true,
          },
        },
      });
    });

    dataFlowEngine.register(imageGenC.id, async (inputs, _ctx, emit) => {
      const spec = inputs[imageGenIn.id] as any;
      expect(spec.value.integratedSpec.approved).toBe(true);
      emit(imageGenOut.id, {
        type: 'json',
        value: {
          imageUrl: 'https://cdn.example.com/tech-summit-2026-kv-final.png',
          resolution: '2560x1440',
          format: 'png',
        },
      });
    });

    dataFlowEngine.register(scoringC.id, async (inputs, _ctx, emit) => {
      const imageResult = inputs[scoringIn.id] as any;
      expect(imageResult.value.imageUrl).toContain('tech-summit-2026');

      emit(scoringOut.id, {
        type: 'json',
        value: {
          scores: { styleMatch: 92, visualUnity: 88, themeRelevance: 95, detailCompleteness: 85 },
          overallScore: 90,
          passed: true,
          status: 'completed',
        },
      });
    });

    const finalResult = await dataFlowEngine.pull(scoringC.id);
    const finalScore = finalResult[scoringOut.id] as any;

    expect(finalScore.value.passed).toBe(true);
    expect(finalScore.value.status).toBe('completed');
    expect(finalScore.value.overallScore).toBe(90);
    expect(finalScore.value.scores.styleMatch).toBe(92);
    expect(finalScore.value.scores.visualUnity).toBe(88);
    expect(finalScore.value.scores.themeRelevance).toBe(95);
    expect(finalScore.value.scores.detailCompleteness).toBe(85);

    saveScreenshot('d8-step3-full-pipeline-result', {
      step: 'D8-3',
      description: '全流程执行完成，最终评分结果',
      finalScore: finalScore.value,
      pipelineStatus: 'completed',
    });

    for (const agentId of [...specialistAgents, 'director-agent', 'imagegen-agent', 'scoring-agent']) {
      orchestrator.completeAgent(agentId);
    }
    expect(orchestrator.runningCount).toBe(0);

    const allContainers = containerManager.getAllContainers();
    const completedCount = allContainers.filter(c => c.agentBinding?.status === 'completed').length;

    saveScreenshot('d8-step4-all-agents-completed', {
      step: 'D8-4',
      description: '全部Agent标记completed，流程结束',
      totalContainers: allContainers.length,
      completedAgents: completedCount,
      runningAgents: orchestrator.runningCount,
      finalStatus: 'all-completed',
    });
  });
});
