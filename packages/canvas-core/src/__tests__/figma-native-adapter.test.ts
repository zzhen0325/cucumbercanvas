import { figmaClipboardToNodes } from "@cucumber/pen-figma";
import type { PenNode } from "@cucumber/pen-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEmptyDocument,
  findNode,
  insertCanvasImportResult,
  parseClipboardImport,
} from "../index.js";

vi.mock("@cucumber/pen-figma", () => ({
  figmaClipboardToNodes: vi.fn(),
}));

const figmaClipboardToNodesMock = vi.mocked(figmaClipboardToNodes);

function makeFigmaClipboardHtml(): string {
  const meta = btoa(JSON.stringify({ source: "figma" }));
  const buffer = btoa(String.fromCharCode(1, 2, 3, 4));
  return `<!--(figmeta)-->${meta}<!--(figmeta)--><!--(figma)-->${buffer}<!--(figma)-->`;
}

describe("figma native pen-figma adapter", () => {
  beforeEach(() => {
    figmaClipboardToNodesMock.mockReset();
  });

  it("delegates native clipboard decoding to pen-figma and preserves recursive geometry", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const root: PenNode = {
      id: "fig-root",
      type: "frame",
      name: "Imported frame",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      layout: "horizontal",
      children: [
        {
          id: "fig-title",
          type: "text",
          name: "Title",
          x: 24,
          y: 36,
          width: 80,
          height: 24,
          content: "Styled title",
          fontFamily: "Inter",
          fontSize: 18,
          fontWeight: 700,
          fill: [{ type: "solid", color: "#111111" }],
        },
        {
          id: "fig-image",
          type: "image",
          name: "Image",
          x: 120,
          y: 36,
          width: 32,
          height: 32,
          src: dataUrl,
        },
      ],
    };
    figmaClipboardToNodesMock.mockReturnValue({
      nodes: [root],
      warnings: ["image fallback warning"],
    });

    const result = parseClipboardImport({ html: makeFigmaClipboardHtml() });

    expect(figmaClipboardToNodesMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.stringContaining("figmeta"),
    );
    expect(result?.source).toBe("figma");
    expect(result?.rootNodeIds).toEqual(["fig-root"]);
    expect(result?.assets).toHaveLength(1);
    expect(result?.warnings[0]?.message).toBe("image fallback warning");

    const parsedRoot = result?.nodes[0] as
      | (PenNode & { meta?: Record<string, unknown>; children?: PenNode[] })
      | undefined;
    const parsedChild = parsedRoot?.children?.[0] as
      | (PenNode & { meta?: Record<string, unknown> })
      | undefined;
    expect(parsedRoot?.meta).toMatchObject({
      source: "figma-paste",
      originNodeType: "figma-native",
      importSourceLabel: "Figma",
    });
    expect(parsedRoot?.meta?.importSessionId).toEqual(expect.any(String));
    expect(parsedChild?.meta?.source).toBe("figma-paste");

    if (!result) {
      throw new Error("Expected Figma clipboard payload to parse.");
    }

    const inserted = insertCanvasImportResult(createEmptyDocument(), result, {
      offsetX: 100,
      offsetY: 50,
    });

    expect(findNode(inserted.doc, "fig-root")).toMatchObject({
      x: 110,
      y: 70,
      width: 200,
      height: 100,
    });
    expect(findNode(inserted.doc, "fig-title")).toMatchObject({
      x: 24,
      y: 36,
      fontSize: 18,
      fontWeight: 700,
    });
    expect(findNode(inserted.doc, "fig-image")).toMatchObject({
      x: 120,
      y: 36,
      src: dataUrl,
    });
  });
});
