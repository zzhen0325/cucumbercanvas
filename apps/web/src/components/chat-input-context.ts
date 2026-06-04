import {
  type AgentExecutionNodeKind,
  type AgentExecutionStatus,
  type AgentRecipeTemplate,
  formatAgentRecipeTemplatePromptBlock,
} from "@cucumber/canvas-core";
import type { CanvasSelectedElement } from "./canvas-editor";

const BRANCH_MAINLINE_SELECTION_INSTRUCTION =
  "这个 variant_branch 还不是当前主线。继续深化前先用 node_id 调用 select_agent_variant_branch，把该分支设为 comparison 的主线，同时保留 sibling branches。";
const CHECKPOINT_RERUN_DOWNSTREAM_INSTRUCTION =
  "从 checkpoint 重跑时，把这些 downstream_node_ids 视为需要重建、覆盖或明确标记为旧版本的下游执行链；先回读 checkpoint 和这些节点的当前 PenDocument.pages 状态，再写入新的 task/tool/critique/final_deliverable/checkpoint 节点。";
const PAUSED_CONTINUATION_INSTRUCTION =
  "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。";

export type AgentContinuationMode = "new_branch" | "overwrite_current";
export type AgentContinuationIntent =
  | "attach_files"
  | "continue"
  | "new_branch"
  | "retry"
  | "rerun_checkpoint"
  | "rewrite"
  | "skip";

export type ChatInputSendContext = {
  recipeTemplate?: AgentRecipeTemplate;
  agentExecutionContinuation?: {
    intent?: AgentContinuationIntent;
    mode: AgentContinuationMode;
    nodeId: string;
    nodeTitle: string;
    nodeKind: string;
    nodeStatus: string;
    runId?: string;
    toolName?: string;
    upstreamNodeIds?: string[];
    downstreamNodeIds?: string[];
    branchId?: string;
    branchLabel?: string;
    branchPlanSummary?: string;
    branchDeliverableSummary?: string;
    branchCritiqueSummary?: string;
    branchStrengths?: string[];
    branchRisks?: string[];
    branchUseCases?: string[];
    branchIsMainline?: boolean;
    branchContinueRequiresMainlineSelection?: boolean;
    branchContinueInstruction?: string;
    comparisonBranchNodeIds?: string[];
    comparisonRecommendedBranchId?: string;
    comparisonRecommendationReason?: string;
    checkpointCanRestartFromHere?: boolean;
    checkpointRestartReason?: string;
    checkpointRerunDownstreamNodeIds?: string[];
    checkpointRerunInstruction?: string;
    pausedContinuationInstruction?: string;
    waitingPrompt?: string;
    waitingResponseText?: string;
    waitingAttachmentCount?: number;
    failureStep?: string;
    failureReason?: string;
    failureAttempted?: string[];
    failureNextActions?: string[];
  };
  canvasNodeReferences?: CanvasNodeReference[];
};

export type CanvasNodeReference = {
  nodeId: string;
  label: string;
  type: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  agentExecution?: {
    kind: AgentExecutionNodeKind;
    status: AgentExecutionStatus;
    title: string;
    runId?: string;
    toolName?: string;
    upstreamNodeIds?: string[];
    downstreamNodeIds?: string[];
    branchId?: string;
    branchLabel?: string;
    branchPlanSummary?: string;
    branchDeliverableSummary?: string;
    branchCritiqueSummary?: string;
    branchStrengths?: string[];
    branchRisks?: string[];
    branchUseCases?: string[];
    branchIsMainline?: boolean;
    branchContinueRequiresMainlineSelection?: boolean;
    branchContinueInstruction?: string;
    comparisonBranchNodeIds?: string[];
    comparisonRecommendedBranchId?: string;
    comparisonRecommendationReason?: string;
    checkpointCanRestartFromHere?: boolean;
    checkpointRestartReason?: string;
    pausedContinuationInstruction?: string;
    waitingPrompt?: string;
    waitingResponseText?: string;
    waitingAttachmentCount?: number;
    failureStep?: string;
    failureReason?: string;
    failureAttempted?: string[];
    failureNextActions?: string[];
  };
};

export function formatAgentExecutionContinuationPrompt(
  message: string,
  context?: ChatInputSendContext,
): string {
  const continuation = context?.agentExecutionContinuation;
  const canvasNodeReferences = context?.canvasNodeReferences;
  const recipeTemplate = context?.recipeTemplate;
  if (!recipeTemplate && !continuation && !canvasNodeReferences?.length) {
    return message;
  }

  const lines = [
    ...(recipeTemplate
      ? [formatAgentRecipeTemplatePromptBlock(recipeTemplate)]
      : []),
    ...formatAgentContinuationContextLines(continuation),
    ...formatCanvasNodeReferenceLines(canvasNodeReferences),
    "",
    message,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

export function buildAgentContinuationContext(
  selectedCanvasElements: CanvasSelectedElement[] | undefined,
  mode: AgentContinuationMode,
  intent?: AgentContinuationIntent,
  options: { waitingResponseText?: string } = {},
): NonNullable<ChatInputSendContext["agentExecutionContinuation"]> | undefined {
  const selectedAgentElement = selectedCanvasElements?.find(
    (element) => element.agentExecution,
  );
  const execution = selectedAgentElement?.agentExecution;
  if (!selectedAgentElement || !execution) return undefined;
  const waitingResponseText =
    options.waitingResponseText?.trim() ||
    execution.waitingForUser?.response?.text?.trim();
  const branchContinueRequiresMainlineSelection =
    execution.kind === "variant_branch" &&
    execution.branch?.isMainline === false &&
    Boolean(execution.comparison?.branchNodeIds.length);
  const checkpointRerunDownstreamNodeIds =
    intent === "rerun_checkpoint" &&
    execution.kind === "checkpoint" &&
    execution.downstreamNodeIds?.length
      ? execution.downstreamNodeIds
      : undefined;
  return {
    ...(intent ? { intent } : {}),
    mode,
    nodeId: selectedAgentElement.id,
    nodeTitle: execution.title,
    nodeKind: execution.kind,
    nodeStatus: execution.status,
    ...(execution.runId ? { runId: execution.runId } : {}),
    ...(execution.toolName ? { toolName: execution.toolName } : {}),
    ...(execution.upstreamNodeIds?.length
      ? { upstreamNodeIds: execution.upstreamNodeIds }
      : {}),
    ...(execution.downstreamNodeIds?.length
      ? { downstreamNodeIds: execution.downstreamNodeIds }
      : {}),
    ...(execution.branchId ? { branchId: execution.branchId } : {}),
    ...(execution.branchLabel ? { branchLabel: execution.branchLabel } : {}),
    ...(execution.branch?.planSummary
      ? { branchPlanSummary: execution.branch.planSummary }
      : {}),
    ...(execution.branch?.deliverableSummary
      ? { branchDeliverableSummary: execution.branch.deliverableSummary }
      : {}),
    ...(execution.branch?.critiqueSummary
      ? { branchCritiqueSummary: execution.branch.critiqueSummary }
      : {}),
    ...(execution.branch?.strengths?.length
      ? { branchStrengths: execution.branch.strengths }
      : {}),
    ...(execution.branch?.risks?.length
      ? { branchRisks: execution.branch.risks }
      : {}),
    ...(execution.branch?.useCases?.length
      ? { branchUseCases: execution.branch.useCases }
      : {}),
    ...(execution.branch?.isMainline !== undefined
      ? { branchIsMainline: execution.branch.isMainline }
      : {}),
    ...(branchContinueRequiresMainlineSelection
      ? {
          branchContinueInstruction: BRANCH_MAINLINE_SELECTION_INSTRUCTION,
          branchContinueRequiresMainlineSelection: true,
        }
      : {}),
    ...(execution.comparison?.branchNodeIds.length
      ? { comparisonBranchNodeIds: execution.comparison.branchNodeIds }
      : {}),
    ...(execution.comparison?.recommendedBranchId
      ? {
          comparisonRecommendedBranchId:
            execution.comparison.recommendedBranchId,
        }
      : {}),
    ...(execution.comparison?.recommendationReason
      ? {
          comparisonRecommendationReason:
            execution.comparison.recommendationReason,
        }
      : {}),
    ...(execution.checkpoint?.canRestartFromHere !== undefined
      ? {
          checkpointCanRestartFromHere: execution.checkpoint.canRestartFromHere,
        }
      : {}),
    ...(execution.checkpoint?.restartReason
      ? { checkpointRestartReason: execution.checkpoint.restartReason }
      : {}),
    ...(checkpointRerunDownstreamNodeIds
      ? {
          checkpointRerunDownstreamNodeIds,
          checkpointRerunInstruction: CHECKPOINT_RERUN_DOWNSTREAM_INSTRUCTION,
        }
      : {}),
    ...(execution.status === "paused"
      ? { pausedContinuationInstruction: PAUSED_CONTINUATION_INSTRUCTION }
      : {}),
    ...(execution.waitingForUser?.prompt
      ? { waitingPrompt: execution.waitingForUser.prompt }
      : {}),
    ...(waitingResponseText ? { waitingResponseText } : {}),
    ...(execution.failure?.step ? { failureStep: execution.failure.step } : {}),
    ...(execution.failure?.reason
      ? { failureReason: execution.failure.reason }
      : {}),
    ...(execution.failure?.attempted?.length
      ? { failureAttempted: execution.failure.attempted }
      : {}),
    ...(execution.failure?.nextActions?.length
      ? { failureNextActions: execution.failure.nextActions }
      : {}),
  };
}

export function buildChatInputSendContext(
  agentExecutionContinuation:
    | NonNullable<ChatInputSendContext["agentExecutionContinuation"]>
    | undefined,
  canvasNodeReferences: CanvasNodeReference[],
  recipeTemplate?: AgentRecipeTemplate,
): ChatInputSendContext | undefined {
  if (
    !recipeTemplate &&
    !agentExecutionContinuation &&
    canvasNodeReferences.length === 0
  ) {
    return undefined;
  }
  return {
    ...(recipeTemplate ? { recipeTemplate } : {}),
    ...(agentExecutionContinuation ? { agentExecutionContinuation } : {}),
    ...(canvasNodeReferences.length > 0 ? { canvasNodeReferences } : {}),
  };
}

export function buildCanvasNodeReference(
  element: CanvasSelectedElement,
): CanvasNodeReference {
  const textLabel = element.text?.trim();
  const agentExecution = element.agentExecution;
  const branchContinueRequiresMainlineSelection =
    agentExecution?.kind === "variant_branch" &&
    agentExecution.branch?.isMainline === false &&
    Boolean(agentExecution.comparison?.branchNodeIds.length);
  const label =
    agentExecution?.title ||
    (textLabel ? textLabel.slice(0, 48) : undefined) ||
    `${element.type} ${element.id.slice(0, 6)}`;
  return {
    bounds: {
      height: element.height,
      width: element.width,
      x: element.x,
      y: element.y,
    },
    label,
    nodeId: element.id,
    type: element.type,
    ...(agentExecution
      ? {
          agentExecution: {
            kind: agentExecution.kind,
            status: agentExecution.status,
            title: agentExecution.title,
            ...(agentExecution.runId ? { runId: agentExecution.runId } : {}),
            ...(agentExecution.toolName
              ? { toolName: agentExecution.toolName }
              : {}),
            ...(agentExecution.upstreamNodeIds?.length
              ? { upstreamNodeIds: agentExecution.upstreamNodeIds }
              : {}),
            ...(agentExecution.downstreamNodeIds?.length
              ? { downstreamNodeIds: agentExecution.downstreamNodeIds }
              : {}),
            ...(agentExecution.branchId
              ? { branchId: agentExecution.branchId }
              : {}),
            ...(agentExecution.branchLabel
              ? { branchLabel: agentExecution.branchLabel }
              : {}),
            ...(agentExecution.branch?.planSummary
              ? { branchPlanSummary: agentExecution.branch.planSummary }
              : {}),
            ...(agentExecution.branch?.deliverableSummary
              ? {
                  branchDeliverableSummary:
                    agentExecution.branch.deliverableSummary,
                }
              : {}),
            ...(agentExecution.branch?.critiqueSummary
              ? {
                  branchCritiqueSummary: agentExecution.branch.critiqueSummary,
                }
              : {}),
            ...(agentExecution.branch?.strengths?.length
              ? { branchStrengths: agentExecution.branch.strengths }
              : {}),
            ...(agentExecution.branch?.risks?.length
              ? { branchRisks: agentExecution.branch.risks }
              : {}),
            ...(agentExecution.branch?.useCases?.length
              ? { branchUseCases: agentExecution.branch.useCases }
              : {}),
            ...(agentExecution.branch?.isMainline !== undefined
              ? { branchIsMainline: agentExecution.branch.isMainline }
              : {}),
            ...(branchContinueRequiresMainlineSelection
              ? {
                  branchContinueInstruction:
                    BRANCH_MAINLINE_SELECTION_INSTRUCTION,
                  branchContinueRequiresMainlineSelection: true,
                }
              : {}),
            ...(agentExecution.comparison?.branchNodeIds.length
              ? {
                  comparisonBranchNodeIds:
                    agentExecution.comparison.branchNodeIds,
                }
              : {}),
            ...(agentExecution.comparison?.recommendedBranchId
              ? {
                  comparisonRecommendedBranchId:
                    agentExecution.comparison.recommendedBranchId,
                }
              : {}),
            ...(agentExecution.comparison?.recommendationReason
              ? {
                  comparisonRecommendationReason:
                    agentExecution.comparison.recommendationReason,
                }
              : {}),
            ...(agentExecution.checkpoint?.canRestartFromHere !== undefined
              ? {
                  checkpointCanRestartFromHere:
                    agentExecution.checkpoint.canRestartFromHere,
                }
              : {}),
            ...(agentExecution.checkpoint?.restartReason
              ? {
                  checkpointRestartReason:
                    agentExecution.checkpoint.restartReason,
                }
              : {}),
            ...(agentExecution.status === "paused"
              ? {
                  pausedContinuationInstruction:
                    PAUSED_CONTINUATION_INSTRUCTION,
                }
              : {}),
            ...(agentExecution.waitingForUser?.prompt
              ? { waitingPrompt: agentExecution.waitingForUser.prompt }
              : {}),
            ...(agentExecution.waitingForUser?.response?.text?.trim()
              ? {
                  waitingResponseText:
                    agentExecution.waitingForUser.response.text.trim(),
                }
              : {}),
            ...(agentExecution.waitingForUser?.response?.attachmentCount !==
            undefined
              ? {
                  waitingAttachmentCount:
                    agentExecution.waitingForUser.response.attachmentCount,
                }
              : {}),
            ...(agentExecution.failure?.step
              ? { failureStep: agentExecution.failure.step }
              : {}),
            ...(agentExecution.failure?.reason
              ? { failureReason: agentExecution.failure.reason }
              : {}),
            ...(agentExecution.failure?.attempted?.length
              ? { failureAttempted: agentExecution.failure.attempted }
              : {}),
            ...(agentExecution.failure?.nextActions?.length
              ? { failureNextActions: agentExecution.failure.nextActions }
              : {}),
          },
        }
      : {}),
  };
}

function formatAgentContinuationContextLines(
  continuation: ChatInputSendContext["agentExecutionContinuation"],
): string[] {
  if (!continuation) return [];
  const modeInstruction =
    continuation.mode === "new_branch"
      ? "新分支继续：保留当前节点和原分支，在画布上创建或延续新的 variant_branch / checkpoint 链路。"
      : "覆盖当前节点继续：基于当前节点改写或更新同一主线，不要无关重建其他节点。";
  const intentInstruction = continuation.intent
    ? getAgentContinuationIntentInstruction(continuation.intent)
    : undefined;
  return [
    "<agent_execution_continue_context>",
    `mode: ${continuation.mode}`,
    `mode_instruction: ${modeInstruction}`,
    continuation.intent ? `intent: ${continuation.intent}` : undefined,
    intentInstruction ? `intent_instruction: ${intentInstruction}` : undefined,
    `node_id: ${continuation.nodeId}`,
    `node_title: ${sanitizePromptLine(continuation.nodeTitle)}`,
    `node_kind: ${continuation.nodeKind}`,
    `node_status: ${continuation.nodeStatus}`,
    continuation.runId ? `run_id: ${continuation.runId}` : undefined,
    continuation.toolName ? `tool_name: ${continuation.toolName}` : undefined,
    continuation.upstreamNodeIds?.length
      ? `upstream_node_ids: ${continuation.upstreamNodeIds.join(", ")}`
      : undefined,
    continuation.downstreamNodeIds?.length
      ? `downstream_node_ids: ${continuation.downstreamNodeIds.join(", ")}`
      : undefined,
    continuation.branchId ? `branch_id: ${continuation.branchId}` : undefined,
    continuation.branchLabel
      ? `branch_label: ${sanitizePromptLine(continuation.branchLabel)}`
      : undefined,
    continuation.branchPlanSummary
      ? `branch_plan_summary: ${sanitizePromptLine(continuation.branchPlanSummary)}`
      : undefined,
    continuation.branchDeliverableSummary
      ? `branch_deliverable_summary: ${sanitizePromptLine(continuation.branchDeliverableSummary)}`
      : undefined,
    continuation.branchCritiqueSummary
      ? `branch_critique_summary: ${sanitizePromptLine(continuation.branchCritiqueSummary)}`
      : undefined,
    continuation.branchStrengths?.length
      ? `branch_strengths: ${sanitizePromptList(continuation.branchStrengths)}`
      : undefined,
    continuation.branchRisks?.length
      ? `branch_risks: ${sanitizePromptList(continuation.branchRisks)}`
      : undefined,
    continuation.branchUseCases?.length
      ? `branch_use_cases: ${sanitizePromptList(continuation.branchUseCases)}`
      : undefined,
    continuation.branchIsMainline !== undefined
      ? `branch_is_mainline: ${continuation.branchIsMainline ? "true" : "false"}`
      : undefined,
    continuation.branchContinueRequiresMainlineSelection !== undefined
      ? `branch_continue_requires_mainline_selection: ${
          continuation.branchContinueRequiresMainlineSelection
            ? "true"
            : "false"
        }`
      : undefined,
    continuation.branchContinueInstruction
      ? `branch_continue_instruction: ${sanitizePromptLine(continuation.branchContinueInstruction)}`
      : undefined,
    continuation.comparisonBranchNodeIds?.length
      ? `comparison_branch_node_ids: ${continuation.comparisonBranchNodeIds.join(", ")}`
      : undefined,
    continuation.comparisonRecommendedBranchId
      ? `comparison_recommended_branch_id: ${continuation.comparisonRecommendedBranchId}`
      : undefined,
    continuation.comparisonRecommendationReason
      ? `comparison_recommendation_reason: ${sanitizePromptLine(continuation.comparisonRecommendationReason)}`
      : undefined,
    continuation.checkpointCanRestartFromHere !== undefined
      ? `checkpoint_can_restart_from_here: ${
          continuation.checkpointCanRestartFromHere ? "true" : "false"
        }`
      : undefined,
    continuation.checkpointRestartReason
      ? `checkpoint_restart_reason: ${sanitizePromptLine(continuation.checkpointRestartReason)}`
      : undefined,
    continuation.checkpointRerunDownstreamNodeIds?.length
      ? `checkpoint_rerun_downstream_node_ids: ${continuation.checkpointRerunDownstreamNodeIds.join(", ")}`
      : undefined,
    continuation.checkpointRerunInstruction
      ? `checkpoint_rerun_instruction: ${sanitizePromptLine(continuation.checkpointRerunInstruction)}`
      : undefined,
    continuation.pausedContinuationInstruction
      ? `paused_continuation_instruction: ${sanitizePromptLine(continuation.pausedContinuationInstruction)}`
      : undefined,
    continuation.waitingPrompt
      ? `waiting_prompt: ${sanitizePromptLine(continuation.waitingPrompt)}`
      : undefined,
    continuation.waitingResponseText
      ? `waiting_response_text: ${sanitizePromptLine(continuation.waitingResponseText)}`
      : undefined,
    continuation.waitingAttachmentCount !== undefined
      ? `waiting_attachment_count: ${continuation.waitingAttachmentCount}`
      : undefined,
    continuation.failureStep
      ? `failure_step: ${sanitizePromptLine(continuation.failureStep)}`
      : undefined,
    continuation.failureReason
      ? `failure_reason: ${sanitizePromptLine(continuation.failureReason)}`
      : undefined,
    continuation.failureAttempted?.length
      ? `failure_attempted: ${sanitizePromptList(continuation.failureAttempted)}`
      : undefined,
    continuation.failureNextActions?.length
      ? `failure_next_actions: ${sanitizePromptList(continuation.failureNextActions)}`
      : undefined,
    "</agent_execution_continue_context>",
  ].filter((line): line is string => Boolean(line));
}

function getAgentContinuationIntentInstruction(
  intent: AgentContinuationIntent,
): string {
  switch (intent) {
    case "attach_files":
      return "用户正在为等待节点补充文件或图片；读取 waiting_prompt / waiting_attachment_count，并从该 ask_user_more 节点继续。";
    case "continue":
      return "从当前选中执行节点继续下一步，先 inspect 该节点及上下游，再创建或更新后续执行链节点。";
    case "new_branch":
      return "复制为新分支继续，保留当前节点、原主线和未选分支，不要覆盖既有产物。";
    case "retry":
      return "重试当前失败步骤；沿用原输入和上下文，成功则写回状态/结果，失败则更新同一节点的失败原因和 nextActions。";
    case "rerun_checkpoint":
      return "从 checkpoint 重跑后续链路；保留 checkpoint 作为锚点，重建下游步骤、产物和验证结果。";
    case "rewrite":
      return "按用户改写后的输入或约束继续，并更新同一主线的相关 task/tool/final 节点。";
    case "skip":
      return "跳过当前失败步骤，继续可完成的后续任务，并在画布执行链记录跳过原因。";
  }
}

function formatCanvasNodeReferenceLines(
  references: CanvasNodeReference[] | undefined,
): string[] {
  if (!references?.length) return [];
  const lines = [
    "<canvas_node_references>",
    "instruction: These are user-added live canvas node references. Inspect the current PenDocument.pages node ids before editing; do not treat this block as copied canvas truth.",
    `reference_count: ${references.length}`,
  ];
  for (const reference of references) {
    lines.push(
      `node_id: ${reference.nodeId}`,
      `label: ${sanitizePromptLine(reference.label)}`,
      `type: ${reference.type}`,
      `bounds: x=${reference.bounds.x}, y=${reference.bounds.y}, width=${reference.bounds.width}, height=${reference.bounds.height}`,
    );
    if (reference.agentExecution) {
      lines.push(
        `agent_kind: ${reference.agentExecution.kind}`,
        `agent_status: ${reference.agentExecution.status}`,
        `agent_title: ${sanitizePromptLine(reference.agentExecution.title)}`,
      );
      if (reference.agentExecution.runId) {
        lines.push(`run_id: ${reference.agentExecution.runId}`);
      }
      if (reference.agentExecution.toolName) {
        lines.push(`tool_name: ${reference.agentExecution.toolName}`);
      }
      if (reference.agentExecution.upstreamNodeIds?.length) {
        lines.push(
          `upstream_node_ids: ${reference.agentExecution.upstreamNodeIds.join(", ")}`,
        );
      }
      if (reference.agentExecution.downstreamNodeIds?.length) {
        lines.push(
          `downstream_node_ids: ${reference.agentExecution.downstreamNodeIds.join(", ")}`,
        );
      }
      if (reference.agentExecution.branchId) {
        lines.push(`branch_id: ${reference.agentExecution.branchId}`);
      }
      if (reference.agentExecution.branchLabel) {
        lines.push(
          `branch_label: ${sanitizePromptLine(reference.agentExecution.branchLabel)}`,
        );
      }
      if (reference.agentExecution.branchPlanSummary) {
        lines.push(
          `branch_plan_summary: ${sanitizePromptLine(reference.agentExecution.branchPlanSummary)}`,
        );
      }
      if (reference.agentExecution.branchDeliverableSummary) {
        lines.push(
          `branch_deliverable_summary: ${sanitizePromptLine(reference.agentExecution.branchDeliverableSummary)}`,
        );
      }
      if (reference.agentExecution.branchCritiqueSummary) {
        lines.push(
          `branch_critique_summary: ${sanitizePromptLine(reference.agentExecution.branchCritiqueSummary)}`,
        );
      }
      if (reference.agentExecution.branchStrengths?.length) {
        lines.push(
          `branch_strengths: ${sanitizePromptList(reference.agentExecution.branchStrengths)}`,
        );
      }
      if (reference.agentExecution.branchRisks?.length) {
        lines.push(
          `branch_risks: ${sanitizePromptList(reference.agentExecution.branchRisks)}`,
        );
      }
      if (reference.agentExecution.branchUseCases?.length) {
        lines.push(
          `branch_use_cases: ${sanitizePromptList(reference.agentExecution.branchUseCases)}`,
        );
      }
      if (reference.agentExecution.branchIsMainline !== undefined) {
        lines.push(
          `branch_is_mainline: ${reference.agentExecution.branchIsMainline ? "true" : "false"}`,
        );
      }
      if (
        reference.agentExecution.branchContinueRequiresMainlineSelection !==
        undefined
      ) {
        lines.push(
          `branch_continue_requires_mainline_selection: ${
            reference.agentExecution.branchContinueRequiresMainlineSelection
              ? "true"
              : "false"
          }`,
        );
      }
      if (reference.agentExecution.branchContinueInstruction) {
        lines.push(
          `branch_continue_instruction: ${sanitizePromptLine(reference.agentExecution.branchContinueInstruction)}`,
        );
      }
      if (reference.agentExecution.comparisonBranchNodeIds?.length) {
        lines.push(
          `comparison_branch_node_ids: ${reference.agentExecution.comparisonBranchNodeIds.join(", ")}`,
        );
      }
      if (reference.agentExecution.comparisonRecommendedBranchId) {
        lines.push(
          `comparison_recommended_branch_id: ${reference.agentExecution.comparisonRecommendedBranchId}`,
        );
      }
      if (reference.agentExecution.comparisonRecommendationReason) {
        lines.push(
          `comparison_recommendation_reason: ${sanitizePromptLine(reference.agentExecution.comparisonRecommendationReason)}`,
        );
      }
      if (reference.agentExecution.checkpointCanRestartFromHere !== undefined) {
        lines.push(
          `checkpoint_can_restart_from_here: ${
            reference.agentExecution.checkpointCanRestartFromHere
              ? "true"
              : "false"
          }`,
        );
      }
      if (reference.agentExecution.checkpointRestartReason) {
        lines.push(
          `checkpoint_restart_reason: ${sanitizePromptLine(reference.agentExecution.checkpointRestartReason)}`,
        );
      }
      if (reference.agentExecution.pausedContinuationInstruction) {
        lines.push(
          `paused_continuation_instruction: ${sanitizePromptLine(reference.agentExecution.pausedContinuationInstruction)}`,
        );
      }
      if (reference.agentExecution.waitingPrompt) {
        lines.push(
          `waiting_prompt: ${sanitizePromptLine(reference.agentExecution.waitingPrompt)}`,
        );
      }
      if (reference.agentExecution.waitingResponseText) {
        lines.push(
          `waiting_response_text: ${sanitizePromptLine(reference.agentExecution.waitingResponseText)}`,
        );
      }
      if (reference.agentExecution.waitingAttachmentCount !== undefined) {
        lines.push(
          `waiting_attachment_count: ${reference.agentExecution.waitingAttachmentCount}`,
        );
      }
      if (reference.agentExecution.failureStep) {
        lines.push(
          `failure_step: ${sanitizePromptLine(reference.agentExecution.failureStep)}`,
        );
      }
      if (reference.agentExecution.failureReason) {
        lines.push(
          `failure_reason: ${sanitizePromptLine(reference.agentExecution.failureReason)}`,
        );
      }
      if (reference.agentExecution.failureAttempted?.length) {
        lines.push(
          `failure_attempted: ${sanitizePromptList(reference.agentExecution.failureAttempted)}`,
        );
      }
      if (reference.agentExecution.failureNextActions?.length) {
        lines.push(
          `failure_next_actions: ${sanitizePromptList(reference.agentExecution.failureNextActions)}`,
        );
      }
    }
    lines.push("---");
  }
  lines.push("</canvas_node_references>");
  return lines;
}

function sanitizePromptLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizePromptList(values: string[]): string {
  return values.map(sanitizePromptLine).filter(Boolean).join(" | ");
}
