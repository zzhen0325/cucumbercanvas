import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import type {
  AgentRunContextPayload,
  CanvasEntry,
  ImageAttachment,
  ImageGenerationPreference,
  MessageMention,
  RunCancelResponse,
  RunCreateRequest,
  RunCreateResponse,
  RunPauseResponse,
  StreamEvent,
  VideoGenerationPreference,
} from "@cucumber/shared";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { HumanMessage } from "@langchain/core/messages";

import type { ServerEnv } from "../config/env.js";
import type { AgentRunMetadataService } from "../features/agent-runs/agent-run-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  insertImageElement,
  insertVideoElement,
} from "../features/canvas/canvas-element-writer.js";
import type { LiveCanvasService } from "../features/canvas/live-canvas-service.js";
import { insertGeneratedImageIntoLiveCanvas } from "../features/canvas/live-generated-image-writer.js";
import { ensureImageGenerationTargetContainer } from "../features/canvas/live-image-generation-target.js";
import type { JobService } from "../features/jobs/job-service.js";
import type {
  AuthenticatedUser,
  UserSupabaseClient,
} from "../supabase/user.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { CanvasEventBuffer } from "../ws/event-buffer.js";
import { createPipelineLogger } from "../ws/logger.js";
// execute 工具由 deepagents 内置提供（LocalShellBackend 作为 sandbox backend）
// 不需要自定义代码执行工具
import { recordImageGenerationExecutionNode } from "./agent-execution-image-writeback.js";
import { createAgentBackend } from "./backends/index.js";
import {
  type CucumberAgent,
  type CucumberAgentFactory,
  createCucumberDeepAgent,
  createDefaultModelSpecifier,
} from "./deep-agent.js";
import {
  buildAgentRunContext,
  serializeAgentRunContextXml,
} from "./orchestration-context.js";
import type { AgentPersistenceService } from "./persistence/index.js";
import { createRunFailedEvent } from "./run-failure.js";
import { adaptDeepAgentStream } from "./stream-adapter.js";
import type { SubmitImageJobFn } from "./tools/image-generate.js";
import { buildCanvasSummaryForContext } from "./tools/inspect-canvas.js";
import type { SubmitVideoJobFn } from "./tools/video-generate.js";
import {
  type WorkspaceSkillEntry,
  loadWorkspaceSkills,
} from "./workspace-skills.js";

/**
 * Build the text portion of a user message, appending <input_images> XML
 * tags when attachments are present so the LLM can reference them by assetId.
 */
export function buildUserMessage(
  prompt: string,
  attachments: ImageAttachment[],
  imageGenerationPreference?: ImageGenerationPreference,
  mentions: MessageMention[] = [],
  videoGenerationPreference?: VideoGenerationPreference,
  canvasSummary?: string | null,
  agentRunContext?: AgentRunContextPayload,
  canvasEntry?: CanvasEntry,
): { text: string } {
  const xmlBlocks: string[] = [];

  // Canvas state context (auto-injected, not user-provided)
  if (canvasSummary) {
    xmlBlocks.push(`<canvas_state>\n${canvasSummary}\n</canvas_state>`);
  }

  const inputImagesXml = buildInputImagesXml(attachments);
  if (inputImagesXml) xmlBlocks.push(inputImagesXml);

  const imageGenerationPreferenceXml = buildImageGenerationPreferenceXml(
    imageGenerationPreference,
  );
  if (imageGenerationPreferenceXml)
    xmlBlocks.push(imageGenerationPreferenceXml);

  const videoGenerationPreferenceXml = buildVideoGenerationPreferenceXml(
    videoGenerationPreference,
  );
  if (videoGenerationPreferenceXml)
    xmlBlocks.push(videoGenerationPreferenceXml);

  const mentionXmlBlocks = buildMentionXmlBlocks(mentions);
  xmlBlocks.push(...mentionXmlBlocks);

  if (agentRunContext) {
    xmlBlocks.push(serializeAgentRunContextXml(agentRunContext));
  }

  const canvasEntryXml = buildCanvasEntryXml(canvasEntry);
  if (canvasEntryXml) xmlBlocks.push(canvasEntryXml);

  if (!xmlBlocks.length) return { text: prompt };
  return { text: `${prompt}\n\n${xmlBlocks.join("\n\n")}` };
}

function buildCanvasEntryXml(canvasEntry?: CanvasEntry): string | null {
  if (!canvasEntry) return null;
  return [
    '<canvas_agent_entry mode="compact_single_execution_node">',
    `  <input_node id="${escapeXmlAttribute(canvasEntry.userGoalNodeId)}" />`,
    `  <agent_execution_node id="${escapeXmlAttribute(canvasEntry.agentExecutionNodeId)}" />`,
    "  <instruction>前端已经在 live PenDocument.pages 中创建了 InputNode 输入节点和单个 Agent 执行节点。不要再调用 create_agent_execution_flow 创建多节点入口链；本轮阶段、工具摘要和文本流由客户端写入 agent_execution_node。调用 generate_image 时传 agentExecutionNodeId=agent_execution_node，targetContainerId 留空；服务器会在提交生成任务前创建可见图片结果容器、连线和 loading，并把结果写入该容器。不要把 agent_execution_node 当作 targetContainerId。只有多个并列输出时才创建 final_deliverable 分组。</instruction>",
    "</canvas_agent_entry>",
  ].join("\n");
}

function buildInputImagesXml(attachments: ImageAttachment[]): string | null {
  if (attachments.length === 0) return null;

  const imageXml = attachments
    .map((attachment, i) => {
      const nameAttr = attachment.name
        ? ` name="${escapeXmlAttribute(attachment.name)}"`
        : "";
      return `<image index="${i + 1}" asset_id="${escapeXmlAttribute(attachment.assetId)}" mime_type="${escapeXmlAttribute(attachment.mimeType)}"${nameAttr} />`;
    })
    .join("\n  ");

  return `<input_images count="${attachments.length}">\n  ${imageXml}\n</input_images>`;
}

function buildImageGenerationPreferenceXml(
  imageGenerationPreference?: ImageGenerationPreference,
): string | null {
  if (
    imageGenerationPreference?.mode !== "manual" ||
    imageGenerationPreference.models.length === 0
  ) {
    return null;
  }

  const modelXml = imageGenerationPreference.models
    .map(
      (model, i) =>
        `<preferred_model index="${i + 1}" id="${escapeXmlAttribute(model)}" />`,
    )
    .join("\n  ");

  return `<human_image_generation_preference mode="manual" count="${imageGenerationPreference.models.length}">\n  ${modelXml}\n</human_image_generation_preference>`;
}

function buildVideoGenerationPreferenceXml(
  videoGenerationPreference?: VideoGenerationPreference,
): string | null {
  if (
    videoGenerationPreference?.mode !== "manual" ||
    videoGenerationPreference.models.length === 0
  ) {
    return null;
  }

  const modelXml = videoGenerationPreference.models
    .map(
      (model, i) =>
        `<preferred_model index="${i + 1}" id="${escapeXmlAttribute(model)}" />`,
    )
    .join("\n  ");

  return `<human_video_generation_preference mode="manual" count="${videoGenerationPreference.models.length}">\n  ${modelXml}\n</human_video_generation_preference>`;
}

function buildMentionXmlBlocks(mentions: MessageMention[]): string[] {
  const xmlBlocks: string[] = [];

  const mentionedModels = mentions.filter(
    (
      mention,
    ): mention is Extract<MessageMention, { mentionType: "image-model" }> =>
      mention.mentionType === "image-model",
  );
  if (mentionedModels.length > 0) {
    const modelXml = mentionedModels
      .map(
        (mention, i) =>
          `<model index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" display_name="${escapeXmlAttribute(mention.label)}" />`,
      )
      .join("\n  ");

    xmlBlocks.push(
      `<human_image_model_mentions count="${mentionedModels.length}">\n  ${modelXml}\n</human_image_model_mentions>`,
    );
  }

  const mentionedBrandKitAssets = mentions.filter(
    (
      mention,
    ): mention is Extract<MessageMention, { mentionType: "brand-kit-asset" }> =>
      mention.mentionType === "brand-kit-asset",
  );
  if (mentionedBrandKitAssets.length > 0) {
    const assetXml = mentionedBrandKitAssets
      .map((mention, i) => {
        const textContentAttr =
          mention.textContent != null
            ? ` text_content="${escapeXmlAttribute(mention.textContent)}"`
            : "";
        const fileUrlAttr =
          mention.fileUrl != null
            ? ` file_url="${escapeXmlAttribute(mention.fileUrl)}"`
            : "";
        return `<brand_kit_asset index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" type="${escapeXmlAttribute(mention.assetType)}" display_name="${escapeXmlAttribute(mention.label)}"${textContentAttr}${fileUrlAttr} />`;
      })
      .join("\n  ");

    xmlBlocks.push(
      `<human_brand_kit_mentions count="${mentionedBrandKitAssets.length}">\n  ${assetXml}\n</human_brand_kit_mentions>`,
    );
  }

  // Skill mentions — tell the agent to read and follow the mentioned skill
  const mentionedSkills = mentions.filter(
    (mention): mention is Extract<MessageMention, { mentionType: "skill" }> =>
      mention.mentionType === "skill",
  );
  if (mentionedSkills.length > 0) {
    const skillXml = mentionedSkills
      .map(
        (mention, i) =>
          `<skill index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" name="${escapeXmlAttribute(mention.label)}" slug="${escapeXmlAttribute(mention.slug)}">\nThe user explicitly requested this skill. Read \`/workspace-skills/${mention.slug}/SKILL.md\` for full instructions and follow them.\n</skill>`,
      )
      .join("\n  ");
    xmlBlocks.push(
      `<human_skill_mentions count="${mentionedSkills.length}">\n  ${skillXml}\n</human_skill_mentions>`,
    );
  }

  return xmlBlocks;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Build a lookup map from assetId to base64 data URI.
 * Stored in configurable so tools can resolve assetId references.
 */
export function buildAttachmentDataMap(
  downloaded: Array<{ assetId: string; mimeType: string; base64: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of downloaded) {
    map[d.assetId] = `data:${d.mimeType};base64,${d.base64}`;
  }
  return map;
}

type RuntimeRunStatus =
  | "accepted"
  | "canceled"
  | "completed"
  | "failed"
  | "paused"
  | "running";

type RuntimeRunRecord = RunCreateRequest & {
  accessToken?: string;
  abortKind?: "cancel" | "pause";
  consumed: boolean;
  controller: AbortController;
  modelOverride?: string;
  runId: string;
  status: RuntimeRunStatus;
  threadId?: string;
  userId?: string;
};

type CreateAgentRuntimeOptions = {
  agentPersistenceService?: AgentPersistenceService;
  agentFactory?: CucumberAgentFactory;
  agentRunMetadataService?: AgentRunMetadataService;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => UserSupabaseClient;
  env: ServerEnv;
  eventBuffer?: CanvasEventBuffer;
  eventDelayMs?: number;
  jobService?: JobService;
  liveCanvasService?: LiveCanvasService;
  model?: BaseLanguageModel | string;
  now?: () => string;
  runIdFactory?: () => string;
  viewerService?: ViewerService;
};

export type AgentRunService = ReturnType<typeof createAgentRunService>;

export function createAgentRunService(options: CreateAgentRuntimeOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const runs = new Map<string, RuntimeRunRecord>();
  const runIdFactory = options.runIdFactory ?? (() => randomUUID());

  const resolvedAgentFactory: CucumberAgentFactory =
    options.agentFactory ??
    ((agentOptions) =>
      createCucumberDeepAgent({
        ...agentOptions,
        ...(options.createUserClient
          ? { createUserClient: options.createUserClient }
          : {}),
      }));

  return {
    cancelRun(runId: string): RunCancelResponse | null {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }

      run.abortKind = "cancel";
      if (!run.controller.signal.aborted) {
        run.controller.abort();
      }

      run.status = "canceled";
      return {
        runId,
        status: "canceled",
      };
    },

    pauseRun(runId: string): RunPauseResponse | null {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }

      run.abortKind = "pause";
      if (!run.controller.signal.aborted) {
        run.controller.abort();
      }

      run.status = "paused";
      console.info("[agent-runtime] run.pause.requested", { runId });
      return {
        runId,
        status: "paused",
      };
    },

    createRun(
      input: RunCreateRequest,
      runOptions?: {
        accessToken?: string;
        model?: string;
        threadId?: string;
        userId?: string;
      },
    ): RunCreateResponse {
      const runId = runIdFactory();
      const { accessToken: _ignoredAccessToken, ...runInput } = input;

      runs.set(runId, {
        ...runInput,
        ...(runOptions?.accessToken
          ? { accessToken: runOptions.accessToken }
          : {}),
        consumed: false,
        controller: new AbortController(),
        ...(runOptions?.model ? { modelOverride: runOptions.model } : {}),
        ...(runOptions?.threadId ? { threadId: runOptions.threadId } : {}),
        ...(runOptions?.userId ? { userId: runOptions.userId } : {}),
        runId,
        status: "accepted",
      });

      return {
        conversationId: input.conversationId,
        runId,
        sessionId: input.sessionId,
        status: "accepted",
      };
    },

    hasRun(runId: string) {
      return runs.has(runId);
    },

    async *streamRun(runId: string): AsyncGenerator<StreamEvent> {
      const run = runs.get(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      if (run.consumed) {
        return;
      }

      run.consumed = true;
      run.status = "running";

      const rlog = createPipelineLogger("runtime", { runId });

      try {
        await updatePersistedRunStatus(
          options.agentRunMetadataService,
          run,
          "running",
        );
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        yield failedEvent;
        return;
      }

      let persistence: Awaited<
        ReturnType<NonNullable<AgentPersistenceService["getPersistence"]>>
      > | null = null;
      try {
        persistence =
          run.threadId && options.agentPersistenceService
            ? await options.agentPersistenceService.getPersistence()
            : null;
        rlog.lap("persistence_init");
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        await updatePersistedRunFailure(
          options.agentRunMetadataService,
          run,
          now,
          error,
        );
        yield failedEvent;
        return;
      }

      if (run.threadId && !persistence) {
        const failedEvent = toFailedEvent(
          runId,
          now,
          new Error(
            "CUCUMBER_SUPABASE_DB_URL is required for persisted agent threads.",
          ),
        );
        run.status = "failed";
        await updatePersistedRunFailure(
          options.agentRunMetadataService,
          run,
          now,
          new Error(
            "CUCUMBER_SUPABASE_DB_URL is required for persisted agent threads.",
          ),
        );
        yield failedEvent;
        return;
      }

      // Build submitImageJob / submitVideoJob closures for async jobs via PGMQ
      let submitImageJob: SubmitImageJobFn | undefined;
      let submitVideoJob: SubmitVideoJobFn | undefined;
      if (
        options.jobService &&
        options.createUserClient &&
        run.accessToken &&
        run.userId
      ) {
        const jobSvc = options.jobService;
        const createClient = options.createUserClient;
        const accessToken = run.accessToken;
        const userId = run.userId;
        const canvasId = run.canvasId;
        const sessionId = run.sessionId;
        const runId = run.runId;

        submitImageJob = async (input) => {
          const jobT0 = Date.now();
          const jobLap = (label: string, extra?: Record<string, unknown>) => {
            console.log(
              `[submitImageJob] ${label} +${Date.now() - jobT0}ms`,
              extra ? JSON.stringify(extra) : "",
            );
          };

          // Look up personal workspace directly — the viewer is already
          // bootstrapped from the normal auth flow, so we skip ensureViewer
          // to avoid its strict email validation on the profile schema.
          const client = createClient(accessToken) as UserSupabaseClient;
          const { data: ws } = await client
            .from("workspaces")
            .select("id")
            .eq("type", "personal")
            .limit(1)
            .single();
          if (!ws?.id) throw new Error("No personal workspace found");

          const user: AuthenticatedUser = {
            id: userId,
            accessToken,
            email: "",
            userMetadata: {},
          };

          const workspaceId = ws.id;
          let targetResolution:
            | Awaited<ReturnType<typeof ensureImageGenerationTargetContainer>>
            | undefined;
          if (
            canvasId &&
            input.agentExecutionNodeId &&
            options.liveCanvasService
          ) {
            try {
              targetResolution = await ensureImageGenerationTargetContainer({
                agentExecutionNodeId: input.agentExecutionNodeId,
                canvasId,
                liveCanvasService: options.liveCanvasService,
                requestedTargetContainerId: input.targetContainerId,
                title: input.title,
                transactionId: `image_target_${randomUUID()}`,
                user,
              });
              if (targetResolution.createdTargetContainerId) {
                jobLap("image_target_created", {
                  targetContainerId: targetResolution.createdTargetContainerId,
                });
              }
            } catch (error) {
              jobLap("image_target_create_failed", {
                error: error instanceof Error ? error.message : String(error),
                requestedTargetContainerId: input.targetContainerId,
              });
            }
          }
          const targetContainerId =
            targetResolution?.targetContainerId ??
            (input.targetContainerId &&
            input.targetContainerId !== input.agentExecutionNodeId
              ? input.targetContainerId
              : undefined);
          const useExplicitPlacement =
            targetResolution?.clearExplicitPlacement === true
              ? false
              : input.placementX != null && input.placementY != null;

          const job = await jobSvc.createJob(user, {
            workspaceId,
            ...(canvasId ? { canvasId } : {}),
            ...(sessionId ? { sessionId } : {}),
            jobType: "image_generation",
            payload: {
              prompt: input.prompt,
              title: input.title,
              model: input.model,
              aspect_ratio: input.aspectRatio,
              ...(input.inputImages ? { input_images: input.inputImages } : {}),
              ...(useExplicitPlacement && input.placementX != null
                ? { placement_x: input.placementX }
                : {}),
              ...(useExplicitPlacement && input.placementY != null
                ? { placement_y: input.placementY }
                : {}),
              ...(useExplicitPlacement && input.placementWidth != null
                ? { placement_width: input.placementWidth }
                : {}),
              ...(useExplicitPlacement && input.placementHeight != null
                ? { placement_height: input.placementHeight }
                : {}),
              ...(targetContainerId
                ? { target_container_id: targetContainerId }
                : {}),
              ...(input.agentExecutionNodeId
                ? { agent_execution_node_id: input.agentExecutionNodeId }
                : {}),
            },
          });

          jobLap("job_created", { jobId: job.id, sessionId, runId });

          // Poll until terminal state
          // Worker image VT=120s, but provider calls can take 100s+ plus queue delay.
          const POLL_INTERVAL = 2000;
          const MAX_WAIT = 240_000; // 4 minutes
          const start = Date.now();
          let pollCount = 0;

          while (Date.now() - start < MAX_WAIT) {
            await delay(POLL_INTERVAL);
            pollCount++;

            if (run.controller.signal.aborted) {
              throw new Error("Run was canceled");
            }

            const current = await jobSvc.getJobAdmin(job.id);

            if (current.status === "succeeded" && current.result) {
              const result = current.result as {
                signed_url?: string;
                object_path?: string;
                element_id?: string;
                width?: number;
                height?: number;
                mime_type?: string;
              };
              jobLap("job_poll_done", { pollCount, status: "succeeded" });

              let elementId = result.element_id;
              if (canvasId && result.object_path) {
                const writerClient = createClient(
                  accessToken,
                ) as UserSupabaseClient;
                const explicitPlacement =
                  useExplicitPlacement &&
                  input.placementX != null &&
                  input.placementY != null
                    ? {
                        x: input.placementX,
                        y: input.placementY,
                        width: input.placementWidth ?? 512,
                        height: input.placementHeight ?? 512,
                      }
                    : undefined;
                const insertOpts = {
                  canvasId,
                  objectPath: result.object_path,
                  width: result.width ?? 1024,
                  height: result.height ?? 1024,
                  mimeType: result.mime_type ?? "image/png",
                  title: input.title,
                  ...(targetContainerId ? { targetContainerId } : {}),
                };
                if (options.liveCanvasService) {
                  try {
                    const liveInsert = await insertGeneratedImageIntoLiveCanvas(
                      {
                        canvasId,
                        image: insertOpts,
                        liveCanvasService: options.liveCanvasService,
                        ...(explicitPlacement
                          ? { placement: explicitPlacement }
                          : {}),
                        storageClient: writerClient,
                        transactionId: `image_insert_${job.id}`,
                        user,
                      },
                    );
                    elementId = liveInsert.elementId;
                    jobLap("live_canvas_image_inserted", {
                      elementId,
                      nextVersion: liveInsert.nextVersion,
                      operationCount: liveInsert.operationCount,
                      targetContainerId,
                    });
                  } catch (error) {
                    jobLap("live_canvas_image_insert_failed", {
                      error:
                        error instanceof Error ? error.message : String(error),
                      targetContainerId,
                    });
                  }
                }

                if (!elementId) {
                  const insertResult = await insertImageElement(
                    writerClient,
                    insertOpts,
                    explicitPlacement,
                  );
                  elementId = insertResult.elementId;
                  jobLap("canvas_image_inserted", {
                    elementId,
                  });
                }
              }

              if (canvasId) {
                options.eventBuffer?.publish(canvasId, {
                  type: "canvas.sync" as const,
                  runId,
                  timestamp: new Date().toISOString(),
                });
              }

              if (
                canvasId &&
                input.agentExecutionNodeId &&
                options.liveCanvasService
              ) {
                await recordImageGenerationExecutionNode({
                  canvasId,
                  ...(elementId ? { elementId } : {}),
                  imageUrl: result.signed_url ?? "",
                  jobId: job.id,
                  liveCanvasService: options.liveCanvasService,
                  nodeId: input.agentExecutionNodeId,
                  status: "done",
                  title: input.title,
                  user,
                });
              }

              return {
                jobId: job.id,
                ...(elementId != null ? { elementId } : {}),
                imageUrl: result.signed_url ?? "",
                width: result.width ?? 1024,
                height: result.height ?? 1024,
                mimeType: result.mime_type ?? "image/png",
              };
            }

            if (
              current.status === "dead_letter" ||
              current.status === "canceled"
            ) {
              jobLap("job_poll_done", { pollCount, status: current.status });
              const error =
                current.error_message ?? `Image job ${current.status}.`;
              if (
                canvasId &&
                input.agentExecutionNodeId &&
                options.liveCanvasService
              ) {
                await recordImageGenerationExecutionNode({
                  canvasId,
                  errorReason: error,
                  jobId: job.id,
                  liveCanvasService: options.liveCanvasService,
                  nodeId: input.agentExecutionNodeId,
                  status: "failed",
                  title: input.title,
                  user,
                });
              }
              return {
                jobId: job.id,
                error,
              };
            }

            // "failed" with attempts exhausted
            if (
              current.status === "failed" &&
              current.attempt_count >= current.max_attempts
            ) {
              jobLap("job_poll_done", {
                pollCount,
                status: "failed_max_retries",
              });
              const error =
                current.error_message ?? "Image job failed after max retries.";
              if (
                canvasId &&
                input.agentExecutionNodeId &&
                options.liveCanvasService
              ) {
                await recordImageGenerationExecutionNode({
                  canvasId,
                  errorReason: error,
                  jobId: job.id,
                  liveCanvasService: options.liveCanvasService,
                  nodeId: input.agentExecutionNodeId,
                  status: "failed",
                  title: input.title,
                  user,
                });
              }
              return {
                jobId: job.id,
                error,
              };
            }
          }

          jobLap("job_poll_done", { pollCount, status: "timeout" });
          const error = `Image job timed out after ${MAX_WAIT / 1000}s.`;
          if (
            canvasId &&
            input.agentExecutionNodeId &&
            options.liveCanvasService
          ) {
            await recordImageGenerationExecutionNode({
              canvasId,
              errorReason: error,
              jobId: job.id,
              liveCanvasService: options.liveCanvasService,
              nodeId: input.agentExecutionNodeId,
              status: "failed",
              title: input.title,
              user,
            });
          }
          return {
            jobId: job.id,
            error,
          };
        };

        submitVideoJob = async (input) => {
          const jobT0 = Date.now();
          const jobLap = (label: string, extra?: Record<string, unknown>) => {
            console.log(
              `[submitVideoJob] ${label} +${Date.now() - jobT0}ms`,
              extra ? JSON.stringify(extra) : "",
            );
          };

          const client = createClient(accessToken) as UserSupabaseClient;
          const { data: ws } = await client
            .from("workspaces")
            .select("id")
            .eq("type", "personal")
            .limit(1)
            .single();
          if (!ws?.id) throw new Error("No personal workspace found");

          const user: AuthenticatedUser = {
            id: userId,
            accessToken,
            email: "",
            userMetadata: {},
          };

          const workspaceId = ws.id;

          const job = await jobSvc.createJob(user, {
            workspaceId,
            ...(canvasId ? { canvasId } : {}),
            ...(sessionId ? { sessionId } : {}),
            jobType: "video_generation",
            payload: {
              prompt: input.prompt,
              model: input.model,
              ...(input.duration != null ? { duration: input.duration } : {}),
              ...(input.resolution ? { resolution: input.resolution } : {}),
              ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
              ...(input.inputImages ? { input_images: input.inputImages } : {}),
              ...(input.inputVideo ? { input_video: input.inputVideo } : {}),
              ...(input.enableAudio != null
                ? { enable_audio: input.enableAudio }
                : {}),
              ...(input.targetContainerId
                ? { target_container_id: input.targetContainerId }
                : {}),
              ...(input.agentExecutionNodeId
                ? { agent_execution_node_id: input.agentExecutionNodeId }
                : {}),
            },
          });

          jobLap("job_created", { jobId: job.id, sessionId, runId });

          // Poll until terminal state — video generation is slower.
          // Video generation can take several minutes; 600s gives enough headroom
          // to avoid poll timeout while worker is still processing.
          const POLL_INTERVAL = 3000;
          const MAX_WAIT = 600_000; // 10 minutes
          const start = Date.now();
          let pollCount = 0;

          while (Date.now() - start < MAX_WAIT) {
            await delay(POLL_INTERVAL);
            pollCount++;

            if (run.controller.signal.aborted) {
              throw new Error("Run was canceled");
            }

            const current = await jobSvc.getJobAdmin(job.id);

            if (current.status === "succeeded" && current.result) {
              const result = current.result as {
                signed_url?: string;
                duration_seconds?: number;
                width?: number;
                height?: number;
                mime_type?: string;
              };
              jobLap("job_poll_done", { pollCount, status: "succeeded" });

              let elementId: string | undefined;
              if (canvasId && result.signed_url) {
                const writerClient = createClient(
                  accessToken,
                ) as UserSupabaseClient;
                const explicitPlacement =
                  input.placementX != null && input.placementY != null
                    ? {
                        x: input.placementX,
                        y: input.placementY,
                        width: input.placementWidth ?? 640,
                        height: input.placementHeight ?? 360,
                      }
                    : undefined;

                const insertResult = await insertVideoElement(
                  writerClient,
                  {
                    canvasId,
                    signedUrl: result.signed_url,
                    width: result.width ?? 1280,
                    height: result.height ?? 720,
                    mimeType: result.mime_type ?? "video/mp4",
                    ...(result.duration_seconds != null
                      ? { durationSeconds: result.duration_seconds }
                      : {}),
                    title: input.title,
                    prompt: input.prompt,
                  },
                  explicitPlacement,
                );
                elementId = insertResult.elementId;

                options.eventBuffer?.publish(canvasId, {
                  type: "canvas.sync" as const,
                  runId,
                  timestamp: new Date().toISOString(),
                });
                jobLap("canvas_element_inserted", { elementId });
              }

              return {
                jobId: job.id,
                ...(elementId != null ? { elementId } : {}),
                videoUrl: result.signed_url ?? "",
                width: result.width ?? 1280,
                height: result.height ?? 720,
                mimeType: result.mime_type ?? "video/mp4",
                ...(result.duration_seconds != null
                  ? { durationSeconds: result.duration_seconds }
                  : {}),
              };
            }

            if (
              current.status === "dead_letter" ||
              current.status === "canceled"
            ) {
              jobLap("job_poll_done", { pollCount, status: current.status });
              return {
                jobId: job.id,
                error: current.error_message ?? `Job ${current.status}`,
              };
            }

            if (
              current.status === "failed" &&
              current.attempt_count >= current.max_attempts
            ) {
              jobLap("job_poll_done", {
                pollCount,
                status: "failed_max_retries",
              });
              return {
                jobId: job.id,
                error: current.error_message ?? "Job failed after max retries",
              };
            }
          }

          jobLap("job_poll_done", { pollCount, status: "timeout" });
          return {
            jobId: job.id,
            error: `Job timed out after ${MAX_WAIT / 1000}s`,
          };
        };
      }

      // Load workspace skills (user-installed skills from DB).
      // Done before backend creation so we know whether to add the
      // /workspace-skills/ Store route.
      let workspaceSkills: WorkspaceSkillEntry[] = [];
      if (run.canvasId && run.accessToken && options.createUserClient) {
        try {
          const wsClient = options.createUserClient(
            run.accessToken,
          ) as UserSupabaseClient;
          workspaceSkills = await loadWorkspaceSkills(wsClient, run.canvasId);
          rlog.lap("workspace_skills_loaded", {
            count: workspaceSkills.length,
          });
        } catch (err) {
          // Non-fatal: agent runs without workspace skills
          console.warn("[runtime] Failed to load workspace skills:", err);
        }
      }

      // Create backend — production uses StateBackend (no local shell).
      const backendResult = createAgentBackend(options.env, run.canvasId, {
        hasWorkspaceSkills: workspaceSkills.length > 0,
      });

      try {
        let agent: CucumberAgent;
        let brandKitId: string | null = null;
        const runModelSpecifier = resolveRunModelSpecifier(
          run,
          options.model,
          options.env,
        );
        try {
          // Build persistImage closure using the user's Supabase client.
          // Client creation is deferred into the closure so it only runs
          // when an image is actually generated (avoids throwing in tests
          // that don't configure Supabase env vars).
          let persistImage:
            | ((url: string, mime: string, prompt: string) => Promise<string>)
            | undefined;
          if (options.createUserClient && run.accessToken) {
            const createClient = options.createUserClient;
            const accessToken = run.accessToken;
            persistImage = async (sourceUrl, mimeType, prompt) => {
              const client = createClient(accessToken) as UserSupabaseClient;
              const response = await fetch(sourceUrl);
              if (!response.ok)
                throw new Error(`Download failed: ${response.status}`);
              const buffer = Buffer.from(await response.arrayBuffer());
              const ext = mimeType === "image/webp" ? "webp" : "png";
              const slug = prompt
                .slice(0, 40)
                .replace(/[^a-zA-Z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
              const fileName = `gen-${slug}-${Date.now()}.${ext}`;

              const { data: ws } = await client
                .from("workspaces")
                .select("id")
                .eq("type", "personal")
                .limit(1)
                .single();
              const workspaceId = ws?.id ?? "default";
              const objectPath = `${workspaceId}/${Date.now()}-${fileName}`;

              const { error: uploadError } = await client.storage
                .from("project-assets")
                .upload(objectPath, buffer, {
                  contentType: mimeType,
                  upsert: false,
                });
              if (uploadError)
                throw new Error(`Upload failed: ${uploadError.message}`);

              const { data: urlData } = client.storage
                .from("project-assets")
                .getPublicUrl(objectPath);

              return urlData.publicUrl;
            };
          }

          // Resolve brand kit ID from canvas → project in a single joined query
          if (run.canvasId && run.accessToken && options.createUserClient) {
            try {
              const client = options.createUserClient(
                run.accessToken,
              ) as UserSupabaseClient;
              const { data: canvas } = await client
                .from("canvases")
                .select("project_id, projects!inner(brand_kit_id)")
                .eq("id", run.canvasId)
                .maybeSingle();
              const row = canvas as {
                projects?: { brand_kit_id?: string | null } | null;
              } | null;
              brandKitId = row?.projects?.brand_kit_id ?? null;
            } catch (err) {
              // Fallback: joined query may fail if FK isn't exposed via PostgREST
              // In that case, try the two-step approach
              try {
                const client = options.createUserClient(
                  run.accessToken,
                ) as UserSupabaseClient;
                const { data: c } = await client
                  .from("canvases")
                  .select("project_id")
                  .eq("id", run.canvasId)
                  .maybeSingle();
                const canvasRow = c as { project_id?: string | null } | null;
                if (canvasRow?.project_id) {
                  const { data: p } = await client
                    .from("projects")
                    .select("brand_kit_id")
                    .eq("id", canvasRow.project_id)
                    .maybeSingle();
                  const projectRow = p as {
                    brand_kit_id?: string | null;
                  } | null;
                  brandKitId = projectRow?.brand_kit_id ?? null;
                }
              } catch (err2) {
                console.warn("Failed to resolve brand kit ID:", err2);
              }
            }
          }

          rlog.lap("brand_kit_resolved");

          // Pre-write workspace skill SKILL.md files AND associated files
          // (scripts/, references/, assets/) into the Store so the agent can
          // read_file them via the /workspace-skills/ route.
          const store = persistence?.store;
          if (workspaceSkills.length > 0 && store && run.canvasId) {
            const storeNamespace = [
              "projects",
              run.canvasId,
              "workspace-skills",
            ];
            const now_ = new Date().toISOString();

            const writeOps: Promise<void>[] = [];
            for (const skill of workspaceSkills) {
              // Write SKILL.md
              writeOps.push(
                store.put(storeNamespace, `/${skill.name}/SKILL.md`, {
                  content: skill.content.split("\n"),
                  created_at: now_,
                  modified_at: now_,
                }),
              );
              // Write associated files (scripts/, references/, assets/)
              for (const file of skill.files) {
                writeOps.push(
                  store.put(storeNamespace, `/${skill.name}/${file.path}`, {
                    content: file.content.split("\n"),
                    created_at: now_,
                    modified_at: now_,
                  }),
                );
              }
            }

            await Promise.all(writeOps);
            const totalFiles = workspaceSkills.reduce(
              (sum, s) => sum + s.files.length,
              0,
            );
            rlog.lap("workspace_skills_stored", {
              count: workspaceSkills.length,
              files: totalFiles,
            });
          }

          agent = resolvedAgentFactory({
            backendResult,
            ...(brandKitId ? { brandKitId } : {}),
            ...(run.canvasId ? { canvasId: run.canvasId } : {}),
            ...(persistence ? { checkpointer: persistence.checkpointer } : {}),
            ...(options.connectionManager
              ? { connectionManager: options.connectionManager }
              : {}),
            ...(options.eventBuffer
              ? { eventBuffer: options.eventBuffer }
              : {}),
            env: options.env,
            ...(options.liveCanvasService
              ? { liveCanvasService: options.liveCanvasService }
              : {}),
            ...(runModelSpecifier ? { model: runModelSpecifier } : {}),
            ...(persistImage ? { persistImage } : {}),
            // execute 工具由 LocalShellBackend 自动提供，无需手动传递
            ...(submitImageJob ? { submitImageJob } : {}),
            ...(submitVideoJob ? { submitVideoJob } : {}),
            ...(persistence ? { store: persistence.store } : {}),
            ...(workspaceSkills.length > 0 ? { workspaceSkills } : {}),
          });
          rlog.lap("agent_factory_done");
        } catch (error) {
          const failedEvent = toFailedEvent(runId, now, error);
          run.status = "failed";
          await updatePersistedRunFailure(
            options.agentRunMetadataService,
            run,
            now,
            error,
          );
          yield failedEvent;
          return;
        }

        let agentRunContext: AgentRunContextPayload | undefined;
        let stream: AsyncIterable<unknown>;
        try {
          // Auto-inject canvas state summary so the agent has immediate awareness
          // of what's on the canvas without needing to call inspect_canvas first.
          let canvasSummary: string | null = null;
          if (run.canvasId && run.accessToken && options.createUserClient) {
            const canvasClient = options.createUserClient(
              run.accessToken,
            ) as UserSupabaseClient;
            const { data: canvasData, error: canvasError } = await canvasClient
              .from("canvases")
              .select("content")
              .eq("id", run.canvasId)
              .single();
            if (canvasError) {
              throw new Error(
                `Failed to load live canvas context for agent run: ${canvasError.message}`,
              );
            }
            if (canvasData?.content) {
              canvasSummary = buildCanvasSummaryForContext(canvasData.content);
            }
          }

          const hasAttachments = run.attachments && run.attachments.length > 0;
          agentRunContext = buildAgentRunContext({
            attachments: run.attachments ?? [],
            ...(brandKitId ? { brandKitId } : {}),
            canvasSummary,
            mentions: run.mentions ?? [],
            modelSpecifier: runModelSpecifier,
            prompt: run.prompt,
            workspaceSkills,
          });
          rlog.lap("agent_context_built", {
            promptLayers: agentRunContext.promptContext.layers.length,
            teamMembers: agentRunContext.team.members.length,
            styleguide: agentRunContext.styleguide?.id ?? "none",
          });
          let userMessage: HumanMessage;
          let attachmentDataMap: Record<string, string> = {};

          if (hasAttachments) {
            // Download images and build parallel data structures:
            // 1. imageBlocks: base64 content parts for LLM vision
            // 2. downloaded: assetId → base64 mapping for tool resolution
            const downloaded: Array<{
              assetId: string;
              mimeType: string;
              base64: string;
            }> = [];
            const attachments = run.attachments ?? [];
            const imageBlocks = await Promise.all(
              attachments.map(async (a) => {
                try {
                  let b64: string;
                  let mime: string;

                  // Handle data URIs directly (canvas-ref images) — no fetch needed
                  const dataUriMatch = a.url.match(
                    /^data:([^;]+);base64,(.+)$/,
                  );
                  const dataUriMime = dataUriMatch?.[1];
                  const dataUriBase64 = dataUriMatch?.[2];
                  if (dataUriMime && dataUriBase64) {
                    mime = dataUriMime;
                    b64 = dataUriBase64;
                  } else {
                    const res = await fetch(a.url);
                    const buf = Buffer.from(await res.arrayBuffer());
                    mime =
                      a.mimeType ||
                      res.headers.get("content-type") ||
                      "image/png";
                    b64 = buf.toString("base64");
                  }

                  downloaded.push({
                    assetId: a.assetId,
                    mimeType: mime,
                    base64: b64,
                  });
                  // Use standard LangChain image_url format — works with both
                  // Google Gemini and OpenAI adapters. The Anthropic-style
                  // { type: "image", source_type: "base64" } format is NOT
                  // recognized by @langchain/google-genai and gets serialized
                  // as raw text, blowing past the token limit.
                  return {
                    type: "image_url" as const,
                    image_url: `data:${mime};base64,${b64}`,
                  };
                } catch {
                  return {
                    type: "image_url" as const,
                    image_url: a.url,
                  };
                }
              }),
            );

            // Build XML text tags for LLM to reference by assetId
            const { text: enrichedPrompt } = buildUserMessage(
              run.prompt,
              attachments,
              run.imageGenerationPreference,
              run.mentions,
              run.videoGenerationPreference,
              canvasSummary,
              agentRunContext,
              run.canvasEntry,
            );

            // Build assetId → data URI map for tool-level resolution
            attachmentDataMap = buildAttachmentDataMap(downloaded);

            userMessage = new HumanMessage({
              content: [
                { type: "text" as const, text: enrichedPrompt },
                ...imageBlocks,
              ],
            });
          } else {
            const { text: enrichedPrompt } = buildUserMessage(
              run.prompt,
              [],
              run.imageGenerationPreference,
              run.mentions,
              run.videoGenerationPreference,
              canvasSummary,
              agentRunContext,
              run.canvasEntry,
            );
            userMessage = new HumanMessage(enrichedPrompt);
          }

          rlog.lap("stream_call_start");
          stream = agent.streamEvents(
            {
              messages: [userMessage],
            },
            {
              ...(run.threadId ||
              run.canvasId ||
              run.accessToken ||
              run.userId ||
              Object.keys(attachmentDataMap).length > 0
                ? {
                    configurable: {
                      ...(run.threadId ? { thread_id: run.threadId } : {}),
                      ...(run.canvasId ? { canvas_id: run.canvasId } : {}),
                      ...(run.accessToken
                        ? { access_token: run.accessToken }
                        : {}),
                      ...(run.userId ? { user_id: run.userId } : {}),
                      ...(Object.keys(attachmentDataMap).length > 0
                        ? { user_attachment_map: attachmentDataMap }
                        : {}),
                    },
                  }
                : {}),
              signal: run.controller.signal,
              version: "v2",
            },
          );
          rlog.lap("stream_call_returned");
        } catch (error) {
          const failedEvent = toFailedEvent(runId, now, error);
          run.status = "failed";
          await updatePersistedRunFailure(
            options.agentRunMetadataService,
            run,
            now,
            error,
          );
          yield failedEvent;
          return;
        }

        try {
          for await (const event of adaptDeepAgentStream({
            abortEvent: () => createInterruptedRunEvent(runId, now, run),
            conversationId: run.conversationId,
            now,
            runId,
            sessionId: run.sessionId,
            signal: run.controller.signal,
            stream,
            runContext: agentRunContext,
          })) {
            run.status = mapEventToStatus(event);
            try {
              await syncPersistedRunFromEvent(
                options.agentRunMetadataService,
                run,
                event,
                now,
              );
            } catch (error) {
              const failedEvent = toFailedEvent(runId, now, error);
              run.status = "failed";
              yield failedEvent;
              return;
            }
            yield event;

            if (!isTerminalEvent(event) && options.eventDelayMs) {
              try {
                await delay(options.eventDelayMs, undefined, {
                  signal: run.controller.signal,
                });
              } catch {
                const interruptedEvent = createInterruptedRunEvent(
                  runId,
                  now,
                  run,
                );
                run.status = mapEventToStatus(interruptedEvent);
                yield interruptedEvent;
                return;
              }
            }
          }
        } catch (streamError) {
          // Catch DB / checkpoint errors that bubble up from the LangGraph stream
          // (e.g. Supabase circuit-breaker, connection pool exhaustion).
          // Instead of crashing the process, yield a clean failure event.
          console.error(
            "[agent-runtime] Stream iteration failed:",
            streamError,
          );
          const failedEvent = toFailedEvent(runId, now, streamError);
          run.status = "failed";
          await updatePersistedRunFailure(
            options.agentRunMetadataService,
            run,
            now,
            streamError,
          ).catch((persistErr) =>
            console.error(
              "[agent-runtime] Failed to persist run failure:",
              persistErr,
            ),
          );
          yield failedEvent;
          return;
        }
      } finally {
        if (backendResult.sandboxDir) {
          rm(backendResult.sandboxDir, { recursive: true, force: true }).catch(
            (err) => console.warn("[sandbox] cleanup failed:", err.message),
          );
        }
      }
    },
  };
}

function isTerminalEvent(event: StreamEvent) {
  return (
    event.type === "run.canceled" ||
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.paused"
  );
}

function resolveRunModelSpecifier(
  run: RuntimeRunRecord,
  runtimeModel: BaseLanguageModel | string | undefined,
  env: Pick<ServerEnv, "agentModel">,
): string {
  if (run.modelOverride) {
    return run.modelOverride.includes(":")
      ? run.modelOverride
      : createDefaultModelSpecifier({ agentModel: run.modelOverride });
  }

  if (typeof runtimeModel === "string") {
    return runtimeModel.includes(":")
      ? runtimeModel
      : createDefaultModelSpecifier({ agentModel: runtimeModel });
  }

  return createDefaultModelSpecifier(env);
}

function mapEventToStatus(event: StreamEvent): RuntimeRunStatus {
  switch (event.type) {
    case "run.canceled":
      return "canceled";
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    case "run.paused":
      return "paused";
    default:
      return "running";
  }
}

function createInterruptedRunEvent(
  runId: string,
  now: () => string,
  run: RuntimeRunRecord,
): StreamEvent {
  if (run.abortKind === "pause") {
    return {
      reason: "用户暂停了当前 Agent 执行链，可从选中的执行节点继续。",
      runId,
      timestamp: now(),
      type: "run.paused",
    };
  }

  return {
    runId,
    timestamp: now(),
    type: "run.canceled",
  };
}

function toFailedEvent(
  runId: string,
  now: () => string,
  error: unknown,
): StreamEvent {
  return createRunFailedEvent({
    error,
    now,
    runId,
    source: "runtime",
  });
}

async function updatePersistedRunStatus(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  status: "running" | "completed",
  options?: {
    completedAt?: string;
  },
) {
  if (!agentRunMetadataService || !run.threadId) {
    return;
  }

  await agentRunMetadataService.updateRun({
    ...(options?.completedAt ? { completedAt: options.completedAt } : {}),
    runId: run.runId,
    status,
  });
}

async function updatePersistedRunFailure(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  now: () => string,
  error: unknown,
) {
  if (!agentRunMetadataService || !run.threadId) {
    return;
  }

  await agentRunMetadataService.updateRun({
    completedAt: now(),
    errorCode: "run_failed",
    errorMessage:
      error instanceof Error ? error.message : "Deep agent runtime failed.",
    runId: run.runId,
    status: "failed",
  });
}

async function syncPersistedRunFromEvent(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  event: StreamEvent,
  now: () => string,
) {
  if (event.type === "run.completed") {
    await updatePersistedRunStatus(agentRunMetadataService, run, "completed", {
      completedAt: now(),
    });
    return;
  }

  if (event.type === "run.failed") {
    await updatePersistedRunFailure(
      agentRunMetadataService,
      run,
      now,
      new Error(event.error.message),
    );
  }
}
