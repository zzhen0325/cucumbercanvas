import { cloneCanvasDocument, createCanvasNodeId } from "./document.js";
import { parseFigmaClipboardNative } from "./figma-native.js";
import type {
  CanvasAsset,
  CanvasBounds,
  CanvasImportedNodeMeta,
  CanvasNode,
  CanvasImportSource,
  CanvasImportWarningCode,
  CucumberCanvasDocument,
} from "./types.js";

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
  nodes: CanvasNode[];
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

type SvgParseState = {
  importSessionId: string;
  source: "svg" | "figma";
  sourceLabel: string;
  nodes: CanvasNode[];
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
  };
}

function getWarningCodes(warnings: CanvasImportWarning[]): string[] {
  return Array.from(new Set(warnings.map((warning) => warning.code)));
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
  doc: CucumberCanvasDocument,
  result: CanvasImportResult,
  options?: {
    parentId?: string | null;
    offsetX?: number;
    offsetY?: number;
  },
): { doc: CucumberCanvasDocument; insertedIds: string[] } {
  const next = cloneCanvasDocument(doc);
  const parentId = options?.parentId ?? null;
  const offsetX = options?.offsetX ?? 0;
  const offsetY = options?.offsetY ?? 0;

  for (const asset of result.assets) {
    next.assets[asset.id] = structuredClone(asset);
  }

  for (const imported of result.nodes) {
    const isRoot = result.rootNodeIds.includes(imported.id);
    const importedMeta = (imported.meta ?? {}) as CanvasImportedNodeMeta;
    const node: CanvasNode = {
      ...structuredClone(imported),
      parentId: isRoot ? parentId : imported.parentId,
      bounds: {
        ...imported.bounds,
        x: imported.bounds.x + offsetX,
        y: imported.bounds.y + offsetY,
      },
      meta: {
        ...importedMeta,
        source: getImportSourceMeta(result.source).nodeSource,
        importSessionId: result.importSessionId,
        importSourceLabel: result.sourceLabel,
        degradationHints: importedMeta.degradationHints ?? getWarningCodes(result.warnings),
        warningCount:
          importedMeta.warningCount ?? (isRoot ? result.warnings.length : undefined),
      },
    };
    next.nodes[node.id] = node;
  }

  for (const rootId of result.rootNodeIds) {
    addChildRef(next, parentId, rootId);
  }

  next.selection = [...result.rootNodeIds];
  next.updatedAt = new Date().toISOString();
  return { doc: next, insertedIds: [...result.rootNodeIds] };
}

export function getCanvasImportBounds(result: CanvasImportResult): CanvasBounds | null {
  if (result.nodes.length === 0) return null;
  const minX = Math.min(...result.nodes.map((node) => node.bounds.x));
  const minY = Math.min(...result.nodes.map((node) => node.bounds.y));
  const maxX = Math.max(
    ...result.nodes.map((node) => node.bounds.x + node.bounds.width),
  );
  const maxY = Math.max(
    ...result.nodes.map((node) => node.bounds.y + node.bounds.height),
  );
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

  if (style.display === "flex" || style.display === "inline-flex") {
    degradationHints.push("layout_degraded");
    pushImportWarning(state, {
      code: "layout_degraded",
      message: "检测到 Figma 自动布局样式，当前按绝对定位近似导入。",
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
    const rectId = createCanvasNodeId("rect");
    state.nodes.push({
      id: rectId,
      type: "rect",
      parentId,
      title: "Imported block",
      bounds: { x: left, y: top, width, height },
      fill: normalizeColor(style.backgroundColor),
      radius: parseCssNumber(style.borderRadius) ?? 0,
      opacity: readOpacity(style.opacity),
      meta: createImportedNodeMeta(state, {
        originNodeType,
        originNodeId,
        figmaNodeType: inferFigmaNodeType(element),
        degradationHints,
      }),
    } as CanvasNode);
    localNodeIds.push(rectId);
  }

  if (directText.length > 0) {
    const fontSize = Math.max(12, parseCssNumber(style.fontSize) ?? 16);
    const textId = createCanvasNodeId("text");
    state.nodes.push({
      id: textId,
      type: "text",
      parentId,
      title: directText.slice(0, 24),
      text: directText,
      fontSize,
      fontFamily: style.fontFamily,
      color: normalizeColor(style.color) ?? "#111827",
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
      }),
    } as CanvasNode);
    localNodeIds.push(textId);
  }

  const needsGroup =
    element.children.length > 0 ||
    localNodeIds.length > 1 ||
    (localNodeIds.length === 1 && width > 0 && height > 0);
  const groupId = needsGroup ? createCanvasNodeId("group") : null;
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
        .filter((node): node is CanvasNode => Boolean(node)),
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
    const groupId = tag === "g" ? createCanvasNodeId("group") : null;
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
        .filter((node): node is CanvasNode => Boolean(node)),
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
    const id = createCanvasNodeId("rect");
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
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      radius: readNumber(element, "rx"),
      opacity,
      meta: commonMeta,
    } as CanvasNode);
    return id;
  }

  if (tag === "circle" || tag === "ellipse") {
    const id = createCanvasNodeId("ellipse");
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
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity,
      meta: commonMeta,
    } as CanvasNode);
    return id;
  }

  if (tag === "line") {
    const x1 = readNumber(element, "x1");
    const y1 = readNumber(element, "y1");
    const x2 = readNumber(element, "x2");
    const y2 = readNumber(element, "y2");
    const id = createCanvasNodeId("line");
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
      stroke: style.stroke ?? "#111827",
      strokeWidth: style.strokeWidth ?? 1,
      opacity,
      meta: commonMeta,
    } as CanvasNode);
    return id;
  }

  if (tag === "polygon" || tag === "polyline") {
    const points = readPoints(element.getAttribute("points"));
    if (points.length === 0) return null;
    const bounds = getPointBounds(points);
    const id =
      tag === "polygon"
        ? createCanvasNodeId("polygon")
        : createCanvasNodeId("path");
    if (tag === "polygon") {
      state.nodes.push({
        id,
        type: "polygon",
        parentId,
        title: element.getAttribute("id") ?? "Polygon",
        bounds,
        points: Math.max(3, points.length),
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity,
        meta: commonMeta,
      } as CanvasNode);
      return id;
    }
    state.nodes.push({
      id,
      type: "path",
      parentId,
      title: element.getAttribute("id") ?? "Polyline",
      bounds,
      d: pointsToPath(points),
      fill: "none",
      stroke: style.stroke ?? "#111827",
      strokeWidth: style.strokeWidth ?? 1,
      opacity,
      meta: commonMeta,
    } as CanvasNode);
    return id;
  }

  if (tag === "path") {
    const d = element.getAttribute("d");
    if (!d) return null;
    const bounds = getPathBounds(d);
    const id = createCanvasNodeId("path");
    state.nodes.push({
      id,
      type: "path",
      parentId,
      title: element.getAttribute("id") ?? "Path",
      bounds,
      d,
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity,
      meta: commonMeta,
    } as CanvasNode);
    return id;
  }

  if (tag === "image") {
    const href =
      element.getAttribute("href") ??
      element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (!href) return null;
    const assetId = createCanvasNodeId("asset");
    state.assets.push({
      id: assetId,
      url: href,
      mimeType: inferMimeTypeFromUrl(href),
      source: "upload",
    });
    const id = createCanvasNodeId("image");
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
    } as CanvasNode);
    return id;
  }

  if (tag === "text") {
    const x = readNumber(element, "x");
    const y = readNumber(element, "y");
    const text = extractSvgTextContent(element);
    if (!text) return null;
    const fontSize = Math.max(8, style.fontSize ?? 16);
    const id = createCanvasNodeId("text");
    state.nodes.push({
      id,
      type: "text",
      parentId,
      title: text.slice(0, 24),
      text,
      fontSize,
      fontFamily: style.fontFamily,
      color: style.fill ?? style.color ?? "#111827",
      bounds: {
        x,
        y: y - fontSize,
        width: estimateTextWidth(text, fontSize),
        height: Math.round(fontSize * 1.5),
      },
      opacity,
      meta: commonMeta,
    } as CanvasNode);
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

function getSelectionBounds(nodes: CanvasNode[]): CanvasBounds | null {
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

function addChildRef(
  doc: CucumberCanvasDocument,
  parentId: string | null,
  nodeId: string,
): void {
  if (parentId === null) {
    if (!doc.rootNodeIds.includes(nodeId)) doc.rootNodeIds.push(nodeId);
    return;
  }
  const parent = doc.nodes[parentId];
  if (
    parent &&
    "childrenOrder" in parent &&
    !parent.childrenOrder.includes(nodeId)
  ) {
    parent.childrenOrder.push(nodeId);
  }
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
