import { TypedEventEmitter } from '@cucumber/engine';
import type { ContainerManager } from '../container-manager.js';
import type { AgentBinding } from '../types.js';
import type {
  AgentCollabMessage,
  AgentCollabSessionState,
  ConflictRecord,
  OperationEntry,
} from './types.js';

let sessionIdCounter = 0;
function generateSessionId(): string {
  return `collab_${Date.now()}_${++sessionIdCounter}`;
}

let messageIdCounter = 0;
function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

export interface AgentCollabSessionEvents {
  'message:sent': (message: AgentCollabMessage) => void;
  'message:received': (message: AgentCollabMessage) => void;
  'participant:join': (agentId: string) => void;
  'participant:leave': (agentId: string) => void;
  'conflict:detected': (conflict: ConflictRecord) => void;
  'conflict:resolved': (conflictId: string, resolution: ConflictRecord['resolution']) => void;
  'session:status': (status: AgentCollabSessionState['status']) => void;
}

export class AgentCollabSession extends TypedEventEmitter<AgentCollabSessionEvents> {
  private state: AgentCollabSessionState;
  private containerManager: ContainerManager;
  private messageHandlers = new Map<string, (msg: AgentCollabMessage) => void>();

  constructor(containerManager: ContainerManager, participants: string[] = []) {
    super();
    this.containerManager = containerManager;
    this.state = {
      id: generateSessionId(),
      participants: [...participants],
      messages: [],
      conflicts: [],
      startedAt: Date.now(),
      status: 'active',
    };
  }

  get id(): string {
    return this.state.id;
  }

  get participants(): string[] {
    return [...this.state.participants];
  }

  get messages(): AgentCollabMessage[] {
    return [...this.state.messages];
  }

  get conflicts(): ConflictRecord[] {
    return [...this.state.conflicts];
  }

  get status(): AgentCollabSessionState['status'] {
    return this.state.status;
  }

  join(agentId: string): boolean {
    if (this.state.participants.includes(agentId)) return false;
    this.state.participants.push(agentId);
    this.emit('participant:join', agentId);
    return true;
  }

  leave(agentId: string): boolean {
    const idx = this.state.participants.indexOf(agentId);
    if (idx === -1) return false;
    this.state.participants.splice(idx, 1);
    this.emit('participant:leave', agentId);
    return true;
  }

  sendMessage(from: string, to: string | '*', topic: string, payload: unknown, correlationId?: string): AgentCollabMessage {
    const msg: AgentCollabMessage = {
      id: generateMessageId(),
      type: to === '*' ? 'broadcast' : (correlationId ? 'response' : 'request'),
      from,
      to,
      topic,
      payload,
      timestamp: Date.now(),
      correlationId,
    };
    this.state.messages.push(msg);
    this.emit('message:sent', msg);
    this.deliverMessage(msg);
    return msg;
  }

  broadcast(from: string, topic: string, payload: unknown): AgentCollabMessage {
    return this.sendMessage(from, '*', topic, payload);
  }

  respond(from: string, to: string, topic: string, payload: unknown, correlationId: string): AgentCollabMessage {
    return this.sendMessage(from, to, topic, payload, correlationId);
  }

  onMessage(agentId: string, handler: (msg: AgentCollabMessage) => void): () => void {
    this.messageHandlers.set(agentId, handler);
    return () => this.messageHandlers.delete(agentId);
  }

  recordConflict(containerId: string, agentId: string, operation: OperationEntry): ConflictRecord {
    const conflict: ConflictRecord = {
      id: `conflict_${Date.now()}_${this.state.conflicts.length}`,
      containerId,
      agentId,
      operation,
      detectedAt: Date.now(),
      resolved: false,
    };
    this.state.conflicts.push(conflict);
    this.emit('conflict:detected', conflict);
    return conflict;
  }

  resolveConflict(conflictId: string, resolution: ConflictRecord['resolution']): boolean {
    const conflict = this.state.conflicts.find(c => c.id === conflictId);
    if (!conflict || conflict.resolved) return false;
    conflict.resolved = true;
    conflict.resolution = resolution;
    this.emit('conflict:resolved', conflictId, resolution);
    return true;
  }

  getUnresolvedConflicts(): ConflictRecord[] {
    return this.state.conflicts.filter(c => !c.resolved);
  }

  getMessagesForAgent(agentId: string): AgentCollabMessage[] {
    return this.state.messages.filter(
      m => m.to === agentId || m.to === '*' || m.from === agentId
    );
  }

  pause(): void {
    this.state.status = 'paused';
    this.emit('session:status', 'paused');
  }

  resume(): void {
    this.state.status = 'active';
    this.emit('session:status', 'active');
  }

  complete(): void {
    this.state.status = 'completed';
    this.emit('session:status', 'completed');
  }

  serialize(): AgentCollabSessionState {
    return { ...this.state };
  }

  private deliverMessage(msg: AgentCollabMessage): void {
    if (msg.to === '*') {
      for (const [agentId, handler] of this.messageHandlers) {
        if (agentId !== msg.from) {
          handler(msg);
        }
      }
    } else {
      const handler = this.messageHandlers.get(msg.to);
      if (handler) handler(msg);
    }
    this.emit('message:received', msg);
  }
}
