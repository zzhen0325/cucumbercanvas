// @ts-nocheck
import { describe, expect, it } from "vitest";
import { mapFigmaStroke } from "./figma-stroke-mapper.js";

describe("mapFigmaStroke", () => {
  it("preserves hidden stroke paint layers and per-side stroke weights", () => {
    const stroke = mapFigmaStroke({
      strokePaints: [
        {
          type: "SOLID",
          visible: false,
          opacity: 0.25,
          blendMode: "MULTIPLY",
          color: { r: 1, g: 0, b: 0, a: 1 },
        },
        {
          type: "GRADIENT_LINEAR",
          visible: true,
          blendMode: "SCREEN",
          stops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
          ],
        },
      ],
      borderStrokeWeightsIndependent: true,
      borderTopWeight: 1,
      borderRightWeight: 2,
      borderBottomWeight: 3,
      borderLeftWeight: 4,
      strokeAlign: "INSIDE",
      strokeJoin: "MITER",
      strokeCap: "ROUND",
      dashPattern: [8, 4],
      dashOffset: 2,
      strokeMiterLimit: 6,
    });

    expect(stroke).toEqual({
      thickness: [1, 2, 3, 4],
      align: "inside",
      join: "miter",
      cap: "round",
      dashPattern: [8, 4],
      dashOffset: 2,
      miterLimit: 6,
      fill: [
        {
          type: "solid",
          color: "#ff0000",
          opacity: 0.25,
          visible: false,
          blendMode: "multiply",
        },
        {
          type: "linear_gradient",
          angle: 0,
          stops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
          opacity: undefined,
          blendMode: "screen",
        },
      ],
    });
  });
});
