import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  applyTransformPreviewToRenderNodes,
  filterRenderNodesToViewport,
} from "./renderer.js";
import type { RenderNode } from "./types.js";

function rn(id: string, x: number, y: number, w = 100, h = 100): RenderNode {
  return {
    node: {
      id,
      type: "rectangle",
      x,
      y,
      width: w,
      height: h,
      fill: [{ type: "solid", color: "#111111" }],
    } as PenNode,
    absX: x,
    absY: y,
    absW: w,
    absH: h,
  };
}

describe("renderer performance helpers", () => {
  it("culls render nodes to viewport bounds while preserving render order", () => {
    const nodes = [
      rn("before", -400, 0),
      rn("visible-a", 10, 10),
      rn("visible-b", 90, 90),
      rn("after", 400, 0),
    ];

    expect(
      filterRenderNodesToViewport(nodes, {
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
      }).map((node) => node.node.id),
    ).toEqual(["visible-a", "visible-b"]);
  });

  it("applies transform previews without mutating base render nodes", () => {
    const nodes = [rn("frame", 20, 30), rn("child", 35, 45, 20, 20)];
    const previewed = applyTransformPreviewToRenderNodes(
      nodes,
      { kind: "move", nodeIds: ["frame"], dx: 40, dy: 25 },
      new Set(["frame", "child"]),
    );

    expect(
      previewed.map((node) => [node.node.id, node.absX, node.absY]),
    ).toEqual([
      ["frame", 60, 55],
      ["child", 75, 70],
    ]);
    expect(nodes.map((node) => [node.node.id, node.absX, node.absY])).toEqual([
      ["frame", 20, 30],
      ["child", 35, 45],
    ]);
  });
});
