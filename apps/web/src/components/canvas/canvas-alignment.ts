import type {
  CanvasBounds,
  CucumberCanvasDocument,
} from "@cucumber/canvas-core";
import { flattenNodes, getNodeBounds } from "@cucumber/canvas-core";

export const ALIGN_GUIDE_COLOR = "#FF6B35";
export const ALIGN_SNAP_THRESHOLD = 5; // scene units

export interface AlignGuide {
  /** Scene position of the guide line */
  position: number;
  /** "vertical" guide spans horizontally (x-alignment), "horizontal" spans vertically (y-alignment) */
  orientation: "vertical" | "horizontal";
}

export interface SnapResult {
  bounds: CanvasBounds;
  guides: AlignGuide[];
}

/**
 * Snap a bounds position to nearby node edges/centers during move.
 * Returns snapped bounds and alignment guides.
 */
export function snapToAlignmentGuides(
  doc: CucumberCanvasDocument,
  movingNodeIds: string[],
  proposedBounds: CanvasBounds,
  originBounds: CanvasBounds,
): SnapResult {
  const guides: AlignGuide[] = [];
  let snappedX = proposedBounds.x;
  let snappedY = proposedBounds.y;
  let snappedW = proposedBounds.width;
  let snappedH = proposedBounds.height;

  // Collect reference edges from all visible nodes NOT being moved
  const references = collectReferenceEdges(doc, movingNodeIds);
  if (references.length === 0) {
    return { bounds: proposedBounds, guides: [] };
  }

  // Moving edges
  const moving = {
    left: proposedBounds.x,
    centerX: proposedBounds.x + proposedBounds.width / 2,
    right: proposedBounds.x + proposedBounds.width,
    top: proposedBounds.y,
    centerY: proposedBounds.y + proposedBounds.height / 2,
    bottom: proposedBounds.y + proposedBounds.height,
    width: proposedBounds.width,
    height: proposedBounds.height,
  };

  // Also compute origin edges to check which edges actually moved
  const origin = {
    left: originBounds.x,
    centerX: originBounds.x + originBounds.width / 2,
    right: originBounds.x + originBounds.width,
    top: originBounds.y,
    centerY: originBounds.y + originBounds.height / 2,
    bottom: originBounds.y + originBounds.height,
    width: originBounds.width,
    height: originBounds.height,
  };

  let bestXDx = Number.POSITIVE_INFINITY;
  let bestYDy = Number.POSITIVE_INFINITY;
  let bestXGuide: AlignGuide | null = null;
  let bestYGuide: AlignGuide | null = null;

  const threshold = ALIGN_SNAP_THRESHOLD;

  for (const ref of references) {
    // X-axis alignment (vertical guides)
    const xCandidates: Array<{
      movingEdge: number;
      refEdge: number;
      label: string;
    }> = [
      { movingEdge: moving.left, refEdge: ref.left, label: "left" },
      { movingEdge: moving.centerX, refEdge: ref.centerX, label: "centerX" },
      { movingEdge: moving.right, refEdge: ref.right, label: "right" },
      { movingEdge: moving.left, refEdge: ref.right, label: "left-right" },
      { movingEdge: moving.right, refEdge: ref.left, label: "right-left" },
      { movingEdge: moving.centerX, refEdge: ref.left, label: "centerX-left" },
      {
        movingEdge: moving.centerX,
        refEdge: ref.right,
        label: "centerX-right",
      },
    ];

    for (const { movingEdge, refEdge } of xCandidates) {
      const dx = Math.abs(movingEdge - refEdge);
      // Only snap if this edge has actually moved from origin
      const movedLeft = Math.abs(moving.left - origin.left);
      const movedRight = Math.abs(moving.right - origin.right);
      if (movedLeft < 0.5 && movedRight < 0.5) continue; // no horizontal movement
      if (dx < threshold && dx < bestXDx) {
        bestXDx = dx;
        const snapDelta = refEdge - movingEdge;
        snappedX = proposedBounds.x + snapDelta;
        snappedW = proposedBounds.width;
        bestXGuide = { position: refEdge, orientation: "vertical" };
      }
    }

    // Y-axis alignment (horizontal guides)
    const yCandidates: Array<{
      movingEdge: number;
      refEdge: number;
      label: string;
    }> = [
      { movingEdge: moving.top, refEdge: ref.top, label: "top" },
      { movingEdge: moving.centerY, refEdge: ref.centerY, label: "centerY" },
      { movingEdge: moving.bottom, refEdge: ref.bottom, label: "bottom" },
      { movingEdge: moving.top, refEdge: ref.bottom, label: "top-bottom" },
      { movingEdge: moving.bottom, refEdge: ref.top, label: "bottom-top" },
      { movingEdge: moving.centerY, refEdge: ref.top, label: "centerY-top" },
      {
        movingEdge: moving.centerY,
        refEdge: ref.bottom,
        label: "centerY-bottom",
      },
    ];

    for (const { movingEdge, refEdge } of yCandidates) {
      const dy = Math.abs(movingEdge - refEdge);
      const movedTop = Math.abs(moving.top - origin.top);
      const movedBottom = Math.abs(moving.bottom - origin.bottom);
      if (movedTop < 0.5 && movedBottom < 0.5) continue; // no vertical movement
      if (dy < threshold && dy < bestYDy) {
        bestYDy = dy;
        const snapDelta = refEdge - movingEdge;
        snappedY = proposedBounds.y + snapDelta;
        snappedH = proposedBounds.height;
        bestYGuide = { position: refEdge, orientation: "horizontal" };
      }
    }
  }

  if (bestXGuide) guides.push(bestXGuide);
  if (bestYGuide) guides.push(bestYGuide);

  return {
    bounds: { x: snappedX, y: snappedY, width: snappedW, height: snappedH },
    guides,
  };
}

/**
 * Snap during resize — aligns the resized edge to nearby node edges.
 */
export function snapResizeToGuides(
  doc: CucumberCanvasDocument,
  resizingNodeId: string,
  proposedBounds: CanvasBounds,
): SnapResult {
  const guides: AlignGuide[] = [];
  let snappedX = proposedBounds.x;
  let snappedY = proposedBounds.y;
  let snappedW = proposedBounds.width;
  let snappedH = proposedBounds.height;

  const references = collectReferenceEdges(doc, [resizingNodeId]);
  if (references.length === 0) {
    return { bounds: proposedBounds, guides: [] };
  }

  const threshold = ALIGN_SNAP_THRESHOLD;
  let bestGuide: AlignGuide | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  // Snap right edge
  const right = proposedBounds.x + proposedBounds.width;
  for (const ref of references) {
    for (const refEdge of [ref.left, ref.centerX, ref.right]) {
      const d = Math.abs(right - refEdge);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        snappedW = refEdge - proposedBounds.x;
        bestGuide = { position: refEdge, orientation: "vertical" };
      }
    }
  }

  // Snap left edge
  for (const ref of references) {
    for (const refEdge of [ref.left, ref.centerX, ref.right]) {
      const d = Math.abs(proposedBounds.x - refEdge);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        snappedX = refEdge;
        snappedW = proposedBounds.x + proposedBounds.width - refEdge;
        bestGuide = { position: refEdge, orientation: "vertical" };
      }
    }
  }

  // Snap bottom edge
  const bottom = proposedBounds.y + proposedBounds.height;
  for (const ref of references) {
    for (const refEdge of [ref.top, ref.centerY, ref.bottom]) {
      const d = Math.abs(bottom - refEdge);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        snappedH = refEdge - proposedBounds.y;
        bestGuide = { position: refEdge, orientation: "horizontal" };
      }
    }
  }

  // Snap top edge
  for (const ref of references) {
    for (const refEdge of [ref.top, ref.centerY, ref.bottom]) {
      const d = Math.abs(proposedBounds.y - refEdge);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        snappedY = refEdge;
        snappedH = proposedBounds.y + proposedBounds.height - refEdge;
        bestGuide = { position: refEdge, orientation: "horizontal" };
      }
    }
  }

  if (bestGuide) guides.push(bestGuide);

  return {
    bounds: { x: snappedX, y: snappedY, width: snappedW, height: snappedH },
    guides,
  };
}

interface RefEdges {
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
}

function collectReferenceEdges(
  doc: CucumberCanvasDocument,
  excludeIds: string[],
): RefEdges[] {
  const excludeSet = new Set(excludeIds);
  const result: RefEdges[] = [];
  for (const node of flattenNodes(doc)) {
    if (excludeSet.has(node.id)) continue;
    if (node.visible === false) continue;
    if (node.type === "group") continue;
    const b = getNodeBounds(node);
    result.push({
      left: b.x,
      centerX: b.x + b.width / 2,
      right: b.x + b.width,
      top: b.y,
      centerY: b.y + b.height / 2,
      bottom: b.y + b.height,
    });
  }
  return result;
}
