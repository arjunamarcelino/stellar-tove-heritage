'use server';

import { cookies } from 'next/headers';
import { COOKIE_KEYS } from '@/lib/constants';
import { getHoldings } from '@/lib/services/holdings';
import { HOLDINGS_MESSAGES } from '@/lib/holdings/holdingsMessages';
import type { HoldingsResult } from '@/lib/types/api';

// Retry seam for the client holdings widget. A Server Action is a public POST endpoint, so it re-reads and
// re-validates the httpOnly cookie itself (never trusts the page's gate, never takes a token param) and reads
// no request body. Delegates to the same getHoldings code path + egress guard as the SSR fetch — the two
// can't drift.

// Per-field `as const` mirrors app/actions/kyc.ts:17 (SESSION_ERROR) rather than a single trailing const.
const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: HOLDINGS_MESSAGES.SESSION_EXPIRED,
};

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

export async function refreshHoldingsAction(): Promise<HoldingsResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR; // missing cookie → backend never called (fail-closed)
  return getHoldings(token);
}
