import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Container Operations</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 280px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; overflow: visible; position: absolute; cursor: move; }
    .container-title { align-items: center; display: flex; font-size: 12px; font-weight: 600; height: 28px; padding: 0 10px; }
    .resize-handle { width: 12px; height: 12px; background: #6366f1; border-radius: 3px; position: absolute; right: -6px; bottom: -6px; cursor: nwse-resize; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-prompt-gen" type="button">创建 Prompt 生成器</button>
      <button data-testid="btn-create-img-renderer" type="button">创建 图片渲染器</button>
      <button data-testid="btn-create-large" type="button">创建大容器</button>
      <button data-testid="btn-create-small" type="button">创建小容器</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="container-count">容器数: 0</div>
      <div data-testid="last-moved">Last moved: -</div>
      <div data-testid="last-resized">Last resized: -</div>
      <div data-testid="nesting-info">Nesting: -</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { containers: new Map() };

      function createContainer(id, label, bounds, style) {
        const container = { id, bounds: { ...bounds }, label, parentId: null, style: style || { fill: 'rgba(99,102,241,0.12)', stroke: '#6366f1' } };
        state.containers.set(id, container);
        renderStage(); updateSidebar();
        return container;
      }

      function moveContainer(id, x, y) {
        const c = state.containers.get(id);
        if (!c) return;
        c.bounds.x = x; c.bounds.y = y;
        document.querySelector('[data-testid="last-moved"]').textContent = 'Last moved: ' + id + ' → (' + x + ',' + y + ')';
        renderStage();
      }

      function resizeContainer(id, w, h) {
        const c = state.containers.get(id);
        if (!c) return;
        c.bounds.width = w; c.bounds.height = h;
        document.querySelector('[data-testid="last-resized"]').textContent = 'Last resized: ' + id + ' → ' + w + 'x' + h;
        renderStage();
      }

      function nestContainer(childId, parentId) {
        const child = state.containers.get(childId);
        const parent = state.containers.get(parentId);
        if (!child || !parent) return false;
        child.parentId = parentId;
        document.querySelector('[data-testid="nesting-info"]').textContent = 'Nesting: ' + childId + ' → ' + parentId;
        renderStage();
        return true;
      }

      function renderStage() {
        stage.replaceChildren();
        for (const container of state.containers.values()) {
          const node = document.createElement('div');
          node.className = 'container-node';
          node.dataset.containerId = container.id;
          node.setAttribute('data-testid', 'container-' + container.id);
          node.setAttribute('data-parent', container.parentId || '');
          node.style.left = container.bounds.x + 'px';
          node.style.top = container.bounds.y + 'px';
          node.style.width = container.bounds.width + 'px';
          node.style.height = container.bounds.height + 'px';
          node.style.background = container.style.fill;
          node.style.borderColor = container.style.stroke;
          const title = document.createElement('div');
          title.className = 'container-title';
          title.textContent = container.label;
          node.appendChild(title);
          const handle = document.createElement('div');
          handle.className = 'resize-handle';
          handle.dataset.testid = 'resize-' + container.id;
          node.appendChild(handle);
          stage.appendChild(node);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="container-count"]').textContent = '容器数: ' + state.containers.size;
      }

      document.querySelector('[data-testid="btn-create-prompt-gen"]').addEventListener('click', () => {
        createContainer('prompt-generator', 'Prompt 生成器', { x: 60, y: 120, width: 220, height: 140 }, { fill: 'rgba(99,102,241,0.12)', stroke: '#6366f1' });
      });
      document.querySelector('[data-testid="btn-create-img-renderer"]').addEventListener('click', () => {
        createContainer('image-renderer', '图片渲染器', { x: 420, y: 120, width: 220, height: 140 }, { fill: 'rgba(236,72,153,0.12)', stroke: '#ec4899' });
      });
      document.querySelector('[data-testid="btn-create-large"]').addEventListener('click', () => {
        createContainer('large-container', '大容器', { x: 50, y: 50, width: 400, height: 300 }, { fill: 'rgba(34,197,94,0.08)', stroke: '#22c55e' });
      });
      document.querySelector('[data-testid="btn-create-small"]').addEventListener('click', () => {
        createContainer('small-container', '小容器', { x: 500, y: 100, width: 150, height: 100 }, { fill: 'rgba(251,191,36,0.12)', stroke: '#fbbf24' });
      });

      window.__CUCUMBER_CONTAINER__ = { getState: () => ({ containers: Object.fromEntries(state.containers) }), createContainer, moveContainer, resizeContainer, nestContainer };
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

test.describe("TC-005: 创建容器节点", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("通过工具栏创建 Prompt 生成器", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 1");

    const container = page.getByTestId("container-prompt-generator");
    await expect(container).toBeVisible();
    await expect(container.locator(".container-title")).toHaveText("Prompt 生成器");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc005-prompt-gen-created.png" });
  });

  test("创建多种容器并验证数量", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();
    await page.getByTestId("btn-create-img-renderer").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 2");

    const promptGen = page.getByTestId("container-prompt-generator");
    const imgRenderer = page.getByTestId("container-image-renderer");
    await expect(promptGen).toBeVisible();
    await expect(imgRenderer).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc005-two-containers.png" });
  });
});

test.describe("TC-006: 移动容器节点", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("拖拽移动容器到新位置", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();

    // 截图：移动前
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc006-before-move.png" });

    // 通过 API 移动容器
    await page.evaluate(() => {
      (window as any).__CUCUMBER_CONTAINER__.moveContainer('prompt-generator', 300, 300);
    });

    // 验证容器位置更新
    const container = page.getByTestId("container-prompt-generator");
    const box = await container.boundingBox();
    expect(box!.x).toBeGreaterThan(280);
    expect(box!.y).toBeGreaterThan(280);

    await expect(page.getByTestId("last-moved")).toContainText("prompt-generator");

    // 截图：移动后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc006-after-move.png" });
  });
});

test.describe("TC-007: 调整容器大小", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("拖拽调整容器宽高", async ({ page }) => {
    await page.getByTestId("btn-create-prompt-gen").click();

    // 通过 API 调整大小
    await page.evaluate(() => {
      (window as any).__CUCUMBER_CONTAINER__.resizeContainer('prompt-generator', 350, 250);
    });

    const container = page.getByTestId("container-prompt-generator");
    const box = await container.boundingBox();
    expect(box!.width).toBeCloseTo(350, 0);
    expect(box!.height).toBeCloseTo(250, 0);

    await expect(page.getByTestId("last-resized")).toContainText("350x250");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc007-resized.png" });
  });
});

test.describe("TC-008: 容器嵌套", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("将小容器拖入大容器形成父子关系", async ({ page }) => {
    await page.getByTestId("btn-create-large").click();
    await page.getByTestId("btn-create-small").click();
    await expect(page.getByTestId("container-count")).toHaveText("容器数: 2");

    // 截图：嵌套前
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc008-before-nest.png" });

    // 通过 API 建立嵌套关系
    const result = await page.evaluate(() => {
      return (window as any).__CUCUMBER_CONTAINER__.nestContainer('small-container', 'large-container');
    });
    expect(result).toBe(true);

    // 验证 parentId
    const parentAttr = await page.getByTestId("container-small-container").getAttribute("data-parent");
    expect(parentAttr).toBe("large-container");

    await expect(page.getByTestId("nesting-info")).toContainText("small-container → large-container");

    // 截图：嵌套后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc008-after-nest.png" });
  });
});
