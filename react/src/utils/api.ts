/**
 * Same-origin API helpers shared by the chat and admin bundles.
 *
 * The CMS exposes the controller as the current page's URL itself; we
 * just attach action / section_id query params and parse JSON.
 */

import type { ThreadView, AgenticChatConfig, AdminInitialState, BackendSettings, Persona } from '../types';

export interface ApiOk<T> { ok: true; data: T; }
export interface ApiErr { ok: false; error: string; status: number; }
export type ApiResult<T> = ApiOk<T> | ApiErr;

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: BodyInit | Record<string, unknown> | null;
  signal?: AbortSignal;
}

async function request<T>(url: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const init: RequestInit = {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    signal: opts.signal,
  };

  if (opts.body instanceof FormData || opts.body instanceof URLSearchParams) {
    init.body = opts.body;
  } else if (opts.body && typeof opts.body === 'object') {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'Content-Type': 'application/json' };
  } else if (opts.body) {
    init.body = opts.body;
  }

  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error', status: 0 };
  }

  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}`, status: resp.status };
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, error: 'Invalid JSON response', status: resp.status };
  }

  if (json && typeof json === 'object' && (json as Record<string, unknown>).error) {
    return {
      ok: false,
      error: String((json as Record<string, unknown>).error),
      status: resp.status,
    };
  }

  return { ok: true, data: json as T };
}

/* ---------- Chat-side --------------------------------------------------- */

export interface ChatApi {
  getConfig(): Promise<ApiResult<{ ok: boolean; config: AgenticChatConfig; thread: ThreadView }>>;
  getThread(): Promise<ApiResult<{ ok: boolean; thread: ThreadView }>>;
  startThread(payload?: Record<string, unknown>): Promise<ApiResult<{ ok: boolean; thread: ThreadView }>>;
  resetThread(): Promise<ApiResult<{ ok: boolean; thread: ThreadView }>>;
  buildStreamUrl(): string;
}

export function createChatApi(controllerUrl: string, sectionId: number): ChatApi {
  const sep = controllerUrl.includes('?') ? '&' : '?';
  const url = (action: string) =>
    `${controllerUrl}${sep}action=${encodeURIComponent(action)}&section_id=${encodeURIComponent(String(sectionId))}`;

  return {
    getConfig: () => request(url('get_config'), { method: 'GET' }),
    getThread: () => request(url('get_thread'), { method: 'GET' }),
    startThread: (payload) => {
      const body = new URLSearchParams();
      body.set('action', 'start_thread');
      body.set('section_id', String(sectionId));
      if (payload) {
        Object.entries(payload).forEach(([k, v]) => {
          body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        });
      }
      return request(controllerUrl, { method: 'POST', body });
    },
    resetThread: () => {
      const body = new URLSearchParams();
      body.set('action', 'reset_thread');
      body.set('section_id', String(sectionId));
      return request(controllerUrl, { method: 'POST', body });
    },
    buildStreamUrl: () => controllerUrl,
  };
}

/* ---------- Admin-side -------------------------------------------------- */

export interface AdminApi {
  getConfig(): Promise<ApiResult<{ ok: boolean; data: AdminInitialState }>>;
  saveBackend(settings: BackendSettings): Promise<ApiResult<{ ok: boolean }>>;
  savePersonas(personas: Persona[]): Promise<ApiResult<{ ok: boolean }>>;
  fetchDefaults(): Promise<ApiResult<{ ok: boolean; data: Record<string, unknown> }>>;
  healthCheck(): Promise<ApiResult<{ ok: boolean; data: Record<string, unknown> }>>;
}

export function createAdminApi(baseUrl: string, csrfToken: string): AdminApi {
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = (action: string) => `${baseUrl}${sep}action=${encodeURIComponent(action)}`;

  // Admin endpoints expect a JSON body (decoded server-side via php://input).
  const post = <T>(action: string, body: Record<string, unknown>): Promise<ApiResult<T>> => {
    return request<T>(url(action), {
      method: 'POST',
      body: { ...body, csrf_token: csrfToken },
    });
  };

  return {
    getConfig: () => request(url('get_config'), { method: 'GET' }),
    saveBackend: (settings) => {
      // The PHP side allow-lists individual field names under "fields".
      const fields = {
        agentic_chat_backend_url: settings.backend_url,
        agentic_chat_reflect_path: settings.reflect_path,
        agentic_chat_configure_path: settings.configure_path,
        agentic_chat_defaults_path: settings.defaults_path,
        agentic_chat_health_path: settings.health_path,
        agentic_chat_timeout: settings.timeout,
        agentic_chat_debug_enabled: settings.debug_enabled ? '1' : '0',
        agentic_chat_default_module: settings.default_module,
      };
      return post('save_config', { fields });
    },
    savePersonas: (personas) => post('save_personas', { personas }),
    fetchDefaults: () => request(url('fetch_defaults'), { method: 'GET' }),
    healthCheck: () => request(url('health_check'), { method: 'GET' }),
  };
}
