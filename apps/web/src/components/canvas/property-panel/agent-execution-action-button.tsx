"use client";

import type { LucideIcon } from "lucide-react";

export function AgentExecutionActionButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  reason,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  reason?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? reason : label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
