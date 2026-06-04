# Cucumber Studio Progress

Last updated: 2026-06-04 CST

## 2026-06-04

- Componentized Agent canvas nodes so `meta.agentExecution` drives hardcoded renderer visuals instead of persisted display-child node assemblies. Agent user goals, execution bars, and result cards now derive auto height from content, show expand/collapse only when overflowing, migrate old display children at normalization boundaries, and expose a toolbar `用户目标` tool that can click-create at viewport center or drag-create at the drop point.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-execution-flow.test.ts src/mcp/tools/record-agent-tool-call.test.ts src/mcp/tools/record-agent-final-deliverable.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-editor-toolbar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`, `pnpm --filter @cucumber/pen-renderer typecheck`, `pnpm --filter @cucumber/server typecheck`, and `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm exec biome check` for the touched Agent component layout, renderer, MCP write-back, toolbar/drop, tests, progress, and feature-registry files.
- Note: `pnpm --filter @cucumber/web build` failed while an existing local Next dev server was using the same app `.next` directory; Next reported a missing `.next/server/app/_not-found/page.js.nft.json` trace file after finishing static page generation. Browser validation reached `/canvas` but the page requires a concrete canvas ID and showed the existing missing-canvas message instead of the editor surface.
- Added `docs/tech/canvas-node-figma-fusion.md` to document the single-truth fusion boundary between Figma-like direct editing and Flowith-like node execution semantics: the visual `PenDocument.pages` tree remains reality, while Agent/dataflow semantics live on the same visible `PenNode` and connector nodes instead of a second graph/runtime state.
- Rebuilt the canvas Agent execution chain presentation to match the Figma three-part structure: `用户输入 -> Agent 执行 -> 结果展示`. New and migrated execution chains now use a shared v2 canvas presentation contract on `meta.agentExecution.canvasPresentation`, with execution steps collapsed by default into a 240x36 green `Thinking...` bar and a persisted chevron toggle handled through the normal canvas document commit path.
- Added old execution-chain normalization at the active `PenDocument.pages` boundary, stamping `layoutVersion = 2`, rebuilding card visuals/connectors once, and logging `[canvas-agent-execution-layout] migrate` with migrated node counts and IDs. Branch result cards now lay out horizontally below the execution phase, while normal execution flows form one coherent vertical chain.
- Passed: `pnpm exec vitest run packages/canvas-core/src/__tests__/agent-execution.test.ts apps/server/src/mcp/tools/create-agent-execution-flow.test.ts apps/server/src/mcp/tools/create-agent-variant-branches.test.ts apps/server/src/mcp/tools/record-agent-tool-call.test.ts apps/server/src/mcp/tools/record-agent-final-deliverable.test.ts apps/server/src/mcp/tools/select-agent-variant-branch.test.ts apps/server/src/agent/agent-execution-image-writeback.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec tsc -p tsconfig.json --noEmit --pretty false`.
- Passed: `pnpm --filter @cucumber/web exec tsc -p tsconfig.json --noEmit --pretty false`.
- Note: `pnpm --filter @cucumber/web test -- test/agent-execution-status-overlays.test.tsx` was parsed by the package script as a broad `test/` run. The requested overlay test passed, while unrelated `test/chat-sidebar.test.tsx` cases failed because the current sidebar empty state no longer exposes the expected `/start with an idea/i` placeholder in that broad run.
- Tightened Agent/canvas UI copy boundaries: run IDs, node IDs, tool call IDs, transaction IDs, and raw trace wording are now hidden from the default canvas/control/property-panel views, with copy actions and raw event identifiers moved behind explicit advanced/developer diagnostics. User-facing labels now use `执行记录`, `保存点`, `关联步骤`, `前置内容`, and `后续结果`, while canvas load errors and core toolbar/chat input labels use localized, action-oriented copy.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-control-bar.test.tsx test/canvas-property-panel.test.tsx test/canvas-editor-toolbar.test.tsx test/chat-input.test.tsx --reporter=dot`.
- Passed: `pnpm exec biome check apps/web/src/components/agent-run-control-bar.tsx apps/web/src/components/agent-run-trace-panel.tsx apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-chain-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-checkpoint-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-failure-recovery-section.tsx apps/web/src/components/canvas/property-panel/agent-comparison-branch-cards.tsx apps/web/src/components/canvas/editor-toolbar.tsx apps/web/src/components/canvas/shape-tool-dropdown.tsx apps/web/src/components/chat-input.tsx apps/web/src/app/canvas/page.tsx apps/web/test/agent-run-control-bar.test.tsx apps/web/test/canvas-property-panel.test.tsx apps/web/test/canvas-editor-toolbar.test.tsx apps/web/test/chat-input.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Browser validation: `http://localhost:3000/canvas` rendered the new missing-canvas Chinese copy without the old `No canvas ID specified` / `Check the server logs` wording or a framework error overlay, then redirected to `/login` because the in-app browser was not authenticated; screenshot capture timed out in the Browser runtime.
- Removed the separate simple image-generation Agent flow tool: image generation now starts from the unified `create_agent_execution_flow` task chain, uses the returned `finalDeliverableNodeId` as the `generate_image` target container, and passes the matching `toolCallNodeIds` entry as `agentExecutionNodeId` so prompt optimization, tool execution, final-deliverable completion, and continuation context share one durable execution graph. `create_agent_execution_flow` now sizes image-generation final-deliverable containers for visual output, and generated image insertion auto-places results in target containers using container-local coordinates when placement is omitted.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/deepagents-bridge.test.ts src/mcp/tools/create-agent-execution-flow.test.ts src/features/canvas/canvas-element-writer.test.ts src/agent/tools/image-generate.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/server/src/features/canvas/canvas-element-writer.ts apps/server/src/features/canvas/canvas-element-writer.test.ts apps/server/src/mcp/server.ts apps/server/src/mcp/deepagents-bridge.test.ts apps/server/src/mcp/tools/create-agent-execution-flow.ts apps/server/src/mcp/tools/create-agent-execution-flow.test.ts packages/canvas-core/src/agent-recipe-template.ts docs/tech/ai-native-canvas-agent-capability-plan.md docs/tech/canvas-tooling-capability-map.md progress.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Upgraded generated Agent execution cards and connectors: `create_agent_execution_flow`, `create_agent_variant_branches`, `create_agent_ask_user_more`, and `create_agent_evidence` now share rounded 22px card styling, stable title/status/body text layout, larger internal padding, calmer semantic fills/strokes, and lower-saturation 2px smooth arrow connectors persisted directly in `PenDocument.pages`.
- Upgraded persistent Agent status markers into Flowith-style activity callouts: non-selected running/waiting/failed/paused execution nodes now show contextual labels such as `分析中...`, `生成中...`, `评审中...`, `等待补充`, or `处理失败`, with lightweight icon/dot/caret streaming text animation derived from durable `meta.agentExecution` rather than run trace.
- Added a Flowith-inspired canvas follow-up affordance: selecting any durable Agent execution node now shows an animated `继续追问`-style pill below the node that opens the existing selected-node continuation draft from `PenDocument.pages` metadata, with contextual labels for failed, waiting, branch, and checkpoint nodes.
- Split failed-node recovery UI into `AgentExecutionFailureRecoverySection`, making `重试此步骤`, `改写输入后继续`, `跳过此步骤`, and `新建分支尝试` clearer while preserving the same recovery intents and failure-history prompt context.
- Split the Agent run trace panel out of `AgentRunControlBar` into a dedicated component, reducing the control bar from 535 to 341 lines while preserving pause/stop/continue/checkpoint rerun/trace behavior and keeping trace rendering as a read-only diagnostic surface.
- Extended paused-node recovery semantics to manual canvas references: when users add a selected `paused` Agent execution node as a removable reference chip, `<canvas_node_references>` now carries the same `paused_continuation_instruction` so the Agent treats it as a durable node recovery anchor rather than trying to resume an old SSE stream.
- Added a recommended-branch shortcut to comparison panels: selected `comparison` nodes now surface `深化推荐选择` above the branch cards, resolving the recommended `variant_branch`, persisting it as mainline first when needed, and opening the continuation draft against that durable branch node.
- Added structured paused-node continuation context: selected `paused` Agent execution nodes now send `paused_continuation_instruction` through `<agent_execution_continue_context>`, and the main Agent prompt treats it as a recovery boundary that starts a new Agent run from the durable node after inspecting live `PenDocument.pages` instead of trying to resume the old SSE stream.
- Made paused-run continuation explicit in the Agent run control bar: when the selected durable execution node is `paused`, the continue action is labeled `从暂停点继续` and explains that it will inspect the current canvas and open a new Agent run from that node instead of pretending to resume the old SSE stream.
- Added a pre-save Recipe template preview in the Agent execution property panel: before saving a completed execution node or graph, users can now verify the source-node count, node structure, tool sequence, input slots, validation rules, and deliverable format that will be stored in the local Recipe menu.
- Preserved user-written prompts when applying a Recipe: selecting a Recipe after typing now appends the per-slot `待补输入` checklist once instead of replacing the user's draft or omitting the template slots.
- Grouped the Recipe picker into `已保存` and `内置` sections with counts, so reusable execution-chain templates are visually separated from built-in starters before users preview, delete, or launch them.
- Made Recipe start drafts easier to fill: the `待补输入` section now renders each required template slot as its own `- 槽位：` line, so users can add values directly before sending while the Agent still creates `ask_user_more` for blanks.
- Added slot-aware Recipe start drafts: selecting a Recipe now pre-fills the editable chat draft with a `待补输入` checklist plus the ask-user-more fallback note, so users can fill template slots before sending while still allowing the Agent to create durable `ask_user_more` nodes for missing inputs.
- Made Recipe input slots actionable at startup: selected Recipe chips now show the first required input slots, and `<agent_recipe_template>` carries an `input_slot_policy` requiring the Agent to create a durable `ask_user_more` node for missing template inputs instead of inventing values or continuing silently.
- Tightened Recipe template startup boundaries: `<agent_recipe_template>` now includes `template_source`, `startup_mode`, `saved_from_node_id`, and a `source_node_policy` for saved execution-chain templates, while the Recipe picker preview tells users saved templates start a new execution chain and do not modify source nodes.
- Removed friction from non-mainline branch deepening: `variant_branch` panels and comparison branch cards now show `设为主线并深化` for non-mainline choices, persist the selected branch as the durable mainline/recommended branch first, then open the continuation draft with updated mainline metadata so the chat context matches the visible `PenDocument.pages` state.
- Added explicit final-deliverable write-back: `record_agent_final_deliverable` now records completed or failed final delivery state into an existing durable `final_deliverable` node, synchronizing visible text, `meta.agentExecution.details.outputSummary`, top-level run/session/agent semantics, selection, and concrete failure recovery context instead of letting complex Agent chains end only in chat or run trace.
- Tightened durable critique write-back consistency: `record_agent_critique` now sets structured `critique.pass` to `false` whenever the recorded critique status is `failed`, preventing property-panel review metadata from saying a failed validation/critique passed.
- Added durable-node anchoring to the Agent run trace panel: the live trace view now shows the selected canvas node ID plus upstream/downstream counts from `meta.agentExecution`, and canvas patch rows list affected node IDs so users can relate transient SSE diagnostics back to durable `PenDocument.pages` nodes.
- Normalized failed-node UI error copy: Agent execution details and failure recovery cards now convert raw HTTP/provider/network diagnostic values, `null`, and `undefined` into concrete user-facing failure explanations while keeping durable `meta.agentExecution.failure` as the debugging and recovery truth.
- Reused the same failed-node error-copy boundary in the Agent run control bar and run trace rows, so top-of-canvas status and trace diagnostics do not leak raw provider/network codes when a selected execution node or `run.failed` event is inspected.
- Reused the same failed-node error-copy boundary in canvas hover/status surfaces, so hovering a failed Agent execution node no longer leaks raw diagnostic codes before the user opens the property panel.
- Added durable stop-state write-back for Agent runs: after the real cancel endpoint succeeds, the Web canvas now marks the same run's active `running` / `waiting` execution nodes as `paused` with an explicit stopped summary, so canvas overlays, property panels, and run status chips do not keep presenting stopped work as still active.
- Enabled completed `variant_branch` nodes to be saved directly as Recipe templates: a successful direction can now become a branch-deepening workflow with variant/critique/checkpoint/final-deliverable structure, branch-specific input slots, and `create_agent_variant_branches` in the inferred tool sequence.
- Tightened `ask_user_more` fulfillment state: when a user submits text or file/image supplements, shared Web write-back now stores `waitingForUser.response`, preserves attachment counts, marks the durable node `paused`, and synchronizes top-level execution semantics so status chips no longer keep showing a human blocker after the user has answered.
- Added durable pause-state write-back for Agent runs: after the real pause endpoint succeeds, the Web canvas now marks the same run's `running` / `waiting` Agent execution nodes as `paused` in live `PenDocument.pages`, preserving summaries and semantic node fields so overlays, property panels, and active-page status chips reflect the user's pause action instead of stale active work.
- Added checkpoint rerun downstream scope visibility: restartable checkpoint continuation now surfaces recorded downstream node IDs in the run control bar, includes them in the editable rerun draft, and sends `checkpoint_rerun_downstream_node_ids` plus a concrete rerun instruction through `<agent_execution_continue_context>` while still requiring the Agent to inspect live `PenDocument.pages` before rewriting downstream work.
- Preserved comparison graph context when saving a completed `variant_branch` as a Recipe template: if the active page includes sibling variant branches and their `comparison` node, the saved template records all related source node IDs and keeps the deliverable contract as `variant_branch` + `comparison` + checkpoint rather than flattening the branch into an isolated workflow.
- Tightened Recipe template startup semantics: the template prompt block now names node structure, tool sequence, input slots, validation rules, and deliverable format as the reusable workflow contract, and the Agent system prompt treats template evidence/ask/branch/critique/checkpoint tool steps as durable execution-node requirements instead of optional chat narration.
- Strengthened saved Recipe extraction for context-heavy chains: templates now preserve completed `evidence` and `ask_user_more` boundaries by inferring `create_agent_evidence` / `create_agent_ask_user_more` tool steps, reference-material and user-supplement input slots, provenance/waiting-input validation rules, and a deliverable format that names those context nodes.
- Completed the Recipe template preview fields in the chat input menu: expanded saved templates now show validation rules and deliverable format in addition to node structure, tool order, input slots, and source node IDs, so users can verify the reusable workflow contract before starting it.
- Added an explicit non-mainline branch deepening guard: selected/manual `variant_branch` continuation context now emits `branch_continue_requires_mainline_selection` and a concrete instruction to call `select_agent_variant_branch` before deepening a non-mainline branch.
- Preserved comparison context when deepening a branch from a comparison card: the prefilled branch continuation target now carries the comparison branch-node list, recommended branch, and recommendation reason into `<agent_execution_continue_context>`, so the Agent can select the clicked branch as mainline before continuing.
- Corrected variant-branch deepening semantics: `继续深化` on a `variant_branch` or comparison branch card now opens an overwrite-current/continue draft anchored to that branch, while comparison branch cards pass the clicked branch as the chat continuation target even when the selected canvas node is the comparison card.
- Tightened durable failed-node recovery write-back: `record_agent_tool_call` now supports appending recovery attempts/next actions without duplicating existing entries, rejects new failed-state writes that omit a concrete `failure.reason` or `errorReason`, and non-failed write-back clears stale `failure` metadata so completed nodes no longer keep old failed-node UI state.
- Expanded the Agent run-control waiting state: when the selected durable execution node is waiting for user input, the top control bar now shows the waiting prompt plus file/image acceptance, submitted response text, and submitted attachment count instead of only showing a generic waiting/loading reason.
- Completed the task/tool detail collapsed-summary slice: the Agent execution property panel now keeps a result summary or failure reason visible when execution details are collapsed, and the detail UI was split into `AgentExecutionDetailsSection` so the already-large main section does not keep accumulating detail-rendering logic.
- Made the selected Agent continuation chip readable in the chat input: the "基于" chip now shows status with the same tone treatment as reference chips and includes failure, waiting, and checkpoint restart reasons in its hover title before the user sends the continuation.
- Made manual Agent reference chips readable in the chat input: removable references for Agent execution nodes now show execution kind/status and include failure, waiting, and checkpoint restart reasons in their hover title, so users can verify the referenced execution context before sending.
- Expanded manual canvas-node references for Agent execution context: when users add selected Agent nodes as removable chat references, `<canvas_node_references>` now carries upstream/downstream IDs plus branch/comparison/checkpoint/waiting/failure summaries, waiting response text/attachment counts, checkpoint restart reasons, and failed-node recovery history while still requiring live `PenDocument.pages` inspection before edits.
- Added structured checkpoint restart reason context: restartable checkpoint continuation now carries `checkpoint_restart_reason` through `<agent_execution_continue_context>`, so `rerun_checkpoint` follow-ups know why the selected durable checkpoint is a valid downstream rebuild anchor.
- Added structured failed-node recovery history in continuation context: failed execution nodes now pass `failure_attempted` and `failure_next_actions` through `<agent_execution_continue_context>`, so retry/rewrite/skip/new-branch follow-ups can avoid repeating ineffective attempts and can write updated recovery state back to the durable node.
- Added structured waiting-response continuation context: when an `ask_user_more` response opens a continuation draft, the submitted text now travels as `waiting_response_text` inside `<agent_execution_continue_context>` in addition to the visible draft copy, so the Agent can treat it as the user's answer to the durable waiting node after inspecting live `PenDocument.pages`.
- Added structured Agent continuation recovery intents: canvas recovery actions now carry `intent` into `<agent_execution_continue_context>` (`retry`, `rewrite`, `skip`, `rerun_checkpoint`, `attach_files`, `new_branch`, `continue`) with explicit intent instructions, and the Agent system prompt treats those fields as the recovery action to execute after inspecting the selected durable node and its upstream/downstream chain.
- Added canvas-surface waiting/failure reason visibility: Agent execution hover cards now show waiting prompts, failure reasons, or pause summaries from durable `meta.agentExecution`, and persistent status marker tooltips include the same reason text so users can understand blockers without opening the property panel.
- Made active-page Agent execution status summary chips selectable: clicking a non-zero `failed`, `running`, `waiting`, or `paused` chip selects the first matching execution node through the normal canvas selection API so users can quickly jump from a blocker/active-work count into inspection.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx test/agent-run-control-bar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-pause-writeback.test.ts test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-waiting-response-writeback.test.ts test/canvas-property-panel.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/agent-recipe-template.ts packages/canvas-core/src/__tests__/agent-execution.test.ts apps/web/test/canvas-property-panel.test.tsx docs/tech/ai-native-canvas-agent-capability-plan.md progress.md feature_list.json`.
- Passed: `pnpm exec biome check apps/web/src/components/chat-input-context.ts apps/web/src/app/canvas/page.tsx apps/web/src/components/agent-run-control-bar.tsx apps/web/test/chat-input.test.tsx apps/web/test/agent-run-control-bar.test.tsx apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts docs/tech/ai-native-canvas-agent-capability-plan.md progress.md feature_list.json`.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/agent-run-pause-writeback.ts apps/web/src/app/canvas/page.tsx apps/web/src/components/chat-sidebar.tsx apps/web/test/agent-run-pause-writeback.test.ts apps/web/test/chat-sidebar.test.tsx docs/tech/ai-native-canvas-agent-capability-plan.md progress.md feature_list.json`.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/agent-waiting-response-writeback.ts apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/app/canvas/page.tsx apps/web/test/agent-waiting-response-writeback.test.ts apps/web/test/canvas-property-panel.test.tsx docs/tech/ai-native-canvas-agent-capability-plan.md progress.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.

## 2026-06-03

- Added the active-page Agent execution status summary slice: the canvas now shows a compact bottom-left summary of current-page attention states (`failed`, `running`, `waiting`, `paused`) derived from durable `meta.agentExecution`, so users can quickly see whether the execution chain has active work or blockers before inspecting individual nodes.
- Added the persistent Agent execution status marker slice: active-page Agent execution nodes with attention-worthy states (`waiting` / `running` / `failed` / `paused`) now show compact clickable canvas corner markers derived from durable `meta.agentExecution`; clicking a marker selects that node through the normal canvas selection API, while completed and currently selected nodes stay off the persistent layer to avoid clutter and rely on hover/selection details.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-execution-status-overlays.test.tsx test/canvas-overlays.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Added the non-selected Agent execution hover summary slice: hovering a non-checkpoint Agent execution node now shows a read-only canvas hover card with execution kind, status, title, and tool/summary while checkpoint nodes keep their action toolbar. The hover card is derived from durable `meta.agentExecution` and does not write hover state into `PenDocument.pages`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-overlays.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Added the first canvas-surface Agent execution status badge slice: selecting any durable Agent execution node now shows a compact toolbar badge with the execution kind and status (`waiting` / `running` / `done` / `failed` / `paused`) so users can read the node state on the canvas without opening or scrolling the property panel.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-overlays.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Added the shared Agent execution-node semantic update helper: `canvas-core` now exposes `getAgentExecutionNodeSemanticUpdates`, and `record_agent_tool_call` / `record_agent_critique` use it when updating existing execution nodes so status, tool-call details, failure recovery, and critique findings update durable `meta.agentExecution` together with top-level run/session/agent/container-role/context-slot semantics on the same `PenNode`. Failed tool-call write-back also normalizes optional failure input into a concrete `failure.step` for UI recovery panels.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/record-agent-tool-call.test.ts src/mcp/tools/record-agent-critique.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Migrated the blocking/input and branching execution-node creation tools onto the shared semantic binding boundary: `create_agent_ask_user_more`, `create_agent_evidence`, and `create_agent_variant_branches` now use `withAgentExecutionNodeSemantics` so ask/evidence/variant/comparison nodes write durable `meta.agentExecution` together with top-level run/session/agent/container-role/context-slot semantics on the same `PenNode`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-ask-user-more.test.ts src/mcp/tools/create-agent-evidence.test.ts src/mcp/tools/create-agent-variant-branches.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Added the shared Agent execution-node semantic binding helper: `canvas-core` now exposes `withAgentExecutionNodeSemantics` so execution nodes write durable `meta.agentExecution` together with top-level `runId`, `sessionId`, `agentBinding`, non-empty `containerRole`, and execution `contextSlots` on the same `PenNode`; `create_agent_canvas_flow` and `create_agent_execution_flow` now use this shared boundary for their created execution nodes.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-canvas-flow.test.ts src/mcp/tools/create-agent-execution-flow.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Tightened the simple image-generation Agent canvas flow binding slice: every `create_agent_canvas_flow` node that carries durable `meta.agentExecution` now also gets top-level `runId`, `sessionId`, `agentBinding`, non-empty `containerRole`, and execution `contextSlots` in the same write boundary, including the nested loading `tool_call` nodes inside the final-deliverable container.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-canvas-flow.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Added the selectable Agent execution-chain context slice: selected Agent execution nodes now resolve `upstreamNodeIds` and `downstreamNodeIds` against active-page `PenDocument.pages` nodes and show upstream/downstream cards with title, kind, tool, status, and explicit missing-node states; clicking an existing chain card selects that canvas node for inspection instead of only showing comma-separated IDs.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/property-panel/agent-execution-chain-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/src/components/canvas/canvas-overlays.tsx apps/web/test/canvas-property-panel.test.tsx feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the structured critique-node review slice: `record_agent_critique` now writes validation/critique findings, issue counts, and pass state into durable `meta.agentExecution.critique`; selected critique nodes show those findings in the property panel with severity, target node, and suggested fix instead of requiring users to parse a plain tool-output paragraph.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/record-agent-critique.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/agent-execution.ts apps/server/src/mcp/tools/record-agent-critique.ts apps/server/src/mcp/tools/record-agent-critique.test.ts apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-critique-section.tsx apps/web/test/canvas-property-panel.test.tsx feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `ask_user_more` attachment-count write-back slice: when a waiting Agent node continuation sends canvas/image attachments, the chat prompt now includes `waiting_attachment_count`, ChatSidebar reports the submitted attachment count after run creation, CanvasPage writes it back to `meta.agentExecution.waitingForUser.response.attachmentCount`, and the property panel shows the count on the selected waiting node.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx test/chat-sidebar.test.tsx test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check apps/web/src/components/chat-input-context.ts apps/web/src/components/chat-sidebar.tsx apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/app/canvas/page.tsx apps/web/test/chat-input.test.tsx apps/web/test/chat-sidebar.test.tsx apps/web/test/canvas-property-panel.test.tsx feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the checkpoint hover action slice: hovering a `checkpoint` execution node now shows transient canvas actions for `继续`, `重跑`, and `新分支`, routing into the existing continuation intents without writing hover state to `PenDocument.pages`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-overlays.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/canvas-overlays.tsx apps/web/src/components/canvas/use-skia-pointer-interactions.ts apps/web/src/components/canvas/skia-canvas.tsx apps/web/test/canvas-overlays.test.tsx feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the branch-aware continuation context slice: selected Agent execution nodes now send richer `<agent_execution_continue_context>` with upstream/downstream IDs, branch plan/deliverable/critique summaries, branch strengths/risks/use cases, comparison/checkpoint/waiting/failure context, and manual branch references carry the same summaries, so `继续深化` can guide the Agent along the selected `variant_branch` while still requiring live `PenDocument.pages` inspection before edits.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/web/src/components/chat-input-context.ts apps/web/test/chat-input.test.tsx apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts`.
- Passed: `git diff --check`.
- Added the Phase 4 branch execution-summary slice: `variant_branch` metadata now records per-branch plan, deliverable, and critique summaries alongside strengths/risks/use cases; `create_agent_variant_branches` writes those fields into durable branch cards and comparison copy, the Agent prompt requires them for multi-direction requests, and the Web property panel/comparison branch cards surface them for user inspection without introducing branch-only runtime state.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-variant-branches.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/canvas-overlays.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/agent-execution.ts apps/server/src/mcp/tools/create-agent-variant-branches.ts apps/server/src/mcp/tools/create-agent-variant-branches.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/web/src/components/canvas/property-panel/agent-variant-branch-details.tsx apps/web/src/components/canvas/property-panel/agent-comparison-branch-cards.tsx apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/src/components/canvas/canvas-overlays.tsx apps/web/test/canvas-property-panel.test.tsx feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the Web property-panel evidence provenance slice: selected Agent `evidence` nodes now show source type/name, URL/asset/node IDs, confidence, and an `打开链接` action when a source URL exists, keeping the UI anchored on `meta.agentExecution.evidence` instead of introducing parallel evidence state.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/property-panel/agent-execution-evidence-section.tsx apps/web/src/components/canvas/property-panel/agent-execution-section.tsx apps/web/test/canvas-property-panel.test.tsx docs/tech/ai-native-canvas-agent-capability-plan.md docs/tech/canvas-tooling-capability-map.md progress.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `create_agent_evidence` MCP slice: Agents can now persist URL, asset, canvas-node, text, or search-result evidence as durable `evidence` execution nodes with provenance stored in `meta.agentExecution.evidence`, optional upstream execution links, semantic connectors, and selection, so source material becomes inspectable canvas context instead of chat-only notes.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-evidence.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/agent-execution.ts apps/server/src/mcp/tools/create-agent-evidence.ts apps/server/src/mcp/tools/create-agent-evidence.test.ts apps/server/src/mcp/server.ts apps/server/src/mcp/deepagents-bridge.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added best-effort image job execution-node write-back: when `generate_image` carries `agentExecutionNodeId`, the runtime now updates the referenced durable `tool_call` / `task_step` node on image job success, cancellation, failure, or timeout, writing status, visible text, output/error details, and failed-step recovery actions while keeping `PenNode.meta.agentExecution` as the source of truth.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/agent-execution-image-writeback.test.ts src/agent/tools/image-generate.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/agent/agent-execution-image-writeback.ts apps/server/src/agent/agent-execution-image-writeback.test.ts apps/server/src/agent/runtime.ts docs/tech/ai-native-canvas-agent-capability-plan.md docs/tech/canvas-tooling-capability-map.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `generate_image` execution-node correlation slice: the tool now accepts and returns `agentExecutionNodeId`, the runtime preserves it in image job payloads as diagnostic/correlation metadata, shared job contracts accept `agent_execution_node_id`, and the Agent prompt tells image calls to pass the `toolCallNodeIds` returned by `create_agent_execution_flow` so `record_agent_tool_call` can write back to the exact durable execution node.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/tools/image-generate.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/shared exec vitest run src/contracts.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/shared typecheck`.
- Passed: `pnpm exec biome check apps/server/src/agent/tools/image-generate.ts apps/server/src/agent/tools/image-generate.test.ts apps/server/src/agent/runtime.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts packages/shared/src/job-contracts.ts packages/shared/src/contracts.test.ts apps/server/src/features/jobs/executors/image-generation.ts feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `record_agent_tool_call` MCP slice: after a tool runs, the Agent can now write input/output/reasoning/error details, status, tool call ID, visible node text, and failed-step recovery context into an existing durable `tool_call` or `task_step` node, keeping the property panel explainable without treating chat or run trace as runtime truth.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/record-agent-tool-call.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/mcp/tools/record-agent-tool-call.ts apps/server/src/mcp/tools/record-agent-tool-call.test.ts apps/server/src/mcp/server.ts apps/server/src/mcp/deepagents-bridge.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `create_agent_ask_user_more` MCP slice: when execution needs user text, files, images, brand material, or confirmation, the Agent can now create a durable `ask_user_more` node with `waitingForUser.prompt` / `acceptsFiles`, link it from an upstream execution node through `downstreamNodeIds` plus a semantic connector, select it for property-panel response, and the main Agent prompt now forbids handling missing input only as a chat message.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-ask-user-more.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/mcp/tools/create-agent-ask-user-more.ts apps/server/src/mcp/tools/create-agent-ask-user-more.test.ts apps/server/src/mcp/server.ts apps/server/src/mcp/deepagents-bridge.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts docs/tech/ai-native-canvas-agent-capability-plan.md docs/tech/canvas-tooling-capability-map.md progress.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Tightened `create_agent_execution_flow` chain metadata: newly created execution cards now persist derived `downstreamNodeIds` alongside existing `upstreamNodeIds` in durable `meta.agentExecution`, so the property panel, continuation drafts, and Recipe extraction can read the same bidirectional execution graph from `PenDocument.pages` instead of reconstructing it from run trace.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-execution-flow.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/mcp/tools/create-agent-execution-flow.ts apps/server/src/mcp/tools/create-agent-execution-flow.test.ts docs/tech/ai-native-canvas-agent-capability-plan.md docs/tech/canvas-tooling-capability-map.md progress.md feature_list.json`.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the first Phase 5 Recipe template starter slice: `canvas-core` now defines six reusable Agent Recipe starters with node structure, tool order, input slots, validation rules, and deliverable format; ChatInput exposes a Recipe menu, pre-fills an editable prompt, shows a removable Recipe chip, and sends `<agent_recipe_template>` prompt context so the Agent starts by materializing the template as durable execution-chain nodes instead of a parallel template state.
- Added the first saved Recipe Template slice: completed Recipe/comparison/checkpoint/final-deliverable execution nodes can now be saved from the property panel into the local Recipe menu. Extraction reads the selected node's durable `meta.agentExecution` metadata, infers node structure/tool order/input slots/validation rules/deliverable format, and keeps the saved template as reusable prompt configuration rather than canvas runtime truth.
- Extended saved Recipe extraction from a single selected node to the selected node's completed upstream/downstream execution-chain graph on the active page. The template now records ordered source node IDs, derives node structure/tool order/validation rules from the graph, and the property panel passes current page nodes read from `PenDocument.pages` without introducing Agent-only runtime state.
- Added local Recipe template library controls in the chat input menu: saved templates show source-node counts, can expand to preview node structure/tool order/input slots/source IDs, and can be deleted from local storage without mutating the original canvas execution nodes.
- Tightened the `ask_user_more` continuation interaction: submitting text now still writes the durable response to `meta.agentExecution.waitingForUser.response`, but also passes that text into the selected-node continuation draft so the next Agent turn starts with the user's submitted answer visible in the editable prompt.
- Added comparison-node branch cards in the Web property panel: selected `comparison` nodes now resolve active-page branch nodes from `comparison.branchNodeIds`, show strengths/risks/use cases/mainline status side by side, and expose per-branch `继续深化` / `设为主线` actions while missing branch nodes show an explicit unavailable message.
- Added `record_agent_critique` as the explicit write-back boundary for validation/critique results: `validate_canvas` and `critique_canvas` remain read-only, while this tool updates an existing durable `critique` node's `meta.agentExecution`, visible text content, selection, versioned patch, and diagnostics after the Agent has a concrete critique node ID.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/record-agent-critique.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched Recipe template schema, chat input/context/tests, property-panel save UI/tests, Agent prompt/tests, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the Agent run pause controller slice: shared stream contracts now include `run.paused`, the server exposes `/api/agent/runs/:runId/pause`, runtime aborts distinguish pause from cancel, the Web API/chat sidebar/control bar wire a real `暂停` action, and SSE treats paused runs as terminal while continuation remains anchored on durable selected execution nodes.
- Passed: `pnpm --filter @cucumber/shared exec vitest run src/contracts.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/stream-adapter.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-control-bar.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/shared typecheck`.
- Passed: `pnpm --filter @cucumber/shared build`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched shared contracts/events/http, server runtime/stream/routes/mock/run-trace, Web API/SSE/chat/control/page/test, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the checkpoint rerun draft slice: restartable checkpoint nodes now route `从 checkpoint 重跑` / canvas-toolbar `重跑` / run-control checkpoint rerun into a rerun-specific continuation draft that preserves the checkpoint as the durable context anchor and asks the Agent to rebuild downstream work.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/canvas-overlays.test.tsx test/agent-run-control-bar.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched checkpoint/rerun property-panel, canvas toolbar, run-control, canvas page, related tests, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the failed-node retry recovery slice: failed Agent execution nodes now route `重试此步骤` into the same selected-node continuation draft with a retry-specific prompt, while still disabling the control when the panel cannot open Agent input.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched failed-node recovery UI, canvas page draft text, property-panel test, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the Agent run-control continue slice: the top Agent run control bar now enables `继续` when a selected Agent execution node is available and no run is actively streaming, opening the same selected-node continuation draft; pause and checkpoint rerun remain gated on a real run controller.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-control-bar.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched run control bar, canvas page, run-control tests, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the `ask_user_more` file/image supplement slice: selected ask nodes that accept files now expose a real `补充文件/图片` action, opening the Agent continuation draft for that waiting node and requesting the existing chat attachment picker instead of showing a disabled placeholder.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/chat-input.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched ask-user-more property panel, chat input/sidebar, canvas page, related tests, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the checkpoint canvas-toolbar interaction slice: selecting a `checkpoint` execution node now shows compact canvas-level actions for `继续`, disabled `重跑`, and `新分支`; continue and branch open the existing continuation draft path, while rerun stays gated with a concrete run-controller reason.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-overlays.test.tsx test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched canvas overlay, Skia canvas pass-through, overlay test, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the next Phase 3 chat-input reference slice: users can now manually add the current canvas selection as removable reference chips before sending a message; those references enter the Agent prompt as live `PenDocument.pages` node IDs under `<canvas_node_references>` with instructions to inspect current canvas state before editing, not as a copied parallel canvas truth.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched chat input context/strip, chat tests, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the checkpoint-specific Phase 3 property-panel slice: selected `checkpoint` execution nodes now show a dedicated recovery panel with restart availability, restart reason/default context copy, real continuation and new-branch draft actions, and a disabled `从 checkpoint 重跑` action with a concrete reason until the run controller is wired.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched Agent execution property-panel components/test, plan, progress, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the next Phase 4 branch decision slice: MCP `select_agent_variant_branch` can now persist a user/Agent choice by setting one durable `variant_branch` as the unique mainline/recommended branch under its `comparison`, updating sibling branch metadata, comparison recommendation copy, visible branch styling, and selected-node context through a version-protected live canvas patch.
- Added the matching property-panel interaction: non-mainline `variant_branch` nodes now expose a real `设为主线` action when their comparison context is resolvable, committing all sibling branch metadata, comparison recommendation text, visible styling, and selection through the same `PenDocument.pages` runtime truth.
- Added the branch deepening interaction: `variant_branch` nodes now expose `继续深化` in the property panel; clicking it opens the chat panel, pre-fills an editable continuation draft, keeps the selected branch as `<agent_execution_continue_context>`, and defaults to `new_branch` so the Agent continues along that branch without deleting other variants.
- Promoted more Agent-node recovery controls from display-only to usable continuation drafts: `从这里继续`, `复制为分支`, failed-node `改写后继续`, `跳过此步骤`, `新分支尝试`, and `ask_user_more` text submission now open/pre-fill the chat input with the selected node context and the correct `new_branch` or `overwrite_current` mode; true run rerun remains disabled until the run controller is wired.
- Added a real run trace panel to the Agent run control bar: `查看 run trace` now opens a live SSE-backed trace view with recent run events, tool calls, canvas patch counts, selected execution-node context, and an explicit empty-events message instead of a disabled placeholder; pause/continue/checkpoint rerun remain disabled until the run controller exists.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/select-agent-variant-branch.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/chat-input.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-control-bar.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Added the first Phase 4 multi-variant branch slice: `meta.agentExecution` now supports `comparison` nodes plus branch/comparison metadata, MCP `create_agent_variant_branches` creates durable `variant_branch` cards and a `comparison` card with strengths, risks, use cases, recommended/mainline flags, and semantic connectors, the main Agent prompt routes multi-direction requests through this tool, and the property panel displays branch and comparison metadata for selected nodes.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-variant-branches.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched Agent execution schema, variant-branch MCP tool/test, MCP registry, prompt, property-panel UI/test, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the next Phase 3 Agent run control bar slice: the canvas now shows a top run control bar for active Agent runs or selected execution nodes, including active run ID, selected node kind/title/status context, waiting-for-user prompts, failed-node reasons, and disabled pause/continue/checkpoint-rerun/trace controls with explicit reasons; the Stop action is wired through `cancelRun` to `/api/agent/runs/:runId/cancel`, then stops the active SSE stream and clears the control state.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-run-control-bar.test.tsx test/chat-sidebar.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check` for the touched Agent run control bar, canvas page, chat sidebar, cancel API wrapper, related tests, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the next Phase 3 chat-input continuation slice: selecting an Agent execution node now shows a continuation mode control with `新分支继续` and `覆盖当前节点`, submits the selected node/run/status/mode as `<agent_execution_continue_context>` to the Agent prompt while keeping the visible user message clean, and the main Agent prompt now tells the Agent how to honor `new_branch` versus `overwrite_current`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/chat-input.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check` for the touched chat input, chat sidebar, prompt, prompt test, chat input test, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the next Phase 3 Agent execution-node property-panel interaction slice: `task_step` / `tool_call` / `ask_user_more` / failed nodes now expose expandable execution details for tool/input/output/reasoning/error context, failed nodes show attempted actions and user recovery choices without raw error codes, and `ask_user_more` nodes can write a user's text response directly back into `meta.agentExecution.waitingForUser.response`; run-controller actions remain disabled with explicit reasons until pause/continue/rerun/fork execution is wired.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched canvas-core metadata, Agent execution property-panel UI, related property-panel test, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the generic Agent execution flow tool: MCP `create_agent_execution_flow` can now create a durable Flowith-like user goal → Recipe → task step/tool-call → critique → final deliverable → checkpoint chain with semantic connectors and `meta.agentExecution` on every execution node; the main Agent prompt now uses it for complex design, structured canvas editing, and continuation-oriented tasks while keeping `create_agent_canvas_flow` for simple image-generation flows.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-execution-flow.test.ts src/mcp/deepagents-bridge.test.ts src/agent/prompts/cucumber-main.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check` for the touched server MCP, prompt, and feature registry files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Added the first Agent execution canvas schema slice: `packages/canvas-core` now owns `meta.agentExecution` schema/helpers for `user_goal`, `recipe_plan`, `task_step`, `tool_call`, `evidence`, `variant_branch`, `critique`, `ask_user_more`, `checkpoint`, and `final_deliverable` nodes; `create_agent_canvas_flow` tags its simple image-generation chain with durable execution metadata, generated image insertion marks targeted final-deliverable containers complete, the property panel shows execution type/status/run/tool/upstream/downstream context with unavailable run controls disabled and explained, and the chat input shows a selected Agent execution-node context chip for follow-up prompts.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/agent-execution.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-canvas-flow.test.ts src/features/canvas/canvas-element-writer.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx --reporter=dot`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec biome check` for the touched canvas-core, server, web, property-panel, chat input, docs registry JSON, and related test files.
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `git diff --check`.
- Fixed the Agent image result container flow so `create_agent_canvas_flow` creates visible loading nodes inside the result container, and generated images replace those loading nodes inside the same container through shared canvas operations instead of appearing as a separate direct insertion.
- Changed image job completion in the Agent runtime to prefer `LiveCanvasService.patchDocument` when a canvas is open, so the currently visible Skia canvas receives the generated image in its target container; the existing database writer remains the offline/background boundary.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-canvas-flow.test.ts src/features/canvas/canvas-element-writer.test.ts src/agent/tools/image-generate.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/features/canvas/canvas-element-writer.ts apps/server/src/features/canvas/canvas-element-writer.test.ts apps/server/src/mcp/tools/create-agent-canvas-flow.ts apps/server/src/mcp/tools/create-agent-canvas-flow.test.ts apps/server/src/agent/runtime.ts`.
- Fixed live Agent canvas writes so browser RPC `canvas.document.set` and `canvas.document.patch` update the Skia renderer immediately after committing to the live `PenDocument.pages` runtime state, preventing Agent-created execution chains and patch transactions from only becoming visible after final artifact insertion or a later refresh.
- Kept normal UI `setDocument` calls on the existing animation-frame coalesced renderer sync path, and added regression coverage for the live RPC immediate path plus the coalesced UI path.
- Passed: `pnpm --filter @cucumber/web test -- --run test/skia-canvas-selection-snapshot.test.tsx test/canvas-api-types.test.ts --reporter=dot`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Reworked the project test harness into faster, more precise layers: added root Vitest `test.projects`, changed-aware package validation via `pnpm test:changed`, and a deterministic canvas regression matrix via `pnpm test:canvas`.
- Wired `packages/pen-core` tests into the default package test surface, split its source typecheck away from test fixture strictness, and fixed `normalizeTreeLayout` to truly delete stale child `x/y` fields for active-layout parents.
- Kept default server package tests unit/contract-only by excluding `.integration.test.ts` from the server Vitest project; real Supabase/Postgres integration tests remain explicit instead of blocking local quick validation.
- Fixed sticky-note shared color parsing for compact CSS RGB strings and updated the project creation failure test to assert the concrete user-facing error message.
- Passed: `pnpm test:workspace`.
- Passed: `pnpm --filter @cucumber/pen-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-core test`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/sticky-note-tool.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/projects.test.tsx`.
- Passed: `pnpm run test:canvas`.
- Passed: `pnpm run test:changed`.
- Closed the Agent chat SSE follow-up failure debug session: removed temporary `127.0.0.1:7777/event` browser debug probes from the web stream/sidebar code and locked the run-scoped SSE stop behavior with a regression test for replayed old-run terminal events.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-sse-stream.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm exec biome check apps/web/src/hooks/use-sse-stream.ts apps/web/src/components/chat-sidebar.tsx apps/web/test/use-sse-stream.test.tsx debug-agent-followup-chat.md` (Biome checked the configured TS/TSX files; Markdown is ignored by current config).
- Added the minimal Agent canvas image-generation flow: MCP `create_agent_canvas_flow` now creates a visible user-input sticky → optimized image prompt sticky → image result container chain with semantic connector arrows, and `generate_image` can target that result container with explicit placement so simple requests like "帮我生成一张小狗的图片" appear on the canvas instead of only in chat.
- Shared the sticky-note node factory through `packages/canvas-core` so Agent-created sticky nodes use the same `meta.boardKind="sticky"` / body-text structure as Web-created sticky notes, keeping sticky selection/connector behavior on one runtime truth.
- Updated image background job insertion to preserve explicit placement and `targetContainerId` through runtime and worker paths, with clear failures when the requested result container is missing, hidden, or not a container.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/create-agent-canvas-flow.test.ts src/agent/tools/image-generate.test.ts src/features/canvas/canvas-element-writer.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/shared typecheck`.
- Passed: `pnpm --filter @cucumber/web exec tsc --noEmit --pretty false --incremental false`.
- Passed: targeted `pnpm exec biome check` for touched server, shared, canvas-core, web sticky, prompt, progress, and feature registry files.
- 新增 `docs/code-map.md`，作为功能能力到代码入口的导航地图，覆盖稳定功能入口、职责边界、附近测试、常用 `rg` 搜索，以及现有 `.codegraph/codegraph.db` symbol 索引的可复用 SQLite 查询。
- 将代码地图登记到 `docs/workflow.md` 和 `feature_list.json` 的项目 harness artifacts 中。
- 将 `docs/code-map.md` 和本次新增的相关登记说明改为中文，路径、命令和 symbol 名称保持原样，便于直接查询。
- Passed: `node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json ok')"`.
- Passed: `pnpm exec biome check docs/code-map.md docs/workflow.md progress.md feature_list.json` (Biome checked the configured JSON file; Markdown docs are ignored by current config).
- Passed: `git diff --check -- docs/code-map.md docs/workflow.md feature_list.json progress.md`.

## 2026-06-02

- Added the P2 read-only `canvas_memory_index` MCP tool: Agents can now build a searchable live-canvas memory index from durable `PenDocument.pages` nodes, context slots, Agent bindings, run/session metadata, and text content while explicitly marking that no persisted memory truth was written.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/tools/canvas-transaction-tools.test.ts src/mcp/tools/canvas-validation-tools.test.ts src/mcp/tools/get-selection-context.test.ts src/mcp/tools/canvas-asset-tools.test.ts src/mcp/tools/canvas-connector-tools.test.ts src/mcp/tools/canvas-resize-tools.test.ts src/mcp/tools/canvas-agent-output-container-tools.test.ts src/mcp/tools/canvas-layout-tools.test.ts src/mcp/tools/canvas-memory-index-tools.test.ts src/mcp/tools/canvas-critique-tools.test.ts src/mcp/tools/canvas-export-deliverable-tools.test.ts src/mcp/tools/canvas-run-trace-tools.test.ts src/mcp/deepagents-bridge.test.ts src/features/canvas/live-canvas-service.test.ts`.
- Passed: `pnpm --filter @cucumber/server build`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-memory-index-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched memory-index MCP tool, memory-index tests, MCP registry, and bridge test.
- Added the P2 read-only `canvas_run_trace` MCP tool: Agents and engineers can now inspect recent Agent stream events plus live run-bound canvas nodes, including tool calls, canvas patch transaction IDs, affected node IDs, active/requested run context, and explicit event-buffer availability without materializing process containers on the canvas.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-run-trace-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched run-trace MCP tool, run-trace tests, MCP registry, Deep Agent tool wiring, runtime event-buffer wiring, and bridge test.
- Added the P2 read-only `export_canvas_deliverable` MCP tool: Agents can now turn selected or explicit live canvas nodes into traceable `structured_json`, `flow_spec`, or `component_spec` handoffs with root/source node IDs, scene bounds, referenced assets, and validation summaries while unsupported render/code/deck targets return explicit reasons.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-export-deliverable-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched export-deliverable MCP tool, export tests, MCP registry, and bridge test.
- Added the P2 read-only `critique_canvas` MCP tool: Agents can now run deterministic canvas critique passes for hierarchy, visual consistency, brand/style context, container role clarity, deliverable completeness, and validation summaries, returning node-grounded findings and suggested fixes without mutating canvas state.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-critique-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched critique MCP tool, critique tests, MCP registry, and bridge test.
- Completed the P1 durable editing primitive surface from `ai-native-canvas-agent-capability-plan.md` by adding MCP `layout_canvas`: Agents can now express layout intent through auto-layout field updates or bounded stack/grid/flow/avoid-overlap/align-distribute node placement, with same-parent coordinate-space enforcement, dry-run preview, transaction IDs, and live `baseVersion` protection.
- Split layout planning into `layout-canvas-planner.ts` so the MCP wrapper stays below the project file-size threshold and layout strategy math remains a pure helper module.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-layout-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched layout MCP tool, layout planner, layout tests, MCP registry, and bridge test.
- Added the P1 `create_agent_output_container` MCP tool: Agents can now create canonical durable output `FrameNode` containers with role, context slots, agent binding, IO ports, run/session metadata, optional children, deterministic placement, dry-run preview, created-container selection, transaction IDs, and live `baseVersion` protection.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-agent-output-container-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched output-container MCP tool, output-container tests, MCP registry, and bridge test.
- Added the P1 `resize_container_to_fit` MCP tool: Agents can now resize frame/group containers to visible descendant scene bounds with padding, min/max constraints, dry-run preview, layout warnings, container selection, transaction IDs, and live `baseVersion` protection while leaving child positions unchanged.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-resize-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched resize MCP tool, resize tests, MCP registry, and bridge test.
- Added the P1 `connect_nodes` MCP tool: Agents can now create durable semantic `LineNode.connector` relations between visible connector-capable frame/group/rectangle nodes, with automatic endpoint side selection from scene bounds, optional relationship labels/style, dry-run preview, created connector selection, transaction IDs, and live `baseVersion` protection.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-connector-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched connector MCP tool, connector tests, MCP registry, and bridge test.
- Added the first P1 durable asset primitives from `ai-native-canvas-agent-capability-plan.md`: MCP `query_canvas_assets` now reads `PenDocument.assets` plus image/video/fill references with missing-reference diagnostics, and MCP `replace_asset_in_node` preserves node identity/bounds while replacing `image.src`, `videoEmbed.src`, or image fill URLs through versioned live canvas patch transactions.
- Extended the canonical canvas operation protocol with `upsertAsset` so asset replacement can update `PenDocument.assets` and the consuming node field in one transaction instead of bypassing the patch boundary.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/canvas-asset-tools.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core test -- --run src/__tests__/canvas-core.test.ts`.
- Passed: targeted `pnpm exec biome check` for the touched canvas-core operation/type files, MCP asset tools, server registry, bridge test, and asset tool tests.
- Completed the P0 live semantic loop tool surface from `ai-native-canvas-agent-capability-plan.md` by adding MCP `validate_canvas` and MCP-compatible `screenshot_canvas`: validation now performs deterministic structural checks for page/node integrity, duplicate/missing node IDs, missing assets, missing variables, dangling connectors, likely fixed text overflow, invalid component refs, and hidden/locked Agent outputs, while screenshot capture is now visible through the MCP registry by wrapping the existing browser `canvas.screenshot` RPC tool.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts src/mcp/tools/get-selection-context.test.ts src/mcp/tools/canvas-transaction-tools.test.ts src/mcp/tools/canvas-validation-tools.test.ts src/features/canvas/live-canvas-service.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched P0 MCP canvas tools, helper modules, live-canvas service files, docs, `progress.md`, and `feature_list.json`.
- Added the P0 `canvas_diff_preview` and `apply_canvas_transaction` MCP tools: Agents can now preview page-aware `CanvasOperation[]` edits without mutation, inspect affected/created/updated/deleted/moved nodes, affected bounds, high-risk deletes/asset replacements/large moves/visibility-lock changes, and then commit through `LiveCanvasService.patchDocument` with dry-run support, optional selection updates, transaction IDs, and live `baseVersion` protection.
- Extended `LiveCanvasService` with `getDocumentState` so transaction tools can read the current live document version from `canvas.document.get` while preserving the existing `getDocument` read API.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts src/mcp/tools/get-selection-context.test.ts src/mcp/tools/canvas-transaction-tools.test.ts src/features/canvas/live-canvas-service.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched live-canvas service, MCP transaction/semantic/selection tool, helper, and test files.
- Added the P0 `get_selection_context` MCP tool for AI-native selection anchoring: it reads the live runtime selection from the current document, returns selected node summaries, parent container paths, effective context slots, optional ancestors/descendants/siblings, and capability flags with explicit disabled reasons for empty selections, locked nodes, text editing, asset replacement, connection, grouping, and ungrouping.
- Split shared AI-native canvas live-context and semantic traversal helpers out of `inspect_canvas_semantic` so future P0 tools can reuse the same live `PenDocument.pages` truth without growing a single tool file past the project size threshold.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts src/mcp/tools/get-selection-context.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for the touched MCP tool, helper, and test files.
- Added the P0 `inspect_canvas_semantic` MCP tool for AI-native live canvas reading: it validates live `canvasId`/`userId`/`accessToken` context, reads only `PenDocument.pages` plus active or explicit page truth, returns semantic containers, selected/focus nodes, connector dataflow edges, referenced assets, optional variable/theme summaries, and structured warnings for omitted hidden/locked nodes or invalid references.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Added `docs/tech/canvas-tooling-capability-map.md` as the current inventory for canvas runtime truth, Web editor tools, property inspector fields, `CanvasApi` functions, core operations, and Agent/MCP callability.
- Added `docs/tech/ai-native-canvas-agent-capability-plan.md` as the implementation plan for the next Agent-callable canvas capabilities, including semantic inspect, selection context, diff preview, transactional apply, validation, MCP screenshot, layout/fit, asset replacement, critique, export, and run trace.
- Fixed the `inspect_canvas` MCP wrapper to receive `liveCanvasService`, keeping the documented MCP capability aligned with the live-editor read path.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/schema.test.ts src/mcp/deepagents-bridge.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: targeted `pnpm exec biome check` for touched MCP TS files, `feature_list.json`, `progress.md`, and canvas capability docs.
- Split the 6k+ line `SkiaCanvas` implementation into focused canvas modules for API facade forwarding, document normalization/renderer sync, draw geometry/node factories, scene snapshots, runtime selection utilities, import diagnostics/placement/raster upload, import actions, text measurement, text edit overlay, and connected canvas overlays while keeping `SkiaCanvas` as the public composition root.
- Kept the canvas runtime truth unchanged: `CanvasRuntimeStore` still owns document, active page, selection, viewport, and version state; import/normalization compatibility remains at boundary modules, and core pointer/API behavior continues through the existing CanvasApi contract.
- Passed: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit --pretty false`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: targeted `pnpm exec biome check` for `apps/web/src/components/canvas/skia-canvas.tsx` and the new extracted canvas modules.
- Failed: `pnpm --filter @cucumber/web typecheck` after `next typegen` completed; `tsc` reported missing generated `.next/types/app/**` route files and the existing Next workspace-root warning selected `/Users/bytedance/package-lock.json`.
- Failed: `pnpm --filter @cucumber/web build`; compilation reached Next prerendering with existing `paper` optional-module warnings for `acorn`/`canvas`, then `/404` prerender failed because `.next/server/webpack-runtime.js` could not load `./891.js`.
- Tightened sticky-note interaction semantics: sticky body text now stores empty content with `Type anything` only as placeholder metadata, old default placeholder text is normalized at canvas ingress, all sticky descendants select the sticky as one object, sticky frames are excluded from paste/import/drop parent resolution, sticky background updates also derive the stroke color, the selection toolbar follows live viewport panning, sticky labels have a rounded background, and double-clicking the label edits `sticky.name`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/sticky-note-tool.test.ts test/canvas-selection-helpers.test.ts test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: targeted `pnpm exec biome check` for touched sticky/canvas-core/pen-renderer files.
- Updated sticky-note editing ergonomics: new sticky notes no longer clip nested canvas content, sticky body text still selects/edits through the parent sticky, arbitrary nested child elements remain directly selectable so they can be dragged back out, and sticky body editing temporarily hides selection chrome while restoring the sticky selection after commit/cancel.
- Added sticky-specific selection toolbar controls for background color, text color, font family, bold, font size, and unordered bullets, with structured logs for sticky background/text updates; color controls now stay compact as current-color buttons and expand their palettes through a chevron menu with all color options in one row, while font family and font size now use the shared DropdownMenu UI and the font menu reads locally available device font families when opened.
- Removed sticky-note mask editing from the property panel so sticky containers no longer expose a control that writes `mask`, while regular node mask controls remain available.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/sticky-note-tool.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/sticky-note-tool.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: targeted `pnpm exec biome check apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/test/canvas-property-panel.test.tsx`.
- Passed: targeted `pnpm exec biome check apps/web/src/components/canvas/skia-canvas.tsx progress.md feature_list.json`.

## 2026-06-01

- Encapsulated the sticky-note tool into a dedicated helper module: sticky nodes now carry explicit `sticky_note` container metadata, context-container defaults, and non-selectable body text metadata; SkiaCanvas remaps sticky body-text hits back to the parent sticky for click, shift-click, marquee, context-menu, and post-edit selection.
- Added sticky-specific connector affordances: selected sticky notes now show four blue side connector dots instead of side resize handles, dragging a dot previews an arrow connector, dropping on another connector target attaches to that target, and dropping into empty canvas creates a new linked sticky container plus a smooth routed arrow.
- Unified sticky connector endpoint geometry with the visible blue side dots: sticky connector bindings now resolve/snap to the outward handle positions, sticky connector drag creation starts/ends on those points, and the renderer keeps the blue dots in scene-space so zoom does not desync handles from line endpoints.
- Added live-following connector transform previews: when a sticky/container moves, attached connector line endpoints are previewed with the moving bound node during drag instead of waiting for the committed document reconciliation after pointerup.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/connector-geometry.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/renderer-performance.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/sticky-note-tool.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: targeted `pnpm exec biome check packages/canvas-core/src/connector-geometry.ts packages/canvas-core/src/__tests__/connector-geometry.test.ts packages/pen-renderer/src/renderer.ts packages/pen-renderer/src/renderer-performance.test.ts apps/web/src/components/canvas/sticky-note-tool.ts apps/web/src/components/canvas/skia-canvas.tsx apps/web/test/sticky-note-tool.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/sticky-note-tool.test.ts`.
- Passed: targeted `pnpm exec biome check apps/web/src/components/canvas/skia-canvas.tsx apps/web/src/components/canvas/sticky-note-tool.ts apps/web/test/sticky-note-tool.test.ts packages/pen-renderer/src/renderer.ts packages/pen-renderer/src/types.ts`.
- Passed: local Playwright CLI smoke opened `http://localhost:3000/test/canvas-agent-output`; CanvasKit and PenRenderer initialized, with the existing Paper/acorn dev warning still present.
- Note: an accidental broad `pnpm --filter @cucumber/web test -- test/sticky-note-tool.test.ts` invocation ran the whole web suite and still hit the existing unrelated `apps/web/test/projects.test.tsx` toast text assertion; the corrected direct Vitest command above passed.
- Added the FigJam-like canvas editing slice: `LineNode` now supports typed connector binding metadata, canvas-core keeps attached connector endpoints reconciled across move/resize/delete operations, dangling connector references fail with readable diagnostics, pen-renderer draws smooth routed connectors with endpoint tips aligned to the curve tangent, and SkiaCanvas can create/snap/detach connector and arrow-connector endpoints against container sides.
- Added productized canvas editing controls for this slice: the main editor toolbar is now a bottom-centered floating toolbar with sticky, connector, arrow connector, and Section tools; selection gets a viewport-following floating toolbar; right-click opens contextual canvas/node/multi-select/connector actions; keyboard shortcuts now include `S`, `C`, `Shift+C`, and `F`.
- Passed: `pnpm --filter @cucumber/canvas-core test -- --runInBand`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --dir apps/web exec vitest run test/canvas-editor-toolbar.test.tsx test/use-canvas-keyboard-shortcuts.test.tsx test/canvas-api-types.test.ts`.
- Passed: `pnpm lint`.
- Failed: root `pnpm typecheck` still stops in existing unrelated `packages/pen-core/__tests__` strictness diagnostics (`Object is possibly undefined`), outside this FigJam-like canvas editing slice.
- Note: an accidental broad `pnpm --filter @cucumber/web test -- ...` invocation still hits the existing unrelated `apps/web/test/projects.test.tsx` toast text assertion; the corrected direct Vitest command above passed.
- Advanced the Figma-style line/arrow tool slice: line nodes now use endpoint-driven geometry helpers for local/scene bounds, reverse-drag/Shift/Option creation keeps real `x/y/x2/y2` endpoints, selected lines expose endpoint handles, line moves update both endpoints, arrows use typed stroke endpoint tips with legacy `_connectorType` render/export compatibility, and SVG export now emits real line endpoints plus marker/dash/cap data.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm exec vitest run test/skia-canvas-selection-snapshot.test.tsx test/canvas-export.test.ts test/canvas-property-panel.test.tsx test/use-canvas-keyboard-shortcuts.test.tsx test/canvas-editor-toolbar.test.tsx` from `apps/web`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm lint`.
- Passed: `pnpm --filter @cucumber/web build` with existing Paper optional dependency / metadataBase warnings.
- Failed: root `pnpm typecheck` still stops in existing unrelated `packages/pen-core/__tests__` strictness diagnostics (`Object is possibly undefined`), outside this line/arrow tool slice.
- Failed: `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts --workers=1` timed out while the harness stayed on `Loading CanvasKit...`, leaving toolbar buttons disabled before any line/arrow assertions ran.
- Closed the next multi-image canvas performance slice: viewport pan cache construction is now gated by node/image thresholds and pending interaction LOD readiness, interactive image draws avoid falling back to 2048px base rasters while 512px LODs are pending, and viewport-cache skip/build logs now report image counts, pending LODs, dimensions, zoom, and interaction mode.
- Moved canvas image persistence off inline base64 for the current PenDocument model: canvas saves extract base64 `assets`, image node `src`, and image-fill URLs into `project-assets`, return the normalized slim document to the Web client, and the editor applies that save response without history pollution, save loops, or viewport reset.
- Kept generated and imported images on URL-backed assets: server-side generated image insertion now writes Storage public URLs directly, raster paste/drop uploads through the existing uploads API before committing to the canvas, and thumbnail uploads now preserve SVG/PNG/WebP MIME extensions with clearer upload diagnostics.
- Passed: `pnpm --filter @cucumber/pen-renderer test -- renderer-performance.test.ts image-loader.test.ts`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/features/canvas/canvas-service.test.ts src/features/canvas/canvas-element-writer.test.ts src/features/projects/project-service.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/server-api.test.ts test/canvas-runtime-store.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm lint`.
- Failed: root `pnpm typecheck` and `pnpm check:quick` still stop in existing unrelated `packages/pen-core/__tests__` strictness diagnostics (`Object is possibly undefined`), outside this canvas persistence/rendering slice.
- Note: broad package test scripts with `-- <paths>` still run wider suites because of script argument parsing; the unrelated existing failures remain in web legacy export fixtures/projects toast matching and server integration/MCP registry tests, while the corrected direct Vitest commands above passed.
- Advanced the canvas hot-path performance pass: SkiaCanvas scene summaries now build a single DFS scene index with node/parent/bounds maps and coalesce scene listener snapshots per frame, selection notifications reuse the index instead of repeated `findNode` / parent-bound scans, document-change callbacks skip empty RAF work when no listener exists, and slow snapshot logs include node/visible/file/selection context.
- Added renderer viewport indexing: render culling now uses a dedicated render-node R-tree that preserves paint order and keeps locked-but-rendered nodes queryable, while transform previews only merge preview nodes that move into view.
- Added Skia path geometry caching: path nodes cache parsed CanvasKit paths and geometry bounds with LRU eviction/dispose cleanup, renderer slow-frame logs now include path-cache stats, and tests cover cache hits plus path-data invalidation.
- Moved image LOD generation off the image load completion task: base images become drawable first, 512/1024 variants are generated in timed slices with duration logs and redraw callbacks, and dispose clears queued LOD work.
- Narrowed image LOD generation to the agreed lightweight path: the loader now keeps only the base image plus a single 512px interaction variant, so pan/zoom/transform still avoid full-resolution sampling while 1024/2048 derived variants are no longer generated or retained.
- Reduced canvas-side React/panel churn: layers precompute parent/move-target maps and render a fixed-row window, files consume the shared scene/files snapshot passed through `onChange`, design-system refresh is throttled and skipped while the icon tab is active, canvas history is capped, and the canvas page ignores selection updates whose summary did not change.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm exec vitest run test/skia-canvas-selection-snapshot.test.tsx test/canvas-layers-panel.test.tsx test/canvas-design-system-panel.test.tsx` from `apps/web`.
- Failed: `pnpm --filter @cucumber/web test -- test/skia-canvas-selection-snapshot.test.tsx test/canvas-layers-panel.test.tsx test/canvas-design-system-panel.test.tsx test/canvas-files-panel.test.tsx` is parsed by the package script as a broad web run; touched tests passed inside that run, but unrelated existing failures remain in `apps/web/test/canvas-export.test.ts` legacy no-page fixtures and `apps/web/test/projects.test.tsx` toast text matching.
- Added the Skia canvas document-sync scheduler: runtime document commits now coalesce renderer `setDocument` work into the next animation frame, defer renderer tree rebuilds while pointer drags are active, flush the latest pending document before a new pointer interaction needs hit-testing, and log deferred/coalesced sync flushes with source/version/page context.
- Advanced the Skia image-rendering performance path: loaded images and LOD variants now generate default CanvasKit mipmaps, idle image draws use Skia sampling options with mipmap filtering, viewport/transform/marquee/drawing interactions switch to low-cost nearest sampling, transient shader/color-filter handles are released after being attached to paints, marquee rubber-band feedback moved to a DOM overlay so it no longer redraws image nodes, and transform interactions build a Skia offscreen background snapshot so subsequent drag frames redraw only the moving nodes plus overlays.
- Added viewport pan snapshot reuse for image-heavy canvases: viewport interactions now build an expanded Skia offscreen snapshot at the current zoom, reuse it while pan deltas stay inside the padding window, redraw only overlays/frame labels on cached pan frames, clear the cache on zoom/document/resize/background/asset changes, and log viewport-cache builds/clears for local diagnosis.
- Routed CanvasApi-driven viewport updates through the same interaction path: toolbar/keyboard/API zoom and scroll updates now switch the renderer to `viewport` mode before changing pan/zoom and schedule the idle restore afterward, so programmatic viewport changes do not redraw image-heavy canvases through the idle path.
- Added SkiaCanvas regression coverage asserting CanvasApi scroll/zoom updates enter renderer `viewport` interaction mode while background-only updates do not.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/pen-renderer test -- renderer-performance.test.ts image-loader.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx test/canvas-runtime-store.test.ts`.
- Passed: `pnpm exec biome check --write apps/web/src/components/canvas/skia-canvas.tsx apps/web/test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Failed: `pnpm --filter @cucumber/web test -- skia-canvas-selection-snapshot.test.tsx canvas-runtime-store.test.ts` was parsed by the package script as a broad web test run and hit existing unrelated failures in `apps/web/test/canvas-export.test.ts` legacy no-page fixtures plus `apps/web/test/projects.test.tsx` toast text matching; the corrected direct Vitest command above passed.

## 2026-05-31

- Fixed image node layer-blur rendering so the Skia renderer no longer leaves an extra canvas save on each blur layer, constrains blur saveLayer bounds to the node plus radius-based bleed, and logs invalid blur layer inputs with node/effect/render-mode context instead of producing an opaque blank canvas after viewport interactions settle.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Note: `pnpm --filter @cucumber/web build` still fails before app compilation because Next cannot fetch Google Font `Poppins` due to `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the local certificate chain.

## 2026-05-30

- Advanced the canvas performance slice: Skia renderer document sync now accepts the active page in a single call instead of triggering duplicate full-tree syncs, renderer text pre-measurement and frame labels now cache hot-path work, transform previews filter directly to visible nodes without cloning every render node, and multi-node move/delete/align/nudge paths can batch through a canvas transaction.
- Added the first runtime state-management foundation for the canvas: `zustand` + `immer` are wired into a tested vanilla canvas runtime store with fine-grained document, selection, viewport, selected-node, and undo/redo selectors so future panel/tool migrations can avoid rerendering the whole `SkiaCanvas`.
- Migrated `SkiaCanvas` core runtime state onto the Zustand/Immer store: document, active page, selection, active tool, history, version, and viewport snapshots now flow through store actions/subscriptions; toolbar, boolean toolbar, page tabs, and property panel consume selector-driven connected containers; keyboard shortcuts keep a stable listener through latest refs; and undo/redo now use past/future history semantics.
- Added patch-first live canvas protocol scaffolding: shared contracts now include canvas patch RPC params and `canvas.patch` stream events, the live editor exposes `canvas.document.patch` with version checks, and `LiveCanvasService` can send patch transactions without replacing the whole document.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts`.
- Passed: `pnpm --filter @cucumber/shared test`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-runtime-store.test.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-runtime-store.test.ts test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/shared typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` with the existing Next workspace-root multiple-lockfile warning.
- Passed: `pnpm lint`.
- Passed: `pnpm --filter @cucumber/server build`.
- Note: `pnpm --filter @cucumber/web build` currently fails before app compilation because Next cannot fetch Google Font `Poppins` due to `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the local certificate chain.

## 2026-05-29

- Advanced the canvas image-performance slice: Skia transform interactions now render transient previews during move/resize/rotate and commit the PenDocument only once on pointerup, marquee selection is RAF-throttled through renderer hit-test rectangles, renderer frames cull offscreen nodes before drawing, and image rendering chooses 512/1024/2048 display LOD variants during viewport/transform interactions while preserving original asset URLs.
- Advanced the canvas coordinate-system cleanup: renderer viewport conversion now has explicit client/local/scene helpers, nested canvas bounds resolve through exported scene helpers, Skia pointer gestures commit scene-space deltas at any zoom, and Canvas API viewport summaries read the live renderer pan/zoom while preserving legacy `scrollX` / `scrollY` aliases.
- Advanced the canvas text-tool interaction slice: Text Tool clicks now create Auto Width text and enter editing immediately, drags create fixed-width Auto Height text boxes, textarea editing resizes text bounds by growth mode, empty new text is removed on exit, Enter opens editing from selection mode, and selected text layers expose resize-driven growth-mode conversion.
- Advanced the P2.2 Figma property-panel fidelity closeout: image fills and stroke image paints expose editable crop/transform matrices, stroke paint stacks now share fill-layer controls, gradient stops can be added/removed/reordered by offset/color/opacity without degrading paint type, and focused plus constructed-fixture panel tests cover preservation of image metadata, stroke geometry, gradient types, mask/layout refs, rich text, vector diagnostics, and style/variable/component refs.
- Advanced the P2.2 component/token/vector editability closeout: component refs now expose structured variant/component/property assignment and override rows alongside JSON escape hatches; styleRefs/variableRefs resolve against document tokens with editable token values that do not overwrite inline node visuals; vector/path nodes expose boolean diagnostics, winding metadata, and validated path `d` editing with visible Chinese error reasons.
- Advanced the P2.2 layer-ordering validation slice: layer panel reorder semantics now match top-first rendering order for root and nested parents, Skia selection snapshots carry nested container context for hit-test synchronization, and focused canvas/layer tests cover root and nested forward/back/front/back behavior.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx test/canvas-layers-panel.test.tsx test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx`.
- Passed: `pnpm --filter @cucumber/pen-renderer test`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/node-renderer.test.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm lint`.
- Passed: `pnpm --filter @cucumber/web build` with existing Paper.js optional dependency warnings for `acorn` / `canvas`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: focused `pnpm exec biome check` for touched web/property-panel/layer/renderer/type/status files.
- Note: `pnpm exec biome check packages/canvas-core/src/__tests__/canvas-core.test.ts` still reports pre-existing `any` / non-null assertion diagnostics in that large legacy test file outside this slice.

## 2026-05-28

- Canvas 文件拖拽导入 landed: PNG/JPG/WebP/GIF/SVG 文件可直接拖到 Skia 画布区域，批量文件会拆成独立导入 payload 后按网格自动排列在释放点周围；SVG 文件复用现有矢量解析链路，位图复用资产导入链路，并补充 drop 诊断日志与不支持文件类型的明确提示。
- Agent runs no longer auto-create canvas process containers for every tool call; tool progress remains in chat/run stream events, while concrete image/video artifacts and backend live-canvas writes still sync to the canvas.
- The main Agent prompt now explicitly keeps plans, critiques, tool-call status, and intermediate process traces out of canvas containers unless the user asks for a final structured visual deliverable.
- Continued P2.2 Figma fidelity: Pen nodes now preserve node-level transform matrix/decomposed scale/skew/blend mode, visible hidden paint/effect layers, angular/diamond gradients, stroke dash offset/miter limit, corner smoothing, path fill rules, richer text font/style metadata, and the Skia renderer now draws visible rectangle fill stacks plus imported scale/skew transforms.
- Advanced the next P2.2 stroke/blend slice: Figma stroke paint stacks now preserve hidden layers for editability, Skia stroke rendering can consume solid/gradient paint metadata with paint-level blend modes, nodes with blendMode render through a CanvasKit saveLayer, and rectangles have a first-pass renderer for independent four-side stroke weights with inside/center/outside alignment.
- Advanced the P2.2 effects slice: Figma shadow color alpha is now represented as effect opacity instead of double-applied color alpha, ordered effect metadata has focused coverage, non-text nodes render all visible drop shadows, text renders multiple visible drop shadows, and rectangle/frame-like nodes get a first-pass clipped inner-shadow renderer.
- Advanced the P2.2 shape-aware shadow slice: non-text drop shadows now draw against node geometry instead of a generic rectangle, following rounded frame/rectangle/group corners, ellipse/arc outlines, polygon/star paths, vector paths, and image corner radii with offset/spread expansion where supported.
- Advanced the P2.2 inner-shadow geometry slice: non-text inner shadows now clip to and stroke node-specific geometry, so rounded rectangles, images, ellipses/arcs, polygons/stars, and vector paths use their actual shape instead of a generic rectangular inner-shadow approximation.
- Advanced the P2.2 backdrop-effects slice: Skia rendering now separates Figma `background_blur` from layer blur, uses CanvasKit backdrop filters through node shape/bounds clips, and keeps regular `blur` as a node-content ImageFilter so background sampling no longer blurs only the node itself.
- Advanced the P2.2 rounded-rect shape slice: Skia rectangle/frame/group fill, stroke, image-fill clipping, inner shadow clipping, and backdrop blur clipping now use a shared rounded-rectangle path that preserves Figma four-corner radii and applies a first-pass corner-smoothing control curve instead of collapsing everything to the top-left radius.
- Advanced the P2.2 independent-border slice: rectangle/frame/group strokes with four-side independent weights now preserve per-side thickness even when rounded corners are present, shortening side segments by the normalized corner radii and honoring inside/center/outside offsets instead of collapsing to a single max stroke width.
- Advanced the P2.2 editability slice: the renderer spatial index now treats visible angular/diamond/image/gradient paint layers, hidden retained paint layers, visible effect opacity, and center/outside independent stroke outsets consistently so imported Figma visuals are easier to hit-test without hidden layers creating phantom selections.
- Advanced the P2.2 rich-text slice: root and segment `textCase` are now preserved instead of only baked into content, spaced Figma font styles like `Semi Bold Italic` resolve to the intended weight, legacy native import forwards textCase into Pen nodes, and Skia Paragraph rendering now consumes per-segment lineHeight, letterSpacing, decoration, font fallback, OpenType features, and segment/root textCase.
- Advanced the P2.2 text font identity slice: Skia font loading now indexes native Local Font Access entries by exact PostScript name, registers those faces as CanvasKit aliases, and Paragraph rendering prioritizes root/segment `fontPostScriptName` before family-level fallbacks for closer Figma text matching.
- Advanced the P2.2 list/indent text slice: imported Figma `listStyle`, `indent`, and `hangingIndent` metadata now influences the rendered Paragraph text stream with ordered/unordered markers and stable first-line indentation without mutating the underlying Pen text content.
- Advanced the P2.2 paragraph/baseline text slice: imported root `paragraphSpacing` now becomes render-time paragraph gaps through extra line breaks, root `baselineShift` offsets Paragraph and Canvas2D fallback drawing, and segment baseline metadata participates in style/cache invalidation for future per-run layout.
- Advanced the P2.2 mask slice: `mask` is now a node-level Pen property, Figma `isMask` / `maskType` / `shouldBreakMaskChain` metadata is preserved through both `pen-figma` and the older `canvas-core` native path, and `pen-renderer` flattens mask layers into sibling clip regions so later layers in the same z-order chain are clipped by the mask bounds instead of rendering the mask layer itself.
- Advanced the P2.2 component-editability slice: Figma instance metadata now preserves structured override refs with GUID path, target node id, changed property names, and sanitized override values through both `pen-figma` and the legacy native path, instead of retaining only override counts/paths.
- Advanced the P2.2 auto-layout reflow slice: imported `fill_container` children on the main axis now implicitly participate in grow distribution even when no explicit grow value is present, so multi-child Figma fill layouts resize against the remaining frame space instead of keeping their stale imported widths.
- Advanced the P2.2 rich-text baseline slice: Skia Paragraph segment styles now carry a CanvasKit-compatible run-level baseline shift using the same Figma direction as root baseline offsets, so superscript/subscript-like styled runs no longer only affect cache invalidation.
- Advanced the P2.2 alpha-mask slice: flattening now propagates alpha mask strength from mask layer opacity and fill alpha, and Skia rendering applies that opacity inside the mask clip while vector masks remain shape-only clips.
- Advanced the P2.2 boolean/vector fallback slice: undecodable Figma boolean/vector nodes that still fall back to diagnostic rectangles now preserve structured vector metadata such as node type, boolean operation, normalized size, vector blob index, geometry counts, and winding rules through both `pen-figma` and legacy native imports.
- Advanced the P2.2 rich-text bitmap fallback slice: Canvas 2D fallback rendering now preserves non-wrapped styled text run font, fill, italic, and baseline metadata instead of flattening imported rich text to the root text style when Paragraph rendering cannot be used.
- Advanced the P2.2 image-fill transform slice: preserved Figma image crop transforms now feed a generalized CanvasKit shader matrix, so skewed/non-axis-aligned image fills and transformed tile fills keep their sampling transform instead of falling back to ordinary fit/fill/stretch drawing.
- Advanced the P2.2 auto-layout hug slice: imported `fit_content` auto-layout containers now reflow to numeric content-sized bounds after child layout, and positioning uses the hug-sized content area so centered/space-distributed children do not keep stale offsets from the pre-import frame size.
- Advanced the P2.2 nested auto-layout hug slice: when descendant auto-layout reflow changes child hug bounds, fit-content parents now re-run their own layout in the same pass so nested Figma hug stacks propagate content-sized dimensions without requiring a second manual reflow.
- Advanced the P2.2 group-opacity isolation slice: translucent imported frames/groups with children now become renderer opacity groups using a CanvasKit saveLayer alpha wrapper, so overlapping descendants are composited as a group instead of each child being individually alpha-multiplied.
- Advanced the P2.2 style-token editability slice: Pen documents can now preserve external style definitions, and `pen-figma` collects Figma fill/text/effect style nodes into document-level `styleDefinitions` so node `styleRefs` have editable token definitions in addition to inline visual values.
- Advanced the P2.2 multi-stroke-paint slice: Skia stroke rendering now draws every visible stroke paint layer in Figma bottom-to-top order across rectangles, ellipses/arcs, lines, polygons/stars, and vector paths, preserving hidden paint metadata without synthesizing phantom strokes.
- Advanced the P2.2 gradient-transform slice: Figma gradient paint transforms are now retained on Pen gradient fills, import derives linear handle endpoints plus radial/angular/diamond centers, radii, and angles from the transform, and Skia linear gradients render from preserved handle coordinates instead of collapsing to center-only angle math.
- Advanced the P2.2 image-crop import slice: Figma image fills with explicit `CROP` scale mode now import as Pen `crop` image fills instead of falling back to generic `fill` across both `pen-figma` and the legacy `canvas-core` native path, preserving crop semantics for the renderer's existing image transform shader path.
- Advanced the P2.2 legacy-gradient parity slice: the legacy `canvas-core` native Figma path now preserves gradient transform metadata, derives linear handles plus radial/angular/diamond geometry, and maps angular/diamond gradients to their Pen fill types instead of degrading them to radial metadata.
- Advanced the P2.2 legacy-effect parity slice: the legacy `canvas-core` native Figma path now retains hidden effect layers, separates shadow color alpha into effect opacity, and maps effect blend modes so fallback imports preserve editable multi-effect stacks like the primary `pen-figma` path.
- Advanced the P2.2 legacy-paint parity slice: the legacy `canvas-core` native Figma path now retains hidden fill/stroke paint layers, maps paint-level blend modes, and preserves stroke dash offset plus miter limit so fallback imports stay editable instead of flattening those stroke/fill details away.
- Advanced the P2.2 style-definition import slice: Figma clipboard and `.fig` imports now carry document-level `styleDefinitions` through `CanvasImportResult`, and `insertCanvasImportResult` merges them into `PenDocument.styleDefinitions` so node `styleRefs` keep editable token definitions instead of becoming orphan refs.
- Advanced the P2.2 variable-token import slice: Figma variable consumption refs now materialize into document-level variable placeholders during import, using inferred inline color values when available and unresolved string placeholders otherwise, so variable identities remain editable without inventing missing Figma token values.
- Advanced the P2.2 auto-layout baseline slice: imported horizontal auto-layout containers now honor baseline cross-axis alignment with a first-pass text-baseline approximation instead of treating Figma baseline as start alignment.
- Advanced the P2.2 legacy-ellipse-arc slice: the legacy `canvas-core` native Figma path now accepts Figma `arcData`, converts starting/ending radians plus inner radius into Pen ellipse `startAngle` / `sweepAngle` / `innerRadius`, and preserves those fields through final import insertion for renderer-side arc/donut rendering.
- Advanced the P2.2 component-reference diagnostics slice: native Figma component/instance warnings now report limited editability instead of claiming metadata was dropped, and the HTML fallback path preserves minimal `componentRef` fields for node id, component id/key, variant properties, and component property assignments when those attributes are present.
- Advanced the P2.2 HTML auto-layout fallback slice: styled Figma HTML fallback now detects absolute-positioned auto-layout children from CSS/metadata, preserves grow/alignSelf/sizing hints when present, and materializes absolute children as overlay Pen nodes so later reflow keeps their authored positions out of the main flow.
- Advanced the P2.2 legacy-image-fill diagnostics slice: unresolved image fills in the legacy `canvas-core` native Figma path now preserve `__hash:` / `__blob:` placeholders plus scale mode, original image size, transform matrix, visibility, opacity, and blend mode metadata instead of dropping the fill when image bytes are unavailable.
- Advanced the P2.2 vector-winding slice: decoded Figma vector paths now choose `evenodd` whenever any fill geometry subpath carries Figma's `ODD` winding rule, and the legacy native import path carries `fillRule` through `ImportNode` into final Pen path nodes instead of relying on default winding.
- Advanced the P2.2 legacy-text font identity slice: the legacy native Figma import path now carries root and rich-text segment `fontPostScriptName` through `ImportNode` into final Pen text nodes, so Skia's PostScript-aware font matching can work for fallback-decoded text as well as primary `pen-figma` imports.
- Advanced the P2.2 rich-text decoration fallback slice: Skia Paragraph styled runs now inherit root underline/strikethrough decoration when Figma segment overrides only change another text property, text caches include decoration flags, and Canvas 2D bitmap fallback draws root and per-run underline/strikethrough instead of dropping those visual details.
- Advanced the P2.2 image stretch parity slice: canonical image nodes now accept `objectFit: "stretch"`, and the Skia renderer uses a shared object-fit draw-rect helper so standalone image nodes can render stretch, fit, fill/crop, and tile modes consistently with Figma image fill semantics.
- Advanced the P2.2 explicit-mask-reference slice: `mask.sourceNodeId` is now consumed by the renderer flattener, resolving same-level editable mask source geometry plus alpha strength from source opacity and fill alpha while preserving the existing sibling mask-chain behavior.
- Advanced the P2.2 effect-opacity import slice: primary `pen-figma` and legacy native imports now preserve explicit Figma effect `opacity` fields in addition to shadow color alpha, so blur/background-blur opacity can reach the renderer's ordered saveLayer pipeline instead of being lost at conversion.
- Advanced the P2.2 variable-definition reconciliation slice: Figma import insertion now lets resolved imported variable definitions upgrade previous unresolved placeholders while preserving already-resolved user/document tokens, improving style/variable editability across repeated imports.
- Advanced the P2.2 component-override path slice: Figma component override refs now keep structured `pathIds` arrays in addition to string paths and target IDs through both `pen-figma` and the legacy native path, preserving nested instance override identity for later editable reconnect flows.
- Advanced the P2.2 negative-shadow-spread slice: Skia drop-shadow geometry now honors negative Figma spread values by shrinking shadow bounds with axis-safe clamping, and inner-shadow stroke width plus rounded shadow corners now use signed spread instead of treating negative values as zero.
- Advanced the P2.2 auto-layout stretch slice: imported container-level `alignItems: "stretch"` now survives HTML/Figma fallback parsing and participates in cross-axis sizing during auto-layout reflow, so children stretch to the content box instead of silently falling back to start alignment.
- Advanced the P2.2 layer-ordering acceptance slice: root and nested `reorderNode` now keep the Canvas API, layers panel, renderer order, and hit-testing aligned around the renderer's top-first Pen child order, with focused Web coverage for UI controls and API-driven hit-test changes.
- Advanced the P2.2 Figma line-cap slice: imported Figma line nodes with unspecified/`NONE` caps now keep butt-cap rendering instead of inheriting the renderer's legacy round-line fallback, while non-Figma canvas lines still keep the existing rounded fallback behavior.
- Advanced the P2.2 inspector UI fidelity slice: frame/group clip regions now carry four-corner radius and corner smoothing into the renderer flattener, and the canvas property panel exposes editable controls for stroke cap/join/dash/dash offset/four-side thickness/miter limit, clip content, four-corner radius, corner smoothing, and auto-layout stretch so Figma fidelity fields are visible and editable from the interface.
- Advanced the P2.2 fill/blend inspector slice: the canvas property panel now exposes node-level blend mode and editable multi-fill layers with per-layer visibility, opacity, blend mode, type switching across solid/linear/radial/angular/diamond/image fills, layer reordering, image fill mode, image URL/hash/blob placeholder editing, and original image size controls.
- Advanced the P2.2 paint-stack inspector slice: image fill and stroke image-paint layers now expose editable crop/transform matrices, gradient fill/stroke layers expose stop color/offset/opacity plus retained paint matrices, stroke paints use the same visible/opacity/blend/type/reorder/remove stack editing as fills while preserving independent stroke geometry, and renderer gradient stop opacity is now honored.
- Advanced the P2.2 effects inspector slice: the canvas property panel now edits ordered effect stacks with add/remove/reorder, per-effect visibility, opacity, blend mode, type switching across drop shadow, inner shadow, layer blur, and background blur, plus shadow color/offset/blur/spread and blur radius controls.
- Advanced the P2.2 transform/shape inspector slice: the canvas property panel now exposes scale/skew and full affine transform matrix editing, plus shape-specific controls for ellipse arc start/sweep/inner radius, polygon vs star settings, polygon start angle/inner radius/corner radius, line endpoints, and path fill-rule/closed state.
- Advanced the P2.2 text inspector slice: text nodes now expose editable PostScript font identity, vertical alignment, auto-resize mode, text case, paragraph spacing, list style, indent/hanging indent, baseline shift, font fallback, OpenType feature flags, strikethrough, and styled segment controls for text, font family, PostScript name, font size, letter spacing, baseline shift, text case, and per-segment fill.
- Advanced the P2.2 layout/reference inspector slice: the canvas property panel now exposes sizing modes, child positioning, self alignment, grow, layout clipping, four-side auto-layout padding, group isolation, node masks, style refs, variable refs, and component identity/variant/property/override metadata so preserved Figma editability fields are visible in the UI.
- Advanced the P2.2 component-override inspector slice: component refs now have structured editors for variant properties, component properties, property assignments, and override rows with path, pathIds, targetId, properties, and JSON values, while retaining the existing JSON advanced-edit escape hatch for bulk edits.

## 2026-05-27

- Cucumber canvas and Agent structure cleanup landed: the removed local reference tree stays deleted, ignored pen package `node_modules` residue is removed, structured canvas tooling now uses Cucumber module naming, and runtime canvas paths now fail fast when content is not a `PenDocument` with `pages` plus a valid `activePageId`.
- The next development order is now documented as canvas foundation and performance first, then canvas tools/container types, then Agent live-canvas read/write completeness, then Agent runtime workflow tuning.
- B0 Cucumber canvas foundation cleanup supersedes the old parity-oriented notes; current docs treat Cucumber's canvas stack as its own product substrate rather than a deleted local reference source.
- B-stage AI-native canvas collaboration started: Agent runs now build a typed `agent-context-v1` with prompt layers, run-scoped Styleguide context, AgentTeams roles, and model capability profiles before the model call.
- B1 Prompt layering + Styleguide injection thin slice landed: runtime injects `<agent_run_context>` alongside existing canvas, attachment, mention, and generation preference XML so complex canvas work is constrained by stable user goal/project/style/layout/task/critique layers.
- B2 process visualization event spine landed: shared stream events now include `run.context` and role-aware `agent.stage` events around prompt preparation and tool execution, giving the UI/replay layer typed planning/task/process milestones without scraping assistant text.
- B3 AgentTeams foundation landed: the Deep Agents runtime now registers Planner, Designer, Critic, Coder/Exporter, and Researcher sub-agents in addition to the existing video specialist, and the system prompt instructs complex canvas generation to use the team protocol.
- Phase A Cucumber canvas editor controls completed for the live canvas: page-aware
  canvas operations, page tabs, editor toolbar, and boolean toolbar are in place.
- Phase B Cucumber canvas design-system slice completed for the live canvas:
  component instances, document variables/themes, and a render-backed icon
  library are available from the canvas bottom bar.
- Phase C Cucumber structured canvas orchestration design approved for an
  end-to-end thin slice: prompt-to-canvas planning, bounded concurrent
  container materialization, and React/HTML/Vue export.
- Phase C Cucumber structured canvas thin slice started: prompt-to-canvas planning/execution
  MCP tools now materialize live canvas containers, and direct codegen export
  supports Vue alongside React and HTML.
- B0 editor-ui parity advanced: the layers row now has dedicated coverage,
  readable failures, and an accessible hierarchy move path; the shape toolbar
  only exposes icon insertion when a real callback is wired, and property-panel
  parity remains P1 until effects/path/line-specific limits are verified.
- B0 import parity closed for SVG/raster paste: the browser import harness now
  verifies unsupported SVG warning metadata in selected diagnostics and raster
  image paste asset metadata/node linkage without inventing warnings for
  full-fidelity image imports.
- B0 toolbar icon insertion parity closed: the production canvas page now wires
  the toolbar `Insert icon` affordance through `CanvasEditor`/`SkiaCanvas` to
  the existing Design System Icons tab/search, preserving
  `CanvasDesignSystemPanel` as the only icon insertion implementation.
- Toolbar icon insertion review follow-up fixed: repeated toolbar activations
  now carry an explicit tab request key, so an already-open Design System panel
  returns to Icons/search after the user manually switches to another tab.
- B0 editor draw/select/move coverage narrowed: the Skia harness browser smoke
  now covers rectangle/ellipse/polygon drag creation, text/line/arrow click
  creation, path pen creation, selected-id snapshotting, and selected polygon
  move. The matrix row remains P1 because resize and rotate handle gestures are
  still under-verified.
- B0 editor draw/select/move/resize/rotate coverage closed: the real
  `/test/canvas-engine` Playwright smoke now covers selected rectangle SE
  resize and selected polygon rotate gestures with deterministic geometry and
  selection assertions. Production behavior already passed, so this was a
  coverage/docs-only closeout.
- B0 property panel parity closed: focused inspector tests now cover effects
  toggles/value updates, path paint/effects partial updates, and line-specific
  limits; line nodes keep stroke/effects editing without exposing unsupported
  fill controls.
- Property panel review follow-up tightened effects coverage so enabling or
  disabling shadow/blur from existing effects arrays preserves the unrelated
  effect. Existing production behavior passed those tests without changes.
- B0 design-system parity closed: focused panel tests now cover unsafe
  component unset protection when refs point to a reusable frame, unsafe
  variable delete protection while a node fill references `$accent`, theme-axis
  removal, and lucide icon insertion renderability through the icon node plus
  `lookupCanvasIcon` contract. Existing production behavior passed without
  runtime changes.
- B0 agent-generation parity closed: `/test/canvas-agent-output` now exercises
  an open `SkiaCanvas` session with a preserved manual node, applies a
  prompt-canvas-shaped Agent output document through `CanvasApi.setDocument`,
  and verifies durable root/section container metadata plus generated-root
  selection coherence in Playwright.
- Agent-generation review follow-up closed: the real
  `prompt_canvas_execute` server contract now asserts root/section
  `agentBinding.toolName`, `createdByAgentId`, and `explain` trace context on
  the actual persisted nodes, so the done row no longer relies on the Web
  fixture alone for metadata coverage.
- B0 MCP parity closed: live Cucumber structured canvas canvas MCP tools now keep
  node/parent/snapshot/placement reads scoped to the requested page, reject
  missing pages, page-local anchors, and file-backed calls with concrete
  errors, apply `batch_design` atomically including invalid parent/delete
  rejection, and expose page management plus B0 layered design
  (`design_skeleton`, `design_content`, `design_refine`) tools against the live
  editor document, including scoped new-page materialization,
  intentional empty-frame preservation, and conflicting content-ID
  normalization.
- B0 export parity closed: Web SVG export now computes concrete warning
  metadata for unsupported node types, missing image sources, image fills,
  gradient fills, and rich-text flattening; screenshot RPC returns those
  warnings to Agent-visible callers, and MCP `codegen_export` returns warning
  metadata alongside React/HTML/Vue files.
- B0 verification parity closed: the Skia canvas browser harness now covers
  layers selection/locking, property-panel edits, selection export warning
  metadata, and remount persistence, and the final Playwright matrix runs that
  path together with import and Agent-output smokes.

## Current Session

Goal: finish the Skia/CanvasKit canvas migration by extracting the public CanvasApi contract, closing the missing editing/import parity gaps, moving the import harness onto Skia, and removing the old React DOM canvas runtime.

Status:

- Extracted the canvas-facing public contract into `apps/web/src/components/canvas/canvas-api.ts`, and moved editor panels, chat/sidebar integrations, page code, hooks, and harnesses off the deleted render implementation.
- SkiaCanvas now owns recursive copy/cut/paste/duplicate/delete, system clipboard import, SVG import, image asset registration, generated image insertion, keyboard shortcuts, selection notification, marquee selection, resize handles, and rotate handles behind the stable CanvasApi.
- Migrated `/test/canvas-import` to SkiaCanvas so import and vector-shape smoke coverage now exercises the production renderer path.
- Removed the old `apps/web/src/components/canvas/canvas-surface.tsx` implementation and the stale migration helper that targeted it.
- Documented the product position that the canvas is the visual artifact of Agent execution, containers are structured Agent outputs, and spatial relationships express context, reasoning, and data flow.
- Added two concrete product scenarios: generated-image second-pass editing via contextual Agent overlay/quick actions, and stronger Figma-like editing for structured outputs such as PPT, web pages, and UI screens.
- Updated the main Agent system prompt so visual or structured work should create containerized canvas results, while respecting user manual edits as follow-up context.
- Updated the feature registry summaries for the AI-native canvas workspace and Cucumber Canvas runtime to align with the Agent-first positioning.
- Preserved existing manual creation and editing surfaces; these remain user controls for arranging, refining, and giving feedback on Agent-generated results.
- Added `@cucumber/canvas-core` with the new `CucumberCanvasDocument` model, container nodes, context resolution, typed operation errors, permission checks, and focused unit tests.
- Replaced the web canvas editor surface with `SkiaCanvas` / `CanvasApi` while preserving the existing Studio shell, side panels, bottom bar, chat sidebar, and artifact insertion hooks.
- New documents save directly as Cucumber canvas content. Legacy Excalidraw payloads are treated as empty new documents rather than migrated.
- Containers can be created, selected, dragged, resized, renamed, assigned context rules, and bound to an Agent from the inspector.
- Image/video artifacts now insert through the new canvas API and land in the selected container when one is selected.
- `inspect_canvas` can summarize new Cucumber canvas documents, including container tree, effective context, Agent binding, filtering, and node lookup.
- `manipulate_canvas` now writes `CanvasOperation` updates against new canvas documents with permission and bounds enforcement, instead of mutating only legacy Excalidraw-style `elements`.
- Agent-generated image/video results now insert into the new canvas document model from both runtime and background job paths.
- `SkiaCanvas` now includes the first native tool batch: hand/pan mode, in-canvas image upload, image resize with visible bounds overlay, and lightweight line/arrow nodes rendered directly from the new document model.
- Added P0 native editing affordances: multi-select, marquee selection, undo/redo history, keyboard shortcuts, recursive copy/paste/duplicate/delete, and layer lock/visibility/reorder controls.
- Moved shared canvas behavior for ordered traversal, marquee hit-testing, recursive clipboard clone/paste, and document history into `@cucumber/canvas-core` so the web surface calls headless helpers instead of owning those document mutations directly.
- Added the first P1 native editing slice: generic property panel, ellipse/polygon/path/icon nodes, 8-way resize, rotate handles, group/ungroup, selection alignment, and grid snap guides.
- Moved P1 document mutations for grouping, ungrouping, alignment, selection bounds, and new shape node schemas into `@cucumber/canvas-core`, keeping `SkiaCanvas` as the interaction adapter.
- Continued the P1 editing hardening pass by splitting keyboard shortcuts and clipboard import handling out of `SkiaCanvas`, adding a tree-style layers panel with rename/drag-sort/action menu support, and exposing copy/cut/paste/SVG import actions from the canvas menu.
- Added the first P2 import slice: system clipboard parsing for SVG/Figma-like payloads, normalization into `CucumberCanvasDocument` nodes/assets inside `@cucumber/canvas-core`, centered placement on the current viewport, warning toasts, and history-tracked insertion.
- Upgraded the P2 import slice with stronger provenance metadata (`importSessionId`, source/origin fields, degradation hints, warning counts), richer Figma HTML fallback grouping, aggregated compatibility warnings, and a page-level import summary that surfaces warning counts instead of only a single toast.
- Added focused coverage for import metadata persistence in `canvas-core` and for the web clipboard-import hook behavior around paste interception and clipboard API fallback.
- Started the first P2.2 high-fidelity Figma clipboard pass: `@cucumber/canvas-core` now has a native-first fig-kiwi parser path that extracts base64 clipboard buffers, decodes the binary payload, maps common Figma frame/text/shape/vector/image nodes into `PenNode`, and only falls back to the previous HTML/SVG path when native decode is unavailable or invalid.
- Added parser support files and dependency wiring for native Figma clipboard decode inside `packages/canvas-core`, plus focused tests that cover clipboard extraction and invalid-native-payload fallback behavior.
- Continued P2.2 with a second batch focused on `SYMBOL / INSTANCE` fidelity: native import now collects symbol trees, merges inherited master props into instances, and replays direct override / derived data onto inlined instance children before mapping them into editable `PenNode` output.
- Added focused `canvas-core` coverage for symbol prop merging and instance override replay so the new instance path is verified without requiring full clipboard binary fixtures.
- Continued P2.2 with a third batch focused on nested instance fidelity: native import now resolves multi-segment `guidPath` entries, maps virtual outer-path GUIDs onto actual nested instance nodes, and forwards the remaining override / derived payload into child instances for recursive replay.
- Added focused `canvas-core` coverage for nested instance path propagation so multi-layer override payloads are verified without needing a large clipboard binary fixture.
- Continued P2.2 with a fourth batch focused on auto-layout fidelity: imported Figma nodes and Figma-like HTML fallback nodes now preserve normalized layout metadata such as direction, gap, padding, alignment, sizing mode, clip behavior, and child grow/align-self hints inside import metadata, while warnings now clarify that the runtime still renders static geometry.
- Added a browser-side canvas import harness route plus a Playwright smoke scaffold for real paste events, then fixed the shared `tests/e2e` Next webServer bootstrap by launching from `apps/web` and forcing `NODE_ENV=development` so Tailwind/PostCSS initialize correctly in Playwright.
- Re-enabled the real-paste `canvas-import` smoke, verified the existing `transport` smoke against the same webServer, and confirmed the full `tests/e2e` suite now runs cleanly instead of failing on the old CSS/Tailwind base issue.
- Taught the editor to consume imported auto-layout metadata: `@cucumber/canvas-core` now exposes a pure reflow helper that reapplies imported layout hints onto child geometry, while `SkiaCanvas` uses it for imported layout roots on bounds changes and the property panel now surfaces/imports those hints with a manual "应用布局" action.
- Switched agent canvas tooling to the live editor path: opened canvases bind their WebSocket connection with `canvas.bind`, expose document get/set RPC, and `inspect_canvas` / `manipulate_canvas` now require the live editor instead of mutating legacy Excalidraw payloads.
- Added the production migration path that resets non-`cucumber-canvas-v1` canvas content to the canonical Cucumber canvas document default, matching the decision to drop legacy Excalidraw canvas data.
- Ported the Cucumber canvas rubber-band vector shape drawing interaction into `SkiaCanvas` for rectangle, ellipse, and polygon tools, including in-canvas preview, shift-constrained square drawing, native node insertion, and diagnostic logs.
- Fixed the canvas toolbar arrow active state and normalized quick-insert shape paint payloads so newly inserted shapes render/edit through the same native fill/stroke schema as dragged shapes.
- Added e2e coverage for the canvas harness shape tools so native rectangle, ellipse, and polygon drag creation is regression-tested alongside clipboard import coverage.
- Corrected the active production editor path: `CanvasEditor` currently uses `SkiaCanvas`, so the same Cucumber canvas drag-to-draw interaction is now implemented in the Skia toolbar/runtime as well, with a dedicated `/test/canvas-engine` harness and smoke coverage.
- Copied the Cucumber canvas bounded screenshot/export capability into the live Cucumber canvas path: `screenshot_canvas` now resolves `full`, `viewport`, and explicit `region` requests into scene-space bounds, returns `actualBounds`, and exports the requested bounding box instead of always sending the whole canvas.
- Added a shared bounds-aware `canvas-export` helper used by both `SkiaCanvas` and `SkiaCanvas`, plus focused coverage for document bounds, export scaling, and explicit bounding-box SVG output.
- Updated screenshot artifact persistence to preserve SVG screenshots as `image/svg+xml` instead of labeling all canvas captures as PNG.
- Tightened the Skia editor interaction chain after the render/layout review: Figma/system paste now lets native paste events carry HTML payloads when the internal canvas clipboard is empty, imported `rect` nodes normalize to renderable `rectangle` nodes, and single-quoted Figma clipboard attributes are decoded.
- Fixed selected-node editing ergonomics in the Skia path by keeping property-panel and toolbar events from bubbling into canvas hit-testing, binding the panel directly to PenNode fields, and making the path/pen tool create a visible path from the same drag bounds used by its preview.
- Moved Skia canvas editing overlays out of React DOM and into the shared CanvasKit renderer: selection bounds, resize/rotate handles, marquee selection, shape drag previews, and pen previews now draw in the same render pass as canvas content, while resize/rotate hit-testing runs through renderer scene coordinates.
- Removed the legacy React DOM / Excalidraw / Pixi shadow runtime remnants: deleted the old `@cucumber/engine`, `@cucumber/container`, `@cucumber/renderer`, and `@cucumber/ui` workspace packages, removed legacy shadow e2e harnesses and old migration plan docs, and kept the production Skia/CanvasKit canvas path as the only active renderer.
- Added focused keyboard shortcut coverage for paste behavior, plus targeted Figma clipboard extraction/import regression checks.
- Added the first Cucumber structured canvas live canvas agent tool slice: `batch_design`, `batch_get`, `snapshot_layout`, and `find_empty_space` are now registered as MCP tools, operate through `LiveCanvasService`, and let the main Agent perform DSL-style batch editing/reading against the current Cucumber `PenDocument` without changing the durable canvas schema.
- Continued the Cucumber canvas migration with Figma/style/codegen parity slices: the live MCP tool set now includes `import_figma_clipboard`, Cucumber canvas `read_nodes`, variables/theme tools, recursive style search/replace, and in-memory codegen plan/submit/assemble/clean routes, while the Skia property panel can bind selected node colors to document variables.
- Hardened Figma/system paste fidelity by capturing all readable clipboard MIME text, preferring native Figma/SVG payloads when present, mapping Figma auto-layout directly onto PenNode layout props, and extending the SVG fallback to preserve transforms, style rules, gradient defs, masks/clip warnings, text style, effects, and line endpoints.
- Extended the import fidelity pass to clipboard file/blob capture and raster image paste assets, Cucumber-aligned Figma stroke/fill/text/image-fill mapping, executable PenNode sizing for imported auto-layout, SVG specificity/descendant style resolution, `<use>` expansion, simple clipPath frames, and filter-to-effect mapping with explicit warnings for unsupported mask/filter/clip cases.
- Corrected the live paste fallback priority so invalid/unsupported Figma native buffers no longer immediately return the lossy Figma HTML parser before explicit `image/svg+xml` or raster MIME payloads, and added clipboard MIME diagnostics for browser-side paste troubleshooting.
- Changed HTML-only paste events to opportunistically merge Clipboard API MIME data during the same user paste action, so Figma/browser clipboard paths that expose richer SVG/image/blob payloads through `navigator.clipboard.read()` are no longer limited to the paste event's `text/html` / `text/plain` surface.
- Expanded runtime paste diagnostics to show the concrete Figma import strategy (`figma-native` vs `figma-html-fallback`), warnings, asset/root counts, and a sanitized node summary for debugging fidelity regressions from real user clipboard payloads.
- Restored high-fidelity Figma paste around Cucumber's full `pen-figma` module: added `@cucumber/pen-figma` as a vendored workspace package, routed native clipboard decode through its parser/converters, recursively attaches Cucumber import metadata, registers data URL image assets, and offsets full native PenNode trees on insertion so nested geometry stays aligned.
- Advanced codegen assembly from protocol-only state to concrete design-as-code file output: `codegen_assemble` now returns framework-specific files for React (`App.tsx`, component files, CSS), HTML (`index.html`, CSS), and generic framework fallbacks, and the property panel now includes typography controls plus reusable component/ref metadata and inline color variable creation/binding.
- Added a dedicated `codegen_export` MCP tool so the Agent can export the current live canvas selection, or explicit node IDs, directly into React (`.tsx` + CSS) or static HTML (`index.html` + CSS) design-as-code files with diagnostic logging.
- Added the first Phase C prompt-to-canvas orchestration slice: `prompt_canvas_plan` creates deterministic section plans, `prompt_canvas_execute` writes root/section containers through the live canvas service with structured `[phase-c-orchestration]` logs, and `codegen_export` now emits Vue single-file component output alongside React and HTML.
- Hardened Figma paste editing fidelity after real-canvas drag issues: pasted frame/group selections can be dragged from visible descendants, clipped children no longer steal hits outside their visible clip, line endpoints render correctly inside nested imported frames, and dragged layers automatically detach to the parent scope once their center leaves a frame/group while preserving scene coordinates.
- Fixed native canvas drawing/reparent ergonomics: line, arrow, and Frame tools now drag out geometry with live previews instead of click-inserting default shapes; arrows render arrowheads, Frames default to clipped artboards, and dragged nodes enter/leave Frames by mouse drop position while preserving scene coordinates.
- Continued Figma restoration fidelity across the Pen model, pen-figma import, canvas-core style resolution, and Skia rendering: imported nodes retain hidden/ordered paint and effect layers for editability, node transforms/blend metadata, corner smoothing, path winding, richer text segment metadata, stroke dash/miter data, rectangle multi-fill rendering, and visible scale/skew transform drawing.
- Continued the stroke/blend rendering pass: `pen-figma` no longer drops hidden stroke paints, stroke mapping keeps independent border weights plus dash/miter metadata, and `pen-renderer` now applies blend modes on fill/stroke paints and node layers while drawing gradient strokes and four-side rectangle borders.
- Continued effect fidelity: `pen-figma` now preserves shadow opacity without baking alpha into the color string, focused effect tests cover ordered drop shadow / inner shadow / background blur metadata, and `pen-renderer` draws multiple drop shadows plus clipped inner shadows instead of only the first outer shadow.
- Continued text fidelity: `pen-figma` preserves root/segment textCase and richer segment metrics, `canvas-core` forwards textCase through the older native import path, and `pen-renderer` applies segment-level line height, letter spacing, decoration, fallback fonts, OpenType features, and textCase during vector paragraph rendering.
- Continued mask/clip fidelity: Figma mask layers now survive import as editable node metadata, the legacy native import path carries the same mask fields, and document flattening applies mask-chain clipping to subsequent sibling layers with focused renderer coverage.

## Next Targets

1. Render `run.context` and `agent.stage` in a canvas process/replay panel, including planning trace, task graph, critique/fix passes, and export artifacts.
2. Persist run event history for replay/resume, then add human-in-the-loop controls for plan approval, styleguide edits, locked containers, redo requests, and critique accept/reject.
3. Extend model profile/router from a single active-model profile to role-specific model selection once multiple configured models are available.
4. Add deterministic browser/e2e smoke coverage for create container, bind Agent, insert generated content, refresh restore, and basic tool interactions.
5. Add deterministic browser smoke coverage for selection export, refresh restore, layers/property edits, and persistence around Agent-created containers.
6. Design the selected-result Agent overlay and quick-action contract for image upscale, outpaint, local edit, and variant generation.
7. Continue P2.2 by collecting real Figma clipboard fixtures for native `pen-figma` regression coverage, especially nested instances, image fills, text style hints, and vector boolean edge cases.
8. Expand deterministic browser/e2e coverage for system paste from SVG/Figma clipboard content, including nested component instances, the compatibility summary, and the fallback path now that the shared test webServer is healthy again.
9. Decide whether to harden `apps/web/next.config.ts` for local multi-lockfile setups with `outputFileTracingRoot` / `allowedDevOrigins`, or keep those as known non-blocking dev warnings for now.
10. Continue P1 canvas parity with richer path/icon editing, reference guides, advanced snapping, shape-specific handles, and more complete property controls.
11. Build the next P2 layers on top of the new import provenance metadata: richer reusable component/ref editing, variables/design tokens, and export-to-project handoff flows.

## Handoff Notes

- Existing worktree changes under `apps/server/src/app.ts` and `apps/server/src/http/sse.ts` predate this canvas runtime implementation. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` changed in this session because legacy workspace packages and the old Pixi renderer dependency graph were removed.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.

## Verification Log

- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx` (8 tests).
- Passed: `pnpm --filter @cucumber/web typecheck` (with existing Next.js workspace-root warning about multiple lockfiles).
- Passed: `pnpm exec biome check apps/web/src/components/canvas/skia-canvas.tsx apps/web/src/components/canvas/use-canvas-clipboard-import.ts apps/web/test/use-canvas-clipboard-import.test.tsx`.
- Failed: `pnpm lint` remains blocked by existing unrelated Biome diagnostics outside this change, including `apps/server/src/agent/backends/dev.ts`, `apps/server/src/agent/backends/prod.ts`, `apps/server/src/agent/persistence/index.ts`, `apps/server/src/agent/tools/brand-kit.ts`, `apps/server/src/agent/real-image-generation-chain.integration.test.ts`, `tests/e2e/transport.spec.ts`, and `vercel.json`.
- Passed: `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts`.
- Passed: `pnpm exec playwright test tests/e2e/canvas-agent-output.spec.ts`.
- Passed: `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/structured-canvas.test.ts` (20 tests).
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-export.test.ts` (15 tests).
- Passed: `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts -g "smokes layers" --workers=1`.
- Passed: `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts tests/e2e/canvas-agent-output.spec.ts --workers=1` (8 tests).
- Passed: `pnpm exec biome check apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/web/src/components/canvas/canvas-export.ts apps/web/test/canvas-export.test.ts apps/web/src/components/canvas-editor.tsx`.
- Passed: `pnpm exec biome check apps/web/src/app/test/canvas-agent-output/page.tsx apps/web/src/app/test/canvas-agent-output/canvas-agent-output-harness.tsx tests/e2e/canvas-agent-output.spec.ts docs/tech/cucumber-canvas-foundation.md progress.md feature_list.json` (Biome checked the configured source/spec files; Markdown/JSON docs are ignored by the current Biome config).
- Passed: `pnpm exec biome check tests/e2e/skia-canvas.spec.ts docs/tech/cucumber-canvas-foundation.md progress.md` (Biome checked the configured spec file; Markdown docs are ignored by the current Biome config).
- Failed: `pnpm --filter @cucumber/web typecheck` remains blocked by the unchanged out-of-scope `apps/web/src/components/canvas/skia-canvas.tsx:388` `PenNode` to `Record<string, unknown>` cast diagnostic.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-editor-toolbar.test.tsx test/canvas-layers-panel.test.tsx test/canvas-property-panel.test.tsx`.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/shape-tool-dropdown.tsx apps/web/src/components/canvas-layers-panel.tsx apps/web/test/canvas-editor-toolbar.test.tsx apps/web/test/canvas-layers-panel.test.tsx docs/tech/cucumber-canvas-foundation.md progress.md`.
- Failed: `pnpm --filter @cucumber/web typecheck` remains blocked by the unchanged out-of-scope `apps/web/src/components/canvas/skia-canvas.tsx:388` `PenNode` to `Record<string, unknown>` cast diagnostic.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-editor-toolbar.test.tsx test/canvas-layers-panel.test.tsx test/canvas-property-panel.test.tsx`.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/editor-toolbar.tsx apps/web/src/components/canvas/shape-tool-dropdown.tsx apps/web/src/components/canvas-layers-panel.tsx apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/test/canvas-editor-toolbar.test.tsx apps/web/test/canvas-layers-panel.test.tsx apps/web/test/canvas-property-panel.test.tsx docs/tech/cucumber-canvas-foundation.md progress.md`.
- Failed: `pnpm --filter @cucumber/web typecheck` remains blocked by the out-of-scope `apps/web/src/components/canvas/skia-canvas.tsx:388` `PenNode` to `Record<string, unknown>` cast diagnostic.
- Passed: `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`.
- Passed: `PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests` from `apps/server` after adding Phase C prompt-to-canvas orchestration and Vue export coverage.
- Passed: `./node_modules/.bin/biome check apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/server/src/agent/prompts/cucumber-main.ts docs/tech/canvas-design-integration.md progress.md feature_list.json`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-design-system-panel.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck` (Next emitted the existing multi-lockfile workspace-root warning).
- Passed: `pnpm exec biome check apps/web/src/components/canvas-design-system-panel.tsx apps/web/src/components/canvas/icon-library.ts apps/web/src/components/canvas-bottom-bar.tsx apps/web/src/components/canvas/skia-canvas.tsx apps/web/src/app/canvas/page.tsx apps/web/test/canvas-design-system-panel.test.tsx docs/tech/canvas-design-integration.md progress.md feature_list.json`.
- Passed: temporary Next dev smoke on `http://localhost:3003/login` returned HTTP 200; dev mode fell back from Geist after the same local issuer certificate warning.
- Failed: `pnpm --filter @cucumber/web build` remains blocked by the local certificate chain while `next/font` fetches Geist from Google Fonts (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`).
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-figma test` (13 tests).
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check` on the touched `pen-types`, `pen-figma`, `canvas-core`, and `pen-renderer` files.
- Passed: `pnpm --filter @cucumber/pen-figma test` (14 tests).
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm exec biome check packages/pen-renderer/src/node-renderer.ts packages/pen-renderer/src/paint-utils.ts packages/pen-figma/src/figma-stroke-mapper.ts packages/pen-figma/src/figma-stroke-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma test` (15 tests).
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm exec biome check --write packages/pen-renderer/src/node-renderer.ts packages/pen-renderer/src/text-renderer.ts packages/pen-figma/src/figma-effect-mapper.ts packages/pen-figma/src/figma-effect-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma test` (16 tests).
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check --write packages/pen-types/src/pen.ts packages/pen-figma/src/figma-text-mapper.ts packages/pen-figma/src/figma-text-mapper.test.ts packages/pen-renderer/src/text-renderer.ts packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma test` (17 tests).
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/document-flattener.test.ts --environment jsdom` (2 tests).
- Passed: `pnpm exec biome check --write packages/pen-types/src/pen.ts packages/pen-figma/src/converters/common.ts packages/pen-figma/src/converters/__tests__/converters.test.ts packages/pen-renderer/src/types.ts packages/pen-renderer/src/document-flattener.ts packages/pen-renderer/src/document-flattener.test.ts packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/figma-native-types.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts apps/web/src/components/canvas/use-canvas-clipboard-import.ts apps/web/test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "preserves imported frame layout"`.
- Failed: full `pnpm --filter @cucumber/canvas-core test` remains blocked by existing document-model expectation mismatches in `packages/canvas-core/src/__tests__/canvas-core.test.ts`.
- Passed: static legacy runtime scan for active sources after cleanup; only AGENTS framework guidance and Skia/CanvasKit HTMLCanvasSurface references remain.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web test`.
- Blocked: `pnpm install --lockfile-only` was rejected by the current no-approval execution policy, so the old workspace and Pixi lockfile entries were removed manually.
- Failed: `pnpm --filter @cucumber/canvas-core test` remains blocked by existing document-model expectation mismatches in `packages/canvas-core/src/__tests__/canvas-core.test.ts`.
- Failed: targeted `pnpm exec biome check` remains blocked by pre-existing diagnostics in `apps/web/src/components/chat-sidebar.tsx` and `apps/server/src/features/canvas/canvas-element-writer.ts`.
- Blocked: Playwright Skia smoke using a temporary port 3002 config hit an existing Next dev SSR error in `class-variance-authority` vendor chunk after the root config first hit port 3000 in use.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/web test -- use-canvas-clipboard-import.test.tsx use-canvas-keyboard-shortcuts.test.tsx`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --dir packages/canvas-core exec vitest run src/__tests__/canvas-core.test.ts -t "extracts figma clipboard"`.
- Passed: `pnpm --dir packages/canvas-core exec vitest run src/__tests__/canvas-core.test.ts -t "inserts imported nodes"`.
- Passed: targeted `pnpm exec biome check --write` for the touched Skia canvas, property panel, keyboard shortcut, Figma native, and import files.
- Failed: full `pnpm lint` remains blocked by unrelated existing diagnostics in `deleted cucumber tracked files`, `apps/server/src/agent/backends/dev.ts`, `apps/server/src/agent/persistence/index.ts`, and `apps/server/src/agent/deep-agent.ts`.
- Passed: targeted `pnpm exec biome check` for `apps/web/src/components/canvas/canvas-api.ts`, `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas-editor.tsx`, `apps/web/src/app/test/canvas-import/canvas-import-harness.tsx`, `tests/e2e/canvas-import.spec.ts`, `docs/architecture.md`, `progress.md`, and `feature_list.json`.
- Passed: local Playwright smoke against `http://localhost:3002` for `/test/canvas-engine` and `/test/canvas-import`, covering Skia rectangle/ellipse/polygon drag creation plus Figma-like paste import metadata.
- Note: direct `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts` is blocked by the current root `playwright.config.ts` pointing at `playwright-tests/tests`, so those files are not discovered by that config.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: targeted diagnostics for `packages/canvas-core/src/types.ts`, `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/figma-native-types.ts`, `packages/canvas-core/src/figma-native.ts`, `packages/canvas-core/src/__tests__/canvas-core.test.ts`, `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas-editor.tsx`, `apps/web/src/app/test/canvas-import/**`, `tests/e2e/canvas-import.spec.ts`, and `playwright.config.ts`.
- Passed: `pnpm exec playwright test tests/e2e/transport.spec.ts`.
- Passed: `pnpm exec playwright test tests/e2e/canvas-import.spec.ts`.
- Passed: `pnpm exec playwright test tests/e2e`.
- Passed: `pnpm --filter @cucumber/canvas-core test -- canvas-core.test.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: Playwright smoke on a clean `http://localhost:3001/test/canvas-import` dev server drew rectangle, ellipse, and polygon nodes through toolbar selection plus drag gestures.
- Passed: `pnpm exec playwright test canvas-import.spec.ts` using a temporary Playwright config pointed at the clean `http://localhost:3001` dev server.
- Passed: `pnpm exec playwright test skia-canvas.spec.ts` using a temporary Playwright config pointed at a clean `http://localhost:3002` dev server.
- Passed: `pnpm exec biome check apps/web/src/app/test/canvas-engine/page.tsx apps/web/src/app/test/canvas-engine/canvas-engine-harness.tsx tests/e2e/skia-canvas.spec.ts`.
- Partial: `pnpm exec biome check apps/web/src/components/canvas/skia-canvas.tsx` remains blocked by pre-existing diagnostics in the same file, including explicit `any`, non-null assertions, and SVG title warnings.
- Note: `http://localhost:3000` was already occupied by a stale/incorrect Next server whose `_next/static` chunks returned 404, so interactive verification used port 3001.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm install --no-frozen-lockfile` after adding native Figma clipboard parser dependencies to `packages/canvas-core`.
- Passed: targeted diagnostics for `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas-layers-panel.tsx`, `apps/web/src/components/canvas-logo-menu.tsx`, `apps/web/src/components/canvas-editor.tsx`, and new canvas import helper files.
- Passed: targeted `pnpm exec biome check --write` for touched P1 canvas-core and web canvas files.
- Passed: Playwright smoke opened `http://localhost:3000/canvas`; unauthenticated flow redirected to `/login` with no browser console/page errors.
- Passed: targeted diagnostics for `apps/web/src/components/canvas/skia-canvas.tsx` and `packages/canvas-core/src/types.ts`.
- Passed: targeted diagnostics for `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/types.ts`, `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`, `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas-editor.tsx`, `apps/web/src/app/canvas/page.tsx`, `apps/web/src/components/canvas-logo-menu.tsx`, and new clipboard import tests.
- Passed: targeted server tests for `manipulate-canvas` and `canvas-element-writer`, plus new canvas-core bounds regression coverage.
- Passed: `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`.
- Passed: `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`.
- Passed: `./node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit`.
- Passed: `PATH=/usr/local/bin:$PATH ../../node_modules/.bin/vitest run test/canvas-export.test.ts` from `apps/web`.
- Passed: `./node_modules/.bin/biome check apps/web/src/components/canvas/canvas-export.ts apps/web/test/canvas-export.test.ts packages/shared/src/ws-protocol.ts apps/server/src/agent/tools/screenshot-canvas.ts apps/web/src/components/canvas-editor.tsx`.
- Note: the default Codex Node path could not run Vitest because Rollup's native optional dependency was rejected by macOS code signing; rerunning with `/usr/local/bin/node` first in `PATH` passed.
- Blocked: `PATH=/usr/local/bin:$PATH ./node_modules/.bin/turbo run build --filter @cucumber/web` could not start because Turbo could not find the package manager binary in this shell (`pnpm` is not on PATH).
- Failed: `pnpm --filter @cucumber/server typecheck` is still blocked by pre-existing `apps/server/src/http/sse.test.ts` missing the required `webOrigin` option for `registerSseRoutes`.
- Failed: full `pnpm --filter @cucumber/web test` remains blocked by the pre-existing React 19 / Testing Library `React.act is not a function` issue across legacy web tests; the new clipboard-import focused test passes when run in isolation.
- Failed: root `pnpm lint` remains blocked by unrelated pre-existing/untracked files, primarily `deleted cucumber tracked files`, server formatting drift, and existing `apps/server/src/agent/deep-agent.ts` explicit `any` diagnostics.
- Passed: `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`.
- Passed: `PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests` from `apps/server`.
- Passed: `./node_modules/.bin/biome check apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/server/src/mcp/server.ts apps/server/src/agent/prompts/cucumber-main.ts`.
- Passed: `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`.
- Passed: `PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests` from `apps/server` after adding style/variable/codegen coverage.
- Passed: `./node_modules/.bin/biome check apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/server/src/mcp/server.ts apps/server/src/agent/prompts/cucumber-main.ts apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/src/components/canvas/skia-canvas.tsx progress.md feature_list.json`.
- Passed: `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`.
- Passed: `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`.
- Passed: `PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests` from `apps/server` after adding codegen file assembly coverage.
- Passed: `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`.
- Passed: `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`.
- Passed: `PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests` from `apps/server` after adding `codegen_export` selection/export coverage.
- Passed: `./node_modules/.bin/biome check --write apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/mcp/server.ts apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/src/components/canvas/skia-canvas.tsx progress.md feature_list.json`.
- Passed: final no-write `./node_modules/.bin/biome check apps/server/src/mcp/tools/structured-canvas.ts apps/server/src/mcp/tools/structured-canvas.test.ts apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/mcp/server.ts apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx apps/web/src/components/canvas/skia-canvas.tsx progress.md feature_list.json`.
- Passed: `pnpm exec biome check apps/web/src/components/canvas/skia-canvas.tsx packages/pen-renderer/src/renderer.ts packages/pen-renderer/src/types.ts packages/pen-renderer/src/index.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web test -- canvas-export use-canvas-keyboard-shortcuts`.
- Passed: `pnpm --filter @cucumber/web build`.
- Failed: root `pnpm typecheck` remains blocked by unrelated existing `packages/pen-core/__tests__` NodeNext extension, implicit-any, and possibly-undefined diagnostics.
- Failed: root `pnpm lint` remains blocked by unrelated existing diagnostics in `deleted cucumber tracked files`, server formatting drift, `vercel.json`, and `apps/server/src/agent/deep-agent.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` (Next emitted the existing multi-lockfile workspace-root warning).
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` (Next emitted the existing multi-lockfile workspace-root warning).
- Passed: `pnpm --filter @cucumber/web exec vitest run test/skia-canvas-selection-snapshot.test.tsx test/use-canvas-clipboard-import.test.tsx`.
- Failed: root `pnpm lint` remains blocked by unrelated existing diagnostics in `deleted cucumber tracked files`, `apps/server/src/agent/backends/dev.ts`, `apps/server/src/agent/persistence/index.ts`, and `apps/server/src/agent/deep-agent.ts`.
- Failed: `pnpm --filter @cucumber/web test -- skia-canvas-selection-snapshot.test.tsx use-canvas-clipboard-import.test.tsx` was parsed by the package script as a broad web test run and hit the existing `test/projects.test.tsx` toast text assertion (`项目创建失败` vs `项目创建失败：Create failed.`); the corrected direct Vitest command above passed.
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts apps/web/src/components/canvas/use-canvas-clipboard-import.ts`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "figma|svg|clipboard|layout"`; SVG parser cases are skipped in the default non-DOM environment.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --environment jsdom --testNamePattern "SVG|raster|auto-layout|clipboard|layout"`.
- Passed: `pnpm --filter @cucumber/web build` (Next emitted the existing multi-lockfile workspace-root warning and metadataBase warning).
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-figma test`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts src/__tests__/figma-native-adapter.test.ts --environment jsdom --testNamePattern "figma|clipboard|layout|image|pen-figma"`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm exec biome check packages/pen-figma packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/__tests__/figma-native-adapter.test.ts apps/web/next.config.ts apps/web/tsconfig.json tsconfig.base.json packages/canvas-core/package.json pnpm-lock.yaml biome.json`.
- Blocked: `pnpm install` / `pnpm install --offline --lockfile-only` were rejected by the current no-approval execution policy, so workspace lockfile entries for `@cucumber/pen-figma` were updated manually and local verification used ignored node_modules symlinks.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --environment jsdom --testNamePattern "SVG MIME|Figma native decode"`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` (Next emitted the existing multi-lockfile workspace-root warning).
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts apps/web/src/components/canvas/use-canvas-clipboard-import.ts apps/web/src/components/canvas/skia-canvas.tsx apps/web/test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --environment jsdom --testNamePattern "figma|svg|clipboard|layout"`.
- Note: including `packages/canvas-core/src/__tests__/canvas-core.test.ts` in Biome still reports existing `any` / non-null assertion diagnostics in that test file; those were not changed as part of the paste fallback fix.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --environment jsdom --testNamePattern "SVG MIME|Figma native decode"`.
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts apps/web/src/components/canvas/use-canvas-clipboard-import.ts apps/web/src/components/canvas/skia-canvas.tsx apps/web/test/use-canvas-clipboard-import.test.tsx`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` (Next emitted the existing multi-lockfile workspace-root warning).
- Passed: `pnpm --filter @cucumber/web build` (Next emitted the existing multi-lockfile workspace-root warning and metadataBase warning).

2026-05-27 - Canvas legacy residue audit

- Deleted the unused `@cucumber/pen-engine` workspace package after confirming it had no production imports or active harness entry; removed its web dependency, transpile package entry, TypeScript path aliases, and lockfile importer.
- Kept the active canvas harnesses (`/test/canvas-engine`, `/test/canvas-import`, `/test/canvas-agent-output`) because each still has a page entry and deterministic Playwright coverage.
- Moved Skia's ad hoc runtime document extension away from the local `CanvasRuntimeDocument` type and into explicit `CanvasApiDocument` / `CanvasApiRuntimeState` contracts in `apps/web/src/components/canvas/canvas-api.ts`.
- Added a focused CanvasApi type assertion so runtime selection state remains visible at the API boundary.
- Passed: `pnpm --filter @cucumber/web typecheck` and `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: related canvas tests: `pnpm --filter @cucumber/web exec vitest run test/canvas-api-types.test.ts test/use-canvas-clipboard-import.test.tsx test/use-canvas-keyboard-shortcuts.test.tsx test/canvas-export.test.ts`, `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts src/__tests__/figma-native-adapter.test.ts --environment jsdom --testNamePattern "figma|svg|clipboard|layout|image|pen-figma"`, and `pnpm --filter @cucumber/server exec vitest run src/mcp/tools/structured-canvas.test.ts --passWithNoTests`.
- Passed: Playwright smoke `pnpm exec playwright test tests/e2e/skia-canvas.spec.ts tests/e2e/canvas-import.spec.ts tests/e2e/canvas-agent-output.spec.ts --workers=1` after updating the smoke to use drag-based line/arrow creation and stable property-panel spinbutton targeting.
- Passed: touched-file Biome check for canvas runtime/API/config/test files. Full `pnpm lint` remains blocked by unrelated existing diagnostics in `deleted cucumber tracked files`, `vercel.json`, and server agent files; full `pnpm typecheck` remains blocked by unrelated existing `packages/pen-core/__tests__` NodeNext extension/strictness diagnostics.

2026-05-28 - Figma fidelity style-reference slice

- Added editable Figma style and variable reference preservation on Pen nodes via `styleRefs` and `variableRefs`, while keeping the existing inline visual values for rendering.
- Extended pen-figma conversion to carry `styleIdForFill`, `styleIdForStrokeFill`, `styleIdForText`, `styleIdForEffect`, and `variableConsumptionMap` through normal nodes and instance overrides.
- Extended legacy canvas-core Figma import metadata to keep the same style/variable references and materialize them onto imported Pen nodes.
- Added `componentRef` metadata to preserve Figma component/instance identity, target component IDs, component keys, and override counts through primary pen-figma conversion and the legacy native import path.
- Extended `componentRef` with variant properties, component property definitions/values, instance property assignments, and concrete override GUID paths so future editing can reconstruct which instance overrides map to which master nodes.
- Extended Figma text fidelity mapping for paragraph spacing, paragraph/list indent, list style, baseline shift, OpenType feature flags, and font fallback families on both root text nodes and styled text segments; legacy native import now materializes the same root text fields into imported Pen nodes.
- Added `layoutRef` and `meta.autoLayout` preservation for pen-figma PenNode output so direct native imports retain Figma auto-layout direction, gap, padding, baseline alignment, hug/fill/fixed sizing modes, child grow/stretch, absolute child positioning, and clip metadata for future editable reflow.
- Added renderer-side ancestor opacity propagation so group/frame opacity affects descendant render nodes, and preserved Figma pass-through versus isolated container blending via `isolated` metadata.
- Updated Skia node rendering to keep every visible layer/background blur effect instead of only the first one, applying the ordered blur stack with per-effect opacity and blend mode metadata.
- Tightened component instance inheritance so master frame metadata now carries more high-fidelity visual fields into inlined instances, including blend mode, effects, stroke dash/miter details, independent border weights, corner smoothing, style references, variable references, and mask-chain metadata.
- Extended Skia fill rendering so rectangles, ellipse arcs, ellipses, polygons, and vector paths draw all visible fill layers in Figma stack order instead of only the first visible fill; each layer keeps opacity and blend metadata through paint creation.
- Extended deferred image fill drawing beyond rectangles by clipping fit/fill/stretch/crop image paints to ellipse, arc ellipse, polygon, and vector path shapes; deferred image paints now also carry paint-level blend modes.
- Added renderer support for preserved full Figma affine transform matrices by converting node-level 2x3 matrices into CanvasKit 3x3 transforms without double-applying existing `x/y` placement, while keeping decomposed scale/skew/rotation for nodes without full matrices.
- Added editable Figma `REGULAR_POLYGON` / `STAR` conversion instead of vector fallback: Pen polygon nodes now preserve polygon kind, point count, star inner radius, fills, strokes, effects, smoothing, and full common Figma metadata; Skia rendering now draws star polygons and respects imported path fill rules before falling back to close-count heuristics.
- Aligned Figma `LINE` conversion with the shared node metadata path so imported lines now keep full transform matrices, scale/skew decomposition, visible/locked, node blend mode, mask metadata, style refs, variable refs, layout refs, and component refs instead of only x/y/rotation/opacity.
- Added Skia image stroke paint support: image-filled strokes now use CanvasKit image shaders for fill/fit/stretch/tile/crop mappings, including preserved crop transforms, tile repeat, opacity, blend mode, and image adjustment filters instead of disappearing when stroke fills are images.
- Added closed-shape stroke alignment rendering for rectangles, rounded rectangles, ellipse arcs, ellipses, polygons/stars, and closed vector paths by doubling inside/outside stroke widths and clipping them to the inside or outside of the shape; open lines now preserve imported stroke caps instead of always forcing round caps.
- Fixed star polygon rendering to use all alternating outer/inner points instead of only the outer point count.
- Extended rich text segment fills from a legacy single color string to editable `fills` paint stacks, so Figma per-segment solid/gradient/image fill layers retain visibility, opacity, blend mode, and image metadata through both `pen-figma` and the legacy native import path; Skia text rendering now resolves segment colors from the preserved fill stack while keeping the old `fill` shortcut for compatibility.
- Added Skia text-box vertical alignment rendering for imported Figma text nodes: `top`, `middle`, and `bottom` alignment now offset glyph drawing against the fixed text box height in both Paragraph and Canvas2D fallback paths instead of always pinning text to the top edge.
- Upgraded Skia angular gradient fills from radial fallback to native CanvasKit sweep gradients, preserving imported center, opacity, stop order, blend mode, and Figma/CSS angle mapping for fills and gradient stroke paints that share the fill-paint path.
- Hardened `pen-figma` image resource resolution so `__blob:N` and `__hash:<hex>` image nodes/fills convert to data URLs in both browser and Node runtimes, while unresolved image references remain intact for renderer diagnostics instead of being silently dropped.
- Extended Figma image resource resolution and diagnostics to stroke image fills as well as node fills, so image-backed strokes using `__blob:N` or `__hash:<hex>` are resolved to data URLs when embedded resources are available and counted in unresolved-image warnings when they are not.
- Extended the legacy `canvas-core` native Figma fallback path so imported intermediate nodes carry preserved full transform matrices, decomposed scale/skew, flip flags, and node blend modes through insertion into final PenNodes, matching the higher-fidelity `pen-figma` path more closely when fallback decoding is needed.
- Upgraded renderer mask clipping from bounds-only masks to bounds plus preserved mask geometry for ellipse, arc ellipse, polygon/star, and vector path masks, so later sibling layers are clipped by the actual vector mask shape instead of only the mask layer rectangle.
- Upgraded Skia diamond gradient fills from radial fallback to a CanvasKit RuntimeEffect diamond-distance shader when available, preserving Figma center, radius, angle, opacity, stop positions, and colors for fills and gradient stroke paints that reuse the fill-paint path; unsupported RuntimeEffect environments still fall back to radial rendering.
- Added PostScript-aware text font loading for Figma imports: Local Font Access entries are indexed by exact PostScript name, registered as CanvasKit aliases, and root/segment Paragraph font chains prioritize `fontPostScriptName` before family-level fallbacks.
- Added a first-pass rendered text layout approximation for Figma lists and paragraph indents: plain and styled text streams now gain ordered/unordered markers plus first-line indentation at render time while preserving the original editable content model.
- Added first-pass rendered paragraph spacing and root baseline-shift support for Figma text imports, plus cache invalidation awareness for segment-level baseline shifts pending a future precise rich-text run layout.
- Upgraded background blur rendering so Figma `background_blur` effects route through CanvasKit backdrop filters clipped to the node's preserved shape/bounds, while normal `blur` effects remain layer filters on the node content itself.
- Upgraded rounded rectangle rendering to preserve independent per-corner radii and use imported `cornerSmoothing` as a cubic control-factor approximation across fills, strokes, image-fill clips, backdrop blur clips, and inner-shadow clips.
- Upgraded non-text drop shadows to render from node-specific geometry rather than always drawing a rectangle, improving Figma shadow fidelity for rounded rectangles, ellipses/arcs, polygons/stars, vector paths, and rounded images.
- Upgraded non-text inner shadows to reuse node-specific shape paths for clipping and offset stroke drawing, improving Figma fidelity for rounded rectangles, ellipses/arcs, polygons/stars, vector paths, and rounded images.
- Upgraded independent four-side border rendering on rounded rectangles so imported Figma side weights are retained with radius-aware side segments and stroke alignment offsets rather than being reduced to one uniform maximum-width outline.
- Upgraded the legacy `canvas-core` native Figma path to preserve hidden fill/stroke paint layers, paint-level blend modes, stroke dash offset, and stroke miter limit for fallback imports.
- Upgraded Figma clipboard and `.fig` import results to carry document-level style definitions into inserted Pen documents, preserving editable style token definitions alongside node-level style references.
- Upgraded Figma variable refs into imported Pen document variables with source/id/property metadata; color values are inferred from inline paint values when possible, while unknown variable definitions remain explicit unresolved placeholders for later token reconciliation.
- Upgraded imported horizontal auto-layout reflow to align children on an approximated text baseline, with non-text children using their bottom edge as the baseline, improving Figma baseline layout fidelity for mixed text/control rows.
- Upgraded legacy native Figma ellipse conversion to preserve arc geometry and inner radius through `ImportNode` and final Pen ellipse nodes, matching the primary `pen-figma` arc path more closely.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/converters/__tests__/converters.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/figma-text-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/document-flattener.test.ts --environment jsdom`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/node-renderer.test.ts src/document-flattener.test.ts --environment jsdom`.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/figma-effect-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/text-renderer.test.ts src/node-renderer.test.ts src/document-flattener.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/node-renderer.test.ts src/text-renderer.test.ts src/document-flattener.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/figma-image-resolver.test.ts src/figma-fill-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-figma typecheck`.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/figma-image-resolver.test.ts src/figma-fill-mapper.test.ts src/figma-stroke-mapper.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/figma-native-adapter.test.ts --environment jsdom`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --environment jsdom --testNamePattern "preserves imported frame layout|Figma|figma"`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/document-flattener.test.ts src/node-renderer.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/node-renderer.test.ts`.
- Passed: `pnpm exec biome check packages/pen-renderer/src/node-renderer.ts packages/pen-renderer/src/node-renderer.test.ts`.
- Passed: `git diff --check -- packages/pen-renderer/src/node-renderer.ts packages/pen-renderer/src/node-renderer.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/text-renderer.test.ts`.
- Passed: `pnpm exec biome check --javascript-formatter-enabled=false packages/pen-renderer/src/font-manager.ts`.
- Passed: `pnpm exec biome check packages/pen-renderer/src/text-renderer.ts packages/pen-renderer/src/text-renderer.test.ts progress.md feature_list.json`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "paint layer|hidden stroke|gradient transform|effect layers"`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/figma-native.ts packages/canvas-core/src/figma-native-types.ts`.
- Note: `pnpm exec biome check packages/canvas-core/src/__tests__/canvas-core.test.ts` still reports pre-existing `any` / non-null assertion diagnostics in that large test file outside this slice.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts src/__tests__/figma-native-adapter.test.ts --testNamePattern "style definitions|native clipboard|Figma style|paint layer|hidden stroke"`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/figma-native-adapter.test.ts --environment jsdom`.
- Passed: `pnpm --filter @cucumber/pen-figma test`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/figma-native-types.ts packages/canvas-core/src/__tests__/figma-native-adapter.test.ts packages/pen-figma/src/figma-clipboard.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "style definitions|variable refs|paint layer|hidden stroke"`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm exec biome check packages/pen-types/src/variables.ts packages/canvas-core/src/import.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "baseline|absolute-positioned|fill-container|hug auto-layout"`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/layout.ts`.
- Passed: `git diff --check -- packages/canvas-core/src/layout.ts packages/canvas-core/src/__tests__/canvas-core.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "ellipse arc|style definitions|baseline"`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/figma-native-types.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/import.ts`.
- Passed: `git diff --check -- packages/canvas-core/src/figma-native-types.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/import.ts packages/canvas-core/src/__tests__/canvas-core.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "PostScript font identity|frame layout"`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm exec biome check packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts progress.md feature_list.json`.
- Note: `pnpm exec biome check packages/canvas-core/src/__tests__/canvas-core.test.ts` still reports pre-existing `any` / non-null assertion diagnostics in that large test file outside this slice.
- Passed: `git diff --check -- packages/canvas-core/src/import.ts packages/canvas-core/src/figma-native.ts packages/canvas-core/src/__tests__/canvas-core.test.ts progress.md feature_list.json`.
- Passed: `pnpm --filter @cucumber/pen-renderer exec vitest run src/text-renderer.test.ts --testNamePattern "bitmap fallback|TextBaseline|TextVertical|paragraph"`.
- Passed: `pnpm --filter @cucumber/pen-renderer typecheck`.
- Passed: `pnpm exec biome check packages/pen-renderer/src/text-renderer.ts packages/pen-renderer/src/text-renderer.test.ts progress.md feature_list.json`.
- Passed: `git diff --check -- packages/pen-renderer/src/text-renderer.ts packages/pen-renderer/src/text-renderer.test.ts progress.md feature_list.json`.

2026-06-02 - Layout constraints runtime boundary

- Added `layoutConstraints` to Pen node contracts as the child runtime constraint truth for sizing mode, flow positioning, self alignment, and grow.
- Migrated legacy `layoutRef` during normalization so parent container layout fields land on `ContainerProps`, child runtime constraints land on `layoutConstraints`, and `layoutRef` is removed from normalized nodes.
- Switched pen-core layout computation to read parent layout from `ContainerProps` and child sizing/flow/align/grow from `layoutConstraints`, with absolute children excluded from flow and fit-content non-content shapes falling back to their fixed size.
- Switched canvas-core imported auto-layout reflow to use `ContainerProps + layoutConstraints` instead of `meta.autoLayout`; Figma/HTML import paths now write runtime fields directly while keeping `meta.autoLayout` as diagnostics.
- Updated the property panel so “布局约束” only becomes editable when the selected node has a horizontal/vertical auto-layout parent; otherwise it shows the gray unavailable hint, and clipping remains under appearance via `clipContent`.
- Passed: `pnpm --filter @cucumber/pen-core exec vitest run __tests__/layout-engine.test.ts __tests__/normalize.test.ts`.
- Passed: `pnpm --filter @cucumber/canvas-core exec vitest run src/__tests__/canvas-core.test.ts --testNamePattern "layout|auto-layout|figma"`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-property-panel.test.tsx`.
- Passed: `pnpm --filter @cucumber/pen-figma exec vitest run src/converters/__tests__/converters.test.ts`.
- Passed: `pnpm --filter @cucumber/pen-types typecheck`.
- Passed: `pnpm --filter @cucumber/canvas-core typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Note: `pnpm --filter @cucumber/pen-core typecheck` remains blocked by existing strict indexed-access diagnostics in untouched pen-core test files such as `__tests__/node-diff.test.ts`, `__tests__/node-merge.test.ts`, `__tests__/normalize-tree-layout.test.ts`, and `__tests__/tree-utils.test.ts`; touched pen-core files no longer appear in that failure list.

2026-06-03 - Agent screenshot tool registration fix

- Fixed Agent runs failing with LangChain `todoListMiddleware` tool identity errors by removing the legacy direct `screenshot_canvas` registration from the main Agent tool list; `screenshot_canvas` now has one runtime source through the MCP bridge.
- Updated Agent prompts and run critique rules so structured canvas reads use `inspect_canvas_semantic`, `get_selection_context`, `batch_get`, `snapshot_layout`, and `validate_canvas` first; `screenshot_canvas` is reserved for visual verification and evidence.
- Removed the unused deprecated `createPhaseATools` export, marked `inspect_canvas` as a legacy exact-field reader, marked `manipulate_canvas` as a simple imperative editor, and updated image/video placement descriptions to use `canvas_state`, `find_empty_space`, `batch_get`, or `snapshot_layout` instead of `inspect_canvas`.
- Improved `run.failed` client diagnostics with safe failure reason classification and redacted diagnostic summaries, so future Agent failures do not collapse to an opaque retry message.
- Passed: `pnpm --filter @cucumber/server test -- run src/agent/tools/index.test.ts src/agent/run-failure.test.ts src/utils/error-sanitizer.test.ts src/mcp/deepagents-bridge.test.ts` (workspace Vitest configuration ran 37 server test files / 134 tests).
- Passed: `pnpm --filter @cucumber/server typecheck`.

2026-06-03 - Agent canvas execution chain default prompt

- Updated the main Agent prompt so design, generation, and canvas editing tasks default to writing the minimal execution chain and final result into the canvas instead of waiting for the user to explicitly request "show it on the canvas"; pure text tasks remain chat-only.
- Aligned `agent_run_context` critique rules with the same boundary: canvas execution chain is the default product surface for visual/generation work, while run events remain diagnostic and waiting-state support.
- Added prompt regression coverage for the default canvas-chain behavior and the pure-text no-tool boundary.
- Passed: `pnpm --filter @cucumber/server test -- run src/agent/prompts/cucumber-main.test.ts src/agent/orchestration-context.test.ts` (workspace Vitest configuration ran 38 server test files / 136 tests).
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm exec biome check apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/server/src/agent/orchestration-context.ts apps/server/src/agent/orchestration-context.test.ts feature_list.json progress.md`.
- Passed: `git diff --check -- apps/server/src/agent/prompts/cucumber-main.ts apps/server/src/agent/prompts/cucumber-main.test.ts apps/server/src/agent/orchestration-context.ts apps/server/src/agent/orchestration-context.test.ts feature_list.json progress.md`.

2026-06-04 - Canvas-first Agent input refactor

- Removed the right ChatSidebar from the Canvas page runtime surface and moved Agent input to a bottom `CanvasAgentComposer` backed by a headless `useAgentRunController`.
- Changed the bottom toolbar into a left vertical rail while keeping existing canvas controls, popovers, zoom, background, layers, files, and design-system entry points.
- Added draft user-goal node write-back from bottom input: non-empty input creates a durable `user_goal` node, edits update its Agent meta/card presentation, and clearing an unsent draft deletes it.
- Added compact send chain creation: send marks the user-goal node done, creates one downstream `agent_execution` node, connects/selects it, and sends `canvasEntry.userGoalNodeId/agentExecutionNodeId` through `RunCreateRequest`.
- Added client-side stream write-back for run/stage/thinking/message/tool/terminal events so the single `agent_execution` node is the streaming execution meta truth; tool outputs may attach artifact node IDs.
- Updated Agent runtime/prompt handling for compact canvas entries so Agents do not recreate the old multi-node entry chain, and added video generation target/agent execution protocol fields for direct canvas delivery tracing.
- Follow-up UX audit fixed attachment-only dead sends, duplicate-send risk while a send is in flight, local run-start failures leaving the canvas node stuck at `Thinking...`, stale ChatSidebar comments, and too-narrow mobile composer width.
- Passed: `pnpm --filter @cucumber/canvas-core test`.
- Passed: `pnpm --filter web exec vitest run test/canvas-agent-composer.test.tsx test/canvas-agent-execution-stream-writeback.test.ts test/canvas-page-toolbar-icon.test.tsx test/chat-input.test.tsx --reporter=dot`.
- Passed: `pnpm --filter web typecheck`.
- Passed: `pnpm --filter server typecheck`.
- Note: the broad command `pnpm --filter web test -- canvas-agent-composer canvas-agent-execution-stream-writeback canvas-page-toolbar-icon chat-input` still sweeps in legacy `chat-sidebar.test.tsx`, whose existing assertions look for the old English placeholder `/start with an idea/i`; the precise target files above pass.
