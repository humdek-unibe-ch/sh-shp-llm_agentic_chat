<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persona JSON validation, normalisation, and ordered resolution.
 *
 * Personas are an ORDERED, flexible library. Every persona is a JSON
 * object with the following shape:
 *
 *   {
 *     "key":         string,   // stable internal slug (auto-derived from name)
 *     "name":        string,   // display name + backend persona name
 *     "description": string,   // system-prompt sent to /reflect/configure
 *     "color":       string,   // CSS hex color used for the avatar bubble
 *     "avatar":      string,   // emoji / short label / image URL / asset path
 *     "enabled":     boolean   // exclude from selection + fallback when false
 *   }
 *
 * Notes on what is intentionally NOT here:
 *   - `slot_type` (foundational/inclusive/inquiry) — removed. The
 *     backend takes an ordered persona list, not fixed teacher slots,
 *     so personas are no longer pinned to a slot.
 *   - `role` / `personality` summary — never reintroduced; the first
 *     sentence of `description` serves as a preview in the UI.
 *   - Mediator entries — the group-chat mediator is built by the
 *     backend (toggled per section). It must not be authored as a
 *     persona variant.
 *
 * Sections choose + order a subset of personas through the
 * `agentic_chat_personas_to_use` field. `resolvePersonas()` returns
 * the ordered list actually sent to the backend; `buildParticipantMap()`
 * binds each positional backend slot (`persona_1`, `persona_2`, …) to
 * the persona key that occupies it.
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
     * (missing/unusable name).
     *
     * Accepts `description` as the canonical prompt field, falling back
     * to the legacy `instructions` key so in-progress dev data is not
     * lost on first save.
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
        // do not edit the key directly — the editor hides the field —
        // but we still honour user-supplied values for imports.
        $key = isset($persona['key']) ? $this->slugify((string) $persona['key']) : '';
        if ($key === '') {
            $key = $this->slugify($name);
        }
        if ($key === '') {
            return null;
        }

        $description = '';
        if (isset($persona['description'])) {
            $description = (string) $persona['description'];
        } elseif (isset($persona['instructions'])) {
            $description = (string) $persona['instructions'];
        }

        return [
            'key'         => $key,
            'name'        => $name,
            'description' => $description,
            'color'       => isset($persona['color']) ? $this->normaliseColor((string) $persona['color']) : '',
            'avatar'      => isset($persona['avatar']) ? trim((string) $persona['avatar']) : '',
            'enabled'     => isset($persona['enabled']) ? (bool) $persona['enabled'] : true,
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
     * Resolve the ordered list of personas a section will actually use.
     *
     *   1. If the section curated a set of persona keys
     *      (`$selectedKeys`), keep them in selection order, dropping any
     *      that are unknown, disabled, duplicated, or the reserved
     *      mediator key.
     *   2. Otherwise fall back to every enabled persona in the global
     *      library, in library order.
     *
     * The mediator key is reserved by the backend's group-chat mediator
     * agent and is never returned as a persona.
     *
     * @param array<int, array<string, mixed>> $personas     Global library (ordered).
     * @param array<int, string>               $selectedKeys Section's curated persona keys (ordered).
     * @return array<int, array<string, mixed>> Ordered persona list.
     */
    public function resolvePersonas(array $personas, array $selectedKeys = [])
    {
        $byKey = [];
        foreach ($personas as $persona) {
            if (!isset($persona['key']) || $persona['key'] === AGENTIC_CHAT_MEDIATOR_KEY) {
                continue;
            }
            $byKey[$persona['key']] = $persona;
        }

        $resolved = [];
        $seen = [];

        if (!empty($selectedKeys)) {
            foreach ($selectedKeys as $key) {
                $key = (string) $key;
                if ($key === '' || $key === AGENTIC_CHAT_MEDIATOR_KEY || isset($seen[$key])) {
                    continue;
                }
                $persona = $byKey[$key] ?? null;
                if (!$persona || empty($persona['enabled'])) {
                    continue;
                }
                $seen[$key] = true;
                $resolved[] = $persona;
            }
        } else {
            foreach ($personas as $persona) {
                $key = (string) ($persona['key'] ?? '');
                if ($key === '' || $key === AGENTIC_CHAT_MEDIATOR_KEY || isset($seen[$key])) {
                    continue;
                }
                if (empty($persona['enabled'])) {
                    continue;
                }
                $seen[$key] = true;
                $resolved[] = $persona;
            }
        }

        return $resolved;
    }

    /**
     * Build the participant map binding each backend slot to a persona
     * key, used to attribute streamed messages after a page refresh.
     *
     * Shape: `{ mediator: "mediator", persona_1: "lea", persona_2: "anja" }`.
     * The mediator entry is always included (harmless when the section
     * disables the mediator — the chat simply never resolves it).
     *
     * @param array<int, array<string, mixed>> $orderedPersonas From resolvePersonas().
     * @return array<string, string> backend_slot -> persona key
     */
    public function buildParticipantMap(array $orderedPersonas)
    {
        $map = [AGENTIC_CHAT_SLOT_MEDIATOR => AGENTIC_CHAT_MEDIATOR_KEY];
        $index = 1;
        foreach ($orderedPersonas as $persona) {
            if (!isset($persona['key'])) {
                continue;
            }
            $map[agentic_chat_persona_slot($index)] = (string) $persona['key'];
            $index++;
        }
        return $map;
    }

    /**
     * Build the body sent to the backend's /reflect/configure endpoint.
     *
     * Backend contract (see `ReflectionConfigureRequest`):
     *   {
     *     "thread_id":      string (required, non-empty),
     *     "module_content": string (required, non-empty),
     *     "personas": [ { "name": string, "description": string }, ... ] (>= 1),
     *     "use_group_chat_mediator": bool (default true)
     *   }
     *
     * When the resolved persona list is empty a neutral fallback persona
     * is emitted so the backend's `min_length: 1` constraint is met.
     *
     * @param array<int, array<string, mixed>> $orderedPersonas From resolvePersonas().
     * @param string                           $moduleContent   Module text.
     * @param string                           $threadId        AG-UI thread id.
     * @param bool                             $useMediator     Whether to enable the mediator.
     * @return array Payload for POST /reflect/configure.
     */
    public function buildConfigurePayload(array $orderedPersonas, $moduleContent, $threadId, $useMediator = true)
    {
        $module = trim((string) $moduleContent);
        if ($module === '') {
            // `module_content` is required and rejected when empty by the
            // backend schema; supply a neutral fallback so admins who
            // haven't authored a module yet still see a working chat.
            $module = 'Reflection module: discuss what you have learned.';
        }

        $personas = [];
        foreach ($orderedPersonas as $persona) {
            $name = trim((string) ($persona['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $personas[] = [
                'name'        => $name,
                'description' => (string) ($persona['description'] ?? ''),
            ];
        }

        if (empty($personas)) {
            $personas[] = [
                'name'        => (string) AGENTIC_CHAT_DEFAULT_PERSONA['name'],
                'description' => (string) AGENTIC_CHAT_DEFAULT_PERSONA['description'],
            ];
        }

        return [
            'thread_id'               => (string) $threadId,
            'module_content'          => $module,
            'personas'                => $personas,
            'use_group_chat_mediator' => (bool) $useMediator,
        ];
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
