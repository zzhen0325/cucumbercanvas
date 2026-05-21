// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { buildCanvasAgentContext } from "../src/lib/canvas-context";

describe("buildCanvasAgentContext", () => {
  it("captures viewport, selected cards, nearby cards, and relations", () => {
    const result = buildCanvasAgentContext({
      appState: {
        scrollX: -100,
        scrollY: -200,
        width: 1000,
        height: 600,
        zoom: { value: 2 },
      },
      elements: [
        {
          id: "text-1",
          type: "text",
          text: "Selected headline",
          x: 120,
          y: 220,
          width: 240,
          height: 60,
        },
        {
          id: "image-1",
          type: "image",
          fileId: "file-1",
          x: 420,
          y: 220,
          width: 320,
          height: 180,
        },
        {
          id: "arrow-1",
          type: "arrow",
          x: 360,
          y: 250,
          width: 60,
          height: 20,
          startBinding: { elementId: "text-1" },
          endBinding: { elementId: "image-1" },
        },
        {
          id: "far-1",
          type: "rectangle",
          x: 5000,
          y: 5000,
          width: 200,
          height: 120,
        },
      ],
      files: {
        "file-1": {
          dataURL: "data:image/png;base64,abc",
          mimeType: "image/png",
        },
      },
      persistedFiles: {
        "file-1": {
          storageUrl: "https://example.com/image.png",
        },
      },
      selectedElements: [
        {
          id: "text-1",
          type: "text",
          text: "Selected headline",
          x: 120,
          y: 220,
          width: 240,
          height: 60,
        },
      ],
    });

    expect(result.viewport).toEqual({
      x: 100,
      y: 200,
      zoom: 2,
      width: 500,
      height: 300,
    });
    expect(result.selectedCards).toMatchObject([
      { kind: "text", elementId: "text-1" },
    ]);
    expect(result.nearbyCards.map((card) => card.elementId)).toContain(
      "image-1",
    );
    expect(result.nearbyCards.map((card) => card.elementId)).not.toContain(
      "far-1",
    );
    expect(result.cardRelations).toContainEqual({
      type: "arrow",
      sourceId: "text-1",
      targetId: "image-1",
      ids: ["arrow-1"],
    });
    expect(result.canvasSummary).toContain("Canvas has 4 visible elements");
  });
});
