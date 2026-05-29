// @ts-nocheck
import type {
  PenDocument,
  PenNode,
  PenPage,
  PenStyleDefinition,
} from "@cucumber/pen-types";
import {
  type ConversionContext,
  collectImageBlobs,
  convertChildren,
  convertNode,
} from "./figma-node-converters.js";
import {
  type TreeNode,
  buildTree,
  buildTreeForClipboard,
  collectComponents,
  collectSymbolTree,
  guidToString,
  isUserPage,
} from "./figma-tree-builder.js";
import type {
  FigmaDecodedFile,
  FigmaImportLayoutMode,
  FigmaNodeChange,
} from "./figma-types.js";
import { mapFigmaEffects } from "./figma-effect-mapper.js";
import { mapFigmaFills } from "./figma-fill-mapper.js";
import { mapFigmaTextProps } from "./figma-text-mapper.js";

/**
 * Resolve style references (fill, stroke, text, effect) to inline properties.
 * Figma stores styles as separate nodes (styleType='FILL'|'TEXT'|'EFFECT') and
 * references them via styleIdFor* on consuming nodes.  Nodes with a style ref
 * but no inline properties need the style's values copied in.
 */
function resolveStyleReferences(nodeChanges: FigmaNodeChange[]): void {
  // Build style map from nodes with styleType
  const styleMap = new Map<string, FigmaNodeChange>();
  for (const nc of nodeChanges) {
    if ((nc as any).styleType && nc.guid) {
      styleMap.set(guidToString(nc.guid), nc);
    }
  }
  if (styleMap.size === 0) return;

  function lookupStyle(
    ref: { guid?: { sessionID: number; localID: number } } | undefined,
  ): FigmaNodeChange | undefined {
    if (!ref?.guid) return undefined;
    return styleMap.get(`${ref.guid.sessionID}:${ref.guid.localID}`);
  }

  /** Resolve style references on a single node-like object. */
  function resolveOnNode(nc: Record<string, any>) {
    // Resolve fill style
    const fillStyle = lookupStyle(nc.styleIdForFill);
    if (fillStyle?.fillPaints?.length) {
      nc.fillPaints = fillStyle.fillPaints;
    }

    // Resolve stroke fill style
    const strokeStyle = lookupStyle(nc.styleIdForStrokeFill);
    if (strokeStyle?.fillPaints?.length) {
      nc.strokePaints = strokeStyle.fillPaints;
    }

    // Resolve text style — copies font properties from the TEXT style node
    const textStyle = lookupStyle(nc.styleIdForText);
    if (textStyle) {
      if (!nc.fontName && textStyle.fontName) nc.fontName = textStyle.fontName;
      if (nc.fontSize === undefined && textStyle.fontSize !== undefined)
        nc.fontSize = textStyle.fontSize;
      if (!nc.lineHeight && textStyle.lineHeight)
        nc.lineHeight = textStyle.lineHeight;
      if (!nc.letterSpacing && textStyle.letterSpacing)
        nc.letterSpacing = textStyle.letterSpacing;
      if (!nc.textAlignHorizontal && textStyle.textAlignHorizontal)
        nc.textAlignHorizontal = textStyle.textAlignHorizontal;
      if (!nc.textDecoration && textStyle.textDecoration)
        nc.textDecoration = textStyle.textDecoration;
      if (!nc.textCase && textStyle.textCase) nc.textCase = textStyle.textCase;
      // Text style may also carry fill paints (text color)
      if (!nc.fillPaints && textStyle.fillPaints?.length)
        nc.fillPaints = textStyle.fillPaints;
    }

    // Resolve effect style
    const effectStyle = lookupStyle(nc.styleIdForEffect);
    if (effectStyle?.effects?.length && !nc.effects?.length) {
      nc.effects = effectStyle.effects;
    }
  }

  for (const nc of nodeChanges) {
    resolveOnNode(nc as Record<string, any>);
    // Also resolve style references inside instance override entries
    const overrides = nc.symbolData?.symbolOverrides;
    if (overrides) {
      for (const ov of overrides) {
        resolveOnNode(ov as Record<string, any>);
      }
    }
  }
}

export function collectFigmaStyleDefinitions(
  nodeChanges: FigmaNodeChange[],
): Record<string, PenStyleDefinition> | undefined {
  const definitions: Record<string, PenStyleDefinition> = {};

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.styleType || !nodeChange.guid) continue;
    const id = guidToString(nodeChange.guid);
    const definition: PenStyleDefinition = {
      source: "figma",
      id,
      name: nodeChange.name,
      type: mapFigmaStyleDefinitionType(nodeChange.styleType),
      fill: mapFigmaFills(nodeChange.fillPaints),
      strokeFill: mapFigmaFills(nodeChange.strokePaints),
      effects: mapFigmaEffects(nodeChange.effects),
      variableRefs: mapFigmaVariableRefs(nodeChange),
    };
    if (nodeChange.styleType === "TEXT") {
      const text = mapFigmaTextProps(nodeChange);
      const { content: _content, ...textStyle } = text;
      definition.text = removeUndefinedStyleFields(textStyle);
    }
    definitions[id] = removeUndefinedStyleFields(definition);
  }

  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

function mapFigmaStyleDefinitionType(
  styleType: NonNullable<FigmaNodeChange["styleType"]>,
): PenStyleDefinition["type"] {
  if (styleType === "TEXT") return "text";
  if (styleType === "EFFECT") return "effect";
  return "fill";
}

function mapFigmaVariableRefs(
  nodeChange: FigmaNodeChange,
): Record<string, unknown> | undefined {
  return nodeChange.variableConsumptionMap &&
    Object.keys(nodeChange.variableConsumptionMap).length > 0
    ? nodeChange.variableConsumptionMap
    : undefined;
}

function removeUndefinedStyleFields<T extends Record<string, unknown>>(
  value: T,
): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) cleaned[key] = nested;
  }
  return cleaned as T;
}

/**
 * Convert a decoded .fig file to a PenDocument.
 */
export function figmaToPenDocument(
  decoded: FigmaDecodedFile,
  fileName: string,
  pageIndex = 0,
  layoutMode: FigmaImportLayoutMode = "cucumber",
): {
  document: PenDocument;
  warnings: string[];
  imageBlobs: Map<number, Uint8Array>;
} {
  const warnings: string[] = [];

  // Resolve style references before tree building
  resolveStyleReferences(decoded.nodeChanges);
  const styleDefinitions = collectFigmaStyleDefinitions(decoded.nodeChanges);

  const tree = buildTree(decoded.nodeChanges);

  if (!tree) {
    return {
      document: { version: "1", name: fileName, children: [] },
      warnings: ["No document root found"],
      imageBlobs: new Map(),
    };
  }

  const pages = tree.children.filter(isUserPage);
  const page = pages[pageIndex] ?? pages[0];

  if (!page) {
    return {
      document: { version: "1", name: fileName, children: [] },
      warnings: ["No pages found in Figma file"],
      imageBlobs: new Map(),
    };
  }

  const componentMap = new Map<string, string>();
  const symbolTree = new Map<string, TreeNode>();
  let idCounter = 1;
  collectComponents(page, componentMap, () => `fig_${idCounter++}`);
  // Collect SYMBOL tree nodes from ALL canvases (including Figma's internal canvas
  // where master components live) so INSTANCE nodes can inline their content.
  collectSymbolTree(tree, symbolTree);

  const ctx: ConversionContext = {
    componentMap,
    symbolTree,
    warnings,
    generateId: () => `fig_${idCounter++}`,
    blobs: decoded.blobs,
    layoutMode,
  };

  const children =
    layoutMode === "preserve"
      ? normalizePreserveModeCoordinates(
          convertChildren(page, ctx),
          "single-page",
        )
      : convertChildren(page, ctx);
  const imageBlobs = collectImageBlobs(decoded.blobs);

  const pageName = page.figma.name ?? "Page 1";
  const penPage: PenPage = {
    id: `figma-page-${pageIndex}`,
    name: pageName,
    children,
  };

  return {
    document: {
      version: "1",
      name: fileName,
      styleDefinitions,
      pages: [penPage],
      children: [],
    },
    warnings,
    imageBlobs,
  };
}

/**
 * Convert ALL pages from a decoded .fig file into a single PenDocument.
 * Each page's children are placed side by side with a horizontal gap.
 */
export function figmaAllPagesToPenDocument(
  decoded: FigmaDecodedFile,
  fileName: string,
  layoutMode: FigmaImportLayoutMode = "cucumber",
): {
  document: PenDocument;
  warnings: string[];
  imageBlobs: Map<number, Uint8Array>;
} {
  const warnings: string[] = [];

  resolveStyleReferences(decoded.nodeChanges);
  const styleDefinitions = collectFigmaStyleDefinitions(decoded.nodeChanges);

  const tree = buildTree(decoded.nodeChanges);
  if (!tree) {
    return {
      document: { version: "1", name: fileName, children: [] },
      warnings: ["No document root found"],
      imageBlobs: new Map(),
    };
  }

  const allCanvases = tree.children.filter((c) => c.figma.type === "CANVAS");
  const pages = allCanvases.filter(isUserPage);
  if (pages.length === 0) {
    return {
      document: { version: "1", name: fileName, children: [] },
      warnings: ["No pages found in Figma file"],
      imageBlobs: new Map(),
    };
  }

  const componentMap = new Map<string, string>();
  const symbolTree = new Map<string, TreeNode>();
  let idCounter = 1;
  const genId = () => `fig_${idCounter++}`;
  // Only collect components from user-visible pages so that SYMBOL masters
  // living on Figma's internal canvas don't get registered.  When an INSTANCE
  // references a SYMBOL that isn't in componentMap, convertInstance will
  // inline the master's children via symbolTree instead of emitting a
  // dangling ref node.
  for (const page of pages) {
    collectComponents(page, componentMap, genId);
  }
  collectSymbolTree(tree, symbolTree);

  const penPages: PenPage[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const ctx: ConversionContext = {
      componentMap,
      symbolTree,
      warnings,
      generateId: genId,
      blobs: decoded.blobs,
      layoutMode,
    };

    const pageChildren =
      layoutMode === "preserve"
        ? normalizePreserveModeCoordinates(
            convertChildren(page, ctx),
            "all-pages",
          )
        : convertChildren(page, ctx);
    const pageName = page.figma.name ?? `Page ${i + 1}`;

    penPages.push({
      id: `figma-page-${i}`,
      name: pageName,
      children: pageChildren,
    });
  }

  const imageBlobs = collectImageBlobs(decoded.blobs);

  return {
    document: {
      version: "1",
      name: fileName,
      styleDefinitions,
      pages: penPages,
      children: [],
    },
    warnings,
    imageBlobs,
  };
}

/**
 * Get pages from a decoded .fig file.
 */
export function getFigmaPages(
  decoded: FigmaDecodedFile,
): { id: string; name: string; childCount: number }[] {
  const tree = buildTree(decoded.nodeChanges);
  if (!tree) return [];

  return tree.children.filter(isUserPage).map((c) => ({
    id: guidToString(c.figma.guid!),
    name: c.figma.name ?? "Page",
    childCount: c.children.length,
  }));
}

/**
 * Convert decoded Figma nodeChanges directly to PenNodes (without wrapping in a PenDocument).
 * Used for clipboard paste where the data may lack a DOCUMENT+CANVAS wrapper.
 */
export function figmaNodeChangesToPenNodes(
  decoded: FigmaDecodedFile,
  layoutMode: FigmaImportLayoutMode = "cucumber",
): {
  nodes: PenNode[];
  warnings: string[];
  imageBlobs: Map<number, Uint8Array>;
} {
  const warnings: string[] = [];

  resolveStyleReferences(decoded.nodeChanges);

  const tree = buildTree(decoded.nodeChanges);
  let topNodes: TreeNode[];

  if (tree) {
    const pages = tree.children.filter(isUserPage);
    const page = pages[0];
    if (page) {
      topNodes = page.children;
    } else if (tree.children.length > 0) {
      topNodes = tree.children;
    } else {
      topNodes = [];
    }
  } else {
    topNodes = buildTreeForClipboard(decoded.nodeChanges);
  }

  if (topNodes.length === 0) {
    return {
      nodes: [],
      warnings: ["No convertible nodes found"],
      imageBlobs: new Map(),
    };
  }

  const componentMap = new Map<string, string>();
  const symbolTree = new Map<string, TreeNode>();
  let idCounter = 1;
  const genId = () => `fig_${idCounter++}`;
  for (const node of topNodes) {
    collectComponents(node, componentMap, genId);
  }
  // For clipboard, also scan all available nodes for symbols
  if (tree) collectSymbolTree(tree, symbolTree);
  for (const node of topNodes) collectSymbolTree(node, symbolTree);

  const ctx: ConversionContext = {
    componentMap,
    symbolTree,
    warnings,
    generateId: genId,
    blobs: decoded.blobs,
    layoutMode,
  };

  const nodes: PenNode[] = [];
  for (const treeNode of topNodes) {
    if (treeNode.figma.visible === false) continue;
    const node = convertNode(treeNode, undefined, ctx);
    if (node) nodes.push(node);
  }

  const imageBlobs = collectImageBlobs(decoded.blobs);

  return {
    nodes:
      layoutMode === "preserve"
        ? normalizePreserveModeCoordinates(nodes, "node-changes")
        : nodes,
    warnings,
    imageBlobs,
  };
}

function normalizePreserveModeCoordinates(
  nodes: PenNode[],
  source: "single-page" | "all-pages" | "node-changes",
): PenNode[] {
  const stats = {
    source,
    rootCount: nodes.length,
    nodeCount: 0,
    adjustedNodeCount: 0,
    maxOffsetX: 0,
    maxOffsetY: 0,
  };
  const normalized = nodes.map((node) =>
    normalizePreserveModeNode(node, undefined, stats),
  );

  console.info("[pen-figma] preserve-coordinates.normalized", stats);
  return normalized;
}

function normalizePreserveModeNode(
  node: PenNode,
  coordinateParentSceneOrigin: { x: number; y: number } | undefined,
  stats: {
    nodeCount: number;
    adjustedNodeCount: number;
    maxOffsetX: number;
    maxOffsetY: number;
  },
): PenNode {
  stats.nodeCount += 1;

  const originalX = node.x ?? 0;
  const originalY = node.y ?? 0;
  const offsetX = coordinateParentSceneOrigin
    ? coordinateParentSceneOrigin.x
    : 0;
  const offsetY = coordinateParentSceneOrigin
    ? coordinateParentSceneOrigin.y
    : 0;
  let next = node;
  const record = node as PenNode & {
    x2?: number;
    y2?: number;
  };

  if (coordinateParentSceneOrigin) {
    stats.adjustedNodeCount += 1;
    stats.maxOffsetX = Math.max(stats.maxOffsetX, Math.abs(offsetX));
    stats.maxOffsetY = Math.max(stats.maxOffsetY, Math.abs(offsetY));

    next = {
      ...node,
      x: roundPreserveCoordinate(originalX - offsetX),
      y: roundPreserveCoordinate(originalY - offsetY),
      ...(record.x2 !== undefined
        ? { x2: roundPreserveCoordinate(record.x2 - offsetX) }
        : {}),
      ...(record.y2 !== undefined
        ? { y2: roundPreserveCoordinate(record.y2 - offsetY) }
        : {}),
    } as PenNode;
  }

  const children = "children" in node ? node.children : undefined;
  if (Array.isArray(children) && children.length > 0) {
    const childParentSceneOrigin = shouldNormalizeChildCoordinates(node, children)
      ? { x: originalX, y: originalY }
      : undefined;
    const normalizedChildren = children.map((child) =>
      normalizePreserveModeNode(
        child,
        childParentSceneOrigin,
        stats,
      ),
    );
    next = {
      ...next,
      children: normalizedChildren,
    } as PenNode;
  }

  return next;
}

function roundPreserveCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function shouldNormalizeChildCoordinates(
  parent: PenNode,
  children: PenNode[],
): boolean {
  const parentWidth =
    "width" in parent && typeof parent.width === "number" ? parent.width : 0;
  const parentHeight =
    "height" in parent && typeof parent.height === "number" ? parent.height : 0;
  if (parentWidth <= 0 || parentHeight <= 0) return false;

  let localOutlierCount = 0;
  let sceneFitsCount = 0;
  for (const child of children) {
    const childWidth =
      "width" in child && typeof child.width === "number" ? child.width : 0;
    const childHeight =
      "height" in child && typeof child.height === "number" ? child.height : 0;
    const childX = child.x ?? 0;
    const childY = child.y ?? 0;
    const localOutside =
      childX < 0 ||
      childY < 0 ||
      childX + childWidth > parentWidth ||
      childY + childHeight > parentHeight;
    const sceneX = childX - (parent.x ?? 0);
    const sceneY = childY - (parent.y ?? 0);
    const sceneInside =
      sceneX >= 0 &&
      sceneY >= 0 &&
      sceneX + childWidth <= parentWidth &&
      sceneY + childHeight <= parentHeight;

    if (localOutside) localOutlierCount += 1;
    if (sceneInside) sceneFitsCount += 1;
  }

  return localOutlierCount > 0 && sceneFitsCount >= localOutlierCount;
}
