import React, { useEffect, useState } from 'react';
import type { AgentCollabSession, ConflictRecord } from '@cucumber/container';

interface ConflictHighlightPanelProps {
  session: AgentCollabSession;
  onResolve: (conflictId: string, resolution: 'accept' | 'reject' | 'merge') => void;
  onFocusContainer: (containerId: string) => void;
}

export const ConflictHighlightPanel: React.FC<ConflictHighlightPanelProps> = ({
  session,
  onResolve,
  onFocusContainer,
}) => {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);

  useEffect(() => {
    setConflicts(session.getUnresolvedConflicts());
    const u1 = session.on('conflict:detected', () => {
      setConflicts(session.getUnresolvedConflicts());
    });
    const u2 = session.on('conflict:resolved', () => {
      setConflicts(session.getUnresolvedConflicts());
    });
    return () => { u1(); u2(); };
  }, [session]);

  if (conflicts.length === 0) return null;

  return (
    <div className="conflict-highlight-panel">
      <div className="conflict-highlight-panel__header">
        <span className="conflict-highlight-panel__icon">⚠️</span>
        <h4>操作冲突 ({conflicts.length})</h4>
      </div>
      <div className="conflict-highlight-panel__list">
        {conflicts.map(conflict => (
          <div key={conflict.id} className="conflict-highlight-panel__item">
            <div className="conflict-highlight-panel__info">
              <span className="conflict-highlight-panel__agent">
                {conflict.agentId.slice(0, 8)}
              </span>
              <span className="conflict-highlight-panel__op">
                {conflict.operation.type} → {conflict.operation.target.slice(0, 10)}
              </span>
              <button
                className="conflict-highlight-panel__focus"
                onClick={() => onFocusContainer(conflict.containerId)}
              >
                定位
              </button>
            </div>
            <div className="conflict-highlight-panel__actions">
              <button onClick={() => onResolve(conflict.id, 'accept')} className="conflict-highlight-panel__btn--accept">接受</button>
              <button onClick={() => onResolve(conflict.id, 'reject')} className="conflict-highlight-panel__btn--reject">拒绝</button>
              <button onClick={() => onResolve(conflict.id, 'merge')} className="conflict-highlight-panel__btn--merge">合并</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
