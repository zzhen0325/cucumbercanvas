"use client";

import {
  type AgentBinding,
  type CanvasAsset,
  type CanvasBounds,
  type CanvasNode,
  type ConnectorAnchor,
  type ConnectorNode,
  type ContainerNode,
  type ContextSlots,
  type CucumberCanvasDocument,
  applyCanvasOperation,
  createCanvasNodeId,
  normalizeCanvasDocument,
  resolveContext,
} from "@cucumber/canvas-core";
import {
  Box,
  Hand,
  Frame,
  ImagePlus,
  Lock,
  MousePointer2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  ArrowRight,
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
      nodeId: string;
      startX: number;
      startY: number;
      origin: CanvasBounds;
    }
  | {
      kind: "resize";
      nodeId: string;
      startX: number;
      startY: number;
      origin: CanvasBounds;
      preserveAspectRatio?: boolean;
    }
  | {
      kind: "drawConnector";
      nodeId: string;
      startPoint: { x: number; y: number };
      connectorType: "line" | "arrow";
    };

const GRID_SIZE = 24;
const IMAGE_IMPORT_MAX_SIZE = 600;
type CanvasTool =
  | "select"
  | "hand"
  | "container"
  | "rect"
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
    const [activeTool, setActiveTool] = useState<CanvasTool>("select");

    docRef.current = doc;

    const selectedId = doc.selection?.[0] ?? null;
    const selectedNode = selectedId ? doc.nodes[selectedId] : undefined;

    const commitDocument = useCallback(
      (next: CucumberCanvasDocument) => {
        docRef.current = next;
        setDoc(next);
        onDocumentChange?.(next);
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

    const applyOperation = useCallback(
      (operation: Parameters<typeof applyCanvasOperation>[1]) => {
        const next = applyCanvasOperation(docRef.current, operation);
        commitDocument(next);
      },
      [commitDocument],
    );

    const selectNode = useCallback(
      (nodeId: string | null) => {
        const next = {
          ...docRef.current,
          selection: nodeId ? [nodeId] : [],
          updatedAt: new Date().toISOString(),
        };
        commitDocument(next);
        const node = nodeId ? next.nodes[nodeId] : undefined;
        onSelectionChange?.(node ? [toSceneElement(node)] : []);
      },
      [commitDocument, onSelectionChange],
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
        const targetContainerId = firstSelectedContainerId(docRef.current);
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
        const parentId = firstSelectedContainerId(docRef.current);
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

    const api = useMemo<CanvasApi>(
      () => ({
        getDocument: () => docRef.current,
        setDocument: (next) => commitDocument(normalizeCanvasDocument(next)),
        createContainer,
        insertNode: (node, containerId) =>
          applyOperation({ type: "insertNode", node, containerId }),
        updateNode: (nodeId, updates) =>
          applyOperation({ type: "updateNode", nodeId, updates }),
        deleteNode: (nodeId) => applyOperation({ type: "deleteNode", nodeId }),
        bindAgentToContainer: (containerId, binding) =>
          applyOperation({ type: "bindAgent", containerId, binding }),
        setSelection: (nodeIds) => {
          const next = {
            ...docRef.current,
            selection: nodeIds.filter((id) =>
              Boolean(docRef.current.nodes[id]),
            ),
            updatedAt: new Date().toISOString(),
          };
          commitDocument(next);
          onSelectionChange?.(
            next.selection?.map((id) => toSceneElement(next.nodes[id]!)) ?? [],
          );
        },
        exportImage: (opts) => exportDocumentImage(docRef.current, opts),
        getSceneElements: () => toSceneElements(docRef.current),
        getFiles: () => toFiles(docRef.current),
        getAppState: () => toAppState(docRef.current),
        updateScene: (scene) => {
          const state = scene.appState;
          if (!state) return;
          commitDocument({
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
          });
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
          commitDocument({
            ...docRef.current,
            viewport: { ...docRef.current.viewport, x: 0, y: 0, zoom: 1 },
          });
        },
        insertImageArtifact: (artifact) => insertImageNode(artifact, "generated"),
        insertVideoArtifact: (artifact) => {
          const id = createCanvasNodeId("video");
          const assetId =
            artifact.assetId ?? artifact.jobId ?? createCanvasNodeId("asset");
          const targetContainerId = firstSelectedContainerId(docRef.current);
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
      [applyOperation, commitDocument, createContainer, insertImageNode, selectNode],
    );

    useImperativeHandle(ref, () => api, [api]);

    useEffect(() => {
      onApiReady?.(api);
    }, [api, onApiReady]);

    useEffect(() => {
      commitDocument(normalizeCanvasDocument(initialContent));
      // The server replaces initialContent only when the canvas changes.
    }, [commitDocument, initialContent]);

    const updateNode = useCallback(
      (nodeId: string, updates: Partial<CanvasNode>) => {
        applyOperation({ type: "updateNode", nodeId, updates });
      },
      [applyOperation],
    );

    const deleteSelected = useCallback(() => {
      if (!selectedId) return;
      applyOperation({ type: "deleteNode", nodeId: selectedId });
      selectNode(null);
    }, [applyOperation, selectNode, selectedId]);

    const insertRect = useCallback(() => {
      const id = createCanvasNodeId("rect");
      const parentId = firstSelectedContainerId(docRef.current);
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

    const insertText = useCallback(() => {
      const id = createCanvasNodeId("text");
      const parentId = firstSelectedContainerId(docRef.current);
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
        const point = screenToCanvasPoint(event, docRef.current, stageRef.current);
        if (activeTool === "container") {
          createContainer({
            bounds: { x: point.x, y: point.y, width: 360, height: 240 },
          });
          setActiveTool("select");
          return;
        }
        if (activeTool === "line" || activeTool === "arrow") {
          beginConnectorDraw(activeTool, point, event);
          return;
        }
        selectNode(null);
        dragRef.current = {
          kind: "pan",
          startX: event.clientX,
          startY: event.clientY,
          originX: docRef.current.viewport.x,
          originY: docRef.current.viewport.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [activeTool, beginConnectorDraw, createContainer, selectNode],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (drag.kind === "pan") {
          commitDocument({
            ...docRef.current,
            viewport: {
              ...docRef.current.viewport,
              x: drag.originX + event.clientX - drag.startX,
              y: drag.originY + event.clientY - drag.startY,
            },
          });
          return;
        }
        if (drag.kind === "drawConnector") {
          const point = screenToCanvasPoint(event, docRef.current, stageRef.current);
          updateNode(
            drag.nodeId,
            createConnectorGeometry(drag.startPoint, point, drag.connectorType),
          );
          return;
        }
        const dx = (event.clientX - drag.startX) / docRef.current.viewport.zoom;
        const dy = (event.clientY - drag.startY) / docRef.current.viewport.zoom;
        const node = docRef.current.nodes[drag.nodeId];
        if (!node) return;
        const nextBounds =
          drag.kind === "move"
            ? { ...node.bounds, x: drag.origin.x + dx, y: drag.origin.y + dy }
            : calculateResizeBounds(
                drag.origin,
                dx,
                dy,
                drag.preserveAspectRatio ?? false,
              );
        updateNode(drag.nodeId, { bounds: nextBounds } as Partial<CanvasNode>);
      },
      [commitDocument, updateNode],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.kind === "drawConnector") {
          const node = docRef.current.nodes[dragRef.current.nodeId];
          if (
            node &&
            node.bounds.width <= 6 &&
            node.bounds.height <= 6
          ) {
            applyOperation({ type: "deleteNode", nodeId: node.id });
            selectNode(null);
          }
        }
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [applyOperation, selectNode],
    );

    const handleWheel = useCallback(
      (event: React.WheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const nextZoom = Math.min(
          3,
          Math.max(0.25, docRef.current.viewport.zoom - event.deltaY * 0.001),
        );
        commitDocument({
          ...docRef.current,
          viewport: { ...docRef.current.viewport, zoom: nextZoom },
        });
      },
      [commitDocument],
    );

    return (
      <div
        ref={stageRef}
        className={`relative h-full w-full overflow-hidden text-foreground ${
          activeTool === "hand"
            ? "cursor-grab"
            : activeTool === "line" || activeTool === "arrow"
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
          onInsertText={insertText}
          onDelete={deleteSelected}
          hasSelection={Boolean(selectedNode)}
        />
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})`,
          }}
        >
          {Object.values(doc.nodes).map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              activeTool={activeTool}
              selectedId={selectedId}
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
                dragRef.current = {
                  kind: "move",
                  nodeId,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: targetNode.bounds,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onResizeStart={(nodeId, event) => {
                const targetNode = docRef.current.nodes[nodeId];
                if (!targetNode || targetNode.locked) return;
                dragRef.current = {
                  kind: "resize",
                  nodeId,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: targetNode.bounds,
                  preserveAspectRatio:
                    targetNode.type === "image" ||
                    targetNode.type === "videoEmbed",
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onUpdate={updateNode}
            />
          ))}
        </div>
        {selectedNode?.type === "container" && (
          <ContainerInspector
            container={selectedNode}
            context={resolveContext(doc, selectedNode.id)}
            onUpdate={(updates) =>
              updateNode(selectedNode.id, updates as Partial<CanvasNode>)
            }
            onBindAgent={(binding) =>
              api.bindAgentToContainer(selectedNode.id, binding)
            }
          />
        )}
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
  onInsertText,
  onDelete,
  hasSelection,
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onCreateContainer: () => void;
  onImportImage: () => void;
  onInsertRect: () => void;
  onInsertText: () => void;
  onDelete: () => void;
  hasSelection: boolean;
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
        disabled={!hasSelection}
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
  selectedId,
  onSelect,
  onDragStart,
  onResizeStart,
  onUpdate,
}: {
  node: CanvasNode;
  activeTool: CanvasTool;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (
    nodeId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onResizeStart: (
    nodeId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onUpdate: (nodeId: string, updates: Partial<CanvasNode>) => void;
}) {
  const selected = selectedId === node.id;
  const style = {
    left: node.bounds.x,
    top: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
  };

  return (
    <div
      data-canvas-node-id={node.id}
      className={`absolute select-none ${selected ? "z-10" : ""}`}
      style={style}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (activeTool === "hand") return;
        onSelect(node.id);
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
      {selected && !node.locked && (
        <div
          data-resize-handle
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-primary bg-background"
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart(node.id, event);
          }}
        />
      )}
    </div>
  );
}

function renderNodeContent(
  node: CanvasNode,
  selected: boolean,
  onUpdate: (nodeId: string, updates: Partial<CanvasNode>) => void,
) {
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

function ContainerInspector({
  container,
  context,
  onUpdate,
  onBindAgent,
}: {
  container: ContainerNode;
  context: ContextSlots;
  onUpdate: (updates: Partial<ContainerNode>) => void;
  onBindAgent: (binding: AgentBinding) => void;
}) {
  const [agentName, setAgentName] = useState(
    container.agentBinding?.name ?? "",
  );
  const titleInputId = `${container.id}-title`;
  const rulesInputId = `${container.id}-rules`;
  const agentInputId = `${container.id}-agent`;

  return (
    <div
      className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-card backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">容器属性</span>
        {container.locked ? (
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
        value={container.title ?? ""}
        onChange={(event) => onUpdate({ title: event.currentTarget.value })}
      />
      <label
        className="mb-2 block text-xs text-muted-foreground"
        htmlFor={rulesInputId}
      >
        上下文规则
      </label>
      <textarea
        id={rulesInputId}
        className="mb-3 h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={(container.contextSlots.rules ?? []).join("\n")}
        onChange={(event) =>
          onUpdate({
            contextSlots: {
              ...container.contextSlots,
              rules: event.currentTarget.value.split("\n").filter(Boolean),
            },
          })
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
              agentId: `agent_${container.id}`,
              name: agentName || "Designer Agent",
              status: "idle",
              permissions: ["read", "write", "spawn"],
            })
          }
        >
          绑定
        </button>
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] text-muted-foreground">
        Effective context: {JSON.stringify(context)}
      </p>
    </div>
  );
}

function toSceneElements(doc: CucumberCanvasDocument): CanvasSceneElement[] {
  return Object.values(doc.nodes).map(toSceneElement);
}

function toSceneElement(node: CanvasNode): CanvasSceneElement {
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
    customData: {
      title: node.title,
      source: node.meta?.source,
      containerId: node.parentId,
      storageUrl: node.type === "image" ? node.src : undefined,
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

function firstSelectedContainerId(doc: CucumberCanvasDocument): string | null {
  const selected = doc.selection?.[0];
  if (!selected) return null;
  const node = doc.nodes[selected];
  if (!node) return null;
  return node.type === "container" ? node.id : node.parentId;
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
  dx: number,
  dy: number,
  preserveAspectRatio: boolean,
): CanvasBounds {
  const minWidth = 48;
  const minHeight = 48;
  if (!preserveAspectRatio) {
    return {
      ...origin,
      width: Math.max(minWidth, origin.width + dx),
      height: Math.max(minHeight, origin.height + dy),
    };
  }
  const widthRatio = (origin.width + dx) / Math.max(origin.width, 1);
  const heightRatio = (origin.height + dy) / Math.max(origin.height, 1);
  const scale = Math.max(
    Math.max(widthRatio, heightRatio),
    minWidth / Math.max(origin.width, 1),
    minHeight / Math.max(origin.height, 1),
  );

  return {
    ...origin,
    width: Math.max(minWidth, Math.round(origin.width * scale)),
    height: Math.max(minHeight, Math.round(origin.height * scale)),
  };
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
      if (node.type === "text") {
        return `<text x="${x}" y="${y + node.fontSize * scale}" font-size="${node.fontSize * scale}" fill="${escapeAttr(node.color ?? "#111827")}">${escapeText(node.text)}</text>`;
      }
      if (node.type === "image") {
        return `<image href="${escapeAttr(node.src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" />`;
      }
      if (node.type === "line" || node.type === "arrow") {
        const start = anchorToPoint(node.startAnchor ?? "tl", w, h);
        const end = anchorToPoint(node.endAnchor ?? "br", w, h);
        const markerId = `svg-marker-${escapeAttr(node.id)}`;
        const defs =
          node.type === "arrow"
            ? `<defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${escapeAttr(node.stroke ?? "#111827")}" /></marker></defs>`
            : "";
        return `${defs}<line x1="${x + start.x}" y1="${y + start.y}" x2="${x + end.x}" y2="${y + end.y}" stroke="${escapeAttr(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 3}" stroke-linecap="round"${node.type === "arrow" ? ` marker-end="url(#${markerId})"` : ""} />`;
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
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="2" />`;
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
