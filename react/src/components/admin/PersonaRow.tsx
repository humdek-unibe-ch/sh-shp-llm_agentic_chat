/**
 * PersonaRow — inline edit form for a single persona inside the
 * persona library editor. Shown when the user clicks the pencil icon
 * on a `PersonaEditor` summary row.
 *
 * @module components/admin/PersonaRow
 */
import React from 'react';
import type { Persona } from '../../types';

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'agentic_persona_role_mediator', label: 'Mediator' },
  { value: 'agentic_persona_role_teacher', label: 'Teacher' },
  { value: 'agentic_persona_role_expert', label: 'Expert' },
  { value: 'agentic_persona_role_supporter', label: 'Supporter' },
  { value: 'agentic_persona_role_other', label: 'Other' },
];

export interface PersonaRowProps {
  persona: Persona;
  index: number;
  errors: string[];
  onChange: (patch: Partial<Persona>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** PersonaRow component (inline editor). */
export const PersonaRow: React.FC<PersonaRowProps> = ({
  persona,
  index,
  errors,
  onChange,
  onDuplicate,
  onRemove,
  onClose,
}) => {
  const avatarIsImage = !!persona.avatar &&
    /^(\/|https?:\/\/|\.\/|\.\.\/).+\.(svg|png|jpe?g|webp|gif)(\?.*)?$/i.test(persona.avatar);
  const avatarFallback = persona.name?.[0]?.toUpperCase() ?? '?';

  return (
    <div className={`persona-row border rounded p-3 mb-2 bg-white${errors.length ? ' persona-row--invalid' : ''}`}>
      <div className="d-flex align-items-center mb-3">
        <span
          className="persona-row__avatar mr-2"
          style={{ backgroundColor: persona.color || '#6c757d' }}
          aria-hidden="true"
        >
          {avatarIsImage ? <img src={persona.avatar} alt="" /> : (persona.avatar || avatarFallback)}
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
          <label className="custom-control-label small" htmlFor={`persona-enabled-${index}`}>
            Enabled
          </label>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group col-md-5">
          <label className="small font-weight-bold" htmlFor={`persona-name-${index}`}>Display name</label>
          <input
            id={`persona-name-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Foundational Teacher"
          />
        </div>
        <div className="form-group col-md-4">
          <label className="small font-weight-bold" htmlFor={`persona-key-${index}`}>Key</label>
          <input
            id={`persona-key-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="auto-generated"
          />
          <small className="form-text text-muted">Used to map onto backend slots.</small>
        </div>
        <div className="form-group col-md-3">
          <label className="small font-weight-bold" htmlFor={`persona-role-${index}`}>Role</label>
          <select
            id={`persona-role-${index}`}
            className="form-control form-control-sm"
            value={persona.role}
            onChange={(e) => onChange({ role: e.target.value })}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group col-md-9">
          <label className="small font-weight-bold" htmlFor={`persona-personality-${index}`}>Personality summary</label>
          <input
            id={`persona-personality-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.personality || ''}
            onChange={(e) => onChange({ personality: e.target.value })}
            placeholder="One-line summary shown in the persona strip."
          />
        </div>
        <div className="form-group col-md-3">
          <label className="small font-weight-bold" htmlFor={`persona-color-${index}`}>Color</label>
          <input
            id={`persona-color-${index}`}
            type="color"
            className="form-control form-control-sm p-1"
            value={persona.color || '#7f8c8d'}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="small font-weight-bold" htmlFor={`persona-avatar-${index}`}>Avatar asset path or emoji</label>
        <input
          id={`persona-avatar-${index}`}
          type="text"
          className="form-control form-control-sm"
          value={persona.avatar || ''}
          onChange={(e) => onChange({ avatar: e.target.value })}
          placeholder="🧑 or /server/plugins/sh-shp-llm_agentic_chat/assets/avatars/persona.svg"
        />
      </div>

      <div className="form-group">
        <label className="small font-weight-bold" htmlFor={`persona-instructions-${index}`}>Personality / instructions</label>
        <textarea
          id={`persona-instructions-${index}`}
          className="form-control form-control-sm"
          rows={5}
          value={persona.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          placeholder="Free-form instructions for this persona. Use {module_content} to inject the module text."
        />
      </div>

      {errors.length > 0 && (
        <div className="alert alert-warning small py-2 mb-3">
          <ul className="mb-0 pl-3">
            {errors.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
        </div>
      )}

      <div className="d-flex justify-content-end">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary mr-2"
          onClick={onDuplicate}
          title="Duplicate this persona"
        >
          <i className="fa fa-copy mr-1"></i>Duplicate
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-danger mr-2"
          onClick={onRemove}
          title="Remove this persona"
        >
          <i className="fa fa-trash mr-1"></i>Remove
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
};
