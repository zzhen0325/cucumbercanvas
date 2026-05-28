import type {
  BlendMode,
  PenEffect,
  PenFill,
  PenStroke,
  StyledTextSegment,
} from "./styles.js";
import type { VariableDefinition } from "./variables.js";

// --- Page ---

export interface PenPage {
  id: string;
  name: string;
  children: PenNode[];
}

// --- Document Root ---

export interface PenDocument {
  version: string;
  name?: string;
  themes?: Record<string, string[]>;
  variables?: Record<string, VariableDefinition>;
  /** External style/token definitions preserved from design tools. */
  styleDefinitions?: Record<string, PenStyleDefinition>;
  pages?: PenPage[];
  activePageId?: string;
  children: PenNode[];
  /** Cucumber extension: canvas-scoped assets (images, videos) */
  assets?: Record<
    string,
    {
      id: string;
      url: string;
      mimeType: string;
      name?: string;
      width?: number;
      height?: number;
      source?: string;
    }
  >;
}

// --- Node Types ---

export type PenNodeType =
  | "frame"
  | "group"
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "path"
  | "text"
  | "image"
  | "icon_font"
  | "ref"
  | "videoEmbed";

export type SizingBehavior = number | "fit_content" | "fill_container" | string;

export interface PenTransformMatrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface PenExternalStyleRef {
  source: "figma" | string;
  id: string;
}

export interface PenNodeStyleRefs {
  fill?: PenExternalStyleRef;
  stroke?: PenExternalStyleRef;
  text?: PenExternalStyleRef;
  effect?: PenExternalStyleRef;
}

export interface PenStyleDefinition {
  source: "figma" | string;
  id: string;
  name?: string;
  type: "fill" | "text" | "effect";
  fill?: PenFill[];
  strokeFill?: PenFill[];
  text?: Partial<
    Pick<
      TextNode,
      | "fontFamily"
      | "fontPostScriptName"
      | "fontSize"
      | "fontWeight"
      | "fontStyle"
      | "letterSpacing"
      | "lineHeight"
      | "paragraphSpacing"
      | "listStyle"
      | "indent"
      | "hangingIndent"
      | "baselineShift"
      | "openTypeFeatures"
      | "fontFallback"
      | "textAlign"
      | "textAlignVertical"
      | "underline"
      | "strikethrough"
      | "textCase"
      | "textGrowth"
    >
  >;
  effects?: PenEffect[];
  variableRefs?: Record<string, unknown>;
}

export interface PenComponentRef {
  source: "figma" | string;
  type: "component" | "instance" | "variant";
  id?: string;
  key?: string;
  componentId?: string;
  variantProperties?: Record<string, string | number | boolean>;
  componentProperties?: Record<string, unknown>;
  propertyAssignments?: Record<string, unknown>;
  overrideCount?: number;
  overridePaths?: string[];
  overrides?: PenComponentOverrideRef[];
}

export interface PenComponentOverrideRef {
  source: "figma" | string;
  path?: string;
  pathIds?: string[];
  targetId?: string;
  properties: string[];
  values?: Record<string, unknown>;
}

export interface PenAutoLayoutRef {
  source: "figma" | string;
  layout?: "horizontal" | "vertical";
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?: "start" | "center" | "end" | "space_between" | "baseline";
  alignItems?:
    | "start"
    | "center"
    | "end"
    | "space_between"
    | "baseline"
    | "stretch";
  widthMode?: "fixed" | "fit_content" | "fill_container";
  heightMode?: "fixed" | "fit_content" | "fill_container";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch" | "baseline";
  positioning?: "auto" | "absolute";
  grow?: number;
  clipContent?: boolean;
}

// ---------------------------------------------------------------------------
// Cucumber Container / Agent Types (stored as PenNode metadata)
// ---------------------------------------------------------------------------

export type ContainerRole = "visual" | "task" | "context" | "dataflow";
export type InheritPolicy = "merge" | "override" | "block";

export interface ContextSlots {
  style?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  rules?: string[];
  constraints?: Record<string, unknown>;
}

export interface IOPort {
  id: string;
  direction: "input" | "output";
  dataType: "image" | "text" | "json" | "reference" | "prompt";
  schema?: unknown;
  label?: string;
}

export interface AgentBinding {
  agentId?: string;
  agentType?: "designer" | "critic" | "composer" | string;
  role?: "designer" | "developer" | "reviewer" | "assistant";
  color?: string;
  name?: string;
  status?: "idle" | "thinking" | "running" | "blocked" | "completed" | "error";
  permissions?: ("read" | "write" | "spawn")[];
  assignedAt?: number;
  toolCallId?: string;
  toolName?: string;
  createdAt?: number;
}

export interface ContainerPermissions {
  owner?: string;
  canRead: string[];
  canWrite: string[];
  isolationLevel: "strict" | "collaborative" | "open";
}

// --- Base ---

export interface PenNodeBase {
  id: string;
  type: PenNodeType;
  name?: string;
  role?: string; // semantic role for AI generation ("button", "card", "heading", etc.)
  explain?: string; // explanatory semantic layer for the AI consumer view
  x?: number;
  y?: number;
  rotation?: number;
  /** Full affine transform preserved from design tools such as Figma. */
  transform?: PenTransformMatrix;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  blendMode?: BlendMode;
  opacity?: number | string; // number or $variable
  enabled?: boolean | string;
  visible?: boolean; // default true
  locked?: boolean; // default false
  flipX?: boolean;
  flipY?: boolean;
  mask?: {
    enabled?: boolean;
    type?: "alpha" | "vector";
    sourceNodeId?: string;
    shouldBreakMaskChain?: boolean;
  };
  /** External style references preserved for editable imports after values are inlined. */
  styleRefs?: PenNodeStyleRefs;
  /** External component/instance identity preserved for editable imports. */
  componentRef?: PenComponentRef;
  /** External auto-layout metadata preserved for editable imports and reflow. */
  layoutRef?: PenAutoLayoutRef;
  /** Raw variable binding references from design tools, kept for later token reconciliation. */
  variableRefs?: Record<string, unknown>;
  /** Import/runtime metadata. Kept loosely typed because sources differ. */
  meta?: Record<string, unknown>;
  theme?: Record<string, string>;

  // Cucumber agent / container extensions
  containerRole?: ContainerRole[];
  contextSlots?: ContextSlots;
  inheritPolicy?: InheritPolicy;
  agentBinding?: AgentBinding;
  permissions?: ContainerPermissions;
  ioPorts?: IOPort[];
  createdByAgentId?: string;
  runId?: string;
  sessionId?: string;
}

// --- Padding ---

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// --- Container (shared layout props) ---

export interface ContainerProps {
  width?: SizingBehavior;
  height?: SizingBehavior;
  layout?: "none" | "vertical" | "horizontal";
  gap?: number | string;
  padding?:
    | number
    | [number, number]
    | [number, number, number, number]
    | string;
  justifyContent?:
    | "start"
    | "center"
    | "end"
    | "space_between"
    | "space_around";
  alignItems?: "start" | "center" | "end" | "stretch";
  clipContent?: boolean;
  cornerSmoothing?: number;
  isolated?: boolean;
  children?: PenNode[];
  cornerRadius?: number | [number, number, number, number];
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

// --- Concrete Nodes ---

export interface FrameNode extends PenNodeBase, ContainerProps {
  type: "frame";
  reusable?: boolean;
  slot?: string[];
}

export interface GroupNode extends PenNodeBase, ContainerProps {
  type: "group";
}

export interface RectangleNode extends PenNodeBase, ContainerProps {
  type: "rectangle";
}

export interface EllipseNode extends PenNodeBase {
  type: "ellipse";
  width?: SizingBehavior;
  height?: SizingBehavior;
  cornerRadius?: number;
  innerRadius?: number;
  startAngle?: number;
  sweepAngle?: number;
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface LineNode extends PenNodeBase {
  type: "line";
  x2?: number;
  y2?: number;
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface PolygonNode extends PenNodeBase {
  type: "polygon";
  polygonCount: number;
  polygonKind?: "polygon" | "star";
  innerRadius?: number;
  startAngle?: number;
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

export type PenPathPointType = "corner" | "mirrored" | "independent";

export interface PenPathAnchor {
  x: number;
  y: number;
  handleIn: PenPathHandle | null;
  handleOut: PenPathHandle | null;
  pointType?: PenPathPointType;
}

export interface PathNode extends PenNodeBase {
  type: "path";
  iconId?: string; // Iconify icon ID, e.g. "lucide:home"
  d: string;
  anchors?: PenPathAnchor[];
  closed?: boolean;
  fillRule?: "nonzero" | "evenodd";
  width?: SizingBehavior;
  height?: SizingBehavior;
  fill?: PenFill[];
  stroke?: PenStroke;
  effects?: PenEffect[];
}

export interface TextNode extends PenNodeBase {
  type: "text";
  width?: SizingBehavior;
  height?: SizingBehavior;
  content: string | StyledTextSegment[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  fontPostScriptName?: string;
  letterSpacing?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
  listStyle?: "none" | "ordered" | "unordered";
  indent?: number;
  hangingIndent?: number;
  baselineShift?: number;
  textCase?: "original" | "upper" | "lower" | "title";
  openTypeFeatures?: Record<string, boolean | number>;
  fontFallback?: string[];
  textAlign?: "left" | "center" | "right" | "justify";
  textAlignVertical?: "top" | "middle" | "bottom";
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
  underline?: boolean;
  strikethrough?: boolean;
  fill?: PenFill[];
  effects?: PenEffect[];
}

export type ImageFitMode = "fill" | "fit" | "crop" | "tile" | "stretch";

export interface ImageNode extends PenNodeBase {
  type: "image";
  src: string;
  objectFit?: ImageFitMode;
  width?: SizingBehavior;
  height?: SizingBehavior;
  cornerRadius?: number | [number, number, number, number];
  effects?: PenEffect[];
  exposure?: number; // -100 to 100
  contrast?: number; // -100 to 100
  saturation?: number; // -100 to 100
  temperature?: number; // -100 to 100
  tint?: number; // -100 to 100
  highlights?: number; // -100 to 100
  shadows?: number; // -100 to 100
  imagePrompt?: string; // Descriptive prompt for AI image generation
  imageSearchQuery?: string; // Short keywords for image search
}

export interface IconFontNode extends PenNodeBase {
  type: "icon_font";
  iconFontName: string;
  iconFontFamily?: string;
  width?: SizingBehavior;
  height?: SizingBehavior;
  fill?: PenFill[];
  stroke?: PenStroke;
}

export interface RefNode extends PenNodeBase {
  type: "ref";
  ref: string;
  descendants?: Record<string, Partial<PenNode>>;
  children?: PenNode[];
}

export interface VideoEmbedNode extends PenNodeBase {
  type: "videoEmbed";
  src: string;
  poster?: string;
  mimeType?: string;
  durationSeconds?: number;
}

// --- Union ---

export type PenNode =
  | FrameNode
  | GroupNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | PolygonNode
  | PathNode
  | TextNode
  | ImageNode
  | IconFontNode
  | RefNode
  | VideoEmbedNode;
