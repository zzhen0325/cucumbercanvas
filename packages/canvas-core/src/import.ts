import {
  figmaAllPagesToPenDocument,
  getFigmaPages,
  parseFigFile,
  resolveImageBlobs,
} from "@cucumber/pen-figma";
import type {
  BlendMode,
  PenComponentRef,
  PenDocument,
  PenNode,
  PenNodeStyleRefs,
  PenPage,
  PenStyleDefinition,
  PenTransformMatrix,
  VariableDefinition,
} from "@cucumber/pen-types";
import { cloneDocument, createNodeId, findNode } from "./document.js";
import { parseFigmaClipboardNative } from "./figma-native.js";
import { applyCanvasOperation } from "./operations.js";
import type {
  CanvasEffect,
  CanvasFill,
  CanvasStroke,
  StyledTextSegment,
} from "./styles.js";
import type {
  CanvasAsset,
  CanvasBounds,
  CanvasImportSource,
  CanvasImportWarningCode,
  CanvasImportedAutoLayoutMeta,
  CanvasImportedNodeMeta,
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
  innerRadius?: number;
  startAngle?: number;
  sweepAngle?: number;
  transform?: PenTransformMatrix;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  blendMode?: BlendMode;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  childrenOrder?: string[];
  text?: string | StyledTextSegment[];
  fontSize?: number;
  fontFamily?: string;
  fontPostScriptName?: string;
  d?: string;
  fillRule?: "nonzero" | "evenodd";
  points?: number;
  assetId?: string;
  src?: string;
  meta?: Record<string, unknown>;
  locked?: boolean;
  visible?: boolean;
  mask?: {
    enabled?: boolean;
    type?: "alpha" | "vector";
    sourceNodeId?: string;
    shouldBreakMaskChain?: boolean;
  };
  styleRefs?: PenNodeStyleRefs;
  componentRef?: PenComponentRef;
  variableRefs?: Record<string, unknown>;
  effects?: CanvasEffect[];
  alt?: string;
  fontWeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
  listStyle?: "none" | "ordered" | "unordered";
  indent?: number;
  hangingIndent?: number;
  baselineShift?: number;
  openTypeFeatures?: Record<string, boolean | number>;
  fontFallback?: string[];
  textAlignVertical?: "top" | "middle" | "bottom";
  underline?: boolean;
  strikethrough?: boolean;
  textCase?: "original" | "upper" | "lower" | "title";
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
  layout?: "none" | "vertical" | "horizontal";
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?:
    | "start"
    | "center"
    | "end"
    | "space_between"
    | "space_around";
  alignItems?: "start" | "center" | "end" | "baseline" | "stretch";
  clipContent?: boolean;
  x2?: number;
  y2?: number;
}

export interface CanvasImportWarning {
  code: CanvasImportWarningCode;
  message: string;
  originNodeId?: string;
  originNodeType?: string;
}

export interface CanvasImportResult {
  source: "svg" | "figma" | "image";
  sourceLabel: string;
  importSessionId: string;
  rootNodeIds: string[];
  /** ImportNode[] from SVG/HTML parsers, or PenNode[] from native Figma parser (TODO: unify) */
  nodes: (ImportNode | PenNode)[];
  assets: CanvasAsset[];
  styleDefinitions?: Record<string, PenStyleDefinition>;
  variables?: Record<string, VariableDefinition>;
  warnings: CanvasImportWarning[];
}

export interface ClipboardImportPayload {
  html?: string;
  text?: string;
  svg?: string;
  items?: Array<{ type: string; text?: string }>;
  files?: ClipboardImportFile[];
}

export interface ClipboardImportFile {
  type: string;
  name?: string;
  dataUrl?: string;
  arrayBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
}

type ParsedStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeDasharray?: number[];
  strokeDashoffset?: number;
  strokeLinecap?: CanvasStroke["cap"];
  strokeLinejoin?: CanvasStroke["join"];
  strokeMiterlimit?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
};

function parsedFillToCanvasFills(
  parsed: ParsedStyle,
  state?: Pick<SvgParseState, "paintServers">,
): CanvasFill[] | undefined {
  const c = parsed.fill ?? parsed.color;
  const paintServer = c ? resolvePaintServer(c, state) : undefined;
  if (paintServer) return [paintServer];
  return c
    ? [
        {
          type: "solid" as const,
          color: c,
          opacity: parsed.fillOpacity,
        },
      ]
    : undefined;
}

function parsedStrokeToCanvasStroke(
  parsed: ParsedStyle,
  state?: Pick<SvgParseState, "paintServers">,
): CanvasStroke | undefined {
  const c = parsed.stroke;
  if (!c) return undefined;
  const paintServer = resolvePaintServer(c, state);
  return {
    thickness: parsed.strokeWidth ?? 1,
    align: "center",
    fill: paintServer
      ? [paintServer]
      : [
          {
            type: "solid" as const,
            color: c,
            opacity: parsed.strokeOpacity,
          },
        ],
    cap: parsed.strokeLinecap,
    join: parsed.strokeLinejoin,
    dashPattern: parsed.strokeDasharray,
    dashOffset: parsed.strokeDashoffset,
  };
}

type SvgParseState = {
  importSessionId: string;
  source: "svg" | "figma" | "image";
  sourceLabel: string;
  nodes: ImportNode[];
  assets: CanvasAsset[];
  warnings: CanvasImportWarning[];
  warningKeys: Set<string>;
  cssRules: Array<{ selector: string; style: Record<string, string> }>;
  paintServers: Map<string, CanvasFill>;
  definitionElements: Map<string, Element>;
  clipPaths: Map<string, SvgClipDefinition>;
  filters: Map<string, CanvasEffect[]>;
};

type SvgClipDefinition =
  | {
      type: "rect";
      bounds: CanvasBounds;
      cornerRadius?: number;
    }
  | {
      type: "complex";
    };

const SVG_NS = "http://www.w3.org/2000/svg";

function createImportSessionId(): string {
  return `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getImportSourceMeta(source: "svg" | "figma" | "image"): {
  sourceLabel: string;
  nodeSource: CanvasImportSource;
} {
  if (source === "figma") {
    return { sourceLabel: "Figma", nodeSource: "figma-paste" };
  }
  if (source === "image") {
    return { sourceLabel: "Image", nodeSource: "image-paste" };
  }
  return { sourceLabel: "SVG", nodeSource: "svg-import" };
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

function getHtmlAutoLayoutMeta(
  style: Record<string, string>,
  element?: Element,
): CanvasImportedAutoLayoutMeta | undefined {
  const isFlex = style.display === "flex" || style.display === "inline-flex";
  const positioning = getHtmlAutoLayoutPositioning(style, element);
  const grow = parseCssNumber(style.flexGrow);
  const alignSelf = mapCssAlignSelf(style.alignSelf);
  const widthMode = getHtmlSizingMode(element, [
    "data-width-mode",
    "data-layout-width-mode",
    "data-layout-sizing-horizontal",
    "data-figma-width-mode",
  ]);
  const heightMode = getHtmlSizingMode(element, [
    "data-height-mode",
    "data-layout-height-mode",
    "data-layout-sizing-vertical",
    "data-figma-height-mode",
  ]);

  if (
    !isFlex &&
    !positioning &&
    grow === undefined &&
    !alignSelf &&
    !widthMode &&
    !heightMode
  ) {
    return undefined;
  }

  const meta: CanvasImportedAutoLayoutMeta = {
    layout: isFlex
      ? style.flexDirection === "column"
        ? "vertical"
        : "horizontal"
      : undefined,
    gap: isFlex ? parseCssNumber(style.gap) : undefined,
    padding: isFlex ? readCssPadding(style) : undefined,
    justifyContent: isFlex
      ? mapCssJustifyContent(style.justifyContent)
      : undefined,
    alignItems: isFlex ? mapCssAlignItems(style.alignItems) : undefined,
    alignSelf,
    positioning,
    grow: grow !== undefined && grow > 0 ? grow : undefined,
    widthMode,
    heightMode,
    clipContent:
      style.overflow === "hidden" || style.overflow === "clip"
        ? true
        : undefined,
  };

  return Object.values(meta).some((value) => value !== undefined)
    ? meta
    : undefined;
}

function getHtmlAutoLayoutPositioning(
  style: Record<string, string>,
  element?: Element,
): CanvasImportedAutoLayoutMeta["positioning"] {
  const raw =
    readFirstAttribute(element, [
      "data-stack-positioning",
      "data-layout-positioning",
      "data-figma-stack-positioning",
      "data-figma-layout-positioning",
    ]) ?? style.position;
  if (!raw) return undefined;
  return /absolute/i.test(raw) ? "absolute" : "auto";
}

function readCssPadding(
  style: Record<string, string>,
): CanvasImportedAutoLayoutMeta["padding"] | undefined {
  const top = parseCssNumber(style.paddingTop ?? style.padding);
  const right = parseCssNumber(style.paddingRight ?? style.padding);
  const bottom = parseCssNumber(style.paddingBottom ?? style.padding);
  const left = parseCssNumber(style.paddingLeft ?? style.padding);

  if (
    [top, right, bottom, left].every(
      (value) => value === undefined || value === 0,
    )
  ) {
    return undefined;
  }

  const safeTop = top ?? 0;
  const safeRight = right ?? 0;
  const safeBottom = bottom ?? 0;
  const safeLeft = left ?? 0;
  if (
    safeTop === safeRight &&
    safeRight === safeBottom &&
    safeBottom === safeLeft
  ) {
    return safeTop;
  }
  if (safeTop === safeBottom && safeLeft === safeRight) {
    return [safeTop, safeRight];
  }
  return [safeTop, safeRight, safeBottom, safeLeft];
}

function mapCssJustifyContent(
  value?: string,
): CanvasImportedAutoLayoutMeta["justifyContent"] {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
      return "end";
    case "space-between":
    case "space-evenly":
    case "space-around":
      return "space_between";
    default:
      return value ? "start" : undefined;
  }
}

function mapCssAlignItems(
  value?: string,
): CanvasImportedAutoLayoutMeta["alignItems"] {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
      return "end";
    case "stretch":
      return "stretch";
    case "baseline":
      return "baseline";
    default:
      return value ? "start" : undefined;
  }
}

function mapCssAlignSelf(
  value?: string,
): CanvasImportedAutoLayoutMeta["alignSelf"] {
  switch (value) {
    case "auto":
      return "auto";
    case "center":
      return "center";
    case "flex-end":
      return "end";
    case "stretch":
      return "stretch";
    case "baseline":
      return "baseline";
    case "flex-start":
      return "start";
    default:
      return value ? "start" : undefined;
  }
}

function getHtmlSizingMode(
  element: Element | undefined,
  names: string[],
): CanvasImportedAutoLayoutMeta["widthMode"] | undefined {
  const raw = readFirstAttribute(element, names);
  if (!raw) return undefined;
  if (/fill|stretch/i.test(raw)) return "fill_container";
  if (/hug|fit|resize_to_fit/i.test(raw)) return "fit_content";
  if (/fixed/i.test(raw)) return "fixed";
  return undefined;
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
  const html =
    payload.html ??
    payload.items?.find((item) => item.type === "text/html" && item.text)?.text;
  const svg =
    payload.svg ??
    payload.items?.find((item) => item.type === "image/svg+xml" && item.text)
      ?.text ??
    payload.items?.find((item) => item.type === "text/svg" && item.text)?.text;
  const text =
    payload.text ??
    payload.items?.find((item) => item.type === "text/plain" && item.text)
      ?.text;
  const figmaHtml =
    html ??
    payload.items?.find(
      (item) => item.text && isLikelyFigmaClipboardHtml(item.text),
    )?.text;
  const rasterFile = payload.files?.find(isRasterClipboardFile);
  const figmaFile = payload.files?.find(isFigmaFileImport);
  let figmaNativeDecodeError: string | undefined;

  if (figmaHtml && isLikelyFigmaClipboardHtml(figmaHtml)) {
    try {
      const nativeResult = parseFigmaClipboardNative(figmaHtml);
      if (nativeResult) {
        const importSessionId = createImportSessionId();
        const nodes = nativeResult.nodes.map((node) =>
          isNativePenNode(node)
            ? attachImportMetaToPenNodeTree(
                node,
                importSessionId,
                nativeResult.warnings,
              )
            : node,
        );
        return {
          source: "figma",
          sourceLabel: "Figma",
          importSessionId,
          rootNodeIds: nativeResult.rootNodeIds,
          nodes,
          assets: nativeResult.assets,
          styleDefinitions: nativeResult.styleDefinitions,
          warnings: nativeResult.warnings,
        };
      }
    } catch (error) {
      figmaNativeDecodeError =
        error instanceof Error ? error.message : String(error);
      // Keep walking the explicit MIME priority list before falling back to lossy HTML parsing.
    }
  }
  if (figmaFile) {
    return parseFigmaFileImport(figmaFile);
  }
  if (svg && isLikelySvgMarkup(svg)) {
    return parseSvgMarkup(svg, { source: "svg" });
  }
  if (rasterFile) {
    return parseRasterClipboardFile(rasterFile);
  }
  if (html && isLikelySvgMarkup(html)) {
    return parseSvgMarkup(html, { source: "svg" });
  }
  if (text && isLikelySvgMarkup(text)) {
    return parseSvgMarkup(text, { source: "svg" });
  }
  if (figmaHtml && isLikelyFigmaClipboardHtml(figmaHtml)) {
    const figmaResult = parseFigmaClipboardHtml(figmaHtml);
    if (figmaResult && figmaNativeDecodeError) {
      figmaResult.warnings.unshift({
        code: "partial_fidelity",
        message: `Figma 原生剪贴板数据未能解码，已继续使用 HTML/SVG fallback。原因：${figmaNativeDecodeError}`,
      });
    }
    if (figmaResult) return figmaResult;
  }
  return null;
}

function isRasterClipboardFile(file: ClipboardImportFile): boolean {
  return /^(image\/png|image\/jpe?g|image\/webp|image\/gif)$/i.test(file.type);
}

function isFigmaFileImport(file: ClipboardImportFile): boolean {
  return (
    Boolean(file.arrayBuffer) &&
    (/\.fig$/i.test(file.name ?? "") || /figma|fig/i.test(file.type))
  );
}

function parseFigmaFileImport(file: ClipboardImportFile): CanvasImportResult {
  if (!file.arrayBuffer) {
    throw new Error(
      `Figma 文件 ${file.name ?? file.type} 缺少可解析的二进制内容。`,
    );
  }

  const importSessionId = createImportSessionId();
  const fileName = file.name ?? "Figma import";
  const decoded = parseFigFile(file.arrayBuffer);
  const pages = getFigmaPages(decoded);
  const converted = figmaAllPagesToPenDocument(decoded, fileName, "preserve");
  const rootNodes = materializeFigmaDocumentRoots(converted.document);
  const unresolvedBefore = countUnresolvedImageRefs(rootNodes);
  const resolvedImageCount = resolveImageBlobs(
    rootNodes,
    converted.imageBlobs,
    decoded.imageFiles,
  );
  const unresolvedAfter = countUnresolvedImageRefs(rootNodes);
  const warningMessages = [...converted.warnings];
  if (unresolvedAfter > 0) {
    warningMessages.push(
      `Figma 文件中仍有 ${unresolvedAfter} 个图片引用缺少可解析的二进制内容，已保留诊断占位。`,
    );
  }
  const warnings = warningMessages.map(
    (message): CanvasImportWarning => ({
      code: "partial_fidelity",
      message,
    }),
  );
  const nodes = rootNodes.map((node) =>
    attachImportMetaToPenNodeTree(node, importSessionId, warnings),
  );

  console.info("[canvas-import] figma.file.decoded", {
    fileName,
    nodeChangeCount: decoded.nodeChanges.length,
    pageCount: pages.length,
    pageNames: pages.map((page) => page.name),
    imageFileCount: decoded.imageFiles.size,
    imageBlobCount: converted.imageBlobs.size,
    resolvedImageCount,
    unresolvedImageRefsBefore: unresolvedBefore,
    unresolvedImageRefsAfter: unresolvedAfter,
    warningCount: warnings.length,
    converterWarnings: converted.warnings,
    rootCount: nodes.length,
  });

  return {
    source: "figma",
    sourceLabel: "Figma",
    importSessionId,
    rootNodeIds: nodes.map((node) => node.id),
    nodes,
    assets: [],
    styleDefinitions: converted.document.styleDefinitions,
    warnings,
  };
}

const FIGMA_PAGE_GROUP_GAP = 160;

function materializeFigmaDocumentRoots(document: PenDocument): PenNode[] {
  const pages = document.pages ?? [];
  if (pages.length === 0) {
    return document.children ?? [];
  }
  if (pages.length === 1) {
    return pages[0]?.children ?? [];
  }

  const roots: PenNode[] = [];
  let cursorX = 0;
  for (const page of pages) {
    const bounds = getPenPageBounds(page);
    const children = page.children.map((child) =>
      offsetPenNodeRoot(child, -bounds.x, -bounds.y),
    );
    roots.push({
      id: createNodeId("figma_page_group"),
      type: "group",
      name: page.name,
      x: cursorX,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      children,
    } as PenNode);
    cursorX += bounds.width + FIGMA_PAGE_GROUP_GAP;
  }
  return roots;
}

function getPenPageBounds(page: PenPage): CanvasBounds {
  if (page.children.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const bounds = page.children.map(getPenNodeLocalBounds);
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getPenNodeLocalBounds(node: PenNode): CanvasBounds {
  const sized = node as PenNode & { width?: unknown; height?: unknown };
  return {
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: typeof sized.width === "number" ? sized.width : 100,
    height: typeof sized.height === "number" ? sized.height : 100,
  };
}

function countUnresolvedImageRefs(nodes: PenNode[]): number {
  let count = 0;
  const visit = (node: PenNode): void => {
    const record = node as PenNode & {
      fill?: unknown;
      fills?: unknown;
      stroke?: { fill?: unknown };
      children?: unknown;
    };
    if (node.type === "image" && isUnresolvedImageUrl(node.src)) {
      count += 1;
    }
    count += countUnresolvedImageFills(record.fill);
    count += countUnresolvedImageFills(record.fills);
    count += countUnresolvedImageFills(record.stroke?.fill);
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return count;
}

function countUnresolvedImageFills(fills: unknown): number {
  if (!Array.isArray(fills)) return 0;
  let count = 0;
  for (const item of fills) {
    if (item?.type === "image" && isUnresolvedImageUrl(item.url)) {
      count += 1;
    }
  }
  return count;
}

function isUnresolvedImageUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    (url.startsWith("__blob:") || url.startsWith("__hash:"))
  );
}

function parseRasterClipboardFile(
  file: ClipboardImportFile,
): CanvasImportResult {
  if (!file.dataUrl) {
    throw new Error(
      `剪贴板图片 ${file.name ?? file.type} 缺少可导入的数据内容。`,
    );
  }

  const importSessionId = createImportSessionId();
  const assetId = createNodeId("asset");
  const imageId = createNodeId("image");
  const width = Math.max(1, file.width ?? 320);
  const height = Math.max(1, file.height ?? 240);
  const state: SvgParseState = {
    importSessionId,
    source: "image",
    sourceLabel: "Image",
    nodes: [],
    assets: [],
    warnings: [],
    warningKeys: new Set<string>(),
    cssRules: [],
    paintServers: new Map<string, CanvasFill>(),
    definitionElements: new Map<string, Element>(),
    clipPaths: new Map<string, SvgClipDefinition>(),
    filters: new Map<string, CanvasEffect[]>(),
  };

  return {
    source: "image",
    sourceLabel: "Image",
    importSessionId,
    rootNodeIds: [imageId],
    assets: [
      {
        id: assetId,
        url: file.dataUrl,
        mimeType: file.type,
        name: file.name,
        width: file.width,
        height: file.height,
        source: "upload",
      },
    ],
    nodes: [
      {
        id: imageId,
        type: "image",
        parentId: null,
        title: file.name ?? "Pasted image",
        bounds: { x: 0, y: 0, width, height },
        assetId,
        src: file.dataUrl,
        alt: file.name,
        meta: createImportedNodeMeta(state, {
          originNodeType: file.type,
          originNodeId: file.name,
        }),
      },
    ],
    warnings: [],
  };
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
    cssRules: [],
    paintServers: new Map<string, CanvasFill>(),
    definitionElements: new Map<string, Element>(),
    clipPaths: new Map<string, SvgClipDefinition>(),
    filters: new Map<string, CanvasEffect[]>(),
  };
  collectSvgDefinitions(svg, state);
  const inherited = readElementStyle(svg, {}, state);
  const roots: string[] = [];
  const rootTransform = multiplySvgTransform(
    getSvgViewBoxTransform(svg),
    parseSvgTransform(svg.getAttribute("transform")),
  );

  for (const child of Array.from(svg.children)) {
    const parsed = parseSvgElement(
      child,
      null,
      inherited,
      state,
      rootTransform,
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

  if (
    result.styleDefinitions &&
    Object.keys(result.styleDefinitions).length > 0
  ) {
    next = {
      ...next,
      styleDefinitions: {
        ...(next.styleDefinitions ?? {}),
        ...structuredClone(result.styleDefinitions),
      },
    };
  }

  const importedVariables = collectImportedVariableDefinitions(result);
  if (Object.keys(importedVariables).length > 0) {
    next = {
      ...next,
      variables: mergeImportedVariables(next.variables, importedVariables),
    };
  }

  // Detect node format: parser ImportNode has import-only fields such as
  // bounds/title/childrenOrder; already-normalized PenNode trees do not.
  const firstNode = result.nodes[0];
  const isNative =
    firstNode &&
    !("bounds" in firstNode) &&
    !("title" in firstNode) &&
    !("childrenOrder" in firstNode);

  if (isNative) {
    // Native Figma path: nodes are already PenNode tree
    const nativeNodes = result.nodes as PenNode[];
    const placementStats = {
      source: result.source,
      rootCount: result.rootNodeIds.length,
      nodeCount: nativeNodes.reduce(
        (count, node) => count + countPenNodeTree(node),
        0,
      ),
      transformTranslationIgnoredForRender: nativeNodes.reduce(
        (count, node) => count + countTransformTranslationNodes(node),
        0,
      ),
      coordinateContract: "x-y-canonical",
      offsetX,
      offsetY,
      maxOffset: Math.max(Math.abs(offsetX), Math.abs(offsetY)),
    };
    console.info("[canvas-import] native-placement.offset", placementStats);

    for (const rootId of result.rootNodeIds) {
      const penNode = nativeNodes.find((n) => n.id === rootId);
      if (!penNode) continue;
      const nodeWithOffset = offsetPenNodeRoot(penNode, offsetX, offsetY);
      next = applyCanvasOperation(next, {
        type: "insertNode",
        node: nodeWithOffset,
        parentId: targetParentId,
      });
    }
    return { doc: next, insertedIds: [...result.rootNodeIds] };
  }

  // SVG/HTML path: convert ImportNode flat list → PenNode tree
  const importNodes = result.nodes as ImportNode[];
  const nodeMap = new Map<string, PenNode>();
  const importNodeMap = new Map<string, ImportNode>();
  const absoluteOriginMap = new Map<string, { x: number; y: number }>();
  for (const imported of importNodes) {
    const penNode = importNodeToPenNode(imported, offsetX, offsetY, result);
    nodeMap.set(penNode.id, penNode);
    importNodeMap.set(imported.id, imported);
    absoluteOriginMap.set(imported.id, {
      x: penNode.x ?? 0,
      y: penNode.y ?? 0,
    });
  }

  const materializeImportTree = (
    nodeId: string,
    parentId: string | null,
  ): PenNode | null => {
    const sourceNode = nodeMap.get(nodeId);
    if (!sourceNode) return null;
    const imported = importNodeMap.get(nodeId);
    let penNode = structuredClone(sourceNode) as PenNode;

    if (parentId) {
      const parentOrigin = absoluteOriginMap.get(parentId);
      const nodeOrigin = absoluteOriginMap.get(nodeId);
      if (parentOrigin && nodeOrigin) {
        penNode = makeNodeParentRelative(penNode, nodeOrigin, parentOrigin);
      }
    }

    if (
      imported?.childrenOrder?.length &&
      "children" in penNode &&
      Array.isArray((penNode as { children?: unknown }).children)
    ) {
      const children = imported.childrenOrder
        .map((childId) => materializeImportTree(childId, nodeId))
        .filter((child): child is PenNode => Boolean(child));
      penNode = { ...penNode, children } as PenNode;
    }

    return markImportCoordinatesParentRelative(penNode);
  };

  // Insert root nodes via applyCanvasOperation
  const insertedIds: string[] = [];
  for (const rootId of result.rootNodeIds) {
    const penNode = materializeImportTree(rootId, null);
    if (!penNode) continue;
    next = applyCanvasOperation(next, {
      type: "insertNode",
      node: penNode,
      parentId: targetParentId,
    });
    insertedIds.push(penNode.id);
  }

  return { doc: next, insertedIds };
}

function makeNodeParentRelative(
  node: PenNode,
  nodeOrigin: { x: number; y: number },
  parentOrigin: { x: number; y: number },
): PenNode {
  const record = node as PenNode & { x2?: number; y2?: number };
  return {
    ...node,
    x: nodeOrigin.x - parentOrigin.x,
    y: nodeOrigin.y - parentOrigin.y,
    ...(record.x2 !== undefined ? { x2: record.x2 - parentOrigin.x } : {}),
    ...(record.y2 !== undefined ? { y2: record.y2 - parentOrigin.y } : {}),
  } as PenNode;
}

function markImportCoordinatesParentRelative(node: PenNode): PenNode {
  const record = node as PenNode & {
    meta?: Record<string, unknown>;
    children?: PenNode[];
  };
  return {
    ...node,
    meta: {
      ...(record.meta ?? {}),
      importCoordinateMode: "parent-relative",
    },
    ...("children" in node && Array.isArray(record.children)
      ? {
          children: record.children.map((child) =>
            markImportCoordinatesParentRelative(child),
          ),
        }
      : {}),
  } as unknown as PenNode;
}

type ImportedVariableCandidate = {
  id: string;
  property: string;
  rawRef: unknown;
  value?: VariableDefinition["value"];
  type?: VariableDefinition["type"];
};

function collectImportedVariableDefinitions(
  result: CanvasImportResult,
): Record<string, VariableDefinition> {
  const variables: Record<string, VariableDefinition> = {
    ...(result.variables ?? {}),
  };

  for (const definition of Object.values(result.styleDefinitions ?? {})) {
    addVariableCandidates(
      variables,
      extractVariableCandidates(
        definition.variableRefs,
        getStyleDefinitionVariableValue(definition),
      ),
    );
  }

  for (const node of result.nodes) {
    visitImportedNodeForVariables(node, variables);
  }

  return variables;
}

function mergeImportedVariables(
  existing: PenDocument["variables"],
  imported: Record<string, VariableDefinition>,
): Record<string, VariableDefinition> {
  const merged: Record<string, VariableDefinition> = { ...(existing ?? {}) };
  for (const [name, definition] of Object.entries(imported)) {
    const current = merged[name];
    if (!current || (current.unresolved === true && !definition.unresolved)) {
      merged[name] = structuredClone(definition);
    }
  }
  return merged;
}

function visitImportedNodeForVariables(
  node: ImportNode | PenNode,
  variables: Record<string, VariableDefinition>,
): void {
  const record = node as (ImportNode | PenNode) & {
    variableRefs?: Record<string, unknown>;
    fill?: CanvasFill[];
    fills?: CanvasFill[];
    stroke?: CanvasStroke;
    effects?: CanvasEffect[];
    children?: PenNode[];
  };
  const fills = record.fills ?? record.fill;
  addVariableCandidates(
    variables,
    extractVariableCandidates(record.variableRefs, {
      fill: firstSolidFillColor(fills),
      stroke: firstSolidFillColor(record.stroke?.fill),
      effect: firstEffectColor(record.effects),
    }),
  );

  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      visitImportedNodeForVariables(child, variables);
    }
  }
}

function addVariableCandidates(
  variables: Record<string, VariableDefinition>,
  candidates: ImportedVariableCandidate[],
): void {
  for (const candidate of candidates) {
    const name = importedVariableName(candidate.id);
    if (variables[name]) continue;
    variables[name] = {
      type:
        candidate.value !== undefined
          ? (candidate.type ?? inferVariableType(candidate))
          : "string",
      value: candidate.value ?? candidate.id,
      source: "figma",
      id: candidate.id,
      name,
      property: candidate.property,
      unresolved: candidate.value === undefined,
      rawRef: candidate.rawRef,
    };
  }
}

function extractVariableCandidates(
  refs: unknown,
  values: { fill?: string; stroke?: string; effect?: string },
  path: string[] = [],
): ImportedVariableCandidate[] {
  if (!refs) return [];
  if (typeof refs === "string") {
    return [makeVariableCandidate(refs, path.join("."), refs, values)];
  }
  if (Array.isArray(refs)) {
    return refs.flatMap((item, index) =>
      extractVariableCandidates(item, values, [...path, String(index)]),
    );
  }
  if (typeof refs === "object") {
    const record = refs as Record<string, unknown>;
    if (typeof record.id === "string") {
      return [makeVariableCandidate(record.id, path.join("."), refs, values)];
    }
    if (typeof record.variableId === "string") {
      return [
        makeVariableCandidate(record.variableId, path.join("."), refs, values),
      ];
    }
    return Object.entries(record).flatMap(([key, value]) =>
      extractVariableCandidates(value, values, [...path, key]),
    );
  }
  return [];
}

function makeVariableCandidate(
  id: string,
  property: string,
  rawRef: unknown,
  values: { fill?: string; stroke?: string; effect?: string },
): ImportedVariableCandidate {
  const lowerProperty = property.toLowerCase();
  const value = lowerProperty.includes("stroke")
    ? values.stroke
    : lowerProperty.includes("effect") || lowerProperty.includes("shadow")
      ? values.effect
      : lowerProperty.includes("fill") || lowerProperty.includes("paint")
        ? values.fill
        : undefined;
  return {
    id,
    property,
    rawRef,
    ...(value ? { value, type: "color" as const } : {}),
  };
}

function getStyleDefinitionVariableValue(definition: PenStyleDefinition): {
  fill?: string;
  stroke?: string;
  effect?: string;
} {
  return {
    fill: firstSolidFillColor(definition.fill),
    stroke: firstSolidFillColor(definition.strokeFill),
    effect: firstEffectColor(definition.effects),
  };
}

function firstSolidFillColor(fills?: CanvasFill[]): string | undefined {
  const fill = fills?.find(
    (candidate) =>
      candidate.visible !== false &&
      candidate.type === "solid" &&
      typeof candidate.color === "string",
  );
  return fill?.type === "solid" ? fill.color : undefined;
}

function firstEffectColor(effects?: CanvasEffect[]): string | undefined {
  const effect = effects?.find(
    (candidate) =>
      candidate.visible !== false &&
      candidate.type === "shadow" &&
      typeof candidate.color === "string",
  );
  return effect?.type === "shadow" ? effect.color : undefined;
}

function inferVariableType(
  candidate: ImportedVariableCandidate,
): VariableDefinition["type"] {
  const property = candidate.property.toLowerCase();
  if (
    property.includes("fill") ||
    property.includes("stroke") ||
    property.includes("paint") ||
    property.includes("color") ||
    property.includes("shadow")
  ) {
    return "color";
  }
  if (
    property.includes("opacity") ||
    property.includes("radius") ||
    property.includes("spacing") ||
    property.includes("size") ||
    property.includes("width") ||
    property.includes("height")
  ) {
    return "number";
  }
  return "string";
}

function importedVariableName(id: string): string {
  const sanitized = id.replace(/[^A-Za-z0-9_.-]/g, "-");
  return `figma.${sanitized}`;
}

function isNativePenNode(node: ImportNode | PenNode): node is PenNode {
  return (
    !("bounds" in node) && !("title" in node) && !("childrenOrder" in node)
  );
}

function attachImportMetaToPenNodeTree(
  node: PenNode,
  importSessionId: string,
  warnings: CanvasImportWarning[],
): PenNode {
  const record = node as PenNode & {
    meta?: Record<string, unknown>;
    children?: PenNode[];
  };
  const meta = {
    ...(record.meta ?? {}),
    source: "figma-paste",
    originNodeType: record.meta?.originNodeType ?? "figma-native",
    importSessionId,
    importSourceLabel: "Figma",
    degradationHints:
      record.meta?.degradationHints ?? getWarningCodes(warnings),
    warningCount: record.meta?.warningCount ?? (warnings.length || undefined),
  };
  return {
    ...node,
    meta,
    ...("children" in node && Array.isArray(record.children)
      ? {
          children: record.children.map((child) =>
            attachImportMetaToPenNodeTree(child, importSessionId, warnings),
          ),
        }
      : {}),
  } as unknown as PenNode;
}

function offsetPenNodeRoot(
  node: PenNode,
  offsetX: number,
  offsetY: number,
): PenNode {
  const record = node as PenNode & {
    x2?: number;
    y2?: number;
  };
  // Native PenNode children are parent-relative. Moving descendants here would
  // be applied a second time by the renderer and can clip Figma frame contents.
  return {
    ...node,
    x: (node.x ?? 0) + offsetX,
    y: (node.y ?? 0) + offsetY,
    ...(record.x2 !== undefined ? { x2: record.x2 + offsetX } : {}),
    ...(record.y2 !== undefined ? { y2: record.y2 + offsetY } : {}),
  } as PenNode;
}

function countPenNodeTree(node: PenNode): number {
  const children = "children" in node ? node.children : undefined;
  if (!Array.isArray(children)) return 1;
  return (
    1 + children.reduce((count, child) => count + countPenNodeTree(child), 0)
  );
}

function countTransformTranslationNodes(node: PenNode): number {
  const transform = (
    node as PenNode & {
      transform?: { m02?: number; m12?: number };
    }
  ).transform;
  const hasTranslation =
    typeof transform?.m02 === "number" || typeof transform?.m12 === "number";
  const children = "children" in node ? node.children : undefined;
  const childCount = Array.isArray(children)
    ? children.reduce(
        (count, child) => count + countTransformTranslationNodes(child),
        0,
      )
    : 0;
  return (hasTranslation ? 1 : 0) + childCount;
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
  const warningCodes = getWarningCodes(result.warnings);
  const exposeEmptyWarningMeta = result.source !== "image";
  const degradationHints =
    importedMeta.degradationHints ??
    (warningCodes.length > 0
      ? warningCodes
      : exposeEmptyWarningMeta
        ? []
        : undefined);
  const warningCount =
    importedMeta.warningCount ??
    (isRoot
      ? result.warnings.length > 0
        ? result.warnings.length
        : exposeEmptyWarningMeta
          ? 0
          : undefined
      : undefined);
  const meta: Record<string, unknown> = {
    ...importedMeta,
    source: getImportSourceMeta(result.source).nodeSource,
    importSessionId: result.importSessionId,
    importSourceLabel: result.sourceLabel,
  };
  if (degradationHints !== undefined) {
    meta.degradationHints = degradationHints;
  }
  if (warningCount !== undefined) {
    meta.warningCount = warningCount;
  }

  const bounds = getImportNodeBounds(imported);
  const executableLayout = getExecutableAutoLayoutProps(
    importedMeta.autoLayout as CanvasImportedAutoLayoutMeta | undefined,
  );
  const base = {
    id: imported.id,
    type: normalizeImportedNodeType(imported.type) as PenNode["type"],
    name: imported.title,
    x: bounds.x + offsetX,
    y: bounds.y + offsetY,
    rotation: bounds.rotation,
    transform: imported.transform,
    scaleX: imported.scaleX,
    scaleY: imported.scaleY,
    skewX: imported.skewX,
    skewY: imported.skewY,
    blendMode: imported.blendMode,
    flipX: imported.flipX,
    flipY: imported.flipY,
    width: executableLayout.width ?? bounds.width,
    height: executableLayout.height ?? bounds.height,
    role: executableLayout.role,
    opacity: imported.opacity,
    visible: imported.visible,
    locked: imported.locked,
    mask: imported.mask,
    styleRefs:
      imported.styleRefs ??
      (importedMeta.figmaStyleRefs as PenNodeStyleRefs | undefined),
    componentRef:
      imported.componentRef ??
      (importedMeta.figmaComponentRef as PenComponentRef | undefined),
    variableRefs:
      imported.variableRefs ??
      (importedMeta.figmaVariableRefs as Record<string, unknown> | undefined),
    cornerRadius: imported.cornerRadius,
    fill: imported.fills,
    stroke: imported.stroke,
    effects: imported.effects,
    meta,
  };

  // Type-specific fields for PenNode union members
  switch (imported.type) {
    case "text":
      return {
        ...base,
        type: "text" as const,
        content: imported.text ?? "",
        fontFamily: imported.fontFamily,
        fontPostScriptName: imported.fontPostScriptName,
        fontSize: imported.fontSize,
        fontWeight: imported.fontWeight,
        fontStyle: imported.fontStyle,
        letterSpacing: imported.letterSpacing,
        lineHeight: imported.lineHeight,
        paragraphSpacing: imported.paragraphSpacing,
        listStyle: imported.listStyle,
        indent: imported.indent,
        hangingIndent: imported.hangingIndent,
        baselineShift: imported.baselineShift,
        openTypeFeatures: imported.openTypeFeatures,
        fontFallback: imported.fontFallback,
        textAlign: imported.textAlign,
        textAlignVertical: imported.textAlignVertical,
        underline: imported.underline,
        strikethrough: imported.strikethrough,
        textCase: imported.textCase,
        textGrowth: imported.textGrowth,
      } as unknown as PenNode;
    case "frame":
      return {
        ...base,
        type: "frame" as const,
        layout: imported.layout ?? executableLayout.layout,
        gap: imported.gap,
        padding: imported.padding,
        justifyContent: imported.justifyContent,
        alignItems: imported.alignItems,
        clipContent: imported.clipContent,
        children: [],
      } as unknown as PenNode;
    case "group":
      return {
        ...base,
        type: "group" as const,
        layout: imported.layout ?? executableLayout.layout,
        gap: imported.gap,
        padding: imported.padding,
        justifyContent: imported.justifyContent,
        alignItems: imported.alignItems,
        clipContent: imported.clipContent,
        children: [],
      } as unknown as PenNode;
    case "rect":
    case "rectangle":
      return { ...base, type: "rectangle" as const } as unknown as PenNode;
    case "ellipse":
      return {
        ...base,
        type: "ellipse" as const,
        innerRadius: imported.innerRadius,
        startAngle: imported.startAngle,
        sweepAngle: imported.sweepAngle,
      } as unknown as PenNode;
    case "path":
      return {
        ...base,
        type: "path" as const,
        d: imported.d ?? "",
        fillRule: imported.fillRule,
      } as unknown as PenNode;
    case "polygon":
      return {
        ...base,
        type: "polygon" as const,
        polygonCount: imported.points ?? 3,
      } as unknown as PenNode;
    case "line":
      return {
        ...base,
        type: "line" as const,
        x2: imported.x2 !== undefined ? imported.x2 + offsetX : undefined,
        y2: imported.y2 !== undefined ? imported.y2 + offsetY : undefined,
      } as unknown as PenNode;
    case "image":
      return {
        ...base,
        type: "image" as const,
        assetId: imported.assetId,
        src: imported.src ?? "",
      } as unknown as PenNode;
    case "videoEmbed":
      return {
        ...base,
        type: "videoEmbed" as const,
        src: imported.src ?? "",
      } as unknown as PenNode;
    default:
      return base as unknown as PenNode;
  }
}

function getExecutableAutoLayoutProps(
  autoLayout: CanvasImportedAutoLayoutMeta | undefined,
): {
  width?: "fit_content" | "fill_container";
  height?: "fit_content" | "fill_container";
  layout?: "vertical" | "horizontal";
  role?: "overlay";
} {
  if (!autoLayout) {
    return {};
  }
  return {
    width:
      autoLayout.widthMode === "fit_content" ||
      autoLayout.widthMode === "fill_container"
        ? autoLayout.widthMode
        : undefined,
    height:
      autoLayout.heightMode === "fit_content" ||
      autoLayout.heightMode === "fill_container"
        ? autoLayout.heightMode
        : undefined,
    layout: autoLayout.layout,
    role: autoLayout.positioning === "absolute" ? "overlay" : undefined,
  };
}

function normalizeImportedNodeType(type: string): string {
  return type === "rect" ? "rectangle" : type;
}

function getImportNodeBounds(imported: ImportNode): CanvasBounds {
  if (imported.bounds) {
    return imported.bounds;
  }
  const legacy = imported as unknown as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  return {
    x: legacy.x ?? 0,
    y: legacy.y ?? 0,
    width: legacy.width ?? 1,
    height: legacy.height ?? 1,
  };
}

export function getCanvasImportBounds(
  result: CanvasImportResult,
): CanvasBounds | null {
  if (result.nodes.length === 0) return null;
  const nodes = result.nodes;
  // Handle both ImportNode (has `bounds`) and PenNode (has flat x/y/width/height)
  const getBounds = (node: ImportNode | PenNode): CanvasBounds => {
    if ("bounds" in node) {
      return (node as ImportNode).bounds;
    }
    const pen = node as PenNode;
    const sized = pen as PenNode & { width?: unknown; height?: unknown };
    return {
      x: pen.x ?? 0,
      y: pen.y ?? 0,
      width: typeof sized.width === "number" ? sized.width : 100,
      height: typeof sized.height === "number" ? sized.height : 100,
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
      message:
        "当前 Figma 剪贴板按内嵌 SVG 回退导入，复杂组件与自动布局可能无法完整保真。",
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
    cssRules: [],
    paintServers: new Map<string, CanvasFill>(),
    definitionElements: new Map<string, Element>(),
    clipPaths: new Map<string, SvgClipDefinition>(),
    filters: new Map<string, CanvasEffect[]>(),
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
  const autoLayout = getHtmlAutoLayoutMeta(style, element);
  const componentRef = getHtmlFigmaComponentRef(element);

  if (autoLayout) {
    degradationHints.push("layout_degraded");
    pushImportWarning(state, {
      code: "layout_degraded",
      message:
        "检测到 Figma 自动布局样式，已保留布局元数据，当前画布仍按静态几何近似导入。",
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
  if (componentRef) {
    degradationHints.push("component_editability_limited");
    pushImportWarning(state, {
      code: "component_editability_limited",
      message:
        "检测到 Figma 组件或实例元数据，已保留最小引用语义；当前 HTML 回退仍以内联可编辑结构呈现。",
      originNodeId,
      originNodeType,
    });
  } else if (hasComponentLikeMetadata(element)) {
    degradationHints.push("component_metadata_dropped");
    pushImportWarning(state, {
      code: "component_metadata_dropped",
      message:
        "检测到组件或实例元数据，当前仅保留可编辑几何结构，不保留组件引用语义。",
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
      componentRef,
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
      componentRef,
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
      componentRef,
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
  inheritedTransform: SvgTransform = IDENTITY_TRANSFORM,
): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "defs" || tag === "style" || tag === "title" || tag === "desc") {
    return null;
  }
  const style = readElementStyle(element, inherited, state);
  const transform = multiplySvgTransform(
    inheritedTransform,
    parseSvgTransform(element.getAttribute("transform")),
  );
  const clipDefinition = resolveSvgClipDefinition(element, state, transform);
  const effects = resolveSvgFilterEffects(element, state);

  if (tag === "use") {
    const href = readSvgHref(element);
    const referenced = href ? state.definitionElements.get(href) : undefined;
    if (!referenced) {
      pushImportWarning(state, {
        code: "partial_fidelity",
        message: "检测到 SVG <use> 引用，但未找到对应 defs 节点，已跳过。",
        originNodeId: element.getAttribute("id") ?? undefined,
        originNodeType: tag,
      });
      return null;
    }
    const useTransform = multiplySvgTransform(transform, {
      ...IDENTITY_TRANSFORM,
      e: readNumber(element, "x"),
      f: readNumber(element, "y"),
    });
    return parseSvgElement(referenced, parentId, style, state, useTransform);
  }

  if (element.hasAttribute("mask")) {
    pushImportWarning(state, {
      code: "partial_fidelity",
      message:
        "检测到 SVG mask 效果，当前渲染器暂未支持 mask，已保留可编辑几何并记录降级。",
      originNodeId: element.getAttribute("id") ?? undefined,
      originNodeType: tag,
    });
  }
  if (clipDefinition && tag !== "g" && tag !== "svg") {
    pushImportWarning(state, {
      code: "partial_fidelity",
      message:
        "检测到非容器 SVG clipPath，当前仅对 group/svg 简单 rect 裁剪映射为 frame clipContent。",
      originNodeId: element.getAttribute("id") ?? undefined,
      originNodeType: tag,
    });
  }

  if (tag === "g" || tag === "svg") {
    const groupId =
      tag === "g"
        ? createNodeId(clipDefinition?.type === "rect" ? "frame" : "group")
        : null;
    const childParentId = groupId ?? parentId;
    const childIds: string[] = [];
    for (const child of Array.from(element.children)) {
      const parsed = parseSvgElement(
        child,
        childParentId,
        style,
        state,
        transform,
      );
      if (parsed) childIds.push(parsed);
    }
    if (!groupId) return null;
    if (childIds.length === 0) return null;
    const childBounds = getSelectionBounds(
      childIds
        .map((childId) => state.nodes.find((node) => node.id === childId))
        .filter((node): node is ImportNode => Boolean(node)),
    );
    const bounds =
      clipDefinition?.type === "rect" ? clipDefinition.bounds : childBounds;
    if (!bounds) return null;
    state.nodes.push({
      id: groupId,
      type: clipDefinition?.type === "rect" ? "frame" : "group",
      parentId,
      title: element.getAttribute("id") ?? "Imported group",
      bounds,
      childrenOrder: childIds,
      cornerRadius:
        clipDefinition?.type === "rect"
          ? clipDefinition.cornerRadius
          : undefined,
      clipContent: clipDefinition?.type === "rect" ? true : undefined,
      effects,
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
        ...transformBounds(
          {
            x: readNumber(element, "x"),
            y: readNumber(element, "y"),
            width: Math.max(1, readNumber(element, "width")),
            height: Math.max(1, readNumber(element, "height")),
          },
          transform,
        ),
      },
      fills: parsedFillToCanvasFills(style, state),
      stroke: parsedStrokeToCanvasStroke(style, state),
      cornerRadius: readNumber(element, "rx") || undefined,
      opacity,
      effects,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "circle" || tag === "ellipse") {
    const id = createNodeId("ellipse");
    const cx = readNumber(element, "cx");
    const cy = readNumber(element, "cy");
    const rx =
      tag === "circle" ? readNumber(element, "r") : readNumber(element, "rx");
    const ry =
      tag === "circle" ? readNumber(element, "r") : readNumber(element, "ry");
    state.nodes.push({
      id,
      type: "ellipse",
      parentId,
      title: element.getAttribute("id") ?? "Ellipse",
      bounds: {
        ...transformBounds(
          {
            x: cx - rx,
            y: cy - ry,
            width: Math.max(1, rx * 2),
            height: Math.max(1, ry * 2),
          },
          transform,
        ),
      },
      fills: parsedFillToCanvasFills(style, state),
      stroke: parsedStrokeToCanvasStroke(style, state),
      opacity,
      effects,
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
    const p1 = transformPoint({ x: x1, y: y1 }, transform);
    const p2 = transformPoint({ x: x2, y: y2 }, transform);
    state.nodes.push({
      id,
      type: "line",
      parentId,
      title: element.getAttribute("id") ?? "Line",
      bounds: {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.max(1, Math.abs(p2.x - p1.x)),
        height: Math.max(1, Math.abs(p2.y - p1.y)),
      },
      stroke: {
        thickness: style.strokeWidth ?? 1,
        align: "center",
        fill: parsedStrokeToCanvasStroke(style, state)?.fill ?? [
          { type: "solid", color: style.stroke ?? "#111827" },
        ],
        cap: style.strokeLinecap,
        join: style.strokeLinejoin,
        dashPattern: style.strokeDasharray,
        dashOffset: style.strokeDashoffset,
      },
      x2: p2.x,
      y2: p2.y,
      opacity,
      effects,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "polygon" || tag === "polyline") {
    const points = readPoints(element.getAttribute("points"));
    if (points.length === 0) return null;
    const transformedPoints = points.map((point) =>
      transformPoint(point, transform),
    );
    const bounds = getPointBounds(transformedPoints);
    const id =
      tag === "polygon" ? createNodeId("polygon") : createNodeId("path");
    if (tag === "polygon") {
      state.nodes.push({
        id,
        type: "polygon",
        parentId,
        title: element.getAttribute("id") ?? "Polygon",
        bounds,
        points: Math.max(3, points.length),
        fills: parsedFillToCanvasFills(style, state),
        stroke: parsedStrokeToCanvasStroke(style, state),
        opacity,
        effects,
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
      d: pointsToPath(transformedPoints),
      fills: undefined,
      stroke: {
        thickness: style.strokeWidth ?? 1,
        align: "center",
        fill: [{ type: "solid", color: style.stroke ?? "#111827" }],
        cap: style.strokeLinecap,
        join: style.strokeLinejoin,
        dashPattern: style.strokeDasharray,
        dashOffset: style.strokeDashoffset,
      },
      opacity,
      effects,
      meta: commonMeta,
    } as ImportNode);
    return id;
  }

  if (tag === "path") {
    const d = element.getAttribute("d");
    if (!d) return null;
    const bounds = {
      ...transformBounds(getPathBounds(d), transform),
    };
    const id = createNodeId("path");
    state.nodes.push({
      id,
      type: "path",
      parentId,
      title: element.getAttribute("id") ?? "Path",
      bounds,
      d,
      fills: parsedFillToCanvasFills(style, state),
      stroke: parsedStrokeToCanvasStroke(style, state),
      opacity,
      effects,
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
        ...transformBounds(
          {
            x: readNumber(element, "x"),
            y: readNumber(element, "y"),
            width: Math.max(1, readNumber(element, "width")),
            height: Math.max(1, readNumber(element, "height")),
          },
          transform,
        ),
      },
      opacity,
      effects,
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
    state.nodes.push({
      id,
      type: "text",
      parentId,
      title: text.slice(0, 24),
      text,
      fontSize,
      fontFamily: style.fontFamily,
      fills: parsedFillToCanvasFills(style, state) ?? [
        { type: "solid", color: "#111827" },
      ],
      bounds: {
        ...transformBounds(
          {
            x,
            y: y - fontSize,
            width: estimateTextWidth(text, fontSize),
            height: Math.round(fontSize * 1.5),
          },
          transform,
        ),
      },
      opacity,
      effects,
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

function readElementStyle(
  element: Element,
  inherited: ParsedStyle,
  state: Pick<SvgParseState, "cssRules">,
): ParsedStyle {
  const fromCss = getMatchedSvgStyle(element, state.cssRules);
  const fromAttr = parseStyleAttribute(element.getAttribute("style"));
  const merged = { ...fromCss, ...fromAttr };
  const fill = normalizeColor(
    element.getAttribute("fill") ?? merged.fill ?? inherited.fill,
  );
  const stroke = normalizeColor(
    element.getAttribute("stroke") ?? merged.stroke ?? inherited.stroke,
  );
  const color = normalizeColor(
    merged.color ?? element.getAttribute("color") ?? inherited.color,
  );
  return {
    fill,
    stroke,
    color,
    strokeWidth:
      readOptionalNumber(element.getAttribute("stroke-width")) ??
      parseCssNumber(merged.strokeWidth) ??
      inherited.strokeWidth,
    fillOpacity:
      readOpacity(element.getAttribute("fill-opacity")) ??
      readOpacity(merged.fillOpacity) ??
      inherited.fillOpacity,
    strokeOpacity:
      readOpacity(element.getAttribute("stroke-opacity")) ??
      readOpacity(merged.strokeOpacity) ??
      inherited.strokeOpacity,
    strokeDasharray:
      readSvgDashArray(element.getAttribute("stroke-dasharray")) ??
      readSvgDashArray(merged.strokeDasharray) ??
      inherited.strokeDasharray,
    strokeDashoffset:
      readOptionalNumber(element.getAttribute("stroke-dashoffset")) ??
      parseCssNumber(merged.strokeDashoffset) ??
      inherited.strokeDashoffset,
    strokeLinecap:
      mapSvgStrokeCap(
        element.getAttribute("stroke-linecap") ?? merged.strokeLinecap,
      ) ?? inherited.strokeLinecap,
    strokeLinejoin:
      mapSvgStrokeJoin(
        element.getAttribute("stroke-linejoin") ?? merged.strokeLinejoin,
      ) ?? inherited.strokeLinejoin,
    strokeMiterlimit:
      readOptionalNumber(element.getAttribute("stroke-miterlimit")) ??
      parseCssNumber(merged.strokeMiterlimit) ??
      inherited.strokeMiterlimit,
    opacity:
      readOpacity(element.getAttribute("opacity")) ??
      readOpacity(merged.opacity) ??
      inherited.opacity,
    fontSize:
      readOptionalNumber(element.getAttribute("font-size")) ??
      parseCssNumber(merged.fontSize) ??
      inherited.fontSize,
    fontFamily:
      merged.fontFamily ??
      element.getAttribute("font-family") ??
      inherited.fontFamily,
  };
}

function collectSvgDefinitions(svg: Element, state: SvgParseState): void {
  for (const styleElement of Array.from(svg.querySelectorAll("style"))) {
    state.cssRules.push(...parseCssRules(styleElement.textContent ?? ""));
  }

  for (const element of Array.from(svg.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id");
    if (id) {
      state.definitionElements.set(id, element);
    }
  }

  for (const clipPath of Array.from(svg.querySelectorAll("clipPath"))) {
    const id = clipPath.getAttribute("id");
    if (!id) continue;
    state.clipPaths.set(id, readSvgClipPathDefinition(clipPath));
  }

  for (const filter of Array.from(svg.querySelectorAll("filter"))) {
    const id = filter.getAttribute("id");
    if (!id) continue;
    const effects = readSvgFilterDefinition(filter, state);
    if (effects.length > 0) {
      state.filters.set(id, effects);
    }
  }

  for (const gradient of Array.from(
    svg.querySelectorAll("linearGradient, radialGradient"),
  )) {
    const id = gradient.getAttribute("id");
    if (!id) continue;
    const stops = Array.from(gradient.querySelectorAll("stop"))
      .map((stop, index, all) => {
        const style = parseStyleAttribute(stop.getAttribute("style"));
        const color = normalizeColor(
          stop.getAttribute("stop-color") ?? style.stopColor,
        );
        if (!color) return null;
        const opacity = readOpacity(
          stop.getAttribute("stop-opacity") ?? style.stopOpacity,
        );
        const rawOffset = stop.getAttribute("offset");
        const parsedOffset = rawOffset?.endsWith("%")
          ? Number.parseFloat(rawOffset) / 100
          : Number.parseFloat(rawOffset ?? "");
        return {
          offset: Number.isFinite(parsedOffset)
            ? Math.max(0, Math.min(1, parsedOffset))
            : all.length <= 1
              ? 0
              : index / (all.length - 1),
          color:
            opacity === undefined ? color : applyColorOpacity(color, opacity),
        };
      })
      .filter((stop): stop is { offset: number; color: string } =>
        Boolean(stop),
      );
    if (stops.length === 0) continue;
    if (gradient.tagName.toLowerCase() === "radialgradient") {
      state.paintServers.set(id, {
        type: "radial_gradient",
        cx: parseSvgUnitFraction(gradient.getAttribute("cx"), 0.5),
        cy: parseSvgUnitFraction(gradient.getAttribute("cy"), 0.5),
        radius: parseSvgUnitFraction(gradient.getAttribute("r"), 0.5),
        stops,
      });
    } else {
      state.paintServers.set(id, {
        type: "linear_gradient",
        angle: readLinearGradientAngle(gradient),
        stops,
      });
    }
  }
}

function parseCssRules(css: string): SvgParseState["cssRules"] {
  const rules: SvgParseState["cssRules"] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    const style = parseStyleAttribute(match[2] ?? null);
    for (const selector of selectors) {
      if (isSupportedSvgSelector(selector)) {
        rules.push({ selector, style });
      }
    }
  }
  return rules;
}

function getMatchedSvgStyle(
  element: Element,
  rules: Array<{ selector: string; style: Record<string, string> }>,
): Record<string, string> {
  const matched = new Map<
    string,
    { specificity: number; order: number; value: string }
  >();
  rules.forEach((rule, order) => {
    if (!matchesSvgSelector(element, rule.selector)) {
      return;
    }
    const specificity = getSvgSelectorSpecificity(rule.selector);
    for (const [key, value] of Object.entries(rule.style)) {
      const existing = matched.get(key);
      if (
        !existing ||
        specificity > existing.specificity ||
        (specificity === existing.specificity && order >= existing.order)
      ) {
        matched.set(key, { specificity, order, value });
      }
    }
  });
  return Object.fromEntries(
    Array.from(matched.entries()).map(([key, entry]) => [key, entry.value]),
  );
}

function isSupportedSvgSelector(selector: string): boolean {
  return selector
    .split(/\s+/)
    .every((part) =>
      /^[A-Za-z][A-Za-z0-9_-]*$|^#[A-Za-z0-9_-]+$|^\.[A-Za-z0-9_-]+$/.test(
        part,
      ),
    );
}

function matchesSvgSelector(element: Element, selector: string): boolean {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  let current: Element | null = element;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) return false;
    if (index === parts.length - 1) {
      if (!current || !matchesSvgSimpleSelector(current, part)) return false;
      current = current.parentElement;
      continue;
    }
    while (current && !matchesSvgSimpleSelector(current, part)) {
      current = current.parentElement;
    }
    if (!current) return false;
    current = current.parentElement;
  }
  return true;
}

function matchesSvgSimpleSelector(
  element: Element | null,
  selector: string,
): boolean {
  if (!element) return false;
  if (selector.startsWith("#")) {
    return element.getAttribute("id") === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return (element.getAttribute("class") ?? "")
      .split(/\s+/)
      .includes(selector.slice(1));
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function getSvgSelectorSpecificity(selector: string): number {
  return selector.split(/\s+/).reduce((sum, part) => {
    if (part.startsWith("#")) return sum + 100;
    if (part.startsWith(".")) return sum + 10;
    return sum + 1;
  }, 0);
}

function resolvePaintServer(
  value: string,
  state?: Pick<SvgParseState, "paintServers">,
): CanvasFill | undefined {
  const match = value.match(/^url\(["']?#([^"')]+)["']?\)$/i);
  if (!match?.[1]) return undefined;
  return state?.paintServers.get(match[1]);
}

function resolveSvgClipDefinition(
  element: Element,
  state: SvgParseState,
  transform: SvgTransform,
): SvgClipDefinition | undefined {
  const raw = element.getAttribute("clip-path");
  if (!raw) return undefined;
  const id = readUrlReferenceId(raw);
  const clip = id ? state.clipPaths.get(id) : undefined;
  if (!clip || clip.type === "complex") {
    pushImportWarning(state, {
      code: "partial_fidelity",
      message:
        "检测到 SVG clipPath，当前仅完整支持简单 rect 裁剪，复杂裁剪已降级为可编辑几何。",
      originNodeId: element.getAttribute("id") ?? undefined,
      originNodeType: element.tagName.toLowerCase(),
    });
    return undefined;
  }
  return {
    ...clip,
    bounds: transformBounds(clip.bounds, transform),
  };
}

function resolveSvgFilterEffects(
  element: Element,
  state: SvgParseState,
): CanvasEffect[] | undefined {
  const raw = element.getAttribute("filter");
  if (!raw) return undefined;
  const id = readUrlReferenceId(raw);
  const effects = id ? state.filters.get(id) : undefined;
  if (!effects || effects.length === 0) {
    pushImportWarning(state, {
      code: "effects_dropped",
      message:
        "检测到 SVG filter，当前仅支持 drop-shadow 与 blur，复杂滤镜已降级。",
      originNodeId: element.getAttribute("id") ?? undefined,
      originNodeType: element.tagName.toLowerCase(),
    });
    return undefined;
  }
  return effects;
}

function readSvgClipPathDefinition(clipPath: Element): SvgClipDefinition {
  const children = Array.from(clipPath.children).filter(
    (child) => child.tagName.toLowerCase() !== "title",
  );
  if (children.length !== 1) {
    return { type: "complex" };
  }
  const child = children[0];
  if (!child || child.tagName.toLowerCase() !== "rect") {
    return { type: "complex" };
  }
  return {
    type: "rect",
    bounds: {
      x: readNumber(child, "x"),
      y: readNumber(child, "y"),
      width: Math.max(1, readNumber(child, "width")),
      height: Math.max(1, readNumber(child, "height")),
    },
    cornerRadius: readNumber(child, "rx") || undefined,
  };
}

function readSvgFilterDefinition(
  filter: Element,
  state: SvgParseState,
): CanvasEffect[] {
  const effects: CanvasEffect[] = [];
  for (const child of Array.from(filter.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "fedropshadow") {
      effects.push({
        type: "shadow",
        offsetX: readOptionalNumber(child.getAttribute("dx")) ?? 0,
        offsetY: readOptionalNumber(child.getAttribute("dy")) ?? 0,
        blur: readOptionalNumber(child.getAttribute("stdDeviation")) ?? 0,
        spread: 0,
        color: normalizeColor(child.getAttribute("flood-color")) ?? "#00000040",
      });
      continue;
    }
    if (tag === "fegaussianblur") {
      effects.push({
        type: "blur",
        radius: readOptionalNumber(child.getAttribute("stdDeviation")) ?? 0,
      });
      continue;
    }
    pushImportWarning(state, {
      code: "effects_dropped",
      message: `暂未支持 SVG filter 节点 <${tag}>，已跳过该滤镜片段。`,
      originNodeId: filter.getAttribute("id") ?? undefined,
      originNodeType: "filter",
    });
  }
  return effects;
}

function readUrlReferenceId(value: string): string | undefined {
  return value.match(/^url\(["']?#([^"')]+)["']?\)$/i)?.[1];
}

function readSvgHref(element: Element): string | undefined {
  const raw =
    element.getAttribute("href") ??
    element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  return raw?.startsWith("#") ? raw.slice(1) : undefined;
}

function readLinearGradientAngle(element: Element): number | undefined {
  const x1 = parseCssNumber(element.getAttribute("x1") ?? undefined);
  const y1 = parseCssNumber(element.getAttribute("y1") ?? undefined);
  const x2 = parseCssNumber(element.getAttribute("x2") ?? undefined);
  const y2 = parseCssNumber(element.getAttribute("y2") ?? undefined);
  if ([x1, y1, x2, y2].some((value) => value === undefined)) {
    return undefined;
  }
  const radians = Math.atan2((y2 ?? 0) - (y1 ?? 0), (x2 ?? 0) - (x1 ?? 0));
  const transformRotation = readSvgTransformRotation(
    parseSvgTransform(element.getAttribute("gradientTransform")),
  );
  return Math.round(90 + (radians * 180) / Math.PI + transformRotation);
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

type SvgTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

const IDENTITY_TRANSFORM: SvgTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

function parseSvgTransform(raw: string | null): SvgTransform {
  if (!raw) return IDENTITY_TRANSFORM;
  let current = IDENTITY_TRANSFORM;
  for (const match of raw.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const fn = match[1]?.toLowerCase();
    const values = (match[2] ?? "")
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));
    let next = IDENTITY_TRANSFORM;
    if (fn === "matrix" && values.length >= 6) {
      next = {
        a: values[0] ?? 1,
        b: values[1] ?? 0,
        c: values[2] ?? 0,
        d: values[3] ?? 1,
        e: values[4] ?? 0,
        f: values[5] ?? 0,
      };
    } else if (fn === "translate") {
      next = {
        ...IDENTITY_TRANSFORM,
        e: values[0] ?? 0,
        f: values[1] ?? 0,
      };
    } else if (fn === "scale") {
      const sx = values[0] ?? 1;
      next = {
        ...IDENTITY_TRANSFORM,
        a: sx,
        d: values[1] ?? sx,
      };
    } else if (fn === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const cx = values[1] ?? 0;
      const cy = values[2] ?? 0;
      next = multiplySvgTransform(
        multiplySvgTransform(
          { ...IDENTITY_TRANSFORM, e: cx, f: cy },
          { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
        ),
        { ...IDENTITY_TRANSFORM, e: -cx, f: -cy },
      );
    }
    current = multiplySvgTransform(current, next);
  }
  return current;
}

function getSvgViewBoxTransform(svg: Element): SvgTransform {
  const viewBox = svg.getAttribute("viewBox");
  if (!viewBox) return IDENTITY_TRANSFORM;
  const values = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));
  const [minX, minY, viewW, viewH] = values;
  if (
    minX === undefined ||
    minY === undefined ||
    !viewW ||
    !viewH ||
    !Number.isFinite(viewW) ||
    !Number.isFinite(viewH)
  ) {
    return IDENTITY_TRANSFORM;
  }
  const width = readOptionalNumber(svg.getAttribute("width"));
  const height = readOptionalNumber(svg.getAttribute("height"));
  if (!width || !height) return IDENTITY_TRANSFORM;
  const scaleX = width / viewW;
  const scaleY = height / viewH;
  return {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: -minX * scaleX,
    f: -minY * scaleY,
  };
}

function multiplySvgTransform(
  left: SvgTransform,
  right: SvgTransform,
): SvgTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function readSvgTransformRotation(transform: SvgTransform): number {
  return (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
}

function transformPoint(
  point: { x: number; y: number },
  transform: SvgTransform,
): { x: number; y: number } {
  return {
    x: point.x * transform.a + point.y * transform.c + transform.e,
    y: point.x * transform.b + point.y * transform.d + transform.f,
  };
}

function transformBounds(
  bounds: CanvasBounds,
  transform: SvgTransform,
): CanvasBounds {
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => transformPoint(point, transform));
  return getPointBounds(points);
}

function hasComponentLikeMetadata(element: Element): boolean {
  return Array.from(element.attributes).some((attribute) =>
    /component|instance|variant/i.test(attribute.name + attribute.value),
  );
}

function getHtmlFigmaComponentRef(
  element: Element,
): PenComponentRef | undefined {
  const figmaNodeType = inferFigmaNodeType(element)?.toUpperCase();
  const explicitType = readFirstAttribute(element, [
    "data-component-type",
    "data-figma-component-type",
  ])?.toLowerCase();
  const componentId = readFirstAttribute(element, [
    "data-component-id",
    "data-main-component-id",
    "data-figma-component-id",
    "data-symbol-id",
  ]);
  const key = readFirstAttribute(element, [
    "data-component-key",
    "data-figma-component-key",
  ]);
  const id =
    readFirstAttribute(element, [
      "data-node-id",
      "data-id",
      "id",
      "data-instance-id",
    ]) ?? undefined;
  const variantProperties = readJsonRecordOfPrimitives(element, [
    "data-variant-properties",
    "data-figma-variant-properties",
  ]);
  const componentProperties = readJsonRecord(element, [
    "data-component-properties",
    "data-figma-component-properties",
  ]);
  const propertyAssignments = readJsonRecord(element, [
    "data-component-prop-assignments",
    "data-component-property-assignments",
    "data-figma-component-prop-assignments",
  ]);
  const hasInstanceSignal =
    figmaNodeType === "INSTANCE" ||
    explicitType === "instance" ||
    Boolean(componentId) ||
    Boolean(propertyAssignments);
  const hasComponentSignal =
    figmaNodeType === "SYMBOL" ||
    figmaNodeType === "COMPONENT" ||
    explicitType === "component" ||
    explicitType === "variant";

  if (!hasInstanceSignal && !hasComponentSignal && !variantProperties) {
    return undefined;
  }

  const type: PenComponentRef["type"] = hasInstanceSignal
    ? "instance"
    : variantProperties || explicitType === "variant"
      ? "variant"
      : "component";

  return {
    source: "figma",
    type,
    ...(id ? { id } : {}),
    ...(key ? { key } : {}),
    ...(componentId ? { componentId } : {}),
    ...(variantProperties ? { variantProperties } : {}),
    ...(componentProperties ? { componentProperties } : {}),
    ...(propertyAssignments ? { propertyAssignments } : {}),
  };
}

function readFirstAttribute(
  element: Element | undefined,
  names: string[],
): string | undefined {
  if (!element) return undefined;
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value) return value;
  }
  return undefined;
}

function readJsonRecord(
  element: Element,
  names: string[],
): Record<string, unknown> | undefined {
  const raw = readFirstAttribute(element, names);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readJsonRecordOfPrimitives(
  element: Element,
  names: string[],
): Record<string, string | number | boolean> | undefined {
  const record = readJsonRecord(element, names);
  if (!record) return undefined;
  const filtered = Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string | number | boolean] => {
        const value = entry[1];
        return (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        );
      },
    ),
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
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

function parseSvgUnitFraction(
  value: string | null,
  fallback: number,
): number | undefined {
  if (!value) return fallback;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return fallback;
  return value.trim().endsWith("%") ? numeric / 100 : numeric;
}

function readSvgDashArray(
  value: string | undefined | null,
): number[] | undefined {
  if (!value || value.trim() === "none") return undefined;
  const values = value
    .trim()
    .split(/[\s,]+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0);
  return values.length > 0 ? values : undefined;
}

function mapSvgStrokeCap(
  value: string | undefined | null,
): CanvasStroke["cap"] {
  switch (value) {
    case "butt":
      return "none";
    case "round":
      return "round";
    case "square":
      return "square";
    default:
      return undefined;
  }
}

function mapSvgStrokeJoin(
  value: string | undefined | null,
): CanvasStroke["join"] {
  switch (value) {
    case "miter":
      return "miter";
    case "round":
      return "round";
    case "bevel":
      return "bevel";
    default:
      return undefined;
  }
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

function applyColorOpacity(color: string, opacity: number): string {
  const normalized = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    const [, r, g, b] = normalized;
    return applyColorOpacity(`#${r}${r}${g}${g}${b}${b}`, opacity);
  }
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${normalized}${alpha}`;
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
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
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
