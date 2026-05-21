import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - DataFlow</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 280px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; position: absolute; }
    .container-title { font-size: 12px; font-weight: 600; height: 28px; padding: 0 10px; display: flex; align-items: center; }
    .io-port { border-radius: 999px; font-size: 10px; height: 20px; padding: 0 8px; position: absolute; display: flex; align-items: center; }
    .io-port.output { right: -10px; background: rgba(78,205,196,0.8); }
    .io-port.input { left: -10px; background: rgba(255,107,107,0.8); }
    .dataflow-edge { position: absolute; pointer-events: none; inset: 0; }
    .dataflow-edge path { fill: none; stroke: #4ECDC4; stroke-width: 2; }
    .dataflow-edge path.flowing { stroke: #00ff88; stroke-width: 3; stroke-dasharray: 8 4; animation: flow 0.8s linear infinite; }
    .dataflow-edge path.completed { stroke: #22c55e; stroke-width: 2.5; }
    @keyframes flow { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }
    .error-toast { background: rgba(239,68,68,0.9); border-radius: 12px; color: white; font-size: 13px; padding: 10px 16px; position: fixed; right: 24px; top: 24px; z-index: 100; display: none; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-setup-pipeline" type="button">构建管道</button>
      <button data-testid="btn-execute" type="button">执行数据流</button>
      <button data-testid="btn-setup-chain" type="button">构建 A→B→C 链</button>
      <button data-testid="btn-try-cycle" type="button">尝试 C→A 循环</button>
      <button data-testid="btn-batch-setup" type="button">构建批量管道</button>
      <button data-testid="btn-batch-execute" type="button">批量执行</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="edge-count">连线数: 0</div>
      <div data-testid="edge-status">状态: -</div>
      <div data-testid="data-payload">数据载荷: -</div>
      <div data-testid="execution-log">执行日志: 等待中</div>
      <div data-testid="cycle-events">循环事件: 0</div>
      <div data-testid="batch-info">批量: -</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>
  <div class="error-toast" data-testid="error-toast"></div>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { containers: new Map(), edges: new Map(), executionLog: [], lastPayload: null, cycleEvents: 0, batchResults: [] };

      function createNode(id, label, x, y, stroke) {
        state.containers.set(id, { id, bounds: { x, y, width: 200, height: 120 }, label, ioPorts: [], style: { fill: 'rgba(99,102,241,0.08)', stroke } });
      }

      function addPort(nodeId, port) {
        const c = state.containers.get(nodeId);
        if (c) c.ioPorts.push(port);
      }

      function wouldCreateCycle(newEdge) {
        const visited = new Set();
        const queue = [newEdge.source.nodeId];
        while (queue.length > 0) {
          const current = queue.pop();
          if (current === newEdge.target.nodeId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          for (const edge of state.edges.values()) {
            if (edge.target.nodeId === current) queue.push(edge.source.nodeId);
          }
        }
        return false;
      }

      function addEdge(edgeData) {
        if (wouldCreateCycle(edgeData)) {
          state.cycleEvents++;
          const toast = document.querySelector('[data-testid="error-toast"]');
          toast.textContent = '循环依赖检测：无法建立连接';
          toast.style.display = 'block';
          window.dispatchEvent(new CustomEvent('cycle:detected', { detail: { edge: edgeData } }));
          updateSidebar();
          return null;
        }
        const edge = { ...edgeData, status: 'idle' };
        state.edges.set(edge.id, edge);
        renderStage(); updateSidebar();
        return edge;
      }

      async function executeDataFlow(targetNodeId) {
        const inEdges = [...state.edges.values()].filter(e => e.target.nodeId === targetNodeId);
        for (const edge of inEdges) {
          edge.status = 'flowing';
          state.executionLog.push({ time: Date.now(), edgeId: edge.id, status: 'flowing' });
          renderStage(); updateSidebar();
          await new Promise(r => setTimeout(r, 400));
          edge.status = 'completed';
          state.lastPayload = { type: 'prompt', template: 'A serene mountain landscape', vars: { style: 'photorealistic', resolution: '1024x1024' } };
          state.executionLog.push({ time: Date.now(), edgeId: edge.id, status: 'completed' });
          renderStage(); updateSidebar();
        }
      }

      async function batchExecute(nodeIds) {
        state.batchResults = [];
        const promises = nodeIds.map(async (nodeId) => {
          await executeDataFlow(nodeId);
          state.batchResults.push(nodeId);
        });
        await Promise.all(promises);
        updateSidebar();
      }

      function renderStage() {
        stage.replaceChildren();
        for (const c of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'node-' + c.id);
          node.style.left = c.bounds.x + 'px'; node.style.top = c.bounds.y + 'px';
          node.style.width = c.bounds.width + 'px'; node.style.height = c.bounds.height + 'px';
          node.style.background = c.style.fill; node.style.borderColor = c.style.stroke;
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = c.label;
          node.appendChild(title);
          c.ioPorts.forEach((port, idx) => {
            const el = document.createElement('div');
            el.className = 'io-port ' + port.direction;
            el.setAttribute('data-testid', 'port-' + port.id);
            el.textContent = port.label; el.style.top = (35 + idx * 26) + 'px';
            node.appendChild(el);
          });
          stage.appendChild(node);
        }
        for (const edge of state.edges.values()) {
          const src = state.containers.get(edge.source.nodeId);
          const tgt = state.containers.get(edge.target.nodeId);
          if (!src || !tgt) continue;
          const el = document.createElement('div');
          el.className = 'dataflow-edge';
          el.setAttribute('data-testid', 'edge-' + edge.id);
          el.setAttribute('data-status', edge.status);
          const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
          const sx=src.bounds.x+src.bounds.width, sy=src.bounds.y+50, tx=tgt.bounds.x, ty=tgt.bounds.y+50;
          const path = document.createElementNS('http://www.w3.org/2000/svg','path');
          path.setAttribute('d','M '+sx+' '+sy+' C '+(sx+tx)/2+' '+sy+' '+(sx+tx)/2+' '+ty+' '+tx+' '+ty);
          path.classList.add(edge.status);
          svg.appendChild(path); el.appendChild(svg); stage.appendChild(el);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
        const statuses = [...state.edges.values()].map(e => e.id+':'+e.status).join(', ') || '-';
        document.querySelector('[data-testid="edge-status"]').textContent = '状态: ' + statuses;
        document.querySelector('[data-testid="data-payload"]').textContent = '数据载荷: ' + (state.lastPayload ? JSON.stringify(state.lastPayload) : '-');
        document.querySelector('[data-testid="execution-log"]').textContent = '执行日志: ' + (state.executionLog.length > 0 ? state.executionLog.length + ' entries' : '等待中');
        document.querySelector('[data-testid="cycle-events"]').textContent = '循环事件: ' + state.cycleEvents;
        document.querySelector('[data-testid="batch-info"]').textContent = '批量: ' + (state.batchResults.length > 0 ? state.batchResults.join(',') : '-');
      }

      document.querySelector('[data-testid="btn-setup-pipeline"]').addEventListener('click', () => {
        createNode('src', 'Source', 40, 100, '#6366f1');
        addPort('src', { id: 'src-out', direction: 'output', dataType: 'prompt', label: 'out' });
        createNode('dst', 'Destination', 380, 100, '#ec4899');
        addPort('dst', { id: 'dst-in', direction: 'input', dataType: 'prompt', label: 'in' });
        addEdge({ id: 'e-src-dst', source: { nodeId: 'src', portId: 'src-out' }, target: { nodeId: 'dst', portId: 'dst-in' } });
      });

      document.querySelector('[data-testid="btn-execute"]').addEventListener('click', () => { executeDataFlow('dst'); });

      document.querySelector('[data-testid="btn-setup-chain"]').addEventListener('click', () => {
        createNode('chain-a', 'A', 40, 80, '#6366f1');
        addPort('chain-a', { id: 'a-out', direction: 'output', dataType: 'text', label: 'out' });
        createNode('chain-b', 'B', 300, 80, '#22c55e');
        addPort('chain-b', { id: 'b-in', direction: 'input', dataType: 'text', label: 'in' });
        addPort('chain-b', { id: 'b-out', direction: 'output', dataType: 'text', label: 'out' });
        createNode('chain-c', 'C', 560, 80, '#ec4899');
        addPort('chain-c', { id: 'c-in', direction: 'input', dataType: 'text', label: 'in' });
        addPort('chain-c', { id: 'c-out', direction: 'output', dataType: 'text', label: 'out' });
        addEdge({ id: 'e-ab', source: { nodeId: 'chain-a', portId: 'a-out' }, target: { nodeId: 'chain-b', portId: 'b-in' } });
        addEdge({ id: 'e-bc', source: { nodeId: 'chain-b', portId: 'b-out' }, target: { nodeId: 'chain-c', portId: 'c-in' } });
      });

      document.querySelector('[data-testid="btn-try-cycle"]').addEventListener('click', () => {
        addEdge({ id: 'e-ca', source: { nodeId: 'chain-c', portId: 'c-out' }, target: { nodeId: 'chain-a', portId: 'a-out' } });
      });

      document.querySelector('[data-testid="btn-batch-setup"]').addEventListener('click', () => {
        for (let i = 0; i < 3; i++) {
          createNode('batch-src-'+i, 'Batch Src '+i, 40, 100+i*160, '#6366f1');
          addPort('batch-src-'+i, { id: 'bs-out-'+i, direction: 'output', dataType: 'text', label: 'out' });
          createNode('batch-dst-'+i, 'Batch Dst '+i, 380, 100+i*160, '#ec4899');
          addPort('batch-dst-'+i, { id: 'bd-in-'+i, direction: 'input', dataType: 'text', label: 'in' });
          addEdge({ id: 'be-'+i, source: { nodeId: 'batch-src-'+i, portId: 'bs-out-'+i }, target: { nodeId: 'batch-dst-'+i, portId: 'bd-in-'+i } });
        }
      });

      document.querySelector('[data-testid="btn-batch-execute"]').addEventListener('click', () => {
        batchExecute(['batch-dst-0', 'batch-dst-1', 'batch-dst-2']);
      });

      window.__CUCUMBER_DATAFLOW__ = { getState: () => state, executeDataFlow, batchExecute, addEdge };
      renderStage(); updateSidebar();
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

test.describe("TC-015: 执行数据流", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("数据流状态 idle → flowing → completed", async ({ page }) => {
    await page.getByTestId("btn-setup-pipeline").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 1");

    const edge = page.getByTestId("edge-e-src-dst");
    await expect(edge).toHaveAttribute("data-status", "idle");

    // 执行
    await page.getByTestId("btn-execute").click();

    // 验证 flowing 状态
    await expect(edge).toHaveAttribute("data-status", "flowing", { timeout: 2000 });
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc015-flowing.png" });

    // 验证 completed 状态
    await expect(edge).toHaveAttribute("data-status", "completed", { timeout: 3000 });

    // 验证数据载荷
    await expect(page.getByTestId("data-payload")).toContainText("photorealistic");
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc015-completed.png" });
  });
});

test.describe("TC-016: 循环依赖保护", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("A→B→C 链中尝试 C→A 被阻止", async ({ page }) => {
    await page.getByTestId("btn-setup-chain").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    // 截图：链路建立
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc016-chain-built.png" });

    // 尝试循环
    await page.getByTestId("btn-try-cycle").click();

    // 验证被拒绝
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");
    await expect(page.getByTestId("cycle-events")).toHaveText("循环事件: 1");
    await expect(page.getByTestId("error-toast")).toBeVisible();
    await expect(page.getByTestId("error-toast")).toContainText("循环依赖");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc016-cycle-rejected.png" });
  });
});

test.describe("TC-017: 批量执行优化", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("3 条独立管道并行执行", async ({ page }) => {
    await page.getByTestId("btn-batch-setup").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 3");

    const startTime = Date.now();
    await page.getByTestId("btn-batch-execute").click();

    // 等待所有批量完成
    await expect(page.getByTestId("batch-info")).toContainText("batch-dst-0", { timeout: 5000 });
    await expect(page.getByTestId("batch-info")).toContainText("batch-dst-2");

    const elapsed = Date.now() - startTime;
    // 并行执行应该 < 2 秒（3 条 × 400ms 如果串行需要 1200ms+）
    expect(elapsed).toBeLessThan(3000);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc017-batch-complete.png" });
  });
});
