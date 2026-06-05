// @vitest-environment jsdom

import { type PenNode, withAgentExecutionMeta } from "@cucumber/canvas-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AgentExecutionStatusBadge,
  getAgentExecutionStatusBadgeState,
  getAgentExecutionStatusReason,
} from "@/components/canvas/canvas-overlays";

const frameNode: PenNode = {
  alignItems: "start",
  children: [],
  gap: 8,
  height: 180,
  id: "checkpoint-1",
  justifyContent: "start",
  layout: "vertical",
  padding: 12,
  type: "frame",
  width: 240,
  x: 0,
  y: 0,
};

describe("Agent execution status badge", () => {
  it("builds a readable badge state for selected Agent execution nodes", () => {
    const taskNode = withAgentExecutionMeta(frameNode, {
      kind: "task_step",
      status: "running",
      title: "生成视觉资产",
    });

    expect(getAgentExecutionStatusBadgeState(taskNode)).toEqual({
      kindLabel: "任务步骤",
      statusLabel: "运行中",
      title: "生成视觉资产",
      tone: "running",
    });
    expect(getAgentExecutionStatusBadgeState(frameNode)).toBeNull();
  });

  it("renders kind and status without requiring the property panel", () => {
    const taskNode = withAgentExecutionMeta(frameNode, {
      kind: "task_step",
      status: "failed",
      title: "生成视觉资产",
    });

    render(
      <AgentExecutionStatusBadge
        badge={getAgentExecutionStatusBadgeState(taskNode)}
      />,
    );

    expect(
      screen.getByLabelText("Agent 执行节点：任务步骤，状态：失败"),
    ).toBeVisible();
    expect(screen.getByText("任务步骤")).toBeVisible();
    expect(screen.getByText("失败")).toBeVisible();
  });

  it("sanitizes waiting and failure reasons for Agent execution status copy", () => {
    const waitingNode = withAgentExecutionMeta(frameNode, {
      kind: "ask_user_more",
      status: "waiting",
      title: "补充品牌素材",
      waitingForUser: {
        prompt: "需要上传品牌 logo 和主色参考。",
      },
    });
    const failedNode = withAgentExecutionMeta(
      { ...frameNode, id: "failed-1" },
      {
        failure: {
          reason: "HTTP 503 null undefined",
          step: "generate_image",
        },
        kind: "tool_call",
        status: "failed",
        title: "generate_image",
      },
    );

    expect(getAgentExecutionStatusReason(waitingNode)).toBe(
      "需要上传品牌 logo 和主色参考。",
    );
    expect(getAgentExecutionStatusReason(failedNode)).toBe(
      "外部服务暂时不可用，请稍后重试或改写输入后继续。",
    );
  });
});
