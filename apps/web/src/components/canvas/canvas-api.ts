import type {
  AgentBinding,
  CanvasAsset,
  CanvasBounds,
  CanvasOperation,
  ContextSlots,
  CucumberCanvasDocument,
  PenNode,
  PenPage,
} from "@cucumber/canvas-core";
import type { BooleanOpType } from "@cucumber/pen-core";

export type { PenPage } from "@cucumber/canvas-core";

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

export type CanvasApiViewportState = {
  x?: number;
  y?: number;
  zoom?: number;
  backgroundColor?: string;
};

export type CanvasApiDocument = CucumberCanvasDocument & {
  assets?: Record<string, CanvasAsset>;
  selection?: string[];
  viewport?: CanvasApiViewportState;
};

export type CanvasApiRuntimeState = {
  document: CanvasApiDocument;
  selection: string[];
  assets: Record<string, CanvasAsset>;
  viewport: CanvasApiViewportState;
};

export type CanvasDocumentPatch = {
  baseVersion: number;
  transactionId: string;
  operations: CanvasOperation[];
  selection?: string[];
};

export type CanvasAppState = {
  zoom: { value: number };
  scrollX: number;
  scrollY: number;
  viewBackgroundColor: string;
  selectedElementIds: Record<string, boolean>;
};

export type AlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type CanvasTool =
  | "select"
  | "hand"
  | "container"
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "text"
  | "line"
  | "arrow";

export type CanvasApi = {
  getDocument: () => CanvasApiDocument;
  getDocumentVersion: () => number;
  applyDocumentPatch: (patch: CanvasDocumentPatch) => number;
  setDocument: (doc: unknown) => void;
  getActivePageId: () => string;
  setActivePage: (pageId: string) => void;
  getPages: () => PenPage[];
  addPage: (name?: string) => string;
  renamePage: (pageId: string, name: string) => void;
  duplicatePage: (pageId: string) => string;
  deletePage: (pageId: string) => void;
  reorderPage: (pageId: string, direction: "left" | "right") => void;
  applyBooleanOperation: (operation: BooleanOpType) => string | null;
  getActiveTool: () => CanvasTool;
  setActiveTool: (tool: CanvasTool) => void;
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
    bounds?: CanvasBounds;
  }) => Promise<Blob>;
  getViewportBounds: () => CanvasBounds;
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

export type CanvasApiImageArtifact = Parameters<
  CanvasApi["insertImageArtifact"]
>[0];

export type CanvasApiVideoArtifact = Parameters<
  CanvasApi["insertVideoArtifact"]
>[0];

export type CanvasApiAssetSource = CanvasAsset["source"];

export type CanvasApiContextSlots = ContextSlots;
