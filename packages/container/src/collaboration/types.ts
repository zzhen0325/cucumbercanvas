import type { AgentBinding, ContainerNode, IOPort, ContextSlots } from '../types.js';

export type AgentCollabMessageType = 'request' | 'response' | 'broadcast';

export type AgentStatus = 'idle' | 'thinking' | 'running' | 'blocked' | 'completed' | 'error';

export interface AgentCollabMessage {
  id: string;
  type: AgentCollabMessageType;
  from: string;
  to: string | '*';
  topic: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface ConflictRecord {
  id: string;
  containerId: string;
  agentId: string;
  operation: OperationEntry;
  detectedAt: number;
  resolved: boolean;
  resolution?: 'accept' | 'reject' | 'merge';
}

export interface OperationEntry {
  id: string;
  agentId: string;
  containerId: string;
  type: 'update' | 'add' | 'remove' | 'move';
  target: string;
  payload: unknown;
  timestamp: number;
  version: number;
}

export interface AgentCollabSessionState {
  id: string;
  participants: string[];
  messages: AgentCollabMessage[];
  conflicts: ConflictRecord[];
  startedAt: number;
  status: 'active' | 'paused' | 'completed';
}

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  executionTimeout: number;
  conflictStrategy: 'optimistic-lock' | 'queue';
}

export interface ContainerLock {
  containerId: string;
  agentId: string;
  version: number;
  acquiredAt: number;
}
