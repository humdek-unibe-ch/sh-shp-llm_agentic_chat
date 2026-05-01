/**
 * useRunStatus — tracks the AG-UI run lifecycle.
 *
 * State machine:
 *
 *   idle ──beginStarting()──► starting ──RUN_STARTED──► running
 *     ▲                                                   │
 *     │                                                   ▼
 *     └──RUN_FINISHED (no interrupt)──────────── awaiting_input ◄── RUN_FINISHED + interrupt[]
 *                                                         │
 *                          ┌──────────────────────────────┘
 *                          ▼
 *               case_complete CUSTOM    ─────────► completed
 *               or trailing "Case complete." text
 *
 *               RUN_ERROR / PROXY_ERROR ──────────► error
 *
 * IMPORTANT: a RUN_FINISHED event no longer drives the UI to the
 * `completed` state on its own. The previous behaviour caused the
 * "Case complete" badge to appear after every assistant turn because
 * every successful run terminates with a RUN_FINISHED. The terminal
 * state is now driven explicitly by `markComplete` / `case_complete`.
 */
import { useCallback, useState } from 'react';
import type { AgUiEvent, RunStatus } from '../types';

export interface UseRunStatusResult {
  status: RunStatus;
  error: string | null;
  caseClosed: boolean;
  beginStarting: () => void;
  handleAgUiEvent: (event: AgUiEvent) => void;
  markComplete: () => void;
  markError: (error: string) => void;
  reset: () => void;
}

export interface UseRunStatusOptions {
  caseCompleteMarker: string;
}

export function useRunStatus({ caseCompleteMarker }: UseRunStatusOptions): UseRunStatusResult {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [caseClosed, setCaseClosed] = useState(false);

  const beginStarting = useCallback(() => {
    setStatus('starting');
    setError(null);
  }, []);

  const handleAgUiEvent = useCallback((event: AgUiEvent) => {
    switch (event.type) {
      case 'RUN_STARTED':
        setStatus((prev) => (prev === 'error' ? prev : 'running'));
        break;

      case 'RUN_FINISHED': {
        // RUN_FINISHED only signals "this turn is over". Whether the
        // case is closed or the agent paused on a HITL is decided by:
        //   - presence of `interrupt[]` on the event itself (HITL pause)
        //   - the presence of `case_complete` CUSTOM event
        //   - the trailing "Case complete." text marker
        // We move from `running` to `awaiting_input` if interrupts are
        // attached, otherwise back to `idle`. The terminal `completed`
        // status is set by `markComplete()` from outside.
        const rawInterrupts = (event.interrupt ?? event.interrupts) as unknown;
        const hasInterrupt = Array.isArray(rawInterrupts) && rawInterrupts.length > 0;
        setStatus((prev) => {
          if (prev === 'error' || prev === 'completed') return prev;
          return hasInterrupt ? 'awaiting_input' : 'idle';
        });
        break;
      }

      case 'RUN_ERROR':
      case 'PROXY_ERROR':
        setStatus('error');
        setError(typeof event.message === 'string' ? event.message : 'Run failed');
        break;

      case 'CUSTOM':
        if (event.name === 'case_complete') {
          setCaseClosed(true);
        }
        break;

      default:
        break;
    }

    // Lightweight body-text check for the case-complete marker on the
    // chunk-style event variant (some workflows emit text without
    // explicit START/END pairs).
    if (event.type === 'TEXT_MESSAGE_CHUNK' && typeof event.delta === 'string') {
      if (event.delta.toLowerCase().includes(caseCompleteMarker.toLowerCase())) {
        setCaseClosed(true);
      }
    }
  }, [caseCompleteMarker]);

  const markComplete = useCallback(() => {
    setStatus('completed');
    setCaseClosed(true);
  }, []);

  const markError = useCallback((msg: string) => {
    setStatus('error');
    setError(msg);
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setCaseClosed(false);
  }, []);

  return {
    status,
    error,
    caseClosed,
    beginStarting,
    handleAgUiEvent,
    markComplete,
    markError,
    reset,
  };
}
