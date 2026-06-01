import type { LineNode, PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  applyTransformPreviewToRenderNodes,
  filterRenderNodesToViewport,
  filterRenderNodesToViewportWithTransformPreview,
  getViewportInteractionCacheBuildDecision,
  getViewportInteractionCacheDrawOffset,
  isViewportInteractionCacheReusable,
} from "./renderer.js";
import { RenderNodeViewportIndex } from "./spatial-index.js";
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

  it("queries viewport index in render order without dropping locked nodes", () => {
    const locked = rn("locked-visible", 10, 10);
    const nodes = [
      rn("before", -400, 0),
      locked,
      rn("visible-b", 90, 90),
      rn("after", 400, 0),
    ];
    locked.node = { ...locked.node, locked: true } as PenNode;
    const index = new RenderNodeViewportIndex();
    index.rebuild(nodes);

    expect(
      index
        .search({ left: 0, top: 0, right: 200, bottom: 200 })
        .map((node) => node.node.id),
    ).toEqual(["locked-visible", "visible-b"]);
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

  it("previews attached connector endpoints while a container moves", () => {
    const connector: RenderNode = {
      node: {
        id: "connector",
        type: "line",
        x: 118,
        y: 40,
        x2: 220,
        y2: 40,
        connector: {
          start: { nodeId: "sticky", side: "right", ratio: 0.5 },
          end: { nodeId: "target", side: "left", ratio: 0.5 },
          routing: "smooth",
        },
      } as LineNode,
      absX: 118,
      absY: 40,
      absW: 102,
      absH: 1,
    };

    const [previewed] = applyTransformPreviewToRenderNodes(
      [connector],
      { kind: "move", nodeIds: ["sticky"], dx: 50, dy: 20 },
      new Set(["sticky", "connector"]),
    );

    expect(previewed?.node).toMatchObject({
      x: 168,
      y: 60,
      x2: 220,
      y2: 40,
    });
    expect(previewed?.absX).toBe(168);
    expect(previewed?.absY).toBe(40);
    expect(previewed?.absW).toBe(52);
    expect(previewed?.absH).toBe(20);
    expect((connector.node as LineNode).x).toBe(118);
  });

  it("filters transform previews without cloning non-preview render nodes", () => {
    const nodes = [rn("static", 10, 10), rn("moving", -400, 0)];
    const visible = filterRenderNodesToViewportWithTransformPreview(
      nodes,
      { left: 0, top: 0, right: 200, bottom: 200 },
      { kind: "move", nodeIds: ["moving"], dx: 420, dy: 20 },
      new Set(["moving"]),
    );

    expect(visible).toHaveLength(2);
    expect(visible[0]).toBe(nodes[0]);
    expect(visible[1]?.node.id).toBe("moving");
    expect(visible[1]).not.toBe(nodes[1]);
    expect(nodes[1]?.absX).toBe(-400);
  });

  it("reuses viewport interaction cache inside pan padding", () => {
    const cache = {
      key: "scene|canvas|zoom",
      zoom: 0.25,
      panX: 100,
      panY: 50,
      paddingX: 256,
      paddingY: 256,
    };

    expect(
      isViewportInteractionCacheReusable(cache, {
        key: "scene|canvas|zoom",
        zoom: 0.25,
        panX: 220,
        panY: -20,
      }),
    ).toBe(true);
    expect(
      getViewportInteractionCacheDrawOffset(cache, {
        zoom: 0.25,
        panX: 220,
        panY: -20,
        dpr: 2,
      }),
    ).toEqual({ x: -272, y: -652, reused: true });
  });

  it("rejects viewport interaction cache after zoom changes or padding is exceeded", () => {
    const cache = {
      key: "scene|canvas|zoom",
      zoom: 0.25,
      panX: 0,
      panY: 0,
      paddingX: 128,
      paddingY: 128,
    };

    expect(
      isViewportInteractionCacheReusable(cache, {
        key: "scene|canvas|zoom",
        zoom: 0.5,
        panX: 0,
        panY: 0,
      }),
    ).toBe(false);
    expect(
      isViewportInteractionCacheReusable(cache, {
        key: "scene|canvas|zoom",
        zoom: 0.25,
        panX: 129,
        panY: 0,
      }),
    ).toBe(false);
    expect(
      getViewportInteractionCacheDrawOffset(cache, {
        zoom: 0.25,
        panX: 129,
        panY: 0,
        dpr: 2,
      }),
    ).toBeNull();
  });

  it("skips building viewport interaction cache for small image sets or pending LODs", () => {
    expect(
      getViewportInteractionCacheBuildDecision({
        imageCount: 3,
        nodeCount: 13,
        pendingImageCount: 0,
      }),
    ).toEqual({ reason: "below_threshold", shouldBuild: false });
    expect(
      getViewportInteractionCacheBuildDecision({
        imageCount: 8,
        nodeCount: 13,
        pendingImageCount: 1,
      }),
    ).toEqual({ reason: "lod_pending", shouldBuild: false });
    expect(
      getViewportInteractionCacheBuildDecision({
        imageCount: 8,
        nodeCount: 13,
        pendingImageCount: 0,
      }),
    ).toEqual({ reason: "ready", shouldBuild: true });
  });
});
