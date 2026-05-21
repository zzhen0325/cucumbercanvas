import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Agent System</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 280px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; overflow: visible; position: absolute; }
    .container-title { align-items: center; display: flex; font-size: 12px; font-weight: 600; height: 28px; padding: 0 10px; }
    .agent-badge { background: rgba(99,102,241,0.9); border-radius: 999px; color: white; font-size: 10px; padding: 2px 8px; position: absolute; top: -10px; right: 10px; }
    .agent-badge.running { background: rgba(34,197,94,0.9); animation: pulse 1s infinite; }
    .agent-badge.completed { background: rgba(59,130,246,0.9); }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-container" type="button">创建容器</button>
      <button data-testid="btn-bind-agent" type="button">绑定 Agent</button>
      <button data-testid="btn-start-agent" type="button">启动 Agent</button>
      <button data-testid="btn-complete-agent" type="button">完成 Agent</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="container-count">容器数: 0</div>
      <div data-testid="agent-status">Agent: 未绑定</div>
      <div data-testid="agent-context">Context: -</div>
      <div data-testid="event-log">Events: []</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { containers: new Map(), events: [] };

      function createContainer(id) {
        const container = {
          id, bounds: { x: 100, y: 100, width: 260, height: 180 },
          label: 'Agent Container', agentBinding: null,
          contextSlots: { rules: ['Generate detailed image prompts'], tokens: { style: 'flat', resolution: '1024x1024' } },
        };
        state.containers.set(id, container);
        renderStage(); updateSidebar();
        return container;
      }

      function bindAgent(containerId, agentConfig) {
        const c = state.containers.get(containerId);
        if (!c) return null;
        c.agentBinding = { agentId: agentConfig.agentId, agentType: agentConfig.agentType, role: agentConfig.role, status: 'idle', permissions: agentConfig.permissions || ['read','write'] };
        state.events.push({ type: 'agent:bound', containerId, agentId: agentConfig.agentId });
        renderStage(); updateSidebar();
        return c.agentBinding;
      }

      function startAgent(containerId) {
        const c = state.containers.get(containerId);
        if (!c || !c.agentBinding) return;
        c.agentBinding.status = 'running';
        state.events.push({ type: 'agent:start', containerId, agentId: c.agentBinding.agentId });
        renderStage(); updateSidebar();
      }

      function completeAgent(containerId) {
        const c = state.containers.get(containerId);
        if (!c || !c.agentBinding) return;
        c.agentBinding.status = 'completed';
        state.events.push({ type: 'agent:complete', containerId, agentId: c.agentBinding.agentId });
        renderStage(); updateSidebar();
      }

      function buildContext(containerId) {
        const c = state.containers.get(containerId);
        if (!c) return null;
        return { rules: c.contextSlots.rules || [], tokens: c.contextSlots.tokens || {}, containerId, agentId: c.agentBinding?.agentId || null };
      }

      function renderStage() {
        stage.replaceChildren();
        for (const container of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'container-' + container.id);
          node.style.left = container.bounds.x + 'px';
          node.style.top = container.bounds.y + 'px';
          node.style.width = container.bounds.width + 'px';
          node.style.height = container.bounds.height + 'px';
          node.style.background = 'rgba(99,102,241,0.12)';
          node.style.borderColor = '#6366f1';
          const title = document.createElement('div');
          title.className = 'container-title';
          title.textContent = container.label;
          node.appendChild(title);
          if (container.agentBinding) {
            const badge = document.createElement('div');
            badge.className = 'agent-badge ' + container.agentBinding.status;
            badge.setAttribute('data-testid', 'agent-badge-' + container.id);
            badge.textContent = container.agentBinding.role + ' (' + container.agentBinding.status + ')';
            node.appendChild(badge);
          }
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
        const c = [...state.containers.values()][0];
        const status = c?.agentBinding ? c.agentBinding.role + ':' + c.agentBinding.status : '未绑定';
        document.querySelector('[data-testid="agent-status"]').textContent = 'Agent: ' + status;
        const ctx = c ? buildContext(c.id) : null;
        document.querySelector('[data-testid="agent-context"]').textContent = 'Context: ' + (ctx ? JSON.stringify(ctx) : '-');
        document.querySelector('[data-testid="event-log"]').textContent = 'Events: ' + JSON.stringify(state.events.map(e => e.type));
      }

      document.querySelector('[data-testid="btn-create-container"]').addEventListener('click', () => createContainer('agent-host'));
      document.querySelector('[data-testid="btn-bind-agent"]').addEventListener('click', () => bindAgent('agent-host', { agentId: 'designer-001', agentType: 'designer', role: 'designer' }));
      document.querySelector('[data-testid="btn-start-agent"]').addEventListener('click', () => startAgent('agent-host'));
      document.querySelector('[data-testid="btn-complete-agent"]').addEventListener('click', () => completeAgent('agent-host'));

      window.__CUCUMBER_AGENT__ = { getState: () => ({ containers: Object.fromEntries(state.containers), events: state.events }), createContainer, bindAgent, startAgent, completeAgent, buildContext };
      renderStage(); updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("container-count")).toHaveText("容器数: 0");
}

test.describe("TC-009: 绑定 Agent 到容器", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("为容器绑定 Designer Agent", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");
    await expect(page.getByTestId("agent-status")).toHaveText("Agent: 未绑定");

    // 绑定 Agent
    await page.getByTestId("btn-bind-agent").click();

    // 验证 badge 出现
    const badge = page.getByTestId("agent-badge-agent-host");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("designer");
    await expect(badge).toContainText("idle");

    await expect(page.getByTestId("agent-status")).toContainText("designer:idle");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc009-agent-bound.png" });
  });
});

test.describe("TC-010: Agent 状态流转", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("idle → running → completed 完整流转", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-bind-agent").click();

    // idle 状态
    const badge = page.getByTestId("agent-badge-agent-host");
    await expect(badge).toContainText("idle");
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc010-idle.png" });

    // running 状态
    await page.getByTestId("btn-start-agent").click();
    await expect(badge).toContainText("running");
    await expect(badge).toHaveClass(/running/);
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc010-running.png" });

    // completed 状态
    await page.getByTestId("btn-complete-agent").click();
    await expect(badge).toContainText("completed");
    await expect(badge).toHaveClass(/completed/);
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc010-completed.png" });
  });

  test("事件日志正确记录状态变化", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-bind-agent").click();
    await page.getByTestId("btn-start-agent").click();
    await page.getByTestId("btn-complete-agent").click();

    const eventLog = await page.getByTestId("event-log").textContent();
    expect(eventLog).toContain("agent:bound");
    expect(eventLog).toContain("agent:start");
    expect(eventLog).toContain("agent:complete");
  });
});

test.describe("TC-011: AgentContext 注入", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Agent 运行时获取容器上下文", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-bind-agent").click();

    // 验证 context 包含 rules 和 tokens
    const contextText = await page.getByTestId("agent-context").textContent();
    expect(contextText).toContain("Generate detailed image prompts");
    expect(contextText).toContain("flat");
    expect(contextText).toContain("1024x1024");

    // 通过 API 验证 context 结构
    const context = await page.evaluate(() => {
      return (window as any).__CUCUMBER_AGENT__.buildContext('agent-host');
    });
    expect(context.rules).toContain("Generate detailed image prompts");
    expect(context.tokens.style).toBe("flat");
    expect(context.tokens.resolution).toBe("1024x1024");
    expect(context.agentId).toBe("designer-001");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc011-context-injected.png" });
  });
});
