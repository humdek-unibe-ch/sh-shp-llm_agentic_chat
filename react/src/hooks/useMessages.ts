/**
 * useMessages - keeps the visible message list in sync with the AG-UI
 * stream. Persisted messages (loaded from get_thread) are stored in
 * state; in-flight assistant text is buffered in a ref to avoid
 * excessive re-renders, and committed when TEXT_MESSAGE_END fires.
 */
import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, AgUiEvent, InFlightMessage } from '../types';
import {
  getMessageId,
  extractHandoffTarget,
} from '../utils/ag-ui-events';

export interface UseMessagesResult {
  messages: ChatMessage[];
  inFlight: InFlightMessage[];
  setInitialMessages: (messages: ChatMessage[]) => void;
  appendUserMessage: (text: string) => void;
  handleAgUiEvent: (event: AgUiEvent) => void;
  clear: () => void;
  /** Persona key inferred from the most recent handoff_to_<key>. */
  currentPersonaKey: string | null;
}

let optimisticIdCounter = 0;
function nextOptimisticId(): number {
  // Negative ids so they don't collide with real DB rows.
  optimisticIdCounter += 1;
  return -1000 - optimisticIdCounter;
}

export function useMessages(): UseMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inFlight, setInFlight] = useState<InFlightMessage[]>([]);
  const [currentPersonaKey, setCurrentPersonaKey] = useState<string | null>(null);

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
  }, [commitInFlight]);

  const handleAgUiEvent = useCallback((event: AgUiEvent) => {
    const messageId = getMessageId(event);

    switch (event.type) {
      case 'TEXT_MESSAGE_START': {
        if (!messageId) return;
        buffersRef.current[messageId] = {
          id: messageId,
          role: (event.role as InFlightMessage['role']) || 'assistant',
          text: '',
          isComplete: false,
          startedAt: Date.now(),
          authorPersonaKey: currentPersonaKey || undefined,
        };
        commitInFlight();
        return;
      }

      case 'TEXT_MESSAGE_CONTENT': {
        if (!messageId) return;
        const buf = buffersRef.current[messageId] ?? {
          id: messageId,
          role: 'assistant',
          text: '',
          isComplete: false,
          startedAt: Date.now(),
          authorPersonaKey: currentPersonaKey || undefined,
        };
        const delta = typeof event.delta === 'string' ? event.delta : '';
        buf.text += delta;
        buffersRef.current[messageId] = buf;
        commitInFlight();
        return;
      }

      case 'TEXT_MESSAGE_END': {
        if (!messageId) return;
        const buf = buffersRef.current[messageId];
        if (!buf) return;

        if (buf.text.trim().length > 0 && buf.role !== 'user') {
          setMessages((prev) => [
            ...prev,
            {
              id: nextOptimisticId(),
              role: 'assistant',
              content: buf.text,
              context: { messageId, authorPersonaKey: buf.authorPersonaKey ?? null },
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
          authorPersonaKey: currentPersonaKey || undefined,
        };
        const delta = typeof event.delta === 'string' ? event.delta : '';
        buf.text += delta;
        buffersRef.current[messageId] = buf;
        commitInFlight();
        return;
      }

      case 'TOOL_CALL_START': {
        const handoffKey = extractHandoffTarget(event);
        if (handoffKey) {
          setCurrentPersonaKey(handoffKey);
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
            context: { messageId: m.id ?? null, source: 'snapshot' },
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
  };
}
