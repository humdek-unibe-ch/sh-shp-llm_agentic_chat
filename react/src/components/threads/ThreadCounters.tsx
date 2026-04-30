/**
 * ThreadCounters — top dashboard banner with aggregate counts of threads
 * by status.
 *
 * @module components/threads/ThreadCounters
 */
import React from 'react';
import type { ThreadCounters as Counters } from '../../types';

export interface ThreadCountersProps {
  counters: Counters | null;
  loading?: boolean;
}

interface Slot {
  key: keyof Counters;
  label: string;
}

const SLOTS: Slot[] = [
  { key: 'total', label: 'Total' },
  { key: 'idle', label: 'Idle' },
  { key: 'running', label: 'Running' },
  { key: 'awaiting_input', label: 'Awaiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

/** ThreadCounters component. */
export const ThreadCounters: React.FC<ThreadCountersProps> = ({ counters, loading }) => {
  return (
    <div className="agentic-threads__counters">
      {SLOTS.map((slot) => {
        const value = counters ? counters[slot.key] : 0;
        return (
          <div
            key={slot.key}
            className={`agentic-threads__counter agentic-threads__counter--${slot.key}`}
          >
            <div className="agentic-threads__counter-label">{slot.label}</div>
            <div className="agentic-threads__counter-value">
              {loading ? <span className="text-muted small">…</span> : value}
            </div>
          </div>
        );
      })}
    </div>
  );
};
