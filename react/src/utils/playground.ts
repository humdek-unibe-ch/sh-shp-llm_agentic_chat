/**
 * Helpers for the threads-viewer "playground": build copy-paste curl
 * one-liners and clone request bodies with fresh UUIDs so that admins
 * can replay an upstream call without further editing.
 *
 * @module utils/playground
 */

/** RFC4122-ish v4 UUID generator (browser only). */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: Math.random based v4 (not cryptographically strong but
  // perfectly fine for run/message ids that the backend just echoes back).
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex[i] = (i + 0x100).toString(16).slice(1);
  const r = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(r);
  } else {
    for (let i = 0; i < 16; i++) r[i] = Math.floor(Math.random() * 256);
  }
  r[6] = (r[6] & 0x0f) | 0x40;
  r[8] = (r[8] & 0x3f) | 0x80;
  return `${hex[r[0]]}${hex[r[1]]}${hex[r[2]]}${hex[r[3]]}-${hex[r[4]]}${hex[r[5]]}-${hex[r[6]]}${hex[r[7]]}-${hex[r[8]]}${hex[r[9]]}-${hex[r[10]]}${hex[r[11]]}${hex[r[12]]}${hex[r[13]]}${hex[r[14]]}${hex[r[15]]}`;
}

/** Pretty-print a JSON value with 2-space indent; safe for arbitrary input. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Single-quote-escape a JSON body for inclusion in a bash curl command.
 * Bash inside single quotes treats every char literally except `'` itself,
 * so we close+escape+reopen on every embedded single quote.
 */
function bashSingleQuote(str: string): string {
  return `'${str.split("'").join("'\\''")}'`;
}

/**
 * Build a `curl` one-liner for a JSON POST. Includes `-N` (no buffering)
 * for /reflect calls so admins can stream the SSE response in their
 * terminal exactly the way the CMS does.
 */
export function buildCurlPost(
  url: string,
  body: unknown,
  options: { stream?: boolean } = {}
): string {
  const stream = options.stream ?? false;
  const flags = ['-X', 'POST', '-H', "'Content-Type: application/json'"];
  if (stream) {
    flags.push('-N', '-H', "'Accept: text/event-stream'");
  } else {
    flags.push('-H', "'Accept: application/json'");
  }
  const data = bashSingleQuote(prettyJson(body));
  return `curl ${flags.join(' ')} -d ${data} '${url}'`;
}

/**
 * Build a fresh `/reflect` body for a specific user message by cloning
 * the server-supplied template and filling in run_id, message id and
 * the chosen text.
 */
export function buildRunBodyFor(
  template: Record<string, unknown>,
  userMessage: string
): Record<string, unknown> {
  // Deep-clone via JSON round-trip; the template only contains plain
  // primitives, arrays and objects so this is safe.
  const cloned = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  cloned.run_id = generateUuid();
  if (Array.isArray(cloned.messages) && cloned.messages.length > 0) {
    const first = cloned.messages[0] as Record<string, unknown>;
    first.id = generateUuid();
    first.role = 'user';
    first.content = userMessage;
  } else {
    cloned.messages = [
      { id: generateUuid(), role: 'user', content: userMessage },
    ];
  }
  return cloned;
}
