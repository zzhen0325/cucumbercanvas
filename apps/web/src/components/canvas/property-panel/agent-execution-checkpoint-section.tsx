"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";

import { cn } from "../../../lib/utils";

export function AgentExecutionCheckpointSection({
  execution,
}: {
  execution: AgentExecutionNodeMeta;
}) {
  if (execution.kind !== "checkpoint") return null;

  const checkpoint = execution.checkpoint;
  const canRestartFromHere = checkpoint?.canRestartFromHere === true;
  const restartReason = checkpoint?.restartReason?.trim();

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">保存点</div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-semibold",
            canRestartFromHere
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-muted text-muted-foreground",
          )}
        >
          {canRestartFromHere ? "重启信息已记录" : "仅记录进度"}
        </span>
      </div>

      {restartReason ? (
        <p className="mt-2 leading-5 text-muted-foreground">{restartReason}</p>
      ) : (
        <p className="mt-2 leading-5 text-muted-foreground">
          这个保存点用于标记当前执行进度。
        </p>
      )}
    </div>
  );
}
