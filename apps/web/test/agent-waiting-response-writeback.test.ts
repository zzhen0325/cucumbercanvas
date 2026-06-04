import {
  type PenNode,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
  AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY,
  getAgentWaitingResponseSubmittedUpdates,
} from "@/components/canvas/agent-waiting-response-writeback";

const frameNode: PenNode = {
  alignItems: "start",
  children: [],
  gap: 8,
  height: 180,
  id: "ask-1",
  justifyContent: "start",
  layout: "vertical",
  padding: 12,
  type: "frame",
  width: 240,
  x: 0,
  y: 0,
};

describe("getAgentWaitingResponseSubmittedUpdates", () => {
  it("marks a fulfilled ask-user-more node as paused while preserving response details", () => {
    const askNode = withAgentExecutionMeta(frameNode, {
      agentId: "agent-1",
      kind: "ask_user_more",
      runId: "run-1",
      status: "waiting",
      summary: "等待用户补充品牌资料。",
      title: "等待品牌资料",
      waitingForUser: {
        acceptsFiles: true,
        prompt: "请补充品牌图。",
      },
    });

    const updates = getAgentWaitingResponseSubmittedUpdates(askNode, {
      attachmentCount: 2,
      submittedAt: "2026-06-04T00:00:00.000Z",
      text: " 已补充两张品牌图。 ",
    });

    const execution = getAgentExecutionMeta({ meta: updates?.meta });
    expect(execution).toMatchObject({
      kind: "ask_user_more",
      status: "paused",
      summary: `等待用户补充品牌资料。\n${AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY}`,
      waitingForUser: {
        response: {
          attachmentCount: 2,
          submittedAt: "2026-06-04T00:00:00.000Z",
          text: "已补充两张品牌图。",
        },
      },
    });
    expect(updates?.agentBinding).toMatchObject({
      agentId: "agent-1",
      status: "blocked",
    });
  });
});
