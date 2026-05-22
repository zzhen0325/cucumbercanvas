import type { CucumberCanvasDocument } from "@cucumber/canvas-core";

export function getPrimarySelectedId(
  doc: Pick<CucumberCanvasDocument, "selection">,
): string | null {
  const selection = doc.selection ?? [];
  return selection[selection.length - 1] ?? null;
}

export function getPrimarySelectedContainerId(
  doc: CucumberCanvasDocument,
): string | null {
  const selected = getPrimarySelectedId(doc);
  if (!selected) return null;
  const node = doc.nodes[selected];
  if (!node) return null;
  return node.type === "container" ? node.id : node.parentId;
}

export function getTopLevelSelectionIds(doc: CucumberCanvasDocument): string[] {
  const selected = new Set(doc.selection ?? []);
  return (doc.selection ?? []).filter((nodeId) => {
    let parentId = doc.nodes[nodeId]?.parentId ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = doc.nodes[parentId]?.parentId ?? null;
    }
    return true;
  });
}
