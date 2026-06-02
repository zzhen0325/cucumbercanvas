import { figmaClipboardToNodes } from "@cucumber/pen-figma";
import type {
  BlendMode,
  PenComponentOverrideRef,
  PenComponentRef,
  PenLayoutConstraints,
  PenNode,
  PenNodeStyleRefs,
  PenStyleDefinition,
  PenTransformMatrix,
} from "@cucumber/pen-types";
import { decompress as zstdDecompress } from "fzstd";
import { ByteBuffer, compileSchema, decodeBinarySchema } from "kiwi-schema";
import * as UZIP from "uzip";

import { createNodeId } from "./document.js";
import type {
  FigmaClipboardData,
  FigmaColor,
  FigmaDecodedFile,
  FigmaDerivedSymbolDataEntry,
  FigmaGUID,
  FigmaMatrix,
  FigmaNodeChange,
  FigmaPaint,
  FigmaTreeNode,
} from "./figma-native-types.js";
import type { ImportNode } from "./import.js";
import type {
  CanvasEffect,
  CanvasFill,
  CanvasStroke,
  ImageTransform,
  PaintTransform,
  StyledTextSegment,
} from "./styles.js";
import type {
  CanvasAsset,
  CanvasImportWarningCode,
  CanvasImportedAutoLayoutMeta,
  CanvasImportedNodeMeta,
} from "./types.js";

export interface FigmaNativeWarning {
  code: CanvasImportWarningCode;
  message: string;
  originNodeId?: string;
  originNodeType?: string;
}

export interface FigmaNativeParseResult {
  rootNodeIds: string[];
  nodes: (ImportNode | PenNode)[];
  assets: CanvasAsset[];
  styleDefinitions?: Record<string, PenStyleDefinition>;
  warnings: FigmaNativeWarning[];
}

type FigmaConvertState = {
  nodes: ImportNode[];
  assets: CanvasAsset[];
  warnings: FigmaNativeWarning[];
  imageAssetCache: Map<string, { asset: CanvasAsset; url: string }>;
  symbolTree: Map<string, FigmaTreeNode>;
};

const FIG_KIWI_MAGIC = [102, 105, 103, 45, 107, 105, 119, 105];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const PNG_MAGIC_0 = 137;
const PNG_MAGIC_1 = 80;
const MB = 1024 * 1024;
const MAX_COMPRESSED_SIZE = 1024 * MB;
const MAX_UNZIPPED_SIZE = 2048 * MB;
const MAX_IMAGE_SIZE = 512 * MB;
const MAX_ZIP_ENTRIES = 10_000;

const int32 = new Int32Array(1);
const uint8 = new Uint8Array(int32.buffer);
const uint32 = new Uint32Array(int32.buffer);

const B64_LOOKUP = new Uint8Array(256);
{
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < chars.length; index += 1) {
    B64_LOOKUP[chars.charCodeAt(index)] = index;
  }
  B64_LOOKUP["-".charCodeAt(0)] = 62;
  B64_LOOKUP["_".charCodeAt(0)] = 63;
}

export function extractFigmaClipboardData(
  html: string,
): FigmaClipboardData | null {
  let metaB64: string | null = null;
  let bufferB64: string | null = null;

  const metaCommentMatch = html.match(
    /<!--\(figmeta\)(?:-->)?([\s\S]*?)<!--\(figmeta\)-->/,
  );
  const bufferCommentMatch = html.match(
    /<!--\(figma\)(?:-->)?([\s\S]*?)<!--\(figma\)-->/,
  );

  if (metaCommentMatch && bufferCommentMatch) {
    metaB64 = metaCommentMatch[1]?.trim() ?? null;
    bufferB64 = bufferCommentMatch[1]?.trim() ?? null;
  }

  if (!metaB64 || !bufferB64) {
    const attrMetaMatch = html.match(/data-metadata=(["'])([\s\S]*?)\1/);
    const attrBufferMatch = html.match(/data-buffer=(["'])([\s\S]*?)\1/);
    if (attrMetaMatch && attrBufferMatch) {
      metaB64 =
        attrMetaMatch[2]?.replace(/<!--\(figmeta\)(-->)?/g, "").trim() ?? null;
      bufferB64 =
        attrBufferMatch[2]?.replace(/<!--\(figma\)(-->)?/g, "").trim() ?? null;
    }
  }

  if (!metaB64 || !bufferB64) {
    const encodedMetaMatch = html.match(
      /&lt;!--\(figmeta\)--&gt;([\s\S]*?)&lt;!--\(figmeta\)--&gt;/,
    );
    const encodedBufferMatch = html.match(
      /&lt;!--\(figma\)--&gt;([\s\S]*?)&lt;!--\(figma\)--&gt;/,
    );
    if (encodedMetaMatch && encodedBufferMatch) {
      metaB64 = encodedMetaMatch[1]?.trim() ?? null;
      bufferB64 = encodedBufferMatch[1]?.trim() ?? null;
    }
  }

  if (!metaB64 || !bufferB64) {
    return null;
  }

  try {
    const metaRaw = decodeBase64(metaB64);
    const jsonEnd = metaRaw.lastIndexOf("}");
    const metaJson = jsonEnd >= 0 ? metaRaw.slice(0, jsonEnd + 1) : metaRaw;
    const meta = JSON.parse(metaJson) as Record<string, unknown>;
    const bytes = decodeBase64ToBytes(bufferB64);
    return { meta, buffer: bytes.buffer as ArrayBuffer };
  } catch {
    return null;
  }
}

export function parseFigmaClipboardNative(
  html: string,
): FigmaNativeParseResult | null {
  const clipboardData = extractFigmaClipboardData(html);
  if (!clipboardData) {
    return null;
  }

  try {
    const openPencilResult = figmaClipboardToNodes(clipboardData.buffer, html);
    if (openPencilResult.nodes.length > 0) {
      console.info("[figma-native] clipboard decoded with pen-figma", {
        nodeCount: openPencilResult.nodes.length,
        warningCount: openPencilResult.warnings.length,
      });

      return {
        rootNodeIds: openPencilResult.nodes.map((node) => node.id),
        nodes: openPencilResult.nodes,
        assets: collectImageAssets(openPencilResult.nodes),
        styleDefinitions: openPencilResult.styleDefinitions as
          | Record<string, PenStyleDefinition>
          | undefined,
        warnings: openPencilResult.warnings.map((message) => ({
          code: "partial_fidelity",
          message,
        })),
      };
    }
  } catch (error) {
    console.warn("[figma-native] pen-figma clipboard decode failed", {
      error,
      fallbackReason:
        error instanceof Error ? error.message : "unknown pen-figma error",
      fallbackStrategy: "legacy-cucumber-native",
    });
  }

  // Legacy Cucumber-native converter retained as a diagnostic fallback.
  const decoded = parseFigFile(clipboardData.buffer);
  const warnings: FigmaNativeWarning[] = [];
  resolveStyleReferences(decoded.nodeChanges);

  const treeRoots = buildTreeForClipboard(decoded.nodeChanges);
  if (treeRoots.length === 0) {
    console.info("[figma-native] clipboard legacy decode produced no roots", {
      nodeChangeCount: decoded.nodeChanges.length,
      imageFileCount: decoded.imageFiles.size,
      fallbackStrategy: "none",
    });
    return null;
  }

  const symbolTree = new Map<string, FigmaTreeNode>();
  for (const root of treeRoots) {
    collectSymbolTree(root, symbolTree);
  }

  const state: FigmaConvertState = {
    nodes: [],
    assets: [],
    warnings,
    imageAssetCache: new Map<string, { asset: CanvasAsset; url: string }>(),
    symbolTree,
  };
  const styleDefinitions = collectFigmaNativeStyleDefinitions(
    decoded.nodeChanges,
    decoded,
    state,
  );

  const rootNodeIds: string[] = [];
  for (const root of treeRoots) {
    const rootId = convertFigmaTreeNode(root, null, decoded, state);
    if (rootId) {
      rootNodeIds.push(rootId);
    }
  }

  if (rootNodeIds.length === 0) {
    console.info(
      "[figma-native] clipboard legacy conversion produced no nodes",
      {
        nodeChangeCount: decoded.nodeChanges.length,
        rootCount: treeRoots.length,
        imageFileCount: decoded.imageFiles.size,
        warningCount: warnings.length,
        fallbackStrategy: "none",
      },
    );
    return null;
  }

  console.info("[figma-native] clipboard decoded with legacy converter", {
    nodeChangeCount: decoded.nodeChanges.length,
    rootCount: treeRoots.length,
    imageFileCount: decoded.imageFiles.size,
    convertedNodeCount: state.nodes.length,
    assetCount: state.assets.length,
    warningCount: warnings.length,
    fallbackStrategy: "legacy-cucumber-native",
  });

  return {
    rootNodeIds,
    nodes: state.nodes,
    assets: state.assets,
    styleDefinitions,
    warnings: dedupeWarnings(warnings),
  };
}

function collectImageAssets(nodes: PenNode[]): CanvasAsset[] {
  const assets: CanvasAsset[] = [];
  const seen = new Set<string>();
  const visit = (node: PenNode): void => {
    const imageUrl = node.type === "image" ? node.src : undefined;
    if (imageUrl && isDataImageUrl(imageUrl) && !seen.has(imageUrl)) {
      seen.add(imageUrl);
      assets.push({
        id: createNodeId("asset"),
        url: imageUrl,
        mimeType: imageUrl.slice(5, imageUrl.indexOf(";")) || "image/png",
        source: "upload",
      });
    }
    const fills = "fill" in node ? node.fill : undefined;
    for (const fill of fills ?? []) {
      if (
        fill.type === "image" &&
        isDataImageUrl(fill.url) &&
        !seen.has(fill.url)
      ) {
        seen.add(fill.url);
        assets.push({
          id: createNodeId("asset"),
          url: fill.url,
          mimeType: fill.url.slice(5, fill.url.indexOf(";")) || "image/png",
          source: "upload",
        });
      }
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return assets;
}

function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function decodeBase64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[^A-Za-z0-9+/\-_=]/g, "");
  const length = cleaned.length;
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((length * 3) / 4) - padding;
  const bytes = new Uint8Array(byteLength);
  let pointer = 0;

  for (let index = 0; index < length; index += 4) {
    const a = B64_LOOKUP[cleaned.charCodeAt(index) ?? 0];
    const b = B64_LOOKUP[cleaned.charCodeAt(index + 1) ?? 0];
    const c = B64_LOOKUP[cleaned.charCodeAt(index + 2) ?? 0];
    const d = B64_LOOKUP[cleaned.charCodeAt(index + 3) ?? 0];

    if (pointer < byteLength)
      bytes[pointer++] = ((a ?? 0) << 2) | ((b ?? 0) >> 4);
    if (pointer < byteLength) {
      bytes[pointer++] = (((b ?? 0) & 0x0f) << 4) | ((c ?? 0) >> 2);
    }
    if (pointer < byteLength) {
      bytes[pointer++] = (((c ?? 0) & 0x03) << 6) | (d ?? 0);
    }
  }

  return bytes;
}

function decodeBase64(input: string): string {
  return new TextDecoder().decode(decodeBase64ToBytes(input));
}

function parseFigFile(fileBuffer: ArrayBuffer): FigmaDecodedFile {
  const { parts, imageFiles } = figToBinaryParts(fileBuffer);
  if (parts.length < 2) {
    throw new Error(
      `Invalid .fig file: expected at least 2 binary parts, got ${parts.length}`,
    );
  }

  const [schemaByte, dataByte] = parts;
  if (!schemaByte || !dataByte) {
    throw new Error("Invalid .fig file: missing schema or data chunk");
  }
  const schema = decodeBinarySchema(new ByteBuffer(schemaByte));
  const schemaHelper = compileSchema(schema) as Record<string, unknown>;
  const decoder = findDecoder(schemaHelper);
  const raw = decoder(new ByteBuffer(dataByte));

  if (!raw || typeof raw !== "object") {
    throw new Error("Decoded .fig data is empty or invalid");
  }

  const nodeChanges = Array.isArray(
    (raw as { nodeChanges?: unknown[] }).nodeChanges,
  )
    ? ((raw as { nodeChanges: FigmaNodeChange[] }).nodeChanges ?? [])
    : [];

  if (nodeChanges.length === 0) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (
        Array.isArray(value) &&
        value[0] &&
        typeof value[0] === "object" &&
        "guid" in value[0]
      ) {
        return {
          nodeChanges: value as FigmaNodeChange[],
          blobs: extractBlobs(raw as Record<string, unknown>),
          imageFiles,
        };
      }
    }
  }

  return {
    nodeChanges,
    blobs: extractBlobs(raw as Record<string, unknown>),
    imageFiles,
  };
}

function figToBinaryParts(fileBuffer: ArrayBuffer): {
  parts: Uint8Array[];
  imageFiles: Map<string, Uint8Array>;
} {
  let currentFileBuffer = fileBuffer;
  let fileBytes = new Uint8Array(currentFileBuffer);
  const imageFiles = new Map<string, Uint8Array>();

  if (!hasFigKiwiMagic(fileBytes)) {
    if (fileBuffer.byteLength > MAX_COMPRESSED_SIZE) {
      throw new Error("Compressed .fig file exceeds maximum size limit");
    }

    const unzipped = UZIP.parse(currentFileBuffer);
    const entryCount = Object.keys(unzipped).length;
    if (entryCount > MAX_ZIP_ENTRIES) {
      throw new Error(`ZIP archive contains too many entries (${entryCount})`);
    }

    let totalSize = 0;
    for (const [path, bytes] of Object.entries(unzipped) as Array<
      [string, Uint8Array]
    >) {
      totalSize += bytes.length;
      if (totalSize > MAX_UNZIPPED_SIZE) {
        throw new Error("Decompressed file exceeds maximum size limit");
      }
      if (path.startsWith("images/") && bytes.length > 0) {
        if (bytes.length > MAX_IMAGE_SIZE) {
          throw new Error("Embedded image exceeds maximum size limit");
        }
        imageFiles.set(path.slice(7), bytes);
      }
    }

    const canvasFile = unzipped["canvas.fig"];
    if (!canvasFile) {
      throw new Error("Invalid .fig file: no canvas.fig found in archive");
    }
    currentFileBuffer = canvasFile.buffer as ArrayBuffer;
    fileBytes = new Uint8Array(currentFileBuffer);
  }

  if (!hasFigKiwiMagic(fileBytes)) {
    throw new Error("Invalid .fig file: missing fig-kiwi header");
  }

  let offset = 8;
  readUint32(fileBytes, offset);
  offset += 4;

  const parts: Uint8Array[] = [];
  while (offset < fileBytes.length) {
    const chunkSize = readUint32(fileBytes, offset);
    offset += 4;
    if (chunkSize === 0 || offset + chunkSize > fileBytes.length) {
      break;
    }
    const rawChunk = fileBytes.slice(offset, offset + chunkSize);
    parts.push(decompressChunk(rawChunk));
    offset += chunkSize;
  }

  return { parts, imageFiles };
}

function extractBlobs(raw: Record<string, unknown>): (Uint8Array | string)[] {
  if (!Array.isArray(raw.blobs)) {
    return [];
  }

  return raw.blobs.map((blob) => {
    if (typeof blob === "string") {
      return blob;
    }
    if (blob && typeof blob === "object" && "bytes" in blob) {
      const bytes = (blob as { bytes?: unknown }).bytes;
      if (bytes instanceof Uint8Array) {
        return bytes;
      }
    }
    return new Uint8Array(0);
  });
}

function buildTreeForClipboard(
  nodeChanges: FigmaNodeChange[],
): FigmaTreeNode[] {
  const nodeMap = new Map<string, FigmaTreeNode>();
  const childKeys = new Set<string>();

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.guid || nodeChange.phase === "REMOVED") {
      continue;
    }
    nodeMap.set(guidToString(nodeChange.guid), {
      figma: nodeChange,
      children: [],
    });
  }

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.guid || nodeChange.phase === "REMOVED") {
      continue;
    }
    const key = guidToString(nodeChange.guid);
    const treeNode = nodeMap.get(key);
    if (!treeNode || !nodeChange.parentIndex?.guid) {
      continue;
    }
    const parent = nodeMap.get(guidToString(nodeChange.parentIndex.guid));
    if (!parent) {
      continue;
    }
    parent.children.push(treeNode);
    childKeys.add(key);
  }

  const roots: FigmaTreeNode[] = [];
  for (const [key, node] of nodeMap) {
    if (!childKeys.has(key) && node.figma.type !== "DOCUMENT") {
      roots.push(node);
    }
  }

  for (const root of roots) {
    sortChildrenRecursive(root);
  }
  return roots;
}

function sortChildrenRecursive(node: FigmaTreeNode): void {
  node.children.sort((left, right) => {
    const a = left.figma.parentIndex?.position ?? "";
    const b = right.figma.parentIndex?.position ?? "";
    return a < b ? 1 : a > b ? -1 : 0;
  });
  for (const child of node.children) {
    sortChildrenRecursive(child);
  }
}

function collectSymbolTree(
  node: FigmaTreeNode,
  map: Map<string, FigmaTreeNode>,
): void {
  if (node.figma.type === "SYMBOL" && node.figma.guid) {
    map.set(guidToString(node.figma.guid), node);
  }
  for (const child of node.children) {
    collectSymbolTree(child, map);
  }
}

function resolveStyleReferences(nodeChanges: FigmaNodeChange[]): void {
  const styleMap = new Map<string, FigmaNodeChange>();
  for (const nodeChange of nodeChanges) {
    if (nodeChange.styleType && nodeChange.guid) {
      styleMap.set(guidToString(nodeChange.guid), nodeChange);
    }
  }
  if (styleMap.size === 0) {
    return;
  }

  const lookup = (
    ref: { guid?: FigmaGUID } | undefined,
  ): FigmaNodeChange | undefined => {
    if (!ref?.guid) {
      return undefined;
    }
    return styleMap.get(guidToString(ref.guid));
  };

  for (const nodeChange of nodeChanges) {
    const fillStyle = lookup(nodeChange.styleIdForFill);
    if (fillStyle?.fillPaints?.length) {
      nodeChange.fillPaints = fillStyle.fillPaints;
    }

    const strokeStyle = lookup(nodeChange.styleIdForStrokeFill);
    if (strokeStyle?.fillPaints?.length) {
      nodeChange.strokePaints = strokeStyle.fillPaints;
    }

    const textStyle = lookup(nodeChange.styleIdForText);
    if (textStyle) {
      if (!nodeChange.fontName && textStyle.fontName)
        nodeChange.fontName = textStyle.fontName;
      if (
        nodeChange.fontSize === undefined &&
        textStyle.fontSize !== undefined
      ) {
        nodeChange.fontSize = textStyle.fontSize;
      }
      if (!nodeChange.lineHeight && textStyle.lineHeight)
        nodeChange.lineHeight = textStyle.lineHeight;
      if (!nodeChange.letterSpacing && textStyle.letterSpacing) {
        nodeChange.letterSpacing = textStyle.letterSpacing;
      }
      if (!nodeChange.fillPaints && textStyle.fillPaints?.length) {
        nodeChange.fillPaints = textStyle.fillPaints;
      }
    }

    const effectStyle = lookup(nodeChange.styleIdForEffect);
    if (effectStyle?.effects?.length && !nodeChange.effects?.length) {
      nodeChange.effects = effectStyle.effects;
    }
  }
}

function collectFigmaNativeStyleDefinitions(
  nodeChanges: FigmaNodeChange[],
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
): Record<string, PenStyleDefinition> | undefined {
  const definitions: Record<string, PenStyleDefinition> = {};

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.styleType || !nodeChange.guid) continue;
    const id = guidToString(nodeChange.guid);
    const definition: PenStyleDefinition = {
      source: "figma",
      id,
      name: nodeChange.name,
      type: mapFigmaNativeStyleDefinitionType(nodeChange.styleType),
      fill: getPaintFills(nodeChange.fillPaints, decoded, state),
      strokeFill: getPaintFills(nodeChange.strokePaints, decoded, state),
      effects: convertFigmaEffects(nodeChange.effects),
      variableRefs: getFigmaVariableRefs(nodeChange),
    };

    if (nodeChange.styleType === "TEXT") {
      definition.text = removeUndefinedStyleFields({
        fontFamily: nodeChange.fontName?.family,
        fontPostScriptName: nodeChange.fontName?.postscript,
        fontSize: nodeChange.fontSize,
        fontWeight: nodeChange.fontName
          ? extractFontWeight(nodeChange.fontName)
          : undefined,
        fontStyle: nodeChange.fontName?.style?.toLowerCase().includes("italic")
          ? ("italic" as const)
          : undefined,
        letterSpacing: mapFigmaLetterSpacing(nodeChange),
        lineHeight: mapFigmaLineHeight(nodeChange),
        paragraphSpacing: nodeChange.paragraphSpacing,
        listStyle: mapFigmaListStyle(nodeChange),
        indent: nodeChange.paragraphIndent,
        hangingIndent: nodeChange.hangingIndent,
        baselineShift: nodeChange.baselineShift,
        openTypeFeatures: getFigmaOpenTypeFeatures(nodeChange),
        fontFallback: getFigmaFontFallback(nodeChange),
        textAlign: mapTextAlign(nodeChange.textAlignHorizontal),
        textAlignVertical: mapTextAlignVertical(nodeChange.textAlignVertical),
        underline: nodeChange.textDecoration === "UNDERLINE" ? true : undefined,
        strikethrough:
          nodeChange.textDecoration === "STRIKETHROUGH" ? true : undefined,
        textCase: mapFigmaTextCase(nodeChange.textCase),
        textGrowth: mapTextGrowth(nodeChange.textAutoResize),
      });
    }

    definitions[id] = removeUndefinedStyleFields(definition);
  }

  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

function mapFigmaNativeStyleDefinitionType(
  styleType: NonNullable<FigmaNodeChange["styleType"]>,
): PenStyleDefinition["type"] {
  if (styleType === "TEXT") return "text";
  if (styleType === "EFFECT") return "effect";
  return "fill";
}

function removeUndefinedStyleFields<T extends object>(value: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) cleaned[key] = nested;
  }
  return cleaned as T;
}

function convertFigmaTreeNode(
  treeNode: FigmaTreeNode,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string | null {
  const node = treeNode.figma;
  if (
    node.visible === false ||
    !node.type ||
    node.type === "CANVAS" ||
    node.type === "DOCUMENT"
  ) {
    return null;
  }

  pushFigmaWarnings(node, state.warnings);

  switch (node.type) {
    case "GROUP":
    case "FRAME":
    case "SECTION":
      return convertFigmaGroupLike(
        treeNode,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    case "INSTANCE":
      return convertFigmaInstance(
        treeNode,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    case "SYMBOL":
      return convertFigmaGroupLike(
        treeNode,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return convertFigmaRectangle(
        node,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    case "ELLIPSE":
      return convertFigmaEllipse(
        node,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    case "LINE":
      return convertFigmaLine(node, parentId, decoded, state, parentStackMode);
    case "TEXT":
      return convertFigmaText(node, parentId, decoded, state, parentStackMode);
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "REGULAR_POLYGON":
      return convertFigmaVector(
        node,
        parentId,
        decoded,
        state,
        parentStackMode,
      );
    default:
      state.warnings.push({
        code: "unsupported_tag",
        message: `当前原生 Figma 解码暂未支持节点 ${node.type}，已回退为兼容性提醒。`,
        originNodeId: node.guid ? guidToString(node.guid) : undefined,
        originNodeType: node.type,
      });
      return null;
  }
}

function convertFigmaGroupLike(
  treeNode: FigmaTreeNode,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string | null {
  const figma = treeNode.figma;
  const bounds = getNodeBounds(figma);
  const nodeType =
    figma.type === "GROUP" ? ("group" as const) : ("frame" as const);
  const groupId = createNodeId(nodeType);
  const childIds: string[] = [];
  const frameFills =
    nodeType === "frame"
      ? getPaintFills(
          figma.fillPaints ?? figma.backgroundPaints,
          decoded,
          state,
        )
      : undefined;
  const frameStroke =
    nodeType === "frame" ? getPaintStroke(figma, decoded, state) : undefined;
  const layoutProps = getFigmaLayoutProps(figma);
  const hasOwnVisual =
    nodeType === "frame" &&
    (Boolean(frameFills?.length) ||
      Boolean(frameStroke) ||
      Boolean(figma.effects?.length));

  const orderedChildren =
    figma.stackMode && figma.stackMode !== "NONE"
      ? [...treeNode.children].reverse()
      : treeNode.children;

  for (const child of orderedChildren) {
    const childId = convertFigmaTreeNode(
      child,
      groupId,
      decoded,
      state,
      figma.stackMode,
    );
    if (childId) {
      childIds.push(childId);
    }
  }

  if (childIds.length === 0 && !hasOwnVisual) {
    return null;
  }

  state.nodes.push({
    id: groupId,
    type: nodeType,
    parentId,
    title: figma.name ?? figma.type ?? "Imported group",
    bounds,
    ...getFigmaLayerProps(figma),
    childrenOrder: childIds,
    fills: frameFills,
    stroke: frameStroke,
    cornerRadius: nodeType === "frame" ? figma.cornerRadius : undefined,
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    ...layoutProps,
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return groupId;
}

function getFigmaLayoutProps(
  figma: FigmaNodeChange,
): Pick<
  ImportNode,
  "layout" | "gap" | "padding" | "justifyContent" | "alignItems" | "clipContent"
> {
  const props: Pick<
    ImportNode,
    | "layout"
    | "gap"
    | "padding"
    | "justifyContent"
    | "alignItems"
    | "clipContent"
  > = {};
  if (figma.stackMode && figma.stackMode !== "NONE") {
    props.layout = figma.stackMode === "HORIZONTAL" ? "horizontal" : "vertical";
    if (
      figma.stackSpacing !== undefined &&
      figma.stackSpacing !== 0 &&
      figma.stackPrimaryAlignItems !== "SPACE_EVENLY"
    ) {
      props.gap = figma.stackSpacing;
    }
    props.padding = getFigmaPadding(figma);
    props.justifyContent = mapFigmaJustifyContent(
      figma.stackPrimaryAlignItems,
    ) as ImportNode["justifyContent"];
    const alignItems = mapFigmaAlignItems(figma.stackCounterAlignItems);
    props.alignItems =
      alignItems === "baseline"
        ? "end"
        : (alignItems as ImportNode["alignItems"]);
  }
  if (figma.type !== "GROUP" && figma.frameMaskDisabled !== true) {
    props.clipContent = true;
  }
  return props;
}

function getFigmaMask(figma: FigmaNodeChange): ImportNode["mask"] {
  if (!figma.isMask && !figma.shouldBreakMaskChain) return undefined;
  return {
    ...(figma.isMask ? { enabled: true } : {}),
    type: figma.maskType === "VECTOR" ? "vector" : "alpha",
    ...(figma.shouldBreakMaskChain ? { shouldBreakMaskChain: true } : {}),
  };
}

function getFigmaStyleRefs(
  figma: FigmaNodeChange,
): PenNodeStyleRefs | undefined {
  const refs: PenNodeStyleRefs = {};
  const fill = getFigmaStyleRef(figma.styleIdForFill);
  const stroke = getFigmaStyleRef(figma.styleIdForStrokeFill);
  const text = getFigmaStyleRef(figma.styleIdForText);
  const effect = getFigmaStyleRef(figma.styleIdForEffect);
  if (fill) refs.fill = fill;
  if (stroke) refs.stroke = stroke;
  if (text) refs.text = text;
  if (effect) refs.effect = effect;
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function getFigmaStyleRef(
  ref: { guid?: FigmaGUID } | undefined,
): PenNodeStyleRefs[keyof PenNodeStyleRefs] | undefined {
  return ref?.guid
    ? { source: "figma", id: guidToString(ref.guid) }
    : undefined;
}

export function mapFigmaNativeComponentRef(
  figma: FigmaNodeChange,
): PenComponentRef | undefined {
  if (figma.type === "SYMBOL") {
    const componentProperties =
      figma.componentProperties ?? figma.componentPropertyDefinitions;
    return {
      source: "figma",
      type: figma.variantProperties ? "variant" : "component",
      ...(figma.guid ? { id: guidToString(figma.guid) } : {}),
      ...(figma.componentKey ? { key: figma.componentKey } : {}),
      ...(figma.variantProperties
        ? { variantProperties: figma.variantProperties }
        : {}),
      ...(componentProperties ? { componentProperties } : {}),
    };
  }

  if (
    figma.type === "INSTANCE" ||
    figma.symbolData ||
    figma.overriddenSymbolID
  ) {
    const componentGuid =
      figma.overriddenSymbolID ?? figma.symbolData?.symbolID;
    const overrides = figma.symbolData?.symbolOverrides ?? [];
    const overridePaths = getFigmaOverridePaths(overrides);
    const overrideRefs = getFigmaOverrideRefs(overrides);
    return {
      source: "figma",
      type: "instance",
      ...(figma.guid ? { id: guidToString(figma.guid) } : {}),
      ...(figma.componentKey ? { key: figma.componentKey } : {}),
      ...(componentGuid ? { componentId: guidToString(componentGuid) } : {}),
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

function getFigmaOverridePaths(
  overrides: Array<{ guidPath?: { guids?: FigmaGUID[] } }>,
): string[] {
  return overrides
    .map((override) => override.guidPath?.guids?.map(guidToString).join("/"))
    .filter((path): path is string => Boolean(path));
}

function getFigmaOverrideRefs(
  overrides: FigmaNodeChange[],
): PenComponentOverrideRef[] {
  return overrides
    .map((override) => {
      const pathIds = override.guidPath?.guids?.map(guidToString) ?? [];
      const values = summarizeFigmaOverrideValues(override);
      const properties = Object.keys(values);
      if (pathIds.length === 0 && properties.length === 0) return undefined;

      return {
        source: "figma",
        ...(pathIds.length > 0 ? { path: pathIds.join("/") } : {}),
        ...(pathIds.length > 0 ? { pathIds } : {}),
        ...(pathIds.length > 0
          ? { targetId: pathIds[pathIds.length - 1] }
          : {}),
        properties,
        ...(properties.length > 0 ? { values } : {}),
      };
    })
    .filter((ref): ref is PenComponentOverrideRef => Boolean(ref));
}

function summarizeFigmaOverrideValues(
  override: FigmaNodeChange,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override) as Array<
    [keyof FigmaNodeChange | string, unknown]
  >) {
    if (key === "guidPath" || key === "guid" || key === "parentIndex") continue;
    if (value === undefined) continue;
    values[key] = sanitizeFigmaOverrideValue(value);
  }
  return values;
}

function sanitizeFigmaOverrideValue(value: unknown): unknown {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeFigmaOverrideValue);
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined)
        sanitized[key] = sanitizeFigmaOverrideValue(nested);
    }
    return sanitized;
  }
  return String(value);
}

function getFigmaVariableRefs(
  figma: FigmaNodeChange,
): Record<string, unknown> | undefined {
  return figma.variableConsumptionMap &&
    Object.keys(figma.variableConsumptionMap).length > 0
    ? figma.variableConsumptionMap
    : undefined;
}

function convertFigmaInstance(
  treeNode: FigmaTreeNode,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string | null {
  const figma = treeNode.figma;
  const componentGuid = figma.overriddenSymbolID ?? figma.symbolData?.symbolID;
  const symbolNode = componentGuid
    ? state.symbolTree.get(guidToString(componentGuid))
    : undefined;
  const hasVisualOverrides =
    figma.symbolData?.symbolOverrides?.some(
      (override) =>
        (override.fillPaints?.length ?? 0) > 0 ||
        (override.strokePaints?.length ?? 0) > 0 ||
        Boolean(override.textData?.characters) ||
        override.fontSize !== undefined,
    ) ?? false;

  if (
    symbolNode &&
    (treeNode.children.length === 0 ||
      hasVisualOverrides ||
      (figma.derivedSymbolData?.length ?? 0) > 0)
  ) {
    const mergedTree: FigmaTreeNode = {
      figma: mergeSymbolProps(figma, symbolNode.figma),
      children: applyInstanceOverrides(
        symbolNode,
        figma.symbolData?.symbolOverrides,
        figma.derivedSymbolData,
        figma.size,
      ),
    };
    return convertFigmaGroupLike(
      mergedTree,
      parentId,
      decoded,
      state,
      parentStackMode,
    );
  }

  return convertFigmaGroupLike(
    treeNode,
    parentId,
    decoded,
    state,
    parentStackMode,
  );
}

function convertFigmaRectangle(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createNodeId("rectangle");
  state.nodes.push({
    id: nodeId,
    type: "rectangle",
    parentId,
    title: figma.name ?? "Imported rectangle",
    bounds: getNodeBounds(figma),
    ...getFigmaLayerProps(figma),
    fills: getPaintFills(
      figma.fillPaints ?? figma.backgroundPaints,
      decoded,
      state,
    ),
    stroke: getPaintStroke(figma, decoded, state),
    cornerRadius: figma.cornerRadius,
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaEllipse(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createNodeId("ellipse");
  const arcProps = mapFigmaNativeArcData(figma.arcData);
  const layerProps = getFigmaLayerProps(figma);
  if (
    arcProps.startAngle !== undefined ||
    arcProps.sweepAngle !== undefined ||
    arcProps.innerRadius !== undefined
  ) {
    const start = arcProps.startAngle ?? 0;
    const sweep = arcProps.sweepAngle ?? 360;
    if (layerProps.flipX) {
      arcProps.startAngle = normalizeAngle(180 - start - sweep);
      arcProps.sweepAngle = sweep;
      layerProps.flipX = undefined;
    }
    if (layerProps.flipY) {
      arcProps.startAngle = normalizeAngle(360 - start - sweep);
      arcProps.sweepAngle = sweep;
      layerProps.flipY = undefined;
    }
  }
  state.nodes.push({
    id: nodeId,
    type: "ellipse",
    parentId,
    title: figma.name ?? "Imported ellipse",
    bounds: getNodeBounds(figma),
    ...layerProps,
    ...arcProps,
    fills: getPaintFills(figma.fillPaints, decoded, state),
    stroke: getPaintStroke(figma, decoded, state),
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

export function mapFigmaNativeArcData(arc: FigmaNodeChange["arcData"]): {
  startAngle?: number;
  sweepAngle?: number;
  innerRadius?: number;
} {
  if (!arc) return {};
  const startRad = arc.startingAngle ?? 0;
  const endRad = arc.endingAngle ?? Math.PI * 2;
  const inner = arc.innerRadius ?? 0;

  let actualStartRad: number;
  let sweepRad: number;
  if (endRad >= startRad) {
    actualStartRad = startRad;
    sweepRad = endRad - startRad;
  } else {
    actualStartRad = endRad;
    sweepRad = startRad - endRad;
  }

  const startDeg = (actualStartRad * 180) / Math.PI;
  const sweepDeg = (sweepRad * 180) / Math.PI;
  const result: {
    startAngle?: number;
    sweepAngle?: number;
    innerRadius?: number;
  } = {};
  if (Math.abs(startDeg) > 0.1) {
    result.startAngle = Math.round(startDeg * 100) / 100;
  }
  if (Math.abs(sweepDeg - 360) > 0.1) {
    result.sweepAngle = Math.round(sweepDeg * 100) / 100;
  }
  if (inner > 0.001) {
    result.innerRadius = Math.round(inner * 1000) / 1000;
  }
  return result;
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function convertFigmaLine(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createNodeId("line");
  const bounds = getNodeBounds(figma);
  state.nodes.push({
    id: nodeId,
    type: "line",
    parentId,
    title: figma.name ?? "Imported line",
    bounds,
    ...getFigmaLayerProps(figma),
    stroke: getPaintStroke(
      {
        ...figma,
        strokePaints: figma.strokePaints ?? figma.fillPaints,
      },
      decoded,
      state,
    ),
    x2: bounds.x + (figma.size?.x ?? 100),
    y2: bounds.y,
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaText(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createNodeId("text");
  const text = buildFigmaTextContent(figma, decoded, state);
  const title = getPlainTextContent(text).trim() || figma.name || "Text";
  state.nodes.push({
    id: nodeId,
    type: "text",
    parentId,
    title: title.slice(0, 24),
    text,
    fontSize: Math.max(12, figma.fontSize ?? 16),
    fontFamily: figma.fontName?.family,
    fontPostScriptName: figma.fontName?.postscript,
    fontWeight: figma.fontName ? extractFontWeight(figma.fontName) : undefined,
    fontStyle: figma.fontName?.style?.toLowerCase().includes("italic")
      ? "italic"
      : undefined,
    letterSpacing: mapFigmaLetterSpacing(figma),
    lineHeight: mapFigmaLineHeight(figma),
    paragraphSpacing: figma.paragraphSpacing,
    listStyle: mapFigmaListStyle(figma),
    indent: figma.paragraphIndent,
    hangingIndent: figma.hangingIndent ?? figma.listSpacing,
    baselineShift: figma.baselineShift,
    openTypeFeatures: getFigmaOpenTypeFeatures(figma),
    fontFallback: getFigmaFontFallback(figma),
    fills: getPaintFills(figma.fillPaints, decoded, state) ?? [
      { type: "solid", color: "#111827" },
    ],
    textAlign: mapTextAlign(figma.textAlignHorizontal),
    textAlignVertical: mapTextAlignVertical(figma.textAlignVertical),
    underline: figma.textDecoration === "UNDERLINE" ? true : undefined,
    strikethrough: figma.textDecoration === "STRIKETHROUGH" ? true : undefined,
    textCase: mapFigmaTextCase(figma.textCase),
    textGrowth: mapTextGrowth(figma.textAutoResize),
    bounds: getNodeBounds(figma),
    ...getFigmaLayerProps(figma),
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaVector(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const pathId = createNodeId("path");
  const path = decodeFigmaVectorPath(figma, decoded.blobs);
  if (!path) {
    state.warnings.push({
      code: "partial_fidelity",
      message: `Figma 向量节点 "${figma.name ?? "Unnamed"}" 未能完整解出路径，已按矩形边界降级导入。`,
      originNodeId: figma.guid ? guidToString(figma.guid) : undefined,
      originNodeType: figma.type,
    });
    state.nodes.push({
      id: pathId,
      type: "rectangle",
      parentId,
      title: figma.name ?? "Imported vector fallback",
      bounds: getNodeBounds(figma),
      ...getFigmaLayerProps(figma),
      fills: getPaintFills(figma.fillPaints, decoded, state),
      stroke: getPaintStroke(figma, decoded, state),
      locked: figma.locked,
      visible: figma.visible,
      mask: getFigmaMask(figma),
      effects: convertFigmaEffects(figma.effects),
      layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
      meta: createFigmaMeta(figma, {
        degradationHints: ["partial_fidelity"],
        parentStackMode,
        vectorFallback: true,
      }),
    });
    return pathId;
  }

  state.nodes.push({
    id: pathId,
    type: "path",
    parentId,
    title: figma.name ?? "Imported vector",
    d: path,
    fillRule: mapFigmaNativeVectorFillRule(figma),
    bounds: normalizePathBounds(figma, path),
    ...getFigmaLayerProps(figma),
    fills: getPaintFills(figma.fillPaints, decoded, state),
    stroke: getPaintStroke(figma, decoded, state),
    locked: figma.locked,
    visible: figma.visible,
    mask: getFigmaMask(figma),
    effects: convertFigmaEffects(figma.effects),
    layoutConstraints: getFigmaLayoutConstraints(figma, parentStackMode),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return pathId;
}

export function mapFigmaNativeVectorFillRule(
  figma: Pick<FigmaNodeChange, "fillGeometry" | "strokeGeometry">,
): "nonzero" | "evenodd" | undefined {
  const geometries = figma.fillGeometry?.length
    ? figma.fillGeometry
    : figma.strokeGeometry;
  const windingRules = geometries
    ?.map((path) => path.windingRule)
    .filter(Boolean);
  if (windingRules?.includes("ODD")) return "evenodd";
  if (windingRules?.includes("NONZERO")) return "nonzero";
  return undefined;
}

export function mergeSymbolProps(
  instance: FigmaNodeChange,
  symbol: FigmaNodeChange,
): FigmaNodeChange {
  const merged: FigmaNodeChange = { ...instance };
  const keys: Array<keyof FigmaNodeChange> = [
    "stackMode",
    "stackSpacing",
    "stackPadding",
    "stackHorizontalPadding",
    "stackVerticalPadding",
    "stackPaddingRight",
    "stackPaddingBottom",
    "stackPrimarySizing",
    "stackCounterSizing",
    "stackPrimaryAlignItems",
    "stackCounterAlignItems",
    "stackChildPrimaryGrow",
    "stackChildAlignSelf",
    "stackPositioning",
    "fillPaints",
    "backgroundPaints",
    "strokePaints",
    "strokeWeight",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "dashPattern",
    "dashOffset",
    "strokeMiterLimit",
    "borderStrokeWeightsIndependent",
    "borderTopWeight",
    "borderRightWeight",
    "borderBottomWeight",
    "borderLeftWeight",
    "cornerRadius",
    "cornerSmoothing",
    "effects",
    "blendMode",
    "arcData",
    "frameMaskDisabled",
    "isMask",
    "maskType",
    "shouldBreakMaskChain",
    "styleIdForFill",
    "styleIdForStrokeFill",
    "styleIdForText",
    "styleIdForEffect",
    "variableConsumptionMap",
    "componentKey",
    "variantProperties",
    "componentProperties",
    "componentPropertyDefinitions",
    "componentPropAssignments",
    "textAlignVertical",
    "textDecoration",
    "textCase",
  ];

  for (const key of keys) {
    if (merged[key] === undefined && symbol[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = symbol[key];
    }
  }

  return merged;
}

export function applyInstanceOverrides(
  symbolNode: FigmaTreeNode,
  overrides: FigmaNodeChange[] | undefined,
  derived: FigmaDerivedSymbolDataEntry[] | undefined,
  instanceSize: { x: number; y: number } | undefined,
): FigmaTreeNode[] {
  if (
    (!derived || derived.length === 0) &&
    (!overrides || overrides.length === 0)
  ) {
    return scaleTreeChildren(symbolNode, instanceSize);
  }

  const safeOverrides = overrides ?? [];
  const safeDerived = derived ?? [];
  const overrideMap = new Map<string, FigmaNodeChange>();
  const derivedMap = new Map<string, FigmaDerivedSymbolDataEntry>();

  for (const override of safeOverrides) {
    const path = override.guidPath?.guids;
    if (path?.length) {
      overrideMap.set(guidPathKey(path), override);
    }
  }

  for (const entry of safeDerived) {
    const path = entry.guidPath?.guids;
    if (path?.length) {
      derivedMap.set(guidPathKey(path), entry);
    }
  }

  const flatSymbol = flattenTree(symbolNode);
  const oneLevelDerived = safeDerived.filter(
    (entry) => (entry.guidPath?.guids.length ?? 0) === 1,
  );
  const firstGuids = oneLevelDerived[0]?.guidPath?.guids;
  const sessionID = firstGuids?.[0]?.sessionID;
  const firstLocalID = firstGuids?.[0]?.localID;

  const nodeOverride = new Map<string, FigmaNodeChange>();
  const nodeDerived = new Map<string, FigmaDerivedSymbolDataEntry>();
  const pathToNodeGuid = new Map<string, string>();

  const resolveToNode = (pathKey: string, nodeGuid: string) => {
    const derivedEntry = derivedMap.get(pathKey);
    if (derivedEntry) {
      nodeDerived.set(nodeGuid, derivedEntry);
    }
    const overrideEntry = overrideMap.get(pathKey);
    if (overrideEntry) {
      nodeOverride.set(nodeGuid, overrideEntry);
    }
  };

  const guidToNodeMap = new Map<string, string>();
  for (const node of flatSymbol) {
    if (node.figma.guid) {
      const guid = guidToString(node.figma.guid);
      guidToNodeMap.set(guid, guid);
    }
  }

  let directMatches = 0;
  for (const entry of oneLevelDerived) {
    const guid = entry.guidPath?.guids?.[0];
    if (guid && guidToNodeMap.has(guidToString(guid))) {
      directMatches += 1;
    }
  }

  if (
    directMatches > oneLevelDerived.length * 0.5 ||
    oneLevelDerived.length === 0
  ) {
    for (const entry of oneLevelDerived) {
      const guid = entry.guidPath?.guids?.[0];
      if (!guid) {
        continue;
      }
      const pathKey = guidToString(guid);
      if (guidToNodeMap.has(pathKey)) {
        resolveToNode(pathKey, pathKey);
        pathToNodeGuid.set(pathKey, pathKey);
      }
    }
    for (const [pathKey, overrideEntry] of overrideMap) {
      if (pathKey.includes("/")) {
        continue;
      }
      if (guidToNodeMap.has(pathKey)) {
        nodeOverride.set(pathKey, overrideEntry);
      }
    }
  } else if (oneLevelDerived.length === flatSymbol.length) {
    for (let index = 0; index < flatSymbol.length; index += 1) {
      const node = flatSymbol[index];
      const entry = oneLevelDerived[index];
      if (!node?.figma.guid || !entry?.guidPath?.guids?.length) {
        continue;
      }
      const actualGuid = guidToString(node.figma.guid);
      const pathKey = guidPathKey(entry.guidPath.guids);
      resolveToNode(pathKey, actualGuid);
      pathToNodeGuid.set(
        guidToString(entry.guidPath.guids[0] ?? node.figma.guid),
        actualGuid,
      );
    }
  } else if (firstLocalID !== undefined && sessionID !== undefined) {
    const fullPathToNode = new Map<string, string>();
    let fullIndex = 0;
    const walkFull = (node: FigmaTreeNode) => {
      if (node.figma.guid) {
        fullPathToNode.set(
          `${sessionID}:${firstLocalID + fullIndex}`,
          guidToString(node.figma.guid),
        );
      }
      fullIndex += 1;
      const sortedChildren = [...node.children].sort(
        (left, right) =>
          (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
      );
      for (const child of sortedChildren) {
        walkFull(child);
      }
    };
    for (const child of [...symbolNode.children].sort(
      (left, right) =>
        (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
    )) {
      walkFull(child);
    }

    const rootGuid = symbolNode.figma.guid
      ? guidToString(symbolNode.figma.guid)
      : "";
    const rootPathToNode = new Map<string, string>();
    let rootIndex = 0;
    const walkRoot = (node: FigmaTreeNode) => {
      if (node.figma.guid) {
        rootPathToNode.set(
          `${sessionID}:${firstLocalID + rootIndex}`,
          guidToString(node.figma.guid),
        );
      }
      rootIndex += 1;
      const sortedChildren = [...node.children].sort(
        (left, right) =>
          (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
      );
      for (const child of sortedChildren) {
        walkRoot(child);
      }
    };
    walkRoot(symbolNode);

    for (const [pathKey, nodeGuid] of fullPathToNode) {
      pathToNodeGuid.set(pathKey, nodeGuid);
    }
    for (const [pathKey, entry] of derivedMap) {
      if (pathKey.includes("/")) {
        continue;
      }
      const nodeGuid = fullPathToNode.get(pathKey);
      if (nodeGuid) {
        nodeDerived.set(nodeGuid, entry);
      }
    }
    for (const [pathKey, overrideEntry] of overrideMap) {
      if (pathKey.includes("/")) {
        continue;
      }
      if (rootPathToNode.get(pathKey) === rootGuid) {
        continue;
      }
      const nodeGuid = fullPathToNode.get(pathKey);
      if (nodeGuid) {
        nodeOverride.set(nodeGuid, overrideEntry);
      }
    }
  } else {
    for (
      let index = 0;
      index < Math.min(flatSymbol.length, safeDerived.length);
      index += 1
    ) {
      const node = flatSymbol[index];
      const entry = safeDerived[index];
      if (!node?.figma.guid || !entry?.guidPath?.guids?.length) {
        continue;
      }
      const actualGuid = guidToString(node.figma.guid);
      const pathKey = guidPathKey(entry.guidPath.guids);
      resolveToNode(pathKey, actualGuid);
      if (entry.guidPath.guids.length === 1) {
        pathToNodeGuid.set(
          guidToString(entry.guidPath.guids[0] ?? node.figma.guid),
          actualGuid,
        );
      }
    }
  }

  if (pathToNodeGuid.size === 0) {
    const nestedRootGuids = new Set<string>();
    for (const entry of [...safeOverrides, ...safeDerived]) {
      const firstGuid = entry.guidPath?.guids?.[0];
      if (firstGuid) {
        nestedRootGuids.add(guidToString(firstGuid));
      }
    }

    const candidateInstances = flatSymbol.filter(
      (node) =>
        node !== symbolNode &&
        (node.figma.type === "INSTANCE" || Boolean(node.figma.symbolData)) &&
        node.figma.guid,
    );

    if (
      nestedRootGuids.size > 0 &&
      candidateInstances.length > 0 &&
      (nestedRootGuids.size === candidateInstances.length ||
        candidateInstances.length === 1)
    ) {
      const orderedRootGuids = Array.from(nestedRootGuids);
      for (let index = 0; index < orderedRootGuids.length; index += 1) {
        const virtualGuid = orderedRootGuids[index];
        const candidate = candidateInstances[index];
        if (virtualGuid && candidate?.figma.guid) {
          pathToNodeGuid.set(virtualGuid, guidToString(candidate.figma.guid));
        }
      }
    }
  }

  const nestedOverrideMap = new Map<string, FigmaNodeChange[]>();
  const nestedDerivedMap = new Map<string, FigmaDerivedSymbolDataEntry[]>();

  for (const [pathKey, overrideEntry] of overrideMap) {
    if (!pathKey.includes("/")) {
      continue;
    }
    const parts = pathKey.split("/");
    const rootPath = parts[0];
    if (!rootPath) {
      continue;
    }
    const instanceGuid = pathToNodeGuid.get(rootPath) ?? rootPath;
    const childGuids = overrideEntry.guidPath?.guids?.slice(1);
    if (childGuids?.length) {
      const nestedOverride: FigmaNodeChange = {
        ...overrideEntry,
        guidPath: { guids: childGuids },
      };
      const existing = nestedOverrideMap.get(instanceGuid) ?? [];
      existing.push(nestedOverride);
      nestedOverrideMap.set(instanceGuid, existing);
    }
  }

  for (const [pathKey, entry] of derivedMap) {
    if (!pathKey.includes("/")) {
      continue;
    }
    const parts = pathKey.split("/");
    const rootPath = parts[0];
    if (!rootPath) {
      continue;
    }
    const instanceGuid = pathToNodeGuid.get(rootPath) ?? rootPath;
    const childGuids = entry.guidPath?.guids?.slice(1);
    if (childGuids?.length) {
      const nestedEntry: FigmaDerivedSymbolDataEntry = {
        ...entry,
        guidPath: { guids: childGuids },
      };
      const existing = nestedDerivedMap.get(instanceGuid) ?? [];
      existing.push(nestedEntry);
      nestedDerivedMap.set(instanceGuid, existing);
    }
  }

  const symbolOrigin = getNodeOrigin(symbolNode.figma);
  const instanceOrigin = getNodeOrigin({
    size: instanceSize ?? symbolNode.figma.size,
    transform: symbolNode.figma.transform,
  });
  const scaleX =
    instanceSize && symbolNode.figma.size?.x
      ? instanceSize.x / Math.max(1, symbolNode.figma.size.x)
      : 1;
  const scaleY =
    instanceSize && symbolNode.figma.size?.y
      ? instanceSize.y / Math.max(1, symbolNode.figma.size.y)
      : 1;

  const applyToNode = (
    node: FigmaTreeNode,
    parentPath: FigmaGUID[],
  ): FigmaTreeNode => {
    const currentGuid = node.figma.guid;
    const currentPath = currentGuid ? [...parentPath, currentGuid] : parentPath;
    const directKey = currentGuid ? guidToString(currentGuid) : "";
    const pathKey = currentPath.length > 0 ? guidPathKey(currentPath) : "";
    const directOverride =
      nodeOverride.get(directKey) ?? overrideMap.get(pathKey);
    const directDerived = nodeDerived.get(directKey) ?? derivedMap.get(pathKey);
    const nestedOverrides = nestedOverrideMap.get(directKey);
    const nestedDerived = nestedDerivedMap.get(directKey);

    const figma: FigmaNodeChange = {
      ...node.figma,
      textData: node.figma.textData
        ? { ...node.figma.textData }
        : node.figma.textData,
    };

    const fallbackTransform = applyInstanceTransform(
      node.figma.transform,
      symbolOrigin,
      instanceOrigin,
      scaleX,
      scaleY,
    );
    if (fallbackTransform) {
      figma.transform = fallbackTransform;
    }
    if (node.figma.size && instanceSize && !directDerived?.size) {
      figma.size = {
        x: Math.max(1, node.figma.size.x * scaleX),
        y: Math.max(1, node.figma.size.y * scaleY),
      };
    }

    if (directDerived) {
      if (directDerived.size) {
        figma.size = directDerived.size;
      }
      if (directDerived.transform) {
        figma.transform = directDerived.transform;
      }
      if (directDerived.fontSize !== undefined) {
        figma.fontSize = directDerived.fontSize;
      }
      if (directDerived.derivedTextData?.characters !== undefined) {
        figma.textData = {
          ...(figma.textData ?? {}),
          characters: directDerived.derivedTextData.characters,
        };
      }
    }

    if (directOverride) {
      applyOverrideToNode(figma, directOverride);
    }

    if (
      (nestedOverrides || nestedDerived) &&
      (figma.type === "INSTANCE" || figma.symbolData)
    ) {
      if (nestedOverrides) {
        const existingOverrides = figma.symbolData?.symbolOverrides ?? [];
        figma.symbolData = {
          ...figma.symbolData,
          symbolOverrides: [...existingOverrides, ...nestedOverrides],
        };
      }
      if (nestedDerived) {
        figma.derivedSymbolData = nestedDerived;
      }
    }

    const children = node.children.map((child) =>
      applyToNode(child, currentPath),
    );
    return { figma, children };
  };

  return symbolNode.children.map((child) => applyToNode(child, []));
}

function scaleTreeChildren(
  symbolNode: FigmaTreeNode,
  instanceSize: { x: number; y: number } | undefined,
): FigmaTreeNode[] {
  const symbolOrigin = getNodeOrigin(symbolNode.figma);
  const instanceOrigin = getNodeOrigin({
    size: instanceSize ?? symbolNode.figma.size,
    transform: symbolNode.figma.transform,
  });
  const scaleX =
    instanceSize && symbolNode.figma.size?.x
      ? instanceSize.x / Math.max(1, symbolNode.figma.size.x)
      : 1;
  const scaleY =
    instanceSize && symbolNode.figma.size?.y
      ? instanceSize.y / Math.max(1, symbolNode.figma.size.y)
      : 1;

  const cloneNode = (node: FigmaTreeNode): FigmaTreeNode => {
    const figma: FigmaNodeChange = {
      ...node.figma,
      transform: applyInstanceTransform(
        node.figma.transform,
        symbolOrigin,
        instanceOrigin,
        scaleX,
        scaleY,
      ),
      size: node.figma.size
        ? {
            x: Math.max(1, node.figma.size.x * scaleX),
            y: Math.max(1, node.figma.size.y * scaleY),
          }
        : node.figma.size,
      textData: node.figma.textData
        ? { ...node.figma.textData }
        : node.figma.textData,
    };
    return {
      figma,
      children: node.children.map(cloneNode),
    };
  };

  return symbolNode.children.map(cloneNode);
}

function applyOverrideToNode(
  target: FigmaNodeChange,
  override: FigmaNodeChange,
): void {
  const skipKeys = new Set([
    "guidPath",
    "guid",
    "parentIndex",
    "type",
    "phase",
    "symbolData",
    "derivedSymbolData",
  ]);

  for (const [key, value] of Object.entries(override) as Array<
    [keyof FigmaNodeChange, FigmaNodeChange[keyof FigmaNodeChange]]
  >) {
    if (skipKeys.has(key)) {
      continue;
    }
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value as unknown;
    }
  }
}

function applyInstanceTransform(
  transform: FigmaNodeChange["transform"],
  symbolOrigin: { x: number; y: number },
  instanceOrigin: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): FigmaNodeChange["transform"] {
  if (!transform) {
    return transform;
  }

  return {
    ...transform,
    m02: instanceOrigin.x + (transform.m02 - symbolOrigin.x) * scaleX,
    m12: instanceOrigin.y + (transform.m12 - symbolOrigin.y) * scaleY,
  };
}

function getNodeOrigin(figma: Pick<FigmaNodeChange, "transform" | "size">): {
  x: number;
  y: number;
} {
  return {
    x: figma.transform?.m02 ?? 0,
    y: figma.transform?.m12 ?? 0,
  };
}

function flattenTree(root: FigmaTreeNode): FigmaTreeNode[] {
  const nodes: FigmaTreeNode[] = [];
  const visit = (node: FigmaTreeNode) => {
    nodes.push(node);
    const sortedChildren = [...node.children].sort(
      (left, right) =>
        (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
    );
    for (const child of sortedChildren) {
      visit(child);
    }
  };
  visit(root);
  return nodes;
}

function guidPathKey(guids: FigmaGUID[]): string {
  return guids.map((guid) => guidToString(guid)).join("/");
}

function isSameGuid(
  left: FigmaGUID | undefined,
  right: FigmaGUID | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function pushFigmaWarnings(
  figma: FigmaNodeChange,
  warnings: FigmaNativeWarning[],
): void {
  const originNodeId = figma.guid ? guidToString(figma.guid) : undefined;
  const originNodeType = figma.type;

  if (figma.stackMode && figma.stackMode !== "NONE") {
    warnings.push({
      code: "layout_degraded",
      message: `Figma 自动布局 "${figma.name ?? originNodeType ?? "Unnamed"}" 已映射到画布 layout/sizing 字段，部分 Figma 行为可能仍与运行时布局存在差异。`,
      originNodeId,
      originNodeType,
    });
  }

  // Effects are now converted via convertFigmaEffects() — no longer dropped.

  if (figma.type === "SYMBOL" || figma.type === "INSTANCE") {
    warnings.push({
      code: "component_editability_limited",
      message: `Figma 组件/实例 "${figma.name ?? "Unnamed"}" 已保留引用/override 元数据，但当前仍以内联可编辑节点呈现，variant 重连能力有限。`,
      originNodeId,
      originNodeType,
    });
  }

  if (
    hasComplexPaint(figma.fillPaints) ||
    hasComplexPaint(figma.strokePaints)
  ) {
    warnings.push({
      code: "partial_fidelity",
      message: `Figma 节点 "${figma.name ?? originNodeType ?? "Unnamed"}" 包含渐变或复杂图像填充，当前按基础样式导入。`,
      originNodeId,
      originNodeType,
    });
  }
}

function createFigmaMeta(
  figma: FigmaNodeChange,
  options?: {
    degradationHints?: string[];
    parentStackMode?: FigmaNodeChange["stackMode"];
    vectorFallback?: boolean;
  },
): CanvasImportedNodeMeta {
  const autoLayout = getFigmaAutoLayoutMeta(figma, options?.parentStackMode);
  const styleRefs = getFigmaStyleRefs(figma);
  const componentRef = mapFigmaNativeComponentRef(figma);
  const variableRefs = getFigmaVariableRefs(figma);
  return {
    source: "figma-paste",
    originNodeType: "figma-native",
    originNodeId: figma.guid ? guidToString(figma.guid) : undefined,
    figmaNodeType: figma.type,
    degradationHints: options?.degradationHints,
    autoLayout,
    ...(options?.vectorFallback
      ? { vectorFallback: getFigmaVectorFallbackMeta(figma) }
      : {}),
    ...(styleRefs ? { figmaStyleRefs: styleRefs } : {}),
    ...(componentRef ? { figmaComponentRef: componentRef } : {}),
    ...(variableRefs ? { figmaVariableRefs: variableRefs } : {}),
  };
}

function getFigmaVectorFallbackMeta(
  figma: FigmaNodeChange,
): Record<string, unknown> {
  const booleanOperation =
    (figma as Record<string, unknown>).booleanOperation ??
    (figma as Record<string, unknown>).booleanOperationType ??
    (figma as Record<string, unknown>).operation;
  const fillWindingRules = figma.fillGeometry
    ?.map((path) => path.windingRule)
    .filter(Boolean);
  const strokeWindingRules = figma.strokeGeometry
    ?.map((path) => path.windingRule)
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

export function getFigmaAutoLayoutMeta(
  figma: FigmaNodeChange,
  parentStackMode?: FigmaNodeChange["stackMode"],
): CanvasImportedAutoLayoutMeta | undefined {
  const meta: CanvasImportedAutoLayoutMeta = {};
  if (figma.stackMode && figma.stackMode !== "NONE") {
    meta.layout = figma.stackMode === "HORIZONTAL" ? "horizontal" : "vertical";
    if (
      figma.stackSpacing !== undefined &&
      figma.stackSpacing !== 0 &&
      figma.stackPrimaryAlignItems !== "SPACE_EVENLY"
    ) {
      meta.gap = figma.stackSpacing;
    }
    const padding = getFigmaPadding(figma);
    if (padding !== undefined) {
      meta.padding = padding;
    }
    meta.justifyContent = mapFigmaJustifyContent(figma.stackPrimaryAlignItems);
    meta.alignItems = mapFigmaAlignItems(figma.stackCounterAlignItems);
    if (figma.frameMaskDisabled !== true) {
      meta.clipContent = true;
    }
  }

  meta.widthMode = mapFigmaWidthSizing(figma, parentStackMode);
  meta.heightMode = mapFigmaHeightSizing(figma, parentStackMode);

  if (
    figma.stackChildPrimaryGrow !== undefined &&
    figma.stackChildPrimaryGrow > 0
  ) {
    meta.grow = figma.stackChildPrimaryGrow;
  }
  const alignSelf = mapFigmaAlignSelf(figma.stackChildAlignSelf);
  if (alignSelf) {
    meta.alignSelf = alignSelf;
  }
  if (figma.stackPositioning) {
    meta.positioning =
      figma.stackPositioning === "ABSOLUTE" ? "absolute" : "auto";
  }

  return Object.values(meta).some((value) => value !== undefined)
    ? meta
    : undefined;
}

function getFigmaLayoutConstraints(
  figma: FigmaNodeChange,
  parentStackMode?: FigmaNodeChange["stackMode"],
): PenLayoutConstraints | undefined {
  const constraints: PenLayoutConstraints = {
    widthMode: mapFigmaWidthSizing(figma, parentStackMode),
    heightMode: mapFigmaHeightSizing(figma, parentStackMode),
    alignSelf: mapFigmaAlignSelf(figma.stackChildAlignSelf),
    positioning: figma.stackPositioning
      ? figma.stackPositioning === "ABSOLUTE"
        ? "absolute"
        : "auto"
      : undefined,
    grow:
      figma.stackChildPrimaryGrow !== undefined &&
      figma.stackChildPrimaryGrow > 0
        ? figma.stackChildPrimaryGrow
        : undefined,
  };
  return Object.values(constraints).some((value) => value !== undefined)
    ? constraints
    : undefined;
}

function getNodeBounds(figma: FigmaNodeChange): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
} {
  const x = figma.transform?.m02 ?? 0;
  const y = figma.transform?.m12 ?? 0;
  const width = Math.max(1, figma.size?.x ?? 1);
  const height = Math.max(1, figma.size?.y ?? 1);
  const rotation = figma.transform
    ? Math.round(
        (Math.atan2(figma.transform.m10, figma.transform.m00) * 180) / Math.PI,
      )
    : undefined;

  return rotation ? { x, y, width, height, rotation } : { x, y, width, height };
}

function getFigmaLayerProps(
  figma: FigmaNodeChange,
): Pick<
  ImportNode,
  | "transform"
  | "scaleX"
  | "scaleY"
  | "skewX"
  | "skewY"
  | "blendMode"
  | "flipX"
  | "flipY"
> {
  return {
    transform: normalizeFigmaTransform(figma.transform),
    ...decomposeTransform(figma.transform),
    ...extractFlip(figma.transform),
    blendMode: mapFigmaBlendMode(figma.blendMode),
  };
}

function normalizeFigmaTransform(
  transform?: FigmaMatrix,
): PenTransformMatrix | undefined {
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

function decomposeTransform(
  transform?: FigmaMatrix,
): Pick<ImportNode, "scaleX" | "scaleY" | "skewX" | "skewY"> {
  if (!transform) return {};
  const scaleX = Math.hypot(transform.m00, transform.m10);
  const scaleY = Math.hypot(transform.m01, transform.m11);
  const dot = transform.m00 * transform.m01 + transform.m10 * transform.m11;
  const skewX =
    scaleX > 0.0001 ? Math.atan2(dot, scaleX * scaleX) * (180 / Math.PI) : 0;
  const skewY =
    scaleY > 0.0001 ? Math.atan2(dot, scaleY * scaleY) * (180 / Math.PI) : 0;
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

function extractFlip(
  transform?: FigmaMatrix,
): Pick<ImportNode, "flipX" | "flipY"> {
  if (!transform) return {};
  const det = transform.m00 * transform.m11 - transform.m01 * transform.m10;
  if (det >= -0.001) return {};
  return transform.m00 < 0 ? { flipX: true } : { flipY: true };
}

function mapFigmaBlendMode(mode?: string): BlendMode | undefined {
  switch (mode) {
    case "PASS_THROUGH":
      return "pass_through";
    case "NORMAL":
      return "normal";
    case "DARKEN":
      return "darken";
    case "MULTIPLY":
      return "multiply";
    case "LINEAR_BURN":
      return "linear_burn";
    case "COLOR_BURN":
      return "color_burn";
    case "LIGHTEN":
      return "lighten";
    case "SCREEN":
      return "screen";
    case "LINEAR_DODGE":
      return "linear_dodge";
    case "COLOR_DODGE":
      return "color_dodge";
    case "OVERLAY":
      return "overlay";
    case "SOFT_LIGHT":
      return "soft_light";
    case "HARD_LIGHT":
      return "hard_light";
    case "DIFFERENCE":
      return "difference";
    case "EXCLUSION":
      return "exclusion";
    case "HUE":
      return "hue";
    case "SATURATION":
      return "saturation";
    case "COLOR":
      return "color";
    case "LUMINOSITY":
      return "luminosity";
    default:
      return undefined;
  }
}

function roundTransformNumber(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function normalizePathBounds(figma: FigmaNodeChange, path: string) {
  const bounds = getNodeBounds(figma);
  if (bounds.width > 0 && bounds.height > 0) {
    return bounds;
  }
  const computed = computeSvgPathBounds(path);
  if (!computed) {
    return bounds;
  }
  return {
    x: bounds.x + computed.minX,
    y: bounds.y + computed.minY,
    width: Math.max(1, computed.maxX - computed.minX),
    height: Math.max(1, computed.maxY - computed.minY),
  };
}

function getFigmaPadding(
  figma: FigmaNodeChange,
): CanvasImportedAutoLayoutMeta["padding"] | undefined {
  const hasHorizontal = figma.stackHorizontalPadding !== undefined;
  const hasVertical = figma.stackVerticalPadding !== undefined;
  const hasRight = figma.stackPaddingRight !== undefined;
  const hasBottom = figma.stackPaddingBottom !== undefined;

  if (!hasHorizontal && !hasVertical && !hasRight && !hasBottom) {
    if (figma.stackPadding && figma.stackPadding > 0) {
      return figma.stackPadding;
    }
    return undefined;
  }

  const top = figma.stackVerticalPadding ?? figma.stackPadding ?? 0;
  const bottom = figma.stackPaddingBottom ?? top;
  const left = figma.stackHorizontalPadding ?? figma.stackPadding ?? 0;
  const right = figma.stackPaddingRight ?? left;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }
  if (top === right && right === bottom && bottom === left) {
    return top;
  }
  if (top === bottom && left === right) {
    return [top, right];
  }
  return [top, right, bottom, left];
}

function mapFigmaJustifyContent(
  align?: FigmaNodeChange["stackPrimaryAlignItems"],
): CanvasImportedAutoLayoutMeta["justifyContent"] {
  switch (align) {
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_EVENLY":
      return "space_between";
    case "MIN":
      return "start";
    default:
      return undefined;
  }
}

function mapFigmaAlignItems(
  align?: FigmaNodeChange["stackCounterAlignItems"],
): CanvasImportedAutoLayoutMeta["alignItems"] {
  switch (align) {
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "BASELINE":
      return "baseline";
    case "MIN":
      return "start";
    default:
      return undefined;
  }
}

function mapFigmaWidthSizing(
  figma: FigmaNodeChange,
  parentStackMode?: FigmaNodeChange["stackMode"],
): CanvasImportedAutoLayoutMeta["widthMode"] {
  if (
    figma.stackPrimarySizing === "RESIZE_TO_FIT" &&
    figma.stackMode === "HORIZONTAL"
  ) {
    return "fit_content";
  }
  if (
    figma.stackCounterSizing === "RESIZE_TO_FIT" &&
    figma.stackMode === "VERTICAL"
  ) {
    return "fit_content";
  }
  if (figma.stackChildPrimaryGrow === 1 && parentStackMode === "HORIZONTAL") {
    return "fill_container";
  }
  if (
    figma.stackChildAlignSelf === "STRETCH" &&
    parentStackMode === "VERTICAL"
  ) {
    return "fill_container";
  }
  return figma.size?.x ? "fixed" : undefined;
}

function mapFigmaHeightSizing(
  figma: FigmaNodeChange,
  parentStackMode?: FigmaNodeChange["stackMode"],
): CanvasImportedAutoLayoutMeta["heightMode"] {
  if (
    figma.stackPrimarySizing === "RESIZE_TO_FIT" &&
    figma.stackMode === "VERTICAL"
  ) {
    return "fit_content";
  }
  if (
    figma.stackCounterSizing === "RESIZE_TO_FIT" &&
    figma.stackMode === "HORIZONTAL"
  ) {
    return "fit_content";
  }
  if (figma.stackChildPrimaryGrow === 1 && parentStackMode === "VERTICAL") {
    return "fill_container";
  }
  if (
    figma.stackChildAlignSelf === "STRETCH" &&
    parentStackMode === "HORIZONTAL"
  ) {
    return "fill_container";
  }
  return figma.size?.y ? "fixed" : undefined;
}

function mapFigmaAlignSelf(
  align?: FigmaNodeChange["stackChildAlignSelf"],
): CanvasImportedAutoLayoutMeta["alignSelf"] {
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
    case "AUTO":
      return "auto";
    default:
      return undefined;
  }
}

function hasComplexPaint(paints?: FigmaPaint[]): boolean {
  return Boolean(
    paints?.some(
      (paint) =>
        paint.visible !== false &&
        paint.type !== undefined &&
        paint.type !== "SOLID" &&
        paint.type !== "IMAGE" &&
        paint.type !== "GRADIENT_LINEAR" &&
        paint.type !== "GRADIENT_RADIAL" &&
        paint.type !== "GRADIENT_ANGULAR" &&
        paint.type !== "GRADIENT_DIAMOND",
    ),
  );
}

function getPaintFills(
  paints?: FigmaPaint[],
  decoded?: FigmaDecodedFile,
  state?: FigmaConvertState,
): CanvasFill[] | undefined {
  if (!paints || paints.length === 0) return undefined;
  const result: CanvasFill[] = [];
  for (const paint of paints) {
    if (paint.type === "SOLID" && paint.color) {
      result.push({
        type: "solid",
        color: figmaColorToHex(paint.color),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      });
    } else if (paint.type === "GRADIENT_LINEAR" && paint.stops) {
      const transform = normalizePaintTransform(paint.transform);
      const line = paint.transform
        ? linearGradientFromTransform(paint.transform)
        : undefined;
      result.push({
        type: "linear_gradient",
        angle: line?.angle,
        x1: line?.x1,
        y1: line?.y1,
        x2: line?.x2,
        y2: line?.y2,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      });
    } else if (paint.type === "GRADIENT_RADIAL" && paint.stops) {
      const transform = normalizePaintTransform(paint.transform);
      const radial = paint.transform
        ? radialGradientFromTransform(paint.transform)
        : undefined;
      result.push({
        type: "radial_gradient",
        cx: radial?.cx ?? 0.5,
        cy: radial?.cy ?? 0.5,
        radius: radial?.radius ?? 0.5,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      });
    } else if (paint.type === "GRADIENT_ANGULAR" && paint.stops) {
      const transform = normalizePaintTransform(paint.transform);
      const angular = paint.transform
        ? angularGradientFromTransform(paint.transform)
        : undefined;
      result.push({
        type: "angular_gradient",
        cx: angular?.cx ?? 0.5,
        cy: angular?.cy ?? 0.5,
        angle: angular?.angle,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      });
    } else if (paint.type === "GRADIENT_DIAMOND" && paint.stops) {
      const transform = normalizePaintTransform(paint.transform);
      const diamond = paint.transform
        ? diamondGradientFromTransform(paint.transform)
        : undefined;
      result.push({
        type: "diamond_gradient",
        cx: diamond?.cx ?? 0.5,
        cy: diamond?.cy ?? 0.5,
        radius: diamond?.radius ?? 0.5,
        angle: diamond?.angle,
        transform,
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color),
        })),
        opacity: paint.opacity,
        ...paintLayerProps(paint),
      });
    } else if (paint.type === "IMAGE") {
      const imageFill = getImagePaintFill(paint, decoded, state);
      if (imageFill) {
        result.push(imageFill);
      }
    }
  }
  return result.length > 0 ? result : undefined;
}

export function mapFigmaNativePaints(
  paints?: FigmaPaint[],
): CanvasFill[] | undefined {
  return getPaintFills(paints);
}

export function mapFigmaNativeStroke(
  figma: FigmaNodeChange,
): CanvasStroke | undefined {
  return getPaintStroke(figma);
}

function getPaintStroke(
  figma: FigmaNodeChange,
  decoded?: FigmaDecodedFile,
  state?: FigmaConvertState,
): CanvasStroke | undefined {
  if (!figma.strokePaints || figma.strokePaints.length === 0) return undefined;
  const fill = getPaintFills(figma.strokePaints, decoded, state);
  if (!fill || fill.length === 0) return undefined;
  const thickness = figma.borderStrokeWeightsIndependent
    ? ([
        figma.borderTopWeight ?? 0,
        figma.borderRightWeight ?? 0,
        figma.borderBottomWeight ?? 0,
        figma.borderLeftWeight ?? 0,
      ] as [number, number, number, number])
    : (figma.strokeWeight ?? 1);
  return {
    thickness,
    align: mapStrokeAlign(figma.strokeAlign),
    cap: mapStrokeCap(figma.strokeCap),
    join: mapStrokeJoin(figma.strokeJoin),
    dashPattern: figma.dashPattern?.length ? figma.dashPattern : undefined,
    dashOffset: figma.dashOffset,
    miterLimit: figma.strokeMiterLimit,
    fill,
  };
}

function gradientAngleFromTransform(transform: FigmaMatrix): number {
  return gradientAngleFromVector(transform.m00, transform.m10);
}

function gradientAngleFromVector(x: number, y: number): number {
  const mathAngle = Math.atan2(y, x) * (180 / Math.PI);
  return Math.round(90 - mathAngle);
}

function applyGradientTransform(
  transform: FigmaMatrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: transform.m00 * x + transform.m01 * y + transform.m02,
    y: transform.m10 * x + transform.m11 * y + transform.m12,
  };
}

function linearGradientFromTransform(transform: FigmaMatrix): {
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const start = applyGradientTransform(transform, 0, 0.5);
  const end = applyGradientTransform(transform, 1, 0.5);
  return {
    angle: gradientAngleFromVector(end.x - start.x, end.y - start.y),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
}

function radialGradientFromTransform(transform: FigmaMatrix): {
  cx: number;
  cy: number;
  radius: number;
} {
  const center = applyGradientTransform(transform, 0.5, 0.5);
  const edgeX = applyGradientTransform(transform, 1, 0.5);
  const edgeY = applyGradientTransform(transform, 0.5, 1);
  const rx = Math.hypot(edgeX.x - center.x, edgeX.y - center.y);
  const ry = Math.hypot(edgeY.x - center.x, edgeY.y - center.y);
  return {
    cx: center.x,
    cy: center.y,
    radius: Math.max(0.0001, (rx + ry) / 2),
  };
}

function angularGradientFromTransform(transform: FigmaMatrix): {
  cx: number;
  cy: number;
  angle: number;
} {
  const center = applyGradientTransform(transform, 0.5, 0.5);
  return {
    cx: center.x,
    cy: center.y,
    angle: gradientAngleFromTransform(transform),
  };
}

function diamondGradientFromTransform(transform: FigmaMatrix): {
  cx: number;
  cy: number;
  radius: number;
  angle: number;
} {
  const radial = radialGradientFromTransform(transform);
  return {
    ...radial,
    angle: gradientAngleFromTransform(transform),
  };
}

function getImagePaintFill(
  paint: FigmaPaint,
  decoded: FigmaDecodedFile | undefined,
  state: FigmaConvertState | undefined,
): CanvasFill | undefined {
  const unresolvedUrl = getUnresolvedImagePaintUrl(paint);
  const resolved =
    decoded && state
      ? resolveImagePaint(paint, decoded, state.imageAssetCache)
      : null;
  if (!resolved) {
    if (!unresolvedUrl) {
      state?.warnings.push({
        code: "partial_fidelity",
        message: "Figma 图片填充缺少可解析的图片引用，已跳过该图片填充。",
      });
      return undefined;
    }
    state?.warnings.push({
      code: "partial_fidelity",
      message:
        "Figma 图片填充缺少可解析的图片二进制，已保留图片引用占位以便后续资源修复。",
    });
  } else if (
    state &&
    !state.assets.some((asset) => asset.id === resolved.asset.id)
  ) {
    state.assets.push(resolved.asset);
  }
  const imageUrl = resolved?.url ?? unresolvedUrl;
  if (!imageUrl) {
    return undefined;
  }

  return {
    type: "image",
    url: imageUrl,
    mode: mapImageScaleMode(paint.imageScaleMode),
    originalSize: normalizeOriginalSize(
      paint.originalImageWidth,
      paint.originalImageHeight,
    ),
    transform: normalizeImageTransform(paint.transform),
    opacity: paint.opacity,
    ...paintLayerProps(paint),
  };
}

function getUnresolvedImagePaintUrl(paint: FigmaPaint): string | undefined {
  if (paint.image?.hash?.length) {
    return `__hash:${Array.from(paint.image.hash)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  if (paint.image?.dataBlob !== undefined) {
    return `__blob:${paint.image.dataBlob}`;
  }
  return undefined;
}

function paintLayerProps(paint: FigmaPaint): {
  visible?: boolean;
  blendMode?: BlendMode;
} {
  const blendMode = mapFigmaBlendMode(paint.blendMode);
  return {
    ...(paint.visible === false ? { visible: false } : {}),
    ...(blendMode ? { blendMode } : {}),
  };
}

function normalizeOriginalSize(
  width?: number,
  height?: number,
): { width: number; height: number } | undefined {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { width, height };
}

function normalizeImageTransform(
  transform?: FigmaMatrix,
): ImageTransform | undefined {
  return normalizePaintTransform(transform);
}

function normalizePaintTransform(
  transform?: FigmaMatrix,
): PaintTransform | undefined {
  if (!transform) return undefined;
  const epsilon = 0.000001;
  if (
    Math.abs(transform.m00 - 1) <= epsilon &&
    Math.abs(transform.m01) <= epsilon &&
    Math.abs(transform.m02) <= epsilon &&
    Math.abs(transform.m10) <= epsilon &&
    Math.abs(transform.m11 - 1) <= epsilon &&
    Math.abs(transform.m12) <= epsilon
  ) {
    return undefined;
  }
  return {
    m00: transform.m00,
    m01: transform.m01,
    m02: transform.m02,
    m10: transform.m10,
    m11: transform.m11,
    m12: transform.m12,
  };
}

function mapImageScaleMode(
  mode?: FigmaPaint["imageScaleMode"],
): "stretch" | "fill" | "fit" | "tile" | "crop" {
  switch (mode) {
    case "CROP":
      return "crop";
    case "FIT":
      return "fit";
    case "STRETCH":
      return "stretch";
    case "TILE":
      return "tile";
    default:
      return "fill";
  }
}

function mapStrokeAlign(
  align?: FigmaNodeChange["strokeAlign"],
): CanvasStroke["align"] {
  switch (align) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    default:
      return "center";
  }
}

function mapStrokeCap(cap?: FigmaNodeChange["strokeCap"]): CanvasStroke["cap"] {
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

function mapStrokeJoin(
  join?: FigmaNodeChange["strokeJoin"],
): CanvasStroke["join"] {
  switch (join) {
    case "MITER":
      return "miter";
    case "ROUND":
      return "round";
    case "BEVEL":
      return "bevel";
    default:
      return undefined;
  }
}

function extractFontWeight(fontName: { family?: string; style?: string }):
  | number
  | undefined {
  const style = fontName.style ?? "";
  const compact = style.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact.includes("thin") || compact.includes("100")) return 100;
  if (compact.includes("extralight") || compact.includes("200")) return 200;
  if (compact.includes("light") || compact.includes("300")) return 300;
  if (compact.includes("medium") || compact.includes("500")) return 500;
  if (compact.includes("semibold") || compact.includes("600")) return 600;
  if (compact.includes("extrabold") || compact.includes("800")) return 800;
  if (
    compact.includes("bold") ||
    compact.includes("700") ||
    compact.includes("900")
  )
    return 700;
  return undefined;
}

function mapFigmaLineHeight(figma: FigmaNodeChange): number | undefined {
  const lineHeight = figma.lineHeight;
  if (!lineHeight?.value) return undefined;
  const fontSize = figma.fontSize ?? 16;
  if (lineHeight.units === "PIXELS") {
    return Math.round((lineHeight.value / fontSize) * 1000) / 1000;
  }
  if (lineHeight.units === "PERCENT") {
    return Math.round((lineHeight.value / 100) * 1000) / 1000;
  }
  if (lineHeight.units === "RAW") {
    return Math.round(lineHeight.value * 1000) / 1000;
  }
  return undefined;
}

function mapFigmaLetterSpacing(figma: FigmaNodeChange): number | undefined {
  const letterSpacing = figma.letterSpacing;
  if (!letterSpacing?.value) return undefined;
  if (letterSpacing.units === "PIXELS") {
    return letterSpacing.value;
  }
  if (letterSpacing.units === "PERCENT") {
    const fontSize = figma.fontSize ?? 16;
    return Math.round(((fontSize * letterSpacing.value) / 100) * 100) / 100;
  }
  return undefined;
}

function mapTextGrowth(
  resize?: FigmaNodeChange["textAutoResize"],
): "auto" | "fixed-width" | "fixed-width-height" | undefined {
  switch (resize) {
    case "WIDTH_AND_HEIGHT":
      return "auto";
    case "HEIGHT":
      return "fixed-width";
    case "NONE":
      return "fixed-width-height";
    default:
      return undefined;
  }
}

function figmaColorToHex(color: FigmaColor, opacity?: number): string {
  const r = Math.round(color.r * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(color.g * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(color.b * 255)
    .toString(16)
    .padStart(2, "0");
  const alpha = Math.max(0, Math.min(1, opacity ?? color.a ?? 1));
  if (alpha >= 0.999) {
    return `#${r}${g}${b}`;
  }
  return `#${r}${g}${b}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/** Convert Figma effects to CanvasEffect[]. Hidden effects are retained for edit fidelity. */
function convertFigmaEffects(
  effects?: import("./figma-native-types.js").FigmaEffect[],
): CanvasEffect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  const mapped: CanvasEffect[] = [];
  for (const effect of effects) {
    switch (effect.type) {
      case "DROP_SHADOW":
      case "INNER_SHADOW": {
        mapped.push({
          type: "shadow",
          inner: effect.type === "INNER_SHADOW",
          offsetX: effect.offset?.x ?? 0,
          offsetY: effect.offset?.y ?? 0,
          blur: effect.radius ?? 0,
          spread: effect.spread ?? 0,
          color: effect.color
            ? figmaColorToHex({ ...effect.color, a: 1 })
            : "#000000",
          ...effectLayerProps(effect),
        });
        break;
      }
      case "FOREGROUND_BLUR": {
        mapped.push({
          type: "blur",
          radius: effect.radius ?? 0,
          ...effectLayerProps(effect),
        });
        break;
      }
      case "BACKGROUND_BLUR": {
        mapped.push({
          type: "background_blur",
          radius: effect.radius ?? 0,
          ...effectLayerProps(effect),
        });
        break;
      }
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

export function mapFigmaNativeEffects(
  effects?: import("./figma-native-types.js").FigmaEffect[],
): CanvasEffect[] | undefined {
  return convertFigmaEffects(effects);
}

function effectLayerProps(
  effect: import("./figma-native-types.js").FigmaEffect,
): {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
} {
  const blendMode = mapFigmaBlendMode(effect.blendMode);
  const opacity = effect.opacity ?? effect.color?.a;
  return {
    ...(effect.visible === false ? { visible: false } : {}),
    ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
    ...(blendMode ? { blendMode } : {}),
  };
}

function mapTextAlign(
  align?: FigmaNodeChange["textAlignHorizontal"],
): "left" | "center" | "right" | "justify" | undefined {
  switch (align) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "JUSTIFIED":
      return "justify";
    case "LEFT":
      return "left";
    default:
      return undefined;
  }
}

function mapTextAlignVertical(
  align?: FigmaNodeChange["textAlignVertical"],
): "top" | "middle" | "bottom" | undefined {
  switch (align) {
    case "TOP":
      return "top";
    case "CENTER":
      return "middle";
    case "BOTTOM":
      return "bottom";
    default:
      return undefined;
  }
}

function buildFigmaTextContent(
  figma: FigmaNodeChange,
  decoded?: FigmaDecodedFile,
  state?: FigmaConvertState,
): string | StyledTextSegment[] {
  const text = figma.textData?.characters ?? figma.name ?? "Text";
  const styleIds = figma.textData?.characterStyleIDs;
  const table = figma.textData?.styleOverrideTable;
  const content =
    styleIds && table && styleIds.length > 0 && table.length > 0
      ? buildStyledTextSegments(text, styleIds, table, decoded, state)
      : text;
  return applyFigmaTextCase(content, figma.textCase);
}

function getPlainTextContent(content: string | StyledTextSegment[]): string {
  return typeof content === "string"
    ? content
    : content.map((segment) => segment.text).join("");
}

function buildStyledTextSegments(
  text: string,
  styleIds: number[],
  table: FigmaNodeChange[],
  decoded?: FigmaDecodedFile,
  state?: FigmaConvertState,
): string | StyledTextSegment[] {
  const segments: StyledTextSegment[] = [];
  let currentStyleId = styleIds[0] ?? 0;
  let segmentStart = 0;

  for (let index = 1; index <= text.length; index += 1) {
    const nextStyleId = index < styleIds.length ? (styleIds[index] ?? 0) : -1;
    if (nextStyleId === currentStyleId && index !== text.length) {
      continue;
    }
    const segmentText = text.slice(segmentStart, index);
    if (segmentText) {
      segments.push(
        buildStyledTextSegment(
          segmentText,
          currentStyleId,
          table,
          decoded,
          state,
        ),
      );
    }
    currentStyleId = nextStyleId;
    segmentStart = index;
  }

  if (
    segments.length === 0 ||
    segments.every(
      (segment) =>
        !segment.fontFamily &&
        !segment.fontSize &&
        !segment.fontWeight &&
        !segment.fontStyle &&
        !segment.fill &&
        !segment.fills &&
        !segment.underline &&
        !segment.strikethrough,
    )
  ) {
    return text;
  }
  return segments;
}

function buildStyledTextSegment(
  text: string,
  styleId: number,
  table: FigmaNodeChange[],
  decoded?: FigmaDecodedFile,
  state?: FigmaConvertState,
): StyledTextSegment {
  if (styleId === 0) {
    return { text };
  }
  const override = table[styleId] ?? table[styleId - 1];
  if (!override) {
    return { text };
  }
  const fillPaint = override.fillPaints?.find(
    (paint) => paint.visible !== false && paint.type === "SOLID" && paint.color,
  );
  const fills = getPaintFills(override.fillPaints, decoded, state);
  const textCase = mapFigmaTextCase(override.textCase);
  const casedText = applyFigmaTextCase(text, override.textCase);
  return {
    text: typeof casedText === "string" ? casedText : text,
    fontFamily: override.fontName?.family,
    fontPostScriptName: override.fontName?.postscript,
    fontSize: override.fontSize,
    fontWeight: override.fontName
      ? extractFontWeight(override.fontName)
      : undefined,
    fontStyle: override.fontName?.style?.toLowerCase().includes("italic")
      ? "italic"
      : undefined,
    fill: fillPaint?.color ? figmaColorToHex(fillPaint.color) : undefined,
    fills,
    underline: override.textDecoration === "UNDERLINE" ? true : undefined,
    strikethrough:
      override.textDecoration === "STRIKETHROUGH" ? true : undefined,
    textCase,
    lineHeight: mapFigmaLineHeight(override),
    letterSpacing: mapFigmaLetterSpacing(override),
    baselineShift: override.baselineShift,
    fontFallback: getFigmaFontFallback(override),
    openTypeFeatures: getFigmaOpenTypeFeatures(override),
  };
}

function mapFigmaListStyle(
  figma: FigmaNodeChange,
): "none" | "ordered" | "unordered" | undefined {
  const raw =
    figma.listStyle ??
    figma.listType ??
    (
      figma.hangingList as
        | { type?: "NONE" | "ORDERED" | "UNORDERED" }
        | undefined
    )?.type ??
    "NONE";
  switch (raw) {
    case "ORDERED":
      return "ordered";
    case "UNORDERED":
      return "unordered";
    case "NONE":
      return undefined;
    default:
      return undefined;
  }
}

function getFigmaOpenTypeFeatures(
  figma: FigmaNodeChange,
): Record<string, boolean | number> | undefined {
  const features = figma.openTypeFeatures ?? figma.opentypeFlags;
  return features && Object.keys(features).length > 0 ? features : undefined;
}

function getFigmaFontFallback(figma: FigmaNodeChange): string[] | undefined {
  const fallbackNames = figma.fontFallbacks ?? figma.fallbackFontNames;
  const families =
    fallbackNames
      ?.map((font) => font.family ?? font.postscript)
      .filter((font): font is string => Boolean(font)) ?? [];
  return families.length > 0 ? families : undefined;
}

function applyFigmaTextCase(
  content: string | StyledTextSegment[],
  textCase?: FigmaNodeChange["textCase"],
): string | StyledTextSegment[] {
  if (!textCase || textCase === "ORIGINAL") {
    return content;
  }
  const transform = (value: string): string => {
    switch (textCase) {
      case "UPPER":
        return value.toUpperCase();
      case "LOWER":
        return value.toLowerCase();
      case "TITLE":
        return value.replace(/\b\w/g, (char) => char.toUpperCase());
      default:
        return value;
    }
  };
  return typeof content === "string"
    ? transform(content)
    : content.map((segment) =>
        segment.textCase
          ? segment
          : {
              ...segment,
              text: transform(segment.text),
            },
      );
}

function mapFigmaTextCase(
  textCase?: FigmaNodeChange["textCase"],
): "original" | "upper" | "lower" | "title" | undefined {
  switch (textCase) {
    case "ORIGINAL":
      return "original";
    case "UPPER":
      return "upper";
    case "LOWER":
      return "lower";
    case "TITLE":
      return "title";
    default:
      return undefined;
  }
}

function resolveImagePaint(
  paint: FigmaPaint,
  decoded: FigmaDecodedFile,
  cache: Map<string, { asset: CanvasAsset; url: string }>,
): { asset: CanvasAsset; url: string } | null {
  const refKey = getImageReferenceKey(paint);
  if (!refKey) {
    return null;
  }
  const cached = cache.get(refKey);
  if (cached) {
    return cached;
  }

  const bytes = getImageBytes(paint, decoded);
  if (!bytes) {
    return null;
  }

  const mimeType = inferImageMimeType(bytes);
  const dataUrl = bytesToDataUrl(bytes, mimeType);
  const asset: CanvasAsset = {
    id: createNodeId("asset"),
    url: dataUrl,
    mimeType,
    name: "figma-paste-image",
    width: paint.originalImageWidth,
    height: paint.originalImageHeight,
    source: "upload",
  };
  const resolved = { asset, url: dataUrl };
  cache.set(refKey, resolved);
  return resolved;
}

function getImageReferenceKey(paint: FigmaPaint): string | null {
  if (paint.image?.hash?.length) {
    return `hash:${Array.from(paint.image.hash)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  if (paint.image?.dataBlob !== undefined) {
    return `blob:${paint.image.dataBlob}`;
  }
  return null;
}

function getImageBytes(
  paint: FigmaPaint,
  decoded: FigmaDecodedFile,
): Uint8Array | null {
  if (paint.image?.hash?.length) {
    const hash = Array.from(paint.image.hash)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const image = decoded.imageFiles.get(hash);
    if (image) {
      return image;
    }
  }
  if (paint.image?.dataBlob !== undefined) {
    const blob = decoded.blobs[paint.image.dataBlob];
    if (blob instanceof Uint8Array) {
      return blob;
    }
  }
  return null;
}

function inferImageMimeType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    return "image/gif";
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49) {
    return "image/webp";
  }
  return "image/png";
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function dedupeWarnings(warnings: FigmaNativeWarning[]): FigmaNativeWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = [
      warning.code,
      warning.message,
      warning.originNodeId ?? "",
      warning.originNodeType ?? "",
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function transfer8to32(fileByte: Uint8Array, start: number): void {
  uint8[0] = fileByte[start] ?? 0;
  uint8[1] = fileByte[start + 1] ?? 0;
  uint8[2] = fileByte[start + 2] ?? 0;
  uint8[3] = fileByte[start + 3] ?? 0;
}

function readUint32(fileByte: Uint8Array, start: number): number {
  transfer8to32(fileByte, start);
  return uint32[0] ?? 0;
}

function hasFigKiwiMagic(bytes: Uint8Array): boolean {
  return FIG_KIWI_MAGIC.every((value, index) => bytes[index] === value);
}

function isZstd(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === ZSTD_MAGIC[0] &&
    bytes[1] === ZSTD_MAGIC[1] &&
    bytes[2] === ZSTD_MAGIC[2] &&
    bytes[3] === ZSTD_MAGIC[3]
  );
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 && bytes[0] === PNG_MAGIC_0 && bytes[1] === PNG_MAGIC_1
  );
}

function decompressChunk(bytes: Uint8Array): Uint8Array {
  if (isPng(bytes)) {
    return bytes;
  }

  if (isZstd(bytes)) {
    return zstdDecompress(bytes);
  }

  try {
    return UZIP.inflateRaw(bytes) as Uint8Array<ArrayBuffer>;
  } catch {
    try {
      return zstdDecompress(bytes);
    } catch {
      return bytes;
    }
  }
}

function findDecoder(
  schemaHelper: Record<string, unknown>,
): (bb: ByteBuffer) => unknown {
  if (typeof schemaHelper.decodeMessage === "function") {
    return schemaHelper.decodeMessage as (bb: ByteBuffer) => unknown;
  }

  for (const [key, value] of Object.entries(schemaHelper)) {
    if (key.startsWith("decode") && typeof value === "function") {
      return value as (bb: ByteBuffer) => unknown;
    }
  }

  throw new Error("No decode method found in compiled fig schema");
}

function guidToString(guid: FigmaGUID): string {
  return `${guid.sessionID}:${guid.localID}`;
}

function decodeFigmaVectorPath(
  figma: FigmaNodeChange,
  blobs: (Uint8Array | string)[],
): string | null {
  const hasVisibleFills = figma.fillPaints?.some(
    (paint) => paint.visible !== false,
  );
  const hasVisibleStrokes = figma.strokePaints?.some(
    (paint) => paint.visible !== false,
  );
  const geometries =
    !hasVisibleFills && hasVisibleStrokes
      ? (figma.strokeGeometry ?? figma.fillGeometry)
      : (figma.fillGeometry ?? figma.strokeGeometry);

  if (!geometries?.length) {
    return decodeVectorNetworkBlob(figma, blobs);
  }

  const parts: string[] = [];
  for (const geometry of geometries) {
    if (geometry.commandsBlob == null) {
      continue;
    }
    const blob = blobs[geometry.commandsBlob];
    if (!(blob instanceof Uint8Array)) {
      continue;
    }
    const decoded = decodeFigmaPathBlob(blob);
    if (decoded) {
      parts.push(decoded);
    }
  }

  if (parts.length === 0) {
    return decodeVectorNetworkBlob(figma, blobs);
  }
  return parts.join(" ");
}

function decodeFigmaPathBlob(blob: Uint8Array): string | null {
  if (blob.length < 9) {
    return null;
  }

  const buffer = new ArrayBuffer(blob.byteLength);
  new Uint8Array(buffer).set(blob);
  const view = new DataView(buffer);
  const parts: string[] = [];
  let offset = 0;

  while (offset < blob.length) {
    const command = blob[offset];
    offset += 1;

    switch (command) {
      case 0x00:
        parts.push("Z");
        break;
      case 0x01: {
        if (offset + 8 > blob.length) return joinPathParts(parts);
        const x = view.getFloat32(offset, true);
        offset += 4;
        const y = view.getFloat32(offset, true);
        offset += 4;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          parts.push(`M${roundPathNumber(x)} ${roundPathNumber(y)}`);
        }
        break;
      }
      case 0x02: {
        if (offset + 8 > blob.length) return joinPathParts(parts);
        const x = view.getFloat32(offset, true);
        offset += 4;
        const y = view.getFloat32(offset, true);
        offset += 4;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          parts.push(`L${roundPathNumber(x)} ${roundPathNumber(y)}`);
        }
        break;
      }
      case 0x03: {
        if (offset + 16 > blob.length) return joinPathParts(parts);
        const cpx = view.getFloat32(offset, true);
        offset += 4;
        const cpy = view.getFloat32(offset, true);
        offset += 4;
        const x = view.getFloat32(offset, true);
        offset += 4;
        const y = view.getFloat32(offset, true);
        offset += 4;
        if ([cpx, cpy, x, y].every(Number.isFinite)) {
          parts.push(
            `Q${roundPathNumber(cpx)} ${roundPathNumber(cpy)} ${roundPathNumber(x)} ${roundPathNumber(y)}`,
          );
        }
        break;
      }
      case 0x04: {
        if (offset + 24 > blob.length) return joinPathParts(parts);
        const cp1x = view.getFloat32(offset, true);
        offset += 4;
        const cp1y = view.getFloat32(offset, true);
        offset += 4;
        const cp2x = view.getFloat32(offset, true);
        offset += 4;
        const cp2y = view.getFloat32(offset, true);
        offset += 4;
        const x = view.getFloat32(offset, true);
        offset += 4;
        const y = view.getFloat32(offset, true);
        offset += 4;
        if ([cp1x, cp1y, cp2x, cp2y, x, y].every(Number.isFinite)) {
          parts.push(
            `C${roundPathNumber(cp1x)} ${roundPathNumber(cp1y)} ${roundPathNumber(cp2x)} ${roundPathNumber(cp2y)} ${roundPathNumber(x)} ${roundPathNumber(y)}`,
          );
        }
        break;
      }
      default:
        return joinPathParts(parts);
    }
  }

  return joinPathParts(parts);
}

function decodeVectorNetworkBlob(
  figma: FigmaNodeChange,
  blobs: (Uint8Array | string)[],
): string | null {
  const blobIndex = figma.vectorData?.vectorNetworkBlob;
  if (blobIndex == null) {
    return null;
  }
  const blob = blobs[blobIndex];
  if (!(blob instanceof Uint8Array) || blob.length < 8) {
    return null;
  }

  const buffer = new ArrayBuffer(blob.byteLength);
  new Uint8Array(buffer).set(blob);
  const view = new DataView(buffer);
  let offset = 0;

  try {
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    if (vertexCount > 100_000 || offset + vertexCount * 8 > blob.length) {
      return null;
    }

    const vertices: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < vertexCount; index += 1) {
      const x = view.getFloat32(offset, true);
      offset += 4;
      const y = view.getFloat32(offset, true);
      offset += 4;
      vertices.push({ x, y });
    }

    if (offset + 4 > blob.length) {
      return null;
    }
    const segmentCount = view.getUint32(offset, true);
    offset += 4;
    if (segmentCount > 100_000) {
      return null;
    }

    const parts: string[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      if (offset + 24 > blob.length) {
        break;
      }
      const startIndex = view.getUint32(offset, true);
      offset += 4;
      const endIndex = view.getUint32(offset, true);
      offset += 4;
      const tangentStartX = view.getFloat32(offset, true);
      offset += 4;
      const tangentStartY = view.getFloat32(offset, true);
      offset += 4;
      const tangentEndX = view.getFloat32(offset, true);
      offset += 4;
      const tangentEndY = view.getFloat32(offset, true);
      offset += 4;

      const start = vertices[startIndex];
      const end = vertices[endIndex];
      if (!start || !end) {
        continue;
      }

      const cp1x = start.x + tangentStartX;
      const cp1y = start.y + tangentStartY;
      const cp2x = end.x + tangentEndX;
      const cp2y = end.y + tangentEndY;

      if (parts.length === 0) {
        parts.push(`M${roundPathNumber(start.x)} ${roundPathNumber(start.y)}`);
      }

      if (
        Math.abs(tangentStartX) <= 0.0001 &&
        Math.abs(tangentStartY) <= 0.0001 &&
        Math.abs(tangentEndX) <= 0.0001 &&
        Math.abs(tangentEndY) <= 0.0001
      ) {
        parts.push(`L${roundPathNumber(end.x)} ${roundPathNumber(end.y)}`);
      } else {
        parts.push(
          `C${roundPathNumber(cp1x)} ${roundPathNumber(cp1y)} ${roundPathNumber(cp2x)} ${roundPathNumber(cp2y)} ${roundPathNumber(end.x)} ${roundPathNumber(end.y)}`,
        );
      }
    }

    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null;
  }
}

function roundPathNumber(value: number): string {
  return Math.abs(value) < 0.00005
    ? "0"
    : Number.parseFloat(value.toFixed(4)).toString();
}

function joinPathParts(parts: string[]): string | null {
  return parts.length > 0 ? parts.join(" ") : null;
}

function computeSvgPathBounds(
  path: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const commands = path.match(/[MLCQZ][^MLCQZ]*/gi);
  if (!commands) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const command of commands) {
    if (command[0]?.toUpperCase() === "Z") {
      continue;
    }
    const coords = command
      .slice(1)
      .trim()
      .match(/-?\d+\.?\d*/g);
    if (!coords) {
      continue;
    }
    const values = coords.map(Number);
    for (let index = 0; index < values.length - 1; index += 2) {
      const x = values[index];
      const y = values[index + 1];
      if (x === undefined || y === undefined) {
        continue;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}
