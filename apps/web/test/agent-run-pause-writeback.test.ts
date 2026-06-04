import {
  type CucumberCanvasDocument,
  type PenNode,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_PAUSED_SUMMARY,
  AGENT_RUN_STOPPED_SUMMARY,
  getAgentRunPausedNodeUpdates,
  getAgentRunStoppedNodeUpdates,
} from "@/components/canvas/agent-run-pause-writeback";

const frameNode: PenNode = {
  alignItems: "start",
  children: [],
  gap: 8,
  height: 180,
  id: "base-frame",
  justifyContent: "start",
  layout: "vertical",
  padding: 12,
  type: "frame",
  width: 240,
  x: 0,
  y: 0,
};

describe("getAgentRunPausedNodeUpdates", () => {
  it("marks running and waiting nodes for the paused run without touching other execution states", () => {
    const runningNode = withAgentExecutionMeta(
      { ...frameNode, id: "task-running" },
      {
        kind: "task_step",
        runId: "run-1",
        status: "running",
        summary: "正在生成方向 A。",
        title: "生成方向 A",
      },
    );
    const waitingChild = withAgentExecutionMeta(
      { ...frameNode, id: "ask-waiting" },
      {
        kind: "ask_user_more",
        runId: "run-1",
        status: "waiting",
        title: "等待品牌资料",
        waitingForUser: {
          prompt: "请补充品牌图。",
        },
      },
    );
    const doneNode = withAgentExecutionMeta(
      { ...frameNode, id: "done-node" },
      {
        kind: "checkpoint",
        runId: "run-1",
        status: "done",
        title: "已完成检查点",
      },
    );
    const otherRunNode = withAgentExecutionMeta(
      { ...frameNode, id: "other-run" },
      {
        kind: "tool_call",
        runId: "run-2",
        status: "running",
        title: "其他 run 工具",
      },
    );
    const groupNode: PenNode = {
      ...frameNode,
      children: [waitingChild],
      id: "group-1",
      type: "group",
    };
    const document: CucumberCanvasDocument = {
      activePageId: "page-1",
      children: [],
      name: "Pause test",
      pages: [
        {
          children: [runningNode, groupNode, doneNode, otherRunNode],
          id: "page-1",
          name: "Page 1",
        },
      ],
      version: "cucumber-canvas-v1",
    };

    const updates = getAgentRunPausedNodeUpdates(document, "page-1", "run-1");

    expect(updates.map((update) => update.nodeId)).toEqual([
      "task-running",
      "ask-waiting",
    ]);
    const runningMeta = getAgentExecutionMeta({
      meta: updates[0]?.updates.meta,
    });
    const waitingMeta = getAgentExecutionMeta({
      meta: updates[1]?.updates.meta,
    });
    expect(runningMeta?.status).toBe("paused");
    expect(runningMeta?.summary).toBe(
      `正在生成方向 A。\n${AGENT_RUN_PAUSED_SUMMARY}`,
    );
    expect(waitingMeta?.status).toBe("paused");
    expect(waitingMeta?.summary).toBe(AGENT_RUN_PAUSED_SUMMARY);
  });

  it("marks active nodes as paused with a stopped summary when the run is stopped", () => {
    const runningNode = withAgentExecutionMeta(
      { ...frameNode, id: "task-running" },
      {
        kind: "task_step",
        runId: "run-1",
        status: "running",
        summary: "正在调用工具。",
        title: "调用工具",
      },
    );
    const waitingNode = withAgentExecutionMeta(
      { ...frameNode, id: "ask-waiting" },
      {
        kind: "ask_user_more",
        runId: "run-1",
        status: "waiting",
        title: "等待资料",
      },
    );
    const document: CucumberCanvasDocument = {
      activePageId: "page-1",
      children: [],
      name: "Stop test",
      pages: [
        {
          children: [runningNode, waitingNode],
          id: "page-1",
          name: "Page 1",
        },
      ],
      version: "cucumber-canvas-v1",
    };

    const updates = getAgentRunStoppedNodeUpdates(document, "page-1", "run-1");

    expect(updates.map((update) => update.nodeId)).toEqual([
      "task-running",
      "ask-waiting",
    ]);
    const runningMeta = getAgentExecutionMeta({
      meta: updates[0]?.updates.meta,
    });
    const waitingMeta = getAgentExecutionMeta({
      meta: updates[1]?.updates.meta,
    });
    expect(runningMeta?.status).toBe("paused");
    expect(runningMeta?.summary).toBe(
      `正在调用工具。\n${AGENT_RUN_STOPPED_SUMMARY}`,
    );
    expect(waitingMeta?.status).toBe("paused");
    expect(waitingMeta?.summary).toBe(AGENT_RUN_STOPPED_SUMMARY);
  });
});
