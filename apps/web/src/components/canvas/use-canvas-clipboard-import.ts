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
  return {
    html: event.clipboardData?.getData("text/html") || undefined,
    text: event.clipboardData?.getData("text/plain") || undefined,
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
  const mimeTypes: string[] = [];

  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        mimeTypes.push(...item.types);
        if (!html && item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          html = await blob.text();
        }
        if (!text && item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          text = await blob.text();
        }
      }
    } catch {
      // Some browsers block read() without transient activation.
    }
  }

  if (!text && typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Ignore permission errors and let caller handle empty payloads.
    }
  }

  return {
    payload: { html, text },
    context: {
      trigger: "clipboard-api",
      mimeTypes: Array.from(new Set(mimeTypes)),
      hasHtml: Boolean(html),
      hasText: Boolean(text),
    },
  };
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
