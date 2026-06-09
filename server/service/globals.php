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
define('AGENTIC_CHAT_DEFAULT_HEALTH_PATH', '/health');
define('AGENTIC_CHAT_DEFAULT_TIMEOUT', 120);

/** Default for the section-level "use group chat mediator" toggle. */
define('AGENTIC_CHAT_DEFAULT_USE_MEDIATOR', true);

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
 * PARTICIPANT / BACKEND SLOT MAPPING
 *
 * The reflection backend builds its workflow from an ORDERED list of
 * personas plus an optional group-chat mediator:
 *
 *   POST /reflect/configure
 *   {
 *     "thread_id": "...",
 *     "module_content": "...",
 *     "personas": [ { "name": "Lea", "description": "..." }, ... ],
 *     "use_group_chat_mediator": true
 *   }
 *
 * The run-time agents are named positionally from that list:
 *   - the mediator (when enabled) is `group_chat_mediator`
 *   - the first persona is `persona_1_teacher`, the second
 *     `persona_2_teacher`, and so on (1-indexed, in configure order).
 *
 * The plugin therefore persists a "participant map" per thread that
 * binds each backend slot to the persona key that occupied it at
 * configure time, so message attribution survives a page refresh:
 *
 *   { "mediator": "mediator", "persona_1": "lea", "persona_2": "anja" }
 * ========================================================================= */

/** Backend slot id for the (optional) group-chat mediator agent. */
define('AGENTIC_CHAT_SLOT_MEDIATOR', 'mediator');

/** Prefix for positional persona slots: persona_1, persona_2, ... */
define('AGENTIC_CHAT_PERSONA_SLOT_PREFIX', 'persona_');

/**
 * Positional persona slot id for the Nth configured persona (1-indexed).
 *
 * @param int $index 1-based position in the configure `personas` list.
 * @return string e.g. "persona_1"
 */
function agentic_chat_persona_slot($index)
{
    return AGENTIC_CHAT_PERSONA_SLOT_PREFIX . max(1, (int) $index);
}

/* =========================================================================
 * FIXED MEDIATOR METADATA
 *
 * The group-chat mediator is built by the backend (it has no editable
 * prompt in /reflect/configure beyond the on/off toggle). The plugin
 * keeps display metadata (avatar, color, name) for the chat UI so
 * mediator turns render consistently. Researchers do NOT author the
 * mediator as a persona; they only toggle it on/off per section.
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
    'key'         => AGENTIC_CHAT_MEDIATOR_KEY,
    'name'        => AGENTIC_CHAT_MEDIATOR_NAME,
    'description' => '', // backend builds the mediator; not sent in configure
    'color'       => AGENTIC_CHAT_MEDIATOR_COLOR,
    'avatar'      => AGENTIC_CHAT_MEDIATOR_AVATAR,
    'enabled'     => true,
]);

/**
 * Neutral fallback persona used only when a section/library resolves to
 * an empty persona list. The backend requires `personas` to have at
 * least one entry, so this keeps /reflect/configure valid until the
 * admin authors a real persona.
 */
define('AGENTIC_CHAT_DEFAULT_PERSONA', [
    'key'         => 'teacher',
    'name'        => 'Teacher',
    'description' => 'You are a thoughtful teacher who helps the learner reflect on the module. Ask open questions and keep the tone supportive.',
    'color'       => '#0d6efd',
    'avatar'      => '',
    'enabled'     => true,
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
 *
 * These are the canonical thread-status CODES. Each value mirrors a
 * `lookups.lookup_code` row of type `agenticChatThreadStatus` (seeded in
 * v1.0.0.sql) and the `ThreadStatus` union in the React UI. The
 * `agenticChatThreads.id_status` column is a foreign key into `lookups`;
 * AgenticChatThreadService resolves these codes to the FK id on write and
 * hydrates the code back from the FK on read, so the status string is
 * identical across DB -> PHP -> React.
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
