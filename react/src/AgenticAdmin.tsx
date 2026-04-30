/**
 * Agentic Admin - admin module bundle entry point.
 *
 * Mounts AdminApp into `#agentic-admin-root`.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { AdminConfig } from './types';
import { AdminApp } from './components/admin/AdminApp';
import './components/admin/AgenticAdmin.css';

declare global {
  interface Window {
    AgenticAdmin?: {
      mount: (selector?: string) => void;
      version: string;
    };
  }
}

const VERSION = '1.0.0';

function readConfig(node: Element): AdminConfig | null {
  const raw = (node as HTMLElement).dataset.config;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminConfig;
  } catch (e) {
    console.error('[AgenticAdmin] invalid data-config JSON', e);
    return null;
  }
}

function mount(selector: string = '#agentic-admin-root'): void {
  const node = document.querySelector(selector);
  if (!node) {
    console.warn('[AgenticAdmin] mount target not found:', selector);
    return;
  }
  if ((node as HTMLElement).dataset.agenticAdminMounted === '1') return;
  const config = readConfig(node);
  if (!config) return;

  const root = ReactDOM.createRoot(node);
  root.render(
    <React.StrictMode>
      <AdminApp config={config} />
    </React.StrictMode>
  );
  (node as HTMLElement).dataset.agenticAdminMounted = '1';
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount());
  } else {
    mount();
  }
}

window.AgenticAdmin = { mount, version: VERSION };

export default { mount, version: VERSION };
