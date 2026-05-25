import { ByteBuffer, compileSchema, decodeBinarySchema } from "kiwi-schema";
import { decompress as zstdDecompress } from "fzstd";
import * as UZIP from "uzip";

import { createCanvasNodeId } from "./document.js";
import type { CanvasEffect, CanvasFill, CanvasStroke } from "./styles.js";
import type {
  CanvasAsset,
  CanvasImportedAutoLayoutMeta,
  CanvasImportWarningCode,
  CanvasImportedNodeMeta,
} from "./types.js";
import type { ImportNode } from "./import.js";
import type {
  FigmaClipboardData,
  FigmaColor,
  FigmaDecodedFile,
  FigmaDerivedSymbolDataEntry,
  FigmaGUID,
  FigmaNodeChange,
  FigmaPaint,
  FigmaTreeNode,
} from "./figma-native-types.js";

export interface FigmaNativeWarning {
  code: CanvasImportWarningCode;
  message: string;
  originNodeId?: string;
  originNodeType?: string;
}

export interface FigmaNativeParseResult {
  rootNodeIds: string[];
  nodes: ImportNode[];
  assets: CanvasAsset[];
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
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < chars.length; index += 1) {
    B64_LOOKUP[chars.charCodeAt(index)] = index;
  }
  B64_LOOKUP["-".charCodeAt(0)] = 62;
  B64_LOOKUP["_".charCodeAt(0)] = 63;
}

export function extractFigmaClipboardData(html: string): FigmaClipboardData | null {
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
    const attrMetaMatch = html.match(/data-metadata="([^"]*)"/);
    const attrBufferMatch = html.match(/data-buffer="([^"]*)"/);
    if (attrMetaMatch && attrBufferMatch) {
      metaB64 = attrMetaMatch[1]
        ?.replace(/<!--\(figmeta\)(-->)?/g, "")
        .trim() ?? null;
      bufferB64 = attrBufferMatch[1]
        ?.replace(/<!--\(figma\)(-->)?/g, "")
        .trim() ?? null;
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

export function parseFigmaClipboardNative(html: string): FigmaNativeParseResult | null {
  const clipboardData = extractFigmaClipboardData(html);
  if (!clipboardData) {
    return null;
  }

  const decoded = parseFigFile(clipboardData.buffer);
  const warnings: FigmaNativeWarning[] = [];
  resolveStyleReferences(decoded.nodeChanges);

  const treeRoots = buildTreeForClipboard(decoded.nodeChanges);
  if (treeRoots.length === 0) {
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

  const rootNodeIds: string[] = [];
  for (const root of treeRoots) {
    const rootId = convertFigmaTreeNode(root, null, decoded, state);
    if (rootId) {
      rootNodeIds.push(rootId);
    }
  }

  if (rootNodeIds.length === 0) {
    return null;
  }

  return {
    rootNodeIds,
    nodes: state.nodes,
    assets: state.assets,
    warnings: dedupeWarnings(warnings),
  };
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

    if (pointer < byteLength) bytes[pointer++] = ((a ?? 0) << 2) | ((b ?? 0) >> 4);
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
    throw new Error(`Invalid .fig file: expected at least 2 binary parts, got ${parts.length}`);
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

  const nodeChanges =
    Array.isArray((raw as { nodeChanges?: unknown[] }).nodeChanges)
      ? ((raw as { nodeChanges: FigmaNodeChange[] }).nodeChanges ?? [])
      : [];

  if (nodeChanges.length === 0) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value) && value[0] && typeof value[0] === "object" && "guid" in value[0]) {
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
  let fileBytes = new Uint8Array(fileBuffer);
  const imageFiles = new Map<string, Uint8Array>();

  if (!hasFigKiwiMagic(fileBytes)) {
    if (fileBuffer.byteLength > MAX_COMPRESSED_SIZE) {
      throw new Error("Compressed .fig file exceeds maximum size limit");
    }

    const unzipped = UZIP.parse(fileBuffer);
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
    fileBuffer = canvasFile.buffer as ArrayBuffer;
    fileBytes = new Uint8Array(fileBuffer);
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

function buildTreeForClipboard(nodeChanges: FigmaNodeChange[]): FigmaTreeNode[] {
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

function collectSymbolTree(node: FigmaTreeNode, map: Map<string, FigmaTreeNode>): void {
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
      if (!nodeChange.fontName && textStyle.fontName) nodeChange.fontName = textStyle.fontName;
      if (nodeChange.fontSize === undefined && textStyle.fontSize !== undefined) {
        nodeChange.fontSize = textStyle.fontSize;
      }
      if (!nodeChange.lineHeight && textStyle.lineHeight) nodeChange.lineHeight = textStyle.lineHeight;
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

function convertFigmaTreeNode(
  treeNode: FigmaTreeNode,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: FigmaConvertState,
  parentStackMode?: FigmaNodeChange["stackMode"],
): string | null {
  const node = treeNode.figma;
  if (node.visible === false || !node.type || node.type === "CANVAS" || node.type === "DOCUMENT") {
    return null;
  }

  pushFigmaWarnings(node, state.warnings);

  switch (node.type) {
    case "GROUP":
    case "FRAME":
    case "SECTION":
      return convertFigmaGroupLike(treeNode, parentId, decoded, state, parentStackMode);
    case "INSTANCE":
      return convertFigmaInstance(treeNode, parentId, decoded, state, parentStackMode);
    case "SYMBOL":
      return convertFigmaGroupLike(treeNode, parentId, decoded, state, parentStackMode);
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return convertFigmaRectangle(node, parentId, decoded, state, parentStackMode);
    case "ELLIPSE":
      return convertFigmaEllipse(node, parentId, state, parentStackMode);
    case "LINE":
      return convertFigmaLine(node, parentId, state, parentStackMode);
    case "TEXT":
      return convertFigmaText(node, parentId, state, parentStackMode);
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "REGULAR_POLYGON":
      return convertFigmaVector(node, parentId, decoded, state, parentStackMode);
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
  const groupId = createCanvasNodeId("group");
  const childIds: string[] = [];

  const frameFill = getPrimaryVisiblePaint(figma.fillPaints ?? figma.backgroundPaints);
  if (frameFill && frameFill.type !== "IMAGE" && bounds.width > 0 && bounds.height > 0) {
    const backgroundId = createCanvasNodeId("rectangle");
    state.nodes.push({
      id: backgroundId,
      type: "rectangle",
      parentId: groupId,
      title: `${figma.name ?? "Frame"} background`,
      bounds,
      fills: getPaintFills([frameFill]),
      stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints), figma.strokeWeight),
      cornerRadius: figma.cornerRadius,
      locked: figma.locked,
      visible: figma.visible,
      effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
    });
    childIds.push(backgroundId);
  }

  for (const child of treeNode.children) {
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

  if (childIds.length === 0) {
    return null;
  }

  state.nodes.push({
    id: groupId,
    type: "group",
    parentId,
    title: figma.name ?? figma.type ?? "Imported group",
    bounds,
    childrenOrder: childIds,
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return groupId;
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

  return convertFigmaGroupLike(treeNode, parentId, decoded, state, parentStackMode);
}

function convertFigmaRectangle(
  figma: FigmaNodeChange,
  parentId: string | null,
  decoded: FigmaDecodedFile,
  state: {
    nodes: ImportNode[];
    assets: CanvasAsset[];
    warnings: FigmaNativeWarning[];
    imageAssetCache: Map<string, { asset: CanvasAsset; url: string }>;
  },
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const imagePaint = getVisibleImagePaint(figma.fillPaints);
  if (imagePaint) {
    const resolved = resolveImagePaint(imagePaint, decoded, state.imageAssetCache);
    if (resolved) {
      state.assets.push(resolved.asset);
      const nodeId = createCanvasNodeId("image");
      state.nodes.push({
        id: nodeId,
        type: "image",
        parentId,
        title: figma.name ?? "Imported image",
        bounds: getNodeBounds(figma),
        assetId: resolved.asset.id,
        src: resolved.url,
        alt: figma.name,
        locked: figma.locked,
        visible: figma.visible,
        effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, {
          degradationHints: ["partial_fidelity"],
          parentStackMode,
        }),
      });
      return nodeId;
    }

    state.warnings.push({
      code: "partial_fidelity",
      message: `Figma 图片节点 "${figma.name ?? "Unnamed"}" 缺少可解析的图片二进制，已按占位矩形导入。`,
      originNodeId: figma.guid ? guidToString(figma.guid) : undefined,
      originNodeType: figma.type,
    });
  }

  const nodeId = createCanvasNodeId("rectangle");
  state.nodes.push({
    id: nodeId,
    type: "rectangle",
    parentId,
    title: figma.name ?? "Imported rectangle",
    bounds: getNodeBounds(figma),
    fills: getPaintFills(figma.fillPaints ?? figma.backgroundPaints),
    stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints), figma.strokeWeight),
    cornerRadius: figma.cornerRadius,
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaEllipse(
  figma: FigmaNodeChange,
  parentId: string | null,
  state: {
    nodes: ImportNode[];
  },
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createCanvasNodeId("ellipse");
  state.nodes.push({
    id: nodeId,
    type: "ellipse",
    parentId,
    title: figma.name ?? "Imported ellipse",
    bounds: getNodeBounds(figma),
    fills: getPaintFills(figma.fillPaints),
    stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints), figma.strokeWeight),
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaLine(
  figma: FigmaNodeChange,
  parentId: string | null,
  state: {
    nodes: ImportNode[];
  },
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createCanvasNodeId("line");
  state.nodes.push({
    id: nodeId,
    type: "line",
    parentId,
    title: figma.name ?? "Imported line",
    bounds: getNodeBounds(figma),
    stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints ?? figma.fillPaints), figma.strokeWeight),
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return nodeId;
}

function convertFigmaText(
  figma: FigmaNodeChange,
  parentId: string | null,
  state: {
    nodes: ImportNode[];
  },
  parentStackMode?: FigmaNodeChange["stackMode"],
): string {
  const nodeId = createCanvasNodeId("text");
  const text = figma.textData?.characters?.trim() || figma.name || "Text";
  state.nodes.push({
    id: nodeId,
    type: "text",
    parentId,
    title: text.slice(0, 24),
    text,
    fontSize: Math.max(12, figma.fontSize ?? 16),
    fontFamily: figma.fontName?.family,
    fontWeight: figma.fontName ? extractFontWeight(figma.fontName) : undefined,
    fills: getPaintFills(figma.fillPaints) ?? [{ type: "solid", color: "#111827" }],
    textAlign: mapTextAlign(figma.textAlignHorizontal),
    bounds: getNodeBounds(figma),
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
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
  const pathId = createCanvasNodeId("path");
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
      fills: getPaintFills(figma.fillPaints),
      stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints), figma.strokeWeight),
      locked: figma.locked,
      visible: figma.visible,
      effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, {
        degradationHints: ["partial_fidelity"],
        parentStackMode,
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
    bounds: normalizePathBounds(figma, path),
    fills: getPaintFills(figma.fillPaints),
    stroke: getPaintStroke(getPrimaryVisiblePaint(figma.strokePaints), figma.strokeWeight),
    locked: figma.locked,
    visible: figma.visible,
    effects: convertFigmaEffects(figma.effects),
    meta: createFigmaMeta(figma, { parentStackMode }),
  });
  return pathId;
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
    "cornerRadius",
    "effects",
    "frameMaskDisabled",
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
  if ((!derived || derived.length === 0) && (!overrides || overrides.length === 0)) {
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
  const oneLevelDerived = safeDerived.filter((entry) => (entry.guidPath?.guids.length ?? 0) === 1);
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

  if (directMatches > oneLevelDerived.length * 0.5 || oneLevelDerived.length === 0) {
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
      pathToNodeGuid.set(guidToString(entry.guidPath.guids[0] ?? node.figma.guid), actualGuid);
    }
  } else if (firstLocalID !== undefined && sessionID !== undefined) {
    const fullPathToNode = new Map<string, string>();
    let fullIndex = 0;
    const walkFull = (node: FigmaTreeNode) => {
      if (node.figma.guid) {
        fullPathToNode.set(`${sessionID}:${firstLocalID + fullIndex}`, guidToString(node.figma.guid));
      }
      fullIndex += 1;
      const sortedChildren = [...node.children].sort(
        (left, right) => (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
      );
      for (const child of sortedChildren) {
        walkFull(child);
      }
    };
    for (const child of [...symbolNode.children].sort(
      (left, right) => (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
    )) {
      walkFull(child);
    }

    const rootGuid = symbolNode.figma.guid ? guidToString(symbolNode.figma.guid) : "";
    const rootPathToNode = new Map<string, string>();
    let rootIndex = 0;
    const walkRoot = (node: FigmaTreeNode) => {
      if (node.figma.guid) {
        rootPathToNode.set(`${sessionID}:${firstLocalID + rootIndex}`, guidToString(node.figma.guid));
      }
      rootIndex += 1;
      const sortedChildren = [...node.children].sort(
        (left, right) => (left.figma.guid?.localID ?? 0) - (right.figma.guid?.localID ?? 0),
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
    for (let index = 0; index < Math.min(flatSymbol.length, safeDerived.length); index += 1) {
      const node = flatSymbol[index];
      const entry = safeDerived[index];
      if (!node?.figma.guid || !entry?.guidPath?.guids?.length) {
        continue;
      }
      const actualGuid = guidToString(node.figma.guid);
      const pathKey = guidPathKey(entry.guidPath.guids);
      resolveToNode(pathKey, actualGuid);
      if (entry.guidPath.guids.length === 1) {
        pathToNodeGuid.set(guidToString(entry.guidPath.guids[0] ?? node.figma.guid), actualGuid);
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
      (nestedRootGuids.size === candidateInstances.length || candidateInstances.length === 1)
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
    const directOverride = nodeOverride.get(directKey) ?? overrideMap.get(pathKey);
    const directDerived = nodeDerived.get(directKey) ?? derivedMap.get(pathKey);
    const nestedOverrides = nestedOverrideMap.get(directKey);
    const nestedDerived = nestedDerivedMap.get(directKey);

    const figma: FigmaNodeChange = {
      ...node.figma,
      textData: node.figma.textData ? { ...node.figma.textData } : node.figma.textData,
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

    if ((nestedOverrides || nestedDerived) && (figma.type === "INSTANCE" || figma.symbolData)) {
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

    const children = node.children.map((child) => applyToNode(child, currentPath));
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
      textData: node.figma.textData ? { ...node.figma.textData } : node.figma.textData,
    };
    return {
      figma,
      children: node.children.map(cloneNode),
    };
  };

  return symbolNode.children.map(cloneNode);
}

function applyOverrideToNode(target: FigmaNodeChange, override: FigmaNodeChange): void {
  const skipKeys = new Set([
    "guidPath",
    "guid",
    "parentIndex",
    "type",
    "phase",
    "symbolData",
    "derivedSymbolData",
    "styleIdForFill",
    "styleIdForStrokeFill",
    "styleIdForText",
    "styleIdForEffect",
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

function getNodeOrigin(
  figma: Pick<FigmaNodeChange, "transform" | "size">,
): { x: number; y: number } {
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

function isSameGuid(left: FigmaGUID | undefined, right: FigmaGUID | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function pushFigmaWarnings(figma: FigmaNodeChange, warnings: FigmaNativeWarning[]): void {
  const originNodeId = figma.guid ? guidToString(figma.guid) : undefined;
  const originNodeType = figma.type;

  if (figma.stackMode && figma.stackMode !== "NONE") {
    warnings.push({
      code: "layout_degraded",
      message: `Figma 自动布局 "${figma.name ?? originNodeType ?? "Unnamed"}" 已保留布局元数据，当前画布仍按静态几何结构导入。`,
      originNodeId,
      originNodeType,
    });
  }

  // Effects are now converted via convertFigmaEffects() — no longer dropped.

  if (figma.type === "SYMBOL" || figma.type === "INSTANCE") {
    warnings.push({
      code: "component_metadata_dropped",
      message: `Figma 组件/实例 "${figma.name ?? "Unnamed"}" 当前仅保留可编辑结构，不保留引用语义。`,
      originNodeId,
      originNodeType,
    });
  }

  if (hasComplexPaint(figma.fillPaints) || hasComplexPaint(figma.strokePaints)) {
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
  },
): CanvasImportedNodeMeta {
  const autoLayout = getFigmaAutoLayoutMeta(figma, options?.parentStackMode);
  return {
    source: "figma-paste",
    originNodeType: "figma-native",
    originNodeId: figma.guid ? guidToString(figma.guid) : undefined,
    figmaNodeType: figma.type,
    degradationHints: options?.degradationHints,
    autoLayout,
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

  if (figma.stackChildPrimaryGrow !== undefined && figma.stackChildPrimaryGrow > 0) {
    meta.grow = figma.stackChildPrimaryGrow;
  }
  const alignSelf = mapFigmaAlignSelf(figma.stackChildAlignSelf);
  if (alignSelf) {
    meta.alignSelf = alignSelf;
  }
  if (figma.stackPositioning) {
    meta.positioning = figma.stackPositioning === "ABSOLUTE" ? "absolute" : "auto";
  }

  return Object.values(meta).some((value) => value !== undefined) ? meta : undefined;
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
  const rotation =
    figma.transform
      ? Math.round((Math.atan2(figma.transform.m10, figma.transform.m00) * 180) / Math.PI)
      : undefined;

  return rotation ? { x, y, width, height, rotation } : { x, y, width, height };
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
  if (figma.stackPrimarySizing === "RESIZE_TO_FIT" && figma.stackMode === "HORIZONTAL") {
    return "fit_content";
  }
  if (figma.stackCounterSizing === "RESIZE_TO_FIT" && figma.stackMode === "VERTICAL") {
    return "fit_content";
  }
  if (figma.stackChildPrimaryGrow === 1 && parentStackMode === "HORIZONTAL") {
    return "fill_container";
  }
  if (figma.stackChildAlignSelf === "STRETCH" && parentStackMode === "VERTICAL") {
    return "fill_container";
  }
  return figma.size?.x ? "fixed" : undefined;
}

function mapFigmaHeightSizing(
  figma: FigmaNodeChange,
  parentStackMode?: FigmaNodeChange["stackMode"],
): CanvasImportedAutoLayoutMeta["heightMode"] {
  if (figma.stackPrimarySizing === "RESIZE_TO_FIT" && figma.stackMode === "VERTICAL") {
    return "fit_content";
  }
  if (figma.stackCounterSizing === "RESIZE_TO_FIT" && figma.stackMode === "HORIZONTAL") {
    return "fit_content";
  }
  if (figma.stackChildPrimaryGrow === 1 && parentStackMode === "VERTICAL") {
    return "fill_container";
  }
  if (figma.stackChildAlignSelf === "STRETCH" && parentStackMode === "HORIZONTAL") {
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

function getPrimaryVisiblePaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((paint) => paint.visible !== false);
}

function getVisibleImagePaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((paint) => paint.visible !== false && paint.type === "IMAGE");
}

function hasComplexPaint(paints?: FigmaPaint[]): boolean {
  return Boolean(
    paints?.some(
      (paint) =>
        paint.visible !== false &&
        paint.type !== undefined &&
        paint.type !== "SOLID" &&
        paint.type !== "IMAGE",
    ),
  );
}

function getPaintColor(paint?: FigmaPaint): string | undefined {
  if (!paint || paint.visible === false) {
    return undefined;
  }
  if (paint.type === "SOLID" && paint.color) {
    return figmaColorToHex(paint.color, paint.opacity);
  }
  if (paint.stops?.[0]?.color) {
    return figmaColorToHex(paint.stops[0].color, paint.opacity);
  }
  return undefined;
}

function getPaintFills(paints?: FigmaPaint[]): CanvasFill[] | undefined {
  if (!paints || paints.length === 0) return undefined;
  const result: CanvasFill[] = [];
  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (paint.type === "SOLID" && paint.color) {
      result.push({
        type: "solid",
        color: figmaColorToHex(paint.color, paint.opacity),
      });
    } else if (paint.type === "GRADIENT_LINEAR" && paint.stops) {
      result.push({
        type: "linear_gradient",
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color, paint.opacity),
        })),
      });
    } else if (paint.type === "GRADIENT_RADIAL" && paint.stops) {
      result.push({
        type: "radial_gradient",
        stops: paint.stops.map((s) => ({
          offset: s.position ?? 0,
          color: figmaColorToHex(s.color, paint.opacity),
        })),
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

function getPaintStroke(
  paint?: FigmaPaint,
  weight?: number,
): CanvasStroke | undefined {
  const color = getPaintColor(paint);
  if (!color && !weight) return undefined;
  return {
    thickness: weight ?? 1,
    align: "center",
    fill: color ? [{ type: "solid", color }] : undefined,
  };
}

function extractFontWeight(fontName: { family?: string; style?: string }): number | undefined {
  const style = fontName.style ?? "";
  if (/\b(bold|700|800|900)\b/i.test(style)) return 700;
  if (/\b(semibold|600)\b/i.test(style)) return 600;
  if (/\b(medium|500)\b/i.test(style)) return 500;
  if (/\b(light|300)\b/i.test(style)) return 300;
  if (/\b(thin|100)\b/i.test(style)) return 100;
  return undefined;
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

/** Convert Figma effects to CanvasEffect[]. Returns undefined if no visible effects. */
function convertFigmaEffects(effects?: import("./figma-native-types.js").FigmaEffect[]): CanvasEffect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  const mapped: CanvasEffect[] = [];
  for (const effect of effects) {
    if (effect.visible === false) continue;
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
          color: effect.color ? figmaColorToHex(effect.color) : "#00000040",
        });
        break;
      }
      case "FOREGROUND_BLUR": {
        mapped.push({
          type: "blur",
          radius: effect.radius ?? 0,
        });
        break;
      }
      case "BACKGROUND_BLUR": {
        mapped.push({
          type: "background_blur",
          radius: effect.radius ?? 0,
        });
        break;
      }
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

function mapTextAlign(
  align?: FigmaNodeChange["textAlignHorizontal"],
): "left" | "center" | "right" | undefined {
  switch (align) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "LEFT":
    case "JUSTIFIED":
      return "left";
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
    id: createCanvasNodeId("asset"),
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
  return bytes.length >= 2 && bytes[0] === PNG_MAGIC_0 && bytes[1] === PNG_MAGIC_1;
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

function findDecoder(schemaHelper: Record<string, unknown>): (bb: ByteBuffer) => unknown {
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
  const hasVisibleFills = figma.fillPaints?.some((paint) => paint.visible !== false);
  const hasVisibleStrokes = figma.strokePaints?.some((paint) => paint.visible !== false);
  const geometries =
    !hasVisibleFills && hasVisibleStrokes
      ? figma.strokeGeometry ?? figma.fillGeometry
      : figma.fillGeometry ?? figma.strokeGeometry;

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
  return Math.abs(value) < 0.00005 ? "0" : parseFloat(value.toFixed(4)).toString();
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

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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
