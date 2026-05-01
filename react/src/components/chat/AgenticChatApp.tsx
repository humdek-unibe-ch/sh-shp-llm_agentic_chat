/**
 * AgenticChatApp - top-level chat surface. Wires hooks together and
 * delegates rendering to ChatShell.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgenticChatConfig, AgUiEvent } from '../../types';
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
  const [autoStartFired, setAutoStartFired] = useState(false);

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
      // After the stream ends, sync from server so message ids match the DB.
      void thread.refresh();
    },
  });

  // Sync persisted messages into the messages hook when they load.
  const lastSyncedMessagesRef = useRef<string>('');
  useEffect(() => {
    const fingerprint = thread.messages.map((m) => `${m.id}:${m.content.length}`).join('|');
    if (fingerprint !== lastSyncedMessagesRef.current) {
      lastSyncedMessagesRef.current = fingerprint;
      messagesHook.setInitialMessages(thread.messages);
    }
  }, [thread.messages, messagesHook]);

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
    await thread.refresh();
  }, [api, interrupts, messagesHook, runStatus, stream, thread]);

  const sendMessage = useCallback(async (text: string) => {
    if (runStatus.caseClosed) return;
    messagesHook.appendUserMessage(text);
    await stream.start({ message: text });
  }, [messagesHook, runStatus.caseClosed, stream]);

  // Auto-start on first paint when configured and no messages yet.
  useEffect(() => {
    if (autoStartFired) return;
    if (thread.loading) return;
    if (!config.autoStart) return;
    if (thread.thread && (thread.thread.isCompleted || thread.thread.status === 'completed')) return;
    if (messagesHook.messages.length > 0) return;

    setAutoStartFired(true);
    void startThread();
  }, [autoStartFired, config.autoStart, messagesHook.messages.length, startThread, thread.loading, thread.thread]);

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
