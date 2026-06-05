"use client";

import {
  type AgentExecutionContainer,
  type CanvasViewport,
  type CucumberCanvasDocument,
  flattenNodes,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionContainerMeta,
  getAgentExecutionMeta,
  getAgentExecutionNodePresentationUpdates,
  getAgentRunNodeViewModel,
  getNodeBounds,
  getNodeSceneBounds,
  setAgentExecutionCanvasCollapsed,
} from "@cucumber/canvas-core";
import { type ViewportState, sceneToCanvasLocal } from "@cucumber/pen-renderer";
import type { PenNode } from "@cucumber/pen-types";
import {
  ChevronUp,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleX,
  FileImage,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CanvasApi } from "./canvas-api";
import {
  useCanvasRuntimeShallowSelector,
  useCanvasRuntimeStoreApi,
} from "./canvas-runtime-store";

type AgentRunNodeContentLayerProps = {
  api: CanvasApi;
};

type AgentRunNodeOverlayState = {
  container: AgentExecutionContainer;
  height: number;
  node: PenNode;
  width: number;
  x: number;
  y: number;
  zoom: number;
};

const STATUS_STYLES = {
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  paused: "bg-muted text-muted-foreground",
  running: "bg-accent/40 text-foreground",
  waiting: "bg-muted text-muted-foreground",
} as const;

const STATUS_LABELS = {
  done: "已完成",
  failed: "失败",
  paused: "已暂停",
  running: "执行中",
  waiting: "等待中",
} as const;

const MIN_EXPANDED_WIDTH = 460;
const MAX_EXPANDED_WIDTH = 640;
const MIN_EXPANDED_HEIGHT = 220;
const MAX_EXPANDED_HEIGHT = 760;
const SIZE_WRITEBACK_EPSILON = 4;

export function AgentRunNodeContentLayer({
  api,
}: AgentRunNodeContentLayerProps) {
  const store = useCanvasRuntimeStoreApi();
  const { activePageId, document, viewport } = useCanvasRuntimeShallowSelector(
    (state) => ({
      activePageId: state.activePageId,
      document: state.document,
      viewport: state.viewport,
    }),
  );
  const overlays = useMemo(
    () =>
      getAgentRunNodeOverlayStates({
        activePageId,
        document,
        viewport,
      }),
    [activePageId, document, viewport],
  );

  const handleCollapse = useCallback(
    (node: PenNode) => {
      const toggled = setAgentExecutionCanvasCollapsed(node, true);
      const execution = getAgentExecutionMeta(toggled);
      if (!execution) return;
      const container = getAgentExecutionContainerMeta(toggled);
      const updates = {
        meta: toggled.meta,
        ...getAgentExecutionNodePresentationUpdates({
          ...(container ? { container } : {}),
          execution,
          node: toggled,
          width: getNodeBounds(toggled).width,
        }),
      } satisfies Partial<PenNode>;
      api.updateNode(node.id, updates);
      store.getState().setSelection([node.id], {
        source: "agent-run-node-content.collapse",
      });
      console.info("[canvas-agent-run-node] content.collapse", {
        nodeId: node.id,
        runId: container?.runId,
      });
    },
    [api, store],
  );
  const handleResize = useCallback(
    (node: PenNode, size: { height: number; width: number }) => {
      const currentBounds = getNodeBounds(node);
      if (
        Math.abs(currentBounds.width - size.width) < SIZE_WRITEBACK_EPSILON &&
        Math.abs(currentBounds.height - size.height) < SIZE_WRITEBACK_EPSILON
      ) {
        return;
      }
      api.updateNode(node.id, {
        height: size.height,
        width: size.width,
      });
      console.info("[canvas-agent-run-node] content.resize", {
        height: size.height,
        nodeId: node.id,
        width: size.width,
      });
    },
    [api],
  );

  if (overlays.length === 0) return null;

  return (
    <div
      aria-label="AgentRunNode content layer"
      className="pointer-events-none absolute inset-0 z-10"
      data-canvas-overlay="agent-run-node-content-layer"
    >
      {overlays.map((overlay) => (
        <AgentRunNodeContentOverlay
          key={overlay.node.id}
          overlay={overlay}
          onCollapse={handleCollapse}
          onResize={handleResize}
          onSelectArtifact={(nodeId) => {
            store.getState().setSelection([nodeId], {
              source: "agent-run-node-content.artifact.select",
            });
            console.info("[canvas-agent-run-node] artifact.select", {
              agentRunNodeId: overlay.node.id,
              artifactNodeId: nodeId,
            });
          }}
        />
      ))}
    </div>
  );
}

export function getAgentRunNodeOverlayStates(input: {
  activePageId: string | null | undefined;
  document: CucumberCanvasDocument;
  viewport: Partial<CanvasViewport>;
}): AgentRunNodeOverlayState[] {
  const viewport = toRendererViewport(input.viewport);
  return flattenNodes(input.document, input.activePageId)
    .map((node) => {
      const execution = getAgentExecutionMeta(node);
      const container = getAgentExecutionContainerMeta(node);
      if (
        !execution ||
        !container ||
        execution.kind !== "agent_run_node" ||
        getAgentExecutionCanvasCollapsed(execution)
      ) {
        return null;
      }
      const bounds = getNodeSceneBounds(
        input.document,
        node.id,
        input.activePageId,
      );
      if (!bounds) return null;
      const topLeft = sceneToCanvasLocal(bounds.x, bounds.y, viewport);
      const bottomRight = sceneToCanvasLocal(
        bounds.x + bounds.width,
        bounds.y + bounds.height,
        viewport,
      );
      const width = Math.max(1, bottomRight.x - topLeft.x);
      const height = Math.max(1, bottomRight.y - topLeft.y);
      return {
        container,
        height,
        node,
        width,
        x: topLeft.x,
        y: topLeft.y,
        zoom: viewport.zoom,
      } satisfies AgentRunNodeOverlayState;
    })
    .filter((state): state is AgentRunNodeOverlayState => state !== null);
}

function AgentRunNodeContentOverlay({
  overlay,
  onCollapse,
  onResize,
  onSelectArtifact,
}: {
  overlay: AgentRunNodeOverlayState;
  onCollapse: (node: PenNode) => void;
  onResize: (node: PenNode, size: { height: number; width: number }) => void;
  onSelectArtifact: (nodeId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const viewModel = getAgentRunNodeViewModel(overlay.container);
  const statusClassName = STATUS_STYLES[viewModel.status];
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const measuredHeight = section.scrollHeight;
    if (measuredHeight <= 0) return;
    const currentBounds = getNodeBounds(overlay.node);
    const desiredWidth = clampNumber(
      currentBounds.width,
      MIN_EXPANDED_WIDTH,
      MAX_EXPANDED_WIDTH,
    );
    const desiredHeight = clampNumber(
      Math.ceil(measuredHeight / overlay.zoom),
      MIN_EXPANDED_HEIGHT,
      MAX_EXPANDED_HEIGHT,
    );
    onResize(overlay.node, {
      height: desiredHeight,
      width: desiredWidth,
    });
  });

  return (
    <section
      ref={sectionRef}
      aria-label={`AgentRunNode：${viewModel.title}`}
      className="pointer-events-auto absolute overflow-hidden rounded-[18px] border border-success/20 bg-[#F8FFBF] text-foreground shadow-card"
      data-canvas-overlay="agent-run-node-content"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        height: overlay.height,
        left: overlay.x,
        top: overlay.y,
        width: overlay.width,
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3">
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-5 shrink-0 rounded-full",
              viewModel.status === "running"
                ? "bg-success motion-safe:animate-pulse"
                : "bg-success",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  statusClassName,
                )}
              >
                {STATUS_LABELS[viewModel.status]}
              </span>
            </div>
            <h3 className="mt-3 truncate text-sm font-semibold text-foreground">
              Agent 执行 · {viewModel.title}
            </h3>
          </div>
          <Button
            aria-label="收起 AgentRunNode"
            className="h-7 shrink-0 gap-1 rounded-full bg-background/80 px-2 text-[11px]"
            onClick={() => onCollapse(overlay.node)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronUp className="size-3" />
            收起
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pr-3 text-sm [scrollbar-gutter:stable]">
          {viewModel.failureReason ? (
            <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
              {viewModel.failureReason}
            </div>
          ) : null}

          {viewModel.reasoning ? (
            <Reasoning
              className="mb-3 rounded-lg bg-background/55 px-3 py-2"
              isStreaming={viewModel.reasoning.isStreaming}
            >
              <ReasoningTrigger
                className="text-xs"
                getThinkingMessage={(isStreaming) =>
                  isStreaming ? "思考中..." : "思考过程"
                }
              />
              <ReasoningContent className="mt-2 text-xs leading-5">
                {viewModel.reasoning.content}
              </ReasoningContent>
            </Reasoning>
          ) : null}

          {viewModel.tasks.length > 0 ? (
            <Queue className="mb-3 rounded-lg bg-background/45 p-2">
              <QueueSection defaultOpen>
                <QueueSectionTrigger>
                  <QueueSectionLabel
                    count={viewModel.tasks.length}
                    label="任务"
                    icon={<CircleDotDashed className="size-3.5" />}
                  />
                </QueueSectionTrigger>
                <QueueSectionContent>
                  <QueueList className="mt-1">
                    {viewModel.tasks.map((task) => (
                      <QueueItem key={task.id} className="px-1.5">
                        <div className="flex items-start gap-2">
                          <QueueItemIndicator
                            completed={task.status === "completed"}
                            className={
                              task.active ? "border-success bg-success/30" : ""
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <QueueItemContent
                              completed={task.status === "completed"}
                            >
                              {task.title}
                            </QueueItemContent>
                            {task.description ? (
                              <QueueItemDescription
                                completed={task.status === "completed"}
                              >
                                {task.description}
                              </QueueItemDescription>
                            ) : null}
                          </div>
                        </div>
                      </QueueItem>
                    ))}
                  </QueueList>
                </QueueSectionContent>
              </QueueSection>
            </Queue>
          ) : null}

          {viewModel.tools.map((tool) => (
            <Tool
              className="mb-3 rounded-xl bg-background/65"
              defaultOpen
              key={tool.id}
            >
              <ToolHeader
                className="gap-2 px-3 py-2 text-xs"
                state={tool.state}
                title={tool.toolName.replace(/_/g, " ")}
                type={tool.type}
              />
              <ToolContent className="space-y-2 p-3">
                {tool.input ? (
                  <AgentRunNodeDataBlock label="参数" value={tool.input} />
                ) : (
                  <AgentRunNodeNotice
                    icon={<CircleDashed className="size-3.5" />}
                    text={tool.inputMissingReason}
                  />
                )}
                {tool.outputSummary ? (
                  <AgentRunNodeNotice
                    icon={<CircleCheck className="size-3.5" />}
                    text={tool.outputSummary}
                  />
                ) : null}
                {tool.output || tool.errorText ? (
                  <AgentRunNodeDataBlock
                    label={tool.errorText ? "错误" : "结果"}
                    tone={tool.errorText ? "danger" : "default"}
                    value={tool.errorText ?? tool.output}
                  />
                ) : tool.outputMissingReason ? (
                  <AgentRunNodeNotice
                    icon={<CircleX className="size-3.5" />}
                    text={tool.outputMissingReason}
                  />
                ) : null}
              </ToolContent>
            </Tool>
          ))}

          {viewModel.messages.map((message) => (
            <div
              className="mb-3 rounded-lg bg-background/55 px-3 py-2 text-xs leading-5 text-muted-foreground"
              key={message.id}
            >
              <MessageResponse>{message.content}</MessageResponse>
            </div>
          ))}

          {viewModel.artifacts.length > 0 ? (
            <div className="grid gap-2">
              {viewModel.artifacts.map((artifact) => (
                <button
                  className="flex items-center gap-2 rounded-lg border border-border bg-background/65 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  key={artifact.nodeId}
                  onClick={() => onSelectArtifact(artifact.nodeId)}
                  type="button"
                >
                  <FileImage className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    画布产物 {artifact.nodeId}
                  </span>
                  <CircleCheck className="size-3.5 shrink-0 text-success" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AgentRunNodeNotice({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string | undefined;
}) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function AgentRunNodeDataBlock({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "danger" | "default";
  value: Record<string, unknown> | string | undefined;
}) {
  if (value === undefined) return null;
  const code =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 font-mono text-[11px] leading-4 [overflow-wrap:anywhere]",
          tone === "danger"
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-border bg-background/75 text-muted-foreground",
        )}
      >
        {code}
      </pre>
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
