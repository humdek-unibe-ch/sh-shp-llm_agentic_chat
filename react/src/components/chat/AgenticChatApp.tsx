/**
 * AgenticChatApp — top-level chat surface.
 *
 * Wires the AG-UI hooks together and delegates rendering to ChatShell.
 *
 * Responsibilities:
 *   1. Resolve the active thread on mount via `get_thread`.
 *   2. Decide whether to fire the auto-start kickoff (`__auto_start__`):
 *      it must NOT fire on every page refresh, only when the section is
 *      genuinely fresh (no persisted messages) AND no HITL interrupt is
 *      already waiting for the user's reply on the server.
 *   3. Decide whether the next user message starts a new run or resumes
 *      a paused one. AG-UI requires resume payloads to carry the user
 *      response inside `resume.interrupts[].value`, NOT in `messages[]`.
 *   4. Forward AG-UI events to the `useMessages`, `usePendingInterrupts`
 *      and `useRunStatus` hooks. Streaming bubbles in MessageList come
 *      from `useMessages.inFlight`; final assistant text is committed
 *      to `useMessages.messages` on TEXT_MESSAGE_END.
 *
 * @module components/chat/AgenticChatApp
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgenticChatConfig, AgUiEvent, PendingInterrupt } from '../../types';
import { createChatApi } from '../../utils/api';
import { isCaseCompleteText } from '../../utils/ag-ui-events';
import { useAgenticThread } from '../../hooks/useAgenticThread';
import { useAgUiStream } from '../../hooks/useAgUiStream';
import { useMessages } from '../../hooks/useMessages';
import { usePendingInterrupts } from '../../hooks/usePendingInterrupts';
import { useRunStatus } from '../../hooks/useRunStatus';
import { ChatShell } from './ChatShell';

const MAX_DEBUG_EVENTS = 200;

export interface AgenticChatAppProps {
  config: AgenticChatConfig;
}

export const AgenticChatApp: React.FC<AgenticChatAppProps> = ({ config }) => {
  const api = useMemo(
    () => createChatApi(config.controllerUrl, config.sectionId),
    [config.controllerUrl, config.sectionId]
  );

  const thread = useAgenticThread(api);
  const messagesHook = useMessages();
  const interrupts = usePendingInterrupts();
  const runStatus = useRunStatus({ caseCompleteMarker: config.caseCompleteMarker });

  const [debugEvents, setDebugEvents] = useState<AgUiEvent[]>([]);
  /**
   * `autoStartFired` is a process-local guard so the kickoff token is sent
   * at most once per page load even when the auto-start effect re-runs.
   * We additionally gate on server-state below so a refresh in the middle
   * of an active conversation never triggers the kickoff.
   */
  const [autoStartFired, setAutoStartFired] = useState(false);

  /* ---------- AG-UI event forwarding ------------------------------------- */

  const onEvent = useCallback((ev: AgUiEvent) => {
    if (config.showDebug) {
      setDebugEvents((prev) => {
        const next = prev.concat(ev);
        if (next.length > MAX_DEBUG_EVENTS) next.splice(0, next.length - MAX_DEBUG_EVENTS);
        return next;
      });
    }

    messagesHook.handleAgUiEvent(ev);
    interrupts.handleAgUiEvent(ev);
    runStatus.handleAgUiEvent(ev);
  }, [config.showDebug, messagesHook, interrupts, runStatus]);

  const stream = useAgUiStream({
    controllerUrl: config.controllerUrl,
    sectionId: config.sectionId,
    onEvent,
    onError: (msg) => runStatus.markError(msg),
    onComplete: () => {
      // After the stream ends, sync from server so message ids match the
      // DB and the persisted pending_interrupts column matches what the
      // RUN_FINISHED event carried.
      void thread.refresh();
    },
  });

  /* ---------- Server -> client sync -------------------------------------- */

  // Sync persisted messages into the messages hook when they load.
  const lastSyncedMessagesRef = useRef<string>('');
  useEffect(() => {
    const fingerprint = thread.messages.map((m) => `${m.id}:${m.content.length}`).join('|');
    if (fingerprint !== lastSyncedMessagesRef.current) {
      lastSyncedMessagesRef.current = fingerprint;
      messagesHook.setInitialMessages(thread.messages);
    }
  }, [thread.messages, messagesHook]);

  // Sync persisted pending_interrupts into the interrupts hook so the
  // UI can resume mid-conversation after a page refresh.
  const lastSyncedInterruptsRef = useRef<string>('');
  useEffect(() => {
    const list: PendingInterrupt[] = (thread.thread?.pendingInterrupts ?? []).map((i) => ({
      interruptId: String(i.id),
      payload: { id: i.id, value: i.value },
    }));
    const fingerprint = list.map((i) => i.interruptId).join('|');
    if (fingerprint !== lastSyncedInterruptsRef.current) {
      lastSyncedInterruptsRef.current = fingerprint;
      interrupts.setInitial(list);
    }
  }, [thread.thread, interrupts]);

  // Detect case-complete by inspecting the last assistant message.
  useEffect(() => {
    const last = [...messagesHook.messages].reverse().find((m) => m.role === 'assistant');
    if (last && isCaseCompleteText(last.content, config.caseCompleteMarker)) {
      runStatus.markComplete();
    }
  }, [config.caseCompleteMarker, messagesHook.messages, runStatus]);

  /* ---------- Actions ----------------------------------------------------- */

  const startThread = useCallback(async () => {
    runStatus.beginStarting();
    // Slot map + module content are resolved server-side from the
    // section/admin configuration, so we send no body fields here.
    const startResult = await api.startThread();
    if (!startResult.ok) {
      runStatus.markError(startResult.error);
      return;
    }
    if (config.autoStart) {
      messagesHook.appendUserMessage(config.autoStartToken);
      await stream.start({ message: config.autoStartToken });
    }
  }, [api, config, messagesHook, runStatus, stream]);

  const resetThread = useCallback(async () => {
    stream.abort();
    const result = await api.resetThread();
    if (!result.ok) {
      runStatus.markError(result.error);
      return;
    }
    messagesHook.clear();
    interrupts.clear();
    runStatus.reset();
    setAutoStartFired(false);
    lastSyncedMessagesRef.current = '';
    lastSyncedInterruptsRef.current = '';
    await thread.refresh();
  }, [api, interrupts, messagesHook, runStatus, stream, thread]);

  /**
   * Send a user message. When a HITL interrupt is pending, package the
   * message as an AG-UI resume payload that targets the most recent
   * interrupt id. Otherwise send a plain `message` and let the backend
   * start a fresh run.
   */
  const sendMessage = useCallback(async (text: string) => {
    if (runStatus.caseClosed) return;
    messagesHook.appendUserMessage(text);

    const currentInterrupt = interrupts.current;
    if (currentInterrupt) {
      // Per https://docs.ag-ui.com/concepts/interrupts#resuming-a-run.
      const resume = {
        interrupts: [
          {
            id: currentInterrupt.interruptId,
            value: [
              {
                role: 'user',
                contents: [{ type: 'text', text }],
              },
            ],
          },
        ],
      };
      // Optimistically clear the interrupt locally so the UI flips out
      // of "awaiting_input" immediately. The next RUN_FINISHED will
      // either re-add it (multi-turn HITL) or end the run.
      interrupts.resolve(currentInterrupt.interruptId);
      await stream.start({ message: text, resume });
      return;
    }

    await stream.start({ message: text });
  }, [interrupts, messagesHook, runStatus.caseClosed, stream]);

  /**
   * Auto-start gating.
   *
   * Fires ONCE per page load when:
   *   - the section is configured with auto-start AND
   *   - we have synced server state at least once (`thread.loading` is false) AND
   *   - the persisted thread has no visible messages AND
   *   - the persisted thread is not already complete AND
   *   - the persisted thread has no HITL interrupts waiting on a reply
   *
   * Using `thread.messages.length` (server-side count) rather than
   * `messagesHook.messages.length` (client-side, populated asynchronously
   * by the sync effect above) avoids a race where the auto-start effect
   * runs before the sync effect copies the server messages over, which
   * caused the kickoff to fire on every refresh.
   */
  useEffect(() => {
    if (autoStartFired) return;
    if (thread.loading) return;
    if (!config.autoStart) return;
    if (thread.thread?.isCompleted) return;
    if (thread.thread?.status === 'completed') return;
    if ((thread.thread?.pendingInterrupts ?? []).length > 0) return;
    if (thread.messages.length > 0) return;

    setAutoStartFired(true);
    void startThread();
  }, [
    autoStartFired,
    config.autoStart,
    startThread,
    thread.loading,
    thread.messages.length,
    thread.thread,
  ]);

  /* ---------- Render ------------------------------------------------------ */

  if (thread.loading) {
    return (
      <section className="agentic-chat agentic-chat--loading">
        <div className="agentic-chat__loading">
          <i className="fa fa-spinner fa-spin mr-2" /> {config.labels.loadingText}
        </div>
      </section>
    );
  }

  const showStart =
    !config.autoStart && messagesHook.messages.length === 0 && !runStatus.caseClosed;

  return (
    <ChatShell
      labels={config.labels}
      personas={config.personas}
      slotMap={config.personaSlotMap}
      messages={messagesHook.messages}
      inFlight={messagesHook.inFlight}
      activePersonaKey={messagesHook.currentPersonaKey}
      status={runStatus.status}
      isStreaming={stream.isStreaming}
      caseClosed={runStatus.caseClosed || (thread.thread?.isCompleted ?? false)}
      errorMessage={runStatus.error || thread.error}
      showStart={showStart}
      showReset={messagesHook.messages.length > 0 || runStatus.caseClosed}
      showPersonaStrip={config.showPersonaStrip}
      showRunStatus={config.showRunStatus}
      showDebug={config.showDebug}
      events={debugEvents}
      autoStartToken={config.autoStartToken}
      enableSpeechToText={config.enableSpeechToText}
      speechToTextModel={config.speechToTextModel}
      sectionId={config.sectionId}
      controllerUrl={config.controllerUrl}
      onSend={(text) => void sendMessage(text)}
      onStart={() => void startThread()}
      onReset={() => void resetThread()}
    />
  );
};
