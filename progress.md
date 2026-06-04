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
