# Agent Native Execution Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production slice of Agent-native execution containers so stream/todo/tool state has a dedicated Agent truth instead of being assembled from canvas text children.

**Architecture:** Add a shared typed `AgentExecutionContainer` contract and reducer in `packages/canvas-core`, then update the Web stream write-back hook to maintain container state under `PenNode.meta.agentExecutionContainer` while leaving the canvas shell as the spatial anchor. Keep legacy `meta.agentExecution` as migration input during this slice, and stop rewriting generated display children during streaming updates.

**Tech Stack:** TypeScript, Vitest, Next.js React components, existing `@cucumber/canvas-core` exports, existing `StreamEvent` contracts from `@cucumber/shared`.

---

## File Structure

- `packages/canvas-core/src/agent-execution-container.ts`: new single-responsibility contract and reducer for Agent-native execution containers.
- `packages/canvas-core/src/index.ts`: export the new contract/helpers.
- `packages/canvas-core/src/__tests__/agent-execution-container.test.ts`: unit tests for container creation, stream reduction, and legacy boundary behavior.
- `apps/web/src/components/canvas/use-canvas-agent-execution-stream-writeback.ts`: update Web write-back to persist container state and avoid generated canvas child updates for streaming internals.
- `apps/web/test/canvas-agent-execution-stream-writeback.test.ts`: update tests to assert container truth and no canvas child rewrites.
- `docs/tech/agent-native-execution-container-design.md`: keep as design source; update only if implementation reveals a boundary correction.

## Task 1: Shared Container Contract And Reducer

**Files:**
- Create: `packages/canvas-core/src/agent-execution-container.ts`
- Modify: `packages/canvas-core/src/index.ts`
- Test: `packages/canvas-core/src/__tests__/agent-execution-container.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import type { AgentExecutionNodeMeta } from "../agent-execution";
import {
  AGENT_EXECUTION_CONTAINER_META_KEY,
  createAgentExecutionContainerFromNodeMeta,
  reduceAgentExecutionContainerStreamEvent,
} from "../agent-execution-container";
import type { StreamEvent } from "@cucumber/shared";

describe("AgentExecutionContainer", () => {
  const legacy: AgentExecutionNodeMeta = {
    kind: "agent_run_node",
    schemaVersion: 1,
    status: "waiting",
    title: "Generate moodboard",
    summary: "Waiting to start",
    runId: "run-1",
    sessionId: "session-1",
  };

  it("normalizes legacy execution node meta into a first-class container", () => {
    const container = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacy,
    });

    expect(AGENT_EXECUTION_CONTAINER_META_KEY).toBe("agentExecutionContainer");
    expect(container).toMatchObject({
      containerId: "agent_run_node_1",
      kind: "agent_run_node",
      runId: "run-1",
      sessionId: "session-1",
      status: "waiting",
      title: "Generate moodboard",
    });
    expect(container.streamParts).toEqual([]);
    expect(container.todos).toEqual([]);
    expect(container.toolParts).toEqual([]);
  });

  it("reduces message and tool events into container stream/tool parts", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacy,
    });
    const events: StreamEvent[] = [
      {
        runId: "run-1",
        timestamp: "2026-06-04T01:00:00.000Z",
        type: "run.started",
      },
      {
        delta: "Hello",
        messageId: "msg-1",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:01.000Z",
        type: "message.delta",
      },
      {
        input: { prompt: "draw" },
        runId: "run-1",
        timestamp: "2026-06-04T01:00:02.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.started",
      },
      {
        outputSummary: "image ready",
        output: { artifactNodeIds: ["artifact-1"] },
        runId: "run-1",
        timestamp: "2026-06-04T01:00:03.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.completed",
      },
    ];

    const next = events.reduce(reduceAgentExecutionContainerStreamEvent, initial);

    expect(next.status).toBe("running");
    expect(next.summary).toBe("image ready");
    expect(next.streamParts.map((part) => part.type)).toEqual([
      "message",
      "tool",
    ]);
    expect(next.toolParts).toEqual([
      expect.objectContaining({
        id: "tool:tool-1",
        outputSummary: "image ready",
        status: "done",
        toolCallId: "tool-1",
        toolName: "generate_image",
      }),
    ]);
    expect(next.artifactRefs).toEqual([{ nodeId: "artifact-1" }]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cucumber/canvas-core test -- agent-execution-container.test.ts --run`

Expected: FAIL because `agent-execution-container` does not exist.

- [x] **Step 3: Write minimal implementation**

Add the new file with:

```ts
import type { StreamEvent } from "@cucumber/shared";
import type {
  AgentExecutionNodeKind,
  AgentExecutionNodeMeta,
  AgentExecutionStatus,
} from "./agent-execution";

export const AGENT_EXECUTION_CONTAINER_META_KEY = "agentExecutionContainer";
export const AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION = 1;

export interface AgentExecutionContainer {
  schemaVersion: typeof AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION;
  containerId: string;
  kind: AgentExecutionNodeKind;
  status: AgentExecutionStatus;
  title: string;
  summary?: string;
  runId?: string;
  sessionId?: string;
  agentId?: string;
  streamParts: AgentExecutionContainerStreamPart[];
  todos: AgentExecutionContainerTodo[];
  toolParts: AgentExecutionContainerToolPart[];
  artifactRefs: AgentExecutionArtifactRef[];
  legacyNodeMeta?: AgentExecutionNodeMeta;
}
```

Implement event reduction by mapping `message.delta`, `thinking.delta`, `agent.stage`, `tool.started`, `tool.completed`, `run.completed`, `run.paused`, `run.canceled`, and `run.failed` to structured container fields.

- [x] **Step 4: Export and run tests**

Run: `pnpm --filter @cucumber/canvas-core test -- agent-execution-container.test.ts --run`

Expected: PASS.

## Task 2: Web Stream Write-Back Uses Container Truth

**Files:**
- Modify: `apps/web/src/components/canvas/use-canvas-agent-execution-stream-writeback.ts`
- Test: `apps/web/test/canvas-agent-execution-stream-writeback.test.ts`

- [x] **Step 1: Write/update failing tests**

Add a test proving stream write-back returns semantic/container updates without presentation children:

```ts
it("builds container updates without rewriting generated canvas children", () => {
  const node = createAgentRunNode({
    runId: "run-1",
    title: "Run",
    x: 0,
    y: 0,
  });

  const updates = getAgentExecutionStreamWritebackUpdates(node, {
    delta: "Native stream",
    messageId: "msg-1",
    runId: "run-1",
    timestamp: "2026-06-04T01:00:00.000Z",
    type: "message.delta",
  });

  expect(updates).not.toHaveProperty("children");
  expect(updates.meta?.agentExecutionContainer).toMatchObject({
    containerId: node.id,
    status: "running",
    streamParts: [
      expect.objectContaining({
        id: "message:msg-1",
        type: "message",
        content: "Native stream",
      }),
    ],
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- canvas-agent-execution-stream-writeback.test.ts --run`

Expected: FAIL because the helper does not exist or updates still include `children`.

- [x] **Step 3: Implement minimal Web helper**

Extract a pure helper:

```ts
export function getAgentExecutionStreamWritebackUpdates(
  node: PenNode,
  event: StreamEvent,
): Partial<PenNode> | null
```

The helper should:

- Read legacy `meta.agentExecution` only as boundary input.
- Read existing `meta.agentExecutionContainer` when present.
- Reduce the event into the container.
- Preserve spatial shell fields.
- Update `meta.agentExecutionContainer`.
- Keep top-level semantic status in sync via `getAgentExecutionNodeSemanticUpdates`.
- Not call `getAgentExecutionNodePresentationUpdates`.
- Not return `children`.

- [x] **Step 4: Run Web test**

Run: `pnpm --filter web test -- canvas-agent-execution-stream-writeback.test.ts --run`

Expected: PASS.

## Task 3: Documentation And Verification

**Files:**
- Modify: `docs/tech/agent-native-execution-container-design.md` only if needed.
- Modify: `progress.md` and `feature_list.json` only if their current user edits can be safely preserved and this feature is tracked there.

- [x] **Step 1: Check docs for stale claims**

Run: `rg -n "display children|text child|Agent-only canvas state|meta.agentExecution.*truth|generated execution" docs/tech packages/canvas-core apps/web/src/components/canvas -S`

Expected: Identify any directly contradicted docs or leave a note in final if broader docs need a follow-up.

- [x] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @cucumber/canvas-core test -- agent-execution-container.test.ts --run
pnpm --filter web test -- canvas-agent-execution-stream-writeback.test.ts --run
pnpm --filter @cucumber/canvas-core typecheck
pnpm --filter web typecheck
```

Expected: Relevant tests and TypeScript checks pass, or existing unrelated failures are named with file paths.

- [x] **Step 3: Summarize boundary checklist**

Final response must answer:

- Runtime truth: `AgentExecutionContainer`.
- Migration input: legacy `meta.agentExecution` and generated children.
- Canvas truth: `PenDocument.pages` shell and artifacts.
- UI controls: no new inert controls.
- Old fields in core path: only boundary normalization in this slice.

## Task 4: Native Container Renderer

**Files:**
- Create: `apps/web/src/components/canvas/agent-execution-native-container.tsx`
- Test: `apps/web/test/agent-execution-native-container.test.tsx`

- [x] **Step 1: Write the failing test**

Render an `AgentExecutionContainer` with a message stream part, todo items,
and a completed tool part. Assert that the component shows structured Agent UI
and does not render `diagnostics.legacyDisplayText` as runtime content.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec vitest run test/agent-execution-native-container.test.tsx`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the component**

Create a small React component that renders:

- Header with title/status.
- Waiting/failure summary when present.
- Todo list from `container.todos`.
- Tool list from `container.toolParts`.
- Stream list from `container.streamParts`.

The component must not read canvas children or render
`diagnostics.legacyDisplayText` as user-facing runtime output.

- [x] **Step 4: Run test to verify it passes**

## Task 5: Native Container Creation Paths

**Files:**
- Modify: `packages/canvas-core/src/agent-execution-container.ts`
- Modify: `packages/canvas-core/src/agent-execution-layout.ts`
- Modify: `apps/server/src/mcp/tools/create-agent-execution-flow.ts`
- Test: `packages/canvas-core/src/__tests__/agent-execution.test.ts`
- Test: `apps/server/src/mcp/tools/create-agent-execution-flow.test.ts`

- [x] **Step 1: Add a helper for writing container metadata**

Added `withAgentExecutionContainerMeta` so creation paths do not hand-write
`meta.agentExecutionContainer` in parallel shapes.

- [x] **Step 2: Stop composing new compact execution shells from text children**

`createAgentRunNode` now creates an empty canvas shell and writes
`AgentExecutionContainer` state for native React rendering. The canvas shell
still owns position, size, connector anchoring, and selection.

- [x] **Step 3: Make MCP execution-flow cards first-class containers**

`create_agent_execution_flow` now writes `meta.agentExecutionContainer` for
each generated execution card while preserving `meta.agentExecution` as the
legacy semantic index/migration input.

- [x] **Step 4: Normalize TODO tool output into container todos**

`tool.completed` events from `write_todos` now update
`AgentExecutionContainer.todos` when the tool returns an explicit
`output.todos` array.

Run: `pnpm --dir apps/web exec vitest run test/agent-execution-native-container.test.tsx`

Expected: PASS.
