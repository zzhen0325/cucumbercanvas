import { TypedEventEmitter } from '@cucumber/engine';
import type { AgentBinding } from './types.js';

const AGENT_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#FFD93D',
  '#6C5CE7',
  '#A8E6CF',
  '#FF8A5C',
];

const AGENT_NAMES = [
  'Kiki',
  'Mochi',
  'Pixel',
  'Nova',
  'Zuri',
  'Cleo',
  'Boba',
  'Rune',
  'Fern',
  'Echo',
  'Puck',
  'Sage',
];

export interface AgentIdentity {
  agentId: string;
  color: string;
  name: string;
  role?: AgentBinding['role'];
}

export interface AgentRegistryEvents {
  'agent:registered': (identity: AgentIdentity) => void;
  'agent:unregistered': (agentId: string) => void;
  'agent:updated': (identity: AgentIdentity) => void;
}

export class AgentRegistry extends TypedEventEmitter<AgentRegistryEvents> {
  private agents = new Map<string, AgentIdentity>();
  private colorIndex = 0;
  private usedNames = new Set<string>();

  register(agentId: string, options?: { role?: AgentBinding['role']; color?: string; name?: string }): AgentIdentity {
    if (this.agents.has(agentId)) {
      return this.agents.get(agentId)!;
    }

    const color = options?.color ?? this.nextColor();
    const name = options?.name ?? this.nextName();
    const identity: AgentIdentity = { agentId, color, name, role: options?.role };

    this.agents.set(agentId, identity);
    this.usedNames.add(name);
    this.emit('agent:registered', identity);
    return identity;
  }

  unregister(agentId: string): boolean {
    const identity = this.agents.get(agentId);
    if (!identity) return false;

    this.usedNames.delete(identity.name);
    this.agents.delete(agentId);
    this.emit('agent:unregistered', agentId);
    return true;
  }

  getAgent(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentIdentity[] {
    return [...this.agents.values()];
  }

  updateAgent(agentId: string, updates: Partial<Omit<AgentIdentity, 'agentId'>>): boolean {
    const existing = this.agents.get(agentId);
    if (!existing) return false;

    if (updates.name && updates.name !== existing.name) {
      this.usedNames.delete(existing.name);
      this.usedNames.add(updates.name);
    }

    const updated = { ...existing, ...updates };
    this.agents.set(agentId, updated);
    this.emit('agent:updated', updated);
    return true;
  }

  assignIdentities(count: number): AgentIdentity[] {
    const shuffled = [...AGENT_NAMES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
    }

    const identities: AgentIdentity[] = [];
    for (let i = 0; i < count; i++) {
      const agentId = `agent_${Date.now()}_${i}`;
      const identity = this.register(agentId, {
        color: AGENT_COLORS[i % AGENT_COLORS.length]!,
        name: shuffled[i % shuffled.length]!,
      });
      identities.push(identity);
    }
    return identities;
  }

  private nextColor(): string {
    const color = AGENT_COLORS[this.colorIndex % AGENT_COLORS.length] ?? '#4ECDC4';
    this.colorIndex++;
    return color;
  }

  private nextName(): string {
    for (const name of AGENT_NAMES) {
      if (!this.usedNames.has(name)) return name;
    }
    return `Agent-${this.agents.size + 1}`;
  }
}
