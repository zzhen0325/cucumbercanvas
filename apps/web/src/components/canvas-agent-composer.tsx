"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowUp, Paperclip, Sparkles } from "lucide-react";
import type { ImageAttachmentState } from "../hooks/use-image-attachments";
import { AgentModelSelector } from "./agent-model-selector";
import type { CanvasSelectedElement } from "./canvas-editor";
import type { CanvasApi } from "./canvas/canvas-api";
import { useCanvasPromptDraftNode } from "./canvas/use-canvas-prompt-draft-node";
import {
  type AgentContinuationIntent,
  type AgentContinuationMode,
  type ChatInputSendContext,
  buildAgentContinuationContext,
  buildChatInputSendContext,
} from "./chat-input-context";
import { ImageAttachmentBar } from "./image-attachment-bar";
import { ImageModelPreferencePopover } from "./image-model-preference";

type CanvasAgentComposerProps = {
  attachments: ImageAttachmentState[];
  canvasApi: CanvasApi | null;
  disabled?: boolean;
  isUploading?: boolean;
  initialPrompt?: string | undefined;
  onAddFiles: (files: File[]) => void;
  onCanvasEntryCreated?: (entry: {
    agentExecutionNodeId: string;
    userGoalNodeId: string;
  }) => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveAttachmentRetry?: (id: string) => void;
  onSend: (
    message: string,
    context: ChatInputSendContext | undefined,
    options: {
      canvasEntry: {
        agentExecutionNodeId: string;
        userGoalNodeId: string;
      };
    },
  ) => Promise<void>;
  selectedCanvasElements?: CanvasSelectedElement[];
  continuationRequest?: {
    continuationTargetElement?: CanvasSelectedElement;
    intent?: AgentContinuationIntent;
    message: string;
    mode?: AgentContinuationMode;
    requestId: number;
    waitingResponseText?: string;
  } | null;
};

export function CanvasAgentComposer({
  attachments,
  canvasApi,
  continuationRequest,
  disabled,
  initialPrompt,
  isUploading,
  onAddFiles,
  onCanvasEntryCreated,
  onRemoveAttachment,
  onRemoveAttachmentRetry,
  onSend,
  selectedCanvasElements,
}: CanvasAgentComposerProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [agentContinuationMode, setAgentContinuationMode] =
    useState<AgentContinuationMode>("new_branch");
  const [agentContinuationIntent, setAgentContinuationIntent] = useState<
    AgentContinuationIntent | undefined
  >(undefined);
  const [
    agentContinuationWaitingResponseText,
    setAgentContinuationWaitingResponseText,
  ] = useState<string | undefined>(undefined);
  const [agentContinuationTargetElement, setAgentContinuationTargetElement] =
    useState<CanvasSelectedElement | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const { prepareEntryForSend, syncDraftText } =
    useCanvasPromptDraftNode(canvasApi);

  useEffect(() => {
    if (!initialPrompt || value.trim().length > 0) return;
    setValue(initialPrompt);
  }, [initialPrompt, value]);

  const continuationCanvasElements = agentContinuationTargetElement
    ? [agentContinuationTargetElement]
    : selectedCanvasElements;

  useEffect(() => {
    if (!continuationRequest) return;
    setValue(continuationRequest.message);
    setAgentContinuationMode(continuationRequest.mode ?? "new_branch");
    setAgentContinuationIntent(continuationRequest.intent);
    setAgentContinuationTargetElement(
      continuationRequest.continuationTargetElement,
    );
    setAgentContinuationWaitingResponseText(
      continuationRequest.waitingResponseText,
    );
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }, [continuationRequest]);

  useEffect(() => {
    syncDraftText(value);
  }, [syncDraftText, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  });

  const hasMessage = value.trim().length > 0;
  const sendDisabled =
    disabled || isUploading || submitting || !hasMessage || !canvasApi;

  const sendContext = useMemo(() => {
    const continuation = buildAgentContinuationContext(
      continuationCanvasElements,
      agentContinuationMode,
      agentContinuationIntent,
      { waitingResponseText: agentContinuationWaitingResponseText },
    );
    return buildChatInputSendContext(continuation, [], undefined);
  }, [
    agentContinuationIntent,
    agentContinuationMode,
    agentContinuationWaitingResponseText,
    continuationCanvasElements,
  ]);

  const handleSubmit = useCallback(async () => {
    const message = value.trim();
    if (!message || sendDisabled) return;
    setSubmitting(true);
    try {
      const canvasEntry = prepareEntryForSend(message);
      onCanvasEntryCreated?.(canvasEntry);
      await onSend(message, sendContext, { canvasEntry });
      setValue("");
      setAgentContinuationIntent(undefined);
      setAgentContinuationTargetElement(undefined);
      setAgentContinuationWaitingResponseText(undefined);
    } catch (error) {
      console.warn("[canvas-agent-composer] send.failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    onCanvasEntryCreated,
    onSend,
    prepareEntryForSend,
    sendContext,
    sendDisabled,
    value,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files?.length) onAddFiles(Array.from(files));
      event.target.value = "";
    },
    [onAddFiles],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length > 0) {
        event.preventDefault();
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length > 0) onAddFiles(files);
    },
    [onAddFiles],
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-5"
      data-canvas-agent-composer
    >
      <div
        className="pointer-events-auto flex w-[min(720px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-[20px] border border-border bg-card/92 px-3 py-2 shadow-card backdrop-blur-xl sm:w-[min(720px,calc(100vw-160px))]"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {attachments.length > 0 ? (
          <ImageAttachmentBar
            attachments={attachments}
            onRemove={onRemoveAttachment}
            {...(onRemoveAttachmentRetry
              ? { onRetry: onRemoveAttachmentRetry }
              : {})}
          />
        ) : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            aria-label="添加图片"
            title="添加图片"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <textarea
            ref={textareaRef}
            data-chat-input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="这里放用户输入的对话信息，跟上面初始节点同步"
            aria-label="输入消息"
            rows={1}
            className="min-h-8 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-foreground placeholder:text-muted-foreground/35 focus:outline-none"
          />
          <AgentModelSelector compact />
          <div className="relative">
            <button
              ref={modelButtonRef}
              type="button"
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setModelPopoverOpen((open) => !open)}
              aria-label="选择生成模型"
              title="生成模型"
            >
              <Sparkles className="size-4" />
            </button>
            <ImageModelPreferencePopover
              open={modelPopoverOpen}
              onClose={() => setModelPopoverOpen(false)}
              anchorRef={modelButtonRef}
            />
          </div>
          <button
            type="button"
            className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#29bf4e] text-black transition-colors hover:bg-[#20ad42] disabled:cursor-not-allowed disabled:opacity-30"
            disabled={sendDisabled}
            onClick={() => void handleSubmit()}
            aria-label="发送消息"
            title="发送"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        {continuationCanvasElements?.some(
          (element) => element.agentExecution,
        ) ? (
          <div className="flex items-center gap-1 px-10 text-[11px] text-muted-foreground">
            <span className="truncate">从选中的 Agent 节点继续</span>
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 ${
                agentContinuationMode === "new_branch"
                  ? "bg-accent text-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => setAgentContinuationMode("new_branch")}
            >
              新分支
            </button>
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 ${
                agentContinuationMode === "overwrite_current"
                  ? "bg-accent text-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => setAgentContinuationMode("overwrite_current")}
            >
              覆盖当前
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
