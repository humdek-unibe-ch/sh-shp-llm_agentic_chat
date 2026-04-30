/**
 * RunStatusBadge - tiny pill showing the current run status.
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
  }

  return (
    <span className={`agentic-status agentic-status--${cssMod}`} aria-live="polite">
      {label}
    </span>
  );
};
