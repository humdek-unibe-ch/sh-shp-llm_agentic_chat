/**
 * PersonaRow - editable card representing one persona in the admin
 * persona library editor.
 */
import React from 'react';
import type { Persona } from '../../types';

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'mediator', label: 'Mediator' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'expert', label: 'Expert' },
  { value: 'supporter', label: 'Supporter' },
  { value: 'other', label: 'Other' },
];

export interface PersonaRowProps {
  persona: Persona;
  index: number;
  errors: string[];
  onChange: (patch: Partial<Persona>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export const PersonaRow: React.FC<PersonaRowProps> = ({
  persona,
  index,
  errors,
  onChange,
  onDuplicate,
  onRemove,
}) => {
  return (
    <div className={`persona-row card mb-3${errors.length ? ' persona-row--invalid' : ''}`}>
      <div className="card-body">
        <div className="d-flex align-items-center mb-2">
          <span
            className="persona-row__avatar mr-2"
            style={{ backgroundColor: persona.color || '#6c757d' }}
            aria-hidden="true"
          >
            {persona.avatar || (persona.name?.[0]?.toUpperCase() ?? '?')}
          </span>
          <strong className="mr-auto">
            {persona.name || <em className="text-muted">Persona #{index + 1}</em>}
          </strong>
          <div className="custom-control custom-switch mr-3">
            <input
              type="checkbox"
              className="custom-control-input"
              id={`persona-enabled-${index}`}
              checked={persona.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            <label className="custom-control-label" htmlFor={`persona-enabled-${index}`}>
              Enabled
            </label>
          </div>
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={onDuplicate}
            title="Duplicate this persona"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-link btn-sm text-danger"
            onClick={onRemove}
            title="Remove this persona"
          >
            Remove
          </button>
        </div>

        <div className="form-row">
          <div className="form-group col-md-4">
            <label htmlFor={`persona-name-${index}`}>Display name</label>
            <input
              id={`persona-name-${index}`}
              type="text"
              className="form-control"
              value={persona.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g. Foundational Teacher"
            />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor={`persona-key-${index}`}>Key</label>
            <input
              id={`persona-key-${index}`}
              type="text"
              className="form-control"
              value={persona.key}
              onChange={(e) => onChange({ key: e.target.value })}
              placeholder="auto-generated"
            />
            <small className="form-text text-muted">
              Used to map personas to backend slots.
            </small>
          </div>
          <div className="form-group col-md-3">
            <label htmlFor={`persona-role-${index}`}>Role</label>
            <select
              id={`persona-role-${index}`}
              className="form-control"
              value={persona.role}
              onChange={(e) => onChange({ role: e.target.value })}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group col-md-2">
            <label htmlFor={`persona-color-${index}`}>Color</label>
            <input
              id={`persona-color-${index}`}
              type="color"
              className="form-control"
              value={persona.color || '#7f8c8d'}
              onChange={(e) => onChange({ color: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-9">
            <label htmlFor={`persona-personality-${index}`}>Personality summary</label>
            <input
              id={`persona-personality-${index}`}
              type="text"
              className="form-control"
              value={persona.personality || ''}
              onChange={(e) => onChange({ personality: e.target.value })}
              placeholder="One-line summary shown in the persona strip."
            />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor={`persona-avatar-${index}`}>Avatar (emoji or letter)</label>
            <input
              id={`persona-avatar-${index}`}
              type="text"
              className="form-control"
              value={persona.avatar || ''}
              onChange={(e) => onChange({ avatar: e.target.value })}
              maxLength={4}
              placeholder="🧑"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={`persona-instructions-${index}`}>Personality / instructions</label>
          <textarea
            id={`persona-instructions-${index}`}
            className="form-control"
            rows={5}
            value={persona.instructions}
            onChange={(e) => onChange({ instructions: e.target.value })}
            placeholder="Free-form instructions for this persona. Use {module_content} to inject the module text."
          />
        </div>

        {errors.length > 0 && (
          <div className="alert alert-warning mb-0">
            <ul className="mb-0">
              {errors.map((msg, i) => <li key={i}>{msg}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
