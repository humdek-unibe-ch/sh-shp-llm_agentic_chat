/**
 * AdminApp — root component for the LLM Agentic Chat configuration page.
 *
 * Mirrors `sh-shp-llm`'s `SettingsApp` look & feel: card-based panels,
 * dirty-tracked fields, dismissible alerts, and a single sticky
 * "Save Changes" button at the bottom that persists every dirty field
 * in one go.
 *
 * Renders three panels:
 *   - Backend Connection (URLs, paths, timeout, default module)
 *   - Persona Library (compact list with inline edit form)
 *
 * @module components/admin/AdminApp
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { AdminConfig, AdminInitialState, BackendSettings, Persona } from '../../types';
import { createAdminApi } from '../../utils/api';
import { BackendSettingsPanel } from './BackendSettingsPanel';
import { PersonaEditor } from './PersonaEditor';
import { validatePersona } from '../../utils/persona-mapping';

const FALLBACK_BACKEND: BackendSettings = {
  backend_url: 'https://tpf-test.humdek.unibe.ch/forestBackend',
  reflect_path: '/reflect',
  configure_path: '/reflect/configure',
  defaults_path: '/reflect/defaults',
  health_path: '/health',
  timeout: 120,
  default_module: '',
};

export interface AdminAppProps {
  config: AdminConfig;
}

/** AdminApp component. */
export const AdminApp: React.FC<AdminAppProps> = ({ config }) => {
  const api = useMemo(
    () => createAdminApi(config.baseUrl, config.csrfToken),
    [config.baseUrl, config.csrfToken]
  );

  const [initial, setInitial] = useState<AdminInitialState | null>(null);
  const [backend, setBackend] = useState<BackendSettings>(FALLBACK_BACKEND);
  const [personas, setPersonas] = useState<Persona[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* ---- bootstrap ----------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.getConfig();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      const raw = res.data?.data ?? null;
      if (!raw || typeof raw !== 'object') {
        setError('Unexpected config response shape');
        setLoading(false);
        return;
      }
      const b = (raw.backend as BackendSettings) || FALLBACK_BACKEND;
      const p = Array.isArray(raw.personas) ? (raw.personas as Persona[]) : [];
      setInitial({ backend: b, personas: p });
      setBackend(b);
      setPersonas(p);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  /* ---- derived state ------------------------------------------------ */

  const personaErrors = useMemo(() => {
    const all = personas.map((p) => p.key);
    const out: Record<number, string[]> = {};
    personas.forEach((p, i) => {
      const errs = validatePersona(p, all);
      if (errs.length) out[i] = errs;
    });
    return out;
  }, [personas]);
  const totalPersonaErrors = Object.values(personaErrors).reduce((acc, e) => acc + e.length, 0);

  const backendDirty = !!initial && JSON.stringify(backend) !== JSON.stringify(initial.backend);
  const personasDirty = !!initial && JSON.stringify(personas) !== JSON.stringify(initial.personas);
  const dirty = backendDirty || personasDirty;

  /* ---- handlers ----------------------------------------------------- */

  const updateBackend = (patch: Partial<BackendSettings>) => {
    setBackend((prev) => ({ ...prev, ...patch }));
    setSuccess(null);
  };

  const updatePersonas = (next: Persona[]) => {
    setPersonas(next);
    setSuccess(null);
  };

  const reload = async () => {
    const res = await api.getConfig();
    if (!res.ok) return;
    const raw = res.data?.data ?? null;
    if (!raw || typeof raw !== 'object') return;
    const b = (raw.backend as BackendSettings) || FALLBACK_BACKEND;
    const p = Array.isArray(raw.personas) ? (raw.personas as Persona[]) : [];
    setInitial({ backend: b, personas: p });
    setBackend(b);
    setPersonas(p);
  };

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    let savedBackend = false;
    let savedPersonas = false;

    if (backendDirty) {
      const res = await api.saveBackend(backend);
      if (!res.ok) {
        setError(`Failed to save backend settings: ${res.error}`);
        setSaving(false);
        return;
      }
      savedBackend = true;
    }

    if (personasDirty) {
      if (totalPersonaErrors > 0) {
        setError(`Fix ${totalPersonaErrors} persona validation error${totalPersonaErrors === 1 ? '' : 's'} before saving.`);
        setSaving(false);
        return;
      }
      const res = await api.savePersonas(personas);
      if (!res.ok) {
        setError(`Failed to save personas: ${res.error}`);
        setSaving(false);
        return;
      }
      savedPersonas = true;
    }

    const parts: string[] = [];
    if (savedBackend) parts.push('backend');
    if (savedPersonas) parts.push(`${personas.length} persona${personas.length === 1 ? '' : 's'}`);
    setSuccess(`Saved ${parts.join(' + ')} successfully.`);
    await reload();
    setSaving(false);
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

  /* ---- render ------------------------------------------------------- */

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (error && !initial) {
    return <div className="alert alert-danger m-3">{error}</div>;
  }

  if (!initial) return null;

  return (
    <div className="agentic-admin">
      <header className="agentic-admin__header mb-3">
        <h2 className="mb-1">LLM Agentic Chat</h2>
        <p className="text-muted small mb-0">
          Plugin version <code>{config.pluginVersion}</code> · configures the AG-UI backend and the
          global persona library used by every <code>agenticChat</code> section.
        </p>
      </header>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {error}
          <button type="button" className="close" onClick={() => setError(null)} aria-label="Close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      )}

      {success && (
        <div className="alert alert-success alert-dismissible fade show" role="alert">
          {success}
          <button type="button" className="close" onClick={() => setSuccess(null)} aria-label="Close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      )}

      <BackendSettingsPanel
        initial={initial.backend}
        value={backend}
        onChange={updateBackend}
        onTestHealth={handleHealth}
        onFetchDefaults={handleDefaults}
      />

      <PersonaEditor
        personas={personas}
        errors={personaErrors}
        onChange={updatePersonas}
      />

      <div className="agentic-admin-actions mt-4 mb-3 d-flex align-items-center">
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={saving || !dirty || totalPersonaErrors > 0}
        >
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>
              Saving…
            </>
          ) : (
            <>
              <i className="fa fa-save mr-2"></i>
              Save Changes
            </>
          )}
        </button>
        {dirty && (
          <span className="ml-3 text-muted small">
            {backendDirty && 'backend'}
            {backendDirty && personasDirty && ', '}
            {personasDirty && `${personas.length} persona${personas.length === 1 ? '' : 's'}`}
            {' '}— unsaved
          </span>
        )}
        {totalPersonaErrors > 0 && (
          <span className="ml-3 text-danger small">
            <i className="fa fa-exclamation-triangle mr-1"></i>
            {totalPersonaErrors} persona error{totalPersonaErrors === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
};
