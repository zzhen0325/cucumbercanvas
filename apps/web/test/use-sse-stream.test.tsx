import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StreamEvent } from "@cucumber/shared";
import { useSseStream } from "../src/hooks/use-sse-stream";

type StartStream = ReturnType<typeof useSseStream>["startStream"];

describe("useSseStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the stream open when replayed terminal events belong to another run", async () => {
    const events: StreamEvent[] = [];
    const errors: string[] = [];
    const onReady = vi.fn<(startStream: StartStream) => void>();
    const oldRunCompleted = createRunCompletedEvent("old-run");
    const activeDelta = createMessageDeltaEvent("active-run", "hello");
    const activeRunCompleted = createRunCompletedEvent("active-run");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        createSseStream([
          { id: 1, event: oldRunCompleted },
          { id: 2, event: activeDelta },
          { id: 3, event: activeRunCompleted },
        ]),
        { status: 200 },
      ),
    );

    render(<SseHarness accessToken="token" onReady={onReady} />);

    await waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    const startStream = onReady.mock.calls[0]?.[0];
    if (!startStream) {
      throw new Error("SSE harness did not expose startStream.");
    }

    const handle = startStream({
      canvasId: "canvas-1",
      onError: (error) => {
        errors.push(error.message);
      },
      onEvent: (event) => {
        events.push(event);
      },
      shouldStop: (event) =>
        event.runId === "active-run" &&
        (event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.canceled"),
    });

    await handle.done;

    expect(errors).toEqual([]);
    expect(events).toEqual([oldRunCompleted, activeDelta, activeRunCompleted]);
  });
});

function SseHarness({
  accessToken,
  onReady,
}: {
  accessToken: string;
  onReady: (startStream: StartStream) => void;
}) {
  const { startStream } = useSseStream(accessToken);

  useEffect(() => {
    onReady(startStream);
  }, [onReady, startStream]);

  return null;
}

function createSseStream(entries: Array<{ event: StreamEvent; id: number }>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of entries) {
        controller.enqueue(
          encoder.encode(
            `id: ${entry.id}\nevent: stream.event\ndata: ${JSON.stringify(
              entry.event,
            )}\n\n`,
          ),
        );
      }
      controller.close();
    },
  });
}

function createRunCompletedEvent(runId: string): StreamEvent {
  return {
    type: "run.completed",
    runId,
    timestamp: "2026-06-03T00:00:00.000Z",
  };
}

function createMessageDeltaEvent(runId: string, delta: string): StreamEvent {
  return {
    type: "message.delta",
    runId,
    messageId: `${runId}-message`,
    delta,
    timestamp: "2026-06-03T00:00:00.000Z",
  };
}
