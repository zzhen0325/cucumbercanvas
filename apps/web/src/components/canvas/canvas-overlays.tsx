import {
  type AgentBinding,
  type CucumberCanvasDocument,
  findNode,
  findParent,
  getActiveChildren,
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
import { CanvasBooleanToolbar } from "./boolean-toolbar";
import type { CanvasApi, CanvasTool } from "./canvas-api";
import {
  getCanvasApiDocument,
  selectCanvasBooleanInputState,
  selectCanvasSelectedNodePanelState,
  selectCanvasToolbarState,
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

export type CanvasContextMenuState = {
  x: number;
  y: number;
  targetId: string | null;
  scenePoint: { x: number; y: number } | null;
};

type ConnectorLineNode = LineNode & {
  connector: NonNullable<LineNode["connector"]>;
};

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
                    onChange={(event) => setFontSearchQuery(event.target.value)}
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
                      <span className="truncate" style={{ fontFamily: family }}>
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
                      <Check className="size-3.5 shrink-0" aria-hidden="true" />
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
                  Number(stickyTextWeight) >= 600 || stickyTextWeight === "bold"
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
  label,
  onClick,
}: {
  active?: boolean;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`h-7 rounded-lg px-2 text-xs font-medium transition-colors ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : active
            ? "bg-foreground/[0.08] text-foreground"
            : "text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground"
      }`}
      onClick={onClick}
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

export function CanvasPropertyPanelConnected({
  api,
  commitDocument,
}: {
  api: Pick<CanvasApi, "bindAgentToContainer" | "updateNode">;
  commitDocument: (document: PenDocument) => void;
}) {
  const store = useCanvasRuntimeStoreApi();
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
  if (!node) return null;
  return (
    <CanvasPropertyPanel
      node={node}
      parentNode={parentNode}
      onBindAgent={(binding: AgentBinding) => {
        api.bindAgentToContainer(node.id, binding);
      }}
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
