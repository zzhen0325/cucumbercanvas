import type { ContainerNode, IOPort, AgentBinding, ContextSlots, ContainerRole, InheritPolicy } from '../types.js';

export interface ContainerTemplatePort {
  direction: IOPort['direction'];
  dataType: IOPort['dataType'];
  label?: string;
  schema?: unknown;
}

export interface ContainerTemplateBinding {
  agentType?: AgentBinding['agentType'];
  role?: AgentBinding['role'];
  permissions?: AgentBinding['permissions'];
}

export interface ContainerTemplateShader {
  type: 'glow' | 'glassmorphism' | 'particle' | 'gradient';
  params?: Record<string, unknown>;
}

export interface ContainerTemplateNode {
  refId: string;
  role: ContainerRole[];
  label: string;
  relativePosition: { x: number; y: number; width: number; height: number };
  contextSlots?: ContextSlots;
  inheritPolicy?: InheritPolicy;
  ioPorts: ContainerTemplatePort[];
  agentBinding?: ContainerTemplateBinding;
  shader?: ContainerTemplateShader;
  children?: ContainerTemplateNode[];
}

export interface ContainerTemplateEdge {
  sourceRef: string;
  sourcePortIndex: number;
  targetRef: string;
  targetPortIndex: number;
}

export interface ContainerTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon?: string;
  tags?: string[];
  nodes: ContainerTemplateNode[];
  edges: ContainerTemplateEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface TemplateInstance {
  templateId: string;
  containerIds: string[];
  edgeIds: string[];
  refMap: Map<string, string>;
}
