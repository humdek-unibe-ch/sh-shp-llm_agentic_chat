/**
 * useRunStatus - tracks the AG-UI run lifecycle.
 *
 *   idle -> starting -> running -> completed
 *                              |-> error
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
        setStatus('running');
        break;
      case 'TEXT_MESSAGE_END': {
        // The mediator marks termination by ending its synthesis with
        // "Case complete." - mark case closed but keep run lifecycle
        // controlled by RUN_FINISHED.
        // The AG-UI event itself doesn't carry the message body, so the
        // outer message hook is responsible for content checks. This
        // hook only watches a separate CUSTOM "case_complete" signal if
        // the backend ever emits one.
        break;
      }
      case 'RUN_FINISHED':
        setStatus((prev) => (prev === 'error' ? prev : 'completed'));
        break;
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
    // chunk-style event variant.
    if (event.type === 'TEXT_MESSAGE_CHUNK' && typeof event.delta === 'string') {
      if (event.delta.toLowerCase().includes(caseCompleteMarker.toLowerCase())) {
        setCaseClosed(true);
      }
    }
  }, [caseCompleteMarker]);

  const markComplete = useCallback(() => setStatus('completed'), []);
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
