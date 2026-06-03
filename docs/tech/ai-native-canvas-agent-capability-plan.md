# AI Native Canvas Agent Capability Plan

Last updated: 2026-06-02 CST

This is the implementation plan for making Cucumber Studio's canvas AI-native. It builds on the current capability inventory in [`canvas-tooling-capability-map.md`](./canvas-tooling-capability-map.md).

The goal is not to let the Agent click every UI control. The goal is to let the Agent reliably operate every durable canvas outcome:

1. Read the current live canvas as semantic workspace context.
2. Plan a bounded edit against the latest live document.
3. Preview and validate the edit before or after commit.
4. Write structured, container-first results into `PenDocument.pages`.
5. Continue from user manual edits, selection, assets, and prior Agent outputs.

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
