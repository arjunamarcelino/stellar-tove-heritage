import 'server-only';

import { z } from 'zod/v4';
import { getJson, postJson, extractBackendCode } from '@/lib/services/http';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';
import { ACCEPT_TIMEOUT_MS } from '@/lib/accept/constants';
import type {
  RfqStatus,
  TradeStatus,
  TradeFailureReason,
  OpenQuote,
  OpenQuoteStatus,
  RfqDetail,
  FeeBreakdown,
  PrepareAcceptData,
  Trade,
  AcceptInput,
  SubmitAcceptInput,
  RfqDetailResult,
  PrepareAcceptResult,
  SubmitAcceptResult,
  MyTradeResult,
  AcceptErrorCode,
  AcceptBackendErrorCode,
  AcceptTransportErrorCode,
  RfqDetailErrorCode,
} from '@/lib/types/api';

// Quote-acceptance service (TOV-178 / FR-06.04). Backend contract TOV-177 — SHIPPED (../tove-be PR #49, merged).
//
// Verified 2026-08-22 against the real DTOs: all routes, error codes + HTTP statuses, the prepare/202/accept-me
// shapes, and the failureReason set match. The passthrough classifier still degrades an unknown code to the
// HTTP-status fallback (defensive). Amounts stay i128-safe DECIMAL STRINGS end-to-end (never Number). No raw
// backend message reaches the UI — only curated ACCEPT_MESSAGES (a money flow must not leak XDR / diagnostics).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// Decimal-integer string guard — amounts validated as strings (never coerced through a lossy JS number).
// `decimalString` allows "0"/leading-zeros (legitimate for a fee component that can floor to 0); positive
// money/quantity fields use `positiveIntString` (mirrors quotes.ts) so a buggy/hostile "0" or "01" fails CLOSED
// rather than rendering an economically-null "success" (todo 179).
const decimalString = z.string().regex(/^\d+$/);
const positiveIntString = z.string().regex(/^[1-9]\d*$/);

// SEC-1: every id crossing into a backend path is uuid-validated at the boundary BEFORE the path is built.
const uuidSchema = z.uuid();

// Empty-string / null → null so `string | null` is a real invariant; a MISSING key is drift → parse fails.
const nullableString = z
  .string()
  .transform((v) => v || null)
  .nullable();

const RFQ_STATUSES = [
  'open',
  'filled',
  'canceled',
  'expired',
] as const satisfies readonly RfqStatus[];

// The detail read returns only 'open' rows today, but accept the full quote lifecycle so a future non-open row
// can't fail the whole RFQ-detail parse closed (todo 188 / PR #49 reconciliation).
const QUOTE_ROW_STATUSES = [
  'open',
  'accepted',
  'canceled',
  'expired',
  'superseded',
] as const satisfies readonly OpenQuoteStatus[];

const TRADE_STATUSES = ['pending', 'settled', 'failed'] as const satisfies readonly TradeStatus[];

// Failure reasons — the CLOSED set from the shipped settle-failure.constant.ts (PR #49). PERMISSIVE-IN: an
// unrecognized value still coalesces to 'unknown' (defensive if the set ever grows), so it's both an accepted
// wire value AND the .catch fallback.
const FAILURE_REASONS = [
  'seller_balance_insufficient',
  'seller_lockup',
  'seller_auth_lapsed',
  'buyer_signature_expired',
  'buyer_not_whitelisted',
  'buyer_usdc_insufficient',
  'party_frozen',
  'signature_invalid',
  'settlement_reverted',
  'settle_abandoned',
  'invalid_trade',
  'token_not_found',
  'unknown',
] as const satisfies readonly TradeFailureReason[];

const failureReasonSchema = z.enum(FAILURE_REASONS).catch('unknown').nullable();

// ── Wire schemas (camelCase) + spread-free allow-list mappers ─────────────────────────────────────
// Zod's default strip drops unknown keys (fail-closed egress). Each mapper closes with an explicit return
// annotation so excess-property checking rejects a stray field and the file fails to compile on drift.

// One open-quote row on the RFQ-detail read (CONFIRMED shipped DTO). Only 'open' quotes are returned. acceptable
// is REQUIRED and fails CLOSED on absence (a hard auth gate — never .optional()/.default(true)).
const openQuoteWireSchema = z.object({
  quoteId: z.string(),
  sellerHandle: nullableString,
  fractionCount: positiveIntString,
  pricePerFractionStroops: positiveIntString,
  grossStroops: positiveIntString,
  validUntil: z.string(),
  status: z.enum(QUOTE_ROW_STATUSES),
  acceptable: z.boolean(),
});

function toOpenQuote(wire: z.infer<typeof openQuoteWireSchema>): OpenQuote {
  return {
    quoteId: wire.quoteId,
    sellerHandle: wire.sellerHandle,
    fractionCount: wire.fractionCount,
    pricePerFractionStroops: wire.pricePerFractionStroops,
    grossStroops: wire.grossStroops,
    validUntil: wire.validUntil,
    status: wire.status,
    acceptable: wire.acceptable,
  };
}

const rfqDetailWireSchema = z.object({
  id: z.string(),
  artworkId: z.string(),
  artworkSlug: nullableString,
  fractionCount: positiveIntString,
  maxPricePerFractionStroops: positiveIntString,
  status: z.enum(RFQ_STATUSES),
  expiresAt: z.string(),
  createdAt: z.string(),
  quotes: z.array(openQuoteWireSchema),
});

function toRfqDetail(wire: z.infer<typeof rfqDetailWireSchema>): RfqDetail {
  // Defensive re-sort price ASC (the backend already sorts, but the FE never trusts order for a money gate).
  const quotes = wire.quotes
    .map(toOpenQuote)
    .sort((a, b) =>
      BigInt(a.pricePerFractionStroops) < BigInt(b.pricePerFractionStroops)
        ? -1
        : BigInt(a.pricePerFractionStroops) > BigInt(b.pricePerFractionStroops)
          ? 1
          : 0,
    );
  return {
    id: wire.id,
    artworkId: wire.artworkId,
    artworkSlug: wire.artworkSlug,
    fractionCount: wire.fractionCount,
    maxPricePerFractionStroops: wire.maxPricePerFractionStroops,
    status: wire.status,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    quotes,
  };
}

// The prepare fee breakdown. Spread-free allow-list.
const feeBreakdownSchema = z.object({
  grossStroops: positiveIntString,
  // Fee components may legitimately floor to "0" on a tiny trade → decimalString (todo 179).
  sellerNetStroops: decimalString,
  platformFeeStroops: decimalString,
  artistRoyaltyStroops: decimalString,
});

function toFeeBreakdown(wire: z.infer<typeof feeBreakdownSchema>): FeeBreakdown {
  return {
    grossStroops: wire.grossStroops,
    sellerNetStroops: wire.sellerNetStroops,
    platformFeeStroops: wire.platformFeeStroops,
    artistRoyaltyStroops: wire.artistRoyaltyStroops,
  };
}

// The prepare envelope — the one place ceremony material crosses to the client. Spread-free allow-list:
// only these fields reach the client; buyerAuthEntryXdr is the buyer's own unsigned entry (NOT a full txXdr).
const prepareWireSchema = z.object({
  buyerAuthEntryXdr: z.string(),
  challenge: z.string(),
  credentialId: z.string(),
  transports: nullableString,
  rpId: z.string(),
  expiresAtLedger: z.number().int(),
  trade: feeBreakdownSchema,
});

function toPrepareAcceptData(wire: z.infer<typeof prepareWireSchema>): PrepareAcceptData {
  return {
    buyerAuthEntryXdr: wire.buyerAuthEntryXdr,
    challenge: wire.challenge,
    credentialId: wire.credentialId,
    transports: wire.transports,
    rpId: wire.rpId,
    expiresAtLedger: wire.expiresAtLedger,
    trade: toFeeBreakdown(wire.trade),
  };
}

// ACCEPT_INSUFFICIENT_USDC extra fields — parsed defensively as strings; absent/malformed → omitted.
const insufficientUsdcSchema = z.object({
  requiredStroops: decimalString,
  availableStroops: decimalString,
});

// The 202 accept body. status is always 'pending' on a fresh 202 (or a replay).
const submitWireSchema = z.object({
  tradeId: z.string(),
  status: z.enum(TRADE_STATUSES),
});

// The accept/me trade projection. registryEventId is a forward-compat null today (no backing column until TOV-181).
const tradeWireSchema = z.object({
  tradeId: z.string(),
  status: z.enum(TRADE_STATUSES),
  quoteId: z.string(),
  count: positiveIntString,
  grossStroops: positiveIntString,
  txHash: z.string().nullable(),
  settledAt: z.string().nullable(),
  failureReason: failureReasonSchema,
  registryEventId: z.string().nullable(),
  createdAt: z.string(),
});

function toTrade(wire: z.infer<typeof tradeWireSchema>): Trade {
  return {
    tradeId: wire.tradeId,
    status: wire.status,
    quoteId: wire.quoteId,
    count: wire.count,
    grossStroops: wire.grossStroops,
    txHash: wire.txHash,
    settledAt: wire.settledAt,
    failureReason: wire.failureReason,
    registryEventId: wire.registryEventId,
    createdAt: wire.createdAt,
  };
}

// ── RFQ-detail read error mapping (authed, owner-scoped) ────────────────────────────────────────────
// The shipped 404 backend code is QUOTE_RFQ_NOT_FOUND. For THIS read a 404 is unambiguous (gone or not-yours,
// no existence oracle), so — unlike the overloaded accept endpoints — the status fallback MAY map 404 →
// RFQ_NOT_FOUND. Never the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is nonsensical here).
function rfqDetailStatusFallback(status: number): RfqDetailErrorCode {
  switch (status) {
    case 401:
      return 'SESSION_EXPIRED';
    case 404:
      return 'RFQ_NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 0:
      return 'NETWORK_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

function mapRfqDetailError(
  status: number,
  data: unknown,
): { code: RfqDetailErrorCode; message: string } {
  const code: RfqDetailErrorCode =
    extractBackendCode(data) === 'QUOTE_RFQ_NOT_FOUND'
      ? 'RFQ_NOT_FOUND'
      : rfqDetailStatusFallback(status);
  return { code, message: ACCEPT_MESSAGES[code] };
}

// ── Passthrough-classifier triad for the AUTHED accept endpoints ─────────────────────────────────────
// Keyed on the union so a new AcceptBackendErrorCode fails to compile until classified. NOTE: none of these
// ACCEPT_*/TRADE_* codes exist in the shipped backend yet — the classifier degrades an unknown code to the
// status fallback (defensive), never throws.
const IS_ACCEPT_BACKEND_CODE: Record<AcceptBackendErrorCode, true> = {
  ACCEPT_NOT_RFQ_BUYER: true, // 403
  ACCEPT_RFQ_NOT_OPEN: true, // 422
  ACCEPT_QUOTE_NOT_ACCEPTABLE: true, // 422
  ACCEPT_QUOTE_NOT_AUTHORIZED: true, // 422
  ACCEPT_NOT_WHITELISTED: true, // 403
  ACCEPT_INSUFFICIENT_USDC: true, // 422 (+ requiredStroops/availableStroops)
  ACCEPT_CHALLENGE_EXPIRED: true, // 422
  TRADE_ALREADY_IN_FLIGHT: true, // 409
  TRADE_NOT_FOUND: true, // 404 (accept/me)
  ACCEPT_SETTLEMENT_UNAVAILABLE: true, // 503
  IDEMPOTENCY_KEY_IN_FLIGHT: true, // 409
  IDEMPOTENCY_KEY_MISMATCH: true, // 422
};

function isPassthroughAcceptCode(code: string): code is AcceptBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_ACCEPT_BACKEND_CODE, code);
}

// Status → transport-only fallback. No 404/409 case: both overloaded, meaning comes only from the errorCode; a
// codeless 404/409 fails safe to SERVER_ERROR.
function acceptStatusFallback(status: number): AcceptTransportErrorCode {
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

function mapAcceptError(status: number, data: unknown): { code: AcceptErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code: AcceptErrorCode =
    backendCode && isPassthroughAcceptCode(backendCode)
      ? backendCode
      : acceptStatusFallback(status);
  return { code, message: ACCEPT_MESSAGES[code] };
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────

// RFQ detail + embedded open quotes (CONFIRMED shipped). Per-user + owner-scoped → NEVER route-cached
// (cache: 'no-store'). A 404 means gone-or-not-yours → RFQ_NOT_FOUND.
export async function getRfqDetail(accessToken: string, rfqId: string): Promise<RfqDetailResult> {
  if (!uuidSchema.safeParse(rfqId).success) {
    return { status: 'error', code: 'RFQ_NOT_FOUND', message: ACCEPT_MESSAGES.RFQ_NOT_FOUND };
  }

  const outcome = await getJson(`/api/v1/marketplace/rfqs/${rfqId}`, {
    timeoutMs: ACCEPT_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (!outcome.ok) return { status: 'error', ...mapRfqDetailError(outcome.status, outcome.data) };

  const parsed = rfqDetailWireSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
  }
  return { status: 'success', rfq: toRfqDetail(parsed.data) };
}

// The caller's latest trade on this RFQ — per-user, NEVER route-cached. A 200/204 empty body OR a 404
// TRADE_NOT_FOUND → { trade: null } (the NORMAL "no trade yet" state — must NOT become a page error, or a
// first-time buyer lands on an error gate). Any other error stays in the error path.
export async function getMyTrade(accessToken: string, rfqId: string): Promise<MyTradeResult> {
  if (!uuidSchema.safeParse(rfqId).success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
  }

  const outcome = await getJson(`/api/v1/marketplace/rfqs/${rfqId}/accept/me`, {
    timeoutMs: ACCEPT_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (outcome.ok) {
    if (outcome.data == null) return { status: 'success', trade: null }; // 204/empty → no trade yet
    const parsed = tradeWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
    }
    return { status: 'success', trade: toTrade(parsed.data) };
  }

  // 404 TRADE_NOT_FOUND is the "no trade yet" state, not an error.
  if (outcome.status === 404 && extractBackendCode(outcome.data) === 'TRADE_NOT_FOUND') {
    return { status: 'success', trade: null };
  }

  return { status: 'error', ...mapAcceptError(outcome.status, outcome.data) };
}

// ── Ceremony writes ─────────────────────────────────────────────────────────────────────────────────

// Prepare = feasibility + the buyer's own unsigned auth entry + a WebAuthn challenge (no trade created;
// idempotent). The Idempotency-Key travels in the header, never the body.
export async function prepareAccept(
  accessToken: string,
  rfqId: string,
  input: AcceptInput,
  idempotencyKey: string,
): Promise<PrepareAcceptResult> {
  if (
    !uuidSchema.safeParse(rfqId).success ||
    !uuidSchema.safeParse(input.quoteId).success ||
    !uuidSchema.safeParse(idempotencyKey).success
  ) {
    return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
  }

  const outcome = await postJson(
    `/api/v1/marketplace/rfqs/${rfqId}/accept/prepare`,
    { quoteId: input.quoteId },
    {
      timeoutMs: ACCEPT_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    const parsed = prepareWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
    }
    return { status: 'success', data: toPrepareAcceptData(parsed.data) };
  }

  const error = mapAcceptError(outcome.status, outcome.data);
  if (error.code === 'ACCEPT_INSUFFICIENT_USDC') {
    const detail = insufficientUsdcSchema.safeParse(outcome.data);
    if (detail.success) {
      return {
        status: 'error',
        ...error,
        requiredStroops: detail.data.requiredStroops,
        availableStroops: detail.data.availableStroops,
      };
    }
  }
  return { status: 'error', ...error };
}

// Submit the passkey-signed accept with the SAME Idempotency-Key as prepare. buyerAuthEntryXdr is echoed
// verbatim (SEC-6); the assertion fields are opaque base64url passed through, never parsed for trust. → 202.
export async function submitAccept(
  accessToken: string,
  rfqId: string,
  input: SubmitAcceptInput,
  idempotencyKey: string,
): Promise<SubmitAcceptResult> {
  if (
    !uuidSchema.safeParse(rfqId).success ||
    !uuidSchema.safeParse(input.quoteId).success ||
    !uuidSchema.safeParse(idempotencyKey).success
  ) {
    return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
  }

  const outcome = await postJson(
    `/api/v1/marketplace/rfqs/${rfqId}/accept`,
    // EXACTLY the five fields the shipped AcceptDto declares — no credentialId (the backend's
    // forbidNonWhitelisted ValidationPipe 400s any extra field; PR #49 reconciliation).
    {
      quoteId: input.quoteId,
      buyerAuthEntryXdr: input.buyerAuthEntryXdr,
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      signature: input.signature,
    },
    {
      timeoutMs: ACCEPT_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    const parsed = submitWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: ACCEPT_MESSAGES.SERVER_ERROR };
    }
    // A 202 is always pending; the poller drives it to settled/failed.
    return { status: 'success', tradeId: parsed.data.tradeId, tradeStatus: 'pending' };
  }

  return { status: 'error', ...mapAcceptError(outcome.status, outcome.data) };
}
