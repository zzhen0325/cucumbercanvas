export type ContainerRole = 'visual' | 'task' | 'context' | 'dataflow';
export type InheritPolicy = 'merge' | 'override' | 'block';

export interface ContainerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
}

export interface ContextSlots {
  style?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  rules?: string[];
  constraints?: Record<string, unknown>;
}

export interface IOPort {
  id: string;
  direction: 'input' | 'output';
  dataType: 'image' | 'text' | 'json' | 'reference' | 'prompt';
  schema?: unknown;
  label?: string;
}

export interface AgentBinding {
  agentId?: string;
  agentType?: 'designer' | 'critic' | 'composer' | string;
  role?: 'designer' | 'developer' | 'reviewer' | 'assistant';
  color?: string;
  name?: string;
  status?: 'idle' | 'thinking' | 'running' | 'blocked' | 'completed';
  permissions?: ('read' | 'write' | 'spawn')[];
  assignedAt?: number;
}

export interface ContainerPermissions {
  owner: string;
  canRead: string[];
  canWrite: string[];
  isolationLevel: 'strict' | 'collaborative' | 'open';
}

export interface ContainerNode {
  id: string;
  type: 'container';
  parentId: string | null;
  role: ContainerRole[];
  bounds: ContainerBounds;
  contextSlots: ContextSlots;
  inheritPolicy: InheritPolicy;
  ioPorts: IOPort[];
  agentBinding?: AgentBinding;
  permissions?: ContainerPermissions;
  style?: { fill?: string; stroke?: string; opacity?: number; label?: string };
  meta?: Record<string, unknown>;
}
