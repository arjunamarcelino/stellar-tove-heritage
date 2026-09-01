/**
 * Bounded, single-line failure reason for an append-only audit row — never the raw SDK error (which can carry
 * XDR blobs / RPC bodies / tx envelopes). Shared by the offering deploy + settle workers (#335, rule-of-three).
 */
export function sanitizeReason(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : 'Error';
  const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
  return `${name}: ${msg}`.slice(0, 200);
}
