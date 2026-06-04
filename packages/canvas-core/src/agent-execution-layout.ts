import type {
  FrameNode,
  LineNode,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";

import {
  AGENT_EXECUTION_META_KEY,
  AGENT_EXECUTION_SCHEMA_VERSION,
  type AgentExecutionNodeKind,
  type AgentExecutionNodeMeta,
  type AgentExecutionStatus,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
  withAgentExecutionNodeSemantics,
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

export const AGENT_EXECUTION_MAX_COLLAPSED_HEIGHT = {
  user_input: 180,
  execution: 148,
  result: 320,
} as const;

export const AGENT_EXECUTION_BRANCH_GAP = 17;
export const AGENT_EXECUTION_VERTICAL_GAP = 40;
export const AGENT_EXECUTION_CHEVRON_HOT_ZONE_WIDTH = 32;

const CARD_RADIUS = 18;
const BAR_RADIUS = 18;
const CARD_STROKE = "rgba(15,23,42,0.08)";
const CONNECTOR_STROKE = "rgba(15,23,42,0.12)";
const EXECUTION_GREEN = "rgba(41,191,78,1)";
const EXECUTION_GREEN_SOFT = "rgba(248,255,191,1)";
const COMPONENT_HORIZONTAL_PADDING = 16;
const COMPONENT_LINE_HEIGHT = 17;
const COMPONENT_BODY_FONT_SIZE = 11;
const DISPLAY_CHILD_NAMES = new Set([
  "Agent 执行展开按钮",
  "Agent 执行摘要",
  "Agent 执行标题",
  "Agent 执行状态",
  "Agent 执行状态文本",
  "用户输入",
  "结果摘要",
  "结果标题",
]);

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

export interface AgentExecutionComponentLayout {
  body: string;
  collapsedHeight: number;
  expanded: boolean;
  fullHeight: number;
  hasOverflow: boolean;
  height: number;
  maxCollapsedHeight: number;
  minHeight: number;
  role: AgentExecutionCanvasCardRole;
  showToggle: boolean;
  statusLabel: string;
  title: string;
  width: number;
}

export function measureAgentExecutionComponentLayout(
  execution: AgentExecutionNodeMeta,
  width = getAgentExecutionCanvasSize({
    collapsed: getAgentExecutionCanvasCollapsed(execution),
    kind: execution.kind,
  }).width,
  expanded = !getAgentExecutionCanvasCollapsed(execution),
  options: { minHeight?: number } = {},
): AgentExecutionComponentLayout {
  const role = getAgentExecutionCanvasRole(execution.kind);
  const minHeight = Math.max(
    getAgentExecutionCanvasSize({
      collapsed: true,
      kind: execution.kind,
    }).height,
    options.minHeight ?? 0,
  );
  const maxCollapsedHeight = AGENT_EXECUTION_MAX_COLLAPSED_HEIGHT[role];
  const body = formatAgentExecutionCanvasBody(execution);
  const title = execution.title;
  const statusLabel =
    execution.status === "running"
      ? "Thinking..."
      : `${getAgentExecutionStatusLabel(execution.status)}...`;
  const contentWidth = Math.max(1, width - COMPONENT_HORIZONTAL_PADDING * 2);
  const bodyLines = estimateWrappedLineCount(
    body,
    contentWidth,
    COMPONENT_BODY_FONT_SIZE,
  );
  const titleLines = estimateWrappedLineCount(
    title,
    contentWidth,
    role === "result" ? 13 : 12,
  );
  const fullHeight = Math.max(
    minHeight,
    fullHeightForRole(role, titleLines, bodyLines),
  );
  const hasOverflow = fullHeight > maxCollapsedHeight;
  const collapsedHeight = hasOverflow
    ? maxCollapsedHeight
    : Math.max(minHeight, fullHeight);
  return {
    body,
    collapsedHeight,
    expanded,
    fullHeight,
    hasOverflow,
    height: expanded && hasOverflow ? fullHeight : collapsedHeight,
    maxCollapsedHeight,
    minHeight,
    role,
    showToggle: hasOverflow,
    statusLabel,
    title,
    width,
  };
}

export function createAgentUserGoalNode(input: {
  text?: string;
  x: number;
  y: number;
  width?: number;
}): FrameNode {
  const title = "用户目标";
  const summary =
    input.text?.trim() || "描述你的目标，Agent 会从这里开始执行。";
  const execution = withAgentExecutionCanvasPresentation(
    {
      kind: "user_goal",
      schemaVersion: AGENT_EXECUTION_SCHEMA_VERSION,
      status: "waiting",
      summary,
      title,
    },
    { collapsed: false },
  );
  const width = input.width ?? AGENT_EXECUTION_USER_CARD_SIZE.width;
  const visual = getAgentExecutionCanvasFrameUpdates({
    execution,
    bounds: { width },
  });
  return withAgentExecutionNodeSemantics(
    {
      id: createNodeId("agent_user_goal"),
      type: "frame",
      name: title,
      x: input.x,
      y: input.y,
      width,
      height: visual.height ?? AGENT_EXECUTION_USER_CARD_SIZE.height,
      children: [],
      clipContent: false,
      containerRole: ["context"],
      contextSlots: {
        rules: ["agent execution node: user_goal"],
      },
      permissions: {
        owner: "user",
        canRead: [],
        canWrite: [],
        isolationLevel: "open",
      },
      ...visual,
    } as FrameNode,
    execution,
    { containerRole: ["context"] },
  ) as FrameNode;
}

export function createAgentExecutionNode(input: {
  agentId?: string;
  runId?: string;
  sessionId?: string;
  summary?: string;
  title?: string;
  upstreamNodeIds?: string[];
  width?: number;
  x: number;
  y: number;
}): FrameNode {
  const title = input.title?.trim() || "Agent 执行";
  const summary = input.summary?.trim() || "Thinking...";
  const execution = withAgentExecutionCanvasPresentation(
    {
      kind: "agent_execution",
      schemaVersion: AGENT_EXECUTION_SCHEMA_VERSION,
      status: "running",
      summary,
      title,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.upstreamNodeIds
        ? { upstreamNodeIds: input.upstreamNodeIds }
        : {}),
      streamEntries: [],
    },
    { collapsed: false },
  );
  const width = input.width ?? AGENT_EXECUTION_BAR_SIZE.width;
  const visual = getAgentExecutionCanvasFrameUpdates({
    body: summary,
    bounds: { width },
    collapsed: false,
    execution,
  });
  return withAgentExecutionNodeSemantics(
    {
      id: createNodeId("agent_execution"),
      type: "frame",
      name: title,
      x: input.x,
      y: input.y,
      width,
      height: visual.height ?? AGENT_EXECUTION_BAR_SIZE.expandedHeight,
      children: [],
      clipContent: false,
      containerRole: ["task", "context"],
      contextSlots: {
        rules: ["agent execution node: agent_execution"],
      },
      permissions: {
        owner: "agent",
        canRead: [],
        canWrite: [],
        isolationLevel: "open",
      },
      ...visual,
    } as FrameNode,
    execution,
    { containerRole: ["task", "context"] },
  ) as FrameNode;
}

export function getAgentExecutionNodePresentationUpdates(input: {
  execution: AgentExecutionNodeMeta;
  width?: number;
}): Partial<FrameNode> {
  const collapsed = getAgentExecutionCanvasCollapsed(input.execution);
  return getAgentExecutionCanvasFrameUpdates({
    body: formatAgentExecutionCanvasBody(input.execution),
    ...(typeof input.width === "number"
      ? { bounds: { width: input.width } }
      : {}),
    collapsed,
    execution: input.execution,
  });
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
  const execution = withAgentExecutionCanvasPresentation(
    {
      ...input.execution,
      ...(input.body ? { summary: input.body } : {}),
    },
    { collapsed },
  );
  const size = getAgentExecutionCanvasSize({
    collapsed,
    kind: execution.kind,
  });
  const width = input.bounds?.width ?? size.width;
  const layout = measureAgentExecutionComponentLayout(
    execution,
    width,
    !collapsed,
    { minHeight: input.bounds?.height },
  );
  return {
    width,
    height: layout.height,
    clipContent: false,
    cornerRadius:
      getAgentExecutionCanvasRole(execution.kind) === "execution"
        ? BAR_RADIUS
        : CARD_RADIUS,
    fill: [
      {
        color:
          getAgentExecutionCanvasRole(execution.kind) === "execution"
            ? EXECUTION_GREEN_SOFT
            : "rgba(255,255,255,0.98)",
        type: "solid",
      },
    ],
    stroke: {
      fill: [
        {
          color:
            getAgentExecutionCanvasRole(execution.kind) === "execution"
              ? "rgba(41,191,78,0.22)"
              : CARD_STROKE,
          type: "solid",
        },
      ],
      thickness:
        getAgentExecutionCanvasRole(execution.kind) === "execution" ? 0.5 : 1,
    },
  } as Partial<FrameNode>;
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
          children: removeAgentExecutionDisplayChildren(node),
          meta: {
            ...(node.meta ?? {}),
            [AGENT_EXECUTION_META_KEY]: nextExecution,
          },
          ...getAgentExecutionCanvasFrameUpdates({
            body: formatAgentExecutionCanvasBody(nextExecution),
            bounds: {
              width: size.width,
            },
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

function removeAgentExecutionDisplayChildren(node: PenNode): PenNode[] {
  if (!("children" in node) || !Array.isArray(node.children)) return [];
  return node.children.filter(
    (child) => !DISPLAY_CHILD_NAMES.has(child.name ?? ""),
  );
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
    case "agent_execution":
      return 5;
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

function fullHeightForRole(
  role: AgentExecutionCanvasCardRole,
  titleLines: number,
  bodyLines: number,
): number {
  switch (role) {
    case "user_input":
      return 24 + titleLines * 20 + 12 + bodyLines * COMPONENT_LINE_HEIGHT + 24;
    case "execution":
      return 40 + titleLines * 18 + 8 + bodyLines * COMPONENT_LINE_HEIGHT + 20;
    case "result":
      return 18 + titleLines * 20 + 14 + bodyLines * COMPONENT_LINE_HEIGHT + 24;
  }
}

function estimateWrappedLineCount(
  text: string,
  width: number,
  fontSize: number,
): number {
  const lines = text.split("\n");
  return Math.max(
    1,
    lines.reduce(
      (count, line) =>
        count +
        Math.max(1, Math.ceil(estimateTextWidth(line, fontSize) / width)),
      0,
    ),
  );
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + fontSize * 0.3;
    if (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      return sum + fontSize;
    }
    return sum + fontSize * 0.58;
  }, 0);
}
