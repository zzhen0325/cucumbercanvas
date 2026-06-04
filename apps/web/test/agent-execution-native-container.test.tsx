// @vitest-environment jsdom

import type { AgentExecutionContainer } from "@cucumber/canvas-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentExecutionNativeContainer } from "@/components/canvas/agent-execution-native-container";

describe("AgentExecutionNativeContainer", () => {
  const container: AgentExecutionContainer = {
    artifactRefs: [{ nodeId: "artifact-1" }],
    containerId: "agent_execution_1",
    diagnostics: {
      legacyDisplayText: "输出：old generated canvas child text",
    },
    kind: "agent_execution",
    runId: "run-1",
    schemaVersion: 1,
    sessionId: "session-1",
    status: "running",
    streamParts: [
      {
        content: "正在生成视觉方向。",
        id: "message:message-1",
        label: "输出",
        status: "running",
        timestamp: "2026-06-04T01:00:00.000Z",
        type: "message",
      },
    ],
    summary: "正在生成视觉方向。",
    title: "Agent 执行",
    todos: [
      { content: "读取当前画布", status: "completed" },
      { content: "生成原生执行容器", status: "in_progress" },
      { content: "放置最终产物", status: "pending" },
    ],
    toolParts: [
      {
        id: "tool:tool-1",
        outputSummary: "图片容器已创建",
        status: "done",
        timestamp: "2026-06-04T01:00:01.000Z",
        toolCallId: "tool-1",
        toolName: "generate_image",
      },
    ],
  };

  it("renders structured stream, todo, and tool state from the native container", () => {
    render(<AgentExecutionNativeContainer container={container} />);

    expect(
      screen.getByRole("region", { name: "Agent 执行容器：Agent 执行" }),
    ).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
    expect(screen.getByText("正在生成视觉方向。")).toBeVisible();
    expect(screen.getByText("读取当前画布")).toBeVisible();
    expect(screen.getByText("生成原生执行容器")).toBeVisible();
    expect(screen.getByText("放置最终产物")).toBeVisible();
    expect(screen.getByText("generate image")).toBeVisible();
    expect(screen.getByText("图片容器已创建")).toBeVisible();
    expect(screen.getByText("1 个产物")).toBeVisible();
  });

  it("keeps legacy canvas display text diagnostic-only", () => {
    render(<AgentExecutionNativeContainer container={container} />);

    expect(
      screen.queryByText("输出：old generated canvas child text"),
    ).not.toBeInTheDocument();
  });
});
