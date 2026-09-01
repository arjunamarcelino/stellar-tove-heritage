'use server';

import { z } from 'zod/v4';
import { readAccessToken } from '@/lib/cookies';
import { submitQuote } from '@/lib/services/quotes';
import { QUOTE_MESSAGES } from '@/lib/quote/quoteMessages';
import type { QuoteInput, SubmitQuoteResult } from '@/lib/types/api';

// Thin server action for the FR-06.03 quote submission flow (TOV-176). Reads the Bearer token from the httpOnly
// cookie (never trust a client-passed token), re-validates input (defense-in-depth), delegates to the service,
// and returns the result verbatim — NEVER redirects (the client hook owns navigation). The Idempotency-Key is a
// plain positional argument routed to the service header, never a FormData field. Message copy is always curated
// (QUOTE_MESSAGES) — a money-adjacent flow never leaks raw backend text.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: QUOTE_MESSAGES.SESSION_EXPIRED,
};
// rfqId comes from the [rfqId] route segment, so the uuid check is defense-in-depth (SEC-1). It travels in the
// URL path at the service, so a malformed value must never reach the fetch.
const RFQ_NOT_FOUND_ERROR = {
  status: 'error' as const,
  code: 'QUOTE_RFQ_NOT_FOUND' as const,
  message: QUOTE_MESSAGES.QUOTE_RFQ_NOT_FOUND,
};
// A malformed idempotency key / shape reaching here is a client bug (the panel + minter guarantee shape).
const SERVER_ERROR = {
  status: 'error' as const,
  code: 'SERVER_ERROR' as const,
  message: QUOTE_MESSAGES.SERVER_ERROR,
};

const uuidSchema = z.uuid();

// Submit a quote (sell offer) into `rfqId`. The Idempotency-Key is re-validated as a uuid (a malformed
// fallback-minted key fails safe to SERVER_ERROR rather than reaching the backend). Input BOUNDS (price/count/
// validUntil, incl. the null/shape guard) are enforced by the service's `checkQuoteBounds` — the single trust
// boundary, co-located with the uuid path guard and the last line before the network — so the action doesn't
// re-check them (no duplicated pass).
export async function submitQuoteAction(
  rfqId: string,
  input: QuoteInput,
  idempotencyKey: string,
): Promise<SubmitQuoteResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(rfqId).success) return RFQ_NOT_FOUND_ERROR;
  if (!uuidSchema.safeParse(idempotencyKey).success) return SERVER_ERROR;

  return submitQuote(token, rfqId, input, idempotencyKey);
}
