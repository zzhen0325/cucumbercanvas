import {
  type CanvasOperation,
  findNode,
  getAgentBindingStatusForExecutionStatus,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionCanvasFrameUpdates,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
  getNodeBounds,
  withAgentExecutionCanvasPresentation,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
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

const TOOL_NAME = "record_agent_final_deliverable";

const failureSchema = z.object({
  step: z.string().trim().optional(),
  reason: z.string().trim().min(1),
  attempted: z.array(z.string().trim().min(1)).default([]),
  nextActions: z.array(z.string().trim().min(1)).default([]),
});

const recordAgentFinalDeliverableSchema = z.object({
  finalDeliverableNodeId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  summary: z.string().trim().min(1),
  outputSummary: z.string().trim().optional(),
  status: z.enum(["done", "failed"]).default("done"),
  errorReason: z.string().trim().optional(),
  failure: failureSchema.optional(),
  pageId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createRecordAgentFinalDeliverableMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof recordAgentFinalDeliverableSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Record the completed or failed final deliverable state into an existing durable Agent final_deliverable node. Use after writing the actual output on the canvas so the execution chain ends on PenNode.meta.agentExecution truth instead of chat text or run trace.",
    schema: recordAgentFinalDeliverableSchema,
    inputSchema: schemaToJsonSchema(recordAgentFinalDeliverableSchema),
    execute: async (args, context) => {
      try {
        const input = recordAgentFinalDeliverableSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const pageId = input.pageId ?? live.doc.activePageId;
        if (!pageId) {
          throw new Error(
            "record_agent_final_deliverable requires an active canvas page. Refresh the live canvas state and retry.",
          );
        }
        const node = findNode(live.doc, input.finalDeliverableNodeId, pageId);
        const execution = getAgentExecutionMeta(node);
        if (!node || execution?.kind !== "final_deliverable") {
          throw new Error(
            `record_agent_final_deliverable requires an existing final_deliverable node. Node ${input.finalDeliverableNodeId} is not a durable Agent final deliverable node.`,
          );
        }
        if (
          input.baseVersion !== undefined &&
          input.baseVersion !== live.version
        ) {
          throw new Error(
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the final deliverable record was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        const body = formatFinalDeliverableBody({
          errorReason: input.errorReason,
          outputSummary: input.outputSummary,
          summary: input.summary,
        });
        const nextFailure = resolveFinalDeliverableFailure({
          errorReason: input.errorReason,
          explicitFailure: input.failure,
          previousTitle: execution.title,
          status: input.status,
        });
        const { failure: _previousFailure, ...executionWithoutFailure } =
          execution;
        const nextExecution = withAgentExecutionCanvasPresentation({
          ...executionWithoutFailure,
          details: {
            ...(execution.details ?? {}),
            outputSummary: input.outputSummary ?? input.summary,
            ...(input.status === "failed" && input.errorReason
              ? { errorReason: input.errorReason }
              : {}),
          },
          ...(nextFailure ? { failure: nextFailure } : {}),
          status: input.status,
          summary: input.summary,
          title: input.title ?? execution.title,
        });
        const semanticUpdates = getAgentExecutionNodeSemanticUpdates(
          node,
          nextExecution,
          {
            agentBindingStatus: getAgentBindingStatusForExecutionStatus(
              input.status,
            ),
          },
        );
        const operations: CanvasOperation[] = [
          {
            activePageId: pageId,
            nodeId: node.id,
            type: "updateNode",
            updates: {
              ...semanticUpdates,
              ...getAgentExecutionCanvasFrameUpdates({
                body,
                bounds: getNodeBounds(node),
                collapsed: getAgentExecutionCanvasCollapsed(nextExecution),
                execution: nextExecution,
              }),
              ...(input.title ? { name: input.title } : {}),
            } as Partial<PenNode>,
          },
        ];
        const analysis = analyzeCanvasTransaction({
          doc: live.doc,
          operations,
          pageId,
          ...(input.transactionId
            ? { transactionId: input.transactionId }
            : {}),
        });

        if (input.dryRun) {
          console.info("[ai-native-canvas] final_deliverable.record dry_run", {
            canvasId: live.canvasId,
            finalDeliverableNodeId: node.id,
            pageId,
            status: input.status,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult({
            success: true,
            dryRun: true,
            finalDeliverableNodeId: node.id,
            transactionId: analysis.transactionId,
            previewedOperationCount: analysis.operationCount,
            appliedOperationCount: 0,
            nextDocumentVersion: live.version,
          });
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "record_agent_final_deliverable requires an open live editor. Open the canvas page and retry.",
          );
        }
        const patchResult = await deps.liveCanvasService.patchDocument(
          live.user,
          live.canvasId,
          {
            baseVersion: input.baseVersion ?? live.version,
            operations,
            selection: [node.id],
            transactionId: analysis.transactionId,
          },
        );
        console.info("[ai-native-canvas] final_deliverable.record", {
          canvasId: live.canvasId,
          finalDeliverableNodeId: node.id,
          nextVersion: patchResult.version,
          pageId,
          status: input.status,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          dryRun: false,
          finalDeliverableNodeId: node.id,
          transactionId: analysis.transactionId,
          previewedOperationCount: analysis.operationCount,
          appliedOperationCount: analysis.operationCount,
          affectedNodeIds: analysis.affectedNodeIds,
          nextDocumentVersion: patchResult.version,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "record_agent_final_deliverable_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to record final deliverable state on the live canvas.",
        };
        console.warn(
          "[ai-native-canvas] final_deliverable.record failed",
          payload,
        );
        return errorResult(payload);
      }
    },
  };
}

function resolveFinalDeliverableFailure({
  errorReason,
  explicitFailure,
  previousTitle,
  status,
}: {
  errorReason?: string;
  explicitFailure?: z.infer<typeof failureSchema>;
  previousTitle: string;
  status: z.infer<typeof recordAgentFinalDeliverableSchema>["status"];
}) {
  if (status !== "failed") return undefined;
  if (explicitFailure) {
    return {
      ...explicitFailure,
      step: explicitFailure.step ?? previousTitle,
    };
  }
  if (!errorReason) {
    throw new Error(
      "record_agent_final_deliverable status failed requires failure.reason or errorReason.",
    );
  }
  return {
    attempted: ["写入最终交付物", "同步最终交付节点状态"],
    nextActions: ["重试最终交付", "改写输入后继续", "新建分支尝试另一种方案"],
    reason: errorReason,
    step: previousTitle,
  };
}

function formatFinalDeliverableBody(input: {
  errorReason?: string;
  outputSummary?: string;
  summary: string;
}): string {
  const sections = [
    `交付摘要：${input.summary}`,
    input.outputSummary && input.outputSummary !== input.summary
      ? `输出：${input.outputSummary}`
      : undefined,
    input.errorReason ? `失败原因：${input.errorReason}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return sections.join("\n");
}
