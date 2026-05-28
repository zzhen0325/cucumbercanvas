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
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface FigmaColor {
  r: number;
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

export interface FigmaEffect {
  type?: "INNER_SHADOW" | "DROP_SHADOW" | "FOREGROUND_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  radius?: number;
  spread?: number;
  opacity?: number;
  offset?: { x?: number; y?: number };
  color?: FigmaColor;
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

export interface FigmaGuidPath {
  guids: FigmaGUID[];
}

export interface FigmaDerivedTextData {
  characters?: string;
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
  | "SYMBOL"
  | "INSTANCE"
  | "SECTION";

export interface FigmaDerivedSymbolDataEntry {
  guidPath?: FigmaGuidPath;
  size?: FigmaVector;
  transform?: FigmaMatrix;
  fontSize?: number;
  derivedTextData?: FigmaDerivedTextData;
}

export interface FigmaNodeChange {
  guid?: FigmaGUID;
  parentIndex?: FigmaParentIndex;
  type?: FigmaNodeType;
  phase?: string;
  booleanOperation?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  size?: FigmaVector;
  transform?: FigmaMatrix;
  opacity?: number;
  blendMode?: string;
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
  borderStrokeWeightsIndependent?: boolean;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  effects?: FigmaEffect[];
  cornerRadius?: number;
  cornerSmoothing?: number;
  fontSize?: number;
  fontName?: FigmaFontName;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  lineHeight?: FigmaNumber;
  letterSpacing?: FigmaNumber;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  arcData?: FigmaArcData;
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
  frameMaskDisabled?: boolean;
  isMask?: boolean;
  maskType?: "ALPHA" | "VECTOR";
  shouldBreakMaskChain?: boolean;
  vectorData?: FigmaVectorData;
  fillGeometry?: FigmaPath[];
  strokeGeometry?: FigmaPath[];
  guidPath?: FigmaGuidPath;
  symbolData?: {
    symbolID?: FigmaGUID;
    symbolOverrides?: FigmaNodeChange[];
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

export interface FigmaClipboardData {
  meta: Record<string, unknown>;
  buffer: ArrayBuffer;
}

export interface FigmaTreeNode {
  figma: FigmaNodeChange;
  children: FigmaTreeNode[];
}
