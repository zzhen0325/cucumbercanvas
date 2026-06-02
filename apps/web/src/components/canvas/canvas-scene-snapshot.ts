import {
  type CanvasBounds,
  getActiveChildren,
  getNodeBounds,
} from "@cucumber/canvas-core";
import type { ViewportState } from "@cucumber/pen-renderer";
import type { PenDocument, PenNode } from "@cucumber/pen-types";

import type {
  CanvasAppState,
  CanvasFileRecord,
  CanvasSceneElement,
} from "./canvas-api";
import { getCanvasApiRuntimeState } from "./canvas-runtime-utils";

function toSceneElement(
  node: PenNode,
  depth = 0,
  parentId: string | null = null,
  sceneBounds?: CanvasBounds,
): CanvasSceneElement {
  const b = sceneBounds ?? getNodeBounds(node);
  const nodeRecord = node as unknown as Record<string, unknown>;
  const meta = nodeRecord.meta as Record<string, unknown> | undefined;
  const customData = {
    ...(meta ?? {}),
    ...(parentId ? { containerId: parentId } : {}),
  };
  return {
    id: node.id,
    type: node.type,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    fileId:
      typeof nodeRecord.fileId === "string"
        ? nodeRecord.fileId
        : typeof nodeRecord.assetId === "string"
          ? nodeRecord.assetId
          : undefined,
    text:
      typeof nodeRecord.content === "string"
        ? nodeRecord.content
        : typeof nodeRecord.text === "string"
          ? nodeRecord.text
          : undefined,
    visible: node.visible,
    locked: node.locked,
    depth,
    customData,
  };
}

export type CanvasSceneIndex = {
  boundsById: Map<string, CanvasBounds>;
  elementById: Map<string, CanvasSceneElement>;
  elements: CanvasSceneElement[];
  nodeById: Map<string, PenNode>;
  parentIdById: Map<string, string | null>;
};

export type CanvasSceneSnapshot = {
  files: Record<string, CanvasFileRecord>;
  index: CanvasSceneIndex;
  state: CanvasAppState;
};

export function buildCanvasSceneIndex(
  doc: PenDocument,
  activePageId?: string | null,
): CanvasSceneIndex {
  const elements: CanvasSceneElement[] = [];
  const elementById = new Map<string, CanvasSceneElement>();
  const nodeById = new Map<string, PenNode>();
  const parentIdById = new Map<string, string | null>();
  const boundsById = new Map<string, CanvasBounds>();

  const walk = (
    nodes: PenNode[],
    depth: number,
    parentId: string | null,
    parentSceneX: number,
    parentSceneY: number,
  ) => {
    for (const node of nodes) {
      const localBounds = getNodeBounds(node);
      const sceneBounds = {
        ...localBounds,
        x: parentSceneX + localBounds.x,
        y: parentSceneY + localBounds.y,
      };
      nodeById.set(node.id, node);
      parentIdById.set(node.id, parentId);
      boundsById.set(node.id, sceneBounds);
      if (node.visible !== false) {
        const element = toSceneElement(node, depth, parentId, sceneBounds);
        elements.push(element);
        elementById.set(node.id, element);
      }
      if ("children" in node && Array.isArray(node.children)) {
        walk(
          node.children as PenNode[],
          depth + 1,
          node.id,
          sceneBounds.x,
          sceneBounds.y,
        );
      }
    }
  };
  walk(getActiveChildren(doc, activePageId), 0, null, 0, 0);
  return { boundsById, elementById, elements, nodeById, parentIdById };
}

export function toAppState(
  doc: PenDocument,
  selection?: string[],
  viewportOverride?: ViewportState,
): CanvasAppState {
  const runtimeState = getCanvasApiRuntimeState(doc, selection);
  const { viewport } = runtimeState;
  return {
    zoom: { value: viewportOverride?.zoom ?? viewport?.zoom ?? 1 },
    scrollX: viewportOverride?.panX ?? viewport?.x ?? 0,
    scrollY: viewportOverride?.panY ?? viewport?.y ?? 0,
    viewBackgroundColor: viewport?.backgroundColor ?? "#ffffff",
    selectedElementIds: Object.fromEntries(
      runtimeState.selection.map((id: string) => [id, true]),
    ),
  };
}

export function toFiles(doc: PenDocument): Record<string, CanvasFileRecord> {
  const { assets } = getCanvasApiRuntimeState(doc);
  return Object.fromEntries(
    Object.entries(assets).map(([id, a]) => [
      id,
      {
        id,
        dataURL: a.url,
        storageUrl: a.url,
        mimeType: a.mimeType,
        created: Date.now(),
        name: a.name,
      },
    ]),
  );
}

export function buildCanvasSceneSnapshot(
  doc: PenDocument,
  activePageId: string,
  selection: readonly string[],
  viewportOverride?: ViewportState,
): CanvasSceneSnapshot {
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const index = buildCanvasSceneIndex(doc, activePageId);
  const state = toAppState(doc, [...selection], viewportOverride);
  const files = toFiles(doc);
  const durationMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
    startedAt;
  if (durationMs > 12) {
    console.info("[skia-canvas] scene.snapshot.slow", {
      durationMs: Math.round(durationMs),
      fileCount: Object.keys(files).length,
      nodeCount: index.nodeById.size,
      selectedCount: selection.length,
      visibleCount: index.elements.length,
    });
  }
  return { files, index, state };
}

export function getSceneSnapshotCacheKey(
  version: number,
  activePageId: string,
  selection: readonly string[],
  viewport?: ViewportState,
) {
  return [
    version,
    activePageId,
    selection.join(","),
    viewport
      ? `${viewport.zoom.toFixed(4)},${viewport.panX.toFixed(2)},${viewport.panY.toFixed(2)}`
      : "no-viewport",
  ].join("|");
}
