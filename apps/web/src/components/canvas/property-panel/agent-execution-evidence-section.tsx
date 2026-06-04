"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import { ExternalLink, Link2 } from "lucide-react";

type EvidenceMeta = NonNullable<AgentExecutionNodeMeta["evidence"]>;
type EvidenceSourceType = EvidenceMeta["sourceType"];

const SOURCE_TYPE_LABELS: Record<EvidenceSourceType, string> = {
  asset: "资产",
  canvas_node: "画布节点",
  search_result: "搜索结果",
  text: "文本",
  url: "链接",
};

export function AgentExecutionEvidenceSection({
  execution,
}: {
  execution: AgentExecutionNodeMeta;
}) {
  const evidence = execution.evidence;
  if (!evidence) return null;

  const confidenceLabel = formatConfidence(evidence.confidence);
  const rows = [
    ["来源类型", SOURCE_TYPE_LABELS[evidence.sourceType]],
    ["来源名称", evidence.sourceLabel],
    ["URL", evidence.url],
    ["资产 ID", evidence.assetId],
    ["节点 ID", evidence.sourceNodeId],
    ["置信度", confidenceLabel],
  ].filter((row): row is [string, string] => Boolean(row[1]?.trim()));
  const hasConcreteSource =
    Boolean(evidence.sourceLabel?.trim()) ||
    Boolean(evidence.url?.trim()) ||
    Boolean(evidence.assetId?.trim()) ||
    Boolean(evidence.sourceNodeId?.trim()) ||
    Boolean(confidenceLabel);

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 font-medium">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>证据来源</span>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {SOURCE_TYPE_LABELS[evidence.sourceType]}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {rows.map(([label, value]) => (
          <div
            className="grid grid-cols-[72px_minmax(0,1fr)] gap-2"
            key={label}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 break-words font-medium" title={value}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {!hasConcreteSource ? (
        <p className="mt-2 leading-5 text-muted-foreground">
          这个证据节点还没有记录具体来源 ID、链接或可信度。
        </p>
      ) : null}

      {evidence.url?.trim() ? (
        <a
          className="mt-3 inline-flex h-8 max-w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          href={evidence.url}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">打开链接</span>
        </a>
      ) : null}
    </div>
  );
}

function formatConfidence(confidence: number | undefined): string | undefined {
  if (confidence === undefined) return undefined;
  if (!Number.isFinite(confidence)) return "置信度记录不是有效数字";
  if (confidence >= 0 && confidence <= 1) {
    return `${Math.round(confidence * 100)}%`;
  }
  return `${confidence}`;
}
