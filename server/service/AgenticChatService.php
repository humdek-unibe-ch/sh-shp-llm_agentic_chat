<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . '/AgenticChatBackendClient.php';
require_once __DIR__ . '/AgenticChatPersonaService.php';
require_once __DIR__ . '/AgenticChatThreadService.php';
require_once __DIR__ . '/AgenticChatEventNormalizer.php';
require_once __DIR__ . '/AgenticChatTranscriptLogger.php';
require_once __DIR__ . '/AgenticChatConfigureContextService.php';
require_once __DIR__ . '/../../../sh-shp-llm/server/service/LlmMemoryConfigService.php';
require_once __DIR__ . '/../../../sh-shp-llm/server/service/LlmMemoryTriggerService.php';

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

    /** @var AgenticChatEventNormalizer */
    private $normalizer;

    /** @var AgenticChatTranscriptLogger */
    private $transcriptLogger;

    /** @var AgenticChatConfigureContextService */
    private $configureContext;

    /** @var array<string,string|null>|null Cached config from sh_module_llm_agentic_chat. */
    private $configCache;

    public function __construct($services)
    {
        $this->services = $services;
        $this->db = $services->get_db();
        $this->personaService = new AgenticChatPersonaService();
        $this->threadService = new AgenticChatThreadService($services);
        $this->normalizer = new AgenticChatEventNormalizer();
        $this->transcriptLogger = new AgenticChatTranscriptLogger();
        $this->configureContext = new AgenticChatConfigureContextService($this->db);
    }

    /** @return AgenticChatConfigureContextService */
    public function getConfigureContext()
    {
        return $this->configureContext;
    }

    /** @return AgenticChatEventNormalizer */
    public function getNormalizer()
    {
        return $this->normalizer;
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
     *               health_path:string, timeout:int,
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
     * Configure a thread on the backend.
     *
     * The caller resolves the ORDERED persona list a section uses (via
     * the section's selection + global fallback) plus the mediator
     * toggle. The service translates that into the backend's
     * `/reflect/configure` payload (`{ thread_id, module_content,
     * personas: [{name, description}], use_group_chat_mediator }`),
     * persists the participant map so attribution survives a refresh,
     * and stores the sent body once (AgenticChatConfigureContextService).
     *
     * NB: the backend's `set_thread_config()` clears the cached
     * workflow, so callers must NOT reconfigure an active thread on
     * every run (that would wipe pending interrupts). Configure is
     * called once at thread start; resets create a brand-new thread.
     *
     * @param array                            $thread          Thread row from getOrCreateThread().
     * @param array<int, array<string, mixed>> $orderedPersonas Ordered persona list
     *                                          (from `AgenticChatModel::getResolvedPersonas()`).
     * @param bool                             $useMediator     Whether to enable the group-chat mediator.
     * @param string|null                      $moduleContent   Resolved module text (section override
     *                                          or global default). When null the global default module
     *                                          from the admin page is used.
     * @param int|null                         $moduleSectionId Section whose `agentic_chat_context` is
     *                                          `$moduleContent`; null for the global default module.
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    public function configureThread(array $thread, array $orderedPersonas, $useMediator = true, $moduleContent = null, $moduleSectionId = null)
    {
        $cfg = $this->getGlobalConfig();
        $module = $moduleContent !== null && trim((string) $moduleContent) !== ''
            ? (string) $moduleContent
            : (string) $cfg['default_module'];

        $payload = $this->personaService->buildConfigurePayload(
            $orderedPersonas,
            $module,
            (string) $thread['agui_thread_id'],
            (bool) $useMediator
        );

        $client = $this->getBackendClient();

        // Persist a backend-slot -> persona-key participant map for the
        // threads viewer and the event normaliser.
        $participantMap = $this->personaService->buildParticipantMap($orderedPersonas);

        $context = [];
        try {
            $context = $this->configureContext->record(
                $payload,
                (int) $thread['id_users'],
                $moduleContent !== null && trim((string) $moduleContent) !== '' ? $moduleSectionId : null
            );
        } catch (Throwable $e) {
            // storing the context must never block the configure call; the
            // exception class only: its message can quote the module text
            error_log('[AgenticChatService::configureThread] configure context not stored: ' . get_class($e));
        }

        $this->threadService->updateThread($thread['id'], array_merge([
            'status' => AGENTIC_CHAT_STATUS_CONFIGURING,
            'persona_slot_map' => json_encode($participantMap),
            'use_group_chat_mediator' => $useMediator ? 1 : 0,
        ], $context));

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
     * Stream a /reflect run, forwarding NORMALISED AG-UI events to the
     * caller while accumulating TEXT_MESSAGE_CONTENT deltas per message
     * id and writing finalised assistant text into llmMessages on
     * TEXT_MESSAGE_END.
     *
     * The PHP service intentionally sits BETWEEN the upstream legacy
     * backend and the React chat: the backend keeps speaking its
     * snake/camel mix and singular `RUN_FINISHED.interrupt` arrays, and
     * the service rewrites every event into the strict AG-UI shape
     * before forwarding via `$onNormalisedEvent`. The original payload
     * is preserved under `_rawLegacy` for debug.
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
     * @param array        $thread              Thread row.
     * @param string|null  $userMessage         Visible user input for this turn
     *                                          (null = kickoff/resume only). Used
     *                                          for `llmMessages` logging in all
     *                                          modes; only included in the
     *                                          upstream `messages` array when
     *                                          `$resume` is empty.
     * @param array|null   $resume              Backend legacy resume payload
     *                                          (`{ interrupts: [...] }`). The
     *                                          controller is responsible for
     *                                          translating the new strict shape
     *                                          coming from the React client
     *                                          (`Array<{ interruptId, status, payload }>`)
     *                                          into this legacy shape via the
     *                                          event normaliser.
     * @param callable     $onNormalisedEvent   function(array $event): bool|null
     *                                          - receives one normalised event
     *                                            at a time (camelCase ids,
     *                                            `RUN_FINISHED.outcome`).
     *                                          - return false to abort.
     * @param array        $slotMap             Backend slot → persona key map
     *                                          (used to resolve speakers /
     *                                          interrupt source executors).
     * @param int[]        $memoryRuleIds       Memory rules of the section, run by
     *                                          closeThread() when this run ends the case.
     * @return array{ok:bool, status:int, error?:string}
     */
    public function streamRun(array $thread, $userMessage, $resume, callable $onNormalisedEvent, array $slotMap = [], array $memoryRuleIds = [])
    {
        $cfg = $this->getGlobalConfig();
        $client = $this->getBackendClient();

        $runId = $this->threadService->generateRunId();
        $this->threadService->updateThread($thread['id'], [
            'status' => AGENTIC_CHAT_STATUS_RUNNING,
            'last_run_id' => $runId,
        ]);

        // AG-UI RunAgentInput is camelCase on the wire (threadId / runId /
        // forwardedProps); see the backend README run example. The
        // /reflect/configure body is the only snake_case payload.
        $payload = [
            'threadId' => (string) $thread['agui_thread_id'],
            'runId' => $runId,
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
        $pendingInterrupts = [];   // normalised interrupts captured from RUN_FINISHED.outcome
        $awaitingInput = false;
        // SHA-1 hashes of texts already written to the transcript log by
        // TEXT_MESSAGE_END so the subsequent RUN_FINISHED.interrupt log
        // call does not duplicate the same speaker turn (the FoResTCHAT
        // backend mirrors the last assistant message inside the
        // interrupt's agent_response payload).
        $loggedTextHashes = [];
        $service = $this; // avoid PHP <7.4 "$this in static closure" pitfalls
        $threadRef = $thread;
        $normalizer = $this->normalizer;
        // SSE byte buffer - cURL hands us arbitrary chunks that may split
        // mid-event ("data: {...partial..."). We keep the leftover tail
        // here so the next chunk can complete the event before parsing.
        // Without this, every event whose JSON spans a chunk boundary
        // is silently dropped (which produced garbled assistant text in
        // llmMessages, e.g. "Hello!'m glad" instead of "Hello! I'm glad").
        $sseBuffer = '';

        $transcriptLogger = $this->transcriptLogger;
        // Heartbeat: the run touches the thread at least every half timeout,
        // so End chat can tell a live run from a lost one
        // (AgenticChatThreadService::isRunInProgress()).
        $lastBeat = time();
        $beatEvery = max(1, min(30, intdiv((int) $cfg['timeout'], 2)));
        $sseHandler = function (string $rawChunk) use (
            &$assistantBuffers, &$caseClosed, &$usage, &$lastError,
            &$pendingInterrupts, &$awaitingInput, &$sseBuffer, &$loggedTextHashes,
            &$lastBeat, $beatEvery,
            $threadRef, $service, $onNormalisedEvent, $normalizer, $slotMap,
            $transcriptLogger
        ) {
            if (time() - $lastBeat >= $beatEvery) {
                $service->getThreadService()->touchThread($threadRef['id']);
                $lastBeat = time();
            }
            // Parse the chunk into complete events. parseSseChunk is
            // stateful via $sseBuffer: it returns only complete events
            // and stores any unfinished tail back into the buffer for
            // the next call.
            $events = $service->parseSseChunk($rawChunk, $sseBuffer);

            foreach ($events as $event) {
                if (!is_array($event) || !isset($event['type'])) {
                    continue;
                }

                // Normalise BEFORE forwarding so the React side sees
                // strict AG-UI shapes only (camelCase, RUN_FINISHED.outcome,
                // structured interrupts).
                $normalised = $normalizer->normalizeEvent($event, $slotMap);
                $forwarded = $onNormalisedEvent($normalised);
                if ($forwarded === false) {
                    return false;
                }

                $type = (string) $normalised['type'];
                $messageId = $normalised['messageId'] ?? null;

                if ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_START && $messageId !== null) {
                    $assistantBuffers[(string) $messageId] = [
                        'role' => $normalised['role'] ?? 'assistant',
                        'authorName' => $normalised['authorName'] ?? null,
                        'sourceExecutorId' => $normalised['sourceExecutorId'] ?? null,
                        'authorPersonaKey' => $normalised['authorPersonaKey'] ?? null,
                        'authorSlot' => $normalised['authorSlot'] ?? null,
                        'text' => '',
                    ];
                } elseif ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_CONTENT && $messageId !== null) {
                    if (!isset($assistantBuffers[(string) $messageId])) {
                        $assistantBuffers[(string) $messageId] = [
                            'role' => 'assistant',
                            'authorName' => $normalised['authorName'] ?? null,
                            'sourceExecutorId' => $normalised['sourceExecutorId'] ?? null,
                            'authorPersonaKey' => $normalised['authorPersonaKey'] ?? null,
                            'authorSlot' => $normalised['authorSlot'] ?? null,
                            'text' => '',
                        ];
                    }
                    // Refresh speaker metadata in case the backend only
                    // names the executor on TEXT_MESSAGE_CONTENT.
                    foreach (['authorName', 'sourceExecutorId', 'authorPersonaKey', 'authorSlot'] as $k) {
                        if (empty($assistantBuffers[(string) $messageId][$k]) && !empty($normalised[$k])) {
                            $assistantBuffers[(string) $messageId][$k] = $normalised[$k];
                        }
                    }
                    $assistantBuffers[(string) $messageId]['text'] .= (string) ($normalised['delta'] ?? '');
                } elseif ($type === AGENTIC_CHAT_EVT_TEXT_MESSAGE_END && $messageId !== null) {
                    $buffer = $assistantBuffers[(string) $messageId] ?? null;
                    if ($buffer && trim($buffer['text']) !== '' && ($buffer['role'] ?? '') !== 'user') {
                        $context = [
                            'messageId'        => (string) $messageId,
                            'runId'            => $normalised['runId'] ?? ($threadRef['last_run_id'] ?? null),
                            'authorName'       => $buffer['authorName'],
                            'sourceExecutorId' => $buffer['sourceExecutorId'],
                            'authorPersonaKey' => $buffer['authorPersonaKey'],
                            'authorSlot'       => $buffer['authorSlot'],
                        ];
                        $service->getThreadService()->appendMessage(
                            (int) $threadRef['id_llmConversations'],
                            'assistant',
                            $buffer['text'],
                            $context
                        );
                        // Mirror the finalised assistant message into the
                        // per-persona transcript log so the dev/admin can
                        // copy-paste the conversation flow.
                        $transcriptLogger->logMessage(
                            $threadRef,
                            [
                                'sourceExecutorId' => $buffer['sourceExecutorId'],
                                'authorName'       => $buffer['authorName'],
                                'authorSlot'       => $buffer['authorSlot'],
                                'authorPersonaKey' => $buffer['authorPersonaKey'],
                            ],
                            $buffer['text']
                        );
                        $loggedTextHashes[sha1(trim($buffer['text']))] = true;
                        if ($service->isCaseCompleteText($buffer['text'])) {
                            $caseClosed = true;
                        }
                    }
                    unset($assistantBuffers[(string) $messageId]);
                } elseif ($type === 'RUN_FINISHED') {
                    // Read the normalised outcome envelope.
                    $outcome = $normalised['outcome'] ?? null;
                    if (is_array($outcome) && ($outcome['type'] ?? null) === 'interrupt'
                        && isset($outcome['interrupts']) && is_array($outcome['interrupts'])) {
                        foreach ($outcome['interrupts'] as $interrupt) {
                            if (!is_array($interrupt) || empty($interrupt['interruptId'])) {
                                continue;
                            }
                            $pendingInterrupts[] = $interrupt;
                            // Log interrupts only when their text was NOT
                            // already streamed via TEXT_MESSAGE_END earlier
                            // in this run. The FoResTCHAT backend always
                            // mirrors the last assistant message inside the
                            // interrupt's agent_response payload, which
                            // would otherwise produce a duplicate transcript
                            // entry for every mediator turn.
                            $interruptMessage = isset($interrupt['message']) ? (string) $interrupt['message'] : '';
                            $interruptHash = $interruptMessage !== '' ? sha1(trim($interruptMessage)) : '';
                            if ($interruptMessage !== '' && !isset($loggedTextHashes[$interruptHash])) {
                                $transcriptLogger->logInterrupt(
                                    $threadRef,
                                    [
                                        'sourceExecutorId' => $interrupt['sourceExecutorId'] ?? null,
                                        'authorName'       => $interrupt['authorName'] ?? null,
                                        'authorSlot'       => $interrupt['authorSlot'] ?? null,
                                        'authorPersonaKey' => $interrupt['authorPersonaKey'] ?? null,
                                    ],
                                    $interruptMessage
                                );
                                $loggedTextHashes[$interruptHash] = true;
                            }
                        }
                        $awaitingInput = !empty($pendingInterrupts);
                    }
                } elseif ($type === AGENTIC_CHAT_EVT_RUN_ERROR) {
                    $lastError = $normalised['message'] ?? 'Unknown AG-UI error';
                } elseif ($type === AGENTIC_CHAT_EVT_CUSTOM
                          && (($normalised['name'] ?? '') === 'usage')
                          && isset($normalised['value']) && is_array($normalised['value'])) {
                    $value = $normalised['value'];
                    $usage['input']  = isset($value['input_token_count'])  ? (int) $value['input_token_count']  : ($usage['input']  ?? null);
                    $usage['output'] = isset($value['output_token_count']) ? (int) $value['output_token_count'] : ($usage['output'] ?? null);
                    $usage['total']  = isset($value['total_token_count'])  ? (int) $value['total_token_count']  : ($usage['total']  ?? null);
                }
            }

            return null;
        };

        $rawChunkForwarder = function (string $rawChunk) use ($sseHandler) {
            return $sseHandler($rawChunk);
        };

        $result = $client->streamRun($payload, $rawChunkForwarder, $cfg['reflect_path']);

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

        // A closed case is completed by closeThread() below (same path as End chat).
        $finalStatus = $effectiveOk
            ? ($awaitingInput ? AGENTIC_CHAT_STATUS_AWAITING_INPUT : AGENTIC_CHAT_STATUS_IDLE)
            : AGENTIC_CHAT_STATUS_FAILED;

        $this->threadService->updateThread($thread['id'], array_filter([
            'status' => $finalStatus,
            'last_error' => $effectiveOk ? null : $effectiveError,
            'usage_input_tokens' => $usage['input'],
            'usage_output_tokens' => $usage['output'],
            'usage_total_tokens' => $usage['total'],
            'pending_interrupts' => $awaitingInput ? json_encode($pendingInterrupts) : json_encode([]),
        ], static function ($v) {
            return $v !== null;
        }));

        // The closing message is stored and shown even when the run errors
        // afterwards (the chat reads the marker from the text), so the case
        // is closed whenever the marker was streamed.
        if ($caseClosed) {
            $this->closeThread($thread, AGENTIC_CHAT_END_REASON_CASE_COMPLETE, $memoryRuleIds);
        }

        // Surface the in-stream RUN_ERROR back to the caller too, so the
        // controller can decide whether to emit a PROXY_ERROR SSE event.
        if (!$effectiveOk && !isset($result['error'])) {
            $result['ok'] = false;
            $result['error'] = $effectiveError;
        }

        return $result;
    }

    /**
     * End a thread. Both endings run this method: the backend wrote the
     * case-complete marker (streamRun()) or the participant clicked End chat
     * (controller action end_thread). The thread becomes completed and
     * read-only, and the section's memory rules run on the conversation.
     *
     * Only the first call for a thread does anything (the is_completed flag
     * is claimed in one UPDATE), so a thread is closed and remembered once.
     *
     * @param array  $thread        Thread row.
     * @param string $reason        AGENTIC_CHAT_END_REASON_*.
     * @param int[]  $memoryRuleIds Rules of the section field memory_rule_ids.
     * @return bool True when this call closed the thread.
     */
    public function closeThread(array $thread, $reason, array $memoryRuleIds = [])
    {
        $claimed = $this->db->execute_update_db(
            'UPDATE agenticChatThreads SET is_completed = 1 WHERE id = :id AND is_completed = 0',
            [':id' => (int) $thread['id']]
        );
        if ((int) $claimed !== 1) {
            return false;
        }
        $this->threadService->updateThread($thread['id'], [
            'status' => AGENTIC_CHAT_STATUS_COMPLETED,
            'pending_interrupts' => json_encode([]),
        ]);
        $this->scheduleEndMemory($thread, $reason, $memoryRuleIds);
        return true;
    }

    /**
     * Schedule the memory rules of a closed thread (sh-shp-llm memory source
     * `agentic_chat_end`). Runs as a scheduled job in the background, like
     * the memory rules of an llmChat form; a failure never blocks the close.
     *
     * @param array  $thread
     * @param string $reason
     * @param int[]  $memoryRuleIds
     * @return void
     */
    private function scheduleEndMemory(array $thread, $reason, array $memoryRuleIds)
    {
        if (empty($memoryRuleIds)) {
            return;
        }
        // closeThread() also runs inside the open SSE stream: debug output of
        // the job scheduler / database (DEBUG) must not reach the client.
        ob_start();
        try {
            $config = new LlmMemoryConfigService($this->services);
            if (!$config->isMemoryEnabled()) {
                return;
            }
            $trigger = new LlmMemoryTriggerService($this->services, $config);
            $sectionId = (int) ($thread['id_sections'] ?? 0);
            $conversationId = (int) $thread['id_llmConversations'];
            $transcript = $this->buildTranscript($conversationId);
            if (!in_array('User', array_column($transcript['turns'], 'speaker'), true)) {
                return; // the participant wrote nothing: nothing to remember
            }
            $payload = $trigger->normalizeSourcePayload(
                AGENTIC_CHAT_MEMORY_SOURCE,
                // identifies the conversation: its memory is updated once
                [
                    'section_id' => $sectionId,
                    'conversation_id' => $conversationId,
                    'thread_id' => (string) $thread['agui_thread_id'],
                ],
                [
                    'section_id' => $sectionId,
                    'conversation_id' => $conversationId,
                    'end_reason' => (string) $reason,
                    'transcript' => $transcript['turns'],
                ],
                (int) $thread['id_users'],
                $transcript['text']
            );
            $trigger->scheduleRuleJob(
                $memoryRuleIds,
                $payload,
                true,
                'LLM Memory Update (agentic chat section ' . $sectionId . ')'
            );
        } catch (Throwable $e) {
            // the exception class only: its message can quote the conversation
            error_log('[AgenticChatService::closeThread] memory update not scheduled: ' . get_class($e));
        } finally {
            ob_end_clean();
        }
    }

    /**
     * The visible conversation for the memory rules: every user and
     * assistant message in order, the assistant ones with the persona name
     * (the kickoff token is left out).
     *
     * @param int $conversationId
     * @return array{turns: array<int, array{speaker:string, text:string}>, text:string}
     */
    private function buildTranscript($conversationId)
    {
        $names = [AGENTIC_CHAT_MEDIATOR_KEY => AGENTIC_CHAT_MEDIATOR_NAME];
        foreach ($this->getGlobalConfig()['personas'] as $persona) {
            if (!empty($persona['key']) && !empty($persona['name'])) {
                $names[(string) $persona['key']] = (string) $persona['name'];
            }
        }

        $rows = $this->db->query_db(
            "SELECT role, content, sent_context FROM llmMessages
              WHERE id_llmConversations = :id AND deleted = 0 AND role IN ('user', 'assistant')
           ORDER BY id ASC",
            [':id' => (int) $conversationId]
        ) ?: [];

        $turns = [];
        $lines = [];
        foreach ($rows as $row) {
            $text = trim((string) $row['content']);
            if ($text === '' || $text === AGENTIC_CHAT_AUTO_START_TOKEN) {
                continue;
            }
            $speaker = 'User';
            if ($row['role'] === 'assistant') {
                $context = json_decode((string) ($row['sent_context'] ?? ''), true);
                $key = is_array($context) ? (string) ($context['authorPersonaKey'] ?? '') : '';
                $speaker = $names[$key]
                    ?? (is_array($context) && !empty($context['authorName']) ? (string) $context['authorName'] : 'Assistant');
            }
            $turns[] = ['speaker' => $speaker, 'text' => $text];
            $lines[] = $speaker . ': ' . $text;
        }
        return ['turns' => $turns, 'text' => implode("\n\n", $lines)];
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
