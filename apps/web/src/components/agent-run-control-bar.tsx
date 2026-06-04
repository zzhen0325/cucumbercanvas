"use client";

import {
  Eye,
  type LucideIcon,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  getAgentExecutionKindLabel,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";
import { AgentRunTracePanel } from "./agent-run-trace-panel";
import type { CanvasSelectedElement } from "./canvas-editor";
import { formatAgentFailureReason } from "./canvas/agent-execution-failure-copy";

export type AgentRunControlState = {
  activeRunId?: string;
  canceling?: boolean;
  pausing?: boolean;
  streaming: boolean;
};

type AgentRunControlBarProps = {
  runState: AgentRunControlState;
  selectedCanvasElements?: CanvasSelectedElement[];
  onContinueFromSelection?: (
    nodeId: string,
    intent?: "continue" | "rerun_checkpoint",
  ) => void;
  onPauseRun?: () => void;
  onStopRun?: () => void;
  traceEvents?: StreamEvent[];
};

const RUN_TRACE_REASON = "当前没有可查看的执行记录。";

export function AgentRunControlBar({
  onContinueFromSelection,
  onPauseRun,
  onStopRun,
  runState,
  selectedCanvasElements,
  traceEvents,
}: AgentRunControlBarProps) {
  const [traceOpen, setTraceOpen] = useState(false);
  const selectedAgentElement = selectedCanvasElements?.find(
    (element) => element.agentExecution,
  );
  const execution = selectedAgentElement?.agentExecution;
  const targetRunId = runState.activeRunId ?? execution?.runId;
  const visibleTraceEvents = useMemo(
    () =>
      (traceEvents ?? [])
        .filter((event) => !targetRunId || event.runId === targetRunId)
        .slice(-30),
    [targetRunId, traceEvents],
  );

  const waitingState = getWaitingState(execution);
  const failureReason = execution?.failure?.reason
    ? formatAgentFailureReason(execution.failure.reason)
    : undefined;
  const checkpointRerunScope = getCheckpointRerunScope(execution);
  const pausedContinuationState = getPausedContinuationState(execution);
  const statusText = runState.canceling
    ? "正在停止"
    : runState.pausing
      ? "正在暂停"
      : runState.streaming
        ? "运行中"
        : execution
          ? getAgentExecutionStatusLabel(execution.status)
          : "空闲";
  const pauseDisabledReason = runState.pausing
    ? "正在暂停当前任务。"
    : runState.streaming && onPauseRun
      ? undefined
      : "当前没有正在运行的任务。";
  const stopDisabledReason =
    runState.streaming && onStopRun ? undefined : "当前没有正在运行的任务。";
  const continueDisabledReason = !selectedAgentElement
    ? "先选中一个 Agent 执行节点。"
    : runState.streaming || runState.canceling || runState.pausing
      ? "当前任务仍在运行，等待它停止或完成后再继续。"
      : onContinueFromSelection
        ? undefined
        : "当前页面暂时不能继续生成。";
  const checkpointRerunDisabledReason =
    execution?.kind !== "checkpoint"
      ? "先选中一个保存点。"
      : execution.checkpoint?.canRestartFromHere !== true
        ? "这个保存点还不能从此处重跑。"
        : runState.streaming || runState.canceling || runState.pausing
          ? "当前任务仍在运行，等待它停止或完成后再从保存点重跑。"
          : onContinueFromSelection
            ? undefined
            : "当前页面暂时不能继续生成。";
  const traceDisabledReason =
    visibleTraceEvents.length > 0 || execution ? undefined : RUN_TRACE_REASON;

  if (!runState.streaming && !execution) return null;

  return (
    <div className="pointer-events-auto relative">
      <div
        className="flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs text-foreground shadow-card ring-1 ring-foreground/5 backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        aria-label="Agent 任务控制条"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              runState.streaming
                ? "bg-blue-500 animate-[pulse_1.2s_ease-in-out_infinite]"
                : execution?.status === "failed"
                  ? "bg-destructive"
                  : execution?.status === "waiting"
                    ? "bg-amber-500"
                    : "bg-muted-foreground"
            }`}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-semibold">{statusText}</span>
            </div>
            {execution ? (
              <div
                className="mt-0.5 max-w-[420px] truncate text-[11px] text-muted-foreground"
                title={`${getAgentExecutionKindLabel(execution.kind)} · ${execution.title}`}
              >
                {getAgentExecutionKindLabel(execution.kind)} · {execution.title}
              </div>
            ) : null}
            {waitingState ? (
              <div
                className="mt-0.5 max-w-[520px] truncate text-[11px] text-amber-700"
                title={waitingState.title}
              >
                {waitingState.summary}
              </div>
            ) : null}
            {failureReason ? (
              <div
                className="mt-0.5 max-w-[520px] truncate text-[11px] text-destructive"
                title={failureReason}
              >
                失败原因：{failureReason}
              </div>
            ) : null}
            {checkpointRerunScope ? (
              <div
                className="mt-0.5 max-w-[520px] truncate text-[11px] text-muted-foreground"
                title={checkpointRerunScope.title}
              >
                {checkpointRerunScope.summary}
              </div>
            ) : null}
            {pausedContinuationState ? (
              <div
                className="mt-0.5 max-w-[520px] truncate text-[11px] text-muted-foreground"
                title={pausedContinuationState.title}
              >
                {pausedContinuationState.summary}
              </div>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ControlButton
            disabled={Boolean(pauseDisabledReason)}
            icon={Pause}
            label={runState.pausing ? "暂停中" : "暂停"}
            onClick={onPauseRun}
            reason={pauseDisabledReason}
          />
          <ControlButton
            disabled={Boolean(continueDisabledReason)}
            icon={Play}
            label={pausedContinuationState ? "从暂停点继续" : "继续"}
            onClick={() => {
              if (selectedAgentElement) {
                onContinueFromSelection?.(selectedAgentElement.id);
              }
            }}
            reason={continueDisabledReason}
          />
          <ControlButton
            disabled={Boolean(stopDisabledReason)}
            icon={Square}
            label={runState.canceling ? "停止中" : "停止"}
            onClick={onStopRun}
            reason={stopDisabledReason}
          />
          <ControlButton
            disabled={Boolean(checkpointRerunDisabledReason)}
            icon={RotateCcw}
            label="从保存点重跑"
            onClick={() => {
              if (selectedAgentElement) {
                onContinueFromSelection?.(
                  selectedAgentElement.id,
                  "rerun_checkpoint",
                );
              }
            }}
            reason={checkpointRerunDisabledReason}
          />
          <ControlButton
            disabled={Boolean(traceDisabledReason)}
            icon={Eye}
            label="查看执行记录"
            onClick={() => setTraceOpen((open) => !open)}
            reason={traceDisabledReason}
          />
        </div>
      </div>
      {traceOpen && !traceDisabledReason ? (
        <AgentRunTracePanel
          events={visibleTraceEvents}
          runId={targetRunId}
          selectedElement={selectedAgentElement}
        />
      ) : null}
    </div>
  );
}

function getWaitingState(
  execution: NonNullable<CanvasSelectedElement["agentExecution"]> | undefined,
): { summary: string; title: string } | undefined {
  const waiting = execution?.waitingForUser;
  if (!waiting?.prompt) return undefined;
  const submittedText = waiting.response?.text?.trim();
  const attachmentCount = waiting.response?.attachmentCount ?? 0;
  const details = [`等待用户输入：${waiting.prompt}`];
  if (waiting.acceptsFiles) {
    details.push("可补充文件/图片");
  }
  if (submittedText) {
    details.push(`已提交：${submittedText}`);
  }
  if (attachmentCount > 0) {
    details.push(`已补充 ${attachmentCount} 个文件/图片`);
  }
  return {
    summary: details.join(" · "),
    title: details.join("；"),
  };
}

function getCheckpointRerunScope(
  execution: NonNullable<CanvasSelectedElement["agentExecution"]> | undefined,
): { summary: string; title: string } | undefined {
  if (
    execution?.kind !== "checkpoint" ||
    execution.checkpoint?.canRestartFromHere !== true
  ) {
    return undefined;
  }
  const downstreamNodeIds = execution.downstreamNodeIds ?? [];
  if (!downstreamNodeIds.length) {
    return {
      summary: "从保存点重跑前，会先检查当前画布上的后续内容。",
      title: "这个保存点没有记录后续内容；重跑前会先检查当前画布。",
    };
  }
  return {
    summary: `从保存点重跑将重建 ${downstreamNodeIds.length} 个后续结果。`,
    title: `将重建 ${downstreamNodeIds.length} 个后续结果。`,
  };
}

function getPausedContinuationState(
  execution: NonNullable<CanvasSelectedElement["agentExecution"]> | undefined,
): { summary: string; title: string } | undefined {
  if (execution?.status !== "paused") return undefined;
  const restartReason = execution.checkpoint?.restartReason?.trim();
  const title = [
    "选中的 Agent 执行节点已暂停。",
    "继续会读取当前画布并开启新的生成任务。",
    restartReason ? `暂停/重启说明：${restartReason}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return {
    summary: "已暂停：从此处继续会读取当前画布并开启新的生成任务。",
    title,
  };
}

function ControlButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  reason,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  reason?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? reason : label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
