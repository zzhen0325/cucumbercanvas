# Cucumber Studio Progress

Last updated: 2026-06-03 CST

## 2026-06-03

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
