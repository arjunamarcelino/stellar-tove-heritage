import 'server-only';

import { z } from 'zod/v4';
import { getJson, postJson, extractBackendCode } from '@/lib/services/http';
import { OFFERINGS_MESSAGES } from '@/lib/offerings/offeringsMessages';
import { OFFERING_TIMEOUT_MS, OFFERING_REVALIDATE_S, I128_MAX } from '@/lib/offerings/constants';
import type {
  Offering,
  OfferingStatus,
  Bid,
  BidStatus,
  BidInput,
  SubmitBidInput,
  PrepareBidData,
  OfferingResult,
  PrepareBidResult,
  SubmitBidResult,
  MyBidResult,
  BidErrorCode,
  BidBackendErrorCode,
  BidTransportErrorCode,
  OfferingReadErrorCode,
} from '@/lib/types/api';

// The offering-subscription service (TOV-157 / FR-05.03). Backend contract TOV-156 (bid endpoints, temp) +
// TOV-163 (public read, assumed shape). Uses the shared http seam; NO raw backend message ever reaches the
// UI — every error surfaces only curated OFFERINGS_MESSAGES copy (a money flow must not leak XDR fragments /
// internal diagnostics). Amounts stay i128-safe DECIMAL STRINGS end-to-end — never coerced through a lossy JS
// number, never `.transform(BigInt)` (a bigint domain field throws on JSON.stringify across the RSC boundary).

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// Decimal-integer string guard — amounts are validated as strings (never coerced through a lossy JS number).
const decimalString = z.string().regex(/^\d+$/);

// SEC-1: every id crossing into a backend path is uuid-validated at the service boundary BEFORE the path is
// built (path-injection / SSRF guard). An invalid id rejects to the not-found/error path without a fetch.
const uuidSchema = z.uuid();

// Empty-string / null → null so `string | null` is a real invariant. Keys are always present (nullable, not
// optional): a MISSING key is drift → the parse fails → SERVER_ERROR.
const nullableString = z
  .string()
  .transform((v) => v || null)
  .nullable();

// artworkImageUrl: keep only a valid https URL; a malformed/whitespace/non-https value normalizes to null so
// it deterministically becomes the placeholder tile instead of reaching next/image (holdings.ts pattern).
const imageUrlSchema = z
  .string()
  .nullable()
  .transform((v) => {
    if (!v) return null;
    try {
      return new URL(v).protocol === 'https:' ? v : null;
    } catch {
      return null;
    }
  });

// Const-tuple source of truth for the offering lifecycle — `satisfies` fails to compile if it drifts from the
// OfferingStatus union, and z.enum rejects any unknown wire status at the parse boundary.
const OFFERING_STATUSES = [
  'planned',
  'approved',
  'opened',
  'subscribed',
  'settled',
  'canceled',
] as const satisfies readonly OfferingStatus[];

const BID_STATUSES = ['submitted', 'escrowed', 'failed'] as const satisfies readonly BidStatus[];

// ── Wire schemas (camelCase) + spread-free allow-list mappers ─────────────────────────────────────
// Zod's default strip drops unknown keys (the fail-closed egress guard). Each mapper closes with an explicit
// `: Offering` / `: Bid` / `: PrepareBidData` return annotation so excess-property checking rejects any stray
// field and the file fails to compile if the domain type gains an unmapped one.

const offeringWireSchema = z.object({
  id: z.string(),
  artworkId: z.string(),
  status: z.enum(OFFERING_STATUSES),
  lowPriceStroops: decimalString,
  highPriceStroops: decimalString,
  publicFloat: decimalString,
  windowOpenAt: z.string(),
  windowCloseAt: z.string(),
  // present-but-null (null until escrow is deployed) — a DROPPED key is drift → parse fails → SERVER_ERROR.
  escrowContractAddress: z.string().nullable(),
  artworkTitle: z.string(),
  artworkImageUrl: imageUrlSchema,
  artistHandle: nullableString,
});

function toOffering(wire: z.infer<typeof offeringWireSchema>): Offering {
  return {
    id: wire.id,
    artworkId: wire.artworkId,
    status: wire.status,
    lowPriceStroops: wire.lowPriceStroops,
    highPriceStroops: wire.highPriceStroops,
    publicFloat: wire.publicFloat,
    windowOpenAt: wire.windowOpenAt,
    windowCloseAt: wire.windowCloseAt,
    escrowContractAddress: wire.escrowContractAddress,
    artworkTitle: wire.artworkTitle,
    artworkImageUrl: wire.artworkImageUrl,
    artistHandle: wire.artistHandle,
  };
}

const bidWireSchema = z.object({
  id: z.string(),
  offeringId: z.string(),
  price: decimalString,
  count: z.number().int(),
  escrowAmountStroops: decimalString,
  status: z.enum(BID_STATUSES),
  // present-but-null until escrowed — nullable, not optional (a dropped key is drift).
  chainBidId: z.number().int().nullable(),
  escrowTxHash: z.string().nullable(),
  createdAt: z.string(),
});

function toBid(wire: z.infer<typeof bidWireSchema>): Bid {
  return {
    id: wire.id,
    offeringId: wire.offeringId,
    price: wire.price,
    count: wire.count,
    escrowAmountStroops: wire.escrowAmountStroops,
    status: wire.status,
    chainBidId: wire.chainBidId,
    escrowTxHash: wire.escrowTxHash,
    createdAt: wire.createdAt,
  };
}

// The prepare envelope — the one place ceremony material legitimately crosses to the client (mirrors
// ExportBeginData). The mapper is a spread-free `: PrepareBidData` allow-list (AC-10): only these seven fields
// reach the client; any other prepare-response field is stripped and can never leak.
const prepareWireSchema = z.object({
  txXdr: z.string(),
  challenge: z.string(),
  credentialId: z.string(),
  transports: nullableString,
  rpId: z.string(),
  escrowAmountStroops: decimalString,
  expiresAtLedger: z.number().int(),
});

function toPrepareBidData(wire: z.infer<typeof prepareWireSchema>): PrepareBidData {
  return {
    txXdr: wire.txXdr,
    challenge: wire.challenge,
    credentialId: wire.credentialId,
    transports: wire.transports,
    rpId: wire.rpId,
    escrowAmountStroops: wire.escrowAmountStroops,
    expiresAtLedger: wire.expiresAtLedger,
  };
}

// BID_INSUFFICIENT_BALANCE carries the Zod-validated required/available stroops so the panel can interpolate
// them into a curated sentence (SEC-7) — never extractBackendMessage.
const balanceDetailSchema = z.object({
  requiredStroops: decimalString,
  availableStroops: decimalString,
});

// ── Public offering read (tokenless) — OfferingReadErrorCode fallback ──────────────────────────────
// This read is tokenless, so it can NEVER produce SESSION_EXPIRED. A codeless 404 defaults to
// OFFERING_NOT_FOUND (its only 404 meaning); everything else folds to RATE_LIMITED / NETWORK_ERROR /
// SERVER_ERROR. Deliberately NOT the shared statusFallbackCode (its 404 → WALLET_NOT_FOUND is nonsensical here
// and isn't an OfferingReadErrorCode).
function offeringReadStatusFallback(status: number): OfferingReadErrorCode {
  if (status === 404) return 'OFFERING_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 0) return 'NETWORK_ERROR';
  return 'SERVER_ERROR';
}

function mapOfferingReadError(
  status: number,
  data: unknown,
): { code: OfferingReadErrorCode; message: string } {
  // Prefer an explicit OFFERING_NOT_FOUND errorCode regardless of status; otherwise fall back on the status.
  const code: OfferingReadErrorCode =
    extractBackendCode(data) === 'OFFERING_NOT_FOUND'
      ? 'OFFERING_NOT_FOUND'
      : offeringReadStatusFallback(status);
  return { code, message: OFFERINGS_MESSAGES[code] };
}

// ── Passthrough-classifier triad for the AUTHED bid endpoints (prepare/submit/getMyBid) ────────────
// Keyed on the union so a new BidBackendErrorCode fails to compile until classified. Every backend bid code is
// authoritative and passed through verbatim; WALLET_NOT_FOUND and OFFERING_NOT_FOUND are BOTH 404 — the only
// way to tell them apart is the errorCode, so the status fallback below must never guess a 404 (or a 409).
const IS_BID_BACKEND_CODE: Record<BidBackendErrorCode, true> = {
  BID_INSUFFICIENT_BALANCE: true, // 422
  BID_BELOW_LOW_PRICE: true, // 422
  BID_ABOVE_HIGH_PRICE: true, // 422
  BID_COUNT_EXCEEDS_FLOAT: true, // 422
  OFFERING_WINDOW_NOT_OPEN: true, // 422
  OFFERING_WINDOW_CLOSED: true, // 422 (prepare) / 422 (submit, post-sign)
  OFFERING_NOT_OPEN: true, // 409
  BID_ALREADY_ACTIVE: true, // 409
  IDEMPOTENCY_KEY_IN_FLIGHT: true, // 409
  IDEMPOTENCY_KEY_MISMATCH: true, // 422
  BID_CHALLENGE_EXPIRED: true, // 422 (submit, sync, no row)
  BID_NOT_WHITELISTED: true, // 403
  WALLET_NOT_FOUND: true, // 404 (only via explicit errorCode → "enrol a passkey")
  OFFERING_NOT_FOUND: true, // 404
};

// True only for codes the backend is authoritative for (passed through verbatim). A `false` return means "not
// a backend bid code, use the HTTP-status fallback" — not "invalid string".
function isPassthroughBidCode(code: string): code is BidBackendErrorCode {
  return Object.prototype.hasOwnProperty.call(IS_BID_BACKEND_CODE, code);
}

// Status → transport-only fallback for the bid endpoints. Deliberately NO case 404 and NO case 409: both are
// overloaded (404 = OFFERING_NOT_FOUND vs WALLET_NOT_FOUND; 409 = several distinct conditions) and their real
// meaning comes ONLY from the backend errorCode. A codeless 404/409 must fail safe to SERVER_ERROR, never
// silently to WALLET_NOT_FOUND (which would wrongly prompt "enrol a passkey" — SEC-2).
function bidStatusFallback(status: number): BidTransportErrorCode {
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

// Prefer the backend errorCode when it's a known bid code; otherwise the status fallback. The message ALWAYS
// comes from the curated OFFERINGS_MESSAGES — never extractBackendMessage (a money flow must not leak raw
// diagnostics; SEC-7).
function mapBidError(status: number, data: unknown): { code: BidErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code: BidErrorCode =
    backendCode && isPassthroughBidCode(backendCode) ? backendCode : bidStatusFallback(status);
  return { code, message: OFFERINGS_MESSAGES[code] };
}

// ── Public reads ───────────────────────────────────────────────────────────────────────────────────

// Public, tokenless read (TOV-163). Cacheable: the identical body is shared across all viewers via
// revalidate + a per-offering tag. The countdown is computed client-side from the absolute window timestamps,
// so a cached body never staleness the clock — only `status` transitions lag by OFFERING_REVALIDATE_S (the
// prepare-time server verdict backstops it).
export async function getOffering(offeringId: string): Promise<OfferingResult> {
  // SEC-1: invalid id → not-found without a fetch.
  if (!uuidSchema.safeParse(offeringId).success) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  const outcome = await getJson(`/v1/offerings/${offeringId}`, {
    timeoutMs: OFFERING_TIMEOUT_MS,
    next: { revalidate: OFFERING_REVALIDATE_S, tags: [`offering:${offeringId}`] },
  });

  if (!outcome.ok)
    return { status: 'error', ...mapOfferingReadError(outcome.status, outcome.data) };

  const parsed = offeringWireSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', offering: toOffering(parsed.data) };
}

// Resolve an artwork → its single active offering. OPEN DEP #2 (TOV-153): the artwork read is ASSUMED to embed
// an `activeOffering` object (nullable Offering wire); a null/absent embed = "no active offering" →
// OFFERING_NOT_FOUND. If the embed shape lands differently, only this function + its schema change (fallback:
// route directly by offeringId). A present-but-malformed embed is drift → SERVER_ERROR.
const artworkEnvelopeSchema = z.object({ activeOffering: offeringWireSchema.nullish() });

export async function getActiveOffering(artworkId: string): Promise<OfferingResult> {
  // SEC-1: invalid id → not-found without a fetch.
  if (!uuidSchema.safeParse(artworkId).success) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  const outcome = await getJson(`/v1/artworks/${artworkId}`, {
    timeoutMs: OFFERING_TIMEOUT_MS,
    next: { revalidate: OFFERING_REVALIDATE_S, tags: [`artwork-offering:${artworkId}`] },
  });

  if (!outcome.ok)
    return { status: 'error', ...mapOfferingReadError(outcome.status, outcome.data) };

  const parsed = artworkEnvelopeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
  }

  const active = parsed.data.activeOffering;
  if (!active) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  return { status: 'success', offering: toOffering(active) };
}

// ── Authed bid endpoints ─────────────────────────────────────────────────────────────────────────

// Prepare = a QUOTE, not a reservation (contract: "no bid created, idempotent"): feasibility + WebAuthn
// challenge only. Fail-fast — band/window/whitelist/BALANCE/uuid all reject HERE, before the passkey. The
// Idempotency-Key travels in the header (never the body).
export async function prepareBid(
  accessToken: string,
  offeringId: string,
  input: BidInput,
  idempotencyKey: string,
): Promise<PrepareBidResult> {
  // SEC-1: invalid id → error without a fetch (OFFERING_NOT_FOUND is a valid BidErrorCode).
  if (!uuidSchema.safeParse(offeringId).success) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  // SEC-3 defense-in-depth (todo 153): the overflow/shape bound also lives here, not only in the action, so it
  // travels with the service. price = positive integer stroops; count = positive integer; price·count ≤ i128.
  if (
    !/^[1-9]\d*$/.test(input.price) ||
    !Number.isSafeInteger(input.count) ||
    input.count < 1 ||
    BigInt(input.price) * BigInt(input.count) > I128_MAX
  ) {
    return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
  }

  const outcome = await postJson(
    `/v1/offerings/${offeringId}/bids/prepare`,
    { price: input.price, count: input.count },
    {
      timeoutMs: OFFERING_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    const parsed = prepareWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
    }
    return { status: 'success', data: toPrepareBidData(parsed.data) };
  }

  const error = mapBidError(outcome.status, outcome.data);
  if (error.code === 'BID_INSUFFICIENT_BALANCE') {
    // Interpolate the Zod-validated amounts (never a raw backend message) — a missing/malformed detail body
    // just omits the richer sentence, leaving the generic curated copy.
    const detail = balanceDetailSchema.safeParse(outcome.data);
    if (detail.success) {
      return {
        status: 'error',
        ...error,
        required: detail.data.requiredStroops,
        available: detail.data.availableStroops,
      };
    }
  }

  return { status: 'error', ...error };
}

// Submit the passkey-signed bid. txXdr is echoed back VERBATIM from prepare (SEC-5). The temp TOV-156 contract
// lists four assertion fields; credentialId is included defensively so the backend can disambiguate the
// credential if it needs to (harmless if ignored). Same Idempotency-Key as the paired prepare.
export async function submitBid(
  accessToken: string,
  offeringId: string,
  input: SubmitBidInput,
  idempotencyKey: string,
): Promise<SubmitBidResult> {
  // SEC-1: invalid id → error without a fetch.
  if (!uuidSchema.safeParse(offeringId).success) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  const outcome = await postJson(
    `/v1/offerings/${offeringId}/bids`,
    {
      txXdr: input.txXdr,
      credentialId: input.credentialId,
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      signature: input.signature,
    },
    {
      timeoutMs: OFFERING_TIMEOUT_MS,
      headers: { ...authHeaders(accessToken), 'Idempotency-Key': idempotencyKey },
    },
  );

  if (outcome.ok) {
    const parsed = bidWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
    }
    return { status: 'success', bid: toBid(parsed.data) };
  }

  return { status: 'error', ...mapBidError(outcome.status, outcome.data) };
}

// The caller's active bid — per-user, so NEVER route-cached (cache: 'no-store'). A 200/204 empty body means
// "no active bid" → { bid: null } (drives the bid form, not an error). A 404 stays in the ERROR path branched
// on errorCode: a 404 WALLET_NOT_FOUND must surface the enrol signal, and a codeless 404 → SERVER_ERROR (SEC-2)
// — it must NOT masquerade as bid:null.
export async function getMyBid(accessToken: string, offeringId: string): Promise<MyBidResult> {
  // SEC-1: invalid id → error without a fetch.
  if (!uuidSchema.safeParse(offeringId).success) {
    return {
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
    };
  }

  const outcome = await getJson(`/v1/offerings/${offeringId}/bids/me`, {
    timeoutMs: OFFERING_TIMEOUT_MS,
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (outcome.ok) {
    // 204 / empty body (getJson resolves it to null) → no active bid.
    if (outcome.data == null) return { status: 'success', bid: null };

    const parsed = bidWireSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { status: 'error', code: 'SERVER_ERROR', message: OFFERINGS_MESSAGES.SERVER_ERROR };
    }
    return { status: 'success', bid: toBid(parsed.data) };
  }

  return { status: 'error', ...mapBidError(outcome.status, outcome.data) };
}
