// @ts-nocheck
import type { BlendMode } from "@cucumber/pen-types";

/**
 * Normalize Figma's upper-snake blend names to Pen's persisted blend tokens.
 * Unknown modes are treated as normal by callers so imports remain editable.
 */
export function mapFigmaBlendMode(mode?: string): BlendMode | undefined {
  switch (mode) {
    case "PASS_THROUGH":
      return "pass_through";
    case "NORMAL":
      return "normal";
    case "DARKEN":
      return "darken";
    case "MULTIPLY":
      return "multiply";
    case "LINEAR_BURN":
      return "linear_burn";
    case "COLOR_BURN":
      return "color_burn";
    case "LIGHTEN":
      return "lighten";
    case "SCREEN":
      return "screen";
    case "LINEAR_DODGE":
      return "linear_dodge";
    case "COLOR_DODGE":
      return "color_dodge";
    case "OVERLAY":
      return "overlay";
    case "SOFT_LIGHT":
      return "soft_light";
    case "HARD_LIGHT":
      return "hard_light";
    case "DIFFERENCE":
      return "difference";
    case "EXCLUSION":
      return "exclusion";
    case "HUE":
      return "hue";
    case "SATURATION":
      return "saturation";
    case "COLOR":
      return "color";
    case "LUMINOSITY":
      return "luminosity";
    default:
      return undefined;
  }
}
