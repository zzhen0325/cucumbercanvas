"use client";

import {
  type AgentExecutionNodeMeta,
  type CanvasViewport,
  type CucumberCanvasDocument,
  flattenNodes,
  getAgentExecutionMeta,
  getNodeSceneBounds,
} from "@cucumber/canvas-core";
import { type ViewportState, sceneToCanvasLocal } from "@cucumber/pen-renderer";
import type { PenNode } from "@cucumber/pen-types";
import {
  AlertTriangle,
  LoaderCircle,
  type LucideIcon,
  MessageCircle,
  PauseCircle,
} from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/lib/utils";
import {
  type AgentExecutionStatusBadgeState,
  getAgentExecutionStatusBadgeState,
  getAgentExecutionStatusReason,
} from "./canvas-overlays";
import {
  useCanvasRuntimeShallowSelector,
  useCanvasRuntimeStoreApi,
} from "./canvas-runtime-store";

const AGENT_EXECUTION_MARKER_STATUSES = new Set([
  "waiting",
  "running",
  "failed",
  "paused",
]);

export type AgentExecutionStatusMarkerState = AgentExecutionStatusBadgeState & {
  activityLabel: string;
  nodeId: string;
  statusReason?: string;
  x: number;
  y: number;
};

export type AgentExecutionStatusSummaryState = {
  failed: number;
  firstFailedNodeId?: string;
  firstPausedNodeId?: string;
  firstRunningNodeId?: string;
  firstWaitingNodeId?: string;
  paused: number;
  running: number;
  totalAttention: number;
  waiting: number;
};

type AgentExecutionStatusLayerInput = {
  activePageId: string | null | undefined;
  document: CucumberCanvasDocument;
  selection: readonly string[];
  viewport: Partial<CanvasViewport>;
};

export function getAgentExecutionStatusMarkerState(
  node: PenNode | null | undefined,
  options: {
    activePageId: string | null | undefined;
    document: CucumberCanvasDocument;
    selection: readonly string[];
    viewport: Partial<CanvasViewport>;
  },
): AgentExecutionStatusMarkerState | null {
  const execution = getAgentExecutionMeta(node);
  const badge = getAgentExecutionStatusBadgeState(node);
  if (!node || !execution || !badge) return null;
  if (!AGENT_EXECUTION_MARKER_STATUSES.has(execution.status)) return null;
  if (options.selection.includes(node.id)) return null;

  const bounds = getNodeSceneBounds(
    options.document,
    node.id,
    options.activePageId,
  );
  if (!bounds) return null;

  const viewport = toRendererViewport(options.viewport);
  const topRight = sceneToCanvasLocal(
    bounds.x + Math.max(0, bounds.width),
    bounds.y,
    viewport,
  );
  const statusReason = getAgentExecutionStatusReason(node);
  return {
    ...badge,
    activityLabel: getAgentExecutionStatusActivityLabel(execution),
    nodeId: node.id,
    ...(statusReason ? { statusReason } : {}),
    x: topRight.x,
    y: topRight.y,
  };
}

export function getAgentExecutionStatusLayerItems({
  activePageId,
  document,
  selection,
  viewport,
}: AgentExecutionStatusLayerInput): AgentExecutionStatusMarkerState[] {
  return flattenNodes(document, activePageId)
    .map((node) =>
      getAgentExecutionStatusMarkerState(node, {
        activePageId,
        document,
        selection,
        viewport,
      }),
    )
    .filter((item): item is AgentExecutionStatusMarkerState => Boolean(item));
}

export function getAgentExecutionStatusSummaryState(
  document: CucumberCanvasDocument,
  activePageId: string | null | undefined,
): AgentExecutionStatusSummaryState {
  const summary: AgentExecutionStatusSummaryState = {
    failed: 0,
    paused: 0,
    running: 0,
    totalAttention: 0,
    waiting: 0,
  };
  for (const node of flattenNodes(document, activePageId)) {
    const execution = getAgentExecutionMeta(node);
    if (!execution || !AGENT_EXECUTION_MARKER_STATUSES.has(execution.status)) {
      continue;
    }
    switch (execution.status) {
      case "failed":
        summary.firstFailedNodeId ??= node.id;
        summary.failed += 1;
        break;
      case "paused":
        summary.firstPausedNodeId ??= node.id;
        summary.paused += 1;
        break;
      case "running":
        summary.firstRunningNodeId ??= node.id;
        summary.running += 1;
        break;
      case "waiting":
        summary.firstWaitingNodeId ??= node.id;
        summary.waiting += 1;
        break;
      case "done":
        continue;
    }
    summary.totalAttention += 1;
  }
  return summary;
}

export function AgentExecutionStatusMarker({
  marker,
  onSelect,
}: {
  marker: AgentExecutionStatusMarkerState;
  onSelect?: (nodeId: string) => void;
}) {
  const Icon = agentExecutionStatusMarkerIcon(marker.tone);
  return (
    <button
      aria-label={`选择 Agent 执行节点：${marker.kindLabel}，状态：${marker.statusLabel}`}
      className={cn(
        "pointer-events-auto absolute z-20 flex h-7 max-w-44 -translate-x-full -translate-y-1/2 items-center gap-1.5 rounded-full border px-2 text-[10px] font-semibold shadow-card backdrop-blur-md transition-all duration-150 hover:-translate-y-[calc(50%+1px)] hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        agentExecutionStatusMarkerClassName(marker.tone),
      )}
      data-canvas-overlay="agent-execution-status-marker"
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(marker.nodeId);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      style={{ left: marker.x - 6, top: marker.y + 6 }}
      title={[
        marker.title,
        marker.kindLabel,
        marker.statusLabel,
        marker.statusReason,
      ]
        .filter(Boolean)
        .join(" · ")}
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0",
          marker.tone === "running" && "animate-spin",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          marker.tone === "running" && "animate-pulse",
          agentExecutionStatusMarkerDotClassName(marker.tone),
        )}
      />
      <span className="truncate">{marker.activityLabel}</span>
      <AgentExecutionStreamingTextCue tone={marker.tone} />
    </button>
  );
}

function AgentExecutionStreamingTextCue({
  tone,
}: {
  tone: AgentExecutionStatusBadgeState["tone"];
}) {
  if (tone !== "running") return null;
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 flex shrink-0 items-center gap-0.5"
      data-canvas-overlay="agent-execution-streaming-text"
    >
      {[0, 120, 240].map((delay) => (
        <span
          className="size-0.5 rounded-full bg-current opacity-70 motion-safe:animate-loading-dot"
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
      <span className="ml-0.5 h-3 w-px rounded-full bg-current opacity-60 motion-safe:animate-pulse" />
    </span>
  );
}

export function AgentExecutionStatusSummaryStrip({
  onSelectNode,
  summary,
}: {
  onSelectNode?: (nodeId: string) => void;
  summary: AgentExecutionStatusSummaryState;
}) {
  if (summary.totalAttention === 0) return null;
  const chips = [
    {
      count: summary.failed,
      label: "失败",
      nodeId: summary.firstFailedNodeId,
      tone: "failed",
    },
    {
      count: summary.running,
      label: "运行中",
      nodeId: summary.firstRunningNodeId,
      tone: "running",
    },
    {
      count: summary.waiting,
      label: "等待",
      nodeId: summary.firstWaitingNodeId,
      tone: "waiting",
    },
    {
      count: summary.paused,
      label: "已暂停",
      nodeId: summary.firstPausedNodeId,
      tone: "paused",
    },
  ] as const;
  return (
    <div
      aria-label={`当前页 Agent 执行状态：失败 ${summary.failed}，运行中 ${summary.running}，等待 ${summary.waiting}，已暂停 ${summary.paused}`}
      className="pointer-events-none absolute bottom-20 left-4 z-20 flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/88 px-2 py-1.5 text-[11px] font-medium text-foreground shadow-card backdrop-blur-md"
      data-canvas-overlay="agent-execution-status-summary"
    >
      {chips
        .filter((chip) => chip.count > 0)
        .map((chip) => (
          <button
            aria-label={`选择第一个${chip.label} Agent 执行节点，共 ${chip.count} 个`}
            className={cn(
              "pointer-events-auto flex h-5 items-center gap-1 rounded-md border px-1.5 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              agentExecutionStatusMarkerClassName(chip.tone),
            )}
            disabled={!chip.nodeId}
            key={chip.tone}
            onClick={(event) => {
              event.stopPropagation();
              if (chip.nodeId) onSelectNode?.(chip.nodeId);
            }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                agentExecutionStatusMarkerDotClassName(chip.tone),
              )}
            />
            <span>{chip.label}</span>
            <span className="tabular-nums">{chip.count}</span>
          </button>
        ))}
    </div>
  );
}

export function CanvasAgentExecutionStatusLayerConnected() {
  const store = useCanvasRuntimeStoreApi();
  const { activePageId, document, selection, viewport } =
    useCanvasRuntimeShallowSelector((state) => ({
      activePageId: state.activePageId,
      document: state.document,
      selection: state.selection,
      viewport: state.viewport,
    }));
  const markers = useMemo(
    () =>
      getAgentExecutionStatusLayerItems({
        activePageId,
        document,
        selection,
        viewport,
      }),
    [activePageId, document, selection, viewport],
  );
  const summary = useMemo(
    () => getAgentExecutionStatusSummaryState(document, activePageId),
    [activePageId, document],
  );

  if (markers.length === 0 && summary.totalAttention === 0) return null;
  return (
    <div
      aria-label="Agent execution status markers"
      className="pointer-events-none absolute inset-0 z-20"
      data-canvas-overlay="agent-execution-status-layer"
    >
      {markers.map((marker) => (
        <AgentExecutionStatusMarker
          key={marker.nodeId}
          marker={marker}
          onSelect={(nodeId) => {
            store.getState().setSelection([nodeId], {
              source: "agent-execution.status-marker.select",
            });
            console.info("[canvas-overlay] agent_execution.marker.select", {
              nodeId,
            });
          }}
        />
      ))}
      <AgentExecutionStatusSummaryStrip
        onSelectNode={(nodeId) => {
          store.getState().setSelection([nodeId], {
            source: "agent-execution.status-summary.select",
          });
          console.info("[canvas-overlay] agent_execution.summary.select", {
            nodeId,
          });
        }}
        summary={summary}
      />
    </div>
  );
}

function toRendererViewport(viewport: Partial<CanvasViewport>): ViewportState {
  const zoom =
    typeof viewport.zoom === "number" && Number.isFinite(viewport.zoom)
      ? viewport.zoom
      : 1;
  return {
    zoom: zoom > 0 ? zoom : 1,
    panX:
      typeof viewport.x === "number" && Number.isFinite(viewport.x)
        ? viewport.x
        : 0,
    panY:
      typeof viewport.y === "number" && Number.isFinite(viewport.y)
        ? viewport.y
        : 0,
  };
}

function agentExecutionStatusMarkerClassName(
  tone: AgentExecutionStatusBadgeState["tone"],
) {
  switch (tone) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "paused":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700";
    case "running":
      return "border-sky-500/35 bg-sky-500/12 text-sky-700 ring-1 ring-sky-500/10";
    case "waiting":
      return "border-border bg-card/90 text-muted-foreground";
  }
}

export function getAgentExecutionStatusActivityLabel(
  execution: AgentExecutionNodeMeta,
): string {
  switch (execution.status) {
    case "failed":
      return "处理失败";
    case "paused":
      return "已暂停";
    case "waiting":
      return "等待补充";
    case "done":
      return "已完成";
    case "running":
      return getRunningActivityLabel(execution);
  }
}

function getRunningActivityLabel(execution: AgentExecutionNodeMeta): string {
  if (execution.kind === "critique") return "评审中...";
  if (execution.kind === "comparison") return "对比方案...";
  if (execution.kind === "evidence") return "收集资料...";
  if (execution.kind === "final_deliverable") return "整理交付...";
  if (execution.kind === "variant_branch") return "探索方案...";
  if (execution.kind === "tool_call") {
    const toolName = execution.toolName?.toLowerCase() ?? "";
    if (toolName.includes("image") || toolName.includes("video")) {
      return "生成中...";
    }
    if (
      toolName.includes("critique") ||
      toolName.includes("validate") ||
      toolName.includes("inspect")
    ) {
      return "分析中...";
    }
    return "调用工具...";
  }
  return "分析中...";
}

function agentExecutionStatusMarkerIcon(
  tone: AgentExecutionStatusBadgeState["tone"],
): LucideIcon {
  switch (tone) {
    case "failed":
      return AlertTriangle;
    case "paused":
      return PauseCircle;
    case "waiting":
      return MessageCircle;
    case "running":
      return LoaderCircle;
    case "done":
      return LoaderCircle;
  }
}

function agentExecutionStatusMarkerDotClassName(
  tone: AgentExecutionStatusBadgeState["tone"],
) {
  switch (tone) {
    case "done":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "paused":
      return "bg-amber-500";
    case "running":
      return "bg-sky-500";
    case "waiting":
      return "bg-muted-foreground";
  }
}
