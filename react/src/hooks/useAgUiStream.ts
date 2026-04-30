/**
 * useAgUiStream - opens an SSE stream against the same-origin chat
 * controller, parses AG-UI events, and exposes them through callbacks.
 *
 * The hook keeps a single in-flight AbortController so callers can
 * abort the run when the component unmounts or when the user resets
 * the thread.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgUiEvent } from '../types';
import { SseParser } from '../utils/sse-parser';

export interface UseAgUiStreamOptions {
  controllerUrl: string;
  sectionId: number;
  onEvent: (event: AgUiEvent) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

export interface UseAgUiStreamResult {
  isStreaming: boolean;
  start: (params: StartStreamParams) => Promise<void>;
  abort: () => void;
}

export interface StartStreamParams {
  message?: string;
  resume?: Record<string, unknown> | null;
}

export function useAgUiStream({
  controllerUrl,
  sectionId,
  onEvent,
  onError,
  onComplete,
}: UseAgUiStreamOptions): UseAgUiStreamResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    return () => abort();
  }, [abort]);

  const start = useCallback(async ({ message, resume }: StartStreamParams) => {
    abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);

    const body = new URLSearchParams();
    body.set('action', 'stream_run');
    body.set('section_id', String(sectionId));
    if (typeof message === 'string') body.set('message', message);
    if (resume && typeof resume === 'object') body.set('resume', JSON.stringify(resume));

    let resp: Response;
    try {
      resp = await fetch(controllerUrl, {
        method: 'POST',
        credentials: 'same-origin',
        body,
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      setIsStreaming(false);
      controllerRef.current = null;
      if ((err as { name?: string })?.name === 'AbortError') return;
      onError?.(err instanceof Error ? err.message : 'Network error');
      onComplete?.();
      return;
    }

    if (!resp.ok || !resp.body) {
      setIsStreaming(false);
      controllerRef.current = null;
      onError?.(`HTTP ${resp.status}`);
      onComplete?.();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const ev of events) {
          onEvent(ev);
        }
      }
      const tail = parser.flush();
      for (const ev of tail) onEvent(ev);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        onError?.(err instanceof Error ? err.message : 'Stream error');
      }
    } finally {
      controllerRef.current = null;
      setIsStreaming(false);
      onComplete?.();
    }
  }, [abort, controllerUrl, onComplete, onError, onEvent, sectionId]);

  return { isStreaming, start, abort };
}
