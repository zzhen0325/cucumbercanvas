"use client";

import type {
  CanvasBounds,
  CanvasOperation,
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
import {
  saveCanvas,
  serializeApiError,
  uploadThumbnail,
} from "../lib/server-api";
import type { CanvasApi, CanvasSceneElement } from "./canvas/canvas-api";
import {
  analyzeDocumentExportWarnings,
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

type CanvasDocumentPatchParams = {
  baseVersion: number;
  operations: CanvasOperation[];
  selection?: string[];
  transactionId: string;
};

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
  return calculateDocumentBounds(api.getDocument(), api.getActivePageId());
}

function parseCanvasDocumentPatchParams(
  params: Record<string, unknown>,
): CanvasDocumentPatchParams {
  const baseVersion = params.baseVersion;
  const transactionId = params.transactionId;
  const operations = params.operations;
  const selection = params.selection;

  if (!Number.isInteger(baseVersion) || (baseVersion as number) < 0) {
    throw new Error(
      "canvas.document.patch requires a non-negative baseVersion.",
    );
  }
  if (typeof transactionId !== "string" || transactionId.trim().length === 0) {
    throw new Error("canvas.document.patch requires a transactionId.");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("canvas.document.patch requires at least one operation.");
  }
  for (const operation of operations) {
    if (
      !operation ||
      typeof operation !== "object" ||
      typeof (operation as { type?: unknown }).type !== "string"
    ) {
      throw new Error(
        "canvas.document.patch operations must be canvas operation objects with a type.",
      );
    }
  }
  if (
    selection !== undefined &&
    (!Array.isArray(selection) ||
      selection.some((nodeId) => typeof nodeId !== "string"))
  ) {
    throw new Error("canvas.document.patch selection must be string node IDs.");
  }

  return {
    baseVersion: baseVersion as number,
    operations: operations as CanvasOperation[],
    ...(selection ? { selection: selection as string[] } : {}),
    transactionId,
  };
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
    const result = await saveCanvas(
      accessTokenRef.current,
      canvasIdRef.current,
      payload,
    );
    if (pendingContentRef.current === payload) {
      apiRef.current?.setDocument(result.content, {
        captureHistory: false,
        notify: false,
        preserveViewport: true,
      });
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
          .then((result) => {
            if (pendingContentRef.current === payload) {
              apiRef.current?.setDocument(result.content, {
                captureHistory: false,
                notify: false,
                preserveViewport: true,
              });
              pendingContentRef.current = null;
            }
          })
          .catch((error) => {
            console.warn("[canvas-editor] save failed", {
              canvasId: canvasIdRef.current,
              error: serializeApiError(error),
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
            error: serializeApiError(error),
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
        const warnings = analyzeDocumentExportWarnings(api.getDocument(), {
          activePageId: api.getActivePageId(),
          bounds,
        });
        const dataUrl = await blobToDataUrl(blob);
        console.info("[canvas-editor] screenshot exported", {
          canvasId,
          mode: screenshotParams.mode,
          warningCount: warnings.length,
          bounds,
          width: exportSize.width,
          height: exportSize.height,
        });
        return {
          url: dataUrl,
          width: exportSize.width,
          height: exportSize.height,
          actualBounds: bounds,
          warnings,
        };
      },
    );
    const unregisterGet = ws.registerRPC("canvas.document.get", async () => ({
      document: api.getDocument(),
      version: api.getDocumentVersion(),
    }));
    const unregisterSet = ws.registerRPC(
      "canvas.document.set",
      async (params) => {
        api.setDocument(params.document);
        await api.flushPendingSave();
        return { ok: true };
      },
    );
    const unregisterPatch = ws.registerRPC(
      "canvas.document.patch",
      async (params) => {
        const patch = parseCanvasDocumentPatchParams(params);
        const version = api.applyDocumentPatch({
          baseVersion: patch.baseVersion,
          operations: patch.operations,
          selection: patch.selection,
          transactionId: patch.transactionId,
        });
        await api.flushPendingSave();
        console.info("[canvas-editor] document patch applied", {
          canvasId,
          nextVersion: version,
          operationCount: patch.operations.length,
          transactionId: patch.transactionId,
        });
        return { ok: true, version };
      },
    );
    return () => {
      unregisterScreenshot();
      unregisterGet();
      unregisterSet();
      unregisterPatch();
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
            console.warn("[canvas-editor] unmount save failed", {
              canvasId: canvasIdRef.current,
              error: serializeApiError(error),
            });
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
          accessToken={accessToken}
          initialContent={initialContent}
          onApiReady={handleApiReady}
          onDocumentChange={handleDocumentChange}
          onInsertIcon={onInsertIcon}
          onSelectionChange={handleSelectionChange}
          projectId={projectId}
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
