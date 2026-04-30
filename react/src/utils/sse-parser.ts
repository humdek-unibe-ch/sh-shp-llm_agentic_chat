/**
 * Minimal SSE parser for streaming AG-UI events.
 *
 * Each AG-UI event is delivered as a Server-Sent Event with a single
 * `data: <json>` line. Multi-line `data:` blocks are concatenated with
 * "\n" before being JSON-parsed.
 */
import type { AgUiEvent } from '../types';

/**
 * Stateful parser that takes raw text chunks (as decoded by TextDecoder
 * with stream:true) and emits decoded events as soon as they're complete.
 */
export class SseParser {
  private buffer = '';

  /**
   * Push a text chunk into the parser. Returns the events that are now
   * ready to be consumed.
   */
  push(chunk: string): AgUiEvent[] {
    if (!chunk) return [];
    this.buffer += chunk;

    // SSE blocks separated by blank line.
    const parts = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = parts.pop() ?? '';

    const events: AgUiEvent[] = [];
    for (const block of parts) {
      const ev = this.parseBlock(block);
      if (ev) events.push(ev);
    }
    return events;
  }

  /**
   * Flush any remaining buffered block (call after the stream ends).
   */
  flush(): AgUiEvent[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }
    const tail = this.buffer;
    this.buffer = '';
    const ev = this.parseBlock(tail);
    return ev ? [ev] : [];
  }

  reset(): void {
    this.buffer = '';
  }

  private parseBlock(block: string): AgUiEvent | null {
    if (!block) return null;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        // Spec says the first space after the colon is optional whitespace.
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) return null;
    const payload = dataLines.join('\n');
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') {
        return parsed as AgUiEvent;
      }
    } catch {
      // Ignore malformed events; the stream may still recover.
    }
    return null;
  }
}
