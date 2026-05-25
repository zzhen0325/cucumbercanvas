/**
 * Adapter to convert PenNode to the shape expected by CanvasPropertyPanel.
 * The panel was written for the old CanvasNode type, which differs from PenNode.
 * This adapter maps field names so the panel works without a full rewrite.
 */
import type { PenNode } from "@cucumber/pen-types";
import type { CanvasNode } from "@cucumber/canvas-core";

export function penNodeToLegacy(node: PenNode): CanvasNode {
  return {
    ...node,
    // Legacy panel reads .title; PenNode has .name
    title: (node as any).name ?? (node as any).title,
    // Legacy panel reads .bounds for position; PenNode has x/y directly
    bounds: {
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: (node as any).width ?? 0,
      height: (node as any).height ?? 0,
    },
    // Legacy panel reads .fills (array); PenNode has .fill (single or array)
    fills: normalizeFills((node as any).fill),
    // Legacy panel reads .strokes (array); PenNode has .stroke (object)
    strokes: normalizeStrokes((node as any).stroke),
    // Legacy panel reads .text; PenNode has .content for text nodes
    text: (node as any).content ?? (node as any).text,
    // Map type names: frame → container
    type: mapType(node.type),
  } as unknown as CanvasNode;
}

function mapType(type: string): string {
  const reverseMap: Record<string, string> = {
    frame: "container",
    rectangle: "rect",
    iconFont: "icon",
  };
  return reverseMap[type] ?? type;
}

function normalizeFills(fill: unknown): Array<{ type: string; color?: string }> {
  if (!fill) return [];
  if (Array.isArray(fill)) return fill as any[];
  return [fill as any];
}

function normalizeStrokes(stroke: unknown): Array<{ type: string; color?: string }> {
  if (!stroke) return [];
  const s = stroke as any;
  if (s.fill) {
    return Array.isArray(s.fill) ? s.fill : [s.fill];
  }
  return [];
}

/**
 * Convert property updates back from legacy field names to PenNode fields.
 */
export function legacyUpdateToPenNode(updates: Partial<Record<string, unknown>>): Partial<PenNode> {
  const result: Record<string, unknown> = { ...updates };
  // bounds → x, y, width, height
  if (result.bounds) {
    const b = result.bounds as { x: number; y: number; width: number; height: number };
    result.x = b.x;
    result.y = b.y;
    result.width = b.width;
    result.height = b.height;
    delete result.bounds;
  }
  // fills → fill
  if (result.fills) {
    result.fill = result.fills;
    delete result.fills;
  }
  // strokes → stroke
  if (result.strokes) {
    const s = result.strokes as any[];
    result.stroke = s.length > 0 ? { thickness: result.strokeWeight ?? 1, fill: s } : undefined;
    delete result.strokes;
  }
  // title → name
  if (result.title !== undefined) {
    result.name = result.title;
    delete result.title;
  }
  // text → content (for text nodes)
  if (result.text !== undefined) {
    result.content = result.text;
    delete result.text;
  }
  // container type back to frame
  if (result.type === "container") {
    result.type = "frame";
  }
  if (result.type === "rect") {
    result.type = "rectangle";
  }
  return result as Partial<PenNode>;
}
