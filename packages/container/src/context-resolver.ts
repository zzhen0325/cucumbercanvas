import type { ContainerNode, ContextSlots } from './types.js';

export function resolveContext(
  containerId: string,
  tree: Map<string, ContainerNode>
): ContextSlots {
  const chain: ContainerNode[] = [];
  let cur = tree.get(containerId);
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? tree.get(cur.parentId) : undefined;
  }
  chain.reverse();

  let acc: ContextSlots = {};
  for (const node of chain) {
    switch (node.inheritPolicy) {
      case 'block':
        acc = filterOutBlockedSlots(acc, node.contextSlots);
        break;
      case 'override':
        acc = { ...acc, ...node.contextSlots };
        break;
      case 'merge':
      default:
        acc = mergeSlots(acc, node.contextSlots);
        break;
    }
  }
  return acc;
}

function mergeSlots(base: ContextSlots, overlay: ContextSlots): ContextSlots {
  return {
    style: { ...(base.style ?? {}), ...(overlay.style ?? {}) },
    tokens: { ...(base.tokens ?? {}), ...(overlay.tokens ?? {}) },
    rules: [...(base.rules ?? []), ...(overlay.rules ?? [])],
    constraints: { ...(base.constraints ?? {}), ...(overlay.constraints ?? {}) },
  };
}

function filterOutBlockedSlots(base: ContextSlots, local: ContextSlots): ContextSlots {
  const result: ContextSlots = {};
  if (local.style) {
    result.style = local.style;
  } else {
    result.style = base.style;
  }
  if (local.tokens) {
    result.tokens = local.tokens;
  } else {
    result.tokens = base.tokens;
  }
  if (local.rules) {
    result.rules = local.rules;
  } else {
    result.rules = base.rules;
  }
  if (local.constraints) {
    result.constraints = local.constraints;
  } else {
    result.constraints = base.constraints;
  }
  return result;
}
