import { describe, expect, it } from "vitest";

import {
  type CanvasNode,
  type ContainerNode,
  applyCanvasOperation,
  buildAgentContext,
  createCanvasNodeId,
  createEmptyCanvasDocument,
  resolveContext,
} from "../index.js";

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
});
