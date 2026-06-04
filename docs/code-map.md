# Cucumber Studio 代码地图

当你需要快速定位某个产品能力对应的代码时，先看这份文档。它的职责是做导航地图，不是完整源码清单。

建议和这些文件一起使用：

- [`docs/architecture.md`](./architecture.md)：系统级职责归属和运行时流程。
- [`feature_list.json`](../feature_list.json)：已登记功能的状态、优先级和主要产物。
- [`progress.md`](../progress.md)：最近交接记录、校验结果和已知问题。
- [`docs/tech/`](./tech/)：具体能力的技术计划和专题说明。
- [`docs/tech/canvas-node-figma-fusion.md`](./tech/canvas-node-figma-fusion.md)：节点系统与 Figma-like 画布能力的同一真值融合边界。
- [`docs/tech/canvas-node-figma-fusion-code-map.md`](./tech/canvas-node-figma-fusion-code-map.md)：按执行节点语义和 Figma-like 物理编辑整理当前代码归属。

## 使用方式

1. 先从下面的能力表找到你要改的功能域。
2. 编码前先打开表里的真值入口文件。
3. 从入口继续追到对应 service、hook、测试和 shared contract。
4. 如果表格过粗或已经过时，用下面的 `.codegraph` 查询命令查 symbol 和调用关系。
5. 只有稳定功能域、职责边界或主入口发生变化时，才更新这份文档。

## 职责边界

- 运行时画布真值：`PenDocument.pages` 加合法的 `activePageId`。
- 画布文档契约：`packages/pen-types` 和 `packages/canvas-core`。
- 画布渲染与命中测试：`packages/pen-renderer`。
- 前端画布编辑状态：`apps/web/src/components/canvas/canvas-runtime-store.ts`。
- 前端画布公开变更接口：`apps/web/src/components/canvas/canvas-api.ts`。
- 服务端画布持久化和 live editor RPC：`apps/server/src/features/canvas/`。
- Agent 可调用的画布工具：`apps/server/src/mcp/tools/`，并在 `apps/server/src/mcp/server.ts` 注册。
- 跨 app 契约：`packages/shared/src/`。

旧的 flat-map 或 root-children 画布数据不是运行时兼容路径。如果核心运行时遇到这类数据，应抛出清晰错误，并在边界层或单独迁移/数据修复任务里处理。

## 产品能力地图

| 能力 | 先看这里 | 继续追到 | 测试 / 校验 |
| --- | --- | --- | --- |
| 画布 page/document 模型 | `packages/canvas-core/src/document.ts`, `packages/canvas-core/src/pages.ts`, `packages/pen-types/src/pen.ts` | `packages/canvas-core/src/operations.ts`, `packages/canvas-core/src/history.ts`, `packages/canvas-core/src/types.ts` | `packages/canvas-core/src/__tests__/pages.test.ts`, `packages/canvas-core/src/__tests__/canvas-core.test.ts` |
| 节点系统与 Figma-like 融合边界 | `docs/tech/canvas-node-figma-fusion.md`, `docs/tech/canvas-node-figma-fusion-code-map.md`, `docs/tech/canvas-tooling-capability-map.md` | `packages/canvas-core/src/agent-execution.ts`, `packages/canvas-core/src/connector-geometry.ts`, `apps/server/src/mcp/tools/inspect-canvas-semantic.ts`, `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx` | 涉及代码时优先跑对应 canvas-core、MCP tool、property-panel 测试 |
| 画布编辑器外壳 | `apps/web/src/components/canvas-editor.tsx`, `apps/web/src/app/canvas/page.tsx` | `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas/editor-toolbar.tsx`, `apps/web/src/components/canvas/page-tabs.tsx` | `apps/web/test/`, `tests/e2e/skia-canvas.spec.ts` |
| 画布运行时状态和 API | `apps/web/src/components/canvas/canvas-runtime-store.ts`, `apps/web/src/components/canvas/canvas-api.ts` | `apps/web/src/components/canvas/canvas-api-facade.ts`, `apps/web/src/components/canvas/use-skia-canvas-api.ts`, `apps/web/src/components/canvas/canvas-runtime-utils.ts` | `apps/web/test/canvas-runtime-store.test.ts`, `apps/web/test/canvas-api-types.test.ts` |
| 画布渲染和交互 | `apps/web/src/components/canvas/skia-canvas.tsx`, `packages/pen-renderer/src/renderer.ts` | `packages/pen-renderer/src/node-renderer.ts`, `packages/pen-renderer/src/document-flattener.ts`, `packages/pen-renderer/src/spatial-index.ts`, `apps/web/src/components/canvas/use-skia-pointer-interactions.ts` | `packages/pen-renderer/src/*.test.ts`, `apps/web/test/skia-canvas-selection-snapshot.test.tsx` |
| 选择、快捷键、工具栏动作 | `apps/web/src/components/canvas/use-skia-keyboard-and-toolbar-actions.ts`, `apps/web/src/components/canvas/use-canvas-keyboard-shortcuts.ts` | `apps/web/src/components/canvas/canvas-selection-helpers.ts`, `apps/web/src/components/canvas/editor-toolbar.tsx`, `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx` | `apps/web/test/use-canvas-keyboard-shortcuts.test.tsx`, `apps/web/test/canvas-property-panel.test.tsx` |
| 便签和容器 | `apps/web/src/components/canvas/sticky-note-tool.ts`, `packages/canvas-core/src/operations.ts` | `apps/web/src/components/canvas/skia-container-overlay.ts`, `packages/pen-renderer/src/renderer.ts`, `packages/canvas-core/src/connector-geometry.ts` | `apps/web/test/sticky-note-tool.test.ts`, `packages/canvas-core/src/__tests__/connector-geometry.test.ts` |
| 线、箭头、连接器 | `packages/canvas-core/src/connector-geometry.ts`, `apps/web/src/components/canvas/canvas-draw-geometry.ts` | `packages/canvas-core/src/line-geometry.ts`, `packages/pen-renderer/src/renderer.ts`, `apps/web/src/components/canvas/skia-dataflow-layer.ts` | `packages/canvas-core/src/__tests__/connector-geometry.test.ts`, `packages/pen-renderer/src/renderer-performance.test.ts` |
| 导入、粘贴和 Figma 保真 | `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/clipboard.ts`, `packages/canvas-core/src/figma-native.ts` | `packages/pen-figma/src/`, `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`, `apps/web/src/components/canvas/use-canvas-import-actions.ts`, `apps/web/src/components/canvas/canvas-import-diagnostics.ts` | `packages/canvas-core/src/__tests__/figma-native-adapter.test.ts`, `tests/e2e/canvas-import.spec.ts`, `apps/web/test/use-canvas-clipboard-import.test.tsx` |
| 画布导出 | `apps/web/src/components/canvas/canvas-export.ts`, `packages/canvas-core/src/import.ts` | `packages/pen-renderer/src/render-node-thumbnail.ts`, `apps/server/src/mcp/tools/export-canvas-deliverable.ts` | `apps/web/test/canvas-export.test.ts`, `apps/server/src/mcp/tools/canvas-export-deliverable-tools.test.ts` |
| 服务端画布持久化 | `apps/server/src/features/canvas/canvas-service.ts`, `apps/server/src/http/canvases.ts` | `apps/server/src/features/canvas/canvas-element-writer.ts`, `apps/server/src/supabase/`, `packages/shared/src/` | `apps/server/src/features/canvas/canvas-service.test.ts`, `apps/server/src/features/canvas/canvas-element-writer.test.ts` |
| Agent 工具的 live canvas RPC | `apps/server/src/features/canvas/live-canvas-service.ts`, `apps/server/src/http/live-canvases.ts` | `apps/web/src/components/canvas/canvas-api.ts`, `apps/server/src/agent/deep-agent.ts`, `apps/server/src/agent/runtime.ts` | `apps/server/src/features/canvas/live-canvas-service.test.ts` |
| Agent runtime | `apps/server/src/agent/runtime.ts`, `apps/server/src/agent/deep-agent.ts` | `apps/server/src/agent/backends/`, `apps/server/src/agent/prompts/cucumber-main.ts`, `apps/server/src/agent/stream-adapter.ts`, `apps/server/src/agent/run-event-pump.ts` | `apps/server/src/agent/*.test.ts`, `apps/server/src/mcp/deepagents-bridge.test.ts` |
| MCP 和 Agent tools | `apps/server/src/mcp/server.ts`, `apps/server/src/mcp/deepagents-bridge.ts` | `apps/server/src/mcp/tools/`, `apps/server/src/mcp/schema.test.ts`, `apps/server/src/agent/tools/` | `apps/server/src/mcp/tools/*test.ts`, `apps/server/src/mcp/schema.test.ts` |
| AI 原生画布语义工具 | `apps/server/src/mcp/tools/inspect-canvas-semantic.ts`, `apps/server/src/mcp/tools/ai-native-canvas-context.ts` | `apps/server/src/mcp/tools/get-selection-context.ts`, `apps/server/src/mcp/tools/apply-canvas-transaction.ts`, `apps/server/src/mcp/tools/validate-canvas.ts`, `docs/tech/ai-native-canvas-agent-capability-plan.md` | `apps/server/src/mcp/tools/canvas-transaction-tools.test.ts`, `apps/server/src/mcp/tools/canvas-validation-tools.test.ts`, `apps/server/src/mcp/tools/get-selection-context.test.ts` |
| 图片和视频生成 | `apps/server/src/generation/`, `apps/server/src/features/jobs/job-service.ts`, `apps/server/src/features/jobs/job-executor.ts` | `apps/server/src/generation/providers/seedream.ts`, `apps/server/src/queue/task-manager.ts`, `apps/server/src/http/generate.ts`, `apps/server/src/worker.ts` | `apps/server/src/generation/providers/*test.ts`, `apps/server/src/queue/*test.ts` |
| Chat 和流式 UI | `apps/web/src/hooks/use-chat-stream.ts`, `apps/web/src/components/chat/message-list.tsx` | `apps/web/src/hooks/use-sse-stream.ts`, `apps/web/src/hooks/use-websocket.ts`, `apps/server/src/http/chat.ts`, `apps/server/src/ws/handler.ts` | `apps/server/src/http/sse.test.ts`, `apps/server/src/ws/*.test.ts`, `tests/e2e/transport.spec.ts` |
| 项目和工作区首页 | `apps/web/src/app/(workspace)/projects/`, `apps/web/src/hooks/use-create-project.ts` | `apps/server/src/features/projects/project-service.ts`, `apps/server/src/http/projects.ts`, `apps/web/src/lib/home-*.ts` | `apps/server/src/features/projects/project-service.test.ts`, `apps/web/test/projects.test.tsx` |
| Brand Kit | `apps/web/src/components/brand-kit/brand-kit-page.tsx`, `apps/server/src/features/brand-kit/brand-kit-service.ts` | `apps/web/src/lib/brand-kit-api.ts`, `apps/server/src/http/brand-kits.ts`, `packages/shared/src/brand-kit-contracts.ts` | 有对应 web/server 测试时优先跑对应测试 |
| Skills | `skills/`, `apps/server/src/agent/workspace-skills.ts` | `apps/server/src/features/skills/`, `apps/server/src/http/skills.ts`, `apps/server/src/http/skills-marketplace.ts`, `apps/web/src/components/skills/` | 有 skill import 和 marketplace service 测试时优先跑对应测试 |
| Auth 和 settings | `apps/web/src/lib/auth-context.tsx`, `apps/server/src/http/settings.ts` | `apps/server/src/features/settings/settings-service.ts`, `apps/server/src/http/auth-verification-error.ts`, `apps/web/src/app/(workspace)/settings/` | 未明确要求时不要修改 auth 逻辑 |
| 上传和持久化资产 | `apps/server/src/features/uploads/upload-service.ts`, `apps/server/src/http/uploads.ts` | `apps/web/src/components/canvas/canvas-raster-upload.ts`, `apps/server/src/http/image-proxy.ts` | 有对应上传或画布持久化测试时优先跑对应测试 |

## 常用文件搜索

在仓库根目录使用 `rg`：

```bash
rg -n "LiveCanvasService|inspect_canvas_semantic|apply_canvas_transaction" apps/server/src packages
rg -n "CanvasRuntimeStore|CanvasApi|SkiaCanvas" apps/web/src packages
rg -n "PenDocument|activePageId|pages" packages apps
rg -n "background_jobs|TaskManager|Seedream|generate_image" apps/server/src packages/shared/src
rg -n "BrandKit|brand-kit" apps packages
```

## 查询 `.codegraph`

仓库当前有一个 SQLite symbol 索引：`.codegraph/codegraph.db`。里面包含 `files`、`nodes`、`edges`，并通过 `nodes_fts` 支持全文搜索。

查看索引规模：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select language, count(*) as files, sum(node_count) as nodes from files group by language order by files desc;"
```

按近似名称搜索 symbol：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select kind, name, file_path, start_line
   from nodes
   where lower(name) like lower('%LiveCanvas%')
   order by file_path, start_line
   limit 50;"
```

用 FTS 搜索 symbol：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select n.kind, n.name, n.file_path, n.start_line
   from nodes_fts f
   join nodes n on n.id = f.id
   where nodes_fts match 'LiveCanvasService OR inspect_canvas_semantic'
   order by rank
   limit 25;"
```

列出单个文件里的 symbol：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select kind, name, start_line, end_line
   from nodes
   where file_path = 'apps/server/src/features/canvas/live-canvas-service.ts'
   order by start_line;"
```

查某个 symbol 的外向依赖：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select e.kind, target.kind as target_kind, target.name as target_name, target.file_path, target.start_line
   from nodes source
   join edges e on e.source = source.id
   join nodes target on target.id = e.target
   where source.name = 'createCucumberDeepAgent'
   order by e.kind, target.file_path, target.start_line
   limit 50;"
```

查某个 symbol 的被引用位置：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select e.kind, source.kind as source_kind, source.name as source_name, source.file_path, source.start_line
   from nodes target
   join edges e on e.target = target.id
   join nodes source on source.id = e.source
   where target.name = 'LiveCanvasService'
   order by source.file_path, source.start_line
   limit 50;"
```

如果查询没有结果，先确认 symbol 名称是否存在：

```bash
sqlite3 -header -column .codegraph/codegraph.db \
  "select kind, name, qualified_name, file_path, start_line
   from nodes
   where lower(qualified_name) like lower('%canvas%semantic%')
   order by file_path, start_line
   limit 50;"
```

## 更新这份地图

新增稳定功能域时：

1. 在 `产品能力地图` 里增加一行。
2. 只链接主入口，不把每个 helper 都塞进来。
3. 补上附近测试或推荐校验命令。
4. 只有功能登记的 ownership、scope、status 或 artifacts 变化时，才更新 `feature_list.json`。
5. 如果这次变更值得交接，再更新 `progress.md`。

不要把这份文档当成 contract、schema、migration 或 tool behavior 的运行时真值。这些真值应该留在代码和相邻技术文档里。
