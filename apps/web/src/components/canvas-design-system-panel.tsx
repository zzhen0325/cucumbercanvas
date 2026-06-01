"use client";

import {
  Component,
  Palette,
  Plus,
  Search,
  Shapes,
  Trash2,
  Variable,
  X,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type CucumberCanvasDocument,
  type IconFontNode,
  type PenNode,
  type RefNode,
  createNodeId,
  findNode,
  flattenNodes,
  getNodeBounds,
} from "@cucumber/canvas-core";
import type { PenFill, VariableDefinition } from "@cucumber/pen-types";

import type { CanvasApi } from "./canvas/canvas-api";
import {
  CANVAS_ICON_LIBRARY,
  type CanvasIconEntry,
} from "./canvas/icon-library";

export type DesignSystemTab = "components" | "variables" | "icons";
type VariableType = VariableDefinition["type"];
type SizedRefNode = RefNode & { width?: number; height?: number };

export type CanvasDesignSystemPanelProps = {
  canvasApi: CanvasApi | null;
  initialTab?: DesignSystemTab;
  open: boolean;
  onClose: () => void;
};

type CanvasSnapshot = {
  doc: CucumberCanvasDocument | null;
  nodes: PenNode[];
  selectedIds: string[];
};

const tabs: Array<{
  id: DesignSystemTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "components", label: "组件", icon: Component },
  { id: "variables", label: "变量", icon: Variable },
  { id: "icons", label: "图标", icon: Shapes },
];

const inputClass =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground";
const selectClass =
  "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-foreground";
const smallButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45";
const primaryButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-45";

function refreshSnapshot(canvasApi: CanvasApi | null): CanvasSnapshot {
  if (!canvasApi) return { doc: null, nodes: [], selectedIds: [] };
  const doc = canvasApi.getDocument();
  const activePageId = canvasApi.getActivePageId();
  const appState = canvasApi.getAppState();
  return {
    doc,
    nodes: flattenNodes(doc, activePageId),
    selectedIds: Object.entries(appState.selectedElementIds)
      .filter(([, selected]) => selected)
      .map(([id]) => id),
  };
}

function nodeLabel(node: PenNode): string {
  return node.name?.trim() || `${node.type} ${node.id.slice(-4)}`;
}

function componentSizeLabel(node: PenNode): string {
  const bounds = getNodeBounds(node);
  return `${Math.round(bounds.width)} x ${Math.round(bounds.height)}`;
}

function solidFill(color: string): PenFill[] {
  return [{ type: "solid", color }];
}

function nodeSupportsFill(node: PenNode): boolean {
  return [
    "frame",
    "group",
    "rectangle",
    "ellipse",
    "polygon",
    "path",
    "icon_font",
  ].includes(node.type);
}

function usesVariableInNode(node: PenNode, variableName: string): boolean {
  return JSON.stringify(node).includes(`"$${variableName}"`);
}

function allDocumentNodes(doc: CucumberCanvasDocument): PenNode[] {
  const result: PenNode[] = [];
  const walk = (nodes: PenNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if ("children" in node && Array.isArray(node.children)) {
        walk(node.children as PenNode[]);
      }
    }
  };
  walk(doc.children);
  for (const page of doc.pages ?? []) walk(page.children);
  return result;
}

function parseVariableValue(
  type: VariableType,
  raw: string,
): string | number | boolean {
  const value = raw.trim();
  if (type === "boolean") return value === "true";
  if (type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error("数字变量需要输入有效数字。");
    }
    return numeric;
  }
  return value;
}

function variableValueToInputValue(variable: VariableDefinition): string {
  if (Array.isArray(variable.value)) return "[themed values]";
  return String(variable.value);
}

function normalizeVariableName(raw: string): string {
  return raw.trim().replace(/^\$/, "");
}

function isVariableNameValid(name: string): boolean {
  return /^[A-Za-z][\w.-]*$/.test(name);
}

function panelLog(event: string, data: Record<string, unknown>) {
  console.info(`[canvas-design-system] ${event}`, data);
}

function IconPreview({
  icon,
  className,
}: {
  icon: CanvasIconEntry;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      aria-hidden
    >
      <title>{icon.label}</title>
      <path d={icon.d} />
    </svg>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
      {children}
    </div>
  );
}

export function CanvasDesignSystemPanel({
  canvasApi,
  initialTab,
  open,
  onClose,
}: CanvasDesignSystemPanelProps) {
  const [activeTab, setActiveTab] = useState<DesignSystemTab>("components");
  const [snapshot, setSnapshot] = useState<CanvasSnapshot>(() =>
    refreshSnapshot(canvasApi),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [variableName, setVariableName] = useState("");
  const [variableType, setVariableType] = useState<VariableType>("color");
  const [variableValue, setVariableValue] = useState("#111827");
  const [themeAxis, setThemeAxis] = useState("mode");
  const [themeValues, setThemeValues] = useState("light,dark");
  const [iconQuery, setIconQuery] = useState("");
  const iconSearchRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setSnapshot(refreshSnapshot(canvasApi));
  }, [canvasApi]);

  useEffect(() => {
    if (!open || !canvasApi) return;
    if (activeTab === "icons") return;
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 150);
    };
    const unsubscribe = canvasApi.onChange(scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [open, activeTab, canvasApi, refresh]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab ?? "components");
    setMessage(null);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || activeTab !== "icons") return;
    iconSearchRef.current?.focus();
  }, [open, activeTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const doc = snapshot.doc;
  const variables = doc?.variables ?? {};
  const themes = doc?.themes ?? {};
  const selectedNode = doc
    ? findNode(doc, snapshot.selectedIds[0] ?? "", canvasApi?.getActivePageId())
    : undefined;
  const reusableComponents = useMemo(
    () =>
      snapshot.nodes.filter(
        (node): node is PenNode & { type: "frame"; reusable: true } =>
          node.type === "frame" && node.reusable === true,
      ),
    [snapshot.nodes],
  );
  const refInstances = useMemo(
    () => snapshot.nodes.filter((node): node is RefNode => node.type === "ref"),
    [snapshot.nodes],
  );
  const selectedFrame =
    selectedNode?.type === "frame" ? selectedNode : undefined;

  const filteredIcons = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return CANVAS_ICON_LIBRARY;
    return CANVAS_ICON_LIBRARY.filter((icon) =>
      [icon.name, icon.label, ...icon.tags].some((token) =>
        token.toLowerCase().includes(query),
      ),
    );
  }, [iconQuery]);

  const replaceDocument = useCallback(
    (
      next: CucumberCanvasDocument,
      event: string,
      data: Record<string, unknown>,
    ) => {
      if (!canvasApi) return;
      canvasApi.setDocument(next);
      panelLog(event, data);
      refresh();
    },
    [canvasApi, refresh],
  );

  const handleMakeComponent = useCallback(() => {
    if (!canvasApi || !selectedFrame) {
      setMessage("请选择一个 Frame 后再创建组件。");
      return;
    }
    canvasApi.updateNode(selectedFrame.id, {
      reusable: true,
    } as Partial<PenNode>);
    canvasApi.setSelection([selectedFrame.id]);
    panelLog("component.reusable.enabled", {
      componentId: selectedFrame.id,
      activePageId: canvasApi.getActivePageId(),
    });
    setMessage(`${nodeLabel(selectedFrame)} 已标记为可复用组件。`);
    refresh();
  }, [canvasApi, selectedFrame, refresh]);

  const handleUnsetComponent = useCallback(
    (componentId: string) => {
      if (!canvasApi) return;
      if (refInstances.some((instance) => instance.ref === componentId)) {
        setMessage("该组件仍有页面实例，请先删除或重定向实例后再取消复用。");
        return;
      }
      canvasApi.updateNode(componentId, {
        reusable: false,
      } as Partial<PenNode>);
      panelLog("component.reusable.disabled", {
        componentId,
        activePageId: canvasApi.getActivePageId(),
      });
      refresh();
    },
    [canvasApi, refInstances, refresh],
  );

  const handleInsertInstance = useCallback(
    (componentNode: PenNode) => {
      if (!canvasApi) return;
      const viewport = canvasApi.getViewportBounds();
      const bounds = getNodeBounds(componentNode);
      const refNode: SizedRefNode = {
        id: createNodeId("ref"),
        type: "ref",
        name: `${nodeLabel(componentNode)} instance`,
        ref: componentNode.id,
        x: Math.round(viewport.x + 96),
        y: Math.round(viewport.y + 96),
        width: bounds.width,
        height: bounds.height,
      };
      canvasApi.insertNode(refNode as PenNode);
      canvasApi.setSelection([refNode.id]);
      panelLog("component.instance.inserted", {
        componentId: componentNode.id,
        instanceId: refNode.id,
        activePageId: canvasApi.getActivePageId(),
      });
      refresh();
    },
    [canvasApi, refresh],
  );

  const handleCreateVariable = useCallback(() => {
    if (!doc) return;
    const name = normalizeVariableName(variableName);
    if (!isVariableNameValid(name)) {
      setMessage(
        "变量名需要以英文字母开头，只包含字母、数字、下划线、点或连字符。",
      );
      return;
    }
    if (variables[name]) {
      setMessage(`变量 ${name} 已存在。`);
      return;
    }
    try {
      const nextVariables = {
        ...variables,
        [name]: {
          type: variableType,
          value: parseVariableValue(variableType, variableValue),
        },
      };
      replaceDocument(
        { ...doc, variables: nextVariables },
        "variable.created",
        { name, type: variableType },
      );
      setVariableName("");
      setMessage(`变量 ${name} 已创建。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "变量创建失败。");
    }
  }, [
    doc,
    replaceDocument,
    variableName,
    variableType,
    variableValue,
    variables,
  ]);

  const handleUpdateVariableValue = useCallback(
    (name: string, variable: VariableDefinition, rawValue: string) => {
      if (!doc) return;
      try {
        const nextVariables = {
          ...variables,
          [name]: {
            ...variable,
            value: parseVariableValue(variable.type, rawValue),
          },
        };
        replaceDocument(
          { ...doc, variables: nextVariables },
          "variable.updated",
          { name, type: variable.type },
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "变量更新失败。");
      }
    },
    [doc, replaceDocument, variables],
  );

  const handleDeleteVariable = useCallback(
    (name: string) => {
      if (!doc) return;
      const used = allDocumentNodes(doc).some((node) =>
        usesVariableInNode(node, name),
      );
      if (used) {
        setMessage(`变量 ${name} 仍被画布节点引用，请先解绑后再删除。`);
        return;
      }
      const nextVariables = { ...variables };
      delete nextVariables[name];
      replaceDocument(
        { ...doc, variables: nextVariables },
        "variable.deleted",
        { name },
      );
      setMessage(`变量 ${name} 已删除。`);
    },
    [doc, replaceDocument, variables],
  );

  const handleBindFillVariable = useCallback(
    (name: string) => {
      if (!canvasApi || !selectedNode) {
        setMessage("请选择一个支持填充的节点后再绑定变量。");
        return;
      }
      if (!nodeSupportsFill(selectedNode)) {
        setMessage("当前选中节点不支持填充变量。");
        return;
      }
      canvasApi.updateNode(selectedNode.id, {
        fill: solidFill(`$${name}`),
      } as Partial<PenNode>);
      panelLog("variable.bound.fill", {
        variableName: name,
        nodeId: selectedNode.id,
      });
      setMessage(`${nodeLabel(selectedNode)} 已绑定 $${name}。`);
      refresh();
    },
    [canvasApi, selectedNode, refresh],
  );

  const handleUpsertThemeAxis = useCallback(() => {
    if (!doc) return;
    const axis = normalizeVariableName(themeAxis);
    const values = themeValues
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!isVariableNameValid(axis) || values.length === 0) {
      setMessage("主题轴需要有效名称，并至少包含一个逗号分隔的取值。");
      return;
    }
    replaceDocument(
      { ...doc, themes: { ...themes, [axis]: values } },
      "theme.axis.upserted",
      { axis, values },
    );
    setMessage(`主题轴 ${axis} 已更新。`);
  }, [doc, replaceDocument, themeAxis, themeValues, themes]);

  const handleRemoveThemeAxis = useCallback(
    (axis: string) => {
      if (!doc) return;
      const nextThemes = { ...themes };
      delete nextThemes[axis];
      replaceDocument({ ...doc, themes: nextThemes }, "theme.axis.deleted", {
        axis,
      });
      setMessage(`主题轴 ${axis} 已删除。`);
    },
    [doc, replaceDocument, themes],
  );

  const handleInsertIcon = useCallback(
    (icon: CanvasIconEntry) => {
      if (!canvasApi) return;
      const viewport = canvasApi.getViewportBounds();
      const iconNode: IconFontNode = {
        id: createNodeId("icon"),
        type: "icon_font",
        name: `${icon.label} Icon`,
        iconFontName: icon.name,
        iconFontFamily: "lucide",
        x: Math.round(viewport.x + 120),
        y: Math.round(viewport.y + 120),
        width: 48,
        height: 48,
        fill: solidFill("#111827"),
      };
      canvasApi.insertNode(iconNode);
      canvasApi.setSelection([iconNode.id]);
      panelLog("icon.inserted", {
        iconName: icon.name,
        nodeId: iconNode.id,
        activePageId: canvasApi.getActivePageId(),
      });
      refresh();
    },
    [canvasApi, refresh],
  );

  if (!open) return null;

  return (
    <aside
      className="fixed left-0 top-0 z-30 flex h-full w-[320px] flex-col border-r border-border bg-card animate-in slide-in-from-left duration-200"
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex h-[50px] shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <span className="text-base font-medium text-foreground">
            设计系统
          </span>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close design system panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-y border-border px-2 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs transition-colors ${
                activeTab === tab.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setMessage(null);
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {message ? (
        <div className="border-b border-border px-4 py-2 text-xs leading-5 text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {activeTab === "components" ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-foreground">
                  当前选择
                </h2>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={!selectedFrame}
                  onClick={handleMakeComponent}
                >
                  <Plus className="h-3.5 w-3.5" />
                  创建组件
                </button>
              </div>
              {selectedFrame ? (
                <div className="rounded-lg border border-border px-3 py-2 text-xs">
                  <div className="font-medium text-foreground">
                    {nodeLabel(selectedFrame)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {componentSizeLabel(selectedFrame)}
                  </div>
                </div>
              ) : (
                <EmptyState>选择一个 Frame，可将它提升为复用组件。</EmptyState>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-foreground">组件库</h2>
              {reusableComponents.length === 0 ? (
                <EmptyState>还没有可复用组件。</EmptyState>
              ) : (
                <div className="space-y-2">
                  {reusableComponents.map((componentNode) => (
                    <div
                      key={componentNode.id}
                      className="rounded-lg border border-border px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-foreground">
                            {nodeLabel(componentNode)}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {componentSizeLabel(componentNode)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => handleUnsetComponent(componentNode.id)}
                          aria-label={`Remove ${nodeLabel(componentNode)} from components`}
                          title="取消复用"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`${smallButtonClass} mt-2 w-full`}
                        onClick={() => handleInsertInstance(componentNode)}
                      >
                        插入实例
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-foreground">页面实例</h2>
              {refInstances.length === 0 ? (
                <EmptyState>当前页面还没有组件实例。</EmptyState>
              ) : (
                <div className="space-y-1">
                  {refInstances.map((instance) => (
                    <button
                      key={instance.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-muted"
                      onClick={() => canvasApi?.setSelection([instance.id])}
                    >
                      <span className="truncate text-foreground">
                        {nodeLabel(instance)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {instance.ref}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "variables" ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <h2 className="text-xs font-medium text-foreground">新建变量</h2>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className={inputClass}
                  value={variableName}
                  onChange={(event) => setVariableName(event.target.value)}
                  placeholder="brand.primary"
                />
                <select
                  className={selectClass}
                  value={variableType}
                  onChange={(event) => {
                    const nextType = event.target.value as VariableType;
                    setVariableType(nextType);
                    setVariableValue(
                      nextType === "boolean"
                        ? "true"
                        : nextType === "number"
                          ? "8"
                          : nextType === "color"
                            ? "#111827"
                            : "Label",
                    );
                  }}
                  aria-label="Variable type"
                >
                  <option value="color">color</option>
                  <option value="number">number</option>
                  <option value="string">string</option>
                  <option value="boolean">boolean</option>
                </select>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                {variableType === "boolean" ? (
                  <select
                    className={selectClass}
                    value={variableValue}
                    onChange={(event) => setVariableValue(event.target.value)}
                    aria-label="Variable value"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className={inputClass}
                    value={variableValue}
                    onChange={(event) => setVariableValue(event.target.value)}
                    placeholder="#111827"
                  />
                )}
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={handleCreateVariable}
                >
                  创建
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-foreground">变量</h2>
              {Object.keys(variables).length === 0 ? (
                <EmptyState>还没有变量。</EmptyState>
              ) : (
                <div className="space-y-2">
                  {Object.entries(variables).map(([name, variable]) => (
                    <div
                      key={name}
                      className="rounded-lg border border-border px-3 py-2"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-foreground">
                            ${name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {variable.type}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => handleDeleteVariable(name)}
                          aria-label={`Delete variable ${name}`}
                          title="删除变量"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        {variable.type === "boolean" ? (
                          <select
                            className={selectClass}
                            defaultValue={variableValueToInputValue(variable)}
                            onBlur={(event) =>
                              handleUpdateVariableValue(
                                name,
                                variable,
                                event.currentTarget.value,
                              )
                            }
                            aria-label={`Value for ${name}`}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            className={inputClass}
                            defaultValue={variableValueToInputValue(variable)}
                            disabled={Array.isArray(variable.value)}
                            onBlur={(event) =>
                              handleUpdateVariableValue(
                                name,
                                variable,
                                event.currentTarget.value,
                              )
                            }
                            aria-label={`Value for ${name}`}
                          />
                        )}
                        {variable.type === "color" ? (
                          <button
                            type="button"
                            className={smallButtonClass}
                            onClick={() => handleBindFillVariable(name)}
                            aria-label={`Bind ${name} fill variable`}
                          >
                            绑定填充
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-foreground">主题轴</h2>
              <div className="grid grid-cols-[0.8fr_1fr] gap-2">
                <input
                  className={inputClass}
                  value={themeAxis}
                  onChange={(event) => setThemeAxis(event.target.value)}
                  placeholder="mode"
                />
                <input
                  className={inputClass}
                  value={themeValues}
                  onChange={(event) => setThemeValues(event.target.value)}
                  placeholder="light,dark"
                />
              </div>
              <button
                type="button"
                className={`${smallButtonClass} w-full`}
                onClick={handleUpsertThemeAxis}
              >
                更新主题轴
              </button>
              {Object.keys(themes).length === 0 ? (
                <EmptyState>还没有主题轴。</EmptyState>
              ) : (
                <div className="space-y-1">
                  {Object.entries(themes).map(([axis, values]) => (
                    <div
                      key={axis}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">
                          {axis}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {values.join(", ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => handleRemoveThemeAxis(axis)}
                        aria-label={`Delete theme axis ${axis}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "icons" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={iconSearchRef}
                className={`${inputClass} pl-7`}
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                placeholder="搜索图标"
                aria-label="Search icons"
              />
            </div>
            {filteredIcons.length === 0 ? (
              <EmptyState>没有匹配的图标。</EmptyState>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {filteredIcons.map((icon) => (
                  <button
                    key={icon.name}
                    type="button"
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => handleInsertIcon(icon)}
                    title={icon.label}
                    aria-label={`Insert ${icon.label} icon`}
                  >
                    <IconPreview icon={icon} className="h-5 w-5" />
                    <span className="max-w-full truncate px-1 text-[10px]">
                      {icon.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
