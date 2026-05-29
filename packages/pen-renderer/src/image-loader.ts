import type { CanvasKit, Image as SkImage } from "canvaskit-wasm";

const MAX_IMAGE_DIMENSION = 2048;
const IMAGE_LOD_SIZES = [512, 1024, 2048] as const;
const DATA_URL_CACHE_KEY_PREFIX = "data-url:";
const DATA_URL_HASH_SEED = 0x811c9dc5;

export interface ResolvedImageSource {
  cacheKey: string;
  loadUrl: string | null;
}

export interface ImageLoadStatus {
  state: "loading" | "loaded" | "missing" | "error";
}

export interface ImageDisplayRequest {
  targetWidth: number;
  targetHeight: number;
  zoom: number;
  devicePixelRatio?: number;
  interactionMode?: "idle" | "viewport" | "transform";
}

/**
 * Async image loader for CanvasKit. Loads images via browser's native Image
 * element (supports all browser-supported formats), rasterizes to Canvas 2D,
 * then converts to CanvasKit Image for GPU rendering.
 */
export class SkiaImageLoader {
  private ck: CanvasKit;
  private cache = new Map<string, SkImage | null>();
  private lodCache = new Map<string, Map<number, SkImage>>();
  private loading = new Set<string>();
  /** In-flight load promises (separate from `loading` URL set, used for flushPending) */
  private pendingPromises = new Set<Promise<unknown>>();
  private status = new Map<string, ImageLoadStatus>();
  private onLoaded: (() => void) | null = null;
  private sourceResolver: (src: string) => ResolvedImageSource = (src) => ({
    cacheKey: createImageCacheKey(src),
    loadUrl: src,
  });

  constructor(ck: CanvasKit) {
    this.ck = ck;
  }

  /** Set callback to trigger re-render when an image finishes loading. */
  setOnLoaded(cb: () => void) {
    this.onLoaded = cb;
  }

  setSourceResolver(resolver: (src: string) => ResolvedImageSource) {
    this.sourceResolver = resolver;
  }

  /** Get a cached image, or null if not loaded / failed. Returns undefined if not yet requested. */
  get(src: string): SkImage | null | undefined {
    const resolved = this.sourceResolver(src);
    return this.cache.get(resolved.cacheKey);
  }

  getForDisplay(
    src: string,
    request: ImageDisplayRequest,
  ): SkImage | null | undefined {
    const resolved = this.sourceResolver(src);
    const cached = this.cache.get(resolved.cacheKey);
    if (cached === undefined || cached === null) return cached;
    const lodSize = chooseImageLodSize(request);
    return this.lodCache.get(resolved.cacheKey)?.get(lodSize) ?? cached;
  }

  getStatus(src: string): ImageLoadStatus | undefined {
    const resolved = this.sourceResolver(src);
    return this.status.get(resolved.cacheKey);
  }

  /** Start loading an image if not already cached or in progress. */
  request(src: string) {
    const resolved = this.sourceResolver(src);
    if (
      this.cache.has(resolved.cacheKey) ||
      this.loading.has(resolved.cacheKey)
    )
      return;

    if (!resolved.loadUrl) {
      this.cache.set(resolved.cacheKey, null);
      this.status.set(resolved.cacheKey, { state: "missing" });
      this.onLoaded?.();
      return;
    }

    this.loading.add(resolved.cacheKey);
    this.status.set(resolved.cacheKey, { state: "loading" });
    const pending = this.loadAsync(resolved);
    this.pendingPromises.add(pending);
    pending.finally(() => this.pendingPromises.delete(pending));
  }

  /** Number of in-flight image load promises. */
  pendingCount(): number {
    return this.pendingPromises.size;
  }

  /**
   * Wait for every currently pending image load to settle.
   * Used by SkiaEngine.waitForSettled to coordinate readback timing.
   */
  async flushPending(): Promise<void> {
    const snapshot = Array.from(this.pendingPromises);
    await Promise.all(snapshot.map((p) => p.catch(() => undefined)));
  }

  dispose() {
    const deleted = new Set<SkImage>();
    for (const img of this.cache.values()) {
      if (img && !deleted.has(img)) {
        img.delete();
        deleted.add(img);
      }
    }
    for (const variants of this.lodCache.values()) {
      for (const img of variants.values()) {
        if (!deleted.has(img)) {
          img.delete();
          deleted.add(img);
        }
      }
    }
    this.cache.clear();
    this.lodCache.clear();
    this.loading.clear();
    this.pendingPromises.clear();
    this.status.clear();
  }

  private async loadAsync(source: ResolvedImageSource) {
    try {
      if (!source.loadUrl) {
        throw new Error(`Image source ${source.cacheKey} has no load URL`);
      }
      // Use browser Image element — supports all browser-supported formats
      const htmlImg = await this.loadHtmlImage(source.loadUrl);
      const skImg = this.htmlImageToSkia(htmlImg, MAX_IMAGE_DIMENSION);
      this.cache.set(source.cacheKey, skImg);
      if (skImg) this.createLodVariants(source.cacheKey, htmlImg, skImg);
      this.loading.delete(source.cacheKey);
      this.status.set(source.cacheKey, { state: skImg ? "loaded" : "error" });
      this.onLoaded?.();
    } catch (e) {
      console.warn("Failed to load image:", source.loadUrl?.slice(0, 80), e);
      this.cache.set(source.cacheKey, null);
      this.loading.delete(source.cacheKey);
      this.status.set(source.cacheKey, { state: "error" });
      this.onLoaded?.();
    }
  }

  private loadHtmlImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:\/\//i.test(src)) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Image load failed: ${e}`));
      img.src = src;
    });
  }

  /** Rasterize an HTML Image to Canvas 2D, then convert to CanvasKit Image. */
  private htmlImageToSkia(
    htmlImg: HTMLImageElement,
    maxDimension: number,
  ): SkImage | null {
    const sourceW = htmlImg.naturalWidth || htmlImg.width;
    const sourceH = htmlImg.naturalHeight || htmlImg.height;
    if (sourceW <= 0 || sourceH <= 0) return null;

    const { width, height, scale } = this.getSafeRasterSize(
      sourceW,
      sourceH,
      maxDimension,
    );
    if (scale < 1 && maxDimension === MAX_IMAGE_DIMENSION) {
      console.info("[pen-renderer] image-loader.downscaled", {
        sourceWidth: sourceW,
        sourceHeight: sourceH,
        rasterWidth: width,
        rasterHeight: height,
        maxDimension,
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = width !== sourceW || height !== sourceH;
    ctx.drawImage(htmlImg, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    return (
      this.ck.MakeImage(
        {
          width,
          height,
          alphaType: this.ck.AlphaType.Unpremul,
          colorType: this.ck.ColorType.RGBA_8888,
          colorSpace: this.ck.ColorSpace.SRGB,
        },
        imageData.data,
        width * 4,
      ) ?? null
    );
  }

  private createLodVariants(
    cacheKey: string,
    htmlImg: HTMLImageElement,
    baseImage: SkImage,
  ) {
    const sourceW = htmlImg.naturalWidth || htmlImg.width;
    const sourceH = htmlImg.naturalHeight || htmlImg.height;
    const variants = new Map<number, SkImage>();
    const baseMax = Math.max(baseImage.width(), baseImage.height());

    for (const lodSize of IMAGE_LOD_SIZES) {
      if (lodSize >= baseMax) {
        variants.set(lodSize, baseImage);
        continue;
      }
      const variant = this.htmlImageToSkia(htmlImg, lodSize);
      if (!variant) continue;
      variants.set(lodSize, variant);
      console.info("[pen-renderer] image-loader.variant.created", {
        cacheKey,
        sourceWidth: sourceW,
        sourceHeight: sourceH,
        lodSize,
        rasterWidth: variant.width(),
        rasterHeight: variant.height(),
      });
    }

    this.lodCache.set(cacheKey, variants);
  }

  private getSafeRasterSize(
    sourceW: number,
    sourceH: number,
    targetMaxDimension: number,
  ): { width: number; height: number; scale: number } {
    let scale = 1;
    const sourceMaxDimension = Math.max(sourceW, sourceH);
    if (sourceMaxDimension > targetMaxDimension) {
      scale = Math.min(scale, targetMaxDimension / sourceMaxDimension);
    }

    const totalPixels = sourceW * sourceH;
    const maxPixels = targetMaxDimension * targetMaxDimension;
    if (totalPixels > maxPixels) {
      scale = Math.min(scale, Math.sqrt(maxPixels / totalPixels));
    }

    return {
      width: Math.max(1, Math.round(sourceW * scale)),
      height: Math.max(1, Math.round(sourceH * scale)),
      scale,
    };
  }
}

export function createImageCacheKey(src: string): string {
  if (!isBase64DataUrl(src)) return src;
  const commaIndex = src.indexOf(",");
  const metadata = src.slice(5, commaIndex);
  const mimeType = metadata.split(";")[0] || "application/octet-stream";
  const payload = src.slice(commaIndex + 1);
  return `${DATA_URL_CACHE_KEY_PREFIX}${mimeType}:${payload.length}:${hashString(payload)}`;
}

function isBase64DataUrl(src: string): boolean {
  if (!src.startsWith("data:")) return false;
  const commaIndex = src.indexOf(",");
  if (commaIndex < 0) return false;
  return src.slice(5, commaIndex).toLowerCase().split(";").includes("base64");
}

function hashString(value: string): string {
  let hash = DATA_URL_HASH_SEED;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function chooseImageLodSize(request: ImageDisplayRequest): number {
  const dpr = Math.max(request.devicePixelRatio ?? 1, 1);
  const targetPixels =
    Math.max(request.targetWidth, request.targetHeight, 1) *
    Math.max(request.zoom, 0.01) *
    dpr;
  const interactive = request.interactionMode !== "idle";

  if (interactive) {
    if (targetPixels <= 1024) return 512;
    return 1024;
  }

  if (targetPixels <= 512) return 512;
  if (targetPixels <= 1024) return 1024;
  return 2048;
}
