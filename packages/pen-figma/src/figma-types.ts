// @ts-nocheck
// Figma .fig binary file internal format type definitions
// Decoded via kiwi-schema from the binary format

export interface FigmaGUID {
  sessionID: number;
  localID: number;
}

export interface FigmaParentIndex {
  guid: FigmaGUID;
  position: string;
}

export interface FigmaVector {
  x: number;
  y: number;
}

export interface FigmaMatrix {
  m00: number;
  m01: number;
  m02: number; // translateX
  m10: number;
  m11: number;
  m12: number; // translateY
}

export interface FigmaColor {
  r: number; // 0.0-1.0
  g: number;
  b: number;
  a: number;
}

export interface FigmaColorStop {
  color: FigmaColor;
  position: number;
}

export type FigmaPaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI";

export interface FigmaImage {
  hash?: Uint8Array;
  name?: string;
  dataBlob?: number;
}

export interface FigmaPaint {
  type?: FigmaPaintType;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  stops?: FigmaColorStop[];
  transform?: FigmaMatrix;
  image?: FigmaImage;
  imageScaleMode?: "STRETCH" | "FIT" | "FILL" | "TILE" | "CROP";
  originalImageWidth?: number;
  originalImageHeight?: number;
}

export type FigmaEffectType =
  | "INNER_SHADOW"
  | "DROP_SHADOW"
  | "FOREGROUND_BLUR"
  | "BACKGROUND_BLUR";

export interface FigmaEffect {
  type?: FigmaEffectType;
  color?: FigmaColor;
  offset?: FigmaVector;
  radius?: number;
  spread?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

export interface FigmaFontName {
  family?: string;
  style?: string;
  postscript?: string;
}

export interface FigmaFontFallback {
  family?: string;
  style?: string;
  postscript?: string;
}

export interface FigmaNumber {
  value?: number;
  units?: "RAW" | "PIXELS" | "PERCENT";
}

export interface FigmaTextData {
  characters?: string;
  characterStyleIDs?: number[];
  styleOverrideTable?: FigmaNodeChange[];
}

export interface FigmaPath {
  windingRule?: "NONZERO" | "ODD";
  commandsBlob?: number;
  styleID?: number;
}

export interface FigmaVectorData {
  vectorNetworkBlob?: number;
  normalizedSize?: FigmaVector;
}

export interface FigmaArcData {
  startingAngle?: number;
  endingAngle?: number;
  innerRadius?: number;
}

export interface FigmaGuidPath {
  guids: FigmaGUID[];
}

/** Per-child override stored on an INSTANCE's symbolData.
 *  Extends FigmaNodeChange to support all overridable node properties
 *  (size, opacity, visible, strokes, layout, corner radii, etc.). */
export interface FigmaSymbolOverride
  extends Omit<
    FigmaNodeChange,
    | "guid"
    | "parentIndex"
    | "type"
    | "phase"
    | "symbolData"
    | "derivedSymbolData"
    | "componentKey"
  > {
  guidPath?: FigmaGuidPath;
}

/** Pre-computed size/transform for each node inside an INSTANCE. */
export interface FigmaDerivedSymbolDataEntry {
  guidPath?: FigmaGuidPath;
  size?: FigmaVector;
  transform?: FigmaMatrix;
  fontSize?: number;
  derivedTextData?: FigmaTextData;
}

export type FigmaNodeType =
  | "NONE"
  | "DOCUMENT"
  | "CANVAS"
  | "GROUP"
  | "FRAME"
  | "BOOLEAN_OPERATION"
  | "VECTOR"
  | "STAR"
  | "LINE"
  | "ELLIPSE"
  | "RECTANGLE"
  | "ROUNDED_RECTANGLE"
  | "REGULAR_POLYGON"
  | "TEXT"
  | "SLICE"
  | "SYMBOL" // = COMPONENT in REST API
  | "INSTANCE"
  | "STICKY"
  | "SHAPE_WITH_TEXT"
  | "CONNECTOR"
  | "CODE_BLOCK"
  | "WIDGET"
  | "STAMP"
  | "MEDIA"
  | "HIGHLIGHT"
  | "SECTION"
  | "SECTION_OVERLAY"
  | "WASHI_TAPE";

export interface FigmaNodeChange {
  guid?: FigmaGUID;
  parentIndex?: FigmaParentIndex;
  type?: FigmaNodeType;
  phase?: string;
  booleanOperation?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;

  // Geometry
  size?: FigmaVector;
  transform?: FigmaMatrix;
  pointCount?: number;
  polygonCount?: number;
  innerRadius?: number;
  innerRadiusRatio?: number;
  starInnerRadius?: number;
  starInnerScale?: number;

  // Appearance
  opacity?: number;
  blendMode?: string;

  // Fills & Strokes
  fillPaints?: FigmaPaint[];
  backgroundPaints?: FigmaPaint[];
  strokePaints?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: "CENTER" | "INSIDE" | "OUTSIDE";
  strokeCap?: string;
  strokeJoin?: "MITER" | "BEVEL" | "ROUND";
  strokeMiterLimit?: number;
  dashPattern?: number[];
  dashOffset?: number;

  // Individual border weights
  borderStrokeWeightsIndependent?: boolean;
  borderTopWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderRightWeight?: number;

  // Effects
  effects?: FigmaEffect[];

  // Corner radius
  cornerRadius?: number;
  cornerSmoothing?: number;
  rectangleCornerRadiiIndependent?: boolean;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;

  // Text
  fontSize?: number;
  fontName?: FigmaFontName;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  lineHeight?: FigmaNumber;
  letterSpacing?: FigmaNumber;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  hangingIndent?: number;
  baselineShift?: number;
  listStyle?: "NONE" | "ORDERED" | "UNORDERED";
  listType?: "NONE" | "ORDERED" | "UNORDERED";
  hangingList?: { type?: "NONE" | "ORDERED" | "UNORDERED" };
  openTypeFeatures?: Record<string, boolean | number>;
  opentypeFlags?: Record<string, boolean | number>;
  fontFallbacks?: FigmaFontFallback[];
  fallbackFontNames?: FigmaFontFallback[];
  textData?: FigmaTextData;

  // Auto-layout (stack)
  stackMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  stackSpacing?: number;
  stackPadding?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimarySizing?: string;
  stackCounterSizing?: string;
  stackPrimaryAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_EVENLY";
  stackCounterAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  stackChildPrimaryGrow?: number;
  stackChildAlignSelf?: string;
  stackPositioning?: "AUTO" | "ABSOLUTE";

  // Masking / clipping
  frameMaskDisabled?: boolean;
  isMask?: boolean;
  maskType?: "ALPHA" | "VECTOR";
  shouldBreakMaskChain?: boolean;

  // Vector/Path
  vectorData?: FigmaVectorData;
  fillGeometry?: FigmaPath[];
  strokeGeometry?: FigmaPath[];

  // Ellipse arc
  arcData?: FigmaArcData;

  // Component/Instance
  symbolData?: {
    symbolID?: FigmaGUID;
    symbolOverrides?: FigmaSymbolOverride[];
  };
  overriddenSymbolID?: FigmaGUID;
  componentKey?: string;
  variantProperties?: Record<string, string | number | boolean>;
  componentProperties?: Record<string, unknown>;
  componentPropertyDefinitions?: Record<string, unknown>;
  componentPropAssignments?: Record<string, unknown>;
  derivedSymbolData?: FigmaDerivedSymbolDataEntry[];
  styleType?: "FILL" | "TEXT" | "EFFECT";
  styleIdForFill?: { guid?: FigmaGUID };
  styleIdForStrokeFill?: { guid?: FigmaGUID };
  styleIdForText?: { guid?: FigmaGUID };
  styleIdForEffect?: { guid?: FigmaGUID };
  variableConsumptionMap?: Record<string, unknown>;
}

export interface FigmaDecodedFile {
  nodeChanges: FigmaNodeChange[];
  blobs: (Uint8Array | string)[];
  imageFiles: Map<string, Uint8Array>;
}

export interface FigmaPage {
  id: string;
  name: string;
  childCount: number;
}

export type FigmaImportLayoutMode = "preserve" | "cucumber";
