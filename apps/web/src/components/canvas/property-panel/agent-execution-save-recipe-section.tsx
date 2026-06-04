"use client";

import {
  type AgentRecipeTemplate,
  canSaveAgentExecutionNodeAsRecipeTemplate,
  createAgentRecipeTemplateFromExecutionNode,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { BookmarkPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { saveCustomAgentRecipeTemplate } from "../../use-agent-recipe-templates";
import { AgentExecutionActionButton } from "./agent-execution-action-button";

type AgentExecutionSaveRecipeSectionProps = {
  node: PenNode;
  pageNodes?: PenNode[];
};

export function AgentExecutionSaveRecipeSection({
  node,
  pageNodes,
}: AgentExecutionSaveRecipeSectionProps) {
  const execution = getAgentExecutionMeta(node);
  const saveState = useMemo(
    () => canSaveAgentExecutionNodeAsRecipeTemplate(node),
    [node],
  );
  const [title, setTitle] = useState(() =>
    execution ? `保存的 Recipe：${execution.title}` : "保存的 Recipe",
  );
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const templatePreview = useMemo(
    () =>
      createAgentRecipeTemplateFromExecutionNode(node, {
        relatedNodes: pageNodes,
        title,
      }),
    [node, pageNodes, title],
  );

  if (!execution) return null;

  const disabled = !saveState.canSave || title.trim().length === 0;
  const reason =
    saveState.reason ??
    (title.trim().length === 0 ? "请输入模板名称。" : undefined);

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="font-medium">保存为 Recipe 模板</div>
      <p className="mt-1 leading-5 text-muted-foreground">
        从当前已完成执行节点提取节点结构、工具顺序、输入槽位、验证规则和交付格式，保存到本地
        Recipe 菜单。
      </p>
      <label
        className="mt-3 block text-[11px] font-medium text-muted-foreground"
        htmlFor={`${node.id}-recipe-template-title`}
      >
        模板名称
      </label>
      <input
        id={`${node.id}-recipe-template-title`}
        className="mt-1 h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-xs text-foreground outline-none focus:border-ring focus:bg-background"
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      {reason ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{reason}</p>
      ) : null}
      <AgentRecipeTemplatePreview template={templatePreview} />
      {savedMessage ? (
        <p className="mt-2 text-[11px] text-emerald-700">{savedMessage}</p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <AgentExecutionActionButton
          disabled={disabled}
          icon={BookmarkPlus}
          label="保存模板"
          onClick={() => {
            const template = createAgentRecipeTemplateFromExecutionNode(node, {
              relatedNodes: pageNodes,
              title,
            });
            if (!template) return;
            saveCustomAgentRecipeTemplate(template);
            const sourceCount = template.savedSourceNodeIds?.length ?? 1;
            setSavedMessage(
              sourceCount > 1
                ? `已保存 ${sourceCount} 个执行节点到 Recipe 菜单。`
                : "已保存到 Recipe 菜单。",
            );
            window.setTimeout(() => setSavedMessage(null), 1600);
          }}
          reason={reason}
        />
      </div>
    </div>
  );
}

function AgentRecipeTemplatePreview({
  template,
}: {
  template?: AgentRecipeTemplate;
}) {
  if (!template) return null;
  const sourceCount = template.savedSourceNodeIds?.length ?? 1;
  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/40 px-2 py-2 text-[11px] leading-4 text-muted-foreground">
      <div className="font-medium text-foreground">将保存内容</div>
      <RecipePreviewLine
        label="来源"
        values={[`${sourceCount} 个已完成执行节点`]}
      />
      <RecipePreviewLine label="结构" values={template.nodeStructure} />
      <RecipePreviewLine label="工具" values={template.toolSequence} />
      <RecipePreviewLine label="输入" values={template.inputSlots} />
      <RecipePreviewLine
        label="验证"
        separator=" | "
        values={template.validationRules}
      />
      <RecipePreviewLine label="交付" values={[template.deliverableFormat]} />
    </div>
  );
}

function RecipePreviewLine({
  label,
  separator = " -> ",
  values,
}: {
  label: string;
  separator?: string;
  values: string[];
}) {
  if (values.length === 0) return null;
  const text = values.join(separator);
  return (
    <div className="mt-1 grid grid-cols-[38px_minmax(0,1fr)] gap-2">
      <span>{label}</span>
      <span className="min-w-0 truncate text-foreground" title={text}>
        {text}
      </span>
    </div>
  );
}
