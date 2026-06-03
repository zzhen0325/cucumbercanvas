import { createCanvasDocument } from "@cucumber/canvas-core";
import type { ContainerRole, PenDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import { createCucumberMcpServer } from "../server.js";

function createSelectionServer(doc: PenDocument & { selection?: string[] }) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => doc,
    } as never,
  });
}

function context() {
  return {
    configurable: {
      access_token: "token",
      canvas_id: "canvas-1",
      user_id: "user-1",
    },
  };
}

describe("get_selection_context", () => {
  it("returns an explicit empty-selection reason", async () => {
    const doc = createCanvasDocument("Empty selection") as PenDocument & {
      selection: string[];
    };
    doc.selection = [];
    const server = createSelectionServer(doc);

    await expect(
      server.callTool("get_selection_context", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        selectedNodeIds: [],
        emptyReason: expect.stringContaining("selection_empty"),
        capabilities: {
          canMove: {
            enabled: false,
            reason: expect.stringContaining("selection_empty"),
          },
          canEditText: {
            enabled: false,
            reason: expect.stringContaining("selection_empty"),
          },
        },
      },
    });
  });

  it("reports text edit capability and inherited context for selected text", async () => {
    const doc = createCanvasDocument("Text selection") as PenDocument & {
      selection: string[];
    };
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "agent-card",
        type: "frame",
        name: "Agent Card",
        width: 320,
        height: 180,
        containerRole: ["task"] as ContainerRole[],
        contextSlots: { rules: ["keep copy concise"] },
        children: [
          {
            id: "headline",
            type: "text",
            content: "Launch copy",
            width: 180,
            height: 32,
          },
        ],
      },
    ];
    doc.selection = ["headline"];
    const server = createSelectionServer(doc);

    await expect(
      server.callTool(
        "get_selection_context",
        { includeAncestors: true },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        activePageId: doc.activePageId,
        selectedNodeIds: ["headline"],
        selectedNodes: [
          expect.objectContaining({ id: "headline", type: "text" }),
        ],
        parentContainerPaths: [
          {
            nodeId: "headline",
            path: [expect.objectContaining({ id: "agent-card" })],
          },
        ],
        effectiveContextSlots: [
          {
            nodeId: "headline",
            contextSlots: { rules: ["keep copy concise"] },
          },
        ],
        capabilities: {
          canMove: { enabled: true },
          canResize: { enabled: true },
          canEditText: { enabled: true },
          canReplaceAsset: {
            enabled: false,
            reason: expect.stringContaining("not image or videoEmbed"),
          },
        },
        ancestors: [expect.objectContaining({ id: "agent-card" })],
      },
    });
  });

  it("reports asset replacement capability for image and video selections", async () => {
    const imageDoc = createCanvasDocument("Image selection") as PenDocument & {
      selection: string[];
    };
    const imagePage = imageDoc.pages?.[0];
    if (!imagePage) throw new Error("Expected default canvas page fixture.");
    imagePage.children = [
      {
        id: "hero",
        type: "image",
        src: "https://cdn.example.test/hero.png",
        width: 120,
        height: 90,
      },
    ];
    imageDoc.selection = ["hero"];

    await expect(
      createSelectionServer(imageDoc).callTool(
        "get_selection_context",
        {},
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        selectedNodeIds: ["hero"],
        capabilities: {
          canReplaceAsset: { enabled: true },
          canEditText: {
            enabled: false,
            reason: expect.stringContaining("not text"),
          },
        },
      },
    });

    const videoDoc = createCanvasDocument("Video selection") as PenDocument & {
      selection: string[];
    };
    const videoPage = videoDoc.pages?.[0];
    if (!videoPage) throw new Error("Expected default canvas page fixture.");
    videoPage.children = [
      {
        id: "clip",
        type: "videoEmbed",
        src: "https://cdn.example.test/clip.mp4",
      },
    ];
    videoDoc.selection = ["clip"];

    await expect(
      createSelectionServer(videoDoc).callTool(
        "get_selection_context",
        {},
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        selectedNodeIds: ["clip"],
        capabilities: {
          canReplaceAsset: { enabled: true },
        },
      },
    });
  });

  it("disables write capabilities with clear reasons for locked nodes", async () => {
    const doc = createCanvasDocument("Locked selection") as PenDocument & {
      selection: string[];
    };
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "locked-copy",
        type: "text",
        content: "Locked",
        locked: true,
        width: 120,
        height: 32,
      },
    ];
    doc.selection = ["locked-copy"];
    const server = createSelectionServer(doc);

    await expect(
      server.callTool("get_selection_context", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        selectedNodeIds: ["locked-copy"],
        capabilities: {
          canMove: {
            enabled: false,
            reason: expect.stringContaining("locked_selection"),
          },
          canEditText: {
            enabled: false,
            reason: expect.stringContaining("locked_selection"),
          },
          canConnect: {
            enabled: false,
            reason: expect.stringContaining("locked_selection"),
          },
        },
      },
    });
  });
});
