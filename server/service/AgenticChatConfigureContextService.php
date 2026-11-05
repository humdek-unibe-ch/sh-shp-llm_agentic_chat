<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

require_once __DIR__ . '/../../../sh-shp-llm/server/service/trace/LlmRequestTraceService.php';

/**
 * Stores the /reflect/configure body of a thread once, the way sh-shp-llm
 * stores request traces (doc/request-traces.md of sh-shp-llm):
 *
 *  - The module text is the Prompt Lab version of the section's
 *    `agentic_chat_context` when it was sent unchanged ({"p": version id}).
 *    Otherwise (placeholders replaced, global default module) it is cut by
 *    sh-shp-llm's LlmTraceBuilder exactly like a system message of an llmChat
 *    request trace ({"c": [chunk ids]}, joined in order): long Global Values
 *    are shared chunks, the rest is one chunk of the owner below.
 *  - The persona list is a chunk ({"c": chunk id}).
 *  - Chunks are stored once per (owner, sha256): owner 0 = shared admin
 *    config (personas, default module), owner = id_users = section text with
 *    replaced placeholders (deleted with the user).
 *
 * `configure_hash` is the sha256 of the canonical JSON of the sent body.
 * record() rebuilds the body from the database and compares the hash; when
 * that fails the whole body is stored as one per-user chunk ({"body": ...}).
 * Storing the context never blocks the configure call: the caller logs a
 * failure and configures the thread anyway.
 */
class AgenticChatConfigureContextService
{
    /** @var object PageDb. */
    private $db;

    /**
     * @param object $db PageDb.
     */
    public function __construct($db)
    {
        $this->db = $db;
    }

    /**
     * Store the context of a configure body.
     *
     * @param array    $payload         Body sent to /reflect/configure.
     * @param int      $userId          Owner of the thread.
     * @param int|null $moduleSectionId Section whose agentic_chat_context is the
     *                                  module text; null when the global default
     *                                  module (or the built-in fallback) was sent.
     * @return array{configure_recipe_json:string, configure_hash:string, id_llm_prompt_versions_module:int|null}
     */
    public function record(array $payload, $userId, $moduleSectionId = null)
    {
        $userId = (int) $userId;
        $module = (string) ($payload['module_content'] ?? '');
        $versionId = $moduleSectionId ? $this->resolvePromptVersionId((int) $moduleSectionId, $module) : null;

        $chunks = [];
        $recipe = [];
        if ($versionId !== null && trim($this->promptVersionText($versionId)) === $module) {
            $recipe['module'] = ['p' => $versionId];
        } else {
            // Cut like an llmChat request trace: long Global Values are shared
            // chunks (owner 0); the rest of a section text with replaced
            // placeholders may hold participant data (owner = user).
            LlmPromptVersionLinker::shareGlobalValues($this->db);
            $built = LlmTraceBuilder::build(
                [['role' => 'system', 'content' => $module]],
                [],
                function () {
                    return null;
                },
                LlmTraceHints::sharedTexts(),
                $moduleSectionId ? $userId : 0
            );
            $chunks = $built['chunks'];
            $recipe['module'] = ['c' => $built['recipe'][0]['c']];
        }
        $recipe['personas'] = ['c' => $this->addChunk($chunks, 0, LlmTraceCanonicalizer::canonicalJson($payload['personas'] ?? []))];

        $hash = self::hashBody($payload);
        $recipe = $this->resolveChunkIds($recipe, $chunks, $userId);
        $rebuilt = $this->rebuildBody($recipe, (string) ($payload['thread_id'] ?? ''), !empty($payload['use_group_chat_mediator']));
        if ($rebuilt === null || self::hashBody($rebuilt) !== $hash) {
            error_log('[AgenticChatConfigureContextService] configure context rebuild did not match, storing the full body');
            $chunks = [];
            $recipe = ['body' => ['c' => $this->addChunk($chunks, $userId, LlmTraceCanonicalizer::canonicalJson($payload))]];
            $recipe = $this->resolveChunkIds($recipe, $chunks, $userId);
        }

        return [
            'configure_recipe_json' => json_encode($recipe),
            'configure_hash' => $hash,
            'id_llm_prompt_versions_module' => $versionId,
        ];
    }

    /**
     * Rebuild the configure body of a thread from its stored context.
     *
     * @param array $thread agenticChatThreads row.
     * @return array{body:array|null, module:string|null, personas:array|null, verified:bool|null}
     *   body: the full body when every part could be loaded; module / personas:
     *   the parts that could be loaded (threads from before v1.1.0 only have a
     *   module); verified: whether body matches configure_hash (null without hash).
     */
    public function rebuild(array $thread)
    {
        $result = ['body' => null, 'module' => null, 'personas' => null, 'verified' => null];
        $recipe = json_decode((string) ($thread['configure_recipe_json'] ?? ''), true);
        if (!is_array($recipe)) {
            return $result;
        }

        $useMediator = !isset($thread['use_group_chat_mediator']) || (int) $thread['use_group_chat_mediator'] === 1;
        $body = $this->rebuildBody($recipe, (string) ($thread['agui_thread_id'] ?? ''), $useMediator);
        if ($body !== null) {
            $result['body'] = $body;
            $result['module'] = $body['module_content'];
            $result['personas'] = $body['personas'];
        } elseif (isset($recipe['module'])) {
            $result['module'] = $this->loadModule($recipe['module']);
        }
        if ($body !== null && !empty($thread['configure_hash'])) {
            $result['verified'] = self::hashBody($body) === (string) $thread['configure_hash'];
        }
        return $result;
    }

    /**
     * @param array $body Configure body.
     * @return string sha256 of its canonical JSON.
     */
    public static function hashBody(array $body)
    {
        return hash('sha256', LlmTraceCanonicalizer::canonicalJson($body));
    }

    /**
     * @param array  $recipe   Recipe with chunk / version ids.
     * @param string $threadId AG-UI thread id.
     * @param bool   $useMediator
     * @return array|null The body, null when a part is missing.
     */
    private function rebuildBody(array $recipe, $threadId, $useMediator)
    {
        if (isset($recipe['body'])) {
            $body = json_decode((string) $this->loadChunk($recipe['body']['c'] ?? 0), true);
            return is_array($body) ? $body : null;
        }
        $module = isset($recipe['module']) ? $this->loadModule($recipe['module']) : null;
        $personas = isset($recipe['personas']['c'])
            ? json_decode((string) $this->loadChunk($recipe['personas']['c']), true)
            : null;
        if ($module === null || !is_array($personas)) {
            return null;
        }
        return [
            'thread_id' => (string) $threadId,
            'module_content' => $module,
            'personas' => $personas,
            'use_group_chat_mediator' => (bool) $useMediator,
        ];
    }

    /**
     * @param array $entry {"p": version id} or {"c": [chunk ids]} (joined in order)
     * @return string|null
     */
    private function loadModule(array $entry)
    {
        if (isset($entry['p'])) {
            $text = $this->promptVersionText((int) $entry['p']);
            return $text !== null ? trim($text) : null;
        }
        if (!isset($entry['c']) || !is_array($entry['c'])) {
            return null;
        }
        $text = '';
        foreach ($entry['c'] as $chunkId) {
            $chunk = $this->loadChunk($chunkId);
            if ($chunk === null) {
                return null;
            }
            $text .= $chunk;
        }
        return $text;
    }

    /**
     * The Prompt Lab version of the section's agentic_chat_context that holds
     * its raw text, resolved by sh-shp-llm's linker (user language, else
     * language 1). Only a version of that section field is accepted.
     *
     * @param int    $sectionId
     * @param string $module Sent module text.
     * @return int|null
     */
    private function resolvePromptVersionId($sectionId, $module)
    {
        LlmPromptVersionLinker::noteSectionField($sectionId, AGENTIC_CHAT_FIELD_CONTEXT, (int) ($_SESSION['user_language'] ?? 1));
        $ids = LlmPromptVersionLinker::resolveAll($this->db, [['role' => 'system', 'content' => $module]]);
        if (empty($ids)) {
            return null;
        }
        $params = [':section' => $sectionId, ':slot' => AGENTIC_CHAT_FIELD_CONTEXT];
        $placeholders = [];
        foreach (array_values($ids) as $i => $id) {
            $placeholders[] = ':id' . $i;
            $params[':id' . $i] = (int) $id;
        }
        $row = $this->db->query_db_first(
            'SELECT v.id FROM llm_prompt_versions v
             INNER JOIN llm_prompt_locales l ON l.id = v.id_llm_prompt_locales
             INNER JOIN llm_prompt_entries e ON e.id = l.id_llm_prompt_entries
             WHERE v.id IN (' . implode(',', $placeholders) . ') AND e.owner_id = :section AND e.prompt_slot = :slot
             LIMIT 1',
            $params
        );
        return !empty($row['id']) ? (int) $row['id'] : null;
    }

    /**
     * @param int $versionId
     * @return string|null Raw template of a Prompt Lab version.
     */
    private function promptVersionText($versionId)
    {
        $row = $this->db->query_db_first(
            'SELECT template_raw FROM llm_prompt_versions WHERE id = :id',
            [':id' => (int) $versionId]
        );
        return $row ? (string) $row['template_raw'] : null;
    }

    /**
     * @param int|string $chunkId
     * @return string|null
     */
    private function loadChunk($chunkId)
    {
        $row = $this->db->query_db_first(
            'SELECT content FROM llmTraceChunks WHERE id = :id',
            [':id' => (int) $chunkId]
        );
        return $row ? (string) $row['content'] : null;
    }

    /**
     * Queue a chunk for storeChunks() and return its ref ("<owner>:<sha256>").
     *
     * @param array  $chunks  ref => {owner, sha256, content} (in/out)
     * @param int    $owner   0 = shared, else id_users
     * @param string $content
     * @return string
     */
    private function addChunk(array &$chunks, $owner, $content)
    {
        $sha = hash('sha256', (string) $content);
        $ref = (int) $owner . ':' . $sha;
        $chunks[$ref] = ['owner' => (int) $owner, 'sha256' => $sha, 'content' => (string) $content];
        return $ref;
    }

    /**
     * Store the queued chunks and replace their refs in the recipe by ids.
     *
     * @param array $recipe
     * @param array $chunks
     * @param int   $userId
     * @return array
     * @throws RuntimeException When a chunk was not stored (the caller then
     *                          stores no context; the configure call goes on).
     */
    private function resolveChunkIds(array $recipe, array $chunks, $userId)
    {
        $ids = (new LlmRequestTraceService($this->db))->storeChunks($chunks, $userId);
        $toId = function ($ref) use ($ids) {
            if (empty($ids[$ref])) {
                throw new RuntimeException('configure context chunk not stored');
            }
            return (int) $ids[$ref];
        };
        foreach ($recipe as &$entry) {
            if (isset($entry['c'])) {
                $entry['c'] = is_array($entry['c']) ? array_map($toId, $entry['c']) : $toId($entry['c']);
            }
        }
        unset($entry);
        return $recipe;
    }
}
