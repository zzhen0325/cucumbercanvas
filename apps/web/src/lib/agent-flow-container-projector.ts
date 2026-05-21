import type {
  AgentFlowContainerData,
  AgentTaskPlan,
  CanvasContainerRef,
  StreamEvent,
  ToolArtifact,
} from "@cucumber/shared";

import { getViewportCenter } from "./canvas-elements";

type ExcalidrawApiLike = {
  getSceneElements: () => readonly any[];
  getAppState: () => {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    zoom: { value: number };
  };
  updateScene: (scene: {
    elements?: any[];
    appState?: Record<string, unknown>;
    captureUpdate?: string;
  }) => void;
  scrollToContent?: (elements?: any[]) => void;
};

type FlowState = {
  runId: string;
  containerId: string;
  hostElementId: string;
  data: AgentFlowContainerData;
};

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 420;

export function createAgentFlowContainerProjector() {
  const flows = new Map<string, FlowState>();
  let queue: Promise<void> = Promise.resolve();

  return {
    projectEvent(api: ExcalidrawApiLike, event: StreamEvent): Promise<boolean> {
      let handled = false;
      queue = queue
        .then(async () => {
          handled = await projectEventInternal(api, event, flows);
        })
        .catch((error) => {
          console.error("[agent-flow] failed to project event:", error);
        })
        .then(() => undefined);
      return queue.then(() => handled);
    },
    clearProjectedFlows(api: ExcalidrawApiLike): Promise<void> {
      queue = queue
        .then(() => clearProjectedFlows(api, flows))
        .catch((error) => {
          console.error("[agent-flow] failed to clear containers:", error);
        });
      return queue;
    },
    highlightTool(api: ExcalidrawApiLike, toolCallId: string | null) {
      queue = queue
        .then(() => highlightTool(api, toolCallId, flows))
        .catch((error) => {
          console.error("[agent-flow] failed to highlight tool:", error);
        });
      return queue;
    },
  };
}

async function projectEventInternal(
  api: ExcalidrawApiLike,
  event: StreamEvent,
  flows: Map<string, FlowState>,
): Promise<boolean> {
  switch (event.type) {
    case "agent.flow.container.created":
      await upsertFlowContainer(api, event.container, event.data, flows);
      return true;
    case "agent.flow.container.updated":
      updateFlowData(api, event.containerId, event.data, flows);
      return true;
    case "task.plan.created": {
      const existing = Array.from(flows.values()).find(
        (flow) => flow.data.planId === event.plan.planId,
      );
      if (existing) return true;
      const container = createDefaultContainerRef(api, event.runId, event.plan);
      await upsertFlowContainer(
        api,
        container,
        {
          planId: event.plan.planId,
          runId: event.runId,
          steps: event.plan.steps,
          toolLinks: [],
          artifacts: [],
        },
        flows,
      );
      return true;
    }
    case "task.step.updated": {
      const flow = Array.from(flows.values()).find(
        (candidate) => candidate.data.planId === event.planId,
      );
      if (!flow) return false;
      const data: AgentFlowContainerData = {
        ...flow.data,
        steps: flow.data.steps.map((step) =>
          step.stepId === event.step.stepId ? event.step : step,
        ),
      };
      updateFlowData(api, flow.containerId, data, flows);
      return true;
    }
    case "tool.started":
    case "tool.completed": {
      const stepId = event.stepId;
      const flow = findFlowForToolEvent(flows, event.runId, stepId);
      if (!flow) return false;
      const artifacts =
        event.type === "tool.completed" ? (event.artifacts ?? []) : [];
      const data = mergeToolEvent(flow.data, event, artifacts);
      updateFlowData(api, flow.containerId, data, flows);
      return true;
    }
    default:
      return false;
  }
}

async function upsertFlowContainer(
  api: ExcalidrawApiLike,
  container: CanvasContainerRef,
  data: AgentFlowContainerData,
  flows: Map<string, FlowState>,
) {
  const existing = api
    .getSceneElements()
    .find((element: any) => element.id === container.hostElementId);

  if (existing) {
    updateFlowData(api, container.containerId, data, flows);
    return;
  }

  const { convertToExcalidrawElements } = await import(
    "@excalidraw/excalidraw"
  );
  const center = getViewportCenter(api.getAppState());
  const x =
    container.bounds.x !== 0
      ? container.bounds.x
      : Math.round(center.x - DEFAULT_WIDTH / 2);
  const y =
    container.bounds.y !== 0
      ? container.bounds.y
      : Math.round(center.y - DEFAULT_HEIGHT / 2);

  const [host] = convertToExcalidrawElements([
    {
      id: container.hostElementId,
      type: "embeddable",
      link: `https://cucumber.studio/agent-flow/${container.containerId}`,
      x,
      y,
      width: container.bounds.width || DEFAULT_WIDTH,
      height: container.bounds.height || DEFAULT_HEIGHT,
      customData: {
        traceType: "agent-flow-container",
        runId: data.runId,
        planId: data.planId,
        cucumberContainer: {
          ...container,
          bounds: {
            x,
            y,
            width: container.bounds.width || DEFAULT_WIDTH,
            height: container.bounds.height || DEFAULT_HEIGHT,
          },
        },
        agentFlowData: data,
      },
    } as any,
  ]);

  flows.set(container.containerId, {
    runId: data.runId,
    containerId: container.containerId,
    hostElementId: container.hostElementId,
    data,
  });

  api.updateScene({
    elements: [...api.getSceneElements(), host],
    captureUpdate: "IMMEDIATELY",
  });
}

function updateFlowData(
  api: ExcalidrawApiLike,
  containerId: string,
  data: AgentFlowContainerData,
  flows: Map<string, FlowState>,
) {
  let nextState = flows.get(containerId);
  let hostElementId = nextState?.hostElementId;
  const nextElements = api.getSceneElements().map((element: any) => {
    if (
      element.customData?.cucumberContainer?.kind === "agent_flow" &&
      element.customData?.cucumberContainer?.containerId === containerId
    ) {
      hostElementId = element.id;
      return bumpElement(element, {
        customData: {
          ...element.customData,
          agentFlowData: data,
          cucumberContainer: {
            ...element.customData.cucumberContainer,
            version:
              Number(element.customData.cucumberContainer.version ?? 0) + 1,
          },
        },
      });
    }
    return element;
  });

  if (!hostElementId) return;
  nextState = {
    runId: data.runId,
    containerId,
    hostElementId,
    data,
  };
  flows.set(containerId, nextState);
  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function clearProjectedFlows(
  api: ExcalidrawApiLike,
  flows: Map<string, FlowState>,
) {
  const nextElements = api
    .getSceneElements()
    .filter(
      (element: any) =>
        element.customData?.cucumberContainer?.kind !== "agent_flow",
    );
  flows.clear();
  api.updateScene({
    elements: nextElements as any[],
    captureUpdate: "IMMEDIATELY",
  });
}

function highlightTool(
  api: ExcalidrawApiLike,
  toolCallId: string | null,
  flows: Map<string, FlowState>,
) {
  let target: any | null = null;
  const nextElements = api.getSceneElements().map((element: any) => {
    if (element.customData?.cucumberContainer?.kind !== "agent_flow") {
      return element;
    }
    const data = element.customData.agentFlowData as
      | AgentFlowContainerData
      | undefined;
    const containsTool =
      toolCallId &&
      data?.toolLinks.some((tool) => tool.toolCallId === toolCallId);
    if (containsTool) target = element;
    return bumpElement(element, {
      customData: {
        ...element.customData,
        highlightToolCallId: containsTool ? toolCallId : undefined,
      },
    });
  });

  api.updateScene({
    elements: nextElements as any[],
    ...(target
      ? { appState: { selectedElementIds: { [target.id]: true } } }
      : {}),
    captureUpdate: "IMMEDIATELY",
  });
  if (target && typeof api.scrollToContent === "function") {
    try {
      api.scrollToContent([target]);
    } catch {
      api.scrollToContent();
    }
  }
}

function createDefaultContainerRef(
  api: ExcalidrawApiLike,
  runId: string,
  plan: AgentTaskPlan,
): CanvasContainerRef {
  const center = getViewportCenter(api.getAppState());
  const containerId = `agent-flow-${plan.planId}`;
  return {
    containerId,
    kind: "agent_flow",
    version: 0,
    hostElementId: `${containerId}-host`,
    bounds: {
      x: Math.round(center.x - DEFAULT_WIDTH / 2),
      y: Math.round(center.y - DEFAULT_HEIGHT / 2),
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    },
  };
}

function findFlowForToolEvent(
  flows: Map<string, FlowState>,
  runId: string,
  stepId?: string,
) {
  const candidates = Array.from(flows.values()).filter(
    (flow) => flow.runId === runId,
  );
  if (!stepId) return candidates[0] ?? null;
  return (
    candidates.find((flow) =>
      flow.data.steps.some((step) => step.stepId === stepId),
    ) ??
    candidates[0] ??
    null
  );
}

function mergeToolEvent(
  data: AgentFlowContainerData,
  event: Extract<StreamEvent, { type: "tool.started" | "tool.completed" }>,
  artifacts: ToolArtifact[],
): AgentFlowContainerData {
  return {
    ...data,
    toolLinks: [
      ...data.toolLinks.filter((tool) => tool.toolCallId !== event.toolCallId),
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.type === "tool.completed" ? "completed" : "running",
        ...(event.stepId ? { stepId: event.stepId } : {}),
        ...(event.subAgentName ? { subAgentName: event.subAgentName } : {}),
        ...(event.type === "tool.completed" && event.outputSummary
          ? { outputSummary: event.outputSummary }
          : {}),
      },
    ],
    artifacts:
      artifacts.length > 0 ? [...data.artifacts, ...artifacts] : data.artifacts,
  };
}

function bumpElement(element: any, patch: Record<string, unknown>) {
  return {
    ...element,
    ...patch,
    updated: Date.now(),
    version: (element.version ?? 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}
