import type { KvSession, KvSizePreset } from './ai-types';

export const KV_DEFAULT_MAIN_SIZE: KvSizePreset = '1125x600';

export const KV_SIZE_PRESETS: KvSizePreset[] = [
  '1125x600',
  '1125x672',
  '1054x720',
  '1125x450',
  '1080x1080',
  '1080x1440',
];

const KV_KEYWORD_RE =
  /\b(kv|key\s*visual|poster|banner|cover)\b|活动\s*kv|官号|主视觉|海报|封面/i;
const EXTEND_RE =
  /补全尺寸|补齐尺寸|补全全部尺寸|补齐全部尺寸|全尺寸|all\s+sizes|complete\s+sizes|fill\s+remaining\s+sizes/i;
const REFINE_RE =
  /(^|\s)(微调|细化|refine|tweak|polish|优化[:：]|调整[:：])|^微调[:：]?|^refine[:：]?/i;
const RESIZE_RE = /(改成|换成|切到|change\s+to|switch\s+to)\s*\d{3,4}\s*[xX*]\s*\d{3,4}/i;
const SIZE_RE = /(\d{3,4})\s*[xX*]\s*(\d{3,4})/g;

export type KvIntentMode = 'generate' | 'extend' | 'refine' | 'resize';

export interface ParsedKvIntent {
  isKv: boolean;
  mode: KvIntentMode;
  instruction: string;
  explicitSize?: KvSizePreset;
  mainSize: KvSizePreset;
}

export function parseKvSize(sizeText: string): KvSizePreset | null {
  const m = sizeText.trim().match(/^(\d{3,4})\s*[xX*]\s*(\d{3,4})$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 100 || w > 4000 || h < 100 || h > 4000) return null;
  return `${w}x${h}`;
}

export function extractFirstSize(text: string): KvSizePreset | null {
  const match = text.match(SIZE_RE);
  if (!match || match.length === 0) return null;
  return parseKvSize(match[0]);
}

export function isKvIntent(message: string, session: KvSession | null): boolean {
  const text = message.trim();
  if (!text) return false;
  if (KV_KEYWORD_RE.test(text)) return true;
  if (!session) return false;
  return EXTEND_RE.test(text) || REFINE_RE.test(text) || RESIZE_RE.test(text) || SIZE_RE.test(text);
}

export function parseKvIntent(message: string, session: KvSession | null): ParsedKvIntent {
  const text = message.trim();
  const explicitSize = extractFirstSize(text) ?? undefined;
  const hasKvKeyword = KV_KEYWORD_RE.test(text);
  const hasExtend = EXTEND_RE.test(text);
  const hasResize = RESIZE_RE.test(text);
  const hasRefine = REFINE_RE.test(text);

  if (!isKvIntent(text, session)) {
    return {
      isKv: false,
      mode: 'generate',
      instruction: text,
      mainSize: session?.mainSize ?? KV_DEFAULT_MAIN_SIZE,
    };
  }

  let mode: KvIntentMode = 'generate';
  if (hasExtend) {
    mode = 'extend';
  } else if (hasResize || explicitSize) {
    mode = session ? 'resize' : 'generate';
  } else if (hasRefine) {
    mode = session ? 'refine' : hasKvKeyword ? 'generate' : 'refine';
  } else if (session && !hasKvKeyword) {
    mode = 'refine';
  }

  return {
    isKv: true,
    mode,
    instruction: text,
    explicitSize,
    mainSize: explicitSize ?? session?.mainSize ?? KV_DEFAULT_MAIN_SIZE,
  };
}

export function getRemainingPresetSizes(generatedSizes: KvSizePreset[]): KvSizePreset[] {
  const done = new Set(generatedSizes);
  return KV_SIZE_PRESETS.filter((s) => !done.has(s));
}
