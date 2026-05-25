import type {
  ContentBlock,
  RunCreateRequest,
  ToolBlock,
} from "@cucumber/shared";

import type { ChatService } from "../features/chat/chat-service.js";
import type { AuthenticatedUser } from "../supabase/user.js";
import type { CanvasEventBuffer } from "../ws/event-buffer.js";
import { createRunFailedEvent } from "./run-failure.js";
import type { AgentRunService } from "./runtime.js";

type StartRunInput = {
  authenticatedUser: AuthenticatedUser | null;
  payload: Omit<RunCreateRequest, "accessToken">;
  runId: string;
};

export class RunEventPump {
  private readonly activePumps = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      agentRuns: AgentRunService;
      chatService?: ChatService;
      eventBuffer: CanvasEventBuffer;
    },
  ) {}

  startRun(input: StartRunInput) {
    if (this.activePumps.has(input.runId)) {
      return;
    }

    const canvasId = input.payload.canvasId ?? input.payload.conversationId;
    this.deps.eventBuffer.setActiveRun(canvasId, input.runId);

    const task = this.pump(input, canvasId).finally(() => {
      this.deps.eventBuffer.clearActiveRun(canvasId);
      this.activePumps.delete(input.runId);
    });

    this.activePumps.set(input.runId, task);
    void task;
  }

  private async pump(input: StartRunInput, canvasId: string) {
    const assistantText: string[] = [];
    const assistantBlocks: ContentBlock[] = [];

    try {
      for await (const event of this.deps.agentRuns.streamRun(input.runId)) {
        this.deps.eventBuffer.publish(canvasId, event);

        if (event.type === "message.delta") {
          const lastBlock = assistantBlocks[assistantBlocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            (lastBlock as { type: "text"; text: string }).text += event.delta;
          } else {
            assistantBlocks.push({ type: "text", text: event.delta });
          }
          assistantText.push(event.delta);
          continue;
        }

        if (event.type === "tool.started") {
          // Guard against duplicate tool.started events for the same toolCallId
          // (stream-adapter deduplicates, but defense-in-depth for upstream changes)
          const alreadyExists = assistantBlocks.some(
            (block) =>
              block.type === "tool" &&
              (block as ToolBlock).toolCallId === event.toolCallId,
          );
          if (alreadyExists) {
            console.warn(
              "[run-event-pump] duplicate tool.started for:",
              event.toolCallId,
            );
            continue;
          }
          assistantBlocks.push({
            type: "tool",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "running",
            ...(event.input ? { input: event.input } : {}),
          });
          continue;
        }

        if (event.type === "tool.completed") {
          // Update all matching blocks in case duplicates slipped through
          let updated = false;
          assistantBlocks.forEach((block, idx) => {
            if (
              block.type === "tool" &&
              (block as ToolBlock).toolCallId === event.toolCallId
            ) {
              assistantBlocks[idx] = {
                ...(block as ToolBlock),
                status: "completed",
                ...(event.output ? { output: event.output } : {}),
                ...(event.outputSummary
                  ? { outputSummary: event.outputSummary }
                  : {}),
                ...(event.artifacts ? { artifacts: event.artifacts } : {}),
              };
              updated = true;
            }
          });
          if (!updated) {
            console.warn(
              "[run-event-pump] tool.completed for untracked toolCallId:",
              event.toolCallId,
            );
          }
        }
      }

      if (
        this.deps.chatService &&
        input.authenticatedUser &&
        (assistantText.length > 0 || assistantBlocks.length > 0)
      ) {
        await this.deps.chatService.createMessage(
          input.authenticatedUser,
          input.payload.sessionId,
          {
            role: "assistant",
            content: assistantText.join(""),
            contentBlocks: assistantBlocks,
          },
        );
      }
    } catch (error) {
      console.error("[run-event-pump] stream failed:", error);
      this.deps.eventBuffer.publish(
        canvasId,
        createRunFailedEvent({
          error,
          now: () => new Date().toISOString(),
          runId: input.runId,
          source: "run-event-pump",
        }),
      );
    }
  }
}
