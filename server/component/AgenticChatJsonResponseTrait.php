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
     * Discards any stray output that may have been emitted before this
     * call (PHP warnings, deprecations, accidental whitespace from
     * included files, etc.) so the response body is guaranteed to be
     * valid JSON. Without this guard a single E_DEPRECATED notice from
     * any plugin upstream of agenticChat would surface in the React UI
     * as "Invalid JSON response".
     *
     * @param array $data         Response payload.
     * @param int   $status_code  HTTP status code (default 200).
     */
    protected function sendJsonResponse($data, $status_code = 200)
    {
        $this->beforeSendJsonResponse();

        // Drop any output buffers that may contain warnings/notices
        // emitted earlier in the request lifecycle.
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }

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
     *
     * Any output buffers active at this point are *discarded* (not
     * flushed) so a warning emitted upstream can't sneak into the SSE
     * stream and corrupt the first event the React parser sees.
     *
     * Hardening notes:
     *   - `X-Accel-Buffering: no` covers Nginx.
     *   - `Content-Encoding: identity` tells any compressing layer
     *     (Apache mod_deflate, gzip, brotli, etc.) NOT to wait for a
     *     full block before sending bytes downstream. Without this the
     *     React client may not see any TEXT_MESSAGE_CONTENT deltas
     *     until the full response is buffered.
     *   - `apache_setenv('no-gzip', '1')` is the Apache-specific knob
     *     to disable mod_deflate on this response when running under
     *     mod_php.
     *   - We then emit a ~2KB SSE comment as initial padding because
     *     some browsers/proxies wait for a couple of KB of body before
     *     starting to render an SSE stream (Chrome historically waits
     *     for ~1KB; Apache buffers ~2KB by default). Sending the
     *     padding before the first real event guarantees the user
     *     sees deltas the moment they arrive.
     */
    protected function startSseStream()
    {
        if (!headers_sent()) {
            header('Content-Type: text/event-stream');
            header('Cache-Control: no-cache, no-store, must-revalidate');
            header('Pragma: no-cache');
            header('Expires: 0');
            header('X-Accel-Buffering: no'); // Nginx: disable response buffering.
            header('Content-Encoding: identity'); // disable gzip/brotli
        }

        // Apache mod_deflate: opt out per-request when running under
        // mod_php. Safe no-op on PHP-FPM / CLI / Nginx.
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
            @apache_setenv('dont-vary', '1');
        }

        // Defeat ini-level zlib output compression which would
        // otherwise re-buffer everything despite the headers above.
        if (function_exists('ini_set')) {
            @ini_set('zlib.output_compression', '0');
        }

        // Drop any output buffers (including the one we may have started
        // in dispatch() to capture warnings) - we want raw passthrough.
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        @ob_implicit_flush(true);

        // SSE padding comment: ~2KB of ":" lines so any intermediate
        // buffer fills up immediately. Browsers ignore comment lines
        // ("data:"-less lines starting with ":"), so this is invisible
        // to the React parser but reliably "primes" the stream.
        echo ':' . str_repeat(' ', 2048) . "\n\n";
        @flush();
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
