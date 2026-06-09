/**
 * ChatShell
 * =========
 *
 * Presentational frame for the agentic chat: a card with a header
 * (brand + title + primary actions), a body (participant strip + message
 * list) that grows with the conversation, and a footer holding the live
 * run-status line and the input bar (or, once the case is complete, a
 * read-only completion notice). Nothing is position-sticky — the page
 * itself owns the scrollbar.
 *
 * The shell is purely visual; data, hooks and side-effects live in
 * `AgenticChatApp`.
 *
 * @module components/chat/ChatShell
 */
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

import type {
  AgUiEvent,
  AgenticChatLabels,
  ChatMessage,
  InFlightMessage,
  PendingInterrupt,
  Persona,
  PersonaSlotMap,
  RunStatus,
} from '../../types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { PersonaStrip } from './PersonaStrip';
import { RunStatusBadge } from './RunStatusBadge';
import { ThreadActions } from './ThreadActions';
import { DebugEventPanel } from './DebugEventPanel';
import { InterruptPromptCard } from './InterruptPromptCard';
import { findPersonaByAuthor, indexPersonas } from '../../utils/persona-mapping';
import { classifyChatError } from '../../utils/error-classify';

/**
 * Humanise a raw handoff target token (persona key / executor id) when
 * it does not resolve to a known persona, e.g. "persona_2_teacher" →
 * "Teacher 2", "ms_chen" → "Ms Chen".
 */
function humanizeHandoffTarget(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^persona_(\d+)(?:_.*)?$/.exec(raw);
  if (m) return `Teacher ${m[1]}`;
  const cleaned = raw.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Inline error surface shown above the input when a run fails.
 *
 * Some upstream errors are *recoverable only* by starting a new
 * thread - notably OpenAI's "Response with id … not found" 404, which
 * happens when the AG-UI agent's stored `previous_response_id` no
 * longer exists on the OpenAI side (TTL expiry, store=False on a
 * provider, or backend restart between turns). For those cases we
 * promote the alert to a clearer call-to-action with a one-click
 * reset button instead of dumping the raw stack trace at the user.
 */
const ChatErrorBanner: React.FC<{
  message: string;
  showReset: boolean;
  resetLabel: string;
  onReset: () => void;
}> = ({ message, showReset, resetLabel, onReset }) => {
  const classified = classifyChatError(message);
  return (
    <div className="agentic-chat__error alert alert-danger py-2 mb-0" role="alert">
      <div className="d-flex align-items-start">
        <i className="fas fa-exclamation-circle mr-2 mt-1" aria-hidden="true" />
        <div className="flex-grow-1">
          <div className="font-weight-bold">{classified.title}</div>
          <div className="small">{classified.body}</div>
          {classified.detail && (
            <details className="mt-1">
              <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                Technical details
              </summary>
              <pre
                className="small text-muted mb-0 mt-1"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {classified.detail}
              </pre>
            </details>
          )}
          {classified.suggestReset && showReset && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger mt-2"
              onClick={onReset}
            >
              <i className="fas fa-redo mr-1" aria-hidden="true" /> {resetLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Props accepted by the ChatShell presentational component. */
export interface ChatShellProps {
  labels: AgenticChatLabels;
  personas: Persona[];
  slotMap: PersonaSlotMap;
  messages: ChatMessage[];
  inFlight: InFlightMessage[];
  activePersonaKey: string | null;
  /** Raw target of an in-flight handoff tool call, or null. */
  handoffTarget: string | null;
  status: RunStatus;
  isStreaming: boolean;
  caseClosed: boolean;
  errorMessage: string | null;
  showStart: boolean;
  showReset: boolean;
  showPersonaStrip: boolean;
  showRunStatus: boolean;
  showDebug: boolean;
  events: AgUiEvent[];
  autoStartToken: string;
  /** Normalised pending HITL interrupts — rendered as prompt cards. */
  pendingInterrupts: PendingInterrupt[];

  /* Speech-to-text wiring (forwarded to MessageInput). */
  enableSpeechToText: boolean;
  speechToTextModel: string;
  sectionId: number;
  controllerUrl: string;

  onSend: (text: string) => void;
  onStart: () => void;
  onReset: () => void;
}

export const ChatShell: React.FC<ChatShellProps> = ({
  labels,
  personas,
  slotMap,
  messages,
  inFlight,
  activePersonaKey,
  handoffTarget,
  status,
  isStreaming,
  caseClosed,
  errorMessage,
  showStart,
  showReset,
  showPersonaStrip,
  showRunStatus,
  showDebug,
  events,
  autoStartToken,
  pendingInterrupts,
  enableSpeechToText,
  speechToTextModel,
  sectionId,
  controllerUrl,
  onSend,
  onStart,
  onReset,
}) => {
  const inputDisabled = isStreaming || caseClosed || status === 'starting';
  const personasByKey = useMemo(() => indexPersonas(personas), [personas]);

  // The live run status ("Anja is typing…", "Configuring…", "Handing off
  // to X") now sits just above the input — close to where the user is
  // looking — instead of pinned to the header. Terminal/parked states are
  // already conveyed elsewhere (completion notice, interrupt card, error
  // banner), so the bottom status only surfaces the in-progress states.
  const showLiveStatus =
    showRunStatus && !caseClosed && (status === 'starting' || status === 'running' || isStreaming);

  // Resolve the persona currently streaming and the (optional) pending
  // handoff target so the status badge + persona strip can show
  // "X is typing…" vs "Handing off to Y" distinctly.
  const activeSpeaker = activePersonaKey ? personasByKey[activePersonaKey] ?? null : null;
  const handoffPersona = useMemo(
    () => findPersonaByAuthor(personas, slotMap, handoffTarget),
    [personas, slotMap, handoffTarget]
  );
  const handoffTargetName = handoffPersona?.name ?? humanizeHandoffTarget(handoffTarget);
  // Most recent assistant message text — used to suppress an
  // interrupt card body that just restates what the user has already
  // read in the message stream above the card.
  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
        return m.content;
      }
    }
    return undefined;
  }, [messages]);

  return (
    <section className="agentic-chat">
      <header className="agentic-chat__header">
        <div className="agentic-chat__title-row">
          <div className="agentic-chat__brand">
            <div className="agentic-chat__brand-icon" aria-hidden="true">
              <i className="fas fa-robot" />
            </div>
            {labels.title && (
              <h5 className="agentic-chat__title text-truncate">{labels.title}</h5>
            )}
          </div>
        </div>
        {labels.description && (
          <div className="agentic-chat__description">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {labels.description}
            </ReactMarkdown>
          </div>
        )}
        {(showStart || (showReset && !caseClosed)) && (
          <ThreadActions
            startLabel={labels.startLabel}
            resetLabel={labels.resetLabel}
            showStart={showStart}
            showReset={showReset && !caseClosed}
            disabled={isStreaming}
            onStart={onStart}
            onReset={onReset}
          />
        )}
      </header>

      {showPersonaStrip && (
        <PersonaStrip
          personas={personas}
          slotMap={slotMap}
          activePersonaKey={activePersonaKey}
          handoffTargetKey={handoffPersona?.key ?? null}
        />
      )}

      <div className="agentic-chat__body">
        <MessageList
          messages={messages}
          inFlight={inFlight}
          personas={personas}
          slotMap={slotMap}
          autoStartToken={autoStartToken}
          isStreaming={isStreaming}
        />
        {status === 'awaiting_input' && pendingInterrupts.length > 0 && (
          <div className="agentic-chat__interrupts">
            {pendingInterrupts.map((interrupt, idx) => {
              const personaKey = interrupt.authorPersonaKey;
              const persona = personaKey ? personasByKey[personaKey] ?? null : null;
              return (
                <InterruptPromptCard
                  key={interrupt.interruptId}
                  interrupt={interrupt}
                  persona={persona}
                  showDebug={showDebug}
                  index={idx + 1}
                  total={pendingInterrupts.length}
                  lastAssistantMessage={lastAssistantMessage}
                />
              );
            })}
          </div>
        )}
      </div>

      {errorMessage && (
        <ChatErrorBanner
          message={errorMessage}
          showReset={showReset}
          resetLabel={labels.resetLabel}
          onReset={onReset}
        />
      )}

      <div className="agentic-chat__footer">
        {caseClosed ? (
          <div className="agentic-chat__completion" role="status">
            <div className="agentic-chat__completion-text">
              <i className="fas fa-check-circle agentic-chat__completion-icon" aria-hidden="true" />
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {labels.completionMessage || 'This thread is complete.'}
              </ReactMarkdown>
            </div>
            {showReset && (
              <button
                type="button"
                className="btn btn-primary btn-sm agentic-chat__new-thread"
                onClick={onReset}
              >
                <i className="fas fa-redo mr-1" aria-hidden="true" /> {labels.resetLabel}
              </button>
            )}
          </div>
        ) : (
          <>
            {showLiveStatus && (
              <div className="agentic-chat__statusbar">
                <RunStatusBadge
                  status={status}
                  isStreaming={isStreaming}
                  caseClosed={caseClosed}
                  activeSpeakerName={activeSpeaker?.name ?? null}
                  handoffTargetName={handoffTargetName}
                  labels={{
                    idle: labels.statusIdle,
                    running: labels.statusRunning,
                    complete: labels.statusComplete,
                    error: labels.statusError,
                  }}
                />
              </div>
            )}
            <MessageInput
              placeholder={labels.placeholder}
              sendLabel={labels.sendLabel}
              disabled={inputDisabled}
              onSend={onSend}
              enableSpeechToText={enableSpeechToText}
              speechToTextModel={speechToTextModel}
              sectionId={sectionId}
              controllerUrl={controllerUrl}
            />
          </>
        )}
      </div>

      {showDebug && <DebugEventPanel events={events} />}
    </section>
  );
};
