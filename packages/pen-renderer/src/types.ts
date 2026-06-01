import type { PenNode, PenPathAnchor } from "@cucumber/pen-types";

export type { ViewportState } from "@cucumber/pen-types";

export interface RenderNode {
  node: PenNode;
  absX: number;
  absY: number;
  absW: number;
  absH: number;
  depth?: number;
  inheritedOpacity?: number;
  renderOpacity?: number;
  opacityGroup?: {
    opacity: number;
    depth: number;
  };
  clipRect?: {
    x: number;
    y: number;
    w: number;
    h: number;
    rx: number;
    cornerRadius?: [number, number, number, number];
    cornerSmoothing?: number;
    source?: "frame" | "mask";
    maskOpacity?: number;
    maskType?: "alpha" | "vector";
    maskShape?: {
      node: PenNode;
      absX: number;
      absY: number;
      absW: number;
      absH: number;
    };
  };
}

/** Injectable icon lookup function for resolving icon names to SVG path data. */
export type IconLookupFn = (
  name: string,
) => { d: string; iconId: string; style: "stroke" | "fill" } | null;

export interface PenRendererOptions {
  /** URL pattern for CanvasKit WASM files. Default: '/canvaskit/' */
  canvasKitPath?: string | ((file: string) => string);
  /** Base URL for bundled font files. Default: '/fonts/' */
  fontBasePath?: string;
  /** Custom Google Fonts CSS endpoint. Default: 'https://fonts.googleapis.com/css2' */
  googleFontsCssUrl?: string;
  /** Icon lookup function. Default: null (icons render as fallback circle) */
  iconLookup?: IconLookupFn;
  /** Theme variant to use for variable resolution. Default: first variant per axis */
  themeVariant?: Record<string, string>;
  /** Background color. Default: '#1a1a1a' */
  backgroundColor?: string;
  /** Device pixel ratio override. Default: window.devicePixelRatio */
  devicePixelRatio?: number;
  /** Default fonts to preload. Default: ['Inter', 'Noto Sans SC'] */
  defaultFonts?: string[];
}

export type RendererInteractionMode = "idle" | "viewport" | "transform";

export type TransformPreviewState =
  | {
      kind: "move";
      nodeIds: string[];
      dx: number;
      dy: number;
    }
  | {
      kind: "resize";
      nodeId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: "rotate";
      nodeId: string;
      rotation: number;
    };

export type ResizeHandleDirection =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

export interface EditorMarqueeOverlay {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorShapeOverlay {
  type: "rect" | "ellipse" | "polygon";
  bounds: EditorMarqueeOverlay;
  fillColor: string;
}

export interface EditorLineOverlay {
  start: { x: number; y: number };
  end: { x: number; y: number };
  arrow?: boolean;
}

export interface EditorPenPreviewOverlay {
  points: PenPathAnchor[];
  cursorPos: { x: number; y: number } | null;
  isDraggingHandle: boolean;
}

export interface EditorOverlayState {
  selectedIds: string[];
  selectionColor?: string;
  marquee?: EditorMarqueeOverlay | null;
  shapePreview?: EditorShapeOverlay | null;
  linePreview?: EditorLineOverlay | null;
  penPreview?: EditorPenPreviewOverlay | null;
}

export type SelectionControlHit =
  | { type: "resize"; nodeId: string; handle: ResizeHandleDirection }
  | { type: "rotate"; nodeId: string }
  | { type: "line-endpoint"; nodeId: string; endpoint: "start" | "end" };
