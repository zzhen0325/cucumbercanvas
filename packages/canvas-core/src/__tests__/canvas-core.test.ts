import { describe, expect, it } from "vitest";
import type { FigmaTreeNode } from "../figma-native-types.js";
import type { ContainerRole, PenFill } from "../types.js";

import {
  type CanvasImportResult,
  type PenNode,
  applyCanvasOperation,
  applyCanvasTransaction,
  applyImportedAutoLayout,
  applyInstanceOverrides,
  buildAgentContext,
  createCanvasDocument,
  createEmptyDocument,
  createNodeId,
  detachNodesOutsideParentBounds,
  duplicateCanvasNodes,
  extractFigmaClipboardData,
  findNode,
  findParent,
  getActiveChildren,
  getFigmaAutoLayoutMeta,
  getLineEndpoints,
  getLineSceneEndpoints,
  getNodeBounds,
  getNodeSceneBounds,
  getNodeSceneOrigin,
  getOrderedCanvasNodes,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
  mapFigmaNativeArcData,
  mapFigmaNativeComponentRef,
  mapFigmaNativeEffects,
  mapFigmaNativePaints,
  mapFigmaNativeStroke,
  mapFigmaNativeVectorFillRule,
  mergeSymbolProps,
  parseClipboardImport,
  reparentNodesByDropPoint,
  resolveContext,
} from "../index.js";

const parserCapableIt = typeof DOMParser === "undefined" ? it.skip : it;

type TestPenNode = PenNode & {
  height?: number;
  meta?: Record<string, unknown>;
  viewport?: { zoom?: number };
  width?: number;
  x?: number;
  y?: number;
};

function asTestNode(node: unknown, label = "node"): TestPenNode {
  if (node == null || typeof node !== "object") {
    throw new Error(`Expected ${label} to exist`);
  }
  return node as TestPenNode;
}

function readRequired<T>(items: ArrayLike<T>, index: number, label: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`Expected ${label} at index ${index}`);
  }
  return value;
}

function importedNodeTitle(
  node: CanvasImportResult["nodes"][number],
): string | undefined {
  const titled = node as { title?: string; name?: string };
  return titled.title ?? titled.name;
}

function makeContainer(id: string, _parentId: string | null = null): PenNode {
  return {
    id,
    type: "frame" as const,
    name: id,
    x: 0,
    y: 0,
    width: 500,
    height: 400,
    containerRole: ["visual", "task", "context"] as ContainerRole[],
    children: [] as PenNode[],
    contextSlots: {},
    inheritPolicy: "merge" as const,
    agentBinding: {
      agentId: "agent-1",
      permissions: ["read", "write"] as ("read" | "write" | "spawn")[],
    },
    permissions: { canRead: [], canWrite: [], isolationLevel: "open" as const },
  };
}

describe("cucumber canvas core", () => {
  it("serializes an empty Cucumber document baseline", () => {
    const doc = createEmptyDocument();
    expect(doc.version).toBe("cucumber-canvas-v1");
    expect(doc.activePageId).toBe("page-default");
    expect(doc.pages?.[0]?.id).toBe("page-default");
    expect(doc.children).toEqual([]);
    expect(asTestNode(doc, "document").viewport?.zoom).toBe(1);
  });

  it("creates page-aware canvas documents with the default active page", () => {
    const doc = createCanvasDocument("New canvas");

    expect(doc.name).toBe("New canvas");
    expect(doc.activePageId).toBe("page-default");
    expect(doc.pages).toEqual([
      { id: "page-default", name: "Page 1", children: [] },
    ]);
    expect(doc.children).toEqual([]);
  });

  it("resolves inherited context through container parents", () => {
    let doc = createEmptyDocument();
    const parent = makeContainer("parent");
    parent.contextSlots = { rules: ["brand purple"], style: { tone: "calm" } };
    const child = makeContainer("child", "parent");
    child.contextSlots = { rules: ["wide spacing"], tokens: { radius: 8 } };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: parent });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      parentId: "parent",
    });

    expect(resolveContext(doc, "child")).toEqual({
      rules: ["brand purple", "wide spacing"],
      style: { tone: "calm" },
      tokens: { radius: 8 },
      constraints: {},
    });
  });

  it("rejects agent writes outside the bound container", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const node: PenNode = {
      id: createNodeId("rect"),
      type: "rectangle",
      x: 1000,
      y: 1000,
      width: 100,
      height: 100,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    expect(() =>
      applyCanvasOperation(doc, {
        type: "insertNode",
        node,
        parentId: "container",
        agentId: "agent-1",
      }),
    ).toThrow("cannot write outside container");
  });

  it("rejects moving an existing node outside the bound container", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });

    const node: PenNode = {
      id: createNodeId("rect"),
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node,
      parentId: "container",
      agentId: "agent-1",
    });

    expect(() =>
      applyCanvasOperation(doc, {
        type: "updateNode",
        nodeId: node.id,
        parentId: "container",
        agentId: "agent-1",
        updates: {
          x: 520,
          y: 60,
          width: 120,
          height: 80,
        } as Partial<PenNode>,
      }),
    ).toThrow("cannot write outside container");
  });

  it("builds agent context for a bound container", () => {
    let doc = createEmptyDocument();
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
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    const child: PenNode = {
      id: "child",
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      parentId: "container",
    });

    const result = duplicateCanvasNodes(doc, ["container"], 16);
    const cloneId = result.pastedIds[0];
    expect(cloneId).toBeDefined();
    const clone = cloneId ? findNode(result.doc, cloneId) : undefined;

    expect(clone?.type).toBe("frame");
    const cloneChildren = clone && "children" in clone ? clone.children : [];
    expect(cloneChildren).toHaveLength(1);
    const childClone = (cloneChildren as PenNode[])[0];
    expect(childClone).toBeDefined();
    expect(childClone ? findParent(result.doc, childClone.id)?.id : null).toBe(
      cloneId,
    );
  });

  it("reorders nodes within root stacking order", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
    doc = applyCanvasOperation(doc, {
      type: "reorderNode",
      nodeId: "b",
      direction: "front",
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["b", "a"]);
  });

  it("applies multiple operations in one transaction", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "a",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      } as PenNode,
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "b",
        type: "rectangle",
        x: 30,
        y: 0,
        width: 20,
        height: 20,
      } as PenNode,
    });

    const result = applyCanvasTransaction(
      doc,
      [
        {
          type: "updateNode",
          nodeId: "a",
          updates: { x: 10 } as Partial<PenNode>,
        },
        {
          type: "updateNode",
          nodeId: "b",
          updates: { x: 40 } as Partial<PenNode>,
        },
      ],
      { transactionId: "tx-test" },
    );

    expect(result.applied).toBe(2);
    expect(result.transactionId).toBe("tx-test");
    expect(findNode(result.doc, "a")?.x).toBe(10);
    expect(findNode(result.doc, "b")?.x).toBe(40);
    expect(findNode(doc, "a")?.x).toBe(0);
  });

  it("rolls back a failed transaction by preserving the source document", () => {
    const doc = applyCanvasOperation(createEmptyDocument(), {
      type: "insertNode",
      node: {
        id: "a",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      } as PenNode,
    });

    expect(() =>
      applyCanvasTransaction(doc, [
        {
          type: "updateNode",
          nodeId: "a",
          updates: { x: 10 } as Partial<PenNode>,
        },
        {
          type: "updateNode",
          nodeId: "missing",
          updates: { x: 40 } as Partial<PenNode>,
        },
      ]),
    ).toThrow("Node missing does not exist.");
    expect(findNode(doc, "a")?.x).toBe(0);
  });

  it("hit-tests visible nodes inside marquee bounds", () => {
    let doc = createEmptyDocument();
    const visible: PenNode = {
      id: "visible",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 80,
      height: 80,
    };
    const hidden: PenNode = {
      id: "hidden",
      type: "rectangle",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
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

  it("resolves nested node scene origins and bounds", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "outer",
        type: "frame",
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        children: [
          {
            id: "inner",
            type: "group",
            x: 20,
            y: 30,
            width: 120,
            height: 80,
            children: [
              {
                id: "leaf",
                type: "rectangle",
                x: 7,
                y: 9,
                width: 40,
                height: 24,
              } as PenNode,
            ],
          } as PenNode,
        ],
      } as PenNode,
    });

    expect(getNodeSceneOrigin(doc, "leaf")).toEqual({ x: 127, y: 89 });
    expect(getNodeSceneBounds(doc, "leaf")).toMatchObject({
      x: 127,
      y: 89,
      width: 40,
      height: 24,
    });
  });

  it("hit-tests nested visible nodes by absolute scene bounds", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 160,
        height: 120,
        children: [
          {
            id: "nested",
            type: "rectangle",
            x: 20,
            y: 30,
            width: 40,
            height: 40,
          } as PenNode,
        ],
      } as PenNode,
    });

    const hitIds = getVisibleCanvasNodesInBounds(doc, {
      x: 118,
      y: 78,
      width: 48,
      height: 48,
    }).map((node) => node.id);

    expect(hitIds).toContain("nested");
  });

  it("orders and hit-tests nodes from the active page", () => {
    const doc = createCanvasDocument();
    const next = {
      ...doc,
      activePageId: "page-b",
      pages: [
        {
          id: "page-a",
          name: "A",
          children: [
            {
              id: "page-a-rect",
              type: "rectangle" as const,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            },
          ],
        },
        {
          id: "page-b",
          name: "B",
          children: [
            {
              id: "page-b-rect",
              type: "rectangle" as const,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            },
          ],
        },
      ],
    };

    expect(getOrderedCanvasNodes(next).map((entry) => entry.node.id)).toEqual([
      "page-b-rect",
    ]);
    expect(
      getVisibleCanvasNodesInBounds(next, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }).map((node) => node.id),
    ).toEqual(["page-b-rect"]);
    expect(
      getOrderedCanvasNodes(next, "page-a").map((entry) => entry.node.id),
    ).toEqual(["page-a-rect"]);
  });

  it("groups and ungroups sibling nodes without changing their bounds", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    };
    const b: PenNode = {
      id: "b",
      type: "ellipse",
      x: 140,
      y: 100,
      width: 100,
      height: 90,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "groupNodes",
      groupId: "group-1",
      nodeIds: ["a", "b"],
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["group-1"]);
    expect(getNodeBounds(asTestNode(findNode(doc, "group-1"), "node"))).toEqual(
      {
        x: 20,
        y: 30,
        width: 220,
        height: 160,
      },
    );
    expect(findParent(doc, "a")?.id).toBe("group-1");

    doc = applyCanvasOperation(doc, {
      type: "ungroupNode",
      groupId: "group-1",
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["a", "b"]);
    expect(getNodeBounds(asTestNode(findNode(doc, "a"), "node"))).toEqual(
      getNodeBounds(a),
    );
    expect(findParent(doc, "b")).toBeUndefined();
  });

  it("aligns unlocked nodes to the selection bounds", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 140,
      y: 100,
      width: 100,
      height: 90,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "alignNodes",
      nodeIds: ["a", "b"],
      alignment: "right",
    });

    expect(findNode(doc, "a")?.x ?? 0).toBe(160);
    expect(findNode(doc, "b")?.x ?? 0).toBe(140);
  });

  it("moves a node to a specific sibling index", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    };
    const c: PenNode = {
      id: "c",
      type: "rectangle",
      x: 40,
      y: 0,
      width: 10,
      height: 10,
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

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("detaches dragged children when their center leaves the parent bounds", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 160,
        height: 120,
        clipContent: true,
        children: [
          {
            id: "rect",
            type: "rectangle",
            x: 180,
            y: 20,
            width: 40,
            height: 40,
          } as PenNode,
        ],
      } as PenNode,
    });

    const detached = detachNodesOutsideParentBounds(doc, ["rect"]);

    expect(detached.detachedIds).toEqual(["rect"]);
    expect(findParent(detached.doc, "rect")).toBeUndefined();
    expect(findNode(detached.doc, "rect")).toMatchObject({
      x: 280,
      y: 70,
    });
  });

  it("keeps children inside their parent and preserves line endpoints on detach", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "outer",
        type: "group",
        x: 20,
        y: 30,
        width: 400,
        height: 300,
        children: [
          {
            id: "frame",
            type: "frame",
            x: 100,
            y: 50,
            width: 120,
            height: 100,
            clipContent: true,
            children: [
              {
                id: "inside",
                type: "rectangle",
                x: 10,
                y: 10,
                width: 40,
                height: 40,
              } as PenNode,
              {
                id: "line",
                type: "line",
                x: 160,
                y: 20,
                x2: 220,
                y2: 20,
              } as PenNode,
            ],
          } as PenNode,
        ],
      } as PenNode,
    });

    const unchanged = detachNodesOutsideParentBounds(doc, ["inside"]);
    expect(unchanged.detachedIds).toEqual([]);
    expect(findParent(unchanged.doc, "inside")?.id).toBe("frame");

    const detached = detachNodesOutsideParentBounds(doc, ["line"]);
    expect(detached.detachedIds).toEqual(["line"]);
    expect(findParent(detached.doc, "line")?.id).toBe("outer");
    expect(findNode(detached.doc, "line")).toMatchObject({
      x: 260,
      y: 70,
      x2: 320,
      y2: 70,
    });
  });

  it("reparents dragged root nodes into frames by mouse drop point and enables clipping", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 160,
        height: 120,
        children: [],
      } as PenNode,
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "rect",
        type: "rectangle",
        x: 140,
        y: 80,
        width: 40,
        height: 40,
      } as PenNode,
    });

    const reparented = reparentNodesByDropPoint(doc, ["rect"], {
      x: 130,
      y: 70,
    });

    expect(reparented.movedIds).toEqual(["rect"]);
    expect(findParent(reparented.doc, "rect")?.id).toBe("frame");
    expect(findNode(reparented.doc, "frame")).toMatchObject({
      clipContent: true,
    });
    expect(findNode(reparented.doc, "rect")).toMatchObject({
      x: 40,
      y: 30,
    });
  });

  it("does not reparent dragged nodes into sticky note frames", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "sticky",
        type: "frame",
        x: 100,
        y: 50,
        width: 160,
        height: 120,
        clipContent: false,
        meta: { boardKind: "sticky" },
        children: [],
      } as PenNode,
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "rect",
        type: "rectangle",
        x: 140,
        y: 80,
        width: 40,
        height: 40,
      } as PenNode,
    });

    const reparented = reparentNodesByDropPoint(doc, ["rect"], {
      x: 130,
      y: 70,
    });

    expect(reparented.movedIds).toEqual([]);
    expect(reparented.targetParentId).toBeNull();
    expect(findParent(reparented.doc, "rect")).toBeUndefined();
    expect(findNode(reparented.doc, "sticky")).toMatchObject({
      clipContent: false,
    });
    expect(findNode(reparented.doc, "rect")).toMatchObject({
      x: 140,
      y: 80,
    });
  });

  it("preserves scene line endpoints when reparenting into a frame", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 180,
        height: 140,
        children: [],
      } as PenNode,
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "line",
        type: "line",
        x: 140,
        y: 80,
        x2: 220,
        y2: 120,
      } as PenNode,
    });

    const reparented = reparentNodesByDropPoint(doc, ["line"], {
      x: 150,
      y: 90,
    });

    expect(reparented.movedIds).toEqual(["line"]);
    expect(findParent(reparented.doc, "line")?.id).toBe("frame");
    expect(findNode(reparented.doc, "line")).toMatchObject({
      x: 40,
      y: 30,
      x2: 120,
      y2: 70,
    });
    expect(getNodeSceneBounds(reparented.doc, "line")).toMatchObject({
      x: 140,
      y: 80,
    });
  });

  it("computes endpoint-driven line bounds in local and scene coordinates", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 200,
        height: 120,
        children: [
          {
            id: "line",
            type: "line",
            x: 90,
            y: 70,
            x2: 10,
            y2: 20,
          } as PenNode,
        ],
      } as PenNode,
    });

    const line = findNode(doc, "line");
    if (!line || line.type !== "line") {
      throw new Error("Expected line fixture to exist.");
    }

    expect(getLineEndpoints(line)).toEqual({
      start: { x: 90, y: 70 },
      end: { x: 10, y: 20 },
    });
    expect(getNodeBounds(line)).toMatchObject({
      x: 10,
      y: 20,
      width: 80,
      height: 50,
    });
    expect(getLineSceneEndpoints(doc, "line")).toEqual({
      start: { x: 190, y: 120 },
      end: { x: 110, y: 70 },
    });
    expect(getNodeSceneBounds(doc, "line")).toMatchObject({
      x: 110,
      y: 70,
      width: 80,
      height: 50,
    });
  });

  it("detaches dragged children by mouse drop point even when their center remains inside", () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "frame",
        type: "frame",
        x: 100,
        y: 50,
        width: 160,
        height: 120,
        clipContent: true,
        children: [
          {
            id: "rect",
            type: "rectangle",
            x: 20,
            y: 20,
            width: 100,
            height: 80,
          } as PenNode,
        ],
      } as PenNode,
    });

    const reparented = reparentNodesByDropPoint(doc, ["rect"], {
      x: 90,
      y: 60,
    });

    expect(reparented.movedIds).toEqual(["rect"]);
    expect(findParent(reparented.doc, "rect")).toBeUndefined();
    expect(findNode(reparented.doc, "rect")).toMatchObject({
      x: 120,
      y: 70,
    });
  });

  it("inserts imported nodes into the target parent and selects the roots", () => {
    let doc = createEmptyDocument();
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
          title: "Imported",
          x: 10,
          y: 20,
          width: 200,
          height: 120,
          childrenOrder: ["child-1"],
          meta: { source: "svg-import" },
        },
        {
          id: "child-1",
          type: "rectangle",
          title: "Child",
          x: 20,
          y: 30,
          width: 100,
          height: 80,
          fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
          meta: { source: "svg-import" },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(doc, result, {
      offsetX: 40,
      offsetY: 10,
    });

    const groupNode1 = findNode(inserted.doc, "group-1");
    const childNode1 = findNode(inserted.doc, "child-1");
    expect(groupNode1?.x).toBe(50);
    expect(groupNode1?.y).toBe(30);
    expect(childNode1).toBeDefined();
    expect(childNode1?.x).toBe(10);
    expect(childNode1?.y).toBe(10);
    expect(inserted.insertedIds).toEqual(["group-1"]);
    expect(
      asTestNode(findNode(inserted.doc, "group-1"), "node").meta,
    ).toMatchObject({
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
          type: "rectangle",
          title: "Imported rect",
          x: 10,
          y: 20,
          width: 80,
          height: 60,
          fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
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

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const root = findNode(
      inserted.doc,
      readRequired(result.rootNodeIds, 0, "root node id"),
    );
    expect(asTestNode(root, "root")?.meta).toMatchObject({
      source: "svg-import",
      importSessionId: result.importSessionId,
      importSourceLabel: "SVG",
      warningCount: 1,
      degradationHints: ["unsupported_tag"],
    });
  });

  it("merges imported Figma style definitions into the canvas document", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-style-defs",
      rootNodeIds: ["styled-rect"],
      nodes: [
        {
          id: "styled-rect",
          type: "rect",
          parentId: null,
          title: "Styled rect",
          bounds: { x: 0, y: 0, width: 80, height: 40 },
          styleRefs: {
            fill: { source: "figma", id: "10:20" },
          },
          fills: [{ type: "solid", color: "#ff0000" }] as PenFill[],
        },
      ],
      assets: [],
      styleDefinitions: {
        "10:20": {
          source: "figma",
          id: "10:20",
          name: "Brand / Primary",
          type: "fill",
          fill: [{ type: "solid", color: "#ff0000" }],
          variableRefs: {
            fill: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" },
          },
        },
      },
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const node = findNode(inserted.doc, "styled-rect") as
      | (PenNode & { styleRefs?: Record<string, unknown> })
      | undefined;

    expect(inserted.doc.styleDefinitions?.["10:20"]).toMatchObject({
      source: "figma",
      id: "10:20",
      name: "Brand / Primary",
      type: "fill",
      variableRefs: {
        fill: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" },
      },
    });
    expect(inserted.doc.variables?.["figma.VariableID-1-2"]).toMatchObject({
      source: "figma",
      id: "VariableID:1:2",
      type: "color",
      value: "#ff0000",
      property: "fill",
      unresolved: false,
    });
    expect(node?.styleRefs).toMatchObject({
      fill: { source: "figma", id: "10:20" },
    });
  });

  it("keeps unresolved imported Figma variable refs as editable placeholders", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-variable-placeholders",
      rootNodeIds: ["text-with-var"],
      nodes: [
        {
          id: "text-with-var",
          type: "text",
          parentId: null,
          title: "Variable text",
          bounds: { x: 0, y: 0, width: 120, height: 24 },
          text: "Variable text",
          variableRefs: {
            fontSize: { id: "VariableID:font-size" },
          },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);

    expect(
      inserted.doc.variables?.["figma.VariableID-font-size"],
    ).toMatchObject({
      source: "figma",
      id: "VariableID:font-size",
      type: "string",
      value: "VariableID:font-size",
      property: "fontSize",
      unresolved: true,
    });
  });

  it("upgrades unresolved imported Figma variable placeholders with resolved definitions", () => {
    const doc = createEmptyDocument();
    doc.variables = {
      "figma.VariableID-1-2": {
        source: "figma",
        id: "VariableID:1:2",
        type: "string",
        value: "VariableID:1:2",
        property: "fill",
        unresolved: true,
      },
      "figma.keep-user-token": {
        source: "figma",
        id: "keep-user-token",
        type: "color",
        value: "#123456",
        property: "fill",
        unresolved: false,
      },
    };
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-variable-upgrade",
      rootNodeIds: ["styled-rect"],
      nodes: [
        {
          id: "styled-rect",
          type: "rect",
          parentId: null,
          title: "Styled rect",
          bounds: { x: 0, y: 0, width: 80, height: 40 },
          fills: [{ type: "solid", color: "#ff0000" }] as PenFill[],
          variableRefs: {
            fill: { id: "VariableID:1:2" },
            stroke: { id: "keep-user-token" },
          },
        },
      ],
      assets: [],
      variables: {
        "figma.keep-user-token": {
          source: "figma",
          id: "keep-user-token",
          type: "color",
          value: "#abcdef",
          property: "fill",
          unresolved: false,
        },
      },
      warnings: [],
    };

    const inserted = insertCanvasImportResult(doc, result);

    expect(inserted.doc.variables?.["figma.VariableID-1-2"]).toMatchObject({
      source: "figma",
      id: "VariableID:1:2",
      type: "color",
      value: "#ff0000",
      property: "fill",
      unresolved: false,
    });
    expect(inserted.doc.variables?.["figma.keep-user-token"]).toMatchObject({
      value: "#123456",
      unresolved: false,
    });
  });

  it("preserves imported Figma ellipse arc geometry", () => {
    expect(
      mapFigmaNativeArcData({
        startingAngle: Math.PI / 2,
        endingAngle: Math.PI,
        innerRadius: 0.35,
      }),
    ).toEqual({
      startAngle: 90,
      sweepAngle: 90,
      innerRadius: 0.35,
    });

    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-arc",
      rootNodeIds: ["arc-ellipse"],
      nodes: [
        {
          id: "arc-ellipse",
          type: "ellipse",
          parentId: null,
          title: "Arc",
          bounds: { x: 10, y: 20, width: 100, height: 80 },
          startAngle: 90,
          sweepAngle: 90,
          innerRadius: 0.35,
          fills: [{ type: "solid", color: "#ffffff" }] as PenFill[],
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    expect(findNode(inserted.doc, "arc-ellipse")).toMatchObject({
      type: "ellipse",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      startAngle: 90,
      sweepAngle: 90,
      innerRadius: 0.35,
    });
  });

  parserCapableIt(
    "parses figma html fallback with grouped structure and degradation warnings",
    () => {
      const result = parseClipboardImport({
        html: `
          <div data-buffer="1" data-node-id="42:1" data-node-type="INSTANCE" data-component-id="7:9" data-component-key="button-key" data-variant-properties='{"State":"Default","Disabled":false}' data-component-prop-assignments='{"Label":"Title"}' style="position:absolute;left:10px;top:12px;width:120px;height:64px;background-color:#ffffff;display:flex;align-items:stretch;box-shadow:0 2px 12px rgba(0,0,0,.15)">
            <span style="font-size:18px;color:#111827">Title</span>
            <div data-node-id="42:2" style="position:absolute;left:72px;top:8px;width:20px;height:20px;background-color:#ff0000"></div>
          </div>
        `,
      });

      expect(result).not.toBeNull();
      expect(result?.source).toBe("figma");
      expect(result?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "layout_degraded" }),
          expect.objectContaining({ code: "effects_dropped" }),
          expect.objectContaining({ code: "component_editability_limited" }),
          expect.objectContaining({ code: "partial_fidelity" }),
        ]),
      );
      const rootId = result?.rootNodeIds[0];
      const root = rootId
        ? result?.nodes.find((node) => node.id === rootId)
        : null;
      expect(root?.type).toBe("group");
      expect(asTestNode(root, "root")?.meta).toMatchObject({
        source: "figma-paste",
        importSourceLabel: "Figma",
        originNodeType: "div",
        autoLayout: {
          layout: "horizontal",
          alignItems: "stretch",
        },
      });
      if (!result) {
        throw new Error("Expected Figma HTML fallback to parse.");
      }
      const inserted = insertCanvasImportResult(createEmptyDocument(), result);
      const importedAbsoluteChild = getOrderedCanvasNodes(inserted.doc)
        .map((entry) => entry.node)
        .find(
          (node) =>
            ((node as PenNode & { meta?: Record<string, unknown> }).meta
              ?.originNodeId as string | undefined) === "42:2" &&
            node.type === "group",
        ) as
        | (PenNode & { layoutConstraints?: PenNode["layoutConstraints"] })
        | undefined;
      expect(findNode(inserted.doc, rootId ?? "")).toMatchObject({
        componentRef: {
          source: "figma",
          type: "instance",
          id: "42:1",
          key: "button-key",
          componentId: "7:9",
          variantProperties: { State: "Default", Disabled: false },
          propertyAssignments: { Label: "Title" },
        },
      });
      expect(importedAbsoluteChild).toMatchObject({
        layoutConstraints: {
          positioning: "absolute",
        },
      });
    },
  );

  it("extracts figma clipboard meta and buffer from comment blocks", () => {
    const metaBase64 = Buffer.from(
      JSON.stringify({ source: "figma", nodeCount: 2 }),
    ).toString("base64");
    const bufferBase64 = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString(
      "base64",
    );
    const html = `<!--(figmeta)-->${metaBase64}<!--(figmeta)--><!--(figma)-->${bufferBase64}<!--(figma)-->`;

    const extracted = extractFigmaClipboardData(html);

    expect(extracted?.meta).toEqual({ source: "figma", nodeCount: 2 });
    expect(
      Array.from(new Uint8Array(extracted?.buffer ?? new ArrayBuffer(0))),
    ).toEqual([1, 2, 3, 4]);
  });

  it("extracts figma clipboard meta and buffer from quoted data attributes", () => {
    const metaBase64 = Buffer.from(
      JSON.stringify({ source: "figma", nodeCount: 1 }),
    ).toString("base64");
    const bufferBase64 = Buffer.from(Uint8Array.from([4, 3, 2, 1])).toString(
      "base64",
    );
    const html = `<div data-metadata='${metaBase64}' data-buffer='${bufferBase64}'></div>`;

    const extracted = extractFigmaClipboardData(html);

    expect(extracted?.meta).toEqual({ source: "figma", nodeCount: 1 });
    expect(
      Array.from(new Uint8Array(extracted?.buffer ?? new ArrayBuffer(0))),
    ).toEqual([4, 3, 2, 1]);
  });

  parserCapableIt(
    "falls back to styled html figma parsing when native clipboard decode is invalid",
    () => {
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
    },
  );

  parserCapableIt(
    "parses SVG clipboard MIME items with style, defs, and transform",
    () => {
      const result = parseClipboardImport({
        items: [
          {
            type: "image/svg+xml",
            text: `
            <svg width="200" height="100" viewBox="0 0 100 50">
              <defs>
                <linearGradient id="g"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>
              </defs>
              <style>.hero { fill: url(#g); stroke: #111111; stroke-width: 2; }</style>
              <rect class="hero" x="10" y="10" width="30" height="20" transform="translate(5 0)" />
            </svg>
          `,
          },
        ],
      });

      expect(result?.source).toBe("svg");
      const rect = result?.nodes.find((node) => node.type === "rect") as
        | {
            bounds?: { x: number; y: number; width: number; height: number };
            fills?: Array<{ type: string }>;
            stroke?: { thickness?: number };
          }
        | undefined;
      expect(rect?.bounds).toMatchObject({
        x: 30,
        y: 20,
        width: 60,
        height: 40,
      });
      expect(rect?.fills?.[0]).toMatchObject({ type: "linear_gradient" });
      expect(rect?.stroke?.thickness).toBe(2);
    },
  );

  it("preserves legacy native Figma gradient transform geometry", () => {
    const transform = {
      m00: 0.8,
      m01: 0.1,
      m02: 0.05,
      m10: 0.2,
      m11: 0.6,
      m12: 0.1,
    };
    const stops = [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ];

    const fills = mapFigmaNativePaints([
      { type: "GRADIENT_LINEAR", transform, stops },
      { type: "GRADIENT_ANGULAR", transform, stops },
      { type: "GRADIENT_DIAMOND", transform, stops },
    ]);

    expect(fills?.[0]).toMatchObject({
      type: "linear_gradient",
      angle: 76,
      x1: 0.1,
      y1: 0.4,
      transform,
    });
    expect(fills?.[0]?.type === "linear_gradient" && fills[0].x2).toBeCloseTo(
      0.9,
    );
    expect(fills?.[1]).toMatchObject({
      type: "angular_gradient",
      cx: 0.5,
      cy: 0.5,
      angle: 76,
      transform,
    });
    expect(fills?.[2]).toMatchObject({
      type: "diamond_gradient",
      cx: 0.5,
      cy: 0.5,
      angle: 76,
      transform,
    });
    expect(
      fills?.[2]?.type === "diamond_gradient" && fills[2].radius,
    ).toBeCloseTo(0.3582, 4);
  });

  it("preserves legacy native Figma paint layer visibility and blend modes", () => {
    const fills = mapFigmaNativePaints([
      {
        type: "SOLID",
        visible: false,
        blendMode: "MULTIPLY",
        opacity: 0.4,
        color: { r: 1, g: 0, b: 0, a: 1 },
      },
      {
        type: "GRADIENT_LINEAR",
        blendMode: "SCREEN",
        opacity: 0.7,
        transform: {
          m00: 1,
          m01: 0,
          m02: 0,
          m10: 0,
          m11: 1,
          m12: 0,
        },
        stops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      },
    ]);

    expect(fills).toEqual([
      {
        type: "solid",
        color: "#ff0000",
        opacity: 0.4,
        visible: false,
        blendMode: "multiply",
      },
      {
        type: "linear_gradient",
        angle: 90,
        x1: 0,
        y1: 0.5,
        x2: 1,
        y2: 0.5,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
        opacity: 0.7,
        blendMode: "screen",
      },
    ]);
  });

  it("preserves unresolved legacy native Figma image fills for diagnostics", () => {
    const fills = mapFigmaNativePaints([
      {
        type: "IMAGE",
        image: { hash: Uint8Array.from([0xab, 0xcd, 0x12]) },
        imageScaleMode: "CROP",
        originalImageWidth: 2644,
        originalImageHeight: 1696,
        opacity: 0.6,
        visible: false,
        blendMode: "MULTIPLY",
        transform: {
          m00: 0.5,
          m01: 0.1,
          m02: 0.2,
          m10: 0.05,
          m11: 0.75,
          m12: 0.15,
        },
      },
    ]);

    expect(fills).toEqual([
      {
        type: "image",
        url: "__hash:abcd12",
        mode: "crop",
        originalSize: { width: 2644, height: 1696 },
        transform: {
          m00: 0.5,
          m01: 0.1,
          m02: 0.2,
          m10: 0.05,
          m11: 0.75,
          m12: 0.15,
        },
        opacity: 0.6,
        visible: false,
        blendMode: "multiply",
      },
    ]);
  });

  it("preserves imported Figma vector path fill rules", () => {
    expect(
      mapFigmaNativeVectorFillRule({
        fillGeometry: [{ windingRule: "NONZERO" }, { windingRule: "ODD" }],
      }),
    ).toBe("evenodd");

    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-vector-fill-rule",
      rootNodeIds: ["evenodd-path"],
      nodes: [
        {
          id: "evenodd-path",
          type: "path",
          parentId: null,
          title: "Compound path",
          bounds: { x: 0, y: 0, width: 80, height: 80 },
          d: "M0 0 L80 0 L80 80 L0 80 Z M20 20 L60 20 L60 60 L20 60 Z",
          fillRule: "evenodd",
          fills: [{ type: "solid", color: "#000000" }] as PenFill[],
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    expect(findNode(inserted.doc, "evenodd-path")).toMatchObject({
      type: "path",
      fillRule: "evenodd",
    });
  });

  it("preserves legacy native Figma hidden stroke paints and dash metadata", () => {
    const stroke = mapFigmaNativeStroke({
      strokeWeight: 3,
      strokeAlign: "OUTSIDE",
      strokeCap: "SQUARE",
      strokeJoin: "MITER",
      strokeMiterLimit: 8,
      dashPattern: [6, 2],
      dashOffset: 1.5,
      strokePaints: [
        {
          type: "SOLID",
          visible: false,
          blendMode: "SCREEN",
          color: { r: 0, g: 0, b: 1, a: 1 },
        },
      ],
    });

    expect(stroke).toEqual({
      thickness: 3,
      align: "outside",
      cap: "square",
      join: "miter",
      dashPattern: [6, 2],
      dashOffset: 1.5,
      miterLimit: 8,
      fill: [
        {
          type: "solid",
          color: "#0000ff",
          visible: false,
          blendMode: "screen",
        },
      ],
    });
  });

  it("preserves legacy native Figma effect layers for editability", () => {
    const effects = mapFigmaNativeEffects([
      {
        type: "DROP_SHADOW",
        visible: true,
        blendMode: "MULTIPLY",
        offset: { x: 2, y: 4 },
        radius: 12,
        spread: 3,
        color: { r: 0, g: 0, b: 0, a: 0.35 },
      },
      {
        type: "INNER_SHADOW",
        visible: false,
        offset: { x: -1, y: 2 },
        radius: 6,
        spread: 1,
        color: { r: 1, g: 0, b: 0, a: 0.5 },
      },
      {
        type: "BACKGROUND_BLUR",
        visible: true,
        radius: 20,
        opacity: 0.4,
        blendMode: "SCREEN",
      },
    ]);

    expect(effects).toEqual([
      {
        type: "shadow",
        inner: false,
        offsetX: 2,
        offsetY: 4,
        blur: 12,
        spread: 3,
        color: "#000000",
        opacity: 0.35,
        blendMode: "multiply",
      },
      {
        type: "shadow",
        inner: true,
        offsetX: -1,
        offsetY: 2,
        blur: 6,
        spread: 1,
        color: "#ff0000",
        visible: false,
        opacity: 0.5,
      },
      {
        type: "background_blur",
        radius: 20,
        opacity: 0.4,
        blendMode: "screen",
      },
    ]);
  });

  it("parses raster clipboard files into image assets", () => {
    const result = parseClipboardImport({
      files: [
        {
          type: "image/png",
          name: "paste.png",
          dataUrl: "data:image/png;base64,AQID",
          width: 32,
          height: 24,
        },
      ],
    });

    expect(result?.source).toBe("image");
    expect(result?.assets[0]).toMatchObject({
      mimeType: "image/png",
      name: "paste.png",
      width: 32,
      height: 24,
    });
    const image = result?.nodes[0] as
      | {
          type?: string;
          bounds?: { width: number; height: number };
          src?: string;
        }
      | undefined;
    expect(image).toMatchObject({
      type: "image",
      bounds: { width: 32, height: 24 },
      src: "data:image/png;base64,AQID",
    });
  });

  parserCapableIt(
    "prefers explicit SVG MIME over HTML inline SVG fallback",
    () => {
      const result = parseClipboardImport({
        html: '<svg width="20" height="20"><rect id="html" width="20" height="20"/></svg>',
        items: [
          {
            type: "image/svg+xml",
            text: '<svg width="10" height="10"><circle id="mime" cx="5" cy="5" r="5"/></svg>',
          },
        ],
      });

      expect(
        result?.nodes.some((node) => importedNodeTitle(node) === "mime"),
      ).toBe(true);
      expect(
        result?.nodes.some((node) => importedNodeTitle(node) === "html"),
      ).toBe(false);
    },
  );

  parserCapableIt(
    "prefers explicit SVG MIME when Figma native decode falls back",
    () => {
      const result = parseClipboardImport({
        html: `
          <div data-metadata="invalid" data-buffer="invalid" style="position:absolute;left:12px;top:16px;width:120px;height:56px">
            Figma html fallback
          </div>
        `,
        items: [
          {
            type: "image/svg+xml",
            text: '<svg width="10" height="10"><circle id="figma-svg-mime" cx="5" cy="5" r="5"/></svg>',
          },
        ],
      });

      expect(result?.source).toBe("svg");
      expect(
        result?.nodes.some(
          (node) => importedNodeTitle(node) === "figma-svg-mime",
        ),
      ).toBe(true);
      expect(
        result?.nodes.some(
          (node) => importedNodeTitle(node) === "Figma html fallback",
        ),
      ).toBe(false);
    },
  );

  parserCapableIt(
    "applies SVG descendant selector specificity and stroke attributes",
    () => {
      const result = parseClipboardImport({
        svg: `
        <svg width="100" height="60">
          <style>
            rect { fill: #ff0000; }
            .wrapper .target { fill: #00ff00; stroke: #111111; stroke-width: 3; }
            #hero { stroke: #222222; }
          </style>
          <g class="wrapper">
            <rect id="hero" class="target" x="4" y="6" width="40" height="20" fill-opacity="0.5" stroke-dasharray="4 2" stroke-linecap="round" stroke-linejoin="miter" />
          </g>
        </svg>
      `,
      });

      const rect = result?.nodes.find(
        (node) => importedNodeTitle(node) === "hero",
      ) as
        | {
            fills?: Array<{ type: string; color?: string; opacity?: number }>;
            stroke?: {
              fill?: Array<{ color?: string }>;
              thickness?: number;
              dashPattern?: number[];
              cap?: string;
              join?: string;
            };
          }
        | undefined;

      expect(rect?.fills?.[0]).toMatchObject({
        type: "solid",
        color: "#00ff00",
        opacity: 0.5,
      });
      expect(rect?.stroke).toMatchObject({
        thickness: 3,
        dashPattern: [4, 2],
        cap: "round",
        join: "miter",
      });
      expect(rect?.stroke?.fill?.[0]?.color).toBe("#222222");
    },
  );

  parserCapableIt(
    "expands SVG use and maps simple clipPath/filter definitions",
    () => {
      const result = parseClipboardImport({
        svg: `
        <svg width="120" height="80">
          <defs>
            <rect id="reused" x="8" y="8" width="50" height="30" fill="#3366ff" />
            <clipPath id="clip"><rect x="0" y="0" width="60" height="40" rx="6" /></clipPath>
            <filter id="shadow"><feDropShadow dx="2" dy="3" stdDeviation="4" flood-color="#000000" /></filter>
          </defs>
          <g id="clipped" clip-path="url(#clip)" filter="url(#shadow)">
            <use href="#reused" x="4" y="5" />
          </g>
        </svg>
      `,
      });

      const frame = result?.nodes.find(
        (node) => importedNodeTitle(node) === "clipped",
      ) as
        | {
            type?: string;
            clipContent?: boolean;
            cornerRadius?: number;
            effects?: Array<{
              type?: string;
              offsetX?: number;
              offsetY?: number;
              blur?: number;
            }>;
            childrenOrder?: string[];
          }
        | undefined;
      const reused = result?.nodes.find(
        (node) => importedNodeTitle(node) === "reused",
      );

      expect(frame).toMatchObject({
        type: "frame",
        clipContent: true,
        cornerRadius: 6,
        effects: [{ type: "shadow", offsetX: 2, offsetY: 3, blur: 4 }],
      });
      expect(frame?.childrenOrder).toContain(reused?.id);
    },
  );

  it("preserves imported frame layout, effects, and text style during insertion", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-test",
      rootNodeIds: ["frame-1"],
      nodes: [
        {
          id: "frame-1",
          type: "frame",
          parentId: null,
          title: "Auto frame",
          bounds: { x: 10, y: 20, width: 240, height: 120, rotation: 8 },
          transform: {
            m00: -1,
            m01: 0.25,
            m02: 10,
            m10: 0.1,
            m11: 1.2,
            m12: 20,
          },
          scaleX: 1.05,
          scaleY: 1.2,
          skewX: 7,
          skewY: 5,
          blendMode: "multiply",
          flipX: true,
          fills: [{ type: "solid", color: "#ffffff" }] as PenFill[],
          effects: [
            {
              type: "shadow",
              offsetX: 0,
              offsetY: 4,
              blur: 12,
              spread: 0,
              color: "#00000033",
            },
          ],
          layout: "horizontal",
          gap: 12,
          padding: [8, 16],
          justifyContent: "center",
          alignItems: "center",
          clipContent: true,
          childrenOrder: ["text-1"],
          meta: { source: "figma-paste" },
        },
        {
          id: "text-1",
          type: "text",
          parentId: "frame-1",
          text: "Styled",
          bounds: { x: 0, y: 0, width: 80, height: 24 },
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: 0.4,
          textAlign: "center",
          textGrowth: "fixed-width",
          fills: [{ type: "solid", color: "#111111" }] as PenFill[],
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const frame = findNode(inserted.doc, "frame-1") as
      | (PenNode & {
          gap?: number;
          padding?: [number, number];
          justifyContent?: string;
          alignItems?: string;
          clipContent?: boolean;
          effects?: Array<{ type: string; blur?: number }>;
          blendMode?: string;
          flipX?: boolean;
        })
      | undefined;
    const text = findNode(inserted.doc, "text-1") as
      | (PenNode & {
          lineHeight?: number;
          letterSpacing?: number;
          textGrowth?: string;
        })
      | undefined;

    expect(frame).toMatchObject({
      type: "frame",
      rotation: 8,
      transform: {
        m00: -1,
        m01: 0.25,
        m02: 10,
        m10: 0.1,
        m11: 1.2,
        m12: 20,
      },
      scaleX: 1.05,
      scaleY: 1.2,
      skewX: 7,
      skewY: 5,
      blendMode: "multiply",
      flipX: true,
      layout: "horizontal",
      gap: 12,
      padding: [8, 16],
      justifyContent: "center",
      alignItems: "center",
      clipContent: true,
    });
    expect(frame?.effects?.[0]).toMatchObject({ type: "shadow", blur: 12 });
    expect(text).toMatchObject({
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: 0.4,
      textAlign: "center",
      textGrowth: "fixed-width",
    });
  });

  it("preserves imported text PostScript font identity", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-text-postscript",
      rootNodeIds: ["text-postscript"],
      nodes: [
        {
          id: "text-postscript",
          type: "text",
          parentId: null,
          title: "PostScript text",
          bounds: { x: 0, y: 0, width: 180, height: 48 },
          text: [
            {
              text: "Styled",
              fontFamily: "Inter",
              fontPostScriptName: "Inter-SemiBoldItalic",
              fontSize: 18,
              fontWeight: 600,
              fontStyle: "italic",
            },
          ],
          fontFamily: "Inter",
          fontPostScriptName: "Inter-Regular",
          fontSize: 16,
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const text = findNode(inserted.doc, "text-postscript") as
      | (PenNode & {
          content?: Array<{ fontPostScriptName?: string }>;
          fontPostScriptName?: string;
        })
      | undefined;

    expect(text).toMatchObject({
      type: "text",
      fontFamily: "Inter",
      fontPostScriptName: "Inter-Regular",
    });
    expect(text?.content?.[0]?.fontPostScriptName).toBe("Inter-SemiBoldItalic");
  });

  it("materializes imported auto-layout sizing onto executable PenNode fields", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-layout-props",
      rootNodeIds: ["frame-fit"],
      nodes: [
        {
          id: "frame-fit",
          type: "frame",
          parentId: null,
          title: "Fit frame",
          bounds: { x: 0, y: 0, width: 240, height: 120 },
          layout: "horizontal",
          gap: 8,
          childrenOrder: ["child-fill", "child-absolute"],
          meta: {
            source: "figma-paste",
            autoLayout: {
              layout: "horizontal",
              widthMode: "fit_content",
              heightMode: "fixed",
            },
          },
        },
        {
          id: "child-fill",
          type: "text",
          parentId: "frame-fit",
          text: "Fill child",
          bounds: { x: 0, y: 0, width: 80, height: 24 },
          meta: {
            source: "figma-paste",
            autoLayout: {
              widthMode: "fill_container",
              heightMode: "fixed",
            },
          },
        },
        {
          id: "child-absolute",
          type: "rectangle",
          parentId: "frame-fit",
          bounds: { x: 16, y: 16, width: 20, height: 20 },
          meta: {
            source: "figma-paste",
            autoLayout: {
              positioning: "absolute",
            },
          },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const frame = findNode(inserted.doc, "frame-fit") as
      | (PenNode & {
          layout?: string;
          layoutConstraints?: PenNode["layoutConstraints"];
        })
      | undefined;
    const childFill = findNode(inserted.doc, "child-fill") as
      | (PenNode & { layoutConstraints?: PenNode["layoutConstraints"] })
      | undefined;
    const childAbsolute = findNode(inserted.doc, "child-absolute") as
      | (PenNode & { layoutConstraints?: PenNode["layoutConstraints"] })
      | undefined;

    expect(frame).toMatchObject({
      type: "frame",
      layout: "horizontal",
      layoutConstraints: {
        widthMode: "fit_content",
      },
    });
    expect(childFill).toMatchObject({
      layoutConstraints: {
        widthMode: "fill_container",
      },
    });
    expect(childAbsolute).toMatchObject({
      layoutConstraints: {
        positioning: "absolute",
      },
    });
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
    let doc = createEmptyDocument();
    const root = makeContainer("root");
    asTestNode(root, "root").x = 10;
    asTestNode(root, "root").y = 20;
    asTestNode(root, "root").width = 300;
    asTestNode(root, "root").height = 200;
    Object.assign(asTestNode(root, "root"), {
      layout: "vertical",
      gap: 10,
      padding: [12, 16],
      justifyContent: "center",
    });

    const titleNode = {
      id: "title",
      type: "text" as const,
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      content: "Title",
      fontSize: 16,
      layoutConstraints: {
        widthMode: "fill_container",
      },
    } as unknown as PenNode;
    const nested = makeContainer("nested", "root");
    asTestNode(nested, "nested").x = 0;
    asTestNode(nested, "nested").y = 0;
    asTestNode(nested, "nested").width = 100;
    asTestNode(nested, "nested").height = 40;
    Object.assign(asTestNode(nested, "nested"), {
      layout: "horizontal",
      gap: 8,
      padding: 8,
      alignItems: "center",
      layoutConstraints: {
        widthMode: "fill_container",
      },
    });

    const nestedLabel: PenNode = {
      id: "nested-label",
      type: "text",
      x: 0,
      y: 0,
      width: 60,
      height: 20,
      content: "Nested",
      fontSize: 14,
    };
    const nestedValue: PenNode = {
      id: "nested-value",
      type: "text" as const,
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      content: "Value",
      fontSize: 14,
      layoutConstraints: {
        grow: 1,
        heightMode: "fill_container",
      },
    } as unknown as PenNode;

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: titleNode,
      parentId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nested,
      parentId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedLabel,
      parentId: "nested",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedValue,
      parentId: "nested",
    });

    const next = applyImportedAutoLayout(doc, "root");

    expect(
      getNodeBounds(asTestNode(findNode(next, "title"), "node")),
    ).toMatchObject({
      x: 26,
      y: 85,
      width: 268,
      height: 20,
    });
    expect(
      getNodeBounds(asTestNode(findNode(next, "nested"), "node")),
    ).toMatchObject({
      x: 26,
      y: 115,
      width: 268,
      height: 40,
    });
    expect(
      getNodeBounds(asTestNode(findNode(next, "nested-label"), "node")),
    ).toMatchObject({
      x: 34,
      y: 125,
      width: 60,
      height: 20,
    });
    expect(
      getNodeBounds(asTestNode(findNode(next, "nested-value"), "node")),
    ).toMatchObject({
      x: 102,
      y: 123,
      width: 184,
      height: 24,
    });
  });

  it("keeps imported absolute-positioned children fixed during auto-layout reflow", () => {
    let doc = createEmptyDocument();
    const root = makeContainer("absolute-root");
    asTestNode(root, "root").x = 0;
    asTestNode(root, "root").y = 0;
    asTestNode(root, "root").width = 200;
    asTestNode(root, "root").height = 120;
    Object.assign(asTestNode(root, "root"), {
      layout: "horizontal",
      gap: 12,
      padding: 10,
    });

    const flowNode: PenNode = {
      id: "flow",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const absoluteNode: PenNode = {
      id: "absolute",
      type: "rectangle" as const,
      x: 77,
      y: 33,
      width: 30,
      height: 30,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
      layoutConstraints: {
        positioning: "absolute",
      },
    } as unknown as PenNode;

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: flowNode,
      parentId: "absolute-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: absoluteNode,
      parentId: "absolute-root",
    });

    const next = applyImportedAutoLayout(doc, "absolute-root");

    expect(
      getNodeBounds(asTestNode(findNode(next, "flow"), "node")),
    ).toMatchObject({
      x: 10,
      y: 10,
      width: 40,
      height: 20,
    });
    expect(
      getNodeBounds(asTestNode(findNode(next, "absolute"), "node")),
    ).toMatchObject({
      x: 77,
      y: 33,
      width: 30,
      height: 30,
    });
  });

  it("aligns imported horizontal auto-layout children by baseline", () => {
    let doc = createEmptyDocument();
    const root = {
      ...makeContainer("baseline-root"),
      x: 0,
      y: 0,
      width: 260,
      height: 80,
      layout: "horizontal",
      gap: 8,
      padding: 10,
      alignItems: "baseline",
    } as PenNode;
    const title: PenNode = {
      id: "baseline-title",
      type: "text",
      x: 0,
      y: 0,
      width: 70,
      height: 40,
      content: "Title",
      fontSize: 30,
    };
    const label: PenNode = {
      id: "baseline-label",
      type: "text",
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      content: "Label",
      fontSize: 10,
    };
    const icon: PenNode = {
      id: "baseline-icon",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: title,
      parentId: "baseline-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: label,
      parentId: "baseline-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: icon,
      parentId: "baseline-root",
    });

    const next = applyImportedAutoLayout(doc, "baseline-root");
    const nextTitle = findNode(next, "baseline-title");
    const nextLabel = findNode(next, "baseline-label");
    const nextIcon = findNode(next, "baseline-icon");
    if (!nextTitle || !nextLabel || !nextIcon) {
      throw new Error("Expected baseline auto-layout children to exist.");
    }

    expect(getNodeBounds(nextTitle)).toMatchObject({
      x: 10,
      y: 10,
      width: 70,
      height: 40,
    });
    expect(getNodeBounds(nextLabel)).toMatchObject({
      x: 88,
      y: 26,
      width: 50,
      height: 20,
    });
    expect(getNodeBounds(nextIcon)).toMatchObject({
      x: 146,
      y: 18,
      width: 16,
      height: 16,
    });
  });

  it("stretches imported auto-layout children from container cross-axis alignment", () => {
    let doc = createEmptyDocument();
    const root = {
      ...makeContainer("stretch-root"),
      x: 0,
      y: 0,
      width: 220,
      height: 90,
      layout: "horizontal",
      gap: 10,
      padding: [12, 20],
      alignItems: "stretch",
    } as PenNode;
    const left: PenNode = {
      id: "stretch-left",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 18,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const right: PenNode = {
      id: "stretch-right",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 24,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: left,
      parentId: "stretch-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: right,
      parentId: "stretch-root",
    });

    const next = applyImportedAutoLayout(doc, "stretch-root");
    const nextLeft = findNode(next, "stretch-left");
    const nextRight = findNode(next, "stretch-right");
    if (!nextLeft || !nextRight) {
      throw new Error("Expected stretched auto-layout children to exist.");
    }

    expect(getNodeBounds(nextLeft)).toMatchObject({
      x: 20,
      y: 12,
      width: 40,
      height: 66,
    });
    expect(getNodeBounds(nextRight)).toMatchObject({
      x: 70,
      y: 12,
      width: 50,
      height: 66,
    });
  });

  it("distributes remaining main-axis space to imported fill-container children", () => {
    let doc = createEmptyDocument();
    const root = {
      ...makeContainer("fill-root"),
      x: 0,
      y: 0,
      width: 300,
      height: 80,
      layout: "horizontal",
      gap: 10,
      padding: 20,
    } as PenNode;

    const fixedNode: PenNode = {
      id: "fixed",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const fillNodeA = {
      id: "fill-a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 30,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
      layoutConstraints: {
        widthMode: "fill_container",
      },
    } as PenNode;
    const fillNodeB = {
      id: "fill-b",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 30,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
      layoutConstraints: {
        widthMode: "fill_container",
      },
    } as PenNode;

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: fixedNode,
      parentId: "fill-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: fillNodeA,
      parentId: "fill-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: fillNodeB,
      parentId: "fill-root",
    });

    const next = applyImportedAutoLayout(doc, "fill-root");

    const fixed = findNode(next, "fixed");
    const nextFillA = findNode(next, "fill-a");
    const nextFillB = findNode(next, "fill-b");
    if (!fixed || !nextFillA || !nextFillB) {
      throw new Error("Expected imported auto-layout children to exist.");
    }

    expect(getNodeBounds(fixed)).toMatchObject({
      x: 20,
      y: 20,
      width: 50,
      height: 20,
    });
    expect(getNodeBounds(nextFillA)).toMatchObject({
      x: 80,
      y: 20,
      width: 95,
      height: 20,
    });
    expect(getNodeBounds(nextFillB)).toMatchObject({
      x: 185,
      y: 20,
      width: 95,
      height: 20,
    });
  });

  it("resizes imported hug auto-layout containers around flow children", () => {
    let doc = createEmptyDocument();
    const root = {
      ...makeContainer("hug-root"),
      x: 0,
      y: 0,
      width: 300,
      height: 100,
      layout: "horizontal",
      gap: 10,
      padding: [8, 12],
      justifyContent: "center",
      layoutConstraints: {
        widthMode: "fit_content",
        heightMode: "fit_content",
      },
    } as PenNode;
    const left: PenNode = {
      id: "hug-left",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const right: PenNode = {
      id: "hug-right",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 60,
      height: 30,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: left,
      parentId: "hug-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: right,
      parentId: "hug-root",
    });

    const next = applyImportedAutoLayout(doc, "hug-root");
    const nextRoot = findNode(next, "hug-root");
    const nextLeft = findNode(next, "hug-left");
    const nextRight = findNode(next, "hug-right");
    if (!nextRoot || !nextLeft || !nextRight) {
      throw new Error("Expected hug auto-layout nodes to exist.");
    }

    expect(getNodeBounds(nextRoot)).toMatchObject({
      width: 134,
      height: 46,
    });
    expect(getNodeBounds(nextLeft)).toMatchObject({
      x: 12,
      y: 8,
      width: 40,
      height: 20,
    });
    expect(getNodeBounds(nextRight)).toMatchObject({
      x: 62,
      y: 8,
      width: 60,
      height: 30,
    });
  });

  it("propagates nested hug auto-layout sizes to parent containers in one reflow", () => {
    let doc = createEmptyDocument();
    const outer = {
      ...makeContainer("hug-outer"),
      x: 0,
      y: 0,
      width: 260,
      height: 140,
      layout: "horizontal",
      padding: 10,
      layoutConstraints: {
        widthMode: "fit_content",
        heightMode: "fit_content",
      },
    } as PenNode;
    const inner = {
      ...makeContainer("hug-inner"),
      x: 0,
      y: 0,
      width: 220,
      height: 100,
      layout: "horizontal",
      gap: 4,
      padding: 5,
      layoutConstraints: {
        widthMode: "fit_content",
        heightMode: "fit_content",
      },
    } as PenNode;
    const left: PenNode = {
      id: "nested-hug-left",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const right: PenNode = {
      id: "nested-hug-right",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 30,
      height: 12,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    doc = applyCanvasOperation(doc, { type: "insertNode", node: outer });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: inner,
      parentId: "hug-outer",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: left,
      parentId: "hug-inner",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: right,
      parentId: "hug-inner",
    });

    const next = applyImportedAutoLayout(doc, "hug-outer");
    const nextOuter = findNode(next, "hug-outer");
    const nextInner = findNode(next, "hug-inner");
    if (!nextOuter || !nextInner) {
      throw new Error("Expected nested hug auto-layout nodes to exist.");
    }

    expect(getNodeBounds(nextInner)).toMatchObject({
      x: 10,
      y: 10,
      width: 64,
      height: 22,
    });
    expect(getNodeBounds(nextOuter)).toMatchObject({
      width: 84,
      height: 42,
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

  it("preserves structured native Figma nested instance override path refs", () => {
    expect(
      mapFigmaNativeComponentRef({
        type: "INSTANCE",
        guid: { sessionID: 2, localID: 10 },
        componentKey: "button/component-key",
        size: { x: 120, y: 48 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        symbolData: {
          symbolID: { sessionID: 1, localID: 1 },
          symbolOverrides: [
            {
              guidPath: {
                guids: [
                  { sessionID: 4, localID: 20 },
                  { sessionID: 4, localID: 21 },
                ],
              },
              textData: { characters: "Nested label" },
              fontSize: 18,
            },
          ],
        },
      }),
    ).toMatchObject({
      source: "figma",
      type: "instance",
      id: "2:10",
      key: "button/component-key",
      componentId: "1:1",
      overrideCount: 1,
      overridePaths: ["4:20/4:21"],
      overrides: [
        {
          source: "figma",
          path: "4:20/4:21",
          pathIds: ["4:20", "4:21"],
          targetId: "4:21",
          properties: ["textData", "fontSize"],
          values: {
            textData: { characters: "Nested label" },
            fontSize: 18,
          },
        },
      ],
    });
  });
});
