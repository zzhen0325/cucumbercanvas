export const CUCUMBER_CANVAS_SCHEMA_VERSION = "cucumber-canvas-v1" as const;

export type CanvasNodeType =
  | "container"
  | "image"
  | "text"
  | "rect"
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
      type: "bindAgent";
      containerId: string;
      binding: AgentBinding;
    };
