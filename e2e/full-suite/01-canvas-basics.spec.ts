import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Canvas Basics</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 280px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; overflow: visible; position: absolute; }
    .container-node.selected { box-shadow: 0 0 0 3px rgba(99,102,241,0.5); }
    .container-title { align-items: center; display: flex; font-size: 12px; font-weight: 600; height: 28px; padding: 0 10px; }
    .selection-box { border: 1px dashed #6366f1; background: rgba(99,102,241,0.08); position: absolute; pointer-events: none; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-container" type="button">创建容器</button>
      <button data-testid="btn-undo" type="button">撤销</button>
      <button data-testid="btn-redo" type="button">重做</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="zoom-level">Zoom: 1.00</div>
      <div data-testid="pan-offset">Pan: (0, 0)</div>
      <div data-testid="container-count">容器数: 0</div>
      <div data-testid="selection-count">选中: 0</div>
      <div data-testid="history-index">History: 0/0</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const MIN_ZOOM = 0.1, MAX_ZOOM = 5.0;
      const state = {
        zoom: 1, panX: 0, panY: 0,
        containers: new Map(),
        selectedIds: new Set(),
        history: [], historyIndex: -1,
        isPanning: false, spaceDown: false,
      };
      let containerCounter = 0;

      function pushHistory(action) {
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(action);
        state.historyIndex = state.history.length - 1;
        updateSidebar();
      }

      function undo() {
        if (state.historyIndex < 0) return;
        const action = state.history[state.historyIndex];
        if (action.type === 'create') { state.containers.delete(action.id); }
        state.historyIndex--;
        renderStage(); updateSidebar();
      }

      function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        const action = state.history[state.historyIndex];
        if (action.type === 'create') { state.containers.set(action.id, action.container); }
        renderStage(); updateSidebar();
      }

      function createContainer(x, y) {
        const id = 'container-' + (++containerCounter);
        const container = { id, bounds: { x: x || 60 + containerCounter * 30, y: y || 60 + containerCounter * 30, width: 220, height: 140 }, label: '容器 ' + containerCounter, selected: false };
        state.containers.set(id, container);
        pushHistory({ type: 'create', id, container });
        renderStage(); updateSidebar();
        return container;
      }

      function selectAll() {
        state.selectedIds.clear();
        for (const [id] of state.containers) { state.selectedIds.add(id); }
        renderStage(); updateSidebar();
      }

      function setZoom(z) {
        state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        updateSidebar();
      }

      function setPan(x, y) { state.panX = x; state.panY = y; updateSidebar(); }

      function renderStage() {
        stage.replaceChildren();
        for (const container of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node' + (state.selectedIds.has(container.id) ? ' selected' : '');
          node.dataset.containerId = container.id;
          node.setAttribute('data-testid', container.id);
          node.style.left = (container.bounds.x * state.zoom + state.panX) + 'px';
          node.style.top = (container.bounds.y * state.zoom + state.panY) + 'px';
          node.style.width = (container.bounds.width * state.zoom) + 'px';
          node.style.height = (container.bounds.height * state.zoom) + 'px';
          node.style.background = 'rgba(99,102,241,0.12)';
          node.style.borderColor = '#6366f1';
          const title = document.createElement('div');
          title.className = 'container-title';
          title.textContent = container.label;
          node.appendChild(title);
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="zoom-level"]').textContent = 'Zoom: ' + state.zoom.toFixed(2);
        document.querySelector('[data-testid="pan-offset"]').textContent = 'Pan: (' + Math.round(state.panX) + ', ' + Math.round(state.panY) + ')';
        document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
        document.querySelector('[data-testid="selection-count"]').textContent = '选中: ' + state.selectedIds.size;
        document.querySelector('[data-testid="history-index"]').textContent = 'History: ' + (state.historyIndex + 1) + '/' + state.history.length;
      }

      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(state.zoom + delta);
        renderStage();
      }, { passive: false });

      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') { state.spaceDown = true; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); }
      });
      document.addEventListener('keyup', (e) => { if (e.code === 'Space') state.spaceDown = false; });

      let dragStart = null;
      stage.addEventListener('mousedown', (e) => {
        if (state.spaceDown) { state.isPanning = true; dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY }; }
      });
      document.addEventListener('mousemove', (e) => {
        if (state.isPanning && dragStart) { setPan(e.clientX - dragStart.x, e.clientY - dragStart.y); renderStage(); }
      });
      document.addEventListener('mouseup', () => { state.isPanning = false; dragStart = null; });

      document.querySelector('[data-testid="btn-create-container"]').addEventListener('click', () => createContainer());
      document.querySelector('[data-testid="btn-undo"]').addEventListener('click', undo);
      document.querySelector('[data-testid="btn-redo"]').addEventListener('click', redo);

      window.__CUCUMBER_CANVAS__ = { getState: () => ({ ...state, containers: Object.fromEntries(state.containers), selectedIds: [...state.selectedIds] }), createContainer, setZoom, setPan, selectAll, undo, redo };
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

test.describe("TC-001: 画布缩放操作", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("用户通过滚轮放大画布", async ({ page }) => {
    // 创建一个容器作为参照物
    await page.getByTestId("btn-create-container").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");

    // 截图：缩放前
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc001-before-zoom.png" });

    // 在画布中心向上滚动（放大）
    const stage = page.getByTestId("canvas-stage");
    await stage.hover();
    await page.mouse.wheel(0, -300);

    // 验证 zoom 增大
    const zoomText = await page.getByTestId("zoom-level").textContent();
    const zoomValue = parseFloat(zoomText!.replace("Zoom: ", ""));
    expect(zoomValue).toBeGreaterThan(1.0);

    // 截图：缩放后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc001-after-zoom-in.png" });
  });

  test("用户通过滚轮缩小画布", async ({ page }) => {
    const stage = page.getByTestId("canvas-stage");
    await stage.hover();

    // 向下滚动（缩小）
    await page.mouse.wheel(0, 500);

    const zoomText = await page.getByTestId("zoom-level").textContent();
    const zoomValue = parseFloat(zoomText!.replace("Zoom: ", ""));
    expect(zoomValue).toBeLessThan(1.0);
  });

  test("zoom 不超过边界值", async ({ page }) => {
    const stage = page.getByTestId("canvas-stage");
    await stage.hover();

    // 大量向下滚动尝试突破下界
    for (let i = 0; i < 50; i++) { await page.mouse.wheel(0, 300); }

    const zoomText = await page.getByTestId("zoom-level").textContent();
    const zoomValue = parseFloat(zoomText!.replace("Zoom: ", ""));
    expect(zoomValue).toBeGreaterThanOrEqual(0.1);

    // 大量向上滚动尝试突破上界
    for (let i = 0; i < 200; i++) { await page.mouse.wheel(0, -300); }

    const zoomText2 = await page.getByTestId("zoom-level").textContent();
    const zoomValue2 = parseFloat(zoomText2!.replace("Zoom: ", ""));
    expect(zoomValue2).toBeLessThanOrEqual(5.0);
  });
});

test.describe("TC-002: 画布平移操作", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("用户通过空格+拖拽平移画布", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();

    // 截图：平移前
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc002-before-pan.png" });

    const stage = page.getByTestId("canvas-stage");
    const box = await stage.boundingBox();

    // 按住空格，在画布上拖拽
    await page.keyboard.down("Space");
    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 300, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Space");

    // 验证 pan 偏移
    const panText = await page.getByTestId("pan-offset").textContent();
    expect(panText).not.toBe("Pan: (0, 0)");

    // 截图：平移后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc002-after-pan.png" });
  });
});

test.describe("TC-003: 多选操作", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("用户通过 Ctrl+A 全选容器", async ({ page }) => {
    // 创建 3 个容器
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-create-container").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 3");

    // Ctrl+A 全选
    await page.keyboard.press("Control+a");

    // 验证选中数量
    await expect(page.getByTestId("selection-count")).toHaveText("选中: 3");

    // 截图
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc003-all-selected.png" });
  });
});

test.describe("TC-004: 快捷键撤销/重做", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Ctrl+Z 撤销创建操作", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");

    // 截图：创建后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc004-after-create.png" });

    // 撤销
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 0");

    // 截图：撤销后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc004-after-undo.png" });
  });

  test("Ctrl+Y 重做操作", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 0");

    // 重做
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");

    // 截图：重做后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc004-after-redo.png" });
  });

  test("History 索引正确跟踪", async ({ page }) => {
    await page.getByTestId("btn-create-container").click();
    await page.getByTestId("btn-create-container").click();
    await expect(page.getByTestId("history-index")).toHaveText("History: 2/2");

    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("history-index")).toHaveText("History: 1/2");

    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("history-index")).toHaveText("History: 0/2");
  });
});
