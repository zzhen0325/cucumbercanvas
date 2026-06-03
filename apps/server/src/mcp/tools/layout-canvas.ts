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
import {
  type LayoutCanvasPlan,
  buildLayoutCanvasPlan,
} from "./layout-canvas-planner.js";

const TOOL_NAME = "layout_canvas";

const boundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const layoutCanvasSchema = z.object({
  containerId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  strategy: z.enum([
    "auto_layout",
    "grid",
    "stack",
    "flow",
    "avoid_overlap",
    "align_distribute",
  ]),
  direction: z.enum(["vertical", "horizontal"]).optional(),
  gap: z.number().nonnegative().default(24),
  padding: z
    .union([
      z.number().nonnegative(),
      z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
      z.tuple([
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().nonnegative(),
      ]),
    ])
    .default(24),
  bounds: boundsSchema.optional(),
  preserveManualPositions: z.boolean().default(false),
  baseVersion: z.number().int().nonnegative().optional(),
  pageId: z.string().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createLayoutCanvasMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof layoutCanvasSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Apply conservative layout intent to live canvas nodes. Supports auto-layout field updates, stack/grid/flow placement, avoid-overlap stacking, and align/distribute for nodes sharing one parent coordinate space.",
    schema: layoutCanvasSchema,
    inputSchema: schemaToJsonSchema(layoutCanvasSchema),
    execute: async (args, context) => {
      try {
        const input = layoutCanvasSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildLayoutCanvasPlan({
          bounds: input.bounds,
          containerId: input.containerId,
          direction: input.direction,
          doc: live.doc,
          gap: input.gap,
          nodeIds: input.nodeIds,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          padding: input.padding,
          preserveManualPositions: input.preserveManualPositions,
          strategy: input.strategy,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the layout was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] layout.apply dry_run", {
            canvasId: live.canvasId,
            operationCount: plan.operations.length,
            pageId: input.pageId ?? live.doc.activePageId,
            strategy: input.strategy,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildLayoutPayload({
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
            "layout_canvas requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations: plan.operations,
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] layout.apply", {
          canvasId: live.canvasId,
          nextVersion: patchResult.version,
          operationCount: plan.operations.length,
          pageId: input.pageId ?? live.doc.activePageId,
          strategy: input.strategy,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildLayoutPayload({
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
              : "layout_canvas_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to apply canvas layout.",
        };
        console.warn("[ai-native-canvas] layout.apply failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildLayoutPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: LayoutCanvasPlan;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    strategy: args.plan.strategy,
    affectedNodeIds: args.plan.affectedNodeIds,
    finalBounds: args.plan.finalBounds,
    layoutWarnings: args.plan.layoutWarnings,
    operations: args.plan.operations,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    boundingRegion: args.analysis.boundingRegion,
    nextDocumentVersion: args.nextVersion,
  };
}
