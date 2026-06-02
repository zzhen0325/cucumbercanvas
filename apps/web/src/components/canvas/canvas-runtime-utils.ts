import { findNode } from "@cucumber/canvas-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";

import type { CanvasApiDocument, CanvasApiRuntimeState } from "./canvas-api";

export function getCanvasApiRuntimeState(
  doc: PenDocument,
  fallbackSelection: readonly string[] = [],
): CanvasApiRuntimeState {
  const document = doc as CanvasApiDocument;
  return {
    document,
    selection: document.selection ?? [...fallbackSelection],
    assets: document.assets ?? {},
    viewport: document.viewport ?? {
      x: 0,
      y: 0,
      zoom: 1,
      backgroundColor: "#F0F0F0",
    },
  };
}

export function isPenNode(node: PenNode | undefined): node is PenNode {
  return Boolean(node);
}

export function hasPenChildren(node: PenNode | undefined): node is PenNode & {
  children: PenNode[];
} {
  return Boolean(
    node &&
      "children" in node &&
      Array.isArray((node as { children?: unknown }).children),
  );
}

export function getDocumentSelection(
  doc: PenDocument,
  fallbackSelection: string[],
): string[] {
  return getCanvasApiRuntimeState(doc, fallbackSelection).selection;
}

export function filterSelectionForActivePage(
  doc: PenDocument,
  selection: string[],
  activePageId?: string | null,
): string[] {
  return selection.filter((id) => Boolean(findNode(doc, id, activePageId)));
}

export function areStringArraysEqual(
  a: readonly string[],
  b: readonly string[],
) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
