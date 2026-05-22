import { describe, expect, it } from "vitest";

import {
  type CanvasNode,
  type ContainerNode,
  applyCanvasOperation,
  buildAgentContext,
  parseClipboardImport,
  createCanvasNodeId,
  createEmptyCanvasDocument,
  duplicateCanvasNodes,
  type CanvasImportResult,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
  resolveContext,
} from "../index.js";

const parserCapableIt =
  typeof DOMParser === "undefined" ? it.skip : it;

function makeContainer(
  id: string,
  parentId: string | null = null,
): ContainerNode {
  return {
    id,
    type: "container",
    parentId,
    title: id,
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    role: ["visual", "task", "context"],
    childrenOrder: [],
    contextSlots: {},
    inheritPolicy: "merge",
    agentBinding: {
      agentId: "agent-1",
      permissions: ["read", "write"],
    },
    permissions: { canRead: [], canWrite: [], isolationLevel: "open" },
  };
}

describe("cucumber canvas core", () => {
  it("serializes an empty Cucumber document baseline", () => {
    const doc = createEmptyCanvasDocument();
    expect(doc.schemaVersion).toBe("cucumber-canvas-v1");
    expect(doc.rootNodeIds).toEqual([]);
    expect(doc.viewport.zoom).toBe(1);
  });

  it("resolves inherited context through container parents", () => {
    let doc = createEmptyCanvasDocument();
    const parent = makeContainer("parent");
    parent.contextSlots = { rules: ["brand purple"], style: { tone: "calm" } };
    const child = makeContainer("child", "parent");
    child.contextSlots = { rules: ["wide spacing"], tokens: { radius: 8 } };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: parent });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      containerId: "parent",
    });

    expect(resolveContext(doc, "child")).toEqual({
      rules: ["brand purple", "wide spacing"],
      style: { tone: "calm" },
      tokens: { radius: 8 },
      constraints: {},
    });
  });

  it("rejects agent writes outside the bound container", () => {
    let doc = createEmptyCanvasDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const node: CanvasNode = {
      id: createCanvasNodeId("rect"),
      type: "rect",
      parentId: null,
      bounds: { x: 1000, y: 1000, width: 100, height: 100 },
      fill: "#fff",
    };

    expect(() =>
      applyCanvasOperation(doc, {
        type: "insertNode",
        node,
        containerId: "container",
        agentId: "agent-1",
      }),
    ).toThrow("cannot write outside container");
  });

  it("rejects moving an existing node outside the bound container", () => {
    let doc = createEmptyCanvasDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });

    const node: CanvasNode = {
      id: createCanvasNodeId("rect"),
      type: "rect",
      parentId: "container",
      bounds: { x: 40, y: 40, width: 120, height: 80 },
      fill: "#fff",
    };
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node,
      containerId: "container",
      agentId: "agent-1",
    });

    expect(() =>
      applyCanvasOperation(doc, {
        type: "updateNode",
        nodeId: node.id,
        containerId: "container",
        agentId: "agent-1",
        updates: {
          bounds: { x: 520, y: 60, width: 120, height: 80 },
        } as Partial<CanvasNode>,
      }),
    ).toThrow("cannot write outside container");
  });

  it("builds agent context for a bound container", () => {
    let doc = createEmptyCanvasDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const ctx = buildAgentContext({
      doc,
      agentId: "agent-1",
      containerId: "container",
    });
    expect(ctx.containerPath).toEqual(["container"]);
    expect(ctx.permissions).toEqual(["read", "write"]);
  });

  it("duplicates a container with its child nodes", () => {
    let doc = createEmptyCanvasDocument();
    const container = makeContainer("container");
    const child: CanvasNode = {
      id: "child",
      type: "rect",
      parentId: "container",
      bounds: { x: 40, y: 40, width: 120, height: 80 },
      fill: "#fff",
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      containerId: "container",
    });

    const result = duplicateCanvasNodes(doc, ["container"], 16);
    const cloneId = result.pastedIds[0];
    expect(cloneId).toBeDefined();
    const clone = cloneId ? result.doc.nodes[cloneId] : undefined;

    expect(clone?.type).toBe("container");
    const cloneChildren =
      clone && "childrenOrder" in clone ? clone.childrenOrder : [];
    expect(cloneChildren).toHaveLength(1);
    const childCloneId = cloneChildren[0];
    expect(childCloneId).toBeDefined();
    expect(childCloneId ? result.doc.nodes[childCloneId]?.parentId : null).toBe(
      cloneId,
    );
  });

  it("reorders nodes within root stacking order", () => {
    let doc = createEmptyCanvasDocument();
    const a: CanvasNode = {
      id: "a",
      type: "rect",
      parentId: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    };
    const b: CanvasNode = {
      id: "b",
      type: "rect",
      parentId: null,
      bounds: { x: 20, y: 0, width: 10, height: 10 },
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
    doc = applyCanvasOperation(doc, {
      type: "reorderNode",
      nodeId: "a",
      direction: "front",
    });

    expect(doc.rootNodeIds).toEqual(["b", "a"]);
  });

  it("hit-tests visible nodes inside marquee bounds", () => {
    let doc = createEmptyCanvasDocument();
    const visible: CanvasNode = {
      id: "visible",
      type: "rect",
      parentId: null,
      bounds: { x: 10, y: 10, width: 80, height: 80 },
    };
    const hidden: CanvasNode = {
      id: "hidden",
      type: "rect",
      parentId: null,
      bounds: { x: 20, y: 20, width: 80, height: 80 },
      visible: false,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: visible });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: hidden });

    expect(
      getVisibleCanvasNodesInBounds(doc, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }).map((node) => node.id),
    ).toEqual(["visible"]);
  });

  it("groups and ungroups sibling nodes without changing their bounds", () => {
    let doc = createEmptyCanvasDocument();
    const a: CanvasNode = {
      id: "a",
      type: "rect",
      parentId: null,
      bounds: { x: 20, y: 30, width: 80, height: 60 },
    };
    const b: CanvasNode = {
      id: "b",
      type: "ellipse",
      parentId: null,
      bounds: { x: 140, y: 100, width: 100, height: 90 },
      fill: "#fff",
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "groupNodes",
      groupId: "group-1",
      nodeIds: ["a", "b"],
    });

    expect(doc.rootNodeIds).toEqual(["group-1"]);
    expect(doc.nodes["group-1"]?.bounds).toEqual({
      x: 20,
      y: 30,
      width: 220,
      height: 160,
    });
    expect(doc.nodes.a?.parentId).toBe("group-1");

    doc = applyCanvasOperation(doc, {
      type: "ungroupNode",
      groupId: "group-1",
    });

    expect(doc.rootNodeIds).toEqual(["a", "b"]);
    expect(doc.nodes.a?.bounds).toEqual(a.bounds);
    expect(doc.nodes.b?.parentId).toBeNull();
  });

  it("aligns unlocked nodes to the selection bounds", () => {
    let doc = createEmptyCanvasDocument();
    const a: CanvasNode = {
      id: "a",
      type: "rect",
      parentId: null,
      bounds: { x: 20, y: 30, width: 80, height: 60 },
    };
    const b: CanvasNode = {
      id: "b",
      type: "rect",
      parentId: null,
      bounds: { x: 140, y: 100, width: 100, height: 90 },
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "alignNodes",
      nodeIds: ["a", "b"],
      alignment: "right",
    });

    expect(doc.nodes.a?.bounds.x).toBe(160);
    expect(doc.nodes.b?.bounds.x).toBe(140);
  });

  it("moves a node to a specific sibling index", () => {
    let doc = createEmptyCanvasDocument();
    const a: CanvasNode = {
      id: "a",
      type: "rect",
      parentId: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    };
    const b: CanvasNode = {
      id: "b",
      type: "rect",
      parentId: null,
      bounds: { x: 20, y: 0, width: 10, height: 10 },
    };
    const c: CanvasNode = {
      id: "c",
      type: "rect",
      parentId: null,
      bounds: { x: 40, y: 0, width: 10, height: 10 },
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: c });

    doc = applyCanvasOperation(doc, {
      type: "reorderNode",
      nodeId: "c",
      targetParentId: null,
      targetIndex: 1,
    });

    expect(doc.rootNodeIds).toEqual(["a", "c", "b"]);
  });

  it("inserts imported nodes into the target parent and selects the roots", () => {
    let doc = createEmptyCanvasDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const result: CanvasImportResult = {
      source: "svg",
      sourceLabel: "SVG",
      importSessionId: "import-test",
      rootNodeIds: ["group-1"],
      nodes: [
        {
          id: "group-1",
          type: "group",
          parentId: null,
          title: "Imported",
          bounds: { x: 10, y: 20, width: 200, height: 120 },
          childrenOrder: ["child-1"],
          meta: { source: "svg-import" },
        },
        {
          id: "child-1",
          type: "rect",
          parentId: "group-1",
          title: "Child",
          bounds: { x: 20, y: 30, width: 100, height: 80 },
          fill: "#fff",
          meta: { source: "svg-import" },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(doc, result, {
      parentId: "container",
      offsetX: 40,
      offsetY: 10,
    });

    expect(inserted.doc.nodes["group-1"]?.parentId).toBe("container");
    expect(inserted.doc.nodes["child-1"]?.parentId).toBe("group-1");
    expect(inserted.doc.nodes["group-1"]?.bounds).toEqual({
      x: 50,
      y: 30,
      width: 200,
      height: 120,
    });
    expect(inserted.doc.selection).toEqual(["group-1"]);
    expect(inserted.doc.nodes.container).toMatchObject({
      childrenOrder: ["group-1"],
    });
    expect(inserted.doc.nodes["group-1"]?.meta).toMatchObject({
      source: "svg-import",
      importSessionId: result.importSessionId,
      importSourceLabel: "SVG",
      warningCount: 0,
    });
  });

  it("assigns a shared import session and warning metadata to inserted roots", () => {
    const result: CanvasImportResult = {
      source: "svg",
      sourceLabel: "SVG",
      importSessionId: "import-shared-session",
      rootNodeIds: ["rect-1"],
      nodes: [
        {
          id: "rect-1",
          type: "rect",
          parentId: null,
          title: "Imported rect",
          bounds: { x: 10, y: 20, width: 80, height: 60 },
          fill: "#fff",
          meta: { source: "svg-import" },
        },
      ],
      assets: [],
      warnings: [
        {
          code: "unsupported_tag",
          message: "暂未支持导入 SVG 节点 <foreignObject>，已跳过。",
        },
      ],
    };

    const inserted = insertCanvasImportResult(createEmptyCanvasDocument(), result);
    const root = inserted.doc.nodes[result.rootNodeIds[0] ?? ""];
    expect(root?.meta).toMatchObject({
      source: "svg-import",
      importSessionId: result.importSessionId,
      importSourceLabel: "SVG",
      warningCount: 1,
      degradationHints: ["unsupported_tag"],
    });
  });

  parserCapableIt(
    "parses figma html fallback with grouped structure and degradation warnings",
    () => {
      const result = parseClipboardImport({
        html: `
          <div data-buffer="1" data-node-id="42:1" style="position:absolute;left:10px;top:12px;width:120px;height:64px;background-color:#ffffff;display:flex;box-shadow:0 2px 12px rgba(0,0,0,.15)">
            <span style="font-size:18px;color:#111827">Title</span>
          </div>
        `,
      });

      expect(result).not.toBeNull();
      expect(result?.source).toBe("figma");
      expect(result?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "layout_degraded" }),
          expect.objectContaining({ code: "effects_dropped" }),
          expect.objectContaining({ code: "partial_fidelity" }),
        ]),
      );
      const rootId = result?.rootNodeIds[0];
      const root = rootId
        ? result?.nodes.find((node) => node.id === rootId)
        : null;
      expect(root?.type).toBe("group");
      expect(root?.meta).toMatchObject({
        source: "figma-paste",
        importSourceLabel: "Figma",
        originNodeType: "div",
      });
    },
  );
});
