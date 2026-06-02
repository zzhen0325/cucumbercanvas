import { sceneToCanvasLocal } from "@cucumber/pen-renderer";
import type { PenNode } from "@cucumber/pen-types";
import type React from "react";

export const DEFAULT_TEXT_FONT_SIZE = 28;
export const DEFAULT_TEXT_LINE_HEIGHT = 1.4;
export const DEFAULT_TEXT_FONT_FAMILY =
  'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
export const MIN_TEXT_BOX_SIZE = 8;

export type TextEditState = {
  nodeId: string;
  isNew: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  initialContent: string;
  textGrowth: "auto" | "fixed-width" | "fixed-width-height";
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: React.CSSProperties["textAlign"];
  color: string;
  lineHeight: number | string;
  commitSelection: string[];
};

export function projectTextEditStateToViewport(
  editingText: TextEditState,
  viewport: { zoom: number; panX: number; panY: number },
) {
  const local = sceneToCanvasLocal(editingText.x, editingText.y, viewport);
  return {
    left: local.x,
    top: local.y,
    width: Math.max(editingText.width * viewport.zoom, 1),
    height: Math.max(editingText.height * viewport.zoom, 1),
    fontSize: Math.max(editingText.fontSize * viewport.zoom, 1),
  };
}

function cssFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("'") || trimmed.startsWith('"')) {
        return trimmed;
      }
      return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
    })
    .join(", ");
}

function getTextMeasureContext() {
  if (typeof document === "undefined") return null;
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("jsdom")
  ) {
    return null;
  }
  const canvas = document.createElement("canvas");
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

export function getLineHeightPx(
  lineHeight: number | string | undefined,
  fontSize: number,
): number {
  if (typeof lineHeight === "number") {
    return lineHeight <= 4 ? lineHeight * fontSize : lineHeight;
  }
  if (typeof lineHeight === "string") {
    const parsed = Number.parseFloat(lineHeight);
    if (Number.isFinite(parsed)) {
      return lineHeight.endsWith("px") ? parsed : parsed * fontSize;
    }
  }
  return DEFAULT_TEXT_LINE_HEIGHT * fontSize;
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D | null,
  text: string,
  fontSize: number,
): number {
  if (ctx) return ctx.measureText(text).width;
  return text.length * fontSize * 0.56;
}

function wrapTextLine(
  ctx: CanvasRenderingContext2D | null,
  line: string,
  width: number,
  fontSize: number,
  output: string[],
) {
  if (!line) {
    output.push("");
    return;
  }
  let current = "";
  for (const char of Array.from(line)) {
    const candidate = `${current}${char}`;
    if (
      current &&
      measureTextWidth(ctx, candidate, fontSize) > Math.max(width, 1)
    ) {
      output.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  output.push(current);
}

export function measureTextLayout(options: {
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  lineHeight: number | string;
  textGrowth: "auto" | "fixed-width" | "fixed-width-height";
  width: number;
  height: number;
}) {
  const ctx = getTextMeasureContext();
  if (ctx) {
    ctx.font = `${options.fontWeight} ${options.fontSize}px ${cssFontFamily(
      options.fontFamily,
    )}`;
  }
  const lineHeightPx = getLineHeightPx(options.lineHeight, options.fontSize);
  const rawLines = options.content.split("\n");
  const lines = rawLines.length > 0 ? rawLines : [""];

  if (options.textGrowth === "fixed-width-height") {
    return {
      width: Math.max(options.width, MIN_TEXT_BOX_SIZE),
      height: Math.max(options.height, MIN_TEXT_BOX_SIZE),
    };
  }

  if (options.textGrowth === "fixed-width") {
    const wrappedLines: string[] = [];
    for (const line of lines) {
      wrapTextLine(
        ctx,
        line,
        Math.max(options.width, MIN_TEXT_BOX_SIZE),
        options.fontSize,
        wrappedLines,
      );
    }
    return {
      width: Math.max(options.width, MIN_TEXT_BOX_SIZE),
      height: Math.max(wrappedLines.length, 1) * lineHeightPx,
    };
  }

  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(
      maxWidth,
      measureTextWidth(ctx, line, options.fontSize),
    );
  }
  return {
    width: Math.max(maxWidth + 2, MIN_TEXT_BOX_SIZE),
    height: Math.max(lines.length, 1) * lineHeightPx,
  };
}

export function getTextContent(node: PenNode): string {
  const record = node as unknown as Record<string, unknown>;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((segment) =>
        segment && typeof segment === "object" && "text" in segment
          ? String((segment as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

export function getFirstSolidFillColor(
  node: PenNode,
  fallback = "#111827",
): string {
  const fills = (node as { fill?: Array<{ type?: string; color?: string }> })
    .fill;
  const first = Array.isArray(fills) ? fills[0] : undefined;
  return first?.type === "solid" && typeof first.color === "string"
    ? first.color
    : fallback;
}

export function getFontFamilyDisplayName(fontFamily: string): string {
  const firstFamily = fontFamily.split(",")[0]?.trim();
  if (!firstFamily) return "字体";
  return firstFamily.replace(/^["']|["']$/g, "");
}

export function sortLocalFontFamilies(families: Iterable<string>): string[] {
  return Array.from(new Set(families))
    .filter((family) => family.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
