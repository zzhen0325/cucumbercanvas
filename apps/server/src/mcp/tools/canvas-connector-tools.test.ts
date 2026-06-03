import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
} from "@cucumber/canvas-core";
import type { LineNode, PenDocument } from "@cucumber/canvas-core";
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

function createConnectorDoc() {
  const doc = createCanvasDocument("Connectors") as PenDocument & {
    selection?: string[];
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "source",
      type: "frame",
      name: "Source",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      children: [],
    },
    {
      id: "target",
      type: "rectangle",
      name: "Target",
      x: 260,
      y: 30,
      width: 100,
      height: 60,
    },
    {
      id: "below",
      type: "group",
      name: "Below",
      x: 30,
      y: 220,
      width: 140,
      height: 90,
      children: [],
    },
    {
      id: "copy",
      type: "text",
      content: "Cannot connect",
    },
  ];
  return doc;
}

function createConnectorServer(
  initialDoc = createConnectorDoc(),
  initialVersion = 7,
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

function getLineNodes(doc: PenDocument) {
  return (doc.pages?.[0]?.children ?? []).filter(
    (node): node is LineNode => node.type === "line",
  );
}

describe("connect_nodes", () => {
  it("creates a bound source-to-target connector and selects it", async () => {
    const { server, state } = createConnectorServer();

    await expect(
      server.callTool(
        "connect_nodes",
        {
          label: "Feeds",
          relationship: "source feeds target",
          sourceNodeId: "source",
          targetNodeId: "target",
          transactionId: "tx-connect",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        dryRun: false,
        endpointBindings: {
          source: { nodeId: "source", ratio: 0.5, side: "right" },
          target: { nodeId: "target", ratio: 0.5, side: "left" },
        },
        routeSummary: {
          direction: "source_to_target",
          relationship: "source feeds target",
          routing: "smooth",
        },
      },
    });
    const line = getLineNodes(state.doc)[0];
    expect(line).toMatchObject({
      connector: {
        arrow: true,
        end: { nodeId: "target", side: "left" },
        start: { nodeId: "source", side: "right" },
      },
      explain: "source feeds target",
      name: "Feeds",
      stroke: { endTip: "line-arrow" },
    });
    expect(state.doc.selection).toEqual([line?.id]);
  });

  it("supports bidirectional vertical routing in dry-run mode", async () => {
    const { patchDocument, server, state } = createConnectorServer();

    await expect(
      server.callTool(
        "connect_nodes",
        {
          direction: "bidirectional",
          dryRun: true,
          routing: "straight",
          sourceNodeId: "source",
          style: { strokeColor: "#2563eb", strokeWidth: 2 },
          targetNodeId: "below",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        endpointBindings: {
          source: { nodeId: "source", ratio: 0.5, side: "bottom" },
          target: { nodeId: "below", ratio: 0.5, side: "top" },
        },
        routeSummary: {
          direction: "bidirectional",
          routing: "straight",
        },
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(getLineNodes(state.doc)).toEqual([]);
  });

  it("fails clearly for unsupported target node types", async () => {
    const { patchDocument, server } = createConnectorServer();

    await expect(
      server.callTool(
        "connect_nodes",
        {
          sourceNodeId: "source",
          targetNodeId: "copy",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "connect_nodes_failed",
        message: expect.stringContaining(
          "only supports frame, group, and rectangle targets",
        ),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
