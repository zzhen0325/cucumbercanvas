// apps/server/src/features/canvas/canvas-element-writer.ts

import {
  type CucumberCanvasDocument,
  applyCanvasOperation,
  createEmptyCanvasDocument,
  createCanvasNodeId,
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
  download: (path: string) => Promise<{
    data: { arrayBuffer: () => Promise<ArrayBuffer> } | null;
    error: { message?: string } | null;
  }>;
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

type ImageGenerationGroupOpts = {
  canvasId: string;
  userPrompt: string;
  optimizedPrompt: string;
  title: string;
  model: string;
  jobId: string;
  runId: string;
  sessionId: string;
  aspectRatio: string;
  imagePlacement?: Placement;
};

type ImageGenerationGroupResult = {
  groupId: string;
  placeholderId: string;
};

type ImageGenerationReplaceOpts = ImageInsertOpts & {
  placeholderId: string;
  groupId?: string;
  jobId?: string;
  runId?: string;
  sessionId?: string;
  prompt?: string;
  model?: string;
};

type ImageGenerationFailureOpts = {
  canvasId: string;
  placeholderId: string;
  errorMessage: string;
  groupId?: string;
};

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

function calculateGroupPlacement(
  elements: CanvasElement[],
  width: number,
  height: number,
): Placement {
  const visible = elements.filter((el) => !el.isDeleted);
  if (visible.length === 0) {
    return {
      x: -width / 2,
      y: -height / 2,
      width,
      height,
    };
  }

  const GAP = 80;
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
    y: rightEdgeY - height / 2,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

function generateId(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).slice(0, 20);
}

function buildElementBase(groupId?: string): CanvasElement {
  return {
    id: generateId(),
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: groupId ? [groupId] : [],
    roundness: null,
    boundElements: [],
    frameId: null,
    index: null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function bumpVersion(el: CanvasElement): void {
  el.version = ((el.version as number | undefined) ?? 1) + 1;
  el.versionNonce = Math.floor(Math.random() * 2_000_000_000);
  el.updated = Date.now();
}

function ensureBoundElements(
  el: CanvasElement,
): Array<{ type: string; id: string }> {
  if (!Array.isArray(el.boundElements)) {
    el.boundElements = [];
  }
  return el.boundElements as Array<{ type: string; id: string }>;
}

function addBoundElement(
  el: CanvasElement,
  bound: { type: string; id: string },
): void {
  const existing = ensureBoundElements(el);
  if (
    !existing.some((item) => item.type === bound.type && item.id === bound.id)
  ) {
    existing.push(bound);
  }
}

function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef);
    width += isCJK ? fontSize * 1.05 : fontSize * 0.62;
  }
  return width * 1.12;
}

function wrapTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
): string {
  const wrappedParagraphs = text.split("\n").map((paragraph) => {
    let line = "";
    const lines: string[] = [];
    for (const char of Array.from(paragraph)) {
      const candidate = `${line}${char}`;
      if (line && measureTextWidth(candidate, fontSize) > maxWidth) {
        lines.push(line.trimEnd());
        line = char.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    return lines.join("\n");
  });
  return wrappedParagraphs.join("\n");
}

function textSize(
  text: string,
  fontSize: number,
): { width: number; height: number } {
  const lines = text.split("\n");
  return {
    width: Math.max(
      ...lines.map((line) => measureTextWidth(line, fontSize)),
      1,
    ),
    height: lines.length * fontSize * 1.25,
  };
}

function getAspectRatioDisplayDimensions(
  aspectRatio: string,
  maxSize: number,
): { width: number; height: number } {
  const [rawW, rawH] = aspectRatio.split(":").map((part) => Number(part));
  const sourceWidth = rawW && rawW > 0 ? rawW : 1;
  const sourceHeight = rawH && rawH > 0 ? rawH : 1;
  return scaleToFit(sourceWidth * maxSize, sourceHeight * maxSize, maxSize);
}

function getElementCenter(el: CanvasElement): { cx: number; cy: number } {
  return {
    cx: (Number(el.x) || 0) + (Number(el.width) || 0) / 2,
    cy: (Number(el.y) || 0) + (Number(el.height) || 0) / 2,
  };
}

function edgePoint(
  el: CanvasElement,
  target: { cx: number; cy: number },
): { x: number; y: number } {
  const center = getElementCenter(el);
  const halfWidth = (Number(el.width) || 0) / 2;
  const halfHeight = (Number(el.height) || 0) / 2;
  const dx = target.cx - center.cx;
  const dy = target.cy - center.cy;
  if (dx === 0 && dy === 0) return { x: center.cx, y: center.cy };

  const tx = dx !== 0 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return {
    x: center.cx + dx * t,
    y: center.cy + dy * t,
  };
}

function fixedPointToward(
  from: CanvasElement,
  to: CanvasElement,
): [number, number] {
  const fromCenter = getElementCenter(from);
  const toCenter = getElementCenter(to);
  const dx = toCenter.cx - fromCenter.cx;
  const dy = toCenter.cy - fromCenter.cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? [1, 0.5] : [0, 0.5];
  }
  return dy > 0 ? [0.5, 1] : [0.5, 0];
}

function buildTextContainer(args: {
  label: string;
  body: string;
  x: number;
  y: number;
  width: number;
  groupId: string;
  backgroundColor: string;
  strokeColor: string;
}): { container: CanvasElement; text: CanvasElement; height: number } {
  const padding = 24;
  const fontSize = 18;
  const wrappedBody = wrapTextToWidth(
    args.body,
    fontSize,
    args.width - padding * 2,
  );
  const fullText = `${args.label}\n\n${wrappedBody}`;
  const measured = textSize(fullText, fontSize);
  const height = Math.max(180, measured.height + padding * 2);
  const containerId = generateId();
  const textId = generateId();

  const container: CanvasElement = {
    ...buildElementBase(args.groupId),
    id: containerId,
    type: "rectangle",
    x: args.x,
    y: args.y,
    width: args.width,
    height,
    strokeColor: args.strokeColor,
    backgroundColor: args.backgroundColor,
    fillStyle: "solid",
    roundness: { type: 3 },
  };
  addBoundElement(container, { type: "text", id: textId });

  const text: CanvasElement = {
    ...buildElementBase(args.groupId),
    id: textId,
    type: "text",
    text: fullText,
    originalText: fullText,
    x: args.x + padding,
    y: args.y + padding,
    width: args.width - padding * 2,
    height: measured.height,
    fontSize,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: "#111827",
    containerId,
    autoResize: false,
    lineHeight: 1.25,
  };

  return { container, text, height };
}

function buildImagePlaceholder(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  groupId: string;
  prompt: string;
  title: string;
  model: string;
  jobId: string;
  runId: string;
  sessionId: string;
  aspectRatio: string;
}): { placeholder: CanvasElement; text: CanvasElement } {
  const placeholderId = generateId();
  const textId = generateId();
  const placeholderText = "生成结果\n\n生成中...";
  const measured = textSize(placeholderText, 18);

  const placeholder: CanvasElement = {
    ...buildElementBase(args.groupId),
    id: placeholderId,
    type: "rectangle",
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    strokeColor: "#94A3B8",
    backgroundColor: "#F8FAFC",
    fillStyle: "solid",
    roundness: { type: 3 },
    customData: {
      type: "image-generator",
      status: "generating",
      prompt: args.prompt,
      model: args.model,
      aspectRatio: args.aspectRatio,
      quality: "hd",
      title: args.title,
      jobId: args.jobId,
      runId: args.runId,
      sessionId: args.sessionId,
    },
  };
  addBoundElement(placeholder, { type: "text", id: textId });

  const text: CanvasElement = {
    ...buildElementBase(args.groupId),
    id: textId,
    type: "text",
    text: placeholderText,
    originalText: placeholderText,
    x: args.x + (args.width - measured.width) / 2,
    y: args.y + (args.height - measured.height) / 2,
    width: measured.width,
    height: measured.height,
    fontSize: 18,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    strokeColor: "#475569",
    containerId: placeholderId,
    autoResize: true,
    lineHeight: 1.25,
  };

  return { placeholder, text };
}

function buildBoundArrow(args: {
  start: CanvasElement;
  end: CanvasElement;
  groupId: string;
}): CanvasElement {
  const startCenter = getElementCenter(args.start);
  const endCenter = getElementCenter(args.end);
  const start = edgePoint(args.start, endCenter);
  const end = edgePoint(args.end, startCenter);
  const arrowId = generateId();
  const relEnd = [end.x - start.x, end.y - start.y] as [number, number];

  addBoundElement(args.start, { type: "arrow", id: arrowId });
  addBoundElement(args.end, { type: "arrow", id: arrowId });
  bumpVersion(args.start);
  bumpVersion(args.end);

  return {
    ...buildElementBase(args.groupId),
    id: arrowId,
    type: "arrow",
    x: start.x,
    y: start.y,
    width: Math.abs(relEnd[0]),
    height: Math.abs(relEnd[1]),
    points: [[0, 0], relEnd],
    strokeColor: "#64748B",
    strokeWidth: 2,
    lastCommittedPoint: relEnd,
    startBinding: {
      elementId: args.start.id,
      focus: 0,
      gap: 8,
      fixedPoint: fixedPointToward(args.start, args.end),
    },
    endBinding: {
      elementId: args.end.id,
      focus: 0,
      gap: 8,
      fixedPoint: fixedPointToward(args.end, args.start),
    },
    startArrowhead: null,
    endArrowhead: "arrow",
  };
}

function sanitizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed || "图片生成失败：服务未返回具体原因，请查看服务端日志。";
}

function buildImageElement(
  fileId: string,
  placement: Placement,
  opts: ImageInsertOpts,
): CanvasElement {
  return {
    type: "image",
    id: generateId(),
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    angle: 0,
    fileId,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    roundness: null,
    boundElements: null,
    frameId: null,
    index: null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    status: "saved",
    scale: [1, 1],
    crop: null,
    customData: {
      ...(opts.title ? { title: opts.title } : {}),
      source: "generated" as const,
    },
  };
}

function buildVideoElement(
  placement: Placement,
  opts: VideoInsertOpts,
): CanvasElement {
  return {
    type: "embeddable",
    id: generateId(),
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    roundness: null,
    boundElements: null,
    frameId: null,
    index: null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    updated: Date.now(),
    link: opts.signedUrl,
    locked: false,
    customData: {
      isVideo: true,
      mimeType: opts.mimeType,
      ...(opts.durationSeconds != null
        ? { durationSeconds: opts.durationSeconds }
        : {}),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
    },
  };
}

function inferCucumberInsertContainerId(
  doc: CucumberCanvasDocument,
): string | null {
  const boundWritableContainers = Object.values(doc.nodes).filter(
    (node) =>
      node.type === "container" &&
      Boolean(node.agentBinding?.permissions?.includes("write")),
  );
  if (boundWritableContainers.length === 1) {
    return boundWritableContainers[0]!.id;
  }

  const openContainers = Object.values(doc.nodes).filter(
    (node) =>
      node.type === "container" && node.permissions?.isolationLevel === "open",
  );
  if (openContainers.length === 1) {
    return openContainers[0]!.id;
  }

  return null;
}

function resolveCucumberPlacement(
  doc: CucumberCanvasDocument,
  width: number,
  height: number,
  explicitPlacement?: Placement,
): { containerId: string | null; placement: Placement } {
  if (explicitPlacement) {
    return {
      containerId: inferCucumberInsertContainerId(doc),
      placement: explicitPlacement,
    };
  }

  const containerId = inferCucumberInsertContainerId(doc);
  if (containerId) {
    const container = doc.nodes[containerId];
    if (container?.type === "container") {
      return {
        containerId,
        placement: {
          x: container.bounds.x + 24,
          y: container.bounds.y + 32,
          width,
          height,
        },
      };
    }
  }

  const nodeBoxes = Object.values(doc.nodes).map((node) => ({
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    isDeleted: false,
  }));
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
const GENERATION_TEXT_WIDTH = 360;
const GENERATION_IMAGE_MAX_SIZE = 420;
const GENERATION_COLUMN_GAP = 88;

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

  console.warn("[canvas-element-writer] resetting non-cucumber canvas content", {
    canvasId,
  });
  return createEmptyCanvasDocument();
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

async function downloadStorageObjectAsDataURL(
  client: CanvasElementWriterClient,
  objectPath: string,
  mimeType: string,
): Promise<string> {
  const { data: blob, error: dlError } = await (
    client.storage.from(CANVAS_FILES_BUCKET) as StorageDownloadQuery
  ).download(objectPath);

  if (dlError || !blob) {
    throw new Error(
      `Failed to download image from storage: ${dlError?.message ?? "no data"}`,
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function buildImageGenerationGroupElements(
  existingElements: CanvasElement[],
  opts: Omit<ImageGenerationGroupOpts, "canvasId">,
): {
  elements: CanvasElement[];
  groupId: string;
  placeholderId: string;
} {
  const groupId = generateId();
  const imageSize = opts.imagePlacement
    ? {
        width: opts.imagePlacement.width,
        height: opts.imagePlacement.height,
      }
    : getAspectRatioDisplayDimensions(
        opts.aspectRatio,
        GENERATION_IMAGE_MAX_SIZE,
      );

  const userTextPreview = buildTextContainer({
    label: "我的需求",
    body: opts.userPrompt,
    x: 0,
    y: 0,
    width: GENERATION_TEXT_WIDTH,
    groupId,
    backgroundColor: "#F8FAFC",
    strokeColor: "#CBD5E1",
  });
  const promptTextPreview = buildTextContainer({
    label: "优化后的 Prompt",
    body: opts.optimizedPrompt,
    x: 0,
    y: 0,
    width: GENERATION_TEXT_WIDTH,
    groupId,
    backgroundColor: "#F8FAFC",
    strokeColor: "#CBD5E1",
  });

  const groupHeight = Math.max(
    userTextPreview.height,
    promptTextPreview.height,
    imageSize.height,
  );
  const totalWidth =
    GENERATION_TEXT_WIDTH * 2 + GENERATION_COLUMN_GAP * 2 + imageSize.width;
  const groupPlacement = opts.imagePlacement
    ? {
        x:
          opts.imagePlacement.x -
          GENERATION_COLUMN_GAP * 2 -
          GENERATION_TEXT_WIDTH * 2,
        y:
          opts.imagePlacement.y +
          opts.imagePlacement.height / 2 -
          groupHeight / 2,
        width: totalWidth,
        height: groupHeight,
      }
    : calculateGroupPlacement(existingElements, totalWidth, groupHeight);

  const demandX = groupPlacement.x;
  const promptX = demandX + GENERATION_TEXT_WIDTH + GENERATION_COLUMN_GAP;
  const imageX = opts.imagePlacement
    ? opts.imagePlacement.x
    : promptX + GENERATION_TEXT_WIDTH + GENERATION_COLUMN_GAP;
  const imageY = opts.imagePlacement
    ? opts.imagePlacement.y
    : groupPlacement.y + (groupHeight - imageSize.height) / 2;

  const demand = buildTextContainer({
    label: "我的需求",
    body: opts.userPrompt,
    x: demandX,
    y: groupPlacement.y + (groupHeight - userTextPreview.height) / 2,
    width: GENERATION_TEXT_WIDTH,
    groupId,
    backgroundColor: "#F8FAFC",
    strokeColor: "#CBD5E1",
  });
  const prompt = buildTextContainer({
    label: "优化后的 Prompt",
    body: opts.optimizedPrompt,
    x: promptX,
    y: groupPlacement.y + (groupHeight - promptTextPreview.height) / 2,
    width: GENERATION_TEXT_WIDTH,
    groupId,
    backgroundColor: "#F8FAFC",
    strokeColor: "#CBD5E1",
  });
  const image = buildImagePlaceholder({
    x: imageX,
    y: imageY,
    width: imageSize.width,
    height: imageSize.height,
    groupId,
    prompt: opts.optimizedPrompt,
    title: opts.title,
    model: opts.model,
    jobId: opts.jobId,
    runId: opts.runId,
    sessionId: opts.sessionId,
    aspectRatio: opts.aspectRatio,
  });

  const firstArrow = buildBoundArrow({
    start: demand.container,
    end: prompt.container,
    groupId,
  });
  const secondArrow = buildBoundArrow({
    start: prompt.container,
    end: image.placeholder,
    groupId,
  });

  return {
    elements: [
      demand.container,
      demand.text,
      prompt.container,
      prompt.text,
      image.placeholder,
      image.text,
      firstArrow,
      secondArrow,
    ],
    groupId,
    placeholderId: image.placeholder.id as string,
  };
}

export async function createImageGenerationGroup(
  client: CanvasElementWriterClient,
  opts: ImageGenerationGroupOpts,
): Promise<ImageGenerationGroupResult> {
  void client;
  void opts;
  throw new Error(
    "Image generation placeholders are not supported on the Cucumber canvas runtime.",
  );
}

export async function replaceImageGenerationPlaceholder(
  client: CanvasElementWriterClient,
  opts: ImageGenerationReplaceOpts,
): Promise<InsertResult> {
  return insertImageElement(client, opts, undefined);
}

export async function markImageGenerationGroupFailed(
  client: CanvasElementWriterClient,
  opts: ImageGenerationFailureOpts,
): Promise<void> {
  void client;
  console.warn("[canvas-element-writer] generation failed before canvas insert", {
    canvasId: opts.canvasId,
    errorMessage: sanitizeErrorMessage(opts.errorMessage),
    groupId: opts.groupId,
    placeholderId: opts.placeholderId,
  });
}

/**
 * Insert an image element into a canvas. Reads current content, appends element
 * with auto-placement (or explicit placement), writes it back.
 *
 * The image file is already in Supabase Storage (uploaded by worker executor).
 * We download it and embed as base64 dataURL in the canvas files map so
 * Excalidraw can render it natively (consistent with frontend-inserted images).
 */
export async function insertImageElement(
  client: CanvasElementWriterClient,
  opts: ImageInsertOpts,
  explicitPlacement?: Placement,
): Promise<InsertResult> {
  // 1. Download image from storage and convert to base64 dataURL
  const { data: blob, error: dlError } = await (
    client.storage.from(CANVAS_FILES_BUCKET) as StorageDownloadQuery
  ).download(opts.objectPath);

  if (dlError || !blob) {
    throw new Error(
      `Failed to download image from storage: ${dlError?.message ?? "no data"}`,
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const base64 = buffer.toString("base64");
  const dataURL = `data:${opts.mimeType};base64,${base64}`;

  const content = await readCanvasContent(client, opts.canvasId);
  const sizedPlacement = explicitPlacement
    ? explicitPlacement
    : scaleToFit(opts.width, opts.height, IMAGE_MAX_SIZE);
  const { containerId, placement } = resolveCucumberPlacement(
    content,
    sizedPlacement.width,
    sizedPlacement.height,
    explicitPlacement,
  );
  const assetId = createCanvasNodeId("asset");
  const nodeId = createCanvasNodeId("image");
  const nextWithAsset: CucumberCanvasDocument = {
    ...content,
    assets: {
      ...content.assets,
      [assetId]: {
        id: assetId,
        url: dataURL,
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
      type: "image",
      parentId: containerId,
      bounds: placement,
      title: opts.title ?? "Generated image",
      assetId,
      src: dataURL,
      meta: { source: "generated" },
    },
    ...(containerId ? { containerId } : {}),
  });

  await writeCanvasContent(client, opts.canvasId, nextDoc);
  console.log(
    `[canvas-element-writer] cucumber image inserted canvasId=${opts.canvasId} elementId=${nodeId} containerId=${containerId ?? "root"}`,
  );
  return { elementId: nodeId };
}

/**
 * Insert a video element into a canvas. Videos use Excalidraw's `embeddable`
 * type with a link URL — no files map entry needed.
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
  const nodeId = createCanvasNodeId("video");
  const nextDoc = applyCanvasOperation(content, {
    type: "insertNode",
    node: {
      id: nodeId,
      type: "videoEmbed",
      parentId: containerId,
      bounds: placement,
      title: opts.title ?? "Generated video",
      src: opts.signedUrl,
      mimeType: opts.mimeType,
      durationSeconds: opts.durationSeconds,
      meta: { source: "generated" },
    },
    ...(containerId ? { containerId } : {}),
  });

  await writeCanvasContent(client, opts.canvasId, nextDoc);
  console.log(
    `[canvas-element-writer] cucumber video inserted canvasId=${opts.canvasId} elementId=${nodeId} containerId=${containerId ?? "root"}`,
  );
  return { elementId: nodeId };
}
