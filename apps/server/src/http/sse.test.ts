import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestAuthenticator } from "../supabase/user.js";
import { CanvasEventBuffer } from "../ws/event-buffer.js";
import { registerSseRoutes } from "./sse.js";

const TEST_USER = {
  accessToken: "token",
  email: "tester@example.com",
  id: "user-1",
  userMetadata: {},
};

describe("registerSseRoutes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays buffered events after Last-Event-ID and streams live updates", async () => {
    const { app, eventBuffer, streamUrl } = await createHarness();
    eventBuffer.publish("canvas-1", createStreamEvent("evt-1"));
    eventBuffer.publish("canvas-1", createStreamEvent("evt-2"));
    eventBuffer.publish("canvas-1", createStreamEvent("evt-3"));

    const controller = new AbortController();
    try {
      const response = await fetch(`${streamUrl}?lastEventId=0`, {
        headers: {
          authorization: "Bearer token",
          "last-event-id": "1",
        },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected SSE response body reader.");

      const replayText = await readChunksUntil(
        reader,
        (text) =>
          text.includes("id: 3") &&
          text.includes('"messageId":"message-evt-3"'),
      );

      expect(replayText).toContain("retry: 1000");
      expect(replayText).not.toContain("id: 1");
      expect(replayText).toContain("id: 2");
      expect(replayText).toContain("id: 3");

      eventBuffer.publish("canvas-1", createStreamEvent("evt-4"));
      const liveText = await readChunksUntil(
        reader,
        (text) =>
          text.includes("id: 4") &&
          text.includes('"messageId":"message-evt-4"'),
      );
      expect(liveText).toContain("id: 4");
    } finally {
      controller.abort();
      await app.close();
    }
  });

  it("sends heartbeat comments every 30 seconds while the stream stays open", async () => {
    vi.useFakeTimers();
    const { app, streamUrl } = await createHarness();
    const controller = new AbortController();

    try {
      const response = await fetch(streamUrl, {
        headers: {
          authorization: "Bearer token",
        },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected SSE response body reader.");

      await readChunksUntil(reader, (text) => text.includes("retry: 1000"));

      const heartbeatChunkPromise = reader.read();
      await vi.advanceTimersByTimeAsync(30_000);
      const heartbeatChunk = await heartbeatChunkPromise;
      const heartbeatText = decodeChunk(heartbeatChunk.value);

      expect(heartbeatChunk.done).toBe(false);
      expect(heartbeatText).toContain(": heartbeat ");
    } finally {
      controller.abort();
      await app.close();
    }
  });
});

async function createHarness() {
  const app = Fastify();
  const eventBuffer = new CanvasEventBuffer();
  const auth: RequestAuthenticator = {
    authenticate: async () => TEST_USER,
  };

  await registerSseRoutes(app, {
    auth,
    createUserClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "canvas-1" },
              error: null,
            }),
          }),
        }),
      }),
    }),
    eventBuffer,
    webOrigin: "http://localhost:3000",
  });

  const origin = await app.listen({
    host: "127.0.0.1",
    port: 0,
  });

  return {
    app,
    eventBuffer,
    streamUrl: `${origin}/api/canvases/canvas-1/stream`,
  };
}

function createStreamEvent(id: string) {
  return {
    delta: `event-${id}`,
    messageId: `message-${id}`,
    runId: `run-${id}`,
    timestamp: "2026-05-25T00:00:00.000Z",
    type: "message.delta",
  } as const;
}

function decodeChunk(chunk?: Uint8Array) {
  return new TextDecoder().decode(chunk);
}

async function readChunksUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  maxReads = 8,
) {
  let combined = "";

  for (let index = 0; index < maxReads; index += 1) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    combined += decodeChunk(value);
    if (predicate(combined)) {
      return combined;
    }
  }

  throw new Error(
    `Expected SSE stream content was not observed. Received: ${combined}`,
  );
}
