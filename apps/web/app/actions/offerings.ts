'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { COOKIE_KEYS } from '@/lib/constants';
import { prepareBid, submitBid, getMyBid } from '@/lib/services/offerings';
import { OFFERINGS_MESSAGES } from '@/lib/offerings/offeringsMessages';
import { I128_MAX } from '@/lib/offerings/constants';
import type {
  BidInput,
  MyBidResult,
  PrepareBidResult,
  SubmitBidInput,
  SubmitBidResult,
} from '@/lib/types/api';

// Thin server actions for the FR-05.03 bid flow (TOV-157). Read the Bearer token from the httpOnly cookie
// (never trust a client-passed token), re-validate input (defense-in-depth), delegate to the service, and
// return the result verbatim — actions NEVER redirect (the client hook owns navigation). The Idempotency-Key
// is a plain positional argument routed to the service header (mirrors app/actions/walletManage.ts), never a
// FormData field. Message copy is always curated (OFFERINGS_MESSAGES) — a money flow never leaks raw backend text.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: OFFERINGS_MESSAGES.SESSION_EXPIRED,
};

// offeringId comes from SSR resolution (not user free-text), so the uuid check is defense-in-depth (SEC-1) —
// a malformed id can't name a real offering, so it maps to OFFERING_NOT_FOUND rather than fetching.
const NOT_FOUND_ERROR = {
  status: 'error' as const,
  code: 'OFFERING_NOT_FOUND' as const,
  message: OFFERINGS_MESSAGES.OFFERING_NOT_FOUND,
};

// A malformed shape reaching here is a client bug (the panel validates first) — fail safe/generic rather than
// leak specifics; BidErrorCode carries no VALIDATION_FAILED, so SERVER_ERROR is the defensive fallback.
const SERVER_ERROR = {
  status: 'error' as const,
  code: 'SERVER_ERROR' as const,
  message: OFFERINGS_MESSAGES.SERVER_ERROR,
};

const uuidSchema = z.uuid();
// Positive integer stroops, no leading zero, never "0" (todo 153 — a zero/degenerate price is a client bug;
// the band lower bound stays backend-authoritative).
const priceSchema = z.string().regex(/^[1-9]\d*$/);
// count ≥ 1; the real upper bound (≤ publicFloat) is band-specific and enforced backend-side
// (BID_COUNT_EXCEEDS_FLOAT). `.safe()` caps it within 2^53 so an absurd count can't slip past (todo 153).
const countSchema = z.number().int().min(1).safe();

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

function validBidInput(input: BidInput): boolean {
  if (!priceSchema.safeParse(input.price).success) return false;
  if (!countSchema.safeParse(input.count).success) return false;
  // Upper-bound the escrow (price × count) so an absurd/overflowing amount is rejected before signing (SEC-3).
  return BigInt(input.price) * BigInt(input.count) <= I128_MAX;
}

// Quote a bid: builds the unsigned tx + WebAuthn challenge (no bid created; idempotent). Fail-fast — the
// service surfaces band/window/whitelist/balance rejections here, before the passkey prompt.
export async function prepareBidAction(
  offeringId: string,
  input: BidInput,
  idempotencyKey: string,
): Promise<PrepareBidResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(offeringId).success) return NOT_FOUND_ERROR;
  if (!uuidSchema.safeParse(idempotencyKey).success || !validBidInput(input)) return SERVER_ERROR;

  return prepareBid(token, offeringId, input, idempotencyKey);
}

// Submit the signed bid with the SAME Idempotency-Key as prepare (replay-safe). credentialId +
// authenticatorData/clientDataJSON/signature are opaque base64url — passed through verbatim, never parsed
// for a trust decision (SEC-6). txXdr is echoed back exactly as prepared.
export async function submitBidAction(
  offeringId: string,
  input: SubmitBidInput,
  idempotencyKey: string,
): Promise<SubmitBidResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(offeringId).success) return NOT_FOUND_ERROR;
  if (
    !uuidSchema.safeParse(idempotencyKey).success ||
    !input.txXdr ||
    !input.credentialId ||
    !input.authenticatorData ||
    !input.clientDataJSON ||
    !input.signature
  ) {
    return SERVER_ERROR;
  }

  return submitBid(token, offeringId, input, idempotencyKey);
}

// Reconcile / poll the caller's active bid (the read code path shared by ActiveBidCard load and the
// post-submit reconcile). No redirect on SESSION_EXPIRED — the client hook preserves entries + re-auths (AC-19).
export async function refreshMyBidAction(offeringId: string): Promise<MyBidResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(offeringId).success) return NOT_FOUND_ERROR;

  return getMyBid(token, offeringId);
}
