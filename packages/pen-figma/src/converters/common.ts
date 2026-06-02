// @ts-nocheck
import type {
  PenComponentRef,
  PenComponentOverrideRef,
  PenLayoutConstraints,
  PenNode,
  PenNodeStyleRefs,
  SizingBehavior,
} from "@cucumber/pen-types";
import {
  mapFigmaLayout,
  mapFigmaLayoutConstraints,
  mapHeightSizing,
  mapWidthSizing,
} from "../figma-layout-mapper.js";
import { mapFigmaBlendMode } from "../figma-blend-mode.js";
import type { TreeNode } from "../figma-tree-builder.js";
import type {
  FigmaDerivedSymbolDataEntry,
  FigmaGUID,
  FigmaImportLayoutMode,
  FigmaMatrix,
  FigmaNodeChange,
  FigmaSymbolOverride,
} from "../figma-types.js";

export type {
  FigmaNodeChange,
  FigmaMatrix,
  FigmaImportLayoutMode,
  FigmaSymbolOverride,
  FigmaDerivedSymbolDataEntry,
  FigmaGUID,
};
export type { PenNode, SizingBehavior };
export type { TreeNode };

// Icon lookup is injectable — set via setIconLookup() from the host app
export interface IconLookupResult {
  d: string;
  iconId?: string;
  style?: "fill" | "stroke";
}

let _lookupIconByName: ((name: string) => IconLookupResult | null) | null =
  null;

/** Set the icon lookup function (provided by host app's icon-resolver). */
export function setIconLookup(
  fn: (name: string) => IconLookupResult | null,
): void {
  _lookupIconByName = fn;
}

export function lookupIconByName(name: string): IconLookupResult | null {
  return _lookupIconByName?.(name) ?? null;
}

export interface ConversionContext {
  componentMap: Map<string, string>;
  /** SYMBOL TreeNodes keyed by figma GUID — includes internal canvases for instance inlining */
  symbolTree: Map<string, TreeNode>;
  warnings: string[];
  generateId: () => string;
  blobs: (Uint8Array | string)[];
  layoutMode: FigmaImportLayoutMode;
}

// --- Size resolution ---

export function resolveWidth(
  figma: FigmaNodeChange,
  parentStackMode: string | undefined,
  ctx: ConversionContext,
): SizingBehavior {
  if (ctx.layoutMode === "preserve") return figma.size?.x ?? 100;
  return mapWidthSizing(figma, parentStackMode);
}

export function resolveHeight(
  figma: FigmaNodeChange,
  parentStackMode: string | undefined,
  ctx: ConversionContext,
): SizingBehavior {
  if (ctx.layoutMode === "preserve") return figma.size?.y ?? 100;
  return mapHeightSizing(figma, parentStackMode);
}

// --- Common property extraction ---

export function extractPosition(figma: FigmaNodeChange): {
  x: number;
  y: number;
} {
  if (!figma.transform) return { x: 0, y: 0 };

  const m = figma.transform;

  // Detect rotation or flip: any non-identity 2×2 sub-matrix means
  // m02/m12 is NOT the top-left corner of the bounding box.
  const hasRotation = Math.abs(m.m01) > 0.001 || Math.abs(m.m10) > 0.001;
  const hasFlip = m.m00 < -0.001 || m.m11 < -0.001;

  if ((hasRotation || hasFlip) && figma.size) {
    // Figma's m02/m12 gives where local origin (0,0) maps in parent space.
    // For rotated/flipped nodes this differs from the pre-transform top-left
    // that Cucumber needs.  Compute the object center (invariant under
    // rotation/flip) and derive the pre-transform top-left from it.
    const w = figma.size.x;
    const h = figma.size.y;
    const cx = (m.m00 * w) / 2 + (m.m01 * h) / 2 + m.m02;
    const cy = (m.m10 * w) / 2 + (m.m11 * h) / 2 + m.m12;
    return {
      x: Math.round((cx - w / 2) * 100) / 100,
      y: Math.round((cy - h / 2) * 100) / 100,
    };
  }

  return {
    x: Math.round(m.m02 * 100) / 100,
    y: Math.round(m.m12 * 100) / 100,
  };
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return Math.round(a * 100) / 100;
}

export function extractRotation(transform?: FigmaMatrix): number | undefined {
  if (!transform) return undefined;
  // Use abs(m00) to ignore horizontal flip (which is handled separately as flipX)
  const angle =
    Math.atan2(transform.m10, Math.abs(transform.m00)) * (180 / Math.PI);
  const rounded = Math.round(angle);
  return rounded !== 0 ? rounded : undefined;
}

export function extractFlip(transform?: FigmaMatrix): {
  flipX?: boolean;
  flipY?: boolean;
} {
  if (!transform) return {};
  const result: { flipX?: boolean; flipY?: boolean } = {};
  // Determinant sign of the 2x2 rotation/scale sub-matrix detects reflection
  // m00*m11 - m01*m10 < 0 means a single-axis flip
  const det = transform.m00 * transform.m11 - transform.m01 * transform.m10;
  if (det < -0.001) {
    // Check which axis is flipped by looking at the scale signs
    if (transform.m00 < 0) result.flipX = true;
    else result.flipY = true;
  }
  return result;
}

export function mapCornerRadius(
  figma: FigmaNodeChange,
): number | [number, number, number, number] | undefined {
  if (figma.rectangleCornerRadiiIndependent) {
    const tl = figma.rectangleTopLeftCornerRadius ?? 0;
    const tr = figma.rectangleTopRightCornerRadius ?? 0;
    const br = figma.rectangleBottomRightCornerRadius ?? 0;
    const bl = figma.rectangleBottomLeftCornerRadius ?? 0;
    if (tl === tr && tr === br && br === bl) {
      return tl > 0 ? tl : undefined;
    }
    return [tl, tr, br, bl];
  }
  if (figma.cornerRadius && figma.cornerRadius > 0) {
    return figma.cornerRadius;
  }
  return undefined;
}

export function mapCornerSmoothing(figma: FigmaNodeChange): number | undefined {
  return typeof figma.cornerSmoothing === "number" &&
    figma.cornerSmoothing > 0
    ? figma.cornerSmoothing
    : undefined;
}

export function commonProps(
  figma: FigmaNodeChange,
  id: string,
  parentStackMode?: string,
): {
  id: string;
  name?: string;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  visible?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  transform?: ReturnType<typeof normalizeFigmaTransform>;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  blendMode?: ReturnType<typeof mapFigmaBlendMode>;
  styleRefs?: PenNodeStyleRefs;
  componentRef?: PenComponentRef;
  layoutConstraints?: PenLayoutConstraints;
  variableRefs?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  mask?: {
    enabled?: boolean;
    type?: "alpha" | "vector";
    shouldBreakMaskChain?: boolean;
  };
} {
  const { x, y } = extractPosition(figma);
  const flip = extractFlip(figma.transform);
  const transformParts = decomposeTransform(figma.transform);
  const layoutConstraints = mapFigmaLayoutConstraints(figma, parentStackMode);
  const autoLayoutMeta = getFigmaAutoLayoutDiagnostics(
    figma,
    layoutConstraints,
  );
  return {
    id,
    name: figma.name || undefined,
    x,
    y,
    rotation: extractRotation(figma.transform),
    transform: normalizeFigmaTransform(figma.transform),
    ...transformParts,
    opacity:
      figma.opacity !== undefined && figma.opacity < 1
        ? figma.opacity
        : undefined,
    locked: figma.locked || undefined,
    visible: figma.visible === false ? false : undefined,
    blendMode: mapFigmaBlendMode(figma.blendMode),
    styleRefs: mapFigmaStyleRefs(figma),
    componentRef: mapFigmaComponentRef(figma),
    layoutConstraints,
    meta: autoLayoutMeta ? { autoLayout: autoLayoutMeta } : undefined,
    variableRefs: mapFigmaVariableRefs(figma),
    mask: mapFigmaMask(figma),
    ...flip,
  };
}

function getFigmaAutoLayoutDiagnostics(
  figma: FigmaNodeChange,
  layoutConstraints: PenLayoutConstraints | undefined,
): Record<string, unknown> | undefined {
  const layout = mapFigmaLayout(figma);
  const autoLayout = { ...layout, ...layoutConstraints };
  return Object.values(autoLayout).some((value) => value !== undefined)
    ? autoLayout
    : undefined;
}

function mapFigmaComponentRef(
  figma: FigmaNodeChange,
): PenComponentRef | undefined {
  if (figma.type === "SYMBOL") {
    const componentProperties =
      figma.componentProperties ?? figma.componentPropertyDefinitions;
    return {
      source: "figma",
      type: figma.variantProperties ? "variant" : "component",
      ...(figma.guid ? { id: guidToExternalId(figma.guid) } : {}),
      ...(figma.componentKey ? { key: figma.componentKey } : {}),
      ...(figma.variantProperties
        ? { variantProperties: figma.variantProperties }
        : {}),
      ...(componentProperties ? { componentProperties } : {}),
    };
  }

  if (figma.type === "INSTANCE" || figma.symbolData || figma.overriddenSymbolID) {
    const componentGuid = figma.overriddenSymbolID ?? figma.symbolData?.symbolID;
    const overrides = figma.symbolData?.symbolOverrides ?? [];
    const overridePaths = mapFigmaOverridePaths(overrides);
    const overrideRefs = mapFigmaOverrideRefs(overrides);
    return {
      source: "figma",
      type: "instance",
      ...(figma.guid ? { id: guidToExternalId(figma.guid) } : {}),
      ...(figma.componentKey ? { key: figma.componentKey } : {}),
      ...(componentGuid
        ? { componentId: guidToExternalId(componentGuid) }
        : {}),
      ...(figma.variantProperties
        ? { variantProperties: figma.variantProperties }
        : {}),
      ...(figma.componentProperties
        ? { componentProperties: figma.componentProperties }
        : {}),
      ...(figma.componentPropAssignments
        ? { propertyAssignments: figma.componentPropAssignments }
        : {}),
      ...(overrides.length > 0 ? { overrideCount: overrides.length } : {}),
      ...(overridePaths.length > 0 ? { overridePaths } : {}),
      ...(overrideRefs.length > 0 ? { overrides: overrideRefs } : {}),
    };
  }

  return undefined;
}

function mapFigmaOverridePaths(
  overrides: Array<{ guidPath?: { guids?: FigmaGUID[] } }>,
): string[] {
  return overrides
    .map((override) =>
      override.guidPath?.guids?.map(guidToExternalId).join("/"),
    )
    .filter((path): path is string => Boolean(path));
}

function mapFigmaOverrideRefs(
  overrides: FigmaSymbolOverride[],
): PenComponentOverrideRef[] {
  return overrides
    .map((override) => {
      const pathIds = override.guidPath?.guids?.map(guidToExternalId) ?? [];
      const values = summarizeFigmaOverrideValues(override);
      const properties = Object.keys(values);
      if (pathIds.length === 0 && properties.length === 0) return undefined;

      return {
        source: "figma",
        ...(pathIds.length > 0 ? { path: pathIds.join("/") } : {}),
        ...(pathIds.length > 0 ? { pathIds } : {}),
        ...(pathIds.length > 0 ? { targetId: pathIds[pathIds.length - 1] } : {}),
        properties,
        ...(properties.length > 0 ? { values } : {}),
      };
    })
    .filter((ref): ref is PenComponentOverrideRef => Boolean(ref));
}

function summarizeFigmaOverrideValues(
  override: FigmaSymbolOverride,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override) as Array<
    [keyof FigmaSymbolOverride | string, unknown]
  >) {
    if (key === "guidPath" || key === "guid" || key === "parentIndex") continue;
    if (value === undefined) continue;
    values[key] = sanitizeOverrideValue(value);
  }
  return values;
}

function sanitizeOverrideValue(value: unknown): unknown {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeOverrideValue);
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) sanitized[key] = sanitizeOverrideValue(nested);
    }
    return sanitized;
  }
  return String(value);
}

function mapFigmaStyleRefs(figma: FigmaNodeChange): PenNodeStyleRefs | undefined {
  const refs: PenNodeStyleRefs = {};
  const fill = mapStyleRef(figma.styleIdForFill);
  const stroke = mapStyleRef(figma.styleIdForStrokeFill);
  const text = mapStyleRef(figma.styleIdForText);
  const effect = mapStyleRef(figma.styleIdForEffect);
  if (fill) refs.fill = fill;
  if (stroke) refs.stroke = stroke;
  if (text) refs.text = text;
  if (effect) refs.effect = effect;
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function mapStyleRef(
  ref: { guid?: FigmaGUID } | undefined,
): PenNodeStyleRefs[keyof PenNodeStyleRefs] | undefined {
  return ref?.guid
    ? {
        source: "figma",
        id: guidToExternalId(ref.guid),
      }
    : undefined;
}

function guidToExternalId(guid: FigmaGUID): string {
  return `${guid.sessionID}:${guid.localID}`;
}

function mapFigmaVariableRefs(
  figma: FigmaNodeChange,
): Record<string, unknown> | undefined {
  return figma.variableConsumptionMap &&
    Object.keys(figma.variableConsumptionMap).length > 0
    ? figma.variableConsumptionMap
    : undefined;
}

function mapFigmaMask(figma: FigmaNodeChange):
  | {
      enabled?: boolean;
      type?: "alpha" | "vector";
      shouldBreakMaskChain?: boolean;
    }
  | undefined {
  if (!figma.isMask && !figma.shouldBreakMaskChain) return undefined;
  return {
    ...(figma.isMask ? { enabled: true } : {}),
    type: figma.maskType === "VECTOR" ? "vector" : "alpha",
    ...(figma.shouldBreakMaskChain ? { shouldBreakMaskChain: true } : {}),
  };
}

function normalizeFigmaTransform(
  transform?: FigmaMatrix,
): FigmaMatrix | undefined {
  if (!transform) return undefined;
  return {
    m00: roundTransformNumber(transform.m00),
    m01: roundTransformNumber(transform.m01),
    m02: roundTransformNumber(transform.m02),
    m10: roundTransformNumber(transform.m10),
    m11: roundTransformNumber(transform.m11),
    m12: roundTransformNumber(transform.m12),
  };
}

function decomposeTransform(transform?: FigmaMatrix): {
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
} {
  if (!transform) return {};
  const scaleX = Math.hypot(transform.m00, transform.m10);
  const scaleY = Math.hypot(transform.m01, transform.m11);
  const skewX =
    scaleX > 0.0001
      ? Math.atan2(
          transform.m00 * transform.m01 + transform.m10 * transform.m11,
          scaleX * scaleX,
        ) *
        (180 / Math.PI)
      : 0;
  const skewY =
    scaleY > 0.0001
      ? Math.atan2(
          transform.m00 * transform.m01 + transform.m10 * transform.m11,
          scaleY * scaleY,
        ) *
        (180 / Math.PI)
      : 0;
  return {
    ...(Math.abs(scaleX - 1) > 0.001
      ? { scaleX: roundTransformNumber(scaleX) }
      : {}),
    ...(Math.abs(scaleY - 1) > 0.001
      ? { scaleY: roundTransformNumber(scaleY) }
      : {}),
    ...(Math.abs(skewX) > 0.001 ? { skewX: roundTransformNumber(skewX) } : {}),
    ...(Math.abs(skewY) > 0.001 ? { skewY: roundTransformNumber(skewY) } : {}),
  };
}

function roundTransformNumber(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

// --- Image helpers ---

export function figmaFillColor(figma: FigmaNodeChange): string | undefined {
  const paint = figma.fillPaints?.find(
    (f) => f.visible !== false && f.type === "SOLID",
  );
  if (!paint?.color) return undefined;
  const { r: cr, g: cg, b: cb } = paint.color;
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(cr)}${toHex(cg)}${toHex(cb)}`;
}

export function collectImageBlobs(
  blobs: (Uint8Array | string)[],
): Map<number, Uint8Array> {
  const map = new Map<number, Uint8Array>();
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    if (blob instanceof Uint8Array && blob.length > 8) {
      // Detect image magic bytes: PNG, JPEG, GIF, WebP
      const isPng = blob[0] === 0x89 && blob[1] === 0x50;
      const isJpeg = blob[0] === 0xff && blob[1] === 0xd8;
      const isGif = blob[0] === 0x47 && blob[1] === 0x49;
      const isWebp = blob[0] === 0x52 && blob[1] === 0x49;
      if (isPng || isJpeg || isGif || isWebp) {
        map.set(i, blob);
      }
    }
  }
  return map;
}

export const SKIPPED_TYPES = new Set([
  "SLICE",
  "CONNECTOR",
  "SHAPE_WITH_TEXT",
  "STICKY",
  "STAMP",
  "HIGHLIGHT",
  "WASHI_TAPE",
  "CODE_BLOCK",
  "MEDIA",
  "WIDGET",
  "SECTION_OVERLAY",
  "NONE",
]);

/** Scale tree children's transforms and sizes to fit a different parent size.
 *  Also scales strokeWeight proportionally so strokes don't appear
 *  disproportionately thick when an instance is smaller than its symbol. */
export function scaleTreeChildren(
  children: TreeNode[],
  sx: number,
  sy: number,
): TreeNode[] {
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return children;
  const strokeScale = Math.min(sx, sy);
  return children.map((child) => {
    const figma = { ...child.figma };
    if (figma.transform) {
      figma.transform = {
        ...figma.transform,
        m02: figma.transform.m02 * sx,
        m12: figma.transform.m12 * sy,
      };
    }
    if (figma.size) {
      figma.size = { x: figma.size.x * sx, y: figma.size.y * sy };
    }
    // Scale stroke weight so lines stay visually proportional
    if (figma.strokeWeight !== undefined && strokeScale < 0.99) {
      figma.strokeWeight =
        Math.round(figma.strokeWeight * strokeScale * 100) / 100;
    }
    return {
      figma,
      children: scaleTreeChildren(child.children, sx, sy),
    };
  });
}
