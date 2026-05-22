"use client";

import {
  type AgentBinding,
  applyImportedAutoLayout,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasClipboardData,
  type CanvasImportedAutoLayoutMeta,
  type ClipboardImportPayload,
  CanvasHistoryManager,
  getCanvasImportedNodeMeta,
  type CanvasNode,
  type ConnectorAnchor,
  type ConnectorNode,
  type ContainerNode,
  type ContextSlots,
  type CucumberCanvasDocument,
  applyCanvasOperation,
  copyCanvasSelection,
  createCanvasNodeId,
  duplicateCanvasNodes,
  getCanvasImportBounds,
  getOrderedCanvasNodes,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
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
  createContainer: (
    opts?: Partial<Pick<ContainerNode, "title" | "bounds">>,
  ) => ContainerNode;
  insertNode: (node: CanvasNode, containerId?: string | null) => void;
  updateNode: (nodeId: string, updates: Partial<CanvasNode>) => void;
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
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "icon"
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
    const toast = useToast();

    docRef.current = doc;

    const selectedIds = doc.selection ?? [];
    const selectedId = selectedIds[selectedIds.length - 1] ?? null;
    const selectedNode = selectedId ? doc.nodes[selectedId] : undefined;

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
          const state = toAppState(next);
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
        const nextSelection = nodeIds.filter((id) =>
          Boolean(docRef.current.nodes[id]),
        );
        const next = {
          ...docRef.current,
          selection: nextSelection,
          updatedAt: new Date().toISOString(),
        };
        commitDocument(next, {
          captureHistory: options?.captureHistory ?? false,
          notify: false,
        });
        if (options?.notifySelection !== false) {
          onSelectionChange?.(
            nextSelection
              .map((id) => next.nodes[id])
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
          setSelection([]);
          return;
        }
        const current = docRef.current.selection ?? [];
        if (!additive) {
          setSelection([nodeId]);
          return;
        }
        const next = current.includes(nodeId)
          ? current.filter((id) => id !== nodeId)
          : [...current, nodeId];
        setSelection(next);
      },
      [setSelection],
    );

    const createContainer = useCallback(
      (opts?: Partial<Pick<ContainerNode, "title" | "bounds">>) => {
        const id = createCanvasNodeId("container");
        const container: ContainerNode = {
          id,
          type: "container",
          parentId: null,
          title: opts?.title ?? "New container",
          bounds: opts?.bounds ?? defaultBounds(docRef.current, "container"),
          role: ["visual", "task", "context"],
          childrenOrder: [],
          contextSlots: {},
          inheritPolicy: "merge",
          permissions: {
            canRead: [],
            canWrite: [],
            isolationLevel: "open",
          },
          style: {
            fill: "rgba(255,255,255,0.78)",
            stroke: "#6c5ce7",
            opacity: 1,
          },
        };
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
        const id = createCanvasNodeId("image");
        const assetId =
          artifact.assetId ?? artifact.jobId ?? createCanvasNodeId("asset");
        const targetContainerId = getPrimarySelectedContainerId(docRef.current);
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
        const node: CanvasNode = {
          id,
          type: "image",
          parentId: targetContainerId,
          bounds: {
            ...bounds,
            width: artifact.width ?? bounds.width,
            height: artifact.height ?? bounds.height,
          },
          title: artifact.title ?? "Generated image",
          assetId,
          src: artifact.url,
          meta: { source },
        };
        const next = applyCanvasOperation(
          {
            ...docRef.current,
            assets: { ...docRef.current.assets, [asset.id]: asset },
          },
          { type: "insertNode", node, containerId: targetContainerId },
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
              assetId: createCanvasNodeId("asset"),
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
        const id = createCanvasNodeId(connectorType);
        const parentId = getPrimarySelectedContainerId(docRef.current);
        const node: ConnectorNode = {
          id,
          type: connectorType,
          parentId,
          title: connectorType === "arrow" ? "Arrow" : "Line",
          bounds: { x: point.x, y: point.y, width: 2, height: 2 },
          stroke: "#111827",
          strokeWidth: 3,
          startAnchor: "tl",
          endAnchor: "br",
        };
        applyOperation({ type: "insertNode", node, containerId: parentId });
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
        (previous.selection ?? [])
          .map((id) => previous.nodes[id])
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
    }, [commitDocument, onSelectionChange]);

    const redo = useCallback(() => {
      const next = historyRef.current?.redo(docRef.current);
      if (!next) return;
      commitDocument(next, { captureHistory: false });
      onSelectionChange?.(
        (next.selection ?? [])
          .map((id) => next.nodes[id])
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
    }, [commitDocument, onSelectionChange]);

    const deleteSelection = useCallback(() => {
      const ids = getTopLevelSelectionIds(docRef.current);
      if (ids.length === 0) return;
      let next = docRef.current;
      for (const nodeId of ids) {
        next = applyCanvasOperation(next, { type: "deleteNode", nodeId });
      }
      next.selection = [];
      commitDocument(next);
      onSelectionChange?.([]);
    }, [commitDocument, onSelectionChange]);

    const copySelection = useCallback(() => {
      const selection = docRef.current.selection ?? [];
      if (selection.length === 0) return false;
      clipboardRef.current = copyCanvasSelection(docRef.current, selection);
          console.info("[canvas-runtime] selection.copied", {
        count: clipboardRef.current.rootNodeIds.length,
      });
      return true;
    }, []);

    const cutSelection = useCallback(() => {
      if (copySelection()) deleteSelection();
    }, [copySelection, deleteSelection]);

    const pasteClipboard = useCallback(() => {
      const clipboard = clipboardRef.current;
      if (!clipboard) return [];
      const parentId = getPrimarySelectedContainerId(docRef.current);
      const result = pasteCanvasClipboard(docRef.current, clipboard, {
        parentId,
        offset: 18,
      });
      commitDocument(result.doc);
      onSelectionChange?.(
        result.pastedIds
          .map((id) => result.doc.nodes[id])
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
            ((stageRect?.width ?? 0) / 2 - docRef.current.viewport.x) /
            docRef.current.viewport.zoom,
          y:
            ((stageRect?.height ?? 0) / 2 - docRef.current.viewport.y) /
            docRef.current.viewport.zoom,
        };
        const offsetX = importBounds
          ? viewportCenter.x - (importBounds.x + importBounds.width / 2)
          : 0;
        const offsetY = importBounds
          ? viewportCenter.y - (importBounds.y + importBounds.height / 2)
          : 0;
        const inserted = insertCanvasImportResult(docRef.current, parsed, {
          parentId: getPrimarySelectedContainerId(docRef.current),
          offsetX,
          offsetY,
        });
        commitDocument(inserted.doc);
        onSelectionChange?.(
          inserted.insertedIds
            .map((id) => inserted.doc.nodes[id])
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
      const selection = docRef.current.selection ?? [];
      if (selection.length === 0) return [];
      const result = duplicateCanvasNodes(docRef.current, selection, 18);
      commitDocument(result.doc);
      onSelectionChange?.(
        result.pastedIds
          .map((id) => result.doc.nodes[id])
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
      console.info("[canvas-runtime] selection.duplicated", {
        count: result.pastedIds.length,
      });
      return result.pastedIds;
    }, [commitDocument, onSelectionChange]);

    const groupSelection = useCallback(() => {
      const selection = getTopLevelSelectionIds(docRef.current);
      if (selection.length < 2) return null;
      const groupId = createCanvasNodeId("group");
      const next = applyCanvasOperation(docRef.current, {
        type: "groupNodes",
        groupId,
        nodeIds: selection,
      });
      commitDocument(next);
      const groupNode = next.nodes[groupId];
      if (groupNode) onSelectionChange?.([toSceneElement(groupNode)]);
      console.info("[canvas-runtime] selection.grouped", {
        groupId,
        count: selection.length,
      });
      return groupId;
    }, [commitDocument, onSelectionChange]);

    const ungroupSelection = useCallback(() => {
      const groupIds = (docRef.current.selection ?? []).filter(
        (nodeId) => docRef.current.nodes[nodeId]?.type === "group",
      );
      if (groupIds.length === 0) return [];
      let next = docRef.current;
      for (const groupId of groupIds) {
        next = applyCanvasOperation(next, { type: "ungroupNode", groupId });
      }
      commitDocument(next);
      const selection = next.selection ?? [];
      onSelectionChange?.(
        selection
          .map((id) => next.nodes[id])
          .filter(isCanvasNode)
          .map((node) => toSceneElement(node)),
      );
      console.info("[canvas-runtime] selection.ungrouped", {
        count: groupIds.length,
      });
      return selection;
    }, [commitDocument, onSelectionChange]);

    const alignSelection = useCallback(
      (alignment: AlignMode) => {
        const selection = getTopLevelSelectionIds(docRef.current);
        if (selection.length < 2) return;
        applyOperation({
          type: "alignNodes",
          nodeIds: selection,
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
        const node = docRef.current.nodes[nodeId];
        if (!node) return;
        applyOperation({
          type: "updateNode",
          nodeId,
          updates: { locked: !node.locked } as Partial<CanvasNode>,
        });
      },
      [applyOperation],
    );

    const toggleNodeVisible = useCallback(
      (nodeId: string) => {
        const node = docRef.current.nodes[nodeId];
        if (!node) return;
        applyOperation({
          type: "updateNode",
          nodeId,
          updates: { visible: node.visible === false } as Partial<CanvasNode>,
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
        exportImage: (opts) => exportDocumentImage(docRef.current, opts),
        getSceneElements: () => toSceneElements(docRef.current),
        getFiles: () => toFiles(docRef.current),
        getAppState: () => toAppState(docRef.current),
        updateScene: (scene) => {
          const state = scene.appState;
          if (!state) return;
          commitDocument(
            {
              ...docRef.current,
              selection: state.selectedElementIds
                ? Object.entries(state.selectedElementIds)
                    .filter(([, selected]) => selected)
                    .map(([id]) => id)
                : docRef.current.selection,
              viewport: {
                ...docRef.current.viewport,
                zoom: state.zoom?.value ?? docRef.current.viewport.zoom,
                x: state.scrollX ?? docRef.current.viewport.x,
                y: state.scrollY ?? docRef.current.viewport.y,
                backgroundColor:
                  state.viewBackgroundColor ??
                  docRef.current.viewport.backgroundColor,
              },
            },
            { captureHistory: false },
          );
        },
        addFiles: (incoming) => {
          const assets = { ...docRef.current.assets };
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
          commitDocument(
            {
              ...docRef.current,
              viewport: { ...docRef.current.viewport, x: 0, y: 0, zoom: 1 },
            },
            { captureHistory: false },
          );
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
          const id = createCanvasNodeId("video");
          const assetId =
            artifact.assetId ?? artifact.jobId ?? createCanvasNodeId("asset");
          const targetContainerId = getPrimarySelectedContainerId(docRef.current);
          const node: CanvasNode = {
            id,
            type: "videoEmbed",
            parentId: targetContainerId,
            bounds: defaultBounds(
              docRef.current,
              "videoEmbed",
              targetContainerId,
            ),
            title: artifact.title ?? "Generated video",
            src: artifact.url,
            mimeType: artifact.mimeType,
            durationSeconds: artifact.durationSeconds,
            meta: { assetId, source: "generated" },
          };
          applyOperation({
            type: "insertNode",
            node,
            containerId: targetContainerId,
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
        const selection = docRef.current.selection ?? [];
        if (selection.length === 0) return;
        let next = docRef.current;
        for (const nodeId of selection) {
          const node = next.nodes[nodeId];
          if (!node || node.locked) continue;
          next = applyCanvasOperation(next, {
            type: "updateNode",
            nodeId,
            updates: {
              bounds: {
                ...node.bounds,
                x: node.bounds.x + dx,
                y: node.bounds.y + dy,
              },
            } as Partial<CanvasNode>,
          });
        }
        commitDocument(next);
      },
      reorderSelection: (direction) => {
        const selection = getTopLevelSelectionIds(docRef.current);
        for (const nodeId of selection) {
          reorderNode(nodeId, direction);
        }
      },
      setActiveTool: (tool) => {
        if (tool === "rect") {
          setActiveTool("rect");
          return;
        }
        setActiveTool(tool);
      },
    });

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
        updates: Partial<CanvasNode>,
      ) => {
        const existing = baseDoc.nodes[nodeId];
        if (!existing) {
          return baseDoc;
        }
        let next = applyCanvasOperation(baseDoc, {
          type: "updateNode",
          nodeId,
          updates,
        });
        if (
          updates.bounds &&
          "childrenOrder" in existing &&
          getCanvasImportedNodeMeta(existing.meta)?.autoLayout
        ) {
          next = applyImportedAutoLayout(next, nodeId);
        }
        return next;
      },
      [],
    );

    const updateNode = useCallback(
      (nodeId: string, updates: Partial<CanvasNode>) => {
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
      const id = createCanvasNodeId("rect");
      const parentId = getPrimarySelectedContainerId(docRef.current);
      const node: CanvasNode = {
        id,
        type: "rect",
        parentId,
        title: "Rectangle",
        bounds: defaultBounds(docRef.current, "rect", parentId),
        fill: "#d3f256",
        stroke: "#111827",
        strokeWidth: 1,
        radius: 12,
      };
      applyOperation({ type: "insertNode", node, containerId: parentId });
      selectNode(id);
    }, [applyOperation, selectNode]);

    const insertPrimitiveNode = useCallback(
      (
        type: "ellipse" | "polygon" | "path" | "icon",
        point?: { x: number; y: number },
      ) => {
        const id = createCanvasNodeId(type);
        const parentId = getPrimarySelectedContainerId(docRef.current);
        const baseBounds = point
          ? { x: point.x, y: point.y, width: 160, height: 120 }
          : defaultBounds(docRef.current, type, parentId);
        const shared = {
          id,
          parentId,
          bounds: baseBounds,
          fill: "#f8fafc",
          stroke: "#111827",
          strokeWidth: 2,
        };
        const node: CanvasNode =
          type === "ellipse"
            ? { ...shared, type, title: "Ellipse" }
            : type === "polygon"
              ? { ...shared, type, title: "Polygon", points: 3 }
              : type === "path"
                ? {
                    ...shared,
                    type,
                    title: "Path",
                    d: "M20 90 C55 15, 105 15, 140 90",
                    fill: "none",
                  }
                : {
                    ...shared,
                    type,
                    title: "Icon",
                    icon: "sparkles",
                    fill: "none",
                  };
        applyOperation({ type: "insertNode", node, containerId: parentId });
        selectNode(id);
      },
      [applyOperation, selectNode],
    );

    const insertText = useCallback(() => {
      const id = createCanvasNodeId("text");
      const parentId = getPrimarySelectedContainerId(docRef.current);
      const node: CanvasNode = {
        id,
        type: "text",
        parentId,
        title: "Text",
        bounds: defaultBounds(docRef.current, "text", parentId),
        text: "Double click to edit",
        fontSize: 28,
        color: "#111827",
      };
      applyOperation({ type: "insertNode", node, containerId: parentId });
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
        );
        if (activeTool === "container") {
          createContainer({
            bounds: { x: point.x, y: point.y, width: 360, height: 240 },
          });
          setActiveTool("select");
          return;
        }
        if (activeTool === "rect") {
          const id = createCanvasNodeId("rect");
          const parentId = getPrimarySelectedContainerId(docRef.current);
          const node: CanvasNode = {
            id,
            type: "rect",
            parentId,
            title: "Rectangle",
            bounds: { x: point.x, y: point.y, width: 180, height: 120 },
            fill: "#d3f256",
            stroke: "#111827",
            strokeWidth: 1,
            radius: 12,
          };
          applyOperation({ type: "insertNode", node, containerId: parentId });
          selectNode(id);
          setActiveTool("select");
          return;
        }
        if (
          activeTool === "ellipse" ||
          activeTool === "polygon" ||
          activeTool === "path" ||
          activeTool === "icon"
        ) {
          insertPrimitiveNode(activeTool, point);
          setActiveTool("select");
          return;
        }
        if (activeTool === "text") {
          const id = createCanvasNodeId("text");
          const parentId = getPrimarySelectedContainerId(docRef.current);
          const node: CanvasNode = {
            id,
            type: "text",
            parentId,
            title: "Text",
            bounds: { x: point.x, y: point.y, width: 260, height: 80 },
            text: "Double click to edit",
            fontSize: 28,
            color: "#111827",
          };
          applyOperation({ type: "insertNode", node, containerId: parentId });
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
            originX: docRef.current.viewport.x,
            originY: docRef.current.viewport.y,
          };
        } else {
          if (!event.shiftKey) setSelection([]);
          dragRef.current = {
            kind: "marquee",
            startPoint: point,
            additive: event.shiftKey,
            originSelection: docRef.current.selection ?? [],
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
        const drag = dragRef.current;
        if (!drag) return;
        if (drag.kind === "pan") {
          commitDocument(
            {
              ...docRef.current,
              viewport: {
                ...docRef.current.viewport,
                x: drag.originX + event.clientX - drag.startX,
                y: drag.originY + event.clientY - drag.startY,
              },
            },
            { captureHistory: false },
          );
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
            ) as Partial<CanvasNode>,
          });
          commitDocument(next, { captureHistory: false, notify: false });
          return;
        }
        const dx = (event.clientX - drag.startX) / docRef.current.viewport.zoom;
        const dy = (event.clientY - drag.startY) / docRef.current.viewport.zoom;
        if (drag.kind === "move") {
          let next = docRef.current;
          let activeGuide: { x?: number; y?: number } | null = null;
          for (const nodeId of drag.nodeIds) {
            const origin = drag.origins[nodeId];
            const node = next.nodes[nodeId];
            if (!origin || !node) continue;
            const snapped = snapBoundsToGrid({
              ...node.bounds,
              x: origin.x + dx,
              y: origin.y + dy,
            });
            activeGuide = activeGuide ?? snapped.guides;
            next = applyAutoLayoutAwareNodeUpdate(next, nodeId, {
              bounds: snapped.bounds,
            } as Partial<CanvasNode>);
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
          const node = docRef.current.nodes[drag.nodeId];
          if (!node) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates: {
              bounds: { ...node.bounds, rotation: Math.round(rotation) },
            } as Partial<CanvasNode>,
          });
          commitDocument(next, { captureHistory: false, notify: false });
          return;
        }
        const node = docRef.current.nodes[drag.nodeId];
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
          } as Partial<CanvasNode>);
        commitDocument(next, { captureHistory: false, notify: false });
      },
      [applyAutoLayoutAwareNodeUpdate, commitDocument, setSelection],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (dragRef.current?.kind === "drawConnector") {
          const node = docRef.current.nodes[dragRef.current.nodeId];
          if (node && node.bounds.width <= 6 && node.bounds.height <= 6) {
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
          Math.max(0.25, docRef.current.viewport.zoom - event.deltaY * 0.001),
        );
        commitDocument(
          {
            ...docRef.current,
            viewport: { ...docRef.current.viewport, zoom: nextZoom },
          },
          { captureHistory: false },
        );
      },
      [commitDocument],
    );

    return (
      <div
        ref={stageRef}
        className={`relative h-full w-full overflow-hidden text-foreground ${
          activeTool === "hand"
            ? "cursor-grab"
            : activeTool === "line" ||
                activeTool === "arrow" ||
                activeTool === "ellipse" ||
                activeTool === "polygon" ||
                activeTool === "path" ||
                activeTool === "icon"
              ? "cursor-crosshair"
              : "cursor-default"
        }`}
        style={{ backgroundColor: doc.viewport.backgroundColor }}
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
            backgroundSize: `${GRID_SIZE * doc.viewport.zoom}px ${GRID_SIZE * doc.viewport.zoom}px`,
            backgroundPosition: `${doc.viewport.x}px ${doc.viewport.y}px`,
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
            (nodeId) => doc.nodes[nodeId]?.type === "group",
          )}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={undo}
          onRedo={redo}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
        />
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})`,
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
                  const targetNode = docRef.current.nodes[nodeId];
                  if (!targetNode || targetNode.locked) return;
                  if (activeTool === "hand") {
                    dragRef.current = {
                      kind: "pan",
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: docRef.current.viewport.x,
                      originY: docRef.current.viewport.y,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    return;
                  }
                  beginHistoryCapture();
                  const dragNodeIds = (docRef.current.selection ?? []).includes(
                    nodeId,
                  )
                    ? (docRef.current.selection ?? [])
                    : [nodeId];
                  dragRef.current = {
                    kind: "move",
                    nodeIds: dragNodeIds,
                    startX: event.clientX,
                    startY: event.clientY,
                    origins: Object.fromEntries(
                      dragNodeIds
                        .map((id) => docRef.current.nodes[id])
                        .filter(isCanvasNode)
                        .map((node) => [node.id, node.bounds]),
                    ),
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onResizeStart={(nodeId, handle, event) => {
                  const targetNode = docRef.current.nodes[nodeId];
                  if (!targetNode || targetNode.locked) return;
                  beginHistoryCapture();
                  dragRef.current = {
                    kind: "resize",
                    nodeId,
                    handle,
                    startX: event.clientX,
                    startY: event.clientY,
                    origin: targetNode.bounds,
                    preserveAspectRatio:
                      targetNode.type === "image" ||
                      targetNode.type === "videoEmbed" ||
                      targetNode.type === "icon",
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onRotateStart={(nodeId, event) => {
                  const targetNode = docRef.current.nodes[nodeId];
                  if (!targetNode || targetNode.locked) return;
                  beginHistoryCapture();
                  const center = {
                    x: targetNode.bounds.x + targetNode.bounds.width / 2,
                    y: targetNode.bounds.y + targetNode.bounds.height / 2,
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
                    originRotation: targetNode.bounds.rotation ?? 0,
                    startAngle: pointToAngle(center, point),
                    startX: event.clientX,
                    startY: event.clientY,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onUpdate={updateNode}
              />
            ))}
        </div>
        {marqueeBounds ? (
          <div
            className="pointer-events-none absolute border border-primary/70 bg-primary/10"
            style={{
              left: marqueeBounds.x * doc.viewport.zoom + doc.viewport.x,
              top: marqueeBounds.y * doc.viewport.zoom + doc.viewport.y,
              width: marqueeBounds.width * doc.viewport.zoom,
              height: marqueeBounds.height * doc.viewport.zoom,
            }}
          />
        ) : null}
        {snapGuides?.x !== undefined ? (
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary/60"
            style={{
              left: snapGuides.x * doc.viewport.zoom + doc.viewport.x,
            }}
          />
        ) : null}
        {snapGuides?.y !== undefined ? (
          <div
            className="pointer-events-none absolute left-0 right-0 h-px bg-primary/60"
            style={{
              top: snapGuides.y * doc.viewport.zoom + doc.viewport.y,
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
              selectedNode.type === "container"
                ? resolveContext(doc, selectedNode.id)
                : undefined
            }
            onUpdate={(updates) =>
              updateNode(selectedNode.id, updates as Partial<CanvasNode>)
            }
            onApplyImportedAutoLayout={() => {
              const next = applyImportedAutoLayout(docRef.current, selectedNode.id);
              if (next === docRef.current) {
                return;
              }
              console.info("[canvas-runtime] imported-auto-layout.applied", {
                nodeId: selectedNode.id,
                source: getCanvasImportedNodeMeta(selectedNode.meta)?.source,
              });
              commitDocument(next);
            }}
            onBindAgent={(binding) =>
              selectedNode.type === "container"
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
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onCreateContainer: () => void;
  onImportImage: () => void;
  onInsertRect: () => void;
  onInsertPrimitive: (type: "ellipse" | "polygon" | "path" | "icon") => void;
  onInsertText: () => void;
  onDelete: () => void;
  selectedCount: number;
  canUngroup: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onGroup: () => void;
  onUngroup: () => void;
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
        className={`${buttonClass} ${activeTool === "path" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("path")}
        onDoubleClick={() => onInsertPrimitive("path")}
        title="路径"
      >
        <PenTool className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${activeTool === "icon" ? "bg-muted text-foreground" : ""}`}
        onClick={() => onToolChange("icon")}
        onDoubleClick={() => onInsertPrimitive("icon")}
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
        className={`${buttonClass} ${activeTool === "arrow" ? "bg-muted text-foreground" : ""}`}
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
  node: CanvasNode;
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
  onUpdate: (nodeId: string, updates: Partial<CanvasNode>) => void;
}) {
  const selected = selectedIds.includes(node.id);
  const style = {
    left: node.bounds.x,
    top: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    transform: `rotate(${node.bounds.rotation ?? 0}deg)`,
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
  node: CanvasNode,
  selected: boolean,
  onUpdate: (nodeId: string, updates: Partial<CanvasNode>) => void,
) {
  const importedAutoLayout = getCanvasImportedNodeMeta(node.meta)?.autoLayout;
  const ring = selected
    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
    : "";
  switch (node.type) {
    case "container":
      return (
        <div
          className={`relative h-full w-full rounded-lg border-2 bg-card/70 shadow-subtle backdrop-blur ${ring}`}
          style={{
            borderColor: node.style?.stroke ?? "#6c5ce7",
            backgroundColor: node.style?.fill ?? "rgba(255,255,255,.78)",
            opacity: node.style?.opacity ?? 1,
            overflow: importedAutoLayout?.clipContent ? "hidden" : undefined,
          }}
        >
          <div className="flex h-8 items-center justify-between rounded-t-md border-b border-border/70 bg-background/60 px-3">
            <span className="truncate text-xs font-medium text-foreground">
              {node.title ?? "Container"}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {node.agentBinding?.status ? (
                <Sparkles className="h-3 w-3" />
              ) : null}
              {node.agentBinding?.name ??
                node.agentBinding?.agentId ??
                "unassigned"}
            </span>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="relative h-full w-full">
          <img
            alt={node.alt ?? node.title ?? "Canvas image"}
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
            color: node.color ?? "#111827",
            textAlign: node.align ?? "left",
          }}
          value={node.text}
          onChange={(event) =>
            onUpdate(node.id, {
              text: event.currentTarget.value,
            } as Partial<CanvasNode>)
          }
        />
      );
    case "rect":
      return (
        <div
          className={`h-full w-full shadow-subtle ${ring}`}
          style={{
            borderRadius: node.radius ?? 8,
            backgroundColor: node.fill ?? "#d3f256",
            border: `${node.strokeWidth ?? 1}px solid ${node.stroke ?? "#111827"}`,
          }}
        />
      );
    case "ellipse":
      return (
        <div
          className={`h-full w-full rounded-full shadow-subtle ${ring}`}
          style={{
            backgroundColor: node.fill ?? "#f8fafc",
            border: `${node.strokeWidth ?? 2}px solid ${node.stroke ?? "#111827"}`,
          }}
        />
      );
    case "polygon":
      return renderPolygon(node, selected);
    case "path":
      return renderPath(node, selected);
    case "icon":
      return renderIconNode(node, selected);
    case "line":
    case "arrow":
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
  node: CanvasNode;
  context?: ContextSlots;
  onUpdate: (updates: Partial<CanvasNode>) => void;
  onApplyImportedAutoLayout?: () => void;
  onBindAgent: (binding: AgentBinding) => void;
}) {
  const [agentName, setAgentName] = useState(
    node.type === "container" ? (node.agentBinding?.name ?? "") : "",
  );
  const importedMeta = getCanvasImportedNodeMeta(node.meta);
  const importedAutoLayout = importedMeta?.autoLayout;
  const importedAutoLayoutEntries = importedAutoLayout
    ? formatImportedAutoLayoutEntries(importedAutoLayout)
    : [];
  const canApplyImportedAutoLayout =
    Boolean(onApplyImportedAutoLayout) &&
    Boolean(importedAutoLayout) &&
    "childrenOrder" in node &&
    node.childrenOrder.length > 0;
  const titleInputId = `${node.id}-title`;
  const rulesInputId = `${node.id}-rules`;
  const agentInputId = `${node.id}-agent`;
  const updateBounds = (updates: Partial<CanvasBounds>) =>
    onUpdate({ bounds: { ...node.bounds, ...updates } } as Partial<CanvasNode>);
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
        value={node.title ?? ""}
        onChange={(event) => onUpdate({ title: event.currentTarget.value })}
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={node.bounds.x}
          onChange={(x) => updateBounds({ x })}
        />
        <NumberField
          label="Y"
          value={node.bounds.y}
          onChange={(y) => updateBounds({ y })}
        />
        <NumberField
          label="W"
          min={1}
          value={node.bounds.width}
          onChange={(width) => updateBounds({ width })}
        />
        <NumberField
          label="H"
          min={1}
          value={node.bounds.height}
          onChange={(height) => updateBounds({ height })}
        />
        <NumberField
          label="R"
          value={node.bounds.rotation ?? 0}
          onChange={(rotation) => updateBounds({ rotation })}
        />
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={node.visible !== false}
            onChange={(event) =>
              onUpdate({
                visible: event.currentTarget.checked,
              } as Partial<CanvasNode>)
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
            } as Partial<CanvasNode>)
          }
        />
        锁定
      </label>

      {supportsPaint ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <TextField
            label="Fill"
            value={getPaintValue(node, "fill")}
            onChange={(fill) => onUpdate({ fill } as Partial<CanvasNode>)}
          />
          <TextField
            label="Stroke"
            value={getPaintValue(node, "stroke")}
            onChange={(stroke) => onUpdate({ stroke } as Partial<CanvasNode>)}
          />
          <NumberField
            label="SW"
            min={0}
            value={Number(getPaintValue(node, "strokeWidth") || 0)}
            onChange={(strokeWidth) =>
              onUpdate({ strokeWidth } as Partial<CanvasNode>)
            }
          />
          {node.type === "rect" ? (
            <NumberField
              label="Rad"
              min={0}
              value={node.radius ?? 0}
              onChange={(radius) => onUpdate({ radius } as Partial<CanvasNode>)}
            />
          ) : null}
        </div>
      ) : null}

      {node.type === "text" ? (
        <div className="mb-3 grid gap-2">
          <textarea
            className="h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={node.text}
            onChange={(event) =>
              onUpdate({
                text: event.currentTarget.value,
              } as Partial<CanvasNode>)
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Size"
              min={1}
              value={node.fontSize}
              onChange={(fontSize) =>
                onUpdate({ fontSize } as Partial<CanvasNode>)
              }
            />
            <TextField
              label="Color"
              value={node.color ?? "#111827"}
              onChange={(color) => onUpdate({ color } as Partial<CanvasNode>)}
            />
          </div>
        </div>
      ) : null}

      {node.type === "polygon" ? (
        <NumberField
          label="Points"
          min={3}
          value={node.points}
          onChange={(points) => onUpdate({ points } as Partial<CanvasNode>)}
        />
      ) : null}

      {node.type === "container" ? (
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
            value={(node.contextSlots.rules ?? []).join("\n")}
            onChange={(event) =>
              onUpdate({
                contextSlots: {
                  ...node.contextSlots,
                  rules: event.currentTarget.value.split("\n").filter(Boolean),
                },
              } as Partial<CanvasNode>)
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

function isPaintNode(node: CanvasNode): boolean {
  return [
    "rect",
    "ellipse",
    "polygon",
    "path",
    "icon",
    "line",
    "arrow",
  ].includes(node.type);
}

function getPaintValue(
  node: CanvasNode,
  key: "fill" | "stroke" | "strokeWidth",
): string {
  if (!isPaintNode(node)) return "";
  const value = (node as CanvasNode & Record<string, unknown>)[key];
  return value === undefined ? "" : String(value);
}

function isCanvasNode(node: CanvasNode | undefined): node is CanvasNode {
  return Boolean(node);
}

function toSceneElements(doc: CucumberCanvasDocument): CanvasSceneElement[] {
  return getOrderedCanvasNodes(doc).map(({ node, depth }) =>
    toSceneElement(node, depth),
  );
}

function toSceneElement(node: CanvasNode, depth = 0): CanvasSceneElement {
  const importMeta = getCanvasImportedNodeMeta(node.meta);
  return {
    id: node.id,
    type: node.type === "videoEmbed" ? "embeddable" : node.type,
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    isDeleted: false,
    fileId: node.type === "image" ? node.assetId : undefined,
    text: node.type === "text" ? node.text : undefined,
    locked: node.locked === true,
    visible: node.visible !== false,
    depth,
    customData: {
      title: node.title,
      source: importMeta?.source,
      containerId: node.parentId,
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
  return result;
}

function toAppState(doc: CucumberCanvasDocument): CanvasAppState {
  return {
    zoom: { value: doc.viewport.zoom },
    scrollX: doc.viewport.x,
    scrollY: doc.viewport.y,
    viewBackgroundColor: doc.viewport.backgroundColor,
    selectedElementIds: Object.fromEntries(
      (doc.selection ?? []).map((id) => [id, true]),
    ),
  };
}

function defaultBounds(
  doc: CucumberCanvasDocument,
  type: CanvasNode["type"],
  parentId?: string | null,
): CanvasBounds {
  const parent = parentId ? doc.nodes[parentId] : undefined;
  const baseX = parent
    ? parent.bounds.x + 32
    : 120 + doc.rootNodeIds.length * 28;
  const baseY = parent
    ? parent.bounds.y + 48
    : 120 + doc.rootNodeIds.length * 22;
  if (type === "container")
    return { x: baseX, y: baseY, width: 360, height: 240 };
  if (type === "text") return { x: baseX, y: baseY, width: 260, height: 80 };
  if (type === "image") return { x: baseX, y: baseY, width: 320, height: 220 };
  if (type === "line" || type === "arrow")
    return { x: baseX, y: baseY, width: 220, height: 120 };
  if (type === "videoEmbed")
    return { x: baseX, y: baseY, width: 360, height: 220 };
  return { x: baseX, y: baseY, width: 180, height: 120 };
}

function screenToCanvasPoint(
  event: React.PointerEvent,
  doc: CucumberCanvasDocument,
  stage: HTMLDivElement | null,
): { x: number; y: number } {
  const rect = stage?.getBoundingClientRect();
  return {
    x: (event.clientX - (rect?.left ?? 0) - doc.viewport.x) / doc.viewport.zoom,
    y: (event.clientY - (rect?.top ?? 0) - doc.viewport.y) / doc.viewport.zoom,
  };
}

function SelectionOutline() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-primary/80 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]" />
  );
}

function renderPolygon(
  node: Extract<CanvasNode, { type: "polygon" }>,
  selected: boolean,
) {
  const width = Math.max(node.bounds.width, 1);
  const height = Math.max(node.bounds.height, 1);
  const points = createPolygonPoints(node.points, width, height);
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{node.title ?? "Polygon"}</title>
        <polygon
          points={points}
          fill={node.fill ?? "#f8fafc"}
          stroke={node.stroke ?? "#111827"}
          strokeWidth={node.strokeWidth ?? 2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function renderPath(
  node: Extract<CanvasNode, { type: "path" }>,
  selected: boolean,
) {
  const width = Math.max(node.bounds.width, 1);
  const height = Math.max(node.bounds.height, 1);
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{node.title ?? "Path"}</title>
        <path
          d={node.d}
          fill={node.fill ?? "none"}
          stroke={node.stroke ?? "#111827"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={node.strokeWidth ?? 3}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function renderIconNode(
  node: Extract<CanvasNode, { type: "icon" }>,
  selected: boolean,
) {
  const stroke = node.stroke ?? "#111827";
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <svg className="h-full w-full" viewBox="0 0 24 24">
        <title>{node.title ?? "Icon"}</title>
        {node.icon === "star" ? (
          <path
            d="m12 2 2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 17.1l-5.8 3.1 1.1-6.6-4.8-4.7 6.6-.9L12 2Z"
            fill={node.fill ?? "none"}
            stroke={stroke}
            strokeLinejoin="round"
            strokeWidth={node.strokeWidth ?? 1.8}
          />
        ) : (
          <>
            <path
              d="M12 3 10.3 8.3 5 10l5.3 1.7L12 17l1.7-5.3L19 10l-5.3-1.7L12 3Z"
              fill={node.fill ?? "none"}
              stroke={stroke}
              strokeLinejoin="round"
              strokeWidth={node.strokeWidth ?? 1.8}
            />
            <path
              d="M18 15.5 17.2 18 15 18.8l2.2.8.8 2.4.8-2.4 2.2-.8-2.2-.8-.8-2.5Z"
              fill={node.fill ?? "none"}
              stroke={stroke}
              strokeLinejoin="round"
              strokeWidth={node.strokeWidth ?? 1.5}
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

function renderConnector(node: ConnectorNode, selected: boolean) {
  const safeWidth = Math.max(node.bounds.width, 2);
  const safeHeight = Math.max(node.bounds.height, 2);
  const start = anchorToPoint(node.startAnchor ?? "tl", safeWidth, safeHeight);
  const end = anchorToPoint(node.endAnchor ?? "br", safeWidth, safeHeight);
  const markerId = `connector-arrow-${node.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div className="relative h-full w-full overflow-visible">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      >
        <title>
          {node.type === "arrow" ? "Arrow connector" : "Line connector"}
        </title>
        {node.type === "arrow" ? (
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
              <path d="M0,0 L0,6 L9,3 z" fill={node.stroke ?? "#111827"} />
            </marker>
          </defs>
        ) : null}
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={node.stroke ?? "#111827"}
          strokeWidth={node.strokeWidth ?? 3}
          strokeLinecap="round"
          markerEnd={node.type === "arrow" ? `url(#${markerId})` : undefined}
        />
      </svg>
      {selected ? <SelectionOutline /> : null}
    </div>
  );
}

function anchorToPoint(
  anchor: ConnectorAnchor,
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
  connectorType: "line" | "arrow",
): Partial<ConnectorNode> {
  const minX = Math.min(startPoint.x, endPoint.x);
  const minY = Math.min(startPoint.y, endPoint.y);
  const width = Math.max(Math.abs(endPoint.x - startPoint.x), 2);
  const height = Math.max(Math.abs(endPoint.y - startPoint.y), 2);

  return {
    type: connectorType,
    bounds: { x: minX, y: minY, width, height },
    startAnchor: resolveConnectorAnchor(
      startPoint.x - minX,
      startPoint.y - minY,
      width,
      height,
    ),
    endAnchor: resolveConnectorAnchor(
      endPoint.x - minX,
      endPoint.y - minY,
      width,
      height,
    ),
  };
}

function resolveConnectorAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
): ConnectorAnchor {
  const horizontal = x <= width / 2 ? "l" : "r";
  const vertical = y <= height / 2 ? "t" : "b";
  return `${vertical}${horizontal}` as ConnectorAnchor;
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
): Promise<Blob> {
  const bounds = calculateDocumentBounds(doc);
  const max = opts?.maxWidthOrHeight ?? 1024;
  const scale = Math.min(1, max / Math.max(bounds.width, bounds.height, 1));
  const svg = renderDocumentSvg(doc, bounds, scale);
  return new Blob([svg], { type: opts?.mimeType ?? "image/svg+xml" });
}

function calculateDocumentBounds(doc: CucumberCanvasDocument): CanvasBounds {
  const nodes = Object.values(doc.nodes);
  if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  const minX = Math.min(...nodes.map((node) => node.bounds.x));
  const minY = Math.min(...nodes.map((node) => node.bounds.y));
  const maxX = Math.max(
    ...nodes.map((node) => node.bounds.x + node.bounds.width),
  );
  const maxY = Math.max(
    ...nodes.map((node) => node.bounds.y + node.bounds.height),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function renderDocumentSvg(
  doc: CucumberCanvasDocument,
  bounds: CanvasBounds,
  scale: number,
): string {
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const nodes = Object.values(doc.nodes)
    .map((node) => {
      const x = (node.bounds.x - bounds.x) * scale;
      const y = (node.bounds.y - bounds.y) * scale;
      const w = node.bounds.width * scale;
      const h = node.bounds.height * scale;
      const transform = node.bounds.rotation
        ? ` transform="rotate(${node.bounds.rotation} ${x + w / 2} ${y + h / 2})"`
        : "";
      if (node.type === "text") {
        return `<text x="${x}" y="${y + node.fontSize * scale}" font-size="${node.fontSize * scale}" fill="${escapeAttr(node.color ?? "#111827")}"${transform}>${escapeText(node.text)}</text>`;
      }
      if (node.type === "image") {
        return `<image href="${escapeAttr(node.src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${transform} />`;
      }
      if (node.type === "line" || node.type === "arrow") {
        const start = anchorToPoint(node.startAnchor ?? "tl", w, h);
        const end = anchorToPoint(node.endAnchor ?? "br", w, h);
        const markerId = `svg-marker-${escapeAttr(node.id)}`;
        const defs =
          node.type === "arrow"
            ? `<defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${escapeAttr(node.stroke ?? "#111827")}" /></marker></defs>`
            : "";
        return `${defs}<line x1="${x + start.x}" y1="${y + start.y}" x2="${x + end.x}" y2="${y + end.y}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 3}" stroke-linecap="round"${node.type === "arrow" ? ` marker-end="url(#${markerId})"` : ""}${transform} />`;
      }
      if (node.type === "ellipse") {
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${escapeAttr(node.fill ?? "#f8fafc")}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 2}"${transform} />`;
      }
      if (node.type === "polygon") {
        return `<polygon points="${createPolygonPoints(node.points, w, h)
          .split(" ")
          .map((point) => {
            const [px, py] = point.split(",").map(Number);
            return `${x + (px ?? 0)},${y + (py ?? 0)}`;
          })
          .join(
            " ",
          )}" fill="${escapeAttr(node.fill ?? "#f8fafc")}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 2}"${transform} />`;
      }
      if (node.type === "path") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${node.bounds.width} ${node.bounds.height}" overflow="visible"${transform}><path d="${escapeAttr(node.d)}" fill="${escapeAttr(node.fill ?? "none")}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 3}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
      }
      if (node.type === "icon") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 24 24"${transform}><path d="M12 3 10.3 8.3 5 10l5.3 1.7L12 17l1.7-5.3L19 10l-5.3-1.7L12 3Z" fill="${escapeAttr(node.fill ?? "none")}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 1.8}" stroke-linejoin="round" /></svg>`;
      }
      const fill =
        node.type === "container"
          ? (node.style?.fill ?? "rgba(255,255,255,.78)")
          : node.type === "rect"
            ? (node.fill ?? "#d3f256")
            : "#111827";
      const stroke =
        node.type === "container"
          ? (node.style?.stroke ?? "#6c5ce7")
          : node.type === "rect"
            ? (node.stroke ?? "#111827")
            : "none";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="2"${transform} />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeAttr(doc.viewport.backgroundColor)}"/>${nodes}</svg>`;
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
