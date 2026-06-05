import {
  AGENT_EXECUTION_CONTAINER_META_KEY,
  createAgentRunNode,
  getAgentExecutionMeta,
  setAgentExecutionCanvasCollapsed,
} from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";
import { describe, expect, it } from "vitest";

import {
  getAgentExecutionStreamWritebackUpdates,
  reduceAgentExecutionStreamEvent,
} from "@/components/canvas/use-canvas-agent-execution-stream-writeback";

describe("reduceAgentExecutionStreamEvent", () => {
  it("merges stage, message, tool, and terminal events into one execution node meta", () => {
    const node = createAgentRunNode({
      summary: "Thinking...",
      x: 0,
      y: 0,
    });
    const initial = getAgentExecutionMeta(node);
    if (!initial) throw new Error("missing agent execution meta");

    const events: StreamEvent[] = [
      {
        runId: "run-1",
        stage: "planning",
        stageId: "stage-1",
        status: "started",
        summary: "正在拆解目标",
        timestamp: "2026-06-04T00:00:00.000Z",
        type: "agent.stage",
      },
      {
        delta: "先确认输出类型。",
        messageId: "thinking-1",
        runId: "run-1",
        timestamp: "2026-06-04T00:00:01.000Z",
        type: "thinking.delta",
      },
      {
        delta: "我会生成一张封面图。",
        messageId: "message-1",
        runId: "run-1",
        timestamp: "2026-06-04T00:00:02.000Z",
        type: "message.delta",
      },
      {
        input: { prompt: "cover" },
        runId: "run-1",
        timestamp: "2026-06-04T00:00:03.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.started",
      },
      {
        output: { elementId: "image-node-1" },
        outputSummary: "图片容器已创建",
        runId: "run-1",
        timestamp: "2026-06-04T00:00:04.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.completed",
      },
      {
        runId: "run-1",
        timestamp: "2026-06-04T00:00:05.000Z",
        type: "run.completed",
      },
    ];

    const next = events.reduce(reduceAgentExecutionStreamEvent, initial);

    expect(next.kind).toBe("agent_run_node");
    expect(next.status).toBe("done");
    expect(next.details?.reasoningSummary).toBe("先确认输出类型。");
    expect(next.details?.outputSummary).toBe("我会生成一张封面图。");
    expect(next.artifactNodeIds).toEqual(["image-node-1"]);
    expect(next.streamEntries?.map((entry) => entry.type)).toEqual([
      "stage",
      "thinking",
      "message",
      "tool",
    ]);
    expect(next.streamEntries?.at(-1)).toMatchObject({
      content: "图片容器已创建",
      status: "done",
      toolName: "generate_image",
    });
  });

  it("shows a Chinese failure reason without raw fallback values", () => {
    const node = createAgentRunNode({
      summary: "Thinking...",
      x: 0,
      y: 0,
    });
    const initial = getAgentExecutionMeta(node);
    if (!initial) throw new Error("missing agent execution meta");

    const next = reduceAgentExecutionStreamEvent(initial, {
      error: { code: "run_failed", message: "图片服务暂时不可用" },
      runId: "run-1",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "run.failed",
    });

    expect(next.status).toBe("failed");
    expect(next.failure?.reason).toBe("图片服务暂时不可用");
    expect(next.summary).toBe("处理失败：图片服务暂时不可用");
    expect(next.summary).not.toContain("undefined");
  });

  it("builds native container updates without rewriting generated canvas children", () => {
    const node = createAgentRunNode({
      runId: "run-1",
      summary: "Thinking...",
      title: "Run",
      x: 0,
      y: 0,
    });

    const updates = getAgentExecutionStreamWritebackUpdates(node, {
      delta: "Native stream",
      messageId: "message-1",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "message.delta",
    });

    expect(updates).not.toBeNull();
    expect(updates).not.toHaveProperty("children");
    const nextHeight = (updates as { height?: unknown } | null)?.height;
    expect(typeof nextHeight === "number" ? nextHeight : 0).toBeGreaterThan(0);
    expect(updates?.meta?.[AGENT_EXECUTION_CONTAINER_META_KEY]).toMatchObject({
      containerId: node.id,
      status: "running",
      streamParts: [
        expect.objectContaining({
          content: "Native stream",
          id: "message:message-1",
          type: "message",
        }),
      ],
    });
  });

  it("preserves manual collapsed state while streaming content updates", () => {
    const node = setAgentExecutionCanvasCollapsed(
      createAgentRunNode({
        runId: "run-1",
        summary: "Thinking...",
        title: "Run",
        x: 0,
        y: 0,
      }),
      true,
    );

    const updates = getAgentExecutionStreamWritebackUpdates(node, {
      delta: "收起后继续写入。",
      messageId: "message-1",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "message.delta",
    });

    const nextExecution = updates?.meta
      ? getAgentExecutionMeta({ ...node, meta: updates.meta })
      : null;
    expect(nextExecution?.canvasPresentation?.collapsed).toBe(true);
    expect(updates?.meta?.[AGENT_EXECUTION_CONTAINER_META_KEY]).toMatchObject({
      streamParts: [
        expect.objectContaining({
          content: "收起后继续写入。",
          type: "message",
        }),
      ],
    });
  });

  it("keeps structured tool input and output in the native container", () => {
    const node = createAgentRunNode({
      runId: "run-1",
      summary: "Thinking...",
      title: "Run",
      x: 0,
      y: 0,
    });

    const started = getAgentExecutionStreamWritebackUpdates(node, {
      input: { prompt: "cover", size: "1024x1024" },
      runId: "run-1",
      timestamp: "2026-06-04T00:00:00.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.started",
    });
    const nodeAfterStart = {
      ...node,
      meta: started?.meta ?? node.meta,
    };
    const completed = getAgentExecutionStreamWritebackUpdates(nodeAfterStart, {
      output: { elementId: "image-node-1", model: "seedream" },
      outputSummary: "图片容器已创建",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:01.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.completed",
    });

    expect(completed?.meta?.[AGENT_EXECUTION_CONTAINER_META_KEY]).toMatchObject(
      {
        toolParts: [
          expect.objectContaining({
            input: { prompt: "cover", size: "1024x1024" },
            output: { elementId: "image-node-1", model: "seedream" },
            outputSummary: "图片容器已创建",
            status: "done",
            toolCallId: "tool-1",
            toolName: "generate_image",
          }),
        ],
      },
    );
  });
});
