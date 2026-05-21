import type { PenFill, PenStroke, PenEffect, StyledTextSegment } from './styles.js';

export interface PenPage {
  id: string;
  name: string;
  children: PenNode[];
}

export interface PenDocument {
  version: string;
  name?: string;
  children: PenNode[];
  variables?: Record<string, unknown>;
}

export type PenNodeType =
  | 'frame'
  | 'group'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'path'
  | 'text'
  | 'image'
  | 'container';

export type SizingBehavior = number | 'fit_content' | 'fill_container' | string;

export interface PenNodeBase {
  id: string;
  type: PenNodeType;
  name?: string;
  role?: string;
  x?: number;
  y?: number;
  rotation?: number;
  opacity?: number | string;
  visible?: boolean;
  locked?: boolean;
  flipX?: boolean;
  flipY?: boolean;
}

export interface ContainerProps {
  width?: SizingBehavior;
  height?: SizingBehavior;
  layout?: 'none' | 'vertical' | 'horizontal';
  gap?: number | string;
  padding?: number | [number, number] | [number, number, number, number] | string;
  justifyContent?: 'start' | 'center' | 'end' | 'space_between' | 'space_around';
  alignItems?: 'start' | 'center' | 'end';
  clipContent?: boolean;
  children?: PenNode[];
  cornerRadius?: number | [number, number, number, number];
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface FrameNode extends PenNodeBase, ContainerProps {
  type: 'frame';
  reusable?: boolean;
  slot?: string[];
}

export interface GroupNode extends PenNodeBase, ContainerProps {
  type: 'group';
}

export interface RectangleNode extends PenNodeBase, ContainerProps {
  type: 'rectangle';
}

export interface EllipseNode extends PenNodeBase {
  type: 'ellipse';
  width?: SizingBehavior;
  height?: SizingBehavior;
  cornerRadius?: number;
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface LineNode extends PenNodeBase {
  type: 'line';
  x2?: number;
  y2?: number;
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface PolygonNode extends PenNodeBase {
  type: 'polygon';
  polygonCount: number;
  width?: SizingBehavior;
  height?: SizingBehavior;
  cornerRadius?: number;
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface PenPathHandle {
  x: number;
  y: number;
}

export type PenPathPointType = 'corner' | 'mirrored' | 'independent';

export interface PenPathAnchor {
  x: number;
  y: number;
  handleIn: PenPathHandle | null;
  handleOut: PenPathHandle | null;
  pointType?: PenPathPointType;
}

export interface PathNode extends PenNodeBase {
  type: 'path';
  d: string;
  anchors?: PenPathAnchor[];
  closed?: boolean;
  width?: SizingBehavior;
  height?: SizingBehavior;
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface TextNode extends PenNodeBase {
  type: 'text';
  width?: SizingBehavior;
  height?: SizingBehavior;
  content: string | StyledTextSegment[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  fill?: PenFill[];
  effects?: PenEffect[];
}

export type ImageFitMode = 'fill' | 'fit' | 'crop' | 'tile';

export interface ImageNode extends PenNodeBase {
  type: 'image';
  src: string;
  objectFit?: ImageFitMode;
  width?: SizingBehavior;
  height?: SizingBehavior;
  cornerRadius?: number | [number, number, number, number];
  effects?: PenEffect[];
}

export type PenNode =
  | FrameNode
  | GroupNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | PolygonNode
  | PathNode
  | TextNode
  | ImageNode;
