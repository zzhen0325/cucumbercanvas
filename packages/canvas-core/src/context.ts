import { isBoundsInside } from "./document.js";
import type {
  AgentContext,
  CanvasNode,
  ContainerNode,
  ContextSlots,
  CucumberCanvasDocument,
  NodeSummary,
} from "./types.js";

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

export function isContainerNode(
  node: CanvasNode | undefined,
): node is ContainerNode {
  return node?.type === "container";
}

export function getContainerPath(
  doc: CucumberCanvasDocument,
  containerId: string,
): string[] {
  const path: string[] = [];
  let current = doc.nodes[containerId];
  while (current) {
    path.unshift(current.id);
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return path;
}

export function resolveContext(
  doc: CucumberCanvasDocument,
  containerId: string,
): ContextSlots {
  const chain = getContainerPath(doc, containerId)
    .map((id) => doc.nodes[id])
    .filter(isContainerNode);

  let acc: ContextSlots = {};
  for (const node of chain) {
    switch (node.inheritPolicy) {
      case "block":
        acc = blockSlots(acc, node.contextSlots);
        break;
      case "override":
        acc = { ...acc, ...node.contextSlots };
        break;
      default:
        acc = mergeSlots(acc, node.contextSlots);
        break;
    }
  }
  return acc;
}

export function buildAgentContext(args: {
  doc: CucumberCanvasDocument;
  agentId: string;
  containerId: string;
}): AgentContext {
  const container = args.doc.nodes[args.containerId];
  if (!isContainerNode(container)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${args.containerId} does not exist.`,
    );
  }

  return {
    agentId: args.agentId,
    containerId: args.containerId,
    containerPath: getContainerPath(args.doc, args.containerId),
    effectiveContext: resolveContext(args.doc, args.containerId),
    visibleNodes: getVisibleNodes(args.doc, container),
    permissions: container.agentBinding?.permissions ?? ["read"],
    siblings: Object.values(args.doc.nodes)
      .filter(
        (node): node is ContainerNode =>
          node.type === "container" &&
          node.parentId === container.parentId &&
          node.id !== container.id,
      )
      .map((node) => ({
        containerId: node.id,
        agentId: node.agentBinding?.agentId,
        status: node.agentBinding?.status,
      })),
  };
}

function getVisibleNodes(
  doc: CucumberCanvasDocument,
  container: ContainerNode,
): NodeSummary[] {
  return Object.values(doc.nodes)
    .filter((node) => node.id !== container.id)
    .filter((node) => isBoundsInside(node.bounds, container.bounds))
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      bounds: node.bounds,
    }));
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
