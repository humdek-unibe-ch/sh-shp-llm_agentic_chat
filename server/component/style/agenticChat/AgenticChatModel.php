<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/style/StyleModel.php";
require_once __DIR__ . "/../../../service/AgenticChatService.php";

/**
 * Model for the agenticChat style.
 *
 * Reads section-level configuration from the StyleModel field cache and
 * exposes a single getReactConfig() method that the view dumps into
 * data-config for the React chat to consume.
 */
class AgenticChatModel extends StyleModel
{
    /** @var int|null Authenticated user id. */
    private $userId;

    /** @var AgenticChatService */
    private $agenticService;

    public function __construct($services, $id, $params = array(), $id_page = -1, $entry_record = array())
    {
        parent::__construct($services, $id, $params, $id_page, $entry_record);
        $this->userId = $_SESSION['id_user'] ?? null;
        $this->agenticService = new AgenticChatService($services);
    }

    /** @return int|null Authenticated user id. */
    public function getUserId()
    {
        return $this->userId;
    }

    /** @return int CMS section id. */
    public function getSectionId()
    {
        return $this->section_id;
    }

    /** @return AgenticChatService */
    public function getAgenticService()
    {
        return $this->agenticService;
    }

    /* Section-level field accessors *****************************************/

    /** @return string Translatable heading shown above the chat. */
    public function getTitle()
    {
        return (string) $this->get_db_field('agentic_chat_title', '');
    }

    /** @return string Optional markdown description rendered above the chat. */
    public function getDescription()
    {
        return (string) $this->get_db_field('agentic_chat_description', '');
    }

    /** @return string Section-level module / reflection text (falls back to global default). */
    public function getModuleContent()
    {
        $sectionModule = trim((string) $this->get_db_field('agentic_chat_section_module', ''));
        if ($sectionModule !== '') {
            return $sectionModule;
        }
        $globalConfig = $this->agenticService->getGlobalConfig();
        return (string) $globalConfig['default_module'];
    }

    /** @return bool Auto-start the conversation when the section opens. */
    public function isAutoStartEnabled()
    {
        return $this->get_db_field('agentic_chat_auto_start', '1') === '1';
    }

    /** @return bool Show the per-section debug panel (overrides global). */
    public function isDebugVisible()
    {
        $globalConfig = $this->agenticService->getGlobalConfig();
        $local = $this->get_db_field('agentic_chat_show_debug', '0') === '1';
        return $local || $globalConfig['debug_enabled'];
    }

    /** @return bool Show the persona avatars strip above messages. */
    public function isPersonaStripVisible()
    {
        return $this->get_db_field('agentic_chat_show_persona_strip', '1') === '1';
    }

    /** @return bool Show the run-status badge in the header. */
    public function isRunStatusVisible()
    {
        return $this->get_db_field('agentic_chat_show_run_status', '1') === '1';
    }

    /**
     * Decoded slot-map (backend slot -> persona key).
     *
     * @return array<string, string>
     */
    public function getPersonaSlotMap()
    {
        $raw = (string) $this->get_db_field('agentic_chat_persona_slot_map', '{}');
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Personas selected for this section. Returns the global library when
     * no section-level subset is configured.
     *
     * @return array
     */
    public function getSectionPersonas()
    {
        $raw = (string) $this->get_db_field('agentic_chat_section_personas', '[]');
        $sectionPersonas = $this->agenticService->getPersonaService()->parse($raw);
        if (!empty($sectionPersonas)) {
            return $sectionPersonas;
        }
        $global = $this->agenticService->getGlobalConfig();
        return $global['personas'];
    }

    /**
     * Build the JSON shape consumed by the React chat through data-config.
     *
     * @return array
     */
    public function getReactConfig()
    {
        $globalConfig = $this->agenticService->getGlobalConfig();
        $personas = $this->getSectionPersonas();
        $slotMap = $this->getPersonaSlotMap();

        return [
            'userId' => $this->userId,
            'sectionId' => $this->section_id,
            'baseUrl' => $this->services->get_router()->get_link_url(),
            'controllerUrl' => $this->getControllerUrl(),
            'pluginVersion' => LLM_AGENTIC_CHAT_PLUGIN_VERSION,
            'autoStart' => $this->isAutoStartEnabled(),
            'autoStartToken' => AGENTIC_CHAT_AUTO_START_TOKEN,
            'caseCompleteMarker' => AGENTIC_CHAT_CASE_COMPLETE_MARKER,
            'showDebug' => $this->isDebugVisible(),
            'showPersonaStrip' => $this->isPersonaStripVisible(),
            'showRunStatus' => $this->isRunStatusVisible(),
            'personas' => $personas,
            'personaSlotMap' => $slotMap,
            'backendSlots' => AGENTIC_CHAT_BACKEND_SLOTS,
            'labels' => [
                'title' => $this->getTitle(),
                'description' => $this->getDescription(),
                'placeholder' => (string) $this->get_db_field('agentic_chat_message_placeholder', 'Type your reply…'),
                'sendLabel' => (string) $this->get_db_field('agentic_chat_send_label', 'Send'),
                'startLabel' => (string) $this->get_db_field('agentic_chat_start_label', 'Start conversation'),
                'resetLabel' => (string) $this->get_db_field('agentic_chat_reset_label', 'Start a new thread'),
                'completionMessage' => (string) $this->get_db_field('agentic_chat_completion_message', ''),
                'loadingText' => (string) $this->get_db_field('agentic_chat_loading_text', 'Connecting to backend…'),
                'statusIdle' => (string) $this->get_db_field('agentic_chat_status_idle_label', 'Ready'),
                'statusRunning' => (string) $this->get_db_field('agentic_chat_status_running_label', 'Thinking…'),
                'statusComplete' => (string) $this->get_db_field('agentic_chat_status_complete_label', 'Case complete'),
                'statusError' => (string) $this->get_db_field('agentic_chat_status_error_label', 'Error'),
            ],
            'moduleContent' => $this->getModuleContent(),
            'backendInfo' => [
                'baseUrl' => $globalConfig['backend_url'],
                'reflectPath' => $globalConfig['reflect_path'],
            ],
        ];
    }

    /**
     * Same-origin URL the React chat uses to call this section's controller.
     * The controller validates section_id on every call so multiple
     * agenticChat instances coexist on the same page.
     *
     * @return string
     */
    private function getControllerUrl()
    {
        $router = $this->services->get_router();
        // Use the current page url so action requests stay same-origin.
        if (method_exists($router, 'get_current_url')) {
            return $router->get_current_url();
        }
        return $_SERVER['REQUEST_URI'] ?? '';
    }

    /**
     * Output a JSON slice and exit (mirrors LlmChatModel::return_data).
     *
     * @param string $key
     * @return never
     */
    public function return_data($key)
    {
        $result = [];
        if (isset($this->interpolation_data['data_config_retrieved'][$key])) {
            $result = $this->interpolation_data['data_config_retrieved'][$key];
        }
        header('Content-Type: application/json');
        echo json_encode($result);
        if (function_exists('uopz_allow_exit')) {
            uopz_allow_exit(true);
        }
        exit(0);
    }
}
