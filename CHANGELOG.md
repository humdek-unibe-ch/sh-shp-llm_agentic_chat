# Changelog

All notable changes to the **sh-shp-llm_agentic_chat** plugin are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-30

### Added
- Initial release of the **LLM Agentic Chat** plugin (`sh-shp-llm_agentic_chat`).
- Admin page `sh_module_llm_agentic_chat` at `/admin/module_llm_agentic_chat` with
  configuration fields for the AG-UI backend URL, endpoint paths, request timeout,
  default module/reflection content, and a global persona array (JSON).
- New CMS style **agenticChat** (group `Form`) that renders an AG-UI-aware
  conversation surface and proxies SSE traffic to the configured backend.
- New table `agenticChatThreads` linking local `llmConversations.id` to AG-UI
  thread/run identifiers, persona slot mapping, pending interrupts, completion
  flag, and debug metadata.
- Hooks `agentic-execute-task` (placeholder), `field-agentic_chat_personas-edit/view`,
  and `field-agentic_chat_panel-edit/view` for CMS integration.
- React entry points:
  - `agentic-chat.umd.js` for the front-end style.
  - `agentic-admin.umd.js` for the persona editor on the admin page.
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
