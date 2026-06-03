import type { CanvasOperation } from "@cucumber/canvas-core";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";
import { analyzeCanvasTransaction } from "./ai-native-canvas-transactions.js";

const TOOL_NAME = "canvas_diff_preview";

const canvasOperationSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const canvasDiffPreviewSchema = z.object({
  operations: z.array(canvasOperationSchema).min(1),
  pageId: z.string().optional(),
  agentId: z.string().optional(),
  summaryMode: z.enum(["compact", "full"]).default("compact"),
  transactionId: z.string().optional(),
});

export function createCanvasDiffPreviewMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof canvasDiffPreviewSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Preview a bounded CanvasOperation[] edit against the latest live Cucumber canvas without mutating it. Returns affected nodes, created/updated/deleted/moved IDs, affected bounds, high-risk changes, and preview warnings.",
    schema: canvasDiffPreviewSchema,
    inputSchema: schemaToJsonSchema(canvasDiffPreviewSchema),
    execute: async (args, context) => {
      try {
        const input = canvasDiffPreviewSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const analysis = analyzeCanvasTransaction({
          ...(input.agentId ? { agentId: input.agentId } : {}),
          doc: live.doc,
          operations: input.operations as CanvasOperation[],
          ...(input.pageId ? { pageId: input.pageId } : {}),
          ...(input.transactionId
            ? { transactionId: input.transactionId }
            : {}),
        });
        const payload = {
          canvasId: live.canvasId,
          summary: `Previewed ${analysis.operationCount} canvas operation(s) without mutating the live document.`,
          transactionIdCandidate: analysis.transactionId,
          operationCount: analysis.operationCount,
          operationsByType: analysis.operationsByType,
          affectedNodeIds: analysis.affectedNodeIds,
          createdNodeIds: analysis.createdNodeIds,
          updatedNodeIds: analysis.updatedNodeIds,
          deletedNodeIds: analysis.deletedNodeIds,
          movedNodeIds: analysis.movedNodeIds,
          boundingRegion: analysis.boundingRegion,
          highRiskChanges: analysis.highRiskChanges,
          validationPreviewWarnings: analysis.validationPreviewWarnings,
          previewDocument:
            input.summaryMode === "full" ? analysis.nextDoc : undefined,
        };
        console.info("[ai-native-canvas] diff.preview", {
          affectedNodeCount: analysis.affectedNodeIds.length,
          canvasId: live.canvasId,
          highRiskCount: analysis.highRiskChanges.length,
          operationCount: analysis.operationCount,
          pageId: input.pageId ?? live.doc.activePageId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(payload);
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "canvas_diff_preview_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to preview the canvas transaction.",
        };
        console.warn("[ai-native-canvas] diff.preview failed", payload);
        return errorResult(payload);
      }
    },
  };
}
