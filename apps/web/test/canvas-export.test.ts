import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
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
});
