"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Circle,
  Download,
  Hand,
  ImageUp,
  MessageSquareText,
  Minus,
  MousePointer2,
  Pencil,
  Sparkles,
  Square,
  Type,
  Trash2,
  Video,
} from "lucide-react";

import {
  createImageGeneratorElement,
  isImageGeneratorElement,
  getImageGeneratorData,
  type ImageGeneratorData,
} from "../lib/canvas-image-generator";
import {
  createVideoGeneratorElement,
  isVideoGeneratorElement,
  getVideoGeneratorData,
  type VideoGeneratorData,
} from "../lib/canvas-video-generator";
import { isVideoUrl } from "../lib/canvas-elements";
import { ImageGeneratorPanel } from "./canvas/image-generator-panel";
import { VideoGeneratorPanel } from "./canvas/video-generator-panel";

type ToolType =
  | "hand"
  | "selection"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image";

const TOOL_GROUPS: (ToolType | null)[] = [
  "hand",
  "selection",
  null,
  "rectangle",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  null,
  "text",
  "image",
];

const TOOL_ICONS: Record<ToolType, React.ComponentType<{ className?: string }>> = {
  hand: Hand,
  selection: MousePointer2,
  rectangle: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  freedraw: Pencil,
  text: Type,
  image: ImageUp,
};

const TOOL_LABELS: Record<ToolType, string> = {
  hand: "拖拽画布 (H)",
  selection: "选择 (V)",
  rectangle: "矩形 (R)",
  ellipse: "椭圆 (O)",
  arrow: "箭头 (A)",
  line: "直线 (L)",
  freedraw: "画笔 (P)",
  text: "文字 (T)",
  image: "图片 (9)",
};

type CanvasToolMenuProps = {
  accessToken: string;
  excalidrawApi: any;
  leftPanelOpen?: boolean;
};

type SelectedElementToolbarState = {
  id: string;
  kind: "image" | "video" | "text" | "shape";
  label: string;
  screenX: number;
  screenY: number;
  screenW: number;
  downloadUrl?: string;
  downloadFileName?: string;
};

/** Memoized shimmer overlay for a single generating element */
const GeneratingOverlay = memo(function GeneratingOverlay({
  id,
  screenX,
  screenY,
  screenW,
  screenH,
  model,
}: {
  id: string;
  screenX: number;
  screenY: number;
  screenW: number;
  screenH: number;
  model?: string;
}) {
  return (
    <div
      key={id}
      className="pointer-events-none fixed overflow-hidden rounded-lg"
      style={{
        left: screenX,
        top: screenY,
        width: screenW,
        height: screenH,
        zIndex: 99,
      }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted">
        <svg
          className="h-12 w-12 text-muted-foreground/40"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
        {model && (
          <span className="mt-2 rounded-full bg-foreground/5 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {model.split("/").pop()?.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
          </span>
        )}
        <span className="mt-1 text-[11px] text-muted-foreground">
          Generating...
        </span>
      </div>
      <div className="absolute inset-0 animate-shimmer-scan">
        <div
          className="h-full w-1/2"
          style={{
            background:
              "linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
          }}
        />
      </div>
    </div>
  );
});

export function CanvasToolMenu({ accessToken, excalidrawApi, leftPanelOpen }: CanvasToolMenuProps) {
  const [activeTool, setActiveTool] = useState<string>("selection");

  // Image generator state
  const [activeGeneratorId, setActiveGeneratorId] = useState<string | null>(null);
  const [generatorData, setGeneratorData] = useState<ImageGeneratorData | null>(null);
  const [generatorBounds, setGeneratorBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Video generator state
  const [activeVideoGenId, setActiveVideoGenId] = useState<string | null>(null);
  const [videoGenData, setVideoGenData] = useState<VideoGeneratorData | null>(null);
  const [videoGenBounds, setVideoGenBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [canvasScrollZoom, setCanvasScrollZoom] = useState({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  });

  // Track generating elements for shimmer overlay
  const [generatingElements, setGeneratingElements] = useState<
    Array<{
      id: string;
      screenX: number;
      screenY: number;
      screenW: number;
      screenH: number;
      model?: string;
    }>
  >([]);
  const [selectedToolbar, setSelectedToolbar] =
    useState<SelectedElementToolbarState | null>(null);

  // Keep activeGeneratorId / activeVideoGenId accessible inside onChange without causing re-subscription
  const activeGeneratorIdRef = useRef(activeGeneratorId);
  activeGeneratorIdRef.current = activeGeneratorId;
  const activeVideoGenIdRef = useRef(activeVideoGenId);
  activeVideoGenIdRef.current = activeVideoGenId;

  // Track previous generating element IDs to avoid re-renders when nothing changed
  const prevGeneratingKeyRef = useRef("");

  // Helper: close all generator / player panels
  const closeAllPanels = useCallback(() => {
    setActiveGeneratorId(null);
    setGeneratorData(null);
    setGeneratorBounds(null);
    setActiveVideoGenId(null);
    setVideoGenData(null);
    setVideoGenBounds(null);
  }, []);

  // Subscribe to Excalidraw changes.
  // This fires on every frame during drag / drawing, so we must be very
  // careful to avoid unnecessary state updates that trigger re-renders.
  useEffect(() => {
    if (!excalidrawApi) return;

    const unsubscribe = excalidrawApi.onChange(
      (elements: any[], appState: any) => {
        // --- Tool sync (cheap string comparison, skip if unchanged) ---
        const tool = appState?.activeTool?.type;
        if (tool) setActiveTool((prev: string) => prev === tool ? prev : tool);

        const scrollX = appState?.scrollX ?? 0;
        const scrollY = appState?.scrollY ?? 0;
        const zoom = appState?.zoom?.value ?? 1;
        // Only update scroll/zoom state if values actually changed
        setCanvasScrollZoom((prev) => {
          if (prev.scrollX === scrollX && prev.scrollY === scrollY && prev.zoom === zoom) return prev;
          return { scrollX, scrollY, zoom };
        });

        // --- Selection-based panel management ---
        const selectedIds = appState?.selectedElementIds ?? {};
        const selectedElements = elements.filter(
          (el: any) => selectedIds[el.id] && !el.isDeleted,
        );

        const currentId = activeGeneratorIdRef.current;
        const currentVideoId = activeVideoGenIdRef.current;

        if (selectedElements.length === 1) {
          const sel = selectedElements[0];
          const toolbarState = resolveToolbarState({
            element: sel,
            files: excalidrawApi.getFiles?.() ?? {},
            scrollX,
            scrollY,
            zoom,
          });
          setSelectedToolbar(toolbarState);

          if (isImageGeneratorElement(sel)) {
            // Only update if the selected generator changed
            if (currentId !== sel.id) {
              const data = getImageGeneratorData(sel);
              setActiveGeneratorId(sel.id as string);
              setGeneratorData(data);
              if (currentVideoId) { setActiveVideoGenId(null); setVideoGenData(null); setVideoGenBounds(null); }
            }
            // Always update bounds (element may have been moved/resized)
            setGeneratorBounds({
              x: sel.x as number, y: sel.y as number,
              width: sel.width as number, height: sel.height as number,
            });
          } else if (isVideoGeneratorElement(sel)) {
            if (currentVideoId !== sel.id) {
              const data = getVideoGeneratorData(sel);
              setActiveVideoGenId(sel.id as string);
              setVideoGenData(data);
              if (currentId) { setActiveGeneratorId(null); setGeneratorData(null); setGeneratorBounds(null); }
            }
            setVideoGenBounds({
              x: sel.x as number, y: sel.y as number,
              width: sel.width as number, height: sel.height as number,
            });
          } else if (
            sel.type === "embeddable" &&
            (isVideoUrl(sel.link as string) || sel.customData?.isVideo === true)
          ) {
            if (currentId) { setActiveGeneratorId(null); setGeneratorData(null); setGeneratorBounds(null); }
            if (currentVideoId) { setActiveVideoGenId(null); setVideoGenData(null); setVideoGenBounds(null); }
          } else {
            // Neither generator nor inline video -- close active generator panels.
            if (currentId || currentVideoId) {
              closeAllPanels();
            }
          }
        } else {
          setSelectedToolbar(null);
          // Zero or multiple selected -- close all panels if any was open.
          if (currentId || currentVideoId) {
            closeAllPanels();
          }
        }

        // --- Generating elements shimmer overlay ---
        // Build a stable key so we skip setState when the generating set is unchanged.
        const generatingRaw = elements.filter(
          (el: any) =>
            !el.isDeleted &&
            (isImageGeneratorElement(el) || isVideoGeneratorElement(el)) &&
            el.customData?.status === "generating",
        );

        // Quick identity check: IDs + positions as a serialized key
        const genKey = generatingRaw.map((el: any) =>
          `${el.id}:${el.x}:${el.y}:${el.width}:${el.height}`
        ).join("|");

        if (genKey !== prevGeneratingKeyRef.current) {
          prevGeneratingKeyRef.current = genKey;
          const generating = generatingRaw.map((el: any) => ({
            id: el.id as string,
            screenX: ((el.x as number) + scrollX) * zoom,
            screenY: ((el.y as number) + scrollY) * zoom,
            screenW: (el.width as number) * zoom,
            screenH: (el.height as number) * zoom,
            ...(el.customData?.model ? { model: el.customData.model as string } : {}),
          }));
          setGeneratingElements(generating);
        }
      },
    );

    return unsubscribe;
  }, [excalidrawApi, closeAllPanels]);

  const handleToolChange = useCallback(
    (tool: ToolType) => {
      excalidrawApi?.setActiveTool({ type: tool });
    },
    [excalidrawApi],
  );

  const handleFocusChat = useCallback(() => {
    const input = document.querySelector<HTMLTextAreaElement>("[data-chat-input]");
    input?.focus();
  }, []);

  const handleDeleteSelectedElement = useCallback(() => {
    if (!selectedToolbar) return;
    const nextElements = excalidrawApi
      .getSceneElements()
      .map((element: any) =>
        element.id === selectedToolbar.id
          ? { ...element, isDeleted: true, updated: Date.now() }
          : element,
      );
    excalidrawApi.updateScene({
      elements: nextElements,
      appState: { selectedElementIds: {} },
      captureUpdate: "IMMEDIATELY",
    });
    setSelectedToolbar(null);
  }, [excalidrawApi, selectedToolbar]);

  const handleDownloadSelected = useCallback(async () => {
    if (!selectedToolbar?.downloadUrl) return;
    const fallbackName =
      selectedToolbar.downloadFileName ??
      `${selectedToolbar.kind}-${selectedToolbar.id}`;
    try {
      const response = await fetch(selectedToolbar.downloadUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fallbackName;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(selectedToolbar.downloadUrl, "_blank", "noopener,noreferrer");
    }
  }, [selectedToolbar]);

  const handleCreateImageGenerator = useCallback(() => {
    if (!excalidrawApi) return;
    const elementId = createImageGeneratorElement(excalidrawApi);
    // Select the newly created element so onChange recognises it
    excalidrawApi.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
    });
    setActiveGeneratorId(elementId);
    // Read back the created element to populate initial state
    const elements = excalidrawApi.getSceneElements();
    const el = elements.find((e: any) => e.id === elementId);
    if (el) {
      setGeneratorData(getImageGeneratorData(el));
      setGeneratorBounds({
        x: el.x as number,
        y: el.y as number,
        width: el.width as number,
        height: el.height as number,
      });
    }
  }, [excalidrawApi]);

  const handleCloseGenerator = useCallback(() => {
    setActiveGeneratorId(null);
    setGeneratorData(null);
    setGeneratorBounds(null);
  }, []);

  const handleCreateVideoGenerator = useCallback(() => {
    if (!excalidrawApi) return;
    const videoId = createVideoGeneratorElement(excalidrawApi, {
      aspectRatio: "16:9",
    });
    excalidrawApi.updateScene({
      appState: { selectedElementIds: { [videoId]: true } },
    });
    setActiveVideoGenId(videoId);
    // Read back the created element to populate initial state
    const elements = excalidrawApi.getSceneElements();
    const el = elements.find((e: any) => e.id === videoId);
    if (el) {
      setVideoGenData(getVideoGeneratorData(el));
      setVideoGenBounds({
        x: el.x as number,
        y: el.y as number,
        width: el.width as number,
        height: el.height as number,
      });
    }
  }, [excalidrawApi]);

  const handleCloseVideoGenerator = useCallback(() => {
    setActiveVideoGenId(null);
    setVideoGenData(null);
    setVideoGenBounds(null);
  }, []);

  return (
    <>
      <div
        className="absolute top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-2xl border border-border bg-card/85 p-1.5 shadow-card backdrop-blur-lg transition-[left] duration-200"
        style={{
          left: leftPanelOpen ? 296 : 16,
        }}
      >
        {/* Standard Excalidraw tools */}
        {TOOL_GROUPS.map((tool, i) => {
          if (tool === null) {
            return (
              <div
                key={`sep-${i}`}
                className="my-0.5 h-px w-6 bg-border"
              />
            );
          }

          const Icon = TOOL_ICONS[tool];
          const isActive = activeTool === tool;

          return (
            <button
              key={tool}
              type="button"
              title={TOOL_LABELS[tool]}
              aria-label={TOOL_LABELS[tool]}
              onMouseDown={(e) => {
                e.preventDefault();
                handleToolChange(tool);
              }}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                isActive
                  ? "bg-foreground/8 text-foreground"
                  : "text-foreground/60 hover:bg-foreground/4 hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
            </button>
          );
        })}

        {/* Separator before AI tools */}
        <div className="my-0.5 h-px w-6 bg-border" />

        {/* AI Image -- creates a placeholder on canvas */}
        <button
          type="button"
          title="AI 生成图片"
          aria-label="AI 生成图片"
          onClick={handleCreateImageGenerator}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
            activeGeneratorId
              ? "bg-foreground/8 text-foreground"
              : "text-foreground/60 hover:bg-foreground/4 hover:text-foreground"
          }`}
        >
          <Sparkles className="size-4" />
        </button>

        {/* AI Video -- creates a placeholder on canvas */}
        <button
          type="button"
          title="AI 生成视频"
          aria-label="AI 生成视频"
          onClick={handleCreateVideoGenerator}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
            activeVideoGenId
              ? "bg-foreground/8 text-foreground"
              : "text-foreground/60 hover:bg-foreground/4 hover:text-foreground"
          }`}
        >
          <Video className="size-4" />
        </button>
      </div>

      {/* Image Generator Panel -- floats below the selected placeholder */}
      {activeGeneratorId && generatorData && generatorBounds && (
        <ImageGeneratorPanel
          elementId={activeGeneratorId}
          elementBounds={generatorBounds}
          data={generatorData}
          excalidrawApi={excalidrawApi}
          accessToken={accessToken}
          canvasScrollZoom={canvasScrollZoom}
          onClose={handleCloseGenerator}
        />
      )}

      {/* Video Generator Panel -- floats below the selected placeholder */}
      {activeVideoGenId && videoGenData && videoGenBounds && (
        <VideoGeneratorPanel
          elementId={activeVideoGenId}
          elementBounds={videoGenBounds}
          data={videoGenData}
          excalidrawApi={excalidrawApi}
          accessToken={accessToken}
          canvasScrollZoom={canvasScrollZoom}
          onClose={handleCloseVideoGenerator}
        />
      )}

      {selectedToolbar &&
        createPortal(
          <SelectedElementToolbar
            state={selectedToolbar}
            onAskAgent={handleFocusChat}
            onDelete={handleDeleteSelectedElement}
            onDownload={selectedToolbar.downloadUrl ? handleDownloadSelected : null}
          />,
          document.body,
        )}

      {/* Shimmer overlays for generating elements */}
      {generatingElements.length > 0 &&
        createPortal(
          <>
            {generatingElements.map((el) => (
              <GeneratingOverlay key={el.id} {...el} />
            ))}
          </>,
          document.body,
        )}

    </>
  );
}

const SelectedElementToolbar = memo(function SelectedElementToolbar({
  state,
  onAskAgent,
  onDelete,
  onDownload,
}: {
  state: SelectedElementToolbarState;
  onAskAgent: () => void;
  onDelete: () => void;
  onDownload: (() => void) | null;
}) {
  const [viewportWidth, setViewportWidth] = useState(1440);

  useEffect(() => {
    setViewportWidth(window.innerWidth);
  }, []);

  const top = Math.max(12, state.screenY - 48);
  const left = Math.max(
    12,
    Math.min(
      state.screenX + state.screenW / 2,
      viewportWidth - 12,
    ),
  );

  return (
    <div
      className="fixed z-110 -translate-x-1/2"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-card backdrop-blur-lg">
        <span className="max-w-45 truncate px-2 text-[11px] font-medium text-muted-foreground">
          {state.label}
        </span>
        <button
          type="button"
          onClick={onAskAgent}
          className="flex h-8 items-center gap-1 rounded-full px-3 text-xs text-foreground transition-colors hover:bg-muted"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          问 Agent
        </button>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="下载素材"
            aria-label="下载素材"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="删除元素"
          aria-label="删除元素"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});

function resolveToolbarState({
  element,
  files,
  scrollX,
  scrollY,
  zoom,
}: {
  element: any;
  files: Record<string, any>;
  scrollX: number;
  scrollY: number;
  zoom: number;
}): SelectedElementToolbarState | null {
  if (!element || element.isDeleted) return null;
  if (isImageGeneratorElement(element) || isVideoGeneratorElement(element)) {
    return null;
  }

  const screenX = ((element.x as number) + scrollX) * zoom;
  const screenY = ((element.y as number) + scrollY) * zoom;
  const screenW = (element.width as number) * zoom;

  if (element.type === "image" && element.fileId) {
    const file = files[element.fileId];
    const downloadUrl =
      element.customData?.storageUrl ??
      file?.dataURL;
    return {
      id: element.id as string,
      kind: "image",
      label: (element.customData?.title as string) ?? "图片容器",
      screenX,
      screenY,
      screenW,
      ...(typeof downloadUrl === "string" ? { downloadUrl } : {}),
      downloadFileName: "canvas-image.png",
    };
  }

  if (
    element.type === "embeddable" &&
    (isVideoUrl(element.link as string) || element.customData?.isVideo === true)
  ) {
    return {
      id: element.id as string,
      kind: "video",
      label: (element.customData?.title as string) ?? "视频容器",
      screenX,
      screenY,
      screenW,
      ...(typeof element.link === "string" ? { downloadUrl: element.link } : {}),
      downloadFileName: "canvas-video.mp4",
    };
  }

  if (element.type === "text") {
    return {
      id: element.id as string,
      kind: "text",
      label:
        typeof element.text === "string" && element.text.trim().length > 0
          ? element.text.trim()
          : "文本容器",
      screenX,
      screenY,
      screenW,
    };
  }

  return {
    id: element.id as string,
    kind: "shape",
    label: `${String(element.type)} 容器`,
    screenX,
    screenY,
    screenW,
  };
}
