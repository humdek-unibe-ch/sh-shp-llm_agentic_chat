/**
 * useAgenticThread - resolves the active thread + initial message
 * history for a section by calling get_thread on mount.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChatApi } from '../utils/api';
import type { ThreadView } from '../types';

export interface RefreshOptions {
  /**
   * Sync silently in the background: do NOT flip the full-screen
   * `loading` flag. Used for the post-stream reconcile so the chat
   * never flashes the loading spinner mid-conversation (which the user
   * perceives as a big "jump"). The initial mount load is non-silent so
   * the spinner is shown exactly once.
   */
  silent?: boolean;
}

export interface UseAgenticThreadResult {
  thread: ThreadView['thread'];
  messages: ThreadView['messages'];
  loading: boolean;
  error: string | null;
  refresh: (opts?: RefreshOptions) => Promise<void>;
  setThread: (next: ThreadView) => void;
}

const EMPTY: ThreadView = { thread: null, messages: [] };

export function useAgenticThread(api: ChatApi): UseAgenticThreadResult {
  const [view, setView] = useState<ThreadView>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (opts?: RefreshOptions) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setError(null);
    const result = await api.getThread();
    if (!silent) setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data.thread || EMPTY);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    thread: view.thread,
    messages: view.messages,
    loading,
    error,
    refresh,
    setThread: setView,
  };
}
