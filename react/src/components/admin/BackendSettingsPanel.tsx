/**
 * BackendSettingsPanel - global backend URL + endpoint configuration.
 */
import React, { useState } from 'react';
import type { BackendSettings } from '../../types';

export interface BackendSettingsPanelProps {
  initial: BackendSettings;
  onSave: (settings: BackendSettings) => Promise<{ ok: boolean; error?: string }>;
  onTestHealth: () => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
  onFetchDefaults: () => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
}

export const BackendSettingsPanel: React.FC<BackendSettingsPanelProps> = ({
  initial,
  onSave,
  onTestHealth,
  onFetchDefaults,
}) => {
  const [settings, setSettings] = useState<BackendSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [defaultsMsg, setDefaultsMsg] = useState<string | null>(null);

  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);

  const set = <K extends keyof BackendSettings>(key: K, value: BackendSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const res = await onSave(settings);
    setSaving(false);
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString());
    } else {
      setSaveError(res.error || 'Save failed');
    }
  };

  const handleHealth = async () => {
    setHealthMsg('Probing…');
    const res = await onTestHealth();
    setHealthMsg(res.ok ? `OK: ${JSON.stringify(res.data)}` : `Error: ${res.error}`);
  };

  const handleDefaults = async () => {
    setDefaultsMsg('Fetching…');
    const res = await onFetchDefaults();
    setDefaultsMsg(res.ok ? `OK: ${JSON.stringify(res.data).slice(0, 220)}…` : `Error: ${res.error}`);
  };

  return (
    <section className="agentic-admin__section card mb-4">
      <header className="card-header d-flex align-items-center">
        <h4 className="mb-0 mr-auto">Backend settings</h4>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mr-2"
          onClick={handleHealth}
        >
          Test /health
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mr-2"
          onClick={handleDefaults}
        >
          Fetch /reflect/defaults
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </header>
      <div className="card-body">
        {savedAt && !dirty && (
          <div className="alert alert-success py-1">Saved at {savedAt}.</div>
        )}
        {saveError && <div className="alert alert-danger py-1">{saveError}</div>}
        {healthMsg && <div className="alert alert-info py-1">Health: {healthMsg}</div>}
        {defaultsMsg && <div className="alert alert-info py-1">Defaults: {defaultsMsg}</div>}

        <div className="form-group">
          <label htmlFor="backend-url">Backend base URL</label>
          <input
            id="backend-url"
            type="url"
            className="form-control"
            value={settings.backend_url}
            onChange={(e) => set('backend_url', e.target.value)}
          />
          <small className="form-text text-muted">
            Without trailing slash. Live test backend:
            <code> https://tpf-test.humdek.unibe.ch/forestBackend</code>
          </small>
        </div>

        <div className="form-row">
          <div className="form-group col-md-6">
            <label htmlFor="reflect-path">/reflect path</label>
            <input
              id="reflect-path"
              type="text"
              className="form-control"
              value={settings.reflect_path}
              onChange={(e) => set('reflect_path', e.target.value)}
            />
          </div>
          <div className="form-group col-md-6">
            <label htmlFor="configure-path">/reflect/configure path</label>
            <input
              id="configure-path"
              type="text"
              className="form-control"
              value={settings.configure_path}
              onChange={(e) => set('configure_path', e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-6">
            <label htmlFor="defaults-path">/reflect/defaults path</label>
            <input
              id="defaults-path"
              type="text"
              className="form-control"
              value={settings.defaults_path}
              onChange={(e) => set('defaults_path', e.target.value)}
            />
          </div>
          <div className="form-group col-md-6">
            <label htmlFor="health-path">/health path</label>
            <input
              id="health-path"
              type="text"
              className="form-control"
              value={settings.health_path}
              onChange={(e) => set('health_path', e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-3">
            <label htmlFor="timeout">Timeout (s)</label>
            <input
              id="timeout"
              type="number"
              min={1}
              max={600}
              className="form-control"
              value={settings.timeout}
              onChange={(e) => set('timeout', Number(e.target.value) || 0)}
            />
          </div>
          <div className="form-group col-md-9 d-flex align-items-end">
            <div className="custom-control custom-switch">
              <input
                id="debug-enabled"
                type="checkbox"
                className="custom-control-input"
                checked={!!settings.debug_enabled}
                onChange={(e) => set('debug_enabled', e.target.checked)}
              />
              <label className="custom-control-label" htmlFor="debug-enabled">
                Show AG-UI debug panel by default
              </label>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="default-module">Default module / reflection content</label>
          <textarea
            id="default-module"
            rows={6}
            className="form-control"
            value={settings.default_module}
            onChange={(e) => set('default_module', e.target.value)}
            placeholder="Paste module text used as the default reflection context for new threads."
          />
        </div>
      </div>
    </section>
  );
};
