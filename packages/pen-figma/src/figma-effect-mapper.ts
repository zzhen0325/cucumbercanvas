// @ts-nocheck
import type { PenEffect } from "@cucumber/pen-types";
import { mapFigmaBlendMode } from "./figma-blend-mode.js";
import { figmaColorToHex } from "./figma-color-utils.js";
import type { FigmaEffect } from "./figma-types.js";

/**
 * Convert Figma effects[] (internal format) to PenEffect[].
 */
export function mapFigmaEffects(
  effects: FigmaEffect[] | undefined,
): PenEffect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  const mapped: PenEffect[] = [];

  for (const effect of effects) {
    const pen = mapSingleEffect(effect);
    if (pen) mapped.push(pen);
  }

  return mapped.length > 0 ? mapped : undefined;
}

function mapSingleEffect(effect: FigmaEffect): PenEffect | null {
  switch (effect.type) {
    case "DROP_SHADOW":
    case "INNER_SHADOW": {
      return {
        type: "shadow",
        inner: effect.type === "INNER_SHADOW",
        offsetX: effect.offset?.x ?? 0,
        offsetY: effect.offset?.y ?? 0,
        blur: effect.radius ?? 0,
        spread: effect.spread ?? 0,
        color: effect.color ? figmaEffectColorToHex(effect.color) : "#000000",
        ...effectLayerProps(effect),
      };
    }

    case "FOREGROUND_BLUR": {
      return {
        type: "blur",
        radius: effect.radius ?? 0,
        ...effectLayerProps(effect),
      };
    }

    case "BACKGROUND_BLUR": {
      return {
        type: "background_blur",
        radius: effect.radius ?? 0,
        ...effectLayerProps(effect),
      };
    }

    default:
      return null;
  }
}

function figmaEffectColorToHex(color: FigmaEffect["color"]): string {
  if (!color) return "#000000";
  return figmaColorToHex({ ...color, a: 1 });
}

function effectLayerProps(effect: FigmaEffect): {
  visible?: boolean;
  opacity?: number;
  blendMode?: ReturnType<typeof mapFigmaBlendMode>;
} {
  const blendMode = mapFigmaBlendMode(effect.blendMode);
  const opacity = effect.opacity ?? effect.color?.a;
  return {
    ...(effect.visible === false ? { visible: false } : {}),
    ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
    ...(blendMode ? { blendMode } : {}),
  };
}
