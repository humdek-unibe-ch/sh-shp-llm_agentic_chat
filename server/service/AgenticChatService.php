<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . '/AgenticChatBackendClient.php';
require_once __DIR__ . '/AgenticChatPersonaService.php';
require_once __DIR__ . '/AgenticChatThreadService.php';

/**
 * High-level orchestrator for agentic chat sessions.
 *
 * Knows how to:
 *   - load global config from the admin page
 *   - resolve the active thread for a user/section
 *   - call /reflect/configure with the section's slot map + module content
 *   - stream /reflect responses through the controller, persisting
 *     visible user/assistant text into llmMessages
 *
 * The service deliberately does *not* parse the AG-UI events into a
 * domain model; the React frontend already does that. It only intercepts
 * TEXT_MESSAGE_* events to keep llmMessages in sync, and CASE_COMPLETE
 * markers to update the thread's completion flag.
 */
class AgenticChatService
{
    /** @var object Services container. */
    private $services;

    /** @var object PageDb. */
    private $db;

    /** @var AgenticChatPersonaService */
    private $personaService;

    /** @var AgenticChatThreadService */
    private $threadService;

    /** @var array<string,string|null>|null Cached config from sh_module_llm_agentic_chat. */
    private $configCache;

    public function __construct($services)
    {
        $this->services = $services;
        $this->db = $services->get_db();
        $this->personaService = new AgenticChatPersonaService();
        $this->threadService = new AgenticChatThreadService($services);
    }

    /** @return AgenticChatPersonaService */
    public function getPersonaService()
    {
        return $this->personaService;
    }

    /** @return AgenticChatThreadService */
    public function getThreadService()
    {
        return $this->threadService;
    }

    /**
     * Load all plugin-level configuration values from the admin config page.
     *
     * @return array{backend_url:string, reflect_path:string, configure_path:string,
     *               defaults_path:string, health_path:string, timeout:int,
     *               default_module:string, personas:array}
     */
    public function getGlobalConfig()
    {
        if ($this->configCache !== null) {
            return $this->configCache;
        }

        $configPageId = $this->db->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_CONFIG);
        $fields = [];
        if ($configPageId) {
            $row = $this->db->query_db_first(
                "CALL get_page_fields(:id_page, :id_languages, :id_default_languages, '', '')",
                [
                    'id_page' => $configPageId,
                    'id_languages' => 1,
                    'id_default_languages' => 1,
                ]
            );
            if (is_array($row)) {
                $fields = $row;
            }
        }

        $personasJson = $fields['agentic_chat_personas'] ?? '[]';
        $personas = $this->personaService->parse($personasJson);

        $this->configCache = [
            'backend_url' => rtrim((string) ($fields['agentic_chat_backend_url'] ?? AGENTIC_CHAT_DEFAULT_BACKEND_URL), '/'),
            'reflect_path' => (string) ($fields['agentic_chat_reflect_path'] ?? AGENTIC_CHAT_DEFAULT_REFLECT_PATH),
            'configure_path' => (string) ($fields['agentic_chat_configure_path'] ?? AGENTIC_CHAT_DEFAULT_CONFIGURE_PATH),
            'defaults_path' => (string) ($fields['agentic_chat_defaults_path'] ?? AGENTIC_CHAT_DEFAULT_DEFAULTS_PATH),
            'health_path' => (string) ($fields['agentic_chat_health_path'] ?? AGENTIC_CHAT_DEFAULT_HEALTH_PATH),
            'timeout' => (int) ($fields['agentic_chat_timeout'] ?? AGENTIC_CHAT_DEFAULT_TIMEOUT),
            'default_module' => (string) ($fields['agentic_chat_default_module'] ?? ''),
            'personas' => $personas,
        ];
        return $this->configCache;
    }

    /**
     * Build a lazy backend client using the global config.
     *
     * @return AgenticChatBackendClient
     */
    public function getBackendClient()
    {
        $cfg = $this->getGlobalConfig();
        return new AgenticChatBackendClient($cfg['backend_url'], $cfg['timeout']);
    }

    /**
     * Resolve (or create) the active thread for a user/section.
     *
     * @param int $userId
     * @param int $sectionId
     * @return array Thread row + linked metadata.
     */
    public function getOrCreateThread($userId, $sectionId)
    {
        $cfg = $this->getGlobalConfig();
        return $this->threadService->getOrCreateThread($userId, $sectionId, $cfg['backend_url']);
    }

    /**
     * Reset the section's thread (mark current completed, create new).
     *
     * @param int $userId
     * @param int $sectionId
     * @return array New thread row.
     */
    public function resetThread($userId, $sectionId)
    {
        $cfg = $this->getGlobalConfig();
        return $this->threadService->resetThread($userId, $sectionId, $cfg['backend_url']);
    }

    /**
     * Configure a thread on the backend by mapping a slot map to a
     * `/reflect/configure` payload. The module content is always sourced
     * from the global configuration (since plugin v1.1.0).
     *
     * @param array  $thread  Thread row from getOrCreateThread().
     * @param array  $slotMap Backend slot -> persona key mapping
     *                        (already resolved by the caller; usually
     *                        AgenticChatModel::buildBackendSlotMap()).
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    public function configureThread(array $thread, array $slotMap)
    {
        $cfg = $this->getGlobalConfig();
        $module = (string) $cfg['default_module'];

        $payload = $this->personaService->buildConfigurePayload(
            $cfg['personas'],
            $slotMap,
            $module,
            (string) $thread['agui_thread_id']
        );

        $client = $this->getBackendClient();

        $this->threadService->updateThread($thread['id'], [
            'status' => AGENTIC_CHAT_STATUS_CONFIGURING,
            'persona_slot_map' => json_encode($slotMap),
            'module_content' => $module,
        ]);

        $result = $client->configureThread($payload, $cfg['configure_path']);

        $this->threadService->updateThread(
            $thread['id'],
            $result['ok']
                ? ['status' => AGENTIC_CHAT_STATUS_IDLE]
                : ['status' => AGENTIC_CHAT_STATUS_FAILED, 'last_error' => $result['error'] ?? 'Configure failed']
        );

        return $result;
    }

    /**
     * Stream a /reflect run, forwarding raw SSE chunks to a callback while
     * accumulating TEXT_MESSAGE_CONTENT deltas per message id and writing
     * the finalised assistant text into llmMessages on TEXT_MESSAGE_END.
     *
     * AG-UI semantics implemented here:
     *
     *  - Each call generates a fresh `run_id` (UUID) and reuses the
     *    persisted `agui_thread_id` from the thread row. The backend
     *    keeps the conversation history per `thread_id`, so the upstream
     *    `messages` array carries at most one entry: the new user input
     *    for this turn (never the full history).
     *  - When the previous run finished with an `interrupt` and the
     *    client has a `$resume` payload, we send `messages: []` and put
     *    the user response inside `$resume.interrupts[i].value[…]` per
     *    https://docs.ag-ui.com/concepts/interrupts#resuming-a-run.
     *    The visible `$userMessage` (if provided) is still logged to
     *    `llmMessages` for audit but NOT echoed in upstream messages.
     *
     * @param array        $thread       Thread row.
     * @param string|null  $userMessage  Visible user input for this turn
     *                                   (null = kickoff/resume only). Used
     *                                   for `llmMessages` logging in all
     *                                   modes; only included in the
     *                                   upstream `messages` array when
     *                                   `$resume` is empty.
     * @param array|null   $resume       AG-UI resume payload (optional).
     * @param callable     $onChunk      function(string $rawChunk): bool|null
     *                                   - return false to abort.
     * @return array{ok:bool, status:int, error?:string}
     */
    public function streamRun(array $thread, $userMessage, $resume, callable $onChunk)
    {
        $cfg = $this->getGlobalConfig();
        $client = $this->getBackendClient();

        $runId = $this->threadService->generateRunId();
        $this->threadService->updateThread($thread['id'], [
            'status' => AGENTIC_CHAT_STATUS_RUNNING,
            'last_run_id' => $runId,
        ]);

        $payload = [
            'thread_id' => (string) $thread['agui_thread_id'],
            'run_id' => $runId,
            'state' => new stdClass(),
            'tools' => [],
            'context' => [],
            'forwardedProps' => new stdClass(),
            'messages' => [],
        ];

        $isResume = is_array($resume) && !empty($resume);
        $hasUserMessage = $userMessage !== null && $userMessage !== '';
        $userMessageString = $hasUserMessage ? (string) $userMessage : '';
        $isKickoff = $hasUserMessage && trim($userMessageString) === AGENTIC_CHAT_AUTO_START_TOKEN;

        if ($hasUserMessage) {
            // Resume turns put the user response inside the resume.interrupts[].value
            // payload; sending the message again in `messages` would duplicate it
            // server-side. New turns instead carry exactly one user message.
            if (!$isResume) {
                $payload['messages'][] = [
                    'id' => $this->generateLocalId(),
                    'role' => 'user',
                    'content' => $userMessageString,
                ];
            }

            // Persist the visible message into llmMessages immediately (skip the
            // silent kickoff token so it doesn't pollute the chat history).
            if (!$isKickoff) {
                $this->threadService->appendMessage(
                    (int) $thread['id_llmConversations'],
                    'user',
                    $userMessageString,
                    null
                );
            }
        }

        if ($isResume) {
            $payload['resume'] = $resume;
        }

        // Per-run scratchpad held in closure for assistant message accumulation.
        $assistantBuffers = [];
        $caseClosed = false;
        $usage = ['input' => null, 'output' => null, 'total' => null];
        $lastError = null;
        $pendingInterrupts = [];   // [{id, value}] captured from RUN_FINISHED.interrupt
        $awaitingInput = false;
        $service = $this; // avoid PHP <7.4 "$this in static closure" pitfalls
        $threadRef = $thread;
        // SSE byte buffer - cURL hands us arbitrary chunks that may split
        // mid-event ("data: {...partial..."). We keep the leftover tail
        // here so the next chunk can complete the event before parsing.
        // Without this, every event whose JSON spans a chunk boundary
        // is silently dropped (which produced garbled assistant text in
        // llmMessages, e.g. "Hello!'m glad" instead of "Hello! I'm glad").
        $sseBuffer = '';

        $sseHandler = function (string $rawChunk) use (
            &$assistantBuffers, &$caseClosed, &$usage, &$lastError,
            &$pendingInterrupts, &$awaitingInput, &$sseBuffer,
            $threadRef, $service, $onChunk
        ) {
            $continue = $onChunk($rawChunk);

            // Parse the chunk to keep llmMessages in sync. The AG-UI wire
            // protocol uses standard SSE: each event is "data: <json>\n\n".
            // parseSseChunk is stateful via $sseBuffer: it returns only
            // complete events and stores any unfinished tail back into
            // the buffer for the next call.
            $events = $service->parseSseChunk($rawChunk, $sseBuffer);
            foreach ($events as $event) {
                if (!is_array($event) || !isset($event['type'])) {
                    continue;
                }

                $type = $event['type'];
                $messageId = $event['message_id'] ?? $event['messageId'] ?? null;

                if ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_START && $messageId !== null) {
                    $assistantBuffers[(string) $messageId] = [
                        'role' => $event['role'] ?? 'assistant',
                        'author' => $event['author_name'] ?? $event['authorName'] ?? null,
                        'text' => '',
                    ];
                } elseif ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_CONTENT && $messageId !== null) {
                    if (!isset($assistantBuffers[(string) $messageId])) {
                        $assistantBuffers[(string) $messageId] = [
                            'role' => 'assistant',
                            'author' => $event['author_name'] ?? null,
                            'text' => '',
                        ];
                    }
                    $assistantBuffers[(string) $messageId]['text'] .= (string) ($event['delta'] ?? '');
                } elseif ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_END && $messageId !== null) {
                    $buffer = $assistantBuffers[(string) $messageId] ?? null;
                    if ($buffer && trim($buffer['text']) !== '' && ($buffer['role'] ?? '') !== 'user') {
                        $service->getThreadService()->appendMessage(
                            (int) $threadRef['id_llmConversations'],
                            'assistant',
                            $buffer['text'],
                            ['author' => $buffer['author'], 'message_id' => $messageId]
                        );
                        if ($service->isCaseCompleteText($buffer['text'])) {
                            $caseClosed = true;
                        }
                    }
                    unset($assistantBuffers[(string) $messageId]);
                } elseif ($type === 'RUN_FINISHED') {
                    // Capture HITL interrupts. The AG-UI workflow attaches
                    // them to the terminal RUN_FINISHED event as an array.
                    $rawInterrupts = $event['interrupt'] ?? $event['interrupts'] ?? null;
                    if (is_array($rawInterrupts)) {
                        foreach ($rawInterrupts as $interrupt) {
                            if (!is_array($interrupt) || empty($interrupt['id'])) {
                                continue;
                            }
                            $pendingInterrupts[] = [
                                'id' => (string) $interrupt['id'],
                                'value' => $interrupt['value'] ?? null,
                            ];
                        }
                        $awaitingInput = !empty($pendingInterrupts);
                    }
                } elseif ($type === AGENTIC_CHAT_EVT_RUN_ERROR) {
                    $lastError = $event['message'] ?? 'Unknown AG-UI error';
                } elseif ($type === AGENTIC_CHAT_EVT_CUSTOM
                          && (($event['name'] ?? '') === 'usage')
                          && isset($event['value']) && is_array($event['value'])) {
                    $usage['input'] = isset($event['value']['input_token_count']) ? (int) $event['value']['input_token_count'] : $usage['input'];
                    $usage['output'] = isset($event['value']['output_token_count']) ? (int) $event['value']['output_token_count'] : $usage['output'];
                    $usage['total'] = isset($event['value']['total_token_count']) ? (int) $event['value']['total_token_count'] : $usage['total'];
                }
            }

            return $continue;
        };

        $result = $client->streamRun($payload, $sseHandler, $cfg['reflect_path']);

        // Drain any final event left in the SSE buffer (e.g. a terminal
        // RUN_FINISHED that arrived without a trailing blank line).
        if ($sseBuffer !== '') {
            $sseHandler("\n\n");
        }

        // The upstream backend signals errors in TWO different ways:
        //   1. HTTP-level errors -> $result['ok'] === false
        //   2. AG-UI RUN_ERROR event in the SSE stream while the HTTP
        //      response itself was 200 OK (this is what the OpenAI
        //      `resp_*` 404 looks like from the cURL side: the upstream
        //      server returns 200, then emits "data: RUN_ERROR ...").
        // Treat both as failures so the admin threads viewer surfaces
        // the upstream error in `last_error` and the React client can
        // recover via the "Conversation lost sync" banner.
        $effectiveOk = $result['ok'] && $lastError === null;
        $effectiveError = $result['ok']
            ? $lastError
            : ($result['error'] ?? $lastError);

        $finalStatus = $effectiveOk
            ? ($caseClosed
                ? AGENTIC_CHAT_STATUS_COMPLETED
                : ($awaitingInput ? AGENTIC_CHAT_STATUS_AWAITING_INPUT : AGENTIC_CHAT_STATUS_IDLE))
            : AGENTIC_CHAT_STATUS_FAILED;

        $this->threadService->updateThread($thread['id'], array_filter([
            'status' => $finalStatus,
            'is_completed' => $caseClosed ? 1 : 0,
            'last_error' => $effectiveOk ? null : $effectiveError,
            'usage_input_tokens' => $usage['input'],
            'usage_output_tokens' => $usage['output'],
            'usage_total_tokens' => $usage['total'],
            'pending_interrupts' => $awaitingInput ? json_encode($pendingInterrupts) : json_encode([]),
        ], static function ($v) {
            return $v !== null;
        }));

        // Surface the in-stream RUN_ERROR back to the caller too, so the
        // controller can decide whether to emit a PROXY_ERROR SSE event.
        if (!$effectiveOk && !isset($result['error'])) {
            $result['ok'] = false;
            $result['error'] = $effectiveError;
        }

        return $result;
    }

    /**
     * Parse a raw SSE chunk into AG-UI events.
     *
     * The cURL stream hands us arbitrarily-sized chunks that frequently
     * split a single SSE event in the middle of its JSON payload (e.g.
     * `data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hel`). To recover
     * the dropped bytes we maintain a leftover buffer between calls -
     * `$buffer` is taken by reference, the parser appends the new chunk,
     * extracts every complete event terminated by a blank line, and
     * stores the unfinished tail back into the buffer for the next call.
     *
     * Without this stateful behaviour the persisted assistant text in
     * `llmMessages` was missing characters at every chunk boundary
     * (visible to the user as garbled spelling/grammar after a refresh).
     *
     * @param string  $rawChunk Latest bytes received from cURL.
     * @param string  $buffer   Leftover bytes from the previous chunk
     *                          (in/out). Pass `''` for the first call.
     * @return array<int, array> Decoded events that were complete after
     *                           appending `$rawChunk` to `$buffer`.
     */
    public function parseSseChunk($rawChunk, &$buffer = '')
    {
        $events = [];
        if ($rawChunk !== null && $rawChunk !== '') {
            $buffer .= (string) $rawChunk;
        }
        if ($buffer === '') {
            return $events;
        }

        // SSE separator: a blank line. We split on it and keep the trailing
        // (possibly empty) segment as the new buffer; everything before it
        // is a complete event-block.
        $parts = preg_split('/\r?\n\r?\n/', $buffer);
        $buffer = (string) array_pop($parts);

        foreach ($parts as $block) {
            if (trim($block) === '') {
                continue;
            }
            $dataLines = [];
            foreach (preg_split('/\r?\n/', $block) as $line) {
                if (strpos($line, 'data:') === 0) {
                    // Spec: optional single space after the colon.
                    $dataLines[] = ltrim(substr($line, 5), ' ');
                }
            }
            if (empty($dataLines)) {
                continue;
            }
            $payload = implode("\n", $dataLines);
            $decoded = json_decode($payload, true);
            if (is_array($decoded)) {
                $events[] = $decoded;
            }
        }
        return $events;
    }

    /**
     * Whether a piece of text ends with the AG-UI case-complete marker.
     *
     * @param string $text
     * @return bool
     */
    public function isCaseCompleteText($text)
    {
        $trimmed = strtolower(trim((string) $text));
        $marker = strtolower(AGENTIC_CHAT_CASE_COMPLETE_MARKER);
        $needleLen = strlen($marker);
        return $needleLen > 0 && substr($trimmed, -$needleLen) === $marker;
    }

    /**
     * Generate a short pseudo-id for inline messages we send to AG-UI.
     *
     * @return string
     */
    private function generateLocalId()
    {
        return 'm-' . bin2hex(random_bytes(6));
    }
}
