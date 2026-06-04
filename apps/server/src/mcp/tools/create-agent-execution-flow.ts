import {
  AGENT_EXECUTION_META_KEY,
  type AgentExecutionNodeKind,
  type AgentExecutionStatus,
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  connectorPointForNodeBounds,
  createNodeId,
  flattenNodes,
  getAgentExecutionCanvasRole,
  getAgentExecutionCanvasSize,
  getAgentExecutionMeta,
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

const TOOL_NAME = "create_agent_execution_flow";

const executionStepSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().optional(),
  toolName: z.string().trim().optional(),
  status: z
    .enum(["waiting", "running", "done", "failed", "paused"])
    .default("waiting"),
});

const createAgentExecutionFlowSchema = z.object({
  userGoal: z.string().trim().min(1),
  recipeTitle: z.string().trim().default("Agent Recipe"),
  recipeSummary: z.string().trim().optional(),
  steps: z.array(executionStepSchema).min(1).max(6),
  finalTitle: z.string().trim().default("最终交付物"),
  finalSummary: z.string().trim().optional(),
  critiqueTitle: z.string().trim().default("验证与评审"),
  critiqueSummary: z.string().trim().optional(),
  includeCritique: z.boolean().default(true),
  includeCheckpoint: z.boolean().default(true),
  pageId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentExecutionFlowMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentExecutionFlowSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create a durable Flowith-like Agent execution chain on the live canvas: user goal, recipe plan, task steps, optional tool-call nodes, critique/validation, final deliverable, checkpoint, and semantic connectors. Stores execution semantics on PenNode.meta.agentExecution.",
    schema: createAgentExecutionFlowSchema,
    inputSchema: schemaToJsonSchema(createAgentExecutionFlowSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentExecutionFlowSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildAgentExecutionFlowPlan({
          agentId: input.agentId,
          critiqueSummary: input.critiqueSummary,
          critiqueTitle: input.critiqueTitle,
          doc: live.doc,
          finalSummary: input.finalSummary,
          finalTitle: input.finalTitle,
          includeCheckpoint: input.includeCheckpoint,
          includeCritique: input.includeCritique,
          pageId: input.pageId,
          recipeSummary: input.recipeSummary,
          recipeTitle: input.recipeTitle,
          runId: input.runId,
          sessionId: input.sessionId,
          steps: input.steps,
          userGoal: input.userGoal,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent execution flow was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] execution_flow.create dry_run", {
            canvasId: live.canvasId,
            checkpointNodeId: plan.checkpointNodeId,
            finalDeliverableNodeId: plan.finalDeliverableNodeId,
            pageId: input.pageId ?? live.doc.activePageId,
            recipeNodeId: plan.recipeNodeId,
            transactionId: analysis.transactionId,
            userGoalNodeId: plan.userGoalNodeId,
            userId: live.user.id,
          });
          return jsonResult(
            buildAgentExecutionFlowPayload({
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
            "create_agent_execution_flow requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.finalDeliverableNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] execution_flow.create", {
          canvasId: live.canvasId,
          checkpointNodeId: plan.checkpointNodeId,
          finalDeliverableNodeId: plan.finalDeliverableNodeId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          recipeNodeId: plan.recipeNodeId,
          transactionId: analysis.transactionId,
          userGoalNodeId: plan.userGoalNodeId,
          userId: live.user.id,
        });
        return jsonResult(
          buildAgentExecutionFlowPayload({
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
              : "create_agent_execution_flow_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the Agent execution flow.",
        };
        console.warn(
          "[ai-native-canvas] execution_flow.create failed",
          payload,
        );
        return errorResult(payload);
      }
    },
  };
}

type ExecutionStepInput = z.infer<typeof executionStepSchema>;

function buildAgentExecutionFlowPlan(args: {
  agentId?: string;
  critiqueSummary?: string;
  critiqueTitle: string;
  doc: CucumberCanvasDocument;
  finalSummary?: string;
  finalTitle: string;
  includeCheckpoint: boolean;
  includeCritique: boolean;
  pageId?: string;
  recipeSummary?: string;
  recipeTitle: string;
  runId?: string;
  sessionId?: string;
  steps: ExecutionStepInput[];
  userGoal: string;
}) {
  const origin = inferFlowOrigin(args.doc, args.pageId);
  const nodes: PenNode[] = [];
  const connectors: LineNode[] = [];
  const chainX = origin.x;
  let cursorY = origin.y;

  const userGoalNode = createExecutionCard({
    args,
    body: args.userGoal,
    bounds: {
      x: chainX,
      y: cursorY,
      ...getAgentExecutionCanvasSize({ kind: "user_goal", collapsed: false }),
    },
    kind: "user_goal",
    role: ["context"],
    status: "done",
    title: "用户目标",
  });
  nodes.push(userGoalNode);
  cursorY += nodeBounds(userGoalNode).height + 40;

  const recipeBody =
    args.recipeSummary ??
    args.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n");
  const recipeNode = createExecutionCard({
    args,
    body: recipeBody,
    bounds: {
      x: chainX,
      y: cursorY,
      ...getAgentExecutionCanvasSize({ kind: "recipe_plan", collapsed: true }),
    },
    kind: "recipe_plan",
    role: ["task"],
    status: "done",
    title: args.recipeTitle,
    upstreamNodeIds: [userGoalNode.id],
  });
  nodes.push(recipeNode);
  connectors.push(buildFlowConnector("生成 Recipe", userGoalNode, recipeNode));
  cursorY += nodeBounds(recipeNode).height + 40;

  const stepNodeIds: string[] = [];
  const toolCallNodeIds: string[] = [];
  let previous = recipeNode;
  args.steps.forEach((step, index) => {
    const stepNode = createExecutionCard({
      args,
      body: step.summary ?? "等待执行这个任务步骤。",
      bounds: {
        x: chainX,
        y: cursorY,
        ...getAgentExecutionCanvasSize({ kind: "task_step", collapsed: true }),
      },
      kind: "task_step",
      role: ["task"],
      status: step.status,
      title: step.title,
      upstreamNodeIds: [previous.id],
    });
    nodes.push(stepNode);
    stepNodeIds.push(stepNode.id);
    connectors.push(
      buildFlowConnector(`步骤 ${index + 1}`, previous, stepNode),
    );
    previous = stepNode;
    cursorY += nodeBounds(stepNode).height + 40;

    if (step.toolName) {
      const toolNode = createExecutionCard({
        args,
        body: step.summary ?? `${step.toolName} 将处理这个步骤。`,
        bounds: {
          x: chainX,
          y: cursorY,
          ...getAgentExecutionCanvasSize({
            kind: "tool_call",
            collapsed: true,
          }),
        },
        kind: "tool_call",
        role: ["dataflow", "task"],
        status: step.status === "done" ? "done" : "waiting",
        title: step.toolName,
        toolName: step.toolName,
        upstreamNodeIds: [stepNode.id],
      });
      nodes.push(toolNode);
      toolCallNodeIds.push(toolNode.id);
      connectors.push(buildFlowConnector("调用工具", stepNode, toolNode));
      previous = toolNode;
      cursorY += nodeBounds(toolNode).height + 40;
    }
  });

  let critiqueNodeId: string | undefined;
  if (args.includeCritique) {
    const critiqueNode = createExecutionCard({
      args,
      body: args.critiqueSummary ?? "完成主要步骤后运行验证和评审。",
      bounds: {
        x: chainX,
        y: cursorY,
        ...getAgentExecutionCanvasSize({ kind: "critique", collapsed: true }),
      },
      kind: "critique",
      role: ["task", "context"],
      status: "waiting",
      title: args.critiqueTitle,
      upstreamNodeIds: [previous.id],
    });
    nodes.push(critiqueNode);
    connectors.push(buildFlowConnector("验证结果", previous, critiqueNode));
    previous = critiqueNode;
    critiqueNodeId = critiqueNode.id;
    cursorY += nodeBounds(critiqueNode).height + 40;
  }

  const hasImageGenerationStep = args.steps.some(
    (step) => step.toolName === "generate_image",
  );
  const finalDeliverableNode = createExecutionCard({
    args,
    body: args.finalSummary ?? "最终内容会写入这里，并可继续追问或分支。",
    bounds: {
      x: chainX,
      y: cursorY,
      width: 240,
      height: hasImageGenerationStep ? 320 : 240,
    },
    kind: "final_deliverable",
    role: ["visual"],
    status: "waiting",
    title: args.finalTitle,
    upstreamNodeIds: [previous.id],
  });
  nodes.push(finalDeliverableNode);
  connectors.push(
    buildFlowConnector("形成交付物", previous, finalDeliverableNode),
  );
  cursorY += nodeBounds(finalDeliverableNode).height + 40;

  let checkpointNodeId: string | undefined;
  if (args.includeCheckpoint) {
    const checkpointNode = createExecutionCard({
      args,
      body: "可从这里继续、重跑或复制为新分支。",
      bounds: {
        x: chainX,
        y: cursorY,
        ...getAgentExecutionCanvasSize({ kind: "checkpoint", collapsed: true }),
      },
      checkpoint: {
        canRestartFromHere: true,
        restartReason: "Recipe 已创建到最终交付检查点。",
      },
      kind: "checkpoint",
      role: ["task", "context"],
      status: "waiting",
      title: "继续检查点",
      upstreamNodeIds: [finalDeliverableNode.id],
    });
    nodes.push(checkpointNode);
    connectors.push(
      buildFlowConnector("可继续", finalDeliverableNode, checkpointNode),
    );
    checkpointNodeId = checkpointNode.id;
  }

  const linkedNodes = attachExecutionDownstreamNodeIds(nodes);
  const operations: CanvasOperation[] = [
    ...linkedNodes.map((node) => insertNode(node, args.pageId)),
    ...connectors.map((node) => insertNode(node, args.pageId)),
  ];
  return {
    checkpointNodeId,
    connectorNodeIds: connectors.map((node) => node.id),
    critiqueNodeId,
    finalDeliverableNodeId: finalDeliverableNode.id,
    operations,
    recipeNodeId: recipeNode.id,
    taskStepNodeIds: stepNodeIds,
    toolCallNodeIds,
    userGoalNodeId: userGoalNode.id,
  };
}

function attachExecutionDownstreamNodeIds(nodes: PenNode[]): PenNode[] {
  const downstreamByNodeId = new Map<string, string[]>();
  for (const node of nodes) {
    const execution = getAgentExecutionMeta(node);
    if (!execution?.upstreamNodeIds?.length) continue;
    for (const upstreamNodeId of execution.upstreamNodeIds) {
      const downstream = downstreamByNodeId.get(upstreamNodeId) ?? [];
      downstream.push(node.id);
      downstreamByNodeId.set(upstreamNodeId, downstream);
    }
  }
  return nodes.map((node) => {
    const execution = getAgentExecutionMeta(node);
    const downstreamNodeIds = downstreamByNodeId.get(node.id);
    if (!execution || !downstreamNodeIds?.length) return node;
    return {
      ...node,
      meta: {
        ...(node.meta ?? {}),
        [AGENT_EXECUTION_META_KEY]: {
          ...execution,
          downstreamNodeIds: Array.from(new Set(downstreamNodeIds)),
        },
      },
    } as PenNode;
  });
}

function createExecutionCard(input: {
  args: {
    agentId?: string;
    runId?: string;
    sessionId?: string;
  };
  body: string;
  bounds: CanvasBounds;
  checkpoint?: {
    canRestartFromHere: boolean;
    restartReason?: string;
  };
  kind: AgentExecutionNodeKind;
  role: Array<"visual" | "task" | "context" | "dataflow">;
  status: AgentExecutionStatus;
  title: string;
  toolName?: string;
  upstreamNodeIds?: string[];
}): FrameNode {
  const frameId = createNodeId(`agent_${input.kind}`);
  const node = withAgentExecutionNodeSemantics(
    applyAgentExecutionCardVisualStyle(
      {
        id: frameId,
        type: "frame",
        name: input.title,
        x: input.bounds.x,
        y: input.bounds.y,
        width: input.bounds.width,
        height: input.bounds.height,
        children: createAgentExecutionCardChildren({
          body: input.body,
          bounds: input.bounds,
          collapsed: true,
          kind: input.kind,
          status: input.status,
          title: input.title,
          toolName: input.toolName,
        }),
        clipContent: false,
        containerRole: input.role,
        contextSlots: {
          rules: [`agent execution node: ${input.kind}`],
        },
        permissions: {
          owner: "agent",
          canRead: [],
          canWrite: [],
          isolationLevel: "open",
        },
      },
      {
        body: input.body,
        collapsed: true,
        kind: input.kind,
        status: input.status,
        title: input.title,
        toolName: input.toolName,
      },
    ),
    {
      kind: input.kind,
      status: input.status,
      title: input.title,
      ...(input.args.agentId ? { agentId: input.args.agentId } : {}),
      ...(input.args.runId ? { runId: input.args.runId } : {}),
      ...(input.args.sessionId ? { sessionId: input.args.sessionId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.upstreamNodeIds
        ? { upstreamNodeIds: input.upstreamNodeIds }
        : {}),
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
      canvasPresentation: {
        layoutVersion: 2,
        collapsed: getAgentExecutionCanvasRole(input.kind) === "execution",
      },
      summary: input.body,
    },
    { containerRole: input.role },
  );
  return node as FrameNode;
}

function buildFlowConnector(
  label: string,
  source: PenNode,
  target: PenNode,
): LineNode {
  const sourceBounds = nodeBounds(source);
  const targetBounds = nodeBounds(target);
  const start = connectorPointForNodeBounds(
    source,
    sourceBounds,
    "bottom",
    0.5,
  );
  const end = connectorPointForNodeBounds(target, targetBounds, "top", 0.5);
  return {
    id: createNodeId("connector"),
    type: "line",
    explain: label,
    name: label,
    x: start.x,
    y: start.y,
    x2: end.x,
    y2: end.y,
    connector: {
      arrow: false,
      routing: "smooth",
      start: { nodeId: source.id, ratio: 0.5, side: "bottom" },
      end: { nodeId: target.id, ratio: 0.5, side: "top" },
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

function inferFlowOrigin(
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

function buildAgentExecutionFlowPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildAgentExecutionFlowPlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    userGoalNodeId: args.plan.userGoalNodeId,
    recipeNodeId: args.plan.recipeNodeId,
    taskStepNodeIds: args.plan.taskStepNodeIds,
    toolCallNodeIds: args.plan.toolCallNodeIds,
    critiqueNodeId: args.plan.critiqueNodeId,
    finalDeliverableNodeId: args.plan.finalDeliverableNodeId,
    checkpointNodeId: args.plan.checkpointNodeId,
    connectorNodeIds: args.plan.connectorNodeIds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
