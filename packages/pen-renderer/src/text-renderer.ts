import { cssFontFamily, defaultLineHeight } from "@cucumber/pen-core";
import type { PenNode, StyledTextSegment, TextNode } from "@cucumber/pen-types";
import type { PenEffect, ShadowEffect } from "@cucumber/pen-types";
import type {
  Canvas,
  CanvasKit,
  Paragraph,
  Image as SkImage,
  TextStyle,
} from "canvaskit-wasm";
import { type FontManagerOptions, SkiaFontManager } from "./font-manager.js";
import { parseColor, resolveFillColor, wrapLine } from "./paint-utils.js";

interface CanvasKitSurface {
  getCanvas(): Canvas;
  makeImageSnapshot(): SkImage | null;
  delete(): void;
}

type CanvasKitWithSurface = CanvasKit & {
  MakeSurface?: (width: number, height: number) => CanvasKitSurface | null;
};

type TextCase =
  | NonNullable<TextNode["textCase"]>
  | NonNullable<StyledTextSegment["textCase"]>;

interface TextParagraphLayoutOptions {
  listStyle?: TextNode["listStyle"];
  indent?: number;
  hangingIndent?: number;
  fontSize?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
}

export interface BitmapTextRun {
  text: string;
  fontSize: number;
  fontWeight: number | string;
  fontFamily: string;
  fontStyle?: "normal" | "italic";
  fillColor: string;
  baselineShift?: number;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface BitmapTextLine {
  text: string;
  runs: BitmapTextRun[];
}

export interface BitmapRootTextStyle {
  fontSize: number;
  fontWeight: number | string;
  fontFamily: string;
  fillColor: string;
  underline?: boolean;
  strikethrough?: boolean;
}

export function getTextVerticalOffset(
  align: TextNode["textAlignVertical"] | undefined,
  boxHeight: number,
  contentHeight: number,
): number {
  if (boxHeight <= 0 || contentHeight <= 0 || contentHeight >= boxHeight) {
    return 0;
  }

  const freeSpace = boxHeight - contentHeight;
  if (align === "middle") return freeSpace / 2;
  if (align === "bottom") return freeSpace;
  return 0;
}

export function getTextParagraphPrefix(
  paragraphIndex: number,
  options: TextParagraphLayoutOptions,
): string {
  const fontSize = Math.max(1, options.fontSize ?? 16);
  const indent = Math.max(0, options.indent ?? 0);
  const hangingIndent = Math.max(0, options.hangingIndent ?? 0);
  const effectiveIndent = Math.max(0, indent - hangingIndent);
  const indentSpaces = Math.min(
    32,
    Math.round(effectiveIndent / (fontSize * 0.5)),
  );
  const spacer = " ".repeat(indentSpaces);

  if (options.listStyle === "unordered") return `${spacer}• `;
  if (options.listStyle === "ordered")
    return `${spacer}${paragraphIndex + 1}. `;
  return spacer;
}

export function applyTextParagraphLayout(
  text: string,
  options: TextParagraphLayoutOptions,
): string {
  if (!options.listStyle && !options.indent && !options.paragraphSpacing) {
    return text;
  }

  let paragraphIndex = 0;
  const spacingBreaks = getParagraphSpacingBreaks(options);
  const lines = text.split("\n");
  const result: string[] = [];
  lines.forEach((line, index) => {
    if (!line) {
      result.push(line);
      return;
    }
    const prefix = getTextParagraphPrefix(paragraphIndex, options);
    paragraphIndex += 1;
    result.push(`${prefix}${line}`);

    const nextLine = lines[index + 1];
    if (spacingBreaks > 0 && nextLine !== undefined && nextLine) {
      for (let i = 0; i < spacingBreaks; i++) result.push("");
    }
  });
  return result.join("\n");
}

function applyStyledTextParagraphLayout(
  segments: StyledTextSegment[],
  options: TextParagraphLayoutOptions,
): StyledTextSegment[] {
  if (!options.listStyle && !options.indent && !options.paragraphSpacing) {
    return segments;
  }

  let paragraphIndex = 0;
  let atLineStart = true;
  const spacingBreaks = getParagraphSpacingBreaks(options);
  return segments.map((segment) => {
    const parts = (segment.text ?? "").split(/(\n)/);
    let text = "";
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex] ?? "";
      if (part === "\n") {
        text += part;
        atLineStart = true;
        continue;
      }
      if (!part) continue;
      if (atLineStart) {
        text += getTextParagraphPrefix(paragraphIndex, options);
        paragraphIndex += 1;
        atLineStart = false;
      }
      text += part;
      if (
        spacingBreaks > 0 &&
        part &&
        parts[partIndex + 1] === "\n" &&
        parts[partIndex + 2]
      ) {
        text += "\n".repeat(spacingBreaks);
      }
    }
    return { ...segment, text };
  });
}

export function getTextBaselineOffset(baselineShift?: number): number {
  return baselineShift ? -baselineShift : 0;
}

export function withTextBaselineShift<T extends TextStyle>(
  style: T,
  baselineShift?: number,
): T & { baselineShift?: number } {
  const offset = getTextBaselineOffset(baselineShift);
  if (offset === 0) return style;
  return { ...style, baselineShift: offset };
}

export function buildBitmapStyledTextLines(
  segments: StyledTextSegment[],
  rootStyle: BitmapRootTextStyle,
): BitmapTextLine[] {
  const lines: BitmapTextLine[] = [{ text: "", runs: [] }];

  for (const segment of segments) {
    const fillColor = segment.fills
      ? resolveFillColor(segment.fills)
      : (segment.fill ?? rootStyle.fillColor);
    const runStyle = {
      fontSize: segment.fontSize ?? rootStyle.fontSize,
      fontWeight: segment.fontWeight ?? rootStyle.fontWeight,
      fontFamily: segment.fontFamily ?? rootStyle.fontFamily,
      fontStyle: segment.fontStyle,
      fillColor,
      baselineShift: segment.baselineShift,
      underline: segment.underline ?? rootStyle.underline,
      strikethrough: segment.strikethrough ?? rootStyle.strikethrough,
    };
    const parts = (segment.text ?? "").split(/(\n)/);
    for (const part of parts) {
      if (part === "\n") {
        lines.push({ text: "", runs: [] });
        continue;
      }
      if (!part) continue;
      let line = lines.at(-1);
      if (!line) {
        line = { text: "", runs: [] };
        lines.push(line);
      }
      line.text += part;
      line.runs.push({ ...runStyle, text: part });
    }
  }

  return lines.length > 0 ? lines : [{ text: "", runs: [] }];
}

function getParagraphSpacingBreaks(
  options: TextParagraphLayoutOptions,
): number {
  const spacing = Math.max(0, options.paragraphSpacing ?? 0);
  if (spacing === 0) return 0;
  const fontSize = Math.max(1, options.fontSize ?? 16);
  const lineHeight = Math.max(fontSize, (options.lineHeight ?? 1.2) * fontSize);
  return Math.min(8, Math.max(1, Math.round(spacing / lineHeight)));
}

/**
 * Text rendering sub-system for SkiaNodeRenderer.
 * Handles both vector (Paragraph API) and bitmap (Canvas 2D) text rendering
 * with caching for performance.
 */
export class SkiaTextRenderer {
  private ck: CanvasKit;

  // Text rasterization cache (Canvas 2D -> CanvasKit Image)
  // FIFO eviction via Map insertion order; bytes tracked separately against TEXT_CACHE_BYTE_LIMIT.
  private textCache = new Map<string, SkImage | null>();
  private textCacheBytes = 0;
  // 256 MB — each bitmap entry is ~cw*ch*4 bytes (RGBA pixels)
  private static TEXT_CACHE_BYTE_LIMIT = 256 * 1024 * 1024;

  // Paragraph cache for vector text (keyed by content+style)
  // FIFO eviction via Map insertion order; bytes estimated from content length against PARA_CACHE_BYTE_LIMIT.
  private paraCache = new Map<string, Paragraph | null>();
  private paraCacheBytes = 0;
  // 64 MB — each entry is estimated as content.length*64+4096 bytes (WASM heap approximation)
  private static PARA_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;

  // Pre-rasterized paragraph image cache (SkImage, same key as paraCache, zoom-independent)
  // Allows drawImageRect instead of drawParagraph on every frame — avoids per-frame glyph rasterization.
  private paraImageCache = new Map<string, SkImage | null>();
  private paraImageCacheBytes = 0;
  // 128 MB — each entry is sw*sh*4 bytes (RGBA pixels at up to 2x DPR scale)
  private static PARA_IMAGE_CACHE_BYTE_LIMIT = 128 * 1024 * 1024;

  private static estimateParaBytes(content: string): number {
    return content.length * 64 + 4096;
  }

  // Current viewport zoom (set by engine before each render frame)
  zoom = 1;

  // Device pixel ratio override
  devicePixelRatio: number | undefined;

  private get _dpr(): number {
    return (
      this.devicePixelRatio ??
      (typeof window !== "undefined" ? window.devicePixelRatio : 1) ??
      1
    );
  }

  // Font manager for vector text rendering
  fontManager: SkiaFontManager;
  _onFontLoaded?: () => void;

  constructor(ck: CanvasKit, fontOptions?: FontManagerOptions) {
    this.ck = ck;
    this.fontManager = new SkiaFontManager(ck, fontOptions);
  }

  private mapFontWeight(weight: number) {
    const ck = this.ck;
    if (weight <= 100) return ck.FontWeight.Thin;
    if (weight <= 200) return ck.FontWeight.ExtraLight;
    if (weight <= 300) return ck.FontWeight.Light;
    if (weight <= 400) return ck.FontWeight.Normal;
    if (weight <= 500) return ck.FontWeight.Medium;
    if (weight <= 600) return ck.FontWeight.SemiBold;
    if (weight <= 700) return ck.FontWeight.Bold;
    if (weight <= 800) return ck.FontWeight.ExtraBold;
    return ck.FontWeight.Black;
  }

  private mapFontStyle(style?: "normal" | "italic", weight?: number) {
    return {
      weight: this.mapFontWeight(weight ?? 400),
      slant:
        style === "italic"
          ? this.ck.FontSlant.Italic
          : this.ck.FontSlant.Upright,
    };
  }

  private mapTextDecoration(
    underline?: boolean,
    strikethrough?: boolean,
  ): number | undefined {
    let decoration = this.ck.NoDecoration;
    if (underline) decoration |= this.ck.UnderlineDecoration;
    if (strikethrough) decoration |= this.ck.LineThroughDecoration;
    return decoration === this.ck.NoDecoration ? undefined : decoration;
  }

  private mapOpenTypeFeatures(
    features?: Record<string, boolean | number>,
  ): { name: string; value: number }[] | undefined {
    if (!features) return undefined;
    const mapped = Object.entries(features).map(([name, value]) => ({
      name,
      value: typeof value === "boolean" ? (value ? 1 : 0) : value,
    }));
    return mapped.length > 0 ? mapped : undefined;
  }

  private applyTextCase(text: string, textCase?: TextCase): string {
    switch (textCase) {
      case "upper":
        return text.toUpperCase();
      case "lower":
        return text.toLowerCase();
      case "title":
        return text.replace(/\b\w/g, (char) => char.toUpperCase());
      default:
        return text;
    }
  }

  private getStyledSegments(tNode: TextNode): StyledTextSegment[] | null {
    if (!Array.isArray(tNode.content)) return null;
    const segments = tNode.content.map((segment) => ({
      ...segment,
      text: this.applyTextCase(
        segment.text ?? "",
        segment.textCase ?? tNode.textCase,
      ),
    }));
    return applyStyledTextParagraphLayout(segments, {
      listStyle: tNode.listStyle,
      indent: tNode.indent,
      hangingIndent: tNode.hangingIndent,
      fontSize: tNode.fontSize,
      lineHeight: tNode.lineHeight,
      paragraphSpacing: tNode.paragraphSpacing,
    });
  }

  private getTextContent(tNode: TextNode): string {
    if (typeof tNode.content === "string") {
      return applyTextParagraphLayout(
        this.applyTextCase(tNode.content, tNode.textCase),
        {
          listStyle: tNode.listStyle,
          indent: tNode.indent,
          hangingIndent: tNode.hangingIndent,
          fontSize: tNode.fontSize,
          lineHeight: tNode.lineHeight,
          paragraphSpacing: tNode.paragraphSpacing,
        },
      );
    }
    if (Array.isArray(tNode.content)) {
      return (
        this.getStyledSegments(tNode)
          ?.map((segment) => segment.text ?? "")
          .join("") ?? ""
      );
    }
    return ((tNode as unknown as Record<string, unknown>).text as string) ?? "";
  }

  private hasSegmentStyle(segment: StyledTextSegment): boolean {
    return Boolean(
      segment.fontFamily ||
        segment.fontPostScriptName ||
        segment.fontSize ||
        segment.fontWeight ||
        segment.fontStyle ||
        segment.fill ||
        segment.fills ||
        segment.lineHeight ||
        segment.letterSpacing ||
        segment.underline ||
        segment.strikethrough ||
        segment.baselineShift ||
        segment.fontFallback?.length ||
        segment.openTypeFeatures,
    );
  }

  private getBitmapCanvasFont(
    fontWeight: number | string,
    fontSize: number,
    fontFamily: string,
    fontStyle?: "normal" | "italic",
  ): string {
    const stylePrefix = fontStyle === "italic" ? "italic " : "";
    return `${stylePrefix}${fontWeight} ${fontSize}px ${cssFontFamily(fontFamily)}`;
  }

  private measureBitmapStyledLine(
    ctx: CanvasRenderingContext2D,
    line: BitmapTextLine,
  ): number {
    let width = 0;
    for (const run of line.runs) {
      ctx.font = this.getBitmapCanvasFont(
        run.fontWeight,
        run.fontSize,
        run.fontFamily,
        run.fontStyle,
      );
      width += ctx.measureText(run.text).width;
    }
    return width;
  }

  private drawBitmapStyledLine(
    ctx: CanvasRenderingContext2D,
    line: BitmapTextLine,
    x: number,
    y: number,
  ) {
    let tx = x;
    for (const run of line.runs) {
      ctx.font = this.getBitmapCanvasFont(
        run.fontWeight,
        run.fontSize,
        run.fontFamily,
        run.fontStyle,
      );
      ctx.fillStyle = run.fillColor;
      const runY = y + getTextBaselineOffset(run.baselineShift);
      const runWidth = ctx.measureText(run.text).width;
      ctx.fillText(run.text, tx, runY);
      this.drawBitmapTextDecorations(ctx, {
        x: tx,
        y: runY,
        width: runWidth,
        fontSize: run.fontSize,
        color: run.fillColor,
        underline: run.underline,
        strikethrough: run.strikethrough,
      });
      tx += runWidth;
    }
  }

  private drawBitmapTextDecorations(
    ctx: CanvasRenderingContext2D,
    options: {
      x: number;
      y: number;
      width: number;
      fontSize: number;
      color: string;
      underline?: boolean;
      strikethrough?: boolean;
    },
  ) {
    if (!options.underline && !options.strikethrough) return;
    if (options.width <= 0) return;

    ctx.save();
    ctx.strokeStyle = options.color;
    ctx.lineWidth = Math.max(1, options.fontSize / 16);
    ctx.beginPath();
    if (options.underline) {
      const underlineY = options.y + options.fontSize * 0.92;
      ctx.moveTo(options.x, underlineY);
      ctx.lineTo(options.x + options.width, underlineY);
    }
    if (options.strikethrough) {
      const strikeY = options.y + options.fontSize * 0.52;
      ctx.moveTo(options.x, strikeY);
      ctx.lineTo(options.x + options.width, strikeY);
    }
    ctx.stroke();
    ctx.restore();
  }

  private ensureVectorFont(
    primaryFamily: string,
    postScriptName?: string,
  ): boolean {
    if (
      this.fontManager.isFontReady(primaryFamily) ||
      this.fontManager.isPostScriptFontReady(postScriptName)
    ) {
      return true;
    }

    if (this.fontManager.isSystemFont(primaryFamily) && !postScriptName) {
      return false;
    }

    this.fontManager
      .ensureFontByPostScript(postScriptName, primaryFamily)
      .then((ok) => {
        if (ok) {
          this.clearParaCache();
          this._onFontLoaded?.();
        }
      });

    return this.fontManager.hasAnyFallback(primaryFamily);
  }

  clearTextCache() {
    for (const img of this.textCache.values()) {
      img?.delete();
    }
    this.textCache.clear();
    this.textCacheBytes = 0;
  }

  clearParaCache() {
    for (const p of this.paraCache.values()) {
      p?.delete();
    }
    this.paraCache.clear();
    this.paraCacheBytes = 0;
    for (const img of this.paraImageCache.values()) {
      img?.delete();
    }
    this.paraImageCache.clear();
    this.paraImageCacheBytes = 0;
  }

  // Evict oldest entries (Map head = first inserted) until there is room for `incoming` bytes.
  private evictParaCache(incoming: number) {
    while (
      this.paraCacheBytes + incoming > SkiaTextRenderer.PARA_CACHE_BYTE_LIMIT &&
      this.paraCache.size > 0
    ) {
      const entry = this.paraCache.entries().next().value;
      if (!entry) break;
      const [key, para] = entry;
      para?.delete();
      this.paraCache.delete(key);
      this.paraCacheBytes -= SkiaTextRenderer.estimateParaBytes(
        key.split("|")[1] ?? "",
      );
    }
  }

  private evictParaImageCache(incoming: number) {
    while (
      this.paraImageCacheBytes + incoming >
        SkiaTextRenderer.PARA_IMAGE_CACHE_BYTE_LIMIT &&
      this.paraImageCache.size > 0
    ) {
      const entry = this.paraImageCache.entries().next().value;
      if (!entry) break;
      const [key, img] = entry;
      if (img) {
        this.paraImageCacheBytes -= img.width() * img.height() * 4;
        img.delete();
      }
      this.paraImageCache.delete(key);
    }
  }

  private evictTextCache(incoming: number) {
    while (
      this.textCacheBytes + incoming > SkiaTextRenderer.TEXT_CACHE_BYTE_LIMIT &&
      this.textCache.size > 0
    ) {
      const entry = this.textCache.entries().next().value;
      if (!entry) break;
      const [key, img] = entry;
      if (img) {
        this.textCacheBytes -= img.width() * img.height() * 4;
        img.delete();
      }
      this.textCache.delete(key);
    }
  }

  dispose() {
    this.clearTextCache();
    this.clearParaCache();
    this.fontManager.dispose();
  }

  /**
   * Main text drawing entry — tries vector, falls back to bitmap.
   */
  drawText(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    effects?: PenEffect[],
  ) {
    // Draw text shadow as blurred copy of the text glyphs (not a rectangle)
    const shadows = effects?.filter(
      (e): e is ShadowEffect =>
        e.type === "shadow" &&
        !e.inner &&
        e.visible !== false &&
        (e.opacity ?? 1) > 0,
    );
    for (const shadow of shadows ?? []) {
      this.drawTextShadow(canvas, node, x, y, w, h, opacity, shadow);
    }

    // Try vector text first (true Skia Paragraph API)
    const vectorOk = this.drawTextVector(canvas, node, x, y, w, h, opacity);
    if (vectorOk) return;

    // Fallback to bitmap text rendering
    this.drawTextBitmap(canvas, node, x, y, w, h, opacity);
  }

  /**
   * Render text as true vector glyphs using CanvasKit's Paragraph API.
   * Returns true if rendered, false if font not available (caller should fallback).
   */
  drawTextVector(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ): boolean {
    const ck = this.ck;
    const tNode = node as TextNode;
    const styledSegments = this.getStyledSegments(tNode);
    const content = this.getTextContent(tNode);
    if (!content) return true;

    const fontSize = tNode.fontSize ?? 16;
    const fillColor = resolveFillColor(tNode.fill);
    const fontWeight = tNode.fontWeight ?? "400";
    const fontFamily = tNode.fontFamily ?? "Inter";
    const textAlign: string = tNode.textAlign ?? "left";
    const lineHeightMul = tNode.lineHeight ?? defaultLineHeight(fontSize);
    const textGrowth = tNode.textGrowth;
    const letterSpacing = tNode.letterSpacing ?? 0;

    const primaryFamily =
      fontFamily.split(",")[0]?.trim().replace(/['"]/g, "") || "Inter";
    if (!this.ensureVectorFont(primaryFamily, tNode.fontPostScriptName)) {
      return false;
    }
    const rootFallbackFamilies = [
      ...this.fontManager.getFallbackChain(
        primaryFamily,
        tNode.fontPostScriptName,
      ),
      ...(tNode.fontFallback ?? []),
    ];

    const isFixedWidth =
      textGrowth === "fixed-width" || textGrowth === "fixed-width-height";
    const fwTolerance = isFixedWidth
      ? Math.min(Math.ceil(w * 0.05), Math.ceil(fontSize * 0.5))
      : 0;
    const layoutWidth = isFixedWidth && w > 0 ? w + fwTolerance : 1e6;
    const effectiveAlign = isFixedWidth ? textAlign : "left";
    const segmentStyleKey = styledSegments
      ? JSON.stringify(
          styledSegments.map((segment) => ({
            text: segment.text,
            fontFamily: segment.fontFamily,
            fontPostScriptName: segment.fontPostScriptName,
            fontSize: segment.fontSize,
            fontWeight: segment.fontWeight,
            fontStyle: segment.fontStyle,
            fill: segment.fill,
            fills: segment.fills,
            lineHeight: segment.lineHeight,
            letterSpacing: segment.letterSpacing,
            underline: segment.underline,
            strikethrough: segment.strikethrough,
            baselineShift: segment.baselineShift,
            fontFallback: segment.fontFallback,
            openTypeFeatures: segment.openTypeFeatures,
          })),
        )
      : "";

    const cacheKey = `p|${content}|${fontSize}|${fillColor}|${fontWeight}|${fontFamily}|${tNode.fontPostScriptName ?? ""}|${effectiveAlign}|${Math.round(layoutWidth)}|${letterSpacing}|${lineHeightMul}|${tNode.textCase ?? ""}|${tNode.underline ? "u" : ""}|${tNode.strikethrough ? "s" : ""}|${segmentStyleKey}`;

    let para = this.paraCache.get(cacheKey);
    if (para === undefined) {
      const color = parseColor(ck, fillColor);

      let ckAlign = ck.TextAlign.Left;
      if (effectiveAlign === "center") ckAlign = ck.TextAlign.Center;
      else if (effectiveAlign === "right") ckAlign = ck.TextAlign.Right;
      else if (effectiveAlign === "justify") ckAlign = ck.TextAlign.Justify;

      const weightNum =
        typeof fontWeight === "number"
          ? fontWeight
          : Number.parseInt(fontWeight as string, 10) || 400;

      const paraStyle = new ck.ParagraphStyle({
        textAlign: ckAlign,
        textStyle: {
          color,
          fontSize,
          fontFamilies: rootFallbackFamilies,
          fontStyle: this.mapFontStyle(tNode.fontStyle, weightNum),
          letterSpacing,
          heightMultiplier: lineHeightMul,
          halfLeading: true,
          decoration: this.mapTextDecoration(
            tNode.underline,
            tNode.strikethrough,
          ),
          fontFeatures: this.mapOpenTypeFeatures(tNode.openTypeFeatures),
        },
      });

      try {
        const builder = ck.ParagraphBuilder.MakeFromFontProvider(
          paraStyle,
          this.fontManager.getProvider(),
        );

        // Handle styled segments
        if (styledSegments?.some((segment) => this.hasSegmentStyle(segment))) {
          for (const seg of styledSegments) {
            if (this.hasSegmentStyle(seg)) {
              const segFillColor = seg.fills
                ? resolveFillColor(seg.fills)
                : seg.fill;
              const segColor = segFillColor
                ? parseColor(ck, segFillColor)
                : color;
              const segWeight = seg.fontWeight
                ? typeof seg.fontWeight === "number"
                  ? seg.fontWeight
                  : Number.parseInt(seg.fontWeight as string, 10) || weightNum
                : weightNum;
              const segPrimary =
                seg.fontFamily?.split(",")[0]?.trim().replace(/['"]/g, "") ??
                primaryFamily;
              this.ensureVectorFont(segPrimary, seg.fontPostScriptName);
              const segFamilies = [
                ...this.fontManager.getFallbackChain(
                  segPrimary,
                  seg.fontPostScriptName,
                ),
                ...(seg.fontFallback ?? []),
              ];
              builder.pushStyle(
                new ck.TextStyle(
                  withTextBaselineShift(
                    {
                      color: segColor,
                      fontSize: seg.fontSize ?? fontSize,
                      fontFamilies: segFamilies,
                      fontStyle: this.mapFontStyle(seg.fontStyle, segWeight),
                      letterSpacing: seg.letterSpacing ?? letterSpacing,
                      heightMultiplier: seg.lineHeight ?? lineHeightMul,
                      halfLeading: true,
                      decoration: this.mapTextDecoration(
                        seg.underline ?? tNode.underline,
                        seg.strikethrough ?? tNode.strikethrough,
                      ),
                      fontFeatures: this.mapOpenTypeFeatures(
                        seg.openTypeFeatures,
                      ),
                    },
                    seg.baselineShift,
                  ),
                ),
              );
              builder.addText(seg.text ?? "");
              builder.pop();
            } else {
              builder.addText(seg.text ?? "");
            }
          }
        } else {
          builder.addText(content);
        }

        para = builder.build();
        para.layout(layoutWidth);
        builder.delete();
        const entryBytes = SkiaTextRenderer.estimateParaBytes(content);
        this.evictParaCache(entryBytes);
        this.paraCacheBytes += entryBytes;
      } catch {
        para = null;
      }

      this.paraCache.set(cacheKey, para ?? null);
    }

    if (!para) return false;

    // Compute drawX and surface dimensions
    let drawX = x;
    let surfaceW: number;
    if (!isFixedWidth) {
      const longestLine = para.getLongestLine();
      surfaceW = longestLine + 2;
      if (w > 0 && textAlign !== "left") {
        if (textAlign === "center")
          drawX = x + Math.max(0, (w - longestLine) / 2);
        else if (textAlign === "right")
          drawX = x + Math.max(0, w - longestLine);
      }
    } else {
      surfaceW = layoutWidth;
    }
    const surfaceH = para.getHeight() + 2;
    const drawY =
      y +
      getTextVerticalOffset(tNode.textAlignVertical, h, surfaceH) +
      getTextBaselineOffset(tNode.baselineShift);

    // Try paragraph image cache: drawImageRect is far cheaper than drawParagraph per frame.
    // Skip cache when zoomed in (> 1x) or significantly zoomed out (< 0.5x) — cached
    // bitmaps are at fixed DPR resolution and produce jagged edges when scaled by the
    // viewport transform. At normal zoom (0.5–1x), bitmap cache is safe and fast.
    const useParaImageCache = this.zoom >= 0.5 && this.zoom <= 1;
    // Always rasterize at 2x minimum — 1x bitmaps produce jagged text on low-DPR displays
    const imgScale = Math.max(this._dpr, 2);
    let cachedImg: SkImage | null | undefined = useParaImageCache
      ? this.paraImageCache.get(cacheKey)
      : null;
    if (useParaImageCache && cachedImg === undefined) {
      cachedImg = null;
      const sw = Math.min(Math.ceil(surfaceW * imgScale), 4096);
      const sh = Math.min(Math.ceil(surfaceH * imgScale), 4096);
      if (sw > 0 && sh > 0) {
        const surf = (ck as CanvasKitWithSurface).MakeSurface?.(sw, sh);
        if (surf) {
          const offCanvas = surf.getCanvas();
          offCanvas.scale(imgScale, imgScale);
          offCanvas.drawParagraph(para, 0, 0);
          cachedImg = (surf.makeImageSnapshot() as SkImage | null) ?? null;
          surf.delete();
          if (cachedImg) {
            const imgBytes = sw * sh * 4;
            this.evictParaImageCache(imgBytes);
            this.paraImageCacheBytes += imgBytes;
          }
        }
      }
      if (useParaImageCache) this.paraImageCache.set(cacheKey, cachedImg);
    }

    if (cachedImg) {
      const imgW = cachedImg.width() / imgScale;
      const imgH = cachedImg.height() / imgScale;
      const paint = new ck.Paint();
      paint.setAntiAlias(true);
      if (opacity < 1) paint.setAlphaf(opacity);
      canvas.drawImageRect(
        cachedImg,
        ck.LTRBRect(0, 0, cachedImg.width(), cachedImg.height()),
        ck.LTRBRect(drawX, drawY, drawX + imgW, drawY + imgH),
        paint,
      );
      paint.delete();
      return true;
    }

    // Fallback: surface creation failed, draw directly
    if (opacity < 1) {
      const paint = new ck.Paint();
      paint.setAlphaf(opacity);
      canvas.saveLayer(paint);
      paint.delete();
      canvas.drawParagraph(para, drawX, drawY);
      canvas.restore();
    } else {
      canvas.drawParagraph(para, drawX, drawY);
    }

    return true;
  }

  /**
   * Draw text shadow as a blurred copy of the actual text glyphs.
   */
  private drawTextShadow(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    shadow: ShadowEffect,
  ) {
    const ck = this.ck;
    const tNode = node as TextNode;
    const shadowOpacity = opacity * (shadow.opacity ?? 1);
    const shadowFillColor = shadow.color ?? "#00000066";
    const shadowNode = {
      ...tNode,
      fill: [{ type: "solid" as const, color: shadowFillColor }],
    } as PenNode;

    const sx = x + shadow.offsetX;
    const sy = y + shadow.offsetY;

    if (shadow.blur > 0) {
      const paint = new ck.Paint();
      if (shadowOpacity < 1) paint.setAlphaf(shadowOpacity);
      const sigma = shadow.blur / 2;
      const filter = ck.ImageFilter.MakeBlur(
        sigma,
        sigma,
        ck.TileMode.Decal,
        null,
      );
      paint.setImageFilter(filter);
      canvas.saveLayer(paint);
      paint.delete();

      const vectorOk = this.drawTextVector(canvas, shadowNode, sx, sy, w, h, 1);
      if (!vectorOk) {
        this.drawTextBitmap(canvas, shadowNode, sx, sy, w, h, 1);
      }

      canvas.restore();
    } else {
      const vectorOk = this.drawTextVector(
        canvas,
        shadowNode,
        sx,
        sy,
        w,
        h,
        shadowOpacity,
      );
      if (!vectorOk) {
        this.drawTextBitmap(canvas, shadowNode, sx, sy, w, h, shadowOpacity);
      }
    }
  }

  /** Bitmap text rendering fallback — supports all system fonts via Canvas 2D API. */
  drawTextBitmap(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const tNode = node as TextNode;
    const content = this.getTextContent(tNode);

    if (!content) return;

    const fontSize = tNode.fontSize ?? 16;
    const fillColor = resolveFillColor(tNode.fill);
    const fontWeight = tNode.fontWeight ?? "400";
    const fontFamily =
      tNode.fontFamily ??
      'Inter, -apple-system, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
    const textAlign: string = tNode.textAlign ?? "left";
    const lineHeightMul = tNode.lineHeight ?? defaultLineHeight(fontSize);
    const lineHeight = lineHeightMul * fontSize;
    const textGrowth = tNode.textGrowth;

    const isFixedWidth =
      textGrowth === "fixed-width" ||
      textGrowth === "fixed-width-height" ||
      (textGrowth !== "auto" &&
        textAlign !== "left" &&
        textAlign !== undefined);
    const shouldWrap = isFixedWidth && w > 0;
    const styledSegments = this.getStyledSegments(tNode);
    const bitmapStyledLines =
      !shouldWrap &&
      styledSegments?.some((segment) => this.hasSegmentStyle(segment))
        ? buildBitmapStyledTextLines(styledSegments, {
            fontSize,
            fontWeight,
            fontFamily,
            fillColor,
            underline: tNode.underline,
            strikethrough: tNode.strikethrough,
          })
        : undefined;

    const measureCanvas = document.createElement("canvas");
    const mCtx = measureCanvas.getContext("2d");
    if (!mCtx) return;
    mCtx.font = this.getBitmapCanvasFont(fontWeight, fontSize, fontFamily);

    const rawLines = content.split("\n");
    let wrappedLines: string[];
    let renderW: number;

    if (shouldWrap) {
      renderW = Math.max(w + fontSize * 0.2, 10);
      wrappedLines = [];
      for (const raw of rawLines) {
        if (!raw) {
          wrappedLines.push("");
          continue;
        }
        wrapLine(mCtx, raw, renderW, wrappedLines);
      }
    } else if (bitmapStyledLines) {
      wrappedLines = bitmapStyledLines.map((line) => line.text);
      let maxLineWidth = 0;
      for (const line of bitmapStyledLines) {
        maxLineWidth = Math.max(
          maxLineWidth,
          this.measureBitmapStyledLine(mCtx, line),
        );
      }
      renderW = Math.max(maxLineWidth + 2, w, 10);
    } else {
      wrappedLines = rawLines.length > 0 ? rawLines : [""];
      let maxLineWidth = 0;
      for (const line of wrappedLines) {
        if (line)
          maxLineWidth = Math.max(maxLineWidth, mCtx.measureText(line).width);
      }
      renderW = Math.max(maxLineWidth + 2, w, 10);
    }

    const FABRIC_FONT_MULT = 1.13;
    const glyphH = fontSize * FABRIC_FONT_MULT;
    const textH =
      wrappedLines.length <= 1
        ? glyphH + 2
        : (wrappedLines.length - 1) * lineHeight + glyphH + 2;
    const drawY =
      y +
      getTextVerticalOffset(tNode.textAlignVertical, h, textH) +
      getTextBaselineOffset(tNode.baselineShift);

    const rawScale = this.zoom * this._dpr;
    const scale = rawScale <= 2 ? 2 : rawScale <= 4 ? 4 : 8;

    const styledCacheKey = bitmapStyledLines
      ? JSON.stringify(bitmapStyledLines)
      : "";
    const cacheKey = `${content}|${styledCacheKey}|${fontSize}|${fillColor}|${fontWeight}|${fontFamily}|${textAlign}|${tNode.underline ? "u" : ""}|${tNode.strikethrough ? "s" : ""}|${Math.round(renderW)}|${Math.round(textH)}|${scale}`;

    let img = this.textCache.get(cacheKey);
    if (img === undefined) {
      let effectiveScale = scale;
      let cw = Math.ceil(renderW * effectiveScale);
      let ch = Math.ceil(textH * effectiveScale);
      if (cw <= 0 || ch <= 0) {
        this.textCache.set(cacheKey, null);
        return;
      }
      const MAX_TEX = 4096;
      if (cw > MAX_TEX || ch > MAX_TEX) {
        effectiveScale = Math.min(
          MAX_TEX / renderW,
          MAX_TEX / textH,
          effectiveScale,
        );
        cw = Math.ceil(renderW * effectiveScale);
        ch = Math.ceil(textH * effectiveScale);
      }

      const tmp = document.createElement("canvas");
      tmp.width = cw;
      tmp.height = ch;
      const ctx = tmp.getContext("2d");
      if (!ctx) {
        this.textCache.set(cacheKey, null);
        return;
      }
      ctx.scale(effectiveScale, effectiveScale);
      ctx.font = this.getBitmapCanvasFont(fontWeight, fontSize, fontFamily);
      ctx.fillStyle = fillColor;
      ctx.textBaseline = "top";
      ctx.textAlign = bitmapStyledLines
        ? "left"
        : ((textAlign || "left") as CanvasTextAlign);

      let cy = 0;
      if (bitmapStyledLines) {
        for (const line of bitmapStyledLines) {
          if (!line.text) {
            cy += lineHeight;
            continue;
          }
          const lineWidth = this.measureBitmapStyledLine(ctx, line);
          let tx = 0;
          if (textAlign === "center")
            tx = Math.max(0, (renderW - lineWidth) / 2);
          else if (textAlign === "right") tx = Math.max(0, renderW - lineWidth);
          this.drawBitmapStyledLine(ctx, line, tx, cy);
          cy += lineHeight;
        }
      } else {
        for (const line of wrappedLines) {
          if (!line) {
            cy += lineHeight;
            continue;
          }
          let tx = 0;
          if (textAlign === "center") tx = renderW / 2;
          else if (textAlign === "right") tx = renderW;
          ctx.fillText(line, tx, cy);
          const lineWidth = ctx.measureText(line).width;
          const decorationX =
            textAlign === "center"
              ? tx - lineWidth / 2
              : textAlign === "right"
                ? tx - lineWidth
                : tx;
          this.drawBitmapTextDecorations(ctx, {
            x: decorationX,
            y: cy,
            width: lineWidth,
            fontSize,
            color: fillColor,
            underline: tNode.underline,
            strikethrough: tNode.strikethrough,
          });
          cy += lineHeight;
        }
      }

      const imageData = ctx.getImageData(0, 0, cw, ch);
      // Premultiply alpha for correct CanvasKit texture blending
      const src = imageData.data;
      const premul = new Uint8Array(src.length);
      for (let p = 0; p < premul.length; p += 4) {
        const a = src[p + 3] ?? 0;
        if (a === 255) {
          premul[p] = src[p] ?? 0;
          premul[p + 1] = src[p + 1] ?? 0;
          premul[p + 2] = src[p + 2] ?? 0;
          premul[p + 3] = 255;
        } else if (a > 0) {
          const f = a / 255;
          premul[p] = Math.round((src[p] ?? 0) * f);
          premul[p + 1] = Math.round((src[p + 1] ?? 0) * f);
          premul[p + 2] = Math.round((src[p + 2] ?? 0) * f);
          premul[p + 3] = a;
        }
      }
      img =
        ck.MakeImage(
          {
            width: cw,
            height: ch,
            alphaType: ck.AlphaType.Premul,
            colorType: ck.ColorType.RGBA_8888,
            colorSpace: ck.ColorSpace.SRGB,
          },
          premul,
          cw * 4,
        ) ?? null;

      const imgBytes = img ? cw * ch * 4 : 0;
      this.evictTextCache(imgBytes);
      this.textCache.set(cacheKey, img);
      this.textCacheBytes += imgBytes;
    }

    if (!img) return;

    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    if (opacity < 1) paint.setAlphaf(opacity);
    canvas.drawImageRect(
      img,
      ck.LTRBRect(0, 0, img.width(), img.height()),
      ck.LTRBRect(x, drawY, x + renderW, drawY + textH),
      paint,
    );
    paint.delete();
  }
}
