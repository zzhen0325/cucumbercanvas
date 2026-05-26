import type { ClipboardImportPayload } from "@cucumber/canvas-core";
import { useEffect } from "react";

export interface ClipboardImportContext {
  trigger: "paste-event" | "clipboard-api";
  mimeTypes: string[];
  hasHtml: boolean;
  hasText: boolean;
}

export interface ClipboardImportReadResult {
  payload: ClipboardImportPayload;
  context: ClipboardImportContext;
}

export function getClipboardImportPayloadFromEvent(
  event: ClipboardEvent,
): ClipboardImportPayload {
  const items = Array.from(event.clipboardData?.types ?? [])
    .map((type) => ({ type, text: event.clipboardData?.getData(type) ?? "" }))
    .filter((item) => item.text.length > 0);
  return {
    html: event.clipboardData?.getData("text/html") || undefined,
    text: event.clipboardData?.getData("text/plain") || undefined,
    svg: event.clipboardData?.getData("image/svg+xml") || undefined,
    items: items.length > 0 ? items : undefined,
  };
}

export function getClipboardImportContextFromEvent(
  event: ClipboardEvent,
): ClipboardImportContext {
  const mimeTypes = Array.from(event.clipboardData?.types ?? []);
  return {
    trigger: "paste-event",
    mimeTypes,
    hasHtml: mimeTypes.includes("text/html"),
    hasText: mimeTypes.includes("text/plain"),
  };
}

export async function readClipboardImportPayload(): Promise<ClipboardImportReadResult> {
  let html: string | undefined;
  let text: string | undefined;
  let svg: string | undefined;
  const mimeTypes: string[] = [];
  const textItems: Array<{ type: string; text: string }> = [];

  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        mimeTypes.push(...item.types);
        for (const type of item.types) {
          if (!isReadableTextClipboardType(type)) continue;
          const blob = await item.getType(type);
          const value = await blob.text();
          if (!value) continue;
          textItems.push({ type, text: value });
          if (!html && type === "text/html") html = value;
          if (!text && type === "text/plain") text = value;
          if (!svg && type === "image/svg+xml") svg = value;
        }
      }
    } catch {
      // Some browsers block read() without transient activation.
    }
  }

  if (
    !text &&
    typeof navigator !== "undefined" &&
    navigator.clipboard?.readText
  ) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Ignore permission errors and let caller handle empty payloads.
    }
  }

  return {
    payload: {
      html,
      text,
      svg,
      items: textItems.length > 0 ? textItems : undefined,
    },
    context: {
      trigger: "clipboard-api",
      mimeTypes: Array.from(new Set(mimeTypes)),
      hasHtml: Boolean(html),
      hasText: Boolean(text),
    },
  };
}

function isReadableTextClipboardType(type: string): boolean {
  return (
    type === "text/html" ||
    type === "text/plain" ||
    type === "image/svg+xml" ||
    type.startsWith("text/") ||
    type.includes("figma")
  );
}

export function useCanvasClipboardImport(options: {
  onImportPayload: (
    payload: ClipboardImportPayload,
    context: ClipboardImportContext,
  ) => boolean;
}) {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const payload = getClipboardImportPayloadFromEvent(event);
      const context = getClipboardImportContextFromEvent(event);
      if (options.onImportPayload(payload, context)) {
        event.preventDefault();
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [options]);
}
