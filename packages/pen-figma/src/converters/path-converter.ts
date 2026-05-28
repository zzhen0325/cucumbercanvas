// @ts-nocheck
import type { PenNode, SizingBehavior } from "@cucumber/pen-types";
import { mapFigmaEffects } from "../figma-effect-mapper.js";
import { mapFigmaFills } from "../figma-fill-mapper.js";
import { mapFigmaStroke } from "../figma-stroke-mapper.js";
import type { TreeNode } from "../figma-tree-builder.js";
import {
  computeSvgPathBounds,
  decodeFigmaVectorPath,
} from "../figma-vector-decoder.js";
import {
  type ConversionContext,
  commonProps,
  figmaFillColor,
  lookupIconByName,
  resolveHeight,
  resolveWidth,
} from "./common.js";

export function convertVector(
  treeNode: TreeNode,
  parentStackMode: string | undefined,
  ctx: ConversionContext,
): PenNode {
  const figma = treeNode.figma;
  const id = ctx.generateId();
  const name = figma.name ?? "";

  const iconMatch = lookupIconByName(name);
  if (iconMatch) {
    const iconW = resolveWidth(figma, parentStackMode, ctx);
    const iconH = resolveHeight(figma, parentStackMode, ctx);

    // Lucide/Feather icon paths use a 24×24 viewbox.  When the icon is
    // rendered smaller, scale strokeWeight proportionally so lines don't
    // appear disproportionately thick.
    const iconSize = Math.min(
      typeof iconW === "number" ? iconW : 24,
      typeof iconH === "number" ? iconH : 24,
    );
    const iconScale = iconSize / 24;

    let stroke =
      iconMatch.style === "stroke"
        ? (mapFigmaStroke(figma) ?? {
            thickness: 1.5,
            fill: [
              { type: "solid", color: figmaFillColor(figma) ?? "#000000" },
            ],
            cap: "round" as const,
            join: "round" as const,
          })
        : mapFigmaStroke(figma);

    if (stroke && iconScale < 0.99) {
      const rawThickness =
        typeof stroke.thickness === "number" ? stroke.thickness : 1.5;
      stroke = {
        ...stroke,
        thickness: Math.round(rawThickness * iconScale * 100) / 100,
      };
    }

    return {
      type: "path",
      ...commonProps(figma, id, parentStackMode),
      d: iconMatch.d,
      iconId: iconMatch.iconId,
      width: iconW,
      height: iconH,
      fill:
        iconMatch.style === "fill"
          ? mapFigmaFills(figma.fillPaints)
          : undefined,
      stroke,
      effects: mapFigmaEffects(figma.effects),
    };
  }

  const pathD = decodeFigmaVectorPath(figma, ctx.blobs);
  if (pathD) {
    const props = commonProps(figma, id, parentStackMode);
    let width: SizingBehavior = resolveWidth(figma, parentStackMode, ctx);
    let height: SizingBehavior = resolveHeight(figma, parentStackMode, ctx);

    // When Figma reports zero width or height for a vector node (common for
    // chevron/arrow icons centered around the origin), derive the actual
    // visual extent from the decoded path bounds and adjust position.
    const sizeX = figma.size?.x ?? 0;
    const sizeY = figma.size?.y ?? 0;
    if (
      (sizeX < 0.01 || sizeY < 0.01) &&
      typeof width === "number" &&
      typeof height === "number"
    ) {
      const bounds = computeSvgPathBounds(pathD);
      if (bounds) {
        const pathW = bounds.maxX - bounds.minX;
        const pathH = bounds.maxY - bounds.minY;
        if (sizeX < 0.01 && pathW > 0.01) {
          width = Math.round(pathW * 100) / 100;
          props.x = Math.round((props.x + bounds.minX) * 100) / 100;
        }
        if (sizeY < 0.01 && pathH > 0.01) {
          height = Math.round(pathH * 100) / 100;
          props.y = Math.round((props.y + bounds.minY) * 100) / 100;
        }
      }
    }

    // Figma's strokeGeometry is the EXPANDED stroke outline (not a centerline).
    const hasVisibleFills = figma.fillPaints?.some(
      (p: any) => p.visible !== false,
    );
    const hasVisibleStrokes = figma.strokePaints?.some(
      (p: any) => p.visible !== false,
    );
    const isStrokeOnlyOutline =
      !hasVisibleFills &&
      hasVisibleStrokes &&
      !figma.fillGeometry?.length &&
      figma.strokeGeometry?.length;

    if (isStrokeOnlyOutline) {
      const strokeAsFill = mapFigmaFills(figma.strokePaints!);
      return {
        type: "path",
        ...props,
        d: pathD,
        fillRule: mapPathFillRule(figma),
        width,
        height,
        fill: strokeAsFill,
        effects: mapFigmaEffects(figma.effects),
      };
    }

    return {
      type: "path",
      ...props,
      d: pathD,
      fillRule: mapPathFillRule(figma),
      width,
      height,
      fill: mapFigmaFills(figma.fillPaints),
      stroke: mapFigmaStroke(figma),
      effects: mapFigmaEffects(figma.effects),
    };
  }

  ctx.warnings.push(
    `Vector node "${figma.name}" converted as rectangle (path data not decodable)`,
  );
  const props = commonProps(figma, id, parentStackMode);
  return {
    type: "rectangle",
    ...props,
    width: resolveWidth(figma, parentStackMode, ctx),
    height: resolveHeight(figma, parentStackMode, ctx),
    fill: mapFigmaFills(figma.fillPaints),
    stroke: mapFigmaStroke(figma),
    effects: mapFigmaEffects(figma.effects),
    meta: {
      ...(props.meta ?? {}),
      vectorFallback: getFigmaVectorFallbackMeta(figma),
    },
  };
}

function mapPathFillRule(figma: TreeNode["figma"]): "nonzero" | "evenodd" | undefined {
  const geometries =
    figma.fillGeometry?.length ? figma.fillGeometry : figma.strokeGeometry;
  const windingRules = geometries
    ?.map((path: any) => path.windingRule)
    .filter(Boolean);
  if (windingRules?.includes("ODD")) return "evenodd";
  if (windingRules?.includes("NONZERO")) return "nonzero";
  return undefined;
}

function getFigmaVectorFallbackMeta(figma: TreeNode["figma"]): Record<string, unknown> {
  const booleanOperation =
    (figma as Record<string, unknown>).booleanOperation ??
    (figma as Record<string, unknown>).booleanOperationType ??
    (figma as Record<string, unknown>).operation;
  const fillWindingRules = figma.fillGeometry
    ?.map((path: any) => path.windingRule)
    .filter(Boolean);
  const strokeWindingRules = figma.strokeGeometry
    ?.map((path: any) => path.windingRule)
    .filter(Boolean);

  return {
    source: "figma",
    nodeType: figma.type,
    fallbackReason: "path_not_decodable",
    ...(booleanOperation ? { booleanOperation } : {}),
    ...(figma.vectorData?.normalizedSize
      ? { normalizedSize: figma.vectorData.normalizedSize }
      : {}),
    ...(figma.vectorData?.vectorNetworkBlob !== undefined
      ? { vectorNetworkBlob: figma.vectorData.vectorNetworkBlob }
      : {}),
    fillGeometryCount: figma.fillGeometry?.length ?? 0,
    strokeGeometryCount: figma.strokeGeometry?.length ?? 0,
    ...(fillWindingRules?.length ? { fillWindingRules } : {}),
    ...(strokeWindingRules?.length ? { strokeWindingRules } : {}),
  };
}
