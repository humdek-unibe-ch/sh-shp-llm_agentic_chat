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
  - JSON-backed global **persona library** edited through a compact card
    list (avatar, name, role, key, enabled flag) + inline edit form
- **Persona editor** (React): compact summary cards with quick edit /
  duplicate / remove actions, an inline edit form that opens in place, and
  validation badges for empty names, duplicate keys, missing instructions,
  etc. Modelled after the API-keys editor in `sh-shp-llm`.
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

## Backend assumptions

The plugin targets the FoResTCHAT-style backend whose contract is:

| Method | Path                  | Purpose                                                  |
| ------ | --------------------- | -------------------------------------------------------- |
| GET    | `/health`             | Liveness probe (no LLM cost)                             |
| GET    | `/reflect/defaults`   | Default module text + persona instruction templates       |
| POST   | `/reflect/configure`  | Per-thread config (module + 3 persona instruction slots)  |
| POST   | `/reflect`            | AG-UI run endpoint, response is `text/event-stream`       |

For v1 the persona array is mapped onto the **three fixed persona slots**
exposed by this backend:

| Slot                             | Description                              |
| -------------------------------- | ---------------------------------------- |
| `foundational_instructions`      | Foundational teacher persona prompt      |
| `inclusive_instructions`         | Inclusive teacher persona prompt         |
| `inquiry_instructions`           | Inquiry / project-based teacher prompt   |

The `mediator` persona is recognised for display/avatars but is not yet
configurable on the backend; if/when the backend exposes a mediator slot,
the persona system already handles it without further migrations.

Personas are authored globally in the module config. A page section does not
define its own personas; it only stores `agentic_chat_persona_slot_map`, a JSON
object that links backend slots to persona keys. Avatar values can point to
plugin assets such as
`/server/plugins/sh-shp-llm_agentic_chat/assets/avatars/mediator.svg`.

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
│   │   ├── AgenticChatPersonaService.php  Persona CRUD + JSON validation
│   │   ├── AgenticChatThreadService.php   agenticChatThreads CRUD + message persistence
│   │   └── AgenticChatService.php         Orchestrates start_thread / stream_run
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
