import {
  type CanvasOperation,
  findNode,
  getAgentBindingStatusForExecutionStatus,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
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

const TOOL_NAME = "record_agent_critique";

const critiqueFindingSchema = z.object({
  severity: z.enum(["info", "warning", "error"]).default("warning"),
  code: z.string().trim().optional(),
  nodeId: z.string().trim().optional(),
  reason: z.string().trim().min(1),
  suggestedFix: z.string().trim().optional(),
});

const recordAgentCritiqueSchema = z.object({
  critiqueNodeId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  summary: z.string().trim().min(1),
  findings: z.array(critiqueFindingSchema).default([]),
  status: z.enum(["done", "failed"]).default("done"),
  pageId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  transactionId: z.string().optional(),
});

export function createRecordAgentCritiqueMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof recordAgentCritiqueSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Record validation or critique results into an existing durable Agent critique node. Use after validate_canvas or critique_canvas so review results become PenNode.meta.agentExecution truth instead of staying only in tool output.",
    schema: recordAgentCritiqueSchema,
    inputSchema: schemaToJsonSchema(recordAgentCritiqueSchema),
    execute: async (args, context) => {
      try {
        const input = recordAgentCritiqueSchema.parse(args);
        const live = await readAiNativeCanvasLiveState(
          deps,
          context,
          TOOL_NAME,
        );
        const pageId = input.pageId ?? live.doc.activePageId;
        const node = findNode(live.doc, input.critiqueNodeId, pageId);
        const execution = getAgentExecutionMeta(node);
        if (!node || execution?.kind !== "critique") {
          throw new Error(
            `record_agent_critique requires an existing critique node. Node ${input.critiqueNodeId} is not a durable Agent critique node.`,
          );
        }
        if (
          input.baseVersion !== undefined &&
          input.baseVersion !== live.version
        ) {
          throw new Error(
            `Canvas patch version mismatch. The live document is at version ${live.version}, but the critique record was based on version ${input.baseVersion}. Refresh the live canvas state and retry.`,
          );
        }

        const body = formatCritiqueBody(input.summary, input.findings);
        const critique = {
          findings: input.findings,
          issueCounts: countCritiqueFindings(input.findings),
          pass:
            input.status === "done" &&
            !input.findings.some((finding) => finding.severity === "error"),
        };
        const updatedChildren = updateFirstTextChild(node, body);
        const nextExecution = {
          ...execution,
          details: {
            ...(execution.details ?? {}),
            outputSummary: body,
          },
          critique,
          status: input.status,
          summary: input.summary,
          title: input.title ?? execution.title,
        };
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
              ...(updatedChildren ? { children: updatedChildren } : {}),
              ...(input.title ? { name: input.title } : {}),
              stroke: {
                ...getNodeStroke(node),
                fill: [
                  {
                    color: input.status === "done" ? "#2f9e44" : "#e03131",
                    type: "solid",
                  },
                ],
                thickness: getNodeStroke(node)?.thickness ?? 1.5,
              },
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
          console.info("[ai-native-canvas] critique.record dry_run", {
            canvasId: live.canvasId,
            critiqueNodeId: node.id,
            findingCount: input.findings.length,
            pageId,
            transactionId: analysis.transactionId,
            userId: live.user.id,
          });
          return jsonResult({
            success: true,
            dryRun: true,
            critiqueNodeId: node.id,
            transactionId: analysis.transactionId,
            previewedOperationCount: analysis.operationCount,
            appliedOperationCount: 0,
            nextDocumentVersion: live.version,
          });
        }

        if (!deps.liveCanvasService) {
          throw new Error(
            "record_agent_critique requires an open live editor. Open the canvas page and retry.",
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
        console.info("[ai-native-canvas] critique.record", {
          canvasId: live.canvasId,
          critiqueNodeId: node.id,
          findingCount: input.findings.length,
          nextVersion: patchResult.version,
          pageId,
          transactionId: analysis.transactionId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          dryRun: false,
          critiqueNodeId: node.id,
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
              : "record_agent_critique_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to record critique results on the live canvas.",
        };
        console.warn("[ai-native-canvas] critique.record failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function formatCritiqueBody(
  summary: string,
  findings: Array<z.infer<typeof critiqueFindingSchema>>,
): string {
  if (findings.length === 0) return summary;
  return [
    summary,
    "",
    ...findings.map((finding, index) => {
      const target = finding.nodeId ? ` · ${finding.nodeId}` : "";
      const fix = finding.suggestedFix
        ? `\n   建议：${finding.suggestedFix}`
        : "";
      return `${index + 1}. [${finding.severity}]${target} ${finding.reason}${fix}`;
    }),
  ].join("\n");
}

function countCritiqueFindings(
  findings: Array<z.infer<typeof critiqueFindingSchema>>,
) {
  return {
    error: findings.filter((finding) => finding.severity === "error").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    warning: findings.filter((finding) => finding.severity === "warning")
      .length,
  };
}

function updateFirstTextChild(
  node: PenNode,
  content: string,
): PenNode[] | undefined {
  if (!("children" in node) || !Array.isArray(node.children)) {
    return undefined;
  }
  let updated = false;
  return node.children.map((child) => {
    if (updated || child.type !== "text") return child;
    updated = true;
    return { ...child, content } as PenNode;
  });
}

function getNodeStroke(node: PenNode):
  | {
      fill?: Array<{ color: string; type: "solid" }>;
      thickness?: number;
    }
  | undefined {
  if (!("stroke" in node)) return undefined;
  return node.stroke as
    | {
        fill?: Array<{ color: string; type: "solid" }>;
        thickness?: number;
      }
    | undefined;
}
