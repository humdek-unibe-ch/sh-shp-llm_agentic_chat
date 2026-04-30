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
import { createEmptyPersona, slugifyPersonaKey } from '../../utils/persona-mapping';

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
  const isImage = !!persona.avatar &&
    /^(\/|https?:\/\/|\.\/|\.\.\/).+\.(svg|png|jpe?g|webp|gif)(\?.*)?$/i.test(persona.avatar);
  const fallback = (persona.name || persona.key || '?')[0]?.toUpperCase() ?? '?';
  return (
    <span
      className="persona-row__avatar"
      style={{ backgroundColor: persona.color || '#6c757d' }}
      aria-hidden="true"
    >
      {isImage ? <img src={persona.avatar} alt="" /> : (persona.avatar || fallback)}
    </span>
  );
};

function formatRole(role: string): string {
  if (!role) return '—';
  return role
    .replace(/^agentic_persona_role_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    if ((!merged.key || !merged.key.trim()) && merged.name) {
      merged.key = slugifyPersonaKey(merged.name);
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

  const remove = (idx: number) => {
    if (!window.confirm('Remove this persona?')) return;
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
          Personas are stored globally and shared by every <code>agenticChat</code> section.
          Each section maps a subset of these personas onto the backend's persona slots.
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
          return (
            <div key={`row-${idx}`} className={cardClass}>
              <div className="d-flex align-items-center">
                <Avatar persona={persona} />
                <div className="ml-3 flex-grow-1 min-width-0">
                  <div className="d-flex align-items-center">
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
                  <div className="text-muted small mt-1">
                    <code className="mr-2">{persona.key || '—'}</code>
                    <span>{formatRole(persona.role)}</span>
                    {persona.personality && (
                      <span className="d-block d-md-inline ml-md-2 mt-1 mt-md-0">
                        — {persona.personality}
                      </span>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <div className="btn-group btn-group-sm ml-2">
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
