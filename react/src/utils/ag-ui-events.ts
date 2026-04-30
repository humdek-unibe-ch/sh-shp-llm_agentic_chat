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
 * Try to interpret a CUSTOM event as an interrupt prompt.
 * The exact shape depends on the workflow; we accept anything that
 * carries `name === 'interrupt'`.
 */
export function tryParseInterrupt(ev: AgUiEvent): PendingInterrupt | null {
  if (ev.type !== 'CUSTOM') return null;
  if (ev.name !== 'interrupt') return null;
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

function cryptoRandom(): string {
  // Browser-safe pseudo id (we only need uniqueness within a session).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return 'i-' + Math.random().toString(36).slice(2, 10);
}
