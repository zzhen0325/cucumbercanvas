import { createCanvasDocument } from "@cucumber/canvas-core";
import type { PenDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import { CanvasEventBuffer } from "../../ws/event-buffer.js";
import { createCucumberMcpServer } from "../server.js";

function context() {
  return {
    configurable: {
      access_token: "token",
      canvas_id: "canvas-1",
      user_id: "user-1",
    },
  };
}

function createTraceDoc() {
  const doc = createCanvasDocument("Trace") as PenDocument;
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "output",
      type: "frame",
      name: "Output",
      x: 10,
      y: 20,
      width: 320,
      height: 240,
      agentBinding: {
        agentId: "agent-1",
        name: "Designer",
        permissions: ["read", "write"],
        status: "completed",
      },
      runId: "run-1",
      sessionId: "session-1",
      children: [
        {
          id: "copy",
          type: "text",
          content: "Ready",
          x: 24,
          y: 40,
          width: 160,
          height: 40,
          runId: "run-1",
          sessionId: "session-1",
        },
      ],
    },
    {
      id: "other",
      type: "frame",
      width: 100,
      height: 100,
      runId: "run-2",
      sessionId: "session-2",
      children: [],
    },
  ];
  return doc;
}

function createTraceServer(doc: PenDocument, eventBuffer?: CanvasEventBuffer) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    ...(eventBuffer ? { eventBuffer } : {}),
    liveCanvasService: {
      getDocument: async () => doc,
      getDocumentState: async () => ({ document: doc, version: 1 }),
    } as never,
  });
}

function seedRunEvents(eventBuffer: CanvasEventBuffer) {
  eventBuffer.setActiveRun("canvas-1", "run-1");
  eventBuffer.publish("canvas-1", {
    type: "run.started",
    runId: "run-1",
    sessionId: "session-1",
    conversationId: "conversation-1",
    timestamp: "2026-06-02T13:00:00.000Z",
  });
  eventBuffer.publish("canvas-1", {
    type: "tool.started",
    runId: "run-1",
    toolCallId: "tool-1",
    toolName: "apply_canvas_transaction",
    input: { transactionId: "tx-1" },
    timestamp: "2026-06-02T13:00:01.000Z",
  });
  eventBuffer.publish("canvas-1", {
    type: "canvas.patch",
    runId: "run-1",
    transactionId: "tx-1",
    baseVersion: 3,
    operations: [
      {
        type: "updateNode",
        nodeId: "copy",
        updates: { content: "Ready" },
      },
    ],
    timestamp: "2026-06-02T13:00:02.000Z",
  });
  eventBuffer.publish("canvas-1", {
    type: "tool.completed",
    runId: "run-1",
    toolCallId: "tool-1",
    toolName: "apply_canvas_transaction",
    outputSummary: "Updated copy.",
    timestamp: "2026-06-02T13:00:03.000Z",
  });
}

describe("canvas_run_trace", () => {
  it("reads recent run events, canvas patches, and linked nodes", async () => {
    const doc = createTraceDoc();
    const eventBuffer = new CanvasEventBuffer();
    seedRunEvents(eventBuffer);

    await expect(
      createTraceServer(doc, eventBuffer).callTool(
        "canvas_run_trace",
        { runId: "run-1", sessionId: "session-1" },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        affectedNodeIds: ["copy"],
        canvasPatches: [
          expect.objectContaining({
            affectedNodeIds: ["copy"],
            transactionId: "tx-1",
          }),
        ],
        linkedNodeIds: ["output", "copy"],
        run: {
          activeRun: expect.objectContaining({ runId: "run-1" }),
          requestedRunId: "run-1",
          runIdsInEvents: ["run-1"],
          sessionId: "session-1",
          status: "running",
        },
        toolCalls: [
          expect.objectContaining({
            outputSummary: "Updated copy.",
            status: "completed",
            toolCallId: "tool-1",
            toolName: "apply_canvas_transaction",
          }),
        ],
      },
    });
  });

  it("fails clearly when event trace is requested without an event buffer", async () => {
    await expect(
      createTraceServer(createTraceDoc()).callTool(
        "canvas_run_trace",
        {},
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "canvas_run_trace_failed",
        message: expect.stringContaining("requires the Agent event buffer"),
      },
    });
  });

  it("can read run-bound canvas nodes without event trace state", async () => {
    await expect(
      createTraceServer(createTraceDoc()).callTool(
        "canvas_run_trace",
        { includeEvents: false, runId: "run-1" },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        events: [],
        linkedNodeIds: ["output", "copy"],
        sources: {
          eventBuffer: false,
          liveCanvasDocument: true,
        },
      },
    });
  });
});
