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

function createExportServer(doc: PenDocument & { selection?: string[] }) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => doc,
      getDocumentState: async () => ({ document: doc, version: 1 }),
    } as never,
  });
}

function createExportDoc() {
  const doc = createCanvasDocument("Export") as PenDocument & {
    selection?: string[];
  };
  doc.assets = {
    hero_asset: {
      id: "hero_asset",
      mimeType: "image/png",
      source: "upload",
      url: "https://cdn.example.test/hero.png",
      width: 800,
      height: 600,
    },
  };
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    {
      id: "output",
      type: "frame",
      name: "Output",
      containerRole: ["visual"],
      contextSlots: { rules: ["Use brand color"] },
      x: 10,
      y: 20,
      width: 320,
      height: 240,
      children: [
        {
          id: "hero",
          type: "image",
          src: "https://cdn.example.test/hero.png",
          x: 24,
          y: 40,
          width: 160,
          height: 90,
        },
        {
          id: "copy",
          type: "text",
          content: "Ready",
          x: 24,
          y: 152,
          width: 180,
          height: 40,
        },
      ],
    },
    {
      id: "process",
      type: "frame",
      name: "Process",
      containerRole: ["dataflow"],
      x: 420,
      y: 20,
      width: 160,
      height: 120,
      children: [],
    },
    {
      id: "connector",
      type: "line",
      connector: {
        arrow: true,
        end: { nodeId: "process", ratio: 0.5, side: "left" },
        routing: "smooth",
        start: { nodeId: "output", ratio: 0.5, side: "right" },
      },
      x: 330,
      y: 140,
      x2: 420,
      y2: 80,
    },
  ];
  doc.selection = ["output"];
  return doc;
}

describe("export_canvas_deliverable", () => {
  it("exports selected nodes as structured JSON with traceable source IDs", async () => {
    const doc = createExportDoc();

    await expect(
      createExportServer(doc).callTool(
        "export_canvas_deliverable",
        { title: "Final output" },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        deliverable: {
          assets: [
            expect.objectContaining({
              id: "hero_asset",
              url: "https://cdn.example.test/hero.png",
            }),
          ],
          nodes: [
            expect.objectContaining({
              children: [
                expect.objectContaining({ id: "hero", type: "image" }),
                expect.objectContaining({ id: "copy", type: "text" }),
              ],
              id: "output",
              type: "frame",
            }),
          ],
          rootNodeIds: ["output"],
          sourceNodeIds: ["output", "hero", "copy"],
          target: "structured_json",
          title: "Final output",
        },
        sourceNodeIds: ["output", "hero", "copy"],
        target: "structured_json",
      },
    });
  });

  it("exports flow specs with connector endpoints", async () => {
    const doc = createExportDoc();

    await expect(
      createExportServer(doc).callTool(
        "export_canvas_deliverable",
        {
          nodeIds: ["output", "process", "connector"],
          target: "flow_spec",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        deliverable: {
          edges: [
            expect.objectContaining({
              id: "connector",
              source: { nodeId: "output", ratio: 0.5, side: "right" },
              target: { nodeId: "process", ratio: 0.5, side: "left" },
            }),
          ],
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "output" }),
            expect.objectContaining({ id: "process" }),
            expect.objectContaining({ id: "connector" }),
          ]),
          target: "flow_spec",
        },
      },
    });
  });

  it("fails clearly for unsupported render/code targets", async () => {
    const doc = createExportDoc();

    await expect(
      createExportServer(doc).callTool(
        "export_canvas_deliverable",
        { target: "poster" },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "export_canvas_deliverable_failed",
        message: expect.stringContaining("target poster is not implemented"),
      },
    });
  });
});
