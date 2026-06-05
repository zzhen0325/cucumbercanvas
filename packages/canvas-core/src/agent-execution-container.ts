import type {
  AgentExecutionNodeKind,
  AgentExecutionNodeMeta,
  AgentExecutionStatus,
} from "./agent-execution.js";
import type { PenNode } from "./types.js";

export const AGENT_EXECUTION_CONTAINER_META_KEY = "agentExecutionContainer";
export const AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION = 1;

const MAX_PART_COUNT = 24;
const MAX_TEXT_LENGTH = 4000;
const MAX_CANVAS_BODY_LENGTH = 1600;

export type AgentExecutionContainerPartStatus =
  | "running"
  | "done"
  | "failed"
  | "paused";

export type AgentExecutionContainerStreamPart =
  | {
      content?: string;
      id: string;
      label: string;
      status: AgentExecutionContainerPartStatus;
      timestamp: string;
      type: "stage" | "thinking" | "message" | "artifact";
    }
  | {
      content?: string;
      id: string;
      label: string;
      status: AgentExecutionContainerPartStatus;
      timestamp: string;
      toolCallId: string;
      toolName: string;
      type: "tool";
    };

export interface AgentExecutionContainerTodo {
  activeForm?: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AgentExecutionContainerToolPart {
  id: string;
  errorText?: string;
  input?: Record<string, unknown>;
  inputSummary?: string;
  output?: Record<string, unknown>;
  outputSummary?: string;
  status: AgentExecutionContainerPartStatus;
  timestamp: string;
  toolCallId: string;
  toolName: string;
}

export interface AgentExecutionArtifactRef {
  nodeId: string;
}

export interface AgentExecutionContainerDiagnostics {
  legacyDisplayText?: string;
}

export interface AgentExecutionContainer {
  agentId?: string;
  artifactRefs: AgentExecutionArtifactRef[];
  branch?: AgentExecutionNodeMeta["branch"];
  comparison?: AgentExecutionNodeMeta["comparison"];
  containerId: string;
  checkpoint?: AgentExecutionNodeMeta["checkpoint"];
  critique?: AgentExecutionNodeMeta["critique"];
  diagnostics?: AgentExecutionContainerDiagnostics;
  evidence?: AgentExecutionNodeMeta["evidence"];
  failure?: AgentExecutionNodeMeta["failure"];
  kind: AgentExecutionNodeKind;
  legacyNodeMeta?: AgentExecutionNodeMeta;
  runId?: string;
  schemaVersion: typeof AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION;
  sessionId?: string;
  status: AgentExecutionStatus;
  streamParts: AgentExecutionContainerStreamPart[];
  summary?: string;
  title: string;
  todos: AgentExecutionContainerTodo[];
  toolParts: AgentExecutionContainerToolPart[];
  waitingForUser?: AgentExecutionNodeMeta["waitingForUser"];
}

export function getAgentExecutionContainerMeta(
  node: Pick<PenNode, "meta"> | null | undefined,
): AgentExecutionContainer | undefined {
  const value = node?.meta?.[AGENT_EXECUTION_CONTAINER_META_KEY];
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION) {
    return undefined;
  }
  if (typeof value.containerId !== "string" || !value.containerId.trim()) {
    return undefined;
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    return undefined;
  }
  if (!isAgentExecutionContainerKind(value.kind)) return undefined;
  if (!isAgentExecutionContainerStatus(value.status)) return undefined;
  if (!Array.isArray(value.streamParts)) return undefined;
  if (!Array.isArray(value.todos)) return undefined;
  if (!Array.isArray(value.toolParts)) return undefined;
  if (!Array.isArray(value.artifactRefs)) return undefined;
  return value as unknown as AgentExecutionContainer;
}

export function getAgentExecutionContainerMetaUpdates(
  node: PenNode,
  container: AgentExecutionContainer,
): Pick<PenNode, "meta"> {
  return {
    meta: {
      ...(node.meta ?? {}),
      [AGENT_EXECUTION_CONTAINER_META_KEY]: container,
    },
  };
}

export function withAgentExecutionContainerMeta<T extends PenNode>(
  node: T,
  container: AgentExecutionContainer,
): T {
  return {
    ...node,
    meta: {
      ...(node.meta ?? {}),
      [AGENT_EXECUTION_CONTAINER_META_KEY]: container,
    },
  };
}

export function formatAgentExecutionContainerCanvasBody(
  container: AgentExecutionContainer,
): string {
  if (container.kind === "agent_run_node") {
    const compactLines = [
      container.failure?.reason
        ? `失败原因：${container.failure.reason}`
        : undefined,
      container.waitingForUser?.prompt
        ? `等待补充：${container.waitingForUser.prompt}`
        : undefined,
      isReadableCanvasSummary(container.summary)
        ? container.summary
        : undefined,
      container.artifactRefs.length > 0
        ? `产物：${container.artifactRefs.length} 个画布产物`
        : undefined,
    ].filter(isUsefulText);
    return (
      clampCanvasBody(dedupeConsecutiveLines(compactLines).join("\n")) ||
      "展开查看 Agent 执行详情。"
    );
  }
  const lines = [
    container.failure?.reason
      ? `失败原因：${container.failure.reason}`
      : undefined,
    container.waitingForUser?.prompt
      ? `等待补充：${container.waitingForUser.prompt}`
      : undefined,
    container.summary,
    ...container.todos.slice(-4).map(formatTodoLine),
    ...container.toolParts.slice(-4).map(formatToolLine),
    ...container.streamParts.slice(-4).map(formatStreamLine),
    container.artifactRefs.length > 0
      ? `产物：${container.artifactRefs.length} 个画布产物`
      : undefined,
  ].filter(isUsefulText);
  return clampCanvasBody(dedupeConsecutiveLines(lines).join("\n"));
}

export type AgentExecutionContainerEvent =
  | {
      runId: string;
      timestamp: string;
      type: "run.started" | "run.completed" | "run.canceled";
    }
  | {
      reason?: string;
      runId: string;
      timestamp: string;
      type: "run.paused";
    }
  | {
      delta: string;
      messageId: string;
      runId: string;
      timestamp: string;
      type: "message.delta" | "thinking.delta";
    }
  | {
      runId: string;
      stage:
        | "critique"
        | "design"
        | "export"
        | "planning"
        | "prompt_layering"
        | "replay_checkpoint"
        | "research"
        | "tool_execution";
      stageId: string;
      status: "started" | "running" | "completed" | "failed" | "blocked";
      summary?: string;
      timestamp: string;
      type: "agent.stage";
    }
  | {
      input?: Record<string, unknown>;
      runId: string;
      timestamp: string;
      toolCallId: string;
      toolName: string;
      type: "tool.started";
    }
  | {
      artifacts?: unknown[];
      output?: Record<string, unknown>;
      outputSummary?: string;
      runId: string;
      timestamp: string;
      toolCallId: string;
      toolName: string;
      type: "tool.completed";
    }
  | {
      error: { message: string };
      runId: string;
      timestamp: string;
      type: "run.failed";
    }
  | {
      runId: string;
      timestamp: string;
      type: "canvas.patch" | "canvas.sync" | "run.context";
    };

export function createAgentExecutionContainerFromNodeMeta(input: {
  containerId: string;
  execution: AgentExecutionNodeMeta;
  legacyDisplayText?: string;
}): AgentExecutionContainer {
  return {
    ...(input.execution.agentId ? { agentId: input.execution.agentId } : {}),
    artifactRefs: toArtifactRefs(input.execution.artifactNodeIds),
    ...(input.execution.branch ? { branch: input.execution.branch } : {}),
    ...(input.execution.comparison
      ? { comparison: input.execution.comparison }
      : {}),
    containerId: input.containerId,
    ...(input.execution.checkpoint
      ? { checkpoint: input.execution.checkpoint }
      : {}),
    ...(input.execution.critique ? { critique: input.execution.critique } : {}),
    ...(input.legacyDisplayText
      ? { diagnostics: { legacyDisplayText: input.legacyDisplayText } }
      : {}),
    ...(input.execution.evidence ? { evidence: input.execution.evidence } : {}),
    ...(input.execution.failure ? { failure: input.execution.failure } : {}),
    kind: input.execution.kind,
    legacyNodeMeta: input.execution,
    ...(input.execution.runId ? { runId: input.execution.runId } : {}),
    schemaVersion: AGENT_EXECUTION_CONTAINER_SCHEMA_VERSION,
    ...(input.execution.sessionId
      ? { sessionId: input.execution.sessionId }
      : {}),
    status: input.execution.status,
    streamParts: normalizeLegacyStreamParts(input.execution.streamEntries),
    ...(input.execution.summary ? { summary: input.execution.summary } : {}),
    title: input.execution.title,
    todos: [],
    toolParts: [],
    ...(input.execution.waitingForUser
      ? { waitingForUser: input.execution.waitingForUser }
      : {}),
  };
}

export function reduceAgentExecutionContainerStreamEvent(
  container: AgentExecutionContainer,
  event: AgentExecutionContainerEvent,
): AgentExecutionContainer {
  switch (event.type) {
    case "run.started":
      return {
        ...container,
        status: "running",
        summary: container.summary || "Thinking...",
      };
    case "message.delta": {
      const id = `message:${event.messageId}`;
      const previous = findPartContent(container.streamParts, id);
      const content = clampText(`${previous}${event.delta}`);
      return {
        ...container,
        status: "running",
        streamParts: upsertPart(container.streamParts, {
          content,
          id,
          label: "输出",
          status: "running",
          timestamp: event.timestamp,
          type: "message",
        }),
        summary: content,
      };
    }
    case "thinking.delta": {
      const id = `thinking:${event.messageId}`;
      const previous = findPartContent(container.streamParts, id);
      const content = clampText(`${previous}${event.delta}`);
      return {
        ...container,
        status: "running",
        streamParts: upsertPart(container.streamParts, {
          content,
          id,
          label: "思考",
          status: "running",
          timestamp: event.timestamp,
          type: "thinking",
        }),
        summary: "Thinking...",
      };
    }
    case "agent.stage": {
      const status = mapStageStatus(event.status);
      const label = stageLabel(event.stage);
      return {
        ...container,
        status: status === "failed" ? "failed" : "running",
        streamParts: upsertPart(container.streamParts, {
          ...(event.summary ? { content: event.summary } : {}),
          id: event.stageId,
          label,
          status,
          timestamp: event.timestamp,
          type: "stage",
        }),
        summary: event.summary ?? label,
      };
    }
    case "tool.started": {
      const part: AgentExecutionContainerToolPart = {
        id: `tool:${event.toolCallId}`,
        ...(event.input ? { input: event.input } : {}),
        ...(summarizeObject(event.input)
          ? { inputSummary: summarizeObject(event.input) }
          : {}),
        status: "running",
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      };
      return {
        ...container,
        status: "running",
        streamParts: upsertPart(container.streamParts, {
          ...(part.inputSummary ? { content: part.inputSummary } : {}),
          id: part.id,
          label: `调用 ${event.toolName}`,
          status: "running",
          timestamp: event.timestamp,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool",
        }),
        summary: `正在调用 ${event.toolName}`,
        toolParts: upsertToolPart(container.toolParts, part),
      };
    }
    case "tool.completed": {
      const outputSummary =
        event.outputSummary ?? summarizeObject(event.output);
      const errorText = getToolOutputErrorText(event.output);
      const todoUpdates =
        event.toolName === "write_todos"
          ? collectTodoUpdates(event.output)
          : null;
      const previousPart = container.toolParts.find(
        (tool) => tool.id === `tool:${event.toolCallId}`,
      );
      const part: AgentExecutionContainerToolPart = {
        id: `tool:${event.toolCallId}`,
        ...(errorText ? { errorText } : {}),
        ...(previousPart?.input ? { input: previousPart.input } : {}),
        ...(previousPart?.inputSummary
          ? { inputSummary: previousPart.inputSummary }
          : {}),
        ...(event.output ? { output: event.output } : {}),
        ...(outputSummary ? { outputSummary } : {}),
        status: errorText ? "failed" : "done",
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      };
      return {
        ...container,
        artifactRefs: mergeArtifactRefs(
          container.artifactRefs,
          collectArtifactNodeIds(event),
        ),
        status: "running",
        streamParts: upsertPart(container.streamParts, {
          ...(outputSummary ? { content: outputSummary } : {}),
          id: part.id,
          label: `完成 ${event.toolName}`,
          status: "done",
          timestamp: event.timestamp,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool",
        }),
        summary: outputSummary ?? `已完成 ${event.toolName}`,
        ...(todoUpdates ? { todos: todoUpdates } : {}),
        toolParts: upsertToolPart(container.toolParts, part),
      };
    }
    case "run.completed":
      return {
        ...container,
        status: "done",
        streamParts: markRunningParts(container.streamParts, "done"),
        toolParts: markRunningToolParts(container.toolParts, "done"),
        summary: container.summary || "Agent 执行完成。",
      };
    case "run.paused":
      return {
        ...container,
        status: "paused",
        streamParts: markRunningParts(container.streamParts, "paused"),
        toolParts: markRunningToolParts(container.toolParts, "paused"),
        summary: event.reason ?? "用户已暂停当前 Agent 执行。",
      };
    case "run.canceled":
      return {
        ...container,
        status: "paused",
        streamParts: markRunningParts(container.streamParts, "paused"),
        toolParts: markRunningToolParts(container.toolParts, "paused"),
        summary: "用户已停止当前 Agent 执行。",
      };
    case "run.failed":
      return {
        ...container,
        failure: {
          reason: event.error.message,
          step: "Agent 执行",
        },
        status: "failed",
        streamParts: markRunningParts(container.streamParts, "failed"),
        toolParts: markRunningToolParts(container.toolParts, "failed"),
        summary: `处理失败：${event.error.message}`,
      };
    case "canvas.patch":
    case "canvas.sync":
    case "run.context":
      return container;
  }
}

function normalizeLegacyStreamParts(
  entries: AgentExecutionNodeMeta["streamEntries"],
): AgentExecutionContainerStreamPart[] {
  if (!entries?.length) return [];
  return entries
    .map((entry) => ({
      ...(entry.content ? { content: entry.content } : {}),
      id: entry.id,
      label: entry.label,
      status: entry.status,
      timestamp: entry.timestamp,
      ...(entry.toolName
        ? {
            toolCallId: entry.id.replace(/^tool:/, ""),
            toolName: entry.toolName,
          }
        : {}),
      type: entry.type,
    }))
    .filter(isAgentExecutionContainerStreamPart)
    .slice(-MAX_PART_COUNT);
}

function upsertPart(
  parts: AgentExecutionContainerStreamPart[],
  next: AgentExecutionContainerStreamPart,
): AgentExecutionContainerStreamPart[] {
  const index = parts.findIndex((part) => part.id === next.id);
  const merged =
    index >= 0
      ? parts.map((part, partIndex) =>
          partIndex === index ? { ...part, ...next } : part,
        )
      : [...parts, next];
  return merged.slice(-MAX_PART_COUNT);
}

function upsertToolPart(
  parts: AgentExecutionContainerToolPart[],
  next: AgentExecutionContainerToolPart,
): AgentExecutionContainerToolPart[] {
  const index = parts.findIndex((part) => part.id === next.id);
  const merged =
    index >= 0
      ? parts.map((part, partIndex) =>
          partIndex === index ? { ...part, ...next } : part,
        )
      : [...parts, next];
  return merged.slice(-MAX_PART_COUNT);
}

function collectTodoUpdates(
  output: Record<string, unknown> | undefined,
): AgentExecutionContainerTodo[] | null {
  const todos = output?.todos;
  if (!Array.isArray(todos)) return null;
  return todos
    .map((todo) => {
      if (!isRecord(todo)) return null;
      const content =
        typeof todo.content === "string" ? todo.content.trim() : "";
      const status = normalizeTodoStatus(todo.status);
      if (!content || !status) return null;
      const activeForm =
        typeof todo.activeForm === "string" ? todo.activeForm.trim() : "";
      return {
        ...(activeForm ? { activeForm } : {}),
        content: clampText(content),
        status,
      } satisfies AgentExecutionContainerTodo;
    })
    .filter((todo): todo is AgentExecutionContainerTodo => todo !== null);
}

function getToolOutputErrorText(
  output: Record<string, unknown> | undefined,
): string | undefined {
  if (!output) return undefined;
  const error = output.error;
  if (typeof error === "string" && error.trim()) return clampText(error.trim());
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return clampText(message.trim());
    }
  }
  return undefined;
}

function normalizeTodoStatus(
  status: unknown,
): AgentExecutionContainerTodo["status"] | null {
  if (status === "pending") return "pending";
  if (status === "in_progress" || status === "in-progress") {
    return "in_progress";
  }
  if (status === "completed" || status === "done") return "completed";
  return null;
}

function markRunningParts(
  parts: AgentExecutionContainerStreamPart[],
  status: AgentExecutionContainerPartStatus,
): AgentExecutionContainerStreamPart[] {
  return parts.map((part) =>
    part.status === "running" ? { ...part, status } : part,
  );
}

function markRunningToolParts(
  parts: AgentExecutionContainerToolPart[],
  status: AgentExecutionContainerPartStatus,
): AgentExecutionContainerToolPart[] {
  return parts.map((part) =>
    part.status === "running" ? { ...part, status } : part,
  );
}

function findPartContent(
  parts: AgentExecutionContainerStreamPart[],
  id: string,
): string {
  return parts.find((part) => part.id === id)?.content ?? "";
}

function mapStageStatus(
  status: Extract<
    AgentExecutionContainerEvent,
    { type: "agent.stage" }
  >["status"],
): AgentExecutionContainerPartStatus {
  if (status === "completed") return "done";
  if (status === "failed" || status === "blocked") return "failed";
  return "running";
}

function stageLabel(
  stage: Extract<
    AgentExecutionContainerEvent,
    { type: "agent.stage" }
  >["stage"],
): string {
  switch (stage) {
    case "critique":
      return "评审";
    case "design":
      return "设计";
    case "export":
      return "导出";
    case "planning":
      return "规划";
    case "prompt_layering":
      return "理解目标";
    case "replay_checkpoint":
      return "重放检查点";
    case "research":
      return "检索资料";
    case "tool_execution":
      return "执行工具";
  }
}

function collectArtifactNodeIds(
  event: Extract<AgentExecutionContainerEvent, { type: "tool.completed" }>,
): string[] {
  const nodeIds = new Set<string>();
  for (const artifact of event.artifacts ?? []) {
    if (
      isRecord(artifact) &&
      typeof artifact.nodeId === "string" &&
      artifact.nodeId.trim()
    ) {
      nodeIds.add(artifact.nodeId);
    }
  }
  const outputNodeIds = event.output?.artifactNodeIds;
  if (Array.isArray(outputNodeIds)) {
    for (const nodeId of outputNodeIds) {
      if (typeof nodeId === "string" && nodeId.trim()) nodeIds.add(nodeId);
    }
  }
  return Array.from(nodeIds);
}

function mergeArtifactRefs(
  current: AgentExecutionArtifactRef[],
  nodeIds: string[],
): AgentExecutionArtifactRef[] {
  const seen = new Set(current.map((ref) => ref.nodeId));
  const next = [...current];
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    next.push({ nodeId });
  }
  return next;
}

function toArtifactRefs(
  nodeIds: string[] | undefined,
): AgentExecutionArtifactRef[] {
  return Array.from(new Set(nodeIds ?? [])).map((nodeId) => ({ nodeId }));
}

function summarizeObject(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return clampText(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function clampText(value: string): string {
  return value.length > MAX_TEXT_LENGTH
    ? value.slice(value.length - MAX_TEXT_LENGTH)
    : value;
}

function clampCanvasBody(value: string): string {
  return value.length > MAX_CANVAS_BODY_LENGTH
    ? `${value.slice(0, MAX_CANVAS_BODY_LENGTH)}...`
    : value;
}

function isReadableCanvasSummary(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return trimmed.length <= 180;
}

function dedupeConsecutiveLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (result.at(-1) === line) continue;
    result.push(line);
  }
  return result;
}

function formatTodoLine(todo: AgentExecutionContainerTodo): string {
  const activeForm = todo.activeForm ? `${todo.activeForm} · ` : "";
  return `待办：${getTodoStatusLabel(todo.status)} · ${activeForm}${todo.content}`;
}

function formatToolLine(tool: AgentExecutionContainerToolPart): string {
  const content = tool.outputSummary ?? tool.inputSummary;
  return [
    `工具 ${formatToolName(tool.toolName)}：${getPartStatusLabel(tool.status)}`,
    content,
  ]
    .filter(isUsefulText)
    .join(" · ");
}

function formatStreamLine(part: AgentExecutionContainerStreamPart): string {
  return [part.label, part.content].filter(isUsefulText).join("：");
}

function getTodoStatusLabel(
  status: AgentExecutionContainerTodo["status"],
): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "pending":
      return "待处理";
  }
}

function getPartStatusLabel(status: AgentExecutionContainerPartStatus): string {
  switch (status) {
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "paused":
      return "已暂停";
    case "running":
      return "进行中";
  }
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAgentExecutionContainerStreamPart(
  value: unknown,
): value is AgentExecutionContainerStreamPart {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.timestamp === "string" &&
    (record.status === "running" ||
      record.status === "done" ||
      record.status === "failed" ||
      record.status === "paused") &&
    (record.type === "stage" ||
      record.type === "thinking" ||
      record.type === "message" ||
      record.type === "tool" ||
      record.type === "artifact")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentExecutionContainerKind(
  value: unknown,
): value is AgentExecutionNodeKind {
  return (
    value === "input_node" ||
    value === "user_goal" ||
    value === "agent_run_node" ||
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

function isAgentExecutionContainerStatus(
  value: unknown,
): value is AgentExecutionStatus {
  return (
    value === "waiting" ||
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "paused"
  );
}
