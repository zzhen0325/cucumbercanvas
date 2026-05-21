import type {
  ImageArtifact,
  StreamEvent,
  ToolArtifact,
  VideoArtifact,
} from "@cucumber/shared";

import {
  createExcalidrawImageElement,
  fetchAsDataURL,
  getViewportCenter,
  scaleToFit,
} from "./canvas-elements";

type ExcalidrawApiLike = {
  getSceneElements: () => readonly any[];
  addFiles?: (
    files: { id: any; dataURL: any; mimeType: string; created: number }[],
  ) => void;
  getAppState: () => {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    zoom: { value: number };
  };
  updateScene: (scene: { elements: any[]; captureUpdate?: string }) => void;
};

type RunTraceState = {
  runId: string;
  groupId: string;
  frameRectId: string;
  titleTextId: string;
  originX: number;
  originY: number;
  nodeOrder: string[];
};

type ToolTraceState = {
  runId: string;
  rectId: string;
  textId: string;
  nodeY: number;
  input: Record<string, unknown> | undefined;
  connectorId: string | undefined;
  artifactPreviewId: string | undefined;
  artifactLabelId: string | undefined;
  artifactConnectorId: string | undefined;
  artifactKind: "image" | "video" | "fallback" | undefined;
};

const FRAME_WIDTH = 620;
const FRAME_PADDING_X = 20;
const FRAME_PADDING_TOP = 54;
const FRAME_PADDING_BOTTOM = 20;
const FRAME_MIN_HEIGHT = 120;
const NODE_WIDTH = 300;
const NODE_HEIGHT = 112;
const NODE_GAP = 20;
const ARTIFACT_PREVIEW_BOX = 180;
const ARTIFACT_LABEL_WIDTH = 180;
const ARTIFACT_LABEL_HEIGHT = 48;
const ARTIFACT_GAP = 32;
const RUN_GAP = 80;

export function createAgentTraceProjector() {
  const runs = new Map<string, RunTraceState>();
  const tools = new Map<string, ToolTraceState>();
  let queue: Promise<void> = Promise.resolve();

  return {
    projectEvent(api: ExcalidrawApiLike, event: StreamEvent): Promise<void> {
      queue = queue
        .then(() => projectEventInternal(api, event, runs, tools))
        .catch((error) => {
          console.error("[agent-trace] failed to project event:", error);
        });
      return queue;
    },
    clearProjectedTraces(api: ExcalidrawApiLike): Promise<void> {
      queue = queue
        .then(() => clearProjectedTraces(api, runs, tools))
        .catch((error) => {
          console.error("[agent-trace] failed to clear traces:", error);
        });
      return queue;
    },
    highlightRunForTool(
      api: ExcalidrawApiLike,
      toolCallId: string | null,
    ): Promise<void> {
      queue = queue
        .then(() => highlightRunForTool(api, toolCallId, runs, tools))
        .catch((error) => {
          console.error("[agent-trace] failed to highlight trace run:", error);
        });
      return queue;
    },
  };
}

async function projectEventInternal(
  api: ExcalidrawApiLike,
  event: StreamEvent,
  runs: Map<string, RunTraceState>,
  tools: Map<string, ToolTraceState>,
): Promise<void> {
  switch (event.type) {
    case "run.started":
      await ensureRunFrame(api, event.runId, runs);
      break;
    case "tool.started":
      await upsertToolNode(api, event, runs, tools);
      break;
    case "tool.completed":
      await upsertToolNode(api, event, runs, tools);
      break;
    case "run.completed":
      await updateRunTitle(api, event.runId, "completed", runs);
      break;
    case "run.failed":
      await updateRunTitle(api, event.runId, "failed", runs);
      break;
    case "run.canceled":
      await updateRunTitle(api, event.runId, "canceled", runs);
      break;
    default:
      break;
  }
}

async function ensureRunFrame(
  api: ExcalidrawApiLike,
  runId: string,
  runs: Map<string, RunTraceState>,
): Promise<RunTraceState> {
  const existing = runs.get(runId);
  if (existing) return existing;

  const { convertToExcalidrawElements } = await import(
    "@excalidraw/excalidraw"
  );
  const { x, y } = getNextRunOrigin(api);
  const groupId = `trace-run-${generateId()}`;
  const frameRectId = `trace-frame-${runId}`;
  const titleTextId = `trace-title-${runId}`;

  const created = convertToExcalidrawElements([
    {
      id: frameRectId,
      type: "rectangle",
      x,
      y,
      width: FRAME_WIDTH,
      height: FRAME_MIN_HEIGHT,
      strokeColor: "#94A3B8",
      backgroundColor: "#F8FAFC",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: { type: 3 },
      groupIds: [groupId],
      customData: {
        traceType: "run-frame",
        runId,
        traceStatus: "running",
      },
    } as any,
    {
      id: titleTextId,
      type: "text",
      x: x + FRAME_PADDING_X,
      y: y + 18,
      text: buildRunTitle(runId, "running"),
      fontSize: 18,
      fontFamily: 2,
      strokeColor: "#0F172A",
      groupIds: [groupId],
      customData: {
        traceType: "run-title",
        runId,
      },
    } as any,
  ]);

  const state: RunTraceState = {
    runId,
    groupId,
    frameRectId,
    titleTextId,
    originX: x,
    originY: y,
    nodeOrder: [],
  };

  runs.set(runId, state);
  api.updateScene({
    elements: [...api.getSceneElements(), ...created],
    captureUpdate: "IMMEDIATELY",
  });
  return state;
}

async function upsertToolNode(
  api: ExcalidrawApiLike,
  event: Extract<StreamEvent, { type: "tool.started" | "tool.completed" }>,
  runs: Map<string, RunTraceState>,
  tools: Map<string, ToolTraceState>,
): Promise<void> {
  const run = await ensureRunFrame(api, event.runId, runs);
  const existing = tools.get(event.toolCallId);

  if (!existing) {
    const { convertToExcalidrawElements } = await import(
      "@excalidraw/excalidraw"
    );
    const index = run.nodeOrder.length;
    const nodeX = run.originX + FRAME_PADDING_X;
    const nodeY =
      run.originY + FRAME_PADDING_TOP + index * (NODE_HEIGHT + NODE_GAP);
    const rectId = `trace-node-${event.toolCallId}`;
    const textId = `trace-text-${event.toolCallId}`;
    const nodeSkeletons: any[] = [
      {
        id: rectId,
        type: "rectangle",
        x: nodeX,
        y: nodeY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        strokeColor: getNodeStrokeColor(
          event.type === "tool.completed" ? "completed" : "running",
        ),
        backgroundColor: getNodeBackgroundColor(
          event.type === "tool.completed" ? "completed" : "running",
        ),
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        roundness: { type: 3 },
        groupIds: [run.groupId],
        customData: {
          traceType: "tool-node",
          runId: event.runId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          traceStatus:
            event.type === "tool.completed" ? "completed" : "running",
          traceDetail:
            event.type === "tool.completed"
              ? buildTraceDetail({
                  kind: "tool",
                  runId: event.runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: "completed",
                  input: undefined,
                  outputSummary: event.outputSummary,
                  artifacts: event.artifacts,
                  artifact: undefined,
                })
              : buildTraceDetail({
                  kind: "tool",
                  runId: event.runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: "running",
                  input: event.input,
                  outputSummary: undefined,
                  artifacts: undefined,
                  artifact: undefined,
                }),
        },
      } as any,
      {
        id: textId,
        type: "text",
        x: nodeX + 14,
        y: nodeY + 14,
        text:
          event.type === "tool.completed"
            ? buildTraceToolNodeText({
                toolName: event.toolName,
                status: "completed",
                ...(event.outputSummary
                  ? { outputSummary: event.outputSummary }
                  : {}),
                ...(event.artifacts ? { artifacts: event.artifacts } : {}),
              })
            : buildTraceToolNodeText({
                toolName: event.toolName,
                status: "running",
                ...(event.input ? { input: event.input } : {}),
              }),
        fontSize: 15,
        fontFamily: 2,
        strokeColor: "#0F172A",
        groupIds: [run.groupId],
        customData: {
          traceType: "tool-node-text",
          runId: event.runId,
          toolCallId: event.toolCallId,
          traceDetail:
            event.type === "tool.completed"
              ? buildTraceDetail({
                  kind: "tool",
                  runId: event.runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: "completed",
                  input: undefined,
                  outputSummary: event.outputSummary,
                  artifacts: event.artifacts,
                  artifact: undefined,
                })
              : buildTraceDetail({
                  kind: "tool",
                  runId: event.runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: "running",
                  input: event.input,
                  outputSummary: undefined,
                  artifacts: undefined,
                  artifact: undefined,
                }),
        },
      } as any,
    ];

    const previousToolCallId = run.nodeOrder[index - 1];
    const previousTool = previousToolCallId
      ? tools.get(previousToolCallId)
      : undefined;
    let connectorId: string | undefined;
    if (previousTool) {
      connectorId = `trace-connector-${previousToolCallId}-${event.toolCallId}`;
      nodeSkeletons.push(
        createVerticalConnectorSkeleton({
          id: connectorId,
          x: nodeX + NODE_WIDTH / 2,
          y: previousTool.nodeY + NODE_HEIGHT,
          length: nodeY - (previousTool.nodeY + NODE_HEIGHT),
          runId: event.runId,
        }),
      );
    }

    const nodeElements = convertToExcalidrawElements(nodeSkeletons);

    run.nodeOrder.push(event.toolCallId);
    tools.set(event.toolCallId, {
      runId: event.runId,
      rectId,
      textId,
      nodeY,
      input: event.type === "tool.started" ? event.input : undefined,
      connectorId,
      artifactPreviewId: undefined,
      artifactLabelId: undefined,
      artifactConnectorId: undefined,
      artifactKind: undefined,
    });

    api.updateScene({
      elements: [...api.getSceneElements(), ...nodeElements],
      captureUpdate: "IMMEDIATELY",
    });
    resizeRunFrame(api, run);
    if (event.type === "tool.completed" && event.artifacts?.length) {
      await upsertArtifactNode(api, run, tools.get(event.toolCallId)!, event);
    }
    return;
  }

  if (event.type !== "tool.completed") {
    return;
  }

  const nextElements = api.getSceneElements().map((element: any) => {
    if (element.id === existing.rectId) {
      return bumpElement(element, {
        strokeColor: getNodeStrokeColor("completed"),
        backgroundColor: getNodeBackgroundColor("completed"),
        customData: {
          ...element.customData,
          traceStatus: "completed",
          traceDetail: buildTraceDetail({
            kind: "tool",
            runId: event.runId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "completed",
            input: existing.input,
            outputSummary: event.outputSummary,
            artifacts: event.artifacts,
            artifact: undefined,
          }),
        },
      });
    }
    if (element.id === existing.textId) {
      return bumpElement(element, {
        text: buildTraceToolNodeText({
          toolName: event.toolName,
          status: "completed",
          ...(event.outputSummary
            ? { outputSummary: event.outputSummary }
            : {}),
          ...(event.artifacts ? { artifacts: event.artifacts } : {}),
        }),
        customData: {
          ...element.customData,
          traceDetail: buildTraceDetail({
            kind: "tool",
            runId: event.runId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "completed",
            input: existing.input,
            outputSummary: event.outputSummary,
            artifacts: event.artifacts,
            artifact: undefined,
          }),
        },
      });
    }
    return element;
  });

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
  if (event.artifacts?.length) {
    await upsertArtifactNode(api, run, existing, event);
  }
}

async function upsertArtifactNode(
  api: ExcalidrawApiLike,
  run: RunTraceState,
  tool: ToolTraceState,
  event: Extract<StreamEvent, { type: "tool.completed" }>,
): Promise<void> {
  if (!event.artifacts?.length) return;
  const artifacts = event.artifacts;
  const primaryArtifact = pickPreviewArtifact(artifacts);

  const nodeX = run.originX + FRAME_PADDING_X;
  const artifactX = nodeX + NODE_WIDTH + ARTIFACT_GAP;
  const previewY = tool.nodeY + 2;
  const labelY = previewY + ARTIFACT_PREVIEW_BOX + 8;

  if (tool.artifactPreviewId || tool.artifactLabelId) {
    clearArtifactElements(api, tool);
    tool.artifactPreviewId = undefined;
    tool.artifactLabelId = undefined;
    tool.artifactConnectorId = undefined;
    tool.artifactKind = undefined;
  }

  const detail = buildTraceDetail({
    kind: "artifact",
    runId: event.runId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status: "completed",
    input: tool.input,
    outputSummary: undefined,
    artifacts,
    artifact: primaryArtifact,
  });

  const { convertToExcalidrawElements } = await import(
    "@excalidraw/excalidraw"
  );
  const createdElements: any[] = [];
  const artifactConnectorId = `trace-artifact-link-${event.toolCallId}`;

  if (primaryArtifact?.type === "image" && api.addFiles) {
    try {
      const preview = await createArtifactImagePreview(
        api,
        primaryArtifact,
        artifactX,
        previewY,
        detail,
        event.runId,
        event.toolCallId,
      );
      createdElements.push(preview.element);
      tool.artifactPreviewId = preview.id;
      tool.artifactKind = "image";
    } catch (error) {
      console.warn(
        "[agent-trace] failed to create image artifact preview:",
        error,
      );
    }
  } else if (primaryArtifact?.type === "video") {
    const videoPreviewId = `trace-artifact-video-${event.toolCallId}`;
    const { width, height } = getArtifactPreviewSize(
      primaryArtifact.width,
      primaryArtifact.height,
    );
    const videoPreviewElements = convertToExcalidrawElements([
      {
        id: videoPreviewId,
        type: "embeddable",
        link: primaryArtifact.url,
        x: artifactX + Math.round((ARTIFACT_PREVIEW_BOX - width) / 2),
        y: previewY + Math.round((ARTIFACT_PREVIEW_BOX - height) / 2),
        width,
        height,
        groupIds: [run.groupId],
        customData: {
          traceType: "artifact-preview",
          traceDetail: detail,
          mimeType: primaryArtifact.mimeType,
          durationSeconds: primaryArtifact.durationSeconds,
          title: primaryArtifact.title ?? event.toolName,
          isVideo: true,
        },
      } as any,
    ]);
    createdElements.push(...videoPreviewElements);
    tool.artifactPreviewId = videoPreviewId;
    tool.artifactKind = "video";
  }

  const artifactLabelId = `trace-artifact-label-${event.toolCallId}`;
  const labelElements = convertToExcalidrawElements([
    ...(createdElements.length === 0
      ? [
          {
            id: `trace-artifact-fallback-${event.toolCallId}`,
            type: "rectangle",
            x: artifactX,
            y: previewY + 24,
            width: ARTIFACT_LABEL_WIDTH,
            height: 96,
            strokeColor: "#A855F7",
            backgroundColor: "#FAF5FF",
            fillStyle: "solid",
            strokeWidth: 1,
            strokeStyle: "solid",
            roughness: 0,
            opacity: 100,
            roundness: { type: 3 },
            groupIds: [run.groupId],
            customData: {
              traceType: "artifact-preview",
              runId: event.runId,
              toolCallId: event.toolCallId,
              traceDetail: detail,
            },
          } as any,
        ]
      : []),
    {
      id: artifactLabelId,
      type: "text",
      x: artifactX,
      y: labelY,
      text: buildArtifactNodeText(artifacts),
      width: ARTIFACT_LABEL_WIDTH,
      fontSize: 14,
      fontFamily: 2,
      strokeColor: "#581C87",
      groupIds: [run.groupId],
      customData: {
        traceType: "artifact-node-text",
        runId: event.runId,
        toolCallId: event.toolCallId,
        traceDetail: detail,
      },
    } as any,
    createHorizontalConnectorSkeleton({
      id: artifactConnectorId,
      x: nodeX + NODE_WIDTH,
      y: tool.nodeY + NODE_HEIGHT / 2,
      length: ARTIFACT_GAP,
      runId: event.runId,
    }),
  ]);

  const fallbackPreview = labelElements.find((element: any) =>
    String(element.id).startsWith("trace-artifact-fallback-"),
  );
  if (fallbackPreview) {
    createdElements.push(fallbackPreview);
    tool.artifactPreviewId = fallbackPreview.id;
    tool.artifactKind = "fallback";
  }
  createdElements.push(
    ...labelElements.filter(
      (element: any) =>
        !String(element.id).startsWith("trace-artifact-fallback-"),
    ),
  );

  tool.artifactLabelId = artifactLabelId;
  tool.artifactConnectorId = artifactConnectorId;

  api.updateScene({
    elements: [...api.getSceneElements(), ...createdElements],
    captureUpdate: "IMMEDIATELY",
  });
}

async function updateRunTitle(
  api: ExcalidrawApiLike,
  runId: string,
  status: "completed" | "failed" | "canceled",
  runs: Map<string, RunTraceState>,
): Promise<void> {
  const run = await ensureRunFrame(api, runId, runs);
  const nextElements = api.getSceneElements().map((element: any) => {
    if (element.id === run.frameRectId) {
      return bumpElement(element, {
        strokeColor:
          status === "failed"
            ? "#DC2626"
            : status === "canceled"
              ? "#B45309"
              : "#22C55E",
        customData: {
          ...element.customData,
          traceStatus: status,
        },
      });
    }
    if (element.id === run.titleTextId) {
      return bumpElement(element, {
        text: buildRunTitle(runId, status),
      });
    }
    return element;
  });

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function resizeRunFrame(api: ExcalidrawApiLike, run: RunTraceState) {
  const expectedHeight = Math.max(
    FRAME_MIN_HEIGHT,
    FRAME_PADDING_TOP +
      run.nodeOrder.length * NODE_HEIGHT +
      Math.max(0, run.nodeOrder.length - 1) * NODE_GAP +
      FRAME_PADDING_BOTTOM,
  );

  const nextElements = api.getSceneElements().map((element: any) => {
    if (element.id !== run.frameRectId) return element;
    if (element.height === expectedHeight) return element;
    return bumpElement(element, { height: expectedHeight });
  });

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function clearProjectedTraces(
  api: ExcalidrawApiLike,
  runs: Map<string, RunTraceState>,
  tools: Map<string, ToolTraceState>,
) {
  runs.clear();
  tools.clear();

  const nextElements = api
    .getSceneElements()
    .map((element: any) =>
      isTraceElement(element)
        ? bumpElement(element, { isDeleted: true })
        : element,
    );

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function clearArtifactElements(api: ExcalidrawApiLike, tool: ToolTraceState) {
  const ids = new Set(
    [
      tool.artifactPreviewId,
      tool.artifactLabelId,
      tool.artifactConnectorId,
    ].filter(Boolean),
  );
  if (ids.size === 0) return;

  const nextElements = api
    .getSceneElements()
    .map((element: any) =>
      ids.has(element.id) ? bumpElement(element, { isDeleted: true }) : element,
    );

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function highlightRunForTool(
  api: ExcalidrawApiLike,
  toolCallId: string | null,
  runs: Map<string, RunTraceState>,
  tools: Map<string, ToolTraceState>,
) {
  const activeRunId = resolveRunIdForTool(api, toolCallId, runs, tools);

  const nextElements = api.getSceneElements().map((element: any) => {
    if (!isTraceElement(element) || element.isDeleted) return element;

    const elementRunId = element.customData?.runId as string | undefined;
    const elementToolCallId = element.customData?.toolCallId as
      | string
      | undefined;

    const opacity = !activeRunId
      ? 100
      : elementRunId === activeRunId
        ? elementToolCallId === toolCallId
          ? 100
          : 80
        : 28;

    if (element.opacity === opacity) return element;
    return bumpElement(element, { opacity });
  });

  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function getNextRunOrigin(api: ExcalidrawApiLike): { x: number; y: number } {
  const elements = api
    .getSceneElements()
    .filter((element: any) => !element.isDeleted);
  const traceFrames = elements.filter((element: any) =>
    isRunFrameElement(element),
  );
  if (traceFrames.length > 0) {
    const firstX = traceFrames[0]?.x ?? 0;
    const maxBottom = Math.max(
      ...traceFrames.map((element: any) => element.y + element.height),
    );
    return { x: firstX, y: maxBottom + RUN_GAP };
  }

  const center = getViewportCenter(api.getAppState());
  const contentElements = elements.filter(
    (element: any) => !isTraceElement(element),
  );
  const rightEdge =
    contentElements.length > 0
      ? Math.max(
          ...contentElements.map(
            (element: any) => (element.x ?? 0) + (element.width ?? 0),
          ),
        )
      : center.x + 160;

  return {
    x: rightEdge + 120,
    y: center.y - 120,
  };
}

function isRunFrameElement(element: any): boolean {
  return element?.customData?.traceType === "run-frame";
}

function isTraceElement(element: any): boolean {
  return typeof element?.customData?.traceType === "string";
}

function resolveRunIdForTool(
  api: ExcalidrawApiLike,
  toolCallId: string | null,
  runs: Map<string, RunTraceState>,
  tools: Map<string, ToolTraceState>,
): string | null {
  if (!toolCallId) return null;

  const toolState = tools.get(toolCallId);
  if (toolState) return toolState.runId;

  for (const run of runs.values()) {
    if (run.nodeOrder.includes(toolCallId)) return run.runId;
  }

  const sceneMatch = api
    .getSceneElements()
    .find(
      (element: any) =>
        !element.isDeleted && element.customData?.toolCallId === toolCallId,
    );
  return (sceneMatch?.customData?.runId as string | undefined) ?? null;
}

function bumpElement(element: any, updates: Record<string, unknown>) {
  return {
    ...element,
    ...updates,
    version: ((element.version as number | undefined) ?? 1) + 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    updated: Date.now(),
  };
}

function buildRunTitle(
  runId: string,
  status: "running" | "completed" | "failed" | "canceled",
): string {
  return `Agent Run ${runId.slice(0, 8)}\n${status.toUpperCase()}`;
}

function getNodeStrokeColor(status: "running" | "completed"): string {
  return status === "completed" ? "#22C55E" : "#F59E0B";
}

function getNodeBackgroundColor(status: "running" | "completed"): string {
  return status === "completed" ? "#F0FDF4" : "#FFFBEB";
}

export function buildTraceToolNodeText({
  toolName,
  status,
  input,
  outputSummary,
  artifacts,
}: {
  toolName: string;
  status: "running" | "completed";
  input?: Record<string, unknown>;
  outputSummary?: string;
  artifacts?: ToolArtifact[];
}): string {
  const lines = [toolName, `Status: ${status}`];

  const inputPreview = summarizeRecord(input);
  if (inputPreview) {
    lines.push(`Input: ${inputPreview}`);
  }

  if (status === "completed") {
    lines.push(`Output: ${truncate(outputSummary ?? "completed", 120)}`);
    if (artifacts && artifacts.length > 0) {
      lines.push(
        `Artifacts: ${artifacts.map((artifact) => artifact.type).join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

export function buildArtifactNodeText(artifacts: ToolArtifact[]): string {
  const lines = ["Artifacts"];
  for (const artifact of artifacts.slice(0, 3)) {
    const label = artifact.title ? truncate(artifact.title, 28) : artifact.type;
    lines.push(`${artifact.type}: ${label}`);
  }
  if (artifacts.length > 3) {
    lines.push(`+${artifacts.length - 3} more`);
  }
  return lines.join("\n");
}

function summarizeRecord(
  value: Record<string, unknown> | undefined,
): string | null {
  if (!value) return null;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .slice(0, 3)
    .map(([key, item]) => `${key}=${formatValue(item)}`);

  if (entries.length === 0) return null;
  return truncate(entries.join(", "), 120);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return truncate(value, 36);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") return "object";
  return "unknown";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function generateId(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).slice(0, 20);
}

function createVerticalConnectorSkeleton({
  id,
  x,
  y,
  length,
  runId,
}: {
  id: string;
  x: number;
  y: number;
  length: number;
  runId: string;
}) {
  return {
    id,
    type: "arrow",
    x,
    y,
    points: [
      [0, 0],
      [0, length],
    ],
    strokeColor: "#CBD5E1",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    startArrowhead: null,
    endArrowhead: "triangle",
    groupIds: [],
    customData: {
      traceType: "trace-connector",
      runId,
    },
  } as any;
}

function createHorizontalConnectorSkeleton({
  id,
  x,
  y,
  length,
  runId,
}: {
  id: string;
  x: number;
  y: number;
  length: number;
  runId: string;
}) {
  return {
    id,
    type: "arrow",
    x,
    y,
    points: [
      [0, 0],
      [length, 0],
    ],
    strokeColor: "#C084FC",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    startArrowhead: null,
    endArrowhead: "triangle",
    groupIds: [],
    customData: {
      traceType: "trace-artifact-connector",
      runId,
    },
  } as any;
}

async function createArtifactImagePreview(
  api: ExcalidrawApiLike,
  artifact: ImageArtifact,
  x: number,
  y: number,
  detail: Record<string, unknown>,
  runId: string,
  toolCallId: string,
) {
  if (!api.addFiles) {
    throw new Error("Excalidraw addFiles is required for image previews");
  }

  const dataURL = await fetchAsDataURL(artifact.url);
  const fileId = `trace-artifact-file-${generateId()}`;
  api.addFiles([
    {
      id: fileId as any,
      dataURL: dataURL as any,
      mimeType: artifact.mimeType,
      created: Date.now(),
    },
  ]);

  const { width, height } = getArtifactPreviewSize(
    artifact.width,
    artifact.height,
  );
  const element = (await createExcalidrawImageElement({
    fileId,
    x: x + Math.round((ARTIFACT_PREVIEW_BOX - width) / 2),
    y: y + Math.round((ARTIFACT_PREVIEW_BOX - height) / 2),
    width,
    height,
    title: artifact.title ?? "Artifact preview",
    source: "generated",
    storageUrl: artifact.url,
  })) as any;
  element.id = `trace-artifact-image-${generateId()}`;
  element.groupIds = [];
  element.customData = {
    ...(element.customData ?? {}),
    traceType: "artifact-preview",
    runId,
    toolCallId,
    traceDetail: detail,
  };
  return { id: element.id as string, element };
}

function getArtifactPreviewSize(width: number, height: number) {
  const bounded = scaleToFit(width, height, ARTIFACT_PREVIEW_BOX);
  return bounded.width > ARTIFACT_PREVIEW_BOX ||
    bounded.height > ARTIFACT_PREVIEW_BOX
    ? {
        width: ARTIFACT_PREVIEW_BOX,
        height: ARTIFACT_PREVIEW_BOX,
      }
    : bounded;
}

function pickPreviewArtifact(artifacts: ToolArtifact[]) {
  return artifacts.find(
    (artifact) => artifact.type === "image" || artifact.type === "video",
  );
}

function buildTraceDetail({
  kind,
  runId,
  toolCallId,
  toolName,
  status,
  input,
  outputSummary,
  artifacts,
  artifact,
}: {
  kind: "tool" | "artifact";
  runId: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "completed";
  input: Record<string, unknown> | undefined;
  outputSummary: string | undefined;
  artifacts: ToolArtifact[] | undefined;
  artifact: ToolArtifact | undefined;
}) {
  return {
    kind,
    runId,
    toolCallId,
    toolName,
    status,
    ...(input ? { input } : {}),
    ...(outputSummary ? { outputSummary } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(artifact ? { artifact } : {}),
  };
}
