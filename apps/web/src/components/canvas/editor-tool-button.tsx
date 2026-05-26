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
  active = false,
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
      aria-pressed={active}
      className={cn(
        "size-8 text-muted-foreground hover:bg-muted hover:text-foreground",
        active &&
          "border-primary/30 bg-primary/10 text-foreground shadow-sm hover:bg-primary/15",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      <Icon className="size-4" />
    </Button>
  );
}
