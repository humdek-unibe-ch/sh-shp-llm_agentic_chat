# sh-shp-llm_agentic_chat — LLM Agentic Chat Plugin

SelfHelp CMS plugin that integrates an external [AG-UI](https://docs.ag-ui.com/)
backend (such as the FoResTCHAT reflection backend at
`https://tpf-test.humdek.unibe.ch/forestBackend/`) into the SelfHelp page system,
so authors can drop a multi-persona AG-UI chat into any page through a CMS style.

The plugin reuses the storage layer (`llmConversations`, `llmMessages`) and the
admin UX patterns of [`sh-shp-llm`](../sh-shp-llm/), but instead of talking to
an OpenAI-compatible endpoint directly, it streams Server-Sent Events from a
configurable AG-UI workflow server.

> **Plugin name:** `sh-shp-llm_agentic_chat`
> **Plugin DB key:** `llm_agentic_chat`
> **Depends on:** `sh-shp-llm`

---

## Features

- **Shared admin shell** with a left sidebar and two pages:
  - **Configuration** (`/admin/module_llm_agentic_chat`)
  - **Threads** (`/admin/module_llm_agentic_chat/threads`)
  Both reuse the same `AgenticChatAdminLayoutHelper` template so the look &
  feel mirror the `sh-shp-llm` admin module exactly (Bootstrap 4.6, card
  panels, sidebar navigation, etc.).
- **Configuration page** with:
  - AG-UI backend URL (default: `https://tpf-test.humdek.unibe.ch/forestBackend`)
  - Endpoint paths (`/reflect`, `/reflect/configure`, `/health`)
  - Request timeout and default module/reflection content
  - A header button to probe `/health`
  - JSON-backed global **persona library** — an ordered, flexible list
    of teacher personas, edited through a compact card list with an
    inline editor and up/down reordering. The mediator is **built by
    the backend** (toggled per section) and is not authored here.
- **Persona editor** (React): compact summary cards with quick edit /
  duplicate / remove / reorder actions, an inline edit form that opens
  in place, and validation badges for empty names or missing
  descriptions. Each persona has a `name` and a `description` (the
  system prompt sent to the backend); there are no fixed slot types,
  free-form roles, or a separate "personality" field.
- **Threads / debug viewer** lists every `agenticChatThreads` row with:
  - Counter strip (total · idle · running · awaiting · completed · failed)
  - Filters: free-text search, status, user id, section id
  - Paginated table with status badges, message count, token usage
  - Detail pane with three tabs: Messages, Debug (participant map ·
    interrupts · debug events), and Raw (full thread JSON)
  - Per-thread last error surfaced prominently for development triage
- **CMS style `agenticChat`** for the page editor:
  - Standard style fields: `css`, `css_mobile`, `condition`, `debug`, and
    `data_config`.
  - Per-section module/reflection override, an **ordered persona
    selection** (subset of the global library), a **`use_group_chat_mediator`
    toggle** (default on), labels, and completion message.
- **AG-UI streaming proxy:** the controller bridges the front-end and the
  backend SSE stream, persists visible user/assistant text in
  `llmMessages`, and stores AG-UI metadata (thread id, run ids, tool-call
  payloads) in `agenticChatThreads` and the `sent_context` column.
- **Reusable React building blocks** for chat shell, message list, message
  bubble, message input, persona strip, run status, thread actions and
  debug event panel — kept small so they can be composed elsewhere.

## Architecture: the plugin as an AG-UI normalisation bridge

The upstream FoResTCHAT backend speaks an AG-UI-flavoured wire
protocol, but with a handful of inherited quirks that pre-date the
current AG-UI spec:

- Run/thread identifiers arrive in **mixed casing** (`thread_id` *and*
  `threadId`, `run_id` *and* `runId`, `source_executor_id` *and*
  `sourceExecutorId`).
- Interrupts are emitted on a **singular** `RUN_FINISHED.interrupt`
  field with a bespoke `handoff_input` payload, instead of the strict
  AG-UI `RUN_FINISHED.outcome = { type: "interrupt", interrupts: [...] }`
  envelope.
- Resumes are accepted in a legacy
  `{ interrupts: [{ id, value }] }` shape rather than the strict
  AG-UI array of `{ interruptId, status, payload }` entries.
- Per-thread `ReflectionConfig` lives **in process memory only**, so a
  backend restart silently drops module text and persona prompts.

The backend cannot be modified, so this plugin acts as a long-term
compatibility boundary:

- **Upstream side (cURL ↔ backend):** the PHP service layer keeps
  speaking the legacy contract — same paths, same headers, same body
  shapes.
- **Downstream side (PHP ↔ React):** the plugin emits a strict,
  camelCase-only AG-UI stream. The React chat surface, debug viewer,
  and admin tooling never see the legacy quirks above; they consume
  a clean `RUN_FINISHED.outcome` envelope and a strict resume payload.

### Event normalisation

`server/service/AgenticChatEventNormalizer.php` is the single
authority for translating between the two worlds. For every SSE event
it produces a frozen, camelCase-only object:

```jsonc
{
  "type": "TEXT_MESSAGE_CONTENT",
  "messageId": "msg-42",
  "delta": "Hello",
  "authorName": "Mediator",
  "sourceExecutorId": "group_chat_mediator",
  "authorPersonaKey": "mediator",
  "authorSlot": "mediator",
  "_rawLegacy": { /* original backend payload (debug only) */ }
}
```

For `RUN_FINISHED` it additionally rewrites the legacy
`interrupt` field into the strict outcome envelope:

```jsonc
{
  "type": "RUN_FINISHED",
  "runId": "...",
  "outcome": {
    "type": "interrupt",
    "interrupts": [
      {
        "interruptId": "...",
        "reason": "handoff_input",
        "message": "Please provide …",
        "responseSchema": null,
        "metadata": { /* original interrupt metadata */ },
        "sourceExecutorId": "group_chat_mediator",
        "authorPersonaKey": "mediator",
        "rawLegacy": { /* original interrupt payload */ }
      }
    ]
  }
}
```

When the run completes without interrupts the outcome becomes
`{ "type": "complete" }`.

### Resume translation

Internally the React chat models a resume as the strict AG-UI shape:

```ts
type ResumeEntry = {
  interruptId: string;
  status: 'resolved' | 'cancelled';
  payload?: unknown; // e.g. { text: "..." } for handoff_input
};

resume: ResumeEntry[];
```

The controller's `stream_run` action accepts that array (or, for
backwards compatibility, the legacy `{ interrupts: [...] }` object
some older clients still send) and calls
`AgenticChatEventNormalizer::buildLegacyResumePayload()`, which
rebuilds the bespoke backend shape:

```jsonc
{
  "interrupts": [
    {
      "id": "...",
      "value": [
        { "role": "user",
          "contents": [{ "type": "text", "text": "user reply" }] }
      ]
    }
  ]
}
```

This unlocks two long-missing affordances:

1. **All open interrupts** are resumed in a single submit, which
   matters whenever a run accumulates multiple pending interrupts.
2. The default `payload.text` fallback works without a schema, so the
   chat surface can ship a usable text-reply flow for any new
   interrupt reason the backend introduces in the future. Clients can
   override the wire shape per-interrupt via `payload.legacyValue` if
   a future reason needs a different backend body.

### Configure once per thread (never mid-conversation)

The backend's `set_thread_config()` calls `clear_thread_workflow()` on
**every** invocation, which deletes the in-memory workflow for that
thread — including any pending HITL interrupt the backend is waiting
on. Reconfiguring between two runs would therefore wipe the interrupt
id we just persisted and the next resume would fail with
*"No pending requests found in workflow context."*

The plugin consequently calls `/reflect/configure` **exactly once**,
when a thread is first created (`start_thread`), and again only when
the user explicitly **resets** the thread (which mints a brand-new
`agui_thread_id`). Individual `stream_run` calls never reconfigure.

Because `ReflectionConfig` lives only in the backend's process memory,
a backend restart mid-conversation drops the thread's module text and
persona prompts. There is no safe in-place recovery (reconfiguring an
active thread clears its workflow), so the recommended recovery is to
**start a new thread**. Persona/module edits in the CMS likewise apply
only to threads started *after* the change; existing conversations keep
the configuration they were created with.

### Lifecycle reference

```
configure   →   /reflect/configure  (once at start_thread; again on reset)
kickoff/start  →  POST /reflect  (synthetic __auto_start__ token sent once)
stream       →   POST /reflect (SSE), camelCase threadId/runId per turn
interrupt    →   RUN_FINISHED.outcome = { type: "interrupt", … }
resume       →   POST /reflect with strict ResumeEntry[] → legacy body
completion   →   "Case complete." marker closes the thread in UI
reset        →   user starts a new local thread + new backend thread_id
```

See [`doc/agentic-chat-flow.md`](doc/agentic-chat-flow.md) for the full
end-to-end flow.

## Backend assumptions

The plugin targets the FoResTCHAT-style backend whose contract is:

| Method | Path                  | Purpose                                                  |
| ------ | --------------------- | -------------------------------------------------------- |
| GET    | `/health`             | Liveness probe (no LLM cost)                             |
| POST   | `/reflect/configure`  | Per-thread config (module + ordered persona list)        |
| POST   | `/reflect`            | AG-UI run endpoint, response is `text/event-stream`       |

> There is **no** `/reflect/defaults` endpoint. The plugin does not
> fetch defaults from the backend; the global module text and persona
> library are authored entirely in the admin configuration page.

The `/reflect/configure` body is built by
`AgenticChatPersonaService::buildConfigurePayload()` and matches the
backend's `ReflectionConfigureRequest` exactly:

```jsonc
{
  "thread_id": "<agui_thread_id>",
  "module_content": "<resolved section or global module text>",
  "personas": [
    { "name": "Lea", "description": "Foundational teacher who …" },
    { "name": "Anja", "description": "Inclusive teacher who …" }
  ],
  "use_group_chat_mediator": true
}
```

- `personas` is an **ordered** array of `{ name, description }` objects
  (at least one; a neutral fallback persona is emitted if the section
  somehow resolves to none).
- `use_group_chat_mediator` toggles the backend's group-chat mediator.
  When `true` the backend coordinates the personas through a mediator
  agent; when `false` the personas speak directly.

The backend names its agents **positionally** from the persona list:
`group_chat_mediator`, then `persona_1_teacher`, `persona_2_teacher`, …
(1-indexed, matching persona order). The plugin persists a
**participant map** (`mediator → mediator`, `persona_1 → <first key>`,
`persona_2 → <second key>`, …) on the thread so streamed messages can
be attributed to the right persona even after a page refresh.

### Persona authoring model

Personas are authored globally as an **ordered, flexible list**. Each
persona carries:

| Field         | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `key`         | Stable internal slug (auto-derived from name; not edited)     |
| `name`        | Display name **and** backend persona `name`                   |
| `description` | System prompt sent to the backend as `description`            |
| `color`       | CSS hex colour for the avatar bubble                          |
| `avatar`      | Emoji / short label / image URL / asset path                  |
| `enabled`     | Excludes the persona from selection + fallback when `false`   |

There are no fixed slot types and no "role" / "personality" fields. The
persona summary card previews the first sentence of `description`.

Section-level resolution (`AgenticChatPersonaService::resolvePersonas()`):

1. If the section curated persona keys via `agentic_chat_personas_to_use`,
   use them **in selection order**, dropping unknown, disabled, or
   duplicate keys.
2. Otherwise fall back to **every enabled** persona in the global
   library, in library order.

The mediator is never a persona — it is built by the backend and
toggled per section via `agentic_chat_use_group_chat_mediator`. The
plugin keeps a read-only mediator descriptor (name + avatar + colour)
in PHP so the chat UI can render mediator messages consistently.

Avatar values can point to plugin assets such as
`/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg`.

### Turn ownership and persona attribution

On the wire, the FoResTCHAT backend signals which executor is currently
"holding the mic" through `STEP_STARTED.stepName` (and
`ACTIVITY_SNAPSHOT.content.executor_id`); the `TEXT_MESSAGE_*` deltas
inside that step do **not** repeat the author. The PHP normaliser
(`AgenticChatEventNormalizer`) therefore tracks the current executor as
streaming state and back-fills `authorName` / `sourceExecutorId` /
`authorPersonaKey` on every text/tool event that did not carry them
itself. That metadata is persisted into `llmMessages.sent_context` so
the React chat can resolve the right avatar/name from each message
even after a refresh.

### Multi-agent turn taking

When `use_group_chat_mediator` is **on**, the backend's group-chat
workflow is **mediator-led, not round-robin**. The mediator
(`group_chat_mediator`) drives the conversation and only hands off to
one of the configured personas (`persona_1_teacher`, `persona_2_teacher`,
… in persona order) when its prompt decides that a specialist
contribution will genuinely advance the reflection — i.e. several
mediator-user exchanges typically happen before any persona speaks, and
the personas always hand back to the mediator afterwards. This is the
upstream design (see `app/services/reflection_service.py` on the
backend); the plugin honours it. Concretely:

- Each turn surfaces exactly one streaming bubble at a time, attributed
  to whichever executor is active for that step (resolved through the
  thread's participant map).
- After a persona contribution, expect the mediator to speak again
  before another persona is invoked.
- The chat separates the **current speaker** from a pending **handoff
  target**: a `handoff_to_<x>` tool call shows "Handing off to X"
  without prematurely switching the active speaker.

When `use_group_chat_mediator` is **off**, there is no mediator agent;
the configured personas speak directly and the UI never renders a
mediator bubble.

## Plugin structure

```
sh-shp-llm_agentic_chat/
├── README.md
├── CHANGELOG.md
├── server/
│   ├── component/
│   │   ├── AgenticChatHooks.php                  Hook implementations (CMS field overrides)
│   │   ├── style/agenticChat/                    agenticChat CMS style
│   │   ├── moduleAgenticChatShared/              Shared admin sidebar layout helper
│   │   ├── sh_module_llm_agentic_chat/           Admin module: configuration page
│   │   └── sh_module_llm_agentic_chat_threads/   Admin module: threads / debug viewer
│   ├── service/
│   │   ├── globals.php                    Plugin constants + endpoint paths
│   │   ├── AgenticChatBackendClient.php   Thin HTTP client for the AG-UI backend
│   │   ├── AgenticChatEventNormalizer.php Legacy↔strict AG-UI normalisation bridge
│   │   ├── AgenticChatPersonaService.php  Persona CRUD + JSON validation
│   │   ├── AgenticChatThreadService.php   agenticChatThreads CRUD + message persistence
│   │   └── AgenticChatService.php         Orchestrates configure / start_thread / stream_run
│   ├── constants/AgenticChatLookups.php
│   └── db/v1.0.0.sql                      Migration: page, fields, style, table, hooks
├── react/
│   ├── src/AgenticChat.tsx                 Front-end entry (mounts on .agentic-chat-root)
│   ├── src/AgenticAdmin.tsx                Admin config entry (mounts on #agentic-admin-root)
│   ├── src/AgenticThreads.tsx              Admin threads entry (mounts on #agentic-threads-root)
│   ├── src/components/admin/               BackendSettingsPanel, PersonaEditor, PersonaRow, AdminApp
│   ├── src/components/threads/             ThreadsApp, ThreadList, ThreadDetail, ThreadFilters, ThreadCounters
│   ├── src/components/chat/                Chat shell, message list, persona strip, …
│   ├── src/hooks/                          useAgenticThread, useAgUiStream, …
│   ├── src/types/                          Shared TS interfaces
│   └── src/utils/                          api.ts, ag-ui-events.ts, sse-parser.ts, …
├── gulp/                                  Gulp wrapper around `npm run build`
├── js/ext/                                Built UMD bundles
├── css/ext/                               Built CSS
└── doc/                                   Architecture and integration notes
```

## Build

```bash
cd gulp
npm install
gulp react-install
gulp build
```

The build produces:

- `js/ext/agentic-chat.umd.js` (front-end style)
- `js/ext/agentic-admin.umd.js` (admin module – configuration page)
- `js/ext/agentic-threads.umd.js` (admin module – threads / debug viewer)
- `css/ext/agentic-chat.css`
- `css/ext/agentic-admin.css`
- `css/ext/agentic-threads.css`
- `css/ext/agentic-admin-layout.css` (sidebar layout shared by both admin pages)

## License

MPL-2.0
