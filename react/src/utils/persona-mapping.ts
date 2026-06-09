/**
 * Helpers for working with the flexible, ordered persona library.
 *
 * Personas are a plain ordered list of `{ key, name, description, … }`.
 * Sections pick + order a subset; the PHP side turns that order into a
 * participant map (`mediator`, `persona_1`, `persona_2`, …). The mediator
 * persona is built by the backend and exposed through
 * `AgenticChatConfig.mediator`, not through the editable library.
 */
import type { Persona, PersonaSlotMap } from '../types';

/** Build a key -> Persona lookup map. */
export function indexPersonas(personas: Persona[]): Record<string, Persona> {
  const out: Record<string, Persona> = {};
  for (const p of personas) {
    if (p && typeof p.key === 'string' && p.key) {
      out[p.key] = p;
    }
  }
  return out;
}

/** Resolve a participant-map slot to its persona, if any. */
export function resolveSlotPersona(
  personas: Persona[],
  slotMap: PersonaSlotMap,
  slot: string
): Persona | null {
  const key = slotMap[slot];
  if (!key) return null;
  return personas.find((p) => p.key === key) || null;
}

/**
 * Try to identify the persona behind an assistant message author label.
 *
 * Accepts either an explicit persona key, a case-insensitive match on the
 * display name, or a participant-map slot id (`mediator`, `persona_1`, …).
 */
export function findPersonaByAuthor(
  personas: Persona[],
  slotMap: PersonaSlotMap,
  author: string | undefined | null
): Persona | null {
  if (!author) return null;
  const cleaned = author.replace(/[\[\](){}]/g, '').trim().toLowerCase();
  if (!cleaned) return null;

  // 1) direct key match
  const byKey = personas.find((p) => p.key.toLowerCase() === cleaned);
  if (byKey) return byKey;

  // 2) display-name match
  const byName = personas.find((p) => p.name.toLowerCase() === cleaned);
  if (byName) return byName;

  // 3) participant-map slot match (e.g. "persona_1" -> first key).
  //    The executor token may be a bare slot ("persona_1") or the
  //    backend's positional executor id ("persona_1_teacher"). Match the
  //    slot only at a digit boundary so "persona_1" does NOT swallow
  //    "persona_12_teacher" (which would mis-attribute the 12th persona).
  for (const [slot, key] of Object.entries(slotMap)) {
    if (!key) continue;
    const s = slot.toLowerCase();
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // exact slot, or slot followed by a non-digit (so "_teacher" suffix
    // matches but a longer "persona_1N" index does not).
    if (s === cleaned || new RegExp(`^${escaped}(?![0-9])`).test(cleaned)) {
      const persona = personas.find((p) => p.key === key);
      if (persona) return persona;
    }
  }
  return null;
}

/**
 * Slugify a free-form name into a persona key. Mirrors the PHP
 * AgenticChatPersonaService::slugify() logic so admin <-> backend stays
 * consistent.
 */
export function slugifyPersonaKey(name: string): string {
  const s = (name || '').toLowerCase().trim();
  if (!s) return '';
  return (
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'persona'
  );
}

/**
 * Validate a persona row. Returns an array of human-readable errors;
 * empty array means valid.
 */
export function validatePersona(p: Persona, allKeys: string[]): string[] {
  const errors: string[] = [];
  if (!p.name || !p.name.trim()) errors.push('Name is required.');
  if (!p.description || !p.description.trim()) {
    errors.push('Description is required.');
  }
  if (p.key && allKeys.filter((k) => k === p.key).length > 1) {
    errors.push(`Internal key "${p.key}" is duplicated.`);
  }
  if (p.color && !/^#[0-9a-fA-F]{3,8}$/.test(p.color)) {
    errors.push('Color must be a hex value (e.g. #4cafef).');
  }
  return errors;
}

/**
 * Default empty persona used when the user clicks "Add persona".
 */
export function createEmptyPersona(suffix?: number | string): Persona {
  return {
    key: suffix ? `persona_${suffix}` : '',
    name: '',
    description: '',
    color: '#7f8c8d',
    avatar: '',
    enabled: true,
  };
}

/**
 * Truncate the persona description for a one-line preview shown on the
 * persona summary card. Falls back to the first sentence; if no sentence
 * terminator is found, takes the first 80 characters.
 */
export function descriptionPreview(text: string | undefined, max = 80): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const sentenceEnd = trimmed.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd <= max) {
    return trimmed.slice(0, sentenceEnd + 1);
  }
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd() + '…';
}
