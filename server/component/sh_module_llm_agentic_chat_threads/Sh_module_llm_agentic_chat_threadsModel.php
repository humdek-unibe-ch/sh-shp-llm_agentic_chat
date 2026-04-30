<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . "/../../../../../component/BaseModel.php";

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

    public function __construct($services)
    {
        parent::__construct($services);
        $this->pageId = $this->db->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_THREADS);
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

        if (!empty($filters['user_id'])) {
            $where[] = 't.id_users = ?';
            $params[] = (int) $filters['user_id'];
        }
        if (!empty($filters['section_id'])) {
            $where[] = 't.id_sections = ?';
            $params[] = (int) $filters['section_id'];
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

        $messages = $this->db->query_db(
            "SELECT id, role, content, sent_context, created_at, is_validated
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

        foreach ($messages as &$m) {
            $m['sent_context_json'] = $this->decodeJson($m['sent_context'] ?? null);
        }
        unset($m);

        return [
            'thread' => $row,
            'messages' => $messages,
        ];
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
