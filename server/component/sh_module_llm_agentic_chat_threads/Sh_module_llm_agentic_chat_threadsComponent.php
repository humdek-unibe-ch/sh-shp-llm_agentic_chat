<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . "/../../../../../component/BaseComponent.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chat_threadsModel.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chat_threadsView.php";
require_once __DIR__ . "/Sh_module_llm_agentic_chat_threadsController.php";

/**
 * Admin component for the LLM Agentic Chat Threads / debug viewer.
 * Bound to the page keyword sh_module_llm_agentic_chat_threads.
 */
class Sh_module_llm_agentic_chat_threadsComponent extends BaseComponent
{
    public function __construct($services, $params = [], $id_page = null)
    {
        $model = new Sh_module_llm_agentic_chat_threadsModel($services);
        $controller = new Sh_module_llm_agentic_chat_threadsController($model);
        $view = new Sh_module_llm_agentic_chat_threadsView($model);
        parent::__construct($model, $view, $controller);
    }
}
