import {
  type CucumberCanvasDocument,
  findNode,
  findParent,
  isContainerNode,
} from "@cucumber/canvas-core";
import { isStickyNoteNode } from "./sticky-note-tool";

export function getPrimarySelectedId(selection: string[]): string | null {
  return selection[selection.length - 1] ?? null;
}

export function getPrimarySelectedContainerId(
  doc: CucumberCanvasDocument,
  selection: string[],
  activePageId?: string | null,
): string | null {
  const selected = getPrimarySelectedId(selection);
  if (!selected) return null;
  const node = findNode(doc, selected, activePageId);
  if (!node) return null;
  if (isContainerNode(node)) return isStickyNoteNode(node) ? null : node.id;
  const parent = findParent(doc, selected, activePageId);
  if (!parent || isStickyNoteNode(parent)) return null;
  return parent.id;
}

export function getTopLevelSelectionIds(
  doc: CucumberCanvasDocument,
  selection: string[],
  activePageId?: string | null,
): string[] {
  const selected = new Set(selection);
  return selection.filter((nodeId) => {
    let currentId: string | null =
      findParent(doc, nodeId, activePageId)?.id ?? null;
    while (currentId) {
      if (selected.has(currentId)) return false;
      currentId = findParent(doc, currentId, activePageId)?.id ?? null;
    }
    return true;
  });
}
