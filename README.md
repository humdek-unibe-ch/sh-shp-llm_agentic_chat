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
  - Endpoint paths (`/reflect`, `/reflect/configure`, `/reflect/defaults`, `/health`)
  - Request timeout and default module/reflection content
  - Header buttons to probe `/health` and fetch `/reflect/defaults`
  - JSON-backed global **persona library** of teacher variants
    (foundational / inclusive / inquiry), edited through a compact
    card list with inline editor. The mediator is **fixed in plugin
    code** and is not configurable, mirroring what the Python backend
    actually supports.
- **Persona editor** (React): compact summary cards with quick edit /
  duplicate / remove actions, an inline edit form that opens in place,
  and validation badges for empty names, missing instructions, unknown
  slot types, etc. Each persona is tagged with exactly one teacher
  slot type — researchers do not see free-form roles or a separate
  "personality" field anymore.
- **Threads / debug viewer** lists every `agenticChatThreads` row with:
  - Counter strip (total · idle · running · awaiting · completed · failed)
  - Filters: free-text search, status, user id, section id
  - Paginated table with status badges, message count, token usage
  - Detail pane with three tabs: Messages, Debug (slot map · interrupts ·
    debug events), and Raw (full thread JSON)
  - Per-thread last error surfaced prominently for development triage
- **CMS style `agenticChat`** for the page editor:
  - Standard style fields: `css`, `css_mobile`, `condition`, `debug`, and
    `data_config`.
  - Per-section module/reflection override, persona-slot mapping by persona
    key, labels, colors, and completion message.
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

### Thread reconfiguration on every run

Because `ReflectionConfig` lives only in the backend's memory, the
controller now calls `/reflect/configure` before **every**
`stream_run`, reusing the same local `agui_thread_id`. The
configuration request is idempotent and adds no LLM cost, but it
guarantees the section's persona prompts and module text survive a
backend restart.

### Lifecycle reference

```
configure   →   /reflect/configure  (always, before each stream_run)
kickoff/start  →  POST /reflect  (synthetic kickoff token sent once)
stream       →   POST /reflect (SSE)
interrupt    →   RUN_FINISHED.outcome = { type: "interrupt", … }
resume       →   POST /reflect with strict ResumeEntry[] → legacy body
completion   →   completion marker closes the thread in UI
reset        →   any non-resume input after completion starts a new thread
```

## Backend assumptions

The plugin targets the FoResTCHAT-style backend whose contract is:

| Method | Path                  | Purpose                                                  |
| ------ | --------------------- | -------------------------------------------------------- |
| GET    | `/health`             | Liveness probe (no LLM cost)                             |
| GET    | `/reflect/defaults`   | Default module text + persona instruction templates       |
| POST   | `/reflect/configure`  | Per-thread config (module + 3 persona instruction slots)  |
| POST   | `/reflect`            | AG-UI run endpoint, response is `text/event-stream`       |

The plugin builds the `/reflect/configure` payload from **three teacher
slots** the backend supports:

| Slot                             | Description                              |
| -------------------------------- | ---------------------------------------- |
| `foundational_instructions`      | Foundational teacher persona prompt      |
| `inclusive_instructions`         | Inclusive teacher persona prompt         |
| `inquiry_instructions`           | Inquiry / project-based teacher prompt   |

The mediator persona is **fixed in the backend** and cannot be
customised through `/reflect/configure`. The plugin keeps a read-only
mediator descriptor (name + avatar + color) in PHP so the chat UI can
render mediator messages consistently, but the admin editor never
shows or saves it.

### Persona authoring model (v1.1.0+)

Personas are authored globally as **slot-tagged variants**. Each persona
in the library carries a single `slot_type` (`foundational` /
`inclusive` / `inquiry`) that maps 1:1 onto a backend slot. Researchers
can author multiple variants of the same slot (e.g. Lea, Mara and Sara
all tagged `foundational`) and pick which one a section uses through
the `agentic_chat_personas_to_use` multi-select.

Section-level resolution rules:

1. For each enabled persona selected on the section, take the first one
   per `slot_type` (in selection order).
2. For any slot type the section did not pick, fall back to the first
   enabled persona of that slot type in the global library.
3. Slots with no enabled persona stay unassigned and the Python backend
   keeps its built-in default for that slot.

There is no "role" field anymore. Generic categories like Expert,
Supporter or Other were removed in v1.1.0 because they did not map to
any backend slot. The separate "personality summary" field was also
removed; the persona summary card now previews the first sentence of
`instructions` instead.

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

The backend's group-chat workflow is **mediator-led, not round-robin**.
The mediator (`group_chat_mediator`) drives the conversation and only
hands off to one of the teacher personas (`foundational_teacher`,
`inclusive_teacher`, `inquiry_teacher`) when its prompt decides that a
specialist contribution will genuinely advance the reflection — i.e.
several mediator-user exchanges typically happen before any teacher
speaks, and the teachers always hand back to the mediator afterwards.
This is the upstream design (see `app/services/reflection_service.py`
on the backend); the plugin honours it. Concretely:

- Each turn surfaces exactly one streaming bubble at a time, attributed
  to whichever executor is active for that step.
- After a teacher contribution, expect the mediator to speak again
  before another teacher is invoked.
- If the user wants every teacher to comment on every turn, that has
  to be changed in the backend's mediator instructions; the plugin is
  intentionally not "speaking on behalf of" silent agents.

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
