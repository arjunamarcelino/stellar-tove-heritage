/**
 * Redacts the values of the given query-string keys in a URL, leaving the path and all other params
 * intact. Used by the pino HTTP request serializer so sensitive values that travel as query params
 * (e.g. `GET /api/v1/handles/check?handle=…`, a public identity field the collector is actively typing)
 * never land in access-log retention in plaintext (TOV-26 / TOV-43 privacy item). Matching is
 * case-INSENSITIVE on the key so a client/proxy that varies casing (`?Handle=`/`?HANDLE=`) cannot bypass
 * the scrub; the original key casing is preserved in the output (only the value is censored).
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile each key's regex ONCE (module-lived) — the pino serializer calls this on every logged request, so
// per-call `new RegExp` would be wasteful. A `/g` regex reused across `.replace()` is safe (replace resets
// lastIndex). Matches `key=value` (case-insensitive key) at the query start or after `&`, up to `&`/end.
const compiledKeyRegex = new Map<string, RegExp>();
function keyValueRegex(key: string): RegExp {
  let re = compiledKeyRegex.get(key);
  if (!re) {
    re = new RegExp(`(^|&)(${escapeRegExp(key)})=[^&]*`, 'gi');
    compiledKeyRegex.set(key, re);
  }
  return re;
}

export function redactUrlQueryParams(url: string, keys: readonly string[]): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1 || keys.length === 0) return url;

  const path = url.slice(0, queryStart);
  let query = url.slice(queryStart + 1);
  for (const key of keys) {
    query = query.replace(keyValueRegex(key), '$1$2=[REDACTED]');
  }
  return `${path}?${query}`;
}

/** Query-param names scrubbed from logged request URLs. */
export const REDACTED_QUERY_PARAMS = ['handle'] as const;
