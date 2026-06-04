import {
  AGENT_EXECUTION_META_KEY,
  type CanvasOperation,
  type CucumberCanvasDocument,
  findNode,
  flattenNodes,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type { FrameNode, PenNode, TextNode } from "@cucumber/pen-types";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveState,
} from "./ai-native-canvas-context.js";
import { analyzeCanvasTransaction } from "./ai-native-canvas-transactions.js";

const TOOL_NAME = "select_agent_variant_branch";
const SELECTED_BRANCH_FILL = "rgba(178,242,187,0.34)";
const UNSELECTED_BRANCH_FILL = "rgba(208,191,255,0.28)";

const selectAgentVariantBranchSchema = z.object({
  branchNodeId: z.string().trim().min(1),
  comparisonNodeId: z.string().trim().optional(),
  recommendationReason: z.string().trim().optional(),
  pageId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createSelectAgentVariantBranchMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof selectAgentVariantBranchSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Select one durable Agent variant_branch as the current mainline/recommended branch, update sibling branches under the same comparison, and persist the choice on PenNode.meta.agentExecution.",
    schema: selectAgentVariantBranchSchema,
    inputSchema: schemaToJsonSchema(selectAgentVariantBranchSchema),
    execute: async (args, context) => {
      try {
        const input = selectAgentVariantBranchSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildSelectVariantBranchPlan({
          branchNodeId: input.branchNodeId,
          comparisonNodeId: input.comparisonNodeId,
          doc: live.doc,
          pageId: input.pageId,
          recommendationReason: input.recommendationReason,
        });
        const analysis = analyzeCanvasTransaction({
          doc: live.doc,
          operations: plan.operations,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          ...(input.transactionId
            ? { transactionId: input.transactionId }
            : {}),
        });
        const baseVersion = input.baseVersion ?? live.version;
        if (
          input.baseVersion !== undefined &&
          input.baseVersion !== live.version
        ) {
          throw new Error(
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent variant branch selection was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] variant_branch.select dry_run", {
            branchNodeId: input.branchNodeId,
            canvasId: live.canvasId,
            comparisonNodeId: plan.comparisonNodeId,
            pageId: input.pageId ?? live.doc.activePageId,
            recommendedBranchId: plan.recommendedBranchId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildSelectVariantBranchPayload({
              analysis,
              dryRun: true,
              nextVersion: live.version,
              plan,
              success: true,
            }),
          );
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "select_agent_variant_branch requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.selectedBranchNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] variant_branch.select", {
          branchNodeId: input.branchNodeId,
          canvasId: live.canvasId,
          comparisonNodeId: plan.comparisonNodeId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          recommendedBranchId: plan.recommendedBranchId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildSelectVariantBranchPayload({
            analysis,
            dryRun: false,
            nextVersion: patchResult.version,
            plan,
            success: true,
          }),
        );
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "select_agent_variant_branch_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to select the Agent variant branch.",
        };
        console.warn(
          "[ai-native-canvas] variant_branch.select failed",
          payload,
        );
        return errorResult(payload);
      }
    },
  };
}

function buildSelectVariantBranchPlan(args: {
  branchNodeId: string;
  comparisonNodeId?: string;
  doc: CucumberCanvasDocument;
  pageId?: string;
  recommendationReason?: string;
}) {
  const selectedBranchNode = findNode(args.doc, args.branchNodeId, args.pageId);
  const selectedBranchMeta = getAgentExecutionMeta(selectedBranchNode);
  if (!selectedBranchNode || selectedBranchMeta?.kind !== "variant_branch") {
    throw new Error(
      `Node ${args.branchNodeId} is not an Agent variant branch. Select a variant_branch node and retry.`,
    );
  }
  if (!selectedBranchMeta.branchId) {
    throw new Error(
      `Variant branch node ${args.branchNodeId} is missing branchId, so it cannot become the mainline branch.`,
    );
  }

  const comparisonNode = resolveComparisonNode({
    branchNodeId: args.branchNodeId,
    comparisonNodeId: args.comparisonNodeId,
    doc: args.doc,
    pageId: args.pageId,
  });
  const comparisonMeta = getAgentExecutionMeta(comparisonNode);
  if (comparisonMeta?.kind !== "comparison" || !comparisonMeta.comparison) {
    throw new Error(
      `Node ${comparisonNode?.id ?? args.comparisonNodeId ?? ""} is not an Agent comparison node for variant selection.`,
    );
  }
  if (!comparisonMeta.comparison.branchNodeIds.includes(args.branchNodeId)) {
    throw new Error(
      `Comparison node ${comparisonNode.id} does not include branch node ${args.branchNodeId}. Select a branch from this comparison and retry.`,
    );
  }

  const operations: CanvasOperation[] = [];
  const branchUpdates = comparisonMeta.comparison.branchNodeIds.map(
    (branchNodeId) => {
      const branchNode = findNode(args.doc, branchNodeId, args.pageId);
      const branchMeta = getAgentExecutionMeta(branchNode);
      if (!branchNode || branchMeta?.kind !== "variant_branch") {
        throw new Error(
          `Comparison node ${comparisonNode.id} references ${branchNodeId}, but that node is not an Agent variant branch.`,
        );
      }
      if (!branchMeta.branchId) {
        throw new Error(
          `Variant branch node ${branchNodeId} is missing branchId, so the comparison cannot maintain one mainline branch.`,
        );
      }
      const isSelected = branchNodeId === args.branchNodeId;
      const nextMeta = {
        ...branchMeta,
        branch: {
          ...(branchMeta.branch ?? {}),
          isMainline: isSelected,
          isRecommended: isSelected,
        },
      };
      operations.push({
        type: "updateNode",
        nodeId: branchNodeId,
        updates: {
          fill: [
            {
              type: "solid",
              color: isSelected ? SELECTED_BRANCH_FILL : UNSELECTED_BRANCH_FILL,
            },
          ],
          meta: {
            ...(branchNode.meta ?? {}),
            [AGENT_EXECUTION_META_KEY]: nextMeta,
          },
        } as Partial<PenNode>,
        ...(args.pageId ? { activePageId: args.pageId } : {}),
      });
      return {
        branchId: branchMeta.branchId,
        node: branchNode,
        nodeId: branchNodeId,
        selected: isSelected,
        title: branchMeta.title,
      };
    },
  );

  const nextComparisonMeta = {
    ...comparisonMeta,
    comparison: {
      ...comparisonMeta.comparison,
      recommendedBranchId: selectedBranchMeta.branchId,
      ...(args.recommendationReason
        ? { recommendationReason: args.recommendationReason }
        : {}),
    },
  };
  operations.push({
    type: "updateNode",
    nodeId: comparisonNode.id,
    updates: {
      children: updateComparisonChildren(
        comparisonNode,
        branchUpdates,
        selectedBranchMeta.branchId,
        args.recommendationReason ??
          comparisonMeta.comparison.recommendationReason,
      ),
      meta: {
        ...(comparisonNode.meta ?? {}),
        [AGENT_EXECUTION_META_KEY]: nextComparisonMeta,
      },
    } as Partial<PenNode>,
    ...(args.pageId ? { activePageId: args.pageId } : {}),
  });

  return {
    comparisonNodeId: comparisonNode.id,
    operations,
    recommendedBranchId: selectedBranchMeta.branchId,
    selectedBranchNodeId: args.branchNodeId,
    updatedBranchNodeIds: branchUpdates.map((branch) => branch.nodeId),
  };
}

function resolveComparisonNode(args: {
  branchNodeId: string;
  comparisonNodeId?: string;
  doc: CucumberCanvasDocument;
  pageId?: string;
}): PenNode {
  if (args.comparisonNodeId) {
    const explicitNode = findNode(args.doc, args.comparisonNodeId, args.pageId);
    if (explicitNode) return explicitNode;
    throw new Error(
      `Comparison node ${args.comparisonNodeId} does not exist. Refresh the canvas state and retry.`,
    );
  }

  const matchingNodes = flattenNodes(args.doc, args.pageId).filter((node) => {
    const meta = getAgentExecutionMeta(node);
    return (
      meta?.kind === "comparison" &&
      meta.comparison?.branchNodeIds.includes(args.branchNodeId)
    );
  });
  if (matchingNodes.length === 1) return matchingNodes[0] as PenNode;
  if (matchingNodes.length > 1) {
    throw new Error(
      `Branch node ${args.branchNodeId} belongs to multiple comparison nodes. Provide comparisonNodeId to select the mainline branch safely.`,
    );
  }
  throw new Error(
    `No comparison node references branch node ${args.branchNodeId}. Create a comparison with create_agent_variant_branches or provide comparisonNodeId.`,
  );
}

function updateComparisonChildren(
  comparisonNode: PenNode,
  branches: {
    branchId: string;
    node: PenNode;
    nodeId: string;
    selected: boolean;
    title: string;
  }[],
  recommendedBranchId: string,
  recommendationReason?: string,
) {
  if (
    !("children" in comparisonNode) ||
    !Array.isArray(comparisonNode.children)
  ) {
    return undefined;
  }
  const selectedBranch = branches.find(
    (branch) => branch.branchId === recommendedBranchId,
  );
  const content = [
    ...branches.map((branch) => buildBranchComparisonLine(branch.node)),
    selectedBranch ? `推荐选择：${selectedBranch.title}` : "",
    recommendationReason ? `推荐原因：${recommendationReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let updatedFirstText = false;
  return comparisonNode.children.map((child) => {
    if (updatedFirstText || child.type !== "text") return child;
    updatedFirstText = true;
    return { ...(child as TextNode), content };
  }) as FrameNode["children"];
}

function buildBranchComparisonLine(node: PenNode): string {
  const meta = getAgentExecutionMeta(node);
  const strengths = meta?.branch?.strengths?.join(" / ") || "待补充";
  const risks = meta?.branch?.risks?.join(" / ") || "待补充";
  const useCases = meta?.branch?.useCases?.join(" / ") || "待补充";
  return `${meta?.title ?? node.name ?? node.id}：优点 ${strengths}；风险 ${risks}；适用 ${useCases}`;
}

function buildSelectVariantBranchPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildSelectVariantBranchPlan>;
  success: boolean;
}) {
  return {
    affectedNodeIds: args.analysis.affectedNodeIds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    boundingRegion: args.analysis.boundingRegion,
    comparisonNodeId: args.plan.comparisonNodeId,
    createdNodeIds: args.analysis.createdNodeIds,
    dryRun: args.dryRun,
    highRiskChanges: args.analysis.highRiskChanges,
    nextDocumentVersion: args.nextVersion,
    operationsByType: args.analysis.operationsByType,
    previewedOperationCount: args.analysis.operationCount,
    recommendedBranchId: args.plan.recommendedBranchId,
    selectedBranchNodeId: args.plan.selectedBranchNodeId,
    success: args.success,
    transactionId: args.analysis.transactionId,
    updatedBranchNodeIds: args.plan.updatedBranchNodeIds,
    updatedNodeIds: args.analysis.updatedNodeIds,
    validationPreviewWarnings: args.analysis.validationPreviewWarnings,
  };
}
