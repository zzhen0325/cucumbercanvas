import { describe, expect, it } from "vitest";

import {
  SEEDREAM_IMAGE_PROMPT_MAX_CHARS,
  normalizeSeedreamImagePrompt,
} from "./seedream-prompt.js";

describe("normalizeSeedreamImagePrompt", () => {
  it("limits image prompts to Seedream's 800 character guidance", () => {
    const result = normalizeSeedreamImagePrompt("a".repeat(900));

    expect(result.prompt).toHaveLength(SEEDREAM_IMAGE_PROMPT_MAX_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.normalizedLength).toBe(SEEDREAM_IMAGE_PROMPT_MAX_CHARS);
  });

  it("removes symbol characters while preserving normal punctuation and quotes", () => {
    const result = normalizeSeedreamImagePrompt(
      'A "premium" cucumber soda poster, fresh lighting $$$ ✨',
    );

    expect(result.prompt).toBe(
      'A "premium" cucumber soda poster, fresh lighting',
    );
    expect(result.removedSpecialSymbolCount).toBe(4);
  });

  it("collapses whitespace introduced by symbol removal", () => {
    const result = normalizeSeedreamImagePrompt("fresh\t\tgreen\n\nposter $ $");

    expect(result.prompt).toBe("fresh green poster");
  });
});
