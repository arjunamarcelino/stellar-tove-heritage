import 'server-only';

import { z } from 'zod/v4';
import { postJson, extractBackendCode } from '@/lib/services/http';
import { QUOTE_MESSAGES } from '@/lib/quote/quoteMessages';
import { QUOTE_TIMEOUT_MS } from '@/lib/quote/constants';
import { checkQuoteBounds, err } from '@/lib/quote/validation';
import type {
  Quote,
  QuoteStatus,
  QuoteInput,
  QuoteErrorCode,
  QuoteBackendErrorCode,
  InsufficientBalanceDetail,
  SubmitQuoteResult,
} from '@/lib/types/api';

// The quote submission service (TOV-176 / FR-06.03). A whitelisted holder's sell offer into an open RFQ. Pure DB
// write at submit — no funds move, no signing. Backend contract TOV-175 (DRAFT; endpoint UNBUILT as of
// 2026-08-22). The wire is camelCase — the strict api/v1 house convention (bids, /me/holdings); do NOT copy the
// sibling rfqs.ts's snake_case (a known separate bug). Uses the shared http seam; NO raw backend message ever
// reaches the UI — every error surfaces only curated QUOTE_MESSAGES copy. Amounts stay i128/2^96-safe DECIMAL
// STRINGS end-to-end. The 201 body is validated fail-closed before it's rendered, and the mapper is a
// spread-free allow-list that DROPS internal ids (holderSub / fractionContractId / createdAt) so they never
// reach the browser (egress minimization).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// Decimal-integer string guard — amounts (and the insufficient-balance counts) are validated as strings, never
// coerced through a lossy JS number. Fail-closed at PARSE: a malformed money field must become SERVER_ERROR, not
// a value that throws later inside stroopsToUsdc/formatUsdc during render (R4.1).
const decimalString = z.string().regex(/^\d+$/);

// A canonical POSITIVE integer string (no leading zeros) — the receive-side guard for the created quote's
// price and count, matching the submit-side rule (`checkQuoteBounds`). Stricter than `decimalString` so a
// buggy/hostile 201 carrying `"0"` (or `"01"`) fails closed rather than rendering an economically-null
// "success" (0 fractions / 0.00 USDC). `decimalString` is still used for the insufficient-balance counts,
// where `"0"` free is legitimate.
const positiveIntString = z.string().regex(/^[1-9]\d*$/);

// validUntil must be a parseable instant — validated fail-closed like the money fields. countdownParts tolerates
// a bad date (silent NaN), but the confirmation's spoken-date label feeds `new Date(validUntil)` to
// Intl.DateTimeFormat.format, which THROWS a RangeError on an invalid Date during render. A malformed value
// fails to SERVER_ERROR instead of crashing the confirmation.
const isoDatetime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'invalid datetime',
});

// SEC-1: the rfq id is uuid-validated at the service boundary BEFORE it's interpolated into the URL PATH — this
// guard is load-bearing here (path-injection), unlike RFQ where the id travelled in the body.
const uuidSchema = z.uuid();

// `err` (the curated non-balance error factory) is imported from lib/quote/validation to keep one definition.

// The one error arm that carries the extra count fields. balanceDetail is present only when both parsed cleanly.
const insufficientErr = (balanceDetail?: InsufficientBalanceDetail): SubmitQuoteResult => ({
  status: 'error',
  code: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
  message: QUOTE_MESSAGES.QUOTE_INSUFFICIENT_FREE_BALANCE,
  ...(balanceDetail && { balanceDetail }),
});

// Const-tuple source of truth for the quote lifecycle — `satisfies` fails to compile if it drifts from the
// QuoteStatus union, and z.enum rejects any unknown wire status at the parse boundary (fail-closed: only 'open'
// is valid on create; widen when FR-06.04 ships).
const QUOTE_STATUSES = ['open'] as const satisfies readonly QuoteStatus[];

// ── 201 wire schema (camelCase) + spread-free, TRIMMED mapper ────────────────────────────────────────
// Zod's default strip drops the unmapped internal ids (holderSub / fractionContractId / createdAt) — the
// fail-closed egress guard. validUntilCapped is present-only-when-true. The mapper closes with an explicit
// `: Quote` return annotation so a stray field fails to compile; since wire and domain are both camelCase it's a
// straight field pick (no case remap, unlike RFQ's toRfq).
const quoteWireSchema = z.object({
  id: z.uuid(),
  rfqId: z.uuid(),
  fractionCount: positiveIntString,
  pricePerFractionStroops: positiveIntString,
  validUntil: isoDatetime,
  // Permissive-in: accept a boolean (a backend that serializes all fields sends `false` on the common
  // uncapped path). Rejecting `false` here would fail-parse the MAJORITY happy path → a false SERVER_ERROR
  // on a genuinely-created quote → an ALREADY_OPEN dead-end on retry. Normalized to present-only-true below.
  validUntilCapped: z.boolean().optional(),
  status: z.enum(QUOTE_STATUSES),
});

function toQuote(wire: z.infer<typeof quoteWireSchema>): Quote {
  return {
    id: wire.id,
    rfqId: wire.rfqId,
    fractionCount: wire.fractionCount,
    pricePerFractionStroops: wire.pricePerFractionStroops,
    validUntil: wire.validUntil,
    status: wire.status,
    // Strict-out: normalize to present-only-when-true so `false`/omitted both collapse to an absent key
    // (matching the domain `validUntilCapped?: true`).
    ...(wire.validUntilCapped === true && { validUntilCapped: true as const }),
  };
}

// The insufficient-balance body carries extra count fields (numeric(39,0) strings). Parse defensively: absent or
// malformed → undefined (never fabricated), so a hostile/buggy backend can't render arbitrary text (R1.7/R3.2).
const balanceDetailSchema = z.object({
  requiredFractionCount: decimalString,
  freeFractionCount: decimalString,
});

function extractBalanceDetail(data: unknown): InsufficientBalanceDetail | undefined {
  const parsed = balanceDetailSchema.safeParse(data);
  return parsed.success
    ? {
        requiredFractionCount: parsed.data.requiredFractionCount,
        freeFractionCount: parsed.data.freeFractionCount,
      }
    : undefined;
}

// ── Error taxonomy (mirrors the RFQ/offering passthrough triad) ──────────────────────────────────────
// Keyed on the union so a new QuoteBackendErrorCode fails to compile until classified. Every backend quote code
// is authoritative and passed through verbatim.
const IS_QUOTE_BACKEND_CODE: Record<QuoteBackendErrorCode, true> = {
  VALIDATION_FAILED: true, // 400
  QUOTE_NOT_WHITELISTED: true, // 403
  QUOTE_RFQ_NOT_FOUND: true, // 404
  QUOTE_ALREADY_OPEN: true, // 409
  IDEMPOTENCY_KEY_IN_FLIGHT: true, // 409
  QUOTE_RFQ_NOT_OPEN: true, // 422
  QUOTE_RFQ_EXPIRED: true, // 422
  QUOTE_ON_OWN_RFQ: true, // 422
  QUOTE_INVALID_PRICE: true, // 422
  QUOTE_AMOUNT_OVERFLOW: true, // 422
  QUOTE_INVALID_VALIDITY: true, // 422
  QUOTE_NO_SETTLEMENT_WALLET: true, // 422
  QUOTE_INSUFFICIENT_FREE_BALANCE: true, // 422 (+ balanceDetail)
  IDEMPOTENCY_KEY_MISMATCH: true, // 422
  QUOTE_BALANCE_UNAVAILABLE: true, // 503 (retryable)
};

function isPassthroughQuoteCode(code: string): code is QuoteBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_QUOTE_BACKEND_CODE, code);
}

// Status → fallback when the backend sends no usable errorCode. Returns QuoteErrorCode (NOT the RFQ pattern's
// transport-only type): 503 resolves to the backend code QUOTE_BALANCE_UNAVAILABLE — the one status with a
// canonical backend meaning here (a retryable live-balance-read failure). Deliberately NO 404/409 case (both
// overloaded; a codeless one fails safe to SERVER_ERROR — NOT the shared statusFallbackCode, whose
// 404 → WALLET_NOT_FOUND is nonsensical for marketplace).
function quoteStatusFallback(status: number): QuoteErrorCode {
  switch (status) {
    case 401:
      return 'SESSION_EXPIRED';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'QUOTE_BALANCE_UNAVAILABLE';
    case 0:
      return 'NETWORK_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

// Prefer the backend errorCode when it's a known quote code; otherwise the status fallback. The message ALWAYS
// comes from the curated QUOTE_MESSAGES; the insufficient-balance arm additionally carries parsed balanceDetail.
function mapQuoteError(status: number, data: unknown): SubmitQuoteResult {
  const backendCode = extractBackendCode(data);
  const code: QuoteErrorCode =
    backendCode && isPassthroughQuoteCode(backendCode) ? backendCode : quoteStatusFallback(status);
  if (code === 'QUOTE_INSUFFICIENT_FREE_BALANCE')
    return insufficientErr(extractBalanceDetail(data));
  return err(code);
}

// Submit a quote (sell offer) into RFQ `rfqId`. Pure DB write — no funds move, no signing. The Idempotency-Key
// travels in the header (never the body); validUntil is always sent explicitly (canonical body → unambiguous
// idempotency comparison across a same-key retry).
export async function submitQuote(
  accessToken: string,
  rfqId: string,
  input: QuoteInput,
  idempotencyKey: string,
): Promise<SubmitQuoteResult> {
  // SEC-1: invalid rfq id → error without a fetch (path-injection guard — rfqId is in the URL path).
  if (!uuidSchema.safeParse(rfqId).success) return err('QUOTE_RFQ_NOT_FOUND');
  // Defense-in-depth: a malformed idempotency key (the one input reaching an outbound header) fails closed to
  // SERVER_ERROR rather than reaching the backend — matches the action's guard (R3.1).
  if (!uuidSchema.safeParse(idempotencyKey).success) return err('SERVER_ERROR');

  // Defense-in-depth: the same shared bounds the action enforces (no drift) — two INDEPENDENT numeric ceilings,
  // the integer count, and validUntil's structure — so a direct service caller is safe too.
  const invalid = checkQuoteBounds(input);
  if (invalid) return invalid;
  const price = input.pricePerFractionStroops;

  const outcome = await postJson(
    `/api/v1/marketplace/rfqs/${rfqId}/quotes`,
    {
      // camelCase per the TOV-175 contract: fractionCount is a JSON number, the amount is a JSON string.
      // `String(price)` canonicalizes defensively in case a client forged a numeric value that passed the regex.
      pricePerFractionStroops: String(price),
      fractionCount: input.fractionCount,
      validUntil: input.validUntil,
    },
    {
      timeoutMs: QUOTE_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    // Fail-closed: a malformed/missing money field must never reach formatUsdc (which throws).
    const parsed = quoteWireSchema.safeParse(outcome.data);
    if (!parsed.success) return err('SERVER_ERROR');
    return { status: 'success', quote: toQuote(parsed.data) };
  }

  return mapQuoteError(outcome.status, outcome.data);
}
