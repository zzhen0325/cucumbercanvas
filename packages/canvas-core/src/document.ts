import {
  CUCUMBER_CANVAS_SCHEMA_VERSION,
  type CanvasBounds,
  type CanvasNode,
  type CucumberCanvasDocument,
} from "./types.js";

let idCounter = 0;

export function createCanvasNodeId(prefix = "node"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function createEmptyCanvasDocument(): CucumberCanvasDocument {
  return {
    schemaVersion: CUCUMBER_CANVAS_SCHEMA_VERSION,
    nodes: {},
    rootNodeIds: [],
    assets: {},
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
      backgroundColor: "#ffffff",
    },
    selection: [],
    updatedAt: new Date().toISOString(),
  };
}

export function isCucumberCanvasDocument(
  value: unknown,
): value is CucumberCanvasDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as {
    schemaVersion?: unknown;
    nodes?: unknown;
    rootNodeIds?: unknown;
  };
  return (
    doc.schemaVersion === CUCUMBER_CANVAS_SCHEMA_VERSION &&
    typeof doc.nodes === "object" &&
    doc.nodes !== null &&
    Array.isArray(doc.rootNodeIds)
  );
}

export function normalizeCanvasDocument(
  value: unknown,
): CucumberCanvasDocument {
  if (isCucumberCanvasDocument(value)) {
    return {
      ...value,
      viewport: {
        x: value.viewport?.x ?? 0,
        y: value.viewport?.y ?? 0,
        zoom: value.viewport?.zoom ?? 1,
        backgroundColor: value.viewport?.backgroundColor ?? "#ffffff",
      },
      assets: value.assets ?? {},
      selection: value.selection ?? [],
    };
  }
  return createEmptyCanvasDocument();
}

export function getNodeChildren(
  doc: CucumberCanvasDocument,
  parentId: string | null,
): CanvasNode[] {
  if (parentId === null) {
    return doc.rootNodeIds
      .map((id) => doc.nodes[id])
      .filter(Boolean) as CanvasNode[];
  }
  const parent = doc.nodes[parentId];
  if (!parent || !("childrenOrder" in parent)) return [];
  return parent.childrenOrder
    .map((id) => doc.nodes[id])
    .filter(Boolean) as CanvasNode[];
}

export function isBoundsInside(
  inner: CanvasBounds,
  outer: CanvasBounds,
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function cloneCanvasDocument(
  doc: CucumberCanvasDocument,
): CucumberCanvasDocument {
  return {
    ...doc,
    nodes: Object.fromEntries(
      Object.entries(doc.nodes).map(([id, node]) => [
        id,
        structuredClone(node),
      ]),
    ),
    assets: structuredClone(doc.assets),
    rootNodeIds: [...doc.rootNodeIds],
    viewport: { ...doc.viewport },
    selection: [...(doc.selection ?? [])],
  };
}
