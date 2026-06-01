import {
  DEFAULT_FILL,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  buildEllipseArcPath,
  getPathBoundsFromAnchors,
  isArcEllipse,
  pathDataToAnchors,
} from "@cucumber/pen-core";
import type {
  BlendMode,
  ContainerProps,
  EllipseNode,
  IconFontNode,
  ImageNode,
  LineNode,
  PathNode,
  PenNode,
  PolygonNode,
} from "@cucumber/pen-types";
import type {
  DiamondGradientFill,
  GradientStop,
  ImageFill,
  LinearGradientFill,
  PenEffect,
  PenFill,
  PenStroke,
  ShadowEffect,
} from "@cucumber/pen-types";
import type {
  Canvas,
  CanvasKit,
  ColorFilter,
  Font,
  Paint,
  Shader,
  Typeface,
} from "canvaskit-wasm";
import type { FontManagerOptions, SkiaFontManager } from "./font-manager.js";
import { SkiaImageLoader } from "./image-loader.js";
import {
  cornerRadii,
  cornerRadiusValue,
  parseColor,
  resolveFillColor,
  resolveStrokeColor,
  resolveStrokeWidth,
  shouldUseTransparentFallbackFill,
} from "./paint-utils.js";
import {
  hasInvalidNumbers,
  sanitizeSvgPath,
  tryManualPathParse,
} from "./path-utils.js";
import { SkiaTextRenderer } from "./text-renderer.js";
import type { RendererInteractionMode } from "./types.js";
import type { IconLookupFn, RenderNode } from "./types.js";

const FALLBACK_ICON_D = "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0";
const PATH_CACHE_MAX = 768;

type SkiaPath = NonNullable<ReturnType<CanvasKit["Path"]["MakeFromSVGString"]>>;

type PathCacheEntry = {
  bounds: Float32Array;
  lastUsed: number;
  path: SkiaPath;
  rawD: string;
};

export type PathCacheSnapshot = {
  entries: number;
  evictions: number;
  hitRate: number;
  hits: number;
  misses: number;
};

type DeferredImageFillDraw = {
  fill: ImageFill;
  w: number;
  h: number;
  absX: number;
  absY: number;
  opacity: number;
};

const DIAMOND_GRADIENT_MAX_STOPS = 8;
const DIAMOND_GRADIENT_SKSL = `
uniform float2 u_center;
uniform float2 u_halfSize;
uniform float u_angle;
uniform float u_stopCount;
uniform float u_positions[${DIAMOND_GRADIENT_MAX_STOPS}];
uniform half4 u_colors[${DIAMOND_GRADIENT_MAX_STOPS}];

half4 main(float2 xy) {
  float2 safeHalf = max(u_halfSize, float2(0.0001, 0.0001));
  float2 p = (xy - u_center) / safeHalf;
  float s = sin(-u_angle);
  float c = cos(-u_angle);
  float2 rp = float2(c * p.x - s * p.y, s * p.x + c * p.y);
  float t = clamp((abs(rp.x) + abs(rp.y)) * 0.5, 0.0, 1.0);
  half4 color = u_colors[0];
  for (int i = 1; i < ${DIAMOND_GRADIENT_MAX_STOPS}; i++) {
    if (float(i) >= u_stopCount) {
      break;
    }
    float startPos = u_positions[i - 1];
    float endPos = max(u_positions[i], startPos + 0.0001);
    float localT = clamp((t - startPos) / (endPos - startPos), 0.0, 1.0);
    color = mix(u_colors[i - 1], u_colors[i], half(localT));
    if (t <= u_positions[i]) {
      return color;
    }
  }
  return color;
}`;

export function getVisibleBlurEffects(
  effects: PenEffect[] | undefined,
): import("@cucumber/pen-types").BlurEffect[] {
  return (
    effects?.filter(
      (e): e is import("@cucumber/pen-types").BlurEffect =>
        (e.type === "blur" || e.type === "background_blur") &&
        e.visible !== false &&
        (e.opacity ?? 1) > 0 &&
        e.radius > 0,
    ) ?? []
  );
}

export function getVisibleBackdropBlurEffects(
  effects: PenEffect[] | undefined,
): import("@cucumber/pen-types").BlurEffect[] {
  return getVisibleBlurEffects(effects).filter(
    (effect) => effect.type === "background_blur",
  );
}

export function getVisibleLayerBlurEffects(
  effects: PenEffect[] | undefined,
): import("@cucumber/pen-types").BlurEffect[] {
  return getVisibleBlurEffects(effects).filter(
    (effect) => effect.type === "blur",
  );
}

export function getVisibleFillLayers(
  fills: PenFill[] | string | undefined,
  stroke?: PenStroke,
  isContainer = false,
): Array<PenFill | string> {
  if (typeof fills === "string") return fills.length > 0 ? [fills] : [];
  const visibleFills =
    fills?.filter(
      (fill) => fill.visible !== false && (fill.opacity ?? 1) > 0,
    ) ?? [];
  if (visibleFills.length > 0) return [...visibleFills].reverse();
  return shouldUseTransparentFallbackFill(fills, stroke, isContainer)
    ? ["transparent"]
    : [];
}

export function getVisibleStrokePaintLayers(
  stroke: PenStroke | undefined,
): Array<PenFill | string> {
  if (!stroke || resolveStrokeWidth(stroke) <= 0) return [];
  if (stroke.fill) {
    return stroke.fill
      .filter((fill) => fill.visible !== false && (fill.opacity ?? 1) > 0)
      .reverse();
  }

  const strokeColor = resolveStrokeColor(stroke);
  return strokeColor ? [strokeColor] : [];
}

export function getLinearGradientEndpoints(
  fill: LinearGradientFill,
  bounds: { x: number; y: number; w: number; h: number },
): { x1: number; y1: number; x2: number; y2: number } {
  if (
    typeof fill.x1 === "number" &&
    typeof fill.y1 === "number" &&
    typeof fill.x2 === "number" &&
    typeof fill.y2 === "number"
  ) {
    return {
      x1: bounds.x + fill.x1 * bounds.w,
      y1: bounds.y + fill.y1 * bounds.h,
      x2: bounds.x + fill.x2 * bounds.w,
      y2: bounds.y + fill.y2 * bounds.h,
    };
  }

  const rad = (((fill.angle ?? 0) - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x1: bounds.x + bounds.w / 2 - (cos * bounds.w) / 2,
    y1: bounds.y + bounds.h / 2 - (sin * bounds.h) / 2,
    x2: bounds.x + bounds.w / 2 + (cos * bounds.w) / 2,
    y2: bounds.y + bounds.h / 2 + (sin * bounds.h) / 2,
  };
}

export function getAngularGradientSweepAngles(angle = 0): {
  startAngle: number;
  endAngle: number;
} {
  const startAngle = angle - 90;
  return {
    startAngle,
    endAngle: startAngle + 360,
  };
}

export function getDiamondGradientUniforms(
  fill: DiamondGradientFill,
  bounds: { x: number; y: number; w: number; h: number },
  colors: Float32Array[],
): number[] {
  const stops = fill.stops.slice(0, DIAMOND_GRADIENT_MAX_STOPS);
  const stopCount = Math.max(1, Math.min(stops.length, colors.length));
  const cx = bounds.x + (fill.cx ?? 0.5) * bounds.w;
  const cy = bounds.y + (fill.cy ?? 0.5) * bounds.h;
  const radius = fill.radius ?? 0.5;
  const halfW = Math.max(0.0001, bounds.w * radius);
  const halfH = Math.max(0.0001, bounds.h * radius);
  const angleRadians = (((fill.angle ?? 0) - 90) * Math.PI) / 180;
  const uniforms = [cx, cy, halfW, halfH, angleRadians, stopCount];

  for (let index = 0; index < DIAMOND_GRADIENT_MAX_STOPS; index += 1) {
    uniforms.push(Math.max(0, Math.min(1, stops[index]?.offset ?? 1)));
  }

  const fallbackColor = colors[colors.length - 1] ?? colors[0];
  for (let index = 0; index < DIAMOND_GRADIENT_MAX_STOPS; index += 1) {
    const color = colors[index] ?? fallbackColor;
    uniforms.push(
      color?.[0] ?? 0,
      color?.[1] ?? 0,
      color?.[2] ?? 0,
      color?.[3] ?? 1,
    );
  }

  return uniforms;
}

export function toCanvasKitNodeTransform(
  node: Pick<PenNode, "id" | "transform" | "x" | "y">,
  absX: number,
  absY: number,
): number[] | null {
  const transform = node.transform;
  if (!transform) return null;

  const values = [
    transform.m00,
    transform.m01,
    transform.m02,
    transform.m10,
    transform.m11,
    transform.m12,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `[pen-renderer] Invalid transform matrix for node ${node.id}`,
    );
  }

  // RenderNode.absX/absY is the canonical placement already used by
  // selection, hit testing, and clipping. Figma's m02/m12 is retained as import
  // metadata but must not become a second placement source.
  const translateX = absX - transform.m00 * absX - transform.m01 * absY;
  const translateY = absY - transform.m10 * absX - transform.m11 * absY;

  const matrix = [
    transform.m00,
    transform.m01,
    translateX,
    transform.m10,
    transform.m11,
    translateY,
    0,
    0,
    1,
  ];

  const isIdentity =
    Math.abs(transform.m00 - 1) <= 0.001 &&
    Math.abs(transform.m01) <= 0.001 &&
    Math.abs(translateX) <= 0.001 &&
    Math.abs(transform.m10) <= 0.001 &&
    Math.abs(transform.m11 - 1) <= 0.001 &&
    Math.abs(translateY) <= 0.001;
  return isIdentity ? null : matrix;
}

export function getImageFillTransformSourceRect(
  fill: Pick<ImageFill, "transform">,
  imgW: number,
  imgH: number,
): { left: number; top: number; right: number; bottom: number } | null {
  const transform = fill.transform;
  if (!transform) return null;

  // Figma stores cropped image fills as a normalized source rectangle in the
  // paint transform. Handle the common axis-aligned case first; skewed image
  // transforms can be added later without regressing simple crop fidelity.
  if (Math.abs(transform.m01) > 0.0001 || Math.abs(transform.m10) > 0.0001) {
    return null;
  }

  const left = clamp(transform.m02 * imgW, 0, imgW);
  const top = clamp(transform.m12 * imgH, 0, imgH);
  const right = clamp((transform.m02 + transform.m00) * imgW, 0, imgW);
  const bottom = clamp((transform.m12 + transform.m11) * imgH, 0, imgH);
  if (right - left <= 1 || bottom - top <= 1) return null;
  return { left, top, right, bottom };
}

export function getImageFillShaderMatrix(
  fill: Pick<ImageFill, "mode" | "transform">,
  imgW: number,
  imgH: number,
  bounds: { x: number; y: number; w: number; h: number },
): { matrix: number[]; tile: "clamp" | "repeat" } | null {
  if (imgW <= 0 || imgH <= 0) return null;
  const w = Math.max(1, bounds.w);
  const h = Math.max(1, bounds.h);
  const mode = fill.mode ?? "fill";

  if (fill.transform) {
    const { transform } = fill;
    return {
      matrix: [
        (imgW * transform.m00) / w,
        (imgW * transform.m01) / h,
        imgW *
          (transform.m02 -
            (transform.m00 * bounds.x) / w -
            (transform.m01 * bounds.y) / h),
        (imgH * transform.m10) / w,
        (imgH * transform.m11) / h,
        imgH *
          (transform.m12 -
            (transform.m10 * bounds.x) / w -
            (transform.m11 * bounds.y) / h),
        0,
        0,
        1,
      ],
      tile: mode === "tile" ? "repeat" : "clamp",
    };
  }

  if (mode === "tile") {
    const dispX = bounds.x + (w - imgW) / 2;
    const dispY = bounds.y + (h - imgH) / 2;
    return {
      matrix: [1, 0, -dispX, 0, 1, -dispY, 0, 0, 1],
      tile: "repeat",
    };
  }

  let drawW = w;
  let drawH = h;
  if (mode === "fit") {
    const scale = Math.min(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  } else if (mode !== "stretch") {
    const scale = Math.max(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  }

  const drawX = bounds.x + (w - drawW) / 2;
  const drawY = bounds.y + (h - drawH) / 2;
  return {
    matrix: [
      imgW / drawW,
      0,
      -(drawX * imgW) / drawW,
      0,
      imgH / drawH,
      -(drawY * imgH) / drawH,
      0,
      0,
      1,
    ],
    tile: "clamp",
  };
}

export function getImageObjectFitDrawRect(
  fit: ImageNode["objectFit"] | undefined,
  imgW: number,
  imgH: number,
  bounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const mode = fit ?? "fill";
  if (mode === "stretch") return bounds;
  const scale =
    mode === "fit"
      ? Math.min(bounds.w / imgW, bounds.h / imgH)
      : Math.max(bounds.w / imgW, bounds.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: bounds.x + (bounds.w - w) / 2,
    y: bounds.y + (bounds.h - h) / 2,
    w,
    h,
  };
}

export function getClosedShapeStrokeAlignPlan(align?: PenStroke["align"]): {
  widthScale: number;
  clip: "none" | "inside" | "outside";
} {
  if (align === "inside") return { widthScale: 2, clip: "inside" };
  if (align === "outside") return { widthScale: 2, clip: "outside" };
  return { widthScale: 1, clip: "none" };
}

export function getRoundedRectCornerControlFactor(
  cornerSmoothing?: number,
): number {
  const smoothing = clamp(cornerSmoothing ?? 0, 0, 1);
  return 0.5522847498307936 + smoothing * 0.22;
}

export function normalizeRoundedRectRadii(
  radii: [number, number, number, number],
  w: number,
  h: number,
): [number, number, number, number] {
  const [tl, tr, br, bl] = radii.map((radius) =>
    Math.max(0, Number.isFinite(radius) ? radius : 0),
  ) as [number, number, number, number];
  const safeW = Math.max(0, w);
  const safeH = Math.max(0, h);
  const scale = Math.min(
    1,
    tl + tr > 0 ? safeW / (tl + tr) : 1,
    bl + br > 0 ? safeW / (bl + br) : 1,
    tr + br > 0 ? safeH / (tr + br) : 1,
    tl + bl > 0 ? safeH / (tl + bl) : 1,
  );
  return [tl * scale, tr * scale, br * scale, bl * scale];
}

export function getShadowExpandedBounds(
  bounds: { x: number; y: number; w: number; h: number },
  shadow: Pick<ShadowEffect, "offsetX" | "offsetY" | "spread">,
): { x: number; y: number; w: number; h: number } {
  const spread = shadow.spread ?? 0;
  const spreadX = Math.max(spread, -Math.max(0, bounds.w) / 2);
  const spreadY = Math.max(spread, -Math.max(0, bounds.h) / 2);
  return {
    x: bounds.x + shadow.offsetX - spreadX,
    y: bounds.y + shadow.offsetY - spreadY,
    w: Math.max(0, bounds.w + spreadX * 2),
    h: Math.max(0, bounds.h + spreadY * 2),
  };
}

export function getInnerShadowStrokeWidth(
  shadow: Pick<ShadowEffect, "blur" | "spread">,
): number {
  return Math.max(1, shadow.blur + (shadow.spread ?? 0) * 2);
}

export function getLayerBlurExpandedBounds(
  bounds: { x: number; y: number; w: number; h: number },
  radius: number,
): { left: number; top: number; right: number; bottom: number } | null {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.w) ||
    !Number.isFinite(bounds.h) ||
    bounds.w <= 0 ||
    bounds.h <= 0
  ) {
    return null;
  }

  const outset = Math.ceil(radius * 2);
  return {
    left: bounds.x - outset,
    top: bounds.y - outset,
    right: bounds.x + bounds.w + outset,
    bottom: bounds.y + bounds.h + outset,
  };
}

export function shouldUseRoundLineCapFallback(
  node: Pick<LineNode, "stroke" | "meta">,
): boolean {
  if (node.stroke?.cap) return false;
  return node.meta?.source !== "figma-paste";
}

export function getRectIndependentStrokeSides(
  bounds: { x: number; y: number; w: number; h: number },
  thickness: [number, number, number, number],
  align?: PenStroke["align"],
  radii: [number, number, number, number] = [0, 0, 0, 0],
): Array<{
  side: "top" | "right" | "bottom" | "left";
  thickness: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}> {
  const [top, right, bottom, left] = thickness;
  const [tl, tr, br, bl] = normalizeRoundedRectRadii(radii, bounds.w, bounds.h);
  const alignOffset = (value: number) => {
    if (align === "inside") return value / 2;
    if (align === "outside") return -value / 2;
    return 0;
  };

  return [
    {
      side: "top",
      thickness: top,
      x1: bounds.x + tl,
      y1: bounds.y + alignOffset(top),
      x2: bounds.x + bounds.w - tr,
      y2: bounds.y + alignOffset(top),
    },
    {
      side: "right",
      thickness: right,
      x1: bounds.x + bounds.w - alignOffset(right),
      y1: bounds.y + tr,
      x2: bounds.x + bounds.w - alignOffset(right),
      y2: bounds.y + bounds.h - br,
    },
    {
      side: "bottom",
      thickness: bottom,
      x1: bounds.x + bounds.w - br,
      y1: bounds.y + bounds.h - alignOffset(bottom),
      x2: bounds.x + bl,
      y2: bounds.y + bounds.h - alignOffset(bottom),
    },
    {
      side: "left",
      thickness: left,
      x1: bounds.x + alignOffset(left),
      y1: bounds.y + bounds.h - bl,
      x2: bounds.x + alignOffset(left),
      y2: bounds.y + tl,
    },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Core node renderer for CanvasKit/Skia. Draws PenNode shapes, fills,
 * strokes, effects, text, and images. No editor overlays or store dependencies.
 */
export class SkiaNodeRenderer {
  protected ck: CanvasKit;
  private defaultTypeface: Typeface | null = null;
  private defaultFont: Font | null = null;

  // Current viewport zoom (set by engine before each render frame)
  zoom = 1;
  interactionMode: RendererInteractionMode = "idle";

  // Device pixel ratio
  devicePixelRatio: number | undefined;

  // Sub-renderers
  private textRenderer: SkiaTextRenderer;
  imageLoader: SkiaImageLoader;
  private diamondGradientEffect:
    | import("canvaskit-wasm").RuntimeEffect
    | null
    | undefined;
  private pathCache = new Map<string, PathCacheEntry>();
  private pathCacheTick = 0;
  private pathCacheHits = 0;
  private pathCacheMisses = 0;
  private pathCacheEvictions = 0;

  // Injectable icon lookup
  private iconLookup: IconLookupFn | null = null;

  /** Font manager — delegates to text renderer */
  get fontManager(): SkiaFontManager {
    return this.textRenderer.fontManager;
  }

  constructor(ck: CanvasKit, fontOptions?: FontManagerOptions) {
    this.ck = ck;
    this.imageLoader = new SkiaImageLoader(ck);
    this.textRenderer = new SkiaTextRenderer(ck, fontOptions);
  }

  init() {
    this.defaultFont = new this.ck.Font(null, 16);
  }

  /** Set callback to trigger re-render when async images finish loading. */
  setRedrawCallback(cb: () => void) {
    this.imageLoader.setOnLoaded(cb);
  }

  /** Set injectable icon lookup function. */
  setIconLookup(fn: IconLookupFn) {
    this.iconLookup = fn;
  }

  setImageSourceResolver(
    resolver: (src: string) => { cacheKey: string; loadUrl: string | null },
  ) {
    this.imageLoader.setSourceResolver(resolver);
  }

  isImageReadyForDisplay(
    src: string,
    request: {
      targetWidth: number;
      targetHeight: number;
      zoom: number;
      devicePixelRatio?: number;
      interactionMode?: RendererInteractionMode;
    },
  ): boolean {
    return Boolean(this.imageLoader.getForDisplay(src, request));
  }

  dispose() {
    this.defaultFont?.delete();
    this.defaultFont = null;
    this.defaultTypeface?.delete();
    this.defaultTypeface = null;
    this.diamondGradientEffect?.delete();
    this.diamondGradientEffect = undefined;
    this.textRenderer.dispose();
    this.imageLoader.dispose();
    this.clearPathCache();
  }

  clearTextCache() {
    this.textRenderer.clearTextCache();
  }
  clearParaCache() {
    this.textRenderer.clearParaCache();
  }

  clearPathCache() {
    for (const entry of this.pathCache.values()) {
      entry.path.delete();
    }
    this.pathCache.clear();
  }

  getPathCacheSnapshot(): PathCacheSnapshot {
    const total = this.pathCacheHits + this.pathCacheMisses;
    return {
      entries: this.pathCache.size,
      evictions: this.pathCacheEvictions,
      hitRate: total > 0 ? this.pathCacheHits / total : 0,
      hits: this.pathCacheHits,
      misses: this.pathCacheMisses,
    };
  }

  private getImageSamplingOptions() {
    const ck = this.ck;
    return this.interactionMode === "idle"
      ? { filterMode: ck.FilterMode.Linear, mipmapMode: ck.MipmapMode.Linear }
      : { filterMode: ck.FilterMode.Nearest, mipmapMode: ck.MipmapMode.None };
  }

  private setPaintShader(paint: Paint, shader: Shader | null) {
    if (!shader) return;
    paint.setShader(shader);
    shader.delete();
  }

  private setPaintColorFilter(paint: Paint, filter: ColorFilter | null) {
    if (!filter) return;
    paint.setColorFilter(filter);
    filter.delete();
  }

  // ---------------------------------------------------------------------------
  // Fill paint
  // ---------------------------------------------------------------------------

  private mapBlendMode(mode?: BlendMode) {
    if (!mode || mode === "normal" || mode === "pass_through") return null;
    const { BlendMode } = this.ck;
    switch (mode) {
      case "darken":
        return BlendMode.Darken;
      case "multiply":
        return BlendMode.Multiply;
      case "screen":
        return BlendMode.Screen;
      case "overlay":
        return BlendMode.Overlay;
      case "lighten":
        return BlendMode.Lighten;
      case "color_burn":
        return BlendMode.ColorBurn;
      case "color_dodge":
        return BlendMode.ColorDodge;
      case "linear_dodge":
        return BlendMode.Plus;
      case "hard_light":
        return BlendMode.HardLight;
      case "soft_light":
        return BlendMode.SoftLight;
      case "difference":
        return BlendMode.Difference;
      case "exclusion":
        return BlendMode.Exclusion;
      case "hue":
        return BlendMode.Hue;
      case "saturation":
        return BlendMode.Saturation;
      case "color":
        return BlendMode.Color;
      case "luminosity":
        return BlendMode.Luminosity;
      case "linear_burn":
        return BlendMode.Multiply;
    }
  }

  private makeFillPaint(
    fills: PenFill[] | string | undefined,
    w: number,
    h: number,
    opacity: number,
    absX: number,
    absY: number,
  ): {
    paint: Paint;
    imageFillDraw?: DeferredImageFillDraw;
  } {
    const ck = this.ck;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Fill);
    paint.setAntiAlias(true);

    if (typeof fills === "string") {
      const c = parseColor(ck, fills);
      c[3] = (c[3] ?? 1) * opacity;
      paint.setColor(c);
      return { paint };
    }
    if (!fills || fills.length === 0) {
      const c = parseColor(ck, DEFAULT_FILL);
      c[3] = (c[3] ?? 1) * opacity;
      paint.setColor(c);
      return { paint };
    }

    const first = fills.find(
      (fill) => fill.visible !== false && (fill.opacity ?? 1) > 0,
    );
    if (!first) {
      const c = parseColor(ck, "transparent");
      paint.setColor(c);
      return { paint };
    }

    if (first.type === "solid") {
      const c = parseColor(ck, first.color);
      c[3] = (c[3] ?? 1) * (first.opacity ?? 1) * opacity;
      paint.setColor(c);
    } else if (first.type === "linear_gradient") {
      const stops = first.stops ?? [];
      const fillOpacity = (first.opacity ?? 1) * opacity;
      if (stops.length >= 2) {
        const { x1, y1, x2, y2 } = getLinearGradientEndpoints(first, {
          x: absX,
          y: absY,
          w,
          h,
        });
        const colors = stops.map((s: GradientStop) => {
          const c = parseColor(ck, s.color);
          c[3] = (c[3] ?? 1) * (s.opacity ?? 1) * fillOpacity;
          return c;
        });
        const positions = stops.map((s: GradientStop) =>
          Math.max(0, Math.min(1, s.offset)),
        );
        const shader = ck.Shader.MakeLinearGradient(
          [x1, y1],
          [x2, y2],
          colors,
          positions,
          ck.TileMode.Clamp,
        );
        this.setPaintShader(paint, shader);
      } else {
        const firstStop = stops[0];
        const stopColor = firstStop?.color;
        const c = parseColor(ck, stopColor ?? DEFAULT_FILL);
        c[3] = (c[3] ?? 1) * (firstStop?.opacity ?? 1) * fillOpacity;
        paint.setColor(c);
      }
    } else if (first.type === "angular_gradient") {
      const stops = first.stops ?? [];
      const fillOpacity = (first.opacity ?? 1) * opacity;
      if (stops.length >= 2) {
        const cx = absX + (first.cx ?? 0.5) * w;
        const cy = absY + (first.cy ?? 0.5) * h;
        const colors = stops.map((s: GradientStop) => {
          const c = parseColor(ck, s.color);
          c[3] = (c[3] ?? 1) * (s.opacity ?? 1) * fillOpacity;
          return c;
        });
        const positions = stops.map((s: GradientStop) =>
          Math.max(0, Math.min(1, s.offset)),
        );
        const { startAngle, endAngle } = getAngularGradientSweepAngles(
          first.angle,
        );
        const shader = ck.Shader.MakeSweepGradient(
          cx,
          cy,
          colors,
          positions,
          ck.TileMode.Clamp,
          null,
          0,
          startAngle,
          endAngle,
        );
        this.setPaintShader(paint, shader);
      } else {
        const firstStop = stops[0];
        const stopColor = firstStop?.color;
        const c = parseColor(ck, stopColor ?? DEFAULT_FILL);
        c[3] = (c[3] ?? 1) * (firstStop?.opacity ?? 1) * fillOpacity;
        paint.setColor(c);
      }
    } else if (first.type === "diamond_gradient") {
      const stops = first.stops ?? [];
      const fillOpacity = (first.opacity ?? 1) * opacity;
      if (stops.length >= 2) {
        const colors = stops
          .slice(0, DIAMOND_GRADIENT_MAX_STOPS)
          .map((s: GradientStop) => {
            const c = parseColor(ck, s.color);
            c[3] = (c[3] ?? 1) * (s.opacity ?? 1) * fillOpacity;
            return c;
          });
        const shader = this.makeDiamondGradientShader(
          first,
          { x: absX, y: absY, w, h },
          colors,
        );
        if (shader) {
          this.setPaintShader(paint, shader);
        } else {
          this.applyRadialGradientFallback(
            paint,
            first,
            colors,
            opacity,
            absX,
            absY,
            w,
            h,
          );
        }
      } else {
        const firstStop = stops[0];
        const stopColor = firstStop?.color;
        const c = parseColor(ck, stopColor ?? DEFAULT_FILL);
        c[3] = (c[3] ?? 1) * (firstStop?.opacity ?? 1) * fillOpacity;
        paint.setColor(c);
      }
    } else if (first.type === "radial_gradient") {
      const stops = first.stops ?? [];
      const fillOpacity = (first.opacity ?? 1) * opacity;
      if (stops.length >= 2) {
        const cx = absX + (first.cx ?? 0.5) * w;
        const cy = absY + (first.cy ?? 0.5) * h;
        const gradientRadius =
          "radius" in first && first.radius !== undefined ? first.radius : 0.5;
        const r = gradientRadius * Math.max(w, h);
        const colors = stops.map((s: GradientStop) => {
          const c = parseColor(ck, s.color);
          c[3] = (c[3] ?? 1) * (s.opacity ?? 1) * fillOpacity;
          return c;
        });
        const positions = stops.map((s: GradientStop) =>
          Math.max(0, Math.min(1, s.offset)),
        );
        const shader = ck.Shader.MakeRadialGradient(
          [cx, cy],
          r,
          colors,
          positions,
          ck.TileMode.Clamp,
        );
        this.setPaintShader(paint, shader);
      } else {
        const firstStop = stops[0];
        const stopColor = firstStop?.color;
        const c = parseColor(ck, stopColor ?? DEFAULT_FILL);
        c[3] = (c[3] ?? 1) * (firstStop?.opacity ?? 1) * fillOpacity;
        paint.setColor(c);
      }
    } else if (first.type === "image") {
      const result = this.applyImageFillToPaint(
        paint,
        first,
        w,
        h,
        opacity,
        absX,
        absY,
      );
      if (result.needsDrawImageRect && result.fill) {
        const drawW = result.w;
        const drawH = result.h;
        const drawAbsX = result.absX;
        const drawAbsY = result.absY;
        const drawOpacity = result.opacity;
        if (
          drawW === undefined ||
          drawH === undefined ||
          drawAbsX === undefined ||
          drawAbsY === undefined ||
          drawOpacity === undefined
        ) {
          return { paint };
        }
        return {
          paint,
          imageFillDraw: {
            fill: result.fill,
            w: drawW,
            h: drawH,
            absX: drawAbsX,
            absY: drawAbsY,
            opacity: drawOpacity,
          },
        };
      }
    }
    const blendMode = this.mapBlendMode(first.blendMode);
    if (blendMode) paint.setBlendMode(blendMode);

    return { paint };
  }

  private makeDiamondGradientShader(
    fill: DiamondGradientFill,
    bounds: { x: number; y: number; w: number; h: number },
    colors: Float32Array[],
  ): import("canvaskit-wasm").Shader | null {
    const effect = this.getDiamondGradientEffect();
    if (!effect) return null;
    return effect.makeShader(getDiamondGradientUniforms(fill, bounds, colors));
  }

  private getDiamondGradientEffect():
    | import("canvaskit-wasm").RuntimeEffect
    | null {
    if (this.diamondGradientEffect !== undefined) {
      return this.diamondGradientEffect;
    }
    this.diamondGradientEffect = this.ck.RuntimeEffect.Make(
      DIAMOND_GRADIENT_SKSL,
      (error) => {
        console.warn("[pen-renderer] diamond gradient shader compile failed", {
          error,
        });
      },
    );
    return this.diamondGradientEffect;
  }

  private applyRadialGradientFallback(
    paint: Paint,
    fill: Extract<PenFill, { type: "radial_gradient" | "diamond_gradient" }>,
    colors: Float32Array[],
    opacity: number,
    absX: number,
    absY: number,
    w: number,
    h: number,
  ) {
    const stops = fill.stops ?? [];
    const fillOpacity = (fill.opacity ?? 1) * opacity;
    const cx = absX + (fill.cx ?? 0.5) * w;
    const cy = absY + (fill.cy ?? 0.5) * h;
    const gradientRadius =
      "radius" in fill && fill.radius !== undefined ? fill.radius : 0.5;
    const r = gradientRadius * Math.max(w, h);
    const shaderColors =
      colors.length > 0
        ? colors
        : stops.map((s: GradientStop) => {
            const c = parseColor(this.ck, s.color);
            c[3] = (c[3] ?? 1) * (s.opacity ?? 1) * fillOpacity;
            return c;
          });
    const positions = stops
      .slice(0, shaderColors.length)
      .map((s: GradientStop) => Math.max(0, Math.min(1, s.offset)));
    const shader = this.ck.Shader.MakeRadialGradient(
      [cx, cy],
      r,
      shaderColors,
      positions,
      this.ck.TileMode.Clamp,
    );
    this.setPaintShader(paint, shader);
  }

  private applyImageFillToPaint(
    paint: Paint,
    fill: ImageFill,
    w: number,
    h: number,
    opacity: number,
    absX: number,
    absY: number,
  ): {
    needsDrawImageRect: boolean;
    fill?: ImageFill;
    w?: number;
    h?: number;
    absX?: number;
    absY?: number;
    opacity?: number;
  } {
    const ck = this.ck;
    const fillOpacity = (fill.opacity ?? 1) * opacity;
    const url = fill.url;
    if (!url) {
      const c = parseColor(ck, "#e5e7eb");
      c[3] = (c[3] ?? 1) * fillOpacity;
      paint.setColor(c);
      return { needsDrawImageRect: false };
    }

    const cached = this.imageLoader.getForDisplay(url, {
      targetWidth: w,
      targetHeight: h,
      zoom: this.zoom,
      devicePixelRatio: this.devicePixelRatio,
      interactionMode: this.interactionMode,
    });
    if (cached === undefined) this.imageLoader.request(url);
    if (!cached) {
      const isMissing = this.imageLoader.getStatus(url)?.state === "missing";
      const c = parseColor(ck, isMissing ? "#f1d7d7" : "#e5e7eb");
      c[3] = (c[3] ?? 1) * fillOpacity;
      paint.setColor(c);
      return { needsDrawImageRect: false };
    }

    const imgW = cached.width();
    const imgH = cached.height();
    if (imgW <= 0 || imgH <= 0) return { needsDrawImageRect: false };

    const mode = fill.mode ?? "fill";
    if (mode === "tile" && !fill.transform) {
      const dispX = absX + (w - imgW) / 2;
      const dispY = absY + (h - imgH) / 2;
      const localMatrix = Float32Array.of(1, 0, -dispX, 0, 1, -dispY, 0, 0, 1);
      const { filterMode, mipmapMode } = this.getImageSamplingOptions();
      const shader = cached.makeShaderOptions(
        ck.TileMode.Repeat,
        ck.TileMode.Repeat,
        filterMode,
        mipmapMode,
        localMatrix,
      );
      if (shader) {
        this.setPaintShader(paint, shader);
        if (fillOpacity < 1) paint.setAlphaf(fillOpacity);
        this.setPaintColorFilter(paint, this.buildImageAdjustmentFilter(fill));
      }
      return { needsDrawImageRect: false };
    }

    paint.setColor(Float32Array.of(0, 0, 0, 0));
    return {
      needsDrawImageRect: true,
      fill,
      w,
      h,
      absX,
      absY,
      opacity: fillOpacity,
    };
  }

  private drawImageFillRect(
    canvas: Canvas,
    fill: ImageFill,
    w: number,
    h: number,
    absX: number,
    absY: number,
    fillOpacity: number,
  ) {
    const ck = this.ck;
    const url = fill.url;
    if (!url) return;
    const cached = this.imageLoader.getForDisplay(url, {
      targetWidth: w,
      targetHeight: h,
      zoom: this.zoom,
      devicePixelRatio: this.devicePixelRatio,
      interactionMode: this.interactionMode,
    });
    if (!cached) return;
    const imgW = cached.width();
    const imgH = cached.height();
    if (imgW <= 0 || imgH <= 0) return;

    const mode = fill.mode ?? "fill";
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    const { filterMode, mipmapMode } = this.getImageSamplingOptions();
    if (fillOpacity < 1) paint.setAlphaf(fillOpacity);
    const blendMode = this.mapBlendMode(fill.blendMode);
    if (blendMode) paint.setBlendMode(blendMode);
    this.setPaintColorFilter(paint, this.buildImageAdjustmentFilter(fill));

    if (fill.transform) {
      const shaderMatrix = getImageFillShaderMatrix(fill, imgW, imgH, {
        x: absX,
        y: absY,
        w,
        h,
      });
      if (shaderMatrix) {
        const tileMode =
          shaderMatrix.tile === "repeat"
            ? ck.TileMode.Repeat
            : ck.TileMode.Clamp;
        const shader = cached.makeShaderOptions(
          tileMode,
          tileMode,
          filterMode,
          mipmapMode,
          shaderMatrix.matrix,
        );
        if (shader) {
          this.setPaintShader(paint, shader);
          canvas.drawRect(ck.LTRBRect(absX, absY, absX + w, absY + h), paint);
          paint.delete();
          return;
        }
      }
    }

    const transformedSource = getImageFillTransformSourceRect(fill, imgW, imgH);
    if (transformedSource) {
      canvas.drawImageRectOptions(
        cached,
        ck.LTRBRect(
          transformedSource.left,
          transformedSource.top,
          transformedSource.right,
          transformedSource.bottom,
        ),
        ck.LTRBRect(absX, absY, absX + w, absY + h),
        filterMode,
        mipmapMode,
        paint,
      );
      paint.delete();
      return;
    }

    if (mode === "fit") {
      const scale = Math.min(w / imgW, h / imgH);
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = absX + (w - dw) / 2;
      const dy = absY + (h - dh) / 2;
      canvas.drawImageRectOptions(
        cached,
        ck.LTRBRect(0, 0, imgW, imgH),
        ck.LTRBRect(dx, dy, dx + dw, dy + dh),
        filterMode,
        mipmapMode,
        paint,
      );
    } else if (mode === "stretch") {
      canvas.drawImageRectOptions(
        cached,
        ck.LTRBRect(0, 0, imgW, imgH),
        ck.LTRBRect(absX, absY, absX + w, absY + h),
        filterMode,
        mipmapMode,
        paint,
      );
    } else {
      const scale = Math.max(w / imgW, h / imgH);
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = absX + (w - dw) / 2;
      const dy = absY + (h - dh) / 2;
      canvas.drawImageRectOptions(
        cached,
        ck.LTRBRect(0, 0, imgW, imgH),
        ck.LTRBRect(dx, dy, dx + dw, dy + dh),
        filterMode,
        mipmapMode,
        paint,
      );
    }
    paint.delete();
  }

  private drawImageFillClippedToPath(
    canvas: Canvas,
    path: import("canvaskit-wasm").Path,
    imageFillDraw: DeferredImageFillDraw,
  ) {
    canvas.save();
    canvas.clipPath(path, this.ck.ClipOp.Intersect, true);
    this.drawImageFillRect(
      canvas,
      imageFillDraw.fill,
      imageFillDraw.w,
      imageFillDraw.h,
      imageFillDraw.absX,
      imageFillDraw.absY,
      imageFillDraw.opacity,
    );
    canvas.restore();
  }

  private buildImageAdjustmentFilter(adj: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    highlights?: number;
    shadows?: number;
  }) {
    const ck = this.ck;
    const exp = (adj.exposure ?? 0) / 100;
    const con = (adj.contrast ?? 0) / 100;
    const sat = (adj.saturation ?? 0) / 100;
    const temp = (adj.temperature ?? 0) / 100;
    const tintVal = (adj.tint ?? 0) / 100;
    const hi = (adj.highlights ?? 0) / 100;
    const sh = (adj.shadows ?? 0) / 100;
    if (
      exp === 0 &&
      con === 0 &&
      sat === 0 &&
      temp === 0 &&
      tintVal === 0 &&
      hi === 0 &&
      sh === 0
    )
      return null;

    const e = 1 + exp * 1.5;
    const c = 1 + con;
    const cOff = 0.5 * (1 - c);
    const s = 1 + sat;
    const lr = 0.2126;
    const lg = 0.7152;
    const lb = 0.0722;
    const sr = (1 - s) * lr;
    const sg = (1 - s) * lg;
    const sb = (1 - s) * lb;
    const f = c * e;
    const offR = cOff + temp * 0.15 + (hi + sh * 0.5) * 0.1;
    const offG = cOff + tintVal * 0.15 + (hi + sh * 0.5) * 0.1;
    const offB = cOff - temp * 0.15 + (hi + sh * 0.5) * 0.1;

    return ck.ColorFilter.MakeMatrix([
      f * (sr + s),
      f * sg,
      f * sb,
      0,
      offR,
      f * sr,
      f * (sg + s),
      f * sb,
      0,
      offG,
      f * sr,
      f * sg,
      f * (sb + s),
      0,
      offB,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Stroke paint
  // ---------------------------------------------------------------------------

  private makeStrokePaintForLayer(
    stroke: PenStroke | undefined,
    layer: PenFill | string,
    opacity: number,
    bounds?: { x: number; y: number; w: number; h: number },
    thicknessOverride?: number,
    alignClosedShape = false,
  ): Paint | null {
    if (!stroke) return null;
    const alignPlan = alignClosedShape
      ? getClosedShapeStrokeAlignPlan(stroke.align)
      : { widthScale: 1 };
    const strokeWidth =
      (thicknessOverride ?? resolveStrokeWidth(stroke)) * alignPlan.widthScale;
    if (strokeWidth <= 0) return null;

    const ck = this.ck;
    let paint: Paint;

    if (typeof layer === "string") {
      paint = new ck.Paint();
      const c = parseColor(ck, layer);
      c[3] = (c[3] ?? 1) * opacity;
      paint.setColor(c);
    } else if (layer.type === "image") {
      paint = new ck.Paint();
      this.applyImageStrokeFillToPaint(
        paint,
        layer,
        opacity,
        bounds ?? { x: 0, y: 0, w: 1, h: 1 },
      );
    } else {
      const fillPaint = this.makeFillPaint(
        [layer],
        bounds?.w ?? 1,
        bounds?.h ?? 1,
        opacity,
        bounds?.x ?? 0,
        bounds?.y ?? 0,
      );
      paint = fillPaint.paint;
    }

    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setAntiAlias(true);
    paint.setStrokeWidth(strokeWidth);

    if (stroke.join === "round") paint.setStrokeJoin(ck.StrokeJoin.Round);
    else if (stroke.join === "bevel") paint.setStrokeJoin(ck.StrokeJoin.Bevel);
    if (stroke.cap === "round") paint.setStrokeCap(ck.StrokeCap.Round);
    else if (stroke.cap === "square") paint.setStrokeCap(ck.StrokeCap.Square);
    if (stroke.dashPattern && stroke.dashPattern.length >= 2) {
      const effect = ck.PathEffect.MakeDash(
        stroke.dashPattern,
        stroke.dashOffset ?? 0,
      );
      if (effect) paint.setPathEffect(effect);
    }
    if (stroke.miterLimit && stroke.miterLimit > 0) {
      paint.setStrokeMiter(stroke.miterLimit);
    }

    return paint;
  }

  private drawStrokePaintLayers(
    stroke: PenStroke | undefined,
    opacity: number,
    bounds: { x: number; y: number; w: number; h: number },
    options: {
      thicknessOverride?: number;
      alignClosedShape?: boolean;
      preparePaint?: (paint: Paint) => void;
    },
    draw: (paint: Paint) => void,
  ) {
    for (const layer of getVisibleStrokePaintLayers(stroke)) {
      const paint = this.makeStrokePaintForLayer(
        stroke,
        layer,
        opacity,
        bounds,
        options.thicknessOverride,
        options.alignClosedShape,
      );
      if (!paint) continue;
      options.preparePaint?.(paint);
      draw(paint);
      paint.delete();
    }
  }

  private applyImageStrokeFillToPaint(
    paint: Paint,
    fill: ImageFill,
    opacity: number,
    bounds: { x: number; y: number; w: number; h: number },
  ) {
    const ck = this.ck;
    const fillOpacity = (fill.opacity ?? 1) * opacity;
    const setFallbackColor = (color: string) => {
      const c = parseColor(ck, color);
      c[3] = (c[3] ?? 1) * fillOpacity;
      paint.setColor(c);
    };

    const url = fill.url;
    if (!url) {
      setFallbackColor("#e5e7eb");
      return;
    }

    const cached = this.imageLoader.getForDisplay(url, {
      targetWidth: bounds.w,
      targetHeight: bounds.h,
      zoom: this.zoom,
      devicePixelRatio: this.devicePixelRatio,
      interactionMode: this.interactionMode,
    });
    if (cached === undefined) this.imageLoader.request(url);
    if (!cached) {
      const isMissing = this.imageLoader.getStatus(url)?.state === "missing";
      setFallbackColor(isMissing ? "#f1d7d7" : "#e5e7eb");
      return;
    }

    const shaderMatrix = getImageFillShaderMatrix(
      fill,
      cached.width(),
      cached.height(),
      bounds,
    );
    if (!shaderMatrix) {
      setFallbackColor("#e5e7eb");
      return;
    }

    const tileMode =
      shaderMatrix.tile === "repeat" ? ck.TileMode.Repeat : ck.TileMode.Clamp;
    const { filterMode, mipmapMode } = this.getImageSamplingOptions();
    const shader = cached.makeShaderOptions(
      tileMode,
      tileMode,
      filterMode,
      mipmapMode,
      shaderMatrix.matrix,
    );
    this.setPaintShader(paint, shader);
    if (fillOpacity < 1) paint.setAlphaf(fillOpacity);
    const blendMode = this.mapBlendMode(fill.blendMode);
    if (blendMode) paint.setBlendMode(blendMode);
    this.setPaintColorFilter(paint, this.buildImageAdjustmentFilter(fill));
  }

  // ---------------------------------------------------------------------------
  // Shadow
  // ---------------------------------------------------------------------------

  private makeShadowPaint(shadow: ShadowEffect, opacity: number): Paint {
    const ck = this.ck;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Fill);
    paint.setAntiAlias(true);
    const color = parseColor(ck, shadow.color);
    color[3] = (color[3] ?? 1) * (shadow.opacity ?? 1) * opacity;
    paint.setColor(color);
    if (shadow.blur > 0) {
      paint.setMaskFilter(
        ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, shadow.blur / 2, true),
      );
    }
    const blendMode = this.mapBlendMode(shadow.blendMode);
    if (blendMode) paint.setBlendMode(blendMode);
    return paint;
  }

  private drawDropShadowShape(
    canvas: Canvas,
    node: PenNode,
    shadow: ShadowEffect,
    x: number,
    y: number,
    w: number,
    h: number,
    paint: Paint,
  ) {
    const ck = this.ck;
    const shadowBounds = getShadowExpandedBounds({ x, y, w, h }, shadow);
    if (shadowBounds.w <= 0 || shadowBounds.h <= 0) return;

    switch (node.type) {
      case "frame":
      case "rectangle":
      case "group": {
        const container = node as PenNode & ContainerProps;
        const radii = cornerRadii(container.cornerRadius).map((radius) =>
          Math.max(0, radius + (shadow.spread ?? 0)),
        ) as [number, number, number, number];
        if (radii.some((radius) => radius > 0)) {
          const path = this.makeRoundedRectPath(
            shadowBounds.x,
            shadowBounds.y,
            shadowBounds.w,
            shadowBounds.h,
            radii,
            container.cornerSmoothing,
          );
          canvas.drawPath(path, paint);
          path.delete();
        } else {
          canvas.drawRect(
            ck.LTRBRect(
              shadowBounds.x,
              shadowBounds.y,
              shadowBounds.x + shadowBounds.w,
              shadowBounds.y + shadowBounds.h,
            ),
            paint,
          );
        }
        return;
      }
      case "ellipse": {
        const eNode = node as EllipseNode;
        if (
          isArcEllipse(eNode.startAngle, eNode.sweepAngle, eNode.innerRadius)
        ) {
          const arcD = buildEllipseArcPath(
            shadowBounds.w,
            shadowBounds.h,
            eNode.startAngle ?? 0,
            eNode.sweepAngle ?? 360,
            eNode.innerRadius ?? 0,
          );
          const path = ck.Path.MakeFromSVGString(arcD);
          if (path) {
            path.offset(shadowBounds.x, shadowBounds.y);
            canvas.drawPath(path, paint);
            path.delete();
          }
          return;
        }
        canvas.drawOval(
          ck.LTRBRect(
            shadowBounds.x,
            shadowBounds.y,
            shadowBounds.x + shadowBounds.w,
            shadowBounds.y + shadowBounds.h,
          ),
          paint,
        );
        return;
      }
      case "polygon": {
        const path = this.makePolygonShapePath(
          node as PolygonNode,
          shadowBounds.x,
          shadowBounds.y,
          shadowBounds.w,
          shadowBounds.h,
        );
        canvas.drawPath(path, paint);
        path.delete();
        return;
      }
      case "path": {
        const path = this.makePathShapePath(node as PathNode, x, y, w, h);
        if (path) {
          path.offset(shadow.offsetX, shadow.offsetY);
          canvas.drawPath(path, paint);
          path.delete();
        } else {
          canvas.drawRect(
            ck.LTRBRect(
              shadowBounds.x,
              shadowBounds.y,
              shadowBounds.x + shadowBounds.w,
              shadowBounds.y + shadowBounds.h,
            ),
            paint,
          );
        }
        return;
      }
      case "image": {
        const imageNode = node as ImageNode;
        const radius = cornerRadiusValue(imageNode.cornerRadius);
        if (radius > 0) {
          const radii: [number, number, number, number] = [
            radius,
            radius,
            radius,
            radius,
          ].map((value) => Math.max(0, value + (shadow.spread ?? 0))) as [
            number,
            number,
            number,
            number,
          ];
          const path = this.makeRoundedRectPath(
            shadowBounds.x,
            shadowBounds.y,
            shadowBounds.w,
            shadowBounds.h,
            radii,
          );
          canvas.drawPath(path, paint);
          path.delete();
        } else {
          canvas.drawRect(
            ck.LTRBRect(
              shadowBounds.x,
              shadowBounds.y,
              shadowBounds.x + shadowBounds.w,
              shadowBounds.y + shadowBounds.h,
            ),
            paint,
          );
        }
        return;
      }
      default:
        canvas.drawRect(
          ck.LTRBRect(
            shadowBounds.x,
            shadowBounds.y,
            shadowBounds.x + shadowBounds.w,
            shadowBounds.y + shadowBounds.h,
          ),
          paint,
        );
    }
  }

  private applyDropShadowsDirect(
    canvas: Canvas,
    node: PenNode,
    effects: PenEffect[] | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ): boolean {
    if (!effects) return false;
    const shadows = effects.filter(
      (e): e is ShadowEffect =>
        e.type === "shadow" &&
        !e.inner &&
        e.visible !== false &&
        (e.opacity ?? 1) > 0,
    );
    if (shadows.length === 0) return false;

    for (const shadow of shadows) {
      const paint = this.makeShadowPaint(shadow, opacity);
      this.drawDropShadowShape(canvas, node, shadow, x, y, w, h, paint);
      paint.delete();
    }
    return true;
  }

  private applyInnerShadowsDirect(
    canvas: Canvas,
    node: PenNode,
    effects: PenEffect[] | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ): boolean {
    if (!effects) return false;
    const shadows = effects.filter(
      (e): e is ShadowEffect =>
        e.type === "shadow" &&
        e.inner === true &&
        e.visible !== false &&
        (e.opacity ?? 1) > 0,
    );
    if (shadows.length === 0) return false;

    const ck = this.ck;
    for (const shadow of shadows) {
      const paint = this.makeShadowPaint(shadow, opacity);
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(getInnerShadowStrokeWidth(shadow));
      const clipPath = this.makeNodeShapePath(node, x, y, w, h);
      const shadowPath = this.makeNodeShapePath(
        node,
        x + shadow.offsetX,
        y + shadow.offsetY,
        w,
        h,
      );
      if (!clipPath || !shadowPath) {
        clipPath?.delete();
        shadowPath?.delete();
        paint.delete();
        continue;
      }
      canvas.save();
      canvas.clipPath(clipPath, ck.ClipOp.Intersect, true);
      canvas.drawPath(shadowPath, paint);
      canvas.restore();
      clipPath.delete();
      shadowPath.delete();
      paint.delete();
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Draw a single render node (no selection/overlay logic)
  // ---------------------------------------------------------------------------

  drawRenderNodes(canvas: Canvas, renderNodes: RenderNode[]) {
    const opacityGroupStack: Array<{ depth: number }> = [];
    for (const rn of renderNodes) {
      const depth = rn.depth ?? 0;
      while (opacityGroupStack.length > 0) {
        const top = opacityGroupStack[opacityGroupStack.length - 1];
        if (!top || top.depth < depth) break;
        canvas.restore();
        opacityGroupStack.pop();
      }

      const opacityGroup = rn.opacityGroup;
      if (opacityGroup && opacityGroup.opacity < 1) {
        const paint = new this.ck.Paint();
        paint.setAlphaf(Math.max(0, opacityGroup.opacity));
        canvas.saveLayer(paint, null);
        paint.delete();
        opacityGroupStack.push({ depth: opacityGroup.depth });
      }

      this.drawNode(canvas, rn);
    }

    while (opacityGroupStack.length > 0) {
      canvas.restore();
      opacityGroupStack.pop();
    }
  }

  drawNode(canvas: Canvas, rn: RenderNode) {
    const { node, absX, absY, absW, absH, clipRect } = rn;
    const ck = this.ck;
    const nodeOpacity = typeof node.opacity === "number" ? node.opacity : 1;
    const opacity =
      rn.renderOpacity ?? nodeOpacity * (rn.inheritedOpacity ?? 1);

    if (("visible" in node ? node.visible : undefined) === false) return;

    // Pass zoom to text renderer
    this.textRenderer.zoom = this.zoom;
    this.textRenderer.devicePixelRatio = this.devicePixelRatio;

    // Apply clipping from parent frame
    let clipped = false;
    let maskOpacityLayerApplied = false;
    if (clipRect) {
      canvas.save();
      clipped = true;
      const clipCornerRadius =
        clipRect.cornerRadius ??
        ([clipRect.rx, clipRect.rx, clipRect.rx, clipRect.rx] as [
          number,
          number,
          number,
          number,
        ]);
      if (clipCornerRadius.some((radius) => radius > 0)) {
        this.clipRectShape(
          canvas,
          clipRect.x,
          clipRect.y,
          clipRect.w,
          clipRect.h,
          clipCornerRadius,
          ck.ClipOp.Intersect,
          clipRect.cornerSmoothing,
        );
      } else {
        canvas.clipRect(
          ck.LTRBRect(
            clipRect.x,
            clipRect.y,
            clipRect.x + clipRect.w,
            clipRect.y + clipRect.h,
          ),
          ck.ClipOp.Intersect,
          true,
        );
      }
      const maskClipPath = clipRect.maskShape
        ? this.makeMaskClipPath(
            clipRect.maskShape.node,
            clipRect.maskShape.absX,
            clipRect.maskShape.absY,
            clipRect.maskShape.absW,
            clipRect.maskShape.absH,
          )
        : null;
      if (maskClipPath) {
        canvas.clipPath(maskClipPath, ck.ClipOp.Intersect, true);
        maskClipPath.delete();
      }
      if (
        clipRect.source === "mask" &&
        clipRect.maskType !== "vector" &&
        clipRect.maskOpacity !== undefined &&
        clipRect.maskOpacity < 1
      ) {
        const maskPaint = new ck.Paint();
        maskPaint.setAlphaf(Math.max(0, clipRect.maskOpacity));
        canvas.saveLayer(maskPaint, null);
        maskPaint.delete();
        maskOpacityLayerApplied = true;
      }
    }

    const transformMatrix = toCanvasKitNodeTransform(node, absX, absY);
    if (transformMatrix) {
      canvas.save();
      canvas.concat(transformMatrix);
    }

    // Apply flip
    const flipX = node.flipX === true;
    const flipY = node.flipY === true;
    if (!transformMatrix && (flipX || flipY)) {
      canvas.save();
      canvas.translate(absX + absW / 2, absY + absH / 2);
      canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      canvas.translate(-(absX + absW / 2), -(absY + absH / 2));
    }

    // Apply imported transform components for nodes that do not carry a full
    // matrix. Matrix-backed imports already include scale/skew/rotation/flip.
    const scaleX = typeof node.scaleX === "number" ? node.scaleX : 1;
    const scaleY = typeof node.scaleY === "number" ? node.scaleY : 1;
    const skewX = typeof node.skewX === "number" ? node.skewX : 0;
    const skewY = typeof node.skewY === "number" ? node.skewY : 0;
    const hasScaleSkew =
      Math.abs(scaleX - 1) > 0.001 ||
      Math.abs(scaleY - 1) > 0.001 ||
      Math.abs(skewX) > 0.001 ||
      Math.abs(skewY) > 0.001;
    if (!transformMatrix && hasScaleSkew) {
      canvas.save();
      canvas.translate(absX + absW / 2, absY + absH / 2);
      if (scaleX !== 1 || scaleY !== 1) {
        canvas.scale(scaleX, scaleY);
      }
      if (skewX !== 0 || skewY !== 0) {
        canvas.skew(
          Math.tan((skewX * Math.PI) / 180),
          Math.tan((skewY * Math.PI) / 180),
        );
      }
      canvas.translate(-(absX + absW / 2), -(absY + absH / 2));
    }

    // Apply rotation
    const rotation = node.rotation ?? 0;
    if (!transformMatrix && rotation !== 0) {
      canvas.save();
      canvas.rotate(rotation, absX + absW / 2, absY + absH / 2);
    }

    const nodeBlendMode = this.mapBlendMode(node.blendMode);
    let blendLayerApplied = false;
    if (nodeBlendMode) {
      const blendPaint = new ck.Paint();
      blendPaint.setBlendMode(nodeBlendMode);
      canvas.saveLayer(blendPaint, null);
      blendPaint.delete();
      blendLayerApplied = true;
    }

    // Apply shadow (text uses glyph-shaped shadow, not rectangle)
    const effects =
      "effects" in node
        ? (node as PenNode & { effects?: PenEffect[] }).effects
        : undefined;
    if (node.type !== "text") {
      this.applyDropShadowsDirect(
        canvas,
        node,
        effects,
        absX,
        absY,
        absW,
        absH,
        opacity,
      );
    }

    // Background blur samples the already-painted backdrop through the current
    // node shape/bounds. This must be separate from layer blur, which blurs the
    // node's own rendered content.
    let backdropBlurLayerCount = 0;
    const backdropBlurEffects = getVisibleBackdropBlurEffects(effects);
    for (const backdropBlurEffect of backdropBlurEffects) {
      canvas.save();
      this.clipBackdropBlurShape(canvas, node, absX, absY, absW, absH);
      const backdropFilter = ck.ImageFilter.MakeBlur(
        backdropBlurEffect.radius / 2,
        backdropBlurEffect.radius / 2,
        ck.TileMode.Clamp,
        null,
      );
      const backdropPaint = new ck.Paint();
      if ((backdropBlurEffect.opacity ?? 1) < 1) {
        backdropPaint.setAlphaf(backdropBlurEffect.opacity ?? 1);
      }
      const backdropBlendMode = this.mapBlendMode(backdropBlurEffect.blendMode);
      if (backdropBlendMode) backdropPaint.setBlendMode(backdropBlendMode);
      canvas.saveLayer(
        backdropPaint,
        ck.LTRBRect(absX, absY, absX + absW, absY + absH),
        backdropFilter,
        undefined,
        ck.TileMode.Clamp,
      );
      backdropPaint.delete();
      backdropBlurLayerCount += 1;
    }

    // Apply layer blur effects via layered ImageFilters. Figma preserves effect
    // order, so nest saveLayers in reverse and let restores apply in array order.
    let blurLayerCount = 0;
    const blurEffects = getVisibleLayerBlurEffects(effects);
    for (let i = blurEffects.length - 1; i >= 0; i -= 1) {
      const blurEffect = blurEffects[i];
      if (!blurEffect) continue;
      const blurBounds = getLayerBlurExpandedBounds(
        { x: absX, y: absY, w: absW, h: absH },
        blurEffect.radius,
      );
      if (!blurBounds) {
        console.warn("[pen-renderer] layer-blur.invalid", {
          nodeId: node.id,
          nodeType: node.type,
          radius: blurEffect.radius,
          interactionMode: this.interactionMode,
          bounds: { x: absX, y: absY, w: absW, h: absH },
        });
        continue;
      }
      const blurPaint = new ck.Paint();
      const blurFilter = ck.ImageFilter.MakeBlur(
        blurEffect.radius / 2,
        blurEffect.radius / 2,
        ck.TileMode.Clamp,
        null,
      );
      blurPaint.setImageFilter(blurFilter);
      if ((blurEffect.opacity ?? 1) < 1) {
        blurPaint.setAlphaf(blurEffect.opacity ?? 1);
      }
      const blurBlendMode = this.mapBlendMode(blurEffect.blendMode);
      if (blurBlendMode) blurPaint.setBlendMode(blurBlendMode);
      const layerStackHeight = canvas.saveLayer(
        blurPaint,
        ck.LTRBRect(
          blurBounds.left,
          blurBounds.top,
          blurBounds.right,
          blurBounds.bottom,
        ),
      );
      blurFilter.delete();
      blurPaint.delete();
      if (!Number.isFinite(layerStackHeight) || layerStackHeight <= 0) {
        console.warn("[pen-renderer] layer-blur.save-layer-failed", {
          nodeId: node.id,
          nodeType: node.type,
          radius: blurEffect.radius,
          interactionMode: this.interactionMode,
          bounds: { x: absX, y: absY, w: absW, h: absH },
        });
        continue;
      }
      blurLayerCount += 1;
    }

    switch (node.type) {
      case "frame":
      case "rectangle":
      case "group":
        this.drawRect(canvas, node, absX, absY, absW, absH, opacity);
        break;
      case "ellipse":
        this.drawEllipse(canvas, node, absX, absY, absW, absH, opacity);
        break;
      case "line":
        this.drawLine(canvas, node, absX, absY, opacity);
        break;
      case "polygon":
        this.drawPolygon(canvas, node, absX, absY, absW, absH, opacity);
        break;
      case "path":
        this.drawPath(canvas, node, absX, absY, absW, absH, opacity);
        break;
      case "icon_font":
        this.drawIconFont(canvas, node, absX, absY, absW, absH, opacity);
        break;
      case "text":
        this.textRenderer.drawText(
          canvas,
          node,
          absX,
          absY,
          absW,
          absH,
          opacity,
          effects,
        );
        break;
      case "image":
        this.drawImage(canvas, node, absX, absY, absW, absH, opacity);
        break;
    }

    if (node.type !== "text") {
      this.applyInnerShadowsDirect(
        canvas,
        node,
        effects,
        absX,
        absY,
        absW,
        absH,
        opacity,
      );
    }

    for (let i = 0; i < blurLayerCount; i += 1) canvas.restore();
    for (let i = 0; i < backdropBlurLayerCount; i += 1) {
      canvas.restore();
      canvas.restore();
    }
    if (blendLayerApplied) canvas.restore();
    if (!transformMatrix && rotation !== 0) canvas.restore();
    if (!transformMatrix && hasScaleSkew) canvas.restore();
    if (!transformMatrix && (flipX || flipY)) canvas.restore();
    if (transformMatrix) canvas.restore();
    if (maskOpacityLayerApplied) canvas.restore();
    if (clipped) canvas.restore();
  }

  // ---------------------------------------------------------------------------
  // Shape drawing
  // ---------------------------------------------------------------------------

  private clipBackdropBlurShape(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const path = this.makeMaskClipPath(node, x, y, w, h);
    if (path) {
      canvas.clipPath(path, this.ck.ClipOp.Intersect, true);
      path.delete();
      return;
    }

    this.clipRectShape(
      canvas,
      x,
      y,
      w,
      h,
      cornerRadii((node as PenNode & ContainerProps).cornerRadius),
      undefined,
      (node as PenNode & ContainerProps).cornerSmoothing,
    );
  }

  private makeNodeShapePath(
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
  ): import("canvaskit-wasm").Path | null {
    const ck = this.ck;
    if (w <= 0 || h <= 0) return null;

    switch (node.type) {
      case "frame":
      case "rectangle":
      case "group": {
        const container = node as PenNode & ContainerProps;
        return this.makeRoundedRectPath(
          x,
          y,
          w,
          h,
          cornerRadii(container.cornerRadius),
          container.cornerSmoothing,
        );
      }
      case "image": {
        const radius = cornerRadiusValue((node as ImageNode).cornerRadius);
        return this.makeRoundedRectPath(x, y, w, h, [
          radius,
          radius,
          radius,
          radius,
        ]);
      }
      case "ellipse": {
        const eNode = node as EllipseNode;
        if (
          isArcEllipse(eNode.startAngle, eNode.sweepAngle, eNode.innerRadius)
        ) {
          const arcD = buildEllipseArcPath(
            w,
            h,
            eNode.startAngle ?? 0,
            eNode.sweepAngle ?? 360,
            eNode.innerRadius ?? 0,
          );
          const path = ck.Path.MakeFromSVGString(arcD);
          path?.offset(x, y);
          return path;
        }
        const path = new ck.Path();
        path.addOval(ck.LTRBRect(x, y, x + w, y + h));
        return path;
      }
      case "polygon":
        return this.makePolygonShapePath(node as PolygonNode, x, y, w, h);
      case "path":
        return this.makePathShapePath(node as PathNode, x, y, w, h);
      default: {
        const path = new ck.Path();
        path.addRect(ck.LTRBRect(x, y, x + w, y + h));
        return path;
      }
    }
  }

  private clipRectShape(
    canvas: Canvas,
    x: number,
    y: number,
    w: number,
    h: number,
    cr: [number, number, number, number],
    op: import("canvaskit-wasm").ClipOp = this.ck.ClipOp.Intersect,
    cornerSmoothing?: number,
  ) {
    const ck = this.ck;
    if (cr.some((r) => r > 0)) {
      const path = this.makeRoundedRectPath(x, y, w, h, cr, cornerSmoothing);
      canvas.clipPath(path, op, true);
      path.delete();
      return;
    }

    canvas.clipRect(ck.LTRBRect(x, y, x + w, y + h), op, true);
  }

  private makeRoundedRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    cr: [number, number, number, number],
    cornerSmoothing?: number,
  ): import("canvaskit-wasm").Path {
    const ck = this.ck;
    const [tl, tr, br, bl] = normalizeRoundedRectRadii(cr, w, h);
    const path = new ck.Path();
    if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
      path.addRect(ck.LTRBRect(x, y, x + w, y + h));
      return path;
    }

    const k = getRoundedRectCornerControlFactor(cornerSmoothing);
    path.moveTo(x + tl, y);
    path.lineTo(x + w - tr, y);
    if (tr > 0) {
      path.cubicTo(
        x + w - tr + tr * k,
        y,
        x + w,
        y + tr - tr * k,
        x + w,
        y + tr,
      );
    }
    path.lineTo(x + w, y + h - br);
    if (br > 0) {
      path.cubicTo(
        x + w,
        y + h - br + br * k,
        x + w - br + br * k,
        y + h,
        x + w - br,
        y + h,
      );
    }
    path.lineTo(x + bl, y + h);
    if (bl > 0) {
      path.cubicTo(
        x + bl - bl * k,
        y + h,
        x,
        y + h - bl + bl * k,
        x,
        y + h - bl,
      );
    }
    path.lineTo(x, y + tl);
    if (tl > 0) {
      path.cubicTo(x, y + tl - tl * k, x + tl - tl * k, y, x + tl, y);
    }
    path.close();
    return path;
  }

  private drawAlignedClosedPathStroke(
    canvas: Canvas,
    path: import("canvaskit-wasm").Path,
    strokePaint: Paint,
    stroke: PenStroke | undefined,
  ) {
    const alignPlan = getClosedShapeStrokeAlignPlan(stroke?.align);
    if (alignPlan.clip === "none") {
      canvas.drawPath(path, strokePaint);
      return;
    }

    canvas.save();
    canvas.clipPath(
      path,
      alignPlan.clip === "inside"
        ? this.ck.ClipOp.Intersect
        : this.ck.ClipOp.Difference,
      true,
    );
    canvas.drawPath(path, strokePaint);
    canvas.restore();
  }

  private drawRectStroke(
    canvas: Canvas,
    stroke: PenStroke | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    hasRoundedCorners: boolean,
    cr: [number, number, number, number],
    cornerSmoothing: number | undefined,
    drawRoundedStroke: (paint: Paint) => void,
  ) {
    if (!stroke) return;
    const bounds = { x, y, w, h };
    if (!Array.isArray(stroke.thickness)) {
      const alignPlan = getClosedShapeStrokeAlignPlan(stroke.align);
      if (alignPlan.clip !== "none") {
        canvas.save();
        this.clipRectShape(
          canvas,
          x,
          y,
          w,
          h,
          cr,
          alignPlan.clip === "inside"
            ? this.ck.ClipOp.Intersect
            : this.ck.ClipOp.Difference,
          cornerSmoothing,
        );
      }
      this.drawStrokePaintLayers(
        stroke,
        opacity,
        bounds,
        { alignClosedShape: true },
        drawRoundedStroke,
      );
      if (alignPlan.clip !== "none") canvas.restore();
      return;
    }

    const [top, right, bottom, left] = stroke.thickness;
    const sides = getRectIndependentStrokeSides(
      bounds,
      [top, right, bottom, left],
      stroke.align,
      hasRoundedCorners ? cr : [0, 0, 0, 0],
    );
    const alignPlan = getClosedShapeStrokeAlignPlan(stroke.align);
    if (hasRoundedCorners && alignPlan.clip !== "none") {
      canvas.save();
      this.clipRectShape(
        canvas,
        x,
        y,
        w,
        h,
        cr,
        alignPlan.clip === "inside"
          ? this.ck.ClipOp.Intersect
          : this.ck.ClipOp.Difference,
        cornerSmoothing,
      );
    }

    for (const side of sides) {
      if (side.thickness <= 0) continue;
      this.drawStrokePaintLayers(
        stroke,
        opacity,
        bounds,
        {
          thicknessOverride: side.thickness,
          preparePaint: (strokePaint) => {
            strokePaint.setStrokeCap(this.ck.StrokeCap.Square);
          },
        },
        (strokePaint) => {
          canvas.drawLine(side.x1, side.y1, side.x2, side.y2, strokePaint);
        },
      );
    }
    if (hasRoundedCorners && alignPlan.clip !== "none") canvas.restore();
  }

  private drawRect(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const container = node as PenNode & ContainerProps;
    const cr = cornerRadii(container.cornerRadius);
    const fills = container.fill;
    const stroke = container.stroke;
    const isContainer = node.type === "frame" || node.type === "group";
    const cornerSmoothing = container.cornerSmoothing;
    const hasRoundedCorners = cr.some((r) => r > 0);

    const drawPaintedRect = (paint: Paint) => {
      if (hasRoundedCorners) {
        const path = this.makeRoundedRectPath(x, y, w, h, cr, cornerSmoothing);
        canvas.drawPath(path, paint);
        path.delete();
      } else {
        canvas.drawRect(ck.LTRBRect(x, y, x + w, y + h), paint);
      }
    };

    const drawImageFill = (imageFillDraw: {
      fill: ImageFill;
      w: number;
      h: number;
      absX: number;
      absY: number;
      opacity: number;
    }) => {
      canvas.save();
      this.clipRectShape(canvas, x, y, w, h, cr, undefined, cornerSmoothing);
      this.drawImageFillRect(
        canvas,
        imageFillDraw.fill,
        imageFillDraw.w,
        imageFillDraw.h,
        imageFillDraw.absX,
        imageFillDraw.absY,
        imageFillDraw.opacity,
      );
      canvas.restore();
    };

    const fillLayers = getVisibleFillLayers(fills, stroke, isContainer);

    for (const fillLayer of fillLayers) {
      const { paint: fillPaint, imageFillDraw } = this.makeFillPaint(
        typeof fillLayer === "string" ? fillLayer : [fillLayer],
        w,
        h,
        opacity,
        x,
        y,
      );
      drawPaintedRect(fillPaint);
      fillPaint.delete();
      if (imageFillDraw) drawImageFill(imageFillDraw);
    }

    this.drawRectStroke(
      canvas,
      stroke,
      x,
      y,
      w,
      h,
      opacity,
      hasRoundedCorners,
      cr,
      cornerSmoothing,
      (strokePaint) => {
        if (hasRoundedCorners) {
          const path = this.makeRoundedRectPath(
            x,
            y,
            w,
            h,
            cr,
            cornerSmoothing,
          );
          canvas.drawPath(path, strokePaint);
          path.delete();
        } else {
          canvas.drawRect(ck.LTRBRect(x, y, x + w, y + h), strokePaint);
        }
      },
    );
  }

  private drawEllipse(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const eNode = node as EllipseNode;
    const fills = eNode.fill;
    const stroke = eNode.stroke;
    const cr = cornerRadiusValue(eNode.cornerRadius);
    const fillLayers = getVisibleFillLayers(fills, stroke);

    if (isArcEllipse(eNode.startAngle, eNode.sweepAngle, eNode.innerRadius)) {
      const arcD = buildEllipseArcPath(
        w,
        h,
        eNode.startAngle ?? 0,
        eNode.sweepAngle ?? 360,
        eNode.innerRadius ?? 0,
      );
      const path = ck.Path.MakeFromSVGString(arcD);
      if (path) {
        path.offset(x, y);
        for (const fillLayer of fillLayers) {
          const { paint: fillPaint, imageFillDraw } = this.makeFillPaint(
            typeof fillLayer === "string" ? fillLayer : [fillLayer],
            w,
            h,
            opacity,
            x,
            y,
          );
          if (cr > 0) {
            const effect = ck.PathEffect.MakeCorner(cr);
            if (effect) fillPaint.setPathEffect(effect);
          }
          canvas.drawPath(path, fillPaint);
          fillPaint.delete();
          if (imageFillDraw) {
            this.drawImageFillClippedToPath(canvas, path, imageFillDraw);
          }
        }
        this.drawStrokePaintLayers(
          stroke,
          opacity,
          {
            x,
            y,
            w,
            h,
          },
          {
            alignClosedShape: true,
            preparePaint: (strokePaint) => {
              if (cr > 0) {
                const effect = ck.PathEffect.MakeCorner(cr);
                if (effect) strokePaint.setPathEffect(effect);
              }
            },
          },
          (strokePaint) => {
            this.drawAlignedClosedPathStroke(canvas, path, strokePaint, stroke);
          },
        );
        path.delete();
      }
      return;
    }

    for (const fillLayer of fillLayers) {
      const { paint: fillPaint, imageFillDraw } = this.makeFillPaint(
        typeof fillLayer === "string" ? fillLayer : [fillLayer],
        w,
        h,
        opacity,
        x,
        y,
      );
      canvas.drawOval(ck.LTRBRect(x, y, x + w, y + h), fillPaint);
      fillPaint.delete();
      if (imageFillDraw) {
        const ovalPath = new ck.Path();
        ovalPath.addOval(ck.LTRBRect(x, y, x + w, y + h));
        this.drawImageFillClippedToPath(canvas, ovalPath, imageFillDraw);
        ovalPath.delete();
      }
    }
    const ovalPath = new ck.Path();
    ovalPath.addOval(ck.LTRBRect(x, y, x + w, y + h));
    this.drawStrokePaintLayers(
      stroke,
      opacity,
      { x, y, w, h },
      { alignClosedShape: true },
      (strokePaint) => {
        this.drawAlignedClosedPathStroke(canvas, ovalPath, strokePaint, stroke);
      },
    );
    ovalPath.delete();
  }

  private drawLine(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const lNode = node as LineNode;
    const x2 = lNode.x2 ?? x + 100;
    const y2 = lNode.y2 ?? y;
    const stroke = lNode.stroke ?? {
      thickness: DEFAULT_STROKE_WIDTH,
      fill: [{ type: "solid", color: DEFAULT_STROKE }],
    };
    const strokeWidth = resolveStrokeWidth(stroke) || DEFAULT_STROKE_WIDTH;
    const strokeBounds = {
      x: Math.min(x, x2),
      y: Math.min(y, y2),
      w: Math.abs(x2 - x),
      h: Math.abs(y2 - y),
    };
    this.drawStrokePaintLayers(
      stroke,
      opacity,
      strokeBounds,
      {
        preparePaint: (paint) => {
          if (shouldUseRoundLineCapFallback(lNode)) {
            paint.setStrokeCap(ck.StrokeCap.Round);
          }
        },
      },
      (paint) => {
        canvas.drawLine(x, y, x2, y2, paint);
        if (
          (lNode as unknown as { _connectorType?: string })._connectorType ===
          "arrow"
        ) {
          const dx = x2 - x;
          const dy = y2 - y;
          if (Math.hypot(dx, dy) > 0) {
            const angle = Math.atan2(dy, dx);
            const size = Math.max(strokeWidth * 3.5, 10);
            const leftX = x2 - Math.cos(angle - Math.PI / 6) * size;
            const leftY = y2 - Math.sin(angle - Math.PI / 6) * size;
            const rightX = x2 - Math.cos(angle + Math.PI / 6) * size;
            const rightY = y2 - Math.sin(angle + Math.PI / 6) * size;
            canvas.drawLine(x2, y2, leftX, leftY, paint);
            canvas.drawLine(x2, y2, rightX, rightY, paint);
          }
        }
      },
    );
  }

  private drawPolygon(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const pNode = node as PolygonNode;
    const count = Math.max(3, Math.round(pNode.polygonCount || 6));
    const fills = pNode.fill;
    const stroke = pNode.stroke;
    const cr = cornerRadiusValue(pNode.cornerRadius);
    const fillLayers = getVisibleFillLayers(fills, stroke);

    const raw: [number, number][] = [];
    const startAngle = ((pNode.startAngle ?? -90) * Math.PI) / 180;
    if (pNode.polygonKind === "star") {
      const innerRadius = Math.min(
        0.99,
        Math.max(0.01, pNode.innerRadius ?? 0.5),
      );
      const pointCount = count * 2;
      for (let i = 0; i < pointCount; i++) {
        const radius = i % 2 === 0 ? 1 : innerRadius;
        const angle = startAngle + (i * 2 * Math.PI) / pointCount;
        raw.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    } else {
      for (let i = 0; i < count; i++) {
        const angle = startAngle + (i * 2 * Math.PI) / count;
        raw.push([Math.cos(angle), Math.sin(angle)]);
      }
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [rx, ry] of raw) {
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const rawW = maxX - minX;
    const rawH = maxY - minY;

    const path = new ck.Path();
    for (let i = 0; i < raw.length; i++) {
      const pt = raw[i];
      if (!pt) continue;
      const px = x + ((pt[0] - minX) / rawW) * w;
      const py = y + ((pt[1] - minY) / rawH) * h;
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.close();

    for (const fillLayer of fillLayers) {
      const { paint: fillPaint, imageFillDraw } = this.makeFillPaint(
        typeof fillLayer === "string" ? fillLayer : [fillLayer],
        w,
        h,
        opacity,
        x,
        y,
      );
      if (cr > 0) {
        const effect = ck.PathEffect.MakeCorner(cr);
        if (effect) fillPaint.setPathEffect(effect);
      }
      canvas.drawPath(path, fillPaint);
      fillPaint.delete();
      if (imageFillDraw) {
        this.drawImageFillClippedToPath(canvas, path, imageFillDraw);
      }
    }
    this.drawStrokePaintLayers(
      stroke,
      opacity,
      { x, y, w, h },
      {
        alignClosedShape: true,
        preparePaint: (strokePaint) => {
          if (cr > 0) {
            const effect = ck.PathEffect.MakeCorner(cr);
            if (effect) strokePaint.setPathEffect(effect);
          }
        },
      },
      (strokePaint) => {
        this.drawAlignedClosedPathStroke(canvas, path, strokePaint, stroke);
      },
    );
    path.delete();
  }

  private makeMaskClipPath(
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
  ): import("canvaskit-wasm").Path | null {
    const ck = this.ck;
    if (w <= 0 || h <= 0) return null;

    switch (node.type) {
      case "ellipse": {
        const eNode = node as EllipseNode;
        if (
          isArcEllipse(eNode.startAngle, eNode.sweepAngle, eNode.innerRadius)
        ) {
          const arcD = buildEllipseArcPath(
            w,
            h,
            eNode.startAngle ?? 0,
            eNode.sweepAngle ?? 360,
            eNode.innerRadius ?? 0,
          );
          const path = ck.Path.MakeFromSVGString(arcD);
          path?.offset(x, y);
          return path;
        }
        const path = new ck.Path();
        path.addOval(ck.LTRBRect(x, y, x + w, y + h));
        return path;
      }
      case "polygon":
        return this.makePolygonShapePath(node as PolygonNode, x, y, w, h);
      case "path":
        return this.makePathShapePath(node as PathNode, x, y, w, h);
      default:
        return null;
    }
  }

  private makePolygonShapePath(
    pNode: PolygonNode,
    x: number,
    y: number,
    w: number,
    h: number,
  ): import("canvaskit-wasm").Path {
    const count = Math.max(3, Math.round(pNode.polygonCount || 6));
    const raw: [number, number][] = [];
    const startAngle = ((pNode.startAngle ?? -90) * Math.PI) / 180;
    if (pNode.polygonKind === "star") {
      const innerRadius = Math.min(
        0.99,
        Math.max(0.01, pNode.innerRadius ?? 0.5),
      );
      const pointCount = count * 2;
      for (let i = 0; i < pointCount; i++) {
        const radius = i % 2 === 0 ? 1 : innerRadius;
        const angle = startAngle + (i * 2 * Math.PI) / pointCount;
        raw.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    } else {
      for (let i = 0; i < count; i++) {
        const angle = startAngle + (i * 2 * Math.PI) / count;
        raw.push([Math.cos(angle), Math.sin(angle)]);
      }
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [rx, ry] of raw) {
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const rawW = Math.max(0.0001, maxX - minX);
    const rawH = Math.max(0.0001, maxY - minY);

    const path = new this.ck.Path();
    for (let i = 0; i < raw.length; i++) {
      const pt = raw[i];
      if (!pt) continue;
      const px = x + ((pt[0] - minX) / rawW) * w;
      const py = y + ((pt[1] - minY) / rawH) * h;
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.close();
    return path;
  }

  private makePathShapePath(
    pNode: PathNode,
    x: number,
    y: number,
    w: number,
    h: number,
  ): import("canvaskit-wasm").Path | null {
    const rawD =
      typeof pNode.d === "string" && pNode.d.trim().length > 0
        ? pNode.d
        : "M0 0 L0 0";
    const geometry = this.getCachedPathGeometry(pNode, rawD);
    if (!geometry) return null;
    this.transformPathToNodeBounds(geometry.path, geometry.bounds, x, y, w, h);
    return geometry.path;
  }

  private getPathCacheKey(pNode: PathNode, rawD: string): string {
    const anchorKey = pNode.anchors
      ? JSON.stringify({ anchors: pNode.anchors, closed: pNode.closed })
      : "";
    return [
      pNode.id,
      pNode.iconId ?? "",
      pNode.fillRule ?? "nonzero",
      rawD,
      anchorKey,
    ].join("\u0001");
  }

  private cloneCachedPath(entry: PathCacheEntry): SkiaPath | null {
    const copy = (entry.path as SkiaPath & { copy?: () => SkiaPath }).copy?.();
    if (copy) return copy;
    if (hasInvalidNumbers(entry.rawD)) {
      return tryManualPathParse(this.ck, entry.rawD) as SkiaPath | null;
    }
    const sanitized = sanitizeSvgPath(entry.rawD);
    return (
      this.ck.Path.MakeFromSVGString(sanitized) ??
      (sanitized !== entry.rawD
        ? this.ck.Path.MakeFromSVGString(entry.rawD)
        : null) ??
      (tryManualPathParse(this.ck, entry.rawD) as SkiaPath | null)
    );
  }

  private getCachedPathGeometry(
    pNode: PathNode,
    rawD: string,
  ): { bounds: Float32Array; path: SkiaPath } | null {
    const key = this.getPathCacheKey(pNode, rawD);
    const cached = this.pathCache.get(key);
    if (cached) {
      this.pathCacheHits += 1;
      cached.lastUsed = ++this.pathCacheTick;
      const path = this.cloneCachedPath(cached);
      if (path) {
        this.applyBasePathFillType(path, pNode);
        return { bounds: cached.bounds, path };
      }
      this.pathCache.delete(key);
      cached.path.delete();
    }

    this.pathCacheMisses += 1;
    const path = this.createBasePath(pNode, rawD);
    if (!path) return null;
    const bounds = this.resolvePathBounds(pNode, rawD, path);
    path.setFillType(
      pNode.fillRule === "evenodd"
        ? this.ck.FillType.EvenOdd
        : this.ck.FillType.Winding,
    );
    const entry: PathCacheEntry = {
      bounds,
      lastUsed: ++this.pathCacheTick,
      path,
      rawD,
    };
    this.pathCache.set(key, entry);
    this.evictPathCacheIfNeeded();
    const cloned = this.cloneCachedPath(entry);
    if (!cloned) return null;
    this.applyBasePathFillType(cloned, pNode);
    return { bounds, path: cloned };
  }

  private createBasePath(pNode: PathNode, rawD: string): SkiaPath | null {
    if (hasInvalidNumbers(rawD)) {
      return tryManualPathParse(this.ck, rawD) as SkiaPath | null;
    }
    const sanitized = sanitizeSvgPath(rawD);
    return (
      this.ck.Path.MakeFromSVGString(sanitized) ??
      (sanitized !== rawD ? this.ck.Path.MakeFromSVGString(rawD) : null) ??
      (tryManualPathParse(this.ck, rawD) as SkiaPath | null)
    );
  }

  private resolvePathBounds(
    pNode: PathNode,
    rawD: string,
    path: SkiaPath,
  ): Float32Array {
    const parsedAnchors = pNode.anchors
      ? {
          anchors: pNode.anchors,
          closed: pNode.closed ?? /[Zz]\s*$/.test(rawD),
        }
      : pathDataToAnchors(rawD);
    const geometryBounds = parsedAnchors
      ? getPathBoundsFromAnchors(parsedAnchors.anchors, parsedAnchors.closed)
      : null;
    return geometryBounds
      ? Float32Array.of(
          geometryBounds.x,
          geometryBounds.y,
          geometryBounds.x + geometryBounds.width,
          geometryBounds.y + geometryBounds.height,
        )
      : path.getBounds();
  }

  private applyBasePathFillType(path: SkiaPath, pNode: PathNode) {
    path.setFillType(
      pNode.fillRule === "evenodd"
        ? this.ck.FillType.EvenOdd
        : this.ck.FillType.Winding,
    );
  }

  private transformPathToNodeBounds(
    path: SkiaPath,
    bounds: Float32Array,
    x: number,
    y: number,
    w: number,
    h: number,
    preserveAspectRatio = false,
  ) {
    const b0 = bounds[0] ?? 0;
    const b1 = bounds[1] ?? 0;
    const nativeW = (bounds[2] ?? 0) - b0;
    const nativeH = (bounds[3] ?? 0) - b1;
    if (w > 0 && h > 0 && nativeW > 0.01 && nativeH > 0.01) {
      const sx = preserveAspectRatio
        ? Math.min(w / nativeW, h / nativeH)
        : w / nativeW;
      const sy = preserveAspectRatio ? sx : h / nativeH;
      path.transform(
        this.ck.Matrix.multiply(
          this.ck.Matrix.translated(x - b0 * sx, y - b1 * sy),
          this.ck.Matrix.scaled(sx, sy),
        ),
      );
      return;
    }
    if (nativeW > 0.01 || nativeH > 0.01) {
      const sx = nativeW > 0.01 && w > 0 ? w / nativeW : 1;
      const sy = nativeH > 0.01 && h > 0 ? h / nativeH : 1;
      path.transform(
        this.ck.Matrix.multiply(
          this.ck.Matrix.translated(x - b0 * sx, y - b1 * sy),
          this.ck.Matrix.scaled(sx, sy),
        ),
      );
      return;
    }
    path.offset(x, y);
  }

  private evictPathCacheIfNeeded() {
    while (this.pathCache.size > PATH_CACHE_MAX) {
      let oldestKey: string | null = null;
      let oldestTick = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.pathCache) {
        if (entry.lastUsed < oldestTick) {
          oldestKey = key;
          oldestTick = entry.lastUsed;
        }
      }
      if (!oldestKey) return;
      const entry = this.pathCache.get(oldestKey);
      this.pathCache.delete(oldestKey);
      entry?.path.delete();
      this.pathCacheEvictions += 1;
    }
  }

  private drawPath(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const pNode = node as PathNode;
    const rawD =
      typeof pNode.d === "string" && pNode.d.trim().length > 0
        ? pNode.d
        : "M0 0 L0 0";
    const fills = pNode.fill;
    const stroke = pNode.stroke;

    const geometry = this.getCachedPathGeometry(pNode, rawD);
    if (!geometry) {
      if (w > 0 && h > 0) {
        const { paint: fp } = this.makeFillPaint(fills, w, h, opacity, x, y);
        canvas.drawRect(ck.LTRBRect(x, y, x + w, y + h), fp);
        fp.delete();
      }
      return;
    }
    const { path } = geometry;
    this.transformPathToNodeBounds(
      path,
      geometry.bounds,
      x,
      y,
      w,
      h,
      Boolean(pNode.iconId),
    );

    const fillLayers = getVisibleFillLayers(fills, stroke);
    const strokeWidth = resolveStrokeWidth(stroke);
    const hasVisibleStroke =
      strokeWidth > 0 && getVisibleStrokePaintLayers(stroke).length > 0;
    const isClosedPath = pNode.anchors
      ? (pNode.closed ?? /[Zz]\s*$/.test(rawD))
      : /[Zz]\s*$/.test(rawD);

    if (fillLayers.length > 0 || !hasVisibleStroke) {
      const closeCount = (rawD.match(/Z/gi) || []).length;
      path.setFillType(
        pNode.fillRule === "evenodd" || (!pNode.fillRule && closeCount > 1)
          ? ck.FillType.EvenOdd
          : ck.FillType.Winding,
      );
      const layers = fillLayers.length > 0 ? fillLayers : [undefined];
      for (const fillLayer of layers) {
        const { paint: fillPaint, imageFillDraw } = this.makeFillPaint(
          fillLayer === undefined
            ? undefined
            : typeof fillLayer === "string"
              ? fillLayer
              : [fillLayer],
          w,
          h,
          opacity,
          x,
          y,
        );
        canvas.drawPath(path, fillPaint);
        fillPaint.delete();
        if (imageFillDraw) {
          this.drawImageFillClippedToPath(canvas, path, imageFillDraw);
        }
      }
    }
    if (hasVisibleStroke) {
      this.drawStrokePaintLayers(
        stroke,
        opacity,
        { x, y, w, h },
        { alignClosedShape: isClosedPath },
        (sp) => {
          if (isClosedPath) {
            this.drawAlignedClosedPathStroke(canvas, path, sp, stroke);
          } else {
            canvas.drawPath(path, sp);
          }
        },
      );
    }
    path.delete();
  }

  private drawIconFont(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const iNode = node as IconFontNode;
    const iconName = iNode.iconFontName ?? iNode.name ?? "";
    const iconMatch = this.iconLookup?.(iconName) ?? null;
    const iconD = iconMatch?.d ?? FALLBACK_ICON_D;
    const iconStyle = iconMatch?.style ?? "stroke";

    const rawFill = iNode.fill;
    const iconFillColor =
      typeof rawFill === "string"
        ? rawFill
        : Array.isArray(iNode.fill) && iNode.fill.length > 0
          ? resolveFillColor(iNode.fill)
          : "#64748B";

    const sanitizedIconD = sanitizeSvgPath(iconD);
    let path = ck.Path.MakeFromSVGString(sanitizedIconD);
    if (!path && sanitizedIconD !== iconD)
      path = ck.Path.MakeFromSVGString(iconD);
    if (!path) path = tryManualPathParse(ck, iconD);
    if (!path) return;

    const bounds = path.getBounds();
    const b2 = bounds[2] ?? 0;
    const b0 = bounds[0] ?? 0;
    const b3 = bounds[3] ?? 0;
    const b1 = bounds[1] ?? 0;
    const nativeW = b2 - b0;
    const nativeH = b3 - b1;
    if (w > 0 && h > 0 && nativeW > 0 && nativeH > 0) {
      const s = Math.min(w / nativeW, h / nativeH);
      path.transform(
        ck.Matrix.multiply(
          ck.Matrix.translated(x - b0 * s, y - b1 * s),
          ck.Matrix.scaled(s, s),
        ),
      );
    } else {
      path.offset(x, y);
    }

    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    const c = parseColor(ck, iconFillColor);
    c[3] = (c[3] ?? 1) * opacity;
    paint.setColor(c);
    if (iconStyle === "stroke") {
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(2);
      paint.setStrokeCap(ck.StrokeCap.Round);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
    } else {
      paint.setStyle(ck.PaintStyle.Fill);
      path.setFillType(ck.FillType.EvenOdd);
    }
    canvas.drawPath(path, paint);
    paint.delete();
    path.delete();
  }

  // ---------------------------------------------------------------------------
  // Image drawing
  // ---------------------------------------------------------------------------

  private drawImage(
    canvas: Canvas,
    node: PenNode,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
  ) {
    const ck = this.ck;
    const iNode = node as ImageNode;
    const src: string | undefined = iNode.src;
    const cr = cornerRadiusValue(iNode.cornerRadius);

    if (!src) {
      this.drawImageFallback(canvas, x, y, w, h, cr, opacity, false);
      return;
    }

    const cached = this.imageLoader.getForDisplay(src, {
      targetWidth: w,
      targetHeight: h,
      zoom: this.zoom,
      devicePixelRatio: this.devicePixelRatio,
      interactionMode: this.interactionMode,
    });
    if (cached === undefined) {
      this.imageLoader.request(src);
      this.drawImageFallback(canvas, x, y, w, h, cr, opacity, false);
      return;
    }
    if (!cached) {
      const status = this.imageLoader.getStatus(src);
      this.drawImageFallback(
        canvas,
        x,
        y,
        w,
        h,
        cr,
        opacity,
        status?.state === "missing" || status?.state === "error",
      );
      return;
    }

    const imgW = cached.width();
    const imgH = cached.height();

    if (cr > 0) {
      canvas.save();
      const maxR = Math.min(cr, w / 2, h / 2);
      canvas.clipRRect(
        ck.RRectXY(ck.LTRBRect(x, y, x + w, y + h), maxR, maxR),
        ck.ClipOp.Intersect,
        true,
      );
    } else {
      canvas.save();
      canvas.clipRect(
        ck.LTRBRect(x, y, x + w, y + h),
        ck.ClipOp.Intersect,
        true,
      );
    }

    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    if (opacity < 1) paint.setAlphaf(opacity);
    this.setPaintColorFilter(paint, this.buildImageAdjustmentFilter(iNode));

    const fit = iNode.objectFit ?? "fill";
    const { filterMode, mipmapMode } = this.getImageSamplingOptions();
    if (fit === "tile") {
      const tileMatrix = Float32Array.of(1, 0, -x, 0, 1, -y, 0, 0, 1);
      const shader = cached.makeShaderOptions(
        ck.TileMode.Repeat,
        ck.TileMode.Repeat,
        filterMode,
        mipmapMode,
        tileMatrix,
      );
      if (shader) {
        this.setPaintShader(paint, shader);
        canvas.drawRect(ck.LTRBRect(x, y, x + w, y + h), paint);
      }
    } else {
      const bgPaint = new ck.Paint();
      if (fit === "fit") {
        bgPaint.setStyle(ck.PaintStyle.Fill);
        bgPaint.setColor(parseColor(ck, "#f3f4f6"));
        if (opacity < 1) bgPaint.setAlphaf(opacity * 0.3);
        else bgPaint.setAlphaf(0.3);
        canvas.drawRect(ck.LTRBRect(x, y, x + w, y + h), bgPaint);
      }
      bgPaint.delete();
      const rect = getImageObjectFitDrawRect(fit, imgW, imgH, { x, y, w, h });
      canvas.drawImageRectOptions(
        cached,
        ck.LTRBRect(0, 0, imgW, imgH),
        ck.LTRBRect(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h),
        filterMode,
        mipmapMode,
        paint,
      );
    }
    paint.delete();
    canvas.restore();
  }

  private drawImageFallback(
    canvas: Canvas,
    x: number,
    y: number,
    w: number,
    h: number,
    cr: number,
    opacity: number,
    emphasizeMissing: boolean,
  ) {
    const ck = this.ck;
    const rect = ck.LTRBRect(x, y, x + w, y + h);
    const maxR = Math.min(cr, w / 2, h / 2);

    const fillPaint = new ck.Paint();
    fillPaint.setStyle(ck.PaintStyle.Fill);
    fillPaint.setAntiAlias(true);
    const fillColor = parseColor(ck, emphasizeMissing ? "#f8d7da" : "#e5e7eb");
    fillColor[3] = (fillColor[3] ?? 1) * opacity;
    fillPaint.setColor(fillColor);

    if (cr > 0) {
      canvas.drawRRect(ck.RRectXY(rect, maxR, maxR), fillPaint);
    } else {
      canvas.drawRect(rect, fillPaint);
    }
    fillPaint.delete();

    const strokePaint = new ck.Paint();
    strokePaint.setStyle(ck.PaintStyle.Stroke);
    strokePaint.setAntiAlias(true);
    strokePaint.setStrokeWidth(Math.max(1, Math.min(w, h) * 0.02));
    const strokeColor = parseColor(
      ck,
      emphasizeMissing ? "#c2410c" : "#94a3b8",
    );
    strokeColor[3] = (strokeColor[3] ?? 1) * opacity;
    strokePaint.setColor(strokeColor);
    const dash = ck.PathEffect.MakeDash([8, 6], 0);
    if (dash) strokePaint.setPathEffect(dash);

    if (cr > 0) {
      canvas.drawRRect(ck.RRectXY(rect, maxR, maxR), strokePaint);
    } else {
      canvas.drawRect(rect, strokePaint);
    }

    const iconPaint = new ck.Paint();
    iconPaint.setStyle(ck.PaintStyle.Stroke);
    iconPaint.setAntiAlias(true);
    iconPaint.setStrokeWidth(Math.max(1.25, Math.min(w, h) * 0.03));
    iconPaint.setStrokeCap(ck.StrokeCap.Round);
    iconPaint.setStrokeJoin(ck.StrokeJoin.Round);
    iconPaint.setColor(strokeColor);

    const inset = Math.max(10, Math.min(w, h) * 0.18);
    const iconLeft = x + inset;
    const iconTop = y + inset;
    const iconRight = x + w - inset;
    const iconBottom = y + h - inset;
    const iconPath = new ck.Path();
    iconPath.moveTo(iconLeft, iconBottom);
    iconPath.lineTo(x + w * 0.42, y + h * 0.58);
    iconPath.lineTo(x + w * 0.58, y + h * 0.72);
    iconPath.lineTo(iconRight, y + h * 0.42);
    iconPath.moveTo(iconLeft, iconTop);
    iconPath.lineTo(iconRight, iconTop);
    iconPath.lineTo(iconRight, iconBottom);
    iconPath.lineTo(iconLeft, iconBottom);
    iconPath.close();
    canvas.drawPath(iconPath, iconPaint);
    iconPath.delete();

    const dotPaint = new ck.Paint();
    dotPaint.setStyle(ck.PaintStyle.Fill);
    dotPaint.setAntiAlias(true);
    dotPaint.setColor(strokeColor);
    canvas.drawCircle(
      x + w * 0.35,
      y + h * 0.38,
      Math.max(3, Math.min(w, h) * 0.05),
      dotPaint,
    );

    if (emphasizeMissing) {
      canvas.drawLine(
        x + inset * 0.9,
        y + h - inset * 0.9,
        x + w - inset * 0.9,
        y + inset * 0.9,
        iconPaint,
      );
    }

    strokePaint.delete();
    iconPaint.delete();
    dotPaint.delete();
  }
}
