import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
  analyzeDocumentExportWarnings,
  calculateDocumentBounds,
  calculateExportSize,
  exportDocumentImage,
} from "@/components/canvas/canvas-export";

async function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Blob read failed"));
    reader.readAsText(blob);
  });
}

const doc: CucumberCanvasDocument = {
  version: "cucumber-canvas-v1",
  children: [
    {
      id: "rect-a",
      type: "rectangle",
      x: 100,
      y: 200,
      width: 300,
      height: 120,
      fill: [{ type: "solid", color: "#d3f256" }],
    },
    {
      id: "rect-b",
      type: "rectangle",
      x: 700,
      y: 500,
      width: 100,
      height: 90,
      fill: [{ type: "solid", color: "#111827" }],
    },
  ],
};

const multiPageDoc: CucumberCanvasDocument = {
  version: "cucumber-canvas-v1",
  activePageId: "page-a",
  children: [],
  pages: [
    {
      id: "page-a",
      name: "Page A",
      children: [
        {
          id: "page-a-text",
          type: "text",
          x: 10,
          y: 20,
          width: 120,
          height: 40,
          content: "Page A only",
          fontSize: 16,
        },
      ],
    },
    {
      id: "page-b",
      name: "Page B",
      children: [
        {
          id: "page-b-text",
          type: "text",
          x: 300,
          y: 400,
          width: 160,
          height: 50,
          content: "Page B only",
          fontSize: 20,
        },
      ],
    },
  ],
};

describe("canvas export", () => {
  it("computes visible document bounds from node geometry", () => {
    expect(calculateDocumentBounds(doc)).toEqual({
      x: 100,
      y: 200,
      width: 700,
      height: 390,
    });
  });

  it("scales bounded exports without distorting aspect ratio", () => {
    expect(
      calculateExportSize({ x: 0, y: 0, width: 2000, height: 1000 }, 1000),
    ).toEqual({ width: 1000, height: 500, scale: 0.5 });
  });

  it("exports an explicit scene-space bounding box as the SVG viewport", async () => {
    const blob = await exportDocumentImage(doc, {
      bounds: { x: 100, y: 200, width: 300, height: 120 },
      maxWidthOrHeight: 1024,
      mimeType: "image/svg+xml",
    });
    const svg = await readBlobText(blob);

    expect(blob.type).toBe("image/svg+xml");
    expect(svg).toContain('width="300" height="120"');
    expect(svg).toContain('x="0" y="0" width="300" height="120"');
    expect(svg).toContain('x="600" y="300" width="100" height="90"');
  });

  it("calculates bounds from only the requested active page", () => {
    expect(calculateDocumentBounds(multiPageDoc, "page-b")).toEqual({
      x: 300,
      y: 400,
      width: 160,
      height: 50,
    });
  });

  it("exports only active page content when activePageId is provided", async () => {
    const blob = await exportDocumentImage(multiPageDoc, {
      activePageId: "page-b",
      mimeType: "image/svg+xml",
    });
    const svg = await readBlobText(blob);

    expect(svg).toContain("Page B only");
    expect(svg).not.toContain("Page A only");
    expect(svg).toContain('width="160" height="50"');
  });

  it("keeps explicit bounds while rendering only requested active page", async () => {
    const blob = await exportDocumentImage(multiPageDoc, {
      activePageId: "page-b",
      bounds: { x: 0, y: 0, width: 500, height: 500 },
      mimeType: "image/svg+xml",
    });
    const svg = await readBlobText(blob);

    expect(svg).toContain('width="500" height="500"');
    expect(svg).toContain('x="300" y="420"');
    expect(svg).toContain("Page B only");
    expect(svg).not.toContain("Page A only");
  });

  it("warns when unsupported node types are exported as rectangles", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "sticky-note-a",
          type: "sticky_note",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
        },
      ],
    } as unknown as CucumberCanvasDocument);

    expect(warnings).toEqual([
      {
        code: "unsupported-node-type",
        nodeId: "sticky-note-a",
        message:
          'Node "sticky-note-a" uses unsupported type "sticky_note" and will be exported as a rectangle.',
      },
    ]);
  });

  it("warns when canonical nodes do not have first-class SVG export support", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "video-a",
          type: "videoEmbed",
          x: 0,
          y: 0,
          src: "https://example.com/clip.mp4",
        },
      ],
    });

    expect(warnings).toEqual([
      {
        code: "unsupported-node-type",
        nodeId: "video-a",
        message:
          'Node "video-a" uses unsupported type "videoEmbed" and will be exported as a rectangle.',
      },
    ]);
  });

  it("warns when image nodes do not have a usable source", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "image-without-src",
          type: "image",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          src: "",
        },
      ],
    } as unknown as CucumberCanvasDocument);

    expect(warnings).toEqual([
      {
        code: "missing-image-source",
        nodeId: "image-without-src",
        message:
          'Image node "image-without-src" is missing a usable source and may not appear in the export.',
      },
    ]);
  });

  it("warns when image fills are degraded to shape fallback fills", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "rect-with-image-fill",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          fill: [
            {
              type: "image",
              url: "https://example.com/texture.png",
            },
          ],
        },
      ],
    });

    expect(warnings).toEqual([
      {
        code: "unsupported-image-fill",
        nodeId: "rect-with-image-fill",
        message:
          'Node "rect-with-image-fill" uses an image fill that is not preserved by SVG export and will be exported with a fallback fill.',
      },
    ]);
  });

  it("warns when gradient fills are degraded to fallback fills", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "rect-with-gradient-fill",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          fill: [
            {
              type: "linear_gradient",
              stops: [
                { color: "#0f172a", offset: 0 },
                { color: "#d3f256", offset: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as CucumberCanvasDocument);

    expect(warnings).toEqual([
      {
        code: "unsupported-gradient-fill",
        nodeId: "rect-with-gradient-fill",
        message:
          'Node "rect-with-gradient-fill" uses a gradient fill that is not preserved by SVG export and will be exported with a fallback fill.',
      },
    ]);
  });

  it("warns when rich text segments are flattened by SVG export", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "rich-text-a",
          type: "text",
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          content: [{ text: "Bold", fontWeight: 700 }, { text: " normal" }],
        },
      ],
    } as unknown as CucumberCanvasDocument);

    expect(warnings).toEqual([
      {
        code: "unsupported-rich-text",
        nodeId: "rich-text-a",
        message:
          'Text node "rich-text-a" uses rich text segments that are not preserved by SVG export and will be exported as plain text.',
      },
    ]);
  });

  it("limits export warnings to the requested active page", () => {
    const warnings = analyzeDocumentExportWarnings(multiPageDoc, {
      activePageId: "page-b",
    });

    expect(warnings).toEqual([]);
  });

  it("limits export warnings to the requested bounds", () => {
    const warnings = analyzeDocumentExportWarnings(
      {
        version: "cucumber-canvas-v1",
        children: [
          {
            id: "visible-gradient",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 120,
            height: 80,
            fill: [{ type: "linear_gradient" }],
          },
          {
            id: "outside-gradient",
            type: "rectangle",
            x: 500,
            y: 500,
            width: 120,
            height: 80,
            fill: [{ type: "linear_gradient" }],
          },
        ],
      } as unknown as CucumberCanvasDocument,
      { bounds: { x: 0, y: 0, width: 200, height: 200 } },
    );

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "unsupported-gradient-fill",
        nodeId: "visible-gradient",
      }),
    ]);
  });

  it("does not warn for supported text, rectangle, and image nodes", () => {
    const warnings = analyzeDocumentExportWarnings({
      version: "cucumber-canvas-v1",
      children: [
        {
          id: "text-a",
          type: "text",
          x: 0,
          y: 0,
          width: 120,
          height: 40,
          content: "Ready",
        },
        {
          id: "rect-a",
          type: "rectangle",
          x: 150,
          y: 0,
          width: 120,
          height: 80,
        },
        {
          id: "image-a",
          type: "image",
          x: 300,
          y: 0,
          width: 120,
          height: 80,
          src: "https://example.com/asset.png",
        },
      ],
    } as unknown as CucumberCanvasDocument);

    expect(warnings).toEqual([]);
  });
});
