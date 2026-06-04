import type {
  FrameNode,
  LineNode,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";

import {
  AGENT_EXECUTION_META_KEY,
  type AgentExecutionNodeKind,
  type AgentExecutionNodeMeta,
  type AgentExecutionStatus,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
} from "./agent-execution.js";
import { createNodeId } from "./document.js";
import type { CanvasBounds } from "./types.js";

export const AGENT_EXECUTION_CANVAS_LAYOUT_VERSION = 2;

export const AGENT_EXECUTION_USER_CARD_SIZE = {
  width: 240,
  height: 84,
} as const;

export const AGENT_EXECUTION_BAR_SIZE = {
  width: 240,
  collapsedHeight: 36,
  expandedHeight: 148,
} as const;

export const AGENT_EXECUTION_RESULT_CARD_SIZE = {
  width: 240,
  height: 240,
} as const;

export const AGENT_EXECUTION_BRANCH_GAP = 17;
export const AGENT_EXECUTION_VERTICAL_GAP = 40;
export const AGENT_EXECUTION_CHEVRON_HOT_ZONE_WIDTH = 32;

const CARD_RADIUS = 18;
const BAR_RADIUS = 18;
const CARD_STROKE = "rgba(15,23,42,0.08)";
const CONNECTOR_STROKE = "rgba(15,23,42,0.12)";
const TEXT_PRIMARY = "rgba(15,23,42,0.92)";
const TEXT_SECONDARY = "rgba(15,23,42,0.58)";
const EXECUTION_GREEN = "rgba(41,191,78,1)";
const EXECUTION_GREEN_SOFT = "rgba(248,255,191,1)";

type AgentExecutionCanvasCardRole = "user_input" | "execution" | "result";

export function getAgentExecutionCanvasRole(
  kind: AgentExecutionNodeKind,
): AgentExecutionCanvasCardRole {
  if (kind === "user_goal") return "user_input";
  if (
    kind === "comparison" ||
    kind === "final_deliverable" ||
    kind === "variant_branch"
  ) {
    return "result";
  }
  return "execution";
}

export function getAgentExecutionCanvasSize(input: {
  kind: AgentExecutionNodeKind;
  collapsed?: boolean;
}): { width: number; height: number } {
  const role = getAgentExecutionCanvasRole(input.kind);
  if (role === "user_input") return AGENT_EXECUTION_USER_CARD_SIZE;
  if (role === "result") return AGENT_EXECUTION_RESULT_CARD_SIZE;
  return {
    width: AGENT_EXECUTION_BAR_SIZE.width,
    height: input.collapsed
      ? AGENT_EXECUTION_BAR_SIZE.collapsedHeight
      : AGENT_EXECUTION_BAR_SIZE.expandedHeight,
  };
}

export function isAgentExecutionCanvasPresentationV2(
  execution: Pick<AgentExecutionNodeMeta, "canvasPresentation"> | undefined,
): boolean {
  return (
    execution?.canvasPresentation?.layoutVersion ===
    AGENT_EXECUTION_CANVAS_LAYOUT_VERSION
  );
}

export function getAgentExecutionCanvasCollapsed(
  execution: Pick<AgentExecutionNodeMeta, "canvasPresentation"> | undefined,
): boolean {
  if (!isAgentExecutionCanvasPresentationV2(execution)) return true;
  return execution?.canvasPresentation?.collapsed !== false;
}

export function withAgentExecutionCanvasPresentation(
  execution: AgentExecutionNodeMeta,
  input: { collapsed?: boolean } = {},
): AgentExecutionNodeMeta {
  return {
    ...execution,
    canvasPresentation: {
      layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      collapsed: input.collapsed ?? getAgentExecutionCanvasCollapsed(execution),
    },
  };
}

export function setAgentExecutionCanvasCollapsed<T extends PenNode>(
  node: T,
  collapsed: boolean,
): T {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return node;
  return {
    ...node,
    meta: {
      ...(node.meta ?? {}),
      [AGENT_EXECUTION_META_KEY]: withAgentExecutionCanvasPresentation(
        execution,
        { collapsed },
      ),
    },
  };
}

export function toggleAgentExecutionCanvasCollapsed<T extends PenNode>(
  node: T,
): T {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return node;
  return setAgentExecutionCanvasCollapsed(
    node,
    !getAgentExecutionCanvasCollapsed(execution),
  );
}

export function formatAgentExecutionCanvasBody(
  execution: AgentExecutionNodeMeta,
): string {
  const lines = [
    execution.details?.inputSummary
      ? `输入：${execution.details.inputSummary}`
      : undefined,
    execution.details?.reasoningSummary
      ? `思考：${execution.details.reasoningSummary}`
      : undefined,
    execution.details?.outputSummary
      ? `输出：${execution.details.outputSummary}`
      : undefined,
    execution.failure?.reason
      ? `失败原因：${execution.failure.reason}`
      : undefined,
    execution.summary,
  ].filter(isUsefulText);
  return lines[0] ?? readableFallbackForExecution(execution);
}

export function getAgentExecutionCanvasFrameUpdates(input: {
  body?: string;
  bounds?: Partial<Pick<CanvasBounds, "height" | "width">>;
  collapsed?: boolean;
  execution: AgentExecutionNodeMeta;
}): Partial<FrameNode> {
  const collapsed =
    input.collapsed ?? getAgentExecutionCanvasCollapsed(input.execution);
  const size = getAgentExecutionCanvasSize({
    kind: input.execution.kind,
    collapsed,
  });
  const width = input.bounds?.width ?? size.width;
  const height = input.bounds?.height ?? size.height;
  return {
    width,
    height,
    children: createAgentExecutionCanvasChildren({
      body: input.body ?? formatAgentExecutionCanvasBody(input.execution),
      bounds: { width, height },
      collapsed,
      execution: withAgentExecutionCanvasPresentation(input.execution, {
        collapsed,
      }),
    }),
    clipContent: false,
    cornerRadius:
      getAgentExecutionCanvasRole(input.execution.kind) === "execution"
        ? BAR_RADIUS
        : CARD_RADIUS,
    fill: [
      {
        color:
          getAgentExecutionCanvasRole(input.execution.kind) === "execution"
            ? EXECUTION_GREEN_SOFT
            : "rgba(255,255,255,0.98)",
        type: "solid",
      },
    ],
    stroke: {
      fill: [
        {
          color:
            getAgentExecutionCanvasRole(input.execution.kind) === "execution"
              ? "rgba(41,191,78,0.22)"
              : CARD_STROKE,
          type: "solid",
        },
      ],
      thickness:
        getAgentExecutionCanvasRole(input.execution.kind) === "execution"
          ? 0.5
          : 1,
    },
  } as Partial<FrameNode>;
}

export function createAgentExecutionCanvasChildren(input: {
  body: string;
  bounds: Pick<CanvasBounds, "height" | "width">;
  collapsed: boolean;
  execution: AgentExecutionNodeMeta;
}): PenNode[] {
  const role = getAgentExecutionCanvasRole(input.execution.kind);
  if (role === "user_input") {
    return [
      textNode({
        content: input.body,
        fontSize: 11,
        fontWeight: 500,
        height: Math.max(32, input.bounds.height - 52),
        name: "用户输入",
        width: Math.max(80, input.bounds.width - 54),
        x: 27,
        y: 26,
      }),
    ];
  }
  if (role === "result") {
    return [
      textNode({
        content: input.execution.title,
        fontSize: 13,
        fontWeight: 650,
        height: 20,
        name: "结果标题",
        width: Math.max(80, input.bounds.width - 32),
        x: 16,
        y: 18,
      }),
      textNode({
        content: input.body,
        fill: TEXT_SECONDARY,
        fontSize: 11,
        fontWeight: 400,
        height: Math.max(64, input.bounds.height - 58),
        name: "结果摘要",
        width: Math.max(80, input.bounds.width - 32),
        x: 16,
        y: 46,
      }),
    ];
  }

  const header: PenNode[] = [
    {
      id: createNodeId("agent_execution_dot"),
      type: "ellipse",
      name: "Agent 执行状态",
      x: 12,
      y: 8,
      width: 20,
      height: 20,
      fill: [{ color: EXECUTION_GREEN, type: "solid" }],
    } as PenNode,
    textNode({
      content:
        input.execution.status === "running"
          ? "Thinking..."
          : `${getAgentExecutionStatusLabel(input.execution.status)}...`,
      fill: EXECUTION_GREEN,
      fontSize: 11,
      fontWeight: 600,
      height: 16,
      name: "Agent 执行状态文本",
      width: Math.max(80, input.bounds.width - 74),
      x: 37,
      y: 10,
    }),
    textNode({
      content: input.collapsed ? "v" : "^",
      fill: EXECUTION_GREEN,
      fontSize: 12,
      fontWeight: 700,
      height: 16,
      name: "Agent 执行展开按钮",
      width: 10,
      x: input.bounds.width - 22,
      y: 10,
    }),
  ];
  if (input.collapsed) return header;
  return [
    ...header,
    textNode({
      content: `${getAgentExecutionKindLabel(input.execution.kind)} · ${input.execution.title}`,
      fontSize: 12,
      fontWeight: 650,
      height: 18,
      name: "Agent 执行标题",
      width: Math.max(80, input.bounds.width - 32),
      x: 16,
      y: 48,
    }),
    textNode({
      content: input.body,
      fill: TEXT_SECONDARY,
      fontSize: 11,
      fontWeight: 400,
      height: Math.max(48, input.bounds.height - 80),
      name: "Agent 执行摘要",
      width: Math.max(80, input.bounds.width - 32),
      x: 16,
      y: 72,
    }),
  ];
}

export function getAgentExecutionCanvasConnectorStroke(
  tone: "accent" | "warning" = "accent",
): LineNode["stroke"] {
  return {
    cap: "round",
    fill: [
      {
        color: tone === "warning" ? "rgba(217,119,6,0.32)" : CONNECTOR_STROKE,
        type: "solid",
      },
    ],
    thickness: 1,
  };
}

export function normalizeAgentExecutionCanvasLayout(doc: PenDocument): {
  changed: boolean;
  doc: PenDocument;
  migratedNodeIds: string[];
} {
  const pages = doc.pages;
  if (!pages?.length) return { changed: false, doc, migratedNodeIds: [] };
  let changed = false;
  const migratedNodeIds: string[] = [];
  const nextPages = pages.map((page) => {
    const executionNodes = collectExecutionNodes(page.children).filter(
      ({ execution }) => !isAgentExecutionCanvasPresentationV2(execution),
    );
    if (executionNodes.length === 0) return page;
    changed = true;
    migratedNodeIds.push(...executionNodes.map(({ node }) => node.id));
    const layoutById = buildMigrationLayout(
      executionNodes.map(({ node }) => node),
    );
    return {
      ...page,
      children: mapNodes(page.children, (node) => {
        const execution = getAgentExecutionMeta(node);
        if (!execution || !layoutById.has(node.id)) return node;
        const layout = layoutById.get(node.id);
        const nextExecution = withAgentExecutionCanvasPresentation(execution, {
          collapsed:
            getAgentExecutionCanvasRole(execution.kind) === "execution",
        });
        const size = getAgentExecutionCanvasSize({
          collapsed: nextExecution.canvasPresentation?.collapsed ?? true,
          kind: nextExecution.kind,
        });
        return {
          ...node,
          ...(layout ? { x: layout.x, y: layout.y } : {}),
          meta: {
            ...(node.meta ?? {}),
            [AGENT_EXECUTION_META_KEY]: nextExecution,
          },
          ...getAgentExecutionCanvasFrameUpdates({
            body: formatAgentExecutionCanvasBody(nextExecution),
            bounds: size,
            collapsed: nextExecution.canvasPresentation?.collapsed ?? true,
            execution: nextExecution,
          }),
        } as PenNode;
      }),
    };
  });
  if (!changed) return { changed: false, doc, migratedNodeIds };
  return {
    changed: true,
    doc: { ...doc, pages: nextPages },
    migratedNodeIds,
  };
}

function textNode(input: {
  content: string;
  fill?: string;
  fontSize: number;
  fontWeight: number;
  height: number;
  name: string;
  width: number;
  x: number;
  y: number;
}): PenNode {
  return {
    id: createNodeId("agent_execution_text"),
    type: "text",
    name: input.name,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    content: input.content,
    fill: [{ color: input.fill ?? TEXT_PRIMARY, type: "solid" }],
    fontSize: input.fontSize,
    fontWeight: input.fontWeight,
    lineHeight: 1.35,
    textGrowth: "fixed-width-height",
  } as PenNode;
}

function collectExecutionNodes(
  nodes: PenNode[],
): Array<{ execution: AgentExecutionNodeMeta; node: PenNode }> {
  const result: Array<{ execution: AgentExecutionNodeMeta; node: PenNode }> =
    [];
  for (const node of nodes) {
    const execution = getAgentExecutionMeta(node);
    if (execution) result.push({ execution, node });
    if ("children" in node && Array.isArray(node.children)) {
      result.push(...collectExecutionNodes(node.children));
    }
  }
  return result;
}

function mapNodes(
  nodes: PenNode[],
  mapper: (node: PenNode) => PenNode,
): PenNode[] {
  return nodes.map((node) => {
    const mapped = mapper(node);
    if (!("children" in mapped) || !Array.isArray(mapped.children)) {
      return mapped;
    }
    return {
      ...mapped,
      children: mapNodes(mapped.children, mapper),
    } as PenNode;
  });
}

function buildMigrationLayout(
  nodes: PenNode[],
): Map<string, { x: number; y: number }> {
  const origin = nodes.reduce(
    (acc, node) => ({
      x: Math.min(acc.x, node.x ?? 0),
      y: Math.min(acc.y, node.y ?? 0),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
  );
  const start = {
    x: Number.isFinite(origin.x) ? origin.x : 0,
    y: Number.isFinite(origin.y) ? origin.y : 0,
  };
  const sorted = [...nodes].sort(compareExecutionLayoutOrder);
  const result = new Map<string, { x: number; y: number }>();
  let y = start.y;
  let resultIndex = 0;
  for (const node of sorted) {
    const execution = getAgentExecutionMeta(node);
    if (!execution) continue;
    const role = getAgentExecutionCanvasRole(execution.kind);
    const size = getAgentExecutionCanvasSize({
      collapsed: role === "execution",
      kind: execution.kind,
    });
    if (role === "result" && execution.kind === "variant_branch") {
      result.set(node.id, {
        x:
          start.x +
          resultIndex *
            (AGENT_EXECUTION_RESULT_CARD_SIZE.width +
              AGENT_EXECUTION_BRANCH_GAP),
        y,
      });
      resultIndex += 1;
      continue;
    }
    if (resultIndex > 0) {
      y +=
        AGENT_EXECUTION_RESULT_CARD_SIZE.height + AGENT_EXECUTION_VERTICAL_GAP;
      resultIndex = 0;
    }
    result.set(node.id, { x: start.x, y });
    y += size.height + AGENT_EXECUTION_VERTICAL_GAP;
  }
  return result;
}

function compareExecutionLayoutOrder(a: PenNode, b: PenNode): number {
  const aExecution = getAgentExecutionMeta(a);
  const bExecution = getAgentExecutionMeta(b);
  return (
    layoutRank(aExecution?.kind) - layoutRank(bExecution?.kind) ||
    (a.y ?? 0) - (b.y ?? 0) ||
    (a.x ?? 0) - (b.x ?? 0)
  );
}

function layoutRank(kind: AgentExecutionNodeKind | undefined): number {
  switch (kind) {
    case "user_goal":
      return 0;
    case "recipe_plan":
      return 10;
    case "task_step":
      return 20;
    case "tool_call":
      return 30;
    case "evidence":
      return 40;
    case "ask_user_more":
      return 45;
    case "critique":
      return 50;
    case "checkpoint":
      return 60;
    case "variant_branch":
      return 70;
    case "comparison":
      return 75;
    case "final_deliverable":
      return 80;
    default:
      return 100;
  }
}

function readableFallbackForExecution(
  execution: AgentExecutionNodeMeta,
): string {
  if (execution.status === "failed") {
    return "执行失败：没有记录具体失败原因，请查看相关执行节点或服务端日志。";
  }
  if (execution.status === "paused") return "执行已暂停，可从该节点继续。";
  if (execution.status === "running") return "Agent 正在处理当前步骤。";
  if (execution.status === "waiting") return "等待 Agent 执行或用户补充信息。";
  return "Agent 已完成该步骤。";
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
