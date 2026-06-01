export type BlendMode =
  | "normal"
  | "pass_through"
  | "darken"
  | "multiply"
  | "screen"
  | "overlay"
  | "lighten"
  | "color_burn"
  | "color_dodge"
  | "linear_burn"
  | "linear_dodge"
  | "hard_light"
  | "soft_light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface PaintLayerBase {
  /** Figma paint layer visibility. Hidden layers are retained for edit fidelity. */
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface SolidFill {
  type: "solid";
  color: string;
  explain?: string;
}
export interface SolidFill extends PaintLayerBase {}

export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface PaintTransform {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface LinearGradientFill {
  type: "linear_gradient";
  angle?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  transform?: PaintTransform;
  stops: GradientStop[];
  explain?: string;
}
export interface LinearGradientFill extends PaintLayerBase {}

export interface RadialGradientFill {
  type: "radial_gradient";
  cx?: number;
  cy?: number;
  radius?: number;
  transform?: PaintTransform;
  stops: GradientStop[];
  explain?: string;
}
export interface RadialGradientFill extends PaintLayerBase {}

export interface AngularGradientFill {
  type: "angular_gradient";
  cx?: number;
  cy?: number;
  angle?: number;
  transform?: PaintTransform;
  stops: GradientStop[];
  explain?: string;
}
export interface AngularGradientFill extends PaintLayerBase {}

export interface DiamondGradientFill {
  type: "diamond_gradient";
  cx?: number;
  cy?: number;
  radius?: number;
  angle?: number;
  transform?: PaintTransform;
  stops: GradientStop[];
  explain?: string;
}
export interface DiamondGradientFill extends PaintLayerBase {}

export interface ImageOriginalSize {
  width: number;
  height: number;
}

export interface ImageTransform extends PaintTransform {}

export interface ImageFill {
  type: "image";
  url: string;
  mode?: "fill" | "fit" | "crop" | "tile" | "stretch";
  originalSize?: ImageOriginalSize;
  transform?: ImageTransform;
  explain?: string;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}
export interface ImageFill extends PaintLayerBase {}

export type PenFill =
  | SolidFill
  | LinearGradientFill
  | RadialGradientFill
  | AngularGradientFill
  | DiamondGradientFill
  | ImageFill;

export interface PenStroke {
  thickness: number | [number, number, number, number];
  align?: "inside" | "center" | "outside";
  join?: "miter" | "bevel" | "round";
  cap?: "none" | "round" | "square";
  startTip?: PenStrokeEndpointTip;
  endTip?: PenStrokeEndpointTip;
  dashPattern?: number[];
  dashOffset?: number;
  miterLimit?: number;
  fill?: PenFill[];
}

export type PenStrokeEndpointTip =
  | "none"
  | "line-arrow"
  | "triangle-arrow"
  | "reverse-triangle"
  | "diamond";

export interface BlurEffect {
  type: "blur" | "background_blur";
  radius: number;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface ShadowEffect {
  type: "shadow";
  inner?: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
}

export type PenEffect = BlurEffect | ShadowEffect;

export interface StyledTextSegment {
  text: string;
  fontFamily?: string;
  fontPostScriptName?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Legacy text color shortcut. Prefer fills for editable Figma imports. */
  fill?: string;
  fills?: PenFill[];
  lineHeight?: number;
  letterSpacing?: number;
  underline?: boolean;
  strikethrough?: boolean;
  baselineShift?: number;
  textCase?: "original" | "upper" | "lower" | "title";
  fontFallback?: string[];
  openTypeFeatures?: Record<string, boolean | number>;
  href?: string;
}
