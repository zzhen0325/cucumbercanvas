import type { ContextSlots, PenDocument, PenNode } from "@cucumber/pen-types";
import {
  findNode,
  findParent,
  flattenNodes,
  getNodeBounds,
  isBoundsInside,
} from "./document.js";
import type { AgentContext, NodeSummary } from "./types.js";

export class CanvasOperationError extends Error {
  readonly code:
    | "container_not_found"
    | "node_not_found"
    | "permission_denied"
    | "bounds_violation"
    | "invalid_operation";

  constructor(code: CanvasOperationError["code"], message: string) {
    super(message);
    this.name = "CanvasOperationError";
    this.code = code;
  }
}

/** Check if a PenNode has container capabilities (Frame/Group with children) */
export function isContainerNode(node: PenNode | undefined): node is PenNode {
  if (!node) return false;
  return node.type === "frame" || node.type === "group";
}

/** Check if a PenNode acts as an agent container */
export function isAgentContainer(node: PenNode | undefined): node is PenNode {
  if (!node) return false;
  return isContainerNode(node) && (node.containerRole?.length ?? 0) > 0;
}

/** Walk up the tree from containerId to root, returning the path */
export function getContainerPath(
  doc: PenDocument,
  containerId: string,
): string[] {
  const path: string[] = [];
  let current = findNode(doc, containerId);
  while (current) {
    path.unshift(current.id);
    current = findParent(doc, current.id);
  }
  return path;
}

/** Resolve effective context slots by walking ancestor chain with inherit policies */
export function resolveContext(
  doc: PenDocument,
  containerId: string,
): ContextSlots {
  const chain = getContainerPath(doc, containerId)
    .map((id) => findNode(doc, id))
    .filter(isAgentContainer);

  let acc: ContextSlots = {};
  for (const node of chain) {
    const slots = node.contextSlots ?? {};
    switch (node.inheritPolicy) {
      case "block":
        acc = blockSlots(acc, slots);
        break;
      case "override":
        acc = { ...acc, ...slots };
        break;
      default:
        acc = mergeSlots(acc, slots);
        break;
    }
  }
  return acc;
}

export function buildAgentContext(args: {
  doc: PenDocument;
  agentId: string;
  containerId: string;
}): AgentContext {
  const container = findNode(args.doc, args.containerId);
  if (!isAgentContainer(container)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${args.containerId} does not exist or has no container role.`,
    );
  }

  const allNodes = flattenNodes(args.doc);
  const containerBounds = getNodeBounds(container);

  return {
    agentId: args.agentId,
    containerId: args.containerId,
    containerPath: getContainerPath(args.doc, args.containerId),
    effectiveContext: resolveContext(args.doc, args.containerId),
    visibleNodes: allNodes
      .filter((n) => n.id !== container.id)
      .filter((n) => isBoundsInside(getNodeBounds(n), containerBounds))
      .map((n) => ({
        id: n.id,
        type: n.type,
        title: n.name,
        bounds: getNodeBounds(n),
      })),
    permissions: container.agentBinding?.permissions ?? ["read"],
    siblings: allNodes
      .filter((n): boolean => {
        if (!isAgentContainer(n)) return false;
        const p = findParent(args.doc, n.id);
        const cp = findParent(args.doc, container.id);
        return p?.id === cp?.id && n.id !== container.id;
      })
      .map((n) => ({
        containerId: n.id,
        agentId: n.agentBinding?.agentId,
        status: n.agentBinding?.status,
      })),
  };
}

function mergeSlots(base: ContextSlots, overlay: ContextSlots): ContextSlots {
  return {
    style: { ...(base.style ?? {}), ...(overlay.style ?? {}) },
    tokens: { ...(base.tokens ?? {}), ...(overlay.tokens ?? {}) },
    rules: [...(base.rules ?? []), ...(overlay.rules ?? [])],
    constraints: {
      ...(base.constraints ?? {}),
      ...(overlay.constraints ?? {}),
    },
  };
}

function blockSlots(base: ContextSlots, local: ContextSlots): ContextSlots {
  return {
    style: local.style ?? base.style,
    tokens: local.tokens ?? base.tokens,
    rules: local.rules ?? base.rules,
    constraints: local.constraints ?? base.constraints,
  };
}
