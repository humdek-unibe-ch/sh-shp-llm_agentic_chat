/**
 * BackendSettingsPanel — global backend URL + endpoint configuration.
 *
 * Card-based panel mirroring sh-shp-llm's `ModelDefaultsSection` style:
 * a clean Bootstrap 4.6 card with a header, body, dirty-tracked fields,
 * and Test buttons in the header for /health and /reflect/defaults.
 *
 * @module components/admin/BackendSettingsPanel
 */
import React, { useState } from 'react';
import type { BackendSettings } from '../../types';

export interface BackendSettingsPanelProps {
  initial: BackendSettings;
  value: BackendSettings;
  onChange: (patch: Partial<BackendSettings>) => void;
  onTestHealth: () => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
  onFetchDefaults: () => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
  disabled?: boolean;
}

interface ProbeResult {
  kind: 'health' | 'defaults';
  ok: boolean;
  message: string;
}

/** BackendSettingsPanel component. */
export const BackendSettingsPanel: React.FC<BackendSettingsPanelProps> = ({
  initial,
  value,
  onChange,
  onTestHealth,
  onFetchDefaults,
  disabled,
}) => {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState<'health' | 'defaults' | null>(null);

  const set = <K extends keyof BackendSettings>(key: K, v: BackendSettings[K]) =>
    onChange({ [key]: v } as Partial<BackendSettings>);

  const runHealth = async () => {
    setProbing('health');
    setProbe(null);
    const res = await onTestHealth();
    setProbing(null);
    setProbe({
      kind: 'health',
      ok: res.ok,
      message: res.ok
        ? `OK · ${truncate(JSON.stringify(res.data ?? {}), 220)}`
        : `Error · ${res.error || 'Unknown error'}`,
    });
  };

  const runDefaults = async () => {
    setProbing('defaults');
    setProbe(null);
    const res = await onFetchDefaults();
    setProbing(null);
    setProbe({
      kind: 'defaults',
      ok: res.ok,
      message: res.ok
        ? `OK · ${truncate(JSON.stringify(res.data ?? {}), 220)}`
        : `Error · ${res.error || 'Unknown error'}`,
    });
  };

  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h6 className="mb-0">
          <i className="fa fa-plug mr-2 text-muted"></i>
          Backend Connection
        </h6>
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={runHealth}
            disabled={!!probing}
          >
            {probing === 'health' ? (
              <><span className="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span>Testing…</>
            ) : (
              <><i className="fa fa-heartbeat mr-1"></i>Test /health</>
            )}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={runDefaults}
            disabled={!!probing}
          >
            {probing === 'defaults' ? (
              <><span className="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span>Fetching…</>
            ) : (
              <><i className="fa fa-cloud-download-alt mr-1"></i>/reflect/defaults</>
            )}
          </button>
        </div>
      </div>
      <div className="card-body">
        <p className="text-muted small mb-3">
          AG-UI backend used by every <code>agenticChat</code> section.
          {dirty && <span className="ml-2 badge badge-warning">unsaved</span>}
        </p>

        {probe && (
          <div className={`alert ${probe.ok ? 'alert-info' : 'alert-warning'} small py-2 mb-3`} role="alert">
            <strong className="mr-1">
              {probe.kind === 'health' ? '/health:' : '/reflect/defaults:'}
            </strong>
            {probe.message}
          </div>
        )}

        <div className="form-group">
          <label className="small font-weight-bold" htmlFor="backend-url">Backend Base URL</label>
          <input
            id="backend-url"
            type="url"
            className="form-control form-control-sm"
            value={value.backend_url}
            onChange={(e) => set('backend_url', e.target.value)}
            placeholder="https://tpf-test.humdek.unibe.ch/forestBackend"
            disabled={disabled}
          />
          <small className="form-text text-muted">
            Base URL of the AG-UI backend, no trailing slash.
          </small>
        </div>

        <div className="form-row">
          <div className="form-group col-md-6">
            <label className="small font-weight-bold" htmlFor="reflect-path">/reflect path</label>
            <input
              id="reflect-path"
              type="text"
              className="form-control form-control-sm"
              value={value.reflect_path}
              onChange={(e) => set('reflect_path', e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="form-group col-md-6">
            <label className="small font-weight-bold" htmlFor="configure-path">/reflect/configure path</label>
            <input
              id="configure-path"
              type="text"
              className="form-control form-control-sm"
              value={value.configure_path}
              onChange={(e) => set('configure_path', e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-6">
            <label className="small font-weight-bold" htmlFor="defaults-path">/reflect/defaults path</label>
            <input
              id="defaults-path"
              type="text"
              className="form-control form-control-sm"
              value={value.defaults_path}
              onChange={(e) => set('defaults_path', e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="form-group col-md-6">
            <label className="small font-weight-bold" htmlFor="health-path">/health path</label>
            <input
              id="health-path"
              type="text"
              className="form-control form-control-sm"
              value={value.health_path}
              onChange={(e) => set('health_path', e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-3">
            <label className="small font-weight-bold" htmlFor="timeout">Timeout (s)</label>
            <input
              id="timeout"
              type="number"
              min={1}
              max={600}
              className="form-control form-control-sm"
              value={value.timeout}
              onChange={(e) => set('timeout', Number(e.target.value) || 0)}
              disabled={disabled}
            />
            <small className="form-text text-muted">Used for /reflect/configure and SSE streams.</small>
          </div>
        </div>

        <div className="form-group mb-0">
          <label className="small font-weight-bold" htmlFor="default-module">Default module / reflection content</label>
          <textarea
            id="default-module"
            rows={5}
            className="form-control form-control-sm"
            value={value.default_module}
            onChange={(e) => set('default_module', e.target.value)}
            placeholder="Paste module text used as the default reflection context for new threads."
            disabled={disabled}
          />
          <small className="form-text text-muted">
            Falls back to this when a section doesn't define its own module body.
          </small>
        </div>
      </div>
    </div>
  );
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}
