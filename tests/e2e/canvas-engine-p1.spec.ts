import { expect, test, type Page } from "@playwright/test";

import { AgentContextBuilder } from "../../packages/container/src/agent-context-builder.ts";
import { ContainerManager } from "../../packages/container/src/container-manager.ts";

const HARNESS_HTML = String.raw`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>CucumberCanvas P1 Harness</title>
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
        grid-template-columns: minmax(0, 1fr) 320px;
        height: 100vh;
        padding: 12px;
      }
      [data-testid="canvas-shell"],
      [data-testid="properties-shell"] {
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 20px;
        min-height: 0;
      }
      [data-testid="canvas-shell"] {
        overflow: hidden;
        padding: 16px;
        position: relative;
      }
      [data-testid="canvas-stage"] {
        background:
          linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px),
          #0f172a;
        background-size: 24px 24px;
        border-radius: 18px;
        height: 100%;
        min-height: 640px;
        position: relative;
      }
      .container-node {
        border: 2px solid;
        border-radius: 16px;
        cursor: pointer;
        overflow: visible;
        position: absolute;
      }
      .container-node.selected {
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.22);
      }
      .container-title {
        align-items: center;
        display: flex;
        font-size: 12px;
        font-weight: 600;
        height: 28px;
        padding: 0 10px;
      }
      .agent-glow {
        border: 3px solid;
        border-radius: 20px;
        inset: -6px;
        opacity: 0.45;
        position: absolute;
        pointer-events: none;
      }
      .agent-glow.running {
        box-shadow: 0 0 24px currentColor;
        opacity: 0.72;
      }
      .agent-badge {
        align-items: center;
        border-radius: 999px;
        color: white;
        display: inline-flex;
        font-size: 10px;
        font-weight: 700;
        gap: 6px;
        padding: 4px 8px;
        position: absolute;
        right: 8px;
        top: 4px;
      }
      .status-dot {
        border-radius: 999px;
        height: 6px;
        width: 6px;
      }
      [data-testid="properties-shell"] {
        overflow: auto;
        padding: 16px;
      }
      .empty-panel {
        color: #94a3b8;
        display: grid;
        height: 100%;
        place-items: center;
      }
      .container-properties-panel {
        display: grid;
        gap: 16px;
      }
      .panel-header,
      .panel-section {
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 16px;
        padding: 14px;
      }
      .panel-header {
        display: grid;
        gap: 10px;
      }
      .container-roles {
        display: flex;
        gap: 8px;
      }
      .role-tag {
        background: rgba(99, 102, 241, 0.16);
        border: 1px solid rgba(129, 140, 248, 0.24);
        border-radius: 999px;
        color: #c7d2fe;
        font-size: 11px;
        padding: 4px 8px;
      }
      .panel-title {
        font-size: 14px;
        font-weight: 700;
        margin: 0 0 12px;
      }
      .agent-list,
      .status-actions,
      .rules-list,
      .section {
        display: grid;
        gap: 10px;
      }
      .agent-option,
      .unbind-btn,
      .status-btn,
      .rule-add-btn {
        align-items: center;
        background: rgba(30, 41, 59, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 12px;
        color: #e2e8f0;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        gap: 8px;
        justify-content: center;
        min-height: 36px;
        padding: 8px 12px;
      }
      .agent-bound,
      .agent-info,
      .agent-meta,
      .kv-row,
      .kv-add,
      .rule-input-row {
        display: grid;
        gap: 8px;
      }
      .agent-meta,
      .kv-row {
        font-size: 12px;
        color: #cbd5e1;
      }
      .agent-dot {
        border-radius: 999px;
        display: inline-block;
        height: 10px;
        width: 10px;
      }
      .agent-status {
        border-radius: 999px;
        font-size: 11px;
        padding: 2px 8px;
        text-transform: uppercase;
        width: fit-content;
      }
      .status-idle-chip { background: rgba(148, 163, 184, 0.18); }
      .status-running-chip { background: rgba(34, 197, 94, 0.18); }
      .status-completed-chip { background: rgba(148, 163, 184, 0.28); }
      label {
        color: #cbd5e1;
        font-size: 12px;
      }
      select, input {
        background: rgba(2, 6, 23, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 10px;
        color: #e2e8f0;
        font: inherit;
        min-height: 36px;
        padding: 8px 10px;
        width: 100%;
      }
      pre {
        background: rgba(2, 6, 23, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 12px;
        font-size: 12px;
        margin: 0;
        overflow: auto;
        padding: 10px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <section data-testid="canvas-shell">
        <div data-testid="canvas-stage"></div>
      </section>
      <aside data-testid="properties-shell"></aside>
    </main>

    <script>
      (() => {
        const agents = [
          { agentId: 'agent-designer-1', color: '#FF6B6B', name: 'Kiki', role: 'designer' },
          { agentId: 'agent-reviewer-1', color: '#4ECDC4', name: 'Mochi', role: 'reviewer' },
        ];

        const state = {
          selectedContainerId: 'parent-container',
          containers: new Map([
            ['parent-container', {
              id: 'parent-container',
              parentId: null,
              role: ['visual'],
              bounds: { x: 120, y: 120, width: 340, height: 240 },
              contextSlots: {
                style: { colorPalette: 'aurora', fontStyle: 'display' },
                tokens: {},
                rules: ['parent-base-rule'],
                constraints: {},
              },
              inheritPolicy: 'merge',
              style: { label: 'Parent Container', fill: 'rgba(139, 92, 246, 0.12)', stroke: '#8b5cf6' },
            }],
            ['child-container', {
              id: 'child-container',
              parentId: 'parent-container',
              role: ['visual'],
              bounds: { x: 180, y: 178, width: 160, height: 110 },
              contextSlots: {
                style: { fontStyle: 'body' },
                tokens: {},
                rules: ['child-local-rule'],
                constraints: {},
              },
              inheritPolicy: 'merge',
              style: { label: 'Child Container', fill: 'rgba(34, 197, 94, 0.12)', stroke: '#22c55e' },
            }],
          ]),
        };

        const stage = document.querySelector('[data-testid="canvas-stage"]');
        const panelRoot = document.querySelector('[data-testid="properties-shell"]');

        function mergeSlots(base, overlay) {
          return {
            style: { ...(base.style || {}), ...(overlay.style || {}) },
            tokens: { ...(base.tokens || {}), ...(overlay.tokens || {}) },
            rules: [...(base.rules || []), ...(overlay.rules || [])],
            constraints: { ...(base.constraints || {}), ...(overlay.constraints || {}) },
          };
        }

        function filterOutBlockedSlots(base, local) {
          return {
            style: local.style || base.style || {},
            tokens: local.tokens || base.tokens || {},
            rules: local.rules || base.rules || [],
            constraints: local.constraints || base.constraints || {},
          };
        }

        function resolveContext(containerId) {
          const chain = [];
          let current = state.containers.get(containerId);
          while (current) {
            chain.push(current);
            current = current.parentId ? state.containers.get(current.parentId) : null;
          }
          chain.reverse();

          let acc = {};
          for (const node of chain) {
            if (node.inheritPolicy === 'override') {
              acc = { ...acc, ...node.contextSlots };
            } else if (node.inheritPolicy === 'block') {
              acc = filterOutBlockedSlots(acc, node.contextSlots);
            } else {
              acc = mergeSlots(acc, node.contextSlots);
            }
          }
          return acc;
        }

        function getSelectedContainer() {
          return state.selectedContainerId ? state.containers.get(state.selectedContainerId) : null;
        }

        function getStatusDotColor(status) {
          if (status === 'running') return 'rgb(0, 255, 136)';
          if (status === 'completed') return 'rgb(136, 136, 136)';
          return 'rgb(255, 255, 255)';
        }

        function updateContext(containerId, updater) {
          const container = state.containers.get(containerId);
          if (!container) return;
          updater(container);
          state.containers.set(containerId, container);
          render();
        }

        function bindAgent(containerId, agentId) {
          const container = state.containers.get(containerId);
          const identity = agents.find((agent) => agent.agentId === agentId);
          if (!container || !identity) return;
          container.agentBinding = {
            agentId: identity.agentId,
            color: identity.color,
            name: identity.name,
            role: identity.role,
            status: 'idle',
            permissions: ['read', 'write'],
          };
          render();
        }

        function unbindAgent(containerId) {
          const container = state.containers.get(containerId);
          if (!container) return;
          delete container.agentBinding;
          render();
        }

        function setAgentStatus(containerId, status) {
          const container = state.containers.get(containerId);
          if (!container || !container.agentBinding) return;
          container.agentBinding.status = status;
          render();
        }

        function buildSnapshot() {
          const selected = getSelectedContainer();
          const containerEntries = [...state.containers.values()].map((container) => [container.id, {
            agentBinding: container.agentBinding
              ? {
                  agentId: container.agentBinding.agentId || null,
                  color: container.agentBinding.color || null,
                  name: container.agentBinding.name || null,
                  status: container.agentBinding.status || null,
                }
              : null,
            contextSlots: JSON.parse(JSON.stringify(container.contextSlots)),
            inheritPolicy: container.inheritPolicy,
          }]);

          const selectedNode = selected ? stage.querySelector('[data-container-id="' + selected.id + '"]') : null;
          const glow = selectedNode ? selectedNode.querySelector('.agent-glow') : null;
          const badge = selectedNode ? selectedNode.querySelector('.agent-badge') : null;

          return {
            selectedContainerId: selected?.id || null,
            containers: Object.fromEntries(containerEntries),
            resolvedContexts: Object.fromEntries([...state.containers.keys()].map((id) => [id, resolveContext(id)])),
            panelTitles: [...panelRoot.querySelectorAll('.panel-title')].map((node) => node.textContent),
            agentVisuals: {
              glowColor: glow ? getComputedStyle(glow).borderTopColor : null,
              glowVisible: Boolean(glow),
              badgeVisible: Boolean(badge),
              badgeBackground: badge ? getComputedStyle(badge).backgroundColor : null,
              badgeName: badge ? badge.querySelector('.badge-name')?.textContent || null : null,
              badgeStatus: badge ? badge.dataset.status || null : null,
              statusDotColor: badge ? getComputedStyle(badge.querySelector('.status-dot')).backgroundColor : null,
            },
          };
        }

        function renderStage() {
          stage.replaceChildren();
          for (const container of state.containers.values()) {
            const node = document.createElement('button');
            node.type = 'button';
            node.className = 'container-node' + (state.selectedContainerId === container.id ? ' selected' : '');
            node.dataset.containerId = container.id;
            node.setAttribute('data-testid', 'container-' + container.id);
            node.style.left = container.bounds.x + 'px';
            node.style.top = container.bounds.y + 'px';
            node.style.width = container.bounds.width + 'px';
            node.style.height = container.bounds.height + 'px';
            node.style.background = container.style.fill;
            node.style.borderColor = container.style.stroke;
            node.addEventListener('click', () => {
              state.selectedContainerId = container.id;
              render();
            });

            if (container.agentBinding?.agentId) {
              const glow = document.createElement('div');
              glow.className = 'agent-glow' + (container.agentBinding.status === 'running' ? ' running' : '');
              glow.style.color = container.agentBinding.color;
              glow.style.borderColor = container.agentBinding.color;
              node.appendChild(glow);

              const badge = document.createElement('div');
              badge.className = 'agent-badge';
              badge.dataset.status = container.agentBinding.status || 'idle';
              badge.style.background = container.agentBinding.color;
              badge.innerHTML = '<span class="status-dot"></span><span class="badge-name"></span>';
              badge.querySelector('.badge-name').textContent = container.agentBinding.name || 'Unknown';
              badge.querySelector('.status-dot').style.background = getStatusDotColor(container.agentBinding.status);
              node.appendChild(badge);
            }

            const title = document.createElement('div');
            title.className = 'container-title';
            title.style.background = container.style.stroke + '26';
            title.textContent = container.style.label;
            node.appendChild(title);
            stage.appendChild(node);
          }
        }

        function renderPanel() {
          const container = getSelectedContainer();
          if (!container) {
            panelRoot.innerHTML = '<div class="empty-panel">请选择一个容器</div>';
            return;
          }

          const binding = container.agentBinding;
          const rules = container.contextSlots.rules || [];
          const effectiveContext = resolveContext(container.id);
          const rolesHtml = container.role.map(function (role) {
            return '<span class="role-tag">' + role + '</span>';
          }).join('');
          const agentsHtml = agents.map(function (agent) {
            return '' +
              '<button class="agent-option" data-testid="agent-option-' + agent.agentId + '" data-agent-id="' + agent.agentId + '">' +
                '<span class="agent-dot" style="background:' + agent.color + '"></span>' +
                '<span>' + agent.name + '</span>' +
              '</button>';
          }).join('');
          const rulesHtml = rules.map(function (rule) {
            return '<span class="rule-item">' + rule + '</span>';
          }).join('');
          const bindingHtml = binding && binding.agentId
            ? '' +
              '<div class="agent-bound">' +
                '<div class="agent-info">' +
                  '<span class="agent-dot" style="background:' + binding.color + '"></span>' +
                  '<span class="agent-name">' + binding.name + '</span>' +
                  '<span class="agent-status status-' + binding.status + ' status-' + binding.status + '-chip">' + binding.status + '</span>' +
                '</div>' +
                '<div class="agent-meta">' +
                  '<span data-testid="binding-agent-id">agentId: ' + binding.agentId + '</span>' +
                  '<span data-testid="binding-role">role: ' + binding.role + '</span>' +
                  '<span data-testid="binding-permissions">permissions: ' + (binding.permissions || []).join(', ') + '</span>' +
                '</div>' +
                '<div class="status-actions">' +
                  '<button class="status-btn" data-testid="status-idle">idle</button>' +
                  '<button class="status-btn" data-testid="status-running">running</button>' +
                  '<button class="status-btn" data-testid="status-completed">completed</button>' +
                '</div>' +
                '<button class="unbind-btn" data-testid="unbind-agent">解除绑定</button>' +
              '</div>'
            : '' +
              '<div class="agent-unbound">' +
                '<p class="hint">选择一个 Agent 绑定到此容器</p>' +
                '<div class="agent-list">' + agentsHtml + '</div>' +
              '</div>';

          panelRoot.innerHTML = '' +
            '<div class="container-properties-panel" data-testid="container-properties-panel">' +
              '<div class="panel-header">' +
                '<h3 data-testid="panel-container-title">' + container.style.label + '</h3>' +
                '<div class="container-roles">' + rolesHtml + '</div>' +
              '</div>' +
              '<div class="panel-section agent-binding-panel" data-testid="agent-binding-panel">' +
                '<h4 class="panel-title">Agent 绑定</h4>' +
                bindingHtml +
              '</div>' +
              '<div class="panel-section context-slots-panel" data-testid="context-slots-panel">' +
                '<h4 class="panel-title">上下文配置</h4>' +
                '<div class="section">' +
                  '<label for="inherit-policy">继承策略</label>' +
                  '<select id="inherit-policy" data-testid="inherit-policy">' +
                    '<option value="merge" ' + (container.inheritPolicy === 'merge' ? 'selected' : '') + '>Merge (合并父级)</option>' +
                    '<option value="override" ' + (container.inheritPolicy === 'override' ? 'selected' : '') + '>Override (覆盖父级)</option>' +
                    '<option value="block" ' + (container.inheritPolicy === 'block' ? 'selected' : '') + '>Block (阻断继承)</option>' +
                  '</select>' +
                '</div>' +
                '<div class="section">' +
                  '<label for="colorPalette">colorPalette</label>' +
                  '<input id="colorPalette" data-testid="style-colorPalette" value="' + (container.contextSlots.style?.colorPalette || '') + '" />' +
                '</div>' +
                '<div class="section">' +
                  '<label for="fontStyle">fontStyle</label>' +
                  '<input id="fontStyle" data-testid="style-fontStyle" value="' + (container.contextSlots.style?.fontStyle || '') + '" />' +
                '</div>' +
                '<div class="section">' +
                  '<label>designRules</label>' +
                  '<div class="rules-list" data-testid="rules-list">' + rulesHtml + '</div>' +
                  '<div class="rule-input-row">' +
                    '<input data-testid="new-rule" value="" placeholder="添加规则" />' +
                    '<button class="rule-add-btn" data-testid="add-rule">添加规则</button>' +
                  '</div>' +
                '</div>' +
                '<div class="section">' +
                  '<label>生效上下文</label>' +
                  '<pre data-testid="effective-context">' + JSON.stringify(effectiveContext, null, 2) + '</pre>' +
                '</div>' +
              '</div>' +
            '</div>';

          panelRoot.querySelectorAll('.agent-option').forEach((button) => {
            button.addEventListener('click', () => bindAgent(container.id, button.dataset.agentId));
          });
          panelRoot.querySelector('[data-testid="unbind-agent"]')?.addEventListener('click', () => unbindAgent(container.id));
          panelRoot.querySelector('[data-testid="status-idle"]')?.addEventListener('click', () => setAgentStatus(container.id, 'idle'));
          panelRoot.querySelector('[data-testid="status-running"]')?.addEventListener('click', () => setAgentStatus(container.id, 'running'));
          panelRoot.querySelector('[data-testid="status-completed"]')?.addEventListener('click', () => setAgentStatus(container.id, 'completed'));
          panelRoot.querySelector('[data-testid="inherit-policy"]')?.addEventListener('change', (event) => {
            updateContext(container.id, (target) => {
              target.inheritPolicy = event.target.value;
            });
          });
          panelRoot.querySelector('[data-testid="style-colorPalette"]')?.addEventListener('input', (event) => {
            updateContext(container.id, (target) => {
              target.contextSlots.style = { ...(target.contextSlots.style || {}), colorPalette: event.target.value };
            });
          });
          panelRoot.querySelector('[data-testid="style-fontStyle"]')?.addEventListener('input', (event) => {
            updateContext(container.id, (target) => {
              target.contextSlots.style = { ...(target.contextSlots.style || {}), fontStyle: event.target.value };
            });
          });
          const ruleInput = panelRoot.querySelector('[data-testid="new-rule"]');
          panelRoot.querySelector('[data-testid="add-rule"]')?.addEventListener('click', () => {
            if (!ruleInput.value.trim()) return;
            updateContext(container.id, (target) => {
              target.contextSlots.rules = [...(target.contextSlots.rules || []), ruleInput.value.trim()];
            });
          });
        }

        function render() {
          renderStage();
          renderPanel();
          window.__CUCUMBER_P1_HARNESS__ = {
            getSnapshot: buildSnapshot,
            selectContainer: (containerId) => {
              state.selectedContainerId = containerId;
              render();
            },
            setParentContext: (nextStyle, nextRules) => {
              const parent = state.containers.get('parent-container');
              parent.contextSlots.style = { ...(parent.contextSlots.style || {}), ...nextStyle };
              parent.contextSlots.rules = nextRules;
              render();
            },
            setChildContext: (nextStyle, nextRules, policy) => {
              const child = state.containers.get('child-container');
              child.contextSlots.style = { ...(child.contextSlots.style || {}), ...nextStyle };
              child.contextSlots.rules = nextRules;
              child.inheritPolicy = policy || child.inheritPolicy;
              render();
            },
          };
        }

        render();
      })();
    </script>
  </body>
</html>`;

type HarnessSnapshot = {
  selectedContainerId: string | null;
  containers: Record<
    string,
    {
      agentBinding: { agentId: string | null; color: string | null; name: string | null; status: string | null } | null;
      contextSlots: {
        style?: Record<string, string>;
        tokens?: Record<string, string>;
        rules?: string[];
        constraints?: Record<string, string>;
      };
      inheritPolicy: "merge" | "override" | "block";
    }
  >;
  resolvedContexts: Record<string, { style?: Record<string, string>; rules?: string[] }>;
  panelTitles: string[];
  agentVisuals: {
    glowColor: string | null;
    glowVisible: boolean;
    badgeVisible: boolean;
    badgeBackground: string | null;
    badgeName: string | null;
    badgeStatus: string | null;
    statusDotColor: string | null;
  };
};

declare global {
  interface Window {
    __CUCUMBER_P1_HARNESS__?: {
      getSnapshot: () => HarnessSnapshot;
      selectContainer: (containerId: string) => void;
      setParentContext: (style: Record<string, string>, rules: string[]) => void;
      setChildContext: (style: Record<string, string>, rules: string[], policy: "merge" | "override" | "block") => void;
    };
  }
}

async function setupHarness(page: Page) {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.setContent(HARNESS_HTML);
  await expect(page.getByTestId("container-properties-panel")).toBeVisible();
}

async function getSnapshot(page: Page) {
  return page.evaluate(() => window.__CUCUMBER_P1_HARNESS__?.getSnapshot());
}

test.describe.serial("canvas engine p1 e2e", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });

  test("AgentBinding：绑定/解绑与状态切换字段正确", async ({ page }) => {
    await page.getByTestId("agent-option-agent-designer-1").click();

    let snapshot = await getSnapshot(page);
    expect(snapshot?.containers["parent-container"]?.agentBinding).toEqual({
      agentId: "agent-designer-1",
      color: "#FF6B6B",
      name: "Kiki",
      status: "idle",
    });

    await page.getByTestId("status-running").click();
    snapshot = await getSnapshot(page);
    expect(snapshot?.containers["parent-container"]?.agentBinding?.status).toBe("running");

    await page.getByTestId("status-completed").click();
    snapshot = await getSnapshot(page);
    expect(snapshot?.containers["parent-container"]?.agentBinding?.status).toBe("completed");

    await page.getByTestId("unbind-agent").click();
    snapshot = await getSnapshot(page);
    expect(snapshot?.containers["parent-container"]?.agentBinding).toBeNull();
  });

  test("Agent 身份可视化：绑定后 Glow 边框与名称 Badge 正确显示", async ({ page }) => {
    await page.getByTestId("agent-option-agent-reviewer-1").click();

    let snapshot = await getSnapshot(page);
    expect(snapshot?.agentVisuals.glowVisible).toBe(true);
    expect(snapshot?.agentVisuals.badgeVisible).toBe(true);
    expect(snapshot?.agentVisuals.badgeName).toBe("Mochi");
    expect(snapshot?.agentVisuals.glowColor).toBe("rgb(78, 205, 196)");
    expect(snapshot?.agentVisuals.badgeBackground).toBe("rgb(78, 205, 196)");
    expect(snapshot?.agentVisuals.badgeStatus).toBe("idle");
    expect(snapshot?.agentVisuals.statusDotColor).toBe("rgb(255, 255, 255)");

    await page.getByTestId("status-running").click();
    snapshot = await getSnapshot(page);
    expect(snapshot?.agentVisuals.badgeStatus).toBe("running");
    expect(snapshot?.agentVisuals.statusDotColor).toBe("rgb(0, 255, 136)");
  });

  test("contextSlots 配置：通过右侧面板设置并读取一致", async ({ page }) => {
    await page.getByTestId("style-colorPalette").fill("lemon8-sunset");
    await page.getByTestId("style-fontStyle").fill("headline-serif");
    await page.getByTestId("new-rule").fill("只使用暖色渐变");
    await page.getByTestId("add-rule").click();

    const snapshot = await getSnapshot(page);
    expect(snapshot?.containers["parent-container"]?.contextSlots.style).toEqual({
      colorPalette: "lemon8-sunset",
      fontStyle: "headline-serif",
    });
    expect(snapshot?.containers["parent-container"]?.contextSlots.rules).toEqual([
      "parent-base-rule",
      "只使用暖色渐变",
    ]);
    expect(snapshot?.resolvedContexts["parent-container"]?.style).toEqual({
      colorPalette: "lemon8-sunset",
      fontStyle: "headline-serif",
    });
  });

  test("上下文继承：merge / override / block 三种策略的 resolveContext 正确", async ({ page }) => {
    await page.evaluate(() => {
      window.__CUCUMBER_P1_HARNESS__?.setParentContext(
        { colorPalette: "parent-purple", fontStyle: "display-xl" },
        ["parent-rule"],
      );
      window.__CUCUMBER_P1_HARNESS__?.selectContainer("child-container");
    });

    await page.getByTestId("style-fontStyle").fill("body-sm");
    await page.getByTestId("new-rule").fill("child-rule-merge");
    await page.getByTestId("add-rule").click();
    let snapshot = await getSnapshot(page);
    expect(snapshot?.resolvedContexts["child-container"]).toEqual({
      style: { colorPalette: "parent-purple", fontStyle: "body-sm" },
      tokens: {},
      rules: ["parent-rule", "child-local-rule", "child-rule-merge"],
      constraints: {},
    });

    await page.evaluate(() => {
      window.__CUCUMBER_P1_HARNESS__?.setChildContext({ colorPalette: "child-override" }, ["child-only-rule"], "override");
    });
    snapshot = await getSnapshot(page);
    expect(snapshot?.containers["child-container"]?.inheritPolicy).toBe("override");
    expect(snapshot?.resolvedContexts["child-container"]).toEqual({
      style: { colorPalette: "child-override", fontStyle: "body-sm" },
      tokens: {},
      rules: ["child-only-rule"],
      constraints: {},
    });

    await page.evaluate(() => {
      window.__CUCUMBER_P1_HARNESS__?.setChildContext({ fontStyle: "blocked-local" }, ["blocked-rule"], "block");
    });
    snapshot = await getSnapshot(page);
    expect(snapshot?.containers["child-container"]?.inheritPolicy).toBe("block");
    expect(snapshot?.resolvedContexts["child-container"]).toEqual({
      style: { colorPalette: "child-override", fontStyle: "blocked-local" },
      tokens: {},
      rules: ["blocked-rule"],
      constraints: {},
    });
  });

  test("UI 侧面板交互：选中容器后显示 AgentBindingPanel 和 ContextSlotsPanel，视觉风格保持一致", async ({ page }) => {
    await page.evaluate(() => window.__CUCUMBER_P1_HARNESS__?.selectContainer("child-container"));

    await expect(page.getByTestId("agent-binding-panel")).toBeVisible();
    await expect(page.getByTestId("context-slots-panel")).toBeVisible();
    await expect(page.getByTestId("panel-container-title")).toHaveText("Child Container");

    const titles = await page.locator(".panel-title").allTextContents();
    expect(titles).toEqual(["Agent 绑定", "上下文配置"]);

    await expect(page.getByTestId("container-properties-panel")).toHaveCSS("display", "grid");
    await expect(page.getByTestId("agent-binding-panel")).toHaveCSS("border-radius", "16px");
    await expect(page.getByTestId("context-slots-panel")).toHaveCSS("background-color", "rgba(15, 23, 42, 0.96)");
  });
});

test.describe("canvas engine p1 integration logic", () => {
  test("AgentContext 注入：containerPath / effectiveContext / visibleNodes / canOperate 权限矩阵正确", async () => {
    const manager = new ContainerManager();
    const builder = new AgentContextBuilder(manager);

    const parent = manager.createContainer({
      id: "root",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
      label: "Root",
    });
    const child = manager.createContainer({
      id: "child",
      parentId: parent.id,
      bounds: { x: 40, y: 40, width: 220, height: 160 },
      label: "Child",
    });
    const sibling = manager.createContainer({
      id: "sibling",
      parentId: parent.id,
      bounds: { x: 280, y: 40, width: 180, height: 160 },
      label: "Sibling",
    });

    manager.updateContextSlots(parent.id, { style: { colorPalette: "brand-purple" }, rules: ["parent-rule"] });
    manager.updateContextSlots(child.id, { style: { fontStyle: "serif" }, rules: ["child-rule"] });

    manager.bindAgent(child.id, {
      agentId: "agent-1",
      name: "Kiki",
      color: "#FF6B6B",
      permissions: ["read", "write"],
      status: "running",
    });
    manager.bindAgent(sibling.id, {
      agentId: "agent-2",
      name: "Mochi",
      color: "#4ECDC4",
      permissions: ["read"],
      status: "idle",
    });

    manager.updateContainer(child.id, {
      permissions: {
        owner: "agent-1",
        canRead: ["agent-1", "agent-2"],
        canWrite: ["agent-1"],
        isolationLevel: "strict",
      },
    });

    builder.updateNodeIndex([
      { id: "inside-node", type: "rect", bounds: { x: 60, y: 70, width: 40, height: 40 }, label: "Inside" },
      { id: "outside-node", type: "rect", bounds: { x: 420, y: 320, width: 80, height: 60 }, label: "Outside" },
      { id: "global-note", type: "note", label: "Global" },
    ]);

    const ctx = builder.build("agent-1", child.id);
    expect(ctx).not.toBeNull();
    expect(ctx?.containerPath).toEqual(["root", "child"]);
    expect(ctx?.effectiveContext).toEqual({
      style: { colorPalette: "brand-purple", fontStyle: "serif" },
      tokens: {},
      rules: ["parent-rule", "child-rule"],
      constraints: {},
    });
    expect(ctx?.visibleNodes.map((node) => node.id)).toEqual(["inside-node", "global-note"]);
    expect(ctx?.siblings).toEqual([{ containerId: "sibling", agentId: "agent-2", status: "idle" }]);
    expect(ctx?.permissions).toEqual(["read", "write"]);
    expect(ctx?.canOperate("inside-node")).toBe(true);

    const unauthorizedCtx = builder.build("agent-2", child.id);
    expect(unauthorizedCtx?.canOperate("inside-node")).toBe(false);

    manager.updateContainer(child.id, {
      permissions: {
        owner: "agent-1",
        canRead: ["agent-1", "agent-2"],
        canWrite: ["agent-1"],
        isolationLevel: "open",
      },
    });
    const openCtx = builder.build("agent-2", child.id);
    expect(openCtx?.canOperate("inside-node")).toBe(true);
  });
});
