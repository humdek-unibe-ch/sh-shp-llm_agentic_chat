<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM Agentic Chat Plugin - Lookup Constants
 *
 * Centralised lookup keys used by the plugin. Values mirror the rows
 * inserted by v1.0.0.sql into the `lookups` table.
 *
 * Note: the legacy `agenticChatPersonaRole` lookup type was removed in
 * v1.1.0. Persona role/expert/supporter/other categories no longer
 * exist because the Python backend only supports three concrete
 * teacher slots (foundational / inclusive / inquiry) plus a fixed,
 * non-configurable mediator. Slot types are now declared in
 * `globals.php` as `AGENTIC_CHAT_PERSONA_SLOT_TYPES` and are not
 * stored in the `lookups` table.
 *
 * @package LLM Agentic Chat Plugin
 */

/* type_code values still used by the plugin */
define('AGENTIC_CHAT_LOOKUP_TYPE_THREAD_STATUS', 'agenticChatThreadStatus');
?>
