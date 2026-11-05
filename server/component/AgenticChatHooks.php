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
 *      Append a core `select` (multiple) to the section-level field
 *      `agentic_chat_personas_to_use`, listing every persona defined on
 *      the global plugin admin page (like sh-shp-llm's memory-rule picker).
 *
 * The persona editor and the panel render through the core `template`
 * style (which `include`s a PHP file directly) instead of the `rawText`
 * style — the latter HTML-escapes its `text` payload regardless of the
 * `is_html` flag, which would print our markup as literal text inside the
 * form. Templates live in `server/component/tpl/`.
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
     * Render the section-level "personas to use" multi-select with the core
     * `select` style, the same way sh-shp-llm renders its memory-rule picker:
     * the CMS renders the field (label, help, hidden id/type/relation
     * inputs) and the select is appended to it. The selected keys are
     * posted as an array and stored comma-separated by CmsUpdateController.
     * Disabled personas stay listed so a saved key is not lost.
     *
     * @param object $args     Hook params.
     * @param int    $disabled 0 = edit mode, 1 = view mode (read-only).
     * @return BaseStyleComponent|mixed
     */
    private function renderPersonasSelectField($args, $disabled)
    {
        $field = $this->get_param_by_name($args, 'field');
        $res = $this->execute_private_method($args);

        if (($field['name'] ?? '') !== 'agentic_chat_personas_to_use' || !$res) {
            return $res;
        }

        $items = array();
        try {
            $personas = (new AgenticChatService($this->services))->getGlobalConfig()['personas'];
        } catch (Throwable $e) {
            // this hook runs on every CMS field render: never break the edit page
            error_log('[AgenticChatHooks::renderPersonasSelectField] personas not loaded: ' . get_class($e));
            return $res;
        }
        foreach ($personas as $persona) {
            $key = (string) ($persona['key'] ?? '');
            $name = (string) ($persona['name'] ?? '');
            if ($key === '' || $name === '') {
                continue;
            }
            $items[] = array(
                "value" => $key,
                "text" => $name . (!empty($persona['enabled']) ? '' : ' (disabled)')
            );
        }

        $field_name_prefix = "fields[" . $field['name'] . "][" . $field['id_language'] . "]" . "[" . $field['id_gender'] . "]";
        $children = $res->get_view()->get_children();
        $children[] = new BaseStyleComponent("select", array(
            // an empty value must stay [''] (not []): the select view only defines "selected" inside its value loop
            "value" => array_map('trim', explode(',', (string) ($field['content'] ?? ''))),
            "name" => $field_name_prefix . "[content]",
            "max" => 10,
            "live_search" => 1,
            "is_multiple" => 1,
            "is_required" => 0,
            "disabled" => (int) $disabled,
            "items" => $items
        ));
        $res->get_view()->set_children($children);

        return $res;
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

    /* =========================================================================
     * PLUGIN DB VERSION
     * ========================================================================= */

    /**
     * Get the plugin database version.
     *
     * @param string $plugin_name Plugin name, defaults to 'llm_agentic_chat'.
     * @return string|null Plugin version or null.
     */
    public function get_plugin_db_version($plugin_name = 'llm_agentic_chat')
    {
        return parent::get_plugin_db_version($plugin_name);
    }
}
