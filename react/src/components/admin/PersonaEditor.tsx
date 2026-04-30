/**
 * PersonaEditor - manages the global persona library.
 */
import React, { useState } from 'react';
import type { Persona } from '../../types';
import { usePersonas } from '../../hooks/usePersonas';
import { PersonaRow } from './PersonaRow';

export interface PersonaEditorProps {
  initialPersonas: Persona[];
  onSave: (personas: Persona[]) => Promise<{ ok: boolean; error?: string }>;
}

export const PersonaEditor: React.FC<PersonaEditorProps> = ({ initialPersonas, onSave }) => {
  const ed = usePersonas(initialPersonas);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const res = await onSave(ed.personas);
    setSaving(false);
    if (res.ok) {
      ed.reset(ed.personas);
      setSavedAt(new Date().toLocaleTimeString());
    } else {
      setSaveError(res.error || 'Save failed');
    }
  };

  const totalErrors = Object.values(ed.errors).reduce((acc, e) => acc + e.length, 0);

  return (
    <section className="agentic-admin__section card mb-4">
      <header className="card-header d-flex align-items-center">
        <h4 className="mb-0 mr-auto">Persona library</h4>
        <button type="button" className="btn btn-outline-primary btn-sm mr-2" onClick={ed.add}>
          + Add persona
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || !ed.dirty || totalErrors > 0}
        >
          {saving ? 'Saving…' : ed.dirty ? 'Save personas' : 'Saved'}
        </button>
      </header>
      <div className="card-body">
        {savedAt && !ed.dirty && (
          <div className="alert alert-success py-1">Saved at {savedAt}.</div>
        )}
        {saveError && <div className="alert alert-danger py-1">{saveError}</div>}
        {totalErrors > 0 && (
          <div className="alert alert-warning py-1">
            Fix {totalErrors} validation error{totalErrors === 1 ? '' : 's'} before saving.
          </div>
        )}

        {ed.personas.length === 0 ? (
          <p className="text-muted">
            No personas yet. Click <em>Add persona</em> to create one.
          </p>
        ) : (
          ed.personas.map((p, i) => (
            <PersonaRow
              key={`${p.key || 'new'}-${i}`}
              persona={p}
              index={i}
              errors={ed.errors[i] || []}
              onChange={(patch) => ed.update(i, patch)}
              onDuplicate={() => ed.duplicate(i)}
              onRemove={() => ed.remove(i)}
            />
          ))
        )}
      </div>
    </section>
  );
};
