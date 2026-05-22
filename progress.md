# Cucumber Studio Progress

Last updated: 2026-05-22 02:10 CST

## Current Session

Goal: extend the first Cucumber Canvas runtime slice with the first batch of native editing tools and close the new-canvas Agent write path.

Status:

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

## Next Targets

1. Add deterministic browser/e2e smoke coverage for create container, bind Agent, insert generated content, refresh restore, and basic tool interactions.
2. Expand native shape parity on the new runtime: line editing polish, arrow handles, ellipse/diamond, and selection box / multi-select affordances.
3. Replace the current DOM runtime internals with a dedicated editor adapter if needed, keeping `CanvasApi` stable.
4. Decide whether `@excalidraw/excalidraw` can be removed after dependent panels and legacy helpers no longer import it.

## Handoff Notes

- Existing worktree changes under `apps/server/src/app.ts`, `apps/server/src/http/sse.ts`, `docs/DOC_YBOjdTenpo.md`, and `docs/MASTER_PLAN.md` predate this canvas runtime implementation. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` changed in this session because `leafer-editor` and `@cucumber/canvas-core` workspace dependencies were added.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.

## Verification Log

- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: targeted diagnostics for `apps/web/src/components/canvas/canvas-surface.tsx` and `packages/canvas-core/src/types.ts`.
- Passed: targeted server tests for `manipulate-canvas` and `canvas-element-writer`, plus new canvas-core bounds regression coverage.
- Failed: `pnpm --filter @cucumber/server typecheck` is still blocked by pre-existing `apps/server/src/http/sse.test.ts` missing the required `webOrigin` option for `registerSseRoutes`.
- Failed: `pnpm --filter @cucumber/web typecheck` is still blocked by pre-existing React/JSX type incompatibilities across shared UI components such as `canvas-bottom-bar.tsx`, `canvas-editor.tsx`, `chat-sidebar.tsx`, and `toast.tsx`.
