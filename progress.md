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

## 2026-06-04 - Agent failure diagnostics classification

- Fixed run.failed client-safe error classification so Agent persistence/checkpointer fetch failures are reported as `data_service` failures instead of being masked by the generic provider-unavailable message shown on failed execution nodes.
- Added a regression test for `AgentPersistenceInitializationError` wrapping `fetch failed`; ordinary provider `fetch failed` classification remains unchanged.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/utils/error-sanitizer.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/run-failure.test.ts src/utils/error-sanitizer.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec tsc --noEmit --pretty false`.

## 2026-06-04 - Agent-native execution container first slice

- Added the Agent-native execution container design and implementation plan under `docs/tech/`, making `AgentExecutionContainer` the execution-internal runtime truth while `PenDocument.pages` remains the spatial canvas truth.
- Added `packages/canvas-core/src/agent-execution-container.ts` with schema version 1, legacy `meta.agentExecution` boundary normalization, structured stream/tool/artifact fields, and reducer coverage for run, stage, message, thinking, tool, and terminal events.
- Updated Web stream write-back so live Agent stream events write `meta.agentExecutionContainer` on the selected shell node and no longer rebuild generated canvas `children` for streaming internals.
- Added `AgentExecutionNativeContainer`, a read-only React renderer for native stream/todo/tool/artifact state, and mounted it below selected canvas shells that already have `meta.agentExecutionContainer`; legacy-only execution nodes deliberately do not fall back to generated canvas text.
- Updated the canvas tooling/capability docs to mark `meta.agentExecution` as a legacy semantic index/migration input for streaming internals during the transition.
- Passed: `pnpm --filter @cucumber/canvas-core test -- agent-execution-container.test.ts --run`.
- Passed: `pnpm --dir apps/web exec vitest run test/canvas-agent-execution-stream-writeback.test.ts`.
- Passed: `pnpm --dir apps/web exec vitest run test/agent-execution-native-container.test.tsx`.
- Passed: `pnpm --dir apps/web exec vitest run test/canvas-overlays.test.tsx`.
- Known follow-up: property panels, run-control continuation context, MCP creation/write-back tools, and final-deliverable server write-back still need staged migration from `meta.agentExecution` to `meta.agentExecutionContainer`.

## 2026-06-04 - Agent-native execution container creation paths

- Updated `createAgentExecutionNode` so new compact Agent execution shells no longer compose runtime output from generated canvas text children; the shell keeps spatial/editor fields while `meta.agentExecutionContainer` stores the live execution content.
- Added `withAgentExecutionContainerMeta` in canvas-core and used it from both Web-facing node creation and server MCP execution-flow creation, so new execution chains are born with Agent-native container truth instead of waiting for stream write-back to create it later.
- Normalized Deep Agents `write_todos` tool completion output into `AgentExecutionContainer.todos` when the tool returns an explicit `output.todos` array, matching the native renderer's todo surface without adding inert edit controls.
- Updated tests so MCP-created user goal, recipe, task, tool, critique, final-deliverable, and checkpoint cards all assert matching `meta.agentExecutionContainer` metadata alongside legacy semantic indexes.
- Passed: `pnpm --filter @cucumber/canvas-core test -- agent-execution.test.ts agent-execution-container.test.ts --run`.
- Passed: `pnpm --dir apps/server exec vitest run src/mcp/tools/create-agent-execution-flow.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: targeted `pnpm exec biome check ...` for the touched canvas-core/server/web files.

## 2026-06-04 - generate_image canvas loading container

- Fixed the unified image-generation execution flow so `create_agent_execution_flow` pre-creates a visible image final-deliverable container in `running` state, connects it to the upstream execution chain, and adds `image_generation_loading` placeholder children before `generate_image` submits the background job.
- Kept the runtime truth single-path: `generate_image` still targets `finalDeliverableNodeId`, worker/live-canvas insertion still writes the final image node, and the existing image insertion plan removes only diagnostic loading placeholders before marking the final deliverable done.
- Aligned execution-card visual collapsed state with `meta.agentExecution.canvasPresentation.collapsed`, so expanded result containers keep their intended image-display size instead of being clamped by a mismatched collapsed frame render.
- Passed: `pnpm exec vitest run apps/server/src/mcp/tools/create-agent-execution-flow.test.ts apps/server/src/features/canvas/canvas-element-writer.test.ts --reporter=dot`.
- Passed: `pnpm exec tsc -p apps/server/tsconfig.json --noEmit --pretty false`.
- Passed: `pnpm exec biome check apps/server/src/mcp/tools/create-agent-execution-flow.ts apps/server/src/mcp/tools/create-agent-execution-flow.test.ts`.

## 2026-06-04 - Seedream generate_image URL result lookup

- Diagnosed recent image-generation jobs as worker/provider result parsing failures rather than missing Agent tool calls: jobs reached the Seedream executor, but `CVSync2AsyncGetResult` returned base64 output by default and no `data.image_urls`, causing `no_output` failures.
- Updated Seedream result polling to request URL output with `req_json.return_url=true`, preserving URL as the single runtime truth for downstream download, Supabase Storage persistence, and canvas insertion.
- Verified a real Seedream smoke request succeeds after the fix with `imageUrlCount=1` and a signed ByteDance CDN URL.
- Passed: `pnpm --filter @cucumber/server test apps/server/src/generation/providers/seedream.test.ts --reporter=dot`.

## 2026-06-04 - generate_image visible target guard

- Diagnosed the latest successful image job as a canvas targeting issue: the generated image was inserted under the compact `agent_execution` trace node with local coordinates outside its 240x36 visible frame, so the job completed while the canvas appeared empty.
- Added a fail-fast `generate_image` guard that rejects identical `targetContainerId` and `agentExecutionNodeId`, keeping the visible result container and execution trace write-back node as separate responsibilities before any provider job is submitted.
- Tightened the Agent system prompt to state that `targetContainerId` must be the returned `finalDeliverableNodeId` and must not equal the `agentExecutionNodeId`.
- Repaired the affected canvas by moving the already-generated image node `image_mpznxgsw_2` to the active page root at `(1040, 506)` with size `512x512`.
- Passed: `pnpm --filter @cucumber/server test apps/server/src/agent/tools/image-generate.test.ts apps/server/src/generation/providers/seedream.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.

## 2026-06-04 - compact generate_image loading target

- Added a server-side compact-mode image target creator: when `generate_image` is submitted with an `agentExecutionNodeId` but no distinct visible target, the runtime now creates a visible 600x640 image result frame, inserts loading placeholder children, connects it from the execution node, and submits the job against that new container before calling the provider.
- Cleared explicit placement for auto-created result containers so absolute canvas coordinates from the Agent are not misread as container-local image coordinates; the final image replaces the loading placeholder inside the result frame.
- Updated compact-entry prompt context so Agents pass `agentExecutionNodeId`, leave `targetContainerId` empty, and rely on the server to create the loading result container and connector.
- Made compact image target creation best-effort: live canvas fetch/RPC failures are logged as `image_target_create_failed` and no longer abort the Agent run or image job submission.
- Passed: `pnpm --filter @cucumber/server test apps/server/src/features/canvas/live-image-generation-target.test.ts apps/server/src/agent/tools/image-generate.test.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/server/src/generation/providers/seedream.test.ts --reporter=dot`.
