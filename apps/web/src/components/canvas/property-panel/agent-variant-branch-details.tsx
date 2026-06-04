"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";

type VariantBranchMeta = NonNullable<AgentExecutionNodeMeta["branch"]>;

export function AgentVariantBranchDetails({
  branch,
  compact,
}: {
  branch?: VariantBranchMeta;
  compact?: boolean;
}) {
  const hasAnyDetail =
    Boolean(branch?.planSummary?.trim()) ||
    Boolean(branch?.deliverableSummary?.trim()) ||
    Boolean(branch?.critiqueSummary?.trim()) ||
    Boolean(branch?.strengths?.length) ||
    Boolean(branch?.risks?.length) ||
    Boolean(branch?.useCases?.length);
  const gridClass = compact
    ? "grid-cols-[48px_minmax(0,1fr)] text-[11px]"
    : "grid-cols-[72px_minmax(0,1fr)] text-xs";

  if (!hasAnyDetail) {
    return (
      <p className="mt-2 leading-5 text-muted-foreground">
        这个方案分支还没有记录计划、产物或评审摘要。
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <BranchDetailText
        gridClass={gridClass}
        label="计划"
        value={branch?.planSummary}
      />
      <BranchDetailText
        gridClass={gridClass}
        label="产物"
        value={branch?.deliverableSummary}
      />
      <BranchDetailText
        gridClass={gridClass}
        label="评审"
        value={branch?.critiqueSummary}
      />
      <BranchDetailList
        gridClass={gridClass}
        label="优点"
        values={branch?.strengths}
      />
      <BranchDetailList
        gridClass={gridClass}
        label="风险"
        values={branch?.risks}
      />
      <BranchDetailList
        gridClass={gridClass}
        label="适用"
        values={branch?.useCases}
      />
    </div>
  );
}

function BranchDetailText({
  gridClass,
  label,
  value,
}: {
  gridClass: string;
  label: string;
  value?: string;
}) {
  if (!value?.trim()) return null;
  return (
    <div className={`grid gap-2 ${gridClass}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap leading-5 text-foreground">
        {value}
      </span>
    </div>
  );
}

function BranchDetailList({
  gridClass,
  label,
  values,
}: {
  gridClass: string;
  label: string;
  values?: string[];
}) {
  if (!values?.length) return null;
  return (
    <div className={`grid gap-2 ${gridClass}`}>
      <span className="text-muted-foreground">{label}</span>
      <ul className="min-w-0 list-disc space-y-1 pl-4 leading-5 text-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
