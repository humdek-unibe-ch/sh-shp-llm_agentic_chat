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
 * Note: personas are an ordered, flexible list (each with a `name` +
 * `description`); there are no persona role/slot-type lookups. The
 * backend builds its workflow from the configured persona order plus
 * an optional group-chat mediator, so no persona categories are stored
 * in the `lookups` table. The only lookup type kept here is the thread
 * status enum.
 *
 * @package LLM Agentic Chat Plugin
 */

/* type_code values still used by the plugin */
define('AGENTIC_CHAT_LOOKUP_TYPE_THREAD_STATUS', 'agenticChatThreadStatus');
?>
