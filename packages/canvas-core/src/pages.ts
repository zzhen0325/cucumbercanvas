import type { PenDocument, PenNode, PenPage } from "@cucumber/pen-types";
import { createNodeId } from "./document.js";
import type { CanvasPage, CucumberCanvasDocument } from "./types.js";

export const DEFAULT_CANVAS_PAGE_ID = "page-default";

export class CanvasPageOperationError extends Error {
  readonly code:
    | "page_not_found"
    | "invalid_page_name"
    | "invalid_page_operation";

  constructor(code: CanvasPageOperationError["code"], message: string) {
    super(message);
    this.name = "CanvasPageOperationError";
    this.code = code;
  }
}

export interface CanvasPageMutationResult {
  document: PenDocument;
  page: CanvasPage;
}

export function createDefaultCanvasPage(children: PenNode[] = []): CanvasPage {
  return {
    id: DEFAULT_CANVAS_PAGE_ID,
    name: "Page 1",
    children: structuredClone(children),
  };
}

export function normalizeCanvasPages(doc: PenDocument): CucumberCanvasDocument {
  const pages = requireCanvasPages(doc).map((page) => ({
    ...page,
    id: requirePageId(page.id),
    name: normalizePageName(page.name),
    children: requirePageChildren(page),
  }));
  assertUniqueCanvasPageIds(pages);

  return {
    ...doc,
    activePageId: resolvePageIdFromPages(pages, doc.activePageId),
    pages,
    children: [],
  };
}

export function getCanvasPages(doc: PenDocument): CanvasPage[] {
  return getNormalizedPages(normalizeCanvasPages(doc));
}

export function resolveActivePageId(
  doc: PenDocument,
  activePageId?: string | null,
): string {
  const requestedPageId =
    normalizeOptionalPageId(activePageId) ??
    normalizeOptionalPageId(doc.activePageId);
  if (!requestedPageId) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      "Canvas document must include an activePageId that points to an existing page.",
    );
  }
  const pages = getCanvasPages(doc);
  if (pages.some((page) => page.id === requestedPageId)) {
    return requestedPageId;
  }
  throw new CanvasPageOperationError(
    "page_not_found",
    `Page ${requestedPageId} does not exist.`,
  );
}

export function getCanvasPage(
  doc: PenDocument,
  pageId?: string | null,
): CanvasPage {
  const resolvedPageId = resolveActivePageId(doc, pageId);
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  return getPageOrThrow(pages, resolvedPageId);
}

export function addCanvasPage(
  doc: PenDocument,
  options?: {
    id?: string;
    name?: string;
    children?: PenNode[];
    index?: number;
  },
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const activePageId = resolveActivePageId(normalized);
  const page: CanvasPage = {
    id: options?.id ?? createNodeId("page"),
    name: normalizePageName(options?.name ?? `Page ${pages.length + 1}`),
    children: options?.children ? structuredClone(options.children) : [],
  };
  const index = clampInsertIndex(options?.index, pages.length);
  const nextPages = [...pages];
  nextPages.splice(index, 0, page);
  assertUniqueCanvasPageIds(nextPages);
  return {
    document: { ...normalized, activePageId, pages: nextPages, children: [] },
    page,
  };
}

export function renameCanvasPage(
  doc: PenDocument,
  pageId: string,
  name: string,
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const activePageId = resolveActivePageId(normalized);
  const page = getExistingPage(normalized, pageId);
  const renamedPage = { ...page, name: normalizePageName(name) };
  return {
    document: {
      ...normalized,
      activePageId,
      pages: getNormalizedPages(normalized).map((candidate) =>
        candidate.id === pageId ? renamedPage : candidate,
      ),
      children: [],
    },
    page: renamedPage,
  };
}

export function duplicateCanvasPage(
  doc: PenDocument,
  pageId: string,
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const activePageId = resolveActivePageId(normalized);
  const page = getExistingPage(normalized, pageId);
  const pageIndex = pages.findIndex((candidate) => candidate.id === pageId);
  const duplicatedPage: CanvasPage = {
    id: createNodeId("page"),
    name: `${page.name} copy`,
    children: page.children.map((node) => cloneNodeTreeWithNewIds(node)),
  };
  const nextPages = [...pages];
  nextPages.splice(pageIndex + 1, 0, duplicatedPage);
  return {
    document: { ...normalized, activePageId, pages: nextPages, children: [] },
    page: duplicatedPage,
  };
}

export function deleteCanvasPage(
  doc: PenDocument,
  pageId: string,
  nextActivePageId?: string | null,
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  getExistingPage(normalized, pageId);
  if (pages.length === 1) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      "Cannot delete the only page.",
    );
  }
  const currentActivePageId = resolveActivePageId(normalized);
  const deletedIndex = pages.findIndex((candidate) => candidate.id === pageId);
  const nextPages = pages.filter((candidate) => candidate.id !== pageId);
  const normalizedNextActivePageId = normalizeOptionalPageId(nextActivePageId);
  const activePage = normalizedNextActivePageId
    ? getPageOrThrow(nextPages, normalizedNextActivePageId)
    : currentActivePageId === pageId
      ? getPageAt(nextPages, Math.min(deletedIndex, nextPages.length - 1))
      : getPageOrThrow(nextPages, currentActivePageId);
  return {
    document: {
      ...normalized,
      activePageId: activePage.id,
      pages: nextPages,
      children: [],
    },
    page: activePage,
  };
}

export function reorderCanvasPage(
  doc: PenDocument,
  pageId: string,
  direction: "left" | "right" | "start" | "end",
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const activePageId = resolveActivePageId(normalized);
  const page = getExistingPage(normalized, pageId);
  const fromIndex = pages.findIndex((candidate) => candidate.id === pageId);
  let toIndex = fromIndex;
  if (direction === "left") toIndex = Math.max(0, fromIndex - 1);
  if (direction === "right")
    toIndex = Math.min(pages.length - 1, fromIndex + 1);
  if (direction === "start") toIndex = 0;
  if (direction === "end") toIndex = pages.length - 1;

  if (toIndex === fromIndex) {
    return { document: { ...normalized, activePageId, children: [] }, page };
  }

  const nextPages = [...pages];
  nextPages.splice(fromIndex, 1);
  nextPages.splice(toIndex, 0, page);
  return {
    document: { ...normalized, activePageId, pages: nextPages, children: [] },
    page,
  };
}

function getExistingPage(doc: PenDocument, pageId: string): CanvasPage {
  const page = getCanvasPages(doc).find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new CanvasPageOperationError(
      "page_not_found",
      `Page ${pageId} does not exist.`,
    );
  }
  return page;
}

function getNormalizedPages(doc: PenDocument): CanvasPage[] {
  return requireCanvasPages(doc);
}

function getPageAt(pages: readonly CanvasPage[], index: number): CanvasPage {
  const page = pages[index];
  if (!page) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      `Page index ${index} does not exist.`,
    );
  }
  return page;
}

function resolvePageIdFromPages(
  pages: readonly CanvasPage[],
  activePageId?: string | null,
): string {
  const requestedPageId = normalizeOptionalPageId(activePageId);
  if (!requestedPageId) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      "Canvas document must include an activePageId that points to an existing page.",
    );
  }
  return getPageOrThrow(pages, requestedPageId).id;
}

export function assertUniqueCanvasPageIds(pages: readonly PenPage[]): void {
  const seen = new Set<string>();
  for (const page of pages) {
    if (!page.id) continue;
    if (seen.has(page.id)) {
      throw new CanvasPageOperationError(
        "invalid_page_operation",
        `Page ${page.id} already exists.`,
      );
    }
    seen.add(page.id);
  }
}

function getPageOrThrow(
  pages: readonly CanvasPage[],
  pageId: string,
): CanvasPage {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new CanvasPageOperationError(
      "page_not_found",
      `Page ${pageId} does not exist.`,
    );
  }
  return page;
}

function normalizePageName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new CanvasPageOperationError(
      "invalid_page_name",
      "Page name cannot be empty.",
    );
  }
  return trimmed;
}

function normalizeOptionalPageId(
  pageId: string | null | undefined,
): string | null {
  if (pageId === undefined || pageId === null) return null;
  const trimmed = pageId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireCanvasPages(doc: PenDocument): CanvasPage[] {
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      "Unsupported legacy canvas document: PenDocument.pages is required.",
    );
  }
  return doc.pages;
}

function requirePageId(pageId: string | null | undefined): string {
  const normalized = normalizeOptionalPageId(pageId);
  if (!normalized) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      "Canvas page id is required.",
    );
  }
  return normalized;
}

function requirePageChildren(page: PenPage): PenNode[] {
  if (!Array.isArray(page.children)) {
    throw new CanvasPageOperationError(
      "invalid_page_operation",
      `Canvas page ${page.id} must include a children array.`,
    );
  }
  return structuredClone(page.children);
}

function clampInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(index, length));
}

function cloneNodeTreeWithNewIds(node: PenNode): PenNode {
  const clone = structuredClone(node) as PenNode;
  clone.id = createNodeId(node.type);
  if ("children" in clone && Array.isArray(clone.children)) {
    clone.children = (clone.children as PenNode[]).map((child) =>
      cloneNodeTreeWithNewIds(child),
    );
  }
  return clone;
}
