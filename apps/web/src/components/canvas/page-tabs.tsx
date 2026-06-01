"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PenPage } from "./canvas-api";

export type CanvasPageTabsProps = {
  layout?: "bottom" | "sidebar";
  pages: PenPage[];
  activePageId: string;
  onAddPage: () => void;
  onDeletePage: (pageId: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onRenamePage: (pageId: string, name: string) => void;
  onReorderPage: (pageId: string, direction: "left" | "right") => void;
  onSetActivePage: (pageId: string) => void;
};

function stopCanvasPropagation(
  event:
    | React.MouseEvent<HTMLElement>
    | React.PointerEvent<HTMLElement>
    | React.KeyboardEvent<HTMLElement>
    | React.WheelEvent<HTMLElement>,
) {
  event.stopPropagation();
}

function PageTab({
  page,
  active,
  canMoveLeft,
  canMoveRight,
  canDelete,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
  onSetActivePage,
  layout = "bottom",
}: {
  page: PenPage;
  active: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canDelete: boolean;
  onDeletePage: (pageId: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onRenamePage: (pageId: string, name: string) => void;
  onReorderPage: (pageId: string, direction: "left" | "right") => void;
  onSetActivePage: (pageId: string) => void;
  layout?: "bottom" | "sidebar";
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(page.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) {
      setDraftName(page.name);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [page.name, renaming]);

  const cancelRename = useCallback(() => {
    setDraftName(page.name);
    setRenaming(false);
  }, [page.name]);

  const commitRename = useCallback(() => {
    const nextName = draftName.trim();
    setRenaming(false);
    if (!nextName || nextName === page.name) {
      setDraftName(page.name);
      return;
    }
    onRenamePage(page.id, nextName);
  }, [draftName, onRenamePage, page.id, page.name]);
  const isSidebar = layout === "sidebar";
  const PreviousIcon = isSidebar ? ChevronUp : ChevronLeft;
  const NextIcon = isSidebar ? ChevronDown : ChevronRight;
  const previousLabel = isSidebar ? "up" : "left";
  const nextLabel = isSidebar ? "down" : "right";

  return (
    <div
      className={cn(
        "group/page flex shrink-0 items-center gap-0.5 rounded-md border px-1 transition-colors",
        isSidebar ? "h-9 w-full" : "h-8",
        active
          ? "border-primary/30 bg-primary/10 text-foreground shadow-sm"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          aria-label="Rename page"
          className={cn(
            "h-6 min-w-0 rounded-sm border border-ring/50 bg-background px-2 text-xs font-medium text-foreground outline-none ring-2 ring-ring/20",
            isSidebar ? "flex-1" : "w-28",
          )}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onClick={stopCanvasPropagation}
          onDoubleClick={stopCanvasPropagation}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
          onPointerDown={stopCanvasPropagation}
        />
      ) : (
        <button
          type="button"
          aria-label={`Open ${page.name}`}
          aria-current={active ? "page" : undefined}
          className={cn(
            "min-w-0 rounded-sm px-2 py-1 text-left text-xs font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
            isSidebar ? "flex-1" : "",
          )}
          onClick={() => onSetActivePage(page.id)}
          onDoubleClick={() => setRenaming(true)}
        >
          <span className={cn("block truncate", isSidebar ? "" : "max-w-28")}>
            {page.name}
          </span>
        </button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Duplicate ${page.name}`}
        className="size-6 text-muted-foreground opacity-70 hover:opacity-100 group-hover/page:opacity-100"
        onClick={() => onDuplicatePage(page.id)}
      >
        <Copy className="size-3" />
      </Button>
      {canDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${page.name}`}
          className="size-6 text-muted-foreground opacity-70 hover:text-destructive hover:opacity-100 group-hover/page:opacity-100"
          onClick={() => onDeletePage(page.id)}
        >
          <Trash2 className="size-3" />
        </Button>
      ) : null}
      <button
        type="button"
        aria-label={`Move ${page.name} ${previousLabel}`}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 outline-none transition-colors hover:bg-background hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30"
        disabled={!canMoveLeft}
        onClick={() => onReorderPage(page.id, "left")}
      >
        <PreviousIcon className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`Move ${page.name} ${nextLabel}`}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 outline-none transition-colors hover:bg-background hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30"
        disabled={!canMoveRight}
        onClick={() => onReorderPage(page.id, "right")}
      >
        <NextIcon className="size-3" />
      </button>
    </div>
  );
}

export function CanvasPageTabs({
  layout = "bottom",
  pages,
  activePageId,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
  onSetActivePage,
}: CanvasPageTabsProps) {
  const isSidebar = layout === "sidebar";
  return (
    <nav
      aria-label="Canvas pages"
      className={cn(
        "pointer-events-auto flex gap-1",
        isSidebar
          ? "w-full flex-col"
          : "max-w-[min(calc(100vw-2rem),44rem)] items-center overflow-x-auto rounded-lg border border-border bg-card/95 p-1 shadow-card backdrop-blur",
      )}
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <div
        className={cn(
          "flex gap-1",
          isSidebar ? "w-full flex-col" : "min-w-max items-center",
        )}
      >
        {pages.map((page, index) => (
          <PageTab
            key={page.id}
            page={page}
            active={page.id === activePageId}
            canMoveLeft={index > 0}
            canMoveRight={index < pages.length - 1}
            canDelete={pages.length > 1}
            onDeletePage={onDeletePage}
            onDuplicatePage={onDuplicatePage}
            onRenamePage={onRenamePage}
            onReorderPage={onReorderPage}
            onSetActivePage={onSetActivePage}
            layout={layout}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add page"
        className={cn(
          "shrink-0 text-muted-foreground",
          isSidebar ? "h-8 w-full justify-start gap-2 px-2 text-xs" : "size-8",
        )}
        onClick={onAddPage}
      >
        <Plus className="size-4" />
        {isSidebar ? <span>新建页面</span> : null}
      </Button>
    </nav>
  );
}
