/**
 * ThreadList — paginated table of agenticChatThreads rows.
 *
 * @module components/threads/ThreadList
 */
import React from 'react';
import type { ThreadListResponse, ThreadListRow } from '../../types';
import { StatusBadge } from './StatusBadge';

export interface ThreadListProps {
  data: ThreadListResponse | null;
  loading: boolean;
  selectedId: number | null;
  onSelect: (row: ThreadListRow) => void;
  onChangePage: (page: number) => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

/** ThreadList component. */
export const ThreadList: React.FC<ThreadListProps> = ({
  data,
  loading,
  selectedId,
  onSelect,
  onChangePage,
}) => {
  if (loading && !data) {
    return (
      <div className="d-flex justify-content-center align-items-center py-4">
        <div className="spinner-border text-primary" role="status">
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <p className="text-muted small mb-0 py-3 text-center">
        No threads match the current filters.
      </p>
    );
  }

  return (
    <>
      <div className="table-responsive">
        <table className="table table-sm agentic-threads-table mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Section</th>
              <th>Status</th>
              <th>Messages</th>
              <th>Tokens</th>
              <th>Updated</th>
              <th>AG-UI thread</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const tokensStr = row.usage_total_tokens != null
                ? `${row.usage_total_tokens}`
                : '—';
              return (
                <tr
                  key={row.id}
                  className={selectedId === row.id ? 'active' : ''}
                  onClick={() => onSelect(row)}
                >
                  <td className="thread-id">#{row.id}</td>
                  <td>
                    <div>{row.user_name || row.user_email || `user #${row.id_users}`}</div>
                    {row.user_email && <small className="text-muted d-block">{row.user_email}</small>}
                  </td>
                  <td>{row.id_sections ?? '—'}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td>{row.message_count}</td>
                  <td>{tokensStr}</td>
                  <td><small>{formatDate(row.updated_at)}</small></td>
                  <td className="thread-id text-truncate" style={{ maxWidth: 220 }} title={row.agui_thread_id}>
                    {row.agui_thread_id}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.pages > 1 && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div className="text-muted small">
            {data.total} thread{data.total === 1 ? '' : 's'} · page {data.page}/{data.pages}
          </div>
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={data.page <= 1 || loading}
              onClick={() => onChangePage(Math.max(1, data.page - 1))}
            >
              <i className="fa fa-chevron-left"></i>
            </button>
            <button type="button" className="btn btn-outline-secondary" disabled>
              {data.page}/{data.pages}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={data.page >= data.pages || loading}
              onClick={() => onChangePage(Math.min(data.pages, data.page + 1))}
            >
              <i className="fa fa-chevron-right"></i>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
