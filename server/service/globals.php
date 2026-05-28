<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM Agentic Chat Plugin Global Constants and Configuration
 *
 * Auto-loaded during SelfHelp plugin initialization via
 * Selfhelp::loadPluginGlobals().
 *
 * This plugin extends sh-shp-llm by adding AG-UI streaming support against an
 * external backend (e.g. FoResTCHAT). Visible message history continues to
 * use llmConversations / llmMessages from the base LLM plugin; AG-UI thread
 * state lives in this plugin's agenticChatThreads table.
 *
 * @package LLM Agentic Chat Plugin
 */

/* =========================================================================
 * PLUGIN IDENTIFICATION
 * ========================================================================= */

define('LLM_AGENTIC_CHAT_PLUGIN_NAME', 'sh-shp-llm_agentic_chat');
define('LLM_AGENTIC_CHAT_PLUGIN_DB_NAME', 'llm_agentic_chat');
define('LLM_AGENTIC_CHAT_PLUGIN_VERSION', 'v1.0.0');

/* =========================================================================
 * ADMIN PAGE ROUTING
 * ========================================================================= */

define('PAGE_LLM_AGENTIC_CHAT_CONFIG', 'sh_module_llm_agentic_chat');
define('PAGE_LLM_AGENTIC_CHAT_THREADS', 'sh_module_llm_agentic_chat_threads');
define('LLM_AGENTIC_CHAT_ADMIN_URL', '/admin/module_llm_agentic_chat');
define('LLM_AGENTIC_CHAT_THREADS_URL', '/admin/module_llm_agentic_chat/threads');

/* =========================================================================
 * BACKEND DEFAULTS (AG-UI / FoResTCHAT)
 * Live test backend used during development.
 * ========================================================================= */

define('AGENTIC_CHAT_DEFAULT_BACKEND_URL', 'https://tpf-test.humdek.unibe.ch/forestBackend');
define('AGENTIC_CHAT_DEFAULT_REFLECT_PATH', '/reflect');
define('AGENTIC_CHAT_DEFAULT_CONFIGURE_PATH', '/reflect/configure');
define('AGENTIC_CHAT_DEFAULT_DEFAULTS_PATH', '/reflect/defaults');
define('AGENTIC_CHAT_DEFAULT_HEALTH_PATH', '/health');
define('AGENTIC_CHAT_DEFAULT_TIMEOUT', 120);

/**
 * AG-UI literal user kickoff token recognised by the mediator agent.
 * Sent as the first user message when "auto-start" is enabled.
 */
define('AGENTIC_CHAT_AUTO_START_TOKEN', '__auto_start__');

/**
 * Marker that the backend writes at the end of an assistant message when the
 * case is complete. The plugin treats any TEXT_MESSAGE_END that ends with
 * this string as the conversation being finalised.
 */
define('AGENTIC_CHAT_CASE_COMPLETE_MARKER', 'Case complete.');

/* =========================================================================
 * PERSONA SLOT MAPPING
 *
 * The FoResTCHAT Python backend exposes three positional teacher
 * persona slots (persona_1 / persona_2 / persona_3) plus a fixed,
 * non-configurable mediator. For each of the three positional slots
 * /reflect/configure expects a NAME and an INSTRUCTIONS string, and
 * the run-time agents are named `persona_1_teacher`, `persona_2_teacher`,
 * `persona_3_teacher` accordingly.
 *
 * Personas are still authored as variants of three semantic slot types
 * (foundational / inclusive / inquiry) so the admin keeps an intuitive
 * authoring model. Those slot types map 1:1 onto the positional
 * backend slots:
 *
 *   foundational  ->  persona_1
 *   inclusive     ->  persona_2
 *   inquiry       ->  persona_3
 *
 * A section can pick at most one persona per slot type; when no
 * override is provided the plugin falls back to the first enabled
 * global persona for that slot type.
 * ========================================================================= */

/* Backend slot identifiers (positional; sent to /reflect/configure as
 * `<slot>_name` + `<slot>_instructions`). */
define('AGENTIC_CHAT_SLOT_MEDIATOR', 'mediator');
define('AGENTIC_CHAT_SLOT_PERSONA_1', 'persona_1');
define('AGENTIC_CHAT_SLOT_PERSONA_2', 'persona_2');
define('AGENTIC_CHAT_SLOT_PERSONA_3', 'persona_3');

/**
 * Ordered list of all backend persona slots (used for display by the
 * persona strip / chat surface). The mediator slot is included for UI
 * attribution only; it is NEVER part of the /reflect/configure body
 * because the Python backend does not accept a configurable mediator
 * prompt.
 */
define('AGENTIC_CHAT_BACKEND_SLOTS', [
    AGENTIC_CHAT_SLOT_MEDIATOR,
    AGENTIC_CHAT_SLOT_PERSONA_1,
    AGENTIC_CHAT_SLOT_PERSONA_2,
    AGENTIC_CHAT_SLOT_PERSONA_3,
]);

/* =========================================================================
 * PERSONA SLOT TYPES (admin / data model)
 *
 * The admin authors persona variants tagged with one of these slot
 * types. The plugin maps each slot type 1:1 onto a positional backend
 * slot (see AGENTIC_CHAT_SLOT_TYPE_TO_BACKEND_SLOT below). Anything
 * not in this list (e.g. legacy roles like "expert", "other") is
 * rejected by the persona normaliser.
 * ========================================================================= */

define('AGENTIC_CHAT_SLOT_TYPE_FOUNDATIONAL', 'foundational');
define('AGENTIC_CHAT_SLOT_TYPE_INCLUSIVE', 'inclusive');
define('AGENTIC_CHAT_SLOT_TYPE_INQUIRY', 'inquiry');

/** All allowed slot types for persona variants. */
define('AGENTIC_CHAT_PERSONA_SLOT_TYPES', [
    AGENTIC_CHAT_SLOT_TYPE_FOUNDATIONAL,
    AGENTIC_CHAT_SLOT_TYPE_INCLUSIVE,
    AGENTIC_CHAT_SLOT_TYPE_INQUIRY,
]);

/**
 * Slot type -> positional backend slot translation.
 *
 * Keep this mapping in lock-step with the React `SLOT_TYPE_OPTIONS`
 * AND with the executor-id table in `AgenticChatEventNormalizer`
 * (which resolves `persona_<N>_teacher` -> the matching slot key).
 */
define('AGENTIC_CHAT_SLOT_TYPE_TO_BACKEND_SLOT', [
    AGENTIC_CHAT_SLOT_TYPE_FOUNDATIONAL => AGENTIC_CHAT_SLOT_PERSONA_1,
    AGENTIC_CHAT_SLOT_TYPE_INCLUSIVE    => AGENTIC_CHAT_SLOT_PERSONA_2,
    AGENTIC_CHAT_SLOT_TYPE_INQUIRY      => AGENTIC_CHAT_SLOT_PERSONA_3,
]);

/**
 * Hard-coded fallback labels and prompts used when a positional slot
 * has no persona assigned (the backend's `/reflect/configure` rejects
 * empty names because `persona_<N>_name` has `minLength: 1`).
 *
 * Indexed by positional backend slot key. The plugin emits these
 * defaults so a partially-configured library still produces a valid
 * configure payload; the resulting teacher will simply behave like a
 * generic placeholder until the admin authors a real persona for the
 * matching slot type.
 */
define('AGENTIC_CHAT_SLOT_DEFAULTS', [
    AGENTIC_CHAT_SLOT_PERSONA_1 => [
        'name'         => 'Teacher 1',
        'instructions' => 'You are a foundational-knowledge primary-school teacher.',
    ],
    AGENTIC_CHAT_SLOT_PERSONA_2 => [
        'name'         => 'Teacher 2',
        'instructions' => 'You are an inclusive-pedagogy primary-school teacher.',
    ],
    AGENTIC_CHAT_SLOT_PERSONA_3 => [
        'name'         => 'Teacher 3',
        'instructions' => 'You are an inquiry-based primary-school teacher.',
    ],
]);

/* =========================================================================
 * FIXED MEDIATOR METADATA
 *
 * The mediator persona is hard-coded in the Python backend and cannot
 * be customised through /reflect/configure. The plugin still needs
 * display metadata (avatar, color, name) for the chat UI when the
 * mediator speaks. Researchers do NOT see this in the admin editor.
 * ========================================================================= */

define('AGENTIC_CHAT_MEDIATOR_KEY', 'mediator');
define('AGENTIC_CHAT_MEDIATOR_NAME', 'Mediator');
define('AGENTIC_CHAT_MEDIATOR_AVATAR', '/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg');
define('AGENTIC_CHAT_MEDIATOR_COLOR', '#495057');

/**
 * Read-only persona descriptor for the mediator. Exposed to the React
 * chat through the `mediator` field of the section config so the
 * persona strip, message bubbles and avatars render consistently
 * without a database row.
 */
define('AGENTIC_CHAT_MEDIATOR_PERSONA', [
    'key'          => AGENTIC_CHAT_MEDIATOR_KEY,
    'name'         => AGENTIC_CHAT_MEDIATOR_NAME,
    'slot_type'    => null, // mediator is not a backend slot type
    'instructions' => '',   // not sent to the backend
    'color'        => AGENTIC_CHAT_MEDIATOR_COLOR,
    'avatar'       => AGENTIC_CHAT_MEDIATOR_AVATAR,
    'enabled'      => true,
]);

/* =========================================================================
 * AG-UI EVENT TYPE NAMES (subset used by the plugin)
 * ========================================================================= */

define('AGENTIC_CHAT_EVT_RUN_STARTED', 'RUN_STARTED');
define('AGENTIC_CHAT_EVT_RUN_FINISHED', 'RUN_FINISHED');
define('AGENTIC_CHAT_EVT_RUN_ERROR', 'RUN_ERROR');
define('AGENTIC_CHAT_EVT_TEXT_MESSAGE_START', 'TEXT_MESSAGE_START');
define('AGENTIC_CHAT_EVT_TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CONTENT');
define('AGENTIC_CHAT_EVT_TEXT_MESSAGE_END', 'TEXT_MESSAGE_END');
define('AGENTIC_CHAT_EVT_TEXT_MESSAGE_CHUNK', 'TEXT_MESSAGE_CHUNK');
define('AGENTIC_CHAT_EVT_TOOL_CALL_START', 'TOOL_CALL_START');
define('AGENTIC_CHAT_EVT_TOOL_CALL_ARGS', 'TOOL_CALL_ARGS');
define('AGENTIC_CHAT_EVT_TOOL_CALL_END', 'TOOL_CALL_END');
define('AGENTIC_CHAT_EVT_TOOL_CALL_RESULT', 'TOOL_CALL_RESULT');
define('AGENTIC_CHAT_EVT_MESSAGES_SNAPSHOT', 'MESSAGES_SNAPSHOT');
define('AGENTIC_CHAT_EVT_STEP_STARTED', 'STEP_STARTED');
define('AGENTIC_CHAT_EVT_STEP_FINISHED', 'STEP_FINISHED');
define('AGENTIC_CHAT_EVT_CUSTOM', 'CUSTOM');

/* =========================================================================
 * THREAD STATUS VALUES
 * ========================================================================= */

define('AGENTIC_CHAT_STATUS_IDLE', 'idle');
define('AGENTIC_CHAT_STATUS_CONFIGURING', 'configuring');
define('AGENTIC_CHAT_STATUS_RUNNING', 'running');
define('AGENTIC_CHAT_STATUS_AWAITING_INPUT', 'awaiting_input');
define('AGENTIC_CHAT_STATUS_COMPLETED', 'completed');
define('AGENTIC_CHAT_STATUS_FAILED', 'failed');

/* =========================================================================
 * TRANSACTION LOGGING
 * ========================================================================= */

define('TRANSACTION_BY_LLM_AGENTIC_CHAT', 'by_llm_agentic_chat');

/* =========================================================================
 * MISC LIMITS
 * ========================================================================= */

/** Maximum personas a single configuration is allowed to define. */
define('AGENTIC_CHAT_MAX_PERSONAS', 32);

/** Maximum bytes of debug events kept per thread (defensive cap). */
define('AGENTIC_CHAT_MAX_DEBUG_EVENTS_BYTES', 256 * 1024);

/* =========================================================================
 * Load lookup constants (kept in a separate file to mirror the LLM plugin
 * convention).
 * ========================================================================= */

require_once __DIR__ . '/../constants/AgenticChatLookups.php';
?>
