export const CUCUMBER_CANVAS_SCHEMA_VERSION = "cucumber-canvas-v1" as const;

export type CanvasNodeType =
  | "container"
  | "image"
  | "text"
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "icon"
  | "line"
  | "arrow"
  | "videoEmbed"
  | "group";

export type ContainerRole = "visual" | "task" | "context" | "dataflow";
export type InheritPolicy = "merge" | "override" | "block";
export type AgentPermission = "read" | "write" | "spawn";

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
  backgroundColor: string;
}

export interface ContextSlots {
  style?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  rules?: string[];
  constraints?: Record<string, unknown>;
}

export type CanvasImportSource = "svg-import" | "figma-paste";

export type CanvasImportWarningCode =
  | "unsupported_tag"
  | "partial_fidelity"
  | "layout_degraded"
  | "component_metadata_dropped"
  | "effects_dropped";

export interface CanvasImportedNodeMeta extends Record<string, unknown> {
  source: CanvasImportSource;
  originNodeType?: string;
  importSessionId?: string;
  importSourceLabel?: string;
  originNodeId?: string;
  figmaNodeType?: string;
  degradationHints?: string[];
  warningCount?: number;
}

export interface AgentBinding {
  agentId?: string;
  agentType?: "designer" | "critic" | "composer" | string;
  role?: "designer" | "developer" | "reviewer" | "assistant";
  name?: string;
  color?: string;
  status?: "idle" | "thinking" | "running" | "blocked" | "completed" | "error";
  permissions?: AgentPermission[];
  assignedAt?: number;
}

export interface ContainerPermissions {
  owner?: string;
  canRead: string[];
  canWrite: string[];
  isolationLevel: "strict" | "collaborative" | "open";
}

export interface CanvasNodeBase {
  id: string;
  type: CanvasNodeType;
  parentId: string | null;
  bounds: CanvasBounds;
  title?: string;
  locked?: boolean;
  visible?: boolean;
  createdByAgentId?: string;
  runId?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface ContainerNode extends CanvasNodeBase {
  type: "container";
  role: ContainerRole[];
  childrenOrder: string[];
  contextSlots: ContextSlots;
  inheritPolicy: InheritPolicy;
  agentBinding?: AgentBinding;
  permissions?: ContainerPermissions;
  style?: {
    fill?: string;
    stroke?: string;
    opacity?: number;
  };
}

export interface ImageNode extends CanvasNodeBase {
  type: "image";
  assetId: string;
  src: string;
  alt?: string;
}

export interface TextNode extends CanvasNodeBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily?: string;
  color?: string;
  align?: "left" | "center" | "right";
}

export interface RectNode extends CanvasNodeBase {
  type: "rect";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface EllipseNode extends CanvasNodeBase {
  type: "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface PolygonNode extends CanvasNodeBase {
  type: "polygon";
  points: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface PathNode extends CanvasNodeBase {
  type: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface IconNode extends CanvasNodeBase {
  type: "icon";
  icon: "sparkles" | "star" | "check" | string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export type ConnectorAnchor = "tl" | "tr" | "bl" | "br";

export interface ConnectorNode extends CanvasNodeBase {
  type: "line" | "arrow";
  stroke?: string;
  strokeWidth?: number;
  startAnchor?: ConnectorAnchor;
  endAnchor?: ConnectorAnchor;
}

export interface VideoEmbedNode extends CanvasNodeBase {
  type: "videoEmbed";
  src: string;
  poster?: string;
  mimeType?: string;
  durationSeconds?: number;
}

export interface GroupNode extends CanvasNodeBase {
  type: "group";
  childrenOrder: string[];
}

export type CanvasNode =
  | ContainerNode
  | ImageNode
  | TextNode
  | RectNode
  | EllipseNode
  | PolygonNode
  | PathNode
  | IconNode
  | ConnectorNode
  | VideoEmbedNode
  | GroupNode;

export interface CanvasAsset {
  id: string;
  url: string;
  mimeType: string;
  name?: string;
  width?: number;
  height?: number;
  source?: "upload" | "generated" | "canvas-ref";
}

export interface CucumberCanvasDocument {
  schemaVersion: typeof CUCUMBER_CANVAS_SCHEMA_VERSION;
  nodes: Record<string, CanvasNode>;
  rootNodeIds: string[];
  assets: Record<string, CanvasAsset>;
  viewport: CanvasViewport;
  selection?: string[];
  updatedAt?: string;
}

export interface NodeSummary {
  id: string;
  type: CanvasNodeType;
  title?: string;
  bounds: CanvasBounds;
}

export interface AgentContext {
  agentId: string;
  containerId: string;
  containerPath: string[];
  effectiveContext: ContextSlots;
  visibleNodes: NodeSummary[];
  permissions: AgentPermission[];
  siblings: { containerId: string; agentId?: string; status?: string }[];
}

export function isCanvasImportSource(value: unknown): value is CanvasImportSource {
  return value === "svg-import" || value === "figma-paste";
}

export function getCanvasImportedNodeMeta(
  meta: Record<string, unknown> | undefined,
): CanvasImportedNodeMeta | null {
  if (!meta || !isCanvasImportSource(meta.source)) {
    return null;
  }
  return meta as CanvasImportedNodeMeta;
}

export type CanvasOperation =
  | {
      type: "insertNode";
      node: CanvasNode;
      containerId?: string | null;
      agentId?: string;
    }
  | {
      type: "updateNode";
      nodeId: string;
      updates: Partial<CanvasNode>;
      agentId?: string;
      containerId?: string | null;
    }
  | {
      type: "deleteNode";
      nodeId: string;
      agentId?: string;
      containerId?: string | null;
    }
  | {
      type: "setSelection";
      nodeIds: string[];
    }
  | {
      type: "reorderNode";
      nodeId: string;
      direction?: "forward" | "backward" | "front" | "back";
      targetParentId?: string | null;
      targetIndex?: number;
    }
  | {
      type: "groupNodes";
      groupId: string;
      nodeIds: string[];
      title?: string;
    }
  | {
      type: "ungroupNode";
      groupId: string;
    }
  | {
      type: "alignNodes";
      nodeIds: string[];
      alignment: "left" | "center" | "right" | "top" | "middle" | "bottom";
    }
  | {
      type: "bindAgent";
      containerId: string;
      binding: AgentBinding;
    };
