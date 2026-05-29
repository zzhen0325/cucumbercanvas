// @ts-nocheck
import { describe, expect, it } from "vitest";
import { flattenToRenderNodes } from "./document-flattener.js";
import { toCanvasKitNodeTransform } from "./node-renderer.js";

describe("flattenToRenderNodes mask layers", () => {
  it("isolates translucent group opacity instead of multiplying every child", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "group",
        type: "group",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 0.5,
        children: [
          {
            id: "child",
            type: "rectangle",
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            opacity: 0.8,
          },
        ],
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual(["group", "child"]);
    expect(renderNodes[0].inheritedOpacity).toBe(1);
    expect(renderNodes[0].renderOpacity).toBe(1);
    expect(renderNodes[0].opacityGroup).toEqual({ opacity: 0.5, depth: 0 });
    expect(renderNodes[1].inheritedOpacity).toBe(1);
    expect(renderNodes[1].renderOpacity).toBeUndefined();
    expect(renderNodes[1].opacityGroup).toBeUndefined();
  });

  it("still applies leaf opacity directly when there is no child group to isolate", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "leaf",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        opacity: 0.5,
      },
    ]);

    expect(renderNodes[0].inheritedOpacity).toBe(1);
    expect(renderNodes[0].renderOpacity).toBeUndefined();
    expect(renderNodes[0].opacityGroup).toBeUndefined();
  });

  it("uses a mask layer as a clip for later sibling layers", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "top",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
      {
        id: "mask",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 40,
        height: 30,
        cornerRadius: 8,
        mask: { enabled: true, type: "alpha" },
      },
      {
        id: "bottom",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 120,
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual(["bottom", "top"]);
    expect(renderNodes[0].clipRect).toBeUndefined();
    expect(renderNodes[1].clipRect).toMatchObject({
      x: 10,
      y: 20,
      w: 40,
      h: 30,
      rx: 8,
      source: "mask",
      maskShape: {
        absX: 10,
        absY: 20,
        absW: 40,
        absH: 30,
        node: expect.objectContaining({ id: "mask" }),
      },
    });
  });

  it("preserves four-corner frame clip radii and smoothing for children", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "frame",
        type: "frame",
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        clipContent: true,
        cornerRadius: [4, 12, 20, 8],
        cornerSmoothing: 0.6,
        children: [
          {
            id: "child",
            type: "rectangle",
            x: -10,
            y: -10,
            width: 60,
            height: 60,
          },
        ],
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual(["frame", "child"]);
    expect(renderNodes[1].clipRect).toMatchObject({
      x: 10,
      y: 20,
      w: 120,
      h: 80,
      rx: 4,
      cornerRadius: [4, 12, 20, 8],
      cornerSmoothing: 0.6,
      source: "frame",
    });
  });

  it("aligns normalized Figma preserve-mode children with their frame clip", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "figma-frame",
        type: "frame",
        x: 300,
        y: 100,
        width: 560,
        height: 1080,
        clipContent: true,
        transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 100 },
        children: [
          {
            id: "figma-child",
            type: "rectangle",
            x: 20,
            y: 40,
            width: 72,
            height: 816,
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 40 },
          },
        ],
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual([
      "figma-frame",
      "figma-child",
    ]);
    expect(renderNodes[1]).toMatchObject({
      absX: 320,
      absY: 140,
      clipRect: {
        x: 300,
        y: 100,
        w: 560,
        h: 1080,
        source: "frame",
      },
    });
  });

  it("keeps Figma-like transform translation from shifting rendered children", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "figma-frame",
        type: "frame",
        x: 300,
        y: 100,
        width: 560,
        height: 1080,
        clipContent: true,
        children: [
          {
            id: "local-transform-child",
            type: "rectangle",
            x: 20,
            y: 40,
            width: 72,
            height: 120,
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 40 },
          },
          {
            id: "scene-transform-child",
            type: "rectangle",
            x: 120,
            y: 40,
            width: 72,
            height: 120,
            transform: { m00: 1, m01: 0, m02: 420, m10: 0, m11: 1, m12: 140 },
          },
        ],
      },
    ]);

    const localChild = renderNodes.find(
      (rn) => rn.node.id === "local-transform-child",
    );
    const sceneChild = renderNodes.find(
      (rn) => rn.node.id === "scene-transform-child",
    );

    expect(localChild).toMatchObject({ absX: 320, absY: 140 });
    expect(sceneChild).toMatchObject({ absX: 420, absY: 140 });
    expect(
      localChild
        ? toCanvasKitNodeTransform(
            localChild.node,
            localChild.absX,
            localChild.absY,
          )
        : "missing",
    ).toBeNull();
    expect(
      sceneChild
        ? toCanvasKitNodeTransform(
            sceneChild.node,
            sceneChild.absX,
            sceneChild.absY,
          )
        : "missing",
    ).toBeNull();
  });

  it("carries alpha mask opacity from mask layer opacity and fill alpha", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "masked",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
      {
        id: "alpha-mask",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        opacity: 0.5,
        fill: [{ type: "solid", color: "#00000080" }],
        mask: { enabled: true, type: "alpha" },
      },
    ]);

    expect(renderNodes).toHaveLength(1);
    expect(renderNodes[0].clipRect).toMatchObject({
      source: "mask",
      maskType: "alpha",
    });
    expect(renderNodes[0].clipRect?.maskOpacity).toBeCloseTo(0.25, 2);
  });

  it("keeps vector masks shape-only even when the mask layer is translucent", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "masked",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
      {
        id: "vector-mask",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        opacity: 0.2,
        fill: [{ type: "solid", color: "#00000040" }],
        mask: { enabled: true, type: "vector" },
      },
    ]);

    expect(renderNodes[0].clipRect).toMatchObject({
      source: "mask",
      maskType: "vector",
    });
    expect(renderNodes[0].clipRect?.maskOpacity).toBeUndefined();
  });

  it("uses explicit mask source references as editable clip sources", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "masked",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        mask: { sourceNodeId: "source-mask", type: "alpha" },
      },
      {
        id: "source-mask",
        type: "ellipse",
        x: 10,
        y: 20,
        width: 40,
        height: 30,
        opacity: 0.5,
        fill: [{ type: "solid", color: "#00000080" }],
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual([
      "source-mask",
      "masked",
    ]);
    expect(renderNodes[1].clipRect).toMatchObject({
      x: 10,
      y: 20,
      w: 40,
      h: 30,
      source: "mask",
      maskType: "alpha",
      maskShape: {
        absX: 10,
        absY: 20,
        absW: 40,
        absH: 30,
        node: expect.objectContaining({ id: "source-mask" }),
      },
    });
    expect(renderNodes[1].clipRect?.maskOpacity).toBeCloseTo(0.25, 2);
  });

  it("lets shouldBreakMaskChain clear the active sibling mask", () => {
    const renderNodes = flattenToRenderNodes([
      {
        id: "after-break",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        mask: { shouldBreakMaskChain: true },
      },
      {
        id: "masked",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      },
      {
        id: "mask",
        type: "rectangle",
        x: 5,
        y: 5,
        width: 10,
        height: 10,
        mask: { enabled: true, type: "vector" },
      },
    ]);

    expect(renderNodes.map((rn) => rn.node.id)).toEqual([
      "masked",
      "after-break",
    ]);
    expect(renderNodes[0].clipRect).toMatchObject({ source: "mask" });
    expect(renderNodes[0].clipRect?.maskShape?.node.id).toBe("mask");
    expect(renderNodes[1].clipRect).toBeUndefined();
  });
});
