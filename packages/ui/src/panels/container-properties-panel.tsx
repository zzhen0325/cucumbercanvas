import React from 'react';
import type { ContainerNode, ContainerManager, AgentRegistry, AgentIdentity } from '@cucumber/container';
import { AgentBindingPanel } from './agent-binding-panel.js';
import { ContextSlotsPanel } from './context-slots-panel.js';

export interface ContainerPropertiesPanelProps {
  container: ContainerNode;
  containerManager: ContainerManager;
  agentRegistry: AgentRegistry;
  availableAgents: AgentIdentity[];
}

export function ContainerPropertiesPanel({
  container,
  containerManager,
  agentRegistry,
  availableAgents,
}: ContainerPropertiesPanelProps) {
  return React.createElement('div', { className: 'container-properties-panel' },
    React.createElement('div', { className: 'panel-header' },
      React.createElement('h3', null, container.name ?? 'Container'),
      React.createElement('div', { className: 'container-roles' },
        (container.containerRole ?? []).map(r =>
          React.createElement('span', { key: r, className: `role-tag role-${r}` }, r)
        ),
      ),
    ),

    React.createElement('div', { className: 'panel-section' },
      React.createElement(AgentBindingPanel, {
        container,
        containerManager,
        agentRegistry,
        availableAgents,
      }),
    ),

    React.createElement('div', { className: 'panel-divider' }),

    React.createElement('div', { className: 'panel-section' },
      React.createElement(ContextSlotsPanel, {
        container,
        containerManager,
      }),
    ),
  );
}
