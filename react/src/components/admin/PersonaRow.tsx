/**
 * PersonaRow — inline edit form for a single persona variant.
 *
 * v1.1.0 simplified the fields shown to researchers down to what the
 * Python backend actually consumes:
 *
 *   - name          (display name)
 *   - slot_type     (foundational / inclusive / inquiry)
 *   - avatar        (asset path or emoji)
 *   - color         (hex)
 *   - instructions  (system prompt for the slot)
 *   - enabled       (include in fallback / section selection)
 *
 * The internal `key` field is auto-derived from the name and hidden
 * from the editor. `role` and `personality` were removed because the
 * backend does not support arbitrary roles and a separate personality
 * summary added maintenance cost without changing behaviour.
 *
 * @module components/admin/PersonaRow
 */
import React from 'react';
import type { Persona, PersonaSlotType } from '../../types';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';
import {
  SLOT_TYPE_OPTIONS,
  slotTypeToBackendSlot,
} from '../../utils/persona-mapping';

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
  const avatarIsImage = isImageAvatar(persona.avatar);
  const avatarFallback = persona.name?.[0]?.toUpperCase() ?? '?';

  return (
    <div className={`persona-row border rounded p-3 mb-2 bg-white${errors.length ? ' persona-row--invalid' : ''}`}>
      <div className="d-flex align-items-center mb-3">
        <span
          className="persona-row__avatar mr-2"
          style={{ backgroundColor: persona.color || '#6c757d' }}
          aria-hidden="true"
        >
          {avatarIsImage ? (
            <img src={resolveAvatarUrl(persona.avatar)} alt="" />
          ) : (
            persona.avatar || avatarFallback
          )}
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
        <div className="form-group col-md-6">
          <label className="small font-weight-bold" htmlFor={`persona-name-${index}`}>Display name</label>
          <input
            id={`persona-name-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Lea"
          />
        </div>
        <div className="form-group col-md-4">
          <label className="small font-weight-bold" htmlFor={`persona-slot-type-${index}`}>Slot type</label>
          <select
            id={`persona-slot-type-${index}`}
            className="form-control form-control-sm"
            value={persona.slot_type || 'foundational'}
            onChange={(e) => onChange({ slot_type: e.target.value as PersonaSlotType })}
          >
            {SLOT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <small className="form-text text-muted">
            Maps onto the backend's positional teacher slot:{' '}
            <code>{slotTypeToBackendSlot(persona.slot_type)}</code>.
          </small>
        </div>
        <div className="form-group col-md-2">
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
        <div className="d-flex align-items-center">
          {avatarIsImage && (
            <span
              className="persona-row__avatar persona-row__avatar--preview mr-2 border"
              style={{ backgroundColor: persona.color || '#6c757d' }}
              aria-hidden="true"
              title="Preview"
            >
              <img src={resolveAvatarUrl(persona.avatar)} alt="" />
            </span>
          )}
          <input
            id={`persona-avatar-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.avatar || ''}
            onChange={(e) => onChange({ avatar: e.target.value })}
            placeholder="🧑   or   /assets/uploads/persona.svg   or   https://example.com/foo.png"
          />
        </div>
        <small className="form-text text-muted">
          Accepts: an emoji / short label (rendered as text), an absolute server path
          like <code>/assets/uploads/foo.png</code> (a CMS-uploaded asset is automatically
          prefixed with the project's <code>BASE_PATH</code>) or a full <code>https://</code> URL.
        </small>
      </div>

      <div className="form-group">
        <label className="small font-weight-bold" htmlFor={`persona-instructions-${index}`}>Instructions</label>
        <textarea
          id={`persona-instructions-${index}`}
          className="form-control form-control-sm"
          rows={6}
          value={persona.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          placeholder="System prompt sent to the backend for this persona variant. Describe role and teaching style only — the backend appends the module context automatically."
        />
        <small className="form-text text-muted">
          Sent as <code>{slotTypeToBackendSlot(persona.slot_type)}_instructions</code> on every{' '}
          <code>/reflect/configure</code> call. The persona display name is sent as{' '}
          <code>{slotTypeToBackendSlot(persona.slot_type)}_name</code>.
        </small>
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
