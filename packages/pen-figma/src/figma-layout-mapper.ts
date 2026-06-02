// @ts-nocheck
import type {
  ContainerProps,
  PenAutoLayoutRef,
  PenLayoutConstraints,
  SizingBehavior,
} from "@cucumber/pen-types";
import type { FigmaNodeChange } from "./figma-types.js";

/**
 * Map Figma stack (auto-layout) properties to PenNode ContainerProps.
 */
export function mapFigmaLayout(
  node: FigmaNodeChange,
): Pick<
  ContainerProps,
  "layout" | "gap" | "padding" | "justifyContent" | "alignItems" | "clipContent"
> {
  const result: Pick<
    ContainerProps,
    | "layout"
    | "gap"
    | "padding"
    | "justifyContent"
    | "alignItems"
    | "clipContent"
  > = {};

  if (node.stackMode && node.stackMode !== "NONE") {
    result.layout = node.stackMode === "HORIZONTAL" ? "horizontal" : "vertical";
  }

  if (node.stackPrimaryAlignItems) {
    result.justifyContent = mapJustifyContent(node.stackPrimaryAlignItems);
  }

  // Set gap from stackSpacing, but skip when justifyContent is space_between.
  // Figma stores the COMPUTED inter-item spacing in stackSpacing for
  // SPACE_EVENLY mode — using it as an explicit gap would conflict with
  // the dynamic spacing that space_between already provides.
  if (
    node.stackSpacing !== undefined &&
    node.stackSpacing !== 0 &&
    result.justifyContent !== "space_between"
  ) {
    result.gap = node.stackSpacing;
  }

  const padding = mapPadding(node);
  if (padding !== undefined) {
    result.padding = padding;
  }

  if (node.stackCounterAlignItems) {
    result.alignItems = mapAlignItems(node.stackCounterAlignItems);
  }

  // Frames clip by default in Figma (frameMaskDisabled defaults to false).
  // Only skip clipContent when explicitly disabled.
  if (node.frameMaskDisabled !== true) {
    result.clipContent = true;
  }

  return result;
}

export function mapFigmaAutoLayoutRef(
  node: FigmaNodeChange,
  parentStackMode?: string,
): PenAutoLayoutRef | undefined {
  const layout = mapFigmaLayout(node);
  const ref: PenAutoLayoutRef = {
    source: "figma",
    ...layout,
    alignItems: mapAutoLayoutAlignItems(node.stackCounterAlignItems),
    widthMode: mapWidthSizingMode(node, parentStackMode),
    heightMode: mapHeightSizingMode(node, parentStackMode),
    alignSelf: mapAlignSelf(node.stackChildAlignSelf),
    positioning: node.stackPositioning
      ? node.stackPositioning === "ABSOLUTE"
        ? "absolute"
        : "auto"
      : undefined,
    grow:
      node.stackChildPrimaryGrow !== undefined && node.stackChildPrimaryGrow > 0
        ? node.stackChildPrimaryGrow
        : undefined,
  };

  return hasAutoLayoutRefValue(ref) ? ref : undefined;
}

export function mapFigmaLayoutConstraints(
  node: FigmaNodeChange,
  parentStackMode?: string,
): PenLayoutConstraints | undefined {
  const constraints: PenLayoutConstraints = {
    widthMode: mapWidthSizingMode(node, parentStackMode),
    heightMode: mapHeightSizingMode(node, parentStackMode),
    alignSelf: mapAlignSelf(node.stackChildAlignSelf),
    positioning: node.stackPositioning
      ? node.stackPositioning === "ABSOLUTE"
        ? "absolute"
        : "auto"
      : undefined,
    grow:
      node.stackChildPrimaryGrow !== undefined && node.stackChildPrimaryGrow > 0
        ? node.stackChildPrimaryGrow
        : undefined,
  };

  return Object.values(constraints).some((value) => value !== undefined)
    ? constraints
    : undefined;
}

function mapAutoLayoutAlignItems(
  align?: string,
): PenAutoLayoutRef["alignItems"] {
  if (align === "BASELINE") return "baseline";
  return align ? (mapAlignItems(align) as PenAutoLayoutRef["alignItems"]) : undefined;
}

function hasAutoLayoutRefValue(ref: PenAutoLayoutRef): boolean {
  return Object.entries(ref).some(
    ([key, value]) => key !== "source" && value !== undefined,
  );
}

function mapPadding(
  node: FigmaNodeChange,
): number | [number, number] | [number, number, number, number] | undefined {
  // Check individual padding values first
  const hasHorizontal = node.stackHorizontalPadding !== undefined;
  const hasVertical = node.stackVerticalPadding !== undefined;
  const hasRight = node.stackPaddingRight !== undefined;
  const hasBottom = node.stackPaddingBottom !== undefined;

  if (!hasHorizontal && !hasVertical && !hasRight && !hasBottom) {
    // Uniform padding
    if (node.stackPadding && node.stackPadding > 0) return node.stackPadding;
    return undefined;
  }

  const vPad = node.stackVerticalPadding ?? node.stackPadding ?? 0;
  const hPad = node.stackHorizontalPadding ?? node.stackPadding ?? 0;
  const top = vPad;
  const bottom = node.stackPaddingBottom ?? vPad;
  const left = hPad;
  const right = node.stackPaddingRight ?? hPad;

  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && left === right) return [top, right];
  return [top, right, bottom, left];
}

function mapJustifyContent(align: string): ContainerProps["justifyContent"] {
  switch (align) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_EVENLY":
      return "space_between";
    default:
      return undefined;
  }
}

function mapAlignItems(align: string): ContainerProps["alignItems"] {
  switch (align) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "BASELINE":
      return "baseline";
    default:
      return undefined;
  }
}

function mapAlignSelf(align?: string): PenAutoLayoutRef["alignSelf"] {
  switch (align) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "STRETCH":
      return "stretch";
    case "BASELINE":
      return "baseline";
    default:
      return undefined;
  }
}

function mapWidthSizingMode(
  node: FigmaNodeChange,
  parentStackMode?: string,
): PenAutoLayoutRef["widthMode"] {
  const width = mapWidthSizing(node, parentStackMode);
  return width === "fit_content" || width === "fill_container"
    ? width
    : "fixed";
}

function mapHeightSizingMode(
  node: FigmaNodeChange,
  parentStackMode?: string,
): PenAutoLayoutRef["heightMode"] {
  const height = mapHeightSizing(node, parentStackMode);
  return height === "fit_content" || height === "fill_container"
    ? height
    : "fixed";
}

/**
 * Determine width sizing behavior from Figma internal format.
 */
export function mapWidthSizing(
  node: FigmaNodeChange,
  parentStackMode?: string,
): SizingBehavior {
  // Check stack sizing for containers
  if (
    node.stackPrimarySizing === "RESIZE_TO_FIT" &&
    node.stackMode === "HORIZONTAL"
  ) {
    return "fit_content";
  }
  if (
    node.stackCounterSizing === "RESIZE_TO_FIT" &&
    node.stackMode === "VERTICAL"
  ) {
    return "fit_content";
  }

  // Check child sizing within parent
  if (node.stackChildPrimaryGrow === 1 && parentStackMode === "HORIZONTAL") {
    return "fill_container";
  }
  if (
    node.stackChildAlignSelf === "STRETCH" &&
    parentStackMode === "VERTICAL"
  ) {
    return "fill_container";
  }

  return node.size?.x ?? 100;
}

/**
 * Determine height sizing behavior from Figma internal format.
 */
export function mapHeightSizing(
  node: FigmaNodeChange,
  parentStackMode?: string,
): SizingBehavior {
  if (
    node.stackPrimarySizing === "RESIZE_TO_FIT" &&
    node.stackMode === "VERTICAL"
  ) {
    return "fit_content";
  }
  if (
    node.stackCounterSizing === "RESIZE_TO_FIT" &&
    node.stackMode === "HORIZONTAL"
  ) {
    return "fit_content";
  }

  if (node.stackChildPrimaryGrow === 1 && parentStackMode === "VERTICAL") {
    return "fill_container";
  }
  if (
    node.stackChildAlignSelf === "STRETCH" &&
    parentStackMode === "HORIZONTAL"
  ) {
    return "fill_container";
  }

  return node.size?.y ?? 100;
}
