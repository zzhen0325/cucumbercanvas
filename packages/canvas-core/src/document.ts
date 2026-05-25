import type { PenDocument, PenNode, PenPage } from '@cucumber/pen-types';
import type { CanvasBounds, CanvasViewport } from './types.js';

let idCounter = 0;

export function createNodeId(prefix = 'node'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** @deprecated Use createNodeId */
export const createCanvasNodeId = createNodeId;

export function createEmptyDocument(name?: string): PenDocument {
  const defaultPage: PenPage = {
    id: 'page-default',
    name: 'Page 1',
    children: [],
  };
  return {
    version: '1.0.0',
    name: name ?? 'Untitled',
    pages: [defaultPage],
    children: [],
  };
}

export function getActivePage(doc: PenDocument): PenPage {
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages[0]!;
  }
  return { id: 'page-default', name: 'Page 1', children: doc.children };
}

export function getActiveChildren(doc: PenDocument): PenNode[] {
  return getActivePage(doc).children;
}

export function setActiveChildren(doc: PenDocument, children: PenNode[]): PenDocument {
  const page = getActivePage(doc);
  if (doc.pages && doc.pages.length > 0) {
    return {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === page.id ? { ...p, children } : p,
      ),
    };
  }
  return { ...doc, children };
}

/** BFS search for a node by ID in the document tree */
export function findNode(doc: PenDocument, nodeId: string): PenNode | undefined {
  const children = getActiveChildren(doc);
  return findNodeInList(children, nodeId);
}

export function findNodeInList(nodes: PenNode[], nodeId: string): PenNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if ('children' in node && Array.isArray(node.children)) {
      const found = findNodeInList(node.children as PenNode[], nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/** Find parent node of a given node ID */
export function findParent(doc: PenDocument, nodeId: string): PenNode | undefined {
  const children = getActiveChildren(doc);
  return findParentInList(children, nodeId);
}

export function findParentInList(nodes: PenNode[], nodeId: string): PenNode | undefined {
  for (const node of nodes) {
    if ('children' in node && Array.isArray(node.children)) {
      const childList = node.children as PenNode[];
      if (childList.some((c) => c.id === nodeId)) return node;
      const found = findParentInList(childList, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/** Check if candidateId is a descendant of ancestorId */
export function isDescendantOf(doc: PenDocument, nodeId: string, ancestorId: string): boolean {
  let current = findParent(doc, nodeId);
  while (current) {
    if (current.id === ancestorId) return true;
    current = findParent(doc, current.id);
  }
  return false;
}

/** Flatten the document tree into a flat array (depth-first) */
export function flattenNodes(doc: PenDocument): PenNode[] {
  const result: PenNode[] = [];
  const walk = (nodes: PenNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children as PenNode[]);
      }
    }
  };
  walk(getActiveChildren(doc));
  return result;
}

/** Get children of a container node */
export function getNodeChildren(doc: PenDocument, nodeId: string | null): PenNode[] {
  if (nodeId === null) return getActiveChildren(doc);
  const node = findNode(doc, nodeId);
  if (!node || !('children' in node) || !Array.isArray(node.children)) return [];
  return node.children as PenNode[];
}

export function getNodeBounds(node: PenNode): CanvasBounds {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  let width = 100;
  let height = 100;
  if ('width' in node) {
    const w = (node as any).width;
    width = typeof w === 'number' ? w : 100;
  }
  if ('height' in node) {
    const h = (node as any).height;
    height = typeof h === 'number' ? h : 100;
  }
  return { x, y, width, height, rotation: node.rotation };
}

export function isBoundsInside(inner: CanvasBounds, outer: CanvasBounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function cloneDocument(doc: PenDocument): PenDocument {
  return structuredClone(doc);
}

/** @deprecated Use cloneDocument */
export const cloneCanvasDocument = cloneDocument;

// ---------------------------------------------------------------------------
// Default viewport
// ---------------------------------------------------------------------------

export function defaultViewport(): CanvasViewport {
  return { x: 0, y: 0, zoom: 1, backgroundColor: '#ffffff' };
}
