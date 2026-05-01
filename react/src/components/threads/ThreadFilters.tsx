/**
 * ThreadFilters — filter inputs above the threads table.
 *
 * Mirrors the multi-select UX used by `sh-shp-llm`'s admin console:
 * users and sections are picked from a dropdown (populated from the
 * `filter_options` API endpoint) instead of being typed by id. The
 * caller is responsible for fetching the option lists; this component
 * is purely presentational.
 *
 * @module components/threads/ThreadFilters
 */
import React from 'react';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';

export interface ThreadFiltersValue {
  query: string;
  status: string;
  /** Selected user ids (multi-select). */
  user_ids: number[];
  /** Selected section ids (multi-select). */
  section_ids: number[];
}

export interface ThreadFiltersProps {
  value: ThreadFiltersValue;
  statuses: string[];
  userOptions: MultiSelectOption[];
  sectionOptions: MultiSelectOption[];
  loadingOptions?: boolean;
  onChange: (patch: Partial<ThreadFiltersValue>) => void;
  onReset: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

/** ThreadFilters component. */
export const ThreadFilters: React.FC<ThreadFiltersProps> = ({
  value,
  statuses,
  userOptions,
  sectionOptions,
  loadingOptions,
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
        <label className="small font-weight-bold mb-1">Users</label>
        <MultiSelect
          value={value.user_ids}
          options={userOptions}
          placeholder={loadingOptions ? 'Loading…' : 'All users'}
          disabled={loadingOptions}
          ariaLabel="Filter by users"
          onChange={(next) => onChange({ user_ids: next })}
        />
      </div>
      <div>
        <label className="small font-weight-bold mb-1">Sections</label>
        <MultiSelect
          value={value.section_ids}
          options={sectionOptions}
          placeholder={loadingOptions ? 'Loading…' : 'All sections'}
          disabled={loadingOptions}
          ariaLabel="Filter by sections"
          onChange={(next) => onChange({ section_ids: next })}
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
