"use client";

import type { BooleanOpType } from "@cucumber/pen-core";
import { BoxSelect, CircleSlash, Combine, MinusSquare } from "lucide-react";

import { Button } from "@/components/ui/button";

type ToolbarEvent =
  | React.MouseEvent<HTMLElement>
  | React.PointerEvent<HTMLElement>
  | React.KeyboardEvent<HTMLElement>
  | React.WheelEvent<HTMLElement>;

function stopCanvasPropagation(event: ToolbarEvent) {
  event.stopPropagation();
}

const BOOLEAN_ACTIONS: Array<{
  icon: typeof Combine;
  label: "Union" | "Subtract" | "Intersect" | "Exclude";
  operation: BooleanOpType;
}> = [
  { icon: Combine, label: "Union", operation: "union" },
  { icon: MinusSquare, label: "Subtract", operation: "subtract" },
  { icon: BoxSelect, label: "Intersect", operation: "intersect" },
  { icon: CircleSlash, label: "Exclude", operation: "exclude" },
];

export type CanvasBooleanToolbarProps = {
  onBooleanOperation: (operation: BooleanOpType) => void;
  rejectionReason: string | null;
  visible: boolean;
};

export function CanvasBooleanToolbar({
  onBooleanOperation,
  rejectionReason,
  visible,
}: CanvasBooleanToolbarProps) {
  if (!visible) return null;

  const disabled = Boolean(rejectionReason);

  return (
    <div
      role="toolbar"
      aria-label="Boolean operations"
      className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-card backdrop-blur"
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      {BOOLEAN_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.operation}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={action.label}
            className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={disabled}
            onClick={() => onBooleanOperation(action.operation)}
            title={rejectionReason ?? action.label}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </div>
  );
}
