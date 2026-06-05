import type { AgentBinding, ContainerRole, PenNode } from "@cucumber/pen-types";

export const AGENT_EXECUTION_META_KEY = "agentExecution";
export const AGENT_EXECUTION_SCHEMA_VERSION = 1;

export type AgentExecutionNodeKind =
  | "input_node"
  | "user_goal"
  | "agent_execution"
  | "recipe_plan"
  | "task_step"
  | "tool_call"
  | "evidence"
  | "variant_branch"
  | "comparison"
  | "critique"
  | "ask_user_more"
  | "checkpoint"
  | "final_deliverable";

export type AgentExecutionStatus =
  | "waiting"
  | "running"
  | "done"
  | "failed"
  | "paused";

export interface AgentExecutionNodeMeta {
  schemaVersion: typeof AGENT_EXECUTION_SCHEMA_VERSION;
  kind: AgentExecutionNodeKind;
  status: AgentExecutionStatus;
  title: string;
  summary?: string;
  runId?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  details?: {
    inputSummary?: string;
    outputSummary?: string;
    reasoningSummary?: string;
    errorReason?: string;
  };
  streamEntries?: AgentExecutionStreamEntry[];
  artifactNodeIds?: string[];
  evidence?: {
    sourceType: "url" | "asset" | "canvas_node" | "text" | "search_result";
    url?: string;
    assetId?: string;
    sourceNodeId?: string;
    sourceLabel?: string;
    confidence?: number;
  };
  critique?: {
    findings: Array<{
      severity: "info" | "warning" | "error";
      code?: string;
      nodeId?: string;
      reason: string;
      suggestedFix?: string;
    }>;
    issueCounts?: {
      info: number;
      warning: number;
      error: number;
    };
    pass: boolean;
  };
  upstreamNodeIds?: string[];
  downstreamNodeIds?: string[];
  branchId?: string;
  branchLabel?: string;
  branch?: {
    strengths?: string[];
    risks?: string[];
    useCases?: string[];
    planSummary?: string;
    deliverableSummary?: string;
    critiqueSummary?: string;
    isRecommended?: boolean;
    isMainline?: boolean;
  };
  comparison?: {
    branchNodeIds: string[];
    recommendedBranchId?: string;
    recommendationReason?: string;
  };
  checkpoint?: {
    canRestartFromHere: boolean;
    restartReason?: string;
  };
  waitingForUser?: {
    prompt: string;
    acceptsFiles?: boolean;
    response?: {
      text: string;
      submittedAt: string;
      attachmentCount?: number;
    };
  };
  failure?: {
    step: string;
    reason: string;
    attempted?: string[];
    nextActions?: string[];
  };
  canvasPresentation?: {
    layoutVersion: 2;
    collapsed: boolean;
  };
}

export type AgentExecutionStreamEntryStatus =
  | "running"
  | "done"
  | "failed"
  | "paused";

export interface AgentExecutionStreamEntry {
  id: string;
  type: "stage" | "thinking" | "message" | "tool" | "artifact";
  label: string;
  status: AgentExecutionStreamEntryStatus;
  content?: string;
  toolName?: string;
  timestamp: string;
}

export interface AgentExecutionNodeSemanticOptions {
  agentBindingRole?: AgentBinding["role"];
  agentBindingStatus?: AgentBinding["status"];
  containerRole?: ContainerRole[];
}

const AGENT_EXECUTION_KIND_LABELS: Record<AgentExecutionNodeKind, string> = {
  ask_user_more: "等待用户补充",
  checkpoint: "检查点",
  comparison: "方案对比",
  critique: "评审",
  evidence: "证据",
  final_deliverable: "最终交付物",
  agent_execution: "Agent 执行",
  input_node: "InputNode",
  recipe_plan: "Recipe 计划",
  task_step: "任务步骤",
  tool_call: "工具调用",
  user_goal: "用户目标",
  variant_branch: "方案分支",
};

const AGENT_EXECUTION_STATUS_LABELS: Record<AgentExecutionStatus, string> = {
  done: "已完成",
  failed: "失败",
  paused: "已暂停",
  running: "运行中",
  waiting: "等待中",
};

export function getAgentExecutionKindLabel(
  kind: AgentExecutionNodeKind,
): string {
  return AGENT_EXECUTION_KIND_LABELS[kind];
}

export function getAgentExecutionStatusLabel(
  status: AgentExecutionStatus,
): string {
  return AGENT_EXECUTION_STATUS_LABELS[status];
}

export function getAgentExecutionMeta(
  node: Pick<PenNode, "meta"> | null | undefined,
): AgentExecutionNodeMeta | undefined {
  const value = node?.meta?.[AGENT_EXECUTION_META_KEY];
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== AGENT_EXECUTION_SCHEMA_VERSION) {
    return undefined;
  }
  if (!isAgentExecutionNodeKind(value.kind)) return undefined;
  if (!isAgentExecutionStatus(value.status)) return undefined;
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return undefined;
  }
  return value as unknown as AgentExecutionNodeMeta;
}

export function withAgentExecutionMeta<T extends PenNode>(
  node: T,
  meta: Omit<AgentExecutionNodeMeta, "schemaVersion">,
): T {
  return {
    ...node,
    meta: {
      ...(node.meta ?? {}),
      [AGENT_EXECUTION_META_KEY]: {
        ...meta,
        schemaVersion: AGENT_EXECUTION_SCHEMA_VERSION,
      },
    },
  };
}

export function withAgentExecutionNodeSemantics<T extends PenNode>(
  node: T,
  meta: Omit<AgentExecutionNodeMeta, "schemaVersion">,
  options: AgentExecutionNodeSemanticOptions = {},
): T {
  const executionNode = withAgentExecutionMeta(node, meta);
  const containerRole = resolveExecutionContainerRole(
    executionNode.containerRole,
    options.containerRole,
    meta.kind,
  );
  return {
    ...executionNode,
    ...(meta.agentId
      ? {
          agentBinding: {
            ...(executionNode.agentBinding ?? {}),
            agentId: meta.agentId,
            name: executionNode.agentBinding?.name ?? meta.title,
            permissions: executionNode.agentBinding?.permissions ?? [
              "read",
              "write",
            ],
            role:
              executionNode.agentBinding?.role ??
              options.agentBindingRole ??
              "assistant",
            status:
              options.agentBindingStatus ??
              executionNode.agentBinding?.status ??
              agentBindingStatusForExecutionStatus(meta.status),
            ...(meta.toolName ? { toolName: meta.toolName } : {}),
          },
          createdByAgentId: executionNode.createdByAgentId ?? meta.agentId,
        }
      : {}),
    ...(meta.runId ? { runId: meta.runId } : {}),
    ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
    containerRole,
    contextSlots: {
      ...(executionNode.contextSlots ?? {}),
      rules: Array.from(
        new Set([
          ...(executionNode.contextSlots?.rules ?? []),
          `agent execution node: ${meta.kind}`,
        ]),
      ),
    },
  };
}

export function getAgentExecutionNodeSemanticUpdates(
  node: PenNode,
  meta: Omit<AgentExecutionNodeMeta, "schemaVersion">,
  options: AgentExecutionNodeSemanticOptions = {},
): Partial<PenNode> {
  const nextNode = withAgentExecutionNodeSemantics(node, meta, options);
  return {
    agentBinding: nextNode.agentBinding,
    containerRole: nextNode.containerRole,
    contextSlots: nextNode.contextSlots,
    createdByAgentId: nextNode.createdByAgentId,
    meta: nextNode.meta,
    runId: nextNode.runId,
    sessionId: nextNode.sessionId,
  } as Partial<PenNode>;
}

export function getAgentBindingStatusForExecutionStatus(
  status: AgentExecutionStatus,
): NonNullable<AgentBinding["status"]> {
  return agentBindingStatusForExecutionStatus(status);
}

function resolveExecutionContainerRole(
  current: ContainerRole[] | undefined,
  requested: ContainerRole[] | undefined,
  kind: AgentExecutionNodeKind,
): ContainerRole[] {
  if (current?.length) return current;
  if (requested?.length) return requested;
  return defaultContainerRoleForExecutionKind(kind);
}

function agentBindingStatusForExecutionStatus(
  status: AgentExecutionStatus,
): NonNullable<AgentBinding["status"]> {
  switch (status) {
    case "done":
      return "completed";
    case "failed":
      return "error";
    case "paused":
      return "blocked";
    case "running":
      return "running";
    case "waiting":
      return "idle";
  }
}

function defaultContainerRoleForExecutionKind(
  kind: AgentExecutionNodeKind,
): ContainerRole[] {
  switch (kind) {
    case "agent_execution":
    case "evidence":
    case "input_node":
    case "user_goal":
      return ["context"];
    case "final_deliverable":
      return ["visual"];
    case "tool_call":
      return ["dataflow", "task"];
    case "comparison":
    case "recipe_plan":
    case "variant_branch":
      return ["task", "context"];
    case "ask_user_more":
    case "checkpoint":
    case "critique":
    case "task_step":
      return ["task"];
  }
}

function isAgentExecutionNodeKind(
  value: unknown,
): value is AgentExecutionNodeKind {
  return (
    value === "input_node" ||
    value === "user_goal" ||
    value === "agent_execution" ||
    value === "recipe_plan" ||
    value === "task_step" ||
    value === "tool_call" ||
    value === "evidence" ||
    value === "variant_branch" ||
    value === "comparison" ||
    value === "critique" ||
    value === "ask_user_more" ||
    value === "checkpoint" ||
    value === "final_deliverable"
  );
}

function isAgentExecutionStatus(value: unknown): value is AgentExecutionStatus {
  return (
    value === "waiting" ||
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "paused"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
