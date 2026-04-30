<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/style/StyleView.php";

/**
 * View for the agenticChat style. Outputs a single React mount node and
 * loads the agentic-chat UMD bundle + CSS.
 */
class AgenticChatView extends StyleView
{
    public function __construct($model, $controller)
    {
        parent::__construct($model, $controller);
    }

    public function output_content()
    {
        // Skip rendering inside the CMS preview if applicable (mirrors LlmChatView).
        if (
            (method_exists($this->model, 'is_cms_page') && $this->model->is_cms_page()) &&
            (method_exists($this->model, 'is_cms_page_editing') && $this->model->is_cms_page_editing())
        ) {
            return;
        }

        $userId = $this->model->getUserId();
        $sectionId = $this->model->getSectionId();
        $config = $this->getReactConfig();

        include __DIR__ . '/tpl/agentic_chat_main.php';
    }

    public function output_content_mobile()
    {
        if (
            (method_exists($this->model, 'is_cms_page') && $this->model->is_cms_page()) &&
            (method_exists($this->model, 'is_cms_page_editing') && $this->model->is_cms_page_editing())
        ) {
            return [];
        }

        $style = parent::output_content_mobile();
        $style['user_id'] = $this->model->getUserId();
        $style['section_id'] = $this->model->getSectionId();
        $style['agentic_config'] = $this->model->getReactConfig();
        return $style;
    }

    public function get_css_includes($local = array())
    {
        if (empty($local)) {
            $cssFile = __DIR__ . "/../../../../css/ext/agentic-chat.css";
            $version = is_file($cssFile) ? (filemtime($cssFile) ?: time()) : time();
            $local = [$cssFile . "?v=" . $version];
        }
        return parent::get_css_includes($local);
    }

    public function get_js_includes($local = array())
    {
        if (empty($local)) {
            $jsFile = __DIR__ . "/../../../../js/ext/agentic-chat.umd.js";
            $version = is_file($jsFile) ? (filemtime($jsFile) ?: time()) : time();
            $local = [$jsFile . "?v=" . $version];
        }
        return parent::get_js_includes($local);
    }

    /** @return string JSON config for the React chat (see AgenticChatModel::getReactConfig). */
    public function getReactConfig()
    {
        return json_encode($this->model->getReactConfig());
    }
}
