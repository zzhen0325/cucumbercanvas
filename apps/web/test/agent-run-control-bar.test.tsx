// @vitest-environment jsdom

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentRunControlBar } from "@/components/agent-run-control-bar";
import type { CanvasSelectedElement } from "@/components/canvas-editor";

function selectedAgentElement(
  execution: Partial<AgentExecutionNodeMeta>,
): CanvasSelectedElement {
  return {
    agentExecution: {
      kind: "ask_user_more",
      schemaVersion: 1,
      status: "waiting",
      title: "等待品牌资料",
      ...execution,
    } as AgentExecutionNodeMeta,
    height: 160,
    id: "ask-1",
    type: "frame",
    width: 260,
    x: 0,
    y: 0,
  };
}

describe("AgentRunControlBar", () => {
  it("keeps hook order stable when the control bar appears after an empty render", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <AgentRunControlBar runState={{ streaming: false }} />,
    );

    expect(screen.queryByLabelText("Agent run 控制条")).not.toBeInTheDocument();

    rerender(
      <AgentRunControlBar
        runState={{ streaming: false }}
        selectedCanvasElements={[
          selectedAgentElement({
            kind: "checkpoint",
            status: "done",
            title: "Checkpoint 1",
          }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Agent run 控制条")).toBeVisible();
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes(
          "React has detected a change in the order of Hooks",
        ),
      ),
    ).toBe(false);

    consoleError.mockRestore();
  });

  it("shows waiting reason and enables real pause while streaming", async () => {
    const user = userEvent.setup();
    const onPauseRun = vi.fn();

    render(
      <AgentRunControlBar
        runState={{ activeRunId: "run-1", streaming: true }}
        selectedCanvasElements={[
          selectedAgentElement({
            downstreamNodeIds: ["tool-1", "final-1"],
            runId: "run-1",
            upstreamNodeIds: ["goal-1"],
            waitingForUser: {
              acceptsFiles: true,
              prompt: "请补充品牌名和主色。",
              response: {
                attachmentCount: 2,
                submittedAt: "2026-06-04T00:00:00.000Z",
                text: "品牌名 Cucumber Lab，主色绿色。",
              },
            },
          }),
        ]}
        onPauseRun={onPauseRun}
        onStopRun={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Agent run 控制条")).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
    expect(
      screen.getByText(
        "等待用户输入：请补充品牌名和主色。 · 可补充文件/图片 · 已提交：品牌名 Cucumber Lab，主色绿色。 · 已补充 2 个文件/图片",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "等待用户输入：请补充品牌名和主色。 · 可补充文件/图片 · 已提交：品牌名 Cucumber Lab，主色绿色。 · 已补充 2 个文件/图片",
      ),
    ).toHaveAttribute(
      "title",
      "等待用户输入：请补充品牌名和主色。；可补充文件/图片；已提交：品牌名 Cucumber Lab，主色绿色。；已补充 2 个文件/图片",
    );
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(onPauseRun).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续" })).toHaveAttribute(
      "title",
      "当前 run 仍在运行，等待它停止或完成后再从选中节点继续。",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "查看 run trace" }),
    );
    const tracePanel = screen.getByLabelText("Agent run trace");
    expect(tracePanel).toBeVisible();
    expect(
      within(tracePanel).getByText("等待用户补充 · 等待品牌资料"),
    ).toBeVisible();
    expect(
      within(tracePanel).getByText("画布节点 ask-1 · 上游 1 · 下游 2"),
    ).toHaveAttribute("title", "画布节点 ask-1 · run run-1 · 上游 1 · 下游 2");
  });

  it("calls the real stop handler and surfaces failed-node reason", async () => {
    const user = userEvent.setup();
    const onStopRun = vi.fn();

    render(
      <AgentRunControlBar
        runState={{ activeRunId: "run-2", streaming: true }}
        selectedCanvasElements={[
          selectedAgentElement({
            failure: {
              reason: "HTTP 503 null undefined",
              step: "生成视觉资产 ERR_BAD_REQUEST",
            },
            kind: "tool_call",
            status: "failed",
            title: "generate_image",
          }),
        ]}
        onStopRun={onStopRun}
      />,
    );

    expect(
      screen.getByText(
        "失败原因：外部服务暂时不可用，请稍后重试或改写输入后继续。",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/HTTP 503|ERR_BAD_REQUEST|\bnull\b|\bundefined\b/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(onStopRun).toHaveBeenCalledTimes(1);
  });

  it("shows pausing state while a pause request is in flight", () => {
    render(
      <AgentRunControlBar
        runState={{ activeRunId: "run-2", pausing: true, streaming: true }}
        onPauseRun={vi.fn()}
        onStopRun={vi.fn()}
      />,
    );

    expect(screen.getByText("正在暂停")).toBeVisible();
    expect(screen.getByRole("button", { name: "暂停中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停中" })).toHaveAttribute(
      "title",
      "正在暂停当前 Agent run。",
    );
  });

  it("continues from the selected Agent execution node when no run is streaming", async () => {
    const user = userEvent.setup();
    const onContinueFromSelection = vi.fn();

    render(
      <AgentRunControlBar
        runState={{ streaming: false }}
        selectedCanvasElements={[
          selectedAgentElement({
            kind: "checkpoint",
            status: "done",
            title: "Checkpoint 1",
          }),
        ]}
        onContinueFromSelection={onContinueFromSelection}
      />,
    );

    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(onContinueFromSelection).toHaveBeenCalledWith("ask-1");
  });

  it("makes paused-node continuation explicit before starting a new run draft", async () => {
    const user = userEvent.setup();
    const onContinueFromSelection = vi.fn();

    render(
      <AgentRunControlBar
        runState={{ streaming: false }}
        selectedCanvasElements={[
          selectedAgentElement({
            checkpoint: {
              canRestartFromHere: true,
              restartReason: "用户暂停后补充品牌素材。",
            },
            kind: "checkpoint",
            status: "paused",
            title: "暂停点",
          }),
        ]}
        onContinueFromSelection={onContinueFromSelection}
      />,
    );

    expect(
      screen.getByText(
        "已暂停：从此节点继续会读取当前画布并开启新的 Agent run。",
      ),
    ).toHaveAttribute(
      "title",
      "选中的 Agent 执行节点已暂停。 继续会以该节点为 durable context anchor 打开新的 Agent run，而不是静默恢复旧 SSE 流。 暂停/重启说明：用户暂停后补充品牌素材。",
    );

    await user.click(screen.getByRole("button", { name: "从暂停点继续" }));

    expect(onContinueFromSelection).toHaveBeenCalledWith("ask-1");
  });

  it("reruns from a restartable checkpoint through the selected-node draft path", async () => {
    const user = userEvent.setup();
    const onContinueFromSelection = vi.fn();

    render(
      <AgentRunControlBar
        runState={{ streaming: false }}
        selectedCanvasElements={[
          selectedAgentElement({
            checkpoint: {
              canRestartFromHere: true,
              restartReason: "方向已经收敛。",
            },
            downstreamNodeIds: ["step-after-checkpoint", "final-1"],
            kind: "checkpoint",
            status: "done",
            title: "Checkpoint 1",
          }),
        ]}
        onContinueFromSelection={onContinueFromSelection}
      />,
    );

    expect(
      screen.getByText(
        "Checkpoint 重跑将重建 2 个下游节点：step-after-checkpoint、final-1",
      ),
    ).toHaveAttribute(
      "title",
      "需要重建的下游节点：step-after-checkpoint、final-1",
    );

    await user.click(
      screen.getByRole("button", { name: "从 checkpoint 重跑" }),
    );

    expect(onContinueFromSelection).toHaveBeenCalledWith(
      "ask-1",
      "rerun_checkpoint",
    );
  });

  it("opens a run trace panel from live stream events", async () => {
    const user = userEvent.setup();
    const traceEvents: StreamEvent[] = [
      {
        conversationId: "canvas-1",
        runId: "run-3",
        sessionId: "session-1",
        timestamp: "2026-06-03T10:00:00.000Z",
        type: "run.started",
      },
      {
        runId: "run-3",
        timestamp: "2026-06-03T10:00:01.000Z",
        toolCallId: "tool-1",
        toolName: "create_agent_execution_flow",
        type: "tool.started",
      },
      {
        reason: "用户暂停了执行链。",
        runId: "run-3",
        timestamp: "2026-06-03T10:00:03.000Z",
        type: "run.paused",
      },
      {
        error: {
          code: "run_failed",
          message: "ECONNRESET",
        },
        runId: "run-3",
        timestamp: "2026-06-03T10:00:04.000Z",
        type: "run.failed",
      },
      {
        baseVersion: 4,
        operations: [
          {
            node: {
              id: "node-1",
              type: "frame",
              width: 100,
              height: 80,
              children: [],
            },
            type: "insertNode",
          },
        ],
        runId: "run-3",
        timestamp: "2026-06-03T10:00:02.000Z",
        transactionId: "tx-1",
        type: "canvas.patch",
      },
    ];

    render(
      <AgentRunControlBar
        runState={{ activeRunId: "run-3", streaming: true }}
        traceEvents={traceEvents}
        onStopRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查看 run trace" }));

    expect(screen.getByLabelText("Agent run trace")).toBeVisible();
    expect(screen.getByText("run-3 · 5 个事件")).toBeVisible();
    expect(
      screen.getByText("Tool started · create_agent_execution_flow"),
    ).toBeVisible();
    expect(screen.getByText("tx-1 · 1 operations · node-1")).toBeVisible();
    expect(screen.getByText("用户暂停了执行链。")).toBeVisible();
    expect(screen.getByText("服务连接失败，请检查网络后重试。")).toBeVisible();
    expect(screen.queryByText("ECONNRESET")).not.toBeInTheDocument();
  });
});
