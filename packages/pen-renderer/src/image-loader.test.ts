import { describe, expect, it } from "vitest";
import { chooseImageLodSize } from "./image-loader.js";

describe("chooseImageLodSize", () => {
  it("uses smaller variants during viewport and transform interactions", () => {
    expect(
      chooseImageLodSize({
        targetWidth: 1600,
        targetHeight: 1200,
        zoom: 1,
        interactionMode: "transform",
      }),
    ).toBe(1024);
    expect(
      chooseImageLodSize({
        targetWidth: 600,
        targetHeight: 400,
        zoom: 1,
        interactionMode: "viewport",
      }),
    ).toBe(512);
  });

  it("selects sharper variants when idle", () => {
    expect(
      chooseImageLodSize({
        targetWidth: 400,
        targetHeight: 300,
        zoom: 1,
        interactionMode: "idle",
      }),
    ).toBe(512);
    expect(
      chooseImageLodSize({
        targetWidth: 900,
        targetHeight: 600,
        zoom: 1,
        interactionMode: "idle",
      }),
    ).toBe(1024);
    expect(
      chooseImageLodSize({
        targetWidth: 1600,
        targetHeight: 1200,
        zoom: 1,
        interactionMode: "idle",
      }),
    ).toBe(2048);
  });
});
