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
--      timeout, debug flag, default module content, and the global
--      persona JSON array.
--   4. Adds the `agenticChat` CMS style with section-level fields.
--   5. Creates the `agenticChatThreads` table linking llmConversations
--      to AG-UI thread metadata.
--   6. Registers transaction logging and persona-role lookups.
--   7. Registers hooks for the personas-editor field and admin panel.
-- =============================================================================

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1) Plugin registration
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `plugins` (`name`, `version`)
VALUES ('llm_agentic_chat', 'v1.0.0');


-- -----------------------------------------------------------------------------
-- 2) Admin page type & page
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `pageType` (`name`) VALUES ('sh_module_llm_agentic_chat');


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
(NULL, 'agentic_chat_debug_enabled',        get_field_type_id('checkbox'), '0'),
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
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_debug_enabled'), '0', 'When enabled, the chat surface exposes a debug panel showing every AG-UI event in real time.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_default_module'), '', 'Default module / reflection text injected into every new AG-UI thread when the section does not provide its own.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_personas'), '[]', 'Global persona library, stored as a JSON array. Each persona has: key, name, role, instructions, color, avatar, enabled.'),
((SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat'), get_field_id('agentic_chat_panel'), NULL, 'Quick-link panel rendered above the form on the admin page.');


-- -- Insert the admin page itself.
SET @id_page_modules_agentic = (SELECT id FROM pages WHERE keyword = 'sh_modules');

INSERT IGNORE INTO `pages` (`id`, `keyword`, `url`, `protocol`, `id_actions`, `id_navigation_section`, `parent`, `is_headless`, `nav_position`, `footer_position`, `id_type`, `id_pageAccessTypes`)
VALUES (
    NULL,
    'sh_module_llm_agentic_chat',
    '/admin/module_llm_agentic_chat',
    'GET|POST',
    (SELECT id FROM actions WHERE `name` = 'backend' LIMIT 1),
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
(@id_page_agentic_config, get_field_id('agentic_chat_debug_enabled'),  '0',                  'Show debug panel for AG-UI events.'),
(@id_page_agentic_config, get_field_id('agentic_chat_default_module'), '',                   'Default module text injected into new threads.'),
(@id_page_agentic_config, get_field_id('agentic_chat_personas'),       '[]',                 'Global persona library (JSON array).'),
(@id_page_agentic_config, get_field_id('agentic_chat_panel'),          NULL,                 'Quick-link panel.');


-- -- Page title translations.
INSERT IGNORE INTO `pages_fields_translation` (`id_pages`, `id_fields`, `id_languages`, `content`) VALUES
(@id_page_agentic_config, get_field_id('title'), '0000000003', 'LLM Agentic Chat'),
(@id_page_agentic_config, get_field_id('title'), '0000000002', 'LLM Agentic Chat');


-- -- Admin permissions.
INSERT IGNORE INTO `acl_groups` (`id_groups`, `id_pages`, `acl_select`, `acl_insert`, `acl_update`, `acl_delete`)
VALUES ((SELECT id FROM `groups` WHERE `name` = 'admin'), @id_page_agentic_config, '1', '0', '1', '0');


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


-- -- Style-specific fields.
-- -- Internal (display=0): runtime / behaviour configuration.
INSERT IGNORE INTO `fields` (`id`, `name`, `id_type`, `display`) VALUES
(NULL, 'agentic_chat_section_personas', get_field_type_id('agentic-chat-personas'), '0'),
(NULL, 'agentic_chat_persona_slot_map', get_field_type_id('json'), '0'),
(NULL, 'agentic_chat_auto_start',       get_field_type_id('checkbox'), '0'),
(NULL, 'agentic_chat_show_debug',       get_field_type_id('checkbox'), '0'),
(NULL, 'agentic_chat_section_module',   get_field_type_id('textarea'), '0'),
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

-- internal
(get_style_id('agenticChat'), get_field_id('agentic_chat_section_personas'), '[]', 'Personas selected for this section (subset of the global library). Leave empty to fall back to the global library.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_persona_slot_map'), '{}', 'JSON object mapping backend slots to persona keys. Example: {"foundational_instructions":"persona_a","inclusive_instructions":"persona_b","inquiry_instructions":"persona_c","mediator":"persona_d"}'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_auto_start'),       '1',   'When enabled, the chat sends the kickoff token __auto_start__ as soon as the user opens the section.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_debug'),       '0',   'Show the AG-UI event debug panel below the chat (overrides the global setting locally).'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_section_module'),   '',    'Module / reflection text for this section. Falls back to the plugin default if empty.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_persona_strip'), '1', 'Show the strip with active/visited persona avatars above the messages.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_run_status'),    '1', 'Show the small run-status badge in the chat header.'),

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


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
--       Render the React-powered persona editor instead of a JSON textarea.
--   - field-agentic_chat_panel-edit / -view
--       Render the admin quick-links panel.
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


COMMIT;
