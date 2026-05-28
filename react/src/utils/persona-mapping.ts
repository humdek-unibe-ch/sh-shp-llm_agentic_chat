/**
 * Helpers for working with the simplified persona library.
 *
 * Each persona is authored against one of three semantic slot types
 * (`foundational` / `inclusive` / `inquiry`) that the plugin maps
 * 1:1 onto the positional teacher slots the FoResTCHAT backend
 * exposes (`persona_1` / `persona_2` / `persona_3`). The mediator
 * persona is fixed in the backend and is exposed through
 * `AgenticChatConfig.mediator`, not through the editable library.
 */
import type { Persona, PersonaSlotMap, PersonaSlotType } from '../types';
import { PERSONA_SLOT_TYPES } from '../types';

/**
 * Slot-type options shown in the admin editor dropdown.
 * Mirrors `AGENTIC_CHAT_PERSONA_SLOT_TYPES` on the PHP side.
 */
export const SLOT_TYPE_OPTIONS: ReadonlyArray<{ value: PersonaSlotType; label: string }> = [
  { value: 'foundational', label: 'Foundational' },
  { value: 'inclusive', label: 'Inclusive' },
  { value: 'inquiry', label: 'Inquiry' },
];

/**
 * Semantic slot type → positional backend slot id.
 *
 * Kept in lock-step with `AGENTIC_CHAT_SLOT_TYPE_TO_BACKEND_SLOT`
 * on the PHP side. Used by the admin editor to show researchers
 * which `persona_<N>_*` slot a persona will feed at runtime.
 */
export const SLOT_TYPE_TO_BACKEND_SLOT: Readonly<Record<PersonaSlotType, string>> = {
  foundational: 'persona_1',
  inclusive: 'persona_2',
  inquiry: 'persona_3',
};

/** Convenience accessor for `SLOT_TYPE_TO_BACKEND_SLOT`. */
export function slotTypeToBackendSlot(
  slotType: PersonaSlotType | null | undefined
): string {
  if (!slotType) return SLOT_TYPE_TO_BACKEND_SLOT.foundational;
  return SLOT_TYPE_TO_BACKEND_SLOT[slotType] ?? 'persona_1';
}

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

/** Resolve a slot to its persona, if any. */
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
 * case-insensitive match on display name / slot label.
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
  if (!p.slot_type || !PERSONA_SLOT_TYPES.includes(p.slot_type)) {
    errors.push('Slot type must be foundational, inclusive or inquiry.');
  }
  if (!p.instructions || !p.instructions.trim()) {
    errors.push('Instructions are required.');
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
 * Defaults to the first slot type so the row is immediately valid
 * once a name + instructions are filled in.
 */
export function createEmptyPersona(suffix?: number | string): Persona {
  return {
    key: suffix ? `persona_${suffix}` : '',
    name: '',
    slot_type: 'foundational',
    instructions: '',
    color: '#7f8c8d',
    avatar: '',
    enabled: true,
  };
}

/** Human-readable label for a slot type (used by row summaries / option labels). */
export function formatSlotType(slotType: PersonaSlotType | null | undefined): string {
  if (!slotType) return '—';
  const found = SLOT_TYPE_OPTIONS.find((o) => o.value === slotType);
  return found ? found.label : slotType;
}

/**
 * Group personas by slot type. Useful for the section-picker validation
 * ("at most one per slot") and for the fallback hint shown to admins.
 */
export function groupPersonasBySlot(personas: Persona[]): Record<PersonaSlotType, Persona[]> {
  const out: Record<PersonaSlotType, Persona[]> = {
    foundational: [],
    inclusive: [],
    inquiry: [],
  };
  for (const p of personas) {
    if (p.slot_type && PERSONA_SLOT_TYPES.includes(p.slot_type)) {
      out[p.slot_type].push(p);
    }
  }
  return out;
}

/**
 * Truncate the persona instructions for a one-line preview shown on
 * the persona summary card. Falls back to the first sentence; if no
 * sentence terminator is found, takes the first 80 characters.
 */
export function instructionsPreview(text: string | undefined, max = 80): string {
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
