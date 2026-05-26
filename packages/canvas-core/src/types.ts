// Re-export the canonical document model from pen-types
export type {
  PenPage,
  PenDocument,
  PenNodeType,
  SizingBehavior,
  ContainerRole,
  InheritPolicy,
  ContextSlots,
  IOPort,
  AgentBinding,
  ContainerPermissions,
  PenNodeBase,
  ContainerProps,
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
} from '@cucumber/pen-types';

// Re-export style types
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

import type { AgentBinding, PenDocument, PenNode } from '@cucumber/pen-types';
import type { PenPage } from '@cucumber/pen-types';

// ---------------------------------------------------------------------------
// Backward-compatible type aliases (pre-Phase1 consumers)
// ---------------------------------------------------------------------------

/** @deprecated Use PenDocument directly */
export type CucumberCanvasDocument = PenDocument;

export type CanvasPage = PenPage;

export interface PageAwareCanvasDocument extends PenDocument {
  pages: CanvasPage[];
  activePageId: string;
  viewport: CanvasViewport;
}

export type CanvasDocumentState = PageAwareCanvasDocument;

/** @deprecated Use PenNode directly */
export type CanvasNode = PenNode;

/** @deprecated Use PenNode (FrameNode or GroupNode) */
export type ContainerNode = PenNode;

/** @deprecated Use PenNode */
export type ConnectorNode = PenNode;

// ---------------------------------------------------------------------------
// Canvas-level types (not in pen-types)
// ---------------------------------------------------------------------------

/** Bounding box for spatial queries and selection */
export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/** Viewport state persisted with the document */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
  backgroundColor: string;
}

/** Asset reference stored alongside the document */
export interface CanvasAsset {
  id: string;
  url: string;
  mimeType: string;
  name?: string;
  width?: number;
  height?: number;
  source?: 'upload' | 'generated' | 'canvas-ref';
}

/** Lightweight node summary for agent context */
export interface NodeSummary {
  id: string;
  type: string;
  title?: string;
  bounds: CanvasBounds;
}

/** Agent context built from container hierarchy */
export interface AgentContext {
  agentId: string;
  containerId: string;
  containerPath: string[];
  effectiveContext: import('@cucumber/pen-types').ContextSlots;
  visibleNodes: NodeSummary[];
  permissions: ('read' | 'write' | 'spawn')[];
  siblings: { containerId: string; agentId?: string; status?: string }[];
}

// ---------------------------------------------------------------------------
// Canvas Operations (PenDocument-based)
// ---------------------------------------------------------------------------

export interface PageAwareCanvasOperationMetadata {
  activePageId?: string | null;
}

export type PageAwareCanvasOperation<Operation extends object> = Operation &
  PageAwareCanvasOperationMetadata;

export type CanvasOperation =
  | PageAwareCanvasOperation<{
      type: 'insertNode';
      node: PenNode;
      parentId?: string | null;
      /** @deprecated Use parentId */
      containerId?: string | null;
      index?: number;
      agentId?: string;
    }>
  | PageAwareCanvasOperation<{
      type: 'updateNode';
      nodeId: string;
      updates: Partial<PenNode>;
      agentId?: string;
    }>
  | PageAwareCanvasOperation<{
      type: 'deleteNode';
      nodeId: string;
      agentId?: string;
    }>
  | PageAwareCanvasOperation<{
      type: 'setSelection';
      nodeIds: string[];
    }>
  | PageAwareCanvasOperation<{
      type: 'moveNode';
      nodeId: string;
      newParentId?: string | null;
      index?: number;
    }>
  | PageAwareCanvasOperation<{
      type: 'groupNodes';
      groupId: string;
      nodeIds: string[];
      title?: string;
    }>
  | PageAwareCanvasOperation<{
      type: 'ungroupNode';
      groupId: string;
    }>
  | PageAwareCanvasOperation<{
      type: 'alignNodes';
      nodeIds: string[];
      alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
    }>
  | PageAwareCanvasOperation<{
      type: 'reorderNode';
      nodeId: string;
      direction?: 'forward' | 'backward' | 'front' | 'back';
      targetParentId?: string | null;
      targetIndex?: number;
    }>
  | PageAwareCanvasOperation<{
      type: 'bindAgent';
      nodeId?: string;
      binding: AgentBinding;
      containerId?: string;
    }>
  | {
      type: 'createDataFlowEdge';
      edgeId: string;
      sourceNodeId: string;
      sourcePortId: string;
      targetNodeId: string;
      targetPortId: string;
    }
  | {
      type: 'removeDataFlowEdge';
      edgeId: string;
    };

// ---------------------------------------------------------------------------
// Import metadata (Figma/SVG)
// ---------------------------------------------------------------------------

export type CanvasImportSource = 'svg-import' | 'figma-paste' | 'image-paste';

export type CanvasImportWarningCode =
  | 'unsupported_tag'
  | 'partial_fidelity'
  | 'layout_degraded'
  | 'component_metadata_dropped'
  | 'effects_dropped';

export type CanvasImportedLayoutMode = 'horizontal' | 'vertical';
export type CanvasImportedLayoutAlign = 'start' | 'center' | 'end' | 'space_between' | 'baseline';
export type CanvasImportedSizingMode = 'fixed' | 'fit_content' | 'fill_container';
export type CanvasImportedPositioningMode = 'auto' | 'absolute';
export type CanvasImportedPadding = number | [number, number] | [number, number, number, number];

export interface CanvasImportedAutoLayoutMeta {
  layout?: CanvasImportedLayoutMode;
  gap?: number;
  padding?: CanvasImportedPadding;
  justifyContent?: CanvasImportedLayoutAlign;
  alignItems?: CanvasImportedLayoutAlign;
  widthMode?: CanvasImportedSizingMode;
  heightMode?: CanvasImportedSizingMode;
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  positioning?: CanvasImportedPositioningMode;
  grow?: number;
  clipContent?: boolean;
}

export interface CanvasImportedNodeMeta extends Record<string, unknown> {
  source: CanvasImportSource;
  originNodeType?: string;
  importSessionId?: string;
  importSourceLabel?: string;
  originNodeId?: string;
  figmaNodeType?: string;
  degradationHints?: string[];
  warningCount?: number;
  autoLayout?: CanvasImportedAutoLayoutMeta;
}

// ---------------------------------------------------------------------------
// DataFlow types
// ---------------------------------------------------------------------------

export interface DataFlowEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  status?: 'idle' | 'flowing' | 'error';
  transform?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isCanvasImportSource(value: unknown): value is CanvasImportSource {
  return value === 'svg-import' || value === 'figma-paste' || value === 'image-paste';
}

export function getCanvasImportedNodeMeta(
  meta: Record<string, unknown> | undefined,
): CanvasImportedNodeMeta | null {
  if (!meta || !isCanvasImportSource(meta.source)) {
    return null;
  }
  return meta as CanvasImportedNodeMeta;
}
