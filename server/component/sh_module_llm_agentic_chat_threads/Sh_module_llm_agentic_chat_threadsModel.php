<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . "/../../../../../component/BaseModel.php";
require_once __DIR__ . "/../../service/AgenticChatService.php";

/**
 * Model for the LLM Agentic Chat Threads admin module.
 *
 * Exposes a paginated, filterable list of agenticChatThreads rows along
 * with the linked llmConversations/llmMessages payload so admins can
 * inspect AG-UI thread state and recent debug events.
 */
class Sh_module_llm_agentic_chat_threadsModel extends BaseModel
{
    /** @var int|null Page id of the threads admin page. */
    private $pageId;

    /** @var AgenticChatService|null Lazy orchestrator for global config + payload helpers. */
    private $agenticService;

    public function __construct($services)
    {
        parent::__construct($services);
        $this->pageId = $this->db->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_THREADS);
    }

    /**
     * Lazy access to the agentic chat orchestrator. Used to derive the
     * "playground" payloads (configure body, run-payload template) shown
     * in the threads viewer's Debug tab so admins can copy them straight
     * into Postman / curl.
     *
     * @return AgenticChatService
     */
    private function getAgenticService()
    {
        if ($this->agenticService === null) {
            $this->agenticService = new AgenticChatService($this->services);
        }
        return $this->agenticService;
    }

    /**
     * @return int|null Page id of the threads admin page.
     */
    public function getPageId()
    {
        return $this->pageId;
    }

    /**
     * Paginated list of threads with primary metadata.
     *
     * @param array $filters {user_id?:int, section_id?:int, status?:string, query?:string}
     * @param int   $page    1-indexed page number.
     * @param int   $perPage Page size (capped at 100).
     * @return array{rows:array, total:int, page:int, per_page:int, pages:int}
     */
    public function listThreads(array $filters = [], $page = 1, $perPage = 25)
    {
        $perPage = max(1, min(100, (int) $perPage));
        $page = max(1, (int) $page);
        $offset = ($page - 1) * $perPage;

        $where = ['c.deleted = 0'];
        $params = [];

        // user_id may be a single int or an array of ints (multi-select).
        $userIds = $this->normalizeIdList($filters['user_id'] ?? null);
        if (!empty($userIds)) {
            $placeholders = implode(',', array_fill(0, count($userIds), '?'));
            $where[] = "t.id_users IN ($placeholders)";
            foreach ($userIds as $id) {
                $params[] = $id;
            }
        }

        // section_id may be a single int or an array of ints (multi-select).
        $sectionIds = $this->normalizeIdList($filters['section_id'] ?? null);
        if (!empty($sectionIds)) {
            $placeholders = implode(',', array_fill(0, count($sectionIds), '?'));
            $where[] = "t.id_sections IN ($placeholders)";
            foreach ($sectionIds as $id) {
                $params[] = $id;
            }
        }

        if (!empty($filters['status'])) {
            $where[] = 't.status = ?';
            $params[] = (string) $filters['status'];
        }
        if (!empty($filters['query'])) {
            $where[] = '(t.agui_thread_id LIKE ? OR c.title LIKE ? OR u.email LIKE ?)';
            $like = '%' . $filters['query'] . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $countSql = "SELECT COUNT(*) AS total
                       FROM agenticChatThreads t
                  LEFT JOIN llmConversations c ON c.id = t.id_llmConversations
                  LEFT JOIN users u ON u.id = t.id_users
                       $whereSql";
        $totalRow = $this->db->query_db_first($countSql, $params);
        $total = (int) ($totalRow['total'] ?? 0);

        $rowsSql = "SELECT
                        t.id,
                        t.id_llmConversations,
                        t.id_users,
                        t.id_sections,
                        t.agui_thread_id,
                        t.last_run_id,
                        t.backend_url,
                        t.status,
                        t.is_completed,
                        t.last_error,
                        t.usage_total_tokens,
                        t.usage_input_tokens,
                        t.usage_output_tokens,
                        t.created_at,
                        t.updated_at,
                        c.title AS conversation_title,
                        u.email AS user_email,
                        u.name  AS user_name,
                        (SELECT COUNT(*) FROM llmMessages m WHERE m.id_llmConversations = t.id_llmConversations AND m.deleted = 0) AS message_count
                   FROM agenticChatThreads t
              LEFT JOIN llmConversations c ON c.id = t.id_llmConversations
              LEFT JOIN users u ON u.id = t.id_users
                   $whereSql
               ORDER BY t.updated_at DESC, t.id DESC
                  LIMIT $perPage OFFSET $offset";

        $rows = $this->db->query_db($rowsSql, $params) ?: [];

        return [
            'rows' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'pages' => (int) ceil($total / $perPage),
        ];
    }

    /**
     * Detailed payload for a single thread: thread row, recent messages,
     * and debug events.
     *
     * @param int $threadId
     * @param int $messageLimit Maximum visible messages to return.
     * @return array|null
     */
    public function getThreadDetail($threadId, $messageLimit = 200)
    {
        $threadId = (int) $threadId;
        $messageLimit = max(1, min(500, (int) $messageLimit));
        if ($threadId <= 0) {
            return null;
        }

        $row = $this->db->query_db_first(
            "SELECT t.*,
                    c.title AS conversation_title,
                    c.created_at AS conversation_created_at,
                    c.updated_at AS conversation_updated_at,
                    u.email AS user_email,
                    u.name  AS user_name
               FROM agenticChatThreads t
          LEFT JOIN llmConversations c ON c.id = t.id_llmConversations
          LEFT JOIN users u ON u.id = t.id_users
              WHERE t.id = ?",
            [$threadId]
        );
        if (!$row) {
            return null;
        }

        // NB: `llmMessages` exposes its row time as `timestamp` (not
        // `created_at`); the threads viewer presents it under the canonical
        // `created_at` alias for symmetry with conversations/threads rows.
        $messages = $this->db->query_db(
            "SELECT id, role, content, sent_context, `timestamp` AS created_at, is_validated
               FROM llmMessages
              WHERE id_llmConversations = ? AND deleted = 0
           ORDER BY id ASC
              LIMIT $messageLimit",
            [$row['id_llmConversations']]
        ) ?: [];

        // Decode JSON columns defensively.
        $row['persona_slot_map_json'] = $this->decodeJson($row['persona_slot_map'] ?? null);
        $row['pending_interrupts_json'] = $this->decodeJson($row['pending_interrupts'] ?? null);
        $row['debug_meta_json'] = $this->decodeJson($row['debug_meta'] ?? null);

        // Resolve a friendly author label per message so the viewer shows
        // the persona who actually spoke ("Mediator", "Lea", …) instead of
        // the raw llmMessages role ("assistant"). Resolution happens at read
        // time from the persisted sent_context + the thread's participant map
        // + the global persona library, so existing threads are fixed
        // retroactively without a data migration.
        $participantMap = is_array($row['persona_slot_map_json'] ?? null)
            ? $row['persona_slot_map_json']
            : [];
        $nameByKey = $this->buildPersonaNameMap();

        foreach ($messages as &$m) {
            $m['sent_context_json'] = $this->decodeJson($m['sent_context'] ?? null);
            $m['author_label'] = $this->resolveMessageAuthor($m, $nameByKey, $participantMap);
        }
        unset($m);

        return [
            'thread' => $row,
            'messages' => $messages,
            'playground' => $this->buildPlaygroundPayloads($row),
        ];
    }

    /**
     * Build a persona key -> display name map from the global persona
     * library plus the fixed mediator descriptor. Used to label thread
     * messages with the persona who actually spoke.
     *
     * @return array<string,string>
     */
    private function buildPersonaNameMap()
    {
        $map = [AGENTIC_CHAT_MEDIATOR_KEY => AGENTIC_CHAT_MEDIATOR_NAME];
        $cfg = $this->getAgenticService()->getGlobalConfig();
        $personas = is_array($cfg['personas'] ?? null) ? $cfg['personas'] : [];
        foreach ($personas as $persona) {
            $key = isset($persona['key']) ? (string) $persona['key'] : '';
            $name = isset($persona['name']) ? trim((string) $persona['name']) : '';
            if ($key !== '' && $name !== '') {
                $map[$key] = $name;
            }
        }
        return $map;
    }

    /**
     * Resolve the display name of a message author from its persisted
     * speaker metadata. Falls back through persona key -> participant-map
     * slot -> humanised executor id -> capitalised role, so the viewer
     * always shows the most specific label available.
     *
     * @param array                $message        llmMessages row (+ sent_context_json).
     * @param array<string,string> $nameByKey      persona key -> display name.
     * @param array<string,string> $participantMap slot -> persona key.
     * @return string
     */
    private function resolveMessageAuthor(array $message, array $nameByKey, array $participantMap)
    {
        $role = strtolower((string) ($message['role'] ?? ''));
        if ($role === 'user') {
            return 'User';
        }
        if ($role === 'system') {
            return 'System';
        }

        $ctx = is_array($message['sent_context_json'] ?? null)
            ? $message['sent_context_json']
            : [];

        // 1) Resolved persona key (set by the event normaliser at stream time).
        $key = isset($ctx['authorPersonaKey']) ? (string) $ctx['authorPersonaKey'] : '';
        if ($key !== '' && isset($nameByKey[$key])) {
            return $nameByKey[$key];
        }

        // 2) Backend slot (mediator / persona_N) -> participant map -> key.
        $slot = isset($ctx['authorSlot']) ? (string) $ctx['authorSlot'] : '';
        if ($slot !== '') {
            if ($slot === AGENTIC_CHAT_SLOT_MEDIATOR && isset($nameByKey[AGENTIC_CHAT_MEDIATOR_KEY])) {
                return $nameByKey[AGENTIC_CHAT_MEDIATOR_KEY];
            }
            $slotKey = isset($participantMap[$slot]) ? (string) $participantMap[$slot] : '';
            if ($slotKey !== '' && isset($nameByKey[$slotKey])) {
                return $nameByKey[$slotKey];
            }
        }

        // 3) Raw author name / executor id -> humanise.
        foreach (['authorName', 'sourceExecutorId'] as $field) {
            $raw = isset($ctx[$field]) ? trim((string) $ctx[$field]) : '';
            if ($raw !== '') {
                $label = $this->humanizeExecutorId($raw, $nameByKey, $participantMap);
                if ($label !== '') {
                    return $label;
                }
            }
        }

        // 4) Last resort: capitalised role.
        return $role !== '' ? ucfirst($role) : 'Assistant';
    }

    /**
     * Convert a backend executor id into a friendly label:
     *   group_chat_mediator -> Mediator (via persona map)
     *   persona_2_teacher   -> the 2nd persona's name (or "Teacher 2")
     *   anything else       -> Title Cased words
     *
     * @param string               $raw
     * @param array<string,string> $nameByKey
     * @param array<string,string> $participantMap
     * @return string
     */
    private function humanizeExecutorId($raw, array $nameByKey, array $participantMap)
    {
        // *_mediator -> the mediator slot.
        if (strpos($raw, 'mediator') !== false) {
            return $nameByKey[AGENTIC_CHAT_MEDIATOR_KEY] ?? 'Mediator';
        }
        // persona_<N>_teacher / persona_<N> -> positional slot.
        if (preg_match('/^persona_(\d+)(?:_.*)?$/', $raw, $m)) {
            $slot = AGENTIC_CHAT_PERSONA_SLOT_PREFIX . $m[1];
            $key = isset($participantMap[$slot]) ? (string) $participantMap[$slot] : '';
            if ($key !== '' && isset($nameByKey[$key])) {
                return $nameByKey[$key];
            }
            return 'Teacher ' . $m[1];
        }
        // Generic slug -> Title Case (skip when it's just a UUID-ish blob).
        $clean = trim(preg_replace('/[_\-]+/', ' ', $raw));
        if ($clean === '' || $clean === $raw && preg_match('/^[0-9a-f]{8,}$/i', $raw)) {
            return '';
        }
        return ucwords($clean);
    }

    /**
     * Build the developer "playground" payloads attached to a thread detail
     * response. Provides everything needed to reproduce a thread from the
     * outside (Postman, curl, …) without having to re-derive it manually.
     *
     * The shape is:
     * ```
     *   {
     *     backend: { base_url, configure_url, reflect_url, configure_path, reflect_path },
     *     configure: { method, url, body },        // /reflect/configure body
     *     run: {                                    // template for /reflect calls
     *       method, url,
     *       body_template,                         // payload skeleton
     *       last_user_message: string|null,        // most recent user input
     *       run_id_placeholder: string,            // value used in body_template.run_id
     *     }
     *   }
     * ```
     *
     * @param array $thread Thread row already augmented with decoded JSON cols.
     * @return array
     */
    private function buildPlaygroundPayloads(array $thread)
    {
        $cfg = $this->getAgenticService()->getGlobalConfig();
        $personaService = $this->getAgenticService()->getPersonaService();

        // Prefer the per-thread snapshot of the participant map so the
        // configure payload reflects what was actually sent at
        // thread-init time (slot -> persona key, e.g. persona_1 -> lea).
        $participantMap = is_array($thread['persona_slot_map_json'] ?? null)
            ? $thread['persona_slot_map_json']
            : [];

        // Same for module content - the row column captures what was sent.
        $moduleContent = (string) ($thread['module_content']
            ?? $cfg['default_module']
            ?? '');

        // The thread froze its mediator choice at configure time.
        $useMediator = !isset($thread['use_group_chat_mediator'])
            || (int) $thread['use_group_chat_mediator'] === 1;

        $threadId = (string) ($thread['agui_thread_id'] ?? '');
        $backendUrl = rtrim((string) ($thread['backend_url']
            ?? $cfg['backend_url']
            ?? ''), '/');
        $configurePath = (string) $cfg['configure_path'];
        $reflectPath = (string) $cfg['reflect_path'];

        // Rebuild the ordered persona list from the participant map +
        // the global library, so the configure body matches the backend
        // contract ({ thread_id, module_content, personas:[{name,
        // description}], use_group_chat_mediator }).
        $orderedPersonas = $this->orderedPersonasFromParticipantMap(
            $participantMap,
            is_array($cfg['personas'] ?? null) ? $cfg['personas'] : []
        );

        $configureBody = $personaService->buildConfigurePayload(
            $orderedPersonas,
            $moduleContent,
            $threadId,
            $useMediator
        );

        // Most recent USER message is the natural "send this again" example
        // we surface in the Debug tab. Per-message buttons populate
        // `messages[0].content` with the chosen message client-side.
        $lastUser = null;
        $messages = $this->db->query_db(
            "SELECT content FROM llmMessages
              WHERE id_llmConversations = ? AND deleted = 0 AND role = 'user'
           ORDER BY id DESC LIMIT 1",
            [$thread['id_llmConversations']]
        );
        if (is_array($messages) && !empty($messages)) {
            $lastUser = (string) ($messages[0]['content'] ?? '');
        }

        // AG-UI RunAgentInput is camelCase on the wire (threadId / runId).
        $runIdPlaceholder = '<generate-uuid-here>';
        $runBodyTemplate = [
            'threadId' => $threadId,
            'runId' => $runIdPlaceholder,
            'state' => new stdClass(),
            'tools' => [],
            'context' => [],
            'forwardedProps' => new stdClass(),
            'messages' => [
                [
                    'id' => '<message-uuid>',
                    'role' => 'user',
                    'content' => $lastUser ?? '<your user message here>',
                ],
            ],
        ];

        return [
            'backend' => [
                'base_url' => $backendUrl,
                'configure_path' => $configurePath,
                'reflect_path' => $reflectPath,
                'configure_url' => $backendUrl . $configurePath,
                'reflect_url' => $backendUrl . $reflectPath,
            ],
            'configure' => [
                'method' => 'POST',
                'url' => $backendUrl . $configurePath,
                'body' => $configureBody,
            ],
            'run' => [
                'method' => 'POST',
                'url' => $backendUrl . $reflectPath,
                'body_template' => $runBodyTemplate,
                'last_user_message' => $lastUser,
                'run_id_placeholder' => $runIdPlaceholder,
            ],
        ];
    }

    /**
     * Rebuild the ordered persona list a thread was configured with from
     * its persisted participant map (slot -> persona key) and the global
     * persona library. Slots are visited in positional order
     * (persona_1, persona_2, …); the mediator slot is skipped.
     *
     * Unknown keys (e.g. the persona was deleted from the library after
     * the thread was configured) degrade to a minimal `{name}` descriptor
     * so the playground configure body still resembles what was sent.
     *
     * @param array<string,string>            $participantMap slot -> persona key.
     * @param array<int,array<string,mixed>>  $globalPersonas Global library.
     * @return array<int,array<string,mixed>> Ordered persona objects.
     */
    private function orderedPersonasFromParticipantMap(array $participantMap, array $globalPersonas)
    {
        $byKey = [];
        foreach ($globalPersonas as $persona) {
            if (isset($persona['key'])) {
                $byKey[(string) $persona['key']] = $persona;
            }
        }

        // Collect persona_<N> slots and sort by N so the order matches
        // what was sent to /reflect/configure.
        $slots = [];
        foreach ($participantMap as $slot => $key) {
            if (preg_match('/^persona_(\d+)$/', (string) $slot, $m)) {
                $slots[(int) $m[1]] = (string) $key;
            }
        }
        ksort($slots);

        $ordered = [];
        foreach ($slots as $key) {
            if ($key === '' || $key === AGENTIC_CHAT_MEDIATOR_KEY) {
                continue;
            }
            if (isset($byKey[$key])) {
                $ordered[] = $byKey[$key];
            } else {
                $ordered[] = ['key' => $key, 'name' => $key, 'description' => ''];
            }
        }
        return $ordered;
    }

    /**
     * Distinct status values currently present in agenticChatThreads, useful
     * to populate the status filter dropdown without round-trips to lookups.
     *
     * @return array<int,string>
     */
    public function getDistinctStatuses()
    {
        $rows = $this->db->query_db(
            "SELECT DISTINCT status FROM agenticChatThreads ORDER BY status"
        ) ?: [];
        return array_map(static function ($r) {
            return (string) ($r['status'] ?? '');
        }, $rows);
    }

    /**
     * Aggregate counters for the dashboard banner.
     *
     * @return array{total:int, idle:int, running:int, awaiting_input:int, completed:int, failed:int}
     */
    public function getCounters()
    {
        $row = $this->db->query_db_first(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) AS idle,
                SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
                SUM(CASE WHEN status = 'awaiting_input' THEN 1 ELSE 0 END) AS awaiting_input,
                SUM(CASE WHEN status = 'completed' OR is_completed = 1 THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
               FROM agenticChatThreads"
        );
        if (!is_array($row)) {
            return [
                'total' => 0, 'idle' => 0, 'running' => 0,
                'awaiting_input' => 0, 'completed' => 0, 'failed' => 0,
            ];
        }
        return [
            'total' => (int) ($row['total'] ?? 0),
            'idle' => (int) ($row['idle'] ?? 0),
            'running' => (int) ($row['running'] ?? 0),
            'awaiting_input' => (int) ($row['awaiting_input'] ?? 0),
            'completed' => (int) ($row['completed'] ?? 0),
            'failed' => (int) ($row['failed'] ?? 0),
        ];
    }

    /**
     * Build the user / section drop-down option lists for the threads
     * viewer's multi-select filters. Mirrors the lookup pattern used by
     * `sh-shp-llm`'s admin console so the two surfaces feel the same.
     *
     * Only entities that already have at least one agentic chat thread are
     * returned, keeping the dropdowns focused and short.
     *
     * @return array{
     *   users: array<int, array{id:int, name:string, email:string|null, label:string}>,
     *   sections: array<int, array{id:int, name:string, label:string}>
     * }
     */
    public function getFilterOptions()
    {
        $users = $this->db->query_db(
            "SELECT DISTINCT u.id, u.name, u.email
               FROM agenticChatThreads t
               JOIN users u ON u.id = t.id_users
              ORDER BY u.name, u.email"
        ) ?: [];
        $userOptions = array_map(static function ($row) {
            $id = (int) $row['id'];
            $name = trim((string) ($row['name'] ?? ''));
            $email = trim((string) ($row['email'] ?? ''));
            $labelParts = array_filter([$name !== '' ? $name : null, $email !== '' ? "($email)" : null]);
            return [
                'id' => $id,
                'name' => $name,
                'email' => $email !== '' ? $email : null,
                'label' => $labelParts ? implode(' ', $labelParts) : ('User ' . $id),
            ];
        }, $users);

        $sections = $this->db->query_db(
            "SELECT DISTINCT s.id, s.name
               FROM agenticChatThreads t
               JOIN sections s ON s.id = t.id_sections
              WHERE t.id_sections IS NOT NULL
              ORDER BY s.name"
        ) ?: [];
        $sectionOptions = array_map(static function ($row) {
            $id = (int) $row['id'];
            $name = trim((string) ($row['name'] ?? ''));
            return [
                'id' => $id,
                'name' => $name !== '' ? $name : ('Section ' . $id),
                'label' => $name !== '' ? $name : ('Section ' . $id),
            ];
        }, $sections);

        return [
            'users' => $userOptions,
            'sections' => $sectionOptions,
        ];
    }

    /**
     * Coerce a request filter value into a list of positive integer ids.
     *
     * Accepts:
     *   - a comma-separated string (eg. "1,2,3")
     *   - an array of strings/ints (eg. ["1","2"])
     *   - a single scalar (eg. 5)
     *   - null / empty → []
     *
     * @param mixed $raw
     * @return array<int, int> Deduplicated, positive integer ids.
     */
    private function normalizeIdList($raw)
    {
        if ($raw === null || $raw === '' || $raw === false) {
            return [];
        }
        $candidates = is_array($raw) ? $raw : explode(',', (string) $raw);
        $ids = [];
        foreach ($candidates as $candidate) {
            $value = (int) $candidate;
            if ($value > 0 && !in_array($value, $ids, true)) {
                $ids[] = $value;
            }
        }
        return $ids;
    }

    /**
     * Decode a JSON column value safely. Returns null when blank or invalid.
     *
     * @param mixed $value
     * @return mixed|null
     */
    private function decodeJson($value)
    {
        if ($value === null || $value === '') {
            return null;
        }
        $decoded = json_decode((string) $value, true);
        return ($decoded === null && json_last_error() !== JSON_ERROR_NONE) ? null : $decoded;
    }
}
