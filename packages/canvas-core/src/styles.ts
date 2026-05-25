// Re-export canonical style types from pen-types, plus canvas-specific aliases

export type {
  BlendMode,
  SolidFill,
  GradientStop,
  LinearGradientFill,
  RadialGradientFill,
  ImageFill,
  PenFill,
  PenStroke,
  BlurEffect,
  ShadowEffect,
  PenEffect,
  StyledTextSegment,
} from '@cucumber/pen-types';

// Legacy aliases for backward compatibility
import type { PenFill, PenStroke, PenEffect } from '@cucumber/pen-types';
export type CanvasFill = PenFill;
export type CanvasStroke = PenStroke;
export type CanvasEffect = PenEffect;

export type { ImageOriginalSize, ImageTransform } from '@cucumber/pen-types';
