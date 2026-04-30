/**
 * usePersonas - thin state container for the admin persona editor.
 *
 * Keeps an array of Persona, exposes mutation helpers, and tracks
 * dirtiness so the parent component can show a save indicator.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Persona } from '../types';
import { createEmptyPersona, slugifyPersonaKey, validatePersona } from '../utils/persona-mapping';

export interface UsePersonasResult {
  personas: Persona[];
  errors: Record<number, string[]>;
  dirty: boolean;
  setAll: (next: Persona[]) => void;
  add: () => void;
  update: (index: number, patch: Partial<Persona>) => void;
  duplicate: (index: number) => void;
  remove: (index: number) => void;
  reset: (next: Persona[]) => void;
}

export function usePersonas(initial: Persona[]): UsePersonasResult {
  const [personas, setPersonas] = useState<Persona[]>(initial);
  const [baseline, setBaseline] = useState<Persona[]>(initial);

  const dirty = useMemo(
    () => JSON.stringify(personas) !== JSON.stringify(baseline),
    [personas, baseline]
  );

  const errors = useMemo(() => {
    const all = personas.map((p) => p.key);
    const out: Record<number, string[]> = {};
    personas.forEach((p, idx) => {
      const errs = validatePersona(p, all);
      if (errs.length) out[idx] = errs;
    });
    return out;
  }, [personas]);

  const setAll = useCallback((next: Persona[]) => setPersonas(next), []);

  const add = useCallback(() => {
    setPersonas((prev) => [
      ...prev,
      createEmptyPersona(prev.length + 1),
    ]);
  }, []);

  const update = useCallback((index: number, patch: Partial<Persona>) => {
    setPersonas((prev) => {
      const copy = prev.slice();
      const merged = { ...copy[index], ...patch };
      // Auto-fill key from name when user leaves key empty.
      if ((!merged.key || !merged.key.trim()) && merged.name) {
        merged.key = slugifyPersonaKey(merged.name);
      }
      copy[index] = merged;
      return copy;
    });
  }, []);

  const duplicate = useCallback((index: number) => {
    setPersonas((prev) => {
      const original = prev[index];
      if (!original) return prev;
      const copy = prev.slice();
      copy.splice(index + 1, 0, {
        ...original,
        key: original.key ? `${original.key}_copy` : 'persona_copy',
        name: original.name ? `${original.name} (copy)` : '',
      });
      return copy;
    });
  }, []);

  const remove = useCallback((index: number) => {
    setPersonas((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback((next: Persona[]) => {
    setPersonas(next);
    setBaseline(next);
  }, []);

  return { personas, errors, dirty, setAll, add, update, duplicate, remove, reset };
}
