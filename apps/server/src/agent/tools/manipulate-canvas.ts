import {
  type CanvasBounds,
  CanvasOperationError,
  type ContainerRole,
  type PenDocument,
  type PenFill,
  type PenNode,
  type PenPathAnchor,
  applyCanvasOperation,
  assertAgentCanWrite,
  cloneDocument,
  createNodeId,
  findNode,
  findParent,
  flattenNodes,
  getNodeBounds,
  groupNodesInDoc,
  isContainerNode,
  ungroupNodeInDoc,
} from "@cucumber/canvas-core";
import { type BooleanOpType, executeBooleanOp } from "@cucumber/pen-core";
import { anchorsToPathData } from "@cucumber/pen-core";
import { tool } from "langchain";
import { z } from "zod";
import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import { coerceColor, measureTextWidth } from "./canvas-element-helpers.js";

// Re-export for consumers that import measureTextWidth from this module
export { measureTextWidth } from "./canvas-element-helpers.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const labelSchema = z
  .object({
    text: z.string().min(1).describe("Label text centered inside the shape"),
    fontSize: z.number().default(20).describe("Label font size"),
    strokeColor: z.string().default("#000000").describe("Label text color hex"),
  })
  .optional()
  .describe("Optional centered text label inside the shape");

const operationSchema = z.object({
  action: z
    .enum([
      "move",
      "resize",
      "delete",
      "update_style",
      "add_container",
      "add_text",
      "add_shape",
      "add_line",
      "add_path",
      "reorder",
      "align",
      "distribute",
      "update_text",
      "group",
      "ungroup",
      "duplicate",
      "rotate",
      "edit_path",
      "boolean_ops",
      "gradient_fill",
      "effects",
      "auto_layout",
      "lock",
      "unlock",
      "flip",
    ])
    .describe("The operation to perform"),

  element_id: z.string().optional().describe("ID of element to operate on"),
  container_id: z
    .string()
    .optional()
    .describe(
      "Optional target container ID for new Cucumber canvas operations. Useful when multiple agent-bound containers exist.",
    ),

  x: z.number().optional().describe("X coordinate"),
  y: z.number().optional().describe("Y coordinate"),
  width: z.number().optional().describe("Width"),
  height: z.number().optional().describe("Height"),

  strokeColor: z
    .string()
    .optional()
    .describe("Stroke/text color hex, e.g. #FF0000"),
  backgroundColor: z.string().optional().describe("Fill color hex"),
  opacity: z.number().optional().describe("Opacity 0-100"),
  fontSize: z.number().optional().describe("Font size"),
  strokeWidth: z.number().optional().describe("Stroke width"),
  fillStyle: z
    .enum(["solid", "hachure", "cross-hatch"])
    .optional()
    .describe("Fill style"),

  text: z.string().optional().describe("Text content (add_text / update_text)"),
  title: z.string().optional().describe("Container or node title"),

  shape: z
    .enum(["rectangle", "ellipse", "diamond"])
    .optional()
    .describe("Shape type (add_shape)"),
  label: labelSchema,

  line_type: z
    .enum(["line", "arrow"])
    .optional()
    .describe("Line or arrow (add_line)"),
  points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .optional()
    .describe("Array of {x,y} points (add_line, optional when using bindings)"),
  start_element_id: z
    .string()
    .optional()
    .describe("Bind arrow start to this element ID"),
  end_element_id: z
    .string()
    .optional()
    .describe("Bind arrow end to this element ID"),

  position: z
    .enum(["front", "back"])
    .optional()
    .describe("Bring to front or send to back (reorder)"),

  element_ids: z
    .array(z.string())
    .optional()
    .describe("IDs of elements (align/distribute)"),
  alignment: z
    .enum(["left", "right", "center", "top", "bottom", "middle"])
    .optional()
    .describe("Alignment direction (align)"),
  direction: z
    .enum(["horizontal", "vertical"])
    .optional()
    .describe("Distribution direction (distribute)"),

  // -- new actions (group/ungroup/duplicate/rotate/path/boolean/gradient/effects/layout) --
  node_ids: z
    .array(z.string())
    .optional()
    .describe("IDs for group/ungroup/duplicate"),
  angle: z.number().optional().describe("Rotation angle in degrees (rotate)"),
  path_d: z.string().optional().describe("SVG path data string (add_path)"),
  anchors: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        handleIn: z.object({ x: z.number(), y: z.number() }).optional(),
        handleOut: z.object({ x: z.number(), y: z.number() }).optional(),
        pointType: z.enum(["corner", "mirrored", "independent"]).optional(),
      }),
    )
    .optional()
    .describe("Path anchor points (add_path / edit_path)"),
  closed: z
    .boolean()
    .optional()
    .describe("Whether the path is closed (add_path)"),

  source_id: z.string().optional().describe("Source element ID (boolean_ops)"),
  boolean_operation: z
    .enum(["union", "subtract", "intersect"])
    .optional()
    .describe("Boolean operation type"),

  gradient_type: z
    .enum(["linear_gradient", "radial_gradient"])
    .optional()
    .describe("Gradient type (gradient_fill)"),
  gradient_angle: z
    .number()
    .optional()
    .describe("Gradient angle in degrees (gradient_fill, linear only)"),
  stops: z
    .array(z.object({ offset: z.number(), color: z.string() }))
    .optional()
    .describe("Gradient color stops (gradient_fill)"),

  shadow: z
    .object({
      offsetX: z.number().default(0),
      offsetY: z.number().default(4),
      blur: z.number().default(8),
      spread: z.number().default(0),
      color: z.string().default("#00000040"),
      inner: z.boolean().default(false),
    })
    .nullable()
    .optional()
    .describe("Shadow effect config, or null to remove (effects)"),
  blur: z
    .number()
    .nullable()
    .optional()
    .describe("Blur radius, or null to remove (effects)"),

  layout_direction: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe("Auto layout direction"),
  gap: z.number().optional().describe("Auto layout gap between children"),
  padding: z
    .union([z.number(), z.array(z.number())])
    .optional()
    .describe("Auto layout padding"),
  justifyContent: z
    .enum(["start", "center", "end", "space_between"])
    .optional()
    .describe("Auto layout main-axis alignment"),
  alignItems: z
    .enum(["start", "center", "end"])
    .optional()
    .describe("Auto layout cross-axis alignment"),
  sizing_width: z
    .union([z.number(), z.enum(["fit_content", "fill_container"])])
    .optional()
    .describe("Auto layout width sizing"),
  sizing_height: z
    .union([z.number(), z.enum(["fit_content", "fill_container"])])
    .optional()
    .describe("Auto layout height sizing"),

  flip_horizontal: z.boolean().optional().describe("Flip horizontally"),
  flip_vertical: z.boolean().optional().describe("Flip vertically"),

  offset_x: z.number().optional().describe("X offset for duplicated nodes"),
  offset_y: z.number().optional().describe("Y offset for duplicated nodes"),
});

const manipulateCanvasSchema = z.object({
  operations: z
    .array(operationSchema)
    .min(1)
    .describe("List of operations to apply"),
});

type Operation = z.infer<typeof operationSchema>;

type ToolRuntimeConfig = {
  configurable?: {
    access_token?: unknown;
    agent_id?: unknown;
    canvas_id?: unknown;
    user_id?: unknown;
  };
};

function getConfiguredAgentId(
  config: ToolRuntimeConfig | undefined,
): string | undefined {
  const configurable = config?.configurable;
  if (typeof configurable?.agent_id === "string") {
    return configurable.agent_id;
  }
  if (typeof configurable?.user_id === "string") {
    return configurable.user_id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers — PenDocument tree model
// ---------------------------------------------------------------------------

function inferWritableContainerId(
  doc: PenDocument,
  op: Operation,
): string | null {
  const referencedIds = [
    op.container_id,
    op.element_id,
    ...(op.element_ids ?? []),
    op.start_element_id,
    op.end_element_id,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const id of referencedIds) {
    const node = findNode(doc, id);
    if (!node) continue;
    if (isContainerNode(node)) {
      return node.id;
    }
    const parentId = findParent(doc, (node as PenNode).id)?.id;
    if (parentId) {
      return parentId;
    }
  }

  const allNodes = flattenNodes(doc);
  const boundWritableContainers = allNodes.filter(
    (node): boolean =>
      isContainerNode(node) &&
      Boolean(node.agentBinding?.permissions?.includes("write")),
  );
  if (boundWritableContainers.length === 1) {
    return boundWritableContainers[0]?.id ?? null;
  }

  const openContainers = allNodes.filter(
    (node): boolean =>
      isContainerNode(node) && node.permissions?.isolationLevel === "open",
  );
  if (openContainers.length === 1) {
    return openContainers[0]?.id ?? null;
  }

  return null;
}

function ensureContainer(
  doc: PenDocument,
  containerId: string | null,
): PenNode {
  if (!containerId) {
    throw new CanvasOperationError(
      "permission_denied",
      "No writable container could be resolved for this operation. Bind the agent to a container or pass container_id explicitly.",
    );
  }
  const container = findNode(doc, containerId);
  if (!isContainerNode(container)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${containerId} does not exist.`,
    );
  }
  return container!;
}

function defaultNodeBounds(
  doc: PenDocument,
  type: string,
  containerId: string | null,
  op: Operation,
): CanvasBounds {
  const container = containerId ? ensureContainer(doc, containerId) : null;
  const containerBounds = container ? getNodeBounds(container) : null;
  const baseX = op.x ?? (containerBounds ? containerBounds.x + 24 : 120);
  const baseY = op.y ?? (containerBounds ? containerBounds.y + 32 : 120);

  switch (type) {
    case "text": {
      const fontSize = op.fontSize ?? 28;
      const lines = (op.text ?? "").split("\n").filter(Boolean);
      const measuredWidth =
        lines.length > 0
          ? Math.max(...lines.map((line) => measureTextWidth(line, fontSize)))
          : 120;
      return {
        x: baseX,
        y: baseY,
        width: Math.max(op.width ?? 0, Math.ceil(measuredWidth + fontSize)),
        height: Math.max(
          op.height ?? 0,
          Math.ceil(Math.max(lines.length, 1) * fontSize * 1.4 + fontSize),
        ),
      };
    }
    case "image":
      return {
        x: baseX,
        y: baseY,
        width: Math.max(op.width ?? 0, 320),
        height: Math.max(op.height ?? 0, 220),
      };
    case "videoEmbed":
      return {
        x: baseX,
        y: baseY,
        width: Math.max(op.width ?? 0, 360),
        height: Math.max(op.height ?? 0, 220),
      };
    default:
      return {
        x: baseX,
        y: baseY,
        width: Math.max(op.width ?? 0, 160),
        height: Math.max(op.height ?? 0, 96),
      };
  }
}

// ---------------------------------------------------------------------------
// Operation helpers
// ---------------------------------------------------------------------------

function applyCucumberUpdate(
  doc: PenDocument,
  nodeId: string,
  updates: Partial<PenNode>,
  agentId: string | undefined,
  parentId?: string | null,
): PenDocument {
  return applyCanvasOperation(doc, {
    type: "updateNode",
    nodeId,
    updates,
    ...(agentId ? { agentId } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  });
}

function applyCucumberDelete(
  doc: PenDocument,
  nodeId: string,
  agentId: string | undefined,
  parentId?: string | null,
): PenDocument {
  return applyCanvasOperation(doc, {
    type: "deleteNode",
    nodeId,
    ...(agentId ? { agentId } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  });
}

function applyCucumberInsert(
  doc: PenDocument,
  node: PenNode,
  agentId: string | undefined,
  containerId?: string | null,
): PenDocument {
  return applyCanvasOperation(doc, {
    type: "insertNode",
    node,
    ...(containerId !== undefined ? { parentId: containerId } : {}),
    ...(agentId ? { agentId } : {}),
  });
}

function reorderCucumberNode(
  doc: PenDocument,
  nodeId: string,
  position: "front" | "back",
  agentId: string | undefined,
): PenDocument {
  const node = findNode(doc, nodeId);
  if (!node) {
    throw new CanvasOperationError(
      "node_not_found",
      `Node ${nodeId} does not exist.`,
    );
  }

  const parent = findParent(doc, nodeId);
  const parentId = parent?.id ?? null;
  assertAgentCanWrite(doc, agentId, parentId);

  // In tree model: "front" = last child (rendered on top), "back" = first child
  const siblings =
    parent && "children" in parent && Array.isArray(parent.children)
      ? [...(parent.children as PenNode[])]
      : [
          ...flattenNodes(doc).filter(
            (n) => findParent(doc, n.id)?.id === parentId,
          ),
        ];

  // Actually, for root-level nodes, use getActiveChildren
  let childrenList: PenNode[];
  if (parent && "children" in parent && Array.isArray(parent.children)) {
    childrenList = parent.children as PenNode[];
  } else {
    // Root level — use moveNode operation
    const allRoot = flattenNodes(doc).filter((n) => !findParent(doc, n.id));
    childrenList = allRoot;
  }

  const currentIndex = childrenList.findIndex((c) => c.id === nodeId);
  if (currentIndex < 0) return doc;

  const reordered = childrenList.filter((c) => c.id !== nodeId);
  if (position === "front") {
    reordered.push(node);
  } else {
    reordered.unshift(node);
  }

  // Update parent's children
  if (parent && "children" in parent) {
    return applyCanvasOperation(doc, {
      type: "updateNode",
      nodeId: parent.id,
      updates: { children: reordered } as Partial<PenNode>,
      ...(agentId ? { agentId } : {}),
    });
  }

  // Root level — remove and re-insert all at root
  let next = cloneDocument(doc);
  for (const child of childrenList) {
    next = applyCanvasOperation(next, { type: "deleteNode", nodeId: child.id });
  }
  for (const child of reordered) {
    next = applyCanvasOperation(next, {
      type: "insertNode",
      node: child,
      parentId: null,
    });
  }
  return next;
}

function resolveCreatedIdRef(
  value: string | undefined,
  createdIds: Record<string, string>,
): string | undefined {
  if (!value) return value;
  return createdIds[value] ?? value;
}

function resolveOperationRefs(
  op: Operation,
  createdIds: Record<string, string>,
): Operation {
  return {
    ...op,
    container_id: resolveCreatedIdRef(op.container_id, createdIds),
    element_id: resolveCreatedIdRef(op.element_id, createdIds),
    end_element_id: resolveCreatedIdRef(op.end_element_id, createdIds),
    start_element_id: resolveCreatedIdRef(op.start_element_id, createdIds),
    ...(op.element_ids
      ? { element_ids: op.element_ids.map((id) => createdIds[id] ?? id) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Main operation dispatcher
// ---------------------------------------------------------------------------

function manipulateCucumberCanvas(args: {
  doc: PenDocument;
  operations: Operation[];
  agentId?: string;
}): {
  createdIds: Record<string, string>;
  descriptions: string[];
  errors: string[];
  nextDoc: PenDocument;
} {
  let nextDoc = args.doc;
  const descriptions: string[] = [];
  const errors: string[] = [];
  const createdIds: Record<string, string> = {};

  for (let i = 0; i < args.operations.length; i++) {
    const op = resolveOperationRefs(args.operations[i]!, createdIds);
    try {
      const inferredContainerId = inferWritableContainerId(nextDoc, op);

      switch (op.action) {
        case "add_container": {
          const nodeId = createNodeId("container");
          const bounds = defaultNodeBounds(nextDoc, "frame", null, {
            ...op,
            width: op.width ?? 520,
            height: op.height ?? 360,
          });
          const container = {
            id: nodeId,
            type: "frame" as const,
            name: op.title ?? op.text ?? "Agent output",
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            containerRole: ["visual", "task", "context"] as ContainerRole[],
            children: [] as PenNode[],
            contextSlots: {},
            inheritPolicy: "merge" as const,
            permissions: {
              canRead: [],
              canWrite: [],
              isolationLevel: "open" as const,
            },
            fill: coerceColor(op.backgroundColor, "#ffffff")
              ? [
                  {
                    type: "solid" as const,
                    color: coerceColor(op.backgroundColor, "#ffffff"),
                  },
                ]
              : undefined,
            stroke: coerceColor(op.strokeColor, "#6c5ce7")
              ? {
                  thickness: 1,
                  align: "center" as const,
                  fill: [
                    {
                      type: "solid" as const,
                      color: coerceColor(op.strokeColor, "#6c5ce7"),
                    },
                  ],
                }
              : undefined,
            opacity:
              op.opacity !== undefined
                ? Math.max(0, Math.min(100, op.opacity)) / 100
                : 1,
          } satisfies PenNode;

          nextDoc = applyCanvasOperation(nextDoc, {
            type: "insertNode",
            node: container,
          });
          descriptions.push(
            `added container '${container.name}' [id=${nodeId}]`,
          );
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "move": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "move requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          const nodeBounds = getNodeBounds(node);
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              x: op.x ?? nodeBounds.x,
              y: op.y ?? nodeBounds.y,
            } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(
            `moved ${node.type} ${node.id} to (${op.x ?? nodeBounds.x}, ${op.y ?? nodeBounds.y})`,
          );
          break;
        }
        case "resize": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "resize requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          const nodeBounds = getNodeBounds(node);
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              width: op.width ?? nodeBounds.width,
              height: op.height ?? nodeBounds.height,
            } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(
            `resized ${node.type} ${node.id} to ${op.width ?? nodeBounds.width}x${op.height ?? nodeBounds.height}`,
          );
          break;
        }
        case "delete": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "delete requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberDelete(
            nextDoc,
            node.id,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`deleted ${node.type} ${node.id}`);
          break;
        }
        case "update_style": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "update_style requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }

          let updates: Partial<PenNode> | null = null;
          const nodeType = (node as PenNode).type;
          if (
            nodeType === "rectangle" ||
            nodeType === "ellipse" ||
            nodeType === "polygon"
          ) {
            const existingStroke = (node as any).stroke as
              | {
                  thickness?: number;
                  fill?: Array<{ type: string; color: string }>;
                }
              | undefined;
            const newThickness =
              op.strokeWidth ?? existingStroke?.thickness ?? 1;
            const newStrokeColor =
              op.strokeColor ?? existingStroke?.fill?.[0]?.color ?? "#111827";
            updates = {
              ...(op.backgroundColor !== undefined
                ? {
                    fill: [
                      {
                        type: "solid" as const,
                        color: coerceColor(op.backgroundColor, "#d3f256"),
                      },
                    ],
                  }
                : {}),
              ...(op.strokeColor !== undefined || op.strokeWidth !== undefined
                ? {
                    stroke: {
                      thickness: newThickness,
                      align: "center" as const,
                      fill: [
                        {
                          type: "solid" as const,
                          color: coerceColor(newStrokeColor, "#111827"),
                        },
                      ],
                    },
                  }
                : {}),
            } as Partial<PenNode>;
          } else if (isContainerNode(node)) {
            const existingStroke = (node as any).stroke as
              | {
                  thickness?: number;
                  fill?: Array<{ type: string; color: string }>;
                }
              | undefined;
            const hasStrokeUpdate =
              op.strokeColor !== undefined || op.strokeWidth !== undefined;
            updates = {
              ...(op.backgroundColor !== undefined
                ? {
                    fill: [
                      {
                        type: "solid" as const,
                        color: coerceColor(op.backgroundColor, "#ffffff"),
                      },
                    ],
                  }
                : {}),
              ...(hasStrokeUpdate
                ? {
                    stroke: {
                      thickness:
                        op.strokeWidth ?? existingStroke?.thickness ?? 1,
                      align: "center" as const,
                      fill: [
                        {
                          type: "solid" as const,
                          color: coerceColor(
                            op.strokeColor ??
                              existingStroke?.fill?.[0]?.color ??
                              "#6c5ce7",
                            "#6c5ce7",
                          ),
                        },
                      ],
                    },
                  }
                : {}),
              ...(op.opacity !== undefined
                ? { opacity: Math.max(0, Math.min(100, op.opacity)) / 100 }
                : {}),
            } as Partial<PenNode>;
          } else if (nodeType === "text") {
            updates = {
              ...(op.strokeColor !== undefined
                ? {
                    fill: [
                      {
                        type: "solid" as const,
                        color: coerceColor(op.strokeColor, "#111827"),
                      },
                    ],
                  }
                : {}),
              ...(op.fontSize !== undefined ? { fontSize: op.fontSize } : {}),
            } as Partial<PenNode>;
          }

          if (!updates || Object.keys(updates).length === 0) {
            errors.push(
              `[skip] update_style is not supported for node ${node.id} (${node.type})`,
            );
            continue;
          }

          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            updates,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`updated ${node.type} ${node.id} style`);
          break;
        }
        case "add_text": {
          if (!op.text) {
            throw new CanvasOperationError(
              "invalid_operation",
              "add_text requires text",
            );
          }
          const container = ensureContainer(nextDoc, inferredContainerId);
          const nodeId = createNodeId("text");
          const bounds = defaultNodeBounds(nextDoc, "text", container.id, op);
          const node = {
            id: nodeId,
            type: "text" as const,
            name: op.text.length > 32 ? `${op.text.slice(0, 29)}...` : op.text,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            content: op.text,
            fontSize: op.fontSize ?? 28,
            fill: [
              {
                type: "solid" as const,
                color: coerceColor(op.strokeColor, "#111827"),
              },
            ],
          } satisfies PenNode;

          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container.id,
          );
          descriptions.push(
            `added text '${node.name}' in container ${container.id} [id=${nodeId}]`,
          );
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "add_shape": {
          const shape = op.shape ?? "rectangle";
          if (shape !== "rectangle" && shape !== "ellipse") {
            errors.push(
              "[skip] add_shape supports rectangle and ellipse on the current canvas runtime",
            );
            continue;
          }
          const container = ensureContainer(nextDoc, inferredContainerId);
          const nodeId = createNodeId("shape");
          const name =
            op.label?.text ??
            (op.text?.trim() ||
              `${shape.charAt(0).toUpperCase() + shape.slice(1)} ${Object.keys(createdIds).length + 1}`);
          const bounds = defaultNodeBounds(nextDoc, shape, container.id, op);
          const node = {
            id: nodeId,
            type: shape as "rectangle" | "ellipse",
            name,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            fill: [
              {
                type: "solid" as const,
                color: coerceColor(op.backgroundColor, "#d3f256"),
              },
            ],
            stroke: {
              thickness: op.strokeWidth ?? 1,
              align: "center" as const,
              fill: [
                {
                  type: "solid" as const,
                  color: coerceColor(op.strokeColor, "#111827"),
                },
              ],
            },
            cornerRadius: shape === "rectangle" ? 12 : undefined,
          } satisfies PenNode;

          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container.id,
          );

          // Create visible text label as child if provided
          if (op.label?.text) {
            const labelId = createNodeId("text");
            const labelFontSize = op.label.fontSize ?? 20;
            const labelNode = {
              id: labelId,
              type: "text" as const,
              name: op.label.text,
              x:
                bounds.x +
                bounds.width / 2 -
                measureTextWidth(op.label.text, labelFontSize) / 2,
              y: bounds.y + bounds.height / 2 - labelFontSize * 0.6,
              width: measureTextWidth(op.label.text, labelFontSize) + 8,
              height: labelFontSize * 1.4,
              content: op.label.text,
              fontSize: labelFontSize,
              fill: [
                {
                  type: "solid" as const,
                  color: coerceColor(op.label.strokeColor, "#000000"),
                },
              ],
              textAlign: "center" as const,
            } satisfies PenNode;
            nextDoc = applyCucumberInsert(
              nextDoc,
              labelNode,
              args.agentId,
              container.id,
            );
            descriptions.push(
              `added ${shape} '${name}' with label '${op.label.text}' in container ${container.id} [id=${nodeId}, label=${labelId}]`,
            );
            createdIds[`op_${i}`] = nodeId;
            break;
          }

          descriptions.push(
            `added ${shape} '${name}' in container ${container.id} [id=${nodeId}]`,
          );
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "update_text": {
          if (!op.element_id || !op.text) {
            throw new CanvasOperationError(
              "invalid_operation",
              "update_text requires element_id and text",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          if (node.type === "text") {
            const fontSize =
              op.fontSize ??
              ((node as any).fontSize as number | undefined) ??
              28;
            const lines = op.text.split("\n");
            const measuredWidth = Math.max(
              ...lines.map((line) => measureTextWidth(line, fontSize)),
              1,
            );
            const nodeBounds = getNodeBounds(node);
            nextDoc = applyCucumberUpdate(
              nextDoc,
              node.id,
              {
                content: op.text,
                name:
                  op.text.length > 32 ? `${op.text.slice(0, 29)}...` : op.text,
                fontSize,
                width: Math.max(
                  nodeBounds.width,
                  Math.ceil(measuredWidth + fontSize),
                ),
                height: Math.max(
                  nodeBounds.height,
                  Math.ceil(lines.length * fontSize * 1.4 + fontSize),
                ),
              } as Partial<PenNode>,
              args.agentId,
              inferredContainerId ?? findParent(nextDoc, node.id)?.id,
            );
            descriptions.push(`updated text on ${node.id}`);
            break;
          }

          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              name:
                op.text.length > 64 ? `${op.text.slice(0, 61)}...` : op.text,
            } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`updated title on ${node.id}`);
          break;
        }
        case "align": {
          const targets = (op.element_ids ?? [])
            .map((id) => findNode(nextDoc, id))
            .filter((n): n is PenNode => Boolean(n));
          if (targets.length < 2) {
            errors.push(
              `[skip] need >= 2 valid nodes to align, found ${targets.length}`,
            );
            continue;
          }

          const updates = new Map<string, Partial<PenNode>>();
          switch (op.alignment) {
            case "left": {
              const minX = Math.min(...targets.map((n) => getNodeBounds(n).x));
              for (const n of targets) {
                updates.set(n.id, { x: minX } as Partial<PenNode>);
              }
              break;
            }
            case "right": {
              const maxRight = Math.max(
                ...targets.map((n) => {
                  const b = getNodeBounds(n);
                  return b.x + b.width;
                }),
              );
              for (const n of targets) {
                updates.set(n.id, {
                  x: maxRight - getNodeBounds(n).width,
                } as Partial<PenNode>);
              }
              break;
            }
            case "center": {
              const averageCenter =
                targets.reduce((sum, n) => {
                  const b = getNodeBounds(n);
                  return sum + b.x + b.width / 2;
                }, 0) / targets.length;
              for (const n of targets) {
                updates.set(n.id, {
                  x: averageCenter - getNodeBounds(n).width / 2,
                } as Partial<PenNode>);
              }
              break;
            }
            case "top": {
              const minY = Math.min(...targets.map((n) => getNodeBounds(n).y));
              for (const n of targets) {
                updates.set(n.id, { y: minY } as Partial<PenNode>);
              }
              break;
            }
            case "bottom": {
              const maxBottom = Math.max(
                ...targets.map((n) => {
                  const b = getNodeBounds(n);
                  return b.y + b.height;
                }),
              );
              for (const n of targets) {
                updates.set(n.id, {
                  y: maxBottom - getNodeBounds(n).height,
                } as Partial<PenNode>);
              }
              break;
            }
            case "middle": {
              const averageMiddle =
                targets.reduce((sum, n) => {
                  const b = getNodeBounds(n);
                  return sum + b.y + b.height / 2;
                }, 0) / targets.length;
              for (const n of targets) {
                updates.set(n.id, {
                  y: averageMiddle - getNodeBounds(n).height / 2,
                } as Partial<PenNode>);
              }
              break;
            }
            default: {
              errors.push(`[skip] unsupported alignment ${op.alignment}`);
              continue;
            }
          }

          for (const n of targets) {
            const nextUpdate = updates.get(n.id);
            if (!nextUpdate) continue;
            nextDoc = applyCucumberUpdate(
              nextDoc,
              n.id,
              nextUpdate,
              args.agentId,
              findParent(nextDoc, n.id)?.id,
            );
          }
          descriptions.push(`aligned ${targets.length} nodes ${op.alignment}`);
          break;
        }
        case "distribute": {
          const targets = (op.element_ids ?? [])
            .map((id) => findNode(nextDoc, id))
            .filter((n): n is PenNode => Boolean(n));
          if (targets.length < 3) {
            errors.push(
              `[skip] need >= 3 valid nodes to distribute, found ${targets.length}`,
            );
            continue;
          }

          if (op.direction === "horizontal") {
            const sorted = [...targets].sort(
              (a, b) => getNodeBounds(a).x - getNodeBounds(b).x,
            );
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const firstBounds = getNodeBounds(first);
            const lastBounds = getNodeBounds(last);
            const totalSpan = lastBounds.x + lastBounds.width - firstBounds.x;
            const totalWidth = sorted.reduce(
              (sum, n) => sum + getNodeBounds(n).width,
              0,
            );
            const gap = (totalSpan - totalWidth) / (sorted.length - 1);
            let cursor = firstBounds.x;
            for (const n of sorted) {
              nextDoc = applyCucumberUpdate(
                nextDoc,
                n.id,
                { x: cursor } as Partial<PenNode>,
                args.agentId,
                findParent(nextDoc, n.id)?.id,
              );
              cursor += getNodeBounds(n).width + gap;
            }
          } else {
            const sorted = [...targets].sort(
              (a, b) => getNodeBounds(a).y - getNodeBounds(b).y,
            );
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const firstBounds = getNodeBounds(first);
            const lastBounds = getNodeBounds(last);
            const totalSpan = lastBounds.y + lastBounds.height - firstBounds.y;
            const totalHeight = sorted.reduce(
              (sum, n) => sum + getNodeBounds(n).height,
              0,
            );
            const gap = (totalSpan - totalHeight) / (sorted.length - 1);
            let cursor = firstBounds.y;
            for (const n of sorted) {
              nextDoc = applyCucumberUpdate(
                nextDoc,
                n.id,
                { y: cursor } as Partial<PenNode>,
                args.agentId,
                findParent(nextDoc, n.id)?.id,
              );
              cursor += getNodeBounds(n).height + gap;
            }
          }
          descriptions.push(
            `distributed ${targets.length} nodes ${op.direction}ly`,
          );
          break;
        }
        case "reorder": {
          if (!op.element_id || !op.position) {
            throw new CanvasOperationError(
              "invalid_operation",
              "reorder requires element_id and position",
            );
          }
          nextDoc = reorderCucumberNode(
            nextDoc,
            op.element_id,
            op.position,
            args.agentId,
          );
          descriptions.push(`reordered ${op.element_id} to ${op.position}`);
          break;
        }
        case "add_line": {
          const container = inferredContainerId
            ? ensureContainer(nextDoc, inferredContainerId)
            : null;
          const containerBounds = container
            ? getNodeBounds(container)
            : { x: 0, y: 0, width: 800, height: 600 };
          const nodeId = createNodeId("line");

          let x1: number;
          let y1: number;
          let x2: number;
          let y2: number;

          if (op.points && op.points.length >= 2) {
            const [startPoint, endPoint] = op.points;
            if (!startPoint || !endPoint) {
              errors.push("[skip] add_line requires two points");
              continue;
            }
            x1 = startPoint.x;
            y1 = startPoint.y;
            x2 = endPoint.x;
            y2 = endPoint.y;
          } else if (op.start_element_id && op.end_element_id) {
            const startNode = findNode(nextDoc, op.start_element_id);
            const endNode = findNode(nextDoc, op.end_element_id);
            if (!startNode || !endNode) {
              errors.push("[skip] add_line start or end element not found");
              continue;
            }
            const startBounds = getNodeBounds(startNode);
            const endBounds = getNodeBounds(endNode);
            x1 = startBounds.x + startBounds.width / 2;
            y1 = startBounds.y + startBounds.height / 2;
            x2 = endBounds.x + endBounds.width / 2;
            y2 = endBounds.y + endBounds.height / 2;
          } else {
            // Default: horizontal line in container
            x1 = op.x ?? containerBounds.x + 24;
            y1 =
              op.y ??
              containerBounds.y + (container ? containerBounds.height / 2 : 60);
            x2 = x1 + (op.width ?? 160);
            y2 = y1;
          }

          const isArrow = op.line_type === "arrow";
          const strokeColor = coerceColor(op.strokeColor, "#111827");
          const node = {
            id: nodeId,
            type: "line" as const,
            name: isArrow ? "Arrow" : "Line",
            x: x1,
            y: y1,
            x2,
            y2,
            stroke: {
              thickness: op.strokeWidth ?? 2,
              align: "center" as const,
              fill: [{ type: "solid" as const, color: strokeColor }],
            },
          } satisfies PenNode;

          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container?.id ?? inferredContainerId ?? null,
          );
          descriptions.push(
            `added ${isArrow ? "arrow" : "line"} [id=${nodeId}] from (${x1},${y1}) to (${x2},${y2})`,
          );
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "group": {
          const ids = op.node_ids ?? (op.element_id ? [op.element_id] : []);
          if (ids.length < 2) {
            throw new CanvasOperationError(
              "invalid_operation",
              "group requires at least 2 node_ids",
            );
          }
          const groupId = createNodeId("group");
          groupNodesInDoc(nextDoc, groupId, ids, op.title);
          descriptions.push(
            `grouped ${ids.length} nodes into group [id=${groupId}]`,
          );
          createdIds[`op_${i}`] = groupId;
          break;
        }
        case "ungroup": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "ungroup requires element_id",
            );
          }
          ungroupNodeInDoc(nextDoc, op.element_id);
          descriptions.push(`ungrouped ${op.element_id}`);
          break;
        }
        case "duplicate": {
          const ids = op.node_ids ?? (op.element_id ? [op.element_id] : []);
          if (ids.length === 0) {
            throw new CanvasOperationError(
              "invalid_operation",
              "duplicate requires node_ids or element_id",
            );
          }
          const dx = op.offset_x ?? 40;
          const dy = op.offset_y ?? 40;
          for (const srcId of ids) {
            const src = findNode(nextDoc, srcId);
            if (!src) {
              errors.push(`[skip] duplicate source ${srcId} not found`);
              continue;
            }
            const newId = createNodeId(src.type);
            const cloned = JSON.parse(JSON.stringify(src)) as PenNode;
            cloned.id = newId;
            cloned.name = `${cloned.name ?? ""} (copy)`;
            cloned.x = (cloned.x ?? 0) + dx;
            cloned.y = (cloned.y ?? 0) + dy;
            // Clear agent binding on clone
            if ("agentBinding" in cloned)
              (cloned as any).agentBinding = undefined;
            const parentId = findParent(nextDoc, srcId)?.id ?? null;
            nextDoc = applyCanvasOperation(nextDoc, {
              type: "insertNode",
              node: cloned,
              parentId,
            });
            createdIds[`op_${i}`] = newId;
          }
          descriptions.push(`duplicated ${ids.length} node(s)`);
          break;
        }
        case "rotate": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "rotate requires element_id",
            );
          }
          if (op.angle === undefined) {
            throw new CanvasOperationError(
              "invalid_operation",
              "rotate requires angle",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            { rotation: op.angle } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`rotated ${node.id} to ${op.angle}deg`);
          break;
        }
        case "add_path": {
          const container = inferredContainerId
            ? ensureContainer(nextDoc, inferredContainerId)
            : null;
          const nodeId = createNodeId("path");
          const d =
            op.path_d ??
            (op.anchors
              ? anchorsToPathData(op.anchors as any, op.closed ?? true)
              : "");
          if (!d) {
            throw new CanvasOperationError(
              "invalid_operation",
              "add_path requires path_d or anchors",
            );
          }
          const containerBounds = container
            ? getNodeBounds(container)
            : { x: 0, y: 0, width: 800, height: 600 };
          const node = {
            id: nodeId,
            type: "path" as const,
            name: op.title ?? "Path",
            x: op.x ?? containerBounds.x + 24,
            y: op.y ?? containerBounds.y + 32,
            width: op.width ?? 200,
            height: op.height ?? 120,
            d,
            closed: op.closed ?? true,
            fill: coerceColor(op.backgroundColor, "#d3f256")
              ? [
                  {
                    type: "solid" as const,
                    color: coerceColor(op.backgroundColor, "#d3f256"),
                  },
                ]
              : undefined,
            stroke: {
              thickness: op.strokeWidth ?? 1,
              align: "center" as const,
              fill: [
                {
                  type: "solid" as const,
                  color: coerceColor(op.strokeColor, "#111827"),
                },
              ],
            },
          } satisfies PenNode;
          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container?.id ?? inferredContainerId ?? null,
          );
          descriptions.push(`added path [id=${nodeId}]`);
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "edit_path": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "edit_path requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node || node.type !== "path") {
            errors.push(`[skip] node ${op.element_id} not found or not a path`);
            continue;
          }
          let updates: Partial<PenNode> = {};
          if (op.anchors) {
            const newD = anchorsToPathData(
              op.anchors as any,
              (node as any).closed ?? op.closed ?? true,
            );
            updates = { ...updates, d: newD } as Partial<PenNode>;
          }
          if (op.closed !== undefined) {
            updates = { ...updates, closed: op.closed } as Partial<PenNode>;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            updates,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`edited path ${node.id}`);
          break;
        }
        case "boolean_ops": {
          const targetId = op.element_id;
          const sourceId = op.source_id;
          if (!targetId || !sourceId) {
            throw new CanvasOperationError(
              "invalid_operation",
              "boolean_ops requires element_id and source_id",
            );
          }
          const opType = op.boolean_operation ?? "union";
          const target = findNode(nextDoc, targetId);
          const source = findNode(nextDoc, sourceId);
          if (!target || !source) {
            errors.push("[skip] boolean_ops: one or both nodes not found");
            continue;
          }
          const result = executeBooleanOp(
            [target, source],
            opType as BooleanOpType,
          );
          if (!result) {
            errors.push(
              "[skip] boolean_ops failed — the shapes may not be compatible",
            );
            continue;
          }
          const parentId = findParent(nextDoc, targetId)?.id ?? null;
          // Remove source and target, insert result
          nextDoc = applyCanvasOperation(nextDoc, {
            type: "deleteNode",
            nodeId: targetId,
          });
          nextDoc = applyCanvasOperation(nextDoc, {
            type: "deleteNode",
            nodeId: sourceId,
          });
          nextDoc = applyCanvasOperation(nextDoc, {
            type: "insertNode",
            node: result,
            parentId,
          });
          descriptions.push(
            `boolean ${opType} on ${targetId} + ${sourceId} → [id=${result.id}]`,
          );
          createdIds[`op_${i}`] = result.id;
          break;
        }
        case "gradient_fill": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "gradient_fill requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          const type = op.gradient_type ?? "linear_gradient";
          const stops = (
            op.stops ?? [
              { offset: 0, color: "#d3f256" },
              { offset: 1, color: "#6c5ce7" },
            ]
          ).map((s) => ({
            offset: Math.max(0, Math.min(1, s.offset)),
            color: s.color,
          }));
          const gradientFill: PenFill = {
            type,
            stops,
            ...(type === "linear_gradient"
              ? { angle: op.gradient_angle ?? 0 }
              : {}),
          };
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            { fill: [gradientFill] } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`set ${type} fill on ${node.id}`);
          break;
        }
        case "effects": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "effects requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          const effects: any[] = [];
          if (op.shadow !== undefined && op.shadow !== null) {
            effects.push({ type: "shadow", ...op.shadow });
          }
          if (op.blur !== undefined && op.blur !== null) {
            effects.push({ type: "blur", radius: op.blur });
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            { effects } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`updated effects on ${node.id}`);
          break;
        }
        case "auto_layout": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "auto_layout requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node || !isContainerNode(node)) {
            errors.push(
              `[skip] node ${op.element_id} not found or not a container`,
            );
            continue;
          }
          const layoutUpdates: Partial<PenNode> = {};
          if (op.layout_direction)
            (layoutUpdates as any).layout = op.layout_direction;
          if (op.gap !== undefined) (layoutUpdates as any).gap = op.gap;
          if (op.padding !== undefined)
            (layoutUpdates as any).padding = op.padding;
          if (op.justifyContent)
            (layoutUpdates as any).justifyContent = op.justifyContent;
          if (op.alignItems) (layoutUpdates as any).alignItems = op.alignItems;
          if (op.sizing_width !== undefined)
            (layoutUpdates as any).sizingWidth = op.sizing_width;
          if (op.sizing_height !== undefined)
            (layoutUpdates as any).sizingHeight = op.sizing_height;
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            layoutUpdates,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`set auto layout on container ${node.id}`);
          break;
        }
        case "lock": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "lock requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            { locked: true } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`locked ${node.id}`);
          break;
        }
        case "unlock": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "unlock requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            { locked: false } as Partial<PenNode>,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`unlocked ${node.id}`);
          break;
        }
        case "flip": {
          if (!op.element_id) {
            throw new CanvasOperationError(
              "invalid_operation",
              "flip requires element_id",
            );
          }
          const node = findNode(nextDoc, op.element_id);
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          const updates: Partial<PenNode> = {};
          if (op.flip_horizontal !== undefined)
            updates.flipX = op.flip_horizontal;
          if (op.flip_vertical !== undefined) updates.flipY = op.flip_vertical;
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            updates,
            args.agentId,
            inferredContainerId ?? findParent(nextDoc, node.id)?.id,
          );
          descriptions.push(`flipped ${node.id}`);
          break;
        }
        default: {
          errors.push(`[skip] unsupported action ${op.action}`);
          break;
        }
      }
    } catch (error) {
      if (error instanceof CanvasOperationError) {
        errors.push(`[error] ${op.action}: ${error.message}`);
        continue;
      }
      const message =
        error instanceof Error ? error.message : "Unknown canvas error";
      errors.push(`[error] ${op.action}: ${message}`);
    }
  }

  return { createdIds, descriptions, errors, nextDoc };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createManipulateCanvasTool(deps: {
  createUserClient: (accessToken: string) => any;
  liveCanvasService?: LiveCanvasService;
}) {
  return tool(
    async (input, config) => {
      const runtimeConfig = config as ToolRuntimeConfig | undefined;
      const canvasId = runtimeConfig?.configurable?.canvas_id;
      const accessToken = runtimeConfig?.configurable?.access_token;
      const userId = runtimeConfig?.configurable?.user_id;

      if (
        typeof canvasId !== "string" ||
        typeof accessToken !== "string" ||
        typeof userId !== "string" ||
        !canvasId ||
        !accessToken ||
        !userId
      ) {
        return JSON.stringify({
          error: "no_canvas_context",
          message:
            "This tool requires a canvas context. Ensure the conversation is linked to a canvas.",
        });
      }

      if (!deps.liveCanvasService) {
        return JSON.stringify({
          error: "live_canvas_unavailable",
          message:
            "Canvas tools require an open live editor. Open the canvas page and retry.",
        });
      }

      const user = {
        accessToken,
        email: "",
        id: userId,
        userMetadata: {},
      };

      try {
        const content = await deps.liveCanvasService.getDocument(
          user,
          canvasId,
        );
        const agentId = getConfiguredAgentId(runtimeConfig);
        const { createdIds, descriptions, errors, nextDoc } =
          manipulateCucumberCanvas({
            doc: content,
            operations: input.operations,
            ...(agentId ? { agentId } : {}),
          });

        await deps.liveCanvasService.setDocument(user, canvasId, nextDoc);

        const result: Record<string, unknown> = {
          success: true,
          applied: descriptions.length,
          summary: descriptions.join("; "),
        };
        if (Object.keys(createdIds).length > 0) {
          result.createdIds = createdIds;
        }
        if (errors.length > 0) {
          result.errors = errors;
        }
        console.info("[manipulate_canvas] live document updated", {
          applied: descriptions.length,
          canvasId,
          errors: errors.length,
          nodeCount: flattenNodes(nextDoc).length,
          userId,
        });
        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "manipulate_canvas_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update the live canvas.",
        });
      }
    },
    {
      name: "manipulate_canvas",
      description:
        "Manipulate elements on the live Cucumber canvas. Supports: add_container, move, resize, delete, update_style, update_text, add_text, add_shape, add_line, add_path, align, distribute, reorder, group, ungroup, duplicate, rotate, edit_path, boolean_ops, gradient_fill, effects, auto_layout, lock, unlock, flip. Use inspect_canvas first to understand the current layout. Returns created element IDs for subsequent binding, and same-batch operations can reference earlier IDs with op_0, op_1, etc.",
      schema: manipulateCanvasSchema,
    },
  );
}
