"use client";

import type {
  AgentFlowContainerData,
  AgentTaskStepStatus,
} from "@cucumber/shared";

type AgentFlowContainerRendererProps = {
  element: {
    width?: number;
    height?: number;
    customData?: Record<string, unknown>;
  };
};

const STATUS_LABEL: Record<AgentTaskStepStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

const STATUS_CLASS: Record<AgentTaskStepStatus, string> = {
  pending: "border-border bg-muted text-muted-foreground",
  running: "border-blue-400 bg-blue-50 text-blue-700",
  completed: "border-emerald-400 bg-emerald-50 text-emerald-700",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  canceled: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

export function AgentFlowContainerRenderer({
  element,
}: AgentFlowContainerRendererProps) {
  const data = element.customData?.agentFlowData as
    | AgentFlowContainerData
    | undefined;
  const highlightToolCallId =
    typeof element.customData?.highlightToolCallId === "string"
      ? element.customData.highlightToolCallId
      : null;
  const width = Math.max(520, element.width ?? 760);
  const height = Math.max(320, element.height ?? 420);

  if (!data) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground"
      >
        Agent Flow is waiting for task data.
      </div>
    );
  }

  const stepGap = 92;
  const firstY = 118;
  const svgHeight = Math.max(height, firstY + data.steps.length * stepGap + 48);
  const activeTool = highlightToolCallId
    ? data.toolLinks.find((tool) => tool.toolCallId === highlightToolCallId)
    : null;

  return (
    <div
      style={{ width, height }}
      className="relative overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm"
      data-testid="agent-flow-container"
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Agent Flow</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {data.planId} · {data.steps.length} steps
              </p>
            </div>
            <div className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
              {
                data.toolLinks.filter((tool) => tool.status === "completed")
                  .length
              }
              /{data.toolLinks.length} tools
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto px-4 py-4">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 h-full w-full"
            viewBox={`0 0 ${width} ${svgHeight}`}
            preserveAspectRatio="none"
          >
            {data.steps.slice(1).map((step, index) => {
              const y1 = firstY + index * stepGap - 24;
              const y2 = firstY + (index + 1) * stepGap - 44;
              return (
                <line
                  key={`connector-${step.stepId}`}
                  x1="34"
                  y1={y1}
                  x2="34"
                  y2={y2}
                  stroke="currentColor"
                  strokeOpacity="0.18"
                  strokeWidth="2"
                />
              );
            })}
          </svg>

          <div className="relative space-y-3">
            {data.steps.map((step, index) => {
              const tools = data.toolLinks.filter(
                (tool) => tool.stepId === step.stepId,
              );
              const highlighted = activeTool?.stepId === step.stepId;
              return (
                <div
                  key={step.stepId}
                  className={`rounded-lg border p-3 transition-colors ${
                    highlighted
                      ? "border-blue-500 bg-blue-50/80"
                      : "border-border bg-background"
                  }`}
                  data-testid={`agent-flow-step-${step.stepId}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {step.title}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASS[step.status]}`}
                        >
                          {STATUS_LABEL[step.status]}
                        </span>
                        {step.agentName ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {step.agentName}
                          </span>
                        ) : null}
                      </div>
                      {step.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {step.description}
                        </p>
                      ) : null}
                      {step.target ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Target: {formatTarget(step.target)}
                        </p>
                      ) : null}
                      {tools.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tools.map((tool) => (
                            <span
                              key={tool.toolCallId}
                              className={`rounded-md border px-1.5 py-1 text-[11px] ${
                                tool.toolCallId === highlightToolCallId
                                  ? "border-blue-500 bg-blue-100 text-blue-800"
                                  : "border-border bg-muted/50 text-muted-foreground"
                              }`}
                            >
                              {tool.toolName} · {tool.status}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {data.artifacts.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">Artifacts</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.artifacts.map((artifact) => artifact.type).join(", ")}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatTarget(
  target: NonNullable<AgentFlowContainerData["steps"][number]["target"]>,
) {
  switch (target.kind) {
    case "selection":
      return target.elementIds.length
        ? `selection (${target.elementIds.length})`
        : "current selection";
    case "elementIds":
      return `${target.elementIds.length} elements`;
    case "region":
      return `region ${Math.round(target.bounds.width)}x${Math.round(target.bounds.height)}`;
    case "new_container":
      return target.label ?? "new container";
  }
}
