'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { COOKIE_KEYS } from '@/lib/constants';
import { createRfq } from '@/lib/services/rfqs';
import { RFQ_MESSAGES } from '@/lib/rfq/rfqMessages';
import { checkRfqBounds } from '@/lib/rfq/validation';
import type { RfqInput, CreateRfqResult } from '@/lib/types/api';

// Thin server action for the FR-06.01 RFQ create flow (TOV-173). Reads the Bearer token from the httpOnly
// cookie (never trust a client-passed token), re-validates input (defense-in-depth), delegates to the service,
// and returns the result verbatim — NEVER redirects (the client hook owns navigation). The Idempotency-Key is
// a plain positional argument routed to the service header, never a FormData field. Message copy is always
// curated (RFQ_MESSAGES) — a money-adjacent flow never leaks raw backend text.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: RFQ_MESSAGES.SESSION_EXPIRED,
};
// artworkId comes from SSR resolution (the [id] route segment), so the uuid check is defense-in-depth (SEC-1).
const NOT_FOUND_ERROR = {
  status: 'error' as const,
  code: 'ARTWORK_NOT_FOUND' as const,
  message: RFQ_MESSAGES.ARTWORK_NOT_FOUND,
};
// A malformed idempotency key / shape reaching here is a client bug (the panel + minter guarantee shape).
const SERVER_ERROR = {
  status: 'error' as const,
  code: 'SERVER_ERROR' as const,
  message: RFQ_MESSAGES.SERVER_ERROR,
};

const uuidSchema = z.uuid();

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

// Create an RFQ (buy intent) for `artworkId`. The Idempotency-Key is re-validated as a uuid (a malformed
// fallback-minted key fails safe to SERVER_ERROR rather than reaching the backend). Input bounds are checked
// via the shared checkRfqBounds (same rules the service enforces — no drift).
export async function createRfqAction(
  artworkId: string,
  input: RfqInput,
  idempotencyKey: string,
): Promise<CreateRfqResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  if (!uuidSchema.safeParse(artworkId).success) return NOT_FOUND_ERROR;
  if (!uuidSchema.safeParse(idempotencyKey).success) return SERVER_ERROR;

  const invalid = checkRfqBounds(input);
  if (invalid) return invalid;

  return createRfq(token, artworkId, input, idempotencyKey);
}
