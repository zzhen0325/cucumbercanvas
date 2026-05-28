import { useEffect } from "react";

type CanvasToolShortcut =
  | "select"
  | "text"
  | "hand"
  | "rect"
  | "ellipse"
  | "container"
  | "pen";

function isEditableTarget(target: HTMLElement | null) {
  return (
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.isContentEditable
  );
}

function hasNativeTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return selection.toString().length > 0;
}

export function useCanvasKeyboardShortcuts(options: {
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  copySelection: () => boolean;
  cutSelection: () => void;
  pasteClipboard: () => string[];
  pasteFromSystemClipboard: () => Promise<string[]>;
  duplicateSelection: () => string[];
  deleteSelection: () => void;
  groupSelection: () => string | null;
  ungroupSelection: () => string[];
  nudgeSelection: (dx: number, dy: number) => void;
  reorderSelection: (direction: "forward" | "backward") => void;
  setActiveTool: (tool: CanvasToolShortcut) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target) || hasNativeTextSelection()) {
        return;
      }

      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isMod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) options.redo();
        else options.undo();
        return;
      }

      if (isMod && key === "a") {
        event.preventDefault();
        options.selectAll();
        return;
      }

      if (isMod && key === "c") {
        if (options.copySelection()) {
          event.preventDefault();
        }
        return;
      }

      if (isMod && key === "x") {
        event.preventDefault();
        options.cutSelection();
        return;
      }

      if (isMod && key === "v") {
        const pastedIds = options.pasteClipboard();
        if (pastedIds.length > 0) {
          event.preventDefault();
          return;
        }
        // Let the browser dispatch the native paste event so Figma/SVG HTML
        // payloads remain available on event.clipboardData without Clipboard API permission.
        return;
      }

      if (isMod && key === "d") {
        event.preventDefault();
        options.duplicateSelection();
        return;
      }

      if (isMod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) options.ungroupSelection();
        else options.groupSelection();
        return;
      }

      if (key === "[" && !isMod) {
        event.preventDefault();
        options.reorderSelection("backward");
        return;
      }

      if (key === "]" && !isMod) {
        event.preventDefault();
        options.reorderSelection("forward");
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        options.deleteSelection();
        return;
      }

      const nudgeByKey: Record<string, { x: number; y: number }> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      };
      const nudge = nudgeByKey[event.key];
      if (!isMod && nudge) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        options.nudgeSelection(nudge.x * amount, nudge.y * amount);
        return;
      }

      if (!isMod && !event.altKey) {
        const toolShortcuts: Record<string, CanvasToolShortcut> = {
          v: "select",
          t: "text",
          h: "hand",
          r: "rect",
          o: "ellipse",
          f: "container",
          p: "pen",
        };
        const nextTool = toolShortcuts[key];
        if (nextTool) {
          options.setActiveTool(nextTool);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [options]);
}
