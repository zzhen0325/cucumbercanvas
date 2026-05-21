// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { fitMediaIntoPlacement } from "../src/lib/canvas-elements";

describe("fitMediaIntoPlacement", () => {
  it("preserves wide image aspect ratio inside a square placement box", () => {
    const result = fitMediaIntoPlacement(1920, 1080, {
      x: 100,
      y: 200,
      width: 400,
      height: 400,
    });

    expect(result).toEqual({
      x: 100,
      y: 288,
      width: 400,
      height: 225,
    });
  });

  it("preserves tall image aspect ratio inside a wide placement box", () => {
    const result = fitMediaIntoPlacement(1080, 1920, {
      x: 40,
      y: 60,
      width: 480,
      height: 240,
    });

    expect(result).toEqual({
      x: 213,
      y: 60,
      width: 135,
      height: 240,
    });
  });
});
