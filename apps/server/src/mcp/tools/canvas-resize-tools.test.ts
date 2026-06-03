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

function createResizeDoc() {
  const doc = createCanvasDocument("Resize") as PenDocument & {
    selection?: string[];
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "container",
      type: "frame",
      name: "Container",
      x: 100,
      y: 80,
      width: 160,
      height: 120,
      children: [
        {
          id: "title",
          type: "text",
          content: "Title",
          x: 20,
          y: 24,
          width: 90,
          height: 30,
        },
        {
          id: "image",
          type: "image",
          src: "https://cdn.example.test/image.png",
          x: 170,
          y: 110,
          width: 120,
          height: 80,
        },
        {
          id: "hidden",
          type: "rectangle",
          visible: false,
          x: 500,
          y: 500,
          width: 300,
          height: 300,
        },
      ],
    },
    {
      id: "empty",
      type: "frame",
      name: "Empty",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [],
    },
  ];
  return doc;
}

function createResizeServer(
  initialDoc = createResizeDoc(),
  initialVersion = 11,
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

function getFrame(doc: PenDocument, nodeId: string) {
  const node = doc.pages?.[0]?.children.find((child) => child.id === nodeId);
  if (!node || node.type !== "frame") {
    throw new Error(`Expected frame ${nodeId}.`);
  }
  return node;
}

describe("resize_container_to_fit", () => {
  it("resizes a container to fit visible descendants and selects it", async () => {
    const { server, state } = createResizeServer();

    await expect(
      server.callTool(
        "resize_container_to_fit",
        {
          containerId: "container",
          padding: 24,
          transactionId: "tx-resize",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        affectedChildIds: ["title", "image"],
        appliedOperationCount: 1,
        layoutWarnings: [],
        nextBounds: { width: 314, height: 214 },
        previousBounds: { x: 100, y: 80, width: 160, height: 120 },
      },
    });
    expect(getFrame(state.doc, "container")).toMatchObject({
      height: 214,
      width: 314,
    });
    expect(state.doc.selection).toEqual(["container"]);
  });

  it("dry-runs without patching the live document", async () => {
    const { patchDocument, server, state } = createResizeServer();

    await expect(
      server.callTool(
        "resize_container_to_fit",
        {
          axis: "height",
          containerId: "container",
          dryRun: true,
          padding: 16,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        dryRun: true,
        nextBounds: { width: 160, height: 206 },
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(getFrame(state.doc, "container")).toMatchObject({
      height: 120,
      width: 160,
    });
  });

  it("returns max-size warnings when fit is clamped", async () => {
    const { server } = createResizeServer();

    await expect(
      server.callTool(
        "resize_container_to_fit",
        {
          containerId: "container",
          dryRun: true,
          maxWidth: 200,
          padding: 24,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        layoutWarnings: [
          expect.objectContaining({
            code: "max_width_clamps_fit",
          }),
        ],
        nextBounds: { width: 200, height: 214 },
      },
    });
  });

  it("fails clearly for empty containers", async () => {
    const { patchDocument, server } = createResizeServer();

    await expect(
      server.callTool(
        "resize_container_to_fit",
        { containerId: "empty" },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "resize_container_to_fit_failed",
        message: expect.stringContaining("has no visible children"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
