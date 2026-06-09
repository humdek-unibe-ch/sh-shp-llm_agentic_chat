/**
 * MessageBubble — single message row.
 *
 * Renders assistant text as Markdown (no raw HTML), and user / system
 * messages as plain text. The conscious omission of `rehype-raw` here
 * is a security choice: assistant output is produced by an LLM the
 * plugin does not control, so allowing it to mount arbitrary HTML
 * would create a stored-XSS vector inside the chat surface. Admin-
 * authored descriptive markdown (rendered elsewhere in `ChatShell`)
 * keeps `rehype-raw` because the source there is trusted CMS content.
 *
 * Persona attribution: when the caller provides a `persona`, the
 * bubble renders its avatar and display name. The resolved persona is
 * derived from the message's normalised speaker metadata
 * (`context.authorPersonaKey`) — see `MessageList` for the lookup
 * logic.
 *
 * Grouping: when several consecutive messages come from the same
 * speaker, `MessageList` passes `showAvatar={false}` / `showName={false}`
 * / `grouped` for every bubble after the first so the run reads as one
 * block (avatar shown once, tighter vertical rhythm). An invisible
 * avatar spacer keeps the bubbles aligned with the first one.
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Persona } from '../../types';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  persona?: Persona | null;
  /** Falls back to `persona?.name` when the resolved persona lookup misses. */
  authorName?: string;
  isStreaming?: boolean;
  timestamp?: string;
  /** Show the speaker avatar (false for grouped follow-up bubbles). */
  showAvatar?: boolean;
  /** Show the speaker name line (false for grouped follow-up bubbles). */
  showName?: boolean;
  /** Tighten the top spacing because this bubble continues a group. */
  grouped?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  role,
  content,
  persona,
  authorName,
  isStreaming,
  timestamp,
  showAvatar = true,
  showName = true,
  grouped = false,
}) => {
  const isUser = role === 'user';
  const wrapperClass = [
    'agentic-msg',
    `agentic-msg--${role}`,
    isStreaming ? 'agentic-msg--streaming' : '',
    grouped ? 'agentic-msg--grouped' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const avatarIsImage = isImageAvatar(persona?.avatar);
  const displayName = persona?.name || authorName || '';

  // Both sides carry an avatar so the conversation reads symmetrically:
  // the persona avatar on the left for assistants, a generic "you" icon on
  // the right for the user. On grouped follow-up bubbles the avatar is
  // replaced by an invisible spacer so the run stays aligned to the same
  // gutter.
  const spacer = (
    <div className="agentic-msg__avatar agentic-msg__avatar--spacer" aria-hidden="true" />
  );

  let leftAvatar: React.ReactNode = null;
  let rightAvatar: React.ReactNode = null;

  if (isUser) {
    rightAvatar = showAvatar ? (
      <div className="agentic-msg__avatar agentic-msg__avatar--user" aria-hidden="true">
        <i className="fas fa-user" />
      </div>
    ) : (
      spacer
    );
  } else {
    leftAvatar = showAvatar ? (
      <div
        className="agentic-msg__avatar"
        style={persona?.color ? { backgroundColor: persona.color } : undefined}
        aria-hidden="true"
      >
        {avatarIsImage ? (
          <img src={resolveAvatarUrl(persona?.avatar)} alt="" />
        ) : (
          persona?.avatar || (displayName ? displayName.charAt(0).toUpperCase() : 'A')
        )}
      </div>
    ) : (
      spacer
    );
  }

  return (
    <div className={wrapperClass}>
      {leftAvatar}
      <div className="agentic-msg__body">
        {!isUser && showName && displayName && (
          <div className="agentic-msg__author">{displayName}</div>
        )}
        <div className="agentic-msg__content">
          {isUser ? (
            content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || (isStreaming ? '…' : '')}
            </ReactMarkdown>
          )}
        </div>
        {timestamp && <div className="agentic-msg__timestamp">{timestamp}</div>}
      </div>
      {rightAvatar}
    </div>
  );
};
