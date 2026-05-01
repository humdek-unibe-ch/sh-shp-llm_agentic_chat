/**
 * Shared TypeScript types for the LLM Agentic Chat plugin React bundles.
 */

/* ---------- Personas ----------------------------------------------------- */

export interface Persona {
  /** Stable identifier used in slot maps (slug). */
  key: string;
  /** Display name shown in the UI. */
  name: string;
  /** Coarse role bucket (mediator/teacher/expert/supporter/other). */
  role: string;
  /** Free-form personality summary (display only, surfaced in the persona strip). */
  personality?: string;
  /** System-prompt template. May contain {module_content} placeholders. */
  instructions: string;
  /** Hex color used for badges/avatars. */
  color?: string;
  /** Avatar asset URL/path, emoji, or short label. */
  avatar?: string;
  /** Whether this persona is enabled and selectable. */
  enabled: boolean;
}

export type PersonaRole =
  | 'agentic_persona_role_mediator'
  | 'agentic_persona_role_teacher'
  | 'agentic_persona_role_expert'
  | 'agentic_persona_role_supporter'
  | 'agentic_persona_role_other';

/** Map: backend-defined slot -> persona key. */
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
  personas: Persona[];
  /**
   * Backend slot -> persona key mapping resolved on the PHP side from the
   * section's curated persona list. Read-only on the client; the PHP
   * controller rebuilds it on every `start_thread` to keep CMS state and
   * backend state in sync.
   */
  personaSlotMap: PersonaSlotMap;
  backendSlots: string[];
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

export interface ThreadInfo {
  id: number;
  aguiThreadId: string;
  lastRunId: string | null;
  status: ThreadStatus;
  isCompleted: boolean;
  lastError: string | null;
  personaSlotMap: PersonaSlotMap | Record<string, never>;
  moduleContent: string | null;
  usage: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  conversationId: number;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context: Record<string, unknown> | null;
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

export interface AgUiEvent {
  type: AgUiEventType | string;
  /** Camel- or snake-case ids (we normalise both). */
  messageId?: string;
  message_id?: string;
  threadId?: string;
  thread_id?: string;
  runId?: string;
  run_id?: string;
  role?: string;
  delta?: string;
  /** Used by TOOL_CALL_START / handoff_to_<persona>. */
  toolCallName?: string;
  tool_call_name?: string;
  toolCallId?: string;
  tool_call_id?: string;
  parentMessageId?: string;
  parent_message_id?: string;
  /** RUN_ERROR. */
  message?: string;
  code?: string | number;
  /** CUSTOM events. */
  name?: string;
  value?: unknown;
  /** MESSAGES_SNAPSHOT. */
  messages?: unknown[];
  /** Other metadata is permitted but typed loosely. */
  [extra: string]: unknown;
}

/** A streamed assistant message in flight (or finalised). */
export interface InFlightMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  text: string;
  authorPersonaKey?: string;
  authorPersonaName?: string;
  isComplete: boolean;
  startedAt: number;
  endedAt?: number;
}

/** UI-side run status state machine. */
export type RunStatus = 'idle' | 'starting' | 'running' | 'completed' | 'error';

/** Pending HITL interrupt envelope. */
export interface PendingInterrupt {
  /** Stable id for the interrupt so we can resume it. */
  interruptId: string;
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  /** Free-form prompt text for the UI. */
  prompt?: string;
  /** Captured args / payload from the backend. */
  payload?: Record<string, unknown>;
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
  defaults_path: string;
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
  created_at: string;
  is_validated: 0 | 1 | boolean;
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
}

export interface ThreadCounters {
  total: number;
  idle: number;
  running: number;
  awaiting_input: number;
  completed: number;
  failed: number;
}
