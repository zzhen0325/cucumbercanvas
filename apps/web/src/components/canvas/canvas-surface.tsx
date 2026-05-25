"use client";

import {
  type AgentBinding,
  applyImportedAutoLayout,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasClipboardData,
  type CanvasFill,
  type CanvasImportedAutoLayoutMeta,
  type CanvasStroke,
  type ClipboardImportPayload,
  CanvasHistoryManager,
  getCanvasImportedNodeMeta,
  type PenNode,
  type ContextSlots,
  type CucumberCanvasDocument,
  applyCanvasOperation,
  copyCanvasSelection,
  createNodeId,
  duplicateCanvasNodes,
  findNode,
  findParent,
  flattenNodes,
  getCanvasImportBounds,
  getNodeBounds,
  getOrderedCanvasNodes,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
  isContainerNode,
  normalizeBounds,
  normalizeCanvasDocument,
  parseClipboardImport,
  pasteCanvasClipboard,
  resolveContext,
} from "@cucumber/canvas-core";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowRight,
  Box,
  Circle,
  Frame,
  Group,
  Hand,
  ImagePlus,
  Lock,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Redo2,
  RotateCw,
  Sparkles,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Ungroup,
  Unlock,
} from "lucide-react";
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

import {
  getPrimarySelectedContainerId,
  getTopLevelSelectionIds,
} from "./canvas-selection-helpers";
import {
  type ClipboardImportContext,
  readClipboardImportPayload,
  useCanvasClipboardImport,
} from "./use-canvas-clipboard-import";
import { useCanvasKeyboardShortcuts } from "./use-canvas-keyboard-shortcuts";
import { usePenTool, buildPenPathSvg, bakePenAnchorsToPathData, getPenPathBounds } from "./canvas-pen-tool";
import { executeBooleanOp, setPaperModule, computeLayoutPositions } from "@cucumber/pen-core";

export type CanvasChangeListener = (
  elements: CanvasSceneElement[],
  appState: CanvasAppState,
  files: Record<string, CanvasFileRecord>,
) => void;

export type CanvasSceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  fileId?: string;
  text?: string;
  locked?: boolean;
  visible?: boolean;
  depth?: number;
  customData?: Record<string, unknown>;
};

export type CanvasFileRecord = {
  id: string;
  dataURL?: string;
  storageUrl?: string;
  mimeType: string;
  created: number;
  name?: string;
};

export type CanvasAppState = {
  zoom: { value: number };
  scrollX: number;
  scrollY: number;
  viewBackgroundColor: string;
  selectedElementIds: Record<string, boolean>;
};

export type CanvasApi = {
  getDocument: () => CucumberCanvasDocument;
  setDocument: (doc: unknown) => void;
  createContainer: (opts?: {
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => PenNode;
  insertNode: (node: PenNode, containerId?: string | null) => void;
  updateNode: (nodeId: string, updates: Partial<PenNode>) => void;
  deleteNode: (nodeId: string) => void;
  bindAgentToContainer: (containerId: string, binding: AgentBinding) => void;
  setSelection: (nodeIds: string[]) => void;
  flushPendingSave: () => Promise<void>;
  exportImage: (opts?: {
    maxWidthOrHeight?: number;
    mimeType?: string;
  }) => Promise<Blob>;
  getSceneElements: () => CanvasSceneElement[];
  getFiles: () => Record<string, CanvasFileRecord>;
  getAppState: () => CanvasAppState;
  updateScene: (scene: { appState?: Partial<CanvasAppState> }) => void;
  addFiles: (files: CanvasFileRecord[]) => void;
  onChange: (listener: CanvasChangeListener) => () => void;
  scrollToContent: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  copySelection: () => boolean;
  pasteClipboard: () => string[];
  duplicateSelection: () => string[];
  deleteSelection: () => void;
  groupSelection: () => string | null;
  ungroupSelection: () => string[];
  alignSelection: (alignment: AlignMode) => void;
  reorderNode: (
    nodeId: string,
    direction: "forward" | "backward" | "front" | "back",
  ) => void;
  moveNodeToIndex: (
    nodeId: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => void;
  toggleNodeLocked: (nodeId: string) => void;
  toggleNodeVisible: (nodeId: string) => void;
  pasteFromSystemClipboard: () => Promise<string[]>;
  importSvgMarkup: (svgMarkup: string) => string[];
  insertImageArtifact: (artifact: {
    assetId?: string;
    jobId?: string;
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
    title?: string;
  }) => void;
  insertVideoArtifact: (artifact: {
    assetId?: string;
    jobId?: string;
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    title?: string;
  }) => void;
};

type CanvasSurfaceProps = {
  initialContent: unknown;
  onDocumentChange?: (doc: CucumberCanvasDocument) => void;
  onApiReady?: (api: CanvasApi) => void;
  onSelectionChange?: (elements: CanvasSceneElement[]) => void;
};

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
      preserveAspectRatio?: boolean;
    }
  | {
      kind: "rotate";
      nodeId: string;
      center: { x: number; y: number };
      originRotation: number;
      startAngle: number;
      startX: number;
      startY: number;
    }
  | {
      kind: "drawConnector";
      nodeId: string;
      startPoint: { x: number; y: number };
      connectorType: "line" | "arrow";
    }
  | {
      kind: "marquee";
      startPoint: { x: number; y: number };
      additive: boolean;
      originSelection: string[];
    };

const GRID_SIZE = 24;
const SNAP_THRESHOLD = 6;
const IMAGE_IMPORT_MAX_SIZE = 600;
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
type CanvasTool =
  | "select"
  | "hand"
  | "container"
  | "frame"
  | "rect"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "path"
  | "pen"
  | "icon"
  | "icon_font"
  | "text"
  | "line"
  | "arrow";

export const CanvasSurface = memo(
  forwardRef<CanvasApi, CanvasSurfaceProps>(function CanvasSurface(
    { initialContent, onDocumentChange, onApiReady, onSelectionChange },
    ref,
  ) {
    const [doc, setDoc] = useState(() =>
      normalizeCanvasDocument(initialContent),
    );
    const docRef = useRef(doc);
    const listenersRef = useRef(new Set<CanvasChangeListener>());
    const stageRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const clipboardRef = useRef<CanvasClipboardData | null>(null);
    const pendingHistoryBaseRef = useRef<CucumberCanvasDocument | null>(null);
    const [historyState, setHistoryState] = useState({
      canUndo: false,
      canRedo: false,
    });
    const historyRef = useRef<CanvasHistoryManager | null>(null);
    if (!historyRef.current) {
      historyRef.current = new CanvasHistoryManager({
        onChange: setHistoryState,
      });
    }
    const [marqueeBounds, setMarqueeBounds] = useState<CanvasBounds | null>(
      null,
    );
    const [snapGuides, setSnapGuides] = useState<{
      x?: number;
      y?: number;
    } | null>(null);
    const [activeTool, setActiveTool] = useState<CanvasTool>("select");
    const penTool = usePenTool({
      onCommit: (anchors, closed) => {
        const parentId = getPrimarySelectedContainerId(docRef.current, selection);
        const parentOrigin = parentId
          ? (() => { const p = findNode(docRef.current, parentId); const b = getNodeBounds(p!); return { x: b.x, y: b.y }; })()
          : { x: 0, y: 0 };
        const data = bakePenAnchorsToPathData(anchors, closed, parentOrigin);
        if (!data) return;
        const pathId = createNodeId("path");
        applyOperation({
          type: "insertNode",
          node: {
            id: pathId,
            type: "path" as const,
            name: "Path",
            x: data.x, y: data.y,
            width: data.width, height: data.height,
            d: data.d,
            closed: data.closed,
          } as any as PenNode,
          parentId,
        });
        selectNode(pathId);
      },
      onCancel: () => {},
    });
  const [paperReady, setPaperReady] = useState(false);
  // Lazy-load paper.js for boolean operations (browser only)
  useEffect(() => {
    let cancelled = false;
    import("paper")
      .then((mod) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setPaperModule((mod as any).default ?? mod);
        setPaperReady(true);
      })
      .catch(() => {
        // paper.js unavailable — boolean ops will stay disabled
      });
    return () => { cancelled = true; };
  }, []);
  const [selection, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
    const toast = useToast();

    docRef.current = doc;

    const selectedIds = selection ?? [];
    const selectedId = selectedIds[selectedIds.length - 1] ?? null;
    const selectedNode = selectedId ? findNode(doc, selectedId) : undefined;

    const commitDocument = useCallback(
      (
        next: CucumberCanvasDocument,
        options?: { captureHistory?: boolean; notify?: boolean },
      ) => {
        if (options?.captureHistory !== false) {
          historyRef.current?.push(docRef.current);
        }
        docRef.current = next;
        setDoc(next);
        if (options?.notify !== false) {
          onDocumentChange?.(next);
        }
        queueMicrotask(() => {
          const elements = toSceneElements(next);
          const state = toAppState(next, viewport, selection);
          const nextFiles = toFiles(next);
          for (const listener of listenersRef.current) {
            listener(elements, state, nextFiles);
          }
        });
      },
      [onDocumentChange],
    );

    const beginHistoryCapture = useCallback(() => {
      pendingHistoryBaseRef.current = structuredClone(docRef.current);
    }, []);

    const endHistoryCapture = useCallback(() => {
      const base = pendingHistoryBaseRef.current;
      pendingHistoryBaseRef.current = null;
      if (!base) return;
      if (JSON.stringify(base) === JSON.stringify(docRef.current)) return;
      historyRef.current?.push(base);
      onDocumentChange?.(docRef.current);
    }, [onDocumentChange]);

    const applyOperation = useCallback(
      (operation: Parameters<typeof applyCanvasOperation>[1]) => {
        const next = applyCanvasOperation(docRef.current, operation);
        commitDocument(next);
      },
      [commitDocument],
    );

    const setSelection = useCallback(
      (
        nodeIds: string[],
        options?: { captureHistory?: boolean; notifySelection?: boolean },
      ) => {
        const validIds = nodeIds.filter((id) =>
          Boolean(findNode(docRef.current, id)),
        );
        setSelectedIds(validIds);
        const next = {
          ...docRef.current,
                    updatedAt: new Date().toISOString(),
        };
        commitDocument(next, {
          captureHistory: options?.captureHistory ?? false,
          notify: false,
        });
        if (options?.notifySelection !== false) {
          onSelectionChange?.(
            validIds
              .map((id) => findNode(next, id))
              .filter(isCanvasNode)
              .map((node) => toSceneElement(node)),
          );
        }
      },
      [commitDocument, onSelectionChange],
    );

    const selectNode = useCallback(
      (nodeId: string | null, additive = false) => {
        if (!nodeId) {
          setSelectedIds([]);
          return;
        }
        setSelectedIds((prev: string[]) => {
          if (!additive) return [nodeId];
          return prev.includes(nodeId)
            ? prev.filter((id) => id !== nodeId)
            : [...prev, nodeId];
        });
      },
      [],
    );

    const createContainer = useCallback(
      (opts?: { name?: string; x?: number; y?: number; width?: number; height?: number }) => {
        const id = createNodeId("frame");
        const bounds = opts
          ? { x: opts.x ?? 120, y: opts.y ?? 120, width: opts.width ?? 360, height: opts.height ?? 240 }
          : defaultBounds(docRef.current, "frame");
        const container: PenNode = {
          id,
          type: "frame",
          name: opts?.name ?? "New container",
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          containerRole: ["visual", "task", "context"],
          children: [],
          contextSlots: {},
          inheritPolicy: "merge",
          permissions: {
            canRead: [],
            canWrite: [],
            isolationLevel: "open",
          },
          fill: [{ type: "solid" as const, color: "rgba(255,255,255,0.78)" }],
          stroke: { color: "#6c5ce7", thickness: 2, fill: [{ type: "solid" as const, color: "#6c5ce7" }] },
        } as any as PenNode;
        applyOperation({ type: "insertNode", node: container });
        selectNode(id);
        console.info("[canvas-runtime] container.created", { containerId: id });
        return container;
      },
      [applyOperation, selectNode],
    );

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
        const targetContainerId = getPrimarySelectedContainerId(docRef.current, selection);
        const bounds = defaultBounds(
          docRef.current,
          "image",
          targetContainerId,
        );
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
          x: bounds.x,
          y: bounds.y,
          width: artifact.width ?? bounds.width,
          height: artifact.height ?? bounds.height,
          src: artifact.url,
          meta: { source },
        } as any as PenNode;
        const next = applyCanvasOperation(
          {
            ...docRef.current,
            assets: { ...docRef.current.assets, [asset.id]: asset },
          },
          { type: "insertNode", node, parentId: targetContainerId },
        );
        commitDocument(next);
        selectNode(id);
      },
      [commitDocument, selectNode],
    );

    const triggerImageImport = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleImageImport = useCallback(
      async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          const imported = await readImageFile(file);
          const scaled = scaleToFitDimensions(
            imported.width,
            imported.height,
            IMAGE_IMPORT_MAX_SIZE,
          );
          insertImageNode(
            {
              assetId: createNodeId("asset"),
              url: imported.dataUrl,
              mimeType: file.type || "image/png",
              width: scaled.width,
              height: scaled.height,
              title: file.name,
            },
            "upload",
          );
          console.info("[canvas-runtime] image.imported", {
            name: file.name,
            mimeType: file.type,
          });
        } catch (error) {
          console.warn("[canvas-runtime] image.import.failed", {
            name: file.name,
            error,
          });
        }
      },
      [insertImageNode],
    );

    const beginConnectorDraw = useCallback(
      (
        connectorType: "line" | "arrow",
        point: { x: number; y: number },
        event: React.PointerEvent<HTMLDivElement>,
      ) => {
        const id = createNodeId("line");
        const parentId = getPrimarySelectedContainerId(docRef.current, selection);
        const node: PenNode = {
          id,
          type: "line",
          name: connectorType === "arrow" ? "Arrow" : "Line",
          x: point.x, y: point.y, width: 2, height: 2,
          stroke: { thickness: 3, fill: [{ type: "solid" as const, color: "#111827" }] },
        } as any as PenNode;
        applyOperation({ type: "insertNode", node, parentId: parentId });
        selectNode(id);
        dragRef.current = {
          kind: "drawConnector",
          nodeId: id,
          startPoint: point,
          connectorType,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [applyOperation, selectNode],
    );

    const undo = useCallback(() => {
      const previous = historyRef.current?.undo(docRef.current);
      if (!previous) return;
      commitDocument(previous, { captureHistory: false });
      onSelectionChange?.(
        selection
          .map((id) => findNode(previous, id))
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
    }, [commitDocument, onSelectionChange, selection]);

    const redo = useCallback(() => {
      const next = historyRef.current?.redo(docRef.current);
      if (!next) return;
      commitDocument(next, { captureHistory: false });
      onSelectionChange?.(
        selection
          .map((id) => findNode(next, id))
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
    }, [commitDocument, onSelectionChange, selection]);

    const deleteSelection = useCallback(() => {
      const ids = getTopLevelSelectionIds(docRef.current, selection);
      if (ids.length === 0) return;
      let next = docRef.current;
      for (const nodeId of ids) {
        next = applyCanvasOperation(next, { type: "deleteNode", nodeId });
      }
      setSelectedIds([]);
      commitDocument(next);
      onSelectionChange?.([]);
    }, [commitDocument, onSelectionChange]);

    const copySelection = useCallback(() => {
      if (selection.length === 0) return false;
      clipboardRef.current = copyCanvasSelection(docRef.current, selection);
          console.info("[canvas-runtime] selection.copied", {
        count: clipboardRef.current?.rootNodeIds?.length ?? clipboardRef.current?.nodes.length,
      });
      return true;
    }, []);

    const cutSelection = useCallback(() => {
      if (copySelection()) deleteSelection();
    }, [copySelection, deleteSelection]);

    const pasteClipboard = useCallback(() => {
      const clipboard = clipboardRef.current;
      if (!clipboard) return [];
      const parentId = getPrimarySelectedContainerId(docRef.current, selection);
      const result = pasteCanvasClipboard(docRef.current, clipboard, {
        parentId,
        offset: 18,
      });
      commitDocument(result.doc);
      onSelectionChange?.(
        result.pastedIds
          .map((id) => findNode(result.doc, id))
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
      console.info("[canvas-runtime] clipboard.pasted", {
        count: result.pastedIds.length,
        parentId,
      });
      return result.pastedIds;
    }, [commitDocument, onSelectionChange]);

    const importFromPayload = useCallback(
      (
        payload: ClipboardImportPayload,
        context?: ClipboardImportContext,
      ) => {
        const parsed = parseClipboardImport(payload);
        if (!parsed) return [];
        const importBounds = getCanvasImportBounds(parsed);
        const stageRect = stageRef.current?.getBoundingClientRect();
        const viewportCenter = {
          x:
            ((stageRect?.width ?? 0) / 2 - viewport.x) /
            viewport.zoom,
          y:
            ((stageRect?.height ?? 0) / 2 - viewport.y) /
            viewport.zoom,
        };
        const offsetX = importBounds
          ? viewportCenter.x - (importBounds.x + importBounds.width / 2)
          : 0;
        const offsetY = importBounds
          ? viewportCenter.y - (importBounds.y + importBounds.height / 2)
          : 0;
        const inserted = insertCanvasImportResult(docRef.current, parsed, {
          parentId: getPrimarySelectedContainerId(docRef.current, selection),
          offsetX,
          offsetY,
        });
        commitDocument(inserted.doc);
        onSelectionChange?.(
          inserted.insertedIds
            .map((id) => findNode(inserted.doc, id))
            .filter(isCanvasNode)
            .map((node) => toSceneElement(node)),
        );
        if (parsed.warnings.length > 0) {
          toast.toast(
            `${parsed.sourceLabel} 已导入 ${inserted.insertedIds.length} 个节点，包含 ${parsed.warnings.length} 条兼容性提醒。`,
          );
        } else {
          toast.success(
            `${parsed.sourceLabel} 已导入 ${inserted.insertedIds.length} 个节点。`,
          );
        }
        console.info("[canvas-runtime] clipboard.imported", {
          trigger: context?.trigger ?? "unknown",
          mimeTypes: context?.mimeTypes ?? [],
          source: parsed.source,
          importSessionId: parsed.importSessionId,
          insertedCount: inserted.insertedIds.length,
          warningCount: parsed.warnings.length,
          degradationCodes: Array.from(
            new Set(parsed.warnings.map((warning) => warning.code)),
          ),
        });
        return inserted.insertedIds;
      },
      [commitDocument, onSelectionChange, toast],
    );

    const pasteFromSystemClipboard = useCallback(async () => {
      const { payload, context } = await readClipboardImportPayload();
      if (!payload.html && !payload.text) return [];
      try {
        return importFromPayload(payload, context);
      } catch (error) {
        console.warn("[canvas-runtime] clipboard.import.failed", {
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
          console.warn("[canvas-runtime] svg.import.failed", {
            error,
          });
          toast.error(error instanceof Error ? error.message : "SVG 导入失败。");
          return [];
        }
      },
      [importFromPayload, toast],
    );

    const duplicateSelection = useCallback(() => {
      if (selection.length === 0) return [];
      const result = duplicateCanvasNodes(docRef.current, selection, 18);
      commitDocument(result.doc);
      onSelectionChange?.(
        result.pastedIds
          .map((id) => findNode(result.doc, id))
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
      console.info("[canvas-runtime] selection.duplicated", {
        count: result.pastedIds.length,
      });
      return result.pastedIds;
    }, [commitDocument, onSelectionChange]);

    const groupSelection = useCallback(() => {
      const topSelection = getTopLevelSelectionIds(docRef.current, selection);
      if (topSelection.length < 2) return null;
      const groupId = createNodeId("group");
      const next = applyCanvasOperation(docRef.current, {
        type: "groupNodes",
        groupId,
        nodeIds: topSelection,
      });
      commitDocument(next);
      const groupNode = findNode(next, groupId);
      if (groupNode) onSelectionChange?.([toSceneElement(groupNode)]);
      console.info("[canvas-runtime] selection.grouped", {
        groupId,
        count: selection.length,
      });
      return groupId;
    }, [commitDocument, onSelectionChange]);

    const ungroupSelection = useCallback(() => {
      const groupIds = (selection ?? []).filter(
        (nodeId) => findNode(docRef.current, nodeId)?.type === "group",
      );
      if (groupIds.length === 0) return [];
      let next = docRef.current;
      for (const groupId of groupIds) {
        next = applyCanvasOperation(next, { type: "ungroupNode", groupId });
      }
      commitDocument(next);
      const ungroupedSelection = (selection ?? []).filter(
        (nodeId) => !groupIds.includes(nodeId),
      );
      setSelectedIds(ungroupedSelection);
      onSelectionChange?.(
        ungroupedSelection
          .map((id) => findNode(next, id))
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
      console.info("[canvas-runtime] selection.ungrouped", {
        count: groupIds.length,
      });
      return ungroupedSelection;
    }, [commitDocument, onSelectionChange, selection]);

    const alignSelection = useCallback(
      (alignment: AlignMode) => {
        const topSelection = getTopLevelSelectionIds(docRef.current, selection);
        if (topSelection.length < 2) return;
        applyOperation({
          type: "alignNodes",
          nodeIds: topSelection,
          alignment,
        });
        console.info("[canvas-runtime] selection.aligned", {
          alignment,
          count: selection.length,
        });
      },
      [applyOperation],
    );

    const reorderNode = useCallback(
      (
        nodeId: string,
        direction: "forward" | "backward" | "front" | "back",
      ) => {
        applyOperation({ type: "reorderNode", nodeId, direction });
      },
      [applyOperation],
    );

    const moveNodeToIndex = useCallback(
      (nodeId: string, targetParentId: string | null, targetIndex: number) => {
        applyOperation({
          type: "reorderNode",
          nodeId,
          targetParentId,
          targetIndex,
        });
      },
      [applyOperation],
    );

    const toggleNodeLocked = useCallback(
      (nodeId: string) => {
        const node = findNode(docRef.current, nodeId);
        if (!node) return;
        applyOperation({
          type: "updateNode",
          nodeId,
          updates: { locked: !node.locked } as Partial<PenNode>,
        });
      },
      [applyOperation],
    );

    const toggleNodeVisible = useCallback(
      (nodeId: string) => {
        const node = findNode(docRef.current, nodeId);
        if (!node) return;
        applyOperation({
          type: "updateNode",
          nodeId,
          updates: { visible: node.visible === false } as Partial<PenNode>,
        });
      },
      [applyOperation],
    );

    const api = useMemo<CanvasApi>(
      () => ({
        getDocument: () => docRef.current,
        setDocument: (next) => {
          historyRef.current?.clear();
          commitDocument(normalizeCanvasDocument(next), {
            captureHistory: false,
          });
        },
        createContainer,
        insertNode: (node, containerId) =>
          applyOperation({ type: "insertNode", node, containerId }),
        updateNode: (nodeId, updates) =>
          applyOperation({ type: "updateNode", nodeId, updates }),
        deleteNode: (nodeId) => applyOperation({ type: "deleteNode", nodeId }),
        bindAgentToContainer: (containerId, binding) =>
          applyOperation({ type: "bindAgent", containerId, binding }),
        setSelection,
        flushPendingSave: async () => undefined,
        exportImage: (opts) => exportDocumentImage(docRef.current, opts, { backgroundColor: (viewport as any).backgroundColor }),
        getSceneElements: () => toSceneElements(docRef.current),
        getFiles: () => toFiles(docRef.current),
        getAppState: () => toAppState(docRef.current, viewport, selection),
        updateScene: (scene) => {
          const state = scene.appState;
          if (!state) return;
          if (state.selectedElementIds) {
            setSelectedIds(
              Object.entries(state.selectedElementIds)
                .filter(([, selected]) => selected)
                .map(([id]) => id),
            );
          }
          setViewport({
            x: state.scrollX ?? viewport.x,
            y: state.scrollY ?? viewport.y,
            zoom: state.zoom?.value ?? viewport.zoom,
          });
        },
        addFiles: (incoming) => {
          const assets = { ...(docRef.current.assets ?? {}) };
          for (const file of incoming) {
            assets[file.id] = {
              id: file.id,
              url: file.storageUrl ?? file.dataURL ?? "",
              mimeType: file.mimeType,
              name: file.name,
              source: "upload",
            };
          }
          commitDocument({ ...docRef.current, assets });
        },
        onChange: (listener) => {
          listenersRef.current.add(listener);
          return () => listenersRef.current.delete(listener);
        },
        scrollToContent: () => {
          setViewport({ x: 0, y: 0, zoom: 1 });
        },
        undo,
        redo,
        canUndo: () => historyRef.current?.canUndo ?? false,
        canRedo: () => historyRef.current?.canRedo ?? false,
        copySelection,
        pasteClipboard,
        duplicateSelection,
        deleteSelection,
        groupSelection,
        ungroupSelection,
        alignSelection,
        reorderNode,
        moveNodeToIndex,
        toggleNodeLocked,
        toggleNodeVisible,
        pasteFromSystemClipboard,
        importSvgMarkup,
        insertImageArtifact: (artifact) =>
          insertImageNode(artifact, "generated"),
        insertVideoArtifact: (artifact) => {
          const id = createNodeId("video");
          const assetId =
            artifact.assetId ?? artifact.jobId ?? createNodeId("asset");
          const targetContainerId = getPrimarySelectedContainerId(docRef.current, selection);
          const videoBounds = defaultBounds(
            docRef.current,
            "videoEmbed",
            targetContainerId,
          );
          const node: PenNode = {
            id,
            type: "videoEmbed",
            name: artifact.title ?? "Generated video",
            x: videoBounds.x, y: videoBounds.y, width: videoBounds.width, height: videoBounds.height,
            src: artifact.url,
            mimeType: artifact.mimeType,
            durationSeconds: artifact.durationSeconds,
          } as any as PenNode;
          applyOperation({
            type: "insertNode",
            node,
            parentId: targetContainerId,
          });
          selectNode(id);
        },
      }),
      [
        applyOperation,
        commitDocument,
        copySelection,
        createContainer,
        deleteSelection,
        duplicateSelection,
        groupSelection,
        insertImageNode,
        pasteClipboard,
        redo,
        reorderNode,
        moveNodeToIndex,
        selectNode,
        setSelection,
        toggleNodeLocked,
        toggleNodeVisible,
        ungroupSelection,
        undo,
        alignSelection,
        pasteFromSystemClipboard,
        importSvgMarkup,
      ],
    );

    useImperativeHandle(ref, () => api, [api]);

    useEffect(() => {
      onApiReady?.(api);
    }, [api, onApiReady]);

    useCanvasKeyboardShortcuts({
      undo,
      redo,
      selectAll: () =>
        setSelection(
          getOrderedCanvasNodes(docRef.current)
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
      groupSelection,
      ungroupSelection,
      nudgeSelection: (dx, dy) => {
        const currentSelection = selection ?? [];
        if (currentSelection.length === 0) return;
        let next = docRef.current;
        for (const nodeId of currentSelection) {
          const node = findNode(next, nodeId);
          if (!node || node.locked) continue;
          const bounds = getNodeBounds(node);
          next = applyCanvasOperation(next, {
            type: "updateNode",
            nodeId,
            updates: {
              x: bounds.x + dx,
              y: bounds.y + dy,
            } as Partial<PenNode>,
          });
        }
        commitDocument(next);
      },
      reorderSelection: (direction) => {
        const topSelection = getTopLevelSelectionIds(docRef.current, selection);
        for (const nodeId of topSelection) {
          reorderNode(nodeId, direction);
        }
      },
      setActiveTool: (tool) => {
        setActiveTool(tool as CanvasTool);
      },
    });

    // Pen tool keyboard shortcuts (Enter/Escape/Backspace)
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable
        ) {
          return;
        }
        if (penTool.isActive) {
          if (penTool.onKeyDown(event.key)) {
            event.preventDefault();
          }
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [penTool]);

    useCanvasClipboardImport({
      onImportPayload: (payload, context) => {
        try {
          return importFromPayload(payload, context).length > 0;
        } catch (error) {
          console.warn("[canvas-runtime] clipboard.import.failed", {
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

    useEffect(() => {
      historyRef.current?.clear();
      commitDocument(normalizeCanvasDocument(initialContent), {
        captureHistory: false,
      });
      // The server replaces initialContent only when the canvas changes.
    }, [commitDocument, initialContent]);

    const applyAutoLayoutAwareNodeUpdate = useCallback(
      (
        baseDoc: CucumberCanvasDocument,
        nodeId: string,
        updates: Partial<PenNode>,
      ) => {
        const existing = findNode(baseDoc, nodeId);
        if (!existing) {
          return baseDoc;
        }
        let next = applyCanvasOperation(baseDoc, {
          type: "updateNode",
          nodeId,
          updates,
        });
        // Reflow imported auto-layout containers when a child moves
        if (
          ("x" in updates || "y" in updates) &&
          "children" in existing &&
          Array.isArray((existing as any).children) &&
          getCanvasImportedNodeMeta((existing as any).meta)?.autoLayout
        ) {
          next = applyImportedAutoLayout(next, nodeId);
        }
        // Reflow native auto-layout containers when layout props change
        const autoLayoutKeys = ["layout", "gap", "padding", "justifyContent", "alignItems"];
        if (autoLayoutKeys.some((k) => k in updates)) {
          const updated = findNode(next, nodeId);
          if (updated && isContainerNode(updated) && "children" in updated) {
            const children = (updated as any).children as string[];
            if (Array.isArray(children) && children.length > 0) {
              const childNodes = children
                .map((cid: string) => findNode(next, cid))
                .filter(Boolean) as PenNode[];
              const reflowed = computeLayoutPositions(updated, childNodes);
              for (const ch of reflowed) {
                next = applyCanvasOperation(next, {
                  type: "updateNode",
                  nodeId: ch.id,
                  updates: { x: ch.x, y: ch.y } as Partial<PenNode>,
                });
              }
            }
          }
        }
        return next;
      },
      [],
    );

    const updateNode = useCallback(
      (nodeId: string, updates: Partial<PenNode>) => {
        const next = applyAutoLayoutAwareNodeUpdate(
          docRef.current,
          nodeId,
          updates,
        );
        if (next === docRef.current) {
          return;
        }
        commitDocument(next);
      },
      [applyAutoLayoutAwareNodeUpdate, commitDocument],
    );

    const deleteSelected = useCallback(() => {
      deleteSelection();
    }, [deleteSelection]);

    const insertRect = useCallback(() => {
      const id = createNodeId("rectangle");
      const parentId = getPrimarySelectedContainerId(docRef.current, selection);
      const bounds = defaultBounds(docRef.current, "rectangle", parentId);
      const node: PenNode = {
        id,
        type: "rectangle" as const,
        name: "Rectangle",
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        fill: "#d3f256",
        stroke: { thickness: 1, fill: [] },
        cornerRadius: 12,
      } as any as PenNode;
      applyOperation({ type: "insertNode", node, parentId });
      selectNode(id);
    }, [applyOperation, selectNode]);

    const insertPrimitiveNode = useCallback(
      (
        type: "ellipse" | "polygon" | "path" | "icon_font",
        point?: { x: number; y: number },
      ) => {
        const id = createNodeId(type);
        const parentId = getPrimarySelectedContainerId(docRef.current, selection);
        const baseBounds = point
          ? { x: point.x, y: point.y, width: 160, height: 120 }
          : defaultBounds(docRef.current, type, parentId);
        const shared = {
          id,
          x: baseBounds.x, y: baseBounds.y, width: baseBounds.width, height: baseBounds.height,
          fill: "#f8fafc",
          stroke: { thickness: 2, fill: [] },
        };
        const node: PenNode =
          type === "ellipse"
            ? ({ ...shared, type, name: "Ellipse" } as any as PenNode)
            : type === "polygon"
              ? ({ ...shared, type, name: "Polygon" } as any as PenNode)
              : type === "path"
                ? ({
                    ...shared,
                    type,
                    name: "Path",
                    d: "M20 90 C55 15, 105 15, 140 90",
                    fill: "none",
                  } as any as PenNode)
                : ({
                    ...shared,
                    type,
                    name: "Icon",
                    iconFontName: "sparkles",
                    fill: "none",
                  } as any as PenNode);
        applyOperation({ type: "insertNode", node, parentId });
        selectNode(id);
      },
      [applyOperation, selectNode],
    );

    const insertText = useCallback(() => {
      const id = createNodeId("text");
      const parentId = getPrimarySelectedContainerId(docRef.current, selection);
      const textBounds = defaultBounds(docRef.current, "text", parentId);
      const node: PenNode = {
        id,
        type: "text",
        name: "Text",
        x: textBounds.x, y: textBounds.y, width: textBounds.width, height: textBounds.height,
        content: "Double click to edit",
        fontSize: 28,
      } as any as PenNode;
      applyOperation({ type: "insertNode", node, parentId: parentId });
      selectNode(id);
    }, [applyOperation, selectNode]);

    const handleStagePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-canvas-node-id]")) return;
        const point = screenToCanvasPoint(
          event,
          docRef.current,
          stageRef.current,
          viewport,
        );
        if (activeTool === "container" || activeTool === "frame") {
          createContainer({
            x: point.x, y: point.y, width: 360, height: 240,
          });
          setActiveTool("select");
          return;
        }
        if (activeTool === "rect" || activeTool === "rectangle") {
          const rectId = createNodeId("rectangle");
          applyOperation({ type: "insertNode", node: {
            id: rectId,
            type: "rectangle" as const,
            name: "Rectangle",
            x: point.x, y: point.y, width: 180, height: 120,
          } as any as PenNode });
          selectNode(rectId);
          setActiveTool("select");
          return;
        }
        if (activeTool === "pen") {
          penTool.onMouseDown(point, viewport.zoom);
          return;
        }
        if (
          activeTool === "ellipse" ||
          activeTool === "polygon" ||
          activeTool === "path" ||
          activeTool === "icon" ||
          activeTool === "icon_font"
        ) {
          const primitiveType = activeTool === "icon" ? "icon_font" : activeTool;
          insertPrimitiveNode(primitiveType as "ellipse" | "polygon" | "path" | "icon_font", point);
          setActiveTool("select");
          return;
        }
        if (activeTool === "text") {
          const id = createNodeId("text");
          const parentId = getPrimarySelectedContainerId(docRef.current, selection);
          const node: PenNode = {
            id,
            type: "text" as const,
            name: "Text",
            x: point.x, y: point.y, width: 260, height: 80,
            content: "Double click to edit",
            fontSize: 28,
          } as any as PenNode;
          applyOperation({ type: "insertNode", node, parentId });
          selectNode(id);
          setActiveTool("select");
          return;
        }
        if (activeTool === "line" || activeTool === "arrow") {
          beginConnectorDraw(activeTool, point, event);
          return;
        }
        if (activeTool === "hand") {
          dragRef.current = {
            kind: "pan",
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
          };
        } else {
          if (!event.shiftKey) setSelection([]);
          dragRef.current = {
            kind: "marquee",
            startPoint: point,
            additive: event.shiftKey,
            originSelection: selection ?? [],
          };
          setMarqueeBounds({ x: point.x, y: point.y, width: 0, height: 0 });
        }
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [
        activeTool,
        applyOperation,
        beginConnectorDraw,
        createContainer,
        insertPrimitiveNode,
        selectNode,
        setSelection,
      ],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (activeTool === "pen") {
          const point = screenToCanvasPoint(event, docRef.current, stageRef.current, viewport);
          penTool.onMouseMove(point);
          return;
        }
        const drag = dragRef.current;
        if (!drag) return;
        if (drag.kind === "pan") {
          setViewport({
            x: drag.originX + event.clientX - drag.startX,
            y: drag.originY + event.clientY - drag.startY,
            zoom: viewport.zoom,
          });
          return;
        }
        if (drag.kind === "marquee") {
          const point = screenToCanvasPoint(
            event,
            docRef.current,
            stageRef.current,
          );
          const bounds = normalizeBounds({
            x: drag.startPoint.x,
            y: drag.startPoint.y,
            width: point.x - drag.startPoint.x,
            height: point.y - drag.startPoint.y,
          });
          setMarqueeBounds(bounds);
          const hitIds = getVisibleCanvasNodesInBounds(
            docRef.current,
            bounds,
          ).map((node) => node.id);
          setSelection(
            drag.additive
              ? Array.from(new Set([...drag.originSelection, ...hitIds]))
              : hitIds,
            { notifySelection: true },
          );
          return;
        }
        if (drag.kind === "drawConnector") {
          const point = screenToCanvasPoint(
            event,
            docRef.current,
            stageRef.current,
          );
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: createConnectorGeometry(
              drag.startPoint,
              point,
              drag.connectorType,
            ) as Partial<PenNode>,
          });
          commitDocument(next, { captureHistory: false, notify: false });
          return;
        }
        const dx = (event.clientX - drag.startX) / viewport.zoom;
        const dy = (event.clientY - drag.startY) / viewport.zoom;
        if (drag.kind === "move") {
          let next = docRef.current;
          let activeGuide: { x?: number; y?: number } | null = null;
          for (const nodeId of drag.nodeIds) {
            const origin = drag.origins[nodeId];
            const node = findNode(next, nodeId);
            if (!origin || !node) continue;
            const snapped = snapBoundsToGrid({
              ...getNodeBounds(node),
              x: origin.x + dx,
              y: origin.y + dy,
            });
            activeGuide = activeGuide ?? snapped.guides;
            next = applyAutoLayoutAwareNodeUpdate(next, nodeId, {
              x: snapped.bounds.x,
              y: snapped.bounds.y,
            } as Partial<PenNode>);
          }
          setSnapGuides(activeGuide);
          commitDocument(next, { captureHistory: false, notify: false });
          return;
        }
        if (drag.kind === "rotate") {
          const point = screenToCanvasPoint(
            event,
            docRef.current,
            stageRef.current,
          );
          const rotation =
            drag.originRotation +
            pointToAngle(drag.center, point) -
            drag.startAngle;
          const node = findNode(docRef.current, drag.nodeId);
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: {
              bounds: { ...getNodeBounds(node), rotation: Math.round(rotation) },
            } as Partial<PenNode>,
          });
          commitDocument(next, { captureHistory: false, notify: false });
          return;
        }
        const node = findNode(docRef.current, drag.nodeId);
        if (!node) return;
        const resizedBounds = calculateResizeBounds(
          drag.origin,
          drag.handle,
          dx,
          dy,
          drag.preserveAspectRatio ?? false,
        );
        const { bounds: nextBounds, guides } = snapBoundsToGrid(resizedBounds);
        setSnapGuides(guides);
          const next = applyAutoLayoutAwareNodeUpdate(docRef.current, drag.nodeId, {
            bounds: nextBounds,
          } as Partial<PenNode>);
        commitDocument(next, { captureHistory: false, notify: false });
      },
      [applyAutoLayoutAwareNodeUpdate, commitDocument, setSelection],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (activeTool === "pen") {
          penTool.onMouseUp();
          return;
        }
        const drag = dragRef.current;
        if (dragRef.current?.kind === "drawConnector") {
          const node = findNode(docRef.current, dragRef.current.nodeId);
          if (node && getNodeBounds(node).width <= 6 && getNodeBounds(node).height <= 6) {
            applyOperation({ type: "deleteNode", nodeId: node.id });
            selectNode(null);
          }
        }
        if (
          drag?.kind === "move" ||
          drag?.kind === "resize" ||
          drag?.kind === "rotate"
        ) {
          endHistoryCapture();
        }
        if (drag?.kind === "marquee") {
          setMarqueeBounds(null);
        }
        setSnapGuides(null);
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [applyOperation, endHistoryCapture, selectNode],
    );

    const handleWheel = useCallback(
      (event: React.WheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const nextZoom = Math.min(
          3,
          Math.max(0.25, viewport.zoom - event.deltaY * 0.001),
        );
        setViewport({ ...viewport, zoom: nextZoom });
      },
      [commitDocument, viewport],
    );

    return (
      <div
        ref={stageRef}
        className={`relative h-full w-full overflow-hidden text-foreground ${
          activeTool === "hand"
            ? "cursor-grab"
            : (activeTool === "line" ||
                activeTool === "arrow" ||
                activeTool === "ellipse" ||
                activeTool === "polygon" ||
                activeTool === "path" ||
                activeTool === "icon" ||
                activeTool === "icon_font")
              ? "cursor-crosshair"
              : "cursor-default"
        }`}
        style={{ backgroundColor: "#f0f0f0" }}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148,163,184,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.16) 1px, transparent 1px)",
            backgroundSize: `${GRID_SIZE * viewport.zoom}px ${GRID_SIZE * viewport.zoom}px`,
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          }}
        />
        <CanvasChrome
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onCreateContainer={() => createContainer()}
          onImportImage={triggerImageImport}
          onInsertRect={insertRect}
          onInsertPrimitive={insertPrimitiveNode}
          onInsertText={insertText}
          onDelete={deleteSelected}
          selectedCount={selectedIds.length}
          canUngroup={selectedIds.some(
            (nodeId) => findNode(doc, nodeId)?.type === "group",
          )}
          canBooleanOp={paperReady && selectedIds.length === 2 && selectedIds.every((id) => {
            const n = findNode(doc, id);
            return n && ["path", "rectangle", "ellipse", "polygon"].includes(n.type);
          })}
          hasSelectedLocked={selectedIds.some((id) => {
            const n = findNode(doc, id);
            return n?.locked === true;
          })}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={undo}
          onRedo={redo}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          onBooleanOp={(op) => {
            const [id1, id2] = selectedIds;
            if (!id1 || !id2 || !paperReady) return;
            const node1 = findNode(docRef.current, id1);
            const node2 = findNode(docRef.current, id2);
            if (!node1 || !node2) return;
            const result = executeBooleanOp([node1, node2], op);
            if (!result) {
              toast.error("布尔运算失败，请确保两个形状可以参与运算。");
              return;
            }
            const parent1 = findParent(docRef.current, id1);
            // Delete originals + insert result
            let next = docRef.current;
            next = applyCanvasOperation(next, { type: "deleteNode", nodeId: id1 });
            next = applyCanvasOperation(next, { type: "deleteNode", nodeId: id2 });
            const resultId = createNodeId("path");
            next = applyCanvasOperation(next, {
              type: "insertNode",
              node: {
                id: resultId,
                type: "path" as const,
                name: op === "union" ? "Union" : op === "subtract" ? "Subtract" : "Intersect",
                x: result.x, y: result.y,
                width: result.width, height: result.height,
                d: result.d,
                closed: result.closed ?? true,
                fill: result.fill,
                stroke: result.stroke,
                rotation: result.rotation,
              } as PenNode,
              parentId: parent1?.id ?? null,
            });
            commitDocument(next);
            setSelectedIds([resultId]);
          }}
          onToggleLock={() => {
            for (const id of selectedIds) {
              const node = findNode(docRef.current, id);
              if (!node) continue;
              const next = applyCanvasOperation(docRef.current, {
                type: "updateNode",
                nodeId: id,
                updates: { locked: !node.locked } as Partial<PenNode>,
              });
              commitDocument(next, { captureHistory: false, notify: false });
            }
            commitDocument(docRef.current);
          }}
        />
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {getOrderedCanvasNodes(doc)
            .map((entry) => entry.node)
            .filter((node) => node.visible !== false)
            .map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                activeTool={activeTool}
                selectedIds={selectedIds}
                onSelect={selectNode}
                onDragStart={(nodeId, event) => {
                  const targetNode = findNode(docRef.current, nodeId);
                  if (!targetNode || targetNode.locked) return;
                  if (activeTool === "hand") {
                    dragRef.current = {
                      kind: "pan",
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: viewport.x,
                      originY: viewport.y,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    return;
                  }
                  beginHistoryCapture();
                  const dragNodeIds = (selection ?? []).includes(
                    nodeId,
                  )
                    ? (selection ?? [])
                    : [nodeId];
                  dragRef.current = {
                    kind: "move",
                    nodeIds: dragNodeIds,
                    startX: event.clientX,
                    startY: event.clientY,
                    origins: Object.fromEntries(
                      dragNodeIds
                        .map((id) => findNode(docRef.current, id))
                        .filter(isCanvasNode)
                        .map((node) => [node.id, getNodeBounds(node)]),
                    ),
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onResizeStart={(nodeId, handle, event) => {
                  const targetNode = findNode(docRef.current, nodeId);
                  if (!targetNode || targetNode.locked) return;
                  beginHistoryCapture();
                  dragRef.current = {
                    kind: "resize",
                    nodeId,
                    handle,
                    startX: event.clientX,
                    startY: event.clientY,
                    origin: getNodeBounds(targetNode),
                    preserveAspectRatio:
                      targetNode.type === "image" ||
                      targetNode.type === "videoEmbed" ||
                      targetNode.type === "icon_font",
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onRotateStart={(nodeId, event) => {
                  const targetNode = findNode(docRef.current, nodeId);
                  if (!targetNode || targetNode.locked) return;
                  beginHistoryCapture();
                  const center = {
                    x: getNodeBounds(targetNode).x + getNodeBounds(targetNode).width / 2,
                    y: getNodeBounds(targetNode).y + getNodeBounds(targetNode).height / 2,
                  };
                  const point = screenToCanvasPoint(
                    event,
                    docRef.current,
                    stageRef.current,
                  );
                  dragRef.current = {
                    kind: "rotate",
                    nodeId,
                    center,
                    originRotation: getNodeBounds(targetNode).rotation ?? 0,
                    startAngle: pointToAngle(center, point),
                    startX: event.clientX,
                    startY: event.clientY,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onUpdate={updateNode}
              />
            ))}
          {penTool.preview && penTool.preview.points.length > 0 ? (
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              style={{ width: 1, height: 1 }}
            >
              {/* Rubber-band path lines */}
              <path
                d={
                  penTool.preview.points.length > 1
                    ? (() => {
                        const parts: string[] = [`M ${penTool.preview.points[0]!.x} ${penTool.preview.points[0]!.y}`];
                        for (let i = 1; i < penTool.preview.points.length; i++) {
                          const prev = penTool.preview.points[i - 1]!;
                          const curr = penTool.preview.points[i]!;
                          if (!prev.handleOut && !curr.handleIn) {
                            parts.push(`L ${curr.x} ${curr.y}`);
                          } else {
                            parts.push(`C ${prev.x + (prev.handleOut?.x ?? 0)} ${prev.y + (prev.handleOut?.y ?? 0)} ${curr.x + (curr.handleIn?.x ?? 0)} ${curr.y + (curr.handleIn?.y ?? 0)} ${curr.x} ${curr.y}`);
                          }
                        }
                        // Line from last anchor to cursor
                        if (penTool.preview.cursorPos) {
                          const last = penTool.preview.points[penTool.preview.points.length - 1]!;
                          parts.push(`L ${penTool.preview.cursorPos.x} ${penTool.preview.cursorPos.y}`);
                        }
                        return parts.join(" ");
                      })()
                    : penTool.preview.cursorPos
                      ? `M ${penTool.preview.points[0]!.x} ${penTool.preview.points[0]!.y} L ${penTool.preview.cursorPos.x} ${penTool.preview.cursorPos.y}`
                      : ""
                }
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
              {/* Handle lines and anchor dots */}
              {penTool.preview.points.map((pt, i) => (
                <g key={i}>
                  {/* Handle-out line */}
                  {pt.handleOut && (
                    <line
                      x1={pt.x} y1={pt.y}
                      x2={pt.x + pt.handleOut.x} y2={pt.y + pt.handleOut.y}
                      stroke="#a5b4fc" strokeWidth={1}
                    />
                  )}
                  {/* Handle-in line */}
                  {pt.handleIn && (
                    <line
                      x1={pt.x} y1={pt.y}
                      x2={pt.x + pt.handleIn.x} y2={pt.y + pt.handleIn.y}
                      stroke="#a5b4fc" strokeWidth={1}
                    />
                  )}
                  {/* Handle-out dot */}
                  {pt.handleOut && (
                    <circle
                      cx={pt.x + pt.handleOut.x} cy={pt.y + pt.handleOut.y}
                      r={3} fill="#818cf8" stroke="#4f46e5" strokeWidth={1}
                    />
                  )}
                  {/* Handle-in dot */}
                  {pt.handleIn && (
                    <circle
                      cx={pt.x + pt.handleIn.x} cy={pt.y + pt.handleIn.y}
                      r={3} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1}
                    />
                  )}
                  {/* Anchor dot */}
                  <circle
                    cx={pt.x} cy={pt.y}
                    r={i === 0 ? 5 : 4}
                    fill={i === 0 ? "#4f46e5" : "#6366f1"}
                    stroke="#fff" strokeWidth={1.5}
                  />
                </g>
              ))}
              {/* Close-path highlight near start point */}
              {penTool.preview.points.length >= 3 && penTool.preview.cursorPos && (() => {
                const first = penTool.preview.points[0]!;
                const dist = Math.hypot(penTool.preview.cursorPos.x - first.x, penTool.preview.cursorPos.y - first.y);
                return dist < 12
                  ? <circle cx={first.x} cy={first.y} r={6} fill="none" stroke="#6366f1" strokeWidth={2} opacity={0.6} />
                  : null;
              })()}
            </svg>
          ) : null}
        </div>
        {marqueeBounds ? (
          <div
            className="pointer-events-none absolute border border-primary/70 bg-primary/10"
            style={{
              left: marqueeBounds.x * viewport.zoom + viewport.x,
              top: marqueeBounds.y * viewport.zoom + viewport.y,
              width: marqueeBounds.width * viewport.zoom,
              height: marqueeBounds.height * viewport.zoom,
            }}
          />
        ) : null}
        {snapGuides?.x !== undefined ? (
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary/60"
            style={{
              left: snapGuides.x * viewport.zoom + viewport.x,
            }}
          />
        ) : null}
        {snapGuides?.y !== undefined ? (
          <div
            className="pointer-events-none absolute left-0 right-0 h-px bg-primary/60"
            style={{
              top: snapGuides.y * viewport.zoom + viewport.y,
            }}
          />
        ) : null}
        {selectedIds.length > 1 ? (
          <SelectionActionBar
            selectedCount={selectedIds.length}
            onAlign={alignSelection}
            onGroup={groupSelection}
          />
        ) : null}
        {selectedIds.length === 1 && selectedNode ? (
          <CanvasPropertyPanel
            node={selectedNode}
            context={
              selectedNode.type === "frame"
                ? resolveContext(doc, selectedNode.id)
                : undefined
            }
            onUpdate={(updates) =>
              updateNode(selectedNode.id, updates as Partial<PenNode>)
            }
            onApplyImportedAutoLayout={() => {
              const next = applyImportedAutoLayout(docRef.current, selectedNode.id);
              if (next === docRef.current) {
                return;
              }
              console.info("[canvas-runtime] imported-auto-layout.applied", {
                nodeId: selectedNode.id,
                source: getCanvasImportedNodeMeta((selectedNode as any).meta)?.source,
              });
              commitDocument(next);
            }}
            onBindAgent={(binding) =>
              selectedNode.type === "frame"
                ? api.bindAgentToContainer(selectedNode.id, binding)
                : undefined
            }
          />
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageImport}
        />
      </div>
    );
  }),
);

function CanvasChrome({
  activeTool,
  onToolChange,
  onCreateContainer,
  onImportImage,
  onInsertRect,
  onInsertPrimitive,
  onInsertText,
  onDelete,
  selectedCount,
  canUngroup,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onGroup,
  onUngroup,
  canBooleanOp,
  hasSelectedLocked,
  onBooleanOp,
  onToggleLock,
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onCreateContainer: () => void;
  onImportImage: () => void;
  onInsertRect: () => void;
  onInsertPrimitive: (type: "ellipse" | "polygon" | "path" | "icon_font") => void;
  onInsertText: () => void;
  onDelete: () => void;
  selectedCount: number;
  canUngroup: boolean;
  canBooleanOp: boolean;
  hasSelectedLocked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onBooleanOp: (op: "union" | "subtract" | "intersect") => void;
  onToggleLock: () => void;
}) {
  const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div
      className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 px-1.5 py-1.5 shadow-card backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "select" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("select")}
        title="选择"
      >
        <MousePointer2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "hand" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("hand")}
        title="抓手"
      >
        <Hand className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={buttonClass}
        disabled={!canUndo}
        onClick={onUndo}
        title="撤销"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!canRedo}
        onClick={onRedo}
        title="重做"
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "container" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("container")}
        title="容器工具"
      >
        <Frame className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={onCreateContainer}
        title="新建容器"
      >
        <Plus className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={buttonClass}
        onClick={onImportImage}
        title="导入图片"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={onInsertRect}
        title="矩形"
      >
        <Box className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "ellipse" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("ellipse")}
        onDoubleClick={() => onInsertPrimitive("ellipse")}
        title="椭圆"
      >
        <Circle className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "polygon" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("polygon")}
        onDoubleClick={() => onInsertPrimitive("polygon")}
        title="多边形"
      >
        <Triangle className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "pen" ? "bg-primary/20 text-primary" : ""}`}
        onClick={() => onToolChange("pen")}
        title="钢笔工具 (P) — 点击添加锚点，闭合路径或双击完成"
      >
        <PenTool className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "path" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("path")}
        onDoubleClick={() => onInsertPrimitive("path")}
        title="快速路径"
      >
        <Sparkles className="h-4 w-3" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "icon" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("icon")}
        onDoubleClick={() => onInsertPrimitive("icon_font")}
        title="图标"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={onInsertText}
        title="文字"
      >
        <Type className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "line" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("line")}
        title="直线工具"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "line" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("arrow")}
        title="箭头工具"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={selectedCount < 2}
        onClick={onGroup}
        title="组合"
      >
        <Group className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!canUngroup}
        onClick={onUngroup}
        title="取消组合"
      >
        <Ungroup className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={selectedCount === 0}
        onClick={onDelete}
        title="删除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={`${buttonClass} text-[10px] font-bold`}
        disabled={!canBooleanOp}
        onClick={() => onBooleanOp("union")}
        title="布尔运算 - 并集"
      >
        ∪
      </button>
      <button
        type="button"
        className={`${buttonClass} text-[11px] font-bold`}
        disabled={!canBooleanOp}
        onClick={() => onBooleanOp("subtract")}
        title="布尔运算 - 减去顶层"
      >
        −
      </button>
      <button
        type="button"
        className={`${buttonClass} text-[10px] font-bold`}
        disabled={!canBooleanOp}
        onClick={() => onBooleanOp("intersect")}
        title="布尔运算 - 交集"
      >
        ∩
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={buttonClass}
        disabled={selectedCount === 0}
        onClick={onToggleLock}
        title={hasSelectedLocked ? "解锁" : "锁定"}
      >
        {hasSelectedLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CanvasNodeView({
  node,
  activeTool,
  selectedIds,
  onSelect,
  onDragStart,
  onResizeStart,
  onRotateStart,
  onUpdate,
}: {
  node: PenNode;
  activeTool: CanvasTool;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onDragStart: (
    nodeId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onResizeStart: (
    nodeId: string,
    handle: ResizeHandle,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onRotateStart: (
    nodeId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onUpdate: (nodeId: string, updates: Partial<PenNode>) => void;
}) {
  const selected = selectedIds.includes(node.id);
  const style = {
    left: getNodeBounds(node).x,
    top: getNodeBounds(node).y,
    width: getNodeBounds(node).width,
    height: getNodeBounds(node).height,
    transform: `rotate(${getNodeBounds(node).rotation ?? 0}deg)`,
    transformOrigin: "center",
  };

  return (
    <div
      data-canvas-node-id={node.id}
      className={`absolute select-none ${selected ? "z-10" : ""}`}
      style={style}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (activeTool === "hand") return;
        onSelect(node.id, event.shiftKey);
      }}
    >
      <div
        className="h-full w-full"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[data-resize-handle]"))
            return;
          onDragStart(node.id, event);
        }}
      >
        {renderNodeContent(node, selected, onUpdate)}
      </div>
      {selected && !node.locked ? (
        <>
          {/* Auto layout padding indicator for containers */}
          {(() => {
            const n = node as any;
            if ((n.type === "frame" || n.type === "group") && (n.layout === "vertical" || n.layout === "horizontal")) {
              const pad = typeof n.padding === "number" ? n.padding : Array.isArray(n.padding) ? n.padding[0] ?? 0 : 0;
              if (pad > 0) {
                const w = getNodeBounds(node).width;
                const h = getNodeBounds(node).height;
                return (
                  <div
                    className="pointer-events-none absolute border border-dashed border-primary/40"
                    style={{
                      left: pad,
                      top: pad,
                      width: w - pad * 2,
                      height: h - pad * 2,
                    }}
                  />
                );
              }
            }
            return null;
          })()}
          {RESIZE_HANDLES.map((handle) => (
            <div
              key={handle}
              data-resize-handle
              className={`absolute h-3 w-3 rounded-full border border-primary bg-background ${resizeHandleClass(handle)}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onResizeStart(node.id, handle, event);
              }}
            />
          ))}
          <div
            data-rotate-handle
            className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-8 cursor-grab rounded-full border border-primary bg-background text-primary shadow-subtle"
            onPointerDown={(event) => {
              event.stopPropagation();
              onRotateStart(node.id, event);
            }}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </div>
        </>
      ) : null}
    </div>
  );
}

const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

function resizeHandleClass(handle: ResizeHandle): string {
  const position: Record<ResizeHandle, string> = {
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    e: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize",
    se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
    s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
    sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  };
  return position[handle];
}

function renderNodeContent(
  node: PenNode,
  selected: boolean,
  onUpdate: (nodeId: string, updates: Partial<PenNode>) => void,
) {
  const importedAutoLayout = getCanvasImportedNodeMeta((node as any).meta)?.autoLayout;
  const ring = selected
    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
    : "";
  switch (node.type) {
    case "frame":
      return (
        <div
          className={`relative h-full w-full rounded-lg border-2 bg-card/70 shadow-subtle backdrop-blur ${ring}`}
          style={{
            borderColor: (node as any).stroke?.color ?? "#6c5ce7",
            backgroundColor: (node as any).fill?.[0]?.color ?? "rgba(255,255,255,.78)",
            opacity: (node as any).opacity ?? 1,
            overflow: importedAutoLayout?.clipContent ? "hidden" : undefined,
          }}
        >
          <div className="flex h-8 items-center justify-between rounded-t-md border-b border-border/70 bg-background/60 px-3">
            <span className="truncate text-xs font-medium text-foreground">
              {node.name ?? "Container"}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {(node as any).agentBinding?.status ? (
                <Sparkles className="h-3 w-3" />
              ) : null}
              {(node as any).agentBinding?.name ??
                (node as any).agentBinding?.agentId ??
                "unassigned"}
            </span>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="relative h-full w-full">
          <img
            alt={(node as any).alt ?? node.name ?? "Canvas image"}
            className="h-full w-full rounded-lg object-cover shadow-subtle"
            src={node.src}
            draggable={false}
          />
          {selected ? <SelectionOutline /> : null}
        </div>
      );
    case "videoEmbed":
      return (
        <div className="relative h-full w-full">
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-black text-white shadow-subtle">
            <video
              className="h-full w-full object-cover"
              src={node.src}
              controls={false}
              muted
            />
            <span className="absolute rounded-full bg-black/60 px-3 py-1 text-xs">
              Video
            </span>
          </div>
          {selected ? <SelectionOutline /> : null}
        </div>
      );
    case "text":
      return (
        <textarea
          className={`h-full w-full resize-none rounded-md border border-transparent bg-transparent p-2 leading-tight outline-none ${ring}`}
          style={{
            fontSize: node.fontSize,
            fontFamily: node.fontFamily ?? "Inter, system-ui, sans-serif",
            color: (node as any).color ?? "#111827",
            textAlign: (node as any).textAlign ?? "left",
          }}
          value={typeof node.content === "string" ? node.content : ""}
          onChange={(event) =>
            onUpdate(node.id, {
              content: event.currentTarget.value,
            } as Partial<PenNode>)
          }
        />
      );
    case "rectangle":
      return (
        <div
          className={`h-full w-full shadow-subtle ${ring}`}
          style={{
            borderRadius: (node as any).cornerRadius ?? 8,
            backgroundColor: ((node as any).fill?.[0]?.color) ?? "#d3f256",
            border: `${(node as any).stroke?.thickness ?? 1}px solid ${((node as any).stroke?.fill?.[0]?.color) ?? "#111827"}`,
          }}
        />
      );
    case "ellipse":
      return (
        <div
          className={`h-full w-full rounded-full shadow-subtle ${ring}`}
          style={{
            backgroundColor: ((node as any).fill?.[0]?.color) ?? "#f8fafc",
            border: `${(node as any).stroke?.thickness ?? 2}px solid ${((node as any).stroke?.fill?.[0]?.color) ?? "#111827"}`,
          }}
        />
      );
    case "polygon":
      return renderPolygon(node as any, selected);
    case "path":
      return renderPath(node as any, selected);
    case "icon_font":
      return renderIconNode(node as any, selected);
    case "line":
      return renderConnector(node, selected);
    case "group":
      return (
        <div
          className={`h-full w-full rounded-lg border border-dashed border-border ${ring}`}
        />
      );
    default:
      return null;
  }
}

function CanvasPropertyPanel({
  node,
  context,
  onUpdate,
  onApplyImportedAutoLayout,
  onBindAgent,
}: {
  node: PenNode;
  context?: ContextSlots;
  onUpdate: (updates: Partial<PenNode>) => void;
  onApplyImportedAutoLayout?: () => void;
  onBindAgent: (binding: AgentBinding) => void;
}) {
  const [agentName, setAgentName] = useState(
    node.type === "frame" ? (node.agentBinding?.name ?? "") : "",
  );
  const importedMeta = getCanvasImportedNodeMeta((node as any).meta);
  const importedAutoLayout = importedMeta?.autoLayout;
  const importedAutoLayoutEntries = importedAutoLayout
    ? formatImportedAutoLayoutEntries(importedAutoLayout)
    : [];
  const canApplyImportedAutoLayout =
    Boolean(onApplyImportedAutoLayout) &&
    Boolean(importedAutoLayout) &&
    "children" in node &&
    Array.isArray((node as any).children) &&
    (node as any).children.length > 0;
  const titleInputId = `${node.id}-title`;
  const rulesInputId = `${node.id}-rules`;
  const agentInputId = `${node.id}-agent`;
  const updateBounds = (updates: Partial<CanvasBounds>) => {
    const currentBounds = getNodeBounds(node);
    onUpdate({
      x: updates.x ?? currentBounds.x,
      y: updates.y ?? currentBounds.y,
      width: updates.width ?? currentBounds.width,
      height: updates.height ?? currentBounds.height,
      rotation: updates.rotation ?? currentBounds.rotation,
    } as Partial<PenNode>);
  };
  const supportsPaint = isPaintNode(node);

  return (
    <div
      className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-card backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">属性</span>
        {node.locked ? (
          <Lock className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Unlock className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <label
        className="mb-2 block text-xs text-muted-foreground"
        htmlFor={titleInputId}
      >
        名称
      </label>
      <input
        id={titleInputId}
        className="mb-3 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={node.name ?? ""}
        onChange={(event) => onUpdate({ name: event.currentTarget.value } as Partial<PenNode>)}
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={getNodeBounds(node).x}
          onChange={(x) => updateBounds({ x })}
        />
        <NumberField
          label="Y"
          value={getNodeBounds(node).y}
          onChange={(y) => updateBounds({ y })}
        />
        <NumberField
          label="W"
          min={1}
          value={getNodeBounds(node).width}
          onChange={(width) => updateBounds({ width })}
        />
        <NumberField
          label="H"
          min={1}
          value={getNodeBounds(node).height}
          onChange={(height) => updateBounds({ height })}
        />
        <NumberField
          label="R"
          value={getNodeBounds(node).rotation ?? 0}
          onChange={(rotation) => updateBounds({ rotation })}
        />
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={node.visible !== false}
            onChange={(event) =>
              onUpdate({
                visible: event.currentTarget.checked,
              } as Partial<PenNode>)
            }
          />
          显示
        </label>
      </div>

      <label className="mb-3 flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={node.locked === true}
          onChange={(event) =>
            onUpdate({
              locked: event.currentTarget.checked,
            } as Partial<PenNode>)
          }
        />
        锁定
      </label>

      {supportsPaint ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <TextField
            label="Fill"
            value={getPaintValue(node, "fill")}
            onChange={(fill) => onUpdate({ fill } as Partial<PenNode>)}
          />
          <TextField
            label="Stroke"
            value={getPaintValue(node, "stroke")}
            onChange={(stroke) => onUpdate({ stroke } as Partial<PenNode>)}
          />
          <NumberField
            label="SW"
            min={0}
            value={Number(getPaintValue(node, "strokeWidth") || 0)}
            onChange={(strokeWidth) =>
              onUpdate({ strokeWidth } as Partial<PenNode>)
            }
          />
          {node.type === "rectangle" ? (
            <NumberField
              label="Rad"
              min={0}
              value={(node as any).cornerRadius ?? 0}
              onChange={(cornerRadius) => onUpdate({ cornerRadius } as any as Partial<PenNode>)}
            />
          ) : null}
        </div>
      ) : null}

      {node.type === "text" ? (
        <div className="mb-3 grid gap-2">
          <textarea
            className="h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={typeof node.content === "string" ? node.content : ""}
            onChange={(event) =>
              onUpdate({
                content: event.currentTarget.value,
              } as Partial<PenNode>)
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Size"
              min={1}
              value={node.fontSize ?? 16}
              onChange={(fontSize) =>
                onUpdate({ fontSize } as Partial<PenNode>)
              }
            />
            <TextField
              label="Color"
              value={(node as any).color ?? "#111827"}
              onChange={(color) => onUpdate({ color } as Partial<PenNode>)}
            />
          </div>
        </div>
      ) : null}

      {node.type === "polygon" ? (
        <NumberField
          label="Points"
          min={3}
          value={(node as any).points}
          onChange={(points) => onUpdate({ points } as Partial<PenNode>)}
        />
      ) : null}

      {node.type === "frame" ? (
        <>
          <label
            className="mb-2 mt-3 block text-xs text-muted-foreground"
            htmlFor={rulesInputId}
          >
            上下文规则
          </label>
          <textarea
            id={rulesInputId}
            className="mb-3 h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={((node.contextSlots?.rules) ?? []).join("\n")}
            onChange={(event) =>
              onUpdate({
                contextSlots: {
                  ...(node.contextSlots ?? { rules: [], style: {}, tokens: {}, constraints: {} }),
                  rules: event.currentTarget.value.split("\n").filter(Boolean),
                },
              } as Partial<PenNode>)
            }
            placeholder="例如：只使用品牌紫；保持极简排版"
          />
          <label
            className="mb-2 block text-xs text-muted-foreground"
            htmlFor={agentInputId}
          >
            Agent 名称
          </label>
          <div className="flex gap-2">
            <input
              id={agentInputId}
              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={agentName}
              onChange={(event) => setAgentName(event.currentTarget.value)}
              placeholder="Designer Agent"
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
              onClick={() =>
                onBindAgent({
                  agentId: `agent_${node.id}`,
                  name: agentName || "Designer Agent",
                  status: "idle",
                  permissions: ["read", "write", "spawn"],
                })
              }
            >
              绑定
            </button>
          </div>
        </>
      ) : null}

      {importedAutoLayout ? (
        <div className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">导入布局</p>
              <p className="text-[11px] text-muted-foreground">
                {importedMeta?.importSourceLabel ?? "导入内容"} 的 auto-layout metadata
              </p>
            </div>
            {canApplyImportedAutoLayout ? (
              <button
                type="button"
                className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                onClick={() => onApplyImportedAutoLayout?.()}
              >
                应用布局
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {importedAutoLayoutEntries.map(([label, value]) => (
              <div
                key={label}
                className="rounded-md border border-border/60 bg-card px-2 py-1.5"
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-0.5 text-xs text-foreground">{value}</div>
              </div>
            ))}
          </div>
          {canApplyImportedAutoLayout ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              容器几何变化后会按这些导入布局提示重新排布当前子节点。
            </p>
          ) : null}
        </div>
      ) : null}

      {context ? (
        <p className="mt-3 line-clamp-2 text-[11px] text-muted-foreground">
          Effective context: {JSON.stringify(context)}
        </p>
      ) : null}
    </div>
  );
}

function SelectionActionBar({
  selectedCount,
  onAlign,
  onGroup,
}: {
  selectedCount: number;
  onAlign: (alignment: AlignMode) => void;
  onGroup: () => void;
}) {
  const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div
      className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-2 shadow-card backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="px-2 text-xs text-muted-foreground">
        {selectedCount}
      </span>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("left")}
        title="左对齐"
      >
        <AlignHorizontalJustifyStart className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("center")}
        title="水平居中"
      >
        <AlignHorizontalJustifyCenter className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("right")}
        title="右对齐"
      >
        <AlignHorizontalJustifyEnd className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("top")}
        title="顶对齐"
      >
        <AlignVerticalJustifyStart className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("middle")}
        title="垂直居中"
      >
        <AlignVerticalJustifyCenter className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => onAlign("bottom")}
        title="底对齐"
      >
        <AlignVerticalJustifyEnd className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={onGroup}
        title="组合"
      >
        <Group className="h-4 w-4" />
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
      <span className="w-8 shrink-0">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-sm text-foreground outline-none"
        type="number"
        min={min}
        value={Math.round(value * 100) / 100}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
      <span className="w-10 shrink-0">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-sm text-foreground outline-none"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function formatImportedAutoLayoutEntries(
  autoLayout: CanvasImportedAutoLayoutMeta,
): Array<[string, string]> {
  const entries: Array<[string, string | number | boolean | undefined]> = [
    ["方向", autoLayout.layout],
    ["间距", autoLayout.gap],
    ["内边距", formatImportedPadding(autoLayout.padding)],
    ["主轴对齐", autoLayout.justifyContent],
    ["交叉对齐", autoLayout.alignItems],
    ["宽度模式", autoLayout.widthMode],
    ["高度模式", autoLayout.heightMode],
    ["自身对齐", autoLayout.alignSelf],
    ["定位", autoLayout.positioning],
    ["Grow", autoLayout.grow],
    ["裁切", autoLayout.clipContent === undefined ? undefined : autoLayout.clipContent ? "开启" : "关闭"],
  ];
  return entries.filter((entry): entry is [string, string] => entry[1] !== undefined).map(
    ([label, value]) => [label, String(value)],
  );
}

function formatImportedPadding(
  padding: CanvasImportedAutoLayoutMeta["padding"],
): string | undefined {
  if (padding === undefined) {
    return undefined;
  }
  if (typeof padding === "number") {
    return `${padding}`;
  }
  return padding.join(" / ");
}

function isPaintNode(node: PenNode): boolean {
  return [
    "rectangle",
    "ellipse",
    "polygon",
    "path",
    "icon_font",
    "line",
  ].includes(node.type);
}

function getPaintValue(
  node: PenNode,
  key: "fill" | "stroke" | "strokeWidth",
): string {
  if (!isPaintNode(node)) return "";
  const n = node as any;
  if (key === "fill") {
    const fill = n.fill as any[];
    return fill?.[0]?.color ?? "";
  }
  if (key === "stroke") {
    return n.stroke?.fill?.[0]?.color ?? "";
  }
  if (key === "strokeWidth") {
    return String(n.stroke?.thickness ?? "");
  }
  return "";
}

function isCanvasNode(node: PenNode | undefined): node is PenNode {
  return Boolean(node);
}

function toSceneElements(doc: CucumberCanvasDocument): CanvasSceneElement[] {
  return getOrderedCanvasNodes(doc).map(({ node, depth }) =>
    toSceneElement(node, depth, doc),
  );
}

function toSceneElement(node: PenNode, depth = 0, doc?: CucumberCanvasDocument): CanvasSceneElement {
  const importMeta = getCanvasImportedNodeMeta((node as any).meta);
  const parentNode = doc ? findParent(doc, node.id) : undefined;
  return {
    id: node.id,
    type: node.type === "videoEmbed" ? "embeddable" : node.type,
    x: getNodeBounds(node).x,
    y: getNodeBounds(node).y,
    width: getNodeBounds(node).width,
    height: getNodeBounds(node).height,
    isDeleted: false,
    fileId: node.type === "image" ? (node as any).assetId : undefined,
    text: node.type === "text" ? (typeof node.content === "string" ? node.content : "") : undefined,
    locked: node.locked === true,
    visible: node.visible !== false,
    depth,
    customData: {
      title: node.name,
      source: importMeta?.source,
      containerId: parentNode?.id,
      storageUrl: node.type === "image" ? node.src : undefined,
      importSessionId: importMeta?.importSessionId,
      importSourceLabel: importMeta?.importSourceLabel,
      importWarningCount: importMeta?.warningCount,
      degradationHints: importMeta?.degradationHints,
      autoLayout: importMeta?.autoLayout,
      isCucumberCanvasNode: true,
      nodeType: node.type,
    },
  };
}

function toFiles(
  doc: CucumberCanvasDocument,
): Record<string, CanvasFileRecord> {
  const result: Record<string, CanvasFileRecord> = {};
  if (doc.assets) {
    for (const asset of Object.values(doc.assets)) {
      result[asset.id] = {
        id: asset.id,
        dataURL: asset.url.startsWith("data:") ? asset.url : undefined,
        storageUrl: asset.url.startsWith("data:") ? undefined : asset.url,
        mimeType: asset.mimeType,
        created: Date.now(),
        name: asset.name,
      };
    }
  }
  return result;
}

function toAppState(
  doc: CucumberCanvasDocument,
  viewport: { x: number; y: number; zoom: number },
  selection: string[],
): CanvasAppState {
  return {
    zoom: { value: viewport.zoom },
    scrollX: viewport.x,
    scrollY: viewport.y,
    viewBackgroundColor: (viewport as any).backgroundColor ?? "#f0f0f0",
    selectedElementIds: Object.fromEntries(
      (selection ?? []).map((id) => [id, true]),
    ),
  };
}

function defaultBounds(
  doc: CucumberCanvasDocument,
  type: PenNode["type"],
  parentId?: string | null,
): CanvasBounds {
  const parent = parentId ? findNode(doc, parentId) : undefined;
  const nodeCount = flattenNodes(doc).length;
  const baseX = parent
    ? getNodeBounds(parent).x + 32
    : 120 + nodeCount * 28;
  const baseY = parent
    ? getNodeBounds(parent).y + 48
    : 120 + nodeCount * 22;
  if (type === "frame")
    return { x: baseX, y: baseY, width: 360, height: 240 };
  if (type === "text") return { x: baseX, y: baseY, width: 260, height: 80 };
  if (type === "image") return { x: baseX, y: baseY, width: 320, height: 220 };
  if (type === "line")
    return { x: baseX, y: baseY, width: 220, height: 120 };
  if (type === "videoEmbed")
    return { x: baseX, y: baseY, width: 360, height: 220 };
  return { x: baseX, y: baseY, width: 180, height: 120 };
}

function screenToCanvasPoint(
  event: React.PointerEvent,
  doc: CucumberCanvasDocument,
  stage: HTMLDivElement | null,
  currentViewport?: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  const rect = stage?.getBoundingClientRect();
  const vp = currentViewport ?? { x: 0, y: 0, zoom: 1 };
  return {
    x: (event.clientX - (rect?.left ?? 0) - vp.x) / vp.zoom,
    y: (event.clientY - (rect?.top ?? 0) - vp.y) / vp.zoom,
  };
}

function SelectionOutline() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-primary/80 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]" />
  );
}

function renderPolygon(
  node: PenNode,
  selected: boolean,
) {
  const width = Math.max(getNodeBounds(node).width, 1);
  const height = Math.max(getNodeBounds(node).height, 1);
  const n = node as any;
  const points = createPolygonPoints(n.polygonCount ?? n.points ?? 3, width, height);
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{node.name ?? "Polygon"}</title>
        <polygon
          points={points}
          fill={n.fill?.[0]?.color ?? "#f8fafc"}
          stroke={n.stroke?.fill?.[0]?.color ?? "#111827"}
          strokeWidth={n.stroke?.thickness ?? 2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function renderPath(
  node: PenNode,
  selected: boolean,
) {
  const width = Math.max(getNodeBounds(node).width, 1);
  const height = Math.max(getNodeBounds(node).height, 1);
  const n = node as any;
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{node.name ?? "Path"}</title>
        <path
          d={n.d}
          fill={n.fill?.[0]?.color ?? "none"}
          stroke={n.stroke?.fill?.[0]?.color ?? "#111827"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={n.stroke?.thickness ?? 3}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function renderIconNode(
  node: PenNode,
  selected: boolean,
) {
  const n = node as any;
  const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <svg className="h-full w-full" viewBox="0 0 24 24">
        <title>{node.name ?? "Icon"}</title>
        {n.iconFontName === "star" ? (
          <path
            d="m12 2 2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 17.1l-5.8 3.1 1.1-6.6-4.8-4.7 6.6-.9L12 2Z"
            fill={n.fill?.[0]?.color ?? "none"}
            stroke={strokeColor}
            strokeLinejoin="round"
            strokeWidth={n.stroke?.thickness ?? 1.8}
          />
        ) : (
          <>
            <path
              d="M12 3 10.3 8.3 5 10l5.3 1.7L12 17l1.7-5.3L19 10l-5.3-1.7L12 3Z"
              fill={n.fill?.[0]?.color ?? "none"}
              stroke={strokeColor}
              strokeLinejoin="round"
              strokeWidth={n.stroke?.thickness ?? 1.8}
            />
            <path
              d="M18 15.5 17.2 18 15 18.8l2.2.8.8 2.4.8-2.4 2.2-.8-2.2-.8-.8-2.5Z"
              fill={n.fill?.[0]?.color ?? "none"}
              stroke={strokeColor}
              strokeLinejoin="round"
              strokeWidth={n.stroke?.thickness ?? 1.5}
            />
          </>
        )}
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function createPolygonPoints(points: number, width: number, height: number) {
  const count = Math.max(3, Math.round(points));
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width / 2 - 2;
  const radiusY = height / 2 - 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return `${centerX + Math.cos(angle) * radiusX},${centerY + Math.sin(angle) * radiusY}`;
  }).join(" ");
}

type ConnectorAnchor = "tl" | "tr" | "bl" | "br";

function renderConnector(node: PenNode, selected: boolean) {
  const safeWidth = Math.max(getNodeBounds(node).width, 2);
  const safeHeight = Math.max(getNodeBounds(node).height, 2);
  const n = node as any;
  const startAnchor = n.startAnchor ?? "tl";
  const endAnchor = n.endAnchor ?? "br";
  const start = anchorToPoint(startAnchor, safeWidth, safeHeight);
  const end = anchorToPoint(endAnchor, safeWidth, safeHeight);
  const markerId = `connector-arrow-${node.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";

  return (
    <div className="relative h-full w-full overflow-visible">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      >
        <title>
          {n._connectorType === "arrow" ? "Arrow connector" : "Line connector"}
        </title>
        {n._connectorType === "arrow" ? (
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill={strokeColor} />
            </marker>
          </defs>
        ) : null}
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={strokeColor}
          strokeWidth={n.stroke?.thickness ?? 3}
          strokeLinecap="round"
          markerEnd={n._connectorType === "arrow" ? `url(#${markerId})` : undefined}
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function anchorToPoint(
  anchor: string,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (anchor) {
    case "tr":
      return { x: width, y: 0 };
    case "bl":
      return { x: 0, y: height };
    case "br":
      return { x: width, y: height };
    default:
      return { x: 0, y: 0 };
  }
}

function createConnectorGeometry(
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
  _connectorType: "line" | "arrow",
): Partial<PenNode> {
  const minX = Math.min(startPoint.x, endPoint.x);
  const minY = Math.min(startPoint.y, endPoint.y);
  const width = Math.max(Math.abs(endPoint.x - startPoint.x), 2);
  const height = Math.max(Math.abs(endPoint.y - startPoint.y), 2);

  return {
    x: minX, y: minY, width, height,
    startAnchor: resolveConnectorAnchor(
      startPoint.x - minX,
      startPoint.y - minY,
      width,
      height,
    ) as any,
    endAnchor: resolveConnectorAnchor(
      endPoint.x - minX,
      endPoint.y - minY,
      width,
      height,
    ) as any,
    _connectorType,
  } as any as Partial<PenNode>;
}

function resolveConnectorAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const horizontal = x <= width / 2 ? "l" : "r";
  const vertical = y <= height / 2 ? "t" : "b";
  return `${vertical}${horizontal}`;
}

function calculateResizeBounds(
  origin: CanvasBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  preserveAspectRatio: boolean,
): CanvasBounds {
  const minWidth = 48;
  const minHeight = 48;
  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;

  if (handle.includes("e")) width = origin.width + dx;
  if (handle.includes("s")) height = origin.height + dy;
  if (handle.includes("w")) {
    width = origin.width - dx;
    x = origin.x + dx;
  }
  if (handle.includes("n")) {
    height = origin.height - dy;
    y = origin.y + dy;
  }

  if (width < minWidth) {
    if (handle.includes("w")) x -= minWidth - width;
    width = minWidth;
  }
  if (height < minHeight) {
    if (handle.includes("n")) y -= minHeight - height;
    height = minHeight;
  }

  if (!preserveAspectRatio) return { ...origin, x, y, width, height };

  const widthRatio = width / Math.max(origin.width, 1);
  const heightRatio = height / Math.max(origin.height, 1);
  const scale = Math.max(
    Math.max(widthRatio, heightRatio),
    minWidth / Math.max(origin.width, 1),
    minHeight / Math.max(origin.height, 1),
  );

  return {
    ...origin,
    x: handle.includes("w")
      ? origin.x + origin.width - Math.round(origin.width * scale)
      : origin.x,
    y: handle.includes("n")
      ? origin.y + origin.height - Math.round(origin.height * scale)
      : origin.y,
    width: Math.max(minWidth, Math.round(origin.width * scale)),
    height: Math.max(minHeight, Math.round(origin.height * scale)),
  };
}

function snapBoundsToGrid(bounds: CanvasBounds): {
  bounds: CanvasBounds;
  guides: { x?: number; y?: number } | null;
} {
  let next = bounds;
  const guides: { x?: number; y?: number } = {};
  const snapX = snapValue(bounds.x, GRID_SIZE);
  const snapY = snapValue(bounds.y, GRID_SIZE);
  const snapRight = snapValue(bounds.x + bounds.width, GRID_SIZE);
  const snapBottom = snapValue(bounds.y + bounds.height, GRID_SIZE);

  if (Math.abs(snapX - bounds.x) <= SNAP_THRESHOLD) {
    next = { ...next, x: snapX };
    guides.x = snapX;
  } else if (
    Math.abs(snapRight - (bounds.x + bounds.width)) <= SNAP_THRESHOLD
  ) {
    next = { ...next, width: snapRight - bounds.x };
    guides.x = snapRight;
  }

  if (Math.abs(snapY - bounds.y) <= SNAP_THRESHOLD) {
    next = { ...next, y: snapY };
    guides.y = snapY;
  } else if (
    Math.abs(snapBottom - (bounds.y + bounds.height)) <= SNAP_THRESHOLD
  ) {
    next = { ...next, height: snapBottom - bounds.y };
    guides.y = snapBottom;
  }

  return {
    bounds: next,
    guides: guides.x === undefined && guides.y === undefined ? null : guides,
  };
}

function snapValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function pointToAngle(
  center: { x: number; y: number },
  point: { x: number; y: number },
): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function scaleToFitDimensions(width: number, height: number, maxSize: number) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const scale = maxSize / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function readImageFile(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

  const dimensions = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("解析图片尺寸失败"));
      image.src = dataUrl;
    },
  );

  return { dataUrl, ...dimensions };
}

async function exportDocumentImage(
  doc: CucumberCanvasDocument,
  opts?: { maxWidthOrHeight?: number; mimeType?: string },
  canvasViewport?: { backgroundColor?: string },
): Promise<Blob> {
  const bounds = calculateDocumentBounds(doc);
  const max = opts?.maxWidthOrHeight ?? 1024;
  const scale = Math.min(1, max / Math.max(bounds.width, bounds.height, 1));
  const svg = renderDocumentSvg(doc, bounds, scale, canvasViewport);
  return new Blob([svg], { type: opts?.mimeType ?? "image/svg+xml" });
}

function calculateDocumentBounds(doc: CucumberCanvasDocument): CanvasBounds {
  const nodes = flattenNodes(doc);
  if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  const minX = Math.min(...nodes.map((node) => getNodeBounds(node).x));
  const minY = Math.min(...nodes.map((node) => getNodeBounds(node).y));
  const maxX = Math.max(
    ...nodes.map((node) => getNodeBounds(node).x + getNodeBounds(node).width),
  );
  const maxY = Math.max(
    ...nodes.map((node) => getNodeBounds(node).y + getNodeBounds(node).height),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function renderDocumentSvg(
  doc: CucumberCanvasDocument,
  bounds: CanvasBounds,
  scale: number,
  canvasViewport?: { backgroundColor?: string },
): string {
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const nodes = flattenNodes(doc)
    .map((node) => {
      const x = (getNodeBounds(node).x - bounds.x) * scale;
      const y = (getNodeBounds(node).y - bounds.y) * scale;
      const w = getNodeBounds(node).width * scale;
      const h = getNodeBounds(node).height * scale;
      const n = node as any;
      const transform = getNodeBounds(node).rotation
        ? ` transform="rotate(${getNodeBounds(node).rotation} ${x + w / 2} ${y + h / 2})"`
        : "";
      if (node.type === "text") {
        const fontSize = (n.fontSize ?? 16) * scale;
        const textContent = typeof n.content === "string" ? n.content : "";
        return `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${escapeAttr(n.color ?? "#111827")}"${transform}>${escapeText(textContent)}</text>`;
      }
      if (node.type === "image") {
        return `<image href="${escapeAttr(node.src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${transform} />`;
      }
      if (node.type === "line") {
        const startAnchor = n.startAnchor ?? "tl";
        const endAnchor = n.endAnchor ?? "br";
        const start = anchorToPoint(startAnchor, w, h);
        const end = anchorToPoint(endAnchor, w, h);
        const markerId = `svg-marker-${escapeAttr(node.id)}`;
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";
        const defs = n._connectorType === "arrow"
          ? `<defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${escapeAttr(strokeColor)}" /></marker></defs>`
          : "";
        return `${defs}<line x1="${x + start.x}" y1="${y + start.y}" x2="${x + end.x}" y2="${y + end.y}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 3}" stroke-linecap="round"${n._connectorType === "arrow" ? ` marker-end="url(#${markerId})"` : ""}${transform} />`;
      }
      if (node.type === "ellipse") {
        const fillColor = n.fill?.[0]?.color ?? "#f8fafc";
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${escapeAttr(fillColor)}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 2}"${transform} />`;
      }
      if (node.type === "polygon") {
        const fillColor = n.fill?.[0]?.color ?? "#f8fafc";
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";
        const polyCount = n.polygonCount ?? n.points ?? 3;
        return `<polygon points="${createPolygonPoints(polyCount, w, h)
          .split(" ")
          .map((point) => {
            const [px, py] = point.split(",").map(Number);
            return `${x + (px ?? 0)},${y + (py ?? 0)}`;
          })
          .join(
            " ",
          )}" fill="${escapeAttr(fillColor)}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 2}"${transform} />`;
      }
      if (node.type === "path") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${getNodeBounds(node).width} ${getNodeBounds(node).height}" overflow="visible"${transform}><path d="${escapeAttr(n.d)}" fill="${escapeAttr(n.fill?.[0]?.color ?? "none")}" stroke="${escapeAttr(n.stroke?.fill?.[0]?.color ?? "#111827")}" stroke-width="${n.stroke?.thickness ?? 3}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
      }
      if (node.type === "icon_font") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 24 24"${transform}><path d="M12 3 10.3 8.3 5 10l5.3 1.7L12 17l1.7-5.3L19 10l-5.3-1.7L12 3Z" fill="${escapeAttr(n.fill?.[0]?.color ?? "none")}" stroke="${escapeAttr(n.stroke?.fill?.[0]?.color ?? "#111827")}" stroke-width="${n.stroke?.thickness ?? 1.8}" stroke-linejoin="round" /></svg>`;
      }
      const fill =
        node.type === "frame"
          ? (n.fill?.[0]?.color ?? "rgba(255,255,255,.78)")
          : node.type === "rectangle"
            ? (n.fill?.[0]?.color ?? "#d3f256")
            : "#111827";
      const stroke =
        node.type === "frame"
          ? (n.stroke?.color ?? "#6c5ce7")
          : node.type === "rectangle"
            ? (n.stroke?.fill?.[0]?.color ?? "#111827")
            : "none";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="2"${transform} />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeAttr(canvasViewport?.backgroundColor ?? '#f0f0f0')}"/>${nodes}</svg>`;
}

function escapeText(value: string): string {
  return value.replace(
    /[&<>]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch,
  );
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
