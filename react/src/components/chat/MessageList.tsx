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
import type {
  AssistantSpeakerMetadata,
  ChatMessage,
  InFlightMessage,
  Persona,
  PersonaSlotMap,
} from '../../types';
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
        const ctx = msg.context as (AssistantSpeakerMetadata & Record<string, unknown>) | null;
        // Resolve the speaker for an assistant message in this order:
        //   1. Persisted `authorPersonaKey` from the message itself.
        //   2. Persisted `authorName` / `sourceExecutorId` looked up
        //      through the section's slot map.
        //   3. (last-resort) name-based scan of the persona library.
        // This ensures the avatar/name survive a page refresh — the
        // transient `currentPersonaKey` handoff state from useMessages
        // is no longer needed for correctness.
        let persona: Persona | null = null;
        if (msg.role === 'assistant' && ctx) {
          if (ctx.authorPersonaKey) {
            persona = personasByKey[ctx.authorPersonaKey] || null;
          }
          if (!persona && (ctx.authorName || ctx.sourceExecutorId)) {
            persona = findPersonaByAuthor(personas, slotMap, ctx.authorName || ctx.sourceExecutorId || null);
          }
        }
        // Use the AG-UI `messageId` as the React key whenever we have
        // one so the streaming bubble (rendered from `inFlight`) and
        // the persisted bubble (rendered from `messages` after
        // TEXT_MESSAGE_END) reconcile to the SAME DOM node. Without
        // this the React diff treats them as different elements,
        // unmounts the streaming bubble and remounts a fresh one,
        // which the user perceives as a "reload" flicker between the
        // last delta and the final message.
        const stableKey = typeof ctx?.messageId === 'string' && ctx.messageId
          ? `msg-${ctx.messageId}`
          : `id-${msg.id}`;
        return (
          <MessageBubble
            key={stableKey}
            role={msg.role}
            content={msg.content}
            persona={persona}
            authorName={ctx?.authorName}
            timestamp={formatTimestamp(msg.created_at)}
          />
        );
      })}

      {inFlight.map((buf) => {
        let persona: Persona | null = null;
        if (buf.authorPersonaKey) {
          persona = personasByKey[buf.authorPersonaKey] || null;
        }
        if (!persona && (buf.authorName || buf.sourceExecutorId)) {
          persona = findPersonaByAuthor(personas, slotMap, buf.authorName || buf.sourceExecutorId || null);
        }
        // Same `msg-<messageId>` key the persisted bubble will use
        // when TEXT_MESSAGE_END fires; that way React keeps the same
        // DOM node and updates content/timestamp in place instead of
        // tearing down the streaming bubble and rebuilding from
        // scratch.
        const stableKey = buf.messageId ? `msg-${buf.messageId}` : `buf-${buf.id}`;
        return (
          <MessageBubble
            key={stableKey}
            role={buf.role}
            content={buf.text}
            persona={persona}
            authorName={buf.authorName}
            isStreaming
          />
        );
      })}

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
