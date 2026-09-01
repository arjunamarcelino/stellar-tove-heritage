import 'server-only';

import { z } from 'zod/v4';
import { postJson, extractBackendCode } from '@/lib/services/http';
import { RFQ_MESSAGES } from '@/lib/rfq/rfqMessages';
import { RFQ_TIMEOUT_MS } from '@/lib/rfq/constants';
import { checkRfqBounds } from '@/lib/rfq/validation';
import type {
  Rfq,
  RfqStatus,
  RfqInput,
  CreateRfqResult,
  RfqErrorCode,
  RfqBackendErrorCode,
  RfqTransportErrorCode,
} from '@/lib/types/api';

// The RFQ create service (TOV-173 / FR-06.01). Backend contract TOV-172. The wire is camelCase — the house
// convention across every authenticated api/v1 surface (bids, /me/holdings), finalized for RFQ in backend
// todo #352 (request + response flipped snake_case → camelCase). Uses the shared http seam; NO raw backend
// message ever reaches the UI — every error surfaces only curated RFQ_MESSAGES copy. Amounts stay
// i128/2^96-safe DECIMAL STRINGS end-to-end. The 201 body is validated fail-closed before it's rendered, and
// the mapper is a spread-free allow-list that DROPS internal ids (collectorSub / fractionContractId /
// createdAt) so they never reach the browser (egress minimization).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// Decimal-integer string guard — amounts are validated as strings (never coerced through a lossy JS number).
const decimalString = z.string().regex(/^\d+$/);

// expiresAt must be a parseable timestamp — validated fail-closed like the money fields, because it is fed
// straight to `new Date(...)` → Intl.DateTimeFormat.format in RfqCountdown, which THROWS on an invalid Date
// (RangeError) during render. A malformed value fails to SERVER_ERROR instead of crashing the confirmation.
const isoDatetime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'invalid datetime',
});

// SEC-1: the artwork id is uuid-validated at the service boundary BEFORE the (constant) path is used. The id
// travels in the JSON body, not the URL, but the guard rejects a malformed id without a fetch regardless.
const uuidSchema = z.uuid();

// Curated error result — the message ALWAYS comes from RFQ_MESSAGES (never extractBackendMessage).
const err = (code: RfqErrorCode): CreateRfqResult => ({
  status: 'error',
  code,
  message: RFQ_MESSAGES[code],
});

// Const-tuple source of truth for the RFQ lifecycle — `satisfies` fails to compile if it drifts from the
// RfqStatus union, and z.enum rejects any unknown wire status at the parse boundary.
const RFQ_STATUSES = [
  'open',
  'filled',
  'canceled',
  'expired',
] as const satisfies readonly RfqStatus[];

// ── 201 wire schema (camelCase) + spread-free, TRIMMED mapper ────────────────────────────────────────
// Zod's default strip drops the unmapped internal ids (collectorSub / artworkId / fractionContractId /
// createdAt) — the fail-closed egress guard. balanceWarning is present-only-when-fresh (a replayed 201 may
// omit it). The mapper closes with an explicit `: Rfq` return annotation so a stray field fails to compile.
const balanceWarningWireSchema = z.object({
  requiredStroops: decimalString,
  availableStroops: decimalString,
});

const rfqWireSchema = z.object({
  id: z.string(),
  fractionCount: decimalString,
  maxPricePerFractionStroops: decimalString,
  status: z.enum(RFQ_STATUSES),
  expiresAt: isoDatetime,
  balanceWarning: balanceWarningWireSchema.optional(),
});

function toRfq(wire: z.infer<typeof rfqWireSchema>): Rfq {
  return {
    id: wire.id,
    fractionCount: wire.fractionCount,
    maxPricePerFractionStroops: wire.maxPricePerFractionStroops,
    status: wire.status,
    expiresAt: wire.expiresAt,
    // Conditional spread so the key is absent (never `undefined`) when the backend omits the warning.
    ...(wire.balanceWarning && {
      balanceWarning: {
        requiredStroops: wire.balanceWarning.requiredStroops,
        availableStroops: wire.balanceWarning.availableStroops,
      },
    }),
  };
}

// ── Error taxonomy (mirrors the offering passthrough triad) ──────────────────────────────────────────
// Keyed on the union so a new RfqBackendErrorCode fails to compile until classified. Every backend RFQ code is
// authoritative and passed through verbatim.
const IS_RFQ_BACKEND_CODE: Record<RfqBackendErrorCode, true> = {
  VALIDATION_FAILED: true, // 400
  RFQ_NOT_WHITELISTED: true, // 403
  ARTWORK_NOT_FOUND: true, // 404
  RFQ_ARTWORK_NOT_FRACTIONALIZED: true, // 422
  RFQ_INVALID_PRICE: true, // 422
  RFQ_AMOUNT_OVERFLOW: true, // 422
  RFQ_TOO_MANY_ACTIVE: true, // 422
  IDEMPOTENCY_KEY_IN_FLIGHT: true, // 409
  IDEMPOTENCY_KEY_MISMATCH: true, // 422
};

function isPassthroughRfqCode(code: string): code is RfqBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_RFQ_BACKEND_CODE, code);
}

// Status → transport-only fallback. Deliberately NO case 404 and NO case 409: both are overloaded and their
// real meaning comes ONLY from the backend errorCode. A codeless 404/409 fails safe to SERVER_ERROR (NOT the
// shared statusFallbackCode, whose 404 → WALLET_NOT_FOUND is nonsensical for RFQ).
function rfqStatusFallback(status: number): RfqTransportErrorCode {
  switch (status) {
    case 401:
      return 'SESSION_EXPIRED';
    case 429:
      return 'RATE_LIMITED';
    case 0:
      return 'NETWORK_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

// Prefer the backend errorCode when it's a known RFQ code; otherwise the status fallback. The message ALWAYS
// comes from the curated RFQ_MESSAGES.
function mapRfqError(status: number, data: unknown): { code: RfqErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code: RfqErrorCode =
    backendCode && isPassthroughRfqCode(backendCode) ? backendCode : rfqStatusFallback(status);
  return { code, message: RFQ_MESSAGES[code] };
}

// Create an RFQ (buy intent). Pure create — no funds move, no signing. The Idempotency-Key travels in the
// header (never the body); expiry_hours is always sent explicitly (canonical body → unambiguous idempotency).
export async function createRfq(
  accessToken: string,
  artworkId: string,
  input: RfqInput,
  idempotencyKey: string,
): Promise<CreateRfqResult> {
  // SEC-1: invalid artwork id → error without a fetch.
  if (!uuidSchema.safeParse(artworkId).success) return err('ARTWORK_NOT_FOUND');

  // SEC-3 defense-in-depth: the same shared bounds the action enforces (no drift) — the two INDEPENDENT
  // numeric ceilings, the integer count, AND the expiry allow-list — so a direct service caller is safe too.
  const invalid = checkRfqBounds(input);
  if (invalid) return invalid;
  const price = input.maxPricePerFractionStroops;

  const outcome = await postJson(
    '/api/v1/marketplace/rfqs',
    {
      // Per the TOV-172 contract: fractionCount is a JSON number (integer), the amount is a JSON string.
      // `String(price)` canonicalizes defensively in case a client forged a numeric value that passed the
      // regex above, so the wire body never carries the amount as a JSON number.
      artworkId,
      fractionCount: input.fractionCount,
      maxPricePerFractionStroops: String(price),
      expiryHours: input.expiryHours,
    },
    {
      timeoutMs: RFQ_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    // P9 fail-closed: a malformed/missing money field must never reach formatUsdc (which throws).
    const parsed = rfqWireSchema.safeParse(outcome.data);
    if (!parsed.success) return err('SERVER_ERROR');
    return { status: 'success', rfq: toRfq(parsed.data) };
  }

  return { status: 'error', ...mapRfqError(outcome.status, outcome.data) };
}
