"use client";

import {
  type CucumberCanvasDocument,
  applyCanvasTransaction,
  findNode,
  getNodeBounds,
  getOrderedCanvasNodes,
} from "@cucumber/canvas-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import { useCallback } from "react";

import type { useToast } from "@/components/toast";
import type { CanvasApi, CanvasTool } from "./canvas-api";
import type { CanvasRuntimeCommitResult } from "./canvas-runtime-store";
import { getDocumentSelection } from "./canvas-runtime-utils";
import { getTopLevelSelectionIds } from "./canvas-selection-helpers";
import {
  KEYBOARD_ZOOM_STEP,
  assertPositiveFiniteZoom,
} from "./skia-canvas-constants";
import type { MutableRef } from "./skia-canvas-types";
import { findStickyNoteTextNode, isStickyNoteNode } from "./sticky-note-tool";
import { useCanvasKeyboardShortcuts } from "./use-canvas-keyboard-shortcuts";

type UseSkiaKeyboardAndToolbarActionsOptions = {
  activePageIdRef: MutableRef<string>;
  api: CanvasApi;
  beginTextEdit: (
    node: PenNode,
    opts?: {
      isNew?: boolean;
      bounds?: import("@cucumber/canvas-core").CanvasBounds;
      selectionDuringEdit?: string[];
      commitSelection?: string[];
    },
  ) => boolean;
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  copySelection: () => boolean;
  cutSelection: () => void;
  deleteSelection: () => void;
  docRef: MutableRef<PenDocument>;
  duplicateSelection: () => string[];
  pasteClipboard: () => string[];
  pasteFromSystemClipboard: () => Promise<string[]>;
  selectedIdsRef: MutableRef<string[]>;
  setActiveTool: (tool: CanvasTool) => void;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
  toast: ReturnType<typeof useToast>;
};

export function useSkiaKeyboardAndToolbarActions({
  activePageIdRef,
  api,
  beginTextEdit,
  commitDocument,
  copySelection,
  cutSelection,
  deleteSelection,
  docRef,
  duplicateSelection,
  pasteClipboard,
  pasteFromSystemClipboard,
  selectedIdsRef,
  setActiveTool,
  setSelection,
  toast,
}: UseSkiaKeyboardAndToolbarActionsOptions) {
  useCanvasKeyboardShortcuts({
    undo: api.undo,
    redo: api.redo,
    selectAll: () =>
      setSelection(
        getOrderedCanvasNodes(docRef.current, activePageIdRef.current)
          .map((entry) => entry.node)
          .filter((node) => node.visible !== false)
          .map((node) => node.id),
      ),
    copySelection,
    cutSelection,
    pasteClipboard,
    pasteFromSystemClipboard,
    duplicateSelection,
    deleteSelection,
    groupSelection: api.groupSelection,
    ungroupSelection: api.ungroupSelection,
    nudgeSelection: (dx, dy) => {
      const currentSelection = selectedIdsRef.current;
      if (currentSelection.length === 0) return;
      const activePageId = activePageIdRef.current;
      const operations = currentSelection.flatMap((nodeId) => {
        const node = findNode(docRef.current, nodeId, activePageId);
        if (!node || node.locked) return [];
        const bounds = getNodeBounds(node);
        return [
          {
            type: "updateNode" as const,
            nodeId,
            updates: {
              x: bounds.x + dx,
              y: bounds.y + dy,
            } as Partial<PenNode>,
            activePageId,
          },
        ];
      });
      if (operations.length === 0) return;
      commitDocument(
        applyCanvasTransaction(docRef.current, operations, { activePageId })
          .doc,
      );
    },
    reorderSelection: (direction) => {
      const topSelection = getTopLevelSelectionIds(
        docRef.current as CucumberCanvasDocument,
        selectedIdsRef.current,
        activePageIdRef.current,
      );
      for (const nodeId of topSelection) {
        api.reorderNode(nodeId, direction);
      }
    },
    editSelectedText: () => {
      const currentSelection = selectedIdsRef.current;
      if (currentSelection.length !== 1) return false;
      const node = findNode(
        docRef.current,
        currentSelection[0] ?? "",
        activePageIdRef.current,
      );
      if (!node) return false;
      if (isStickyNoteNode(node)) {
        const stickyText = findStickyNoteTextNode(node);
        if (!stickyText) return false;
        return beginTextEdit(stickyText, {
          commitSelection: [node.id],
          selectionDuringEdit: [],
        });
      }
      if (node.type !== "text") return false;
      return beginTextEdit(node);
    },
    zoomIn: () => {
      const currentZoom = api.getAppState().zoom.value;
      const nextZoom = currentZoom * KEYBOARD_ZOOM_STEP;
      assertPositiveFiniteZoom(nextZoom);
      api.updateScene({
        appState: {
          zoom: {
            value: nextZoom,
          },
        },
      });
    },
    zoomOut: () => {
      const currentZoom = api.getAppState().zoom.value;
      const nextZoom = currentZoom / KEYBOARD_ZOOM_STEP;
      assertPositiveFiniteZoom(nextZoom);
      api.updateScene({
        appState: {
          zoom: {
            value: nextZoom,
          },
        },
      });
    },
    resetZoom: () => {
      api.updateScene({ appState: { zoom: { value: 1 } } });
    },
    setActiveTool: (tool) => {
      setActiveTool(tool === "pen" ? "path" : tool);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleImportImage = useCallback(() => {
    console.info("[skia-canvas] toolbar.import-image.requested", {
      activePageId: activePageIdRef.current,
    });
    toast.toast("Use paste or drag-and-drop to import images on this canvas.");
  }, [toast]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const handleImportSvg = useCallback(async () => {
    const importedIds = await pasteFromSystemClipboard();
    if (importedIds.length === 0) {
      console.info("[skia-canvas] toolbar.import-svg.empty", {
        activePageId: activePageIdRef.current,
      });
      toast.toast(
        "Copy SVG markup or a supported clipboard payload before importing SVG.",
      );
      return;
    }
    console.info("[skia-canvas] toolbar.import-svg.imported", {
      activePageId: activePageIdRef.current,
      count: importedIds.length,
    });
  }, [pasteFromSystemClipboard, toast]);

  return { handleImportImage, handleImportSvg };
}
