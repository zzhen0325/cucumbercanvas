"use client";

import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  applyCanvasOperation,
  findNode,
  getNodeBounds,
} from "@cucumber/canvas-core";
import type { PenRenderer } from "@cucumber/pen-renderer";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { syncRendererDocument } from "./canvas-document-boundary";
import type { CanvasRuntimeCommitResult } from "./canvas-runtime-store";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  type TextEditState,
  getFirstSolidFillColor,
  getTextContent,
  measureTextLayout,
} from "./canvas-text-measure";
import type {
  MutableRef,
  PendingRendererDocumentSync,
} from "./skia-canvas-types";
import {
  findStickyNoteTextNode,
  getStickyNoteContainerForNode,
} from "./sticky-note-tool";

type UseSkiaTextEditingOptions = {
  activePageIdRef: MutableRef<string>;
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  docRef: MutableRef<PenDocument>;
  pendingRendererDocumentSyncRef: MutableRef<PendingRendererDocumentSync | null>;
  rendererDocumentSyncRafRef: MutableRef<number | null>;
  rendererRef: MutableRef<PenRenderer | null>;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
};

export function useSkiaTextEditing({
  activePageIdRef,
  commitDocument,
  docRef,
  pendingRendererDocumentSyncRef,
  rendererDocumentSyncRafRef,
  rendererRef,
  setSelection,
}: UseSkiaTextEditingOptions) {
  const [editingText, setEditingText] = useState<TextEditState | null>(null);
  const [editingStickyNameId, setEditingStickyNameId] = useState<string | null>(
    null,
  );
  const textEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const beginTextEdit = useCallback(
    (
      node: PenNode,
      opts?: {
        isNew?: boolean;
        bounds?: CanvasBounds;
        selectionDuringEdit?: string[];
        commitSelection?: string[];
      },
    ) => {
      const renderer = rendererRef.current;
      if (!renderer || node.type !== "text") return false;
      const rendererBounds = renderer.getNodeBounds(node.id);
      const nodeBounds = getNodeBounds(node);
      const bounds = opts?.bounds ?? {
        x: rendererBounds?.x ?? nodeBounds.x,
        y: rendererBounds?.y ?? nodeBounds.y,
        width: rendererBounds?.w ?? nodeBounds.width,
        height: rendererBounds?.h ?? nodeBounds.height,
      };
      const textNode = node as PenNode & {
        fontSize?: number;
        fontFamily?: string;
        fontWeight?: string | number;
        textAlign?: React.CSSProperties["textAlign"];
        lineHeight?: number | string;
        textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
      };
      const content = getTextContent(node);
      const commitSelection = opts?.commitSelection ?? [node.id];
      setSelection(opts?.selectionDuringEdit ?? commitSelection);
      setEditingText({
        nodeId: node.id,
        isNew: opts?.isNew ?? false,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        content,
        initialContent: content,
        textGrowth: textNode.textGrowth ?? "fixed-width-height",
        fontSize: textNode.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        fontFamily: textNode.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
        fontWeight: String(textNode.fontWeight ?? 400),
        textAlign: textNode.textAlign ?? "left",
        color: getFirstSolidFillColor(node),
        lineHeight: textNode.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
        commitSelection,
      });
      console.info("[skia-canvas] text.edit.started", {
        nodeId: node.id,
        isNew: opts?.isNew ?? false,
        textGrowth: textNode.textGrowth ?? "fixed-width-height",
        selectionDuringEditCount:
          opts?.selectionDuringEdit?.length ?? commitSelection.length,
      });
      return true;
    },
    [setSelection],
  );

  const textEditCaretNodeId = editingText?.nodeId ?? null;
  const textEditInitialCaretOffset = editingText?.initialContent.length ?? 0;
  useEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textarea || !textEditCaretNodeId) return;
    textarea.setSelectionRange(
      textEditInitialCaretOffset,
      textEditInitialCaretOffset,
    );
  }, [textEditCaretNodeId, textEditInitialCaretOffset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const commitTextEdit = useCallback(
    (nextContent: string) => {
      const currentEdit = editingText;
      if (!currentEdit) return;
      setEditingText(null);
      const activePageId = activePageIdRef.current;
      const trimmedContent = nextContent.trim();
      if (currentEdit.isNew && trimmedContent.length === 0) {
        const existingNode = findNode(
          docRef.current,
          currentEdit.nodeId,
          activePageId,
        );
        if (!existingNode) return;
        const next = applyCanvasOperation(docRef.current, {
          type: "deleteNode",
          nodeId: currentEdit.nodeId,
          activePageId,
        });
        commitDocument(next, { selection: [] });
        setSelection([], { notifyScene: false });
        console.info("[skia-canvas] text.edit.empty-new-deleted", {
          nodeId: currentEdit.nodeId,
        });
        return;
      }
      const measured = measureTextLayout({
        content: nextContent,
        fontSize: currentEdit.fontSize,
        fontFamily: currentEdit.fontFamily,
        fontWeight: currentEdit.fontWeight,
        lineHeight: currentEdit.lineHeight,
        textGrowth: currentEdit.textGrowth,
        width: currentEdit.width,
        height: currentEdit.height,
      });
      if (
        nextContent === currentEdit.initialContent &&
        Math.round(measured.width) === Math.round(currentEdit.width) &&
        Math.round(measured.height) === Math.round(currentEdit.height)
      ) {
        setSelection(currentEdit.commitSelection, { notifyScene: false });
        console.info("[skia-canvas] text.edit.cancelled", {
          nodeId: currentEdit.nodeId,
          reason: "unchanged",
          restoredSelectionCount: currentEdit.commitSelection.length,
        });
        return;
      }
      const existingNode = findNode(
        docRef.current,
        currentEdit.nodeId,
        activePageId,
      );
      if (!existingNode) {
        console.warn("[skia-canvas] text.edit.commit.skipped", {
          nodeId: currentEdit.nodeId,
          reason: "node_not_found",
          activePageId,
        });
        return;
      }
      const stickyContainer = getStickyNoteContainerForNode(
        docRef.current as CucumberCanvasDocument,
        currentEdit.nodeId,
        activePageId,
      );
      const nextSelection =
        currentEdit.commitSelection.length > 0
          ? currentEdit.commitSelection
          : stickyContainer
            ? [stickyContainer.id]
            : [currentEdit.nodeId];
      const next = applyCanvasOperation(docRef.current, {
        type: "updateNode",
        nodeId: currentEdit.nodeId,
        updates: {
          content: nextContent,
          width: measured.width,
          height: measured.height,
          textGrowth: currentEdit.textGrowth,
        } as Partial<PenNode>,
        activePageId,
      });
      commitDocument(next, { selection: nextSelection });
      setSelection(nextSelection, { notifyScene: false });
      console.info("[skia-canvas] text.edit.committed", {
        nodeId: currentEdit.nodeId,
        selectedNodeId: nextSelection[0] ?? null,
        textGrowth: currentEdit.textGrowth,
        previousLength: currentEdit.initialContent.length,
        nextLength: nextContent.length,
        width: Math.round(measured.width),
        height: Math.round(measured.height),
      });
    },
    [commitDocument, editingText, setSelection],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: handler reads live canvas refs as synchronous runtime mirrors; `.current` values are not React dependencies.
  const syncTextEditDraftToRenderer = useCallback((draft: TextEditState) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const activePageId = activePageIdRef.current;
    const existingNode = findNode(docRef.current, draft.nodeId, activePageId);
    if (!existingNode) {
      console.warn("[skia-canvas] text.edit.draft.skipped", {
        nodeId: draft.nodeId,
        reason: "node_not_found",
        activePageId,
      });
      return;
    }

    const draftDocument = applyCanvasOperation(docRef.current, {
      type: "updateNode",
      nodeId: draft.nodeId,
      updates: {
        content: draft.content,
        width: draft.width,
        height: draft.height,
        textGrowth: draft.textGrowth,
      } as Partial<PenNode>,
      activePageId,
    });

    if (rendererDocumentSyncRafRef.current !== null) {
      cancelAnimationFrame(rendererDocumentSyncRafRef.current);
      rendererDocumentSyncRafRef.current = null;
    }
    pendingRendererDocumentSyncRef.current = null;
    syncRendererDocument(renderer, draftDocument, activePageId);
  }, []);
  const updateTextEditDraft = useCallback(
    (nextContent: string) => {
      const current = editingText;
      if (!current) return;
      const measured = measureTextLayout({
        content: nextContent,
        fontSize: current.fontSize,
        fontFamily: current.fontFamily,
        fontWeight: current.fontWeight,
        lineHeight: current.lineHeight,
        textGrowth: current.textGrowth,
        width: current.width,
        height: current.height,
      });
      const nextDraft = {
        ...current,
        content: nextContent,
        width: measured.width,
        height: measured.height,
      };
      setEditingText(nextDraft);
      syncTextEditDraftToRenderer(nextDraft);
    },
    [editingText, syncTextEditDraftToRenderer],
  );

  return {
    beginTextEdit,
    commitTextEdit,
    editingStickyNameId,
    editingText,
    setEditingStickyNameId,
    textEditTextareaRef,
    updateTextEditDraft,
  };
}
