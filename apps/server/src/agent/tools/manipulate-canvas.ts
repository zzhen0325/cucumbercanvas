import { tool } from "langchain";
import { z } from "zod";
import {
  type CanvasBounds,
  type CanvasNode as CucumberCanvasNode,
  type ContainerNode,
  type CucumberCanvasDocument,
  CanvasOperationError,
  applyCanvasOperation,
  assertAgentCanWrite,
  cloneCanvasDocument,
  createCanvasNodeId,
  isContainerNode,
} from "@cucumber/canvas-core";
import {
  CanvasElement,
  HandlerResult,
  generateId,
  measureTextWidth,
  coerceColor,
  createElementBase,
  bumpVersion,
  findElement,
  shortLabel,
  ensureBoundElements,
  validateBindings,
  BINDING_GAP,
  getElementCenter,
  computeEdgePoint,
  computeFixedPoint,
} from "./canvas-element-helpers.js";
import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";

// Re-export for consumers that import measureTextWidth from this module
// (e.g. the test suite). New code should import directly from canvas-element-helpers.
export { measureTextWidth } from "./canvas-element-helpers.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

// Note: color coercion (number → hex string) moved to runtime handler.
// Gemini cannot represent z.preprocess/z.transform in JSON Schema.

const labelSchema = z
  .object({
    text: z.string().min(1).describe("Label text centered inside the shape"),
    fontSize: z.number().default(20).describe("Label font size"),
    strokeColor: z.string().default("#000000").describe("Label text color hex"),
  })
  .optional()
  .describe("Optional centered text label inside the shape");

// Flat object schema — Gemini doesn't support union/oneOf/anyOf in tool params.
// All fields are optional; which ones are required depends on `action`.
const operationSchema = z.object({
  action: z
    .enum([
      "move", "resize", "delete", "update_style",
      "add_container", "add_text", "add_shape", "add_line",
      "reorder", "align", "distribute", "update_text",
    ])
    .describe("The operation to perform"),

  // Common: target element ID (move, resize, delete, update_style, reorder)
  element_id: z.string().optional().describe("ID of element to operate on"),
  container_id: z
    .string()
    .optional()
    .describe(
      "Optional target container ID for new Cucumber canvas operations. Useful when multiple agent-bound containers exist.",
    ),

  // Position / size
  x: z.number().optional().describe("X coordinate"),
  y: z.number().optional().describe("Y coordinate"),
  width: z.number().optional().describe("Width"),
  height: z.number().optional().describe("Height"),

  // Style (update_style, add_shape, add_line, add_text)
  strokeColor: z.string().optional().describe("Stroke/text color hex, e.g. #FF0000"),
  backgroundColor: z.string().optional().describe("Fill color hex"),
  opacity: z.number().optional().describe("Opacity 0-100"),
  fontSize: z.number().optional().describe("Font size"),
  strokeWidth: z.number().optional().describe("Stroke width"),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch"]).optional().describe("Fill style"),

  // add_text / update_text
  text: z.string().optional().describe("Text content (add_text / update_text)"),
  title: z.string().optional().describe("Container or node title"),

  // add_shape
  shape: z.enum(["rectangle", "ellipse", "diamond"]).optional().describe("Shape type (add_shape)"),
  label: labelSchema,

  // add_line
  line_type: z.enum(["line", "arrow"]).optional().describe("Line or arrow (add_line)"),
  points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .optional()
    .describe("Array of {x,y} points (add_line, optional when using bindings)"),
  start_element_id: z.string().optional().describe("Bind arrow start to this element ID"),
  end_element_id: z.string().optional().describe("Bind arrow end to this element ID"),

  // reorder
  position: z.enum(["front", "back"]).optional().describe("Bring to front or send to back (reorder)"),

  // align / distribute
  element_ids: z.array(z.string()).optional().describe("IDs of elements (align/distribute)"),
  alignment: z
    .enum(["left", "right", "center", "top", "bottom", "middle"])
    .optional()
    .describe("Alignment direction (align)"),
  direction: z.enum(["horizontal", "vertical"]).optional().describe("Distribution direction (distribute)"),
});

const manipulateCanvasSchema = z.object({
  operations: z
    .array(operationSchema)
    .min(1)
    .describe("List of operations to apply"),
});

// Flat operation type — all fields optional except `action`.
type Operation = z.infer<typeof operationSchema>;

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

function applyMove(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const el = findElement(elements, op.element_id!);
  if (!el) return { description: `[skip] element ${op.element_id} not found` };
  el.x = op.x;
  el.y = op.y;
  bumpVersion(el);
  return { description: `moved ${shortLabel(el)} to (${op.x}, ${op.y})` };
}

function applyResize(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const el = findElement(elements, op.element_id!);
  if (!el) return { description: `[skip] element ${op.element_id} not found` };
  el.width = op.width;
  el.height = op.height;
  bumpVersion(el);
  return {
    description: `resized ${shortLabel(el)} to ${op.width}x${op.height}`,
  };
}

/**
 * Delete an element with full cascade:
 * - Marks the target as deleted
 * - Cascades deletion to bound text elements (label cleanup)
 * - Clears startBinding / endBinding on arrows pointing to deleted element
 */
function applyDelete(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const el = findElement(elements, op.element_id!);
  if (!el) return { description: `[skip] element ${op.element_id} not found` };
  el.isDeleted = true;
  bumpVersion(el);

  const cascaded: string[] = [];

  // Cascade to bound text children (labels)
  if (Array.isArray(el.boundElements)) {
    for (const bound of el.boundElements as Array<{ type: string; id: string }>) {
      if (bound.type === "text") {
        const textEl = findElement(elements, bound.id);
        if (textEl) {
          textEl.isDeleted = true;
          bumpVersion(textEl);
          cascaded.push(`text(${bound.id})`);
        }
      }
    }
  }

  // Clean up arrow bindings pointing at the deleted element
  for (const other of elements) {
    if (other.isDeleted) continue;
    const startBinding = other.startBinding as { elementId: string } | null;
    const endBinding = other.endBinding as { elementId: string } | null;
    if (startBinding?.elementId === op.element_id) {
      other.startBinding = null;
      bumpVersion(other);
    }
    if (endBinding?.elementId === op.element_id) {
      other.endBinding = null;
      bumpVersion(other);
    }
  }

  const cascadeInfo = cascaded.length > 0 ? ` (cascaded: ${cascaded.join(", ")})` : "";
  return { description: `deleted ${shortLabel(el)}${cascadeInfo}` };
}

function applyUpdateStyle(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const el = findElement(elements, op.element_id!);
  if (!el) return { description: `[skip] element ${op.element_id} not found` };

  const applied: string[] = [];
  const props = [
    "strokeColor",
    "backgroundColor",
    "opacity",
    "fontSize",
    "strokeWidth",
  ] as const;
  for (const key of props) {
    if (op[key] !== undefined) {
      el[key] = op[key];
      applied.push(key);
    }
  }
  bumpVersion(el);
  return {
    description: `updated ${shortLabel(el)} style: ${applied.join(", ")}`,
  };
}

function applyAddText(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const id = generateId();
  const el: CanvasElement = {
    ...createElementBase(),
    id,
    type: "text",
    text: op.text!,
    x: op.x,
    y: op.y,
    width: measureTextWidth(op.text!, op.fontSize ?? 20),
    height: (op.fontSize ?? 20) * 1.25,
    fontSize: op.fontSize ?? 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: op.strokeColor ?? "#000000",
    containerId: null,
    originalText: op.text!,
    autoResize: true,
    lineHeight: 1.25,
  };
  elements.push(el);
  const short =
    op.text!.length > 20 ? op.text!.slice(0, 17) + "..." : op.text!;
  return {
    description: `added text '${short}' at (${op.x}, ${op.y}) [id=${id}]`,
    createdId: id,
  };
}

/**
 * Update the text content of a standalone text element or a shape's label.
 * Resizes the text element and expands the container if needed.
 */
function applyUpdateText(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const el = findElement(elements, op.element_id!);
  if (!el) return { description: `[skip] element ${op.element_id} not found` };

  let textEl: CanvasElement | undefined;
  if (el.type === "text") {
    textEl = el;
  } else if (Array.isArray(el.boundElements)) {
    const boundText = (el.boundElements as Array<{ type: string; id: string }>).find(
      (b) => b.type === "text",
    );
    if (boundText) textEl = findElement(elements, boundText.id);
  }

  if (!textEl) return { description: `[skip] no text found for element ${op.element_id}` };

  const newText = op.text!;
  const fontSize = (op.fontSize ?? textEl.fontSize ?? 20) as number;
  textEl.text = newText;
  textEl.originalText = newText;

  const lines = newText.split("\n");
  const textWidth = Math.max(...lines.map((l) => measureTextWidth(l, fontSize)));
  const textHeight = lines.length * fontSize * 1.25;
  textEl.width = textWidth;
  textEl.height = textHeight;

  if (op.fontSize !== undefined) textEl.fontSize = fontSize;
  bumpVersion(textEl);

  // Expand container if text no longer fits
  const containerId = textEl.containerId as string | null;
  if (containerId) {
    const container = findElement(elements, containerId);
    if (container) {
      const paddingX = Math.max(fontSize * 1.5, 30);
      const paddingY = Math.max(fontSize * 1.2, 24);
      const minWidth = textWidth + paddingX * 2;
      const minHeight = textHeight + paddingY * 2;
      let resized = false;
      if ((Number(container.width) || 0) < minWidth) { container.width = minWidth; resized = true; }
      if ((Number(container.height) || 0) < minHeight) { container.height = minHeight; resized = true; }
      if (resized) {
        // Re-center text within the (possibly expanded) container
        textEl.x = Number(container.x) + (Number(container.width) - textWidth) / 2;
        textEl.y = Number(container.y) + (Number(container.height) - textHeight) / 2;
        bumpVersion(container);
      }
    }
  }

  const short = newText.length > 20 ? newText.slice(0, 17) + "..." : newText;
  return { description: `updated text to '${short}' on ${op.element_id}` };
}

/**
 * Add a shape with optional centered label.
 * Uses proportional padding based on fontSize to ensure text never overflows.
 * Enforces absolute minimum sizes per shape type.
 */
function applyAddShape(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const shapeId = generateId();
  const el: CanvasElement = {
    ...createElementBase(),
    id: shapeId,
    type: op.shape,
    x: op.x,
    y: op.y,
    width: op.width,
    height: op.height,
    strokeColor: coerceColor(op.strokeColor, "#000000"),
    backgroundColor: coerceColor(op.backgroundColor, "transparent"),
    fillStyle: op.fillStyle ?? "solid",
  };

  if (op.label) {
    const textId = generateId();
    const fontSize = op.label.fontSize;

    // For multi-line labels, measure the longest line and compute total height
    const lines = op.label.text.split("\n");
    const textWidth = Math.max(...lines.map((l) => measureTextWidth(l, fontSize)));
    const textHeight = lines.length * fontSize * 1.25;

    // Proportional padding — scales with font size to avoid overflow at any size
    const paddingX = Math.max(fontSize * 1.5, 30);
    const paddingY = Math.max(fontSize * 1.2, 24);
    const minWidth = textWidth + paddingX * 2;
    const minHeight = textHeight + paddingY * 2;

    // Enforce minimum shape size so text never overflows, plus absolute floor
    el.width = Math.max(Number(el.width) || 0, minWidth, 120);
    el.height = Math.max(Number(el.height) || 0, minHeight, 60);

    // Bind text to shape
    ensureBoundElements(el).push({ type: "text", id: textId });

    const textEl: CanvasElement = {
      ...createElementBase(),
      id: textId,
      type: "text",
      text: op.label.text,
      originalText: op.label.text,
      x: Number(el.x) + (Number(el.width) - textWidth) / 2,
      y: Number(el.y) + (Number(el.height) - textHeight) / 2,
      width: textWidth,
      height: textHeight,
      fontSize,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: coerceColor(op.label.strokeColor, "#000000"),
      containerId: shapeId,
      autoResize: true,
      lineHeight: 1.25,
    };

    elements.push(el);
    elements.push(textEl);

    const short =
      op.label.text.length > 20
        ? op.label.text.slice(0, 17) + "..."
        : op.label.text;
    return {
      description: `added ${op.shape} ${el.width}x${el.height} with label '${short}' at (${op.x}, ${op.y}) [id=${shapeId}]`,
      createdId: shapeId,
    };
  }

  // No label — enforce minimum sizes per shape type
  const shapeType = op.shape as string;
  if (shapeType === "ellipse") {
    el.width = Math.max(Number(el.width) || 0, 140);
    el.height = Math.max(Number(el.height) || 0, 70);
  } else {
    el.width = Math.max(Number(el.width) || 0, 120);
    el.height = Math.max(Number(el.height) || 0, 60);
  }

  elements.push(el);
  return {
    description: `added ${op.shape} ${el.width}x${el.height} at (${op.x}, ${op.y}) [id=${shapeId}]`,
    createdId: shapeId,
  };
}

function applyAddLine(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const hasBinding = op.start_element_id || op.end_element_id;

  if (hasBinding) {
    return applyAddBoundLine(elements, op);
  }

  // Non-binding path: points are required
  if (!op.points || op.points.length < 2) {
    return {
      description:
        "[skip] add_line without bindings requires points (>= 2)",
    };
  }

  // Auto-derive origin from first point if x/y not provided.
  // Excalidraw stores points relative to the element's x/y origin.
  const originX = op.x ?? op.points[0]!.x;
  const originY = op.y ?? op.points[0]!.y;
  const excalidrawPoints = op.points.map((p) => [p.x - originX, p.y - originY]);

  const relXs = excalidrawPoints.map((p) => p[0]!);
  const relYs = excalidrawPoints.map((p) => p[1]!);
  const width = Math.abs(Math.max(...relXs) - Math.min(...relXs));
  const height = Math.abs(Math.max(...relYs) - Math.min(...relYs));

  const arrowId = generateId();
  const el: CanvasElement = {
    ...createElementBase(),
    id: arrowId,
    type: op.line_type ?? "arrow",
    x: originX,
    y: originY,
    width,
    height,
    points: excalidrawPoints,
    strokeColor: coerceColor(op.strokeColor, "#000000"),
    strokeWidth: op.strokeWidth ?? 2,
    lastCommittedPoint: excalidrawPoints[excalidrawPoints.length - 1],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: op.line_type === "arrow" ? "arrow" : null,
  };
  elements.push(el);
  return {
    description: `added ${op.line_type} with ${op.points.length} points at (${originX}, ${originY}) [id=${arrowId}]`,
    createdId: arrowId,
  };
}

/**
 * Add an arrow/line with element bindings.
 * Uses computeFixedPoint to set stable fixedPoint values so Excalidraw does
 * not recompute endpoints when bound shapes are resized.
 */
function applyAddBoundLine(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const startEl = op.start_element_id
    ? findElement(elements, op.start_element_id)
    : null;
  const endEl = op.end_element_id
    ? findElement(elements, op.end_element_id)
    : null;

  if (op.start_element_id && !startEl) {
    return {
      description: `[skip] start element ${op.start_element_id} not found`,
    };
  }
  if (op.end_element_id && !endEl) {
    return {
      description: `[skip] end element ${op.end_element_id} not found`,
    };
  }

  const startCenter = startEl
    ? getElementCenter(startEl)
    : { cx: op.x ?? 0, cy: op.y ?? 0 };
  const endCenter = endEl
    ? getElementCenter(endEl)
    : { cx: (op.x ?? 0) + 100, cy: op.y ?? 0 };

  const startPoint = startEl
    ? computeEdgePoint(startEl, { x: endCenter.cx, y: endCenter.cy })
    : { x: startCenter.cx, y: startCenter.cy };

  const endPoint = endEl
    ? computeEdgePoint(endEl, { x: startCenter.cx, y: startCenter.cy })
    : { x: endCenter.cx, y: endCenter.cy };

  const arrowId = generateId();
  const relEnd = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y,
  };

  let startBinding: unknown = null;
  let endBinding: unknown = null;

  if (startEl) {
    const fixedPoint = endEl
      ? computeFixedPoint(startEl, endEl)
      : [1, 0.5] as [number, number];
    startBinding = {
      elementId: op.start_element_id,
      focus: 0,
      gap: BINDING_GAP,
      fixedPoint,
    };
    ensureBoundElements(startEl).push({ type: "arrow", id: arrowId });
    bumpVersion(startEl);
  }

  if (endEl) {
    const fixedPoint = startEl
      ? computeFixedPoint(endEl, startEl)
      : [0, 0.5] as [number, number];
    endBinding = {
      elementId: op.end_element_id,
      focus: 0,
      gap: BINDING_GAP,
      fixedPoint,
    };
    ensureBoundElements(endEl).push({ type: "arrow", id: arrowId });
    bumpVersion(endEl);
  }

  const el: CanvasElement = {
    ...createElementBase(),
    id: arrowId,
    type: op.line_type ?? "arrow",
    x: startPoint.x,
    y: startPoint.y,
    width: Math.abs(relEnd.x),
    height: Math.abs(relEnd.y),
    points: [
      [0, 0],
      [relEnd.x, relEnd.y],
    ],
    strokeColor: coerceColor(op.strokeColor, "#000000"),
    strokeWidth: op.strokeWidth ?? 2,
    lastCommittedPoint: [relEnd.x, relEnd.y],
    startBinding,
    endBinding,
    startArrowhead: null,
    endArrowhead: op.line_type === "arrow" || !op.line_type ? "arrow" : null,
  };
  elements.push(el);

  const fromLabel = op.start_element_id ?? "free";
  const toLabel = op.end_element_id ?? "free";
  return {
    description: `added bound ${op.line_type ?? "arrow"} ${fromLabel} → ${toLabel} [id=${arrowId}]`,
    createdId: arrowId,
  };
}

function applyReorder(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const idx = elements.findIndex(
    (el) => el.id === op.element_id && !el.isDeleted,
  );
  if (idx === -1)
    return { description: `[skip] element ${op.element_id} not found` };

  const removed = elements.splice(idx, 1);
  const el = removed[0]!;
  if (op.position === "front") {
    elements.push(el);
  } else {
    elements.unshift(el);
  }
  bumpVersion(el);
  return { description: `reordered ${shortLabel(el)} to ${op.position}` };
}

function applyAlign(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const targets = (op.element_ids ?? [])
    .map((id) => findElement(elements, id))
    .filter((el): el is CanvasElement => el !== undefined);

  if (targets.length < 2) {
    return {
      description: `[skip] need >= 2 valid elements to align, found ${targets.length}`,
    };
  }

  switch (op.alignment) {
    case "left": {
      const minX = Math.min(...targets.map((el) => Number(el.x) || 0));
      for (const el of targets) { el.x = minX; bumpVersion(el); }
      break;
    }
    case "right": {
      const maxRight = Math.max(
        ...targets.map((el) => (Number(el.x) || 0) + (Number(el.width) || 0)),
      );
      for (const el of targets) { el.x = maxRight - (Number(el.width) || 0); bumpVersion(el); }
      break;
    }
    case "center": {
      const centers = targets.map(
        (el) => (Number(el.x) || 0) + (Number(el.width) || 0) / 2,
      );
      const avg = centers.reduce((a, b) => a + b, 0) / centers.length;
      for (const el of targets) { el.x = avg - (Number(el.width) || 0) / 2; bumpVersion(el); }
      break;
    }
    case "top": {
      const minY = Math.min(...targets.map((el) => Number(el.y) || 0));
      for (const el of targets) { el.y = minY; bumpVersion(el); }
      break;
    }
    case "bottom": {
      const maxBottom = Math.max(
        ...targets.map((el) => (Number(el.y) || 0) + (Number(el.height) || 0)),
      );
      for (const el of targets) { el.y = maxBottom - (Number(el.height) || 0); bumpVersion(el); }
      break;
    }
    case "middle": {
      const middles = targets.map(
        (el) => (Number(el.y) || 0) + (Number(el.height) || 0) / 2,
      );
      const avg = middles.reduce((a, b) => a + b, 0) / middles.length;
      for (const el of targets) { el.y = avg - (Number(el.height) || 0) / 2; bumpVersion(el); }
      break;
    }
  }

  return {
    description: `aligned ${targets.length} elements ${op.alignment}`,
  };
}

function applyDistribute(
  elements: CanvasElement[],
  op: Operation,
): HandlerResult {
  const targets = (op.element_ids ?? [])
    .map((id) => findElement(elements, id))
    .filter((el): el is CanvasElement => el !== undefined);

  if (targets.length < 3) {
    return {
      description: `[skip] need >= 3 valid elements to distribute, found ${targets.length}`,
    };
  }

  if (op.direction === "horizontal") {
    targets.sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0));
    const first = targets[0]!;
    const last = targets[targets.length - 1]!;
    const totalSpan =
      (Number(last.x) || 0) +
      (Number(last.width) || 0) -
      (Number(first.x) || 0);
    const totalWidths = targets.reduce((sum, el) => sum + (Number(el.width) || 0), 0);
    const gap = (totalSpan - totalWidths) / (targets.length - 1);

    let currentX = Number(first.x) || 0;
    for (const el of targets) {
      el.x = currentX;
      bumpVersion(el);
      currentX += (Number(el.width) || 0) + gap;
    }
  } else {
    targets.sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
    const first = targets[0]!;
    const last = targets[targets.length - 1]!;
    const totalSpan =
      (Number(last.y) || 0) +
      (Number(last.height) || 0) -
      (Number(first.y) || 0);
    const totalHeights = targets.reduce((sum, el) => sum + (Number(el.height) || 0), 0);
    const gap = (totalSpan - totalHeights) / (targets.length - 1);

    let currentY = Number(first.y) || 0;
    for (const el of targets) {
      el.y = currentY;
      bumpVersion(el);
      currentY += (Number(el.height) || 0) + gap;
    }
  }

  return {
    description: `distributed ${targets.length} elements ${op.direction}ly`,
  };
}

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

function inferWritableContainerId(
  doc: CucumberCanvasDocument,
  op: Operation,
): string | null {
  const referencedIds = [
    op.container_id,
    op.element_id,
    ...(op.element_ids ?? []),
    op.start_element_id,
    op.end_element_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const id of referencedIds) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.type === "container") {
      return node.id;
    }
    if (node.parentId) {
      return node.parentId;
    }
  }

  const boundWritableContainers = Object.values(doc.nodes).filter(
    (node): node is ContainerNode =>
      isContainerNode(node) &&
      Boolean(node.agentBinding?.permissions?.includes("write")),
  );
  if (boundWritableContainers.length === 1) {
    return boundWritableContainers[0]!.id;
  }

  const openContainers = Object.values(doc.nodes).filter(
    (node): node is ContainerNode =>
      isContainerNode(node) &&
      node.permissions?.isolationLevel === "open",
  );
  if (openContainers.length === 1) {
    return openContainers[0]!.id;
  }

  return null;
}

function ensureContainer(
  doc: CucumberCanvasDocument,
  containerId: string | null,
): ContainerNode {
  if (!containerId) {
    throw new CanvasOperationError(
      "permission_denied",
      "No writable container could be resolved for this operation. Bind the agent to a container or pass container_id explicitly.",
    );
  }
  const container = doc.nodes[containerId];
  if (!isContainerNode(container)) {
    throw new CanvasOperationError(
      "container_not_found",
      `Container ${containerId} does not exist.`,
    );
  }
  return container;
}

function defaultNodeBounds(
  doc: CucumberCanvasDocument,
  type: CucumberCanvasNode["type"],
  containerId: string | null,
  op: Operation,
): CanvasBounds {
  const container = containerId ? ensureContainer(doc, containerId) : null;
  const baseX = op.x ?? (container ? container.bounds.x + 24 : 120);
  const baseY = op.y ?? (container ? container.bounds.y + 32 : 120);

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

function applyCucumberUpdate(
  doc: CucumberCanvasDocument,
  nodeId: string,
  updates: Partial<CucumberCanvasNode>,
  agentId: string | undefined,
  containerId?: string | null,
): CucumberCanvasDocument {
  return applyCanvasOperation(doc, {
    type: "updateNode",
    nodeId,
    updates,
    ...(agentId ? { agentId } : {}),
    ...(containerId !== undefined ? { containerId } : {}),
  });
}

function applyCucumberDelete(
  doc: CucumberCanvasDocument,
  nodeId: string,
  agentId: string | undefined,
  containerId?: string | null,
): CucumberCanvasDocument {
  return applyCanvasOperation(doc, {
    type: "deleteNode",
    nodeId,
    ...(agentId ? { agentId } : {}),
    ...(containerId !== undefined ? { containerId } : {}),
  });
}

function applyCucumberInsert(
  doc: CucumberCanvasDocument,
  node: CucumberCanvasNode,
  agentId: string | undefined,
  containerId?: string | null,
): CucumberCanvasDocument {
  return applyCanvasOperation(doc, {
    type: "insertNode",
    node,
    ...(agentId ? { agentId } : {}),
    ...(containerId !== undefined ? { containerId } : {}),
  });
}

function reorderCucumberNode(
  doc: CucumberCanvasDocument,
  nodeId: string,
  position: "front" | "back",
  agentId: string | undefined,
): CucumberCanvasDocument {
  const node = doc.nodes[nodeId];
  if (!node) {
    throw new CanvasOperationError(
      "node_not_found",
      `Node ${nodeId} does not exist.`,
    );
  }

  assertAgentCanWrite(doc, agentId, node.parentId, node);

  const next = cloneCanvasDocument(doc);
  const current = next.nodes[nodeId];
  if (!current) return next;
  const parentNode =
    current.parentId !== null ? next.nodes[current.parentId] : undefined;

  const order =
    current.parentId === null
      ? next.rootNodeIds
      : parentNode && "childrenOrder" in parentNode
        ? (
            parentNode as ContainerNode | {
              childrenOrder: string[];
            }
          ).childrenOrder
        : null;

  if (!order) return next;

  const filtered = order.filter((id) => id !== nodeId);
  if (position === "front") {
    filtered.push(nodeId);
  } else {
    filtered.unshift(nodeId);
  }

  if (current.parentId === null) {
    next.rootNodeIds = filtered;
  } else {
    (
      next.nodes[current.parentId] as ContainerNode | { childrenOrder: string[] }
    ).childrenOrder = filtered;
  }
  next.updatedAt = new Date().toISOString();
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

function manipulateCucumberCanvas(args: {
  doc: CucumberCanvasDocument;
  operations: Operation[];
  agentId?: string;
}): {
  createdIds: Record<string, string>;
  descriptions: string[];
  errors: string[];
  nextDoc: CucumberCanvasDocument;
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
          const nodeId = createCanvasNodeId("container");
          const bounds = defaultNodeBounds(nextDoc, "container", null, {
            ...op,
            width: op.width ?? 520,
            height: op.height ?? 360,
          });
          const container: ContainerNode = {
            id: nodeId,
            type: "container",
            parentId: null,
            title: op.title ?? op.text ?? "Agent output",
            bounds,
            role: ["visual", "task", "context"],
            childrenOrder: [],
            contextSlots: {},
            inheritPolicy: "merge",
            permissions: {
              canRead: [],
              canWrite: [],
              isolationLevel: "open",
            },
            style: {
              fill: coerceColor(op.backgroundColor, "#ffffff"),
              stroke: coerceColor(op.strokeColor, "#6c5ce7"),
              opacity:
                op.opacity !== undefined ? Math.max(0, Math.min(100, op.opacity)) / 100 : 1,
            },
          };
          nextDoc = applyCanvasOperation(nextDoc, {
            type: "insertNode",
            node: container,
          });
          descriptions.push(
            `added container '${container.title}' [id=${nodeId}]`,
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
          const node = nextDoc.nodes[op.element_id];
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              bounds: {
                ...node.bounds,
                x: op.x ?? node.bounds.x,
                y: op.y ?? node.bounds.y,
              },
            } as Partial<CucumberCanvasNode>,
            args.agentId,
            inferredContainerId ?? node.parentId,
          );
          descriptions.push(
            `moved ${node.type} ${node.id} to (${op.x ?? node.bounds.x}, ${op.y ?? node.bounds.y})`,
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
          const node = nextDoc.nodes[op.element_id];
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              bounds: {
                ...node.bounds,
                width: op.width ?? node.bounds.width,
                height: op.height ?? node.bounds.height,
              },
            } as Partial<CucumberCanvasNode>,
            args.agentId,
            inferredContainerId ?? node.parentId,
          );
          descriptions.push(
            `resized ${node.type} ${node.id} to ${op.width ?? node.bounds.width}x${op.height ?? node.bounds.height}`,
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
          const node = nextDoc.nodes[op.element_id];
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          nextDoc = applyCucumberDelete(
            nextDoc,
            node.id,
            args.agentId,
            inferredContainerId ?? node.parentId,
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
          const node = nextDoc.nodes[op.element_id];
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }

          let updates: Partial<CucumberCanvasNode> | null = null;
          if (node.type === "rect") {
            updates = {
              ...(op.backgroundColor !== undefined
                ? { fill: coerceColor(op.backgroundColor, "#d3f256") }
                : {}),
              ...(op.strokeColor !== undefined
                ? { stroke: coerceColor(op.strokeColor, "#111827") }
                : {}),
              ...(op.strokeWidth !== undefined
                ? { strokeWidth: op.strokeWidth }
                : {}),
            } as Partial<CucumberCanvasNode>;
          } else if (node.type === "container") {
            updates = {
              style: {
                ...node.style,
                ...(op.backgroundColor !== undefined
                  ? { fill: coerceColor(op.backgroundColor, "#ffffff") }
                  : {}),
                ...(op.strokeColor !== undefined
                  ? { stroke: coerceColor(op.strokeColor, "#6c5ce7") }
                  : {}),
                ...(op.opacity !== undefined ? { opacity: op.opacity / 100 } : {}),
              },
            } as Partial<CucumberCanvasNode>;
          } else if (node.type === "text") {
            updates = {
              ...(op.strokeColor !== undefined
                ? { color: coerceColor(op.strokeColor, "#111827") }
                : {}),
              ...(op.fontSize !== undefined ? { fontSize: op.fontSize } : {}),
            } as Partial<CucumberCanvasNode>;
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
            inferredContainerId ?? node.parentId,
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
          const nodeId = createCanvasNodeId("text");
          const node: CucumberCanvasNode = {
            id: nodeId,
            type: "text",
            parentId: container.id,
            title:
              op.text.length > 32 ? `${op.text.slice(0, 29)}...` : op.text,
            bounds: defaultNodeBounds(nextDoc, "text", container.id, op),
            text: op.text,
            fontSize: op.fontSize ?? 28,
            color: coerceColor(op.strokeColor, "#111827"),
          };
          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container.id,
          );
          descriptions.push(
            `added text '${node.title}' in container ${container.id} [id=${nodeId}]`,
          );
          createdIds[`op_${i}`] = nodeId;
          break;
        }
        case "add_shape": {
          if (op.shape !== "rectangle") {
            errors.push(
              `[skip] add_shape only supports rectangle on the new Cucumber canvas runtime`,
            );
            continue;
          }
          const container = ensureContainer(nextDoc, inferredContainerId);
          const nodeId = createCanvasNodeId("rect");
          const title =
            op.label?.text ??
            (op.text?.trim() || `Rectangle ${Object.keys(createdIds).length + 1}`);
          const node: CucumberCanvasNode = {
            id: nodeId,
            type: "rect",
            parentId: container.id,
            title,
            bounds: defaultNodeBounds(nextDoc, "rect", container.id, op),
            fill: coerceColor(op.backgroundColor, "#d3f256"),
            stroke: coerceColor(op.strokeColor, "#111827"),
            strokeWidth: op.strokeWidth ?? 1,
            radius: 12,
          };
          nextDoc = applyCucumberInsert(
            nextDoc,
            node,
            args.agentId,
            container.id,
          );
          descriptions.push(
            `added rectangle '${title}' in container ${container.id} [id=${nodeId}]`,
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
          const node = nextDoc.nodes[op.element_id];
          if (!node) {
            errors.push(`[skip] node ${op.element_id} not found`);
            continue;
          }
          if (node.type === "text") {
            const fontSize = op.fontSize ?? node.fontSize;
            const lines = op.text.split("\n");
            const measuredWidth = Math.max(
              ...lines.map((line) => measureTextWidth(line, fontSize)),
              1,
            );
            nextDoc = applyCucumberUpdate(
              nextDoc,
              node.id,
              {
                text: op.text,
                title:
                  op.text.length > 32
                    ? `${op.text.slice(0, 29)}...`
                    : op.text,
                fontSize,
                bounds: {
                  ...node.bounds,
                  width: Math.max(node.bounds.width, Math.ceil(measuredWidth + fontSize)),
                  height: Math.max(
                    node.bounds.height,
                    Math.ceil(lines.length * fontSize * 1.4 + fontSize),
                  ),
                },
              } as Partial<CucumberCanvasNode>,
              args.agentId,
              inferredContainerId ?? node.parentId,
            );
            descriptions.push(`updated text on ${node.id}`);
            break;
          }

          nextDoc = applyCucumberUpdate(
            nextDoc,
            node.id,
            {
              title: op.text.length > 64 ? `${op.text.slice(0, 61)}...` : op.text,
            } as Partial<CucumberCanvasNode>,
            args.agentId,
            inferredContainerId ?? node.parentId,
          );
          descriptions.push(`updated title on ${node.id}`);
          break;
        }
        case "align": {
          const targets = (op.element_ids ?? [])
            .map((id) => nextDoc.nodes[id])
            .filter((node): node is CucumberCanvasNode => Boolean(node));
          if (targets.length < 2) {
            errors.push(
              `[skip] need >= 2 valid nodes to align, found ${targets.length}`,
            );
            continue;
          }

          const updates = new Map<string, CanvasBounds>();
          switch (op.alignment) {
            case "left": {
              const minX = Math.min(...targets.map((node) => node.bounds.x));
              for (const node of targets) {
                updates.set(node.id, { ...node.bounds, x: minX });
              }
              break;
            }
            case "right": {
              const maxRight = Math.max(
                ...targets.map((node) => node.bounds.x + node.bounds.width),
              );
              for (const node of targets) {
                updates.set(node.id, {
                  ...node.bounds,
                  x: maxRight - node.bounds.width,
                });
              }
              break;
            }
            case "center": {
              const averageCenter =
                targets.reduce(
                  (sum, node) => sum + node.bounds.x + node.bounds.width / 2,
                  0,
                ) / targets.length;
              for (const node of targets) {
                updates.set(node.id, {
                  ...node.bounds,
                  x: averageCenter - node.bounds.width / 2,
                });
              }
              break;
            }
            case "top": {
              const minY = Math.min(...targets.map((node) => node.bounds.y));
              for (const node of targets) {
                updates.set(node.id, { ...node.bounds, y: minY });
              }
              break;
            }
            case "bottom": {
              const maxBottom = Math.max(
                ...targets.map((node) => node.bounds.y + node.bounds.height),
              );
              for (const node of targets) {
                updates.set(node.id, {
                  ...node.bounds,
                  y: maxBottom - node.bounds.height,
                });
              }
              break;
            }
            case "middle": {
              const averageMiddle =
                targets.reduce(
                  (sum, node) => sum + node.bounds.y + node.bounds.height / 2,
                  0,
                ) / targets.length;
              for (const node of targets) {
                updates.set(node.id, {
                  ...node.bounds,
                  y: averageMiddle - node.bounds.height / 2,
                });
              }
              break;
            }
            default: {
              errors.push(`[skip] unsupported alignment ${op.alignment}`);
              continue;
            }
          }

          for (const node of targets) {
            const nextBounds = updates.get(node.id);
            if (!nextBounds) continue;
            nextDoc = applyCucumberUpdate(
              nextDoc,
              node.id,
              { bounds: nextBounds } as Partial<CucumberCanvasNode>,
              args.agentId,
              node.parentId,
            );
          }
          descriptions.push(`aligned ${targets.length} nodes ${op.alignment}`);
          break;
        }
        case "distribute": {
          const targets = (op.element_ids ?? [])
            .map((id) => nextDoc.nodes[id])
            .filter((node): node is CucumberCanvasNode => Boolean(node));
          if (targets.length < 3) {
            errors.push(
              `[skip] need >= 3 valid nodes to distribute, found ${targets.length}`,
            );
            continue;
          }

          if (op.direction === "horizontal") {
            const sorted = [...targets].sort(
              (left, right) => left.bounds.x - right.bounds.x,
            );
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const totalSpan =
              last.bounds.x + last.bounds.width - first.bounds.x;
            const totalWidth = sorted.reduce(
              (sum, node) => sum + node.bounds.width,
              0,
            );
            const gap = (totalSpan - totalWidth) / (sorted.length - 1);
            let cursor = first.bounds.x;
            for (const node of sorted) {
              nextDoc = applyCucumberUpdate(
                nextDoc,
                node.id,
                {
                  bounds: { ...node.bounds, x: cursor },
                } as Partial<CucumberCanvasNode>,
                args.agentId,
                node.parentId,
              );
              cursor += node.bounds.width + gap;
            }
          } else {
            const sorted = [...targets].sort(
              (top, bottom) => top.bounds.y - bottom.bounds.y,
            );
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const totalSpan =
              last.bounds.y + last.bounds.height - first.bounds.y;
            const totalHeight = sorted.reduce(
              (sum, node) => sum + node.bounds.height,
              0,
            );
            const gap = (totalSpan - totalHeight) / (sorted.length - 1);
            let cursor = first.bounds.y;
            for (const node of sorted) {
              nextDoc = applyCucumberUpdate(
                nextDoc,
                node.id,
                {
                  bounds: { ...node.bounds, y: cursor },
                } as Partial<CucumberCanvasNode>,
                args.agentId,
                node.parentId,
              );
              cursor += node.bounds.height + gap;
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
          errors.push(
            "[skip] add_line is not yet supported on the new Cucumber canvas runtime",
          );
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
// Dispatcher
// ---------------------------------------------------------------------------

const handlers: Record<
  Operation["action"],
  (elements: CanvasElement[], op: any) => HandlerResult
> = {
  add_container: () => ({
    description: "[skip] add_container requires the Cucumber canvas runtime",
  }),
  move: applyMove,
  resize: applyResize,
  delete: applyDelete,
  update_style: applyUpdateStyle,
  add_text: applyAddText,
  add_shape: applyAddShape,
  add_line: applyAddLine,
  reorder: applyReorder,
  align: applyAlign,
  distribute: applyDistribute,
  update_text: applyUpdateText,
};

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
        const content = await deps.liveCanvasService.getDocument(user, canvasId);
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
          nodeCount: Object.keys(nextDoc.nodes).length,
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
        "Manipulate elements on the live Cucumber canvas. Supports: add_container, move, resize, delete, update_style, update_text, add_text, add_shape, add_line, align, distribute, reorder. Use inspect_canvas first to understand the current layout. Returns created element IDs for subsequent binding, and same-batch operations can reference earlier IDs with op_0, op_1, etc.",
      schema: manipulateCanvasSchema,
    },
  );
}
