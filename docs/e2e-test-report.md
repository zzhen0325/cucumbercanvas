# CucumberCanvas 端到端测试报告

## 1. 测试目标
本轮测试覆盖 4 个改造域：

1. **Phase 1 & 2：SSE 替代 agent 流式 WebSocket**
2. **Phase 3：MCP 工具注册 / bridge / generate_image data URI 修复**
3. **Phase 4：Supabase tasks 替代 PGMQ**
4. **WebSocket 收敛**：仅保留 RPC / browser bridge，不再承载 agent run stream

同时补充回归验证：
- `@cucumber/server` / `@cucumber/web` 单测
- `@cucumber/server` / `@cucumber/web` typecheck
- 发现问题即修复

---

## 2. 本次新增/补齐的测试

### 2.1 新增测试文件
1. `apps/server/src/http/sse.test.ts`
2. `apps/server/src/ws/handler.test.ts`
3. `apps/server/src/mcp/schema.test.ts`
4. `apps/server/src/queue/task-manager.test.ts`

### 2.2 顺手修复的历史问题
- `apps/web/src/lib/auth-context.tsx`
  - 修复 `makeDevSession()` 中 `expires_at: undefined` 导致的 `exactOptionalPropertyTypes` 类型错误
  - 改为合法时间戳后，`@cucumber/web` typecheck 已恢复通过

---

## 3. 测试执行命令与结果

### 3.1 Server 定向新增测试
```bash
cd apps/server
pnpm test src/http/sse.test.ts src/ws/handler.test.ts src/mcp/schema.test.ts src/queue/task-manager.test.ts
```
结果：**4 个测试文件全部通过，13/13 tests passed**

### 3.2 Server 全量测试
```bash
cd apps/server
pnpm test
```
结果：**11 个测试文件全部通过，31/31 tests passed**

### 3.3 Server 类型检查
```bash
cd apps/server
pnpm typecheck
```
结果：**通过**

### 3.4 Web 全量测试
```bash
cd apps/web
pnpm test
```
结果：**12 个测试文件全部通过，42/42 tests passed**

### 3.5 Web 类型检查
```bash
cd apps/web
pnpm typecheck
```
结果：**通过**

### 3.6 格式化
```bash
pnpm exec biome format --write \
  apps/server/src/http/sse.test.ts \
  apps/server/src/ws/handler.test.ts \
  apps/server/src/mcp/schema.test.ts \
  apps/server/src/queue/task-manager.test.ts \
  apps/web/src/lib/auth-context.tsx
```
结果：**已完成**

---

## 4. 分模块测试结论

## 4.1 SSE 流（Phase 1 & 2）
### 目标
验证：
- SSE 端点可连接
- `Last-Event-ID` / query cursor 可回放历史事件
- 连接期间会定期发送 heartbeat
- 新事件会继续实时推送

### 覆盖方式
新增：`apps/server/src/http/sse.test.ts`

### 核心断言
1. 当连接时同时带 query `lastEventId=0` 和 header `last-event-id=1` 时：
   - 服务端按 header 优先，从 seq=2 开始回放
   - 不会重复推送 seq=1
2. SSE 建立后推送新事件：
   - 客户端能继续收到 seq=4 的 live event
3. 空闲连接期间：
   - 30 秒后收到 `: heartbeat <timestamp>` 注释帧

### 结论
**通过。**
SSE 端点、历史重放、心跳保活、实时续流均符合预期。

---

## 4.2 WebSocket 收敛（仅 RPC）
### 目标
验证：
- 非 RPC 消息不会再被当成 agent 流处理
- WebSocket 仅消费 `rpc.response`
- 非法 token 会被拒绝

### 覆盖方式
新增：`apps/server/src/ws/handler.test.ts`

### 核心断言
1. 非法 token 建连：
   - socket 以 `4001 Unauthorized` 关闭
2. 发送非 `rpc.response` 消息（例如 `agent.run`）：
   - `connectionManager.handleRpcResponse` 不会被调用
3. 发送合法 `rpc.response`：
   - 会被正确转交到 `connectionManager.handleRpcResponse`

### 结论
**通过。**
WebSocket 已收敛为 RPC 专用通道，没有回退到旧的 run-stream 语义。

> 备注：仓库当前不存在 `canvas.sync / viewport / cursor` 这一套高频协同协议实现，因此本轮未对该类消息做额外验证；本轮验证对象是“当前仓库中的 WS 语义是否已收敛为 RPC-only”。

---

## 4.3 MCP Server / Bridge / Tool Schema（Phase 3）
### 目标
验证：
- MCP tool registry 能正常列出工具
- 工具暴露 JSON schema
- bridge 后工具仍可被 DeepAgent 调用
- 缺失工具时错误结构稳定

### 覆盖方式
- 既有：`apps/server/src/mcp/deepagents-bridge.test.ts`
- 新增：`apps/server/src/mcp/schema.test.ts`

### 核心断言
1. `schemaToJsonSchema()` 可将 Zod schema 转成 MCP 所需 JSON schema
2. `createCucumberMcpServer().listTools()` 中 `generate_image` 暴露 object schema，包含 `prompt` / `title` / `model`
3. 调用不存在工具时：
   - 返回结构化 `tool_not_found` 错误
4. `bridgeMcpToolToDeepAgent()`：
   - `generate_image` 经过 MCP bridge 后仍能正常调用，并正确把展示名模型映射到 provider model id

### 结论
**通过。**
MCP registry、schema 暴露、bridge 调用链均正常。

---

## 4.4 data URI 上传修复（Phase 3）
### 目标
验证：
- `generate_image` 输入中的 `data:` URI 能被解码、上传并转成公开 URL
- 普通 URL 不受影响
- 非法 data URI 能明确报错

### 覆盖方式
既有：`apps/server/src/features/jobs/executors/inline-input-images.test.ts`

### 核心断言
1. `data:image/png;base64,...`：
   - 能正确 decode
   - 能按 workspace/job 生成对象路径
   - 上传后返回 CDN/public URL
2. 普通 URL：
   - 原样保留
3. 非法 data URI：
   - 抛出明确错误 `Invalid data URI`

### 结论
**通过。**
本轮没有发现 data URI 回归问题。

---

## 4.5 Supabase Tasks / Worker（Phase 4）
### 目标
验证：
- 入队、claim、续租、成功、重试、死信、取消等状态迁移逻辑
- 关键 SQL 参数归一化行为（如最小 lease/poll）
- Worker 依赖的 TaskManager 行为可靠

### 覆盖方式
新增：`apps/server/src/queue/task-manager.test.ts`

### 核心断言
1. `enqueue()`：
   - 负 delay 会被钳制为 `0`
   - 返回行会正确映射成 `BackgroundTask`
2. `claimWithPoll()`：
   - `leaseSeconds`、`limit`、`maxPollSeconds`、`pollIntervalMs` 会按下限归一化
3. `renewLease()`：
   - 只有当前 worker 仍持有任务时才返回成功
4. `markSucceeded()` / `requeue()` / `markDeadLetter()` / `markCanceled()`：
   - 均会走到对应状态迁移 SQL
5. `cancelByJobId()` / `shutdown()`：
   - 能批量取消 queued/running 任务并释放连接池

### 结论
**通过。**
TaskManager 的核心状态机和 SQL 调用路径已被补测，满足当前 worker 轮询模型的基本可靠性需求。

> 说明：本轮对 `TaskManager` 采用的是 **mock pg pool 的行为测试**，重点验证 SQL 入口、参数规整与状态流转，不是连真实 Supabase/Postgres 的外部环境 E2E。若后续要做更高等级验证，建议补一套临时数据库集成测试。

---

## 5. 回归测试汇总

### Server
- `src/generation/providers/seedream-prompt.test.ts`
- `src/features/jobs/executors/inline-input-images.test.ts`
- `src/features/canvas/canvas-element-writer.test.ts`
- `src/queue/task-manager.test.ts`
- `src/http/sse.test.ts`
- `src/agent/reasoning-content-deepseek.test.ts`
- `src/agent/reasoning-content-openai.test.ts`
- `src/ws/handler.test.ts`
- `src/agent/tools/image-generate.test.ts`
- `src/mcp/schema.test.ts`
- `src/mcp/deepagents-bridge.test.ts`

共：**31/31 通过**

### Web
- `test/env.test.ts`
- `test/server-api.test.ts`
- `test/home-discovery-library.test.ts`
- `test/home-example-library.test.ts`
- `test/auth-context.test.tsx`
- `test/auth-callback.test.tsx`
- `test/home-example-browser.test.tsx`
- `test/home-discovery-gallery.test.tsx`
- `test/login.test.tsx`
- `test/register.test.tsx`
- `test/projects.test.tsx`
- `test/chat-sidebar.test.tsx`

共：**42/42 通过**

---

## 6. 本轮新增/修改文件

### 新增测试文件
- `apps/server/src/http/sse.test.ts`
- `apps/server/src/ws/handler.test.ts`
- `apps/server/src/mcp/schema.test.ts`
- `apps/server/src/queue/task-manager.test.ts`

### 修复文件
- `apps/web/src/lib/auth-context.tsx`

---

## 7. 风险与建议
1. **SSE 已有服务级集成测试，但仍是进程内测试**
   - 当前已覆盖 replay / heartbeat / live push
   - 如果后续要覆盖真实浏览器 EventSource 行为，建议再补一层 browser E2E

2. **TaskManager 目前是 mock-pg 行为测试，不是真库并发测试**
   - 当前已验证核心 SQL 入口和状态迁移
   - 如果要验证 `FOR UPDATE SKIP LOCKED` 在真实数据库的竞争语义，建议补一套临时 Postgres/Supabase 集成测试

3. **Web typecheck 暴露了一个历史遗留问题，已顺手修复**
   - 说明这轮测试不仅验证了新增改造，也清掉了一个旧问题

---

## 8. 最终结论
本轮针对 **SSE / MCP / data URI / Supabase tasks / WebSocket 收敛** 的回归验证已经完成，结果如下：

- `@cucumber/server`：**31/31 tests passed**
- `@cucumber/web`：**42/42 tests passed**
- `@cucumber/server typecheck`：**通过**
- `@cucumber/web typecheck`：**通过**

### 结论判定
**本次 4 阶段改造在当前仓库内的主要行为已通过测试验证，可以进入下一步联调/验收。**

如果后续需要更高置信度，我建议下一步补两类测试：
1. 连真实 Supabase/Postgres 的 tasks 并发集成测试
2. 浏览器层 EventSource / WebSocket 的黑盒 E2E
