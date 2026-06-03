import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import { buildReplaceAssetInNodePlan } from "./ai-native-canvas-assets.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveState,
} from "./ai-native-canvas-context.js";
import { analyzeCanvasTransaction } from "./ai-native-canvas-transactions.js";

const TOOL_NAME = "replace_asset_in_node";

const replaceAssetInNodeSchema = z.object({
  nodeId: z.string().min(1),
  assetId: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  source: z.enum(["upload", "generated", "canvas-ref"]).default("generated"),
  preserveBounds: z.boolean().default(true),
  updatePromptMetadata: z.boolean().default(false),
  baseVersion: z.number().int().nonnegative().optional(),
  pageId: z.string().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createReplaceAssetInNodeMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof replaceAssetInNodeSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Replace an image/video node source or image fill while preserving node identity and layout. Uses PenDocument.assets plus node source/fill fields as the single transaction truth, supports dryRun and baseVersion protection.",
    schema: replaceAssetInNodeSchema,
    inputSchema: schemaToJsonSchema(replaceAssetInNodeSchema),
    execute: async (args, context) => {
      try {
        const input = replaceAssetInNodeSchema.parse(args);
        if (!input.preserveBounds) {
          throw new Error(
            "replace_asset_in_node currently preserves node bounds. Use layout tools after replacement if resizing is required.",
          );
        }
        if (input.updatePromptMetadata) {
          throw new Error(
            "replace_asset_in_node does not update prompt metadata yet because no prompt metadata input was provided.",
          );
        }
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const plan = buildReplaceAssetInNodePlan({
          ...(input.assetId ? { assetId: input.assetId } : {}),
          doc: live.doc,
          ...(input.mimeType ? { mimeType: input.mimeType } : {}),
          nodeId: input.nodeId,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          source: input.source,
          ...(input.url ? { url: input.url } : {}),
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the asset replacement was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] asset.replace dry_run", {
            canvasId: live.canvasId,
            nodeId: input.nodeId,
            operationCount: plan.operations.length,
            pageId: input.pageId ?? live.doc.activePageId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildReplaceAssetPayload({
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
            "replace_asset_in_node requires an open live editor. Open the canvas page and retry.",
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
        console.info("[ai-native-canvas] asset.replace", {
          canvasId: live.canvasId,
          nextVersion: patchResult.version,
          nodeId: input.nodeId,
          operationCount: plan.operations.length,
          pageId: input.pageId ?? live.doc.activePageId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildReplaceAssetPayload({
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
              : "replace_asset_in_node_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to replace the canvas asset.",
        };
        console.warn("[ai-native-canvas] asset.replace failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildReplaceAssetPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  plan: ReturnType<typeof buildReplaceAssetInNodePlan>;
  success: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    targetNodeId: args.plan.targetNodeId,
    targetNodeType: args.plan.targetNodeType,
    updateFieldPath: args.plan.updateFieldPath,
    previousAsset: args.plan.previousAsset,
    nextAsset: args.plan.nextAsset,
    preservedBounds: args.plan.preservedBounds,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    highRiskChanges: args.analysis.highRiskChanges,
    nextDocumentVersion: args.nextVersion,
  };
}
