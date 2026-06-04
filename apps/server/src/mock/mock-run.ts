import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type {
  RunCancelResponse,
  RunCreateRequest,
  RunCreateResponse,
  RunPauseResponse,
  StreamEvent,
} from "@cucumber/shared";

type MockRunStatus =
  | "accepted"
  | "running"
  | "completed"
  | "canceled"
  | "paused";

type MockRunRecord = RunCreateRequest & {
  abortKind?: "cancel" | "pause";
  runId: string;
  controller: AbortController;
  messageId: string;
  status: MockRunStatus;
  streamConsumed: boolean;
  toolCallId: string;
};

type CreateMockRunStoreOptions = {
  eventDelayMs?: number;
  now?: () => string;
  runIdFactory?: () => string;
};

export type MockRunStore = ReturnType<typeof createMockRunStore>;

export function createMockRunStore(options: CreateMockRunStoreOptions = {}) {
  const eventDelayMs = options.eventDelayMs ?? 25;
  const now = options.now ?? (() => new Date().toISOString());
  const runIdFactory = options.runIdFactory ?? (() => `run_${randomUUID()}`);
  const runs = new Map<string, MockRunRecord>();

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
      return {
        runId,
        status: "paused",
      };
    },

    createRun(input: RunCreateRequest): RunCreateResponse {
      const runId = runIdFactory();
      runs.set(runId, {
        ...input,
        controller: new AbortController(),
        messageId: `message_${runId}`,
        runId,
        status: "accepted",
        streamConsumed: false,
        toolCallId: `tool_${runId}`,
      });

      return {
        runId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
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

      if (run.streamConsumed) {
        return;
      }

      run.streamConsumed = true;
      run.status = "running";

      const events: StreamEvent[] = [
        {
          type: "run.started",
          runId: run.runId,
          sessionId: run.sessionId,
          conversationId: run.conversationId,
          timestamp: now(),
        },
        {
          type: "message.delta",
          runId: run.runId,
          messageId: run.messageId,
          delta: `Mock response for: ${run.prompt}`,
          timestamp: now(),
        },
        {
          type: "tool.started",
          runId: run.runId,
          toolCallId: run.toolCallId,
          toolName: "mock.search",
          timestamp: now(),
        },
        {
          type: "tool.completed",
          runId: run.runId,
          toolCallId: run.toolCallId,
          toolName: "mock.search",
          outputSummary: "Mock tool completed",
          timestamp: now(),
        },
        {
          type: "run.completed",
          runId: run.runId,
          timestamp: now(),
        },
      ];

      for (const [index, event] of events.entries()) {
        if (run.controller.signal.aborted) {
          run.status = run.abortKind === "pause" ? "paused" : "canceled";
          yield interruptedEvent(run);
          return;
        }

        yield event;

        if (index < events.length - 1) {
          try {
            await delay(eventDelayMs, undefined, {
              signal: run.controller.signal,
            });
          } catch {
            run.status = run.abortKind === "pause" ? "paused" : "canceled";
            yield interruptedEvent(run);
            return;
          }
        }
      }

      run.status = "completed";
    },
  };
}

function interruptedEvent(run: MockRunRecord): StreamEvent {
  if (run.abortKind === "pause") {
    return {
      reason: "用户暂停了当前 Agent 执行链，可从选中的执行节点继续。",
      runId: run.runId,
      timestamp: new Date().toISOString(),
      type: "run.paused",
    };
  }

  return {
    runId: run.runId,
    timestamp: new Date().toISOString(),
    type: "run.canceled",
  };
}
