import React, { useEffect, useState, useRef } from 'react';
import type { AgentCollabSession, AgentCollabMessage } from '@cucumber/container';

interface MessageFlowLogProps {
  session: AgentCollabSession;
  maxVisible?: number;
}

export const MessageFlowLog: React.FC<MessageFlowLogProps> = ({ session, maxVisible = 100 }) => {
  const [messages, setMessages] = useState<AgentCollabMessage[]>([]);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(session.messages.slice(-maxVisible));
    const unsub = session.on('message:sent', () => {
      setMessages(session.messages.slice(-maxVisible));
    });
    return unsub;
  }, [session, maxVisible]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const getTypeIcon = (type: AgentCollabMessage['type']): string => {
    switch (type) {
      case 'request': return '📤';
      case 'response': return '📥';
      case 'broadcast': return '📢';
    }
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  if (!expanded) {
    return (
      <div className="message-flow-log message-flow-log--collapsed" onClick={() => setExpanded(true)}>
        <span className="message-flow-log__toggle">💬 消息流 ({messages.length})</span>
      </div>
    );
  }

  return (
    <div className="message-flow-log message-flow-log--expanded">
      <div className="message-flow-log__header">
        <h3>消息流日志</h3>
        <button onClick={() => setExpanded(false)} className="message-flow-log__close">✕</button>
      </div>
      <div className="message-flow-log__body" ref={scrollRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`message-flow-log__item message-flow-log__item--${msg.type}`}>
            <span className="message-flow-log__time">{formatTime(msg.timestamp)}</span>
            <span className="message-flow-log__icon">{getTypeIcon(msg.type)}</span>
            <span className="message-flow-log__from">{msg.from.slice(0, 6)}</span>
            <span className="message-flow-log__arrow">→</span>
            <span className="message-flow-log__to">{msg.to === '*' ? 'ALL' : msg.to.slice(0, 6)}</span>
            <span className="message-flow-log__topic">[{msg.topic}]</span>
          </div>
        ))}
      </div>
    </div>
  );
};
