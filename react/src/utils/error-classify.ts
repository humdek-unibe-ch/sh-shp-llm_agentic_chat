/**
 * Classify upstream AG-UI / backend errors into a user-friendly
 * shape for the chat error banner.
 *
 * Why this lives in a util:
 *   The raw `RUN_ERROR.message` we receive over SSE is often a Python
 *   stack-trace-ish string from agent_framework (e.g. the OpenAI
 *   Responses API 404 when a cached `previous_response_id` is no
 *   longer valid). Showing it verbatim looks scary and gives the user
 *   no actionable next step. We map known patterns to a short,
 *   human-readable title + body and a "suggest reset" hint that the
 *   chat shell renders as a one-click recovery button.
 *
 *   Unknown errors fall through to a generic "Something went wrong"
 *   surface with the original message in the technical-details
 *   <details> drawer so the developer / power user can still inspect.
 */

export interface ClassifiedChatError {
  /** Short bold title for the error banner. */
  title: string;
  /** Human-readable explanation, plain text. */
  body: string;
  /** Optional raw upstream message (shown in <details>). */
  detail?: string;
  /** True when starting a new thread is the recommended fix. */
  suggestReset: boolean;
}

const OPENAI_RESPONSE_NOT_FOUND_RE =
  /Response with id ['"][^'"]+['"] not found/i;
const OPENAI_404_RE = /OpenAIChatClient.*Error code: 404/i;
const RATE_LIMIT_RE = /Error code: 429|rate.?limit/i;
const CONTEXT_LENGTH_RE = /context.{0,20}length|maximum context/i;
const NETWORK_RE = /(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection refused|network)/i;

export function classifyChatError(rawMessage: string): ClassifiedChatError {
  const msg = String(rawMessage ?? '').trim();
  if (!msg) {
    return {
      title: 'Something went wrong',
      body: 'The agent did not return a response.',
      suggestReset: true,
    };
  }

  // OpenAI Responses API lost the `previous_response_id` the agent had
  // cached for this thread. The conversation is no longer recoverable
  // upstream; only a fresh thread will work.
  if (OPENAI_RESPONSE_NOT_FOUND_RE.test(msg) || OPENAI_404_RE.test(msg)) {
    return {
      title: 'Conversation lost sync with the AI',
      body:
        'The agent\'s upstream session expired (the previous response is no longer stored). ' +
        'Start a new thread to continue.',
      detail: msg,
      suggestReset: true,
    };
  }

  if (RATE_LIMIT_RE.test(msg)) {
    return {
      title: 'AI provider is rate-limiting requests',
      body:
        'The upstream model provider returned a rate-limit error. Wait a few seconds and try again, ' +
        'or start a new thread if the issue persists.',
      detail: msg,
      suggestReset: false,
    };
  }

  if (CONTEXT_LENGTH_RE.test(msg)) {
    return {
      title: 'Conversation is too long for the model',
      body:
        'This thread has grown beyond what the model can handle in one request. ' +
        'Start a new thread to continue with a fresh context window.',
      detail: msg,
      suggestReset: true,
    };
  }

  if (NETWORK_RE.test(msg)) {
    return {
      title: 'Cannot reach the agentic backend',
      body:
        'The CMS could not connect to the workflow server. Check the backend URL on the ' +
        'configuration page and try again.',
      detail: msg,
      suggestReset: false,
    };
  }

  return {
    title: 'The agent reported an error',
    body: 'The conversation cannot continue right now.',
    detail: msg,
    suggestReset: true,
  };
}
