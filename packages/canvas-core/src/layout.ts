import type { PenDocument, PenNode } from '@cucumber/pen-types';
import { findNode, getNodeBounds } from './document.js';
import { applyCanvasOperation } from './operations.js';
import {
  getCanvasImportedNodeMeta,
  type CanvasImportedAutoLayoutMeta,
  type CanvasImportedLayoutAlign,
  type CanvasImportedPadding,
  type CanvasBounds,
} from './types.js';

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
type ContainerPenNode = PenNode & { children: PenNode[] };

type FlowLayoutEntry = {
  autoLayout?: CanvasImportedAutoLayoutMeta;
  bounds: CanvasBounds;
  node: PenNode;
  grow: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply auto-layout from imported metadata (Figma/SVG) to the subtree
 * rooted at `nodeId`. Returns a new document if any positions changed,
 * otherwise the original document.
 */
export function applyImportedAutoLayout(
  doc: PenDocument,
  nodeId: string,
  options: ApplyImportedAutoLayoutOptions = {},
): PenDocument {
  const { doc: next, changed } = reflowImportedAutoLayoutTree(doc, nodeId, options);
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
 * container node that carries imported autoLayout metadata.
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

  const autoLayout = getImportedAutoLayout(node);
  if (autoLayout) {
    const result = reflowImportedAutoLayoutChildren(currentDoc, node, autoLayout, options);
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
  autoLayout: CanvasImportedAutoLayoutMeta,
  options: ApplyImportedAutoLayoutOptions,
): { doc: PenDocument; changed: boolean } {
  if (node.children.length === 0) {
    return { doc, changed: false };
  }

  const direction = autoLayout.layout ?? 'vertical';
  const gap = Math.max(autoLayout.gap ?? 0, 0);
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
    expandPadding(autoLayout.padding);

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
        autoLayout: getImportedAutoLayout(child),
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
    .filter((entry) => entry.autoLayout?.positioning !== 'absolute');

  if (flowEntries.length === 0) {
    return { doc, changed: false };
  }

  // --- Grow and cross-axis sizing ---
  for (const entry of flowEntries) {
    entry.grow = Math.max(entry.autoLayout?.grow ?? 0, 0);
    applyCrossAxisSizing(entry, direction, contentWidth, contentHeight);
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
    direction === 'horizontal' ? contentWidth : contentHeight;
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

  // --- Justification ---
  const usedMainSpace =
    flowEntries.reduce(
      (sum, entry) => sum + getMainAxisSize(entry.bounds, direction),
      0,
    ) + totalGap;
  const freeMainSpace = Math.max(mainAxisAvailable - usedMainSpace, 0);

  let leadingMainSpace = 0;
  let gapBetweenItems = gap;
  if (autoLayout.justifyContent === 'center') {
    leadingMainSpace = freeMainSpace / 2;
  } else if (autoLayout.justifyContent === 'end') {
    leadingMainSpace = freeMainSpace;
  } else if (
    autoLayout.justifyContent === 'space_between' &&
    flowEntries.length > 1
  ) {
    gapBetweenItems = gap + freeMainSpace / (flowEntries.length - 1);
  }

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

    if (direction === 'horizontal') {
      nextBounds.x = contentX + cursor;
      nextBounds.y =
        contentY +
        resolveCrossAxisOffset(
          contentHeight,
          entry.bounds.height,
          resolveCrossAxisAlign(
            autoLayout.alignItems,
            entry.autoLayout?.alignSelf,
          ),
        );
    } else {
      nextBounds.x =
        contentX +
        resolveCrossAxisOffset(
          contentWidth,
          entry.bounds.width,
          resolveCrossAxisAlign(
            autoLayout.alignItems,
            entry.autoLayout?.alignSelf,
          ),
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
        type: 'updateNode',
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

  return { doc: currentDoc, changed };
}

// ---------------------------------------------------------------------------
// Sizing helpers
// ---------------------------------------------------------------------------

function applyCrossAxisSizing(
  entry: FlowLayoutEntry,
  direction: 'horizontal' | 'vertical',
  contentWidth: number,
  contentHeight: number,
): void {
  const align = resolveCrossAxisAlign(undefined, entry.autoLayout?.alignSelf);
  if (direction === 'horizontal') {
    if (
      entry.autoLayout?.heightMode === 'fill_container' ||
      align === 'stretch'
    ) {
      entry.bounds.height = contentHeight;
    }
    return;
  }

  if (
    entry.autoLayout?.widthMode === 'fill_container' ||
    align === 'stretch'
  ) {
    entry.bounds.width = contentWidth;
  }
}

function applySingleChildFill(
  entry: FlowLayoutEntry,
  siblingCount: number,
  direction: 'horizontal' | 'vertical',
  contentWidth: number,
  contentHeight: number,
): void {
  if (siblingCount !== 1 || entry.grow > 0) {
    return;
  }

  if (
    direction === 'horizontal' &&
    entry.autoLayout?.widthMode === 'fill_container'
  ) {
    entry.bounds.width = contentWidth;
  }
  if (
    direction === 'vertical' &&
    entry.autoLayout?.heightMode === 'fill_container'
  ) {
    entry.bounds.height = contentHeight;
  }
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

function resolveCrossAxisAlign(
  containerAlign: CanvasImportedLayoutAlign | undefined,
  childAlign: CanvasImportedAutoLayoutMeta['alignSelf'] | undefined,
): 'start' | 'center' | 'end' | 'stretch' {
  if (childAlign === 'stretch') return 'stretch';
  if (childAlign === 'center') return 'center';
  if (childAlign === 'end') return 'end';
  if (childAlign === 'baseline') return 'start';
  if (containerAlign === 'center') return 'center';
  if (containerAlign === 'end') return 'end';
  return 'start';
}

function resolveCrossAxisOffset(
  contentSize: number,
  childSize: number,
  align: 'start' | 'center' | 'end' | 'stretch',
): number {
  if (align === 'center') return Math.max((contentSize - childSize) / 2, 0);
  if (align === 'end') return Math.max(contentSize - childSize, 0);
  return 0;
}

// ---------------------------------------------------------------------------
// Axis helpers
// ---------------------------------------------------------------------------

function getMainAxisSize(
  bounds: CanvasBounds,
  direction: 'horizontal' | 'vertical',
): number {
  return direction === 'horizontal' ? bounds.width : bounds.height;
}

function setMainAxisSize(
  bounds: CanvasBounds,
  direction: 'horizontal' | 'vertical',
  size: number,
): void {
  if (direction === 'horizontal') {
    bounds.width = size;
    return;
  }
  bounds.height = size;
}

// ---------------------------------------------------------------------------
// Padding helper
// ---------------------------------------------------------------------------

function expandPadding(
  padding?: CanvasImportedPadding,
): [number, number, number, number] {
  if (padding === undefined) return [0, 0, 0, 0];
  if (typeof padding === 'number') return [padding, padding, padding, padding];
  if (padding.length === 2) return [padding[0], padding[1], padding[0], padding[1]];
  return padding;
}

// ---------------------------------------------------------------------------
// Guard / Equality helpers
// ---------------------------------------------------------------------------

function isContainerNode(node: PenNode | undefined): node is ContainerPenNode {
  return Boolean(
    node &&
      'children' in node &&
      Array.isArray((node as unknown as Record<string, unknown>).children),
  );
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

// ---------------------------------------------------------------------------
// Metadata extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract `CanvasImportedAutoLayoutMeta` from a PenNode's metadata.
 * PenNode carries imported metadata in a `meta` property set during
 * import, which is typed as `Record<string, unknown>` at runtime.
 */
function getImportedAutoLayout(
  node: PenNode,
): CanvasImportedAutoLayoutMeta | undefined {
  const meta = (node as unknown as Record<string, unknown>).meta as
    | Record<string, unknown>
    | undefined;
  return getCanvasImportedNodeMeta(meta)?.autoLayout;
}
