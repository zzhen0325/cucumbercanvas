// @vitest-environment jsdom

import { type PenNode, withAgentExecutionMeta } from "@cucumber/canvas-core";
import type { AgentExecutionContainer } from "@cucumber/canvas-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AgentExecutionFollowUpPill,
  getAgentExecutionFollowUpState,
} from "@/components/canvas/agent-execution-follow-up-pill";
import {
  AgentCheckpointHoverToolbar,
  AgentExecutionHoverCard,
  AgentExecutionStatusBadge,
  getAgentCheckpointToolbarState,
  getAgentExecutionHoverState,
  getAgentExecutionNativeContainerOverlayState,
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

describe("Agent checkpoint selection toolbar", () => {
  it("exposes continuation and rerun actions for restartable checkpoints", () => {
    const checkpointNode = withAgentExecutionMeta(frameNode, {
      checkpoint: {
        canRestartFromHere: true,
        restartReason: "视觉方向已收敛。",
      },
      kind: "checkpoint",
      status: "done",
      title: "Checkpoint 1",
    });

    expect(getAgentCheckpointToolbarState(checkpointNode, true)).toEqual({
      canContinue: true,
      canRerun: true,
      continueReason: "",
      rerunReason: "",
      visible: true,
    });
  });

  it("hides for non-checkpoint nodes and explains missing continuation wiring", () => {
    const taskNode = withAgentExecutionMeta(frameNode, {
      kind: "task_step",
      status: "done",
      title: "生成初稿",
    });
    const checkpointNode = withAgentExecutionMeta(frameNode, {
      checkpoint: {
        canRestartFromHere: false,
      },
      kind: "checkpoint",
      status: "done",
      title: "Progress marker",
    });

    expect(getAgentCheckpointToolbarState(taskNode, true).visible).toBe(false);
    expect(getAgentCheckpointToolbarState(checkpointNode, false)).toEqual({
      canContinue: false,
      canRerun: false,
      continueReason:
        "当前画布没有接入 Agent 输入框，不能从此 checkpoint 继续。",
      rerunReason: "这个 checkpoint 只是进度记录，没有标记为可从此处重跑。",
      visible: true,
    });
  });

  it("routes checkpoint hover actions into continuation intents", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();

    render(
      <AgentCheckpointHoverToolbar
        checkpoint={{
          canContinue: true,
          canRerun: true,
          continueReason: "",
          nodeId: "checkpoint-1",
          rerunReason: "",
          title: "Checkpoint 1",
          visible: true,
          x: 120,
          y: 80,
        }}
        onContinueAgentExecution={onContinueAgentExecution}
      />,
    );

    expect(
      screen.getByLabelText("Checkpoint hover actions: Checkpoint 1"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(screen.getByRole("button", { name: "重跑" }));
    await user.click(screen.getByRole("button", { name: "新分支" }));

    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      1,
      "checkpoint-1",
      "continue",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      2,
      "checkpoint-1",
      "rerun_checkpoint",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      3,
      "checkpoint-1",
      "new_branch",
    );
  });
});

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

  it("renders a hover summary for non-selected Agent execution nodes", () => {
    const toolNode = withAgentExecutionMeta(frameNode, {
      kind: "tool_call",
      status: "running",
      summary: "正在生成首屏视觉主图。",
      title: "generate_image",
      toolName: "generate_image",
    });
    const hoverState = getAgentExecutionHoverState(toolNode, {
      x: 120,
      y: 80,
    });

    expect(hoverState).toMatchObject({
      kindLabel: "工具调用",
      nodeId: "checkpoint-1",
      statusLabel: "运行中",
      toolName: "generate_image",
    });

    render(<AgentExecutionHoverCard execution={hoverState} />);

    expect(
      screen.getByLabelText("Agent 执行节点悬停摘要：工具调用，状态：运行中"),
    ).toBeVisible();
    expect(screen.getAllByText("generate_image")).toHaveLength(2);
    expect(screen.getByText("工具调用")).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
  });

  it("surfaces waiting and failure reasons on hover without opening the panel", () => {
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
    const failedHoverState = getAgentExecutionHoverState(failedNode, {
      x: 120,
      y: 80,
    });

    expect(failedHoverState).toMatchObject({
      statusReason: "外部服务暂时不可用，请稍后重试或改写输入后继续。",
    });
    render(<AgentExecutionHoverCard execution={failedHoverState} />);

    expect(
      screen.getByText(
        "失败原因：外部服务暂时不可用，请稍后重试或改写输入后继续。",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/HTTP 503|\bnull\b|\bundefined\b/),
    ).not.toBeInTheDocument();
  });
});

describe("Agent native execution container overlay", () => {
  const nativeContainer: AgentExecutionContainer = {
    artifactRefs: [],
    containerId: "agent_execution_1",
    kind: "agent_execution",
    schemaVersion: 1,
    status: "running",
    streamParts: [],
    title: "Agent 执行",
    todos: [],
    toolParts: [],
  };

  it("shows only when the selected shell has native container state", () => {
    const nodeWithContainer: PenNode = {
      ...frameNode,
      id: "agent_execution_1",
      meta: {
        agentExecutionContainer: nativeContainer,
      },
    };

    expect(
      getAgentExecutionNativeContainerOverlayState(nodeWithContainer, {
        x: 120,
        y: 220,
      }),
    ).toEqual({
      container: nativeContainer,
      nodeId: "agent_execution_1",
      x: 120,
      y: 220,
    });
  });

  it("does not fall back to legacy agentExecution metadata", () => {
    const legacyNode = withAgentExecutionMeta(frameNode, {
      kind: "agent_execution",
      status: "running",
      summary: "legacy only",
      title: "Legacy Agent",
    });

    expect(
      getAgentExecutionNativeContainerOverlayState(legacyNode, {
        x: 120,
        y: 220,
      }),
    ).toBeNull();
  });
});

describe("Agent execution follow-up pill", () => {
  it("builds contextual follow-up labels from durable Agent execution metadata", () => {
    const failedNode = withAgentExecutionMeta(frameNode, {
      failure: {
        reason: "图片生成服务暂时不可用。",
        step: "生成视觉资产",
      },
      kind: "tool_call",
      status: "failed",
      title: "generate_image",
    });
    const branchNode = withAgentExecutionMeta(
      { ...frameNode, id: "branch-1" },
      {
        kind: "variant_branch",
        status: "done",
        title: "方向 A",
      },
    );

    expect(
      getAgentExecutionFollowUpState(failedNode, { x: 120, y: 220 }, true),
    ).toMatchObject({
      disabled: false,
      label: "修复失败",
      nodeId: "checkpoint-1",
      x: 120,
      y: 220,
    });
    expect(
      getAgentExecutionFollowUpState(branchNode, { x: 140, y: 260 }, true),
    ).toMatchObject({
      label: "继续深化",
      nodeId: "branch-1",
    });
    expect(
      getAgentExecutionFollowUpState(frameNode, { x: 140, y: 260 }, true),
    ).toBeNull();
  });

  it("routes the canvas follow-up pill into the selected-node continuation draft", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const followUp = getAgentExecutionFollowUpState(
      withAgentExecutionMeta(frameNode, {
        kind: "task_step",
        status: "done",
        title: "生成视觉资产",
      }),
      { x: 120, y: 220 },
      true,
    );

    render(
      <AgentExecutionFollowUpPill
        followUp={followUp}
        onContinueAgentExecution={onContinueAgentExecution}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Agent 节点继续追问：生成视觉资产" }),
    );

    expect(onContinueAgentExecution).toHaveBeenCalledWith(
      "checkpoint-1",
      "continue",
    );
  });
});
