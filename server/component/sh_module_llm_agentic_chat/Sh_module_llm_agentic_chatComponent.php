<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../component/BaseComponent.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chatModel.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chatView.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chatController.php";

/**
 * Admin component for the LLM Agentic Chat plugin.
 * Bound to the page keyword sh_module_llm_agentic_chat (see v1.0.0.sql).
 */
class Sh_module_llm_agentic_chatComponent extends BaseComponent
{
    public function __construct($services, $params = [], $id_page = null)
    {
        $model = new Sh_module_llm_agentic_chatModel($services);
        $controller = new Sh_module_llm_agentic_chatController($model);
        $view = new Sh_module_llm_agentic_chatView($model);
        parent::__construct($model, $view, $controller);
    }
}
