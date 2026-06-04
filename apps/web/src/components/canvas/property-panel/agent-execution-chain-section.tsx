"use client";

import {
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionStatusLabel,
} from "@cucumber/canvas-core";
import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { ArrowDown, ArrowUp, CircleHelp } from "lucide-react";

import { cn } from "../../../lib/utils";

type AgentExecutionChainSectionProps = {
  execution: AgentExecutionNodeMeta;
  onSelectNode?: (nodeId: string) => void;
  pageNodes?: PenNode[];
};

export function AgentExecutionChainSection({
  execution,
  onSelectNode,
  pageNodes,
}: AgentExecutionChainSectionProps) {
  const upstream = resolveChainRefs(execution.upstreamNodeIds, pageNodes);
  const downstream = resolveChainRefs(execution.downstreamNodeIds, pageNodes);

  if (upstream.length === 0 && downstream.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="font-medium">关联步骤</div>
      <div className="mt-2 space-y-3">
        <ChainGroup
          emptyLabel="还没有前置内容。"
          icon={ArrowUp}
          items={upstream}
          label="前置内容"
          onSelectNode={onSelectNode}
        />
        <ChainGroup
          emptyLabel="还没有后续结果。"
          icon={ArrowDown}
          items={downstream}
          label="后续结果"
          onSelectNode={onSelectNode}
        />
      </div>
    </div>
  );
}

type ChainRef =
  | {
      id: string;
      meta: AgentExecutionNodeMeta;
      missing: false;
    }
  | {
      id: string;
      missing: true;
    };

function ChainGroup({
  emptyLabel,
  icon: Icon,
  items,
  label,
  onSelectNode,
}: {
  emptyLabel: string;
  icon: typeof ArrowDown;
  items: ChainRef[];
  label: string;
  onSelectNode?: (nodeId: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.map((item) => (
            <ChainCard
              item={item}
              key={`${label}:${item.id}`}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function ChainCard({
  item,
  onSelectNode,
}: {
  item: ChainRef;
  onSelectNode?: (nodeId: string) => void;
}) {
  if (item.missing) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-2">
        <div className="flex items-center gap-2 font-medium text-muted-foreground">
          <CircleHelp className="h-3.5 w-3.5" />
          <span>关联内容暂不可用</span>
        </div>
      </div>
    );
  }

  return (
    <button
      className="w-full rounded-md border border-border bg-muted/30 px-2 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/30"
      onClick={() => onSelectNode?.(item.id)}
      title="选中这个执行节点"
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium" title={item.meta.title}>
            {item.meta.title}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {getAgentExecutionKindLabel(item.meta.kind)}
            {item.meta.toolName ? ` · ${item.meta.toolName}` : ""}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
            item.meta.status === "done" &&
              "border-emerald-500/25 bg-emerald-500/10 text-emerald-700",
            item.meta.status === "running" &&
              "border-blue-500/25 bg-blue-500/10 text-blue-700",
            item.meta.status === "failed" &&
              "border-destructive/25 bg-destructive/10 text-destructive",
            (item.meta.status === "waiting" || item.meta.status === "paused") &&
              "border-border bg-muted text-muted-foreground",
          )}
        >
          {getAgentExecutionStatusLabel(item.meta.status)}
        </span>
      </div>
    </button>
  );
}

function resolveChainRefs(
  nodeIds: string[] | undefined,
  pageNodes: PenNode[] | undefined,
): ChainRef[] {
  if (!nodeIds?.length) return [];
  return nodeIds.map((id) => {
    const node = pageNodes?.find((pageNode) => pageNode.id === id);
    const meta = getAgentExecutionMeta(node);
    if (!meta) return { id, missing: true };
    return { id, meta, missing: false };
  });
}
