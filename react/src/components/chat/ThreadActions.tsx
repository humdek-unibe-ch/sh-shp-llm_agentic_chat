/**
 * ThreadActions - start / reset / end chat buttons in the chat header.
 */
import React from 'react';

export interface ThreadActionsProps {
  startLabel: string;
  resetLabel: string;
  endLabel: string;
  showStart: boolean;
  showReset: boolean;
  showEnd: boolean;
  disabled?: boolean;
  onStart: () => void;
  onReset: () => void;
  onEnd: () => void;
}

export const ThreadActions: React.FC<ThreadActionsProps> = ({
  startLabel,
  resetLabel,
  endLabel,
  showStart,
  showReset,
  showEnd,
  disabled,
  onStart,
  onReset,
  onEnd,
}) => {
  if (!showStart && !showReset && !showEnd) return null;

  return (
    <div className="agentic-actions">
      {showStart && (
        <button
          type="button"
          className="btn btn-outline-primary btn-sm agentic-actions__btn agentic-actions__btn--start"
          onClick={onStart}
          disabled={disabled}
        >
          {startLabel}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm agentic-actions__btn agentic-actions__btn--reset"
          onClick={onReset}
          disabled={disabled}
        >
          {resetLabel}
        </button>
      )}
      {showEnd && (
        <button
          type="button"
          className="btn btn-outline-danger btn-sm agentic-actions__btn agentic-actions__btn--end"
          onClick={onEnd}
          disabled={disabled}
        >
          <i className="fas fa-flag-checkered mr-1" aria-hidden="true" /> {endLabel}
        </button>
      )}
    </div>
  );
};
