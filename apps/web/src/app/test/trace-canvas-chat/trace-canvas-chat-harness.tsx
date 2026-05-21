"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StreamEvent, ToolArtifact, ToolBlock } from "@cucumber/shared";
import type { CanvasSelectedElement } from "../../../components/canvas-editor";
import { CanvasEditor } from "../../../components/canvas-editor";
import { TraceDetailPanel } from "../../../components/canvas/trace-detail-panel";
import { VideoCanvasElement } from "../../../components/canvas/video-canvas-element";
import { ToolBlockView } from "../../../components/chat/tool-block-view";
import { createAgentTraceProjector } from "../../../lib/agent-trace-projector";
import { createExcalidrawImageElement } from "../../../lib/canvas-elements";

const ACCESS_TOKEN = "test-access-token";
const CANVAS_ID = "test-canvas";
const PROJECT_ID = "test-project";
const IMAGE_FILE_ID = "harness-image-file";
const IMAGE_ELEMENT_ID = "harness-image-element";
const VIDEO_ELEMENT_ID = "harness-video-element";
const VIDEO_SAMPLE_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const IMAGE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
    <rect width="240" height="120" fill="#e2f2ff" rx="20" />
    <rect x="18" y="18" width="96" height="84" fill="#6ba8ff" rx="14" />
    <circle cx="168" cy="42" r="18" fill="#ffb84d" />
    <path d="M128 96L164 60L192 84L222 48V102H128Z" fill="#2e7d32" />
  </svg>`,
)}`;

type HarnessApi = {
  addFiles: (
    files: { id: string; dataURL: string; mimeType: string; created: number }[],
  ) => void;
  getAppState: () => {
    scrollX: number;
    scrollY: number;
    selectedElementIds?: Record<string, boolean>;
    width: number;
    height: number;
    zoom: { value: number };
  };
  getSceneElements: () => readonly any[];
  scrollToContent?: (elements?: any[]) => void;
  updateScene: (scene: {
    appState?: Record<string, unknown>;
    elements?: any[];
    captureUpdate?: string;
  }) => void;
};

type TraceSceneElementState = {
  id: string;
  opacity: number | null;
  runId: string | null;
  toolCallId: string | null;
  traceType: string | null;
};

const DEMO_ARTIFACTS: ToolArtifact[] = [
  {
    type: "video",
    title: "Trace preview video",
    url: VIDEO_SAMPLE_URL,
    mimeType: "video/mp4",
    width: 320,
    height: 180,
    durationSeconds: 5,
  },
  {
    type: "image",
    title: "Chat preview image",
    url: IMAGE_DATA_URL,
    mimeType: "image/svg+xml",
    width: 240,
    height: 120,
  },
];

const TOOL_BLOCKS: ToolBlock[] = [
  {
    type: "tool",
    toolCallId: "tool-call-1",
    toolName: "generate_image",
    status: "completed",
    input: {
      prompt: "Create a product storyboard frame for an AI design workspace.",
      aspectRatio: "16:9",
      model: "seedream-v4",
    },
    output: {
      status: "ok",
      assetCount: 2,
    },
    outputSummary: "Generated a storyboard frame with media artifacts.",
    artifacts: DEMO_ARTIFACTS,
  },
  {
    type: "tool",
    toolCallId: "tool-call-2",
    toolName: "search_web",
    status: "completed",
    input: {
      query: "AI workspace interaction patterns",
    },
    outputSummary: "Collected three reference interaction patterns.",
  },
  {
    type: "tool",
    toolCallId: "tool-call-3",
    toolName: "get_brand_kit",
    status: "completed",
    input: {
      brand: "Cucumber Studio",
    },
    outputSummary: "Loaded brand kit colors and typography guidance.",
  },
];

function createTimestamp(seed: number) {
  return new Date(Date.UTC(2026, 4, 21, 8, 0, seed)).toISOString();
}

function buildDemoEvents(): StreamEvent[] {
  const generateImageBlock = TOOL_BLOCKS[0]!;
  const searchWebBlock = TOOL_BLOCKS[1]!;
  const brandKitBlock = TOOL_BLOCKS[2]!;

  return [
    {
      type: "run.started",
      runId: "run-alpha",
      sessionId: "session-alpha",
      conversationId: "conversation-alpha",
      timestamp: createTimestamp(1),
    },
    {
      type: "tool.started",
      runId: "run-alpha",
      toolCallId: "tool-call-1",
      toolName: "generate_image",
      input: generateImageBlock.input,
      timestamp: createTimestamp(2),
    },
    {
      type: "tool.completed",
      runId: "run-alpha",
      toolCallId: "tool-call-1",
      toolName: "generate_image",
      output: generateImageBlock.output,
      outputSummary: generateImageBlock.outputSummary,
      artifacts: DEMO_ARTIFACTS,
      timestamp: createTimestamp(3),
    },
    {
      type: "tool.started",
      runId: "run-alpha",
      toolCallId: "tool-call-2",
      toolName: "search_web",
      input: searchWebBlock.input,
      timestamp: createTimestamp(4),
    },
    {
      type: "tool.completed",
      runId: "run-alpha",
      toolCallId: "tool-call-2",
      toolName: "search_web",
      outputSummary: searchWebBlock.outputSummary,
      timestamp: createTimestamp(5),
    },
    {
      type: "run.completed",
      runId: "run-alpha",
      timestamp: createTimestamp(6),
    },
    {
      type: "run.started",
      runId: "run-beta",
      sessionId: "session-beta",
      conversationId: "conversation-beta",
      timestamp: createTimestamp(7),
    },
    {
      type: "tool.started",
      runId: "run-beta",
      toolCallId: "tool-call-3",
      toolName: "get_brand_kit",
      input: brandKitBlock.input,
      timestamp: createTimestamp(8),
    },
    {
      type: "tool.completed",
      runId: "run-beta",
      toolCallId: "tool-call-3",
      toolName: "get_brand_kit",
      outputSummary: brandKitBlock.outputSummary,
      timestamp: createTimestamp(9),
    },
    {
      type: "run.completed",
      runId: "run-beta",
      timestamp: createTimestamp(10),
    },
  ];
}

function createVideoElement() {
  return {
    type: "embeddable",
    id: VIDEO_ELEMENT_ID,
    x: -220,
    y: 110,
    width: 320,
    height: 180,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    roundness: null,
    boundElements: null,
    frameId: null,
    index: null,
    seed: 4242,
    version: 1,
    versionNonce: 4343,
    isDeleted: false,
    updated: Date.now(),
    link: VIDEO_SAMPLE_URL,
    locked: false,
    customData: {
      harnessId: "canvas-video",
      title: "Harness video",
      mimeType: "video/mp4",
      durationSeconds: 5,
    },
  };
}

function getTraceSceneState(api: HarnessApi): TraceSceneElementState[] {
  return api
    .getSceneElements()
    .filter((element) => !element.isDeleted && element.customData?.traceType)
    .map((element) => ({
      id: String(element.id),
      opacity: typeof element.opacity === "number" ? element.opacity : null,
      runId:
        typeof element.customData?.runId === "string"
          ? element.customData.runId
          : null,
      toolCallId:
        typeof element.customData?.toolCallId === "string"
          ? element.customData.toolCallId
          : null,
      traceType:
        typeof element.customData?.traceType === "string"
          ? element.customData.traceType
          : null,
    }));
}

function mapSceneElementToSelection(
  api: HarnessApi,
  element: any,
): CanvasSelectedElement {
  const base: CanvasSelectedElement = {
    id: String(element.id),
    type: String(element.type),
    x: Number(element.x ?? 0),
    y: Number(element.y ?? 0),
    width: Number(element.width ?? 0),
    height: Number(element.height ?? 0),
  };

  if (element.customData && typeof element.customData === "object") {
    base.customData = element.customData as Record<string, unknown>;
  }

  if (element.type === "image" && typeof element.fileId === "string") {
    base.fileId = element.fileId;
    base.dataUrl = IMAGE_DATA_URL;
    base.mimeType = "image/svg+xml";
    if (typeof element.customData?.title === "string") {
      base.title = element.customData.title;
    }
  }

  if (element.type === "embeddable" && typeof element.link === "string") {
    base.link = element.link;
    if (typeof element.customData?.mimeType === "string") {
      base.mimeType = element.customData.mimeType;
    }
    if (typeof element.customData?.title === "string") {
      base.title = element.customData.title;
    }
    if (typeof element.customData?.durationSeconds === "number") {
      base.durationSeconds = element.customData.durationSeconds;
    }
  }

  return base;
}

export function TraceCanvasChatHarness() {
  const projectorRef = useRef(createAgentTraceProjector());
  const seededRef = useRef(false);
  const canvasApiRef = useRef<HarnessApi | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<
    CanvasSelectedElement[]
  >([]);
  const [linkedToolCallId, setLinkedToolCallId] = useState<string | null>(null);
  const [traceSceneState, setTraceSceneState] = useState<
    TraceSceneElementState[]
  >([]);
  const [projectedRuns, setProjectedRuns] = useState(0);

  const selectedTraceElement =
    selectedCanvasElements.find(
      (element) =>
        element.customData && typeof element.customData.traceType === "string",
    ) ?? null;
  const selectedTraceToolCallId =
    (selectedTraceElement?.customData?.toolCallId as string | undefined) ??
    (
      selectedTraceElement?.customData?.traceDetail as
        | { toolCallId?: string }
        | undefined
    )?.toolCallId ??
    null;
  const activeTraceToolCallId = selectedTraceToolCallId ?? linkedToolCallId;

  const selectedElementSummary = useMemo(() => {
    const first = selectedCanvasElements[0];
    if (!first) return "none";
    if (typeof first.customData?.traceType === "string") {
      return String(first.customData.traceType);
    }
    if (first.type === "image") return "image";
    if (first.type === "embeddable") return "video";
    return first.type;
  }, [selectedCanvasElements]);

  const syncTraceScene = useCallback((api: HarnessApi | null) => {
    if (!api) return;
    setTraceSceneState(getTraceSceneState(api));
  }, []);

  const handleApiReady = useCallback(
    async (api: HarnessApi) => {
      canvasApiRef.current = api;
      if (seededRef.current) {
        setCanvasReady(true);
        syncTraceScene(api);
        return;
      }

      seededRef.current = true;
      api.addFiles([
        {
          id: IMAGE_FILE_ID,
          dataURL: IMAGE_DATA_URL,
          mimeType: "image/svg+xml",
          created: Date.now(),
        },
      ]);

      const imageElement = (await createExcalidrawImageElement({
        fileId: IMAGE_FILE_ID,
        x: -220,
        y: -80,
        width: 240,
        height: 120,
        title: "Harness image",
      })) as Record<string, unknown>;
      imageElement.id = IMAGE_ELEMENT_ID;
      imageElement.customData = {
        ...(imageElement.customData as Record<string, unknown> | undefined),
        harnessId: "canvas-image",
      };

      api.updateScene({
        elements: [
          ...api.getSceneElements(),
          imageElement,
          createVideoElement(),
        ],
        captureUpdate: "IMMEDIATELY",
      });
      setCanvasReady(true);
      syncTraceScene(api);
    },
    [syncTraceScene],
  );

  const applySelection = useCallback((elementId: string) => {
    const api = canvasApiRef.current;
    if (!api) return;

    const target =
      api
        .getSceneElements()
        .filter((element) => !element.isDeleted)
        .find((element) => String(element.id) === elementId) ?? null;

    if (!target) {
      setSelectedCanvasElements([]);
      return;
    }

    api.updateScene({
      appState: {
        selectedElementIds: {
          [elementId]: true,
        },
      },
      captureUpdate: "IMMEDIATELY",
    });
    setSelectedCanvasElements([mapSceneElementToSelection(api, target)]);

    if (target && typeof api.scrollToContent === "function") {
      try {
        api.scrollToContent([target]);
      } catch {
        api.scrollToContent();
      }
    }
  }, []);

  const selectSceneElement = useCallback(
    (predicate: (element: any) => boolean) => {
      const api = canvasApiRef.current;
      if (!api) return;

      const target =
        api
          .getSceneElements()
          .filter((element) => !element.isDeleted)
          .find(predicate) ?? null;
      if (!target) return;

      applySelection(String(target.id));
      syncTraceScene(api);
    },
    [applySelection, syncTraceScene],
  );

  const handleProjectTrace = useCallback(async () => {
    const api = canvasApiRef.current;
    if (!api) return;

    for (const event of buildDemoEvents()) {
      await projectorRef.current.projectEvent(api, event);
    }
    setProjectedRuns(2);
    syncTraceScene(api);
  }, [syncTraceScene]);

  const handleSelectCanvasImage = useCallback(() => {
    setLinkedToolCallId(null);
    setSelectedCanvasElements([
      {
        id: IMAGE_ELEMENT_ID,
        type: "image",
        x: -220,
        y: -80,
        width: 240,
        height: 120,
        fileId: IMAGE_FILE_ID,
        dataUrl: IMAGE_DATA_URL,
        mimeType: "image/svg+xml",
        title: "Harness image",
        customData: {
          harnessId: "canvas-image",
        },
      },
    ]);
  }, []);

  const handleSelectCanvasVideo = useCallback(() => {
    setLinkedToolCallId(null);
    setSelectedCanvasElements([
      {
        id: VIDEO_ELEMENT_ID,
        type: "embeddable",
        x: -220,
        y: 110,
        width: 320,
        height: 180,
        link: VIDEO_SAMPLE_URL,
        mimeType: "video/mp4",
        title: "Harness video",
        durationSeconds: 5,
        customData: {
          harnessId: "canvas-video",
        },
      },
    ]);
  }, []);

  const handleLinkToTrace = useCallback(
    (toolCallId: string) => {
      setLinkedToolCallId(toolCallId);
      const api = canvasApiRef.current;
      if (!api) return;

      const targetElement =
        api
          .getSceneElements()
          .filter((element) => !element.isDeleted)
          .find(
            (element) =>
              element.customData?.traceType === "tool-node" &&
              element.customData?.toolCallId === toolCallId,
          ) ??
        api
          .getSceneElements()
          .filter((element) => !element.isDeleted)
          .find((element) => element.customData?.toolCallId === toolCallId) ??
        null;

      if (!targetElement) return;

      applySelection(String(targetElement.id));
      if (typeof api.scrollToContent === "function") {
        try {
          api.scrollToContent([targetElement]);
        } catch {
          api.scrollToContent();
        }
      }
      syncTraceScene(api);
    },
    [applySelection, syncTraceScene],
  );

  const handleJumpToChat = useCallback((toolCallId: string) => {
    setLinkedToolCallId(toolCallId);
  }, []);

  useEffect(() => {
    if (!selectedTraceToolCallId) return;
    setLinkedToolCallId(selectedTraceToolCallId);
  }, [selectedTraceToolCallId]);

  useEffect(() => {
    const api = canvasApiRef.current;
    if (!api) return;

    void projectorRef.current
      .highlightRunForTool(api, activeTraceToolCallId)
      .then(() => {
        syncTraceScene(api);
      });
  }, [activeTraceToolCallId, syncTraceScene]);

  useEffect(() => {
    if (!linkedToolCallId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `chat-tool-block-${linkedToolCallId}`,
      );
      target?.scrollIntoView({ behavior: "auto", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [linkedToolCallId]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1720px] gap-4 p-4">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <header className="rounded-2xl border border-border bg-card p-3">
            <div className="flex flex-wrap gap-2">
              <button
                data-testid="project-demo-trace"
                type="button"
                onClick={() => void handleProjectTrace()}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Project Demo Trace
              </button>
              <button
                data-testid="select-canvas-image"
                type="button"
                onClick={handleSelectCanvasImage}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Select Canvas Image
              </button>
              <button
                data-testid="select-canvas-video"
                type="button"
                onClick={handleSelectCanvasVideo}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Select Canvas Video
              </button>
              <button
                data-testid="select-tool-call-1"
                type="button"
                onClick={() =>
                  selectSceneElement(
                    (element) =>
                      element.customData?.traceType === "tool-node" &&
                      element.customData?.toolCallId === "tool-call-1",
                  )
                }
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Select Tool Call 1
              </button>
              <button
                data-testid="select-artifact-tool-call-1"
                type="button"
                onClick={() =>
                  selectSceneElement(
                    (element) =>
                      element.customData?.traceType === "artifact-preview" &&
                      element.customData?.toolCallId === "tool-call-1",
                  )
                }
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Select Artifact 1
              </button>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <div data-testid="harness-ready">{String(canvasReady)}</div>
              <div data-testid="projected-runs">{projectedRuns}</div>
              <div data-testid="selected-element-summary">
                {selectedElementSummary}
              </div>
              <div data-testid="linked-tool-call-id">
                {linkedToolCallId ?? "none"}
              </div>
              <div data-testid="selected-trace-tool-call-id">
                {selectedTraceToolCallId ?? "none"}
              </div>
              <div data-testid="active-trace-tool-call-id">
                {activeTraceToolCallId ?? "none"}
              </div>
              <pre data-testid="selected-element-json">
                {JSON.stringify(selectedCanvasElements[0] ?? null, null, 2)}
              </pre>
            </div>
          </header>

          <div
            data-testid="canvas-shell"
            className="relative h-[780px] overflow-hidden rounded-2xl border border-border bg-card"
          >
            <CanvasEditor
              canvasId={CANVAS_ID}
              projectId={PROJECT_ID}
              accessToken={ACCESS_TOKEN}
              initialContent={{
                elements: [],
                appState: {},
                files: {},
              }}
              onApiReady={handleApiReady}
              onSelectionChange={setSelectedCanvasElements}
            />
            <TraceDetailPanel
              selectedElement={selectedTraceElement}
              onJumpToChat={handleJumpToChat}
            />
          </div>
        </section>

        <aside className="flex w-[420px] shrink-0 flex-col gap-3">
          <section className="rounded-2xl border border-border bg-card p-3">
            <h1 className="text-base font-semibold">
              Trace Canvas Chat Harness
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Exercises trace projection, detail linking, inline media, and
              chat-to-canvas navigation in one browser test page.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <h2 className="text-sm font-semibold">Inline Media Preview</h2>
            <div data-testid="inline-video-preview" className="mt-3">
              <VideoCanvasElement
                src={VIDEO_SAMPLE_URL}
                width={320}
                height={180}
              />
            </div>
          </section>

          <section
            data-testid="chat-scroll-container"
            className="h-[780px] overflow-y-auto rounded-2xl border border-border bg-card p-4"
          >
            <div className="space-y-4">
              {TOOL_BLOCKS.map((block) => (
                <ToolBlockView
                  key={block.toolCallId}
                  block={block}
                  isLinked={linkedToolCallId === block.toolCallId}
                  onLinkToTrace={handleLinkToTrace}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <h2 className="text-sm font-semibold">Trace Scene State</h2>
            <pre
              data-testid="trace-scene-state"
              className="mt-2 max-h-72 overflow-auto rounded-xl bg-muted/50 p-3 text-xs text-foreground"
            >
              {JSON.stringify(traceSceneState, null, 2)}
            </pre>
          </section>
        </aside>
      </div>
    </main>
  );
}
