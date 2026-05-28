/**
 * InterruptPromptCard
 * ===================
 *
 * Surfaces a normalised AG-UI interrupt in the chat body when the run
 * pauses on a human-in-the-loop checkpoint. The card shows:
 *
 *   - The persona / agent that raised the interrupt (avatar + name).
 *   - The interrupt prompt text (`PendingInterrupt.message`).
 *   - A reason badge (`PendingInterrupt.reason`, e.g. `handoff_input`).
 *   - The raw backend payload behind a collapsed `<details>` block when
 *     the chat is in debug mode (`PendingInterrupt.rawLegacy`).
 *
 * The card is intentionally read-only: actually answering an interrupt
 * is done through the regular message input (or the per-card "Reply
 * and continue" shortcut wired up by the caller via `onReply`). That
 * keeps the resume submit path in one place
 * (`AgenticChatApp.sendMessage`) which always builds the strict-AG-UI
 * resume payload covering every open interrupt.
 *
 * @module components/chat/InterruptPromptCard
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { PendingInterrupt, Persona } from '../../types';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';

export interface InterruptPromptCardProps {
  interrupt: PendingInterrupt;
  /** Persona resolved from `interrupt.authorPersonaKey` (when known). */
  persona?: Persona | null;
  /** Show the rawLegacy payload in a collapsed debug block. */
  showDebug?: boolean;
  /** Index of this card when multiple interrupts are pending (1-based). */
  index?: number;
  /** Total number of pending interrupts (renders a "N of M" hint). */
  total?: number;
  /**
   * The most recently rendered assistant message content. Used to
   * suppress the interrupt body when the backend's interrupt payload
   * is just a restatement of the assistant text the user has already
   * read above (typical of the FoResTCHAT `HandoffAgentUserRequest`
   * flow). When omitted, the message body is always shown.
   */
  lastAssistantMessage?: string;
}

const REASON_LABELS: Record<string, string> = {
  handoff_input: 'Reply to continue',
  handoff_to_user: 'Reply to continue',
  HandoffAgentUserRequest: 'Reply to continue',
  request_info: 'More information needed',
  approval: 'Approval needed',
};

function reasonLabel(reason?: string): string {
  if (!reason) return 'Waiting for your reply';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

/**
 * Heuristic: would showing this interrupt's message simply repeat the
 * assistant text the user has already read above? The FoResTCHAT
 * backend echoes the last assistant turn inside its handoff payload,
 * so without this check the chat shows the same paragraph twice (once
 * as a normal bubble, once as the interrupt card body).
 *
 * Compare on collapsed whitespace + lowercase so trivial formatting
 * differences (markdown vs plaintext) still count as duplicates.
 */
function isDuplicateOfLastMessage(body: string, last: string | undefined): boolean {
  if (!last || !body) return false;
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = normalise(body);
  const b = normalise(last);
  if (!a || !b) return false;
  if (a === b) return true;
  // Substring containment also counts (handles small trailing usage
  // hints the backend may append to the interrupt body).
  return a.length > 16 && (b.includes(a) || a.includes(b));
}

export const InterruptPromptCard: React.FC<InterruptPromptCardProps> = ({
  interrupt,
  persona,
  showDebug = false,
  index,
  total,
  lastAssistantMessage,
}) => {
  const speakerLabel =
    persona?.name
    || interrupt.authorName
    || interrupt.sourceExecutorId
    || 'Assistant';
  const avatarIsImage = isImageAvatar(persona?.avatar);
  const rawMessage = interrupt.message?.trim() || '';
  // Suppress the body when it duplicates the assistant bubble above
  // the card to avoid the "the chat repeats itself" effect.
  const message = isDuplicateOfLastMessage(rawMessage, lastAssistantMessage)
    ? ''
    : rawMessage;

  return (
    <div
      className="agentic-interrupt-card"
      role="region"
      aria-label={`Pending interrupt from ${speakerLabel}`}
    >
      <div className="agentic-interrupt-card__header">
        <div
          className="agentic-interrupt-card__avatar"
          style={persona?.color ? { backgroundColor: persona.color } : undefined}
          aria-hidden="true"
        >
          {avatarIsImage ? (
            <img src={resolveAvatarUrl(persona?.avatar)} alt="" />
          ) : (
            persona?.avatar || speakerLabel.charAt(0).toUpperCase()
          )}
        </div>
        <div className="agentic-interrupt-card__meta">
          <div className="agentic-interrupt-card__author">{speakerLabel}</div>
          <div className="agentic-interrupt-card__reason">
            <i className="fas fa-pause-circle mr-1" aria-hidden="true" />
            {reasonLabel(interrupt.reason)}
            {typeof index === 'number' && typeof total === 'number' && total > 1 && (
              <span className="agentic-interrupt-card__counter">
                {' '}({index} of {total})
              </span>
            )}
          </div>
        </div>
      </div>

      {message.length > 0 && (
        <div className="agentic-interrupt-card__body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message}</ReactMarkdown>
        </div>
      )}

      {showDebug && interrupt.rawLegacy && (
        <details className="agentic-interrupt-card__debug">
          <summary>Raw backend interrupt payload</summary>
          <pre>{JSON.stringify(interrupt.rawLegacy, null, 2)}</pre>
        </details>
      )}
    </div>
  );
};
