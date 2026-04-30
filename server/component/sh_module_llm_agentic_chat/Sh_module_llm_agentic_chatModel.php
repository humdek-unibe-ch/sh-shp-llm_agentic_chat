<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
?>
<?php
require_once __DIR__ . "/../../../../../component/BaseModel.php";
require_once __DIR__ . "/../../service/AgenticChatPersonaService.php";

/**
 * Model for the LLM Agentic Chat admin module.
 *
 * Reads configuration from the sh_module_llm_agentic_chat page fields and
 * exposes them as a structured data shape consumed by the React admin UI.
 *
 * Field naming and storage strategy intentionally mirror sh-shp-llm so the
 * two plugins behave consistently for administrators.
 */
class Sh_module_llm_agentic_chatModel extends BaseModel
{
    /** Canonical language id used for global plugin config storage. */
    private const CONFIG_LANGUAGE_ID = 1;

    /** @var int|null Page id of the admin config page (null if not yet migrated). */
    private $configPageId;

    /** @var array|null Lazily-loaded page fields cache. */
    private $pageFields;

    /** @var AgenticChatPersonaService Persona JSON validation/normalization. */
    private $personaService;

    public function __construct($services)
    {
        parent::__construct($services);
        $this->configPageId = $this->db->fetch_page_id_by_keyword(PAGE_LLM_AGENTIC_CHAT_CONFIG);
        $this->personaService = new AgenticChatPersonaService();
    }

    /** @return int|null Page id of the configuration page. */
    public function getConfigPageId()
    {
        return $this->configPageId;
    }

    /**
     * Load all page fields for the config page using the standard CMS
     * stored procedure. Cached after first call.
     *
     * @return array<string,string|null>
     */
    public function getPageFields()
    {
        if ($this->pageFields !== null) {
            return $this->pageFields;
        }

        if (!$this->configPageId) {
            return $this->pageFields = [];
        }

        $row = $this->db->query_db_first(
            "CALL get_page_fields(:id_page, :id_languages, :id_default_languages, '', '')",
            [
                'id_page' => $this->configPageId,
                'id_languages' => self::CONFIG_LANGUAGE_ID,
                'id_default_languages' => self::CONFIG_LANGUAGE_ID,
            ]
        );

        return $this->pageFields = $row ?: [];
    }

    /**
     * Decoded settings shape consumed by the React admin app.
     * Each section returns a label and an array of structured field
     * descriptors with type / value / help.
     *
     * @return array
     */
    public function getStructuredSettings()
    {
        $fields = $this->getPageFields();

        $personasRaw = $fields['agentic_chat_personas'] ?? '[]';
        $personas = $this->personaService->parse($personasRaw);

        return [
            'backend' => [
                'label' => 'Backend Connection',
                'fields' => [
                    $this->buildField('agentic_chat_backend_url', $fields, 'text',
                        'Backend Base URL',
                        'AG-UI backend root, no trailing slash. Example: https://tpf-test.humdek.unibe.ch/forestBackend'),
                    $this->buildField('agentic_chat_reflect_path', $fields, 'text',
                        'Reflect Endpoint',
                        'Path of the AG-UI run endpoint (POST, returns text/event-stream).'),
                    $this->buildField('agentic_chat_configure_path', $fields, 'text',
                        'Configure Endpoint',
                        'Path of the per-thread configuration endpoint (POST).'),
                    $this->buildField('agentic_chat_defaults_path', $fields, 'text',
                        'Defaults Endpoint',
                        'Endpoint that returns default module text and persona templates (GET).'),
                    $this->buildField('agentic_chat_health_path', $fields, 'text',
                        'Health Endpoint',
                        'Liveness probe endpoint (GET).'),
                    $this->buildField('agentic_chat_timeout', $fields, 'number',
                        'Backend Timeout (seconds)',
                        'Request timeout for backend HTTP/SSE calls.'),
                ],
            ],
            'behaviour' => [
                'label' => 'Behaviour',
                'fields' => [
                    $this->buildField('agentic_chat_debug_enabled', $fields, 'checkbox',
                        'Show Debug Panel by Default',
                        'When enabled, the chat surface exposes a debug panel for AG-UI events.'),
                    $this->buildField('agentic_chat_default_module', $fields, 'textarea',
                        'Default Module / Reflection Text',
                        'Used as the canonical context whenever a section does not define its own.'),
                ],
            ],
            'personas' => [
                'label' => 'Personas',
                'fields' => [
                    [
                        'name' => 'agentic_chat_personas',
                        'type' => 'agentic-personas',
                        'label' => 'Persona Library',
                        'help' => 'Global persona library used by all agenticChat sections. Each persona has key, name, role, instructions, color/avatar and an enabled flag.',
                        'value' => $this->personaService->encode($personas),
                        'parsed' => $personas,
                        'roleOptions' => $this->getPersonaRoleOptions(),
                        'backendSlots' => AGENTIC_CHAT_BACKEND_SLOTS,
                    ],
                ],
            ],
        ];
    }

    /**
     * Build a structured field descriptor for the React form.
     *
     * @param string      $name    Field name.
     * @param array       $fields  All page field values (associative).
     * @param string      $type    Field type for the React renderer.
     * @param string      $label   Human-readable label.
     * @param string      $help    Help text.
     * @param array|null  $options Optional dropdown options.
     * @return array
     */
    private function buildField($name, $fields, $type, $label, $help, $options = null)
    {
        $field = [
            'name' => $name,
            'type' => $type,
            'label' => $label,
            'help' => $help,
            'value' => $fields[$name] ?? '',
        ];
        if ($options !== null) {
            $field['options'] = $options;
        }
        return $field;
    }

    /**
     * Persona-role options loaded from `lookups`. Matches the lookup values
     * inserted by v1.0.0.sql (type_code = agenticChatPersonaRole).
     *
     * @return array<int, array{value:string,label:string}>
     */
    private function getPersonaRoleOptions()
    {
        try {
            $rows = $this->db->query_db(
                "SELECT lookup_code, lookup_value FROM lookups
                  WHERE type_code = ?
                  ORDER BY lookup_value",
                [AGENTIC_CHAT_LOOKUP_TYPE_PERSONA_ROLE]
            );
            $options = [];
            foreach ($rows as $row) {
                $options[] = [
                    'value' => $row['lookup_code'],
                    'label' => $row['lookup_value'],
                ];
            }
            return $options;
        } catch (Exception $e) {
            return [
                ['value' => AGENTIC_CHAT_PERSONA_ROLE_TEACHER, 'label' => 'Teacher'],
                ['value' => AGENTIC_CHAT_PERSONA_ROLE_EXPERT, 'label' => 'Expert'],
                ['value' => AGENTIC_CHAT_PERSONA_ROLE_OTHER, 'label' => 'Other'],
            ];
        }
    }

    /**
     * Persist a single CMS field value against the admin config page.
     * Inserts / updates the pages_fields_translation row for language 1.
     *
     * @param string $fieldName  Internal field name.
     * @param string $value      New value.
     * @return bool              True on success.
     */
    public function saveSetting($fieldName, $value)
    {
        if (!$this->configPageId) {
            return false;
        }

        $field = $this->db->query_db_first(
            "SELECT id FROM fields WHERE name = ?",
            [$fieldName]
        );
        if (!$field) {
            return false;
        }
        $fieldId = $field['id'];

        $existing = $this->db->query_db_first(
            "SELECT id_pages FROM pages_fields_translation
              WHERE id_pages = ? AND id_fields = ? AND id_languages = ?",
            [$this->configPageId, $fieldId, self::CONFIG_LANGUAGE_ID]
        );

        if ($existing) {
            $this->db->execute_update_db(
                "UPDATE pages_fields_translation
                    SET content = ?
                  WHERE id_pages = ? AND id_fields = ? AND id_languages = ?",
                [$value, $this->configPageId, $fieldId, self::CONFIG_LANGUAGE_ID]
            );
        } else {
            $this->db->execute_update_db(
                "INSERT INTO pages_fields_translation
                    (id_pages, id_fields, id_languages, content)
                 VALUES (?, ?, ?, ?)",
                [$this->configPageId, $fieldId, self::CONFIG_LANGUAGE_ID, $value]
            );
        }

        $this->pageFields = null; // bust cache
        return true;
    }

    /**
     * Retrieve a single config field value (with optional default).
     *
     * @param string $name
     * @param string $default
     * @return string
     */
    public function getSetting($name, $default = '')
    {
        $fields = $this->getPageFields();
        return isset($fields[$name]) ? (string) $fields[$name] : $default;
    }

    /** @return AgenticChatPersonaService */
    public function getPersonaService()
    {
        return $this->personaService;
    }

    /**
     * Flat shape consumed directly by the React admin app.
     *
     * @return array{backend: array, personas: array}
     */
    public function getFlatInitialState()
    {
        $fields = $this->getPageFields();
        $personasRaw = $fields['agentic_chat_personas'] ?? '[]';
        return [
            'backend' => [
                'backend_url' => (string) ($fields['agentic_chat_backend_url'] ?? AGENTIC_CHAT_DEFAULT_BACKEND_URL),
                'reflect_path' => (string) ($fields['agentic_chat_reflect_path'] ?? AGENTIC_CHAT_DEFAULT_REFLECT_PATH),
                'configure_path' => (string) ($fields['agentic_chat_configure_path'] ?? AGENTIC_CHAT_DEFAULT_CONFIGURE_PATH),
                'defaults_path' => (string) ($fields['agentic_chat_defaults_path'] ?? AGENTIC_CHAT_DEFAULT_DEFAULTS_PATH),
                'health_path' => (string) ($fields['agentic_chat_health_path'] ?? AGENTIC_CHAT_DEFAULT_HEALTH_PATH),
                'timeout' => (int) ($fields['agentic_chat_timeout'] ?? AGENTIC_CHAT_DEFAULT_TIMEOUT),
                'debug_enabled' => ($fields['agentic_chat_debug_enabled'] ?? '0') === '1',
                'default_module' => (string) ($fields['agentic_chat_default_module'] ?? ''),
            ],
            'personas' => $this->personaService->parse($personasRaw),
        ];
    }
}
