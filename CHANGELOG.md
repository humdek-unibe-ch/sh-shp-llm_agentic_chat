# Changelog

All notable changes to the **sh-shp-llm_agentic_chat** plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-28

### Fixed
- **Chat now actually talks to the live FoResTCHAT backend.** The upstream
  `https://tpf-test.humdek.unibe.ch/forestBackend/` rewrote `/reflect/configure`
  to use positional persona slots: it now requires
  `persona_<N>_name` **and** `persona_<N>_instructions` for `N in 1..3` (the
  old semantic-slot keys `foundational_instructions`, `inclusive_instructions`,
  `inquiry_instructions` no longer exist). The plugin's configure builder
  was still sending the old keys and omitting the names, so every
  configure call returned `422 Validation Error` and the first
  `/reflect` run died with "thread not configured". The configure
  payload is now `{thread_id, module_content, persona_1_name,
  persona_1_instructions, persona_2_name, persona_2_instructions,
  persona_3_name, persona_3_instructions}` exactly as the backend's
  `ReflectionConfigureRequest` Pydantic model requires, and the same
  `agui_thread_id` is reused for every subsequent `/reflect` stream
  so the conversation continues in place.
- **Persona attribution restored after the backend renamed its agents.**
  `HandoffBuilder` now names participants `persona_1_teacher`,
  `persona_2_teacher`, `persona_3_teacher` (plus the fixed
  `group_chat_mediator`). The plugin's executor → slot map still had
  the old `foundational_teacher` / `inclusive_teacher` / `inquiry_teacher`
  ids, so every assistant message was attributed to an unknown
  executor and rendered with the generic "Assistant" avatar. The
  normaliser now maps `persona_<N>_teacher` to the positional
  `persona_<N>` slot and keeps the legacy executor ids as fallbacks
  for older threads.
- **Empty libraries no longer 422 the configure call.** The backend
  enforces `minLength: 1` on `persona_<N>_name`, so sections whose
  curated persona set leaves a slot unfilled were rejected outright.
  `buildConfigurePayload()` now falls back to the labels in
  `AGENTIC_CHAT_SLOT_DEFAULTS` (Teacher 1 / 2 / 3 with neutral
  prompts) for any slot the admin hasn't authored a persona for, and
  to a neutral module sentence when `agentic_chat_default_module` is
  blank. The resulting workflow still runs end-to-end against the
  live backend; the admin just gets generic teacher voices until they
  finish authoring their library.

### Changed
- **Positional backend slots replace semantic backend slots.**
  `AGENTIC_CHAT_BACKEND_SLOTS` is now
  `[mediator, persona_1, persona_2, persona_3]`. Authoring stays
  unchanged — admins keep tagging personas as `foundational` /
  `inclusive` / `inquiry`; the plugin internally maps each slot type
  onto the matching positional slot for the configure call and the
  speaker-attribution lookup. The persona strip now shows friendly
  "Teacher 1 / 2 / 3" labels for the positional slots in its tooltip.

## [0.2.0] - 2026-05-19

### Fixed
- **Assistant messages now display the correct persona name + avatar
  instead of a generic "Assistant" label.** The FoResTCHAT backend
  emits `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` events without an
  `author_name` field — the executor name is only available on the
  surrounding `STEP_STARTED.stepName`. The PHP event normaliser is now
  stateful for the lifetime of a single stream: it tracks the current
  executor from each `STEP_STARTED` / `ACTIVITY_SNAPSHOT` event and
  back-fills `authorName`, `sourceExecutorId`, `authorSlot` and
  `authorPersonaKey` on every TEXT_MESSAGE_* and TOOL_CALL_* event that
  did not carry them itself. Both the streaming in-flight bubble and
  the persisted `llmMessages.sent_context` row now see the resolved
  persona, so refreshing the page no longer loses speaker attribution.
- **Pending-interrupt cards now identify the correct speaker.** The
  legacy `RUN_FINISHED.interrupt[].value` payload buries the author
  inside `agent_response.messages[i].author_name` (not at
  `agent_response.author_name` as some older docs suggest).
  `normalizeInterrupt()` now walks the messages list from the end and
  picks up the most recent assistant author there. The
  `currentExecutorId` fallback is only applied when neither the
  top-level interrupt nor the agent_response messages name a speaker,
  so the trailing silent `superstep:1` fan-out (whose last
  `STEP_STARTED` is always `inquiry_teacher`) no longer mis-attributes
  every mediator interrupt to the inquiry-teacher persona. The yellow
  "Reply to continue" card now shows the mediator's name + avatar.
- **Interrupt card no longer repeats the assistant message.** The
  FoResTCHAT backend echoes the last assistant turn inside its
  `HandoffAgentUserRequest` payload, which made the chat appear to
  print the same paragraph twice (once as a normal bubble, once as
  the card body). `InterruptPromptCard` now compares the interrupt
  body against the most recent assistant message and suppresses it
  when they match; the card is reduced to a small "Waiting for your
  reply from &lt;persona&gt;" status hint sitting under the bubble.
- **Streaming bubble no longer "flashes" into the persisted bubble.**
  React previously keyed the in-flight streaming bubble as
  `buf-<messageId>` and the finalised persisted bubble as
  `id-<optimisticId>`. At TEXT_MESSAGE_END the in-flight key
  disappeared and a brand-new optimistic key appeared, so React tore
  the bubble down and rebuilt it from scratch — perceived by the
  user as a brief reload glitch. Both branches now key on
  `msg-<messageId>` (with `id-<optimisticId>` as the fallback for
  rows that have no AG-UI message id, e.g. user input and historical
  snapshots). React reconciles the same DOM node in place and only
  updates the changed props (the typing class drops off, the
  timestamp is added) so the transition is visually seamless.
- **SSE streaming is no longer buffered by Apache.** `startSseStream`
  now adds `Content-Encoding: identity`, opts out of `mod_deflate`
  via `apache_setenv('no-gzip', '1')`, disables ini-level
  `zlib.output_compression`, and emits a ~2KB SSE comment as initial
  padding to overcome the default Chrome / Apache response-buffer
  thresholds. Without these fences the React client only saw the
  assembled `TEXT_MESSAGE_*` deltas after the upstream Python
  workflow completed, so the chat appeared to print the entire reply
  in one chunk; with them the deltas reach the browser as they are
  produced and the bubble visibly types token-by-token.
- **Resume turns no longer fail with "No pending requests found in
  workflow context."** Upstream `set_thread_config()` calls
  `clear_thread_workflow(thread_id)` on every invocation, which deletes
  the in-memory workflow state for the thread — including any HITL
  interrupts the backend is waiting on. The controller used to
  reconfigure the thread before every `stream_run`, so on every resume
  turn we wiped the interrupt id we had just persisted and the backend
  immediately rejected the resume payload. Configuration now happens
  exactly once per thread (in `actionStartThread`, and again when the
  user explicitly resets the thread); subsequent `stream_run` calls
  reuse the backend's existing workflow state. Backend restarts in the
  middle of a conversation remain a known limitation: when the upstream
  process is restarted, the user has to start a new thread to recover
  custom personas/module text.

### Breaking
- **Persona data model simplified to match the Python backend.** The
  Python reflection backend at `D:\TPF\SelfHelp\llm-forestchat-backend`
  only supports three configurable teacher slots
  (`foundational_instructions`, `inclusive_instructions`,
  `inquiry_instructions`) plus a fixed, non-configurable mediator. The
  plugin now mirrors that reality:
  - `Persona.role` (mediator / teacher / expert / supporter / other) is
    **removed**. Every persona must declare a `slot_type` of
    `foundational`, `inclusive` or `inquiry` instead.
  - `Persona.personality` is **removed**. The persona summary card now
    previews the first sentence of `instructions` instead.
  - `Persona.key` is now **hidden** from the admin editor and
    auto-derived from the display name. Duplicates are suffixed
    automatically by the PHP normaliser during save.
  - The mediator persona is **no longer authored** through the admin
    library. It lives as a fixed PHP constant
    (`AGENTIC_CHAT_MEDIATOR_PERSONA` in `globals.php`) and is exposed
    to the React chat as `AgenticChatConfig.mediator` for avatar/name
    rendering only.
  - `agenticChatPersonaRole` lookup rows and the matching PHP
    constants are removed. Slot types are declared in `globals.php`
    as `AGENTIC_CHAT_PERSONA_SLOT_TYPES`.
  - Section selection now uses the persona's `slot_type` to map onto
    backend slots directly. The legacy "role + key contains
    foundational" heuristic in `AgenticChatModel::buildBackendSlotMap`
    is gone.
  - When a section selects more than one persona for the same slot,
    the first one in selection order wins. When a section does not
    select a persona for a slot, the plugin falls back to the first
    enabled persona of that slot type in the global library.
  - The default section-level `agentic_chat_personas_to_use` value is
    now empty (i.e. "use global fallbacks").
- Migration note: nothing is released yet, so the database can simply
  be rebuilt from `server/db/v1.0.0.sql`. The persona normaliser is
  forgiving with legacy JSON (unknown `slot_type` falls back to
  `foundational`, `role`/`personality` are silently ignored).

### Changed
- **The plugin is now an AG-UI normalisation bridge.** The upstream
  FoResTCHAT backend speaks an AG-UI-flavoured wire protocol with a few
  inherited quirks (mixed snake/camel identifiers, singular
  `RUN_FINISHED.interrupt` arrays, bespoke `handoff_input` interrupt
  payloads, in-memory thread config that drifts on restart). The
  backend cannot be modified, so the plugin now acts as a compatibility
  layer: legacy on the upstream side, strict AG-UI on the React side.
  - New PHP service `AgenticChatEventNormalizer` rewrites every event
    leaving the bridge: identifier fields are camelCase only,
    `RUN_FINISHED` carries an explicit `outcome` envelope
    (`{ type: "interrupt", interrupts: [...] }` or
    `{ type: "complete" }`), interrupts are flattened into the strict
    `PendingInterrupt` shape (`interruptId`, `reason`, `message`,
    `responseSchema`, `metadata`, `sourceExecutorId`,
    `authorPersonaKey`, `rawLegacy`), and the original backend payload
    is preserved under `_rawLegacy` for the debug surface.
  - `AgenticChatService::streamRun()` now forwards **normalised**
    events to the controller instead of raw cURL chunks. The
    controller re-serialises each event as a single `data: <json>\n\n`
    SSE block so React always sees clean framing regardless of how
    cURL chunked the upstream bytes.
  - Speaker metadata (`authorName`, `sourceExecutorId`, `authorSlot`,
    `authorPersonaKey`, `messageId`, `runId`) is now persisted to
    `llmMessages.sent_context` alongside the assistant text, so the
    chat surface can resolve the correct avatar and display name from
    the message itself rather than from transient handoff state. This
    fixes a regression where a page refresh during an active
    conversation would render every prior assistant message with the
    default avatar.
- **Resume payloads use the strict AG-UI shape end-to-end.** The React
  chat now sends resumes as
  `Array<{ interruptId, status: 'resolved' | 'cancelled', payload? }>`
  and submits **every** open interrupt in one go (previously only the
  most recent interrupt was resumed, which silently stranded older
  pending interrupts on multi-pause workflows). The PHP bridge
  translates the strict array back into the backend's legacy
  `{ interrupts: [{ id, value }] }` payload via the new
  `AgenticChatEventNormalizer::buildLegacyResumePayload()` helper. The
  default builder turns `payload.text` into the canonical handoff_input
  shape (`[{ role: "user", contents: [{ type: "text", text }] }]`) used
  by the FoResTCHAT workflow; clients can override via
  `payload.legacyValue` if they need a custom backend shape.

### Added
- **Rich interrupt prompt cards.** When a run pauses on a HITL
  interrupt the chat body renders a normalised
  `InterruptPromptCard` for every open interrupt, showing the
  persona avatar, display name, prompt text (`PendingInterrupt.message`),
  and reason badge (`handoff_input`, `approval`, …). Multiple
  simultaneous interrupts are paginated with a "N of M" counter. In
  debug mode each card also exposes the raw backend payload through a
  collapsed `<details>` block.
- **Backend thread is reconfigured before every run.** The upstream
  backend stores its per-thread `ReflectionConfig` in process memory
  only, so a backend restart between two turns previously caused the
  conversation to silently fall back to the built-in defaults.
  `AgenticChatController::actionStreamRun()` now calls
  `/reflect/configure` on every `stream_run`, reusing the same local
  `agui_thread_id`. The configure call is idempotent (no LLM traffic)
  and guarantees the personas + module content the editor configured
  remain in effect across restarts.

### Security
- **Streamed assistant Markdown no longer allows raw HTML.** The
  `MessageBubble` component dropped the `rehype-raw` plugin from the
  assistant rendering path so a malicious or hallucinated `<script>`
  payload in an LLM response can no longer mount into the chat
  surface. Admin-authored descriptive markdown in `ChatShell` (chat
  header description, completion message) keeps `rehype-raw` because
  the source there is trusted CMS content, not LLM output.

### Notes
- This release is fully backwards compatible at the database level —
  the `agenticChatThreads` schema is unchanged. Older `pending_interrupts`
  rows that still carry the legacy `{ id, value }` shape are coerced
  into the strict `PendingInterrupt` shape on the fly by
  `AgenticChatController::presentThread()`.
- The strict resume body shape also accepts the legacy
  `{ interrupts: [...] }` object for backward compatibility — older
  React clients that still send the old shape continue to work
  unchanged.

## [0.1.0] - 2026-05-01

### Fixed
- **Stable `agui_thread_id` across the conversation lifetime.** Every
  `stream_run` for a section now reuses the very same AG-UI `thread_id`
  that `getOrCreateThread()` produces on first interaction, both in the
  `/reflect/configure` payload (persona registration) and in every
  subsequent `/reflect` SSE call. When the React client jumps straight
  to `stream_run` without an explicit `start_thread` (auto-start
  disabled, manual send from a fresh tab, page refresh of a
  never-configured thread), the controller now lazily POSTs the
  personas + module content to `/reflect/configure` for that same
  `thread_id` before streaming, instead of streaming into an
  unregistered thread on the backend (which previously appeared to the
  user as "each request generates a new thread_id" because the backend
  could not correlate history without a prior configure call). The
  configure round-trip is gated on `persona_slot_map IS NULL`, so it is
  a no-op once the thread has been registered. `stream_run` also lifts
  PHP's `max_execution_time` ceiling now (mirroring `start_thread` /
  `reset_thread`) so the auto-configure step on a cold backend never
  triggers a 504 mid-stream.

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
- **Fresh-thread sequence panel** in the Debug tab: generates a brand-new
  `thread_id`, renders a paired `(configure → reflect)` block bound to it,
  and lets admins replay the full upstream flow from Postman starting from
  a clean conversation. Existing per-thread cards now also display the
  bound `thread_id` badge so the shared id between `configure` and
  `reflect` calls is obvious at a glance.

### Fixed
- **Upstream `RUN_ERROR` events are now persisted as `last_error` and
  flip the thread to `failed` status.** Previously the cURL HTTP code
  was 200 (the upstream server returns 200 even when the AG-UI workflow
  fails mid-stream with a `data: RUN_ERROR ...` event), so the service
  treated the run as successful and cleared `last_error` on the thread
  row. The threads viewer therefore showed `idle` with no diagnostic
  context for issues like the `agent_framework` *"Response with id
  resp_… not found"* OpenAI 404. Both error paths (HTTP-level and
  in-stream) are now mapped to the same `failed` outcome.

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
