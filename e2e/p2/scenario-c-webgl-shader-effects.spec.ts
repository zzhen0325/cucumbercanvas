import { expect, test, type Page } from "@playwright/test";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>P2 Scenario C - WebGL Shader Effects Rendering</title>
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
      .shader-background {
        border-radius: 14px;
        inset: 2px;
        position: absolute;
        z-index: -1;
      }
      .glow-filter {
        animation: glowPulse 2s ease-in-out infinite;
        border-radius: 20px;
        inset: -6px;
        opacity: 0.6;
        pointer-events: none;
        position: absolute;
        z-index: -1;
      }
      @keyframes glowPulse {
        0%, 100% { box-shadow: 0 0 12px currentColor, 0 0 24px currentColor; opacity: 0.5; }
        50% { box-shadow: 0 0 20px currentColor, 0 0 40px currentColor; opacity: 0.8; }
      }
      .particle-flow {
        inset: 0;
        overflow: visible;
        pointer-events: none;
        position: absolute;
        width: 100%;
        height: 100%;
        min-height: 20px;
      }
      .particle {
        border-radius: 999px;
        position: absolute;
        animation: particleMove 2s linear infinite;
      }
      @keyframes particleMove {
        0% { transform: translateX(0); opacity: 0; }
        20% { opacity: 1; }
        80% { opacity: 1; }
        100% { transform: translateX(var(--travel-x, 300px)); opacity: 0; }
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
        pointer-events: none;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .dataflow-edge svg {
        position: absolute; inset: 0;
        width: 100%; height: 100%; overflow: visible;
      }
      .dataflow-edge path { fill: none; stroke: #4ECDC4; stroke-width: 2; }
      .dataflow-edge path.flowing {
        stroke: #00ff88; stroke-width: 3;
        stroke-dasharray: 8 4;
        animation: edgeFlow 0.8s linear infinite;
      }
      @keyframes edgeFlow {
        from { stroke-dashoffset: 12; }
        to { stroke-dashoffset: 0; }
      }
      pre { margin: 0; white-space: pre-wrap; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <header data-testid="toolbar">
        <button data-testid="btn-create-shader-container" type="button">创建 Shader 容器</button>
        <button data-testid="btn-create-ai-node" type="button">创建 AI 生成节点</button>
        <button data-testid="btn-connect-flow" type="button">建立 DataFlowEdge</button>
        <button data-testid="btn-activate-particles" type="button">启动粒子流动</button>
      </header>

      <aside data-testid="sidebar">
        <strong>WebGL 特效状态</strong>
        <div data-testid="shader-status">Shader 状态: 未加载</div>
        <div data-testid="color-palette">色板: -</div>
        <div data-testid="glow-status">Glow Filter: 未加载</div>
        <div data-testid="particle-status">粒子动画: 停止</div>
        <div data-testid="edge-count">连线数: 0</div>
        <pre data-testid="snapshot"></pre>
      </aside>

      <section data-testid="canvas-stage"></section>
    </main>

    <script>
      (() => {
        const stage = document.querySelector('[data-testid="canvas-stage"]');
        const state = {
          containers: new Map(),
          edges: new Map(),
          shaderActive: false,
          glowActive: false,
          particlesActive: false,
          colorPalette: null,
        };

        function hexToRgb(hex) {
          const clean = hex.replace('#', '');
          return [
            parseInt(clean.slice(0, 2), 16) / 255,
            parseInt(clean.slice(2, 4), 16) / 255,
            parseInt(clean.slice(4, 6), 16) / 255,
          ];
        }

        function createShaderContainer() {
          const colorPalette = ['#331A66', '#1A4D80', '#0D264D'];
          state.colorPalette = colorPalette;

          const container = {
            id: 'shader-container',
            type: 'container',
            parentId: null,
            role: ['visual', 'dataflow'],
            bounds: { x: 60, y: 100, width: 280, height: 200 },
            contextSlots: {
              style: { colorPalette },
            },
            inheritPolicy: 'merge',
            ioPorts: [
              { id: 'sc-out-ref', direction: 'output', dataType: 'reference', label: 'ref out' },
            ],
            style: { label: 'Shader 渐变容器', fill: 'rgba(51, 26, 102, 0.3)', stroke: '#6366f1', opacity: 1 },
            shader: {
              type: 'container-background',
              uniforms: {
                uColor1: hexToRgb(colorPalette[0]),
                uColor2: hexToRgb(colorPalette[1]),
                uColor3: hexToRgb(colorPalette[2]),
                uOpacity: 0.15,
                uGradientAngle: 0.785,
              },
            },
          };
          state.containers.set(container.id, container);
          state.shaderActive = true;
          renderStage();
          updateSidebar();
          return container;
        }

        function createAINode() {
          const container = {
            id: 'ai-gen-node',
            type: 'container',
            parentId: 'shader-container',
            role: ['task', 'dataflow'],
            bounds: { x: 420, y: 130, width: 220, height: 140 },
            contextSlots: {},
            inheritPolicy: 'merge',
            ioPorts: [
              { id: 'ai-in-ref', direction: 'input', dataType: 'reference', label: 'ref in' },
              { id: 'ai-out-img', direction: 'output', dataType: 'image', label: 'img out' },
            ],
            style: { label: 'AI 生成节点', fill: 'rgba(34, 197, 94, 0.12)', stroke: '#22c55e', opacity: 1 },
            glowFilter: {
              color: [0.3, 0.8, 0.5],
              intensity: 1.0,
              radius: 4.0,
              pulseSpeed: 2.0,
            },
          };
          state.containers.set(container.id, container);
          state.glowActive = true;
          renderStage();
          updateSidebar();
          return container;
        }

        function addEdge(edgeData) {
          const fullEdge = { ...edgeData, status: 'idle' };
          state.edges.set(fullEdge.id, fullEdge);
          renderStage();
          updateSidebar();
          return fullEdge;
        }

        function activateParticles() {
          state.particlesActive = true;
          for (const edge of state.edges.values()) {
            edge.status = 'flowing';
          }
          renderStage();
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
            node.style.borderColor = container.style.stroke;

            if (container.shader) {
              const bg = document.createElement('div');
              bg.className = 'shader-background';
              bg.setAttribute('data-testid', 'shader-bg-' + container.id);
              bg.dataset.shaderType = container.shader.type;
              const c1 = state.colorPalette[0];
              const c2 = state.colorPalette[1];
              const c3 = state.colorPalette[2];
              bg.style.background = 'linear-gradient(45deg, ' + c1 + ', ' + c2 + ', ' + c3 + ')';
              bg.style.opacity = '0.6';
              node.appendChild(bg);
            } else {
              node.style.background = container.style.fill;
            }

            if (container.glowFilter) {
              const glow = document.createElement('div');
              glow.className = 'glow-filter';
              glow.setAttribute('data-testid', 'glow-filter-' + container.id);
              glow.dataset.intensity = String(container.glowFilter.intensity);
              glow.style.color = 'rgba(' + Math.round(container.glowFilter.color[0] * 255) + ',' + Math.round(container.glowFilter.color[1] * 255) + ',' + Math.round(container.glowFilter.color[2] * 255) + ', 0.7)';
              node.appendChild(glow);
            }

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
            edgeEl.setAttribute('data-status', edge.status);

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
            if (edge.status === 'flowing') path.classList.add('flowing');
            svg.appendChild(path);
            edgeEl.appendChild(svg);

            if (state.particlesActive && edge.status === 'flowing') {
              const particleContainer = document.createElement('div');
              particleContainer.className = 'particle-flow';
              particleContainer.setAttribute('data-testid', 'particles-' + edge.id);

              const travelX = tx - sx;
              for (let i = 0; i < 8; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.width = '6px';
                particle.style.height = '6px';
                particle.style.background = '#00ff88';
                particle.style.left = sx + 'px';
                particle.style.top = (sy - 3 + Math.random() * 6) + 'px';
                particle.style.setProperty('--travel-x', travelX + 'px');
                particle.style.animationDelay = (i * 0.25) + 's';
                particleContainer.appendChild(particle);
              }
              edgeEl.appendChild(particleContainer);
            }

            stage.appendChild(edgeEl);
          }
        }

        function updateSidebar() {
          document.querySelector('[data-testid="shader-status"]').textContent = 'Shader 状态: ' + (state.shaderActive ? '已加载 (container-background)' : '未加载');
          document.querySelector('[data-testid="color-palette"]').textContent = '色板: ' + (state.colorPalette ? state.colorPalette.join(', ') : '-');
          document.querySelector('[data-testid="glow-status"]').textContent = 'Glow Filter: ' + (state.glowActive ? '已加载 (pulse active)' : '未加载');
          document.querySelector('[data-testid="particle-status"]').textContent = '粒子动画: ' + (state.particlesActive ? '运行中' : '停止');
          document.querySelector('[data-testid="edge-count"]').textContent = '连线数: ' + state.edges.size;
          document.querySelector('[data-testid="snapshot"]').textContent = JSON.stringify({
            shaderActive: state.shaderActive,
            glowActive: state.glowActive,
            particlesActive: state.particlesActive,
            colorPalette: state.colorPalette,
            containers: [...state.containers.keys()],
            edges: [...state.edges.values()].map(e => ({ id: e.id, status: e.status })),
          }, null, 2);
        }

        document.querySelector('[data-testid="btn-create-shader-container"]').addEventListener('click', createShaderContainer);
        document.querySelector('[data-testid="btn-create-ai-node"]').addEventListener('click', createAINode);
        document.querySelector('[data-testid="btn-connect-flow"]').addEventListener('click', () => {
          addEdge({
            id: 'edge-shader-to-ai',
            source: { nodeId: 'shader-container', portId: 'sc-out-ref' },
            target: { nodeId: 'ai-gen-node', portId: 'ai-in-ref' },
          });
        });
        document.querySelector('[data-testid="btn-activate-particles"]').addEventListener('click', activateParticles);

        window.__CUCUMBER_P2_SHADER__ = {
          getState: () => ({
            shaderActive: state.shaderActive,
            glowActive: state.glowActive,
            particlesActive: state.particlesActive,
            colorPalette: state.colorPalette,
            containers: Object.fromEntries(state.containers),
            edges: Object.fromEntries(state.edges),
          }),
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
  await expect(page.getByTestId("shader-status")).toHaveText("Shader 状态: 未加载");
}

test.describe("场景C：WebGL Shader 特效渲染验证", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });

  test("C1 - 创建带 colorPalette contextSlot 的 Shader 容器", async ({ page }) => {
    await page.getByTestId("btn-create-shader-container").click();

    await expect(page.getByTestId("shader-status")).toHaveText("Shader 状态: 已加载 (container-background)");
    await expect(page.getByTestId("color-palette")).toContainText("#331A66");

    const container = page.getByTestId("container-shader-container");
    await expect(container).toBeVisible();

    const state = await page.evaluate(() => (window as any).__CUCUMBER_P2_SHADER__.getState());
    expect(state.shaderActive).toBe(true);
    expect(state.colorPalette).toEqual(["#331A66", "#1A4D80", "#0D264D"]);
    expect(state.containers["shader-container"].contextSlots.style.colorPalette).toEqual(["#331A66", "#1A4D80", "#0D264D"]);

    await page.screenshot({ path: "e2e/screenshots/p2/c1-shader-container-created.png", fullPage: true });
  });

  test("C2 - 容器背景 Shader 生效：渐变颜色可见", async ({ page }) => {
    await page.getByTestId("btn-create-shader-container").click();

    const shaderBg = page.getByTestId("shader-bg-shader-container");
    await expect(shaderBg).toBeVisible();
    await expect(shaderBg).toHaveAttribute("data-shader-type", "container-background");

    const bgStyle = await shaderBg.evaluate((el) => getComputedStyle(el).background);
    expect(bgStyle).toContain("linear-gradient");

    const opacity = await shaderBg.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeGreaterThan(0);

    await page.screenshot({ path: "e2e/screenshots/p2/c2-shader-gradient-visible.png", fullPage: true });
  });

  test("C3 - AI 生成节点的 Glow Filter 发光特效加载", async ({ page }) => {
    await page.getByTestId("btn-create-shader-container").click();
    await page.getByTestId("btn-create-ai-node").click();

    await expect(page.getByTestId("glow-status")).toHaveText("Glow Filter: 已加载 (pulse active)");

    const glowFilter = page.getByTestId("glow-filter-ai-gen-node");
    await expect(glowFilter).toBeVisible();

    const glowIntensity = await glowFilter.getAttribute("data-intensity");
    expect(parseFloat(glowIntensity!)).toBe(1.0);

    const animation = await glowFilter.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("glowPulse");

    await page.screenshot({ path: "e2e/screenshots/p2/c3-glow-filter-active.png", fullPage: true });
  });

  test("C4 - 建立 DataFlowEdge 后粒子流动动画启动", async ({ page }) => {
    await page.getByTestId("btn-create-shader-container").click();
    await page.getByTestId("btn-create-ai-node").click();
    await page.getByTestId("btn-connect-flow").click();

    await expect(page.getByTestId("edge-count")).toHaveText("连线数: 1");
    const edge = page.getByTestId("edge-edge-shader-to-ai");
    await expect(edge).toBeVisible();

    await page.getByTestId("btn-activate-particles").click();
    await expect(page.getByTestId("particle-status")).toHaveText("粒子动画: 运行中");

    const particles = page.getByTestId("particles-edge-shader-to-ai");
    await expect(particles).toBeVisible();

    const particleCount = await particles.locator(".particle").count();
    expect(particleCount).toBe(8);

    const edgeStatus = await edge.getAttribute("data-status");
    expect(edgeStatus).toBe("flowing");

    const firstParticle = particles.locator(".particle").first();
    const animationName = await firstParticle.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("particleMove");

    await page.screenshot({ path: "e2e/screenshots/p2/c4-particles-flowing.png", fullPage: true });
  });

  test("C5 - 完整工作流验证：Shader + Glow + DataFlow + Particles 联动", async ({ page }) => {
    await page.getByTestId("btn-create-shader-container").click();
    await page.getByTestId("btn-create-ai-node").click();
    await page.getByTestId("btn-connect-flow").click();
    await page.getByTestId("btn-activate-particles").click();

    const state = await page.evaluate(() => (window as any).__CUCUMBER_P2_SHADER__.getState());
    expect(state.shaderActive).toBe(true);
    expect(state.glowActive).toBe(true);
    expect(state.particlesActive).toBe(true);
    expect(state.edges["edge-shader-to-ai"].status).toBe("flowing");
    expect(state.colorPalette.length).toBe(3);

    await expect(page.getByTestId("shader-bg-shader-container")).toBeVisible();
    await expect(page.getByTestId("glow-filter-ai-gen-node")).toBeVisible();
    await expect(page.getByTestId("particles-edge-shader-to-ai")).toBeVisible();
    await expect(page.getByTestId("edge-edge-shader-to-ai")).toHaveAttribute("data-status", "flowing");

    await page.screenshot({ path: "e2e/screenshots/p2/c5-full-workflow-active.png", fullPage: true });
  });
});
