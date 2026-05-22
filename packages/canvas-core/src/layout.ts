import { cloneCanvasDocument } from "./document.js";
import {
  getCanvasImportedNodeMeta,
  type CanvasImportedAutoLayoutMeta,
  type CanvasImportedLayoutAlign,
  type CanvasImportedPadding,
  type CanvasNode,
  type CucumberCanvasDocument,
} from "./types.js";

export interface ApplyImportedAutoLayoutOptions {
  contentInsetTop?: number;
  contentInsetRight?: number;
  contentInsetBottom?: number;
  contentInsetLeft?: number;
}

type ChildOrderNode = CanvasNode & { childrenOrder: string[] };

type FlowLayoutEntry = {
  autoLayout?: CanvasImportedAutoLayoutMeta;
  bounds: CanvasNode["bounds"];
  node: CanvasNode;
  grow: number;
};

export function applyImportedAutoLayout(
  doc: CucumberCanvasDocument,
  nodeId: string,
  options: ApplyImportedAutoLayoutOptions = {},
): CucumberCanvasDocument {
  const next = cloneCanvasDocument(doc);
  const changed = reflowImportedAutoLayoutTree(next, nodeId, options);
  if (!changed) {
    return doc;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function reflowImportedAutoLayoutTree(
  doc: CucumberCanvasDocument,
  nodeId: string,
  options: ApplyImportedAutoLayoutOptions,
): boolean {
  const node = doc.nodes[nodeId];
  if (!hasChildrenOrder(node)) {
    return false;
  }

  let changed = false;
  const autoLayout = getCanvasImportedNodeMeta(node.meta)?.autoLayout;
  if (autoLayout) {
    changed = reflowImportedAutoLayoutChildren(doc, node, autoLayout, options);
  }

  for (const childId of node.childrenOrder) {
    changed =
      reflowImportedAutoLayoutTree(doc, childId, options) || changed;
  }

  return changed;
}

function reflowImportedAutoLayoutChildren(
  doc: CucumberCanvasDocument,
  node: ChildOrderNode,
  autoLayout: CanvasImportedAutoLayoutMeta,
  options: ApplyImportedAutoLayoutOptions,
): boolean {
  if (node.childrenOrder.length === 0) {
    return false;
  }

  const direction = autoLayout.layout ?? "vertical";
  const gap = Math.max(autoLayout.gap ?? 0, 0);
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
    expandPadding(autoLayout.padding);
  const contentX = node.bounds.x + paddingLeft + (options.contentInsetLeft ?? 0);
  const contentY = node.bounds.y + paddingTop + (options.contentInsetTop ?? 0);
  const contentWidth = Math.max(
    node.bounds.width -
      paddingLeft -
      paddingRight -
      (options.contentInsetLeft ?? 0) -
      (options.contentInsetRight ?? 0),
    0,
  );
  const contentHeight = Math.max(
    node.bounds.height -
      paddingTop -
      paddingBottom -
      (options.contentInsetTop ?? 0) -
      (options.contentInsetBottom ?? 0),
    0,
  );

  const flowEntries = node.childrenOrder
    .map((childId) => doc.nodes[childId])
    .filter((child): child is CanvasNode => Boolean(child))
    .map((child) => ({
      autoLayout: getCanvasImportedNodeMeta(child.meta)?.autoLayout,
      bounds: { ...child.bounds },
      node: child,
      grow: 0,
    }))
    .filter((entry) => entry.autoLayout?.positioning !== "absolute");

  if (flowEntries.length === 0) {
    return false;
  }

  for (const entry of flowEntries) {
    entry.grow = Math.max(entry.autoLayout?.grow ?? 0, 0);
    applyCrossAxisSizing(entry, direction, contentWidth, contentHeight);
    applySingleChildFill(entry, flowEntries.length, direction, contentWidth, contentHeight);
  }

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

  const usedMainSpace =
    flowEntries.reduce(
      (sum, entry) => sum + getMainAxisSize(entry.bounds, direction),
      0,
    ) + totalGap;
  const freeMainSpace = Math.max(mainAxisAvailable - usedMainSpace, 0);

  let leadingMainSpace = 0;
  let gapBetweenItems = gap;
  if (autoLayout.justifyContent === "center") {
    leadingMainSpace = freeMainSpace / 2;
  } else if (autoLayout.justifyContent === "end") {
    leadingMainSpace = freeMainSpace;
  } else if (
    autoLayout.justifyContent === "space_between" &&
    flowEntries.length > 1
  ) {
    gapBetweenItems = gap + freeMainSpace / (flowEntries.length - 1);
  }

  let cursor = leadingMainSpace;
  let changed = false;
  for (const entry of flowEntries) {
    const nextBounds = { ...entry.node.bounds };
    if (direction === "horizontal") {
      nextBounds.x = contentX + cursor;
      nextBounds.y =
        contentY +
        resolveCrossAxisOffset(
          contentHeight,
          entry.bounds.height,
          resolveCrossAxisAlign(autoLayout.alignItems, entry.autoLayout?.alignSelf),
        );
    } else {
      nextBounds.x =
        contentX +
        resolveCrossAxisOffset(
          contentWidth,
          entry.bounds.width,
          resolveCrossAxisAlign(autoLayout.alignItems, entry.autoLayout?.alignSelf),
        );
      nextBounds.y = contentY + cursor;
    }
    nextBounds.width = entry.bounds.width;
    nextBounds.height = entry.bounds.height;

    if (!areBoundsEqual(entry.node.bounds, nextBounds)) {
      doc.nodes[entry.node.id] = {
        ...entry.node,
        bounds: nextBounds,
      };
      changed = true;
    }

    cursor += getMainAxisSize(entry.bounds, direction) + gapBetweenItems;
  }

  return changed;
}

function applyCrossAxisSizing(
  entry: FlowLayoutEntry,
  direction: "horizontal" | "vertical",
  contentWidth: number,
  contentHeight: number,
): void {
  const align = resolveCrossAxisAlign(undefined, entry.autoLayout?.alignSelf);
  if (direction === "horizontal") {
    if (
      entry.autoLayout?.heightMode === "fill_container" ||
      align === "stretch"
    ) {
      entry.bounds.height = contentHeight;
    }
    return;
  }

  if (
    entry.autoLayout?.widthMode === "fill_container" ||
    align === "stretch"
  ) {
    entry.bounds.width = contentWidth;
  }
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

  if (direction === "horizontal" && entry.autoLayout?.widthMode === "fill_container") {
    entry.bounds.width = contentWidth;
  }
  if (direction === "vertical" && entry.autoLayout?.heightMode === "fill_container") {
    entry.bounds.height = contentHeight;
  }
}

function resolveCrossAxisAlign(
  containerAlign: CanvasImportedLayoutAlign | undefined,
  childAlign:
    | CanvasImportedAutoLayoutMeta["alignSelf"]
    | undefined,
): "start" | "center" | "end" | "stretch" {
  if (childAlign === "stretch") {
    return "stretch";
  }
  if (childAlign === "center") {
    return "center";
  }
  if (childAlign === "end") {
    return "end";
  }
  if (childAlign === "baseline") {
    return "start";
  }
  if (containerAlign === "center") {
    return "center";
  }
  if (containerAlign === "end") {
    return "end";
  }
  return "start";
}

function resolveCrossAxisOffset(
  contentSize: number,
  childSize: number,
  align: "start" | "center" | "end" | "stretch",
): number {
  if (align === "center") {
    return Math.max((contentSize - childSize) / 2, 0);
  }
  if (align === "end") {
    return Math.max(contentSize - childSize, 0);
  }
  return 0;
}

function getMainAxisSize(
  bounds: CanvasNode["bounds"],
  direction: "horizontal" | "vertical",
): number {
  return direction === "horizontal" ? bounds.width : bounds.height;
}

function setMainAxisSize(
  bounds: CanvasNode["bounds"],
  direction: "horizontal" | "vertical",
  size: number,
): void {
  if (direction === "horizontal") {
    bounds.width = size;
    return;
  }
  bounds.height = size;
}

function expandPadding(padding?: CanvasImportedPadding): [number, number, number, number] {
  if (padding === undefined) {
    return [0, 0, 0, 0];
  }
  if (typeof padding === "number") {
    return [padding, padding, padding, padding];
  }
  if (padding.length === 2) {
    return [padding[0], padding[1], padding[0], padding[1]];
  }
  return padding;
}

function hasChildrenOrder(node: CanvasNode | undefined): node is ChildOrderNode {
  return Boolean(node && "childrenOrder" in node);
}

function areBoundsEqual(
  left: CanvasNode["bounds"],
  right: CanvasNode["bounds"],
): boolean {
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
