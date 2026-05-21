import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>P2 Scenario B - Cycle Detection Protection</title>
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
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }
      .dataflow-edge path {
        fill: none;
        stroke: #4ECDC4;
        stroke-width: 2;
      }
      .error-toast {
        background: rgba(239, 68, 68, 0.92);
        border-radius: 12px;
        border: 1px solid rgba(255, 100, 100, 0.4);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        color: white;
        font-size: 13px;
        padding: 12px 20px;
        position: fixed;
        right: 24px;
        top: 24px;
        z-index: 100;
        display: none;
        max-width: 360px;
      }
      .error-toast.visible { display: block; animation: slideIn 0.3s ease-out; }
      @keyframes slideIn {
        from { transform: translateX(100px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      pre { margin: 0; white-space: pre-wrap; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <header data-testid="toolbar">
        <button data-testid="btn-create-nodes" type="button">创建 A → B → C</button>
        <button data-testid="btn-connect-ab" type="button">连接 A→B</button>
        <button data-testid="btn-connect-bc" type="button">连接 B→C</button>
        <button data-testid="btn-connect-ca" type="button">连接 C→A (循环!)</button>
      </header>

      <aside data-testid="sidebar">
        <strong>循环检测状态</strong>
        <div data-testid="node-count">节点数: 0</div>
        <div data-testid="edge-count">连线数: 0</div>
        <div data-testid="cycle-detected">循环检测: 无</div>
        <div data-testid="cycle-events">cycle:detected 事件次数: 0</div>
        <div data-testid="rejected-edges">被拒绝连线数: 0</div>
        <pre data-testid="snapshot"></pre>
      </aside>

      <section data-testid="canvas-stage"></section>
    </main>
    <div class="error-toast" data-testid="error-toast"></div>

    <script>
      (() => {
        const stage = document.querySelector('[data-testid="canvas-stage"]');
        const errorToast = document.querySelector('[data-testid="error-toast"]');
        const state = {
          containers: new Map(),
          edges: new Map(),
          cycleEvents: [],
          rejectedEdges: [],
        };

        function createContainer(id, label, bounds, style) {
          const container = {
            id, type: 'container', parentId: null,
            role: ['dataflow'], bounds,
            contextSlots: {}, inheritPolicy: 'merge',
            ioPorts: [
              { id: id + '-in', direction: 'input', dataType: 'json', label: 'in' },
              { id: id + '-out', direction: 'output', dataType: 'json', label: 'out' },
            ],
            style: { label, fill: style.fill, stroke: style.stroke, opacity: 1 },
          };
          state.containers.set(id, container);
          renderStage();
          updateSidebar();
          return container;
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

        function detectCyclePath(newEdge) {
          const path = [newEdge.target.nodeId];
          const visited = new Set();
          let current = newEdge.source.nodeId;
          while (current && !visited.has(current)) {
            path.push(current);
            visited.add(current);
            if (current === newEdge.target.nodeId) break;
            const inEdges = [...state.edges.values()].filter(e => e.target.nodeId === current);
            current = inEdges[0]?.source.nodeId ?? '';
          }
          return path;
        }

        function addEdge(edgeData) {
          const sourceNode = state.containers.get(edgeData.source.nodeId);
          const targetNode = state.containers.get(edgeData.target.nodeId);
          if (!sourceNode || !targetNode) return null;

          const sourcePort = sourceNode.ioPorts.find(p => p.id === edgeData.source.portId);
          const targetPort = targetNode.ioPorts.find(p => p.id === edgeData.target.portId);
          if (!sourcePort || !targetPort) return null;
          if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') return null;

          const fullEdge = { ...edgeData, status: 'idle' };

          if (wouldCreateCycle(fullEdge)) {
            const cyclePath = detectCyclePath(fullEdge);
            const cycleEvent = {
              timestamp: Date.now(),
              attemptedEdge: edgeData,
              cyclePath,
            };
            state.cycleEvents.push(cycleEvent);
            state.rejectedEdges.push(edgeData);

            errorToast.textContent = '⚠️ 循环依赖检测！无法从 ' + edgeData.source.nodeId + ' 连接到 ' + edgeData.target.nodeId + '（路径: ' + cyclePath.join(' → ') + '）';
            errorToast.classList.add('visible');
            setTimeout(() => errorToast.classList.remove('visible'), 5000);

            window.dispatchEvent(new CustomEvent('cycle:detected', { detail: { nodeIds: cyclePath, edge: edgeData } }));

            updateSidebar();
            return null;
          }

          state.edges.set(fullEdge.id, fullEdge);
          renderStage();
          updateSidebar();
          return fullEdge;
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
              portEl.textContent = port.label;
              portEl.style.top = (40 + idx * 28) + 'px';
              node.appendChild(portEl);
            });

            stage.appendChild(node);
          }

          for (const edge of state.edges.values()) {
            const source = state.containers.get(edge.source.nodeId);
            const target = state.containers.get(edge.target.nodeId);
            if (!source || !target) continue;

            const edgeEl = document.createElement('div');
            edgeEl.className = 'dataflow-edge';
            edgeEl.dataset.edgeId = edge.id;
            edgeEl.setAttribute('data-testid', 'edge-' + edge.id);

            const sx = source.bounds.x + source.bounds.width;
            const sy = source.bounds.y + 50;
            const tx = target.bounds.x;
            const ty = target.bounds.y + 50;
            const cx = (sx + tx) / 2;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.position = 'absolute'; svg.style.inset = '0';
            svg.style.width = '100%'; svg.style.height = '100%'; svg.style.overflow = 'visible';

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + cx + ' ' + sy + ' ' + cx + ' ' + ty + ' ' + tx + ' ' + ty);
            svg.appendChild(path);
            edgeEl.appendChild(svg);
            stage.appendChild(edgeEl);
          }
        }

        function updateSidebar() {
          document.querySelector('[data-testid="node-count"]').textContent = '节点数: ' + state.containers.size;
          document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
          document.querySelector('[data-testid="cycle-detected"]').textContent = '循环检测: ' + (state.cycleEvents.length > 0 ? '已触发 (' + state.cycleEvents.length + '次)' : '无');
          document.querySelector('[data-testid="cycle-events"]').textContent = 'cycle:detected 事件次数: ' + state.cycleEvents.length;
          document.querySelector('[data-testid="rejected-edges"]').textContent = '被拒绝连线数: ' + state.rejectedEdges.length;
          document.querySelector('[data-testid="snapshot"]').textContent = JSON.stringify({
            nodes: [...state.containers.keys()],
            edges: [...state.edges.values()].map(e => ({ id: e.id, from: e.source.nodeId, to: e.target.nodeId })),
            cycleEvents: state.cycleEvents,
            rejectedEdges: state.rejectedEdges,
          }, null, 2);
        }

        document.querySelector('[data-testid="btn-create-nodes"]').addEventListener('click', () => {
          createContainer('node-a', '节点 A', { x: 60, y: 160, width: 160, height: 100 }, { fill: 'rgba(99, 102, 241, 0.12)', stroke: '#6366f1' });
          createContainer('node-b', '节点 B', { x: 300, y: 160, width: 160, height: 100 }, { fill: 'rgba(34, 197, 94, 0.12)', stroke: '#22c55e' });
          createContainer('node-c', '节点 C', { x: 540, y: 160, width: 160, height: 100 }, { fill: 'rgba(236, 72, 153, 0.12)', stroke: '#ec4899' });
        });

        document.querySelector('[data-testid="btn-connect-ab"]').addEventListener('click', () => {
          addEdge({ id: 'edge-a-b', source: { nodeId: 'node-a', portId: 'node-a-out' }, target: { nodeId: 'node-b', portId: 'node-b-in' } });
        });

        document.querySelector('[data-testid="btn-connect-bc"]').addEventListener('click', () => {
          addEdge({ id: 'edge-b-c', source: { nodeId: 'node-b', portId: 'node-b-out' }, target: { nodeId: 'node-c', portId: 'node-c-in' } });
        });

        document.querySelector('[data-testid="btn-connect-ca"]').addEventListener('click', () => {
          addEdge({ id: 'edge-c-a', source: { nodeId: 'node-c', portId: 'node-c-out' }, target: { nodeId: 'node-a', portId: 'node-a-in' } });
        });

        window.__CUCUMBER_P2_CYCLE__ = {
          getState: () => ({
            containers: [...state.containers.keys()],
            edges: Object.fromEntries(state.edges),
            cycleEvents: state.cycleEvents,
            rejectedEdges: state.rejectedEdges,
          }),
          addEdge,
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
  await expect(page.getByTestId("node-count")).toHaveText("节点数: 0");
}

test.describe("场景B：循环依赖保护", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });

  test("B1 - 创建 3 个节点 A、B、C", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await expect(page.getByTestId("node-count")).toHaveText("节点数: 3");

    await expect(page.getByTestId("container-node-a")).toBeVisible();
    await expect(page.getByTestId("container-node-b")).toBeVisible();
    await expect(page.getByTestId("container-node-c")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/p2/b1-three-nodes-created.png", fullPage: true });
  });

  test("B2 - 建立有效连线 A→B 和 B→C", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await page.getByTestId("btn-connect-ab").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 1");
    await expect(page.getByTestId("edge-edge-a-b")).toBeVisible();

    await page.getByTestId("btn-connect-bc").click();
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");
    await expect(page.getByTestId("edge-edge-b-c")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/p2/b2-valid-edges-ab-bc.png", fullPage: true });
  });

  test("B3 - 循环连线 C→A 被拒绝", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await page.getByTestId("btn-connect-ab").click();
    await page.getByTestId("btn-connect-bc").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");

    await page.getByTestId("btn-connect-ca").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");
    await expect(page.getByTestId("rejected-edges")).toHaveText("被拒绝连线数: 1");

    await page.screenshot({ path: "e2e/screenshots/p2/b3-cycle-rejected.png", fullPage: true });
  });

  test("B4 - cycle:detected 事件触发", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await page.getByTestId("btn-connect-ab").click();
    await page.getByTestId("btn-connect-bc").click();

    const cycleEventPromise = page.evaluate(() => {
      return new Promise<any>((resolve) => {
        window.addEventListener("cycle:detected", ((e: CustomEvent) => {
          resolve(e.detail);
        }) as EventListener, { once: true });
      });
    });

    await page.getByTestId("btn-connect-ca").click();

    const cycleDetail = await cycleEventPromise;
    expect(cycleDetail).toBeDefined();
    expect(cycleDetail.nodeIds).toBeDefined();
    expect(cycleDetail.nodeIds.length).toBeGreaterThan(0);
    expect(cycleDetail.edge).toBeDefined();
    expect(cycleDetail.edge.source.nodeId).toBe("node-c");
    expect(cycleDetail.edge.target.nodeId).toBe("node-a");

    await expect(page.getByTestId("cycle-events")).toHaveText("cycle:detected 事件次数: 1");

    await page.screenshot({ path: "e2e/screenshots/p2/b4-cycle-event-fired.png", fullPage: true });
  });

  test("B5 - 画布显示错误提示", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await page.getByTestId("btn-connect-ab").click();
    await page.getByTestId("btn-connect-bc").click();
    await page.getByTestId("btn-connect-ca").click();

    const errorToast = page.getByTestId("error-toast");
    await expect(errorToast).toBeVisible();
    const text = await errorToast.textContent();
    expect(text).toContain("循环依赖检测");
    expect(text).toContain("node-c");
    expect(text).toContain("node-a");

    await page.screenshot({ path: "e2e/screenshots/p2/b5-error-toast-visible.png", fullPage: true });
  });

  test("B6 - 重复循环尝试仍被拒绝", async ({ page }) => {
    await page.getByTestId("btn-create-nodes").click();
    await page.getByTestId("btn-connect-ab").click();
    await page.getByTestId("btn-connect-bc").click();

    await page.getByTestId("btn-connect-ca").click();
    await page.getByTestId("btn-connect-ca").click();
    await page.getByTestId("btn-connect-ca").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 2");
    await expect(page.getByTestId("cycle-events")).toHaveText("cycle:detected 事件次数: 3");
    await expect(page.getByTestId("rejected-edges")).toHaveText("被拒绝连线数: 3");

    const state = await page.evaluate(() => (window as any).__CUCUMBER_P2_CYCLE__.getState());
    expect(state.cycleEvents.length).toBe(3);
    expect(Object.keys(state.edges).length).toBe(2);

    await page.screenshot({ path: "e2e/screenshots/p2/b6-repeated-attempts-rejected.png", fullPage: true });
  });
});
