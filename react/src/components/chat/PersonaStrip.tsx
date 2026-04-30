/**
 * PersonaStrip - small horizontal strip showing the active persona and
 * the other personas mapped to backend slots.
 */
import React, { useMemo } from 'react';
import type { Persona, PersonaSlotMap } from '../../types';
import { indexPersonas } from '../../utils/persona-mapping';
import { isImageAvatar, resolveAvatarUrl } from '../../utils/avatar';

export interface PersonaStripProps {
  personas: Persona[];
  slotMap: PersonaSlotMap;
  activePersonaKey: string | null;
}

export const PersonaStrip: React.FC<PersonaStripProps> = ({
  personas,
  slotMap,
  activePersonaKey,
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
        const avatarIsImage = isImageAvatar(persona.avatar);
        return (
          <div
            key={persona.key}
            role="listitem"
            className={`agentic-personas__item${isActive ? ' is-active' : ''}`}
            title={`${persona.name} — ${slot}`}
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
          </div>
        );
      })}
    </div>
  );
};
