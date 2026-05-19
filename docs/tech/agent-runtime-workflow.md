# Agent Runtime Workflow And Tool Inventory

## 目的

这份文档梳理当前仓库里 agent 的真实执行链路、可处理的产出类型，以及运行时可调用的工具与技能入口，方便后续排查、扩展和交接。

本文基于当前代码实现整理，重点覆盖这些目录：

- `apps/server/src/agent/`
- `apps/server/src/http/`
- `apps/server/src/ws/`
- `apps/server/src/generation/`
- `apps/server/src/features/jobs/`
- `packages/shared/src/`

## 一句话总览

当前 Cucumber Studio 的 agent 是一个基于 Deep Agents / LangChain 的流式运行时：

1. 前端通过 HTTP 或 WebSocket 发起 run。
2. 服务端解析会话、线程、模型、画布上下文和技能上下文。
3. `createCucumberDeepAgent()` 装配主模型、主工具、子代理、backend、store、checkpointer。
4. 模型直接输出文本，或调用通过 MCP registry 暴露的工具执行搜索、画布操作、图片生成、视频生成、文件持久化等动作。
5. 运行期事件被转换为统一的 `StreamEvent`，经 WebSocket 广播给前端。
6. 生成产物最终落到持久化存储，并在需要时同步回写到画布和聊天消息。

## 核心入口

### 1. Run 入口

- HTTP 入口：`apps/server/src/http/runs.ts`
  - `POST /api/agent/runs`
  - `POST /api/agent/runs/:runId/cancel`
- WebSocket 入口：`apps/server/src/ws/handler.ts`
  - `command: agent.run`
  - `command: agent.cancel`
  - `command: canvas.resume`

### 2. Runtime 入口

- Agent runtime 主体：`apps/server/src/agent/runtime.ts`
- Deep Agent 装配入口：`apps/server/src/agent/deep-agent.ts`
- 主工具注册表：`apps/server/src/agent/tools/index.ts`
- MCP tool registry / server：`apps/server/src/mcp/server.ts`
- MCP → Deep Agents bridge：`apps/server/src/mcp/deepagents-bridge.ts`
- 子代理注册：`apps/server/src/agent/sub-agents.ts`
- 流式事件适配：`apps/server/src/agent/stream-adapter.ts`

### 3. 生成链路入口

- 生成 provider 注册中心：`apps/server/src/generation/providers/registry.ts`
- provider 装配：`apps/server/src/generation/providers/register-all.ts`
- 当前核心 provider 实现：`apps/server/src/generation/providers/seedream.ts`
- 后台任务服务：`apps/server/src/features/jobs/job-service.ts`
- Worker 入口：`apps/server/src/worker.ts`

## 端到端执行工作流

### 1. 用户请求进入服务端

- 前端发起一次 agent run 时，请求体契约来自 `packages/shared/src/contracts.ts` 中的 `RunCreateRequest`。
- 请求里通常包含：
  - `sessionId`
  - `conversationId`
  - `prompt`
  - `canvasId`
  - `attachments`
  - `mentions`
  - `model`
- HTTP 和 WebSocket 两条入口最终都会进入 `agentRuns.createRun(...)`。

### 2. 服务端解析会话与模型

- 服务端会尝试把 `sessionId` 解析到持久化线程 `threadId`。
- 如果有 workspace 级默认模型，会先解析；若请求显式传入 `model`，则以请求值为准。
- 如果启用了 run 元数据持久化，还会先创建一条 `accepted` 状态的 run 记录。

### 3. Runtime 构造最终用户消息

`apps/server/src/agent/runtime.ts` 会把用户原始 prompt 包装成更完整的上下文消息，而不是直接把裸文本发给模型。

当前会自动注入这些上下文：

- `<canvas_state>`：当前画布摘要
- `<input_images>`：上传图片的 `assetId`、`mimeType`、名称
- `<human_image_generation_preference>`：用户手动选择的图片模型偏好
- `<human_video_generation_preference>`：用户手动选择的视频模型偏好
- `<human_image_model_mentions>`：消息里显式提到的图片模型
- `<human_brand_kit_mentions>`：消息里显式提到的品牌资产
- `<human_skill_mentions>`：消息里显式提到的 workspace skill

这里有两个关键点：

- 文本回答不是通过单独的 `generate_text` 工具实现，而是主模型直接输出。
- 图片附件不会直接塞给 provider，而是先被转换成 `assetId -> data URI` 的映射；`generate_image` 在 worker 执行前会把其中的 `data:` 引用上传成合法的 public URL，再传给 provider 的 `image_urls`。

### 4. Runtime 装配 Deep Agent

`createCucumberDeepAgent()` 会装配以下运行时组件：

- `model`
- `backend`
- `tools`（由 `apps/server/src/mcp/server.ts` 统一注册，再经 `apps/server/src/mcp/deepagents-bridge.ts` 适配给 Deep Agents）
- `subagents`
- `store`
- `checkpointer`
- `systemPrompt`
- `workspaceSkills`

系统提示词会在基础 prompt 之上继续追加：

- 品牌套件提示
- 当前 workspace 已启用 skills 的摘要
- 每个 skill 对应的可读路径，例如 `/workspace-skills/<slug>/SKILL.md`

### 5. Backend 为 agent 暴露文件、技能与执行能力

当前 backend 不是单一路径，而是 `CompositeBackend` 组合出来的能力路由层。

### 生产模式

`apps/server/src/agent/backends/prod.ts` 的核心路由：

- `/workspace/` -> `StoreBackend`
- `/memories/` -> `StoreBackend`
- `/skills/` -> `FilesystemBackend`
- `/workspace-skills/` -> `StoreBackend`
- `default` -> `LocalShellBackend`

### 开发模式

`apps/server/src/agent/backends/dev.ts` 的核心路由：

- `/workspace/` -> `FilesystemBackend`
- `/skills/` -> `FilesystemBackend`
- `/workspace-skills/` -> `StoreBackend`
- `default` -> `LocalShellBackend`

这意味着 agent 拥有三类不同来源的能力：

- 业务自定义工具
- deepagents 自动注入的内置文件/执行工具
- 通过 `/skills/` 和 `/workspace-skills/` 暴露的技能文件

### 6. 模型开始流式执行

Runtime 会调用 `agent.streamEvents(...)` 发起一次真正的模型执行。

流中会携带这些关键上下文：

- `thread_id`
- `canvas_id`
- `access_token`
- `user_id`
- `user_attachment_map`

随后 `stream-adapter.ts` 会把 LangChain / Deep Agents 的原始事件转成统一的 `StreamEvent`。

当前共享事件类型定义在 `packages/shared/src/events.ts`：

- `run.started`
- `message.delta`
- `thinking.delta`
- `tool.started`
- `tool.completed`
- `canvas.sync`
- `run.completed`
- `run.canceled`
- `run.failed`

### 7. WebSocket 广播与消息落库

WebSocket 层会做三件事：

- 把事件广播给当前 canvas 的所有在线连接
- 把事件写入缓冲，支持断线重放
- 累积 assistant 文本块和工具块，最终写入聊天消息表

也就是说，前端看到的 tool block、文本流和产物卡片，和后端最终持久化的 assistant message 是同一条运行流拆分出来的不同视图。

### 8. 生成类工具进入 provider / job / worker 链路

当模型调用图片或视频工具后，会进入生成链路。

### 图片链路

- 工具：`generate_image`
- 实现：`apps/server/src/agent/tools/image-generate.ts`
- 可能的执行方式：
  - 直接同步调 provider
  - 提交后台 job，异步处理
- 成功后可能发生：
  - 返回图片 URL 给 tool output
  - 上传到持久化存储
  - 生成可用于前端渲染的 image artifact
  - 在需要时回写画布元素

### 视频链路

- 工具：`generate_video`
- 子代理：`video_generate`
- 实现：`apps/server/src/agent/tools/video-generate.ts`
- 支持类型：
  - text-to-video
  - image-to-video
  - video editing
- 可能的执行方式：
  - 直接同步调 provider
  - 提交后台 job，异步处理
- 成功后可能发生：
  - 返回视频 URL 给 tool output
  - 生成 video artifact
  - 在需要时插入画布视频元素

### 后台 job 链路

如果走异步模式，整体链路如下：

1. `JobService` 写入 `background_jobs`
2. `TaskManager` 写入 `tasks`
3. `worker.ts` 通过 `claim_background_tasks_with_poll(...)` 从 `image_generation_jobs` 或 `video_generation_jobs` 抢占可执行任务并建立 lease
4. executor 调用 provider
5. 下载产物
6. 上传到 `project-assets`
7. 写回结果、状态、错误信息

## Agent 可处理的类型

### 1. 文本

文本是 agent 的默认输出类型，不通过专门的生成工具产生。

表现形式：

- 流式文本事件：`message.delta`
- 最终 assistant 消息内容：`content`
- 聊天中的结构化文本块：`contentBlocks[].type = "text"`

适用场景：

- 普通问答
- 方案说明
- 工具执行结果总结
- 失败说明和下一步建议

### 2. Thinking

Thinking 是运行时暴露给前端的推理流，不是独立产物类型。

表现形式：

- 流式事件：`thinking.delta`

用途：

- 让前端展示模型的思考过程
- 辅助观察长任务执行状态

### 3. 工具调用结果

工具调用会拆成两个阶段：

- `tool.started`
- `tool.completed`

前端通常把这部分渲染为 tool block。

这类结果本身不一定是最终产物，也可能只是：

- 搜索结果
- 画布检查结果
- 样式或布局操作结果
- 文件上传结果

### 4. 图片产物

图片是当前 agent 的一等产物类型之一。

共享契约在 `packages/shared/src/artifacts.ts` 中定义为：

- `type: "image"`
- `url`
- `mimeType`
- `width`
- `height`
- `placement`
- `jobId`

图片来源包括：

- `generate_image`
- `screenshot_canvas`
- `execute` 生成本地文件后，再通过 `persist_sandbox_file` 上传

### 5. 视频产物

视频是当前 agent 的另一类一等产物类型。

共享契约在 `packages/shared/src/artifacts.ts` 中定义为：

- `type: "video"`
- `url`
- `mimeType`
- `width`
- `height`
- `durationSeconds`
- `placement`
- `jobId`

视频主要来源：

- `generate_video`
- `video_generate` 子代理内部调用 `generate_video`

### 6. 画布状态变更

这类结果不是 artifact，但会改变项目真实状态。

来源主要包括：

- `manipulate_canvas`
- 生成完成后的图片落图
- 生成完成后的视频插入

当画布发生变化时，运行时会推送：

- `canvas.sync`

### 7. 持久化文件

Agent 在 sandbox 中通过 `execute` 生成的文件，不会自动成为用户可访问产物。

如果要把这类文件交付给用户，需要调用：

- `persist_sandbox_file`

典型文件包括：

- PNG
- JPG
- SVG
- PDF
- GIF
- WEBP

## 当前可调用工具清单

### 1. 主 agent 自定义业务工具

这些工具统一在 `apps/server/src/mcp/server.ts` 中以 MCP-compatible definitions 注册，业务实现仍复用 `apps/server/src/agent/tools/`；最终由 `apps/server/src/mcp/deepagents-bridge.ts` 适配给 Deep Agents / LangChain runtime。

### 常驻工具

- `project_search`
  - 作用：在 `/workspace` 中搜索项目文本内容
  - 实现：`apps/server/src/agent/tools/project-search.ts`
- `inspect_canvas`
  - 作用：读取当前画布元素、区域、类型、边界框和视图信息
  - 实现：`apps/server/src/agent/tools/inspect-canvas.ts`
- `manipulate_canvas`
  - 作用：增删改移动画布元素，支持文本、形状、线段、样式、对齐、分布、层级等
  - 实现：`apps/server/src/agent/tools/manipulate-canvas.ts`
- `generate_image`
  - 作用：生成图片，支持结合附件和模型偏好
  - 实现：`apps/server/src/agent/tools/image-generate.ts`
- `generate_video`
  - 作用：生成视频，支持文生视频、图生视频和视频编辑
  - 实现：`apps/server/src/agent/tools/video-generate.ts`
- `persist_sandbox_file`
  - 作用：把 sandbox 中生成的文件上传到持久化存储并返回可访问 URL
  - 实现：`apps/server/src/agent/tools/persist-sandbox-file.ts`

### 条件注册工具

- `get_brand_kit`
  - 条件：当前 run 绑定了 `brandKitId`
  - 作用：读取品牌设计指南、颜色、字体、Logo、图片等资产
  - 实现：`apps/server/src/agent/tools/brand-kit.ts`
- `screenshot_canvas`
  - 条件：当前 runtime 有 `connectionManager`
  - 作用：让前端浏览器对当前画布截图，再把截图结果回传给 agent
  - 实现：`apps/server/src/agent/tools/screenshot-canvas.ts`

### 2. deepagents 自动注入的内置工具

这些工具不是我们手写注册的，而是 backend 中的 `FilesystemMiddleware` / `LocalShellBackend` 自动提供的。

当前代码注释明确列出了以下内置工具：

- `ls`
- `read_file`
- `write_file`
- `edit_file`
- `glob`
- `grep`
- `execute`
- `task`
- `write_todos`

说明：

- `execute` 之所以可用，是因为默认 backend 使用了 `LocalShellBackend`。
- `task` 用于把子任务派发给子代理。
- `write_todos` 用于维护 agent 自己的 TODO 列表。

### 3. 子代理

当前显式注册的子代理只有一个：

- `video_generate`
  - 定位：视频生成专用子代理
  - 文件：`apps/server/src/agent/sub-agents.ts`
  - 内部工具：`generate_video`

它不是前端直接调用的 HTTP API，也不是单独的主工具按钮，而是由 agent 在运行中通过 `task` 能力进行委派。

### 4. Skill 文件体系

严格来说，workspace skill 不是 `StructuredTool`，但它们是 agent 可消费的重要能力来源。

### 系统 skills

- 路径前缀：`/skills/`
- 来源：文件系统
- backend：`FilesystemBackend`

### Workspace skills

- 路径前缀：`/workspace-skills/`
- 来源：数据库 + StoreBackend
- 由 `loadWorkspaceSkills()` 在 runtime 中加载

workspace skill 会以两种方式影响执行：

- 技能摘要被注入 system prompt
- agent 可以用 `read_file` 读取 `/workspace-skills/<slug>/SKILL.md` 以及关联脚本/参考文件

因此，skill 更像是“通过文件暴露给 agent 的运行指令集”，而不是普通工具函数。

## 当前能力边界和易混淆点

- 当前没有单独的 `generate_text` 工具，文本回答来自主模型本身。
- 当前 artifact 契约里只有两类一等媒体产物：`image` 和 `video`。
- `thinking.delta` 是流式状态，不是最终持久化 artifact。
- `screenshot_canvas` 返回的是图片结果，但它属于画布观测工具，不等同于文生图工具。
- `persist_sandbox_file` 不负责生成内容，只负责把 sandbox 本地文件上传为持久化产物。
- workspace skill 不是普通工具注册，而是通过虚拟文件路径和 system prompt 暴露给 agent。
- 视频既可以由主 agent 直接调用 `generate_video`，也可以委派给 `video_generate` 子代理处理。

## 推荐阅读顺序

如果后续要继续深入排查 agent 行为，建议按这个顺序读代码：

1. `apps/server/src/http/runs.ts`
2. `apps/server/src/ws/handler.ts`
3. `apps/server/src/agent/runtime.ts`
4. `apps/server/src/agent/deep-agent.ts`
5. `apps/server/src/agent/tools/index.ts`
6. `apps/server/src/agent/stream-adapter.ts`
7. `apps/server/src/generation/providers/registry.ts`
8. `apps/server/src/features/jobs/job-service.ts`
9. `apps/server/src/worker.ts`

## 结论

当前 agent 运行时可以概括为四层：

- 入口层：HTTP / WebSocket 接收 run、cancel、resume
- 编排层：runtime 装配模型、上下文、工具、技能、子代理
- 执行层：模型直接输出文本，或调用工具完成搜索、画布操作、图片视频生成、文件上传
- 持久化与回放层：事件广播、消息落库、job 状态管理、产物存储、画布同步

如果后续新增新的媒体类型或工具类别，优先同步更新这份文档中的两部分：

- `Agent 可处理的类型`
- `当前可调用工具清单`
