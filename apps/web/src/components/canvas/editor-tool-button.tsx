"use client";

import type { LucideProps } from "lucide-react";
import type { ComponentType, MouseEventHandler } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EditorToolButtonProps = {
  active?: boolean;
  className?: string;
  disabled?: boolean;
  icon: ComponentType<LucideProps>;
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  shortcut?: string;
};

export function EditorToolButton({
  active,
  className,
  disabled = false,
  icon: Icon,
  label,
  onClick,
  shortcut,
}: EditorToolButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        "relative size-8 rounded-lg border border-transparent text-foreground/60 transition-all duration-150 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        active &&
          "border-foreground/10 bg-foreground/[0.08] text-foreground shadow-subtle hover:bg-foreground/[0.1]",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {active ? (
        <span
          className="absolute left-1 top-1 size-1 rounded-full bg-accent"
          aria-hidden="true"
        />
      ) : null}
      <Icon className="size-4" />
    </Button>
  );
}
