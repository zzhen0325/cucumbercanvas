import { cloneDocument, createNodeId, findNode } from "./document.js";
import { applyCanvasOperation } from "./operations.js";
import { parseFigmaClipboardNative } from "./figma-native.js";
import type { CanvasEffect, CanvasFill, CanvasStroke } from "./styles.js";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import type {
  CanvasAsset,
  CanvasBounds,
  CanvasImportedAutoLayoutMeta,
  CanvasImportedNodeMeta,
  CanvasImportSource,
  CanvasImportWarningCode,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal intermediate node representation used during parsing.
// Converted to PenNode tree at the insertCanvasImportResult boundary.
// ---------------------------------------------------------------------------

export interface ImportNode {
  id: string;
  type: string;
  parentId: string | null;
  title?: string;
  bounds: CanvasBounds;
  fills?: CanvasFill[];
  stroke?: CanvasStroke;
  cornerRadius?: number;
  opacity?: number;
  childrenOrder?: string[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  d?: string;
  points?: number;
  assetId?: string;
  src?: string;
  meta?: Record<string, unknown>;
  locked?: boolean;
  visible?: boolean;
  effects?: CanvasEffect[];
  alt?: string;
  fontWeight?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export interface CanvasImportWarning {
  code: CanvasImportWarningCode;
  message: string;
  originNodeId?: string;
  originNodeType?: string;
}

export interface CanvasImportResult {
  source: "svg" | "figma";
  sourceLabel: string;
  importSessionId: string;
  rootNodeIds: string[];
  /** ImportNode[] from SVG/HTML parsers, or PenNode[] from native Figma parser (TODO: unify) */
  nodes: (ImportNode | PenNode)[];
  assets: CanvasAsset[];
  warnings: CanvasImportWarning[];
}

export interface ClipboardImportPayload {
  html?: string;
  text?: string;
}

type ParsedStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
};

function parsedFillToCanvasFills(parsed: ParsedStyle): CanvasFill[] | undefined {
  const c = parsed.fill ?? parsed.color;
  return c ? [{ type: "solid" as const, color: c }] : undefined;
}

function parsedStrokeToCanvasStroke(parsed: ParsedStyle): CanvasStroke | undefined {
  const c = parsed.stroke;
  if (!c) return undefined;
  return {
    thickness: parsed.strokeWidth ?? 1,
    align: "center",
    fill: [{ type: "solid" as const, color: c }],
  };
}

type SvgParseState = {
  importSessionId: string;
  source: "svg" | "figma";
  sourceLabel: string;
  nodes: ImportNode[];
  assets: CanvasAsset[];
  warnings: CanvasImportWarning[];
  warningKeys: Set<string>;
};

const SVG_NS = "http://www.w3.org/2000/svg";

function createImportSessionId(): string {
  return `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getImportSourceMeta(source: "svg" | "figma"): {
  sourceLabel: string;
  nodeSource: CanvasImportSource;
} {
  return source === "figma"
    ? { sourceLabel: "Figma", nodeSource: "figma-paste" }
    : { sourceLabel: "SVG", nodeSource: "svg-import" };
}

function pushImportWarning(
  state: SvgParseState,
  warning: CanvasImportWarning,
): void {
  const key = [
    warning.code,
    warning.message,
    warning.originNodeId ?? "",
    warning.originNodeType ?? "",
  ].join("|");
  if (state.warningKeys.has(key)) {
    return;
  }
  state.warningKeys.add(key);
  state.warnings.push(warning);
}

function createImportedNodeMeta(
  state: SvgParseState,
  options?: {
    originNodeType?: string;
    originNodeId?: string;
    figmaNodeType?: string;
    degradationHints?: string[];
    warningCount?: number;
    autoLayout?: CanvasImportedAutoLayoutMeta;
  },
): CanvasImportedNodeMeta {
  const { nodeSource, sourceLabel } = getImportSourceMeta(state.source);
  return {
    source: nodeSource,
    importSessionId: state.importSessionId,
    importSourceLabel: sourceLabel,
    originNodeType: options?.originNodeType,
    originNodeId: options?.originNodeId,
    figmaNodeType: options?.figmaNodeType,
    degradationHints:
      options?.degradationHints && options.degradationHints.length > 0
        ? Array.from(new Set(options.degradationHints))
        : undefined,
    warningCount: options?.warningCount,
    autoLayout: options?.autoLayout,
  };
}

function getWarningCodes(warnings: CanvasImportWarning[]): string[] {
  return Array.from(new Set(warnings.map((warning) => warning.code)));
}

function getHtmlAutoLayoutMeta(style: Record<string, string>): CanvasImportedAutoLayoutMeta | undefined {
  const isFlex = style.display === "flex" || style.display === "inline-flex";
  if (!isFlex) {
    return undefined;
  }

  const meta: CanvasImportedAutoLayoutMeta = {
    layout: style.flexDirection === "column" ? "vertical" : "horizontal",
    gap: parseCssNumber(style.gap),
    padding: readCssPadding(style),
    justifyContent: mapCssJustifyContent(style.justifyContent),
    alignItems: mapCssAlignItems(style.alignItems),
    clipContent: style.overflow === "hidden" || style.overflow === "clip" ? true : undefined,
  };

  return Object.values(meta).some((value) => value !== undefined) ? meta : undefined;
}

function readCssPadding(
  style: Record<string, string>,
): CanvasImportedAutoLayoutMeta["padding"] | undefined {
  const top = parseCssNumber(style.paddingTop ?? style.padding);
  const right = parseCssNumber(style.paddingRight ?? style.padding);
  const bottom = parseCssNumber(style.paddingBottom ?? style.padding);
  const left = parseCssNumber(style.paddingLeft ?? style.padding);

  if ([top, right, bottom, left].every((value) => value === undefined || value === 0)) {
    return undefined;
  }

  const safeTop = top ?? 0;
  const safeRight = right ?? 0;
  const safeBottom = bottom ?? 0;
  const safeLeft = left ?? 0;
  if (safeTop === safeRight && safeRight === safeBottom && safeBottom === safeLeft) {
    return safeTop;
  }
  if (safeTop === safeBottom && safeLeft === safeRight) {
    return [safeTop, safeRight];
  }
  return [safeTop, safeRight, safeBottom, safeLeft];
}

function mapCssJustifyContent(value?: string): CanvasImportedAutoLayoutMeta["justifyContent"] {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
      return "end";
    case "space-between":
    case "space-evenly":
    case "space-around":
      return "space_between";
    case "flex-start":
    default:
      return value ? "start" : undefined;
  }
}

function mapCssAlignItems(value?: string): CanvasImportedAutoLayoutMeta["alignItems"] {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
      return "end";
    case "baseline":
      return "baseline";
    case "flex-start":
    default:
      return value ? "start" : undefined;
  }
}

export function isLikelySvgMarkup(value: string): boolean {
  return /<svg[\s>]/i.test(value);
}

export function isLikelyFigmaClipboardHtml(value: string): boolean {
  return /figmeta|data-buffer|data-metadata/i.test(value);
}

export function parseClipboardImport(
  payload: ClipboardImportPayload,
): CanvasImportResult | null {
  if (payload.html && isLikelyFigmaClipboardHtml(payload.html)) {
    try {
      const nativeResult = parseFigmaClipboardNative(payload.html);
      if (nativeResult) {
        return {
          source: "figma",
          sourceLabel: "Figma",
          importSessionId: createImportSessionId(),
          rootNodeIds: nativeResult.rootNodeIds,
          nodes: nativeResult.nodes,
          assets: nativeResult.assets,
          warnings: nativeResult.warnings,
        };
      }
    } catch {
      // Fall through to the existing HTML/SVG fallback path when native decode fails.
    }
    const figmaResult = parseFigmaClipboardHtml(payload.html);
    if (figmaResult) return figmaResult;
  }
  if (payload.html && isLikelySvgMarkup(payload.html)) {
    return parseSvgMarkup(payload.html, { source: "svg" });
  }
  if (payload.text && isLikelySvgMarkup(payload.text)) {
    return parseSvgMarkup(payload.text, { source: "svg" });
  }
  return null;
}

export function parseSvgMarkup(
  svgMarkup: string,
  options?: { source?: "svg" | "figma" },
): CanvasImportResult {
  if (typeof DOMParser === "undefined") {
    throw new Error("当前环境不支持 SVG 导入解析。");
  }
  const parser = new DOMParser();
  const xml = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = xml.querySelector("svg");
  if (!svg) {
    throw new Error("未检测到可解析的 SVG 内容。");
  }

  const source = options?.source ?? "svg";
  const state: SvgParseState = {
    importSessionId: createImportSessionId(),
    source,
    sourceLabel: getImportSourceMeta(source).sourceLabel,
    nodes: [],
    assets: [],
    warnings: [],
    warningKeys: new Set<string>(),
  };
  const inherited = readElementStyle(svg, {});
  const roots: string[] = [];

  for (const child of Array.from(svg.children)) {
    const parsed = parseSvgElement(
      child,
      null,
      inherited,
      state,
    );
    if (parsed) roots.push(parsed);
  }

  if (roots.length === 0) {
    throw new Error("SVG 内容中没有可编辑节点。");
  }

  return {
    source,
    sourceLabel: state.sourceLabel,
    importSessionId: state.importSessionId,
    rootNodeIds: roots,
    nodes: state.nodes,
    assets: state.assets,
    warnings: state.warnings,
  };
}

export function insertCanvasImportResult(
  doc: PenDocument,
  result: CanvasImportResult,
  options?: {
    parentId?: string | null;
    offsetX?: number;
    offsetY?: number;
  },
): { doc: PenDocument; insertedIds: string[] } {
  let next = cloneDocument(doc);
  const targetParentId = options?.parentId ?? null;
  const offsetX = options?.offsetX ?? 0;
  const offsetY = options?.offsetY ?? 0;

  // Copy assets into document
  if (result.assets.length > 0) {
    const assets = { ...next.assets };
    for (const asset of result.assets) {
      assets[asset.id] = structuredClone(asset);
    }
    next = { ...next, assets };
  }

  // Detect node format: ImportNode has `bounds`, PenNode has flat x/y
  const firstNode = result.nodes[0];
  const isNative = firstNode && !('bounds' in firstNode);

  if (isNative) {
    // Native Figma path: nodes are already PenNode tree
    const nativeNodes = result.nodes as PenNode[];
    for (const rootId of result.rootNodeIds) {
      const penNode = nativeNodes.find((n) => n.id === rootId);
      if (!penNode) continue;
      // Apply offset to root nodes
      if (offsetX !== 0 || offsetY !== 0) {
        (penNode as any).x = (penNode.x ?? 0) + offsetX;
        (penNode as any).y = (penNode.y ?? 0) + offsetY;
      }
      next = applyCanvasOperation(next, {
        type: 'insertNode',
        node: penNode,
        parentId: targetParentId,
      });
    }
    return { doc: next, insertedIds: [...result.rootNodeIds] };
  }

  // SVG/HTML path: convert ImportNode flat list → PenNode tree
  const importNodes = result.nodes as ImportNode[];
  const nodeMap = new Map<string, PenNode>();
  for (const imported of importNodes) {
    const penNode = importNodeToPenNode(imported, offsetX, offsetY, result);
    nodeMap.set(penNode.id, penNode);
  }

  // Resolve childrenOrder → children for container nodes
  for (const imported of importNodes) {
    if (!imported.childrenOrder || imported.childrenOrder.length === 0) continue;
    const penNode = nodeMap.get(imported.id);
    if (!penNode || !('children' in penNode)) continue;
    const children: PenNode[] = [];
    for (const childId of imported.childrenOrder) {
      const child = nodeMap.get(childId);
      if (child) children.push(child);
    }
    (penNode as any).children = children;
  }

  // Insert root nodes via applyCanvasOperation
  const insertedIds: string[] = [];
  for (const rootId of result.rootNodeIds) {
    const penNode = nodeMap.get(rootId);
    if (!penNode) continue;
    next = applyCanvasOperation(next, {
      type: 'insertNode',
      node: penNode,
      parentId: targetParentId,
    });
    insertedIds.push(penNode.id);
  }

  return { doc: next, insertedIds };
}

/** Convert a flat ImportNode to a PenNode with import metadata. */
function importNodeToPenNode(
  imported: ImportNode,
  offsetX: number,
  offsetY: number,
  result: CanvasImportResult,
): PenNode {
  const isRoot = result.rootNodeIds.includes(imported.id);
  const importedMeta = (imported.meta ?? {}) as Record<string, unknown>;
  const meta: Record<string, unknown> = {
    ...importedMeta,
    source: getImportSourceMeta(result.source).nodeSource,
    importSessionId: result.importSessionId,
    importSourceLabel: result.sourceLabel,
    degradationHints: importedMeta.degradationHints ?? getWarningCodes(result.warnings),
    warningCount: importedMeta.warningCount ?? (isRoot ? result.warnings.length : undefined),
  };

  const base = {
    id: imported.id,
    type: imported.type as PenNode['type'],
    name: imported.title,
    x: imported.bounds.x + offsetX,
    y: imported.bounds.y + offsetY,
    width: imported.bounds.width,
    height: imported.bounds.height,
    opacity: imported.opacity,
    cornerRadius: imported.cornerRadius,
    fill: imported.fills,
    stroke: imported.stroke,
    meta,
  };

  // Type-specific fields for PenNode union members
  switch (imported.type) {
    case 'text':
      return { ...base, type: 'text' as const, content: imported.text ?? '', fontFamily: imported.fontFamily, fontSize: imported.fontSize } as unknown as PenNode;
    case 'path':
      return { ...base, type: 'path' as const, d: imported.d ?? '' } as unknown as PenNode;
    case 'polygon':
      return { ...base, type: 'polygon' as const, polygonCount: imported.points ?? 3 } as unknown as PenNode;
    case 'line':
      return { ...base, type: 'line' as const } as unknown as PenNode;
    case 'image':
      return { ...base, type: 'image' as const, src: imported.src ?? '' } as unknown as PenNode;
    case 'videoEmbed':
      return { ...base, type: 'videoEmbed' as const, src: imported.src ?? '' } as unknown as PenNode;
    default:
      return base as unknown as PenNode;
  }
}

export function getCanvasImportBounds(result: CanvasImportResult): CanvasBounds | null {
  if (result.nodes.length === 0) return null;
  const nodes = result.nodes;
  // Handle both ImportNode (has `bounds`) and PenNode (has flat x/y/width/height)
  const getBounds = (node: ImportNode | PenNode): CanvasBounds => {
    if ('bounds' in node) {
      return (node as ImportNode).bounds;
    }
    const pen = node as PenNode;
    return {
      x: pen.x ?? 0,
      y: pen.y ?? 0,
      width: ('width' in pen ? (pen as any).width : undefined) ?? 100,
      height: ('height' in pen ? (pen as any).height : undefined) ?? 100,
    };
  };
  const boundsList = nodes.map(getBounds);
  const minX = Math.min(...boundsList.map((b) => b.x));
  const minY = Math.min(...boundsList.map((b) => b.y));
  const maxX = Math.max(...boundsList.map((b) => b.x + b.width));
  const maxY = Math.max(...boundsList.map((b) => b.y + b.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function parseFigmaClipboardHtml(html: string): CanvasImportResult | null {
  if (typeof DOMParser === "undefined") return null;

  const svgMatch = html.match(/<svg[\s\S]*<\/svg>/i);
  if (svgMatch?.[0]) {
    const result = parseSvgMarkup(svgMatch[0], { source: "figma" });
    result.warnings.push({
      code: "partial_fidelity",
      message: "当前 Figma 剪贴板按内嵌 SVG 回退导入，复杂组件与自动布局可能无法完整保真。",
    });
    return result;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const state: SvgParseState = {
    importSessionId: createImportSessionId(),
    source: "figma",
    sourceLabel: "Figma",
    nodes: [],
    assets: [],
    warnings: [],
    warningKeys: new Set<string>(),
  };
  const roots: string[] = [];
  const elements = Array.from(doc.body.children);
  for (const element of elements) {
    const nodeIds = parseStyledHtmlElement(element, null, state);
    roots.push(...nodeIds);
  }
  if (roots.length === 0) return null;
  pushImportWarning(state, {
    code: "partial_fidelity",
    message:
      "当前 Figma 剪贴板按样式化 HTML 部分导入，复杂组件、布尔运算和高级效果暂未完整支持。",
  });
  return {
    source: "figma",
    sourceLabel: state.sourceLabel,
    importSessionId: state.importSessionId,
    rootNodeIds: roots,
    nodes: state.nodes,
    assets: state.assets,
    warnings: state.warnings,
  };
}

function parseStyledHtmlElement(
  element: Element,
  parentId: string | null,
  state: SvgParseState,
): string[] {
  const style = parseStyleAttribute(element.getAttribute("style"));
  const left = parseCssNumber(style.left) ?? 0;
  const top = parseCssNumber(style.top) ?? 0;
  const width = Math.max(0, parseCssNumber(style.width) ?? 0);
  const height = Math.max(0, parseCssNumber(style.height) ?? 0);
  const directText = extractDirectText(element);
  const childIds: string[] = [];
  const localNodeIds: string[] = [];
  const originNodeType = element.tagName.toLowerCase();
  const originNodeId =
    element.getAttribute("data-node-id") ??
    element.getAttribute("data-id") ??
    element.getAttribute("id") ??
    undefined;
  const degradationHints: string[] = [];
  const autoLayout = getHtmlAutoLayoutMeta(style);

  if (autoLayout) {
    degradationHints.push("layout_degraded");
    pushImportWarning(state, {
      code: "layout_degraded",
      message: "检测到 Figma 自动布局样式，已保留布局元数据，当前画布仍按静态几何近似导入。",
      originNodeId,
      originNodeType,
    });
  }
  if (style.boxShadow || style.filter || style.backdropFilter) {
    degradationHints.push("effects_dropped");
    pushImportWarning(state, {
      code: "effects_dropped",
      message: "检测到阴影或滤镜效果，当前导入不会完整保留高级效果。",
      originNodeId,
      originNodeType,
    });
  }
  if (hasComponentLikeMetadata(element)) {
    degradationHints.push("component_metadata_dropped");
    pushImportWarning(state, {
      code: "component_metadata_dropped",
      message: "检测到组件或实例元数据，当前仅保留可编辑几何结构，不保留组件引用语义。",
      originNodeId,
      originNodeType,
    });
  }

  if (style.backgroundColor && width > 0 && height > 0) {
    const rectId = createNodeId("rect");
    const bgColor = normalizeColor(style.backgroundColor);
    state.nodes.push({
      id: rectId,
      type: "rect",
      parentId,
      title: "Imported block",
      bounds: { x: left, y: top, width, height },
      fills: bgColor ? [{ type: "solid", color: bgColor }] : undefined,
      cornerRadius: parseCssNumber(style.borderRadius) ?? 0,
      opacity: readOpacity(style.opacity),
      meta: createImportedNodeMeta(state, {
        originNodeType,
        originNodeId,
        figmaNodeType: inferFigmaNodeType(element),
        degradationHints,
        autoLayout,
      }),
    } as ImportNode);
    localNodeIds.push(rectId);
  }

  if (directText.length > 0) {
    const fontSize = Math.max(12, parseCssNumber(style.fontSize) ?? 16);
    const textId = createNodeId("text");
    const textColor = normalizeColor(style.color) ?? "#111827";
    state.nodes.push({
      id: textId,
      type: "text",
      parentId,
      title: directText.slice(0, 24),
      text: directText,
      fontSize,
      fontFamily: style.fontFamily,
      fills: [{ type: "solid", color: textColor }],
      bounds: {
        x: left,
        y: top,
        width: Math.max(width || 0, estimateTextWidth(directText, fontSize)),
        height: Math.max(height || 0, Math.round(fontSize * 1.5)),
      },
      opacity: readOpacity(style.opacity),
      meta: createImportedNodeMeta(state, {
        originNodeType,
        originNodeId,
        figmaNodeType: inferFigmaNodeType(element),
        degradationHints,
        autoLayout,
      }),
    } as ImportNode);
    localNodeIds.push(textId);
  }

  const needsGroup =
    element.children.length > 0 ||
    localNodeIds.length > 1 ||
    (localNodeIds.length === 1 && width > 0 && height > 0);
  const groupId = needsGroup ? createNodeId("group") : null;
  if (groupId) {
    for (const nodeId of localNodeIds) {
      const node = state.nodes.find((entry) => entry.id === nodeId);
      if (node) {
        node.parentId = groupId;
      }
    }
  }

  for (const child of Array.from(element.children)) {
    childIds.push(...parseStyledHtmlElement(child, groupId ?? parentId, state));
  }

  if (groupId) {
    const groupedIds = [...localNodeIds, ...childIds];
    if (groupedIds.length === 0) {
      return [];
    }
    const bounds = getSelectionBounds(
      groupedIds
        .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
        .filter((node): node is ImportNode => Boolean(node)),
    );
    if (!bounds) {
      return groupedIds;
    }
    state.nodes.push({
      id: groupId,
      type: "group",
      parentId,
      title: element.getAttribute("aria-label") ?? "Imported group",
      bounds,
      childrenOrder: groupedIds,
      meta: createImportedNodeMeta(state, {
        originNodeType,
        originNodeId,
        figmaNodeType: inferFigmaNodeType(element),
        degradationHints,
        autoLayout,
      }),
    });
    return [groupId];
  }

  return localNodeIds;
}

function parseSvgElement(
  element: Element,
  parentId: string | null,
  inherited: ParsedStyle,
  state: SvgParseState,
): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "defs" || tag === "style" || tag === "title" || tag === "desc") {
    return null;
  }
  const style = readElementStyle(element, inherited);

  if (tag === "g" || tag === "svg") {
    const groupId = tag === "g" ? createNodeId("group") : null;
    const childParentId = groupId ?? parentId;
    const childIds: string[] = [];
    for (const child of Array.from(element.children)) {
      const parsed = parseSvgElement(child, childParentId, style, state);
      if (parsed) childIds.push(parsed);
    }
    if (!groupId) return null;
    if (childIds.length === 0) return null;
    const bounds = getSelectionBounds(
      childIds
        .map((childId) => state.nodes.find((node) => node.id === childId))
        .filter((node): node is ImportNode => Boolean(node)),
    );
    if (!bounds) return null;
    state.nodes.push({
      id: groupId,
      type: "group",
      parentId,
      title: element.getAttribute("id") ?? "Imported group",
      bounds,
      childrenOrder: childIds,
      meta: createImportedNodeMeta(state, {
        originNodeType: tag,
        originNodeId: element.getAttribute("id") ?? undefined,
      }),
    });
    return groupId;
  }

  const opacity = style.opacity;
  const commonMeta = createImportedNodeMeta(state, {
    originNodeType: tag,
    originNodeId: element.getAttribute("id") ?? undefined,
  });

  if (tag === "rect") {
    const id = createNodeId("rect");
    state.nodes.push({
      id,
      type: "rect",
      parentId,
      title: element.getAttribute("id") ?? "Rectangle",
      bounds: {
        x: readNumber(element, "x"),
        y: readNumber(element, "y"),
        width: Math.max(1, readNumber(element, "width")),
        height: Math.max(1, readNumber(element, "height")),
      },
      fills: parsedFillToCanvasFills(style),
      stroke: parsedStrokeToCanvasStroke(style),
      cornerRadius: readNumber(element, "rx") || undefined,
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "circle" || tag === "ellipse") {
    const id = createNodeId("ellipse");
    const cx = readNumber(element, "cx");
    const cy = readNumber(element, "cy");
    const rx = tag === "circle" ? readNumber(element, "r") : readNumber(element, "rx");
    const ry = tag === "circle" ? readNumber(element, "r") : readNumber(element, "ry");
    state.nodes.push({
      id,
      type: "ellipse",
      parentId,
      title: element.getAttribute("id") ?? "Ellipse",
      bounds: {
        x: cx - rx,
        y: cy - ry,
        width: Math.max(1, rx * 2),
        height: Math.max(1, ry * 2),
      },
      fills: parsedFillToCanvasFills(style),
      stroke: parsedStrokeToCanvasStroke(style),
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "line") {
    const x1 = readNumber(element, "x1");
    const y1 = readNumber(element, "y1");
    const x2 = readNumber(element, "x2");
    const y2 = readNumber(element, "y2");
    const id = createNodeId("line");
    state.nodes.push({
      id,
      type: "line",
      parentId,
      title: element.getAttribute("id") ?? "Line",
      bounds: {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.max(1, Math.abs(x2 - x1)),
        height: Math.max(1, Math.abs(y2 - y1)),
      },
      stroke: {
        thickness: style.strokeWidth ?? 1,
        align: "center",
        fill: [{ type: "solid", color: style.stroke ?? "#111827" }],
      },
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "polygon" || tag === "polyline") {
    const points = readPoints(element.getAttribute("points"));
    if (points.length === 0) return null;
    const bounds = getPointBounds(points);
    const id =
      tag === "polygon"
        ? createNodeId("polygon")
        : createNodeId("path");
    if (tag === "polygon") {
      state.nodes.push({
        id,
        type: "polygon",
        parentId,
        title: element.getAttribute("id") ?? "Polygon",
        bounds,
        points: Math.max(3, points.length),
        fills: parsedFillToCanvasFills(style),
        stroke: parsedStrokeToCanvasStroke(style),
        opacity,
        meta: commonMeta,
      } as ImportNode);
      return id;
    }
    state.nodes.push({
      id,
      type: "path",
      parentId,
      title: element.getAttribute("id") ?? "Polyline",
      bounds,
      d: pointsToPath(points),
      fills: undefined,
      stroke: {
        thickness: style.strokeWidth ?? 1,
        align: "center",
        fill: [{ type: "solid", color: style.stroke ?? "#111827" }],
      },
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "path") {
    const d = element.getAttribute("d");
    if (!d) return null;
    const bounds = getPathBounds(d);
    const id = createNodeId("path");
    state.nodes.push({
      id,
      type: "path",
      parentId,
      title: element.getAttribute("id") ?? "Path",
      bounds,
      d,
      fills: parsedFillToCanvasFills(style),
      stroke: parsedStrokeToCanvasStroke(style),
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "image") {
    const href =
      element.getAttribute("href") ??
      element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (!href) return null;
    const assetId = createNodeId("asset");
    state.assets.push({
      id: assetId,
      url: href,
      mimeType: inferMimeTypeFromUrl(href),
      source: "upload",
    });
    const id = createNodeId("image");
    state.nodes.push({
      id,
      type: "image",
      parentId,
      title: element.getAttribute("id") ?? "Image",
      assetId,
      src: href,
      bounds: {
        x: readNumber(element, "x"),
        y: readNumber(element, "y"),
        width: Math.max(1, readNumber(element, "width")),
        height: Math.max(1, readNumber(element, "height")),
      },
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "text") {
    const x = readNumber(element, "x");
    const y = readNumber(element, "y");
    const text = extractSvgTextContent(element);
    if (!text) return null;
    const fontSize = Math.max(8, style.fontSize ?? 16);
    const id = createNodeId("text");
    const textColor = style.fill ?? style.color ?? "#111827";
    state.nodes.push({
      id,
      type: "text",
      parentId,
      title: text.slice(0, 24),
      text,
      fontSize,
      fontFamily: style.fontFamily,
      fills: [{ type: "solid", color: textColor }],
      bounds: {
        x,
        y: y - fontSize,
        width: estimateTextWidth(text, fontSize),
        height: Math.round(fontSize * 1.5),
      },
      opacity,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  pushImportWarning(state, {
    code: "unsupported_tag",
    message: `暂未支持导入 SVG 节点 <${tag}>，已跳过。`,
    originNodeId: element.getAttribute("id") ?? undefined,
    originNodeType: tag,
  });
  return null;
}

function readElementStyle(element: Element, inherited: ParsedStyle): ParsedStyle {
  const fromAttr = parseStyleAttribute(element.getAttribute("style"));
  const fill = normalizeColor(
    element.getAttribute("fill") ?? fromAttr.fill ?? inherited.fill,
  );
  const stroke = normalizeColor(
    element.getAttribute("stroke") ?? fromAttr.stroke ?? inherited.stroke,
  );
  const color = normalizeColor(
    fromAttr.color ?? element.getAttribute("color") ?? inherited.color,
  );
  return {
    fill,
    stroke,
    color,
    strokeWidth:
      readOptionalNumber(element.getAttribute("stroke-width")) ??
      parseCssNumber(fromAttr.strokeWidth) ??
      inherited.strokeWidth,
    opacity:
      readOpacity(element.getAttribute("opacity")) ??
      readOpacity(fromAttr.opacity) ??
      inherited.opacity,
    fontSize:
      readOptionalNumber(element.getAttribute("font-size")) ??
      parseCssNumber(fromAttr.fontSize) ??
      inherited.fontSize,
    fontFamily:
      fromAttr.fontFamily ?? element.getAttribute("font-family") ?? inherited.fontFamily,
  };
}

function parseStyleAttribute(raw: string | null): Record<string, string> {
  if (!raw) return {};
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [key, ...rest] = entry.split(":");
      if (!key || rest.length === 0) return acc;
      acc[toCamelCase(key.trim())] = rest.join(":").trim();
      return acc;
    }, {});
}

function extractDirectText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSvgTextContent(element: Element): string {
  const text = element.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

function hasComponentLikeMetadata(element: Element): boolean {
  return Array.from(element.attributes).some((attribute) =>
    /component|instance|variant/i.test(attribute.name + attribute.value),
  );
}

function inferFigmaNodeType(element: Element): string | undefined {
  return (
    element.getAttribute("data-node-type") ??
    element.getAttribute("data-figma-node-type") ??
    undefined
  );
}

function readNumber(element: Element, attribute: string): number {
  return readOptionalNumber(element.getAttribute(attribute)) ?? 0;
}

function readOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseCssNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function readOpacity(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeColor(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized === "none" || normalized === "transparent") {
    return undefined;
  }
  return normalized;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.max(24, Math.round(text.length * fontSize * 0.62));
}

function readPoints(raw: string | null): Array<{ x: number; y: number }> {
  if (!raw) return [];
  const values = raw
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < values.length - 1; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined) continue;
    points.push({ x, y });
  }
  return points;
}

function getPointBounds(points: Array<{ x: number; y: number }>): CanvasBounds {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${point.x} ${point.y}`,
    )
    .join(" ");
}

function getPathBounds(d: string): CanvasBounds {
  const values = Array.from(d.matchAll(/-?\d*\.?\d+/g), (match) =>
    Number.parseFloat(match[0]),
  ).filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < values.length - 1; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined) continue;
    points.push({ x, y });
  }
  return points.length > 0
    ? getPointBounds(points)
    : { x: 0, y: 0, width: 1, height: 1 };
}

function getSelectionBounds(nodes: ImportNode[]): CanvasBounds | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((node) => node.bounds.x));
  const minY = Math.min(...nodes.map((node) => node.bounds.y));
  const maxX = Math.max(
    ...nodes.map((node) => node.bounds.x + node.bounds.width),
  );
  const maxY = Math.max(
    ...nodes.map((node) => node.bounds.y + node.bounds.height),
  );
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function inferMimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function toCamelCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

if (typeof document !== "undefined" && !document.createElementNS) {
  document.createElementNS = ((namespace: string, tagName: string) =>
    document.createElement(tagName)) as typeof document.createElementNS;
}

export function createDetachedSvgElement(tagName: string): Element {
  if (typeof document !== "undefined") {
    return document.createElementNS(SVG_NS, tagName);
  }
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const xml = parser.parseFromString(
      `<${tagName} xmlns="${SVG_NS}" />`,
      "image/svg+xml",
    );
    const element = xml.querySelector(tagName);
    if (element) return element;
  }
  throw new Error("当前环境不支持创建 SVG 节点。");
}
