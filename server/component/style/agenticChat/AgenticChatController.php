<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/BaseController.php";
require_once __DIR__ . "/../../AgenticChatJsonResponseTrait.php";
require_once __DIR__ . "/../../../service/AgenticChatService.php";

/**
 * Controller for the agenticChat style.
 *
 * Same-origin request surface used by the React chat:
 *
 *   GET  ?action=get_config         &section_id=...
 *   GET  ?action=get_thread         &section_id=...
 *   POST  action=start_thread        section_id=...
 *   POST  action=stream_run          section_id=...   (returns text/event-stream)
 *   POST  action=reset_thread        section_id=...
 *
 * Section-id validation mirrors LlmChatController so multiple instances
 * on the same page coexist cleanly.
 */
class AgenticChatController extends BaseController
{
    use AgenticChatJsonResponseTrait;

    /** @var AgenticChatService */
    private $service;

    /** @var string|null */
    private $currentAction = null;

    public function __construct($model)
    {
        parent::__construct($model);

        if (!$this->isRequestForThisSection()) {
            return; // Another instance handles this request.
        }
        $router = $model->get_services()->get_router();
        if ($router && isset($router->current_keyword) && $router->current_keyword === 'admin') {
            return;
        }

        $this->service = $model->getAgenticService();

        $this->dispatch();
    }

    /**
     * Filter requests so each agenticChat instance only handles its own.
     *
     * @return bool
     */
    private function isRequestForThisSection()
    {
        $requested = $_GET['section_id'] ?? $_POST['section_id'] ?? null;
        $modelSectionId = $this->model->getSectionId();

        if ($requested === null) {
            $action = $_GET['action'] ?? $_POST['action'] ?? null;
            return $action === null;
        }

        return (int) $requested === (int) $modelSectionId;
    }

    /** Dispatch the matching action handler. */
    private function dispatch()
    {
        if (isset($_POST['mobile']) && $_POST['mobile'] && !isset($_POST['action']) && !isset($_GET['action'])) {
            return;
        }

        $action = $_POST['action'] ?? $_GET['action'] ?? null;
        $this->currentAction = $action;

        if ($action === null) {
            return;
        }

        $userId = $this->model->getUserId();
        if (!$userId) {
            $this->sendJsonResponse(['error' => 'User not authenticated'], 401);
            return;
        }

        try {
            switch ($action) {
                case 'get_config':
                    $this->actionGetConfig($userId);
                    break;
                case 'get_thread':
                    $this->actionGetThread($userId);
                    break;
                case 'start_thread':
                    $this->actionStartThread($userId);
                    break;
                case 'stream_run':
                    $this->actionStreamRun($userId);
                    break;
                case 'reset_thread':
                    $this->actionResetThread($userId);
                    break;
                default:
                    $this->sendJsonResponse(['error' => 'Unknown action: ' . $action], 400);
            }
        } catch (Throwable $e) {
            error_log('[AgenticChatController] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
            $this->sendJsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    /* Action Handlers ********************************************************/

    /** Return the React-config snapshot (same as data-config but live). */
    private function actionGetConfig($userId)
    {
        $config = $this->model->getReactConfig();
        $thread = $this->getThreadView($userId);
        $this->sendJsonResponse(['ok' => true, 'config' => $config, 'thread' => $thread]);
    }

    /** Return the active thread + visible message history. */
    private function actionGetThread($userId)
    {
        $thread = $this->getThreadView($userId);
        $this->sendJsonResponse(['ok' => true, 'thread' => $thread]);
    }

    /**
     * Configure the active thread on the backend (idempotent). Fails gracefully
     * if no slot map is provided - we'll fall back to the section's defaults.
     */
    private function actionStartThread($userId)
    {
        $sectionId = $this->model->getSectionId();
        $thread = $this->service->getOrCreateThread($userId, $sectionId);

        $slotMap = $this->model->getPersonaSlotMap();
        if (isset($_POST['persona_slot_map'])) {
            $decoded = json_decode((string) $_POST['persona_slot_map'], true);
            if (is_array($decoded)) {
                $slotMap = $decoded;
            }
        }

        $moduleContent = $this->model->getModuleContent();
        if (isset($_POST['module_content'])) {
            $moduleContent = (string) $_POST['module_content'];
        }

        $result = $this->service->configureThread($thread, $slotMap, $moduleContent);

        $thread = $this->service->getThreadService()->getThreadById($thread['id']);

        $this->sendJsonResponse([
            'ok' => $result['ok'],
            'thread' => $this->presentThread($thread, $userId),
            'configure' => $result,
        ]);
    }

    /**
     * Stream a single AG-UI run as SSE through this same-origin endpoint.
     *
     * Request body fields:
     *   - section_id (already validated)
     *   - message       string            user input or auto-start token
     *   - resume        json (optional)   AG-UI resume payload
     */
    private function actionStreamRun($userId)
    {
        $sectionId = $this->model->getSectionId();
        $thread = $this->service->getOrCreateThread($userId, $sectionId);

        $message = isset($_POST['message']) ? (string) $_POST['message'] : null;
        $resumeRaw = $_POST['resume'] ?? null;
        $resume = null;
        if (is_string($resumeRaw) && $resumeRaw !== '') {
            $decoded = json_decode($resumeRaw, true);
            if (is_array($decoded)) {
                $resume = $decoded;
            }
        }

        $this->startSseStream();

        $this->sendSseEvent([
            'type' => 'PROXY_THREAD_INFO',
            'threadId' => $thread['agui_thread_id'],
            'conversationId' => (int) $thread['id_llmConversations'],
        ]);

        $forward = function (string $rawChunk) {
            // Forward the upstream SSE chunk verbatim. The chunk already
            // contains "data: ...\n\n" framing.
            echo $rawChunk;
            @flush();

            if (connection_aborted()) {
                return false;
            }
            return null;
        };

        $result = $this->service->streamRun($thread, $message, $resume, $forward);

        if (!$result['ok']) {
            $this->sendSseEvent([
                'type' => 'PROXY_ERROR',
                'message' => $result['error'] ?? 'Backend error',
                'status' => $result['status'] ?? 500,
            ]);
        }

        $this->sendSseEvent(['type' => 'PROXY_DONE', 'ok' => $result['ok']]);

        if (function_exists('uopz_allow_exit')) {
            uopz_allow_exit(true);
        }
        exit;
    }

    /** Mark current thread complete and create a fresh one. */
    private function actionResetThread($userId)
    {
        $sectionId = $this->model->getSectionId();
        $newThread = $this->service->resetThread($userId, $sectionId);
        $this->sendJsonResponse([
            'ok' => true,
            'thread' => $this->presentThread($newThread, $userId),
        ]);
    }

    /* Helpers ****************************************************************/

    /**
     * Resolve the active thread + visible messages for the React UI.
     *
     * @param int $userId
     * @return array
     */
    private function getThreadView($userId)
    {
        $sectionId = $this->model->getSectionId();
        $thread = $this->service->getThreadService()->getActiveThreadForUser($userId, $sectionId);
        if (!$thread) {
            return [
                'thread' => null,
                'messages' => [],
            ];
        }
        return $this->presentThread($thread, $userId);
    }

    /**
     * Project a thread row + its messages into a React-friendly shape.
     *
     * @param array $thread
     * @param int   $userId
     * @return array
     */
    private function presentThread(array $thread, $userId)
    {
        $db = $this->model->get_services()->get_db();
        $rawMessages = $db->query_db(
            "SELECT id, role, content, sent_context, created_at
               FROM llmMessages
              WHERE id_llmConversations = ?
                AND deleted = 0
           ORDER BY id ASC",
            [(int) $thread['id_llmConversations']]
        ) ?: [];

        $messages = array_map(function ($row) {
            $sentContext = null;
            if (!empty($row['sent_context'])) {
                $decoded = json_decode((string) $row['sent_context'], true);
                $sentContext = is_array($decoded) ? $decoded : null;
            }
            return [
                'id' => (int) $row['id'],
                'role' => $row['role'],
                'content' => $row['content'],
                'context' => $sentContext,
                'created_at' => $row['created_at'],
            ];
        }, $rawMessages);

        $slotMap = !empty($thread['persona_slot_map'])
            ? json_decode((string) $thread['persona_slot_map'], true)
            : null;

        return [
            'thread' => [
                'id' => (int) $thread['id'],
                'aguiThreadId' => $thread['agui_thread_id'],
                'lastRunId' => $thread['last_run_id'] ?? null,
                'status' => $thread['status'],
                'isCompleted' => (int) ($thread['is_completed'] ?? 0) === 1,
                'lastError' => $thread['last_error'] ?? null,
                'personaSlotMap' => is_array($slotMap) ? $slotMap : new stdClass(),
                'moduleContent' => $thread['module_content'] ?? null,
                'usage' => [
                    'input' => isset($thread['usage_input_tokens']) ? (int) $thread['usage_input_tokens'] : null,
                    'output' => isset($thread['usage_output_tokens']) ? (int) $thread['usage_output_tokens'] : null,
                    'total' => isset($thread['usage_total_tokens']) ? (int) $thread['usage_total_tokens'] : null,
                ],
                'conversationId' => (int) $thread['id_llmConversations'],
            ],
            'messages' => $messages,
        ];
    }
}
