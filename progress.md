# Cucumber Studio Progress

Last updated: 2026-05-22 00:54 CST

## Current Session

Goal: replace the Excalidraw-facing canvas implementation with the first Cucumber Canvas runtime slice focused on containers and Agent/container linkage.

Status:

- Added `@cucumber/canvas-core` with the new `CucumberCanvasDocument` model, container nodes, context resolution, typed operation errors, permission checks, and focused unit tests.
- Replaced the web canvas editor surface with `CanvasSurface` / `CanvasApi` while preserving the existing Studio shell, side panels, bottom bar, chat sidebar, and artifact insertion hooks.
- New documents save directly as Cucumber canvas content. Legacy Excalidraw payloads are treated as empty new documents rather than migrated.
- Containers can be created, selected, dragged, resized, renamed, assigned context rules, and bound to an Agent from the inspector.
- Image/video artifacts now insert through the new canvas API and land in the selected container when one is selected.
- `inspect_canvas` can summarize new Cucumber canvas documents, including container tree, effective context, Agent binding, filtering, and node lookup.
- Current rendering is a React DOM runtime behind the public `CanvasApi`; the lower-level editor adapter can be swapped behind this boundary without changing product callers.

## Next Targets

1. Wire `manipulate_canvas` to emit `CanvasOperation` against bound containers with permission and bounds enforcement.
2. Replace the current DOM runtime internals with a dedicated editor adapter if needed, keeping `CanvasApi` stable.
3. Add deterministic browser/e2e smoke coverage for create container, bind Agent, insert generated content, refresh restore.
4. Decide whether `@excalidraw/excalidraw` can be removed after dependent panels and legacy helpers no longer import it.

## Handoff Notes

- Existing worktree changes under `apps/server/src/app.ts`, `apps/server/src/http/sse.ts`, `docs/DOC_YBOjdTenpo.md`, and `docs/MASTER_PLAN.md` predate this canvas runtime implementation. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` changed in this session because `leafer-editor` and `@cucumber/canvas-core` workspace dependencies were added.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.

## Verification Log

- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/shared typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: targeted `pnpm exec biome check` for changed canvas-core, web canvas, server inspect-canvas, shared contracts, and web API files.
- Passed: local smoke `curl -I http://localhost:3001/canvas?id=smoke-test` returned `HTTP/1.1 200 OK`.
- Failed: `pnpm --filter @cucumber/server typecheck` is still blocked by pre-existing `apps/server/src/http/sse.test.ts` missing the required `webOrigin` option for `registerSseRoutes`.
