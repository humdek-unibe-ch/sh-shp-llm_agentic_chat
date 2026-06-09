/**
 * Shared TypeScript types for the LLM Agentic Chat plugin React bundles.
 */

/* ---------- Personas ----------------------------------------------------- */

/**
 * Persona authored in the admin library.
 *
 * Personas form an ordered, flexible list. Each provides a display name
 * and a `description` (the system prompt sent to the backend as the
 * persona's `description`). The mediator is NOT modelled here — it is a
 * fixed plugin/UI participant toggled per section (see
 * `AgenticChatConfig.mediator` / `useGroupChatMediator`).
 */
export interface Persona {
  /** Stable internal slug (auto-derived from name, hidden in the editor). */
  key: string;
  /** Display name shown in the UI + sent to the backend as the persona name. */
  name: string;
  /** System prompt (role + style) sent to the backend as `description`. */
  description: string;
  /** Hex color used for badges/avatars. */
  color?: string;
  /** Avatar asset URL/path, emoji, or short label. */
  avatar?: string;
  /** Whether this persona is enabled and selectable. */
  enabled: boolean;
}

/**
 * Participant map: backend slot -> persona key.
 * Slots are `mediator` and positional `persona_1`, `persona_2`, …
 */
export type PersonaSlotMap = Record<string, string | null>;

/* ---------- Backend / config -------------------------------------------- */

export interface BackendInfo {
  baseUrl: string;
  reflectPath: string;
}

export interface AgenticChatLabels {
  title: string;
  description: string;
  placeholder: string;
  sendLabel: string;
  startLabel: string;
  resetLabel: string;
  completionMessage: string;
  loadingText: string;
  statusIdle: string;
  statusRunning: string;
  statusComplete: string;
  statusError: string;
}

export interface AgenticChatConfig {
  userId: number | null;
  sectionId: number;
  baseUrl: string;
  controllerUrl: string;
  pluginVersion: string;
  autoStart: boolean;
  autoStartToken: string;
  caseCompleteMarker: string;
  showDebug: boolean;
  showPersonaStrip: boolean;
  showRunStatus: boolean;
  /**
   * Resolved, ordered persona list for this section — the mediator
   * (when enabled) at index 0 followed by the personas chosen for this
   * section (selection -> fallback resolution happens server-side).
   */
  personas: Persona[];
  /**
   * Participant map (backend slot -> persona key) resolved on the PHP
   * side from the section's ordered persona list. Read-only on the
   * client; persisted on the thread at configure time so attribution
   * survives a refresh.
   */
  personaSlotMap: PersonaSlotMap;
  /**
   * Read-only descriptor for the fixed mediator persona. Mirrors the
   * `AGENTIC_CHAT_MEDIATOR_PERSONA` constant on the PHP side and is
   * used by the chat surface to render the mediator's avatar/name
   * even though it is not part of the editable persona library.
   */
  mediator: Persona;
  /** Whether this section uses the backend's group-chat mediator. */
  useGroupChatMediator: boolean;
  /** Whether the microphone button should be rendered in the input. */
  enableSpeechToText: boolean;
  /** Whisper model identifier sent with each transcription request. */
  speechToTextModel: string;
  labels: AgenticChatLabels;
  /** Module / reflection text injected into every AG-UI thread. */
  moduleContent: string;
  backendInfo: BackendInfo;
}

/* ---------- Threads & messages ------------------------------------------ */

export type ThreadStatus =
  | 'idle'
  | 'configuring'
  | 'running'
  | 'awaiting_input'
  | 'completed'
  | 'failed';

/**
 * Server-side projection of an `agenticChatThreads` row enriched with the
 * conversation id and any HITL state required by the React UI to decide
 * whether to auto-start a new run, resume an interrupted one, or do
 * nothing at all on page load.
 */
export interface ThreadInfo {
  id: number;
  aguiThreadId: string;
  lastRunId: string | null;
  status: ThreadStatus;
  isCompleted: boolean;
  lastError: string | null;
  personaSlotMap: PersonaSlotMap | Record<string, never>;
  /** Whether this thread was configured with the group-chat mediator. */
  useGroupChatMediator: boolean;
  moduleContent: string | null;
  /**
   * AG-UI interrupts persisted on the thread row.
   *
   * The PHP normaliser rewrites the legacy backend payload
   * (`RUN_FINISHED.interrupt = [{ id, value }]`) into the strict
   * `PendingInterrupt` shape before persisting it, so a refresh in the
   * middle of a HITL pause restores the same canonical model the React
   * chat uses while a run is live. Empty when the next user message
   * should start a fresh run instead of resuming a paused one.
   */
  pendingInterrupts: PendingInterrupt[];
  /** Convenience flag mirroring `pendingInterrupts.length > 0`. */
  awaitingInput: boolean;
  usage: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  conversationId: number;
}

/**
 * Normalised speaker metadata attached to every persisted assistant
 * message and every in-flight streaming bubble. Populated by the PHP
 * event normaliser when the backend emits `author_name` /
 * `source_executor_id` on TEXT_MESSAGE_*, and persisted into the
 * `llmMessages.sent_context` column so the chat surface can pick the
 * correct avatar / display name even after a page refresh.
 */
export interface AssistantSpeakerMetadata {
  /** Stable backend executor id (e.g. `group_chat_mediator`). */
  sourceExecutorId?: string;
  /** Display name reported by the backend (often equal to the executor id). */
  authorName?: string;
  /** Backend slot the speaker is bound to (mediator / persona_1 / persona_2 / persona_3). */
  authorSlot?: string;
  /** Plugin-side persona key resolved through the section's slot map. */
  authorPersonaKey?: string;
  /** AG-UI message id (`TEXT_MESSAGE_START.messageId`). */
  messageId?: string;
  /** AG-UI run id this message belongs to. */
  runId?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /**
   * Free-form metadata persisted alongside the message. For assistant
   * messages produced by an AG-UI run the normaliser stores the
   * `AssistantSpeakerMetadata` fields directly here so the renderer
   * can resolve the avatar/name from the message itself rather than
   * from transient handoff state.
   */
  context: (AssistantSpeakerMetadata & Record<string, unknown>) | null;
  created_at: string;
}

export interface ThreadView {
  thread: ThreadInfo | null;
  messages: ChatMessage[];
}

/* ---------- AG-UI events ------------------------------------------------- */

/** Subset of the AG-UI event surface we actually consume. */
export type AgUiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'STEP_STARTED'
  | 'STEP_FINISHED'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TEXT_MESSAGE_CHUNK'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'TOOL_CALL_CHUNK'
  | 'STATE_SNAPSHOT'
  | 'STATE_DELTA'
  | 'MESSAGES_SNAPSHOT'
  | 'ACTIVITY_SNAPSHOT'
  | 'ACTIVITY_DELTA'
  | 'RAW'
  | 'CUSTOM'
  | 'PROXY_THREAD_INFO'
  | 'PROXY_ERROR'
  | 'PROXY_DONE';

/**
 * RUN_FINISHED outcome envelope (strict AG-UI).
 *
 * The legacy FoResTCHAT backend hangs a singular `interrupt` array
 * directly on the terminal RUN_FINISHED event. The PHP normaliser
 * rewrites that into an explicit outcome here so the React chat can
 * pattern-match cleanly on `outcome.type` instead of having to sniff
 * for a top-level `interrupt[]` array.
 */
export type RunFinishedOutcome =
  | { type: 'interrupt'; interrupts: PendingInterrupt[] }
  | { type: 'complete' };

/**
 * AG-UI event shape after the PHP normalisation bridge.
 *
 * All identifier fields are camelCase only; `RUN_FINISHED` carries an
 * `outcome` envelope; interrupts are pre-normalised; and the original
 * backend payload is preserved under `_rawLegacy` for the debug panel.
 */
export interface AgUiEvent {
  type: AgUiEventType | string;
  messageId?: string;
  threadId?: string;
  runId?: string;
  role?: string;
  delta?: string;
  /** Used by TOOL_CALL_START / handoff_to_<persona>. */
  toolCallName?: string;
  toolCallId?: string;
  parentMessageId?: string;
  /** RUN_ERROR. */
  message?: string;
  code?: string | number;
  /** CUSTOM events. */
  name?: string;
  value?: unknown;
  /** MESSAGES_SNAPSHOT. */
  messages?: unknown[];
  /** RUN_FINISHED — strict AG-UI outcome envelope. */
  outcome?: RunFinishedOutcome;
  /** Canonical alias of `outcome.interrupts` when outcome is interrupt. */
  interrupts?: PendingInterrupt[];
  /** Speaker metadata copied through by the normaliser. */
  authorName?: string;
  sourceExecutorId?: string;
  authorSlot?: string;
  authorPersonaKey?: string;
  /** Original backend payload preserved for the debug surface. */
  _rawLegacy?: Record<string, unknown>;
  /** Other metadata is permitted but typed loosely. */
  [extra: string]: unknown;
}

/** A streamed assistant message in flight (or finalised). */
export interface InFlightMessage extends AssistantSpeakerMetadata {
  id: string;
  role: 'assistant' | 'user' | 'system';
  text: string;
  isComplete: boolean;
  startedAt: number;
  endedAt?: number;
}

/**
 * UI-side run status state machine.
 *
 *   idle           -> no run in progress, ready for the next user message
 *   starting       -> /reflect/configure (or initial /reflect) is in flight
 *   running        -> SSE stream is open, assistant tokens are arriving
 *   awaiting_input -> RUN_FINISHED arrived with an `interrupt` array; the
 *                     UI is waiting for the user to type their reply, which
 *                     will be sent as an AG-UI resume payload
 *   completed      -> the case has been explicitly closed (case_complete
 *                     CUSTOM event or "Case complete." text marker)
 *   error          -> RUN_ERROR / PROXY_ERROR / network failure
 */
export type RunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'completed'
  | 'error';

/**
 * Pending HITL interrupt envelope (strict AG-UI, post-normalisation).
 *
 * The PHP normaliser turns the legacy backend `{ id, value }` shape into
 * this strict object so the React chat can render rich interrupt prompt
 * cards without having to inspect bespoke `agent_response` blobs.
 *
 * `rawLegacy` is preserved so the debug panel can show what the backend
 * actually sent, and so the resume translator on the PHP side can build
 * the correct legacy resume value for tools that piggy-back on it.
 */
export interface PendingInterrupt {
  /** Stable id for the interrupt; this is what `resume[].interruptId` references. */
  interruptId: string;
  /** Coarse category (e.g. `handoff_input` for the FoResTCHAT backend). */
  reason?: string;
  /** Human-readable prompt the UI shows in the interrupt card. */
  message?: string;
  /** Optional JSON Schema / form schema for structured responses. */
  responseSchema?: unknown;
  /** Free-form metadata from the backend (full `value` payload). */
  metadata?: Record<string, unknown>;
  /** Backend executor id that raised the interrupt (e.g. `group_chat_mediator`). */
  sourceExecutorId?: string;
  /** Display name reported by the backend. */
  authorName?: string;
  /** Backend slot derived from the executor id. */
  authorSlot?: string;
  /** Plugin-side persona key resolved through the section's slot map. */
  authorPersonaKey?: string;
  /** Raw backend interrupt for the debug surface / resume translation. */
  rawLegacy?: Record<string, unknown>;
}

/**
 * Strict AG-UI resume entry sent from the React chat to the PHP proxy.
 *
 * The PHP normaliser translates the array of these into the backend's
 * legacy `{ interrupts: [{ id, value }] }` shape before calling the
 * upstream `/reflect` endpoint.
 */
export interface ResumeEntry {
  interruptId: string;
  status: 'resolved' | 'cancelled';
  /** Free-form payload; the default text builder reads `payload.text`. */
  payload?: { text?: string } | Record<string, unknown>;
}

/* ---------- Admin types -------------------------------------------------- */

export interface AdminConfig {
  csrfToken: string;
  baseUrl: string;
  /** URL of the threads admin page (used for cross-page links). */
  threadsUrl?: string;
  pluginVersion: string;
}

export interface BackendSettings {
  backend_url: string;
  reflect_path: string;
  configure_path: string;
  health_path: string;
  timeout: number;
  default_module: string;
}

export interface AdminInitialState {
  backend: BackendSettings;
  personas: Persona[];
}

/* ---------- Threads admin module ---------------------------------------- */

export interface ThreadsAdminConfig {
  csrfToken: string;
  baseUrl: string;
  /** URL of the configuration admin page (used for cross-page links). */
  configBaseUrl?: string;
  pluginVersion: string;
}

export interface ThreadListRow {
  id: number;
  id_llmConversations: number;
  id_users: number;
  id_sections: number | null;
  agui_thread_id: string;
  last_run_id: string | null;
  backend_url: string;
  status: string;
  is_completed: 0 | 1 | boolean;
  last_error: string | null;
  usage_total_tokens: number | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  created_at: string;
  updated_at: string;
  conversation_title: string | null;
  user_email: string | null;
  user_name: string | null;
  message_count: number;
}

export interface ThreadListResponse {
  rows: ThreadListRow[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface ThreadDetailMessage {
  id: number;
  role: string;
  content: string;
  sent_context: string | null;
  sent_context_json: Record<string, unknown> | null;
  /**
   * Friendly speaker label resolved server-side from sent_context + the
   * thread's participant map + the global persona library (e.g. "Mediator",
   * "Lea", "Teacher 2"). Falls back to a capitalised role.
   */
  author_label?: string;
  created_at: string;
  is_validated: 0 | 1 | boolean;
}

/**
 * Developer-facing playground payloads attached to every thread detail
 * response. Provides ready-to-paste bodies + URLs so admins can replay
 * a thread against the upstream backend (Postman, curl, …).
 */
export interface ThreadPlaygroundPayloads {
  backend: {
    base_url: string;
    configure_path: string;
    reflect_path: string;
    configure_url: string;
    reflect_url: string;
  };
  configure: {
    method: 'POST';
    url: string;
    /** Body sent to /reflect/configure (snapshot of the thread's init). */
    body: Record<string, unknown>;
  };
  run: {
    method: 'POST';
    url: string;
    /**
     * Skeleton body for /reflect calls. `messages[0].content` is pre-filled
     * with the most recent user message; `run_id` is a placeholder that
     * the user has to replace with a fresh UUID.
     */
    body_template: Record<string, unknown>;
    last_user_message: string | null;
    run_id_placeholder: string;
  };
}

export interface ThreadDetail {
  thread: Record<string, unknown> & {
    id: number;
    id_llmConversations: number;
    agui_thread_id: string;
    backend_url: string;
    status: string;
    is_completed: 0 | 1 | boolean;
    persona_slot_map_json: Record<string, unknown> | null;
    pending_interrupts_json: Record<string, unknown> | unknown[] | null;
    debug_meta_json: Record<string, unknown> | null;
  };
  messages: ThreadDetailMessage[];
  playground?: ThreadPlaygroundPayloads;
}

export interface ThreadCounters {
  total: number;
  idle: number;
  running: number;
  awaiting_input: number;
  completed: number;
  failed: number;
}
