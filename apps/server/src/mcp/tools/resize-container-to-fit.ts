import {
  type CanvasBounds,
  type CanvasOperation,
  type PenDocument,
  type PenNode,
  findNode,
  getBoundsUnion,
  getNodeBounds,
  getNodeSceneBounds,
  getNodeSceneOrigin,
} from "@cucumber/canvas-core";
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

const TOOL_NAME = "resize_container_to_fit";

const resizeContainerToFitSchema = z.object({
  containerId: z.string().min(1),
  padding: z.number().nonnegative().default(24),
  axis: z.enum(["width", "height", "both"]).default("both"),
  minWidth: z.number().positive().optional(),
  minHeight: z.number().positive().optional(),
  maxWidth: z.number().positive().optional(),
  maxHeight: z.number().positive().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  pageId: z.string().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createResizeContainerToFitMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof resizeContainerToFitSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Resize a frame/group container to fit its visible descendant content with padding. Updates only the container width/height through versioned live canvas patch transactions and reports any remaining fit warnings.",
    schema: resizeContainerToFitSchema,
    inputSchema: schemaToJsonSchema(resizeContainerToFitSchema),
    execute: async (args, context) => {
      try {
        const input = resizeContainerToFitSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildResizeContainerToFitPlan({
          axis: input.axis,
          containerId: input.containerId,
          doc: live.doc,
          maxHeight: input.maxHeight,
          maxWidth: input.maxWidth,
          minHeight: input.minHeight,
          minWidth: input.minWidth,
          padding: input.padding,
          ...(input.pageId ? { pageId: input.pageId } : {}),
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the resize was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] container.resize dry_run", {
            canvasId: live.canvasId,
            containerId: input.containerId,
            pageId: input.pageId ?? live.doc.activePageId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildResizePayload({
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
            "resize_container_to_fit requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            selection: [input.containerId],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] container.resize", {
          canvasId: live.canvasId,
          containerId: input.containerId,
          nextVersion: patchResult.version,
          pageId: input.pageId ?? live.doc.activePageId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildResizePayload({
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
              : "resize_container_to_fit_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to resize the canvas container.",
        };
        console.warn("[ai-native-canvas] container.resize failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildResizeContainerToFitPlan(args: {
  axis: "width" | "height" | "both";
  containerId: string;
  doc: PenDocument;
  maxHeight?: number;
  maxWidth?: number;
  minHeight?: number;
  minWidth?: number;
  padding: number;
  pageId?: string;
}) {
  const container = findNode(args.doc, args.containerId, args.pageId);
  if (!container) {
    throw new Error(`Container ${args.containerId} does not exist.`);
  }
  if (!isContainerNode(container)) {
    throw new Error(
      `Node ${args.containerId} is type ${container.type}, but resize_container_to_fit requires a frame or group with children.`,
    );
  }
  const visibleDescendants = collectVisibleDescendants(container);
  if (visibleDescendants.length === 0) {
    throw new Error(
      `Container ${args.containerId} has no visible children to fit.`,
    );
  }
  const childBounds = visibleDescendants
    .map((node) => getNodeSceneBounds(args.doc, node.id, args.pageId))
    .filter((bounds): bounds is CanvasBounds => Boolean(bounds));
  if (childBounds.length === 0) {
    throw new Error(
      `Container ${args.containerId} has no measurable visible child bounds.`,
    );
  }
  const contentBounds = getBoundsUnion(childBounds);
  const containerOrigin = getNodeSceneOrigin(
    args.doc,
    args.containerId,
    args.pageId,
  );
  if (!containerOrigin) {
    throw new Error(`Could not resolve container ${args.containerId} origin.`);
  }
  const previousBounds = getNodeBounds(container);
  const fitWidth =
    contentBounds.x + contentBounds.width - containerOrigin.x + args.padding;
  const fitHeight =
    contentBounds.y + contentBounds.height - containerOrigin.y + args.padding;
  const nextWidth = clampDimension(fitWidth, args.minWidth, args.maxWidth);
  const nextHeight = clampDimension(fitHeight, args.minHeight, args.maxHeight);
  const updates: Partial<PenNode> & { height?: number; width?: number } = {};
  if (args.axis === "width" || args.axis === "both") updates.width = nextWidth;
  if (args.axis === "height" || args.axis === "both")
    updates.height = nextHeight;
  const nextBounds = {
    ...previousBounds,
    width:
      args.axis === "width" || args.axis === "both"
        ? nextWidth
        : previousBounds.width,
    height:
      args.axis === "height" || args.axis === "both"
        ? nextHeight
        : previousBounds.height,
  };
  const operations: CanvasOperation[] = [
    {
      type: "updateNode",
      activePageId: args.pageId,
      nodeId: container.id,
      updates,
    },
  ];
  return {
    affectedChildIds: visibleDescendants.map((node) => node.id),
    contentBounds,
    layoutWarnings: buildResizeWarnings({
      axis: args.axis,
      containerId: container.id,
      containerOrigin,
      contentBounds,
      fitHeight,
      fitWidth,
      maxHeight: args.maxHeight,
      maxWidth: args.maxWidth,
      nextHeight,
      nextWidth,
    }),
    nextBounds,
    operations,
    previousBounds,
  };
}

function isContainerNode(
  node: PenNode,
): node is PenNode & { children: PenNode[] } {
  return (
    (node.type === "frame" || node.type === "group") &&
    "children" in node &&
    Array.isArray(node.children)
  );
}

function collectVisibleDescendants(node: PenNode & { children: PenNode[] }) {
  const result: PenNode[] = [];
  const visit = (children: PenNode[]) => {
    for (const child of children) {
      if (child.visible === false) continue;
      result.push(child);
      if ("children" in child && Array.isArray(child.children)) {
        visit(child.children as PenNode[]);
      }
    }
  };
  visit(node.children);
  return result;
}

function clampDimension(
  value: number,
  minValue: number | undefined,
  maxValue: number | undefined,
) {
  return Math.max(minValue ?? 1, Math.min(value, maxValue ?? value));
}

function buildResizeWarnings(args: {
  axis: "width" | "height" | "both";
  containerId: string;
  containerOrigin: { x: number; y: number };
  contentBounds: CanvasBounds;
  fitHeight: number;
  fitWidth: number;
  maxHeight?: number;
  maxWidth?: number;
  nextHeight: number;
  nextWidth: number;
}) {
  const warnings: { code: string; message: string }[] = [];
  if (args.contentBounds.x < args.containerOrigin.x) {
    warnings.push({
      code: "content_extends_before_container_x",
      message: `Visible content begins left of container ${args.containerId}; resizing width alone cannot move the container origin.`,
    });
  }
  if (args.contentBounds.y < args.containerOrigin.y) {
    warnings.push({
      code: "content_extends_before_container_y",
      message: `Visible content begins above container ${args.containerId}; resizing height alone cannot move the container origin.`,
    });
  }
  if (
    (args.axis === "width" || args.axis === "both") &&
    args.maxWidth !== undefined &&
    args.nextWidth < args.fitWidth
  ) {
    warnings.push({
      code: "max_width_clamps_fit",
      message: `maxWidth ${args.maxWidth} is smaller than the width required to fit visible content.`,
    });
  }
  if (
    (args.axis === "height" || args.axis === "both") &&
    args.maxHeight !== undefined &&
    args.nextHeight < args.fitHeight
  ) {
    warnings.push({
      code: "max_height_clamps_fit",
      message: `maxHeight ${args.maxHeight} is smaller than the height required to fit visible content.`,
    });
  }
  return warnings;
}

function buildResizePayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildResizeContainerToFitPlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    previousBounds: args.plan.previousBounds,
    nextBounds: args.plan.nextBounds,
    contentBounds: args.plan.contentBounds,
    affectedChildIds: args.plan.affectedChildIds,
    layoutWarnings: args.plan.layoutWarnings,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
