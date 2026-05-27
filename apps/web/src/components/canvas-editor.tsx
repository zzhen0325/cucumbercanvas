"use client";

import type {
  CanvasBounds,
  CucumberCanvasDocument,
} from "@cucumber/canvas-core";
import {
  type CanvasContent,
  type ScreenshotParams,
  screenshotParamsSchema,
} from "@cucumber/shared";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WebSocketHandle } from "../hooks/use-websocket";
import { getServerBaseUrl } from "../lib/env";
import { saveCanvas, uploadThumbnail } from "../lib/server-api";
import type { CanvasApi, CanvasSceneElement } from "./canvas/canvas-api";
import {
  calculateDocumentBounds,
  calculateExportSize,
} from "./canvas/canvas-export";
import { ErrorBoundary } from "./error-boundary";

const SkiaCanvas = dynamic(
  () => import("./canvas/skia-canvas").then((m) => ({ default: m.SkiaCanvas })),
  { ssr: false },
);

export type CanvasSelectedElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fileId?: string;
  dataUrl?: string;
  storageUrl?: string;
  source?: string;
  importSessionId?: string;
  importSourceLabel?: string;
  importWarningCount?: number;
  degradationHints?: string[];
  autoLayout?: Record<string, unknown>;
};

type CanvasEditorProps = {
  canvasId: string;
  projectId: string;
  accessToken: string;
  initialContent: CanvasContent;
  onApiReady?: (api: CanvasApi) => void;
  onInsertIcon?: () => void;
  ws?: WebSocketHandle;
  leftPanelOpen?: boolean;
  onSelectionChange?: (elements: CanvasSelectedElement[]) => void;
};

const SAVE_DEBOUNCE_MS = 1_200;
const THUMBNAIL_DEBOUNCE_MS = 10_000;

function resolveScreenshotBounds(
  api: CanvasApi,
  params: ScreenshotParams,
): CanvasBounds {
  if (params.mode === "region") {
    if (!params.region) {
      throw new Error(
        "screenshot_canvas mode 'region' requires region { x, y, width, height }.",
      );
    }
    return params.region;
  }
  if (params.mode === "viewport") {
    return api.getViewportBounds();
  }
  return calculateDocumentBounds(api.getDocument());
}

export function CanvasEditor({
  canvasId,
  projectId,
  accessToken,
  initialContent,
  onApiReady,
  onInsertIcon,
  ws,
  onSelectionChange,
}: CanvasEditorProps) {
  const accessTokenRef = useRef(accessToken);
  const canvasIdRef = useRef(canvasId);
  const apiRef = useRef<CanvasApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<unknown | null>(null);
  const [api, setApi] = useState<CanvasApi | null>(null);

  accessTokenRef.current = accessToken;
  canvasIdRef.current = canvasId;

  const flushPendingSave = useCallback(async () => {
    const payload = pendingContentRef.current;
    if (!payload) return;
    await saveCanvas(accessTokenRef.current, canvasIdRef.current, payload);
    if (pendingContentRef.current === payload) {
      pendingContentRef.current = null;
    }
    console.info("[canvas-editor] pending document flushed", {
      canvasId: canvasIdRef.current,
    });
  }, []);

  const handleApiReady = useCallback(
    (nextApi: CanvasApi) => {
      const editorApi: CanvasApi = {
        ...nextApi,
        flushPendingSave,
      };
      apiRef.current = editorApi;
      setApi(editorApi);
      onApiReady?.(editorApi);
      console.info("[canvas-editor] cucumber canvas runtime ready", {
        canvasId,
      });
    },
    [canvasId, flushPendingSave, onApiReady],
  );

  const handleSelectionChange = useCallback(
    (elements: CanvasSceneElement[]) => {
      onSelectionChange?.(
        elements.map((element) => ({
          id: element.id,
          type: element.type,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          text: element.text,
          fileId: element.fileId,
          dataUrl: element.fileId
            ? apiRef.current?.getFiles()[element.fileId]?.dataURL
            : undefined,
          storageUrl: element.customData?.storageUrl as string | undefined,
          source: element.customData?.source as string | undefined,
          importSessionId: element.customData?.importSessionId as
            | string
            | undefined,
          importSourceLabel: element.customData?.importSourceLabel as
            | string
            | undefined,
          importWarningCount: element.customData?.importWarningCount as
            | number
            | undefined,
          degradationHints: element.customData?.degradationHints as
            | string[]
            | undefined,
          autoLayout: element.customData?.autoLayout as
            | Record<string, unknown>
            | undefined,
        })),
      );
    },
    [onSelectionChange],
  );

  const handleDocumentChange = useCallback(
    (content: CucumberCanvasDocument) => {
      pendingContentRef.current = content;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const payload = pendingContentRef.current;
        if (!payload) return;
        saveCanvas(accessTokenRef.current, canvasIdRef.current, payload)
          .then(() => {
            if (pendingContentRef.current === payload) {
              pendingContentRef.current = null;
            }
          })
          .catch((error) => {
            console.error("[canvas-editor] save failed", {
              canvasId: canvasIdRef.current,
              error,
            });
          });
      }, SAVE_DEBOUNCE_MS);

      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = setTimeout(async () => {
        try {
          const blob = await apiRef.current?.exportImage({
            maxWidthOrHeight: 400,
            mimeType: "image/svg+xml",
          });
          if (!blob) return;
          await uploadThumbnail(accessTokenRef.current, projectId, blob);
          console.info("[canvas-editor] thumbnail uploaded OK", {
            canvasId: canvasIdRef.current,
          });
        } catch (error) {
          console.warn("[canvas-editor] thumbnail generation/upload failed", {
            canvasId: canvasIdRef.current,
            error,
          });
        }
      }, THUMBNAIL_DEBOUNCE_MS);
    },
    [projectId],
  );

  useEffect(() => {
    if (!ws || !api) return;
    ws.bindCanvas(canvasId);
    const unregisterScreenshot = ws.registerRPC(
      "canvas.screenshot",
      async (params) => {
        const screenshotParams = screenshotParamsSchema.parse(
          params,
        ) as ScreenshotParams;
        const bounds = resolveScreenshotBounds(api, screenshotParams);
        const exportSize = calculateExportSize(
          bounds,
          screenshotParams.max_dimension,
        );
        const blob = await api.exportImage({
          bounds,
          maxWidthOrHeight: screenshotParams.max_dimension,
          mimeType: "image/svg+xml",
        });
        const dataUrl = await blobToDataUrl(blob);
        console.info("[canvas-editor] screenshot exported", {
          canvasId,
          mode: screenshotParams.mode,
          bounds,
          width: exportSize.width,
          height: exportSize.height,
        });
        return {
          url: dataUrl,
          width: exportSize.width,
          height: exportSize.height,
          actualBounds: bounds,
        };
      },
    );
    const unregisterGet = ws.registerRPC("canvas.document.get", async () => ({
      document: api.getDocument(),
    }));
    const unregisterSet = ws.registerRPC(
      "canvas.document.set",
      async (params) => {
        api.setDocument(params.document);
        await api.flushPendingSave();
        return { ok: true };
      },
    );
    return () => {
      unregisterScreenshot();
      unregisterGet();
      unregisterSet();
    };
  }, [api, canvasId, ws]);

  useEffect(() => {
    const flushBeforeUnload = () => {
      const payload = pendingContentRef.current;
      if (!payload) return;
      const url = `${getServerBaseUrl()}/api/canvases/${canvasIdRef.current}`;
      try {
        fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessTokenRef.current}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: payload }),
          keepalive: true,
        });
      } catch {
        // Page teardown path is best-effort.
      }
      pendingContentRef.current = null;
    };

    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
      const payload = pendingContentRef.current;
      if (payload) {
        saveCanvas(accessTokenRef.current, canvasIdRef.current, payload).catch(
          (error) => {
            console.error("[canvas-editor] unmount save failed", error);
          },
        );
      }
    };
  }, []);

  return (
    <ErrorBoundary
      onError={(error) =>
        console.error("[canvas-editor] render crashed", {
          canvasId,
          error,
        })
      }
    >
      <div className="h-full w-full relative">
        <SkiaCanvas
          initialContent={initialContent}
          onApiReady={handleApiReady}
          onDocumentChange={handleDocumentChange}
          onInsertIcon={onInsertIcon}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </ErrorBoundary>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error("Failed to convert screenshot to data URL"));
    reader.readAsDataURL(blob);
  });
}
