import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";

import {
  STICKY_NOTE_PLACEHOLDER_TEXT,
  createStickyNoteNode,
  deriveStickyStrokeColor,
  findStickyNoteTextNode,
  getSelectableStickyHitNode,
  getStickyConnectorPoint,
  normalizeStickyNotesInDocument,
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
    expect((sticky as PenNode & { clipContent?: boolean }).clipContent).toBe(
      false,
    );
    expect(sticky.containerRole).toEqual(["context"]);
    expect(text?.meta).toMatchObject({
      stickyRole: "body",
      selectable: false,
      placeholder: STICKY_NOTE_PLACEHOLDER_TEXT,
    });
    expect((text as { content?: string } | null)?.content).toBe("");
  });

  it("derives sticky stroke color from the background color", () => {
    expect(deriveStickyStrokeColor("#FFE59A")).toBe("rgba(143,128,86,0.24)");
    expect(deriveStickyStrokeColor("rgb(100,150,200)")).toBe(
      "rgba(56,84,112,0.24)",
    );
  });

  it("normalizes legacy sticky placeholder text into empty content", () => {
    const sticky = createStickyNoteNode({
      x: 40,
      y: 60,
      width: 220,
      height: 200,
    }) as PenNode & { children?: PenNode[] };
    const text = findStickyNoteTextNode(sticky);
    if (!text) throw new Error("Sticky note text node was not created.");
    sticky.children = sticky.children?.map((child) =>
      child.id === text.id
        ? ({ ...child, content: STICKY_NOTE_PLACEHOLDER_TEXT } as PenNode)
        : child,
    );
    const doc: CucumberCanvasDocument = {
      version: "1.0",
      activePageId: "page-1",
      children: [],
      pages: [{ id: "page-1", name: "Page 1", children: [sticky] }],
    };

    const normalized = normalizeStickyNotesInDocument(doc);
    const normalizedSticky = normalized.pages?.[0]?.children[0];
    if (!normalizedSticky) {
      throw new Error("Normalized sticky note was not created.");
    }
    const normalizedText = findStickyNoteTextNode(normalizedSticky);

    expect((normalizedText as { content?: string } | null)?.content).toBe("");
    expect(normalizedText?.meta).toMatchObject({
      placeholder: STICKY_NOTE_PLACEHOLDER_TEXT,
      selectable: false,
      stickyRole: "body",
    });
  });

  it("maps sticky descendants back to the sticky container", () => {
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

  it("treats non-body children as part of the sticky note object", () => {
    const sticky = createStickyNoteNode({
      x: 40,
      y: 60,
      width: 220,
      height: 200,
    });
    const child = {
      id: "nested-shape",
      type: "rectangle",
      name: "Nested shape",
      x: 24,
      y: 32,
      width: 40,
      height: 40,
      fill: [{ type: "solid", color: "#111827" }],
    } as PenNode;
    const stickyFrame = sticky as PenNode & { children?: PenNode[] };
    stickyFrame.children = [...(stickyFrame.children ?? []), child];
    const doc: CucumberCanvasDocument = {
      version: "1.0",
      activePageId: "page-1",
      children: [],
      pages: [{ id: "page-1", name: "Page 1", children: [sticky] }],
    };

    expect(getSelectableStickyHitNode(doc, child, "page-1")?.id).toBe(
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
