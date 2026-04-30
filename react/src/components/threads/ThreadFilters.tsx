/**
 * ThreadFilters — filter inputs above the threads table.
 *
 * @module components/threads/ThreadFilters
 */
import React from 'react';

export interface ThreadFiltersValue {
  query: string;
  status: string;
  user_id: string;
  section_id: string;
}

export interface ThreadFiltersProps {
  value: ThreadFiltersValue;
  statuses: string[];
  onChange: (patch: Partial<ThreadFiltersValue>) => void;
  onReset: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

/** ThreadFilters component. */
export const ThreadFilters: React.FC<ThreadFiltersProps> = ({
  value,
  statuses,
  onChange,
  onReset,
  onRefresh,
  refreshing,
}) => {
  return (
    <div className="agentic-threads__filters">
      <div>
        <label className="small font-weight-bold mb-1" htmlFor="thr-query">Search</label>
        <input
          id="thr-query"
          type="text"
          className="form-control form-control-sm"
          value={value.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="thread id, title, email…"
        />
      </div>
      <div>
        <label className="small font-weight-bold mb-1" htmlFor="thr-status">Status</label>
        <select
          id="thr-status"
          className="form-control form-control-sm"
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value })}
        >
          <option value="">All</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="small font-weight-bold mb-1" htmlFor="thr-user">User id</label>
        <input
          id="thr-user"
          type="number"
          className="form-control form-control-sm"
          value={value.user_id}
          onChange={(e) => onChange({ user_id: e.target.value })}
          placeholder="all users"
        />
      </div>
      <div>
        <label className="small font-weight-bold mb-1" htmlFor="thr-section">Section id</label>
        <input
          id="thr-section"
          type="number"
          className="form-control form-control-sm"
          value={value.section_id}
          onChange={(e) => onChange({ section_id: e.target.value })}
          placeholder="all sections"
        />
      </div>
      <div className="d-flex">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary mr-2"
          onClick={onReset}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <><span className="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span>…</>
          ) : (
            <><i className="fa fa-sync mr-1"></i>Refresh</>
          )}
        </button>
      </div>
    </div>
  );
};
