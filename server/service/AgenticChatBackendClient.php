<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Thin HTTP client around the AG-UI / FoResTCHAT backend.
 *
 * Exposes blocking helpers for the JSON endpoints (/reflect/defaults,
 * /reflect/configure, /health) and a streaming helper for /reflect that
 * forwards every received SSE chunk to a callback. The streaming method
 * intentionally does no AG-UI parsing - the caller decides how to
 * accumulate / persist messages.
 */
class AgenticChatBackendClient
{
    /** @var string Base URL of the backend (no trailing slash). */
    private $baseUrl;

    /** @var int Default request timeout in seconds. */
    private $timeout;

    /**
     * @param string $baseUrl Backend base URL (e.g. https://host/forestBackend).
     * @param int    $timeout Default timeout in seconds.
     */
    public function __construct($baseUrl, $timeout = AGENTIC_CHAT_DEFAULT_TIMEOUT)
    {
        $this->baseUrl = rtrim((string) $baseUrl, '/');
        $this->timeout = (int) $timeout > 0 ? (int) $timeout : AGENTIC_CHAT_DEFAULT_TIMEOUT;
    }

    /** @return string Backend base URL. */
    public function getBaseUrl()
    {
        return $this->baseUrl;
    }

    /**
     * GET /reflect/defaults.
     *
     * @param string $path Endpoint path (default '/reflect/defaults').
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    public function getDefaults($path = AGENTIC_CHAT_DEFAULT_DEFAULTS_PATH)
    {
        return $this->jsonRequest('GET', $path);
    }

    /**
     * GET /health.
     *
     * @param string $path Endpoint path (default '/health').
     * @return array{ok:bool, status:int, data?:array, error?:string, latency_ms:int}
     */
    public function getHealth($path = AGENTIC_CHAT_DEFAULT_HEALTH_PATH)
    {
        $started = microtime(true);
        $result = $this->jsonRequest('GET', $path);
        $result['latency_ms'] = (int) round((microtime(true) - $started) * 1000);
        return $result;
    }

    /**
     * POST /reflect/configure.
     *
     * @param array  $payload Fully-built request body (see AgenticChatPersonaService::buildConfigurePayload).
     * @param string $path    Endpoint path.
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    public function configureThread(array $payload, $path = AGENTIC_CHAT_DEFAULT_CONFIGURE_PATH)
    {
        return $this->jsonRequest('POST', $path, $payload);
    }

    /**
     * Stream POST /reflect through cURL with the SSE response forwarded
     * to a callback. The callback receives the raw chunk string and may
     * return false to cancel the transfer.
     *
     * Returns the final HTTP status code or 0 if the request never reached
     * the server.
     *
     * @param array    $payload  AG-UI run input.
     * @param callable $onChunk  function(string $chunk): bool|null
     * @param string   $path     Endpoint path.
     * @return array{ok:bool, status:int, error?:string}
     */
    public function streamRun(array $payload, callable $onChunk, $path = AGENTIC_CHAT_DEFAULT_REFLECT_PATH)
    {
        if (!function_exists('curl_init')) {
            return ['ok' => false, 'status' => 0, 'error' => 'cURL not available'];
        }

        $url = $this->baseUrl . $path;

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Accept: text/event-stream',
            'Cache-Control: no-cache',
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_HEADER, false);
        // No connection timeout cap on the body; only on initial connect.
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_TIMEOUT, 0);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_BUFFERSIZE, 256);
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use ($onChunk) {
            $continue = $onChunk($chunk);
            if ($continue === false) {
                return 0; // abort
            }
            return strlen($chunk);
        });
        $this->applySslOptions($ch);

        curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($error !== '' && $status === 0) {
            return ['ok' => false, 'status' => 0, 'error' => $error];
        }
        if ($status >= 400) {
            return [
                'ok' => false,
                'status' => $status,
                'error' => "Backend returned HTTP {$status}",
            ];
        }
        return ['ok' => true, 'status' => $status];
    }

    /* Private helpers ******************************************************/

    /**
     * Apply SSL verification options to a cURL handle.
     *
     * Mirrors the established pattern from `LlmService::callLlmApi()` and
     * the SelfHelp LLM plugin: when DEBUG is enabled (the typical
     * developer / on-prem test setup) we disable peer/host verification
     * because Windows + bundled PHP frequently ship without a usable
     * CA bundle, which surfaces as
     *
     *   "SSL certificate problem: unable to get local issuer certificate"
     *
     * Production deployments leave DEBUG off and let cURL do full
     * verification against the system CA bundle (or whatever
     * `curl.cainfo` / `openssl.cafile` points to).
     *
     * @param resource|\CurlHandle $ch
     */
    private function applySslOptions($ch)
    {
        if (defined('DEBUG') && DEBUG) {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }
    }

    /**
     * Generic JSON request with sensible cURL defaults.
     *
     * @param string     $method  HTTP method.
     * @param string     $path    Endpoint path.
     * @param array|null $body    JSON body (null = no body).
     * @return array{ok:bool, status:int, data?:array, error?:string}
     */
    private function jsonRequest($method, $path, $body = null)
    {
        if (!function_exists('curl_init')) {
            return ['ok' => false, 'status' => 0, 'error' => 'cURL not available'];
        }

        $url = $this->baseUrl . $path;

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        $this->applySslOptions($ch);

        $headers = ['Accept: application/json'];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $responseBody = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($responseBody === false) {
            return [
                'ok' => false,
                'status' => $status,
                'error' => $error !== '' ? $error : 'Empty response',
            ];
        }

        $decoded = json_decode($responseBody, true);
        if ($status >= 200 && $status < 300) {
            return [
                'ok' => true,
                'status' => $status,
                'data' => is_array($decoded) ? $decoded : ['raw' => $responseBody],
            ];
        }

        return [
            'ok' => false,
            'status' => $status,
            'error' => is_array($decoded) && isset($decoded['detail'])
                ? (is_string($decoded['detail']) ? $decoded['detail'] : json_encode($decoded['detail']))
                : ($error !== '' ? $error : "HTTP {$status}"),
            'data' => is_array($decoded) ? $decoded : null,
        ];
    }
}
