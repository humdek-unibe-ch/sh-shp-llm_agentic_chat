-- =============================================================================
-- LLM Agentic Chat Plugin - v1.1.0
--
-- Requires: sh-shp-llm v1.8.0 (memory source types from lookups, the
-- llm_prompt field type, Prompt Lab, llmTraceChunks) and this plugin's
-- v1.0.0.sql.
--
-- This migration:
--   1. Registers the memory source `agentic_chat_end` (a conversation ended:
--      "Case complete." or the End chat button) and links the sh-shp-llm
--      field `memory_rule_ids` to agenticChat to select the memory rules.
--   2. Adds the End chat button fields.
--   3. Makes `agentic_chat_context` an LLM prompt field like the llmChat
--      `conversation_context`: the backend gets the text as written (before:
--      HTML converted from markdown) and every CMS save is a Prompt Lab
--      version.
--   4. Stores the configure context once: `agenticChatThreads` gets
--      configure_recipe_json / configure_hash / id_llm_prompt_versions_module,
--      the existing module_content texts move into per-user llmTraceChunks
--      and the column is dropped. The unused debug_meta column is dropped.
--   5. Bumps the plugin version LAST.
--
-- NOTE: MySQL DDL is not rolled back by the surrounding transaction; every
-- step is idempotent so re-running after a partial failure is safe.
-- NOTE: fields, styles and lookups are cached - clear the SelfHelp cache
-- (Admin > Cache > clear all) after running this migration.
-- =============================================================================

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1) Memory source: agentic_chat_end
--
-- `memory_rule_ids` is the field every style selects memory rules with
-- (sh-shp-llm v1.8.0): the CMS lists every rule, and LLM Memory > Sources
-- shows the sections that select rules. The lookup labels the updates of a
-- finished conversation in Activity.
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `lookups` (`type_code`, `lookup_code`, `lookup_value`, `lookup_description`)
VALUES ('llmMemorySourceType', 'agentic_chat_end', 'Agentic chat end', 'Triggered when an agentic chat conversation ends (Case complete. or the End chat button)');

INSERT IGNORE INTO `styles_fields` (`id_styles`, `id_fields`, `default_value`, `help`) VALUES
(get_style_id('agenticChat'), get_field_id('memory_rule_ids'), '', 'Memory rules to run in the background when a conversation ends: the backend closes it ("Case complete.") or the participant clicks End chat. The rules get the whole conversation. Leave empty to disable. Global memory must be enabled in the LLM settings.');

-- -----------------------------------------------------------------------------
-- 2) End chat button
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `fields` (`id`, `name`, `id_type`, `display`) VALUES
(NULL, 'agentic_chat_show_end_chat_button', get_field_type_id('checkbox'), '0'),
(NULL, 'agentic_chat_end_chat_label',       get_field_type_id('text'),     '1'),
(NULL, 'agentic_chat_end_chat_confirm',     get_field_type_id('text'),     '1');

INSERT IGNORE INTO `styles_fields` (`id_styles`, `id_fields`, `default_value`, `help`) VALUES
(get_style_id('agenticChat'), get_field_id('agentic_chat_show_end_chat_button'), '0', 'Show an End chat button once the participant has replied. It closes the conversation after a confirmation (read-only, like a conversation the backend closed with "Case complete.") and runs the memory rules of "memory_rule_ids".'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_end_chat_label'),       'End chat', 'Label of the End chat button.'),
(get_style_id('agenticChat'), get_field_id('agentic_chat_end_chat_confirm'),     'Do you want to end this conversation? You cannot reply afterwards.', 'Question of the confirmation dialog of the End chat button.');

-- -----------------------------------------------------------------------------
-- 3) agentic_chat_context: LLM prompt field
--
-- Same field type as the llmChat `conversation_context` (sh-shp-llm v1.1.0):
-- the text is stored and sent as written (a markdown field is converted to
-- HTML), the CMS shows the Prompt Lab editor, and every CMS save creates a
-- Prompt Lab version. Existing content keeps its text; markdown fields are
-- stored unescaped, so no conversion is needed.
-- -----------------------------------------------------------------------------
UPDATE `fields`
SET `id_type` = get_field_type_id('llm_prompt')
WHERE `name` = 'agentic_chat_context';

UPDATE `styles_fields`
SET `help` = 'Reflection module text sent to the backend as `module_content` when a thread starts, exactly as written. When set, it overrides the global default module from the admin page (`agentic_chat_default_module`). `{{field_name}}` placeholders are replaced the same way as in the LLM context fields. Every save is a Prompt Lab version; each thread links the version it was started with.'
WHERE `id_styles` = get_style_id('agenticChat') AND `id_fields` = get_field_id('agentic_chat_context');

-- -----------------------------------------------------------------------------
-- 4) Configure context stored once
--
-- configure_recipe_json references what was sent to /reflect/configure:
--   {"module": {"p": <llm_prompt_versions id>} | {"c": [<llmTraceChunks ids>]},
--    "personas": {"c": <llmTraceChunks id>}}
-- or {"body": {"c": <id>}} when the rebuild did not match configure_hash.
-- The module chunks are cut like an sh-shp-llm request trace (LlmTraceBuilder):
-- long Global Values are shared chunks, joined in order with the rest.
-- Chunks are stored once per (owner, sha256): owner 0 = shared admin config
-- (persona descriptions, default module, long Global Values), owner =
-- id_users = section text with replaced placeholders (deleted with the user).
-- -----------------------------------------------------------------------------
CALL add_table_column('agenticChatThreads', 'configure_recipe_json',
    "TEXT DEFAULT NULL COMMENT 'JSON: where the /reflect/configure context is stored (llm_prompt_versions / llmTraceChunks ids)' AFTER `persona_slot_map`");
CALL add_table_column('agenticChatThreads', 'configure_hash',
    "CHAR(64) DEFAULT NULL COMMENT 'sha256 of the canonical JSON of the /reflect/configure body' AFTER `configure_recipe_json`");
CALL add_table_column('agenticChatThreads', 'id_llm_prompt_versions_module',
    "INT(10) UNSIGNED ZEROFILL DEFAULT NULL COMMENT 'Prompt Lab version of agentic_chat_context sent as module_content' AFTER `configure_hash`");
-- Prompt versions are never deleted (sh-shp-llm v1.7.0): RESTRICT, like the
-- request-trace links. add_foreign_key() always cascades, so the FK is
-- dropped (no-op if missing) and added here.
CALL drop_foreign_key('agenticChatThreads', 'fk_agenticChatThreads_module_version');
ALTER TABLE `agenticChatThreads` ADD CONSTRAINT `fk_agenticChatThreads_module_version`
    FOREIGN KEY (`id_llm_prompt_versions_module`) REFERENCES `llm_prompt_versions` (`id`) ON DELETE RESTRICT;

-- Existing threads: their module_content becomes a per-user chunk. The steps
-- only run while the column still exists (a re-run after the drop skips them).
SET @agentic_has_module_content := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agenticChatThreads'
      AND COLUMN_NAME = 'module_content'
);

SET @agentic_sql := IF(@agentic_has_module_content > 0,
    'INSERT IGNORE INTO `llmTraceChunks` (`owner`, `id_users`, `sha256`, `content`)
     SELECT DISTINCT t.id_users, t.id_users, SHA2(t.module_content, 256), t.module_content
     FROM `agenticChatThreads` t
     WHERE t.module_content IS NOT NULL AND t.module_content <> ''''',
    'SELECT 1');
PREPARE agentic_stmt FROM @agentic_sql;
EXECUTE agentic_stmt;
DEALLOCATE PREPARE agentic_stmt;

SET @agentic_sql := IF(@agentic_has_module_content > 0,
    'UPDATE `agenticChatThreads` t
     INNER JOIN `llmTraceChunks` c ON c.owner = t.id_users AND c.sha256 = SHA2(t.module_content, 256)
     SET t.configure_recipe_json = JSON_OBJECT(''module'', JSON_OBJECT(''c'', JSON_ARRAY(CAST(c.id AS UNSIGNED))))
     WHERE t.configure_recipe_json IS NULL AND t.module_content IS NOT NULL AND t.module_content <> ''''',
    'SELECT 1');
PREPARE agentic_stmt FROM @agentic_sql;
EXECUTE agentic_stmt;
DEALLOCATE PREPARE agentic_stmt;

CALL drop_table_column('agenticChatThreads', 'module_content');

-- -----------------------------------------------------------------------------
-- 4b) agentic_chat_timeout also limits silence on the /reflect stream
-- -----------------------------------------------------------------------------
UPDATE `pageType_fields`
SET `help` = 'Backend timeout in seconds: for configure / health calls, and the longest the /reflect stream may stay silent before the run is ended (a reply that keeps streaming is never cut off). A thread still running after twice this time without activity can be ended with End chat.'
WHERE `id_pageType` = (SELECT id FROM pageType WHERE `name` = 'sh_module_llm_agentic_chat') AND `id_fields` = get_field_id('agentic_chat_timeout');

UPDATE `pages_fields`
SET `help` = 'Backend timeout in seconds: configure / health calls, and the longest silence on the /reflect stream.'
WHERE `id_pages` = (SELECT id FROM pages WHERE `keyword` = 'sh_module_llm_agentic_chat') AND `id_fields` = get_field_id('agentic_chat_timeout');

-- -----------------------------------------------------------------------------
-- 4c) Drop agenticChatThreads.debug_meta: no code ever wrote debug events
-- -----------------------------------------------------------------------------
CALL drop_table_column('agenticChatThreads', 'debug_meta');

-- -----------------------------------------------------------------------------
-- 5) Version bump last
-- -----------------------------------------------------------------------------
UPDATE `plugins` SET `version` = 'v1.1.0' WHERE `name` = 'llm_agentic_chat';

COMMIT;
