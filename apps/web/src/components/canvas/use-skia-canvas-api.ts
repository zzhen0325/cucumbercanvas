"use client";

import {
  type AgentBinding,
  type CanvasAsset,
  type CucumberCanvasDocument,
  addCanvasPage,
  applyCanvasOperation,
  applyCanvasTransaction,
  copyCanvasSelection,
  createAgentInputNode,
  createNodeId,
  deleteCanvasPage,
  detachConnectorEndpoint as detachConnectorEndpointBinding,
  duplicateCanvasNodes,
  duplicateCanvasPage,
  findNode,
  getActiveChildren,
  getCanvasPages,
  getNodeBounds,
  pasteCanvasClipboard,
  renameCanvasPage,
  reorderCanvasPage,
  resolveActivePageId,
} from "@cucumber/canvas-core";
import {
  type BooleanOpType,
  executeBooleanOp,
  getBooleanOpRejectionReason,
} from "@cucumber/pen-core";
import type { PenRenderer } from "@cucumber/pen-renderer";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import type React from "react";
import { useCallback, useMemo } from "react";

import type { useToast } from "@/components/toast";
import type {
  CanvasApi,
  CanvasApiDocument,
  CanvasDocumentPatch,
  CanvasSceneElement,
  CanvasTool,
} from "./canvas-api";
import { normalizeRuntimeDocumentForCanvasSet } from "./canvas-document-boundary";
import {
  createFrameNode,
  createLineNode,
  createSectionFrameNode,
} from "./canvas-draw-geometry";
import { exportDocumentImage } from "./canvas-export";
import { createLegacyShapeNode } from "./canvas-legacy-shape-node";
import { getDefaultCanvasNodeBounds } from "./canvas-node-placement";
import {
  type CanvasRuntimeCommitResult,
  type CanvasRuntimeStore,
  getCanvasApiDocument,
  selectCanvasCanRedo,
  selectCanvasCanUndo,
} from "./canvas-runtime-store";
import {
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
import { assertPositiveFiniteZoom } from "./skia-canvas-constants";
import type { MutableRef } from "./skia-canvas-types";
import {
  STICKY_NOTE_DEFAULT_HEIGHT,
  STICKY_NOTE_DEFAULT_WIDTH,
  createStickyNoteNode,
} from "./sticky-note-tool";
import { useCanvasImportActions } from "./use-canvas-import-actions";

type BooleanRuntimeStatus = "loading" | "ready" | "failed";

type UseSkiaCanvasApiOptions = {
  accessToken?: string;
  activePageIdRef: MutableRef<string>;
  activeToolRef: MutableRef<CanvasTool>;
  booleanRuntimeStatus: BooleanRuntimeStatus;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  clipboardRef: MutableRef<
    import("@cucumber/canvas-core").CanvasClipboardData | null
  >;
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  docRef: MutableRef<CanvasApiDocument>;
  documentVersionRef: MutableRef<number>;
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
  listenersRef: MutableRef<Set<import("./canvas-api").CanvasChangeListener>>;
  onSelectionChange?: (elements: CanvasSceneElement[]) => void;
  projectId?: string;
  rendererRef: MutableRef<PenRenderer | null>;
  runtimeStore: CanvasRuntimeStore;
  scheduleRendererIdle: (delayMs?: number) => void;
  sceneSnapshotCacheKeyRef: MutableRef<string>;
  sceneSnapshotRef: MutableRef<CanvasSceneSnapshot>;
  selectedIdsRef: MutableRef<string[]>;
  setActiveTool: (tool: CanvasTool) => void;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
  syncCommittedDocumentToRenderer: (
    commit: CanvasRuntimeCommitResult,
    reason: string,
  ) => void;
  toast: ReturnType<typeof useToast>;
};

export function useSkiaCanvasApi({
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
}: UseSkiaCanvasApiOptions) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createContainer = useCallback(
    (opts?: {
      name?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }) => {
      const id = createNodeId("container");
      const placement = getLiveViewportPlacement();
      const defaultB = getDefaultCanvasNodeBounds(
        docRef.current,
        "container",
        null,
        placement.viewport,
        placement.rect,
      );
      const b = {
        x: opts?.x ?? defaultB.x,
        y: opts?.y ?? defaultB.y,
        width: opts?.width ?? defaultB.width,
        height: opts?.height ?? defaultB.height,
      };
      const container = createFrameNode(id, b, opts?.name ?? "New container");
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
    [commitDocument, getLiveViewportPlacement, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createSection = useCallback(
    (opts?: {
      name?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }) => {
      const id = createNodeId("section");
      const placement = getLiveViewportPlacement();
      const defaultB = getDefaultCanvasNodeBounds(
        docRef.current,
        "section",
        null,
        placement.viewport,
        placement.rect,
      );
      const bounds = {
        x: opts?.x ?? defaultB.x,
        y: opts?.y ?? defaultB.y,
        width: opts?.width ?? 640,
        height: opts?.height ?? 420,
      };
      const section = createSectionFrameNode(
        id,
        bounds,
        opts?.name ?? "Section",
      );
      const next = applyCanvasOperation(docRef.current, {
        type: "insertNode",
        node: section,
        activePageId: activePageIdRef.current,
      });
      commitDocument(next, { selection: [id] });
      setSelection([id], { notifyScene: false });
      console.info("[skia-canvas] section.created", { sectionId: id });
      return section;
    },
    [commitDocument, getLiveViewportPlacement, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createSticky = useCallback(
    (opts?: {
      text?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }) => {
      const placement = getLiveViewportPlacement();
      const defaultB = getDefaultCanvasNodeBounds(
        docRef.current,
        "sticky",
        null,
        placement.viewport,
        placement.rect,
      );
      const bounds = {
        x: opts?.x ?? defaultB.x,
        y: opts?.y ?? defaultB.y,
        width: opts?.width ?? STICKY_NOTE_DEFAULT_WIDTH,
        height: opts?.height ?? STICKY_NOTE_DEFAULT_HEIGHT,
      };
      const sticky = createStickyNoteNode(bounds, opts?.text);
      const next = applyCanvasOperation(docRef.current, {
        type: "insertNode",
        node: sticky,
        activePageId: activePageIdRef.current,
      });
      commitDocument(next, { selection: [sticky.id] });
      setSelection([sticky.id], { notifyScene: false });
      console.info("[skia-canvas] sticky.created", { stickyId: sticky.id });
      return sticky;
    },
    [commitDocument, getLiveViewportPlacement, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createAgentInputNodeOnCanvas = useCallback(
    (opts?: {
      text?: string;
      x?: number;
      y?: number;
      width?: number;
    }) => {
      const placement = getLiveViewportPlacement();
      const defaultB = getDefaultCanvasNodeBounds(
        docRef.current,
        "container",
        null,
        placement.viewport,
        placement.rect,
      );
      const node = createAgentInputNode({
        ...(opts?.text ? { text: opts.text } : {}),
        ...(typeof opts?.width === "number" ? { width: opts.width } : {}),
        x: opts?.x ?? defaultB.x,
        y: opts?.y ?? defaultB.y,
      });
      const next = applyCanvasOperation(docRef.current, {
        type: "insertNode",
        node,
        activePageId: activePageIdRef.current,
      });
      commitDocument(next, { selection: [node.id] });
      setSelection([node.id], { notifyScene: false });
      console.info("[skia-canvas] agent_input_node.created", {
        nodeId: node.id,
      });
      return node;
    },
    [commitDocument, getLiveViewportPlacement, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createConnector = useCallback(
    (opts: {
      start: { x: number; y: number };
      end: { x: number; y: number };
      arrow?: boolean;
    }) => {
      const startSnap = getConnectorSnap(opts.start);
      const endSnap = getConnectorSnap(opts.end, {
        excludeNodeIds: startSnap ? [startSnap.nodeId] : undefined,
      });
      const connector =
        startSnap || endSnap
          ? {
              ...(startSnap
                ? {
                    start: {
                      nodeId: startSnap.nodeId,
                      side: startSnap.side,
                      ratio: startSnap.ratio,
                    },
                  }
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
              arrow: opts.arrow,
            }
          : undefined;
      const node = createLineNode(
        opts.arrow ? "arrow" : "line",
        startSnap?.point ?? opts.start,
        endSnap?.point ?? opts.end,
        connector,
      );
      const next = applyCanvasOperation(docRef.current, {
        type: "insertNode",
        node,
        activePageId: activePageIdRef.current,
      });
      commitDocument(next, { selection: [node.id] });
      setSelection([node.id], { notifyScene: false });
      console.info("[skia-canvas] connector.created", {
        connectorId: node.id,
        attached: Boolean(connector?.start || connector?.end),
      });
      return node;
    },
    [commitDocument, getConnectorSnap, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const createShapeNode = useCallback(
    (shapeType: string, cx: number, cy: number) => {
      const node = createLegacyShapeNode(shapeType, cx, cy);

      const next = applyCanvasOperation(docRef.current, {
        type: "insertNode",
        node,
        activePageId: activePageIdRef.current,
      });
      commitDocument(next, { selection: [node.id] });
      setSelection([node.id], { notifyScene: false });
    },
    [commitDocument, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const notifySelectionForDoc = useCallback(
    (nextDoc: PenDocument, nodeIds: string[]) => {
      const activePageId = activePageIdRef.current;
      const snapshot = buildCanvasSceneSnapshot(
        nextDoc,
        activePageId,
        nodeIds,
        rendererRef.current?.getViewport(),
      );
      sceneSnapshotRef.current = snapshot;
      sceneSnapshotCacheKeyRef.current = getSceneSnapshotCacheKey(
        documentVersionRef.current,
        activePageId,
        nodeIds,
        rendererRef.current?.getViewport(),
      );
      onSelectionChange?.(
        nodeIds
          .map((id) => snapshot.index.elementById.get(id))
          .filter((element): element is CanvasSceneElement => Boolean(element)),
      );
    },
    [onSelectionChange],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const copySelection = useCallback(() => {
    const currentSelection = selectedIdsRef.current;
    if (currentSelection.length === 0) return false;
    const activePageId = activePageIdRef.current;
    const topSelection = getTopLevelSelectionIds(
      docRef.current as CucumberCanvasDocument,
      currentSelection,
      activePageId,
    );
    clipboardRef.current = copyCanvasSelection(docRef.current, topSelection);
    console.info("[skia-canvas] selection.copied", {
      count: clipboardRef.current.nodes.length,
    });
    return true;
  }, []);
  const deleteSelection = useCallback(() => {
    const state = runtimeStore.getState();
    const activePageId = state.activePageId;
    const currentDocument = state.document;
    const currentSelection = state.selection;
    const ids = getTopLevelSelectionIds(
      currentDocument as CucumberCanvasDocument,
      currentSelection,
      activePageId,
    );
    if (ids.length === 0) return;
    const operations = ids.map(
      (nodeId) =>
        ({
          type: "deleteNode",
          nodeId,
          activePageId,
        }) as const,
    );
    const next = applyCanvasTransaction(currentDocument, operations, {
      activePageId,
    }).doc;
    commitDocument(next, { selection: [] });
    setSelection([], { notifyScene: false });
    console.info("[skia-canvas] selection.deleted", {
      activePageId,
      count: ids.length,
      nodeIds: ids,
    });
  }, [commitDocument, runtimeStore, setSelection]);
  const cutSelection = useCallback(() => {
    if (copySelection()) {
      deleteSelection();
    }
  }, [copySelection, deleteSelection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard) return [];
    const currentSelection = selectedIdsRef.current;
    const parentId = getPrimarySelectedContainerId(
      docRef.current as CucumberCanvasDocument,
      currentSelection,
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
  }, [commitDocument, notifySelectionForDoc, setSelection]);

  const {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    importSvgMarkup,
    isFileDragActive,
    pasteFromSystemClipboard,
  } = useCanvasImportActions({
    accessToken,
    activePageIdRef,
    commitDocument,
    docRef,
    getLiveViewportPlacement,
    getPointerScenePoint,
    notifySelectionForDoc,
    projectId,
    rendererRef,
    selectedIdsRef,
    setSelection,
    toast,
    onCreateAgentInputNode: createAgentInputNodeOnCanvas,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const duplicateSelection = useCallback(() => {
    const currentSelection = selectedIdsRef.current;
    if (currentSelection.length === 0) return [];
    const activePageId = activePageIdRef.current;
    const topSelection = getTopLevelSelectionIds(
      docRef.current as CucumberCanvasDocument,
      currentSelection,
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
  }, [commitDocument, notifySelectionForDoc, setSelection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
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
        selectedIdsRef.current,
        activePageIdRef.current,
      );
      const placement = getLiveViewportPlacement();
      const b = getDefaultCanvasNodeBounds(
        docRef.current,
        "image",
        targetContainerId,
        placement.viewport,
        placement.rect,
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
            ...getCanvasApiRuntimeState(docRef.current).assets,
            [assetId]: asset,
          },
        } as CanvasApiDocument,
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
    [commitDocument, getLiveViewportPlacement, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const getActivePageId = useCallback(() => activePageIdRef.current, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const getPages = useCallback(() => getCanvasPages(docRef.current), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const addPage = useCallback(
    (name?: string) => {
      const result = addCanvasPage(docRef.current, { name });
      commitDocument({
        ...result.document,
        activePageId: result.page.id,
        selection: [],
      } as CanvasApiDocument);
      console.info("[skia-canvas] page.added", {
        pageId: result.page.id,
        name: result.page.name,
        activePageId: result.page.id,
      });
      return result.page.id;
    },
    [commitDocument],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const duplicatePage = useCallback(
    (pageId: string) => {
      const result = duplicateCanvasPage(docRef.current, pageId);
      commitDocument({
        ...result.document,
        activePageId: result.page.id,
        selection: [],
      } as CanvasApiDocument);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const deletePage = useCallback(
    (pageId: string) => {
      const result = deleteCanvasPage(docRef.current, pageId);
      const activePageId = resolveActivePageId(result.document);
      const nextSelection = filterSelectionForActivePage(
        result.document,
        getDocumentSelection(docRef.current, selectedIdsRef.current),
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
    [commitDocument, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
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
            selectedIds: getDocumentSelection(
              docRef.current,
              selectedIdsRef.current,
            ),
            reason,
          });
          return null;
        }
        const activePageId = resolveActivePageId(docRef.current);
        const currentSelection = getDocumentSelection(
          docRef.current,
          selectedIdsRef.current,
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

        const activeChildren = getActiveChildren(docRef.current, activePageId);
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

        let next: PenDocument = docRef.current;
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
        } as CanvasApiDocument;
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
          selectedIds: getDocumentSelection(
            docRef.current,
            selectedIdsRef.current,
          ),
          error,
        });
        return null;
      }
    },
    [booleanRuntimeStatus, commitDocument, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const applyDocumentPatch = useCallback(
    (patch: CanvasDocumentPatch) => {
      const currentVersion = documentVersionRef.current;
      if (patch.baseVersion !== currentVersion) {
        console.warn("[skia-canvas] document.patch.rejected", {
          baseVersion: patch.baseVersion,
          currentVersion,
          operationCount: patch.operations.length,
          transactionId: patch.transactionId,
          reason: "version_mismatch",
        });
        throw new Error(
          `Canvas patch version mismatch. The live document is at version ${currentVersion}, but the patch was based on version ${patch.baseVersion}. Refresh the live canvas state and retry.`,
        );
      }
      const activePageId = activePageIdRef.current;
      const result = applyCanvasTransaction(docRef.current, patch.operations, {
        activePageId,
        transactionId: patch.transactionId,
      });
      const commit = commitDocument(result.doc, { selection: patch.selection });
      syncCommittedDocumentToRenderer(commit, "rpc.document.patch");
      console.info("[skia-canvas] document.patch.applied", {
        activePageId,
        nextVersion: documentVersionRef.current,
        operationCount: patch.operations.length,
        transactionId: patch.transactionId,
      });
      return documentVersionRef.current;
    },
    [commitDocument, syncCommittedDocumentToRenderer],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const getCurrentSceneSnapshot = useCallback(() => {
    const viewport = rendererRef.current?.getViewport();
    const cacheKey = getSceneSnapshotCacheKey(
      documentVersionRef.current,
      activePageIdRef.current,
      selectedIdsRef.current,
      viewport,
    );
    if (sceneSnapshotCacheKeyRef.current === cacheKey) {
      return sceneSnapshotRef.current;
    }
    const snapshot = buildCanvasSceneSnapshot(
      docRef.current,
      activePageIdRef.current,
      selectedIdsRef.current,
      viewport,
    );
    sceneSnapshotRef.current = snapshot;
    sceneSnapshotCacheKeyRef.current = cacheKey;
    return snapshot;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const api = useMemo<CanvasApi>(
    () => ({
      getDocument: () => getCanvasApiDocument(runtimeStore.getState()),
      getDocumentVersion: () => documentVersionRef.current,
      applyDocumentPatch,
      setDocument: (
        raw: unknown,
        opts?: {
          captureHistory?: boolean;
          notify?: boolean;
          preserveViewport?: boolean;
          syncRenderer?: "immediate";
        },
      ) => {
        const next = normalizeRuntimeDocumentForCanvasSet(raw);
        const commit = commitDocument(next, {
          captureHistory: opts?.captureHistory ?? false,
          notify: opts?.notify,
        });
        if (opts?.syncRenderer === "immediate") {
          syncCommittedDocumentToRenderer(commit, "rpc.document.set");
        }
        if (!opts?.preserveViewport) {
          rendererRef.current?.zoomToFit(64);
          const viewport = rendererRef.current?.getViewport();
          if (viewport) {
            runtimeStore.getState().setViewportSnapshot({
              x: viewport.panX,
              y: viewport.panY,
              zoom: viewport.zoom,
            });
          }
        }
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
      getActiveTool: () => activeToolRef.current,
      setActiveTool: (tool) => setActiveTool(tool),
      createContainer,
      createSection,
      createSticky,
      createAgentInputNode: createAgentInputNodeOnCanvas,
      createConnector,
      detachConnectorEndpoint: (nodeId, endpoint) => {
        const node = findNode(docRef.current, nodeId, activePageIdRef.current);
        if (!node || node.type !== "line") return;
        const nextNode = detachConnectorEndpointBinding(node, endpoint);
        const next = applyCanvasOperation(docRef.current, {
          type: "updateNode",
          nodeId,
          updates: { connector: nextNode.connector } as Partial<PenNode>,
          activePageId: activePageIdRef.current,
        });
        commitDocument(next, { selection: [nodeId] });
        console.info("[skia-canvas] connector.endpoint.detached", {
          nodeId,
          endpoint,
        });
      },
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
              getCanvasApiDocument(runtimeStore.getState()).viewport
                ?.backgroundColor ?? "#F0F0F0",
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
      getSceneElements: () => getCurrentSceneSnapshot().index.elements,
      getFiles: () => getCurrentSceneSnapshot().files,
      getAppState: () => {
        const currentDocument = getCanvasApiDocument(runtimeStore.getState());
        return toAppState(
          currentDocument,
          filterSelectionForActivePage(
            currentDocument,
            getDocumentSelection(currentDocument, selectedIdsRef.current),
            activePageIdRef.current,
          ),
          rendererRef.current?.getViewport(),
        );
      },
      updateScene: (scene) => {
        if (scene.appState) {
          const state = scene.appState;
          const renderer = rendererRef.current;
          const viewportPatch: {
            x?: number;
            y?: number;
            zoom?: number;
            backgroundColor?: string;
          } = {};
          let viewportChanged = false;

          if (renderer && state.zoom) {
            const vp = renderer.getViewport();
            const nextZoom = state.zoom.value;
            assertPositiveFiniteZoom(nextZoom);
            let nextPanX = state.scrollX ?? vp.panX;
            let nextPanY = state.scrollY ?? vp.panY;

            if (state.scrollX === undefined || state.scrollY === undefined) {
              const rect = canvasContainerRef.current?.getBoundingClientRect();
              if (rect) {
                const centerSceneX = (rect.width / 2 - vp.panX) / vp.zoom;
                const centerSceneY = (rect.height / 2 - vp.panY) / vp.zoom;
                if (state.scrollX === undefined) {
                  nextPanX = rect.width / 2 - centerSceneX * nextZoom;
                }
                if (state.scrollY === undefined) {
                  nextPanY = rect.height / 2 - centerSceneY * nextZoom;
                }
              }
            }

            renderer.setInteractionMode("viewport");
            renderer.setViewport(nextZoom, nextPanX, nextPanY);
            const viewport = renderer.getViewport();
            viewportChanged = true;
            viewportPatch.x = viewport.panX;
            viewportPatch.y = viewport.panY;
            viewportPatch.zoom = viewport.zoom;
          } else if (
            renderer &&
            (state.scrollX !== undefined || state.scrollY !== undefined)
          ) {
            const vp = renderer.getViewport();
            const nextPanX = state.scrollX ?? vp.panX;
            const nextPanY = state.scrollY ?? vp.panY;
            renderer.setInteractionMode("viewport");
            renderer.setViewport(vp.zoom, nextPanX, nextPanY);
            viewportChanged = true;
            viewportPatch.x = nextPanX;
            viewportPatch.y = nextPanY;
            viewportPatch.zoom = vp.zoom;
          }

          if (typeof state.viewBackgroundColor === "string") {
            renderer?.setBackgroundColor(state.viewBackgroundColor);
            viewportPatch.backgroundColor = state.viewBackgroundColor;
          }

          if (Object.keys(viewportPatch).length > 0) {
            runtimeStore.getState().setViewportSnapshot(viewportPatch);
            console.info("[skia-canvas] app-state.updated", {
              hasBackgroundColor: typeof state.viewBackgroundColor === "string",
              hasScroll:
                state.scrollX !== undefined || state.scrollY !== undefined,
              hasZoom: Boolean(state.zoom),
              zoom: viewportPatch.zoom,
            });
          }

          if (viewportChanged) {
            scheduleRendererIdle();
          }
        }
      },
      addFiles: (incoming) => {
        const assets = {
          ...getCanvasApiRuntimeState(docRef.current).assets,
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
        commitDocument({ ...docRef.current, assets } as CanvasApiDocument);
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
        const viewport = rendererRef.current?.getViewport();
        if (viewport) {
          runtimeStore.getState().setViewportSnapshot({
            x: viewport.panX,
            y: viewport.panY,
            zoom: viewport.zoom,
          });
        }
      },
      undo: () => {
        runtimeStore.getState().undo();
      },
      redo: () => {
        runtimeStore.getState().redo();
      },
      canUndo: () => selectCanvasCanUndo(runtimeStore.getState()),
      canRedo: () => selectCanvasCanRedo(runtimeStore.getState()),
      copySelection,
      pasteClipboard,
      duplicateSelection,
      deleteSelection,
      groupSelection: () => {
        const topSelection = getTopLevelSelectionIds(
          docRef.current as CucumberCanvasDocument,
          selectedIdsRef.current,
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
        const groupIds = selectedIdsRef.current.filter((id) => {
          const node = findNode(docRef.current, id, activePageIdRef.current);
          return node && node.type === "group";
        });
        if (groupIds.length === 0) return [];
        let nextDoc: PenDocument = docRef.current;
        const ungrouped: string[] = [];
        for (const gid of groupIds) {
          const group = findNode(nextDoc, gid, activePageIdRef.current);
          if (!group || group.type !== "group") continue;
          const childIds = hasPenChildren(group)
            ? group.children.map((child) => child.id)
            : [];
          try {
            nextDoc = applyCanvasOperation(nextDoc, {
              type: "ungroupNode",
              groupId: gid,
              activePageId: activePageIdRef.current,
            });
            ungrouped.push(...childIds);
          } catch (e) {
            console.warn("[skia-canvas] selection.ungroup.failed", e);
          }
        }
        commitDocument(nextDoc, { selection: ungrouped });
        setSelection(ungrouped, { notifyScene: false });
        return ungrouped;
      },
      alignSelection: (alignment) => {
        const doc = docRef.current;
        const activePageId = activePageIdRef.current;
        const nodes = selectedIdsRef.current
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
        const operations: Array<{
          type: "updateNode";
          nodeId: string;
          updates: Partial<PenNode>;
          activePageId: string;
        }> = [];
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
            operations.push({
              type: "updateNode",
              nodeId: n.id,
              updates: update as Partial<PenNode>,
              activePageId,
            });
          }
        }
        if (operations.length === 0) return;
        const result = applyCanvasTransaction(docRef.current, operations, {
          activePageId,
        });
        commitDocument(result.doc);
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
      insertImageArtifact: (artifact) => insertImageNode(artifact, "generated"),
      insertVideoArtifact: (artifact) => {
        const id = createNodeId("videoEmbed");
        const placement = getLiveViewportPlacement();
        const b = getDefaultCanvasNodeBounds(
          docRef.current,
          "videoEmbed",
          null,
          placement.viewport,
          placement.rect,
        );
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
      addPage,
      applyBooleanOperation,
      applyDocumentPatch,
      commitDocument,
      copySelection,
      createContainer,
      createConnector,
      createSection,
      createSticky,
      deletePage,
      deleteSelection,
      duplicatePage,
      duplicateSelection,
      getActivePageId,
      getCurrentSceneSnapshot,
      getLiveViewportPlacement,
      getPages,
      importSvgMarkup,
      insertImageNode,
      pasteClipboard,
      pasteFromSystemClipboard,
      renamePage,
      reorderPage,
      runtimeStore,
      setActivePage,
      setActiveTool,
      setSelection,
      scheduleRendererIdle,
      syncCommittedDocumentToRenderer,
    ],
  );

  return {
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
  };
}
