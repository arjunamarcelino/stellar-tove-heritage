import { QUOTE_MESSAGES } from '@/lib/quote/quoteMessages';
import { I128_MAX, U96_MAX } from '@/lib/money/constants';
import type { QuoteErrorCode, QuoteInput, SubmitQuoteResult } from '@/lib/types/api';

// Shared quote input-bounds check (TOV-176 / FR-06.03). Used by BOTH the server action (the trust boundary) and
// the service (fail-closed defense-in-depth) so the rules can't drift — a single source for: the two INDEPENDENT
// numeric ceilings (per-fraction price <= u96, price × count <= i128), the integer count >= 1, and the
// STRUCTURAL validity of validUntil. The regex/BigInt guards tolerate a forged numeric value (a Server Action
// deserializes arbitrary client payloads). Returns a curated error result, or null when the input is valid.
//
// C1 — validUntil is validated for STRUCTURE ONLY (parseable + explicit tz offset), NEVER `> now`. A temporal
// check here would self-reject a same-key retry of a possibly-already-created quote into an unrecoverable loop
// (the frozen instant can't move, but wall-clock does). The `> now` gate lives in the form (UX) and on the
// server (the authority, QUOTE_INVALID_VALIDITY). Consequence (accepted trade-off): unlike checkRfqBounds'
// expiry-preset allow-list, a forged non-preset — but well-formed, future — instant passes the FE boundary; the
// backend's cap-to-expiry is the only authority.

// Curated error result for the non-balance codes — the message ALWAYS comes from QUOTE_MESSAGES. Excludes
// QUOTE_INSUFFICIENT_FREE_BALANCE (that code carries balanceDetail and is service-only, built via
// `insufficientErr`), matching the split SubmitQuoteResult error arm. Exported so the service reuses the one
// definition (no drift).
export const err = (
  code: Exclude<QuoteErrorCode, 'QUOTE_INSUFFICIENT_FREE_BALANCE'>,
): SubmitQuoteResult => ({
  status: 'error',
  code,
  message: QUOTE_MESSAGES[code],
});

// An ISO-8601 instant must carry an explicit zone: a trailing `Z` or a ±HH:MM offset. A bare wall-clock string
// (`2026-08-25T12:00:00`) is ambiguous and rejected. The form's presets emit `…Z`, so they pass for free.
function hasExplicitOffset(s: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(s);
}

export function checkQuoteBounds(input: QuoteInput): SubmitQuoteResult | null {
  // Shape guard: `input` is attacker-controlled arbitrary JSON at the Server Action boundary. A null /
  // primitive / array would throw a TypeError on the field access below (escaping the action as an uncaught
  // rejection); fail closed to a curated code instead, keeping the "always curated" contract total.
  if (typeof input !== 'object' || input === null) return err('VALIDATION_FAILED');
  const price = input.pricePerFractionStroops;
  if (!/^[1-9]\d*$/.test(price) || BigInt(price) > U96_MAX) return err('QUOTE_INVALID_PRICE');
  if (!Number.isSafeInteger(input.fractionCount) || input.fractionCount < 1) {
    return err('VALIDATION_FAILED');
  }
  // Structure only — parseable instant carrying an explicit tz offset. NOT `> now` (see C1 note above).
  if (!hasExplicitOffset(input.validUntil) || Number.isNaN(new Date(input.validUntil).getTime())) {
    return err('QUOTE_INVALID_VALIDITY');
  }
  if (BigInt(price) * BigInt(input.fractionCount) > I128_MAX) return err('QUOTE_AMOUNT_OVERFLOW');
  return null;
}
