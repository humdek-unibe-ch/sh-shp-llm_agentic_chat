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
 * @package LLM Agentic Chat Plugin
 */

/* type_code values */
define('AGENTIC_CHAT_LOOKUP_TYPE_PERSONA_ROLE', 'agenticChatPersonaRole');
define('AGENTIC_CHAT_LOOKUP_TYPE_THREAD_STATUS', 'agenticChatThreadStatus');

/* lookup_code values for persona role (informational; used by the editor UI) */
define('AGENTIC_CHAT_PERSONA_ROLE_MEDIATOR', 'agentic_persona_role_mediator');
define('AGENTIC_CHAT_PERSONA_ROLE_TEACHER', 'agentic_persona_role_teacher');
define('AGENTIC_CHAT_PERSONA_ROLE_EXPERT', 'agentic_persona_role_expert');
define('AGENTIC_CHAT_PERSONA_ROLE_SUPPORTER', 'agentic_persona_role_supporter');
define('AGENTIC_CHAT_PERSONA_ROLE_OTHER', 'agentic_persona_role_other');
?>
