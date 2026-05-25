"use client";

import {
  type AgentBinding,
  applyCanvasOperation,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasNode,
  type ContainerNode,
  createNodeId,
  type CucumberCanvasDocument,
  findNode,
  findParent,
  flattenNodes,
  getNodeBounds,
  groupNodesInDoc,
  isContainerNode,
  resolveContext,
  ungroupNodeInDoc,
} from "@cucumber/canvas-core";
import {
  createEmptyDocument,
  findNodeInList,
  getActiveChildren,
  setActiveChildren,
} from "@cucumber/canvas-core";
import type { PenDocument, PenNode, FrameNode } from "@cucumber/pen-types";
import {
  loadCanvasKit,
  PenRenderer,
  screenToScene,
} from "@cucumber/pen-renderer";
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

import type { CanvasApi, CanvasSceneElement, CanvasFileRecord, CanvasAppState, CanvasChangeListener } from "./canvas-surface";
import { CanvasPropertyPanel } from "./property-panel/canvas-property-panel";
import { penNodeToLegacy, legacyUpdateToPenNode } from "./property-panel/pen-node-adapter";

// ---------------------------------------------------------------------------
// Helpers to bridge old canvas-surface types
// ---------------------------------------------------------------------------

function toSceneElement(node: PenNode): CanvasSceneElement {
  const b = getNodeBounds(node);
  return {
    id: node.id,
    type: node.type,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    visible: node.visible,
    locked: node.locked,
    depth: 0,
    customData: (node as unknown as Record<string, unknown>).meta as Record<string, unknown> | undefined,
  };
}

function toSceneElements(doc: PenDocument): CanvasSceneElement[] {
  return flattenNodes(doc)
    .filter((n) => n.visible !== false)
    .map(toSceneElement);
}

function toAppState(doc: PenDocument): CanvasAppState {
  return {
    zoom: { value: (doc as any).viewport?.zoom ?? 1 },
    scrollX: (doc as any).viewport?.x ?? 0,
    scrollY: (doc as any).viewport?.y ?? 0,
    viewBackgroundColor: (doc as any).viewport?.backgroundColor ?? "#ffffff",
    selectedElementIds: Object.fromEntries(
      ((doc as any).selection ?? []).map((id: string) => [id, true]),
    ),
  };
}

function toFiles(doc: PenDocument): Record<string, CanvasFileRecord> {
  const assets = (doc as any).assets as Record<string, CanvasAsset> | undefined;
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
  const vp = (doc as any).viewport ?? { x: 0, y: 0, zoom: 1 };
  const cx = -vp.x / vp.zoom + 200;
  const cy = -vp.y / vp.zoom + 200;
  return { x: cx, y: cy, width: 300, height: 200 };
}

function normalizePenDocument(raw: unknown): PenDocument {
  if (raw && typeof raw === "object" && "version" in raw) {
    return raw as PenDocument;
  }
  return createEmptyDocument();
}

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

type CanvasTool =
  | "select"
  | "hand"
  | "container"
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "icon"
  | "text"
  | "line"
  | "arrow";

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
      normalizePenDocument(initialContent),
    );
    const docRef = useRef(doc);
    docRef.current = doc;

    const listenersRef = useRef(new Set<CanvasChangeListener>());
    const [historyStack, setHistoryStack] = useState<PenDocument[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [activeTool, setActiveTool] = useState<CanvasTool>("select");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    // Space-held → temporary hand tool
    const [spaceHeld, setSpaceHeld] = useState(false);
    const savedToolRef = useRef<CanvasTool>("select");
    const effectiveTool = spaceHeld ? "hand" : activeTool;

    // Drag state for pan/move/resize
    type DragState =
      | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
      | { kind: "move"; nodeIds: string[]; startX: number; startY: number; origins: Record<string, CanvasBounds> }
      | { kind: "marquee"; startX: number; startY: number; originSelection: string[] };
    const dragRef = useRef<DragState | null>(null);

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
          setCkError(`Failed to load CanvasKit: ${err instanceof Error ? err.message : String(err)}`);
        });
      return () => { cancelled = true; };
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
        backgroundColor: "#ffffff",
      });
      renderer.init(canvas);
      renderer.setDocument(docRef.current);
      renderer.zoomToFit(64);
      rendererRef.current = renderer;

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

    const commitDocument = useCallback(
      (next: PenDocument, opts?: { captureHistory?: boolean; notify?: boolean }) => {
        if (opts?.captureHistory !== false) {
          setHistoryStack((prev) => {
            const trimmed = prev.slice(0, historyIndex + 1);
            return [...trimmed, docRef.current];
          });
          setHistoryIndex((prev) => prev + 1);
        }
        docRef.current = next;
        setDoc(next);

        // Update renderer
        rendererRef.current?.setDocument(next);

        if (opts?.notify !== false) {
          onDocumentChange?.(next as CucumberCanvasDocument);
        }

        // Notify scene listeners
        queueMicrotask(() => {
          const elements = toSceneElements(next);
          const state = toAppState(next);
          const files = toFiles(next);
          for (const listener of listenersRef.current) {
            listener(elements, state, files);
          }
        });
      },
      [historyIndex, onDocumentChange],
    );

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    const setSelection = useCallback(
      (nodeIds: string[], opts?: { notifySelection?: boolean }) => {
        setSelectedIds(nodeIds);
        const next = {
          ...docRef.current,
          selection: nodeIds,
        } as PenDocument & { selection: string[] };
        docRef.current = next;
        setDoc(next);
        if (opts?.notifySelection !== false) {
          onSelectionChange?.(
            nodeIds
              .map((id) => findNode(docRef.current, id))
              .filter(Boolean)
              .map((node) => toSceneElement(node!)),
          );
        }
      },
      [onSelectionChange],
    );

    // -----------------------------------------------------------------------
    // Hit testing (click to select)
    // -----------------------------------------------------------------------

    const handleCanvasClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const hit = renderer.hitTest(screenX, screenY);

        if (event.shiftKey) {
          // Additive selection
          setSelectedIds((prev) => {
            if (!hit) return prev;
            const next = prev.includes(hit.id)
              ? prev.filter((id) => id !== hit.id)
              : [...prev, hit.id];
            return next;
          });
        } else {
          setSelection(hit ? [hit.id] : []);
        }
      },
      [setSelection],
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
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const newZoom = Math.min(3, Math.max(0.25, vp.zoom - event.deltaY * 0.001));
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        renderer.zoomToPoint(sx, sy, newZoom);
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
        const hit = renderer.hitTest(screenX, screenY);

        if (tool === "select") {
          if (hit && !event.shiftKey) {
            // Start move if clicking on selected node
            if (selectedIds.includes(hit.id)) {
              const origins: Record<string, CanvasBounds> = {};
              for (const id of selectedIds) {
                const n = findNode(docRef.current, id);
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
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        // Drawing tools → create shape at click position
        if (
          tool === "rect" || tool === "ellipse" || tool === "polygon" ||
          tool === "container" || tool === "text"
        ) {
          const scene = screenToScene(screenX, screenY, rect, renderer.getViewport());
          createShapeNode(tool, scene.x, scene.y);
          setActiveTool("select");
        }
      },
      [effectiveTool, selectedIds, setSelection],
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
          // Basic marquee — just track, selection done on up
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
            const node = findNode(next, nodeId);
            if (!node || node.locked) continue;
            next = applyCanvasOperation(next, {
              type: "updateNode",
              nodeId,
              updates: {
                x: origin.x + dx,
                y: origin.y + dy,
              } as Partial<PenNode>,
            });
          }
          docRef.current = next;
          setDoc(next);
          renderer.setDocument(next);
        }
      },
      [],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag?.kind === "move") {
          onDocumentChange?.(docRef.current as CucumberCanvasDocument);
        }
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [onDocumentChange],
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

    // -----------------------------------------------------------------------
    // CanvasApi
    // -----------------------------------------------------------------------

    const createContainer = useCallback(
      (opts?: Partial<{ title: string; bounds: CanvasBounds }>) => {
        const id = createNodeId("container");
        const b = opts?.bounds ?? defaultBounds(docRef.current, "container");
        const container = {
          id,
          type: "frame" as const,
          name: opts?.title ?? "New container",
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          fill: [{ type: "solid" as const, color: "rgba(255,255,255,0.78)" }],
          stroke: { thickness: 2, fill: [{ type: "solid" as const, color: "#6c5ce7" }] },
          opacity: 1,
          children: [] as PenNode[],
          containerRole: ["visual", "task", "context"] as import("@cucumber/pen-types").ContainerRole[],
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
        });
        commitDocument(next);
        setSelection([id]);
        console.info("[skia-canvas] container.created", { containerId: id });
        return container as unknown as ContainerNode;
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
              ...shared, type: "rectangle" as const, name: "Rectangle",
              cornerRadius: 12,
              fill: [{ type: "solid" as const, color: "#d3f256" }],
              stroke: { thickness: 2, fill: [{ type: "solid" as const, color: "#111827" }] },
            } as unknown as PenNode;
            break;
          case "ellipse":
            node = {
              ...shared, type: "ellipse" as const, name: "Ellipse",
              fill: [{ type: "solid" as const, color: "#f8fafc" }],
              stroke: { thickness: 2, fill: [{ type: "solid" as const, color: "#111827" }] },
            } as unknown as PenNode;
            break;
          case "text":
            node = {
              ...shared, type: "text" as const, name: "Text",
              text: "Double click to edit",
              fontSize: 28,
              fill: [{ type: "solid" as const, color: "#111827" }],
            } as unknown as PenNode;
            break;
          default:
            node = {
              ...shared, type: "rectangle" as const, name: shapeType,
              fill: [{ type: "solid" as const, color: "#d3f256" }],
            } as unknown as PenNode;
        }

        const next = applyCanvasOperation(docRef.current, {
          type: "insertNode",
          node,
        });
        commitDocument(next);
        setSelection([id]);
      },
      [commitDocument, setSelection],
    );

    const api = useMemo<CanvasApi>(
      () => ({
        getDocument: () => docRef.current as unknown as CucumberCanvasDocument,
        setDocument: (raw: unknown) => {
          const next = normalizePenDocument(raw);
          commitDocument(next, { captureHistory: false });
          rendererRef.current?.setDocument(next);
          rendererRef.current?.zoomToFit(64);
        },
        createContainer,
        insertNode: (node, containerId) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "insertNode",
            node: node as unknown as PenNode,
            parentId: containerId,
          });
          commitDocument(next);
        },
        updateNode: (nodeId, updates) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: updates as Partial<PenNode>,
          });
          commitDocument(next);
        },
        deleteNode: (nodeId) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "deleteNode",
            nodeId,
          });
          commitDocument(next);
        },
        bindAgentToContainer: (containerId, binding) => {
          const next = applyCanvasOperation(docRef.current, {
            type: "bindAgent",
            nodeId: containerId,
            binding: binding as AgentBinding,
          });
          commitDocument(next);
        },
        setSelection,
        flushPendingSave: async () => undefined,
        exportImage: async () => {
          // Skia canvas → toDataURL
          const canvas = canvasElRef.current;
          if (!canvas) throw new Error("Canvas not initialized");
          return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Failed to export image"));
            }, "image/png");
          });
        },
        getSceneElements: () => toSceneElements(docRef.current),
        getFiles: () => toFiles(docRef.current),
        getAppState: () => toAppState(docRef.current),
        updateScene: (scene) => {
          if (scene.appState) {
            const state = scene.appState;
            const vp = rendererRef.current?.getViewport();
            if (vp && state.zoom && state.scrollX !== undefined && state.scrollY !== undefined) {
              rendererRef.current?.setViewport(
                state.zoom.value,
                state.scrollX,
                state.scrollY,
              );
            }
          }
        },
        addFiles: (_files) => {
          // No-op for now — assets managed elsewhere
        },
        onChange: (listener) => {
          listenersRef.current.add(listener);
          return () => { listenersRef.current.delete(listener); };
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
          rendererRef.current?.setDocument(prev);
        },
        redo: () => {
          if (historyIndex >= historyStack.length - 1) return;
          const next = historyStack[historyIndex + 1];
          if (!next) return;
          setHistoryIndex((i) => i + 1);
          commitDocument(next, { captureHistory: false });
          rendererRef.current?.setDocument(next);
        },
        canUndo: () => historyIndex >= 0,
        canRedo: () => historyIndex < historyStack.length - 1,
        copySelection: () => false,
        pasteClipboard: () => [],
        duplicateSelection: () => [],
        deleteSelection: () => {
          for (const id of selectedIds) {
            const next = applyCanvasOperation(docRef.current, {
              type: "deleteNode",
              nodeId: id,
            });
            commitDocument(next, { notify: false });
          }
          setSelection([]);
          onDocumentChange?.(docRef.current as CucumberCanvasDocument);
        },
        groupSelection: () => {
          if (selectedIds.length < 2) return null;
          const groupId = createNodeId("group");
          const doc = docRef.current;
          try {
            groupNodesInDoc(doc, groupId, [...selectedIds]);
            commitDocument(doc);
            setSelection([groupId]);
            return groupId;
          } catch (e) {
            console.warn("[groupSelection]", e);
            return null;
          }
        },
        ungroupSelection: () => {
          const groupIds = selectedIds.filter((id) => {
            const node = findNode(docRef.current, id);
            return node && node.type === "group";
          });
          if (groupIds.length === 0) return [];
          const doc = docRef.current;
          const ungrouped: string[] = [];
          for (const gid of groupIds) {
            const group = findNode(doc, gid);
            if (!group || group.type !== "group") continue;
            const childIds = ((group as any).children as any[] | undefined)?.map((c: any) => c.id) ?? [];
            try {
              ungroupNodeInDoc(doc, gid);
              ungrouped.push(...childIds);
            } catch (e) {
              console.warn("[ungroupSelection]", e);
            }
          }
          commitDocument(doc);
          setSelection(ungrouped);
          return ungrouped;
        },
        alignSelection: (alignment) => {
          const doc = docRef.current;
          const nodes = selectedIds.map((id) => findNode(doc, id)).filter((n): n is NonNullable<typeof n> => !!n && !n.locked);
          if (nodes.length < 2) return;
          let refBounds: { x: number; y: number; width: number; height: number } | null = null;
          for (const n of nodes) {
            const b = getNodeBounds(n);
            if (!refBounds) { refBounds = { ...b }; continue; }
            refBounds.x = Math.min(refBounds.x, b.x);
            refBounds.y = Math.min(refBounds.y, b.y);
            refBounds.width = Math.max(refBounds.x + refBounds.width, b.x + b.width) - refBounds.x;
            refBounds.height = Math.max(refBounds.y + refBounds.height, b.y + b.height) - refBounds.y;
          }
          if (!refBounds) return;
          for (const n of nodes) {
            const b = getNodeBounds(n);
            let update: Partial<PenNode> = {};
            if (alignment === "left") update = { x: refBounds.x };
            else if (alignment === "center") update = { x: refBounds.x + (refBounds.width - b.width) / 2 };
            else if (alignment === "right") update = { x: refBounds.x + refBounds.width - b.width };
            else if (alignment === "top") update = { y: refBounds.y };
            else if (alignment === "middle") update = { y: refBounds.y + (refBounds.height - b.height) / 2 };
            else if (alignment === "bottom") update = { y: refBounds.y + refBounds.height - b.height };
            if (Object.keys(update).length > 0) {
              const next = applyCanvasOperation(docRef.current, { type: "updateNode", nodeId: n.id, updates: update as Partial<PenNode> });
              docRef.current = next;
            }
          }
          commitDocument(docRef.current);
        },
        reorderNode: (nodeId, direction) => {
          const doc = docRef.current;
          const node = findNode(doc, nodeId);
          if (!node) return;
          const parent = findParent(doc, nodeId);
          const siblings = parent && "children" in parent && Array.isArray((parent as any).children)
            ? (parent as any).children as PenNode[]
            : flattenNodes(doc).filter((n) => !findParent(doc, n.id));
          const idx = siblings.findIndex((c: PenNode) => c.id === nodeId);
          if (idx < 0) return;
          const reordered = siblings.filter((c: PenNode) => c.id !== nodeId);
          if (direction === "front" || direction === "forward") {
            const newIdx = Math.min(reordered.length, idx + (direction === "front" ? reordered.length : 1));
            reordered.splice(newIdx, 0, node);
          } else {
            const newIdx = Math.max(0, idx - (direction === "back" ? reordered.length : 1));
            reordered.splice(newIdx, 0, node);
          }
          if (parent && "children" in parent) {
            const next = applyCanvasOperation(doc, { type: "updateNode", nodeId: parent.id, updates: { children: reordered } as Partial<PenNode> });
            docRef.current = next;
          }
          commitDocument(docRef.current);
        },
        moveNodeToIndex: (nodeId, targetParentId, targetIndex) => {
          const doc = docRef.current;
          const node = findNode(doc, nodeId);
          if (!node) return;
          // Remove from current position
          let next = applyCanvasOperation(doc, { type: "deleteNode", nodeId });
          // Insert at new position
          next = applyCanvasOperation(next, { type: "insertNode", node, parentId: targetParentId });
          if (targetParentId && targetIndex >= 0) {
            const parent = findNode(next, targetParentId);
            if (parent && "children" in parent && Array.isArray((parent as any).children)) {
              const children = [...(parent as any).children as PenNode[]];
              const nodeIdx = children.findIndex((c: PenNode) => c.id === nodeId);
              if (nodeIdx >= 0 && nodeIdx !== targetIndex) {
                const [moved] = children.splice(nodeIdx, 1);
                children.splice(Math.min(targetIndex, children.length), 0, moved!);
                next = applyCanvasOperation(next, { type: "updateNode", nodeId: targetParentId, updates: { children } as Partial<PenNode> });
              }
            }
          }
          docRef.current = next;
          commitDocument(next);
        },
        toggleNodeLocked: (nodeId) => {
          const node = findNode(docRef.current, nodeId);
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: { locked: !node.locked } as Partial<PenNode>,
          });
          commitDocument(next);
        },
        toggleNodeVisible: (nodeId) => {
          const node = findNode(docRef.current, nodeId);
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId,
            updates: { visible: node.visible === false } as Partial<PenNode>,
          });
          commitDocument(next);
        },
        pasteFromSystemClipboard: async () => {
          try {
            // Try to read HTML from clipboard (Figma/SVG paste)
            const clipboardData = await navigator.clipboard.read();
            for (const item of clipboardData) {
              if (item.types.includes("text/html")) {
                const blob = await item.getType("text/html");
                const html = await blob.text();
                const nodes = pasteHtmlToPenNodes(html, createNodeId);
                if (nodes.length > 0) {
                  let next = docRef.current;
                  const insertedIds: string[] = [];
                  for (const node of nodes) {
                    next = applyCanvasOperation(next, { type: "insertNode", node });
                    insertedIds.push(node.id);
                  }
                  commitDocument(next);
                  setSelection(insertedIds);
                  return insertedIds;
                }
              }
              if (item.types.includes("text/plain")) {
                const blob = await item.getType("text/plain");
                const text = await blob.text();
                // Create a text node with the pasted plain text
                const id = createNodeId("text");
                const vp = rendererRef.current?.getViewport() ?? { zoom: 1, panX: 0, panY: 0 };
                const node: PenNode = {
                  id,
                  type: "text",
                  name: text.slice(0, 30),
                  content: text,
                  x: 100 - (vp.panX / vp.zoom),
                  y: 100 - (vp.panY / vp.zoom),
                  width: 300,
                  height: 40,
                  fontSize: 16,
                  fill: [{ type: "solid", color: "#111827" }],
                } as PenNode;
                const next = applyCanvasOperation(docRef.current, { type: "insertNode", node });
                commitDocument(next);
                setSelection([id]);
                return [id];
              }
            }
          } catch (err) {
            console.warn("[skia-canvas] paste from clipboard failed", err);
          }
          return [];
        },
        importSvgMarkup: () => [],
        insertImageArtifact: (artifact) => {
          const id = createNodeId("image");
          const b = defaultBounds(docRef.current, "image");
          const node: PenNode = {
            id,
            type: "image",
            name: artifact.title ?? "Generated image",
            x: b.x,
            y: b.y,
            width: artifact.width ?? b.width,
            height: artifact.height ?? b.height,
            src: artifact.url,
            imageFit: "cover",
          } as PenNode;
          const next = applyCanvasOperation(docRef.current, {
            type: "insertNode",
            node,
          });
          commitDocument(next);
          setSelection([id]);
        },
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
          });
          commitDocument(next);
          setSelection([id]);
        },
        createShapeNode,
      } as CanvasApi),
      [
        commitDocument, createContainer, setSelection, selectedIds,
        historyIndex, historyStack, onDocumentChange, createShapeNode,
      ],
    );

    useImperativeHandle(ref, () => api, [api]);

    useEffect(() => {
      onApiReady?.(api);
    }, [api, onApiReady]);

    // -----------------------------------------------------------------------
    // Initial document sync
    // -----------------------------------------------------------------------

    useEffect(() => {
      if (!rendererRef.current) return;
      const next = normalizePenDocument(initialContent);
      commitDocument(next, { captureHistory: false });
      rendererRef.current.setDocument(next);
      rendererRef.current.zoomToFit(64);
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
      effectiveTool === "hand" ? "cursor-grab"
      : effectiveTool === "select" ? "cursor-default"
      : "cursor-crosshair";

    return (
      <div
        className={`relative h-full w-full overflow-hidden ${cursorClass}`}
        style={{ backgroundColor: "#ffffff" }}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* CanvasKit canvas container */}
        <div ref={canvasContainerRef} className="absolute inset-0" />

        {/* Toolbar overlay */}
        <SkiaToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onCreateContainer={() => createContainer()}
          onDelete={() => api.deleteSelection()}
          selectedCount={selectedIds.length}
          canUndo={api.canUndo()}
          canRedo={api.canRedo()}
          onUndo={api.undo}
          onRedo={api.redo}
        />

        {/* Property panel */}
        {selectedIds.length === 1 && selectedIds[0] ? (
          (() => {
            const selectedNode = findNode(doc, selectedIds[0]!);
            if (!selectedNode) return null;
            const legacyNode = penNodeToLegacy(selectedNode);
            const ctx = resolveContext(doc, selectedIds[0]!);
            return (
              <CanvasPropertyPanel
                node={legacyNode}
                context={ctx}
                onUpdate={(updates) => {
                  const penUpdates = legacyUpdateToPenNode(updates as Record<string, unknown>);
                  api.updateNode(selectedIds[0]!, penUpdates);
                }}
                onBindAgent={(binding: AgentBinding) => {
                  api.bindAgentToContainer(selectedIds[0]!, binding);
                }}
              />
            );
          })()
        ) : null}

        {/* Loading indicator while CK initializes */}
        {!rendererRef.current && ckReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <p className="text-sm text-muted-foreground">Initializing renderer...</p>
          </div>
        ) : null}
      </div>
    );
  }),
);

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

import {
  Circle,
  Frame,
  Hand,
  MousePointer2,
  PenTool,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Box,
} from "lucide-react";

function SkiaToolbar({
  activeTool,
  onToolChange,
  onCreateContainer,
  onDelete,
  selectedCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onCreateContainer: () => void;
  onDelete: () => void;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div
      className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 px-1.5 py-1.5 shadow-card backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className={`${btn} ${activeTool === "select" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("select")} title="选择">
        <MousePointer2 className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "hand" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("hand")} title="抓手">
        <Hand className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button className={btn} disabled={!canUndo} onClick={onUndo} title="撤销">
        <Undo2 className="h-4 w-4" />
      </button>
      <button className={btn} disabled={!canRedo} onClick={onRedo} title="重做">
        <Redo2 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button className={btn} onClick={onCreateContainer} title="新建容器">
        <Plus className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button className={`${btn} ${activeTool === "rect" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("rect")} title="矩形">
        <Box className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "ellipse" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("ellipse")} title="椭圆">
        <Circle className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "polygon" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("polygon")} title="多边形">
        <Triangle className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "path" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("path")} title="路径">
        <PenTool className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "icon" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("icon")} title="图标">
        <Sparkles className="h-4 w-4" />
      </button>
      <button className={`${btn} ${activeTool === "text" ? "bg-muted text-foreground" : ""}`} onClick={() => onToolChange("text")} title="文字">
        <Type className="h-4 w-4" />
      </button>
      <button className={btn} disabled={selectedCount === 0} onClick={onDelete} title="删除">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste helper — parse SVG/HTML from clipboard into PenNodes directly
// ---------------------------------------------------------------------------

function pasteHtmlToPenNodes(
  html: string,
  createId: (prefix?: string) => string,
): PenNode[] {
  if (typeof DOMParser === "undefined") return [];

  // Try to extract SVG from Figma HTML clipboard
  const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch?.[0]) {
    return parseSvgStringToPenNodes(svgMatch[0], createId);
  }

  // Parse as HTML (Figma styled-HTML fallback)
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes: PenNode[] = [];

  for (const el of Array.from(doc.body.children)) {
    const converted = htmlElementToPenNode(el, null, createId);
    if (converted) nodes.push(converted);
  }
  return nodes;
}

function parseSvgStringToPenNodes(
  svg: string,
  createId: (prefix?: string) => string,
): PenNode[] {
  if (typeof DOMParser === "undefined") return [];
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, "image/svg+xml");
  const svgEl = svgDoc.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") return [];

  const nodes: PenNode[] = [];
  const importId = createId("import");

  for (const child of Array.from(svgEl.children)) {
    const node = svgElementToPenNode(child, null, importId, createId);
    if (node) nodes.push(node);
  }
  return nodes;
}

function svgElementToPenNode(
  el: Element,
  parentId: string | null,
  importId: string,
  createId: (prefix?: string) => string,
): PenNode | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "defs" || tag === "style" || tag === "title" || tag === "desc") return null;

  const meta = {
    source: "svg-import",
    importSessionId: importId,
    originNodeType: tag,
  };

  if (tag === "g" || tag === "svg") {
    const groupId = createId("group");
    const children: PenNode[] = [];
    for (const child of Array.from(el.children)) {
      const c = svgElementToPenNode(child, groupId, importId, createId);
      if (c) children.push(c);
    }
    if (children.length === 0) return null;
    const minX = Math.min(...children.map((c) => c.x ?? 0));
    const minY = Math.min(...children.map((c) => c.y ?? 0));
    const maxX = Math.max(...children.map((c) => (c.x ?? 0) + ((c as any).width ?? 100)));
    const maxY = Math.max(...children.map((c) => (c.y ?? 0) + ((c as any).height ?? 100)));
    return {
      id: groupId, type: "group", name: "Group",
      x: minX, y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      children, meta,
    } as unknown as PenNode;
  }

  const x = parseFloat(el.getAttribute("x") ?? "0");
  const y = parseFloat(el.getAttribute("y") ?? "0");
  const w = Math.max(1, parseFloat(el.getAttribute("width") ?? "100"));
  const h = Math.max(1, parseFloat(el.getAttribute("height") ?? "100"));
  const fillColor = el.getAttribute("fill");
  const strokeColor = el.getAttribute("stroke");
  const sw = parseFloat(el.getAttribute("stroke-width") ?? "1");
  const fill = fillColor ? [{ type: "solid" as const, color: fillColor }] : undefined;

  if (tag === "rect") {
    return {
      id: createId("rect"), type: "rectangle", name: "Rectangle",
      x, y, width: w, height: h, fill,
      stroke: strokeColor ? { thickness: sw, fill: [{ type: "solid", color: strokeColor }] } : undefined,
      cornerRadius: parseFloat(el.getAttribute("rx") ?? "0") || undefined,
      meta,
    } as unknown as PenNode;
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") ?? "0");
    const cy = parseFloat(el.getAttribute("cy") ?? "0");
    const rx = tag === "circle" ? parseFloat(el.getAttribute("r") ?? "50") : parseFloat(el.getAttribute("rx") ?? "50");
    const ry = tag === "circle" ? parseFloat(el.getAttribute("r") ?? "50") : parseFloat(el.getAttribute("ry") ?? "50");
    return {
      id: createId("ellipse"), type: "ellipse", name: "Ellipse",
      x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, fill,
      stroke: strokeColor ? { thickness: sw, fill: [{ type: "solid", color: strokeColor }] } : undefined,
      meta,
    } as unknown as PenNode;
  }

  if (tag === "line") {
    const x1 = parseFloat(el.getAttribute("x1") ?? "0");
    const y1 = parseFloat(el.getAttribute("y1") ?? "0");
    const x2 = parseFloat(el.getAttribute("x2") ?? "100");
    const y2 = parseFloat(el.getAttribute("y2") ?? "100");
    return {
      id: createId("line"), type: "line", name: "Line",
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      width: Math.max(1, Math.abs(x2 - x1)),
      height: Math.max(1, Math.abs(y2 - y1)),
      stroke: { thickness: sw, fill: [{ type: "solid", color: strokeColor ?? "#111827" }] },
      meta,
    } as unknown as PenNode;
  }

  if (tag === "path") {
    const d = el.getAttribute("d");
    if (!d) return null;
    return {
      id: createId("path"), type: "path", name: "Path",
      x: 0, y: 0, width: 100, height: 100,
      d, fill, stroke: strokeColor ? { thickness: sw, fill: [{ type: "solid", color: strokeColor }] } : undefined,
      meta,
    } as unknown as PenNode;
  }

  if (tag === "text") {
    const text = el.textContent?.trim() ?? "";
    if (!text) return null;
    const fontSize = parseFloat(el.getAttribute("font-size") ?? "16");
    return {
      id: createId("text"), type: "text", name: text.slice(0, 20),
      content: text, x, y: y - fontSize, width: Math.max(50, text.length * fontSize * 0.7), height: fontSize * 2,
      fontSize, fill: fill ?? [{ type: "solid", color: "#111827" }],
      meta,
    } as unknown as PenNode;
  }

  return null;
}

function htmlElementToPenNode(
  el: Element,
  parentId: string | null,
  createId: (prefix?: string) => string,
): PenNode | null {
  const style = parseInlineCss(el.getAttribute("style") ?? "");
  const left = parseFloat(style.left ?? "0") || 0;
  const top = parseFloat(style.top ?? "0") || 0;
  const width = parseFloat(style.width ?? "100") || 100;
  const height = parseFloat(style.height ?? "100") || 100;
  const bg = style.backgroundColor ?? style.background;
  const text = el.textContent?.trim() ?? "";
  const importId = createId("import");

  const nodes: PenNode[] = [];
  if (bg && width > 0 && height > 0) {
    nodes.push({
      id: createId("rect"), type: "rectangle", name: "Block",
      x: left, y: top, width, height,
      fill: [{ type: "solid", color: bg }],
      cornerRadius: parseFloat(style.borderRadius ?? "0") || undefined,
      meta: { source: "figma-paste", importSessionId: importId },
    } as unknown as PenNode);
  }
  if (text) {
    nodes.push({
      id: createId("text"), type: "text", name: text.slice(0, 20),
      content: text, x: left, y: top, width: Math.max(50, text.length * 14), height: 28,
      fontSize: parseFloat(style.fontSize ?? "14") || 14,
      fill: [{ type: "solid", color: style.color ?? "#111827" }],
      meta: { source: "figma-paste", importSessionId: importId },
    } as unknown as PenNode);
  }

  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0]!;

  return {
    id: createId("group"), type: "group", name: "Pasted",
    x: left, y: top, width, height,
    children: nodes,
    meta: { source: "figma-paste", importSessionId: importId },
  } as unknown as PenNode;
}

function parseInlineCss(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw.split(";")) {
    const [key, ...rest] = entry.split(":");
    if (key && rest.length > 0) {
      result[key.trim()] = rest.join(":").trim();
    }
  }
  return result;
}

