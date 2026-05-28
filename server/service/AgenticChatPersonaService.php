<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persona JSON validation, normalisation, and slot resolution.
 *
 * Personas are authored as variants for the three teacher slots
 * supported by the Python reflection backend. Every persona is a JSON
 * object with the following shape:
 *
 *   {
 *     "key":          string,   // stable internal slug (auto-derived from name)
 *     "name":         string,   // display name shown in the chat UI
 *     "slot_type":    string,   // one of AGENTIC_CHAT_PERSONA_SLOT_TYPES
 *     "instructions": string,   // system-prompt sent to /reflect/configure
 *     "color":        string,   // CSS hex color used for the avatar bubble
 *     "avatar":       string,   // emoji / short label / image URL / asset path
 *     "enabled":      boolean   // exclude from selection + fallback when false
 *   }
 *
 * Notes on what is intentionally NOT here:
 *   - `role` (mediator/teacher/expert/supporter/other) — removed in
 *     v1.1.0. The backend only supports three teacher slots plus a
 *     fixed mediator, so generic roles cannot map to anything.
 *   - `personality` summary — removed; the first sentence of
 *     `instructions` already serves as a preview in the UI.
 *   - Mediator entries — the mediator is hard-coded in the backend and
 *     in the plugin (see `AGENTIC_CHAT_MEDIATOR_PERSONA`). It must not
 *     be authored as a persona variant.
 *
 * Sections choose a subset of personas through the
 * `agentic_chat_personas_to_use` field. The resolver enforces
 * "at most one persona per slot type" and falls back to the first
 * enabled global persona for any slot type the section did not pick.
 */
class AgenticChatPersonaService
{
    /**
     * Decode a JSON string into a normalised persona array.
     * Invalid input is degraded to an empty array (never throws), so the
     * editor can recover from a corrupted save.
     *
     * @param string|array|null $raw
     * @return array<int, array<string, mixed>>
     */
    public function parse($raw)
    {
        if (is_array($raw)) {
            $items = $raw;
        } else {
            $raw = (string) ($raw ?? '');
            if ($raw === '' || $raw === '[]') {
                return [];
            }
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                return [];
            }
            $items = $decoded;
        }

        $personas = [];
        $seenKeys = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $persona = $this->normalisePersona($item);
            if ($persona === null) {
                continue;
            }
            $key = $persona['key'];
            // Auto-suffix collisions so multiple variants can share a
            // base name without silently dropping rows.
            if (isset($seenKeys[$key])) {
                $i = 2;
                while (isset($seenKeys["{$key}_{$i}"])) {
                    $i++;
                }
                $key = "{$key}_{$i}";
                $persona['key'] = $key;
            }
            $seenKeys[$key] = true;
            $personas[] = $persona;
            if (count($personas) >= AGENTIC_CHAT_MAX_PERSONAS) {
                break;
            }
        }

        return $personas;
    }

    /**
     * Encode a persona array back to canonical JSON. Round-trips with parse().
     *
     * @param array $personas
     * @return string
     */
    public function encode(array $personas)
    {
        $clean = [];
        foreach ($personas as $persona) {
            if (!is_array($persona)) {
                continue;
            }
            $normalised = $this->normalisePersona($persona);
            if ($normalised !== null) {
                $clean[] = $normalised;
            }
        }
        return json_encode(array_values($clean), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * Validate a single persona object. Returns null on hard failure
     * (missing/unusable name or unknown slot type).
     *
     * @param array $persona
     * @return array|null
     */
    public function normalisePersona(array $persona)
    {
        $name = isset($persona['name']) ? trim((string) $persona['name']) : '';
        if ($name === '') {
            return null;
        }

        // Key is auto-derived from name when missing or invalid. Admins
        // do not edit the key directly in v1.1.0+ — the editor hides
        // the field — but we still honour user-supplied values for
        // backwards-compatible imports.
        $key = isset($persona['key']) ? $this->slugify((string) $persona['key']) : '';
        if ($key === '') {
            $key = $this->slugify($name);
        }
        if ($key === '') {
            return null;
        }

        $slotType = isset($persona['slot_type']) ? (string) $persona['slot_type'] : '';
        if (!in_array($slotType, AGENTIC_CHAT_PERSONA_SLOT_TYPES, true)) {
            // Default new/legacy rows to the first slot type so the
            // editor can recover from a malformed import without
            // dropping the row entirely.
            $slotType = AGENTIC_CHAT_SLOT_TYPE_FOUNDATIONAL;
        }

        return [
            'key'          => $key,
            'name'         => $name,
            'slot_type'    => $slotType,
            'instructions' => isset($persona['instructions']) ? (string) $persona['instructions'] : '',
            'color'        => isset($persona['color']) ? $this->normaliseColor((string) $persona['color']) : '',
            'avatar'       => isset($persona['avatar']) ? trim((string) $persona['avatar']) : '',
            'enabled'      => isset($persona['enabled']) ? (bool) $persona['enabled'] : true,
        ];
    }

    /**
     * Convenience lookup for a persona by its key.
     *
     * @param array  $personas
     * @param string $key
     * @return array|null
     */
    public function findByKey(array $personas, $key)
    {
        if (!is_string($key) || $key === '') {
            return null;
        }
        foreach ($personas as $persona) {
            if (isset($persona['key']) && $persona['key'] === $key) {
                return $persona;
            }
        }
        return null;
    }

    /**
     * Resolve teacher slot types to persona objects.
     *
     * For each slot type in AGENTIC_CHAT_PERSONA_SLOT_TYPES:
     *   1. If the section selected an enabled persona of that slot
     *      type (in `$selectedKeys`), use it. When the section
     *      selected MORE than one persona for the same slot type the
     *      first one in selection order wins.
     *   2. Otherwise fall back to the first enabled persona of that
     *      slot type in the global library (selection order).
     *   3. When neither is found the slot stays unassigned and the
     *      backend will keep its built-in default.
     *
     * @param array<int, array<string, mixed>> $personas     Global library.
     * @param array<int, string>               $selectedKeys Section's curated persona keys.
     * @return array<string, array<string, mixed>> slot_type -> persona
     */
    public function resolveSlotPersonas(array $personas, array $selectedKeys = [])
    {
        $byKey = [];
        foreach ($personas as $persona) {
            if (isset($persona['key'])) {
                $byKey[$persona['key']] = $persona;
            }
        }

        /** @var array<string, array> $resolved */
        $resolved = [];

        // Pass 1: section overrides (in selection order, first-wins per slot).
        foreach ($selectedKeys as $key) {
            $persona = $byKey[$key] ?? null;
            if (!$persona || empty($persona['enabled'])) {
                continue;
            }
            $slotType = (string) ($persona['slot_type'] ?? '');
            if (!in_array($slotType, AGENTIC_CHAT_PERSONA_SLOT_TYPES, true)) {
                continue;
            }
            if (!isset($resolved[$slotType])) {
                $resolved[$slotType] = $persona;
            }
        }

        // Pass 2: fallback to first enabled global persona per slot type.
        foreach (AGENTIC_CHAT_PERSONA_SLOT_TYPES as $slotType) {
            if (isset($resolved[$slotType])) {
                continue;
            }
            foreach ($personas as $persona) {
                if (empty($persona['enabled'])) {
                    continue;
                }
                if (($persona['slot_type'] ?? null) === $slotType) {
                    $resolved[$slotType] = $persona;
                    break;
                }
            }
        }

        return $resolved;
    }

    /**
     * Build the backend slot -> persona key map used to:
     *   - tell the React chat which persona owns which backend slot
     *   - feed `buildConfigurePayload()`
     *
     * @param array<string, array> $slotPersonas slot_type -> persona (from resolveSlotPersonas).
     * @return array<string, string> backend_slot -> persona key
     */
    public function buildBackendSlotKeyMap(array $slotPersonas)
    {
        $map = [];
        // Mediator slot always points to the fixed mediator key so the
        // chat surface can render avatar/name even though the backend
        // does not accept a mediator prompt.
        $map[AGENTIC_CHAT_SLOT_MEDIATOR] = AGENTIC_CHAT_MEDIATOR_KEY;

        foreach (AGENTIC_CHAT_SLOT_TYPE_TO_BACKEND_SLOT as $slotType => $backendSlot) {
            if (isset($slotPersonas[$slotType]['key'])) {
                $map[$backendSlot] = (string) $slotPersonas[$slotType]['key'];
            }
        }
        return $map;
    }

    /**
     * Build the body sent to the backend's /reflect/configure endpoint.
     *
     * Backend contract (see FoResTCHAT `ReflectionConfigureRequest`):
     *   - `thread_id`                 (required, non-empty)
     *   - `module_content`            (required, non-empty)
     *   - `persona_<N>_name`          (required, non-empty) for N in 1..3
     *   - `persona_<N>_instructions`  (required string; may be empty)
     *
     * The plugin maps each authored slot type to a positional persona
     * slot (`foundational -> persona_1`, …). Slots without an assigned
     * persona fall back to the hard-coded labels in
     * `AGENTIC_CHAT_SLOT_DEFAULTS` so the backend never sees an empty
     * `persona_<N>_name` (which would 422). The mediator is not
     * configurable on the backend and is therefore never included.
     *
     * @param array<string, array> $slotPersonas  slot_type -> persona (from resolveSlotPersonas).
     * @param string               $moduleContent Module text.
     * @param string               $threadId      AG-UI thread id.
     * @return array Payload for POST /reflect/configure.
     */
    public function buildConfigurePayload(array $slotPersonas, $moduleContent, $threadId)
    {
        $module = trim((string) $moduleContent);
        if ($module === '') {
            // `module_content` is required and rejected when empty by the
            // backend schema; supply a neutral fallback so admins who
            // haven't authored a module yet still see a working chat.
            $module = 'Reflection module: discuss what you have learned.';
        }

        $payload = [
            'thread_id'      => (string) $threadId,
            'module_content' => $module,
        ];

        foreach (AGENTIC_CHAT_SLOT_TYPE_TO_BACKEND_SLOT as $slotType => $backendSlot) {
            $persona = $slotPersonas[$slotType] ?? null;
            $defaults = AGENTIC_CHAT_SLOT_DEFAULTS[$backendSlot] ?? [
                'name'         => ucfirst(str_replace('_', ' ', $backendSlot)),
                'instructions' => '',
            ];

            $name = $persona && trim((string) ($persona['name'] ?? '')) !== ''
                ? (string) $persona['name']
                : $defaults['name'];

            $instructions = $persona && trim((string) ($persona['instructions'] ?? '')) !== ''
                ? (string) $persona['instructions']
                : $defaults['instructions'];

            $payload[$backendSlot . '_name'] = $name;
            $payload[$backendSlot . '_instructions'] = $instructions;
        }

        return $payload;
    }

    /**
     * Convert a free-form name into a stable slug (snake_case, alphanumeric
     * + underscore).
     *
     * @param string $value
     * @return string
     */
    public function slugify($value)
    {
        $value = trim((string) $value);
        $value = strtolower($value);
        $value = preg_replace('/[^a-z0-9]+/', '_', $value);
        $value = trim((string) $value, '_');
        return $value;
    }

    /**
     * Normalise a CSS color hex string. Returns the canonical "#rrggbb"
     * form, or empty string when the input cannot be parsed.
     *
     * @param string $color
     * @return string
     */
    private function normaliseColor($color)
    {
        $color = trim($color);
        if ($color === '') {
            return '';
        }
        if ($color[0] !== '#') {
            $color = '#' . $color;
        }
        if (preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $color)) {
            return strtolower($color);
        }
        return '';
    }
}
