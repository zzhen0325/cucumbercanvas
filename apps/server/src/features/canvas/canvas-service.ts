import {
  CanvasPageOperationError,
  normalizeCanvasDocument,
} from "@cucumber/canvas-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import type { CanvasContent, CanvasDetail, Json } from "@cucumber/shared";

import type {
  AuthenticatedUser,
  UserSupabaseClient,
} from "../../supabase/user.js";

export class CanvasServiceError extends Error {
  readonly statusCode: number;
  readonly code:
    | "canvas_not_found"
    | "canvas_save_failed"
    | "invalid_canvas_document";

  constructor(
    code: "canvas_not_found" | "canvas_save_failed" | "invalid_canvas_document",
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CanvasService = {
  getCanvas(user: AuthenticatedUser, canvasId: string): Promise<CanvasDetail>;
  saveCanvasContent(
    user: AuthenticatedUser,
    canvasId: string,
    content: CanvasContent,
  ): Promise<CanvasContent>;
};

/**
 * Marker prefix for files that have been extracted to Supabase Storage.
 * Format: `oss://bucket/objectPath`
 */
const OSS_MARKER_PREFIX = "oss://";
const CANVAS_FILES_BUCKET = "project-assets";
const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s;

export function createCanvasService(options: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
}): CanvasService {
  return {
    async getCanvas(user, canvasId) {
      const client = options.createUserClient(user.accessToken);
      const { data, error } = await client
        .from("canvases")
        .select("id, name, project_id, content")
        .eq("id", canvasId)
        .single();

      if (error || !data) {
        throw new CanvasServiceError(
          "canvas_not_found",
          "Canvas not found.",
          404,
        );
      }

      const content = normalizePersistedCanvasDocument(data.content, canvasId);
      return {
        id: data.id,
        name: data.name,
        projectId: data.project_id,
        content: content as unknown as CanvasContent,
      };
    },

    async saveCanvasContent(user, canvasId, content) {
      const client = options.createUserClient(user.accessToken);
      const normalizedContent = normalizeIncomingCanvasDocument(
        content,
        canvasId,
      );
      const storagePreparedContent = await extractCanvasAssetsToStorage(
        client,
        canvasId,
        normalizedContent,
      );

      const { error } = await client
        .from("canvases")
        .update({ content: storagePreparedContent as unknown as Json })
        .eq("id", canvasId);

      if (error) {
        throw new CanvasServiceError(
          "canvas_save_failed",
          "Unable to save canvas.",
          500,
        );
      }

      return storagePreparedContent as unknown as CanvasContent;
    },
  };
}

function normalizePersistedCanvasDocument(raw: unknown, canvasId: string) {
  try {
    return normalizeCanvasDocument(raw);
  } catch (error) {
    if (error instanceof CanvasPageOperationError) {
      console.error("[canvas-service] invalid persisted canvas document", {
        canvasId,
        reason: error.message,
      });
      throw new CanvasServiceError(
        "invalid_canvas_document",
        "Canvas data is invalid: expected a Cucumber PenDocument with pages and activePageId. Existing legacy canvas data needs a data repair before it can be opened.",
        500,
      );
    }
    throw error;
  }
}

function normalizeIncomingCanvasDocument(
  content: CanvasContent,
  canvasId: string,
): PenDocument {
  try {
    return normalizeCanvasDocument(content);
  } catch (error) {
    if (error instanceof CanvasPageOperationError) {
      console.warn("[canvas-service] rejected invalid canvas document save", {
        canvasId,
        reason: error.message,
      });
      throw new CanvasServiceError(
        "invalid_canvas_document",
        "Canvas data is invalid: expected a Cucumber PenDocument with pages and activePageId.",
        400,
      );
    }
    throw error;
  }
}

async function extractCanvasAssetsToStorage(
  client: UserSupabaseClient,
  canvasId: string,
  document: PenDocument,
): Promise<PenDocument> {
  const dataUrls = collectCanvasDataUrls(document);
  if (dataUrls.length === 0) return document;

  const { projectId, workspaceId } = await getCanvasStorageContext(
    client,
    canvasId,
  );
  const replacements = new Map<string, string>();

  for (const dataUrl of dataUrls) {
    if (replacements.has(dataUrl.value)) continue;
    const { buffer, mimeType } = parseDataURL(dataUrl.value);
    const ext = mimeToExt(mimeType);
    const objectPath = `${workspaceId}/${projectId}/canvas-assets/${canvasId}/${dataUrl.id}.${ext}`;
    const { error: uploadError } = await client.storage
      .from(CANVAS_FILES_BUCKET)
      .upload(objectPath, buffer, {
        cacheControl: "31536000",
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.warn("[canvas-service] canvas asset upload failed", {
        assetId: dataUrl.id,
        canvasId,
        mimeType,
        objectPath,
        reason: uploadError.message,
        byteSize: buffer.length,
      });
      throw new CanvasServiceError(
        "canvas_save_failed",
        `Unable to save canvas image asset ${dataUrl.id}: ${uploadError.message}`,
        500,
      );
    }

    const { data: urlData } = client.storage
      .from(CANVAS_FILES_BUCKET)
      .getPublicUrl(objectPath);
    replacements.set(dataUrl.value, urlData.publicUrl);
    console.info("[canvas-service] canvas asset extracted", {
      assetId: dataUrl.id,
      canvasId,
      mimeType,
      objectPath,
      byteSize: buffer.length,
    });
  }

  return replaceCanvasDataUrls(document, replacements);
}

type CanvasDataUrlRef = {
  id: string;
  value: string;
};

function collectCanvasDataUrls(document: PenDocument): CanvasDataUrlRef[] {
  const refs: CanvasDataUrlRef[] = [];
  for (const [assetId, asset] of Object.entries(document.assets ?? {})) {
    if (isBase64DataUrl(asset.url)) {
      refs.push({ id: assetId, value: asset.url });
    }
  }
  for (const node of walkNodes(document)) {
    const nodeRecord = node as unknown as Record<string, unknown>;
    if (typeof nodeRecord.src === "string" && isBase64DataUrl(nodeRecord.src)) {
      refs.push({ id: node.id, value: nodeRecord.src });
    }
    for (const fill of getImageFills(node)) {
      if (isBase64DataUrl(fill.url)) {
        refs.push({ id: node.id, value: fill.url });
      }
    }
  }
  return refs;
}

function replaceCanvasDataUrls(
  document: PenDocument,
  replacements: ReadonlyMap<string, string>,
): PenDocument {
  if (replacements.size === 0) return document;
  const next = structuredClone(document) as PenDocument;
  for (const asset of Object.values(next.assets ?? {})) {
    const replacement = replacements.get(asset.url);
    if (replacement) asset.url = replacement;
  }
  for (const node of walkNodes(next)) {
    const nodeRecord = node as unknown as Record<string, unknown>;
    if (typeof nodeRecord.src === "string") {
      const replacement = replacements.get(nodeRecord.src);
      if (replacement) nodeRecord.src = replacement;
    }
    for (const fill of getImageFills(node)) {
      const replacement = replacements.get(fill.url);
      if (replacement) fill.url = replacement;
    }
  }
  return next;
}

async function getCanvasStorageContext(
  client: UserSupabaseClient,
  canvasId: string,
): Promise<{ projectId: string; workspaceId: string }> {
  const { data, error } = await client
    .from("canvases")
    .select("project_id, projects(workspace_id)")
    .eq("id", canvasId)
    .single();
  const row = data as
    | {
        project_id?: string;
        projects?: { workspace_id?: string } | { workspace_id?: string }[];
      }
    | null
    | undefined;
  const project = Array.isArray(row?.projects)
    ? row?.projects[0]
    : row?.projects;
  if (error || !row?.project_id || !project?.workspace_id) {
    throw new CanvasServiceError(
      "canvas_save_failed",
      "Unable to resolve canvas storage workspace.",
      500,
    );
  }
  return { projectId: row.project_id, workspaceId: project.workspace_id };
}

function* walkNodes(document: PenDocument): Generator<PenNode> {
  const roots = document.pages?.length
    ? document.pages.flatMap((page) => page.children)
    : document.children;
  for (const node of roots) yield* walkNode(node);
}

function* walkNode(node: PenNode): Generator<PenNode> {
  yield node;
  const children = (node as PenNode & { children?: PenNode[] }).children;
  if (!Array.isArray(children)) return;
  for (const child of children) yield* walkNode(child);
}

type MutableImageFill = { type: "image"; url: string };

function getImageFills(node: PenNode): MutableImageFill[] {
  const fills = (node as unknown as { fill?: unknown }).fill;
  if (!Array.isArray(fills)) return [];
  return fills.filter(
    (fill): fill is MutableImageFill =>
      Boolean(fill) &&
      typeof fill === "object" &&
      (fill as { type?: unknown }).type === "image" &&
      typeof (fill as { url?: unknown }).url === "string",
  );
}

function isBase64DataUrl(value: string): boolean {
  return DATA_URL_RE.test(value);
}

// ---------------------------------------------------------------------------
// File extraction (save path): base64 dataURL → Supabase Storage + oss:// marker
// ---------------------------------------------------------------------------

type CanvasFileRecord = Record<string, Record<string, unknown>>;

async function extractFilesToStorage(
  client: UserSupabaseClient,
  canvasId: string,
  content: CanvasContent,
): Promise<CanvasContent> {
  const files = (content as { files?: CanvasFileRecord }).files;
  if (!files || Object.keys(files).length === 0) {
    return content;
  }

  const updatedFiles: CanvasFileRecord = {};

  await Promise.all(
    Object.entries(files).map(async ([fileId, fileData]) => {
      const dataURL = fileData.dataURL as string | undefined;

      // Already extracted to storage — keep marker
      if (dataURL?.startsWith(OSS_MARKER_PREFIX)) {
        updatedFiles[fileId] = fileData;
        return;
      }

      // Only process base64 data URLs
      if (!dataURL?.startsWith("data:")) {
        updatedFiles[fileId] = fileData;
        return;
      }

      try {
        const { buffer, mimeType } = parseDataURL(dataURL);
        const ext = mimeToExt(mimeType);
        const objectPath = `canvas-files/${canvasId}/${fileId}.${ext}`;

        // Upsert: the same file ID may be re-saved
        const { error: uploadError } = await client.storage
          .from(CANVAS_FILES_BUCKET)
          .upload(objectPath, buffer, { contentType: mimeType, upsert: true });

        if (uploadError) {
          // On upload failure, keep the original base64 (graceful degradation)
          updatedFiles[fileId] = fileData;
          return;
        }

        updatedFiles[fileId] = {
          ...fileData,
          dataURL: `${OSS_MARKER_PREFIX}${CANVAS_FILES_BUCKET}/${objectPath}`,
        };
      } catch {
        // Unparseable dataURL — keep as-is
        updatedFiles[fileId] = fileData;
      }
    }),
  );

  return {
    ...content,
    files: updatedFiles,
  } as CanvasContent;
}

// ---------------------------------------------------------------------------
// File resolution (load path): oss:// marker → base64 dataURL
// ---------------------------------------------------------------------------

async function resolveFilesFromStorage(
  client: UserSupabaseClient,
  content: CanvasContent,
): Promise<CanvasContent> {
  const files = (content as { files?: CanvasFileRecord }).files;
  if (!files || Object.keys(files).length === 0) {
    return content;
  }

  // Separate OSS files from inline files
  const updatedFiles: CanvasFileRecord = {};
  const ossEntries: Array<{
    fileId: string;
    fileData: Record<string, unknown>;
    bucket: string;
    objectPath: string;
  }> = [];

  for (const [fileId, fileData] of Object.entries(files)) {
    const dataURL = fileData.dataURL as string | undefined;
    if (!dataURL?.startsWith(OSS_MARKER_PREFIX)) {
      updatedFiles[fileId] = fileData;
      continue;
    }

    const ref = dataURL.slice(OSS_MARKER_PREFIX.length);
    const slashIdx = ref.indexOf("/");
    if (slashIdx === -1) continue;
    ossEntries.push({
      fileId,
      fileData,
      bucket: ref.slice(0, slashIdx),
      objectPath: ref.slice(slashIdx + 1),
    });
  }

  if (ossEntries.length === 0) {
    return content;
  }

  // Resolve public URLs instead of downloading each file
  // Group by bucket (normally all in one bucket)
  const byBucket = new Map<string, typeof ossEntries>();
  for (const entry of ossEntries) {
    const list = byBucket.get(entry.bucket) ?? [];
    list.push(entry);
    byBucket.set(entry.bucket, list);
  }

  for (const [bucket, entries] of byBucket) {
    for (const entry of entries) {
      const { data } = client.storage
        .from(bucket)
        .getPublicUrl(entry.objectPath);
      updatedFiles[entry.fileId] = {
        ...entry.fileData,
        dataURL: undefined,
        storageUrl: data.publicUrl,
      };
    }
  }

  return {
    ...content,
    files: updatedFiles,
  } as CanvasContent;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseDataURL(dataURL: string): { buffer: Buffer; mimeType: string } {
  // Format: data:[<mediatype>][;base64],<data>
  const match = dataURL.match(DATA_URL_RE);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const [, mimeType, data] = match;
  if (!mimeType || !data) {
    throw new Error("Invalid data URL");
  }
  return {
    mimeType,
    buffer: Buffer.from(data, "base64"),
  };
}

function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
