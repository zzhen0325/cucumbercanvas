import {
  AGENT_EXECUTION_META_KEY,
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  flattenNodes,
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

const TOOL_NAME = "create_agent_ask_user_more";

const createAgentAskUserMoreSchema = z.object({
  title: z.string().trim().default("需要用户补充"),
  prompt: z.string().trim().min(1),
  summary: z.string().trim().optional(),
  acceptsFiles: z.boolean().default(false),
  upstreamNodeId: z.string().trim().optional(),
  pageId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentAskUserMoreMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentAskUserMoreSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create a durable Agent ask_user_more node when execution needs user text, file, or image input before continuing. Stores the waiting prompt on PenNode.meta.agentExecution and links it to an upstream execution node when provided.",
    schema: createAgentAskUserMoreSchema,
    inputSchema: schemaToJsonSchema(createAgentAskUserMoreSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentAskUserMoreSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const pageId = input.pageId ?? live.doc.activePageId;
        if (!pageId) {
          throw new Error(
            "create_agent_ask_user_more requires an active canvas page. Refresh the live canvas state and retry.",
          );
        }
        const plan = buildAskUserMorePlan({
          acceptsFiles: input.acceptsFiles,
          agentId: input.agentId,
          doc: live.doc,
          pageId,
          prompt: input.prompt,
          runId: input.runId,
          sessionId: input.sessionId,
          summary: input.summary,
          title: input.title,
          upstreamNodeId: input.upstreamNodeId,
        });
        const analysis = analyzeCanvasTransaction({
          doc: live.doc,
          operations: plan.operations,
          pageId,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent ask-user-more node was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] ask_user_more.create dry_run", {
            acceptsFiles: input.acceptsFiles,
            askUserMoreNodeId: plan.askUserMoreNodeId,
            canvasId: live.canvasId,
            pageId,
            transactionId: analysis.transactionId,
            upstreamNodeId: input.upstreamNodeId,
            userId: live.user.id,
          });
          return jsonResult(
            buildAskUserMorePayload({
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
            "create_agent_ask_user_more requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.askUserMoreNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] ask_user_more.create", {
          acceptsFiles: input.acceptsFiles,
          askUserMoreNodeId: plan.askUserMoreNodeId,
          canvasId: live.canvasId,
          nextVersion: patchResult.version,
          pageId,
          transactionId: analysis.transactionId,
          upstreamNodeId: input.upstreamNodeId,
          userId: live.user.id,
        });
        return jsonResult(
          buildAskUserMorePayload({
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
              : "create_agent_ask_user_more_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the Agent ask-user-more node.",
        };
        console.warn("[ai-native-canvas] ask_user_more.create failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildAskUserMorePlan(args: {
  acceptsFiles: boolean;
  agentId?: string;
  doc: CucumberCanvasDocument;
  pageId: string;
  prompt: string;
  runId?: string;
  sessionId?: string;
  summary?: string;
  title: string;
  upstreamNodeId?: string;
}) {
  const upstreamNode = args.upstreamNodeId
    ? findNode(args.doc, args.upstreamNodeId, args.pageId)
    : undefined;
  if (args.upstreamNodeId && !upstreamNode) {
    throw new Error(
      `Upstream node ${args.upstreamNodeId} does not exist on page ${args.pageId}. Refresh the live canvas state and retry.`,
    );
  }

  const origin = upstreamNode
    ? {
        x:
          (upstreamNode.x ?? 0) +
          ((upstreamNode as { width?: number }).width ?? 280) +
          96,
        y: upstreamNode.y ?? 0,
      }
    : inferAskUserMoreOrigin(args.doc, args.pageId);
  const askNode = createAskUserMoreCard({
    acceptsFiles: args.acceptsFiles,
    agentId: args.agentId,
    body: args.summary ?? args.prompt,
    bounds: { x: origin.x, y: origin.y, width: 320, height: 190 },
    prompt: args.prompt,
    runId: args.runId,
    sessionId: args.sessionId,
    title: args.title,
    upstreamNodeId: upstreamNode?.id,
  });
  const operations: CanvasOperation[] = [];
  if (upstreamNode) {
    const upstreamExecution = getAgentExecutionMeta(upstreamNode);
    if (upstreamExecution) {
      operations.push({
        activePageId: args.pageId,
        nodeId: upstreamNode.id,
        type: "updateNode",
        updates: {
          meta: {
            ...(upstreamNode.meta ?? {}),
            [AGENT_EXECUTION_META_KEY]: {
              ...upstreamExecution,
              downstreamNodeIds: Array.from(
                new Set([
                  ...(upstreamExecution.downstreamNodeIds ?? []),
                  askNode.id,
                ]),
              ),
            },
          },
        } as Partial<PenNode>,
      });
    }
  }
  operations.push(insertNode(askNode, args.pageId));
  const connector = upstreamNode
    ? buildConnector("需要补充", upstreamNode, askNode)
    : undefined;
  if (connector) {
    operations.push(insertNode(connector, args.pageId));
  }

  return {
    askUserMoreNodeId: askNode.id,
    connectorNodeId: connector?.id,
    operations,
    upstreamNodeId: upstreamNode?.id,
  };
}

function createAskUserMoreCard(input: {
  acceptsFiles: boolean;
  agentId?: string;
  body: string;
  bounds: CanvasBounds;
  prompt: string;
  runId?: string;
  sessionId?: string;
  title: string;
  upstreamNodeId?: string;
}): FrameNode {
  const node = withAgentExecutionNodeSemantics(
    applyAgentExecutionCardVisualStyle(
      {
        children: createAgentExecutionCardChildren({
          body: input.body,
          bounds: input.bounds,
          kind: "ask_user_more",
          status: "waiting",
          title: input.title,
        }),
        clipContent: false,
        containerRole: ["task", "context"],
        contextSlots: {
          rules: ["agent execution node: ask_user_more"],
        },
        height: input.bounds.height,
        id: createNodeId("agent_ask_user_more"),
        name: input.title,
        permissions: {
          canRead: [],
          canWrite: [],
          isolationLevel: "open",
          owner: "agent",
        },
        type: "frame",
        width: input.bounds.width,
        x: input.bounds.x,
        y: input.bounds.y,
        ...(input.agentId
          ? {
              agentBinding: {
                agentId: input.agentId,
                name: input.title,
                permissions: ["read", "write"],
                role: "assistant",
                status: "idle",
              },
            }
          : {}),
        ...(input.agentId ? { createdByAgentId: input.agentId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
      {
        body: input.body,
        collapsed: true,
        kind: "ask_user_more",
        status: "waiting",
        title: input.title,
      },
    ),
    {
      kind: "ask_user_more",
      canvasPresentation: {
        layoutVersion: 2,
        collapsed: true,
      },
      status: "waiting",
      summary: input.body,
      title: input.title,
      waitingForUser: {
        acceptsFiles: input.acceptsFiles,
        prompt: input.prompt,
      },
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.upstreamNodeId
        ? { upstreamNodeIds: [input.upstreamNodeId] }
        : {}),
    },
  );
  return node as FrameNode;
}

function buildConnector(
  label: string,
  source: PenNode,
  target: PenNode,
): LineNode {
  const sourceBounds = nodeBounds(source);
  const targetBounds = nodeBounds(target);
  const start = connectorPointForNodeBounds(source, sourceBounds, "right", 0.5);
  const end = connectorPointForNodeBounds(target, targetBounds, "left", 0.5);
  return {
    connector: {
      arrow: true,
      end: { nodeId: target.id, ratio: 0.5, side: "left" },
      routing: "smooth",
      start: { nodeId: source.id, ratio: 0.5, side: "right" },
    },
    explain: label,
    id: createNodeId("connector"),
    name: label,
    stroke: agentExecutionConnectorStroke("warning"),
    type: "line",
    x: start.x,
    x2: end.x,
    y: start.y,
    y2: end.y,
  };
}

function nodeBounds(node: PenNode): CanvasBounds {
  return {
    height: (node as { height?: number }).height ?? 100,
    width: (node as { width?: number }).width ?? 100,
    x: node.x ?? 0,
    y: node.y ?? 0,
  };
}

function inferAskUserMoreOrigin(
  doc: CucumberCanvasDocument,
  pageId: string,
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
    activePageId: pageId,
    node,
    type: "insertNode",
  };
}

function buildAskUserMorePayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildAskUserMorePlan>;
  success: boolean;
}) {
  return {
    affectedNodeIds: args.analysis.affectedNodeIds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    askUserMoreNodeId: args.plan.askUserMoreNodeId,
    connectorNodeId: args.plan.connectorNodeId,
    dryRun: args.dryRun,
    nextDocumentVersion: args.nextVersion,
    previewedOperationCount: args.analysis.operationCount,
    success: args.success,
    transactionId: args.analysis.transactionId,
    upstreamNodeId: args.plan.upstreamNodeId,
  };
}
