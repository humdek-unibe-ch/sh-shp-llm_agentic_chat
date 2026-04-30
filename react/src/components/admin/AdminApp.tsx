/**
 * AdminApp - root component for the LLM Agentic Chat admin module page.
 */
import React, { useEffect, useState } from 'react';
import type { AdminConfig, AdminInitialState, BackendSettings, Persona } from '../../types';
import { createAdminApi } from '../../utils/api';
import { BackendSettingsPanel } from './BackendSettingsPanel';
import { PersonaEditor } from './PersonaEditor';

const FALLBACK_BACKEND: BackendSettings = {
  backend_url: 'https://tpf-test.humdek.unibe.ch/forestBackend',
  reflect_path: '/reflect',
  configure_path: '/reflect/configure',
  defaults_path: '/reflect/defaults',
  health_path: '/health',
  timeout: 120,
  debug_enabled: false,
  default_module: '',
};

export interface AdminAppProps {
  config: AdminConfig;
}

export const AdminApp: React.FC<AdminAppProps> = ({ config }) => {
  const api = createAdminApi(config.baseUrl, config.csrfToken);

  const [state, setState] = useState<AdminInitialState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.getConfig();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const raw = res.data?.data ?? null;
      if (!raw || typeof raw !== 'object') {
        setError('Unexpected config response shape');
        return;
      }
      const backend = (raw.backend as BackendSettings) || FALLBACK_BACKEND;
      const personas = Array.isArray(raw.personas) ? (raw.personas as Persona[]) : [];
      setState({ backend, personas });
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl, config.csrfToken]);

  if (error) {
    return (
      <div className="alert alert-danger">
        Failed to load admin config: {error}
      </div>
    );
  }

  if (!state) {
    return (
      <div className="text-muted">
        <i className="fa fa-spinner fa-spin mr-2" /> Loading admin configuration…
      </div>
    );
  }

  const handleSaveBackend = async (settings: BackendSettings) => {
    const res = await api.saveBackend(settings);
    if (!res.ok) return { ok: false, error: res.error };
    setState((prev) => (prev ? { ...prev, backend: settings } : prev));
    return { ok: true };
  };

  const handleSavePersonas = async (personas: Persona[]) => {
    const res = await api.savePersonas(personas);
    if (!res.ok) return { ok: false, error: res.error };
    setState((prev) => (prev ? { ...prev, personas } : prev));
    return { ok: true };
  };

  const handleHealth = async () => {
    const res = await api.healthCheck();
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: res.data?.data ?? res.data };
  };

  const handleDefaults = async () => {
    const res = await api.fetchDefaults();
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: res.data?.data ?? res.data };
  };

  return (
    <div className="agentic-admin">
      <header className="agentic-admin__header mb-3">
        <h2 className="mb-1">LLM Agentic Chat</h2>
        <p className="text-muted small">
          Plugin version <code>{config.pluginVersion}</code> &middot; configures the
          AG-UI backend and the global persona library used by every <code>agenticChat</code> section.
        </p>
      </header>

      <BackendSettingsPanel
        initial={state.backend}
        onSave={handleSaveBackend}
        onTestHealth={handleHealth}
        onFetchDefaults={handleDefaults}
      />

      <PersonaEditor
        initialPersonas={state.personas}
        onSave={handleSavePersonas}
      />
    </div>
  );
};
