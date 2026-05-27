"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  MoreHorizontal,
  Unlock,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type {
  CanvasApi,
  CanvasAppState,
  CanvasFileRecord,
  CanvasSceneElement,
} from "./canvas/canvas-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type CanvasLayersPanelProps = {
  canvasApi: CanvasApi | null;
  open: boolean;
  onClose: () => void;
};

/* -- Throttle utility -- */
/** Simple trailing-edge throttle. Ensures fn fires at most once per `ms`. */
function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;
  const throttled = ((...args: Args) => {
    lastArgs = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, ms);
  }) as ((...args: Args) => void) & { cancel: () => void };
  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };
  return throttled;
}

const CloseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className}>
    <title>Close</title>
    <path
      d="M4.5 4.5l7 7M11.5 4.5l-7 7"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/* -- Element helpers -- */
function elLabel(el: CanvasSceneElement): string {
  if (el.customData?.type === "image-generator") {
    return typeof el.customData.title === "string"
      ? el.customData.title.slice(0, 20)
      : "Image Generator";
  }
  if (el.type === "text") return (el.text as string)?.slice(0, 20) || "Text";
  if (el.type === "image") {
    return typeof el.customData?.title === "string"
      ? el.customData.title.slice(0, 20)
      : "Image";
  }
  return el.type.charAt(0).toUpperCase() + el.type.slice(1);
}

function elThumbnailIcon(el: CanvasSceneElement): string {
  if (el.customData?.type === "image-generator") return "\u2728";
  if (el.type === "text") return "T";
  if (el.type === "image") return "";
  if (el.type === "rectangle") return "\u25AD";
  if (el.type === "ellipse") return "\u25EF";
  if (el.type === "diamond") return "\u25C7";
  if (el.type === "line") return "\u2500";
  if (el.type === "arrow") return "\u2192";
  return "\u25C6";
}

/* -- Thumbnail component -- */
function LayerThumbnail({
  el,
  files,
}: {
  el: CanvasSceneElement;
  files: Record<string, CanvasFileRecord>;
}) {
  const icon = elThumbnailIcon(el);

  // For image elements, try to show a small preview
  if (el.type === "image" && el.fileId) {
    const file = files[el.fileId];
    if (file?.dataURL) {
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-muted overflow-hidden">
          <img
            src={file.dataURL}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      );
    }
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-muted text-[11px] leading-none text-muted-foreground">
      {icon}
    </div>
  );
}

/* -- Layer row (memoized to prevent re-render when other rows' selection changes) -- */
const LayerRow = memo(function LayerRow({
  el,
  files,
  selected,
  collapsed,
  canCollapse,
  moveTargets,
  onSelect,
  onToggleLock,
  onToggleVisible,
  onReorder,
  onToggleCollapse,
  onRename,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveToParentIndex,
}: {
  el: CanvasSceneElement;
  files: Record<string, CanvasFileRecord>;
  selected: boolean;
  collapsed: boolean;
  canCollapse: boolean;
  moveTargets: Array<{
    label: string;
    targetIndex: number;
    targetParentId: string | null;
  }>;
  onSelect: (id: string, additive?: boolean) => void;
  onToggleLock: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onReorder: (
    id: string,
    direction: "forward" | "backward" | "front" | "back",
  ) => void;
  onToggleCollapse: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (id: string) => void;
  onMoveToParentIndex: (
    id: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(elLabel(el));
  useEffect(() => {
    setDraftTitle(elLabel(el));
  }, [el]);
  const handleSelect = useCallback(
    (additive = false) => onSelect(el.id, additive),
    [onSelect, el.id],
  );
  const depth = el.depth ?? 0;

  return (
    <div
      data-testid={`layer-row-${el.id}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}
      draggable
      onClick={(event) => {
        handleSelect(Boolean(event.shiftKey || event.metaKey));
      }}
      onDragStart={() => onDragStart(el.id)}
      onDragOver={(event) => onDragOver(el.id, event)}
      onDrop={() => onDrop(el.id)}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handleSelect(Boolean(event.shiftKey || event.metaKey));
      }}
    >
      <div
        className={`group/layer flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          selected ? "bg-muted" : "hover:bg-muted"
        } ${el.visible === false ? "opacity-55" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {canCollapse ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(el.id);
            }}
            aria-label={collapsed ? "展开图层" : "收起图层"}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="h-5 w-5 shrink-0" />
        )}
        <LayerThumbnail el={el} files={files} />
        {editing ? (
          <input
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none"
            value={draftTitle}
            // biome-ignore lint/a11y/noAutofocus: Existing inline rename flow should focus the draft input immediately.
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftTitle(event.currentTarget.value)}
            onBlur={() => {
              setEditing(false);
              onRename(el.id, draftTitle.trim() || elLabel(el));
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                setEditing(false);
                onRename(el.id, draftTitle.trim() || elLabel(el));
              }
              if (event.key === "Escape") {
                setEditing(false);
                setDraftTitle(elLabel(el));
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            onClick={(event) => {
              event.stopPropagation();
              handleSelect(Boolean(event.shiftKey || event.metaKey));
            }}
            onDoubleClick={() => setEditing(true)}
          >
            {elLabel(el)}
          </button>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="invisible flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover/layer:visible cursor-pointer outline-none focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label="Move layer forward"
            onClick={(e) => {
              e.stopPropagation();
              onReorder(el.id, "forward");
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="invisible flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover/layer:visible cursor-pointer outline-none focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label="Move layer backward"
            onClick={(e) => {
              e.stopPropagation();
              onReorder(el.id, "backward");
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="invisible flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover/layer:visible cursor-pointer outline-none focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label={el.locked ? "Unlock layer" : "Lock layer"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(el.id);
            }}
          >
            {el.locked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            className="invisible flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover/layer:visible cursor-pointer outline-none focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label="Toggle layer visibility"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible(el.id);
            }}
          >
            {el.visible === false ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Layer actions"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 group-hover/layer:opacity-100 data-open:opacity-100 data-popup-open:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditing(true);
                  }}
                >
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicate(el.id);
                  }}
                >
                  复制
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onReorder(el.id, "front");
                  }}
                >
                  置顶
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onReorder(el.id, "back");
                  }}
                >
                  置底
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {moveTargets.length > 0 ? (
                  moveTargets.map((target) => (
                    <DropdownMenuItem
                      key={`${target.targetParentId ?? "root"}-${target.targetIndex}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMoveToParentIndex(
                          el.id,
                          target.targetParentId,
                          target.targetIndex,
                        );
                      }}
                    >
                      {target.label}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    No hierarchy move targets
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleLock(el.id);
                  }}
                >
                  {el.locked ? "解锁" : "锁定"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVisible(el.id);
                  }}
                >
                  {el.visible === false ? "显示" : "隐藏"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(el.id);
                  }}
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
});

/* ================================================================
   Main component
   ================================================================ */
export function CanvasLayersPanel({
  canvasApi,
  open,
  onClose,
}: CanvasLayersPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [elements, setElements] = useState<CanvasSceneElement[]>([]);
  const [files, setFiles] = useState<Record<string, CanvasFileRecord>>({});
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const orderedElementsRef = useRef<CanvasSceneElement[]>([]);

  const runLayerAction = useCallback(
    (
      actionName: string,
      context: Record<string, unknown>,
      action: () => void,
    ) => {
      try {
        setActionError(null);
        action();
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : `Layer action failed while trying to ${actionName}.`;
        console.error("[canvas-layers-panel] layer action failed", {
          actionName,
          ...context,
          error,
          message,
        });
        setActionError(message);
      }
    },
    [],
  );

  /* -- Refresh elements on open + subscribe to changes -- */
  const applySceneSnapshot = useCallback(
    (
      nextElements: CanvasSceneElement[],
      appState: CanvasAppState,
      nextFiles: Record<string, CanvasFileRecord>,
    ) => {
      const activeElements = nextElements.filter((el) => !el.isDeleted);
      orderedElementsRef.current = activeElements;
      setElements([...activeElements].reverse());
      setFiles(nextFiles);
      setSelectedIds(appState.selectedElementIds ?? {});
    },
    [],
  );

  const refreshElements = useCallback(() => {
    if (!canvasApi) return;
    applySceneSnapshot(
      canvasApi.getSceneElements(),
      canvasApi.getAppState(),
      canvasApi.getFiles() ?? {},
    );
  }, [applySceneSnapshot, canvasApi]);

  // Throttle refresh to avoid hammering React state on every drag frame.
  // 100ms gives smooth UI without excessive re-renders during drawing.
  useEffect(() => {
    if (!open || !canvasApi) return;
    // Initial refresh is immediate
    refreshElements();

    const throttledRefresh = throttle(applySceneSnapshot, 100);
    const unsubscribe = canvasApi.onChange(
      (nextElements, appState, nextFiles) => {
        throttledRefresh(nextElements, appState, nextFiles);
      },
    );
    return () => {
      throttledRefresh.cancel();
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [open, canvasApi, applySceneSnapshot, refreshElements]);

  /* -- Escape to close -- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  /* -- Select element on canvas -- */
  const selectElement = useCallback(
    (id: string, additive = false) => {
      if (!canvasApi) return;
      if (!additive) {
        runLayerAction("select layer", { targetId: id }, () =>
          canvasApi.setSelection([id]),
        );
        return;
      }
      const nextSelected = selectedIds[id]
        ? Object.keys(selectedIds).filter((selectedId) => selectedId !== id)
        : [...Object.keys(selectedIds), id];
      runLayerAction("select layers", { targetIds: nextSelected }, () =>
        canvasApi.setSelection(nextSelected),
      );
    },
    [canvasApi, runLayerAction, selectedIds],
  );

  const toggleLock = useCallback(
    (id: string) => {
      if (!canvasApi) return;
      runLayerAction("toggle layer lock", { targetId: id }, () =>
        canvasApi.toggleNodeLocked(id),
      );
    },
    [canvasApi, runLayerAction],
  );

  const toggleVisible = useCallback(
    (id: string) => {
      if (!canvasApi) return;
      runLayerAction("toggle layer visibility", { targetId: id }, () =>
        canvasApi.toggleNodeVisible(id),
      );
    },
    [canvasApi, runLayerAction],
  );

  const reorderElement = useCallback(
    (id: string, direction: "forward" | "backward" | "front" | "back") => {
      if (!canvasApi) return;
      runLayerAction("reorder layer", { direction, targetId: id }, () =>
        canvasApi.reorderNode(id, direction),
      );
    },
    [canvasApi, runLayerAction],
  );

  const moveElementToParentIndex = useCallback(
    (id: string, targetParentId: string | null, targetIndex: number) => {
      if (!canvasApi) return;
      runLayerAction(
        "move layer",
        { targetId: id, targetIndex, targetParentId },
        () => canvasApi.moveNodeToIndex(id, targetParentId, targetIndex),
      );
    },
    [canvasApi, runLayerAction],
  );

  const renameElement = useCallback(
    (id: string, title: string) => {
      const updates: Parameters<CanvasApi["updateNode"]>[1] = { name: title };
      if (!canvasApi) return;
      runLayerAction("rename layer", { targetId: id }, () =>
        canvasApi.updateNode(id, updates),
      );
    },
    [canvasApi, runLayerAction],
  );

  const deleteElement = useCallback(
    (id: string) => {
      if (!canvasApi) return;
      runLayerAction("delete layer", { targetId: id }, () =>
        canvasApi.deleteNode(id),
      );
    },
    [canvasApi, runLayerAction],
  );

  const duplicateElement = useCallback(
    (id: string) => {
      if (!canvasApi) return;
      runLayerAction("duplicate layer", { targetId: id }, () => {
        canvasApi.setSelection([id]);
        canvasApi.duplicateSelection();
      });
    },
    [canvasApi, runLayerAction],
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleDragStart = useCallback((id: string) => {
    dragIdRef.current = id;
  }, []);

  const handleDragOver = useCallback(
    (_id: string, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  const handleDrop = useCallback(
    (targetId: string) => {
      const draggedId = dragIdRef.current;
      dragIdRef.current = null;
      if (!canvasApi || !draggedId || draggedId === targetId) return;
      const ordered = orderedElementsRef.current;
      const target = ordered.find((el) => el.id === targetId);
      if (!target) return;
      const targetParentId =
        (target.customData?.containerId as string | null | undefined) ?? null;
      const siblings = ordered.filter(
        (el) =>
          ((el.customData?.containerId as string | null | undefined) ??
            null) === targetParentId,
      );
      const targetIndex = siblings.findIndex((el) => el.id === targetId);
      if (targetIndex < 0) return;
      runLayerAction(
        "move layer",
        { draggedId, targetId, targetIndex, targetParentId },
        () => canvasApi.moveNodeToIndex(draggedId, targetParentId, targetIndex),
      );
    },
    [canvasApi, runLayerAction],
  );

  const childrenByParent = elements.reduce<Record<string, number>>(
    (acc, el) => {
      const parentId =
        (el.customData?.containerId as string | null | undefined) ?? null;
      const key = parentId ?? "__root__";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const visibleElements = elements.filter((el) => {
    let parentId =
      (el.customData?.containerId as string | null | undefined) ?? null;
    while (parentId) {
      if (collapsedIds[parentId]) return false;
      const parent = elements.find((candidate) => candidate.id === parentId);
      parentId =
        (parent?.customData?.containerId as string | null | undefined) ?? null;
    }
    return true;
  });
  const containerElements = elements.filter(
    (el) => el.type === "frame" || el.type === "group",
  );

  const getLayerParentId = (el: CanvasSceneElement): string | null =>
    (el.customData?.containerId as string | null | undefined) ?? null;

  const getMoveTargets = (el: CanvasSceneElement) => {
    const currentParentId = getLayerParentId(el);
    const targets: Array<{
      label: string;
      targetIndex: number;
      targetParentId: string | null;
    }> = [];

    if (currentParentId !== null) {
      const rootCount = elements.filter(
        (candidate) => getLayerParentId(candidate) === null,
      ).length;
      targets.push({
        label: "Move to canvas root",
        targetIndex: rootCount,
        targetParentId: null,
      });
    }

    for (const container of containerElements) {
      if (container.id === el.id || container.id === currentParentId) continue;
      targets.push({
        label: `Move into ${elLabel(container)}`,
        targetIndex: childrenByParent[container.id] ?? 0,
        targetParentId: container.id,
      });
    }

    return targets;
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="fixed left-0 top-0 z-30 flex h-full w-70 flex-col border-r border-border bg-card animate-in slide-in-from-left duration-200"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <span className="text-sm font-medium text-foreground">图层</span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onClick={onClose}
          aria-label="Close layers panel"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Separator */}
      <div className="h-px bg-border" />

      {actionError ? (
        <div
          className="mx-2 mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {/* Layer list -- uses content-visibility for large canvas performance */}
      <div
        className="flex-1 overflow-y-auto px-1 py-1"
        style={{ contain: "layout style" }}
      >
        {elements.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            画布为空
          </p>
        ) : (
          visibleElements.map((el) => (
            <LayerRow
              key={el.id}
              el={el}
              files={files}
              selected={!!selectedIds[el.id]}
              collapsed={!!collapsedIds[el.id]}
              canCollapse={Boolean(childrenByParent[el.id])}
              moveTargets={getMoveTargets(el)}
              onSelect={selectElement}
              onToggleLock={toggleLock}
              onToggleVisible={toggleVisible}
              onReorder={reorderElement}
              onToggleCollapse={toggleCollapse}
              onRename={renameElement}
              onDelete={deleteElement}
              onDuplicate={duplicateElement}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onMoveToParentIndex={moveElementToParentIndex}
            />
          ))
        )}
      </div>
    </div>
  );
}
