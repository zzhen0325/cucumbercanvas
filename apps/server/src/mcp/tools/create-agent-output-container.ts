import {
  type CanvasBounds,
  type CanvasOperation,
  type FrameNode,
  type PenDocument,
  type PenNode,
  createNodeId,
  getActivePage,
  getBoundsUnion,
  getNodeSceneBounds,
} from "@cucumber/canvas-core";
import type {
  AgentBinding,
  ContainerRole,
  ContextSlots,
  IOPort,
} from "@cucumber/pen-types";
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

const TOOL_NAME = "create_agent_output_container";

const boundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const penNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
  })
  .passthrough();

const createAgentOutputContainerSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["visual", "context", "task", "dataflow"]).default("visual"),
  bounds: boundsSchema.optional(),
  pageId: z.string().optional(),
  agentBinding: z.record(z.string(), z.unknown()).optional(),
  contextSlots: z.record(z.string(), z.unknown()).optional(),
  ioPorts: z.array(z.record(z.string(), z.unknown())).optional(),
  children: z.array(penNodeSchema).optional(),
  createdByAgentId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createAgentOutputContainerMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof createAgentOutputContainerSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Create the canonical frame container for durable Agent canvas output. Stores containerRole, contextSlots, agentBinding, ioPorts, run/session metadata, and optional child nodes on one FrameNode truth.",
    schema: createAgentOutputContainerSchema,
    inputSchema: schemaToJsonSchema(createAgentOutputContainerSchema),
    execute: async (args, context) => {
      try {
        const input = createAgentOutputContainerSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildAgentOutputContainerPlan({
          agentBinding: input.agentBinding as AgentBinding | undefined,
          bounds: input.bounds,
          children: input.children as PenNode[] | undefined,
          contextSlots: input.contextSlots as ContextSlots | undefined,
          createdByAgentId: input.createdByAgentId,
          doc: live.doc,
          ioPorts: input.ioPorts as IOPort[] | undefined,
          name: input.name,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          role: input.role,
          runId: input.runId,
          sessionId: input.sessionId,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the container create was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] output_container.create dry_run", {
            canvasId: live.canvasId,
            containerId: plan.containerId,
            pageId: input.pageId ?? live.doc.activePageId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildAgentOutputContainerPayload({
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
            "create_agent_output_container requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [plan.containerId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] output_container.create", {
          canvasId: live.canvasId,
          childCount: plan.createdChildIds.length,
          containerId: plan.containerId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          role: input.role,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildAgentOutputContainerPayload({
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
              : "create_agent_output_container_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the Agent output container.",
        };
        console.warn(
          "[ai-native-canvas] output_container.create failed",
          payload,
        );
        return errorResult(payload);
      }
    },
  };
}

function buildAgentOutputContainerPlan(args: {
  agentBinding?: AgentBinding;
  bounds?: CanvasBounds;
  children?: PenNode[];
  contextSlots?: ContextSlots;
  createdByAgentId?: string;
  doc: PenDocument;
  ioPorts?: IOPort[];
  name: string;
  pageId?: string;
  role: ContainerRole;
  runId?: string;
  sessionId?: string;
}) {
  const children = structuredClone(args.children ?? []);
  assertUniqueChildIds(children);
  const bounds =
    args.bounds ?? inferOutputContainerBounds(args.doc, args.pageId);
  const containerId = createNodeId("agent_container");
  const node: FrameNode = {
    id: containerId,
    type: "frame",
    children,
    containerRole: [args.role],
    height: bounds.height,
    name: args.name,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
    ...(args.agentBinding ? { agentBinding: args.agentBinding } : {}),
    ...(args.contextSlots ? { contextSlots: args.contextSlots } : {}),
    ...(args.createdByAgentId
      ? { createdByAgentId: args.createdByAgentId }
      : {}),
    ...(args.ioPorts ? { ioPorts: args.ioPorts } : {}),
    ...(args.runId ? { runId: args.runId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  };
  const operations: CanvasOperation[] = [
    {
      type: "insertNode",
      activePageId: args.pageId,
      node,
    },
  ];
  const createdChildIds = collectNodeIds(children);
  return {
    containerId,
    contextSummary: {
      childCount: createdChildIds.length,
      contextSlotKeys: Object.keys(args.contextSlots ?? {}),
      ioPortCount: args.ioPorts?.length ?? 0,
      role: args.role,
    },
    createdChildIds,
    operations,
    outputBounds: bounds,
  };
}

function inferOutputContainerBounds(
  doc: PenDocument,
  pageId: string | undefined,
): CanvasBounds {
  const page = getActivePage(doc, pageId);
  const nodeBounds = page.children
    .map((node) => getNodeSceneBounds(doc, node.id, page.id))
    .filter((bounds): bounds is CanvasBounds => Boolean(bounds));
  if (nodeBounds.length === 0) {
    return { x: 0, y: 0, width: 720, height: 420 };
  }
  const union = getBoundsUnion(nodeBounds);
  return {
    x: union.x + union.width + 80,
    y: union.y,
    width: 720,
    height: 420,
  };
}

function assertUniqueChildIds(children: PenNode[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const nodeId of collectNodeIds(children)) {
    if (seen.has(nodeId)) duplicates.add(nodeId);
    seen.add(nodeId);
  }
  if (duplicates.size === 0) return;
  throw new Error(
    `create_agent_output_container received duplicate child node IDs: ${Array.from(
      duplicates,
    ).join(", ")}.`,
  );
}

function collectNodeIds(nodes: PenNode[]) {
  const ids: string[] = [];
  const visit = (nodeList: PenNode[]) => {
    for (const node of nodeList) {
      ids.push(node.id);
      if ("children" in node && Array.isArray(node.children)) {
        visit(node.children as PenNode[]);
      }
    }
  };
  visit(nodes);
  return ids;
}

function buildAgentOutputContainerPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildAgentOutputContainerPlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    containerId: args.plan.containerId,
    createdChildIds: args.plan.createdChildIds,
    contextSummary: args.plan.contextSummary,
    outputBounds: args.plan.outputBounds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
