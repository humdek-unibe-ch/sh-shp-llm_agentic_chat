<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Append-only transcript logger for the agentic chat.
 *
 * Every TEXT_MESSAGE_END and every RUN_FINISHED interrupt that carries
 * speaker metadata is written to a single plain-text log file in the
 * plugin root so a developer can paste the conversation into a chat /
 * issue tracker without scraping the database.
 *
 * The log path is intentionally inside the plugin folder so it sits
 * alongside the code that produced it. The plugin's `.gitignore`
 * matches `*.log` so the file is never committed by accident.
 *
 * Log line format (UTF-8, one entry per line):
 *
 *   [YYYY-MM-DD HH:MM:SS] thread=<agui_thread_id> run=<run_id>
 *   slot=<authorSlot> persona=<authorPersonaKey> name=<authorName>
 *   kind=<message|interrupt> text=<single-line, newlines escaped as \n>
 *
 * The logger is best-effort: if the file cannot be opened it silently
 * falls back to PHP's `error_log` so chat streaming is never blocked
 * by a permission problem.
 *
 * @package LLM Agentic Chat Plugin
 * @since   v1.1.0
 */
class AgenticChatTranscriptLogger
{
    /** @var string Absolute path to the log file. */
    private $logFile;

    /**
     * @param string|null $logFile Optional override; defaults to
     *                             `agentic-chat-transcript.log` in the
     *                             plugin root.
     */
    public function __construct($logFile = null)
    {
        if (is_string($logFile) && $logFile !== '') {
            $this->logFile = $logFile;
            return;
        }
        // Plugin root: …/server/plugins/sh-shp-llm_agentic_chat/
        // (this file lives in /server/service, so two levels up.)
        $this->logFile = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'agentic-chat-transcript.log';
    }

    /**
     * @return string Absolute path to the active log file.
     */
    public function getLogFile()
    {
        return $this->logFile;
    }

    /**
     * Log a completed assistant text message.
     *
     * @param array $thread     Thread row (uses `agui_thread_id`,
     *                          `last_run_id`).
     * @param array $attribution Normalised speaker metadata
     *                           (authorSlot, authorName, authorPersonaKey).
     * @param string $text      Final concatenated message text.
     * @return void
     */
    public function logMessage(array $thread, array $attribution, $text)
    {
        $this->writeEntry($thread, $attribution, 'message', (string) $text);
    }

    /**
     * Log an interrupt message (the assistant text that paused the
     * workflow for HITL input).
     *
     * @param array $thread
     * @param array $attribution
     * @param string $message
     * @return void
     */
    public function logInterrupt(array $thread, array $attribution, $message)
    {
        $this->writeEntry($thread, $attribution, 'interrupt', (string) $message);
    }

    /**
     * Internal: assemble + persist one log line.
     *
     * @param array  $thread
     * @param array  $attribution
     * @param string $kind
     * @param string $text
     * @return void
     */
    private function writeEntry(array $thread, array $attribution, $kind, $text)
    {
        $text = trim($text);
        if ($text === '') {
            return;
        }

        $timestamp = date('Y-m-d H:i:s');
        $threadId = isset($thread['agui_thread_id']) ? (string) $thread['agui_thread_id'] : '';
        $runId = isset($thread['last_run_id']) ? (string) $thread['last_run_id'] : '';
        $slot = isset($attribution['authorSlot']) ? (string) $attribution['authorSlot'] : '';
        $persona = isset($attribution['authorPersonaKey']) ? (string) $attribution['authorPersonaKey'] : '';
        $name = isset($attribution['authorName']) ? (string) $attribution['authorName'] : '';

        // Compact one-line escape so a paste into a markdown comment
        // box does not break formatting.
        $escapedText = strtr($text, [
            "\r\n" => '\\n',
            "\n"   => '\\n',
            "\r"   => '\\n',
        ]);

        $line = sprintf(
            "[%s] thread=%s run=%s slot=%s persona=%s name=%s kind=%s text=%s\n",
            $timestamp,
            $threadId !== '' ? $threadId : '-',
            $runId !== '' ? $runId : '-',
            $slot !== '' ? $slot : '-',
            $persona !== '' ? $persona : '-',
            $name !== '' ? $name : '-',
            $kind,
            $escapedText
        );

        $handle = @fopen($this->logFile, 'a');
        if ($handle === false) {
            // Permissions failure or read-only mount: surface to the
            // server error log but do not abort the chat run.
            @error_log('[AgenticChatTranscriptLogger] ' . trim($line));
            return;
        }
        @fwrite($handle, $line);
        @fclose($handle);
    }
}
