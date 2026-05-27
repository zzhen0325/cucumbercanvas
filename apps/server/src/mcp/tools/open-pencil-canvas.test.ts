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

function createTwoPageDocument(): PenDocument {
  return {
    ...createEmptyDocument(),
    activePageId: "page-a",
    children: [],
    pages: [
      {
        id: "page-a",
        name: "Page A",
        children: [
          {
            id: "a-card",
            type: "frame",
            name: "Active page card",
            x: 0,
            y: 0,
            width: 120,
            height: 80,
            children: [],
          },
        ],
      },
      {
        id: "page-b",
        name: "Page B",
        children: [
          {
            id: "b-parent",
            type: "frame",
            name: "Requested page parent",
            x: 200,
            y: 40,
            width: 100,
            height: 80,
            children: [
              {
                id: "b-child",
                type: "text",
                content: "Page B child",
                x: 208,
                y: 52,
                width: 80,
                height: 24,
              },
            ],
          },
          {
            id: "b-distant",
            type: "frame",
            name: "Distant B node",
            x: 1000,
            y: 400,
            width: 50,
            height: 50,
            children: [],
          },
        ],
      },
    ],
  };
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
    expect(server.getTool("design_skeleton")).toBeTruthy();
    expect(server.getTool("design_content")).toBeTruthy();
    expect(server.getTool("design_refine")).toBeTruthy();
    expect(server.getTool("add_page")).toBeTruthy();
    expect(server.getTool("remove_page")).toBeTruthy();
    expect(server.getTool("rename_page")).toBeTruthy();
    expect(server.getTool("reorder_page")).toBeTruthy();
    expect(server.getTool("duplicate_page")).toBeTruthy();
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
      agentBinding: expect.objectContaining({
        agentType: "composer",
        status: "completed",
        toolName: "prompt_canvas_execute",
      }),
      containerRole: ["task", "visual"],
      createdByAgentId: "phase-c-orchestrator",
      explain: expect.stringContaining(
        "Create a mobile onboarding screen with hero and form sections",
      ),
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
    const sectionResults = executed.structuredContent?.sectionResults as Array<{
      sectionId: string;
      status: string;
    }>;
    for (const result of sectionResults) {
      const section = root?.children?.find((node) =>
        node.id.endsWith(result.sectionId),
      );
      expect(section).toMatchObject({
        agentBinding: expect.objectContaining({
          agentType: "designer",
          status: "completed",
          toolName: "prompt_canvas_execute",
        }),
        containerRole: ["visual"],
        createdByAgentId: "phase-c-orchestrator",
        explain: expect.stringContaining(result.sectionId),
        type: "frame",
      });
    }
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

  it("rejects failed batch_design operations without persisting partial edits", async () => {
    const initialDoc = createEmptyDocument();
    const harness = createLiveCanvasHarness(initialDoc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "batch_design",
        {
          operations: [
            'panel=I(null,{type:"frame",name:"Should Roll Back",x:0,y:0,width:120,height:80,children:[]})',
            "Z(panel,{})",
          ].join("\n"),
        },
        userContext,
      ),
    ).rejects.toThrow("Unsupported batch_design operation");

    expect(harness.state.doc).toBe(initialDoc);
    expect(findNode(harness.state.doc, "panel")).toBeUndefined();
    expect(harness.state.doc.pages?.[0]?.children).toEqual([]);
  });

  it("rejects invalid batch_design parent and delete targets without pretending success", async () => {
    const initialDoc = createEmptyDocument();
    const harness = createLiveCanvasHarness(initialDoc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "batch_design",
        {
          operations:
            'panel=I("missing-parent",{type:"frame",name:"Never Persisted",width:120,height:80,children:[]})',
        },
        userContext,
      ),
    ).rejects.toThrow(
      "Parent missing-parent was not found on page page-default.",
    );

    await expect(
      server.callTool(
        "batch_design",
        {
          operations: 'D("missing-node")',
        },
        userContext,
      ),
    ).rejects.toThrow("Delete target not found: missing-node");

    expect(harness.state.doc).toBe(initialDoc);
    expect(harness.state.doc.pages?.[0]?.children).toEqual([]);
  });

  it("rejects batch_design moves into the moved node subtree", async () => {
    const initialDoc = createEmptyDocument();
    const children: PenDocument["children"] = [
      {
        children: [
          {
            children: [],
            height: 80,
            id: "child-frame",
            type: "frame",
            width: 120,
            x: 20,
            y: 20,
          },
        ],
        height: 180,
        id: "parent-frame",
        type: "frame",
        width: 240,
        x: 0,
        y: 0,
      },
    ];
    initialDoc.children = children;
    if (initialDoc.pages?.[0]) initialDoc.pages[0].children = children;
    const harness = createLiveCanvasHarness(initialDoc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "batch_design",
        {
          operations: 'M("parent-frame","child-frame")',
        },
        userContext,
      ),
    ).rejects.toThrow(
      "Move target parent-frame cannot be moved into its own descendant child-frame.",
    );

    expect(harness.state.doc).toBe(initialDoc);
    expect(findNode(harness.state.doc, "parent-frame")).toBeTruthy();
    expect(findNode(harness.state.doc, "child-frame")).toBeTruthy();
  });

  it("rejects filePath on live-editor-only batch MCP tools", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "batch_design",
        {
          filePath: "/tmp/design.op",
          operations: 'panel=I(null,{type:"frame",children:[]})',
        },
        userContext,
      ),
    ).rejects.toThrow(
      "batch_design in Cucumber MCP works against the open live editor; filePath is not supported.",
    );

    await expect(
      server.callTool("batch_get", { filePath: "/tmp/design.op" }, userContext),
    ).rejects.toThrow(
      "batch_get in Cucumber MCP works against the open live editor; filePath is not supported.",
    );
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

  it("keeps page-scoped MCP reads and placement anchored to the requested page", async () => {
    const harness = createLiveCanvasHarness(createTwoPageDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const byId = await server.callTool(
      "batch_get",
      {
        nodeIds: ["b-parent"],
        pageId: "page-b",
        readDepth: 0,
      },
      userContext,
    );
    expect(byId.structuredContent?.nodes).toEqual([
      expect.objectContaining({ id: "b-parent" }),
    ]);

    const byParent = await server.callTool(
      "batch_get",
      {
        parentId: "b-parent",
        pageId: "page-b",
        readDepth: 0,
      },
      userContext,
    );
    expect(byParent.structuredContent?.nodes).toEqual([
      expect.objectContaining({ id: "b-child" }),
    ]);

    const snapshot = await server.callTool(
      "snapshot_layout",
      {
        maxDepth: 0,
        pageId: "page-b",
        parentId: "b-parent",
      },
      userContext,
    );
    expect(snapshot.structuredContent?.nodes).toEqual([
      expect.objectContaining({ id: "b-child" }),
    ]);

    const placement = await server.callTool(
      "find_empty_space",
      {
        direction: "right",
        height: 40,
        nodeId: "b-parent",
        padding: 10,
        pageId: "page-b",
        width: 60,
      },
      userContext,
    );
    expect(placement.structuredContent?.region).toMatchObject({
      x: 310,
      y: 40,
      width: 60,
      height: 40,
    });
  });

  it("rejects missing pages and page-scoped missing anchors with concrete errors", async () => {
    const harness = createLiveCanvasHarness(createTwoPageDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool("batch_get", { pageId: "missing-page" }, userContext),
    ).rejects.toThrow("Page missing-page does not exist.");

    await expect(
      server.callTool(
        "batch_get",
        { nodeIds: ["a-card"], pageId: "page-b" },
        userContext,
      ),
    ).rejects.toThrow("Node a-card was not found on page page-b.");

    await expect(
      server.callTool(
        "batch_get",
        { pageId: "page-b", parentId: "a-card" },
        userContext,
      ),
    ).rejects.toThrow("Parent a-card was not found on page page-b.");

    await expect(
      server.callTool(
        "snapshot_layout",
        { pageId: "page-b", parentId: "a-card" },
        userContext,
      ),
    ).rejects.toThrow("Parent a-card was not found on page page-b.");

    await expect(
      server.callTool(
        "find_empty_space",
        {
          direction: "right",
          height: 40,
          nodeId: "a-card",
          padding: 10,
          pageId: "page-b",
          width: 60,
        },
        userContext,
      ),
    ).rejects.toThrow("Node a-card was not found on page page-b.");
  });

  it("manages live canvas pages with OpenPencil-compatible page tools", async () => {
    const harness = createLiveCanvasHarness(createTwoPageDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const added = await server.callTool(
      "add_page",
      { name: "Generated Page" },
      userContext,
    );
    expect(added.structuredContent).toMatchObject({
      success: true,
      pageCount: 3,
      page: expect.objectContaining({ name: "Generated Page" }),
    });
    const addedPageId = added.structuredContent?.pageId as string;

    await server.callTool(
      "rename_page",
      { name: "Renamed Page", pageId: addedPageId },
      userContext,
    );
    expect(
      harness.state.doc.pages?.find((page) => page.id === addedPageId)?.name,
    ).toBe("Renamed Page");

    const duplicated = await server.callTool(
      "duplicate_page",
      { name: "Duplicated B", pageId: "page-b" },
      userContext,
    );
    expect(duplicated.structuredContent).toMatchObject({
      success: true,
      pageCount: 4,
      page: expect.objectContaining({ name: "Duplicated B" }),
    });
    const duplicatedPageId = duplicated.structuredContent?.pageId as string;
    expect(
      harness.state.doc.pages?.find((page) => page.id === duplicatedPageId)
        ?.children[0]?.id,
    ).not.toBe("b-parent");

    await server.callTool(
      "reorder_page",
      { index: 0, pageId: duplicatedPageId },
      userContext,
    );
    expect(harness.state.doc.pages?.[0]?.id).toBe(duplicatedPageId);

    const removed = await server.callTool(
      "remove_page",
      { pageId: duplicatedPageId },
      userContext,
    );
    expect(removed.structuredContent).toMatchObject({
      success: true,
      pageCount: 3,
    });
    expect(
      harness.state.doc.pages?.some((page) => page.id === duplicatedPageId),
    ).toBe(false);
  });

  it("supports OpenPencil layered design tools on the live requested page", async () => {
    const harness = createLiveCanvasHarness(createTwoPageDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const skeleton = await server.callTool(
      "design_skeleton",
      {
        pageId: "page-b",
        rootFrame: {
          height: 720,
          layout: "vertical",
          name: "Landing Page",
          width: 1200,
        },
        sections: [
          { height: 320, name: "Hero", role: "hero" },
          { height: 240, name: "Proof", role: "features" },
        ],
      },
      userContext,
    );
    expect(skeleton.structuredContent).toMatchObject({
      success: true,
      rootId: expect.any(String),
      sections: [
        expect.objectContaining({ name: "Hero" }),
        expect.objectContaining({ name: "Proof" }),
      ],
    });
    const rootId = skeleton.structuredContent?.rootId as string;
    const sections = skeleton.structuredContent?.sections as Array<{
      id: string;
    }>;

    const content = await server.callTool(
      "design_content",
      {
        children: [
          {
            type: "text",
            content: "Cucumber Studio",
            width: 420,
            height: 48,
          },
        ],
        pageId: "page-b",
        sectionId: sections[0]?.id,
      },
      userContext,
    );
    expect(content.structuredContent).toMatchObject({
      success: true,
      insertedCount: 1,
      sectionId: sections[0]?.id,
    });

    const refine = await server.callTool(
      "design_refine",
      { pageId: "page-b", rootId },
      userContext,
    );
    expect(refine.structuredContent).toMatchObject({
      success: true,
      rootId,
      totalNodeCount: 4,
    });
    expect(findNode(harness.state.doc, rootId, "page-b")).toBeTruthy();
    expect(findNode(harness.state.doc, rootId, "page-a")).toBeUndefined();
  });

  it("replaces new-page placeholders and normalizes design_content ids", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const added = await server.callTool(
      "add_page",
      { name: "Layered Page" },
      userContext,
    );
    const pageId = added.structuredContent?.pageId as string;
    expect(
      harness.state.doc.pages?.find((page) => page.id === pageId)?.children,
    ).toHaveLength(1);

    const skeleton = await server.callTool(
      "design_skeleton",
      {
        pageId,
        rootFrame: {
          height: 600,
          layout: "vertical",
          name: "Generated Landing",
          width: 1000,
        },
        sections: [{ name: "Hero", role: "hero" }],
      },
      userContext,
    );
    const rootId = skeleton.structuredContent?.rootId as string;
    const sections = skeleton.structuredContent?.sections as Array<{
      id: string;
    }>;
    const pageChildren =
      harness.state.doc.pages?.find((page) => page.id === pageId)?.children ??
      [];
    expect(pageChildren).toHaveLength(1);
    expect(pageChildren[0]).toMatchObject({
      id: rootId,
      name: "Generated Landing",
    });

    const content = await server.callTool(
      "design_content",
      {
        children: [
          {
            id: rootId,
            type: "text",
            content: "Conflicting supplied id",
          },
        ],
        pageId,
        sectionId: sections[0]?.id,
      },
      userContext,
    );
    expect(content.structuredContent).toMatchObject({
      postProcessed: true,
      warnings: [
        expect.stringContaining(`Replaced conflicting node id "${rootId}"`),
      ],
    });
    const inserted = content.structuredContent?.snapshot as {
      children?: Array<{ content?: string; id?: string }>;
    };
    expect(inserted.children?.[0]).toMatchObject({
      content: "Conflicting supplied id",
    });
    expect(inserted.children?.[0]?.id).not.toBe(rootId);
  });

  it("preserves intentional empty frames when creating a layered skeleton", async () => {
    const doc = createEmptyDocument();
    const children: PenDocument["children"] = [
      {
        id: "intentional-empty",
        type: "frame",
        name: "Intentional Empty Slot",
        x: 24,
        y: 36,
        width: 480,
        height: 320,
        fill: [{ type: "solid", color: "#f1f5f9" }],
        children: [],
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

    const skeleton = await server.callTool(
      "design_skeleton",
      {
        rootFrame: {
          height: 600,
          layout: "vertical",
          name: "Second Root",
          width: 1000,
        },
        sections: [{ name: "Hero", role: "hero" }],
      },
      userContext,
    );
    const rootId = skeleton.structuredContent?.rootId as string;

    expect(harness.state.doc.pages?.[0]?.children).toEqual([
      expect.objectContaining({ id: "intentional-empty" }),
      expect.objectContaining({ id: rootId, name: "Second Root" }),
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

  it("returns concrete warnings for degraded direct codegen export content", async () => {
    const doc = createEmptyDocument() as PenDocument & { selection: string[] };
    const children = [
      {
        id: "export-warning-card",
        type: "frame",
        name: "Export Warning Card",
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        children: [
          {
            id: "gradient-rect",
            type: "rectangle",
            x: 20,
            y: 20,
            width: 120,
            height: 80,
            fill: [
              {
                type: "linear_gradient",
                stops: [
                  { color: "#0f172a", offset: 0 },
                  { color: "#d3f256", offset: 1 },
                ],
              },
            ],
          },
          {
            id: "image-missing-src",
            type: "image",
            x: 160,
            y: 20,
            width: 120,
            height: 80,
            src: "",
          },
          {
            id: "rich-copy",
            type: "text",
            x: 20,
            y: 120,
            width: 240,
            height: 40,
            content: [{ text: "Layered", fontWeight: 700 }, { text: " copy" }],
          },
          {
            id: "unsupported-widget",
            type: "sticky_note",
            x: 250,
            y: 120,
            width: 80,
            height: 40,
          },
        ],
      },
    ] as PenDocument["children"];
    doc.children = children;
    doc.selection = ["export-warning-card"];
    if (doc.pages?.[0]) doc.pages[0].children = children;
    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const result = await server.callTool(
      "codegen_export",
      {
        componentName: "warning-card",
        framework: "react",
      },
      userContext,
    );

    expect(result.structuredContent?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-gradient-fill",
          nodeId: "gradient-rect",
        }),
        expect.objectContaining({
          code: "missing-image-source",
          nodeId: "image-missing-src",
        }),
        expect.objectContaining({
          code: "unsupported-rich-text",
          nodeId: "rich-copy",
        }),
        expect.objectContaining({
          code: "unsupported-node-type",
          nodeId: "unsupported-widget",
        }),
      ]),
    );
  });
});
