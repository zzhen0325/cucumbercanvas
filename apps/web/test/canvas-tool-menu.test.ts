import { describe, expect, it } from "vitest";

import {
  buildGeneratingOverlayKey,
  buildGeneratingOverlayState,
} from "../src/components/canvas-tool-menu";

describe("generating overlay positioning", () => {
  const imagePlaceholder = {
    id: "image-placeholder",
    x: 100,
    y: 200,
    width: 420,
    height: 240,
    customData: {
      type: "image-generator",
      status: "generating",
      model: "bytedance/seedream-4.6",
    },
  };

  const videoPlaceholder = {
    id: "video-placeholder",
    x: 640,
    y: 260,
    width: 480,
    height: 270,
    customData: {
      type: "video-generator",
      status: "generating",
      model: "bytedance/seedream-video",
    },
  };

  it("invalidates the cached overlay positions when the canvas viewport moves", () => {
    const firstKey = buildGeneratingOverlayKey([imagePlaceholder], {
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
    });
    const pannedKey = buildGeneratingOverlayKey([imagePlaceholder], {
      scrollX: -320,
      scrollY: 96,
      zoom: 1,
    });
    const zoomedKey = buildGeneratingOverlayKey([imagePlaceholder], {
      scrollX: 0,
      scrollY: 0,
      zoom: 0.75,
    });

    expect(pannedKey).not.toBe(firstKey);
    expect(zoomedKey).not.toBe(firstKey);
  });

  it("projects image and video generator overlays through the same viewport transform", () => {
    const overlays = buildGeneratingOverlayState(
      [imagePlaceholder, videoPlaceholder],
      {
        scrollX: -40,
        scrollY: 20,
        zoom: 0.5,
      },
    );

    expect(overlays).toEqual([
      {
        id: "image-placeholder",
        screenX: 30,
        screenY: 110,
        screenW: 210,
        screenH: 120,
        model: "bytedance/seedream-4.6",
      },
      {
        id: "video-placeholder",
        screenX: 300,
        screenY: 140,
        screenW: 240,
        screenH: 135,
        model: "bytedance/seedream-video",
      },
    ]);
  });
});
