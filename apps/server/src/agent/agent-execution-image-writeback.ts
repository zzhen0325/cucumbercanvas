import {
  AGENT_EXECUTION_META_KEY,
  type CanvasOperation,
  findNode,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionCanvasFrameUpdates,
  getAgentExecutionMeta,
  getNodeBounds,
  withAgentExecutionCanvasPresentation,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";

import type { LiveCanvasService } from "../features/canvas/live-canvas-service.js";
import type { AuthenticatedUser } from "../supabase/user.js";

export type ImageExecutionWritebackStatus = "done" | "failed";

export async function recordImageGenerationExecutionNode(args: {
  canvasId: string;
  elementId?: string;
  errorReason?: string;
  imageUrl?: string;
  jobId: string;
  liveCanvasService: LiveCanvasService;
  nodeId: string;
  status: ImageExecutionWritebackStatus;
  title: string;
  user: AuthenticatedUser;
}): Promise<{ updated: boolean; reason?: string }> {
  try {
    const live = await args.liveCanvasService.getDocumentState(
      args.user,
      args.canvasId,
    );
    const pageId = live.document.activePageId;
    if (!pageId) {
      return { updated: false, reason: "missing_active_page" };
    }
    const node = findNode(live.document, args.nodeId, pageId);
    const execution = getAgentExecutionMeta(node);
    if (
      !node ||
      (execution?.kind !== "tool_call" && execution?.kind !== "task_step")
    ) {
      console.warn("[agent-execution] image_writeback skipped", {
        canvasId: args.canvasId,
        nodeId: args.nodeId,
        reason: "not_tool_call_or_task_step",
      });
      return { updated: false, reason: "not_tool_call_or_task_step" };
    }

    const outputSummary =
      args.status === "done"
        ? `图片生成完成。jobId=${args.jobId}${args.elementId ? `，已写入画布节点 ${args.elementId}` : ""}`
        : `图片生成失败：${args.errorReason ?? "图片生成任务未成功完成。"}`;
    const body = formatImageExecutionBody({
      errorReason: args.status === "failed" ? args.errorReason : undefined,
      outputSummary,
      title: args.title,
    });
    const nextExecution = withAgentExecutionCanvasPresentation({
      ...execution,
      details: {
        ...(execution.details ?? {}),
        outputSummary,
        ...(args.status === "failed" && args.errorReason
          ? { errorReason: args.errorReason }
          : {}),
      },
      ...(args.status === "failed"
        ? {
            failure: {
              attempted: ["提交图片生成任务", "等待后台图片生成完成"],
              nextActions: [
                "重试此步骤",
                "改写提示词后继续",
                "新建分支尝试另一种方案",
              ],
              reason: args.errorReason ?? "图片生成任务未成功完成。",
              step: execution.title,
            },
          }
        : {}),
      status: args.status,
      summary: outputSummary,
      title: execution.title,
      toolName: execution.toolName ?? "generate_image",
    });
    const operations: CanvasOperation[] = [
      {
        activePageId: pageId,
        nodeId: node.id,
        type: "updateNode",
        updates: {
          ...getAgentExecutionCanvasFrameUpdates({
            body,
            bounds: getNodeBounds(node),
            collapsed: getAgentExecutionCanvasCollapsed(nextExecution),
            execution: nextExecution,
          }),
          meta: {
            ...(node.meta ?? {}),
            [AGENT_EXECUTION_META_KEY]: nextExecution,
          },
        } as Partial<PenNode>,
      },
    ];
    const patchResult = await args.liveCanvasService.patchDocument(
      args.user,
      args.canvasId,
      {
        baseVersion: live.version,
        operations,
        selection: [node.id],
        transactionId: `agent_execution_image_${args.jobId}`,
      },
    );
    console.info("[agent-execution] image_writeback", {
      canvasId: args.canvasId,
      jobId: args.jobId,
      nextVersion: patchResult.version,
      nodeId: node.id,
      status: args.status,
    });
    return { updated: true };
  } catch (error) {
    console.warn("[agent-execution] image_writeback failed", {
      canvasId: args.canvasId,
      error: error instanceof Error ? error.message : String(error),
      jobId: args.jobId,
      nodeId: args.nodeId,
    });
    return {
      updated: false,
      reason: error instanceof Error ? error.message : "writeback_failed",
    };
  }
}

function formatImageExecutionBody(input: {
  errorReason?: string;
  outputSummary: string;
  title: string;
}): string {
  return [
    input.title,
    `输出：${input.outputSummary}`,
    input.errorReason ? `失败原因：${input.errorReason}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
