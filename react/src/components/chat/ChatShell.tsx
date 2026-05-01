/**
 * ChatShell
 * =========
 *
 * Presentational frame for the agentic chat. Mirrors the visual layout
 * of the base `sh-shp-llm` chat: a Bootstrap card with a sticky header
 * (title, status badge, primary actions), a scrolling body (persona
 * strip + message list), an optional completion banner, and a footer
 * containing the input bar (or a completion notice).
 *
 * The shell is purely visual; data, hooks and side-effects live in
 * `AgenticChatApp`.
 *
 * @module components/chat/ChatShell
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

import type {
  AgUiEvent,
  AgenticChatLabels,
  ChatMessage,
  InFlightMessage,
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
import { classifyChatError } from '../../utils/error-classify';

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
  enableSpeechToText,
  speechToTextModel,
  sectionId,
  controllerUrl,
  onSend,
  onStart,
  onReset,
}) => {
  const inputDisabled = isStreaming || caseClosed || status === 'starting';

  return (
    <section className="agentic-chat card border-0 shadow-sm">
      <header className="agentic-chat__header card-header bg-white border-bottom">
        <div className="agentic-chat__title-row">
          <div className="d-flex align-items-center" style={{ minWidth: 0, flex: 1 }}>
            <div
              className="bg-primary rounded-circle d-flex align-items-center justify-content-center mr-3 flex-shrink-0"
              style={{ width: '40px', height: '40px' }}
              aria-hidden="true"
            >
              <i className="fas fa-robot text-white" />
            </div>
            {labels.title && (
              <h5 className="agentic-chat__title mb-0 text-truncate">{labels.title}</h5>
            )}
          </div>
          {showRunStatus && (
            <RunStatusBadge
              status={status}
              isStreaming={isStreaming}
              caseClosed={caseClosed}
              labels={{
                idle: labels.statusIdle,
                running: labels.statusRunning,
                complete: labels.statusComplete,
                error: labels.statusError,
              }}
            />
          )}
        </div>
        {labels.description && (
          <div className="agentic-chat__description">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {labels.description}
            </ReactMarkdown>
          </div>
        )}
        {(showStart || showReset) && (
          <ThreadActions
            startLabel={labels.startLabel}
            resetLabel={labels.resetLabel}
            showStart={showStart}
            showReset={showReset}
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
        />
      )}

      <div className="agentic-chat__body card-body p-0 d-flex flex-column">
        <MessageList
          messages={messages}
          inFlight={inFlight}
          personas={personas}
          slotMap={slotMap}
          autoStartToken={autoStartToken}
          isStreaming={isStreaming}
        />
      </div>

      {errorMessage && (
        <ChatErrorBanner
          message={errorMessage}
          showReset={showReset}
          resetLabel={labels.resetLabel}
          onReset={onReset}
        />
      )}

      <div className="agentic-chat__footer card-footer bg-white border-top">
        {caseClosed ? (
          <div className="agentic-chat__completion alert alert-success mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {labels.completionMessage || 'This thread is complete.'}
            </ReactMarkdown>
            {showReset && (
              <button
                type="button"
                className="btn btn-primary btn-sm mt-2"
                onClick={onReset}
              >
                <i className="fas fa-redo mr-1" aria-hidden="true" /> {labels.resetLabel}
              </button>
            )}
          </div>
        ) : (
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
        )}
      </div>

      {showDebug && <DebugEventPanel events={events} />}
    </section>
  );
};
