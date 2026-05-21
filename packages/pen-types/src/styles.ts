export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'lighten'
  | 'difference'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface SolidFill {
  type: 'solid';
  color: string;
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface GradientStop {
  offset: number;
  color: string;
}

export interface LinearGradientFill {
  type: 'linear_gradient';
  angle?: number;
  stops: GradientStop[];
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface RadialGradientFill {
  type: 'radial_gradient';
  cx?: number;
  cy?: number;
  radius?: number;
  stops: GradientStop[];
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface ImageOriginalSize {
  width: number;
  height: number;
}

export interface ImageTransform {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface ImageFill {
  type: 'image';
  url: string;
  mode?: 'fill' | 'fit' | 'crop' | 'tile' | 'stretch';
  originalSize?: ImageOriginalSize;
  transform?: ImageTransform;
  explain?: string;
  opacity?: number;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

export type PenFill = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;

export interface PenStroke {
  thickness: number | [number, number, number, number];
  align?: 'inside' | 'center' | 'outside';
  join?: 'miter' | 'bevel' | 'round';
  cap?: 'none' | 'round' | 'square';
  dashPattern?: number[];
  dashOffset?: number;
  fill?: PenFill[];
}

export interface BlurEffect {
  type: 'blur' | 'background_blur';
  radius: number;
}

export interface ShadowEffect {
  type: 'shadow';
  inner?: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

export type PenEffect = BlurEffect | ShadowEffect;

export interface StyledTextSegment {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  underline?: boolean;
  strikethrough?: boolean;
  href?: string;
}
