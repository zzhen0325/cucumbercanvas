import { useCallback, useEffect, useState } from 'react';
import type { ContainerManager, AgentRegistry, AgentIdentity } from '@cucumber/container';

export function useAgentRegistry(registry: AgentRegistry) {
  const [agents, setAgents] = useState<AgentIdentity[]>([]);

  useEffect(() => {
    setAgents(registry.getAllAgents());

    const unsub1 = registry.on('agent:registered', () => {
      setAgents(registry.getAllAgents());
    });
    const unsub2 = registry.on('agent:unregistered', () => {
      setAgents(registry.getAllAgents());
    });
    const unsub3 = registry.on('agent:updated', () => {
      setAgents(registry.getAllAgents());
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, [registry]);

  return agents;
}
