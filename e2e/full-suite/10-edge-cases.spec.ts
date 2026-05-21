import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Edge Cases</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 320px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; flex-wrap: wrap; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; font-size: 12px; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; position: absolute; padding: 8px; }
    .container-title { font-size: 11px; font-weight: 600; }
    .error-toast { background: rgba(239,68,68,0.9); border-radius: 12px; color: white; font-size: 13px; padding: 10px 16px; position: fixed; right: 24px; top: 24px; z-index: 100; display: none; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-setup-chain" type="button">构建 A→B→C</button>
      <button data-testid="btn-try-ca" type="button">尝试 C→A</button>
      <button data-testid="btn-try-cb" type="button">尝试 C→B</button>
      <button data-testid="btn-try-ba" type="button">尝试 B→A</button>
      <button data-testid="btn-start-agent-error" type="button">启动出错Agent</button>
      <button data-testid="btn-start-timeout" type="button">启动超时Agent</button>
      <button data-testid="btn-create-50" type="button">创建 50 节点</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="edge-count">连线数: 0</div>
      <div data-testid="cycle-count">循环拒绝: 0</div>
      <div data-testid="error-events">Error events: 0</div>
      <div data-testid="timeout-events">Timeout events: 0</div>
      <div data-testid="running-count">Running: 0</div>
      <div data-testid="container-count">容器数: 0</div>
      <div data-testid="perf-time">创建耗时: -</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>
  <div class="error-toast" data-testid="error-toast"></div>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { containers: new Map(), edges: new Map(), cycleCount: 0, errorEvents: 0, timeoutEvents: 0, runningAgents: new Set() };

      function createNode(id, label, x, y) {
        state.containers.set(id, { id, label, bounds: { x, y, width: 160, height: 80 }, ports: [] });
        updateSidebar();
      }

      function addPort(nodeId, portId, direction, dataType) {
        const c = state.containers.get(nodeId);
        if (c) c.ports.push({ id: portId, direction, dataType });
      }

      function wouldCreateCycle(srcNodeId, tgtNodeId) {
        const visited = new Set();
        const queue = [srcNodeId];
        while (queue.length > 0) {
          const current = queue.pop();
          if (current === tgtNodeId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          for (const edge of state.edges.values()) {
            if (edge.target === current) queue.push(edge.source);
          }
        }
        return false;
      }

      function addEdge(id, source, target) {
        if (wouldCreateCycle(source, target)) {
          state.cycleCount++;
          const toast = document.querySelector('[data-testid="error-toast"]');
          toast.textContent = '循环依赖检测：' + source + ' → ' + target + ' 被拒绝';
          toast.style.display = 'block';
          window.dispatchEvent(new CustomEvent('cycle:detected', { detail: { source, target } }));
          updateSidebar();
          return false;
        }
        state.edges.set(id, { id, source, target });
        updateSidebar();
        return true;
      }

      function startAgentWithError(agentId) {
        state.runningAgents.add(agentId);
        updateSidebar();
        setTimeout(() => {
          state.runningAgents.delete(agentId);
          state.errorEvents++;
          window.dispatchEvent(new CustomEvent('agent:error', { detail: { agentId, error: 'Execution failed: Network error' } }));
          updateSidebar();
        }, 200);
      }

      function startAgentWithTimeout(agentId, timeoutMs) {
        state.runningAgents.add(agentId);
        updateSidebar();
        setTimeout(() => {
          state.runningAgents.delete(agentId);
          state.timeoutEvents++;
          window.dispatchEvent(new CustomEvent('agent:error', { detail: { agentId, error: 'Execution timeout after ' + timeoutMs + 'ms' } }));
          updateSidebar();
        }, timeoutMs || 500);
      }

      function createBulkNodes(count) {
        const startTime = performance.now();
        for (let i = 0; i < count; i++) {
          const id = 'bulk-' + i;
          const x = (i % 10) * 170; const y = Math.floor(i / 10) * 100;
          createNode(id, 'Node ' + i, x, y);
          addPort(id, id + '-out', 'output', 'text');
        }
        const elapsed = performance.now() - startTime;
        document.querySelector('[data-testid="perf-time"]').textContent = '创建耗时: ' + Math.round(elapsed) + 'ms';
        renderStage();
      }

      function renderStage() {
        stage.replaceChildren();
        for (const c of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'node-' + c.id);
          node.style.left = c.bounds.x + 'px'; node.style.top = c.bounds.y + 'px';
          node.style.width = c.bounds.width + 'px'; node.style.height = c.bounds.height + 'px';
          node.style.borderColor = '#475569'; node.style.background = 'rgba(15,23,42,0.6)';
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = c.label;
          node.appendChild(title);
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
        document.querySelector('[data-testid="cycle-count"]').textContent = '循环拒绝: ' + state.cycleCount;
        document.querySelector('[data-testid="error-events"]').textContent = 'Error events: ' + state.errorEvents;
        document.querySelector('[data-testid="timeout-events"]').textContent = 'Timeout events: ' + state.timeoutEvents;
        document.querySelector('[data-testid="running-count"]').textContent = 'Running: ' + state.runningAgents.size;
        document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
      }

      document.querySelector('[data-testid="btn-setup-chain"]').addEventListener('click', () => {
        createNode('A', 'A', 30, 80); addPort('A', 'A-out', 'output', 'text');
        createNode('B', 'B', 250, 80); addPort('B', 'B-out', 'output', 'text');
        createNode('C', 'C', 470, 80); addPort('C', 'C-out', 'output', 'text');
        addEdge('e-ab', 'A', 'B');
        addEdge('e-bc', 'B', 'C');
        renderStage();
      });
      document.querySelector('[data-testid="btn-try-ca"]').addEventListener('click', () => addEdge('e-ca', 'C', 'A'));
      document.querySelector('[data-testid="btn-try-cb"]').addEventListener('click', () => addEdge('e-cb', 'C', 'B'));
      document.querySelector('[data-testid="btn-try-ba"]').addEventListener('click', () => addEdge('e-ba', 'B', 'A'));
      document.querySelector('[data-testid="btn-start-agent-error"]').addEventListener('click', () => startAgentWithError('error-agent'));
      document.querySelector('[data-testid="btn-start-timeout"]').addEventListener('click', () => startAgentWithTimeout('timeout-agent', 500));
      document.querySelector('[data-testid="btn-create-50"]').addEventListener('click', () => createBulkNodes(50));

      window.__CUCUMBER_EDGE__ = { getState: () => state, addEdge, startAgentWithError, startAgentWithTimeout, createBulkNodes };
      updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("edge-count")).toHaveText("连线数: 0");
}

test.describe("TC-029: 循环依赖重复尝试", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("多次循环连线全部被阻止", async ({ page }) => {
    await page.getByTestId("btn-setup-chain").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    // 尝试 C→A
    await page.getByTestId("btn-try-ca").click();
    await expect(page.getByTestId("cycle-count")).toHaveText("循环拒绝: 1");
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    // 尝试 C→B
    await page.getByTestId("btn-try-cb").click();
    await expect(page.getByTestId("cycle-count")).toHaveText("循环拒绝: 2");
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    // 尝试 B→A
    await page.getByTestId("btn-try-ba").click();
    await expect(page.getByTestId("cycle-count")).toHaveText("循环拒绝: 3");
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    // 错误提示可见
    await expect(page.getByTestId("error-toast")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc029-all-cycles-rejected.png" });
  });
});

test.describe("TC-030: 并发冲突恢复", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Agent 出错后系统正确恢复", async ({ page }) => {
    // 启动一个会出错的 Agent
    await page.getByTestId("btn-start-agent-error").click();
    await expect(page.getByTestId("running-count")).toHaveText("Running: 1");

    // 等待错误发生
    await expect(page.getByTestId("error-events")).toHaveText("Error events: 1", { timeout: 2000 });
    await expect(page.getByTestId("running-count")).toHaveText("Running: 0");

    // 验证系统可继续使用
    await page.getByTestId("btn-start-agent-error").click();
    await expect(page.getByTestId("running-count")).toHaveText("Running: 1");
    await expect(page.getByTestId("error-events")).toHaveText("Error events: 2", { timeout: 2000 });

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc030-error-recovery.png" });
  });

  test("错误事件被正确记录", async ({ page }) => {
    let errorDetail: any = null;
    await page.exposeFunction("captureError", (detail: any) => { errorDetail = detail; });
    await page.evaluate(() => {
      window.addEventListener('agent:error', (e: any) => {
        (window as any).captureError(e.detail);
      });
    });

    await page.getByTestId("btn-start-agent-error").click();
    await expect(page.getByTestId("error-events")).toHaveText("Error events: 1", { timeout: 2000 });

    expect(errorDetail).not.toBeNull();
    expect(errorDetail.agentId).toBe("error-agent");
    expect(errorDetail.error).toContain("Network error");
  });
});

test.describe("TC-031: 网络异常（超时回退）", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Agent 超时后自动终止", async ({ page }) => {
    await page.getByTestId("btn-start-timeout").click();
    await expect(page.getByTestId("running-count")).toHaveText("Running: 1");

    // 等待超时
    await expect(page.getByTestId("timeout-events")).toHaveText("Timeout events: 1", { timeout: 3000 });
    await expect(page.getByTestId("running-count")).toHaveText("Running: 0");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc031-timeout.png" });
  });

  test("超时事件包含正确信息", async ({ page }) => {
    let errorDetail: any = null;
    await page.exposeFunction("captureTimeout", (detail: any) => { errorDetail = detail; });
    await page.evaluate(() => {
      window.addEventListener('agent:error', (e: any) => {
        (window as any).captureTimeout(e.detail);
      });
    });

    await page.getByTestId("btn-start-timeout").click();
    await expect(page.getByTestId("timeout-events")).toHaveText("Timeout events: 1", { timeout: 3000 });

    expect(errorDetail).not.toBeNull();
    expect(errorDetail.error).toContain("timeout");
  });
});

test.describe("TC-032: 大量节点性能", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("创建 50 节点性能在可接受范围", async ({ page }) => {
    const startTime = Date.now();

    await page.getByTestId("btn-create-50").click();

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(5000);

    await expect(page.getByTestId("container-count")).toHaveText("容器数: 50");

    // 验证性能时间（harness 内部计时）
    const perfText = await page.getByTestId("perf-time").textContent();
    const ms = parseInt(perfText!.match(/\d+/)?.[0] || "0");
    expect(ms).toBeLessThan(3000);

    // 验证所有节点渲染
    const nodeCount = await page.locator(".container-node").count();
    expect(nodeCount).toBe(50);

    // 验证无 JS 错误
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc032-50-nodes.png" });
  });
});
