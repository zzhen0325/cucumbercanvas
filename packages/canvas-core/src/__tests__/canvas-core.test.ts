import { describe, expect, it } from "vitest";
import type { FigmaTreeNode } from "../figma-native-types.js";

import {
  applyImportedAutoLayout,
  applyInstanceOverrides,
  type CanvasNode,
  type ContainerNode,
  applyCanvasOperation,
  buildAgentContext,
  extractFigmaClipboardData,
  getFigmaAutoLayoutMeta,
  mergeSymbolProps,
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
        autoLayout: {
          layout: "horizontal",
        },
      });
    },
  );

  it("extracts figma clipboard meta and buffer from comment blocks", () => {
    const metaBase64 = Buffer.from(JSON.stringify({ source: "figma", nodeCount: 2 })).toString(
      "base64",
    );
    const bufferBase64 = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString("base64");
    const html = `<!--(figmeta)-->${metaBase64}<!--(figmeta)--><!--(figma)-->${bufferBase64}<!--(figma)-->`;

    const extracted = extractFigmaClipboardData(html);

    expect(extracted?.meta).toEqual({ source: "figma", nodeCount: 2 });
    expect(Array.from(new Uint8Array(extracted?.buffer ?? new ArrayBuffer(0)))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  parserCapableIt("falls back to styled html figma parsing when native clipboard decode is invalid", () => {
    const html = `
      <div data-metadata="invalid" data-buffer="invalid" style="position:absolute;left:12px;top:16px;width:120px;height:56px;background-color:#ffffff">
        Native fallback
      </div>
    `;

    const result = parseClipboardImport({ html });

    expect(result?.source).toBe("figma");
    expect(result?.rootNodeIds.length).toBeGreaterThan(0);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "partial_fidelity" }),
      ]),
    );
  });

  it("merges missing symbol props into an instance node", () => {
    const merged = mergeSymbolProps(
      {
        type: "INSTANCE",
        name: "Button Instance",
        guid: { sessionID: 1, localID: 10 },
        fillPaints: undefined,
        strokePaints: undefined,
      },
      {
        type: "SYMBOL",
        name: "Button Master",
        guid: { sessionID: 1, localID: 20 },
        stackMode: "HORIZONTAL",
        stackSpacing: 12,
        fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        strokePaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    );

    expect(merged.stackMode).toBe("HORIZONTAL");
    expect(merged.stackSpacing).toBe(12);
    expect(merged.fillPaints?.[0]?.type).toBe("SOLID");
    expect(merged.strokePaints?.[0]?.type).toBe("SOLID");
  });

  it("maps figma auto-layout metadata for containers and children", () => {
    expect(
      getFigmaAutoLayoutMeta(
        {
          type: "FRAME",
          stackMode: "VERTICAL",
          stackSpacing: 16,
          stackPadding: 20,
          stackPrimaryAlignItems: "CENTER",
          stackCounterAlignItems: "MAX",
          frameMaskDisabled: false,
          size: { x: 320, y: 180 },
        },
        undefined,
      ),
    ).toEqual({
      layout: "vertical",
      gap: 16,
      padding: 20,
      justifyContent: "center",
      alignItems: "end",
      clipContent: true,
      widthMode: "fixed",
      heightMode: "fixed",
    });

    expect(
      getFigmaAutoLayoutMeta(
        {
          type: "TEXT",
          size: { x: 120, y: 40 },
          stackChildPrimaryGrow: 1,
          stackChildAlignSelf: "STRETCH",
          stackPositioning: "AUTO",
        },
        "VERTICAL",
      ),
    ).toEqual({
      widthMode: "fill_container",
      heightMode: "fill_container",
      alignSelf: "stretch",
      positioning: "auto",
      grow: 1,
    });
  });

  it("applies imported auto-layout to container children and nested layout containers", () => {
    let doc = createEmptyCanvasDocument();
    const root = makeContainer("root");
    root.bounds = { x: 10, y: 20, width: 300, height: 200 };
    root.meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "vertical",
        gap: 10,
        padding: [12, 16],
        justifyContent: "center",
      },
    };

    const titleNode: CanvasNode = {
      id: "title",
      type: "text",
      parentId: "root",
      bounds: { x: 0, y: 0, width: 50, height: 20 },
      text: "Title",
      fontSize: 16,
      meta: {
        source: "figma-paste",
        autoLayout: {
          widthMode: "fill_container",
        },
      },
    };
    const nested = makeContainer("nested", "root");
    nested.bounds = { x: 0, y: 0, width: 100, height: 40 };
    nested.meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "horizontal",
        gap: 8,
        padding: 8,
        widthMode: "fill_container",
        alignItems: "center",
      },
    };

    const nestedLabel: CanvasNode = {
      id: "nested-label",
      type: "text",
      parentId: "nested",
      bounds: { x: 0, y: 0, width: 60, height: 20 },
      text: "Nested",
      fontSize: 14,
    };
    const nestedValue: CanvasNode = {
      id: "nested-value",
      type: "text",
      parentId: "nested",
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      text: "Value",
      fontSize: 14,
      meta: {
        source: "figma-paste",
        autoLayout: {
          grow: 1,
          heightMode: "fill_container",
        },
      },
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: titleNode,
      containerId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nested,
      containerId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedLabel,
      containerId: "nested",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedValue,
      containerId: "nested",
    });

    const next = applyImportedAutoLayout(doc, "root");

    expect(next.nodes.title?.bounds).toMatchObject({
      x: 26,
      y: 85,
      width: 268,
      height: 20,
    });
    expect(next.nodes.nested?.bounds).toMatchObject({
      x: 26,
      y: 115,
      width: 268,
      height: 40,
    });
    expect(next.nodes["nested-label"]?.bounds).toMatchObject({
      x: 34,
      y: 125,
      width: 60,
      height: 20,
    });
    expect(next.nodes["nested-value"]?.bounds).toMatchObject({
      x: 102,
      y: 123,
      width: 184,
      height: 24,
    });
  });

  it("keeps imported absolute-positioned children fixed during auto-layout reflow", () => {
    let doc = createEmptyCanvasDocument();
    const root = makeContainer("absolute-root");
    root.bounds = { x: 0, y: 0, width: 200, height: 120 };
    root.meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "horizontal",
        gap: 12,
        padding: 10,
      },
    };

    const flowNode: CanvasNode = {
      id: "flow",
      type: "rect",
      parentId: "absolute-root",
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      fill: "#fff",
    };
    const absoluteNode: CanvasNode = {
      id: "absolute",
      type: "rect",
      parentId: "absolute-root",
      bounds: { x: 77, y: 33, width: 30, height: 30 },
      fill: "#000",
      meta: {
        source: "figma-paste",
        autoLayout: {
          positioning: "absolute",
        },
      },
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: flowNode,
      containerId: "absolute-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: absoluteNode,
      containerId: "absolute-root",
    });

    const next = applyImportedAutoLayout(doc, "absolute-root");

    expect(next.nodes.flow?.bounds).toMatchObject({
      x: 10,
      y: 10,
      width: 40,
      height: 20,
    });
    expect(next.nodes.absolute?.bounds).toMatchObject({
      x: 77,
      y: 33,
      width: 30,
      height: 30,
    });
  });

  it("applies instance overrides and derived data to symbol children", () => {
    const symbolNode: FigmaTreeNode = {
      figma: {
        type: "SYMBOL",
        name: "Card",
        guid: { sessionID: 1, localID: 100 },
        size: { x: 200, y: 80 },
        transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
      },
      children: [
        {
          figma: {
            type: "TEXT",
            name: "Title",
            guid: { sessionID: 1, localID: 101 },
            size: { x: 160, y: 24 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 30 },
            fontSize: 16,
            textData: { characters: "Master Title" },
          },
          children: [],
        },
      ],
    };

    const children = applyInstanceOverrides(
      symbolNode,
      [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 101 }] },
          fontSize: 22,
          textData: { characters: "Instance Title" },
        },
      ],
      [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 101 }] },
          size: { x: 180, y: 28 },
          transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 36 },
        },
      ],
      { x: 240, y: 100 },
    );

    expect(children).toHaveLength(1);
    expect(children[0]?.figma.fontSize).toBe(22);
    expect(children[0]?.figma.textData?.characters).toBe("Instance Title");
    expect(children[0]?.figma.size).toEqual({ x: 180, y: 28 });
    expect(children[0]?.figma.transform).toEqual({
      m00: 1,
      m01: 0,
      m02: 24,
      m10: 0,
      m11: 1,
      m12: 36,
    });
  });

  it("propagates nested instance override paths to child instances", () => {
    const symbolNode: FigmaTreeNode = {
      figma: {
        type: "SYMBOL",
        name: "Outer Card",
        guid: { sessionID: 1, localID: 1000 },
        size: { x: 300, y: 180 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      children: [
        {
          figma: {
            type: "INSTANCE",
            name: "Nested Badge Instance",
            guid: { sessionID: 1, localID: 1001 },
            size: { x: 120, y: 48 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 24 },
            symbolData: {
              symbolID: { sessionID: 1, localID: 2000 },
            },
          },
          children: [],
        },
      ],
    };

    const children = applyInstanceOverrides(
      symbolNode,
      [
        {
          guidPath: {
            guids: [
              { sessionID: 8, localID: 5000 },
              { sessionID: 8, localID: 5001 },
            ],
          },
          textData: { characters: "Nested override title" },
          fontSize: 18,
        },
      ],
      [
        {
          guidPath: {
            guids: [
              { sessionID: 8, localID: 5000 },
              { sessionID: 8, localID: 5001 },
            ],
          },
          size: { x: 96, y: 36 },
          transform: { m00: 1, m01: 0, m02: 26, m10: 0, m11: 1, m12: 32 },
        },
      ],
      { x: 300, y: 180 },
    );

    expect(children).toHaveLength(1);
    const nestedInstance = children[0];
    expect(nestedInstance?.figma.symbolData?.symbolOverrides).toEqual([
      expect.objectContaining({
        guidPath: { guids: [{ sessionID: 8, localID: 5001 }] },
        textData: { characters: "Nested override title" },
        fontSize: 18,
      }),
    ]);
    expect(nestedInstance?.figma.derivedSymbolData).toEqual([
      expect.objectContaining({
        guidPath: { guids: [{ sessionID: 8, localID: 5001 }] },
        size: { x: 96, y: 36 },
      }),
    ]);
  });
});
