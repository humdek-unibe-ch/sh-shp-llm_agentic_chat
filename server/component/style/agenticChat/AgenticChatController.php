<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/BaseController.php";
require_once __DIR__ . "/../../AgenticChatJsonResponseTrait.php";
require_once __DIR__ . "/../../../service/AgenticChatService.php";
require_once __DIR__ . "/../../../../../sh-shp-llm/server/service/LlmSpeechToTextService.php";

/**
 * Controller for the `agenticChat` CMS style.
 *
 * Same-origin request surface consumed by the React chat:
 *
 *   GET  ?action=get_config        &section_id=...
 *   GET  ?action=get_thread        &section_id=...
 *   POST  action=start_thread       section_id=...
 *   POST  action=stream_run         section_id=...    (returns text/event-stream)
 *   POST  action=reset_thread       section_id=...
 *   POST  action=speech_transcribe  section_id=...    (multipart/form-data with `audio`)
 *
 * Section-id validation mirrors LlmChatController so multiple instances of
 * the style coexist on the same page without trampling each other.
 *
 * @package LLM Agentic Chat Plugin
 */
class AgenticChatController extends BaseController
{
    use AgenticChatJsonResponseTrait;

    /** @var AgenticChatService Shared with the model to avoid duplicate instantiation. */
    private $service;

    /** @var LlmSpeechToTextService|null Lazily instantiated when speech actions fire. */
    private $speechService = null;

    /** @var string|null Action currently being processed (for diagnostics). */
    private $currentAction = null;

    /* =========================================================================
     * CONSTRUCTOR
     * ========================================================================= */

    public function __construct($model)
    {
        parent::__construct($model);

        if (!$this->isRequestForThisSection()) {
            return; // Another agenticChat instance on the page handles this.
        }
        $router = $model->get_services()->get_router();
        if ($router && isset($router->current_keyword) && $router->current_keyword === 'admin') {
            return;
        }

        $this->service = $model->getAgenticService();

        $this->dispatch();
    }

    /* =========================================================================
     * REQUEST GATING / DISPATCH
     * ========================================================================= */

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

    /** Route the incoming request to the matching action handler. */
    private function dispatch()
    {
        // Mobile-rendering bootstrap (no action) - skip so the view runs.
        if (isset($_POST['mobile']) && $_POST['mobile'] && !isset($_POST['action']) && !isset($_GET['action'])) {
            return;
        }

        $action = $_POST['action'] ?? $_GET['action'] ?? null;
        $this->currentAction = $action;

        if ($action === null) {
            return;
        }

        // Capture any stray warnings/notices/whitespace emitted during
        // action processing so they can't poison the JSON response.
        // The streaming action drops this buffer itself before flushing.
        ob_start();

        // start_thread / reset_thread synchronously call the upstream
        // backend's /reflect/configure endpoint, which can take longer
        // than PHP's default max_execution_time (30s) on a cold backend.
        // stream_run is intrinsically long-running (SSE) and may now also
        // perform a lazy /reflect/configure on the very first run for a
        // thread so the same agui_thread_id is reused for both calls.
        // Lift the ceiling so the caller never sees an Apache 504 /
        // truncated response (which would surface in React as "Invalid
        // JSON response" or a half-streamed run that aborts mid-token).
        if ($action === 'start_thread' || $action === 'reset_thread' || $action === 'stream_run') {
            @set_time_limit(0);
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
                case 'speech_transcribe':
                    $this->actionSpeechTranscribe($userId);
                    break;
                default:
                    $this->sendJsonResponse(['error' => 'Unknown action: ' . $action], 400);
            }
        } catch (Throwable $e) {
            error_log('[AgenticChatController] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
            $this->sendJsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    /* =========================================================================
     * ACTION HANDLERS
     * ========================================================================= */

    /** Return the React-config snapshot (mirrors data-config but live). */
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
     * Configure the active thread on the backend (idempotent).
     *
     * The persona slot map is rebuilt from the section configuration on
     * the server side - the React frontend is not allowed to override it.
     * Module content is always read from the global plugin configuration.
     */
    private function actionStartThread($userId)
    {
        $sectionId = $this->model->getSectionId();
        $thread = $this->service->getOrCreateThread($userId, $sectionId);

        $slotMap = $this->model->buildBackendSlotMap();
        $result = $this->service->configureThread($thread, $slotMap);

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
     * The same `agui_thread_id` is reused for the lifetime of the
     * conversation: it is generated once by `getOrCreateThread()` (when
     * the user first interacts with this section), used by
     * `/reflect/configure` to register the personas + module content on
     * the backend, and then bound to every subsequent `/reflect` call so
     * the backend can correlate run history. To make that contract hold
     * even when the React client jumps straight to `stream_run` without
     * an explicit `start_thread` (e.g. auto-start disabled, manual send
     * from a fresh tab, page refresh of a never-configured thread), we
     * auto-configure the thread here on its very first run. Subsequent
     * runs detect `persona_slot_map !== null` and skip the configure
     * round-trip, so this is a no-op once the thread is registered.
     *
     * Request body fields:
     *   - section_id (already validated)
     *   - message    string            user input or auto-start token
     *   - resume     json (optional)   AG-UI resume payload
     */
    private function actionStreamRun($userId)
    {
        $sectionId = $this->model->getSectionId();
        $thread = $this->service->getOrCreateThread($userId, $sectionId);

        // Lazily register the personas on the backend the first time
        // this thread is used. `persona_slot_map` is the canonical "this
        // thread has been configured" signal: it is set inside
        // `configureThread()` together with `module_content`, and it is
        // never cleared while the thread is active. Reusing the same
        // `agui_thread_id` for the configure call guarantees that every
        // later `/reflect` run carrying this thread_id finds the persona
        // bindings and accumulated history server-side.
        if (empty($thread['persona_slot_map'])) {
            $slotMap = $this->model->buildBackendSlotMap();
            $configureResult = $this->service->configureThread($thread, $slotMap);
            $thread = $this->service->getThreadService()->getThreadById($thread['id']);
            if (!$configureResult['ok']) {
                // Without a configured thread the backend will reject the
                // stream (or worse, silently start a fresh context). Surface
                // the error to the React client instead of streaming into
                // the void.
                $this->startSseStream();
                $this->sendSseEvent([
                    'type' => 'PROXY_ERROR',
                    'message' => $configureResult['error'] ?? 'Failed to configure thread',
                    'status' => $configureResult['status'] ?? 500,
                ]);
                $this->sendSseEvent(['type' => 'PROXY_DONE', 'ok' => false]);
                if (function_exists('uopz_allow_exit')) {
                    uopz_allow_exit(true);
                }
                exit;
            }
        }

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

    /** Mark the current thread complete and create a fresh one. */
    private function actionResetThread($userId)
    {
        $sectionId = $this->model->getSectionId();
        $newThread = $this->service->resetThread($userId, $sectionId);
        $this->sendJsonResponse([
            'ok' => true,
            'thread' => $this->presentThread($newThread, $userId),
        ]);
    }

    /**
     * Transcribe an uploaded audio blob via the Whisper model configured
     * on this section. The plugin reuses sh-shp-llm's LlmSpeechToTextService
     * so audio file naming / language detection / cURL handling stay
     * consistent across both chat surfaces.
     *
     * Request body (multipart/form-data):
     *   - section_id (already validated)
     *   - audio      file              compressed audio recording
     */
    private function actionSpeechTranscribe($userId)
    {
        if (!$this->model->isSpeechToTextEnabled()) {
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'Speech-to-text is not enabled for this chat.',
            ], 400);
            return;
        }

        $speechModel = $this->model->getSpeechToTextModel();
        if ($speechModel === '') {
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'No speech-to-text model configured.',
            ], 400);
            return;
        }

        if (!isset($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
            $uploadError = $_FILES['audio']['error'] ?? 'No file';
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'No audio file provided or upload failed (error: ' . $uploadError . ').',
            ], 400);
            return;
        }

        $audioFile = $_FILES['audio'];
        if (defined('LLM_MAX_AUDIO_SIZE') && $audioFile['size'] > LLM_MAX_AUDIO_SIZE) {
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'Audio file too large. Maximum size is 25MB.',
            ], 400);
            return;
        }

        $speech = $this->getSpeechService();
        $mimeType = $audioFile['type'] ?? '';
        if (!$speech->isValidAudioType($mimeType)) {
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'Invalid audio format. Supported: WebM/Opus, OGG/Opus, M4A/MP4, MP3, FLAC.',
            ], 400);
            return;
        }

        try {
            $sectionId = $this->model->getSectionId();
            $thread = $this->service->getOrCreateThread($userId, $sectionId);
            $conversationId = (int) ($thread['id_llmConversations'] ?? 0) ?: null;
            $language = $speech->getUserLanguage();

            $result = $speech->saveAndTranscribeAudio(
                $audioFile,
                $userId,
                $sectionId,
                $conversationId,
                $speechModel,
                $language,
                true
            );

            $this->sendJsonResponse($result);
        } catch (Throwable $e) {
            error_log('[AgenticChatController::speech_transcribe] ' . $e->getMessage());
            $this->sendJsonResponse([
                'success' => false,
                'error'   => 'Speech transcription failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    /* =========================================================================
     * HELPERS
     * ========================================================================= */

    /** @return LlmSpeechToTextService */
    private function getSpeechService()
    {
        if ($this->speechService === null) {
            $this->speechService = new LlmSpeechToTextService($this->model->get_services());
        }
        return $this->speechService;
    }

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
                'thread'   => null,
                'messages' => [],
            ];
        }
        return $this->presentThread($thread, $userId);
    }

    /**
     * Project a thread row + its messages into the React-friendly shape.
     *
     * @param array $thread
     * @param int   $userId
     * @return array
     */
    private function presentThread(array $thread, $userId)
    {
        $db = $this->model->get_services()->get_db();
        $rawMessages = $db->query_db(
            "SELECT id, role, content, sent_context, `timestamp`
               FROM llmMessages
              WHERE id_llmConversations = ?
                AND deleted = 0
           ORDER BY id ASC",
            [(int) $thread['id_llmConversations']]
        ) ?: [];

        $messages = array_map(static function ($row) {
            $sentContext = null;
            if (!empty($row['sent_context'])) {
                $decoded = json_decode((string) $row['sent_context'], true);
                $sentContext = is_array($decoded) ? $decoded : null;
            }
            return [
                'id'         => (int) $row['id'],
                'role'       => $row['role'],
                'content'    => $row['content'],
                'context'    => $sentContext,
                'created_at' => $row['timestamp'] ?? null,
            ];
        }, $rawMessages);

        $slotMap = !empty($thread['persona_slot_map'])
            ? json_decode((string) $thread['persona_slot_map'], true)
            : null;

        $pendingInterrupts = !empty($thread['pending_interrupts'])
            ? json_decode((string) $thread['pending_interrupts'], true)
            : null;
        if (!is_array($pendingInterrupts)) {
            $pendingInterrupts = [];
        }

        return [
            'thread' => [
                'id'                => (int) $thread['id'],
                'aguiThreadId'      => $thread['agui_thread_id'],
                'lastRunId'         => $thread['last_run_id'] ?? null,
                'status'            => $thread['status'],
                'isCompleted'       => (int) ($thread['is_completed'] ?? 0) === 1,
                'lastError'         => $thread['last_error'] ?? null,
                'personaSlotMap'    => is_array($slotMap) ? $slotMap : new stdClass(),
                'moduleContent'     => $thread['module_content'] ?? null,
                'pendingInterrupts' => $pendingInterrupts,
                'awaitingInput'     => !empty($pendingInterrupts),
                'usage'             => [
                    'input'  => isset($thread['usage_input_tokens'])  ? (int) $thread['usage_input_tokens']  : null,
                    'output' => isset($thread['usage_output_tokens']) ? (int) $thread['usage_output_tokens'] : null,
                    'total'  => isset($thread['usage_total_tokens'])  ? (int) $thread['usage_total_tokens']  : null,
                ],
                'conversationId'    => (int) $thread['id_llmConversations'],
            ],
            'messages' => $messages,
        ];
    }
}
