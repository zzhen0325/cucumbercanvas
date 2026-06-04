import {
  type CucumberCanvasDocument,
  type PenNode,
  getActiveChildren,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
} from "@cucumber/canvas-core";

export const AGENT_RUN_PAUSED_SUMMARY =
  "用户已暂停当前 Agent run，可从此节点继续。";
export const AGENT_RUN_STOPPED_SUMMARY =
  "用户已停止当前 Agent run，可从此节点继续或新建分支。";

export type AgentRunPausedNodeUpdate = {
  nodeId: string;
  updates: Partial<PenNode>;
};

export function getAgentRunPausedNodeUpdates(
  document: CucumberCanvasDocument,
  activePageId: string | null | undefined,
  runId: string,
): AgentRunPausedNodeUpdate[] {
  return getAgentRunInterruptedNodeUpdates(
    document,
    activePageId,
    runId,
    AGENT_RUN_PAUSED_SUMMARY,
  );
}

export function getAgentRunStoppedNodeUpdates(
  document: CucumberCanvasDocument,
  activePageId: string | null | undefined,
  runId: string,
): AgentRunPausedNodeUpdate[] {
  return getAgentRunInterruptedNodeUpdates(
    document,
    activePageId,
    runId,
    AGENT_RUN_STOPPED_SUMMARY,
  );
}

function getAgentRunInterruptedNodeUpdates(
  document: CucumberCanvasDocument,
  activePageId: string | null | undefined,
  runId: string,
  interruptSummary: string,
): AgentRunPausedNodeUpdate[] {
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) return [];
  const updates: AgentRunPausedNodeUpdate[] = [];
  for (const node of flattenNodes(getActiveChildren(document, activePageId))) {
    const execution = getAgentExecutionMeta(node);
    if (!execution || execution.runId !== trimmedRunId) continue;
    if (execution.status !== "running" && execution.status !== "waiting") {
      continue;
    }
    const { schemaVersion: _schemaVersion, ...meta } = execution;
    updates.push({
      nodeId: node.id,
      updates: getAgentExecutionNodeSemanticUpdates(node, {
        ...meta,
        status: "paused",
        summary: withInterruptSummary(execution.summary, interruptSummary),
      }),
    });
  }
  return updates;
}

function flattenNodes(nodes: PenNode[]): PenNode[] {
  const flattened: PenNode[] = [];
  for (const node of nodes) {
    flattened.push(node);
    if ("children" in node && Array.isArray(node.children)) {
      flattened.push(...flattenNodes(node.children as PenNode[]));
    }
  }
  return flattened;
}

function withInterruptSummary(
  summary: string | undefined,
  interruptSummary: string,
): string {
  const normalized = summary?.trim();
  if (!normalized) return interruptSummary;
  if (normalized.includes(interruptSummary)) return normalized;
  return `${normalized}\n${interruptSummary}`;
}
