/**
 * ThreadsApp — root component for the LLM Agentic Chat threads admin page.
 *
 * Wires together:
 *   - ThreadCounters (banner with total/idle/running/awaiting_input/completed/failed)
 *   - ThreadFilters (query, status, multi-select users + sections)
 *   - ThreadList (paginated table with click-to-select)
 *   - ThreadDetail (messages + debug events + raw JSON)
 *
 * Used by admins to monitor the agenticChatThreads table and inspect AG-UI
 * thread state during development of the FoResTCHAT integration.
 *
 * @module components/threads/ThreadsApp
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ThreadsAdminConfig,
  ThreadCounters as Counters,
  ThreadDetail as ThreadDetailData,
  ThreadListResponse,
  ThreadListRow,
} from '../../types';
import {
  createThreadsApi,
  type ThreadFilterOptions,
  type ThreadListFilters,
} from '../../utils/api';
import type { MultiSelectOption } from './MultiSelect';
import { ThreadCounters } from './ThreadCounters';
import { ThreadFilters, type ThreadFiltersValue } from './ThreadFilters';
import { ThreadList } from './ThreadList';
import { ThreadDetail } from './ThreadDetail';

const DEFAULT_FILTERS: ThreadFiltersValue = {
  query: '',
  status: '',
  user_ids: [],
  section_ids: [],
};

export interface ThreadsAppProps {
  config: ThreadsAdminConfig;
}

/** ThreadsApp component. */
export const ThreadsApp: React.FC<ThreadsAppProps> = ({ config }) => {
  const api = useMemo(() => createThreadsApi(config.baseUrl), [config.baseUrl]);

  const [filters, setFilters] = useState<ThreadFiltersValue>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ThreadListResponse | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingCounters, setLoadingCounters] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Filter options (multi-select dropdowns).
  const [filterOptions, setFilterOptions] = useState<ThreadFilterOptions>({
    users: [],
    sections: [],
  });
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ThreadDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);

  /* ---- list load ---------------------------------------------------- */

  const buildApiFilters = useCallback(
    (p: number): ThreadListFilters => ({
      page: p,
      per_page: 25,
      query: filters.query.trim() || undefined,
      status: filters.status || undefined,
      // Repeated `user_id[]=` / `section_id[]=` params; PHP normalises
      // them into integer arrays in Sh_module_llm_agentic_chat_threadsModel.
      user_id: filters.user_ids.length > 0 ? filters.user_ids : undefined,
      section_id: filters.section_ids.length > 0 ? filters.section_ids : undefined,
    }),
    [filters]
  );

  const loadList = useCallback(
    async (p: number) => {
      setLoadingList(true);
      setListError(null);
      const res = await api.listThreads(buildApiFilters(p));
      setLoadingList(false);
      if (!res.ok) {
        setListError(res.error);
        return;
      }
      const rawData = res.data?.data;
      if (rawData) setData(rawData);
      const rawStatuses = res.data?.statuses;
      if (Array.isArray(rawStatuses)) setStatuses(rawStatuses.filter(Boolean));
    },
    [api, buildApiFilters]
  );

  const loadCounters = useCallback(async () => {
    setLoadingCounters(true);
    const res = await api.getCounters();
    setLoadingCounters(false);
    if (res.ok && res.data?.data) setCounters(res.data.data);
  }, [api]);

  // One-shot fetch of users + sections for the multi-select pickers.
  const loadFilterOptions = useCallback(async () => {
    setLoadingOptions(true);
    const res = await api.getFilterOptions();
    setLoadingOptions(false);
    if (res.ok && res.data?.data) {
      setFilterOptions({
        users: res.data.data.users || [],
        sections: res.data.data.sections || [],
      });
    }
  }, [api]);

  useEffect(() => {
    loadList(1);
    loadCounters();
    loadFilterOptions();
    setPage(1);
  }, [loadList, loadCounters, loadFilterOptions]);

  // Debounce: refetch when filters change.
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setPage(1);
      loadList(1);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.query, filters.status, filters.user_ids, filters.section_ids]);

  /* ---- detail load -------------------------------------------------- */

  const loadDetail = useCallback(
    async (threadId: number) => {
      setLoadingDetail(true);
      setDetailError(null);
      const res = await api.getThreadDetail(threadId);
      setLoadingDetail(false);
      if (!res.ok) {
        setDetailError(res.error);
        return;
      }
      const rawData = res.data?.data;
      if (rawData) setDetail(rawData);
    },
    [api]
  );

  /* ---- handlers ----------------------------------------------------- */

  const handleSelect = (row: ThreadListRow) => {
    setSelectedId(row.id);
    setDetail(null);
    loadDetail(row.id);
  };

  const handleChangePage = (next: number) => {
    setPage(next);
    loadList(next);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const handleRefresh = () => {
    loadList(page);
    loadCounters();
    if (selectedId) loadDetail(selectedId);
  };

  /* ---- render ------------------------------------------------------- */

  // Convert API option lists into the MultiSelect-friendly shape.
  const userOptions: MultiSelectOption[] = filterOptions.users.map((u) => ({
    id: u.id,
    label: u.name || u.email || `User ${u.id}`,
    hint: u.email && u.name ? u.email : undefined,
  }));
  const sectionOptions: MultiSelectOption[] = filterOptions.sections.map((s) => ({
    id: s.id,
    label: s.label,
  }));

  return (
    <div className="agentic-threads">
      <header className="agentic-threads__header">
        <h2 className="mr-auto">Agentic Threads</h2>
        <span className="header-meta">
          Plugin <code>{config.pluginVersion}</code>
          {config.configBaseUrl && (
            <>
              {' · '}
              <a href={config.configBaseUrl}>
                <i className="fa fa-cog mr-1"></i>Configuration
              </a>
            </>
          )}
        </span>
      </header>

      <ThreadCounters counters={counters} loading={loadingCounters && !counters} />

      <div className="card mb-3">
        <div className="card-header">
          <h6 className="mb-0">
            <i className="fa fa-filter mr-2 text-muted"></i>
            Filters
          </h6>
        </div>
        <div className="card-body">
          <ThreadFilters
            value={filters}
            statuses={statuses}
            userOptions={userOptions}
            sectionOptions={sectionOptions}
            loadingOptions={loadingOptions}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onReset={handleReset}
            onRefresh={handleRefresh}
            refreshing={loadingList}
          />
        </div>
      </div>

      {listError && (
        <div className="alert alert-danger small">
          {listError}
        </div>
      )}

      <div className="row">
        <div className="col-lg-7 mb-3">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h6 className="mb-0">
                <i className="fa fa-list mr-2 text-muted"></i>
                Threads
              </h6>
              {data && (
                <small className="text-muted">{data.total} total</small>
              )}
            </div>
            <div className="card-body p-0">
              <ThreadList
                data={data}
                loading={loadingList}
                selectedId={selectedId}
                onSelect={handleSelect}
                onChangePage={handleChangePage}
              />
            </div>
          </div>
        </div>
        <div className="col-lg-5 mb-3">
          <ThreadDetail
            detail={detail}
            loading={loadingDetail}
            error={detailError}
            onRefresh={() => selectedId && loadDetail(selectedId)}
          />
        </div>
      </div>
    </div>
  );
};
