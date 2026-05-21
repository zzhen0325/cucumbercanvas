import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Multi-Agent Collaboration</title>
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
    .agent-badge.idle { background: rgba(148,163,184,0.3); }
    .agent-badge.running { background: rgba(34,197,94,0.3); color: #22c55e; }
    .agent-badge.completed { background: rgba(59,130,246,0.3); color: #3b82f6; }
    .agent-badge.throttled { background: rgba(251,191,36,0.3); color: #fbbf24; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-5-agents" type="button">创建 5 Agent</button>
      <button data-testid="btn-start-all" type="button">启动全部</button>
      <button data-testid="btn-start-6th" type="button">启动第 6 个</button>
      <button data-testid="btn-broadcast" type="button">广播消息</button>
      <button data-testid="btn-lock-conflict" type="button">模拟锁冲突</button>
      <button data-testid="btn-complete-all" type="button">完成全部</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="running-count">Running: 0</div>
      <div data-testid="throttled-count">Throttled: 0</div>
      <div data-testid="messages-count">Messages: 0</div>
      <div data-testid="lock-events">Lock events: []</div>
      <div data-testid="event-log">Events: []</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const MAX_CONCURRENT = 5;
      const state = {
        agents: new Map(),
        messages: [],
        locks: new Map(),
        lockEvents: [],
        events: [],
        throttledCount: 0,
      };

      function createAgent(id, label, x, y) {
        state.agents.set(id, { id, label, status: 'idle', containerId: id + '-container', bounds: { x, y, width: 180, height: 80 } });
        renderStage(); updateSidebar();
      }

      function startAgent(id) {
        const runningCount = [...state.agents.values()].filter(a => a.status === 'running').length;
        if (runningCount >= MAX_CONCURRENT) {
          state.throttledCount++;
          state.events.push({ type: 'agent:throttled', agentId: id });
          updateSidebar();
          return false;
        }
        const agent = state.agents.get(id);
        if (!agent) return false;
        agent.status = 'running';
        state.events.push({ type: 'agent:start', agentId: id });
        renderStage(); updateSidebar();
        return true;
      }

      function completeAgent(id) {
        const agent = state.agents.get(id);
        if (!agent) return;
        agent.status = 'completed';
        state.events.push({ type: 'agent:complete', agentId: id });
        renderStage(); updateSidebar();
      }

      function broadcast(fromId, type, payload) {
        state.messages.push({ from: fromId, type: 'broadcast', messageType: type, payload, timestamp: Date.now() });
        state.events.push({ type: 'broadcast:output', from: fromId, messageType: type });
        updateSidebar();
      }

      function acquireLock(containerId, agentId) {
        if (state.locks.has(containerId)) {
          const holder = state.locks.get(containerId);
          state.lockEvents.push({ type: 'lock:conflict', containerId, agentId, holderId: holder });
          state.events.push({ type: 'lock:conflict', containerId, agentId, holderId: holder });
          updateSidebar();
          return false;
        }
        state.locks.set(containerId, agentId);
        state.lockEvents.push({ type: 'lock:acquired', containerId, agentId });
        state.events.push({ type: 'lock:acquired', containerId, agentId });
        updateSidebar();
        return true;
      }

      function releaseLock(containerId, agentId) {
        if (state.locks.get(containerId) === agentId) {
          state.locks.delete(containerId);
          state.lockEvents.push({ type: 'lock:released', containerId, agentId });
          state.events.push({ type: 'lock:released', containerId, agentId });
          updateSidebar();
          return true;
        }
        return false;
      }

      function renderStage() {
        stage.replaceChildren();
        for (const agent of state.agents.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'agent-' + agent.id);
          node.style.left = agent.bounds.x + 'px'; node.style.top = agent.bounds.y + 'px';
          node.style.width = agent.bounds.width + 'px'; node.style.height = agent.bounds.height + 'px';
          node.style.borderColor = agent.status === 'running' ? '#22c55e' : agent.status === 'completed' ? '#3b82f6' : '#94a3b8';
          node.style.background = 'rgba(15,23,42,0.8)';
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = agent.label;
          node.appendChild(title);
          const badge = document.createElement('div');
          badge.className = 'agent-badge ' + agent.status;
          badge.textContent = agent.status;
          badge.setAttribute('data-testid', 'badge-' + agent.id);
          node.appendChild(badge);
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        const running = [...state.agents.values()].filter(a => a.status === 'running').length;
        document.querySelector('[data-testid="running-count"]').textContent = 'Running: ' + running;
        document.querySelector('[data-testid="throttled-count"]').textContent = 'Throttled: ' + state.throttledCount;
        document.querySelector('[data-testid="messages-count"]').textContent = 'Messages: ' + state.messages.length;
        document.querySelector('[data-testid="lock-events"]').textContent = 'Lock events: ' + JSON.stringify(state.lockEvents.map(e => e.type));
        document.querySelector('[data-testid="event-log"]').textContent = 'Events: ' + JSON.stringify(state.events.map(e => e.type));
      }

      document.querySelector('[data-testid="btn-create-5-agents"]').addEventListener('click', () => {
        for (let i = 1; i <= 5; i++) createAgent('agent-' + i, 'Agent #' + i, 20 + (i-1) * 200, 60);
      });
      document.querySelector('[data-testid="btn-start-all"]').addEventListener('click', () => {
        for (let i = 1; i <= 5; i++) startAgent('agent-' + i);
      });
      document.querySelector('[data-testid="btn-start-6th"]').addEventListener('click', () => {
        createAgent('agent-6', 'Agent #6 (overflow)', 20, 200);
        startAgent('agent-6');
      });
      document.querySelector('[data-testid="btn-broadcast"]').addEventListener('click', () => {
        broadcast('agent-1', 'review:start', { content: 'Sample text for review' });
      });
      document.querySelector('[data-testid="btn-lock-conflict"]').addEventListener('click', () => {
        acquireLock('shared-container', 'agent-1');
        acquireLock('shared-container', 'agent-2');
        releaseLock('shared-container', 'agent-1');
        acquireLock('shared-container', 'agent-2');
      });
      document.querySelector('[data-testid="btn-complete-all"]').addEventListener('click', () => {
        for (const agent of state.agents.values()) { if (agent.status === 'running') completeAgent(agent.id); }
      });

      window.__CUCUMBER_COLLAB__ = { getState: () => state, createAgent, startAgent, completeAgent, broadcast, acquireLock, releaseLock };
      renderStage(); updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("running-count")).toHaveText("Running: 0");
}

test.describe("TC-021: 并发 Agent 调度", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("5 个 Agent 并发运行，第 6 个被 throttle", async ({ page }) => {
    await page.getByTestId("btn-create-5-agents").click();
    await page.getByTestId("btn-start-all").click();

    // 验证 5 个 running
    await expect(page.getByTestId("running-count")).toHaveText("Running: 5");
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc021-5-running.png" });

    // 尝试第 6 个
    await page.getByTestId("btn-start-6th").click();
    await expect(page.getByTestId("throttled-count")).toHaveText("Throttled: 1");
    await expect(page.getByTestId("running-count")).toHaveText("Running: 5");

    // 验证事件日志包含 throttle
    const eventLog = await page.getByTestId("event-log").textContent();
    expect(eventLog).toContain("agent:throttled");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc021-6th-throttled.png" });
  });
});

test.describe("TC-022: 消息广播", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Agent 广播消息到 session", async ({ page }) => {
    await page.getByTestId("btn-create-5-agents").click();
    await page.getByTestId("btn-start-all").click();

    await page.getByTestId("btn-broadcast").click();

    await expect(page.getByTestId("messages-count")).toHaveText("Messages: 1");

    // 验证消息内容
    const state = await page.evaluate(() => (window as any).__CUCUMBER_COLLAB__.getState());
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].type).toBe("broadcast");
    expect(state.messages[0].messageType).toBe("review:start");
    expect(state.messages[0].payload.content).toBe("Sample text for review");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc022-broadcast.png" });
  });
});

test.describe("TC-023: 锁冲突解决", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("两个 Agent 竞争同一容器锁", async ({ page }) => {
    await page.getByTestId("btn-create-5-agents").click();
    await page.getByTestId("btn-lock-conflict").click();

    // 验证事件序列：acquired → conflict → released → acquired
    const lockEventsText = await page.getByTestId("lock-events").textContent();
    expect(lockEventsText).toContain("lock:acquired");
    expect(lockEventsText).toContain("lock:conflict");
    expect(lockEventsText).toContain("lock:released");

    // 通过 API 验证详细事件
    const state = await page.evaluate(() => (window as any).__CUCUMBER_COLLAB__.getState());
    const lockTypes = state.lockEvents.map((e: any) => e.type);
    expect(lockTypes).toEqual(["lock:acquired", "lock:conflict", "lock:released", "lock:acquired"]);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc023-lock-conflict.png" });
  });
});
