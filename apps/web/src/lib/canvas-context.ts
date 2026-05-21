import type {
  CanvasAgentContext,
  CanvasCardRelation,
  CanvasContextRef,
} from "@cucumber/shared";

import type { CanvasSelectedElement } from "../components/canvas-editor";
import { isVideoUrl } from "./canvas-elements";

type RawCanvasElement = Record<string, any>;
type CanvasFileMap = Record<string, Record<string, unknown>>;

type CanvasAgentContextInput = {
  elements: RawCanvasElement[];
  appState: Record<string, unknown>;
  files?: CanvasFileMap;
  persistedFiles?: CanvasFileMap;
  selectedElements?: CanvasSelectedElement[];
  maxNearbyCards?: number;
};

const DEFAULT_NEARBY_LIMIT = 12;
const NEARBY_PADDING = 480;

export function buildCanvasContextRefs(
  selectedElements: CanvasSelectedElement[],
): CanvasContextRef[] {
  return selectedElements.map(buildCanvasContextRef);
}

export function buildCanvasAgentContext({
  elements,
  appState,
  files = {},
  persistedFiles = {},
  selectedElements = [],
  maxNearbyCards = DEFAULT_NEARBY_LIMIT,
}: CanvasAgentContextInput): CanvasAgentContext {
  const viewport = buildViewport(appState);
  const visibleElements = elements.filter((element) => !element.isDeleted);
  const selectedCards = buildCanvasContextRefs(selectedElements);
  const selectedIds = new Set(selectedCards.map((card) => card.elementId));
  const cards = visibleElements.map((element) =>
    buildCanvasContextRef(
      elementToSelectedElement(element, files, persistedFiles),
    ),
  );

  const nearbyCards = selectNearbyCards({
    cards,
    maxNearbyCards,
    selectedCards,
    selectedIds,
    viewport,
  });
  const cardRelations = buildCardRelations(visibleElements, [
    ...selectedCards,
    ...nearbyCards,
  ]);
  const canvasSummary = summarizeCanvasAgentContext({
    cardRelations,
    elementCount: visibleElements.length,
    nearbyCards,
    selectedCards,
    viewport,
  });

  return {
    viewport,
    selectedCards,
    nearbyCards,
    canvasSummary,
    cardRelations,
  };
}

export function summarizeCanvasSelection(
  selectedElements: CanvasSelectedElement[],
): Array<{
  id: string;
  kind: "text" | "image" | "video" | "shape";
  label: string;
}> {
  return selectedElements.map((element) => {
    if (element.type === "text") {
      return {
        id: element.id,
        kind: "text" as const,
        label: `文字: ${truncate(element.text ?? "未命名文本", 24)}`,
      };
    }

    if (element.type === "image") {
      return {
        id: element.id,
        kind: "image" as const,
        label: `图片: ${truncate(element.title ?? element.id, 24)}`,
      };
    }

    if (element.type === "embeddable" || element.type === "video") {
      return {
        id: element.id,
        kind: "video" as const,
        label: `视频: ${truncate(element.title ?? element.id, 24)}`,
      };
    }

    return {
      id: element.id,
      kind: "shape" as const,
      label: `形状: ${truncate(element.shapeType ?? element.type, 24)}`,
    };
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}

function buildCanvasContextRef(
  element: CanvasSelectedElement,
): CanvasContextRef {
  const customData = element.customData;
  const videoUrl =
    typeof customData?.videoUrl === "string"
      ? customData.videoUrl
      : element.link;
  const base = {
    elementId: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };

  if (element.type === "text" && element.text?.trim()) {
    return {
      kind: "text" as const,
      ...base,
      text: element.text.trim(),
    };
  }

  if (element.type === "image" && customData?.isVideo === true && videoUrl) {
    return {
      kind: "video" as const,
      ...base,
      url: videoUrl,
      ...(element.mimeType ? { mimeType: element.mimeType } : {}),
      ...(element.title ? { title: element.title } : {}),
      ...(typeof element.durationSeconds === "number"
        ? { durationSeconds: element.durationSeconds }
        : {}),
    };
  }

  if (element.type === "image" && (element.storageUrl || element.dataUrl)) {
    return {
      kind: "image" as const,
      ...base,
      ...(element.fileId ? { assetId: element.id } : {}),
      ...(element.storageUrl ? { storageUrl: element.storageUrl } : {}),
      ...(element.dataUrl ? { dataUrl: element.dataUrl } : {}),
      ...(element.mimeType ? { mimeType: element.mimeType } : {}),
      ...(element.title ? { title: element.title } : {}),
    };
  }

  if ((element.type === "embeddable" || element.type === "video") && videoUrl) {
    return {
      kind: "video" as const,
      ...base,
      url: videoUrl,
      ...(element.mimeType ? { mimeType: element.mimeType } : {}),
      ...(element.title ? { title: element.title } : {}),
      ...(typeof element.durationSeconds === "number"
        ? { durationSeconds: element.durationSeconds }
        : {}),
    };
  }

  return {
    kind: "shape" as const,
    ...base,
    shapeType: element.shapeType ?? element.type,
    ...(element.title ? { label: element.title } : {}),
    ...(element.text?.trim() ? { text: element.text.trim() } : {}),
  };
}

function elementToSelectedElement(
  element: RawCanvasElement,
  files: CanvasFileMap,
  persistedFiles: CanvasFileMap,
): CanvasSelectedElement {
  const customData =
    element.customData && typeof element.customData === "object"
      ? (element.customData as Record<string, unknown>)
      : undefined;
  const fileId =
    typeof element.fileId === "string" ? element.fileId : undefined;
  const file = fileId ? files[fileId] : undefined;
  const persistedFile = fileId ? persistedFiles[fileId] : undefined;
  const videoUrl =
    typeof customData?.videoUrl === "string"
      ? customData.videoUrl
      : typeof element.link === "string" && isVideoUrl(element.link)
        ? element.link
        : undefined;

  const snapshot: CanvasSelectedElement = {
    id: String(element.id),
    type:
      element.type === "image" && customData?.isVideo === true && videoUrl
        ? "video"
        : String(element.type),
    x: getNumber(element.x, 0),
    y: getNumber(element.y, 0),
    width: getNumber(element.width, 0),
    height: getNumber(element.height, 0),
    ...(customData ? { customData } : {}),
  };

  if (typeof element.text === "string" && element.text) {
    snapshot.text = element.text;
  }
  if (fileId) {
    snapshot.fileId = fileId;
  }
  if (typeof file?.dataURL === "string") {
    snapshot.dataUrl = file.dataURL;
  }
  if (typeof file?.mimeType === "string") {
    snapshot.mimeType = file.mimeType;
  }
  if (typeof persistedFile?.storageUrl === "string") {
    snapshot.storageUrl = persistedFile.storageUrl;
  }
  if (typeof customData?.storageUrl === "string") {
    snapshot.storageUrl = customData.storageUrl;
  }
  if (typeof customData?.title === "string") {
    snapshot.title = customData.title;
  }
  if (typeof customData?.mimeType === "string") {
    snapshot.mimeType = customData.mimeType;
  }
  if (typeof customData?.durationSeconds === "number") {
    snapshot.durationSeconds = customData.durationSeconds;
  }
  if (videoUrl) {
    snapshot.link = videoUrl;
  } else if (typeof element.link === "string") {
    snapshot.link = element.link;
  }
  if (
    snapshot.type !== "text" &&
    snapshot.type !== "image" &&
    snapshot.type !== "embeddable" &&
    snapshot.type !== "video"
  ) {
    snapshot.shapeType = String(element.type);
  }

  return snapshot;
}

function buildViewport(appState: Record<string, unknown>) {
  const zoomRecord =
    appState.zoom && typeof appState.zoom === "object"
      ? (appState.zoom as Record<string, unknown>)
      : {};
  const zoom = Math.max(getNumber(zoomRecord.value, 1), 0.01);
  const screenWidth = getNumber(
    appState.width,
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const screenHeight = getNumber(
    appState.height,
    typeof window !== "undefined" ? window.innerHeight : 0,
  );

  return {
    x: -getNumber(appState.scrollX, 0),
    y: -getNumber(appState.scrollY, 0),
    zoom,
    width: screenWidth / zoom,
    height: screenHeight / zoom,
  };
}

function selectNearbyCards({
  cards,
  maxNearbyCards,
  selectedCards,
  selectedIds,
  viewport,
}: {
  cards: CanvasContextRef[];
  maxNearbyCards: number;
  selectedCards: CanvasContextRef[];
  selectedIds: Set<string>;
  viewport: CanvasAgentContext["viewport"];
}): CanvasContextRef[] {
  const viewportBounds = {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
  const anchorBounds =
    selectedCards.length > 0 ? boundsForCards(selectedCards) : viewportBounds;
  const searchBounds =
    selectedCards.length > 0
      ? expandBounds(anchorBounds, NEARBY_PADDING)
      : viewportBounds;
  const anchorCenter = centerOfBounds(anchorBounds);

  return cards
    .filter((card) => !selectedIds.has(card.elementId))
    .filter(
      (card) =>
        intersects(card, searchBounds) || intersects(card, viewportBounds),
    )
    .sort(
      (a, b) =>
        distanceToCard(a, anchorCenter) - distanceToCard(b, anchorCenter),
    )
    .slice(0, maxNearbyCards);
}

function buildCardRelations(
  elements: RawCanvasElement[],
  contextCards: CanvasContextRef[],
): CanvasCardRelation[] {
  const contextIds = new Set(contextCards.map((card) => card.elementId));
  const relations: CanvasCardRelation[] = [];
  const groups = new Map<string, string[]>();

  for (const element of elements) {
    const id = String(element.id);
    const groupIds = Array.isArray(element.groupIds) ? element.groupIds : [];
    for (const groupId of groupIds) {
      if (typeof groupId !== "string" || !groupId) continue;
      const ids = groups.get(groupId) ?? [];
      ids.push(id);
      groups.set(groupId, ids);
    }

    if (typeof element.containerId === "string" && element.containerId) {
      relations.push({
        type: "bound_text",
        sourceId: id,
        targetId: element.containerId,
      });
    }

    const startElementId = bindingElementId(element.startBinding);
    const endElementId = bindingElementId(element.endBinding);
    if (startElementId || endElementId) {
      relations.push({
        type: "arrow",
        sourceId: startElementId ?? id,
        ...(endElementId ? { targetId: endElementId } : {}),
        ids: [id],
      });
    }

    const customData =
      element.customData && typeof element.customData === "object"
        ? (element.customData as Record<string, unknown>)
        : undefined;
    const cucumberContainer =
      customData?.cucumberContainer &&
      typeof customData.cucumberContainer === "object"
        ? (customData.cucumberContainer as Record<string, unknown>)
        : undefined;
    if (cucumberContainer) {
      relations.push({
        type: "container",
        sourceId: id,
        ...(typeof cucumberContainer.containerId === "string"
          ? { targetId: cucumberContainer.containerId }
          : {}),
        ...(typeof cucumberContainer.kind === "string"
          ? { label: cucumberContainer.kind }
          : {}),
      });
    }
  }

  for (const [groupId, ids] of groups) {
    relations.push({
      type: "group",
      sourceId: groupId,
      ids,
    });
  }

  return relations.filter((relation) =>
    relationTouchesContext(relation, contextIds),
  );
}

function summarizeCanvasAgentContext({
  cardRelations,
  elementCount,
  nearbyCards,
  selectedCards,
  viewport,
}: {
  cardRelations: CanvasCardRelation[];
  elementCount: number;
  nearbyCards: CanvasContextRef[];
  selectedCards: CanvasContextRef[];
  viewport: CanvasAgentContext["viewport"];
}): string {
  return [
    `Canvas has ${elementCount} visible elements.`,
    `Viewport is at (${Math.round(viewport.x)}, ${Math.round(viewport.y)}) with zoom ${viewport.zoom.toFixed(2)} and visible size ${Math.round(viewport.width)}x${Math.round(viewport.height)}.`,
    `Selected cards: ${selectedCards.length ? selectedCards.map(cardLabel).join(", ") : "none"}.`,
    `Nearby cards: ${nearbyCards.length ? nearbyCards.map(cardLabel).join(", ") : "none"}.`,
    `Card relations in context: ${cardRelations.length}.`,
  ].join("\n");
}

function cardLabel(card: CanvasContextRef): string {
  return `${card.kind}#${card.elementId}`;
}

function relationTouchesContext(
  relation: CanvasCardRelation,
  contextIds: Set<string>,
): boolean {
  if (contextIds.has(relation.sourceId)) return true;
  if (relation.targetId && contextIds.has(relation.targetId)) return true;
  return relation.ids?.some((id) => contextIds.has(id)) ?? false;
}

function bindingElementId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const elementId = (value as { elementId?: unknown }).elementId;
  return typeof elementId === "string" && elementId ? elementId : null;
}

function boundsForCards(cards: CanvasContextRef[]) {
  const minX = Math.min(...cards.map((card) => card.x));
  const minY = Math.min(...cards.map((card) => card.y));
  const maxX = Math.max(...cards.map((card) => card.x + card.width));
  const maxY = Math.max(...cards.map((card) => card.y + card.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function expandBounds(
  bounds: { x: number; y: number; width: number; height: number },
  padding: number,
) {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function intersects(
  card: CanvasContextRef,
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    card.x + card.width >= bounds.x &&
    card.x <= bounds.x + bounds.width &&
    card.y + card.height >= bounds.y &&
    card.y <= bounds.y + bounds.height
  );
}

function centerOfBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function distanceToCard(
  card: CanvasContextRef,
  point: { x: number; y: number },
) {
  const center = centerOfBounds(card);
  return Math.hypot(center.x - point.x, center.y - point.y);
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
