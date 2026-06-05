# Agent Runtime Workflow And Tool Inventory

Last reviewed: 2026-06-05

## 目的

这份文档按当前实际代码梳理 Cucumber Studio Agent 的完整执行链路：用户如何发起 run、服务端如何装配上下文和 Deep Agent、模型如何获取信息、工具如何被调用、流事件如何回到聊天和画布、图片/视频等长任务如何进入 job/worker、暂停/继续/失败如何恢复。

覆盖的主要代码入口：

- `apps/web/src/hooks/use-agent-run-controller.ts`
- `apps/web/src/components/canvas-agent-composer.tsx`
- `apps/web/src/components/chat-input-context.ts`
- `apps/web/src/components/canvas/use-canvas-prompt-draft-node.ts`
- `apps/web/src/components/canvas/use-canvas-agent-execution-stream-writeback.ts`
- `apps/server/src/app.ts`
- `apps/server/src/http/runs.ts`
- `apps/server/src/http/sse.ts`
- `apps/server/src/ws/handler.ts`
- `apps/server/src/agent/runtime.ts`
- `apps/server/src/agent/deep-agent.ts`
- `apps/server/src/agent/stream-adapter.ts`
- `apps/server/src/agent/run-event-pump.ts`
- `apps/server/src/mcp/server.ts`
- `apps/server/src/features/canvas/live-canvas-service.ts`
- `apps/server/src/features/jobs/`

## 唯一真值和边界

当前执行链路里有几类不同真值，不要混用：

- Run 生命周期真值：`AgentRunService` 内存里的 `RuntimeRunRecord`；如果存在持久化 `threadId`，同步写 `agent_runs` 元数据。
- 聊天消息真值：用户消息先由前端本地插入并异步 `saveMessage`；assistant 消息由 `RunEventPump` 聚合 `message.delta` 和工具事件后写入 `chat_messages`。
- 流事件真值：运行期事件统一为 `StreamEvent`，写入 `CanvasEventBuffer`，再经 SSE `/api/canvases/:canvasId/stream` 给前端。
- 画布文档真值：运行时只支持 `PenDocument.pages` + 有效 `activePageId`。Agent 工具的 live 读写以 `LiveCanvasService` 通过浏览器 RPC 访问的当前编辑器文档为准。
- 自动 `<canvas_state>` 上下文：由服务端从 Supabase `canvases.content` 读取并摘要化，不是直接从 live editor RPC 读取。
- Durable Agent 执行链真值：画布节点 `meta.agentExecution`，类型定义在 `packages/canvas-core/src/agent-execution.ts`。
- 媒体 job 真值：`background_jobs` + `tasks` + `project-assets`/`asset_objects`；worker 完成后将结果回写 job result，必要时插入画布元素。
- Skill 真值：系统 skill 来自 `/skills/` 文件系统；workspace skill 来自 DB，运行前写入 StoreBackend 的 `/workspace-skills/` 虚拟路径。

## 总体链路

```text
用户输入
  -> 前端构造 prompt / 附件 / mention / continuation / canvasEntry
  -> POST /api/agent/runs
  -> AgentRunService.createRun 保存 RuntimeRunRecord
  -> RunEventPump 异步消费 AgentRunService.streamRun
  -> runtime 装配 persistence / backend / skills / brand kit / model / tools
  -> createCucumberDeepAgent()
  -> agent.streamEvents({ messages }, configurable)
  -> adaptDeepAgentStream 转成 StreamEvent
  -> CanvasEventBuffer 发布和缓存
  -> SSE 客户端接收并更新聊天、画布执行节点、产物插入状态
  -> RunEventPump 聚合 assistant message 并落库
```

## 应用启动和服务装配

`apps/server/src/app.ts` 是服务端装配入口：

- `registerAllProviders(env)` 注册图片/视频 provider。
- 创建 `ConnectionManager`，负责 WebSocket 连接、canvas 绑定和浏览器 RPC。
- 创建 `LiveCanvasService`，封装 `canvas.document.get` / `canvas.document.set` / `canvas.document.patch`。
- 创建 `CanvasEventBuffer`，作为 SSE 重连和运行事件缓存。
- 创建 `AgentRunService`，注入 persistence、run metadata、connectionManager、eventBuffer、jobService、liveCanvasService、model/env。
- 创建 `RunEventPump`，负责后台消费 run stream、发布事件、聚合 assistant 消息。
- 注册 `/api/agent/runs`、`/api/canvases/:canvasId/stream`、`/api/ws` 等路由。

如果 `CUCUMBER_SUPABASE_DB_URL` 存在，会创建 `TaskManager` 和 `JobService`，`generate_image` / `generate_video` 可以走异步 job/worker；否则工具可退到直接 provider 调用路径。

## 前端发起 run 的流程

### 聊天侧普通发送

主要文件：`apps/web/src/hooks/use-agent-run-controller.ts`、`apps/web/src/components/chat-input.tsx`、`apps/web/src/components/chat-sidebar.tsx`。

1. 用户输入文本、附件、mention、Recipe 或选中画布节点继续执行。
2. `formatAgentExecutionContinuationPrompt()` 把以下上下文 prepend 到 prompt：
   - `<agent_recipe_template>`
   - `<agent_execution_continue_context>`
   - `<canvas_node_references>`
3. 前端本地追加 user message，并异步调用 `saveMessage()` 落库。
4. 前端创建空 assistant message，开始 streaming 状态。
5. `createRun()` POST `/api/agent/runs`，请求体来自 `RunCreateRequest`：
   - `sessionId`
   - `conversationId`
   - `prompt`
   - `canvasId`
   - `canvasEntry`
   - `attachments`
   - `imageGenerationPreference`
   - `videoGenerationPreference`
   - `mentions`
   - `model`
6. run 接受后，前端通过 `useSseStream()` 连接 `/api/canvases/:canvasId/stream`，只消费匹配 `runId` 的事件。

### 画布底部输入框 compact 入口

主要文件：`apps/web/src/components/canvas-agent-composer.tsx`、`apps/web/src/components/canvas/use-canvas-prompt-draft-node.ts`、`apps/web/src/app/canvas/page.tsx`。

1. 用户在画布底部输入时，`syncDraftText()` 创建或更新一个 `input_node` draft 节点。该节点是 Agent 轻节点的一等输入容器，使用 Skia 自定义组件视觉，不是普通 Figma-like 子节点拼装。
2. 发送时 `prepareEntryForSend()`：
   - 将 `input_node` 标记为 `done`。
   - 在其下方创建一个 `agent_run_node` / `AgentRunNode` 节点，summary 初始为 `Thinking...`。
   - 创建一条连接线。
   - 返回 `canvasEntry = { userGoalNodeId, agentExecutionNodeId }`。
3. 底部输入框发送成功后清空，下一次输入会创建新的 `input_node`。点击画布中的 `input_node` 只选择画布节点，不会反向同步到底部输入框；同步方向是输入框 -> 画布节点。
4. 画布页 `onBeforeRun` 会先 `flushPendingSave()`，尽量把刚创建的入口节点持久化。
5. 请求体携带 `canvasEntry`。
6. 服务端 `buildUserMessage()` 注入：

```xml
<canvas_agent_entry mode="compact_single_execution_node">
  <input_node id="..." />
  <agent_run_node id="..." />
  <instruction>...</instruction>
</canvas_agent_entry>
```

7. 系统 prompt 明确要求：这条 compact 流程已经有入口节点，模型不要再调用 `create_agent_execution_flow` 创建多节点入口链；本轮 `agent.stage`、工具摘要和 assistant 文本由客户端写回同一个 `agent_run_node` 节点。
8. `useCanvasAgentExecutionStreamWriteback()` 根据 `run.started`、`agent.stage`、`thinking.delta`、`message.delta`、`tool.started`、`tool.completed`、`run.completed`、`run.failed` 等事件持续更新该节点的 `meta.agentExecution` 和展示子节点。

### 选中执行节点继续、暂停后继续、等待补充后继续

主要文件：`apps/web/src/components/chat-input-context.ts`。

前端从选中的 Agent execution 节点读取 `meta.agentExecution`，构造 `<agent_execution_continue_context>`。它可能包含：

- `mode`: `new_branch` 或 `overwrite_current`
- `intent`: `continue`、`retry`、`rewrite`、`skip`、`rerun_checkpoint`、`attach_files`、`new_branch`
- 当前节点 ID、kind、status、runId、toolName
- upstream/downstream 节点 ID
- variant branch 和 comparison 信息
- checkpoint restart/rerun 信息
- paused continuation instruction
- waiting prompt / waiting response / attachment count
- failure step / reason / attempted / nextActions

服务端不会恢复旧 SSE 流。它会开启一个新的 run，prompt 约束模型先回读当前 `PenDocument.pages` 中的目标节点和上下游，再创建后续执行链节点或更新当前主线。

## 服务端接收 run

主要文件：`apps/server/src/http/runs.ts`。

`POST /api/agent/runs` 流程：

1. 用 `runCreateRequestSchema` 校验请求体。
2. 如果有 Authorization header，则认证用户。
3. 如果认证且有 `threadService`，通过 `sessionId` 解析当前用户拥有的 LangGraph thread。
4. 读取 workspace 默认模型；请求体 `model` 优先级高于 workspace 默认。
5. 调用 `agentRuns.createRun(payload, { accessToken, userId, model, threadId })`，生成 accepted run。
6. 如果有持久化 thread，写 `agent_runs` accepted 元数据。
7. 调用 `runEventPump.startRun()` 异步开始消费，不阻塞 HTTP 响应。
8. 返回 `202 { runId, sessionId, conversationId, status: "accepted" }`。

取消和暂停：

- `POST /api/agent/runs/:runId/cancel` 调用 `cancelRun()`，AbortController abort，状态变为 `canceled`。
- `POST /api/agent/runs/:runId/pause` 调用 `pauseRun()`，AbortController abort，状态变为 `paused`，事件 reason 是“用户暂停了当前 Agent 执行链，可从选中的执行节点继续。”

## Runtime 执行准备

主要文件：`apps/server/src/agent/runtime.ts`。

`streamRun(runId)` 是一次 run 的核心执行函数：

1. 找到 `RuntimeRunRecord`，防止同一个 run 被重复消费。
2. 状态改为 `running`，同步 `agent_runs` running。
3. 如果有 `threadId`，初始化 LangGraph persistence：
   - `PostgresSaver` checkpointer
   - `PostgresStore` store
   - 初始化失败会产出 `run.failed`，不继续执行。
4. 如果注入了 `JobService`、`createUserClient`、`accessToken`、`userId`，构造 `submitImageJob` 和 `submitVideoJob` closure。
5. 如果有 `canvasId`，加载 workspace skills。
6. 创建 agent backend：
   - filesystem/dev 模式：`/workspace/` 和 `/skills/` 走文件系统，`/workspace-skills/` 可走 StoreBackend，default 是 LocalShellBackend。
   - production/state 模式：`/workspace/`、`/memories/`、`/workspace-skills/` 走 StoreBackend，`/skills/` 走文件系统，default 是 per-run LocalShellBackend sandbox。
7. 解析 run 模型 specifier。
8. 解析 canvas -> project -> brand kit ID；如果失败，只是不注入 Brand Kit。
9. 将 workspace skill 的 `SKILL.md` 和关联文件写入 StoreBackend namespace。
10. 调用 `createCucumberDeepAgent()` 装配模型、backend、tools、subagents、system prompt、checkpointer、store、skills。
11. 从 Supabase `canvases.content` 读取持久化画布内容，生成 `<canvas_state>` 摘要。
12. 构造 `agentRunContext`，包含 prompt layers、styleguide、agent team、model profile。
13. 下载附件并构造两份数据：
    - 作为 LangChain `image_url` content part 给多模态模型看。
    - 作为 `user_attachment_map` 放入 configurable，供 `generate_image` 将 `assetId` 解析成 data URI。
14. `buildUserMessage()` 生成最终 HumanMessage 文本和 XML 上下文。
15. 调用 `agent.streamEvents(..., { configurable, signal, version: "v2" })`。
16. 将 LangChain/Deep Agents 原始事件交给 `adaptDeepAgentStream()` 转成 `StreamEvent`。
17. 每个事件同步持久化 run 状态并 yield 给 `RunEventPump`。
18. finally 清理 per-run sandbox 目录。

传给 agent 的 configurable 包括：

- `thread_id`
- `canvas_id`
- `access_token`
- `user_id`
- `user_attachment_map`

## Prompt 和上下文注入

`buildUserMessage()` 会在用户原始 prompt 后追加 XML 块：

- `<canvas_state>`：服务端从已持久化 `canvases.content` 摘要出来的画布状态。
- `<input_images>`：附件的 `asset_id`、mime type、名称。
- `<human_image_generation_preference>`：手动选择的图片模型候选。
- `<human_video_generation_preference>`：手动选择的视频模型候选。
- `<human_image_model_mentions>`：用户 @ 的图片模型。
- `<human_brand_kit_mentions>`：用户 @ 的品牌资产。
- `<human_skill_mentions>`：用户 @ 的 workspace skill，并指示读取 `/workspace-skills/<slug>/SKILL.md`。
- `<agent_run_context>`：B 阶段协作上下文。
- `<canvas_agent_entry>`：画布 compact 入口节点 ID。

系统 prompt 事实来源在 `apps/server/src/agent/prompts/cucumber-main.ts`。当前关键规则：

- 纯文字任务直接回复，不调用工具。
- 设计、生成、画布编辑任务默认写入画布执行链。
- 普通多节点执行链需要先调用 `create_agent_execution_flow`。
- compact 入口场景禁止重复调用 `create_agent_execution_flow`。
- 简单图片生成也走执行链，除非 compact 入口已经存在。
- 工具执行后要用 `record_agent_tool_call` 写回 durable tool/task 节点。
- 需要用户补充要创建 `create_agent_ask_user_more` 节点。
- 资料来源要创建 `create_agent_evidence` 节点。
- 评审结果要用 `record_agent_critique` 写回 critique 节点。
- 最终交付要用 `record_agent_final_deliverable` 写回 final deliverable 节点。
- 多方案要用 `create_agent_variant_branches`，选择分支要先 `select_agent_variant_branch`。

## Deep Agent 装配

主要文件：`apps/server/src/agent/deep-agent.ts`。

`createCucumberDeepAgent()` 做这些事：

- 根据 `<provider>:<model>` specifier 创建 streaming chat model。
- 支持 provider：
  - `openai`
  - `google`，优先 Vertex AI，缺省走 Google API key
  - `deepseek`
- 如果请求的 provider 环境变量不可用，代码里有 provider fallback 到其他可用 provider。
- 基础 system prompt 是 `CUCUMBER_SYSTEM_PROMPT`。
- 如果有 brand kit ID，追加“设计相关先使用 `get_brand_kit`”提示。
- 如果 workspace skills 非空，追加 skills 列表和可读路径。
- subagents：
  - `planner`
  - `designer`
  - `critic`
  - `coder_exporter`
  - `researcher`
  - `video_generate`
- tools 来自 `createMainAgentTools()`，它创建 MCP server，再通过 `bridgeMcpServerToolsToDeepAgent()` 适配为 LangChain StructuredTool。

## MCP 工具注册和调用边界

主要文件：`apps/server/src/mcp/server.ts`、`apps/server/src/mcp/deepagents-bridge.ts`。

工具注册在 `createCucumberMcpServer()` 中集中完成。调用时：

1. Deep Agent 看到的是 LangChain `StructuredTool`。
2. `deepagents-bridge` 把 StructuredTool 调用转发给 MCP tool。
3. `resolveMcpToolContext(runtime)` 从 LangChain runtime 里取 configurable，如 `canvas_id`、`access_token`、`user_id`、附件 map。
4. MCP server 打日志：
   - `[mcp] tool.start <name>`
   - `[mcp] tool.done <name> +Nms`
   - `[mcp] tool.failed <name> +Nms`
5. `unwrapMcpToolResult()` 把 MCP result 变成模型可读的 tool output。

当前主 agent 工具按注册顺序包括：

- 项目/文件检索：`project_search`
- 画布读取：`inspect_canvas`、`inspect_canvas_semantic`、`get_selection_context`、`snapshot_layout`、`batch_get`、`read_nodes`
- 画布 diff/事务：`canvas_diff_preview`、`apply_canvas_transaction`
- 画布资产：`query_canvas_assets`、`replace_asset_in_node`
- 连接和容器：`connect_nodes`、`resize_container_to_fit`、`create_agent_output_container`
- Agent 执行链：`create_agent_execution_flow`、`create_agent_ask_user_more`、`create_agent_evidence`、`record_agent_tool_call`、`create_agent_variant_branches`、`select_agent_variant_branch`、`record_agent_critique`、`record_agent_final_deliverable`
- 布局/验证/记忆/追踪：`layout_canvas`、`validate_canvas`、`canvas_memory_index`、`critique_canvas`、`canvas_run_trace`
- 导出：`export_canvas_deliverable`
- 视觉观测：`screenshot_canvas`
- 简单命令式画布编辑：`manipulate_canvas`
- 结构化画布工具：`batch_design`、`find_empty_space`、`add_page`、`remove_page`、`rename_page`、`reorder_page`、`duplicate_page`、`design_skeleton`、`design_content`、`design_refine`、`import_figma_clipboard`、`search_all_unique_properties`、`replace_all_matching_properties`、`get_variables`、`set_variables`、`set_themes`、`prompt_canvas_plan`、`prompt_canvas_execute`、`codegen_plan`、`codegen_submit_chunk`、`codegen_assemble`、`codegen_export`、`codegen_clean`
- 媒体生成：`generate_image`、`generate_video`
- sandbox 文件持久化：`persist_sandbox_file`

条件工具：

- `get_brand_kit` 不在 MCP server 中注册，而是在 `createMainAgentTools()` 里当 `brandKitId` 存在时追加。
- deepagents 文件/执行工具由 backend 自动注入，不在 `apps/server/src/mcp/server.ts` 手写注册。

## Deep Agents 内置工具和 backend 文件系统

`apps/server/src/agent/tools/index.ts` 注释列出 deepagents 自动注入的工具：

- `ls`
- `read_file`
- `write_file`
- `edit_file`
- `glob`
- `grep`
- `execute`
- `task`
- `write_todos`

这些能力来自 backend：

- `/workspace/`：项目工作区文件，dev 走 FilesystemBackend，prod 走 StoreBackend。
- `/memories/`：prod 走 StoreBackend。
- `/skills/`：系统 skills，FilesystemBackend。
- `/workspace-skills/`：用户启用的 workspace skills，StoreBackend。
- default：LocalShellBackend sandbox，因此 `execute` 可用。

## 信息获取流程

Agent 获取信息有五条路径：

1. 自动 prompt 上下文：
   - 用户 prompt。
   - `<canvas_state>`，来自持久化 `canvases.content` 摘要。
   - 附件、模型偏好、mention、skill mention、agent run context、canvas entry。
2. 多模态输入：
   - 附件下载成 base64 `image_url` content part，传给支持 vision 的 LangChain 模型。
3. Live canvas 读取：
   - `inspect_canvas`、`inspect_canvas_semantic`、`get_selection_context`、`batch_get`、`snapshot_layout` 等通过 `LiveCanvasService` 读当前打开的编辑器。
4. 文件和 skill：
   - `read_file`、`grep`、`glob` 读取 `/workspace/`、`/skills/`、`/workspace-skills/`。
5. 运行追踪和记忆：
   - `canvas_run_trace` 从 `CanvasEventBuffer` / live canvas 读取近期 run 事件。
   - `canvas_memory_index` 从 live canvas 的语义节点生成或读取画布记忆索引。

重要边界：没有打开对应 canvas 页面时，依赖 `LiveCanvasService` 的工具会失败为 `live_canvas_unavailable`，不会静默改数据库当作替代。

## Live Canvas RPC 流程

主要文件：

- 服务端：`apps/server/src/features/canvas/live-canvas-service.ts`
- WebSocket：`apps/server/src/ws/handler.ts`、`apps/server/src/ws/connection-manager.ts`
- 前端：`apps/web/src/components/canvas-editor.tsx`

流程：

1. 前端 WebSocket 连接 `/api/ws?token=...`。
2. 前端发送 `{ type: "canvas.bind", canvasId }`。
3. `ConnectionManager.bindCanvas()` 将 connectionId 绑定到 canvas。
4. `CanvasEditor` 注册 RPC：
   - `canvas.screenshot`
   - `canvas.document.get`
   - `canvas.document.set`
   - `canvas.document.patch`
5. 服务端工具调用 `LiveCanvasService.getDocumentState/getDocument/setDocument/patchDocument`。
6. `ConnectionManager.rpcToCanvas()` 向绑定 canvas 的浏览器发 RPC request，等待 `rpc.response`。
7. 前端执行实际 canvas API：
   - `getDocument()` 返回当前编辑器文档和 version。
   - `setDocument()` 调 `api.setDocument(..., { syncRenderer: "immediate" })` 并 flush save。
   - `patchDocument()` 调 `api.applyDocumentPatch()`，然后 flush save。
8. 服务端校验返回版本并打日志。

## 简单流程

### 纯文本问答

```text
用户消息
  -> createRun
  -> runtime 注入上下文
  -> 模型直接输出文本
  -> on_chat_model_stream
  -> message.delta
  -> 前端聊天追加文本
  -> run.completed
  -> RunEventPump 写 assistant message
```

没有专门的 `generate_text` 工具。

### 简单画布微调

```text
用户要求移动/改色/改文案
  -> prompt 带 canvas_state
  -> 模型必要时 inspect_canvas_semantic / get_selection_context
  -> 调 manipulate_canvas 或 batch_design/apply_canvas_transaction
  -> LiveCanvasService.patchDocument
  -> 浏览器更新 live PenDocument.pages 并 flush save
  -> tool.completed
  -> canvas.sync
  -> 前端刷新画布状态
```

### 简单图片生成，普通聊天入口

```text
用户要求生成图片
  -> 模型按 prompt 先调用 create_agent_execution_flow
  -> 画布出现 user_goal / task_step / tool_call / final_deliverable 等节点
  -> 模型调用 generate_image
       prompt = 优化后的图片 prompt
       targetContainerId = finalDeliverableNodeId
       agentExecutionNodeId = generate_image 对应 toolCallNodeId
  -> 直接 provider 或 submitImageJob
  -> 成功后插入图片元素
  -> recordImageGenerationExecutionNode 写回 tool/task 节点状态
  -> record_agent_final_deliverable 写回最终交付摘要
```

### 简单图片生成，画布 compact 入口

```text
前端先创建 input_node + agent_run_node
  -> 请求携带 canvasEntry
  -> prompt 注入 canvas_agent_entry
  -> 模型禁止再 create_agent_execution_flow
  -> 模型直接调用 generate_image 或必要的结构化画布工具
  -> 前端 useCanvasAgentExecutionStreamWriteback 把阶段、工具、文本写入同一个 agent_run_node 节点
  -> 单个媒体输出直接作为交付物展示；多个并列输出才创建 final_deliverable 分组
```

## 复杂流程

### 复杂设计/结构化画布生成

```text
用户目标
  -> runtime 构造 agent_run_context
  -> adaptDeepAgentStream 先发 run.context 和 prompt_layering stage
  -> 模型按 Planner/Designer/Critic/Coder roles 组织任务
  -> 调 create_agent_execution_flow 创建 durable 执行链
  -> 如需资料，调 project_search / read_file / inspect_canvas_semantic / create_agent_evidence
  -> 如需画布结构，调 batch_design / prompt_canvas_plan / prompt_canvas_execute / layout_canvas
  -> 如需验证，调 validate_canvas / critique_canvas
  -> 调 record_agent_tool_call / record_agent_critique / record_agent_final_deliverable 写回节点
  -> run.completed
```

执行链只应记录用户可理解、可编辑、可继续执行的节点：用户目标、Recipe、任务步骤、工具调用、证据、评审、最终交付物、检查点、等待用户补充、多方案分支。内部无消费价值的思考不应写成画布节点。

### Recipe 模板流程

```text
前端 selectedRecipeTemplate
  -> formatAgentRecipeTemplatePromptBlock 生成 agent_recipe_template
  -> prompt 附加 node_structure / tool_sequence / input_slots / validation_rules / deliverable_format
  -> 模型按模板组织 create_agent_execution_flow
  -> input_slots 缺失时先 create_agent_ask_user_more
  -> 需要多方案时 create_agent_variant_branches
  -> 后续按模板 tool_sequence 调工具并写回 durable nodes
```

模板是本轮执行链计划来源，不是第二套运行时状态。`saved_source_nodes` 只作为 provenance。

### 多方案/分支流程

```text
用户要求多个方向/三选一/方案对比
  -> create_agent_execution_flow 建主链
  -> create_agent_variant_branches 建 variant_branch 和 comparison 节点
  -> 每个 branch 写 planSummary / deliverableSummary / critiqueSummary / strengths / risks / useCases
  -> 推荐方案标记为 mainline，未选方案保留
  -> 用户选择某分支继续
  -> select_agent_variant_branch 先把该 branch 设为唯一主线
  -> 后续沿主线继续生成/编辑
```

### 需要用户补充的流程

```text
模型发现缺少必要输入
  -> create_agent_ask_user_more 写 ask_user_more 节点
  -> run 可以结束或等待用户后续操作
  -> 用户在属性面板/输入框提交补充文本或附件
  -> 前端构造 waiting_response_text / waiting_attachment_count
  -> 新 run 从该 ask_user_more 节点继续
```

### 暂停后继续

```text
用户点击暂停
  -> POST /api/agent/runs/:runId/pause
  -> runtime AbortController abort
  -> adaptDeepAgentStream / runtime 产出 run.paused
  -> 前端把 compact agent_run_node 节点状态写成 paused
  -> 用户选中该节点继续
  -> 新 run 带 paused_continuation_instruction
  -> 模型先回读目标节点和上下游，不恢复旧 SSE 流
```

### 失败后重试/跳过/改写

```text
run.failed 或 durable execution failure
  -> 前端/画布节点记录 failure.reason、attempted、nextActions
  -> 用户选择 retry / rewrite / skip
  -> prompt 带 intent 和 failure_* 字段
  -> 模型按 intent 从当前节点继续
  -> 新尝试或跳过原因写回 durable execution node
```

### Checkpoint 重跑下游

```text
用户从 checkpoint rerun
  -> continuation 带 checkpoint_rerun_downstream_node_ids
  -> 模型先读取 checkpoint 和下游当前节点
  -> 对 downstream 执行链进行重建、覆盖或标记旧版本
  -> 写入新的 task/tool/critique/final_deliverable/checkpoint 节点
```

## 图片生成链路

工具入口：`generate_image`。

服务端实现：

- MCP wrapper：`apps/server/src/mcp/tools/generate-image.ts`
- 业务工具：`apps/server/src/agent/tools/image-generate.ts`
- job closure：`apps/server/src/agent/runtime.ts`
- worker executor：`apps/server/src/features/jobs/executors/image-generation.ts`

输入能力：

- `prompt`
- `title`
- `model`
- `aspectRatio`
- `quality`
- `outputFormat`
- `inputImages`
- `placementX/Y/Width/Height`
- `targetContainerId`
- `agentExecutionNodeId`

处理流程：

1. 工具读取 `user_attachment_map`，将 `assetId` 类引用解析成 data URI。
2. 如果 `submitImageJob` 存在：
   - 创建 `background_jobs`，job type 为 `image_generation`。
   - `TaskManager.enqueue()` 写 `tasks`。
   - runtime 轮询 `jobSvc.getJobAdmin(job.id)`，最长 240s。
3. worker 从 `image_generation_jobs` claim task。
4. executor 读取 job payload。
5. `persistInlineInputImages()` 将 data URI 参考图持久化成 provider 可访问 URL。
6. `generateImage(providerName, input)` 调 provider。
7. 下载 provider 结果。
8. 上传到 `project-assets`。
9. 写 `asset_objects`。
10. 如有 `canvas_id`，插入图片元素：
    - runtime job 轮询成功后优先尝试 `insertGeneratedImageIntoLiveCanvas()`，失败再走 DB `insertImageElement()`。
    - worker executor 直接走 DB `insertImageElement()`。
11. 发布 `canvas.sync`。
12. 如有 `agentExecutionNodeId` 且 liveCanvasService 可用，`recordImageGenerationExecutionNode()` 写回执行节点。
13. tool output 返回 `jobId`、`imageUrl`、`elementId`、尺寸、mimeType 或具体错误。

如果没有 `submitImageJob`，`runImageGenerate()` 直接调用 provider，并可通过 `persistImage` 上传结果。

## 视频生成链路

工具入口：`generate_video`，也可由 `video_generate` 子代理内部调用。

服务端实现：

- MCP wrapper：`apps/server/src/mcp/tools/generate-video.ts`
- 业务工具：`apps/server/src/agent/tools/video-generate.ts`
- job closure：`apps/server/src/agent/runtime.ts`
- worker executor：`apps/server/src/features/jobs/executors/video-generation.ts`

处理流程：

1. 工具过滤无效 image reference，只保留 `http(s)` 或 `data:`。
2. 如果 `submitVideoJob` 存在：
   - 创建 `background_jobs`，job type 为 `video_generation`。
   - `TaskManager.enqueue()` 写 `tasks`。
   - runtime 轮询 job，最长 600s。
3. worker 从 `video_generation_jobs` claim task。
4. executor 调 `generateVideo(providerName, input)`。
5. 下载视频，上传到 `project-assets`，写 `asset_objects`。
6. runtime 轮询成功后，如果有 `canvasId`，调用 `insertVideoElement()` 插入画布，并发布 `canvas.sync`。
7. tool output 返回 `jobId`、`videoUrl`、`elementId`、尺寸、duration、mimeType 或错误。

## 流事件转换

主要文件：`apps/server/src/agent/stream-adapter.ts`。

`adaptDeepAgentStream()` 将 LangChain v2 事件转换为共享 `StreamEvent`：

- 开始时总是先发 `run.started`。
- 如果有 `agentRunContext`，发：
  - `run.context`
  - `agent.stage`，stage 为 `prompt_layering`，status 为 `completed`
- `on_chat_model_stream`：
  - 文本 -> `message.delta`
  - thinking part -> `thinking.delta`
  - tool call chunk 不发文本
- `on_chat_model_end`：
  - 非 streaming fallback，未见过 messageId 时补发 `message.delta`
- `on_tool_start`：
  - 发 `agent.stage` started
  - 发 `tool.started`
- `on_tool_end`：
  - 从 tool output 提取 `output`、`outputSummary`、`artifacts`
  - 发 `tool.completed`
  - 发 `agent.stage` completed
  - `manipulate_canvas` 额外发 `canvas.sync`
- 捕获 abort：
  - cancel -> `run.canceled`
  - pause -> `run.paused`
- 捕获异常：
  - `run.failed`
- 正常结束：
  - `run.completed`

Artifact 提取规则：

- `imageUrl` 或 `url` -> image artifact。
- `screenshotUrl` -> image artifact。
- `videoUrl` -> video artifact。
- subagent `video_generate` 内层 `generate_video` artifact 会被抑制，避免父子工具重复展示。

角色和阶段按工具名推断：

- search / inspect -> researcher / research
- codegen / export -> coder_exporter / export
- screenshot / snapshot -> critic / critique
- plan -> planner / planning
- canvas / design / image / video -> designer / design
- 其他 -> orchestrator / tool_execution

## 事件发布、SSE 和聊天落库

### RunEventPump

`apps/server/src/agent/run-event-pump.ts` 后台消费 `agentRuns.streamRun(runId)`：

1. 将 canvasId 设为 active run。
2. 每个 `StreamEvent` 发布到 `CanvasEventBuffer`。
3. 累积 assistant text：
   - `message.delta` 合并成 text block。
4. 累积 tool blocks：
   - `tool.started` 创建 running tool block。
   - `tool.completed` 更新 matching tool block，附带 output、summary、artifacts。
5. stream 结束后，如果有 assistant text 或 tool blocks，写 `chat_messages`。
6. 最后清理 active run。

### CanvasEventBuffer 和 SSE

`CanvasEventBuffer`：

- 每个 canvas 最多缓存 5000 个事件。
- 每个事件有递增 seq。
- TTL 默认 10 分钟。
- 支持 `getAfter(canvasId, lastEventId)` 断线重放。

`/api/canvases/:canvasId/stream`：

- 认证用户。
- 校验 canvas 存在。
- 返回 `text/event-stream`。
- 先补发 `lastEventId` 之后的缓存事件。
- 订阅后续事件。
- 每 30s heartbeat。

前端 `useSseStream()`：

- 用 fetch 读取 SSE。
- 保存 `Last-Event-ID`。
- 非终态断开会指数退避重连。
- 收到 `run.completed`、`run.failed`、`run.canceled`、`run.paused` 停止。

## 前端收到事件后的分发

`useAgentRunController()` 收到 SSE 事件后：

- `applyStreamEvent()` 更新聊天 assistant message。
- `onStreamEvent()` 给画布页记录 trace，并在 compact 入口场景写回 active agent execution 节点。
- `tool.completed` 且有 artifact：
  - 如果 output 里没有 backend 插入的 `elementId`，前端调用 `onImageGenerated` / `onVideoGenerated` 插入或展示产物。
  - `screenshot_canvas` artifact 不走生成产物插入。
- `canvas.sync` 触发 `onCanvasSync()`。
- `run.failed` 会根据当前模型显示一些前端 toast。

`useChatStream()` 只负责聊天视图：

- `message.delta` -> text block。
- `thinking.delta` -> thinking block。
- `tool.started` / `tool.completed` -> tool block。
- `run.failed` -> 追加用户可读失败文本，并停止 running tool spinner。
- `run.canceled` / `run.paused` -> 停止 running tool spinner。

`useCanvasAgentExecutionStreamWriteback()` 只负责 compact 入口节点：

- `run.started` -> running。
- `agent.stage` -> streamEntries stage。
- `thinking.delta` -> reasoningSummary。
- `message.delta` -> outputSummary。
- `tool.started` / `tool.completed` -> streamEntries tool。
- `run.completed` -> done。
- `run.paused` / `run.canceled` -> paused。
- `run.failed` -> failed + failure.reason。

## 工具结果和产物类型

当前一等 artifact 类型来自 `packages/shared/src/artifacts.ts`：

- image
- video

非 artifact 但重要的执行结果：

- `thinking.delta`：过程状态。
- `tool.started` / `tool.completed`：工具状态。
- `canvas.sync`：画布状态变更信号。
- `canvas.patch`：共享 schema 已定义，但当前主链路里主要通过 live RPC 修改画布，不是常规运行事件来源。
- `agent.stage` / `run.context`：Agent 编排过程事件。

## 错误、取消、暂停

失败来源：

- 请求体 schema 校验失败 -> HTTP 400。
- 认证失败 -> HTTP 401。
- session/thread 解析失败 -> 对应业务错误。
- persistence 初始化失败 -> `run.failed`。
- canvas access/live editor RPC 失败 -> 对应工具失败，常见 `live_canvas_unavailable`。
- tool 抛错 -> MCP 记录 `[mcp] tool.failed`，stream adapter 输出 `run.failed` 或工具错误 output，取决于工具是否内部捕获。
- job dead_letter/canceled/failed/timeout -> tool output 带具体 `error`，图片链路还会写回 execution node failure。

取消和暂停都通过 AbortController 中断模型 stream。暂停不会恢复旧流，后续通过选择 durable execution node 创建新 run 继续。

## 当前实现中容易误判的点

- `<canvas_state>` 不是 live RPC 读出来的，它来自持久化 `canvases.content`；工具调用阶段才会通过 `LiveCanvasService` 操作当前 live editor。
- 文本回答没有 `generate_text` 工具。
- `get_brand_kit` 是条件追加工具，不在 MCP server 注册表里。
- workspace skill 不是 StructuredTool；它通过 system prompt 和 `/workspace-skills/` 文件路径被模型消费。
- `generate_image` / `generate_video` 有 job 模式和 direct provider 模式，取决于 runtime 是否能构造 submit job closure。
- compact canvas entry 和 `create_agent_execution_flow` 是两种入口策略；compact 场景禁止重复创建多节点入口链。
- `canvas.sync` 是刷新信号，不携带完整文档 patch。
- live canvas 工具没有打开浏览器画布时会失败，不做数据库兜底写入。
- `PenDocument.pages` 是唯一支持的 durable canvas 形状，旧 flat/root children 不在运行时兼容。

## 推荐排查顺序

1. 前端发送和上下文：`use-agent-run-controller.ts`、`chat-input-context.ts`、`canvas-agent-composer.tsx`。
2. run 接收：`apps/server/src/http/runs.ts`。
3. runtime：`apps/server/src/agent/runtime.ts`。
4. Deep Agent 装配：`apps/server/src/agent/deep-agent.ts`。
5. prompt policy：`apps/server/src/agent/prompts/cucumber-main.ts`。
6. 工具注册：`apps/server/src/mcp/server.ts`。
7. live canvas：`live-canvas-service.ts`、`connection-manager.ts`、`canvas-editor.tsx`。
8. 事件转换：`stream-adapter.ts`。
9. 事件发布和落库：`run-event-pump.ts`、`http/sse.ts`、`use-sse-stream.ts`。
10. 媒体 job：`job-service.ts`、`task-manager.ts`、`worker.ts`、`features/jobs/executors/*`。
