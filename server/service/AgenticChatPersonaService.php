<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persona JSON validation, normalisation, and slot-mapping helpers.
 *
 * Personas are stored globally as a JSON array on the admin config page's
 * `agentic_chat_personas` field. Every persona is an object with the
 * following shape:
 *
 *   {
 *     "key":            string,  // unique stable identifier (snake_case)
 *     "name":           string,  // display name shown in the chat UI
 *     "role":           string,  // persona-role lookup code (e.g. agentic_persona_role_teacher)
 *     "personality":    string,  // free-text personality summary (display only)
 *     "instructions":   string,  // system-prompt template (used to fill backend slots)
 *     "color":          string,  // CSS color hex (e.g. "#3366aa") - optional
 *     "avatar":         string,  // optional avatar URL or icon class
 *     "enabled":        boolean  // true = available to assign to a backend slot
 *   }
 *
 * Sections store a "persona slot map" - a JSON object keyed by backend slot
 * ("foundational_instructions", etc.) with persona keys as values. The
 * backend slots are defined in globals.php / AGENTIC_CHAT_BACKEND_SLOTS.
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
            if (isset($seenKeys[$persona['key']])) {
                // Skip duplicate keys silently - the editor surfaces the
                // duplicate-key warning before save reaches us.
                continue;
            }
            $seenKeys[$persona['key']] = true;
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
     * (missing or unusable key/name).
     *
     * @param array $persona
     * @return array|null
     */
    public function normalisePersona(array $persona)
    {
        $key = isset($persona['key']) ? $this->slugify((string) $persona['key']) : '';
        $name = isset($persona['name']) ? trim((string) $persona['name']) : '';
        if ($key === '' || $name === '') {
            return null;
        }

        return [
            'key' => $key,
            'name' => $name,
            'role' => isset($persona['role']) ? (string) $persona['role'] : AGENTIC_CHAT_PERSONA_ROLE_OTHER,
            'personality' => isset($persona['personality']) ? (string) $persona['personality'] : '',
            'instructions' => isset($persona['instructions']) ? (string) $persona['instructions'] : '',
            'color' => isset($persona['color']) ? $this->normaliseColor((string) $persona['color']) : '',
            'avatar' => isset($persona['avatar']) ? trim((string) $persona['avatar']) : '',
            'enabled' => isset($persona['enabled']) ? (bool) $persona['enabled'] : true,
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
     * Resolve a slot map ("foundational_instructions" => "persona_key") into
     * full persona objects keyed by backend slot. Unknown / disabled
     * personas are skipped.
     *
     * @param array $personas Global persona library.
     * @param array $slotMap  Slot -> persona key mapping (parsed JSON).
     * @return array<string, array> Slot -> persona object.
     */
    public function resolveSlotMap(array $personas, array $slotMap)
    {
        $resolved = [];
        foreach (AGENTIC_CHAT_BACKEND_SLOTS as $slot) {
            if (!isset($slotMap[$slot])) {
                continue;
            }
            $persona = $this->findByKey($personas, (string) $slotMap[$slot]);
            if ($persona !== null && !empty($persona['enabled'])) {
                $resolved[$slot] = $persona;
            }
        }
        return $resolved;
    }

    /**
     * Build the body sent to the backend's /reflect/configure endpoint
     * from a slot map and a module text. Personas marked for disabled
     * slots are omitted (which means the backend keeps its default).
     *
     * @param array       $personas       Global persona library.
     * @param array       $slotMap        Section's persona-slot map.
     * @param string      $moduleContent  Module text.
     * @param string      $threadId       AG-UI thread id.
     * @return array Payload for POST /reflect/configure.
     */
    public function buildConfigurePayload(array $personas, array $slotMap, $moduleContent, $threadId)
    {
        $resolved = $this->resolveSlotMap($personas, $slotMap);

        $payload = [
            'thread_id' => (string) $threadId,
            'module_content' => $moduleContent !== '' ? (string) $moduleContent : null,
        ];

        foreach ([AGENTIC_CHAT_SLOT_FOUNDATIONAL,
                  AGENTIC_CHAT_SLOT_INCLUSIVE,
                  AGENTIC_CHAT_SLOT_INQUIRY] as $slot) {
            $payload[$slot] = isset($resolved[$slot]) && $resolved[$slot]['instructions'] !== ''
                ? $resolved[$slot]['instructions']
                : null;
        }

        return $payload;
    }

    /**
     * Convert a free-form key into a stable slug (snake_case, alphanumeric
     * + underscore). Used to enforce key uniqueness regardless of user
     * casing.
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
