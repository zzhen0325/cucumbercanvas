"use client";

import type {
  AgentBinding,
  CanvasBounds,
  CanvasFill,
  CanvasStroke,
  PenEffect,
  PenNode,
} from "@cucumber/canvas-core";
import {
  getCanvasImportedNodeMeta,
  getNodeBounds,
} from "@cucumber/canvas-core";
import { pathDataToAnchors } from "@cucumber/pen-core";
import type {
  BlendMode,
  PenStrokeEndpointTip,
  PenStyleDefinition,
  StyledTextSegment,
  VariableDefinition,
} from "@cucumber/pen-types";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Box,
  ChevronDown,
  Columns3,
  Droplet,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Grid2X2,
  Italic,
  Link,
  Lock,
  type LucideIcon,
  Minus,
  MoreHorizontal,
  Move,
  Palette,
  Plus,
  RotateCw,
  Rows3,
  Scissors,
  SlidersHorizontal,
  Square,
  Type,
  Underline,
  Unlock,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

import { cn } from "../../../lib/utils";
import { isStickyNoteNode } from "../sticky-note-tool";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSolidFillColor(fills?: CanvasFill[]): string | undefined {
  if (!fills || fills.length === 0) return undefined;
  const first = fills[0];
  if (first?.type === "solid") return first.color;
  return undefined;
}

function extractSolidStrokeColor(stroke?: CanvasStroke): string | undefined {
  if (!stroke?.fill || stroke.fill.length === 0) return undefined;
  const first = stroke.fill[0];
  if (first?.type === "solid") return first.color;
  return undefined;
}

function supportsFill(node: PenNode): boolean {
  return ["rectangle", "ellipse", "polygon", "path", "icon_font"].includes(
    node.type,
  );
}

function supportsStroke(node: PenNode): boolean {
  return [
    "rectangle",
    "ellipse",
    "polygon",
    "path",
    "icon_font",
    "line",
  ].includes(node.type);
}

type NodeWithOptionalPaint = PenNode & {
  fill?: CanvasFill[];
  stroke?: CanvasStroke;
  effects?: PenEffect[];
  meta?: unknown;
  children?: PenNode[];
};

type LayoutEditableNode = PenNode & {
  layout?: "none" | "vertical" | "horizontal" | null;
  gap?: number | string | null;
  padding?:
    | number
    | [number, number]
    | [number, number, number, number]
    | string
    | null;
  justifyContent?: string | null;
  alignItems?: string | null;
};

type ClearLayoutUpdate = Partial<PenNode> & {
  layout: null;
  gap: null;
  padding: null;
  justifyContent: null;
  alignItems: null;
};

type CanvasVariableMap = Record<string, VariableDefinition>;
type CanvasStyleDefinitionMap = Record<string, PenStyleDefinition>;

type CanvasTransformMatrix = {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
};

type GradientPaint = Extract<CanvasFill, { stops: Array<unknown> }>;
type PaintTransformOwner = Extract<CanvasFill, { transform?: unknown }>;
type PathEditableNode = Extract<PenNode, { type: "path" }>;

type MaskEditableNode = PenNode & {
  mask?: NonNullable<PenNode["mask"]>;
};

type StyleRefKind = "fill" | "stroke" | "text" | "effect";
type LayoutSizingMode = "fixed" | "fit_content" | "fill_container";

function getNodeFill(node: PenNode): CanvasFill[] | undefined {
  return (node as NodeWithOptionalPaint).fill;
}

function getNodeStroke(node: PenNode): CanvasStroke | undefined {
  return (node as NodeWithOptionalPaint).stroke;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function nodeTypeLabel(type: PenNode["type"]): string {
  const labels: Partial<Record<PenNode["type"], string>> = {
    frame: "画框",
    group: "分组",
    rectangle: "矩形",
    ellipse: "椭圆",
    line: "线条",
    polygon: "多边形",
    path: "路径",
    text: "文本",
    image: "图片",
    icon_font: "图标",
    ref: "组件实例",
  };
  return labels[type] ?? type;
}

function isCssColorLike(color: string): boolean {
  return (
    color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")
  );
}

function toHexColor(color: string): string {
  if (/^#[0-9a-fA-F]{6}/.test(color)) return color.slice(0, 7);
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgb) return "#111827";
  const [, r = "0", g = "0", b = "0"] = rgb;
  return `#${[r, g, b]
    .map((channel) =>
      clamp(Number(channel), 0, 255).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function solidFillOpacity(fill?: CanvasFill): number {
  if (fill?.type !== "solid" || typeof fill.opacity !== "number") return 100;
  return Math.round(fill.opacity * 100);
}

function paintLayerOpacity(fill?: CanvasFill): number {
  if (!fill || typeof fill.opacity !== "number") return 100;
  return Math.round(fill.opacity * 100);
}

const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
  { value: "normal", label: "正常" },
  { value: "pass_through", label: "穿透" },
  { value: "multiply", label: "正片叠底" },
  { value: "screen", label: "滤色" },
  { value: "overlay", label: "叠加" },
  { value: "darken", label: "变暗" },
  { value: "lighten", label: "变亮" },
  { value: "color_burn", label: "颜色加深" },
  { value: "color_dodge", label: "颜色减淡" },
  { value: "linear_burn", label: "线性加深" },
  { value: "linear_dodge", label: "线性减淡" },
  { value: "hard_light", label: "强光" },
  { value: "soft_light", label: "柔光" },
  { value: "difference", label: "差值" },
  { value: "exclusion", label: "排除" },
  { value: "hue", label: "色相" },
  { value: "saturation", label: "饱和度" },
  { value: "color", label: "颜色" },
  { value: "luminosity", label: "明度" },
];

const FILL_TYPE_OPTIONS: Array<{ value: CanvasFill["type"]; label: string }> = [
  { value: "solid", label: "纯色" },
  { value: "linear_gradient", label: "线性渐变" },
  { value: "radial_gradient", label: "径向渐变" },
  { value: "angular_gradient", label: "角度渐变" },
  { value: "diamond_gradient", label: "菱形渐变" },
  { value: "image", label: "图片" },
];

type EffectInspectorType =
  | "shadow"
  | "inner_shadow"
  | "blur"
  | "background_blur";

const EFFECT_TYPE_OPTIONS: Array<{
  value: EffectInspectorType;
  label: string;
}> = [
  { value: "shadow", label: "投影" },
  { value: "inner_shadow", label: "内阴影" },
  { value: "blur", label: "图层模糊" },
  { value: "background_blur", label: "背景模糊" },
];

const PATH_COMMAND_PARAM_COUNTS: Record<string, number> = {
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
};

const PATH_COMMAND_RE = /^[AaCcHhLlMmQqSsTtVvZz]$/;
const PATH_TOKEN_RE =
  /[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/g;

function paintLayerMeta(fill?: CanvasFill): {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
} {
  const meta: { visible?: boolean; opacity?: number; blendMode?: BlendMode } =
    {};
  if (fill?.visible !== undefined) meta.visible = fill.visible;
  if (typeof fill?.opacity === "number") meta.opacity = fill.opacity;
  if (fill?.blendMode) meta.blendMode = fill.blendMode;
  return meta;
}

function fillPrimaryColor(fill?: CanvasFill): string {
  if (!fill) return "#d3f256";
  if (fill.type === "solid") return fill.color;
  if ("stops" in fill && fill.stops[0]?.color) return fill.stops[0].color;
  return "#d3f256";
}

function isGradientPaint(fill: CanvasFill): fill is GradientPaint {
  return "stops" in fill;
}

function hasPaintTransform(fill: CanvasFill): fill is PaintTransformOwner {
  return fill.type !== "solid";
}

function paintTransformMatrix(
  fill: PaintTransformOwner,
): CanvasTransformMatrix {
  return {
    m00: fill.transform?.m00 ?? 1,
    m01: fill.transform?.m01 ?? 0,
    m02: fill.transform?.m02 ?? 0,
    m10: fill.transform?.m10 ?? 0,
    m11: fill.transform?.m11 ?? 1,
    m12: fill.transform?.m12 ?? 0,
  };
}

function gradientStopOpacity(stop: GradientPaint["stops"][number]): number {
  if (!isRecord(stop) || typeof stop.opacity !== "number") return 100;
  return Math.round(stop.opacity * 100);
}

function createFillOfType(
  type: CanvasFill["type"],
  previous?: CanvasFill,
): CanvasFill {
  const meta = paintLayerMeta(previous);
  const color = fillPrimaryColor(previous);
  switch (type) {
    case "solid":
      return { type, color, ...meta };
    case "linear_gradient":
      return {
        type,
        angle: previous && "angle" in previous ? previous.angle : 0,
        stops: [
          { offset: 0, color },
          { offset: 1, color: "#ffffff" },
        ],
        ...meta,
      };
    case "radial_gradient":
      return {
        type,
        cx: 0.5,
        cy: 0.5,
        radius: previous && "radius" in previous ? previous.radius : 0.5,
        stops: [
          { offset: 0, color },
          { offset: 1, color: "#ffffff" },
        ],
        ...meta,
      };
    case "angular_gradient":
      return {
        type,
        angle: previous && "angle" in previous ? previous.angle : 0,
        cx: 0.5,
        cy: 0.5,
        stops: [
          { offset: 0, color },
          { offset: 1, color: "#ffffff" },
        ],
        ...meta,
      };
    case "diamond_gradient":
      return {
        type,
        angle: previous && "angle" in previous ? previous.angle : 0,
        cx: 0.5,
        cy: 0.5,
        radius: previous && "radius" in previous ? previous.radius : 0.5,
        stops: [
          { offset: 0, color },
          { offset: 1, color: "#ffffff" },
        ],
        ...meta,
      };
    case "image":
      return {
        type,
        url: previous?.type === "image" ? previous.url : "",
        mode: previous?.type === "image" ? previous.mode : "fill",
        ...(previous?.type === "image" && previous.originalSize
          ? { originalSize: previous.originalSize }
          : {}),
        ...(previous?.type === "image" && previous.transform
          ? { transform: previous.transform }
          : {}),
        ...meta,
      };
  }
}

function effectInspectorType(effect: PenEffect): EffectInspectorType {
  if (effect.type === "shadow") return effect.inner ? "inner_shadow" : "shadow";
  return effect.type;
}

function effectMeta(effect?: PenEffect): {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
} {
  const meta: { visible?: boolean; opacity?: number; blendMode?: BlendMode } =
    {};
  if (effect?.visible !== undefined) meta.visible = effect.visible;
  if (typeof effect?.opacity === "number") meta.opacity = effect.opacity;
  if (effect?.blendMode) meta.blendMode = effect.blendMode;
  return meta;
}

function createEffectOfType(
  type: EffectInspectorType,
  previous?: PenEffect,
): PenEffect {
  const meta = effectMeta(previous);
  if (type === "shadow" || type === "inner_shadow") {
    const shadow = previous?.type === "shadow" ? previous : undefined;
    return {
      type: "shadow",
      ...(type === "inner_shadow" ? { inner: true } : {}),
      offsetX: shadow?.offsetX ?? 0,
      offsetY: shadow?.offsetY ?? 4,
      blur: shadow?.blur ?? 8,
      spread: shadow?.spread ?? 0,
      color: shadow?.color ?? "#00000040",
      ...meta,
    };
  }
  return {
    type,
    radius:
      previous?.type === "blur" || previous?.type === "background_blur"
        ? previous.radius
        : 4,
    ...meta,
  };
}

function effectOpacity(effect?: PenEffect): number {
  if (!effect || typeof effect.opacity !== "number") return 100;
  return Math.round(effect.opacity * 100);
}

function formatDashPattern(pattern?: number[]): string {
  if (!pattern || pattern.length === 0) return "";
  return pattern.map((value) => formatNumber(value)).join(" ");
}

function parseDashPattern(value: string): number[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numbers = trimmed.split(/[,\s]+/).map((part) => Number(part));
  if (
    numbers.some((part) => !Number.isFinite(part) || part < 0) ||
    numbers.length === 0
  ) {
    return undefined;
  }
  return numbers;
}

function strokeWithDashPattern(
  stroke: CanvasStroke,
  dashPattern: number[] | undefined,
): CanvasStroke {
  const { dashPattern: _dashPattern, ...strokeWithoutDash } = stroke;
  if (!dashPattern || dashPattern.length === 0) return strokeWithoutDash;
  return { ...strokeWithoutDash, dashPattern };
}

const STROKE_ENDPOINT_TIP_OPTIONS: Array<{
  label: string;
  value: PenStrokeEndpointTip;
}> = [
  { label: "无", value: "none" },
  { label: "线形箭头", value: "line-arrow" },
  { label: "三角箭头", value: "triangle-arrow" },
  { label: "反向三角", value: "reverse-triangle" },
  { label: "菱形", value: "diamond" },
];

function cornerRadiusTuple(
  cornerRadius: unknown,
): [number, number, number, number] {
  if (Array.isArray(cornerRadius) && cornerRadius.length === 4) {
    const values = cornerRadius.map((value) =>
      Number.isFinite(Number(value)) ? Number(value) : 0,
    );
    return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
  }
  const radius =
    typeof cornerRadius === "number" && Number.isFinite(cornerRadius)
      ? cornerRadius
      : 0;
  return [radius, radius, radius, radius];
}

function strokeThicknessTuple(
  thickness: CanvasStroke["thickness"] | undefined,
): [number, number, number, number] {
  if (Array.isArray(thickness) && thickness.length === 4) {
    return [
      Number(thickness[0]) || 0,
      Number(thickness[1]) || 0,
      Number(thickness[2]) || 0,
      Number(thickness[3]) || 0,
    ];
  }
  const width =
    typeof thickness === "number" && Number.isFinite(thickness) ? thickness : 1;
  return [width, width, width, width];
}

function paddingTuple(
  padding: LayoutEditableNode["padding"],
): [number, number, number, number] {
  if (Array.isArray(padding)) {
    if (padding.length === 2) {
      return [
        Number(padding[0]) || 0,
        Number(padding[1]) || 0,
        Number(padding[0]) || 0,
        Number(padding[1]) || 0,
      ];
    }
    if (padding.length === 4) {
      return [
        Number(padding[0]) || 0,
        Number(padding[1]) || 0,
        Number(padding[2]) || 0,
        Number(padding[3]) || 0,
      ];
    }
  }
  const value =
    typeof padding === "number" && Number.isFinite(padding) ? padding : 0;
  return [value, value, value, value];
}

function nodeTransformMatrix(node: PenNode): CanvasTransformMatrix {
  return {
    m00: node.transform?.m00 ?? 1,
    m01: node.transform?.m01 ?? 0,
    m02: node.transform?.m02 ?? 0,
    m10: node.transform?.m10 ?? 0,
    m11: node.transform?.m11 ?? 1,
    m12: node.transform?.m12 ?? 0,
  };
}

function isStyledTextContent(
  content: Extract<PenNode, { type: "text" }>["content"],
): content is StyledTextSegment[] {
  return Array.isArray(content);
}

function formatFontFallback(fallback?: string[]): string {
  return fallback?.join(", ") ?? "";
}

function parseFontFallback(value: string): string[] | undefined {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : undefined;
}

function formatOpenTypeFeatures(
  features?: Record<string, boolean | number>,
): string {
  if (!features) return "";
  return Object.entries(features)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function parseOpenTypeFeatures(
  value: string,
): Record<string, boolean | number> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const entries = trimmed
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const parsed: Record<string, boolean | number> = {};
  for (const entry of entries) {
    const [rawKey, rawValue = "true"] = entry.split("=");
    const key = rawKey?.trim();
    const valueText = rawValue.trim();
    if (!key) continue;
    if (valueText === "true") {
      parsed[key] = true;
    } else if (valueText === "false") {
      parsed[key] = false;
    } else {
      const valueNumber = Number(valueText);
      if (!Number.isFinite(valueNumber)) {
        console.warn(
          "[canvas-property-panel] ignored invalid OpenType feature value",
          { entry },
        );
        continue;
      }
      parsed[key] = valueNumber;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function segmentFillColor(segment: StyledTextSegment): string {
  if (segment.fills?.[0]?.type === "solid") return segment.fills[0].color;
  return segment.fill ?? "#111827";
}

function formatReferenceValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseReferenceObjectInput(
  value: string,
  label: string,
): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed;
  } catch (error) {
    console.warn("[canvas-property-panel] ignored invalid reference JSON", {
      label,
      error,
    });
    return undefined;
  }
  console.warn("[canvas-property-panel] ignored non-object reference JSON", {
    label,
  });
  return undefined;
}

function parseReferenceArrayInput<T>(
  value: string,
  label: string,
): T[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch (error) {
    console.warn("[canvas-property-panel] ignored invalid reference JSON", {
      label,
      error,
    });
    return undefined;
  }
  console.warn("[canvas-property-panel] ignored non-array reference JSON", {
    label,
  });
  return undefined;
}

function getJsonParseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知解析错误";
}

function formatStructuredValue(value: unknown): string {
  if (value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseStructuredValueInput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && trimmed === String(numeric)) return numeric;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn("[canvas-property-panel] ignored invalid structured value", {
        value,
        error,
      });
    }
  }
  return value;
}

function parsePrimitiveComponentValue(
  value: string,
): string | number | boolean {
  const parsed = parseStructuredValueInput(value);
  if (
    typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean"
  ) {
    return parsed;
  }
  return value;
}

function isPathCommandToken(token: string | undefined): token is string {
  return Boolean(token && PATH_COMMAND_RE.test(token));
}

function isPathNumberToken(token: string | undefined): token is string {
  return Boolean(token && !PATH_COMMAND_RE.test(token));
}

function validatePathDataInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "路径 d 不能为空，请输入以 M 或 m 开头的 SVG path。";
  }

  const invalidChars = trimmed.replace(
    /[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?|[\s,]/g,
    "",
  );
  if (invalidChars) {
    return `路径包含无法识别的字符“${invalidChars[0]}”，请检查 SVG path 命令或数字。`;
  }

  const tokens = trimmed.match(PATH_TOKEN_RE);
  if (!tokens?.length) {
    return "路径 d 没有可解析的命令，请输入有效的 SVG path。";
  }
  if (!/^m$/i.test(tokens[0] ?? "")) {
    return "路径必须以 M 或 m 移动命令开始。";
  }

  let index = 0;
  let command = "";
  let hasDrawCommand = false;

  const readParams = (count: number, commandName: string): string | null => {
    for (let offset = 0; offset < count; offset += 1) {
      const token = tokens[index + offset];
      if (!isPathNumberToken(token)) {
        return `路径命令 ${commandName.toUpperCase()} 参数不足，需要 ${count} 个数字。`;
      }
      const numeric = Number(token);
      if (!Number.isFinite(numeric)) {
        return `路径命令 ${commandName.toUpperCase()} 包含非法数字“${token}”。`;
      }
      if (
        commandName.toUpperCase() === "A" &&
        (offset === 3 || offset === 4) &&
        token !== "0" &&
        token !== "1"
      ) {
        return "路径 A 弧线命令的 large-arc 和 sweep 标记只能是 0 或 1。";
      }
    }
    index += count;
    return null;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (isPathCommandToken(token)) {
      command = token;
      index += 1;
    } else if (!command || command.toUpperCase() === "Z") {
      return "路径数字前缺少对应命令，请补充 M/L/C/Q/A 等 SVG path 命令。";
    }

    const commandKey = command.toUpperCase();
    const count = PATH_COMMAND_PARAM_COUNTS[commandKey];
    if (count === undefined) {
      return `路径包含暂不支持的命令 ${command}。`;
    }
    if (count === 0) {
      hasDrawCommand = true;
      command = "";
      continue;
    }

    const firstError = readParams(count, command);
    if (firstError) return firstError;
    if (commandKey !== "M") hasDrawCommand = true;

    while (index < tokens.length && isPathNumberToken(tokens[index])) {
      const repeatedError = readParams(count, command);
      if (repeatedError) return repeatedError;
      hasDrawCommand = true;
    }

    if (commandKey === "M") {
      command = command === "m" ? "l" : "L";
    }
  }

  if (!hasDrawCommand) {
    return "路径至少需要一个绘制命令，例如 L、C、Q、A、H、V、S、T 或 Z。";
  }

  return null;
}

function formatDiagnosticValue(value: unknown): string {
  if (value === undefined || value === null) return "未记录";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "未记录";
  }
  if (typeof value === "string") return value.trim() || "未记录";
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatDiagnosticValue(item))
      .filter((item) => item !== "未记录");
    return parts.length > 0 ? parts.join(", ") : "未记录";
  }
  if (isRecord(value)) {
    const parts = Object.entries(value)
      .filter(
        ([, entryValue]) => entryValue !== undefined && entryValue !== null,
      )
      .map(
        ([key, entryValue]) => `${key}: ${formatDiagnosticValue(entryValue)}`,
      );
    return parts.length > 0 ? parts.join(" · ") : "未记录";
  }
  return String(value);
}

function formatVectorFallbackReason(value: unknown): string {
  if (value === "path_not_decodable") {
    return "路径数据无法解码，已保留诊断信息";
  }
  return formatDiagnosticValue(value);
}

function formatDegradationHints(value: unknown): string {
  if (!Array.isArray(value)) return formatDiagnosticValue(value);
  const labels = value.map((hint) =>
    hint === "partial_fidelity" ? "部分保真" : formatDiagnosticValue(hint),
  );
  return labels.filter((label) => label !== "未记录").join(", ") || "未记录";
}

function formatFillRuleLabel(value: PathEditableNode["fillRule"]): string {
  return value === "evenodd" ? "Evenodd" : "Nonzero";
}

function vectorDiagnosticSource(
  node: PathEditableNode,
): Record<string, unknown> {
  const meta = isRecord(node.meta) ? node.meta : {};
  const vectorFallback = isRecord(meta.vectorFallback)
    ? meta.vectorFallback
    : undefined;
  return vectorFallback ?? meta;
}

function getVectorDiagnosticRows(
  node: PathEditableNode,
): Array<[string, string]> {
  const meta = isRecord(node.meta) ? node.meta : {};
  const source = vectorDiagnosticSource(node);
  const rows: Array<[string, string]> = [];

  const addRow = (
    label: string,
    value: unknown,
    formatter: (value: unknown) => string = formatDiagnosticValue,
  ) => {
    if (value === undefined || value === null) return;
    const formatted = formatter(value);
    if (formatted !== "未记录") rows.push([label, formatted]);
  };

  addRow(
    "布尔操作",
    source.booleanOperation ?? source.booleanOperationType ?? source.operation,
  );
  addRow("节点类型", source.nodeType ?? meta.figmaNodeType);
  addRow("降级原因", source.fallbackReason, formatVectorFallbackReason);
  addRow("保真状态", meta.degradationHints, formatDegradationHints);
  addRow("填充几何", source.fillGeometryCount);
  addRow("描边几何", source.strokeGeometryCount);
  addRow("规格化尺寸", source.normalizedSize);
  addRow("Vector Blob", source.vectorNetworkBlob);
  addRow("来源", source.source ?? meta.source);

  return rows;
}

function getVectorWindingRows(node: PathEditableNode): Array<[string, string]> {
  const source = vectorDiagnosticSource(node);
  return [
    ["当前规则", formatFillRuleLabel(node.fillRule)],
    ["Figma 填充", formatDiagnosticValue(source.fillWindingRules)],
    ["Figma 描边", formatDiagnosticValue(source.strokeWindingRules)],
  ];
}

function formatVariableValue(value: VariableDefinition["value"]): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatStructuredValue(entry.value)).join(", ");
  }
  return formatStructuredValue(value);
}

function parseVariableValueInput(
  type: VariableDefinition["type"],
  value: string,
): VariableDefinition["value"] {
  const trimmed = value.trim();
  if (type === "number") {
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      throw new Error("数字变量需要输入有效数字。");
    }
    return next;
  }
  if (type === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new Error("布尔变量只能输入 true 或 false。");
  }
  return value;
}

function variableRefLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const id = value.id ?? value.name ?? value.key;
    if (typeof id === "string") return id;
  }
  return formatReferenceValue(value);
}

function findVariableDefinition(
  variables: CanvasVariableMap | undefined,
  refValue: unknown,
): [string, VariableDefinition] | undefined {
  const label = variableRefLabel(refValue);
  return Object.entries(variables ?? {}).find(
    ([name, variable]) =>
      name === label ||
      variable.id === label ||
      variable.name === label ||
      (typeof variable.rawRef === "string" && variable.rawRef === label),
  );
}

function styleDefinitionSummary(
  definition: PenStyleDefinition | undefined,
): string {
  if (!definition) return "未解析的样式定义";
  const name = definition.name ? `${definition.name} · ` : "";
  if (definition.fill?.[0]?.type === "solid") {
    return `${name}${definition.source} · ${definition.fill[0].color}`;
  }
  if (definition.strokeFill?.[0]?.type === "solid") {
    return `${name}${definition.source} · ${definition.strokeFill[0].color}`;
  }
  if (definition.text?.fontFamily || definition.text?.fontSize) {
    return `${name}${definition.source} · ${definition.text.fontFamily ?? "文本"} ${definition.text.fontSize ?? ""}`;
  }
  return `${name}${definition.source} · ${definition.type}`;
}

// ─── NumberField ─────────────────────────────────────────────────────────────

function NumberField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  suffix,
  muted,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  muted?: boolean;
  onChange: (value: number) => void;
}) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (!Number.isFinite(next)) {
      console.warn("[canvas-property-panel] ignored invalid numeric input", {
        label,
        value: event.currentTarget.value,
      });
      return;
    }
    onChange(clamp(next, min, max));
  };

  return (
    <label
      className={cn(
        "flex h-9 min-w-0 items-center rounded-lg border border-transparent bg-muted/70 px-3 text-xs text-muted-foreground shadow-subtle",
        "focus-within:border-border focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20",
        muted && "opacity-55",
      )}
    >
      <span className="mr-2 shrink-0 font-medium">{label}</span>
      <input
        aria-label={ariaLabel ?? label}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={formatNumber(value)}
        onChange={handleChange}
      />
      {suffix ? (
        <span className="ml-1 shrink-0 text-muted-foreground">{suffix}</span>
      ) : null}
    </label>
  );
}

function InspectorSection({
  title,
  children,
  actions,
  muted,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      className={cn(
        "-mx-4 border-t border-border/70 px-4 py-4 first:border-t-0 first:pt-1",
        muted && "text-muted-foreground",
      )}
    >
      <div className="mb-3 flex h-7 items-center justify-between">
        <h3
          className={cn(
            "text-xs font-semibold tracking-normal text-foreground",
            muted && "text-muted-foreground",
          )}
        >
          {title}
        </h3>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function InspectorIconButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-foreground/65 transition-colors",
        "hover:bg-foreground/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35",
        active &&
          "border-foreground/10 bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.1]",
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon: LucideIcon }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid h-9 overflow-hidden rounded-lg border border-border/60 bg-muted/70 p-0.5 shadow-subtle">
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map(({ value: optionValue, label, icon: Icon }) => {
          const active = optionValue === value;
          return (
            <button
              key={optionValue}
              type="button"
              className={cn(
                "flex items-center justify-center rounded-md text-muted-foreground transition-colors",
                "hover:bg-background/70 hover:text-foreground",
                active && "bg-background text-foreground shadow-subtle",
              )}
              onClick={() => onChange(optionValue)}
              title={label}
              aria-label={label}
              aria-pressed={active}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ColorSwatch ─────────────────────────────────────────────────────────────

function ColorSwatch({
  color,
  onClick,
  size = "md",
}: {
  color: string;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  const safeColor = isCssColorLike(color) ? color : "#ffffff";

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 cursor-pointer rounded-md border border-border shadow-sm",
        size === "sm" ? "h-5 w-5" : "h-7 w-7",
        !isCssColorLike(color) &&
          "bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:8px_8px] bg-[position:0_0,0_4px,4px_-4px,-4px_0px]",
      )}
      style={{ backgroundColor: safeColor }}
      onClick={onClick}
      aria-label={`Color: ${color}`}
    />
  );
}

// ─── ColorPickerPopover ──────────────────────────────────────────────────────

function ColorPickerPopover({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerColor = isCssColorLike(color) ? toHexColor(color) : "#111827";

  useEffect(() => {
    setHexInput(isCssColorLike(color) ? toHexColor(color) : color);
  }, [color]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative z-20">
      <ColorSwatch color={color} onClick={() => setOpen(!open)} />
      {open ? (
        <div
          className="absolute left-0 top-9 z-50 w-52 rounded-xl border border-border bg-card/95 p-2 shadow-float backdrop-blur-lg"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <HexColorPicker color={pickerColor} onChange={onChange} />
          <div className="mt-2 flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2">
            <input
              type="color"
              className="h-5 w-6 cursor-pointer rounded bg-transparent p-0"
              value={pickerColor}
              onChange={(event) => onChange(event.currentTarget.value)}
              aria-label="选择颜色"
            />
            <input
              className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-foreground outline-none"
              value={hexInput}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setHexInput(next);
                if (isHexColor(next)) onChange(next);
              }}
              onBlur={() => {
                if (!isHexColor(hexInput)) setHexInput(pickerColor);
              }}
              placeholder="#111827"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── FillSection ─────────────────────────────────────────────────────────────

function FillLayerRow({
  fill,
  index,
  count,
  label = "填充",
  onUpdate,
  onRemove,
  onMove,
}: {
  fill: CanvasFill;
  index: number;
  count: number;
  label?: string;
  onUpdate: (fill: CanvasFill) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const visible = fill.visible !== false;
  const layerNumber = index + 1;
  const opacity = paintLayerOpacity(fill);
  const color = fillPrimaryColor(fill);
  const layerLabel = `${label} ${layerNumber}`;

  const updatePrimaryColor = (nextColor: string) => {
    if (fill.type === "solid") {
      onUpdate({ ...fill, color: nextColor });
      return;
    }
    if ("stops" in fill) {
      const stops =
        fill.stops.length > 0
          ? fill.stops.map((stop, stopIndex) =>
              stopIndex === 0 ? { ...stop, color: nextColor } : stop,
            )
          : [
              { offset: 0, color: nextColor },
              { offset: 1, color: "#ffffff" },
            ];
      onUpdate({ ...fill, stops } as CanvasFill);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/50 p-2 shadow-subtle">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <InspectorIconButton
          icon={visible ? Eye : EyeOff}
          label={visible ? `隐藏${layerLabel}` : `显示${layerLabel}`}
          active={visible}
          onClick={() => onUpdate({ ...fill, visible: !visible } as CanvasFill)}
        />
        <select
          aria-label={`${layerLabel} 类型`}
          className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          value={fill.type}
          onChange={(event) =>
            onUpdate(
              createFillOfType(
                event.currentTarget.value as CanvasFill["type"],
                fill,
              ),
            )
          }
        >
          {FILL_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <InspectorIconButton
            icon={ArrowUp}
            label={`上移${layerLabel}`}
            disabled={index === 0}
            onClick={() => onMove("up")}
          />
          <InspectorIconButton
            icon={ArrowDown}
            label={`下移${layerLabel}`}
            disabled={index === count - 1}
            onClick={() => onMove("down")}
          />
          <InspectorIconButton
            icon={Minus}
            label={`移除${layerLabel}`}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_6.5rem] gap-2">
        <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-3">
          {fill.type === "image" ? (
            <span className="text-xs font-medium text-muted-foreground">
              图片
            </span>
          ) : (
            <>
              <ColorPickerPopover color={color} onChange={updatePrimaryColor} />
              <span className="truncate text-sm font-medium text-foreground">
                {color.replace(/^#/, "").toUpperCase()}
              </span>
            </>
          )}
        </div>
        <NumberField
          label="透明"
          ariaLabel={`${layerLabel} 透明`}
          suffix="%"
          value={opacity}
          min={0}
          max={100}
          onChange={(nextOpacity) =>
            onUpdate({ ...fill, opacity: nextOpacity / 100 } as CanvasFill)
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label={`${layerLabel} 混合模式`}
          className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          value={fill.blendMode ?? "normal"}
          onChange={(event) =>
            onUpdate({
              ...fill,
              blendMode: event.currentTarget.value as BlendMode,
            } as CanvasFill)
          }
        >
          {BLEND_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {"angle" in fill ? (
          <NumberField
            label="角度"
            ariaLabel={`${layerLabel} 角度`}
            value={fill.angle ?? 0}
            step={1}
            onChange={(angle) => onUpdate({ ...fill, angle } as CanvasFill)}
          />
        ) : "radius" in fill ? (
          <NumberField
            label="半径"
            ariaLabel={`${layerLabel} 半径`}
            value={fill.radius ?? 0}
            min={0}
            step={0.01}
            onChange={(radius) => onUpdate({ ...fill, radius } as CanvasFill)}
          />
        ) : (
          <div aria-hidden="true" />
        )}
      </div>
      {fill.type === "image" ? (
        <div className="space-y-2">
          <input
            aria-label={`${layerLabel} 图片地址`}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            placeholder="Image URL / hash / blob"
            value={fill.url}
            onChange={(event) =>
              onUpdate({ ...fill, url: event.currentTarget.value })
            }
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              aria-label={`${layerLabel} 图片模式`}
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={fill.mode ?? "fill"}
              onChange={(event) =>
                onUpdate({
                  ...fill,
                  mode: event.currentTarget.value as NonNullable<
                    Extract<CanvasFill, { type: "image" }>["mode"]
                  >,
                })
              }
            >
              <option value="fill">Fill</option>
              <option value="fit">Fit</option>
              <option value="stretch">Stretch</option>
              <option value="tile">Tile</option>
              <option value="crop">Crop</option>
            </select>
            <NumberField
              label="原宽"
              ariaLabel={`${layerLabel} 原始宽度`}
              value={fill.originalSize?.width ?? 0}
              min={0}
              onChange={(width) =>
                onUpdate({
                  ...fill,
                  originalSize: {
                    width,
                    height: fill.originalSize?.height ?? 0,
                  },
                })
              }
            />
            <NumberField
              label="原高"
              ariaLabel={`${layerLabel} 原始高度`}
              value={fill.originalSize?.height ?? 0}
              min={0}
              onChange={(height) =>
                onUpdate({
                  ...fill,
                  originalSize: {
                    width: fill.originalSize?.width ?? 0,
                    height,
                  },
                })
              }
            />
          </div>
          <div className="rounded-lg border border-border/60 bg-background/70 p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                {fill.mode === "crop" ? "Crop Matrix" : "Transform Matrix"}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">
                m00-m12
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["m00", "m01", "m02", "m10", "m11", "m12"] as const).map(
                (key) => {
                  const matrix = paintTransformMatrix(fill);
                  return (
                    <NumberField
                      key={key}
                      label={key}
                      ariaLabel={`${layerLabel} 图片矩阵 ${key}`}
                      value={matrix[key]}
                      step={0.01}
                      onChange={(value) =>
                        onUpdate({
                          ...fill,
                          transform: { ...matrix, [key]: value },
                        })
                      }
                    />
                  );
                },
              )}
            </div>
          </div>
        </div>
      ) : null}
      {isGradientPaint(fill) ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Gradient Stops
            </span>
            <InspectorIconButton
              icon={Plus}
              label={`添加${layerLabel} 色标`}
              onClick={() => {
                const lastStop = fill.stops.at(-1);
                const nextOffset =
                  lastStop && typeof lastStop.offset === "number"
                    ? clamp(lastStop.offset + 0.1, 0, 1)
                    : 0.5;
                onUpdate({
                  ...fill,
                  stops: [
                    ...fill.stops,
                    {
                      offset: nextOffset,
                      color: lastStop?.color ?? color,
                      opacity: lastStop?.opacity ?? 1,
                    },
                  ],
                } as CanvasFill);
              }}
            />
          </div>
          <div className="space-y-2">
            {fill.stops.map((stop, stopIndex) => {
              const stopNumber = stopIndex + 1;
              return (
                <div
                  key={`${stop.offset}-${stopIndex}`}
                  className="grid grid-cols-[1fr_4.5rem_4.5rem_auto] items-center gap-2"
                >
                  <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-transparent bg-muted/70 px-2 text-xs text-muted-foreground shadow-subtle focus-within:border-border focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20">
                    <ColorPickerPopover
                      color={stop.color}
                      onChange={(nextColor) =>
                        onUpdate({
                          ...fill,
                          stops: fill.stops.map((item, itemIndex) =>
                            itemIndex === stopIndex
                              ? { ...item, color: nextColor }
                              : item,
                          ),
                        } as CanvasFill)
                      }
                    />
                    <input
                      aria-label={`${layerLabel} 色标 ${stopNumber} 颜色`}
                      className="min-w-0 flex-1 bg-transparent font-mono text-xs font-medium text-foreground outline-none"
                      value={stop.color}
                      onChange={(event) =>
                        onUpdate({
                          ...fill,
                          stops: fill.stops.map((item, itemIndex) =>
                            itemIndex === stopIndex
                              ? { ...item, color: event.currentTarget.value }
                              : item,
                          ),
                        } as CanvasFill)
                      }
                    />
                  </label>
                  <NumberField
                    label="位置"
                    ariaLabel={`${layerLabel} 色标 ${stopNumber} 位置`}
                    value={stop.offset}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(offset) =>
                      onUpdate({
                        ...fill,
                        stops: fill.stops.map((item, itemIndex) =>
                          itemIndex === stopIndex ? { ...item, offset } : item,
                        ),
                      } as CanvasFill)
                    }
                  />
                  <NumberField
                    label="透明"
                    ariaLabel={`${layerLabel} 色标 ${stopNumber} 透明`}
                    value={gradientStopOpacity(stop)}
                    min={0}
                    max={100}
                    onChange={(nextOpacity) =>
                      onUpdate({
                        ...fill,
                        stops: fill.stops.map((item, itemIndex) =>
                          itemIndex === stopIndex
                            ? { ...item, opacity: nextOpacity / 100 }
                            : item,
                        ),
                      } as CanvasFill)
                    }
                  />
                  <InspectorIconButton
                    icon={Minus}
                    label={`移除${layerLabel} 色标 ${stopNumber}`}
                    onClick={() =>
                      onUpdate({
                        ...fill,
                        stops: fill.stops.filter(
                          (_item, itemIndex) => itemIndex !== stopIndex,
                        ),
                      } as CanvasFill)
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {hasPaintTransform(fill) && fill.type !== "image" ? (
        <div className="rounded-lg border border-border/60 bg-background/70 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Paint Matrix
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              handle fallback
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["m00", "m01", "m02", "m10", "m11", "m12"] as const).map(
              (key) => {
                const matrix = paintTransformMatrix(fill);
                return (
                  <NumberField
                    key={key}
                    label={key}
                    ariaLabel={`${layerLabel} 矩阵 ${key}`}
                    value={matrix[key]}
                    step={0.01}
                    onChange={(value) =>
                      onUpdate({
                        ...fill,
                        transform: { ...matrix, [key]: value },
                      } as CanvasFill)
                    }
                  />
                );
              },
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FillSection({
  fills,
  onUpdate,
}: {
  fills?: CanvasFill[];
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const fillLayers = fills ?? [];
  const updateFillAt = (index: number, nextFill: CanvasFill) => {
    onUpdate({
      fill: fillLayers.map((fill, fillIndex) =>
        fillIndex === index ? nextFill : fill,
      ),
    } as Partial<PenNode>);
  };

  const moveFill = (index: number, direction: "up" | "down") => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= fillLayers.length) return;
    const next = [...fillLayers];
    const current = next[index];
    const target = next[nextIndex];
    if (!current || !target) return;
    next[index] = target;
    next[nextIndex] = current;
    onUpdate({ fill: next } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="填充"
      actions={
        <>
          <InspectorIconButton icon={Grid2X2} label="样式变量" disabled />
          <InspectorIconButton
            icon={Plus}
            label="添加填充"
            onClick={() =>
              onUpdate({
                fill: [...fillLayers, createFillOfType("solid")],
              } as Partial<PenNode>)
            }
          />
        </>
      }
    >
      <div className="space-y-2">
        {fillLayers.length > 0 ? (
          fillLayers.map((fill, index) => (
            <FillLayerRow
              key={`${fill.type}-${index}`}
              fill={fill}
              index={index}
              count={fillLayers.length}
              onUpdate={(nextFill) => updateFillAt(index, nextFill)}
              onRemove={() =>
                onUpdate({
                  fill: fillLayers.filter(
                    (_fill, fillIndex) => fillIndex !== index,
                  ),
                } as Partial<PenNode>)
              }
              onMove={(direction) => moveFill(index, direction)}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            当前没有填充。点击加号添加一层可编辑填充。
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

// ─── StrokeSection ───────────────────────────────────────────────────────────

function StrokeSection({
  stroke,
  onUpdate,
}: {
  stroke?: CanvasStroke;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const color = extractSolidStrokeColor(stroke) ?? "#111827";
  const width = typeof stroke?.thickness === "number" ? stroke.thickness : 1;
  const edgeWidths = strokeThicknessTuple(stroke?.thickness);
  const strokeFill = stroke?.fill?.[0];
  const opacity = solidFillOpacity(strokeFill);
  const strokeLayers = stroke?.fill ?? [];
  const [dashInput, setDashInput] = useState(
    formatDashPattern(stroke?.dashPattern),
  );

  useEffect(() => {
    setDashInput(formatDashPattern(stroke?.dashPattern));
  }, [stroke?.dashPattern]);

  const buildStroke = useCallback(
    (): CanvasStroke => ({
      ...(stroke ?? {
        thickness: 1,
        align: "inside",
        fill: [{ type: "solid", color, opacity: opacity / 100 }],
      }),
      thickness: stroke?.thickness ?? 1,
      fill: stroke?.fill ?? [{ type: "solid", color, opacity: opacity / 100 }],
    }),
    [color, opacity, stroke],
  );

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const newStroke: CanvasStroke = {
        ...(stroke ?? {
          thickness: 1,
          fill: [{ type: "solid", color, opacity: opacity / 100 }],
        }),
        thickness: newWidth,
      };
      onUpdate({ stroke: newStroke } as Partial<PenNode>);
    },
    [onUpdate, opacity, stroke, color],
  );

  const updateStrokeFillAt = (index: number, nextFill: CanvasFill) => {
    const baseStroke = buildStroke();
    const layers = baseStroke.fill ?? [];
    onUpdate({
      stroke: {
        ...baseStroke,
        fill: layers.map((fill, fillIndex) =>
          fillIndex === index ? nextFill : fill,
        ),
      },
    } as Partial<PenNode>);
  };

  const moveStrokeFill = (index: number, direction: "up" | "down") => {
    const baseStroke = buildStroke();
    const layers = [...(baseStroke.fill ?? [])];
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= layers.length) return;
    const current = layers[index];
    const target = layers[nextIndex];
    if (!current || !target) return;
    layers[index] = target;
    layers[nextIndex] = current;
    onUpdate({ stroke: { ...baseStroke, fill: layers } } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="描边"
      actions={
        <>
          <InspectorIconButton icon={Grid2X2} label="样式变量" disabled />
          <InspectorIconButton
            icon={Plus}
            label="添加描边填充"
            onClick={() => {
              const baseStroke = buildStroke();
              onUpdate({
                stroke: {
                  ...baseStroke,
                  fill: [...strokeLayers, createFillOfType("solid")],
                },
              } as Partial<PenNode>);
            }}
          />
        </>
      }
    >
      <div className="space-y-2">
        {strokeLayers.length > 0 ? (
          strokeLayers.map((fill, index) => (
            <FillLayerRow
              key={`${fill.type}-${index}`}
              fill={fill}
              index={index}
              count={strokeLayers.length}
              label="描边填充"
              onUpdate={(nextFill) => updateStrokeFillAt(index, nextFill)}
              onRemove={() => {
                const baseStroke = buildStroke();
                onUpdate({
                  stroke: {
                    ...baseStroke,
                    fill: strokeLayers.filter(
                      (_fill, fillIndex) => fillIndex !== index,
                    ),
                  },
                } as Partial<PenNode>);
              }}
              onMove={(direction) => moveStrokeFill(index, direction)}
            />
          ))
        ) : (
          <p className="rounded-lg border border-border/60 bg-muted/50 p-2 text-xs text-muted-foreground">
            当前没有描边填充。点击加号添加一层可编辑描边 paint。
          </p>
        )}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            aria-label="描边对齐"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={stroke?.align ?? "inside"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...buildStroke(),
                  align: event.currentTarget.value as CanvasStroke["align"],
                },
              } as Partial<PenNode>)
            }
          >
            <option value="inside">内部</option>
            <option value="center">居中</option>
            <option value="outside">外部</option>
          </select>
          <NumberField
            label="宽度"
            value={width}
            min={0}
            step={0.5}
            onChange={handleWidthChange}
          />
          <InspectorIconButton
            icon={SlidersHorizontal}
            label="描边高级设置"
            disabled
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="端点"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={stroke?.cap ?? "none"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...buildStroke(),
                  cap: event.currentTarget.value as CanvasStroke["cap"],
                },
              } as Partial<PenNode>)
            }
          >
            <option value="none">端点 无</option>
            <option value="round">端点 圆头</option>
            <option value="square">端点 方头</option>
          </select>
          <select
            aria-label="连接"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={stroke?.join ?? "miter"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...buildStroke(),
                  join: event.currentTarget.value as CanvasStroke["join"],
                },
              } as Partial<PenNode>)
            }
          >
            <option value="miter">连接 斜接</option>
            <option value="bevel">连接 斜切</option>
            <option value="round">连接 圆角</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="起点样式"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={stroke?.startTip ?? "none"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...buildStroke(),
                  startTip: event.currentTarget.value as PenStrokeEndpointTip,
                },
              } as Partial<PenNode>)
            }
          >
            {STROKE_ENDPOINT_TIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                起点 {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="终点样式"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={stroke?.endTip ?? "none"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...buildStroke(),
                  endTip: event.currentTarget.value as PenStrokeEndpointTip,
                },
              } as Partial<PenNode>)
            }
          >
            {STROKE_ENDPOINT_TIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                终点 {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label
            className={cn(
              "col-span-2 flex h-9 min-w-0 items-center rounded-lg border border-transparent bg-muted/70 px-3 text-xs text-muted-foreground shadow-subtle",
              "focus-within:border-border focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20",
            )}
          >
            <span className="mr-2 shrink-0 font-medium">虚线</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
              value={dashInput}
              placeholder="4 2"
              onChange={(event) => setDashInput(event.currentTarget.value)}
              onBlur={() => {
                const parsed = parseDashPattern(dashInput);
                if (dashInput.trim() && !parsed) {
                  console.warn(
                    "[canvas-property-panel] ignored invalid dash pattern",
                    { value: dashInput },
                  );
                  setDashInput(formatDashPattern(stroke?.dashPattern));
                  return;
                }
                onUpdate({
                  stroke: strokeWithDashPattern(buildStroke(), parsed),
                } as Partial<PenNode>);
              }}
            />
          </label>
          <NumberField
            label="偏移"
            value={stroke?.dashOffset ?? 0}
            min={0}
            step={0.5}
            onChange={(dashOffset) =>
              onUpdate({
                stroke: { ...buildStroke(), dashOffset },
              } as Partial<PenNode>)
            }
          />
        </div>
        <div className="grid grid-cols-5 gap-2">
          {(["上", "右", "下", "左"] as const).map((label, index) => (
            <NumberField
              key={label}
              label={label}
              value={edgeWidths[index] ?? 0}
              min={0}
              step={0.5}
              onChange={(edgeWidth) => {
                const next = [...edgeWidths] as [
                  number,
                  number,
                  number,
                  number,
                ];
                next[index] = edgeWidth;
                onUpdate({
                  stroke: { ...buildStroke(), thickness: next },
                } as Partial<PenNode>);
              }}
            />
          ))}
          <NumberField
            label="斜接"
            value={stroke?.miterLimit ?? 4}
            min={1}
            step={0.5}
            onChange={(miterLimit) =>
              onUpdate({
                stroke: { ...buildStroke(), miterLimit },
              } as Partial<PenNode>)
            }
          />
        </div>
      </div>
    </InspectorSection>
  );
}

// ─── TextSection ─────────────────────────────────────────────────────────────

function TextSection({
  node,
  onUpdate,
}: {
  node: Extract<PenNode, { type: "text" }>;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const color = extractSolidFillColor(node.fill) ?? "#111827";
  const content = node.content;
  const updateSegment = (index: number, segment: StyledTextSegment) => {
    if (!isStyledTextContent(content)) return;
    onUpdate({
      content: content.map((item, itemIndex) =>
        itemIndex === index ? segment : item,
      ),
    } as Partial<PenNode>);
  };

  return (
    <InspectorSection title="文本内容">
      <div className="space-y-2">
        {!isStyledTextContent(content) ? (
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={String(content ?? "")}
            onChange={(event) =>
              onUpdate({
                content: event.currentTarget.value,
              } as Partial<PenNode>)
            }
          />
        ) : (
          content.map((segment, index) => {
            const segmentNumber = index + 1;
            const segmentColor = segmentFillColor(segment);
            return (
              <div
                key={`${segment.text}-${index}`}
                className="space-y-2 rounded-lg border border-border/60 bg-muted/50 p-2 shadow-subtle"
              >
                <textarea
                  aria-label={`文本段 ${segmentNumber}`}
                  className="h-16 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20"
                  value={segment.text}
                  onChange={(event) =>
                    updateSegment(index, {
                      ...segment,
                      text: event.currentTarget.value,
                    })
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label={`文本段 ${segmentNumber} 字体`}
                    className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
                    placeholder="Font family"
                    value={segment.fontFamily ?? ""}
                    onChange={(event) =>
                      updateSegment(index, {
                        ...segment,
                        fontFamily: event.currentTarget.value,
                      })
                    }
                  />
                  <input
                    aria-label={`文本段 ${segmentNumber} PostScript`}
                    className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
                    placeholder="PostScript"
                    value={segment.fontPostScriptName ?? ""}
                    onChange={(event) =>
                      updateSegment(index, {
                        ...segment,
                        fontPostScriptName: event.currentTarget.value,
                      })
                    }
                  />
                  <NumberField
                    label="字号"
                    ariaLabel={`文本段 ${segmentNumber} 字号`}
                    value={segment.fontSize ?? node.fontSize ?? 16}
                    min={1}
                    onChange={(fontSize) =>
                      updateSegment(index, { ...segment, fontSize })
                    }
                  />
                  <NumberField
                    label="字距"
                    ariaLabel={`文本段 ${segmentNumber} 字距`}
                    value={segment.letterSpacing ?? 0}
                    step={0.1}
                    onChange={(letterSpacing) =>
                      updateSegment(index, { ...segment, letterSpacing })
                    }
                  />
                  <NumberField
                    label="基线"
                    ariaLabel={`文本段 ${segmentNumber} 基线`}
                    value={segment.baselineShift ?? 0}
                    step={0.5}
                    onChange={(baselineShift) =>
                      updateSegment(index, { ...segment, baselineShift })
                    }
                  />
                  <select
                    aria-label={`文本段 ${segmentNumber} 大小写`}
                    className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
                    value={segment.textCase ?? "original"}
                    onChange={(event) =>
                      updateSegment(index, {
                        ...segment,
                        textCase: event.currentTarget.value as
                          | "original"
                          | "upper"
                          | "lower"
                          | "title",
                      })
                    }
                  >
                    <option value="original">原样</option>
                    <option value="upper">大写</option>
                    <option value="lower">小写</option>
                    <option value="title">标题式</option>
                  </select>
                </div>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 shadow-subtle">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    段颜色
                  </span>
                  <ColorPickerPopover
                    color={segmentColor}
                    onChange={(nextColor) =>
                      updateSegment(index, {
                        ...segment,
                        fill: nextColor,
                        fills: [{ type: "solid", color: nextColor }],
                      })
                    }
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {segmentColor.replace(/^#/, "").toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="字号"
            value={node.fontSize ?? 16}
            min={1}
            onChange={(fontSize) => onUpdate({ fontSize } as Partial<PenNode>)}
          />
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 shadow-subtle">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              颜色
            </span>
            <ColorPickerPopover
              color={color}
              onChange={(c) =>
                onUpdate({
                  fill: [{ type: "solid", color: c }],
                } as Partial<PenNode>)
              }
            />
          </div>
        </div>
      </div>
    </InspectorSection>
  );
}

// ─── EffectsSection ─────────────────────────────────────────────────────────────

function EffectLayerRow({
  effect,
  index,
  count,
  onUpdate,
  onRemove,
  onMove,
}: {
  effect: PenEffect;
  index: number;
  count: number;
  onUpdate: (effect: PenEffect) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const layerNumber = index + 1;
  const visible = effect.visible !== false;
  const opacity = effectOpacity(effect);
  const effectType = effectInspectorType(effect);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/50 p-2 shadow-subtle">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <InspectorIconButton
          icon={visible ? Eye : EyeOff}
          label={
            visible ? `隐藏效果 ${layerNumber}` : `显示效果 ${layerNumber}`
          }
          active={visible}
          onClick={() =>
            onUpdate({ ...effect, visible: !visible } as PenEffect)
          }
        />
        <select
          aria-label={`效果 ${layerNumber} 类型`}
          className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          value={effectType}
          onChange={(event) =>
            onUpdate(
              createEffectOfType(
                event.currentTarget.value as EffectInspectorType,
                effect,
              ),
            )
          }
        >
          {EFFECT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <InspectorIconButton
            icon={ArrowUp}
            label={`上移效果 ${layerNumber}`}
            disabled={index === 0}
            onClick={() => onMove("up")}
          />
          <InspectorIconButton
            icon={ArrowDown}
            label={`下移效果 ${layerNumber}`}
            disabled={index === count - 1}
            onClick={() => onMove("down")}
          />
          <InspectorIconButton
            icon={Minus}
            label={`移除效果 ${layerNumber}`}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="透明"
          ariaLabel={`效果 ${layerNumber} 透明`}
          suffix="%"
          value={opacity}
          min={0}
          max={100}
          onChange={(nextOpacity) =>
            onUpdate({ ...effect, opacity: nextOpacity / 100 } as PenEffect)
          }
        />
        <select
          aria-label={`效果 ${layerNumber} 混合模式`}
          className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          value={effect.blendMode ?? "normal"}
          onChange={(event) =>
            onUpdate({
              ...effect,
              blendMode: event.currentTarget.value as BlendMode,
            } as PenEffect)
          }
        >
          {BLEND_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {effect.type === "shadow" ? (
        <>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-3">
              <ColorPickerPopover
                color={effect.color}
                onChange={(color) => onUpdate({ ...effect, color })}
              />
              <span className="truncate text-sm font-medium text-foreground">
                {effect.color.replace(/^#/, "").toUpperCase()}
              </span>
            </div>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm text-muted-foreground shadow-subtle">
              <input
                type="checkbox"
                checked={effect.inner === true}
                onChange={(event) =>
                  onUpdate({
                    ...effect,
                    inner: event.currentTarget.checked,
                  })
                }
              />
              <span className="font-medium">内阴影</span>
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <NumberField
              label="X"
              ariaLabel={`效果 ${layerNumber} X`}
              value={effect.offsetX ?? 0}
              onChange={(offsetX) => onUpdate({ ...effect, offsetX })}
            />
            <NumberField
              label="Y"
              ariaLabel={`效果 ${layerNumber} Y`}
              value={effect.offsetY ?? 0}
              onChange={(offsetY) => onUpdate({ ...effect, offsetY })}
            />
            <NumberField
              label="模糊"
              ariaLabel={`效果 ${layerNumber} 模糊`}
              value={effect.blur ?? 0}
              min={0}
              onChange={(blur) => onUpdate({ ...effect, blur })}
            />
            <NumberField
              label="扩展"
              ariaLabel={`效果 ${layerNumber} 扩展`}
              value={effect.spread ?? 0}
              onChange={(spread) => onUpdate({ ...effect, spread })}
            />
          </div>
        </>
      ) : (
        <NumberField
          label="半径"
          ariaLabel={`效果 ${layerNumber} 半径`}
          value={effect.radius ?? 4}
          min={0}
          step={0.5}
          onChange={(radius) => onUpdate({ ...effect, radius })}
        />
      )}
    </div>
  );
}

function EffectsSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const effects = (node as NodeWithOptionalPaint).effects ?? [];

  const updateEffectAt = (index: number, nextEffect: PenEffect) => {
    onUpdate({
      effects: effects.map((effect, effectIndex) =>
        effectIndex === index ? nextEffect : effect,
      ),
    } as Partial<PenNode>);
  };

  const moveEffect = (index: number, direction: "up" | "down") => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= effects.length) return;
    const next = [...effects];
    const current = next[index];
    const target = next[nextIndex];
    if (!current || !target) return;
    next[index] = target;
    next[nextIndex] = current;
    onUpdate({ effects: next } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="效果"
      muted={effects.length === 0}
      actions={
        <InspectorIconButton
          icon={Plus}
          label="添加效果"
          onClick={() =>
            onUpdate({
              effects: [...effects, createEffectOfType("shadow")],
            } as Partial<PenNode>)
          }
        />
      }
    >
      <div className="space-y-2">
        {effects.length > 0 ? (
          effects.map((effect, index) => (
            <EffectLayerRow
              key={`${effect.type}-${index}`}
              effect={effect}
              index={index}
              count={effects.length}
              onUpdate={(nextEffect) => updateEffectAt(index, nextEffect)}
              onRemove={() =>
                onUpdate({
                  effects: effects.filter(
                    (_effect, effectIndex) => effectIndex !== index,
                  ),
                } as Partial<PenNode>)
              }
              onMove={(direction) => moveEffect(index, direction)}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            当前没有效果。点击加号添加投影、内阴影、图层模糊或背景模糊。
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

// ─── AutoLayoutSection ────────────────────────────────────────────────────────

function AutoLayoutSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const n = node as LayoutEditableNode;
  const hasLayout = n.layout === "vertical" || n.layout === "horizontal";
  const layoutMode: "none" | "vertical" | "horizontal" = hasLayout
    ? (n.layout as "vertical" | "horizontal")
    : "none";
  const edgePadding = paddingTuple(n.padding);

  return (
    <InspectorSection
      title="布局"
      actions={
        <InspectorIconButton
          icon={Plus}
          label="启用自动布局"
          disabled={hasLayout}
          onClick={() =>
            onUpdate({
              layout: "vertical",
              gap: 8,
              padding: 12,
              justifyContent: "start",
              alignItems: "start",
            } as Partial<PenNode>)
          }
        />
      }
    >
      <div className="space-y-3">
        <SegmentedControl
          value={layoutMode}
          options={[
            { value: "none", label: "自由布局", icon: Grid2X2 },
            { value: "vertical", label: "垂直自动布局", icon: Rows3 },
            { value: "horizontal", label: "水平自动布局", icon: Columns3 },
          ]}
          onChange={(value) => {
            if (value === "none") {
              onUpdate({
                layout: null,
                gap: null,
                padding: null,
                justifyContent: null,
                alignItems: null,
              } as ClearLayoutUpdate);
              return;
            }

            onUpdate({
              layout: value,
              gap: typeof n.gap === "number" ? n.gap : 8,
              padding: n.padding ?? 12,
              justifyContent: n.justifyContent ?? "start",
              alignItems: n.alignItems ?? "start",
            } as Partial<PenNode>);
          }}
        />
        {hasLayout ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="间距"
                value={typeof n.gap === "number" ? n.gap : 0}
                min={0}
                onChange={(gap) => onUpdate({ gap } as Partial<PenNode>)}
              />
              <NumberField
                label="内边距"
                value={
                  typeof n.padding === "number"
                    ? n.padding
                    : Array.isArray(n.padding)
                      ? (n.padding[0] ?? 0)
                      : 0
                }
                min={0}
                onChange={(padding) =>
                  onUpdate({ padding } as Partial<PenNode>)
                }
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(["上", "右", "下", "左"] as const).map((label, index) => (
                <NumberField
                  key={label}
                  label={label}
                  ariaLabel={`内边距${label}`}
                  value={edgePadding[index] ?? 0}
                  min={0}
                  onChange={(paddingValue) => {
                    const next = [...edgePadding] as [
                      number,
                      number,
                      number,
                      number,
                    ];
                    next[index] = paddingValue;
                    onUpdate({ padding: next } as Partial<PenNode>);
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="主轴对齐"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
                value={n.justifyContent ?? "start"}
                onChange={(event) =>
                  onUpdate({
                    justifyContent: event.currentTarget.value,
                  } as Partial<PenNode>)
                }
              >
                <option value="start">主轴 起始</option>
                <option value="center">主轴 居中</option>
                <option value="end">主轴 结束</option>
                <option value="space_between">主轴 两端</option>
                <option value="space_around">主轴 环绕</option>
              </select>
              <select
                aria-label="交叉对齐"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
                value={n.alignItems ?? "start"}
                onChange={(event) =>
                  onUpdate({
                    alignItems: event.currentTarget.value,
                  } as Partial<PenNode>)
                }
              >
                <option value="start">交叉 起始</option>
                <option value="center">交叉 居中</option>
                <option value="end">交叉 结束</option>
                <option value="stretch">交叉 拉伸</option>
              </select>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="h-9 w-full rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted"
            onClick={() => {
              onUpdate({
                layout: "vertical",
                gap: 8,
                padding: 12,
                justifyContent: "start",
                alignItems: "start",
              } as Partial<PenNode>);
            }}
          >
            启用自动布局
          </button>
        )}
      </div>
    </InspectorSection>
  );
}

// ─── AgentBindingSection ─────────────────────────────────────────────────────

function AgentBindingSection({
  node,
  onBindAgent,
}: {
  node: Extract<PenNode, { type: "frame" }>;
  onBindAgent: (binding: AgentBinding) => void;
}) {
  const [name, setName] = useState(node.agentBinding?.name ?? "");

  const handleBind = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onBindAgent({
      agentId: node.agentBinding?.agentId ?? `agent-${Date.now()}`,
      name: trimmed,
      color: node.agentBinding?.color,
      status: node.agentBinding?.status ?? "idle",
      permissions: node.agentBinding?.permissions ?? ["read", "write"],
    });
  }, [name, node.agentBinding, onBindAgent]);

  return (
    <InspectorSection title="Agent 绑定">
      <div className="flex items-center gap-2">
        <input
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          placeholder="Agent name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleBind()}
        />
        <button
          type="button"
          className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={handleBind}
        >
          绑定
        </button>
      </div>
      {node.agentBinding?.status ? (
        <span className="text-[10px] text-muted-foreground">
          Status: {node.agentBinding.status}
        </span>
      ) : null}
    </InspectorSection>
  );
}

// ─── ImportedAutoLayoutSection ───────────────────────────────────────────────

function formatPadding(
  padding:
    | number
    | [number, number]
    | [number, number, number, number]
    | undefined,
): string | undefined {
  if (padding === undefined) return undefined;
  if (typeof padding === "number") return `${padding}`;
  return padding.join(" / ");
}

function ImportedAutoLayoutSection({
  node,
  onApply,
}: {
  node: PenNode;
  onApply: () => void;
}) {
  const meta = (node as NodeWithOptionalPaint).meta;
  const importedMeta = getCanvasImportedNodeMeta(
    isRecord(meta) ? meta : undefined,
  );
  const autoLayout = importedMeta?.autoLayout;
  if (!autoLayout) return null;

  const entries: Array<[string, string]> = [
    ["方向", autoLayout.layout],
    ["间距", autoLayout.gap],
    ["内边距", formatPadding(autoLayout.padding)],
    ["主轴对齐", autoLayout.justifyContent],
    ["交叉对齐", autoLayout.alignItems],
    [
      "裁切",
      autoLayout.clipContent === undefined
        ? undefined
        : autoLayout.clipContent
          ? "开启"
          : "关闭",
    ],
  ]
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([label, value]) => [label, String(value)]);

  const children = (node as NodeWithOptionalPaint).children;
  const hasChildren = Array.isArray(children) && children.length > 0;

  return (
    <InspectorSection title="导入布局">
      <div className="grid grid-cols-2 gap-1">
        {entries.map(([label, value]) => (
          <div key={label} className="text-[10px] text-muted-foreground">
            <span className="font-medium">{label}:</span> {value}
          </div>
        ))}
      </div>
      {hasChildren ? (
        <button
          type="button"
          className="mt-2 h-9 w-full rounded-lg bg-foreground/[0.08] text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
          onClick={onApply}
        >
          应用到子节点
        </button>
      ) : null}
    </InspectorSection>
  );
}

function VariableBindingSection({
  node,
  variables,
  onVariablesChange,
  onUpdate,
}: {
  node: PenNode;
  variables?: CanvasVariableMap;
  onVariablesChange?: (variables: CanvasVariableMap) => void;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#111827");
  const colorVariables = Object.entries(variables ?? {}).filter(
    ([, variable]) => variable.type === "color",
  );
  const variableRefEntries = Object.entries(node.variableRefs ?? {});
  const currentFill = extractSolidFillColor(getNodeFill(node));
  const selectedName = currentFill?.startsWith("$") ? currentFill.slice(1) : "";
  const canBindColor =
    supportsFill(node) || node.type === "frame" || node.type === "text";

  if (!canBindColor) return null;

  return (
    <InspectorSection
      title="变量"
      actions={<InspectorIconButton icon={Link} label="绑定变量" disabled />}
    >
      <label className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] text-muted-foreground">
          颜色
        </span>
        <select
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
          value={selectedName}
          onChange={(event) => {
            const variableName = event.currentTarget.value;
            if (!variableName) return;
            onUpdate({
              fill: [{ type: "solid", color: `$${variableName}` }],
            } as Partial<PenNode>);
          }}
        >
          <option value="">未绑定</option>
          {colorVariables.map(([name, variable]) => (
            <option key={name} value={name}>
              {name} {typeof variable.value === "string" ? variable.value : ""}
            </option>
          ))}
        </select>
      </label>
      {onVariablesChange ? (
        <>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <input
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              placeholder="newColorToken"
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
            />
            <ColorPickerPopover color={newColor} onChange={setNewColor} />
            <button
              type="button"
              className="col-span-2 h-9 rounded-lg bg-foreground/[0.08] text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
              onClick={() => {
                const name = newName.trim();
                if (!name) return;
                onVariablesChange({
                  ...(variables ?? {}),
                  [name]: { type: "color", value: newColor },
                });
                onUpdate({
                  fill: [{ type: "solid", color: `$${name}` }],
                } as Partial<PenNode>);
                setNewName("");
              }}
            >
              新建并绑定颜色变量
            </button>
          </div>
          {variableRefEntries.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
              <div className="text-[11px] font-semibold text-muted-foreground">
                引用的变量
              </div>
              {variableRefEntries.map(([property, refValue], index) => {
                const resolved = findVariableDefinition(variables, refValue);
                const variableName = resolved?.[0];
                const variable = resolved?.[1];
                return (
                  <div
                    key={property}
                    className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-2"
                  >
                    <div className="grid grid-cols-[1fr_1fr] gap-2 text-[11px] font-medium text-muted-foreground">
                      <span className="truncate" title={property}>
                        {property}
                      </span>
                      <span
                        className="truncate text-right"
                        title={variableRefLabel(refValue)}
                      >
                        {variable?.name ??
                          variableName ??
                          variableRefLabel(refValue)}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {variable
                        ? `${variable.source ?? "local"} · ${variable.id ?? variable.name ?? variableName} · ${
                            variable.unresolved ? "未解析" : "已解析"
                          }`
                        : "未找到对应变量定义"}
                    </div>
                    {variable && variableName ? (
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          aria-label={`变量 ${index + 1} 值`}
                          className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
                          value={formatVariableValue(variable.value)}
                          onChange={(event) => {
                            try {
                              onVariablesChange({
                                ...(variables ?? {}),
                                [variableName]: {
                                  ...variable,
                                  value: parseVariableValueInput(
                                    variable.type,
                                    event.currentTarget.value,
                                  ),
                                  unresolved: false,
                                },
                              });
                            } catch (error) {
                              console.warn(
                                "[canvas-property-panel] ignored invalid variable value",
                                { property, variableName, error },
                              );
                            }
                          }}
                        />
                        {variable.type === "color" &&
                        typeof variable.value === "string" ? (
                          <ColorPickerPopover
                            color={variable.value}
                            onChange={(color) =>
                              onVariablesChange({
                                ...(variables ?? {}),
                                [variableName]: {
                                  ...variable,
                                  value: color,
                                  unresolved: false,
                                },
                              })
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </InspectorSection>
  );
}

function TypographySection({
  node,
  onUpdate,
}: {
  node: Extract<PenNode, { type: "text" }>;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const [fallbackInput, setFallbackInput] = useState(
    formatFontFallback(node.fontFallback),
  );
  const [openTypeInput, setOpenTypeInput] = useState(
    formatOpenTypeFeatures(node.openTypeFeatures),
  );

  useEffect(() => {
    setFallbackInput(formatFontFallback(node.fontFallback));
  }, [node.fontFallback]);

  useEffect(() => {
    setOpenTypeInput(formatOpenTypeFeatures(node.openTypeFeatures));
  }, [node.openTypeFeatures]);

  return (
    <InspectorSection
      title="字体排印"
      actions={
        <>
          <InspectorIconButton icon={Type} label="字体" disabled />
          <InspectorIconButton icon={Grid2X2} label="文本样式" disabled />
        </>
      }
    >
      <div className="space-y-2">
        <input
          className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder="Font family"
          value={node.fontFamily ?? ""}
          onChange={(event) =>
            onUpdate({
              fontFamily: event.currentTarget.value,
            } as Partial<PenNode>)
          }
        />
        <input
          aria-label="PostScript 字体名"
          className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder="PostScript name"
          value={node.fontPostScriptName ?? ""}
          onChange={(event) =>
            onUpdate({
              fontPostScriptName: event.currentTarget.value,
            } as Partial<PenNode>)
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="W"
            value={Number(node.fontWeight ?? 400)}
            min={100}
            step={100}
            onChange={(fontWeight) =>
              onUpdate({ fontWeight } as Partial<PenNode>)
            }
          />
          <NumberField
            label="行高"
            value={node.lineHeight ?? Math.round((node.fontSize ?? 16) * 1.3)}
            min={1}
            onChange={(lineHeight) =>
              onUpdate({ lineHeight } as Partial<PenNode>)
            }
          />
          <NumberField
            label="段距"
            ariaLabel="段落间距"
            value={node.paragraphSpacing ?? 0}
            min={0}
            onChange={(paragraphSpacing) =>
              onUpdate({ paragraphSpacing } as Partial<PenNode>)
            }
          />
          <NumberField
            label="基线"
            ariaLabel="基线偏移"
            value={node.baselineShift ?? 0}
            step={0.5}
            onChange={(baselineShift) =>
              onUpdate({ baselineShift } as Partial<PenNode>)
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="字距"
            value={node.letterSpacing ?? 0}
            step={0.1}
            onChange={(letterSpacing) =>
              onUpdate({ letterSpacing } as Partial<PenNode>)
            }
          />
          <SegmentedControl
            value={node.textAlign ?? "left"}
            options={[
              { value: "left", label: "左对齐", icon: AlignLeft },
              { value: "center", label: "居中", icon: AlignCenter },
              { value: "right", label: "右对齐", icon: AlignRight },
              { value: "justify", label: "两端对齐", icon: AlignJustify },
            ]}
            onChange={(textAlign) =>
              onUpdate({ textAlign } as Partial<PenNode>)
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="垂直对齐"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.textAlignVertical ?? "top"}
            onChange={(event) =>
              onUpdate({
                textAlignVertical: event.currentTarget.value as
                  | "top"
                  | "middle"
                  | "bottom",
              } as Partial<PenNode>)
            }
          >
            <option value="top">顶部</option>
            <option value="middle">居中</option>
            <option value="bottom">底部</option>
          </select>
          <select
            aria-label="文本自适应"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.textGrowth ?? "fixed-width-height"}
            onChange={(event) =>
              onUpdate({
                textGrowth: event.currentTarget.value as
                  | "auto"
                  | "fixed-width"
                  | "fixed-width-height",
              } as Partial<PenNode>)
            }
          >
            <option value="auto">自动宽高</option>
            <option value="fixed-width">固定宽</option>
            <option value="fixed-width-height">固定宽高</option>
          </select>
          <select
            aria-label="大小写"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.textCase ?? "original"}
            onChange={(event) =>
              onUpdate({
                textCase: event.currentTarget.value as
                  | "original"
                  | "upper"
                  | "lower"
                  | "title",
              } as Partial<PenNode>)
            }
          >
            <option value="original">原样</option>
            <option value="upper">大写</option>
            <option value="lower">小写</option>
            <option value="title">标题式</option>
          </select>
          <select
            aria-label="列表样式"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.listStyle ?? "none"}
            onChange={(event) =>
              onUpdate({
                listStyle: event.currentTarget.value as
                  | "none"
                  | "ordered"
                  | "unordered",
              } as Partial<PenNode>)
            }
          >
            <option value="none">无列表</option>
            <option value="ordered">有序列表</option>
            <option value="unordered">无序列表</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="缩进"
            ariaLabel="文本缩进"
            value={node.indent ?? 0}
            min={0}
            onChange={(indent) => onUpdate({ indent } as Partial<PenNode>)}
          />
          <NumberField
            label="悬挂"
            ariaLabel="悬挂缩进"
            value={node.hangingIndent ?? 0}
            min={0}
            onChange={(hangingIndent) =>
              onUpdate({ hangingIndent } as Partial<PenNode>)
            }
          />
        </div>
        <input
          aria-label="字体 fallback"
          className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder="Fallback fonts, comma separated"
          value={fallbackInput}
          onChange={(event) => setFallbackInput(event.currentTarget.value)}
          onBlur={() =>
            onUpdate({
              fontFallback: parseFontFallback(fallbackInput),
            } as Partial<PenNode>)
          }
        />
        <input
          aria-label="OpenType 特性"
          className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder="liga=true, kern=1"
          value={openTypeInput}
          onChange={(event) => setOpenTypeInput(event.currentTarget.value)}
          onBlur={() =>
            onUpdate({
              openTypeFeatures: parseOpenTypeFeatures(openTypeInput),
            } as Partial<PenNode>)
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg border border-transparent bg-muted/70 text-sm font-medium shadow-subtle transition-colors hover:bg-muted",
              node.fontStyle === "italic" && "border-border bg-background",
            )}
            onClick={() =>
              onUpdate({
                fontStyle: node.fontStyle === "italic" ? "normal" : "italic",
              } as Partial<PenNode>)
            }
          >
            <Italic className="h-4 w-4" />
            Italic
          </button>
          <button
            type="button"
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg border border-transparent bg-muted/70 text-sm font-medium shadow-subtle transition-colors hover:bg-muted",
              node.underline && "border-border bg-background",
            )}
            onClick={() =>
              onUpdate({ underline: !node.underline } as Partial<PenNode>)
            }
          >
            <Underline className="h-4 w-4" />
            Underline
          </button>
          <button
            type="button"
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg border border-transparent bg-muted/70 text-sm font-medium shadow-subtle transition-colors hover:bg-muted",
              node.strikethrough && "border-border bg-background",
            )}
            onClick={() =>
              onUpdate({
                strikethrough: !node.strikethrough,
              } as Partial<PenNode>)
            }
          >
            Strike
          </button>
        </div>
      </div>
    </InspectorSection>
  );
}

function MaskSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const maskNode = node as MaskEditableNode;
  const mask = maskNode.mask ?? {};
  const updateMask = (updates: NonNullable<PenNode["mask"]>) => {
    onUpdate({
      mask: {
        ...mask,
        ...updates,
      },
    } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="遮罩"
      muted={mask.enabled !== true}
      actions={<InspectorIconButton icon={Scissors} label="遮罩" disabled />}
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
            <input
              type="checkbox"
              checked={mask.enabled === true}
              onChange={(event) =>
                updateMask({ enabled: event.currentTarget.checked })
              }
            />
            <span className="font-medium">启用遮罩</span>
          </label>
          <select
            aria-label="遮罩类型"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={mask.type ?? "alpha"}
            onChange={(event) =>
              updateMask({
                type: event.currentTarget.value as "alpha" | "vector",
              })
            }
          >
            <option value="alpha">Alpha</option>
            <option value="vector">Vector</option>
          </select>
        </div>
        <input
          aria-label="遮罩来源节点"
          className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder="source node id"
          value={mask.sourceNodeId ?? ""}
          onChange={(event) =>
            updateMask({ sourceNodeId: event.currentTarget.value })
          }
        />
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
          <input
            type="checkbox"
            checked={mask.shouldBreakMaskChain === true}
            onChange={(event) =>
              updateMask({ shouldBreakMaskChain: event.currentTarget.checked })
            }
          />
          <span className="font-medium">断开遮罩链</span>
        </label>
      </div>
    </InspectorSection>
  );
}

function DesignReferencesSection({
  node,
  styleDefinitions,
  onStyleDefinitionsChange,
  onUpdate,
}: {
  node: PenNode;
  styleDefinitions?: CanvasStyleDefinitionMap;
  onStyleDefinitionsChange?: (
    styleDefinitions: CanvasStyleDefinitionMap,
  ) => void;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const [variableRefsInput, setVariableRefsInput] = useState(
    formatReferenceValue(node.variableRefs),
  );
  const [variableRefsError, setVariableRefsError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setVariableRefsInput(formatReferenceValue(node.variableRefs));
  }, [node.variableRefs]);

  const styleRefs = node.styleRefs ?? {};
  const updateStyleDefinition = (
    id: string,
    updates: Partial<PenStyleDefinition>,
  ) => {
    const current = styleDefinitions?.[id];
    if (!current || !onStyleDefinitionsChange) return;
    onStyleDefinitionsChange({
      ...(styleDefinitions ?? {}),
      [id]: { ...current, ...updates },
    });
  };
  const updateStyleRef = (kind: StyleRefKind, id: string) => {
    const next = { ...styleRefs };
    const trimmedId = id.trim();
    if (trimmedId) {
      next[kind] = {
        source: next[kind]?.source ?? "figma",
        id: trimmedId,
      };
    } else {
      delete next[kind];
    }
    onUpdate({ styleRefs: next } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="样式引用"
      actions={<InspectorIconButton icon={Link} label="样式引用" disabled />}
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["fill", "填充样式"],
              ["stroke", "描边样式"],
              ["text", "文本样式"],
              ["effect", "效果样式"],
            ] as const
          ).map(([kind, label]) => (
            <input
              key={kind}
              aria-label={label}
              className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
              placeholder={`${label} ID`}
              value={styleRefs[kind]?.id ?? ""}
              onChange={(event) =>
                updateStyleRef(kind, event.currentTarget.value)
              }
            />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
          <div className="text-[11px] font-semibold text-muted-foreground">
            节点引用的样式
          </div>
          {(
            [
              ["fill", "填充样式"],
              ["stroke", "描边样式"],
              ["text", "文本样式"],
              ["effect", "效果样式"],
            ] as const
          ).some(([kind]) => Boolean(styleRefs[kind])) ? (
            (
              [
                ["fill", "填充样式"],
                ["stroke", "描边样式"],
                ["text", "文本样式"],
                ["effect", "效果样式"],
              ] as const
            ).map(([kind, label]) => {
              const ref = styleRefs[kind];
              if (!ref) return null;
              const definition = styleDefinitions?.[ref.id];
              const firstFill =
                definition?.fill?.[0]?.type === "solid"
                  ? definition.fill[0]
                  : definition?.strokeFill?.[0]?.type === "solid"
                    ? definition.strokeFill[0]
                    : undefined;
              return (
                <div
                  key={kind}
                  className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-2"
                >
                  <div className="grid grid-cols-[auto_1fr] gap-2 text-[11px] font-medium text-muted-foreground">
                    <span>{label}</span>
                    <span className="truncate text-right" title={ref.id}>
                      {definition?.name ?? ref.id}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {styleDefinitionSummary(definition)}
                  </div>
                  {firstFill && definition ? (
                    <div className="flex items-center gap-2">
                      <ColorPickerPopover
                        color={firstFill.color}
                        onChange={(color) => {
                          if (definition.fill?.[0]?.type === "solid") {
                            updateStyleDefinition(ref.id, {
                              fill: [
                                { ...definition.fill[0], color },
                                ...definition.fill.slice(1),
                              ],
                            });
                          } else if (
                            definition.strokeFill?.[0]?.type === "solid"
                          ) {
                            updateStyleDefinition(ref.id, {
                              strokeFill: [
                                { ...definition.strokeFill[0], color },
                                ...definition.strokeFill.slice(1),
                              ],
                            });
                          }
                        }}
                      />
                      <input
                        aria-label={`${label} token 值`}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
                        value={firstFill.color}
                        onChange={(event) => {
                          const color = event.currentTarget.value;
                          if (definition.fill?.[0]?.type === "solid") {
                            updateStyleDefinition(ref.id, {
                              fill: [
                                { ...definition.fill[0], color },
                                ...definition.fill.slice(1),
                              ],
                            });
                          } else if (
                            definition.strokeFill?.[0]?.type === "solid"
                          ) {
                            updateStyleDefinition(ref.id, {
                              strokeFill: [
                                { ...definition.strokeFill[0], color },
                                ...definition.strokeFill.slice(1),
                              ],
                            });
                          }
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground">
              当前节点没有外部样式引用。
            </p>
          )}
        </div>
        <textarea
          aria-label="变量引用 JSON"
          className="h-20 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder='{"fills/0/color":"VariableID"}'
          value={variableRefsInput}
          onChange={(event) => setVariableRefsInput(event.currentTarget.value)}
          onBlur={() => {
            const trimmed = variableRefsInput.trim();
            if (!trimmed) {
              setVariableRefsError(null);
              onUpdate({ variableRefs: {} } as Partial<PenNode>);
              return;
            }
            try {
              const parsed = JSON.parse(trimmed);
              if (!isRecord(parsed)) {
                setVariableRefsError("变量引用必须是 JSON 对象。");
                console.warn(
                  "[canvas-property-panel] ignored non-object reference JSON",
                  { label: "variableRefs" },
                );
                setVariableRefsInput(formatReferenceValue(node.variableRefs));
                return;
              }
              setVariableRefsError(null);
              onUpdate({ variableRefs: parsed } as Partial<PenNode>);
            } catch (error) {
              setVariableRefsError(
                `变量引用 JSON 格式无效：${getJsonParseMessage(error)}`,
              );
              console.warn(
                "[canvas-property-panel] ignored invalid reference JSON",
                { label: "variableRefs", error },
              );
              setVariableRefsInput(formatReferenceValue(node.variableRefs));
              return;
            }
          }}
        />
        {variableRefsError ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {variableRefsError}
          </p>
        ) : null}
      </div>
    </InspectorSection>
  );
}

function ComponentRecordEditor({
  title,
  ariaPrefix,
  record,
  primitiveOnly,
  onChange,
}: {
  title: string;
  ariaPrefix: string;
  record?: Record<string, unknown>;
  primitiveOnly?: boolean;
  onChange: (record: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(record ?? {});
  const updateKey = (oldKey: string, nextKey: string) => {
    const trimmed = nextKey.trim();
    if (!trimmed) return;
    const next = { ...(record ?? {}) };
    const value = next[oldKey];
    delete next[oldKey];
    next[trimmed] = value ?? "";
    onChange(next);
  };
  const updateValue = (key: string, value: string) => {
    onChange({
      ...(record ?? {}),
      [key]: primitiveOnly
        ? parsePrimitiveComponentValue(value)
        : parseStructuredValueInput(value),
    });
  };
  const removeKey = (key: string) => {
    const next = { ...(record ?? {}) };
    delete next[key];
    onChange(next);
  };
  const addKey = () => {
    let index = entries.length + 1;
    let key = `${ariaPrefix}${index}`;
    while (Object.prototype.hasOwnProperty.call(record ?? {}, key)) {
      index += 1;
      key = `${ariaPrefix}${index}`;
    }
    onChange({ ...(record ?? {}), [key]: "" });
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {title}
        </span>
        <InspectorIconButton
          icon={Plus}
          label={`添加${title}`}
          onClick={addKey}
        />
      </div>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map(([key, value], index) => {
            const rowNumber = index + 1;
            return (
              <div key={key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  aria-label={`${title} ${rowNumber} 名称`}
                  className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
                  value={key}
                  onChange={(event) =>
                    updateKey(key, event.currentTarget.value)
                  }
                />
                <input
                  aria-label={`${title} ${rowNumber} 值`}
                  className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
                  value={formatStructuredValue(value)}
                  onChange={(event) =>
                    updateValue(key, event.currentTarget.value)
                  }
                />
                <InspectorIconButton
                  icon={Minus}
                  label={`移除${title} ${rowNumber}`}
                  onClick={() => removeKey(key)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          当前没有{title}。点击加号添加一项。
        </p>
      )}
    </div>
  );
}

type ComponentOverrideRef = NonNullable<
  NonNullable<PenNode["componentRef"]>["overrides"]
>[number];

function ComponentOverrideEditor({
  overrides,
  onChange,
}: {
  overrides?: ComponentOverrideRef[];
  onChange: (overrides: ComponentOverrideRef[]) => void;
}) {
  const list = overrides ?? [];
  const updateOverride = (
    index: number,
    updates: Partial<ComponentOverrideRef>,
  ) => {
    onChange(
      list.map((override, overrideIndex) =>
        overrideIndex === index
          ? {
              ...override,
              ...updates,
              source: updates.source ?? override.source,
            }
          : override,
      ),
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          覆写列表
        </span>
        <InspectorIconButton
          icon={Plus}
          label="添加组件覆写"
          onClick={() =>
            onChange([
              ...list,
              { source: "figma", path: "", properties: [], values: {} },
            ])
          }
        />
      </div>
      {list.length > 0 ? (
        <div className="space-y-2">
          {list.map((override, index) => (
            <ComponentOverrideRow
              key={`${override.path ?? ""}-${override.targetId ?? ""}-${index}`}
              override={override}
              index={index}
              onUpdate={(updates) => updateOverride(index, updates)}
              onRemove={() =>
                onChange(
                  list.filter(
                    (_override, overrideIndex) => overrideIndex !== index,
                  ),
                )
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          当前没有结构化覆写。点击加号添加一条 path / target / values。
        </p>
      )}
    </div>
  );
}

function ComponentOverrideRow({
  override,
  index,
  onUpdate,
  onRemove,
}: {
  override: ComponentOverrideRef;
  index: number;
  onUpdate: (updates: Partial<ComponentOverrideRef>) => void;
  onRemove: () => void;
}) {
  const rowNumber = index + 1;
  const [valuesInput, setValuesInput] = useState(
    formatReferenceValue(override.values),
  );

  useEffect(() => {
    setValuesInput(formatReferenceValue(override.values));
  }, [override.values]);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-2">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <input
          aria-label={`组件覆写 ${rowNumber} 路径`}
          className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
          placeholder="path"
          value={override.path ?? ""}
          onChange={(event) => onUpdate({ path: event.currentTarget.value })}
        />
        <input
          aria-label={`组件覆写 ${rowNumber} 目标`}
          className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
          placeholder="targetId"
          value={override.targetId ?? ""}
          onChange={(event) =>
            onUpdate({ targetId: event.currentTarget.value })
          }
        />
        <InspectorIconButton
          icon={Minus}
          label={`移除组件覆写 ${rowNumber}`}
          onClick={onRemove}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          aria-label={`组件覆写 ${rowNumber} 路径 IDs`}
          className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
          placeholder="root, button"
          value={override.pathIds?.join(", ") ?? ""}
          onChange={(event) =>
            onUpdate({
              pathIds: event.currentTarget.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
        <input
          aria-label={`组件覆写 ${rowNumber} 属性`}
          className="h-9 min-w-0 rounded-lg border border-transparent bg-background px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
          placeholder="fill, visible"
          value={override.properties.join(", ")}
          onChange={(event) =>
            onUpdate({
              properties: event.currentTarget.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <textarea
        aria-label={`组件覆写 ${rowNumber} 值`}
        className="h-16 w-full resize-none rounded-lg border border-transparent bg-background px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:ring-2 focus:ring-ring/20"
        placeholder='{"fill":"#ff0000"}'
        value={valuesInput}
        onChange={(event) => setValuesInput(event.currentTarget.value)}
        onBlur={() => {
          const parsed = parseReferenceObjectInput(
            valuesInput,
            `override ${rowNumber} values`,
          );
          if (!parsed) {
            setValuesInput(formatReferenceValue(override.values));
            return;
          }
          onUpdate({ values: parsed });
        }}
      />
    </div>
  );
}

function ComponentRefSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const shouldShow =
    node.type === "frame" || node.type === "ref" || Boolean(node.componentRef);
  const record = node as unknown as Record<string, unknown>;
  const componentRef = node.componentRef ?? {
    source: "figma",
    type: node.type === "ref" ? "instance" : "component",
  };
  const [variantInput, setVariantInput] = useState(
    formatReferenceValue(componentRef.variantProperties),
  );
  const [componentPropertiesInput, setComponentPropertiesInput] = useState(
    formatReferenceValue(componentRef.componentProperties),
  );
  const [assignmentsInput, setAssignmentsInput] = useState(
    formatReferenceValue(componentRef.propertyAssignments),
  );
  const [overridesInput, setOverridesInput] = useState(
    formatReferenceValue(componentRef.overrides),
  );
  const [componentJsonError, setComponentJsonError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setVariantInput(formatReferenceValue(componentRef.variantProperties));
  }, [componentRef.variantProperties]);

  useEffect(() => {
    setComponentPropertiesInput(
      formatReferenceValue(componentRef.componentProperties),
    );
  }, [componentRef.componentProperties]);

  useEffect(() => {
    setAssignmentsInput(formatReferenceValue(componentRef.propertyAssignments));
  }, [componentRef.propertyAssignments]);

  useEffect(() => {
    setOverridesInput(formatReferenceValue(componentRef.overrides));
  }, [componentRef.overrides]);

  const updateComponentRef = (
    updates: Partial<NonNullable<PenNode["componentRef"]>>,
  ) => {
    onUpdate({
      componentRef: {
        ...componentRef,
        ...updates,
        source: updates.source ?? componentRef.source ?? "figma",
      },
    } as Partial<PenNode>);
  };
  const parseComponentObjectInput = (
    value: string,
    label: string,
  ): Record<string, unknown> | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      setComponentJsonError(null);
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        setComponentJsonError(null);
        return parsed;
      }
      setComponentJsonError(`${label} 必须是 JSON 对象。`);
      console.warn(
        "[canvas-property-panel] ignored non-object reference JSON",
        {
          label,
        },
      );
      return undefined;
    } catch (error) {
      setComponentJsonError(
        `${label} JSON 格式无效：${getJsonParseMessage(error)}`,
      );
      console.warn("[canvas-property-panel] ignored invalid reference JSON", {
        label,
        error,
      });
      return undefined;
    }
  };
  const parseComponentArrayInput = <T,>(
    value: string,
    label: string,
  ): T[] | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      setComponentJsonError(null);
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        setComponentJsonError(null);
        return parsed as T[];
      }
      setComponentJsonError(`${label} 必须是 JSON 数组。`);
      console.warn("[canvas-property-panel] ignored non-array reference JSON", {
        label,
      });
      return undefined;
    } catch (error) {
      setComponentJsonError(
        `${label} JSON 格式无效：${getJsonParseMessage(error)}`,
      );
      console.warn("[canvas-property-panel] ignored invalid reference JSON", {
        label,
        error,
      });
      return undefined;
    }
  };

  if (!shouldShow) return null;

  return (
    <InspectorSection
      title="组件"
      actions={<InspectorIconButton icon={Box} label="组件" disabled />}
    >
      {node.type === "frame" ? (
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
          <input
            type="checkbox"
            checked={record.reusable === true}
            onChange={(event) =>
              onUpdate({
                reusable: event.currentTarget.checked,
              } as Partial<PenNode>)
            }
          />
          Reusable component
        </label>
      ) : null}
      {node.type === "ref" ? (
        <input
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          placeholder="Referenced component id"
          value={String(record.ref ?? "")}
          onChange={(event) =>
            onUpdate({ ref: event.currentTarget.value } as Partial<PenNode>)
          }
        />
      ) : null}
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="组件引用类型"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={componentRef.type}
            onChange={(event) =>
              updateComponentRef({
                type: event.currentTarget.value as NonNullable<
                  PenNode["componentRef"]
                >["type"],
              })
            }
          >
            <option value="component">Component</option>
            <option value="instance">Instance</option>
            <option value="variant">Variant</option>
          </select>
          <input
            aria-label="组件引用来源"
            className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
            placeholder="source"
            value={componentRef.source ?? "figma"}
            onChange={(event) =>
              updateComponentRef({ source: event.currentTarget.value })
            }
          />
          <input
            aria-label="组件引用 ID"
            className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
            placeholder="id"
            value={componentRef.id ?? ""}
            onChange={(event) =>
              updateComponentRef({ id: event.currentTarget.value })
            }
          />
          <input
            aria-label="组件引用 Key"
            className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
            placeholder="key"
            value={componentRef.key ?? ""}
            onChange={(event) =>
              updateComponentRef({ key: event.currentTarget.value })
            }
          />
          <input
            aria-label="组件来源 ID"
            className="h-9 min-w-0 rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
            placeholder="componentId"
            value={componentRef.componentId ?? ""}
            onChange={(event) =>
              updateComponentRef({ componentId: event.currentTarget.value })
            }
          />
          <NumberField
            label="覆写"
            ariaLabel="组件覆写数量"
            value={componentRef.overrideCount ?? 0}
            min={0}
            onChange={(overrideCount) => updateComponentRef({ overrideCount })}
          />
        </div>
        <ComponentRecordEditor
          title="组件变体"
          ariaPrefix="Variant"
          record={componentRef.variantProperties}
          primitiveOnly
          onChange={(variantProperties) =>
            updateComponentRef({
              variantProperties: variantProperties as Record<
                string,
                string | number | boolean
              >,
            })
          }
        />
        <ComponentRecordEditor
          title="组件属性"
          ariaPrefix="Property"
          record={componentRef.componentProperties}
          onChange={(componentProperties) =>
            updateComponentRef({ componentProperties })
          }
        />
        <ComponentRecordEditor
          title="组件赋值"
          ariaPrefix="Assignment"
          record={componentRef.propertyAssignments}
          onChange={(propertyAssignments) =>
            updateComponentRef({ propertyAssignments })
          }
        />
        <ComponentOverrideEditor
          overrides={componentRef.overrides}
          onChange={(overrides) => updateComponentRef({ overrides })}
        />
        <textarea
          aria-label="组件变体 JSON"
          className="h-16 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder='{"Size":"Large"}'
          value={variantInput}
          onChange={(event) => setVariantInput(event.currentTarget.value)}
          onBlur={() => {
            const parsed = parseComponentObjectInput(variantInput, "组件变体");
            if (!parsed) {
              setVariantInput(
                formatReferenceValue(componentRef.variantProperties),
              );
              return;
            }
            updateComponentRef({
              variantProperties: parsed as Record<
                string,
                string | number | boolean
              >,
            });
          }}
        />
        <textarea
          aria-label="组件属性 JSON"
          className="h-16 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder='{"label":"Submit"}'
          value={componentPropertiesInput}
          onChange={(event) =>
            setComponentPropertiesInput(event.currentTarget.value)
          }
          onBlur={() => {
            const parsed = parseComponentObjectInput(
              componentPropertiesInput,
              "组件属性",
            );
            if (!parsed) {
              setComponentPropertiesInput(
                formatReferenceValue(componentRef.componentProperties),
              );
              return;
            }
            updateComponentRef({ componentProperties: parsed });
          }}
        />
        <textarea
          aria-label="组件属性赋值 JSON"
          className="h-16 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder='{"buttonText":"Start"}'
          value={assignmentsInput}
          onChange={(event) => setAssignmentsInput(event.currentTarget.value)}
          onBlur={() => {
            const parsed = parseComponentObjectInput(
              assignmentsInput,
              "组件属性赋值",
            );
            if (!parsed) {
              setAssignmentsInput(
                formatReferenceValue(componentRef.propertyAssignments),
              );
              return;
            }
            updateComponentRef({ propertyAssignments: parsed });
          }}
        />
        <textarea
          aria-label="组件覆写 JSON"
          className="h-20 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
          placeholder='[{"source":"figma","path":"1/2","properties":["fill"]}]'
          value={overridesInput}
          onChange={(event) => setOverridesInput(event.currentTarget.value)}
          onBlur={() => {
            const parsed = parseComponentArrayInput<
              NonNullable<
                NonNullable<PenNode["componentRef"]>["overrides"]
              >[number]
            >(overridesInput, "组件覆写");
            if (!parsed) {
              setOverridesInput(formatReferenceValue(componentRef.overrides));
              return;
            }
            updateComponentRef({ overrides: parsed });
          }}
        />
        {componentJsonError ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {componentJsonError}
          </p>
        ) : null}
      </div>
    </InspectorSection>
  );
}

function PositionSection({
  node,
  bounds,
  onBoundsChange,
  onUpdate,
}: {
  node: PenNode;
  bounds: CanvasBounds;
  onBoundsChange: (updates: Partial<CanvasBounds>) => void;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  return (
    <InspectorSection
      title="位置"
      actions={<InspectorIconButton icon={Move} label="选区定位" disabled />}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={bounds.x}
            onChange={(x) => onBoundsChange({ x })}
          />
          <NumberField
            label="Y"
            value={bounds.y}
            onChange={(y) => onBoundsChange({ y })}
          />
          <NumberField
            label="旋转"
            value={bounds.rotation ?? 0}
            step={0.5}
            onChange={(rotation) => onBoundsChange({ rotation })}
          />
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border/60 bg-muted/70 p-0.5 shadow-subtle">
            <InspectorIconButton
              icon={RotateCw}
              label="重置旋转"
              onClick={() => onBoundsChange({ rotation: 0 })}
            />
            <InspectorIconButton
              icon={FlipHorizontal2}
              label="水平翻转"
              active={node.flipX}
              onClick={() =>
                onUpdate({ flipX: !node.flipX } as Partial<PenNode>)
              }
            />
            <InspectorIconButton
              icon={FlipVertical2}
              label="垂直翻转"
              active={node.flipY}
              onClick={() =>
                onUpdate({ flipY: !node.flipY } as Partial<PenNode>)
              }
            />
          </div>
        </div>
      </div>
    </InspectorSection>
  );
}

function LayoutSizeSection({
  bounds,
  onBoundsChange,
}: {
  bounds: CanvasBounds;
  onBoundsChange: (updates: Partial<CanvasBounds>) => void;
}) {
  return (
    <InspectorSection
      title="尺寸"
      actions={<InspectorIconButton icon={Square} label="锁定比例" disabled />}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="W"
          min={1}
          value={bounds.width}
          onChange={(width) => onBoundsChange({ width })}
        />
        <NumberField
          label="H"
          min={1}
          value={bounds.height}
          onChange={(height) => onBoundsChange({ height })}
        />
      </div>
    </InspectorSection>
  );
}

function LayoutConstraintsSection({
  node,
  parentNode,
  bounds,
  onUpdate,
}: {
  node: PenNode;
  parentNode?: PenNode | null;
  bounds: CanvasBounds;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const parentLayout =
    parentNode && "layout" in parentNode ? parentNode.layout : undefined;
  const isParentAutoLayout =
    parentLayout === "horizontal" || parentLayout === "vertical";
  const layoutConstraints = node.layoutConstraints ?? {};
  const widthMode = layoutConstraints.widthMode ?? "fixed";
  const heightMode = layoutConstraints.heightMode ?? "fixed";

  const updateLayoutConstraints = (
    nextConstraints: Partial<NonNullable<PenNode["layoutConstraints"]>>,
  ) => {
    onUpdate({
      layoutConstraints: {
        ...layoutConstraints,
        ...nextConstraints,
      },
    } as Partial<PenNode>);
  };

  const updateSizingMode = (
    axis: "width" | "height",
    mode: LayoutSizingMode,
  ) => {
    const sizeValue = axis === "width" ? bounds.width : bounds.height;
    onUpdate({
      ...(mode === "fixed" ? { [axis]: sizeValue } : {}),
      layoutConstraints: {
        ...layoutConstraints,
        [`${axis}Mode`]: mode,
      },
    } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="布局约束"
      actions={<InspectorIconButton icon={Grid2X2} label="布局约束" disabled />}
    >
      {!isParentAutoLayout ? (
        <div className="rounded-lg border border-border/60 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground shadow-subtle">
          父级未启用自动布局，布局约束暂不可用
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="宽度模式"
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={widthMode}
              onChange={(event) =>
                updateSizingMode(
                  "width",
                  event.currentTarget.value as LayoutSizingMode,
                )
              }
            >
              <option value="fixed">宽度 固定</option>
              <option value="fit_content">宽度 Hug</option>
              <option value="fill_container">宽度 Fill</option>
            </select>
            <select
              aria-label="高度模式"
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={heightMode}
              onChange={(event) =>
                updateSizingMode(
                  "height",
                  event.currentTarget.value as LayoutSizingMode,
                )
              }
            >
              <option value="fixed">高度 固定</option>
              <option value="fit_content">高度 Hug</option>
              <option value="fill_container">高度 Fill</option>
            </select>
            <select
              aria-label="子项定位"
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={layoutConstraints.positioning ?? "auto"}
              onChange={(event) =>
                updateLayoutConstraints({
                  positioning: event.currentTarget.value as "auto" | "absolute",
                })
              }
            >
              <option value="auto">自动流</option>
              <option value="absolute">绝对定位</option>
            </select>
            <select
              aria-label="自身对齐"
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={layoutConstraints.alignSelf ?? "auto"}
              onChange={(event) =>
                updateLayoutConstraints({
                  alignSelf: event.currentTarget.value as NonNullable<
                    PenNode["layoutConstraints"]
                  >["alignSelf"],
                })
              }
            >
              <option value="auto">自身 自动</option>
              <option value="start">自身 起始</option>
              <option value="center">自身 居中</option>
              <option value="end">自身 结束</option>
              <option value="stretch">自身 拉伸</option>
              <option value="baseline">自身 基线</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Grow"
              ariaLabel="布局 Grow"
              value={layoutConstraints.grow ?? 0}
              min={0}
              step={0.1}
              onChange={(grow) => updateLayoutConstraints({ grow })}
            />
            <div aria-hidden="true" />
          </div>
        </div>
      )}
    </InspectorSection>
  );
}

function TransformSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const transform = nodeTransformMatrix(node);
  const updateTransform = (key: keyof CanvasTransformMatrix, value: number) => {
    onUpdate({
      transform: { ...transform, [key]: value },
    } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="变换"
      actions={
        <InspectorIconButton icon={SlidersHorizontal} label="矩阵" disabled />
      }
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Scale X"
            ariaLabel="Scale X"
            value={node.scaleX ?? 1}
            step={0.01}
            onChange={(scaleX) => onUpdate({ scaleX } as Partial<PenNode>)}
          />
          <NumberField
            label="Scale Y"
            ariaLabel="Scale Y"
            value={node.scaleY ?? 1}
            step={0.01}
            onChange={(scaleY) => onUpdate({ scaleY } as Partial<PenNode>)}
          />
          <NumberField
            label="Skew X"
            ariaLabel="Skew X"
            value={node.skewX ?? 0}
            step={0.1}
            onChange={(skewX) => onUpdate({ skewX } as Partial<PenNode>)}
          />
          <NumberField
            label="Skew Y"
            ariaLabel="Skew Y"
            value={node.skewY ?? 0}
            step={0.1}
            onChange={(skewY) => onUpdate({ skewY } as Partial<PenNode>)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["m00", "m01", "m02", "m10", "m11", "m12"] as const).map((key) => (
            <NumberField
              key={key}
              label={key}
              ariaLabel={`矩阵 ${key}`}
              value={transform[key]}
              step={0.01}
              onChange={(value) => updateTransform(key, value)}
            />
          ))}
        </div>
      </div>
    </InspectorSection>
  );
}

function AppearanceSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const cornerRadius = (node as { cornerRadius?: unknown }).cornerRadius;
  const cornerRadii = cornerRadiusTuple(cornerRadius);
  const cornerSmoothing =
    typeof (node as { cornerSmoothing?: unknown }).cornerSmoothing === "number"
      ? ((node as { cornerSmoothing?: number }).cornerSmoothing ?? 0)
      : 0;
  const clipContent = (node as { clipContent?: boolean }).clipContent === true;
  const isolated = (node as { isolated?: boolean }).isolated === true;
  const canEditCornerRadius =
    node.type === "frame" ||
    node.type === "rectangle" ||
    node.type === "image" ||
    node.type === "polygon";
  const canClipContent = node.type === "frame" || node.type === "group";
  const canEditCornerSmoothing =
    node.type === "frame" || node.type === "group" || node.type === "rectangle";

  return (
    <InspectorSection
      title="外观"
      actions={
        <>
          <InspectorIconButton
            icon={node.visible === false ? EyeOff : Eye}
            label={node.visible === false ? "显示图层" : "隐藏图层"}
            onClick={() =>
              onUpdate({ visible: node.visible === false } as Partial<PenNode>)
            }
          />
          <InspectorIconButton
            icon={Droplet}
            label="混合模式"
            active={Boolean(node.blendMode && node.blendMode !== "normal")}
            disabled
          />
        </>
      }
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="透明"
            suffix="%"
            value={Math.round(Number(node.opacity ?? 1) * 100)}
            min={0}
            max={100}
            onChange={(opacity) =>
              onUpdate({ opacity: clamp(opacity, 0, 100) / 100 })
            }
          />
          <NumberField
            label="圆角"
            value={canEditCornerRadius ? cornerRadii[0] : 0}
            min={0}
            muted={!canEditCornerRadius}
            onChange={(nextCornerRadius) => {
              if (!canEditCornerRadius) return;
              onUpdate({ cornerRadius: nextCornerRadius } as Partial<PenNode>);
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="图层混合模式"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.blendMode ?? "normal"}
            onChange={(event) =>
              onUpdate({
                blendMode: event.currentTarget.value as BlendMode,
              } as Partial<PenNode>)
            }
          >
            {BLEND_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div aria-hidden="true" />
        </div>
        {canEditCornerRadius ? (
          <div className="grid grid-cols-4 gap-2">
            {(["左上", "右上", "右下", "左下"] as const).map((label, index) => (
              <NumberField
                key={label}
                label={label}
                value={cornerRadii[index] ?? 0}
                min={0}
                onChange={(nextRadius) => {
                  const next = [...cornerRadii] as [
                    number,
                    number,
                    number,
                    number,
                  ];
                  next[index] = nextRadius;
                  onUpdate({ cornerRadius: next } as Partial<PenNode>);
                }}
              />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="平滑"
            suffix="%"
            value={Math.round(cornerSmoothing * 100)}
            min={0}
            max={100}
            muted={!canEditCornerSmoothing}
            onChange={(nextSmoothing) => {
              if (!canEditCornerSmoothing) return;
              onUpdate({
                cornerSmoothing: clamp(nextSmoothing, 0, 100) / 100,
              } as Partial<PenNode>);
            }}
          />
          {canClipContent ? (
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
              <input
                type="checkbox"
                checked={clipContent}
                onChange={(event) =>
                  onUpdate({
                    clipContent: event.currentTarget.checked,
                  } as Partial<PenNode>)
                }
              />
              <Scissors className="h-4 w-4" />
              <span className="font-medium">裁剪内容</span>
            </label>
          ) : (
            <div aria-hidden="true" />
          )}
          {canClipContent ? (
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
              <input
                type="checkbox"
                checked={isolated}
                onChange={(event) =>
                  onUpdate({
                    isolated: event.currentTarget.checked,
                  } as Partial<PenNode>)
                }
              />
              <Box className="h-4 w-4" />
              <span className="font-medium">隔离混合</span>
            </label>
          ) : null}
        </div>
      </div>
    </InspectorSection>
  );
}

function PathShapeSection({
  node,
  onUpdate,
}: {
  node: PathEditableNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const [pathDataInput, setPathDataInput] = useState(node.d);
  const [pathError, setPathError] = useState("");
  const diagnosticRows = getVectorDiagnosticRows(node);
  const windingRows = getVectorWindingRows(node);

  useEffect(() => {
    setPathDataInput(node.d);
    setPathError("");
  }, [node.d]);

  const handleSavePathData = () => {
    const nextPathData = pathDataInput.trim();
    const validationError = validatePathDataInput(nextPathData);
    if (validationError) {
      console.warn("[canvas-property-panel] path.d.save.rejected", {
        nodeId: node.id,
        reason: validationError,
      });
      setPathDataInput(node.d);
      setPathError(validationError);
      return;
    }

    const parsedAnchors = pathDataToAnchors(nextPathData);
    const updates: Partial<PathEditableNode> = {
      d: nextPathData,
      anchors: parsedAnchors?.anchors,
      ...(parsedAnchors ? { closed: parsedAnchors.closed } : {}),
    };
    console.info("[canvas-property-panel] path.d.save.applied", {
      nodeId: node.id,
      anchorCount: parsedAnchors?.anchors.length ?? 0,
      parsedAnchors: Boolean(parsedAnchors),
    });
    setPathError("");
    onUpdate(updates as Partial<PenNode>);
  };

  return (
    <InspectorSection title="路径 / 矢量">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="路径填充规则"
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
            value={node.fillRule ?? "nonzero"}
            onChange={(event) =>
              onUpdate({
                fillRule: event.currentTarget.value as "nonzero" | "evenodd",
              } as Partial<PenNode>)
            }
          >
            <option value="nonzero">Nonzero</option>
            <option value="evenodd">Evenodd</option>
          </select>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/70 px-3 text-sm text-muted-foreground shadow-subtle">
            <input
              type="checkbox"
              checked={node.closed === true}
              onChange={(event) =>
                onUpdate({
                  closed: event.currentTarget.checked,
                } as Partial<PenNode>)
              }
            />
            <span className="font-medium">闭合路径</span>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {windingRows.map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-lg border border-border/60 bg-muted/50 px-2 py-1.5"
            >
              <div className="truncate text-[10px] font-medium text-muted-foreground">
                {label}
              </div>
              <div
                className="truncate text-xs font-semibold text-foreground"
                title={value}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Vector Diagnostics
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {diagnosticRows.length > 0
                ? `${diagnosticRows.length} 项`
                : "未记录"}
            </span>
          </div>
          {diagnosticRows.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {diagnosticRows.map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-md bg-muted/60 px-2 py-1.5"
                >
                  <div className="truncate text-[10px] font-medium text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className="truncate text-[11px] font-semibold text-foreground"
                    title={value}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              这个路径没有导入矢量诊断元数据。
            </p>
          )}
        </div>

        <div className="space-y-2">
          <textarea
            aria-label="路径 d 数据"
            className={cn(
              "h-24 w-full resize-none rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-xs shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20",
              pathError && "border-destructive/40 bg-destructive/5",
            )}
            spellCheck={false}
            value={pathDataInput}
            onChange={(event) => {
              setPathDataInput(event.currentTarget.value);
              if (pathError) setPathError("");
            }}
          />
          {pathError ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
              {pathError}
            </p>
          ) : null}
          <button
            type="button"
            className="h-9 w-full rounded-lg bg-foreground/[0.08] text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
            onClick={handleSavePathData}
          >
            保存路径 d
          </button>
        </div>
      </div>
    </InspectorSection>
  );
}

function ShapeSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  if (node.type === "ellipse") {
    return (
      <InspectorSection title="椭圆弧形">
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="起始"
            ariaLabel="起始角度"
            value={node.startAngle ?? 0}
            step={1}
            onChange={(startAngle) =>
              onUpdate({ startAngle } as Partial<PenNode>)
            }
          />
          <NumberField
            label="扫过"
            ariaLabel="扫过角度"
            value={node.sweepAngle ?? 360}
            step={1}
            onChange={(sweepAngle) =>
              onUpdate({ sweepAngle } as Partial<PenNode>)
            }
          />
          <NumberField
            label="内径"
            ariaLabel="内径比例"
            value={node.innerRadius ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(innerRadius) =>
              onUpdate({ innerRadius } as Partial<PenNode>)
            }
          />
        </div>
      </InspectorSection>
    );
  }

  if (node.type === "polygon") {
    return (
      <InspectorSection title="多边形">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="多边形类型"
              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition-colors focus:ring-2 focus:ring-ring/20"
              value={node.polygonKind ?? "polygon"}
              onChange={(event) =>
                onUpdate({
                  polygonKind: event.currentTarget.value as "polygon" | "star",
                } as Partial<PenNode>)
              }
            >
              <option value="polygon">多边形</option>
              <option value="star">星形</option>
            </select>
            <NumberField
              label="边数"
              value={node.polygonCount ?? 3}
              min={3}
              onChange={(polygonCount) =>
                onUpdate({ polygonCount } as Partial<PenNode>)
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="起始"
              ariaLabel="多边形起始角度"
              value={node.startAngle ?? -90}
              step={1}
              onChange={(startAngle) =>
                onUpdate({ startAngle } as Partial<PenNode>)
              }
            />
            <NumberField
              label="内径"
              ariaLabel="星形内径比例"
              value={node.innerRadius ?? 0.5}
              min={0.01}
              max={1}
              step={0.01}
              muted={(node.polygonKind ?? "polygon") !== "star"}
              onChange={(innerRadius) =>
                onUpdate({ innerRadius } as Partial<PenNode>)
              }
            />
            <NumberField
              label="圆角"
              ariaLabel="多边形圆角"
              value={node.cornerRadius ?? 0}
              min={0}
              onChange={(cornerRadius) =>
                onUpdate({ cornerRadius } as Partial<PenNode>)
              }
            />
          </div>
        </div>
      </InspectorSection>
    );
  }

  if (node.type === "path") {
    return <PathShapeSection node={node} onUpdate={onUpdate} />;
  }

  if (node.type === "line") {
    return (
      <InspectorSection title="线条">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X1"
            ariaLabel="起点 X"
            value={node.x ?? 0}
            onChange={(x) => onUpdate({ x } as Partial<PenNode>)}
          />
          <NumberField
            label="Y1"
            ariaLabel="起点 Y"
            value={node.y ?? 0}
            onChange={(y) => onUpdate({ y } as Partial<PenNode>)}
          />
          <NumberField
            label="X2"
            ariaLabel="终点 X"
            value={node.x2 ?? 0}
            onChange={(x2) => onUpdate({ x2 } as Partial<PenNode>)}
          />
          <NumberField
            label="Y2"
            ariaLabel="终点 Y"
            value={node.y2 ?? 0}
            onChange={(y2) => onUpdate({ y2 } as Partial<PenNode>)}
          />
        </div>
      </InspectorSection>
    );
  }

  return null;
}

function SelectedColorsSection({ node }: { node: PenNode }) {
  const colors = [
    extractSolidFillColor(getNodeFill(node)),
    extractSolidStrokeColor(getNodeStroke(node)),
  ].filter((color): color is string => Boolean(color));

  if (colors.length === 0) return null;

  return (
    <InspectorSection title="已选的颜色">
      <div className="flex items-center gap-3">
        {colors.slice(0, 6).map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            size="sm"
            onClick={() => undefined}
          />
        ))}
        {colors.length > 6 ? (
          <span className="text-sm font-semibold text-muted-foreground">
            +{colors.length - 6}
          </span>
        ) : null}
      </div>
    </InspectorSection>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function CanvasPropertyPanel({
  node,
  parentNode,
  variables,
  styleDefinitions,
  onVariablesChange,
  onStyleDefinitionsChange,
  onUpdate,
  onApplyImportedAutoLayout,
  onBindAgent,
}: {
  node: PenNode;
  parentNode?: PenNode | null;
  variables?: CanvasVariableMap;
  styleDefinitions?: CanvasStyleDefinitionMap;
  onVariablesChange?: (variables: CanvasVariableMap) => void;
  onStyleDefinitionsChange?: (
    styleDefinitions: CanvasStyleDefinitionMap,
  ) => void;
  onUpdate: (updates: Partial<PenNode>) => void;
  onApplyImportedAutoLayout?: () => void;
  onBindAgent: (binding: AgentBinding) => void;
}) {
  const bounds = getNodeBounds(node);
  const updateBounds = useCallback(
    (updates: Partial<CanvasBounds>) =>
      onUpdate({ ...getNodeBounds(node), ...updates } as Partial<PenNode>),
    [node, onUpdate],
  );

  const canEditFill = supportsFill(node);
  const canEditStroke = supportsStroke(node);
  const nodeName = node.name?.trim() || nodeTypeLabel(node.type);

  return (
    <div
      className="absolute bottom-4 right-4 top-4 z-20 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card  ring-1 ring-foreground/5 backdrop-blur-lg"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-16 items-center justify-between border-b border-border/70 bg-card/70 px-4">
        <button
          type="button"
          className="flex min-w-0 flex-col items-start gap-0.5 text-left"
          title={nodeName}
        >
          <span className="flex max-w-[184px] items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {nodeTypeLabel(node.type)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </span>
          <span className="max-w-[184px] truncate text-[11px] font-medium text-muted-foreground">
            {node.name?.trim() ? nodeName : "已选节点"}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <InspectorIconButton
            icon={node.locked ? Lock : Unlock}
            label={node.locked ? "解锁" : "锁定"}
            active={node.locked}
            onClick={() =>
              onUpdate({ locked: !node.locked } as Partial<PenNode>)
            }
          />
          <InspectorIconButton icon={Palette} label="样式" disabled />
          <InspectorIconButton icon={MoreHorizontal} label="更多" disabled />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="py-3.5">
          <label className="sr-only" htmlFor={`${node.id}-title`}>
            名称
          </label>
          <input
            id={`${node.id}-title`}
            className="h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm font-medium shadow-subtle outline-none focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/20"
            value={node.name ?? ""}
            placeholder={nodeTypeLabel(node.type)}
            onChange={(event) => onUpdate({ name: event.currentTarget.value })}
          />
        </div>
        <PositionSection
          node={node}
          bounds={bounds}
          onBoundsChange={updateBounds}
          onUpdate={onUpdate}
        />
        <LayoutSizeSection bounds={bounds} onBoundsChange={updateBounds} />
        <LayoutConstraintsSection
          node={node}
          parentNode={parentNode}
          bounds={bounds}
          onUpdate={onUpdate}
        />
        <TransformSection node={node} onUpdate={onUpdate} />
        {node.type === "frame" || node.type === "group" ? (
          <AutoLayoutSection node={node} onUpdate={onUpdate} />
        ) : null}
        <AppearanceSection node={node} onUpdate={onUpdate} />
        {isStickyNoteNode(node) ? null : (
          <MaskSection node={node} onUpdate={onUpdate} />
        )}
        <ShapeSection node={node} onUpdate={onUpdate} />
        {node.type === "text" ? (
          <TypographySection node={node} onUpdate={onUpdate} />
        ) : null}
        {canEditFill ? (
          <FillSection fills={getNodeFill(node)} onUpdate={onUpdate} />
        ) : null}
        {canEditStroke ? (
          <StrokeSection stroke={getNodeStroke(node)} onUpdate={onUpdate} />
        ) : null}
        {node.type === "frame" ? (
          <>
            <FillSection fills={node.fill} onUpdate={onUpdate} />
            <StrokeSection
              stroke={node.stroke as CanvasStroke | undefined}
              onUpdate={onUpdate}
            />
          </>
        ) : null}
        {node.type === "text" ? (
          <TextSection node={node} onUpdate={onUpdate} />
        ) : null}
        <SelectedColorsSection node={node} />
        <EffectsSection node={node} onUpdate={onUpdate} />
        <VariableBindingSection
          node={node}
          variables={variables}
          onVariablesChange={onVariablesChange}
          onUpdate={onUpdate}
        />
        <DesignReferencesSection
          node={node}
          styleDefinitions={styleDefinitions}
          onStyleDefinitionsChange={onStyleDefinitionsChange}
          onUpdate={onUpdate}
        />
        <ComponentRefSection node={node} onUpdate={onUpdate} />
        {node.type === "frame" ? (
          <AgentBindingSection node={node} onBindAgent={onBindAgent} />
        ) : null}
        {onApplyImportedAutoLayout ? (
          <ImportedAutoLayoutSection
            node={node}
            onApply={onApplyImportedAutoLayout}
          />
        ) : null}
      </div>
    </div>
  );
}
