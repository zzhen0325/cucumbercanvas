"use client";

import {
  type AgentBinding,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasClipboardData,
  type CanvasImportResult,
  CanvasPageOperationError,
  type ClipboardImportPayload,
  type CucumberCanvasDocument,
  type ImportNode,
  addCanvasPage,
  applyCanvasOperation,
  copyCanvasSelection,
  createNodeId,
  deleteCanvasPage,
  duplicateCanvasNodes,
  duplicateCanvasPage,
  findNode,
  flattenNodes,
  getActiveChildren,
  getCanvasImportBounds,
  getCanvasPages,
  getNodeBounds,
  getOrderedCanvasNodes,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
  normalizeCanvasPages,
  normalizeLegacyImportCoordinates,
  parseClipboardImport,
  pasteCanvasClipboard,
  renameCanvasPage,
  reorderCanvasPage,
  resolveActivePageId,
  resolveContext,
} from "@cucumber/canvas-core";
import { createEmptyDocument } from "@cucumber/canvas-core";
import {
  type BooleanOpType,
  executeBooleanOp,
  getBooleanOpRejectionReason,
  setPaperModule,
} from "@cucumber/pen-core";
import {
  type EditorOverlayState,
  PenRenderer,
  loadCanvasKit,
  screenToScene,
} from "@cucumber/pen-renderer";
import type { ContainerRole, PenDocument, PenNode } from "@cucumber/pen-types";
import type { CanvasKit } from "canvaskit-wasm";
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

import { useToast } from "@/components/toast";
import { CanvasBooleanToolbar } from "./boolean-toolbar";
import type {
  AlignMode,
  CanvasApi,
  CanvasAppState,
  CanvasChangeListener,
  CanvasFileRecord,
  CanvasSceneElement,
  CanvasTool,
} from "./canvas-api";
import { exportDocumentImage } from "./canvas-export";
import { bakePenAnchorsToPathData, usePenTool } from "./canvas-pen-tool";
import {
  getPrimarySelectedContainerId,
  getTopLevelSelectionIds,
} from "./canvas-selection-helpers";
import { CanvasEditorToolbar } from "./editor-toolbar";
import { lookupCanvasIcon } from "./icon-library";
import { CanvasPageTabs } from "./page-tabs";
import { CanvasPropertyPanel } from "./property-panel/canvas-property-panel";
import {
  type ClipboardImportContext,
  readClipboardImportPayload,
  useCanvasClipboardImport,
} from "./use-canvas-clipboard-import";
import { useCanvasKeyboardShortcuts } from "./use-canvas-keyboard-shortcuts";

// ---------------------------------------------------------------------------
// Helpers to bridge the public CanvasApi summaries with PenDocument nodes.
// ---------------------------------------------------------------------------

function toSceneElement(node: PenNode): CanvasSceneElement {
  const b = getNodeBounds(node);
  const nodeRecord = node as unknown as Record<string, unknown>;
  const meta = nodeRecord.meta as Record<string, unknown> | undefined;
  return {
    id: node.id,
    type: node.type,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    fileId:
      typeof nodeRecord.fileId === "string"
        ? nodeRecord.fileId
        : typeof nodeRecord.assetId === "string"
          ? nodeRecord.assetId
          : undefined,
    text:
      typeof nodeRecord.content === "string"
        ? nodeRecord.content
        : typeof nodeRecord.text === "string"
          ? nodeRecord.text
          : undefined,
    visible: node.visible,
    locked: node.locked,
    depth: 0,
    customData: meta,
  };
}

function getClipboardImportStrategy(result: CanvasImportResult): string {
  if (result.source !== "figma") return result.source;
  const usedNative = result.nodes.some((node) => {
    const meta = (node as { meta?: Record<string, unknown> }).meta;
    return meta?.originNodeType === "figma-native";
  });
  return usedNative ? "figma-native" : "figma-html-fallback";
}

function summarizeImportedNodes(result: CanvasImportResult) {
  return result.nodes.slice(0, 20).map((node) => {
    const record = node as Partial<ImportNode> &
      Partial<PenNode> & {
        fill?: Array<{ type?: string }>;
        fills?: Array<{ type?: string }>;
        childrenOrder?: string[];
        children?: PenNode[];
      };
    const bounds =
      record.bounds ??
      ({
        x: record.x ?? 0,
        y: record.y ?? 0,
        width:
          typeof (record as Record<string, unknown>).width === "number"
            ? (record as Record<string, number>).width
            : undefined,
        height:
          typeof (record as Record<string, unknown>).height === "number"
            ? (record as Record<string, number>).height
            : undefined,
      } as Record<string, unknown>);
    const fills = record.fills ?? record.fill;
    const meta = record.meta as Record<string, unknown> | undefined;
    return {
      id: record.id,
      type: record.type,
      title: record.title ?? record.name,
      bounds,
      fillTypes: fills?.map((fill) => fill.type ?? "unknown"),
      hasStroke: Boolean(record.stroke),
      childCount: record.childrenOrder?.length ?? record.children?.length ?? 0,
      autoLayout: meta?.autoLayout,
    };
  });
}

function toSceneElements(
  doc: PenDocument,
  activePageId?: string | null,
): CanvasSceneElement[] {
  return flattenNodes(doc, activePageId)
    .filter((n) => n.visible !== false)
    .map(toSceneElement);
}

function toAppState(doc: PenDocument, selection?: string[]): CanvasAppState {
  const runtimeDoc = doc as CanvasRuntimeDocument;
  const selectedIds = selection ?? runtimeDoc.selection ?? [];
  const viewport = runtimeDoc.viewport;
  return {
    zoom: { value: viewport?.zoom ?? 1 },
    scrollX: viewport?.x ?? 0,
    scrollY: viewport?.y ?? 0,
    viewBackgroundColor: viewport?.backgroundColor ?? "#ffffff",
    selectedElementIds: Object.fromEntries(
      selectedIds.map((id: string) => [id, true]),
    ),
  };
}

function toFiles(doc: PenDocument): Record<string, CanvasFileRecord> {
  const assets = (doc as CanvasRuntimeDocument).assets;
  if (!assets) return {};
  return Object.fromEntries(
    Object.entries(assets).map(([id, a]) => [
      id,
      {
        id,
        dataURL: a.url,
        storageUrl: a.url,
        mimeType: a.mimeType,
        created: Date.now(),
        name: a.name,
      },
    ]),
  );
}

function defaultBounds(
  doc: PenDocument,
  _type: string,
  _parentId?: string | null,
): CanvasBounds {
  const vp = (doc as CanvasRuntimeDocument).viewport ?? {
    x: 0,
    y: 0,
    zoom: 1,
  };
  const cx = -((vp.x ?? 0) / (vp.zoom ?? 1)) + 200;
  const cy = -((vp.y ?? 0) / (vp.zoom ?? 1)) + 200;
  return { x: cx, y: cy, width: 300, height: 200 };
}

function normalizePenDocument(raw: unknown): PenDocument {
  if (raw && typeof raw === "object" && "version" in raw) {
    return raw as PenDocument;
  }
  return createEmptyDocument();
}

function normalizeRuntimeDocument(raw: unknown): PenDocument {
  return normalizeLegacyImportCoordinates(
    normalizeCanvasPages(normalizePenDocument(raw)),
  );
}

function normalizeRuntimeDocumentForCanvasSet(raw: unknown): {
  document: PenDocument;
  reconciledFrom: string | null;
} {
  const candidate = normalizePenDocument(raw);
  try {
    return {
      document: normalizeLegacyImportCoordinates(
        normalizeCanvasPages(candidate),
      ),
      reconciledFrom: null,
    };
  } catch (error) {
    if (
      error instanceof CanvasPageOperationError &&
      error.code === "page_not_found" &&
      Array.isArray(candidate.pages) &&
      candidate.pages.length > 0
    ) {
      return {
        document: normalizeLegacyImportCoordinates(
          normalizeCanvasPages({
            ...candidate,
            activePageId: undefined,
          }),
        ),
        reconciledFrom:
          typeof candidate.activePageId === "string"
            ? candidate.activePageId
            : null,
      };
    }
    throw error;
  }
}

function syncRendererDocument(
  renderer: PenRenderer | null,
  doc: PenDocument,
  activePageId: string,
) {
  if (!renderer) return;
  renderer.setDocument(doc);
  renderer.setPage(activePageId);
}

function reconcileActivePageId(
  nextRaw: PenDocument,
  normalized: PenDocument,
  currentActivePageId: string,
): string {
  const requestedActivePageId =
    typeof nextRaw.activePageId === "string" && nextRaw.activePageId.trim()
      ? nextRaw.activePageId.trim()
      : null;
  if (requestedActivePageId) {
    return resolveActivePageId(normalized, requestedActivePageId);
  }
  try {
    return resolveActivePageId(normalized, currentActivePageId);
  } catch {
    return resolveActivePageId(normalized);
  }
}

type DrawableShapeTool = "rect" | "ellipse" | "polygon";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const MIN_DRAW_SIZE = 2;
const CANVAS_SELECTION_COLOR = "#37BFF9";
const DEFAULT_RECT_FILL = "#d3f256";
const DEFAULT_SHAPE_FILL = "#f8fafc";

type CanvasRuntimeDocument = PenDocument & {
  assets?: Record<string, CanvasAsset>;
  selection?: string[];
  viewport?: {
    x?: number;
    y?: number;
    zoom?: number;
    backgroundColor?: string;
  };
};

function isPenNode(node: PenNode | undefined): node is PenNode {
  return Boolean(node);
}

function hasPenChildren(node: PenNode | undefined): node is PenNode & {
  children: PenNode[];
} {
  return Boolean(
    node &&
      "children" in node &&
      Array.isArray((node as { children?: unknown }).children),
  );
}

function getDocumentSelection(
  doc: PenDocument,
  fallbackSelection: string[],
): string[] {
  return (doc as CanvasRuntimeDocument).selection ?? fallbackSelection;
}

function filterSelectionForActivePage(
  doc: PenDocument,
  selection: string[],
  activePageId?: string | null,
): string[] {
  return selection.filter((id) => Boolean(findNode(doc, id, activePageId)));
}

// ---------------------------------------------------------------------------
// SkiaCanvas
// ---------------------------------------------------------------------------

type SkiaCanvasProps = {
  initialContent: unknown;
  onDocumentChange?: (doc: CucumberCanvasDocument) => void;
  onApiReady?: (api: CanvasApi) => void;
  onSelectionChange?: (elements: CanvasSceneElement[]) => void;
};

export const SkiaCanvas = memo(
  forwardRef<CanvasApi, SkiaCanvasProps>(function SkiaCanvas(
    { initialContent, onDocumentChange, onApiReady, onSelectionChange },
    ref,
  ) {
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement | null>(null);
    const ckRef = useRef<CanvasKit | null>(null);
    const rendererRef = useRef<PenRenderer | null>(null);
    const [ckReady, setCkReady] = useState(false);
    const [ckError, setCkError] = useState<string | null>(null);

    const [doc, setDoc] = useState<PenDocument>(() =>
      normalizeRuntimeDocument(initialContent),
    );
    const docRef = useRef(doc);
    docRef.current = doc;
    const [activePageId, setActivePageId] = useState(() =>
      resolveActivePageId(docRef.current),
    );
    const activePageIdRef = useRef(activePageId);
    activePageIdRef.current = activePageId;

    const listenersRef = useRef(new Set<CanvasChangeListener>());
    const [historyStack, setHistoryStack] = useState<PenDocument[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [activeTool, setActiveTool] = useState<CanvasTool>("select");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const editorOverlayRef = useRef<EditorOverlayState>({
      selectedIds: [],
      selectionColor: CANVAS_SELECTION_COLOR,
      marquee: null,
      shapePreview: null,
      penPreview: null,
    });
    const suppressNextClickRef = useRef(false);
    const [booleanRuntimeStatus, setBooleanRuntimeStatus] = useState<
      "loading" | "ready" | "failed"
    >("loading");

    useEffect(() => {
      let cancelled = false;
      setBooleanRuntimeStatus("loading");
      import("paper")
        .then((paperModule) => {
          if (cancelled) return;
          const runtimeModule =
            "default" in paperModule ? paperModule.default : paperModule;
          setPaperModule(
            runtimeModule as unknown as Parameters<typeof setPaperModule>[0],
          );
          setBooleanRuntimeStatus("ready");
          console.info("[skia-canvas] Paper.js boolean runtime loaded");
        })
        .catch((error) => {
          if (cancelled) return;
          setPaperModule(null);
          setBooleanRuntimeStatus("failed");
          console.error("[skia-canvas] Paper.js boolean runtime failed", {
            error,
          });
        });
      return () => {
        cancelled = true;
      };
    }, []);

    // Space-held → temporary hand tool
    const [spaceHeld, setSpaceHeld] = useState(false);
    const savedToolRef = useRef<CanvasTool>("select");
    const effectiveTool = spaceHeld ? "hand" : activeTool;

    // Drag state for pan/move/resize
    type DragState =
      | {
          kind: "pan";
          startX: number;
          startY: number;
          originX: number;
          originY: number;
        }
      | {
          kind: "move";
          nodeIds: string[];
          startX: number;
          startY: number;
          origins: Record<string, CanvasBounds>;
        }
      | {
          kind: "resize";
          nodeId: string;
          handle: ResizeHandle;
          startX: number;
          startY: number;
          origin: CanvasBounds;
          preserveAspectRatio: boolean;
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
          shapeType: DrawableShapeTool;
          startPoint: { x: number; y: number };
        }
      | {
          kind: "pen";
        }
      | {
          kind: "marquee";
          startX: number;
          startY: number;
          originSelection: string[];
        };
    const dragRef = useRef<DragState | null>(null);
    const clipboardRef = useRef<CanvasClipboardData | null>(null);
    const toast = useToast();

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

    // -----------------------------------------------------------------------
    // CanvasKit init
    // -----------------------------------------------------------------------

    useEffect(() => {
      let cancelled = false;
      loadCanvasKit("/canvaskit/")
        .then((ck) => {
          if (cancelled) return;
          ckRef.current = ck;
          setCkReady(true);
          console.info("[skia-canvas] CanvasKit loaded");
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("[skia-canvas] CanvasKit load failed", err);
          setCkError(
            `Failed to load CanvasKit: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      return () => {
        cancelled = true;
      };
    }, []);

    // -----------------------------------------------------------------------
    // PenRenderer init
    // -----------------------------------------------------------------------

    useEffect(() => {
      if (!ckReady || !ckRef.current) return;
      const container = canvasContainerRef.current;
      if (!container) return;

      // Create canvas element
      const canvas = document.createElement("canvas");
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvasElRef.current = canvas;
      container.appendChild(canvas);

      const renderer = new PenRenderer(ckRef.current, {
        fontBasePath: "/fonts/",
        iconLookup: lookupCanvasIcon,
        backgroundColor: "#ffffff",
      });
      renderer.init(canvas);
      syncRendererDocument(renderer, docRef.current, activePageIdRef.current);
      renderer.zoomToFit(64);
      rendererRef.current = renderer;
      renderer.setEditorOverlays(editorOverlayRef.current);

      console.info("[skia-canvas] PenRenderer initialized");

      // ResizeObserver for responsive canvas
      const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) renderer.resize(w, h);
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        renderer.dispose();
        if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
        rendererRef.current = null;
        canvasElRef.current = null;
      };
    }, [ckReady]);

    // -----------------------------------------------------------------------
    // Document commit helper
    // -----------------------------------------------------------------------

    const notifySceneListeners = useCallback(
      (
        next: PenDocument,
        activePageId: string,
        selection: readonly string[],
      ) => {
        queueMicrotask(() => {
          const elements = toSceneElements(next, activePageId);
          const state = toAppState(next, [...selection]);
          const files = toFiles(next);
          for (const listener of listenersRef.current) {
            listener(elements, state, files);
          }
        });
      },
      [],
    );

    const commitDocument = useCallback(
      (
        next: PenDocument,
        opts?: {
          captureHistory?: boolean;
          notify?: boolean;
          selection?: string[];
        },
      ) => {
        const normalized = normalizeCanvasPages(next);
        const previousActivePageId = activePageIdRef.current;
        const nextActivePageId = reconcileActivePageId(
          next,
          normalized,
          previousActivePageId,
        );
        const requestedSelection =
          opts && "selection" in opts
            ? (opts.selection ?? [])
            : getDocumentSelection(normalized, selectedIds);
        const nextSelection = filterSelectionForActivePage(
          normalized,
          requestedSelection,
          nextActivePageId,
        );
        const committed = {
          ...normalized,
          activePageId: nextActivePageId,
          selection: nextSelection,
        } as CanvasRuntimeDocument;
        if (previousActivePageId !== nextActivePageId) {
          console.info("[skia-canvas] page.active.reconciled", {
            previousActivePageId,
            activePageId: nextActivePageId,
          });
        }
        if (opts?.captureHistory !== false) {
          setHistoryStack((prev) => {
            const trimmed = prev.slice(0, historyIndex + 1);
            return [...trimmed, docRef.current];
          });
          setHistoryIndex((prev) => prev + 1);
        }
        activePageIdRef.current = nextActivePageId;
        setActivePageId(nextActivePageId);
        setSelectedIds(nextSelection);
        setEditorOverlay({ selectedIds: nextSelection });
        docRef.current = committed;
        setDoc(committed);

        // Update renderer
        syncRendererDocument(rendererRef.current, committed, nextActivePageId);

        if (opts?.notify !== false) {
          onDocumentChange?.(committed as CucumberCanvasDocument);
        }

        notifySceneListeners(committed, nextActivePageId, nextSelection);
      },
      [
        historyIndex,
        notifySceneListeners,
        onDocumentChange,
        selectedIds,
        setEditorOverlay,
      ],
    );

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    const setSelection = useCallback(
      (
        nodeIds: string[],
        opts?: { notifyScene?: boolean; notifySelection?: boolean },
      ) => {
        const activePageId = activePageIdRef.current;
        const validIds = nodeIds.filter((id) =>
          Boolean(findNode(docRef.current, id, activePageId)),
        );
        setSelectedIds(validIds);
        const next = {
          ...docRef.current,
          selection: validIds,
        } as PenDocument & { selection: string[] };
        docRef.current = next;
        setDoc(next);
        setEditorOverlay({ selectedIds: validIds });
        if (opts?.notifyScene !== false) {
          notifySceneListeners(next, activePageId, validIds);
        }
        if (opts?.notifySelection !== false) {
          onSelectionChange?.(
            validIds
              .map((id) => findNode(docRef.current, id, activePageId))
              .filter(isPenNode)
              .map((node) => toSceneElement(node)),
          );
        }
      },
      [notifySceneListeners, onSelectionChange, setEditorOverlay],
    );

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

    // -----------------------------------------------------------------------
    // Hit testing (click to select)
    // -----------------------------------------------------------------------

    const handleCanvasClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        const renderer = rendererRef.current;
        if (!renderer) return;
        const hit = renderer.hitTest(event.clientX, event.clientY);

        if (event.shiftKey) {
          if (!hit) return;
          const next = selectedIds.includes(hit.id)
            ? selectedIds.filter((id) => id !== hit.id)
            : [...selectedIds, hit.id];
          setSelection(next);
        } else {
          setSelection(hit ? [hit.id] : []);
        }
      },
      [selectedIds, setSelection],
    );

    // -----------------------------------------------------------------------
    // Wheel → zoom
    // -----------------------------------------------------------------------

    const handleWheel = useCallback(
      (event: React.WheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const renderer = rendererRef.current;
        if (!renderer) return;
        const vp = renderer.getViewport();
        const newZoom = Math.min(
          3,
          Math.max(0.25, vp.zoom - event.deltaY * 0.001),
        );
        renderer.zoomToPoint(event.clientX, event.clientY, newZoom);
      },
      [],
    );

    // -----------------------------------------------------------------------
    // Pointer events (pan, marquee, move)
    // -----------------------------------------------------------------------

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        // Middle button → pan
        if (event.button === 1) {
          event.preventDefault();
          const vp = renderer.getViewport();
          dragRef.current = {
            kind: "pan",
            startX: event.clientX,
            startY: event.clientY,
            originX: vp.panX,
            originY: vp.panY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (event.button !== 0) return;

        const tool = effectiveTool;
        if (tool === "hand") {
          const vp = renderer.getViewport();
          dragRef.current = {
            kind: "pan",
            startX: event.clientX,
            startY: event.clientY,
            originX: vp.panX,
            originY: vp.panY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        // Marquee selection
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const hit = renderer.hitTest(event.clientX, event.clientY);
        const activePageId = activePageIdRef.current;

        if (tool === "select") {
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
            const bounds = getNodeBounds(node);
            if (controlHit.type === "resize") {
              dragRef.current = {
                kind: "resize",
                nodeId: controlHit.nodeId,
                handle: controlHit.handle,
                startX: event.clientX,
                startY: event.clientY,
                origin: bounds,
                preserveAspectRatio: event.shiftKey,
              };
            } else {
              const center = {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              };
              const start = screenToScene(
                event.clientX,
                event.clientY,
                rect,
                renderer.getViewport(),
              );
              dragRef.current = {
                kind: "rotate",
                nodeId: controlHit.nodeId,
                center,
                originRotation: bounds.rotation ?? 0,
                startAngle: pointToAngle(center, start),
              };
            }
            suppressNextClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }

          if (hit && !event.shiftKey) {
            // Start move if clicking on selected node
            if (selectedIds.includes(hit.id)) {
              const origins: Record<string, CanvasBounds> = {};
              for (const id of selectedIds) {
                const n = findNode(docRef.current, id, activePageId);
                if (n) origins[id] = getNodeBounds(n);
              }
              dragRef.current = {
                kind: "move",
                nodeIds: [...selectedIds],
                startX: event.clientX,
                startY: event.clientY,
                origins,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            // Click select
            setSelection([hit.id]);
            return;
          }

          // Start marquee
          if (!event.shiftKey) setSelection([]);
          dragRef.current = {
            kind: "marquee",
            startX: screenX,
            startY: screenY,
            originSelection: [...selectedIds],
          };
          setEditorOverlay({ marquee: null });
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (isDrawableShapeTool(tool)) {
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          dragRef.current = {
            kind: "drawShape",
            shapeType: tool,
            startPoint: scene,
          };
          setEditorOverlay({
            shapePreview: {
              type: tool,
              bounds: { x: scene.x, y: scene.y, width: 0, height: 0 },
              fillColor:
                tool === "rect" ? DEFAULT_RECT_FILL : DEFAULT_SHAPE_FILL,
            },
          });
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (tool === "path") {
          const viewport = renderer.getViewport();
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            viewport,
          );
          if (penTool.onMouseDown(scene, viewport.zoom)) {
            dragRef.current = { kind: "pen" };
            suppressNextClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          return;
        }

        // Other drawing tools keep the legacy click-to-create behavior for now.
        if (tool === "container") {
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          const bounds = defaultBounds(docRef.current, "container");
          createContainer({
            x: scene.x - bounds.width / 2,
            y: scene.y - bounds.height / 2,
            width: bounds.width,
            height: bounds.height,
          });
          setActiveTool("select");
          return;
        }

        if (tool === "text" || tool === "line" || tool === "arrow") {
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          createShapeNode(tool, scene.x, scene.y);
          setActiveTool("select");
        }
      },
      [effectiveTool, penTool, selectedIds, setEditorOverlay, setSelection],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        const drag = dragRef.current;
        if (!drag || !renderer) return;

        if (drag.kind === "pan") {
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          const vp = renderer.getViewport();
          renderer.setViewport(vp.zoom, drag.originX + dx, drag.originY + dy);
          return;
        }

        if (drag.kind === "marquee") {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const start = screenToScene(
            rect.left + drag.startX,
            rect.top + drag.startY,
            rect,
            renderer.getViewport(),
          );
          const end = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          const bounds = normalizeDrawBounds(start, end, false);
          setEditorOverlay({ marquee: bounds });
          const hitIds = getVisibleCanvasNodesInBounds(
            docRef.current as CucumberCanvasDocument,
            bounds,
            activePageIdRef.current,
          ).map((node) => node.id);
          setSelection(
            Array.from(new Set([...drag.originSelection, ...hitIds])),
            { notifySelection: true },
          );
          return;
        }

        if (drag.kind === "drawShape") {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          setEditorOverlay({
            shapePreview: {
              type: drag.shapeType,
              bounds: normalizeDrawBounds(
                drag.startPoint,
                scene,
                event.shiftKey,
              ),
              fillColor:
                drag.shapeType === "rect"
                  ? DEFAULT_RECT_FILL
                  : DEFAULT_SHAPE_FILL,
            },
          });
          return;
        }

        if (drag.kind === "pen") {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const scene = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          penTool.onMouseMove(scene);
          return;
        }

        if (drag.kind === "move") {
          const vp = renderer.getViewport();
          const dx = (event.clientX - drag.startX) / vp.zoom;
          const dy = (event.clientY - drag.startY) / vp.zoom;

          let next = docRef.current;
          for (const nodeId of drag.nodeIds) {
            const origin = drag.origins[nodeId];
            if (!origin) continue;
            const activePageId = activePageIdRef.current;
            const node = findNode(next, nodeId, activePageId);
            if (!node || node.locked) continue;
            next = applyCanvasOperation(next, {
              type: "updateNode",
              nodeId,
              updates: {
                x: origin.x + dx,
                y: origin.y + dy,
              } as Partial<PenNode>,
              activePageId,
            });
          }
          docRef.current = next;
          setDoc(next);
          syncRendererDocument(renderer, next, activePageIdRef.current);
        }

        if (drag.kind === "resize") {
          const vp = renderer.getViewport();
          const dx = (event.clientX - drag.startX) / vp.zoom;
          const dy = (event.clientY - drag.startY) / vp.zoom;
          const bounds = calculateResizeBounds(
            drag.origin,
            drag.handle,
            dx,
            dy,
            event.shiftKey || drag.preserveAspectRatio,
          );
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: boundsToNodeUpdates(bounds),
            activePageId: activePageIdRef.current,
          });
          docRef.current = next;
          setDoc(next);
          syncRendererDocument(renderer, next, activePageIdRef.current);
          return;
        }

        if (drag.kind === "rotate") {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const point = screenToScene(
            event.clientX,
            event.clientY,
            rect,
            renderer.getViewport(),
          );
          const rotation =
            drag.originRotation +
            pointToAngle(drag.center, point) -
            drag.startAngle;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: { rotation: Math.round(rotation) } as Partial<PenNode>,
            activePageId: activePageIdRef.current,
          });
          docRef.current = next;
          setDoc(next);
          syncRendererDocument(renderer, next, activePageIdRef.current);
        }
      },
      [penTool, setEditorOverlay, setSelection],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        const drag = dragRef.current;
        if (drag?.kind === "drawShape" && renderer) {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          if (rect) {
            const scene = screenToScene(
              event.clientX,
              event.clientY,
              rect,
              renderer.getViewport(),
            );
            const bounds = normalizeDrawBounds(
              drag.startPoint,
              scene,
              event.shiftKey,
            );
            if (
              bounds.width >= MIN_DRAW_SIZE &&
              bounds.height >= MIN_DRAW_SIZE
            ) {
              const node = createDrawableShapeNode(drag.shapeType, bounds);
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
              });
            } else {
              console.info("[skia-canvas] shape.draw.cancelled", {
                type: drag.shapeType,
                reason: "below_minimum_size",
              });
            }
          }
          setEditorOverlay({ shapePreview: null });
          setActiveTool("select");
          suppressNextClickRef.current = true;
        }
        if (drag?.kind === "pen") {
          penTool.onMouseUp();
          suppressNextClickRef.current = true;
        }
        if (
          drag?.kind === "move" ||
          drag?.kind === "resize" ||
          drag?.kind === "rotate"
        ) {
          onDocumentChange?.(docRef.current as CucumberCanvasDocument);
          console.info("[skia-canvas] selection.transform.committed", {
            kind: drag.kind,
            nodeCount: drag.kind === "move" ? drag.nodeIds.length : 1,
          });
        }
        if (drag?.kind === "marquee") {
          setEditorOverlay({ marquee: null });
          suppressNextClickRef.current = true;
          console.info("[skia-canvas] selection.marquee.committed", {
            selectedCount: (
              (docRef.current as CanvasRuntimeDocument).selection ?? []
            ).length,
          });
        }
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [
        commitDocument,
        onDocumentChange,
        penTool,
        setEditorOverlay,
        setSelection,
      ],
    );

    const handleDoubleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (effectiveTool !== "path") return;
        if (penTool.onDblClick()) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClickRef.current = true;
        }
      },
      [effectiveTool, penTool],
    );

    // -----------------------------------------------------------------------
    // Keyboard: space → hand tool
    // -----------------------------------------------------------------------

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== "Space" || e.repeat) return;
        const target = e.target as HTMLElement;
        if (target.closest("input, textarea, [contenteditable]")) return;
        e.preventDefault();
        savedToolRef.current = activeTool;
        setSpaceHeld(true);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === "Space") setSpaceHeld(false);
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      };
    }, [activeTool]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (effectiveTool !== "path") return;
        const target = e.target as HTMLElement;
        if (target.closest("input, textarea, [contenteditable]")) return;
        if (penTool.onKeyDown(e.key)) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [effectiveTool, penTool]);

    // -----------------------------------------------------------------------
    // CanvasApi
    // -----------------------------------------------------------------------

    const createContainer = useCallback(
      (opts?: {
        name?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }) => {
        const id = createNodeId("container");
        const defaultB = defaultBounds(docRef.current, "container");
        const b = {
          x: opts?.x ?? defaultB.x,
          y: opts?.y ?? defaultB.y,
          width: opts?.width ?? defaultB.width,
          height: opts?.height ?? defaultB.height,
        };
        const container = {
          id,
          type: "frame" as const,
          name: opts?.name ?? "New container",
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          fill: [{ type: "solid" as const, color: "rgba(255,255,255,0.78)" }],
          stroke: {
            thickness: 2,
            fill: [{ type: "solid" as const, color: "#6c5ce7" }],
          },
          opacity: 1,
          children: [] as PenNode[],
          containerRole: ["visual", "task", "context"] as ContainerRole[],
          contextSlots: {},
          inheritPolicy: "merge" as const,
          permissions: {
            owner: "user",
            canRead: [] as string[],
            canWrite: [] as string[],
            isolationLevel: "open" as const,
          },
        } satisfies PenNode;
        const next = applyCanvasOperation(docRef.current, {
          type: "insertNode",
          node: container,
          activePageId: activePageIdRef.current,
        });
        commitDocument(next, { selection: [id] });
        setSelection([id], { notifyScene: false });
        console.info("[skia-canvas] container.created", { containerId: id });
        return container;
      },
      [commitDocument, setSelection],
    );

    const createShapeNode = useCallback(
      (shapeType: string, cx: number, cy: number) => {
        const id = createNodeId(shapeType);
        let node: PenNode;
        const shared = { id, x: cx - 80, y: cy - 60, width: 160, height: 120 };

        switch (shapeType) {
          case "rect":
            node = {
              ...shared,
              type: "rectangle" as const,
              name: "Rectangle",
              cornerRadius: 12,
              fill: [{ type: "solid" as const, color: DEFAULT_RECT_FILL }],
            } as unknown as PenNode;
            break;
          case "ellipse":
            node = {
              ...shared,
              type: "ellipse" as const,
              name: "Ellipse",
              fill: [{ type: "solid" as const, color: DEFAULT_SHAPE_FILL }],
            } as unknown as PenNode;
            break;
          case "text":
            node = {
              ...shared,
              type: "text" as const,
              name: "Text",
              content: "Double click to edit",
              fontSize: 28,
              fill: [{ type: "solid" as const, color: "#111827" }],
            } as unknown as PenNode;
            break;
          case "line":
          case "arrow":
            node = {
              id,
              type: "line" as const,
              name: shapeType === "arrow" ? "Arrow" : "Line",
              x: cx - 80,
              y: cy,
              width: 160,
              height: 1,
              x2: cx + 80,
              y2: cy,
              stroke: {
                thickness: 3,
                fill: [{ type: "solid" as const, color: "#111827" }],
              },
              ...(shapeType === "arrow" ? { _connectorType: "arrow" } : null),
            } as unknown as PenNode;
            break;
          default:
            node = {
              ...shared,
              type: "rectangle" as const,
              name: shapeType,
              fill: [{ type: "solid" as const, color: DEFAULT_RECT_FILL }],
            } as unknown as PenNode;
        }

        const next = applyCanvasOperation(docRef.current, {
          type: "insertNode",
          node,
          activePageId: activePageIdRef.current,
        });
        commitDocument(next, { selection: [id] });
        setSelection([id], { notifyScene: false });
      },
      [commitDocument, setSelection],
    );

    const notifySelectionForDoc = useCallback(
      (nextDoc: PenDocument, nodeIds: string[]) => {
        const activePageId = activePageIdRef.current;
        onSelectionChange?.(
          nodeIds
            .map((id) => findNode(nextDoc, id, activePageId))
            .filter(isPenNode)
            .map((node) => toSceneElement(node)),
        );
      },
      [onSelectionChange],
    );

    const copySelection = useCallback(() => {
      if (selectedIds.length === 0) return false;
      const activePageId = activePageIdRef.current;
      const topSelection = getTopLevelSelectionIds(
        docRef.current as CucumberCanvasDocument,
        selectedIds,
        activePageId,
      );
      clipboardRef.current = copyCanvasSelection(docRef.current, topSelection);
      console.info("[skia-canvas] selection.copied", {
        count: clipboardRef.current.nodes.length,
      });
      return true;
    }, [selectedIds]);

    const deleteSelection = useCallback(() => {
      const activePageId = activePageIdRef.current;
      const ids = getTopLevelSelectionIds(
        docRef.current as CucumberCanvasDocument,
        selectedIds,
        activePageId,
      );
      if (ids.length === 0) return;
      let next = docRef.current;
      for (const nodeId of ids) {
        next = applyCanvasOperation(next, {
          type: "deleteNode",
          nodeId,
          activePageId,
        });
      }
      commitDocument(next, { selection: [] });
      setSelection([], { notifyScene: false });
      console.info("[skia-canvas] selection.deleted", { count: ids.length });
    }, [commitDocument, selectedIds, setSelection]);

    const cutSelection = useCallback(() => {
      if (copySelection()) {
        deleteSelection();
      }
    }, [copySelection, deleteSelection]);

    const pasteClipboard = useCallback(() => {
      const clipboard = clipboardRef.current;
      if (!clipboard) return [];
      const parentId = getPrimarySelectedContainerId(
        docRef.current as CucumberCanvasDocument,
        selectedIds,
        activePageIdRef.current,
      );
      const result = pasteCanvasClipboard(docRef.current, clipboard, {
        parentId,
        offset: 18,
      });
      commitDocument(result.doc, { selection: result.pastedIds });
      setSelection(result.pastedIds, { notifyScene: false });
      notifySelectionForDoc(result.doc, result.pastedIds);
      console.info("[skia-canvas] clipboard.pasted", {
        count: result.pastedIds.length,
        parentId,
      });
      return result.pastedIds;
    }, [commitDocument, notifySelectionForDoc, selectedIds, setSelection]);

    const importFromPayload = useCallback(
      (payload: ClipboardImportPayload, context?: ClipboardImportContext) => {
        const parsed = parseClipboardImport(payload);
        if (!parsed) {
          console.info("[skia-canvas] clipboard.import.ignored", {
            trigger: context?.trigger ?? "unknown",
            mimeTypes: context?.mimeTypes ?? [],
            itemTypes: context?.itemTypes ?? [],
            fileTypes: context?.fileTypes ?? [],
            hasHtml: Boolean(payload.html),
            hasText: Boolean(payload.text),
            hasSvg: Boolean(payload.svg),
            itemCount: payload.items?.length ?? 0,
            fileCount: payload.files?.length ?? 0,
          });
          return [];
        }
        const importBounds = getCanvasImportBounds(parsed);
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        const viewport = rendererRef.current?.getViewport() ?? {
          zoom: 1,
          panX: 0,
          panY: 0,
        };
        const viewportCenter = {
          x: ((rect?.width ?? 0) / 2 - viewport.panX) / viewport.zoom,
          y: ((rect?.height ?? 0) / 2 - viewport.panY) / viewport.zoom,
        };
        const offsetX = importBounds
          ? viewportCenter.x - (importBounds.x + importBounds.width / 2)
          : 0;
        const offsetY = importBounds
          ? viewportCenter.y - (importBounds.y + importBounds.height / 2)
          : 0;
        const inserted = insertCanvasImportResult(docRef.current, parsed, {
          parentId: getPrimarySelectedContainerId(
            docRef.current as CucumberCanvasDocument,
            selectedIds,
            activePageIdRef.current,
          ),
          offsetX,
          offsetY,
        });
        commitDocument(inserted.doc, { selection: inserted.insertedIds });
        setSelection(inserted.insertedIds, { notifyScene: false });
        notifySelectionForDoc(inserted.doc, inserted.insertedIds);
        if (parsed.warnings.length > 0) {
          toast.toast(
            `${parsed.sourceLabel} 已导入 ${inserted.insertedIds.length} 个节点，包含 ${parsed.warnings.length} 条兼容性提醒。`,
          );
        } else {
          toast.success(
            `${parsed.sourceLabel} 已导入 ${inserted.insertedIds.length} 个节点。`,
          );
        }
        console.info("[skia-canvas] clipboard.imported", {
          trigger: context?.trigger ?? "unknown",
          mimeTypes: context?.mimeTypes ?? [],
          itemTypes: context?.itemTypes ?? [],
          fileTypes: context?.fileTypes ?? [],
          source: parsed.source,
          strategy: getClipboardImportStrategy(parsed),
          importSessionId: parsed.importSessionId,
          rootCount: parsed.rootNodeIds.length,
          assetCount: parsed.assets.length,
          insertedCount: inserted.insertedIds.length,
          warningCount: parsed.warnings.length,
          warnings: parsed.warnings.map((warning) => ({
            code: warning.code,
            message: warning.message,
            originNodeType: warning.originNodeType,
            originNodeId: warning.originNodeId,
          })),
          nodeSummary: summarizeImportedNodes(parsed),
        });
        return inserted.insertedIds;
      },
      [commitDocument, notifySelectionForDoc, selectedIds, setSelection, toast],
    );

    const pasteFromSystemClipboard = useCallback(async () => {
      const { payload, context } = await readClipboardImportPayload();
      if (
        !payload.html &&
        !payload.text &&
        !payload.svg &&
        !payload.items?.length &&
        !payload.files?.length
      ) {
        return [];
      }
      try {
        return importFromPayload(payload, context);
      } catch (error) {
        console.warn("[skia-canvas] clipboard.import.failed", {
          trigger: context.trigger,
          mimeTypes: context.mimeTypes,
          error,
        });
        toast.error(
          error instanceof Error ? error.message : "剪贴板导入失败，请重试。",
        );
        return [];
      }
    }, [importFromPayload, toast]);

    const importSvgMarkup = useCallback(
      (svgMarkup: string) => {
        try {
          return importFromPayload(
            { text: svgMarkup },
            {
              trigger: "clipboard-api",
              mimeTypes: ["image/svg+xml", "text/plain"],
              hasHtml: false,
              hasText: true,
            },
          );
        } catch (error) {
          console.warn("[skia-canvas] svg.import.failed", { error });
          toast.error(
            error instanceof Error ? error.message : "SVG 导入失败。",
          );
          return [];
        }
      },
      [importFromPayload, toast],
    );

    const duplicateSelection = useCallback(() => {
      if (selectedIds.length === 0) return [];
      const activePageId = activePageIdRef.current;
      const topSelection = getTopLevelSelectionIds(
        docRef.current as CucumberCanvasDocument,
        selectedIds,
        activePageId,
      );
      const result = duplicateCanvasNodes(docRef.current, topSelection, 18);
      commitDocument(result.doc, { selection: result.pastedIds });
      setSelection(result.pastedIds, { notifyScene: false });
      notifySelectionForDoc(result.doc, result.pastedIds);
      console.info("[skia-canvas] selection.duplicated", {
        count: result.pastedIds.length,
      });
      return result.pastedIds;
    }, [commitDocument, notifySelectionForDoc, selectedIds, setSelection]);

    const insertImageNode = useCallback(
      (
        artifact: {
          assetId?: string;
          jobId?: string;
          url: string;
          mimeType: string;
          width?: number;
          height?: number;
          title?: string;
        },
        source: CanvasAsset["source"],
      ) => {
        const id = createNodeId("image");
        const assetId =
          artifact.assetId ?? artifact.jobId ?? createNodeId("asset");
        const targetContainerId = getPrimarySelectedContainerId(
          docRef.current as CucumberCanvasDocument,
          selectedIds,
          activePageIdRef.current,
        );
        const b = defaultBounds(docRef.current, "image", targetContainerId);
        const asset: CanvasAsset = {
          id: assetId,
          url: artifact.url,
          mimeType: artifact.mimeType,
          name: artifact.title,
          width: artifact.width,
          height: artifact.height,
          source,
        };
        const node: PenNode = {
          id,
          type: "image",
          name: artifact.title ?? "Generated image",
          x: b.x,
          y: b.y,
          width: artifact.width ?? b.width,
          height: artifact.height ?? b.height,
          src: artifact.url,
          fileId: assetId,
          imageFit: "cover",
          meta: { source, title: artifact.title },
        } as unknown as PenNode;
        const next = applyCanvasOperation(
          {
            ...docRef.current,
            assets: {
              ...((docRef.current as CanvasRuntimeDocument).assets ?? {}),
              [assetId]: asset,
            },
          } as PenDocument,
          {
            type: "insertNode",
            node,
            parentId: targetContainerId,
            activePageId: activePageIdRef.current,
          },
        );
        commitDocument(next, { selection: [id] });
        setSelection([id], { notifyScene: false });
        console.info("[skia-canvas] image.inserted", {
          nodeId: id,
          assetId,
          source,
        });
      },
      [commitDocument, selectedIds, setSelection],
    );

    const getActivePageId = useCallback(() => activePageIdRef.current, []);

    const setActivePage = useCallback(
      (pageId: string) => {
        try {
          const currentActivePageId = activePageIdRef.current;
          if (pageId.trim() === currentActivePageId) {
            return;
          }
          const activePageId = resolveActivePageId(docRef.current, pageId);
          const next = { ...docRef.current, activePageId, selection: [] };
          commitDocument(next, { selection: [] });
          setSelection([], { notifyScene: false });
          console.info("[skia-canvas] page.active.changed", {
            pageId: activePageId,
          });
        } catch (error) {
          console.warn("[skia-canvas] page.active.change.failed", {
            requestedPageId: pageId,
            error,
          });
          throw error;
        }
      },
      [commitDocument, setSelection],
    );

    const getPages = useCallback(() => getCanvasPages(docRef.current), []);

    const addPage = useCallback(
      (name?: string) => {
        const result = addCanvasPage(docRef.current, { name });
        commitDocument({
          ...result.document,
          activePageId: result.page.id,
          selection: [],
        } as CanvasRuntimeDocument);
        console.info("[skia-canvas] page.added", {
          pageId: result.page.id,
          name: result.page.name,
          activePageId: result.page.id,
        });
        return result.page.id;
      },
      [commitDocument],
    );

    const renamePage = useCallback(
      (pageId: string, name: string) => {
        const result = renameCanvasPage(docRef.current, pageId, name);
        commitDocument(result.document);
        console.info("[skia-canvas] page.renamed", {
          pageId,
          name: result.page.name,
        });
      },
      [commitDocument],
    );

    const duplicatePage = useCallback(
      (pageId: string) => {
        const result = duplicateCanvasPage(docRef.current, pageId);
        commitDocument({
          ...result.document,
          activePageId: result.page.id,
          selection: [],
        } as CanvasRuntimeDocument);
        console.info("[skia-canvas] page.duplicated", {
          sourcePageId: pageId,
          pageId: result.page.id,
          name: result.page.name,
          activePageId: result.page.id,
        });
        return result.page.id;
      },
      [commitDocument],
    );

    const deletePage = useCallback(
      (pageId: string) => {
        const result = deleteCanvasPage(docRef.current, pageId);
        const activePageId = resolveActivePageId(result.document);
        const nextSelection = filterSelectionForActivePage(
          result.document,
          getDocumentSelection(docRef.current, selectedIds),
          activePageId,
        );
        commitDocument(result.document, { selection: nextSelection });
        setSelection(nextSelection, { notifyScene: false });
        console.info("[skia-canvas] page.deleted", {
          deletedPageId: pageId,
          activePageId: result.page.id,
          retainedSelectionCount: nextSelection.length,
        });
      },
      [commitDocument, selectedIds, setSelection],
    );

    const reorderPage = useCallback(
      (pageId: string, direction: "left" | "right") => {
        const result = reorderCanvasPage(docRef.current, pageId, direction);
        commitDocument(result.document);
        console.info("[skia-canvas] page.reordered", {
          pageId,
          direction,
        });
      },
      [commitDocument],
    );

    const applyBooleanOperation = useCallback(
      (operation: BooleanOpType) => {
        try {
          if (booleanRuntimeStatus !== "ready") {
            const reason =
              booleanRuntimeStatus === "loading"
                ? "Boolean operations are still loading the vector runtime."
                : "Boolean operations are unavailable because the vector runtime failed to load.";
            console.warn("[skia-canvas] boolean-operation.rejected", {
              operation,
              selectedIds: getDocumentSelection(docRef.current, selectedIds),
              reason,
            });
            return null;
          }
          const activePageId = resolveActivePageId(docRef.current);
          const currentSelection = getDocumentSelection(
            docRef.current,
            selectedIds,
          );
          const topSelectionIds = getTopLevelSelectionIds(
            docRef.current as CucumberCanvasDocument,
            currentSelection,
            activePageId,
          );
          const nodes = topSelectionIds
            .map((id) => findNode(docRef.current, id, activePageId))
            .filter(isPenNode);

          if (nodes.length !== topSelectionIds.length) {
            console.warn("[skia-canvas] boolean-operation.rejected", {
              operation,
              activePageId,
              selectedIds: topSelectionIds,
              reason:
                "One or more selected nodes no longer exist on the active page.",
            });
            return null;
          }

          const rejectionReason = getBooleanOpRejectionReason(nodes);
          if (rejectionReason) {
            console.warn("[skia-canvas] boolean-operation.rejected", {
              operation,
              activePageId,
              selectedIds: topSelectionIds,
              nodeTypes: nodes.map((node) => node.type),
              reason: rejectionReason,
            });
            return null;
          }

          const activeChildren = getActiveChildren(
            docRef.current,
            activePageId,
          );
          const activeRootIds = new Set(activeChildren.map((node) => node.id));
          const nestedSelectionIds = topSelectionIds.filter(
            (id) => !activeRootIds.has(id),
          );
          if (nestedSelectionIds.length > 0) {
            console.warn("[skia-canvas] boolean-operation.rejected", {
              operation,
              activePageId,
              selectedIds: topSelectionIds,
              nestedSelectionIds,
              reason:
                "Boolean operations currently require top-level selections on the active page.",
            });
            return null;
          }

          const resultPath = executeBooleanOp(nodes, operation);
          if (!resultPath) {
            console.warn("[skia-canvas] boolean-operation.failed", {
              operation,
              activePageId,
              selectedIds: topSelectionIds,
              nodeTypes: nodes.map((node) => node.type),
              reason:
                "Boolean operation could not produce a path from the selected geometry.",
            });
            return null;
          }

          const insertionIndexes = topSelectionIds
            .map((id) => activeChildren.findIndex((node) => node.id === id))
            .filter((index) => index >= 0);
          const insertIndex =
            insertionIndexes.length > 0
              ? Math.min(...insertionIndexes)
              : undefined;

          let next = docRef.current;
          for (const nodeId of topSelectionIds) {
            next = applyCanvasOperation(next, {
              type: "deleteNode",
              nodeId,
              activePageId,
            });
          }
          next = applyCanvasOperation(next, {
            type: "insertNode",
            node: resultPath as PenNode,
            index: insertIndex,
            activePageId,
          });

          const nextSelection = [resultPath.id];
          const nextWithSelection = {
            ...next,
            selection: nextSelection,
          } as CanvasRuntimeDocument;
          commitDocument(nextWithSelection, { selection: nextSelection });
          setSelection(nextSelection, { notifyScene: false });
          console.info("[skia-canvas] boolean-operation.applied", {
            operation,
            activePageId,
            resultNodeId: resultPath.id,
            sourceNodeIds: topSelectionIds,
          });
          return resultPath.id;
        } catch (error) {
          console.warn("[skia-canvas] boolean-operation.failed", {
            operation,
            selectedIds: getDocumentSelection(docRef.current, selectedIds),
            error,
          });
          return null;
        }
      },
      [booleanRuntimeStatus, commitDocument, selectedIds, setSelection],
    );

    const api = useMemo<CanvasApi>(
      () => ({
        getDocument: () => docRef.current as unknown as CucumberCanvasDocument,
        setDocument: (raw: unknown) => {
          const { document: next, reconciledFrom } =
            normalizeRuntimeDocumentForCanvasSet(raw);
          commitDocument(next, { captureHistory: false });
          if (reconciledFrom) {
            console.info("[skia-canvas] page.active.reconciled", {
              previousActivePageId: reconciledFrom,
              activePageId: activePageIdRef.current,
            });
          }
          syncRendererDocument(
            rendererRef.current,
            docRef.current,
            activePageIdRef.current,
          );
          rendererRef.current?.zoomToFit(64);
        },
        getActivePageId,
        setActivePage,
        getPages,
        addPage,
        renamePage,
        duplicatePage,
        deletePage,
        reorderPage,
        applyBooleanOperation,
        getActiveTool: () => activeTool,
        setActiveTool: (tool) => setActiveTool(tool),
        createContainer,
        insertNode: (node, containerId) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "insertNode",
            node: node as unknown as PenNode,
            parentId: containerId,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next);
        },
        updateNode: (nodeId, updates) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: updates as Partial<PenNode>,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next);
        },
        deleteNode: (nodeId) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "deleteNode",
            nodeId,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next);
        },
        bindAgentToContainer: (containerId, binding) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "bindAgent",
            nodeId: containerId,
            binding: binding as AgentBinding,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next);
        },
        setSelection,
        flushPendingSave: async () => undefined,
        exportImage: (opts) =>
          exportDocumentImage(
            docRef.current as unknown as CucumberCanvasDocument,
            { ...opts, activePageId: activePageIdRef.current },
            {
              backgroundColor:
                (
                  docRef.current as PenDocument & {
                    viewport?: { backgroundColor?: string };
                  }
                ).viewport?.backgroundColor ?? "#ffffff",
            },
          ),
        getViewportBounds: () => {
          const rect = canvasContainerRef.current?.getBoundingClientRect();
          const viewport = rendererRef.current?.getViewport() ?? {
            zoom: 1,
            panX: 0,
            panY: 0,
          };
          return {
            x: -viewport.panX / viewport.zoom,
            y: -viewport.panY / viewport.zoom,
            width: (rect?.width ?? 1) / viewport.zoom,
            height: (rect?.height ?? 1) / viewport.zoom,
          };
        },
        getSceneElements: () =>
          toSceneElements(docRef.current, activePageIdRef.current),
        getFiles: () => toFiles(docRef.current),
        getAppState: () =>
          toAppState(
            docRef.current,
            filterSelectionForActivePage(
              docRef.current,
              getDocumentSelection(docRef.current, selectedIds),
              activePageIdRef.current,
            ),
          ),
        updateScene: (scene) => {
          if (scene.appState) {
            const state = scene.appState;
            const vp = rendererRef.current?.getViewport();
            if (
              vp &&
              state.zoom &&
              state.scrollX !== undefined &&
              state.scrollY !== undefined
            ) {
              rendererRef.current?.setViewport(
                state.zoom.value,
                state.scrollX,
                state.scrollY,
              );
            }
          }
        },
        addFiles: (incoming) => {
          const assets = {
            ...((
              docRef.current as PenDocument & {
                assets?: Record<string, CanvasAsset>;
              }
            ).assets ?? {}),
          };
          for (const file of incoming) {
            assets[file.id] = {
              id: file.id,
              url: file.storageUrl ?? file.dataURL ?? "",
              mimeType: file.mimeType,
              name: file.name,
              source: "upload",
            };
          }
          commitDocument({ ...docRef.current, assets } as PenDocument);
          console.info("[skia-canvas] assets.added", {
            count: incoming.length,
          });
        },
        onChange: (listener) => {
          listenersRef.current.add(listener);
          return () => {
            listenersRef.current.delete(listener);
          };
        },
        scrollToContent: () => {
          rendererRef.current?.zoomToFit(64);
        },
        undo: () => {
          if (historyIndex < 0) return;
          const prev = historyStack[historyIndex];
          if (!prev) return;
          setHistoryIndex((i) => i - 1);
          commitDocument(prev, { captureHistory: false });
        },
        redo: () => {
          if (historyIndex >= historyStack.length - 1) return;
          const next = historyStack[historyIndex + 1];
          if (!next) return;
          setHistoryIndex((i) => i + 1);
          commitDocument(next, { captureHistory: false });
        },
        canUndo: () => historyIndex >= 0,
        canRedo: () => historyIndex < historyStack.length - 1,
        copySelection,
        pasteClipboard,
        duplicateSelection,
        deleteSelection,
        groupSelection: () => {
          const topSelection = getTopLevelSelectionIds(
            docRef.current as CucumberCanvasDocument,
            selectedIds,
            activePageIdRef.current,
          );
          if (topSelection.length < 2) return null;
          const groupId = createNodeId("group");
          try {
            const next = applyCanvasOperation(docRef.current, {
              type: "groupNodes",
              groupId,
              nodeIds: topSelection,
              activePageId: activePageIdRef.current,
            });
            commitDocument(next, { selection: [groupId] });
            setSelection([groupId], { notifyScene: false });
            console.info("[skia-canvas] selection.grouped", {
              groupId,
              count: topSelection.length,
            });
            return groupId;
          } catch (e) {
            console.warn("[skia-canvas] selection.group.failed", e);
            return null;
          }
        },
        ungroupSelection: () => {
          const groupIds = selectedIds.filter((id) => {
            const node = findNode(docRef.current, id, activePageIdRef.current);
            return node && node.type === "group";
          });
          if (groupIds.length === 0) return [];
          const ungrouped: string[] = [];
          for (const gid of groupIds) {
            const group = findNode(
              docRef.current,
              gid,
              activePageIdRef.current,
            );
            if (!group || group.type !== "group") continue;
            const childIds = hasPenChildren(group)
              ? group.children.map((child) => child.id)
              : [];
            try {
              const next = applyCanvasOperation(docRef.current, {
                type: "ungroupNode",
                groupId: gid,
                activePageId: activePageIdRef.current,
              });
              docRef.current = next;
              ungrouped.push(...childIds);
            } catch (e) {
              console.warn("[skia-canvas] selection.ungroup.failed", e);
            }
          }
          commitDocument(docRef.current, { selection: ungrouped });
          setSelection(ungrouped, { notifyScene: false });
          return ungrouped;
        },
        alignSelection: (alignment) => {
          const doc = docRef.current;
          const activePageId = activePageIdRef.current;
          const nodes = selectedIds
            .map((id) => findNode(doc, id, activePageId))
            .filter((n): n is NonNullable<typeof n> => !!n && !n.locked);
          if (nodes.length < 2) return;
          let refBounds: {
            x: number;
            y: number;
            width: number;
            height: number;
          } | null = null;
          for (const n of nodes) {
            const b = getNodeBounds(n);
            if (!refBounds) {
              refBounds = { ...b };
              continue;
            }
            refBounds.x = Math.min(refBounds.x, b.x);
            refBounds.y = Math.min(refBounds.y, b.y);
            refBounds.width =
              Math.max(refBounds.x + refBounds.width, b.x + b.width) -
              refBounds.x;
            refBounds.height =
              Math.max(refBounds.y + refBounds.height, b.y + b.height) -
              refBounds.y;
          }
          if (!refBounds) return;
          for (const n of nodes) {
            const b = getNodeBounds(n);
            let update: Partial<PenNode> = {};
            if (alignment === "left") update = { x: refBounds.x };
            else if (alignment === "center")
              update = { x: refBounds.x + (refBounds.width - b.width) / 2 };
            else if (alignment === "right")
              update = { x: refBounds.x + refBounds.width - b.width };
            else if (alignment === "top") update = { y: refBounds.y };
            else if (alignment === "middle")
              update = { y: refBounds.y + (refBounds.height - b.height) / 2 };
            else if (alignment === "bottom")
              update = { y: refBounds.y + refBounds.height - b.height };
            if (Object.keys(update).length > 0) {
              const next = applyCanvasOperation(docRef.current, {
                type: "updateNode",
                nodeId: n.id,
                updates: update as Partial<PenNode>,
                activePageId,
              });
              docRef.current = next;
            }
          }
          commitDocument(docRef.current);
        },
        reorderNode: (nodeId, direction) => {
          const activePageId = activePageIdRef.current;
          const next = applyCanvasOperation(docRef.current, {
            type: "reorderNode",
            nodeId,
            direction,
            activePageId,
          });
          commitDocument(next);
        },
        moveNodeToIndex: (nodeId, targetParentId, targetIndex) => {
          const activePageId = activePageIdRef.current;
          const next = applyCanvasOperation(docRef.current, {
            type: "reorderNode",
            nodeId,
            targetParentId,
            targetIndex,
            activePageId,
          });
          commitDocument(next);
        },
        toggleNodeLocked: (nodeId) => {
          const activePageId = activePageIdRef.current;
          const node = findNode(docRef.current, nodeId, activePageId);
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: { locked: !node.locked } as Partial<PenNode>,
            activePageId,
          });
          commitDocument(next);
        },
        toggleNodeVisible: (nodeId) => {
          const activePageId = activePageIdRef.current;
          const node = findNode(docRef.current, nodeId, activePageId);
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: { visible: node.visible === false } as Partial<PenNode>,
            activePageId,
          });
          commitDocument(next);
        },
        pasteFromSystemClipboard,
        importSvgMarkup,
        insertImageArtifact: (artifact) =>
          insertImageNode(artifact, "generated"),
        insertVideoArtifact: (artifact) => {
          const id = createNodeId("videoEmbed");
          const b = defaultBounds(docRef.current, "videoEmbed");
          const node: PenNode = {
            id,
            type: "videoEmbed",
            name: artifact.title ?? "Generated video",
            x: b.x,
            y: b.y,
            width: artifact.width ?? b.width,
            height: artifact.height ?? b.height,
            src: artifact.url,
          } as PenNode;
          const next = applyCanvasOperation(docRef.current, {
            type: "insertNode",
            node,
            activePageId: activePageIdRef.current,
          });
          commitDocument(next, { selection: [id] });
          setSelection([id], { notifyScene: false });
        },
      }),
      [
        activeTool,
        addPage,
        applyBooleanOperation,
        commitDocument,
        copySelection,
        createContainer,
        deletePage,
        deleteSelection,
        duplicatePage,
        duplicateSelection,
        getActivePageId,
        getPages,
        historyIndex,
        historyStack,
        importSvgMarkup,
        insertImageNode,
        pasteClipboard,
        pasteFromSystemClipboard,
        renamePage,
        reorderPage,
        selectedIds,
        setActivePage,
        setSelection,
      ],
    );

    useImperativeHandle(ref, () => api, [api]);

    useEffect(() => {
      onApiReady?.(api);
    }, [api, onApiReady]);

    useCanvasKeyboardShortcuts({
      undo: api.undo,
      redo: api.redo,
      selectAll: () =>
        setSelection(
          getOrderedCanvasNodes(docRef.current, activePageIdRef.current)
            .map((entry) => entry.node)
            .filter((node) => node.visible !== false)
            .map((node) => node.id),
        ),
      copySelection,
      cutSelection,
      pasteClipboard,
      pasteFromSystemClipboard,
      duplicateSelection,
      deleteSelection,
      groupSelection: api.groupSelection,
      ungroupSelection: api.ungroupSelection,
      nudgeSelection: (dx, dy) => {
        if (selectedIds.length === 0) return;
        const activePageId = activePageIdRef.current;
        let next = docRef.current;
        for (const nodeId of selectedIds) {
          const node = findNode(next, nodeId, activePageId);
          if (!node || node.locked) continue;
          const bounds = getNodeBounds(node);
          next = applyCanvasOperation(next, {
            type: "updateNode",
            nodeId,
            updates: {
              x: bounds.x + dx,
              y: bounds.y + dy,
            } as Partial<PenNode>,
            activePageId,
          });
        }
        commitDocument(next);
      },
      reorderSelection: (direction) => {
        const topSelection = getTopLevelSelectionIds(
          docRef.current as CucumberCanvasDocument,
          selectedIds,
          activePageIdRef.current,
        );
        for (const nodeId of topSelection) {
          api.reorderNode(nodeId, direction);
        }
      },
      setActiveTool: (tool) => {
        setActiveTool(tool === "pen" ? "path" : tool);
      },
    });

    useCanvasClipboardImport({
      onImportPayload: (payload, context) => {
        try {
          return importFromPayload(payload, context).length > 0;
        } catch (error) {
          console.warn("[skia-canvas] clipboard.import.failed", {
            trigger: context.trigger,
            mimeTypes: context.mimeTypes,
            error,
          });
          toast.error(
            error instanceof Error ? error.message : "剪贴板导入失败，请重试。",
          );
          return false;
        }
      },
    });

    const handleImportImage = useCallback(() => {
      console.info("[skia-canvas] toolbar.import-image.requested", {
        activePageId: activePageIdRef.current,
      });
      toast.toast(
        "Use paste or drag-and-drop to import images on this canvas.",
      );
    }, [toast]);

    const handleImportSvg = useCallback(async () => {
      const importedIds = await pasteFromSystemClipboard();
      if (importedIds.length === 0) {
        console.info("[skia-canvas] toolbar.import-svg.empty", {
          activePageId: activePageIdRef.current,
        });
        toast.toast(
          "Copy SVG markup or a supported clipboard payload before importing SVG.",
        );
        return;
      }
      console.info("[skia-canvas] toolbar.import-svg.imported", {
        activePageId: activePageIdRef.current,
        count: importedIds.length,
      });
    }, [pasteFromSystemClipboard, toast]);

    const booleanRejectionReason = useMemo(() => {
      const currentSelection = getDocumentSelection(doc, selectedIds);
      if (currentSelection.length < 2) return null;
      if (booleanRuntimeStatus === "loading") {
        return "Boolean operations are still loading the vector runtime.";
      }
      if (booleanRuntimeStatus === "failed") {
        return "Boolean operations are unavailable because the vector runtime failed to load.";
      }
      const topSelectionIds = getTopLevelSelectionIds(
        doc as CucumberCanvasDocument,
        currentSelection,
        activePageId,
      );
      if (topSelectionIds.length < 2) {
        return "Select at least two top-level supported vector shapes.";
      }
      const topSelectionNodes = topSelectionIds
        .map((id) => findNode(doc, id, activePageId))
        .filter(isPenNode);
      if (topSelectionNodes.length !== topSelectionIds.length) {
        return "One or more selected nodes are no longer available on the active page.";
      }
      const activeChildren = getActiveChildren(doc, activePageId);
      const activeRootIds = new Set(activeChildren.map((node) => node.id));
      const nestedSelectionIds = topSelectionIds.filter(
        (id) => !activeRootIds.has(id),
      );
      if (nestedSelectionIds.length > 0) {
        return "Boolean operations require top-level selections on the active page.";
      }
      return getBooleanOpRejectionReason(topSelectionNodes);
    }, [activePageId, booleanRuntimeStatus, doc, selectedIds]);

    // -----------------------------------------------------------------------
    // Initial document sync
    // -----------------------------------------------------------------------

    // biome-ignore lint/correctness/useExhaustiveDependencies: initial content should resync only when CanvasKit becomes ready.
    useEffect(() => {
      if (!ckReady || !rendererRef.current) return;
      const next = normalizeRuntimeDocument(initialContent);
      commitDocument(next, { captureHistory: false });
      syncRendererDocument(
        rendererRef.current,
        docRef.current,
        activePageIdRef.current,
      );
      rendererRef.current.zoomToFit(64);
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

    return (
      <div
        className={`relative h-full w-full overflow-hidden ${cursorClass}`}
        style={{ backgroundColor: "#ffffff" }}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        onKeyDown={() => undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* CanvasKit canvas container */}
        <div ref={canvasContainerRef} className="absolute inset-0" />

        {/* Toolbar overlays */}
        <CanvasEditorToolbar
          activeTool={activeTool}
          canRedo={api.canRedo()}
          canUndo={api.canUndo()}
          onCreateContainer={() => createContainer()}
          onDelete={api.deleteSelection}
          onImportImage={handleImportImage}
          onImportSvg={handleImportSvg}
          onRedo={api.redo}
          onToolChange={setActiveTool}
          onUndo={api.undo}
          selectedCount={selectedIds.length}
        />

        <CanvasBooleanToolbar
          onBooleanOperation={api.applyBooleanOperation}
          rejectionReason={booleanRejectionReason}
          visible={selectedIds.length >= 2}
        />

        <div className="absolute bottom-4 left-[clamp(6rem,50%,calc(100vw-6rem))] z-20 flex -translate-x-1/2 justify-center">
          <CanvasPageTabs
            pages={api.getPages()}
            activePageId={activePageId}
            onAddPage={() => api.addPage()}
            onDeletePage={api.deletePage}
            onDuplicatePage={api.duplicatePage}
            onRenamePage={api.renamePage}
            onReorderPage={api.reorderPage}
            onSetActivePage={api.setActivePage}
          />
        </div>

        {/* Property panel */}
        {selectedIds.length === 1 && selectedIds[0]
          ? (() => {
              const selectedNodeId = selectedIds[0];
              if (!selectedNodeId) return null;
              const selectedNode = findNode(doc, selectedNodeId, activePageId);
              if (!selectedNode) return null;
              const ctx = resolveContext(doc, selectedNodeId);
              return (
                <CanvasPropertyPanel
                  node={selectedNode}
                  context={ctx}
                  variables={doc.variables}
                  onVariablesChange={(variables) => {
                    commitDocument({
                      ...docRef.current,
                      variables,
                    });
                  }}
                  onUpdate={(updates) => {
                    api.updateNode(selectedNodeId, updates);
                  }}
                  onBindAgent={(binding: AgentBinding) => {
                    api.bindAgentToContainer(selectedNodeId, binding);
                  }}
                />
              );
            })()
          : null}

        {/* Loading indicator while CK initializes */}
        {!rendererRef.current && ckReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <p className="text-sm text-muted-foreground">
              Initializing renderer...
            </p>
          </div>
        ) : null}
      </div>
    );
  }),
);

function isDrawableShapeTool(tool: CanvasTool): tool is DrawableShapeTool {
  return tool === "rect" || tool === "ellipse" || tool === "polygon";
}

function normalizeDrawBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  forceSquare: boolean,
): CanvasBounds {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (forceSquare) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: Math.min(start.x, start.x + width),
    y: Math.min(start.y, start.y + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function boundsToNodeUpdates(bounds: CanvasBounds): Partial<PenNode> {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
  } as Partial<PenNode>;
}

function pointToAngle(
  center: { x: number; y: number },
  point: { x: number; y: number },
): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function calculateResizeBounds(
  origin: CanvasBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  preserveAspectRatio: boolean,
): CanvasBounds {
  let { x, y, width, height } = origin;
  const minSize = 8;
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }

  if (preserveAspectRatio) {
    const ratio =
      Math.max(origin.width, minSize) / Math.max(origin.height, minSize);
    if (Math.abs(dx) > Math.abs(dy)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (handle.includes("w")) x = origin.x + origin.width - width;
    if (handle.includes("n")) y = origin.y + origin.height - height;
  }

  if (width < minSize) {
    if (handle.includes("w")) x = origin.x + origin.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes("n")) y = origin.y + origin.height - minSize;
    height = minSize;
  }

  return { x, y, width, height, rotation: origin.rotation };
}

function createDrawableShapeNode(
  type: DrawableShapeTool,
  bounds: CanvasBounds,
): PenNode {
  const id = createNodeId(type === "rect" ? "rectangle" : type);
  const shared = {
    id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fill: [
      {
        type: "solid" as const,
        color: type === "rect" ? DEFAULT_RECT_FILL : DEFAULT_SHAPE_FILL,
      },
    ],
  };

  if (type === "rect") {
    return {
      ...shared,
      type: "rectangle",
      name: "Rectangle",
      cornerRadius: 8,
    } as PenNode;
  }
  if (type === "ellipse") {
    return {
      ...shared,
      type: "ellipse",
      name: "Ellipse",
    } as PenNode;
  }
  return {
    ...shared,
    type: "polygon",
    name: "Polygon",
    polygonCount: 3,
  } as PenNode;
}
