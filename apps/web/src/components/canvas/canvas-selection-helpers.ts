import { type CucumberCanvasDocument, findNode, findParent, isContainerNode } from "@cucumber/canvas-core";

export function getPrimarySelectedId(selection: string[]): string | null {
  return selection[selection.length - 1] ?? null;
}

export function getPrimarySelectedContainerId(
  doc: CucumberCanvasDocument,
  selection: string[],
): string | null {
  const selected = getPrimarySelectedId(selection);
  if (!selected) return null;
  const node = findNode(doc, selected);
  if (!node) return null;
  if (isContainerNode(node)) return node.id;
  return findParent(doc, selected)?.id ?? null;
}

export function getTopLevelSelectionIds(
  doc: CucumberCanvasDocument,
  selection: string[],
): string[] {
  const selected = new Set(selection);
  return selection.filter((nodeId) => {
    let currentId: string | null = findParent(doc, nodeId)?.id ?? null;
    while (currentId) {
      if (selected.has(currentId)) return false;
      currentId = findParent(doc, currentId)?.id ?? null;
    }
    return true;
  });
}
