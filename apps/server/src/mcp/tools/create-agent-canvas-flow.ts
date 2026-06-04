import {
  type AgentExecutionNodeKind,
  type AgentExecutionStatus,
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  connectorPointForNodeBounds,
  createNodeId,
  createStickyNoteNode,
  flattenNodes,
  getBoundsUnion,
  getNodeSceneBounds,
  withAgentExecutionNodeSemantics,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";
import { z } from "zod";

import { IMAGE_GENERATION_LOADING_META_ROLE } from "../../features/canvas/canvas-element-writer.js";
import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveState,
} from "./ai-native-canvas-context.js";
import { analyzeCanvasTransaction } from "./ai-native-canvas-transactions.js";

const TOOL_NAME = "create_agent_canvas_flow";

const createAgentCanvasFlowSchema = z.object({
  mode: z.enum(["simple_image_generation"]),
  userInput: z.string().trim().min(1),
  optimizedPrompt: z.string().trim().min(1),
  pageId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentCanvasFlowMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentCanvasFlowSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create a minimal visible Agent canvas execution chain for simple image generation: user input sticky, optimized image prompt sticky, result container, and semantic connector arrows. The returned imagePlacement and resultContainerId should be passed to generate_image.",
    schema: createAgentCanvasFlowSchema,
    inputSchema: schemaToJsonSchema(createAgentCanvasFlowSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentCanvasFlowSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildAgentCanvasFlowPlan({
          agentId: input.agentId,
          doc: live.doc,
          optimizedPrompt: input.optimizedPrompt,
          pageId: input.pageId,
          runId: input.runId,
          sessionId: input.sessionId,
          userInput: input.userInput,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent canvas flow was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] flow.create dry_run", {
            canvasId: live.canvasId,
            inputNodeId: plan.inputNodeId,
            pageId: input.pageId ?? live.doc.activePageId,
            promptNodeId: plan.promptNodeId,
            resultContainerId: plan.resultContainerId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildAgentCanvasFlowPayload({
              analysis,
              dryRun: true,
              nextVersion: live.version,
              optimizedPrompt: input.optimizedPrompt,
              plan,
              success: true,
              userInput: input.userInput,
            }),
          );
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "create_agent_canvas_flow requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.resultContainerId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] flow.create", {
          canvasId: live.canvasId,
          connectorNodeIds: plan.connectorNodeIds,
          inputNodeId: plan.inputNodeId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          promptNodeId: plan.promptNodeId,
          resultContainerId: plan.resultContainerId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildAgentCanvasFlowPayload({
            analysis,
            dryRun: false,
            nextVersion: patchResult.version,
            optimizedPrompt: input.optimizedPrompt,
            plan,
            success: true,
            userInput: input.userInput,
          }),
        );
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "create_agent_canvas_flow_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the Agent canvas flow.",
        };
        console.warn("[ai-native-canvas] flow.create failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildAgentCanvasFlowPlan(args: {
  agentId?: string;
  doc: CucumberCanvasDocument;
  optimizedPrompt: string;
  pageId?: string;
  runId?: string;
  sessionId?: string;
  userInput: string;
}) {
  const origin = inferFlowOrigin(args.doc, args.pageId);
  const inputSticky = withRunMetadata(
    withExecutionMeta(
      createStickyNoteNode(
        { x: origin.x, y: origin.y, width: 260, height: 180 },
        args.userInput,
        { name: "用户原始输入" },
      ),
      {
        args,
        kind: "user_goal",
        status: "done",
        summary: args.userInput,
        title: "用户原始输入",
      },
    ),
    args,
  );
  const promptSticky = withRunMetadata(
    withExecutionMeta(
      createStickyNoteNode(
        { x: origin.x + 360, y: origin.y, width: 300, height: 220 },
        args.optimizedPrompt,
        { name: "优化后的图片 Prompt" },
      ),
      {
        args,
        kind: "recipe_plan",
        status: "done",
        summary: "将用户目标转成可直接执行的图片生成 Prompt。",
        title: "优化后的图片 Prompt",
        upstreamNodeIds: [inputSticky.id],
      },
    ),
    args,
  );
  const resultContainerId = createNodeId("agent_image_result");
  const loadingChildren = buildImageGenerationLoadingChildren(args);
  const resultContainer: FrameNode = withRunMetadata(
    withExecutionMeta(
      {
        id: resultContainerId,
        type: "frame",
        name: "图片结果容器",
        x: origin.x + 760,
        y: origin.y - 20,
        width: 600,
        height: 640,
        children: loadingChildren,
        clipContent: false,
        containerRole: ["visual"],
        contextSlots: {
          rules: ["generated image result for the optimized prompt"],
        },
        fill: [{ type: "solid", color: "rgba(255,255,255,0.86)" }],
        stroke: {
          thickness: 2,
          fill: [{ type: "solid", color: "#1971c2" }],
        },
        cornerRadius: 8,
        permissions: {
          owner: "agent",
          canRead: [],
          canWrite: [],
          isolationLevel: "open",
        },
        ...(args.agentId
          ? {
              agentBinding: {
                agentId: args.agentId,
                name: "Image Generation Flow",
                permissions: ["read", "write"],
                role: "designer",
                status: "running",
              },
            }
          : {}),
      } as FrameNode,
      {
        args,
        kind: "final_deliverable",
        status: "running",
        summary: "图片生成完成后会替换容器内的加载节点。",
        title: "图片结果容器",
        upstreamNodeIds: [promptSticky.id],
      },
    ),
    args,
  ) as FrameNode;
  const connectors = [
    buildFlowConnector({
      label: "理解并优化",
      source: inputSticky,
      target: promptSticky,
    }),
    buildFlowConnector({
      label: "生成图片",
      source: promptSticky,
      target: resultContainer,
    }),
  ].map((node) => withRunMetadata(node, args) as LineNode);
  const operations: CanvasOperation[] = [
    insertNode(inputSticky, args.pageId),
    insertNode(promptSticky, args.pageId),
    insertNode(resultContainer, args.pageId),
    ...connectors.map((node) => insertNode(node, args.pageId)),
  ];
  return {
    connectorNodeIds: connectors.map((node) => node.id),
    imagePlacement: { x: 44, y: 88, width: 512, height: 512 },
    loadingNodeIds: loadingChildren.map((node) => node.id),
    inputNodeId: inputSticky.id,
    operations,
    promptNodeId: promptSticky.id,
    resultContainerBounds: {
      x: resultContainer.x ?? 0,
      y: resultContainer.y ?? 0,
      width: resultContainer.width ?? 600,
      height: resultContainer.height ?? 640,
    },
    resultContainerId,
  };
}

function buildImageGenerationLoadingChildren(args: {
  agentId?: string;
  optimizedPrompt: string;
  runId?: string;
  sessionId?: string;
}): PenNode[] {
  const sharedMeta = {
    agentCanvasRole: IMAGE_GENERATION_LOADING_META_ROLE,
    source: "agent_canvas_flow",
  };
  const loadingPanel = withRunMetadata(
    withExecutionMeta(
      {
        id: createNodeId("agent_image_loading_panel"),
        type: "rectangle",
        name: "生成图片加载区域",
        x: 44,
        y: 88,
        width: 512,
        height: 512,
        cornerRadius: 8,
        fill: [{ type: "solid", color: "rgba(248,250,252,0.96)" }],
        stroke: {
          thickness: 1,
          fill: [{ type: "solid", color: "rgba(15,23,42,0.12)" }],
        },
        meta: sharedMeta,
      } as PenNode,
      {
        args,
        kind: "tool_call",
        status: "running",
        summary: "等待图片生成工具返回资产。",
        title: "图片生成工具",
        toolName: "generate_image",
      },
    ),
    args,
  );
  const loadingText = withRunMetadata(
    withExecutionMeta(
      {
        id: createNodeId("agent_image_loading_text"),
        type: "text",
        name: "生成图片状态",
        x: 80,
        y: 310,
        width: 440,
        height: 72,
        content: "图片生成中...\n完成后会在这里显示结果",
        fontSize: 18,
        fontWeight: 600,
        lineHeight: 1.35,
        textAlign: "center",
        textGrowth: "fixed-width-height",
        fill: [{ type: "solid", color: "rgba(15,23,42,0.68)" }],
        meta: {
          ...sharedMeta,
          promptPreview: args.optimizedPrompt.slice(0, 180),
        },
      } as PenNode,
      {
        args,
        kind: "tool_call",
        status: "running",
        summary: args.optimizedPrompt.slice(0, 180),
        title: "图片生成状态",
        toolName: "generate_image",
      },
    ),
    args,
  );
  return [loadingPanel as PenNode, loadingText as PenNode];
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

function buildFlowConnector(args: {
  label: string;
  source: PenNode;
  target: PenNode;
}): LineNode {
  const sourceBounds = {
    x: args.source.x ?? 0,
    y: args.source.y ?? 0,
    width: (args.source as { width?: number }).width ?? 100,
    height: (args.source as { height?: number }).height ?? 100,
  };
  const targetBounds = {
    x: args.target.x ?? 0,
    y: args.target.y ?? 0,
    width: (args.target as { width?: number }).width ?? 100,
    height: (args.target as { height?: number }).height ?? 100,
  };
  const start = connectorPointForNodeBounds(
    args.source,
    sourceBounds,
    "right",
    0.5,
  );
  const end = connectorPointForNodeBounds(
    args.target,
    targetBounds,
    "left",
    0.5,
  );
  return {
    id: createNodeId("connector"),
    type: "line",
    explain: args.label,
    name: args.label,
    x: start.x,
    y: start.y,
    x2: end.x,
    y2: end.y,
    connector: {
      arrow: true,
      routing: "smooth",
      start: { nodeId: args.source.id, ratio: 0.5, side: "right" },
      end: { nodeId: args.target.id, ratio: 0.5, side: "left" },
    },
    stroke: {
      cap: "round",
      endTip: "line-arrow",
      fill: [{ type: "solid", color: "#1971c2" }],
      thickness: 3,
    },
  };
}

function withRunMetadata<T extends PenNode>(
  node: T,
  args: {
    agentId?: string;
    runId?: string;
    sessionId?: string;
  },
): T {
  return {
    ...node,
    ...(args.agentId ? { createdByAgentId: args.agentId } : {}),
    ...(args.runId ? { runId: args.runId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  };
}

function withExecutionMeta<T extends PenNode>(
  node: T,
  input: {
    args: {
      agentId?: string;
      runId?: string;
      sessionId?: string;
    };
    kind: AgentExecutionNodeKind;
    status: AgentExecutionStatus;
    title: string;
    summary?: string;
    toolName?: string;
    upstreamNodeIds?: string[];
    downstreamNodeIds?: string[];
  },
): T {
  return withAgentExecutionNodeSemantics(node, {
    kind: input.kind,
    status: input.status,
    title: input.title,
    ...(input.args.agentId ? { agentId: input.args.agentId } : {}),
    ...(input.args.runId ? { runId: input.args.runId } : {}),
    ...(input.args.sessionId ? { sessionId: input.args.sessionId } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.upstreamNodeIds
      ? { upstreamNodeIds: input.upstreamNodeIds }
      : {}),
    ...(input.downstreamNodeIds
      ? { downstreamNodeIds: input.downstreamNodeIds }
      : {}),
  });
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

function buildAgentCanvasFlowPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  optimizedPrompt: string;
  plan: ReturnType<typeof buildAgentCanvasFlowPlan>;
  success: boolean;
  userInput: string;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    mode: "simple_image_generation",
    userInput: args.userInput,
    optimizedPrompt: args.optimizedPrompt,
    transactionId: args.analysis.transactionId,
    inputNodeId: args.plan.inputNodeId,
    promptNodeId: args.plan.promptNodeId,
    resultContainerId: args.plan.resultContainerId,
    loadingNodeIds: args.plan.loadingNodeIds,
    connectorNodeIds: args.plan.connectorNodeIds,
    imagePlacement: args.plan.imagePlacement,
    resultContainerBounds: args.plan.resultContainerBounds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
