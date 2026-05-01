/**
 * ThreadDetail — selected thread inspector with tabs:
 *   - Messages: chronological visible message log; each user message
 *     carries a "copy" toolbar to send the same payload via Postman/curl.
 *   - Debug: persona slot map + pending interrupts + debug events,
 *     plus the developer "playground" with /reflect/configure and
 *     /reflect bodies + curl one-liners.
 *   - Raw: full thread row with usage and metadata.
 *
 * @module components/threads/ThreadDetail
 */
import React, { useMemo, useState } from 'react';
import type {
  ThreadDetail as ThreadDetailData,
  ThreadDetailMessage,
  ThreadPlaygroundPayloads,
} from '../../types';
import { StatusBadge } from './StatusBadge';
import { CopyButton } from '../shared/CopyButton';
import { buildCurlPost, buildRunBodyFor, prettyJson } from '../../utils/playground';

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
  return prettyJson(value);
}

/* ---------- Single message row ----------------------------------------- */

interface MessageProps {
  msg: ThreadDetailMessage;
  playground: ThreadPlaygroundPayloads | undefined;
}

const Message: React.FC<MessageProps> = ({ msg, playground }) => {
  const role = (msg.role || 'assistant').toLowerCase();
  const isUser = role === 'user';

  // Lazy: rebuild the body fresh on every click so each Postman replay
  // gets a fresh `run_id` / `messages[0].id` UUID. Building it inline
  // would freeze the UUIDs at render time.
  const buildBody = () => {
    if (!playground) return '';
    return prettyJson(
      buildRunBodyFor(playground.run.body_template, msg.content)
    );
  };

  const buildCurl = () => {
    if (!playground) return '';
    return buildCurlPost(
      playground.run.url,
      buildRunBodyFor(playground.run.body_template, msg.content),
      { stream: true }
    );
  };

  return (
    <div className={`agentic-threads-detail__message agentic-threads-detail__message--${role}`}>
      <div className="agentic-threads-detail__message-meta">
        <strong>{role}</strong>
        <span>·</span>
        <span>#{msg.id}</span>
        <span>·</span>
        <span>{formatDate(msg.created_at)}</span>
        {msg.is_validated ? <span className="badge badge-success">validated</span> : null}
        {isUser && playground && (
          <div className="agentic-threads-detail__message-actions">
            <CopyButton
              value={buildBody}
              label="JSON"
              title="Copy /reflect JSON body for this user message (fresh run_id)"
              variant="outline-primary"
            />
            <CopyButton
              value={buildCurl}
              label="curl"
              title="Copy curl one-liner that streams /reflect with this message"
              variant="outline-secondary"
            />
          </div>
        )}
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

/* ---------- Playground card (Debug tab) -------------------------------- */

interface PlaygroundCardProps {
  title: string;
  url: string;
  body: Record<string, unknown>;
  /** True when the call returns text/event-stream (adds -N to curl). */
  stream?: boolean;
  /** Short hint shown next to the title. */
  hint?: string;
  defaultOpen?: boolean;
}

const PlaygroundCard: React.FC<PlaygroundCardProps> = ({
  title, url, body, stream = false, hint, defaultOpen = false,
}) => {
  const bodyJson = useMemo(() => prettyJson(body), [body]);
  const curlString = useMemo(
    () => buildCurlPost(url, body, { stream }),
    [url, body, stream]
  );

  return (
    <div className="agentic-threads-playground">
      <div className="agentic-threads-playground__header">
        <h6>{title}</h6>
        {hint && <span className="text-muted">{hint}</span>}
        <div className="agentic-threads-playground__actions">
          <CopyButton
            value={bodyJson}
            label="JSON"
            title={`Copy ${title} JSON body`}
            variant="outline-primary"
          />
          <CopyButton
            value={curlString}
            label="curl"
            title={`Copy ${title} as a curl one-liner`}
            variant="outline-secondary"
          />
          <CopyButton
            value={url}
            label="URL"
            title="Copy endpoint URL"
            variant="outline-secondary"
          />
        </div>
      </div>
      <div className="agentic-threads-playground__url">
        <strong>POST</strong>{url}
      </div>
      <details open={defaultOpen}>
        <summary>Show JSON body</summary>
        <pre className="agentic-threads-detail__json">{bodyJson}</pre>
      </details>
      <details>
        <summary>Show curl one-liner</summary>
        <pre className="agentic-threads-detail__json">{curlString}</pre>
      </details>
    </div>
  );
};

/* ---------- Component -------------------------------------------------- */

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

  const playground = detail.playground;

  return (
    <div className="agentic-threads-detail">
      <div className="agentic-threads-detail__header">
        <div className="d-flex align-items-center mr-auto" style={{ gap: '0.5rem' }}>
          <h5 className="mb-0">Thread #{t.id}</h5>
          <StatusBadge status={t.status} />
          {t.is_completed ? <span className="badge badge-success">completed</span> : null}
        </div>
        {playground && (
          <CopyButton
            value={t.agui_thread_id}
            label="thread_id"
            title="Copy AG-UI thread_id"
            variant="outline-secondary"
          />
        )}
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
              detail.messages.map((m) => (
                <Message key={m.id} msg={m} playground={playground} />
              ))
            )}
          </div>
        )}

        {tab === 'debug' && (
          <div>
            {playground && (
              <>
                <PlaygroundCard
                  title="1. POST /reflect/configure"
                  hint="Initialise this thread (personas + module content)"
                  url={playground.configure.url}
                  body={playground.configure.body}
                />
                <PlaygroundCard
                  title="2. POST /reflect"
                  hint="Send a user turn (replace messages[0].content / run_id)"
                  url={playground.run.url}
                  body={playground.run.body_template}
                  stream={true}
                />
              </>
            )}

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
