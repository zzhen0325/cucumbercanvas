# Cucumber Studio Progress

Last updated: 2026-05-22 16:28 CST

## Current Session

Goal: clarify the product positioning around AI-native infinite canvas without changing the existing UI, canvas API, schema, or manual editing entry points.

Status:

- Documented the product position that the canvas is the visual artifact of Agent execution, containers are structured Agent outputs, and spatial relationships express context, reasoning, and data flow.
- Added two concrete product scenarios: generated-image second-pass editing via contextual Agent overlay/quick actions, and stronger Figma-like editing for structured outputs such as PPT, web pages, and UI screens.
- Updated the main Agent system prompt so visual or structured work should create containerized canvas results, while respecting user manual edits as follow-up context.
- Updated the feature registry summaries for the AI-native canvas workspace and Cucumber Canvas runtime to align with the Agent-first positioning.
- Preserved existing manual creation and editing surfaces; these remain user controls for arranging, refining, and giving feedback on Agent-generated results.
- Added `@cucumber/canvas-core` with the new `CucumberCanvasDocument` model, container nodes, context resolution, typed operation errors, permission checks, and focused unit tests.
- Replaced the web canvas editor surface with `CanvasSurface` / `CanvasApi` while preserving the existing Studio shell, side panels, bottom bar, chat sidebar, and artifact insertion hooks.
- New documents save directly as Cucumber canvas content. Legacy Excalidraw payloads are treated as empty new documents rather than migrated.
- Containers can be created, selected, dragged, resized, renamed, assigned context rules, and bound to an Agent from the inspector.
- Image/video artifacts now insert through the new canvas API and land in the selected container when one is selected.
- `inspect_canvas` can summarize new Cucumber canvas documents, including container tree, effective context, Agent binding, filtering, and node lookup.
- `manipulate_canvas` now writes `CanvasOperation` updates against new canvas documents with permission and bounds enforcement, instead of mutating only legacy Excalidraw-style `elements`.
- Agent-generated image/video results now insert into the new canvas document model from both runtime and background job paths.
- `CanvasSurface` now includes the first native tool batch: hand/pan mode, in-canvas image upload, image resize with visible bounds overlay, and lightweight line/arrow nodes rendered directly from the new document model.
- Current rendering is a React DOM runtime behind the public `CanvasApi`; the lower-level editor adapter can be swapped behind this boundary without changing product callers.
- Added P0 native editing affordances: multi-select, marquee selection, undo/redo history, keyboard shortcuts, recursive copy/paste/duplicate/delete, and layer lock/visibility/reorder controls.
- Moved shared canvas behavior for ordered traversal, marquee hit-testing, recursive clipboard clone/paste, and document history into `@cucumber/canvas-core` so the web surface calls headless helpers instead of owning those document mutations directly.
- Added the first P1 native editing slice: generic property panel, ellipse/polygon/path/icon nodes, 8-way resize, rotate handles, group/ungroup, selection alignment, and grid snap guides.
- Moved P1 document mutations for grouping, ungrouping, alignment, selection bounds, and new shape node schemas into `@cucumber/canvas-core`, keeping `CanvasSurface` as the interaction adapter.
- Continued the P1 editing hardening pass by splitting keyboard shortcuts and clipboard import handling out of `CanvasSurface`, adding a tree-style layers panel with rename/drag-sort/action menu support, and exposing copy/cut/paste/SVG import actions from the canvas menu.
- Added the first P2 import slice: system clipboard parsing for SVG/Figma-like payloads, normalization into `CucumberCanvasDocument` nodes/assets inside `@cucumber/canvas-core`, centered placement on the current viewport, warning toasts, and history-tracked insertion.
- Upgraded the P2 import slice with stronger provenance metadata (`importSessionId`, source/origin fields, degradation hints, warning counts), richer Figma HTML fallback grouping, aggregated compatibility warnings, and a page-level import summary that surfaces warning counts instead of only a single toast.
- Added focused coverage for import metadata persistence in `canvas-core` and for the web clipboard-import hook behavior around paste interception and clipboard API fallback.

## Next Targets

1. Add deterministic browser/e2e smoke coverage for create container, bind Agent, insert generated content, refresh restore, and basic tool interactions.
2. Add an Agent-output smoke scenario that verifies a visual prompt creates durable, containerized canvas results instead of leaving the canvas as an unstructured artifact dump.
3. Design the selected-result Agent overlay and quick-action contract for image upscale, outpaint, local edit, and variant generation.
4. Expand the import bridge beyond the current SVG/Figma-like clipboard slice to cover higher-fidelity Figma clipboard decoding and local SVG parity for transforms, auto-layout, and component semantics.
5. Continue P1 canvas parity with richer path/icon editing, reference guides, advanced snapping, shape-specific handles, and more complete property controls.
6. Build the next P2 layers on top of the new import provenance metadata: reusable components/ref, variables/design tokens, and design-as-code export.
7. Replace the current DOM runtime internals with a dedicated editor adapter if needed, keeping `CanvasApi` stable.
8. Decide whether `@excalidraw/excalidraw` can be removed after dependent panels and legacy helpers no longer import it.

## Handoff Notes

- Existing worktree changes under `apps/server/src/app.ts`, `apps/server/src/http/sse.ts`, `docs/DOC_YBOjdTenpo.md`, and `docs/MASTER_PLAN.md` predate this canvas runtime implementation. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` changed in this session because `leafer-editor` and `@cucumber/canvas-core` workspace dependencies were added.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.

## Verification Log

- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: targeted diagnostics for `apps/web/src/components/canvas/canvas-surface.tsx`, `apps/web/src/components/canvas-layers-panel.tsx`, `apps/web/src/components/canvas-logo-menu.tsx`, `apps/web/src/components/canvas-editor.tsx`, and new canvas import helper files.
- Passed: targeted `pnpm exec biome check --write` for touched P1 canvas-core and web canvas files.
- Passed: Playwright smoke opened `http://localhost:3000/canvas`; unauthenticated flow redirected to `/login` with no browser console/page errors.
- Passed: targeted diagnostics for `apps/web/src/components/canvas/canvas-surface.tsx` and `packages/canvas-core/src/types.ts`.
- Passed: targeted diagnostics for `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/types.ts`, `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`, `apps/web/src/components/canvas/canvas-surface.tsx`, `apps/web/src/components/canvas-editor.tsx`, `apps/web/src/app/canvas/page.tsx`, `apps/web/src/components/canvas-logo-menu.tsx`, and new clipboard import tests.
- Passed: targeted server tests for `manipulate-canvas` and `canvas-element-writer`, plus new canvas-core bounds regression coverage.
- Failed: `pnpm --filter @cucumber/server typecheck` is still blocked by pre-existing `apps/server/src/http/sse.test.ts` missing the required `webOrigin` option for `registerSseRoutes`.
- Failed: full `pnpm --filter @cucumber/web test` remains blocked by the pre-existing React 19 / Testing Library `React.act is not a function` issue across legacy web tests; the new clipboard-import focused test passes when run in isolation.
- Failed: root `pnpm lint` remains blocked by unrelated pre-existing/untracked files, primarily `openpencil/**`, server formatting drift, and existing `apps/server/src/agent/deep-agent.ts` explicit `any` diagnostics.
