/**
 * Shared helpers for canvas agent tools.
 * Extracted from the old Excalidraw helpers — only the functions still used
 * by the Cucumber canvas runtime remain.
 */

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/**
 * Estimate text width accounting for CJK characters.
 * Calibrated for the Virgil font:
 *   CJK characters ≈ 1.05× fontSize; Latin/ASCII ≈ 0.65× fontSize.
 * A 15% safety margin is applied to avoid text overflow.
 */
export function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols & Punctuation
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xff00 && code <= 0xffef) || // Fullwidth Forms
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0x20000 && code <= 0x2a6df); // CJK Extension B
    width += isCJK ? fontSize * 1.05 : fontSize * 0.65;
  }
  // +15% safety margin so text never clips on real render
  return width * 1.15;
}

// ---------------------------------------------------------------------------
// Color coercion
// ---------------------------------------------------------------------------

/**
 * Coerce numeric color values to hex strings at runtime.
 * LLMs (particularly Gemini) sometimes emit color values as integers
 * instead of "#RRGGBB" strings.
 */
export function coerceColor(v: unknown, fallback: string): string {
  if (typeof v === "number") return `#${v.toString(16).padStart(6, "0")}`;
  if (typeof v === "string" && v.length > 0) return v;
  return fallback;
}
