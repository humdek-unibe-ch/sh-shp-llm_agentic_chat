/**
 * useAgenticThread - resolves the active thread + initial message
 * history for a section by calling get_thread on mount.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChatApi } from '../utils/api';
import type { ThreadView } from '../types';

export interface UseAgenticThreadResult {
  thread: ThreadView['thread'];
  messages: ThreadView['messages'];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setThread: (next: ThreadView) => void;
}

const EMPTY: ThreadView = { thread: null, messages: [] };

export function useAgenticThread(api: ChatApi): UseAgenticThreadResult {
  const [view, setView] = useState<ThreadView>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await api.getThread();
    setLoading(false);
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
