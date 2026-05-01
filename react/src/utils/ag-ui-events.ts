/**
 * AG-UI event normalisation helpers.
 *
 * The backend mixes camelCase and snake_case field names depending on
 * which AG-UI implementation is in use. These helpers smooth that over.
 */
import type { AgUiEvent, PendingInterrupt } from '../types';

export function getMessageId(ev: AgUiEvent): string | undefined {
  return (ev.messageId ?? ev.message_id) as string | undefined;
}

export function getThreadId(ev: AgUiEvent): string | undefined {
  return (ev.threadId ?? ev.thread_id) as string | undefined;
}

export function getRunId(ev: AgUiEvent): string | undefined {
  return (ev.runId ?? ev.run_id) as string | undefined;
}

export function getToolCallName(ev: AgUiEvent): string | undefined {
  return (ev.toolCallName ?? ev.tool_call_name) as string | undefined;
}

export function getToolCallId(ev: AgUiEvent): string | undefined {
  return (ev.toolCallId ?? ev.tool_call_id) as string | undefined;
}

export function getParentMessageId(ev: AgUiEvent): string | undefined {
  return (ev.parentMessageId ?? ev.parent_message_id) as string | undefined;
}

/**
 * Returns the persona key for a TOOL_CALL_* handoff event, or undefined
 * when the event is not a handoff.
 *
 * Handoff tool calls are named "handoff_to_<persona>" by the
 * HandoffBuilder used in the FoResTCHAT backend.
 */
export function extractHandoffTarget(ev: AgUiEvent): string | undefined {
  const name = getToolCallName(ev);
  if (!name) return undefined;
  if (!name.startsWith('handoff_to_')) return undefined;
  return name.slice('handoff_to_'.length);
}

/**
 * Heuristic: is the case complete according to the trailing marker?
 */
export function isCaseCompleteText(text: string, marker: string): boolean {
  if (!text || !marker) return false;
  return text.trim().toLowerCase().endsWith(marker.toLowerCase());
}

/**
 * Try to interpret an AG-UI event as an HITL interrupt envelope. We
 * accept two shapes the FoResTCHAT backend has been observed to emit:
 *
 *   1. `RUN_FINISHED` with `interrupt: [{ id, value }, ...]`
 *      (preferred — see https://docs.ag-ui.com/concepts/interrupts)
 *   2. `CUSTOM` with `name === 'interrupt'` and a `value` blob
 *      (legacy, predates the official AG-UI interrupt protocol)
 *
 * Returns the FIRST interrupt found, or null when the event carries
 * none. Multiple interrupts on a single RUN_FINISHED are passed up
 * separately by the caller iterating over `extractInterruptsFromRunFinished`.
 */
export function tryParseInterrupt(ev: AgUiEvent): PendingInterrupt | null {
  // Variant 1: official AG-UI shape on RUN_FINISHED.
  if (ev.type === 'RUN_FINISHED') {
    const list = extractInterruptsFromRunFinished(ev);
    return list.length > 0 ? list[0] : null;
  }

  // Variant 2: legacy CUSTOM-encoded interrupt.
  if (ev.type === 'CUSTOM' && ev.name === 'interrupt') {
    const v = (ev.value ?? {}) as Record<string, unknown>;
    return {
      interruptId: String(v.interrupt_id ?? v.id ?? cryptoRandom()),
      toolCallId: typeof v.tool_call_id === 'string' ? v.tool_call_id : undefined,
      toolCallName: typeof v.tool_call_name === 'string' ? v.tool_call_name : undefined,
      parentMessageId: typeof v.parent_message_id === 'string' ? v.parent_message_id : undefined,
      prompt: typeof v.prompt === 'string' ? v.prompt : undefined,
      payload: v,
    };
  }

  return null;
}

/**
 * Pull every interrupt envelope out of a RUN_FINISHED event.
 *
 * Per the AG-UI protocol the backend attaches an `interrupt` array to
 * the terminal RUN_FINISHED event whenever the agent is paused on a
 * human-in-the-loop checkpoint. The next user message must then be
 * sent as a `resume.interrupts[]` payload — never as a plain
 * `messages[]` entry.
 */
export function extractInterruptsFromRunFinished(ev: AgUiEvent): PendingInterrupt[] {
  if (ev.type !== 'RUN_FINISHED') return [];
  const raw = (ev.interrupt ?? ev.interrupts) as unknown;
  if (!Array.isArray(raw)) return [];

  const result: PendingInterrupt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const interrupt = item as Record<string, unknown>;
    const id = typeof interrupt.id === 'string' && interrupt.id.length > 0
      ? interrupt.id
      : cryptoRandom();
    result.push({
      interruptId: id,
      payload: interrupt as Record<string, unknown>,
    });
  }
  return result;
}

function cryptoRandom(): string {
  // Browser-safe pseudo id (we only need uniqueness within a session).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return 'i-' + Math.random().toString(36).slice(2, 10);
}
