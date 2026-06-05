"use client";

import {
  type AgentExecutionNodeMeta,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { Copy, FilePlus, GitBranch, Play, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../../lib/utils";
import { getAgentWaitingResponseSubmittedUpdates } from "../agent-waiting-response-writeback";
import { AgentComparisonBranchCards } from "./agent-comparison-branch-cards";
import { AgentExecutionActionButton } from "./agent-execution-action-button";
import { AgentExecutionChainSection } from "./agent-execution-chain-section";
import { AgentExecutionCheckpointSection } from "./agent-execution-checkpoint-section";
import { AgentExecutionCritiqueSection } from "./agent-execution-critique-section";
import { AgentExecutionDetailsSection } from "./agent-execution-details-section";
import { AgentExecutionEvidenceSection } from "./agent-execution-evidence-section";
import { AgentExecutionFailureRecoverySection } from "./agent-execution-failure-recovery-section";
import { AgentVariantBranchDetails } from "./agent-variant-branch-details";

type AgentExecutionSectionProps = {
  node: PenNode;
  pageNodes?: PenNode[];
  onContinueFromNode?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
  onSelectVariantBranch?: (branchNodeId: string) => void;
  onSelectExecutionNode?: (nodeId: string) => void;
  selectVariantBranchReason?: string;
  onUpdate?: (updates: Partial<PenNode>) => void;
};

export type AgentExecutionContinueIntent =
  | "continue"
  | "attach_files"
  | "new_branch"
  | "retry"
  | "rerun_checkpoint"
  | "rewrite"
  | "skip";

export type AgentExecutionContinueOptions = {
  continuationTargetElement?: {
    agentExecution: AgentExecutionNodeMeta;
    height: number;
    id: string;
    text?: string;
    type: string;
    width: number;
    x: number;
    y: number;
  };
  waitingResponseText?: string;
};

export function AgentExecutionSection({
  node,
  pageNodes,
  onContinueFromNode,
  onSelectExecutionNode,
  onSelectVariantBranch,
  selectVariantBranchReason,
  onUpdate,
}: AgentExecutionSectionProps) {
  const execution = getAgentExecutionMeta(node);
  const [copied, setCopied] = useState<"node" | "run" | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(
    execution?.kind === "task_step" ||
      execution?.kind === "tool_call" ||
      execution?.kind === "ask_user_more" ||
      execution?.status === "failed",
  );
  const [waitingResponse, setWaitingResponse] = useState(
    execution?.waitingForUser?.response?.text ?? "",
  );

  useEffect(() => {
    setWaitingResponse(execution?.waitingForUser?.response?.text ?? "");
  }, [execution?.waitingForUser?.response?.text]);

  const detailRows = useMemo(() => {
    if (!execution) return [];
    return [
      ["节点类型", getAgentExecutionKindLabel(execution.kind)],
      ["状态", getAgentExecutionStatusLabel(execution.status)],
      ["执行方式", execution.toolName],
    ].filter((row): row is [string, string] => Boolean(row[1]));
  }, [execution]);

  const copyText = useCallback(
    async (kind: "node" | "run", value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(kind);
        window.setTimeout(() => setCopied(null), 1200);
        console.info("[canvas-property-panel] agent_execution.copy", {
          kind,
          nodeId: node.id,
        });
      } catch (error) {
        console.warn("[canvas-property-panel] agent_execution.copy.failed", {
          kind,
          nodeId: node.id,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [node.id],
  );

  const submitWaitingResponse = useCallback(() => {
    const trimmed = waitingResponse.trim();
    if (!execution?.waitingForUser || trimmed.length === 0) return;
    const updates = getAgentWaitingResponseSubmittedUpdates(node, {
      text: trimmed,
      submittedAt: new Date().toISOString(),
    });
    if (updates) {
      onUpdate?.(updates);
      console.info("[canvas-property-panel] agent_execution.update", {
        kind: execution.kind,
        nodeId: node.id,
        runId: execution.runId,
      });
    }
    onContinueFromNode?.(node.id, "continue", {
      waitingResponseText: trimmed,
    });
  }, [execution, node, node.id, onContinueFromNode, onUpdate, waitingResponse]);

  if (!execution) return null;

  const hasExpandableDetails =
    execution.kind === "task_step" ||
    execution.kind === "tool_call" ||
    execution.kind === "ask_user_more" ||
    Boolean(execution.details) ||
    Boolean(execution.failure);
  const waitingResponseSubmitted = Boolean(
    execution.waitingForUser?.response?.text.trim(),
  );
  const waitingAttachmentCount =
    execution.waitingForUser?.response?.attachmentCount ?? 0;
  const branchContinueRequiresMainlineSelection =
    execution.branch && !execution.branch.isMainline;
  const branchContinueDisabled =
    !onContinueFromNode ||
    (branchContinueRequiresMainlineSelection &&
      (!onSelectVariantBranch || Boolean(selectVariantBranchReason)));
  const comparisonBranchNodes = execution.comparison
    ? execution.comparison.branchNodeIds.map((branchNodeId) => ({
        id: branchNodeId,
        node: pageNodes?.find((pageNode) => pageNode.id === branchNodeId),
      }))
    : [];
  const recommendedComparisonBranch = execution.comparison
    ? comparisonBranchNodes.find(({ id, node }) => {
        if (id === execution.comparison?.recommendedBranchId) return true;
        const branchMeta = getAgentExecutionMeta(node);
        return (
          branchMeta?.kind === "variant_branch" &&
          branchMeta.branchId === execution.comparison?.recommendedBranchId
        );
      })
    : undefined;
  const recommendedComparisonMeta = getAgentExecutionMeta(
    recommendedComparisonBranch?.node,
  );
  const recommendedComparisonLabel =
    recommendedComparisonMeta?.kind === "variant_branch"
      ? (recommendedComparisonMeta.branchLabel ??
        recommendedComparisonMeta.title)
      : undefined;

  return (
    <section className="-mx-4 border-t border-border/70 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-normal text-foreground">
            Agent 执行
          </h3>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {execution.title}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold",
            execution.status === "done" &&
              "border-emerald-500/25 bg-emerald-500/10 text-emerald-700",
            execution.status === "running" &&
              "border-blue-500/25 bg-blue-500/10 text-blue-700",
            execution.status === "failed" &&
              "border-destructive/25 bg-destructive/10 text-destructive",
            (execution.status === "waiting" || execution.status === "paused") &&
              "border-border bg-muted text-muted-foreground",
          )}
        >
          {getAgentExecutionStatusLabel(execution.status)}
        </span>
      </div>

      {execution.summary ? (
        <p className="mb-3 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {execution.summary}
        </p>
      ) : null}

      {hasExpandableDetails ? (
        <AgentExecutionDetailsSection
          detailsOpen={detailsOpen}
          execution={execution}
          onToggle={() => setDetailsOpen((open) => !open)}
        />
      ) : null}

      <div className="space-y-2">
        {detailRows.map(([label, value]) => (
          <div
            className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-xs"
            key={label}
          >
            <span className="text-muted-foreground">{label}</span>
            <span
              className="truncate font-medium text-foreground"
              title={value}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <AgentExecutionEvidenceSection execution={execution} />
      <AgentExecutionCritiqueSection execution={execution} />
      <AgentExecutionChainSection
        execution={execution}
        onSelectNode={onSelectExecutionNode}
        pageNodes={pageNodes}
      />

      <AgentExecutionFailureRecoverySection
        execution={execution}
        nodeId={node.id}
        onContinueFromNode={onContinueFromNode}
      />

      {execution.branch ? (
        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">方案分支</div>
            {execution.branch.isMainline ? (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                当前主线
              </span>
            ) : null}
          </div>
          <AgentVariantBranchDetails branch={execution.branch} />
          <div
            className={cn(
              "mt-3 grid gap-2",
              execution.branch.isMainline ? "grid-cols-1" : "grid-cols-2",
            )}
          >
            <AgentExecutionActionButton
              disabled={branchContinueDisabled}
              icon={branchContinueRequiresMainlineSelection ? GitBranch : Play}
              label={
                branchContinueRequiresMainlineSelection
                  ? "设为主线并深化"
                  : "继续深化"
              }
              onClick={() => {
                if (branchContinueRequiresMainlineSelection) {
                  onSelectVariantBranch?.(node.id);
                }
                onContinueFromNode?.(node.id, "continue", {
                  continuationTargetElement:
                    buildSelectedBranchContinuationTarget(node, execution),
                });
              }}
              reason={
                !onContinueFromNode
                  ? "当前页面暂时不能继续生成。"
                  : (selectVariantBranchReason ??
                    "继续深化前需要先把这个分支设为主线。")
              }
            />
            {!execution.branch.isMainline ? (
              <AgentExecutionActionButton
                disabled={!onSelectVariantBranch}
                icon={GitBranch}
                label="设为主线"
                onClick={() => onSelectVariantBranch?.(node.id)}
                reason={
                  selectVariantBranchReason ??
                  "当前分支没有可写入的方案对比上下文。"
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {execution.comparison ? (
        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
          <div className="font-medium">方案对比</div>
          <div className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-2">
            <span className="text-muted-foreground">推荐分支</span>
            <span className="truncate font-medium">
              {recommendedComparisonLabel ?? "暂未推荐，等待对比完成。"}
            </span>
          </div>
          {execution.comparison.recommendationReason ? (
            <div className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <span className="text-muted-foreground">推荐原因</span>
              <span className="min-w-0 whitespace-pre-wrap leading-5">
                {execution.comparison.recommendationReason}
              </span>
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-2">
            <span className="text-muted-foreground">分支数量</span>
            <span className="font-medium">
              {execution.comparison.branchNodeIds.length} 个
            </span>
          </div>
          <AgentComparisonBranchCards
            branches={comparisonBranchNodes}
            comparison={execution.comparison}
            onContinueFromNode={onContinueFromNode}
            onSelectVariantBranch={onSelectVariantBranch}
            recommendedBranchId={execution.comparison.recommendedBranchId}
            selectVariantBranchReason={selectVariantBranchReason}
          />
        </div>
      ) : null}

      {execution.waitingForUser ? (
        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
          <div className="font-medium">需要用户补充</div>
          <div className="mt-1 text-muted-foreground">
            {execution.waitingForUser.prompt}
          </div>
          <label
            className="mt-3 block text-[11px] font-medium text-muted-foreground"
            htmlFor={`${node.id}-agent-response`}
          >
            补充说明
          </label>
          <textarea
            id={`${node.id}-agent-response`}
            className="mt-1 min-h-20 w-full resize-none rounded-md border border-border bg-muted/40 px-2 py-2 text-xs leading-5 text-foreground outline-none focus:border-ring focus:bg-background"
            placeholder="直接填写需要补充给 Agent 的信息"
            value={waitingResponse}
            onChange={(event) => setWaitingResponse(event.currentTarget.value)}
          />
          {waitingResponseSubmitted ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              已保存补充内容，可继续生成后续结果。
            </p>
          ) : null}
          {waitingAttachmentCount > 0 ? (
            <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
              已随继续执行补充 {waitingAttachmentCount} 个文件/图片。
            </p>
          ) : null}
          {execution.waitingForUser.acceptsFiles ? (
            <button
              type="button"
              className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!onContinueFromNode}
              onClick={() => onContinueFromNode?.(node.id, "attach_files")}
              title={
                onContinueFromNode
                  ? "打开输入区并选择要补充的文件/图片。"
                  : "当前页面暂时不能继续生成。"
              }
            >
              <FilePlus className="h-3.5 w-3.5" />
              补充文件/图片
            </button>
          ) : null}
          <div className="mt-3 flex justify-end">
            <AgentExecutionActionButton
              disabled={!onUpdate || waitingResponse.trim().length === 0}
              icon={Send}
              label="提交补充"
              onClick={submitWaitingResponse}
              reason={
                onUpdate ? "请先填写补充说明。" : "当前页面暂时不能保存补充。"
              }
            />
          </div>
        </div>
      ) : null}

      <AgentExecutionCheckpointSection execution={execution} />
      <button
        type="button"
        className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-expanded={diagnosticsOpen}
        onClick={() => setDiagnosticsOpen((open) => !open)}
      >
        {diagnosticsOpen ? "收起开发诊断" : "显示开发诊断"}
      </button>
      {diagnosticsOpen ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <AgentExecutionActionButton
            icon={Copy}
            label={copied === "node" ? "已复制节点 ID" : "复制节点 ID"}
            onClick={() => copyText("node", node.id)}
          />
          {execution.runId ? (
            <AgentExecutionActionButton
              icon={Copy}
              label={copied === "run" ? "已复制运行 ID" : "复制运行 ID"}
              onClick={() => copyText("run", execution.runId ?? "")}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function buildSelectedBranchContinuationTarget(
  node: PenNode,
  execution: AgentExecutionNodeMeta,
): AgentExecutionContinueOptions["continuationTargetElement"] {
  const bounds = node as {
    content?: unknown;
    height?: unknown;
    width?: unknown;
    x?: unknown;
    y?: unknown;
  };
  const selectedExecution =
    execution.kind === "variant_branch" &&
    execution.branch?.isMainline === false
      ? {
          ...execution,
          branch: {
            ...execution.branch,
            isMainline: true,
            isRecommended: true,
          },
          ...(execution.comparison && execution.branchId
            ? {
                comparison: {
                  ...execution.comparison,
                  recommendedBranchId: execution.branchId,
                },
              }
            : {}),
        }
      : execution;
  return {
    agentExecution: selectedExecution,
    height: typeof bounds.height === "number" ? bounds.height : 0,
    id: node.id,
    ...(typeof bounds.content === "string" ? { text: bounds.content } : {}),
    type: node.type,
    width: typeof bounds.width === "number" ? bounds.width : 0,
    x: typeof bounds.x === "number" ? bounds.x : 0,
    y: typeof bounds.y === "number" ? bounds.y : 0,
  };
}
