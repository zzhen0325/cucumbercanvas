import {
  computeLayoutPositions,
  cssFontFamily,
  defaultLineHeight,
  findNodeInTree,
  getNodeHeight,
  getNodeWidth,
  inferLayout,
  isNodeVisible,
  parseSizing,
  resolvePadding,
} from "@cucumber/pen-core";
import type {
  ContainerProps,
  PenFill,
  PenNode,
  RefNode,
} from "@cucumber/pen-types";
import { wrapLine } from "./paint-utils.js";
import type { RenderNode } from "./types.js";

// ---------------------------------------------------------------------------
// Pre-measure text widths using Canvas 2D (browser fonts)
// ---------------------------------------------------------------------------

let _measureCtx: CanvasRenderingContext2D | null = null;
const TEXT_MEASURE_CACHE_MAX = 5000;
const textMeasureCache = new Map<string, number>();

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCtx) {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context is unavailable for text measurement.");
    }
    _measureCtx = ctx;
  }
  return _measureCtx;
}

/**
 * Walk the node tree and fix text HEIGHTS using actual Canvas 2D wrapping.
 *
 * Only targets fixed-width text with auto height — these are the cases where
 * estimateTextHeight may underestimate because its width estimation differs
 * from Canvas 2D's actual text measurement, leading to incorrect wrap counts.
 *
 * IMPORTANT: This function never touches WIDTH or container-relative sizing
 * strings (fill_container / fit_content). Changing widths breaks layout
 * resolution in computeLayoutPositions.
 */
export function premeasureTextHeights(nodes: PenNode[]): PenNode[] {
  let changed = false;
  const measuredNodes = nodes.map((node) => {
    let result = node;

    if (node.type === "text") {
      const tNode = node as PenNode & {
        width?: number | string;
        height?: number | string;
        fontSize?: number;
        fontWeight?: string;
        fontFamily?: string;
        lineHeight?: number;
        textAlign?: string;
        textGrowth?: string;
        content?: string | { text?: string }[];
      };
      const hasFixedWidth = typeof tNode.width === "number" && tNode.width > 0;
      const isContainerHeight =
        typeof tNode.height === "string" &&
        (tNode.height === "fill_container" || tNode.height === "fit_content");
      const textGrowth = tNode.textGrowth;
      const content =
        typeof tNode.content === "string"
          ? tNode.content
          : Array.isArray(tNode.content)
            ? tNode.content.map((s) => s.text ?? "").join("")
            : (((tNode as unknown as Record<string, unknown>).text as string) ??
              "");

      const textAlign = tNode.textAlign;
      const isFixedWidthText =
        textGrowth === "fixed-width" ||
        textGrowth === "fixed-width-height" ||
        (textGrowth !== "auto" && textAlign != null && textAlign !== "left");
      if (content && hasFixedWidth && isFixedWidthText && !isContainerHeight) {
        const fontSize = tNode.fontSize ?? 16;
        const fontWeight = tNode.fontWeight ?? "400";
        const fontFamily =
          tNode.fontFamily ??
          'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
        const width = tNode.width as number;
        const lineHeightMul = tNode.lineHeight ?? defaultLineHeight(fontSize);
        const measuredHeight = readCachedTextHeight(
          content,
          width,
          fontSize,
          fontWeight,
          fontFamily,
          lineHeightMul,
        );
        const currentHeight =
          typeof tNode.height === "number" ? tNode.height : 0;
        const needsHeight =
          currentHeight <= 0 || measuredHeight > currentHeight;
        if (needsHeight && measuredHeight > currentHeight) {
          result = { ...node, height: measuredHeight } as unknown as PenNode;
        }
      }
    }

    // Recurse into children
    if ("children" in result && result.children) {
      const children = result.children;
      const measured = premeasureTextHeights(children);
      if (measured !== children) {
        result = { ...result, children: measured } as unknown as PenNode;
      }
    }

    if (result !== node) changed = true;
    return result;
  });

  return changed ? measuredNodes : nodes;
}

function readCachedTextHeight(
  content: string,
  width: number,
  fontSize: number,
  fontWeight: string,
  fontFamily: string,
  lineHeightMul: number,
): number {
  const key = [
    content,
    width,
    fontSize,
    fontWeight,
    fontFamily,
    lineHeightMul,
  ].join("\u0001");
  const cached = textMeasureCache.get(key);
  if (cached !== undefined) return cached;

  const ctx = getMeasureCtx();
  ctx.font = `${fontWeight} ${fontSize}px ${cssFontFamily(fontFamily)}`;

  const wrapWidth = width + fontSize * 0.2;
  const rawLines = content.split("\n");
  const wrappedLines: string[] = [];
  for (const raw of rawLines) {
    if (!raw) {
      wrappedLines.push("");
      continue;
    }
    wrapLine(ctx, raw, wrapWidth, wrappedLines);
  }
  const lineHeight = lineHeightMul * fontSize;
  const glyphH = fontSize * 1.13;
  const measuredHeight = Math.ceil(
    wrappedLines.length <= 1
      ? glyphH + 2
      : (wrappedLines.length - 1) * lineHeight + glyphH + 2,
  );

  if (textMeasureCache.size >= TEXT_MEASURE_CACHE_MAX) {
    const firstKey = textMeasureCache.keys().next().value;
    if (firstKey !== undefined) textMeasureCache.delete(firstKey);
  }
  textMeasureCache.set(key, measuredHeight);
  return measuredHeight;
}

// ---------------------------------------------------------------------------
// Flatten document tree -> absolute-positioned RenderNode list
// ---------------------------------------------------------------------------

interface ClipInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  cornerRadius?: [number, number, number, number];
  cornerSmoothing?: number;
  source?: "frame" | "mask";
  maskOpacity?: number;
  maskType?: "alpha" | "vector";
  maskShape?: {
    node: PenNode;
    absX: number;
    absY: number;
    absW: number;
    absH: number;
  };
}

function intersectClip(a: ClipInfo | undefined, b: ClipInfo): ClipInfo {
  if (!a) return b;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return {
    x: x1,
    y: y1,
    w: Math.max(0, x2 - x1),
    h: Math.max(0, y2 - y1),
    rx: Math.min(a.rx, b.rx),
    cornerRadius: b.cornerRadius ?? a.cornerRadius,
    cornerSmoothing: b.cornerSmoothing ?? a.cornerSmoothing,
    source: b.source ?? a.source,
    maskOpacity:
      a.maskOpacity !== undefined || b.maskOpacity !== undefined
        ? (a.maskOpacity ?? 1) * (b.maskOpacity ?? 1)
        : undefined,
    maskType: b.maskType ?? a.maskType,
    maskShape: b.maskShape ?? a.maskShape,
  };
}

function maskClipFromNode(
  node: PenNode,
  offsetX: number,
  offsetY: number,
  parentAvailW: number | undefined,
  parentAvailH: number | undefined,
  parentOpacity: number,
  maskType: "alpha" | "vector" | undefined,
  clipCtx?: ClipInfo,
): ClipInfo {
  const absX = (node.x ?? 0) + offsetX;
  const absY = (node.y ?? 0) + offsetY;
  const nodeW = getNodeWidth(node, parentAvailW);
  const nodeH = getNodeHeight(node, parentAvailH, parentAvailW);
  const absW =
    nodeW > 0 ? nodeW : "width" in node ? sizeToNumber(node.width, 100) : 100;
  const absH =
    nodeH > 0 ? nodeH : "height" in node ? sizeToNumber(node.height, 100) : 100;
  const crTuple =
    "cornerRadius" in node ? cornerRadiusTuple(node.cornerRadius) : undefined;
  const cr = Math.min(crTuple?.[0] ?? 0, absH / 2);
  const type = maskType ?? node.mask?.type ?? "alpha";
  const nodeOpacity = typeof node.opacity === "number" ? node.opacity : 1;
  const effectiveOpacity = parentOpacity * nodeOpacity;
  return intersectClip(clipCtx, {
    x: absX,
    y: absY,
    w: absW,
    h: absH,
    rx: cr,
    ...(crTuple ? { cornerRadius: crTuple } : {}),
    ...("cornerSmoothing" in node &&
    typeof (node as ContainerProps).cornerSmoothing === "number"
      ? { cornerSmoothing: (node as ContainerProps).cornerSmoothing }
      : {}),
    source: "mask",
    maskType: type,
    maskOpacity:
      type === "vector"
        ? undefined
        : resolveAlphaMaskOpacity(node, effectiveOpacity),
    maskShape: {
      node,
      absX,
      absY,
      absW,
      absH,
    },
  });
}

function sizeToNumber(
  val: number | string | undefined,
  fallback: number,
): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const m = val.match(/\((\d+(?:\.\d+)?)\)/);
    if (m?.[1]) return Number.parseFloat(m[1]);
    const n = Number.parseFloat(val);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function cornerRadiusVal(
  cr: number | [number, number, number, number] | undefined,
): number {
  if (cr === undefined) return 0;
  if (typeof cr === "number") return cr;
  return cr[0];
}

function cornerRadiusTuple(
  cr: number | [number, number, number, number] | undefined,
): [number, number, number, number] | undefined {
  if (cr === undefined) return undefined;
  if (typeof cr === "number") return [cr, cr, cr, cr];
  return cr;
}

export function flattenToRenderNodes(
  nodes: PenNode[],
  offsetX = 0,
  offsetY = 0,
  parentAvailW?: number,
  parentAvailH?: number,
  clipCtx?: ClipInfo,
  depth = 0,
  inheritedOpacity = 1,
): RenderNode[] {
  const result: RenderNode[] = [];
  let siblingMaskClip: ClipInfo | undefined;

  // Reverse order: children[0] = top layer = rendered last (frontmost)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node || !isNodeVisible(node)) continue;

    // Resolve fill_container / fit_content
    let resolved = node;
    if (parentAvailW !== undefined || parentAvailH !== undefined) {
      let changed = false;
      const r: Record<string, unknown> = { ...node };
      if ("width" in node && typeof node.width !== "number") {
        const s = parseSizing(node.width);
        if (s === "fill" && parentAvailW) {
          r.width = parentAvailW;
          changed = true;
        } else if (s === "fit") {
          r.width = getNodeWidth(node, parentAvailW);
          changed = true;
        }
      }
      if ("height" in node && typeof node.height !== "number") {
        const s = parseSizing(node.height);
        if (s === "fill" && parentAvailH) {
          r.height = parentAvailH;
          changed = true;
        } else if (s === "fit") {
          r.height = getNodeHeight(node, parentAvailH, parentAvailW);
          changed = true;
        }
      }
      if (changed) resolved = r as unknown as PenNode;
    }

    // Compute height for frames without explicit numeric height
    if (
      node.type === "frame" &&
      "children" in node &&
      node.children?.length &&
      (!("height" in resolved) || typeof resolved.height !== "number")
    ) {
      const computedH = getNodeHeight(resolved, parentAvailH, parentAvailW);
      if (computedH > 0)
        resolved = { ...resolved, height: computedH } as unknown as PenNode;
    }

    let absX = (resolved.x ?? 0) + offsetX;
    let absY = (resolved.y ?? 0) + offsetY;

    // Compute authoritative dimensions once via getNodeWidth/getNodeHeight.
    // Used for: RenderNode absW/absH, child available space, and clip rect.
    // This replaces the prior split where absW/absH used sizeToNumber (raw
    // parse + 100 fallback) while child layout used getNodeWidth/getNodeHeight,
    // causing divergence when nodes lacked numeric dimensions.
    const nodeW = getNodeWidth(resolved, parentAvailW);
    const nodeH = getNodeHeight(resolved, parentAvailH, parentAvailW);
    let absW =
      nodeW > 0
        ? nodeW
        : "width" in resolved
          ? sizeToNumber(resolved.width, 100)
          : 100;
    let absH =
      nodeH > 0
        ? nodeH
        : "height" in resolved
          ? sizeToNumber(resolved.height, 100)
          : 100;

    const renderNode = { ...resolved, x: absX, y: absY } as PenNode & {
      x2?: number;
      y2?: number;
    };
    if (renderNode.type === "line") {
      if (typeof renderNode.x2 === "number") renderNode.x2 += offsetX;
      if (typeof renderNode.y2 === "number") renderNode.y2 += offsetY;
      const x2 = renderNode.x2 ?? absX + 100;
      const y2 = renderNode.y2 ?? absY;
      absX = Math.min(renderNode.x ?? absX, x2);
      absY = Math.min(renderNode.y ?? absY, y2);
      absW = Math.abs(x2 - (renderNode.x ?? absX));
      absH = Math.abs(y2 - (renderNode.y ?? absY));
    }

    const children = "children" in node ? node.children : undefined;
    const mask = renderNode.mask;
    const nodeOpacity =
      typeof renderNode.opacity === "number" ? renderNode.opacity : 1;
    const isolatesOpacity = shouldIsolateOpacityGroup(
      renderNode,
      nodeOpacity,
      children,
    );
    const effectiveOpacity =
      inheritedOpacity * (isolatesOpacity ? 1 : nodeOpacity);
    const maskBreaksChain = mask?.shouldBreakMaskChain === true;
    if (maskBreaksChain) {
      siblingMaskClip = undefined;
    }
    const isMaskLayer = mask?.enabled === true;
    const sourceMaskNode =
      mask?.sourceNodeId && mask.sourceNodeId !== renderNode.id
        ? findNodeInTree(nodes, mask.sourceNodeId)
        : undefined;
    const sourceMaskClip = sourceMaskNode
      ? maskClipFromNode(
          sourceMaskNode,
          offsetX,
          offsetY,
          parentAvailW,
          parentAvailH,
          inheritedOpacity,
          mask?.type,
          clipCtx,
        )
      : undefined;
    const siblingActiveClip = siblingMaskClip
      ? intersectClip(clipCtx, siblingMaskClip)
      : clipCtx;
    const activeClip = sourceMaskClip
      ? intersectClip(siblingActiveClip, sourceMaskClip)
      : siblingActiveClip;

    if (!isMaskLayer) {
      result.push({
        node: renderNode as PenNode,
        absX,
        absY,
        absW,
        absH,
        depth,
        inheritedOpacity,
        renderOpacity: isolatesOpacity ? inheritedOpacity : undefined,
        opacityGroup: isolatesOpacity
          ? { opacity: nodeOpacity, depth }
          : undefined,
        clipRect: activeClip,
      });
    }

    // Recurse into children
    if (!isMaskLayer && children && children.length > 0) {
      const pad = resolvePadding(
        "padding" in resolved
          ? (resolved as PenNode & ContainerProps).padding
          : undefined,
      );
      const childAvailW = Math.max(0, nodeW - pad.left - pad.right);
      const childAvailH = Math.max(0, nodeH - pad.top - pad.bottom);

      const layout =
        ("layout" in node ? (node as ContainerProps).layout : undefined) ||
        inferLayout(node);
      const positioned =
        layout && layout !== "none"
          ? computeLayoutPositions(resolved, children)
          : children;

      // Clipping — root frames always clip like artboards. Nested containers
      // clip only when clipContent is enabled.
      let childClip = clipCtx;
      const isRootFrame = node.type === "frame" && depth === 0;
      const explicitClip =
        "clipContent" in resolved && resolved.clipContent === true;
      if (isRootFrame || explicitClip) {
        const crTuple =
          "cornerRadius" in node
            ? cornerRadiusTuple(node.cornerRadius)
            : undefined;
        const cr = Math.min(crTuple?.[0] ?? 0, nodeH / 2);
        childClip = {
          x: absX,
          y: absY,
          w: nodeW,
          h: nodeH,
          rx: cr,
          ...(crTuple ? { cornerRadius: crTuple } : {}),
          ...("cornerSmoothing" in node &&
          typeof (node as ContainerProps).cornerSmoothing === "number"
            ? { cornerSmoothing: (node as ContainerProps).cornerSmoothing }
            : {}),
          source: "frame",
        };
      }
      if (siblingMaskClip) {
        childClip = intersectClip(childClip, siblingMaskClip);
      }

      const childRNs = flattenToRenderNodes(
        positioned,
        absX,
        absY,
        childAvailW,
        childAvailH,
        childClip,
        depth + 1,
        effectiveOpacity,
      );

      // Propagate parent flip to children
      const parentFlipX = node.flipX === true;
      const parentFlipY = node.flipY === true;
      if (parentFlipX || parentFlipY) {
        const pcx = absX + nodeW / 2;
        const pcy = absY + nodeH / 2;
        for (const crn of childRNs) {
          const updates: Record<string, unknown> = {};
          if (parentFlipX) {
            const ccx = crn.absX + crn.absW / 2;
            crn.absX = 2 * pcx - ccx - crn.absW / 2;
            const childFlip = crn.node.flipX === true;
            updates.flipX = !childFlip || undefined;
          }
          if (parentFlipY) {
            const ccy = crn.absY + crn.absH / 2;
            crn.absY = 2 * pcy - ccy - crn.absH / 2;
            const childFlip = crn.node.flipY === true;
            updates.flipY = !childFlip || undefined;
          }
          crn.node = {
            ...crn.node,
            x: crn.absX,
            y: crn.absY,
            ...updates,
          } as PenNode;
        }
      }

      // Propagate parent rotation to children
      const parentRot = node.rotation ?? 0;
      if (parentRot !== 0) {
        const cx = absX + nodeW / 2;
        const cy = absY + nodeH / 2;
        const rad = (parentRot * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        for (const crn of childRNs) {
          const ccx = crn.absX + crn.absW / 2;
          const ccy = crn.absY + crn.absH / 2;
          const dx = ccx - cx;
          const dy = ccy - cy;
          const newCx = cx + dx * cosA - dy * sinA;
          const newCy = cy + dx * sinA + dy * cosA;
          crn.absX = newCx - crn.absW / 2;
          crn.absY = newCy - crn.absH / 2;
          const childRot = crn.node.rotation ?? 0;
          crn.node = {
            ...crn.node,
            x: crn.absX,
            y: crn.absY,
            rotation: childRot + parentRot,
          } as PenNode;
        }
      }

      result.push(...childRNs);
    }

    if (isMaskLayer) {
      siblingMaskClip = maskClipFromNode(
        renderNode as PenNode,
        0,
        0,
        absW,
        absH,
        inheritedOpacity,
        mask?.type,
        clipCtx,
      );
    }
  }

  return result;
}

function shouldIsolateOpacityGroup(
  node: PenNode,
  nodeOpacity: number,
  children: PenNode[] | undefined,
): boolean {
  return (
    (node.type === "frame" || node.type === "group") &&
    Array.isArray(children) &&
    children.length > 0 &&
    nodeOpacity >= 0 &&
    nodeOpacity < 1
  );
}

function resolveAlphaMaskOpacity(
  node: PenNode,
  effectiveOpacity: number,
): number {
  return clampUnit(effectiveOpacity * resolveMaskFillAlpha(node));
}

function resolveMaskFillAlpha(node: PenNode): number {
  const fills = "fill" in node ? node.fill : undefined;
  if (!Array.isArray(fills) || fills.length === 0) return 1;

  const visibleAlphas = fills
    .filter((fill) => fill.visible !== false && (fill.opacity ?? 1) > 0)
    .map((fill) => (fill.opacity ?? 1) * resolveFillAlpha(fill));
  if (visibleAlphas.length === 0) return 0;
  return clampUnit(Math.max(...visibleAlphas));
}

function resolveFillAlpha(fill: PenFill): number {
  switch (fill.type) {
    case "solid":
      return resolveColorAlpha(fill.color);
    case "linear_gradient":
    case "radial_gradient":
    case "angular_gradient":
    case "diamond_gradient":
      return Math.max(
        0,
        ...fill.stops.map((stop) => resolveColorAlpha(stop.color)),
      );
    case "image":
      return fill.url ? 1 : 0;
    default:
      return 0;
  }
}

function resolveColorAlpha(color: string | undefined): number {
  if (!color) return 0;
  const normalized = color.trim().toLowerCase();
  if (!normalized || normalized === "transparent") return 0;
  const hex = normalized.match(
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  )?.[1];
  if (hex) {
    if (hex.length === 4) {
      const alphaHex = hex.charAt(3);
      return Number.parseInt(alphaHex + alphaHex, 16) / 255;
    }
    if (hex.length === 8) return Number.parseInt(hex.slice(6, 8), 16) / 255;
    return 1;
  }
  const rgbaMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgbaMatch) {
    const parts = (rgbaMatch[1] ?? "").split(",").map((part) => part.trim());
    if (parts.length >= 4) {
      const alpha = Number.parseFloat(parts[3] ?? "");
      return Number.isFinite(alpha) ? clampUnit(alpha) : 1;
    }
    return 1;
  }
  return 1;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Ref resolution — resolve RefNodes to their target components
// ---------------------------------------------------------------------------

/** Resolve RefNodes inline (same logic as use-canvas-sync.ts). */
export function resolveRefs(
  nodes: PenNode[],
  rootNodes: PenNode[],
  findInTree?: (nodes: PenNode[], id: string) => PenNode | null,
  visited = new Set<string>(),
): PenNode[] {
  const finder =
    findInTree ??
    ((ns: PenNode[], id: string) => findNodeInTree(ns, id) ?? null);
  return nodes.flatMap((node) => {
    if (node.type !== "ref") {
      if ("children" in node && node.children) {
        return [
          {
            ...node,
            children: resolveRefs(node.children, rootNodes, finder, visited),
          } as PenNode,
        ];
      }
      return [node];
    }
    if (visited.has(node.ref)) return [];
    const component = finder(rootNodes, node.ref);
    if (!component) return [];
    visited.add(node.ref);
    const resolved: Record<string, unknown> = { ...component };
    for (const [key, val] of Object.entries(node)) {
      if (
        key === "type" ||
        key === "ref" ||
        key === "descendants" ||
        key === "children"
      )
        continue;
      if (val !== undefined) resolved[key] = val;
    }
    resolved.type = component.type;
    if (!resolved.name) resolved.name = component.name;
    resolved.reusable = undefined;
    const resolvedNode = resolved as unknown as PenNode;
    if ("children" in component && component.children) {
      const refNode = node as RefNode;
      (resolvedNode as PenNode & ContainerProps).children = remapIds(
        component.children,
        node.id,
        refNode.descendants,
      );
    }
    visited.delete(node.ref);
    return [resolvedNode];
  });
}

export function remapIds(
  children: PenNode[],
  refId: string,
  overrides?: Record<string, Partial<PenNode>>,
): PenNode[] {
  return children.map((child) => {
    const virtualId = `${refId}__${child.id}`;
    const ov = overrides?.[child.id] ?? {};
    const mapped = { ...child, ...ov, id: virtualId } as PenNode;
    if ("children" in mapped && mapped.children) {
      (mapped as PenNode & ContainerProps).children = remapIds(
        mapped.children,
        refId,
        overrides,
      );
    }
    return mapped;
  });
}

// ---------------------------------------------------------------------------
// Component / instance ID collection (from raw tree, before ref resolution)
// ---------------------------------------------------------------------------

export function collectReusableIds(nodes: PenNode[], result: Set<string>) {
  for (const node of nodes) {
    if (node.type === "frame" && node.reusable === true) {
      result.add(node.id);
    }
    if ("children" in node && node.children) {
      collectReusableIds(node.children, result);
    }
  }
}

export function collectInstanceIds(nodes: PenNode[], result: Set<string>) {
  for (const node of nodes) {
    if (node.type === "ref") {
      result.add(node.id);
    }
    if ("children" in node && node.children) {
      collectInstanceIds(node.children, result);
    }
  }
}
