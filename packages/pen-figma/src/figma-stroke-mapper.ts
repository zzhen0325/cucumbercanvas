// @ts-nocheck
import type { PenStroke } from "@cucumber/pen-types";
import { mapFigmaFills } from "./figma-fill-mapper.js";
import type { FigmaNodeChange } from "./figma-types.js";

/**
 * Convert Figma strokePaints + strokeWeight to PenStroke.
 */
export function mapFigmaStroke(node: FigmaNodeChange): PenStroke | undefined {
  if (!node.strokePaints || node.strokePaints.length === 0) return undefined;
  const fill = mapFigmaFills(node.strokePaints);
  if (fill.length === 0) return undefined;

  const thickness = node.borderStrokeWeightsIndependent
    ? ([
        node.borderTopWeight ?? 0,
        node.borderRightWeight ?? 0,
        node.borderBottomWeight ?? 0,
        node.borderLeftWeight ?? 0,
      ] as [number, number, number, number])
    : (node.strokeWeight ?? 1);

  return {
    thickness,
    align: mapStrokeAlign(node.strokeAlign),
    join: mapStrokeJoin(node.strokeJoin),
    cap: mapStrokeCap(node.strokeCap),
    dashPattern: node.dashPattern?.length ? node.dashPattern : undefined,
    dashOffset: node.dashOffset,
    miterLimit: node.strokeMiterLimit,
    fill,
  };
}

function mapStrokeAlign(
  align?: string,
): "inside" | "center" | "outside" | undefined {
  switch (align) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    case "CENTER":
      return "center";
    default:
      return undefined;
  }
}

function mapStrokeJoin(join?: string): "miter" | "bevel" | "round" | undefined {
  switch (join) {
    case "MITER":
      return "miter";
    case "BEVEL":
      return "bevel";
    case "ROUND":
      return "round";
    default:
      return undefined;
  }
}

function mapStrokeCap(cap?: string): "none" | "round" | "square" | undefined {
  switch (cap) {
    case "NONE":
      return "none";
    case "ROUND":
      return "round";
    case "SQUARE":
      return "square";
    default:
      return undefined;
  }
}
