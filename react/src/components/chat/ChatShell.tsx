/**
 * ChatShell - presentational frame: header (title, status, actions), body
 * (persona strip + message list), footer (input or completion notice),
 * optional debug panel.
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
  onSend,
  onStart,
  onReset,
}) => {
  const inputDisabled = isStreaming || caseClosed || status === 'starting';

  return (
    <section className="agentic-chat">
      <header className="agentic-chat__header">
        <div className="agentic-chat__title-row">
          <h3 className="agentic-chat__title">{labels.title}</h3>
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
        <ThreadActions
          startLabel={labels.startLabel}
          resetLabel={labels.resetLabel}
          showStart={showStart}
          showReset={showReset}
          disabled={isStreaming}
          onStart={onStart}
          onReset={onReset}
        />
      </header>

      {showPersonaStrip && (
        <PersonaStrip
          personas={personas}
          slotMap={slotMap}
          activePersonaKey={activePersonaKey}
        />
      )}

      <MessageList
        messages={messages}
        inFlight={inFlight}
        personas={personas}
        slotMap={slotMap}
        autoStartToken={autoStartToken}
      />

      {errorMessage && (
        <div className="agentic-chat__error alert alert-danger" role="alert">
          {errorMessage}
        </div>
      )}

      {caseClosed ? (
        <div className="agentic-chat__completion alert alert-success">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {labels.completionMessage || 'This thread is complete.'}
          </ReactMarkdown>
          {showReset && (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-2"
              onClick={onReset}
            >
              {labels.resetLabel}
            </button>
          )}
        </div>
      ) : (
        <MessageInput
          placeholder={labels.placeholder}
          sendLabel={labels.sendLabel}
          disabled={inputDisabled}
          onSend={onSend}
        />
      )}

      {showDebug && <DebugEventPanel events={events} />}
    </section>
  );
};
