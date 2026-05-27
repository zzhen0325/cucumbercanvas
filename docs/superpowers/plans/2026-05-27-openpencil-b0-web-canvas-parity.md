# OpenPencil B0 Web Canvas Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenPencil Web Canvas Parity Matrix, then implement every discovered P0/P1 gap in Cucumber's Web canvas main path.

**Architecture:** Use a parity-matrix-first workflow. The browser editor remains the live document authority, `SkiaCanvas` and `CanvasApi` remain the Web editing boundary, `LiveCanvasService` remains the server-to-browser document bridge, and all Agent/MCP output remains normal editable `PenDocument` content.

**Tech Stack:** Next.js, React 19, TypeScript, CanvasKit/Skia, `@cucumber/canvas-core`, `@cucumber/pen-*`, Fastify, Deep Agents, MCP tools, Vitest, Playwright, Biome.

---

## File Structure

- Create: `docs/tech/openpencil-web-canvas-parity.md`
  - Durable parity matrix. Each row maps an OpenPencil Web canvas capability to Cucumber implementation status, owner files, acceptance criteria, and verification command.
- Modify: `docs/tech/canvas-design-integration.md`
  - Add B0 behavior notes only when B0 implementation changes editor/import/design-system/MCP/export workflow or contracts.
- Modify: `docs/tech/agent-runtime-workflow.md`
  - Add B0 notes only when Agent/MCP runtime sequence changes.
- Modify: `progress.md`
  - Track B0 start, matrix status, implemented P0/P1 rows, and verification results.
- Modify: `feature_list.json`
  - Track B0 under `CORE-005` or a new OpenPencil B0 feature entry.
- Likely modify: `apps/web/src/components/canvas/skia-canvas.tsx`
  - Editor, selection, import, Agent insertion, export interaction fixes found by the matrix.
- Likely modify: `apps/web/src/components/canvas/canvas-api.ts`
  - Public API extension only when a P0/P1 row cannot be expressed through the current contract.
- Likely modify: `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx`
  - Inspector coverage and user-facing error clarity gaps.
- Likely modify: `apps/web/src/components/canvas-design-system-panel.tsx`
  - Component/ref/variable/theme/icon parity gaps.
- Likely modify: `apps/server/src/mcp/tools/open-pencil-canvas.ts`
  - MCP parity gaps around batch/read/layout/find/style/variable/codegen/page-aware behavior.
- Likely modify: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`
  - Contract tests for every MCP P0/P1 row.
- Likely modify: `packages/canvas-core/src/*`
  - Shared document/import/export/layout fixes.
- Likely modify: `packages/pen-renderer/src/*`
  - Rendering/hit-testing/overlay fixes.
- Likely modify: `apps/web/test/*canvas*.test.tsx`
  - Component/unit coverage for Web canvas P0/P1 rows.
- Likely modify: `tests/e2e/canvas-import.spec.ts`
  - Import smoke expansion.
- Likely modify: `tests/e2e/skia-canvas.spec.ts`
  - Editor and Agent-output smoke expansion.

## Implementation Rule For Unknown P0/P1 Rows

The exact P0/P1 implementation rows are discovered by Task 1. Do not guess them before the matrix exists. After Task 1, every P0/P1 row must be implemented with the same small loop:

1. Add or update the failing test or smoke step named in that row's `verification` column.
2. Run that test and capture the expected failure.
3. Implement the smallest production change in the row's `cucumberTarget` files.
4. Add focused structured logs when diagnosis would otherwise be opaque.
5. Re-run the row verification.
6. Update the matrix row status to `done` or `blocked` with concrete reason.
7. Commit that row or a tightly related group of rows.

Do not implement roadmap rows in B0.

---

### Task 1: Create The Initial Parity Matrix

**Files:**
- Create: `docs/tech/openpencil-web-canvas-parity.md`
- Modify: `progress.md`
- Modify: `feature_list.json`

- [ ] **Step 1: Write the matrix document**

Create `docs/tech/openpencil-web-canvas-parity.md` with this content:

```markdown
# OpenPencil Web Canvas Parity Matrix

Last updated: 2026-05-27 CST

## Scope

This matrix tracks B0 only: OpenPencil Web canvas main-path parity inside Cucumber Studio. It covers editor, import, design system, Agent generation, MCP, export, and verification. Desktop, full CLI, Git, i18n, collaboration, plugin system, and complete native codegen matrix are roadmap-only for B0.

## Status Legend

- `done`: Cucumber already satisfies the behavior and has usable verification.
- `P0`: Main path cannot complete or persist correctly without this gap fixed.
- `P1`: Main path works but is materially weaker than OpenPencil.
- `blocked`: A concrete dependency prevents implementation.
- `roadmap`: Useful OpenPencil parity outside B0.

## Matrix

| Area | Capability | OpenPencil Reference | Cucumber Target | Status | Acceptance | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| editor | Multi-page create, rename, duplicate, reorder, delete, switch | `openpencil/apps/web/src/components/editor/page-tabs.tsx`; `openpencil/packages/pen-react/src/components/page-tabs.tsx` | `apps/web/src/components/canvas/page-tabs.tsx`; `packages/canvas-core/src/pages.ts`; `apps/web/test/canvas-page-tabs.test.tsx` | done | User can manage pages without stale selection or invalid active page. | `pnpm --filter @cucumber/web exec vitest run test/canvas-page-tabs.test.tsx` | Existing Phase A coverage. |
| editor | Core toolbar tools for select, hand, frame, text, shape, path, image/SVG, icon | `openpencil/apps/web/src/components/editor/toolbar.tsx`; `openpencil/apps/web/src/components/editor/shape-tool-dropdown.tsx` | `apps/web/src/components/canvas/editor-toolbar.tsx`; `apps/web/src/components/canvas/shape-tool-dropdown.tsx`; `apps/web/test/canvas-editor-toolbar.test.tsx` | done | Tool active state and disabled state are visible and functional. | `pnpm --filter @cucumber/web exec vitest run test/canvas-editor-toolbar.test.tsx` | Verify exact import/icon affordances during Task 2. |
| editor | Draw/select/move/resize/rotate rectangles, ellipses, polygons, paths, text, lines, arrows | `openpencil/apps/web/src/canvas/skia/skia-interaction*.ts`; `openpencil/apps/web/src/canvas/skia/path-editing.ts` | `apps/web/src/components/canvas/skia-canvas.tsx`; `apps/web/src/components/canvas/canvas-pen-tool.ts`; `tests/e2e/skia-canvas.spec.ts` | P1 | Each tool produces visible editable Pen nodes and overlays stay aligned in scene coordinates. | `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts` | Audit path/text/line/arrow parity before implementation. |
| editor | Layers lock, visibility, rename, reorder, move to parent index | `openpencil/packages/pen-react/src/components/layer-panel.tsx`; `openpencil/packages/pen-react/src/components/layer-item.tsx` | `apps/web/src/components/canvas-layers-panel.tsx`; `apps/web/src/components/canvas/canvas-api.ts` | P1 | Layer actions update the live document, preserve selection, and fail with readable messages. | Add or extend `apps/web/test/canvas-layers-panel.test.tsx`; run `pnpm --filter @cucumber/web exec vitest run test/canvas-layers-panel.test.tsx` | Existing panel needs explicit B0 coverage. |
| editor | Property panel position, size, rotation, fill, stroke, effects, text, layout, lock/visibility | `openpencil/packages/pen-react/src/components/property-panel.tsx`; `openpencil/packages/pen-react/src/components/sections/*` | `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx` | P1 | Selected node controls cover OpenPencil main-path fields and never display raw null/undefined. | Add or extend `apps/web/test/canvas-property-panel.test.tsx`; run `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx` | Needs coverage-driven audit. |
| import | Figma native clipboard and HTML/SVG fallback paste | `openpencil/packages/pen-figma/src/*`; `openpencil/apps/web/src/hooks/*figma*` | `packages/pen-figma/src/*`; `packages/canvas-core/src/figma-native.ts`; `packages/canvas-core/src/import.ts`; `apps/web/src/components/canvas/use-canvas-clipboard-import.ts` | done | Figma paste inserts editable nodes and reports strategy/warnings. | `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/figma-native-adapter.test.ts --environment jsdom`; `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx` | Real fixture expansion remains P1 if uncovered. |
| import | SVG and raster image paste/import with warning metadata | `openpencil/packages/pen-mcp/src/tools/import-svg.ts`; `openpencil/apps/web/src/canvas/skia/skia-image-loader.ts` | `packages/canvas-core/src/import.ts`; `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`; `tests/e2e/canvas-import.spec.ts` | P1 | SVG/raster imports preserve editable geometry/assets where possible and show concrete warnings. | `pnpm exec playwright test tests/e2e/canvas-import.spec.ts` | Expand smoke cases if diagnostics are not visible enough. |
| design-system | Components, refs, variables, themes, icon insertion/rendering | `openpencil/packages/pen-react/src/components/icon-picker-dialog.tsx`; `openpencil/packages/pen-mcp/src/tools/variables.ts`; `openpencil/packages/pen-mcp/src/tools/theme-presets.ts` | `apps/web/src/components/canvas-design-system-panel.tsx`; `apps/web/src/components/canvas/icon-library.ts`; `apps/web/test/canvas-design-system-panel.test.tsx` | done | Components/refs/variables/themes/icons can be created and inserted into the live canvas. | `pnpm --filter @cucumber/web exec vitest run test/canvas-design-system-panel.test.tsx` | Audit variable delete protection and theme UX in Task 2. |
| agent-generation | Prompt-to-canvas plan/execute creates durable containers and preserves manual nodes | `openpencil/apps/web/src/services/ai/orchestrator.ts`; `openpencil/apps/web/src/services/ai/orchestrator-sub-agent.ts` | `apps/server/src/mcp/tools/open-pencil-canvas.ts`; `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`; `apps/server/src/agent/prompts/cucumber-main.ts` | P0 | Agent tool path inserts root/section containers with trace metadata and does not overwrite manual nodes. | `cd apps/server && PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests` | Add explicit smoke coverage for live Agent-output flow if missing. |
| mcp | Batch design/read/snapshot/find/style/variable/page/codegen tools use live editor document | `openpencil/packages/pen-mcp/src/tools/*`; `openpencil/packages/pen-mcp/src/routes/*` | `apps/server/src/mcp/tools/open-pencil-canvas.ts`; `apps/server/src/mcp/server.ts`; `apps/server/src/mcp/tools/open-pencil-canvas.test.ts` | P1 | Tool outputs are OpenPencil-compatible enough for the Web main path and return concrete errors. | `cd apps/server && PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests` | Audit missing layered design equivalents in Task 2. |
| export | Selection/node image export and React/HTML/Vue design-as-code output | `openpencil/packages/pen-mcp/src/tools/codegen-*`; `openpencil/apps/web/src/utils/global-export.ts` | `apps/web/src/components/canvas/canvas-export.ts`; `apps/web/test/canvas-export.test.ts`; `apps/server/src/mcp/tools/open-pencil-canvas.ts` | P1 | Selected nodes export with stable files and warnings for unsupported nodes. | `pnpm --filter @cucumber/web exec vitest run test/canvas-export.test.ts`; MCP codegen export test above | Audit unsupported-node warning quality. |
| verification | Deterministic browser smoke for Web canvas main path | `openpencil/apps/web/src/canvas/skia/__tests__/*` | `tests/e2e/skia-canvas.spec.ts`; `tests/e2e/canvas-import.spec.ts`; new Agent/export smoke if needed | P1 | E2E covers editor/import/Agent-output/export enough to detect regressions. | `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts` | Add missing smoke coverage from Task 2. |
| roadmap | Desktop app parity | `openpencil/apps/desktop/*` | none in B0 | roadmap | Not implemented in B0. | Not applicable. | Out of scope. |
| roadmap | Full CLI parity | `openpencil/apps/cli/*` | none in B0 | roadmap | Not implemented in B0. | Not applicable. | Out of scope. |
| roadmap | Git, i18n, collaboration, plugin system | `openpencil/apps/web/src/services/git-*`; OpenPencil roadmap | none in B0 | roadmap | Not implemented in B0. | Not applicable. | Out of scope. |
| roadmap | Full native codegen matrix | `openpencil/packages/pen-ai-skills/skills/knowledge/codegen-*.md` | `apps/server/src/mcp/tools/open-pencil-canvas.ts` | roadmap | React/HTML/Vue stay B0; native targets are later quality work. | Not applicable. | Out of scope. |

## P0/P1 Execution Log

Update this section as each row is verified.

| Date | Row | Result | Verification |
| --- | --- | --- | --- |
```

- [ ] **Step 2: Update progress tracking**

Append this entry near the top of `progress.md` under `## 2026-05-27`:

```markdown
- B0 OpenPencil Web canvas parity started: the implementation will use a durable parity matrix first, then close every discovered P0/P1 Web canvas main-path gap while recording desktop/CLI/Git/i18n/collaboration/plugin/native-codegen surfaces as roadmap-only.
```

- [ ] **Step 3: Update feature registry**

In `feature_list.json`, add a new feature object after `openpencil-phase-c-codegen-orchestration`:

```json
{
  "id": "openpencil-b0-web-canvas-parity",
  "name": "OpenPencil B0 Web canvas parity",
  "status": "active",
  "priority": "P0",
  "owner": "product-engineering",
  "summary": "Parity-matrix-first B0 implementation that audits OpenPencil Web canvas main-path capabilities, closes P0/P1 editor/import/design-system/Agent/MCP/export gaps, and records desktop/CLI/Git/i18n/collaboration/plugin/native-codegen surfaces as roadmap-only.",
  "scope": "Web canvas parity matrix plus P0/P1 implementation for editor, import, design system, Agent generation, MCP, export, and verification.",
  "artifacts": [
    "docs/tech/openpencil-web-canvas-parity.md",
    "docs/superpowers/specs/2026-05-27-openpencil-b0-web-canvas-parity-design.md",
    "docs/superpowers/plans/2026-05-27-openpencil-b0-web-canvas-parity.md"
  ]
}
```

- [ ] **Step 4: Run documentation checks**

Run:

```bash
pnpm exec biome check docs/tech/openpencil-web-canvas-parity.md progress.md feature_list.json
```

Expected: PASS or unrelated existing diagnostics outside these files.

- [ ] **Step 5: Commit the matrix baseline**

Run:

```bash
git add docs/tech/openpencil-web-canvas-parity.md progress.md feature_list.json
git commit -m "docs: add openpencil b0 parity matrix"
```

Expected: commit succeeds with only the matrix and tracking files.

### Task 2: Audit Matrix Rows Against Current Code

**Files:**
- Modify: `docs/tech/openpencil-web-canvas-parity.md`

- [ ] **Step 1: Inspect OpenPencil reference files for each area**

Run:

```bash
rg -n "page|toolbar|shape|boolean|layer|property|figma|import|variables|theme|codegen|design_skeleton|design_content|design_refine|orchestrator|progress|export" openpencil/apps/web/src/canvas/skia openpencil/apps/web/src/components/editor openpencil/packages/pen-react/src/components openpencil/packages/pen-mcp/src openpencil/packages/pen-ai-skills openpencil/apps/web/src/services/ai
```

Expected: output identifies the exact reference files for every matrix row.

- [ ] **Step 2: Inspect Cucumber implementation and tests**

Run:

```bash
rg -n "page|toolbar|shape|boolean|layer|property|figma|import|variables|theme|codegen|prompt_canvas|batch_design|snapshot_layout|find_empty_space|export|warning|toast" apps/web/src/components apps/web/test apps/server/src/mcp packages/canvas-core/src packages/pen-renderer/src tests/e2e
```

Expected: output identifies Cucumber target files and current coverage for every matrix row.

- [ ] **Step 3: Update row statuses**

For each matrix row, rewrite the row with actual file paths, status, acceptance, verification, and notes. The finished row should look like this example shape, with the row's real values:

```markdown
| agent-generation | Prompt-to-canvas plan/execute creates durable containers and preserves manual nodes | `openpencil/apps/web/src/services/ai/orchestrator.ts`; `openpencil/apps/web/src/services/ai/orchestrator-sub-agent.ts` | `apps/server/src/mcp/tools/open-pencil-canvas.ts`; `apps/server/src/mcp/tools/open-pencil-canvas.test.ts` | P0 | Agent tool path inserts root/section containers with trace metadata and does not overwrite manual nodes. | `cd apps/server && PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests` | Existing contract tests need a browser-main-path preservation assertion before this row can be marked done. |
```

Use these rules:

- Mark `done` only when the behavior exists and the `verification` command is credible.
- Mark `P0` when a normal Web canvas main path cannot complete or persist without the fix.
- Mark `P1` when behavior exists but is weaker than OpenPencil or under-verified.
- Mark `blocked` only with a concrete dependency.
- Keep desktop, full CLI, Git, i18n, collaboration, plugin system, and full native codegen matrix as `roadmap`.

- [ ] **Step 4: Run the commands for all `done` rows**

Run the exact commands listed in the `verification` column for rows still marked `done`.

Expected: every `done` row passes. If a command fails because of the row itself, reclassify the row to `P0` or `P1`. If a command fails because of unrelated existing diagnostics, add the path and reason to the row notes.

- [ ] **Step 5: Commit audited matrix**

Run:

```bash
git add docs/tech/openpencil-web-canvas-parity.md
git commit -m "docs: audit openpencil b0 parity rows"
```

Expected: commit succeeds with only the matrix audit update.

### Task 3: Implement P0 Rows One By One

**Files:**
- Modify: files named in each P0 row's `cucumberTarget`
- Modify: tests named in each P0 row's `verification`
- Modify: `docs/tech/openpencil-web-canvas-parity.md`
- Modify: `progress.md`

- [ ] **Step 1: Pick the first P0 row from the matrix**

Use the topmost non-blocked P0 row in `docs/tech/openpencil-web-canvas-parity.md`.

Expected: exactly one P0 capability is selected unless two rows share the same production files and test command.

- [ ] **Step 2: Write or enable the failing verification**

If the row already names a test file, add the missing assertion there. If it names a missing test, create that test file.

Use this pattern for Vitest assertions:

```ts
it("describes the P0 behavior in user-visible terms", async () => {
  // Arrange the smallest document/tool state that reproduces the matrix row.
  // Act through the public helper, component, CanvasApi, or MCP tool boundary.
  // Assert the behavior and the readable failure/diagnostic surface.
});
```

For Playwright rows, use this pattern:

```ts
test("describes the P0 canvas main-path behavior", async ({ page }) => {
  await page.goto("/test/canvas-engine");
  await expect(page.getByTestId("skia-canvas-stage")).toBeVisible();
  // Interact through visible toolbar/canvas controls.
  // Assert the document snapshot or visible canvas result.
});
```

- [ ] **Step 3: Run the row verification and confirm RED**

Run the exact command from the row's `verification` column.

Expected: FAIL for the missing P0 behavior, not because of unrelated setup.

- [ ] **Step 4: Implement the smallest production fix**

Edit only the files named in the P0 row's `cucumberTarget`.

Required implementation constraints:

- Preserve `SkiaCanvas` / `CanvasApi` / `LiveCanvasService` boundaries.
- Do not introduce a parallel durable document model.
- Add structured logs only where diagnosis would otherwise be opaque.
- Throw concrete errors rather than silently falling back.
- Do not surface raw error codes, `null`, `undefined`, or placeholders in UI output.

- [ ] **Step 5: Re-run the row verification and update the matrix**

Run the exact command from the row's `verification` column.

Expected: PASS.

Update the row status to `done`, and append a `P0/P1 Execution Log` entry:

```markdown
| 2026-05-27 | agent-generation/prompt-to-canvas plan execute | done | `cd apps/server && PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests` |
```

- [ ] **Step 6: Run targeted typecheck/lint for touched workspaces**

Pick the relevant commands:

```bash
pnpm --filter @cucumber/web typecheck
pnpm --filter @cucumber/canvas-core typecheck
pnpm --filter @cucumber/pen-renderer typecheck
pnpm --filter @cucumber/server typecheck
pnpm exec biome check apps/web/src/components/canvas apps/web/src/components/canvas-design-system-panel.tsx apps/web/test apps/server/src/mcp packages/canvas-core/src packages/pen-renderer/src tests/e2e docs/tech/openpencil-web-canvas-parity.md progress.md feature_list.json
```

Expected: PASS, or unrelated existing diagnostics documented with file paths.

- [ ] **Step 7: Commit the P0 row**

Run:

```bash
git add apps/web/src/components/canvas apps/web/src/components/canvas-design-system-panel.tsx apps/web/test apps/server/src/mcp packages/canvas-core/src packages/pen-renderer/src tests/e2e docs/tech/openpencil-web-canvas-parity.md progress.md
git commit -m "fix: close openpencil b0 parity gap"
```

Expected: commit succeeds with only the P0 row's files.

- [ ] **Step 8: Repeat Task 3 until no non-blocked P0 rows remain**

Expected: matrix has no `P0` rows except rows marked `blocked` with concrete dependency.

### Task 4: Implement P1 Rows In Tight Groups

**Files:**
- Modify: files named in each P1 row's `cucumberTarget`
- Modify: tests named in each P1 row's `verification`
- Modify: `docs/tech/openpencil-web-canvas-parity.md`
- Modify: `progress.md`

- [ ] **Step 1: Group related P1 rows by target files**

Use these groups:

```markdown
- editor-runtime: `apps/web/src/components/canvas/skia-canvas.tsx`, renderer helpers, keyboard/selection tests, Playwright editor smoke.
- editor-ui: toolbar, page tabs, property panel, layers panel, component tests.
- import: canvas-core import helpers, Figma/SVG/raster tests, clipboard hook tests, import e2e.
- design-system: design-system panel, icon library, variable/theme/component tests.
- mcp: open-pencil-canvas tools and tests.
- export: canvas-export helper, MCP codegen export, export tests.
- verification: e2e smoke and harness-only changes.
```

- [ ] **Step 2: For each group, write failing tests first**

For every P1 row in the group, add or extend the named verification. Use a single focused test file when rows share the same boundary.

Expected: tests fail for the parity weakness or missing diagnostic.

- [ ] **Step 3: Implement the group fixes**

Edit only the group's target files. Keep changes tightly scoped to the matrix rows.

Required logs:

```ts
console.info("[openpencil-b0-parity] editor.property-panel.update", {
  canvasId,
  pageId,
  nodeIds,
  reason,
});
```

Use an existing prefix instead when one is already established in the file, such as `[skia-canvas]`, `[canvas-import]`, `[canvas-design-system]`, or `[phase-c-orchestration]`.

- [ ] **Step 4: Re-run group verification**

Run all commands from the group's P1 rows.

Expected: PASS.

- [ ] **Step 5: Update matrix and progress**

Update each completed P1 row to `done`, and add execution log entries:

```markdown
| 2026-05-27 | editor/property panel coverage | done | `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx` |
```

Append a short `progress.md` entry:

```markdown
- Closed OpenPencil B0 editor P1 parity gaps for property panel coverage; verification passed with `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx`.
```

- [ ] **Step 6: Run targeted typecheck/lint**

Pick relevant commands:

```bash
pnpm --filter @cucumber/web typecheck
pnpm --filter @cucumber/canvas-core typecheck
pnpm --filter @cucumber/pen-renderer typecheck
pnpm --filter @cucumber/server typecheck
pnpm exec biome check apps/web/src/components/canvas apps/web/src/components/canvas-design-system-panel.tsx apps/web/test apps/server/src/mcp packages/canvas-core/src packages/pen-renderer/src tests/e2e docs/tech/openpencil-web-canvas-parity.md progress.md feature_list.json
```

Expected: PASS, or unrelated existing diagnostics documented with file paths.

- [ ] **Step 7: Commit the group**

Run:

```bash
git add apps/web/src/components/canvas apps/web/src/components/canvas-design-system-panel.tsx apps/web/test apps/server/src/mcp packages/canvas-core/src packages/pen-renderer/src tests/e2e docs/tech/openpencil-web-canvas-parity.md progress.md
git commit -m "fix: improve openpencil b0 parity"
```

Expected: commit succeeds with only the group's files.

- [ ] **Step 8: Repeat Task 4 until no non-blocked P1 rows remain**

Expected: matrix has no `P1` rows except rows marked `blocked` with concrete dependency.

### Task 5: Add Final Web Canvas Main-Path Smoke Coverage

**Files:**
- Modify: `tests/e2e/skia-canvas.spec.ts`
- Modify: `tests/e2e/canvas-import.spec.ts`
- Create if needed: `tests/e2e/canvas-agent-output.spec.ts`
- Create if needed: `tests/e2e/canvas-export.spec.ts`
- Modify if needed: `apps/web/src/app/test/canvas-engine/canvas-engine-harness.tsx`
- Modify if needed: `apps/web/src/app/test/canvas-import/canvas-import-harness.tsx`

- [ ] **Step 1: Add an editor smoke assertion**

In `tests/e2e/skia-canvas.spec.ts`, add a test that exercises:

```ts
test("creates, edits, reorders, and persists basic canvas nodes", async ({ page }) => {
  await page.goto("/test/canvas-engine");
  await expect(page.getByTestId("skia-canvas-stage")).toBeVisible();
  // Use existing toolbar interactions from this file.
  // Assert document snapshot includes rectangle, text, and reordered layer state.
});
```

Use the harness's existing document snapshot test IDs. If a needed test ID is missing, add it to the harness rather than inspecting private React state.

- [ ] **Step 2: Add an import diagnostics smoke assertion**

In `tests/e2e/canvas-import.spec.ts`, add or extend a test that exercises SVG or Figma-like paste and asserts:

```ts
await expect(page.getByTestId("imported-selection-count")).toContainText(/[1-9]/);
await expect(page.getByTestId("selected-meta")).toContainText(/source|origin|strategy|warning/i);
```

- [ ] **Step 3: Add Agent-output smoke if not covered by MCP tests**

Create `tests/e2e/canvas-agent-output.spec.ts` only if Task 2 confirms there is no browser-level Agent-output smoke.

The test should use a harness route, not production auth flow, and assert that generated root/section containers appear in the document snapshot.

- [ ] **Step 4: Add export smoke if not covered by existing tests**

Create `tests/e2e/canvas-export.spec.ts` only if Task 2 confirms existing unit/MCP export tests do not cover Web selection export.

The test should export a selected node through the public UI or harness API and assert a non-empty file/blob result.

- [ ] **Step 5: Run e2e smoke**

Run:

```bash
pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts
```

If new files were created, include them:

```bash
pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts tests/e2e/canvas-agent-output.spec.ts tests/e2e/canvas-export.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit smoke coverage**

Run:

```bash
git add tests/e2e apps/web/src/app/test docs/tech/openpencil-web-canvas-parity.md progress.md
git commit -m "test: cover openpencil b0 canvas main path"
```

Expected: commit succeeds with only smoke/harness/matrix/progress files.

### Task 6: Final Documentation And Registry Update

**Files:**
- Modify: `docs/tech/openpencil-web-canvas-parity.md`
- Modify: `docs/tech/canvas-design-integration.md`
- Modify: `docs/tech/agent-runtime-workflow.md`
- Modify: `progress.md`
- Modify: `feature_list.json`

- [ ] **Step 1: Finalize matrix status**

Ensure `docs/tech/openpencil-web-canvas-parity.md` has:

```markdown
## Final B0 Summary

- P0 rows: 0 open, 1 done, 0 blocked.
- P1 rows: 0 open, 7 done, 0 blocked.
- Roadmap rows remain out of B0 scope.
- Final verification commands:
  - `pnpm --filter @cucumber/web typecheck`: passed.
```

- [ ] **Step 2: Update technical docs**

Update `docs/tech/canvas-design-integration.md` only with B0 workflow or contract changes that actually happened.

Update `docs/tech/agent-runtime-workflow.md` only with Agent/MCP runtime sequence changes that actually happened.

- [ ] **Step 3: Update progress**

Append:

```markdown
- B0 OpenPencil Web canvas parity completed for all non-blocked P0/P1 rows. The parity matrix now records final status, verification commands, blocked rows with concrete reasons, and roadmap-only surfaces for desktop, full CLI, Git, i18n, collaboration, plugin system, and full native codegen.
```

- [ ] **Step 4: Update feature registry**

Set `openpencil-b0-web-canvas-parity.status` to `"done"` if all non-blocked P0/P1 rows are complete. Keep it `"active"` if any row is blocked and still needs user or external dependency resolution.

Update the `summary` with the final implemented capabilities and add all touched artifacts.

- [ ] **Step 5: Run final focused verification**

Run:

```bash
pnpm --filter @cucumber/web typecheck
pnpm --filter @cucumber/canvas-core typecheck
pnpm --filter @cucumber/pen-renderer typecheck
pnpm --filter @cucumber/server typecheck
pnpm exec biome check docs/tech/openpencil-web-canvas-parity.md docs/tech/canvas-design-integration.md docs/tech/agent-runtime-workflow.md progress.md feature_list.json
pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts
```

Expected: PASS, or unrelated existing diagnostics documented in `docs/tech/openpencil-web-canvas-parity.md` and the final user summary.

- [ ] **Step 6: Build if runtime bundling changed**

If any Web runtime, Next config, package, or renderer bundling path changed, run:

```bash
pnpm --filter @cucumber/web build
```

Expected: PASS, or existing unrelated build blocker documented with concrete path/error.

- [ ] **Step 7: Commit final docs**

Run:

```bash
git add docs/tech/openpencil-web-canvas-parity.md docs/tech/canvas-design-integration.md docs/tech/agent-runtime-workflow.md progress.md feature_list.json
git commit -m "docs: finalize openpencil b0 parity status"
```

Expected: commit succeeds with final documentation and registry updates.

### Task 7: Completion Review

**Files:**
- Read: `docs/tech/openpencil-web-canvas-parity.md`
- Read: `progress.md`
- Read: `feature_list.json`
- Read: `git status --short`

- [ ] **Step 1: Verify no open P0/P1 rows remain**

Run:

```bash
rg -n "\\| P0 \\||\\| P1 \\|" docs/tech/openpencil-web-canvas-parity.md
```

Expected: no non-blocked P0/P1 rows. If blocked rows exist, each must include a concrete dependency and nearest useful verification.

- [ ] **Step 2: Verify working tree state**

Run:

```bash
git status --short
```

Expected: clean, or only unrelated user changes called out explicitly.

- [ ] **Step 3: Prepare final summary**

Final summary must include:

```markdown
- Matrix path: `docs/tech/openpencil-web-canvas-parity.md`
- Implemented P0/P1 rows by area.
- Verification commands and results.
- Blocked rows, if any, with concrete reason.
- Roadmap-only items kept out of B0.
```

Expected: user can see exactly what changed and what remains.
