# Canvas Design Skill — Integration & Verification Guide

## Local Development Setup

### Prerequisites

- Python 3.x installed locally
- `pip install pillow reportlab`
- Font files in `skills/canvas-design/canvas-fonts/`

### Environment Variables

```bash
# .env.local additions
CUCUMBER_SANDBOX_ROOT=/tmp/cucumber-sandbox-dev
CUCUMBER_SKILLS_ROOT=./skills
```

### Verification Steps

1. Start dev server: `pnpm dev`
2. Open a project in the web UI
3. Send message: "帮我生成一张极简主义风格的海报"
4. Verify:
   - Agent activates canvas-design skill (check server logs for `[SkillsMiddleware]`)
   - Agent calls `execute` tool with Python code
   - Generated PNG appears in sandbox tmpdir
   - Agent calls `persist_sandbox_file` to upload
   - User receives downloadable URL
   - Sandbox tmpdir cleaned up after run

### Production Deployment

The Dockerfile handles everything:
- Python + Pillow + reportlab installed in image
- Skills + fonts copied to `/opt/cucumber/skills/`
- Default env vars work out of the box

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `execute` tool not available | Backend not sandbox | Check `CUCUMBER_AGENT_BACKEND_MODE=state` and backend factory returns LocalShellBackend |
| Fonts not found | Wrong FONT_DIR | Check `CUCUMBER_SKILLS_ROOT` env var |
| Sandbox dir fills up | Cleanup failed | Check runtime.ts finally block; add cron cleanup as safety net |
| Python not found | Not in Docker image | Rebuild Docker image |
| Skill not discovered | Skills path misconfigured | Check `/skills/` route in CompositeBackend |

### Adding New Skills

Place new skills in `skills/<skill-name>/SKILL.md`. They are automatically
discovered by SkillsMiddleware on next agent run. No code changes needed.

## Phase A Page-Aware Editor Behavior

The web editor remains the live-canvas authority. `CanvasEditor` still exposes
`canvas.document.get`, `canvas.document.set`, and `canvas.screenshot` over the
WebSocket RPC boundary.

Canvas documents are normalized to `PenDocument.pages`. Legacy documents with
root `children` are wrapped into a single `Page 1` page in memory, then saved
through the existing debounce pipeline after the next document change.

The editor tracks `activePageId` locally and passes it through `CanvasApi` page
methods. Node operations, layers, selection, screenshots, and exports operate on
the active page unless an explicit export region is provided. If an agent writes
a document that removes the active page, the editor switches to the first
available page and logs `[skia-canvas] page.active.reconciled`.

Boolean operations are only available for compatible vector/shape selections:
frames, rectangles, ellipses, polygons, paths, and lines. Rejected operations
leave the document unchanged and log a concrete reason.

## Phase B Design System Panel

The live canvas now exposes an Cucumber canvas design system panel from the
bottom bar. The panel is intentionally document-native: it reads and writes the
active `PenDocument` rather than keeping a parallel UI-only registry.

- Components: reusable `frame` nodes are listed as components, selected frames
  can be marked reusable, and instances are inserted as `ref` nodes pointing to
  the source component.
- Variables and themes: document `variables` and `themes` can be created,
  edited, deleted, and logged from the panel. Color variables can be bound to
  the selected node fill as `$variableName`; deletes are blocked when canvas
  nodes still reference the variable.
- Icons: a local Lucide-compatible icon registry inserts real `icon_font`
  nodes. `SkiaCanvas` passes the registry into `PenRenderer.iconLookup`, so
  inserted icons render as paths instead of the fallback placeholder.

All panel mutations log through `[canvas-design-system]` with component,
variable, theme, icon, node, and active page context for local and production
diagnosis.

## Phase C Codegen And Prompt-To-Canvas Orchestration

The live MCP canvas tool set now includes the first Phase C prompt-to-canvas
thin slice. `prompt_canvas_plan` converts a visual prompt into a deterministic
root-frame and section plan without mutating the document. `prompt_canvas_execute`
materializes a stored plan into the open live canvas as a root container plus
editable section containers.

The browser editor remains the document authority. Execution reads the latest
live `PenDocument`, inserts the root frame, then serializes section writes
through `LiveCanvasService` so successful sections preserve existing manual
canvas content. Every generated root and section is a normal `PenNode` with
container roles, explanatory text, and Agent binding metadata for later
inspection and follow-up editing.

Phase C orchestration logs use `[phase-c-orchestration]` and include canvas,
user, plan, root, section, concurrency, commit mode, and inserted-node context.
Failures throw concrete messages rather than falling back to stale persistence
or returning opaque placeholder output.

Direct `codegen_export` now supports React, static HTML, and Vue for selected
nodes or explicit node IDs. Vue export reuses the existing DOM/CSS mapping and
emits a `.vue` single-file component plus CSS, which keeps the first
multi-platform codegen slice practical while native targets remain out of
scope.
