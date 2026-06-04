import {
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  flattenNodes,
  getAgentExecutionCanvasRole,
  getAgentExecutionCanvasSize,
  getBoundsUnion,
  getNodeSceneBounds,
  withAgentExecutionNodeSemantics,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  agentExecutionConnectorStroke,
  applyAgentExecutionCardVisualStyle,
  createAgentExecutionCardChildren,
} from "./agent-execution-visual-style.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveState,
} from "./ai-native-canvas-context.js";
import { analyzeCanvasTransaction } from "./ai-native-canvas-transactions.js";

const TOOL_NAME = "create_agent_variant_branches";

const variantBranchSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  planSummary: z.string().trim().optional(),
  deliverableSummary: z.string().trim().optional(),
  critiqueSummary: z.string().trim().optional(),
  strengths: z.array(z.string().trim().min(1)).default([]),
  risks: z.array(z.string().trim().min(1)).default([]),
  useCases: z.array(z.string().trim().min(1)).default([]),
  branchId: z.string().trim().optional(),
  recommended: z.boolean().default(false),
});

const createAgentVariantBranchesSchema = z.object({
  variants: z.array(variantBranchSchema).min(2).max(6),
  comparisonTitle: z.string().trim().default("方案对比"),
  recommendationReason: z.string().trim().optional(),
  sourceNodeId: z.string().trim().optional(),
  pageId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentVariantBranchesMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentVariantBranchesSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create durable Agent variant_branch nodes plus a comparison node for multi-direction creative exploration. Stores all branch/comparison semantics on PenNode.meta.agentExecution and connects the branches on the live canvas.",
    schema: createAgentVariantBranchesSchema,
    inputSchema: schemaToJsonSchema(createAgentVariantBranchesSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentVariantBranchesSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildVariantBranchesPlan({
          agentId: input.agentId,
          comparisonTitle: input.comparisonTitle,
          doc: live.doc,
          pageId: input.pageId,
          recommendationReason: input.recommendationReason,
          runId: input.runId,
          sessionId: input.sessionId,
          sourceNodeId: input.sourceNodeId,
          variants: input.variants,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent variant branches were based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] variant_branches.create dry_run", {
            canvasId: live.canvasId,
            comparisonNodeId: plan.comparisonNodeId,
            pageId: input.pageId ?? live.doc.activePageId,
            sourceNodeId: input.sourceNodeId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
            variantCount: plan.variantBranchNodeIds.length,
          });
          return jsonResult(
            buildVariantBranchesPayload({
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
            "create_agent_variant_branches requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.comparisonNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] variant_branches.create", {
          canvasId: live.canvasId,
          comparisonNodeId: plan.comparisonNodeId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          sourceNodeId: input.sourceNodeId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
          variantCount: plan.variantBranchNodeIds.length,
        });
        return jsonResult(
          buildVariantBranchesPayload({
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
              : "create_agent_variant_branches_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create Agent variant branches.",
        };
        console.warn(
          "[ai-native-canvas] variant_branches.create failed",
          payload,
        );
        return errorResult(payload);
      }
    },
  };
}

type VariantBranchInput = z.infer<typeof variantBranchSchema>;

function buildVariantBranchesPlan(args: {
  agentId?: string;
  comparisonTitle: string;
  doc: CucumberCanvasDocument;
  pageId?: string;
  recommendationReason?: string;
  runId?: string;
  sessionId?: string;
  sourceNodeId?: string;
  variants: VariantBranchInput[];
}) {
  const sourceNode = args.sourceNodeId
    ? findNode(args.doc, args.sourceNodeId, args.pageId)
    : undefined;
  const origin = sourceNode
    ? {
        x:
          (sourceNode.x ?? 0) +
          ((sourceNode as { width?: number }).width ?? 260) +
          96,
        y: sourceNode.y ?? 0,
      }
    : inferVariantOrigin(args.doc, args.pageId);
  const nodes: PenNode[] = [];
  const connectors: LineNode[] = [];
  const fallbackVariant = args.variants[0];
  if (!fallbackVariant) {
    throw new Error(
      "create_agent_variant_branches requires at least one variant.",
    );
  }
  const recommendedVariant =
    args.variants.find((variant) => variant.recommended) ?? fallbackVariant;
  const recommendedBranchId = branchIdForVariant(recommendedVariant, 0);
  const executionBarBounds = {
    x: origin.x,
    y: origin.y,
    ...getAgentExecutionCanvasSize({ kind: "task_step", collapsed: true }),
  };
  const executionNode = createBranchExecutionCard({
    agentId: args.agentId,
    body: "Agent 正在生成并整理多个结果分支。",
    bounds: executionBarBounds,
    runId: args.runId,
    sessionId: args.sessionId,
    sourceNodeId: args.sourceNodeId,
  });
  nodes.push(executionNode);
  if (sourceNode) {
    connectors.push(buildConnector("生成分支", sourceNode, executionNode));
  }

  const variantNodes = args.variants.map((variant, index) => {
    const branchId = branchIdForVariant(variant, index);
    const node = createVariantCard({
      agentId: args.agentId,
      branchId,
      body: buildVariantBody(variant),
      branchLabel: variant.title,
      bounds: {
        x: origin.x + index * 257,
        y: origin.y + executionBarBounds.height + 40,
        ...getAgentExecutionCanvasSize({
          kind: "variant_branch",
          collapsed: false,
        }),
      },
      critiqueSummary: variant.critiqueSummary,
      deliverableSummary: variant.deliverableSummary,
      isMainline: branchId === recommendedBranchId,
      isRecommended: branchId === recommendedBranchId,
      planSummary: variant.planSummary,
      runId: args.runId,
      sessionId: args.sessionId,
      sourceNodeId: executionNode.id,
      strengths: variant.strengths,
      risks: variant.risks,
      summary: variant.summary,
      title: variant.title,
      useCases: variant.useCases,
    });
    nodes.push(node);
    connectors.push(buildConnector("输出分支", executionNode, node));
    return node;
  });

  const comparisonBody = buildComparisonBody({
    recommendationReason: args.recommendationReason,
    recommendedTitle: recommendedVariant.title,
    variants: args.variants,
  });
  const comparisonNode = createComparisonCard({
    agentId: args.agentId,
    body: comparisonBody,
    bounds: {
      x: origin.x,
      y:
        origin.y +
        executionBarBounds.height +
        40 +
        getAgentExecutionCanvasSize({
          kind: "variant_branch",
          collapsed: false,
        }).height +
        40,
      ...getAgentExecutionCanvasSize({ kind: "comparison", collapsed: false }),
    },
    branchNodeIds: variantNodes.map((node) => node.id),
    recommendedBranchId,
    recommendationReason: args.recommendationReason,
    runId: args.runId,
    sessionId: args.sessionId,
    title: args.comparisonTitle,
  });
  nodes.push(comparisonNode);
  for (const node of variantNodes) {
    connectors.push(buildConnector("进入对比", node, comparisonNode));
  }

  const operations: CanvasOperation[] = [
    ...nodes.map((node) => insertNode(node, args.pageId)),
    ...connectors.map((node) => insertNode(node, args.pageId)),
  ];
  return {
    comparisonNodeId: comparisonNode.id,
    connectorNodeIds: connectors.map((node) => node.id),
    recommendedBranchId,
    variantBranchNodeIds: variantNodes.map((node) => node.id),
    operations,
  };
}

function createVariantCard(input: {
  agentId?: string;
  branchId: string;
  body: string;
  branchLabel: string;
  bounds: CanvasBounds;
  critiqueSummary?: string;
  deliverableSummary?: string;
  isMainline: boolean;
  isRecommended: boolean;
  planSummary?: string;
  risks: string[];
  runId?: string;
  sessionId?: string;
  sourceNodeId?: string;
  strengths: string[];
  summary: string;
  title: string;
  useCases: string[];
}): FrameNode {
  const node = createCard({
    agentId: input.agentId,
    body: input.body,
    bounds: input.bounds,
    kind: "variant_branch",
    runId: input.runId,
    sessionId: input.sessionId,
    status: "done",
    title: input.title,
  });
  return withAgentExecutionNodeSemantics(node, {
    branch: {
      ...(input.planSummary ? { planSummary: input.planSummary } : {}),
      ...(input.deliverableSummary
        ? { deliverableSummary: input.deliverableSummary }
        : {}),
      ...(input.critiqueSummary
        ? { critiqueSummary: input.critiqueSummary }
        : {}),
      isMainline: input.isMainline,
      isRecommended: input.isRecommended,
      risks: input.risks,
      strengths: input.strengths,
      useCases: input.useCases,
    },
    branchId: input.branchId,
    branchLabel: input.branchLabel,
    kind: "variant_branch",
    status: "done",
    summary: input.summary,
    title: input.title,
    canvasPresentation: {
      layoutVersion: 2,
      collapsed: getAgentExecutionCanvasRole("variant_branch") === "execution",
    },
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sourceNodeId ? { upstreamNodeIds: [input.sourceNodeId] } : {}),
  }) as FrameNode;
}

function createComparisonCard(input: {
  agentId?: string;
  body: string;
  bounds: CanvasBounds;
  branchNodeIds: string[];
  recommendedBranchId: string;
  recommendationReason?: string;
  runId?: string;
  sessionId?: string;
  title: string;
}): FrameNode {
  const node = createCard({
    agentId: input.agentId,
    body: input.body,
    bounds: input.bounds,
    kind: "comparison",
    runId: input.runId,
    sessionId: input.sessionId,
    status: "done",
    title: input.title,
  });
  return withAgentExecutionNodeSemantics(node, {
    comparison: {
      branchNodeIds: input.branchNodeIds,
      recommendedBranchId: input.recommendedBranchId,
      ...(input.recommendationReason
        ? { recommendationReason: input.recommendationReason }
        : {}),
    },
    kind: "comparison",
    status: "done",
    summary: input.body,
    title: input.title,
    canvasPresentation: {
      layoutVersion: 2,
      collapsed: getAgentExecutionCanvasRole("comparison") === "execution",
    },
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    upstreamNodeIds: input.branchNodeIds,
  }) as FrameNode;
}

function createBranchExecutionCard(input: {
  agentId?: string;
  body: string;
  bounds: CanvasBounds;
  runId?: string;
  sessionId?: string;
  sourceNodeId?: string;
}): FrameNode {
  const node = createCard({
    agentId: input.agentId,
    body: input.body,
    bounds: input.bounds,
    kind: "task_step",
    runId: input.runId,
    sessionId: input.sessionId,
    status: "done",
    title: "Agent 执行",
  });
  return withAgentExecutionNodeSemantics(node, {
    kind: "task_step",
    status: "done",
    summary: input.body,
    title: "Agent 执行",
    canvasPresentation: {
      layoutVersion: 2,
      collapsed: getAgentExecutionCanvasRole("task_step") === "execution",
    },
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sourceNodeId ? { upstreamNodeIds: [input.sourceNodeId] } : {}),
  }) as FrameNode;
}

function createCard(input: {
  agentId?: string;
  body: string;
  bounds: CanvasBounds;
  kind: "comparison" | "task_step" | "variant_branch";
  runId?: string;
  sessionId?: string;
  status: "done";
  title: string;
}): FrameNode {
  return applyAgentExecutionCardVisualStyle(
    {
      id: createNodeId("agent_variant"),
      type: "frame",
      name: input.title,
      x: input.bounds.x,
      y: input.bounds.y,
      width: input.bounds.width,
      height: input.bounds.height,
      children: createAgentExecutionCardChildren({
        body: input.body,
        bounds: input.bounds,
        kind: input.kind,
        status: input.status,
        title: input.title,
      }),
      clipContent: false,
      containerRole: ["task", "context"],
      contextSlots: { rules: ["agent variant exploration node"] },
      permissions: {
        owner: "agent",
        canRead: [],
        canWrite: [],
        isolationLevel: "open",
      },
      ...(input.agentId
        ? {
            agentBinding: {
              agentId: input.agentId,
              name: input.title,
              permissions: ["read", "write"],
              role: "assistant",
              status: "completed",
            },
            createdByAgentId: input.agentId,
          }
        : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
    {
      body: input.body,
      collapsed: input.kind !== "variant_branch" && input.kind !== "comparison",
      kind: input.kind,
      status: input.status,
      title: input.title,
    },
  );
}

function buildVariantBody(variant: VariantBranchInput): string {
  return [
    variant.summary,
    variant.planSummary ? `计划：${variant.planSummary}` : "",
    variant.deliverableSummary ? `产物：${variant.deliverableSummary}` : "",
    variant.critiqueSummary ? `评审：${variant.critiqueSummary}` : "",
    variant.strengths.length ? `优点：${variant.strengths.join("；")}` : "",
    variant.risks.length ? `风险：${variant.risks.join("；")}` : "",
    variant.useCases.length ? `适用：${variant.useCases.join("；")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildComparisonBody(input: {
  recommendationReason?: string;
  recommendedTitle: string;
  variants: VariantBranchInput[];
}): string {
  return [
    ...input.variants.map(
      (variant) =>
        `${variant.title}：计划 ${variant.planSummary || "待补充"}；产物 ${variant.deliverableSummary || "待补充"}；评审 ${variant.critiqueSummary || "待补充"}；优点 ${variant.strengths.join(" / ") || "待补充"}；风险 ${variant.risks.join(" / ") || "待补充"}；适用 ${variant.useCases.join(" / ") || "待补充"}`,
    ),
    `推荐选择：${input.recommendedTitle}`,
    input.recommendationReason ? `推荐原因：${input.recommendationReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function branchIdForVariant(variant: VariantBranchInput, index: number) {
  return variant.branchId?.trim() || `branch-${index + 1}`;
}

function buildConnector(
  label: string,
  source: PenNode,
  target: PenNode,
): LineNode {
  const sourceBounds = nodeBounds(source);
  const targetBounds = nodeBounds(target);
  const start =
    Math.abs((targetBounds.y ?? 0) - (sourceBounds.y ?? 0)) >
    Math.abs((targetBounds.x ?? 0) - (sourceBounds.x ?? 0))
      ? connectorPointForNodeBounds(source, sourceBounds, "bottom", 0.5)
      : connectorPointForNodeBounds(source, sourceBounds, "right", 0.5);
  const end =
    Math.abs((targetBounds.y ?? 0) - (sourceBounds.y ?? 0)) >
    Math.abs((targetBounds.x ?? 0) - (sourceBounds.x ?? 0))
      ? connectorPointForNodeBounds(target, targetBounds, "top", 0.5)
      : connectorPointForNodeBounds(target, targetBounds, "left", 0.5);
  const startSide =
    Math.abs((targetBounds.y ?? 0) - (sourceBounds.y ?? 0)) >
    Math.abs((targetBounds.x ?? 0) - (sourceBounds.x ?? 0))
      ? "bottom"
      : "right";
  const endSide =
    Math.abs((targetBounds.y ?? 0) - (sourceBounds.y ?? 0)) >
    Math.abs((targetBounds.x ?? 0) - (sourceBounds.x ?? 0))
      ? "top"
      : "left";
  return {
    id: createNodeId("connector"),
    type: "line",
    name: label,
    explain: label,
    x: start.x,
    y: start.y,
    x2: end.x,
    y2: end.y,
    connector: {
      arrow: false,
      routing: "smooth",
      start: { nodeId: source.id, ratio: 0.5, side: startSide },
      end: { nodeId: target.id, ratio: 0.5, side: endSide },
    },
    stroke: agentExecutionConnectorStroke("accent"),
  };
}

function nodeBounds(node: PenNode): CanvasBounds {
  return {
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: (node as { width?: number }).width ?? 100,
    height: (node as { height?: number }).height ?? 100,
  };
}

function inferVariantOrigin(
  doc: CucumberCanvasDocument,
  pageId: string | undefined,
): { x: number; y: number } {
  const boundsList = flattenNodes(doc, pageId)
    .filter((node) => node.visible !== false)
    .map((node) => getNodeSceneBounds(doc, node.id, pageId))
    .filter((bounds): bounds is CanvasBounds => Boolean(bounds));
  if (boundsList.length === 0) return { x: 0, y: 0 };
  const union = getBoundsUnion(boundsList);
  return { x: union.x + union.width + 96, y: union.y };
}

function insertNode(
  node: PenNode,
  pageId: string | undefined,
): CanvasOperation {
  return {
    type: "insertNode",
    node,
    ...(pageId ? { activePageId: pageId } : {}),
  };
}

function buildVariantBranchesPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildVariantBranchesPlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    variantBranchNodeIds: args.plan.variantBranchNodeIds,
    comparisonNodeId: args.plan.comparisonNodeId,
    recommendedBranchId: args.plan.recommendedBranchId,
    connectorNodeIds: args.plan.connectorNodeIds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
