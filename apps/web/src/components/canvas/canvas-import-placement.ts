import type { CanvasBounds } from "@cucumber/canvas-core";

export function hasFileDataTransfer(
  dataTransfer: DataTransfer | null,
): boolean {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types ?? []).includes("Files")) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );
}

export function computeImportGridPlacements(
  boundsList: Array<CanvasBounds | null>,
  center: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const count = boundsList.length;
  if (count === 0) return [];
  if (count === 1) return [center];

  const gap = 24;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.max(
    1,
    ...boundsList.map((bounds) => bounds?.width ?? 320),
  );
  const cellHeight = Math.max(
    1,
    ...boundsList.map((bounds) => bounds?.height ?? 240),
  );
  const totalWidth = columns * cellWidth + (columns - 1) * gap;
  const totalHeight = rows * cellHeight + (rows - 1) * gap;
  const startX = center.x - totalWidth / 2;
  const startY = center.y - totalHeight / 2;

  return boundsList.map((bounds, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const width = bounds?.width ?? cellWidth;
    const height = bounds?.height ?? cellHeight;
    return {
      x: startX + column * (cellWidth + gap) + width / 2,
      y: startY + row * (cellHeight + gap) + height / 2,
    };
  });
}

export function describeImportGridPlacements(
  boundsList: Array<CanvasBounds | null>,
): {
  columns: number;
  rows: number;
  gap: number;
  itemCount: number;
} {
  const itemCount = boundsList.length;
  const columns = itemCount <= 1 ? itemCount : Math.ceil(Math.sqrt(itemCount));
  return {
    columns,
    rows: columns > 0 ? Math.ceil(itemCount / columns) : 0,
    gap: 24,
    itemCount,
  };
}
