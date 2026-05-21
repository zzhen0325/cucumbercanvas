import React, { useEffect, useState, useCallback } from 'react';
import type { AgentOrchestrator } from '@cucumber/container';
import type { AgentBinding } from '@cucumber/container';

interface AgentStatusEntry {
  agentId: string;
  containerId: string;
  name?: string;
  color?: string;
  status: AgentBinding['status'];
  startedAt: number;
}

interface AgentStatusPanelProps {
  orchestrator: AgentOrchestrator;
}

export const AgentStatusPanel: React.FC<AgentStatusPanelProps> = ({ orchestrator }) => {
  const [agents, setAgents] = useState<AgentStatusEntry[]>([]);

  const refreshAgents = useCallback(() => {
    const active = orchestrator.getActiveAgents();
    setAgents(active.map(a => ({
      agentId: a.agentId,
      containerId: a.containerId,
      startedAt: a.startedAt,
      status: 'running',
    })));
  }, [orchestrator]);

  useEffect(() => {
    refreshAgents();
    const unsub1 = orchestrator.on('agent:start', refreshAgents);
    const unsub2 = orchestrator.on('agent:complete', refreshAgents);
    const unsub3 = orchestrator.on('agent:error', refreshAgents);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [orchestrator, refreshAgents]);

  const getStatusIcon = (status: AgentBinding['status']): string => {
    switch (status) {
      case 'idle': return '⏸️';
      case 'thinking': return '🧠';
      case 'running': return '▶️';
      case 'completed': return '✅';
      case 'blocked': return '🚫';
      default: return '❓';
    }
  };

  const getElapsedTime = (startedAt: number): string => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  };

  return (
    <div className="agent-status-panel">
      <div className="agent-status-panel__header">
        <h3>Agent 状态</h3>
        <span className="agent-status-panel__count">
          {agents.length}/{orchestrator.maxConcurrent}
        </span>
      </div>
      <div className="agent-status-panel__list">
        {agents.length === 0 ? (
          <div className="agent-status-panel__empty">暂无运行中的 Agent</div>
        ) : (
          agents.map(agent => (
            <div key={agent.agentId} className="agent-status-panel__item">
              <span
                className="agent-status-panel__indicator"
                style={{ backgroundColor: agent.color ?? '#4ECDC4' }}
              />
              <div className="agent-status-panel__info">
                <span className="agent-status-panel__name">
                  {agent.name ?? agent.agentId.slice(0, 8)}
                </span>
                <span className="agent-status-panel__container">
                  {agent.containerId.slice(0, 12)}
                </span>
              </div>
              <div className="agent-status-panel__status">
                <span>{getStatusIcon(agent.status)}</span>
                <span className="agent-status-panel__elapsed">
                  {getElapsedTime(agent.startedAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
