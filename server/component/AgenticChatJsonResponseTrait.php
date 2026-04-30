<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Trait for sending JSON responses in LLM Agentic Chat controllers.
 * Mirrors the LLM plugin's LlmJsonResponseTrait so behavior is consistent.
 */
trait AgenticChatJsonResponseTrait
{
    /**
     * Send a JSON response and exit.
     *
     * @param array $data         Response payload.
     * @param int   $status_code  HTTP status code (default 200).
     */
    protected function sendJsonResponse($data, $status_code = 200)
    {
        $this->beforeSendJsonResponse();

        if (!headers_sent()) {
            http_response_code($status_code);
            header('Content-Type: application/json');
        }

        // Log user activity if router is available; mirrors core CMS behavior.
        try {
            $this->model->get_services()->get_router()->log_user_activity();
        } catch (Throwable $e) {
            // Non-fatal: user activity logging should never break the response.
        }

        echo json_encode($data);

        if (function_exists('uopz_allow_exit')) {
            uopz_allow_exit(true);
        }
        exit;
    }

    /**
     * Hook called immediately before sendJsonResponse() ships the body.
     * Override in concrete controllers to add bookkeeping.
     */
    protected function beforeSendJsonResponse()
    {
        // No-op by default.
    }

    /**
     * Stream Server-Sent Events headers and disable PHP/proxy buffering.
     * Call this once before forwarding SSE chunks.
     */
    protected function startSseStream()
    {
        if (!headers_sent()) {
            header('Content-Type: text/event-stream');
            header('Cache-Control: no-cache, no-store, must-revalidate');
            header('Pragma: no-cache');
            header('Expires: 0');
            header('X-Accel-Buffering: no'); // Nginx: disable response buffering.
        }
        // Disable any output buffering layers.
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        @ob_implicit_flush(true);
    }

    /**
     * Send a single AG-UI-shaped SSE event from a typed payload array.
     *
     * @param array $event Already-decoded event payload.
     */
    protected function sendSseEvent(array $event)
    {
        echo 'data: ' . json_encode($event) . "\n\n";
        @flush();
    }
}
