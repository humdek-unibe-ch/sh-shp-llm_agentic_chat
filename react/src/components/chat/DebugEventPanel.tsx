/**
 * DebugEventPanel - tiny dev-mode panel listing the last N AG-UI events.
 */
import React, { useState } from 'react';
import type { AgUiEvent } from '../../types';

export interface DebugEventPanelProps {
  events: AgUiEvent[];
  maxItems?: number;
}

export const DebugEventPanel: React.FC<DebugEventPanelProps> = ({ events, maxItems = 50 }) => {
  const [open, setOpen] = useState(false);
  const tail = events.slice(-maxItems);

  return (
    <div className={`agentic-debug${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="agentic-debug__toggle btn btn-link btn-sm"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Show'} debug events ({events.length})
      </button>
      {open && (
        <div className="agentic-debug__list">
          {tail.length === 0 && <em className="text-muted">No events yet</em>}
          {tail.map((ev, idx) => (
            <pre key={idx} className="agentic-debug__item">
              {JSON.stringify(ev, null, 2)}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
};
