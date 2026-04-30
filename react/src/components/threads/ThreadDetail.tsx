/**
 * ThreadDetail — selected thread inspector with tabs:
 *   - Messages: chronological visible message log.
 *   - Debug: persona slot map + pending interrupts + debug events.
 *   - Raw: full thread row with usage and metadata.
 *
 * @module components/threads/ThreadDetail
 */
import React, { useState } from 'react';
import type { ThreadDetail as ThreadDetailData, ThreadDetailMessage } from '../../types';
import { StatusBadge } from './StatusBadge';

export interface ThreadDetailProps {
  detail: ThreadDetailData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

type Tab = 'messages' | 'debug' | 'raw';

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  try {
    const d = new Date(value.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function asPretty(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const Message: React.FC<{ msg: ThreadDetailMessage }> = ({ msg }) => {
  const role = (msg.role || 'assistant').toLowerCase();
  return (
    <div className={`agentic-threads-detail__message agentic-threads-detail__message--${role}`}>
      <div className="agentic-threads-detail__message-meta">
        <strong>{role}</strong>
        <span>·</span>
        <span>#{msg.id}</span>
        <span>·</span>
        <span>{formatDate(msg.created_at)}</span>
        {msg.is_validated ? <span className="badge badge-success ml-auto">validated</span> : null}
      </div>
      <div className="agentic-threads-detail__message-content">{msg.content}</div>
      {msg.sent_context_json && (
        <details className="mt-2">
          <summary className="small text-muted">AG-UI context</summary>
          <pre className="agentic-threads-detail__json mt-1">{asPretty(msg.sent_context_json)}</pre>
        </details>
      )}
    </div>
  );
};

/** ThreadDetail component. */
export const ThreadDetail: React.FC<ThreadDetailProps> = ({
  detail,
  loading,
  error,
  onRefresh,
}) => {
  const [tab, setTab] = useState<Tab>('messages');

  if (loading && !detail) {
    return (
      <div className="agentic-threads-detail">
        <div className="agentic-threads-detail__placeholder">
          <div className="spinner-border text-primary" role="status">
            <span className="sr-only">Loading…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="agentic-threads-detail">
        <div className="agentic-threads-detail__placeholder">
          {error
            ? <span className="text-danger">{error}</span>
            : <span>Select a thread on the left to inspect it here.</span>}
        </div>
      </div>
    );
  }

  // The PHP side returns the row as a flat dictionary; we read fields
  // individually because `agenticChatThreads` carries optional metadata.
  const tRaw = detail.thread as Record<string, unknown>;
  const t = {
    id: detail.thread.id,
    agui_thread_id: detail.thread.agui_thread_id,
    backend_url: detail.thread.backend_url,
    status: detail.thread.status,
    last_run_id: (tRaw.last_run_id as string | null) ?? null,
    is_completed: detail.thread.is_completed,
    last_error: (tRaw.last_error as string | null) ?? null,
    persona_slot_map_json: detail.thread.persona_slot_map_json,
    pending_interrupts_json: detail.thread.pending_interrupts_json,
    debug_meta_json: detail.thread.debug_meta_json,
    usage_total_tokens: (tRaw.usage_total_tokens as number | null) ?? null,
    usage_input_tokens: (tRaw.usage_input_tokens as number | null) ?? null,
    usage_output_tokens: (tRaw.usage_output_tokens as number | null) ?? null,
  };

  return (
    <div className="agentic-threads-detail">
      <div className="agentic-threads-detail__header">
        <div className="d-flex align-items-center mr-auto" style={{ gap: '0.5rem' }}>
          <h5 className="mb-0">Thread #{t.id}</h5>
          <StatusBadge status={t.status} />
          {t.is_completed ? <span className="badge badge-success">completed</span> : null}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          <i className="fa fa-sync mr-1"></i>Reload
        </button>
      </div>

      <div className="agentic-threads-detail__tabs">
        <button
          className={`agentic-threads-detail__tab${tab === 'messages' ? ' active' : ''}`}
          onClick={() => setTab('messages')}
        >
          <i className="fa fa-comments mr-1"></i>
          Messages ({detail.messages.length})
        </button>
        <button
          className={`agentic-threads-detail__tab${tab === 'debug' ? ' active' : ''}`}
          onClick={() => setTab('debug')}
        >
          <i className="fa fa-bug mr-1"></i>
          Debug
        </button>
        <button
          className={`agentic-threads-detail__tab${tab === 'raw' ? ' active' : ''}`}
          onClick={() => setTab('raw')}
        >
          <i className="fa fa-code mr-1"></i>
          Raw
        </button>
      </div>

      <div className="agentic-threads-detail__body">
        {tab === 'messages' && (
          <div className="agentic-threads-detail__messages">
            {detail.messages.length === 0 ? (
              <p className="text-muted small mb-0">No visible messages yet for this thread.</p>
            ) : (
              detail.messages.map((m) => <Message key={m.id} msg={m} />)
            )}
          </div>
        )}

        {tab === 'debug' && (
          <div>
            <div className="form-row mb-3">
              <div className="col-md-6">
                <h6 className="small font-weight-bold mb-1">AG-UI thread id</h6>
                <code className="d-block text-truncate">{t.agui_thread_id}</code>
              </div>
              <div className="col-md-6">
                <h6 className="small font-weight-bold mb-1">Last run id</h6>
                <code className="d-block text-truncate">{t.last_run_id || '—'}</code>
              </div>
            </div>

            <div className="form-row mb-3">
              <div className="col-md-6">
                <h6 className="small font-weight-bold mb-1">Backend URL</h6>
                <code className="d-block text-truncate">{t.backend_url}</code>
              </div>
              <div className="col-md-6">
                <h6 className="small font-weight-bold mb-1">Tokens</h6>
                <div className="small">
                  total {t.usage_total_tokens ?? '—'} · in {t.usage_input_tokens ?? '—'} · out {t.usage_output_tokens ?? '—'}
                </div>
              </div>
            </div>

            {t.last_error && (
              <div className="alert alert-danger small mb-3">
                <strong>Last error:</strong> {t.last_error}
              </div>
            )}

            <h6 className="small font-weight-bold mt-3">Persona slot map</h6>
            <pre className="agentic-threads-detail__json mb-3">{asPretty(t.persona_slot_map_json)}</pre>

            <h6 className="small font-weight-bold mt-3">Pending interrupts</h6>
            <pre className="agentic-threads-detail__json mb-3">{asPretty(t.pending_interrupts_json)}</pre>

            <h6 className="small font-weight-bold mt-3">Debug events</h6>
            <pre className="agentic-threads-detail__json mb-0">{asPretty(t.debug_meta_json)}</pre>
          </div>
        )}

        {tab === 'raw' && (
          <pre className="agentic-threads-detail__json mb-0">{asPretty(detail.thread)}</pre>
        )}
      </div>
    </div>
  );
};
