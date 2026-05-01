<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . "/../../../../../component/BaseController.php";
require_once __DIR__ . "/../AgenticChatJsonResponseTrait.php";

/**
 * Controller for the LLM Agentic Chat Threads admin module.
 *
 * Routes (all GET, JSON):
 *   ?action=list_threads       Paginated thread list with filters.
 *   ?action=get_thread_detail  Thread row + recent messages + debug events.
 *   ?action=counters           Aggregate counters for the dashboard banner.
 *   ?action=filter_options     User + section drop-down option lists for the
 *                              admin multi-select filters.
 *
 * All endpoints require ACL "select" on the threads page.
 */
class Sh_module_llm_agentic_chat_threadsController extends BaseController
{
    use AgenticChatJsonResponseTrait;

    /** @var object ACL service. */
    private $acl;

    /** @var int|null Page id of sh_module_llm_agentic_chat_threads. */
    private $pageId;

    public function __construct($model)
    {
        parent::__construct($model);
        $services = $model->get_services();
        $this->acl = $services->get_acl();
        $this->pageId = $services->get_db()->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_THREADS);
        $this->handleRequest();
    }

    /**
     * Dispatch incoming AJAX request based on the `action` parameter.
     */
    private function handleRequest()
    {
        $action = $_GET['action'] ?? $_POST['action'] ?? null;
        if (!$action) {
            return;
        }

        try {
            switch ($action) {
                case 'list_threads':
                    $this->requireAccess('select');
                    $this->handleListThreads();
                    break;
                case 'get_thread_detail':
                    $this->requireAccess('select');
                    $this->handleGetThreadDetail();
                    break;
                case 'counters':
                    $this->requireAccess('select');
                    $this->handleCounters();
                    break;
                case 'filter_options':
                    $this->requireAccess('select');
                    $this->handleFilterOptions();
                    break;
                default:
                    $this->sendJsonResponse(['error' => 'Unknown action'], 400);
            }
        } catch (Throwable $e) {
            $this->sendJsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    /** Sends 403 + exits when the current user lacks the required ACL mode. */
    private function requireAccess($mode)
    {
        if (!$this->checkAccess($mode)) {
            $this->sendJsonResponse(['error' => 'Access denied'], 403);
        }
    }

    /**
     * @param string $mode 'select' or 'update'.
     * @return bool
     */
    private function checkAccess($mode)
    {
        if (!$this->pageId || !isset($_SESSION['id_user'])) {
            return false;
        }
        $method = 'has_access_' . $mode;
        return $this->acl->$method($_SESSION['id_user'], $this->pageId);
    }

    /** Returns paginated, filtered list of threads. */
    private function handleListThreads()
    {
        // user_id / section_id may arrive as scalar (legacy single select),
        // CSV string, or repeated `user_id[]=` array (multi-select). The model
        // normalises these into integer arrays.
        $filters = [
            'user_id' => $_GET['user_id'] ?? null,
            'section_id' => $_GET['section_id'] ?? null,
            'status' => $_GET['status'] ?? null,
            'query' => trim((string) ($_GET['query'] ?? '')),
        ];
        $page = (int) ($_GET['page'] ?? 1);
        $perPage = (int) ($_GET['per_page'] ?? 25);

        $result = $this->model->listThreads($filters, $page, $perPage);

        $this->sendJsonResponse([
            'ok' => true,
            'data' => $result,
            'statuses' => $this->model->getDistinctStatuses(),
        ]);
    }

    /** Returns user + section drop-down option lists for the multi-select filters. */
    private function handleFilterOptions()
    {
        $this->sendJsonResponse([
            'ok' => true,
            'data' => $this->model->getFilterOptions(),
        ]);
    }

    /** Returns a single thread with recent messages + debug events. */
    private function handleGetThreadDetail()
    {
        $threadId = (int) ($_GET['thread_id'] ?? 0);
        if ($threadId <= 0) {
            $this->sendJsonResponse(['error' => 'Missing thread_id'], 400);
        }

        $detail = $this->model->getThreadDetail($threadId);
        if (!$detail) {
            $this->sendJsonResponse(['error' => 'Thread not found'], 404);
        }

        $this->sendJsonResponse([
            'ok' => true,
            'data' => $detail,
        ]);
    }

    /** Returns aggregate counters for the dashboard banner. */
    private function handleCounters()
    {
        $this->sendJsonResponse([
            'ok' => true,
            'data' => $this->model->getCounters(),
        ]);
    }
}
