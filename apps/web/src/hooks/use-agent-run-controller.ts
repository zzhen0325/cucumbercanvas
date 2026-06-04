"use client";

import { useCallback, useRef, useState } from "react";

import type {
  CanvasEntry,
  ContentBlock,
  ImageArtifact,
  ImageGenerationPreference,
  MessageMention,
  StreamEvent,
  VideoArtifact,
} from "@cucumber/shared";
import type { AgentRunControlState } from "../components/agent-run-control-bar";
import type { CanvasSelectedElement } from "../components/canvas-editor";
import {
  type ChatInputSendContext,
  formatAgentExecutionContinuationPrompt,
} from "../components/chat-input";
import { useToast } from "../components/toast";
import { cancelRun, createRun, pauseRun, saveMessage } from "../lib/server-api";
import { useAgentModel } from "./use-agent-model";
import { useChatSessions } from "./use-chat-sessions";
import { useChatStream } from "./use-chat-stream";
import type { ReadyAttachment } from "./use-image-attachments";
import { useImageAttachments } from "./use-image-attachments";
import { useImageModelPreference } from "./use-image-model-preference";
import { useSseStream } from "./use-sse-stream";
import { useVideoModelPreference } from "./use-video-model-preference";

export type AgentRunControllerSendOptions = {
  attachments?: ReadyAttachment[];
  canvasEntry?: CanvasEntry;
  imageGenerationPreference?: ImageGenerationPreference;
  mentions?: MessageMention[];
};

type UseAgentRunControllerOptions = {
  accessToken: string;
  canvasId: string;
  currentBrandKitId?: string | null;
  initialSessionId?: string | undefined;
  onAgentContinuationSubmit?: (summary: {
    attachmentCount: number;
    nodeId: string;
    text: string;
  }) => void;
  onBeforeRun?: () => Promise<void>;
  onCanvasSync?: () => void;
  onImageGenerated?: (artifact: ImageArtifact) => void;
  onRunControlStateChange?: (state: AgentRunControlState) => void;
  onRunPaused?: (summary: { runId: string }) => void;
  onRunStopped?: (summary: { runId: string }) => void;
  onSessionChange?: (sessionId: string) => void;
  onStreamEvent?: (event: StreamEvent) => void;
  onVideoGenerated?: (artifact: VideoArtifact) => void;
  selectedCanvasElements?: CanvasSelectedElement[];
};

export function useAgentRunController({
  accessToken,
  canvasId,
  initialSessionId,
  onAgentContinuationSubmit,
  onBeforeRun,
  onCanvasSync,
  onImageGenerated,
  onRunControlStateChange,
  onRunPaused,
  onRunStopped,
  onSessionChange,
  onStreamEvent,
  onVideoGenerated,
  selectedCanvasElements,
}: UseAgentRunControllerOptions) {
  const {
    activeSessionIdRef,
    autoTitleSession,
    messages,
    sessions,
    sessionsLoading,
    setStreaming,
    streaming,
    updateSessionMessages,
  } = useChatSessions({
    accessToken,
    canvasId,
    initialSessionId,
    onSessionChange,
  });
  const { applyStreamEvent } = useChatStream(updateSessionMessages);
  const { startStream } = useSseStream(accessToken);
  const attachments = useImageAttachments(accessToken);
  const { preference: activeImageGenerationPreference } =
    useImageModelPreference();
  const { preference: activeVideoGenerationPreference } =
    useVideoModelPreference();
  const { model: agentModel } = useAgentModel();
  const { toast: showToast } = useToast();
  const [messageMentions, setMessageMentions] = useState<MessageMention[]>([]);
  const [, setCancelingRunId] = useState<string | null>(null);

  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const activeImageGenerationPreferenceRef = useRef(
    activeImageGenerationPreference,
  );
  activeImageGenerationPreferenceRef.current = activeImageGenerationPreference;
  const activeVideoGenerationPreferenceRef = useRef(
    activeVideoGenerationPreference,
  );
  activeVideoGenerationPreferenceRef.current = activeVideoGenerationPreference;
  const agentModelRef = useRef(agentModel);
  agentModelRef.current = agentModel;
  const abortRef = useRef(false);
  const messageMentionsRef = useRef(messageMentions);
  messageMentionsRef.current = messageMentions;
  const selectedCanvasElementsRef = useRef(selectedCanvasElements);
  selectedCanvasElementsRef.current = selectedCanvasElements;
  const pauseAgentRunRef = useRef<(() => void) | null>(null);
  const stopAgentRunRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    async (
      text: string,
      sendContext?: ChatInputSendContext,
      options: AgentRunControllerSendOptions = {},
    ) => {
      const currentSessionId = activeSessionIdRef.current;
      if (streaming) {
        throw new Error("已有 Agent run 正在执行，请先暂停或停止后再发送。");
      }
      if (!currentSessionId) {
        throw new Error("会话尚未准备好，请稍等片刻后重试。");
      }

      let currentAttachments =
        options.attachments ?? attachments.readyAttachments;
      const selectedEls = selectedCanvasElementsRef.current ?? [];
      const selectedImageEls = selectedEls.filter(
        (el) =>
          el.type === "image" && el.fileId && (el.storageUrl || el.dataUrl),
      );
      if (selectedImageEls.length > 0 && !options.attachments) {
        const existingIds = new Set(currentAttachments.map((a) => a.assetId));
        const selectionAttachments: ReadyAttachment[] =
          selectedImageEls.flatMap((el) => {
            const url = el.storageUrl ?? el.dataUrl;
            if (existingIds.has(el.id) || !url) return [];
            return [
              {
                assetId: el.id,
                url,
                mimeType: "image/png",
                source: "canvas-ref" as const,
                name: `Canvas selection ${el.id.slice(0, 6)}`,
              },
            ];
          });
        if (selectionAttachments.length > 0) {
          currentAttachments = [...currentAttachments, ...selectionAttachments];
        }
      }

      const currentMentions = options.mentions ?? messageMentionsRef.current;
      const contextWithAttachmentCount =
        sendContext?.agentExecutionContinuation && currentAttachments.length > 0
          ? {
              ...sendContext,
              agentExecutionContinuation: {
                ...sendContext.agentExecutionContinuation,
                waitingAttachmentCount: currentAttachments.length,
              },
            }
          : sendContext;
      const agentPrompt = formatAgentExecutionContinuationPrompt(
        text,
        contextWithAttachmentCount,
      );

      const imageBlocks: ContentBlock[] = currentAttachments.map((a) => ({
        type: "image" as const,
        assetId: a.assetId,
        url: a.url,
        mimeType: a.mimeType,
        source: a.source,
        ...(a.name ? { name: a.name } : {}),
      }));
      const mentionBlocks: ContentBlock[] = currentMentions.map((mention) =>
        mention.mentionType === "image-model"
          ? {
              type: "mention" as const,
              mentionType: "image-model" as const,
              id: mention.id,
              label: mention.label,
            }
          : mention.mentionType === "skill"
            ? {
                type: "mention" as const,
                mentionType: "skill" as const,
                id: mention.id,
                label: mention.label,
                slug: mention.slug,
              }
            : {
                type: "mention" as const,
                mentionType: "brand-kit-asset" as const,
                id: mention.id,
                label: mention.label,
                assetType: mention.assetType,
                ...(mention.textContent !== undefined
                  ? { textContent: mention.textContent }
                  : {}),
                ...(mention.fileUrl !== undefined
                  ? { fileUrl: mention.fileUrl }
                  : {}),
              },
      );
      const contentBlocks: ContentBlock[] = [
        { type: "text" as const, text },
        ...mentionBlocks,
        ...imageBlocks,
      ];

      updateSessionMessages(currentSessionId, (prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user" as const,
          contentBlocks,
        },
      ]);
      saveMessage(accessTokenRef.current, currentSessionId, {
        role: "user",
        content: text,
        contentBlocks,
      }).catch((err) =>
        console.error(
          "[agent-run-controller] Failed to save user message:",
          err,
        ),
      );
      autoTitleSession(text);

      const assistantId = `assistant-${Date.now()}`;
      updateSessionMessages(currentSessionId, (prev) => [
        ...prev,
        { id: assistantId, role: "assistant" as const, contentBlocks: [] },
      ]);
      setStreaming(true);
      abortRef.current = false;

      try {
        await onBeforeRun?.();
        const run = await createRun(
          {
            sessionId: currentSessionId,
            conversationId: canvasId,
            prompt: agentPrompt,
            canvasId,
            ...(options.canvasEntry
              ? { canvasEntry: options.canvasEntry }
              : {}),
            ...(currentAttachments.length > 0
              ? { attachments: currentAttachments }
              : {}),
            ...(currentMentions.length > 0
              ? { mentions: currentMentions }
              : {}),
            imageGenerationPreference:
              options.imageGenerationPreference ??
              activeImageGenerationPreferenceRef.current,
            videoGenerationPreference:
              activeVideoGenerationPreferenceRef.current,
            ...(agentModelRef.current ? { model: agentModelRef.current } : {}),
          },
          { accessToken: accessTokenRef.current },
        );

        if (
          contextWithAttachmentCount?.agentExecutionContinuation &&
          currentAttachments.length > 0
        ) {
          onAgentContinuationSubmit?.({
            attachmentCount: currentAttachments.length,
            nodeId:
              contextWithAttachmentCount.agentExecutionContinuation.nodeId,
            text,
          });
        }

        const streamHandle = startStream({
          canvasId,
          onError: (error) => {
            console.warn(
              "[agent-run-controller] SSE reconnect pending:",
              error.message,
            );
          },
          onEvent: (event) => {
            if (event.runId !== run.runId || abortRef.current) return;
            applyStreamEvent(event, assistantId, currentSessionId);
            onStreamEvent?.(event);

            const backendInserted =
              event.type === "tool.completed" &&
              event.output &&
              typeof (event.output as Record<string, unknown>).elementId ===
                "string";
            if (
              event.type === "tool.completed" &&
              event.artifacts &&
              event.toolName !== "screenshot_canvas" &&
              !backendInserted
            ) {
              for (const artifact of event.artifacts) {
                if (artifact.type === "image") {
                  onImageGenerated?.(artifact as ImageArtifact);
                }
                if (artifact.type === "video") {
                  onVideoGenerated?.(artifact as VideoArtifact);
                }
              }
            }
            if (event.type === "canvas.sync") onCanvasSync?.();
            if (event.type === "run.failed") {
              const currentModel = agentModelRef.current ?? "";
              if (currentModel.includes("preview")) {
                showToast(
                  "当前 Preview 模型请求不稳定，建议切换模型后重试",
                  "error",
                );
              }
            }
          },
          shouldStop: (event) =>
            event.runId === run.runId &&
            (event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.canceled" ||
              event.type === "run.paused"),
        });

        const pauseCurrentRun = async () => {
          onRunControlStateChange?.({
            activeRunId: run.runId,
            pausing: true,
            streaming: true,
          });
          try {
            await pauseRun(run.runId, { accessToken: accessTokenRef.current });
            onRunPaused?.({ runId: run.runId });
            abortRef.current = true;
            streamHandle.stop();
            setStreaming(false);
            console.info("[agent-run-controller] run.pause.requested", {
              canvasId,
              runId: run.runId,
            });
          } catch (error) {
            showToast(
              error instanceof Error
                ? `暂停失败：${error.message}`
                : "暂停失败：无法暂停当前 Agent run。",
              "error",
            );
          } finally {
            pauseAgentRunRef.current = null;
            stopAgentRunRef.current = null;
            onRunControlStateChange?.({ streaming: false });
          }
        };
        const stopCurrentRun = async () => {
          setCancelingRunId(run.runId);
          onRunControlStateChange?.({
            activeRunId: run.runId,
            canceling: true,
            streaming: true,
          });
          try {
            await cancelRun(run.runId, { accessToken: accessTokenRef.current });
            onRunStopped?.({ runId: run.runId });
            abortRef.current = true;
            streamHandle.stop();
            setStreaming(false);
            console.info("[agent-run-controller] run.cancel.requested", {
              canvasId,
              runId: run.runId,
            });
          } catch (error) {
            showToast(
              error instanceof Error
                ? `停止失败：${error.message}`
                : "停止失败：无法取消当前 Agent run。",
              "error",
            );
          } finally {
            setCancelingRunId(null);
            pauseAgentRunRef.current = null;
            stopAgentRunRef.current = null;
            onRunControlStateChange?.({ streaming: false });
          }
        };
        pauseAgentRunRef.current = () => void pauseCurrentRun();
        stopAgentRunRef.current = () => void stopCurrentRun();
        onRunControlStateChange?.({
          activeRunId: run.runId,
          canceling: false,
          streaming: true,
        });

        attachments.clearAll();
        setMessageMentions([]);
        await streamHandle.done;
      } catch (error) {
        const failureText =
          error instanceof Error
            ? `处理失败：${error.message}`
            : "处理失败：无法启动 Agent run，请稍后重试。";
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  contentBlocks: [
                    ...message.contentBlocks,
                    { type: "text" as const, text: failureText },
                  ],
                }
              : message,
          ),
        );
        throw error;
      } finally {
        setStreaming(false);
        setCancelingRunId(null);
        pauseAgentRunRef.current = null;
        stopAgentRunRef.current = null;
        onRunControlStateChange?.({ streaming: false });
      }
    },
    [
      activeSessionIdRef,
      applyStreamEvent,
      attachments,
      autoTitleSession,
      canvasId,
      onAgentContinuationSubmit,
      onBeforeRun,
      onCanvasSync,
      onImageGenerated,
      onRunControlStateChange,
      onRunPaused,
      onRunStopped,
      onStreamEvent,
      onVideoGenerated,
      setStreaming,
      showToast,
      startStream,
      streaming,
      updateSessionMessages,
    ],
  );

  return {
    addFiles: attachments.addFiles,
    attachments: attachments.attachments,
    clearAttachments: attachments.clearAll,
    isUploading: attachments.isUploading,
    messages,
    messageMentions,
    onPauseRun: () => pauseAgentRunRef.current?.(),
    onRemoveAttachment: attachments.removeAttachment,
    onRemoveMention: (mention: MessageMention) =>
      setMessageMentions((prev) =>
        prev.filter(
          (item) =>
            !(
              item.mentionType === mention.mentionType && item.id === mention.id
            ),
        ),
      ),
    onRetryAttachment: attachments.retryUpload,
    onStopRun: () => stopAgentRunRef.current?.(),
    readyAttachments: attachments.readyAttachments,
    send,
    sessions,
    sessionsLoading,
    setMessageMentions,
    streaming,
  };
}
