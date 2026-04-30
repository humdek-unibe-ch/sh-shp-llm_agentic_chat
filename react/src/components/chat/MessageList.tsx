/**
 * MessageList - renders persisted messages + in-flight streaming bubbles.
 * Auto-scrolls to bottom when new content arrives.
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
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  inFlight,
  personas,
  slotMap,
  autoStartToken,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const personasByKey = useMemo(() => indexPersonas(personas), [personas]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, inFlight.map((m) => m.text).join('|')]);

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
