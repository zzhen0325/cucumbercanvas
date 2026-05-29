import {
  figmaAllPagesToPenDocument,
  figmaClipboardToNodes,
  getFigmaPages,
  parseFigFile,
  resolveImageBlobs,
} from "@cucumber/pen-figma";
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
  figmaAllPagesToPenDocument: vi.fn(),
  getFigmaPages: vi.fn(() => []),
  parseFigFile: vi.fn(),
  resolveImageBlobs: vi.fn(() => 0),
}));

const figmaClipboardToNodesMock = vi.mocked(figmaClipboardToNodes);
const figmaAllPagesToPenDocumentMock = vi.mocked(figmaAllPagesToPenDocument);
const getFigmaPagesMock = vi.mocked(getFigmaPages);
const parseFigFileMock = vi.mocked(parseFigFile);
const resolveImageBlobsMock = vi.mocked(resolveImageBlobs);

function makeFigmaClipboardHtml(): string {
  const meta = btoa(JSON.stringify({ source: "figma" }));
  const buffer = btoa(String.fromCharCode(1, 2, 3, 4));
  return `<!--(figmeta)-->${meta}<!--(figmeta)--><!--(figma)-->${buffer}<!--(figma)-->`;
}

describe("figma native pen-figma adapter", () => {
  beforeEach(() => {
    figmaClipboardToNodesMock.mockReset();
    figmaAllPagesToPenDocumentMock.mockReset();
    getFigmaPagesMock.mockReset();
    getFigmaPagesMock.mockReturnValue([]);
    parseFigFileMock.mockReset();
    resolveImageBlobsMock.mockReset();
    resolveImageBlobsMock.mockReturnValue(0);
  });

  it("delegates native clipboard decoding to pen-figma and preserves recursive geometry", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const root: PenNode = {
      id: "fig-root",
      type: "frame",
      name: "Imported frame",
      x: 10,
      y: 20,
      transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
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
          transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 36 },
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
      styleDefinitions: {
        "44:8": {
          source: "figma",
          id: "44:8",
          name: "Text / Title",
          type: "text",
          text: {
            fontFamily: "Inter",
            fontSize: 18,
            fontWeight: 700,
          },
        },
      },
    });

    const result = parseClipboardImport({ html: makeFigmaClipboardHtml() });

    expect(figmaClipboardToNodesMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.stringContaining("figmeta"),
    );
    expect(result?.source).toBe("figma");
    expect(result?.rootNodeIds).toEqual(["fig-root"]);
    expect(result?.assets).toHaveLength(1);
    expect(result?.styleDefinitions?.["44:8"]).toMatchObject({
      source: "figma",
      name: "Text / Title",
    });
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
    expect(inserted.doc.styleDefinitions?.["44:8"]).toMatchObject({
      type: "text",
      text: {
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: 700,
      },
    });
  });

  it("imports multi-page .fig files as page groups and preserves unresolved image diagnostics", () => {
    const decoded = {
      nodeChanges: [{ type: "DOCUMENT" }],
      blobs: [],
      imageFiles: new Map(),
    };
    parseFigFileMock.mockReturnValue(decoded as never);
    getFigmaPagesMock.mockReturnValue([
      { id: "page-1", name: "Landing", childCount: 1 },
      { id: "page-2", name: "Components", childCount: 1 },
    ]);
    figmaAllPagesToPenDocumentMock.mockReturnValue({
      document: {
        version: "1",
        name: "sample.fig",
        children: [],
        styleDefinitions: {
          "77:1": {
            source: "figma",
            id: "77:1",
            name: "Brand / Hero fill",
            type: "fill",
            fill: [{ type: "solid", color: "#3366ff" }],
          },
        },
        pages: [
          {
            id: "figma-page-0",
            name: "Landing",
            children: [
              {
                id: "hero",
                type: "rectangle",
                x: 100,
                y: 200,
                width: 320,
                height: 180,
                fill: [
                  {
                    type: "image",
                    url: "__hash:missing",
                    mode: "stretch",
                  },
                ],
              },
            ],
          },
          {
            id: "figma-page-1",
            name: "Components",
            children: [
              {
                id: "button",
                type: "text",
                x: 20,
                y: 40,
                width: 100,
                height: 24,
                content: "Button",
              },
            ],
          },
        ],
      },
      warnings: ["Vector node converted as rectangle"],
      imageBlobs: new Map(),
    });

    const result = parseClipboardImport({
      files: [
        {
          type: "application/octet-stream",
          name: "sample.fig",
          arrayBuffer: new ArrayBuffer(4),
        },
      ],
    });

    expect(parseFigFileMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(figmaAllPagesToPenDocumentMock).toHaveBeenCalledWith(
      decoded,
      "sample.fig",
      "preserve",
    );
    expect(resolveImageBlobsMock).toHaveBeenCalled();
    expect(result?.source).toBe("figma");
    expect(result?.rootNodeIds).toHaveLength(2);
    expect(result?.styleDefinitions?.["77:1"]).toMatchObject({
      source: "figma",
      name: "Brand / Hero fill",
    });
    expect(result?.warnings.map((warning) => warning.message)).toEqual([
      "Vector node converted as rectangle",
      "Figma 文件中仍有 1 个图片引用缺少可解析的二进制内容，已保留诊断占位。",
    ]);

    const [landing, components] = result?.nodes as Array<
      PenNode & { children?: PenNode[]; meta?: Record<string, unknown> }
    >;
    expect(landing).toMatchObject({
      type: "group",
      name: "Landing",
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
    expect(landing?.children?.[0]).toMatchObject({
      id: "hero",
      x: 0,
      y: 0,
    });
    expect(components).toMatchObject({
      type: "group",
      name: "Components",
      x: 480,
      y: 0,
      width: 100,
      height: 24,
    });
    expect(landing?.meta).toMatchObject({
      source: "figma-paste",
      originNodeType: "figma-native",
      importSourceLabel: "Figma",
    });
    if (!result) {
      throw new Error("Expected Figma file import payload to parse.");
    }
    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    expect(inserted.doc.styleDefinitions?.["77:1"]).toMatchObject({
      type: "fill",
      fill: [{ type: "solid", color: "#3366ff" }],
    });
  });
});
