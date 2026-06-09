/**
 * useMessages - keeps the visible message list in sync with the AG-UI
 * stream.
 *
 * Persisted messages (loaded from `get_thread`) are stored in state.
 * In-flight assistant text is buffered in a ref keyed by AG-UI
 * `messageId`, and committed to `messages` when `TEXT_MESSAGE_END`
 * fires. Each finalised assistant message inherits the speaker
 * metadata streamed alongside its TEXT_MESSAGE_* lifecycle
 * (`authorName`, `sourceExecutorId`, `authorPersonaKey`, …) so the
 * renderer can resolve avatars/names from the message itself rather
 * than from transient global handoff state.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  AgUiEvent,
  AssistantSpeakerMetadata,
  ChatMessage,
  InFlightMessage,
} from '../types';
import {
  extractHandoffTarget,
  getMessageId,
} from '../utils/ag-ui-events';

export interface UseMessagesResult {
  messages: ChatMessage[];
  inFlight: InFlightMessage[];
  setInitialMessages: (messages: ChatMessage[]) => void;
  appendUserMessage: (text: string) => void;
  handleAgUiEvent: (event: AgUiEvent) => void;
  clear: () => void;
  /**
   * Persona key of the CURRENT speaker, derived from speaker metadata on
   * STEP_STARTED / TEXT_MESSAGE_* / ACTIVITY_SNAPSHOT events. A handoff
   * tool call does NOT change this — see `handoffTarget`.
   */
  currentPersonaKey: string | null;
  /**
   * Raw target of an in-flight `handoff_to_<x>` tool call (persona key,
   * name or executor id). Set when the mediator hands off and cleared as
   * soon as the next speaker actually starts. Lets the UI show
   * "Handing off to X" without prematurely switching the active speaker.
   */
  handoffTarget: string | null;
}

let optimisticIdCounter = 0;
function nextOptimisticId(): number {
  // Negative ids so they don't collide with real DB rows.
  optimisticIdCounter += 1;
  return -1000 - optimisticIdCounter;
}

/**
 * Extract any speaker metadata fields the event carries (camelCase
 * only; the bridge has already normalised the snake_case originals).
 */
function speakerFromEvent(ev: AgUiEvent): AssistantSpeakerMetadata {
  const out: AssistantSpeakerMetadata = {};
  if (typeof ev.authorName === 'string') out.authorName = ev.authorName;
  if (typeof ev.sourceExecutorId === 'string') out.sourceExecutorId = ev.sourceExecutorId;
  if (typeof ev.authorSlot === 'string') out.authorSlot = ev.authorSlot;
  if (typeof ev.authorPersonaKey === 'string') out.authorPersonaKey = ev.authorPersonaKey;
  if (typeof ev.runId === 'string') out.runId = ev.runId;
  return out;
}

function mergeSpeaker(
  base: AssistantSpeakerMetadata,
  next: AssistantSpeakerMetadata
): AssistantSpeakerMetadata {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(next).filter(([, v]) => v !== undefined && v !== '')
    ),
  };
}

export function useMessages(): UseMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inFlight, setInFlight] = useState<InFlightMessage[]>([]);
  const [currentPersonaKey, setCurrentPersonaKey] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);

  const buffersRef = useRef<Record<string, InFlightMessage>>({});

  const commitInFlight = useCallback(() => {
    setInFlight(Object.values(buffersRef.current));
  }, []);

  const setInitialMessages = useCallback((next: ChatMessage[]) => {
    setMessages(next);
    buffersRef.current = {};
    commitInFlight();
  }, [commitInFlight]);

  const appendUserMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextOptimisticId(),
        role: 'user',
        content: text,
        context: null,
        created_at: new Date().toISOString(),
      },
    ]);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    buffersRef.current = {};
    commitInFlight();
    setCurrentPersonaKey(null);
    setHandoffTarget(null);
  }, [commitInFlight]);

  const handleAgUiEvent = useCallback((event: AgUiEvent) => {
    const messageId = getMessageId(event);
    const speaker = speakerFromEvent(event);
    const isHandoffToolCall =
      event.type === 'TOOL_CALL_START' && !!extractHandoffTarget(event);

    // If the normaliser has resolved a persona key for the current
    // speaker, promote it to the global "active" state so the persona
    // strip and typing indicator follow along — and clear any pending
    // handoff because the target (or someone) is now actually speaking.
    //
    // A handoff TOOL_CALL_START is explicitly excluded: it is emitted by
    // the *current* speaker (often the mediator) to announce the NEXT
    // speaker, so honouring its author here would wrongly keep/clear the
    // active speaker before the handoff target has spoken.
    if (speaker.authorPersonaKey && !isHandoffToolCall) {
      setCurrentPersonaKey(speaker.authorPersonaKey);
      setHandoffTarget(null);
    }

    switch (event.type) {
      case 'TEXT_MESSAGE_START': {
        if (!messageId) return;
        // A bubble is starting to stream → any pending handoff is resolved.
        setHandoffTarget(null);
        buffersRef.current[messageId] = {
          id: messageId,
          role: (event.role as InFlightMessage['role']) || 'assistant',
          text: '',
          isComplete: false,
          startedAt: Date.now(),
          messageId,
          ...speaker,
          authorPersonaKey: speaker.authorPersonaKey ?? currentPersonaKey ?? undefined,
        };
        commitInFlight();
        return;
      }

      case 'TEXT_MESSAGE_CONTENT': {
        if (!messageId) return;
        const buf = buffersRef.current[messageId] ?? {
          id: messageId,
          role: 'assistant' as InFlightMessage['role'],
          text: '',
          isComplete: false,
          startedAt: Date.now(),
          messageId,
          ...speaker,
          authorPersonaKey: speaker.authorPersonaKey ?? currentPersonaKey ?? undefined,
        };
        const delta = typeof event.delta === 'string' ? event.delta : '';
        // Late-arriving speaker metadata: some backend variants only
        // name the executor on the first CONTENT event.
        const next: InFlightMessage = { ...buf, ...mergeSpeaker(buf, speaker), text: buf.text + delta };
        buffersRef.current[messageId] = next;
        commitInFlight();
        return;
      }

      case 'TEXT_MESSAGE_END': {
        if (!messageId) return;
        const buf = buffersRef.current[messageId];
        if (!buf) return;

        if (buf.text.trim().length > 0 && buf.role !== 'user') {
          const persistedContext: ChatMessage['context'] = {
            messageId: buf.messageId ?? messageId,
            authorPersonaKey: buf.authorPersonaKey,
            authorName: buf.authorName,
            sourceExecutorId: buf.sourceExecutorId,
            authorSlot: buf.authorSlot,
            runId: buf.runId,
          };
          setMessages((prev) => [
            ...prev,
            {
              id: nextOptimisticId(),
              role: 'assistant',
              content: buf.text,
              context: persistedContext,
              created_at: new Date().toISOString(),
            },
          ]);
        }

        delete buffersRef.current[messageId];
        commitInFlight();
        return;
      }

      case 'TEXT_MESSAGE_CHUNK': {
        if (!messageId) return;
        const buf = buffersRef.current[messageId] ?? {
          id: messageId,
          role: (event.role as InFlightMessage['role']) || 'assistant',
          text: '',
          isComplete: false,
          startedAt: Date.now(),
          messageId,
          ...speaker,
          authorPersonaKey: speaker.authorPersonaKey ?? currentPersonaKey ?? undefined,
        };
        const delta = typeof event.delta === 'string' ? event.delta : '';
        buffersRef.current[messageId] = {
          ...buf,
          ...mergeSpeaker(buf, speaker),
          text: buf.text + delta,
        };
        commitInFlight();
        return;
      }

      case 'TOOL_CALL_START': {
        const handoffKey = extractHandoffTarget(event);
        if (handoffKey) {
          // Record the handoff target only; the active speaker stays put
          // until the target actually starts streaming. The UI shows a
          // "Handing off to X" hint in the meantime.
          setHandoffTarget(handoffKey);
        }
        return;
      }

      case 'MESSAGES_SNAPSHOT': {
        if (!Array.isArray(event.messages)) return;
        const snap = event.messages
          .filter((m): m is { id?: string; role?: string; content?: string } => !!m && typeof m === 'object')
          .filter((m) => typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
          .map((m) => ({
            id: nextOptimisticId(),
            role: m.role as ChatMessage['role'],
            content: String(m.content),
            context: { messageId: m.id ?? undefined, source: 'snapshot' },
            created_at: new Date().toISOString(),
          }));
        setMessages(snap);
        return;
      }

      default:
        return;
    }
  }, [commitInFlight, currentPersonaKey]);

  return {
    messages,
    inFlight,
    setInitialMessages,
    appendUserMessage,
    handleAgUiEvent,
    clear,
    currentPersonaKey,
    handoffTarget,
  };
}
