/**
 * RunStatusBadge — tiny pill showing the current run status.
 *
 * Display rules (in priority order):
 *
 *   1. caseClosed / status === 'completed'  → "Case complete"
 *   2. status === 'error'                   → error label
 *   3. status === 'starting'                → "Configuring…"
 *   4. handoffTargetName (run live)         → "Handing off to X"
 *   5. isStreaming / 'running'              → "X is typing…" / running label
 *   6. status === 'awaiting_input'          → "Waiting for your reply"
 *   7. else                                 → idle label
 *
 * Separating the streaming-speaker name (rule 5) from the handoff target
 * (rule 4) lets the badge announce a handoff ("Handing off to Lea")
 * without claiming the target is already speaking.
 */
import React from 'react';
import type { RunStatus } from '../../types';

export interface RunStatusBadgeProps {
  status: RunStatus;
  isStreaming: boolean;
  caseClosed: boolean;
  /** Display name of the persona currently streaming (if known). */
  activeSpeakerName?: string | null;
  /** Display name of a pending handoff target (if a handoff is in flight). */
  handoffTargetName?: string | null;
  labels: {
    idle: string;
    running: string;
    complete: string;
    error: string;
    /** Shown while /reflect/configure (and the initial run) is in flight. */
    configuring?: string;
    /** Shown when the agent is paused on a HITL interrupt. */
    awaitingInput?: string;
  };
}

export const RunStatusBadge: React.FC<RunStatusBadgeProps> = ({
  status,
  isStreaming,
  caseClosed,
  activeSpeakerName,
  handoffTargetName,
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
  } else if (status === 'starting') {
    label = labels.configuring || 'Configuring…';
    cssMod = 'configuring';
  } else if (handoffTargetName && (isStreaming || status === 'running')) {
    label = `Handing off to ${handoffTargetName}`;
    cssMod = 'handoff';
  } else if (isStreaming || status === 'running') {
    label = activeSpeakerName ? `${activeSpeakerName} is typing…` : labels.running;
    cssMod = 'running';
  } else if (status === 'awaiting_input') {
    label = labels.awaitingInput || 'Waiting for your reply';
    cssMod = 'awaiting';
  }

  return (
    <span className={`agentic-status agentic-status--${cssMod}`} aria-live="polite">
      {label}
    </span>
  );
};
