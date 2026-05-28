import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  SpatialIndex,
  getHittableBounds,
  hasVisibleEffects,
  hasVisibleFill,
  hasVisibleStroke,
  resolveColorAlpha,
  resolveStrokeOutset,
} from "./spatial-index.js";
import type { RenderNode } from "./types.js";

function renderNode(node: PenNode): RenderNode {
  const width =
    "width" in node && typeof node.width === "number" ? node.width : 0;
  const height =
    "height" in node && typeof node.height === "number" ? node.height : 0;
  return {
    node,
    absX: node.x ?? 0,
    absY: node.y ?? 0,
    absW: width,
    absH: height,
  };
}

describe("SpatialIndex Figma paint/effect fidelity", () => {
  it("treats visible angular and diamond paint layers as hittable appearance", () => {
    expect(
      hasVisibleFill([
        { type: "solid", color: "#000000", visible: false },
        {
          type: "angular_gradient",
          stops: [
            { offset: 0, color: "#00000000" },
            { offset: 1, color: "#ff00ff" },
          ],
        },
      ]),
    ).toBe(true);

    expect(
      hasVisibleFill([
        {
          type: "diamond_gradient",
          opacity: 0,
          stops: [{ offset: 0, color: "#ff00ff" }],
        },
      ]),
    ).toBe(false);
  });

  it("keeps hidden paint layers editable without letting them create hit targets", () => {
    const index = new SpatialIndex();
    index.rebuild([
      renderNode({
        id: "hidden-fill-frame",
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: [{ type: "solid", color: "#ff0000", visible: false }],
        children: [],
      } as PenNode),
      renderNode({
        id: "visible-gradient-frame",
        type: "frame",
        x: 120,
        y: 0,
        width: 100,
        height: 100,
        fill: [
          {
            type: "diamond_gradient",
            stops: [
              { offset: 0, color: "#00000000" },
              { offset: 1, color: "#00ff00" },
            ],
          },
        ],
        children: [],
      } as PenNode),
    ]);

    expect(index.hitTest(10, 10).map((rn) => rn.node.id)).toEqual([]);
    expect(index.hitTest(130, 10).map((rn) => rn.node.id)).toEqual([
      "visible-gradient-frame",
    ]);
  });

  it("expands hit bounds for independent outside and center-aligned Figma strokes", () => {
    expect(
      resolveStrokeOutset({
        thickness: [2, 4, 6, 8],
        align: "outside",
        fill: [{ type: "solid", color: "#111111" }],
      }),
    ).toEqual({ top: 2, right: 4, bottom: 6, left: 8 });

    expect(
      resolveStrokeOutset({
        thickness: 10,
        align: "center",
        fill: [{ type: "solid", color: "#111111" }],
      }),
    ).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });

    const bounds = getHittableBounds(
      renderNode({
        id: "outside-border",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        stroke: {
          thickness: [2, 4, 6, 8],
          align: "outside",
          fill: [{ type: "solid", color: "#111111" }],
        },
      } as PenNode),
    );

    expect(bounds).toEqual({ minX: 2, minY: 18, maxX: 44, maxY: 66 });
  });

  it("counts visible strokes and effects using layer visibility and opacity", () => {
    expect(
      hasVisibleStroke({
        thickness: 1,
        fill: [
          { type: "solid", color: "#000000", visible: false },
          { type: "solid", color: "#00000000" },
        ],
      }),
    ).toBe(false);

    expect(
      hasVisibleEffects([
        {
          type: "shadow",
          offsetX: 3,
          offsetY: 4,
          blur: 8,
          spread: 1,
          color: "#000000",
          opacity: 0,
        },
        {
          type: "background_blur",
          radius: 12,
          visible: false,
        },
        {
          type: "blur",
          radius: 2,
        },
      ]),
    ).toBe(true);

    expect(resolveColorAlpha("rgba(1, 2, 3, 0.25)")).toBe(0.25);
  });
});
