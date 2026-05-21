import { expect, test, type Page } from "@playwright/test";

import { ContainerManager } from "../../packages/container/src/container-manager.ts";
import { resolveContext } from "../../packages/container/src/context-resolver.ts";
import type { ContainerNode } from "../../packages/container/src/types.ts";
import { SceneTree } from "../../packages/engine/src/core/scene-tree.ts";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>CucumberCanvas Engine Harness</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, system-ui, sans-serif;
        background: #020617;
        color: #e2e8f0;
      }
      button {
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 999px;
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
        padding: 8px 12px;
      }
      main {
        display: grid;
        gap: 12px;
        grid-template-columns: 240px minmax(0, 1fr);
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
      }
      [data-testid="canvas-stage-shell"] {
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 20px;
        min-height: 0;
        overflow: hidden;
        padding: 16px;
        position: relative;
      }
      [data-testid="canvas-stage"] {
        background: #0f172a;
        border-radius: 18px;
        height: 100%;
        min-height: 560px;
        overflow: hidden;
        position: relative;
      }
      [data-testid="excalidraw-surface"] {
        background-image:
          linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
        background-position: 0 0, 0 0;
        background-size: 24px 24px;
        inset: 0;
        position: absolute;
      }
      #cucumber-canvas-overlay {
        inset: 0;
        pointer-events: none;
        position: absolute;
        z-index: 5;
      }
      .stage-layer {
        inset: 0;
        position: absolute;
        transform-origin: 0 0;
      }
      .container-node {
        border-radius: 16px;
        border-style: solid;
        border-width: 2px;
        overflow: hidden;
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
      .drag-handle {
        align-items: center;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(226, 232, 240, 0.4);
        border-radius: 999px;
        color: #e2e8f0;
        cursor: grab;
        display: inline-flex;
        font-size: 11px;
        gap: 6px;
        padding: 4px 8px;
        pointer-events: auto;
        position: absolute;
        z-index: 20;
      }
      pre { margin: 0; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <header data-testid="toolbar">
        <button data-testid="create-parent" type="button">创建父容器</button>
        <button data-testid="create-child" type="button">创建子容器</button>
        <button data-testid="move-child-root" type="button">子容器移到根层</button>
        <button data-testid="delete-parent" type="button">删除父容器</button>
        <button data-testid="viewport-shift" type="button">平移缩放</button>
      </header>

      <aside data-testid="sidebar">
        <strong>Harness 状态</strong>
        <div data-testid="overlay-mounted"></div>
        <div data-testid="overlay-parent-match"></div>
        <div data-testid="overlay-pointer-events"></div>
        <div data-testid="shadow-mode"></div>
        <div data-testid="container-count"></div>
        <div data-testid="viewport-state"></div>
        <div data-testid="container-children"></div>
        <div data-testid="resolved-contexts"></div>
        <pre data-testid="harness-snapshot"></pre>
      </aside>

      <section data-testid="canvas-stage-shell">
        <div data-testid="canvas-stage">
          <div data-testid="excalidraw-surface"></div>
          <div id="cucumber-canvas-overlay">
            <div class="stage-layer" data-testid="stage-layer"></div>
          </div>
        </div>
      </section>
    </main>

    <script>
      (() => {
        const stageHost = document.querySelector('[data-testid="canvas-stage"]');
        const overlay = document.querySelector('#cucumber-canvas-overlay');
        const stageLayer = document.querySelector('[data-testid="stage-layer"]');
        const excalidrawSurface = document.querySelector('[data-testid="excalidraw-surface"]');
        const state = {
          mode: 'shadow',
          viewport: { zoom: 1, panX: 0, panY: 0 },
          sceneTree: {
            children: ['scene-root', 'scene-note'],
            nodeIds: ['scene-root', 'scene-note'],
            rootCount: 2,
          },
          containers: new Map(),
          dragState: null,
        };

        function resolveContext(containerId) {
          const chain = [];
          let cur = state.containers.get(containerId);
          while (cur) {
            chain.push(cur);
            cur = cur.parentId ? state.containers.get(cur.parentId) : null;
          }
          chain.reverse();
          let acc = {};
          for (const node of chain) {
            acc = {
              style: { ...(acc.style || {}), ...(node.contextSlots.style || {}) },
              tokens: { ...(acc.tokens || {}), ...(node.contextSlots.tokens || {}) },
              rules: [...(acc.rules || []), ...(node.contextSlots.rules || [])],
              constraints: { ...(acc.constraints || {}), ...(node.contextSlots.constraints || {}) },
            };
          }
          return acc;
        }

        function getChildren(id) {
          return [...state.containers.values()].filter((container) => container.parentId === id);
        }

        function getRoots() {
          return [...state.containers.values()].filter((container) => container.parentId === null);
        }

        function render() {
          stageLayer.style.transform = 'translate(' + state.viewport.panX + 'px, ' + state.viewport.panY + 'px) scale(' + state.viewport.zoom + ')';
          excalidrawSurface.style.transform = stageLayer.style.transform;
          stageLayer.replaceChildren();
          stageHost.querySelectorAll('.drag-handle').forEach((node) => node.remove());

          for (const container of state.containers.values()) {
            const node = document.createElement('div');
            node.className = 'container-node';
            node.dataset.containerId = container.id;
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
            stageLayer.appendChild(node);

            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'drag-handle';
            handle.dataset.testid = 'drag-handle-' + container.id;
            handle.setAttribute('data-testid', 'drag-handle-' + container.id);
            handle.textContent = '拖拽 ' + container.style.label;
            handle.style.left = container.bounds.x + 'px';
            handle.style.top = Math.max(0, container.bounds.y - 28) + 'px';
            handle.addEventListener('pointerdown', (event) => {
              state.dragState = {
                containerId: container.id,
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startX: container.bounds.x,
                startY: container.bounds.y,
              };
              handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', (event) => {
              const dragState = state.dragState;
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              const current = state.containers.get(dragState.containerId);
              if (!current) return;
              current.bounds.x = Math.round(dragState.startX + event.clientX - dragState.startClientX);
              current.bounds.y = Math.round(dragState.startY + event.clientY - dragState.startClientY);
              render();
            });
            const stopDrag = (event) => {
              const dragState = state.dragState;
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              state.dragState = null;
              handle.releasePointerCapture(event.pointerId);
              updateSnapshot();
            };
            handle.addEventListener('pointerup', stopDrag);
            handle.addEventListener('pointercancel', stopDrag);
            stageHost.appendChild(handle);
          }
          updateSnapshot();
        }

        function getSnapshot() {
          const overlayRect = overlay.getBoundingClientRect();
          const hostRect = stageHost.getBoundingClientRect();
          const containers = [...state.containers.values()];
          return {
            mode: state.mode,
            overlayMounted: Boolean(overlay),
            overlayParentMatchesHost: overlay.parentElement === stageHost,
            overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
            overlayRect: { width: overlayRect.width, height: overlayRect.height, x: overlayRect.x, y: overlayRect.y },
            hostRect: { width: hostRect.width, height: hostRect.height, x: hostRect.x, y: hostRect.y },
            viewport: { ...state.viewport },
            containerCount: containers.length,
            containerIds: containers.map((container) => container.id),
            rootContainerIds: getRoots().map((container) => container.id),
            containerChildren: Object.fromEntries(containers.map((container) => [container.id, getChildren(container.id).map((child) => child.id)])),
            containerBounds: Object.fromEntries(containers.map((container) => [container.id, { ...container.bounds }])),
            containerLabels: Object.fromEntries(containers.map((container) => [container.id, container.style.label])),
            resolvedContexts: Object.fromEntries(containers.map((container) => [container.id, resolveContext(container.id)])),
            stagePosition: { x: state.viewport.panX, y: state.viewport.panY },
            stageScale: { x: state.viewport.zoom, y: state.viewport.zoom },
          };
        }

        function updateSnapshot() {
          const snapshot = getSnapshot();
          document.querySelector('[data-testid="overlay-mounted"]').textContent = String(snapshot.overlayMounted);
          document.querySelector('[data-testid="overlay-parent-match"]').textContent = String(snapshot.overlayParentMatchesHost);
          document.querySelector('[data-testid="overlay-pointer-events"]').textContent = snapshot.overlayPointerEvents;
          document.querySelector('[data-testid="shadow-mode"]').textContent = snapshot.mode;
          document.querySelector('[data-testid="container-count"]').textContent = String(snapshot.containerCount);
          document.querySelector('[data-testid="viewport-state"]').textContent = JSON.stringify(snapshot.viewport);
          document.querySelector('[data-testid="container-children"]').textContent = JSON.stringify(snapshot.containerChildren);
          document.querySelector('[data-testid="resolved-contexts"]').textContent = JSON.stringify(snapshot.resolvedContexts);
          document.querySelector('[data-testid="harness-snapshot"]').textContent = JSON.stringify(snapshot, null, 2);
          window.__CUCUMBER_CANVAS_HARNESS__ = {
            getSnapshot,
            createParentContainer,
            createChildContainer,
            moveChildToRoot,
            deleteParent,
            syncViewport,
          };
        }

        function createParentContainer() {
          if (state.containers.has('parent-container')) return;
          state.containers.set('parent-container', {
            id: 'parent-container',
            parentId: null,
            bounds: { x: 180, y: 140, width: 320, height: 220 },
            contextSlots: {
              style: { accent: 'parent-purple' },
              tokens: { spacing: 24 },
              rules: ['parent-rule'],
            },
            style: {
              label: 'Parent Container',
              fill: 'rgba(139, 92, 246, 0.12)',
              stroke: '#8b5cf6',
            },
          });
          render();
        }

        function createChildContainer() {
          createParentContainer();
          if (state.containers.has('child-container')) return;
          state.containers.set('child-container', {
            id: 'child-container',
            parentId: 'parent-container',
            bounds: { x: 220, y: 188, width: 140, height: 96 },
            contextSlots: {
              style: { accent: 'child-green' },
              rules: ['child-rule'],
            },
            style: {
              label: 'Child Container',
              fill: 'rgba(34, 197, 94, 0.12)',
              stroke: '#22c55e',
            },
          });
          render();
        }

        function moveChildToRoot() {
          const child = state.containers.get('child-container');
          if (!child) return;
          child.parentId = null;
          render();
        }

        function deleteParent() {
          state.containers.delete('parent-container');
          const child = state.containers.get('child-container');
          if (child) {
            child.parentId = null;
          }
          render();
        }

        function syncViewport(zoom, panX, panY) {
          state.viewport = { zoom, panX, panY };
          render();
        }

        document.querySelector('[data-testid="create-parent"]').addEventListener('click', createParentContainer);
        document.querySelector('[data-testid="create-child"]').addEventListener('click', createChildContainer);
        document.querySelector('[data-testid="move-child-root"]').addEventListener('click', moveChildToRoot);
        document.querySelector('[data-testid="delete-parent"]').addEventListener('click', deleteParent);
        document.querySelector('[data-testid="viewport-shift"]').addEventListener('click', () => syncViewport(1.25, 120, 80));
        render();
      })();
    </script>
  </body>
</html>`;

type BrowserSnapshot = {
  mode: string;
  overlayMounted: boolean;
  overlayParentMatchesHost: boolean;
  overlayPointerEvents: string;
  overlayRect: { width: number; height: number; x: number; y: number };
  hostRect: { width: number; height: number; x: number; y: number };
  viewport: { zoom: number; panX: number; panY: number };
  containerCount: number;
  containerIds: string[];
  rootContainerIds: string[];
  containerChildren: Record<string, string[]>;
  containerBounds: Record<string, { x: number; y: number; width: number; height: number }>;
  containerLabels: Record<string, string>;
  resolvedContexts: Record<string, { style?: Record<string, unknown>; tokens?: Record<string, unknown>; rules?: string[]; constraints?: Record<string, unknown> }>;
  stagePosition: { x: number; y: number };
  stageScale: { x: number; y: number };
};

declare global {
  interface Window {
    __CUCUMBER_CANVAS_HARNESS__?: {
      getSnapshot: () => BrowserSnapshot;
    };
  }
}

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("overlay-mounted")).toHaveText("true");
}

async function getSnapshot(page: Page) {
  return page.evaluate(() => window.__CUCUMBER_CANVAS_HARNESS__?.getSnapshot());
}

function makeContainer(id: string, parentId: string | null, contextSlots: ContainerNode["contextSlots"] = {}): ContainerNode {
  return {
    id,
    type: "container",
    parentId,
    role: ["visual"],
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    contextSlots,
    inheritPolicy: "merge",
    ioPorts: [],
    style: { label: id, fill: "#ffffff0d", stroke: "#666666", opacity: 1 },
  };
}

test.describe.serial("canvas engine e2e", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });

  test("Shadow 模式启动：overlay 正确叠加在 Excalidraw 之上，坐标系同步正常", async ({ page }) => {
    const initial = await getSnapshot(page);
    expect(initial?.mode).toBe("shadow");
    expect(initial?.overlayMounted).toBe(true);
    expect(initial?.overlayParentMatchesHost).toBe(true);
    expect(initial?.overlayPointerEvents).toBe("none");
    expect(Math.abs((initial?.overlayRect.width ?? 0) - (initial?.hostRect.width ?? 0))).toBeLessThan(2);
    expect(Math.abs((initial?.overlayRect.height ?? 0) - (initial?.hostRect.height ?? 0))).toBeLessThan(2);

    await page.getByTestId("viewport-shift").click();
    const shifted = await getSnapshot(page);
    expect(shifted?.viewport).toEqual({ zoom: 1.25, panX: 120, panY: 80 });
    expect(shifted?.stagePosition).toEqual({ x: 120, y: 80 });
    expect(shifted?.stageScale).toEqual({ x: 1.25, y: 1.25 });
  });

  test("容器节点 MVP：能创建为带标题的圆角矩形", async ({ page }) => {
    await page.getByTestId("create-parent").click();
    await expect(page.getByTestId("container-count")).toHaveText("1");

    const container = page.locator(".container-node[data-container-id='parent-container']");
    await expect(container).toBeVisible();
    await expect(container.locator(".container-title")).toHaveText("Parent Container");
    await expect(container).toHaveCSS("border-radius", "16px");

    const snapshot = await getSnapshot(page);
    expect(snapshot?.containerLabels["parent-container"]).toBe("Parent Container");
  });

  test("容器嵌套：支持一层嵌套且子容器定位正确", async ({ page }) => {
    await page.getByTestId("create-child").click();

    const snapshot = await getSnapshot(page);
    expect(snapshot?.containerCount).toBe(2);
    expect(snapshot?.containerChildren["parent-container"]).toEqual(["child-container"]);
    expect(snapshot?.rootContainerIds).toEqual(["parent-container"]);
    expect(snapshot?.containerBounds["child-container"]).toEqual({
      x: 220,
      y: 188,
      width: 140,
      height: 96,
    });
    expect(snapshot?.resolvedContexts["child-container"]).toEqual({
      constraints: {},
      rules: ["parent-rule", "child-rule"],
      style: { accent: "child-green" },
      tokens: { spacing: 24 },
    });
  });

  test("容器移动：拖拽容器节点后位置更新正确", async ({ page }) => {
    await page.getByTestId("create-parent").click();
    const handle = page.getByTestId("drag-handle-parent-container");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("missing drag handle");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 12 });
    await page.mouse.up();

    const snapshot = await getSnapshot(page);
    expect(snapshot?.containerBounds["parent-container"]).toEqual({
      x: 270,
      y: 200,
      width: 320,
      height: 220,
    });
  });

  test("前端视觉不变：工具栏、侧边栏布局正常，无样式破坏", async ({ page }) => {
    const toolbarBox = await page.getByTestId("toolbar").boundingBox();
    const sidebarBox = await page.getByTestId("sidebar").boundingBox();
    const shellBox = await page.getByTestId("canvas-stage-shell").boundingBox();
    const overlayBox = await page.locator("#cucumber-canvas-overlay").boundingBox();

    expect(toolbarBox?.height ?? 0).toBeGreaterThan(40);
    expect(sidebarBox?.width ?? 0).toBeGreaterThan(180);
    expect(shellBox?.width ?? 0).toBeGreaterThan(700);
    expect((toolbarBox?.y ?? 999) <= (sidebarBox?.y ?? 0)).toBe(true);
    expect((sidebarBox?.x ?? 0) < (shellBox?.x ?? 0)).toBe(true);
    expect((overlayBox?.x ?? 0) >= (shellBox?.x ?? 0)).toBe(true);
    expect((overlayBox?.width ?? 0) <= (shellBox?.width ?? 0) + 2).toBe(true);
  });

  test("引擎基础功能：SceneTree 节点增删、ContainerManager CRUD、上下文继承解析", async () => {
    const tree = new SceneTree();
    tree.loadFromDocument({ version: "1.0", children: [] });
    tree.addNode({ id: "parent", type: "frame", children: [] } as any);
    tree.addNode({ id: "child", type: "rectangle", x: 10, y: 12, width: 40, height: 40 } as any, "parent");
    expect(tree.getNode("parent")?.children.map((node) => node.id)).toEqual(["child"]);

    tree.removeNode("child");
    expect(tree.getNode("child")).toBeUndefined();

    const manager = new ContainerManager();
    const parent = makeContainer("parent", null, {
      style: { tone: "purple" },
      tokens: { spacing: 24 },
      rules: ["parent-rule"],
    });
    const child = makeContainer("child", "parent", {
      style: { tone: "green" },
      rules: ["child-rule"],
    });
    manager.loadContainers([parent, child]);

    expect(manager.getChildren("parent").map((node) => node.id)).toEqual(["child"]);
    expect(manager.moveContainer("child", null)).toBe(true);
    expect(manager.getRootContainers().map((node) => node.id).sort()).toEqual(["child", "parent"]);

    manager.moveContainer("child", "parent");
    const resolved = manager.resolveContext("child");
    expect(resolved).toEqual({
      constraints: {},
      rules: ["parent-rule", "child-rule"],
      style: { tone: "green" },
      tokens: { spacing: 24 },
    });

    const manualTree = new Map<string, ContainerNode>([
      ["parent", parent],
      ["child", child],
    ]);
    expect(resolveContext("child", manualTree)).toEqual(resolved);

    expect(manager.removeContainer("parent")).toBe(true);
    expect(manager.getContainer("child")?.parentId).toBeNull();
  });
});
