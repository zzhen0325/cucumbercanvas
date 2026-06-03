// apps/server/src/features/canvas/canvas-element-writer.ts

import {
  type CucumberCanvasDocument,
  type PenDocument,
  type PenNode,
  applyCanvasOperation,
  createNodeId,
  findNode,
  flattenNodes,
  getNodeBounds,
  isContainerNode,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";
import type { Json } from "@cucumber/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CanvasElement = Record<string, unknown>;

type CanvasQuery = {
  select: (columns: string) => CanvasQuery;
  update: (value: unknown) => CanvasQuery;
  eq: (column: string, value: unknown) => CanvasQuery;
  single: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message?: string } | null;
  }>;
  then: PromiseLike<{ error: { message?: string } | null }>["then"];
};

type StorageDownloadQuery = {
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

type CanvasElementWriterClient = {
  from: (table: string) => unknown;
  storage: { from: (bucket: string) => unknown };
};

type ImageInsertOpts = {
  canvasId: string;
  objectPath: string; // Storage path for oss:// marker (already uploaded by worker)
  width: number;
  height: number;
  mimeType: string;
  targetContainerId?: string;
  title?: string;
};

type VideoInsertOpts = {
  canvasId: string;
  signedUrl: string; // Public URL for embeddable link
  width: number;
  height: number;
  mimeType: string;
  durationSeconds?: number;
  title?: string;
  prompt?: string;
};

type Placement = { x: number; y: number; width: number; height: number };

type InsertResult = { elementId: string };

// ---------------------------------------------------------------------------
// Placement calculation (ported from apps/web/src/lib/canvas-elements.ts)
// ---------------------------------------------------------------------------

function scaleToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

function calculateAutoPlacement(
  elements: CanvasElement[],
  assetWidth: number,
  assetHeight: number,
  maxSize: number,
): Placement {
  const scaled = scaleToFit(assetWidth, assetHeight, maxSize);
  const visible = elements.filter((el) => !el.isDeleted);

  if (visible.length === 0) {
    // Empty canvas: center around origin
    return {
      x: -scaled.width / 2,
      y: -scaled.height / 2,
      width: scaled.width,
      height: scaled.height,
    };
  }

  // Place right of the rightmost element with 40px gap
  const GAP = 40;
  let maxRight = Number.NEGATIVE_INFINITY;
  let rightEdgeY = 0;
  for (const el of visible) {
    const elRight = (Number(el.x) || 0) + (Number(el.width) || 0);
    if (elRight > maxRight) {
      maxRight = elRight;
      rightEdgeY = (Number(el.y) || 0) + (Number(el.height) || 0) / 2;
    }
  }
  return {
    x: maxRight + GAP,
    y: rightEdgeY - scaled.height / 2,
    width: scaled.width,
    height: scaled.height,
  };
}

// ---------------------------------------------------------------------------
// Cucumber canvas placement helpers
// ---------------------------------------------------------------------------

function inferCucumberInsertContainerId(
  doc: CucumberCanvasDocument,
): string | null {
  const allNodes = flattenNodes(doc);
  const boundWritableContainers = allNodes.filter(
    (node) =>
      isContainerNode(node) &&
      Boolean(node.agentBinding?.permissions?.includes("write")),
  );
  if (boundWritableContainers.length === 1) {
    return boundWritableContainers[0]?.id ?? null;
  }

  const openContainers = allNodes.filter(
    (node) =>
      isContainerNode(node) && node.permissions?.isolationLevel === "open",
  );
  if (openContainers.length === 1) {
    return openContainers[0]?.id ?? null;
  }

  return null;
}

function resolveCucumberPlacement(
  doc: CucumberCanvasDocument,
  width: number,
  height: number,
  explicitPlacement?: Placement,
  targetContainerId?: string,
): { containerId: string | null; placement: Placement } {
  if (targetContainerId) {
    const target = findNode(doc, targetContainerId);
    if (!target) {
      throw new Error(
        `Target image container ${targetContainerId} does not exist on the canvas.`,
      );
    }
    const targetType = (target as PenNode).type;
    if (!isContainerNode(target)) {
      throw new Error(
        `Target image container ${targetContainerId} is type ${targetType}, but generated images can only be inserted into frame or group containers.`,
      );
    }
    if (target.visible === false) {
      throw new Error(
        `Target image container ${targetContainerId} is hidden and cannot receive generated images.`,
      );
    }
    return {
      containerId: targetContainerId,
      placement: explicitPlacement ?? {
        x: 24,
        y: 32,
        width,
        height,
      },
    };
  }

  if (explicitPlacement) {
    return {
      containerId: inferCucumberInsertContainerId(doc),
      placement: explicitPlacement,
    };
  }

  const containerId = inferCucumberInsertContainerId(doc);
  if (containerId) {
    const container = findNode(doc, containerId);
    if (container && isContainerNode(container)) {
      const cb = getNodeBounds(container);
      return {
        containerId,
        placement: {
          x: cb.x + 24,
          y: cb.y + 32,
          width,
          height,
        },
      };
    }
  }

  const nodeBoxes = flattenNodes(doc).map((node) => {
    const b = getNodeBounds(node);
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isDeleted: false,
    };
  });
  return {
    containerId: null,
    placement: calculateAutoPlacement(nodeBoxes, width, height, IMAGE_MAX_SIZE),
  };
}

// ---------------------------------------------------------------------------
// Public API — Read-Modify-Write canvas content
// ---------------------------------------------------------------------------

const CANVAS_FILES_BUCKET = "project-assets";
const IMAGE_MAX_SIZE = 600;
const VIDEO_MAX_SIZE = 800;

async function readCanvasContent(
  client: CanvasElementWriterClient,
  canvasId: string,
): Promise<CucumberCanvasDocument> {
  const { data, error } = await (client.from("canvases") as CanvasQuery)
    .select("content")
    .eq("id", canvasId)
    .single();

  if (error || !data) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }

  if (isCucumberCanvasDocument(data.content)) {
    return data.content;
  }

  throw new Error(
    `Unsupported canvas content for ${canvasId}: expected a Cucumber PenDocument with non-empty pages and a valid activePageId. Legacy flat-map/root-children canvas data is not supported in the runtime path.`,
  );
}

async function writeCanvasContent(
  client: CanvasElementWriterClient,
  canvasId: string,
  content: CucumberCanvasDocument,
): Promise<void> {
  const { error: writeError } = await (client.from("canvases") as CanvasQuery)
    .update({ content: content as unknown as Json })
    .eq("id", canvasId);

  if (writeError) {
    throw new Error(`Failed to write canvas: ${writeError.message}`);
  }
}

/**
 * Insert an image element into a canvas. Reads current content, appends element
 * with auto-placement (or explicit placement), writes it back.
 *
 * The image file is already in Supabase Storage (uploaded by worker executor).
 * Register its public URL directly so canvas persistence stays small and does
 * not serialize generated rasters into the canvases.content JSONB column.
 */
export async function insertImageElement(
  client: CanvasElementWriterClient,
  opts: ImageInsertOpts,
  explicitPlacement?: Placement,
): Promise<InsertResult> {
  const { data: urlData } = (
    client.storage.from(CANVAS_FILES_BUCKET) as StorageDownloadQuery
  ).getPublicUrl(opts.objectPath);
  const imageUrl = urlData.publicUrl;

  const content = await readCanvasContent(client, opts.canvasId);
  const sizedPlacement = explicitPlacement
    ? explicitPlacement
    : scaleToFit(opts.width, opts.height, IMAGE_MAX_SIZE);
  const { containerId, placement } = resolveCucumberPlacement(
    content,
    sizedPlacement.width,
    sizedPlacement.height,
    explicitPlacement,
    opts.targetContainerId,
  );
  const assetId = createNodeId("asset");
  const nodeId = createNodeId("image");
  const nextWithAsset: CucumberCanvasDocument = {
    ...content,
    assets: {
      ...content.assets,
      [assetId]: {
        id: assetId,
        url: imageUrl,
        mimeType: opts.mimeType,
        name: opts.title,
        width: opts.width,
        height: opts.height,
        source: "generated",
      },
    },
  };
  const nextDoc = applyCanvasOperation(nextWithAsset, {
    type: "insertNode",
    node: {
      id: nodeId,
      type: "image" as const,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      name: opts.title ?? "Generated image",
      assetId,
      src: imageUrl,
      meta: { source: "generated" },
    } as PenNode,
    ...(containerId ? { parentId: containerId } : {}),
  });

  await writeCanvasContent(client, opts.canvasId, nextDoc);
  console.log(
    `[canvas-element-writer] cucumber image inserted canvasId=${opts.canvasId} elementId=${nodeId} containerId=${containerId ?? "root"}`,
  );
  return { elementId: nodeId };
}

/**
 * Insert a video element into a canvas. Videos use the Cucumber canvas
 * `videoEmbed` node type with a link URL — no files map entry needed.
 */
export async function insertVideoElement(
  client: CanvasElementWriterClient,
  opts: VideoInsertOpts,
  explicitPlacement?: Placement,
): Promise<InsertResult> {
  const content = await readCanvasContent(client, opts.canvasId);
  const sizedPlacement = explicitPlacement
    ? explicitPlacement
    : scaleToFit(opts.width, opts.height, VIDEO_MAX_SIZE);
  const { containerId, placement } = resolveCucumberPlacement(
    content,
    sizedPlacement.width,
    sizedPlacement.height,
    explicitPlacement,
  );
  const nodeId = createNodeId("video");
  const nextDoc = applyCanvasOperation(content, {
    type: "insertNode",
    node: {
      id: nodeId,
      type: "videoEmbed" as const,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      name: opts.title ?? "Generated video",
      src: opts.signedUrl,
      mimeType: opts.mimeType,
      durationSeconds: opts.durationSeconds,
      meta: { source: "generated" },
    } as PenNode,
    ...(containerId ? { parentId: containerId } : {}),
  });

  await writeCanvasContent(client, opts.canvasId, nextDoc);
  console.log(
    `[canvas-element-writer] cucumber video inserted canvasId=${opts.canvasId} elementId=${nodeId} containerId=${containerId ?? "root"}`,
  );
  return { elementId: nodeId };
}
