import { describe, expect, it } from "vitest";
import {
  getAngularGradientSweepAngles,
  getClosedShapeStrokeAlignPlan,
  getDiamondGradientUniforms,
  getImageFillShaderMatrix,
  getImageObjectFitDrawRect,
  getInnerShadowStrokeWidth,
  getLinearGradientEndpoints,
  getRectIndependentStrokeSides,
  getRoundedRectCornerControlFactor,
  getShadowExpandedBounds,
  getVisibleBackdropBlurEffects,
  getVisibleBlurEffects,
  getVisibleFillLayers,
  getVisibleLayerBlurEffects,
  getVisibleStrokePaintLayers,
  normalizeRoundedRectRadii,
  shouldUseRoundLineCapFallback,
  toCanvasKitNodeTransform,
} from "./node-renderer.js";

describe("getVisibleBlurEffects", () => {
  it("keeps all visible blur layers in Figma effect order", () => {
    const effects = getVisibleBlurEffects([
      {
        type: "background_blur",
        radius: 12,
        opacity: 0.5,
        blendMode: "screen",
      },
      {
        type: "shadow",
        offsetX: 0,
        offsetY: 2,
        blur: 8,
        spread: 0,
        color: "#000000",
      },
      {
        type: "blur",
        radius: 4,
        visible: false,
      },
      {
        type: "blur",
        radius: 6,
        blendMode: "multiply",
      },
    ]);

    expect(effects).toEqual([
      {
        type: "background_blur",
        radius: 12,
        opacity: 0.5,
        blendMode: "screen",
      },
      {
        type: "blur",
        radius: 6,
        blendMode: "multiply",
      },
    ]);
  });

  it("separates backdrop blur from layer blur for renderer saveLayer routing", () => {
    const effects = [
      {
        type: "background_blur" as const,
        radius: 12,
        opacity: 0.5,
        blendMode: "screen" as const,
      },
      {
        type: "blur" as const,
        radius: 6,
        blendMode: "multiply" as const,
      },
      {
        type: "background_blur" as const,
        radius: 0,
      },
    ];

    expect(getVisibleBackdropBlurEffects(effects)).toEqual([
      {
        type: "background_blur",
        radius: 12,
        opacity: 0.5,
        blendMode: "screen",
      },
    ]);
    expect(getVisibleLayerBlurEffects(effects)).toEqual([
      {
        type: "blur",
        radius: 6,
        blendMode: "multiply",
      },
    ]);
  });
});

describe("getVisibleFillLayers", () => {
  it("keeps visible fill layers in bottom-to-top drawing order", () => {
    const layers = getVisibleFillLayers([
      { type: "solid", color: "#ff0000", opacity: 0.5, blendMode: "screen" },
      { type: "solid", color: "#00ff00", visible: false },
      { type: "solid", color: "#0000ff", opacity: 0 },
      { type: "solid", color: "#ffffff", blendMode: "multiply" },
    ]);

    expect(layers).toEqual([
      { type: "solid", color: "#ffffff", blendMode: "multiply" },
      { type: "solid", color: "#ff0000", opacity: 0.5, blendMode: "screen" },
    ]);
  });

  it("returns a transparent fallback only for stroke/container geometry", () => {
    expect(getVisibleFillLayers(undefined)).toEqual([]);
    expect(
      getVisibleFillLayers(undefined, {
        thickness: 1,
        fill: [{ type: "solid", color: "#111111" }],
      }),
    ).toEqual(["transparent"]);
    expect(getVisibleFillLayers(undefined, undefined, true)).toEqual([
      "transparent",
    ]);
  });
});

describe("getVisibleStrokePaintLayers", () => {
  it("keeps visible stroke paint layers in bottom-to-top drawing order", () => {
    expect(
      getVisibleStrokePaintLayers({
        thickness: 2,
        fill: [
          { type: "solid", color: "#ff0000", opacity: 0.5 },
          { type: "solid", color: "#00ff00", visible: false },
          { type: "solid", color: "#0000ff", opacity: 0 },
          {
            type: "linear_gradient",
            angle: 90,
            stops: [
              { offset: 0, color: "#111111" },
              { offset: 1, color: "#ffffff" },
            ],
            blendMode: "multiply",
          },
        ],
      }),
    ).toEqual([
      {
        type: "linear_gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#111111" },
          { offset: 1, color: "#ffffff" },
        ],
        blendMode: "multiply",
      },
      { type: "solid", color: "#ff0000", opacity: 0.5 },
    ]);
  });

  it("does not synthesize a stroke layer from hidden retained paint metadata", () => {
    expect(
      getVisibleStrokePaintLayers({
        thickness: 2,
        fill: [{ type: "solid", color: "#ff0000", visible: false }],
      }),
    ).toEqual([]);
    expect(
      getVisibleStrokePaintLayers({
        thickness: 0,
        fill: [{ type: "solid", color: "#ff0000" }],
      }),
    ).toEqual([]);
  });
});

describe("getAngularGradientSweepAngles", () => {
  it("maps Figma/CSS gradient angles to CanvasKit sweep angles", () => {
    expect(getAngularGradientSweepAngles(0)).toEqual({
      startAngle: -90,
      endAngle: 270,
    });
    expect(getAngularGradientSweepAngles(90)).toEqual({
      startAngle: 0,
      endAngle: 360,
    });
  });
});

describe("getLinearGradientEndpoints", () => {
  it("uses preserved Figma gradient handle coordinates when present", () => {
    expect(
      getLinearGradientEndpoints(
        {
          type: "linear_gradient",
          x1: 0.1,
          y1: 0.4,
          x2: 0.9,
          y2: 0.6,
          angle: 76,
          stops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
        { x: 10, y: 20, w: 100, h: 50 },
      ),
    ).toEqual({
      x1: 20,
      y1: 40,
      x2: 100,
      y2: 50,
    });
  });
});

describe("getDiamondGradientUniforms", () => {
  it("packs center, radius, angle, stop positions, and colors for the shader", () => {
    const uniforms = getDiamondGradientUniforms(
      {
        type: "diamond_gradient",
        cx: 0.25,
        cy: 0.75,
        radius: 0.4,
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 0.5, color: "#ffffff" },
        ],
      },
      { x: 10, y: 20, w: 200, h: 100 },
      [Float32Array.of(0, 0, 0, 1), Float32Array.of(1, 1, 1, 0.5)],
    );

    expect(uniforms).toHaveLength(46);
    expect(uniforms.slice(0, 6)).toEqual([60, 95, 80, 40, 0, 2]);
    expect(uniforms.slice(6, 14)).toEqual([0, 0.5, 1, 1, 1, 1, 1, 1]);
    expect(uniforms.slice(14, 22)).toEqual([0, 0, 0, 1, 1, 1, 1, 0.5]);
  });
});

describe("toCanvasKitNodeTransform", () => {
  it("returns null when the preserved matrix is already represented by x/y", () => {
    expect(
      toCanvasKitNodeTransform(
        {
          id: "identity",
          x: 10,
          y: 20,
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
        },
        10,
        20,
      ),
    ).toBeNull();
  });

  it("converts a preserved Figma matrix without double-applying x/y", () => {
    expect(
      toCanvasKitNodeTransform(
        {
          id: "matrix",
          x: 10,
          y: 20,
          transform: {
            m00: 2,
            m01: 0.5,
            m02: 100,
            m10: 0.25,
            m11: 1.5,
            m12: 200,
          },
        },
        10,
        20,
      ),
    ).toEqual([2, 0.5, 70, 0.25, 1.5, 167.5, 0, 0, 1]);
  });
});

describe("getImageObjectFitDrawRect", () => {
  it("stretches image nodes to the authored bounds without preserving aspect ratio", () => {
    expect(
      getImageObjectFitDrawRect("stretch", 200, 100, {
        x: 10,
        y: 20,
        w: 80,
        h: 80,
      }),
    ).toEqual({ x: 10, y: 20, w: 80, h: 80 });
  });

  it("keeps existing fit and crop image node semantics explicit", () => {
    expect(
      getImageObjectFitDrawRect("fit", 200, 100, {
        x: 10,
        y: 20,
        w: 80,
        h: 80,
      }),
    ).toEqual({ x: 10, y: 40, w: 80, h: 40 });
    expect(
      getImageObjectFitDrawRect("crop", 200, 100, {
        x: 10,
        y: 20,
        w: 80,
        h: 80,
      }),
    ).toEqual({ x: -30, y: 20, w: 160, h: 80 });
  });
});

describe("getImageFillShaderMatrix", () => {
  it("maps stretch image fills from stroke bounds into image coordinates", () => {
    expect(
      getImageFillShaderMatrix({ mode: "stretch" }, 200, 100, {
        x: 10,
        y: 20,
        w: 50,
        h: 25,
      }),
    ).toEqual({
      matrix: [4, 0, -40, 0, 4, -80, 0, 0, 1],
      tile: "clamp",
    });
  });

  it("maps cropped image fills through the preserved image transform", () => {
    expect(
      getImageFillShaderMatrix(
        {
          mode: "crop",
          transform: {
            m00: 0.5,
            m01: 0,
            m02: 0.25,
            m10: 0,
            m11: 0.5,
            m12: 0.1,
          },
        },
        400,
        200,
        { x: 10, y: 20, w: 100, h: 50 },
      ),
    ).toEqual({
      matrix: [2, 0, 80, 0, 2, -20, 0, 0, 1],
      tile: "clamp",
    });
  });

  it("maps skewed image fill transforms through the preserved crop matrix", () => {
    expect(
      getImageFillShaderMatrix(
        {
          mode: "crop",
          transform: {
            m00: 0.5,
            m01: 0.1,
            m02: 0.25,
            m10: 0.2,
            m11: 0.5,
            m12: 0.1,
          },
        },
        400,
        200,
        { x: 10, y: 20, w: 100, h: 50 },
      ),
    ).toEqual({
      matrix: [2, 0.8, 64, 0.4, 2, -24.000000000000004, 0, 0, 1],
      tile: "clamp",
    });
  });

  it("keeps transformed tile fills repeatable while honoring their matrix", () => {
    expect(
      getImageFillShaderMatrix(
        {
          mode: "tile",
          transform: {
            m00: 1,
            m01: 0,
            m02: 0.1,
            m10: 0,
            m11: 1,
            m12: 0.2,
          },
        },
        20,
        10,
        { x: 10, y: 20, w: 100, h: 50 },
      ),
    ).toEqual({
      matrix: [0.2, 0, 0, 0, 0.2, -2, 0, 0, 1],
      tile: "repeat",
    });
  });

  it("uses repeated image coordinates for tile fills", () => {
    expect(
      getImageFillShaderMatrix({ mode: "tile" }, 20, 10, {
        x: 10,
        y: 20,
        w: 100,
        h: 50,
      }),
    ).toEqual({
      matrix: [1, 0, -50, 0, 1, -40, 0, 0, 1],
      tile: "repeat",
    });
  });
});

describe("getClosedShapeStrokeAlignPlan", () => {
  it("expands inside and outside closed-shape strokes for clipping", () => {
    expect(getClosedShapeStrokeAlignPlan("inside")).toEqual({
      widthScale: 2,
      clip: "inside",
    });
    expect(getClosedShapeStrokeAlignPlan("outside")).toEqual({
      widthScale: 2,
      clip: "outside",
    });
    expect(getClosedShapeStrokeAlignPlan("center")).toEqual({
      widthScale: 1,
      clip: "none",
    });
    expect(getClosedShapeStrokeAlignPlan(undefined)).toEqual({
      widthScale: 1,
      clip: "none",
    });
  });
});

describe("getRectIndependentStrokeSides", () => {
  it("keeps independent border widths and shortens rounded sides by corner radii", () => {
    expect(
      getRectIndependentStrokeSides(
        { x: 10, y: 20, w: 100, h: 60 },
        [1, 2, 3, 4],
        "inside",
        [8, 10, 12, 14],
      ),
    ).toEqual([
      { side: "top", thickness: 1, x1: 18, y1: 20.5, x2: 100, y2: 20.5 },
      { side: "right", thickness: 2, x1: 109, y1: 30, x2: 109, y2: 68 },
      { side: "bottom", thickness: 3, x1: 98, y1: 78.5, x2: 24, y2: 78.5 },
      { side: "left", thickness: 4, x1: 12, y1: 66, x2: 12, y2: 28 },
    ]);
  });

  it("places outside independent borders outward from the rect bounds", () => {
    expect(
      getRectIndependentStrokeSides(
        { x: 0, y: 0, w: 20, h: 10 },
        [2, 4, 6, 8],
        "outside",
      ),
    ).toEqual([
      { side: "top", thickness: 2, x1: 0, y1: -1, x2: 20, y2: -1 },
      { side: "right", thickness: 4, x1: 22, y1: 0, x2: 22, y2: 10 },
      { side: "bottom", thickness: 6, x1: 20, y1: 13, x2: 0, y2: 13 },
      { side: "left", thickness: 8, x1: -4, y1: 10, x2: -4, y2: 0 },
    ]);
  });
});

describe("shouldUseRoundLineCapFallback", () => {
  it("keeps imported Figma lines with unspecified caps as butt caps", () => {
    expect(
      shouldUseRoundLineCapFallback({
        stroke: {
          thickness: 2,
          fill: [{ type: "solid", color: "#000000" }],
        },
        meta: { source: "figma-paste" },
      }),
    ).toBe(false);
  });

  it("preserves the legacy round fallback for non-Figma lines", () => {
    expect(
      shouldUseRoundLineCapFallback({
        stroke: {
          thickness: 2,
          fill: [{ type: "solid", color: "#000000" }],
        },
      }),
    ).toBe(true);
    expect(
      shouldUseRoundLineCapFallback({
        stroke: {
          thickness: 2,
          cap: "square",
          fill: [{ type: "solid", color: "#000000" }],
        },
      }),
    ).toBe(false);
  });
});

describe("getShadowExpandedBounds", () => {
  it("applies offset and spread to Figma drop-shadow geometry", () => {
    expect(
      getShadowExpandedBounds(
        { x: 10, y: 20, w: 100, h: 50 },
        { offsetX: 4, offsetY: -2, spread: 6 },
      ),
    ).toEqual({ x: 8, y: 12, w: 112, h: 62 });
  });

  it("shrinks shadow geometry for negative Figma spread values", () => {
    expect(
      getShadowExpandedBounds(
        { x: 10, y: 20, w: 100, h: 50 },
        { offsetX: 4, offsetY: 2, spread: -8 },
      ),
    ).toEqual({ x: 22, y: 30, w: 84, h: 34 });
  });

  it("clamps very negative shadow spread before dimensions invert", () => {
    expect(
      getShadowExpandedBounds(
        { x: 10, y: 20, w: 100, h: 50 },
        { offsetX: 0, offsetY: 0, spread: -80 },
      ),
    ).toEqual({ x: 60, y: 45, w: 0, h: 0 });
  });
});

describe("getInnerShadowStrokeWidth", () => {
  it("uses blur plus positive spread to approximate Figma inner shadow reach", () => {
    expect(getInnerShadowStrokeWidth({ blur: 8, spread: 3 })).toBe(14);
  });

  it("never creates an invalid or negative inner shadow stroke width", () => {
    expect(getInnerShadowStrokeWidth({ blur: 0, spread: 0 })).toBe(1);
    expect(getInnerShadowStrokeWidth({ blur: 10, spread: -3 })).toBe(4);
    expect(getInnerShadowStrokeWidth({ blur: 4, spread: -12 })).toBe(1);
  });
});

describe("rounded rectangle corner helpers", () => {
  it("preserves independent corner radii when they fit the rect bounds", () => {
    expect(normalizeRoundedRectRadii([4, 8, 12, 16], 100, 80)).toEqual([
      4, 8, 12, 16,
    ]);
  });

  it("scales independent corner radii when adjacent corners exceed bounds", () => {
    expect(normalizeRoundedRectRadii([80, 80, 20, 20], 100, 100)).toEqual([
      50, 50, 12.5, 12.5,
    ]);
  });

  it("maps Figma corner smoothing into a larger cubic control factor", () => {
    expect(getRoundedRectCornerControlFactor(0)).toBeCloseTo(0.55228475, 6);
    expect(getRoundedRectCornerControlFactor(1)).toBeGreaterThan(
      getRoundedRectCornerControlFactor(0),
    );
  });
});
