"use client";

import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  applyCanvasOperation,
  applyCanvasTransaction,
  detachConnectorEndpoint as detachConnectorEndpointBinding,
  findNode,
  findParent,
  formatAgentExecutionCanvasBody,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionCanvasFrameUpdates,
  getAgentExecutionContainerMeta,
  getAgentExecutionMeta,
  getLineEndpoints,
  getNodeBounds,
  getNodeSceneBounds,
  isDescendantOf,
  measureAgentExecutionComponentLayout,
  reparentNodesByDropPoint,
  toggleAgentExecutionCanvasCollapsed,
} from "@cucumber/canvas-core";
import type {
  LineNode,
  PenConnectorEndpointBinding,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import type { CanvasTool } from "./canvas-api";
import {
  calculateResizeBounds,
  createDrawableCanvasNode,
  createLineNode,
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
import {
  type AgentCheckpointHoverState,
  type AgentExecutionHoverState,
  type CanvasContextMenuState,
  getAgentCheckpointToolbarState,
  getAgentExecutionHoverState,
} from "./canvas-overlays";
import type {
  CanvasRuntimeCommitResult,
  CanvasRuntimeStore,
} from "./canvas-runtime-store";
import {
  areStringArraysEqual,
  getCanvasApiRuntimeState,
  getDocumentSelection,
} from "./canvas-runtime-utils";
import {
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  MIN_TEXT_BOX_SIZE,
  getLineHeightPx,
} from "./canvas-text-measure";
import { getResizeNodeUpdates } from "./canvas-text-resize";
import {
  MIN_DRAW_SIZE,
  MOVE_COMMIT_THRESHOLD_PX,
  TEXT_DRAG_THRESHOLD_PX,
  WHEEL_ZOOM_SENSITIVITY,
  assertPositiveFiniteZoom,
  normalizeWheelDeltaY,
} from "./skia-canvas-constants";
import type { DragState, MutableRef } from "./skia-canvas-types";
import {
  createStickyNoteNode,
  findStickyNoteTextNode,
  getLinkedStickyBounds,
  getOppositeStickyConnectorSide,
  getSelectableStickyHitNode,
  getStickyConnectorPoint,
  getStickyNoteContainerForNode,
  isStickyNoteNode,
} from "./sticky-note-tool";

type PenToolRuntime = {
  onDblClick: () => boolean;
  onKeyDown: (key: string) => boolean;
  onMouseDown: (point: { x: number; y: number }, zoom: number) => boolean;
  onMouseMove: (point: { x: number; y: number }) => void;
  onMouseUp: () => void;
};

type UseSkiaPointerInteractionsOptions = {
  activePageIdRef: MutableRef<string>;
  activeToolRef: MutableRef<CanvasTool>;
  beginTextEdit: (
    node: PenNode,
    opts?: {
      isNew?: boolean;
      bounds?: CanvasBounds;
      selectionDuringEdit?: string[];
      commitSelection?: string[];
    },
  ) => boolean;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  canvasRootRef: React.RefObject<HTMLDivElement | null>;
  ckReady: boolean;
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  docRef: MutableRef<PenDocument>;
  dragRef: MutableRef<DragState | null>;
  effectiveTool: CanvasTool;
  flushRendererDocumentSyncBeforeInteraction: () => void;
  getConnectorSnap: (
    point: { x: number; y: number },
    options?: { excludeNodeIds?: Iterable<string> },
  ) => ReturnType<
    typeof import("@cucumber/canvas-core").findConnectorSnapTarget
  >;
  hasAgentContinuationHandler?: boolean;
  getPointerScenePoint: (event: { clientX: number; clientY: number }) => {
    x: number;
    y: number;
  } | null;
  marqueeRafRef: MutableRef<number | null>;
  marqueeSelectionRef: MutableRef<string[]>;
  pendingViewportPanRef: MutableRef<{
    x: number;
    y: number;
    zoom: number;
  } | null>;
  penTool: PenToolRuntime;
  rendererRef: MutableRef<import("@cucumber/pen-renderer").PenRenderer | null>;
  runtimeStore: CanvasRuntimeStore;
  scheduleRendererIdle: (delayMs?: number) => void;
  selectedIdsRef: MutableRef<string[]>;
  setActiveTool: (tool: CanvasTool) => void;
  setEditingStickyNameId: (nodeId: string | null) => void;
  setEditorOverlay: (
    overlay: Partial<import("@cucumber/pen-renderer").EditorOverlayState>,
  ) => void;
  setMarqueeDomOverlay: (bounds: CanvasBounds | null) => void;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
  suppressNextClickRef: MutableRef<boolean>;
  syncCommittedDocumentToRenderer: (
    commit: CanvasRuntimeCommitResult,
    reason: string,
  ) => void;
  viewportPanRafRef: MutableRef<number | null>;
};

export function useSkiaPointerInteractions({
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
  hasAgentContinuationHandler,
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
}: UseSkiaPointerInteractionsOptions) {
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(
    null,
  );
  const [hoveredCheckpoint, setHoveredCheckpoint] =
    useState<AgentCheckpointHoverState | null>(null);
  const [hoveredAgentExecution, setHoveredAgentExecution] =
    useState<AgentExecutionHoverState | null>(null);
  useEffect(
    () => () => {
      if (viewportPanRafRef.current !== null) {
        cancelAnimationFrame(viewportPanRafRef.current);
        viewportPanRafRef.current = null;
      }
    },
    [viewportPanRafRef],
  );

  // -----------------------------------------------------------------------
  // Hit testing (click to select)
  // -----------------------------------------------------------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('[data-canvas-overlay="selection-toolbar"]')) {
        return;
      }
      const renderer = rendererRef.current;
      if (!renderer) return;
      const hit = getSelectableStickyHitNode(
        docRef.current as CucumberCanvasDocument,
        renderer.hitTest(event.clientX, event.clientY),
        activePageIdRef.current,
      );

      if (event.shiftKey) {
        if (!hit) return;
        const currentSelection = selectedIdsRef.current;
        const next = currentSelection.includes(hit.id)
          ? currentSelection.filter((id) => id !== hit.id)
          : [...currentSelection, hit.id];
        setSelection(next);
      } else {
        setSelection(hit ? [hit.id] : []);
      }
    },
    [setSelection],
  );

  // -----------------------------------------------------------------------
  // Wheel → zoom
  // -----------------------------------------------------------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.cancelable) event.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) return;
      const vp = renderer.getViewport();
      const normalizedDeltaY = normalizeWheelDeltaY(event);
      if (normalizedDeltaY === 0) return;
      const newZoom =
        vp.zoom * Math.exp(-normalizedDeltaY * WHEEL_ZOOM_SENSITIVITY);
      assertPositiveFiniteZoom(newZoom);
      renderer.setInteractionMode("viewport");
      renderer.zoomToPoint(event.clientX, event.clientY, newZoom);
      const viewport = renderer.getViewport();
      runtimeStore.getState().setViewportSnapshot({
        x: viewport.panX,
        y: viewport.panY,
        zoom: viewport.zoom,
      });
      console.debug("[skia-canvas] viewport.zoom.shortcut", {
        deltaY: Math.round(normalizedDeltaY),
        modifier: event.metaKey ? "meta" : "ctrl",
        zoom: Number(viewport.zoom.toFixed(4)),
      });
      scheduleRendererIdle();
    },
    [runtimeStore, scheduleRendererIdle],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  useEffect(() => {
    if (!ckReady) return;
    const root = canvasRootRef.current;
    if (!root) return;
    root.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", handleWheel);
    };
  }, [ckReady, handleWheel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const scheduleViewportPanSnapshot = useCallback(
    (viewport: { panX: number; panY: number; zoom: number }) => {
      pendingViewportPanRef.current = {
        x: viewport.panX,
        y: viewport.panY,
        zoom: viewport.zoom,
      };
      if (viewportPanRafRef.current !== null) return;
      viewportPanRafRef.current = requestAnimationFrame(() => {
        viewportPanRafRef.current = null;
        const pending = pendingViewportPanRef.current;
        pendingViewportPanRef.current = null;
        if (!pending) return;
        runtimeStore.getState().setViewportSnapshot(pending);
      });
    },
    [runtimeStore],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const endViewportPan = useCallback(
    (reason: string) => {
      const drag = dragRef.current;
      if (drag?.kind !== "pan") return false;
      dragRef.current = null;
      const root = canvasRootRef.current;
      if (root?.hasPointerCapture(drag.pointerId)) {
        root.releasePointerCapture(drag.pointerId);
      }
      scheduleRendererIdle();
      const viewport = rendererRef.current?.getViewport();
      if (viewportPanRafRef.current !== null) {
        cancelAnimationFrame(viewportPanRafRef.current);
        viewportPanRafRef.current = null;
      }
      pendingViewportPanRef.current = null;
      if (viewport) {
        runtimeStore.getState().setViewportSnapshot({
          x: viewport.panX,
          y: viewport.panY,
          zoom: viewport.zoom,
        });
      }
      console.info("[skia-canvas] viewport.pan.ended", {
        reason,
        button: drag.button,
        zoom: viewport?.zoom,
      });
      return true;
    },
    [runtimeStore, scheduleRendererIdle],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  useEffect(() => {
    const handlePointerRelease = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.kind !== "pan" || drag.pointerId !== event.pointerId) return;
      endViewportPan("window_pointer_release");
    };
    const handleMouseRelease = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (drag?.kind !== "pan" || drag.button !== event.button) return;
      endViewportPan("window_mouse_release");
    };
    const handleBlur = () => {
      endViewportPan("window_blur");
    };

    window.addEventListener("pointerup", handlePointerRelease, true);
    window.addEventListener("pointercancel", handlePointerRelease, true);
    window.addEventListener("mouseup", handleMouseRelease, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerRelease, true);
      window.removeEventListener("pointercancel", handlePointerRelease, true);
      window.removeEventListener("mouseup", handleMouseRelease, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [endViewportPan]);

  // -----------------------------------------------------------------------
  // Pointer events (pan, marquee, move)
  // -----------------------------------------------------------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      setContextMenu(null);
      setHoveredCheckpoint(null);
      setHoveredAgentExecution(null);
      flushRendererDocumentSyncBeforeInteraction();
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pointerButton = event.button ?? 0;

      // Middle button → pan
      if (pointerButton === 1) {
        event.preventDefault();
        const vp = renderer.getViewport();
        renderer.setInteractionMode("viewport");
        dragRef.current = {
          kind: "pan",
          button: pointerButton,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: vp.panX,
          originY: vp.panY,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (pointerButton !== 0) return;

      const tool = effectiveTool === "hand" ? "hand" : activeToolRef.current;
      if (tool === "hand") {
        const vp = renderer.getViewport();
        renderer.setInteractionMode("viewport");
        dragRef.current = {
          kind: "pan",
          button: pointerButton,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: vp.panX,
          originY: vp.panY,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const scenePoint = getPointerScenePoint(event);
      if (!scenePoint) return;

      // Marquee selection
      const activePageId = activePageIdRef.current;
      const rawHit = renderer.hitTest(event.clientX, event.clientY);
      const hit = getSelectableStickyHitNode(
        docRef.current as CucumberCanvasDocument,
        rawHit,
        activePageId,
      );

      if (tool === "select") {
        const toggledExecutionNode = getAgentExecutionToggleTarget(
          docRef.current,
          activePageId,
          rawHit?.id ?? hit?.id,
          scenePoint,
        );
        if (toggledExecutionNode) {
          const toggled =
            toggleAgentExecutionCanvasCollapsed(toggledExecutionNode);
          const execution = getAgentExecutionMeta(toggled);
          if (!execution) return;
          const executionContainer = getAgentExecutionContainerMeta(toggled);
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: toggled.id,
            updates: {
              meta: toggled.meta,
              ...getAgentExecutionCanvasFrameUpdates({
                body: formatAgentExecutionCanvasBody(
                  execution,
                  executionContainer,
                ),
                bounds: { width: getNodeBounds(toggled).width },
                collapsed: getAgentExecutionCanvasCollapsed(execution),
                execution,
              }),
            } as Partial<PenNode>,
            activePageId,
          });
          commitDocument(next, { selection: [toggled.id] });
          setSelection([toggled.id], { notifyScene: false });
          suppressNextClickRef.current = true;
          event.preventDefault();
          event.stopPropagation();
          const nextToggledNode = findNode(next, toggled.id, activePageId);
          console.info("[canvas-agent-execution-layout] toggle", {
            collapsed: getAgentExecutionCanvasCollapsed(execution),
            height: nextToggledNode
              ? getNodeBounds(nextToggledNode).height
              : undefined,
            kind: execution.kind,
            nodeId: toggled.id,
            overflowed: measureAgentExecutionComponentLayout(
              execution,
              getNodeBounds(toggled).width,
              !getAgentExecutionCanvasCollapsed(execution),
              executionContainer
                ? {
                    minHeight: getNodeBounds(toggled).height,
                  }
                : {},
            ).hasOverflow,
          });
          return;
        }

        const controlHit = renderer.hitTestSelectionControl(
          event.clientX,
          event.clientY,
        );
        if (controlHit) {
          const node = findNode(
            docRef.current,
            controlHit.nodeId,
            activePageId,
          );
          if (!node || node.locked) return;
          const localBounds = getNodeBounds(node);
          const sceneBounds =
            getNodeSceneBounds(docRef.current, node.id, activePageId) ??
            localBounds;
          if (
            controlHit.type === "sticky-connector" &&
            isStickyNoteNode(node)
          ) {
            const startPoint = getStickyConnectorPoint(
              sceneBounds,
              controlHit.side,
              node,
            );
            dragRef.current = {
              kind: "stickyConnector",
              nodeId: controlHit.nodeId,
              side: controlHit.side,
              startPoint,
              sourceBounds: sceneBounds,
            };
            renderer.setInteractionMode("transform");
            setEditorOverlay({
              linePreview: {
                start: startPoint,
                end: startPoint,
                arrow: true,
              },
            });
            suppressNextClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            console.info("[skia-canvas] sticky.connector.drag.started", {
              stickyId: controlHit.nodeId,
              side: controlHit.side,
            });
            return;
          }
          if (controlHit.type === "line-endpoint" && node.type === "line") {
            const endpoints = getLineEndpoints(node);
            dragRef.current = {
              kind: "lineEndpoint",
              nodeId: controlHit.nodeId,
              endpoint: controlHit.endpoint,
              startPoint: scenePoint,
              originStart: endpoints.start,
              originEnd: endpoints.end,
            };
            renderer.setInteractionMode("transform");
          } else if (controlHit.type === "resize") {
            dragRef.current = {
              kind: "resize",
              nodeId: controlHit.nodeId,
              handle: controlHit.handle,
              startPoint: scenePoint,
              origin: localBounds,
              preserveAspectRatio: event.shiftKey,
              sceneDelta: { x: 0, y: 0 },
            };
          } else {
            const center = {
              x: sceneBounds.x + sceneBounds.width / 2,
              y: sceneBounds.y + sceneBounds.height / 2,
            };
            dragRef.current = {
              kind: "rotate",
              nodeId: controlHit.nodeId,
              center,
              originRotation: localBounds.rotation ?? 0,
              startAngle: pointToAngle(center, scenePoint),
            };
          }
          suppressNextClickRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (hit && !event.shiftKey) {
          const currentSelection = selectedIdsRef.current;
          const hitSelectedNode =
            currentSelection.includes(hit.id) ||
            currentSelection.some((selectedId) =>
              isDescendantOf(docRef.current, hit.id, selectedId, activePageId),
            );
          // Start move if clicking on the selected node or its visible descendants.
          if (hitSelectedNode) {
            const origins: Record<string, CanvasBounds> = {};
            for (const id of currentSelection) {
              const n = findNode(docRef.current, id, activePageId);
              if (n) origins[id] = getNodeBounds(n);
            }
            dragRef.current = {
              kind: "move",
              nodeIds: [...currentSelection],
              startPoint: scenePoint,
              origins,
              hasMoved: false,
              sceneDelta: { x: 0, y: 0 },
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }

          // Select and arm movement immediately so press-dragging a fresh
          // target behaves the same as dragging an already-selected node.
          setSelection([hit.id]);
          const node = findNode(docRef.current, hit.id, activePageId);
          if (!node || node.locked) return;
          dragRef.current = {
            kind: "move",
            nodeIds: [hit.id],
            startPoint: scenePoint,
            origins: { [hit.id]: getNodeBounds(node) },
            hasMoved: false,
            sceneDelta: { x: 0, y: 0 },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          console.info("[skia-canvas] selection.drag.armed", {
            nodeId: hit.id,
            reason: "direct_pointer_down",
          });
          return;
        }

        // Start marquee
        if (!event.shiftKey) setSelection([]);
        renderer.setInteractionMode("transform");
        dragRef.current = {
          kind: "marquee",
          startPoint: scenePoint,
          originSelection: [...selectedIdsRef.current],
        };
        setEditorOverlay({ marquee: null });
        setMarqueeDomOverlay(null);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (isDragDrawableTool(tool)) {
        renderer.setInteractionMode("transform");
        const startSnap = shouldAttachConnectorForTool(tool)
          ? getConnectorSnap(scenePoint)
          : null;
        const drawStartPoint = startSnap?.point ?? scenePoint;
        dragRef.current = {
          kind: "drawShape",
          shapeType: tool,
          startPoint: drawStartPoint,
          ...(startSnap
            ? {
                startConnector: {
                  nodeId: startSnap.nodeId,
                  side: startSnap.side,
                  ratio: startSnap.ratio,
                },
              }
            : null),
          fromCenter: event.altKey,
        };
        const lineDraft = isLineDrawableTool(tool)
          ? getLineDrawDraft(drawStartPoint, drawStartPoint, {
              constrain: event.shiftKey,
              fromCenter: event.altKey,
            })
          : null;
        setEditorOverlay({
          shapePreview: getDrawableToolPreview(tool, {
            x: scenePoint.x,
            y: scenePoint.y,
            width: 0,
            height: 0,
          }),
          linePreview: isLineDrawableTool(tool)
            ? {
                start: lineDraft?.start ?? drawStartPoint,
                end: lineDraft?.end ?? drawStartPoint,
                arrow: tool === "arrow",
              }
            : null,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (tool === "path") {
        const viewport = renderer.getViewport();
        if (penTool.onMouseDown(scenePoint, viewport.zoom)) {
          dragRef.current = { kind: "pen" };
          suppressNextClickRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }

      if (tool === "text") {
        renderer.setInteractionMode("transform");
        dragRef.current = {
          kind: "drawText",
          startPoint: scenePoint,
          startScreenX: event.clientX,
          startScreenY: event.clientY,
          hasMoved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    },
    [
      commitDocument,
      effectiveTool,
      flushRendererDocumentSyncBeforeInteraction,
      getConnectorSnap,
      getPointerScenePoint,
      penTool,
      setEditorOverlay,
      setMarqueeDomOverlay,
      setSelection,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      const drag = dragRef.current;
      if (!renderer) return;
      if (!drag) {
        const tool = effectiveTool === "hand" ? "hand" : activeToolRef.current;
        if (tool !== "select" && tool !== "hand") {
          setHoveredCheckpoint(null);
          setHoveredAgentExecution(null);
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("[data-canvas-overlay]")) return;
        const rawHit = renderer.hitTest(event.clientX, event.clientY);
        const hit = getSelectableStickyHitNode(
          docRef.current as CucumberCanvasDocument,
          rawHit,
          activePageIdRef.current,
        );
        const execution = getAgentExecutionMeta(hit);
        if (hit && execution?.kind === "checkpoint") {
          const rootRect = canvasRootRef.current?.getBoundingClientRect();
          setHoveredCheckpoint({
            ...getAgentCheckpointToolbarState(
              hit,
              Boolean(hasAgentContinuationHandler),
            ),
            nodeId: hit.id,
            title: execution.title,
            x: event.clientX - (rootRect?.left ?? 0),
            y: event.clientY - (rootRect?.top ?? 0),
          });
          setHoveredAgentExecution(null);
        } else if (hit && execution) {
          const rootRect = canvasRootRef.current?.getBoundingClientRect();
          setHoveredCheckpoint(null);
          setHoveredAgentExecution(
            getAgentExecutionHoverState(hit, {
              x: event.clientX - (rootRect?.left ?? 0),
              y: event.clientY - (rootRect?.top ?? 0),
            }),
          );
        } else {
          setHoveredCheckpoint(null);
          setHoveredAgentExecution(null);
        }
        return;
      }

      if (drag.kind === "pan") {
        const expectedButtonMask =
          drag.button === 1 ? 4 : 1 << Math.max(drag.button, 0);
        if ((event.buttons & expectedButtonMask) === 0) {
          endViewportPan("pointer_move_without_button");
          return;
        }
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const vp = renderer.getViewport();
        renderer.setViewport(vp.zoom, drag.originX + dx, drag.originY + dy);
        scheduleViewportPanSnapshot(renderer.getViewport());
        return;
      }

      if (drag.kind === "marquee") {
        const scenePoint = getPointerScenePoint(event);
        if (!scenePoint) return;
        const bounds = normalizeDrawBounds(drag.startPoint, scenePoint, false);
        setMarqueeDomOverlay(bounds);
        const hitIds = renderer
          .hitTestRect(bounds)
          .map(
            (node) =>
              getSelectableStickyHitNode(
                docRef.current as CucumberCanvasDocument,
                node,
                activePageIdRef.current,
              )?.id,
          )
          .filter((nodeId): nodeId is string => Boolean(nodeId));
        const nextSelection = Array.from(
          new Set([...drag.originSelection, ...hitIds]),
        );
        if (areStringArraysEqual(nextSelection, marqueeSelectionRef.current)) {
          return;
        }
        marqueeSelectionRef.current = nextSelection;
        if (marqueeRafRef.current === null) {
          marqueeRafRef.current = requestAnimationFrame(() => {
            marqueeRafRef.current = null;
            setSelection(marqueeSelectionRef.current, {
              notifySelection: true,
            });
          });
        }
        return;
      }

      if (drag.kind === "drawShape") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const endSnap = shouldAttachConnectorForTool(drag.shapeType)
          ? getConnectorSnap(scene, {
              excludeNodeIds: drag.startConnector
                ? [drag.startConnector.nodeId]
                : undefined,
            })
          : null;
        const drawEndPoint = endSnap?.point ?? scene;
        const lineDraft = isLineDrawableTool(drag.shapeType)
          ? getLineDrawDraft(drag.startPoint, drawEndPoint, {
              constrain: event.shiftKey,
              fromCenter: drag.fromCenter || event.altKey,
            })
          : null;
        setEditorOverlay({
          shapePreview: getDrawableToolPreview(
            drag.shapeType,
            normalizeDrawBounds(
              drag.startPoint,
              drawEndPoint,
              event.shiftKey && !isLineDrawableTool(drag.shapeType),
            ),
          ),
          linePreview: isLineDrawableTool(drag.shapeType)
            ? {
                start: lineDraft?.start ?? drag.startPoint,
                end: lineDraft?.end ?? drawEndPoint,
                arrow: drag.shapeType === "arrow",
              }
            : null,
        });
        return;
      }

      if (drag.kind === "lineEndpoint") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const snap = getConnectorSnap(scene, {
          excludeNodeIds: selectedIdsRef.current,
        });
        const next = getLineEndpointDragDraft(
          drag,
          snap?.point ?? scene,
          event.shiftKey,
        );
        const node = findNode(
          docRef.current,
          drag.nodeId,
          activePageIdRef.current,
        ) as
          | (PenNode & {
              _connectorType?: string;
              stroke?: {
                endTip?: string;
              };
            })
          | undefined;
        setEditorOverlay({
          linePreview: {
            start: next.start,
            end: next.end,
            arrow:
              node?._connectorType === "arrow" ||
              (node?.stroke?.endTip !== undefined &&
                node.stroke.endTip !== "none"),
          },
        });
        return;
      }

      if (drag.kind === "stickyConnector") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const snap = getConnectorSnap(scene, {
          excludeNodeIds: [drag.nodeId],
        });
        setEditorOverlay({
          linePreview: {
            start: drag.startPoint,
            end: snap?.point ?? scene,
            arrow: true,
          },
        });
        return;
      }

      if (drag.kind === "drawText") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const screenDistance = Math.hypot(
          event.clientX - drag.startScreenX,
          event.clientY - drag.startScreenY,
        );
        if (screenDistance >= TEXT_DRAG_THRESHOLD_PX) {
          drag.hasMoved = true;
          setEditorOverlay({
            shapePreview: {
              type: "rect",
              bounds: normalizeDrawBounds(drag.startPoint, scene, false),
              fillColor: "transparent",
            },
          });
        }
        return;
      }

      if (drag.kind === "pen") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        penTool.onMouseMove(scene);
        return;
      }

      if (drag.kind === "move") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const dx = scene.x - drag.startPoint.x;
        const dy = scene.y - drag.startPoint.y;
        const vp = renderer.getViewport();
        const screenDx = dx * vp.zoom;
        const screenDy = dy * vp.zoom;
        if (
          !drag.hasMoved &&
          Math.hypot(screenDx, screenDy) < MOVE_COMMIT_THRESHOLD_PX
        ) {
          return;
        }
        drag.hasMoved = true;
        drag.sceneDelta = { x: dx, y: dy };
        renderer.setTransformPreview({
          kind: "move",
          nodeIds: drag.nodeIds,
          dx,
          dy,
        });
      }

      if (drag.kind === "resize") {
        const scene = getPointerScenePoint(event);
        if (!scene) return;
        const dx = scene.x - drag.startPoint.x;
        const dy = scene.y - drag.startPoint.y;
        drag.sceneDelta = { x: dx, y: dy };
        const bounds = calculateResizeBounds(
          drag.origin,
          drag.handle,
          dx,
          dy,
          event.shiftKey || drag.preserveAspectRatio,
        );
        const node = findNode(
          docRef.current,
          drag.nodeId,
          activePageIdRef.current,
        );
        const updates = getResizeNodeUpdates(node, bounds, drag.handle);
        const previewUpdates = updates as Record<string, unknown>;
        renderer.setTransformPreview({
          kind: "resize",
          nodeId: drag.nodeId,
          bounds: {
            x: (previewUpdates.x as number | undefined) ?? drag.origin.x,
            y: (previewUpdates.y as number | undefined) ?? drag.origin.y,
            width:
              (previewUpdates.width as number | undefined) ?? drag.origin.width,
            height:
              (previewUpdates.height as number | undefined) ??
              drag.origin.height,
          },
        });
        return;
      }

      if (drag.kind === "rotate") {
        const point = getPointerScenePoint(event);
        if (!point) return;
        const rotation =
          drag.originRotation +
          pointToAngle(drag.center, point) -
          drag.startAngle;
        renderer.setTransformPreview({
          kind: "rotate",
          nodeId: drag.nodeId,
          rotation: Math.round(rotation),
        });
      }
    },
    [
      effectiveTool,
      endViewportPan,
      getConnectorSnap,
      getPointerScenePoint,
      hasAgentContinuationHandler,
      penTool,
      setEditorOverlay,
      setMarqueeDomOverlay,
      setSelection,
      scheduleViewportPanSnapshot,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      const drag = dragRef.current;
      if (drag?.kind === "drawShape" && renderer) {
        const scene = getPointerScenePoint(event);
        if (scene) {
          const endSnap = shouldAttachConnectorForTool(drag.shapeType)
            ? getConnectorSnap(scene, {
                excludeNodeIds: drag.startConnector
                  ? [drag.startConnector.nodeId]
                  : undefined,
              })
            : null;
          const drawEndPoint = endSnap?.point ?? scene;
          const lineDraft = isLineDrawableTool(drag.shapeType)
            ? getLineDrawDraft(drag.startPoint, drawEndPoint, {
                constrain: event.shiftKey,
                fromCenter: drag.fromCenter || event.altKey,
              })
            : null;
          const bounds = normalizeDrawBounds(
            drag.startPoint,
            drawEndPoint,
            event.shiftKey && !isLineDrawableTool(drag.shapeType),
          );
          const isLineTool = isLineDrawableTool(drag.shapeType);
          const isDrawableSize = isLineTool
            ? Math.hypot(
                (lineDraft?.end.x ?? drawEndPoint.x) -
                  (lineDraft?.start.x ?? drag.startPoint.x),
                (lineDraft?.end.y ?? drawEndPoint.y) -
                  (lineDraft?.start.y ?? drag.startPoint.y),
              ) >= MIN_DRAW_SIZE
            : bounds.width >= MIN_DRAW_SIZE && bounds.height >= MIN_DRAW_SIZE;
          if (isDrawableSize) {
            const connector =
              shouldAttachConnectorForTool(drag.shapeType) &&
              (drag.startConnector || endSnap)
                ? {
                    ...(drag.startConnector
                      ? { start: drag.startConnector }
                      : null),
                    ...(endSnap
                      ? {
                          end: {
                            nodeId: endSnap.nodeId,
                            side: endSnap.side,
                            ratio: endSnap.ratio,
                          },
                        }
                      : null),
                    routing: "smooth" as const,
                    arrow: drag.shapeType === "arrow",
                  }
                : undefined;
            const node = createDrawableCanvasNode(
              drag.shapeType,
              bounds,
              lineDraft?.start ?? drag.startPoint,
              lineDraft?.end ?? drawEndPoint,
              connector,
            );
            const next = applyCanvasOperation(docRef.current, {
              type: "insertNode",
              node,
              activePageId: activePageIdRef.current,
            });
            commitDocument(next, { selection: [node.id] });
            setSelection([node.id], { notifyScene: false });
            console.info("[skia-canvas] shape.drawn", {
              nodeId: node.id,
              type: drag.shapeType,
              width: Math.round(bounds.width),
              height: Math.round(bounds.height),
              startPoint: drag.startPoint,
              endPoint: scene,
            });
          } else {
            console.info("[skia-canvas] shape.draw.cancelled", {
              type: drag.shapeType,
              reason: "below_minimum_size",
            });
          }
        }
        setEditorOverlay({ shapePreview: null, linePreview: null });
        setActiveTool("select");
        suppressNextClickRef.current = true;
        scheduleRendererIdle();
      }
      if (drag?.kind === "drawText" && renderer) {
        const scene = getPointerScenePoint(event);
        if (scene) {
          const bounds = normalizeDrawBounds(drag.startPoint, scene, false);
          const isTextBox =
            drag.hasMoved &&
            bounds.width >= MIN_TEXT_BOX_SIZE &&
            bounds.height >= MIN_TEXT_BOX_SIZE;
          const nodeBounds = isTextBox
            ? bounds
            : {
                x: drag.startPoint.x,
                y: drag.startPoint.y,
                width: MIN_TEXT_BOX_SIZE,
                height: getLineHeightPx(
                  DEFAULT_TEXT_LINE_HEIGHT,
                  DEFAULT_TEXT_FONT_SIZE,
                ),
              };
          const textGrowth = isTextBox ? "fixed-width" : "auto";
          const node = createTextCanvasNode(nodeBounds, textGrowth);
          const next = applyCanvasOperation(docRef.current, {
            type: "insertNode",
            node,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next, { selection: [node.id] });
          setSelection([node.id], { notifyScene: false });
          beginTextEdit(node, {
            isNew: true,
            bounds: getNodeBounds(node),
          });
          setActiveTool("select");
          console.info("[skia-canvas] text.created", {
            nodeId: node.id,
            textGrowth,
            width: Math.round(nodeBounds.width),
            height: Math.round(nodeBounds.height),
            interaction: isTextBox ? "drag" : "click",
          });
        }
        setEditorOverlay({ shapePreview: null });
        suppressNextClickRef.current = true;
        scheduleRendererIdle();
      }
      if (drag?.kind === "pen") {
        penTool.onMouseUp();
        suppressNextClickRef.current = true;
        scheduleRendererIdle();
      }
      if (drag?.kind === "move" && drag.hasMoved) {
        const activePageId = activePageIdRef.current;
        const operations = drag.nodeIds.flatMap((nodeId) => {
          const origin = drag.origins[nodeId];
          if (!origin) return [];
          const node = findNode(docRef.current, nodeId, activePageId);
          if (!node || node.locked) return [];
          if (node.type === "line") {
            const endpoints = getLineEndpoints(node);
            return [
              {
                type: "updateNode" as const,
                nodeId,
                updates: {
                  x: endpoints.start.x + drag.sceneDelta.x,
                  y: endpoints.start.y + drag.sceneDelta.y,
                  x2: endpoints.end.x + drag.sceneDelta.x,
                  y2: endpoints.end.y + drag.sceneDelta.y,
                } as Partial<PenNode>,
                activePageId,
              },
            ];
          }
          return [
            {
              type: "updateNode" as const,
              nodeId,
              updates: {
                x: origin.x + drag.sceneDelta.x,
                y: origin.y + drag.sceneDelta.y,
              } as Partial<PenNode>,
              activePageId,
            },
          ];
        });
        let next =
          operations.length > 0
            ? applyCanvasTransaction(docRef.current, operations, {
                activePageId,
              }).doc
            : docRef.current;
        const dropPoint = getPointerScenePoint(event);
        if (renderer && dropPoint) {
          const reparented = reparentNodesByDropPoint(
            next,
            drag.nodeIds,
            dropPoint,
            activePageId,
          );
          if (reparented.movedIds.length > 0) {
            next = reparented.doc;
            console.info("[skia-canvas] selection.drag.reparented", {
              nodeIds: reparented.movedIds,
              count: reparented.movedIds.length,
              targetParentId: reparented.targetParentId,
              dropPoint,
              reason: "pointer_drop_point",
            });
          }
        }
        const commit = commitDocument(next, { selection: drag.nodeIds });
        syncCommittedDocumentToRenderer(commit, "selection.move.commit");
        renderer?.clearTransformPreview();
      }
      if (drag?.kind === "lineEndpoint") {
        const activePageId = activePageIdRef.current;
        const scene = getPointerScenePoint(event);
        if (scene) {
          const snap = getConnectorSnap(scene, {
            excludeNodeIds: selectedIdsRef.current,
          });
          const draft = getLineEndpointDragDraft(
            drag,
            snap?.point ?? scene,
            event.shiftKey,
          );
          const node = findNode(docRef.current, drag.nodeId, activePageId);
          let connector: NonNullable<LineNode["connector"]> =
            node && node.type === "line" && node.connector
              ? { ...node.connector }
              : {};
          if (snap) {
            connector[drag.endpoint] = {
              nodeId: snap.nodeId,
              side: snap.side,
              ratio: snap.ratio,
            };
            connector.routing = connector.routing ?? "smooth";
          } else if (node?.type === "line") {
            const detached = detachConnectorEndpointBinding(
              node,
              drag.endpoint,
            );
            connector = detached.connector ?? {};
          }
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates:
              drag.endpoint === "start"
                ? ({
                    x: draft.start.x,
                    y: draft.start.y,
                    connector:
                      connector.start || connector.end ? connector : undefined,
                  } as Partial<PenNode>)
                : ({
                    x2: draft.end.x,
                    y2: draft.end.y,
                    connector:
                      connector.start || connector.end ? connector : undefined,
                  } as Partial<PenNode>),
            activePageId,
          });
          const commit = commitDocument(next, { selection: [drag.nodeId] });
          syncCommittedDocumentToRenderer(commit, "line.endpoint.commit");
          console.info("[skia-canvas] line.endpoint.committed", {
            nodeId: drag.nodeId,
            endpoint: drag.endpoint,
            start: draft.start,
            end: draft.end,
          });
        }
        setEditorOverlay({ linePreview: null });
        renderer?.clearTransformPreview();
      }
      if (drag?.kind === "stickyConnector") {
        const activePageId = activePageIdRef.current;
        const scene = getPointerScenePoint(event);
        if (scene) {
          const dragDistance = Math.hypot(
            scene.x - drag.startPoint.x,
            scene.y - drag.startPoint.y,
          );
          if (dragDistance >= 24) {
            const snap = getConnectorSnap(scene, {
              excludeNodeIds: [drag.nodeId],
            });
            const startConnector: PenConnectorEndpointBinding = {
              nodeId: drag.nodeId,
              side: drag.side,
              ratio: 0.5,
            };
            let next: PenDocument = docRef.current;
            let selection: string[];

            if (!snap) {
              const targetSide = getOppositeStickyConnectorSide(drag.side);
              const sticky = createStickyNoteNode(
                getLinkedStickyBounds(drag.sourceBounds, drag.side, scene),
              );
              const endConnector: PenConnectorEndpointBinding = {
                nodeId: sticky.id,
                side: targetSide,
                ratio: 0.5,
              };
              const endPoint = getStickyConnectorPoint(
                getNodeBounds(sticky),
                targetSide,
                sticky,
              );
              const connector = createLineNode(
                "arrow",
                drag.startPoint,
                endPoint,
                {
                  start: startConnector,
                  end: endConnector,
                  routing: "smooth",
                  arrow: true,
                },
              );
              next = applyCanvasTransaction(
                docRef.current,
                [
                  { type: "insertNode", node: sticky, activePageId },
                  { type: "insertNode", node: connector, activePageId },
                ],
                { activePageId },
              ).doc;
              selection = [sticky.id];
              console.info("[skia-canvas] sticky.connector.branch.created", {
                sourceStickyId: drag.nodeId,
                targetStickyId: sticky.id,
                connectorId: connector.id,
                side: drag.side,
              });
            } else {
              const endConnector: PenConnectorEndpointBinding = {
                nodeId: snap.nodeId,
                side: snap.side,
                ratio: snap.ratio,
              };
              const connector = createLineNode(
                "arrow",
                drag.startPoint,
                snap.point,
                {
                  start: startConnector,
                  end: endConnector,
                  routing: "smooth",
                  arrow: true,
                },
              );
              next = applyCanvasOperation(docRef.current, {
                type: "insertNode",
                node: connector,
                activePageId,
              });
              selection = [connector.id];
              console.info("[skia-canvas] sticky.connector.created", {
                sourceStickyId: drag.nodeId,
                targetNodeId: snap.nodeId,
                connectorId: connector.id,
                side: drag.side,
              });
            }

            const commit = commitDocument(next, { selection });
            syncCommittedDocumentToRenderer(commit, "sticky.connector.commit");
            setSelection(selection, { notifyScene: false });
          } else {
            console.info("[skia-canvas] sticky.connector.cancelled", {
              stickyId: drag.nodeId,
              side: drag.side,
              reason: "below_minimum_distance",
            });
          }
        }
        setEditorOverlay({ linePreview: null });
        renderer?.clearTransformPreview();
        suppressNextClickRef.current = true;
      }
      if (drag?.kind === "resize") {
        const activePageId = activePageIdRef.current;
        const bounds = calculateResizeBounds(
          drag.origin,
          drag.handle,
          drag.sceneDelta.x,
          drag.sceneDelta.y,
          event.shiftKey || drag.preserveAspectRatio,
        );
        const node = findNode(docRef.current, drag.nodeId, activePageId);
        const updates = getResizeNodeUpdates(node, bounds, drag.handle);
        const operations = [
          {
            type: "updateNode" as const,
            nodeId: drag.nodeId,
            updates,
            activePageId,
          },
        ];
        if (node && isStickyNoteNode(node)) {
          const textNode = findStickyNoteTextNode(node);
          if (textNode) {
            operations.push({
              type: "updateNode",
              nodeId: textNode.id,
              updates: {
                width: Math.max(bounds.width - 40, 1),
                height: Math.max(bounds.height - 40, 1),
              } as Partial<PenNode>,
              activePageId,
            });
          }
        }
        const next =
          operations.length > 1
            ? applyCanvasTransaction(docRef.current, operations, {
                activePageId,
              }).doc
            : applyCanvasOperation(docRef.current, {
                type: "updateNode",
                nodeId: drag.nodeId,
                updates,
                activePageId,
              });
        const commit = commitDocument(next, { selection: [drag.nodeId] });
        syncCommittedDocumentToRenderer(commit, "selection.resize.commit");
        renderer?.clearTransformPreview();
      }
      if (drag?.kind === "rotate") {
        const activePageId = activePageIdRef.current;
        const point = getPointerScenePoint(event);
        if (point) {
          const rotation =
            drag.originRotation +
            pointToAngle(drag.center, point) -
            drag.startAngle;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: { rotation: Math.round(rotation) } as Partial<PenNode>,
            activePageId,
          });
          const commit = commitDocument(next, { selection: [drag.nodeId] });
          syncCommittedDocumentToRenderer(commit, "selection.rotate.commit");
          renderer?.clearTransformPreview();
        }
      }
      if (
        (drag?.kind === "move" && drag.hasMoved) ||
        drag?.kind === "resize" ||
        drag?.kind === "rotate"
      ) {
        const viewport = renderer?.getViewport();
        const sceneDelta =
          drag.kind === "move" || drag.kind === "resize"
            ? drag.sceneDelta
            : { x: 0, y: 0 };
        console.info("[skia-canvas] selection.transform.committed", {
          kind: drag.kind,
          zoom: viewport?.zoom ?? 1,
          sceneDelta,
          nodeCount: drag.kind === "move" ? drag.nodeIds.length : 1,
        });
      }
      if (drag?.kind === "move" && drag.hasMoved) {
        suppressNextClickRef.current = true;
      }
      if (drag?.kind === "marquee") {
        if (marqueeRafRef.current !== null) {
          cancelAnimationFrame(marqueeRafRef.current);
          marqueeRafRef.current = null;
        }
        if (
          !areStringArraysEqual(
            marqueeSelectionRef.current,
            getDocumentSelection(docRef.current, selectedIdsRef.current),
          )
        ) {
          setSelection(marqueeSelectionRef.current, {
            notifySelection: true,
          });
        }
        setMarqueeDomOverlay(null);
        setEditorOverlay({ marquee: null });
        suppressNextClickRef.current = true;
        scheduleRendererIdle();
        console.info("[skia-canvas] selection.marquee.committed", {
          selectedCount: getCanvasApiRuntimeState(docRef.current).selection
            .length,
        });
      }
      if (drag?.kind === "pan") {
        endViewportPan("react_pointer_release");
        return;
      }
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [
      beginTextEdit,
      commitDocument,
      endViewportPan,
      getConnectorSnap,
      getPointerScenePoint,
      penTool,
      scheduleRendererIdle,
      setEditorOverlay,
      setMarqueeDomOverlay,
      setActiveTool,
      setSelection,
      syncCommittedDocumentToRenderer,
    ],
  );
  const handleAuxClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 1) return;
      event.preventDefault();
      endViewportPan("aux_click");
    },
    [endViewportPan],
  );

  const handlePointerLeave = useCallback(() => {
    if (!dragRef.current) {
      setHoveredCheckpoint(null);
      setHoveredAgentExecution(null);
    }
  }, [dragRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      event.preventDefault();
      flushRendererDocumentSyncBeforeInteraction();
      const hit = getSelectableStickyHitNode(
        docRef.current as CucumberCanvasDocument,
        renderer.hitTest(event.clientX, event.clientY),
        activePageIdRef.current,
      );
      if (hit && !selectedIdsRef.current.includes(hit.id)) {
        setSelection([hit.id]);
      }
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        targetId: hit?.id ?? null,
        scenePoint: getPointerScenePoint(event),
      });
      console.info("[skia-canvas] context-menu.opened", {
        targetId: hit?.id ?? null,
        selectedCount: hit ? 1 : selectedIdsRef.current.length,
      });
    },
    [
      flushRendererDocumentSyncBeforeInteraction,
      getPointerScenePoint,
      setSelection,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (activeToolRef.current === "path" && penTool.onDblClick()) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextClickRef.current = true;
        return;
      }
      if (effectiveTool !== "select") return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const labelHit = renderer.hitTestNodeLabel(event.clientX, event.clientY);
      if (labelHit && isStickyNoteNode(labelHit)) {
        setSelection([labelHit.id], { notifyScene: false });
        setEditingStickyNameId(labelHit.id);
        event.preventDefault();
        event.stopPropagation();
        suppressNextClickRef.current = true;
        console.info("[skia-canvas] sticky.name.edit.started", {
          stickyId: labelHit.id,
        });
        return;
      }
      const hit = renderer.hitTest(event.clientX, event.clientY);
      if (!hit) return;
      const sticky = getStickyNoteContainerForNode(
        docRef.current as CucumberCanvasDocument,
        hit.id,
        activePageIdRef.current,
      );
      const editableText = sticky ? findStickyNoteTextNode(sticky) : hit;
      if (!editableText || editableText.type !== "text") return;
      if (sticky) setSelection([sticky.id], { notifyScene: false });
      if (
        beginTextEdit(
          editableText,
          sticky
            ? {
                commitSelection: [sticky.id],
                selectionDuringEdit: [],
              }
            : undefined,
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextClickRef.current = true;
      }
    },
    [beginTextEdit, effectiveTool, penTool, setSelection],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: keydown handlers must read the live tool ref, not a render-time tool snapshot.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeToolRef.current !== "path") return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (penTool.onKeyDown(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [penTool]);

  return {
    contextMenu,
    handleAuxClick,
    handleCanvasClick,
    handleContextMenu,
    handleDoubleClick,
    handlePointerDown,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp,
    hoveredAgentExecution,
    hoveredCheckpoint,
    closeContextMenu: () => setContextMenu(null),
  };
}

function getAgentExecutionToggleTarget(
  doc: PenDocument,
  activePageId: string,
  hitNodeId: string | undefined,
  scenePoint: { x: number; y: number },
): PenNode | null {
  if (!hitNodeId) return null;
  let node = findNode(doc, hitNodeId, activePageId);
  while (node) {
    const execution = getAgentExecutionMeta(node);
    if (execution) {
      if (execution.kind === "agent_run_node") return null;
      const executionContainer = getAgentExecutionContainerMeta(node);
      const bounds =
        getNodeSceneBounds(doc, node.id, activePageId) ?? getNodeBounds(node);
      const layout = measureAgentExecutionComponentLayout(
        executionContainer
          ? {
              ...execution,
              summary: formatAgentExecutionCanvasBody(
                execution,
                executionContainer,
              ),
            }
          : execution,
        bounds.width,
        !getAgentExecutionCanvasCollapsed(execution),
      );
      if (!layout.showToggle) return null;
      const hotZoneStartX = bounds.x + bounds.width - 32;
      const insideHotZone =
        scenePoint.x >= hotZoneStartX &&
        scenePoint.x <= bounds.x + bounds.width &&
        scenePoint.y >= bounds.y &&
        scenePoint.y <= bounds.y + Math.min(bounds.height, 36);
      return insideHotZone ? node : null;
    }
    node = findParent(doc, node.id, activePageId);
  }
  return null;
}
