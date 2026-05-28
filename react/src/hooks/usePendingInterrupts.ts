/**
 * usePendingInterrupts — keeps the list of HITL interrupts the user
 * needs to answer before the AG-UI run can resume.
 *
 * Every interrupt that lands in state is already in the strict
 * normalised shape (`PendingInterrupt`) the PHP bridge emits. The hook
 * is therefore a thin "accumulate + filter by id" reducer over the
 * stream events plus the initial server seed.
 *
 * Population sources:
 *   1. Initial seed from `agenticChatThreads.pending_interrupts` on
 *      page load (`setInitial`), so a refresh in the middle of a HITL
 *      pause does not drop the resume context.
 *   2. RUN_FINISHED with `outcome.type === 'interrupt'` streamed during
 *      a run.
 *
 * A new run that does NOT pause on a HITL clears the list automatically
 * via the explicit `clear()` call from the caller; we deliberately do
 * not auto-clear on RUN_STARTED to avoid a flicker between "awaiting"
 * and "running" states when the user sends a resume message.
 */
import { useCallback, useState } from 'react';
import type { AgUiEvent, PendingInterrupt } from '../types';
import { extractInterruptsFromRunFinished } from '../utils/ag-ui-events';

export interface UsePendingInterruptsResult {
  interrupts: PendingInterrupt[];
  hasInterrupts: boolean;
  /** The most recent interrupt; the one the next user message resumes. */
  current: PendingInterrupt | null;
  handleAgUiEvent: (event: AgUiEvent) => void;
  resolve: (interruptId: string) => void;
  setInitial: (initial: PendingInterrupt[]) => void;
  clear: () => void;
}

export function usePendingInterrupts(): UsePendingInterruptsResult {
  const [interrupts, setInterrupts] = useState<PendingInterrupt[]>([]);

  const handleAgUiEvent = useCallback((event: AgUiEvent) => {
    if (event.type !== 'RUN_FINISHED') return;
    const all = extractInterruptsFromRunFinished(event);
    if (all.length === 0) return;
    setInterrupts((prev) => {
      const seen = new Set(prev.map((i) => i.interruptId));
      const dedup = all.filter((i) => !seen.has(i.interruptId));
      return [...prev, ...dedup];
    });
  }, []);

  const resolve = useCallback((interruptId: string) => {
    setInterrupts((prev) => prev.filter((i) => i.interruptId !== interruptId));
  }, []);

  const setInitial = useCallback((initial: PendingInterrupt[]) => {
    setInterrupts(Array.isArray(initial) ? initial : []);
  }, []);

  const clear = useCallback(() => setInterrupts([]), []);

  return {
    interrupts,
    hasInterrupts: interrupts.length > 0,
    current: interrupts.length > 0 ? interrupts[interrupts.length - 1] : null,
    handleAgUiEvent,
    resolve,
    setInitial,
    clear,
  };
}
