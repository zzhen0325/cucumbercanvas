"use client";

import {
  type AgentBinding,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasClipboardData,
  type CucumberCanvasDocument,
  addCanvasPage,
  applyCanvasOperation,
  applyCanvasTransaction,
  copyCanvasSelection,
  createNodeId,
  deleteCanvasPage,
  detachConnectorEndpoint as detachConnectorEndpointBinding,
  duplicateCanvasNodes,
  duplicateCanvasPage,
  findConnectorSnapTarget,
  findNode,
  getActiveChildren,
  getCanvasPages,
  getLineEndpoints,
  getNodeBounds,
  getNodeSceneBounds,
  getOrderedCanvasNodes,
  isDescendantOf,
  pasteCanvasClipboard,
  renameCanvasPage,
  reorderCanvasPage,
  reparentNodesByDropPoint,
  resolveActivePageId,
} from "@cucumber/canvas-core";
import {
  type BooleanOpType,
  executeBooleanOp,
  getBooleanOpRejectionReason,
} from "@cucumber/pen-core";
import {
  type EditorOverlayState,
  type PenRenderer,
  sceneToCanvasLocal,
  screenToScene,
} from "@cucumber/pen-renderer";
import type {
  LineNode,
  PenConnectorEndpointBinding,
  PenConnectorSide,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";
import type React from "react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";

import { useToast } from "@/components/toast";
import { AgentRunNodeContentLayer } from "./agent-run-node-content-layer";
import type {
  AlignMode,
  CanvasApi,
  CanvasApiDocument,
  CanvasChangeListener,
  CanvasDocumentPatch,
  CanvasSceneElement,
  CanvasTool,
} from "./canvas-api";
import { createCanvasApiFacade } from "./canvas-api-facade";
import {
  normalizeRuntimeDocument,
  normalizeRuntimeDocumentForCanvasSet,
  syncRendererDocument,
} from "./canvas-document-boundary";
import {
  calculateResizeBounds,
  createDrawableCanvasNode,
  createFrameNode,
  createLineNode,
  createSectionFrameNode,
  createTextCanvasNode,
  getDrawableToolPreview,
  getLineDrawDraft,
  getLineEndpointDragDraft,
  isDragDrawableTool,
  isLineDrawableTool,
  normalizeDrawBounds,
  pointToAngle,
  shouldAttachConnectorForTool,
} from "./canvas-draw-geometry";
import { exportDocumentImage } from "./canvas-export";
import { createLegacyShapeNode } from "./canvas-legacy-shape-node";
import { getDefaultCanvasNodeBounds } from "./canvas-node-placement";
import {
  CanvasBooleanToolbarConnected,
  CanvasContextMenu,
  CanvasEditorToolbarConnected,
  CanvasPropertyPanelConnected,
  CanvasSelectionToolbarConnected,
} from "./canvas-overlays";
import { bakePenAnchorsToPathData, usePenTool } from "./canvas-pen-tool";
import {
  type CanvasRuntimeCommitResult,
  type CanvasRuntimeStore,
  CanvasRuntimeStoreProvider,
  createCanvasRuntimeStore,
  getCanvasApiDocument,
  selectCanvasActiveTool,
  selectCanvasCanRedo,
  selectCanvasCanUndo,
} from "./canvas-runtime-store";
import {
  areStringArraysEqual,
  filterSelectionForActivePage,
  getCanvasApiRuntimeState,
  getDocumentSelection,
  hasPenChildren,
  isPenNode,
} from "./canvas-runtime-utils";
import {
  type CanvasSceneSnapshot,
  buildCanvasSceneSnapshot,
  getSceneSnapshotCacheKey,
  toAppState,
} from "./canvas-scene-snapshot";
import {
  getPrimarySelectedContainerId,
  getTopLevelSelectionIds,
} from "./canvas-selection-helpers";
import { CanvasTextEditOverlay } from "./canvas-text-edit-overlay";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  MIN_TEXT_BOX_SIZE,
  type TextEditState,
  getFirstSolidFillColor,
  getLineHeightPx,
  getTextContent,
  measureTextLayout,
  projectTextEditStateToViewport,
} from "./canvas-text-measure";
import { getResizeNodeUpdates } from "./canvas-text-resize";
import type {
  AgentExecutionContinueIntent,
  AgentExecutionContinueOptions,
} from "./property-panel/agent-execution-section";
import {
  CANVAS_SELECTION_COLOR,
  KEYBOARD_ZOOM_STEP,
  MIN_DRAW_SIZE,
  MOVE_COMMIT_THRESHOLD_PX,
  TEXT_DRAG_THRESHOLD_PX,
  WHEEL_ZOOM_SENSITIVITY,
  assertPositiveFiniteZoom,
  normalizeWheelDeltaY,
} from "./skia-canvas-constants";
import type {
  DragState,
  PendingRendererDocumentSync,
} from "./skia-canvas-types";
import { StickyNameEditOverlay } from "./sticky-name-edit-overlay";
import {
  STICKY_NOTE_DEFAULT_HEIGHT,
  STICKY_NOTE_DEFAULT_WIDTH,
  createStickyNoteNode,
  findStickyNoteTextNode,
  getLinkedStickyBounds,
  getOppositeStickyConnectorSide,
  getSelectableStickyHitNode,
  getStickyConnectorPoint,
  getStickyNoteContainerForNode,
  isStickyNoteNode,
} from "./sticky-note-tool";
import { useBooleanVectorRuntime } from "./use-boolean-vector-runtime";
import { useCanvasImportActions } from "./use-canvas-import-actions";
import { useCanvasKitRuntime } from "./use-canvas-kit-runtime";
import { usePenRendererLifecycle } from "./use-pen-renderer-lifecycle";
import { useSkiaCanvasApi } from "./use-skia-canvas-api";
import { useSkiaKeyboardAndToolbarActions } from "./use-skia-keyboard-and-toolbar-actions";
import { useSkiaPointerInteractions } from "./use-skia-pointer-interactions";
import { useSkiaTextEditing } from "./use-skia-text-editing";
import { useSpaceHandTool } from "./use-space-hand-tool";

// ---------------------------------------------------------------------------
// SkiaCanvas
// ---------------------------------------------------------------------------

type SkiaCanvasProps = {
  accessToken?: string;
  initialContent: unknown;
  onDocumentChange?: (doc: CucumberCanvasDocument) => void;
  onContinueAgentExecution?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
  onInsertIcon?: () => void;
  onApiReady?: (api: CanvasApi) => void;
  onSelectionChange?: (elements: CanvasSceneElement[]) => void;
  projectId?: string;
};

export const SkiaCanvas = memo(
  forwardRef<CanvasApi, SkiaCanvasProps>(function SkiaCanvas(
    {
      accessToken,
      initialContent,
      onDocumentChange,
      onContinueAgentExecution,
      onInsertIcon,
      onApiReady,
      onSelectionChange,
      projectId,
    },
    ref,
  ) {
    const canvasRootRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const marqueeOverlayElRef = useRef<HTMLDivElement | null>(null);
    const canvasElRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<PenRenderer | null>(null);
    const liveApiRef = useRef<CanvasApi | null>(null);
    const apiReadyNotifiedRef = useRef(false);
    const { ckError, ckReady, ckRef } = useCanvasKitRuntime();
    const [rendererReady, setRendererReady] = useState(false);
    const canvasKit = ckRef.current;

    const runtimeStoreRef = useRef<CanvasRuntimeStore | null>(null);
    if (!runtimeStoreRef.current) {
      runtimeStoreRef.current = createCanvasRuntimeStore(
        normalizeRuntimeDocument(initialContent),
      );
    }
    const runtimeStore = runtimeStoreRef.current;
    const initialRuntimeState = runtimeStore.getState();
    const docRef = useRef(getCanvasApiDocument(initialRuntimeState));
    const documentVersionRef = useRef(initialRuntimeState.version);
    const activePageIdRef = useRef(initialRuntimeState.activePageId);
    const selectedIdsRef = useRef<string[]>(initialRuntimeState.selection);
    const activeToolRef = useRef<CanvasTool>(initialRuntimeState.activeTool);
    const sceneSnapshotRef = useRef<CanvasSceneSnapshot>(
      buildCanvasSceneSnapshot(
        docRef.current,
        activePageIdRef.current,
        selectedIdsRef.current,
      ),
    );
    const sceneSnapshotCacheKeyRef = useRef(
      getSceneSnapshotCacheKey(
        documentVersionRef.current,
        activePageIdRef.current,
        selectedIdsRef.current,
      ),
    );

    const listenersRef = useRef(new Set<CanvasChangeListener>());
    const rendererIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const marqueeRafRef = useRef<number | null>(null);
    const viewportPanRafRef = useRef<number | null>(null);
    const pendingViewportPanRef = useRef<{
      x: number;
      y: number;
      zoom: number;
    } | null>(null);
    const rendererDocumentSyncRafRef = useRef<number | null>(null);
    const pendingRendererDocumentSyncRef =
      useRef<PendingRendererDocumentSync | null>(null);
    const sceneNotificationRafRef = useRef<number | null>(null);
    const pendingSceneNotificationRef = useRef<{
      activePageId: string;
      doc: PenDocument;
      selection: readonly string[];
    } | null>(null);
    const documentChangeRafRef = useRef<number | null>(null);
    const pendingDocumentChangeRef = useRef<CucumberCanvasDocument | null>(
      null,
    );
    const marqueeSelectionRef = useRef<string[]>([]);
    const editorOverlayRef = useRef<EditorOverlayState>({
      selectedIds: [],
      selectionColor: CANVAS_SELECTION_COLOR,
      marquee: null,
      shapePreview: null,
      linePreview: null,
      penPreview: null,
    });
    const suppressNextClickRef = useRef(false);
    const booleanRuntimeStatus = useBooleanVectorRuntime();

    const activeTool = useStore(runtimeStore, selectCanvasActiveTool);
    const effectiveTool = useSpaceHandTool(activeTool);

    const dragRef = useRef<DragState | null>(null);
    const clipboardRef = useRef<CanvasClipboardData | null>(null);
    const toast = useToast();

    const flushScheduledRendererDocumentSync = useCallback(() => {
      rendererDocumentSyncRafRef.current = null;
      const pending = pendingRendererDocumentSyncRef.current;
      if (!pending) return;

      if (dragRef.current) {
        if (!pending.deferredForDrag) {
          pending.deferredForDrag = true;
          console.info("[skia-canvas] renderer.document-sync.deferred", {
            activePageId: pending.activePageId,
            reason: "active_drag",
            source: pending.source,
            version: pending.version,
          });
        }
        rendererDocumentSyncRafRef.current = requestAnimationFrame(
          flushScheduledRendererDocumentSync,
        );
        return;
      }

      pendingRendererDocumentSyncRef.current = null;
      syncRendererDocument(
        rendererRef.current,
        pending.document,
        pending.activePageId,
      );
      if (pending.deferredForDrag || pending.coalescedCount > 1) {
        console.info("[skia-canvas] renderer.document-sync.flushed", {
          activePageId: pending.activePageId,
          coalescedCount: pending.coalescedCount,
          deferredForDrag: pending.deferredForDrag,
          source: pending.source,
          version: pending.version,
        });
      }
    }, []);

    const scheduleRendererDocumentSync = useCallback(
      (
        document: PenDocument,
        activePageId: string,
        version: number,
        source: string,
      ) => {
        const previous = pendingRendererDocumentSyncRef.current;
        pendingRendererDocumentSyncRef.current = {
          activePageId,
          coalescedCount: (previous?.coalescedCount ?? 0) + 1,
          deferredForDrag: previous?.deferredForDrag ?? false,
          document,
          source,
          version,
        };
        if (rendererDocumentSyncRafRef.current !== null) return;
        rendererDocumentSyncRafRef.current = requestAnimationFrame(
          flushScheduledRendererDocumentSync,
        );
      },
      [flushScheduledRendererDocumentSync],
    );

    const flushRendererDocumentSyncBeforeInteraction = useCallback(() => {
      if (!pendingRendererDocumentSyncRef.current || dragRef.current) return;
      if (rendererDocumentSyncRafRef.current !== null) {
        cancelAnimationFrame(rendererDocumentSyncRafRef.current);
      }
      flushScheduledRendererDocumentSync();
    }, [flushScheduledRendererDocumentSync]);

    const setEditorOverlay = useCallback(
      (overlay: Partial<EditorOverlayState>) => {
        editorOverlayRef.current = {
          ...editorOverlayRef.current,
          ...overlay,
          selectedIds:
            overlay.selectedIds ?? editorOverlayRef.current.selectedIds,
          selectionColor: CANVAS_SELECTION_COLOR,
        };
        rendererRef.current?.setEditorOverlays(editorOverlayRef.current);
      },
      [],
    );

    const setMarqueeDomOverlay = useCallback((bounds: CanvasBounds | null) => {
      const el = marqueeOverlayElRef.current;
      if (!el) return;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        el.style.display = "none";
        return;
      }

      const renderer = rendererRef.current;
      if (!renderer) {
        el.style.display = "none";
        return;
      }

      const viewport = renderer.getViewport();
      const topLeft = sceneToCanvasLocal(bounds.x, bounds.y, viewport);
      const width = Math.max(bounds.width * viewport.zoom, 1);
      const height = Math.max(bounds.height * viewport.zoom, 1);

      el.style.display = "block";
      el.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }, []);

    const getPointerScenePoint = useCallback(
      (event: { clientX: number; clientY: number }) => {
        const renderer = rendererRef.current;
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!renderer || !rect) return null;
        return screenToScene(
          event.clientX,
          event.clientY,
          rect,
          renderer.getViewport(),
        );
      },
      [],
    );

    const getConnectorSnap = useCallback(
      (
        point: { x: number; y: number },
        options?: { excludeNodeIds?: Iterable<string> },
      ) =>
        findConnectorSnapTarget(docRef.current, point, {
          activePageId: activePageIdRef.current,
          excludeNodeIds: options?.excludeNodeIds,
        }),
      [],
    );

    const getLiveViewportPlacement = useCallback(() => {
      const renderer = rendererRef.current;
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      return {
        viewport: renderer?.getViewport() ?? null,
        rect: rect ?? null,
      };
    }, []);

    const scheduleRendererIdle = useCallback(
      (delayMs = 120) => {
        if (rendererIdleTimerRef.current) {
          clearTimeout(rendererIdleTimerRef.current);
        }
        rendererIdleTimerRef.current = setTimeout(() => {
          rendererIdleTimerRef.current = null;
          const renderer = rendererRef.current;
          renderer?.setInteractionMode("idle");
          const viewport = renderer?.getViewport();
          if (viewport) {
            runtimeStore.getState().setViewportSnapshot({
              x: viewport.panX,
              y: viewport.panY,
              zoom: viewport.zoom,
            });
          }
        }, delayMs);
      },
      [runtimeStore],
    );

    usePenRendererLifecycle({
      activePageIdRef,
      canvasContainerRef,
      canvasElRef,
      canvasKit,
      ckReady,
      documentChangeRafRef,
      docRef,
      editorOverlayRef,
      marqueeRafRef,
      onRendererReadyChange: setRendererReady,
      pendingDocumentChangeRef,
      pendingRendererDocumentSyncRef,
      pendingSceneNotificationRef,
      rendererDocumentSyncRafRef,
      rendererIdleTimerRef,
      rendererRef,
      runtimeStore,
      sceneNotificationRafRef,
    });

    // -----------------------------------------------------------------------
    // Document commit helper
    // -----------------------------------------------------------------------

    const notifySceneListeners = useCallback(
      (
        next: PenDocument,
        activePageId: string,
        selection: readonly string[],
      ) => {
        if (listenersRef.current.size === 0) return;
        pendingSceneNotificationRef.current = {
          activePageId,
          doc: next,
          selection,
        };
        if (sceneNotificationRafRef.current !== null) return;
        sceneNotificationRafRef.current = requestAnimationFrame(() => {
          sceneNotificationRafRef.current = null;
          const pending = pendingSceneNotificationRef.current;
          pendingSceneNotificationRef.current = null;
          if (!pending) return;
          const snapshot = buildCanvasSceneSnapshot(
            pending.doc,
            pending.activePageId,
            pending.selection,
            rendererRef.current?.getViewport(),
          );
          sceneSnapshotRef.current = snapshot;
          sceneSnapshotCacheKeyRef.current = getSceneSnapshotCacheKey(
            documentVersionRef.current,
            pending.activePageId,
            pending.selection,
            rendererRef.current?.getViewport(),
          );
          if (snapshot.index.elements.length > 1000) {
            console.info("[skia-canvas] scene.snapshot.dispatched", {
              listenerCount: listenersRef.current.size,
              nodeCount: snapshot.index.nodeById.size,
              visibleCount: snapshot.index.elements.length,
            });
          }
          for (const listener of listenersRef.current) {
            listener(snapshot.index.elements, snapshot.state, snapshot.files);
          }
        });
      },
      [],
    );

    const scheduleDocumentChange = useCallback(
      (next: CucumberCanvasDocument) => {
        if (!onDocumentChange) return;
        pendingDocumentChangeRef.current = next;
        if (documentChangeRafRef.current !== null) return;
        documentChangeRafRef.current = requestAnimationFrame(() => {
          documentChangeRafRef.current = null;
          const pending = pendingDocumentChangeRef.current;
          pendingDocumentChangeRef.current = null;
          if (!pending) return;
          onDocumentChange?.(pending);
        });
      },
      [onDocumentChange],
    );

    const flushScheduledDocumentChange = useCallback(() => {
      if (documentChangeRafRef.current !== null) {
        cancelAnimationFrame(documentChangeRafRef.current);
        documentChangeRafRef.current = null;
      }
      const pending = pendingDocumentChangeRef.current;
      pendingDocumentChangeRef.current = null;
      if (!pending) return;
      onDocumentChange?.(pending);
    }, [onDocumentChange]);

    useEffect(
      () =>
        runtimeStore.subscribe(
          (state) => state.activeTool,
          (tool) => {
            activeToolRef.current = tool;
          },
        ),
      [runtimeStore],
    );

    useEffect(
      () =>
        runtimeStore.subscribe(
          (state) => state.version,
          (version, previousVersion) => {
            if (version === previousVersion) return;
            const state = runtimeStore.getState();
            const committed = getCanvasApiDocument(state);
            docRef.current = committed;
            activePageIdRef.current = state.activePageId;
            selectedIdsRef.current = state.selection;
            documentVersionRef.current = state.version;
            setEditorOverlay({ selectedIds: state.selection });
            scheduleRendererDocumentSync(
              committed,
              state.activePageId,
              state.version,
              state.lastDocumentCommit?.source ?? "document.commit",
            );
            if (state.lastDocumentCommit?.notifyDocumentChange) {
              scheduleDocumentChange(committed as CucumberCanvasDocument);
            }
            notifySceneListeners(
              committed,
              state.activePageId,
              state.selection,
            );
          },
        ),
      [
        notifySceneListeners,
        runtimeStore,
        scheduleDocumentChange,
        scheduleRendererDocumentSync,
        setEditorOverlay,
      ],
    );

    useEffect(
      () =>
        runtimeStore.subscribe(
          (state) => state.selectionRevision,
          (revision, previousRevision) => {
            if (revision === previousRevision) return;
            const state = runtimeStore.getState();
            const currentDocument = getCanvasApiDocument(state);
            docRef.current = currentDocument;
            activePageIdRef.current = state.activePageId;
            selectedIdsRef.current = state.selection;
            setEditorOverlay({ selectedIds: state.selection });
            const meta = state.lastSelectionCommit;
            if (meta?.notifyScene) {
              notifySceneListeners(
                currentDocument,
                state.activePageId,
                state.selection,
              );
            }
            if (meta?.notifySelection) {
              const snapshot = buildCanvasSceneSnapshot(
                currentDocument,
                state.activePageId,
                state.selection,
                rendererRef.current?.getViewport(),
              );
              sceneSnapshotRef.current = snapshot;
              sceneSnapshotCacheKeyRef.current = getSceneSnapshotCacheKey(
                state.version,
                state.activePageId,
                state.selection,
                rendererRef.current?.getViewport(),
              );
              onSelectionChange?.(
                state.selection
                  .map((id) => snapshot.index.elementById.get(id))
                  .filter((element): element is CanvasSceneElement =>
                    Boolean(element),
                  ),
              );
            }
          },
        ),
      [notifySceneListeners, onSelectionChange, runtimeStore, setEditorOverlay],
    );

    useEffect(
      () =>
        runtimeStore.subscribe(
          (state) => state.viewport,
          (viewport, previousViewport) => {
            if (viewport === previousViewport) return;
            const state = runtimeStore.getState();
            const currentDocument = getCanvasApiDocument(state);
            docRef.current = currentDocument;
            notifySceneListeners(
              currentDocument,
              state.activePageId,
              state.selection,
            );
          },
        ),
      [notifySceneListeners, runtimeStore],
    );

    const commitDocument = useCallback(
      (
        next: PenDocument,
        opts?: {
          captureHistory?: boolean;
          notify?: boolean;
          selection?: string[];
        },
      ): CanvasRuntimeCommitResult => {
        const result = runtimeStore.getState().commitDocument(next, opts);
        docRef.current = result.document;
        activePageIdRef.current = result.activePageId;
        selectedIdsRef.current = result.selection;
        documentVersionRef.current = result.version;
        return result;
      },
      [runtimeStore],
    );

    const syncCommittedDocumentToRenderer = useCallback(
      (commit: CanvasRuntimeCommitResult, reason: string) => {
        const renderer = rendererRef.current;
        if (!renderer) return;

        if (rendererDocumentSyncRafRef.current !== null) {
          cancelAnimationFrame(rendererDocumentSyncRafRef.current);
          rendererDocumentSyncRafRef.current = null;
        }
        const pending = pendingRendererDocumentSyncRef.current;
        if (!pending || pending.version <= commit.version) {
          pendingRendererDocumentSyncRef.current = null;
        } else {
          rendererDocumentSyncRafRef.current = requestAnimationFrame(
            flushScheduledRendererDocumentSync,
          );
        }

        syncRendererDocument(renderer, commit.document, commit.activePageId);
        flushScheduledDocumentChange();
        console.info("[skia-canvas] renderer.document-sync.immediate", {
          activePageId: commit.activePageId,
          reason,
          version: commit.version,
        });
      },
      [flushScheduledDocumentChange, flushScheduledRendererDocumentSync],
    );

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    const setSelection = useCallback(
      (
        nodeIds: string[],
        opts?: { notifyScene?: boolean; notifySelection?: boolean },
      ) => {
        const validIds = runtimeStore.getState().setSelection(nodeIds, opts);
        selectedIdsRef.current = validIds;
      },
      [runtimeStore],
    );

    const setActiveTool = useCallback(
      (tool: CanvasTool) => {
        runtimeStore.getState().setActiveTool(tool);
        activeToolRef.current = tool;
      },
      [runtimeStore],
    );

    const {
      beginTextEdit,
      commitTextEdit,
      editingStickyNameId,
      editingText,
      setEditingStickyNameId,
      textEditTextareaRef,
      updateTextEditDraft,
    } = useSkiaTextEditing({
      activePageIdRef,
      commitDocument,
      docRef,
      pendingRendererDocumentSyncRef,
      rendererDocumentSyncRafRef,
      rendererRef,
      setSelection,
    });

    const penTool = usePenTool({
      onCommit: (anchors, closed) => {
        const pathPatch = bakePenAnchorsToPathData(anchors, closed, {
          x: 0,
          y: 0,
        });
        if (!pathPatch) {
          console.info("[skia-canvas] pen.draw.cancelled", {
            reason: "empty_path",
            anchorCount: anchors.length,
          });
          setActiveTool("select");
          return;
        }
        const node: PenNode = {
          id: createNodeId("path"),
          type: "path",
          name: "Path",
          ...pathPatch,
          fill: [{ type: "solid", color: "transparent" }],
          stroke: {
            thickness: 2,
            fill: [{ type: "solid", color: "#111827" }],
          },
        } as PenNode;
        const next = applyCanvasOperation(docRef.current, {
          type: "insertNode",
          node,
          activePageId: activePageIdRef.current,
        });
        commitDocument(next, { selection: [node.id] });
        setSelection([node.id], { notifyScene: false });
        setActiveTool("select");
        suppressNextClickRef.current = true;
        console.info("[skia-canvas] pen.path.created", {
          nodeId: node.id,
          closed,
          anchorCount: anchors.length,
          width: Math.round(pathPatch.width),
          height: Math.round(pathPatch.height),
        });
      },
      onCancel: () => {
        setActiveTool("select");
        console.info("[skia-canvas] pen.draw.cancelled", {
          reason: "user_cancelled",
        });
      },
    });

    useEffect(() => {
      setEditorOverlay({ penPreview: penTool.preview });
    }, [penTool.preview, setEditorOverlay]);

    const {
      contextMenu,
      handleAuxClick,
      handleCanvasClick,
      handleContextMenu,
      handleDoubleClick,
      handlePointerDown,
      handlePointerLeave,
      handlePointerMove,
      handlePointerUp,
      closeContextMenu,
    } = useSkiaPointerInteractions({
      activePageIdRef,
      activeToolRef,
      beginTextEdit,
      canvasContainerRef,
      canvasRootRef,
      ckReady,
      commitDocument,
      docRef,
      dragRef,
      effectiveTool,
      flushRendererDocumentSyncBeforeInteraction,
      getConnectorSnap,
      getPointerScenePoint,
      marqueeRafRef,
      marqueeSelectionRef,
      pendingViewportPanRef,
      penTool,
      rendererRef,
      runtimeStore,
      scheduleRendererIdle,
      selectedIdsRef,
      setActiveTool,
      setEditingStickyNameId,
      setEditorOverlay,
      setMarqueeDomOverlay,
      setSelection,
      suppressNextClickRef,
      syncCommittedDocumentToRenderer,
      viewportPanRafRef,
    });

    // -----------------------------------------------------------------------
    // CanvasApi
    // -----------------------------------------------------------------------

    const {
      api,
      createContainer,
      copySelection,
      cutSelection,
      pasteClipboard,
      pasteFromSystemClipboard,
      duplicateSelection,
      deleteSelection,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      importSvgMarkup,
      isFileDragActive,
    } = useSkiaCanvasApi({
      accessToken,
      activePageIdRef,
      activeToolRef,
      booleanRuntimeStatus,
      canvasContainerRef,
      clipboardRef,
      commitDocument,
      docRef,
      documentVersionRef,
      getConnectorSnap,
      getLiveViewportPlacement,
      getPointerScenePoint,
      listenersRef,
      onSelectionChange,
      projectId,
      rendererRef,
      runtimeStore,
      scheduleRendererIdle,
      sceneSnapshotCacheKeyRef,
      sceneSnapshotRef,
      selectedIdsRef,
      setActiveTool,
      setSelection,
      syncCommittedDocumentToRenderer,
      toast,
    });

    liveApiRef.current = api;

    const stableApi = useMemo<CanvasApi>(() => {
      const getLiveApi = () => {
        const liveApi = liveApiRef.current;
        if (!liveApi) {
          throw new Error("Canvas API is not ready yet.");
        }
        return liveApi;
      };
      return createCanvasApiFacade(getLiveApi);
    }, []);

    useImperativeHandle(ref, () => stableApi, [stableApi]);

    useEffect(() => {
      if (!onApiReady || apiReadyNotifiedRef.current) return;
      apiReadyNotifiedRef.current = true;
      onApiReady(stableApi);
    }, [onApiReady, stableApi]);

    const { handleImportImage, handleImportSvg } =
      useSkiaKeyboardAndToolbarActions({
        activePageIdRef,
        api,
        beginTextEdit,
        commitDocument,
        copySelection,
        cutSelection,
        deleteSelection,
        docRef,
        duplicateSelection,
        pasteClipboard,
        pasteFromSystemClipboard,
        selectedIdsRef,
        setActiveTool,
        setSelection,
        toast,
      });

    // -----------------------------------------------------------------------
    // Initial document sync
    // -----------------------------------------------------------------------

    // biome-ignore lint/correctness/useExhaustiveDependencies: initial content should resync only when CanvasKit becomes ready.
    useEffect(() => {
      if (!ckReady || !rendererRef.current) return;
      const next = normalizeRuntimeDocument(initialContent);
      commitDocument(next, { captureHistory: false });
      rendererRef.current.zoomToFit(64);
      const viewport = rendererRef.current.getViewport();
      runtimeStore.getState().setViewportSnapshot({
        x: viewport.panX,
        y: viewport.panY,
        zoom: viewport.zoom,
      });
      rendererRef.current.setEditorOverlays(editorOverlayRef.current);
    }, [ckReady]);

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    if (ckError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-white">
          <div className="text-center space-y-3">
            <p className="text-sm text-destructive">CanvasKit 加载失败</p>
            <p className="text-xs text-muted-foreground">{ckError}</p>
          </div>
        </div>
      );
    }

    if (!ckReady) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-white">
          <p className="text-sm text-muted-foreground">Loading CanvasKit...</p>
        </div>
      );
    }

    const cursorClass =
      effectiveTool === "hand"
        ? "cursor-grab"
        : effectiveTool === "select"
          ? "cursor-default"
          : "cursor-crosshair";
    const textEditOverlay =
      editingText && rendererRef.current
        ? projectTextEditStateToViewport(
            editingText,
            rendererRef.current.getViewport(),
          )
        : null;
    const editingStickyNameNode = editingStickyNameId
      ? findNode(docRef.current, editingStickyNameId, activePageIdRef.current)
      : null;
    const editingStickyNameBounds =
      editingStickyNameNode && isStickyNoteNode(editingStickyNameNode)
        ? getNodeSceneBounds(
            docRef.current,
            editingStickyNameNode.id,
            activePageIdRef.current,
          )
        : null;
    const editingStickyNameViewport =
      rendererRef.current?.getViewport() ?? null;

    return (
      <CanvasRuntimeStoreProvider store={runtimeStore}>
        <div
          ref={canvasRootRef}
          className={`relative h-full w-full overflow-hidden ${cursorClass}`}
          style={{ backgroundColor: "#ffffff" }}
          onAuxClick={handleAuxClick}
          onClick={handleCanvasClick}
          onContextMenu={handleContextMenu}
          onKeyDown={() => undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* CanvasKit canvas container */}
          <div ref={canvasContainerRef} className="absolute inset-0" />

          {isFileDragActive ? (
            <div className="pointer-events-none absolute inset-3 z-30 rounded-lg border border-dashed border-primary/60 bg-background/65 shadow-inner backdrop-blur-[2px]">
              <div className="flex h-full items-center justify-center">
                <div className="rounded-lg border border-border bg-card/90 px-4 py-2 text-sm font-medium text-foreground shadow-card">
                  释放文件进入画布
                </div>
              </div>
            </div>
          ) : null}

          <CanvasTextEditOverlay
            editingText={editingText}
            overlay={textEditOverlay}
            textareaRef={textEditTextareaRef}
            onCommit={commitTextEdit}
            onDraftChange={updateTextEditDraft}
          />

          {editingStickyNameNode &&
          editingStickyNameBounds &&
          editingStickyNameViewport ? (
            <StickyNameEditOverlay
              bounds={editingStickyNameBounds}
              name={editingStickyNameNode.name ?? "Sticky"}
              nodeId={editingStickyNameNode.id}
              viewport={editingStickyNameViewport}
              onCancel={() => {
                console.info("[skia-canvas] sticky.name.edit.cancelled", {
                  stickyId: editingStickyNameNode.id,
                });
                setEditingStickyNameId(null);
              }}
              onCommit={(name) => {
                const nextName = name.trim() || "Sticky";
                api.updateNode(editingStickyNameNode.id, {
                  name: nextName,
                } as Partial<PenNode>);
                console.info("[skia-canvas] sticky.name.edit.committed", {
                  stickyId: editingStickyNameNode.id,
                  emptyInput: name.trim().length === 0,
                  nameLength: nextName.length,
                });
                setEditingStickyNameId(null);
              }}
            />
          ) : null}

          <div
            ref={marqueeOverlayElRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-20 hidden border border-sky-400 bg-sky-400/10"
            style={{ willChange: "transform,width,height" }}
          />

          {/* Toolbar overlays */}
          <CanvasEditorToolbarConnected
            api={api}
            onCreateContainer={() => createContainer()}
            onInsertIcon={onInsertIcon}
            onImportImage={handleImportImage}
            onImportSvg={handleImportSvg}
            onToolChange={setActiveTool}
          />

          <CanvasSelectionToolbarConnected
            api={api}
            canvasRect={canvasContainerRef.current?.getBoundingClientRect()}
            onContinueAgentExecution={onContinueAgentExecution}
          />

          <AgentRunNodeContentLayer api={api} />

          <CanvasContextMenu
            api={api}
            menu={contextMenu}
            onClose={closeContextMenu}
          />

          <CanvasBooleanToolbarConnected
            booleanRuntimeStatus={booleanRuntimeStatus}
            onBooleanOperation={api.applyBooleanOperation}
          />

          {/* Property panel */}
          <CanvasPropertyPanelConnected
            api={api}
            commitDocument={commitDocument}
            onContinueAgentExecution={onContinueAgentExecution}
          />

          {/* Loading indicator while CK initializes */}
          {!rendererReady && ckReady ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50">
              <p className="text-sm text-muted-foreground">
                Initializing renderer...
              </p>
            </div>
          ) : null}
        </div>
      </CanvasRuntimeStoreProvider>
    );
  }),
);
