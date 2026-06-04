"use client";

import { getAgentExecutionMeta } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { GitBranch, Play } from "lucide-react";

import { cn } from "../../../lib/utils";
import { AgentExecutionActionButton } from "./agent-execution-action-button";
import type {
  AgentExecutionContinueIntent,
  AgentExecutionContinueOptions,
} from "./agent-execution-section";
import { AgentVariantBranchDetails } from "./agent-variant-branch-details";

type ComparisonBranchCardsProps = {
  branches: Array<{ id: string; node?: PenNode }>;
  comparison?: {
    branchNodeIds: string[];
    recommendedBranchId?: string;
    recommendationReason?: string;
  };
  onContinueFromNode?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
  onSelectVariantBranch?: (branchNodeId: string) => void;
  recommendedBranchId?: string;
  selectVariantBranchReason?: string;
};

export function AgentComparisonBranchCards({
  branches,
  comparison,
  onContinueFromNode,
  onSelectVariantBranch,
  recommendedBranchId,
  selectVariantBranchReason,
}: ComparisonBranchCardsProps) {
  if (branches.length === 0) return null;
  const recommendedBranch = findRecommendedBranch(
    branches,
    recommendedBranchId,
  );
  const recommendedMeta = getAgentExecutionMeta(recommendedBranch?.node);
  const recommendedCanContinue = recommendedMeta?.kind === "variant_branch";
  const recommendedIsMainline =
    recommendedMeta?.kind === "variant_branch" &&
    recommendedMeta.branch?.isMainline === true;
  const recommendedContinueDisabled =
    !recommendedCanContinue ||
    !onContinueFromNode ||
    (!recommendedIsMainline &&
      (!onSelectVariantBranch || Boolean(selectVariantBranchReason)));
  return (
    <div className="mt-3">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">
        分支对比
      </div>
      {recommendedBranchId ? (
        <div className="mb-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-2 text-[11px] text-foreground">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">推荐选择</div>
              <div className="mt-0.5 truncate text-muted-foreground">
                {recommendedMeta?.kind === "variant_branch"
                  ? (recommendedMeta.branchLabel ?? recommendedMeta.title)
                  : "推荐分支暂不可用"}
              </div>
              {comparison?.recommendationReason ? (
                <div className="mt-1 line-clamp-2 text-muted-foreground">
                  {comparison.recommendationReason}
                </div>
              ) : null}
            </div>
            <AgentExecutionActionButton
              disabled={recommendedContinueDisabled}
              icon={recommendedIsMainline ? Play : GitBranch}
              label="深化推荐选择"
              onClick={() => {
                if (
                  !recommendedBranch ||
                  recommendedMeta?.kind !== "variant_branch"
                ) {
                  return;
                }
                if (!recommendedIsMainline) {
                  onSelectVariantBranch?.(recommendedBranch.id);
                }
                const continuationTargetElement =
                  buildContinuationTargetElement(
                    recommendedBranch.node,
                    recommendedMeta,
                    comparison,
                    !recommendedIsMainline,
                  );
                onContinueFromNode?.(
                  recommendedBranch.id,
                  "continue",
                  continuationTargetElement
                    ? { continuationTargetElement }
                    : undefined,
                );
              }}
              reason={
                !recommendedCanContinue
                  ? "推荐方案当前不在活动页面或信息不完整。"
                  : !onContinueFromNode
                    ? "当前页面暂时不能继续生成。"
                    : (selectVariantBranchReason ??
                      "深化推荐选择前需要先把这个分支设为主线。")
              }
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-2">
        {branches.map(({ id, node }) => {
          const branchMeta = getAgentExecutionMeta(node);
          if (branchMeta?.kind !== "variant_branch") {
            return (
              <div
                key={id}
                className="rounded-md border border-border bg-muted/40 px-2 py-2 text-[11px] text-muted-foreground"
              >
                这个方案当前不在活动页面或信息不完整。
              </div>
            );
          }
          const isMainline = branchMeta.branch?.isMainline === true;
          const isRecommended =
            branchMeta.branchId === recommendedBranchId ||
            branchMeta.branch?.isRecommended === true;
          const continueRequiresMainlineSelection = !isMainline;
          const continueDisabled =
            !onContinueFromNode ||
            (continueRequiresMainlineSelection &&
              (!onSelectVariantBranch || Boolean(selectVariantBranchReason)));
          return (
            <div
              key={id}
              className={cn(
                "rounded-md border px-2 py-2",
                isMainline
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-border bg-muted/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {branchMeta.branchLabel || branchMeta.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {isMainline
                      ? "当前主线"
                      : isRecommended
                        ? "推荐方案"
                        : "备选方案"}
                  </div>
                </div>
                {isMainline || isRecommended ? (
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {isMainline ? "主线" : "推荐"}
                  </span>
                ) : null}
              </div>
              <AgentVariantBranchDetails branch={branchMeta.branch} compact />
              <div
                className={cn(
                  "mt-2 grid gap-2",
                  isMainline ? "grid-cols-1" : "grid-cols-2",
                )}
              >
                <AgentExecutionActionButton
                  disabled={continueDisabled}
                  icon={continueRequiresMainlineSelection ? GitBranch : Play}
                  label={
                    continueRequiresMainlineSelection
                      ? "设为主线并深化"
                      : "继续深化"
                  }
                  onClick={() => {
                    if (continueRequiresMainlineSelection) {
                      onSelectVariantBranch?.(id);
                    }
                    const continuationTargetElement =
                      buildContinuationTargetElement(
                        node,
                        branchMeta,
                        comparison,
                        continueRequiresMainlineSelection,
                      );
                    onContinueFromNode?.(
                      id,
                      "continue",
                      continuationTargetElement
                        ? { continuationTargetElement }
                        : undefined,
                    );
                  }}
                  reason={
                    !onContinueFromNode
                      ? "当前页面暂时不能继续生成。"
                      : (selectVariantBranchReason ??
                        "继续深化前需要先把这个分支设为主线。")
                  }
                />
                {!isMainline ? (
                  <AgentExecutionActionButton
                    disabled={!onSelectVariantBranch}
                    icon={GitBranch}
                    label="设为主线"
                    onClick={() => onSelectVariantBranch?.(id)}
                    reason={
                      selectVariantBranchReason ??
                      "当前方案对比没有可写入的分支选择上下文。"
                    }
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function findRecommendedBranch(
  branches: Array<{ id: string; node?: PenNode }>,
  recommendedBranchId: string | undefined,
): { id: string; node?: PenNode } | undefined {
  if (!recommendedBranchId) return undefined;
  return branches.find(({ id, node }) => {
    if (id === recommendedBranchId) return true;
    const execution = getAgentExecutionMeta(node);
    return (
      execution?.kind === "variant_branch" &&
      execution.branchId === recommendedBranchId
    );
  });
}

function buildContinuationTargetElement(
  node: PenNode | undefined,
  agentExecution: NonNullable<ReturnType<typeof getAgentExecutionMeta>>,
  comparison: ComparisonBranchCardsProps["comparison"],
  selectedAsMainline = false,
): AgentExecutionContinueOptions["continuationTargetElement"] | undefined {
  if (!node) return undefined;
  const bounds = node as {
    content?: unknown;
    height?: unknown;
    width?: unknown;
    x?: unknown;
    y?: unknown;
  };
  const selectedAgentExecution = selectedAsMainline
    ? {
        ...agentExecution,
        branch: {
          ...(agentExecution.branch ?? {}),
          isMainline: true,
          isRecommended: true,
        },
        ...(comparison
          ? {
              comparison: {
                ...comparison,
                ...(agentExecution.branchId
                  ? { recommendedBranchId: agentExecution.branchId }
                  : {}),
              },
            }
          : {}),
      }
    : {
        ...agentExecution,
        ...(comparison ? { comparison } : {}),
      };
  return {
    agentExecution: selectedAgentExecution,
    height: typeof bounds.height === "number" ? bounds.height : 0,
    id: node.id,
    ...(typeof bounds.content === "string" ? { text: bounds.content } : {}),
    type: node.type,
    width: typeof bounds.width === "number" ? bounds.width : 0,
    x: typeof bounds.x === "number" ? bounds.x : 0,
    y: typeof bounds.y === "number" ? bounds.y : 0,
  };
}
