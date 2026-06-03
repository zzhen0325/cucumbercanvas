import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createCanvasDocument } from "@cucumber/canvas-core";
import type { ContainerRole, PenDocument } from "@cucumber/canvas-core";
import { createCucumberMcpServer } from "./server.js";
import { schemaToJsonSchema, unwrapMcpToolResult } from "./utils.js";

describe("schemaToJsonSchema", () => {
  it("converts Zod object schemas into MCP-friendly JSON schema", () => {
    const jsonSchema = schemaToJsonSchema(
      z.object({
        prompt: z.string().min(1),
        quality: z.enum(["draft", "final"]).optional(),
      }),
    );

    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: {
        prompt: expect.any(Object),
        quality: expect.any(Object),
      },
    });
  });
});

describe("createCucumberMcpServer", () => {
  it("lists MCP tools with JSON input schemas", () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
    });

    const generateImage = server
      .listTools()
      .find((toolDef) => toolDef.name === "generate_image");

    expect(generateImage).toMatchObject({
      name: "generate_image",
      inputSchema: {
        type: "object",
        properties: expect.objectContaining({
          model: expect.any(Object),
          prompt: expect.any(Object),
          title: expect.any(Object),
        }),
      },
    });
  });

  it("returns a structured tool_not_found error for missing tools", async () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
    });

    await expect(server.callTool("missing_tool", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "tool_not_found",
        message: "Tool not found: missing_tool",
      },
    });
  });

  it("passes live canvas service through to inspect_canvas", async () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
      liveCanvasService: {
        getDocument: async () => createCanvasDocument("Inspectable"),
      } as never,
    });

    await expect(
      server.callTool(
        "inspect_canvas",
        { detail_level: "summary" },
        {
          configurable: {
            access_token: "token",
            canvas_id: "canvas-1",
            user_id: "user-1",
          },
        },
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        canvasId: "canvas-1",
        nodeCount: 0,
      },
    });
  });

  it("reads live canvas semantic workspace context", async () => {
    const doc = createCanvasDocument("Semantic") as PenDocument & {
      selection: string[];
    };
    doc.assets = {
      hero_asset: {
        id: "hero_asset",
        mimeType: "image/png",
        source: "generated",
        url: "https://cdn.example.test/hero.png",
      },
    };
    doc.variables = {
      brand: { type: "color", value: "#5522ff" },
    };
    doc.themes = { mode: ["light", "dark"] };
    doc.selection = ["brief"];
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      {
        id: "brief",
        type: "frame",
        name: "Creative Brief",
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        containerRole: ["task", "visual"] as ContainerRole[],
        contextSlots: { rules: ["Use the brand color"] },
        agentBinding: {
          agentId: "agent-1",
          name: "Designer",
          permissions: ["read", "write"],
          status: "running",
        },
        ioPorts: [
          {
            id: "brief-out",
            direction: "output",
            dataType: "prompt",
            label: "Brief",
          },
        ],
        children: [
          {
            id: "brief-copy",
            type: "text",
            content: "Launch concept",
            fill: [{ type: "solid", color: "$brand" }],
            x: 16,
            y: 16,
            width: 180,
            height: 32,
          },
          {
            id: "hero",
            type: "image",
            src: "https://cdn.example.test/hero.png",
            x: 16,
            y: 64,
            width: 96,
            height: 96,
          },
        ],
      },
      {
        id: "final",
        type: "frame",
        name: "Final Output",
        x: 460,
        y: 0,
        width: 320,
        height: 180,
        containerRole: ["visual"] as ContainerRole[],
        children: [],
      },
      {
        id: "edge-1",
        type: "line",
        x: 320,
        y: 90,
        x2: 460,
        y2: 90,
        connector: {
          start: { nodeId: "brief", side: "right", ratio: 0.5 },
          end: { nodeId: "final", side: "left", ratio: 0.5 },
          routing: "smooth",
          arrow: true,
        },
      },
      {
        id: "hidden-note",
        type: "text",
        content: "internal",
        visible: false,
      },
    ];

    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
      liveCanvasService: {
        getDocument: async () => doc,
      } as never,
    });

    await expect(
      server.callTool(
        "inspect_canvas_semantic",
        { includeVariables: true, focusNodeIds: ["final"] },
        {
          configurable: {
            access_token: "token",
            canvas_id: "canvas-1",
            user_id: "user-1",
          },
        },
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        canvasId: "canvas-1",
        selectedNodeIds: ["brief"],
        focusNodes: [
          expect.objectContaining({ id: "brief" }),
          expect.objectContaining({ id: "final" }),
        ],
        semanticContainers: [
          expect.objectContaining({
            id: "brief",
            role: ["task", "visual"],
            agentBinding: expect.objectContaining({ agentId: "agent-1" }),
            ioPorts: [expect.objectContaining({ id: "brief-out" })],
          }),
          expect.objectContaining({ id: "final" }),
        ],
        dataflowEdges: [
          expect.objectContaining({
            id: "edge-1",
            source: expect.objectContaining({ nodeId: "brief" }),
            target: expect.objectContaining({ nodeId: "final" }),
            routing: "smooth",
            arrow: true,
          }),
        ],
        assets: {
          documentAssetCount: 1,
          references: [
            expect.objectContaining({
              nodeId: "hero",
              assetId: "hero_asset",
              mimeType: "image/png",
            }),
          ],
        },
        variables: expect.objectContaining({
          usedVariableNames: ["brand"],
          themes: { mode: ["light", "dark"] },
        }),
        warnings: [
          expect.objectContaining({
            code: "hidden_node_omitted",
            nodeId: "hidden-note",
          }),
        ],
      },
    });
  });

  it("reads an explicit semantic page without mixing active page nodes", async () => {
    const doc = createCanvasDocument("Two Pages");
    if (!doc.pages?.[0]) throw new Error("Expected default page fixture.");
    doc.pages[0].children = [
      {
        id: "active-frame",
        type: "frame",
        width: 100,
        height: 100,
        children: [],
      },
    ];
    doc.pages.push({
      id: "page-2",
      name: "Second Page",
      children: [
        {
          id: "page-2-frame",
          type: "frame",
          width: 100,
          height: 100,
          children: [],
        },
      ],
    });
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
      liveCanvasService: {
        getDocument: async () => doc,
      } as never,
    });

    await expect(
      server.callTool(
        "inspect_canvas_semantic",
        { pageId: "page-2" },
        {
          configurable: {
            access_token: "token",
            canvas_id: "canvas-1",
            user_id: "user-1",
          },
        },
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        document: {
          activePageId: "page-2",
          activePageName: "Second Page",
        },
        semanticContainers: [expect.objectContaining({ id: "page-2-frame" })],
      },
    });
  });

  it("fails semantic inspection clearly for legacy root children documents", async () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
      liveCanvasService: {
        getDocument: async () => ({
          version: "legacy",
          children: [{ id: "legacy-node", type: "frame", children: [] }],
        }),
      } as never,
    });

    await expect(
      server.callTool(
        "inspect_canvas_semantic",
        {},
        {
          configurable: {
            access_token: "token",
            canvas_id: "canvas-1",
            user_id: "user-1",
          },
        },
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "inspect_canvas_semantic_failed",
        message: expect.stringContaining(
          "Legacy root children are not supported",
        ),
      },
    });
  });
});

describe("unwrapMcpToolResult", () => {
  it("prefers structured content and falls back to text", () => {
    expect(
      unwrapMcpToolResult({
        content: [{ type: "text", text: "ignored" }],
        structuredContent: { jobId: "job-1", status: "queued" },
      }),
    ).toEqual({ jobId: "job-1", status: "queued" });

    expect(
      unwrapMcpToolResult({
        content: [{ type: "text", text: "plain text result" }],
      }),
    ).toBe("plain text result");
  });
});
