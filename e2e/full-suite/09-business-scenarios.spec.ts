import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Business Scenarios</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 320px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; font-size: 12px; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; position: absolute; padding: 8px; }
    .container-title { font-size: 11px; font-weight: 600; }
    .agent-badge { font-size: 10px; border-radius: 4px; padding: 2px 6px; margin-top: 4px; display: inline-block; }
    .agent-badge.running { background: rgba(34,197,94,0.3); color: #22c55e; }
    .agent-badge.completed { background: rgba(59,130,246,0.3); color: #3b82f6; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-setup-kv-pipeline" type="button">构建 KV 生成管道</button>
      <button data-testid="btn-run-kv-pipeline" type="button">执行 KV 生成</button>
      <button data-testid="btn-setup-image-e2e" type="button">构建图片生成 E2E</button>
      <button data-testid="btn-run-image-e2e" type="button">执行图片生成</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="pipeline-status">Pipeline: 未构建</div>
      <div data-testid="agents-running">Running Agents: 0</div>
      <div data-testid="agents-completed">Completed Agents: 0</div>
      <div data-testid="final-output">Final Output: -</div>
      <div data-testid="execution-timeline">Timeline: []</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { agents: new Map(), timeline: [], finalOutput: null, pipelineType: null };

      function setupKVPipeline() {
        state.pipelineType = 'kv';
        state.agents.clear(); state.timeline = []; state.finalOutput = null;
        const roles = [
          { id: 'style', label: '风格定义Agent', x: 20, y: 20 },
          { id: 'layout', label: '排版布局Agent', x: 20, y: 120 },
          { id: 'typography', label: '字体设计Agent', x: 20, y: 220 },
          { id: 'color', label: '色彩搭配Agent', x: 20, y: 320 },
          { id: 'director', label: '总监审核Agent', x: 350, y: 160 },
        ];
        roles.forEach(r => {
          state.agents.set(r.id, { ...r, status: 'idle', output: null });
        });
        renderStage(); updateSidebar();
      }

      async function runKVPipeline() {
        const designAgents = ['style', 'layout', 'typography', 'color'];
        // Start design agents in parallel
        designAgents.forEach(id => {
          state.agents.get(id).status = 'running';
          state.timeline.push({ time: Date.now(), agent: id, event: 'start' });
        });
        renderStage(); updateSidebar();

        // Simulate parallel work
        await new Promise(r => setTimeout(r, 300));

        // Complete design agents
        designAgents.forEach(id => {
          state.agents.get(id).status = 'completed';
          state.agents.get(id).output = { type: 'design-component', agent: id, score: 85 + Math.floor(Math.random() * 15) };
          state.timeline.push({ time: Date.now(), agent: id, event: 'complete' });
        });
        renderStage(); updateSidebar();

        // Start director
        await new Promise(r => setTimeout(r, 200));
        state.agents.get('director').status = 'running';
        state.timeline.push({ time: Date.now(), agent: 'director', event: 'start' });
        renderStage(); updateSidebar();

        await new Promise(r => setTimeout(r, 200));
        state.agents.get('director').status = 'completed';
        state.agents.get('director').output = { type: 'review-result', approved: true, score: 92 };
        state.timeline.push({ time: Date.now(), agent: 'director', event: 'complete' });
        state.finalOutput = { type: 'kv-design', approved: true, components: designAgents.length, overallScore: 92 };
        renderStage(); updateSidebar();
      }

      function setupImageE2E() {
        state.pipelineType = 'image';
        state.agents.clear(); state.timeline = []; state.finalOutput = null;
        state.agents.set('prompt', { id: 'prompt', label: 'Prompt 优化器', x: 50, y: 100, status: 'idle', output: null });
        state.agents.set('renderer', { id: 'renderer', label: '图片渲染器', x: 380, y: 100, status: 'idle', output: null });
        renderStage(); updateSidebar();
      }

      async function runImageE2E() {
        state.agents.get('prompt').status = 'running';
        state.timeline.push({ time: Date.now(), agent: 'prompt', event: 'start' });
        renderStage(); updateSidebar();

        await new Promise(r => setTimeout(r, 300));
        state.agents.get('prompt').status = 'completed';
        state.agents.get('prompt').output = { type: 'prompt', template: 'A beautiful sunset over mountains', vars: { style: 'photorealistic' } };
        state.timeline.push({ time: Date.now(), agent: 'prompt', event: 'complete' });
        renderStage(); updateSidebar();

        state.agents.get('renderer').status = 'running';
        state.timeline.push({ time: Date.now(), agent: 'renderer', event: 'start' });
        renderStage(); updateSidebar();

        await new Promise(r => setTimeout(r, 300));
        state.agents.get('renderer').status = 'completed';
        state.agents.get('renderer').output = { type: 'image', url: 'https://cdn.example.com/generated-sunset.png', width: 1024, height: 1024 };
        state.timeline.push({ time: Date.now(), agent: 'renderer', event: 'complete' });
        state.finalOutput = { type: 'image', url: 'https://cdn.example.com/generated-sunset.png', width: 1024, height: 1024 };
        renderStage(); updateSidebar();
      }

      function renderStage() {
        stage.replaceChildren();
        for (const agent of state.agents.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'agent-' + agent.id);
          node.style.left = agent.x + 'px'; node.style.top = agent.y + 'px';
          node.style.width = '180px'; node.style.height = '80px';
          node.style.borderColor = agent.status === 'running' ? '#22c55e' : agent.status === 'completed' ? '#3b82f6' : '#475569';
          node.style.background = 'rgba(15,23,42,0.8)';
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = agent.label;
          node.appendChild(title);
          if (agent.status !== 'idle') {
            const badge = document.createElement('div');
            badge.className = 'agent-badge ' + agent.status;
            badge.textContent = agent.status;
            node.appendChild(badge);
          }
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        const running = [...state.agents.values()].filter(a => a.status === 'running').length;
        const completed = [...state.agents.values()].filter(a => a.status === 'completed').length;
        document.querySelector('[data-testid="pipeline-status"]').textContent = 'Pipeline: ' + (state.pipelineType || '未构建');
        document.querySelector('[data-testid="agents-running"]').textContent = 'Running Agents: ' + running;
        document.querySelector('[data-testid="agents-completed"]').textContent = 'Completed Agents: ' + completed;
        document.querySelector('[data-testid="final-output"]').textContent = 'Final Output: ' + (state.finalOutput ? JSON.stringify(state.finalOutput) : '-');
        document.querySelector('[data-testid="execution-timeline"]').textContent = 'Timeline: ' + state.timeline.length + ' events';
      }

      document.querySelector('[data-testid="btn-setup-kv-pipeline"]').addEventListener('click', setupKVPipeline);
      document.querySelector('[data-testid="btn-run-kv-pipeline"]').addEventListener('click', runKVPipeline);
      document.querySelector('[data-testid="btn-setup-image-e2e"]').addEventListener('click', setupImageE2E);
      document.querySelector('[data-testid="btn-run-image-e2e"]').addEventListener('click', runImageE2E);

      window.__CUCUMBER_BUSINESS__ = { getState: () => state };
      updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("pipeline-status")).toHaveText("Pipeline: 未构建");
}

test.describe("TC-027: 活动 KV 生成工作流", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("5 Agent 协作生成 KV 设计", async ({ page }) => {
    await page.getByTestId("btn-setup-kv-pipeline").click();
    await expect(page.getByTestId("pipeline-status")).toHaveText("Pipeline: kv");

    // 验证 5 个 Agent 容器可见
    await expect(page.getByTestId("agent-style")).toBeVisible();
    await expect(page.getByTestId("agent-layout")).toBeVisible();
    await expect(page.getByTestId("agent-typography")).toBeVisible();
    await expect(page.getByTestId("agent-color")).toBeVisible();
    await expect(page.getByTestId("agent-director")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc027-kv-setup.png" });

    // 执行管道
    await page.getByTestId("btn-run-kv-pipeline").click();

    // 验证设计 Agent 先并行
    await expect(page.getByTestId("agents-running")).toHaveText("Running Agents: 4", { timeout: 1000 });

    // 等待全部完成
    await expect(page.getByTestId("agents-completed")).toHaveText("Completed Agents: 5", { timeout: 5000 });

    // 验证最终输出
    const output = await page.getByTestId("final-output").textContent();
    expect(output).toContain("kv-design");
    expect(output).toContain("approved");

    // 验证 timeline
    await expect(page.getByTestId("execution-timeline")).toContainText("10 events");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc027-kv-complete.png" });
  });
});

test.describe("TC-028: 图片生成端到端工作流", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Prompt优化 → 图片渲染完整流程", async ({ page }) => {
    await page.getByTestId("btn-setup-image-e2e").click();
    await expect(page.getByTestId("pipeline-status")).toHaveText("Pipeline: image");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc028-image-setup.png" });

    // 执行
    await page.getByTestId("btn-run-image-e2e").click();

    // prompt agent 先 running
    await expect(page.getByTestId("agents-running")).toHaveText("Running Agents: 1", { timeout: 1000 });

    // 等待全部完成
    await expect(page.getByTestId("agents-completed")).toHaveText("Completed Agents: 2", { timeout: 5000 });

    // 验证最终输出为图片
    const output = await page.getByTestId("final-output").textContent();
    expect(output).toContain("image");
    expect(output).toContain("cdn.example.com");
    expect(output).toContain("1024");

    // 验证 timeline 序列
    const state = await page.evaluate(() => (window as any).__CUCUMBER_BUSINESS__.getState());
    const events = state.timeline.map((e: any) => e.agent + ':' + e.event);
    expect(events).toEqual(['prompt:start', 'prompt:complete', 'renderer:start', 'renderer:complete']);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc028-image-complete.png" });
  });
});
