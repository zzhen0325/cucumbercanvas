"use client";

import {
  getAgentExecutionKindLabel,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";

import type { CanvasSelectedElement } from "./canvas-editor";
import { formatAgentFailureReason } from "./canvas/agent-execution-failure-copy";

type AgentRunTracePanelProps = {
  events: StreamEvent[];
  runId?: string;
  selectedElement?: CanvasSelectedElement;
};

export function AgentRunTracePanel({
  events,
  runId,
  selectedElement,
}: AgentRunTracePanelProps) {
  const execution = selectedElement?.agentExecution;
  const toolEvents = events.filter(
    (event) => event.type === "tool.started" || event.type === "tool.completed",
  );
  const patchEvents = events.filter((event) => event.type === "canvas.patch");

  return (
    <div
      className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-card ring-1 ring-foreground/5"
      aria-label="Agent run trace"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <div className="font-semibold">Run trace</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {runId ?? "未绑定 run"} · {events.length} 个事件
          </div>
        </div>
        <div className="flex shrink-0 gap-2 text-[11px] text-muted-foreground">
          <span>{toolEvents.length} tools</span>
          <span>{patchEvents.length} patches</span>
        </div>
      </div>
      {execution ? (
        <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
          <div className="font-medium">
            {getAgentExecutionKindLabel(execution.kind)} · {execution.title}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {getAgentExecutionStatusLabel(execution.status)}
            {execution.toolName ? ` · ${execution.toolName}` : ""}
          </div>
          <div
            className="mt-1 truncate text-[11px] text-muted-foreground"
            title={[
              `画布节点 ${selectedElement.id}`,
              execution.runId ? `run ${execution.runId}` : undefined,
              `上游 ${execution.upstreamNodeIds?.length ?? 0}`,
              `下游 ${execution.downstreamNodeIds?.length ?? 0}`,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ")}
          >
            画布节点 {selectedElement.id} · 上游{" "}
            {execution.upstreamNodeIds?.length ?? 0} · 下游{" "}
            {execution.downstreamNodeIds?.length ?? 0}
          </div>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
          {events.map((event, index) => (
            <TraceEventRow
              event={event}
              key={`${event.runId}:${event.timestamp}:${event.type}:${index}`}
            />
          ))}
        </div>
      ) : (
        <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-muted-foreground">
          当前没有收到该 run 的实时事件；仍可从选中节点查看持久化执行上下文。
        </div>
      )}
    </div>
  );
}

function TraceEventRow({ event }: { event: StreamEvent }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <span className="text-[11px] text-muted-foreground">
        {formatTraceTime(event.timestamp)}
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{traceEventTitle(event)}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {traceEventDetail(event)}
        </div>
      </div>
    </div>
  );
}

function traceEventTitle(event: StreamEvent): string {
  switch (event.type) {
    case "run.started":
      return "Run started";
    case "run.completed":
      return "Run completed";
    case "run.canceled":
      return "Run canceled";
    case "run.paused":
      return "Run paused";
    case "run.failed":
      return "Run failed";
    case "tool.started":
      return `Tool started · ${event.toolName}`;
    case "tool.completed":
      return `Tool completed · ${event.toolName}`;
    case "canvas.patch":
      return "Canvas patch";
    case "message.delta":
      return "Message delta";
    case "thinking.delta":
      return "Thinking delta";
    case "canvas.sync":
      return "Canvas sync";
    case "agent.stage":
      return "Agent stage";
    case "run.context":
      return "Run context";
  }
}

function traceEventDetail(event: StreamEvent): string {
  switch (event.type) {
    case "tool.started":
    case "tool.completed":
      return event.toolCallId;
    case "canvas.patch":
      return formatCanvasPatchTraceDetail(event);
    case "run.failed":
      return formatAgentFailureReason(event.error.message);
    case "run.paused":
      return event.reason ?? event.runId;
    case "message.delta":
    case "thinking.delta":
      return event.delta;
    default:
      return event.runId;
  }
}

function formatCanvasPatchTraceDetail(
  event: Extract<StreamEvent, { type: "canvas.patch" }>,
): string {
  const affectedNodeIds = Array.from(
    new Set(
      event.operations
        .flatMap((operation) => getCanvasPatchOperationNodeIds(operation))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    ),
  );
  const nodeSummary = affectedNodeIds.length
    ? ` · ${affectedNodeIds.slice(0, 4).join("、")}${
        affectedNodeIds.length > 4 ? ` 等 ${affectedNodeIds.length} 个节点` : ""
      }`
    : "";
  return `${event.transactionId} · ${event.operations.length} operations${nodeSummary}`;
}

function getCanvasPatchOperationNodeIds(operation: unknown): string[] {
  if (!isRecord(operation)) return [];
  const nodeIds: string[] = [];
  if (typeof operation.nodeId === "string") nodeIds.push(operation.nodeId);
  if (isRecord(operation.node) && typeof operation.node.id === "string") {
    nodeIds.push(operation.node.id);
  }
  if (Array.isArray(operation.selection)) {
    nodeIds.push(
      ...operation.selection.filter(
        (nodeId): nodeId is string => typeof nodeId === "string",
      ),
    );
  }
  return nodeIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTraceTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
