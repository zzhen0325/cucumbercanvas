import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
} from "@cucumber/canvas-core";
import type { FrameNode, PenDocument } from "@cucumber/canvas-core";
import { describe, expect, it, vi } from "vitest";

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

function createOutputDoc() {
  const doc = createCanvasDocument("Output container") as PenDocument & {
    selection?: string[];
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "existing",
      type: "frame",
      name: "Existing",
      x: 40,
      y: 60,
      width: 300,
      height: 200,
      children: [],
    },
  ];
  return doc;
}

function createOutputServer(
  initialDoc = createOutputDoc(),
  initialVersion = 13,
) {
  const state = {
    doc: initialDoc,
    patchCalls: [] as {
      baseVersion: number;
      operations: CanvasOperation[];
      selection?: string[];
      transactionId: string;
    }[],
    version: initialVersion,
  };
  const patchDocument = vi.fn(async (_user, _canvasId, patch) => {
    if (patch.baseVersion !== state.version) {
      throw new Error(
        `Canvas patch version mismatch. The live document is at version ${state.version}, but the patch was based on version ${patch.baseVersion}.`,
      );
    }
    const result = applyCanvasTransaction(state.doc, patch.operations, {
      transactionId: patch.transactionId,
    });
    state.doc = {
      ...result.doc,
      selection: patch.selection ?? state.doc.selection,
    } as typeof state.doc;
    state.version += 1;
    state.patchCalls.push(patch);
    return { version: state.version };
  });
  const server = createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => state.doc,
      getDocumentState: async () => ({
        document: state.doc,
        version: state.version,
      }),
      patchDocument,
    } as never,
  });
  return { patchDocument, server, state };
}

function getCreatedFrame(doc: PenDocument) {
  const frame = doc.pages?.[0]?.children.find(
    (node) => node.id !== "existing" && node.type === "frame",
  );
  if (!frame || frame.type !== "frame") {
    throw new Error("Expected created frame.");
  }
  return frame as FrameNode;
}

describe("create_agent_output_container", () => {
  it("creates a canonical Agent output frame with metadata and children", async () => {
    const { server, state } = createOutputServer();

    await expect(
      server.callTool(
        "create_agent_output_container",
        {
          agentBinding: { agentId: "agent-1", role: "designer" },
          children: [
            {
              id: "child-text",
              type: "text",
              content: "Final answer",
              x: 24,
              y: 24,
              width: 180,
              height: 40,
            },
          ],
          contextSlots: { rules: ["Use brand kit"] },
          createdByAgentId: "agent-1",
          ioPorts: [{ id: "out", direction: "output", dataType: "image" }],
          name: "Generated concept",
          role: "visual",
          runId: "run-1",
          sessionId: "session-1",
          transactionId: "tx-output",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        contextSummary: {
          childCount: 1,
          contextSlotKeys: ["rules"],
          ioPortCount: 1,
          role: "visual",
        },
        createdChildIds: ["child-text"],
        outputBounds: { x: 420, y: 60, width: 720, height: 420 },
      },
    });
    const frame = getCreatedFrame(state.doc);
    expect(frame).toMatchObject({
      agentBinding: { agentId: "agent-1", role: "designer" },
      children: [expect.objectContaining({ id: "child-text" })],
      containerRole: ["visual"],
      contextSlots: { rules: ["Use brand kit"] },
      createdByAgentId: "agent-1",
      ioPorts: [{ id: "out", direction: "output", dataType: "image" }],
      name: "Generated concept",
      runId: "run-1",
      sessionId: "session-1",
      x: 420,
      y: 60,
    });
    expect(state.doc.selection).toEqual([frame.id]);
  });

  it("dry-runs without patching the live document", async () => {
    const { patchDocument, server, state } = createOutputServer();

    await expect(
      server.callTool(
        "create_agent_output_container",
        {
          bounds: { x: 10, y: 20, width: 320, height: 240 },
          dryRun: true,
          name: "Dry output",
          role: "context",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        contextSummary: { role: "context" },
        outputBounds: { x: 10, y: 20, width: 320, height: 240 },
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(state.doc.pages?.[0]?.children).toHaveLength(1);
  });

  it("fails clearly for duplicate child IDs", async () => {
    const { patchDocument, server } = createOutputServer();

    await expect(
      server.callTool(
        "create_agent_output_container",
        {
          children: [
            { id: "dup", type: "text", content: "A" },
            { id: "dup", type: "text", content: "B" },
          ],
          name: "Duplicate children",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_output_container_failed",
        message: expect.stringContaining("duplicate child node IDs"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
