<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../component/BaseHooks.php";
require_once __DIR__ . "/../../../../component/style/BaseStyleComponent.php";
require_once __DIR__ . "/../service/AgenticChatService.php";

/**
 * CMS hooks for the LLM Agentic Chat plugin.
 *
 * Hooks registered (see server/db/v1.0.0.sql):
 *
 *  - field-agentic_chat_personas-edit / -view
 *      Render the React-powered persona-array editor inside the CMS field
 *      detail view, instead of a plain JSON textarea (admin module).
 *
 *  - field-agentic_chat_panel-edit / -view
 *      Render the admin quick-link panel widget on the
 *      sh_module_llm_agentic_chat page.
 *
 *  - field-agentic-chat-personas-select-edit / -view
 *      Render a Bootstrap multi-select for the section-level field
 *      `agentic_chat_personas_to_use`. The dropdown is populated with
 *      every persona defined on the global plugin admin page so editors
 *      can pick which personas take part in the section's chat.
 *
 * All three hooks render through the core `template` style (which
 * `include`s a PHP file directly) instead of the `rawText` style — the
 * latter HTML-escapes its `text` payload regardless of the `is_html`
 * flag, which would print our markup as literal text inside the form.
 * Templates live in `server/component/tpl/`.
 *
 * @package LLM Agentic Chat Plugin
 */
class AgenticChatHooks extends BaseHooks
{
    /* =========================================================================
     * CONSTRUCTOR
     * ========================================================================= */

    /**
     * @param object $services The service handler instance.
     * @param object $params   Various params.
     */
    public function __construct($services, $params = array())
    {
        parent::__construct($services, $params);
    }

    /* =========================================================================
     * PUBLIC HOOK ENTRY POINTS
     * ========================================================================= */

    /**
     * Hook target: render the global personas JSON editor in CMS edit mode.
     *
     * @param object $args Hook params (field name, value, …).
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPersonasEdit($args)
    {
        return $this->renderPersonasField($args, false);
    }

    /**
     * Hook target: render the global personas JSON editor in CMS view mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPersonasView($args)
    {
        return $this->renderPersonasField($args, true);
    }

    /**
     * Hook target: render the admin quick-links panel in CMS edit mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPanelEdit($args)
    {
        return $this->renderPanelField($args);
    }

    /**
     * Hook target: render the admin quick-links panel in CMS view mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPanelView($args)
    {
        return $this->renderPanelField($args);
    }

    /**
     * Hook target: render the section-level "personas to use" multi-select
     * in CMS edit mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPersonasSelectEdit($args)
    {
        return $this->renderPersonasSelectField($args, 0);
    }

    /**
     * Hook target: render the section-level "personas to use" multi-select
     * in CMS view mode (read-only).
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    public function outputFieldPersonasSelectView($args)
    {
        return $this->renderPersonasSelectField($args, 1);
    }

    /* =========================================================================
     * PRIVATE HELPERS
     * ========================================================================= */

    /**
     * Defensive variant of get_param_by_name() that returns a default
     * instead of throwing when the parameter is missing.
     *
     * @param mixed  $args     Hook args.
     * @param string $name     Parameter name.
     * @param mixed  $default  Default value if not found.
     * @return mixed
     */
    private function safeGetParam($args, $name, $default = null)
    {
        try {
            $value = $this->get_param_by_name($args, $name);
            return $value !== null ? $value : $default;
        } catch (Exception $e) {
            return $default;
        }
    }

    /**
     * Render the persona-array JSON editor for the global library field.
     * Falls back to the default rendering for any other field name.
     *
     * @param object $args     Hook params.
     * @param bool   $disabled Whether the editor should be read-only.
     * @return BaseStyleComponent|mixed
     */
    private function renderPersonasField($args, $disabled)
    {
        $field = $this->safeGetParam($args, 'field', null);
        $original = $this->safeExecutePrivate($args);

        if (!is_array($field) || !isset($field['name']) || $field['name'] !== 'agentic_chat_personas') {
            return $original;
        }

        $value = isset($field['content']) ? (string) $field['content'] : '[]';
        $name = (string) $field['name'];
        $idLanguage = $field['id_language'] ?? 1;
        $idGender = $field['id_gender'] ?? 1;
        $namePrefix = "fields[{$name}][{$idLanguage}][{$idGender}][content]";

        return new BaseStyleComponent("template", array(
            "path" => __DIR__ . "/tpl/tpl_personas_field.php",
            "items" => array(
                "inputName" => htmlspecialchars($namePrefix, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "value"     => htmlspecialchars($value,      ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "disabled"  => (bool) $disabled,
            ),
        ));
    }

    /**
     * Render the admin quick-links panel for the `agentic_chat_panel`
     * field. Defaults rendering for any other field.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    private function renderPanelField($args)
    {
        $field = $this->safeGetParam($args, 'field', null);
        $original = $this->safeExecutePrivate($args);

        if (!is_array($field) || !isset($field['name']) || $field['name'] !== 'agentic_chat_panel') {
            return $original;
        }

        return new BaseStyleComponent("template", array(
            "path" => __DIR__ . "/tpl/tpl_admin_panel.php",
            "items" => array(
                "configUrl"      => htmlspecialchars(LLM_AGENTIC_CHAT_ADMIN_URL,      ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "defaultBackend" => htmlspecialchars(AGENTIC_CHAT_DEFAULT_BACKEND_URL, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            ),
        ));
    }

    /**
     * Render the section-level "personas to use" multi-select dropdown.
     *
     * Storage strategy: the field is stored in
     * `sections_fields_translation.content` as a CSV string of persona
     * keys (e.g. `mediator,foundational_teacher`). The `<select multiple>`
     * naturally posts each selected option as
     * `fields[name][lang][gender][content][]` and CmsUpdateController
     * implodes that array with commas before persisting (see core
     * `if(is_array($content)){ $content = implode(',', $content); }` in
     * `update()`). The matching reader, `normalizeStoredKeys()`, also
     * supports JSON-array inputs for legacy/back-compat.
     *
     * @param object $args     Hook params.
     * @param int    $disabled 0 = edit mode, 1 = view mode (read-only).
     * @return BaseStyleComponent|mixed
     */
    private function renderPersonasSelectField($args, $disabled)
    {
        $field = $this->safeGetParam($args, 'field', null);
        $original = $this->safeExecutePrivate($args);

        if (!is_array($field) || ($field['name'] ?? '') !== 'agentic_chat_personas_to_use') {
            return $original;
        }

        return $this->buildPersonaPickerWidget($field, (int) $disabled);
    }

    /**
     * Build the persona picker widget (a `<select multiple>` plus the
     * bookkeeping hidden inputs the CMS save handler expects).
     *
     * The CMS form processor (`CmsUpdateController::update()`) reads
     * `$field['type']`, `$field['id']` and `$field['relation']` for every
     * submitted entry, so any hook that completely replaces the default
     * field renderer must keep emitting those hidden inputs alongside the
     * `[content]` value(s). Without them the save fails with
     * "Undefined array key 'type'".
     *
     * Rendered through the `template` style so the markup is included
     * verbatim (no HTML escaping). The select is upgraded to a Bootstrap
     * dropdown by the existing `selectpicker` JS that ships with the CMS.
     *
     * @param array $field    Hook field descriptor (id, type, relation, content, …).
     * @param int   $disabled 0 = edit, 1 = view (read-only).
     * @return BaseStyleComponent
     */
    private function buildPersonaPickerWidget(array $field, $disabled)
    {
        $idLanguage = $field['id_language'] ?? 1;
        $idGender   = $field['id_gender']   ?? 1;
        $namePrefix = "fields[" . $field['name'] . "][" . $idLanguage . "][" . $idGender . "]";
        $contentName = $namePrefix . "[content]";

        $selectedKeys = $this->normalizeStoredKeys((string) ($field['content'] ?? ''));
        $optionsHtml  = $this->renderPersonaOptionsHtml($selectedKeys);
        $domId        = 'agc-personas-' . substr(md5($contentName), 0, 8);

        return new BaseStyleComponent("template", array(
            "path"  => __DIR__ . "/tpl/tpl_personas_select.php",
            "items" => array(
                "inputName"     => htmlspecialchars($contentName,  ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "namePrefix"    => htmlspecialchars($namePrefix,   ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "fieldId"       => (int) ($field['id'] ?? 0),
                "fieldType"     => htmlspecialchars((string) ($field['type']     ?? 'agentic-chat-personas-select'), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "fieldRelation" => htmlspecialchars((string) ($field['relation'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "optionsHtml"   => $optionsHtml,
                "domId"         => htmlspecialchars($domId,        ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                "disabled"      => (bool) $disabled,
            ),
        ));
    }

    /**
     * Build the inner `<option>` markup for the persona <select>.
     *
     * @param array<int, string> $selectedKeys Currently-selected persona keys.
     * @return string Concatenated <option> HTML.
     */
    private function renderPersonaOptionsHtml(array $selectedKeys)
    {
        try {
            $service = new AgenticChatService($this->services);
            $config = $service->getGlobalConfig();
            $personas = is_array($config['personas'] ?? null) ? $config['personas'] : [];
        } catch (Throwable $e) {
            error_log('[AgenticChatHooks::renderPersonaOptionsHtml] ' . $e->getMessage());
            return '<option value="">Error loading personas: '
                . htmlspecialchars($e->getMessage(), ENT_QUOTES | ENT_HTML5, 'UTF-8')
                . '</option>';
        }

        if (empty($personas)) {
            return '<option value="" disabled>No personas defined yet — add some on the admin page first.</option>';
        }

        $selectedFlip = array_flip($selectedKeys);
        $html = '';
        foreach ($personas as $persona) {
            $key = (string) ($persona['key'] ?? '');
            $name = (string) ($persona['name'] ?? '');
            if ($key === '' || $name === '') {
                continue;
            }
            $label = $name;
            if (!empty($persona['role'])) {
                $label .= ' (' . $this->prettyRoleLabel((string) $persona['role']) . ')';
            }
            if (empty($persona['enabled'])) {
                $label .= ' — disabled';
            }
            $isSelected = isset($selectedFlip[$key]) ? ' selected' : '';
            $html .= sprintf(
                '<option value="%s"%s>%s</option>',
                htmlspecialchars($key, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                $isSelected,
                htmlspecialchars($label, ENT_QUOTES | ENT_HTML5, 'UTF-8')
            );
        }

        return $html;
    }

    /**
     * Normalise the raw stored value into a deduplicated array of
     * persona keys. Accepts JSON arrays (canonical), CSV strings (legacy
     * fallback), or empty values.
     *
     * @param string $raw Raw field content from the database.
     * @return array<int, string>
     */
    private function normalizeStoredKeys($raw)
    {
        $raw = trim((string) $raw);
        if ($raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $keys = [];
            foreach ($decoded as $value) {
                if (!is_scalar($value)) {
                    continue;
                }
                $key = trim((string) $value);
                if ($key !== '' && !in_array($key, $keys, true)) {
                    $keys[] = $key;
                }
            }
            return $keys;
        }

        return array_values(array_unique(array_filter(
            array_map('trim', explode(',', $raw)),
            static function ($v) { return $v !== ''; }
        )));
    }

    /**
     * Convert a `agentic_persona_role_*` lookup code into a friendly
     * label used in dropdown options.
     *
     * @param string $code Role lookup code.
     * @return string
     */
    private function prettyRoleLabel($code)
    {
        $code = preg_replace('/^agentic_persona_role_/', '', (string) $code);
        return ucwords(str_replace('_', ' ', (string) $code));
    }

    /**
     * Wrap execute_private_method so it never bubbles up exceptions when
     * the host CMS does not expose the dispatcher (e.g. in tests or in
     * partial bundles).
     *
     * @param object $args Hook params.
     * @return mixed Original component, or null on failure.
     */
    private function safeExecutePrivate($args)
    {
        try {
            return $this->execute_private_method($args);
        } catch (Throwable $e) {
            return null;
        }
    }
}
