import {
  type AgentExecutionNodeKind,
  type AgentExecutionNodeMeta,
  type AgentExecutionStatus,
  type CanvasBounds,
  getAgentExecutionCanvasConnectorStroke,
  getAgentExecutionCanvasFrameUpdates,
  withAgentExecutionCanvasPresentation,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";

export const AGENT_EXECUTION_CARD_CORNER_RADIUS = 18;
export const AGENT_EXECUTION_CARD_STROKE_THICKNESS = 1;
export const AGENT_EXECUTION_CONNECTOR_THICKNESS = 1;

export function agentExecutionCardFillForKind(
  kind: AgentExecutionNodeKind,
): string {
  switch (kind) {
    case "agent_execution":
      return "rgba(248,255,191,1)";
    case "ask_user_more":
    case "user_goal":
      return "rgba(255,247,214,0.94)";
    case "checkpoint":
      return "rgba(232,249,238,0.92)";
    case "comparison":
      return "rgba(255,255,255,0.96)";
    case "critique":
      return "rgba(255,241,241,0.92)";
    case "evidence":
      return "rgba(232,246,255,0.92)";
    case "final_deliverable":
      return "rgba(255,255,255,0.96)";
    case "recipe_plan":
      return "rgba(239,235,255,0.92)";
    case "variant_branch":
      return "rgba(245,248,255,0.94)";
    case "task_step":
    case "tool_call":
      return "rgba(239,246,255,0.9)";
  }
}

export function agentExecutionCardStrokeForStatus(
  status: AgentExecutionStatus,
): string {
  switch (status) {
    case "done":
      return "rgba(22,163,74,0.54)";
    case "failed":
      return "rgba(220,38,38,0.58)";
    case "paused":
      return "rgba(217,119,6,0.55)";
    case "running":
      return "rgba(79,70,229,0.6)";
    case "waiting":
      return "rgba(15,23,42,0.16)";
  }
}

export function agentExecutionConnectorStroke(
  tone: "accent" | "warning" = "accent",
): LineNode["stroke"] {
  return getAgentExecutionCanvasConnectorStroke(tone);
}

export function applyAgentExecutionCardVisualStyle(
  node: Omit<FrameNode, "cornerRadius" | "fill" | "stroke">,
  input: {
    kind: AgentExecutionNodeKind;
    status: AgentExecutionStatus;
    collapsed?: boolean;
    body?: string;
    title?: string;
    toolName?: string;
  },
): FrameNode {
  const execution = withAgentExecutionCanvasPresentation(
    {
      kind: input.kind,
      schemaVersion: 1,
      status: input.status,
      title: input.title ?? node.name ?? input.kind,
      ...(input.toolName ? { toolName: input.toolName } : {}),
      summary: input.body,
    } satisfies AgentExecutionNodeMeta,
    { collapsed: input.collapsed ?? true },
  );
  return {
    ...node,
    ...getAgentExecutionCanvasFrameUpdates({
      body: input.body,
      bounds: {
        width: numericDimension(node.width),
        height: numericDimension(node.height),
      },
      collapsed: input.collapsed ?? true,
      execution,
    }),
  } as FrameNode;
}

function numericDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
