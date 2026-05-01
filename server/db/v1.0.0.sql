-- =============================================================================
-- LLM Agentic Chat Plugin - Initial migration
--
-- Plugin: sh-shp-llm_agentic_chat (DB key: llm_agentic_chat)
-- Depends on: sh-shp-llm (provides llmConversations / llmMessages)
--
-- This migration:
--   1. Registers the plugin in the `plugins` table.
--   2. Creates a new pageType (sh_module_llm_agentic_chat) and admin page
--      (/admin/module_llm_agentic_chat) for global plugin configuration.
--   3. Adds CMS field types and fields for backend URL, endpoint paths,
--      timeout, default module content, and the global persona library.
--   4. Adds the `agenticChat` CMS style with its section-level fields,
--      including a curated multi-select picker (custom field type
--      `agentic-chat-personas-select`, field
--      `agentic_chat_personas_to_use`) and the speech-to-text fields
--      `enable_speech_to_text` / `speech_to_text_model` reused from
--      `sh-shp-llm`.
--   5. Creates the `agenticChatThreads` table linking llmConversations
--      to AG-UI thread metadata.
--   6. Registers transaction logging and persona-role lookups.
--   7. Registers hooks for the personas-editor field, the admin panel,
--      and the section-level personas multi-select picker.
-- =============================================================================

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1) Plugin registration
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `plugins` (`name`, `version`)
VALUES ('llm_agentic_chat', 'v1.0.0');


-- -----------------------------------------------------------------------------
-- 2) Admin page types & pages
--
-- Two pages live under the admin section:
--   - sh_module_llm_agentic_chat          -> Configuration (settings + personas)
--   - sh_module_llm_agentic_chat_threads  -> Threads / debug viewer
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `pageType` (`name`) VALUES ('sh_module_llm_agentic_chat');
INSERT IGNORE INTO `pageType` (`name`) VALUES ('sh_module_llm_agentic_chat_threads');


-- -- New field type for the persona array editor (renders the React editor).
INSERT IGNORE INTO `fieldType` (`id`, `name`, `position`)
VALUES (NULL, 'agentic-chat-personas', '120');


-- -- Plugin-level configuration fields (internal, not translatable).
INSERT IGNORE INTO `fields` (`id`, `name`, `id_type`, `display`) VALUES
(NULL, 'agentic_chat_backend_url',          get_field_type_id('text'),     '0'),
(NULL, 'agentic_chat_reflect_path',         get_field_type_id('text'),     '0'),
(NULL, 'agentic_chat_configure_path',       get_field_type_id('text'),     '0'),
(NULL, 'agentic_chat_defaults_path',        get_field_type_id('text'),     '0'),
(NULL, 'agentic_chat_health_path',          get_field_type_id('text'),     '0'),
(NULL, 'agentic_chat_timeout',              get_field_type_id('number'),   '0'),
(NULL, 'agentic_chat_default_module',       get_field_type_id('textarea'), '0'),
(NULL, 'agentic_chat_personas',             get_field_type_id('agentic-chat-personas'), '0'),
(NULL, 'agentic_chat_panel',                get_field_type_id('panel'),    '0');


-- -- Link plugin config fields to the page type.
INSERT IGNORE INTO `pageType_fields` (`id_pageType`, `id_fields`, `default_value`, `help`) VALUES
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('title'), 'LLM Agentic Chat', 'Page title'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_backend_url'), 'https://tpf-test.humdek.unibe.ch/forestBackend', 'Base URL of the AG-UI backend (no trailing slash). Example: https://tpf-test.humdek.unibe.ch/forestBackend'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_reflect_path'), '/reflect', 'AG-UI run endpoint path (POST, returns text/event-stream).'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_configure_path'), '/reflect/configure', 'Per-thread configuration endpoint path (POST).'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_defaults_path'), '/reflect/defaults', 'Endpoint that returns default module text and persona instruction templates (GET).'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_health_path'), '/health', 'Liveness probe endpoint (GET, no LLM cost).'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_timeout'), '120', 'Default request timeout in seconds for backend calls.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_default_module'), '', 'Default module / reflection text injected into every new AG-UI thread when the section does not provide its own.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_personas'), '[{"key":"mediator","name":"Mediator","role":"agentic_persona_role_mediator","personality":"Orchestrates the reflection flow and hands off to specialist voices.","instructions":"You mediate the reflection conversation. Use the module content to keep the discussion focused and hand off to specialist personas when helpful.","color":"#495057","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg","enabled":true},{"key":"foundational_teacher","name":"Foundational Teacher","role":"agentic_persona_role_teacher","personality":"Clear, structured and grounding.","instructions":"You are the foundational teacher persona. Explain core ideas clearly and connect them to the module content: {module_content}","color":"#0d6efd","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/foundational-teacher.svg","enabled":true},{"key":"inclusive_teacher","name":"Inclusive Teacher","role":"agentic_persona_role_teacher","personality":"Warm, accessible and attentive to different learner needs.","instructions":"You are the inclusive teacher persona. Adapt the reflection to diverse perspectives and keep the tone supportive. Module content: {module_content}","color":"#198754","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inclusive-teacher.svg","enabled":true},{"key":"inquiry_teacher","name":"Inquiry Teacher","role":"agentic_persona_role_teacher","personality":"Curious, probing and question-led.","instructions":"You are the inquiry teacher persona. Ask thoughtful questions that help the learner examine assumptions and evidence. Module content: {module_content}","color":"#6f42c1","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inquiry-teacher.svg","enabled":true}]', 'Global persona library, stored as a JSON array. Each persona has: key, name, role, instructions, color, avatar asset path, enabled.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_panel'), NULL, 'Quick-link panel rendered above the form on the admin page.');


-- -- Insert the admin page itself.
--
-- Notes on action / nav_position:
--   * id_actions = 'component' makes SelfHelp instantiate the matching
--     Sh_module_llm_agentic_chatComponent class via ComponentPage and serve
--     the URL `/admin/module_llm_agentic_chat` directly. Using 'backend'
--     here would cause NavView.php to fall back to /admin/cms/<id>, which
--     is the CMS section editor — that's the bug we fixed.
--   * nav_position = 220 makes the entry appear in the admin "Modules"
--     dropdown next to the LLM plugin (which uses 200). The companion
--     Threads page below intentionally has nav_position = NULL: it is a
--     sub-page reachable only through the sidebar inside the shared
--     AgenticChatAdminLayoutHelper layout.
SET @id_page_modules_agentic = (SELECT id FROM pages WHERE keyword = 'sh_modules');

INSERT IGNORE INTO `pages` (`id`, `keyword`, `url`, `protocol`, `id_actions`, `id_navigation_section`, `parent`, `is_headless`, `nav_position`, `footer_position`, `id_type`, `id_pageAccessTypes`)
VALUES (
    NULL,
    'sh_module_llm_agentic_chat',
    '/admin/module_llm_agentic_chat',
    'GET|POST',
    (SELECT id FROM actions WHERE `name` = 'component' LIMIT 1),
    NULL,
    @id_page_modules_agentic,
    0,
    220,
    NULL,
    (SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat' LIMIT 1),
    (SELECT id FROM lookups WHERE type_code = 'pageAccessTypes' AND lookup_code = 'mobile_and_web')
);

SET @id_page_agentic_config = (SELECT id FROM pages WHERE keyword = 'sh_module_llm_agentic_chat');


-- -- Per-page default values (so the admin can override before saving).
INSERT IGNORE INTO `pages_fields` (`id_pages`, `id_fields`, `default_value`, `help`) VALUES
(@id_page_agentic_config, get_field_id('agentic_chat_backend_url'),    'https://tpf-test.humdek.unibe.ch/forestBackend', 'Base URL of the AG-UI backend (no trailing slash).'),
(@id_page_agentic_config, get_field_id('agentic_chat_reflect_path'),   '/reflect',           'AG-UI run endpoint path.'),
(@id_page_agentic_config, get_field_id('agentic_chat_configure_path'), '/reflect/configure', 'Per-thread configuration endpoint path.'),
(@id_page_agentic_config, get_field_id('agentic_chat_defaults_path'),  '/reflect/defaults',  'Defaults endpoint path.'),
(@id_page_agentic_config, get_field_id('agentic_chat_health_path'),    '/health',            'Liveness probe endpoint.'),
(@id_page_agentic_config, get_field_id('agentic_chat_timeout'),        '120',                'Backend request timeout (seconds).'),
(@id_page_agentic_config, get_field_id('agentic_chat_default_module'), '',                   'Default module text injected into new threads.'),
(@id_page_agentic_config, get_field_id('agentic_chat_personas'),       '[{"key":"mediator","name":"Mediator","role":"agentic_persona_role_mediator","personality":"Orchestrates the reflection flow and hands off to specialist voices.","instructions":"You mediate the reflection conversation. Use the module content to keep the discussion focused and hand off to specialist personas when helpful.","color":"#495057","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg","enabled":true},{"key":"foundational_teacher","name":"Foundational Teacher","role":"agentic_persona_role_teacher","personality":"Clear, structured and grounding.","instructions":"You are the foundational teacher persona. Explain core ideas clearly and connect them to the module content: {module_content}","color":"#0d6efd","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/foundational-teacher.svg","enabled":true},{"key":"inclusive_teacher","name":"Inclusive Teacher","role":"agentic_persona_role_teacher","personality":"Warm, accessible and attentive to different learner needs.","instructions":"You are the inclusive teacher persona. Adapt the reflection to diverse perspectives and keep the tone supportive. Module content: {module_content}","color":"#198754","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inclusive-teacher.svg","enabled":true},{"key":"inquiry_teacher","name":"Inquiry Teacher","role":"agentic_persona_role_teacher","personality":"Curious, probing and question-led.","instructions":"You are the inquiry teacher persona. Ask thoughtful questions that help the learner examine assumptions and evidence. Module content: {module_content}","color":"#6f42c1","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inquiry-teacher.svg","enabled":true}]', 'Global persona library (JSON array).'),
(@id_page_agentic_config, get_field_id('agentic_chat_panel'),          NULL,                 'Quick-link panel.');


-- -- Page title translations.
INSERT IGNORE INTO `pages_fields_translation` (`id_pages`, `id_fields`, `id_languages`, `content`) VALUES
(@id_page_agentic_config, get_field_id('title'), '0000000003', 'LLM Agentic Chat'),
(@id_page_agentic_config, get_field_id('title'), '0000000002', 'LLM Agentic Chat');


-- -- Initial pages_fields_translation rows for language 1 (the canonical
-- -- "internal" language that the admin model reads via get_page_fields).
-- --
-- -- Without these rows, get_page_fields() returns empty strings for all
-- -- agentic_chat_* fields (it only consults pages_fields_translation, never
-- -- the default_value of pages_fields). That made the admin controller call
-- -- the backend client with an empty base URL, which cURL rejects with
-- -- "URL rejected: Malformed input to a URL function". Mirrors how
-- -- sh-shp-llm seeds its own llm_base_url / llm_default_model translations.
INSERT IGNORE INTO `pages_fields_translation` (`id_pages`, `id_fields`, `id_languages`, `content`) VALUES
(@id_page_agentic_config, get_field_id('agentic_chat_backend_url'),    '0000000001', 'https://tpf-test.humdek.unibe.ch/forestBackend'),
(@id_page_agentic_config, get_field_id('agentic_chat_reflect_path'),   '0000000001', '/reflect'),
(@id_page_agentic_config, get_field_id('agentic_chat_configure_path'), '0000000001', '/reflect/configure'),
(@id_page_agentic_config, get_field_id('agentic_chat_defaults_path'),  '0000000001', '/reflect/defaults'),
(@id_page_agentic_config, get_field_id('agentic_chat_health_path'),    '0000000001', '/health'),
(@id_page_agentic_config, get_field_id('agentic_chat_timeout'),        '0000000001', '120'),
(@id_page_agentic_config, get_field_id('agentic_chat_default_module'), '0000000001', ''),
(@id_page_agentic_config, get_field_id('agentic_chat_personas'),       '0000000001', '[{"key":"mediator","name":"Mediator","role":"agentic_persona_role_mediator","personality":"Orchestrates the reflection flow and hands off to specialist voices.","instructions":"You mediate the reflection conversation. Use the module content to keep the discussion focused and hand off to specialist personas when helpful.","color":"#495057","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg","enabled":true},{"key":"foundational_teacher","name":"Foundational Teacher","role":"agentic_persona_role_teacher","personality":"Clear, structured and grounding.","instructions":"You are the foundational teacher persona. Explain core ideas clearly and connect them to the module content: {module_content}","color":"#0d6efd","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/foundational-teacher.svg","enabled":true},{"key":"inclusive_teacher","name":"Inclusive Teacher","role":"agentic_persona_role_teacher","personality":"Warm, accessible and attentive to different learner needs.","instructions":"You are the inclusive teacher persona. Adapt the reflection to diverse perspectives and keep the tone supportive. Module content: {module_content}","color":"#198754","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inclusive-teacher.svg","enabled":true},{"key":"inquiry_teacher","name":"Inquiry Teacher","role":"agentic_persona_role_teacher","personality":"Curious, probing and question-led.","instructions":"You are the inquiry teacher persona. Ask thoughtful questions that help the learner examine assumptions and evidence. Module content: {module_content}","color":"#6f42c1","avatar":"/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/inquiry-teacher.svg","enabled":true}]');


-- -- Admin permissions.
INSERT IGNORE INTO `acl_groups` (`id_groups`, `id_pages`, `acl_select`, `acl_insert`, `acl_update`, `acl_delete`)
VALUES ((SELECT id FROM `groups` WHERE `name` = 'admin'), @id_page_agentic_config, '1', '0', '1', '0');


-- -- Threads / debug viewer admin page.
--
-- This is a sub-page of the agentic chat module: it is reachable through
-- the sidebar built by AgenticChatAdminLayoutHelper. It uses the same
-- 'component' action so the URL stays clean (/admin/module_llm_agentic_chat/threads)
-- and ComponentPage loads Sh_module_llm_agentic_chat_threadsComponent.
-- nav_position is intentionally NULL so it does NOT show up as a separate
-- entry in the top admin "Modules" dropdown (we only want one entry per
-- plugin there, just like sh-shp-llm does for moduleLlmAdminConsole).
--
-- IMPORTANT: at least one row must be linked into `pageType_fields` for
-- this pageType BEFORE inserting the page row, otherwise the
-- get_page_fields_helper() function returns NULL (it joins pageType_fields
-- to fields and aggregates with GROUP_CONCAT). The get_page_fields
-- procedure then short-circuits to `SELECT * FROM pages WHERE 1=2`,
-- BasePage::fetch_page_info() receives an empty result, id_page falls
-- back to 0, the ACL check is performed against page id 0 and fails — so
-- the user sees a "Kein Zugriff" / no-access page even though the
-- acl_groups row is correct. Linking `title` (the standard CMS page
-- title field) is the minimum needed for the procedure to emit valid
-- SQL; it also lets admins translate the page title via the CMS UI.
INSERT IGNORE INTO `pageType_fields` (`id_pageType`, `id_fields`, `default_value`, `help`) VALUES
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat_threads'), get_field_id('title'), 'Agentic Threads', 'Page title shown in the admin sidebar.');

INSERT IGNORE INTO `pages` (`id`, `keyword`, `url`, `protocol`, `id_actions`, `id_navigation_section`, `parent`, `is_headless`, `nav_position`, `footer_position`, `id_type`, `id_pageAccessTypes`)
VALUES (
    NULL,
    'sh_module_llm_agentic_chat_threads',
    '/admin/module_llm_agentic_chat/threads',
    'GET|POST',
    (SELECT id FROM actions WHERE `name` = 'component' LIMIT 1),
    NULL,
    @id_page_modules_agentic,
    0,
    NULL,
    NULL,
    (SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat_threads' LIMIT 1),
    (SELECT id FROM lookups WHERE type_code = 'pageAccessTypes' AND lookup_code = 'mobile_and_web')
);

SET @id_page_agentic_threads = (SELECT id FROM pages WHERE keyword = 'sh_module_llm_agentic_chat_threads');

INSERT IGNORE INTO `pages_fields_translation` (`id_pages`, `id_fields`, `id_languages`, `content`) VALUES
(@id_page_agentic_threads, get_field_id('title'), '0000000001', 'Agentic Threads'),
(@id_page_agentic_threads, get_field_id('title'), '0000000003', 'Agentic Threads'),
(@id_page_agentic_threads, get_field_id('title'), '0000000002', 'Agentic Threads');

INSERT IGNORE INTO `acl_groups` (`id_groups`, `id_pages`, `acl_select`, `acl_insert`, `acl_update`, `acl_delete`)
VALUES ((SELECT id FROM `groups` WHERE `name` = 'admin'), @id_page_agentic_threads, '1', '0', '0', '0');
-- -----------------------------------------------------------------------------
-- 3) CMS style: agenticChat
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `styles` (`name`, `id_type`, `id_group`, `description`)
VALUES (
    'agenticChat',
    (SELECT id FROM styleType WHERE `name` = 'component'),
    (SELECT id FROM styleGroup WHERE `name` = 'Form'),
    'Agentic Chat: streams an AG-UI multi-persona conversation from an external backend (provided by sh-shp-llm_agentic_chat).'
);


-- -- Custom field type for the section-level "personas to use" multi-select.
-- -- Rendered by the CMS hook `field-agentic-chat-personas-select-edit/view`
-- -- (handler: AgenticChatHooks::outputFieldPersonasSelectEdit/View).
INSERT IGNORE INTO `fieldType` (`id`, `name`, `position`)
VALUES (NULL, 'agentic-chat-personas-select', '121');

-- -- Style-specific fields.
-- -- Internal (display=0): runtime / behaviour configuration.
INSERT IGNORE INTO `fields` (`id`, `name`, `id_type`, `display`) VALUES
(NULL, 'agentic_chat_personas_to_use',   get_field_type_id('agentic-chat-personas-select'), '0'),
(NULL, 'agentic_chat_auto_start',        get_field_type_id('checkbox'), '0'),
(NULL, 'agentic_chat_show_persona_strip', get_field_type_id('checkbox'), '0'),
(NULL, 'agentic_chat_show_run_status',    get_field_type_id('checkbox'), '0');

-- -- External (display=1): translatable user-visible labels.
INSERT IGNORE INTO `fields` (`id`, `name`, `id_type`, `display`) VALUES
(NULL, 'agentic_chat_title',                  get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_description',            get_field_type_id('markdown-inline'), '1'),
(NULL, 'agentic_chat_message_placeholder',    get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_send_label',             get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_start_label',            get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_reset_label',            get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_completion_message',     get_field_type_id('markdown'), '1'),
(NULL, 'agentic_chat_loading_text',           get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_status_idle_label',      get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_status_running_label',   get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_status_complete_label',  get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_status_error_label',     get_field_type_id('text'),     '1');

-- -- Link fields to the agenticChat style.
INSERT IGNORE INTO `styles_fields` (`id_styles`, `id_fields`, `default_value`, `help`) VALUES
(get_style_id('agenticChat'), get_field_id('css'),         NULL, 'Allows to assign CSS classes to the root item of the style.'),
(get_style_id('agenticChat'), get_field_id('css_mobile'),  NULL, 'Allows to assign CSS classes to the root item of the style for the mobile version.'),
(get_style_id('agenticChat'), get_field_id('condition'),   NULL, 'The field `condition` allows to specify a condition. The value is JSON.'),
(get_style_id('agenticChat'), get_field_id('debug'),       '0',  'Enable to display debug information for this style, including the AG-UI event panel.'),
(get_style_id('agenticChat'), get_field_id('data_config'), '',   'The field `dataConfig` allows to configure data sources for the component.'),

-- internal
(get_style_id('agenticChat'), get_field_id('agentic_chat_personas_to_use'), 'mediator,foundational_teacher,inclusive_teacher,inquiry_teacher', 'Pick which personas (defined in the global LLM Agentic Chat configuration page) take part in this section''s chat. The plugin maps each selected persona to a backend slot automatically using its role. Leave empty to use every enabled persona from the global library.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_auto_start'),       '1',   'When enabled, the chat sends the kickoff token __auto_start__ as soon as the user opens the section.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_persona_strip'), '1', 'Show the strip with active/visited persona avatars above the messages.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_run_status'),    '1', 'Show the small run-status badge in the chat header.'),

-- internal: speech-to-text (fields registered by sh-shp-llm; we just link them
-- and ship sensible defaults so the microphone button works out of the box).
(get_style_id('agenticChat'), get_field_id('enable_speech_to_text'), '0', 'Enable speech-to-text input for this agentic chat. When enabled and an audio model is selected, a microphone button appears in the message input area. Audio is uploaded to the configured Whisper model and the transcribed text is appended to the textarea.'),
(get_style_id('agenticChat'), get_field_id('speech_to_text_model'),  'faster-whisper-large-v3', 'Whisper model used for speech recognition. The microphone button only appears when speech-to-text is enabled above AND a model is selected.'),

-- external (translatable)
(get_style_id('agenticChat'), get_field_id('agentic_chat_title'),                  'Reflection chat',          'Heading shown above the chat.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_description'),            '',                          'Optional markdown description rendered between the heading and the chat.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_message_placeholder'),    'Type your reply…',         'Placeholder of the message input.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_send_label'),             'Send',                     'Label of the send button.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_start_label'),            'Start conversation',       'Label of the explicit start button (used when auto-start is disabled).'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_reset_label'),            'Start a new thread',       'Label of the reset / new-thread button.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_completion_message'),     'This reflection thread is complete. Click "Start a new thread" to begin another.', 'Markdown shown when the backend marks the case as complete.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_loading_text'),           'Connecting to backend…',  'Status message shown while the SSE stream is being established.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_status_idle_label'),      'Ready',                    'Run status: idle.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_status_running_label'),   'Thinking…',                'Run status: running.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_status_complete_label'),  'Case complete',            'Run status: completed.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_status_error_label'),     'Error',                    'Run status: error.');


-- -----------------------------------------------------------------------------
-- 4) agenticChatThreads table
--
-- Maps local llmConversations.id rows to AG-UI thread/run metadata. We keep
-- visible message text in llmMessages (from sh-shp-llm); this table stores
-- AG-UI-specific data only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agenticChatThreads` (
    `id`                       INT(10) UNSIGNED ZEROFILL NOT NULL AUTO_INCREMENT,
    `id_llmConversations`      INT(10) UNSIGNED ZEROFILL NOT NULL,
    `id_users`                 INT(10) UNSIGNED ZEROFILL NOT NULL,
    `id_sections`              INT(10) UNSIGNED ZEROFILL DEFAULT NULL,
    `agui_thread_id`           VARCHAR(64) NOT NULL,
    `last_run_id`              VARCHAR(64) DEFAULT NULL,
    `backend_url`              VARCHAR(512) NOT NULL,
    `persona_slot_map`         LONGTEXT DEFAULT NULL COMMENT 'JSON: backend slot -> persona key',
    `module_content`           LONGTEXT DEFAULT NULL COMMENT 'Module/reflection text sent to /reflect/configure',
    `pending_interrupts`       LONGTEXT DEFAULT NULL COMMENT 'JSON array of AG-UI interrupts awaiting user input',
    `status`                   VARCHAR(32) NOT NULL DEFAULT 'idle' COMMENT 'idle, configuring, running, awaiting_input, completed, failed',
    `is_completed`             TINYINT(1) NOT NULL DEFAULT 0,
    `last_error`               TEXT DEFAULT NULL,
    `usage_total_tokens`       INT DEFAULT NULL,
    `usage_input_tokens`       INT DEFAULT NULL,
    `usage_output_tokens`      INT DEFAULT NULL,
    `debug_meta`               LONGTEXT DEFAULT NULL COMMENT 'JSON: optional bag of debug events / counts',
    `created_at`               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_conversation` (`id_llmConversations`),
    KEY `idx_user` (`id_users`),
    KEY `idx_section` (`id_sections`),
    KEY `idx_status` (`status`),
    KEY `idx_completed` (`is_completed`),
    KEY `idx_thread` (`agui_thread_id`),
    CONSTRAINT `fk_agenticChatThreads_users`
        FOREIGN KEY (`id_users`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_agenticChatThreads_sections`
        FOREIGN KEY (`id_sections`) REFERENCES `sections` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_agenticChatThreads_llmConversations`
        FOREIGN KEY (`id_llmConversations`) REFERENCES `llmConversations` (`id`) ON DELETE CASCADE
);


-- -----------------------------------------------------------------------------
-- 5) Lookups (transaction-by + persona role types)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `lookups` (`type_code`, `lookup_code`, `lookup_value`, `lookup_description`)
VALUES
('transactionBy', 'by_llm_agentic_chat', 'By LLM Agentic Chat Plugin', 'Actions performed by the LLM Agentic Chat plugin'),

-- persona-role categories used by the editor UI dropdown
('agenticChatPersonaRole', 'agentic_persona_role_mediator',  'Mediator',  'Group chat mediator (orchestrates handoffs).'),
('agenticChatPersonaRole', 'agentic_persona_role_teacher',   'Teacher',   'Teacher / instructor persona.'),
('agenticChatPersonaRole', 'agentic_persona_role_expert',    'Expert',    'Domain expert persona.'),
('agenticChatPersonaRole', 'agentic_persona_role_supporter', 'Supporter', 'Supporting / coaching persona.'),
('agenticChatPersonaRole', 'agentic_persona_role_other',     'Other',     'Persona that does not fit the other categories.'),

-- thread status enum values used by the controller and the React UI
('agenticChatThreadStatus', 'agentic_status_idle',            'Idle',            'Thread is created but no run is in progress.'),
('agenticChatThreadStatus', 'agentic_status_configuring',     'Configuring',     'POST /reflect/configure is in flight.'),
('agenticChatThreadStatus', 'agentic_status_running',         'Running',         'Run in progress; SSE stream is open.'),
('agenticChatThreadStatus', 'agentic_status_awaiting_input',  'Awaiting input',  'Run paused on a HITL interrupt.'),
('agenticChatThreadStatus', 'agentic_status_completed',       'Completed',       'Backend signalled "Case complete." for this thread.'),
('agenticChatThreadStatus', 'agentic_status_failed',          'Failed',          'Run errored or backend connection failed.');


-- -----------------------------------------------------------------------------
-- 6) Hooks
--
--   - field-agentic_chat_personas-edit / -view
--       Render the React-powered persona editor instead of a JSON textarea
--       (used on the global admin page, NOT on sections).
--   - field-agentic_chat_panel-edit / -view
--       Render the admin quick-links panel.
--   - field-agentic-chat-personas-select-edit / -view
--       Render a Bootstrap multi-select for the section-level field
--       `agentic_chat_personas_to_use`. The dropdown is populated from
--       the global persona library so editors pick personas by name
--       rather than maintaining a JSON slot map by hand.
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic_chat_personas-edit',
    'Render the agentic-chat persona-array editor in CMS edit mode.',
    'CmsView',
    'create_field_form_item',
    'AgenticChatHooks',
    'outputFieldPersonasEdit'
);

INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic_chat_personas-view',
    'Render the agentic-chat persona-array editor in CMS view mode.',
    'CmsView',
    'create_field_item',
    'AgenticChatHooks',
    'outputFieldPersonasView'
);

INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic_chat_panel-edit',
    'Render the LLM Agentic Chat admin quick-links panel in edit mode.',
    'CmsView',
    'create_field_form_item',
    'AgenticChatHooks',
    'outputFieldPanelEdit'
);

INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic_chat_panel-view',
    'Render the LLM Agentic Chat admin quick-links panel in view mode.',
    'CmsView',
    'create_field_item',
    'AgenticChatHooks',
    'outputFieldPanelView'
);

INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic-chat-personas-select-edit',
    'Render the agentic-chat personas multi-select in CMS edit mode.',
    'CmsView',
    'create_field_form_item',
    'AgenticChatHooks',
    'outputFieldPersonasSelectEdit'
);

INSERT IGNORE INTO `hooks` (`id_hookTypes`, `name`, `description`, `class`, `function`, `exec_class`, `exec_function`)
VALUES (
    (SELECT id FROM lookups WHERE lookup_code = 'hook_overwrite_return' LIMIT 1),
    'field-agentic-chat-personas-select-view',
    'Render the agentic-chat personas multi-select in CMS view mode.',
    'CmsView',
    'create_field_item',
    'AgenticChatHooks',
    'outputFieldPersonasSelectView'
);


COMMIT;
