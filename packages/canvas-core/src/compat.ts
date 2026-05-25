/**
 * Backward-compatible aliases and utilities for pre-Phase1 consumers.
 *
 * Stub functions that duplicate real implementations in import.ts / layout.ts
 * have been removed. The real exports are now available directly from the barrel.
 */

import type { PenDocument, PenNode } from '@cucumber/pen-types';
import { createEmptyDocument, createNodeId } from './document.js';

// ---------------------------------------------------------------------------
// Function aliases
// ---------------------------------------------------------------------------

/** @deprecated Use createEmptyDocument */
export const createEmptyCanvasDocument = createEmptyDocument;

/** Normalize raw data to PenDocument. Returns empty doc for unrecognized formats. */
export function normalizeCanvasDocument(raw: unknown): PenDocument {
  if (raw && typeof raw === 'object' && 'version' in (raw as Record<string, unknown>)) {
    return raw as PenDocument;
  }
  return createEmptyDocument();
}

/** @deprecated Use PenDocument type check directly */
export function isCucumberCanvasDocument(value: unknown): value is PenDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in (value as Record<string, unknown>) &&
    ('children' in (value as Record<string, unknown>) ||
      'pages' in (value as Record<string, unknown>))
  );
}
