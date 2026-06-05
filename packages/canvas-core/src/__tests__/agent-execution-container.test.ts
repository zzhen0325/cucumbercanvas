import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_CONTAINER_META_KEY,
  createAgentExecutionContainerFromNodeMeta,
  formatAgentExecutionContainerCanvasBody,
  reduceAgentExecutionContainerStreamEvent,
} from "../agent-execution-container.js";
import type { AgentExecutionNodeMeta } from "../agent-execution.js";
import { getAgentRunNodeViewModel } from "../agent-run-node-view-model.js";

describe("AgentExecutionContainer", () => {
  const legacyExecution: AgentExecutionNodeMeta = {
    kind: "agent_run_node",
    runId: "run-1",
    schemaVersion: 1,
    sessionId: "session-1",
    status: "waiting",
    summary: "Waiting to start",
    title: "Generate moodboard",
  };

  it("normalizes legacy execution meta into a first-class container", () => {
    const container = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacyExecution,
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

  it("reduces message and tool events into container stream and tool parts", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
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
        input: { prompt: "draw" },
        output: { artifactNodeIds: ["artifact-1"] },
        outputSummary: "image ready",
        status: "done",
        toolCallId: "tool-1",
        toolName: "generate_image",
      }),
    ]);
    expect(next.artifactRefs).toEqual([{ nodeId: "artifact-1" }]);
  });

  it("maps container content into an AgentRunNode React view model", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: {
        ...legacyExecution,
        summary: "旧摘要不应该覆盖 container 消息",
      },
      legacyDisplayText: "旧子节点文本",
    });
    const events = [
      {
        delta: "先分析需求。",
        messageId: "thinking-1",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:01.000Z",
        type: "thinking.delta" as const,
      },
      {
        delta: "**生成完成**",
        messageId: "message-1",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:02.000Z",
        type: "message.delta" as const,
      },
      {
        input: { prompt: "draw" },
        runId: "run-1",
        timestamp: "2026-06-04T01:00:03.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.started" as const,
      },
      {
        output: { elementId: "artifact-1", url: "https://example.com/a.png" },
        outputSummary: "image ready",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:04.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.completed" as const,
      },
      {
        output: {
          todos: [
            { content: "读取画布", status: "completed" },
            {
              activeForm: "正在生成",
              content: "生成图片",
              status: "in_progress",
            },
          ],
        },
        runId: "run-1",
        timestamp: "2026-06-04T01:00:05.000Z",
        toolCallId: "tool-2",
        toolName: "write_todos",
        type: "tool.completed" as const,
      },
    ];
    const container = events.reduce(
      reduceAgentExecutionContainerStreamEvent,
      initial,
    );

    const viewModel = getAgentRunNodeViewModel(container);

    expect(viewModel.reasoning).toMatchObject({
      content: "先分析需求。",
      isStreaming: true,
    });
    expect(viewModel.messages).toEqual([
      expect.objectContaining({ content: "**生成完成**" }),
      expect.objectContaining({
        content: "image ready",
        id: "tool-output:tool-1",
      }),
    ]);
    expect(viewModel.tools[0]).toMatchObject({
      input: { prompt: "draw" },
      output: { elementId: "artifact-1", url: "https://example.com/a.png" },
      state: "output-available",
      toolName: "generate_image",
      type: "tool-generate_image",
    });
    expect(viewModel.tasks).toEqual([
      expect.objectContaining({ status: "completed", title: "读取画布" }),
      expect.objectContaining({
        active: true,
        description: "正在生成",
        status: "in_progress",
        title: "生成图片",
      }),
    ]);
    expect(JSON.stringify(viewModel)).not.toContain("旧子节点文本");
  });

  it("explains missing structured tool details instead of showing raw fallback values", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacyExecution,
    });
    const container = reduceAgentExecutionContainerStreamEvent(initial, {
      outputSummary: "完成但没有结构化输出",
      runId: "run-1",
      timestamp: "2026-06-04T01:00:03.000Z",
      toolCallId: "tool-1",
      toolName: "legacy_tool",
      type: "tool.completed",
    });

    const viewModel = getAgentRunNodeViewModel(container);

    expect(viewModel.tools[0]).toMatchObject({
      inputMissingReason:
        "没有记录工具参数，可能是早期运行事件缺少结构化 input。",
      outputMissingReason: "没有记录工具结果详情，只收到工具摘要。",
    });
    expect(JSON.stringify(viewModel)).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  it("closes running tool parts when the run reaches a terminal state", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacyExecution,
    });
    const running = reduceAgentExecutionContainerStreamEvent(initial, {
      input: { prompt: "draw" },
      runId: "run-1",
      timestamp: "2026-06-04T01:00:01.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.started",
    });
    const completed = reduceAgentExecutionContainerStreamEvent(running, {
      runId: "run-1",
      timestamp: "2026-06-04T01:00:02.000Z",
      type: "run.completed",
    });

    expect(completed.status).toBe("done");
    expect(completed.toolParts).toEqual([
      expect.objectContaining({
        status: "done",
        toolCallId: "tool-1",
      }),
    ]);
    expect(getAgentRunNodeViewModel(completed).tools[0]?.state).toBe(
      "output-available",
    );
  });

  it("normalizes stringified tool records and folds repeated identical tool calls", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacyExecution,
    });
    const input = {
      input: JSON.stringify({
        model: "bytedance/seedream-4.6",
        prompt: "A cute Maltese puppy",
      }),
    };
    const events = [
      {
        input,
        runId: "run-1",
        timestamp: "2026-06-04T01:00:01.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
        type: "tool.started" as const,
      },
      {
        input,
        runId: "run-1",
        timestamp: "2026-06-04T01:00:02.000Z",
        toolCallId: "tool-2",
        toolName: "generate_image",
        type: "tool.started" as const,
      },
      {
        outputSummary: "Generated image (1024×1024)",
        runId: "run-1",
        timestamp: "2026-06-04T01:00:03.000Z",
        toolCallId: "tool-2",
        toolName: "generate_image",
        type: "tool.completed" as const,
      },
    ];
    const container = events.reduce(
      reduceAgentExecutionContainerStreamEvent,
      initial,
    );

    const viewModel = getAgentRunNodeViewModel(container);

    expect(viewModel.tools).toHaveLength(1);
    expect(viewModel.tools[0]).toMatchObject({
      input: {
        model: "bytedance/seedream-4.6",
        prompt: "A cute Maltese puppy",
      },
      outputSummary: "Generated image (1024×1024)",
      state: "output-available",
    });
    expect(viewModel.messages).toEqual([
      expect.objectContaining({
        content: "Generated image (1024×1024)",
        id: "tool-output:tool-2",
      }),
    ]);
  });

  it("keeps legacy display text out of runtime container decisions", () => {
    const container = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
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
      containerId: "agent_run_node_1",
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

  it("formats the first-class container as the canvas node body", () => {
    const initial = createAgentExecutionContainerFromNodeMeta({
      containerId: "agent_run_node_1",
      execution: legacyExecution,
    });
    const withTool = reduceAgentExecutionContainerStreamEvent(initial, {
      output: { artifactNodeIds: ["image-node-1"] },
      outputSummary: "Generated image (1024x1024)",
      runId: "run-1",
      timestamp: "2026-06-04T01:00:03.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.completed",
    });

    expect(formatAgentExecutionContainerCanvasBody(withTool)).toContain(
      "Generated image (1024x1024)",
    );
    expect(formatAgentExecutionContainerCanvasBody(withTool)).toContain(
      "产物：1 个画布产物",
    );
    expect(formatAgentExecutionContainerCanvasBody(withTool)).not.toContain(
      "工具 generate image",
    );
    expect(formatAgentExecutionContainerCanvasBody(withTool)).not.toMatch(
      /\bnull\b|\bundefined\b/,
    );
  });
});
