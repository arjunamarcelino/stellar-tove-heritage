'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { COOKIE_KEYS } from '@/lib/constants';
import { submissionSchema } from '@/lib/kyc/schemas';
import { KYC_SUBMIT_MESSAGES } from '@/lib/kyc/kycMessages';
import { submitKyc, getWhitelistStatus } from '@/lib/services/kyc';
import type { KycSubmitResult, WhitelistStatusResult } from '@/lib/types/api';

// Thin server action for the KYC submit flow (FR-01.07): read the Bearer token from the httpOnly cookie
// (never trust a client-passed token), re-validate the multipart payload (defense-in-depth), delegate to
// the service. Returns the result verbatim — the action NEVER redirects; the client hook decides
// navigation (on SESSION_EXPIRED it preserves the progress metadata and router.replace('/login')s).
// FormData is never logged, and the idempotency key is never logged.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: KYC_SUBMIT_MESSAGES.SESSION_EXPIRED,
};

const VALIDATION_ERROR = {
  status: 'error' as const,
  code: 'VALIDATION_FAILED' as const,
  message: KYC_SUBMIT_MESSAGES.VALIDATION_FAILED,
};

// The client-minted Idempotency-Key rides in a distinctly-named FormData field (never one of the four
// document field names, so it can't be mis-routed as an unexpected document). Read + removed here, then
// forwarded to the backend as a header by the service. Shape-only uuid check (self-minted v4).
const IDEMPOTENCY_FIELD = 'idempotencyKey';
const idempotencyKeySchema = z.uuid();

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

export async function submitKycAction(formData: FormData): Promise<KycSubmitResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  const rawKey = formData.get(IDEMPOTENCY_FIELD);
  if (typeof rawKey !== 'string' || !idempotencyKeySchema.safeParse(rawKey).success) {
    return VALIDATION_ERROR;
  }

  // Narrow the File|string|null entries through the shared schema — never an `as File` cast.
  const parsed = submissionSchema.safeParse({
    claimedJurisdiction: formData.get('claimedJurisdiction'),
    gov_id_front: formData.get('gov_id_front'),
    gov_id_back: formData.get('gov_id_back'),
    proof_of_address: formData.get('proof_of_address'),
    selfie: formData.get('selfie'),
  });
  if (!parsed.success) return VALIDATION_ERROR;

  // Strip the key field so the backend receives only the 4 files + claimedJurisdiction (the key is a
  // header). Prevents a stray text field tripping the backend's document-field validation.
  formData.delete(IDEMPOTENCY_FIELD);

  return submitKyc(token, formData, rawKey);
}

// Polling transport for the FR-01.08 whitelist status card. The client card calls this on an interval while
// pending_review; it reads the httpOnly cookie server-side (the token never reaches the client) and
// delegates to the service. Like submitKycAction it NEVER redirects — on SESSION_EXPIRED the client hook
// stops polling and navigates to /login itself.
export async function refreshWhitelistStatusAction(): Promise<WhitelistStatusResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;
  return getWhitelistStatus(token);
}
