/**
 * RunStatusBadge — tiny pill showing the current run status.
 *
 * Display rules (in priority order):
 *
 *   1. caseClosed / status === 'completed' → "Case complete"
 *   2. status === 'error'                  → error label
 *   3. isStreaming / 'running' / 'starting' → "Thinking..."
 *   4. status === 'awaiting_input'         → "Your turn"
 *   5. else → idle label
 */
import React from 'react';
import type { RunStatus } from '../../types';

export interface RunStatusBadgeProps {
  status: RunStatus;
  isStreaming: boolean;
  caseClosed: boolean;
  labels: {
    idle: string;
    running: string;
    complete: string;
    error: string;
    /** Optional: shown when the agent is paused on a HITL interrupt. */
    awaitingInput?: string;
  };
}

export const RunStatusBadge: React.FC<RunStatusBadgeProps> = ({
  status,
  isStreaming,
  caseClosed,
  labels,
}) => {
  let label = labels.idle;
  let cssMod = 'idle';

  if (caseClosed || status === 'completed') {
    label = labels.complete;
    cssMod = 'complete';
  } else if (status === 'error') {
    label = labels.error;
    cssMod = 'error';
  } else if (isStreaming || status === 'running' || status === 'starting') {
    label = labels.running;
    cssMod = 'running';
  } else if (status === 'awaiting_input') {
    label = labels.awaitingInput || labels.idle;
    cssMod = 'awaiting';
  }

  return (
    <span className={`agentic-status agentic-status--${cssMod}`} aria-live="polite">
      {label}
    </span>
  );
};
