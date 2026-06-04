# AI Native Canvas Agent Capability Plan

Last updated: 2026-06-04 CST

This is the implementation plan for making Cucumber Studio's canvas AI-native. It builds on the current capability inventory in [`canvas-tooling-capability-map.md`](./canvas-tooling-capability-map.md).

The goal is not to let the Agent click every UI control. The goal is to let the Agent reliably operate every durable canvas outcome:

1. Read the current live canvas as semantic workspace context.
2. Plan a bounded edit against the latest live document.
3. Preview and validate the edit before or after commit.
4. Write structured, container-first results into `PenDocument.pages`.
5. Continue from user manual edits, selection, assets, and prior Agent outputs.

For the product/runtime boundary that fuses Figma-like direct editing with
Flowith-like node execution semantics, use
[`canvas-node-figma-fusion.md`](./canvas-node-figma-fusion.md). This plan should
only add Agent capabilities that operate on that shared `PenNode` tree, not a
parallel workflow graph or Agent-only canvas state.

## Non-Negotiable Runtime Boundary

The only durable canvas truth remains:

- `PenDocument.pages`
- `PenDocument.activePageId`
- `PenNode` fields under the active or specified page
- `PenDocument.variables`
- `PenDocument.themes`
- `PenDocument.styleDefinitions`
- `PenDocument.assets`

Do not introduce a parallel Agent-only canvas state, hidden metadata source, compatibility fallback, or second layout truth.

Allowed boundary-only inputs:

- Import metadata from Figma/SVG/clipboard.
- Diagnostic metadata used for debugging or inspector display.
- Migration inputs that are normalized immediately into current runtime truth.

Forbidden core paths:

- Reading legacy root `children` as runtime canvas truth.
- Falling back from missing new fields to old fields inside render, service, Agent, or UI edit paths.
- UI controls that write fields not consumed by renderer/layout/persistence/Agent tools.
- Agent tools that silently mutate stale persisted canvas data when the live editor is unavailable.

## Agent Execution Canvas Schema

Flowith-like Agent execution UX is represented on the same durable
`PenDocument.pages` node graph. The fine-grained execution role is stored on
`PenNode.meta.agentExecution` with `schemaVersion: 1`; it is not a parallel
Agent-only state source and it does not expand `containerRole` beyond the
existing coarse runtime roles.

Supported execution node kinds:

- `user_goal`: the user's original goal or brief.
- `recipe_plan`: the live Recipe / plan that explains how the Agent will work.
- `task_step`: one actionable step inside the Recipe.
- `tool_call`: a visible tool invocation or waiting tool result.
- `evidence`: referenced source, asset, search result, or knowledge seed.
- `variant_branch`: one branch in a multi-variant exploration.
- `critique`: review findings, validation results, and suggested fixes.
- `ask_user_more`: a blocking request for user input or missing files.
- `checkpoint`: a restart/fork point.
- `final_deliverable`: the final user-facing output container.

Current status:

- Shared helper/schema exists in `packages/canvas-core/src/agent-execution.ts`.
  `withAgentExecutionNodeSemantics` is the shared boundary for newly created
  execution nodes that need durable `meta.agentExecution` plus top-level
  `runId`, `sessionId`, `agentBinding`, non-empty `containerRole`, and execution
  `contextSlots` on the same `PenNode`. `create_agent_execution_flow`,
  `create_agent_ask_user_more`,
  `create_agent_evidence`, and `create_agent_variant_branches` use this helper
  so user-goal, Recipe, task/tool, ask, evidence, branch, comparison, critique,
  checkpoint, and final-deliverable creation paths share the same semantic
  binding contract before UI controls read or act on those nodes.
  `getAgentExecutionNodeSemanticUpdates` is the matching update boundary for
  existing execution nodes; `record_agent_tool_call`,
  `record_agent_critique`, and `record_agent_final_deliverable` use it so
  status, tool-call output/failure, critique findings, and final delivery
  completion/failure keep `meta.agentExecution` and top-level
  run/session/agent/container-role semantics synchronized on the same `PenNode`.
- `create_agent_execution_flow` creates a generic durable chain for complex
  design, structured canvas editing, or continuation-oriented work: user goal,
  Recipe, task steps, optional tool calls, critique, final deliverable, and
  checkpoint nodes, all connected by semantic line nodes. Created execution
  cards now persist both `upstreamNodeIds` and derived `downstreamNodeIds` in
  `meta.agentExecution`, so the Web inspector, continuation drafts, and saved
  Recipe extraction can read the same bidirectional chain from the durable page
  nodes instead of reconstructing it from run trace.
- Simple image-generation work now uses that same
  `create_agent_execution_flow` chain instead of a separate flow tool. The
  optimized prompt is represented by a task/tool-call step, `generate_image`
  targets the returned `finalDeliverableNodeId`, and the image job carries the
  returned `toolCallNodeIds` entry as `agentExecutionNodeId` so tool result
  write-back and final delivery stay anchored to the unified execution graph.
- `create_agent_ask_user_more` creates a durable `ask_user_more` execution
  node when the Agent needs user text, file, image, brand material, or
  confirmation before continuing. The waiting prompt and `acceptsFiles` flag are
  stored in `PenNode.meta.agentExecution.waitingForUser`; when an upstream
  execution node is provided, the tool also updates that node's
  `downstreamNodeIds` and inserts a semantic connector so the property panel and
  run-control waiting state have a real canvas anchor.
- `create_agent_evidence` creates durable `evidence` nodes for URLs, assets,
  canvas-node references, text notes, or search results. Provenance lives on
  `PenNode.meta.agentExecution.evidence` with source type, URL/asset/node IDs,
  optional labels, and confidence, and the tool can link evidence to an upstream
  execution node so sources become spatial canvas context instead of chat-only
  references. The Web property panel now renders this provenance as a dedicated
  evidence source section with source type/name, URL/asset/node IDs,
  confidence, and an open-link action when a URL exists.
- `record_agent_tool_call` writes tool execution results back into an existing
  durable `tool_call` or `task_step` node after the tool runs. It updates visible
  node text plus `meta.agentExecution.details`, status, tool call ID, and
  failure recovery fields, making tool input/output/error context inspectable in
  the property panel instead of leaving it only in chat or run trace. Recovery
  attempts and next actions can be appended without duplicating existing
  entries. A new failed-state write-back must provide `failure.reason` or
  `errorReason`; the tool rejects missing failure reasons instead of creating a
  vague default. Successful/non-failed write-back clears stale `failure`
  metadata so a completed node cannot keep driving failed-node UI from old
  state.
- `record_agent_critique` writes validation and critique findings back into an
  existing durable `critique` node. The canonical review truth lives in
  `PenNode.meta.agentExecution.critique` with findings, issue counts, and pass
  state, while `details.outputSummary` and the visible text child remain
  readable summaries. A recorded failed critique always sets structured
  `critique.pass` to `false`, even if the findings are warnings, so the
  property panel cannot show a failed node as passing. The Web property panel
  renders severity, target node, and suggested fix from the structured metadata
  so review results are not trapped in run trace or plain tool-output text.
- `record_agent_final_deliverable` writes completed or failed final-deliverable
  state back into an existing durable `final_deliverable` node after the actual
  output has been placed on the canvas. It updates visible node text,
  `details.outputSummary`, status, title, top-level semantic bindings, and
  failure recovery context when needed, while rejecting non-final nodes instead
  of guessing a target. Failed final delivery requires a concrete `errorReason`
  or `failure.reason`, so the UI can explain what blocked the final output and
  offer recovery actions without exposing raw codes.
- `generate_image` now accepts and returns `agentExecutionNodeId` so image
  generation calls can stay correlated with the durable `tool_call` or
  `task_step` node returned by `create_agent_execution_flow`. Background image
  job payloads preserve the same ID as diagnostic/correlation metadata; it is
  not a second runtime truth and does not replace `PenNode.meta.agentExecution`.
- The runtime now uses that correlation ID when image jobs reach a terminal
  state: successful jobs mark the referenced execution node `done` with output
  details, while canceled/failed/timed-out jobs mark it `failed` with recovery
  actions. This automatic write-back is best-effort and never replaces the
  durable execution node as the source of truth.
- Generated image insertion updates a targeted `final_deliverable` container
  from `running` to `done` when the image replaces its loading nodes.
- The Web property panel reads the same metadata and shows execution type,
  status, run/tool information, active-page upstream/downstream execution-chain
  cards, expandable task/tool details, failed-step recovery context, and direct
  `ask_user_more` text response write-back into the selected node metadata.
  Expanded task/tool details show tool, input, output, reasoning, and error
  context; collapsed details keep the node title/status visible in the section
  header and preserve a result summary or failure reason instead of collapsing
  to an empty row. Failure reason display is normalized at the Web UI boundary
  so raw diagnostic values such as HTTP status numbers, provider error codes,
  `null`, or `undefined` are not shown directly to users; the same readable
  failure copy is used in the property panel, canvas hover/status surfaces,
  run-control bar, and run trace rows. The durable
  `meta.agentExecution.failure` and tool details remain the source of truth for
  Agent recovery and debugging.
  Selecting an Agent execution node also shows a compact canvas toolbar badge
  with the node kind and current status, derived from the same
  `meta.agentExecution` truth, so users can read waiting/running/done/failed/
  paused state on the canvas surface before opening deeper details.
  Active-page execution nodes with attention-worthy non-complete states
  (`waiting`, `running`, `failed`, `paused`) also show compact persistent canvas
  corner markers from the same durable metadata; completed and selected nodes
  are omitted from that persistent layer to keep the execution chain scannable
  while selection and hover still expose full details. Clicking a persistent
  marker selects the corresponding execution node through the normal canvas
  selection API without mutating `PenDocument.pages`.
  These markers now render as activity callouts instead of raw status-only
  chips: running nodes derive labels such as `分析中...`, `生成中...`,
  `评审中...`, or `对比方案...` from `meta.agentExecution.kind` / `toolName`,
  while waiting, failed, and paused nodes show `等待补充`, `处理失败`, or
  `已暂停`. The icon/dot/caret streaming-text animation is purely a UI
  affordance; run trace remains diagnostic and does not drive the marker truth.
  Agent-created execution cards now also share a persisted visual structure at
  creation time: each generated user-goal, recipe, step, tool, evidence,
  branch, comparison, ask-user-more, critique, checkpoint, and final-deliverable
  frame uses a rounded card shell with title/status/body text children, larger
  internal padding, semantic fill/stroke colors, and calmer smooth arrow
  connectors. These layout nodes are written directly into `PenDocument.pages`;
  no parallel Agent-only visual state is introduced.
  The persistent layer also renders a compact active-page status summary for
  failed/running/waiting/paused execution nodes, helping users spot active work
  or blockers before drilling into individual containers. Clicking a non-zero
  summary chip selects the first matching execution node via the normal canvas
  selection API.
  Hovering non-checkpoint execution nodes shows a read-only canvas summary card
  with kind, status, title, tool/summary, and waiting/failure/pause reasons
  when those reasons explain the current status; checkpoint nodes continue to
  use the dedicated hover action toolbar for continue/rerun/branch actions.
  Upstream/downstream cards resolve node IDs against current
  `PenDocument.pages` nodes and show title, kind, tool, status, and explicit
  missing-node states instead of treating raw IDs as the user-facing chain UI.
  Clicking an existing chain card selects that canvas node for inspection;
  missing references stay visible but not actionable. `ask_user_more` nodes
  route submitted text into the selected-node continuation draft so the user can
  continue directly from the waiting point with the submitted answer visible in
  the editable prompt. Once text or file/image supplements are written into
  `waitingForUser.response`, the same durable node is marked `paused` rather
  than remaining `waiting`, so the canvas status summary no longer reports a
  human blocker after the user has answered. Nodes that accept files can route
  `补充文件/图片` into the same continuation draft and chat attachment picker,
  keeping uploads on the existing chat attachment boundary while preserving the
  selected execution node as context; when the continuation run is created with
  attachments, the submitted attachment count is written back to
  `waitingForUser.response.attachmentCount` on the same durable node and shown
  in the property panel. Unavailable continue / rerun / branch controls remain disabled and
  explained until the run controller is wired.
- The chat input shows a "based on selected Agent execution node" context chip
  when the user selects such a node on the canvas, offers `new_branch` vs
  `overwrite_current` continuation modes, and sends the selected node/run/mode
  plus the UI recovery intent (`retry`, `rewrite`, `skip`, `rerun_checkpoint`,
  `attach_files`, `new_branch`, or `continue`) as
  `<agent_execution_continue_context>` in the Agent prompt while keeping the
  visible user message clean. The chip itself shows execution kind/status and
  includes waiting, failure, and checkpoint restart reasons in its hover title
  so users can understand the selected continuation anchor before sending.
  The canvas selection surface also exposes a Flowith-inspired animated
  follow-up pill below the selected durable Agent execution node; it is derived
  from `meta.agentExecution`, uses contextual labels such as `修复失败`,
  `继续补充`, `继续深化`, or `从这里继续`, and routes to the same continuation
  draft instead of creating any new Agent-only state.
  Submitted `ask_user_more` answers also enter the
  same block as `waiting_response_text`, so the Agent can treat the answer as
  structured continuation input instead of only parsing the draft sentence.
  Failed-node attempted actions and suggested next actions enter the same block
  as `failure_attempted` and `failure_next_actions`, so retry/rewrite/skip
  follow-ups can avoid repeating ineffective attempts and can update the durable
  recovery state.
  Restartable checkpoint nodes also pass `checkpoint_restart_reason` so
  `rerun_checkpoint` follow-ups know why the selected checkpoint is a valid
  downstream rebuild anchor.
  Paused execution nodes also pass `paused_continuation_instruction`, making the
  prompt contract explicit that the Agent should not try to restore the old SSE
  stream; it should inspect the durable node and continue through a new Agent
  run that writes later state back to canvas nodes.
  Intent, waiting response text, checkpoint restart reason, and paused
  continuation instruction are prompt-only guidance; the Agent still has
  to inspect the live `PenDocument.pages` node and write durable updates through
  canvas tools.
- The chat input now also supports manual canvas node references: the user can
  add the current canvas selection as removable reference chips, and those node
  IDs enter the Agent prompt as `<canvas_node_references>` with an explicit
  instruction to inspect the current `PenDocument.pages` nodes before editing
  instead of treating the prompt block as copied canvas truth. When the
  referenced node is an Agent execution node, the reference also carries
  upstream/downstream IDs, branch/comparison/checkpoint/waiting/failure
  summaries, waiting response text and attachment counts, checkpoint restart
  reason, paused continuation instruction, and failed-node recovery history as
  prompt-only guidance. The chip
  itself shows the Agent execution kind/status and includes waiting, failure,
  and checkpoint restart reasons in its hover title so users can verify the
  referenced execution context before sending.
- The chat input now includes a first Recipe template starter surface. Built-in
  templates live in `packages/canvas-core/src/agent-recipe-template.ts` for
  brand visual exploration, poster multi-variant work, product image
  generation, storyboard scripts, webpage design, and design-to-code. Selecting
  a template pre-fills or augments an editable user prompt with a `待补输入`
  per-slot checklist (`- 槽位：`) users can fill directly, shows a Recipe chip
  with the first required input slots, and sends `<agent_recipe_template>` with
  template source, startup mode, node structure, tool order, input slots,
  input-slot policy, validation rules, and deliverable format. This is a
  template-start context, not runtime canvas truth. Completed Recipe, variant
  branch, comparison, checkpoint, and final deliverable execution nodes can now
  also be saved as local custom Recipe templates from the property panel;
  the save panel previews the exact source-node count, node structure, tool
  order, input slots, validation rules, and deliverable format before writing
  anything to local storage. Extraction reads the selected
  `meta.agentExecution` node plus related completed upstream/downstream
  execution nodes on the active page, then stores reusable template fields in
  the browser Recipe menu. Saved templates are grouped separately from built-in
  starters in the Recipe menu, can be previewed for startup behavior, node
  structure, tool order, input slots, validation rules, deliverable format, and
  source node IDs, and deleted from local storage without deleting the original
  canvas execution nodes. Saved template prompt blocks mark
  `saved_source_nodes` as provenance from the old successful chain;
  they are not runtime targets to edit or overwrite unless the user also
  references those live node IDs explicitly. A cloud/team template library,
  cross-page template management, and richer visual template browsing remain
  follow-up work.
  Completed `variant_branch` nodes produce branch-deepening templates with
  variant branch, critique, checkpoint, and final-deliverable expectations, so a
  successful direction can be reused without requiring the user to first select
  the enclosing comparison or checkpoint. When the active page also contains the
  branch's sibling variants and comparison node, saving the branch preserves that
  comparison context in the template source-node set and deliverable contract
  instead of flattening the branch into an isolated single-node recipe.
  Recipe extraction now also preserves `evidence` and `ask_user_more`
  boundaries as reusable workflow contract: saved templates infer
  `create_agent_evidence` / `create_agent_ask_user_more` tool steps, reference
  material / user-supplement input slots, provenance and waiting-input
  validation rules, and a deliverable format that names those context nodes
  instead of flattening them into a generic checkpoint chain.
  The template prompt block now states that node structure, tool sequence,
  input slots, validation rules, and deliverable format are the reusable
  workflow contract, and names `startup_mode` so saved templates start as a new
  execution-chain instance unless a separate continuation context is present.
  It also treats `input_slots` as required workflow inputs: when the user
  message and live canvas context do not provide enough information for a slot,
  the Agent must create a durable `ask_user_more` node before inventing values
  or continuing. The Agent prompt treats template tool steps such as
  `create_agent_evidence`, `create_agent_ask_user_more`,
  `create_agent_variant_branches`, `critique_canvas`, and checkpoint creation as
  durable execution-node requirements rather than optional chat narration.
- The canvas page has a top Agent run control bar that reflects active run
  streaming state, selected execution-node context, waiting-for-user prompts,
  whether the waiting node accepts files/images, submitted response text,
  submitted attachment counts, and failed-node reasons. `Stop` is wired to the real run cancel endpoint and
  SSE cleanup; `Pause` is wired to the real run pause endpoint, emits
  `run.paused`, and stops the active SSE stream while preserving continuation on
  selected durable execution nodes. After a successful pause request, the Web
  canvas writes `paused` back to currently `running` / `waiting` durable
  execution nodes for that run through `PenDocument.pages`, so overlays,
  property panels, and status summaries do not keep showing stale active work.
  After a successful stop request, the same durable write-back path marks active
  nodes `paused` with an explicit stopped summary instead of adding a separate
  Agent-only canceled state, keeping the user-visible recovery entry anchored on
  the execution node.
  `继续` opens the same selected-node continuation draft when a run is not
  actively streaming. When the selected durable execution node is already
  `paused`, the control bar labels this as `从暂停点继续` and explains that it
  will read the current canvas context and start a new Agent run from that node,
  rather than silently resuming the old SSE stream. `从 checkpoint 重跑`
  opens a restartable checkpoint rerun draft that preserves the checkpoint as
  the durable context anchor, shows the downstream node IDs that will be
  rebuilt when the checkpoint records them, and sends
  `checkpoint_rerun_downstream_node_ids` plus a concrete rerun instruction in
  `<agent_execution_continue_context>`. Those IDs are prompt-only scope hints:
  the Agent still has to inspect the live `PenDocument.pages` nodes before
  rewriting downstream work through a new Agent run. The run trace panel remains
  a live diagnostic view: it shows recent SSE events, tool and patch counts, the
  selected durable canvas node ID, upstream/downstream counts from
  `meta.agentExecution`, and affected node IDs for canvas patches, but it does
  not become a runtime canvas state source. The Web UI keeps that boundary split
  as `AgentRunControlBar` for run actions and
  `apps/web/src/components/agent-run-trace-panel.tsx` for read-only trace
  rendering. Same-generator resume still requires
  deeper runtime/checkpointer work, and the current paused continuation UI keeps
  that boundary visible to users.
- `create_agent_variant_branches` creates durable `variant_branch` nodes plus a
  `comparison` node for multi-direction work. Branch metadata records
  plan/product/critique summaries, strengths, risks, use cases, and
  recommended/mainline flags; the comparison node records branch node IDs and
  the recommended branch. The property panel surfaces branch and comparison
  metadata when those nodes are selected; selected `comparison` nodes now
  resolve their active-page branch nodes and show side-by-side branch cards for
  plan, deliverable, critique, strengths, risks, use cases,
  mainline/recommended status, branch continuation, and mainline selection.
  Missing branch nodes are shown as a concrete unavailable state instead of
  silently collapsing to IDs.
- `select_agent_variant_branch` lets the Agent persist a user decision by
  selecting one `variant_branch` as the unique mainline/recommended branch under
  its `comparison`, updating sibling branch metadata and the visible comparison
  recommendation before any follow-up generation continues.
- The Web property panel exposes the same decision as real `设为主线` and
  `设为主线并深化` actions on non-mainline `variant_branch` nodes when their
  comparison context can be resolved, and disables those actions with a
  concrete reason when it cannot. The combined deepen action first persists the
  selected branch as the current mainline/recommended branch in
  `PenDocument.pages`, then opens the continuation draft with mainline branch
  metadata so the prompt context matches the visible canvas state.
- The Web property panel also exposes `继续深化` on already-mainline
  `variant_branch` nodes. It opens the chat input, pre-fills an editable
  continuation draft, preserves the selected branch as
  `<agent_execution_continue_context>`, includes branch plan/product/critique
  summaries plus upstream/downstream IDs as prompt-only context, and defaults to
  `overwrite_current` / `continue` so follow-up work deepens the chosen branch
  instead of accidentally copying a new branch.
  Comparison branch cards pass the clicked branch node as the continuation
  target even when the selected canvas node is the comparison card, so the chat
  chip and prompt anchor to the same durable `variant_branch`. For non-mainline
  comparison cards, the same combined action writes the mainline choice first
  and passes updated mainline metadata to the input context; prompt-level
  `branch_continue_requires_mainline_selection` remains only a guard for manual
  references or stale contexts where the UI could not persist the choice first.
  The comparison panel also exposes a top-level `深化推荐选择` action when a
  recommended branch can be resolved, so the recommended choice is directly
  actionable without requiring the user to locate the matching branch card.
  The Agent must still inspect the referenced live `PenDocument.pages` node
  before editing.
- Generic execution-node continuation actions now use the same path: `从这里继续`
  and `复制为分支` open editable chat drafts from the selected node, failed nodes
  can start `重试此步骤`, `改写输入后继续`, `跳过此步骤`, or `新建分支尝试`, and
  `ask_user_more` text submission writes the response before opening a
  continuation draft. Failed-node cards show readable failure step/reason,
  attempted actions, and user next actions without surfacing raw error codes in
  the panel.
- Selected `checkpoint` nodes now have a dedicated recovery panel in the Web
  property panel. It shows whether the node is restartable, why it is a safe
  restart/fork point, routes `从这里继续` and `复制为新分支` into continuation
  drafts, and routes restartable `从 checkpoint 重跑` into a rerun draft.
- Selected `checkpoint` nodes also expose canvas-level selection-toolbar and
  hover-toolbar actions: `继续` opens the continuation draft, `新分支` opens a
  branch draft, and restartable `重跑` opens the checkpoint rerun draft.
- The Agent run control bar can now open a read-only `Run trace` panel from
  recent front-end SSE events plus selected execution-node metadata. It shows
  event count, tool events, canvas patch counts/details, and selected node
  context; this is a diagnostic view and does not become canvas runtime truth.
  Pause now uses the real run controller and `run.paused`; same-generator resume
  still waits for deeper runtime/checkpointer support.

## Development Order

Implement in this order. Do not skip directly to orchestration polish while the read/write substrate is incomplete.

1. **P0 live semantic loop**
   - `inspect_canvas_semantic`
   - `get_selection_context`
   - `canvas_diff_preview`
   - `apply_canvas_transaction`
   - `validate_canvas`
   - MCP-compatible `screenshot_canvas`

2. **P1 durable editing primitives**
   - `layout_canvas`
   - `resize_container_to_fit`
   - `connect_nodes`
   - `create_agent_output_container`
   - `query_canvas_assets`
   - `replace_asset_in_node`

3. **P2 AI-native continuity**
   - `canvas_memory_index`
   - `critique_canvas`
   - `export_canvas_deliverable`
   - `canvas_run_trace`

Each stage must update this document, [`canvas-tooling-capability-map.md`](./canvas-tooling-capability-map.md), `progress.md`, and `feature_list.json` when capabilities become available.

## Required Tool Design Rules

All new Agent-callable canvas capabilities should be MCP-compatible unless there is a clear reason to keep them as direct LangChain tools. Use `apps/server/src/mcp/server.ts` as the registration boundary and bridge through `apps/server/src/mcp/deepagents-bridge.ts`.

Tool implementation requirements:

- Read the latest live editor document through `LiveCanvasService`.
- Validate that `canvasId`, `userId`, and `accessToken` exist in runtime context.
- Fail with clear typed errors when live editor access is unavailable.
- Include `canvasId`, `userId`, `pageId`, affected node IDs, and transaction IDs in logs.
- Return structured content, not only text.
- Never return `null`, `undefined`, opaque error codes, or placeholder defaults to the user-facing layer.
- Support `pageId` when the operation can affect page-scoped data.
- Preserve manual user edits by reading before writing and by avoiding blind whole-document replacement when a patch/transaction can express the change.

Preferred logging prefixes:

- `[ai-native-canvas] semantic.inspect`
- `[ai-native-canvas] selection.context`
- `[ai-native-canvas] diff.preview`
- `[ai-native-canvas] transaction.apply`
- `[ai-native-canvas] validate`
- `[ai-native-canvas] layout`
- `[ai-native-canvas] asset`
- `[ai-native-canvas] trace`

## P0: Live Semantic Loop

### `inspect_canvas_semantic`

Purpose:

Read the canvas as an AI workspace, not just as flat geometry.

Status:

- Available as MCP tool `inspect_canvas_semantic` as of 2026-06-02 CST.
- Current slice reads the live editor document, active or explicit page, semantic containers, selected/focus nodes, connector dataflow edges, referenced assets, optional variable/theme summary, and warnings for omitted hidden/locked nodes or missing connector/assets.
- Follow-up slices should continue expanding validation depth and UI selection RPC fidelity without changing the durable truth boundary.

Single source of truth:

- `PenDocument.pages`
- `activePageId`
- `PenNode` hierarchy
- `contextSlots`
- `agentBinding`
- `ioPorts`
- connector bindings
- document variables/themes/assets

Inputs:

- `pageId?: string`
- `includeHidden?: boolean`
- `includeLocked?: boolean`
- `includeAssets?: boolean`
- `includeVariables?: boolean`
- `includeRunMetadata?: boolean`
- `maxDepth?: number`
- `focusNodeIds?: string[]`

Output:

- document summary: version, page count, active page
- semantic containers: id, name, role, bounds, parent path, child counts, context slots, agent binding, IO ports
- selected/focus nodes when available
- dataflow edges/connectors with source/target, binding sides, arrow/routing
- assets referenced by visible nodes
- variables/themes used by nodes
- warnings for missing assets, invalid refs, hidden/locked relevant nodes

Implementation notes:

- Do not replace `inspect_canvas`; keep `inspect_canvas` as geometry-first.
- Add this as a structured canvas MCP tool.
- Reuse existing document traversal helpers from `packages/canvas-core`.
- Keep import diagnostic fields separate from runtime semantic fields.

Tests:

- Reads active page only by default.
- Reads explicit `pageId`.
- Reports containers with agent binding/context slots.
- Reports connector relationships.
- Existing legacy root `children` document fails with clear unsupported-canvas message.

Acceptance:

- Agent can answer "what is this canvas trying to produce?" from the tool output without screenshot analysis.

### `get_selection_context`

Purpose:

Make the user's current selection a first-class Agent intent anchor.

Status:

- Available as MCP tool `get_selection_context` as of 2026-06-02 CST.
- Current slice reads selection from the live editor document returned by `canvas.document.get`, summarizes selected nodes, parent container paths, effective context slots, optional ancestors/descendants/siblings, and editable capability flags with explicit disabled reasons.
- The tool is read-only and does not set selection.

Single source of truth:

- Web runtime selection in `CanvasRuntimeStore`
- current live `PenDocument`

Inputs:

- `includeAncestors?: boolean`
- `includeDescendants?: boolean`
- `includeSiblings?: boolean`
- `detailLevel?: "summary" | "full"`

Output:

- selected node IDs
- active page ID
- selected node summaries
- parent container path
- effective context slots
- editable capability flags: canMove, canResize, canEditText, canReplaceAsset, canConnect, canGroup, canUngroup
- reason strings for disabled capabilities

Implementation notes:

- The Web editor already exposes document RPC; add a live RPC for selection or include selection in `canvas.document.get` response if that becomes the single selection read boundary.
- Do not let Agent set selection through this tool. This is a read tool.

Tests:

- Empty selection returns explicit `selection_empty` reason.
- Text node selection reports text edit capability.
- Image/video node selection reports replace asset capability.
- Locked node reports disabled write capability with reason.

Acceptance:

- When user says "改这个", Agent can resolve the selected target without guessing from geometry.

### `canvas_diff_preview`

Purpose:

Let Agent propose a bounded canvas edit before committing.

Status:

- Available as MCP tool `canvas_diff_preview` as of 2026-06-02 CST.
- Current slice supports `CanvasOperation[]` previews against the latest live editor document. It reuses `applyCanvasTransaction` on a cloned document, does not mutate the live editor, and reports affected/created/updated/deleted/moved node IDs, affected bounds, high-risk changes, preview warnings, and a transaction ID candidate.
- `structuredOperations` / `batch_design` parse-preview remains a follow-up so the DSL and transaction path can share one normalization boundary.

Single source of truth:

- current live document
- proposed `CanvasOperation[]` or structured operation plan

Inputs:

- `operations: CanvasOperation[]` or `structuredOperations: string`
- `pageId?: string`
- `agentId?: string`
- `summaryMode?: "compact" | "full"`

Output:

- affected nodes
- nodes to create/update/delete/move
- bounding region affected
- high-risk changes: deletes, asset replacements, large moves, hidden/locked changes, variable/theme changes
- validation preview warnings
- transaction ID candidate

Implementation notes:

- Must not mutate document.
- Should reuse the same operation normalization as commit path.
- For `batch_design`, expose parse/preview without write.

Tests:

- Preview does not change live document.
- Delete operations are marked high-risk.
- Invalid node IDs fail with concrete reason.
- Preview and actual transaction report the same affected node IDs.

Acceptance:

- Complex Agent edits can be shown in chat/tool card before commit.

### `apply_canvas_transaction`

Purpose:

Provide one production-grade commit boundary for Agent canvas edits.

Status:

- Available as MCP tool `apply_canvas_transaction` as of 2026-06-02 CST.
- Current slice supports page-aware `CanvasOperation[]`, `dryRun`, optional selection updates, live `baseVersion` protection, shared affected/high-risk reporting with `canvas_diff_preview`, and commits through `LiveCanvasService.patchDocument`.
- The Web live document state now exposes version through `LiveCanvasService.getDocumentState`; existing `getDocument` behavior remains available for read-only tools.
- As of 2026-06-03 CST, live browser RPC writes for `canvas.document.patch` and `canvas.document.set` flush the Skia renderer immediately after committing to the runtime store, so Agent execution-chain edits become visible during the run rather than waiting for final artifact insertion or a later canvas refresh.

Single source of truth:

- current live document
- page-aware `CanvasOperation[]`

Inputs:

- `baseVersion?: number`
- `transactionId?: string`
- `pageId?: string`
- `operations: CanvasOperation[]`
- `selection?: string[]`
- `dryRun?: boolean`
- `validate?: boolean`
- `agentId?: string`

Output:

- success
- transaction ID
- applied operation count
- affected node IDs
- created node IDs
- deleted node IDs
- next document version if available
- validation result when requested
- errors with reasons

Implementation notes:

- Prefer `LiveCanvasService.patchDocument` over whole `setDocument` where possible.
- Reuse `applyCanvasTransaction` from `packages/canvas-core`.
- Roll back on failure by not writing partial results.
- Do not silently ignore invalid operations.

Tests:

- Applies insert/update/delete/move/group/align/reorder.
- Dry-run does not mutate.
- Invalid `baseVersion` or missing node fails.
- Agent write permission constraints are enforced.
- Connector reconciliation runs after deletes/moves.

Acceptance:

- `manipulate_canvas` and `batch_design` can eventually route through this transaction boundary for consistent behavior.

### `validate_canvas`

Purpose:

Let Agent self-check generated or edited canvas output.

Status:

- Available as MCP tool `validate_canvas` as of 2026-06-02 CST.
- Current slice implements deterministic structural validation for invalid page/node structure, duplicate/missing node IDs, missing canvas assets, missing variables, dangling connector endpoints, likely fixed-size text overflow, invalid ref component targets, and hidden/locked Agent output.
- Validation output can be persisted to an existing durable `critique` node via
  `record_agent_critique`; this keeps `validate_canvas` read-only while making
  verification results visible on the Agent Execution Canvas.
- Visual heuristics such as low contrast and overlap critique remain follow-up checks and should stay field-backed rather than screenshot-only.

Single source of truth:

- live `PenDocument`
- renderer/layout-consumed fields
- document assets/variables/themes

Inputs:

- `pageId?: string`
- `nodeIds?: string[]`
- `checks?: CanvasValidationCheck[]`
- `severityThreshold?: "info" | "warning" | "error"`

Recommended checks:

- invalid page/active page
- missing or duplicate node IDs
- missing assets for image/video/image fills
- invalid component refs
- invalid variable refs
- text overflow or text clipped by fixed dimensions
- overlapping nodes inside the same semantic container
- low contrast text/fill combinations
- connector endpoints referencing missing nodes
- nodes outside intended container bounds
- hidden or locked nodes included in Agent output
- UI controls writing fields not consumed by runtime

Output:

- pass/fail
- issues with severity, node ID, field path, reason, suggested fix
- affected bounding regions

Implementation notes:

- Start with deterministic structural checks before visual heuristics.
- Avoid screenshot-only validation for field-level issues.
- Pair with `screenshot_canvas` for visual QA when edits create 3+ visible nodes.

Tests:

- Missing asset detected.
- Dangling connector detected.
- Text overflow fixture detected.
- Valid simple page passes.

Acceptance:

- Agent can run validation after canvas creation and provide actionable fixes.

### MCP-compatible `screenshot_canvas`

Purpose:

Unify visual verification under the MCP-compatible registry.

Status:

- Available in the MCP registry as `screenshot_canvas` as of 2026-06-02 CST.
- Current slice wraps the existing direct screenshot tool, preserving `canvas.screenshot` browser RPC behavior while exposing the same capability to MCP clients and Deep Agents bridge discovery.
- Missing browser/user context returns structured errors instead of opaque fallbacks.

Single source of truth:

- browser RPC `canvas.screenshot`

Inputs:

- same as existing direct tool: `mode`, `region`, `max_dimension`

Output:

- width, height, actual bounds, screenshot URL when persisted

Implementation notes:

- Keep existing direct tool working during migration.
- Add MCP wrapper or native MCP tool registration.
- Ensure tool cards classify it as a visual inspection tool.

Tests:

- Registry lists `screenshot_canvas`.
- Tool calls browser RPC with expected method.
- Missing user context returns structured error.

Acceptance:

- Main Agent and future MCP clients see the same screenshot capability list.

## P1: Durable Editing Primitives

### `layout_canvas`

Purpose:

Let Agent request layout intent without manually calculating every coordinate.

Single source of truth:

- `PenNode.x/y/width/height`
- container `layout`, `gap`, `padding`, `justifyContent`, `alignItems`
- child `layoutConstraints`

Inputs:

- `containerId?: string`
- `nodeIds?: string[]`
- `strategy: "auto_layout" | "grid" | "stack" | "flow" | "avoid_overlap" | "align_distribute"`
- `direction?: "vertical" | "horizontal"`
- `gap?: number`
- `padding?: number | [number, number] | [number, number, number, number]`
- `bounds?: CanvasBounds`
- `preserveManualPositions?: boolean`

Output:

- applied operation list or preview
- affected nodes
- final bounds
- layout warnings

Acceptance:

- Agent can create dense but readable structured diagrams without brittle coordinate math.

Status:

- Implemented as MCP `layout_canvas`.
- Supports `auto_layout`, `stack`, `grid`, `flow`, `avoid_overlap`, and `align_distribute` strategies.
- `auto_layout` writes only runtime-consumed container layout fields (`layout`, `gap`, `padding`) and leaves child positions untouched.
- Coordinate-moving strategies emit explicit `updateNode` operations and require all target nodes to share one parent coordinate space, preventing scene coordinates from being written into mixed local coordinate systems.
- Supports `containerId` or explicit `nodeIds`, optional bounds, direction, gap, padding, dry-run preview, transaction IDs, and live `baseVersion` protection.
- Planner logic lives in `layout-canvas-planner.ts` so the MCP wrapper remains focused on validation, logging, and patch orchestration.

### `resize_container_to_fit`

Purpose:

Keep container-as-output results from clipping generated content.

Single source of truth:

- container children scene bounds
- container padding/clip/layout fields

Inputs:

- `containerId: string`
- `padding?: number`
- `axis?: "width" | "height" | "both"`
- `minWidth?: number`
- `minHeight?: number`
- `maxWidth?: number`
- `maxHeight?: number`

Output:

- previous bounds
- next bounds
- affected children

Acceptance:

- Agent can add content into a container and fit the container without visual overflow.

Status:

- Implemented as MCP `resize_container_to_fit`.
- Computes visible descendant scene bounds, applies numeric width/height updates to the container only, and leaves child positions untouched.
- Supports `axis`, `padding`, min/max dimensions, dry-run preview, transaction IDs, created selection focus on the resized container, and live `baseVersion` protection.
- Returns previous bounds, next bounds, content bounds, affected child IDs, and layout warnings when content extends before the container origin or max dimensions clamp the required fit.
- Empty containers and unsupported node types fail with concrete reasons instead of silently applying no-op updates.

### `connect_nodes`

Purpose:

Create semantic dataflow/context connections without exposing low-level line endpoint math.

Single source of truth:

- `LineNode.connector`
- `LineNode.stroke`
- source/target node IDs

Inputs:

- `sourceNodeId`
- `targetNodeId`
- `relationship?: string`
- `direction?: "source_to_target" | "bidirectional"`
- `routing?: "straight" | "smooth"`
- `label?: string`
- `style?: { strokeColor?: string; strokeWidth?: number }`

Output:

- connector node ID
- endpoint bindings
- route summary

Acceptance:

- Agent can make durable canvas dataflow relations without manual coordinates.

Status:

- Implemented as MCP `connect_nodes`.
- Inserts a durable `LineNode` with `connector.start` and `connector.end` bindings, route metadata, arrow direction, optional relationship/name, and style overrides.
- Chooses connector sides from live scene bounds and lets existing `reconcileCanvasConnectors` keep endpoint coordinates synchronized after node movement.
- Supports dry-run preview, transaction IDs, selection of the created connector, and live `baseVersion` protection through `LiveCanvasService.patchDocument`.
- Current connector targets intentionally match the Web connector runtime: visible `frame`, `group`, and `rectangle` nodes. Unsupported target types fail with a concrete reason instead of creating a line that is not consumed by connector semantics.

### `create_agent_output_container`

Purpose:

Create the canonical container for final Agent output.

Single source of truth:

- `FrameNode`
- `containerRole`
- `contextSlots`
- `agentBinding`
- `ioPorts`
- run/session metadata

Inputs:

- `name`
- `role?: "visual" | "context" | "task" | "dataflow"`
- `bounds?: CanvasBounds`
- `pageId?: string`
- `agentBinding?: AgentBinding`
- `contextSlots?: ContextSlots`
- `ioPorts?: IOPort[]`
- `children?: PenNode[]`

Output:

- container ID
- created child IDs
- context summary

Acceptance:

- Agent uses a consistent container schema for final visual/structured deliverables.

Status:

- Implemented as MCP `create_agent_output_container`.
- Creates one canonical `FrameNode` truth for durable Agent output with `containerRole`, `contextSlots`, `agentBinding`, `ioPorts`, `createdByAgentId`, `runId`, `sessionId`, optional children, and bounds stored on the node.
- Supports explicit bounds or deterministic placement to the right of existing page content, dry-run preview, transaction IDs, created container selection, and live `baseVersion` protection.
- Child nodes must include `id` and `type`; duplicate child IDs fail fast before the live document is patched.

### `query_canvas_assets`

Purpose:

Let Agent reuse existing canvas assets instead of regenerating or losing context.

Single source of truth:

- `PenDocument.assets`
- `image.src`
- `videoEmbed.src`
- image fills

Inputs:

- `type?: "image" | "video" | "all"`
- `source?: "upload" | "generated" | "canvas-ref"`
- `referencedOnly?: boolean`
- `nodeIds?: string[]`

Output:

- assets
- referenced node IDs
- missing asset references
- dimensions/mime/source metadata

Acceptance:

- Agent can answer "which existing image should I edit?" from canvas state.

Status:

- Implemented as MCP `query_canvas_assets`.
- Reads only the live `PenDocument.pages` document through `LiveCanvasService`.
- Returns `PenDocument.assets` entries with concrete node references, referenced node IDs, dimensions/mime/source metadata, and missing document-asset references such as unresolved `asset:` URLs.
- Supports `type`, `source`, `referencedOnly`, `nodeIds`, and explicit `pageId` filters.

### `replace_asset_in_node`

Purpose:

Support image/video refinement without deleting and recreating nodes.

Single source of truth:

- existing `image.src`, `videoEmbed.src`, or image fill URL
- `PenDocument.assets`

Inputs:

- `nodeId`
- `assetId?: string`
- `url?: string`
- `mimeType`
- `preserveBounds?: boolean`
- `updatePromptMetadata?: boolean`

Output:

- node ID
- previous asset/source
- next asset/source
- preserved bounds

Status:

- Implemented as MCP `replace_asset_in_node`.
- Preserves node identity and bounds by updating the runtime-consumed source field: `image.src`, `videoEmbed.src`, or the first image fill URL.
- Uses `PenDocument.assets` plus node source/fill fields as one transaction truth by adding core `CanvasOperation.type = "upsertAsset"` and committing through `LiveCanvasService.patchDocument`.
- Supports reusing an existing `assetId`, creating/updating an asset record from `url + mimeType`, dry-run preview, transaction IDs, and live `baseVersion` protection.
- `preserveBounds` must currently remain true. `updatePromptMetadata` is intentionally rejected until prompt metadata input and ownership are defined, preventing a UI/tool control that appears editable but is not consumed by runtime.

Acceptance:

- User-selected images can be upscaled, extended, or varied while preserving layout and node identity.

## P2: AI-Native Continuity

### `canvas_memory_index`

Purpose:

Create searchable memory from durable canvas results and user feedback.

Single source of truth:

- canvas document
- run/session records
- user messages and feedback
- project/brand context

Rules:

- Memory can inform Agent decisions but must not become a second runtime canvas truth.
- Any memory-derived edit still writes through live canvas tools.

Acceptance:

- Agent remembers why a container exists and which feedback shaped it.

Status:

- Implemented as read-only MCP `canvas_memory_index` live-canvas slice.
- Builds searchable memory entries from durable `PenDocument.pages` nodes, including names, roles, text content, `contextSlots`, `agentBinding`, `createdByAgentId`, `runId`, and `sessionId`.
- Returns `searchableText`, source node IDs, metadata, relevance score, hidden/locked omission warnings, and source flags that explicitly mark `persistedMemory: false`.
- This slice does not persist long-term memory and does not read chat/user-message history yet; those remain follow-up persistence boundaries and must not become a second runtime canvas truth.

### `critique_canvas`

Purpose:

Give Agent a structured review pass for design quality and workflow completeness.

Checks:

- design hierarchy
- visual consistency
- brand/style adherence
- readability
- container role clarity
- deliverable completeness
- validation issue summary

Acceptance:

- Agent can propose or apply fix passes grounded in specific node IDs and reasons.

Status:

- Implemented as read-only MCP `critique_canvas`.
- Runs deterministic critique checks for design hierarchy, visual consistency, brand/style context, readability through validation summary, container role clarity, deliverable completeness, and validation issue summary.
- Reuses live `PenDocument.pages` truth plus `validateCanvasDocument`; findings reference concrete node IDs and suggested fixes, but the tool never mutates canvas state.
- `record_agent_critique` is the explicit write-back boundary for these results:
  it updates an existing `meta.agentExecution.kind = "critique"` node with
  summary/details/text content after validation or critique, and rejects
  non-critique nodes instead of guessing a target.
- Supports explicit `pageId`, `nodeIds`, check selection, optional validation summary, and severity threshold filtering.

### `export_canvas_deliverable`

Purpose:

Export final canvas results as product deliverables, not only code.

Targets:

- image/poster
- structured JSON handoff
- flow/diagram spec
- component spec
- React/HTML/Vue code
- deck/module slices when later supported

Acceptance:

- Agent can turn selected containers into user-facing deliverables with traceable source node IDs.

Status:

- Implemented as read-only MCP `export_canvas_deliverable` for `structured_json`, `flow_spec`, and `component_spec` targets.
- Uses explicit `nodeIds` or the current live canvas selection as the export source, keeps root/source node IDs, scene bounds, referenced assets, and optional validation summary in the handoff payload.
- `flow_spec` exports connector endpoints from durable `LineNode.connector` data; `component_spec` exports component root summaries, child counts, component refs, slot metadata, and variable refs.
- Image/poster/code/deck targets intentionally return explicit unsupported reasons instead of pretending to render; React/HTML/Vue handoff remains owned by `codegen_export`, and image evidence remains owned by `screenshot_canvas`.

### `canvas_run_trace`

Purpose:

Record what the Agent changed without materializing process containers on canvas.

Single source of truth:

- agent run events
- tool calls
- transaction results
- affected node IDs

Output:

- run ID
- transaction IDs
- changed node IDs
- tool calls
- validation status
- user-visible summary

Acceptance:

- Users and engineers can replay what changed and why without polluting the visual canvas.

Status:

- Implemented as read-only MCP `canvas_run_trace`.
- Reads recent `StreamEvent` records from the shared `CanvasEventBuffer` and live canvas node metadata from the current `PenDocument.pages`; it does not persist a second trace document or create process containers.
- Returns active/requested run context, compact event timeline, tool call lifecycle, canvas patch transaction IDs, patch operation summaries, affected node IDs, and live nodes linked by `runId`, `sessionId`, or `agentBinding`.
- Supports `runId`, `sessionId`, `nodeIds`, `pageId`, `maxEvents`, optional tool payload inclusion, and `includeEvents: false` for live node-only diagnosis when no event buffer is available.

## Suggested Implementation Slices

### Slice 1: Selection And Semantic Read

Files likely involved:

- `apps/web/src/components/canvas-editor.tsx`
- `apps/web/src/components/canvas/canvas-api.ts`
- `apps/server/src/features/canvas/live-canvas-service.ts`
- `apps/server/src/mcp/tools/structured-canvas.ts`
- `apps/server/src/mcp/server.ts`
- `packages/canvas-core/src/context.ts`
- `packages/canvas-core/src/document.ts`

Deliverables:

- `get_selection_context`
- `inspect_canvas_semantic`
- tests for empty selection, selected text, selected image, selected container with context

### Slice 2: Transaction And Diff

Files likely involved:

- `packages/canvas-core/src/operations.ts`
- `apps/server/src/features/canvas/live-canvas-service.ts`
- `apps/server/src/mcp/tools/structured-canvas.ts`
- `apps/server/src/mcp/tools/structured-canvas.test.ts`

Deliverables:

- `canvas_diff_preview`
- `apply_canvas_transaction`
- dry-run support
- transaction logs

### Slice 3: Validation

Files likely involved:

- new `packages/canvas-core/src/validation.ts`
- `packages/canvas-core/src/__tests__/validation.test.ts`
- `apps/server/src/mcp/tools/structured-canvas.ts`

Deliverables:

- `validate_canvas`
- structural validation checks
- text overflow and missing asset checks

### Slice 4: Layout And Fit

Files likely involved:

- `packages/canvas-core/src/layout.ts`
- `packages/canvas-core/src/geometry.ts`
- `apps/server/src/mcp/tools/structured-canvas.ts`

Deliverables:

- `layout_canvas`
- `resize_container_to_fit`
- layout fixtures for nested containers

### Slice 5: Asset And Connector Primitives

Files likely involved:

- `packages/canvas-core/src/connector-geometry.ts`
- `packages/canvas-core/src/document.ts`
- `apps/server/src/mcp/tools/structured-canvas.ts`

Deliverables:

- `connect_nodes`
- `query_canvas_assets`
- `replace_asset_in_node`

## Definition Of Done For Each Capability

Each new capability is done only when:

- It is registered in the MCP-compatible registry or explicitly documented as a direct Agent tool.
- It reads/writes through `LiveCanvasService`.
- It uses `PenDocument.pages` and explicit `pageId` handling.
- It logs structured context.
- It has focused tests for success, failure, and at least one boundary case.
- `canvas-tooling-capability-map.md` is updated from "planned" to "available".
- `progress.md` and `feature_list.json` are updated.
- Typecheck passes for affected workspace.
- Existing unrelated failures, if any, are called out with file paths.

## Product Acceptance Criteria

The canvas should be considered AI-native when these flows work reliably:

1. User selects an existing canvas result and says "改这个".
   - Agent reads selection context.
   - Agent edits the existing node/container without deleting and recreating unrelated content.

2. User asks for a structured visual output.
   - Agent creates an output container.
   - Agent lays out sections and content.
   - Agent validates and fixes obvious issues.
   - Agent can screenshot the result for visual QA.

3. User manually adjusts layout and asks for follow-up.
   - Agent reads latest live document.
   - Agent preserves manual changes.
   - Agent applies only bounded diffs.

4. User asks to refine an existing image/video.
   - Agent queries assets.
   - Agent replaces the asset in-place.
   - Node identity, bounds, and surrounding layout remain stable.

5. Engineer investigates a bad run.
   - Logs include run, canvas, transaction, node, and validation context.
   - Run trace identifies exactly what changed.
