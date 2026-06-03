import {
  type CanvasOperation,
  type PenDocument,
  type PenNode,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  getNodeSceneBounds,
} from "@cucumber/canvas-core";
import type { LineNode, PenConnectorSide } from "@cucumber/pen-types";
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

const TOOL_NAME = "connect_nodes";

const connectNodesSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  relationship: z.string().optional(),
  direction: z
    .enum(["source_to_target", "bidirectional"])
    .default("source_to_target"),
  routing: z.enum(["straight", "smooth"]).default("smooth"),
  label: z.string().optional(),
  style: z
    .object({
      strokeColor: z.string().optional(),
      strokeWidth: z.number().positive().optional(),
    })
    .optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  pageId: z.string().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createConnectNodesMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof connectNodesSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create a durable semantic connector line between two visible connector-capable canvas nodes. Inserts a LineNode with connector start/end bindings, route metadata, optional relationship label/name, and versioned live patch support.",
    schema: connectNodesSchema,
    inputSchema: schemaToJsonSchema(connectNodesSchema),
    execute: async (args, context) => {
      try {
        const input = connectNodesSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildConnectNodesPlan({
          direction: input.direction,
          doc: live.doc,
          label: input.label,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          relationship: input.relationship,
          routing: input.routing,
          sourceNodeId: input.sourceNodeId,
          strokeColor: input.style?.strokeColor,
          strokeWidth: input.style?.strokeWidth,
          targetNodeId: input.targetNodeId,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the connector was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] connector.create dry_run", {
            canvasId: live.canvasId,
            connectorNodeId: plan.connectorNodeId,
            pageId: input.pageId ?? live.doc.activePageId,
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildConnectNodesPayload({
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
            "connect_nodes requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.connectorNodeId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] connector.create", {
          canvasId: live.canvasId,
          connectorNodeId: plan.connectorNodeId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          sourceNodeId: input.sourceNodeId,
          targetNodeId: input.targetNodeId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildConnectNodesPayload({
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
              : "connect_nodes_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to connect canvas nodes.",
        };
        console.warn("[ai-native-canvas] connector.create failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildConnectNodesPlan(args: {
  direction: "source_to_target" | "bidirectional";
  doc: PenDocument;
  label?: string;
  pageId?: string;
  relationship?: string;
  routing: "straight" | "smooth";
  sourceNodeId: string;
  strokeColor?: string;
  strokeWidth?: number;
  targetNodeId: string;
}) {
  if (args.sourceNodeId === args.targetNodeId) {
    throw new Error("connect_nodes requires two different node IDs.");
  }
  const sourceNode = requireConnectorTargetNode(
    args.doc,
    args.sourceNodeId,
    args.pageId,
    "source",
  );
  const targetNode = requireConnectorTargetNode(
    args.doc,
    args.targetNodeId,
    args.pageId,
    "target",
  );
  const sourceBounds = getNodeSceneBounds(args.doc, sourceNode.id, args.pageId);
  const targetBounds = getNodeSceneBounds(args.doc, targetNode.id, args.pageId);
  if (!sourceBounds || !targetBounds) {
    throw new Error("connect_nodes could not resolve source or target bounds.");
  }
  const endpoints = chooseConnectorEndpoints(sourceBounds, targetBounds);
  const start = connectorPointForNodeBounds(
    sourceNode,
    sourceBounds,
    endpoints.sourceSide,
    0.5,
  );
  const end = connectorPointForNodeBounds(
    targetNode,
    targetBounds,
    endpoints.targetSide,
    0.5,
  );
  const connectorNodeId = createNodeId("connector");
  const node: LineNode = {
    id: connectorNodeId,
    type: "line",
    explain: args.relationship,
    name: args.label ?? args.relationship ?? "Connector",
    x: start.x,
    y: start.y,
    x2: end.x,
    y2: end.y,
    connector: {
      arrow: args.direction !== "bidirectional",
      end: { nodeId: targetNode.id, ratio: 0.5, side: endpoints.targetSide },
      routing: args.routing,
      start: { nodeId: sourceNode.id, ratio: 0.5, side: endpoints.sourceSide },
    },
    stroke: {
      cap: "round",
      endTip: "line-arrow",
      fill: [
        {
          type: "solid",
          color: args.strokeColor ?? "#111827",
        },
      ],
      ...(args.direction === "bidirectional"
        ? { startTip: "line-arrow" as const }
        : {}),
      thickness: args.strokeWidth ?? 3,
    },
  };
  const operations: CanvasOperation[] = [
    {
      type: "insertNode",
      activePageId: args.pageId,
      node,
    },
  ];
  return {
    connectorNodeId,
    endpointBindings: {
      source: node.connector?.start,
      target: node.connector?.end,
    },
    operations,
    routeSummary: {
      direction: args.direction,
      end,
      relationship: args.relationship,
      routing: args.routing,
      start,
    },
  };
}

function requireConnectorTargetNode(
  doc: PenDocument,
  nodeId: string,
  pageId: string | undefined,
  role: "source" | "target",
) {
  const node = findNode(doc, nodeId, pageId);
  if (!node) {
    throw new Error(`The ${role} node ${nodeId} does not exist.`);
  }
  if (node.visible === false) {
    throw new Error(
      `The ${role} node ${nodeId} is hidden and cannot be connected.`,
    );
  }
  if (!isConnectorTargetNode(node)) {
    throw new Error(
      `The ${role} node ${nodeId} is type ${node.type}, but connect_nodes only supports frame, group, and rectangle targets.`,
    );
  }
  return node;
}

function isConnectorTargetNode(node: PenNode) {
  return (
    node.type === "frame" || node.type === "group" || node.type === "rectangle"
  );
}

function chooseConnectorEndpoints(
  sourceBounds: NonNullable<ReturnType<typeof getNodeSceneBounds>>,
  targetBounds: NonNullable<ReturnType<typeof getNodeSceneBounds>>,
): { sourceSide: PenConnectorSide; targetSide: PenConnectorSide } {
  const sourceCenter = {
    x: sourceBounds.x + sourceBounds.width / 2,
    y: sourceBounds.y + sourceBounds.height / 2,
  };
  const targetCenter = {
    x: targetBounds.x + targetBounds.width / 2,
    y: targetBounds.y + targetBounds.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceSide: "right", targetSide: "left" }
      : { sourceSide: "left", targetSide: "right" };
  }
  return dy >= 0
    ? { sourceSide: "bottom", targetSide: "top" }
    : { sourceSide: "top", targetSide: "bottom" };
}

function buildConnectNodesPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildConnectNodesPlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    connectorNodeId: args.plan.connectorNodeId,
    endpointBindings: args.plan.endpointBindings,
    routeSummary: args.plan.routeSummary,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
