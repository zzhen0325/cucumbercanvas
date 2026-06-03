# Debug Session: agent-followup-chat
- **Status**: [CLOSED]
- **Issue**: Agent 首轮对话可正常执行任务，第二轮发送消息后 UI 短暂显示“思考中”随即消失，没有继续响应。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-agent-followup-chat.ndjson

## Reproduction Steps
1. 打开 Agent 对话界面。
2. 发起第一轮对话并等待 Agent 成功执行任务。
3. 继续发送第二轮消息。
4. 观察到“思考中”短暂出现后消失，且没有新的响应或错误提示。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 第二轮消息发送成功，但前端流式订阅或会话状态在首轮结束后被错误关闭，导致后续 token/event 被直接丢弃 | High | Low | Confirmed |
| B | 首轮任务完成后后端 Agent run/thread 状态未正确重置，第二轮命中非法运行态并提前结束 | High | Medium | Rejected |
| C | 第二轮请求被正常发出，但服务端返回错误，前端错误分支吞掉异常并把 loading 状态重置为空白 | High | Low | Rejected |
| D | 首轮任务后 WebSocket/SSE channel 被释放或 sessionId/runId 失配，导致 UI 等待中的状态被瞬间中断 | Medium | Medium | Confirmed |
| E | 首轮任务写入持久化消息成功，但第二轮命中消息去重/乐观更新 bug，UI 将新请求立即回滚 | Medium | Medium | Rejected |

## Log Evidence
- L1: 当前发送已拿到新 runId `fd529e1c-2b30-44e2-a39b-d586e58cea26`，说明请求已被服务端接受。
- L4-L7: 新 SSE 连接一建立就开始收到旧 run `eda07903-85c9-488a-b7e1-bda50845fb1e` 的缓存事件，直到其 `run.completed`。
- L8-L10: 前端识别到 terminal event 的 runId 与当前 runId 不一致，但 `useSseStream` 仍将其视为 terminal 并执行 `stop()`，随后 `streaming` 退出。

## Instrumentation
- `apps/web/src/hooks/use-sse-stream.ts`: 记录 SSE 建连、开流、前几条事件、terminal event 和 stop 时机。
- `apps/web/src/components/chat-sidebar.tsx`: 记录本次 accepted runId、收到的错 run terminal event、当前 run 的关键事件、streaming 退出时机。

## Verification Conclusion
- 根因已确认：`/api/canvases/:canvasId/stream` 在新连接时会回放该 canvas 的历史缓冲事件；前端 `useSseStream` 对“任何 terminal event”都会立刻 stop，而不是仅对当前 run 的 terminal event stop，导致后续对话在旧 run 的 `run.completed` 上被提前中止。

## Resolution
- The current `ChatSidebar` run-scoped `shouldStop` predicate is now covered by regression testing, so replayed terminal events from older runs do not end the active run stream.
- Removed the temporary browser debug POST probes from `ChatSidebar` and `useSseStream`; the app no longer emits `http://127.0.0.1:7777/event` requests during normal chat/canvas use.
- Added a focused `useSseStream` regression test covering old-run terminal replay followed by active-run events.
