<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . "/../../../../../component/BaseView.php";
require_once __DIR__ . "/../moduleAgenticChatShared/AgenticChatAdminLayoutHelper.php";

/**
 * View for the LLM Agentic Chat Threads admin module.
 *
 * Renders the shared admin layout with the threads React app mounted in
 * the content area.
 */
class Sh_module_llm_agentic_chat_threadsView extends BaseView
{
    public function __construct($model)
    {
        parent::__construct($model, null);
    }

    public function output_content()
    {
        $menuItems = AgenticChatAdminLayoutHelper::getMenuItems(
            $this->model->get_services(),
            PAGE_LLM_AGENTIC_CHAT_THREADS
        );

        $config = $this->getReactConfig();

        ob_start();
        include __DIR__ . '/tpl/module_llm_agentic_chat_threads.php';
        $pageContent = ob_get_clean();

        include AgenticChatAdminLayoutHelper::getLayoutTemplatePath();
    }

    public function output_content_mobile()
    {
        return [];
    }

    /** @return array CSS includes for the threads admin bundle. */
    public function get_css_includes($local = [])
    {
        if (empty($local)) {
            $layoutCss = __DIR__ . "/../../../css/ext/agentic-admin-layout.css";
            $threadsCss = __DIR__ . "/../../../css/ext/agentic-threads.css";
            $version = max(
                is_file($layoutCss) ? (filemtime($layoutCss) ?: time()) : time(),
                is_file($threadsCss) ? (filemtime($threadsCss) ?: time()) : time()
            );
            $local = [
                $layoutCss . "?v=" . $version,
                $threadsCss . "?v=" . $version,
            ];
        }
        return parent::get_css_includes($local);
    }

    /** @return array JS includes for the threads admin bundle. */
    public function get_js_includes($local = [])
    {
        if (empty($local)) {
            $jsFile = __DIR__ . "/../../../js/ext/agentic-threads.umd.js";
            $version = is_file($jsFile) ? (filemtime($jsFile) ?: time()) : time();
            $local = [$jsFile . "?v=" . $version];
        }
        return parent::get_js_includes($local);
    }

    /**
     * @return string JSON config consumed by the threads React app via
     * the data-config attribute.
     */
    public function getReactConfig()
    {
        $services = $this->model->get_services();

        return json_encode([
            'csrfToken' => $this->resolveCsrfToken(),
            'baseUrl' => $services->get_router()->get_link_url(PAGE_LLM_AGENTIC_CHAT_THREADS),
            'configBaseUrl' => $services->get_router()->get_link_url(PAGE_LLM_AGENTIC_CHAT_CONFIG),
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
