import type { ContainerNode, ContainerBounds, ContextSlots, IOPort, AgentBinding, ContainerPermissions } from './types.js';

export interface NodeSummary {
  id: string;
  type: string;
  bounds?: ContainerBounds;
  label?: string;
}

export interface AgentMessage {
  from: string;
  to?: string;
  payload: unknown;
}

export interface PeerRequest {
  type: string;
  payload: unknown;
}

export interface PeerResponse {
  ok: boolean;
  payload: unknown;
}

export interface ContainerEvents {
  'content:change': (nodes: NodeSummary[]) => void;
  'agent:enter': (binding: AgentBinding) => void;
  'agent:leave': (agentId: string) => void;
  'agent:status': (agentId: string, status: AgentBinding['status']) => void;
  'boundary:resize': (newBounds: ContainerBounds) => void;
  'permission:change': (perms: ContainerPermissions) => void;
}

export interface AgentContext {
  agentId: string;
  containerId: string;
  containerPath: string[];
  parent: ContainerNode | null;
  siblings: { containerId: string; agentId?: string; status?: string }[];

  effectiveContext: ContextSlots;
  visibleNodes: NodeSummary[];
  ioPorts: IOPort[];

  permissions: ('read' | 'write' | 'spawn')[];
  canOperate: (nodeId: string) => boolean;

  subscribe: <K extends keyof ContainerEvents>(
    event: K,
    cb: ContainerEvents[K]
  ) => () => void;

  broadcast: (message: AgentMessage) => void;
  requestFromPeer: (agentId: string, req: PeerRequest) => Promise<PeerResponse>;
}
