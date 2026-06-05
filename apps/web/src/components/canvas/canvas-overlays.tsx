import {
  AGENT_EXECUTION_META_KEY,
  type AgentBinding,
  type CanvasOperation,
  type CucumberCanvasDocument,
  applyCanvasTransaction,
  findNode,
  findParent,
  flattenNodes,
  getActiveChildren,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
  getSelectionBounds,
  isConnectorLineNode,
} from "@cucumber/canvas-core";
import {
  type BooleanOpType,
  getBooleanOpRejectionReason,
} from "@cucumber/pen-core";
import { sceneToCanvasLocal } from "@cucumber/pen-renderer";
import type { LineNode, PenDocument, PenNode } from "@cucumber/pen-types";
import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useStore } from "zustand";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatAgentFailureReason } from "./agent-execution-failure-copy";
import {
  AgentExecutionFollowUpPill,
  getAgentExecutionFollowUpState,
} from "./agent-execution-follow-up-pill";
import { CanvasBooleanToolbar } from "./boolean-toolbar";
import type { CanvasApi, CanvasTool } from "./canvas-api";
import {
  getCanvasApiDocument,
  selectCanvasActiveTool,
  selectCanvasBooleanInputState,
  selectCanvasSelectedNodePanelState,
  selectCanvasToolbarState,
  useCanvasRuntimeSelector,
  useCanvasRuntimeShallowSelector,
  useCanvasRuntimeStoreApi,
} from "./canvas-runtime-store";
import { getDocumentSelection, isPenNode } from "./canvas-runtime-utils";
import { getTopLevelSelectionIds } from "./canvas-selection-helpers";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  getFirstSolidFillColor,
  getFontFamilyDisplayName,
  sortLocalFontFamilies,
} from "./canvas-text-measure";
import { CanvasEditorToolbar } from "./editor-toolbar";
import type {
  AgentExecutionContinueIntent,
  AgentExecutionContinueOptions,
} from "./property-panel/agent-execution-section";
import { CanvasPropertyPanel } from "./property-panel/canvas-property-panel";
import {
  deriveStickyStrokeColor,
  findStickyNoteTextNode,
  isStickyNoteNode,
} from "./sticky-note-tool";

const STICKY_BACKGROUND_SWATCHES = [
  "#FFFFFF",
  "#F3F4F6",
  "#FFB4A8",
  "#FFD9A8",
  "#FFE59A",
  "#B8F2C4",
  "#B2EEE8",
  "#B8E3FA",
  "#D8C3FA",
  "#F5A3D7",
];

const AGENT_SELECTED_BRANCH_FILL = "rgba(178,242,187,0.34)";
const AGENT_UNSELECTED_BRANCH_FILL = "rgba(208,191,255,0.28)";
const STICKY_TEXT_SWATCHES = [
  "#111827",
  "#5B481B",
  "#7F1D1D",
  "#7C2D12",
  "#14532D",
  "#134E4A",
  "#075985",
  "#581C87",
];
const STICKY_FONT_SIZE_OPTIONS = [16, 20, 24, 28, 32, 40];
type StickyLocalFontStatus = "idle" | "loading" | "loaded" | "failed";
type BrowserLocalFontData = {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
};
type WindowWithLocalFonts = Window & {
  queryLocalFonts?: () => Promise<BrowserLocalFontData[]>;
};

export type AgentCheckpointToolbarState = {
  canContinue: boolean;
  canRerun: boolean;
  continueReason: string;
  rerunReason: string;
  visible: boolean;
};

export type AgentCheckpointHoverState = AgentCheckpointToolbarState & {
  nodeId: string;
  title: string;
  x: number;
  y: number;
};

export type AgentExecutionStatusBadgeState = {
  kindLabel: string;
  statusLabel: string;
  title: string;
  tone: "done" | "failed" | "paused" | "running" | "waiting";
};

export type AgentExecutionHoverState = AgentExecutionStatusBadgeState & {
  nodeId: string;
  summary?: string;
  statusReason?: string;
  toolName?: string;
  x: number;
  y: number;
};

export type CanvasContextMenuState = {
  x: number;
  y: number;
  targetId: string | null;
  scenePoint: { x: number; y: number } | null;
};

type ConnectorLineNode = LineNode & {
  connector: NonNullable<LineNode["connector"]>;
};

export function getAgentCheckpointToolbarState(
  node: PenNode | null | undefined,
  hasContinuationHandler: boolean,
): AgentCheckpointToolbarState {
  const execution = getAgentExecutionMeta(node);
  if (execution?.kind !== "checkpoint") {
    return {
      canContinue: false,
      canRerun: false,
      continueReason: "",
      rerunReason: "",
      visible: false,
    };
  }
  const restartable = execution.checkpoint?.canRestartFromHere === true;
  return {
    canContinue: hasContinuationHandler,
    canRerun: restartable && hasContinuationHandler,
    continueReason: hasContinuationHandler
      ? ""
      : "当前画布没有接入 Agent 输入框，不能从此 checkpoint 继续。",
    rerunReason: restartable
      ? hasContinuationHandler
        ? ""
        : "当前画布没有接入 Agent 输入框，不能从此 checkpoint 重跑。"
      : "这个 checkpoint 只是进度记录，没有标记为可从此处重跑。",
    visible: true,
  };
}

export function getAgentExecutionStatusBadgeState(
  node: PenNode | null | undefined,
): AgentExecutionStatusBadgeState | null {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return null;
  return {
    kindLabel: getAgentExecutionKindLabel(execution.kind),
    statusLabel: getAgentExecutionStatusLabel(execution.status),
    title: execution.title,
    tone: execution.status,
  };
}

export function getAgentExecutionStatusReason(
  node: PenNode | null | undefined,
): string | undefined {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return undefined;
  if (execution.status === "waiting") {
    return execution.waitingForUser?.prompt;
  }
  if (execution.status === "failed") {
    return formatAgentFailureReason(
      execution.failure?.reason ?? execution.details?.errorReason,
    );
  }
  if (execution.status === "paused") {
    return execution.summary;
  }
  return undefined;
}

export function getAgentExecutionHoverState(
  node: PenNode | null | undefined,
  point: { x: number; y: number },
): AgentExecutionHoverState | null {
  const execution = getAgentExecutionMeta(node);
  const badge = getAgentExecutionStatusBadgeState(node);
  if (!node || !execution || !badge) return null;
  const statusReason = getAgentExecutionStatusReason(node);
  return {
    ...badge,
    nodeId: node.id,
    ...(execution.summary ? { summary: execution.summary } : {}),
    ...(statusReason ? { statusReason } : {}),
    ...(execution.toolName ? { toolName: execution.toolName } : {}),
    x: point.x,
    y: point.y,
  };
}

export function AgentExecutionStatusBadge({
  badge,
}: {
  badge: AgentExecutionStatusBadgeState | null;
}) {
  if (!badge) return null;
  return (
    <div
      aria-label={`Agent 执行节点：${badge.kindLabel}，状态：${badge.statusLabel}`}
      className={cn(
        "flex h-7 max-w-56 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium",
        agentExecutionBadgeClassName(badge.tone),
      )}
      data-canvas-overlay="agent-execution-status-badge"
      title={`${badge.title} · ${badge.kindLabel} · ${badge.statusLabel}`}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          agentExecutionBadgeDotClassName(badge.tone),
        )}
        aria-hidden="true"
      />
      <span className="truncate">{badge.kindLabel}</span>
      <span className="text-current/45" aria-hidden="true">
        ·
      </span>
      <span className="shrink-0">{badge.statusLabel}</span>
    </div>
  );
}

export function AgentExecutionHoverCard({
  execution,
}: {
  execution: AgentExecutionHoverState | null;
}) {
  if (!execution) return null;
  const detail =
    execution.toolName ??
    (execution.summary !== execution.statusReason
      ? execution.summary
      : undefined);
  const statusReasonLabel =
    execution.tone === "failed"
      ? "失败原因"
      : execution.tone === "waiting"
        ? "等待原因"
        : execution.tone === "paused"
          ? "暂停原因"
          : undefined;
  return (
    <div
      aria-label={`Agent 执行节点悬停摘要：${execution.kindLabel}，状态：${execution.statusLabel}`}
      className="pointer-events-none absolute z-30 w-64 rounded-xl border border-border bg-card/95 p-2 shadow-card ring-1 ring-foreground/5 backdrop-blur-lg"
      data-canvas-overlay="agent-execution-hover-card"
      style={{
        left: execution.x + 12,
        top: Math.max(12, execution.y + 12),
      }}
    >
      <AgentExecutionStatusBadge badge={execution} />
      <div className="mt-1 truncate text-xs font-medium text-foreground">
        {execution.title}
      </div>
      {execution.statusReason && statusReasonLabel ? (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {statusReasonLabel}：{execution.statusReason}
        </div>
      ) : null}
      {detail ? (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function agentExecutionBadgeClassName(
  tone: AgentExecutionStatusBadgeState["tone"],
) {
  switch (tone) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "failed":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "paused":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
    case "running":
      return "border-sky-500/25 bg-sky-500/10 text-sky-700";
    case "waiting":
      return "border-border bg-muted/70 text-muted-foreground";
  }
}

function agentExecutionBadgeDotClassName(
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

export function AgentCheckpointHoverToolbar({
  checkpoint,
  onContinueAgentExecution,
}: {
  checkpoint: AgentCheckpointHoverState | null;
  onContinueAgentExecution?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
}) {
  if (!checkpoint?.visible) return null;
  return (
    <div
      aria-label={`Checkpoint hover actions: ${checkpoint.title}`}
      className="pointer-events-auto absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 px-2 py-1 shadow-card ring-1 ring-foreground/5 backdrop-blur-lg"
      data-canvas-overlay="checkpoint-hover-toolbar"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      style={{
        left: checkpoint.x,
        top: Math.max(12, checkpoint.y - 48),
      }}
    >
      <span
        className="max-w-36 truncate px-1 text-[11px] font-medium text-muted-foreground"
        title={checkpoint.title}
      >
        {checkpoint.title}
      </span>
      <ToolbarMiniButton
        disabled={!checkpoint.canContinue}
        label="继续"
        onClick={() => {
          onContinueAgentExecution?.(checkpoint.nodeId, "continue");
          console.info("[skia-canvas] checkpoint.hover.continue", {
            nodeId: checkpoint.nodeId,
          });
        }}
        title={
          checkpoint.canContinue
            ? "从这个 checkpoint 继续"
            : checkpoint.continueReason
        }
      />
      <ToolbarMiniButton
        disabled={!checkpoint.canRerun}
        label="重跑"
        onClick={() => {
          onContinueAgentExecution?.(checkpoint.nodeId, "rerun_checkpoint");
          console.info("[skia-canvas] checkpoint.hover.rerun", {
            nodeId: checkpoint.nodeId,
          });
        }}
        title={
          checkpoint.canRerun
            ? "从这个 checkpoint 重跑后续执行链"
            : checkpoint.rerunReason
        }
      />
      <ToolbarMiniButton
        disabled={!checkpoint.canContinue}
        label="新分支"
        onClick={() => {
          onContinueAgentExecution?.(checkpoint.nodeId, "new_branch");
          console.info("[skia-canvas] checkpoint.hover.branch", {
            nodeId: checkpoint.nodeId,
          });
        }}
        title={
          checkpoint.canContinue
            ? "从这个 checkpoint 复制为新分支"
            : checkpoint.continueReason
        }
      />
    </div>
  );
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

export function CanvasEditorToolbarConnected({
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
      onCreateAgentInputNode={() => api.createAgentInputNode()}
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

export function CanvasBooleanToolbarConnected({
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

export function CanvasSelectionToolbarConnected({
  api,
  onContinueAgentExecution,
}: {
  api: Pick<
    CanvasApi,
    | "copySelection"
    | "deleteSelection"
    | "detachConnectorEndpoint"
    | "duplicateSelection"
    | "reorderNode"
    | "toggleNodeLocked"
    | "toggleNodeVisible"
    | "updateNode"
  >;
  canvasRect?: DOMRect;
  onContinueAgentExecution?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
}) {
  const {
    activePageId,
    document,
    selection,
    viewport: runtimeViewport,
  } = useCanvasRuntimeShallowSelector((state) => ({
    activePageId: state.activePageId,
    document: state.document,
    selection: state.selection,
    viewport: state.viewport,
  }));
  const [openStickyColorMenu, setOpenStickyColorMenu] = useState<{
    kind: "background" | "text";
    nodeId: string;
  } | null>(null);
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([]);
  const [localFontStatus, setLocalFontStatus] =
    useState<StickyLocalFontStatus>("idle");
  const [localFontError, setLocalFontError] = useState<string | null>(null);
  const [fontSearchQuery, setFontSearchQuery] = useState("");
  const loadLocalFonts = useCallback(async () => {
    if (localFontStatus === "loading" || localFontStatus === "loaded") return;
    if (typeof window === "undefined") {
      setLocalFontStatus("failed");
      setLocalFontError("当前环境无法读取本机字体。");
      console.warn("[skia-canvas] sticky.toolbar.local-fonts.unavailable", {
        reason: "window_unavailable",
      });
      return;
    }
    const localWindow = window as WindowWithLocalFonts;
    if (typeof localWindow.queryLocalFonts !== "function") {
      setLocalFontStatus("failed");
      setLocalFontError("当前浏览器不支持读取本机字体。");
      console.warn("[skia-canvas] sticky.toolbar.local-fonts.unavailable", {
        reason: "api_unavailable",
      });
      return;
    }

    setLocalFontStatus("loading");
    setLocalFontError(null);
    try {
      const fonts = await localWindow.queryLocalFonts();
      const families = sortLocalFontFamilies(fonts.map((font) => font.family));
      setLocalFontFamilies(families);
      setLocalFontStatus("loaded");
      console.info("[skia-canvas] sticky.toolbar.local-fonts.loaded", {
        familyCount: families.length,
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "未获得读取本机字体权限，无法展示本机字体。"
          : `读取本机字体失败：${
              error instanceof Error ? error.message : String(error)
            }`;
      setLocalFontStatus("failed");
      setLocalFontError(message);
      console.warn("[skia-canvas] sticky.toolbar.local-fonts.failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }, [localFontStatus]);
  const selectedNodeId = selection.length === 1 ? (selection[0] ?? null) : null;
  const selectedNode = selectedNodeId
    ? findNode(document, selectedNodeId, activePageId)
    : null;
  const connector: ConnectorLineNode | null = isConnectorLineNode(
    selectedNode ?? undefined,
  )
    ? (selectedNode as ConnectorLineNode)
    : null;
  const checkpointToolbarState = getAgentCheckpointToolbarState(
    selectedNode,
    Boolean(onContinueAgentExecution),
  );
  const agentExecutionStatusBadge =
    getAgentExecutionStatusBadgeState(selectedNode);
  const isLocked = Boolean(selectedNode?.locked);
  const isHidden = selectedNode?.visible === false;
  const stickyTextNode =
    selectedNode && isStickyNoteNode(selectedNode)
      ? findStickyNoteTextNode(selectedNode)
      : null;
  const stickyTextWeight = String(
    (stickyTextNode as { fontWeight?: string | number } | null)?.fontWeight ??
      "400",
  );
  const stickyBackgroundColor = selectedNode
    ? getFirstSolidFillColor(selectedNode, "#FFE59A")
    : "#FFE59A";
  const stickyTextColor = stickyTextNode
    ? getFirstSolidFillColor(stickyTextNode, "#111827")
    : "#111827";
  const stickyFontFamily =
    (stickyTextNode as { fontFamily?: string } | null)?.fontFamily ??
    DEFAULT_TEXT_FONT_FAMILY;
  const stickyFontName = getFontFamilyDisplayName(stickyFontFamily);
  const stickyFontSize =
    (stickyTextNode as { fontSize?: number } | null)?.fontSize ?? 24;
  const filteredLocalFontFamilies = useMemo(() => {
    const normalizedQuery = fontSearchQuery.trim().toLowerCase();
    const currentFontFamilies: string[] = [];
    const otherFontFamilies: string[] = [];
    for (const family of localFontFamilies) {
      const displayName = getFontFamilyDisplayName(family);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        family.toLowerCase().includes(normalizedQuery) ||
        displayName.toLowerCase().includes(normalizedQuery);
      if (!matchesQuery) continue;
      const isCurrentFamily =
        family === stickyFontFamily || displayName === stickyFontName;
      if (isCurrentFamily) {
        currentFontFamilies.push(family);
      } else {
        otherFontFamilies.push(family);
      }
    }
    return [...currentFontFamilies, ...otherFontFamilies];
  }, [fontSearchQuery, localFontFamilies, stickyFontFamily, stickyFontName]);
  const viewport = {
    panX: runtimeViewport.x ?? 0,
    panY: runtimeViewport.y ?? 0,
    zoom: runtimeViewport.zoom ?? 1,
  };
  if (selection.length === 0) return null;
  const bounds = getSelectionBounds(document, selection, activePageId);
  if (!bounds) return null;
  const topCenter = sceneToCanvasLocal(
    bounds.x + bounds.width / 2,
    bounds.y,
    viewport,
  );
  const bottomCenter = sceneToCanvasLocal(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height,
    viewport,
  );
  const agentExecutionFollowUp = getAgentExecutionFollowUpState(
    selectedNode,
    bottomCenter,
    Boolean(onContinueAgentExecution),
  );
  const isStickyBackgroundMenuOpen =
    openStickyColorMenu?.kind === "background" &&
    openStickyColorMenu.nodeId === selectedNode?.id;
  const isStickyTextMenuOpen =
    openStickyColorMenu?.kind === "text" &&
    openStickyColorMenu.nodeId === selectedNode?.id;
  const updateStickyBackground = (color: string) => {
    if (!selectedNode) return;
    api.updateNode(selectedNode.id, {
      fill: [{ type: "solid", color }],
      stroke: {
        ...("stroke" in selectedNode && selectedNode.stroke
          ? selectedNode.stroke
          : { thickness: 1 }),
        fill: [{ type: "solid", color: deriveStickyStrokeColor(color) }],
      },
    } as Partial<PenNode>);
    console.info("[skia-canvas] sticky.toolbar.background.updated", {
      stickyId: selectedNode.id,
      color,
    });
  };
  const updateStickyText = (updates: Partial<PenNode>) => {
    if (!selectedNode || !stickyTextNode) return;
    api.updateNode(stickyTextNode.id, updates);
    console.info("[skia-canvas] sticky.toolbar.text.updated", {
      stickyId: selectedNode.id,
      textNodeId: stickyTextNode.id,
      fields: Object.keys(updates),
    });
  };

  return (
    <>
      <div
        data-canvas-overlay="selection-toolbar"
        className="pointer-events-auto absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/90 px-2 py-1 shadow-card backdrop-blur-lg"
        style={{
          left: topCenter.x,
          top: Math.max(12, topCenter.y - 80),
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {agentExecutionStatusBadge ? (
          <>
            <AgentExecutionStatusBadge badge={agentExecutionStatusBadge} />
            <div className="h-5 w-px bg-border" />
          </>
        ) : null}
        {selectedNode && stickyTextNode ? (
          <>
            <ToolbarColorDropdown
              colors={STICKY_BACKGROUND_SWATCHES}
              currentColor={stickyBackgroundColor}
              label="Sticky background"
              open={isStickyBackgroundMenuOpen}
              shortLabel="Bg"
              onSelect={(color) => {
                updateStickyBackground(color);
                setOpenStickyColorMenu(null);
              }}
              onToggle={() =>
                setOpenStickyColorMenu(
                  isStickyBackgroundMenuOpen
                    ? null
                    : { kind: "background", nodeId: selectedNode.id },
                )
              }
            />
            <ToolbarColorDropdown
              colors={STICKY_TEXT_SWATCHES}
              currentColor={stickyTextColor}
              label="Sticky text"
              open={isStickyTextMenuOpen}
              shortLabel="T"
              onSelect={(color) => {
                updateStickyText({
                  fill: [{ type: "solid", color }],
                } as Partial<PenNode>);
                setOpenStickyColorMenu(null);
              }}
              onToggle={() =>
                setOpenStickyColorMenu(
                  isStickyTextMenuOpen
                    ? null
                    : { kind: "text", nodeId: selectedNode.id },
                )
              }
            />
            <div className="h-5 w-px bg-border" />
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => {
                setFontSearchQuery("");
                if (open) void loadLocalFonts();
              }}
            >
              <DropdownMenuTrigger
                aria-label="Sticky text font"
                className="flex h-7 min-w-24 max-w-40 items-center justify-between gap-2 rounded-lg px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                title="Sticky text font"
              >
                <span className="truncate">{stickyFontName}</span>
                <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-64 p-0"
                data-canvas-overlay="selection-toolbar"
                sideOffset={8}
              >
                <div className="border-b border-border p-2">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      autoFocus
                      aria-label="搜索本机字体"
                      className="h-8 border-0 bg-muted/60 pr-2 pl-7 text-xs shadow-none ring-0"
                      onChange={(event) =>
                        setFontSearchQuery(event.target.value)
                      }
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder="搜索字体"
                      value={fontSearchQuery}
                    />
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  <DropdownMenuGroup>
                    {localFontStatus === "loading" ? (
                      <DropdownMenuItem disabled>
                        正在读取本机字体...
                      </DropdownMenuItem>
                    ) : null}
                    {localFontStatus === "failed" && localFontError ? (
                      <DropdownMenuItem disabled>
                        {localFontError}
                      </DropdownMenuItem>
                    ) : null}
                    {localFontStatus === "loaded" &&
                    localFontFamilies.length === 0 ? (
                      <DropdownMenuItem disabled>
                        未从当前设备读取到可用字体。
                      </DropdownMenuItem>
                    ) : null}
                    {localFontStatus === "loaded" &&
                    localFontFamilies.length > 0 &&
                    filteredLocalFontFamilies.length === 0 ? (
                      <DropdownMenuItem disabled>
                        未找到匹配“{fontSearchQuery.trim()}”的字体。
                      </DropdownMenuItem>
                    ) : null}
                    {filteredLocalFontFamilies.map((family) => (
                      <DropdownMenuItem
                        key={family}
                        className={cn(
                          "justify-between",
                          family === stickyFontFamily ||
                            getFontFamilyDisplayName(family) === stickyFontName
                            ? "bg-accent/60 text-accent-foreground"
                            : undefined,
                        )}
                        onClick={() =>
                          updateStickyText({
                            fontFamily: family,
                          } as Partial<PenNode>)
                        }
                      >
                        <span
                          className="truncate"
                          style={{ fontFamily: family }}
                        >
                          {family}
                        </span>
                        {family === stickyFontFamily ||
                        getFontFamilyDisplayName(family) === stickyFontName ? (
                          <Check
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                aria-label="Sticky text size"
                className="flex h-7 min-w-16 items-center justify-between gap-2 rounded-lg px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                title="Sticky text size"
              >
                <span>{stickyFontSize}</span>
                <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-20"
                data-canvas-overlay="selection-toolbar"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  {STICKY_FONT_SIZE_OPTIONS.map((size) => (
                    <DropdownMenuItem
                      key={size}
                      className="justify-between"
                      onClick={() =>
                        updateStickyText({
                          fontSize: size,
                        } as Partial<PenNode>)
                      }
                    >
                      <span>{size}</span>
                      {stickyFontSize === size ? (
                        <Check
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolbarMiniButton
              active={
                Number(stickyTextWeight) >= 600 || stickyTextWeight === "bold"
              }
              label="B"
              onClick={() =>
                updateStickyText({
                  fontWeight:
                    Number(stickyTextWeight) >= 600 ||
                    stickyTextWeight === "bold"
                      ? "400"
                      : "700",
                } as Partial<PenNode>)
              }
            />
            <ToolbarMiniButton
              active={
                (
                  stickyTextNode as {
                    listStyle?: "none" | "ordered" | "unordered";
                  }
                ).listStyle === "unordered"
              }
              label="•"
              onClick={() =>
                updateStickyText({
                  listStyle:
                    (
                      stickyTextNode as {
                        listStyle?: "none" | "ordered" | "unordered";
                      }
                    ).listStyle === "unordered"
                      ? "none"
                      : "unordered",
                } as Partial<PenNode>)
              }
            />
            <div className="h-5 w-px bg-border" />
          </>
        ) : null}
        {checkpointToolbarState.visible && selectedNode ? (
          <>
            <ToolbarMiniButton
              disabled={!checkpointToolbarState.canContinue}
              label="继续"
              onClick={() => {
                onContinueAgentExecution?.(selectedNode.id, "continue");
                console.info("[skia-canvas] checkpoint.toolbar.continue", {
                  nodeId: selectedNode.id,
                });
              }}
              title={
                checkpointToolbarState.canContinue
                  ? "从这个 checkpoint 继续"
                  : checkpointToolbarState.continueReason
              }
            />
            <ToolbarMiniButton
              disabled={!checkpointToolbarState.canRerun}
              label="重跑"
              onClick={() => {
                onContinueAgentExecution?.(selectedNode.id, "rerun_checkpoint");
                console.info("[skia-canvas] checkpoint.toolbar.rerun", {
                  nodeId: selectedNode.id,
                });
              }}
              title={
                checkpointToolbarState.canRerun
                  ? "从这个 checkpoint 重跑后续执行链"
                  : checkpointToolbarState.rerunReason
              }
            />
            <ToolbarMiniButton
              disabled={!checkpointToolbarState.canContinue}
              label="新分支"
              onClick={() => {
                onContinueAgentExecution?.(selectedNode.id, "new_branch");
                console.info("[skia-canvas] checkpoint.toolbar.branch", {
                  nodeId: selectedNode.id,
                });
              }}
              title={
                checkpointToolbarState.canContinue
                  ? "从这个 checkpoint 复制为新分支"
                  : checkpointToolbarState.continueReason
              }
            />
            <div className="h-5 w-px bg-border" />
          </>
        ) : null}
        <ToolbarMiniButton label="Copy" onClick={() => api.copySelection()} />
        <ToolbarMiniButton
          label="Duplicate"
          onClick={() => api.duplicateSelection()}
        />
        {selectedNode ? (
          <ToolbarMiniButton
            label={isLocked ? "Unlock" : "Lock"}
            onClick={() => api.toggleNodeLocked(selectedNode.id)}
          />
        ) : null}
        {selectedNode ? (
          <ToolbarMiniButton
            label={isHidden ? "Show" : "Hide"}
            onClick={() => api.toggleNodeVisible(selectedNode.id)}
          />
        ) : null}
        {connector ? (
          <>
            <ToolbarMiniButton
              label="Detach start"
              onClick={() => api.detachConnectorEndpoint(connector.id, "start")}
            />
            <ToolbarMiniButton
              label="Detach end"
              onClick={() => api.detachConnectorEndpoint(connector.id, "end")}
            />
          </>
        ) : null}
        {selectedNode ? (
          <>
            <ToolbarMiniButton
              label="Front"
              onClick={() => api.reorderNode(selectedNode.id, "front")}
            />
            <ToolbarMiniButton
              label="Back"
              onClick={() => api.reorderNode(selectedNode.id, "back")}
            />
          </>
        ) : null}
        <ToolbarMiniButton
          danger
          label="Delete"
          onClick={() => api.deleteSelection()}
        />
      </div>
      <AgentExecutionFollowUpPill
        followUp={agentExecutionFollowUp}
        onContinueAgentExecution={onContinueAgentExecution}
      />
    </>
  );
}

export function CanvasContextMenu({
  api,
  menu,
  onClose,
}: {
  api: Pick<
    CanvasApi,
    | "copySelection"
    | "createSection"
    | "createSticky"
    | "deleteSelection"
    | "detachConnectorEndpoint"
    | "duplicateSelection"
    | "groupSelection"
    | "pasteClipboard"
    | "reorderNode"
    | "setActiveTool"
    | "toggleNodeLocked"
    | "toggleNodeVisible"
    | "ungroupSelection"
    | "updateNode"
  >;
  menu: CanvasContextMenuState | null;
  onClose: () => void;
}) {
  const { activePageId, document, selection } = useCanvasRuntimeShallowSelector(
    (state) => ({
      activePageId: state.activePageId,
      document: state.document,
      selection: state.selection,
    }),
  );
  if (!menu) return null;
  const target = menu.targetId
    ? findNode(document, menu.targetId, activePageId)
    : null;
  const selectedNode =
    selection.length === 1
      ? findNode(document, selection[0] ?? "", activePageId)
      : null;
  const connector: ConnectorLineNode | null = isConnectorLineNode(
    selectedNode ?? undefined,
  )
    ? (selectedNode as ConnectorLineNode)
    : null;
  const connectorHasArrow =
    connector?.stroke?.endTip !== undefined &&
    connector.stroke.endTip !== "none";
  const run = (action: () => void) => {
    action();
    onClose();
  };
  const place = menu.scenePoint ?? undefined;

  return (
    <div
      className="fixed z-50 min-w-48 rounded-xl border border-border bg-card/95 p-1 shadow-float backdrop-blur-lg"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!target ? (
        <>
          <ContextMenuItem
            label="Paste"
            onClick={() => run(() => api.pasteClipboard())}
          />
          <ContextMenuItem
            label="Create sticky"
            onClick={() =>
              run(() =>
                api.createSticky(
                  place ? { x: place.x, y: place.y } : undefined,
                ),
              )
            }
          />
          <ContextMenuItem
            label="Create section"
            onClick={() =>
              run(() =>
                api.createSection(
                  place ? { x: place.x, y: place.y } : undefined,
                ),
              )
            }
          />
          <ContextMenuItem
            label="Connector tool"
            onClick={() => run(() => api.setActiveTool("connector"))}
          />
        </>
      ) : (
        <>
          <ContextMenuItem
            label="Copy"
            onClick={() => run(() => api.copySelection())}
          />
          <ContextMenuItem
            label="Duplicate"
            onClick={() => run(() => api.duplicateSelection())}
          />
          <ContextMenuItem
            label={selectedNode?.locked ? "Unlock" : "Lock"}
            onClick={() => {
              if (selectedNode)
                run(() => api.toggleNodeLocked(selectedNode.id));
            }}
          />
          <ContextMenuItem
            label={selectedNode?.visible === false ? "Show" : "Hide"}
            onClick={() => {
              if (selectedNode)
                run(() => api.toggleNodeVisible(selectedNode.id));
            }}
          />
          {selectedNode ? (
            <>
              <ContextMenuItem
                label="Bring to front"
                onClick={() =>
                  run(() => api.reorderNode(selectedNode.id, "front"))
                }
              />
              <ContextMenuItem
                label="Send to back"
                onClick={() =>
                  run(() => api.reorderNode(selectedNode.id, "back"))
                }
              />
            </>
          ) : null}
          {selection.length > 1 ? (
            <ContextMenuItem
              label="Group"
              onClick={() => run(() => void api.groupSelection())}
            />
          ) : null}
          {selectedNode?.type === "group" ? (
            <ContextMenuItem
              label="Ungroup"
              onClick={() => run(() => void api.ungroupSelection())}
            />
          ) : null}
          {connector ? (
            <>
              <ContextMenuItem
                label="Detach start"
                onClick={() =>
                  run(() => api.detachConnectorEndpoint(connector.id, "start"))
                }
              />
              <ContextMenuItem
                label="Detach end"
                onClick={() =>
                  run(() => api.detachConnectorEndpoint(connector.id, "end"))
                }
              />
              <ContextMenuItem
                label={connectorHasArrow ? "Remove arrow" : "Add arrow"}
                onClick={() =>
                  run(() =>
                    api.updateNode(connector.id, {
                      stroke: {
                        ...(connector.stroke ?? {}),
                        thickness: connector.stroke?.thickness ?? 3,
                        fill: connector.stroke?.fill ?? [
                          { type: "solid", color: "#111827" },
                        ],
                        endTip: connectorHasArrow ? "none" : "line-arrow",
                      },
                      connector: {
                        ...connector.connector,
                        arrow: !connectorHasArrow,
                      },
                    } as Partial<PenNode>),
                  )
                }
              />
            </>
          ) : null}
          <ContextMenuItem
            danger
            label="Delete"
            onClick={() => run(() => api.deleteSelection())}
          />
        </>
      )}
    </div>
  );
}

function ToolbarColorDropdown({
  colors,
  currentColor,
  label,
  open,
  shortLabel,
  onSelect,
  onToggle,
}: {
  colors: string[];
  currentColor: string;
  label: string;
  open: boolean;
  shortLabel: string;
  onSelect: (color: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={label}
        className={`flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
          open
            ? "bg-foreground/[0.08] text-foreground"
            : "text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground"
        }`}
        onClick={onToggle}
        title={label}
        type="button"
      >
        <span>{shortLabel}</span>
        <span
          className="size-4 rounded-full border border-foreground/15"
          style={{ backgroundColor: currentColor }}
        />
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute top-8 left-0 z-40 flex w-max max-w-[calc(100vw-24px)] gap-1 overflow-x-auto rounded-xl border border-border bg-card/95 p-1 shadow-float backdrop-blur-lg">
          {colors.map((color) => (
            <ToolbarColorSwatch
              key={color}
              active={currentColor === color}
              color={color}
              label={`${label} ${color}`}
              onClick={() => onSelect(color)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarMiniButton({
  active,
  danger,
  disabled,
  label,
  onClick,
  title,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`h-7 rounded-lg px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : active
            ? "bg-foreground/[0.08] text-foreground"
            : "text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {label}
    </button>
  );
}

function ToolbarColorSwatch({
  active,
  color,
  label,
  onClick,
}: {
  active?: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`grid size-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-foreground/[0.06] ${
        active ? "bg-foreground/[0.08]" : ""
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span
        className="size-4 rounded-full border border-foreground/15"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function ContextMenuItem({
  danger,
  label,
  onClick,
}: {
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm transition-colors ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function buildAgentVariantBranchSelectionPlan(
  doc: PenDocument,
  branchNodeId: string,
  activePageId: string,
) {
  const selectedBranch = findNode(doc, branchNodeId, activePageId);
  const selectedMeta = getAgentExecutionMeta(selectedBranch);
  if (!selectedBranch || selectedMeta?.kind !== "variant_branch") {
    throw new Error("请选择一个 Agent 方案分支节点。");
  }
  if (!selectedMeta.branchId) {
    throw new Error("这个方案分支缺少 branchId，不能设为主线。");
  }

  const comparisonNodes = flattenNodes(doc, activePageId).filter((node) => {
    const meta = getAgentExecutionMeta(node);
    return (
      meta?.kind === "comparison" &&
      meta.comparison?.branchNodeIds.includes(branchNodeId)
    );
  });
  if (comparisonNodes.length === 0) {
    throw new Error("没有找到包含这个分支的方案对比节点。");
  }
  if (comparisonNodes.length > 1) {
    throw new Error("这个分支同时出现在多个方案对比中，暂不能直接设为主线。");
  }

  const comparisonNode = comparisonNodes[0];
  const comparisonMeta = getAgentExecutionMeta(comparisonNode);
  if (
    !comparisonNode ||
    comparisonMeta?.kind !== "comparison" ||
    !comparisonMeta.comparison
  ) {
    throw new Error("方案对比节点不可用，不能更新主线选择。");
  }

  const operations: CanvasOperation[] = [];
  const branchNodes = comparisonMeta.comparison.branchNodeIds.map((nodeId) => {
    const branchNode = findNode(doc, nodeId, activePageId);
    const branchMeta = getAgentExecutionMeta(branchNode);
    if (!branchNode || branchMeta?.kind !== "variant_branch") {
      throw new Error("方案对比中包含不可用的分支节点。");
    }
    if (!branchMeta.branchId) {
      throw new Error("方案对比中有分支缺少 branchId，不能更新主线选择。");
    }
    const isSelected = nodeId === branchNodeId;
    operations.push({
      activePageId,
      nodeId,
      type: "updateNode",
      updates: {
        fill: [
          {
            color: isSelected
              ? AGENT_SELECTED_BRANCH_FILL
              : AGENT_UNSELECTED_BRANCH_FILL,
            type: "solid",
          },
        ],
        meta: {
          ...(branchNode.meta ?? {}),
          [AGENT_EXECUTION_META_KEY]: {
            ...branchMeta,
            branch: {
              ...(branchMeta.branch ?? {}),
              isMainline: isSelected,
              isRecommended: isSelected,
            },
          },
        },
      } as Partial<PenNode>,
    });
    return { meta: branchMeta, node: branchNode };
  });

  const comparisonUpdates: Partial<PenNode> = {
    meta: {
      ...(comparisonNode.meta ?? {}),
      [AGENT_EXECUTION_META_KEY]: {
        ...comparisonMeta,
        comparison: {
          ...comparisonMeta.comparison,
          recommendedBranchId: selectedMeta.branchId,
        },
      },
    },
  };
  const comparisonChildren = buildAgentComparisonChildren(
    comparisonNode,
    branchNodes,
    selectedMeta.branchId,
    comparisonMeta.comparison.recommendationReason,
  );
  if (comparisonChildren) {
    (comparisonUpdates as Partial<PenNode> & { children: PenNode[] }).children =
      comparisonChildren;
  }
  operations.push({
    activePageId,
    nodeId: comparisonNode.id,
    type: "updateNode",
    updates: comparisonUpdates,
  });

  return { comparisonNodeId: comparisonNode.id, operations };
}

function buildAgentComparisonChildren(
  comparisonNode: PenNode,
  branches: Array<{
    meta: NonNullable<ReturnType<typeof getAgentExecutionMeta>>;
    node: PenNode;
  }>,
  recommendedBranchId: string,
  recommendationReason?: string,
): PenNode[] | undefined {
  if (
    !("children" in comparisonNode) ||
    !Array.isArray(comparisonNode.children)
  ) {
    return undefined;
  }
  const selectedBranch = branches.find(
    (branch) => branch.meta.branchId === recommendedBranchId,
  );
  const content = [
    ...branches.map(({ meta, node }) => {
      const plan = meta.branch?.planSummary || "待补充";
      const deliverable = meta.branch?.deliverableSummary || "待补充";
      const critique = meta.branch?.critiqueSummary || "待补充";
      const strengths = meta.branch?.strengths?.join(" / ") || "待补充";
      const risks = meta.branch?.risks?.join(" / ") || "待补充";
      const useCases = meta.branch?.useCases?.join(" / ") || "待补充";
      return `${meta.title || node.name || node.id}：计划 ${plan}；产物 ${deliverable}；评审 ${critique}；优点 ${strengths}；风险 ${risks}；适用 ${useCases}`;
    }),
    selectedBranch ? `推荐选择：${selectedBranch.meta.title}` : "",
    recommendationReason ? `推荐原因：${recommendationReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let updatedFirstText = false;
  return comparisonNode.children.map((child) => {
    if (updatedFirstText || child.type !== "text") return child;
    updatedFirstText = true;
    return { ...child, content } as PenNode;
  });
}

function getAgentVariantBranchSelectionReason(
  doc: PenDocument,
  node: PenNode,
  activePageId: string,
): string | undefined {
  const meta = getAgentExecutionMeta(node);
  if (meta?.kind !== "variant_branch" || meta.branch?.isMainline) {
    return undefined;
  }
  try {
    buildAgentVariantBranchSelectionPlan(doc, node.id, activePageId);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "当前分支不能设为主线。";
  }
}

export function CanvasPropertyPanelConnected({
  api,
  commitDocument,
  onContinueAgentExecution,
}: {
  api: Pick<CanvasApi, "bindAgentToContainer" | "setSelection" | "updateNode">;
  commitDocument: (
    document: PenDocument,
    opts?: { selection?: string[] },
  ) => void;
  onContinueAgentExecution?: (
    nodeId: string,
    intent?: AgentExecutionContinueIntent,
    options?: AgentExecutionContinueOptions,
  ) => void;
}) {
  const store = useCanvasRuntimeStoreApi();
  const activeTool = useCanvasRuntimeSelector(selectCanvasActiveTool);
  const activePageId = useStore(store, (state) => state.activePageId);
  const document = useStore(store, (state) => state.document);
  const { node, styleDefinitions, variables } = useCanvasRuntimeShallowSelector(
    selectCanvasSelectedNodePanelState,
  );
  const parentNode = useStore(
    store,
    useCallback(
      (state) =>
        node
          ? (findParent(state.document, node.id, state.activePageId) ?? null)
          : null,
      [node],
    ),
  );
  const pageNodes = useMemo(
    () => flattenNodes(document, activePageId),
    [activePageId, document],
  );
  const selectAgentVariantBranchReason = node
    ? getAgentVariantBranchSelectionReason(
        getCanvasApiDocument(store.getState()),
        node,
        activePageId,
      )
    : undefined;
  if (!node || (activeTool !== "select" && activeTool !== "hand")) {
    return null;
  }
  return (
    <CanvasPropertyPanel
      node={node}
      pageNodes={pageNodes}
      parentNode={parentNode}
      onBindAgent={(binding: AgentBinding) => {
        api.bindAgentToContainer(node.id, binding);
      }}
      onContinueAgentExecution={onContinueAgentExecution}
      onSelectAgentExecutionNode={(nodeId) => {
        api.setSelection([nodeId]);
        console.info("[canvas-property-panel] agent_execution.chain.select", {
          nodeId,
        });
      }}
      onSelectAgentVariantBranch={
        selectAgentVariantBranchReason
          ? undefined
          : (branchNodeId) => {
              try {
                const activeState = store.getState();
                const plan = buildAgentVariantBranchSelectionPlan(
                  getCanvasApiDocument(activeState),
                  branchNodeId,
                  activeState.activePageId,
                );
                const result = applyCanvasTransaction(
                  getCanvasApiDocument(activeState),
                  plan.operations,
                  { activePageId: activeState.activePageId },
                );
                commitDocument(result.doc, { selection: [branchNodeId] });
                console.info("[canvas-property-panel] agent_branch.select", {
                  branchNodeId,
                  comparisonNodeId: plan.comparisonNodeId,
                });
              } catch (error) {
                console.warn(
                  "[canvas-property-panel] agent_branch.select.failed",
                  {
                    branchNodeId,
                    reason:
                      error instanceof Error
                        ? error.message
                        : "Unknown branch selection error",
                  },
                );
              }
            }
      }
      selectAgentVariantBranchReason={selectAgentVariantBranchReason}
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
