'use server';

import { z } from 'zod/v4';
import { readAccessToken } from '@/lib/cookies';
import { getRfqDetail, getMyTrade, prepareAccept, submitAccept } from '@/lib/services/accept';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';
import type {
  AcceptInput,
  SubmitAcceptInput,
  RfqDetailResult,
  PrepareAcceptResult,
  SubmitAcceptResult,
  MyTradeResult,
  RfqDetailAction,
  PrepareAcceptAction,
  SubmitAcceptAction,
  PollMyTradeAction,
} from '@/lib/types/api';

// Thin server actions for the FR-06.04 accept flow (TOV-178). Read the Bearer token from the httpOnly cookie
// (never trust a client-passed token), uuid-guard + shape-guard input (defense-in-depth), delegate to the
// service, and return the result verbatim — actions NEVER redirect (the client hook owns navigation). The
// Idempotency-Key is a plain positional argument routed to the service header, never a FormData field. Copy is
// always curated (ACCEPT_MESSAGES) — a money flow never leaks raw backend text. Each export is bound with
// `satisfies` its frozen action alias so a drifted signature fails to compile (plan D2).

// SESSION_EXPIRED is a member of both RfqDetailErrorCode and AcceptErrorCode, so one const (structural typing)
// spreads into all four action result unions (todo 186).
const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: ACCEPT_MESSAGES.SESSION_EXPIRED,
};

const RFQ_NOT_FOUND_ERROR = {
  status: 'error' as const,
  code: 'RFQ_NOT_FOUND' as const,
  message: ACCEPT_MESSAGES.RFQ_NOT_FOUND,
};

// A malformed shape reaching here is a client bug (the panel validates first) — fail safe/generic; the accept
// result unions carry no VALIDATION_FAILED, so SERVER_ERROR is the defensive fallback.
const SERVER_ACCEPT_ERROR = {
  status: 'error' as const,
  code: 'SERVER_ERROR' as const,
  message: ACCEPT_MESSAGES.SERVER_ERROR,
};

const uuidSchema = z.uuid();

// Shape-guard the client-supplied input (todo 169): `input` is attacker-controllable JSON; dereferencing a
// null/primitive would throw a TypeError and break the "always curated error" contract.
function validAcceptInput(input: unknown): input is AcceptInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    uuidSchema.safeParse((input as { quoteId?: unknown }).quoteId).success
  );
}

function validSubmitInput(input: unknown): input is SubmitAcceptInput {
  if (typeof input !== 'object' || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    uuidSchema.safeParse(i.quoteId).success &&
    typeof i.buyerAuthEntryXdr === 'string' &&
    !!i.buyerAuthEntryXdr &&
    typeof i.authenticatorData === 'string' &&
    !!i.authenticatorData &&
    typeof i.clientDataJSON === 'string' &&
    !!i.clientDataJSON &&
    typeof i.signature === 'string' &&
    !!i.signature
  );
}

// RFQ detail + open quotes (the read that seeds the list + gate). rfqId comes from the URL — the uuid check is
// defense-in-depth (a malformed id can't name a real RFQ → RFQ_NOT_FOUND rather than fetching).
export const rfqDetailAction = (async (rfqId: string): Promise<RfqDetailResult> => {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(rfqId).success) return RFQ_NOT_FOUND_ERROR;
  return getRfqDetail(token, rfqId);
}) satisfies RfqDetailAction;

// Prepare: feasibility + the buyer's own unsigned entry + a WebAuthn challenge (no trade created; idempotent).
export const prepareAcceptAction = (async (
  rfqId: string,
  input: AcceptInput,
  idempotencyKey: string,
): Promise<PrepareAcceptResult> => {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(rfqId).success) return SERVER_ACCEPT_ERROR;
  if (!uuidSchema.safeParse(idempotencyKey).success || !validAcceptInput(input)) {
    return SERVER_ACCEPT_ERROR;
  }
  return prepareAccept(token, rfqId, input, idempotencyKey);
}) satisfies PrepareAcceptAction;

// Submit the signed accept with the SAME Idempotency-Key as prepare (replay-safe). Assertion fields are opaque
// base64url passed through, never parsed for a trust decision (SEC-6). → 202 {tradeId, status:'pending'}.
export const submitAcceptAction = (async (
  rfqId: string,
  input: SubmitAcceptInput,
  idempotencyKey: string,
): Promise<SubmitAcceptResult> => {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(rfqId).success) return SERVER_ACCEPT_ERROR;
  if (!uuidSchema.safeParse(idempotencyKey).success || !validSubmitInput(input)) {
    return SERVER_ACCEPT_ERROR;
  }
  return submitAccept(token, rfqId, input, idempotencyKey);
}) satisfies SubmitAcceptAction;

// Poll / reconcile the caller's latest trade (the read shared by the settlement poller + the post-submit
// reconcile). No redirect on SESSION_EXPIRED — the client hook preserves state + re-auths.
export const pollMyTradeAction = (async (rfqId: string): Promise<MyTradeResult> => {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(rfqId).success) return SERVER_ACCEPT_ERROR;
  return getMyTrade(token, rfqId);
}) satisfies PollMyTradeAction;
