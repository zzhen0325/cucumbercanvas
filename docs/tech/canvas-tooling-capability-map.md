# Canvas Tooling Capability Map

Last audited: 2026-06-04 CST

This document maps the current Cucumber canvas surface area to its runtime truth, UI entry points, `CanvasApi` functions, and Agent/MCP access. It is intended to answer two questions:

1. What canvas tools, editable properties, and functions exist today?
2. Which of them can the Agent call through MCP-compatible tools?

For the forward development plan, use [`ai-native-canvas-agent-capability-plan.md`](./ai-native-canvas-agent-capability-plan.md).

## Runtime Truth

The durable canvas truth is `PenDocument.pages` plus a valid `activePageId`.
The node-system and Figma-like editing model share this same truth: visual
editing fields define the physical canvas object, while semantic fields and
connector bindings explain workflow/dataflow meaning on the same visible
`PenNode`. See [`canvas-node-figma-fusion.md`](./canvas-node-figma-fusion.md)
for the full boundary.

- `PenDocument.pages[]`: page list. Each page owns its `children`.
- `PenDocument.activePageId`: active durable page. It must point to an existing page.
- `PenDocument.children`: intentionally empty in current durable documents.
- `PenNode`: the runtime truth for node geometry, style, hierarchy, layout, agent binding, imports, and renderable content.
- `PenDocument.variables` and `PenDocument.themes`: document-level design variable and theme truth.
- `PenDocument.styleDefinitions`: external style definitions preserved from design tools.
- `PenDocument.assets`: canvas-scoped image and video asset records.

Old flat root-children canvas shapes are not a runtime compatibility source. If encountered in core Agent context paths, they fail fast with a clear error. Any real legacy repair belongs at a data-fix or import boundary.

Migration and diagnostic fields:

- `layoutRef`: deprecated external auto-layout metadata. It is migration/input metadata, not the core runtime layout truth.
- `meta.importedAutoLayout`, Figma/SVG import diagnostics, degradation hints, origin IDs, and warning counts: diagnostic/import provenance only.
- `meta.agentExecutionContainer`: Agent-native execution container metadata, schema version 1. It is the runtime truth for execution internals introduced by [`agent-native-execution-container-design.md`](./agent-native-execution-container-design.md): stream parts, structured tool parts, todo state, artifact refs, waiting/failure/checkpoint context, and legacy diagnostics. It lives on the selected canvas shell node as Agent execution state, not as renderable canvas children.
- `meta.agentExecution`: legacy execution-node semantic metadata, schema version 1. It remains a canvas-shell semantic index and migration input for Flowith-like execution-node kinds such as `user_goal`, `recipe_plan`, `tool_call`, `critique`, `ask_user_more`, `checkpoint`, `variant_branch`, `comparison`, and `final_deliverable`, plus upstream/downstream chain links and selected property-panel affordances that have not yet moved to `meta.agentExecutionContainer`.
- `withAgentExecutionNodeSemantics` in `packages/canvas-core/src/agent-execution.ts` is the shared write boundary for newly created execution nodes that need both durable `meta.agentExecution` and top-level semantic indexes such as `runId`, `sessionId`, `agentBinding`, `containerRole`, and `contextSlots`. The generic execution flow, ask-user-more, evidence, and variant/comparison creation tools use this boundary instead of hand-writing partial execution metadata in separate paths. New generic execution-flow cards also write `meta.agentExecutionContainer` through the native container helper so streaming output, tool parts, TODO state, and artifact refs have a first-class Agent runtime truth from creation time.
- `getAgentExecutionNodeSemanticUpdates` in `packages/canvas-core/src/agent-execution.ts` is the matching update boundary for existing execution nodes. Tool-call and critique write-back use it so `status`, tool/failure details, and review findings update `meta.agentExecution` and the same-node top-level semantic indexes together.
- Simple image-generation tasks now use the same `create_agent_execution_flow` chain as other Agent work: the optimized prompt belongs to a task/tool-call step, `generate_image` targets the returned `finalDeliverableNodeId`, and `agentExecutionNodeId` links the image job back to the durable `tool_call` node. The duplicated top-level fields are semantic/read/trace indexes over the same `PenNode`, not a second execution truth.
- `variableRefs`: preserved external variable binding references for reconciliation. Runtime style should use resolved values or `$variableName` values backed by `PenDocument.variables`.
- `styleRefs` and `componentRef`: preserved editability/reference identity. They are visible/editable in the inspector but do not replace the inlined runtime render fields.

Agent run UI state:

- The canvas-level Agent run control bar derives its durable context from selected Agent execution shell metadata. New streaming internals should read `PenNode.meta.agentExecutionContainer`; legacy continuation affordances may still read `PenNode.meta.agentExecution` until they are migrated.
- `Stop` calls the real `/api/agent/runs/:runId/cancel` endpoint and then stops the active SSE stream. `Pause` calls `/api/agent/runs/:runId/pause`, emits `run.paused`, stops the active stream, and leaves continuation anchored on selected durable Agent execution nodes. `继续` and checkpoint rerun open context-aware drafts from the selected node/checkpoint; they do not create a parallel run-state truth.
- When the selected execution node is waiting for user input, the run control bar summarizes the waiting prompt, whether files/images can be added, any submitted response text, and submitted attachment count from durable `meta.agentExecution.waitingForUser`, so the bar explains the blocker instead of only showing a loading/running state.
- Hovering a checkpoint execution node shows transient canvas actions for continue, rerun, and new branch. These actions call the existing continuation draft path and do not write hover state to `PenDocument.pages`.
- `ask_user_more` text submission writes the response to the selected node's durable `meta.agentExecution.waitingForUser.response` and passes the submitted text as one-time continuation draft context. When the waiting-node continuation is sent with attachments, the prompt includes `waiting_attachment_count` and the created run writes the submitted count back to `waitingForUser.response.attachmentCount` on the same node. The draft prompt is not a second runtime truth; it only helps the next Agent turn read and act on the saved waiting-node response.
- Selected `critique` nodes read review findings from durable `meta.agentExecution.critique`. The property panel shows pass state, issue counts, severity, target node, reason, and suggested fix without reading validation tool output or run trace as runtime truth.
- Selected Agent execution nodes show a compact canvas selection-toolbar status badge derived from durable `meta.agentExecution.kind` and `meta.agentExecution.status`, giving users immediate waiting/running/done/failed/paused state on the canvas surface without creating a separate UI state source.
- Active-page Agent execution nodes in attention-worthy states (`waiting`, `running`, `failed`, `paused`) also show compact persistent canvas status markers derived from the same durable metadata. Clicking a marker selects that node through the normal canvas selection API; it does not mutate `PenDocument.pages`. Completed and currently selected nodes are omitted from this persistent layer to keep the canvas scannable; selection and hover surfaces still expose their full status details.
- The same persistent layer shows a compact active-page status summary for `failed`, `running`, `waiting`, and `paused` execution nodes. Clicking a non-zero summary chip selects the first matching execution node through the normal selection API. The summary is a read-only count over current `PenDocument.pages` nodes, not a run graph cache or persisted UI state.
- Hovering a non-checkpoint Agent execution node shows a read-only canvas summary card derived from the same durable `meta.agentExecution` fields, including waiting prompts, failure reasons, or pause summaries when those explain the current status. Hover state is transient UI state only; checkpoint nodes keep the dedicated hover action toolbar for continuation, rerun, and branch actions.
- `task_step` and `tool_call` property-panel details are expandable. Expanded state shows tool, input, output, reasoning, and error details from durable `meta.agentExecution.details` / `failure`; collapsed state keeps a result summary or failure reason visible, so users can scan the execution chain without reopening every detail panel.
- Selected Agent execution nodes resolve upstream/downstream IDs against active-page `PenDocument.pages` nodes for readable property-panel chain cards. Clicking an existing chain card selects that canvas node through the normal canvas selection API; missing referenced nodes are shown as an explicit unavailable state. No separate execution graph cache is created.
- Selected `comparison` nodes read their branch cards from active-page `PenNode.meta.agentExecution` branch nodes listed in `comparison.branchNodeIds`. The property panel shows branch strengths, risks, use cases, mainline/recommended status, continuation, and mainline selection without reading run trace as runtime truth.
- Selected Agent execution nodes build `<agent_execution_continue_context>` for the next chat turn with node ID, status, run/tool, upstream/downstream IDs, branch/comparison/checkpoint/waiting/failure summaries, submitted `waiting_response_text` for `ask_user_more` continuations, checkpoint `checkpoint_restart_reason` anchoring, failed-node `failure_attempted` / `failure_next_actions` recovery history, and the explicit recovery `intent` chosen by the UI action (`retry`, `rewrite`, `skip`, `rerun_checkpoint`, `attach_files`, `new_branch`, or `continue`). The "基于" chip in the chat input shows execution kind/status and exposes waiting/failure/checkpoint reasons in its hover title, so the selected-node continuation context is visible before send. This block is prompt-only guidance; tools must still inspect live `PenDocument.pages` before mutating canvas state.
- Manually added chat canvas references use `<canvas_node_references>` with live node IDs and, when the referenced node is an Agent execution node, the same durable metadata summary family: upstream/downstream IDs, branch/comparison/checkpoint/waiting/failure context, submitted waiting response text, attachment counts, checkpoint restart reason, and failed-node recovery history. The removable reference chip shows the execution kind/status and exposes waiting/failure/checkpoint reasons in its hover title so users can confirm why the reference matters before sending. These references are prompt guidance only; the Agent must still inspect the live `PenDocument.pages` node before editing.

## Node Types And Key Properties

| Node type | Runtime role | Key editable/runtime fields |
| --- | --- | --- |
| `frame` | Container, section, component source, Agent output unit | `children`, `width`, `height`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `clipContent`, `cornerRadius`, `cornerSmoothing`, `fill`, `stroke`, `effects`, `reusable`, `slot`, container/agent fields |
| `group` | Hierarchical grouping | `children`, layout fields, `isolated`, `fill`, `stroke`, `effects`, container/agent fields |
| `rectangle` | Shape or framed visual block | `width`, `height`, `cornerRadius`, layout fields, `fill`, `stroke`, `effects` |
| `ellipse` | Ellipse or arc | `width`, `height`, `innerRadius`, `startAngle`, `sweepAngle`, `fill`, `stroke`, `effects` |
| `line` | Line, arrow, connector | `x`, `y`, `x2`, `y2`, `connector`, `stroke`, `effects` |
| `polygon` | Polygon or star | `polygonCount`, `polygonKind`, `innerRadius`, `startAngle`, `width`, `height`, `cornerRadius`, `fill`, `stroke`, `effects` |
| `path` | Vector path or icon path | `d`, `anchors`, `closed`, `fillRule`, `width`, `height`, `fill`, `stroke`, `effects`, vector diagnostics |
| `text` | Text or rich text | `content`, `fontFamily`, `fontPostScriptName`, `fontSize`, `fontWeight`, `fontStyle`, `letterSpacing`, `lineHeight`, `paragraphSpacing`, `listStyle`, `indent`, `hangingIndent`, `baselineShift`, `textCase`, `openTypeFeatures`, `fontFallback`, `textAlign`, `textAlignVertical`, `textGrowth`, `underline`, `strikethrough`, `fill`, `effects` |
| `image` | Raster asset | `src`, `objectFit`, `width`, `height`, `cornerRadius`, `effects`, image adjustment fields, `imagePrompt`, `imageSearchQuery` |
| `icon_font` | Icon glyph/path lookup node | `iconFontName`, `iconFontFamily`, `width`, `height`, `fill`, `stroke` |
| `ref` | Component instance | `ref`, `descendants`, `children`, `componentRef` |
| `videoEmbed` | Video asset | `src`, `poster`, `mimeType`, `durationSeconds` |

Shared node fields include `id`, `name`, `role`, `explain`, `x`, `y`, `rotation`, affine `transform`, `scaleX`, `scaleY`, `skewX`, `skewY`, `blendMode`, `opacity`, `visible`, `locked`, `flipX`, `flipY`, `mask`, `styleRefs`, `componentRef`, `layoutConstraints`, `theme`, `contextSlots`, `inheritPolicy`, `agentBinding`, `permissions`, `ioPorts`, `createdByAgentId`, `runId`, and `sessionId`.

## Web Editor Tools

The bottom editor toolbar currently exposes these tools:

| Tool | Shortcut | Primary runtime effect | MCP equivalent |
| --- | --- | --- | --- |
| Select | `V` | Select, drag, resize, inspect, context actions | Not a canvas write tool. Agent reads selection through document/context, not by selecting UI. |
| Hand | `H`, hold Space | Pan viewport | No direct MCP. Agent can reason from viewport via `inspect_canvas` or screenshots but does not drive the hand tool. |
| Sticky | `S` | Creates a sticky-note container frame with sticky metadata and body text child | `manipulate_canvas.add_container` plus child text, or structured `batch_design`; sticky-specific UI metadata is currently Web-tool specific. |
| Section | `F` | Creates a section/container frame | `manipulate_canvas.add_container`, `design_skeleton`, or `batch_design` frame insertion. |
| Connector | `C` | Creates bound smooth connector lines between side anchors | `manipulate_canvas.add_line` with `start_element_id`/`end_element_id`, or structured line node writes. |
| Text | `T` | Creates/edits text nodes | `manipulate_canvas.add_text`, `manipulate_canvas.update_text`, or `batch_design` text nodes. |
| Rectangle | `R` | Draws rectangle node | `manipulate_canvas.add_shape` with `shape: "rectangle"` or `batch_design`. |
| Ellipse | `O` | Draws ellipse node | `manipulate_canvas.add_shape` with `shape: "ellipse"` or `batch_design`. |
| Polygon | none in toolbar | Draws polygon node | `batch_design` polygon node. Basic `manipulate_canvas.add_shape` does not expose polygon. |
| Line | `L` | Draws endpoint-based line | `manipulate_canvas.add_line` with `line_type: "line"`. |
| Arrow | `Shift+L` or `Shift+C` | Draws arrow line, preferably bound to elements | `manipulate_canvas.add_line` with `line_type: "arrow"` and element binding. |
| Path | `P` | Draws/edits vector path | `manipulate_canvas.add_path`, `manipulate_canvas.edit_path`, or `batch_design` path nodes. |

Toolbar commands:

- Undo and redo: Web runtime history only. No direct MCP operation.
- New container: Web command for `createContainer`. Agent equivalent is `manipulate_canvas.add_container` or structured frame insertion.
- Delete: Web command for selected nodes. Agent equivalent is `manipulate_canvas.delete` or `batch_design` `D(...)`.
- Import image: Web file/drop/upload path. Agent can insert generated image/video artifacts through generation tools, but cannot open the user's file picker through MCP.
- Import SVG: Web system/file import path. Agent can use `batch_design` path/shape nodes or `import_figma_clipboard` when given clipboard HTML; it does not read the user's clipboard implicitly.
- Insert icon: Web icon library inserts `icon_font` nodes. Agent can insert `icon_font` nodes with `batch_design` when it knows the icon name.

Additional editor functions:

- Page tabs: add, rename, duplicate, delete, reorder, set active page.
- Selection floating toolbar and context menu: lock/unlock, show/hide, group/ungroup, duplicate, delete, align, reorder, connector endpoint detach, sticky formatting.
- Boolean toolbar: vector/shape boolean operations for compatible selections.
- Layers panel: tree selection, visibility/lock toggles, reordering, moving nodes in hierarchy.
- Design-system panel: component marking/instances, variables, themes, icon insertion.
- Files panel and bottom bar: canvas asset visibility and panel navigation.
- Export: image export for full canvas, viewport, or explicit bounds.

## Property Inspector

The property panel writes `PenNode` and document fields. It should only expose controls whose values are consumed by renderer/layout/import/editability paths.

| Inspector section | Applies to | Runtime fields |
| --- | --- | --- |
| Selection header | selected node | `name`, type label, lock/visibility actions |
| Position | nodes with coordinates | `x`, `y` |
| Dimensions | nodes with size | `width`, `height` |
| Layout constraints | children of auto-layout parents | `layoutConstraints.widthMode`, `layoutConstraints.heightMode`, `layoutConstraints.alignSelf`, `layoutConstraints.positioning`, `layoutConstraints.grow` |
| Transform | all visual nodes | `rotation`, `scaleX`, `scaleY`, `skewX`, `skewY`, affine `transform` matrix |
| Appearance | visual nodes | `opacity`, `blendMode`, `visible`, `locked`, `clipContent`, `cornerRadius`, `cornerSmoothing`, `isolated` |
| Fill | nodes supporting fill | ordered `fill[]` layers: solid, linear/radial/angular/diamond gradient, image fill, per-layer visibility, opacity, blend mode, stops, transform/crop/original size |
| Stroke | nodes supporting stroke | `stroke.fill[]`, `stroke.thickness`, `align`, `join`, `cap`, endpoint tips, dash pattern, dash offset, miter limit |
| Effects | nodes supporting effects | ordered `effects[]`: shadow, inner shadow, blur, background blur, visibility, opacity, blend mode, shadow color/offset/blur/spread, blur radius |
| Text content | `text` nodes | `content`, rich text segments |
| Typography | `text` nodes | font family, PostScript name, size, weight, style, alignment, vertical alignment, growth mode, letter/line/paragraph spacing, list style, indents, baseline shift, case, OpenType features, fallback, underline, strikethrough |
| Auto layout | containers | `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, sizing fields, `clipContent` |
| Agent binding | containers | `agentBinding` with name, role/type/status/permissions metadata |
| Import layout | imported nodes | import auto-layout diagnostics from `meta`, not runtime truth |
| Variables | nodes and document variables | `$variableName` references and `PenDocument.variables` |
| Style references | imported/editable design references | `styleRefs`, `styleDefinitions` |
| Component | component sources and refs | `reusable`, `slot`, `ref`, `componentRef`, `descendants`, component property assignments and overrides |
| Mask | non-sticky regular nodes | `mask.enabled`, `mask.type`, `mask.sourceNodeId`, `mask.shouldBreakMaskChain` |
| Path/vector | `path` nodes | `d`, `fillRule`, `closed`, anchors, vector import diagnostics |
| Shape details | ellipse, polygon, line | ellipse arc fields, polygon/star fields, line endpoints |
| Selected colors | selected node | derived display of current fill/stroke/text colors |

Sticky-note exception: sticky containers intentionally do not expose mask editing. Sticky-specific controls live in the selection toolbar.

## CanvasApi Functions

The Web editor exposes a stable `CanvasApi`. It is the local UI/runtime contract, not itself an MCP protocol.

Document and live sync:

- `getDocument`, `setDocument`, `getDocumentVersion`, `applyDocumentPatch`, `flushPendingSave`
- RPC methods registered by `CanvasEditor`: `canvas.document.get`, `canvas.document.set`, `canvas.document.patch`, `canvas.screenshot`
- Live Agent RPC writes through `canvas.document.set` and `canvas.document.patch` commit to the same runtime `PenDocument.pages` state and immediately flush the Skia renderer, while normal UI document commits still use the animation-frame coalesced renderer sync path.

Pages:

- `getActivePageId`, `setActivePage`, `getPages`, `addPage`, `renamePage`, `duplicatePage`, `deletePage`, `reorderPage`

Tools and creation:

- `getActiveTool`, `setActiveTool`
- `createContainer`, `createSection`, `createSticky`, `createConnector`, `detachConnectorEndpoint`
- `insertNode`, `updateNode`, `deleteNode`, `bindAgentToContainer`

Selection, history, hierarchy:

- `setSelection`, `undo`, `redo`, `canUndo`, `canRedo`
- `copySelection`, `pasteClipboard`, `duplicateSelection`, `deleteSelection`
- `groupSelection`, `ungroupSelection`, `alignSelection`
- `reorderNode`, `moveNodeToIndex`, `toggleNodeLocked`, `toggleNodeVisible`

Import/export/assets:

- `pasteFromSystemClipboard`, `importSvgMarkup`
- `insertImageArtifact`, `insertVideoArtifact`
- `exportImage`, `addFiles`, `getFiles`

Viewport and scene:

- `getViewportBounds`, `getSceneElements`, `getAppState`, `updateScene`, `onChange`, `scrollToContent`

## Canvas Core Operations

`packages/canvas-core/src/operations.ts` applies page-aware transactions over the current `PenDocument`.

Supported operation types:

- `insertNode`
- `updateNode`
- `deleteNode`
- `setSelection`
- `moveNode`
- `groupNodes`
- `ungroupNode`
- `alignNodes`
- `reorderNode`
- `bindAgent`
- `createDataFlowEdge`
- `removeDataFlowEdge`

The core operation truth is intentionally smaller than the full UI. Complex Agent actions are expressed as node inserts/updates or structured canvas DSL operations, then reconciled through the same document model.

## Agent And MCP Access

The main Agent receives tools from `createMainAgentTools`. That function creates the Cucumber MCP-compatible in-memory server and bridges its listed tools into Deep Agents/LangChain via `bridgeMcpServerToolsToDeepAgent`.

Required live canvas chain:

1. Web editor opens a canvas.
2. Browser WebSocket sends `canvas.bind` with `canvasId`.
3. `CanvasEditor` registers `canvas.document.get`, `canvas.document.set`, `canvas.document.patch`, and `canvas.screenshot`.
4. `LiveCanvasService` checks canvas access, then RPCs to the bound browser editor.
5. MCP-compatible tools read or write the live document.

If the canvas page is not open, live canvas writes fail with `live_canvas_unavailable` instead of silently falling back to stale persistence.

### MCP-Compatible Canvas Tools

| Tool | Agent can call through MCP? | What it does |
| --- | --- | --- |
| `inspect_canvas` | Yes | Reads live document summaries, full node details, type filters, and region filters. |
| `inspect_canvas_semantic` | Yes | Reads the live canvas as AI workspace context: active or explicit page summary, semantic containers, selected/focus nodes, connector dataflow edges, referenced assets, optional variables/themes, and warnings without mutating the document. |
| `get_selection_context` | Yes | Reads the current live canvas selection as the user's intent anchor, including selected node summaries, parent container paths, effective context slots, optional related nodes, and capability flags with disabled reasons. |
| `canvas_diff_preview` | Yes | Previews a `CanvasOperation[]` transaction against the latest live document without mutating it, returning affected node IDs, created/updated/deleted/moved IDs, affected bounds, high-risk changes, preview warnings, and a transaction ID candidate. |
| `apply_canvas_transaction` | Yes | Applies a page-aware `CanvasOperation[]` transaction through `LiveCanvasService.patchDocument`, with dry-run support, live version protection, optional selection update, affected-node reporting, and validation preview warnings. |
| `layout_canvas` | Yes | Applies conservative layout intent through `updateNode` operations or container layout field updates, covering auto-layout fields, stack, grid, flow, avoid-overlap, and align/distribute for one parent coordinate space. |
| `query_canvas_assets` | Yes | Reads `PenDocument.assets` and live node asset references, returning asset metadata, referenced node IDs, concrete node field references, and missing document-asset references. |
| `replace_asset_in_node` | Yes | Replaces an image/video node source or image fill while preserving node identity and bounds, optionally upserting a `PenDocument.assets` record and committing through versioned canvas patch transactions. |
| `connect_nodes` | Yes | Creates a bound semantic connector `LineNode` between visible connector-capable nodes, choosing endpoint sides from scene bounds and committing through versioned canvas patch transactions. |
| `resize_container_to_fit` | Yes | Resizes a frame/group container to fit visible descendant content with padding, returning previous/next/content bounds, affected child IDs, and fit warnings. |
| `create_agent_execution_flow` | Yes | Creates the unified durable Agent execution chain for image generation, design, structured canvas editing, and continuation-oriented tasks: user goal, Recipe, task steps, optional tool-call nodes, critique, final deliverable, checkpoint, and semantic connectors, all tagged with `meta.agentExecution` upstream/downstream links for UI inspection and future continuation controls. When a step uses `generate_image`, the final deliverable is sized as a visual result container and `generate_image` should target that node. |
| `create_agent_ask_user_more` | Yes | Creates a durable `ask_user_more` execution node when the Agent needs user text/file/image input before continuing, storing the waiting prompt and file acceptance flag on `meta.agentExecution.waitingForUser`, updating upstream execution-node downstream links, adding a semantic connector, and selecting the waiting node for direct property-panel response. |
| `create_agent_evidence` | Yes | Creates a durable `evidence` execution node for URL, asset, canvas-node, text, or search-result sources, storing provenance on `meta.agentExecution.evidence`, updating upstream execution-node downstream links, adding a semantic connector, and selecting the evidence node so sources become inspectable canvas context rather than chat-only references; selected evidence nodes expose source type/name, URL/asset/node IDs, confidence, and URL open action in the Web property panel. |
| `record_agent_tool_call` | Yes | Writes tool execution input/output/reasoning/error details, status, tool call ID, and failure recovery context into an existing durable `tool_call` or `task_step` execution node, updating visible node text and `meta.agentExecution` so the property panel can explain what happened without reading run trace as runtime truth. Recovery history can be appended with `appendAttempted` / `appendNextActions`; new failed-state write-back must provide `failure.reason` or `errorReason`, and non-failed write-back clears stale `failure` metadata. |
| `create_agent_variant_branches` | Yes | Creates durable multi-solution `variant_branch` nodes and a `comparison` node with per-branch plan/product/critique summaries, strengths, risks, use cases, recommended/mainline metadata, semantic connectors, dry-run preview, version protection, and selection of the comparison node. |
| `select_agent_variant_branch` | Yes | Persists a user or Agent branch decision by setting one `variant_branch` as the unique mainline/recommended branch within its `comparison`, updating sibling branch metadata, the comparison recommendation text, visible branch styling, dry-run preview, version protection, and selection of the chosen branch. |
| `create_agent_output_container` | Yes | Creates the canonical durable Agent output `FrameNode` with container role, context slots, agent binding, IO ports, run/session metadata, optional children, deterministic placement, and versioned patch support. |
| `validate_canvas` | Yes | Runs deterministic live canvas checks for page/node structure, duplicate or missing node IDs, missing assets, missing variables, dangling connectors, likely fixed-text overflow, invalid component refs, and hidden/locked Agent output. |
| `canvas_memory_index` | Yes | Builds a read-only searchable memory index from live `PenDocument.pages` nodes, context slots, Agent bindings, run/session metadata, and text content, explicitly marking that no persisted memory truth was written. |
| `critique_canvas` | Yes | Runs a read-only deterministic critique for hierarchy, visual consistency, brand/style context, container role clarity, deliverable completeness, and validation summary, returning node-grounded findings and suggested fixes. |
| `record_agent_critique` | Yes | Writes validation or critique results into an existing durable `critique` execution node, updating `meta.agentExecution`, visible text content, selection, version protection, and diagnostics while rejecting non-critique targets. |
| `export_canvas_deliverable` | Yes | Exports selected or explicit live canvas nodes as traceable structured JSON, flow specs, or component specs with root/source node IDs, scene bounds, referenced assets, and validation summary; unsupported render/code/deck targets return explicit reasons. |
| `canvas_run_trace` | Yes | Reads recent Agent stream events plus live run-bound canvas nodes, returning tool calls, canvas patch transaction IDs, affected node IDs, active/requested run context, and explicit event-buffer availability without mutating the canvas. |
| `screenshot_canvas` | Yes | Captures full, region, or viewport screenshots through the browser `canvas.screenshot` RPC for visual verification, now listed in the MCP registry as well as the existing direct Agent tool path. |
| `manipulate_canvas` | Yes | Applies common canvas operations in batches. |
| `batch_get` | Yes | Reads/searches live canvas nodes by IDs, patterns, parent, depth, and page. |
| `batch_design` | Yes | Applies structured DSL operations `I/C/U/R/M/D` against the live canvas. |
| `snapshot_layout` | Yes | Reads hierarchy, bounds, and optional layout problems. |
| `find_empty_space` | Yes | Finds open placement space around a node or canvas content. |
| `add_page` | Yes | Adds a live canvas page. |
| `remove_page` | Yes | Removes a page, except the last page. |
| `rename_page` | Yes | Renames a page. |
| `reorder_page` | Yes | Moves a page to an index. |
| `duplicate_page` | Yes | Duplicates a page and regenerates node IDs. |
| `design_skeleton` | Yes | Creates a root frame and section frames for layered design output. |
| `design_content` | Yes | Inserts content nodes into a section frame. |
| `design_refine` | Yes | Validates/refines/snapshots layered design tree. |
| `import_figma_clipboard` | Yes, with provided HTML | Imports Figma clipboard HTML into editable Pen nodes. |
| `read_nodes` | Yes | Reads nodes for codegen, optionally including variables/themes. |
| `search_all_unique_properties` | Yes | Recursively collects unique style values under parent nodes. |
| `replace_all_matching_properties` | Yes | Recursively replaces matching style values under parent nodes. |
| `get_variables` | Yes | Reads document variables and themes. |
| `set_variables` | Yes | Merges or replaces document variables. |
| `set_themes` | Yes | Merges or replaces theme axes. |
| `prompt_canvas_plan` | Yes | Creates a deterministic prompt-to-canvas plan without writing the canvas. |
| `prompt_canvas_execute` | Yes | Materializes a stored prompt plan into the live canvas. |
| `codegen_plan` | Yes | Validates and stores a design-to-code plan. |
| `codegen_submit_chunk` | Yes | Submits codegen chunk results. |
| `codegen_assemble` | Yes | Assembles generated code for a framework. |
| `codegen_export` | Yes | Exports selected or explicit nodes to React, HTML, or Vue. |
| `codegen_clean` | Yes | Clears stored codegen plan state. |

Adjacent MCP-compatible non-canvas tools registered in the same server include `project_search`, `generate_image`, `generate_video`, and `persist_sandbox_file`. They can produce or persist canvas-adjacent assets, but they are not general canvas editor controls.

### `manipulate_canvas` Actions

`manipulate_canvas` supports these actions:

- Geometry and lifecycle: `move`, `resize`, `delete`, `duplicate`, `rotate`, `flip`
- Creation: `add_container`, `add_text`, `add_shape`, `add_line`, `add_path`
- Text/style: `update_text`, `update_style`, `gradient_fill`, `effects`
- Layout: `auto_layout`
- Hierarchy: `group`, `ungroup`, `reorder`
- Multi-node layout: `align`, `distribute`
- Vector: `edit_path`, `boolean_ops`
- State: `lock`, `unlock`

Same-batch operations can reference earlier created IDs as `op_0`, `op_1`, and so on.

### Direct Agent Tools Outside The Canvas MCP Tool Set

`screenshot_canvas` is still injected as a direct LangChain tool when a `connectionManager` exists, and is also registered as an MCP-compatible Cucumber canvas tool. Both paths call browser RPC `canvas.screenshot`, support `full`, `region`, and `viewport`, and can persist the screenshot to a short URL when image persistence is available.

The Deep Agents filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`, `task`, `write_todos`) are provided by middleware and are also not Cucumber canvas MCP tools.

### Not Directly MCP-Callable

These are UI/runtime functions, not exposed as MCP tools:

- Switching the active Web toolbar tool with `setActiveTool`
- Opening native file pickers or reading the user's clipboard without explicit payload
- Undo/redo of Web runtime history
- Panning with the hand tool
- Hover state, marquee state, transient drag/resize previews
- Local panel tab navigation
- Local keyboard shortcuts
- Sticky-specific floating toolbar affordances as UI gestures

The Agent can usually achieve the durable outcome by writing the underlying `PenDocument`, but it cannot perform those UI gestures through MCP.

## Responsibility Checklist For Future Changes

When adding canvas tools, properties, or Agent operations, update this document and answer:

1. What is the single runtime truth field?
2. Is any old field only migration input or diagnostic provenance?
3. Which Web UI control writes it?
4. Which renderer/layout/import/persistence path consumes it?
5. Is there an MCP-compatible Agent tool for it?
6. If not MCP-callable, is the durable outcome still achievable through structured node writes?
7. What happens when the live editor is not open?
