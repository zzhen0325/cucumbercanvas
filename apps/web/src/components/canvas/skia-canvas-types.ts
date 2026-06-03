import type { CanvasBounds } from "@cucumber/canvas-core";
import type { EditorOverlayState, PenRenderer } from "@cucumber/pen-renderer";
import type {
  PenConnectorEndpointBinding,
  PenConnectorSide,
  PenDocument,
} from "@cucumber/pen-types";
import type { RefObject } from "react";

import type {
  CanvasApi,
  CanvasApiDocument,
  CanvasChangeListener,
  CanvasTool,
} from "./canvas-api";
import type { DrawableCanvasTool, ResizeHandle } from "./canvas-draw-geometry";
import type {
  CanvasRuntimeCommitResult,
  CanvasRuntimeStore,
} from "./canvas-runtime-store";
import type { CanvasSceneSnapshot } from "./canvas-scene-snapshot";

export type PendingRendererDocumentSync = {
  activePageId: string;
  coalescedCount: number;
  deferredForDrag: boolean;
  document: PenDocument;
  source: string;
  version: number;
};

export type MutableRef<T> = {
  current: T;
};

export type SkiaCanvasRefs = {
  canvasRootRef: RefObject<HTMLDivElement | null>;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  marqueeOverlayElRef: RefObject<HTMLDivElement | null>;
  canvasElRef: MutableRef<HTMLCanvasElement | null>;
  rendererRef: MutableRef<PenRenderer | null>;
};

export type SkiaRuntimeRefs = {
  activePageIdRef: MutableRef<string>;
  activeToolRef: MutableRef<CanvasTool>;
  docRef: MutableRef<CanvasApiDocument>;
  documentVersionRef: MutableRef<number>;
  selectedIdsRef: MutableRef<string[]>;
};

export type SkiaSchedulerRefs = {
  documentChangeRafRef: MutableRef<number | null>;
  pendingDocumentChangeRef: MutableRef<CanvasApiDocument | null>;
  pendingRendererDocumentSyncRef: MutableRef<PendingRendererDocumentSync | null>;
  pendingSceneNotificationRef: MutableRef<{
    activePageId: string;
    doc: PenDocument;
    selection: readonly string[];
  } | null>;
  pendingViewportPanRef: MutableRef<{
    x: number;
    y: number;
    zoom: number;
  } | null>;
  rendererDocumentSyncRafRef: MutableRef<number | null>;
  rendererIdleTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>;
  sceneNotificationRafRef: MutableRef<number | null>;
  viewportPanRafRef: MutableRef<number | null>;
};

export type SkiaSceneRefs = {
  listenersRef: MutableRef<Set<CanvasChangeListener>>;
  sceneSnapshotCacheKeyRef: MutableRef<string>;
  sceneSnapshotRef: MutableRef<CanvasSceneSnapshot>;
};

export type SkiaInteractionRefs = {
  clipboardRef: MutableRef<
    import("@cucumber/canvas-core").CanvasClipboardData | null
  >;
  dragRef: MutableRef<DragState | null>;
  editorOverlayRef: MutableRef<EditorOverlayState>;
  marqueeRafRef: MutableRef<number | null>;
  marqueeSelectionRef: MutableRef<string[]>;
  suppressNextClickRef: MutableRef<boolean>;
};

export type SkiaDocumentActions = {
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  flushRendererDocumentSyncBeforeInteraction: () => void;
  flushScheduledDocumentChange: () => void;
  getConnectorSnap: (
    point: { x: number; y: number },
    options?: { excludeNodeIds?: Iterable<string> },
  ) => ReturnType<
    typeof import("@cucumber/canvas-core").findConnectorSnapTarget
  >;
  getLiveViewportPlacement: () => {
    viewport: ReturnType<PenRenderer["getViewport"]> | null;
    rect: DOMRect | null;
  };
  getPointerScenePoint: (event: { clientX: number; clientY: number }) => {
    x: number;
    y: number;
  } | null;
  notifySelectionForDoc: (nextDoc: PenDocument, nodeIds: string[]) => void;
  scheduleRendererIdle: (delayMs?: number) => void;
  scheduleViewportPanSnapshot: (viewport: {
    panX: number;
    panY: number;
    zoom: number;
  }) => void;
  setActiveTool: (tool: CanvasTool) => void;
  setEditorOverlay: (overlay: Partial<EditorOverlayState>) => void;
  setMarqueeDomOverlay: (bounds: CanvasBounds | null) => void;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
  syncCommittedDocumentToRenderer: (
    commit: CanvasRuntimeCommitResult,
    reason: string,
  ) => void;
};

export type SkiaRuntimeContext = {
  runtimeStore: CanvasRuntimeStore;
  refs: SkiaCanvasRefs &
    SkiaRuntimeRefs &
    SkiaSchedulerRefs &
    SkiaSceneRefs &
    SkiaInteractionRefs;
  actions: SkiaDocumentActions;
};

export type DragState =
  | {
      kind: "pan";
      button: number;
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "move";
      nodeIds: string[];
      startPoint: { x: number; y: number };
      origins: Record<string, CanvasBounds>;
      hasMoved: boolean;
      sceneDelta: { x: number; y: number };
    }
  | {
      kind: "resize";
      nodeId: string;
      handle: ResizeHandle;
      startPoint: { x: number; y: number };
      origin: CanvasBounds;
      preserveAspectRatio: boolean;
      sceneDelta: { x: number; y: number };
    }
  | {
      kind: "lineEndpoint";
      nodeId: string;
      endpoint: "start" | "end";
      startPoint: { x: number; y: number };
      originStart: { x: number; y: number };
      originEnd: { x: number; y: number };
    }
  | {
      kind: "stickyConnector";
      nodeId: string;
      side: PenConnectorSide;
      startPoint: { x: number; y: number };
      sourceBounds: CanvasBounds;
    }
  | {
      kind: "rotate";
      nodeId: string;
      center: { x: number; y: number };
      originRotation: number;
      startAngle: number;
    }
  | {
      kind: "drawShape";
      shapeType: DrawableCanvasTool;
      startPoint: { x: number; y: number };
      startConnector?: PenConnectorEndpointBinding;
      fromCenter: boolean;
    }
  | {
      kind: "drawText";
      startPoint: { x: number; y: number };
      startScreenX: number;
      startScreenY: number;
      hasMoved: boolean;
    }
  | {
      kind: "pen";
    }
  | {
      kind: "marquee";
      startPoint: { x: number; y: number };
      originSelection: string[];
    };
