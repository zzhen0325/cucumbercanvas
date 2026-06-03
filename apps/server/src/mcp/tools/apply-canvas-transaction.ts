import type { CanvasOperation } from "@cucumber/canvas-core";
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

const TOOL_NAME = "apply_canvas_transaction";

const canvasOperationSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const applyCanvasTransactionSchema = z.object({
  baseVersion: z.number().int().nonnegative().optional(),
  transactionId: z.string().optional(),
  pageId: z.string().optional(),
  operations: z.array(canvasOperationSchema).min(1),
  selection: z.array(z.string()).optional(),
  dryRun: z.boolean().default(false),
  validate: z.boolean().default(true),
  agentId: z.string().optional(),
});

export function createApplyCanvasTransactionMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof applyCanvasTransactionSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Apply a production-grade CanvasOperation[] transaction to the live Cucumber canvas through the patch boundary. Supports dryRun preview, baseVersion protection, selection update, affected-node reporting, and validation preview warnings.",
    schema: applyCanvasTransactionSchema,
    inputSchema: schemaToJsonSchema(applyCanvasTransactionSchema),
    execute: async (args, context) => {
      try {
        const input = applyCanvasTransactionSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const operations = input.operations as CanvasOperation[];
        const analysis = analyzeCanvasTransaction({
          ...(input.agentId ? { agentId: input.agentId } : {}),
          doc: live.doc,
          operations,
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
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the transaction was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        if (input.dryRun) {
          console.info("[ai-native-canvas] transaction.apply dry_run", {
            affectedNodeCount: analysis.affectedNodeIds.length,
            canvasId: live.canvasId,
            operationCount: analysis.operationCount,
            pageId: input.pageId ?? live.doc.activePageId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult(
            buildTransactionPayload({
              analysis,
              dryRun: true,
              nextVersion: live.version,
              success: true,
              validationRequested: input.validate,
            }),
          );
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "apply_canvas_transaction requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion,
            operations,
            ...(input.selection ? { selection: input.selection } : {}),
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] transaction.apply", {
          affectedNodeIds: analysis.affectedNodeIds,
          canvasId: live.canvasId,
          nextVersion: patchResult.version,
          operationCount: analysis.operationCount,
          pageId: input.pageId ?? live.doc.activePageId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult(
          buildTransactionPayload({
            analysis,
            dryRun: false,
            nextVersion: patchResult.version,
            success: true,
            validationRequested: input.validate,
          }),
        );
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "apply_canvas_transaction_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to apply the canvas transaction.",
        };
        console.warn("[ai-native-canvas] transaction.apply failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildTransactionPayload(args: {
  analysis: ReturnType<typeof analyzeCanvasTransaction>;
  dryRun: boolean;
  nextVersion: number;
  success: boolean;
  validationRequested: boolean;
}) {
  return {
    success: args.success,
    dryRun: args.dryRun,
    transactionId: args.analysis.transactionId,
    appliedOperationCount: args.dryRun ? 0 : args.analysis.operationCount,
    previewedOperationCount: args.analysis.operationCount,
    affectedNodeIds: args.analysis.affectedNodeIds,
    createdNodeIds: args.analysis.createdNodeIds,
    updatedNodeIds: args.analysis.updatedNodeIds,
    deletedNodeIds: args.analysis.deletedNodeIds,
    movedNodeIds: args.analysis.movedNodeIds,
    boundingRegion: args.analysis.boundingRegion,
    highRiskChanges: args.analysis.highRiskChanges,
    nextDocumentVersion: args.nextVersion,
    validationResult: args.validationRequested
      ? {
          pass: args.analysis.validationPreviewWarnings.length === 0,
          issues: args.analysis.validationPreviewWarnings,
        }
      : undefined,
  };
}
