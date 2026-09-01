'use server';

import { cookies } from 'next/headers';
import type { PasskeyBeginResult, PasskeyFinishResult, FinishPasskeyInput } from '@/lib/types/api';
import { begin, finish } from '@/lib/services/passkey';
import {
  emailSchema,
  registrationResponseSchema,
  authenticationResponseSchema,
} from '@/lib/webauthn/schemas';
import { setAuthTokenCookies } from '@/lib/cookies';

// Issues the WebAuthn challenge and reports whether this email is a login or a signup. Email is
// normalized via the shared schema so it binds identically here and in finish (plan A4).
export async function beginPasskeyRegistrationAction(email: string): Promise<PasskeyBeginResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Enter a valid email address.',
    };
  }
  return begin(parsed.data);
}

// Verifies the ceremony, provisions the wallet on signup, and — on success — sets httpOnly auth
// cookies then RETURNS (no redirect), so the client can show the transient success screen before
// navigating. This is a deliberate divergence from walletVerifyAction (plan Edge Case #6 / A1).
export async function finishPasskeyRegistrationAction(
  input: FinishPasskeyInput,
): Promise<PasskeyFinishResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) {
    return { status: 'error', code: 'VALIDATION_ERROR', message: 'Enter a valid email address.' };
  }

  // Validate the WebAuthn response shape for this mode (defense-in-depth), but forward the ORIGINAL
  // object so no fields are stripped before the backend's cryptographic verification.
  if (input.mode === 'signup') {
    if (!registrationResponseSchema.safeParse(input.attestationResponse).success) {
      return { status: 'error', code: 'VALIDATION_ERROR', message: 'Invalid passkey attestation.' };
    }
  } else {
    if (!authenticationResponseSchema.safeParse(input.assertionResponse).success) {
      return { status: 'error', code: 'VALIDATION_ERROR', message: 'Invalid passkey assertion.' };
    }
  }

  const result = await finish(
    input.mode === 'signup'
      ? { email: email.data, mode: 'signup', attestationResponse: input.attestationResponse }
      : { email: email.data, mode: 'login', assertionResponse: input.assertionResponse },
  );

  if (result.status === 'error') {
    return { status: 'error', code: result.code, message: result.message };
  }

  const cookieStore = await cookies();
  setAuthTokenCookies(cookieStore, result.accessToken, result.refreshToken);

  return { status: 'success', contractAddress: result.contractAddress };
}
