import type {
  ContainerProps,
  Padding,
  PenLayoutConstraints,
  PenNode,
  SizingBehavior,
} from "@cucumber/pen-types";
export type { Padding } from "@cucumber/pen-types";
import { isOverlayNode } from "../node-helpers.js";
import {
  countExplicitTextLines,
  defaultLineHeight,
  estimateLineWidth,
  estimateTextHeight,
  estimateTextWidth,
  estimateTextWidthPrecise,
  parseSizing,
  resolveTextContent,
} from "./text-measure.js";

// ---------------------------------------------------------------------------
// Padding
// ---------------------------------------------------------------------------

export function resolvePadding(
  padding:
    | number
    | [number, number]
    | [number, number, number, number]
    | string
    | undefined,
): Padding {
  if (!padding || typeof padding === "string")
    return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof padding === "number")
    return { top: padding, right: padding, bottom: padding, left: padding };
  if (padding.length === 2)
    return {
      top: padding[0],
      right: padding[1],
      bottom: padding[0],
      left: padding[1],
    };
  return {
    top: padding[0],
    right: padding[1],
    bottom: padding[2],
    left: padding[3],
  };
}

// ---------------------------------------------------------------------------
// Visibility check
// ---------------------------------------------------------------------------

export function isNodeVisible(node: PenNode): boolean {
  return (
    ("visible" in node ? node.visible : undefined) !== false &&
    ("enabled" in node ? node.enabled : undefined) !== false
  );
}

// ---------------------------------------------------------------------------
// Root fill-width fallback
// ---------------------------------------------------------------------------

const DEFAULT_FRAME_ID = "root-frame";

/** Resolve root fill-width fallback. Pass root children to avoid store coupling. */
let _rootChildrenProvider: (() => PenNode[]) | null = null;

/** Set a provider function for root children (called once from app initialization). */
export function setRootChildrenProvider(provider: () => PenNode[]): void {
  _rootChildrenProvider = provider;
}

export function getRootFillWidthFallback(): number {
  const roots = _rootChildrenProvider?.() ?? [];
  const rootFrame = roots.find(
    (n) =>
      n.type === "frame" &&
      n.id === DEFAULT_FRAME_ID &&
      "width" in n &&
      typeof n.width === "number" &&
      n.width > 0,
  );
  if (
    rootFrame &&
    "width" in rootFrame &&
    typeof rootFrame.width === "number" &&
    rootFrame.width > 0
  ) {
    return rootFrame.width;
  }
  const anyTopFrame = roots.find(
    (n) =>
      n.type === "frame" &&
      "width" in n &&
      typeof n.width === "number" &&
      n.width > 0,
  );
  if (
    anyTopFrame &&
    "width" in anyTopFrame &&
    typeof anyTopFrame.width === "number" &&
    anyTopFrame.width > 0
  ) {
    return anyTopFrame.width;
  }
  return 1200;
}

// ---------------------------------------------------------------------------
// Layout inference — shared logic for detecting implicit layout
// ---------------------------------------------------------------------------

export function inferLayout(node: PenNode): "horizontal" | undefined {
  if (node.type !== "frame") return undefined;
  const c = node as PenNode & ContainerProps;
  if (c.gap != null || c.justifyContent || c.alignItems) return "horizontal";
  if (c.padding != null) return "horizontal";
  return undefined;
}

// ---------------------------------------------------------------------------
// Fit-content size computation
// ---------------------------------------------------------------------------

export function fitContentWidth(node: PenNode, parentAvail?: number): number {
  if (!("children" in node) || !node.children?.length) return 0;
  const visibleChildren = node.children.filter(
    (child) => isNodeVisible(child) && !isFlowDetached(child),
  );
  if (visibleChildren.length === 0) return 0;
  const c = node as PenNode & ContainerProps;
  const layout = c.layout || inferLayout(node);
  const pad = resolvePadding(c.padding);
  const nodeGap = typeof c.gap === "number" ? c.gap : 0;
  if (layout === "horizontal") {
    const gapTotal = nodeGap * Math.max(0, visibleChildren.length - 1);
    const childAvail =
      parentAvail !== undefined
        ? Math.max(0, parentAvail - pad.left - pad.right - gapTotal)
        : undefined;
    const childTotal = visibleChildren.reduce(
      (sum, ch) => sum + getNodeWidth(ch, childAvail),
      0,
    );
    return childTotal + gapTotal + pad.left + pad.right;
  }
  const childAvail =
    parentAvail !== undefined
      ? Math.max(0, parentAvail - pad.left - pad.right)
      : undefined;
  const maxChildW = visibleChildren.reduce(
    (max, ch) => Math.max(max, getNodeWidth(ch, childAvail)),
    0,
  );
  return maxChildW + pad.left + pad.right;
}

export function fitContentHeight(node: PenNode, parentAvailW?: number): number {
  if (!("children" in node) || !node.children?.length) return 0;
  const visibleChildren = node.children.filter(
    (child) => isNodeVisible(child) && !isFlowDetached(child),
  );
  if (visibleChildren.length === 0) return 0;
  const c = node as PenNode & ContainerProps;
  const layout = c.layout || inferLayout(node);
  const pad = resolvePadding(c.padding);
  const nodeGap = typeof c.gap === "number" ? c.gap : 0;
  const nodeW = getNodeWidth(node, parentAvailW);
  const childAvailW =
    nodeW > 0 ? Math.max(0, nodeW - pad.left - pad.right) : parentAvailW;
  if (layout === "vertical") {
    const childTotal = visibleChildren.reduce(
      (sum, ch) => sum + getNodeHeight(ch, undefined, childAvailW),
      0,
    );
    const gapTotal = nodeGap * Math.max(0, visibleChildren.length - 1);
    return childTotal + gapTotal + pad.top + pad.bottom;
  }
  const maxChildH = visibleChildren.reduce(
    (max, ch) => Math.max(max, getNodeHeight(ch, undefined, childAvailW)),
    0,
  );
  return maxChildH + pad.top + pad.bottom;
}

// ---------------------------------------------------------------------------
// Node dimension resolution
// ---------------------------------------------------------------------------

export function getNodeWidth(node: PenNode, parentAvail?: number): number {
  if ("width" in node) {
    const s = parseSizing(node.width);
    if (typeof s === "number" && s > 0) return s;
    if (s === "fill") {
      if (parentAvail && parentAvail > 0) return parentAvail;
      if (node.type !== "text") {
        const fallbackFillW = getRootFillWidthFallback();
        if (fallbackFillW > 0) return fallbackFillW;
      }
      if ("children" in node && node.children?.length) {
        const intrinsic = fitContentWidth(node);
        if (intrinsic > 0) return intrinsic;
      }
      if (node.type === "text") {
        const fontSize = node.fontSize ?? 16;
        const letterSpacing = node.letterSpacing ?? 0;
        const fontWeight = node.fontWeight;
        const content = resolveTextContent(node);
        return Math.max(
          Math.ceil(
            estimateTextWidth(content, fontSize, letterSpacing, fontWeight),
          ),
          1,
        );
      }
    }
    if (s === "fit") {
      const fit = fitContentWidth(node, parentAvail);
      if (fit > 0) return fit;
    }
  }
  if ("children" in node && node.children?.length) {
    const fit = fitContentWidth(node, parentAvail);
    if (fit > 0) return fit;
  }
  if (node.type === "text") {
    const fontSize = node.fontSize ?? 16;
    const letterSpacing = node.letterSpacing ?? 0;
    const fontWeight = node.fontWeight;
    const content = resolveTextContent(node);
    return Math.max(
      Math.ceil(
        estimateTextWidthPrecise(content, fontSize, letterSpacing, fontWeight),
      ),
      1,
    );
  }
  return 0;
}

export function getNodeHeight(
  node: PenNode,
  parentAvail?: number,
  parentAvailW?: number,
): number {
  if ("height" in node) {
    const s = parseSizing(node.height);
    if (typeof s === "number" && s > 0) return s;
    if (s === "fill" && parentAvail) return parentAvail;
    if (s === "fit") {
      const fit = fitContentHeight(node, parentAvailW);
      if (fit > 0) return fit;
    }
  }
  if ("children" in node && node.children?.length) {
    const fit = fitContentHeight(node, parentAvailW);
    if (fit > 0) return fit;
  }
  if (node.type === "text") {
    return estimateTextHeight(node, parentAvailW);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Auto-layout position computation
// ---------------------------------------------------------------------------

export function computeLayoutPositions(
  parent: PenNode,
  children: PenNode[],
): PenNode[] {
  if (children.length === 0) return children;
  const visibleChildren = children.filter((child) => isNodeVisible(child));
  if (visibleChildren.length === 0) return [];
  const c = parent as PenNode & ContainerProps;
  const layout = c.layout || inferLayout(parent);
  if (!layout || layout === "none") return visibleChildren;

  const layoutChildren = visibleChildren.filter((ch) => !isFlowDetached(ch));
  if (layoutChildren.length === 0) return visibleChildren;

  const pW = parseSizing(c.width);
  const pH = parseSizing(c.height);
  const parentW =
    typeof pW === "number" && pW > 0 ? pW : getNodeWidth(parent) || 100;
  const parentH =
    typeof pH === "number" && pH > 0 ? pH : getNodeHeight(parent) || 100;
  const pad = resolvePadding(c.padding);
  const gap = typeof c.gap === "number" ? c.gap : 0;
  const justify = normalizeJustifyContent(c.justifyContent);
  const align = normalizeAlignItems(c.alignItems);

  const isVertical = layout === "vertical";
  const availW = parentW - pad.left - pad.right;
  const availH = parentH - pad.top - pad.bottom;
  const availMain = isVertical ? availH : availW;
  const totalGapSpace = gap * Math.max(0, layoutChildren.length - 1);

  const mainSizing = layoutChildren.map((ch) =>
    getMainAxisPlan(ch, isVertical, availW, availH),
  );
  const fixedTotal = mainSizing.reduce((sum, plan) => sum + plan.base, 0);
  const totalGrow = mainSizing.reduce((sum, plan) => sum + plan.grow, 0);
  const remainingMain = Math.max(0, availMain - fixedTotal - totalGapSpace);

  const sizes = layoutChildren.map((ch, i) => {
    const mainPlan = mainSizing[i];
    if (!mainPlan) {
      throw new Error(
        `Missing computed layout main-axis plan for child ${ch.id}`,
      );
    }
    let mainSize =
      mainPlan.base +
      (mainPlan.grow > 0 && totalGrow > 0
        ? (remainingMain * mainPlan.grow) / totalGrow
        : 0);
    if (isVertical && ch.type === "text" && mainPlan.grow <= 0) {
      const content = resolveTextContent(ch);
      if (countExplicitTextLines(content) <= 1) {
        const fontSize = ch.fontSize ?? 16;
        const lineHeight = ch.lineHeight ?? defaultLineHeight(fontSize);
        const singleLineH = fontSize * lineHeight;
        const estH = estimateTextHeight(ch, availW);
        if (estH <= singleLineH + 1) {
          mainSize = singleLineH;
        }
      }
    }
    const constraints = getLayoutConstraints(ch);
    const crossAlign = normalizeChildAlignSelf(constraints?.alignSelf) ?? align;
    return {
      w: isVertical
        ? getCrossAxisSizeForChild(
            ch,
            "width",
            constraints?.widthMode,
            crossAlign,
            availW,
          )
        : mainSize,
      h: isVertical
        ? mainSize
        : getCrossAxisSizeForChild(
            ch,
            "height",
            constraints?.heightMode,
            crossAlign,
            availH,
            mainSize,
          ),
    };
  });

  const totalMain = sizes.reduce((sum, s) => sum + (isVertical ? s.h : s.w), 0);
  const freeSpace = Math.max(0, availMain - totalMain - totalGapSpace);

  let mainPos = 0;
  let effectiveGap = gap;

  switch (justify) {
    case "center":
      mainPos = freeSpace / 2;
      break;
    case "end":
      mainPos = freeSpace;
      break;
    case "space_between":
      effectiveGap =
        layoutChildren.length > 1
          ? (availMain - totalMain) / (layoutChildren.length - 1)
          : 0;
      break;
    case "space_around": {
      const spacing =
        layoutChildren.length > 0
          ? (availMain - totalMain) / layoutChildren.length
          : 0;
      mainPos = spacing / 2;
      effectiveGap = spacing;
      break;
    }
    default:
      break;
  }

  const positioned = layoutChildren.map((child, i) => {
    const size = sizes[i];
    if (!size) {
      throw new Error(`Missing computed layout size for child ${child.id}`);
    }
    const crossAvail = isVertical ? availW : availH;
    const childCross = isVertical ? size.w : size.h;
    let crossPos = 0;
    const childAlign =
      normalizeChildAlignSelf(getLayoutConstraints(child)?.alignSelf) ?? align;

    let effectiveChildCross = childCross;
    if (childAlign === "center" && !isVertical && child.type === "text") {
      const fontSize = child.fontSize ?? 16;
      const lineHeight = child.lineHeight ?? defaultLineHeight(fontSize);
      const content = resolveTextContent(child);
      const isSingleLine = countExplicitTextLines(content) <= 1;
      if (isSingleLine) {
        effectiveChildCross = fontSize * lineHeight;
      }
    }

    switch (childAlign) {
      case "center":
        crossPos = (crossAvail - effectiveChildCross) / 2;
        break;
      case "end":
        crossPos = crossAvail - childCross;
        break;
      default:
        break;
    }

    const clampCrossSize =
      !isVertical && childAlign === "center" && child.type === "text"
        ? effectiveChildCross
        : childCross;
    if (crossAvail >= clampCrossSize) {
      crossPos = Math.max(0, Math.min(crossPos, crossAvail - clampCrossSize));
    }

    const computedX = Math.round(
      isVertical ? pad.left + crossPos : pad.left + mainPos,
    );
    const computedY = Math.round(
      isVertical ? pad.top + mainPos : pad.top + crossPos,
    );

    mainPos += (isVertical ? size.h : size.w) + effectiveGap;

    const out: Record<string, unknown> = {
      ...child,
      x: computedX,
      y: computedY,
      width: size.w,
      height: size.h,
    };

    if (isVertical && align === "center" && child.type === "text") {
      const hasExplicitAlign =
        "textAlign" in child && child.textAlign && child.textAlign !== "left";
      if (!hasExplicitAlign) {
        out.width = availW;
        out.x = Math.round(pad.left);
        out.textAlign = "center";
      }
    }

    return out as unknown as PenNode;
  });

  const positionedById = new Map(positioned.map((child) => [child.id, child]));
  return visibleChildren.map((child) => positionedById.get(child.id) ?? child);
}

function isFlowDetached(node: PenNode): boolean {
  return (
    isOverlayNode(node) ||
    getLayoutConstraints(node)?.positioning === "absolute"
  );
}

function getLayoutConstraints(node: PenNode): PenLayoutConstraints | undefined {
  return node.layoutConstraints;
}

function getMainAxisPlan(
  node: PenNode,
  isVertical: boolean,
  availW: number,
  availH: number,
): { base: number; grow: number } {
  const constraints = getLayoutConstraints(node);
  const mode = isVertical ? constraints?.heightMode : constraints?.widthMode;
  const explicitGrow = Math.max(constraints?.grow ?? 0, 0);
  if (mode === "fill_container") {
    return { base: 0, grow: explicitGrow > 0 ? explicitGrow : 1 };
  }
  const base =
    mode === "fit_content"
      ? getFitContentMainAxisSize(node, isVertical, availW, availH)
      : getFixedMainAxisSize(node, isVertical, availW, availH);
  return { base, grow: explicitGrow };
}

function getFixedMainAxisSize(
  node: PenNode,
  isVertical: boolean,
  availW: number,
  availH: number,
): number {
  if (!isVertical) {
    return getNodeWidth(node, availW);
  }
  return getNodeHeight(node, availH, availW);
}

function getFitContentMainAxisSize(
  node: PenNode,
  isVertical: boolean,
  availW: number,
  availH: number,
): number {
  const sizingKey = isVertical ? "height" : "width";
  const fitNode = { ...node, [sizingKey]: "fit_content" } as PenNode;
  const fitSize = isVertical
    ? getNodeHeight(fitNode, undefined, availW)
    : getNodeWidth(fitNode, availW);
  return fitSize > 0
    ? fitSize
    : getFixedMainAxisSize(node, isVertical, availW, availH);
}

function getCrossAxisSizeForChild(
  node: PenNode,
  axis: "width" | "height",
  mode: PenLayoutConstraints["widthMode"] | PenLayoutConstraints["heightMode"],
  align: "start" | "center" | "end" | "stretch",
  available: number,
  parentAvailW?: number,
): number {
  if (mode === "fill_container" || align === "stretch") return available;
  if (mode === "fit_content") {
    const fitNode = { ...node, [axis]: "fit_content" } as PenNode;
    const fitSize =
      axis === "width"
        ? getNodeWidth(fitNode, available)
        : getNodeHeight(fitNode, available, parentAvailW);
    return fitSize > 0
      ? fitSize
      : axis === "width"
        ? getNodeWidth(node, available)
        : getNodeHeight(node, available, parentAvailW);
  }
  return axis === "width"
    ? getNodeWidth(node, available)
    : getNodeHeight(node, available, parentAvailW);
}

function normalizeChildAlignSelf(
  value: PenLayoutConstraints["alignSelf"] | undefined,
): "start" | "center" | "end" | "stretch" | undefined {
  if (!value || value === "auto") return undefined;
  if (value === "baseline") return "end";
  return value;
}

function normalizeJustifyContent(
  value: unknown,
): "start" | "center" | "end" | "space_between" | "space_around" {
  if (typeof value !== "string") return "start";
  const v = value.trim().toLowerCase();
  switch (v) {
    case "start":
    case "flex-start":
    case "left":
    case "top":
      return "start";
    case "center":
    case "middle":
      return "center";
    case "end":
    case "flex-end":
    case "right":
    case "bottom":
      return "end";
    case "space_between":
    case "space-between":
      return "space_between";
    case "space_around":
    case "space-around":
      return "space_around";
    default:
      return "start";
  }
}

/**
 * Normalize a raw `alignItems` string into the three values the layout
 * engine actually implements: `start`, `center`, `end`.
 *
 * Accepts a generous set of aliases from CSS/flexbox terminology so
 * AI-generated designs (and copy-pasted web snippets) don't silently
 * fall through to the `start` default when they meant something else.
 *
 * `baseline` specifically is treated as `end`:
 *   Cucumber's layout engine doesn't implement text-baseline
 *   alignment (there's no font-metrics pipeline in the position step).
 *   LLMs routinely emit `alignItems: 'baseline'` from web CSS reflex
 *   for patterns like "big number + small unit" (e.g. "72 BPM"), where
 *   the intent is that the small text bottom-aligns with the big
 *   text's visual baseline. The best approximation we can render is
 *   `end` — it bottom-aligns both children to the cross-axis end,
 *   which for a horizontal row of a large heading and a small unit
 *   looks essentially identical to true baseline alignment. Falling
 *   through to `start` (the old behavior) would top-align the unit,
 *   which is visually wrong.
 */
function normalizeAlignItems(
  value: unknown,
): "start" | "center" | "end" | "stretch" {
  if (typeof value !== "string") return "start";
  const v = value.trim().toLowerCase();
  switch (v) {
    case "start":
    case "flex-start":
    case "left":
    case "top":
      return "start";
    case "center":
    case "middle":
      return "center";
    case "end":
    case "flex-end":
    case "right":
    case "bottom":
    case "baseline":
    case "last baseline":
    case "first baseline":
      return "end";
    case "stretch":
      return "stretch";
    default:
      return "start";
  }
}

// Re-export estimateLineWidth for convenience
export { estimateLineWidth };
