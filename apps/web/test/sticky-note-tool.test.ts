import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
  createStickyNoteNode,
  findStickyNoteTextNode,
  getSelectableStickyHitNode,
  getStickyConnectorPoint,
} from "@/components/canvas/sticky-note-tool";

describe("sticky-note-tool", () => {
  it("creates sticky notes as container nodes with encapsulated body text", () => {
    const sticky = createStickyNoteNode({
      x: 40,
      y: 60,
      width: 220,
      height: 200,
    });
    const text = findStickyNoteTextNode(sticky);

    expect(sticky.meta).toMatchObject({
      boardKind: "sticky",
      containerType: "sticky_note",
      selectionMode: "container",
    });
    expect(sticky.containerRole).toEqual(["context"]);
    expect(text?.meta).toMatchObject({
      stickyRole: "body",
      selectable: false,
    });
  });

  it("maps sticky body text hits back to the sticky container", () => {
    const sticky = createStickyNoteNode({
      x: 40,
      y: 60,
      width: 220,
      height: 200,
    });
    const text = findStickyNoteTextNode(sticky);
    if (!text) throw new Error("Sticky note text node was not created.");
    const doc: CucumberCanvasDocument = {
      version: "1.0",
      activePageId: "page-1",
      children: [],
      pages: [{ id: "page-1", name: "Page 1", children: [sticky] }],
    };

    expect(getSelectableStickyHitNode(doc, text, "page-1")?.id).toBe(sticky.id);
    expect(getSelectableStickyHitNode(doc, sticky, "page-1")?.id).toBe(
      sticky.id,
    );
  });

  it("uses sticky blue dots as connector endpoint points", () => {
    const sticky = createStickyNoteNode({
      x: 40,
      y: 60,
      width: 220,
      height: 200,
    });

    expect(
      getStickyConnectorPoint(
        { x: 40, y: 60, width: 220, height: 200 },
        "right",
        sticky,
      ),
    ).toEqual({ x: 278, y: 160 });
  });
});
