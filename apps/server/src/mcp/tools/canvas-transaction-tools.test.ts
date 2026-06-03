import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
} from "@cucumber/canvas-core";
import type { PenDocument } from "@cucumber/canvas-core";
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

function createDoc() {
  const doc = createCanvasDocument("Transaction") as PenDocument & {
    selection?: string[];
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "card",
      type: "frame",
      name: "Card",
      x: 10,
      y: 20,
      width: 180,
      height: 120,
      children: [
        {
          id: "copy",
          type: "text",
          content: "Draft",
          x: 12,
          y: 16,
          width: 80,
          height: 32,
        },
      ],
    },
    {
      id: "hero",
      type: "image",
      src: "https://cdn.example.test/hero.png",
      x: 260,
      y: 20,
      width: 120,
      height: 90,
    },
  ];
  doc.selection = ["copy"];
  return doc;
}

function createTransactionServer(initialDoc = createDoc(), initialVersion = 5) {
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

function getCopyNodeContent(doc: PenDocument & { selection?: string[] }) {
  const card = doc.pages?.[0]?.children[0];
  if (!card || !("children" in card) || !Array.isArray(card.children)) {
    throw new Error("Expected card frame fixture with children.");
  }
  const copy = card.children[0];
  return copy && "content" in copy ? copy.content : undefined;
}

describe("canvas transaction MCP tools", () => {
  it("previews operations without mutating the live document", async () => {
    const { server, state } = createTransactionServer();

    await expect(
      server.callTool(
        "canvas_diff_preview",
        {
          operations: [
            {
              type: "updateNode",
              nodeId: "copy",
              updates: { content: "Final" },
            },
          ],
          transactionId: "tx-preview",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        transactionIdCandidate: "tx-preview",
        affectedNodeIds: expect.arrayContaining(["copy"]),
        updatedNodeIds: ["copy"],
        deletedNodeIds: [],
        highRiskChanges: [],
      },
    });
    expect(getCopyNodeContent(state.doc)).toBe("Draft");
  });

  it("marks delete and asset replacement previews as high risk", async () => {
    const { server } = createTransactionServer();

    await expect(
      server.callTool(
        "canvas_diff_preview",
        {
          operations: [
            { type: "deleteNode", nodeId: "card" },
            {
              type: "updateNode",
              nodeId: "hero",
              updates: { src: "https://cdn.example.test/new.png" },
            },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        deletedNodeIds: expect.arrayContaining(["card", "copy"]),
        highRiskChanges: [
          expect.objectContaining({ code: "delete_node", nodeId: "card" }),
          expect.objectContaining({
            code: "asset_replacement",
            nodeId: "hero",
          }),
        ],
      },
    });
  });

  it("fails previews with concrete reasons for invalid node IDs", async () => {
    const { server } = createTransactionServer();

    await expect(
      server.callTool(
        "canvas_diff_preview",
        {
          operations: [
            {
              type: "updateNode",
              nodeId: "missing",
              updates: { content: "Nope" },
            },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "node_not_found",
        message: expect.stringContaining("Node missing does not exist"),
      },
    });
  });

  it("dry-runs apply_canvas_transaction without patching the live editor", async () => {
    const { patchDocument, server } = createTransactionServer();

    await expect(
      server.callTool(
        "apply_canvas_transaction",
        {
          dryRun: true,
          operations: [
            {
              type: "updateNode",
              nodeId: "copy",
              updates: { content: "Dry run" },
            },
          ],
          transactionId: "tx-dry",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        success: true,
        dryRun: true,
        transactionId: "tx-dry",
        appliedOperationCount: 0,
        previewedOperationCount: 1,
        nextDocumentVersion: 5,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("applies a patch transaction and reports the same affected nodes as preview", async () => {
    const { server, state } = createTransactionServer();
    const operations = [
      {
        type: "updateNode",
        nodeId: "copy",
        updates: { content: "Final" },
      },
    ];

    const preview = await server.callTool(
      "canvas_diff_preview",
      { operations, transactionId: "tx-apply" },
      context(),
    );
    const applied = await server.callTool(
      "apply_canvas_transaction",
      {
        baseVersion: 5,
        operations,
        selection: ["card"],
        transactionId: "tx-apply",
      },
      context(),
    );

    expect(applied).toMatchObject({
      structuredContent: {
        success: true,
        dryRun: false,
        transactionId: "tx-apply",
        appliedOperationCount: 1,
        nextDocumentVersion: 6,
      },
    });
    expect(applied.structuredContent?.affectedNodeIds).toEqual(
      preview.structuredContent?.affectedNodeIds,
    );
    expect(state.doc.selection).toEqual(["card"]);
    expect(getCopyNodeContent(state.doc)).toBe("Final");
  });

  it("fails apply_canvas_transaction when baseVersion is stale", async () => {
    const { patchDocument, server } = createTransactionServer();

    await expect(
      server.callTool(
        "apply_canvas_transaction",
        {
          baseVersion: 4,
          operations: [
            {
              type: "updateNode",
              nodeId: "copy",
              updates: { content: "Stale" },
            },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "apply_canvas_transaction_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
