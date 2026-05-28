// @ts-nocheck
import { describe, expect, it } from "vitest";
import { mapFigmaEffects } from "./figma-effect-mapper.js";

describe("mapFigmaEffects", () => {
  it("preserves ordered effect layers with visibility opacity and blend mode", () => {
    const effects = mapFigmaEffects([
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
});
