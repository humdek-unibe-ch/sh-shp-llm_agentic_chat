<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AG-UI event normalisation layer (legacy backend → strict AG-UI shape).
 *
 * The upstream FoResTCHAT backend speaks an AG-UI-flavoured wire protocol
 * with a few inherited quirks:
 *
 *   - Identifier fields mix snake_case and camelCase
 *     (`message_id` ↔ `messageId`, `author_name` ↔ `authorName`,
 *      `source_executor_id` ↔ `sourceExecutorId`, …).
 *   - Human-in-the-loop pauses are signalled by attaching an `interrupt`
 *     array directly to the terminal `RUN_FINISHED` event instead of the
 *     spec-compliant `RUN_FINISHED.outcome` envelope.
 *   - Interrupt payloads themselves are bespoke `handoff_input` blobs
 *     (`{ value: { agent_response, source_executor_id, … } }`) without
 *     normalised `message` / `responseSchema` fields.
 *
 * The plugin is the compatibility bridge: the backend keeps its legacy
 * format, but every event leaving this normaliser is camelCase-only and
 * follows the strict AG-UI shape so the React chat can be written
 * against a stable model.
 *
 * Each normalised event additionally carries the original payload under
 * `_rawLegacy` so the threads/debug viewer can show what the upstream
 * server actually sent.
 *
 * @package LLM Agentic Chat Plugin
 * @since   v1.1.0
 */
class AgenticChatEventNormalizer
{
    /**
     * Canonical executor-id → backend slot key mapping.
     *
     * The upstream HandoffBuilder names its agents using fixed ids:
     *   - group_chat_mediator   → mediator slot
     *   - persona_1_teacher     → persona_1 slot
     *   - persona_2_teacher     → persona_2 slot
     *   - persona_3_teacher     → persona_3 slot
     *
     * This map is used to resolve an event's `authorName` /
     * `sourceExecutorId` back to a slot, and then – via the section's
     * slot map – to a persona key.
     *
     * The legacy executor names (`foundational_teacher`, …) are kept
     * here so existing threads created against the previous backend
     * iteration still attribute correctly when the chat is reopened.
     *
     * @var array<string, string>
     */
    private static $executorToSlot = [
        // FoResTCHAT current backend.
        'group_chat_mediator'     => 'mediator',
        'persona_1_teacher'       => 'persona_1',
        'persona_2_teacher'       => 'persona_2',
        'persona_3_teacher'       => 'persona_3',
        // Aliases the upstream framework sometimes emits.
        'group_chat_moderator'    => 'mediator',
        'group_chat_orchestrator' => 'mediator',
        'triage_agent'            => 'mediator',
        // Legacy executor ids (semantic-slot backend; kept for older threads).
        'foundational_teacher'    => 'persona_1',
        'inclusive_teacher'       => 'persona_2',
        'inquiry_teacher'         => 'persona_3',
    ];

    /**
     * Stateful field: the executor that the upstream workflow is
     * currently inside.
     *
     * The FoResTCHAT backend emits `TEXT_MESSAGE_*` and `TOOL_CALL_*`
     * events WITHOUT an `author_name` or `source_executor_id` field —
     * the executor name only appears on the surrounding
     * `STEP_STARTED.stepName` and on `ACTIVITY_SNAPSHOT.content.executor_id`.
     * To attribute streamed text to the right persona we track the
     * most recent step/executor name here and inject it as a fallback
     * during `resolveSpeaker`.
     *
     * Reset between runs is handled implicitly: the controller builds a
     * fresh `AgenticChatService` (and thus a fresh normalizer) for every
     * `actionStreamRun` call, so no per-stream reset method is needed.
     *
     * @var string|null
     */
    private $currentExecutorId = null;

    /**
     * Normalise a single decoded AG-UI event.
     *
     * @param array $event Decoded SSE event from the backend.
     * @param array $slotMap Optional backend slot → persona key map
     *                       (resolved from the section's curated
     *                       persona selection on the PHP side).
     * @return array Strict-shape AG-UI event ready to forward to React.
     */
    public function normalizeEvent(array $event, array $slotMap = [])
    {
        // Track the current executor BEFORE we resolve speakers so the
        // STEP_STARTED event itself also carries the resolved metadata
        // (useful for the debug surface) and subsequent events inside
        // the same step inherit it as a fallback.
        $this->updateCurrentExecutor($event);

        $type = isset($event['type']) ? (string) $event['type'] : '';
        if ($type === '') {
            return $event;
        }

        // Start from a fresh copy with camelCase ids.
        $out = $this->camelCaseIdentifiers($event);

        // Resolve speaker metadata for events that name an author.
        $speaker = $this->resolveSpeaker($event, $slotMap);
        if ($speaker !== null) {
            $out['authorName'] = $speaker['authorName'];
            $out['sourceExecutorId'] = $speaker['sourceExecutorId'];
            if ($speaker['slot'] !== null) {
                $out['authorSlot'] = $speaker['slot'];
            }
            if ($speaker['personaKey'] !== null) {
                $out['authorPersonaKey'] = $speaker['personaKey'];
            }
        }

        switch ($type) {
            case 'RUN_FINISHED':
                $out = $this->normalizeRunFinished($out, $event, $slotMap);
                break;

            case 'TEXT_MESSAGE_START':
            case 'TEXT_MESSAGE_CONTENT':
            case 'TEXT_MESSAGE_END':
            case 'TEXT_MESSAGE_CHUNK':
            case 'TOOL_CALL_START':
            case 'TOOL_CALL_ARGS':
            case 'TOOL_CALL_END':
            case 'TOOL_CALL_RESULT':
            case 'TOOL_CALL_CHUNK':
                // camelCaseIdentifiers + speaker resolution is enough.
                break;
        }

        // Preserve the original backend event for debug surfaces. The key
        // intentionally starts with an underscore so the React side can
        // distinguish meta fields from normalised data.
        $out['_rawLegacy'] = $event;

        return $out;
    }

    /**
     * Rewrite the legacy `RUN_FINISHED.interrupt(s)` array into the
     * strict-AG-UI `outcome` envelope:
     *
     *     {
     *       type: "RUN_FINISHED",
     *       threadId, runId,
     *       outcome: {
     *         type: "interrupt" | "complete",
     *         interrupts?: [ NormalisedInterrupt, ... ]
     *       },
     *       interrupts: [ ... ]   // kept as a top-level alias for back-compat
     *     }
     *
     * @param array $normalised Camel-cased event being built.
     * @param array $original   Original backend event.
     * @param array $slotMap    Backend slot → persona key.
     * @return array
     */
    private function normalizeRunFinished(array $normalised, array $original, array $slotMap)
    {
        $rawInterrupts = $original['interrupt'] ?? $original['interrupts'] ?? null;
        $list = [];
        if (is_array($rawInterrupts)) {
            foreach ($rawInterrupts as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $list[] = $this->normalizeInterrupt($item, $slotMap);
            }
        }

        // Drop the legacy singular key in favour of an explicit `outcome`.
        unset($normalised['interrupt']);

        if (!empty($list)) {
            $normalised['outcome'] = [
                'type' => 'interrupt',
                'interrupts' => $list,
            ];
            $normalised['interrupts'] = $list; // canonical alias
        } else {
            $normalised['outcome'] = [
                'type' => 'complete',
            ];
            unset($normalised['interrupts']);
        }

        return $normalised;
    }

    /**
     * Normalise a single legacy interrupt envelope (`{ id, value: ... }`)
     * into the strict shape used by the React chat:
     *
     *     {
     *       interruptId, reason?, message?, responseSchema?,
     *       metadata?, sourceExecutorId?, authorPersonaKey?,
     *       authorName?, rawLegacy
     *     }
     *
     * @param array $interrupt Raw backend interrupt.
     * @param array $slotMap   Backend slot → persona key.
     * @return array
     */
    public function normalizeInterrupt(array $interrupt, array $slotMap = [])
    {
        $id = isset($interrupt['id']) ? (string) $interrupt['id'] : '';
        $value = $interrupt['value'] ?? null;

        $reason = null;
        $message = null;
        $responseSchema = null;
        $sourceExecutorId = null;
        $authorName = null;
        $metadata = is_array($value) ? $value : null;

        if (is_array($value)) {
            // Reason is sometimes carried as `request_type` ("handoff_input"
            // in the FoResTCHAT backend) or as `type` on newer agents.
            if (isset($value['request_type'])) {
                $reason = (string) $value['request_type'];
            } elseif (isset($value['requestType'])) {
                $reason = (string) $value['requestType'];
            } elseif (isset($value['type']) && is_string($value['type'])) {
                $reason = (string) $value['type'];
            }

            // Human-readable prompt.
            foreach (['message', 'prompt', 'question', 'text'] as $key) {
                if (isset($value[$key]) && is_string($value[$key]) && $value[$key] !== '') {
                    $message = (string) $value[$key];
                    break;
                }
            }

            // Some implementations bury the prompt inside the last
            // assistant message of the agent_response payload.
            if ($message === null) {
                $agentResponse = $value['agent_response'] ?? $value['agentResponse'] ?? null;
                if (is_array($agentResponse) && isset($agentResponse['messages']) && is_array($agentResponse['messages'])) {
                    $messages = $agentResponse['messages'];
                    for ($i = count($messages) - 1; $i >= 0; $i--) {
                        $candidate = $messages[$i];
                        if (!is_array($candidate)) {
                            continue;
                        }
                        $text = $this->extractTextFromMessage($candidate);
                        if ($text !== '') {
                            $message = $text;
                            break;
                        }
                    }
                }
            }

            // Response schema (JSON Schema or AG-UI form schema).
            foreach (['response_schema', 'responseSchema', 'schema'] as $key) {
                if (isset($value[$key]) && (is_array($value[$key]) || is_string($value[$key]))) {
                    $responseSchema = $value[$key];
                    break;
                }
            }

            $sourceExecutorId = isset($value['source_executor_id']) ? (string) $value['source_executor_id']
                : (isset($value['sourceExecutorId']) ? (string) $value['sourceExecutorId'] : null);
            $authorName = isset($value['author_name']) ? (string) $value['author_name']
                : (isset($value['authorName']) ? (string) $value['authorName'] : null);

            // Some backends (FoResTCHAT in particular) bury the speaker
            // inside the agent_response payload. Two shapes are seen
            // in the wild and we accept both:
            //   value.agent_response.author_name      (older builds)
            //   value.agent_response.messages[i].author_name
            //                                         (current handoff
            //                                          workflow)
            // We pick the LAST assistant message that has an
            // `author_name`, because the interrupt always closes on
            // the speaker that just emitted the most recent turn.
            if ($sourceExecutorId === null || $authorName === null) {
                $agentResponse = $value['agent_response'] ?? $value['agentResponse'] ?? null;
                if (is_array($agentResponse)) {
                    if ($authorName === null) {
                        if (isset($agentResponse['author_name']) && is_string($agentResponse['author_name'])) {
                            $authorName = $agentResponse['author_name'];
                        } elseif (isset($agentResponse['authorName']) && is_string($agentResponse['authorName'])) {
                            $authorName = $agentResponse['authorName'];
                        }
                    }
                    if ($sourceExecutorId === null) {
                        if (isset($agentResponse['source_executor_id']) && is_string($agentResponse['source_executor_id'])) {
                            $sourceExecutorId = $agentResponse['source_executor_id'];
                        } elseif (isset($agentResponse['sourceExecutorId']) && is_string($agentResponse['sourceExecutorId'])) {
                            $sourceExecutorId = $agentResponse['sourceExecutorId'];
                        }
                    }

                    // Walk the messages list from the end and grab the
                    // first assistant message that names an author.
                    if ($authorName === null
                        && isset($agentResponse['messages'])
                        && is_array($agentResponse['messages'])
                    ) {
                        for ($i = count($agentResponse['messages']) - 1; $i >= 0; $i--) {
                            $msg = $agentResponse['messages'][$i];
                            if (!is_array($msg)) {
                                continue;
                            }
                            if (isset($msg['author_name']) && is_string($msg['author_name']) && $msg['author_name'] !== '') {
                                $authorName = $msg['author_name'];
                                break;
                            }
                            if (isset($msg['authorName']) && is_string($msg['authorName']) && $msg['authorName'] !== '') {
                                $authorName = $msg['authorName'];
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Final fallback: attribute the interrupt to the most recently
        // active executor ONLY when neither the top-level interrupt
        // payload nor the nested agent_response named one.
        //
        // We deliberately do NOT fill `sourceExecutorId` from the
        // tracked currentExecutorId when an `authorName` was already
        // recovered from `agent_response`: the FoResTCHAT workflow
        // ends every run with a silent `superstep:1` that fans out to
        // foundational/inclusive/inquiry teachers in turn (each with
        // `should_respond: false`). The last STEP_STARTED before
        // RUN_FINISHED is therefore `inquiry_teacher`, not the
        // mediator who actually raised the interrupt — using it would
        // mis-attribute every mediator interrupt to the inquiry
        // teacher persona.
        if ($sourceExecutorId === null && $authorName === null && $this->currentExecutorId !== null) {
            $sourceExecutorId = $this->currentExecutorId;
            $authorName = $this->currentExecutorId;
        }

        $personaKey = null;
        $slotKey = null;
        // Prefer `authorName` over `sourceExecutorId` because the
        // authoritative speaker for FoResTCHAT interrupts lives in
        // `agent_response.author_name`. `sourceExecutorId` is often
        // missing on the top-level interrupt payload (the backend
        // exposes it only on the sibling `CUSTOM:request_info` event,
        // not on `RUN_FINISHED.interrupt[].value`).
        $resolveSpeakerId = $authorName ?? $sourceExecutorId;
        if ($resolveSpeakerId !== null) {
            $slotKey = self::$executorToSlot[$resolveSpeakerId] ?? null;
            if ($slotKey !== null && isset($slotMap[$slotKey])) {
                $personaKey = (string) $slotMap[$slotKey];
            }
        }

        $normalised = [
            'interruptId' => $id,
        ];
        if ($reason !== null) {
            $normalised['reason'] = $reason;
        }
        if ($message !== null) {
            $normalised['message'] = $message;
        }
        if ($responseSchema !== null) {
            $normalised['responseSchema'] = $responseSchema;
        }
        if ($metadata !== null) {
            $normalised['metadata'] = $metadata;
        }
        if ($sourceExecutorId !== null) {
            $normalised['sourceExecutorId'] = $sourceExecutorId;
        }
        if ($authorName !== null) {
            $normalised['authorName'] = $authorName;
        }
        if ($slotKey !== null) {
            $normalised['authorSlot'] = $slotKey;
        }
        if ($personaKey !== null) {
            $normalised['authorPersonaKey'] = $personaKey;
        }
        // The exact backend shape is what the resume translator needs to
        // build the legacy `resume.interrupts[]` body.
        $normalised['rawLegacy'] = $interrupt;

        return $normalised;
    }

    /**
     * Translate a strict-AG-UI resume payload coming from the React
     * client back into the backend's legacy `resume.interrupts[]` shape:
     *
     *     Frontend  : Array<{ interruptId, status, payload? }>
     *     Backend   : { interrupts: [{ id, value: [...] }, ...] }
     *
     * The legacy `value` shape used by the FoResTCHAT handoff workflow is
     *   [{ role: "user", contents: [{ type: "text", text: "<reply>" }] }]
     * which we build from the user's free-text payload by default.
     *
     * `cancelled` resumes still need to satisfy the backend (it does not
     * have an explicit cancel path); we send a "[cancelled]" placeholder
     * so the workflow can proceed.
     *
     * @param array $resumeStrict       New shape from React.
     * @param array $pendingInterrupts  Normalised interrupts persisted on
     *                                  the thread (used to look up
     *                                  rawLegacy values when needed).
     * @return array Legacy resume body (`{ interrupts: [...] }`) or
     *               empty array when nothing valid was provided.
     */
    public function buildLegacyResumePayload(array $resumeStrict, array $pendingInterrupts = [])
    {
        // Index pending interrupts by id for quick lookup.
        $byId = [];
        foreach ($pendingInterrupts as $pending) {
            if (is_array($pending) && isset($pending['interruptId'])) {
                $byId[(string) $pending['interruptId']] = $pending;
            }
        }

        $interrupts = [];
        foreach ($resumeStrict as $item) {
            if (!is_array($item) || empty($item['interruptId'])) {
                continue;
            }
            $interruptId = (string) $item['interruptId'];
            $status = isset($item['status']) ? (string) $item['status'] : 'resolved';
            $payload = $item['payload'] ?? null;

            $value = $this->buildLegacyResumeValue($status, $payload, $byId[$interruptId] ?? null);

            $interrupts[] = [
                'id' => $interruptId,
                'value' => $value,
            ];
        }

        if (empty($interrupts)) {
            return [];
        }

        return ['interrupts' => $interrupts];
    }

    /* =========================================================================
     * Helpers
     * ========================================================================= */

    /**
     * Build the legacy AG-UI `value` array for one resume entry.
     *
     * @param string                 $status   "resolved" | "cancelled"
     * @param array|string|null      $payload  Free-form payload from the UI
     *                                         (typically `{ text: "..." }`).
     * @param array|null             $original Persisted normalised interrupt
     *                                         (carries rawLegacy for schema
     *                                         lookups).
     * @return array
     */
    private function buildLegacyResumeValue($status, $payload, $original)
    {
        $text = '';
        if (is_string($payload)) {
            $text = $payload;
        } elseif (is_array($payload)) {
            if (isset($payload['text']) && is_string($payload['text'])) {
                $text = $payload['text'];
            } elseif (isset($payload['message']) && is_string($payload['message'])) {
                $text = $payload['message'];
            } elseif (isset($payload['value']) && is_string($payload['value'])) {
                $text = $payload['value'];
            }
        }

        if ($status === 'cancelled' && $text === '') {
            $text = '[cancelled]';
        }

        // Honour any explicit `legacyValue` override from the frontend
        // when the consumer already knows the exact backend shape.
        if (is_array($payload) && isset($payload['legacyValue']) && is_array($payload['legacyValue'])) {
            return $payload['legacyValue'];
        }

        // Default to the canonical handoff_input shape used by the
        // FoResTCHAT backend so the workflow can re-enter cleanly.
        $contents = [['type' => 'text', 'text' => $text]];
        return [[
            'role' => 'user',
            'contents' => $contents,
        ]];

        // (`$original` is retained for forward-compatibility; future
        // backend revisions can use rawLegacy to copy through tool refs.)
        unset($original);
    }

    /**
     * Resolve the speaker metadata (executor id + persona key) for an
     * event that names one (TEXT_MESSAGE_*, TOOL_CALL_*).
     *
     * Falls back to the normalizer's tracked `currentExecutorId` (set
     * by the most recent `STEP_STARTED` / `ACTIVITY_SNAPSHOT`) when the
     * event itself does not name an author. This is required for the
     * FoResTCHAT backend whose `TEXT_MESSAGE_*` events carry only the
     * AG-UI `messageId` + `delta` and rely on the surrounding step for
     * speaker attribution.
     *
     * @param array $event   Original (snake/camel) event.
     * @param array $slotMap Backend slot → persona key.
     * @return array|null  { sourceExecutorId, authorName, slot, personaKey } or null.
     */
    private function resolveSpeaker(array $event, array $slotMap)
    {
        $sourceExecutorId = $event['source_executor_id']
            ?? $event['sourceExecutorId']
            ?? null;
        $authorName = $event['author_name']
            ?? $event['authorName']
            ?? null;

        $candidate = is_string($sourceExecutorId) ? $sourceExecutorId
            : (is_string($authorName) ? $authorName : null);

        // Fall back to the currently-active step's executor id when
        // the event itself does not carry speaker metadata. Restrict
        // the fallback to event types that semantically belong to one
        // speaker so STEP_FINISHED / CUSTOM noise doesn't pollute it.
        if ($candidate === null
            && $this->currentExecutorId !== null
            && $this->eventBelongsToCurrentSpeaker($event)
        ) {
            $candidate = $this->currentExecutorId;
            $sourceExecutorId = $this->currentExecutorId;
            $authorName = $this->currentExecutorId;
        }

        if ($candidate === null) {
            return null;
        }

        $slot = self::$executorToSlot[$candidate] ?? null;
        $personaKey = ($slot !== null && isset($slotMap[$slot]))
            ? (string) $slotMap[$slot]
            : null;

        return [
            'sourceExecutorId' => is_string($sourceExecutorId) ? $sourceExecutorId : ($personaKey !== null ? $candidate : (is_string($authorName) ? $authorName : null)),
            'authorName' => is_string($authorName) ? $authorName : (is_string($sourceExecutorId) ? $sourceExecutorId : null),
            'slot' => $slot,
            'personaKey' => $personaKey,
        ];
    }

    /**
     * Whether an event semantically belongs to a single speaker (and
     * therefore deserves the `currentExecutorId` fallback). Restricting
     * the fallback keeps non-speaker events like `STEP_FINISHED`,
     * `RUN_FINISHED`, plain `CUSTOM` notifications, etc., from carrying
     * an inappropriate persona attribution.
     *
     * @param array $event
     * @return bool
     */
    private function eventBelongsToCurrentSpeaker(array $event)
    {
        $type = isset($event['type']) ? (string) $event['type'] : '';
        switch ($type) {
            case 'TEXT_MESSAGE_START':
            case 'TEXT_MESSAGE_CONTENT':
            case 'TEXT_MESSAGE_END':
            case 'TEXT_MESSAGE_CHUNK':
            case 'TOOL_CALL_START':
            case 'TOOL_CALL_ARGS':
            case 'TOOL_CALL_END':
            case 'TOOL_CALL_RESULT':
            case 'TOOL_CALL_CHUNK':
                return true;
        }
        return false;
    }

    /**
     * Update the tracked executor id from a STEP_STARTED /
     * ACTIVITY_SNAPSHOT event so subsequent TEXT_MESSAGE_* /
     * TOOL_CALL_* events without explicit speaker metadata can be
     * attributed to it.
     *
     * Recognised triggers:
     *   - STEP_STARTED.stepName / step_name (when it matches a known
     *     executor id; intermediate `superstep:N` markers are ignored).
     *   - ACTIVITY_SNAPSHOT.content.executor_id (also emitted by the
     *     FoResTCHAT handoff workflow alongside the step header).
     *
     * @param array $event
     * @return void
     */
    private function updateCurrentExecutor(array $event)
    {
        $type = isset($event['type']) ? (string) $event['type'] : '';

        if ($type === 'STEP_STARTED') {
            $stepName = $event['stepName'] ?? $event['step_name'] ?? null;
            if (is_string($stepName) && isset(self::$executorToSlot[$stepName])) {
                $this->currentExecutorId = $stepName;
            }
            return;
        }

        if ($type === 'ACTIVITY_SNAPSHOT') {
            $content = $event['content'] ?? null;
            if (is_array($content)) {
                $executorId = $content['executor_id'] ?? $content['executorId'] ?? null;
                $status = $content['status'] ?? null;
                if (is_string($executorId)
                    && isset(self::$executorToSlot[$executorId])
                    && $status !== 'completed'
                ) {
                    $this->currentExecutorId = $executorId;
                }
            }
        }
    }

    /**
     * Best-effort text extractor for nested AG-UI message payloads
     * (used to fish out an interrupt prompt from agent_response).
     *
     * @param array $message
     * @return string
     */
    private function extractTextFromMessage(array $message)
    {
        if (isset($message['text']) && is_string($message['text']) && $message['text'] !== '') {
            return $message['text'];
        }
        if (isset($message['content']) && is_string($message['content']) && $message['content'] !== '') {
            return $message['content'];
        }
        $contents = $message['contents'] ?? $message['content'] ?? null;
        if (is_array($contents)) {
            $pieces = [];
            foreach ($contents as $content) {
                if (!is_array($content)) {
                    continue;
                }
                $type = $content['type'] ?? null;
                if ($type !== 'text') {
                    continue;
                }
                $text = $content['text'] ?? $content['content'] ?? null;
                if (is_string($text) && $text !== '') {
                    $pieces[] = $text;
                }
            }
            if (!empty($pieces)) {
                return trim(implode(' ', $pieces));
            }
        }
        return '';
    }

    /**
     * Promote canonical snake_case identifier fields to their camelCase
     * counterparts without dropping the originals (downstream tooling
     * sometimes inspects both keys).
     *
     * @param array $event
     * @return array
     */
    private function camelCaseIdentifiers(array $event)
    {
        static $aliases = [
            'message_id'        => 'messageId',
            'thread_id'         => 'threadId',
            'run_id'            => 'runId',
            'tool_call_id'      => 'toolCallId',
            'tool_call_name'    => 'toolCallName',
            'parent_message_id' => 'parentMessageId',
            'step_name'         => 'stepName',
            'author_name'       => 'authorName',
            'source_executor_id' => 'sourceExecutorId',
        ];

        foreach ($aliases as $snake => $camel) {
            if (isset($event[$snake]) && !isset($event[$camel])) {
                $event[$camel] = $event[$snake];
            }
        }

        return $event;
    }
}
