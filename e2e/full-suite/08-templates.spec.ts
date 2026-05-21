import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - Container Templates</title>
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
    .template-card { background: rgba(30,41,59,0.8); border: 1px solid rgba(148,163,184,0.2); border-radius: 12px; padding: 10px; margin-bottom: 8px; }
    .template-card h4 { margin: 0 0 4px; font-size: 12px; }
    .template-card p { margin: 0; font-size: 11px; opacity: 0.7; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-list-templates" type="button">列出模板</button>
      <button data-testid="btn-instantiate-image" type="button">实例化图片管道</button>
      <button data-testid="btn-instantiate-review" type="button">实例化审阅流</button>
      <button data-testid="btn-save-custom" type="button">保存自定义模板</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="template-count">模板数: 0</div>
      <div data-testid="instance-containers">实例容器: 0</div>
      <div data-testid="instance-edges">实例连线: 0</div>
      <div data-testid="template-list"></div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const PRESET_TEMPLATES = [
        { id: 'preset_image-generation-pipeline', name: 'Image Generation Pipeline', description: 'Prompt → 图片', category: 'generation', icon: '🎨', tags: ['image','ai'], nodes: [{refId:'pg',label:'Prompt Generator',x:0,y:0,w:280,h:180},{refId:'ir',label:'Image Renderer',x:400,y:0,w:320,h:240}], edges: [{from:'pg',to:'ir'}] },
        { id: 'preset_text-refiner', name: 'Text Refiner', description: '文本润色工作流', category: 'text', icon: '✍️', tags: ['text','refine'], nodes: [{refId:'ti',label:'Text Input',x:0,y:0,w:240,h:160},{refId:'r1',label:'Refiner Round 1',x:340,y:0,w:260,h:160},{refId:'r2',label:'Refiner Round 2',x:680,y:0,w:260,h:160}], edges: [{from:'ti',to:'r1'},{from:'r1',to:'r2'}] },
        { id: 'preset_multi-agent-review', name: 'Multi-Agent Review', description: '多Agent并行审阅', category: 'collaboration', icon: '👥', tags: ['multi-agent','parallel'], nodes: [{refId:'src',label:'Content Source',x:0,y:100,w:240,h:160},{refId:'ra',label:'Reviewer A',x:380,y:0,w:240,h:140},{refId:'rb',label:'Reviewer B',x:380,y:160,w:240,h:140},{refId:'rc',label:'Reviewer C',x:380,y:320,w:240,h:140},{refId:'agg',label:'Aggregator',x:740,y:100,w:260,h:180}], edges: [{from:'src',to:'ra'},{from:'src',to:'rb'},{from:'src',to:'rc'},{from:'ra',to:'agg'},{from:'rb',to:'agg'},{from:'rc',to:'agg'}] },
      ];

      const state = { templates: [...PRESET_TEMPLATES], instances: { containers: [], edges: [] } };

      function listTemplates() {
        const listEl = document.querySelector('[data-testid="template-list"]');
        listEl.innerHTML = '';
        state.templates.forEach(t => {
          const card = document.createElement('div');
          card.className = 'template-card';
          card.setAttribute('data-testid', 'tpl-' + t.id);
          card.innerHTML = '<h4>' + t.icon + ' ' + t.name + '</h4><p>' + t.description + '</p><p>Tags: ' + t.tags.join(', ') + '</p>';
          listEl.appendChild(card);
        });
        updateSidebar();
      }

      function instantiate(templateId, offsetX, offsetY) {
        const tpl = state.templates.find(t => t.id === templateId);
        if (!tpl) return null;
        state.instances = { containers: [], edges: [] };
        stage.replaceChildren();
        tpl.nodes.forEach(n => {
          const id = templateId + '-' + n.refId;
          state.instances.containers.push(id);
          const node = document.createElement('div');
          node.className = 'container-node';
          node.setAttribute('data-testid', 'inst-' + n.refId);
          node.style.left = (n.x + (offsetX||0)) + 'px'; node.style.top = (n.y + (offsetY||0)) + 'px';
          node.style.width = n.w + 'px'; node.style.height = n.h + 'px';
          node.style.borderColor = '#6366f1'; node.style.background = 'rgba(99,102,241,0.08)';
          const title = document.createElement('div');
          title.className = 'container-title'; title.textContent = n.label;
          node.appendChild(title);
          stage.appendChild(node);
        });
        tpl.edges.forEach((e, i) => {
          state.instances.edges.push(e.from + '->' + e.to);
        });
        updateSidebar();
        return { containerIds: state.instances.containers, edgeCount: state.instances.edges.length };
      }

      function saveCustomTemplate(name, description) {
        const custom = { id: 'custom_' + Date.now(), name, description, category: 'custom', icon: '⭐', tags: ['custom'], nodes: state.instances.containers.map((id, i) => ({refId: 'n'+i, label: 'Node '+i, x: i*200, y: 0, w: 200, h: 120})), edges: [] };
        state.templates.push(custom);
        updateSidebar();
        return custom;
      }

      function updateSidebar() {
        document.querySelector('[data-testid="template-count"]').textContent = '模板数: ' + state.templates.length;
        document.querySelector('[data-testid="instance-containers"]').textContent = '实例容器: ' + state.instances.containers.length;
        document.querySelector('[data-testid="instance-edges"]').textContent = '实例连线: ' + state.instances.edges.length;
      }

      document.querySelector('[data-testid="btn-list-templates"]').addEventListener('click', listTemplates);
      document.querySelector('[data-testid="btn-instantiate-image"]').addEventListener('click', () => instantiate('preset_image-generation-pipeline', 50, 50));
      document.querySelector('[data-testid="btn-instantiate-review"]').addEventListener('click', () => instantiate('preset_multi-agent-review', 20, 20));
      document.querySelector('[data-testid="btn-save-custom"]').addEventListener('click', () => saveCustomTemplate('My Custom Flow', 'A custom workflow'));

      window.__CUCUMBER_TEMPLATES__ = { getState: () => state, listTemplates: () => state.templates, instantiate, saveCustomTemplate };
      updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("template-count")).toHaveText("模板数: 3");
}

test.describe("TC-024: 浏览预设模板", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("列出所有预设模板", async ({ page }) => {
    await page.getByTestId("btn-list-templates").click();

    // 验证 3 个模板卡片
    const cards = page.locator(".template-card");
    await expect(cards).toHaveCount(3);

    // 验证各模板可见
    await expect(page.getByTestId("tpl-preset_image-generation-pipeline")).toBeVisible();
    await expect(page.getByTestId("tpl-preset_text-refiner")).toBeVisible();
    await expect(page.getByTestId("tpl-preset_multi-agent-review")).toBeVisible();

    // 验证模板内容
    await expect(page.getByTestId("tpl-preset_image-generation-pipeline")).toContainText("Image Generation Pipeline");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc024-template-list.png" });
  });

  test("模板包含完整元数据", async ({ page }) => {
    const templates = await page.evaluate(() => (window as any).__CUCUMBER_TEMPLATES__.listTemplates());
    expect(templates).toHaveLength(3);

    for (const tpl of templates) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.name).toBeTruthy();
      expect(tpl.description).toBeTruthy();
      expect(tpl.icon).toBeTruthy();
      expect(tpl.tags.length).toBeGreaterThan(0);
    }
  });
});

test.describe("TC-025: 实例化模板", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("实例化图片生成管道模板", async ({ page }) => {
    await page.getByTestId("btn-instantiate-image").click();

    await expect(page.getByTestId("instance-containers")).toHaveText("实例容器: 2");
    await expect(page.getByTestId("instance-edges")).toHaveText("实例连线: 1");

    // 验证容器可见
    await expect(page.getByTestId("inst-pg")).toBeVisible();
    await expect(page.getByTestId("inst-ir")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc025-image-pipeline-instantiated.png" });
  });

  test("实例化多Agent审阅流模板", async ({ page }) => {
    await page.getByTestId("btn-instantiate-review").click();

    await expect(page.getByTestId("instance-containers")).toHaveText("实例容器: 5");
    await expect(page.getByTestId("instance-edges")).toHaveText("实例连线: 6");

    await expect(page.getByTestId("inst-src")).toBeVisible();
    await expect(page.getByTestId("inst-ra")).toBeVisible();
    await expect(page.getByTestId("inst-agg")).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc025-review-instantiated.png" });
  });
});

test.describe("TC-026: 保存自定义模板", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("保存当前工作流为自定义模板", async ({ page }) => {
    // 先实例化一个模板作为基础
    await page.getByTestId("btn-instantiate-image").click();
    await expect(page.getByTestId("instance-containers")).toHaveText("实例容器: 2");

    // 保存为自定义模板
    await page.getByTestId("btn-save-custom").click();

    // 模板数 +1
    await expect(page.getByTestId("template-count")).toHaveText("模板数: 4");

    // 验证新模板存在
    const templates = await page.evaluate(() => (window as any).__CUCUMBER_TEMPLATES__.listTemplates());
    expect(templates).toHaveLength(4);
    const custom = templates.find((t: any) => t.category === 'custom');
    expect(custom).toBeDefined();
    expect(custom.name).toBe("My Custom Flow");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc026-custom-saved.png" });
  });
});
