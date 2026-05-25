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
});
