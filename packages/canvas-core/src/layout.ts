import type {
  ContainerProps,
  PenDocument,
  PenLayoutConstraints,
  PenNode,
} from "@cucumber/pen-types";
import { findNode, getNodeBounds } from "./document.js";
import { applyCanvasOperation } from "./operations.js";
import type { CanvasBounds } from "./types.js";

export interface ApplyImportedAutoLayoutOptions {
  contentInsetTop?: number;
  contentInsetRight?: number;
  contentInsetBottom?: number;
  contentInsetLeft?: number;
}

/**
 * A PenNode that is a container (has children).
 * FrameNode and GroupNode both satisfy this shape.
 */
type ContainerPenNode = PenNode & ContainerProps & { children: PenNode[] };

type FlowLayoutEntry = {
  layoutConstraints?: PenLayoutConstraints;
  bounds: CanvasBounds;
  node: PenNode;
  grow: number;
};

type RuntimeContainerLayout = {
  layout: "horizontal" | "vertical";
  gap?: ContainerProps["gap"];
  padding?: ContainerProps["padding"];
  justifyContent?: ContainerProps["justifyContent"];
  alignItems?: ContainerProps["alignItems"];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply runtime auto-layout to the subtree
 * rooted at `nodeId`. Returns a new document if any positions changed,
 * otherwise the original document.
 */
export function applyImportedAutoLayout(
  doc: PenDocument,
  nodeId: string,
  options: ApplyImportedAutoLayoutOptions = {},
): PenDocument {
  const { doc: next, changed } = reflowImportedAutoLayoutTree(
    doc,
    nodeId,
    options,
  );
  if (!changed) {
    return doc;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Tree traversal
// ---------------------------------------------------------------------------

/**
 * Walk the container subtree depth-first, applying auto-layout at each
 * container node that carries ContainerProps layout fields.
 */
function reflowImportedAutoLayoutTree(
  doc: PenDocument,
  nodeId: string,
  options: ApplyImportedAutoLayoutOptions,
): { doc: PenDocument; changed: boolean } {
  const node = findNode(doc, nodeId);
  if (!isContainerNode(node)) {
    return { doc, changed: false };
  }

  let changed = false;
  let currentDoc = doc;

  const containerLayout = getRuntimeContainerLayout(node);
  if (containerLayout) {
    const result = reflowImportedAutoLayoutChildren(
      currentDoc,
      node,
      containerLayout,
      options,
    );
    currentDoc = result.doc;
    changed = result.changed;
  }

  // Recurse into children. Read children from the original node snapshot
  // since the iteration order is stable; child IDs don't change.
  for (const child of node.children) {
    const result = reflowImportedAutoLayoutTree(currentDoc, child.id, options);
    currentDoc = result.doc;
    changed = result.changed || changed;
  }

  if (
    containerLayout &&
    changed &&
    hasFitContentSizing(node.layoutConstraints)
  ) {
    const latestNode = findNode(currentDoc, nodeId);
    if (isContainerNode(latestNode)) {
      const result = reflowImportedAutoLayoutChildren(
        currentDoc,
        latestNode,
        containerLayout,
        options,
      );
      currentDoc = result.doc;
      changed = result.changed || changed;
    }
  }

  return { doc: currentDoc, changed };
}

// ---------------------------------------------------------------------------
// Single-container auto-layout reflow
// ---------------------------------------------------------------------------

/**
 * Compute new positions for all "auto" children of a single container
 * and apply the updates to the document via `applyCanvasOperation`.
 */
function reflowImportedAutoLayoutChildren(
  doc: PenDocument,
  node: ContainerPenNode,
  containerLayout: RuntimeContainerLayout,
  options: ApplyImportedAutoLayoutOptions,
): { doc: PenDocument; changed: boolean } {
  if (node.children.length === 0) {
    return { doc, changed: false };
  }

  const direction = containerLayout.layout ?? "vertical";
  const gap = Math.max(
    typeof containerLayout.gap === "number" ? containerLayout.gap : 0,
    0,
  );
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = expandPadding(
    containerLayout.padding,
  );

  const nodeX = node.x ?? 0;
  const nodeY = node.y ?? 0;
  const nodeBounds = getNodeBounds(node);

  const contentX = nodeX + paddingLeft + (options.contentInsetLeft ?? 0);
  const contentY = nodeY + paddingTop + (options.contentInsetTop ?? 0);
  const contentWidth = Math.max(
    nodeBounds.width -
      paddingLeft -
      paddingRight -
      (options.contentInsetLeft ?? 0) -
      (options.contentInsetRight ?? 0),
    0,
  );
  const contentHeight = Math.max(
    nodeBounds.height -
      paddingTop -
      paddingBottom -
      (options.contentInsetTop ?? 0) -
      (options.contentInsetBottom ?? 0),
    0,
  );

  // Build flow entries for all children that participate in auto-layout.
  const flowEntries: FlowLayoutEntry[] = node.children
    .filter((child): child is PenNode => Boolean(child))
    .map((child) => {
      const childBounds = getNodeBounds(child);
      return {
        layoutConstraints: child.layoutConstraints,
        bounds: {
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: childBounds.width,
          height: childBounds.height,
        },
        node: child,
        grow: 0,
      };
    })
    .filter((entry) => entry.layoutConstraints?.positioning !== "absolute");

  if (flowEntries.length === 0) {
    return { doc, changed: false };
  }

  // --- Grow and cross-axis sizing ---
  for (const entry of flowEntries) {
    entry.grow = resolveMainAxisGrow(entry, direction);
    applyCrossAxisSizing(
      entry,
      direction,
      contentWidth,
      contentHeight,
      containerLayout.alignItems,
    );
    applySingleChildFill(
      entry,
      flowEntries.length,
      direction,
      contentWidth,
      contentHeight,
    );
  }

  // --- Main-axis space distribution (grow) ---
  const mainAxisAvailable =
    direction === "horizontal" ? contentWidth : contentHeight;
  const totalGap = gap * Math.max(flowEntries.length - 1, 0);
  const fixedMainSize = flowEntries.reduce(
    (sum, entry) => sum + getMainAxisSize(entry.bounds, direction),
    0,
  );
  const totalGrow = flowEntries.reduce((sum, entry) => sum + entry.grow, 0);
  const remainingMainSpace = Math.max(
    mainAxisAvailable - fixedMainSize - totalGap,
    0,
  );

  if (totalGrow > 0 && remainingMainSpace > 0) {
    for (const entry of flowEntries) {
      if (entry.grow <= 0) continue;
      const nextMainSize =
        getMainAxisSize(entry.bounds, direction) +
        (remainingMainSpace * entry.grow) / totalGrow;
      setMainAxisSize(entry.bounds, direction, nextMainSize);
    }
  }

  const fitBounds = resolveFitContentBounds(
    node.layoutConstraints,
    direction,
    flowEntries,
    gap,
    {
      width: nodeBounds.width,
      height: nodeBounds.height,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      contentInsetTop: options.contentInsetTop ?? 0,
      contentInsetRight: options.contentInsetRight ?? 0,
      contentInsetBottom: options.contentInsetBottom ?? 0,
      contentInsetLeft: options.contentInsetLeft ?? 0,
    },
  );
  const layoutContentWidth =
    fitBounds.width !== undefined
      ? Math.max(
          fitBounds.width -
            paddingLeft -
            paddingRight -
            (options.contentInsetLeft ?? 0) -
            (options.contentInsetRight ?? 0),
          0,
        )
      : contentWidth;
  const layoutContentHeight =
    fitBounds.height !== undefined
      ? Math.max(
          fitBounds.height -
            paddingTop -
            paddingBottom -
            (options.contentInsetTop ?? 0) -
            (options.contentInsetBottom ?? 0),
          0,
        )
      : contentHeight;

  // --- Justification ---
  const usedMainSpace =
    flowEntries.reduce(
      (sum, entry) => sum + getMainAxisSize(entry.bounds, direction),
      0,
    ) + totalGap;
  const layoutMainAxisAvailable =
    direction === "horizontal" ? layoutContentWidth : layoutContentHeight;
  const freeMainSpace = Math.max(layoutMainAxisAvailable - usedMainSpace, 0);

  let leadingMainSpace = 0;
  let gapBetweenItems = gap;
  if (containerLayout.justifyContent === "center") {
    leadingMainSpace = freeMainSpace / 2;
  } else if (containerLayout.justifyContent === "end") {
    leadingMainSpace = freeMainSpace;
  } else if (
    containerLayout.justifyContent === "space_between" &&
    flowEntries.length > 1
  ) {
    gapBetweenItems = gap + freeMainSpace / (flowEntries.length - 1);
  }
  const baselineTarget =
    direction === "horizontal"
      ? resolveBaselineTarget(flowEntries, containerLayout)
      : undefined;

  // --- Apply position updates ---
  let cursor = leadingMainSpace;
  let changed = false;
  let currentDoc = doc;

  for (const entry of flowEntries) {
    const nextBounds: CanvasBounds = {
      x: 0,
      y: 0,
      width: entry.bounds.width,
      height: entry.bounds.height,
    };

    if (direction === "horizontal") {
      nextBounds.x = contentX + cursor;
      const crossAlign = resolveCrossAxisAlign(
        containerLayout.alignItems,
        entry.layoutConstraints?.alignSelf,
      );
      nextBounds.y =
        crossAlign === "baseline" && baselineTarget !== undefined
          ? contentY + baselineTarget - getBaselineOffset(entry)
          : contentY +
            resolveCrossAxisOffset(
              layoutContentHeight,
              entry.bounds.height,
              crossAlign,
            );
    } else {
      const crossAlign = resolveCrossAxisAlign(
        containerLayout.alignItems,
        entry.layoutConstraints?.alignSelf,
      );
      nextBounds.x =
        contentX +
        resolveCrossAxisOffset(
          layoutContentWidth,
          entry.bounds.width,
          crossAlign,
        );
      nextBounds.y = contentY + cursor;
    }

    const currentBounds: CanvasBounds = {
      x: entry.node.x ?? 0,
      y: entry.node.y ?? 0,
      width: getNodeBounds(entry.node).width,
      height: getNodeBounds(entry.node).height,
    };

    if (!areBoundsEqual(currentBounds, nextBounds)) {
      currentDoc = applyCanvasOperation(currentDoc, {
        type: "updateNode",
        nodeId: entry.node.id,
        updates: {
          x: nextBounds.x,
          y: nextBounds.y,
          width: nextBounds.width,
          height: nextBounds.height,
        },
      });
      changed = true;
    }

    cursor += getMainAxisSize(entry.bounds, direction) + gapBetweenItems;
  }

  const nextNodeBounds: Partial<CanvasBounds> = {};
  if (
    fitBounds.width !== undefined &&
    !approximatelyEqual(nodeBounds.width, fitBounds.width)
  ) {
    nextNodeBounds.width = fitBounds.width;
  }
  if (
    fitBounds.height !== undefined &&
    !approximatelyEqual(nodeBounds.height, fitBounds.height)
  ) {
    nextNodeBounds.height = fitBounds.height;
  }
  if (
    nextNodeBounds.width !== undefined ||
    nextNodeBounds.height !== undefined
  ) {
    currentDoc = applyCanvasOperation(currentDoc, {
      type: "updateNode",
      nodeId: node.id,
      updates: nextNodeBounds,
    });
    changed = true;
  }

  return { doc: currentDoc, changed };
}

// ---------------------------------------------------------------------------
// Sizing helpers
// ---------------------------------------------------------------------------

function applyCrossAxisSizing(
  entry: FlowLayoutEntry,
  direction: "horizontal" | "vertical",
  contentWidth: number,
  contentHeight: number,
  containerAlign?: RuntimeContainerLayout["alignItems"],
): void {
  const align = resolveCrossAxisAlign(
    containerAlign,
    entry.layoutConstraints?.alignSelf,
  );
  if (direction === "horizontal") {
    if (
      entry.layoutConstraints?.heightMode === "fill_container" ||
      align === "stretch"
    ) {
      entry.bounds.height = contentHeight;
    }
    return;
  }

  if (
    entry.layoutConstraints?.widthMode === "fill_container" ||
    align === "stretch"
  ) {
    entry.bounds.width = contentWidth;
  }
}

function resolveMainAxisGrow(
  entry: FlowLayoutEntry,
  direction: "horizontal" | "vertical",
): number {
  const explicitGrow = Math.max(entry.layoutConstraints?.grow ?? 0, 0);
  if (explicitGrow > 0) return explicitGrow;
  if (isMainAxisFillContainer(entry, direction)) return 1;
  return 0;
}

function isMainAxisFillContainer(
  entry: FlowLayoutEntry,
  direction: "horizontal" | "vertical",
): boolean {
  if (direction === "horizontal") {
    return entry.layoutConstraints?.widthMode === "fill_container";
  }
  return entry.layoutConstraints?.heightMode === "fill_container";
}

function applySingleChildFill(
  entry: FlowLayoutEntry,
  siblingCount: number,
  direction: "horizontal" | "vertical",
  contentWidth: number,
  contentHeight: number,
): void {
  if (siblingCount !== 1 || entry.grow > 0) {
    return;
  }

  if (
    direction === "horizontal" &&
    entry.layoutConstraints?.widthMode === "fill_container"
  ) {
    entry.bounds.width = contentWidth;
  }
  if (
    direction === "vertical" &&
    entry.layoutConstraints?.heightMode === "fill_container"
  ) {
    entry.bounds.height = contentHeight;
  }
}

function hasFitContentSizing(
  constraints: PenLayoutConstraints | undefined,
): boolean {
  return (
    constraints?.widthMode === "fit_content" ||
    constraints?.heightMode === "fit_content"
  );
}

function resolveFitContentBounds(
  constraints: PenLayoutConstraints | undefined,
  direction: "horizontal" | "vertical",
  flowEntries: FlowLayoutEntry[],
  gap: number,
  options: {
    width: number;
    height: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    contentInsetTop: number;
    contentInsetRight: number;
    contentInsetBottom: number;
    contentInsetLeft: number;
  },
): { width?: number; height?: number } {
  if (
    constraints?.widthMode !== "fit_content" &&
    constraints?.heightMode !== "fit_content"
  ) {
    return {};
  }

  const totalGap = gap * Math.max(flowEntries.length - 1, 0);
  const mainSize =
    flowEntries.reduce(
      (sum, entry) => sum + getMainAxisSize(entry.bounds, direction),
      0,
    ) + totalGap;
  const crossSize = flowEntries.reduce(
    (max, entry) => Math.max(max, getCrossAxisSize(entry.bounds, direction)),
    0,
  );
  const contentWidth = direction === "horizontal" ? mainSize : crossSize;
  const contentHeight = direction === "horizontal" ? crossSize : mainSize;

  return {
    width:
      constraints?.widthMode === "fit_content"
        ? contentWidth +
          options.paddingLeft +
          options.paddingRight +
          options.contentInsetLeft +
          options.contentInsetRight
        : undefined,
    height:
      constraints?.heightMode === "fit_content"
        ? contentHeight +
          options.paddingTop +
          options.paddingBottom +
          options.contentInsetTop +
          options.contentInsetBottom
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

function resolveCrossAxisAlign(
  containerAlign: RuntimeContainerLayout["alignItems"] | undefined,
  childAlign: PenLayoutConstraints["alignSelf"] | undefined,
): "start" | "center" | "end" | "stretch" | "baseline" {
  if (childAlign === "stretch") return "stretch";
  if (childAlign === "center") return "center";
  if (childAlign === "end") return "end";
  if (childAlign === "baseline") return "baseline";
  if (containerAlign === "center") return "center";
  if (containerAlign === "end") return "end";
  if (containerAlign === "baseline") return "baseline";
  if (containerAlign === "stretch") return "stretch";
  return "start";
}

function resolveCrossAxisOffset(
  contentSize: number,
  childSize: number,
  align: "start" | "center" | "end" | "stretch" | "baseline",
): number {
  if (align === "center") return Math.max((contentSize - childSize) / 2, 0);
  if (align === "end") return Math.max(contentSize - childSize, 0);
  return 0;
}

function resolveBaselineTarget(
  entries: FlowLayoutEntry[],
  containerLayout: RuntimeContainerLayout,
): number | undefined {
  const baselineOffsets = entries
    .filter(
      (entry) =>
        resolveCrossAxisAlign(
          containerLayout.alignItems,
          entry.layoutConstraints?.alignSelf,
        ) === "baseline",
    )
    .map(getBaselineOffset);
  return baselineOffsets.length > 0 ? Math.max(...baselineOffsets) : undefined;
}

function getBaselineOffset(entry: FlowLayoutEntry): number {
  if (entry.node.type !== "text") {
    return entry.bounds.height;
  }
  const textNode = entry.node as PenNode & {
    fontSize?: number;
    baselineShift?: number;
  };
  const fontSize =
    typeof textNode.fontSize === "number"
      ? textNode.fontSize
      : entry.bounds.height;
  const baseline = fontSize * 0.8 + (textNode.baselineShift ?? 0);
  return Math.max(0, Math.min(entry.bounds.height, baseline));
}

// ---------------------------------------------------------------------------
// Axis helpers
// ---------------------------------------------------------------------------

function getMainAxisSize(
  bounds: CanvasBounds,
  direction: "horizontal" | "vertical",
): number {
  return direction === "horizontal" ? bounds.width : bounds.height;
}

function setMainAxisSize(
  bounds: CanvasBounds,
  direction: "horizontal" | "vertical",
  size: number,
): void {
  if (direction === "horizontal") {
    bounds.width = size;
    return;
  }
  bounds.height = size;
}

function getCrossAxisSize(
  bounds: CanvasBounds,
  direction: "horizontal" | "vertical",
): number {
  return direction === "horizontal" ? bounds.height : bounds.width;
}

// ---------------------------------------------------------------------------
// Padding helper
// ---------------------------------------------------------------------------

function expandPadding(
  padding?: RuntimeContainerLayout["padding"],
): [number, number, number, number] {
  if (padding === undefined) return [0, 0, 0, 0];
  if (typeof padding === "string") return [0, 0, 0, 0];
  if (typeof padding === "number") return [padding, padding, padding, padding];
  if (padding.length === 2)
    return [padding[0], padding[1], padding[0], padding[1]];
  return padding;
}

// ---------------------------------------------------------------------------
// Guard / Equality helpers
// ---------------------------------------------------------------------------

function isContainerNode(node: PenNode | undefined): node is ContainerPenNode {
  return Boolean(
    node &&
      "children" in node &&
      Array.isArray((node as unknown as Record<string, unknown>).children),
  );
}

function getRuntimeContainerLayout(
  node: ContainerPenNode,
): RuntimeContainerLayout | undefined {
  if (node.layout !== "horizontal" && node.layout !== "vertical") {
    return undefined;
  }
  return {
    layout: node.layout,
    gap: node.gap,
    padding: node.padding,
    justifyContent: node.justifyContent,
    alignItems: node.alignItems,
  };
}

function areBoundsEqual(left: CanvasBounds, right: CanvasBounds): boolean {
  return (
    approximatelyEqual(left.x, right.x) &&
    approximatelyEqual(left.y, right.y) &&
    approximatelyEqual(left.width, right.width) &&
    approximatelyEqual(left.height, right.height)
  );
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.01;
}
