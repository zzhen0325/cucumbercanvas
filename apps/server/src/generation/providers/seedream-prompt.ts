export const SEEDREAM_IMAGE_PROMPT_MAX_CHARS = 800;

export type SeedreamPromptNormalization = {
  prompt: string;
  originalLength: number;
  normalizedLength: number;
  removedSpecialSymbolCount: number;
  truncated: boolean;
};

const SYMBOL_REGEX = /[\p{Sc}\p{Sk}\p{Sm}\p{So}]/gu;

export function normalizeSeedreamImagePrompt(
  prompt: string,
): SeedreamPromptNormalization {
  const originalLength = Array.from(prompt).length;
  let removedSpecialSymbolCount = 0;
  const withoutSymbols = prompt.replace(SYMBOL_REGEX, () => {
    removedSpecialSymbolCount += 1;
    return " ";
  });
  const normalized = withoutSymbols.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  const truncated = chars.length > SEEDREAM_IMAGE_PROMPT_MAX_CHARS;
  const finalPrompt = truncated
    ? chars.slice(0, SEEDREAM_IMAGE_PROMPT_MAX_CHARS).join("").trim()
    : normalized;

  return {
    prompt: finalPrompt,
    originalLength,
    normalizedLength: Array.from(finalPrompt).length,
    removedSpecialSymbolCount,
    truncated,
  };
}
