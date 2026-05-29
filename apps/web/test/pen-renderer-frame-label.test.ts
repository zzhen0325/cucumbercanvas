import { describe, expect, it } from "vitest";

import {
  getFrameLabelBounds,
  isFrameLabelPointHit,
} from "../../../packages/pen-renderer/src/renderer";

describe("pen renderer frame label bounds", () => {
  it("keeps the label above the frame and stable in screen pixels", () => {
    const bounds = getFrameLabelBounds("画板 1", 100, 200, 2, 1);

    expect(bounds.left).toBe(100);
    expect(bounds.bottom).toBe(197);
    expect(bounds.top).toBeLessThan(bounds.bottom);
    expect((bounds.bottom - bounds.top) * 2).toBe(21);
  });

  it("allocates enough width for CJK labels", () => {
    const cjk = getFrameLabelBounds("画板", 0, 0, 1, 1);
    const ascii = getFrameLabelBounds("AB", 0, 0, 1, 1);

    expect(cjk.right - cjk.left).toBeGreaterThan(ascii.right - ascii.left);
  });

  it("treats clicks on the label as frame label hits", () => {
    const bounds = getFrameLabelBounds("Board", 120, 80, 1, 1);

    expect(isFrameLabelPointHit(122, bounds.top + 1, bounds, 1)).toBe(true);
    expect(
      isFrameLabelPointHit(bounds.right + 8, bounds.top + 1, bounds, 1),
    ).toBe(false);
  });
});
