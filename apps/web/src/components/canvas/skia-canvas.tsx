"use client";

import {
  type AgentBinding,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasClipboardData,
  type CanvasImportResult,
  type ClipboardImportPayload,
  type CucumberCanvasDocument,
  type ImportNode,
  addCanvasPage,
  applyCanvasOperation,
  applyCanvasTransaction,
  copyCanvasSelection,
  createNodeId,
  deleteCanvasPage,
  duplicateCanvasNodes,
  duplicateCanvasPage,
  findNode,
  getActiveChildren,
  getCanvasImportBounds,
  getCanvasPages,
  getNodeBounds,
  getNodeSceneBounds,
  getOrderedCanvasNodes,
  insertCanvasImportResult,
  isDescendantOf,
  normalizeCanvasPages,
  parseClipboardImport,
  pasteCanvasClipboard,
  renameCanvasPage,
  reorderCanvasPage,
  reparentNodesByDropPoint,
  resolveActivePageId,
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
  type ViewportState,
  loadCanvasKit,
  sceneToCanvasLocal,
  screenToScene,
} from "@cucumber/pen-renderer";
import type { ContainerRole, PenDocument, PenNode } from "@cucumber/pen-types";
import type { CanvasKit } from "canvaskit-wasm";
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
import { CanvasBooleanToolbar } from "./boolean-toolbar";
import type {
  AlignMode,
  CanvasApi,
  CanvasApiDocument,
  CanvasApiRuntimeState,
  CanvasAppState,
  CanvasChangeListener,
  CanvasDocumentPatch,
  CanvasFileRecord,
  CanvasSceneElement,
  CanvasTool,
} from "./canvas-api";
import { exportDocumentImage } from "./canvas-export";
import { bakePenAnchorsToPathData, usePenTool } from "./canvas-pen-tool";
import {
  type CanvasRuntimeStore,
  CanvasRuntimeStoreProvider,
  createCanvasRuntimeStore,
  getCanvasApiDocument,
  selectCanvasActiveTool,
  selectCanvasBooleanInputState,
  selectCanvasCanRedo,
  selectCanvasCanUndo,
  selectCanvasPageTabsState,
  selectCanvasSelectedNodePanelState,
  selectCanvasToolbarState,
  useCanvasRuntimeShallowSelector,
  useCanvasRuntimeStoreApi,
} from "./canvas-runtime-store";
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
  readDataTransferImportPayloads,
  useCanvasClipboardImport,
} from "./use-canvas-clipboard-import";
import { useCanvasKeyboardShortcuts } from "./use-canvas-keyboard-shortcuts";

// ---------------------------------------------------------------------------
// Helpers to bridge the public CanvasApi summaries with PenDocument nodes.
// ---------------------------------------------------------------------------

function toSceneElement(
  node: PenNode,
  depth = 0,
  parentId: string | null = null,
  sceneBounds?: CanvasBounds,
): CanvasSceneElement {
  const b = sceneBounds ?? getNodeBounds(node);
  const nodeRecord = node as unknown as Record<string, unknown>;
  const meta = nodeRecord.meta as Record<string, unknown> | undefined;
  const customData = {
    ...(meta ?? {}),
    ...(parentId ? { containerId: parentId } : {}),
  };
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
    depth,
    customData,
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
  const elements: CanvasSceneElement[] = [];
  const walk = (nodes: PenNode[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      if (node.visible !== false) {
        elements.push(
          toSceneElement(
            node,
            depth,
            parentId,
            getNodeSceneBounds(doc, node.id, activePageId) ?? undefined,
          ),
        );
      }
      if ("children" in node && Array.isArray(node.children)) {
        walk(node.children as PenNode[], depth + 1, node.id);
      }
    }
  };
  walk(getActiveChildren(doc, activePageId), 0, null);
  return elements;
}

function toAppState(
  doc: PenDocument,
  selection?: string[],
  viewportOverride?: ViewportState,
): CanvasAppState {
  const runtimeState = getCanvasApiRuntimeState(doc, selection);
  const { viewport } = runtimeState;
  return {
    zoom: { value: viewportOverride?.zoom ?? viewport?.zoom ?? 1 },
    scrollX: viewportOverride?.panX ?? viewport?.x ?? 0,
    scrollY: viewportOverride?.panY ?? viewport?.y ?? 0,
    viewBackgroundColor: viewport?.backgroundColor ?? "#ffffff",
    selectedElementIds: Object.fromEntries(
      runtimeState.selection.map((id: string) => [id, true]),
    ),
  };
}

function toFiles(doc: PenDocument): Record<string, CanvasFileRecord> {
  const { assets } = getCanvasApiRuntimeState(doc);
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
  parentId?: string | null,
  viewport?: ViewportState | null,
  viewportRect?: Pick<DOMRect, "width" | "height"> | null,
): CanvasBounds {
  const vp = getCanvasApiRuntimeState(doc).viewport;
  const width = 300;
  const height = 200;
  const sceneCenter =
    viewport && viewportRect
      ? {
          x: ((viewportRect.width ?? 0) / 2 - viewport.panX) / viewport.zoom,
          y: ((viewportRect.height ?? 0) / 2 - viewport.panY) / viewport.zoom,
        }
      : {
          x: -((vp.x ?? 0) / (vp.zoom ?? 1)) + 200,
          y: -((vp.y ?? 0) / (vp.zoom ?? 1)) + 200,
        };
  const sceneBounds = {
    x: sceneCenter.x - width / 2,
    y: sceneCenter.y - height / 2,
    width,
    height,
  };
  if (!parentId) return sceneBounds;

  const parentBounds = getNodeSceneBounds(doc, parentId);
  if (!parentBounds) {
    throw new Error(
      `Cannot place node because parent ${parentId} was not found.`,
    );
  }
  return {
    ...sceneBounds,
    x: sceneBounds.x - parentBounds.x,
    y: sceneBounds.y - parentBounds.y,
  };
}

function normalizePenDocument(raw: unknown): PenDocument {
  if (raw && typeof raw === "object" && "version" in raw) {
    return raw as PenDocument;
  }
  return createEmptyDocument();
}

function normalizeRuntimeDocument(raw: unknown): PenDocument {
  return normalizeCanvasPages(normalizePenDocument(raw));
}

function normalizeRuntimeDocumentForCanvasSet(raw: unknown): PenDocument {
  return normalizeRuntimeDocument(raw);
}

function syncRendererDocument(
  renderer: PenRenderer | null,
  doc: PenDocument,
  activePageId: string,
) {
  if (!renderer) return;
  renderer.setDocument(doc, activePageId);
}

type PendingRendererDocumentSync = {
  activePageId: string;
  coalescedCount: number;
  deferredForDrag: boolean;
  document: PenDocument;
  source: string;
  version: number;
};

type DrawableShapeTool = "rect" | "ellipse" | "polygon";
type DrawableCanvasTool = DrawableShapeTool | "container" | "line" | "arrow";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const MIN_DRAW_SIZE = 2;
const MOVE_COMMIT_THRESHOLD_PX = 2;
const TEXT_DRAG_THRESHOLD_PX = 4;
const CANVAS_SELECTION_COLOR = "#37BFF9";
const DEFAULT_RECT_FILL = "#d3f256";
const DEFAULT_SHAPE_FILL = "#f8fafc";
const DEFAULT_TEXT_FONT_SIZE = 28;
const DEFAULT_TEXT_LINE_HEIGHT = 1.4;
const DEFAULT_TEXT_FONT_FAMILY =
  'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
const MIN_TEXT_BOX_SIZE = 8;
const KEYBOARD_ZOOM_STEP = 1.1;
const KEYBOARD_ZOOM_MIN = 0.1;
const KEYBOARD_ZOOM_MAX = 30;

type TextEditState = {
  nodeId: string;
  isNew: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  initialContent: string;
  textGrowth: "auto" | "fixed-width" | "fixed-width-height";
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: React.CSSProperties["textAlign"];
  color: string;
  lineHeight: number | string;
};

function getCanvasApiRuntimeState(
  doc: PenDocument,
  fallbackSelection: readonly string[] = [],
): CanvasApiRuntimeState {
  const document = doc as CanvasApiDocument;
  return {
    document,
    selection: document.selection ?? [...fallbackSelection],
    assets: document.assets ?? {},
    viewport: document.viewport ?? {
      x: 0,
      y: 0,
      zoom: 1,
      backgroundColor: "#ffffff",
    },
  };
}

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
  return getCanvasApiRuntimeState(doc, fallbackSelection).selection;
}

function filterSelectionForActivePage(
  doc: PenDocument,
  selection: string[],
  activePageId?: string | null,
): string[] {
  return selection.filter((id) => Boolean(findNode(doc, id, activePageId)));
}

function areStringArraysEqual(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function projectTextEditStateToViewport(
  editingText: TextEditState,
  viewport: { zoom: number; panX: number; panY: number },
) {
  const local = sceneToCanvasLocal(editingText.x, editingText.y, viewport);
  return {
    left: local.x,
    top: local.y,
    width: Math.max(editingText.width * viewport.zoom, 1),
    height: Math.max(editingText.height * viewport.zoom, 1),
    fontSize: Math.max(editingText.fontSize * viewport.zoom, 1),
  };
}

function cssFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("'") || trimmed.startsWith('"')) {
        return trimmed;
      }
      return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
    })
    .join(", ");
}

function getTextMeasureContext() {
  if (typeof document === "undefined") return null;
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("jsdom")
  ) {
    return null;
  }
  const canvas = document.createElement("canvas");
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

function getLineHeightPx(
  lineHeight: number | string | undefined,
  fontSize: number,
): number {
  if (typeof lineHeight === "number") {
    return lineHeight <= 4 ? lineHeight * fontSize : lineHeight;
  }
  if (typeof lineHeight === "string") {
    const parsed = Number.parseFloat(lineHeight);
    if (Number.isFinite(parsed)) {
      return lineHeight.endsWith("px") ? parsed : parsed * fontSize;
    }
  }
  return DEFAULT_TEXT_LINE_HEIGHT * fontSize;
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D | null,
  text: string,
  fontSize: number,
): number {
  if (ctx) return ctx.measureText(text).width;
  return text.length * fontSize * 0.56;
}

function wrapTextLine(
  ctx: CanvasRenderingContext2D | null,
  line: string,
  width: number,
  fontSize: number,
  output: string[],
) {
  if (!line) {
    output.push("");
    return;
  }
  let current = "";
  for (const char of Array.from(line)) {
    const candidate = `${current}${char}`;
    if (
      current &&
      measureTextWidth(ctx, candidate, fontSize) > Math.max(width, 1)
    ) {
      output.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  output.push(current);
}

function measureTextLayout(options: {
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  lineHeight: number | string;
  textGrowth: "auto" | "fixed-width" | "fixed-width-height";
  width: number;
  height: number;
}) {
  const ctx = getTextMeasureContext();
  if (ctx) {
    ctx.font = `${options.fontWeight} ${options.fontSize}px ${cssFontFamily(
      options.fontFamily,
    )}`;
  }
  const lineHeightPx = getLineHeightPx(options.lineHeight, options.fontSize);
  const rawLines = options.content.split("\n");
  const lines = rawLines.length > 0 ? rawLines : [""];

  if (options.textGrowth === "fixed-width-height") {
    return {
      width: Math.max(options.width, MIN_TEXT_BOX_SIZE),
      height: Math.max(options.height, MIN_TEXT_BOX_SIZE),
    };
  }

  if (options.textGrowth === "fixed-width") {
    const wrappedLines: string[] = [];
    for (const line of lines) {
      wrapTextLine(
        ctx,
        line,
        Math.max(options.width, MIN_TEXT_BOX_SIZE),
        options.fontSize,
        wrappedLines,
      );
    }
    return {
      width: Math.max(options.width, MIN_TEXT_BOX_SIZE),
      height: Math.max(wrappedLines.length, 1) * lineHeightPx,
    };
  }

  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(
      maxWidth,
      measureTextWidth(ctx, line, options.fontSize),
    );
  }
  return {
    width: Math.max(maxWidth + 2, MIN_TEXT_BOX_SIZE),
    height: Math.max(lines.length, 1) * lineHeightPx,
  };
}

function getTextContent(node: PenNode): string {
  const record = node as unknown as Record<string, unknown>;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((segment) =>
        segment && typeof segment === "object" && "text" in segment
          ? String((segment as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

function getFirstSolidFillColor(node: PenNode, fallback = "#111827"): string {
  const fills = (node as { fill?: Array<{ type?: string; color?: string }> })
    .fill;
  const first = Array.isArray(fills) ? fills[0] : undefined;
  return first?.type === "solid" && typeof first.color === "string"
    ? first.color
    : fallback;
}

function createCanvasApiFacade(getLiveApi: () => CanvasApi): CanvasApi {
  return {
    getDocument: () => getLiveApi().getDocument(),
    getDocumentVersion: () => getLiveApi().getDocumentVersion(),
    applyDocumentPatch: (patch) => getLiveApi().applyDocumentPatch(patch),
    setDocument: (doc) => getLiveApi().setDocument(doc),
    getActivePageId: () => getLiveApi().getActivePageId(),
    setActivePage: (pageId) => getLiveApi().setActivePage(pageId),
    getPages: () => getLiveApi().getPages(),
    addPage: (name) => getLiveApi().addPage(name),
    renamePage: (pageId, name) => getLiveApi().renamePage(pageId, name),
    duplicatePage: (pageId) => getLiveApi().duplicatePage(pageId),
    deletePage: (pageId) => getLiveApi().deletePage(pageId),
    reorderPage: (pageId, direction) =>
      getLiveApi().reorderPage(pageId, direction),
    applyBooleanOperation: (operation) =>
      getLiveApi().applyBooleanOperation(operation),
    getActiveTool: () => getLiveApi().getActiveTool(),
    setActiveTool: (tool) => getLiveApi().setActiveTool(tool),
    createContainer: (opts) => getLiveApi().createContainer(opts),
    insertNode: (node, containerId) =>
      getLiveApi().insertNode(node, containerId),
    updateNode: (nodeId, updates) => getLiveApi().updateNode(nodeId, updates),
    deleteNode: (nodeId) => getLiveApi().deleteNode(nodeId),
    bindAgentToContainer: (containerId, binding) =>
      getLiveApi().bindAgentToContainer(containerId, binding),
    setSelection: (nodeIds) => getLiveApi().setSelection(nodeIds),
    flushPendingSave: () => getLiveApi().flushPendingSave(),
    exportImage: (opts) => getLiveApi().exportImage(opts),
    getViewportBounds: () => getLiveApi().getViewportBounds(),
    getSceneElements: () => getLiveApi().getSceneElements(),
    getFiles: () => getLiveApi().getFiles(),
    getAppState: () => getLiveApi().getAppState(),
    updateScene: (scene) => getLiveApi().updateScene(scene),
    addFiles: (files) => getLiveApi().addFiles(files),
    onChange: (listener) => getLiveApi().onChange(listener),
    scrollToContent: () => getLiveApi().scrollToContent(),
    undo: () => getLiveApi().undo(),
    redo: () => getLiveApi().redo(),
    canUndo: () => getLiveApi().canUndo(),
    canRedo: () => getLiveApi().canRedo(),
    copySelection: () => getLiveApi().copySelection(),
    pasteClipboard: () => getLiveApi().pasteClipboard(),
    duplicateSelection: () => getLiveApi().duplicateSelection(),
    deleteSelection: () => getLiveApi().deleteSelection(),
    groupSelection: () => getLiveApi().groupSelection(),
    ungroupSelection: () => getLiveApi().ungroupSelection(),
    alignSelection: (alignment) => getLiveApi().alignSelection(alignment),
    reorderNode: (nodeId, direction) =>
      getLiveApi().reorderNode(nodeId, direction),
    moveNodeToIndex: (nodeId, targetParentId, targetIndex) =>
      getLiveApi().moveNodeToIndex(nodeId, targetParentId, targetIndex),
    toggleNodeLocked: (nodeId) => getLiveApi().toggleNodeLocked(nodeId),
    toggleNodeVisible: (nodeId) => getLiveApi().toggleNodeVisible(nodeId),
    pasteFromSystemClipboard: () => getLiveApi().pasteFromSystemClipboard(),
    importSvgMarkup: (svgMarkup) => getLiveApi().importSvgMarkup(svgMarkup),
    insertImageArtifact: (artifact) =>
      getLiveApi().insertImageArtifact(artifact),
    insertVideoArtifact: (artifact) =>
      getLiveApi().insertVideoArtifact(artifact),
  };
}

function getBooleanToolbarRejectionReason({
  activePageId,
  booleanRuntimeStatus,
  doc,
  selection,
}: {
  activePageId: string;
  booleanRuntimeStatus: "loading" | "ready" | "failed";
  doc: PenDocument;
  selection: string[];
}) {
  const currentSelection = getDocumentSelection(doc, selection);
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
}

function CanvasEditorToolbarConnected({
  api,
  onCreateContainer,
  onImportImage,
  onImportSvg,
  onInsertIcon,
  onToolChange,
}: {
  api: CanvasApi;
  onCreateContainer: () => void;
  onImportImage: () => void;
  onImportSvg: () => void;
  onInsertIcon?: () => void;
  onToolChange: (tool: CanvasTool) => void;
}) {
  const toolbarState = useCanvasRuntimeShallowSelector(
    selectCanvasToolbarState,
  );
  return (
    <CanvasEditorToolbar
      activeTool={toolbarState.activeTool}
      canRedo={toolbarState.canRedo}
      canUndo={toolbarState.canUndo}
      onCreateContainer={onCreateContainer}
      onDelete={api.deleteSelection}
      onInsertIcon={onInsertIcon}
      onImportImage={onImportImage}
      onImportSvg={onImportSvg}
      onRedo={api.redo}
      onToolChange={onToolChange}
      onUndo={api.undo}
      selectedCount={toolbarState.selectedCount}
    />
  );
}

function CanvasBooleanToolbarConnected({
  booleanRuntimeStatus,
  onBooleanOperation,
}: {
  booleanRuntimeStatus: "loading" | "ready" | "failed";
  onBooleanOperation: (operation: BooleanOpType) => void;
}) {
  const { activePageId, document, selection } = useCanvasRuntimeShallowSelector(
    selectCanvasBooleanInputState,
  );
  const rejectionReason = useMemo(
    () =>
      getBooleanToolbarRejectionReason({
        activePageId,
        booleanRuntimeStatus,
        doc: document,
        selection,
      }),
    [activePageId, booleanRuntimeStatus, document, selection],
  );
  return (
    <CanvasBooleanToolbar
      onBooleanOperation={onBooleanOperation}
      rejectionReason={rejectionReason}
      visible={selection.length >= 2}
    />
  );
}

function CanvasPageTabsConnected({
  api,
}: {
  api: Pick<
    CanvasApi,
    | "addPage"
    | "deletePage"
    | "duplicatePage"
    | "renamePage"
    | "reorderPage"
    | "setActivePage"
  >;
}) {
  const { activePageId, pages } = useCanvasRuntimeShallowSelector(
    selectCanvasPageTabsState,
  );
  return (
    <CanvasPageTabs
      activePageId={activePageId}
      onAddPage={() => api.addPage()}
      onDeletePage={api.deletePage}
      onDuplicatePage={api.duplicatePage}
      onRenamePage={api.renamePage}
      onReorderPage={api.reorderPage}
      onSetActivePage={api.setActivePage}
      pages={pages}
    />
  );
}

function CanvasPropertyPanelConnected({
  api,
  commitDocument,
}: {
  api: Pick<CanvasApi, "bindAgentToContainer" | "updateNode">;
  commitDocument: (document: PenDocument) => void;
}) {
  const store = useCanvasRuntimeStoreApi();
  const { node, styleDefinitions, variables } = useCanvasRuntimeShallowSelector(
    selectCanvasSelectedNodePanelState,
  );
  if (!node) return null;
  return (
    <CanvasPropertyPanel
      node={node}
      onBindAgent={(binding: AgentBinding) => {
        api.bindAgentToContainer(node.id, binding);
      }}
      onStyleDefinitionsChange={(nextStyleDefinitions) => {
        commitDocument({
          ...getCanvasApiDocument(store.getState()),
          styleDefinitions: nextStyleDefinitions,
        });
      }}
      onUpdate={(updates) => {
        api.updateNode(node.id, updates);
      }}
      onVariablesChange={(nextVariables) => {
        commitDocument({
          ...getCanvasApiDocument(store.getState()),
          variables: nextVariables,
        });
      }}
      styleDefinitions={styleDefinitions}
      variables={variables}
    />
  );
}

// ---------------------------------------------------------------------------
// SkiaCanvas
// ---------------------------------------------------------------------------

type SkiaCanvasProps = {
  initialContent: unknown;
  onDocumentChange?: (doc: CucumberCanvasDocument) => void;
  onInsertIcon?: () => void;
  onApiReady?: (api: CanvasApi) => void;
  onSelectionChange?: (elements: CanvasSceneElement[]) => void;
};

export const SkiaCanvas = memo(
  forwardRef<CanvasApi, SkiaCanvasProps>(function SkiaCanvas(
    {
      initialContent,
      onDocumentChange,
      onInsertIcon,
      onApiReady,
      onSelectionChange,
    },
    ref,
  ) {
    const canvasRootRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement | null>(null);
    const ckRef = useRef<CanvasKit | null>(null);
    const rendererRef = useRef<PenRenderer | null>(null);
    const liveApiRef = useRef<CanvasApi | null>(null);
    const apiReadyNotifiedRef = useRef(false);
    const [ckReady, setCkReady] = useState(false);
    const [ckError, setCkError] = useState<string | null>(null);

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

    const listenersRef = useRef(new Set<CanvasChangeListener>());
    const [editingText, setEditingText] = useState<TextEditState | null>(null);
    const [isFileDragActive, setIsFileDragActive] = useState(false);
    const fileDragDepthRef = useRef(0);
    const rendererIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const marqueeRafRef = useRef<number | null>(null);
    const rendererDocumentSyncRafRef = useRef<number | null>(null);
    const pendingRendererDocumentSyncRef =
      useRef<PendingRendererDocumentSync | null>(null);
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
    const activeTool = useStore(runtimeStore, selectCanvasActiveTool);
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
        backgroundColor:
          runtimeStore.getState().viewport.backgroundColor ?? "#ffffff",
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

      // ResizeObserver for responsive canvas
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
        pendingRendererDocumentSyncRef.current = null;
        renderer.dispose();
        if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
        rendererRef.current = null;
        canvasElRef.current = null;
      };
    }, [ckReady, runtimeStore]);

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
          const state = toAppState(
            next,
            [...selection],
            rendererRef.current?.getViewport(),
          );
          const files = toFiles(next);
          for (const listener of listenersRef.current) {
            listener(elements, state, files);
          }
        });
      },
      [],
    );

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
              onDocumentChange?.(committed as CucumberCanvasDocument);
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
        onDocumentChange,
        runtimeStore,
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
              onSelectionChange?.(
                state.selection
                  .map((id) =>
                    findNode(currentDocument, id, state.activePageId),
                  )
                  .filter(isPenNode)
                  .map((node) => toSceneElement(node)),
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
      ) => {
        const result = runtimeStore.getState().commitDocument(next, opts);
        docRef.current = result.document;
        activePageIdRef.current = result.activePageId;
        selectedIdsRef.current = result.selection;
        documentVersionRef.current = result.version;
      },
      [runtimeStore],
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

    const handleWheel = useCallback(
      (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        if (event.cancelable) event.preventDefault();
        const renderer = rendererRef.current;
        if (!renderer) return;
        const vp = renderer.getViewport();
        const newZoom = Math.min(
          3,
          Math.max(0.25, vp.zoom - event.deltaY * 0.001),
        );
        renderer.setInteractionMode("viewport");
        renderer.zoomToPoint(event.clientX, event.clientY, newZoom);
        scheduleRendererIdle();
      },
      [scheduleRendererIdle],
    );

    useEffect(() => {
      const root = canvasRootRef.current;
      if (!root) return;
      root.addEventListener("wheel", handleWheel, { passive: false });
      return () => {
        root.removeEventListener("wheel", handleWheel);
      };
    }, [handleWheel]);

    const beginTextEdit = useCallback(
      (node: PenNode, opts?: { isNew?: boolean; bounds?: CanvasBounds }) => {
        const renderer = rendererRef.current;
        if (!renderer || node.type !== "text") return false;
        const rendererBounds = renderer.getNodeBounds(node.id);
        const nodeBounds = getNodeBounds(node);
        const bounds = opts?.bounds ?? {
          x: rendererBounds?.x ?? nodeBounds.x,
          y: rendererBounds?.y ?? nodeBounds.y,
          width: rendererBounds?.w ?? nodeBounds.width,
          height: rendererBounds?.h ?? nodeBounds.height,
        };
        const textNode = node as PenNode & {
          fontSize?: number;
          fontFamily?: string;
          fontWeight?: string | number;
          textAlign?: React.CSSProperties["textAlign"];
          lineHeight?: number | string;
          textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
        };
        const content = getTextContent(node);
        setSelection([node.id]);
        setEditingText({
          nodeId: node.id,
          isNew: opts?.isNew ?? false,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          content,
          initialContent: content,
          textGrowth: textNode.textGrowth ?? "fixed-width-height",
          fontSize: textNode.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
          fontFamily: textNode.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
          fontWeight: String(textNode.fontWeight ?? 400),
          textAlign: textNode.textAlign ?? "left",
          color: getFirstSolidFillColor(node),
          lineHeight: textNode.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
        });
        console.info("[skia-canvas] text.edit.started", {
          nodeId: node.id,
          isNew: opts?.isNew ?? false,
          textGrowth: textNode.textGrowth ?? "fixed-width-height",
        });
        return true;
      },
      [setSelection],
    );

    // -----------------------------------------------------------------------
    // Pointer events (pan, marquee, move)
    // -----------------------------------------------------------------------

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        if (!renderer) return;
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
            startX: event.clientX,
            startY: event.clientY,
            originX: vp.panX,
            originY: vp.panY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (pointerButton !== 0) return;

        const tool = effectiveTool;
        if (tool === "hand") {
          const vp = renderer.getViewport();
          renderer.setInteractionMode("viewport");
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

        const scenePoint = getPointerScenePoint(event);
        if (!scenePoint) return;

        // Marquee selection
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
            const localBounds = getNodeBounds(node);
            const sceneBounds =
              getNodeSceneBounds(docRef.current, node.id, activePageId) ??
              localBounds;
            if (controlHit.type === "resize") {
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
                isDescendantOf(
                  docRef.current,
                  hit.id,
                  selectedId,
                  activePageId,
                ),
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
          dragRef.current = {
            kind: "marquee",
            startPoint: scenePoint,
            originSelection: [...selectedIdsRef.current],
          };
          setEditorOverlay({ marquee: null });
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        if (isDragDrawableTool(tool)) {
          dragRef.current = {
            kind: "drawShape",
            shapeType: tool,
            startPoint: scenePoint,
          };
          setEditorOverlay({
            shapePreview: getDrawableToolPreview(tool, {
              x: scenePoint.x,
              y: scenePoint.y,
              width: 0,
              height: 0,
            }),
            linePreview:
              tool === "line" || tool === "arrow"
                ? {
                    start: scenePoint,
                    end: scenePoint,
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
        effectiveTool,
        flushRendererDocumentSyncBeforeInteraction,
        getPointerScenePoint,
        penTool,
        setEditorOverlay,
        setSelection,
      ],
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
          const scenePoint = getPointerScenePoint(event);
          if (!scenePoint) return;
          const bounds = normalizeDrawBounds(
            drag.startPoint,
            scenePoint,
            false,
          );
          setEditorOverlay({ marquee: bounds });
          const hitIds = renderer.hitTestRect(bounds).map((node) => node.id);
          const nextSelection = Array.from(
            new Set([...drag.originSelection, ...hitIds]),
          );
          if (
            areStringArraysEqual(nextSelection, marqueeSelectionRef.current)
          ) {
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
          setEditorOverlay({
            shapePreview: getDrawableToolPreview(
              drag.shapeType,
              normalizeDrawBounds(
                drag.startPoint,
                scene,
                event.shiftKey &&
                  drag.shapeType !== "line" &&
                  drag.shapeType !== "arrow",
              ),
            ),
            linePreview:
              drag.shapeType === "line" || drag.shapeType === "arrow"
                ? {
                    start: drag.startPoint,
                    end: scene,
                    arrow: drag.shapeType === "arrow",
                  }
                : null,
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
          let updates = boundsToNodeUpdates(bounds);
          if (node?.type === "text") {
            const textNode = node as PenNode & {
              fontSize?: number;
              fontFamily?: string;
              fontWeight?: string | number;
              lineHeight?: number | string;
              textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
            };
            let nextTextGrowth = textNode.textGrowth ?? "fixed-width-height";
            const horizontalResize =
              drag.handle.includes("e") || drag.handle.includes("w");
            const verticalResize =
              drag.handle.includes("n") || drag.handle.includes("s");
            if (nextTextGrowth === "auto" && horizontalResize) {
              nextTextGrowth = "fixed-width";
            } else if (nextTextGrowth === "fixed-width" && verticalResize) {
              nextTextGrowth = "fixed-width-height";
            }
            const measured = measureTextLayout({
              content: getTextContent(node),
              fontSize: textNode.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
              fontFamily: textNode.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
              fontWeight: String(textNode.fontWeight ?? 400),
              lineHeight: textNode.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
              textGrowth: nextTextGrowth,
              width:
                nextTextGrowth === "auto"
                  ? getNodeBounds(node).width
                  : bounds.width,
              height: bounds.height,
            });
            updates = {
              ...updates,
              width: measured.width,
              height: measured.height,
              textGrowth: nextTextGrowth,
            } as Partial<PenNode>;
          }
          const previewUpdates = updates as Record<string, unknown>;
          renderer.setTransformPreview({
            kind: "resize",
            nodeId: drag.nodeId,
            bounds: {
              x: (previewUpdates.x as number | undefined) ?? drag.origin.x,
              y: (previewUpdates.y as number | undefined) ?? drag.origin.y,
              width:
                (previewUpdates.width as number | undefined) ??
                drag.origin.width,
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
      [getPointerScenePoint, penTool, setEditorOverlay, setSelection],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const renderer = rendererRef.current;
        const drag = dragRef.current;
        if (drag?.kind === "drawShape" && renderer) {
          const scene = getPointerScenePoint(event);
          if (scene) {
            const bounds = normalizeDrawBounds(
              drag.startPoint,
              scene,
              event.shiftKey &&
                drag.shapeType !== "line" &&
                drag.shapeType !== "arrow",
            );
            const isLineTool =
              drag.shapeType === "line" || drag.shapeType === "arrow";
            const isDrawableSize = isLineTool
              ? Math.hypot(
                  scene.x - drag.startPoint.x,
                  scene.y - drag.startPoint.y,
                ) >= MIN_DRAW_SIZE
              : bounds.width >= MIN_DRAW_SIZE && bounds.height >= MIN_DRAW_SIZE;
            if (isDrawableSize) {
              const node = createDrawableCanvasNode(
                drag.shapeType,
                bounds,
                drag.startPoint,
                scene,
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
        }
        if (drag?.kind === "pen") {
          penTool.onMouseUp();
          suppressNextClickRef.current = true;
        }
        if (drag?.kind === "move" && drag.hasMoved) {
          const activePageId = activePageIdRef.current;
          const operations = drag.nodeIds.flatMap((nodeId) => {
            const origin = drag.origins[nodeId];
            if (!origin) return [];
            const node = findNode(docRef.current, nodeId, activePageId);
            if (!node || node.locked) return [];
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
          renderer?.clearTransformPreview();
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
          commitDocument(next, { selection: drag.nodeIds });
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
          let updates = boundsToNodeUpdates(bounds);
          if (node?.type === "text") {
            const textNode = node as PenNode & {
              fontSize?: number;
              fontFamily?: string;
              fontWeight?: string | number;
              lineHeight?: number | string;
              textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
            };
            let nextTextGrowth = textNode.textGrowth ?? "fixed-width-height";
            const horizontalResize =
              drag.handle.includes("e") || drag.handle.includes("w");
            const verticalResize =
              drag.handle.includes("n") || drag.handle.includes("s");
            if (nextTextGrowth === "auto" && horizontalResize) {
              nextTextGrowth = "fixed-width";
            } else if (nextTextGrowth === "fixed-width" && verticalResize) {
              nextTextGrowth = "fixed-width-height";
            }
            const measured = measureTextLayout({
              content: getTextContent(node),
              fontSize: textNode.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
              fontFamily: textNode.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
              fontWeight: String(textNode.fontWeight ?? 400),
              lineHeight: textNode.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
              textGrowth: nextTextGrowth,
              width:
                nextTextGrowth === "auto"
                  ? getNodeBounds(node).width
                  : bounds.width,
              height: bounds.height,
            });
            updates = {
              ...updates,
              width: measured.width,
              height: measured.height,
              textGrowth: nextTextGrowth,
            } as Partial<PenNode>;
          }
          renderer?.clearTransformPreview();
          const next = applyCanvasOperation(docRef.current, {
            type: "updateNode",
            nodeId: drag.nodeId,
            updates,
            activePageId,
          });
          commitDocument(next, { selection: [drag.nodeId] });
        }
        if (drag?.kind === "rotate") {
          const activePageId = activePageIdRef.current;
          const point = getPointerScenePoint(event);
          if (point) {
            const rotation =
              drag.originRotation +
              pointToAngle(drag.center, point) -
              drag.startAngle;
            renderer?.clearTransformPreview();
            const next = applyCanvasOperation(docRef.current, {
              type: "updateNode",
              nodeId: drag.nodeId,
              updates: { rotation: Math.round(rotation) } as Partial<PenNode>,
              activePageId,
            });
            commitDocument(next, { selection: [drag.nodeId] });
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
          setEditorOverlay({ marquee: null });
          suppressNextClickRef.current = true;
          console.info("[skia-canvas] selection.marquee.committed", {
            selectedCount: getCanvasApiRuntimeState(docRef.current).selection
              .length,
          });
        }
        if (drag?.kind === "pan") {
          scheduleRendererIdle();
        }
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [
        beginTextEdit,
        commitDocument,
        getPointerScenePoint,
        penTool,
        scheduleRendererIdle,
        setEditorOverlay,
        setActiveTool,
        setSelection,
      ],
    );

    const commitTextEdit = useCallback(
      (nextContent: string) => {
        const currentEdit = editingText;
        if (!currentEdit) return;
        setEditingText(null);
        const activePageId = activePageIdRef.current;
        const trimmedContent = nextContent.trim();
        if (currentEdit.isNew && trimmedContent.length === 0) {
          const existingNode = findNode(
            docRef.current,
            currentEdit.nodeId,
            activePageId,
          );
          if (!existingNode) return;
          const next = applyCanvasOperation(docRef.current, {
            type: "deleteNode",
            nodeId: currentEdit.nodeId,
            activePageId,
          });
          commitDocument(next, { selection: [] });
          setSelection([], { notifyScene: false });
          console.info("[skia-canvas] text.edit.empty-new-deleted", {
            nodeId: currentEdit.nodeId,
          });
          return;
        }
        const measured = measureTextLayout({
          content: nextContent,
          fontSize: currentEdit.fontSize,
          fontFamily: currentEdit.fontFamily,
          fontWeight: currentEdit.fontWeight,
          lineHeight: currentEdit.lineHeight,
          textGrowth: currentEdit.textGrowth,
          width: currentEdit.width,
          height: currentEdit.height,
        });
        if (
          nextContent === currentEdit.initialContent &&
          Math.round(measured.width) === Math.round(currentEdit.width) &&
          Math.round(measured.height) === Math.round(currentEdit.height)
        ) {
          console.info("[skia-canvas] text.edit.cancelled", {
            nodeId: currentEdit.nodeId,
            reason: "unchanged",
          });
          return;
        }
        const existingNode = findNode(
          docRef.current,
          currentEdit.nodeId,
          activePageId,
        );
        if (!existingNode) {
          console.warn("[skia-canvas] text.edit.commit.skipped", {
            nodeId: currentEdit.nodeId,
            reason: "node_not_found",
            activePageId,
          });
          return;
        }
        const next = applyCanvasOperation(docRef.current, {
          type: "updateNode",
          nodeId: currentEdit.nodeId,
          updates: {
            content: nextContent,
            width: measured.width,
            height: measured.height,
            textGrowth: currentEdit.textGrowth,
          } as Partial<PenNode>,
          activePageId,
        });
        commitDocument(next, { selection: [currentEdit.nodeId] });
        setSelection([currentEdit.nodeId], { notifyScene: false });
        console.info("[skia-canvas] text.edit.committed", {
          nodeId: currentEdit.nodeId,
          textGrowth: currentEdit.textGrowth,
          previousLength: currentEdit.initialContent.length,
          nextLength: nextContent.length,
          width: Math.round(measured.width),
          height: Math.round(measured.height),
        });
      },
      [commitDocument, editingText, setSelection],
    );

    const updateTextEditDraft = useCallback((nextContent: string) => {
      setEditingText((current) => {
        if (!current) return current;
        const measured = measureTextLayout({
          content: nextContent,
          fontSize: current.fontSize,
          fontFamily: current.fontFamily,
          fontWeight: current.fontWeight,
          lineHeight: current.lineHeight,
          textGrowth: current.textGrowth,
          width: current.width,
          height: current.height,
        });
        return {
          ...current,
          content: nextContent,
          width: measured.width,
          height: measured.height,
        };
      });
    }, []);

    const handleDoubleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (effectiveTool === "path" && penTool.onDblClick()) {
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
        const hit = renderer.hitTest(event.clientX, event.clientY);
        if (!hit || hit.type !== "text") return;
        if (beginTextEdit(hit)) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClickRef.current = true;
        }
      },
      [beginTextEdit, effectiveTool, penTool],
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
        const placement = getLiveViewportPlacement();
        const defaultB = defaultBounds(
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
            .map((node) =>
              toSceneElement(
                node,
                0,
                null,
                getNodeSceneBounds(nextDoc, node.id, activePageId) ?? undefined,
              ),
            ),
        );
      },
      [onSelectionChange],
    );

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
      const activePageId = activePageIdRef.current;
      const currentSelection = selectedIdsRef.current;
      const ids = getTopLevelSelectionIds(
        docRef.current as CucumberCanvasDocument,
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
      const next = applyCanvasTransaction(docRef.current, operations, {
        activePageId,
      }).doc;
      commitDocument(next, { selection: [] });
      setSelection([], { notifyScene: false });
      console.info("[skia-canvas] selection.deleted", { count: ids.length });
    }, [commitDocument, setSelection]);

    const cutSelection = useCallback(() => {
      if (copySelection()) {
        deleteSelection();
      }
    }, [copySelection, deleteSelection]);

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

    const importFromPayload = useCallback(
      (
        payload: ClipboardImportPayload,
        context?: ClipboardImportContext,
        options?: { scenePoint?: { x: number; y: number } },
      ) => {
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
        const placementContext = getLiveViewportPlacement();
        const viewport = placementContext.viewport ?? {
          zoom: 1,
          panX: 0,
          panY: 0,
        };
        const viewportCenter = {
          x:
            ((placementContext.rect?.width ?? 0) / 2 - viewport.panX) /
            viewport.zoom,
          y:
            ((placementContext.rect?.height ?? 0) / 2 - viewport.panY) /
            viewport.zoom,
        };
        const targetCenter = options?.scenePoint ?? viewportCenter;
        const offsetX = importBounds
          ? targetCenter.x - (importBounds.x + importBounds.width / 2)
          : 0;
        const offsetY = importBounds
          ? targetCenter.y - (importBounds.y + importBounds.height / 2)
          : 0;
        const inserted = insertCanvasImportResult(docRef.current, parsed, {
          parentId: getPrimarySelectedContainerId(
            docRef.current as CucumberCanvasDocument,
            selectedIdsRef.current,
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
            `导入存在 ${parsed.warnings.length} 条兼容性提醒，请查看画布顶部说明。`,
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
          placement: options?.scenePoint ? "drop-point" : "viewport-center",
          targetCenter,
          viewport,
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
      [
        commitDocument,
        getLiveViewportPlacement,
        notifySelectionForDoc,
        setSelection,
        toast,
      ],
    );

    const importDropPayloadsInGrid = useCallback(
      (
        results: Array<{
          payload: ClipboardImportPayload;
          context: ClipboardImportContext;
        }>,
        scenePoint?: { x: number; y: number },
      ) => {
        const parsedEntries = results.flatMap((result) => {
          const parsed = parseClipboardImport(result.payload);
          if (!parsed) return [];
          return [
            {
              ...result,
              parsed,
              bounds: getCanvasImportBounds(parsed),
            },
          ];
        });
        if (parsedEntries.length === 0) return [];

        const placementContext = getLiveViewportPlacement();
        const viewport = placementContext.viewport ?? {
          zoom: 1,
          panX: 0,
          panY: 0,
        };
        const targetCenter =
          scenePoint ??
          ({
            x:
              ((placementContext.rect?.width ?? 0) / 2 - viewport.panX) /
              viewport.zoom,
            y:
              ((placementContext.rect?.height ?? 0) / 2 - viewport.panY) /
              viewport.zoom,
          } satisfies { x: number; y: number });
        const placements = computeImportGridPlacements(
          parsedEntries.map((entry) => entry.bounds),
          targetCenter,
        );
        const targetParentId = getPrimarySelectedContainerId(
          docRef.current as CucumberCanvasDocument,
          selectedIdsRef.current,
          activePageIdRef.current,
        );

        let nextDoc: PenDocument = docRef.current;
        const insertedIds: string[] = [];
        let warningCount = 0;

        parsedEntries.forEach((entry, index) => {
          const bounds = entry.bounds;
          const placement = placements[index] ?? targetCenter;
          const offsetX = bounds
            ? placement.x - (bounds.x + bounds.width / 2)
            : 0;
          const offsetY = bounds
            ? placement.y - (bounds.y + bounds.height / 2)
            : 0;
          const inserted = insertCanvasImportResult(nextDoc, entry.parsed, {
            parentId: targetParentId,
            offsetX,
            offsetY,
          });
          nextDoc = inserted.doc;
          insertedIds.push(...inserted.insertedIds);
          warningCount += entry.parsed.warnings.length;
        });

        commitDocument(nextDoc, { selection: insertedIds });
        setSelection(insertedIds, { notifyScene: false });
        notifySelectionForDoc(nextDoc, insertedIds);
        if (warningCount > 0) {
          toast.toast(
            `导入存在 ${warningCount} 条兼容性提醒，请查看画布顶部说明。`,
          );
        }
        console.info("[skia-canvas] file-drop.grid-imported", {
          activePageId: activePageIdRef.current,
          itemCount: results.length,
          importedItemCount: parsedEntries.length,
          unsupportedItemCount: results.length - parsedEntries.length,
          insertedCount: insertedIds.length,
          parentId: targetParentId,
          placement: parsedEntries.length > 1 ? "grid" : "drop-point",
          grid: describeImportGridPlacements(
            parsedEntries.map((entry) => entry.bounds),
          ),
          targetCenter,
          warningCount,
          mimeTypes: Array.from(
            new Set(results.flatMap((result) => result.context.mimeTypes)),
          ),
          fileTypes: Array.from(
            new Set(
              results.flatMap((result) => result.context.fileTypes ?? []),
            ),
          ),
          viewport,
        });
        return insertedIds;
      },
      [
        commitDocument,
        getLiveViewportPlacement,
        notifySelectionForDoc,
        setSelection,
        toast,
      ],
    );

    const resetFileDragState = useCallback(() => {
      fileDragDepthRef.current = 0;
      setIsFileDragActive(false);
    }, []);

    const handleDragEnter = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasFileDataTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        fileDragDepthRef.current += 1;
        event.dataTransfer.dropEffect = "copy";
        setIsFileDragActive(true);
      },
      [],
    );

    const handleDragOver = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasFileDataTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      },
      [],
    );

    const handleDragLeave = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasFileDataTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) {
          setIsFileDragActive(false);
        }
      },
      [],
    );

    const handleDrop = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasFileDataTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();

        const dataTransfer = event.dataTransfer;
        const renderer = rendererRef.current;
        const scenePoint = getPointerScenePoint(event) ?? undefined;
        resetFileDragState();

        console.info("[skia-canvas] file-drop.detected", {
          activePageId: activePageIdRef.current,
          mimeTypes: Array.from(dataTransfer.types ?? []),
          fileCount: dataTransfer.files?.length ?? 0,
          scenePoint,
          viewport: renderer?.getViewport() ?? { zoom: 1, panX: 0, panY: 0 },
        });

        void readDataTransferImportPayloads(dataTransfer).then(
          (results) => {
            try {
              const importedIds = importDropPayloadsInGrid(results, scenePoint);
              if (importedIds.length > 0) return;
              console.info("[skia-canvas] file-drop.import.ignored", {
                activePageId: activePageIdRef.current,
                itemCount: results.length,
                mimeTypes: results.flatMap(
                  (result) => result.context.mimeTypes,
                ),
                fileTypes: results.flatMap(
                  (result) => result.context.fileTypes ?? [],
                ),
              });
              toast.error(
                "暂不支持拖入这些文件。请使用 PNG、JPG、WebP、GIF 或 SVG 文件。",
              );
            } catch (error) {
              console.warn("[skia-canvas] file-drop.import.failed", {
                activePageId: activePageIdRef.current,
                error,
              });
              toast.error(
                error instanceof Error
                  ? error.message
                  : "文件导入失败，请确认文件内容可读取后重试。",
              );
            }
          },
          (error) => {
            console.warn("[skia-canvas] file-drop.read.failed", {
              activePageId: activePageIdRef.current,
              error,
            });
            toast.error("文件读取失败，请确认文件内容可读取后重试。");
          },
        );
      },
      [
        getPointerScenePoint,
        importDropPayloadsInGrid,
        resetFileDragState,
        toast,
      ],
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
        const b = defaultBounds(
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
        const result = applyCanvasTransaction(
          docRef.current,
          patch.operations,
          {
            activePageId,
            transactionId: patch.transactionId,
          },
        );
        commitDocument(result.doc, { selection: patch.selection });
        console.info("[skia-canvas] document.patch.applied", {
          activePageId,
          nextVersion: documentVersionRef.current,
          operationCount: patch.operations.length,
          transactionId: patch.transactionId,
        });
        return documentVersionRef.current;
      },
      [commitDocument],
    );

    const api = useMemo<CanvasApi>(
      () => ({
        getDocument: () => getCanvasApiDocument(runtimeStore.getState()),
        getDocumentVersion: () => documentVersionRef.current,
        applyDocumentPatch,
        setDocument: (raw: unknown) => {
          const next = normalizeRuntimeDocumentForCanvasSet(raw);
          commitDocument(next, { captureHistory: false });
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
                  ?.backgroundColor ?? "#ffffff",
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

            if (renderer && state.zoom) {
              const vp = renderer.getViewport();
              const nextZoom = Math.min(
                KEYBOARD_ZOOM_MAX,
                Math.max(KEYBOARD_ZOOM_MIN, state.zoom.value),
              );
              let nextPanX = state.scrollX ?? vp.panX;
              let nextPanY = state.scrollY ?? vp.panY;

              if (state.scrollX === undefined || state.scrollY === undefined) {
                const rect =
                  canvasContainerRef.current?.getBoundingClientRect();
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

              renderer.setViewport(nextZoom, nextPanX, nextPanY);
              viewportPatch.x = nextPanX;
              viewportPatch.y = nextPanY;
              viewportPatch.zoom = nextZoom;
            } else if (
              renderer &&
              (state.scrollX !== undefined || state.scrollY !== undefined)
            ) {
              const vp = renderer.getViewport();
              const nextPanX = state.scrollX ?? vp.panX;
              const nextPanY = state.scrollY ?? vp.panY;
              renderer.setViewport(vp.zoom, nextPanX, nextPanY);
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
                hasBackgroundColor:
                  typeof state.viewBackgroundColor === "string",
                hasScroll:
                  state.scrollX !== undefined || state.scrollY !== undefined,
                hasZoom: Boolean(state.zoom),
                zoom: viewportPatch.zoom,
              });
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
        insertImageArtifact: (artifact) =>
          insertImageNode(artifact, "generated"),
        insertVideoArtifact: (artifact) => {
          const id = createNodeId("videoEmbed");
          const placement = getLiveViewportPlacement();
          const b = defaultBounds(
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
        deletePage,
        deleteSelection,
        duplicatePage,
        duplicateSelection,
        getActivePageId,
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
      ],
    );

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
        const currentSelection = selectedIdsRef.current;
        if (currentSelection.length === 0) return;
        const activePageId = activePageIdRef.current;
        const operations = currentSelection.flatMap((nodeId) => {
          const node = findNode(docRef.current, nodeId, activePageId);
          if (!node || node.locked) return [];
          const bounds = getNodeBounds(node);
          return [
            {
              type: "updateNode" as const,
              nodeId,
              updates: {
                x: bounds.x + dx,
                y: bounds.y + dy,
              } as Partial<PenNode>,
              activePageId,
            },
          ];
        });
        if (operations.length === 0) return;
        commitDocument(
          applyCanvasTransaction(docRef.current, operations, { activePageId })
            .doc,
        );
      },
      reorderSelection: (direction) => {
        const topSelection = getTopLevelSelectionIds(
          docRef.current as CucumberCanvasDocument,
          selectedIdsRef.current,
          activePageIdRef.current,
        );
        for (const nodeId of topSelection) {
          api.reorderNode(nodeId, direction);
        }
      },
      editSelectedText: () => {
        const currentSelection = selectedIdsRef.current;
        if (currentSelection.length !== 1) return false;
        const node = findNode(
          docRef.current,
          currentSelection[0] ?? "",
          activePageIdRef.current,
        );
        if (!node || node.type !== "text") return false;
        return beginTextEdit(node);
      },
      zoomIn: () => {
        const currentZoom = api.getAppState().zoom.value;
        api.updateScene({
          appState: {
            zoom: {
              value: Math.min(
                currentZoom * KEYBOARD_ZOOM_STEP,
                KEYBOARD_ZOOM_MAX,
              ),
            },
          },
        });
      },
      zoomOut: () => {
        const currentZoom = api.getAppState().zoom.value;
        api.updateScene({
          appState: {
            zoom: {
              value: Math.max(
                currentZoom / KEYBOARD_ZOOM_STEP,
                KEYBOARD_ZOOM_MIN,
              ),
            },
          },
        });
      },
      resetZoom: () => {
        api.updateScene({ appState: { zoom: { value: 1 } } });
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

    return (
      <CanvasRuntimeStoreProvider store={runtimeStore}>
        <div
          ref={canvasRootRef}
          className={`relative h-full w-full overflow-hidden ${cursorClass}`}
          style={{ backgroundColor: "#ffffff" }}
          onClick={handleCanvasClick}
          onKeyDown={() => undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
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

          {editingText && textEditOverlay ? (
            <textarea
              aria-label="Edit canvas text"
              // biome-ignore lint/a11y/noAutofocus: text editing opens from an explicit double-click and should focus the in-place editor immediately.
              autoFocus
              className="absolute z-30 box-border m-0 resize-none overflow-hidden rounded-sm border-2 border-sky-400 bg-white/95 px-px py-0 outline-none"
              value={editingText.content}
              wrap={editingText.textGrowth === "auto" ? "off" : "soft"}
              style={{
                left: textEditOverlay.left,
                top: textEditOverlay.top,
                width: textEditOverlay.width,
                height: textEditOverlay.height,
                fontSize: textEditOverlay.fontSize,
                fontFamily: editingText.fontFamily,
                fontWeight: editingText.fontWeight,
                textAlign: editingText.textAlign,
                color: editingText.color,
                lineHeight: editingText.lineHeight,
                whiteSpace:
                  editingText.textGrowth === "auto" ? "pre" : "pre-wrap",
                overflowWrap:
                  editingText.textGrowth === "auto" ? "normal" : "break-word",
              }}
              onBlur={(event) => commitTextEdit(event.currentTarget.value)}
              onChange={(event) =>
                updateTextEditDraft(event.currentTarget.value)
              }
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  commitTextEdit(event.currentTarget.value);
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.blur();
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                event.stopPropagation();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            />
          ) : null}

          {/* Toolbar overlays */}
          <CanvasEditorToolbarConnected
            api={api}
            onCreateContainer={() => createContainer()}
            onInsertIcon={onInsertIcon}
            onImportImage={handleImportImage}
            onImportSvg={handleImportSvg}
            onToolChange={setActiveTool}
          />

          <CanvasBooleanToolbarConnected
            booleanRuntimeStatus={booleanRuntimeStatus}
            onBooleanOperation={api.applyBooleanOperation}
          />

          <div className="absolute bottom-4 left-[clamp(6rem,50%,calc(100vw-6rem))] z-20 flex -translate-x-1/2 justify-center">
            <CanvasPageTabsConnected api={api} />
          </div>

          {/* Property panel */}
          <CanvasPropertyPanelConnected
            api={api}
            commitDocument={commitDocument}
          />

          {/* Loading indicator while CK initializes */}
          {!rendererRef.current && ckReady ? (
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

function isDrawableShapeTool(tool: CanvasTool): tool is DrawableShapeTool {
  return tool === "rect" || tool === "ellipse" || tool === "polygon";
}

function isDragDrawableTool(tool: CanvasTool): tool is DrawableCanvasTool {
  return (
    isDrawableShapeTool(tool) ||
    tool === "container" ||
    tool === "line" ||
    tool === "arrow"
  );
}

function hasFileDataTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types ?? []).includes("Files")) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );
}

function computeImportGridPlacements(
  boundsList: Array<CanvasBounds | null>,
  center: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const count = boundsList.length;
  if (count === 0) return [];
  if (count === 1) return [center];

  const gap = 24;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.max(
    1,
    ...boundsList.map((bounds) => bounds?.width ?? 320),
  );
  const cellHeight = Math.max(
    1,
    ...boundsList.map((bounds) => bounds?.height ?? 240),
  );
  const totalWidth = columns * cellWidth + (columns - 1) * gap;
  const totalHeight = rows * cellHeight + (rows - 1) * gap;
  const startX = center.x - totalWidth / 2;
  const startY = center.y - totalHeight / 2;

  return boundsList.map((bounds, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const width = bounds?.width ?? cellWidth;
    const height = bounds?.height ?? cellHeight;
    return {
      x: startX + column * (cellWidth + gap) + width / 2,
      y: startY + row * (cellHeight + gap) + height / 2,
    };
  });
}

function describeImportGridPlacements(boundsList: Array<CanvasBounds | null>): {
  columns: number;
  rows: number;
  gap: number;
  itemCount: number;
} {
  const itemCount = boundsList.length;
  const columns = itemCount <= 1 ? itemCount : Math.ceil(Math.sqrt(itemCount));
  return {
    columns,
    rows: columns > 0 ? Math.ceil(itemCount / columns) : 0,
    gap: 24,
    itemCount,
  };
}

function getDrawableToolPreview(
  tool: DrawableCanvasTool,
  bounds: CanvasBounds,
): EditorOverlayState["shapePreview"] {
  if (tool === "line" || tool === "arrow") return null;
  return {
    type: tool === "container" ? "rect" : tool,
    bounds,
    fillColor: tool === "rect" ? DEFAULT_RECT_FILL : DEFAULT_SHAPE_FILL,
  };
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

function createTextCanvasNode(
  bounds: CanvasBounds,
  textGrowth: "auto" | "fixed-width",
): PenNode {
  const layout = measureTextLayout({
    content: "",
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontWeight: "400",
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    textGrowth,
    width: bounds.width,
    height: bounds.height,
  });
  return {
    id: createNodeId("text"),
    type: "text",
    name: "Text",
    x: bounds.x,
    y: bounds.y,
    width: textGrowth === "auto" ? layout.width : Math.max(bounds.width, 1),
    height:
      textGrowth === "auto"
        ? layout.height
        : Math.max(bounds.height, layout.height),
    content: "",
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    textGrowth,
    fill: [{ type: "solid", color: "#111827" }],
  } as PenNode;
}

function createDrawableCanvasNode(
  type: DrawableCanvasTool,
  bounds: CanvasBounds,
  start: { x: number; y: number },
  end: { x: number; y: number },
): PenNode {
  if (type === "container") {
    return createFrameNode(createNodeId("container"), bounds, "New container");
  }
  if (type === "line" || type === "arrow") {
    return createLineNode(type, start, end);
  }

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

function createFrameNode(
  id: string,
  bounds: CanvasBounds,
  name: string,
): PenNode {
  return {
    id,
    type: "frame",
    name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    clipContent: true,
    fill: [{ type: "solid", color: "rgba(255,255,255,0.78)" }],
    stroke: {
      thickness: 2,
      fill: [{ type: "solid", color: "#6c5ce7" }],
    },
    opacity: 1,
    children: [],
    containerRole: ["visual", "task", "context"] as ContainerRole[],
    contextSlots: {},
    inheritPolicy: "merge",
    permissions: {
      owner: "user",
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
    },
  } as PenNode;
}

function createLineNode(
  type: "line" | "arrow",
  start: { x: number; y: number },
  end: { x: number; y: number },
): PenNode {
  const id = createNodeId(type);
  return {
    id,
    type: "line",
    name: type === "arrow" ? "Arrow" : "Line",
    x: start.x,
    y: start.y,
    width: Math.max(Math.abs(end.x - start.x), 1),
    height: Math.max(Math.abs(end.y - start.y), 1),
    x2: end.x,
    y2: end.y,
    stroke: {
      thickness: 3,
      fill: [{ type: "solid", color: "#111827" }],
    },
    ...(type === "arrow" ? { _connectorType: "arrow" } : null),
  } as unknown as PenNode;
}
