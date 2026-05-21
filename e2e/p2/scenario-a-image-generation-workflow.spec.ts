import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>P2 Scenario A - Image Generation Workflow</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, system-ui, sans-serif;
        background: #020617;
        color: #e2e8f0;
      }
      main {
        display: grid;
        gap: 12px;
        grid-template-columns: 280px minmax(0, 1fr);
        grid-template-rows: 56px minmax(0, 1fr);
        height: 100vh;
        padding: 12px;
      }
      [data-testid="toolbar"] {
        align-items: center;
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 16px;
        display: flex;
        gap: 8px;
        grid-column: 1 / span 2;
        padding: 0 12px;
      }
      [data-testid="sidebar"] {
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 20px;
        display: grid;
        gap: 10px;
        overflow: auto;
        padding: 16px;
        align-content: start;
      }
      [data-testid="canvas-stage"] {
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 20px;
        min-height: 560px;
        overflow: hidden;
        padding: 16px;
        position: relative;
      }
      button {
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 999px;
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
        padding: 8px 14px;
        font-size: 12px;
      }
      button:hover { background: rgba(30, 41, 59, 0.95); }
      .container-node {
        border: 2px solid;
        border-radius: 16px;
        overflow: visible;
        position: absolute;
      }
      .container-title {
        align-items: center;
        display: flex;
        font-size: 12px;
        font-weight: 600;
        height: 28px;
        padding: 0 10px;
      }
      .io-port {
        align-items: center;
        border-radius: 999px;
        display: flex;
        font-size: 10px;
        gap: 4px;
        height: 20px;
        padding: 0 8px;
        position: absolute;
      }
      .io-port.output { right: -10px; background: rgba(78, 205, 196, 0.8); }
      .io-port.input { left: -10px; background: rgba(255, 107, 107, 0.8); }
      .dataflow-edge {
        position: absolute;
        pointer-events: none;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .dataflow-edge svg {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }
      .dataflow-edge path {
        fill: none;
        stroke: #4ECDC4;
        stroke-width: 2;
        transition: stroke 0.3s, stroke-width 0.3s;
      }
      .dataflow-edge path.flowing {
        stroke: #00ff88;
        stroke-width: 3;
        stroke-dasharray: 8 4;
        animation: flow 0.8s linear infinite;
      }
      .dataflow-edge path.completed {
        stroke: #22c55e;
        stroke-width: 2.5;
      }
      @keyframes flow {
        from { stroke-dashoffset: 12; }
        to { stroke-dashoffset: 0; }
      }
      .error-toast {
        background: rgba(239, 68, 68, 0.9);
        border-radius: 12px;
        color: white;
        font-size: 13px;
        padding: 10px 16px;
        position: fixed;
        right: 24px;
        top: 24px;
        z-index: 100;
        display: none;
      }
      pre { margin: 0; white-space: pre-wrap; font-size: 11px; }
      .status-badge {
        border-radius: 999px;
        font-size: 10px;
        padding: 2px 8px;
        position: absolute;
        bottom: 8px;
        right: 8px;
      }
    </style>
  </head>
  <body>
    <main>
      <header data-testid="toolbar">
        <button data-testid="btn-create-prompt-gen" type="button">创建 Prompt 生成器</button>
        <button data-testid="btn-create-img-renderer" type="button">创建 图片渲染器</button>
        <button data-testid="btn-add-ports" type="button">添加端口</button>
        <button data-testid="btn-connect" type="button">建立连线</button>
        <button data-testid="btn-execute" type="button">执行数据流</button>
      </header>

      <aside data-testid="sidebar">
        <strong>工作流状态</strong>
        <div data-testid="container-count">容器数: 0</div>
        <div data-testid="edge-count">连线数: 0</div>
        <div data-testid="edge-status">连线状态: none</div>
        <div data-testid="execution-log">执行日志: 等待中</div>
        <div data-testid="data-payload">数据载荷: -</div>
        <pre data-testid="snapshot"></pre>
      </aside>

      <section data-testid="canvas-stage"></section>
    </main>
    <div class="error-toast" data-testid="error-toast"></div>

    <script>
      (() => {
        const stage = document.querySelector('[data-testid="canvas-stage"]');
        const state = {
          containers: new Map(),
          edges: new Map(),
          executionLog: [],
          lastPayload: null,
        };

        function createContainer(id, role, label, bounds, style) {
          const container = {
            id,
            type: 'container',
            parentId: null,
            role: [role],
            bounds,
            contextSlots: {},
            inheritPolicy: 'merge',
            ioPorts: [],
            style: { label, fill: style.fill, stroke: style.stroke, opacity: 1 },
          };
          state.containers.set(id, container);
          renderStage();
          updateSidebar();
          return container;
        }

        function addPort(containerId, port) {
          const container = state.containers.get(containerId);
          if (!container) return null;
          container.ioPorts.push(port);
          renderStage();
          return port;
        }

        function isPortCompatible(outputType, inputType) {
          const rules = [
            ['image', 'image'], ['image', 'reference'],
            ['text', 'text'], ['text', 'prompt'],
            ['json', 'json'], ['reference', 'reference'],
            ['prompt', 'prompt'],
          ];
          return rules.some(([o, i]) => o === outputType && i === inputType);
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
              if (edge.target.nodeId === current) {
                queue.push(edge.source.nodeId);
              }
            }
          }
          return false;
        }

        function addEdge(edgeData) {
          const sourceNode = state.containers.get(edgeData.source.nodeId);
          const targetNode = state.containers.get(edgeData.target.nodeId);
          if (!sourceNode || !targetNode) return null;

          const sourcePort = sourceNode.ioPorts.find(p => p.id === edgeData.source.portId);
          const targetPort = targetNode.ioPorts.find(p => p.id === edgeData.target.portId);
          if (!sourcePort || !targetPort) return null;
          if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') return null;
          if (!isPortCompatible(sourcePort.dataType, targetPort.dataType)) return null;

          const fullEdge = { ...edgeData, status: 'idle' };
          if (wouldCreateCycle(fullEdge)) {
            const toast = document.querySelector('[data-testid="error-toast"]');
            toast.textContent = '循环依赖检测：无法建立连接';
            toast.style.display = 'block';
            window.dispatchEvent(new CustomEvent('cycle:detected', { detail: { nodes: [edgeData.source.nodeId, edgeData.target.nodeId] } }));
            return null;
          }

          state.edges.set(fullEdge.id, fullEdge);
          renderStage();
          updateSidebar();
          return fullEdge;
        }

        function setEdgeStatus(edgeId, status) {
          const edge = state.edges.get(edgeId);
          if (!edge) return;
          edge.status = status;
          state.executionLog.push({ time: Date.now(), edgeId, status });
          renderStage();
          updateSidebar();
        }

        async function executeDataFlow(targetNodeId) {
          const inEdges = [...state.edges.values()].filter(e => e.target.nodeId === targetNodeId);
          for (const edge of inEdges) {
            setEdgeStatus(edge.id, 'flowing');
            await new Promise(r => setTimeout(r, 600));

            const sourceContainer = state.containers.get(edge.source.nodeId);
            const payload = {
              type: 'prompt',
              template: 'A serene mountain landscape at sunset with vibrant colors',
              vars: { style: 'photorealistic', resolution: '1024x1024' },
            };
            state.lastPayload = payload;

            setEdgeStatus(edge.id, 'completed');
          }
          state.executionLog.push({ time: Date.now(), nodeId: targetNodeId, event: 'execute:complete' });
          updateSidebar();
        }

        function renderStage() {
          stage.replaceChildren();
          for (const container of state.containers.values()) {
            const node = document.createElement('div');
            node.className = 'container-node';
            node.dataset.containerId = container.id;
            node.setAttribute('data-testid', 'container-' + container.id);
            node.style.left = container.bounds.x + 'px';
            node.style.top = container.bounds.y + 'px';
            node.style.width = container.bounds.width + 'px';
            node.style.height = container.bounds.height + 'px';
            node.style.background = container.style.fill;
            node.style.borderColor = container.style.stroke;

            const title = document.createElement('div');
            title.className = 'container-title';
            title.textContent = container.style.label;
            title.style.background = container.style.stroke + '26';
            node.appendChild(title);

            container.ioPorts.forEach((port, idx) => {
              const portEl = document.createElement('div');
              portEl.className = 'io-port ' + port.direction;
              portEl.dataset.portId = port.id;
              portEl.setAttribute('data-testid', 'port-' + port.id);
              portEl.textContent = port.label || port.dataType;
              portEl.style.top = (40 + idx * 28) + 'px';
              node.appendChild(portEl);
            });

            stage.appendChild(node);
          }

          for (const edge of state.edges.values()) {
            const sourceContainer = state.containers.get(edge.source.nodeId);
            const targetContainer = state.containers.get(edge.target.nodeId);
            if (!sourceContainer || !targetContainer) continue;

            const edgeEl = document.createElement('div');
            edgeEl.className = 'dataflow-edge';
            edgeEl.dataset.edgeId = edge.id;
            edgeEl.setAttribute('data-testid', 'edge-' + edge.id);
            edgeEl.setAttribute('data-status', edge.status);

            const sx = sourceContainer.bounds.x + sourceContainer.bounds.width;
            const sy = sourceContainer.bounds.y + 50;
            const tx = targetContainer.bounds.x;
            const ty = targetContainer.bounds.y + 50;
            const cx = (sx + tx) / 2;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.position = 'absolute';
            svg.style.inset = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.overflow = 'visible';

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + cx + ' ' + sy + ' ' + cx + ' ' + ty + ' ' + tx + ' ' + ty);
            path.classList.add(edge.status);
            svg.appendChild(path);
            edgeEl.appendChild(svg);
            stage.appendChild(edgeEl);
          }
        }

        function updateSidebar() {
          document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
          document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
          const edgeStatuses = [...state.edges.values()].map(e => e.id + ':' + e.status).join(', ') || 'none';
          document.querySelector('[data-testid="edge-status"]').textContent = '连线状态: ' + edgeStatuses;
          const lastLog = state.executionLog[state.executionLog.length - 1];
          document.querySelector('[data-testid="execution-log"]').textContent = '执行日志: ' + (lastLog ? JSON.stringify(lastLog) : '等待中');
          document.querySelector('[data-testid="data-payload"]').textContent = '数据载荷: ' + (state.lastPayload ? JSON.stringify(state.lastPayload) : '-');
          document.querySelector('[data-testid="snapshot"]').textContent = JSON.stringify({
            containers: [...state.containers.keys()],
            edges: [...state.edges.values()].map(e => ({ id: e.id, status: e.status })),
            executionLog: state.executionLog,
            lastPayload: state.lastPayload,
          }, null, 2);
        }

        document.querySelector('[data-testid="btn-create-prompt-gen"]').addEventListener('click', () => {
          createContainer('prompt-generator', 'dataflow', 'Prompt 生成器', { x: 60, y: 120, width: 220, height: 140 }, { fill: 'rgba(99, 102, 241, 0.12)', stroke: '#6366f1' });
        });

        document.querySelector('[data-testid="btn-create-img-renderer"]').addEventListener('click', () => {
          createContainer('image-renderer', 'dataflow', '图片渲染器', { x: 420, y: 120, width: 220, height: 140 }, { fill: 'rgba(236, 72, 153, 0.12)', stroke: '#ec4899' });
        });

        document.querySelector('[data-testid="btn-add-ports"]').addEventListener('click', () => {
          addPort('prompt-generator', { id: 'pg-out-prompt', direction: 'output', dataType: 'prompt', label: 'prompt out' });
          addPort('image-renderer', { id: 'ir-in-prompt', direction: 'input', dataType: 'prompt', label: 'prompt in' });
          addPort('image-renderer', { id: 'ir-out-image', direction: 'output', dataType: 'image', label: 'image out' });
        });

        document.querySelector('[data-testid="btn-connect"]').addEventListener('click', () => {
          addEdge({
            id: 'edge-pg-to-ir',
            source: { nodeId: 'prompt-generator', portId: 'pg-out-prompt' },
            target: { nodeId: 'image-renderer', portId: 'ir-in-prompt' },
          });
        });

        document.querySelector('[data-testid="btn-execute"]').addEventListener('click', () => {
          executeDataFlow('image-renderer');
        });

        window.__CUCUMBER_P2_HARNESS__ = {
          getState: () => ({
            containers: Object.fromEntries(state.containers),
            edges: Object.fromEntries(state.edges),
            executionLog: state.executionLog,
            lastPayload: state.lastPayload,
          }),
          createContainer,
          addPort,
          addEdge,
          setEdgeStatus,
          executeDataFlow,
        };

        renderStage();
        updateSidebar();
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

test.describe("场景A：图片生成工作流", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });

  test("A1 - 创建 Prompt 生成器容器", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");

    const container = page.getByTestId("container-prompt-generator");
    await expect(container).toBeVisible();
    await expect(container.locator(".container-title")).toHaveText("Prompt 生成器");

    await page.screenshot({ path: "e2e/screenshots/p2/a1-prompt-generator-created.png", fullPage: true });
  });

  test("A2 - 创建图片渲染器容器", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 2");

    const container = page.getByTestId("container-image-renderer");
    await expect(container).toBeVisible();
    await expect(container.locator(".container-title")).toHaveText("图片渲染器");

    await page.screenshot({ path: "e2e/screenshots/p2/a2-both-containers.png", fullPage: true });
  });

  test("A3 - 添加 IO 端口并验证类型", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await page.getByTestId("btn-add-ports").click();

    const outputPort = page.getByTestId("port-pg-out-prompt");
    await expect(outputPort).toBeVisible();
    await expect(outputPort).toHaveClass(/output/);

    const inputPort = page.getByTestId("port-ir-in-prompt");
    await expect(inputPort).toBeVisible();
    await expect(inputPort).toHaveClass(/input/);

    const imageOutputPort = page.getByTestId("port-ir-out-image");
    await expect(imageOutputPort).toBeVisible();
    await expect(imageOutputPort).toHaveClass(/output/);

    await page.screenshot({ path: "e2e/screenshots/p2/a3-ports-added.png", fullPage: true });
  });

  test("A4 - 建立 DataFlowEdge 连线", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await page.getByTestId("btn-add-ports").click();
    await page.getByTestId("btn-connect").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 1");
    const edge = page.getByTestId("edge-edge-pg-to-ir");
    await expect(edge).toBeVisible();
    await expect(edge).toHaveAttribute("data-status", "idle");

    await page.screenshot({ path: "e2e/screenshots/p2/a4-edge-connected.png", fullPage: true });
  });

  test("A5 - 执行数据流：验证状态 idle → flowing → completed", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await page.getByTestId("btn-add-ports").click();
    await page.getByTestId("btn-connect").click();

    await expect(page.getByTestId("edge-edge-pg-to-ir")).toHaveAttribute("data-status", "idle");

    await page.getByTestId("btn-execute").click();

    await expect(page.getByTestId("edge-edge-pg-to-ir")).toHaveAttribute("data-status", "flowing", { timeout: 2000 });
    await page.screenshot({ path: "e2e/screenshots/p2/a5-edge-flowing.png", fullPage: true });

    await expect(page.getByTestId("edge-edge-pg-to-ir")).toHaveAttribute("data-status", "completed", { timeout: 3000 });
    await page.screenshot({ path: "e2e/screenshots/p2/a5-edge-completed.png", fullPage: true });
  });

  test("A6 - 数据从上游流向下游：验证载荷传递", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await page.getByTestId("btn-add-ports").click();
    await page.getByTestId("btn-connect").click();
    await page.getByTestId("btn-execute").click();

    await expect(page.getByTestId("edge-edge-pg-to-ir")).toHaveAttribute("data-status", "completed", { timeout: 3000 });

    const payloadText = await page.getByTestId("data-payload").textContent();
    expect(payloadText).toContain("prompt");
    expect(payloadText).toContain("A serene mountain landscape");

    const state = await page.evaluate(() => (window as any).__CUCUMBER_P2_HARNESS__.getState());
    expect(state.lastPayload).toEqual({
      type: "prompt",
      template: "A serene mountain landscape at sunset with vibrant colors",
      vars: { style: "photorealistic", resolution: "1024x1024" },
    });
    expect(state.executionLog.length).toBeGreaterThan(0);
    expect(state.executionLog.some((l: any) => l.event === "execute:complete")).toBe(true);

    await page.screenshot({ path: "e2e/screenshots/p2/a6-data-payload-delivered.png", fullPage: true });
  });
});
