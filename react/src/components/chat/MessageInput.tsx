/**
 * MessageInput - controlled textarea with send button and Enter-to-send.
 */
import React, { useCallback, useState } from 'react';

export interface MessageInputProps {
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  onSend: (text: string) => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  placeholder,
  sendLabel,
  disabled,
  onSend,
}) => {
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }, [disabled, onSend, text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  return (
    <form
      className="agentic-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="agentic-input__textarea form-control"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        disabled={disabled}
        aria-label={placeholder}
      />
      <button
        type="submit"
        className="agentic-input__send btn btn-primary"
        disabled={disabled || text.trim().length === 0}
      >
        {sendLabel}
      </button>
    </form>
  );
};
