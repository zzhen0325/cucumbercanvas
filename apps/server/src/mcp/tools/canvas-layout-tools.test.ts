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

function createLayoutDoc() {
  const doc = createCanvasDocument("Layout") as PenDocument & {
    selection?: string[];
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "container",
      type: "frame",
      name: "Container",
      x: 0,
      y: 0,
      width: 420,
      height: 320,
      children: [
        { id: "a", type: "rectangle", x: 20, y: 90, width: 50, height: 40 },
        { id: "b", type: "rectangle", x: 120, y: 10, width: 80, height: 40 },
        { id: "c", type: "rectangle", x: 40, y: 160, width: 60, height: 40 },
      ],
    },
    {
      id: "outside",
      type: "rectangle",
      x: 20,
      y: 400,
      width: 100,
      height: 50,
    },
  ];
  return doc;
}

function createLayoutServer(
  initialDoc = createLayoutDoc(),
  initialVersion = 17,
) {
  const state = {
    doc: initialDoc,
    patchCalls: [] as {
      baseVersion: number;
      operations: CanvasOperation[];
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
    state.doc = result.doc as typeof state.doc;
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

function getContainerChildren(doc: PenDocument) {
  const container = doc.pages?.[0]?.children.find(
    (node) => node.id === "container",
  );
  if (
    !container ||
    !("children" in container) ||
    !Array.isArray(container.children)
  ) {
    throw new Error("Expected container fixture.");
  }
  return container.children;
}

describe("layout_canvas", () => {
  it("stacks visible container children in parent-local coordinates", async () => {
    const { server, state } = createLayoutServer();

    await expect(
      server.callTool(
        "layout_canvas",
        {
          containerId: "container",
          direction: "vertical",
          gap: 12,
          padding: 16,
          strategy: "stack",
          transactionId: "tx-stack",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        affectedNodeIds: ["a", "b", "c"],
        appliedOperationCount: 3,
        strategy: "stack",
      },
    });
    expect(getContainerChildren(state.doc)).toEqual([
      expect.objectContaining({ id: "a", x: 16, y: 68 }),
      expect.objectContaining({ id: "b", x: 16, y: 16 }),
      expect.objectContaining({ id: "c", x: 16, y: 120 }),
    ]);
  });

  it("sets auto-layout fields on the container without moving children", async () => {
    const { server, state } = createLayoutServer();

    await expect(
      server.callTool(
        "layout_canvas",
        {
          containerId: "container",
          direction: "horizontal",
          gap: 20,
          padding: [12, 18],
          strategy: "auto_layout",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        affectedNodeIds: ["container"],
        appliedOperationCount: 1,
        strategy: "auto_layout",
      },
    });
    const container = state.doc.pages?.[0]?.children[0];
    expect(container).toMatchObject({
      gap: 20,
      layout: "horizontal",
      padding: [12, 18],
    });
    expect(getContainerChildren(state.doc)[0]).toMatchObject({
      id: "a",
      x: 20,
      y: 90,
    });
  });

  it("dry-runs flow layout without patching the live document", async () => {
    const { patchDocument, server, state } = createLayoutServer();

    await expect(
      server.callTool(
        "layout_canvas",
        {
          bounds: { x: 0, y: 0, width: 130, height: 300 },
          containerId: "container",
          dryRun: true,
          gap: 10,
          strategy: "flow",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 3,
        strategy: "flow",
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(getContainerChildren(state.doc)[0]).toMatchObject({ x: 20, y: 90 });
  });

  it("fails clearly when moving nodes across parent coordinate spaces", async () => {
    const { patchDocument, server } = createLayoutServer();

    await expect(
      server.callTool(
        "layout_canvas",
        {
          nodeIds: ["a", "outside"],
          strategy: "stack",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "layout_canvas_failed",
        message: expect.stringContaining("share one parent coordinate space"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
