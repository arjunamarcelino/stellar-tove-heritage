import 'server-only';

import { z } from 'zod/v4';
import type { ChallengeServiceResult, VerifyServiceResult } from '@/lib/types/api';
import { tokenResponseSchema } from '@/lib/services/auth';
import { postJson, extractBackendMessage } from '@/lib/services/http';

const challengeResponseSchema = z.object({
  challengeTxXdr: z.string(),
  networkPassphrase: z.string(),
});

// ── Service Functions ─────────────────────────────

export async function requestChallenge(publicKey: string): Promise<ChallengeServiceResult> {
  if (!process.env.API_BASE_URL) {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'Server configuration error' };
  }

  const outcome = await postJson('/v1/auth/sep10/challenge', { publicKey });
  if (!outcome.ok) {
    if (outcome.status === 429) {
      return {
        status: 'error',
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      };
    }
    if (outcome.status === 0) {
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the authentication service',
      };
    }
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: extractBackendMessage(outcome.data, 'Failed to request challenge'),
    };
  }

  const parsed = challengeResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'Invalid challenge response' };
  }

  return {
    status: 'success',
    xdr: parsed.data.challengeTxXdr,
    networkPassphrase: parsed.data.networkPassphrase,
  };
}

export async function verifySignature(signedXdr: string): Promise<VerifyServiceResult> {
  if (!process.env.API_BASE_URL) {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'Server configuration error' };
  }

  const outcome = await postJson('/v1/auth/sep10/verify', { challengeTxXdr: signedXdr });
  if (!outcome.ok) {
    if (outcome.status === 401) {
      return { status: 'error', code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature' };
    }
    if (outcome.status === 0) {
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the authentication service',
      };
    }
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: extractBackendMessage(outcome.data, 'Verification failed'),
    };
  }

  const parsed = tokenResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'Invalid verification response' };
  }

  return {
    status: 'success',
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
  };
}
