import type { PenNode } from "@cucumber/pen-types";
import { createNodeId } from "./document.js";
import type { CanvasBounds } from "./types.js";

export const STICKY_NOTE_DEFAULT_WIDTH = 220;
export const STICKY_NOTE_DEFAULT_HEIGHT = 200;
export const STICKY_NOTE_MIN_WIDTH = 160;
export const STICKY_NOTE_MIN_HEIGHT = 140;
export const STICKY_NOTE_PLACEHOLDER_TEXT = "Type anything";
export const STICKY_NOTE_DEFAULT_BACKGROUND = "#FFE59A";

const STICKY_NOTE_FONT_FAMILY =
  'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';

export function createStickyNoteNode(
  bounds: CanvasBounds,
  text = "",
  options: { name?: string } = {},
): PenNode {
  const id = createNodeId("sticky");
  const width = Math.max(bounds.width, STICKY_NOTE_MIN_WIDTH);
  const height = Math.max(bounds.height, STICKY_NOTE_MIN_HEIGHT);
  const backgroundColor = STICKY_NOTE_DEFAULT_BACKGROUND;
  const content = text === STICKY_NOTE_PLACEHOLDER_TEXT ? "" : text;
  return {
    id,
    type: "frame",
    name: options.name ?? "Sticky",
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    clipContent: false,
    fill: [{ type: "solid", color: backgroundColor }],
    stroke: {
      thickness: 1,
      fill: [
        { type: "solid", color: deriveStickyStrokeColor(backgroundColor) },
      ],
    },
    cornerRadius: 4,
    effects: [],
    meta: {
      boardKind: "sticky",
      containerType: "sticky_note",
      selectionMode: "container",
    },
    containerRole: ["context"],
    contextSlots: {},
    inheritPolicy: "merge",
    permissions: {
      owner: "user",
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
    },
    children: [
      {
        id: createNodeId("sticky_text"),
        type: "text",
        name: "Sticky text",
        x: 20,
        y: 20,
        width: width - 40,
        height: height - 40,
        content,
        fontFamily: STICKY_NOTE_FONT_FAMILY,
        fontSize: 24,
        lineHeight: 1.35,
        textGrowth: "fixed-width",
        fill: [{ type: "solid", color: "rgba(91,72,27,0.72)" }],
        meta: {
          stickyRole: "body",
          selectable: false,
          placeholder: STICKY_NOTE_PLACEHOLDER_TEXT,
        },
      } as PenNode,
    ],
  } as PenNode;
}

export function deriveStickyStrokeColor(backgroundColor: string): string {
  const rgb = parseCssColor(backgroundColor);
  if (!rgb) {
    throw new Error(
      `Sticky background color "${backgroundColor}" cannot be parsed for stroke derivation.`,
    );
  }
  const darkened = {
    r: Math.max(0, Math.round(rgb.r * 0.56)),
    g: Math.max(0, Math.round(rgb.g * 0.56)),
    b: Math.max(0, Math.round(rgb.b * 0.56)),
  };
  return `rgba(${darkened.r},${darkened.g},${darkened.b},0.24)`;
}

function parseCssColor(
  color: string,
): { r: number; g: number; b: number } | null {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const raw = hex[1];
    const expanded =
      raw.length === 3
        ? raw
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
        : raw;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }

  const rgb = trimmed.match(
    /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*(?:,|\/)\s*(?:0|1|0?\.\d+|\d+%))?\s*\)$/i,
  );
  if (!rgb?.[1] || !rgb[2] || !rgb[3]) return null;
  const r = Number.parseInt(rgb[1], 10);
  const g = Number.parseInt(rgb[2], 10);
  const b = Number.parseInt(rgb[3], 10);
  if ([r, g, b].some((channel) => channel < 0 || channel > 255)) return null;
  return {
    r,
    g,
    b,
  };
}
