import type { LineNode, PenDocument, PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  applyCanvasOperation,
  applyCanvasTransaction,
  connectorPointForBounds,
  findConnectorSnapTarget,
} from "../index.js";

function doc(children: PenNode[]): PenDocument {
  return {
    version: "test",
    activePageId: "page-1",
    children: [],
    pages: [{ id: "page-1", name: "Page 1", children }],
  };
}

function frame(id: string, x: number, y: number): PenNode {
  return {
    id,
    type: "frame",
    name: id,
    x,
    y,
    width: 100,
    height: 80,
    children: [],
  } as PenNode;
}

function connector(): LineNode {
  return {
    id: "connector-1",
    type: "line",
    x: 100,
    y: 40,
    x2: 220,
    y2: 40,
    connector: {
      start: { nodeId: "a", side: "right", ratio: 0.5 },
      end: { nodeId: "b", side: "left", ratio: 0.5 },
      routing: "smooth",
      arrow: true,
    },
    stroke: {
      thickness: 3,
      endTip: "line-arrow",
      fill: [{ type: "solid", color: "#111827" }],
    },
  };
}

describe("connector geometry", () => {
  it("computes side points from bounds", () => {
    expect(
      connectorPointForBounds(
        { x: 10, y: 20, width: 100, height: 80 },
        "right",
        0.25,
      ),
    ).toEqual({ x: 110, y: 40 });
  });

  it("finds the nearest attach side", () => {
    const snap = findConnectorSnapTarget(doc([frame("a", 10, 20)]), {
      x: 112,
      y: 56,
    });

    expect(snap?.nodeId).toBe("a");
    expect(snap?.side).toBe("right");
    expect(snap?.ratio).toBeCloseTo(0.45, 2);
  });

  it("refreshes connector endpoints after a container moves", () => {
    const next = applyCanvasOperation(
      doc([frame("a", 0, 0), frame("b", 220, 0), connector()]),
      {
        type: "updateNode",
        nodeId: "b",
        updates: { x: 320 },
        activePageId: "page-1",
      },
    );

    const line = next.pages?.[0]?.children.find(
      (node) => node.id === "connector-1",
    ) as LineNode | undefined;
    expect(line?.x2).toBe(320);
    expect(line?.y2).toBe(40);
  });

  it("removes connectors attached to deleted containers", () => {
    const next = applyCanvasTransaction(
      doc([frame("a", 0, 0), frame("b", 220, 0), connector()]),
      [{ type: "deleteNode", nodeId: "a", activePageId: "page-1" }],
      { activePageId: "page-1" },
    ).doc;

    expect(
      next.pages?.[0]?.children.some((node) => node.id === "connector-1"),
    ).toBe(false);
  });
});
