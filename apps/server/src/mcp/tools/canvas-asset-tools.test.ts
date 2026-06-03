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

function createAssetDoc() {
  const doc = createCanvasDocument("Assets") as PenDocument & {
    selection?: string[];
  };
  doc.assets = {
    asset_hero: {
      id: "asset_hero",
      mimeType: "image/png",
      name: "Hero",
      source: "upload",
      url: "https://cdn.example.test/hero.png",
      width: 800,
      height: 600,
    },
    asset_video: {
      id: "asset_video",
      mimeType: "video/mp4",
      source: "generated",
      url: "https://cdn.example.test/clip.mp4",
    },
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "hero",
      type: "image",
      src: "https://cdn.example.test/hero.png",
      x: 10,
      y: 20,
      width: 320,
      height: 180,
    },
    {
      id: "shape",
      type: "rectangle",
      x: 360,
      y: 20,
      width: 160,
      height: 120,
      fill: [
        {
          type: "image",
          url: "asset:missing-fill",
        },
      ],
    },
    {
      id: "clip",
      type: "videoEmbed",
      src: "https://cdn.example.test/clip.mp4",
      x: 10,
      y: 240,
    },
  ];
  return doc;
}

function createAssetServer(initialDoc = createAssetDoc(), initialVersion = 3) {
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

function getNode(doc: PenDocument, nodeId: string) {
  const node = doc.pages?.[0]?.children.find((child) => child.id === nodeId);
  if (!node) throw new Error(`Expected node ${nodeId}.`);
  return node;
}

describe("query_canvas_assets", () => {
  it("returns canvas assets, references, and missing asset references", async () => {
    const { server } = createAssetServer();

    await expect(
      server.callTool("query_canvas_assets", { type: "all" }, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        assets: [
          expect.objectContaining({
            id: "asset_hero",
            referencedNodeIds: ["hero"],
            references: [
              expect.objectContaining({
                fieldPath: "src",
                nodeId: "hero",
              }),
            ],
          }),
          expect.objectContaining({
            id: "asset_video",
            referencedNodeIds: ["clip"],
          }),
        ],
        missingAssetReferences: [
          expect.objectContaining({
            fieldPath: "fill.0.url",
            nodeId: "shape",
            value: "asset:missing-fill",
          }),
        ],
        referencedNodeIds: expect.arrayContaining(["hero", "clip"]),
      },
    });
  });

  it("filters assets by type, source, and referencedOnly", async () => {
    const doc = createAssetDoc();
    doc.assets = {
      ...doc.assets,
      asset_unused: {
        id: "asset_unused",
        mimeType: "image/png",
        source: "upload",
        url: "https://cdn.example.test/unused.png",
      },
    };
    const { server } = createAssetServer(doc);

    await expect(
      server.callTool(
        "query_canvas_assets",
        { referencedOnly: true, source: "upload", type: "image" },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        assets: [
          expect.objectContaining({
            id: "asset_hero",
          }),
        ],
      },
    });
  });
});

describe("replace_asset_in_node", () => {
  it("reuses an existing asset while preserving node identity and bounds", async () => {
    const doc = createAssetDoc();
    doc.assets = {
      ...doc.assets,
      asset_variant: {
        id: "asset_variant",
        mimeType: "image/png",
        source: "generated",
        url: "https://cdn.example.test/variant.png",
      },
    };
    const { server, state } = createAssetServer(doc);

    await expect(
      server.callTool(
        "replace_asset_in_node",
        {
          assetId: "asset_variant",
          nodeId: "hero",
          transactionId: "tx-existing-asset",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        dryRun: false,
        nextAsset: {
          assetId: "asset_variant",
          source: "https://cdn.example.test/variant.png",
        },
        preservedBounds: { x: 10, y: 20, width: 320, height: 180 },
        previousAsset: {
          fieldPath: "src",
          source: "https://cdn.example.test/hero.png",
        },
        targetNodeId: "hero",
        updateFieldPath: "src",
      },
    });
    expect(getNode(state.doc, "hero")).toMatchObject({
      id: "hero",
      src: "https://cdn.example.test/variant.png",
      width: 320,
      height: 180,
    });
  });

  it("creates an asset record and replaces an image fill in one patch", async () => {
    const { server, state } = createAssetServer();

    await expect(
      server.callTool(
        "replace_asset_in_node",
        {
          mimeType: "image/png",
          nodeId: "shape",
          transactionId: "tx-new-fill",
          url: "https://cdn.example.test/new-fill.png",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 2,
        targetNodeId: "shape",
        updateFieldPath: "fill.0.url",
      },
    });
    expect(Object.values(state.doc.assets ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mimeType: "image/png",
          source: "generated",
          url: "https://cdn.example.test/new-fill.png",
        }),
      ]),
    );
    expect(getNode(state.doc, "shape")).toMatchObject({
      fill: [
        expect.objectContaining({
          type: "image",
          url: "https://cdn.example.test/new-fill.png",
        }),
      ],
    });
  });

  it("dry-runs without patching the live document", async () => {
    const { patchDocument, server, state } = createAssetServer();

    await expect(
      server.callTool(
        "replace_asset_in_node",
        {
          dryRun: true,
          mimeType: "image/png",
          nodeId: "hero",
          url: "https://cdn.example.test/dry.png",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        dryRun: true,
        previewedOperationCount: 2,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(getNode(state.doc, "hero")).toMatchObject({
      src: "https://cdn.example.test/hero.png",
    });
  });

  it("fails when the replacement mime type cannot be consumed by the node", async () => {
    const { patchDocument, server } = createAssetServer();

    await expect(
      server.callTool(
        "replace_asset_in_node",
        {
          mimeType: "video/mp4",
          nodeId: "hero",
          url: "https://cdn.example.test/wrong.mp4",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "replace_asset_in_node_failed",
        message: expect.stringContaining("requires image asset input"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
