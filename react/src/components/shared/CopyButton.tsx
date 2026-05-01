/**
 * CopyButton — small reusable button that copies a string (typically a
 * JSON payload or curl one-liner) to the clipboard and briefly flashes
 * a success state to give the user feedback.
 *
 * Falls back to `document.execCommand('copy')` on the rare browsers /
 * iframe sandboxes where `navigator.clipboard` is unavailable.
 *
 * @module components/shared/CopyButton
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface CopyButtonProps {
  /**
   * Either a string or a function returning the string to copy. Use the
   * function form when the value is expensive to compute, or when you
   * need it lazily evaluated (eg. a fresh UUID per click).
   */
  value: string | (() => string);
  /** Human-readable label shown next to the icon. */
  label?: string;
  /** Tooltip / aria-label override. Defaults to the visible label. */
  title?: string;
  /** Extra classes appended to the default Bootstrap classes. */
  className?: string;
  /** Bootstrap size: default is `sm`. */
  size?: 'sm' | 'md';
  /** Bootstrap variant. Defaults to `outline-secondary`. */
  variant?:
    | 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info'
    | 'outline-primary' | 'outline-secondary' | 'outline-success'
    | 'outline-info' | 'outline-warning' | 'outline-danger' | 'outline-light';
  /** Disable the button. */
  disabled?: boolean;
}

/** Small clipboard icon with a flash-feedback button. */
export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label = 'Copy',
  title,
  className = '',
  size = 'sm',
  variant = 'outline-secondary',
  disabled = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onClick = useCallback(async () => {
    const text = typeof value === 'function' ? value() : value;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        // Legacy fallback for non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    setCopied(ok);
    setError(!ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setError(false);
    }, 1500);
  }, [value]);

  const sizeClass = size === 'sm' ? 'btn-sm' : '';
  const stateClass = copied ? 'btn-success' : (error ? 'btn-danger' : `btn-${variant}`);
  const icon = copied ? 'fa-check' : (error ? 'fa-times' : 'fa-clipboard');
  const tooltip = title || label;

  return (
    <button
      type="button"
      className={`btn ${sizeClass} ${stateClass} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
    >
      <i className={`fa ${icon}`} aria-hidden="true" />
      {label && <span className="ml-1">{copied ? 'Copied' : (error ? 'Failed' : label)}</span>}
    </button>
  );
};
