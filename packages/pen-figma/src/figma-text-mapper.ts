// @ts-nocheck
import type { TextNode } from "@cucumber/pen-types";
import type { StyledTextSegment } from "@cucumber/pen-types";
import { figmaColorToHex } from "./figma-color-utils.js";
import { mapFigmaFills } from "./figma-fill-mapper.js";
import type { FigmaNodeChange } from "./figma-types.js";

/**
 * Map Figma .fig internal text properties to PenNode TextNode partial.
 */
export function mapFigmaTextProps(
  node: FigmaNodeChange,
): Pick<
  TextNode,
  | "content"
  | "fontFamily"
  | "fontPostScriptName"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "letterSpacing"
  | "lineHeight"
  | "paragraphSpacing"
  | "listStyle"
  | "indent"
  | "hangingIndent"
  | "baselineShift"
  | "openTypeFeatures"
  | "fontFallback"
  | "textAlign"
  | "textAlignVertical"
  | "textGrowth"
  | "underline"
  | "strikethrough"
  | "textCase"
> {
  const result: ReturnType<typeof mapFigmaTextProps> = {
    content: applyTextCase(buildContent(node), node.textCase),
    fontFamily: node.fontName?.family,
    fontPostScriptName: node.fontName?.postscript,
    fontSize: node.fontSize,
    fontWeight: parseFontWeight(node.fontName?.style),
    fontStyle: node.fontName?.style?.toLowerCase().includes("italic")
      ? "italic"
      : undefined,
    letterSpacing: mapLetterSpacing(node),
    lineHeight: mapLineHeight(node),
    paragraphSpacing: node.paragraphSpacing,
    listStyle: mapListStyle(node),
    indent: node.paragraphIndent,
    hangingIndent: node.hangingIndent ?? node.listSpacing,
    baselineShift: node.baselineShift,
    openTypeFeatures: mapOpenTypeFeatures(node),
    fontFallback: mapFontFallback(node),
    textAlign: mapTextAlign(node.textAlignHorizontal),
    textAlignVertical: mapTextAlignVertical(node.textAlignVertical),
    textGrowth: mapTextGrowth(node.textAutoResize),
    textCase: mapTextCase(node.textCase),
  };

  if (node.textDecoration === "UNDERLINE") result.underline = true;
  if (node.textDecoration === "STRIKETHROUGH") result.strikethrough = true;

  return result;
}

function applyTextCase(
  content: string | StyledTextSegment[],
  textCase?: string,
): string | StyledTextSegment[] {
  if (!textCase || textCase === "ORIGINAL") return content;

  const transform = (text: string): string => {
    switch (textCase) {
      case "UPPER":
        return text.toUpperCase();
      case "LOWER":
        return text.toLowerCase();
      case "TITLE":
        return text.replace(/\b\w/g, (c) => c.toUpperCase());
      default:
        return text;
    }
  };

  if (typeof content === "string") {
    return transform(content);
  }

  return content.map((seg) =>
    seg.textCase ? seg : { ...seg, text: transform(seg.text) },
  );
}

function applyTextCaseToString(text: string, textCase?: string): string {
  if (!textCase || textCase === "ORIGINAL") return text;
  switch (textCase) {
    case "UPPER":
      return text.toUpperCase();
    case "LOWER":
      return text.toLowerCase();
    case "TITLE":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

function buildContent(node: FigmaNodeChange): string | StyledTextSegment[] {
  const textData = node.textData;
  if (!textData?.characters) return "";

  const text = textData.characters;
  const styleIds = textData.characterStyleIDs;
  const table = textData.styleOverrideTable;

  if (!styleIds || !table || styleIds.length === 0 || table.length === 0) {
    return text;
  }

  // Build segments from character style IDs
  const segments: StyledTextSegment[] = [];
  let currentStyleId = styleIds[0] ?? 0;
  let segStart = 0;

  for (let i = 1; i <= text.length; i++) {
    const styleId = i < styleIds.length ? styleIds[i] : -1;
    if (styleId !== currentStyleId || i === text.length) {
      const endIdx = i === text.length ? text.length : i;
      const segText = text.slice(segStart, endIdx);
      if (segText) {
        const segment = buildSegment(segText, currentStyleId, table);
        segments.push(segment);
      }
      currentStyleId = styleId;
      segStart = i;
    }
  }

  // If all segments have no style overrides, return plain string
  if (
    segments.every(
      (s) =>
        !s.fontFamily &&
        !s.fontSize &&
        !s.fontWeight &&
        !s.fill &&
        !s.fills,
    )
  ) {
    return text;
  }

  return segments;
}

function buildSegment(
  text: string,
  styleId: number,
  table: FigmaNodeChange[],
): StyledTextSegment {
  if (styleId === 0) return { text };

  // styleOverrideTable is 0-indexed but style IDs start from 1 in some cases
  const override = table[styleId] ?? table[styleId - 1];
  if (!override) return { text };

  const segment: StyledTextSegment = { text };
  if (override.fontName?.family) segment.fontFamily = override.fontName.family;
  if (override.fontName?.postscript)
    segment.fontPostScriptName = override.fontName.postscript;
  if (override.fontSize) segment.fontSize = override.fontSize;
  const weight = parseFontWeight(override.fontName?.style);
  if (weight) segment.fontWeight = weight;
  if (override.fontName?.style?.toLowerCase().includes("italic")) {
    segment.fontStyle = "italic";
  }
  if (override.textDecoration === "UNDERLINE") segment.underline = true;
  if (override.textDecoration === "STRIKETHROUGH") segment.strikethrough = true;
  if (override.textCase) {
    segment.textCase = mapTextCase(override.textCase);
    segment.text = applyTextCaseToString(segment.text, override.textCase);
  }
  if (override.lineHeight) segment.lineHeight = mapLineHeight(override);
  if (override.letterSpacing) segment.letterSpacing = mapLetterSpacing(override);
  if (override.baselineShift !== undefined) {
    segment.baselineShift = override.baselineShift;
  }
  const fallback = mapFontFallback(override);
  if (fallback) segment.fontFallback = fallback;
  const openTypeFeatures = mapOpenTypeFeatures(override);
  if (openTypeFeatures) segment.openTypeFeatures = openTypeFeatures;

  const segmentFills = mapFigmaFills(override.fillPaints);
  if (segmentFills) {
    segment.fills = segmentFills;
  }

  // Legacy text fill color shortcut for code paths that cannot consume paint stacks.
  const firstSolidFill = override.fillPaints?.find(
    (paint) => paint.visible !== false && paint.type === "SOLID" && paint.color,
  );
  if (firstSolidFill?.color) {
    segment.fill = figmaColorToHex(firstSolidFill.color);
  }

  return segment;
}

function mapListStyle(node: FigmaNodeChange): TextNode["listStyle"] {
  const raw =
    node.listStyle ?? node.listType ?? (node.hangingList as any)?.type ?? "NONE";
  switch (raw) {
    case "ORDERED":
      return "ordered";
    case "UNORDERED":
      return "unordered";
    case "NONE":
      return undefined;
    default:
      return undefined;
  }
}

function mapOpenTypeFeatures(
  node: FigmaNodeChange,
): TextNode["openTypeFeatures"] {
  const features = node.openTypeFeatures ?? node.opentypeFlags;
  return features && Object.keys(features).length > 0 ? features : undefined;
}

function mapFontFallback(node: FigmaNodeChange): string[] | undefined {
  const fallbackNames = node.fontFallbacks ?? node.fallbackFontNames;
  const families =
    fallbackNames
      ?.map((font) => font.family ?? font.postscript)
      .filter((font): font is string => Boolean(font)) ?? [];
  return families.length > 0 ? families : undefined;
}

function mapTextCase(textCase?: string): TextNode["textCase"] {
  switch (textCase) {
    case "ORIGINAL":
      return "original";
    case "UPPER":
      return "upper";
    case "LOWER":
      return "lower";
    case "TITLE":
      return "title";
    default:
      return undefined;
  }
}

function parseFontWeight(style?: string): number | undefined {
  if (!style) return undefined;
  const lower = style.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, "");
  if (lower.includes("thin") || lower.includes("hairline")) return 100;
  if (compact.includes("extralight") || compact.includes("ultralight"))
    return 200;
  if (lower.includes("light")) return 300;
  if (lower.includes("regular") || lower.includes("normal")) return 400;
  if (lower.includes("medium")) return 500;
  if (compact.includes("semibold") || compact.includes("demibold"))
    return 600;
  if (compact.includes("extrabold") || compact.includes("ultrabold"))
    return 800;
  if (lower.includes("bold")) return 700;
  if (lower.includes("black") || lower.includes("heavy")) return 900;
  return undefined;
}

function mapLineHeight(node: FigmaNodeChange): number | undefined {
  if (!node.lineHeight) return undefined;
  const fontSize = node.fontSize ?? 14;
  // PenNode lineHeight is a MULTIPLIER (e.g. 1.5), not absolute pixels.
  // drawText computes final px as: lineHeight * fontSize.
  if (node.lineHeight.units === "PIXELS" && node.lineHeight.value) {
    // Convert absolute pixels to multiplier (e.g. 24px / 16px = 1.5)
    const mul = node.lineHeight.value / fontSize;
    return Math.round(mul * 1000) / 1000;
  }
  if (node.lineHeight.units === "PERCENT" && node.lineHeight.value) {
    // Convert percentage to multiplier (e.g. 150% = 1.5)
    return Math.round((node.lineHeight.value / 100) * 1000) / 1000;
  }
  if (node.lineHeight.units === "RAW" && node.lineHeight.value) {
    // RAW is already a multiplier
    return Math.round(node.lineHeight.value * 1000) / 1000;
  }
  return undefined;
}

function mapLetterSpacing(node: FigmaNodeChange): number | undefined {
  if (!node.letterSpacing) return undefined;
  if (node.letterSpacing.units === "PIXELS" && node.letterSpacing.value) {
    return node.letterSpacing.value;
  }
  // Percentage letter spacing: relative to font size
  if (node.letterSpacing.units === "PERCENT" && node.letterSpacing.value) {
    const fontSize = node.fontSize ?? 14;
    return (
      Math.round(((fontSize * node.letterSpacing.value) / 100) * 100) / 100
    );
  }
  return undefined;
}

function mapTextAlign(align?: string): TextNode["textAlign"] {
  switch (align) {
    case "LEFT":
      return "left";
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "JUSTIFIED":
      return "justify";
    default:
      return undefined;
  }
}

function mapTextAlignVertical(align?: string): TextNode["textAlignVertical"] {
  switch (align) {
    case "TOP":
      return "top";
    case "CENTER":
      return "middle";
    case "BOTTOM":
      return "bottom";
    default:
      return undefined;
  }
}

function mapTextGrowth(resize?: string): TextNode["textGrowth"] {
  switch (resize) {
    case "WIDTH_AND_HEIGHT":
      return "auto";
    case "HEIGHT":
      return "fixed-width";
    case "NONE":
      return "fixed-width-height";
    default:
      return undefined;
  }
}
