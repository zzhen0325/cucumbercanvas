import {
  type PenDocument,
  createEmptyDocument,
  findNode,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import { createInMemoryMcpServer } from "../server.js";
import { createOpenPencilCanvasMcpTools } from "./open-pencil-canvas.js";

const userContext = {
  configurable: {
    access_token: "token",
    canvas_id: "canvas-1",
    user_id: "user-1",
  },
};

function createLiveCanvasHarness(initialDoc: PenDocument) {
  const state = { doc: initialDoc };
  const liveCanvasService = {
    getDocument: async () => state.doc,
    setDocument: async (
      _user: unknown,
      _canvasId: string,
      doc: PenDocument,
    ) => {
      state.doc = doc;
    },
  };
  return { liveCanvasService, state };
}

describe("OpenPencil-compatible canvas MCP tools", () => {
  it("lists Phase C prompt-to-canvas orchestration tools", () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    expect(server.getTool("prompt_canvas_plan")).toBeTruthy();
    expect(server.getTool("prompt_canvas_execute")).toBeTruthy();
  });

  it("creates a deterministic prompt_canvas_plan with bounded sections", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const planned = await server.callTool(
      "prompt_canvas_plan",
      {
        exportTargets: ["react", "html", "vue"],
        maxSections: 3,
        prompt:
          "Create a SaaS dashboard canvas with navigation, metrics, and activity details",
        surface: "dashboard",
      },
      userContext,
    );

    expect(planned.structuredContent).toMatchObject({
      success: true,
      summary: expect.stringContaining("Created prompt canvas plan"),
    });
    expect(planned.structuredContent?.planId).toMatch(/^prompt_canvas_/);
    expect(planned.structuredContent?.rootFrame).toMatchObject({
      height: expect.any(Number),
      layout: "vertical",
      name: expect.stringContaining("SaaS Dashboard"),
      width: 1200,
    });
    expect(planned.structuredContent?.sections).toEqual([
      expect.objectContaining({
        dependencies: [],
        region: expect.objectContaining({ width: 1120 }),
        role: "navigation",
        sectionId: "section-1-navigation",
      }),
      expect.objectContaining({
        dependencies: ["section-1-navigation"],
        role: "metrics",
        sectionId: "section-2-metrics",
      }),
      expect.objectContaining({
        dependencies: ["section-2-metrics"],
        role: "activity",
        sectionId: "section-3-activity",
      }),
    ]);
  });

  it("rejects invalid prompt_canvas_plan input with concrete messages", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "prompt_canvas_plan",
        {
          exportTargets: ["swiftui"],
          maxSections: 3,
          prompt: "Design a settings screen",
          surface: "mobile",
        },
        userContext,
      ),
    ).rejects.toThrow("Unsupported Phase C export target: swiftui");
  });

  it("executes a prompt_canvas_plan into durable section containers", async () => {
    const doc = createEmptyDocument();
    const existing: PenDocument["children"] = [
      {
        id: "manual-note",
        type: "text",
        content: "Keep this manual context",
        x: 10,
        y: 20,
        width: 240,
        height: 32,
      },
    ];
    doc.children = existing;
    if (doc.pages?.[0]) doc.pages[0].children = existing;

    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const planned = await server.callTool(
      "prompt_canvas_plan",
      {
        exportTargets: ["react", "html", "vue"],
        maxSections: 2,
        prompt: "Create a mobile onboarding screen with hero and form sections",
        surface: "mobile",
      },
      userContext,
    );
    const planId = planned.structuredContent?.planId as string;

    const executed = await server.callTool(
      "prompt_canvas_execute",
      {
        commitMode: "section",
        concurrency: 2,
        planId,
      },
      userContext,
    );

    expect(executed.structuredContent).toMatchObject({
      success: true,
      summary: expect.stringContaining("Executed prompt canvas plan"),
    });
    const rootNodeId = executed.structuredContent?.rootNodeId as string;
    expect(rootNodeId).toBeTruthy();
    expect(findNode(harness.state.doc, "manual-note")).toBeTruthy();
    expect(findNode(harness.state.doc, rootNodeId)).toMatchObject({
      containerRole: ["task", "visual"],
      type: "frame",
    });
    const root = findNode(harness.state.doc, rootNodeId) as
      | (PenDocument["children"][number] & {
          children?: PenDocument["children"];
        })
      | undefined;
    expect(root?.children?.length).toBeGreaterThanOrEqual(2);
    expect(executed.structuredContent?.sectionResults).toEqual([
      expect.objectContaining({
        sectionId: "section-1-hero",
        status: "completed",
      }),
      expect.objectContaining({
        sectionId: "section-2-form",
        status: "completed",
      }),
    ]);
    expect(executed.structuredContent?.exportableNodeIds).toEqual([rootNodeId]);
  });

  it("applies batch_design DSL operations to the live Cucumber canvas", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const result = await server.callTool(
      "batch_design",
      {
        operations: [
          'panel=I(null,{type:"frame",name:"OpenPencil Panel",x:120,y:160,width:360,height:220,children:[]})',
          'title=I(panel,{type:"text",name:"Title",content:"Copied editing capability",x:144,y:190,width:280,height:48,fontSize:24})',
          'U(title,{content:"Agent-editable OpenPencil panel"})',
        ].join("\n"),
      },
      userContext,
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      success: true,
      nodeCount: 2,
    });
    const results = result.structuredContent?.results as Array<{
      binding: string;
      nodeId: string;
    }>;
    const panelId = results.find((entry) => entry.binding === "panel")?.nodeId;
    const titleId = results.find((entry) => entry.binding === "title")?.nodeId;

    expect(panelId).toBeTruthy();
    expect(titleId).toBeTruthy();
    if (!panelId || !titleId) throw new Error("Expected created node ids.");
    expect(findNode(harness.state.doc, panelId)).toMatchObject({
      name: "OpenPencil Panel",
      type: "frame",
    });
    expect(findNode(harness.state.doc, titleId)).toMatchObject({
      content: "Agent-editable OpenPencil panel",
      type: "text",
    });
  });

  it("reads nodes with batch_get by pattern and bounded depth", async () => {
    const doc = createEmptyDocument();
    const children: PenDocument["children"] = [
      {
        id: "frame-1",
        type: "frame",
        name: "Searchable Frame",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        children: [
          {
            id: "text-1",
            type: "text",
            content: "Nested",
            x: 12,
            y: 16,
            width: 80,
            height: 24,
          },
        ],
      },
    ];
    doc.children = children;
    if (doc.pages?.[0]) doc.pages[0].children = children;
    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const result = await server.callTool(
      "batch_get",
      {
        patterns: [{ type: "frame", name: "Searchable" }],
        readDepth: 1,
      },
      userContext,
    );

    const nodes = result.structuredContent?.nodes as Array<{
      children?: unknown[];
      id: string;
    }>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("frame-1");
    expect(nodes[0]?.children).toEqual([
      expect.objectContaining({ id: "text-1" }),
    ]);
  });

  it("supports OpenPencil style ops and variables against live documents", async () => {
    const doc = createEmptyDocument();
    const children: PenDocument["children"] = [
      {
        id: "frame-style",
        type: "frame",
        name: "Style Frame",
        x: 0,
        y: 0,
        width: 240,
        height: 120,
        fill: [{ type: "solid", color: "#ffffff" }],
        children: [
          {
            id: "text-style",
            type: "text",
            content: "Hello",
            x: 16,
            y: 20,
            width: 160,
            height: 32,
            fontSize: 20,
            fill: [{ type: "solid", color: "#111827" }],
          },
        ],
      },
    ];
    doc.children = children;
    if (doc.pages?.[0]) doc.pages[0].children = children;
    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const variables = await server.callTool(
      "set_variables",
      {
        variables: {
          brandText: { type: "color", value: "#123456" },
        },
      },
      userContext,
    );
    expect(variables.structuredContent).toMatchObject({ success: true });

    const unique = await server.callTool(
      "search_all_unique_properties",
      {
        parents: ["frame-style"],
        properties: ["textColor", "fontSize"],
      },
      userContext,
    );
    expect(unique.structuredContent?.properties).toMatchObject({
      textColor: ["#111827"],
      fontSize: [20],
    });

    const replaced = await server.callTool(
      "replace_all_matching_properties",
      {
        parents: ["frame-style"],
        properties: {
          textColor: [{ from: "#111827", to: "$brandText" }],
        },
      },
      userContext,
    );
    expect(replaced.structuredContent).toMatchObject({
      replacedCount: 1,
      success: true,
    });
    expect(findNode(harness.state.doc, "text-style")).toMatchObject({
      fill: [{ type: "solid", color: "$brandText" }],
    });
  });

  it("stores and assembles OpenPencil codegen chunks", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const planned = await server.callTool(
      "codegen_plan",
      {
        plan: {
          chunks: [
            { chunkId: "root", nodeIds: ["node-1"] },
            { chunkId: "child", nodeIds: ["node-2"], dependsOn: ["root"] },
          ],
        },
      },
      userContext,
    );
    const planId = planned.structuredContent?.planId as string;
    expect(planId).toBeTruthy();
    expect(planned.structuredContent?.executionPlan).toEqual([
      expect.objectContaining({ chunkId: "root" }),
      expect.objectContaining({ chunkId: "child" }),
    ]);

    const submit = await server.callTool(
      "codegen_submit_chunk",
      {
        planId,
        result: { chunkId: "root", code: "export const Root = () => null;" },
      },
      userContext,
    );
    expect(submit.structuredContent?.nextChunk).toMatchObject({
      chunkId: "child",
    });

    await server.callTool(
      "codegen_submit_chunk",
      {
        planId,
        result: { chunkId: "child", code: "export const Child = () => null;" },
      },
      userContext,
    );

    const assembled = await server.callTool(
      "codegen_assemble",
      { planId, framework: "react" },
      userContext,
    );
    expect(assembled.structuredContent).toMatchObject({
      degraded: false,
      framework: "react",
      success: true,
    });
    expect(assembled.structuredContent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "App.tsx" }),
        expect.objectContaining({ path: "components/Root.tsx" }),
        expect.objectContaining({ path: "components/Child.tsx" }),
        expect.objectContaining({ path: "styles.css" }),
      ]),
    );
  });

  it("exports the current canvas selection directly to React and HTML", async () => {
    const doc = createEmptyDocument() as PenDocument & { selection: string[] };
    const children: PenDocument["children"] = [
      {
        id: "export-card",
        type: "frame",
        name: "Export Card",
        x: 40,
        y: 80,
        width: 320,
        height: 180,
        fill: [{ type: "solid", color: "#f8fafc" }],
        cornerRadius: 12,
        children: [
          {
            id: "export-title",
            type: "text",
            content: "Selected design",
            x: 64,
            y: 104,
            width: 220,
            height: 32,
            fontSize: 24,
            fontWeight: 700,
            fill: [{ type: "solid", color: "#0f172a" }],
          },
        ],
      },
    ];
    doc.children = children;
    doc.selection = ["export-card"];
    if (doc.pages?.[0]) doc.pages[0].children = children;
    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const reactExport = await server.callTool(
      "codegen_export",
      {
        componentName: "selected card",
        framework: "react",
      },
      userContext,
    );
    expect(reactExport.structuredContent).toMatchObject({
      framework: "react",
      nodeIds: ["export-card"],
      success: true,
    });
    expect(reactExport.structuredContent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('style={{ position: "absolute"'),
          path: "SelectedCard.tsx",
        }),
        expect.objectContaining({ path: "SelectedCard.css" }),
      ]),
    );

    const htmlExport = await server.callTool(
      "codegen_export",
      {
        componentName: "selected-card",
        framework: "html",
        nodeIds: ["export-card"],
      },
      userContext,
    );
    expect(htmlExport.structuredContent).toMatchObject({
      framework: "html",
      nodeIds: ["export-card"],
      success: true,
    });
    expect(htmlExport.structuredContent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("Selected design"),
          path: "index.html",
        }),
        expect.objectContaining({ path: "styles.css" }),
      ]),
    );

    const vueExport = await server.callTool(
      "codegen_export",
      {
        componentName: "selected-card",
        framework: "vue",
        nodeIds: ["export-card"],
      },
      userContext,
    );
    expect(vueExport.structuredContent).toMatchObject({
      framework: "vue",
      nodeIds: ["export-card"],
      success: true,
    });
    expect(vueExport.structuredContent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("<template>"),
          path: "SelectedCard.vue",
        }),
        expect.objectContaining({
          content: expect.stringContaining(".SelectedCardRoot"),
          path: "SelectedCard.css",
        }),
      ]),
    );
  });
});
