import type { RefObject } from "react";

import type { TextEditState } from "./canvas-text-measure";

export type TextEditViewportOverlay = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
};

export function CanvasTextEditOverlay({
  editingText,
  overlay,
  textareaRef,
  onCommit,
  onDraftChange,
}: {
  editingText: TextEditState | null;
  overlay: TextEditViewportOverlay | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommit: (content: string) => void;
  onDraftChange: (content: string) => void;
}) {
  if (!editingText || !overlay) return null;
  return (
    <textarea
      ref={textareaRef}
      aria-label="Edit canvas text"
      // biome-ignore lint/a11y/noAutofocus: text editing opens from an explicit double-click and should focus the in-place editor immediately.
      autoFocus
      className="absolute z-30 box-border m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none ring-0 focus:outline-none focus:ring-0"
      value={editingText.content}
      wrap={editingText.textGrowth === "auto" ? "off" : "soft"}
      style={{
        backgroundColor: "transparent",
        border: 0,
        boxShadow: "none",
        left: overlay.left,
        top: overlay.top,
        width: overlay.width,
        height: overlay.height,
        fontSize: overlay.fontSize,
        fontFamily: editingText.fontFamily,
        fontWeight: editingText.fontWeight,
        textAlign: editingText.textAlign,
        caretColor: editingText.color,
        color: "transparent",
        lineHeight: editingText.lineHeight,
        whiteSpace: editingText.textGrowth === "auto" ? "pre" : "pre-wrap",
        overflowWrap:
          editingText.textGrowth === "auto" ? "normal" : "break-word",
        WebkitTextFillColor: "transparent",
      }}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onChange={(event) => onDraftChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCommit(event.currentTarget.value);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.currentTarget.blur();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    />
  );
}
