<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../component/BaseHooks.php";
require_once __DIR__ . "/../../../../component/style/BaseStyleComponent.php";

/**
 * The class to define the hooks for the LLM Agentic Chat plugin.
 *
 * Hooks registered by this plugin (see server/db/v1.0.0.sql):
 *
 *  - field-agentic_chat_personas-edit / -view
 *      Render the React-powered persona-array editor inside the CMS field
 *      detail view, instead of a plain JSON textarea.
 *
 *  - field-agentic_chat_panel-edit / -view
 *      Render the admin panel widget (quick-link buttons) on the
 *      sh_module_llm_agentic_chat page.
 */
class AgenticChatHooks extends BaseHooks
{
    /* Constructors *********************************************************/

    /**
     * @param object $services The service handler instance.
     * @param object $params   Various params.
     */
    public function __construct($services, $params = array())
    {
        parent::__construct($services, $params);
    }

    /* Public Hook Methods ***************************************************/

    /**
     * Render the Personas JSON editor field in CMS edit mode.
     * Replaces the default textarea with a React mount point that the
     * agentic-admin bundle attaches to.
     *
     * @param object $args Hook params (field name, value, …).
     * @return BaseStyleComponent
     */
    public function outputFieldPersonasEdit($args)
    {
        return $this->renderPersonasField($args, false);
    }

    /**
     * Render the Personas JSON editor field in CMS view mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent
     */
    public function outputFieldPersonasView($args)
    {
        return $this->renderPersonasField($args, true);
    }

    /**
     * Render the LLM Agentic Chat admin quick-links panel in edit mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent
     */
    public function outputFieldPanelEdit($args)
    {
        return $this->renderPanelField($args);
    }

    /**
     * Render the LLM Agentic Chat admin quick-links panel in view mode.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent
     */
    public function outputFieldPanelView($args)
    {
        return $this->renderPanelField($args);
    }

    /* Private Methods *******************************************************/

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
     * Render a markdown card that hosts the persona editor mount node,
     * but only when the field being rendered is named
     * `agentic_chat_personas`. For every other field the original
     * rendering is preserved by delegating to the wrapped private
     * method.
     *
     * @param object $args     Hook params.
     * @param bool   $disabled Whether the field is read-only.
     * @return BaseStyleComponent|mixed
     */
    private function renderPersonasField($args, $disabled)
    {
        $field = $this->safeGetParam($args, 'field', null);
        // Always call the original method first so other fields keep
        // their default rendering when this hook fires.
        $original = null;
        try {
            $original = $this->execute_private_method($args);
        } catch (Throwable $e) {
            // Best-effort: fall back to no original component if the
            // private dispatcher is unavailable in this build.
            $original = null;
        }

        if (!is_array($field) || !isset($field['name']) || $field['name'] !== 'agentic_chat_personas') {
            return $original;
        }

        $value = isset($field['content']) ? (string) $field['content'] : '[]';
        $name = (string) $field['name'];
        $idLanguage = $field['id_language'] ?? 1;
        $idGender = $field['id_gender'] ?? 1;
        $namePrefix = "fields[{$name}][{$idLanguage}][{$idGender}][content]";

        $payload = htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $disabledFlag = $disabled ? '1' : '0';
        $nameAttr = htmlspecialchars($namePrefix, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $markdown = <<<HTML
<div class="agentic-chat-personas-field">
    <div class="agentic-chat-personas-root"
         data-name="{$nameAttr}"
         data-disabled="{$disabledFlag}"
         data-config="{$payload}">
        <textarea name="{$nameAttr}" class="form-control" rows="10"
                  style="font-family: monospace;">{$payload}</textarea>
        <small class="form-text text-muted">JSON array of persona objects. Edit the canonical version on the LLM Agentic Chat admin module.</small>
    </div>
</div>
HTML;

        return new BaseStyleComponent("rawText", array(
            "text" => $markdown,
            "is_html" => true,
        ));
    }

    /**
     * Render an informational panel with quick links to docs & related
     * admin pages, but only for the `agentic_chat_panel` field. Other
     * fields keep their default rendering.
     *
     * @param object $args Hook params.
     * @return BaseStyleComponent|mixed
     */
    private function renderPanelField($args)
    {
        $field = $this->safeGetParam($args, 'field', null);
        $original = null;
        try {
            $original = $this->execute_private_method($args);
        } catch (Throwable $e) {
            $original = null;
        }

        if (!is_array($field) || !isset($field['name']) || $field['name'] !== 'agentic_chat_panel') {
            return $original;
        }

        $configUrl = htmlspecialchars(LLM_AGENTIC_CHAT_ADMIN_URL, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $defaultBackend = htmlspecialchars(AGENTIC_CHAT_DEFAULT_BACKEND_URL, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $markdown = <<<HTML
<div class="card mt-3">
    <div class="card-body">
        <h5 class="card-title"><i class="fa fa-comments"></i> LLM Agentic Chat</h5>
        <p class="card-text">
            Configure the AG-UI backend and the global persona library used by
            the <code>agenticChat</code> CMS style. The default backend is
            <code>{$defaultBackend}</code>.
        </p>
        <a href="{$configUrl}" class="btn btn-primary btn-sm">Open settings</a>
    </div>
</div>
HTML;

        return new BaseStyleComponent("rawText", array(
            "text" => $markdown,
            "is_html" => true,
        ));
    }
}
?>
