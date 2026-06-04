"use client";

import {
  type AgentExecutionNodeMeta,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { MessageCircle, Sparkles } from "lucide-react";

import type {
  AgentExecutionContinueIntent,
  AgentExecutionContinueOptions,
} from "./property-panel/agent-execution-section";

export type AgentExecutionFollowUpState = {
  disabled: boolean;
  disabledReason?: string;
  kindLabel: string;
  label: string;
  nodeId: string;
  statusLabel: string;
  title: string;
  x: number;
  y: number;
};

export function getAgentExecutionFollowUpState(
  node: PenNode | null | undefined,
  position: { x: number; y: number },
  canContinue: boolean,
): AgentExecutionFollowUpState | null {
  const execution = getAgentExecutionMeta(node);
  if (!node || !execution) return null;
  return {
    disabled: !canContinue,
    disabledReason: canContinue
      ? undefined
      : "当前画布没有接入 Agent 输入框，不能从这个节点继续追问。",
    kindLabel: getAgentExecutionKindLabel(execution.kind),
    label: getAgentExecutionFollowUpLabel(execution),
    nodeId: node.id,
    statusLabel: getAgentExecutionStatusLabel(execution.status),
    title: execution.title,
    x: position.x,
    y: position.y,
  };
}

export function AgentExecutionFollowUpPill({
  followUp,
  onContinueAgentExecution,
}: {
  followUp: AgentExecutionFollowUpState | null;
  onContinueAgentExecution?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
}) {
  if (!followUp) return null;
  return (
    <button
      aria-label={`Agent 节点继续追问：${followUp.title}`}
      className="pointer-events-auto absolute z-30 flex h-9 -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-3 text-xs font-semibold text-foreground shadow-card ring-1 ring-foreground/5 backdrop-blur-lg transition-all duration-150 hover:-translate-y-0.5 hover:bg-background hover:shadow-card-hover disabled:cursor-not-allowed disabled:opacity-50 motion-safe:animate-[bounce-dot_2.8s_ease-in-out_infinite]"
      data-canvas-overlay="agent-follow-up-pill"
      disabled={followUp.disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (followUp.disabled) return;
        onContinueAgentExecution?.(followUp.nodeId, "continue");
        console.info("[skia-canvas] agent_execution.follow_up", {
          nodeId: followUp.nodeId,
        });
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      style={{
        left: followUp.x,
        top: followUp.y + 16,
      }}
      title={
        followUp.disabled
          ? followUp.disabledReason
          : `基于 ${followUp.kindLabel} · ${followUp.statusLabel} 继续追问`
      }
      type="button"
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-card animate-pulse" />
      </span>
      <span className="max-w-28 truncate">{followUp.label}</span>
      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function getAgentExecutionFollowUpLabel(
  execution: AgentExecutionNodeMeta,
): string {
  if (execution.status === "failed") return "修复失败";
  if (execution.kind === "ask_user_more") return "继续补充";
  if (execution.kind === "variant_branch") return "继续深化";
  if (execution.kind === "checkpoint") return "从这里继续";
  return "继续追问";
}
