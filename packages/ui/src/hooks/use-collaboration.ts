import { useEffect, useState, useCallback } from 'react';
import type { AgentOrchestrator, AgentCollabMessage, ConflictRecord } from '@cucumber/container';

export interface CollaborationState {
  activeAgentCount: number;
  maxConcurrent: number;
  messages: AgentCollabMessage[];
  unresolvedConflicts: ConflictRecord[];
}

export function useCollaboration(orchestrator: AgentOrchestrator): CollaborationState {
  const [state, setState] = useState<CollaborationState>({
    activeAgentCount: 0,
    maxConcurrent: orchestrator.maxConcurrent,
    messages: [],
    unresolvedConflicts: [],
  });

  const refresh = useCallback(() => {
    const session = orchestrator.session;
    setState({
      activeAgentCount: orchestrator.runningCount,
      maxConcurrent: orchestrator.maxConcurrent,
      messages: session.messages,
      unresolvedConflicts: session.getUnresolvedConflicts(),
    });
  }, [orchestrator]);

  useEffect(() => {
    refresh();
    const u1 = orchestrator.on('agent:start', refresh);
    const u2 = orchestrator.on('agent:complete', refresh);
    const u3 = orchestrator.on('agent:error', refresh);
    const u4 = orchestrator.session.on('message:sent', refresh);
    const u5 = orchestrator.session.on('conflict:detected', refresh);
    const u6 = orchestrator.session.on('conflict:resolved', refresh);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [orchestrator, refresh]);

  return state;
}
