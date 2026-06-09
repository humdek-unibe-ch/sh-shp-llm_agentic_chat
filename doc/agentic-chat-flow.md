# Agentic Chat — end-to-end flow

This document describes the full lifecycle of an agentic chat thread, from
section configuration through streaming, interrupts, completion, and reset.
It is the companion to the [plugin README](../README.md) and reflects the
**current** FoResTCHAT backend contract (no `/reflect/defaults`, ordered
flexible personas, optional group-chat mediator).

> **Audience:** developers maintaining the plugin and admins debugging a
> thread in the admin **Threads** viewer.

---

## Actors

| Actor             | Role                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| **React chat**    | Browser UI. Speaks strict, camelCase-only AG-UI. Never sees backend quirks.   |
| **PHP controller**| `AgenticChatController`. Same-origin endpoint + SSE proxy + normaliser.        |
| **PHP service**   | `AgenticChatService`. Orchestrates configure / stream / persistence.          |
| **Backend**       | External AG-UI workflow server (`/reflect`, `/reflect/configure`, `/health`). |

The PHP layer is a **normalisation bridge**: it sends requests in the shape
the backend accepts (snake_case configure body, camelCase run body) and
rewrites every SSE event into a strict camelCase AG-UI shape before
forwarding it to React. See the README section *“the plugin as an AG-UI
normalisation bridge”*.

---

## Same-origin request surface

All calls go to the section's controller URL with an `action` parameter and a
validated `section_id` (so multiple `agenticChat` instances coexist on a page):

| Action              | Method | Purpose                                                  |
| ------------------- | ------ | -------------------------------------------------------- |
| `get_config`        | GET    | Live React config snapshot (mirrors `data-config`).      |
| `get_thread`        | GET    | Active thread + visible message history.                 |
| `start_thread`      | POST   | Create/resolve a thread and **configure** it once.       |
| `stream_run`        | POST   | Run a single AG-UI turn; returns `text/event-stream`.    |
| `reset_thread`      | POST   | Complete the current thread and create a fresh one.      |
| `speech_transcribe` | POST   | Optional Whisper transcription of a recorded clip.       |

---

## 1. Configure the thread

A thread is configured **exactly once**, when it is first created via
`start_thread`. The PHP service resolves three inputs from the CMS section:

1. **Ordered personas** — the section's curated selection
   (`agentic_chat_personas_to_use`, in selection order) or, when empty, every
   enabled persona from the global library in library order
   (`AgenticChatPersonaService::resolvePersonas()`).
2. **Module content** — the section field `agentic_chat_context` if set,
   otherwise the global `agentic_chat_default_module`
   (`AgenticChatModel::getModuleContent()`).
3. **Mediator toggle** — `agentic_chat_use_group_chat_mediator` (default on).

It then POSTs `/reflect/configure` with the **exact backend contract**
(snake_case body):

```jsonc
{
  "thread_id": "<agui_thread_id>",
  "module_content": "<resolved section or global module text>",
  "personas": [
    { "name": "Lea",  "description": "Foundational teacher who …" },
    { "name": "Anja", "description": "Inclusive teacher who …" }
  ],
  "use_group_chat_mediator": true
}
```

### Participant map

At configure time the service persists a **participant map** on the thread
(`agenticChatThreads.persona_slot_map`). It binds each positional backend
slot to the persona key that occupies it:

```jsonc
{ "mediator": "mediator", "persona_1": "lea", "persona_2": "anja" }
```

The backend names its run-time agents positionally — `group_chat_mediator`,
`persona_1_teacher`, `persona_2_teacher`, … — so this map is what lets the
plugin attribute streamed messages to the right persona **even after a page
refresh** (the map is reloaded from the thread row, not recomputed from a
possibly-changed section config).

---

## 2. Start with `__auto_start__`

When the section has auto-start enabled, the React chat immediately fires a
`stream_run` whose `message` is the literal kickoff token `__auto_start__`.
The backend's mediator recognises this token and opens the conversation; the
plugin **does not** persist the token into `llmMessages` (it is silent).

If auto-start is off, the first `stream_run` is triggered by the user's first
message instead.

---

## 3. Stream `/reflect`

Each turn mints a fresh `runId` (UUID) and reuses the persisted
`agui_thread_id`. The run body is **camelCase** (AG-UI `RunAgentInput`):

```jsonc
{
  "threadId": "<agui_thread_id>",
  "runId": "<fresh-uuid>",
  "state": {},
  "tools": [],
  "context": [],
  "forwardedProps": {},
  "messages": [ { "id": "...", "role": "user", "content": "…" } ]
}
```

> `messages` carries **at most one** entry (the new user turn). The backend
> keeps the full history per `thread_id`; resending it would duplicate
> messages. On a resume turn `messages` is empty (see §5).

The backend responds with `text/event-stream`. The PHP service:

1. **Re-frames split chunks.** cURL hands over arbitrary byte chunks that
   often split an event mid-JSON. `parseSseChunk()` keeps a stateful buffer
   and only emits complete `data: {…}` events.
2. **Normalises every event** to strict camelCase AG-UI via
   `AgenticChatEventNormalizer`, resolving the speaker from
   `STEP_STARTED.stepName`, `ACTIVITY_SNAPSHOT.content.executor_id`, or
   explicit event metadata, then mapping that executor through the
   participant map to `authorSlot` + `authorPersonaKey`.
3. **Forwards** each normalised event to React as a clean `data: <json>\n\n`
   block, and **persists** finalised assistant text into `llmMessages` with
   its speaker metadata in `sent_context`.

### Speaker vs handoff target (React)

The chat separates two distinct concepts:

- **Current speaker** — whoever is actively streaming (`authorPersonaKey`).
- **Handoff target** — the persona named by an in-flight
  `handoff_to_<x>` tool call. The UI shows *“Handing off to X”* **without**
  switching the active speaker until the target actually starts a message.

### Run-status states

The status badge surfaces, in priority order:

`configuring` → `running` / *“X is typing…”* → *“Handing off to Y”* →
`awaiting_input` (*“Waiting for your reply”*) → `completed` → `failed`.

---

## 4. Persist the local thread id

The very first SSE event the proxy emits is a synthetic
`PROXY_THREAD_INFO` carrying the `agui_thread_id` and local
`conversationId`. The React chat persists the thread id locally so that a
refresh re-attaches to the same backend thread and replays history from
`llmMessages` (with speaker attribution from the participant map).

---

## 5. Resume interrupts (HITL)

When a run pauses for human input, the backend ends it with a (legacy)
`RUN_FINISHED.interrupt`. The normaliser rewrites this into the strict
outcome envelope:

```jsonc
{
  "type": "RUN_FINISHED",
  "outcome": {
    "type": "interrupt",
    "interrupts": [ { "interruptId": "…", "reason": "handoff_input",
                      "message": "…", "authorPersonaKey": "mediator" } ]
  }
}
```

The thread status becomes `awaiting_input` and the pending interrupts are
persisted on the thread row. The React chat shows an explicit
**“Waiting for your reply”** state (never a misleading “Ready”).

To resume, the chat sends the next `stream_run` with a strict resume array:

```ts
resume: Array<{ interruptId: string; status: 'resolved' | 'cancelled'; payload?: unknown }>
```

The controller translates this back into the backend's legacy
`{ interrupts: [{ id, value }] }` shape via
`AgenticChatEventNormalizer::buildLegacyResumePayload()`. On a resume turn
the user reply travels inside the resume payload, so the run body's
`messages` array is empty.

---

## 6. Complete the case

When an assistant message ends with the marker **`Case complete.`**
(`AGENTIC_CHAT_CASE_COMPLETE_MARKER`), the service marks the thread
`completed` / `is_completed = 1`. The React chat renders the completion
message and disables further input for that thread.

---

## 7. Reset / new thread

“Start a new thread” (`reset_thread`) marks the current thread completed and
creates a **new local `agenticChatThreads` row with a new
`agui_thread_id`**, then configures that fresh thread once. It does **not**
reconfigure the old thread.

### Why we never reconfigure an active thread

The backend's `set_thread_config()` calls `clear_thread_workflow()` on every
invocation, deleting the in-memory workflow for that thread — **including any
pending HITL interrupt**. Reconfiguring between two runs would wipe the
interrupt id we just persisted and the next resume would fail with
*“No pending requests found in workflow context.”*

Therefore configure runs **only** at `start_thread` and at `reset_thread`
(which targets a brand-new thread id). Individual `stream_run` turns never
reconfigure.

---

## Backend memory & recovery

Per-thread `ReflectionConfig` (module text + personas + mediator flag) lives
in the **backend's process memory only**. Consequences:

- **Backend restart mid-thread** silently drops the thread's configuration.
  There is no safe in-place recovery — reconfiguring an active thread clears
  its workflow (and any pending interrupt). The recommended recovery is to
  **start a new thread**.
- **Persona / module edits apply to new threads only.** Changing the
  section's persona selection, persona library, mediator toggle, or module
  text does **not** alter conversations already in progress; those keep the
  configuration they were created with. The change takes effect the next time
  a thread is started (or reset).

---

## Status reference

`agenticChatThreads.status` values (`server/service/globals.php`):

| Status           | Meaning                                                        |
| ---------------- | ------------------------------------------------------------- |
| `configuring`    | `/reflect/configure` in flight.                               |
| `idle`           | Configured / between turns; ready to run.                     |
| `running`        | A `/reflect` run is streaming.                                |
| `awaiting_input` | Run finished with an interrupt; waiting for the user's reply. |
| `completed`      | `Case complete.` marker seen; thread closed.                  |
| `failed`         | HTTP error or in-stream `RUN_ERROR`; see `last_error`.        |

---

## Admin Threads playground

The admin **Threads** detail view exposes copy-paste payloads that match the
backend contract exactly, so they can be pasted straight into curl/Postman:

- **Configure body** — snake_case `{ thread_id, module_content, personas,
  use_group_chat_mediator }`, rebuilt from the thread's persisted participant
  map + mediator flag.
- **Run body** — camelCase `{ threadId, runId, … }` with a fresh `runId` and
  message id per copy.

A “fresh sequence” recipe mints a brand-new `thread_id` and rebinds both
bodies to it for a clean configure → run test.

---

## Verification & manual QA checklist

The plugin has no automated test harness; the following manual checks cover
the behaviours touched by the ordered-persona / mediator refactor. Run them
against a live backend (or the admin Threads playground for payload shapes).

### Payload / normalisation checks

- [ ] **Configure payload shape** — `start_thread` POSTs `/reflect/configure`
      with exactly `{ thread_id, module_content, personas:[{name,description}],
      use_group_chat_mediator }` (snake_case). Verify in the admin Threads
      playground “Configure body”.
- [ ] **Ordered persona attribution** — with personas `[Lea, Anja]`, the
      participant map persists `{mediator:mediator, persona_1:lea,
      persona_2:anja}`; streamed `persona_2_teacher` turns render as Anja.
- [ ] **Mediator on** — `use_group_chat_mediator:true` shows mediator bubbles
      and mediator-led handoffs.
- [ ] **Mediator off** — `use_group_chat_mediator:false` produces no mediator
      bubble; personas speak directly.
- [ ] **Split SSE parsing** — long assistant turns persist intact in
      `llmMessages` (no dropped characters at chunk boundaries).
- [ ] **RUN_FINISHED interrupt normalisation** — an interrupt arrives as
      `outcome:{type:"interrupt",interrupts:[{interruptId,…}]}`; status becomes
      `awaiting_input`.
- [ ] **Resume payload generation** — replying to an interrupt sends a strict
      `resume:[{interruptId,status,payload}]`; the controller rebuilds the
      legacy `{interrupts:[{id,value}]}` body and the run continues.
- [ ] **Thread reset** — “Start a new thread” creates a new
      `agenticChatThreads` row + new `agui_thread_id`, configures it once, and
      does not touch the old thread.
- [ ] **Run body casing** — `/reflect` body uses camelCase `threadId`/`runId`.

### Manual QA flows

- [ ] **Mediated auto-start** — section with mediator on + auto-start: opening
      the page kicks off with `__auto_start__`; mediator opens the case.
- [ ] **Direct persona mode** — mediator off: first user message is answered
      by a persona directly.
- [ ] **User turn** — typing a reply streams the next speaker; the badge shows
      “X is typing…”.
- [ ] **HITL resume** — answer an interrupt prompt; the run resumes without
      “No pending requests found in workflow context.”
- [ ] **Refresh while awaiting input** — reload mid-interrupt: history + the
      pending interrupt + “Waiting for your reply” are restored.
- [ ] **Completed case** — a `Case complete.` turn closes the thread and shows
      the completion message.
- [ ] **Handoff display** — during a `handoff_to_<x>` tool call the badge reads
      “Handing off to X” and the persona strip dashes/arrows the target, while
      the previous speaker stays active until X starts.
- [ ] **Admin Threads playground** — copied configure/run payloads paste
      straight into curl/Postman and succeed.
- [ ] **Persona/module change policy** — editing personas/module then opening
      an existing in-progress thread keeps its old config; a new thread picks
      up the change.

### Automated gates

- [ ] `cd react && npm run typecheck` → no errors.
- [ ] `php -l` on every changed PHP file → no syntax errors.
- [ ] `cd react && npm run build` → regenerates `js/ext/*.umd.js` +
      `css/ext/*.css`; confirm the asset diffs are intentional.
