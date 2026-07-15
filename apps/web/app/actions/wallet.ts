'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { WalletChallengeResult, WalletVerifyResult } from '@/lib/types/api';
import { requestChallenge, verifySignature } from '@/lib/services/walletConnect';
import { publicKeySchema, signedXdrSchema } from '@/lib/wallet/schemas';
import { setAuthTokenCookies } from '@/lib/cookies';

export async function requestChallengeAction(
  publicKey: string,
): Promise<WalletChallengeResult> {
  const parsed = publicKeySchema.safeParse(publicKey);
  if (!parsed.success) {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'Invalid public key format' };
  }

  const response = await requestChallenge(parsed.data);
  if (response.status === 'error') {
    return { status: 'error', code: response.code, message: response.message };
  }

  return {
    status: 'success',
    xdr: response.xdr,
    networkPassphrase: response.networkPassphrase,
  };
}

export async function walletVerifyAction(
  signedXdr: string,
): Promise<WalletVerifyResult> {
  const parsed = signedXdrSchema.safeParse(signedXdr);
  if (!parsed.success) {
    return { status: 'error', code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signed XDR format' };
  }

  const response = await verifySignature(parsed.data);
  if (response.status === 'error') {
    return { status: 'error', code: response.code, message: response.message };
  }

  const cookieStore = await cookies();
  setAuthTokenCookies(cookieStore, response.accessToken, response.refreshToken);

  redirect('/');
}
