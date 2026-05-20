// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { normalizeCanvasElements } from "../src/lib/canvas-normalize";

describe("normalizeCanvasElements", () => {
  it("replaces Excalidraw hand-drawn defaults with production canvas styling", () => {
    const elements = [
      {
        id: "text-1",
        type: "text",
        text: "Legacy text",
        fontFamily: 1,
        fontSize: 20,
        width: 100,
        height: 25,
        roughness: 2,
        fillStyle: "hachure",
      },
      {
        id: "arrow-1",
        type: "arrow",
        roughness: 1,
        strokeStyle: "dashed",
        strokeSharpness: "round",
        fillStyle: "cross-hatch",
      },
    ];

    const result = normalizeCanvasElements(elements);

    expect(result.changed).toBe(true);
    expect(result.elements[0]).toMatchObject({
      fontFamily: 2,
      roughness: 0,
      fillStyle: "solid",
    });
    expect(result.elements[1]).toMatchObject({
      roughness: 0,
      strokeStyle: "solid",
      strokeSharpness: "sharp",
      fillStyle: "solid",
    });
  });

  it("assigns sans-serif font to text elements without an explicit font family", () => {
    const elements = [
      {
        id: "text-2",
        type: "text",
        text: "Imported text",
        fontSize: 18,
        width: 120,
        height: 24,
      },
    ];

    const result = normalizeCanvasElements(elements);

    expect(result.changed).toBe(true);
    expect(result.elements[0]?.fontFamily).toBe(2);
  });
});
