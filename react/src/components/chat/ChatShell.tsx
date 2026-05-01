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
        />
      </div>

      {errorMessage && (
        <div className="agentic-chat__error alert alert-danger py-2 mb-0" role="alert">
          <i className="fas fa-exclamation-circle mr-2" aria-hidden="true" />
          {errorMessage}
        </div>
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
