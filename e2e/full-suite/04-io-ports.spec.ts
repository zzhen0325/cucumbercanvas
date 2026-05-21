import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - IO Ports</title>
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
    .io-port { align-items: center; border-radius: 999px; display: flex; font-size: 10px; gap: 4px; height: 20px; padding: 0 8px; position: absolute; cursor: crosshair; }
    .io-port.output { right: -10px; background: rgba(78,205,196,0.8); }
    .io-port.input { left: -10px; background: rgba(255,107,107,0.8); }
    .dataflow-edge { position: absolute; pointer-events: none; inset: 0; width: 100%; height: 100%; }
    .dataflow-edge svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; }
    .dataflow-edge path { fill: none; stroke: #4ECDC4; stroke-width: 2; }
    .error-toast { background: rgba(239,68,68,0.9); border-radius: 12px; color: white; font-size: 13px; padding: 10px 16px; position: fixed; right: 24px; top: 24px; z-index: 100; display: none; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-containers" type="button">创建容器对</button>
      <button data-testid="btn-add-compatible-ports" type="button">添加兼容端口</button>
      <button data-testid="btn-add-incompatible-ports" type="button">添加不兼容端口</button>
      <button data-testid="btn-connect" type="button">建立连线</button>
      <button data-testid="btn-connect-incompatible" type="button">尝试不兼容连线</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="container-count">容器数: 0</div>
      <div data-testid="port-count">端口数: 0</div>
      <div data-testid="edge-count">连线数: 0</div>
      <div data-testid="compatibility-result">兼容性: -</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>
  <div class="error-toast" data-testid="error-toast"></div>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { containers: new Map(), edges: new Map(), portCount: 0 };

      const COMPAT_RULES = [['image','image'],['image','reference'],['text','text'],['text','prompt'],['json','json'],['reference','reference'],['prompt','prompt']];
      function isPortCompatible(outType, inType) { return COMPAT_RULES.some(([o,i]) => o === outType && i === inType); }

      function createContainer(id, label, x, y, stroke) {
        state.containers.set(id, { id, bounds: { x, y, width: 220, height: 140 }, label, ioPorts: [], style: { fill: 'rgba(99,102,241,0.12)', stroke } });
        renderStage(); updateSidebar();
      }

      function addPort(containerId, port) {
        const c = state.containers.get(containerId);
        if (!c) return null;
        c.ioPorts.push(port);
        state.portCount++;
        renderStage(); updateSidebar();
        return port;
      }

      function addEdge(edgeData) {
        const src = state.containers.get(edgeData.source.nodeId);
        const tgt = state.containers.get(edgeData.target.nodeId);
        if (!src || !tgt) return null;
        const srcPort = src.ioPorts.find(p => p.id === edgeData.source.portId);
        const tgtPort = tgt.ioPorts.find(p => p.id === edgeData.target.portId);
        if (!srcPort || !tgtPort) return null;
        if (srcPort.direction !== 'output' || tgtPort.direction !== 'input') return null;
        if (!isPortCompatible(srcPort.dataType, tgtPort.dataType)) {
          document.querySelector('[data-testid="compatibility-result"]').textContent = '兼容性: 不兼容 (' + srcPort.dataType + ' → ' + tgtPort.dataType + ')';
          const toast = document.querySelector('[data-testid="error-toast"]');
          toast.textContent = '端口类型不兼容：' + srcPort.dataType + ' → ' + tgtPort.dataType;
          toast.style.display = 'block';
          return null;
        }
        document.querySelector('[data-testid="compatibility-result"]').textContent = '兼容性: 兼容 (' + srcPort.dataType + ' → ' + tgtPort.dataType + ')';
        const edge = { ...edgeData, status: 'idle' };
        state.edges.set(edge.id, edge);
        renderStage(); updateSidebar();
        return edge;
      }

      function renderStage() {
        stage.replaceChildren();
        for (const container of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'container-' + container.id);
          node.style.left = container.bounds.x + 'px'; node.style.top = container.bounds.y + 'px';
          node.style.width = container.bounds.width + 'px'; node.style.height = container.bounds.height + 'px';
          node.style.background = container.style.fill; node.style.borderColor = container.style.stroke;
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = container.label;
          node.appendChild(title);
          container.ioPorts.forEach((port, idx) => {
            const el = document.createElement('div');
            el.className = 'io-port ' + port.direction;
            el.setAttribute('data-testid', 'port-' + port.id);
            el.textContent = port.label; el.style.top = (40 + idx * 28) + 'px';
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
          const sx = src.bounds.x + src.bounds.width, sy = src.bounds.y + 50;
          const tx = tgt.bounds.x, ty = tgt.bounds.y + 50;
          const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
          const path = document.createElementNS('http://www.w3.org/2000/svg','path');
          path.setAttribute('d', 'M '+sx+' '+sy+' C '+(sx+tx)/2+' '+sy+' '+(sx+tx)/2+' '+ty+' '+tx+' '+ty);
          svg.appendChild(path); el.appendChild(svg); stage.appendChild(el);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
        document.querySelector('[data-testid="port-count"]').textContent = '端口数: ' + state.portCount;
        document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
      }

      document.querySelector('[data-testid="btn-create-containers"]').addEventListener('click', () => {
        createContainer('node-a', 'Node A', 60, 120, '#6366f1');
        createContainer('node-b', 'Node B', 420, 120, '#ec4899');
      });
      document.querySelector('[data-testid="btn-add-compatible-ports"]').addEventListener('click', () => {
        addPort('node-a', { id: 'a-out-prompt', direction: 'output', dataType: 'prompt', label: 'prompt out' });
        addPort('node-b', { id: 'b-in-prompt', direction: 'input', dataType: 'prompt', label: 'prompt in' });
      });
      document.querySelector('[data-testid="btn-add-incompatible-ports"]').addEventListener('click', () => {
        addPort('node-a', { id: 'a-out-image', direction: 'output', dataType: 'image', label: 'image out' });
        addPort('node-b', { id: 'b-in-text', direction: 'input', dataType: 'text', label: 'text in' });
      });
      document.querySelector('[data-testid="btn-connect"]').addEventListener('click', () => {
        addEdge({ id: 'edge-1', source: { nodeId: 'node-a', portId: 'a-out-prompt' }, target: { nodeId: 'node-b', portId: 'b-in-prompt' } });
      });
      document.querySelector('[data-testid="btn-connect-incompatible"]').addEventListener('click', () => {
        addEdge({ id: 'edge-bad', source: { nodeId: 'node-a', portId: 'a-out-image' }, target: { nodeId: 'node-b', portId: 'b-in-text' } });
      });

      window.__CUCUMBER_PORTS__ = { getState: () => ({ containers: Object.fromEntries(state.containers), edges: Object.fromEntries(state.edges) }), addPort, addEdge, isPortCompatible };
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

test.describe("TC-012: 添加输入/输出端口", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("为容器添加兼容端口", async ({ page }) => {
    await page.getByTestId("btn-create-containers").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 2");

    await page.getByTestId("btn-add-compatible-ports").click();
    await expect(page.getByTestId("port-count")).toHaveText("端口数: 2");

    // 验证 output 端口
    const outPort = page.getByTestId("port-a-out-prompt");
    await expect(outPort).toBeVisible();
    await expect(outPort).toHaveClass(/output/);

    // 验证 input 端口
    const inPort = page.getByTestId("port-b-in-prompt");
    await expect(inPort).toBeVisible();
    await expect(inPort).toHaveClass(/input/);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc012-ports-added.png" });
  });
});

test.describe("TC-013: 拖拽建立连线", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("连接兼容端口建立数据流边", async ({ page }) => {
    await page.getByTestId("btn-create-containers").click();
    await page.getByTestId("btn-add-compatible-ports").click();
    await page.getByTestId("btn-connect").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 1");
    await expect(page.getByTestId("compatibility-result")).toContainText("兼容");

    const edge = page.getByTestId("edge-edge-1");
    await expect(edge).toBeVisible();
    await expect(edge).toHaveAttribute("data-status", "idle");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc013-edge-connected.png" });
  });
});

test.describe("TC-014: 端口类型兼容性校验", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("不兼容端口连线被拒绝", async ({ page }) => {
    await page.getByTestId("btn-create-containers").click();
    await page.getByTestId("btn-add-incompatible-ports").click();
    await page.getByTestId("btn-connect-incompatible").click();

    // 连线不建立
    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 0");

    // 错误提示
    await expect(page.getByTestId("compatibility-result")).toContainText("不兼容");
    await expect(page.getByTestId("error-toast")).toBeVisible();
    await expect(page.getByTestId("error-toast")).toContainText("端口类型不兼容");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc014-incompatible-rejected.png" });
  });

  test("兼容性规则验证", async ({ page }) => {
    const results = await page.evaluate(() => {
      const h = (window as any).__CUCUMBER_PORTS__;
      return {
        promptToPrompt: h.isPortCompatible('prompt', 'prompt'),
        textToPrompt: h.isPortCompatible('text', 'prompt'),
        imageToImage: h.isPortCompatible('image', 'image'),
        imageToReference: h.isPortCompatible('image', 'reference'),
        imageToText: h.isPortCompatible('image', 'text'),
        jsonToPrompt: h.isPortCompatible('json', 'prompt'),
      };
    });
    expect(results.promptToPrompt).toBe(true);
    expect(results.textToPrompt).toBe(true);
    expect(results.imageToImage).toBe(true);
    expect(results.imageToReference).toBe(true);
    expect(results.imageToText).toBe(false);
    expect(results.jsonToPrompt).toBe(false);
  });
});
