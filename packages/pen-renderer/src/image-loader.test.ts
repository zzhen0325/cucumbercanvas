import { describe, expect, it } from "vitest";
import { chooseImageLodSize, createImageCacheKey } from "./image-loader.js";

describe("createImageCacheKey", () => {
  it("keeps normal URLs unchanged", () => {
    const url = "https://example.com/assets/photo.png";
    expect(createImageCacheKey(url)).toBe(url);
  });

  it("shortens base64 data URLs without retaining the payload", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const cacheKey = createImageCacheKey(dataUrl);

    expect(cacheKey).toMatch(/^data-url:image\/png:\d+:[a-z0-9]+$/);
    expect(cacheKey).not.toContain("iVBORw0KGgoAAAANS");
    expect(cacheKey.length).toBeLessThan(dataUrl.length);
  });

  it("generates different keys for different base64 payloads", () => {
    expect(createImageCacheKey("data:image/png;base64,AAAA")).not.toBe(
      createImageCacheKey("data:image/png;base64,AAAB"),
    );
  });
});

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
