"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "../../../lib/utils";
import { formatAgentFailureReason } from "../agent-execution-failure-copy";

type AgentExecutionDetailsSectionProps = {
  detailsOpen: boolean;
  execution: AgentExecutionNodeMeta;
  onToggle: () => void;
};

export function AgentExecutionDetailsSection({
  detailsOpen,
  execution,
  onToggle,
}: AgentExecutionDetailsSectionProps) {
  const collapsedSummary = getCollapsedResultSummary(execution);
  return (
    <div className="mb-3 rounded-lg border border-border bg-background">
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between px-3 text-left text-xs font-medium text-foreground"
        aria-expanded={detailsOpen}
        onClick={onToggle}
      >
        <span>执行详情</span>
        {detailsOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {detailsOpen ? (
        <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
          <DetailBlock label="工具" value={execution.toolName} />
          <DetailBlock label="输入" value={execution.details?.inputSummary} />
          <DetailBlock label="输出" value={execution.details?.outputSummary} />
          <DetailBlock
            label="简要推理"
            value={execution.details?.reasoningSummary}
          />
          <DetailBlock
            label="错误原因"
            tone="danger"
            value={
              execution.details?.errorReason || execution.failure?.reason
                ? formatAgentFailureReason(
                    execution.details?.errorReason ?? execution.failure?.reason,
                  )
                : undefined
            }
          />
          {!execution.toolName &&
          !execution.details?.inputSummary &&
          !execution.details?.outputSummary &&
          !execution.details?.reasoningSummary &&
          !execution.details?.errorReason &&
          !execution.failure?.reason ? (
            <p className="text-muted-foreground">
              这个节点还没有记录工具输入、输出或错误详情。
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border-t border-border px-3 py-2 text-xs">
          <DetailBlock
            label={collapsedSummary.tone === "danger" ? "失败原因" : "结果摘要"}
            tone={collapsedSummary.tone}
            value={collapsedSummary.text}
          />
        </div>
      )}
    </div>
  );
}

function getCollapsedResultSummary(execution: AgentExecutionNodeMeta): {
  text: string;
  tone?: "danger";
} {
  if (execution.details?.outputSummary?.trim()) {
    return { text: execution.details.outputSummary };
  }
  if (execution.failure?.reason?.trim()) {
    return {
      text: formatAgentFailureReason(execution.failure.reason),
      tone: "danger",
    };
  }
  if (execution.details?.errorReason?.trim()) {
    return {
      text: formatAgentFailureReason(execution.details.errorReason),
      tone: "danger",
    };
  }
  if (execution.summary?.trim()) {
    return { text: execution.summary };
  }
  return { text: "这个节点还没有记录结果摘要。" };
}

function DetailBlock({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "danger";
  value?: string;
}) {
  if (!value?.trim()) return null;
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 whitespace-pre-wrap leading-5 text-foreground",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}
