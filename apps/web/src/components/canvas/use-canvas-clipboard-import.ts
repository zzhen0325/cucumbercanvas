import type {
  ClipboardImportFile,
  ClipboardImportPayload,
} from "@cucumber/canvas-core";
import { useEffect } from "react";

export interface ClipboardImportContext {
  trigger: "paste-event" | "clipboard-api" | "drop-event";
  mimeTypes: string[];
  itemTypes?: string[];
  fileTypes?: string[];
  hasHtml: boolean;
  hasText: boolean;
}

export interface ClipboardImportReadResult {
  payload: ClipboardImportPayload;
  context: ClipboardImportContext;
}

export function getClipboardImportPayloadFromEvent(
  event: ClipboardEvent,
): ClipboardImportPayload {
  const clipboardData = event.clipboardData;
  const items = collectClipboardTextItems(clipboardData);
  const files = collectClipboardFiles(clipboardData).map((file) => ({
    type: file.type || "application/octet-stream",
    name: file.name || undefined,
  }));
  return {
    html: clipboardData?.getData("text/html") || undefined,
    text: clipboardData?.getData("text/plain") || undefined,
    svg: clipboardData?.getData("image/svg+xml") || undefined,
    items: items.length > 0 ? items : undefined,
    files: files.length > 0 ? files : undefined,
  };
}

export function getClipboardImportContextFromEvent(
  event: ClipboardEvent,
): ClipboardImportContext {
  const mimeTypes = getClipboardDataMimeTypes(event.clipboardData);
  const itemTypes = getClipboardItemTypes(event.clipboardData);
  const fileTypes = getClipboardFileTypes(event.clipboardData);
  const context: ClipboardImportContext = {
    trigger: "paste-event",
    mimeTypes,
    hasHtml: mimeTypes.includes("text/html"),
    hasText: mimeTypes.includes("text/plain"),
  };
  if (itemTypes.length > 0) context.itemTypes = itemTypes;
  if (fileTypes.length > 0) context.fileTypes = fileTypes;
  return context;
}

export async function readClipboardImportPayloadFromEvent(
  event: ClipboardEvent,
): Promise<ClipboardImportReadResult> {
  const payload = getClipboardImportPayloadFromEvent(event);
  const enriched = await readFilesFromDataTransfer(event.clipboardData);
  return mergeDataTransferFilePayload(
    { payload, context: getClipboardImportContextFromEvent(event) },
    enriched,
  );
}

export async function readDataTransferImportPayload(
  dataTransfer: DataTransfer | null | undefined,
): Promise<ClipboardImportReadResult> {
  const items = collectClipboardTextItems(dataTransfer);
  const payload: ClipboardImportPayload = {
    html: dataTransfer?.getData("text/html") || undefined,
    text: dataTransfer?.getData("text/plain") || undefined,
    svg: dataTransfer?.getData("image/svg+xml") || undefined,
    items: items.length > 0 ? items : undefined,
  };
  const enriched = await readFilesFromDataTransfer(dataTransfer);
  return mergeDataTransferFilePayload(
    {
      payload,
      context: getDataTransferImportContext(dataTransfer, "drop-event"),
    },
    enriched,
  );
}

export async function readDataTransferImportPayloads(
  dataTransfer: DataTransfer | null | undefined,
): Promise<ClipboardImportReadResult[]> {
  const files = collectClipboardFiles(dataTransfer);
  if (files.length === 0) {
    return [await readDataTransferImportPayload(dataTransfer)];
  }

  return Promise.all(
    files.map(async (file) => ({
      payload: await fileToImportPayload(file),
      context: getSingleFileImportContext(dataTransfer, file),
    })),
  );
}

export async function readClipboardImportPayload(): Promise<ClipboardImportReadResult> {
  let html: string | undefined;
  let text: string | undefined;
  let svg: string | undefined;
  const mimeTypes: string[] = [];
  const textItems: Array<{ type: string; text?: string }> = [];
  const files: ClipboardImportFile[] = [];

  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        mimeTypes.push(...item.types);
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (isReadableTextClipboardType(type)) {
            const value = await blobToText(blob);
            textItems.push({ type, text: value || undefined });
            if (!value) continue;
            if (!html && type === "text/html") html = value;
            if (!text && type === "text/plain") text = value;
            if (!svg && type === "image/svg+xml") svg = value;
            continue;
          }
          if (isReadableFileClipboardType(type)) {
            files.push(await blobToClipboardFile(blob, type));
          } else {
            textItems.push({ type });
          }
        }
      }
    } catch {
      // Some browsers block read() without transient activation.
    }
  }

  if (
    !text &&
    typeof navigator !== "undefined" &&
    navigator.clipboard?.readText
  ) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Ignore permission errors and let caller handle empty payloads.
    }
  }

  const context: ClipboardImportContext = {
    trigger: "clipboard-api",
    mimeTypes: Array.from(new Set(mimeTypes)),
    hasHtml: Boolean(html),
    hasText: Boolean(text),
  };
  if (textItems.length > 0) {
    context.itemTypes = Array.from(new Set(textItems.map((item) => item.type)));
  }
  if (files.length > 0) {
    context.fileTypes = Array.from(new Set(files.map((file) => file.type)));
  }

  return {
    payload: {
      html,
      text,
      svg,
      items: textItems.length > 0 ? textItems : undefined,
      files: files.length > 0 ? files : undefined,
    },
    context,
  };
}

function mergeClipboardImportReadResults(
  primary: ClipboardImportReadResult,
  secondary: ClipboardImportReadResult,
): ClipboardImportReadResult {
  const items = mergeClipboardTextItems(
    primary.payload.items,
    secondary.payload.items,
  );
  const files = mergeClipboardFiles(
    primary.payload.files,
    secondary.payload.files ?? [],
  );
  const mimeTypes = unionStrings(
    primary.context.mimeTypes,
    secondary.context.mimeTypes,
  );
  const itemTypes = unionStrings(
    primary.context.itemTypes,
    secondary.context.itemTypes,
  );
  const fileTypes = unionStrings(
    primary.context.fileTypes,
    secondary.context.fileTypes,
  );
  const context: ClipboardImportContext = {
    trigger: primary.context.trigger,
    mimeTypes,
    hasHtml: primary.context.hasHtml || secondary.context.hasHtml,
    hasText: primary.context.hasText || secondary.context.hasText,
  };
  if (itemTypes.length > 0) context.itemTypes = itemTypes;
  if (fileTypes.length > 0) context.fileTypes = fileTypes;

  return {
    payload: {
      html: primary.payload.html ?? secondary.payload.html,
      text: primary.payload.text ?? secondary.payload.text,
      svg: primary.payload.svg ?? secondary.payload.svg,
      items: items.length > 0 ? items : undefined,
      files: files.length > 0 ? files : undefined,
    },
    context,
  };
}

function mergeClipboardTextItems(
  left: ClipboardImportPayload["items"],
  right: ClipboardImportPayload["items"],
): NonNullable<ClipboardImportPayload["items"]> {
  const merged = new Map<string, { type: string; text?: string }>();
  for (const item of left ?? []) {
    merged.set(item.type, item);
  }
  for (const item of right ?? []) {
    const existing = merged.get(item.type);
    if (!existing || (!existing.text && item.text)) {
      merged.set(item.type, item);
    }
  }
  return Array.from(merged.values());
}

function collectClipboardTextItems(
  clipboardData: DataTransfer | null | undefined,
): Array<{ type: string; text?: string }> {
  const byType = new Map<string, { type: string; text?: string }>();
  for (const type of Array.from(clipboardData?.types ?? [])) {
    if (!type || type === "Files") continue;
    const text = clipboardData?.getData(type) ?? "";
    byType.set(type, { type, text: text || undefined });
  }
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (!byType.has(item.type)) {
      byType.set(item.type, { type: item.type });
    }
  }
  return Array.from(byType.values());
}

function collectClipboardFiles(
  clipboardData: DataTransfer | null | undefined,
): File[] {
  const files = new Map<string, File>();
  for (const file of Array.from(clipboardData?.files ?? [])) {
    files.set(getFileDedupKey(file), file);
  }
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.set(getFileDedupKey(file), file);
  }
  return Array.from(files.values());
}

async function readFilesFromDataTransfer(
  clipboardData: DataTransfer | null | undefined,
): Promise<{
  files: ClipboardImportFile[];
  items: Array<{ type: string; text?: string }>;
  svg?: string;
}> {
  const files = collectClipboardFiles(clipboardData);
  const resolved = await Promise.all(
    files.map(async (file) => {
      if (isReadableSvgFile(file)) {
        const text = await blobToText(file);
        return {
          item: { type: "image/svg+xml", text },
          svg: text || undefined,
        };
      }
      return { file: await blobToClipboardFile(file) };
    }),
  );
  return {
    files: resolved
      .map((entry) => entry.file)
      .filter((file): file is ClipboardImportFile => Boolean(file)),
    items: resolved.flatMap(
      (entry): Array<{ type: string; text?: string }> =>
        entry.item ? [entry.item] : [],
    ),
    svg: resolved.find((entry) => entry.svg)?.svg,
  };
}

async function fileToImportPayload(
  file: File,
): Promise<ClipboardImportPayload> {
  const type = file.type || "application/octet-stream";
  if (isReadableSvgFile(file)) {
    const text = await blobToText(file);
    return {
      svg: text || undefined,
      items: [{ type: "image/svg+xml", text: text || undefined }],
    };
  }
  if (isReadableFileClipboardType(type)) {
    return {
      files: [await blobToClipboardFile(file)],
    };
  }
  return {
    files: [
      {
        type,
        name: file.name || undefined,
      },
    ],
  };
}

function mergeDataTransferFilePayload(
  base: ClipboardImportReadResult,
  enriched: {
    files: ClipboardImportFile[];
    items: Array<{ type: string; text?: string }>;
    svg?: string;
  },
): ClipboardImportReadResult {
  const files = mergeClipboardFiles(base.payload.files, enriched.files);
  const items = mergeClipboardTextItems(base.payload.items, enriched.items);
  return {
    context: base.context,
    payload: {
      ...base.payload,
      svg: base.payload.svg ?? enriched.svg,
      items: items.length > 0 ? items : undefined,
      files: files.length > 0 ? files : undefined,
    },
  };
}

function getDataTransferImportContext(
  dataTransfer: DataTransfer | null | undefined,
  trigger: ClipboardImportContext["trigger"],
): ClipboardImportContext {
  const mimeTypes = getClipboardDataMimeTypes(dataTransfer);
  const itemTypes = getClipboardItemTypes(dataTransfer);
  const fileTypes = getClipboardFileTypes(dataTransfer);
  const context: ClipboardImportContext = {
    trigger,
    mimeTypes,
    hasHtml: mimeTypes.includes("text/html"),
    hasText: mimeTypes.includes("text/plain"),
  };
  if (itemTypes.length > 0) context.itemTypes = itemTypes;
  if (fileTypes.length > 0) context.fileTypes = fileTypes;
  return context;
}

function getSingleFileImportContext(
  dataTransfer: DataTransfer | null | undefined,
  file: File,
): ClipboardImportContext {
  const type = file.type || "application/octet-stream";
  const mimeTypes = Array.from(
    new Set([...Array.from(dataTransfer?.types ?? []).filter(Boolean), type]),
  );
  return {
    trigger: "drop-event",
    mimeTypes,
    itemTypes: type ? [type] : undefined,
    fileTypes: type ? [type] : undefined,
    hasHtml: false,
    hasText: false,
  };
}

function getClipboardDataMimeTypes(
  clipboardData: DataTransfer | null | undefined,
): string[] {
  const types = new Set<string>(Array.from(clipboardData?.types ?? []));
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.type) types.add(item.type);
  }
  for (const file of Array.from(clipboardData?.files ?? [])) {
    if (file.type) types.add(file.type);
  }
  return Array.from(types);
}

function getClipboardItemTypes(
  clipboardData: DataTransfer | null | undefined,
): string[] {
  const types = new Set<string>();
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.type) types.add(item.type);
  }
  return Array.from(types);
}

function getClipboardFileTypes(
  clipboardData: DataTransfer | null | undefined,
): string[] {
  const types = new Set<string>();
  for (const file of Array.from(clipboardData?.files ?? [])) {
    if (file.type) types.add(file.type);
  }
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.kind === "file" && item.type) types.add(item.type);
  }
  return Array.from(types);
}

function hasFileClipboardItems(
  clipboardData: DataTransfer | null | undefined,
): boolean {
  return (
    Array.from(clipboardData?.items ?? []).some(
      (item) => item.kind === "file",
    ) || (clipboardData?.files?.length ?? 0) > 0
  );
}

function mergeClipboardFiles(
  left: ClipboardImportFile[] | undefined,
  right: ClipboardImportFile[],
): ClipboardImportFile[] {
  const merged = new Map<string, ClipboardImportFile>();
  for (const file of left ?? []) {
    merged.set(getClipboardFileDedupKey(file), file);
  }
  for (const file of right) {
    merged.set(getClipboardFileDedupKey(file), file);
  }
  return Array.from(merged.values());
}

function unionStrings(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]));
}

async function blobToClipboardFile(
  blob: Blob,
  explicitType?: string,
): Promise<ClipboardImportFile> {
  const type = blob.type || explicitType || "application/octet-stream";
  const name =
    "name" in blob && typeof blob.name === "string" ? blob.name : undefined;
  const dataUrl = await blobToDataUrl(blob, type);
  const dimensions = await readImageDimensions(dataUrl, type);
  return {
    type,
    name,
    dataUrl,
    ...dimensions,
  };
}

async function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  if (typeof blob.arrayBuffer !== "function") {
    return readBlobAsDataUrl(blob);
  }
  const buffer = await blob.arrayBuffer();
  return `data:${type};base64,${arrayBufferToBase64(buffer)}`;
}

async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readImageDimensions(
  dataUrl: string,
  type: string,
): Promise<Pick<ClipboardImportFile, "width" | "height">> {
  if (
    !type.startsWith("image/") ||
    type === "image/svg+xml" ||
    typeof Image === "undefined"
  ) {
    return {};
  }
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve({}), 500);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve({
        width: image.naturalWidth || image.width || undefined,
        height: image.naturalHeight || image.height || undefined,
      });
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve({});
    };
    image.src = dataUrl;
  });
}

function getFileDedupKey(file: File): string {
  return `${file.name}|${file.type}|${file.size}`;
}

function getClipboardFileDedupKey(file: ClipboardImportFile): string {
  return `${file.name ?? ""}|${file.type}`;
}

function isReadableTextClipboardType(type: string): boolean {
  return (
    type === "text/html" ||
    type === "text/plain" ||
    type === "image/svg+xml" ||
    type.startsWith("text/") ||
    type.includes("figma")
  );
}

function isReadableFileClipboardType(type: string): boolean {
  return (
    type.startsWith("image/") ||
    type === "application/octet-stream" ||
    type.includes("figma")
  );
}

function isReadableSvgFile(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.type === "text/svg" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

function shouldEnrichPasteWithClipboardApi(
  payload: ClipboardImportPayload,
  context: ClipboardImportContext,
): boolean {
  return (
    context.trigger === "paste-event" &&
    context.hasHtml &&
    !payload.svg &&
    !payload.files?.some((file) => file.type.startsWith("image/")) &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.read === "function"
  );
}

export function useCanvasClipboardImport(options: {
  onImportPayload: (
    payload: ClipboardImportPayload,
    context: ClipboardImportContext,
  ) => boolean;
}) {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const detectedContext = getClipboardImportContextFromEvent(event);
      console.info("[canvas-clipboard] paste.detected", {
        mimeTypes: detectedContext.mimeTypes,
        itemTypes: detectedContext.itemTypes ?? [],
        fileTypes: detectedContext.fileTypes ?? [],
        hasHtml: detectedContext.hasHtml,
        hasText: detectedContext.hasText,
      });

      if (hasFileClipboardItems(event.clipboardData)) {
        event.preventDefault();
        void readClipboardImportPayloadFromEvent(event).then(
          ({ payload, context }) => {
            options.onImportPayload(payload, context);
          },
          (error) => {
            console.warn("[canvas-clipboard] paste.file-read.failed", {
              error,
            });
          },
        );
        return;
      }

      const payload = getClipboardImportPayloadFromEvent(event);
      const context = detectedContext;
      if (shouldEnrichPasteWithClipboardApi(payload, context)) {
        event.preventDefault();
        void readClipboardImportPayload().then(
          ({ payload: apiPayload, context: apiContext }) => {
            const enriched = mergeClipboardImportReadResults(
              { payload, context },
              { payload: apiPayload, context: apiContext },
            );
            console.info("[canvas-clipboard] paste.enriched", {
              eventMimeTypes: context.mimeTypes,
              apiMimeTypes: apiContext.mimeTypes,
              mergedMimeTypes: enriched.context.mimeTypes,
              mergedItemTypes: enriched.context.itemTypes ?? [],
              mergedFileTypes: enriched.context.fileTypes ?? [],
            });
            options.onImportPayload(enriched.payload, enriched.context);
          },
        );
        return;
      }
      if (options.onImportPayload(payload, context)) {
        event.preventDefault();
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [options]);
}
