"use client";

import {
  type AgentExecutionNodeMeta,
  type AgentExecutionStatus,
  getAgentExecutionKindLabel,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import { Plus, X } from "lucide-react";

import type { CanvasSelectedElement } from "./canvas-editor";
import type {
  AgentContinuationMode,
  CanvasNodeReference,
} from "./chat-input-context";

type ChatCanvasContextStripProps = {
  agentContinuationMode: AgentContinuationMode;
  manualReferences: CanvasNodeReference[];
  onAddSelectionReferences: () => void;
  onModeChange: (mode: AgentContinuationMode) => void;
  onRemoveReference: (nodeId: string) => void;
  selectedCanvasElements?: CanvasSelectedElement[];
};

export function ChatCanvasContextStrip({
  agentContinuationMode,
  manualReferences,
  onAddSelectionReferences,
  onModeChange,
  onRemoveReference,
  selectedCanvasElements,
}: ChatCanvasContextStripProps) {
  const imageCount =
    selectedCanvasElements?.filter((element) => element.type === "image")
      .length ?? 0;
  const totalCount = selectedCanvasElements?.length ?? 0;
  const selectedAgentElement = selectedCanvasElements?.find(
    (element) => element.agentExecution,
  );
  const selectedAgentExecution = selectedAgentElement?.agentExecution;
  const shapeCount = totalCount - imageCount;
  const hasSelection = totalCount > 0;
  const alreadyReferencedCount =
    selectedCanvasElements?.filter((element) =>
      manualReferences.some((reference) => reference.nodeId === element.id),
    ).length ?? 0;
  const canAddReferences =
    hasSelection &&
    alreadyReferencedCount < (selectedCanvasElements?.length ?? 0);

  if (!hasSelection && manualReferences.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
      {selectedAgentExecution ? (
        <>
          <span
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground"
            title={getAgentExecutionContextTitle({
              action: "基于",
              execution: selectedAgentExecution,
              label: selectedAgentExecution.title,
              suffix: "继续",
            })}
          >
            <span className="shrink-0 text-muted-foreground">基于</span>
            <span className="truncate">
              {getAgentExecutionKindLabel(selectedAgentExecution.kind)} ·{" "}
              {selectedAgentExecution.title}
            </span>
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${getAgentExecutionStatusToneClass(selectedAgentExecution.status)}`}
            >
              {getAgentExecutionStatusLabel(selectedAgentExecution.status)}
            </span>
          </span>
          <div
            aria-label="节点继续方式"
            className="inline-flex shrink-0 rounded-md border border-border bg-background p-0.5"
          >
            <ModeButton
              active={agentContinuationMode === "new_branch"}
              label="新分支继续"
              onClick={() => onModeChange("new_branch")}
            />
            <ModeButton
              active={agentContinuationMode === "overwrite_current"}
              label="覆盖当前节点"
              onClick={() => onModeChange("overwrite_current")}
            />
          </div>
          <span
            className="text-[10px] text-muted-foreground/70"
            title={selectedAgentElement?.id}
          >
            {agentContinuationMode === "new_branch"
              ? "后续会保留原节点"
              : "后续会沿当前节点改写"}
          </span>
        </>
      ) : null}

      {hasSelection ? (
        <SelectionCountSummary
          imageCount={imageCount}
          shapeCount={shapeCount}
        />
      ) : null}

      <button
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canAddReferences}
        onClick={onAddSelectionReferences}
        title={
          canAddReferences
            ? "把当前画布选择加入本次 Agent 消息引用"
            : hasSelection
              ? "当前选择已经加入引用。"
              : "先在画布中选择节点。"
        }
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
        添加引用
      </button>

      {manualReferences.map((reference) => (
        <button
          className="inline-flex h-7 min-w-0 max-w-[260px] items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          key={reference.nodeId}
          onClick={() => onRemoveReference(reference.nodeId)}
          title={getManualReferenceTitle(reference)}
          type="button"
        >
          <span className="shrink-0 text-muted-foreground">引用</span>
          <span className="truncate">{reference.label}</span>
          {reference.agentExecution ? (
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${getManualReferenceStatusClass(reference.agentExecution.status)}`}
            >
              {getAgentExecutionKindLabel(reference.agentExecution.kind)} ·{" "}
              {getAgentExecutionStatusLabel(reference.agentExecution.status)}
            </span>
          ) : null}
          <X className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function getManualReferenceTitle(reference: CanvasNodeReference): string {
  const execution = reference.agentExecution;
  if (!execution) return `移除引用 ${reference.label}`;
  return getAgentExecutionContextTitle({
    action: "移除引用",
    execution,
    label: reference.label,
  });
}

function getAgentExecutionContextTitle({
  action,
  execution,
  label,
  suffix,
}: {
  action: string;
  execution:
    | AgentExecutionNodeMeta
    | NonNullable<CanvasNodeReference["agentExecution"]>;
  label: string;
  suffix?: string;
}): string {
  const details = [`${action} ${label}${suffix ? ` ${suffix}` : ""}`];
  details.push(
    `${getAgentExecutionKindLabel(execution.kind)} · ${getAgentExecutionStatusLabel(execution.status)}`,
  );
  const isDurableExecution = "schemaVersion" in execution;
  const failureReason = isDurableExecution
    ? execution.failure?.reason
    : execution.failureReason;
  const waitingPrompt = isDurableExecution
    ? execution.waitingForUser?.prompt
    : execution.waitingPrompt;
  const checkpointRestartReason = isDurableExecution
    ? execution.checkpoint?.restartReason
    : execution.checkpointRestartReason;
  const branchLabel = execution.branchLabel;
  if (failureReason) {
    details.push(`失败原因：${failureReason}`);
  }
  if (waitingPrompt) {
    details.push(`等待补充：${waitingPrompt}`);
  }
  if (checkpointRestartReason) {
    details.push(`重启锚点：${checkpointRestartReason}`);
  }
  if (branchLabel) {
    details.push(`分支：${branchLabel}`);
  }
  return details.join("；");
}

function getManualReferenceStatusClass(status: AgentExecutionStatus): string {
  return getAgentExecutionStatusToneClass(status);
}

function getAgentExecutionStatusToneClass(
  status: AgentExecutionStatus,
): string {
  switch (status) {
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "waiting":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "running":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "paused":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "done":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
}

function SelectionCountSummary({
  imageCount,
  shapeCount,
}: {
  imageCount: number;
  shapeCount: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {imageCount > 0 ? (
        <span className="flex items-center gap-1">
          <svg
            aria-hidden="true"
            className="h-3 w-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          {imageCount} {imageCount === 1 ? "image" : "images"}
        </span>
      ) : null}
      {imageCount > 0 && shapeCount > 0 ? (
        <span className="text-muted-foreground/40">&middot;</span>
      ) : null}
      {shapeCount > 0 ? (
        <span className="flex items-center gap-1">
          <svg
            aria-hidden="true"
            className="h-3 w-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          {shapeCount} {shapeCount === 1 ? "shape" : "shapes"}
        </span>
      ) : null}
      <span className="text-[10px] text-muted-foreground/60">
        selected on canvas
      </span>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`h-6 rounded px-2 text-[11px] font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
