/**
 * usePendingInterrupts - keeps a small list of HITL interrupts the user
 * needs to answer before the run can resume.
 */
import { useCallback, useState } from 'react';
import type { AgUiEvent, PendingInterrupt } from '../types';
import { tryParseInterrupt } from '../utils/ag-ui-events';

export interface UsePendingInterruptsResult {
  interrupts: PendingInterrupt[];
  hasInterrupts: boolean;
  handleAgUiEvent: (event: AgUiEvent) => void;
  resolve: (interruptId: string) => void;
  clear: () => void;
}

export function usePendingInterrupts(): UsePendingInterruptsResult {
  const [interrupts, setInterrupts] = useState<PendingInterrupt[]>([]);

  const handleAgUiEvent = useCallback((event: AgUiEvent) => {
    const parsed = tryParseInterrupt(event);
    if (parsed) {
      setInterrupts((prev) => [...prev, parsed]);
    }
  }, []);

  const resolve = useCallback((interruptId: string) => {
    setInterrupts((prev) => prev.filter((i) => i.interruptId !== interruptId));
  }, []);

  const clear = useCallback(() => setInterrupts([]), []);

  return {
    interrupts,
    hasInterrupts: interrupts.length > 0,
    handleAgUiEvent,
    resolve,
    clear,
  };
}
