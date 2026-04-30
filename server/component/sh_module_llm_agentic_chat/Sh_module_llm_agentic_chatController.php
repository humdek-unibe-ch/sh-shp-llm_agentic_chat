<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../component/BaseController.php";
require_once __DIR__ . "/../AgenticChatJsonResponseTrait.php";
require_once __DIR__ . "/../../service/AgenticChatBackendClient.php";

/**
 * Controller for the LLM Agentic Chat admin module.
 *
 * Routes:
 *   GET  ?action=get_config         Return decoded settings + ACL flags.
 *   POST ?action=save_config        Persist allow-listed fields.
 *   POST ?action=save_personas      Persist the persona array (JSON body).
 *   GET  ?action=fetch_defaults     Call the backend's /reflect/defaults.
 *   GET  ?action=health_check       Call the backend's /health.
 *
 * All endpoints require ACL "select" or "update" on the config page.
 */
class Sh_module_llm_agentic_chatController extends BaseController
{
    use AgenticChatJsonResponseTrait;

    /** @var object ACL service. */
    private $acl;

    /** @var int|null Page id of sh_module_llm_agentic_chat. */
    private $pageId;

    public function __construct($model)
    {
        parent::__construct($model);
        $services = $model->get_services();
        $this->acl = $services->get_acl();
        $this->pageId = $services->get_db()->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_CONFIG);
        $this->handleRequest();
    }

    /**
     * Dispatch incoming AJAX request based on the `action` parameter.
     */
    private function handleRequest()
    {
        $action = $_GET['action'] ?? $_POST['action'] ?? null;
        if (!$action) {
            return; // Plain page load - let the view render normally.
        }

        try {
            switch ($action) {
                case 'get_config':
                    $this->requireAccess('select');
                    $this->handleGetConfig();
                    break;
                case 'save_config':
                    $this->requireAccess('update');
                    $this->handleSaveConfig();
                    break;
                case 'save_personas':
                    $this->requireAccess('update');
                    $this->handleSavePersonas();
                    break;
                case 'fetch_defaults':
                    $this->requireAccess('select');
                    $this->handleFetchDefaults();
                    break;
                case 'health_check':
                    $this->requireAccess('select');
                    $this->handleHealthCheck();
                    break;
                default:
                    $this->sendJsonResponse(['error' => 'Unknown action'], 400);
            }
        } catch (Throwable $e) {
            $this->sendJsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Sends 403 + exits when the current user lacks the required ACL mode
     * on the configuration page.
     *
     * @param string $mode ACL mode ('select' or 'update').
     */
    private function requireAccess($mode)
    {
        if (!$this->checkAccess($mode)) {
            $this->sendJsonResponse(['error' => 'Access denied'], 403);
        }
    }

    /**
     * @param string $mode 'select', 'update', etc.
     * @return bool
     */
    private function checkAccess($mode)
    {
        if (!$this->pageId || !isset($_SESSION['id_user'])) {
            return false;
        }
        $method = 'has_access_' . $mode;
        return $this->acl->$method($_SESSION['id_user'], $this->pageId);
    }

    /** Return structured + flat settings for the React admin UI. */
    private function handleGetConfig()
    {
        $this->sendJsonResponse([
            'ok' => true,
            'data' => $this->model->getFlatInitialState(),
            'settings' => $this->model->getStructuredSettings(),
            'acl' => [
                'select' => $this->checkAccess('select'),
                'update' => $this->checkAccess('update'),
            ],
        ]);
    }

    /** Persist allow-listed scalar config fields. */
    private function handleSaveConfig()
    {
        $data = $this->readJsonBody();
        if (!is_array($data) || empty($data['fields'])) {
            $this->sendJsonResponse(['error' => 'No fields provided'], 400);
        }

        $allowed = [
            'agentic_chat_backend_url',
            'agentic_chat_reflect_path',
            'agentic_chat_configure_path',
            'agentic_chat_defaults_path',
            'agentic_chat_health_path',
            'agentic_chat_timeout',
            'agentic_chat_debug_enabled',
            'agentic_chat_default_module',
        ];

        $saved = [];
        foreach ($data['fields'] as $name => $value) {
            if (!in_array($name, $allowed, true)) {
                continue;
            }
            $cleanValue = is_scalar($value) ? (string) $value : '';
            // Normalise booleans coming from React JSON.
            if ($name === 'agentic_chat_debug_enabled') {
                $cleanValue = ($value === true || $value === 1 || $value === '1' || $value === 'true') ? '1' : '0';
            }
            // Strip trailing slash from base URL (defensive).
            if ($name === 'agentic_chat_backend_url') {
                $cleanValue = rtrim($cleanValue, '/');
            }
            if ($this->model->saveSetting($name, $cleanValue)) {
                $saved[] = $name;
            }
        }

        $this->sendJsonResponse(['success' => true, 'saved' => $saved]);
    }

    /** Persist the persona array (re-encoded canonically). */
    private function handleSavePersonas()
    {
        $data = $this->readJsonBody();
        $rawPersonas = is_array($data) && isset($data['personas']) ? $data['personas'] : null;

        if ($rawPersonas === null) {
            $this->sendJsonResponse(['error' => 'No personas provided'], 400);
        }

        $personaService = $this->model->getPersonaService();
        $normalised = $personaService->parse($rawPersonas);
        $encoded = $personaService->encode($normalised);

        $ok = $this->model->saveSetting('agentic_chat_personas', $encoded);
        if (!$ok) {
            $this->sendJsonResponse(['error' => 'Failed to save personas'], 500);
        }

        $this->sendJsonResponse([
            'success' => true,
            'personas' => $normalised,
            'count' => count($normalised),
        ]);
    }

    /** Forward GET /reflect/defaults from the backend. */
    private function handleFetchDefaults()
    {
        $client = new AgenticChatBackendClient(
            $this->model->getSetting('agentic_chat_backend_url', AGENTIC_CHAT_DEFAULT_BACKEND_URL),
            (int) $this->model->getSetting('agentic_chat_timeout', AGENTIC_CHAT_DEFAULT_TIMEOUT)
        );

        $result = $client->getDefaults($this->model->getSetting(
            'agentic_chat_defaults_path',
            AGENTIC_CHAT_DEFAULT_DEFAULTS_PATH
        ));

        if (!$result['ok']) {
            $this->sendJsonResponse([
                'error' => $result['error'] ?? 'Unknown backend error',
                'status' => $result['status'] ?? 0,
            ], 502);
        }

        $this->sendJsonResponse(['defaults' => $result['data']]);
    }

    /** Liveness probe against the backend's /health endpoint. */
    private function handleHealthCheck()
    {
        $client = new AgenticChatBackendClient(
            $this->model->getSetting('agentic_chat_backend_url', AGENTIC_CHAT_DEFAULT_BACKEND_URL),
            (int) $this->model->getSetting('agentic_chat_timeout', AGENTIC_CHAT_DEFAULT_TIMEOUT)
        );

        $result = $client->getHealth($this->model->getSetting(
            'agentic_chat_health_path',
            AGENTIC_CHAT_DEFAULT_HEALTH_PATH
        ));

        $this->sendJsonResponse([
            'ok' => $result['ok'],
            'status' => $result['status'] ?? 0,
            'data' => $result['data'] ?? null,
            'error' => $result['error'] ?? null,
            'latency_ms' => $result['latency_ms'] ?? null,
        ], $result['ok'] ? 200 : 502);
    }

    /**
     * Parse JSON body sent by the React admin client.
     *
     * @return array|null
     */
    private function readJsonBody()
    {
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }
}
