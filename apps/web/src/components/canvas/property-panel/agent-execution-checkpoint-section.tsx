"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import { GitBranch, Play, RotateCcw } from "lucide-react";

import { cn } from "../../../lib/utils";
import { AgentExecutionActionButton } from "./agent-execution-action-button";

type CheckpointContinueIntent =
  | "continue"
  | "new_branch"
  | "rerun_checkpoint"
  | "rewrite"
  | "skip";

export function AgentExecutionCheckpointSection({
  execution,
  nodeId,
  onContinueFromNode,
}: {
  execution: AgentExecutionNodeMeta;
  nodeId: string;
  onContinueFromNode?: (
    nodeId: string,
    intent?: CheckpointContinueIntent,
  ) => void;
}) {
  if (execution.kind !== "checkpoint") return null;

  const checkpoint = execution.checkpoint;
  const canRestartFromHere = checkpoint?.canRestartFromHere === true;
  const restartReason = checkpoint?.restartReason?.trim();
  const rerunReason = canRestartFromHere
    ? onContinueFromNode
      ? undefined
      : "当前面板不能打开 Agent 输入框。"
    : "这个检查点没有标记为可从此处重跑。";
  const continueReason = onContinueFromNode
    ? undefined
    : "当前面板不能打开 Agent 输入框。";

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">检查点</div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-semibold",
            canRestartFromHere
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-muted text-muted-foreground",
          )}
        >
          {canRestartFromHere ? "可从此处恢复" : "仅记录进度"}
        </span>
      </div>

      {restartReason ? (
        <p className="mt-2 leading-5 text-muted-foreground">{restartReason}</p>
      ) : (
        <p className="mt-2 leading-5 text-muted-foreground">
          这个检查点已写入画布节点，可作为后续继续、分支或重跑的上下文锚点。
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <AgentExecutionActionButton
          disabled={!onContinueFromNode}
          icon={Play}
          label="从这里继续"
          onClick={() => onContinueFromNode?.(nodeId, "continue")}
          reason={continueReason}
        />
        <AgentExecutionActionButton
          disabled={!canRestartFromHere || !onContinueFromNode}
          icon={RotateCcw}
          label="从 checkpoint 重跑"
          onClick={() => onContinueFromNode?.(nodeId, "rerun_checkpoint")}
          reason={rerunReason}
        />
        <AgentExecutionActionButton
          disabled={!onContinueFromNode}
          icon={GitBranch}
          label="复制为新分支"
          onClick={() => onContinueFromNode?.(nodeId, "new_branch")}
          reason={continueReason}
        />
      </div>
    </div>
  );
}
