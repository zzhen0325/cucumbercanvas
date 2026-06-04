"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import {
  AlertTriangle,
  GitBranch,
  PencilLine,
  RotateCcw,
  SkipForward,
} from "lucide-react";

import {
  formatAgentFailureListItem,
  formatAgentFailureReason,
} from "../agent-execution-failure-copy";
import { AgentExecutionActionButton } from "./agent-execution-action-button";

type FailedNodeRecoveryIntent = "retry" | "rewrite" | "skip" | "new_branch";

type AgentExecutionFailureRecoverySectionProps = {
  execution: AgentExecutionNodeMeta;
  nodeId: string;
  onContinueFromNode?: (
    nodeId: string,
    intent?: FailedNodeRecoveryIntent,
  ) => void;
};

export function AgentExecutionFailureRecoverySection({
  execution,
  nodeId,
  onContinueFromNode,
}: AgentExecutionFailureRecoverySectionProps) {
  const failure = execution.failure;
  if (!failure) return null;

  const disabledReason = "当前面板不能打开 Agent 输入框。";
  const actionDisabled = !onContinueFromNode;

  return (
    <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{formatAgentFailureListItem(failure.step)}</span>
      </div>
      <p className="mt-1 leading-5">
        {formatAgentFailureReason(failure.reason)}
      </p>
      {failure.attempted?.length ? (
        <div className="mt-2 text-destructive/85">
          <div className="font-medium">Agent 尝试过</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {failure.attempted.map((item) => (
              <li key={item}>{formatAgentFailureListItem(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure.nextActions?.length ? (
        <div className="mt-2 text-destructive/85">
          <div className="font-medium">用户可以做</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {failure.nextActions.map((item) => (
              <li key={item}>{formatAgentFailureListItem(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <AgentExecutionActionButton
          disabled={actionDisabled}
          icon={RotateCcw}
          label="重试此步骤"
          onClick={() => onContinueFromNode?.(nodeId, "retry")}
          reason={disabledReason}
        />
        <AgentExecutionActionButton
          disabled={actionDisabled}
          icon={PencilLine}
          label="改写输入后继续"
          onClick={() => onContinueFromNode?.(nodeId, "rewrite")}
          reason={disabledReason}
        />
        <AgentExecutionActionButton
          disabled={actionDisabled}
          icon={SkipForward}
          label="跳过此步骤"
          onClick={() => onContinueFromNode?.(nodeId, "skip")}
          reason={disabledReason}
        />
        <AgentExecutionActionButton
          disabled={actionDisabled}
          icon={GitBranch}
          label="新建分支尝试"
          onClick={() => onContinueFromNode?.(nodeId, "new_branch")}
          reason={disabledReason}
        />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-destructive/75">
        这些操作会打开 Agent 输入框，保留失败节点、上下游和恢复历史作为上下文。
      </p>
    </div>
  );
}
