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

function createCritiqueServer(doc: PenDocument) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => doc,
      getDocumentState: async () => ({ document: doc, version: 1 }),
    } as never,
  });
}

describe("critique_canvas", () => {
  it("reports role, style, and deliverable findings without mutating", async () => {
    const doc = createCanvasDocument("Critique") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "output",
        type: "frame",
        name: "Output",
        children: [
          {
            id: "title",
            type: "text",
            content: "Title",
            fontSize: 48,
          },
        ],
      },
      {
        id: "empty",
        type: "frame",
        name: "Empty",
        containerRole: ["visual"],
        children: [],
      },
    ];

    await expect(
      createCritiqueServer(doc).callTool("critique_canvas", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        findingCounts: { error: 0, info: 1, warning: 2 },
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: "missing_style_context",
            severity: "info",
          }),
          expect.objectContaining({
            code: "missing_container_role",
            nodeId: "output",
            severity: "warning",
          }),
          expect.objectContaining({
            code: "empty_container",
            nodeId: "empty",
            severity: "warning",
          }),
        ]),
        pass: true,
      },
    });
  });

  it("includes validation summary findings when requested", async () => {
    const doc = createCanvasDocument("Critique validation") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "hero",
        type: "image",
        src: "asset:missing",
        width: 120,
        height: 80,
      },
    ];

    await expect(
      createCritiqueServer(doc).callTool(
        "critique_canvas",
        { checks: ["validation_summary"], includeValidation: true },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        findings: [
          expect.objectContaining({
            code: "validation_missing_asset",
            nodeId: "hero",
            severity: "error",
          }),
        ],
        pass: false,
        validationSummary: {
          issueCounts: { error: 1 },
          pass: false,
        },
      },
    });
  });

  it("honors severityThreshold", async () => {
    const doc = createCanvasDocument("Critique threshold") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "output",
        type: "frame",
        children: [{ id: "copy", type: "text", content: "Copy" }],
      },
    ];

    await expect(
      createCritiqueServer(doc).callTool(
        "critique_canvas",
        { severityThreshold: "warning" },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        findingCounts: { error: 0, info: 0, warning: 1 },
        findings: [
          expect.objectContaining({
            code: "missing_container_role",
          }),
        ],
      },
    });
  });
});
