/**
 * MessageInput
 * ============
 *
 * Bootstrap-styled input bar for the agentic chat. Mirrors the visual
 * language of the base `sh-shp-llm` chat input (icon buttons, character
 * count, microphone), but stays free of `react-bootstrap` to keep the
 * agentic UMD bundle small.
 *
 * Features:
 *   - Auto-resizing `<textarea>` with Enter-to-send / Shift+Enter newline.
 *   - Optional speech-to-text microphone (driven by `useSpeechToText`).
 *   - Inline character counter with overflow warning.
 *   - Clear button to reset the textarea contents.
 *
 * @module components/chat/MessageInput
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useSpeechToText } from '../../hooks/useSpeechToText';

/** Maximum number of characters accepted in a single message. */
const MAX_MESSAGE_LENGTH = 4000;

/** Props accepted by the MessageInput component. */
export interface MessageInputProps {
  placeholder: string;
  sendLabel: string;
  /** True while the chat is streaming or otherwise unavailable. */
  disabled?: boolean;
  onSend: (text: string) => void;

  /** Whether the speech-to-text microphone button should be rendered. */
  enableSpeechToText?: boolean;
  /** Whisper model identifier (forwarded to the controller). */
  speechToTextModel?: string;
  /** CMS section id required by the controller for both validation and audio naming. */
  sectionId: number;
  /** Same-origin URL used to upload the recorded audio. */
  controllerUrl: string;
}

/**
 * Bootstrap-styled message input with optional speech-to-text and a
 * smart auto-resize textarea.
 */
export const MessageInput: React.FC<MessageInputProps> = ({
  placeholder,
  sendLabel,
  disabled,
  onSend,
  enableSpeechToText = false,
  speechToTextModel = '',
  sectionId,
  controllerUrl,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  /* ---------- Auto-resize ------------------------------------------------ */

  const adjustHeight = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const next = Math.min(Math.max(node.scrollHeight, 44), 160);
    node.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  /* ---------- Speech-to-text -------------------------------------------- */

  /**
   * Append transcribed text at the current cursor position. Never
   * overwrites the existing draft.
   */
  const appendTranscribed = useCallback((transcribed: string) => {
    const node = textareaRef.current;
    if (!node) {
      setText((prev) => (prev ? `${prev.trimEnd()} ${transcribed} ` : `${transcribed} `));
      return;
    }
    const current = textRef.current;
    const cursor = node.selectionStart ?? current.length;
    const before = current.substring(0, cursor);
    const after = current.substring(cursor);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const next = `${before}${needsLeadingSpace ? ' ' : ''}${transcribed} ${after}`;
    setText(next);
    requestAnimationFrame(() => {
      const n = textareaRef.current;
      if (!n) return;
      const pos = before.length + (needsLeadingSpace ? 1 : 0) + transcribed.length + 1;
      n.focus();
      n.setSelectionRange(pos, pos);
      adjustHeight();
    });
  }, [adjustHeight]);

  const speech = useSpeechToText({
    enabled: enableSpeechToText,
    model: speechToTextModel,
    sectionId,
    controllerUrl,
    onTranscription: appendTranscribed,
  });

  /* ---------- Submission ------------------------------------------------ */

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    requestAnimationFrame(adjustHeight);
  }, [adjustHeight, disabled, onSend, text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const clear = useCallback(() => {
    setText('');
    requestAnimationFrame(() => {
      adjustHeight();
      textareaRef.current?.focus();
    });
  }, [adjustHeight]);

  /* ---------- Render ---------------------------------------------------- */

  const charCount = text.length;
  const isNearLimit = charCount > MAX_MESSAGE_LENGTH * 0.9;
  const sendDisabled = disabled || text.trim().length === 0;

  return (
    <form
      className="agentic-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {speech.error && (
        <div className="agentic-input__alert alert alert-warning py-1 px-2 mb-1 d-flex align-items-center">
          <i className="fas fa-microphone-slash mr-2" aria-hidden="true" />
          <span className="flex-grow-1 small">{speech.error}</span>
          <button
            type="button"
            className="close"
            aria-label="Dismiss"
            onClick={speech.clearError}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      )}

      <div className="agentic-input__shell">
        <textarea
          ref={textareaRef}
          className="agentic-input__textarea form-control border-0"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
          aria-label={placeholder}
        />
        <div className="agentic-input__toolbar">
          <div className="agentic-input__toolbar-left">
            {speech.isAvailable && (
              <button
                type="button"
                className={`btn btn-sm ${speech.isRecording ? 'btn-danger agentic-input__mic--recording' : 'btn-outline-secondary'} agentic-input__btn`}
                onClick={speech.toggleRecording}
                disabled={disabled || speech.isProcessing}
                title={
                  speech.isRecording
                    ? 'Stop recording'
                    : speech.isProcessing
                      ? 'Transcribing…'
                      : 'Start voice input'
                }
                aria-pressed={speech.isRecording}
              >
                {speech.isProcessing ? (
                  <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                ) : speech.isRecording ? (
                  <i className="fas fa-stop" aria-hidden="true" />
                ) : (
                  <i className="fas fa-microphone" aria-hidden="true" />
                )}
              </button>
            )}
          </div>

          <small className={`agentic-input__count ${isNearLimit ? 'text-warning' : 'text-muted'}`}>
            {charCount}/{MAX_MESSAGE_LENGTH}
          </small>

          <div className="agentic-input__toolbar-right">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary agentic-input__btn"
              onClick={clear}
              disabled={disabled || text.length === 0}
              title="Clear message"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-primary agentic-input__send"
              disabled={sendDisabled}
              title={sendLabel}
              aria-label={sendLabel}
            >
              {disabled ? (
                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
              ) : (
                <i className="fas fa-paper-plane" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
