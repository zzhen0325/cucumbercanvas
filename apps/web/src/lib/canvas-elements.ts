import type { ImageArtifact, VideoArtifact } from "@cucumber/shared";

import { normalizeCanvasElements } from "./canvas-normalize";
import { getServerBaseUrl } from "./env";

/** Video file extensions recognized for inline playback on canvas. */
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov"];

/**
 * Check if a URL points to a video file based on extension or customData hint.
 * Used by canvas-editor (renderEmbeddable) and canvas-tool-menu (selection detection).
 */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    // Strip query params/hash for extension check
    const pathname = new URL(url, "https://placeholder").pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    // Fallback: raw string check
    const lower = url.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
  }
}

/**
 * Scale dimensions to fit within maxSize while preserving aspect ratio.
 */
export function scaleToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Fit media into a target canvas box while preserving the original aspect ratio.
 * Keeps the media centered within the target box so agent-provided placement
 * still controls the overall location without stretching the content.
 */
export function fitMediaIntoPlacement(
  mediaWidth: number,
  mediaHeight: number,
  placement: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const fitted = scaleToFit(
    mediaWidth,
    mediaHeight,
    Math.max(placement.width, placement.height),
  );
  const placementRatio = placement.width / placement.height;
  const mediaRatio = mediaWidth / mediaHeight;

  let width = fitted.width;
  let height = fitted.height;

  if (mediaRatio > placementRatio) {
    width = placement.width;
    height = Math.round(placement.width / mediaRatio);
  } else {
    height = placement.height;
    width = Math.round(placement.height * mediaRatio);
  }

  return {
    x: Math.round(placement.x + (placement.width - width) / 2),
    y: Math.round(placement.y + (placement.height - height) / 2),
    width,
    height,
  };
}

/**
 * Compute the center of the current Excalidraw viewport.
 */
export function getViewportCenter(appState: {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}): { x: number; y: number } {
  const zoom = appState.zoom?.value ?? 1;
  return {
    x: -appState.scrollX + appState.width / (2 * zoom),
    y: -appState.scrollY + appState.height / (2 * zoom),
  };
}

/**
 * Create a fully-qualified Excalidraw image element via the official skeleton
 * conversion API so hit-testing receives every internal field it expects.
 */
export async function createExcalidrawImageElement(opts: {
  id?: string;
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  source?: "generated" | "uploaded";
  storageUrl?: string;
}): Promise<Record<string, unknown>> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const skeleton: Record<string, unknown> = {
    type: "image",
    id: opts.id ?? generateId(),
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    fileId: opts.fileId,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    roundness: null,
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  if (opts.title || opts.source || opts.storageUrl) {
    skeleton.customData = {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.storageUrl ? { storageUrl: opts.storageUrl } : {}),
    };
  }
  const [element] = convertToExcalidrawElements([skeleton as any], {
    regenerateIds: false,
  }) as Record<string, unknown>[];
  if (!element) {
    throw new Error("Failed to convert image skeleton into Excalidraw element");
  }

  // #region debug-point A:image-element-shape
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "canvas-image-hit-test",
      runId: "post-fix",
      hypothesisId: "A",
      location: "canvas-elements.ts:createExcalidrawImageElement",
      msg: "[DEBUG] built image element candidate",
      data: {
        fileId: opts.fileId,
        width: opts.width,
        height: opts.height,
        keys: Object.keys(element).sort(),
        status: element.status,
        scale: element.scale,
        crop: element.crop,
        roundness: element.roundness,
        boundElements: element.boundElements,
        source: opts.source ?? null,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return element;
}

/**
 * Fetch an image URL and convert it to a data URL string.
 * Routes through the server proxy to bypass browser CORS restrictions.
 */
export async function fetchAsDataURL(url: string): Promise<string> {
  const proxyUrl = `${getServerBaseUrl()}/api/proxy-image?url=${encodeURIComponent(url)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error("Failed to convert image to data URL"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Insert an image artifact onto the Excalidraw canvas.
 */
export async function insertImageOnCanvas(
  api: {
    addFiles: (
      files: { id: any; dataURL: any; mimeType: string; created: number }[],
    ) => void;
    getSceneElements: () => readonly any[];
    getAppState: () => any;
    updateScene: (scene: {
      elements: any[];
      captureUpdate?: string;
    }) => void;
  },
  artifact: ImageArtifact,
): Promise<void> {
  const dataURL = await fetchAsDataURL(artifact.url);
  const fileId = generateId();

  api.addFiles([
    {
      id: fileId as any,
      dataURL: dataURL as any,
      mimeType: artifact.mimeType,
      created: Date.now(),
    },
  ]);

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (artifact.placement) {
    // Preserve agent-provided placement while fitting the real image aspect ratio into the box.
    const fitted = fitMediaIntoPlacement(
      artifact.width,
      artifact.height,
      artifact.placement,
    );
    x = fitted.x;
    y = fitted.y;
    width = fitted.width;
    height = fitted.height;
  } else {
    // Smart auto-placement: viewport center if empty, next to elements if not
    const scaled = scaleToFit(artifact.width, artifact.height, 600);
    width = scaled.width;
    height = scaled.height;

    const elements = api.getSceneElements().filter((el: any) => !el.isDeleted);

    if (elements.length === 0) {
      // Empty canvas → viewport center
      const center = getViewportCenter(api.getAppState());
      x = center.x - width / 2;
      y = center.y - height / 2;
    } else {
      // Has elements → place to the right of the rightmost element with gap
      const GAP = 40;
      let maxRight = Number.NEGATIVE_INFINITY;
      let rightEdgeY = 0;

      for (const el of elements) {
        const elRight = (el.x ?? 0) + (el.width ?? 0);
        if (elRight > maxRight) {
          maxRight = elRight;
          // Vertically align center of new image with center of rightmost element
          rightEdgeY = (el.y ?? 0) + (el.height ?? 0) / 2;
        }
      }

      x = maxRight + GAP;
      y = rightEdgeY - height / 2;
    }
  }

  const element = await createExcalidrawImageElement({
    fileId,
    x,
    y,
    width,
    height,
    ...(artifact.title ? { title: artifact.title } : {}),
    source: "generated",
    storageUrl: artifact.url,
  });

  // #region debug-point B:insert-image-scene
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "canvas-image-hit-test",
      runId: "post-fix",
      hypothesisId: "B",
      location: "canvas-elements.ts:insertImageOnCanvas:before-update",
      msg: "[DEBUG] inserting generated image into scene",
      data: {
        artifact: {
          width: artifact.width,
          height: artifact.height,
          mimeType: artifact.mimeType,
          hasPlacement: Boolean(artifact.placement),
        },
        element: {
          id: element.id,
          fileId: element.fileId,
          width: element.width,
          height: element.height,
          status: element.status,
          scale: element.scale,
          crop: element.crop,
          keys: Object.keys(element).sort(),
        },
        existingElementCount: api.getSceneElements().length,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  api.updateScene({
    elements: [...api.getSceneElements(), element],
    captureUpdate: "IMMEDIATELY",
  });

  // #region debug-point B:insert-image-scene-after
  queueMicrotask(() => {
    const inserted = api
      .getSceneElements()
      .find((sceneElement: any) => sceneElement.id === element.id);
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "canvas-image-hit-test",
        runId: "post-fix",
        hypothesisId: "B",
        location: "canvas-elements.ts:insertImageOnCanvas:after-update",
        msg: "[DEBUG] image scene snapshot after insert",
        data: inserted
          ? {
              id: inserted.id,
              type: inserted.type,
              fileId: inserted.fileId,
              status: inserted.status,
              scale: inserted.scale,
              crop: inserted.crop,
              keys: Object.keys(inserted).sort(),
            }
          : {
              missingInsertedElement: true,
              insertedId: element.id,
            },
        ts: Date.now(),
      }),
    }).catch(() => {});
  });
  // #endregion
}

/**
 * Insert a video artifact onto the Excalidraw canvas as an embeddable element.
 * Uses Excalidraw's native embeddable type with renderEmbeddable callback for inline playback.
 * No poster frame extraction needed -- the video plays directly on canvas.
 */
export async function insertVideoOnCanvas(
  api: {
    getSceneElements: () => readonly any[];
    getAppState: () => any;
    updateScene: (scene: {
      elements: any[];
      captureUpdate?: string;
    }) => void;
  },
  artifact: VideoArtifact,
): Promise<void> {
  // Dynamic import — excalidraw is client-only and cannot be imported at module level
  const { convertToExcalidrawElements } = await import(
    "@excalidraw/excalidraw"
  );

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (artifact.placement) {
    x = artifact.placement.x;
    y = artifact.placement.y;
    width = artifact.placement.width;
    height = artifact.placement.height;
  } else {
    // Use 800px max for video elements (larger than images since video benefits from more screen area)
    const scaled = scaleToFit(artifact.width, artifact.height, 800);
    width = scaled.width;
    height = scaled.height;

    const elements = api.getSceneElements().filter((el: any) => !el.isDeleted);

    if (elements.length === 0) {
      // Empty canvas -- place at viewport center
      const center = getViewportCenter(api.getAppState());
      x = center.x - width / 2;
      y = center.y - height / 2;
    } else {
      // Has elements -- place to the right of the rightmost element with gap
      const GAP = 40;
      let maxRight = Number.NEGATIVE_INFINITY;
      let rightEdgeY = 0;
      for (const el of elements) {
        const elRight = (el.x ?? 0) + (el.width ?? 0);
        if (elRight > maxRight) {
          maxRight = elRight;
          rightEdgeY = (el.y ?? 0) + (el.height ?? 0) / 2;
        }
      }
      x = maxRight + GAP;
      y = rightEdgeY - height / 2;
    }
  }

  const newElements = convertToExcalidrawElements([
    {
      type: "embeddable",
      link: artifact.url,
      x,
      y,
      width,
      height,
      customData: {
        isVideo: true,
        mimeType: artifact.mimeType,
        durationSeconds: artifact.durationSeconds,
        title: artifact.title?.slice(0, 60),
        prompt: artifact.title,
      },
    } as any, // ExcalidrawElementSkeleton includes IframeLikeElement but TS needs a nudge
  ]);
  const normalized = normalizeCanvasElements(
    newElements as Record<string, unknown>[],
  );
  if (normalized.changed) {
    console.log("[canvas-elements] normalized inserted video element style");
  }

  const existing = api.getSceneElements();
  api.updateScene({
    elements: [...existing, ...normalized.elements],
    captureUpdate: "IMMEDIATELY",
  });
}

function generateId(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).slice(0, 20);
}
