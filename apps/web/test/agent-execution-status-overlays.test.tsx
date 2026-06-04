// @vitest-environment jsdom

import {
  type CucumberCanvasDocument,
  type PenNode,
  withAgentExecutionMeta,
} from "@cucumber/canvas-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AgentExecutionStatusMarker,
  AgentExecutionStatusSummaryStrip,
  getAgentExecutionStatusActivityLabel,
  getAgentExecutionStatusLayerItems,
  getAgentExecutionStatusMarkerState,
  getAgentExecutionStatusSummaryState,
} from "@/components/canvas/agent-execution-status-overlays";

const baseNode: PenNode = {
  alignItems: "start",
  children: [],
  gap: 8,
  height: 120,
  id: "agent-step-1",
  justifyContent: "start",
  layout: "vertical",
  padding: 12,
  type: "frame",
  width: 200,
  x: 40,
  y: 24,
};

function createDocument(nodes: PenNode[]): CucumberCanvasDocument {
  return {
    activePageId: "page-1",
    assets: {},
    children: [],
    pages: [
      {
        children: nodes,
        id: "page-1",
        name: "Main",
      },
    ],
    version: "1.0",
  };
}

describe("Agent execution status overlays", () => {
  it("creates a positioned marker for active non-selected execution nodes", () => {
    const node = withAgentExecutionMeta(baseNode, {
      failure: {
        reason: "生成服务超时，请缩小范围后重试。",
        step: "generate_image",
      },
      kind: "task_step",
      status: "failed",
      title: "生成首屏视觉",
    });
    const document = createDocument([node]);

    expect(
      getAgentExecutionStatusMarkerState(node, {
        activePageId: "page-1",
        document,
        selection: [],
        viewport: { x: 10, y: 20, zoom: 2 },
      }),
    ).toMatchObject({
      activityLabel: "处理失败",
      kindLabel: "任务步骤",
      nodeId: "agent-step-1",
      statusLabel: "失败",
      statusReason: "生成服务超时，请缩小范围后重试。",
      tone: "failed",
      x: 490,
      y: 68,
    });
  });

  it("keeps done and selected execution nodes out of the persistent layer", () => {
    const doneNode = withAgentExecutionMeta(baseNode, {
      kind: "task_step",
      status: "done",
      title: "已完成的步骤",
    });
    const selectedNode = withAgentExecutionMeta(
      { ...baseNode, id: "agent-step-2" },
      {
        kind: "task_step",
        status: "failed",
        title: "失败但已选中的步骤",
      },
    );
    const document = createDocument([doneNode, selectedNode]);

    expect(
      getAgentExecutionStatusMarkerState(doneNode, {
        activePageId: "page-1",
        document,
        selection: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeNull();
    expect(
      getAgentExecutionStatusLayerItems({
        activePageId: "page-1",
        document,
        selection: ["agent-step-2"],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toHaveLength(0);
  });

  it("renders the marker as a compact selectable status-only chip", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <AgentExecutionStatusMarker
        marker={{
          kindLabel: "工具调用",
          activityLabel: "处理失败",
          nodeId: "tool-call-1",
          statusLabel: "失败",
          title: "generate_image",
          tone: "failed",
          x: 120,
          y: 80,
        }}
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByLabelText("选择 Agent 执行节点：工具调用，状态：失败"),
    ).toBeVisible();
    expect(screen.getByText("处理失败")).toBeVisible();
    await user.click(
      screen.getByLabelText("选择 Agent 执行节点：工具调用，状态：失败"),
    );
    expect(onSelect).toHaveBeenCalledWith("tool-call-1");
  });

  it("shows a streaming text cue for running markers only", () => {
    const { container, rerender } = render(
      <AgentExecutionStatusMarker
        marker={{
          kindLabel: "工具调用",
          activityLabel: "生成中...",
          nodeId: "tool-call-running",
          statusLabel: "运行中",
          title: "generate_image",
          tone: "running",
          x: 120,
          y: 80,
        }}
      />,
    );

    expect(
      container.querySelector(
        '[data-canvas-overlay="agent-execution-streaming-text"]',
      ),
    ).not.toBeNull();

    rerender(
      <AgentExecutionStatusMarker
        marker={{
          kindLabel: "工具调用",
          activityLabel: "处理失败",
          nodeId: "tool-call-failed",
          statusLabel: "失败",
          title: "generate_image",
          tone: "failed",
          x: 120,
          y: 80,
        }}
      />,
    );

    expect(
      container.querySelector(
        '[data-canvas-overlay="agent-execution-streaming-text"]',
      ),
    ).toBeNull();
  });

  it("summarizes attention states across the active page", () => {
    const runningNode = withAgentExecutionMeta(baseNode, {
      kind: "task_step",
      status: "running",
      title: "正在生成",
    });
    const failedNode = withAgentExecutionMeta(
      { ...baseNode, id: "agent-step-2" },
      {
        kind: "tool_call",
        status: "failed",
        title: "生成失败",
      },
    );
    const doneNode = withAgentExecutionMeta(
      { ...baseNode, id: "agent-step-3" },
      {
        kind: "final_deliverable",
        status: "done",
        title: "已完成",
      },
    );
    const document = createDocument([runningNode, failedNode, doneNode]);

    expect(getAgentExecutionStatusSummaryState(document, "page-1")).toEqual({
      failed: 1,
      firstFailedNodeId: "agent-step-2",
      firstRunningNodeId: "agent-step-1",
      paused: 0,
      running: 1,
      totalAttention: 2,
      waiting: 0,
    });
  });

  it("renders only non-zero status summary chips as selectable entries", async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();

    render(
      <AgentExecutionStatusSummaryStrip
        onSelectNode={onSelectNode}
        summary={{
          failed: 1,
          firstFailedNodeId: "failed-1",
          firstRunningNodeId: "running-1",
          paused: 0,
          running: 2,
          totalAttention: 3,
          waiting: 0,
        }}
      />,
    );

    expect(
      screen.getByLabelText(
        "当前页 Agent 执行状态：失败 1，运行中 2，等待 0，已暂停 0",
      ),
    ).toBeVisible();
    expect(screen.getByText("失败")).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
    expect(screen.queryByText("等待")).toBeNull();

    await user.click(
      screen.getByLabelText("选择第一个失败 Agent 执行节点，共 1 个"),
    );
    await user.click(
      screen.getByLabelText("选择第一个运行中 Agent 执行节点，共 2 个"),
    );
    expect(onSelectNode).toHaveBeenNthCalledWith(1, "failed-1");
    expect(onSelectNode).toHaveBeenNthCalledWith(2, "running-1");
  });

  it("derives Flowith-style activity labels from durable execution metadata", () => {
    expect(
      getAgentExecutionStatusActivityLabel({
        kind: "critique",
        schemaVersion: 1,
        status: "running",
        title: "评审当前方案",
      }),
    ).toBe("评审中...");
    expect(
      getAgentExecutionStatusActivityLabel({
        kind: "tool_call",
        schemaVersion: 1,
        status: "running",
        title: "generate_image",
        toolName: "generate_image",
      }),
    ).toBe("生成中...");
    expect(
      getAgentExecutionStatusActivityLabel({
        kind: "ask_user_more",
        schemaVersion: 1,
        status: "waiting",
        title: "补充品牌资料",
      }),
    ).toBe("等待补充");
  });
});
