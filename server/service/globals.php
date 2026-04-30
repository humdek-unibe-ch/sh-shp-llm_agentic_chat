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
define('LLM_AGENTIC_CHAT_ADMIN_URL', '/admin/module_llm_agentic_chat');

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
 * The current backend supports exactly three persona instruction slots
 * (foundational / inclusive / inquiry) plus the mediator. The plugin
 * stores personas globally as an array keyed by persona key, and maps a
 * subset of them onto these slots when configuring a thread.
 * ========================================================================= */

define('AGENTIC_CHAT_SLOT_MEDIATOR', 'mediator');
define('AGENTIC_CHAT_SLOT_FOUNDATIONAL', 'foundational_instructions');
define('AGENTIC_CHAT_SLOT_INCLUSIVE', 'inclusive_instructions');
define('AGENTIC_CHAT_SLOT_INQUIRY', 'inquiry_instructions');

/**
 * Ordered list of supported backend persona slots. Used by the config UI
 * to render the slot-mapping dropdowns.
 */
define('AGENTIC_CHAT_BACKEND_SLOTS', [
    AGENTIC_CHAT_SLOT_MEDIATOR,
    AGENTIC_CHAT_SLOT_FOUNDATIONAL,
    AGENTIC_CHAT_SLOT_INCLUSIVE,
    AGENTIC_CHAT_SLOT_INQUIRY,
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
