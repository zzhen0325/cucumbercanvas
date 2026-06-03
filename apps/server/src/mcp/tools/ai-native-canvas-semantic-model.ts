import {
  type PenDocument,
  type PenNode,
  getNodeBounds,
  isContainerNode,
  resolveContext,
} from "@cucumber/canvas-core";

import { compactRecord } from "./ai-native-canvas-context.js";

export type IndexedCanvasNode = {
  node: PenNode;
  depth: number;
  parentId?: string;
  parentPath: string[];
};

export type SemanticWarning = {
  code: string;
  message: string;
  nodeId?: string;
  fieldPath?: string;
};

export type AssetReference = {
  nodeId: string;
  fieldPath: string;
  value: string;
  assetId?: string;
  mimeType?: string;
  source?: string;
};

export type NodeIncludeOptions = {
  includeHidden: boolean;
  includeLocked: boolean;
};

export function indexCanvasNodes(
  nodes: PenNode[],
  parentId?: string,
  parentPath: string[] = [],
  depth = 0,
): IndexedCanvasNode[] {
  const result: IndexedCanvasNode[] = [];
  for (const node of nodes) {
    const entry: IndexedCanvasNode = { node, depth, parentPath };
    if (parentId) entry.parentId = parentId;
    result.push(entry);
    if ("children" in node && Array.isArray(node.children)) {
      result.push(
        ...indexCanvasNodes(
          node.children,
          node.id,
          [...parentPath, node.id],
          depth + 1,
        ),
      );
    }
  }
  return result;
}

export function shouldIncludeCanvasNode(
  node: PenNode,
  input: NodeIncludeOptions,
) {
  if (node.visible === false && !input.includeHidden) return false;
  if (node.locked && !input.includeLocked) return false;
  return true;
}

export function addVisibilityWarnings(
  indexedNodes: IndexedCanvasNode[],
  input: NodeIncludeOptions,
  warnings: SemanticWarning[],
) {
  for (const entry of indexedNodes) {
    if (entry.node.visible === false && !input.includeHidden) {
      warnings.push({
        code: "hidden_node_omitted",
        message: `Hidden node ${entry.node.id} was omitted from semantic inspection.`,
        nodeId: entry.node.id,
        fieldPath: "visible",
      });
    }
    if (entry.node.locked && !input.includeLocked) {
      warnings.push({
        code: "locked_node_omitted",
        message: `Locked node ${entry.node.id} was omitted from semantic inspection.`,
        nodeId: entry.node.id,
        fieldPath: "locked",
      });
    }
  }
}

export function summarizeCanvasContainer(
  entry: IndexedCanvasNode,
  doc: PenDocument,
  includeRunMetadata: boolean,
) {
  const node = entry.node;
  return compactRecord({
    id: node.id,
    name: node.name ?? node.id,
    type: node.type,
    role: node.containerRole ?? [],
    bounds: getNodeBounds(node),
    parentId: entry.parentId,
    parentPath: entry.parentPath,
    childCount:
      "children" in node && Array.isArray(node.children)
        ? node.children.length
        : 0,
    contextSlots: node.contextSlots ?? {},
    effectiveContext: resolveContext(doc, node.id),
    agentBinding: node.agentBinding,
    ioPorts: node.ioPorts ?? [],
    locked: Boolean(node.locked),
    visible: node.visible !== false,
    runMetadata: includeRunMetadata
      ? compactRecord({
          createdByAgentId: node.createdByAgentId,
          runId: node.runId,
          sessionId: node.sessionId,
        })
      : undefined,
  });
}

export function summarizeCanvasNode(
  entry: IndexedCanvasNode,
  doc: PenDocument,
  includeRunMetadata: boolean,
) {
  const node = entry.node;
  return compactRecord({
    id: node.id,
    name: node.name ?? node.id,
    type: node.type,
    bounds: getNodeBounds(node),
    parentId: entry.parentId,
    parentPath: entry.parentPath,
    role: node.role,
    containerRole: node.containerRole,
    contextSlots: node.contextSlots,
    effectiveContext: isContainerNode(node)
      ? resolveContext(doc, node.id)
      : undefined,
    agentBinding: node.agentBinding,
    ioPorts: node.ioPorts,
    locked: Boolean(node.locked),
    visible: node.visible !== false,
    runMetadata: includeRunMetadata
      ? compactRecord({
          createdByAgentId: node.createdByAgentId,
          runId: node.runId,
          sessionId: node.sessionId,
        })
      : undefined,
  });
}

export function summarizeCanvasNodeFull(entry: IndexedCanvasNode) {
  return compactRecord({
    ...entry.node,
    parentId: entry.parentId,
    parentPath: entry.parentPath,
    bounds: getNodeBounds(entry.node),
  });
}

export function summarizeDataflowEdge(
  entry: IndexedCanvasNode,
  nodesById: Map<string, IndexedCanvasNode>,
  warnings: SemanticWarning[],
) {
  const node = entry.node;
  if (node.type !== "line" || !node.connector) {
    throw new Error(
      "summarizeDataflowEdge received a non-connector line node.",
    );
  }
  const start = node.connector.start;
  const end = node.connector.end;
  for (const [endpointName, endpoint] of [
    ["start", start],
    ["end", end],
  ] as const) {
    if (endpoint && !nodesById.has(endpoint.nodeId)) {
      warnings.push({
        code: "connector_endpoint_missing",
        message: `Connector ${node.id} references missing ${endpointName} node ${endpoint.nodeId}.`,
        nodeId: node.id,
        fieldPath: `connector.${endpointName}.nodeId`,
      });
    }
  }
  return compactRecord({
    id: node.id,
    name: node.name ?? node.id,
    source: start
      ? {
          nodeId: start.nodeId,
          side: start.side,
          ratio: start.ratio,
          nodeName: nodesById.get(start.nodeId)?.node.name,
        }
      : undefined,
    target: end
      ? {
          nodeId: end.nodeId,
          side: end.side,
          ratio: end.ratio,
          nodeName: nodesById.get(end.nodeId)?.node.name,
        }
      : undefined,
    routing: node.connector.routing ?? "straight",
    arrow: Boolean(node.connector.arrow),
    bounds: getNodeBounds(node),
    parentPath: entry.parentPath,
  });
}

export function collectAssetReferences(
  entries: IndexedCanvasNode[],
  doc: PenDocument,
  warnings: SemanticWarning[],
): AssetReference[] {
  const assets = Object.values(doc.assets ?? {});
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const byUrl = new Map(assets.map((asset) => [asset.url, asset]));
  const references: AssetReference[] = [];

  for (const entry of entries) {
    const node = entry.node;
    const rawNode = node as PenNode & {
      assetId?: unknown;
      fill?: unknown;
      stroke?: unknown;
    };
    const assetId =
      typeof rawNode.assetId === "string" ? rawNode.assetId : undefined;
    if (assetId) {
      const asset = byId.get(assetId);
      references.push(
        compactRecord({
          nodeId: node.id,
          fieldPath: "assetId",
          value: assetId,
          assetId: asset?.id,
          mimeType: asset?.mimeType,
          source: asset?.source,
        }) as AssetReference,
      );
      if (!asset) {
        warnings.push({
          code: "missing_asset",
          message: `Node ${node.id} references missing document asset ${assetId}.`,
          nodeId: node.id,
          fieldPath: "assetId",
        });
      }
    }

    if (node.type === "image") {
      addUrlAssetReference(
        references,
        warnings,
        node.id,
        "src",
        node.src,
        byId,
        byUrl,
      );
    }
    if (node.type === "videoEmbed") {
      addUrlAssetReference(
        references,
        warnings,
        node.id,
        "src",
        node.src,
        byId,
        byUrl,
      );
      if (node.poster) {
        addUrlAssetReference(
          references,
          warnings,
          node.id,
          "poster",
          node.poster,
          byId,
          byUrl,
        );
      }
    }
    collectImageFillReferences(
      rawNode.fill,
      node.id,
      "fill",
      references,
      warnings,
      byId,
      byUrl,
    );
    if (isRecord(rawNode.stroke)) {
      collectImageFillReferences(
        rawNode.stroke.fill,
        node.id,
        "stroke.fill",
        references,
        warnings,
        byId,
        byUrl,
      );
    }
  }

  return references;
}

export function collectVariableSummary(
  entries: IndexedCanvasNode[],
  doc: PenDocument,
) {
  const usedVariableNames = new Set<string>();
  for (const entry of entries) {
    collectVariableNames(entry.node, usedVariableNames);
  }
  const names = [...usedVariableNames].sort();
  const definitions = Object.fromEntries(
    names
      .filter((name) => doc.variables?.[name])
      .map((name) => [name, doc.variables?.[name]]),
  );
  const missingDefinitions = names.filter((name) => !doc.variables?.[name]);
  return {
    usedVariableNames: names,
    definitions,
    missingDefinitions,
    themes: doc.themes ?? {},
    styleDefinitionCount: Object.keys(doc.styleDefinitions ?? {}).length,
  };
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function collectImageFillReferences(
  value: unknown,
  nodeId: string,
  fieldPath: string,
  references: AssetReference[],
  warnings: SemanticWarning[],
  byId: Map<
    string,
    { id: string; url: string; mimeType: string; source?: string }
  >,
  byUrl: Map<
    string,
    { id: string; url: string; mimeType: string; source?: string }
  >,
) {
  if (!Array.isArray(value)) return;
  value.forEach((fill, index) => {
    if (
      !isRecord(fill) ||
      fill.type !== "image" ||
      typeof fill.url !== "string"
    ) {
      return;
    }
    addUrlAssetReference(
      references,
      warnings,
      nodeId,
      `${fieldPath}.${index}.url`,
      fill.url,
      byId,
      byUrl,
    );
  });
}

function addUrlAssetReference(
  references: AssetReference[],
  warnings: SemanticWarning[],
  nodeId: string,
  fieldPath: string,
  value: string,
  byId: Map<
    string,
    { id: string; url: string; mimeType: string; source?: string }
  >,
  byUrl: Map<
    string,
    { id: string; url: string; mimeType: string; source?: string }
  >,
) {
  const asset = byId.get(value) ?? byUrl.get(value);
  references.push(
    compactRecord({
      nodeId,
      fieldPath,
      value,
      assetId: asset?.id,
      mimeType: asset?.mimeType,
      source: asset?.source,
    }) as AssetReference,
  );
  if (!asset && looksLikeDocumentAssetReference(value)) {
    warnings.push({
      code: "missing_asset",
      message: `Node ${nodeId} references ${value}, but that asset is not present in PenDocument.assets.`,
      nodeId,
      fieldPath,
    });
  }
}

function collectVariableNames(value: unknown, names: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith("$") && value.length > 1) names.add(value.slice(1));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectVariableNames(item, names);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectVariableNames(item, names);
  }
}

function looksLikeDocumentAssetReference(value: string) {
  return (
    value.startsWith("asset:") ||
    value.startsWith("__asset:") ||
    (!value.includes("/") &&
      !value.startsWith("data:") &&
      !value.startsWith("blob:"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
