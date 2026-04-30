<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/BaseComponent.php";
require_once __DIR__ . "/AgenticChatModel.php";
require_once __DIR__ . "/AgenticChatView.php";
require_once __DIR__ . "/AgenticChatController.php";

/**
 * agenticChat style: renders an AG-UI multi-persona chat surface backed
 * by an external workflow server (e.g. FoResTCHAT). Visible message
 * history is mirrored into the base sh-shp-llm storage so existing
 * admin tooling continues to work.
 */
class AgenticChatComponent extends BaseComponent
{
    public function __construct($services, $id, $params = array(), $id_page = -1, $entry_record = array())
    {
        $model = new AgenticChatModel($services, $id, $params, $id_page, $entry_record);
        $controller = new AgenticChatController($model);
        $view = new AgenticChatView($model, $controller);
        parent::__construct($model, $view, $controller);
    }

    /**
     * Authenticated users only - the section streams data tied to a
     * user_id and writes into per-user llmConversations rows.
     */
    public function has_access()
    {
        if (!isset($_SESSION['id_user'])) {
            return false;
        }
        return parent::has_access();
    }
}
