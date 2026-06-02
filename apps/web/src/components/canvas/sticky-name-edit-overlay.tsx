import { type ViewportState, sceneToCanvasLocal } from "@cucumber/pen-renderer";
import { useEffect, useRef, useState } from "react";

import type { CanvasBounds } from "@cucumber/canvas-core";

type StickyNameEditOverlayProps = {
  bounds: CanvasBounds;
  name: string;
  nodeId: string;
  viewport: ViewportState;
  onCancel: () => void;
  onCommit: (name: string) => void;
};

export function StickyNameEditOverlay({
  bounds,
  name,
  nodeId,
  onCancel,
  onCommit,
  viewport,
}: StickyNameEditOverlayProps) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const topLeft = sceneToCanvasLocal(bounds.x, bounds.y, viewport);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = () => {
    onCommit(draft);
  };

  return (
    <input
      ref={inputRef}
      aria-label="Rename sticky"
      className="absolute z-40 h-7 min-w-20 max-w-56 rounded-lg border border-border bg-card/95 px-2.5 text-xs font-semibold text-foreground shadow-card outline-none backdrop-blur-lg focus:ring-2 focus:ring-ring/30"
      data-canvas-overlay="sticky-name-editor"
      data-sticky-id={nodeId}
      maxLength={80}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      style={{
        left: Math.max(8, topLeft.x - 6),
        top: Math.max(8, topLeft.y - 34),
      }}
      value={draft}
    />
  );
}
