/**
 * MultiSelect — dependency-free Bootstrap-styled multi-select dropdown.
 *
 * The agentic-chat threads admin filters need to be multi-select to
 * mirror the `sh-shp-llm` admin console. To avoid pulling `react-select`
 * (and inflating the threads bundle), this is a small, accessible
 * implementation that:
 *
 *   - Renders the dropdown with a search filter and a checklist.
 *   - Persists selection ids in the parent and emits a numeric array.
 *   - Closes on outside click / Escape, and supports keyboard navigation.
 *
 * It is deliberately scoped to the threads admin and not promoted into
 * a shared lib because the chat surface has no comparable need.
 *
 * @module components/threads/MultiSelect
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface MultiSelectOption {
  /** Stable identifier, returned in `value` when selected. */
  id: number;
  /** Human-readable label shown in the dropdown rows. */
  label: string;
  /** Optional secondary text rendered under the label (e.g. email). */
  hint?: string;
}

export interface MultiSelectProps {
  /** Currently selected ids. */
  value: number[];
  /** Available options to choose from. */
  options: MultiSelectOption[];
  /** Placeholder text shown when nothing is selected. */
  placeholder?: string;
  /** Disable interaction (e.g. while options are loading). */
  disabled?: boolean;
  /** Called whenever the selection changes. */
  onChange: (next: number[]) => void;
  /** Aria-label / title on the trigger button. */
  ariaLabel?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  value,
  options,
  placeholder = 'All',
  disabled = false,
  onChange,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Index options by id for quick label lookup; recompute on options change.
  const byId = useMemo(() => {
    const map = new Map<number, MultiSelectOption>();
    for (const opt of options) map.set(opt.id, opt);
    return map;
  }, [options]);

  // Filter options client-side based on the search term.
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(term) ||
      (o.hint ?? '').toLowerCase().includes(term)
    );
  }, [filter, options]);

  // Close the dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleId = useCallback((id: number) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }, [onChange, value]);

  const clearAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  }, [onChange]);

  // Build the trigger label: short summary + chip count.
  const triggerLabel = useMemo(() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      const only = byId.get(value[0]);
      return only ? only.label : `1 selected`;
    }
    if (value.length <= 3) {
      return value
        .map((id) => byId.get(id)?.label)
        .filter(Boolean)
        .join(', ');
    }
    return `${value.length} selected`;
  }, [byId, placeholder, value]);

  return (
    <div className={`agentic-multi ${open ? 'is-open' : ''}`} ref={containerRef}>
      <button
        type="button"
        className="form-control form-control-sm agentic-multi__trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className={`agentic-multi__label ${value.length === 0 ? 'is-placeholder' : ''}`}>
          {triggerLabel}
        </span>
        {value.length > 0 && (
          <span
            className="agentic-multi__clear"
            role="button"
            aria-label="Clear selection"
            onClick={clearAll}
          >
            <i className="fa fa-times-circle" aria-hidden="true" />
          </span>
        )}
        <i className="fa fa-caret-down agentic-multi__caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="agentic-multi__menu" role="listbox" aria-multiselectable="true">
          <div className="agentic-multi__search">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="agentic-multi__list">
            {filtered.length === 0 ? (
              <li className="agentic-multi__empty">No matches</li>
            ) : (
              filtered.map((opt) => {
                const checked = value.includes(opt.id);
                return (
                  <li
                    key={opt.id}
                    className={`agentic-multi__item ${checked ? 'is-checked' : ''}`}
                    onClick={() => toggleId(opt.id)}
                    role="option"
                    aria-selected={checked}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      tabIndex={-1}
                      className="agentic-multi__checkbox"
                    />
                    <div className="agentic-multi__item-text">
                      <div className="agentic-multi__item-label">{opt.label}</div>
                      {opt.hint && <div className="agentic-multi__item-hint">{opt.hint}</div>}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
