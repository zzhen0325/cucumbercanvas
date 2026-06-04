import {
  type CanvasOperation,
  findNode,
  getAgentBindingStatusForExecutionStatus,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionCanvasFrameUpdates,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
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

const TOOL_NAME = "record_agent_tool_call";

const failureSchema = z.object({
  step: z.string().trim().optional(),
  reason: z.string().trim().min(1),
  attempted: z.array(z.string().trim().min(1)).default([]),
  nextActions: z.array(z.string().trim().min(1)).default([]),
});

const recordAgentToolCallSchema = z.object({
  appendAttempted: z.array(z.string().trim().min(1)).default([]),
  appendNextActions: z.array(z.string().trim().min(1)).default([]),
  executionNodeId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  summary: z.string().trim().optional(),
  toolName: z.string().trim().optional(),
  toolCallId: z.string().trim().optional(),
  status: z
    .enum(["waiting", "running", "done", "failed", "paused"])
    .default("done"),
  inputSummary: z.string().trim().optional(),
  outputSummary: z.string().trim().optional(),
  reasoningSummary: z.string().trim().optional(),
  errorReason: z.string().trim().optional(),
  failure: failureSchema.optional(),
  pageId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createRecordAgentToolCallMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof recordAgentToolCallSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Record tool execution details, output, and failure context into an existing durable Agent tool_call or task_step node. Use after a tool runs so the canvas execution chain shows what was tried, what happened, and what the user can do next.",
    schema: recordAgentToolCallSchema,
    inputSchema: schemaToJsonSchema(recordAgentToolCallSchema),
    execute: async (args, context) => {
      try {
        const input = recordAgentToolCallSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const pageId = input.pageId ?? live.doc.activePageId;
        if (!pageId) {
          throw new Error(
            "record_agent_tool_call requires an active canvas page. Refresh the live canvas state and retry.",
          );
        }
        const node = findNode(live.doc, input.executionNodeId, pageId);
        const execution = getAgentExecutionMeta(node);
        if (
          !node ||
          (execution?.kind !== "tool_call" && execution?.kind !== "task_step")
        ) {
          throw new Error(
            `record_agent_tool_call requires an existing tool_call or task_step node. Node ${input.executionNodeId} is not a writable Agent execution node for tool results.`,
          );
        }
        if (
          input.baseVersion !== undefined &&
          input.baseVersion !== live.version
        ) {
          throw new Error(
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the tool-call record was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        const body = formatToolCallBody({
          errorReason: input.errorReason,
          inputSummary: input.inputSummary,
          outputSummary: input.outputSummary,
          reasoningSummary: input.reasoningSummary,
          summary: input.summary,
        });
        const nextFailure = resolveNextFailure({
          appendAttempted: input.appendAttempted,
          appendNextActions: input.appendNextActions,
          errorReason: input.errorReason,
          explicitFailure: input.failure,
          previousFailure: execution.failure,
          status: input.status,
          stepFallback: input.title ?? execution.title,
        });
        const { failure: _previousFailure, ...executionWithoutFailure } =
          execution;
        const nextExecution = withAgentExecutionCanvasPresentation({
          ...executionWithoutFailure,
          details: {
            ...(execution.details ?? {}),
            ...(input.inputSummary ? { inputSummary: input.inputSummary } : {}),
            ...(input.outputSummary
              ? { outputSummary: input.outputSummary }
              : {}),
            ...(input.reasoningSummary
              ? { reasoningSummary: input.reasoningSummary }
              : {}),
            ...(input.errorReason ? { errorReason: input.errorReason } : {}),
          },
          ...(nextFailure ? { failure: nextFailure } : {}),
          status: input.status,
          summary: input.summary ?? input.outputSummary ?? body,
          title: input.title ?? execution.title,
          ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          ...(input.toolName ? { toolName: input.toolName } : {}),
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
          console.info("[ai-native-canvas] tool_call.record dry_run", {
            canvasId: live.canvasId,
            executionNodeId: node.id,
            pageId,
            status: input.status,
            toolName: input.toolName ?? execution.toolName,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult({
            success: true,
            dryRun: true,
            executionNodeId: node.id,
            transactionId: analysis.transactionId,
            previewedOperationCount: analysis.operationCount,
            appliedOperationCount: 0,
            nextDocumentVersion: live.version,
          });
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "record_agent_tool_call requires an open live editor. Open the canvas page and retry.",
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
        console.info("[ai-native-canvas] tool_call.record", {
          canvasId: live.canvasId,
          executionNodeId: node.id,
          nextVersion: patchResult.version,
          pageId,
          status: input.status,
          toolName: input.toolName ?? execution.toolName,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          dryRun: false,
          executionNodeId: node.id,
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
              : "record_agent_tool_call_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to record tool-call details on the live canvas.",
        };
        console.warn("[ai-native-canvas] tool_call.record failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function resolveNextFailure({
  appendAttempted,
  appendNextActions,
  errorReason,
  explicitFailure,
  previousFailure,
  status,
  stepFallback,
}: {
  appendAttempted: string[];
  appendNextActions: string[];
  errorReason?: string;
  explicitFailure?: {
    attempted: string[];
    nextActions: string[];
    reason: string;
    step?: string;
  };
  previousFailure?: {
    attempted?: string[];
    nextActions?: string[];
    reason: string;
    step: string;
  };
  status: z.infer<typeof recordAgentToolCallSchema>["status"];
  stepFallback: string;
}) {
  if (status !== "failed" && !explicitFailure) return undefined;
  if (explicitFailure) {
    return {
      ...explicitFailure,
      attempted: mergeUniqueStrings(explicitFailure.attempted, appendAttempted),
      nextActions: mergeUniqueStrings(
        explicitFailure.nextActions,
        appendNextActions,
      ),
      step: explicitFailure.step ?? stepFallback,
    };
  }
  if (previousFailure) {
    return {
      ...previousFailure,
      attempted: mergeUniqueStrings(previousFailure.attempted, appendAttempted),
      nextActions: mergeUniqueStrings(
        previousFailure.nextActions,
        appendNextActions,
      ),
    };
  }
  if (!errorReason) {
    throw new Error(
      "record_agent_tool_call status failed requires failure.reason or errorReason when no previous failure exists.",
    );
  }
  return {
    attempted: mergeUniqueStrings([], appendAttempted),
    nextActions: mergeUniqueStrings([], appendNextActions),
    reason: errorReason,
    step: stepFallback,
  };
}

function mergeUniqueStrings(
  current: string[] | undefined,
  additions: string[],
): string[] {
  return Array.from(new Set([...(current ?? []), ...additions]));
}

function formatToolCallBody(input: {
  errorReason?: string;
  inputSummary?: string;
  outputSummary?: string;
  reasoningSummary?: string;
  summary?: string;
}): string {
  const sections = [
    input.summary,
    input.inputSummary ? `输入：${input.inputSummary}` : undefined,
    input.outputSummary ? `输出：${input.outputSummary}` : undefined,
    input.reasoningSummary ? `简要推理：${input.reasoningSummary}` : undefined,
    input.errorReason ? `失败原因：${input.errorReason}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return sections.length > 0 ? sections.join("\n") : "工具执行状态已更新。";
}
