/**
 * ThreadActions - reset / start buttons in the chat header.
 */
import React from 'react';

export interface ThreadActionsProps {
  startLabel: string;
  resetLabel: string;
  showStart: boolean;
  showReset: boolean;
  disabled?: boolean;
  onStart: () => void;
  onReset: () => void;
}

export const ThreadActions: React.FC<ThreadActionsProps> = ({
  startLabel,
  resetLabel,
  showStart,
  showReset,
  disabled,
  onStart,
  onReset,
}) => {
  if (!showStart && !showReset) return null;

  return (
    <div className="agentic-actions">
      {showStart && (
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={onStart}
          disabled={disabled}
        >
          {startLabel}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onReset}
          disabled={disabled}
        >
          {resetLabel}
        </button>
      )}
    </div>
  );
};
