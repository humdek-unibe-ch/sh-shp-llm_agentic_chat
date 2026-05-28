/**
 * AG-UI event helpers.
 *
 * Every event arriving at this module has already been normalised by
 * the PHP bridge in `AgenticChatEventNormalizer.php`: identifier fields
 * are camelCase only, `RUN_FINISHED` carries an explicit `outcome`
 * envelope, and interrupts are pre-normalised `PendingInterrupt`
 * objects. The helpers in this file therefore consume the strict
 * AG-UI shape directly and never have to sniff legacy keys.
 */
import type { AgUiEvent, PendingInterrupt, RunFinishedOutcome } from '../types';

export function getMessageId(ev: AgUiEvent): string | undefined {
  return ev.messageId;
}

export function getThreadId(ev: AgUiEvent): string | undefined {
  return ev.threadId;
}

export function getRunId(ev: AgUiEvent): string | undefined {
  return ev.runId;
}

export function getToolCallName(ev: AgUiEvent): string | undefined {
  return ev.toolCallName;
}

export function getToolCallId(ev: AgUiEvent): string | undefined {
  return ev.toolCallId;
}

export function getParentMessageId(ev: AgUiEvent): string | undefined {
  return ev.parentMessageId;
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
 * Read the strict-AG-UI outcome envelope from a RUN_FINISHED event.
 *
 * The PHP normaliser always sets `outcome` on RUN_FINISHED — either
 * `{ type: "interrupt", interrupts: [...] }` when the backend's
 * `interrupt[]` array was non-empty, or `{ type: "complete" }` for a
 * clean finish.
 */
export function getRunFinishedOutcome(ev: AgUiEvent): RunFinishedOutcome | null {
  if (ev.type !== 'RUN_FINISHED') return null;
  const outcome = ev.outcome as RunFinishedOutcome | undefined;
  if (!outcome || typeof outcome !== 'object') return null;
  if (outcome.type === 'interrupt') {
    const list = Array.isArray(outcome.interrupts) ? outcome.interrupts : [];
    return { type: 'interrupt', interrupts: list };
  }
  if (outcome.type === 'complete') return { type: 'complete' };
  return null;
}

/**
 * Pull every (normalised) interrupt envelope out of a RUN_FINISHED event.
 */
export function extractInterruptsFromRunFinished(ev: AgUiEvent): PendingInterrupt[] {
  const outcome = getRunFinishedOutcome(ev);
  if (outcome && outcome.type === 'interrupt') {
    return outcome.interrupts;
  }
  // Fallback: the canonical alias kept on the event for back-compat.
  if (Array.isArray(ev.interrupts)) {
    return ev.interrupts as PendingInterrupt[];
  }
  return [];
}
