# Cucumber Studio Progress

Last updated: 2026-06-04 CST

Current window line threshold: 300 lines.

Historical archives:
- [2026-06-04 oversized log before rotation](docs/progress/2026-06-04-205857-archive.md): 1189 lines moved out of the active handoff window.

Maintenance:
- Keep this file focused on the current handoff window and rotate it before it grows past 300 lines.
- Run `pnpm progress:rotate` from the repository root when the threshold is reached.
- Historical entries live under `docs/progress/`; do not duplicate archived history back into this file.

## 2026-06-04

- Rotated the previous 1189-line `progress.md` into `docs/progress/2026-06-04-205857-archive.md` and reset this file as the current handoff window.
- Added `scripts/rotate-progress.mjs` and root `pnpm progress:rotate` so future sessions archive the full active log once it crosses the 300-line threshold.
- Documented the bounded progress-log contract in `AGENTS.md`, `docs/workflow.md`, and `docs/progress/README.md`; `progress.md` remains the active handoff truth, while `docs/progress/` stores immutable historical snapshots.
- Added a workspace smoke test for the rotation command, default threshold, archive directory, and workflow documentation.
- Passed: `pnpm progress:rotate` confirmed the reset 20-line active log is under the 300-line threshold and did not create another archive.
- Passed: `node --test tests/workspace.test.mjs`.
- Passed: JSON parse check for `feature_list.json` and `package.json`.
- Passed: `pnpm exec biome check package.json feature_list.json scripts/rotate-progress.mjs tests/workspace.test.mjs AGENTS.md docs/workflow.md docs/progress/README.md progress.md`.
- Passed: `git diff --check` for the touched progress-rotation files and archive.

## 2026-06-04 - Browser visual canvas fixture

- Added `scripts/prepare-visual-canvas.mjs` and root `pnpm prepare:visual-canvas` so local Browser visual acceptance prepares a real project/canvas through the API boundary, verifies `GET /api/canvases/:canvasId`, and prints a usable `/canvas?id=<uuid>` URL instead of relying on fake `canvas-1`.
- Kept canvas runtime behavior fail-fast: missing canvases still surface `Canvas not found`; fixture creation stays out of the core canvas page/runtime.
- Moved default Playwright config away from development port 3000 to fixed test port `127.0.0.1:3100`, with `apps/web` started directly on that port.
- Updated the transport harness to accept `canvasId` and token overrides via query string and to use a dedicated `transport-canvas-fixture` id in the mocked black-box transport spec.
- Playwright evidence: direct probes confirmed the visual fixture script now reaches the API boundary; current local API rejects the default dev token with a clear 401 unless `CUCUMBER_VISUAL_ACCEPTANCE_TOKEN` is provided or dev-skip-auth is enabled.
- Remaining blocker: local Next dev still shows pre-existing test-page/chunk instability under `/test/*` (including `_next/static/chunks/app/test/transport/page.js` and CanvasKit/Paper chunk warnings), so the transport Playwright spec remains blocked by the dev server/chunk layer rather than by `canvas-1`.

## 2026-06-04 - Figma-aligned canvas input/control pass

- Re-read Figma node `ZCLLsSiEhnVEaH2uwRrmjF / 19:2` and corrected the control split: `CanvasEditorToolbar` is now the Figma-style left vertical 32px icon rail, while `CanvasBottomBar` is restored as the top-right horizontal view-control strip instead of being repurposed as the left toolbar.
- Added canvas-core display children for Agent execution presentation nodes so `user_goal` and compact `agent_execution` frames render visible text such as the user prompt and `Thinking...`; stream/draft write-back now refreshes those children via the same presentation helper.
- Adjusted compact execution-node measurement to match the 36px Figma execution capsule when collapsed; expanded state remains available for detailed stream entries.
- Figma screenshots used for comparison were downloaded to `/tmp/cucumber-figma-node-19-2.png`, `/tmp/cucumber-figma-toolbar-19-177.png`, and `/tmp/cucumber-figma-chain-19-275.png`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter web typecheck`.
- Passed: `pnpm --filter web exec vitest run test/canvas-agent-composer.test.tsx test/canvas-agent-execution-stream-writeback.test.ts test/canvas-page-toolbar-icon.test.tsx test/canvas-editor-toolbar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter server typecheck`.
- Passed: targeted `pnpm exec biome check ...` and `git diff --check`.
- Note: Browser still cannot compare `/canvas?id=canvas-1` because the local API returns `Canvas not found`; use `pnpm prepare:visual-canvas` with a valid `CUCUMBER_VISUAL_ACCEPTANCE_TOKEN` to create the real visual URL before live screenshot comparison.
