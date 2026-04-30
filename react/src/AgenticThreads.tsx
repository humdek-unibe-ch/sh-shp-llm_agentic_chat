/**
 * Agentic Threads — admin module bundle entry point.
 *
 * Mounts ThreadsApp into `#agentic-threads-root`.
 *
 * @module AgenticThreads
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ThreadsAdminConfig } from './types';
import { ThreadsApp } from './components/threads/ThreadsApp';
import './components/threads/AgenticThreads.css';

declare global {
  interface Window {
    AgenticThreads?: {
      mount: (selector?: string) => void;
      version: string;
    };
  }
}

const VERSION = '1.0.0';

function readConfig(node: Element): ThreadsAdminConfig | null {
  const raw = (node as HTMLElement).dataset.config;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThreadsAdminConfig;
  } catch (e) {
    console.error('[AgenticThreads] invalid data-config JSON', e);
    return null;
  }
}

function mount(selector: string = '#agentic-threads-root'): void {
  const node = document.querySelector(selector);
  if (!node) {
    console.warn('[AgenticThreads] mount target not found:', selector);
    return;
  }
  if ((node as HTMLElement).dataset.agenticThreadsMounted === '1') return;
  const config = readConfig(node);
  if (!config) return;

  const root = ReactDOM.createRoot(node);
  root.render(
    <React.StrictMode>
      <ThreadsApp config={config} />
    </React.StrictMode>
  );
  (node as HTMLElement).dataset.agenticThreadsMounted = '1';
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount());
  } else {
    mount();
  }
}

window.AgenticThreads = { mount, version: VERSION };

export default { mount, version: VERSION };
