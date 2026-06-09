/**
 * PersonaEditor — manages the global persona library.
 *
 * Card-based panel mirroring the LLM `ApiKeysSection`:
 * shows compact rows for each persona with avatar, name, role and key,
 * plus inline edit/duplicate/delete actions and a single "Add persona"
 * button in the card header.
 *
 * @module components/admin/PersonaEditor
 */
import React, { useState } from 'react';
import type { Persona } from '../../types';
import { PersonaRow } from './PersonaRow';
import {
  createEmptyPersona,
  descriptionPreview,
  slugifyPersonaKey,
} from '../../utils/persona-mapping';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';
import { showConfirm } from '../../utils/confirm';

export interface PersonaEditorProps {
  personas: Persona[];
  errors: Record<number, string[]>;
  onChange: (personas: Persona[]) => void;
  disabled?: boolean;
}

interface AvatarProps {
  persona: Persona;
}

const Avatar: React.FC<AvatarProps> = ({ persona }) => {
  const isImage = isImageAvatar(persona.avatar);
  const fallback = (persona.name || persona.key || '?')[0]?.toUpperCase() ?? '?';
  return (
    <span
      className="persona-row__avatar"
      style={{ backgroundColor: persona.color || '#6c757d' }}
      aria-hidden="true"
    >
      {isImage ? (
        <img src={resolveAvatarUrl(persona.avatar)} alt="" />
      ) : (
        persona.avatar || fallback
      )}
    </span>
  );
};

/** PersonaEditor component. */
export const PersonaEditor: React.FC<PersonaEditorProps> = ({
  personas,
  errors,
  onChange,
  disabled,
}) => {
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const startAdd = () => {
    const next = [...personas, createEmptyPersona(personas.length + 1)];
    onChange(next);
    setEditIndex(next.length - 1);
  };

  const startEdit = (idx: number) => {
    setEditIndex(idx);
  };

  const cancelEdit = () => {
    setEditIndex(null);
  };

  const updatePersona = (idx: number, patch: Partial<Persona>) => {
    const copy = personas.slice();
    const merged = { ...copy[idx], ...patch };
    // Key is hidden from the editor in v1.1.0+ — always derive it from
    // the name so renames produce a fresh slug. Duplicate slugs are
    // suffixed on the PHP side during `parse()`.
    if (merged.name && merged.name.trim()) {
      merged.key = slugifyPersonaKey(merged.name);
    } else if (!merged.key) {
      merged.key = `persona_${idx + 1}`;
    }
    copy[idx] = merged;
    onChange(copy);
  };

  const duplicate = (idx: number) => {
    const original = personas[idx];
    if (!original) return;
    const copy = personas.slice();
    copy.splice(idx + 1, 0, {
      ...original,
      key: original.key ? `${original.key}_copy` : 'persona_copy',
      name: original.name ? `${original.name} (copy)` : '',
    });
    onChange(copy);
    setEditIndex(idx + 1);
  };

  // Reorder a persona by one position. The library order is meaningful:
  // it decides the positional backend slot (persona_1, persona_2, …) each
  // persona feeds, so the up/down controls let admins set the speaking
  // order of the personas.
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= personas.length) return;
    const copy = personas.slice();
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    onChange(copy);
    if (editIndex === idx) setEditIndex(target);
    else if (editIndex === target) setEditIndex(idx);
  };

  const remove = async (idx: number) => {
    const target = personas[idx];
    const label = target?.name?.trim() || target?.key?.trim() || `Persona #${idx + 1}`;
    const confirmed = await showConfirm({
      title: 'Remove persona',
      message: `Remove the persona <strong>${label}</strong> from the global library? This cannot be undone unless you re-save the previous values.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      type: 'red',
    });
    if (!confirmed) return;
    const copy = personas.filter((_, i) => i !== idx);
    onChange(copy);
    if (editIndex === idx) setEditIndex(null);
    else if (editIndex !== null && editIndex > idx) setEditIndex(editIndex - 1);
  };

  const totalErrors = Object.values(errors).reduce((acc, e) => acc + e.length, 0);

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h6 className="mb-0">
          <i className="fa fa-users mr-2 text-muted"></i>
          Persona Library
        </h6>
        {!disabled && editIndex === null && (
          <button className="btn btn-sm btn-outline-primary" onClick={startAdd}>
            <i className="fa fa-plus mr-1"></i> Add persona
          </button>
        )}
      </div>
      <div className="card-body">
        <p className="text-muted small mb-3">
          Ordered, flexible library of teacher personas. Each persona has a name and a
          description (the system prompt sent to the backend). The library order decides
          the speaking order — use the arrows to reorder. Sections pick + order which
          personas take part and whether to use the group-chat mediator; the mediator
          itself is built by the backend.
        </p>

        {totalErrors > 0 && (
          <div className="alert alert-warning small py-2 mb-3" role="alert">
            <i className="fa fa-exclamation-triangle mr-1"></i>
            {totalErrors} validation error{totalErrors === 1 ? '' : 's'} — fix before saving.
          </div>
        )}

        {personas.length === 0 && editIndex === null && (
          <p className="text-muted small mb-0">
            No personas configured. Click <em>Add persona</em> to create one.
          </p>
        )}

        {personas.map((persona, idx) => {
          if (editIndex === idx) {
            return (
              <PersonaRow
                key={`edit-${idx}`}
                persona={persona}
                index={idx}
                errors={errors[idx] || []}
                onChange={(patch) => updatePersona(idx, patch)}
                onDuplicate={() => duplicate(idx)}
                onRemove={() => remove(idx)}
                onClose={cancelEdit}
              />
            );
          }
          const personaErrs = errors[idx] || [];
          const cardClass = `persona-summary mb-2 p-3 border rounded bg-light${personaErrs.length ? ' persona-summary--invalid' : ''}`;
          const preview = descriptionPreview(persona.description);
          return (
            <div key={`row-${idx}`} className={cardClass}>
              <div className="d-flex align-items-center">
                <Avatar persona={persona} />
                <div className="ml-3 flex-grow-1 min-width-0">
                  <div className="d-flex align-items-center">
                    <span className="badge badge-light border mr-2" title="Speaking order">
                      #{idx + 1}
                    </span>
                    <strong className="text-truncate">
                      {persona.name || <em className="text-muted">Untitled persona</em>}
                    </strong>
                    {!persona.enabled && (
                      <span className="badge badge-secondary ml-2">disabled</span>
                    )}
                    {personaErrs.length > 0 && (
                      <span className="badge badge-warning ml-2">{personaErrs.length} error{personaErrs.length === 1 ? '' : 's'}</span>
                    )}
                  </div>
                  {preview && (
                    <div className="text-muted small mt-1 text-truncate">
                      {preview}
                    </div>
                  )}
                </div>
                {!disabled && (
                  <div className="btn-group btn-group-sm ml-2">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                    >
                      <i className="fa fa-arrow-up"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => move(idx, 1)}
                      disabled={idx === personas.length - 1}
                      title="Move down"
                    >
                      <i className="fa fa-arrow-down"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => startEdit(idx)}
                      title="Edit"
                    >
                      <i className="fa fa-edit"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => duplicate(idx)}
                      title="Duplicate"
                    >
                      <i className="fa fa-copy"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => remove(idx)}
                      title="Remove"
                    >
                      <i className="fa fa-trash"></i>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
