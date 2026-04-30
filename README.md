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

- **Global configuration page** at `/admin/module_llm_agentic_chat`:
  - AG-UI backend URL (default: `https://tpf-test.humdek.unibe.ch/forestBackend`)
  - Endpoint paths (`/reflect`, `/reflect/configure`, `/reflect/defaults`, `/health`)
  - Request timeout, debug-event visibility, default module/reflection content
  - JSON-backed array of **personas**
- **Persona editor** (React): editable rows/cards per persona with key,
  display name, role slot, personality / instructions, color & avatar
  metadata, and an enabled flag. Validates keys, rejects duplicates, and
  recovers from invalid JSON.
- **CMS style `agenticChat`** for the page editor:
  - Per-section module/reflection content, persona-slot mapping, labels,
    colors, debug-event visibility, and completion message.
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

## Plugin structure

```
sh-shp-llm_agentic_chat/
├── README.md
├── CHANGELOG.md
├── server/
│   ├── component/
│   │   ├── AgenticChatHooks.php           Hook implementations (CMS field overrides)
│   │   ├── style/agenticChat/             agenticChat CMS style
│   │   └── sh_module_llm_agentic_chat/    Admin module for the config page
│   ├── service/
│   │   ├── globals.php                    Plugin constants + endpoint paths
│   │   ├── AgenticChatBackendClient.php   Thin HTTP client for the AG-UI backend
│   │   ├── AgenticChatPersonaService.php  Persona CRUD + JSON validation
│   │   ├── AgenticChatThreadService.php   agenticChatThreads CRUD + message persistence
│   │   └── AgenticChatService.php         Orchestrates start_thread / stream_run
│   ├── constants/AgenticChatLookups.php
│   └── db/v1.0.0.sql                      Migration: page, fields, style, table, hooks
├── react/
│   ├── src/AgenticChat.tsx                Front-end entry (mounts on .agentic-chat-root)
│   ├── src/AgenticAdmin.tsx               Admin entry (mounts on #agentic-admin-root)
│   ├── src/components/                    Chat shell, message list, persona editor, …
│   ├── src/hooks/                         useAgenticThread, useAgUiStream, …
│   ├── src/types/                         Shared TS interfaces
│   └── src/utils/                         api.ts, ag-ui-events.ts, sse-parser.ts, …
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
- `js/ext/agentic-admin.umd.js` (admin module)
- `css/ext/agentic-chat.css`
- `css/ext/agentic-admin.css`

## License

MPL-2.0
