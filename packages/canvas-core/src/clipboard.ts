import type { PenDocument, PenNode } from '@cucumber/pen-types';
import type { CanvasAsset } from './types.js';
import { CanvasOperationError } from './context.js';
import { cloneDocument, createNodeId, findNode, findParent } from './document.js';
import { applyCanvasOperation } from './operations.js';

export interface CanvasClipboardData {
  nodes: PenNode[];
  assets: CanvasAsset[];
  /** @deprecated Legacy field — subset of nodes considered "roots" */
  rootNodeIds?: string[];
}

export interface PasteCanvasClipboardResult {
  doc: PenDocument;
  pastedIds: string[];
}

export function copyCanvasSelection(doc: PenDocument, nodeIds: string[]): CanvasClipboardData {
  const nodes: PenNode[] = [];
  const assets: CanvasAsset[] = [];
  const visited = new Set<string>();

  const collect = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = findNode(doc, nodeId);
    if (!node) {
      throw new CanvasOperationError('node_not_found', `Node ${nodeId} does not exist.`);
    }
    nodes.push(structuredClone(node));
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children as PenNode[]) {
        collect(child.id);
      }
    }
  };

  for (const nodeId of nodeIds) collect(nodeId);
  return { nodes, assets };
}

export function duplicateCanvasNodes(
  doc: PenDocument,
  nodeIds: string[],
  offset = 16,
): PasteCanvasClipboardResult {
  return pasteCanvasClipboard(doc, copyCanvasSelection(doc, nodeIds), { offset });
}

/**
 * Paste clipboard nodes into a document.
 *
 * clipboard.nodes may contain both parent and child nodes (copyCanvasSelection
 * collects the full subtree). We only insert "clipboard-root" nodes — those
 * whose original parent is NOT in the clipboard. Their children are already
 * nested inside and are recursively re-ID'd via remapNodeTree.
 */
export function pasteCanvasClipboard(
  doc: PenDocument,
  clipboard: CanvasClipboardData,
  options?: { offset?: number; parentId?: string | null },
): PasteCanvasClipboardResult {
  let next = cloneDocument(doc);
  const offset = options?.offset ?? 16;
  const targetParentId = options?.parentId ?? null;
  const pastedIds: string[] = [];

  const clipboardIds = new Set(clipboard.nodes.map((n) => n.id));

  for (const original of clipboard.nodes) {
    // Skip nodes whose parent is also in the clipboard — they are already
    // nested inside the parent's children array and will be re-ID'd recursively.
    const parent = findParent(doc, original.id);
    if (parent && clipboardIds.has(parent.id)) continue;

    const clone = remapNodeTree(original, offset, 0);
    pastedIds.push(clone.id);
    next = applyCanvasOperation(next, {
      type: 'insertNode',
      node: clone,
      parentId: targetParentId,
    });
  }

  return { doc: next, pastedIds };
}

/** Deep-clone a node tree, assigning new IDs and applying positional offset to the root. */
function remapNodeTree(node: PenNode, offset: number, depth: number): PenNode {
  const clone = structuredClone(node) as PenNode;
  clone.id = createNodeId(node.type);
  if (depth === 0) {
    clone.x = (clone.x ?? 0) + offset;
    clone.y = (clone.y ?? 0) + offset;
  }
  clone.name = node.name ? `${node.name} copy` : node.name;

  if ('children' in clone && Array.isArray(clone.children)) {
    clone.children = (clone.children as PenNode[]).map((child) =>
      remapNodeTree(child, offset, depth + 1),
    );
  }

  return clone;
}
