"use client";

import type {
  AgentBinding,
  CanvasBounds,
  CanvasFill,
  CanvasStroke,
  ContextSlots,
  PenEffect,
  PenNode,
} from "@cucumber/canvas-core";
import {
  getCanvasImportedNodeMeta,
  getNodeBounds,
} from "@cucumber/canvas-core";
import type { VariableDefinition } from "@cucumber/pen-types";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
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

// ─── NumberField ─────────────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  muted,
  onChange,
}: {
  label: string;
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
        "flex h-9 min-w-0 items-center rounded-lg bg-muted/60 px-3 text-xs text-muted-foreground",
        "focus-within:bg-background focus-within:ring-1 focus-within:ring-border",
        muted && "opacity-55",
      )}
    >
      <span className="mr-2 shrink-0 font-medium">{label}</span>
      <input
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
        "-mx-3 border-t border-border px-3 py-4 first:border-t-0 first:pt-1",
        muted && "text-muted-foreground",
      )}
    >
      <div className="mb-3 flex h-7 items-center justify-between">
        <h3
          className={cn(
            "text-sm font-semibold tracking-normal text-foreground",
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
        "flex h-8 w-8 items-center justify-center rounded-lg text-foreground transition-colors",
        "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35",
        active && "bg-foreground text-background hover:bg-foreground/90",
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
    <div className="grid h-9 overflow-hidden rounded-lg bg-muted/60 p-0.5">
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
                active && "bg-background text-foreground shadow-sm",
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
          className="absolute left-0 top-9 z-50 w-52 rounded-xl border border-border bg-card p-2 shadow-card"
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

function PaintRow({
  color,
  opacity,
  onColorChange,
  onOpacityChange,
  onRemove,
}: {
  color: string;
  opacity: number;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_3rem_auto] items-center overflow-visible rounded-lg bg-muted/60">
      <div className="flex min-w-0 items-center gap-2 px-3">
        <ColorPickerPopover color={color} onChange={onColorChange} />
        <span className="truncate text-sm font-medium text-foreground">
          {color.replace(/^#/, "").toUpperCase()}
        </span>
      </div>
      <label className="flex h-9 items-center border-l border-background/80 px-2 text-sm">
        <input
          className="w-full bg-transparent text-right font-medium text-foreground outline-none"
          type="number"
          min={0}
          max={100}
          step={1}
          value={opacity}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (!Number.isFinite(next)) {
              console.warn(
                "[canvas-property-panel] ignored invalid paint opacity",
                { value: event.currentTarget.value },
              );
              return;
            }
            onOpacityChange(clamp(next, 0, 100));
          }}
        />
        <span className="ml-1 text-muted-foreground">%</span>
      </label>
      <InspectorIconButton icon={Minus} label="移除此样式" onClick={onRemove} />
    </div>
  );
}

// ─── FillSection ─────────────────────────────────────────────────────────────

function FillSection({
  fills,
  onUpdate,
}: {
  fills?: CanvasFill[];
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const fill = fills?.[0];
  const color = fill?.type === "solid" ? fill.color : "#d3f256";
  const fillType = fill?.type ?? "solid";
  const opacity = solidFillOpacity(fill);

  const handleColorChange = useCallback(
    (newColor: string) => {
      onUpdate({
        fill: [{ type: "solid", color: newColor, opacity: opacity / 100 }],
      } as Partial<PenNode>);
    },
    [onUpdate, opacity],
  );

  const handleOpacityChange = useCallback(
    (nextOpacity: number) => {
      onUpdate({
        fill: [{ type: "solid", color, opacity: nextOpacity / 100 }],
      } as Partial<PenNode>);
    },
    [color, onUpdate],
  );

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
                fill: [{ type: "solid", color, opacity: opacity / 100 }],
              } as Partial<PenNode>)
            }
          />
        </>
      }
    >
      <div className="space-y-2">
        <PaintRow
          color={color}
          opacity={opacity}
          onColorChange={handleColorChange}
          onOpacityChange={handleOpacityChange}
          onRemove={() => onUpdate({ fill: [] } as Partial<PenNode>)}
        />
        {fillType !== "solid" ? (
          <p className="text-xs text-muted-foreground">
            当前为 {fillType}，颜色编辑会转换为纯色填充。
          </p>
        ) : null}
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
  const strokeFill = stroke?.fill?.[0];
  const opacity = solidFillOpacity(strokeFill);

  const handleColorChange = useCallback(
    (newColor: string) => {
      const newStroke: CanvasStroke = {
        ...(stroke ?? { thickness: 1 }),
        fill: [{ type: "solid", color: newColor, opacity: opacity / 100 }],
      };
      onUpdate({ stroke: newStroke } as Partial<PenNode>);
    },
    [onUpdate, opacity, stroke],
  );

  const handleOpacityChange = useCallback(
    (nextOpacity: number) => {
      const newStroke: CanvasStroke = {
        ...(stroke ?? { thickness: width }),
        fill: [{ type: "solid", color, opacity: nextOpacity / 100 }],
      };
      onUpdate({ stroke: newStroke } as Partial<PenNode>);
    },
    [color, onUpdate, stroke, width],
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

  return (
    <InspectorSection
      title="描边"
      actions={
        <>
          <InspectorIconButton icon={Grid2X2} label="样式变量" disabled />
          <InspectorIconButton
            icon={Plus}
            label="添加描边"
            onClick={() =>
              onUpdate({
                stroke: {
                  thickness: width,
                  align: stroke?.align ?? "inside",
                  fill: [{ type: "solid", color, opacity: opacity / 100 }],
                },
              } as Partial<PenNode>)
            }
          />
        </>
      }
    >
      <div className="space-y-2">
        <PaintRow
          color={color}
          opacity={opacity}
          onColorChange={handleColorChange}
          onOpacityChange={handleOpacityChange}
          onRemove={() =>
            onUpdate({
              stroke: {
                ...(stroke ?? { fill: [{ type: "solid", color }] }),
                thickness: 0,
              },
            } as Partial<PenNode>)
          }
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-1 focus:ring-border"
            value={stroke?.align ?? "inside"}
            onChange={(event) =>
              onUpdate({
                stroke: {
                  ...(stroke ?? { fill: [{ type: "solid", color }] }),
                  align: event.currentTarget.value as CanvasStroke["align"],
                  thickness: width,
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

  return (
    <InspectorSection title="文本内容">
      <textarea
        className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-border"
        value={String(node.content ?? "")}
        onChange={(event) =>
          onUpdate({ content: event.currentTarget.value } as Partial<PenNode>)
        }
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="字号"
          value={node.fontSize ?? 16}
          min={1}
          onChange={(fontSize) => onUpdate({ fontSize } as Partial<PenNode>)}
        />
        <div className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-3">
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
    </InspectorSection>
  );
}

// ─── EffectsSection ─────────────────────────────────────────────────────────────

function EffectsSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const effects = (node as NodeWithOptionalPaint).effects ?? [];
  const shadow = effects.find((e) => e.type === "shadow");
  const blurFx = effects.find(
    (e): e is PenEffect & { type: "blur"; radius: number } => e.type === "blur",
  );

  const toggleShadow = () => {
    if (shadow) {
      onUpdate({
        effects: effects.filter((effect) => effect.type !== "shadow"),
      } as Partial<PenNode>);
      return;
    }

    const newEffects: PenEffect[] = effects.filter(
      (effect) => effect.type !== "shadow",
    );
    newEffects.push({
      type: "shadow",
      offsetX: 0,
      offsetY: 4,
      blur: 8,
      spread: 0,
      color: "#00000040",
    });
    onUpdate({ effects: newEffects } as Partial<PenNode>);
  };

  const toggleBlur = () => {
    if (blurFx) {
      onUpdate({
        effects: effects.filter((effect) => effect.type !== "blur"),
      } as Partial<PenNode>);
      return;
    }

    const newEffects: PenEffect[] = effects.filter(
      (effect) => effect.type !== "blur",
    );
    newEffects.push({ type: "blur", radius: 4 });
    onUpdate({ effects: newEffects } as Partial<PenNode>);
  };

  return (
    <InspectorSection
      title="效果"
      muted={!shadow && !blurFx}
      actions={
        <InspectorIconButton
          icon={Plus}
          label="添加阴影"
          onClick={toggleShadow}
        />
      }
    >
      <div className="space-y-2">
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-lg bg-muted/60 px-3 text-sm font-medium",
            shadow && "bg-background ring-1 ring-border",
          )}
          onClick={toggleShadow}
        >
          <span>阴影</span>
          <span className="text-xs text-muted-foreground">
            {shadow ? "已启用" : "未启用"}
          </span>
        </button>
        {shadow ? (
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="X"
              value={shadow.offsetX ?? 0}
              onChange={(offsetX) => {
                const updated = effects.map((effect) =>
                  effect.type === "shadow" ? { ...effect, offsetX } : effect,
                );
                onUpdate({ effects: updated } as Partial<PenNode>);
              }}
            />
            <NumberField
              label="Y"
              value={shadow.offsetY ?? 0}
              onChange={(offsetY) => {
                const updated = effects.map((effect) =>
                  effect.type === "shadow" ? { ...effect, offsetY } : effect,
                );
                onUpdate({ effects: updated } as Partial<PenNode>);
              }}
            />
            <NumberField
              label="模糊"
              value={shadow.blur ?? 0}
              min={0}
              onChange={(blur) => {
                const updated = effects.map((effect) =>
                  effect.type === "shadow" ? { ...effect, blur } : effect,
                );
                onUpdate({ effects: updated } as Partial<PenNode>);
              }}
            />
          </div>
        ) : null}
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-lg bg-muted/60 px-3 text-sm font-medium",
            blurFx && "bg-background ring-1 ring-border",
          )}
          onClick={toggleBlur}
        >
          <span>模糊</span>
          <span className="text-xs text-muted-foreground">
            {blurFx ? "已启用" : "未启用"}
          </span>
        </button>
        {blurFx ? (
          <NumberField
            label="半径"
            value={blurFx.radius ?? 4}
            min={0}
            step={0.5}
            onChange={(radius) => {
              const updated = effects.map((effect) =>
                effect.type === "blur" ? { ...effect, radius } : effect,
              );
              onUpdate({ effects: updated } as Partial<PenNode>);
            }}
          />
        ) : null}
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
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-1 focus:ring-border"
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
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-1 focus:ring-border"
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
              </select>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="h-9 w-full rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted"
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
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-border"
          placeholder="Agent name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleBind()}
        />
        <button
          type="button"
          className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
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
          className="mt-2 h-9 w-full rounded-lg bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20"
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
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <input
            className="h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-border"
            placeholder="newColorToken"
            value={newName}
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
          <ColorPickerPopover color={newColor} onChange={setNewColor} />
          <button
            type="button"
            className="col-span-2 h-9 rounded-lg bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20"
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
          className="h-9 w-full rounded-lg bg-muted/60 px-3 text-sm font-medium outline-none focus:bg-background focus:ring-1 focus:ring-border"
          placeholder="Font family"
          value={node.fontFamily ?? ""}
          onChange={(event) =>
            onUpdate({
              fontFamily: event.currentTarget.value,
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
          <button
            type="button"
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg bg-muted/60 text-sm font-medium",
              node.fontStyle === "italic" && "bg-background ring-1 ring-border",
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
              "flex h-9 items-center justify-center gap-2 rounded-lg bg-muted/60 text-sm font-medium",
              node.underline && "bg-background ring-1 ring-border",
            )}
            onClick={() =>
              onUpdate({ underline: !node.underline } as Partial<PenNode>)
            }
          >
            <Underline className="h-4 w-4" />
            Underline
          </button>
        </div>
      </div>
    </InspectorSection>
  );
}

function ComponentRefSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  if (node.type !== "frame" && node.type !== "ref") return null;
  const record = node as unknown as Record<string, unknown>;

  return (
    <InspectorSection
      title="组件"
      actions={<InspectorIconButton icon={Box} label="组件" disabled />}
    >
      {node.type === "frame" ? (
        <label className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-3 text-sm text-muted-foreground">
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
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-border"
          placeholder="Referenced component id"
          value={String(record.ref ?? "")}
          onChange={(event) =>
            onUpdate({ ref: event.currentTarget.value } as Partial<PenNode>)
          }
        />
      ) : null}
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
          <div className="grid grid-cols-3 overflow-hidden rounded-lg bg-muted/60 p-0.5">
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

function AppearanceSection({
  node,
  onUpdate,
}: {
  node: PenNode;
  onUpdate: (updates: Partial<PenNode>) => void;
}) {
  const cornerRadius = (node as { cornerRadius?: unknown }).cornerRadius;
  const canEditCornerRadius =
    node.type === "frame" ||
    node.type === "rectangle" ||
    node.type === "image" ||
    node.type === "polygon";

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
          <InspectorIconButton icon={Droplet} label="混合模式" disabled />
        </>
      }
    >
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
          value={
            typeof cornerRadius === "number" && canEditCornerRadius
              ? cornerRadius
              : 0
          }
          min={0}
          muted={!canEditCornerRadius}
          onChange={(nextCornerRadius) => {
            if (!canEditCornerRadius) return;
            onUpdate({ cornerRadius: nextCornerRadius } as Partial<PenNode>);
          }}
        />
      </div>
    </InspectorSection>
  );
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
  context,
  variables,
  onVariablesChange,
  onUpdate,
  onApplyImportedAutoLayout,
  onBindAgent,
}: {
  node: PenNode;
  context?: ContextSlots;
  variables?: CanvasVariableMap;
  onVariablesChange?: (variables: CanvasVariableMap) => void;
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
      className="absolute right-0 top-0 z-20 flex h-full w-[344px] flex-col border-l border-border bg-card/95 shadow-card backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-14 items-center justify-between border-b border-border px-5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          title={nodeName}
        >
          <span className="truncate text-lg font-semibold text-foreground">
            {nodeTypeLabel(node.type)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <div className="py-3">
          <label className="sr-only" htmlFor={`${node.id}-title`}>
            名称
          </label>
          <input
            id={`${node.id}-title`}
            className="h-9 w-full rounded-lg bg-muted/60 px-3 text-sm font-medium outline-none focus:bg-background focus:ring-1 focus:ring-border"
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
        {node.type === "frame" || node.type === "group" ? (
          <AutoLayoutSection node={node} onUpdate={onUpdate} />
        ) : null}
        <AppearanceSection node={node} onUpdate={onUpdate} />
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
        <ComponentRefSection node={node} onUpdate={onUpdate} />
        {node.type === "polygon" ? (
          <InspectorSection title="多边形">
            <NumberField
              label="边数"
              value={node.polygonCount ?? 3}
              min={3}
              onChange={(polygonCount) =>
                onUpdate({ polygonCount } as Partial<PenNode>)
              }
            />
          </InspectorSection>
        ) : null}
        {context ? (
          <InspectorSection title="规则">
            <textarea
              id={`${node.id}-rules`}
              className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-border"
              value={context.rules?.join("\n") ?? ""}
              onChange={(event) => {
                const lines = event.currentTarget.value
                  .split("\n")
                  .filter(Boolean);
                onUpdate({
                  contextSlots: { ...(node.contextSlots ?? {}), rules: lines },
                } as Partial<PenNode>);
              }}
            />
          </InspectorSection>
        ) : null}
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
