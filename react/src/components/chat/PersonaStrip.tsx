/**
 * PersonaStrip - small horizontal strip showing the active persona and
 * the other personas mapped to participant-map slots.
 */
import React, { useMemo } from 'react';
import type { Persona, PersonaSlotMap } from '../../types';
import { indexPersonas } from '../../utils/persona-mapping';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';

/**
 * Friendly label for a participant-map slot id. `mediator` is fixed;
 * positional persona slots (`persona_1`, `persona_2`, …) become
 * "Teacher 1", "Teacher 2", … so the strip works for any persona count.
 */
function slotLabel(slot: string): string {
  if (slot === 'mediator') return 'Mediator';
  const m = /^persona_(\d+)$/.exec(slot);
  if (m) return `Teacher ${m[1]}`;
  return slot;
}

export interface PersonaStripProps {
  personas: Persona[];
  slotMap: PersonaSlotMap;
  activePersonaKey: string | null;
  /** Persona key of a pending handoff target (shows a "handing off" hint). */
  handoffTargetKey?: string | null;
}

export const PersonaStrip: React.FC<PersonaStripProps> = ({
  personas,
  slotMap,
  activePersonaKey,
  handoffTargetKey,
}) => {
  const byKey = useMemo(() => indexPersonas(personas), [personas]);

  const slotted = useMemo(() => {
    const seen = new Set<string>();
    const out: { slot: string; persona: Persona }[] = [];
    for (const [slot, key] of Object.entries(slotMap)) {
      if (!key) continue;
      if (seen.has(key)) continue;
      const p = byKey[key];
      if (!p) continue;
      seen.add(key);
      out.push({ slot, persona: p });
    }
    return out;
  }, [byKey, slotMap]);

  if (slotted.length === 0) return null;

  return (
    <div className="agentic-personas" role="list">
      {slotted.map(({ slot, persona }) => {
        const isActive = activePersonaKey === persona.key;
        const isHandoffTarget = !isActive && handoffTargetKey === persona.key;
        const avatarIsImage = isImageAvatar(persona.avatar);
        const label = slotLabel(slot);
        const classes = [
          'agentic-personas__item',
          isActive ? 'is-active' : '',
          isHandoffTarget ? 'is-handoff-target' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={persona.key}
            role="listitem"
            className={classes}
            title={
              isHandoffTarget
                ? `Handing off to ${persona.name} — ${label}`
                : `${persona.name} — ${label}`
            }
            style={{ borderColor: persona.color || undefined }}
          >
            <span
              className="agentic-personas__avatar"
              style={persona.color ? { backgroundColor: persona.color } : undefined}
              aria-hidden="true"
            >
              {avatarIsImage ? (
                <img src={resolveAvatarUrl(persona.avatar)} alt="" />
              ) : (
                persona.avatar || persona.name.charAt(0).toUpperCase()
              )}
            </span>
            <span className="agentic-personas__name">{persona.name}</span>
            {isHandoffTarget && (
              <span className="agentic-personas__handoff" aria-hidden="true">
                <i className="fas fa-arrow-right" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
