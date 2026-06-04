"use client";

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import { AlertTriangle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { cn } from "../../../lib/utils";

type AgentExecutionCritiqueSectionProps = {
  execution: AgentExecutionNodeMeta;
};

export function AgentExecutionCritiqueSection({
  execution,
}: AgentExecutionCritiqueSectionProps) {
  if (execution.kind !== "critique" || !execution.critique) return null;

  const { findings, issueCounts, pass } = execution.critique;
  const counts = issueCounts ?? countFindings(findings);

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">评审结果</div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold",
            pass
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-amber-500/10 text-amber-700",
          )}
        >
          {pass ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <TriangleAlert className="h-3 w-3" />
          )}
          {pass ? "通过" : "需处理"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <CritiqueCount label="错误" tone="error" value={counts.error} />
        <CritiqueCount label="警告" tone="warning" value={counts.warning} />
        <CritiqueCount label="提示" tone="info" value={counts.info} />
      </div>

      {findings.length > 0 ? (
        <div className="mt-3 space-y-2">
          {findings.map((finding, index) => (
            <div
              className="rounded-md border border-border bg-muted/30 px-2 py-2"
              key={`${finding.severity}:${finding.nodeId ?? "canvas"}:${index}`}
            >
              <div className="flex items-center gap-2 font-medium">
                <CritiqueSeverityIcon severity={finding.severity} />
                <span>{severityLabel(finding.severity)}</span>
                {finding.nodeId ? (
                  <span
                    className="min-w-0 truncate text-[11px] text-muted-foreground"
                    title={finding.nodeId}
                  >
                    {finding.nodeId}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 leading-5 text-foreground">{finding.reason}</p>
              {finding.suggestedFix ? (
                <p className="mt-1 leading-5 text-muted-foreground">
                  建议：{finding.suggestedFix}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          没有记录需要处理的问题。
        </p>
      )}
    </div>
  );
}

function CritiqueCount({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "error" | "info" | "warning";
  value: number;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 text-center",
        tone === "error" && "border-destructive/20 bg-destructive/5",
        tone === "warning" && "border-amber-500/20 bg-amber-500/5",
        tone === "info" && "border-blue-500/20 bg-blue-500/5",
      )}
    >
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function CritiqueSeverityIcon({
  severity,
}: {
  severity: "error" | "info" | "warning";
}) {
  if (severity === "error") {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (severity === "warning") {
    return <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />;
  }
  return <Info className="h-3.5 w-3.5 text-blue-600" />;
}

function severityLabel(severity: "error" | "info" | "warning") {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "提示";
}

function countFindings(
  findings: NonNullable<AgentExecutionNodeMeta["critique"]>["findings"],
) {
  return {
    error: findings.filter((finding) => finding.severity === "error").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    warning: findings.filter((finding) => finding.severity === "warning")
      .length,
  };
}
