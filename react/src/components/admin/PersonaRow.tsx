/**
 * PersonaRow — inline edit form for a single persona.
 *
 * Personas are a flexible, ordered list. The fields shown to researchers
 * map 1:1 onto what the backend consumes:
 *
 *   - name         (display name, sent as the persona name)
 *   - avatar       (asset path or emoji)
 *   - color        (hex)
 *   - description  (system prompt sent as the persona description)
 *   - enabled      (include in section selection / fallback)
 *
 * The internal `key` field is auto-derived from the name and hidden
 * from the editor. There are no fixed slot types: section order +
 * selection decide which positional backend slot each persona feeds.
 *
 * @module components/admin/PersonaRow
 */
import React from 'react';
import type { Persona } from '../../types';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';

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
        <div className="form-group col-md-9">
          <label className="small font-weight-bold" htmlFor={`persona-name-${index}`}>Display name</label>
          <input
            id={`persona-name-${index}`}
            type="text"
            className="form-control form-control-sm"
            value={persona.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Lea"
          />
          <small className="form-text text-muted">
            Sent to the backend as the persona <code>name</code>.
          </small>
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
        <label className="small font-weight-bold" htmlFor={`persona-description-${index}`}>Description</label>
        <textarea
          id={`persona-description-${index}`}
          className="form-control form-control-sm"
          rows={6}
          value={persona.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="System prompt sent to the backend for this persona. Describe role and teaching style only — the backend supplies the module context separately."
        />
        <small className="form-text text-muted">
          Sent as the persona <code>description</code> in the{' '}
          <code>personas</code> array on every <code>/reflect/configure</code> call.
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
