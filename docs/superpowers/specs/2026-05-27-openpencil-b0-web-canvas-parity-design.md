# OpenPencil B0 Web Canvas Parity Design

## Goal

Deliver B0 for the OpenPencil replication effort:

1. Build an explicit OpenPencil Web Canvas Parity Matrix for Cucumber Studio.
2. Implement P0/P1 gaps found in the Web canvas main path.
3. Record P2/P3 product surfaces in a roadmap without pulling them into this implementation slice.

B0 is the foundation for the larger B scope: OpenPencil-style Web canvas parity plus later AI workflow layers such as Agent Teams, style guides, prompt layering, model capability profiles, and generation visualization.

## Chosen Approach

Use a parity-matrix-first implementation. Compare OpenPencil's Web canvas main path against Cucumber's current Skia/Pen/live-canvas architecture, classify each gap as `done`, `P0`, `P1`, `blocked`, or `roadmap`, then implement all P0/P1 gaps in focused slices.

This approach keeps Cucumber Studio's product architecture intact:

- The browser editor remains the live document authority.
- `SkiaCanvas` and `CanvasApi` remain the Web interaction boundary.
- `LiveCanvasService` remains the server-to-browser document bridge.
- Existing `packages/pen-*` and `packages/canvas-core` helpers remain the shared document/rendering foundation.
- Deep Agents and MCP tools continue to create normal editable `PenDocument` nodes rather than a parallel OpenPencil runtime.

## Alternatives Considered

### Module-By-Module Port

Port OpenPencil modules vertically, such as editor first, then import, then MCP, then Agent workflows.

Benefit: each module can become visually complete.

Cost: the end-to-end Web canvas main path can still remain broken while individual modules look done. It also increases collision risk with Cucumber's Next.js routing, Supabase persistence, WebSocket RPC, and Deep Agents boundaries. This is not selected for B0.

### AI Happy Path First

Prioritize an OpenPencil-style prompt-to-canvas happy path with prompt layering and generation visualization, then backfill editor and import details later.

Benefit: strong product demo value.

Cost: foundational editor/import/MCP/export gaps would be hidden under the Agent workflow and would resurface during B1 Agent Teams work. This is not selected for B0 because the user explicitly approved B0 as the first implementation slice.

## Current Context

Cucumber already includes substantial OpenPencil-derived canvas foundation:

- `packages/pen-types`: Pen document and node schema with Cucumber metadata extensions.
- `packages/pen-core`: layout, boolean ops, merge, variables, path anchors, and normalization helpers.
- `packages/pen-renderer`: standalone CanvasKit renderer.
- `packages/pen-figma`: vendored OpenPencil Figma clipboard parser and converters.
- `packages/canvas-core`: Cucumber canvas document helpers, pages, import, operations, clipboard, layout, and history.
- `apps/web/src/components/canvas/skia-canvas.tsx`: active Web canvas runtime.
- `apps/web/src/components/canvas/canvas-api.ts`: stable public canvas contract.
- `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx`: selected-node inspector with Cucumber metadata controls.
- `apps/web/src/components/canvas-design-system-panel.tsx`: component, variable, theme, and icon panel.
- `apps/web/src/components/canvas-editor.tsx`: persistence, thumbnail, screenshot, and live RPC boundary.
- `apps/server/src/features/canvas/live-canvas-service.ts`: live editor document bridge.
- `apps/server/src/mcp/tools/open-pencil-canvas.ts`: OpenPencil-compatible live MCP tools, style/variable tools, prompt-canvas thin slice, and codegen export.

Relevant OpenPencil references for B0:

- `openpencil/apps/web/src/canvas/skia/*`
- `openpencil/apps/web/src/components/editor/*`
- `openpencil/packages/pen-react/src/components/*`
- `openpencil/packages/pen-mcp/src/tools/*`
- `openpencil/packages/pen-mcp/src/routes/*`
- `openpencil/packages/pen-ai-skills/*`
- `openpencil/apps/web/src/services/ai/orchestrator*.ts`
- `openpencil/apps/web/src/services/ai/model-profiles.ts`
- `openpencil/apps/web/src/services/ai/orchestrator-progress.ts`

## Scope

### In Scope

B0 covers the OpenPencil Web canvas main path:

- Editor: pages, tools, selection, move, resize, rotate, text, shapes, path basics, layers, grouping, ordering, undo/redo, and persistence.
- Import: Figma native clipboard, SVG, raster image paste/import, import metadata, warning summaries, and editable inserted nodes.
- Design System: reusable components, refs, variables, themes, icon insertion, rendering, and selected-node variable binding.
- Agent Generation: prompt-to-canvas creates durable editable containers, preserves manual user nodes, and stores trace metadata.
- MCP: batch design/read/layout/find/style/variable/codegen/page-adjacent tools remain live-editor synchronized and diagnosable.
- Export: selection/node image export and React/HTML/Vue design-as-code output with explicit warnings for unsupported nodes.
- Verification: focused unit/component/MCP tests plus Playwright smoke coverage for the main path.

### Roadmap Only

B0 does not implement:

- Desktop app parity.
- Full CLI parity.
- Git panel parity.
- i18n parity.
- Collaborative editing.
- Plugin system.
- Complete native codegen output quality for Flutter, SwiftUI, Jetpack Compose, and React Native.
- Full B1 Agent Teams implementation.

These should be recorded in the parity matrix as roadmap items when discovered.

## Parity Matrix

Create a durable matrix in `docs/tech/openpencil-web-canvas-parity.md`.

Each row should include:

- `area`: `editor`, `import`, `design-system`, `agent-generation`, `mcp`, `export`, or `verification`.
- `capability`: the concrete behavior.
- `openpencilReference`: one or more OpenPencil files.
- `cucumberTarget`: one or more Cucumber files.
- `status`: `done`, `P0`, `P1`, `blocked`, or `roadmap`.
- `acceptance`: user-visible or tool-visible behavior required.
- `verification`: exact test, typecheck, lint, build, or browser smoke command.
- `notes`: concise reason for classification.

Classification rules:

- `P0`: the OpenPencil Web canvas main path cannot complete without it. Examples include broken draw/select/edit/import/export/MCP/persistence/Agent-generation behavior.
- `P1`: the main path works but is materially weaker than OpenPencil. Examples include incomplete property coverage, rough layer operations, missing diagnostics, missing smoke tests, or weak unsupported-node warnings.
- `blocked`: a concrete local or external dependency prevents implementation; include the dependency and the nearest useful verification.
- `roadmap`: useful OpenPencil parity that is outside B0 scope.

## Product Behavior

### Editor

Users can manage multiple pages, use a dense editor toolbar, draw and select nodes, move/resize/rotate nodes, edit text, group/ungroup, reorder layers, lock/hide layers, undo/redo, and persist changes.

P0 editor gaps should be fixed when they break a normal edit session or cause persisted document divergence.

P1 editor gaps should be fixed when the tool exists but feels unreliable or incomplete compared with OpenPencil, such as missing property panel controls, rough alignment/snapping behavior, or missing deterministic smoke coverage.

### Import

Users can paste or import Figma, SVG, and raster images into the active canvas page. Imported nodes remain editable Pen nodes where possible, preserve source metadata, and surface readable warnings when fidelity is degraded.

Import failures must explain the cause. The UI must not show raw error codes, `null`, `undefined`, or placeholder defaults.

### Design System

Users can create reusable components, insert refs, create and bind variables, manage themes, and insert icons that render through the Skia/Pen renderer path.

Variable deletes should be blocked when nodes still reference the variable. Component/ref operations should leave normal editable nodes and clear metadata.

### Agent Generation

The Agent can create durable root and section containers on the live canvas. Generated nodes are normal editable Pen nodes, include trace metadata, preserve manual user content, and can be selected for follow-up editing or export.

B0 should harden the current prompt-canvas thin slice and smoke-test the main path. Full Agent Teams, style guide orchestration, and model capability profile routing are B1.

### MCP

OpenPencil-compatible MCP tools operate against the open live canvas through `LiveCanvasService`. Tools read the latest live document before writing, serialize document writes, return concrete errors, and log useful context.

B0 should audit and fill P0/P1 gaps around batch design, read, snapshot layout, find empty space, style/variable operations, page-aware behavior, codegen export, and layered design equivalents where they are needed for Web canvas main-path parity.

### Export

Users and Agent tools can export selected nodes or explicit node IDs to image output and design-as-code files for React, HTML, and Vue. Unsupported nodes must produce explicit warnings rather than silent placeholders.

## Data Flow

The authoritative Web canvas path is:

1. User or Agent submits a prompt or command.
2. Server tools and Deep Agents produce typed canvas operations or MCP tool calls.
3. `LiveCanvasService` reads the open browser canvas over WebSocket RPC.
4. `SkiaCanvas` applies changes through `CanvasApi` and shared Pen/canvas helpers.
5. `CanvasEditor` persists the resulting `PenDocument`.

Do not introduce a second durable document model. Do not bypass auth, persistence helpers, or the live editor bridge unless a specific B0 gap proves the current boundary cannot support the behavior.

## Logging And Diagnostics

Add focused structured logs where B0 changes would otherwise be opaque. Prefer existing prefixes where they already exist:

- `[skia-canvas]`
- `[canvas-import]`
- `[canvas-design-system]`
- `[phase-c-orchestration]`
- `[openpencil-b0-parity]`

Logs should include relevant IDs and context:

- `canvasId`
- `projectId`
- `userId`
- `pageId`
- `nodeIds`
- `toolName`
- `source`
- `operation`
- `reason`

Logs should help diagnose local and production failures without leaking sensitive content.

## Error Handling

Follow the project rule: no silent downgrade or fallback that hides broken state.

Expected behavior:

- Throw typed or concrete errors for invalid page, node, import, export, or MCP operations.
- Leave the document unchanged when an operation fails before commit.
- Report partial Agent generation accurately when independent sections succeed and dependent sections are skipped.
- Surface readable UI messages with cause and remediation when possible.
- Never present raw error codes, `null`, `undefined`, or default placeholders as user-facing output.

## Testing

B0 should use the narrowest useful verification first, then broaden based on touched code.

Expected coverage:

- Unit tests for `packages/canvas-core` helpers touched by editor/import/export behavior.
- Unit tests for `packages/pen-core` or `packages/pen-renderer` when parity changes affect layout, boolean ops, hit testing, rendering, or codegen helpers.
- Component tests for toolbar, page tabs, property panel, design-system panel, and clipboard/import hooks when those surfaces change.
- MCP tests near `apps/server/src/mcp/tools/open-pencil-canvas.test.ts` for tool contracts and error paths.
- Playwright smoke tests for `/test/canvas-engine`, `/test/canvas-import`, Agent-output materialization, and export where practical.

Baseline commands should be selected from:

- `pnpm --filter @cucumber/web typecheck`
- `pnpm --filter @cucumber/canvas-core typecheck`
- `pnpm --filter @cucumber/pen-renderer typecheck`
- `pnpm --filter @cucumber/server typecheck`
- targeted `vitest` commands for touched test files
- targeted `pnpm exec biome check ...` for touched files
- targeted Playwright smoke commands for changed Web canvas flows
- `pnpm --filter @cucumber/web build` when runtime bundling or Next.js output can be affected

If root checks fail because of unrelated existing diagnostics, record the failing paths and reason in the verification summary.

## Documentation Updates

B0 implementation should update:

- `docs/tech/openpencil-web-canvas-parity.md` with the matrix and final status.
- `docs/tech/canvas-design-integration.md` when canvas workflow or contracts change.
- `docs/tech/agent-runtime-workflow.md` when Agent or MCP runtime sequence changes.
- `progress.md`.
- `feature_list.json`.

## Acceptance Criteria

B0 is complete when:

- The parity matrix exists and classifies OpenPencil Web canvas main-path capabilities.
- Every P0/P1 matrix row is implemented, explicitly blocked with a concrete reason, or reclassified with justification.
- P2/P3 items are recorded as roadmap and not mixed into the implementation slice.
- Editor, import, design-system, Agent generation, MCP, and export main paths work on the live Cucumber canvas.
- Generated and imported content remains normal editable Pen nodes.
- Manual user canvas content is not silently overwritten by Agent or MCP operations.
- Logs and errors contain concrete diagnostic context.
- Relevant typecheck, tests, lint, and browser smoke verification pass, or unrelated existing failures are documented with file paths.
- `progress.md` and `feature_list.json` reflect B0 status.
