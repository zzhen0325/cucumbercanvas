"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PenPage } from "./canvas-api";

export type CanvasPageTabsProps = {
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
  canDelete,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
  onSetActivePage,
}: {
  page: PenPage;
  active: boolean;
  canDelete: boolean;
  onDeletePage: (pageId: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onRenamePage: (pageId: string, name: string) => void;
  onReorderPage: (pageId: string, direction: "left" | "right") => void;
  onSetActivePage: (pageId: string) => void;
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

  return (
    <div
      className={cn(
        "group/page flex h-8 min-w-0 items-center gap-0.5 rounded-md border px-1 transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-foreground shadow-sm"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          aria-label="Rename page"
          className="h-6 w-28 min-w-0 rounded-sm border border-ring/50 bg-background px-2 text-xs font-medium text-foreground outline-none ring-2 ring-ring/20"
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
          className="min-w-0 rounded-sm px-2 py-1 text-left text-xs font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => onSetActivePage(page.id)}
          onDoubleClick={() => setRenaming(true)}
        >
          <span className="block max-w-28 truncate">{page.name}</span>
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
        className="sr-only"
        aria-label={`Move ${page.name} left`}
        onClick={() => onReorderPage(page.id, "left")}
      >
        Move left
      </button>
      <button
        type="button"
        className="sr-only"
        aria-label={`Move ${page.name} right`}
        onClick={() => onReorderPage(page.id, "right")}
      >
        Move right
      </button>
    </div>
  );
}

export function CanvasPageTabs({
  pages,
  activePageId,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
  onSetActivePage,
}: CanvasPageTabsProps) {
  return (
    <nav
      aria-label="Canvas pages"
      className="pointer-events-auto flex max-w-[min(calc(100vw-2rem),44rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card/95 p-1 shadow-card backdrop-blur"
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <div className="flex min-w-0 items-center gap-1">
        {pages.map((page) => (
          <PageTab
            key={page.id}
            page={page}
            active={page.id === activePageId}
            canDelete={pages.length > 1}
            onDeletePage={onDeletePage}
            onDuplicatePage={onDuplicatePage}
            onRenamePage={onRenamePage}
            onReorderPage={onReorderPage}
            onSetActivePage={onSetActivePage}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add page"
        className="size-8 shrink-0 text-muted-foreground"
        onClick={onAddPage}
      >
        <Plus className="size-4" />
      </Button>
    </nav>
  );
}
