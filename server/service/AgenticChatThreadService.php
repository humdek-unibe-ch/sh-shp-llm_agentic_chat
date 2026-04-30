<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Storage helper for the agenticChatThreads table.
 *
 * Bridges the base sh-shp-llm storage (llmConversations / llmMessages)
 * with the AG-UI metadata stored in this plugin's `agenticChatThreads`
 * table. Each row links exactly one llmConversations row to a stable
 * AG-UI thread id.
 *
 * Visible message text is written to `llmMessages` (so admin tooling in
 * sh-shp-llm continues to work). AG-UI specifics (run id, raw events,
 * tool calls, …) live in the `sent_context` JSON column or here.
 */
class AgenticChatThreadService
{
    /** @var object SelfHelp services container. */
    private $services;

    /** @var object PageDb instance. */
    private $db;

    public function __construct($services)
    {
        $this->services = $services;
        $this->db = $services->get_db();
    }

    /**
     * Find or create a conversation/thread row for the given user/section.
     *
     * @param int    $userId
     * @param int    $sectionId
     * @param string $backendUrl Backend base URL stored on the row.
     * @param string $aguiThreadId Existing AG-UI thread id (or empty to generate one).
     * @return array Thread row joined with the linked conversation columns.
     */
    public function getOrCreateThread($userId, $sectionId, $backendUrl, $aguiThreadId = '')
    {
        $existing = $this->getActiveThreadForUser($userId, $sectionId);
        if ($existing !== null) {
            return $existing;
        }

        $aguiThreadId = $aguiThreadId !== '' ? $aguiThreadId : $this->generateThreadId();

        $this->db->begin_transaction();
        try {
            $conversationId = $this->createConversationRow($userId, $sectionId);

            $this->db->insert('agenticChatThreads', [
                'id_llmConversations' => $conversationId,
                'id_users' => $userId,
                'id_sections' => $sectionId,
                'agui_thread_id' => $aguiThreadId,
                'backend_url' => $backendUrl,
                'status' => AGENTIC_CHAT_STATUS_IDLE,
                'is_completed' => 0,
            ]);

            $this->logTransaction('insert', $conversationId, $userId,
                "Created agenticChat thread {$aguiThreadId}");

            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollback();
            throw $e;
        }

        return $this->getThreadByConversationId($conversationId);
    }

    /**
     * Reset the current thread for a user/section by marking it completed
     * and creating a new one. Returns the new thread row.
     *
     * @param int    $userId
     * @param int    $sectionId
     * @param string $backendUrl
     * @return array
     */
    public function resetThread($userId, $sectionId, $backendUrl)
    {
        $existing = $this->getActiveThreadForUser($userId, $sectionId);
        if ($existing !== null) {
            $this->db->update_by_ids('agenticChatThreads', [
                'status' => AGENTIC_CHAT_STATUS_COMPLETED,
                'is_completed' => 1,
            ], ['id' => $existing['id']]);
        }

        return $this->getOrCreateThread($userId, $sectionId, $backendUrl);
    }

    /**
     * Return the most recent non-completed thread for the user/section, or
     * null if none.
     *
     * @param int $userId
     * @param int $sectionId
     * @return array|null
     */
    public function getActiveThreadForUser($userId, $sectionId)
    {
        $row = $this->db->query_db_first(
            "SELECT t.*, c.title AS conversation_title, c.created_at AS conversation_created_at
               FROM agenticChatThreads t
          INNER JOIN llmConversations c ON c.id = t.id_llmConversations
              WHERE t.id_users = :id_users
                AND t.id_sections = :id_sections
                AND t.is_completed = 0
                AND c.deleted = 0
           ORDER BY t.id DESC
              LIMIT 1",
            [
                'id_users' => $userId,
                'id_sections' => $sectionId,
            ]
        );
        return $row ?: null;
    }

    /**
     * Look up a thread by its primary key.
     *
     * @param int $threadId
     * @return array|null
     */
    public function getThreadById($threadId)
    {
        $row = $this->db->query_db_first(
            "SELECT * FROM agenticChatThreads WHERE id = ?",
            [$threadId]
        );
        return $row ?: null;
    }

    /**
     * Look up a thread by the conversation id (1:1 relation).
     *
     * @param int $conversationId
     * @return array|null
     */
    public function getThreadByConversationId($conversationId)
    {
        $row = $this->db->query_db_first(
            "SELECT * FROM agenticChatThreads WHERE id_llmConversations = ?",
            [$conversationId]
        );
        return $row ?: null;
    }

    /**
     * Persist updates to an existing thread row (status, run id, …).
     *
     * @param int   $threadId
     * @param array $fields Subset of columns to update.
     * @return void
     */
    public function updateThread($threadId, array $fields)
    {
        if (empty($fields)) {
            return;
        }
        $allowed = [
            'last_run_id',
            'persona_slot_map',
            'module_content',
            'pending_interrupts',
            'status',
            'is_completed',
            'last_error',
            'usage_total_tokens',
            'usage_input_tokens',
            'usage_output_tokens',
            'debug_meta',
        ];
        $clean = array_intersect_key($fields, array_flip($allowed));
        if (empty($clean)) {
            return;
        }
        $this->db->update_by_ids('agenticChatThreads', $clean, ['id' => $threadId]);
    }

    /**
     * Append a visible message (user or assistant) to the conversation.
     * Stores AG-UI metadata in the `sent_context` JSON column for later
     * inspection without disturbing the regular message-list view in the
     * sh-shp-llm admin console.
     *
     * @param int         $conversationId
     * @param string      $role
     * @param string      $content
     * @param array|null  $aguiContext  AG-UI metadata snapshot to persist.
     * @return int New message id.
     */
    public function appendMessage($conversationId, $role, $content, $aguiContext = null)
    {
        $data = [
            'id_llmConversations' => $conversationId,
            'role' => $role,
            'content' => $content,
            'sent_context' => $aguiContext !== null ? json_encode($aguiContext) : null,
            'is_validated' => 1,
        ];
        $messageId = $this->db->insert('llmMessages', $data);

        $this->db->update_by_ids('llmConversations',
            ['updated_at' => date('Y-m-d H:i:s')],
            ['id' => $conversationId]
        );

        return $messageId;
    }

    /**
     * Append a debug event to the thread's debug_meta bag (best effort).
     *
     * @param int   $threadId
     * @param array $event
     * @return void
     */
    public function appendDebugEvent($threadId, array $event)
    {
        $thread = $this->getThreadById($threadId);
        if (!$thread) {
            return;
        }

        $existing = !empty($thread['debug_meta']) ? json_decode((string) $thread['debug_meta'], true) : null;
        if (!is_array($existing)) {
            $existing = ['events' => []];
        }
        if (!isset($existing['events']) || !is_array($existing['events'])) {
            $existing['events'] = [];
        }

        $existing['events'][] = $event;
        // Keep the bag small.
        $serialized = json_encode($existing);
        while ($serialized !== false && strlen($serialized) > AGENTIC_CHAT_MAX_DEBUG_EVENTS_BYTES
               && count($existing['events']) > 1) {
            array_shift($existing['events']);
            $serialized = json_encode($existing);
        }

        $this->updateThread($threadId, ['debug_meta' => $serialized]);
    }

    /**
     * Ensure a llmConversations row exists for the given user/section so
     * the foreign key in agenticChatThreads can be satisfied.
     *
     * @param int $userId
     * @param int $sectionId
     * @return int New conversation id.
     */
    private function createConversationRow($userId, $sectionId)
    {
        return $this->db->insert('llmConversations', [
            'id_users' => $userId,
            'id_sections' => $sectionId,
            'title' => 'Agentic Chat',
            'model' => 'agentic-chat',
            'temperature' => 1,
            'max_tokens' => 2048,
        ]);
    }

    /**
     * Audit-log helper. Mirrors how sh-shp-llm logs transactions.
     *
     * @param string $type 'insert' / 'update' / 'delete'
     * @param int    $targetId Affected row id.
     * @param int    $userId
     * @param string $description
     * @return void
     */
    private function logTransaction($type, $targetId, $userId, $description)
    {
        try {
            $transaction = $this->services->get_transaction();
            $byMap = [
                'insert' => method_exists($transaction, 'transaction_types_insert') ? null : null,
                'update' => null,
                'delete' => null,
            ];
            // Defensive: not all SelfHelp builds expose the helper signatures
            // identically, so we degrade gracefully.
            if (method_exists($transaction, 'add_transaction')) {
                $transaction->add_transaction($type, 'agenticChatThreads', $targetId, $userId,
                    $description, TRANSACTION_BY_LLM_AGENTIC_CHAT);
            }
        } catch (Throwable $e) {
            // Audit logging must never block the operation.
        }
    }

    /**
     * Generate a stable AG-UI thread id (UUIDv4 when possible).
     *
     * @return string
     */
    public function generateThreadId()
    {
        if (function_exists('random_bytes')) {
            $bytes = random_bytes(16);
            $bytes[6] = chr(ord($bytes[6]) & 0x0f | 0x40);
            $bytes[8] = chr(ord($bytes[8]) & 0x3f | 0x80);
            return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
        }
        return uniqid('agentic_', true);
    }

    /**
     * Generate a stable AG-UI run id.
     *
     * @return string
     */
    public function generateRunId()
    {
        return $this->generateThreadId();
    }
}
