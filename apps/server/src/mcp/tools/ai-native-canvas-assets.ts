import {
  type CanvasAsset,
  type CanvasBounds,
  type CanvasOperation,
  type PenDocument,
  type PenFill,
  type PenNode,
  createNodeId,
  findNode,
  flattenNodes,
  getActivePage,
  getNodeBounds,
} from "@cucumber/canvas-core";

export type CanvasAssetTypeFilter = "image" | "video" | "all";
export type CanvasAssetSourceFilter = "upload" | "generated" | "canvas-ref";
export type CanvasDocumentAsset = Omit<CanvasAsset, "source"> & {
  source?: string;
};

export type CanvasAssetReference = {
  nodeId: string;
  nodeType: string;
  fieldPath: string;
  value: string;
  assetId?: string;
  bounds: CanvasBounds;
};

export type CanvasAssetQueryResult = {
  assets: CanvasAssetQueryItem[];
  missingAssetReferences: CanvasMissingAssetReference[];
  referencedNodeIds: string[];
};

export type CanvasAssetQueryItem = CanvasDocumentAsset & {
  referencedNodeIds: string[];
  references: CanvasAssetReference[];
};

export type CanvasMissingAssetReference = {
  nodeId: string;
  nodeType: string;
  fieldPath: string;
  value: string;
  reason: string;
};

export type CanvasAssetReplacementPlan = {
  operations: CanvasOperation[];
  previousAsset: {
    assetId?: string;
    source?: string;
    fieldPath: string;
  };
  nextAsset: {
    assetId?: string;
    source: string;
    mimeType: string;
  };
  preservedBounds: CanvasBounds;
  targetNodeId: string;
  targetNodeType: string;
  updateFieldPath: string;
};

type ReferencedCanvasNode = PenNode & {
  assetId?: string;
  fill?: PenFill[];
};

export function queryCanvasAssets(args: {
  doc: PenDocument;
  nodeIds?: string[];
  pageId?: string;
  referencedOnly?: boolean;
  source?: CanvasAssetSourceFilter;
  type?: CanvasAssetTypeFilter;
}): CanvasAssetQueryResult {
  const page = getActivePage(args.doc, args.pageId);
  const allNodes = flattenNodes(args.doc, page.id);
  const targetIds = args.nodeIds?.length ? new Set(args.nodeIds) : null;
  const nodes = targetIds
    ? allNodes.filter((node) => targetIds.has(node.id))
    : allNodes;
  const assets = Object.values(args.doc.assets ?? {}) as CanvasDocumentAsset[];
  const references = collectCanvasAssetReferences(nodes, assets);
  const referencesByAssetKey = mapReferencesByAssetKey(references.references);
  const missingAssetReferences = references.missing;
  const filteredAssets = assets
    .filter((asset) => matchesAssetType(asset, args.type ?? "all"))
    .filter((asset) => !args.source || asset.source === args.source)
    .map((asset) => {
      const assetReferences = uniqueReferences([
        ...(referencesByAssetKey.get(asset.id) ?? []),
        ...(referencesByAssetKey.get(asset.url) ?? []),
      ]);
      return {
        ...asset,
        referencedNodeIds: uniqueStrings(
          assetReferences.map((reference) => reference.nodeId),
        ),
        references: assetReferences,
      };
    })
    .filter((asset) => !args.referencedOnly || asset.references.length > 0);

  return {
    assets: filteredAssets,
    missingAssetReferences,
    referencedNodeIds: uniqueStrings(
      references.references.map((reference) => reference.nodeId),
    ),
  };
}

export function buildReplaceAssetInNodePlan(args: {
  assetId?: string;
  doc: PenDocument;
  mimeType?: string;
  nodeId: string;
  pageId?: string;
  source?: CanvasAssetSourceFilter;
  url?: string;
}): CanvasAssetReplacementPlan {
  if (!args.assetId && !args.url) {
    throw new Error("replace_asset_in_node requires either assetId or url.");
  }
  const target = findNode(args.doc, args.nodeId, args.pageId);
  if (!target) {
    throw new Error(`Node ${args.nodeId} does not exist on the target page.`);
  }
  const existingAsset = args.assetId
    ? args.doc.assets?.[args.assetId]
    : undefined;
  if (args.assetId && !existingAsset && !args.url) {
    throw new Error(
      `Asset ${args.assetId} does not exist in PenDocument.assets. Provide a url to create or update this asset.`,
    );
  }
  const nextSource = args.url ?? existingAsset?.url;
  if (!nextSource) {
    throw new Error(
      "replace_asset_in_node could not resolve the next asset URL.",
    );
  }
  const nextMimeType = args.mimeType ?? existingAsset?.mimeType;
  if (!nextMimeType) {
    throw new Error(
      "replace_asset_in_node requires mimeType when creating a new asset URL.",
    );
  }
  const replacement = resolveReplacementTarget(
    target,
    nextMimeType,
    nextSource,
  );
  const assetId = args.assetId ?? createNodeId("asset");
  const operations: CanvasOperation[] = [];
  if (args.url || !existingAsset) {
    operations.push({
      type: "upsertAsset",
      asset: {
        id: assetId,
        mimeType: nextMimeType,
        source: args.source ?? "generated",
        url: nextSource,
      },
    });
  }
  operations.push({
    type: "updateNode",
    activePageId: args.pageId,
    nodeId: target.id,
    updates: replacement.updates,
  });

  return {
    operations,
    previousAsset: replacement.previousAsset,
    nextAsset: {
      assetId,
      mimeType: nextMimeType,
      source: nextSource,
    },
    preservedBounds: getNodeBounds(target),
    targetNodeId: target.id,
    targetNodeType: target.type,
    updateFieldPath: replacement.fieldPath,
  };
}

function collectCanvasAssetReferences(
  nodes: PenNode[],
  assets: CanvasDocumentAsset[],
) {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const assetUrls = new Set(assets.map((asset) => asset.url));
  const references: CanvasAssetReference[] = [];
  const missing: CanvasMissingAssetReference[] = [];

  for (const node of nodes) {
    const referencedNode = node as ReferencedCanvasNode;
    const values = collectReferenceValues(referencedNode);
    for (const value of values) {
      const assetId = assetIds.has(value.value) ? value.value : undefined;
      const isKnownAsset =
        assetIds.has(value.value) || assetUrls.has(value.value);
      if (isKnownAsset) {
        references.push({
          assetId,
          bounds: getNodeBounds(node),
          fieldPath: value.fieldPath,
          nodeId: node.id,
          nodeType: node.type,
          value: value.value,
        });
        continue;
      }
      if (looksLikeDocumentAssetReference(value.value)) {
        missing.push({
          fieldPath: value.fieldPath,
          nodeId: node.id,
          nodeType: node.type,
          reason: `Node ${node.id} references a canvas asset that is not present in PenDocument.assets.`,
          value: value.value,
        });
      }
    }
  }
  return { missing, references };
}

function collectReferenceValues(node: ReferencedCanvasNode) {
  const values: { fieldPath: string; value: string }[] = [];
  if (typeof node.assetId === "string") {
    values.push({ fieldPath: "assetId", value: node.assetId });
  }
  if (node.type === "image") {
    values.push({ fieldPath: "src", value: node.src });
  }
  if (node.type === "videoEmbed") {
    values.push({ fieldPath: "src", value: node.src });
    if (node.poster) values.push({ fieldPath: "poster", value: node.poster });
  }
  if (Array.isArray(node.fill)) {
    node.fill.forEach((paint, index) => {
      if (paint.type === "image" && typeof paint.url === "string") {
        values.push({ fieldPath: `fill.${index}.url`, value: paint.url });
      }
    });
  }
  return values;
}

function resolveReplacementTarget(
  node: PenNode,
  mimeType: string,
  nextSource: string,
): {
  fieldPath: string;
  previousAsset: CanvasAssetReplacementPlan["previousAsset"];
  updates: Partial<PenNode>;
} {
  if (node.type === "image") {
    assertMimeType(mimeType, "image", node.id);
    return {
      fieldPath: "src",
      previousAsset: { fieldPath: "src", source: node.src },
      updates: { src: nextSource } as Partial<PenNode>,
    };
  }
  if (node.type === "videoEmbed") {
    assertMimeType(mimeType, "video", node.id);
    return {
      fieldPath: "src",
      previousAsset: { fieldPath: "src", source: node.src },
      updates: { src: nextSource } as Partial<PenNode>,
    };
  }
  const fill = (node as ReferencedCanvasNode).fill;
  if (Array.isArray(fill)) {
    const imageFillIndex = fill.findIndex((paint) => paint.type === "image");
    if (imageFillIndex >= 0) {
      assertMimeType(mimeType, "image", node.id);
      const nextFill = structuredClone(fill);
      const imageFill = nextFill[imageFillIndex];
      if (!imageFill || imageFill.type !== "image") {
        throw new Error(`Node ${node.id} has an invalid image fill.`);
      }
      imageFill.url = nextSource;
      return {
        fieldPath: `fill.${imageFillIndex}.url`,
        previousAsset: {
          fieldPath: `fill.${imageFillIndex}.url`,
          source: imageFill.url,
        },
        updates: { fill: nextFill } as Partial<PenNode>,
      };
    }
  }
  throw new Error(
    `Node ${node.id} cannot consume image or video assets. Select an image node, video node, or node with an image fill.`,
  );
}

function assertMimeType(
  mimeType: string,
  expected: "image" | "video",
  nodeId: string,
) {
  if (mimeType.startsWith(`${expected}/`)) return;
  throw new Error(
    `Node ${nodeId} requires ${expected} asset input, but received mimeType ${mimeType}.`,
  );
}

function looksLikeDocumentAssetReference(value: string) {
  return value.startsWith("asset:");
}

function mapReferencesByAssetKey(references: CanvasAssetReference[]) {
  const map = new Map<string, CanvasAssetReference[]>();
  for (const reference of references) {
    const keys = reference.assetId
      ? [reference.assetId, reference.value]
      : [reference.value];
    for (const key of keys) {
      const bucket = map.get(key) ?? [];
      bucket.push(reference);
      map.set(key, bucket);
    }
  }
  return map;
}

function matchesAssetType(
  asset: CanvasDocumentAsset,
  type: CanvasAssetTypeFilter,
) {
  if (type === "all") return true;
  return asset.mimeType.startsWith(`${type}/`);
}

function uniqueReferences(references: CanvasAssetReference[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.nodeId}:${reference.fieldPath}:${reference.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
