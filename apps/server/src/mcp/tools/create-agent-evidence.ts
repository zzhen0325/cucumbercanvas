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

const TOOL_NAME = "create_agent_evidence";

const sourceTypeSchema = z.enum([
  "url",
  "asset",
  "canvas_node",
  "text",
  "search_result",
]);

const createAgentEvidenceSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sourceType: sourceTypeSchema.default("text"),
  url: z.string().trim().optional(),
  assetId: z.string().trim().optional(),
  sourceNodeId: z.string().trim().optional(),
  sourceLabel: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
  upstreamNodeId: z.string().trim().optional(),
  pageId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentEvidenceMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentEvidenceSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create a durable Agent evidence node for sources, references, assets, search results, or canvas-node evidence. Stores provenance on PenNode.meta.agentExecution.evidence and links it to an upstream execution node when provided.",
    schema: createAgentEvidenceSchema,
    inputSchema: schemaToJsonSchema(createAgentEvidenceSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentEvidenceSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const pageId = input.pageId ?? live.doc.activePageId;
        if (!pageId) {
          throw new Error(
            "create_agent_evidence requires an active canvas page. Refresh the live canvas state and retry.",
          );
        }
        const plan = buildEvidencePlan({
          agentId: input.agentId,
          assetId: input.assetId,
          confidence: input.confidence,
          doc: live.doc,
          pageId,
          runId: input.runId,
          sessionId: input.sessionId,
          sourceLabel: input.sourceLabel,
          sourceNodeId: input.sourceNodeId,
          sourceType: input.sourceType,
          summary: input.summary,
          title: input.title,
          upstreamNodeId: input.upstreamNodeId,
          url: input.url,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the Agent evidence node was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] evidence.create dry_run", {
            canvasId: live.canvasId,
            evidenceNodeId: plan.evidenceNodeId,
            pageId,
            sourceType: input.sourceType,
            transactionId: analysis.transactionId,
            upstreamNodeId: input.upstreamNodeId,
            userId: live.user.id,
          });
          return jsonResult(
            buildEvidencePayload({
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
            "create_agent_evidence requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.evidenceNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] evidence.create", {
          canvasId: live.canvasId,
          evidenceNodeId: plan.evidenceNodeId,
          nextVersion: patchResult.version,
          pageId,
          sourceType: input.sourceType,
          transactionId: analysis.transactionId,
          upstreamNodeId: input.upstreamNodeId,
          userId: live.user.id,
        });
        return jsonResult(
          buildEvidencePayload({
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
              : "create_agent_evidence_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the Agent evidence node.",
        };
        console.warn("[ai-native-canvas] evidence.create failed", payload);
        return errorResult(payload);
      }
    },
  };
}

type EvidenceInput = z.infer<typeof createAgentEvidenceSchema>;

function buildEvidencePlan(
  args: Omit<EvidenceInput, "baseVersion" | "dryRun" | "transactionId"> & {
    doc: CucumberCanvasDocument;
    pageId: string;
  },
) {
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
    : inferEvidenceOrigin(args.doc, args.pageId);
  const evidenceNode = createEvidenceCard({
    agentId: args.agentId,
    assetId: args.assetId,
    body: buildEvidenceBody(args),
    bounds: { x: origin.x, y: origin.y, width: 320, height: 180 },
    confidence: args.confidence,
    runId: args.runId,
    sessionId: args.sessionId,
    sourceLabel: args.sourceLabel,
    sourceNodeId: args.sourceNodeId,
    sourceType: args.sourceType,
    summary: args.summary,
    title: args.title,
    upstreamNodeId: upstreamNode?.id,
    url: args.url,
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
                  evidenceNode.id,
                ]),
              ),
            },
          },
        } as Partial<PenNode>,
      });
    }
  }
  operations.push(insertNode(evidenceNode, args.pageId));
  const connector = upstreamNode
    ? buildConnector("参考证据", upstreamNode, evidenceNode)
    : undefined;
  if (connector) {
    operations.push(insertNode(connector, args.pageId));
  }
  return {
    connectorNodeId: connector?.id,
    evidenceNodeId: evidenceNode.id,
    operations,
    upstreamNodeId: upstreamNode?.id,
  };
}

function createEvidenceCard(input: {
  agentId?: string;
  assetId?: string;
  body: string;
  bounds: CanvasBounds;
  confidence?: number;
  runId?: string;
  sessionId?: string;
  sourceLabel?: string;
  sourceNodeId?: string;
  sourceType: z.infer<typeof sourceTypeSchema>;
  summary: string;
  title: string;
  upstreamNodeId?: string;
  url?: string;
}): FrameNode {
  const node = withAgentExecutionNodeSemantics(
    applyAgentExecutionCardVisualStyle(
      {
        children: createAgentExecutionCardChildren({
          body: input.body,
          bounds: input.bounds,
          kind: "evidence",
          status: "done",
          title: input.title,
        }),
        clipContent: false,
        containerRole: ["context"],
        contextSlots: {
          rules: ["agent execution node: evidence"],
        },
        height: input.bounds.height,
        id: createNodeId("agent_evidence"),
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
                status: "completed",
              },
            }
          : {}),
        ...(input.agentId ? { createdByAgentId: input.agentId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
      { kind: "evidence", status: "done" },
    ),
    {
      evidence: {
        sourceType: input.sourceType,
        ...(input.url ? { url: input.url } : {}),
        ...(input.assetId ? { assetId: input.assetId } : {}),
        ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
        ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
        ...(input.confidence != null ? { confidence: input.confidence } : {}),
      },
      kind: "evidence",
      status: "done",
      summary: input.summary,
      title: input.title,
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

function buildEvidenceBody(input: {
  assetId?: string;
  confidence?: number;
  sourceLabel?: string;
  sourceNodeId?: string;
  sourceType: z.infer<typeof sourceTypeSchema>;
  summary: string;
  url?: string;
}): string {
  const lines = [
    input.summary,
    `来源类型：${input.sourceType}`,
    input.sourceLabel ? `来源：${input.sourceLabel}` : undefined,
    input.url ? `URL：${input.url}` : undefined,
    input.assetId ? `Asset：${input.assetId}` : undefined,
    input.sourceNodeId ? `节点：${input.sourceNodeId}` : undefined,
    input.confidence != null ? `置信度：${input.confidence}` : undefined,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function buildConnector(
  label: string,
  source: PenNode,
  target: PenNode,
): LineNode {
  const start = connectorPointForNodeBounds(
    source,
    nodeBounds(source),
    "right",
    0.5,
  );
  const end = connectorPointForNodeBounds(
    target,
    nodeBounds(target),
    "left",
    0.5,
  );
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
    stroke: agentExecutionConnectorStroke("accent"),
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

function inferEvidenceOrigin(
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

function buildEvidencePayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildEvidencePlan>;
  success: boolean;
}) {
  return {
    affectedNodeIds: args.analysis.affectedNodeIds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    connectorNodeId: args.plan.connectorNodeId,
    dryRun: args.dryRun,
    evidenceNodeId: args.plan.evidenceNodeId,
    nextDocumentVersion: args.nextVersion,
    previewedOperationCount: args.analysis.operationCount,
    success: args.success,
    transactionId: args.analysis.transactionId,
    upstreamNodeId: args.plan.upstreamNodeId,
  };
}
