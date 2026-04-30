/**
 * Agentic Chat - frontend bundle entry point.
 *
 * Walks every `.agentic-chat-root` node currently in the DOM and mounts
 * an AgenticChatApp into each one, reading initial config from the
 * data-config attribute (set by AgenticChatView::tpl/agentic_chat_main.php).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';

import { AgenticChatApp } from './components/chat/AgenticChatApp';
import type { AgenticChatConfig } from './types';
import './components/chat/AgenticChat.css';

declare global {
  interface Window {
    AgenticChat?: {
      mountAll: () => void;
      mount: (selector: string | Element) => void;
      version: string;
    };
  }
}

const VERSION = '1.0.0';

function readConfig(node: Element): AgenticChatConfig | null {
  const raw = (node as HTMLElement).dataset.config;
  if (!raw) {
    console.warn('[AgenticChat] missing data-config attribute on', node);
    return null;
  }
  try {
    return JSON.parse(raw) as AgenticChatConfig;
  } catch (e) {
    console.error('[AgenticChat] invalid data-config JSON', e);
    return null;
  }
}

function mountInto(node: Element): void {
  if ((node as HTMLElement).dataset.agenticChatMounted === '1') return;
  const config = readConfig(node);
  if (!config) return;

  const root = ReactDOM.createRoot(node);
  root.render(
    <React.StrictMode>
      <AgenticChatApp config={config} />
    </React.StrictMode>
  );

  (node as HTMLElement).dataset.agenticChatMounted = '1';
}

function mountAll(): void {
  document.querySelectorAll('.agentic-chat-root').forEach(mountInto);
}

function mount(selector: string | Element): void {
  if (typeof selector === 'string') {
    const node = document.querySelector(selector);
    if (node) mountInto(node);
    return;
  }
  mountInto(selector);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
}

window.AgenticChat = { mountAll, mount, version: VERSION };

export default { mountAll, mount, version: VERSION };
