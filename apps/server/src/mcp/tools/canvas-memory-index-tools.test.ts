import { createCanvasDocument } from "@cucumber/canvas-core";
import type { PenDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

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

function createMemoryServer(doc: PenDocument) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => doc,
      getDocumentState: async () => ({ document: doc, version: 1 }),
    } as never,
  });
}

function createMemoryDoc() {
  const doc = createCanvasDocument("Memory") as PenDocument;
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "output",
      type: "frame",
      name: "Launch Poster Output",
      containerRole: ["visual"],
      contextSlots: {
        rules: ["Use brand green", "Make the hero product larger"],
      },
      agentBinding: {
        agentId: "agent-1",
        name: "Designer",
        permissions: ["read", "write"],
        status: "completed",
      },
      runId: "run-1",
      sessionId: "session-1",
      width: 320,
      height: 240,
      children: [
        {
          id: "copy",
          type: "text",
          content: "Hero product launch",
          width: 180,
          height: 40,
        },
      ],
    },
    {
      id: "hidden-note",
      type: "text",
      content: "Internal direction",
      visible: false,
    },
  ];
  return doc;
}

describe("canvas_memory_index", () => {
  it("builds searchable entries from durable canvas context and run metadata", async () => {
    await expect(
      createMemoryServer(createMemoryDoc()).callTool(
        "canvas_memory_index",
        { query: "hero green", maxEntries: 5 },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            kind: "agent_output",
            nodeId: "output",
            metadata: expect.objectContaining({
              runId: "run-1",
              sessionId: "session-1",
            }),
            searchableText: expect.stringContaining("Use brand green"),
          }),
        ]),
        source: {
          durableTruth: "PenDocument.pages",
          liveCanvasDocument: true,
          persistedMemory: false,
        },
      },
    });
  });

  it("reports omitted hidden nodes and fails clearly for unknown explicit IDs", async () => {
    await expect(
      createMemoryServer(createMemoryDoc()).callTool(
        "canvas_memory_index",
        {},
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        warnings: [
          expect.objectContaining({
            code: "hidden_node_omitted",
            nodeId: "hidden-note",
          }),
        ],
      },
    });

    await expect(
      createMemoryServer(createMemoryDoc()).callTool(
        "canvas_memory_index",
        { nodeIds: ["missing"] },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "canvas_memory_index_failed",
        message: "canvas_memory_index node missing does not exist.",
      },
    });
  });
});
