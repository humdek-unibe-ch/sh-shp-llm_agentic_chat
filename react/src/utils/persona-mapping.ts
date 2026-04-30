/**
 * Helpers for working with the persona library + slot-map.
 */
import type { Persona, PersonaSlotMap } from '../types';

/**
 * Build a key -> Persona lookup map.
 */
export function indexPersonas(personas: Persona[]): Record<string, Persona> {
  const out: Record<string, Persona> = {};
  for (const p of personas) {
    if (p && typeof p.key === 'string' && p.key) {
      out[p.key] = p;
    }
  }
  return out;
}

/**
 * Resolve a slot to its persona, if any.
 */
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
 * The FoResTCHAT mediator uses bracketed labels like "[Foundational]".
 * Accept either an explicit persona key (matching the slot map) or a
 * case-insensitive match on display name / role label.
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

  // 3) slot-mapped name (e.g. mediator -> first key)
  for (const [slot, key] of Object.entries(slotMap)) {
    if (key && (slot.toLowerCase().includes(cleaned) || cleaned.includes(slot.toLowerCase()))) {
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
  if (!p.key || !p.key.trim()) errors.push('Key is required.');
  if (p.key && allKeys.filter((k) => k === p.key).length > 1) {
    errors.push(`Key "${p.key}" is duplicated.`);
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
    role: 'other',
    personality: '',
    instructions: '',
    color: '#7f8c8d',
    avatar: '',
    enabled: true,
  };
}
