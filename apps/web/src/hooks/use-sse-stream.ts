"use client";

import { useCallback, useEffect, useRef } from "react";

import type { StreamEvent } from "@cucumber/shared";
import { getServerBaseUrl } from "../lib/env";

type StreamHandle = {
  done: Promise<void>;
  stop: () => void;
};

type StartStreamOptions = {
  canvasId: string;
  onError?: (error: Error) => void;
  onEvent: (event: StreamEvent, meta: { id: number }) => void;
  onOpen?: () => void;
  onReconnect?: () => void;
  shouldStop?: (event: StreamEvent) => boolean;
};

type ParsedSseChunk = {
  data: string;
  event: string;
  id?: number;
};

const TERMINAL_EVENT_TYPES = new Set<StreamEvent["type"]>([
  "run.completed",
  "run.failed",
  "run.canceled",
  "run.paused",
]);

export function useSseStream(accessToken: string) {
  const activeHandleRef = useRef<StreamHandle | null>(null);

  const stopStream = useCallback(() => {
    activeHandleRef.current?.stop();
    activeHandleRef.current = null;
  }, []);

  useEffect(() => stopStream, [stopStream]);

  const startStream = useCallback(
    (options: StartStreamOptions): StreamHandle => {
      stopStream();

      let disposed = false;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let currentController: AbortController | null = null;
      let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let lastEventId = 0;
      let receivedEventCount = 0;
      let terminalSeen = false;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      const cleanup = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        currentReader?.cancel().catch(() => undefined);
        currentReader = null;
        currentController?.abort();
        currentController = null;
      };

      const stop = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        cleanup();
        resolveDone();
        if (activeHandleRef.current === handle) {
          activeHandleRef.current = null;
        }
      };

      const scheduleReconnect = (attempt: number) => {
        if (disposed || terminalSeen) {
          return;
        }
        const delay = Math.min(5_000, 1_000 * 2 ** attempt);
        reconnectTimer = setTimeout(() => {
          void connect(attempt + 1);
        }, delay);
      };

      const connect = async (attempt: number) => {
        if (disposed) {
          return;
        }

        currentController = new AbortController();
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
          Authorization: `Bearer ${accessToken}`,
        };
        if (lastEventId > 0) {
          headers["Last-Event-ID"] = String(lastEventId);
        }

        const url = new URL(
          `${getServerBaseUrl()}/api/canvases/${options.canvasId}/stream`,
        );
        if (lastEventId > 0) {
          url.searchParams.set("lastEventId", String(lastEventId));
        }

        try {
          const response = await fetch(url.toString(), {
            headers,
            signal: currentController.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(
              `SSE connection failed with status ${response.status}`,
            );
          }

          if (attempt === 0) {
            options.onOpen?.();
          } else {
            options.onReconnect?.();
          }

          currentReader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!disposed) {
            const { done: streamDone, value } = await currentReader.read();
            if (streamDone) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            let separatorIndex = buffer.indexOf("\n\n");
            while (separatorIndex >= 0) {
              const rawChunk = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2);
              const parsed = parseSseChunk(rawChunk);
              if (parsed?.event === "stream.event") {
                if (parsed.id != null) {
                  lastEventId = parsed.id;
                }
                const event = JSON.parse(parsed.data) as StreamEvent;
                receivedEventCount += 1;
                options.onEvent(event, { id: lastEventId });
                const shouldStop = options.shouldStop
                  ? options.shouldStop(event)
                  : TERMINAL_EVENT_TYPES.has(event.type);
                if (shouldStop) {
                  terminalSeen = true;
                  stop();
                  return;
                }
              }
              separatorIndex = buffer.indexOf("\n\n");
            }
          }

          if (!disposed && !terminalSeen) {
            scheduleReconnect(attempt);
          }
        } catch (error) {
          if (disposed || currentController.signal.aborted) {
            return;
          }
          options.onError?.(
            error instanceof Error
              ? error
              : new Error("SSE stream failed unexpectedly"),
          );
          scheduleReconnect(attempt);
        }
      };

      const handle: StreamHandle = { done, stop };
      activeHandleRef.current = handle;
      void connect(0);
      return handle;
    },
    [accessToken, stopStream],
  );

  return {
    startStream,
    stopStream,
  };
}

function parseSseChunk(chunk: string): ParsedSseChunk | null {
  const normalized = chunk.replace(/\r/g, "");
  const lines = normalized.split("\n");
  let event = "message";
  let data = "";
  let id: number | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      const next = line.slice("data:".length).trimStart();
      data = data ? `${data}\n${next}` : next;
      continue;
    }
    if (line.startsWith("id:")) {
      const parsed = Number.parseInt(line.slice("id:".length).trim(), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        id = parsed;
      }
    }
  }

  if (!data) {
    return null;
  }

  return { data, event, ...(id != null ? { id } : {}) };
}
