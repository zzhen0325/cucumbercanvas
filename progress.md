# Cucumber Studio Progress

Last updated: 2026-06-05 CST

Current window line threshold: 300 lines.

Historical archives:
- [2026-06-04 oversized log before rotation](docs/progress/2026-06-04-205857-archive.md): 1189 lines moved out of the active handoff window.

Maintenance:
- Keep this file focused on the current handoff window and rotate it before it grows past 300 lines.
- Run `pnpm progress:rotate` from the repository root when the threshold is reached.
- Historical entries live under `docs/progress/`; do not duplicate archived history back into this file.

## 2026-06-05 - Remove Agent run control shortcuts

- Removed the canvas-level `AgentRunControlBar`, its run trace panel, and the dedicated test file so the top floating pause/continue/stop/rerun/trace strip no longer appears.
- Removed selected-checkpoint canvas toolbar actions and the selected-node follow-up pill entry so `继续` / `重跑` / `新分支` are not exposed from the canvas overlay layer.
- Changed the Agent checkpoint property-panel section to show checkpoint record context only, and removed generic selected-node `从这里继续` / `重跑此步骤` / `复制为分支` buttons from the Agent execution panel.
- Moved the remaining shared run-control state type to `agent-run-control-state.ts` for the chat sidebar path, and updated `feature_list.json` plus current technical docs to stop listing deleted control-bar/follow-up artifacts.

## 2026-06-05 - AgentRunNode React content host

- Upgraded expanded `agent_run_node` presentation from Skia text aggregation to a React content host overlay aligned to the durable canvas node bounds; the PenNode remains the source of truth for position, size, selection, links, collapse state, and persistence.
- Installed the needed AI Elements registry components (`reasoning`, `tool`, `task`, `queue`, `message`) without overwriting existing `button`/`separator` primitives, then formatted the generated files to the repo Biome rules.
- Extended `agentExecutionContainer.toolParts` to preserve structured tool `input`, `output`, and readable `errorText`, and added `getAgentRunNodeViewModel()` so Reasoning, Tool, Queue tasks, markdown messages, and artifact refs all render from the same container truth.
- Added `AgentRunNodeContentLayer` inside the canvas overlay stack; expanded nodes render scrollable/clickable React content, collapsed nodes do not mount the heavy content, and overlay pointer/wheel events stop before reaching canvas drag/zoom handlers.
- Kept the React AgentRunNode projection aligned with Skia transform preview during drag/resize/rotate and let non-interactive overlay background pointer gestures bubble back to the canvas, so the visible content host and durable shell no longer split during movement.
- Tightened the live display path after visual testing: terminal run events now close running tool cards, stringified tool parameter payloads are normalized before display, readable tool output summaries appear as messages when no message delta exists, expanded React content writes measured width/height back to the durable node, and collapsed Skia fallback only paints a compact summary instead of overflowing raw stream/tool text.
- Added regression coverage for view-model mapping, repeated/stringified tool parts, missing structured tool detail reasons, stream writeback preserving tool input/output, overlay positioning, content-size write-back, collapse write-back, folded nodes, and event bubbling.
- Passed: `pnpm --filter @cucumber/web typecheck`, `pnpm --filter @cucumber/canvas-core typecheck`, `pnpm exec vitest run test/canvas-agent-execution-stream-writeback.test.ts test/agent-run-node-content-layer.test.tsx --reporter=dot` from `apps/web`, `pnpm --filter @cucumber/canvas-core test -- --run src/__tests__/agent-execution-container.test.ts --reporter=dot`, targeted `pnpm exec biome check ...`, and `git diff --check`.
- Browser smoke: `http://localhost:3000/canvas` and the visual fixture URL opened without module/runtime compile errors, but current local canvas data returned “缺少画布信息” / `[canvas-page] failed to load canvas Object`, so real in-canvas visual verification of an expanded AgentRunNode remains blocked by local canvas data/access state.

## 2026-06-05 - Agent execution node owns execution aggregation

- Renamed the compact downstream execution light node to `agent_run_node` / `AgentRunNode`, matching `input_node` / `InputNode` as the same class of Agent entry-chain nodes while keeping `agentExecutionContainer` as the node-local execution content truth.
- Updated compact canvas entry XML to emit `<agent_run_node>` beside `<input_node>` so prompt context and canvas semantics use the same light-node naming.
- Moved Agent execution aggregation back into the green Agent execution node by making `agentExecutionContainer` the display aggregation source for stream/tool/todo/artifact summaries.
- Removed the selected-node native execution container overlay so execution details no longer appear in a floating card detached from the canvas node.
- Fixed renderer support for `agent_run_node` custom Agent components and kept expanded AgentRunNode nodes at the light-container height instead of the old 36px status bar.
- Updated stream writeback and expand/collapse sizing so live events resize the selected Agent node from the same container truth.
- Passed: `pnpm --filter @cucumber/canvas-core test -- --run src/__tests__/agent-execution.test.ts src/__tests__/agent-execution-container.test.ts --reporter=dot`, `pnpm --dir apps/web exec vitest run test/canvas-agent-execution-stream-writeback.test.ts test/canvas-overlays.test.tsx --reporter=dot`, `pnpm --filter @cucumber/canvas-core typecheck`, `pnpm --filter @cucumber/web typecheck`, `pnpm --filter @cucumber/pen-renderer typecheck`, and targeted `pnpm exec biome check ...`.
- Browser QA on `http://localhost:3000/canvas?id=6be355ad-be24-4e89-8f67-e8c5a604f686`: page rendered with one canvas, creating a temporary InputNode showed selection toolbar/status badge while `agent-execution-native-container-host` and `agent-execution-native-container` stayed at 0; the temporary node was deleted afterward.

## 2026-06-05 - InputNode duplicate text sync fix

- Fixed InputNode draft sync persistence so `meta.agentExecution.summary` stays the only display truth for the custom-rendered card; new and updated InputNodes no longer create an extra ordinary text child that overlaps the Skia-rendered summary.
- Kept real non-display children intact while presentation updates clean old generated Agent display children from earlier data.
- Added canvas-core regression coverage for creating an InputNode without text children and updating a legacy InputNode without duplicating display text.
- Passed: `pnpm exec vitest run packages/canvas-core/src/__tests__/agent-execution.test.ts apps/web/test/canvas-agent-composer.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`, targeted `pnpm exec biome check ...`, `node` JSON parse for `feature_list.json`, and `git diff --check`.
- Browser QA on `http://localhost:3000/canvas?id=6be355ad-be24-4e89-8f67-e8c5a604f686`: typing in the composer created a selected InputNode with one rendered title and one rendered prompt body, with no overlapping selected ordinary text object; the QA draft node was deleted afterward.

## 2026-06-05 - Agent InputNode entry split

- Split the bottom-composer Agent entry light node from the old `user_goal` kind by introducing `input_node` / `InputNode` as the new Agent input container truth while preserving the existing Skia custom card visual role.
- Updated the Web canvas API, bottom prompt draft hook, toolbar click/drag template, renderer kind recognition, and compact Agent prompt XML so new user-entered prompt nodes are created and described as `agent_input_node_*` / `<input_node>` with `meta.agentExecution.kind = "input_node"`.
- Preserved one-way composer-to-canvas sync: typing creates/updates the draft InputNode, successful send marks it done and clears the composer, the next prompt creates a fresh InputNode, and selecting the canvas InputNode does not refill the bottom composer.
- Updated `docs/tech/agent-runtime-workflow.md` and `feature_list.json` to document the InputNode source-of-truth boundary and one-way interaction behavior.
- Passed: `pnpm exec vitest run packages/canvas-core/src/__tests__/agent-execution.test.ts packages/canvas-core/src/__tests__/agent-execution-container.test.ts packages/pen-renderer/src/node-renderer.test.ts apps/web/test/canvas-agent-composer.test.tsx apps/web/test/canvas-editor-toolbar.test.tsx --reporter=dot`.
- Passed: `pnpm --dir apps/server exec vitest run src/agent/runtime.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`, `pnpm --filter @cucumber/pen-renderer typecheck`, `pnpm --filter web typecheck`, and `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check ...`, `node` JSON parse for `feature_list.json`, and `git diff --check`.
- Browser QA on `http://localhost:3000/canvas?id=6be355ad-be24-4e89-8f67-e8c5a604f686`: page rendered the canvas shell and left toolbar `InputNode` button; typing in the composer created a visible selected InputNode with `节点类型 InputNode`; clearing the unsent draft restored an empty composer and disabled send button; creating/selecting an empty toolbar InputNode left the composer empty and send disabled, then undo restored the empty canvas.

## 2026-06-05 - Agent runtime workflow documentation

- Rebuilt `docs/tech/agent-runtime-workflow.md` from the current code paths, covering frontend run submission, compact canvas entry creation, continuation contexts, server runtime setup, Deep Agent/MCP registration, live canvas RPC, stream events, SSE replay, chat persistence, image/video job workers, and failure/pause recovery.
- Clarified source-of-truth boundaries: persisted `canvases.content` only feeds automatic `<canvas_state>`, while Agent tool reads/writes use `LiveCanvasService` against the open editor's live `PenDocument.pages`.
- `feature_list.json` was not changed because the tracked artifact list already includes the Agent runtime workflow document and no feature status/scope changed.

## 2026-06-05 - UI page code sync plan

- Added `docs/tech/ui-page-code-sync-plan.md` to scope code synchronization to UI page or UI section roots regardless of source: Agent-generated UI deliverables, ordinary Figma-like canvas roots, and normalized imported Figma page/frame roots are all in scope when they represent UI pages.
- The plan keeps `PenDocument.pages` as the canvas truth, treats generated code as a manifest-backed projection of a syncable UI root, and requires code-to-canvas updates to become previewed `CanvasOperation[]` patches before applying through the live canvas transaction boundary.
- Linked the plan from `docs/code-map.md` so future design-to-code work can find the narrowed-but-source-inclusive sync boundary.
- No runtime code was changed in this slice.

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

- Updated the compact Agent run-node factory so new compact Agent execution shells no longer compose runtime output from generated canvas text children; the shell keeps spatial/editor fields while `meta.agentExecutionContainer` stores the live execution content.
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

## 2026-06-05 - remove Recipe template surfaces

- Removed the Recipe template runtime truth and UI surfaces: built-in/saved template model exports, chat picker/chip/local-storage hooks, selected-template send context, `<agent_recipe_template>` prompt block formatting, and property-panel save-template panel.
- Kept the durable `recipe_plan` execution node kind and `create_agent_execution_flow.recipeTitle` path intact because those belong to the execution-chain runtime, not the removed template feature.
- Updated current docs and feature registry so chat input now only sends continuation and explicit canvas-node reference prompt context.
- Passed: `pnpm exec vitest run apps/web/test/chat-input.test.tsx apps/web/test/canvas-property-panel.test.tsx apps/server/src/agent/prompts/cucumber-main.test.ts packages/canvas-core/src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm exec vitest run apps/web/test/canvas-agent-composer.test.tsx --reporter=dot`.
- Passed: `pnpm exec biome check` for the touched code, tests, docs, `feature_list.json`, and `progress.md`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`, `pnpm --filter @cucumber/web typecheck`, and `pnpm --filter @cucumber/server typecheck`.
- Build still blocked by existing Web build issues outside this change: `paper` optional dependency resolution warnings for `acorn` / `canvas`, then Next prerender fails with `<Html> should not be imported outside of pages/_document` on `/404`.

## 2026-06-05 - compact AgentRunNode image generation unification

- Cleaned up the compact canvas-entry path so `agent_run_node` is the single runtime truth for bottom-composer Agent execution state; prompt context now forbids creating a parallel `create_agent_execution_flow` chain or calling `record_agent_tool_call` against the compact node.
- Extended image-generation terminal write-back to update compact `agent_run_node` nodes directly, while keeping multi-node execution-chain write-back scoped to `tool_call` and `task_step` nodes.
- Preserved the separate visible image result container responsibility: compact `generate_image` still leaves `targetContainerId` empty so the runtime creates one result frame, connector, and loading state beside the single AgentRunNode.
- Passed: `pnpm exec vitest run --project server apps/server/src/agent/runtime.test.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/server/src/agent/agent-execution-image-writeback.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/agent/agent-execution-image-writeback.ts apps/server/src/agent/agent-execution-image-writeback.test.ts apps/server/src/agent/runtime.ts apps/server/src/agent/runtime.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts`.

## 2026-06-05 - AgentRunNode inline stream content and external toggle

- Fixed AgentRunNode stream/tool text leaking below the node by keeping the native canvas shell clipped and compact, while preserving full reasoning/tool/message details in the React AgentRunNode content layer.
- Moved AgentRunNode expand/collapse to a separate DOM overlay button outside the canvas node, with pointer propagation blocked so the click no longer competes with canvas selection/drag behavior.
- Preserved manual collapsed state across later stream write-backs; incoming stream events now update content without reopening a node the user has collapsed.
- Disabled the old Skia hot-zone toggle for AgentRunNode specifically; other execution-node canvas toggles remain unchanged.
- Passed: `pnpm exec vitest run apps/web/test/agent-run-node-content-layer.test.tsx apps/web/test/canvas-agent-execution-stream-writeback.test.ts packages/canvas-core/src/__tests__/agent-execution-container.test.ts packages/canvas-core/src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` and `pnpm --filter @cucumber/canvas-core typecheck`.

## 2026-06-05 - AgentRunNode overlay responsibility split

- Split the expanded AgentRunNode React overlay into three responsibilities: pure PenDocument/viewport overlay selection, pure AI Elements content rendering from `meta.agentExecutionContainer`, and expanded-only DOM autosize write-back to durable node bounds.
- Added a stale legacy shell metadata regression test so React content selection follows `agentExecutionContainer.kind/title` even when `meta.agentExecution` is no longer a reliable content source.
- Reduced Skia `agent_run_node` rendering to a lightweight frame shell with status and title; detailed stream/tool/todo/message/artifact content now belongs to the React overlay.
