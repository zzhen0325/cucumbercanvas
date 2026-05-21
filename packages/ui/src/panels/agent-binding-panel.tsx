import React, { useCallback } from 'react';
import type { ContainerNode, ContainerManager, AgentRegistry, AgentIdentity, AgentBinding } from '@cucumber/container';

export interface AgentBindingPanelProps {
  container: ContainerNode;
  containerManager: ContainerManager;
  agentRegistry: AgentRegistry;
  availableAgents: AgentIdentity[];
}

export function AgentBindingPanel({
  container,
  containerManager,
  agentRegistry,
  availableAgents,
}: AgentBindingPanelProps) {
  const binding = container.agentBinding;

  const handleBindAgent = useCallback((agentId: string) => {
    const identity = agentRegistry.getAgent(agentId);
    if (!identity) return;

    const agentBinding: AgentBinding = {
      agentId: identity.agentId,
      color: identity.color,
      name: identity.name,
      role: identity.role,
      status: 'idle',
      permissions: ['read', 'write'],
    };
    containerManager.bindAgent(container.id, agentBinding);
  }, [container.id, containerManager, agentRegistry]);

  const handleUnbindAgent = useCallback(() => {
    containerManager.unbindAgent(container.id);
  }, [container.id, containerManager]);

  return React.createElement('div', { className: 'agent-binding-panel' },
    React.createElement('h4', { className: 'panel-title' }, 'Agent 绑定'),

    binding?.agentId
      ? React.createElement('div', { className: 'agent-bound' },
          React.createElement('div', { className: 'agent-info' },
            React.createElement('span', {
              className: 'agent-dot',
              style: { backgroundColor: binding.color ?? '#4ECDC4' },
            }),
            React.createElement('span', { className: 'agent-name' }, binding.name ?? 'Unknown'),
            React.createElement('span', { className: `agent-status status-${binding.status ?? 'idle'}` },
              binding.status ?? 'idle'
            ),
          ),
          React.createElement('div', { className: 'agent-meta' },
            React.createElement('span', null, `角色: ${binding.role ?? '未设置'}`),
            React.createElement('span', null, `权限: ${(binding.permissions ?? []).join(', ')}`),
          ),
          React.createElement('button', {
            className: 'unbind-btn',
            onClick: handleUnbindAgent,
          }, '解除绑定'),
        )
      : React.createElement('div', { className: 'agent-unbound' },
          React.createElement('p', { className: 'hint' }, '选择一个 Agent 绑定到此容器'),
          React.createElement('div', { className: 'agent-list' },
            availableAgents.map(agent =>
              React.createElement('button', {
                key: agent.agentId,
                className: 'agent-option',
                onClick: () => handleBindAgent(agent.agentId),
              },
                React.createElement('span', {
                  className: 'agent-dot',
                  style: { backgroundColor: agent.color },
                }),
                React.createElement('span', null, agent.name),
              )
            )
          ),
        ),
  );
}
