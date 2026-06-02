import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";

import { getPrimarySelectedContainerId } from "@/components/canvas/canvas-selection-helpers";

describe("canvas-selection-helpers", () => {
  it("does not use sticky notes as selected insertion containers", () => {
    const sticky = {
      id: "sticky-1",
      type: "frame",
      name: "Sticky",
      x: 0,
      y: 0,
      width: 220,
      height: 200,
      meta: { boardKind: "sticky" },
      children: [
        {
          id: "sticky-child",
          type: "rectangle",
          x: 20,
          y: 20,
          width: 40,
          height: 40,
        } as PenNode,
      ],
    } as PenNode;
    const doc: CucumberCanvasDocument = {
      version: "1.0",
      activePageId: "page-1",
      children: [],
      pages: [{ id: "page-1", name: "Page 1", children: [sticky] }],
    };

    expect(
      getPrimarySelectedContainerId(doc, ["sticky-1"], "page-1"),
    ).toBeNull();
    expect(
      getPrimarySelectedContainerId(doc, ["sticky-child"], "page-1"),
    ).toBeNull();
  });
});
