# Changelog

All notable changes to the **sh-shp-llm_agentic_chat** plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-01

### Added
- **Threads viewer playground.** The `/admin/module_llm_agentic_chat/threads`
  Debug tab now ships with two ready-to-paste cards (`POST /reflect/configure`
  and `POST /reflect`) showing the exact JSON body + a `curl -N` one-liner
  that will reproduce the upstream call, plus quick-copy buttons for the
  AG-UI `thread_id`, the request URL, and the JSON / curl payloads. Each
  user message in the Messages tab gets its own *JSON* and *curl* copy
  button that builds a fresh `/reflect` body for that message (with new
  `run_id` / `messages[0].id` UUIDs) so you can replay a single turn from
  Postman without further editing.

### Fixed
- `?action=health_check` and `?action=fetch_defaults` no longer fail with cURL
  error *"SSL certificate problem: unable to get local issuer certificate"*
  on Windows / on-prem test installations whose bundled PHP is missing a
  CA bundle. Mirroring the established pattern from
  `LlmService::callLlmApi()`, `AgenticChatBackendClient` now disables peer
  / host verification when `DEBUG` is on (developer / test mode) and
  leaves full verification enabled in production. Both the JSON helper
  (`jsonRequest()`) and the SSE streaming helper (`streamRun()`) share
  the same `applySslOptions()` so all backend traffic is consistent.
- `?action=health_check` and `?action=fetch_defaults` no longer fail with cURL
  error *"URL rejected: Malformed input to a URL function"*. The
  `get_page_fields` stored procedure reads strictly from
  `pages_fields_translation`; without seed rows for language `0000000001` the
  admin model returned empty strings for `agentic_chat_backend_url` (and every
  other backend field), so cURL was handed a relative path with no scheme/host.
  The migration now seeds the canonical defaults into
  `pages_fields_translation` (mirroring `sh-shp-llm` v1.0.0) and
  `Sh_module_llm_agentic_chatModel::getSetting()` falls back to the supplied
  default when a translation row is empty.
- *Kein Zugriff* on `/admin/module_llm_agentic_chat/threads`. The
  `sh_module_llm_agentic_chat_threads` pageType had no `pageType_fields`
  rows linked to it, so `get_page_fields_helper()` aggregated to NULL and
  the parent `get_page_fields()` procedure short-circuited to
  `SELECT * FROM pages WHERE 1=2`. `BasePage::fetch_page_info()` then
  received an empty result, `id_page` defaulted to 0, the ACL check ran
  against page id 0 and failed — even though the `acl_groups` row was
  correct. The migration now links the standard `title` field into the
  threads pageType (mirroring how every other admin page is wired up),
  which is the minimum the helper needs to emit valid SQL.
- Persona avatars now render correctly when the project lives under a
  non-root `BASE_PATH`. A new `resolveAvatarUrl()` helper prefixes
  document-root-relative paths with `BASE_PATH` (matching the global JS
  constant exposed by SelfHelp); full URLs and `data:` URIs pass through
  unchanged, and emoji/short-label values keep being rendered as text.

### Changed
- The persona delete button now uses the SelfHelp-wide `jquery-confirm`
  dialog (`$.confirm({ type: 'red' })`) instead of `window.confirm`, so it
  matches the look and feel of the rest of the CMS (button confirmations,
  conversation deletion, etc.). Falls back to `window.confirm` only when
  the library is unavailable (tests, partial bundles).
- The persona avatar input now ships an inline preview, an updated
  placeholder showing emoji / absolute path / full URL, and help text
  explaining that absolute paths are auto-prefixed with `BASE_PATH`.

### Added
- Initial release of the **LLM Agentic Chat** plugin (`sh-shp-llm_agentic_chat`).
- Admin page `sh_module_llm_agentic_chat` at `/admin/module_llm_agentic_chat` with
  configuration fields for the AG-UI backend URL, endpoint paths, request timeout,
  default module/reflection content, and a global persona library (JSON).
  Registered with `id_actions = 'component'` and `nav_position = 220` so it shows
  up in the admin **Modules** dropdown next to the LLM plugin (which uses 200)
  and is served directly via `Sh_module_llm_agentic_chatComponent` (matching the
  `sh-shp-llm` v1.2.0 pattern). Using `'backend'` here was a bug in the first
  draft of this migration: NavView falls back to `/admin/cms/<id>` for backend
  pages of non-internal types, which made the menu link to the CMS section editor.
- Admin page `sh_module_llm_agentic_chat_threads` at
  `/admin/module_llm_agentic_chat/threads` — a paginated, filterable threads
  monitor (debug viewer) showing `agenticChatThreads` rows with full message
  history, persona slot map, pending interrupts, debug events, token usage,
  and last error per thread. Also registered with `id_actions = 'component'`
  but with `nav_position = NULL` so it does **not** appear as a separate entry
  in the admin **Modules** dropdown — it is reached only through the sidebar
  inside `AgenticChatAdminLayoutHelper` (same approach `sh-shp-llm` uses for
  `moduleLlmAdminConsole`).
- Shared admin shell layout (`AgenticChatAdminLayoutHelper` +
  `agentic-admin-layout.css`) with a left sidebar that mirrors the
  `sh-shp-llm` admin module layout. The sidebar links **Configuration** and
  **Threads** so admins can switch tabs without leaving the admin module.
- Card-based React admin UI styled to match the `sh-shp-llm` Settings page:
  - `BackendSettingsPanel` with header probes for `/health` and
    `/reflect/defaults` plus dirty-tracked Backend Connection fields.
  - `PersonaEditor` with compact persona summary cards (avatar, key, role,
    enabled-flag, validation badges) and inline edit form opened by a pencil
    icon — modelled after the LLM plugin's API-keys editor.
  - Single sticky "Save Changes" button that persists backend settings and
    persona library together when dirty.
- New CMS style **agenticChat** (group `Form`) that renders an AG-UI-aware
  conversation surface and proxies SSE traffic to the configured backend.
- New table `agenticChatThreads` linking local `llmConversations.id` to AG-UI
  thread/run identifiers, persona slot mapping, pending interrupts, completion
  flag, and debug metadata.
- `agenticChat` uses standard CMS style fields for `css`, `css_mobile`,
  `condition`, `debug`, and `data_config`; the debug panel is controlled by
  the standard `debug` field.
- Added default persona avatar assets under `assets/avatars/`.
- Hooks `agentic-execute-task` (placeholder), `field-agentic_chat_personas-edit/view`,
  `field-agentic_chat_panel-edit/view`, and
  `field-agentic-chat-personas-select-edit/view` for CMS integration.
- **Curated persona multi-select for sections.** Custom field type
  `agentic-chat-personas-select` and section-level field
  `agentic_chat_personas_to_use` (CSV string of persona keys; the
  underlying `<select multiple>` posts as an array which the core
  `CmsUpdateController` implodes with commas before persistence).
  The CMS hooks `field-agentic-chat-personas-select-edit/view` (handler
  `AgenticChatHooks::outputFieldPersonasSelectEdit/View`) render a
  Bootstrap multi-select pre-populated with every persona defined on
  the global plugin admin page; editors pick personas by name. The
  backend slot map sent to AG-UI (`mediator` /
  `foundational_instructions` / `inclusive_instructions` /
  `inquiry_instructions`) is rebuilt at runtime by
  `AgenticChatModel::buildBackendSlotMap()` based on each persona's
  `role` and `key`, so admins never need to maintain a slot map by hand.
- **Speech-to-text input.** Section-level fields `enable_speech_to_text`
  (checkbox) and `speech_to_text_model` (`select-audio-model` dropdown,
  registered by `sh-shp-llm`) are linked into the `agenticChat` style
  with sensible defaults. When enabled, a microphone button appears in
  the message input bar; recordings are uploaded to the controller
  action `?action=speech_transcribe` which delegates to
  `LlmSpeechToTextService` from the base `sh-shp-llm` plugin (so MIME
  validation, language detection and Whisper invocation stay
  consistent across both chat surfaces). Client side, the new
  `useSpeechToText` React hook drives the microphone with
  auto-stop-on-silence (2s of silence below RMS 0.01) and a 60-second
  hard limit.
- **LLM-Chat-style input bar (`MessageInput`).** Auto-resizing
  `<textarea>` with Enter-to-send / Shift+Enter newline, microphone
  button (state-aware: idle / recording / processing), inline
  character counter, clear button and submission spinner. Mirrors the
  visual language of `sh-shp-llm`'s chat input without pulling in
  `react-bootstrap` so the agentic UMD bundle stays small.
- **Card-based chat surface (`ChatShell` + `AgenticChat.css`).**
  Bootstrap card with sticky header (icon avatar, title, status
  badge, Start/Reset actions), description markdown row, scrolling
  body, completion banner and footer. Message bubbles use rounded
  corners, soft shadows, gradient user bubbles, code-block styling, a
  blinking-cursor streaming indicator and persona-coloured avatars
  consistent with the LLM chat.
- React entry points:
  - `agentic-chat.umd.js` for the front-end style.
  - `agentic-admin.umd.js` for the configuration admin page.
  - `agentic-threads.umd.js` for the threads / debug viewer admin page.
- Reuse of `llmConversations` and `llmMessages` tables from the base
  `sh-shp-llm` plugin for visible message storage; AG-UI specifics persisted
  in `agenticChatThreads` and the existing `sent_context` JSON column.
- Documentation under `doc/` covering architecture, configuration, persona
  schema, and message-streaming flow.

### Notes
- This plugin **depends on** `sh-shp-llm` being installed first.
- The plugin does **not** call `/health/llm` automatically because doing so
  consumes provider tokens; admins can trigger it manually from the admin
  page.
