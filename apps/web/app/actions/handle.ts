'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, ONBOARDING_NEXT_PATH } from '@/lib/constants';
import { handleSchema } from '@/lib/handle/schemas';
import { setHandle } from '@/lib/services/handle';
import { HANDLE_MESSAGES } from '@/lib/handle/handleMessages';
import type { SetHandleResult } from '@/lib/types/api';

// Thin server action for the handle-picker commit (FR-01.05): read the Bearer token from the httpOnly
// cookie (never trust a client-passed token), re-validate the handle (defense-in-depth), delegate to
// the service. On success it SERVER-redirects to ONBOARDING_NEXT_PATH — the redirect is the terminal,
// so the success DTO is never returned to the client (B2). The availability check is a separate,
// public, client-side call (lib/handle/checkHandle.ts) and has no action here.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: HANDLE_MESSAGES.SESSION_EXPIRED,
};

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

export async function setHandleAction(handle: string): Promise<SetHandleResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  const parsed = handleSchema.safeParse(handle);
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'HANDLE_FORMAT_INVALID',
      message: HANDLE_MESSAGES.HANDLE_FORMAT_INVALID,
    };
  }

  const result = await setHandle(token, parsed.data);
  // Success is terminal via a server redirect (throws NEXT_REDIRECT — never wrap this in a catch that
  // swallows it). Only an error result falls through and is returned to the client.
  if (result.status === 'success') {
    redirect(ONBOARDING_NEXT_PATH);
  }
  return result;
}
