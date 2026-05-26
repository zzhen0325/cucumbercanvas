import type { PenDocument, PenNode, PenPage } from '@cucumber/pen-types';
import type { CanvasPage } from './types.js';
import { createNodeId } from './document.js';

export const DEFAULT_CANVAS_PAGE_ID = 'page-default';

export class CanvasPageOperationError extends Error {
  readonly code: 'page_not_found' | 'invalid_page_name' | 'invalid_page_operation';

  constructor(code: CanvasPageOperationError['code'], message: string) {
    super(message);
    this.name = 'CanvasPageOperationError';
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
    name: 'Page 1',
    children: structuredClone(children),
  };
}

export function normalizeCanvasPages(doc: PenDocument): PenDocument {
  if (doc.pages && doc.pages.length > 0) {
    const pages = doc.pages.map((page, index) => ({
      ...page,
      id: page.id || (index === 0 ? DEFAULT_CANVAS_PAGE_ID : createNodeId('page')),
      name: normalizePageName(page.name || `Page ${index + 1}`),
      children: page.children ?? [],
    }));
    assertUniqueCanvasPageIds(pages);

    return {
      ...doc,
      pages,
      children: [],
    };
  }

  return {
    ...doc,
    pages: [createDefaultCanvasPage(doc.children ?? [])],
    children: [],
  };
}

export function getCanvasPages(doc: PenDocument): CanvasPage[] {
  return getNormalizedPages(normalizeCanvasPages(doc));
}

export function resolveActivePageId(doc: PenDocument, activePageId?: string | null): string {
  const requestedPageId =
    normalizeOptionalPageId(activePageId) ?? normalizeOptionalPageId(doc.activePageId);
  if (!doc.pages || doc.pages.length === 0) {
    if (!requestedPageId) {
      return DEFAULT_CANVAS_PAGE_ID;
    }
    throw new CanvasPageOperationError(
      'page_not_found',
      `Page ${requestedPageId} does not exist.`,
    );
  }

  const pages = getCanvasPages(doc);
  if (!requestedPageId) {
    return getPageAt(pages, 0).id;
  }
  if (pages.some((page) => page.id === requestedPageId)) {
    return requestedPageId;
  }
  throw new CanvasPageOperationError(
    'page_not_found',
    `Page ${requestedPageId} does not exist.`,
  );
}

export function getCanvasPage(doc: PenDocument, pageId?: string | null): CanvasPage {
  const resolvedPageId = resolveActivePageId(doc, pageId);
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  return getPageOrThrow(pages, resolvedPageId);
}

export function addCanvasPage(
  doc: PenDocument,
  options?: { id?: string; name?: string; children?: PenNode[]; index?: number },
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const page: CanvasPage = {
    id: options?.id ?? createNodeId('page'),
    name: normalizePageName(options?.name ?? `Page ${pages.length + 1}`),
    children: options?.children ? structuredClone(options.children) : [],
  };
  const index = clampInsertIndex(options?.index, pages.length);
  const nextPages = [...pages];
  nextPages.splice(index, 0, page);
  assertUniqueCanvasPageIds(nextPages);
  return {
    document: { ...normalized, pages: nextPages, children: [] },
    page,
  };
}

export function renameCanvasPage(
  doc: PenDocument,
  pageId: string,
  name: string,
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const page = getExistingPage(normalized, pageId);
  const renamedPage = { ...page, name: normalizePageName(name) };
  return {
    document: {
      ...normalized,
      pages: getNormalizedPages(normalized).map((candidate) =>
        candidate.id === pageId ? renamedPage : candidate,
      ),
      children: [],
    },
    page: renamedPage,
  };
}

export function duplicateCanvasPage(doc: PenDocument, pageId: string): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const page = getExistingPage(normalized, pageId);
  const pageIndex = pages.findIndex((candidate) => candidate.id === pageId);
  const duplicatedPage: CanvasPage = {
    id: createNodeId('page'),
    name: `${page.name} copy`,
    children: page.children.map((node) => cloneNodeTreeWithNewIds(node)),
  };
  const nextPages = [...pages];
  nextPages.splice(pageIndex + 1, 0, duplicatedPage);
  return {
    document: { ...normalized, pages: nextPages, children: [] },
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
  if (pages.length === 1) {
    throw new CanvasPageOperationError('invalid_page_operation', 'Cannot delete the only page.');
  }
  getExistingPage(normalized, pageId);
  const deletedIndex = pages.findIndex((candidate) => candidate.id === pageId);
  const nextPages = pages.filter((candidate) => candidate.id !== pageId);
  const normalizedNextActivePageId = normalizeOptionalPageId(nextActivePageId);
  const activePage = normalizedNextActivePageId
    ? getPageOrThrow(nextPages, normalizedNextActivePageId)
    : getPageAt(nextPages, Math.min(deletedIndex, nextPages.length - 1));
  return {
    document: { ...normalized, activePageId: activePage.id, pages: nextPages, children: [] },
    page: activePage,
  };
}

export function reorderCanvasPage(
  doc: PenDocument,
  pageId: string,
  direction: 'left' | 'right' | 'start' | 'end',
): CanvasPageMutationResult {
  const normalized = normalizeCanvasPages(doc);
  const pages = getNormalizedPages(normalized);
  const page = getExistingPage(normalized, pageId);
  const fromIndex = pages.findIndex((candidate) => candidate.id === pageId);
  let toIndex = fromIndex;
  if (direction === 'left') toIndex = Math.max(0, fromIndex - 1);
  if (direction === 'right') toIndex = Math.min(pages.length - 1, fromIndex + 1);
  if (direction === 'start') toIndex = 0;
  if (direction === 'end') toIndex = pages.length - 1;

  if (toIndex === fromIndex) {
    return { document: normalized, page };
  }

  const nextPages = [...pages];
  nextPages.splice(fromIndex, 1);
  nextPages.splice(toIndex, 0, page);
  return {
    document: { ...normalized, pages: nextPages, children: [] },
    page,
  };
}

function getExistingPage(doc: PenDocument, pageId: string): CanvasPage {
  const page = getCanvasPages(doc).find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new CanvasPageOperationError('page_not_found', `Page ${pageId} does not exist.`);
  }
  return page;
}

function getNormalizedPages(doc: PenDocument): CanvasPage[] {
  if (!doc.pages || doc.pages.length === 0) {
    throw new CanvasPageOperationError(
      'invalid_page_operation',
      'Canvas document must contain at least one page.',
    );
  }
  return doc.pages;
}

function getPageAt(pages: readonly CanvasPage[], index: number): CanvasPage {
  const page = pages[index];
  if (!page) {
    throw new CanvasPageOperationError(
      'invalid_page_operation',
      `Page index ${index} does not exist.`,
    );
  }
  return page;
}

export function assertUniqueCanvasPageIds(pages: readonly PenPage[]): void {
  const seen = new Set<string>();
  for (const page of pages) {
    if (!page.id) continue;
    if (seen.has(page.id)) {
      throw new CanvasPageOperationError(
        'invalid_page_operation',
        `Page ${page.id} already exists.`,
      );
    }
    seen.add(page.id);
  }
}

function getPageOrThrow(pages: readonly CanvasPage[], pageId: string): CanvasPage {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new CanvasPageOperationError('page_not_found', `Page ${pageId} does not exist.`);
  }
  return page;
}

function normalizePageName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new CanvasPageOperationError('invalid_page_name', 'Page name cannot be empty.');
  }
  return trimmed;
}

function normalizeOptionalPageId(pageId: string | null | undefined): string | null {
  if (pageId === undefined || pageId === null) return null;
  const trimmed = pageId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(index, length));
}

function cloneNodeTreeWithNewIds(node: PenNode): PenNode {
  const clone = structuredClone(node) as PenNode;
  clone.id = createNodeId(node.type);
  if ('children' in clone && Array.isArray(clone.children)) {
    clone.children = (clone.children as PenNode[]).map((child) =>
      cloneNodeTreeWithNewIds(child),
    );
  }
  return clone;
}
