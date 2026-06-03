import {
  type CanvasBounds,
  type CanvasOperation,
  type PenDocument,
  type PenNode,
  findNode,
  findParent,
  getBoundsUnion,
  getNodeBounds,
} from "@cucumber/canvas-core";

export type LayoutCanvasStrategy =
  | "auto_layout"
  | "grid"
  | "stack"
  | "flow"
  | "avoid_overlap"
  | "align_distribute";

export type LayoutCanvasPadding =
  | number
  | [number, number]
  | [number, number, number, number];

export type LayoutCanvasPlan = ReturnType<typeof buildLayoutCanvasPlan>;

export function buildLayoutCanvasPlan(args: {
  bounds?: CanvasBounds;
  containerId?: string;
  direction?: "vertical" | "horizontal";
  doc: PenDocument;
  gap: number;
  nodeIds?: string[];
  padding: LayoutCanvasPadding;
  pageId?: string;
  preserveManualPositions: boolean;
  strategy: LayoutCanvasStrategy;
}) {
  let container: (PenNode & { children: PenNode[] }) | undefined;
  if (args.containerId) {
    const candidate = findNode(args.doc, args.containerId, args.pageId);
    if (!isContainerNode(candidate)) {
      throw new Error(
        `layout_canvas containerId ${args.containerId} is not a frame/group container.`,
      );
    }
    container = candidate;
  }
  if (args.strategy === "auto_layout") {
    if (!container) {
      throw new Error("layout_canvas auto_layout requires containerId.");
    }
    return buildAutoLayoutPlan(args, container);
  }
  if (args.preserveManualPositions) {
    throw new Error(
      `layout_canvas strategy ${args.strategy} needs to move nodes; preserveManualPositions is only valid for auto_layout.`,
    );
  }
  const targets = resolveLayoutTargets(args, container);
  assertSharedParent(args.doc, targets, args.pageId);
  const operations = buildPlacementOperations(args, targets, container);
  const finalBounds = getBoundsUnion(
    operations
      .map((operation) =>
        operation.type === "updateNode"
          ? getUpdatedBounds(
              requireTarget(targets, operation.nodeId),
              operation.updates,
            )
          : null,
      )
      .filter((bounds): bounds is CanvasBounds => Boolean(bounds)),
  );
  return {
    affectedNodeIds: targets.map((node) => node.id),
    finalBounds,
    layoutWarnings: [],
    operations,
    strategy: args.strategy,
  };
}

function buildAutoLayoutPlan(
  args: Parameters<typeof buildLayoutCanvasPlan>[0],
  container: PenNode & { children: PenNode[] },
) {
  const direction = args.direction ?? "vertical";
  const updates: Partial<PenNode> & {
    gap?: number;
    layout?: "horizontal" | "vertical";
    padding?: LayoutCanvasPadding;
  } = {
    gap: args.gap,
    layout: direction,
    padding: args.padding,
  };
  return {
    affectedNodeIds: [container.id],
    finalBounds: getNodeBounds(container),
    layoutWarnings: [],
    operations: [
      {
        type: "updateNode",
        activePageId: args.pageId,
        nodeId: container.id,
        updates,
      } satisfies CanvasOperation,
    ],
    strategy: args.strategy,
  };
}

function resolveLayoutTargets(
  args: Parameters<typeof buildLayoutCanvasPlan>[0],
  container: (PenNode & { children: PenNode[] }) | undefined,
) {
  if (args.nodeIds?.length) {
    return args.nodeIds.map((nodeId) => {
      const node = findNode(args.doc, nodeId, args.pageId);
      if (!node)
        throw new Error(`layout_canvas node ${nodeId} does not exist.`);
      return node;
    });
  }
  if (container) {
    return container.children.filter((child) => child.visible !== false);
  }
  throw new Error("layout_canvas requires nodeIds or containerId.");
}

function buildPlacementOperations(
  args: Parameters<typeof buildLayoutCanvasPlan>[0],
  targets: PenNode[],
  container: (PenNode & { children: PenNode[] }) | undefined,
): CanvasOperation[] {
  if (targets.length === 0) {
    throw new Error("layout_canvas has no visible target nodes to layout.");
  }
  const direction = args.direction ?? "vertical";
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = expandPadding(
    args.padding,
  );
  const bounds: CanvasBounds =
    args.bounds ??
    (container
      ? {
          x: paddingLeft,
          y: paddingTop,
          width: Math.max(
            getNodeBounds(container).width - paddingLeft - paddingRight,
            1,
          ),
          height: Math.max(
            getNodeBounds(container).height - paddingTop - paddingBottom,
            1,
          ),
        }
      : getBoundsUnion(targets.map(getNodeBounds)));
  const sorted = [...targets].sort((a, b) =>
    direction === "horizontal"
      ? (a.x ?? 0) - (b.x ?? 0)
      : (a.y ?? 0) - (b.y ?? 0),
  );
  switch (args.strategy) {
    case "stack":
    case "avoid_overlap":
      return stackOperations(sorted, bounds, direction, args.gap, args.pageId);
    case "grid":
      return gridOperations(sorted, bounds, args.gap, args.pageId);
    case "flow":
      return flowOperations(sorted, bounds, args.gap, args.pageId);
    case "align_distribute":
      return distributeOperations(sorted, direction, args.pageId);
    default:
      throw new Error(
        `layout_canvas strategy ${args.strategy} is not supported.`,
      );
  }
}

function stackOperations(
  nodes: PenNode[],
  bounds: CanvasBounds,
  direction: "vertical" | "horizontal",
  gap: number,
  pageId: string | undefined,
): CanvasOperation[] {
  let cursor = direction === "horizontal" ? bounds.x : bounds.y;
  return nodes.map((node) => {
    const nodeBounds = getNodeBounds(node);
    const updates =
      direction === "horizontal"
        ? { x: cursor, y: bounds.y }
        : { x: bounds.x, y: cursor };
    cursor +=
      (direction === "horizontal" ? nodeBounds.width : nodeBounds.height) + gap;
    return updateNodeOperation(node.id, updates, pageId);
  });
}

function gridOperations(
  nodes: PenNode[],
  bounds: CanvasBounds,
  gap: number,
  pageId: string | undefined,
): CanvasOperation[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const maxWidth = Math.max(...nodes.map((node) => getNodeBounds(node).width));
  const maxHeight = Math.max(
    ...nodes.map((node) => getNodeBounds(node).height),
  );
  return nodes.map((node, index) =>
    updateNodeOperation(
      node.id,
      {
        x: bounds.x + (index % columns) * (maxWidth + gap),
        y: bounds.y + Math.floor(index / columns) * (maxHeight + gap),
      },
      pageId,
    ),
  );
}

function flowOperations(
  nodes: PenNode[],
  bounds: CanvasBounds,
  gap: number,
  pageId: string | undefined,
): CanvasOperation[] {
  let cursorX = bounds.x;
  let cursorY = bounds.y;
  let rowHeight = 0;
  return nodes.map((node) => {
    const nodeBounds = getNodeBounds(node);
    if (
      cursorX > bounds.x &&
      cursorX + nodeBounds.width > bounds.x + bounds.width
    ) {
      cursorX = bounds.x;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    const operation = updateNodeOperation(
      node.id,
      { x: cursorX, y: cursorY },
      pageId,
    );
    cursorX += nodeBounds.width + gap;
    rowHeight = Math.max(rowHeight, nodeBounds.height);
    return operation;
  });
}

function distributeOperations(
  nodes: PenNode[],
  direction: "vertical" | "horizontal",
  pageId: string | undefined,
): CanvasOperation[] {
  if (nodes.length < 2) {
    throw new Error(
      "layout_canvas align_distribute requires at least two nodes.",
    );
  }
  const sorted = [...nodes].sort((a, b) =>
    direction === "horizontal"
      ? getNodeBounds(a).x - getNodeBounds(b).x
      : getNodeBounds(a).y - getNodeBounds(b).y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  const firstBounds = getNodeBounds(first);
  const lastBounds = getNodeBounds(last);
  const span =
    direction === "horizontal"
      ? lastBounds.x + lastBounds.width - firstBounds.x
      : lastBounds.y + lastBounds.height - firstBounds.y;
  const totalSize = sorted.reduce((sum, node) => {
    const bounds = getNodeBounds(node);
    return sum + (direction === "horizontal" ? bounds.width : bounds.height);
  }, 0);
  const gap = (span - totalSize) / Math.max(sorted.length - 1, 1);
  let cursor = direction === "horizontal" ? firstBounds.x : firstBounds.y;
  return sorted.map((node) => {
    const nodeBounds = getNodeBounds(node);
    const operation = updateNodeOperation(
      node.id,
      direction === "horizontal" ? { x: cursor } : { y: cursor },
      pageId,
    );
    cursor +=
      (direction === "horizontal" ? nodeBounds.width : nodeBounds.height) + gap;
    return operation;
  });
}

function updateNodeOperation(
  nodeId: string,
  updates: Partial<PenNode> & { x?: number; y?: number },
  pageId: string | undefined,
): CanvasOperation {
  return {
    type: "updateNode",
    activePageId: pageId,
    nodeId,
    updates,
  };
}

function assertSharedParent(
  doc: PenDocument,
  targets: PenNode[],
  pageId: string | undefined,
) {
  const parentIds = new Set(
    targets.map((node) => findParent(doc, node.id, pageId)?.id ?? "__root__"),
  );
  if (parentIds.size <= 1) return;
  throw new Error(
    "layout_canvas can only move nodes that share one parent coordinate space.",
  );
}

function requireTarget(targets: PenNode[], nodeId: string) {
  const target = targets.find((node) => node.id === nodeId);
  if (!target) throw new Error(`layout_canvas target ${nodeId} is missing.`);
  return target;
}

function getUpdatedBounds(
  node: PenNode,
  updates: Partial<PenNode> & { x?: number; y?: number },
) {
  return { ...getNodeBounds(node), ...updates };
}

function expandPadding(padding: LayoutCanvasPadding) {
  if (typeof padding === "number") {
    return [padding, padding, padding, padding] as const;
  }
  if (padding.length === 2) {
    return [padding[0], padding[1], padding[0], padding[1]] as const;
  }
  return padding;
}

function isContainerNode(
  node: PenNode | undefined,
): node is PenNode & { children: PenNode[] } {
  return (
    Boolean(node) &&
    (node?.type === "frame" || node?.type === "group") &&
    "children" in node &&
    Array.isArray(node.children)
  );
}
