# Agent 与画布调用链梳理及 MCP 对齐计划

## Summary

- 目标：把当前 “deep agent 内嵌画布工具” 的隐式链路，升级为类似 `openpencil` 的显式 MCP 访问链路，同时修复新画布 runtime 下 agent 无法稳定写入容器的问题。
- 核心结论：当前仓库里 `inspect_canvas` / `manipulate_canvas` 并不是没注册，而是存在两类断点：
  - 缺少像 `openpencil` 那样可独立暴露、可诊断的 HTTP MCP server / live canvas 通道，导致链路不透明、外部 agent 不可复用。
  - 新 Cucumber canvas runtime 的容器权限校验依赖 `agent_id`，但 `apps/server/src/agent/runtime.ts` 目前只注入了 `user_id`，没有稳定的 agent 身份；一旦目标容器不是 `open`，`manipulate_canvas` 很容易被 `permission_denied` 卡住。
- 实施原则：保留现有 `createCucumberMcpServer()` 这套单一工具定义，避免再造第二套画布协议；内部 deep agent 与未来外部/ACP agent 都走同一份 MCP tool registry。

## Current State Analysis

### 1. 当前内置 agent 链路

- 前端 `apps/web/src/components/chat-sidebar.tsx` 调用 `createRun()` 时已经会把 `canvasId` 一起发到 `/api/agent/runs`。
- 服务端 `apps/server/src/http/runs.ts` 会把 `canvasId`、`userId`、`accessToken` 带入 `AgentRunService`。
- `apps/server/src/agent/runtime.ts` 在真正调用 `agent.streamEvents()` 时，会向 `configurable` 注入：
  - `canvas_id`
  - `access_token`
  - `user_id`
  - `thread_id`
  - `user_attachment_map`
- `apps/server/src/agent/tools/index.ts` 会通过 `createCucumberMcpServer()` + `bridgeMcpServerToolsToDeepAgent()` 把 MCP 工具桥接给 deep agent；当前已注册工具为：
  - `project_search`
  - `inspect_canvas`
  - `manipulate_canvas`
  - `generate_image`
  - `generate_video`
  - `persist_sandbox_file`

### 2. 当前画布工具本身的实现形态

- `apps/server/src/mcp/server.ts` 现在只是一个“内存版 MCP registry”，负责聚合工具定义与调用，不提供 HTTP transport。
- `apps/server/src/mcp/deepagents-bridge.ts` 只负责把 registry 中的工具桥接为 deep agent 可用的 LangChain `tool()`。
- `apps/server/src/agent/tools/inspect-canvas.ts` 与 `apps/server/src/agent/tools/manipulate-canvas.ts` 实际上已经兼容两套画布内容：
  - 老的 Excalidraw `elements`
  - 新的 `CucumberCanvasDocument`
- `apps/server/src/agent/prompts/cucumber-main.ts` 已经提示 agent 优先使用 `manipulate_canvas`，所以“不会用工具”不是唯一问题。

### 3. 当前最像根因的断点

- `packages/canvas-core/src/operations.ts` 的 `assertAgentCanWrite()` 会对新 runtime 执行容器级权限校验。
- `apps/server/src/agent/tools/manipulate-canvas.ts` 的 `getConfiguredAgentId()` 读取顺序是：
  - `configurable.agent_id`
  - fallback 到 `configurable.user_id`
- 但 `apps/server/src/agent/runtime.ts` 当前没有注入 `agent_id`，只注入了 `user_id`。
- 前端绑定容器时，`apps/web/src/components/canvas/canvas-surface.tsx` 生成的 `agentBinding.agentId` 形如 `agent_${node.id}`，它与真实登录用户 ID 不是一回事。
- 因此，只要容器不是 `open` 或没有把当前用户显式写进 `permissions.canWrite`，agent 对新 runtime 的写操作就可能失败。

### 4. 与 OpenPencil 的关键差异

- `openpencil/apps/web/server/api/ai/agent.ts` 在 ACP 路径下会显式要求 MCP server 处于运行态，再把 `openpencil` MCP server URL 注入给 agent。
- `openpencil/packages/pen-mcp/src/server.ts` 提供标准 MCP transport（stdio / HTTP），工具是可独立发现、可独立调试、可被外部 agent 复用的。
- `openpencil/packages/pen-mcp/src/document-manager.ts` 提供 live canvas 连接诊断，能够明确区分：
  - server 没起
  - live document 未加载
  - port file 存在但服务不可达
- 当前 Cucumber 没有对应的 MCP HTTP 入口，也没有等价的 live canvas / canvas session 诊断层。

## Proposed Changes

### A. 统一协议入口：把现有 MCP registry 暴露成 HTTP MCP 服务

#### `apps/server/src/mcp/server.ts`

- 保留现有 `createCucumberMcpServer()` 作为“单一工具注册中心”。
- 重构导出形态，使其既能继续服务 deep agent 内部 bridge，也能被 HTTP transport 复用。
- 增加更明确的上下文注入接口，允许外部 MCP 请求附带：
  - `canvas_id`
  - `access_token`
  - `user_id`
  - `agent_id`
  - 可选的 `target_container_id`

#### 新增 `apps/server/src/http/mcp.ts`

- 参考 `openpencil/packages/pen-mcp/src/server.ts`，在 Fastify 内实现一个 `streamable HTTP MCP` 路由，推荐路径：
  - `POST /api/mcp`
  - `GET /api/mcp`
  - `DELETE /api/mcp`
- 要求 Bearer token 鉴权，并把鉴权后的用户上下文映射为 MCP tool context。
- 复用 `createCucumberMcpServer()` 暴露工具列表与 tool call，不再维护第二套接口。
- 这样可同时支持：
  - 内部 deep agent 继续桥接这批工具
  - 未来 ACP / 外部 agent 直接通过 MCP 访问同一批画布能力

#### `apps/server/src/app.ts`

- 注册新的 `registerMcpRoutes()`。
- 将 `createUserClient`、`connectionManager`、以及后续 agent-context 解析器传给 MCP route。

### B. 修复真正的写权限断点：为 agent 引入稳定身份，而不是继续复用 `user_id`

#### `packages/shared/src/contracts.ts`

- 扩展 `runCreateRequestSchema` / `RunCreateRequest`，新增一个显式 agent 上下文字段，建议二选一但实现时统一保留：
  - `agentId?: string`
  - `targetContainerId?: string`
- 目标不是让用户手填，而是让前端在“当前容器上下文明确”时带上。

#### `apps/web/src/components/chat-sidebar.tsx`

- 在创建 run 时，把当前画布的 agent/container 上下文显式传给服务端。
- 如果当前没有明确容器上下文，则不传，允许服务端 fallback。

#### 建议新增 `apps/server/src/agent/agent-context-resolver.ts`

- 统一解析 agent 调用画布工具时的身份与目标范围，输入包括：
  - `canvasId`
  - `userId`
  - 显式传入的 `agentId`
  - 显式传入的 `targetContainerId`
- 输出结构建议为：
  - `agentId`
  - `targetContainerId`
  - `resolutionSource`（explicit / single-bound-container / single-open-container / none）
- fallback 规则定死，避免运行期再猜：
  - 若前端显式给了 `agentId` / `targetContainerId`，优先使用。
  - 若未显式给，但画布里只有一个可写且已绑定 agent 的容器，则自动选中它。
  - 若只存在一个 `open` 容器，可作为宽松 fallback。
  - 若存在多个候选容器，则不要隐式猜测，工具返回结构化错误并提示前端/用户指定目标容器。

#### `apps/server/src/agent/runtime.ts`

- 调用 `agent-context-resolver`，把 `agent_id` 与 `target_container_id` 注入 `configurable`。
- 对 tool 上下文补日志，至少记录：
  - `runId`
  - `canvasId`
  - `agentId`
  - `targetContainerId`
  - `resolutionSource`
- 这样可以和 `RunEventPump`、SSE 事件关联起来，快速定位“没调工具”还是“调了但被权限拒绝”。

#### `apps/server/src/agent/tools/manipulate-canvas.ts`

- 对新 runtime 禁止继续盲目 fallback 到 `user_id` 充当 `agent_id`。
- 优先使用 `agent_id`；必要时再用 `target_container_id` 定位写入容器。
- 失败返回结构化、可诊断错误，而不是笼统失败字符串。重点区分：
  - `missing_agent_context`
  - `ambiguous_target_container`
  - `permission_denied`
  - `container_not_found`
- 对 `inferWritableContainerId()` 做约束收敛：
  - 有显式 `target_container_id` 时不再二次猜测。
  - 没有显式目标时，只允许在“单候选容器”下自动推断。

### C. 让内置 deep agent 与外部 MCP agent 共享同一工作流语义

#### `apps/server/src/agent/prompts/cucumber-main.ts`

- 保留当前中文系统提示，但要补强为“协议对齐版”：
  - 明确画布编辑属于 `canvas MCP tools` 范畴。
  - 修改现有设计时，先通过 `inspect_canvas` 获取精确信息，再决定 `manipulate_canvas` 批量写入。
  - 明确当返回 `missing_agent_context` / `ambiguous_target_container` 时应该要求用户选择容器，而不是继续盲猜。
- 参考 `openpencil` 的写法，把“工具调用的推荐顺序”说清楚，而不只是列工具名称。

#### `apps/server/src/agent/tools/index.ts`

- 保持工具来源统一于 `createCucumberMcpServer()`。
- 如果后续增加 HTTP MCP route，不新增第二份 agent tool factory，避免 registry 漂移。

### D. 补可观测性与对外诊断，降低“看起来 agent 不会调工具”的排查成本

#### `apps/server/src/agent/run-event-pump.ts`

- 在 `tool.started` / `tool.completed` 基础上，确保失败结果能带出 MCP 结构化错误摘要。
- 对画布工具调用增加更直观的 outputSummary，便于前端 UI 判断是：
  - 没有 canvas context
  - 权限拒绝
  - 容器歧义
  - 正常应用成功

#### 新增 `apps/server/src/http/mcp.ts` 内的状态查询或轻量诊断接口

- 参考 OpenPencil `document-manager` 的思路，最少提供 MCP 运行态与上下文可用性的轻量诊断。
- 目标是让后续前端或 ACP 接入前可以先做：
  - server 是否可达
  - 当前 canvas 上下文是否齐备
  - 当前 agent/container 解析是否成功

### E. 文档对齐

#### `docs/architecture.md`

- 补一节 “Agent ↔ Canvas ↔ MCP”：
  - Web chat run → `RunEventPump`
  - `AgentRunService` → `createCucumberDeepAgent`
  - deep agent / external agent → `createCucumberMcpServer`
  - MCP tools → Supabase `canvases.content`
  - `CanvasEventBuffer` / SSE → 前端画布刷新
- 明确“单一协议面”原则：
  - 画布能力只定义一次
  - 内部 bridge 与外部 MCP transport 共享同一批工具
- 明确 agent identity / container identity / user identity 三者不可混用。

## Assumptions & Decisions

- 决策 1：不改成 OpenPencil 那种完全独立仓外 MCP 进程；先在当前 Fastify 服务内提供 HTTP MCP transport，降低接入与部署复杂度。
- 决策 2：`createCucumberMcpServer()` 继续作为唯一 MCP tool registry，避免同时维护 “internal tools” 和 “external MCP tools” 两个源。
- 决策 3：新 Cucumber canvas runtime 下，`user_id` 不再视为合法的 agent identity；写入权限必须基于显式或可推导的 `agent_id`。
- 决策 4：多容器场景下默认不再做高风险隐式猜测；容器候选不唯一时优先返回结构化错误，引导指定目标容器。
- 假设 1：当前用户提到的 “agent 调不了画布工具” 主要指新 `CucumberCanvasDocument` 路径，而非旧 Excalidraw elements 路径。
- 假设 2：短期内只需要让内部 agent 与未来 ACP/external agent 共用协议面，不要求本轮直接接完完整 ACP UI。

## Verification Steps

- 单元测试：
  - 更新 `apps/server/src/agent/tools/manipulate-canvas.test.ts`
    - 显式 `agent_id` 可写入绑定容器
    - 缺失 `agent_id` 时返回 `missing_agent_context`
    - 多候选容器时返回 `ambiguous_target_container`
  - 新增 MCP HTTP route 测试，覆盖：
    - `listTools`
    - `callTool(inspect_canvas)`
    - 鉴权失败
    - context 注入正确
- 契约测试：
  - 更新 `packages/shared/src/contracts.test.ts`，验证新增 `agentId` / `targetContainerId` 字段兼容旧请求。
- 集成测试：
  - 增加一条 `apps/server/src/agent/*integration*.test.ts` 风格用例，构造绑定容器的 Cucumber canvas，验证 agent run 至少能成功触发一次 `manipulate_canvas` 并完成写入。
  - 额外验证 `tool.started` / `tool.completed` 事件里能看到结构化错误摘要。
- 手工验证：
  - 在绑定了 agent 的容器上发起一条“修改当前容器内容”的聊天指令，确认画布发生真实变更。
  - 在存在多个容器且未指定目标时，确认 agent 不乱写，而是返回明确提示。
  - 通过新 `/api/mcp` 路由做一次 `listTools` 与 `manipulate_canvas` 调用，确认可独立访问。
- 质量门禁：
  - 对受影响 workspace 跑最小必要测试与类型检查。
  - 若改动了协议或运行时路径，补充 `docs/architecture.md` 说明。
