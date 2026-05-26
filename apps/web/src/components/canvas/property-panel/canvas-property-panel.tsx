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
import { Lock, Unlock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

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

function isPaintNode(node: PenNode): boolean {
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

function getNodeFill(node: PenNode): CanvasFill[] | undefined {
  return (node as NodeWithOptionalPaint).fill;
}

function getNodeStroke(node: PenNode): CanvasStroke | undefined {
  return (node as NodeWithOptionalPaint).stroke;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// ─── NumberField ─────────────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
      <span className="w-8 shrink-0">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-sm text-foreground outline-none"
        type="number"
        min={min}
        step={step ?? 1}
        value={Math.round(value * 100) / 100}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

// ─── ColorSwatch ─────────────────────────────────────────────────────────────

function ColorSwatch({
  color,
  onClick,
}: {
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="h-7 w-7 rounded-md border border-border shadow-sm shrink-0 cursor-pointer"
      style={{ backgroundColor: color }}
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
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="relative">
      <ColorSwatch color={color} onClick={() => setOpen(!open)} />
      {open ? (
        <div className="absolute left-0 top-9 z-50 rounded-lg border border-border bg-card p-2 shadow-card">
          <HexColorPicker color={color} onChange={onChange} />
        </div>
      ) : null}
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

  const handleColorChange = useCallback(
    (newColor: string) => {
      onUpdate({
        fill: [{ type: "solid", color: newColor }],
      } as Partial<PenNode>);
    },
    [onUpdate],
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-8">填充</span>
        <ColorPickerPopover color={color} onChange={handleColorChange} />
        <span className="text-xs text-muted-foreground truncate flex-1">
          {color}
        </span>
        {fillType !== "solid" ? (
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            {fillType}
          </span>
        ) : null}
      </div>
    </div>
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

  const handleColorChange = useCallback(
    (newColor: string) => {
      const newStroke: CanvasStroke = {
        ...(stroke ?? { thickness: 1 }),
        fill: [{ type: "solid", color: newColor }],
      };
      onUpdate({ stroke: newStroke } as Partial<PenNode>);
    },
    [onUpdate, stroke],
  );

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const newStroke: CanvasStroke = {
        ...(stroke ?? { thickness: 1, fill: [{ type: "solid", color }] }),
        thickness: newWidth,
      };
      onUpdate({ stroke: newStroke } as Partial<PenNode>);
    },
    [onUpdate, stroke, color],
  );

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground block">描边</span>
      <div className="flex items-center gap-2">
        <ColorPickerPopover color={color} onChange={handleColorChange} />
        <NumberField
          label="W"
          value={width}
          min={0}
          step={0.5}
          onChange={handleWidthChange}
        />
      </div>
    </div>
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
    <div className="space-y-2">
      <textarea
        className="h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={String(node.content ?? "")}
        onChange={(event) =>
          onUpdate({ content: event.currentTarget.value } as Partial<PenNode>)
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="字号"
          value={node.fontSize ?? 16}
          min={1}
          onChange={(fontSize) => onUpdate({ fontSize } as Partial<PenNode>)}
        />
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 h-8">
          <span className="w-8 text-xs text-muted-foreground shrink-0">
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

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
      <span className="text-xs font-medium">效果</span>
      {/* Shadow toggle + controls */}
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={!!shadow}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              const newEffects: PenEffect[] = effects.filter(
                (ef) => ef.type !== "shadow",
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
            } else {
              onUpdate({
                effects: effects.filter((ef) => ef.type !== "shadow"),
              } as Partial<PenNode>);
            }
          }}
        />
        阴影
      </label>
      {shadow ? (
        <div className="grid grid-cols-3 gap-1.5 pl-4">
          <NumberField
            label="X"
            value={shadow.offsetX ?? 0}
            onChange={(offsetX) => {
              const updated = effects.map((e) =>
                e.type === "shadow" ? { ...e, offsetX } : e,
              );
              onUpdate({ effects: updated } as Partial<PenNode>);
            }}
          />
          <NumberField
            label="Y"
            value={shadow.offsetY ?? 0}
            onChange={(offsetY) => {
              const updated = effects.map((e) =>
                e.type === "shadow" ? { ...e, offsetY } : e,
              );
              onUpdate({ effects: updated } as Partial<PenNode>);
            }}
          />
          <NumberField
            label="模糊"
            value={shadow.blur ?? 0}
            min={0}
            onChange={(blur) => {
              const updated = effects.map((e) =>
                e.type === "shadow" ? { ...e, blur } : e,
              );
              onUpdate({ effects: updated } as Partial<PenNode>);
            }}
          />
        </div>
      ) : null}
      {/* Blur toggle */}
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={!!blurFx}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              const newEffects: PenEffect[] = effects.filter(
                (ef) => ef.type !== "blur",
              );
              newEffects.push({ type: "blur", radius: 4 });
              onUpdate({ effects: newEffects } as Partial<PenNode>);
            } else {
              onUpdate({
                effects: effects.filter((ef) => ef.type !== "blur"),
              } as Partial<PenNode>);
            }
          }}
        />
        模糊
      </label>
      {blurFx ? (
        <div className="pl-4">
          <NumberField
            label="半径"
            value={blurFx.radius ?? 4}
            min={0}
            step={0.5}
            onChange={(radius) => {
              const updated = effects.map((e) =>
                e.type === "blur" ? { ...e, radius } : e,
              );
              onUpdate({ effects: updated } as Partial<PenNode>);
            }}
          />
        </div>
      ) : null}
    </div>
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

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
      <span className="text-xs font-medium">Auto Layout</span>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={hasLayout}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              onUpdate({
                layout: "vertical",
                gap: 8,
                padding: 12,
                justifyContent: "start",
                alignItems: "start",
              } as Partial<PenNode>);
            } else {
              onUpdate({
                layout: null,
                gap: null,
                padding: null,
                justifyContent: null,
                alignItems: null,
              } as ClearLayoutUpdate);
            }
          }}
        />
        启用 Auto Layout
      </label>
      {hasLayout ? (
        <div className="space-y-1.5 pl-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-6">方向</span>
            <select
              className="h-7 flex-1 rounded border border-border bg-background text-xs px-1"
              value={n.layout ?? "vertical"}
              onChange={(e) =>
                onUpdate({ layout: e.target.value } as Partial<PenNode>)
              }
            >
              <option value="vertical">垂直</option>
              <option value="horizontal">水平</option>
            </select>
          </div>
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
            onChange={(padding) => onUpdate({ padding } as Partial<PenNode>)}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-6">主轴</span>
            <select
              className="h-7 flex-1 rounded border border-border bg-background text-xs px-1"
              value={n.justifyContent ?? "start"}
              onChange={(e) =>
                onUpdate({ justifyContent: e.target.value } as Partial<PenNode>)
              }
            >
              <option value="start">Start</option>
              <option value="center">Center</option>
              <option value="end">End</option>
              <option value="space_between">Space Between</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-6">交叉</span>
            <select
              className="h-7 flex-1 rounded border border-border bg-background text-xs px-1"
              value={n.alignItems ?? "start"}
              onChange={(e) =>
                onUpdate({ alignItems: e.target.value } as Partial<PenNode>)
              }
            >
              <option value="start">Start</option>
              <option value="center">Center</option>
              <option value="end">End</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
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
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground block">Agent 绑定</span>
      <div className="flex items-center gap-2">
        <input
          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Agent name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleBind()}
        />
        <button
          type="button"
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
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
    </div>
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
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
      <span className="text-xs font-medium">导入的 Auto Layout</span>
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
          className="mt-1 h-7 w-full rounded bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20"
          onClick={onApply}
        >
          应用到子节点
        </button>
      ) : null}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function CanvasPropertyPanel({
  node,
  context,
  onUpdate,
  onApplyImportedAutoLayout,
  onBindAgent,
}: {
  node: PenNode;
  context?: ContextSlots;
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

  const supportsPaint = isPaintNode(node);

  return (
    <div
      className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-card backdrop-blur flex flex-col gap-3 max-h-[calc(100vh-120px)] overflow-y-auto"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">属性</span>
        {node.locked ? (
          <Lock className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Unlock className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Title */}
      <label
        className="block text-xs text-muted-foreground"
        htmlFor={`${node.id}-title`}
      >
        名称
      </label>
      <input
        id={`${node.id}-title`}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={node.name ?? ""}
        onChange={(event) => onUpdate({ name: event.currentTarget.value })}
      />

      {/* Position / Size */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={bounds.x}
          onChange={(x) => updateBounds({ x })}
        />
        <NumberField
          label="Y"
          value={bounds.y}
          onChange={(y) => updateBounds({ y })}
        />
        <NumberField
          label="W"
          min={1}
          value={bounds.width}
          onChange={(width) => updateBounds({ width })}
        />
        <NumberField
          label="H"
          min={1}
          value={bounds.height}
          onChange={(height) => updateBounds({ height })}
        />
        <NumberField
          label="R"
          value={bounds.rotation ?? 0}
          onChange={(rotation) => updateBounds({ rotation })}
        />
        {/* Opacity */}
        <NumberField
          label="不透明"
          value={Number(node.opacity ?? 1)}
          min={0}
          step={0.05}
          onChange={(opacity) =>
            onUpdate({ opacity: Math.min(1, Math.max(0, opacity)) })
          }
        />
      </div>

      {/* Visibility & Lock */}
      <div className="flex items-center gap-3">
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={node.visible !== false}
            onChange={(event) =>
              onUpdate({
                visible: event.currentTarget.checked,
              } as Partial<PenNode>)
            }
          />
          显示
        </label>
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={node.locked === true}
            onChange={(event) =>
              onUpdate({
                locked: event.currentTarget.checked,
              } as Partial<PenNode>)
            }
          />
          锁定
        </label>
        {/* Flip buttons */}
        <button
          type="button"
          className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs transition-colors ${
            node.flipX
              ? "bg-primary/20 border-primary text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => onUpdate({ flipX: !node.flipX } as Partial<PenNode>)}
          title="水平翻转"
        >
          ↔
        </button>
        <button
          type="button"
          className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs transition-colors ${
            node.flipY
              ? "bg-primary/20 border-primary text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => onUpdate({ flipY: !node.flipY } as Partial<PenNode>)}
          title="垂直翻转"
        >
          ↕
        </button>
      </div>

      {/* Effects (shadow / blur) */}
      <EffectsSection node={node} onUpdate={onUpdate} />

      {/* Fill & Stroke (paint nodes) */}
      {supportsPaint ? (
        <>
          <FillSection fills={getNodeFill(node)} onUpdate={onUpdate} />
          <StrokeSection stroke={getNodeStroke(node)} onUpdate={onUpdate} />
          {node.type === "rectangle" ? (
            <NumberField
              label="圆角"
              value={
                typeof node.cornerRadius === "number" ? node.cornerRadius : 0
              }
              min={0}
              onChange={(cornerRadius) =>
                onUpdate({ cornerRadius } as Partial<PenNode>)
              }
            />
          ) : null}
        </>
      ) : null}

      {/* Container fill/stroke (containers have fills/stroke too) */}
      {node.type === "frame" ? (
        <>
          <FillSection fills={node.fill} onUpdate={onUpdate} />
          <StrokeSection
            stroke={node.stroke as CanvasStroke | undefined}
            onUpdate={onUpdate}
          />
        </>
      ) : null}

      {/* Text content */}
      {node.type === "text" ? (
        <TextSection node={node} onUpdate={onUpdate} />
      ) : null}

      {/* Polygon points */}
      {node.type === "polygon" ? (
        <NumberField
          label="边数"
          value={node.polygonCount ?? 3}
          min={3}
          onChange={(polygonCount) =>
            onUpdate({ polygonCount } as Partial<PenNode>)
          }
        />
      ) : null}

      {/* Context rules */}
      {context ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
          <label
            className="block text-xs text-muted-foreground"
            htmlFor={`${node.id}-rules`}
          >
            规则 (每行一条)
          </label>
          <textarea
            id={`${node.id}-rules`}
            className="h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
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
        </div>
      ) : null}

      {/* Agent binding (containers only) */}
      {node.type === "frame" ? (
        <AgentBindingSection node={node} onBindAgent={onBindAgent} />
      ) : null}

      {/* Auto Layout (containers only) */}
      {node.type === "frame" || node.type === "group" ? (
        <AutoLayoutSection node={node} onUpdate={onUpdate} />
      ) : null}

      {/* Imported auto layout */}
      {onApplyImportedAutoLayout ? (
        <ImportedAutoLayoutSection
          node={node}
          onApply={onApplyImportedAutoLayout}
        />
      ) : null}
    </div>
  );
}
