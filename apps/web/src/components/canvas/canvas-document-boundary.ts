import {
  createEmptyDocument,
  normalizeCanvasPages,
} from "@cucumber/canvas-core";
import type { PenRenderer } from "@cucumber/pen-renderer";
import type { PenDocument } from "@cucumber/pen-types";

import { normalizeStickyNotesInDocument } from "./sticky-note-tool";

function normalizePenDocument(raw: unknown): PenDocument {
  if (raw && typeof raw === "object" && "version" in raw) {
    return raw as PenDocument;
  }
  return createEmptyDocument();
}

export function normalizeRuntimeDocument(raw: unknown): PenDocument {
  return normalizeStickyNotesInDocument(
    normalizeCanvasPages(normalizePenDocument(raw)),
  );
}

export function normalizeRuntimeDocumentForCanvasSet(
  raw: unknown,
): PenDocument {
  return normalizeRuntimeDocument(raw);
}

export function syncRendererDocument(
  renderer: PenRenderer | null,
  doc: PenDocument,
  activePageId: string,
) {
  if (!renderer) return;
  renderer.setDocument(doc, activePageId);
}
