/**
 * MessageBubble - single message row.
 * Markdown for assistant text, plain text for user/system.
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Persona } from '../../types';

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  persona?: Persona | null;
  isStreaming?: boolean;
  timestamp?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  role,
  content,
  persona,
  isStreaming,
  timestamp,
}) => {
  const isUser = role === 'user';
  const wrapperClass = `agentic-msg agentic-msg--${role}${isStreaming ? ' agentic-msg--streaming' : ''}`;

  const avatar = isUser ? null : (
    <div
      className="agentic-msg__avatar"
      style={persona?.color ? { backgroundColor: persona.color } : undefined}
      aria-hidden="true"
    >
      {persona?.avatar || (persona?.name ? persona.name.charAt(0).toUpperCase() : 'A')}
    </div>
  );

  return (
    <div className={wrapperClass}>
      {avatar}
      <div className="agentic-msg__body">
        {!isUser && persona && (
          <div className="agentic-msg__author">{persona.name}</div>
        )}
        <div className="agentic-msg__content">
          {isUser ? (
            content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {content || (isStreaming ? '…' : '')}
            </ReactMarkdown>
          )}
        </div>
        {timestamp && <div className="agentic-msg__timestamp">{timestamp}</div>}
      </div>
    </div>
  );
};
