import type { PenNode, ContextSlots } from '@cucumber/pen-types';
import { findNodeInTree, findParentInTree } from '@cucumber/pen-core';

/**
 * Resolve effective context slots by walking ancestor chain from containerId
 * through the PenNode tree, applying inherit policies (merge/override/block).
 */
export function resolveContext(containerId: string, nodes: PenNode[]): ContextSlots {
  const chain = getContainerPath(containerId, nodes)
    .map((id) => findNodeInTree(nodes, id))
    .filter((n): n is PenNode => !!n);

  let acc: ContextSlots = {};
  for (const node of chain) {
    const slots = node.contextSlots ?? {};
    switch (node.inheritPolicy) {
      case 'block':
        acc = {
          style: slots.style ?? acc.style,
          tokens: slots.tokens ?? acc.tokens,
          rules: slots.rules ?? acc.rules,
          constraints: slots.constraints ?? acc.constraints,
        };
        break;
      case 'override':
        acc = { ...acc, ...slots };
        break;
      default: // merge
        acc = {
          style: { ...(acc.style ?? {}), ...(slots.style ?? {}) },
          tokens: { ...(acc.tokens ?? {}), ...(slots.tokens ?? {}) },
          rules: [...(acc.rules ?? []), ...(slots.rules ?? [])],
          constraints: { ...(acc.constraints ?? {}), ...(slots.constraints ?? {}) },
        };
        break;
    }
  }
  return acc;
}

/** Walk up the tree to get ancestor path for a container */
export function getContainerPath(containerId: string, nodes: PenNode[]): string[] {
  const path: string[] = [];
  let current = findNodeInTree(nodes, containerId);
  while (current) {
    path.unshift(current.id);
    current = findParentInTree(nodes, current.id);
  }
  return path;
}
