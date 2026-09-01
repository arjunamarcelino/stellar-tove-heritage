// Curated copy for the whitelist status card (TOV-45 / FR-01.08). Client-safe (no 'server-only'), shared
// by the card and any server render so the two can't fork. The backend `reason` is an opaque, machine-
// readable CODE — a raw reason string is NEVER surfaced (a compliance pipeline shouldn't leak internal
// diagnostics, mirroring kycMessages.ts).
//
// The code→copy map is intentionally EMPTY today: per TOV-29 there is no canonical reason-code enum yet,
// and Phase 0 always emits reason: null in production (frozen/removed are only reachable via test seeding).
// Every reason therefore resolves to the per-status generic fallback for now. The KycReasonCode enum + this
// mapping are a joint M12 deliverable with the backend — populate WHITELIST_REASON_MESSAGES then.
export const WHITELIST_REASON_MESSAGES: Record<string, string> = {};

// Per-status generic fallback — used for null/unknown codes (i.e. always, in Phase 0). Never an empty line.
export const WHITELIST_REASON_FALLBACK: Record<'frozen' | 'removed', string> = {
  frozen: 'Your verification is temporarily on hold.',
  removed: 'Your verification has been revoked.',
};

// Resolve the reason line for a frozen/removed card. `reason` is `string | null` on the wire (null in Phase
// 0). hasOwnProperty (not `in`) so a prototype key like "constructor" can't masquerade as a curated code.
export function whitelistReasonCopy(
  status: 'frozen' | 'removed',
  reason: string | null | undefined,
): string {
  if (reason && Object.prototype.hasOwnProperty.call(WHITELIST_REASON_MESSAGES, reason)) {
    const copy = WHITELIST_REASON_MESSAGES[reason];
    if (copy) return copy;
  }
  return WHITELIST_REASON_FALLBACK[status];
}
