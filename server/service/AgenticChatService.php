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
     * Configure a thread on the backend by mapping the section's slot map
     * + module content to a /reflect/configure payload.
     *
     * @param array  $thread        Thread row from getOrCreateThread().
     * @param array  $slotMap       Slot -> persona key mapping (decoded JSON).
     * @param string $moduleContent Section module text (or empty to use the global default).
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    public function configureThread(array $thread, array $slotMap, $moduleContent)
    {
        $cfg = $this->getGlobalConfig();
        $module = $moduleContent !== '' ? (string) $moduleContent : (string) $cfg['default_module'];

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
     * @param array        $thread       Thread row.
     * @param string|null  $userMessage  User input for this turn (null = resume / kickoff only).
     * @param array|null   $resume       AG-UI resume payload (optional).
     * @param callable     $onChunk      function(string $rawChunk): bool|null - return false to abort.
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

        if ($userMessage !== null && $userMessage !== '') {
            $messageId = $this->generateLocalId();
            $payload['messages'][] = [
                'id' => $messageId,
                'role' => 'user',
                'content' => (string) $userMessage,
            ];

            // Persist visible user message immediately (we never need to
            // wait for a backend confirmation - the user did type it).
            // Skip the auto-start kickoff token from the visible log.
            if (trim((string) $userMessage) !== AGENTIC_CHAT_AUTO_START_TOKEN) {
                $this->threadService->appendMessage(
                    (int) $thread['id_llmConversations'],
                    'user',
                    (string) $userMessage,
                    null
                );
            }
        }

        if (is_array($resume) && !empty($resume)) {
            $payload['resume'] = $resume;
        }

        // Per-run scratchpad held in closure for assistant message accumulation.
        $assistantBuffers = [];
        $caseClosed = false;
        $usage = ['input' => null, 'output' => null, 'total' => null];
        $lastError = null;
        $service = $this; // avoid PHP <7.4 "$this in static closure" pitfalls
        $threadRef = $thread;

        $sseHandler = function (string $rawChunk) use (
            &$assistantBuffers, &$caseClosed, &$usage, &$lastError, $threadRef, $service, $onChunk
        ) {
            $continue = $onChunk($rawChunk);

            // Parse the chunk to keep llmMessages in sync. The AG-UI wire
            // protocol uses standard SSE: each event is "data: <json>\n\n".
            $events = $service->parseSseChunk($rawChunk);
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

        $this->threadService->updateThread($thread['id'], array_filter([
            'status' => $result['ok']
                ? ($caseClosed ? AGENTIC_CHAT_STATUS_COMPLETED : AGENTIC_CHAT_STATUS_IDLE)
                : AGENTIC_CHAT_STATUS_FAILED,
            'is_completed' => $caseClosed ? 1 : 0,
            'last_error' => $result['ok'] ? null : ($result['error'] ?? $lastError),
            'usage_input_tokens' => $usage['input'],
            'usage_output_tokens' => $usage['output'],
            'usage_total_tokens' => $usage['total'],
        ], static function ($v) {
            return $v !== null;
        }));

        return $result;
    }

    /**
     * Parse a raw SSE chunk into AG-UI events.
     * Public so the streaming callback can reuse it without binding $this.
     *
     * @param string $rawChunk One or more "data: ...\n\n" SSE blocks.
     * @return array<int, array> Decoded events.
     */
    public function parseSseChunk($rawChunk)
    {
        $events = [];
        if ($rawChunk === '' || $rawChunk === null) {
            return $events;
        }

        // SSE blocks separated by blank lines.
        $blocks = preg_split('/\r?\n\r?\n/', (string) $rawChunk);
        foreach ($blocks as $block) {
            if (trim($block) === '') {
                continue;
            }
            $dataLines = [];
            foreach (preg_split('/\r?\n/', $block) as $line) {
                if (strpos($line, 'data:') === 0) {
                    $dataLines[] = ltrim(substr($line, 5));
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
