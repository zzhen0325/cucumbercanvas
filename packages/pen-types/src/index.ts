// Styles
export type {
  BlendMode,
  SolidFill,
  GradientStop,
  LinearGradientFill,
  RadialGradientFill,
  ImageOriginalSize,
  ImageTransform,
  ImageFill,
  PenFill,
  PenStroke,
  BlurEffect,
  ShadowEffect,
  PenEffect,
  StyledTextSegment,
} from './styles.js';

// Variables
export type { VariableDefinition, VariableValue, ThemedValue } from './variables.js';

// Canvas
export type { ToolType, ViewportState, SelectionState, CanvasInteraction } from './canvas.js';

// Document model
export type {
  PenPage,
  PenDocument,
  PenNodeType,
  SizingBehavior,
  Padding,
  // Container / Agent types
  ContainerRole,
  InheritPolicy,
  ContextSlots,
  IOPort,
  AgentBinding,
  ContainerPermissions,
  // Node base
  PenNodeBase,
  ContainerProps,
  // Concrete nodes
  FrameNode,
  GroupNode,
  RectangleNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  PenPathHandle,
  PenPathAnchor,
  PenPathPointType,
  PathNode,
  TextNode,
  ImageFitMode,
  ImageNode,
  IconFontNode,
  RefNode,
  VideoEmbedNode,
  PenNode,
} from './pen.js';

// Engine
export type {
  DesignEngineOptions,
  DesignEngineEvents,
  CodePlatform,
  CodeResult,
  TextEditState,
  AgentIndicatorEntry,
  AgentFrameEntry,
  InsertionIndicator,
  ContainerHighlight,
  IconLookupFn,
} from './engine.js';
