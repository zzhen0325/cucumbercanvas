import {
  type AgentExecutionNodeKind,
  type AgentExecutionStatus,
  type CanvasBounds,
  createNodeId,
  getAgentExecutionKindLabel,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";

export const AGENT_EXECUTION_CARD_CORNER_RADIUS = 22;
export const AGENT_EXECUTION_CARD_STROKE_THICKNESS = 1.5;
export const AGENT_EXECUTION_CONNECTOR_THICKNESS = 2;

const CARD_PADDING_X = 26;
const CARD_PADDING_TOP = 22;
const TITLE_HEIGHT = 24;
const META_HEIGHT = 18;
const META_TOP = CARD_PADDING_TOP + TITLE_HEIGHT + 6;
const BODY_TOP = META_TOP + META_HEIGHT + 12;
const BODY_BOTTOM_PADDING = 24;

export function createAgentExecutionCardChildren(input: {
  body: string;
  bounds: Pick<CanvasBounds, "height" | "width">;
  kind: AgentExecutionNodeKind;
  status: AgentExecutionStatus;
  title: string;
  toolName?: string;
}): PenNode[] {
  const contentWidth = Math.max(120, input.bounds.width - CARD_PADDING_X * 2);
  const bodyHeight = Math.max(
    64,
    input.bounds.height - BODY_TOP - BODY_BOTTOM_PADDING,
  );
  const metaText = [
    getAgentExecutionKindLabel(input.kind),
    getAgentExecutionStatusLabel(input.status),
    input.toolName ? `工具 ${input.toolName}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    {
      content: input.title,
      fill: [{ color: "rgba(15,23,42,0.92)", type: "solid" }],
      fontSize: 18,
      fontWeight: 650,
      height: TITLE_HEIGHT,
      id: createNodeId(`agent_${input.kind}_title`),
      lineHeight: 1.18,
      name: `${input.title} 标题`,
      textGrowth: "fixed-width-height",
      type: "text",
      width: contentWidth,
      x: CARD_PADDING_X,
      y: CARD_PADDING_TOP,
    },
    {
      content: metaText,
      fill: [{ color: "rgba(15,23,42,0.48)", type: "solid" }],
      fontSize: 11,
      fontWeight: 500,
      height: META_HEIGHT,
      id: createNodeId(`agent_${input.kind}_meta`),
      lineHeight: 1.25,
      name: `${input.title} 状态`,
      textGrowth: "fixed-width-height",
      type: "text",
      width: contentWidth,
      x: CARD_PADDING_X,
      y: META_TOP,
    },
    {
      content: input.body,
      fill: [{ color: "rgba(15,23,42,0.72)", type: "solid" }],
      fontSize: 14,
      fontWeight: 400,
      height: bodyHeight,
      id: createNodeId(`agent_${input.kind}_body`),
      lineHeight: 1.48,
      name: `${input.title} 内容`,
      textGrowth: "fixed-width-height",
      type: "text",
      width: contentWidth,
      x: CARD_PADDING_X,
      y: BODY_TOP,
    },
  ];
}

export function agentExecutionCardFillForKind(
  kind: AgentExecutionNodeKind,
): string {
  switch (kind) {
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
  return {
    cap: "round",
    endTip: "line-arrow",
    fill: [
      {
        color:
          tone === "warning" ? "rgba(217,119,6,0.56)" : "rgba(79,70,229,0.52)",
        type: "solid",
      },
    ],
    thickness: AGENT_EXECUTION_CONNECTOR_THICKNESS,
  };
}

export function applyAgentExecutionCardVisualStyle(
  node: Omit<FrameNode, "cornerRadius" | "fill" | "stroke">,
  input: {
    kind: AgentExecutionNodeKind;
    status: AgentExecutionStatus;
  },
): FrameNode {
  return {
    ...node,
    cornerRadius: AGENT_EXECUTION_CARD_CORNER_RADIUS,
    fill: [{ color: agentExecutionCardFillForKind(input.kind), type: "solid" }],
    stroke: {
      fill: [
        {
          color: agentExecutionCardStrokeForStatus(input.status),
          type: "solid",
        },
      ],
      thickness: AGENT_EXECUTION_CARD_STROKE_THICKNESS,
    },
  } as FrameNode;
}
