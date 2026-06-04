import {
  type PenNode,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
} from "@cucumber/canvas-core";

export const AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY =
  "用户已提交补充，等待 Agent 从该节点继续。";

export type AgentWaitingResponseInput = {
  attachmentCount?: number;
  submittedAt: string;
  text: string;
};

export function getAgentWaitingResponseSubmittedUpdates(
  node: PenNode,
  response: AgentWaitingResponseInput,
): Partial<PenNode> | null {
  const execution = getAgentExecutionMeta(node);
  const responseText = response.text.trim();
  if (!execution?.waitingForUser || !responseText) return null;
  const { schemaVersion: _schemaVersion, ...meta } = execution;
  const attachmentCount =
    response.attachmentCount ??
    execution.waitingForUser.response?.attachmentCount;
  return getAgentExecutionNodeSemanticUpdates(node, {
    ...meta,
    status: "paused",
    summary: withSubmittedSummary(execution.summary),
    waitingForUser: {
      ...execution.waitingForUser,
      response: {
        text: responseText,
        submittedAt: response.submittedAt,
        ...(attachmentCount && attachmentCount > 0 ? { attachmentCount } : {}),
      },
    },
  });
}

function withSubmittedSummary(summary: string | undefined): string {
  const normalized = summary?.trim();
  if (!normalized) return AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY;
  if (normalized.includes(AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY)) {
    return normalized;
  }
  return `${normalized}\n${AGENT_WAITING_RESPONSE_SUBMITTED_SUMMARY}`;
}
