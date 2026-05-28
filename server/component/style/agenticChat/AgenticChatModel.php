<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../../component/style/StyleModel.php";
require_once __DIR__ . "/../../../service/AgenticChatService.php";

/**
 * Model for the `agenticChat` CMS style.
 *
 * Responsibilities:
 *   - Read section-level configuration from the StyleModel field cache.
 *   - Compose the React `data-config` payload consumed by the AG-UI
 *     chat surface (see `tpl/agentic_chat_main.php`).
 *   - Expose helper accessors used by both the controller and the
 *     view (section id, configured personas, speech-to-text settings).
 *
 * Section-level fields read by this model
 * ---------------------------------------
 *  agentic_chat_personas_to_use (agentic-chat-personas-select, internal)
 *      JSON array of persona keys (subset of the global persona library
 *      defined on the admin page sh_module_llm_agentic_chat). When empty
 *      every enabled persona from the global library is used. Rendered
 *      in the CMS by the `AgenticChatHooks::outputFieldPersonasSelect*`
 *      hooks as a Bootstrap multi-select.
 *  agentic_chat_auto_start (checkbox, internal)
 *      Send the AG-UI kickoff token as soon as the section opens.
 *  agentic_chat_show_persona_strip (checkbox, internal)
 *      Render the strip with active/visited persona avatars.
 *  agentic_chat_show_run_status (checkbox, internal)
 *      Render the run-status badge in the chat header.
 *  enable_speech_to_text (checkbox, internal)
 *      Enable the microphone button + Whisper transcription pipeline.
 *      Field declared by `sh-shp-llm` and linked into agenticChat.
 *  speech_to_text_model (select-audio-model, internal)
 *      Whisper model identifier used for transcription. Field declared
 *      by `sh-shp-llm` and linked into agenticChat.
 *  agentic_chat_title / agentic_chat_description / agentic_chat_*_label
 *      Translatable user-visible strings shown in the chat surface.
 *
 * Module / reflection text injected into AG-UI threads is read from the
 * **global** `agentic_chat_default_module` field on the admin page; it
 * cannot be overridden per section.
 *
 * @package LLM Agentic Chat Plugin
 * @since   v1.0.0
 */
class AgenticChatModel extends StyleModel
{
    /** @var int|null Authenticated user id (from session). */
    private $userId;

    /** @var AgenticChatService High-level orchestrator (config, personas, threads). */
    private $agenticService;

    /* =========================================================================
     * CONSTRUCTOR
     * ========================================================================= */

    /**
     * @param object $services       SelfHelp services container.
     * @param int    $id             Section id of the agenticChat component.
     * @param array  $params         GET parameters.
     * @param int    $id_page        Parent page id.
     * @param array  $entry_record   Entry record data.
     */
    public function __construct($services, $id, $params = array(), $id_page = -1, $entry_record = array())
    {
        parent::__construct($services, $id, $params, $id_page, $entry_record);
        $this->userId = $_SESSION['id_user'] ?? null;
        $this->agenticService = new AgenticChatService($services);
    }

    /* =========================================================================
     * BASIC ACCESSORS
     * ========================================================================= */

    /** @return int|null Authenticated user id. */
    public function getUserId()
    {
        return $this->userId;
    }

    /** @return int CMS section id of the current chat instance. */
    public function getSectionId()
    {
        return $this->section_id;
    }

    /** @return AgenticChatService Shared orchestrator (used by the controller). */
    public function getAgenticService()
    {
        return $this->agenticService;
    }

    /* =========================================================================
     * BEHAVIOUR FLAGS
     * ========================================================================= */

    /** @return bool Auto-start the conversation when the section opens. */
    public function isAutoStartEnabled()
    {
        return $this->get_db_field('agentic_chat_auto_start', '1') === '1';
    }

    /** @return bool Show the CMS debug panel for this style instance. */
    public function isDebugVisible()
    {
        return $this->get_db_field('debug', '0') === '1';
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

    /* =========================================================================
     * SPEECH-TO-TEXT
     * ========================================================================= */

    /**
     * Whether the microphone button should appear in the input toolbar.
     * Requires both the feature flag and a configured Whisper model.
     *
     * @return bool
     */
    public function isSpeechToTextEnabled()
    {
        return $this->get_db_field('enable_speech_to_text', '0') === '1'
            && $this->getSpeechToTextModel() !== '';
    }

    /** @return string Whisper model identifier (empty when unset). */
    public function getSpeechToTextModel()
    {
        return trim((string) $this->get_db_field('speech_to_text_model', ''));
    }

    /* =========================================================================
     * PERSONAS
     *
     * Personas are configured globally on the admin page
     * sh_module_llm_agentic_chat. Sections only choose which subset of
     * them to use through agentic_chat_personas_to_use.
     * ========================================================================= */

    /**
     * Return the section's curated persona-key whitelist.
     *
     * Storage format: the CMS persona multi-select posts each option
     * separately (`fields[name][lang][gender][content][]`). The core
     * `CmsUpdateController` then `implode(',', …)`s the array into a
     * CSV string before persistence (e.g. `ms_rivera,mr_okafor,ms_chen`).
     * For backward compatibility we also accept the legacy JSON array
     * format (`["ms_rivera","mr_okafor"]`) and pre-decoded
     * arrays from `get_db_field`.
     *
     * @return array<int, string> Persona keys (deduplicated, in selection order).
     */
    public function getSelectedPersonaKeys()
    {
        $raw = $this->get_db_field('agentic_chat_personas_to_use', '');

        if (is_array($raw)) {
            $decoded = $raw;
        } else {
            $rawString = trim((string) $raw);
            if ($rawString === '') {
                return [];
            }
            $decoded = json_decode($rawString, true);
            if (!is_array($decoded)) {
                $decoded = explode(',', $rawString);
            }
        }

        $keys = [];
        foreach ($decoded as $key) {
            if (!is_scalar($key)) {
                continue;
            }
            $key = trim((string) $key);
            if ($key === '' || in_array($key, $keys, true)) {
                continue;
            }
            $keys[] = $key;
        }
        return $keys;
    }

    /**
     * Return the personas the React UI should render in the strip /
     * message bubbles. This is the **resolved** set: the section's
     * selected personas (where they map to a known slot type) plus the
     * fallback global persona for each slot type the section did not
     * pick. The fixed mediator is appended separately so the chat
     * surface can render its avatar/name.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getActivePersonas()
    {
        $slotPersonas = $this->getResolvedSlotPersonas();

        // Append the fixed mediator descriptor first so it shows up at
        // the start of the persona strip.
        $personas = [AGENTIC_CHAT_MEDIATOR_PERSONA];

        foreach (AGENTIC_CHAT_PERSONA_SLOT_TYPES as $slotType) {
            if (isset($slotPersonas[$slotType])) {
                $personas[] = $slotPersonas[$slotType];
            }
        }
        return $personas;
    }

    /**
     * Resolve teacher slot types to global persona objects using the
     * section's selection + first-enabled fallback. Cached per request.
     *
     * @return array<string, array<string, mixed>>
     */
    public function getResolvedSlotPersonas()
    {
        $globalPersonas = $this->agenticService->getGlobalConfig()['personas'];
        $selectedKeys = $this->getSelectedPersonaKeys();
        return $this->agenticService
            ->getPersonaService()
            ->resolveSlotPersonas($globalPersonas, $selectedKeys);
    }

    /**
     * Build the backend slot -> persona key map for this section.
     * Mediator always points to the fixed mediator key; teacher slots
     * point to the resolved persona key (selection -> fallback ->
     * unassigned).
     *
     * @return array<string, string>
     */
    public function buildBackendSlotMap()
    {
        return $this->agenticService
            ->getPersonaService()
            ->buildBackendSlotKeyMap($this->getResolvedSlotPersonas());
    }

    /* =========================================================================
     * MODULE CONTENT
     * ========================================================================= */

    /**
     * Module / reflection text injected into every AG-UI thread for this
     * section. Always read from the global configuration field
     * `agentic_chat_default_module`; sections do not override it.
     *
     * @return string
     */
    public function getModuleContent()
    {
        return (string) $this->agenticService->getGlobalConfig()['default_module'];
    }

    /* =========================================================================
     * REACT CONFIG
     * ========================================================================= */

    /**
     * Build the JSON shape consumed by the React chat through `data-config`.
     *
     * @return array<string, mixed>
     */
    public function getReactConfig()
    {
        $globalConfig = $this->agenticService->getGlobalConfig();

        return [
            'userId'             => $this->userId,
            'sectionId'          => $this->section_id,
            'baseUrl'            => $this->getControllerUrl(),
            'controllerUrl'      => $this->getControllerUrl(),
            'pluginVersion'      => LLM_AGENTIC_CHAT_PLUGIN_VERSION,
            'autoStart'          => $this->isAutoStartEnabled(),
            'autoStartToken'     => AGENTIC_CHAT_AUTO_START_TOKEN,
            'caseCompleteMarker' => AGENTIC_CHAT_CASE_COMPLETE_MARKER,
            'showDebug'          => $this->isDebugVisible(),
            'showPersonaStrip'   => $this->isPersonaStripVisible(),
            'showRunStatus'      => $this->isRunStatusVisible(),
            // `personas` already includes the fixed mediator at index 0
            // followed by the resolved teacher variants, so the chat UI
            // can look any speaker up by key in a single array.
            'personas'           => $this->getActivePersonas(),
            'personaSlotMap'     => $this->buildBackendSlotMap(),
            'backendSlots'       => AGENTIC_CHAT_BACKEND_SLOTS,
            'mediator'           => AGENTIC_CHAT_MEDIATOR_PERSONA,
            'slotTypes'          => AGENTIC_CHAT_PERSONA_SLOT_TYPES,
            'enableSpeechToText' => $this->isSpeechToTextEnabled(),
            'speechToTextModel'  => $this->getSpeechToTextModel(),
            'labels'             => $this->getLabels(),
            'moduleContent'      => $this->getModuleContent(),
            'backendInfo'        => [
                'baseUrl'     => $globalConfig['backend_url'],
                'reflectPath' => $globalConfig['reflect_path'],
            ],
        ];
    }

    /**
     * Build the translatable labels passed to the React UI.
     *
     * @return array<string, string>
     */
    private function getLabels()
    {
        return [
            'title'             => (string) $this->get_db_field('agentic_chat_title', ''),
            'description'       => (string) $this->get_db_field('agentic_chat_description', ''),
            'placeholder'       => (string) $this->get_db_field('agentic_chat_message_placeholder', 'Type your message here...'),
            'sendLabel'         => (string) $this->get_db_field('agentic_chat_send_label', 'Send'),
            'startLabel'        => (string) $this->get_db_field('agentic_chat_start_label', 'Start conversation'),
            'resetLabel'        => (string) $this->get_db_field('agentic_chat_reset_label', 'Start a new thread'),
            'completionMessage' => (string) $this->get_db_field('agentic_chat_completion_message', ''),
            'loadingText'       => (string) $this->get_db_field('agentic_chat_loading_text', 'Connecting to backend…'),
            'statusIdle'        => (string) $this->get_db_field('agentic_chat_status_idle_label', 'Ready'),
            'statusRunning'     => (string) $this->get_db_field('agentic_chat_status_running_label', 'Thinking…'),
            'statusComplete'    => (string) $this->get_db_field('agentic_chat_status_complete_label', 'Case complete'),
            'statusError'       => (string) $this->get_db_field('agentic_chat_status_error_label', 'Error'),
        ];
    }

    /**
     * Same-origin URL the React chat uses to call this section's controller.
     *
     * The controller validates the `section_id` query param on every call so
     * multiple agenticChat instances coexist on the same page.
     *
     * @return string
     */
    private function getControllerUrl()
    {
        $requestUri = $_SERVER['REQUEST_URI'] ?? '';
        if ($requestUri === '') {
            return '';
        }

        $parts = parse_url($requestUri);
        if (!is_array($parts)) {
            return $requestUri;
        }

        $params = [];
        if (!empty($parts['query'])) {
            parse_str($parts['query'], $params);
            unset($params['action'], $params['section_id']);
        }

        $url = $parts['path'] ?? '';
        if (!empty($params)) {
            $url .= '?' . http_build_query($params);
        }
        return $url;
    }

    /* =========================================================================
     * AJAX DATA SLICES (mirrors LlmChatModel::return_data)
     * ========================================================================= */

    /**
     * Output a JSON slice from the interpolation cache and exit.
     *
     * @param string $key Key inside `interpolation_data['data_config_retrieved']`.
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
