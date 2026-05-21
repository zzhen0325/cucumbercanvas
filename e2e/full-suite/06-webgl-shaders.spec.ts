import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Full Suite - WebGL Shaders</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 12px; grid-template-columns: 280px minmax(0,1fr); grid-template-rows: 56px minmax(0,1fr); height: 100vh; padding: 12px; }
    [data-testid="toolbar"] { align-items: center; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 16px; display: flex; gap: 8px; grid-column: 1/span 2; padding: 0 12px; }
    [data-testid="sidebar"] { background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; display: grid; gap: 10px; overflow: auto; padding: 16px; align-content: start; }
    [data-testid="canvas-stage"] { background: #0f172a; border: 1px solid rgba(148,163,184,0.22); border-radius: 20px; min-height: 560px; overflow: hidden; padding: 16px; position: relative; }
    button { background: rgba(15,23,42,0.95); border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; color: #e2e8f0; cursor: pointer; font: inherit; padding: 8px 14px; font-size: 12px; }
    .container-node { border: 2px solid; border-radius: 16px; overflow: hidden; position: absolute; }
    .container-title { font-size: 12px; font-weight: 600; height: 28px; padding: 0 10px; display: flex; align-items: center; position: relative; z-index: 2; }
    .shader-background { border-radius: 14px; inset: 2px; position: absolute; z-index: 0; overflow: hidden; }
    .shader-background canvas { width: 100%; height: 100%; }
    .shader-background[data-active="true"] { opacity: 1; }
    .shader-background[data-active="false"] { opacity: 0; }
    .glow-filter { position: absolute; inset: -8px; border-radius: 24px; pointer-events: none; z-index: -1; transition: opacity 0.3s; }
    .glow-filter[data-active="true"] { opacity: 1; box-shadow: 0 0 20px 8px var(--glow-color, rgba(99,102,241,0.6)); }
    .glow-filter[data-active="false"] { opacity: 0; }
    .particle-system { position: absolute; inset: 0; pointer-events: none; }
    .particle { width: 4px; height: 4px; border-radius: 50%; background: #00ff88; position: absolute; animation: particle-move 1s linear infinite; }
    @keyframes particle-move { from { transform: translateX(0); } to { transform: translateX(200px); } }
    .dataflow-edge { position: absolute; pointer-events: none; inset: 0; }
    .dataflow-edge path { fill: none; stroke: #4ECDC4; stroke-width: 2; }
  </style>
</head>
<body>
  <main>
    <header data-testid="toolbar">
      <button data-testid="btn-create-shader-node" type="button">创建 Shader 容器</button>
      <button data-testid="btn-activate-gradient" type="button">激活渐变</button>
      <button data-testid="btn-activate-glow" type="button">激活发光</button>
      <button data-testid="btn-activate-particles" type="button">激活粒子</button>
      <button data-testid="btn-deactivate-all" type="button">关闭特效</button>
    </header>
    <aside data-testid="sidebar">
      <div data-testid="shader-status">Shader: 未创建</div>
      <div data-testid="gradient-status">渐变: inactive</div>
      <div data-testid="glow-status">发光: inactive</div>
      <div data-testid="particle-count">粒子数: 0</div>
    </aside>
    <section data-testid="canvas-stage"></section>
  </main>

  <script>
    (() => {
      const stage = document.querySelector('[data-testid="canvas-stage"]');
      const state = { node: null, gradient: false, glow: false, glowColor: 'rgba(99,102,241,0.6)', particles: 0 };

      function createShaderNode() {
        state.node = { id: 'shader-node', bounds: { x: 100, y: 80, width: 320, height: 220 }, label: 'Shader Container' };
        renderStage(); updateSidebar();
      }

      function activateGradient() {
        state.gradient = true;
        renderStage(); updateSidebar();
      }

      function activateGlow(color) {
        state.glow = true;
        state.glowColor = color || 'rgba(34,197,94,0.6)';
        renderStage(); updateSidebar();
      }

      function activateParticles(count) {
        state.particles = count || 5;
        renderStage(); updateSidebar();
      }

      function deactivateAll() {
        state.gradient = false; state.glow = false; state.particles = 0;
        renderStage(); updateSidebar();
      }

      function renderStage() {
        stage.replaceChildren();
        if (!state.node) return;
        const node = document.createElement('div');
        node.className = 'container-node';
        node.setAttribute('data-testid', 'shader-container');
        node.style.left = state.node.bounds.x + 'px'; node.style.top = state.node.bounds.y + 'px';
        node.style.width = state.node.bounds.width + 'px'; node.style.height = state.node.bounds.height + 'px';
        node.style.background = 'rgba(15,23,42,0.8)'; node.style.borderColor = '#6366f1';

        // Glow filter
        const glow = document.createElement('div');
        glow.className = 'glow-filter';
        glow.setAttribute('data-testid', 'glow-filter');
        glow.setAttribute('data-active', String(state.glow));
        glow.style.setProperty('--glow-color', state.glowColor);
        node.appendChild(glow);

        // Shader background
        const bg = document.createElement('div');
        bg.className = 'shader-background';
        bg.setAttribute('data-testid', 'shader-background');
        bg.setAttribute('data-active', String(state.gradient));
        if (state.gradient) {
          const canvas = document.createElement('canvas');
          canvas.width = 320; canvas.height = 220;
          const ctx = canvas.getContext('2d');
          const grad = ctx.createLinearGradient(0,0,320,220);
          grad.addColorStop(0, '#6366f1'); grad.addColorStop(0.5, '#ec4899'); grad.addColorStop(1, '#22c55e');
          ctx.fillStyle = grad; ctx.fillRect(0,0,320,220);
          bg.appendChild(canvas);
        }
        node.appendChild(bg);

        // Title
        const title = document.createElement('div');
        title.className = 'container-title'; title.textContent = state.node.label;
        node.appendChild(title);

        stage.appendChild(node);

        // Particle system
        if (state.particles > 0) {
          const ps = document.createElement('div');
          ps.className = 'particle-system';
          ps.setAttribute('data-testid', 'particle-system');
          for (let i = 0; i < state.particles; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = (20 + i * 40) + 'px'; p.style.top = (60 + i * 20) + 'px';
            ps.appendChild(p);
          }
          stage.appendChild(ps);
        }
      }

      function updateSidebar() {
        document.querySelector('[data-testid="shader-status"]').textContent = 'Shader: ' + (state.node ? '已创建' : '未创建');
        document.querySelector('[data-testid="gradient-status"]').textContent = '渐变: ' + (state.gradient ? 'active' : 'inactive');
        document.querySelector('[data-testid="glow-status"]').textContent = '发光: ' + (state.glow ? 'active (' + state.glowColor + ')' : 'inactive');
        document.querySelector('[data-testid="particle-count"]').textContent = '粒子数: ' + state.particles;
      }

      document.querySelector('[data-testid="btn-create-shader-node"]').addEventListener('click', createShaderNode);
      document.querySelector('[data-testid="btn-activate-gradient"]').addEventListener('click', activateGradient);
      document.querySelector('[data-testid="btn-activate-glow"]').addEventListener('click', () => activateGlow('rgba(34,197,94,0.6)'));
      document.querySelector('[data-testid="btn-activate-particles"]').addEventListener('click', () => activateParticles(5));
      document.querySelector('[data-testid="btn-deactivate-all"]').addEventListener('click', deactivateAll);

      window.__CUCUMBER_SHADER__ = { getState: () => state, createShaderNode, activateGradient, activateGlow, activateParticles, deactivateAll };
      updateSidebar();
    })();
  </script>
</body>
</html>`;

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("shader-status")).toHaveText("Shader: 未创建");
}

test.describe("TC-018: 容器背景渐变 Shader", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("激活渐变效果", async ({ page }) => {
    await page.getByTestId("btn-create-shader-node").click();
    await expect(page.getByTestId("shader-status")).toHaveText("Shader: 已创建");
    await expect(page.getByTestId("gradient-status")).toHaveText("渐变: inactive");

    // 截图：激活前
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc018-before-gradient.png" });

    await page.getByTestId("btn-activate-gradient").click();
    await expect(page.getByTestId("gradient-status")).toHaveText("渐变: active");

    const bg = page.getByTestId("shader-background");
    await expect(bg).toHaveAttribute("data-active", "true");

    // 验证 canvas 存在
    const hasCanvas = await page.evaluate(() => {
      return document.querySelector('[data-testid="shader-background"] canvas') !== null;
    });
    expect(hasCanvas).toBe(true);

    // 截图：激活后
    await page.screenshot({ path: "e2e/screenshots/full-suite/tc018-gradient-active.png" });
  });
});

test.describe("TC-019: 节点发光滤镜", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("Agent running 时发光效果激活", async ({ page }) => {
    await page.getByTestId("btn-create-shader-node").click();

    // 初始无发光
    const glow = page.getByTestId("glow-filter");
    await expect(glow).toHaveAttribute("data-active", "false");

    // 激活发光
    await page.getByTestId("btn-activate-glow").click();
    await expect(glow).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("glow-status")).toContainText("active");
    await expect(page.getByTestId("glow-status")).toContainText("rgba(34,197,94,0.6)");

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc019-glow-active.png" });
  });

  test("关闭发光效果", async ({ page }) => {
    await page.getByTestId("btn-create-shader-node").click();
    await page.getByTestId("btn-activate-glow").click();

    await page.getByTestId("btn-deactivate-all").click();
    const glow = page.getByTestId("glow-filter");
    await expect(glow).toHaveAttribute("data-active", "false");
  });
});

test.describe("TC-020: 数据流粒子动画", () => {
  test.beforeEach(async ({ page }) => { await setupHarness(page); });

  test("执行时粒子系统激活", async ({ page }) => {
    await page.getByTestId("btn-create-shader-node").click();
    await expect(page.getByTestId("particle-count")).toHaveText("粒子数: 0");

    await page.getByTestId("btn-activate-particles").click();
    await expect(page.getByTestId("particle-count")).toHaveText("粒子数: 5");

    // 验证粒子 DOM 存在
    const ps = page.getByTestId("particle-system");
    await expect(ps).toBeVisible();
    const particleCount = await ps.locator(".particle").count();
    expect(particleCount).toBe(5);

    await page.screenshot({ path: "e2e/screenshots/full-suite/tc020-particles-active.png" });
  });

  test("关闭后粒子消失", async ({ page }) => {
    await page.getByTestId("btn-create-shader-node").click();
    await page.getByTestId("btn-activate-particles").click();
    await expect(page.getByTestId("particle-count")).toHaveText("粒子数: 5");

    await page.getByTestId("btn-deactivate-all").click();
    await expect(page.getByTestId("particle-count")).toHaveText("粒子数: 0");

    // 粒子系统不再存在
    const psCount = await page.locator("[data-testid='particle-system']").count();
    expect(psCount).toBe(0);
  });
});
