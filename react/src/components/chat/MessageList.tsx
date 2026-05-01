/**
 * MessageList - renders persisted messages + in-flight streaming bubbles.
 * Auto-scrolls to bottom when new content arrives.
 *
 * When `isStreaming` is true and there is no in-flight assistant text yet
 * (the upstream agent is still "thinking" before emitting the first
 * TEXT_MESSAGE_CONTENT delta), we render a typing indicator so the user
 * gets immediate feedback that the request is being processed. Some
 * agent_framework configurations buffer the entire response server-side
 * and emit the text in a single delta after a noticeable delay; the
 * typing dots prevent the UI from looking frozen during that window.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage, InFlightMessage, Persona, PersonaSlotMap } from '../../types';
import { findPersonaByAuthor, indexPersonas } from '../../utils/persona-mapping';
import { MessageBubble } from './MessageBubble';

export interface MessageListProps {
  messages: ChatMessage[];
  inFlight: InFlightMessage[];
  personas: Persona[];
  slotMap: PersonaSlotMap;
  autoStartToken: string;
  /** True while the SSE connection is open. Drives the typing indicator. */
  isStreaming?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  inFlight,
  personas,
  slotMap,
  autoStartToken,
  isStreaming = false,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const personasByKey = useMemo(() => indexPersonas(personas), [personas]);

  // Whether to show the bottom typing indicator: stream is open AND no
  // assistant buffer has started yet (so the user has nothing visible).
  const hasInFlightAssistant = inFlight.some((b) => b.role === 'assistant');
  const showTypingIndicator = isStreaming && !hasInFlightAssistant;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, inFlight.map((m) => m.text).join('|'), showTypingIndicator]);

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (m.role === 'user' && m.content.trim() === autoStartToken) return false;
        return m.content.trim().length > 0;
      }),
    [messages, autoStartToken]
  );

  return (
    <div className="agentic-chat__scroller" ref={scrollerRef} role="log" aria-live="polite">
      {visibleMessages.map((msg) => {
        const personaKey = (msg.context as { authorPersonaKey?: string } | null)?.authorPersonaKey;
        const persona = personaKey
          ? personasByKey[personaKey] || null
          : findPersonaByAuthor(personas, slotMap, null);
        return (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            persona={msg.role === 'assistant' ? persona : null}
            timestamp={formatTimestamp(msg.created_at)}
          />
        );
      })}

      {inFlight.map((buf) => (
        <MessageBubble
          key={`buf-${buf.id}`}
          role={buf.role}
          content={buf.text}
          persona={buf.authorPersonaKey ? personasByKey[buf.authorPersonaKey] || null : null}
          isStreaming
        />
      ))}

      {showTypingIndicator && (
        <div className="agentic-typing" role="status" aria-live="polite">
          <div className="agentic-typing__avatar" aria-hidden="true">
            <i className="fas fa-robot" />
          </div>
          <div className="agentic-typing__bubble">
            <span className="agentic-typing__dot" />
            <span className="agentic-typing__dot" />
            <span className="agentic-typing__dot" />
            <span className="sr-only">Responding…</span>
          </div>
        </div>
      )}
    </div>
  );
};

function formatTimestamp(iso: string): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return undefined;
  }
}
