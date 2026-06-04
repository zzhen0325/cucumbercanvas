"use client";

import {
  getAgentExecutionKindLabel,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";
import { useState } from "react";

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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const execution = selectedElement?.agentExecution;
  const toolEvents = events.filter(
    (event) => event.type === "tool.started" || event.type === "tool.completed",
  );
  const patchEvents = events.filter((event) => event.type === "canvas.patch");

  return (
    <div
      className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-card ring-1 ring-foreground/5"
      aria-label="Agent 执行记录"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <div className="font-semibold">执行记录</div>
          <div className="truncate text-[11px] text-muted-foreground">
            已记录 {events.length} 条活动
          </div>
        </div>
        <div className="flex shrink-0 gap-2 text-[11px] text-muted-foreground">
          <span>{toolEvents.length} 次工具调用</span>
          <span>{patchEvents.length} 次画布更新</span>
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
              `前置内容 ${execution.upstreamNodeIds?.length ?? 0}`,
              `后续结果 ${execution.downstreamNodeIds?.length ?? 0}`,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ")}
          >
            前置内容 {execution.upstreamNodeIds?.length ?? 0} · 后续结果{" "}
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
          当前还没有收到实时活动；仍可从选中内容查看已保存的执行上下文。
        </div>
      )}
      <button
        type="button"
        className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-expanded={diagnosticsOpen}
        onClick={() => setDiagnosticsOpen((open) => !open)}
      >
        {diagnosticsOpen ? "收起高级诊断" : "显示高级诊断"}
      </button>
      {diagnosticsOpen ? (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-[10px] leading-5 text-muted-foreground">
          {runId ? <div>runId: {runId}</div> : null}
          {selectedElement ? <div>nodeId: {selectedElement.id}</div> : null}
          {events.map((event, index) => (
            <div
              key={`${event.runId}:${event.timestamp}:${event.type}:diag:${index}`}
            >
              {formatDiagnosticEvent(event)}
            </div>
          ))}
        </div>
      ) : null}
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
      return "任务已开始";
    case "run.completed":
      return "任务已完成";
    case "run.canceled":
      return "任务已停止";
    case "run.paused":
      return "任务已暂停";
    case "run.failed":
      return "任务失败";
    case "tool.started":
      return `开始处理 · ${formatToolName(event.toolName)}`;
    case "tool.completed":
      return `处理完成 · ${formatToolName(event.toolName)}`;
    case "canvas.patch":
      return "画布已更新";
    case "message.delta":
      return "回复生成中";
    case "thinking.delta":
      return "正在思考";
    case "canvas.sync":
      return "画布已同步";
    case "agent.stage":
      return "执行阶段更新";
    case "run.context":
      return "上下文已读取";
  }
}

function traceEventDetail(event: StreamEvent): string {
  switch (event.type) {
    case "tool.started":
      return "正在调用相关能力。";
    case "tool.completed":
      return "相关能力已完成。";
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
      return "执行状态已更新。";
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
    ? `，影响 ${affectedNodeIds.length} 个对象`
    : "";
  return `更新了 ${event.operations.length} 项内容${nodeSummary}`;
}

function formatDiagnosticEvent(event: StreamEvent): string {
  const details = [
    event.timestamp,
    event.type,
    "runId" in event ? event.runId : undefined,
    "toolCallId" in event ? event.toolCallId : undefined,
    "transactionId" in event ? event.transactionId : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.join(" | ");
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
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
