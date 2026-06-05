import type {
  AgentExecutionArtifactRef,
  AgentExecutionContainer,
  AgentExecutionContainerPartStatus,
  AgentExecutionContainerTodo,
  AgentExecutionContainerToolPart,
} from "./agent-execution-container.js";
import type { AgentExecutionStatus } from "./agent-execution.js";

export type AgentRunNodeToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export interface AgentRunNodeReasoningViewModel {
  content: string;
  isStreaming: boolean;
}

export interface AgentRunNodeMessageViewModel {
  content: string;
  id: string;
  isStreaming: boolean;
}

export interface AgentRunNodeToolViewModel {
  errorText?: string;
  id: string;
  input?: Record<string, unknown>;
  inputMissingReason?: string;
  output?: Record<string, unknown>;
  outputMissingReason?: string;
  outputSummary?: string;
  state: AgentRunNodeToolState;
  toolCallId: string;
  toolName: string;
  type: `tool-${string}`;
}

export interface AgentRunNodeTaskViewModel {
  active: boolean;
  description?: string;
  id: string;
  status: AgentExecutionContainerTodo["status"];
  title: string;
}

export interface AgentRunNodeViewModel {
  artifacts: AgentExecutionArtifactRef[];
  failureReason?: string;
  messages: AgentRunNodeMessageViewModel[];
  reasoning?: AgentRunNodeReasoningViewModel;
  status: AgentExecutionStatus;
  summary?: string;
  tasks: AgentRunNodeTaskViewModel[];
  title: string;
  tools: AgentRunNodeToolViewModel[];
}

const MISSING_TOOL_INPUT_REASON =
  "没有记录工具参数，可能是早期运行事件缺少结构化 input。";
const MISSING_TOOL_OUTPUT_REASON = "没有记录工具结果详情，只收到工具摘要。";

export function getAgentRunNodeViewModel(
  container: AgentExecutionContainer,
): AgentRunNodeViewModel {
  const reasoningParts = container.streamParts.filter(
    (part) => part.type === "thinking" && isUsefulText(part.content),
  );
  const reasoningContent = reasoningParts
    .map((part) => part.content?.trim())
    .filter(isUsefulText)
    .join("\n\n");
  const messages = container.streamParts
    .filter((part) => part.type === "message" && isUsefulText(part.content))
    .map((part) => ({
      content: part.content?.trim() ?? "",
      id: part.id,
      isStreaming: container.status === "running" && part.status === "running",
    }));
  const toolParts = dedupeToolParts(container.toolParts);
  const toolOutputMessages = toolParts
    .filter((tool) => isReadableToolOutputMessage(tool.outputSummary))
    .filter(
      (tool) =>
        !messages.some((message) => message.content === tool.outputSummary),
    )
    .map((tool) => ({
      content: tool.outputSummary?.trim() ?? "",
      id: `tool-output:${tool.toolCallId}`,
      isStreaming: false,
    }));

  return {
    artifacts: container.artifactRefs,
    ...(container.failure?.reason
      ? { failureReason: container.failure.reason }
      : {}),
    messages: [...messages, ...toolOutputMessages],
    ...(reasoningContent
      ? {
          reasoning: {
            content: reasoningContent,
            isStreaming:
              container.status === "running" &&
              reasoningParts.some((part) => part.status === "running"),
          },
        }
      : {}),
    status: container.status,
    ...(container.summary ? { summary: container.summary } : {}),
    tasks: container.todos.map(toTaskViewModel),
    title: container.title,
    tools: toolParts.map(toToolViewModel),
  };
}

function toTaskViewModel(
  todo: AgentExecutionContainerTodo,
  index: number,
): AgentRunNodeTaskViewModel {
  return {
    active: todo.status === "in_progress",
    ...(todo.activeForm ? { description: todo.activeForm } : {}),
    id: `todo:${index}:${todo.content}`,
    status: todo.status,
    title: todo.content,
  };
}

function toToolViewModel(
  tool: AgentExecutionContainerToolPart,
): AgentRunNodeToolViewModel {
  const state = getToolState(tool.status, tool.errorText);
  const input = normalizeToolRecord(tool.input);
  const output = normalizeToolRecord(tool.output);
  return {
    ...(tool.errorText ? { errorText: tool.errorText } : {}),
    id: tool.id,
    ...(input ? { input } : {}),
    ...(!input ? { inputMissingReason: MISSING_TOOL_INPUT_REASON } : {}),
    ...(output ? { output } : {}),
    ...(!tool.output &&
    !tool.errorText &&
    (tool.status === "done" || tool.status === "failed")
      ? { outputMissingReason: MISSING_TOOL_OUTPUT_REASON }
      : {}),
    ...(tool.outputSummary ? { outputSummary: tool.outputSummary } : {}),
    state,
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    type: `tool-${tool.toolName}`,
  };
}

function getToolState(
  status: AgentExecutionContainerPartStatus,
  errorText: string | undefined,
): AgentRunNodeToolState {
  if (errorText || status === "failed") return "output-error";
  if (status === "done") return "output-available";
  return status === "running" ? "input-available" : "input-streaming";
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadableToolOutputMessage(value: unknown): value is string {
  if (!isUsefulText(value)) return false;
  const trimmed = value.trim();
  return !trimmed.startsWith("{") && !trimmed.startsWith("[");
}

function dedupeToolParts(
  tools: AgentExecutionContainerToolPart[],
): AgentExecutionContainerToolPart[] {
  const byIdentity = new Map<string, AgentExecutionContainerToolPart>();
  for (const tool of tools) {
    const key = `${tool.toolName}:${stableStringify(
      normalizeToolRecord(tool.input) ?? tool.inputSummary ?? tool.toolCallId,
    )}`;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, tool);
      continue;
    }
    if (existing.status === "running" && tool.status !== "running") {
      byIdentity.set(key, tool);
      continue;
    }
    if (tool.timestamp >= existing.timestamp) byIdentity.set(key, tool);
  }
  return Array.from(byIdentity.values());
}

function normalizeToolRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value);
  if (
    entries.length === 1 &&
    (entries[0]?.[0] === "input" || entries[0]?.[0] === "output") &&
    typeof entries[0]?.[1] === "string"
  ) {
    const parsed = parseJsonString(entries[0][1]);
    if (isRecord(parsed)) return normalizeToolRecord(parsed);
  }
  return Object.fromEntries(
    entries.map(([key, entryValue]) => [
      key,
      typeof entryValue === "string"
        ? (parseJsonString(entryValue) ?? entryValue)
        : entryValue,
    ]),
  );
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
