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

  // User bubbles never carry an avatar (right-aligned). Assistant bubbles
  // show the avatar on the first bubble of a group and an invisible spacer
  // afterwards so the whole run stays left-aligned to the same gutter.
  let avatar: React.ReactNode = null;
  if (!isUser) {
    avatar = showAvatar ? (
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
      <div className="agentic-msg__avatar agentic-msg__avatar--spacer" aria-hidden="true" />
    );
  }

  return (
    <div className={wrapperClass}>
      {avatar}
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
    </div>
  );
};
