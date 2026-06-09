/**
 * MessageList — renders persisted messages + in-flight streaming bubbles
 * as a real chat transcript.
 *
 * Scrolling:
 *   - There is NO inner scroll box. The conversation grows with its
 *     content and the PAGE owns the scrollbar (no double scrollbar, no
 *     sticky content). A zero-height sentinel at the end of the transcript
 *     is the scroll target.
 *   - We only auto-follow once a live run has happened this session (so a
 *     plain reload never hijacks the page position) and only when the
 *     reader is already near the bottom, so scrolling up to re-read
 *     history is not yanked back down while new tokens stream in.
 *
 * Grouping:
 *   - Consecutive messages from the SAME speaker are visually grouped: the
 *     avatar + name are shown only on the first bubble of the run and the
 *     following bubbles are tucked in underneath. This mirrors how modern
 *     chat apps render a burst of messages from one participant.
 *
 * Typing indicator:
 *   - When the SSE connection is open but no assistant text has streamed
 *     yet, three pulsing dots stand in for the upcoming bubble so the UI
 *     never looks frozen during the agent's "thinking" window.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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

/** Distance (px) from the bottom within which we keep auto-scrolling. */
const STICK_THRESHOLD_PX = 120;

interface RenderRow {
  key: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  persona: Persona | null;
  authorName?: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Identity of the speaker, used to group consecutive bubbles. */
  speakerId: string;
}

/** Stable identity for a message's speaker (drives bubble grouping). */
function speakerIdOf(
  role: string,
  persona: Persona | null,
  authorName?: string | null,
  sourceExecutorId?: string | null
): string {
  if (role === 'user') return 'user';
  if (role === 'system') return 'system';
  return `assistant:${persona?.key || authorName || sourceExecutorId || 'assistant'}`;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  inFlight,
  personas,
  slotMap,
  autoStartToken,
  isStreaming = false,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const streamingSeenRef = useRef(false);
  const personasByKey = useMemo(() => indexPersonas(personas), [personas]);

  // Remember once a live run has happened this session; only then do we
  // auto-follow the page scroll, so a plain reload never hijacks the page.
  if (isStreaming) streamingSeenRef.current = true;

  // Show the bottom typing indicator while the stream is open AND no
  // assistant buffer has started yet (so the user has nothing visible).
  const hasInFlightAssistant = inFlight.some((b) => b.role === 'assistant');
  const showTypingIndicator = isStreaming && !hasInFlightAssistant;

  const resolveAssistantPersona = useCallback(
    (
      authorPersonaKey?: string | null,
      authorName?: string | null,
      sourceExecutorId?: string | null
    ): Persona | null => {
      let persona: Persona | null = null;
      if (authorPersonaKey) persona = personasByKey[authorPersonaKey] || null;
      if (!persona && (authorName || sourceExecutorId)) {
        persona = findPersonaByAuthor(personas, slotMap, authorName || sourceExecutorId || null);
      }
      return persona;
    },
    [personas, personasByKey, slotMap]
  );

  // Build a single ordered list of renderable rows (persisted + in-flight)
  // so speaker grouping spans the boundary between committed history and
  // the bubble currently streaming.
  const rows = useMemo<RenderRow[]>(() => {
    const out: RenderRow[] = [];

    for (const msg of messages) {
      if (msg.role === 'user' && msg.content.trim() === autoStartToken) continue;
      if (msg.content.trim().length === 0) continue;
      const ctx = msg.context as (AssistantSpeakerMetadata & Record<string, unknown>) | null;
      let persona: Persona | null = null;
      if (msg.role === 'assistant' && ctx) {
        persona = resolveAssistantPersona(ctx.authorPersonaKey, ctx.authorName, ctx.sourceExecutorId);
      }
      // Reconcile streaming → persisted bubbles to the SAME DOM node by
      // keying on the AG-UI messageId whenever present.
      const key = typeof ctx?.messageId === 'string' && ctx.messageId
        ? `msg-${ctx.messageId}`
        : `id-${msg.id}`;
      out.push({
        key,
        role: msg.role,
        content: msg.content,
        persona,
        authorName: ctx?.authorName,
        timestamp: formatTimestamp(msg.created_at),
        speakerId: speakerIdOf(msg.role, persona, ctx?.authorName, ctx?.sourceExecutorId),
      });
    }

    for (const buf of inFlight) {
      let persona: Persona | null = null;
      if (buf.role !== 'user') {
        persona = resolveAssistantPersona(buf.authorPersonaKey, buf.authorName, buf.sourceExecutorId);
      }
      const key = buf.messageId ? `msg-${buf.messageId}` : `buf-${buf.id}`;
      out.push({
        key,
        role: buf.role,
        content: buf.text,
        persona,
        authorName: buf.authorName,
        isStreaming: true,
        speakerId: speakerIdOf(buf.role, persona, buf.authorName, buf.sourceExecutorId),
      });
    }

    return out;
  }, [messages, inFlight, autoStartToken, resolveAssistantPersona]);

  const inflightSignature = inFlight.map((m) => m.text).join('|');

  // Track whether the PAGE is scrolled near the bottom of the
  // conversation. The chat has no inner scrollbar any more, so we measure
  // the bottom sentinel against the viewport instead of an inner element.
  useEffect(() => {
    const onScroll = () => {
      const el = bottomRef.current;
      if (!el) return;
      const distance = el.getBoundingClientRect().top - window.innerHeight;
      stickToBottomRef.current = distance < STICK_THRESHOLD_PX;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Follow new content by nudging the PAGE (not an inner box) to the
  // bottom sentinel — but only during/after a live run, and only when the
  // reader is already near the bottom, so re-reading history is never
  // yanked. Runs before paint to avoid a visible jump.
  useLayoutEffect(() => {
    if (!streamingSeenRef.current) return;
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [rows.length, inflightSignature, showTypingIndicator]);

  return (
    <div className="agentic-chat__scroller" role="log" aria-live="polite">
      {rows.map((row, idx) => {
        const prev = rows[idx - 1];
        const isFirstOfGroup = !prev || prev.speakerId !== row.speakerId;
        return (
          <MessageBubble
            key={row.key}
            role={row.role}
            content={row.content}
            persona={row.persona}
            authorName={row.authorName}
            timestamp={row.timestamp}
            isStreaming={row.isStreaming}
            showAvatar={isFirstOfGroup}
            showName={isFirstOfGroup}
            grouped={!isFirstOfGroup}
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

      <div ref={bottomRef} className="agentic-chat__bottom" aria-hidden="true" />
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
