/**
 * StatusBadge — coloured pill for an `agenticChatThreads.status` value.
 *
 * @module components/threads/StatusBadge
 */
import React from 'react';

export interface StatusBadgeProps {
  status: string | null | undefined;
}

/** StatusBadge component. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const safe = (status || 'idle').toLowerCase();
  return (
    <span className={`badge status-badge status-badge--${safe}`}>
      {safe.replace(/_/g, ' ')}
    </span>
  );
};
