"use client";

import type { AgentRecipeTemplate } from "@cucumber/canvas-core";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";

type ChatRecipeTemplateChipProps = {
  template?: AgentRecipeTemplate;
  onClear: () => void;
};

export function ChatRecipeTemplateChip({
  onClear,
  template,
}: ChatRecipeTemplateChipProps) {
  if (!template) return null;
  const inputSlotPreview = formatInputSlotPreview(template.inputSlots);
  return (
    <div className="flex min-w-0 items-start gap-1 px-2 pt-1">
      <div className="min-w-0 rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-foreground">
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1 transition-colors hover:text-foreground/80"
          title={template.summary}
        >
          <span className="text-muted-foreground">Recipe</span>
          <span className="max-w-[180px] truncate">{template.title}</span>
        </button>
        {inputSlotPreview ? (
          <div
            className="mt-0.5 truncate text-muted-foreground"
            title={`需要输入：${template.inputSlots.join(" / ")}`}
          >
            需要：{inputSlotPreview}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="移除 Recipe 模板"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function formatInputSlotPreview(inputSlots: string[]): string | undefined {
  if (inputSlots.length === 0) return undefined;
  const visibleSlots = inputSlots.slice(0, 3);
  const remainingCount = inputSlots.length - visibleSlots.length;
  return `${visibleSlots.join(" / ")}${remainingCount > 0 ? ` +${remainingCount}` : ""}`;
}

type ChatRecipeTemplatePickerButtonProps = {
  onRemoveSavedTemplate?: (templateId: string) => void;
  onSelect: (templateId: string) => void;
  selectedTemplate?: AgentRecipeTemplate;
  templates: AgentRecipeTemplate[];
};

export function ChatRecipeTemplatePickerButton({
  onRemoveSavedTemplate,
  onSelect,
  selectedTemplate,
  templates,
}: ChatRecipeTemplatePickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(
    null,
  );
  const savedTemplates = templates.filter(
    (template) => template.source === "saved_execution_chain",
  );
  const builtinTemplates = templates.filter(
    (template) => template.source !== "saved_execution_chain",
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-8 items-center justify-center gap-1 rounded-full border-[0.5px] px-2 text-[11px] font-medium transition-colors ${
          selectedTemplate
            ? "border-accent bg-accent/20 text-accent-foreground"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        title="Recipe 模板"
      >
        <svg
          aria-hidden="true"
          className="h-[14px] w-[14px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 5h6" />
          <path d="M14 5h6" />
          <path d="M4 12h6" />
          <path d="M14 12h6" />
          <path d="M4 19h6" />
          <path d="M14 19h6" />
          <path d="M10 5c2 0 2 7 4 7" />
          <path d="M10 19c2 0 2-7 4-7" />
        </svg>
        <span>Recipe</span>
      </button>
      {open ? (
        <div
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 max-h-[360px] w-80 overflow-y-auto rounded-xl border border-border bg-card p-1.5 text-xs text-foreground shadow-card ring-1 ring-foreground/5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <RecipeTemplateGroup
            expandedTemplateId={expandedTemplateId}
            label="已保存"
            onRemoveSavedTemplate={onRemoveSavedTemplate}
            onSelect={(templateId) => {
              onSelect(templateId);
              setOpen(false);
            }}
            onToggleExpanded={(templateId) =>
              setExpandedTemplateId((current) =>
                current === templateId ? null : templateId,
              )
            }
            selectedTemplate={selectedTemplate}
            templates={savedTemplates}
          />
          <RecipeTemplateGroup
            expandedTemplateId={expandedTemplateId}
            label="内置"
            onSelect={(templateId) => {
              onSelect(templateId);
              setOpen(false);
            }}
            onToggleExpanded={(templateId) =>
              setExpandedTemplateId((current) =>
                current === templateId ? null : templateId,
              )
            }
            selectedTemplate={selectedTemplate}
            templates={builtinTemplates}
          />
        </div>
      ) : null}
    </div>
  );
}

function RecipeTemplateGroup({
  expandedTemplateId,
  label,
  onRemoveSavedTemplate,
  onSelect,
  onToggleExpanded,
  selectedTemplate,
  templates,
}: {
  expandedTemplateId: string | null;
  label: string;
  onRemoveSavedTemplate?: (templateId: string) => void;
  onSelect: (templateId: string) => void;
  onToggleExpanded: (templateId: string) => void;
  selectedTemplate?: AgentRecipeTemplate;
  templates: AgentRecipeTemplate[];
}) {
  if (templates.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
        {label} · {templates.length}
      </div>
      {templates.map((template) => (
        <RecipeTemplateMenuItem
          key={template.id}
          expanded={expandedTemplateId === template.id}
          onRemoveSavedTemplate={onRemoveSavedTemplate}
          onSelect={() => onSelect(template.id)}
          onToggleExpanded={() => onToggleExpanded(template.id)}
          selected={selectedTemplate?.id === template.id}
          template={template}
        />
      ))}
    </div>
  );
}

function RecipeTemplateMenuItem({
  expanded,
  onRemoveSavedTemplate,
  onSelect,
  onToggleExpanded,
  selected,
  template,
}: {
  expanded: boolean;
  onRemoveSavedTemplate?: (templateId: string) => void;
  onSelect: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
  template: AgentRecipeTemplate;
}) {
  const isSaved = template.source === "saved_execution_chain";
  const sourceNodeCount = template.savedSourceNodeIds?.length ?? 0;
  return (
    <div
      className={`rounded-lg px-1 py-1 transition-colors ${
        selected ? "bg-accent/15" : "hover:bg-muted"
      }`}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-label={`使用 Recipe 模板：${template.title}`}
          onClick={onSelect}
          className="min-w-0 flex-1 px-1 py-1 text-left"
          title={template.summary}
        >
          <span className="block truncate font-medium">{template.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {isSaved ? `已保存 · ${template.summary}` : template.summary}
          </span>
          {isSaved ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {sourceNodeCount > 0
                ? `${sourceNodeCount} 个来源节点`
                : "本地保存模板"}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          aria-label={
            expanded
              ? `收起模板结构：${template.title}`
              : `预览模板结构：${template.title}`
          }
          onClick={onToggleExpanded}
          className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          title={expanded ? "收起模板结构" : "预览模板结构"}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        {isSaved && onRemoveSavedTemplate ? (
          <button
            type="button"
            aria-label={`删除保存模板：${template.title}`}
            onClick={() => onRemoveSavedTemplate(template.id)}
            className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title={`删除保存模板：${template.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-1 space-y-1 rounded-md bg-background/70 px-2 py-2 text-[11px] leading-4 text-muted-foreground">
          <TemplatePreviewLine
            label="启动"
            values={[getTemplateStartupPreview(template)]}
          />
          <TemplatePreviewLine label="结构" values={template.nodeStructure} />
          <TemplatePreviewLine label="工具" values={template.toolSequence} />
          <TemplatePreviewLine label="输入" values={template.inputSlots} />
          <TemplatePreviewLine
            label="验证"
            separator=" | "
            values={template.validationRules}
          />
          <TemplatePreviewLine
            label="交付"
            values={[template.deliverableFormat]}
          />
          {template.savedSourceNodeIds?.length ? (
            <TemplatePreviewLine
              label="来源"
              values={template.savedSourceNodeIds}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getTemplateStartupPreview(template: AgentRecipeTemplate): string {
  if (template.source === "saved_execution_chain") {
    return "从保存模板启动新的执行链，不修改来源节点";
  }
  return "从内置 Recipe 启动新的执行链";
}

function TemplatePreviewLine({
  label,
  separator = " -> ",
  values,
}: {
  label: string;
  separator?: string;
  values: string[];
}) {
  if (values.length === 0) return null;
  return (
    <div>
      <span className="font-medium text-foreground/75">{label}</span>
      <span className="ml-1 break-words">{values.join(separator)}</span>
    </div>
  );
}
