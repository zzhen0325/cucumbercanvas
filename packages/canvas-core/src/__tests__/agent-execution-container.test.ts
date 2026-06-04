import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_CONTAINER_META_KEY,
  createAgentExecutionContainerFromNodeMeta,
  reduceAgentExecutionContainerStreamEvent,
} from "../agent-execution-container.js";
import type { AgentExecutionNodeMeta } from "../agent-execution.js";

describe("AgentExecutionContainer", () => {
  const legacyExecution: AgentExecutionNodeMeta = {
    kind: "agent_execution",
    runId: "run-1",
    schemaVersion: 1,
    sessionId: "session-1",
    status: "waiting",
    summary: "Waiting to start",
    title: "Generate moodboard",
  };

  it("normalizes legacy execution meta into a first-class container", () => {
    const container = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_execution_1",
      execution: legacyExecution,
    });

    expect(AGENT_EXECUTION_CONTAINER_META_KEY).toBe("agentExecutionContainer");
    expect(container).toMatchObject({
      containerId: "agent_execution_1",
      kind: "agent_execution",
      runId: "run-1",
      sessionId: "session-1",
      status: "waiting",
      title: "Generate moodboard",
    });
    expect(container.streamParts).toEqual([]);
    expect(container.todos).toEqual([]);
    expect(container.toolParts).toEqual([]);
  });

  it("reduces message and tool events into container stream and tool parts", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_execution_1",
      execution: legacyExecution,
    });
    const events = [
      {
        runId: "run-1",
        timestamp: "2026-06-04T01:00:00.000Z",
        type: "run.started" as const,
      },
      {
        delta: "Hello",
        messageId: "msg-1",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:01.000Z",
        type: "message.delta" as const,
      },
      {
        input: { prompt: "draw" },
        runId: "run-1",
        timestamp: "2026-06-04T01:00:02.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.started" as const,
      },
      {
        output: { artifactNodeIds: ["artifact-1"] },
        outputSummary: "image ready",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:03.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.completed" as const,
      },
    ];

    const next = events.reduce(
      reduceAgentExecutionContainerStreamEvent,
      initial,
    );

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

  it("keeps legacy display text out of runtime container decisions", () => {
    const container = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_execution_1",
      execution: legacyExecution,
      legacyDisplayText: "输出：old generated child text",
    });

    expect(container.summary).toBe("Waiting to start");
    expect(container.diagnostics?.legacyDisplayText).toBe(
      "输出：old generated child text",
    );
  });

  it("normalizes write_todos tool output into container todo state", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_execution_1",
      execution: legacyExecution,
    });

    const next = reduceAgentExecutionContainerStreamEvent(initial, {
      output: {
        todos: [
          { content: "读取画布上下文", status: "completed" },
          {
            activeForm: "正在生成首屏图",
            content: "生成视觉方案",
            status: "in_progress",
          },
        ],
      },
      runId: "run-1",
      timestamp: "2026-06-04T01:00:03.000Z",
      toolCallId: "tool-1",
      toolName: "write_todos",
      type: "tool.completed",
    });

    expect(next.todos).toEqual([
      { content: "读取画布上下文", status: "completed" },
      {
        activeForm: "正在生成首屏图",
        content: "生成视觉方案",
        status: "in_progress",
      },
    ]);
  });
});
