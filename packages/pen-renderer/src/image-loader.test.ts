import { describe, expect, it, vi } from "vitest";
import {
  SkiaImageLoader,
  chooseImageLodSize,
  createImageCacheKey,
} from "./image-loader.js";

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
    ).toBe(512);
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

describe("SkiaImageLoader LOD scheduling", () => {
  function fakeImage(size: number) {
    return {
      delete: vi.fn(),
      height: () => size,
      makeCopyWithDefaultMipmaps: () => fakeImage(size),
      width: () => size,
    };
  }

  it("generates LOD variants in separate timer slices after base image is drawable", () => {
    vi.useFakeTimers();
    try {
      const loader = new SkiaImageLoader({} as never);
      const internals = loader as unknown as {
        cache: Map<string, ReturnType<typeof fakeImage>>;
        htmlImageToSkia: ReturnType<typeof vi.fn>;
        lodCache: Map<string, Map<number, ReturnType<typeof fakeImage>>>;
        scheduleLodVariants: (
          cacheKey: string,
          image: HTMLImageElement,
          base: ReturnType<typeof fakeImage>,
        ) => void;
      };
      const base = fakeImage(2048);
      internals.cache.set("image", base);
      internals.htmlImageToSkia = vi.fn((_image, size: number) =>
        fakeImage(size),
      );

      internals.scheduleLodVariants(
        "image",
        { naturalHeight: 2048, naturalWidth: 2048 } as HTMLImageElement,
        base,
      );

      expect(internals.htmlImageToSkia).not.toHaveBeenCalled();
      expect(loader.pendingLodCount()).toBeGreaterThan(0);
      vi.advanceTimersByTime(16);
      expect(internals.htmlImageToSkia).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(16);
      expect(internals.htmlImageToSkia).toHaveBeenCalledTimes(2);
      expect(internals.lodCache.get("image")?.has(512)).toBe(true);
      expect(internals.lodCache.get("image")?.has(1024)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears queued LOD work on dispose", () => {
    vi.useFakeTimers();
    try {
      const loader = new SkiaImageLoader({} as never);
      const internals = loader as unknown as {
        cache: Map<string, ReturnType<typeof fakeImage>>;
        htmlImageToSkia: ReturnType<typeof vi.fn>;
        scheduleLodVariants: (
          cacheKey: string,
          image: HTMLImageElement,
          base: ReturnType<typeof fakeImage>,
        ) => void;
      };
      const base = fakeImage(2048);
      internals.cache.set("image", base);
      internals.htmlImageToSkia = vi.fn((_image, size: number) =>
        fakeImage(size),
      );
      internals.scheduleLodVariants(
        "image",
        { naturalHeight: 2048, naturalWidth: 2048 } as HTMLImageElement,
        base,
      );

      loader.dispose();
      vi.advanceTimersByTime(32);
      expect(internals.htmlImageToSkia).not.toHaveBeenCalled();
      expect(loader.pendingLodCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
