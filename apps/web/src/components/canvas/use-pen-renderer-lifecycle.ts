"use client";

import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { type EditorOverlayState, PenRenderer } from "@cucumber/pen-renderer";
import type { PenDocument } from "@cucumber/pen-types";
import type { CanvasKit } from "canvaskit-wasm";
import { useEffect } from "react";

import { syncRendererDocument } from "./canvas-document-boundary";
import type { CanvasRuntimeStore } from "./canvas-runtime-store";
import { lookupCanvasIcon } from "./icon-library";
import type { PendingRendererDocumentSync } from "./skia-canvas-types";

type MutableRef<T> = {
  current: T;
};

type UsePenRendererLifecycleOptions = {
  activePageIdRef: MutableRef<string>;
  canvasContainerRef: MutableRef<HTMLDivElement | null>;
  canvasElRef: MutableRef<HTMLCanvasElement | null>;
  canvasKit: CanvasKit | null;
  ckReady: boolean;
  documentChangeRafRef: MutableRef<number | null>;
  docRef: MutableRef<PenDocument>;
  editorOverlayRef: MutableRef<EditorOverlayState>;
  marqueeRafRef: MutableRef<number | null>;
  pendingDocumentChangeRef: MutableRef<CucumberCanvasDocument | null>;
  pendingRendererDocumentSyncRef: MutableRef<PendingRendererDocumentSync | null>;
  pendingSceneNotificationRef: MutableRef<{
    activePageId: string;
    doc: PenDocument;
    selection: readonly string[];
  } | null>;
  rendererDocumentSyncRafRef: MutableRef<number | null>;
  rendererIdleTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>;
  rendererRef: MutableRef<PenRenderer | null>;
  runtimeStore: CanvasRuntimeStore;
  sceneNotificationRafRef: MutableRef<number | null>;
};

export function usePenRendererLifecycle({
  activePageIdRef,
  canvasContainerRef,
  canvasElRef,
  canvasKit,
  ckReady,
  documentChangeRafRef,
  docRef,
  editorOverlayRef,
  marqueeRafRef,
  pendingDocumentChangeRef,
  pendingRendererDocumentSyncRef,
  pendingSceneNotificationRef,
  rendererDocumentSyncRafRef,
  rendererIdleTimerRef,
  rendererRef,
  runtimeStore,
  sceneNotificationRafRef,
}: UsePenRendererLifecycleOptions) {
  useEffect(() => {
    if (!ckReady || !canvasKit) return;
    const container = canvasContainerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvasElRef.current = canvas;
    container.appendChild(canvas);

    const renderer = new PenRenderer(canvasKit, {
      fontBasePath: "/fonts/",
      iconLookup: lookupCanvasIcon,
      backgroundColor:
        runtimeStore.getState().viewport.backgroundColor ?? "#F0F0F0",
    });
    renderer.init(canvas);
    syncRendererDocument(renderer, docRef.current, activePageIdRef.current);
    renderer.zoomToFit(64);
    {
      const viewport = renderer.getViewport();
      runtimeStore.getState().setViewportSnapshot({
        x: viewport.panX,
        y: viewport.panY,
        zoom: viewport.zoom,
      });
    }
    rendererRef.current = renderer;
    renderer.setEditorOverlays(editorOverlayRef.current);

    console.info("[skia-canvas] PenRenderer initialized");

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) renderer.resize(w, h);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (rendererIdleTimerRef.current) {
        clearTimeout(rendererIdleTimerRef.current);
        rendererIdleTimerRef.current = null;
      }
      if (marqueeRafRef.current !== null) {
        cancelAnimationFrame(marqueeRafRef.current);
        marqueeRafRef.current = null;
      }
      if (rendererDocumentSyncRafRef.current !== null) {
        cancelAnimationFrame(rendererDocumentSyncRafRef.current);
        rendererDocumentSyncRafRef.current = null;
      }
      if (sceneNotificationRafRef.current !== null) {
        cancelAnimationFrame(sceneNotificationRafRef.current);
        sceneNotificationRafRef.current = null;
      }
      if (documentChangeRafRef.current !== null) {
        cancelAnimationFrame(documentChangeRafRef.current);
        documentChangeRafRef.current = null;
      }
      pendingRendererDocumentSyncRef.current = null;
      pendingSceneNotificationRef.current = null;
      pendingDocumentChangeRef.current = null;
      renderer.dispose();
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      rendererRef.current = null;
      canvasElRef.current = null;
    };
  }, [
    activePageIdRef,
    canvasContainerRef,
    canvasElRef,
    canvasKit,
    ckReady,
    documentChangeRafRef,
    docRef,
    editorOverlayRef,
    marqueeRafRef,
    pendingDocumentChangeRef,
    pendingRendererDocumentSyncRef,
    pendingSceneNotificationRef,
    rendererDocumentSyncRafRef,
    rendererIdleTimerRef,
    rendererRef,
    runtimeStore,
    sceneNotificationRafRef,
  ]);
}
