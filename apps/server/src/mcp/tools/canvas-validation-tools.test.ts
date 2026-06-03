import { createCanvasDocument } from "@cucumber/canvas-core";
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

function createValidationServer(doc: PenDocument) {
  return createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => doc,
      getDocumentState: async () => ({ document: doc, version: 1 }),
    } as never,
  });
}

describe("validate_canvas", () => {
  it("passes a valid simple page", async () => {
    const doc = createCanvasDocument("Valid");
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "label",
        type: "text",
        content: "OK",
        width: 120,
        height: 40,
        textGrowth: "fixed-width-height",
      },
    ];

    await expect(
      createValidationServer(doc).callTool("validate_canvas", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        pass: true,
        issueCounts: { error: 0, warning: 0, info: 0 },
        checkedNodeIds: ["label"],
      },
    });
  });

  it("detects missing assets", async () => {
    const doc = createCanvasDocument("Missing asset");
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "hero",
        type: "image",
        src: "asset:missing-hero",
        width: 200,
        height: 120,
      },
    ];

    await expect(
      createValidationServer(doc).callTool("validate_canvas", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        pass: false,
        issues: [
          expect.objectContaining({
            code: "missing_asset",
            nodeId: "hero",
            severity: "error",
          }),
        ],
      },
    });
  });

  it("detects dangling connector endpoints", async () => {
    const doc = createCanvasDocument("Dangling connector");
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "connector",
        type: "line",
        x: 0,
        y: 0,
        x2: 100,
        y2: 0,
        connector: {
          start: { nodeId: "missing-source", side: "right", ratio: 0.5 },
          end: { nodeId: "missing-target", side: "left", ratio: 0.5 },
        },
      },
    ];

    await expect(
      createValidationServer(doc).callTool("validate_canvas", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        pass: false,
        issues: [
          expect.objectContaining({
            code: "dangling_connector",
            nodeId: "connector",
            severity: "error",
          }),
          expect.objectContaining({
            code: "dangling_connector",
            nodeId: "connector",
            severity: "error",
          }),
        ],
      },
    });
  });

  it("detects likely fixed text overflow", async () => {
    const doc = createCanvasDocument("Text overflow");
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "copy",
        type: "text",
        content:
          "This is a very long line that cannot fit in a tiny fixed box.",
        width: 24,
        height: 12,
        fontSize: 16,
        textGrowth: "fixed-width-height",
      },
    ];

    await expect(
      createValidationServer(doc).callTool("validate_canvas", {}, context()),
    ).resolves.toMatchObject({
      structuredContent: {
        pass: true,
        issues: [
          expect.objectContaining({
            code: "text_overflow",
            nodeId: "copy",
            severity: "warning",
          }),
        ],
      },
    });
  });
});

describe("screenshot_canvas MCP wrapper", () => {
  it("calls the browser screenshot RPC with expected params", async () => {
    const rpc = vi.fn(async () => ({
      actualBounds: { x: 0, y: 0, width: 300, height: 200 },
      height: 200,
      url: "data:image/svg+xml,<svg />",
      width: 300,
    }));
    const server = createCucumberMcpServer({} as never, {
      connectionManager: { rpc } as never,
      createUserClient: () => ({}),
    });

    await expect(
      server.callTool(
        "screenshot_canvas",
        {
          mode: "region",
          region: { x: 10, y: 20, width: 120, height: 80 },
          max_dimension: 512,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        actualBounds: { x: 0, y: 0, width: 300, height: 200 },
        height: 200,
        width: 300,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "user-1",
      "canvas.screenshot",
      {
        mode: "region",
        region: { x: 10, y: 20, width: 120, height: 80 },
        max_dimension: 512,
      },
      10000,
    );
  });

  it("returns a structured error when user context is missing", async () => {
    const server = createCucumberMcpServer({} as never, {
      connectionManager: { rpc: vi.fn() } as never,
      createUserClient: () => ({}),
    });

    await expect(
      server.callTool("screenshot_canvas", { mode: "full" }, {}),
    ).resolves.toMatchObject({
      structuredContent: {
        error: "no_user_context",
        message: expect.stringContaining("requires a user context"),
      },
    });
  });
});
