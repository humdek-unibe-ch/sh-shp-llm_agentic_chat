<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../component/BaseView.php";

/**
 * View for the LLM Agentic Chat admin module.
 *
 * Renders a single React mount node. The agentic-admin UMD bundle
 * attaches to it and reads the JSON payload from the `data-config`
 * attribute (CSRF token + initial settings + ACL flags).
 */
class Sh_module_llm_agentic_chatView extends BaseView
{
    public function __construct($model)
    {
        parent::__construct($model, null);
    }

    /** Render the admin page. */
    public function output_content()
    {
        $config = $this->getReactConfig();

        ob_start();
        include __DIR__ . '/tpl/module_llm_agentic_chat_admin.php';
        echo ob_get_clean();
    }

    /** This module has no mobile rendering. */
    public function output_content_mobile()
    {
        return [];
    }

    /** @return array CSS includes (admin bundle). */
    public function get_css_includes($local = [])
    {
        if (empty($local)) {
            $cssFile = __DIR__ . "/../../../css/ext/agentic-admin.css";
            $version = is_file($cssFile) ? (filemtime($cssFile) ?: time()) : time();
            $local = [$cssFile . "?v=" . $version];
        }
        return parent::get_css_includes($local);
    }

    /** @return array JS includes (admin UMD bundle). */
    public function get_js_includes($local = [])
    {
        if (empty($local)) {
            $jsFile = __DIR__ . "/../../../js/ext/agentic-admin.umd.js";
            $version = is_file($jsFile) ? (filemtime($jsFile) ?: time()) : time();
            $local = [$jsFile . "?v=" . $version];
        }
        return parent::get_js_includes($local);
    }

    /**
     * Build the JSON config consumed by the React admin app via data-config.
     * @return string
     */
    public function getReactConfig()
    {
        $services = $this->model->get_services();

        return json_encode([
            'csrfToken' => $this->resolveCsrfToken(),
            'baseUrl' => $services->get_router()->get_link_url(PAGE_LLM_AGENTIC_CHAT_CONFIG),
            'pluginVersion' => LLM_AGENTIC_CHAT_PLUGIN_VERSION,
        ]);
    }

    /** @return string CSRF token from session (defensive). */
    private function resolveCsrfToken()
    {
        return $_SESSION['csrf_token']
            ?? $_SESSION['token']
            ?? $_SESSION['security_token']
            ?? '';
    }
}
